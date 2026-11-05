/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  convertCurrencyAmount,
  DEFAULT_BASELINE_EXCHANGE_RATES,
  getConvertedTransactionView,
  getProductPricesInCurrency,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import { Product } from '../../lib/types';
import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  FinancialAnalyticsResult,
  SalesAnalyticsResult,
} from '../analytics.types';
import {
  computeSalesAnalytics,
  filterTransactionsByScope,
  resolveAnalyticsDateWindow,
  resolveHistoricalLineItemCost,
  resolveReturnsForTransaction,
} from './sales.metrics';

/**
 * Computes comprehensive Financial & Accounting Analytics, reconciling with Sales Analytics,
 * Returns, Purchases, and Stock Movements without fabricating missing overhead expenses
 * or historical costs.
 */
export function computeFinancialAnalytics(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  precomputedSales?: SalesAnalyticsResult,
  referenceDate: Date = new Date()
): FinancialAnalyticsResult {
  const targetCurrency = filters.currency || 'SDG';
  const valuationMode = filters.valuationMode || 'historical';
  const anchorCurrency = filters.anchorCurrency || 'USD';
  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(dataset.exchangeRates || {}),
    SDG: 1,
  };

  const sales =
    precomputedSales || computeSalesAnalytics(dataset, filters, referenceDate);
  const window = resolveAnalyticsDateWindow(filters, referenceDate);
  const productsMap = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));

  const scopedTransactions = filterTransactionsByScope(
    dataset.transactions,
    productsMap,
    dataset.branches,
    filters
  ).filter((tx) => {
    const t = new Date(tx.timestamp).getTime();
    return t >= window.startDate.getTime() && t <= window.endDate.getTime();
  });

  // Total COGS from daily series (which already accounts for returned merchandise reversals)
  const costOfGoodsSold = roundCurrencyValue(
    sales.dailySeries.reduce((acc, d) => acc + (d.cogs ?? 0), 0)
  );
  const netSalesRevenue = sales.summary.netSales;
  const grossProfit = roundCurrencyValue(netSalesRevenue - costOfGoodsSold);
  const grossProfitMarginPercent =
    netSalesRevenue > 0 ? Math.round((grossProfit / netSalesRevenue) * 1000) / 10 : 0;

  // Break down COGS by data quality tier across completed transactions in period
  let exactHistoricalCogsPortion = 0;
  let estimatedCurrentCostCogsPortion = 0;
  let unresolvableCostRevenuePortion = 0;

  // Cash inflows & AR & FX comparison across completed transactions in period
  let cashInflowsFromSalesAtCheckout = 0;
  let cashInflowsFromDebtSettlements = 0;
  let cashRefundsForReturns = 0;
  let accountsReceivableOutstandingDebt = 0;
  let netSalesAtHistoricalRate = 0;
  let netSalesAtLiveRate = 0;
  let netSalesAtUsdIndexedRate = 0;

  for (const tx of scopedTransactions) {
    if (tx.status !== 'completed') continue;

    const viewActive = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      valuationMode,
      anchorCurrency
    );
    const viewHist = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      'historical',
      anchorCurrency
    );
    const viewLive = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      'live',
      anchorCurrency
    );
    const viewIndexed = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      'indexed',
      anchorCurrency
    );

    const snapshotRates: Record<string, number> =
      valuationMode === 'historical'
        ? {
            ...DEFAULT_BASELINE_EXCHANGE_RATES,
            ...(tx.exchangeRatesSnapshot || {}),
            SDG: 1,
          }
        : liveRates;

    // Resolve returns for this transaction
    const txReturns = resolveReturnsForTransaction(tx, dataset.returns || []);
    const returnedQtyByProduct = new Map<string, number>();
    let rawRefundInTxCurrency = 0;

    for (const ret of txReturns) {
      if (Array.isArray(ret.items) && ret.items.length > 0) {
        for (const ri of ret.items) {
          returnedQtyByProduct.set(
            ri.productId,
            (returnedQtyByProduct.get(ri.productId) || 0) + Math.max(0, ri.quantity)
          );
          rawRefundInTxCurrency = roundCurrencyValue(
            rawRefundInTxCurrency + Math.max(0, ri.refundAmount)
          );
        }
      } else if (ret.refundTotal > 0) {
        rawRefundInTxCurrency = roundCurrencyValue(
          rawRefundInTxCurrency + ret.refundTotal
        );
      }
    }

    const txToTargetFactor =
      tx.grandTotal > 0 ? viewActive.grandTotal / tx.grandTotal : 1;
    const cappedGrossReturnBilled = Math.min(
      viewActive.grandTotal,
      roundCurrencyValue(rawRefundInTxCurrency * txToTargetFactor)
    );

    // Track COGS portions by tier (consuming returned quantities across matching lines without double-deducting)
    const remainingRetQtyByProd = new Map(returnedQtyByProduct);
    for (const item of tx.items) {
      const prod = productsMap.get(item.productId);
      const costRes = resolveHistoricalLineItemCost(
        item,
        prod,
        tx.timestamp,
        targetCurrency,
        snapshotRates
      );
      const availRetQty = remainingRetQtyByProd.get(item.productId) || 0;
      const retQty = Math.min(item.quantity, availRetQty);
      remainingRetQtyByProd.set(item.productId, Math.max(0, availRetQty - retQty));
      const netQty = Math.max(0, item.quantity - retQty);
      const netItemCost = roundCurrencyValue(costRes.unitCostResolved * netQty);

      if (
        costRes.quality === 'exact_frozen_at_sale' ||
        costRes.quality === 'reconstructed_from_price_history'
      ) {
        exactHistoricalCogsPortion = roundCurrencyValue(
          exactHistoricalCogsPortion + netItemCost
        );
      } else if (costRes.quality === 'estimated_from_current_catalog_cost') {
        estimatedCurrentCostCogsPortion = roundCurrencyValue(
          estimatedCurrentCostCogsPortion + netItemCost
        );
      } else {
        unresolvableCostRevenuePortion = roundCurrencyValue(
          unresolvableCostRevenuePortion + item.total * txToTargetFactor
        );
      }
    }

    // Debt settlements recorded on this transaction
    let installmentsInTxCurrency = 0;
    if (Array.isArray(tx.debtPayments) && tx.debtPayments.length > 0) {
      for (const dp of tx.debtPayments) {
        installmentsInTxCurrency = roundCurrencyValue(
          installmentsInTxCurrency + (dp.amountPaid || 0)
        );
      }
    }

    const totalPaidInTxCurrency =
      tx.amountPaid !== undefined ? tx.amountPaid : tx.grandTotal;
    const upfrontPaidInTxCurrency = Math.max(
      0,
      roundCurrencyValue(totalPaidInTxCurrency - installmentsInTxCurrency)
    );

    cashInflowsFromSalesAtCheckout = roundCurrencyValue(
      cashInflowsFromSalesAtCheckout + upfrontPaidInTxCurrency * txToTargetFactor
    );
    cashInflowsFromDebtSettlements = roundCurrencyValue(
      cashInflowsFromDebtSettlements + installmentsInTxCurrency * txToTargetFactor
    );

    // If this invoice had returns and was paid, record cash refund up to paid amount
    if (cappedGrossReturnBilled > 0 && viewActive.amountPaid > 0) {
      const refundedCash = Math.min(viewActive.amountPaid, cappedGrossReturnBilled);
      cashRefundsForReturns = roundCurrencyValue(cashRefundsForReturns + refundedCash);
    }

    const remainingDebtAfterReturn = Math.max(
      0,
      roundCurrencyValue(
        viewActive.debtAmount -
          Math.max(0, cappedGrossReturnBilled - viewActive.amountPaid)
      )
    );
    accountsReceivableOutstandingDebt = roundCurrencyValue(
      accountsReceivableOutstandingDebt + remainingDebtAfterReturn
    );

    const returnFraction =
      viewActive.grandTotal > 0 ? cappedGrossReturnBilled / viewActive.grandTotal : 0;

    netSalesAtHistoricalRate = roundCurrencyValue(
      netSalesAtHistoricalRate +
        Math.max(0, (viewHist.subtotal - viewHist.discountAmount) * (1 - returnFraction))
    );
    netSalesAtLiveRate = roundCurrencyValue(
      netSalesAtLiveRate +
        Math.max(0, (viewLive.subtotal - viewLive.discountAmount) * (1 - returnFraction))
    );
    netSalesAtUsdIndexedRate = roundCurrencyValue(
      netSalesAtUsdIndexedRate +
        Math.max(
          0,
          (viewIndexed.subtotal - viewIndexed.discountAmount) * (1 - returnFraction)
        )
    );
  }

  const totalCashInflows = Math.max(
    0,
    roundCurrencyValue(
      cashInflowsFromSalesAtCheckout +
        cashInflowsFromDebtSettlements -
        cashRefundsForReturns
    )
  );

  // Stock movements & Purchase Orders in period:
  // Separate Shrinkage/Damage Expense, Purchase Commitments, Cash Outflows for Restocks, and AP.
  // Process explicit Purchase Orders first and record their IDs/numbers so restock movements linked
  // to those POs are never double-counted (FIN-14).
  let recordedShrinkageAndDamageExpense = 0;
  let cashOutflowsForRestockPurchases = 0;
  let accountsPayablePendingInvoices = 0;
  let purchaseCommitmentsTotal = 0;
  const handledPurchaseRefs = new Set<string>();

  for (const po of dataset.purchases || []) {
    if (!po || po.status === 'cancelled') continue;
    const poTime = new Date(po.invoiceDate).getTime();
    if (poTime < window.startDate.getTime() || poTime > window.endDate.getTime()) {
      continue;
    }

    if (
      filters.branchId &&
      filters.branchId !== 'all' &&
      po.branchId &&
      po.branchId !== 'all' &&
      po.branchId !== filters.branchId
    ) {
      continue;
    }

    let filterScale = 1;
    if (
      (filters.productId && filters.productId !== 'all') ||
      (filters.category && filters.category !== 'all')
    ) {
      if (Array.isArray(po.items) && po.items.length > 0) {
        let matchingItemsCost = 0;
        let allItemsCost = 0;
        for (const it of po.items) {
          const itemCost = Math.max(0, Number(it.totalCost) || Number(it.quantity) * Number(it.unitCost) || 0);
          allItemsCost += itemCost;
          const p = productsMap.get(it.productId);
          const prodMatch =
            !filters.productId || filters.productId === 'all' || it.productId === filters.productId;
          const catMatch =
            !filters.category || filters.category === 'all' || p?.category === filters.category;
          if (prodMatch && catMatch) {
            matchingItemsCost += itemCost;
          }
        }
        if (matchingItemsCost <= 0) continue;
        filterScale = allItemsCost > 0 ? matchingItemsCost / allItemsCost : 1;
      }
    }

    if (po.id) handledPurchaseRefs.add(po.id.trim().toLowerCase());
    if (po.purchaseNumber) handledPurchaseRefs.add(po.purchaseNumber.trim().toLowerCase());

    const rawTotal = Number.isFinite(Number(po.totalAmount))
      ? Math.max(0, Number(po.totalAmount) * filterScale)
      : 0;

    let rawPaid: number;
    if (po.paymentStatus === 'unpaid') {
      rawPaid = 0;
    } else if (po.paidAmount !== undefined && po.paidAmount !== null) {
      const parsedPaid = Number(po.paidAmount);
      rawPaid = Number.isFinite(parsedPaid) ? parsedPaid * filterScale : 0;
    } else if (po.paymentStatus === 'paid') {
      rawPaid = rawTotal;
    } else {
      rawPaid = 0;
    }

    // Clamp paidAmount to [0, totalAmount] in source currency and target currency (FIN-14)
    const clampedPaidSource = Math.max(0, Math.min(rawTotal, rawPaid));

    const poTotalInTarget = roundCurrencyValue(
      convertCurrencyAmount(
        rawTotal,
        po.currency || 'SDG',
        targetCurrency,
        liveRates
      )
    );
    const paidInTarget = roundCurrencyValue(
      Math.max(
        0,
        Math.min(
          poTotalInTarget,
          convertCurrencyAmount(
            clampedPaidSource,
            po.currency || 'SDG',
            targetCurrency,
            liveRates
          )
        )
      )
    );
    const unpaidInTarget = roundCurrencyValue(
      Math.max(0, poTotalInTarget - paidInTarget)
    );

    purchaseCommitmentsTotal = roundCurrencyValue(
      purchaseCommitmentsTotal + poTotalInTarget
    );
    cashOutflowsForRestockPurchases = roundCurrencyValue(
      cashOutflowsForRestockPurchases + paidInTarget
    );
    accountsPayablePendingInvoices = roundCurrencyValue(
      accountsPayablePendingInvoices + unpaidInTarget
    );
  }

  for (const mov of dataset.stockMovements) {
    const movTime = new Date(mov.timestamp).getTime();
    if (movTime < window.startDate.getTime() || movTime > window.endDate.getTime()) {
      continue;
    }

    const prod = productsMap.get(mov.productId);
    if (filters.productId && filters.productId !== 'all' && mov.productId !== filters.productId) {
      continue;
    }
    if (filters.category && filters.category !== 'all' && prod?.category !== filters.category) {
      continue;
    }

    const movUnitCostInTarget =
      mov.unitCost !== undefined && mov.unitCost > 0
        ? convertCurrencyAmount(
            mov.unitCost,
            mov.currency || prod?.priceCurrency || 'SDG',
            targetCurrency,
            liveRates
          )
        : prod
        ? getProductPricesInCurrency(prod, targetCurrency, liveRates).costPrice
        : 0;

    const absUnits = Math.abs(mov.quantityChange);
    const totalMovCost = roundCurrencyValue(absUnits * movUnitCostInTarget);

    if (mov.type === 'damage' || mov.type === 'loss') {
      recordedShrinkageAndDamageExpense = roundCurrencyValue(
        recordedShrinkageAndDamageExpense + totalMovCost
      );
    } else if (mov.type === 'restock') {
      // Skip if this restock movement is already accounted for by an explicit Purchase Order
      const refKey = (mov.referenceId || '').trim().toLowerCase();
      const invKey = (mov.invoiceNumber || '').trim().toLowerCase();
      if (
        (refKey && handledPurchaseRefs.has(refKey)) ||
        (invKey && handledPurchaseRefs.has(invKey))
      ) {
        continue;
      }

      purchaseCommitmentsTotal = roundCurrencyValue(
        purchaseCommitmentsTotal + totalMovCost
      );
      if (mov.receiptMode === 'goods_only') {
        accountsPayablePendingInvoices = roundCurrencyValue(
          accountsPayablePendingInvoices + totalMovCost
        );
      } else {
        cashOutflowsForRestockPurchases = roundCurrencyValue(
          cashOutflowsForRestockPurchases + totalMovCost
        );
      }
    }
  }

  // Inventory valuation at cost and retail across filtered catalog
  let inventoryValuationAtCost = 0;
  let inventoryValuationAtRetail = 0;

  for (const prod of dataset.products) {
    if (filters.productId && filters.productId !== 'all' && prod.id !== filters.productId) {
      continue;
    }
    if (filters.category && filters.category !== 'all' && prod.category !== filters.category) {
      continue;
    }
    const prices = getProductPricesInCurrency(prod, targetCurrency, liveRates);
    const stockUnits = Math.max(0, prod.stock);
    inventoryValuationAtCost = roundCurrencyValue(
      inventoryValuationAtCost + stockUnits * prices.costPrice
    );
    inventoryValuationAtRetail = roundCurrencyValue(
      inventoryValuationAtRetail + stockUnits * prices.sellingPrice
    );
  }

  const potentialInventoryGrossProfit = roundCurrencyValue(
    Math.max(0, inventoryValuationAtRetail - inventoryValuationAtCost)
  );

  const profitAfterRecordedShrinkage = roundCurrencyValue(
    grossProfit - recordedShrinkageAndDamageExpense
  );
  const profitAfterShrinkageMarginPercent =
    netSalesRevenue > 0
      ? Math.round((profitAfterRecordedShrinkage / netSalesRevenue) * 1000) / 10
      : 0;

  // Operating Profit requires general operating expenses (rent, utilities, payroll).
  const hasFixedExpensesOverride =
    filters.fixedOperatingExpensesOverride !== undefined &&
    Number.isFinite(filters.fixedOperatingExpensesOverride) &&
    Number(filters.fixedOperatingExpensesOverride) >= 0;

  const fixedOperatingExpenses = hasFixedExpensesOverride
    ? roundCurrencyValue(Number(filters.fixedOperatingExpensesOverride))
    : null;

  const netOperatingProfit =
    fixedOperatingExpenses !== null
      ? roundCurrencyValue(profitAfterRecordedShrinkage - fixedOperatingExpenses)
      : null;

  const netProfitMarginPercent =
    netOperatingProfit !== null && netSalesRevenue > 0
      ? Math.round((netOperatingProfit / netSalesRevenue) * 1000) / 10
      : null;

  const netCashFlow = roundCurrencyValue(
    totalCashInflows - cashOutflowsForRestockPurchases
  );

  const collectionEfficiencyPercent =
    sales.summary.billedGrandTotal > 0
      ? Math.min(
          100,
          Math.round((totalCashInflows / sales.summary.billedGrandTotal) * 1000) / 10
        )
      : 100;

  // Accounting Break-Even Analysis: BreakEvenRevenue = FixedOperatingCosts / ContributionMarginRatio
  const contributionMargin = grossProfit;
  const contributionMarginRatio =
    netSalesRevenue > 0
      ? Math.max(0, Math.round((grossProfit / netSalesRevenue) * 1000) / 1000)
      : 0;

  const breakEvenSalesRevenue =
    fixedOperatingExpenses !== null && contributionMarginRatio > 0
      ? roundCurrencyValue(fixedOperatingExpenses / contributionMarginRatio)
      : null;

  const surplusOrDeficitRevenue =
    breakEvenSalesRevenue !== null
      ? roundCurrencyValue(netSalesRevenue - breakEvenSalesRevenue)
      : null;

  const isAboveBreakEven =
    breakEvenSalesRevenue !== null ? netSalesRevenue >= breakEvenSalesRevenue : null;

  const unrealizedFxTranslationDelta = roundCurrencyValue(
    netSalesAtUsdIndexedRate - netSalesAtHistoricalRate
  );
  const fxPurchasingPowerPreservationPercent =
    netSalesAtUsdIndexedRate > 0
      ? Math.round((netSalesAtHistoricalRate / netSalesAtUsdIndexedRate) * 1000) / 10
      : 100;

  const isGrossProfitEstimated =
    sales.cogsDataQuality !== 'exact_frozen_at_sale' &&
    sales.cogsDataQuality !== 'reconstructed_from_price_history';

  return {
    currency: targetCurrency,
    valuationMode,
    financialAccessStatus: 'authorized',
    cogsDataQuality: sales.cogsDataQuality,
    periodStart: sales.periodStart,
    periodEnd: sales.periodEnd,
    profitAndLoss: {
      grossRevenueBilled: sales.summary.billedGrandTotal,
      grossSalesPreDiscount: sales.summary.grossSales,
      salesDiscounts: sales.summary.discountsTotal,
      merchandiseReturnsNet: sales.summary.merchandiseReturnsNetSales,
      voidedInvoicesExcluded: sales.summary.voidedSalesAmount,
      returnsAndVoids: sales.summary.returnedOrVoidedSales,
      taxesCollected: sales.summary.taxCollected,
      netSalesRevenue,
      costOfGoodsSold,
      exactHistoricalCogsPortion,
      estimatedCurrentCostCogsPortion,
      unresolvableCostRevenuePortion,
      cogsDataQuality: sales.cogsDataQuality,
      cogsStatusNoteEn: sales.cogsValuationNoteEn,
      cogsStatusNoteAr: sales.cogsValuationNoteAr,
      grossProfit,
      estimatedGrossProfit: grossProfit,
      grossProfitMarginPercent,
      isGrossProfitEstimated,
      recordedShrinkageAndDamageExpense,
      profitAfterRecordedShrinkage,
      profitAfterShrinkageMarginPercent,
      generalOperatingExpenses: fixedOperatingExpenses,
      generalOperatingExpensesStatus: hasFixedExpensesOverride
        ? 'recorded'
        : 'not_recorded_in_schema',
      generalOperatingExpensesNoteEn: hasFixedExpensesOverride
        ? 'Fixed operating expenses provided via explicit analytical override parameter.'
        : 'General overhead expenses (rent, utilities, payroll) are not stored in the current POS schema. Profit After Recorded Shrinkage is reported explicitly; true Net Operating Profit is marked unavailable rather than fabricated.',
      generalOperatingExpensesNoteAr: hasFixedExpensesOverride
        ? 'تم تزويد المصروفات التشغيلية الثابتة عبر مدخلات التحليل الصريحة.'
        : 'المصروفات التشغيلية العامة (الإيجار، المرافق، الرواتب) غير مسجلة في جدول مستقل بقاعدة البيانات الحالية؛ يتم عرض "الربح بعد الفاقد المسجل" بوضوح، بينما يُصنف "صافي الربح التشغيلي" كغير متاح بدلاً من تقديره بأرقام افتراضية.',
      operatingProfitStatus: hasFixedExpensesOverride
        ? 'available'
        : 'unavailable_missing_operating_expenses',
      netOperatingProfit,
      netProfitMarginPercent,
    },
    cashFlowAndWorkingCapital: {
      cashInflowsFromSalesAtCheckout,
      cashInflowsFromDebtSettlements,
      cashRefundsForReturns,
      totalCashInflows,
      purchaseCommitmentsTotal,
      cashOutflowsForRestockPurchases,
      supplierCashOutflowStatus: 'estimated_from_received_paid_restocks',
      supplierCashOutflowNoteEn:
        'Supplier cash outflows reflect received restock movements (goods_and_invoice) and paid purchase orders; goods_only receipts are tracked under Accounts Payable.',
      supplierCashOutflowNoteAr:
        'تعكس التدفقات النقدية الخارجة للموردين حركات التوريد المستلمة مع الفاتورة وأوامر الشراء المسددة، بينما تُسجل البضائع المستلمة بدون فاتورة ضمن الذمم الدائنة.',
      netCashFlow,
      accountsReceivableOutstandingDebt,
      accountsPayablePendingInvoices,
      inventoryValuationAtCost,
      inventoryValuationAtRetail,
      potentialInventoryGrossProfit,
      collectionEfficiencyPercent,
    },
    breakEvenAnalysis: {
      status: hasFixedExpensesOverride
        ? 'available'
        : 'unavailable_missing_fixed_costs',
      fixedOperatingCosts: fixedOperatingExpenses,
      variableCostsCogs: costOfGoodsSold,
      contributionMargin,
      contributionMarginRatio,
      averageGrossMarginRatio: contributionMarginRatio,
      recordedShrinkageCosts: recordedShrinkageAndDamageExpense,
      breakEvenSalesRevenue,
      currentNetSalesRevenue: netSalesRevenue,
      surplusOrDeficitRevenue,
      isAboveBreakEven,
      noteEn: hasFixedExpensesOverride
        ? 'Break-even sales revenue calculated as Fixed Operating Costs ÷ Contribution Margin Ratio.'
        : 'True accounting Break-Even Point requires Fixed Operating Costs (rent, salaries, utilities), which are not recorded in the current POS schema. Inventory restock purchases are capital asset additions, not fixed expenses.',
      noteAr: hasFixedExpensesOverride
        ? 'تم احتساب إيراد نقطة التعادل وفق المعادلة المحاسبية: التكاليف التشغيلية الثابتة ÷ نسبة هامش المساهمة.'
        : 'يتطلب حساب نقطة التعادل المحاسبية الدقيقة توفر التكاليف التشغيلية الثابتة (الإيجار، الرواتب، المرافق)، وهي غير مسجلة في قاعدة البيانات الحالية. مشتريات إعادة تعبئة المخزون تُعد أصولاً متداولة وليست مصروفات تشغيلية ثابتة.',
    },
    fxSensitivityAndValuation: {
      netSalesAtHistoricalRate,
      netSalesAtLiveRate,
      netSalesAtUsdIndexedRate,
      unrealizedFxTranslationDelta,
      fxPurchasingPowerPreservationPercent,
      anchorCurrency,
    },
    categoryProfitability: sales.byCategory,
    productProfitability: sales.byProduct,
  };
}
