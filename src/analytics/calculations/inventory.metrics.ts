/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  convertCurrencyAmount,
  DEFAULT_BASELINE_EXCHANGE_RATES,
  getProductPricesInCurrency,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import { Product, StockMovement } from '../../lib/types';
import {
  ABCClassificationBasis,
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  InventoryAnalyticsResult,
  ProductInventoryAnalyticsItem,
  SalesAnalyticsResult,
} from '../analytics.types';
import {
  computeSalesAnalytics,
  filterTransactionsByScope,
  resolveAnalyticsDateWindow,
  resolveReturnsForTransaction,
  toDateKey,
} from './sales.metrics';

/**
 * Computes deduplicated pending inbound units per product from:
 * 1. `dataset.purchases` where `status === 'ordered'`
 * 2. `dataset.stockMovements` where `type === 'restock'` and `receiptMode === 'invoice_only'`
 * Deduplicates by stable reference keys (`po.id`, `po.purchaseNumber`, `mov.referenceId`, `mov.invoiceNumber`).
 */
export function computePendingInboundByProduct(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams
): Map<string, number> {
  const pendingInboundByProduct = new Map<string, number>();
  const handledInboundRefs = new Set<string>();
  const productsMap = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));

  for (const po of dataset.purchases || []) {
    if (!po || po.status !== 'ordered') continue;
    if (
      filters.branchId &&
      filters.branchId !== 'all' &&
      po.branchId &&
      po.branchId !== 'all' &&
      po.branchId !== filters.branchId
    ) {
      continue;
    }

    if (po.id) handledInboundRefs.add(po.id.trim().toLowerCase());
    if (po.purchaseNumber) handledInboundRefs.add(po.purchaseNumber.trim().toLowerCase());

    for (const item of po.items || []) {
      if (
        filters.productId &&
        filters.productId !== 'all' &&
        item.productId !== filters.productId
      ) {
        continue;
      }
      if (filters.category && filters.category !== 'all') {
        const prod = productsMap.get(item.productId);
        if (prod && prod.category !== filters.category) continue;
      }
      const qty = Math.max(0, Number(item.quantity) || 0);
      if (qty > 0) {
        pendingInboundByProduct.set(
          item.productId,
          (pendingInboundByProduct.get(item.productId) || 0) + qty
        );
      }
    }
  }

  for (const mov of dataset.stockMovements || []) {
    if (!mov || mov.type !== 'restock' || mov.receiptMode !== 'invoice_only') {
      continue;
    }
    const prod = productsMap.get(mov.productId);
    if (
      filters.productId &&
      filters.productId !== 'all' &&
      mov.productId !== filters.productId
    ) {
      continue;
    }
    if (
      filters.category &&
      filters.category !== 'all' &&
      prod &&
      prod.category !== filters.category
    ) {
      continue;
    }

    const refKey = (mov.referenceId || '').trim().toLowerCase();
    const invKey = (mov.invoiceNumber || '').trim().toLowerCase();
    if (
      (refKey && handledInboundRefs.has(refKey)) ||
      (invKey && handledInboundRefs.has(invKey))
    ) {
      continue;
    }

    const qty = Math.abs(Number(mov.quantityChange) || 0);
    if (qty > 0) {
      pendingInboundByProduct.set(
        mov.productId,
        (pendingInboundByProduct.get(mov.productId) || 0) + qty
      );
    }
  }

  return pendingInboundByProduct;
}

/**
 * Computes comprehensive Inventory, ABC Classification, Reconstructed Cost-Based Stock Turnover,
 * Unit Sell-Through Ratio, DOH, Pending Inbound Orders, and Reorder Analytics in O(Products + Transactions).
 */
export function computeInventoryAnalytics(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  precomputedSales?: SalesAnalyticsResult,
  referenceDate: Date = new Date()
): InventoryAnalyticsResult {
  const targetCurrency = filters.currency || 'SDG';
  const abcBasis: ABCClassificationBasis = filters.abcBasis || 'revenue';
  const leadTimeDaysAssumed = Number.isFinite(filters.leadTimeDays)
    ? Math.max(1, Math.min(90, Number(filters.leadTimeDays)))
    : 3;
  const safetyStockDaysAssumed = Number.isFinite(filters.safetyStockDays)
    ? Math.max(1, Math.min(30, Number(filters.safetyStockDays)))
    : 2;

  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(dataset.exchangeRates || {}),
    SDG: 1,
  };

  const window = resolveAnalyticsDateWindow(filters, referenceDate);
  const sales =
    precomputedSales || computeSalesAnalytics(dataset, filters, referenceDate);

  const productsMap = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));
  const scopedTxs = filterTransactionsByScope(
    dataset.transactions,
    productsMap,
    dataset.branches,
    filters
  );

  const windowStartMs = window.startDate.getTime();
  const windowEndMs = window.endDate.getTime();

  let earliestTxMs = windowEndMs;
  const lastSaleByProduct = new Map<string, number>();
  const baseStockUnitsSoldByProduct = new Map<string, number>();
  const returnedUnitsByProduct = new Map<string, number>();
  const matchedReturnIds = new Set<string>();

  // Single O(Transactions) pass to index lastSaleByProduct, baseStockUnitsSold, and transaction returns
  for (const tx of scopedTxs) {
    if (tx.status !== 'completed') continue;
    const tMs = new Date(tx.timestamp).getTime();
    if (isNaN(tMs)) continue;

    if (tMs < earliestTxMs) earliestTxMs = tMs;
    const inWin = tMs >= windowStartMs && tMs <= windowEndMs;

    for (const item of tx.items) {
      const prev = lastSaleByProduct.get(item.productId) || 0;
      if (tMs > prev) lastSaleByProduct.set(item.productId, tMs);

      if (inWin) {
        const prod = productsMap.get(item.productId);
        let units = item.quantity;
        if (item.stockDeducted && item.stockDeducted > 0) {
          units = item.stockDeducted;
        } else if (item.saleUnit === 'pack' && prod?.unitsPerPack && prod.unitsPerPack > 1) {
          units = item.quantity * prod.unitsPerPack;
        }
        baseStockUnitsSoldByProduct.set(
          item.productId,
          (baseStockUnitsSoldByProduct.get(item.productId) || 0) + units
        );
      }
    }

    if (inWin) {
      const txRets = resolveReturnsForTransaction(tx, dataset.returns || []);
      for (const ret of txRets) {
        if (ret.id) matchedReturnIds.add(ret.id);
        for (const rItem of ret.items || []) {
          const prod = productsMap.get(rItem.productId);
          const rSaleUnit = (rItem as any).saleUnit;
          const retBaseUnits =
            rSaleUnit === 'pack' && prod?.unitsPerPack && prod.unitsPerPack > 1
              ? Math.max(0, rItem.quantity) * prod.unitsPerPack
              : Math.max(0, rItem.quantity);
          returnedUnitsByProduct.set(
            rItem.productId,
            (returnedUnitsByProduct.get(rItem.productId) || 0) + retBaseUnits
          );
        }
      }
    }
  }

  // Also include any standalone returns in the window not already matched above
  for (const ret of dataset.returns || []) {
    if (ret.id && matchedReturnIds.has(ret.id)) continue;
    const rMs = ret.timestamp ? new Date(ret.timestamp).getTime() : windowStartMs;
    if (rMs < windowStartMs || rMs > windowEndMs) continue;
    for (const rItem of ret.items || []) {
      const prod = productsMap.get(rItem.productId);
      const rSaleUnit = (rItem as any).saleUnit;
      const retBaseUnits =
        rSaleUnit === 'pack' && prod?.unitsPerPack && prod.unitsPerPack > 1
          ? Math.max(0, rItem.quantity) * prod.unitsPerPack
          : Math.max(0, rItem.quantity);
      returnedUnitsByProduct.set(
        rItem.productId,
        (returnedUnitsByProduct.get(rItem.productId) || 0) + retBaseUnits
      );
    }
  }

  const observedSpanDays = Math.max(
    1,
    Math.ceil(
      (windowEndMs - Math.max(windowStartMs, earliestTxMs)) / (24 * 3600 * 1000)
    )
  );
  const effectiveDemandDays = Math.max(
    1,
    Math.min(window.calendarDays, Math.max(7, observedSpanDays))
  );

  const salesByProductMap = new Map(sales.byProduct.map((p) => [p.id, p]));

  const shrinkageByProduct = new Map<string, number>();
  const restockByProduct = new Map<string, number>();
  const auditDeltaByProduct = new Map<string, number>();
  const pendingInboundByProduct = computePendingInboundByProduct(dataset, filters);

  const movementSummaryMap = new Map<
    StockMovement['type'],
    { count: number; totalUnits: number; estimatedValue: number }
  >([
    ['restock', { count: 0, totalUnits: 0, estimatedValue: 0 }],
    ['sale', { count: 0, totalUnits: 0, estimatedValue: 0 }],
    ['damage', { count: 0, totalUnits: 0, estimatedValue: 0 }],
    ['loss', { count: 0, totalUnits: 0, estimatedValue: 0 }],
    ['audit', { count: 0, totalUnits: 0, estimatedValue: 0 }],
  ]);

  for (const mov of dataset.stockMovements) {
    const movMs = new Date(mov.timestamp).getTime();
    const prod = productsMap.get(mov.productId);
    if (filters.productId && filters.productId !== 'all' && mov.productId !== filters.productId) {
      continue;
    }
    if (filters.category && filters.category !== 'all' && prod?.category !== filters.category) {
      continue;
    }

    if (movMs < windowStartMs || movMs > windowEndMs) continue;

    const units = Math.abs(mov.quantityChange);
    const unitCost =
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
    const val = roundCurrencyValue(units * unitCost);

    const summaryItem = movementSummaryMap.get(mov.type) || {
      count: 0,
      totalUnits: 0,
      estimatedValue: 0,
    };
    summaryItem.count += 1;
    summaryItem.totalUnits += units;
    summaryItem.estimatedValue = roundCurrencyValue(summaryItem.estimatedValue + val);
    movementSummaryMap.set(mov.type, summaryItem);

    if (mov.type === 'damage' || mov.type === 'loss') {
      shrinkageByProduct.set(mov.productId, (shrinkageByProduct.get(mov.productId) || 0) + units);
    } else if (mov.type === 'restock' && mov.receiptMode !== 'invoice_only') {
      restockByProduct.set(mov.productId, (restockByProduct.get(mov.productId) || 0) + units);
    } else if (mov.type === 'audit') {
      auditDeltaByProduct.set(
        mov.productId,
        (auditDeltaByProduct.get(mov.productId) || 0) + mov.quantityChange
      );
    }
  }

  const filteredCatalog = dataset.products.filter((p) => {
    if (filters.productId && filters.productId !== 'all' && p.id !== filters.productId) {
      return false;
    }
    if (filters.category && filters.category !== 'all' && p.category !== filters.category) {
      return false;
    }
    return true;
  });

  const rawItems: ProductInventoryAnalyticsItem[] = filteredCatalog.map((prod) => {
    const prices = getProductPricesInCurrency(prod, targetCurrency, liveRates);
    const prodSales = salesByProductMap.get(prod.id);

    const baseStockUnitsSold = baseStockUnitsSoldByProduct.get(prod.id) || 0;
    const returnedUnitsInPeriod = returnedUnitsByProduct.get(prod.id) || 0;

    const netBaseUnitsSold = Math.max(0, baseStockUnitsSold - returnedUnitsInPeriod);
    const unitsSoldInPeriod =
      netBaseUnitsSold > 0 ? netBaseUnitsSold : Math.max(0, prodSales?.unitsSold || 0);
    const netSalesInPeriod = prodSales?.netSales || 0;
    const cogsInPeriod = prodSales?.cogs ?? 0;
    const grossProfitInPeriod = prodSales?.grossProfit ?? 0;

    const currentStock = Math.max(0, prod.stock);
    const pendingInboundPurchaseUnits = pendingInboundByProduct.get(prod.id) || 0;
    const shrinkageUnits = shrinkageByProduct.get(prod.id) || 0;
    const restockedUnits = restockByProduct.get(prod.id) || 0;
    const auditDelta = auditDeltaByProduct.get(prod.id) || 0;

    const reconstructedBeginningStock = Math.max(
      0,
      currentStock + unitsSoldInPeriod - restockedUnits + shrinkageUnits - auditDelta
    );

    const averageStockUnits =
      Math.round(((reconstructedBeginningStock + currentStock) / 2) * 100) / 100;

    const inventoryValueAtCost = roundCurrencyValue(currentStock * prices.costPrice);
    const averageInventoryValueAtCost = roundCurrencyValue(
      averageStockUnits * prices.costPrice
    );
    const inventoryValueAtRetail = roundCurrencyValue(currentStock * prices.sellingPrice);

    const averageDailyDemand =
      Math.round((unitsSoldInPeriod / effectiveDemandDays) * 100) / 100;

    const costBasedStockTurnoverRatio =
      averageInventoryValueAtCost > 0
        ? Math.round((cogsInPeriod / averageInventoryValueAtCost) * 100) / 100
        : cogsInPeriod > 0 && prices.costPrice > 0
        ? Math.round(
            (cogsInPeriod /
              roundCurrencyValue(Math.max(1, unitsSoldInPeriod * 0.5) * prices.costPrice)) *
              100
          ) / 100
        : 0;

    const estimatedUnitSellThroughRatio =
      averageStockUnits > 0
        ? Math.round((unitsSoldInPeriod / averageStockUnits) * 100) / 100
        : unitsSoldInPeriod > 0
        ? 1
        : 0;

    const stockTurnoverRatio =
      costBasedStockTurnoverRatio !== null
        ? costBasedStockTurnoverRatio
        : estimatedUnitSellThroughRatio;

    const daysOfInventoryOnHand =
      averageDailyDemand > 0
        ? Math.round((currentStock / averageDailyDemand) * 10) / 10
        : null;

    const lastSaleMs = lastSaleByProduct.get(prod.id);
    const daysSinceLastSale =
      lastSaleMs !== undefined
        ? Math.max(0, Math.floor((referenceDate.getTime() - lastSaleMs) / (24 * 3600 * 1000)))
        : null;

    let stockStatus: ProductInventoryAnalyticsItem['stockStatus'] = 'healthy';
    if (currentStock <= 0) {
      stockStatus = 'out_of_stock';
    } else if (currentStock <= prod.minStockAlert) {
      stockStatus = 'low_stock';
    } else if (daysOfInventoryOnHand !== null && daysOfInventoryOnHand > 60) {
      stockStatus = 'overstock';
    }

    let movementVelocityClass: ProductInventoryAnalyticsItem['movementVelocityClass'] =
      'moderate_moving';
    if (unitsSoldInPeriod === 0) {
      movementVelocityClass = 'dead_stock';
    } else if (averageDailyDemand >= 1.0 || unitsSoldInPeriod >= 6) {
      movementVelocityClass = 'fast_moving';
    } else if (averageDailyDemand < 0.35) {
      movementVelocityClass = 'slow_moving';
    }

    const abcBasisValue =
      abcBasis === 'gross_profit'
        ? Math.max(0, grossProfitInPeriod)
        : abcBasis === 'consumption_value'
        ? Math.max(0, cogsInPeriod)
        : Math.max(0, netSalesInPeriod);

    const safetyStockUnits = Math.max(
      prod.minStockAlert,
      Math.ceil(averageDailyDemand * safetyStockDaysAssumed)
    );
    const leadTimeDemandUnits = Math.ceil(averageDailyDemand * leadTimeDaysAssumed);
    const reorderPointUnits = leadTimeDemandUnits + safetyStockUnits;

    const effectiveAvailableStock = currentStock + pendingInboundPurchaseUnits;
    const shouldReorder = effectiveAvailableStock <= reorderPointUnits;

    const targetCycleStock = Math.max(
      reorderPointUnits + Math.ceil(averageDailyDemand * 7),
      prod.minStockAlert * 2
    );
    const recommendedOrderQuantity = shouldReorder
      ? Math.max(1, targetCycleStock - effectiveAvailableStock)
      : 0;
    const estimatedOrderCost = roundCurrencyValue(recommendedOrderQuantity * prices.costPrice);

    let urgency: ProductInventoryAnalyticsItem['reorderRecommendation']['urgency'] = 'none';
    if (shouldReorder) {
      if (
        effectiveAvailableStock <= 0 ||
        (daysOfInventoryOnHand !== null && daysOfInventoryOnHand <= leadTimeDaysAssumed)
      ) {
        urgency = 'critical';
      } else if (effectiveAvailableStock <= prod.minStockAlert) {
        urgency = 'high';
      } else {
        urgency = 'medium';
      }
    }

    let estimatedStockoutDate: string | null = null;
    let daysUntilStockout: number | null = null;
    if (averageDailyDemand > 0) {
      daysUntilStockout = Math.max(
        0,
        Math.round((currentStock / averageDailyDemand) * 10) / 10
      );
      const stockoutDateObj = new Date(
        referenceDate.getTime() + daysUntilStockout * 24 * 3600 * 1000
      );
      estimatedStockoutDate = toDateKey(stockoutDateObj);
    }

    const explanationEn = shouldReorder
      ? `Available stock (${currentStock} on hand${pendingInboundPurchaseUnits > 0 ? ` + ${pendingInboundPurchaseUnits} inbound` : ''}) is at or below reorder threshold (${reorderPointUnits} units = ${leadTimeDaysAssumed}d lead time + ${safetyStockUnits} safety stock) at ${averageDailyDemand} units/day demand.`
      : `Available stock (${currentStock} on hand${pendingInboundPurchaseUnits > 0 ? ` + ${pendingInboundPurchaseUnits} inbound` : ''}) comfortably covers reorder point (${reorderPointUnits} units).`;

    const explanationAr = shouldReorder
      ? `الرصيد المتاح (${currentStock} بالمخزن${pendingInboundPurchaseUnits > 0 ? ` + ${pendingInboundPurchaseUnits} قيد التوريد` : ''}) وصل أو يقل عن نقطة إعادة الطلب (${reorderPointUnits} وحدة = ${leadTimeDaysAssumed} أيام توريد + ${safetyStockUnits} مخزون أمان) بمعدل سحب ${averageDailyDemand} وحدة/يوم.`
      : `الرصيد المتاح (${currentStock} بالمخزن${pendingInboundPurchaseUnits > 0 ? ` + ${pendingInboundPurchaseUnits} قيد التوريد` : ''}) يغطي نقطة إعادة الطلب (${reorderPointUnits} وحدة) بأمان.`;

    return {
      productId: prod.id,
      sku: prod.sku,
      name: prod.name,
      nameAr: prod.nameAr,
      category: prod.category,
      categoryAr: prod.categoryAr,
      currentStock,
      reconstructedBeginningStock,
      averageStockUnits,
      pendingInboundPurchaseUnits,
      minStockAlert: prod.minStockAlert,
      unitCost: prices.costPrice,
      unitSellingPrice: prices.sellingPrice,
      inventoryValueAtCost,
      averageInventoryValueAtCost,
      inventoryValueAtRetail,
      unitsSoldInPeriod,
      netSalesInPeriod,
      cogsInPeriod,
      grossProfitInPeriod,
      averageDailyDemand,
      costBasedStockTurnoverRatio,
      estimatedUnitSellThroughRatio,
      stockTurnoverRatio,
      turnoverFormulaUsed: 'cogs_over_reconstructed_avg_inventory_cost',
      daysOfInventoryOnHand,
      daysSinceLastSale,
      stockStatus,
      movementVelocityClass,
      abcClass: 'C',
      abcBasisValue,
      abcCumulativeSharePercent: 100,
      shrinkageUnitsInPeriod: shrinkageUnits,
      restockedUnitsInPeriod: restockedUnits,
      reorderRecommendation: {
        shouldReorder,
        urgency,
        reorderPointUnits,
        safetyStockUnits,
        leadTimeDaysAssumed,
        pendingInboundUnitsDeducted: pendingInboundPurchaseUnits,
        recommendedOrderQuantity,
        estimatedOrderCost,
        estimatedStockoutDate,
        daysUntilStockout,
        explanationEn,
        explanationAr,
        approvalStatus: 'requires_user_approval',
      },
    };
  });

  const sortedForAbc = [...rawItems].sort(
    (a, b) =>
      b.abcBasisValue - a.abcBasisValue ||
      (b.inventoryValueAtCost ?? 0) - (a.inventoryValueAtCost ?? 0)
  );

  const totalAbcValue = sortedForAbc.reduce((acc, it) => acc + it.abcBasisValue, 0);
  let cumulativeValue = 0;

  let classACount = 0;
  let classBCount = 0;
  let classCCount = 0;
  let classAVal = 0;
  let classBVal = 0;
  let classCVal = 0;

  for (let i = 0; i < sortedForAbc.length; i++) {
    const item = sortedForAbc[i];
    const prevCumPct = totalAbcValue > 0 ? (cumulativeValue / totalAbcValue) * 100 : 100;
    cumulativeValue += item.abcBasisValue;
    const cumPct =
      totalAbcValue > 0
        ? Math.min(100, Math.round((cumulativeValue / totalAbcValue) * 1000) / 10)
        : 100;
    item.abcCumulativeSharePercent = cumPct;

    if (item.abcBasisValue > 0 && (prevCumPct < 75 || i === 0)) {
      item.abcClass = 'A';
      classACount += 1;
      classAVal += item.abcBasisValue;
    } else if (item.abcBasisValue > 0 && prevCumPct < 92) {
      item.abcClass = 'B';
      classBCount += 1;
      classBVal += item.abcBasisValue;
    } else {
      item.abcClass = 'C';
      classCCount += 1;
      classCVal += item.abcBasisValue;
    }
  }

  const totalSkus = sortedForAbc.length;
  const totalStockUnits = sortedForAbc.reduce((acc, it) => acc + it.currentStock, 0);
  const totalPendingInboundUnits = sortedForAbc.reduce(
    (acc, it) => acc + it.pendingInboundPurchaseUnits,
    0
  );
  const totalInventoryValueAtCost = roundCurrencyValue(
    sortedForAbc.reduce((acc, it) => acc + (it.inventoryValueAtCost ?? 0), 0)
  );
  const totalAverageInventoryValueAtCost = roundCurrencyValue(
    sortedForAbc.reduce((acc, it) => acc + (it.averageInventoryValueAtCost ?? 0), 0)
  );
  const totalInventoryValueAtRetail = roundCurrencyValue(
    sortedForAbc.reduce((acc, it) => acc + it.inventoryValueAtRetail, 0)
  );
  const totalCogs = roundCurrencyValue(
    sortedForAbc.reduce((acc, it) => acc + (it.cogsInPeriod ?? 0), 0)
  );
  const totalUnitsSold = sortedForAbc.reduce((acc, it) => acc + it.unitsSoldInPeriod, 0);
  const totalAvgUnits = sortedForAbc.reduce((acc, it) => acc + it.averageStockUnits, 0);

  const overallCostBasedTurnoverRatio =
    totalAverageInventoryValueAtCost > 0
      ? Math.round((totalCogs / totalAverageInventoryValueAtCost) * 100) / 100
      : 0;

  const overallUnitSellThroughRatio =
    totalAvgUnits > 0 ? Math.round((totalUnitsSold / totalAvgUnits) * 100) / 100 : 0;

  const overallStockTurnoverRatio = overallCostBasedTurnoverRatio;

  const totalDailyDemand = sortedForAbc.reduce((acc, it) => acc + it.averageDailyDemand, 0);
  const overallDaysOfInventoryOnHand =
    totalDailyDemand > 0 ? Math.round((totalStockUnits / totalDailyDemand) * 10) / 10 : null;

  const shrinkageStat = movementSummaryMap.get('damage') || {
    count: 0,
    totalUnits: 0,
    estimatedValue: 0,
  };
  const lossStat = movementSummaryMap.get('loss') || {
    count: 0,
    totalUnits: 0,
    estimatedValue: 0,
  };
  const restockStat = movementSummaryMap.get('restock') || {
    count: 0,
    totalUnits: 0,
    estimatedValue: 0,
  };

  return {
    currency: targetCurrency,
    costAccessStatus: 'authorized',
    abcBasis,
    leadTimeDaysAssumed,
    safetyStockDaysAssumed,
    valuationMethod: 'standard_unit_cost_replacement',
    turnoverCalculationBasis: 'reconstructed_average_inventory_cost',
    turnoverMethodologyNoteEn:
      'Cost-based turnover is computed as COGS ÷ Reconstructed Average Inventory Value at Cost ((Beginning + Ending) / 2). Unit sell-through ratio is reported separately.',
    turnoverMethodologyNoteAr:
      'يُحسب معدل دوران المخزون المالي بقسمة تكلفة البضاعة المباعة على متوسط قيمة المخزون بالتكلفة ((الافتتاحي + الختامي) ÷ 2)، مع عرض نسبة تصريف الوحدات بشكل مستقل.',
    valuationMethodNoteEn:
      'Inventory is valued using each product’s current unit cost (Standard / Replacement Cost method), converted to the active reporting currency.',
    valuationMethodNoteAr:
      'يتم تقييم المخزون باستخدام تكلفة الوحدة القياسية/الحالية لكل منتج محولة إلى عملة التقرير النشطة.',
    summary: {
      totalSkus,
      totalStockUnits,
      totalPendingInboundUnits,
      totalInventoryValueAtCost,
      totalAverageInventoryValueAtCost,
      totalInventoryValueAtRetail,
      overallCostBasedTurnoverRatio,
      overallUnitSellThroughRatio,
      overallStockTurnoverRatio,
      overallDaysOfInventoryOnHand,
      healthySkusCount: sortedForAbc.filter((i) => i.stockStatus === 'healthy').length,
      lowStockSkusCount: sortedForAbc.filter((i) => i.stockStatus === 'low_stock').length,
      outOfStockSkusCount: sortedForAbc.filter((i) => i.stockStatus === 'out_of_stock').length,
      overstockSkusCount: sortedForAbc.filter((i) => i.stockStatus === 'overstock').length,
      fastMovingCount: sortedForAbc.filter((i) => i.movementVelocityClass === 'fast_moving')
        .length,
      slowMovingCount: sortedForAbc.filter((i) => i.movementVelocityClass === 'slow_moving')
        .length,
      deadStockCount: sortedForAbc.filter((i) => i.movementVelocityClass === 'dead_stock').length,
      shrinkageUnitsTotal: shrinkageStat.totalUnits + lossStat.totalUnits,
      shrinkageCostTotal: roundCurrencyValue(
        shrinkageStat.estimatedValue + lossStat.estimatedValue
      ),
      restockUnitsTotal: restockStat.totalUnits,
      restockCostTotal: restockStat.estimatedValue,
      reorderActionRequiredCount: sortedForAbc.filter(
        (i) => i.reorderRecommendation.shouldReorder
      ).length,
      totalRecommendedOrderCost: roundCurrencyValue(
        sortedForAbc.reduce(
          (acc, i) => acc + (i.reorderRecommendation.estimatedOrderCost ?? 0),
          0
        )
      ),
    },
    abcSummary: {
      classA: {
        count: classACount,
        valueSharePercent:
          totalAbcValue > 0 ? Math.round((classAVal / totalAbcValue) * 1000) / 10 : 0,
        skuSharePercent: totalSkus > 0 ? Math.round((classACount / totalSkus) * 1000) / 10 : 0,
      },
      classB: {
        count: classBCount,
        valueSharePercent:
          totalAbcValue > 0 ? Math.round((classBVal / totalAbcValue) * 1000) / 10 : 0,
        skuSharePercent: totalSkus > 0 ? Math.round((classBCount / totalSkus) * 1000) / 10 : 0,
      },
      classC: {
        count: classCCount,
        valueSharePercent:
          totalAbcValue > 0 ? Math.round((classCVal / totalAbcValue) * 1000) / 10 : 0,
        skuSharePercent: totalSkus > 0 ? Math.round((classCCount / totalSkus) * 1000) / 10 : 0,
      },
    },
    products: sortedForAbc,
    recentMovementsSummary: Array.from(movementSummaryMap.entries()).map(([type, stat]) => ({
      type,
      count: stat.count,
      totalUnits: stat.totalUnits,
      estimatedValue: stat.estimatedValue,
    })),
  };
}
