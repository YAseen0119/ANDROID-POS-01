/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  convertCurrencyAmount,
  DEFAULT_BASELINE_EXCHANGE_RATES,
  getConvertedTransactionView,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import { Product } from '../../lib/types';
import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  BranchAnalyticsResult,
  BranchPerformanceItem,
  CustomerAnalyticsItem,
  CustomerAnalyticsResult,
} from '../analytics.types';
import {
  filterTransactionsByScope,
  resolveAnalyticsDateWindow,
  resolveHistoricalLineItemCost,
  resolveReturnsForTransaction,
  resolveTransactionBranch,
} from './sales.metrics';

/**
 * Computes Customer Analytics (RFM/retention segmentation, top buyers, credit/debt exposure),
 * deducting returned invoice amounts for exact reconciliation.
 */
export function computeCustomerAnalytics(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  referenceDate: Date = new Date()
): CustomerAnalyticsResult {
  const targetCurrency = filters.currency || 'SDG';
  const valuationMode = filters.valuationMode || 'historical';
  const anchorCurrency = filters.anchorCurrency || 'USD';
  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(dataset.exchangeRates || {}),
    SDG: 1,
  };

  const window = resolveAnalyticsDateWindow(filters, referenceDate);
  const productsMap = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));

  const scopedTx = filterTransactionsByScope(
    dataset.transactions,
    productsMap,
    dataset.branches,
    filters
  ).filter((tx) => {
    const tMs = new Date(tx.timestamp).getTime();
    return (
      tx.status === 'completed' &&
      tMs >= window.startDate.getTime() &&
      tMs <= window.endDate.getTime()
    );
  });

  const customerStatsMap = new Map<
    string,
    {
      periodCount: number;
      periodNetSpend: number;
      periodBilledTotal: number;
      outstandingDebt: number;
      lastPurchaseMs: number | null;
    }
  >();

  for (const c of dataset.customers) {
    customerStatsMap.set(c.id, {
      periodCount: 0,
      periodNetSpend: 0,
      periodBilledTotal: 0,
      outstandingDebt: 0,
      lastPurchaseMs: null,
    });
  }

  let walkInTransactionsCount = 0;
  let registeredCustomerTransactionsCount = 0;
  let registeredNetRevenue = 0;
  let totalNetRevenue = 0;

  for (const tx of scopedTx) {
    const view = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      valuationMode,
      anchorCurrency
    );

    const txReturns = resolveReturnsForTransaction(tx, dataset.returns || []);
    let rawRefundInTxCurrency = 0;
    for (const ret of txReturns) {
      if (Array.isArray(ret.items) && ret.items.length > 0) {
        for (const ri of ret.items) {
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

    const txToTargetFactor = tx.grandTotal > 0 ? view.grandTotal / tx.grandTotal : 1;
    const grossReturnBilled = Math.min(
      view.grandTotal,
      roundCurrencyValue(rawRefundInTxCurrency * txToTargetFactor)
    );
    const txNetBeforeReturn = Math.max(
      0,
      roundCurrencyValue(view.subtotal - view.discountAmount)
    );
    const netToBilledRatio =
      view.grandTotal > 0 ? txNetBeforeReturn / view.grandTotal : 1;
    const netReturnAmount = roundCurrencyValue(grossReturnBilled * netToBilledRatio);

    const txNet = Math.max(
      0,
      roundCurrencyValue(txNetBeforeReturn - netReturnAmount)
    );
    const txBilledNet = Math.max(
      0,
      roundCurrencyValue(view.grandTotal - grossReturnBilled)
    );

    totalNetRevenue = roundCurrencyValue(totalNetRevenue + txNet);

    if (tx.customerId && customerStatsMap.has(tx.customerId)) {
      registeredCustomerTransactionsCount += 1;
      registeredNetRevenue = roundCurrencyValue(registeredNetRevenue + txNet);

      const stat = customerStatsMap.get(tx.customerId)!;
      stat.periodCount += 1;
      stat.periodNetSpend = roundCurrencyValue(stat.periodNetSpend + txNet);
      stat.periodBilledTotal = roundCurrencyValue(stat.periodBilledTotal + txBilledNet);
      const remainingDebt = Math.max(
        0,
        roundCurrencyValue(
          view.debtAmount - Math.max(0, grossReturnBilled - view.amountPaid)
        )
      );
      stat.outstandingDebt = roundCurrencyValue(stat.outstandingDebt + remainingDebt);
      const tMs = new Date(tx.timestamp).getTime();
      if (!isNaN(tMs) && (stat.lastPurchaseMs === null || tMs > stat.lastPurchaseMs)) {
        stat.lastPurchaseMs = tMs;
      }
    } else {
      walkInTransactionsCount += 1;
    }
  }

  for (const tx of dataset.transactions) {
    if (tx.status !== 'completed' || !tx.customerId || !customerStatsMap.has(tx.customerId)) {
      continue;
    }
    const tMs = new Date(tx.timestamp).getTime();
    const stat = customerStatsMap.get(tx.customerId)!;
    if (!isNaN(tMs) && (stat.lastPurchaseMs === null || tMs > stat.lastPurchaseMs)) {
      stat.lastPurchaseMs = tMs;
    }
    if (tMs < window.startDate.getTime() || tMs > window.endDate.getTime()) {
      const view = getConvertedTransactionView(
        tx,
        targetCurrency,
        liveRates,
        valuationMode,
        anchorCurrency
      );
      stat.outstandingDebt = roundCurrencyValue(stat.outstandingDebt + view.debtAmount);
    }
  }

  const segmentLabels: Record<
    CustomerAnalyticsItem['segment'],
    { en: string; ar: string }
  > = {
    vip_champion: { en: 'VIP Champion', ar: 'عميل مميز (VIP)' },
    repeat_loyal: { en: 'Repeat Loyal', ar: 'عميل دائم ومتكرر' },
    credit_risk: { en: 'Credit / Debt Follow-up', ar: 'مديونية تحتاج متابعة' },
    new_active: { en: 'New / Active Buyer', ar: 'عميل نشط حديثاً' },
    at_risk_inactive: { en: 'Inactive / At Risk', ar: 'غير نشط خلال الفترة' },
  };

  const customerItems: CustomerAnalyticsItem[] = dataset.customers.map((c) => {
    const stat = customerStatsMap.get(c.id)!;
    const baseLifetimeInTarget = convertCurrencyAmount(
      c.totalSpent || 0,
      'SDG',
      targetCurrency,
      liveRates
    );
    const lifetimeSpend = Math.max(stat.periodBilledTotal, baseLifetimeInTarget);
    const lifetimeTransactionCount = Math.max(stat.periodCount, c.transactionCount || 0);
    const averagePurchaseValue =
      stat.periodCount > 0
        ? roundCurrencyValue(stat.periodBilledTotal / stat.periodCount)
        : lifetimeTransactionCount > 0
        ? roundCurrencyValue(lifetimeSpend / lifetimeTransactionCount)
        : 0;

    const daysSinceLastPurchase =
      stat.lastPurchaseMs !== null
        ? Math.max(
            0,
            Math.floor((referenceDate.getTime() - stat.lastPurchaseMs) / (24 * 3600 * 1000))
          )
        : null;

    let segment: CustomerAnalyticsItem['segment'] = 'new_active';
    if (stat.outstandingDebt > 0 && stat.outstandingDebt >= stat.periodBilledTotal * 0.25) {
      segment = 'credit_risk';
    } else if (stat.periodCount >= 2 && stat.periodBilledTotal >= 50) {
      segment = 'vip_champion';
    } else if (stat.periodCount >= 2 || lifetimeTransactionCount >= 10) {
      segment = 'repeat_loyal';
    } else if (stat.periodCount === 0) {
      segment = 'at_risk_inactive';
    }

    return {
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      periodPurchaseCount: stat.periodCount,
      periodNetSpend: stat.periodNetSpend,
      periodBilledTotal: stat.periodBilledTotal,
      lifetimeSpend,
      lifetimeTransactionCount,
      averagePurchaseValue,
      outstandingDebt: stat.outstandingDebt,
      daysSinceLastPurchase,
      segment,
      segmentLabelEn: segmentLabels[segment].en,
      segmentLabelAr: segmentLabels[segment].ar,
    };
  });

  const activeCustomersInPeriod = customerItems.filter((c) => c.periodPurchaseCount > 0).length;
  const repeatCustomersCount = customerItems.filter(
    (c) => c.periodPurchaseCount >= 2 || c.lifetimeTransactionCount >= 2
  ).length;
  const repeatPurchaseRatePercent =
    dataset.customers.length > 0
      ? Math.round((repeatCustomersCount / dataset.customers.length) * 1000) / 10
      : 0;
  const registeredRevenueSharePercent =
    totalNetRevenue > 0
      ? Math.round((registeredNetRevenue / totalNetRevenue) * 1000) / 10
      : 0;
  const totalCustomerDebt = roundCurrencyValue(
    customerItems.reduce((acc, c) => acc + c.outstandingDebt, 0)
  );
  const customersWithDebtCount = customerItems.filter((c) => c.outstandingDebt > 0).length;
  const averageCustomerSpend =
    activeCustomersInPeriod > 0
      ? roundCurrencyValue(
          customerItems.reduce((acc, c) => acc + c.periodBilledTotal, 0) /
            activeCustomersInPeriod
        )
      : 0;

  const segmentationOrder: CustomerAnalyticsItem['segment'][] = [
    'vip_champion',
    'repeat_loyal',
    'credit_risk',
    'new_active',
    'at_risk_inactive',
  ];

  const segmentationCounts = segmentationOrder.map((seg) => {
    const matching = customerItems.filter((c) => c.segment === seg);
    return {
      segment: seg,
      labelEn: segmentLabels[seg].en,
      labelAr: segmentLabels[seg].ar,
      count: matching.length,
      totalSpend: roundCurrencyValue(
        matching.reduce((acc, c) => acc + c.periodBilledTotal, 0)
      ),
      totalDebt: roundCurrencyValue(
        matching.reduce((acc, c) => acc + c.outstandingDebt, 0)
      ),
    };
  });

  return {
    currency: targetCurrency,
    piiAccessStatus: 'authorized',
    summary: {
      totalRegisteredCustomers: dataset.customers.length,
      activeCustomersInPeriod,
      repeatCustomersCount,
      repeatPurchaseRatePercent,
      walkInTransactionsCount,
      registeredCustomerTransactionsCount,
      registeredRevenueSharePercent,
      totalCustomerDebt,
      customersWithDebtCount,
      averageCustomerSpend,
    },
    topCustomers: [...customerItems].sort(
      (a, b) => b.periodBilledTotal - a.periodBilledTotal || b.lifetimeSpend - a.lifetimeSpend
    ),
    creditExposureRanking: [...customerItems]
      .filter((c) => c.outstandingDebt > 0)
      .sort((a, b) => b.outstandingDebt - a.outstandingDebt),
    segmentationCounts,
  };
}

/**
 * Computes Multi-Branch Performance Comparison Analytics.
 */
export function computeBranchAnalytics(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  referenceDate: Date = new Date()
): BranchAnalyticsResult {
  const targetCurrency = filters.currency || 'SDG';
  const valuationMode = filters.valuationMode || 'historical';
  const anchorCurrency = filters.anchorCurrency || 'USD';
  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(dataset.exchangeRates || {}),
    SDG: 1,
  };

  const window = resolveAnalyticsDateWindow(filters, referenceDate);
  const productsMap = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));

  const branchStats = new Map<
    string,
    {
      branchId: string;
      branchName: string;
      branchNameAr: string;
      branchCode: string;
      grossSales: number;
      netSales: number;
      billedTotal: number;
      collectedTotal: number;
      cogs: number;
      transactionCount: number;
      unitsSold: number;
      outstandingDebt: number;
      cashiersSet: Set<string>;
    }
  >();

  for (const b of dataset.branches) {
    if (filters.branchId && filters.branchId !== 'all' && b.id !== filters.branchId) {
      continue;
    }
    branchStats.set(b.id, {
      branchId: b.id,
      branchName: b.name,
      branchNameAr: b.nameAr,
      branchCode: b.code,
      grossSales: 0,
      netSales: 0,
      billedTotal: 0,
      collectedTotal: 0,
      cogs: 0,
      transactionCount: 0,
      unitsSold: 0,
      outstandingDebt: 0,
      cashiersSet: new Set<string>(),
    });
  }

  for (const tx of dataset.transactions) {
    if (tx.status !== 'completed') continue;
    const tMs = new Date(tx.timestamp).getTime();
    if (tMs < window.startDate.getTime() || tMs > window.endDate.getTime()) continue;

    const branchInfo = resolveTransactionBranch(tx, dataset.branches);
    if (filters.branchId && filters.branchId !== 'all' && branchInfo.id !== filters.branchId) {
      continue;
    }

    const stat = branchStats.get(branchInfo.id);
    if (!stat) continue;

    const view = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      valuationMode,
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

    const txToTargetFactor = tx.grandTotal > 0 ? view.grandTotal / tx.grandTotal : 1;
    const grossReturnBilled = Math.min(
      view.grandTotal,
      roundCurrencyValue(rawRefundInTxCurrency * txToTargetFactor)
    );
    const txNetBeforeReturn = Math.max(
      0,
      roundCurrencyValue(view.subtotal - view.discountAmount)
    );
    const netToBilledRatio =
      view.grandTotal > 0 ? txNetBeforeReturn / view.grandTotal : 1;
    const netReturnAmount = roundCurrencyValue(grossReturnBilled * netToBilledRatio);

    const txNet = Math.max(
      0,
      roundCurrencyValue(txNetBeforeReturn - netReturnAmount)
    );
    let txCogs = 0;
    let txUnits = 0;

    for (const item of tx.items) {
      const prod = productsMap.get(item.productId);
      const costRes = resolveHistoricalLineItemCost(
        item,
        prod,
        tx.timestamp,
        targetCurrency,
        snapshotRates
      );
      const retQty = Math.min(
        item.quantity,
        returnedQtyByProduct.get(item.productId) || 0
      );
      const netQty = Math.max(0, item.quantity - retQty);
      txCogs = roundCurrencyValue(txCogs + costRes.unitCostResolved * netQty);
      txUnits += netQty;
    }

    stat.grossSales = roundCurrencyValue(stat.grossSales + view.subtotal);
    stat.netSales = roundCurrencyValue(stat.netSales + txNet);
    stat.billedTotal = roundCurrencyValue(
      stat.billedTotal + Math.max(0, view.grandTotal - grossReturnBilled)
    );
    stat.collectedTotal = roundCurrencyValue(
      stat.collectedTotal +
        Math.max(0, view.amountPaid - Math.min(view.amountPaid, grossReturnBilled))
    );
    stat.cogs = roundCurrencyValue(stat.cogs + txCogs);
    stat.transactionCount += 1;
    stat.unitsSold += txUnits;
    stat.outstandingDebt = roundCurrencyValue(
      stat.outstandingDebt +
        Math.max(0, view.debtAmount - Math.max(0, grossReturnBilled - view.amountPaid))
    );
    if (tx.cashierName) {
      stat.cashiersSet.add(tx.cashierName);
    }
  }

  const totalNetAcrossBranches = Array.from(branchStats.values()).reduce(
    (acc, b) => acc + b.netSales,
    0
  );

  const sortedBranches: BranchPerformanceItem[] = Array.from(branchStats.values())
    .map((b) => {
      const grossProfit = roundCurrencyValue(b.netSales - b.cogs);
      const grossMarginPercent =
        b.netSales > 0 ? Math.round((grossProfit / b.netSales) * 1000) / 10 : 0;
      const averageTransactionValue =
        b.transactionCount > 0 ? roundCurrencyValue(b.netSales / b.transactionCount) : 0;
      const collectionRatePercent =
        b.billedTotal > 0 ? Math.round((b.collectedTotal / b.billedTotal) * 1000) / 10 : 100;
      const revenueSharePercent =
        totalNetAcrossBranches > 0
          ? Math.round((b.netSales / totalNetAcrossBranches) * 1000) / 10
          : 0;

      return {
        branchId: b.branchId,
        branchName: b.branchName,
        branchNameAr: b.branchNameAr,
        branchCode: b.branchCode,
        grossSales: b.grossSales,
        netSales: b.netSales,
        cogs: b.cogs,
        grossProfit,
        grossMarginPercent,
        transactionCount: b.transactionCount,
        unitsSold: b.unitsSold,
        averageTransactionValue,
        outstandingDebt: b.outstandingDebt,
        collectionRatePercent,
        activeCashiersCount: Math.max(1, b.cashiersSet.size),
        revenueSharePercent,
        rank: 1,
      };
    })
    .sort((a, b) => b.netSales - a.netSales);

  sortedBranches.forEach((b, idx) => {
    b.rank = idx + 1;
  });

  return {
    currency: targetCurrency,
    costAccessStatus: 'authorized',
    branches: sortedBranches,
    topBranchId: sortedBranches[0]?.branchId || null,
  };
}
