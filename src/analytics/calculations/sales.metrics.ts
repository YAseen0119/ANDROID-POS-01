/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  convertCurrencyAmount,
  DEFAULT_BASELINE_EXCHANGE_RATES,
  formatPaymentMethodLabel,
  getConvertedTransactionView,
  getProductPackaging,
  getProductPricesInCurrency,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import { PaymentMethod, Product, Transaction } from '../../lib/types';
import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  CogsDataQualityStatus,
  DailyIntradayCandlestick,
  HourlySalesBucket,
  ReturnRecordInput,
  SalesAnalyticsResult,
  SalesByDimensionItem,
  WeekdaySalesBucket,
} from '../analytics.types';

export interface ResolvedDateWindow {
  startDate: Date;
  endDate: Date;
  prevStartDate: Date;
  prevEndDate: Date;
  calendarDays: number;
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolves the active date window and its corresponding prior-period comparison window.
 */
export function resolveAnalyticsDateWindow(
  filters: AnalyticsFilterParams,
  referenceDate: Date = new Date()
): ResolvedDateWindow {
  const preset = filters.datePreset || '30d';
  const end = filters.endDate ? new Date(filters.endDate) : new Date(referenceDate);
  if (isNaN(end.getTime())) {
    end.setTime(referenceDate.getTime());
  }
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setHours(0, 0, 0, 0);

  if (preset === 'custom' && filters.startDate) {
    const customStart = new Date(filters.startDate);
    if (!isNaN(customStart.getTime())) {
      start.setTime(customStart.getTime());
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(end.getDate() - 29);
    }
  } else if (preset === 'today') {
    // Same day 00:00 to 23:59
  } else if (preset === 'yesterday') {
    start.setDate(end.getDate() - 1);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (preset === '7d') {
    start.setDate(end.getDate() - 6);
  } else if (preset === '30d') {
    start.setDate(end.getDate() - 29);
  } else if (preset === '90d') {
    start.setDate(end.getDate() - 89);
  } else if (preset === 'mtd') {
    start.setDate(1);
  } else if (preset === 'ytd') {
    start.setMonth(0, 1);
  } else {
    start.setDate(end.getDate() - 29);
  }

  if (start.getTime() > end.getTime()) {
    const tmp = start.getTime();
    start.setTime(end.getTime());
    start.setHours(0, 0, 0, 0);
    end.setTime(tmp);
    end.setHours(23, 59, 59, 999);
  }

  const durationMs = Math.max(24 * 3600 * 1000, end.getTime() - start.getTime() + 1);
  const calendarDays = Math.max(1, Math.round(durationMs / (24 * 3600 * 1000)));

  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs + 1);
  prevStart.setHours(0, 0, 0, 0);

  return {
    startDate: start,
    endDate: end,
    prevStartDate: prevStart,
    prevEndDate: prevEnd,
    calendarDays,
  };
}

/**
 * Resolves the branch ID for a transaction based on its cashier/terminal name or branch metadata.
 */
export function resolveTransactionBranch(
  tx: Transaction,
  branches: AnalyticsDatasetSnapshot['branches']
): { id: string; name: string; nameAr: string } {
  const explicitBranchId = (tx as any).branchId;
  if (explicitBranchId) {
    const found = branches.find((b) => b.id === explicitBranchId);
    if (found) return { id: found.id, name: found.name, nameAr: found.nameAr };
  }
  const cashier = (tx.cashierName || 'POS Terminal 01').trim();
  for (const b of branches) {
    if (
      b.id === cashier ||
      b.terminalNames.some((t) => t.toLowerCase() === cashier.toLowerCase())
    ) {
      return { id: b.id, name: b.name, nameAr: b.nameAr };
    }
  }
  const fallback = branches[0] || {
    id: 'branch-main',
    name: 'Main Store Branch - Khartoum',
    nameAr: 'الفرع الرئيسي - الخرطوم',
  };
  return { id: fallback.id, name: fallback.name, nameAr: fallback.nameAr };
}

export interface HistoricalCostResolution {
  lineCost: number;
  unitCostResolved: number;
  quality: Exclude<CogsDataQualityStatus, 'mixed_historical_and_estimated'>;
}

/**
 * Resolves the COGS for a single line item at `txTimestamp` without ever inventing arbitrary cost ratios.
 * Priority:
 * 1. `exact_frozen_at_sale`: Item-level frozen cost (`unitCostAtSale` / `unitCost`) if present on the sale item.
 * 2. `reconstructed_from_price_history`: Reconstructs historical cost at `txTimestamp` from `product.priceHistory[]`.
 * 3. `estimated_from_current_catalog_cost`: Uses current `product.costPrice` / `packCostPrice` and explicitly marks as estimated.
 * 4. `incomplete_missing_cost`: If product or cost is missing, returns 0 and flags as incomplete (never invents 45%).
 */
export function resolveHistoricalLineItemCost(
  item: Transaction['items'][number],
  product: Product | undefined,
  txTimestamp: string,
  targetCurrency: string,
  rates: Record<string, number>
): HistoricalCostResolution {
  const rawItem = item as any;
  const isPackSale = item.saleUnit === 'pack';

  // 1. Check frozen cost on sale item at checkout time
  const frozenUnitCost =
    typeof rawItem.unitCostAtSale === 'number' && rawItem.unitCostAtSale > 0
      ? rawItem.unitCostAtSale
      : typeof rawItem.unitCost === 'number' && rawItem.unitCost > 0
      ? rawItem.unitCost
      : null;

  if (frozenUnitCost !== null) {
    const itemCurrency = (
      rawItem.costCurrency ||
      product?.priceCurrency ||
      'SDG'
    )
      .toString()
      .toUpperCase();
    const convertedUnit = convertCurrencyAmount(
      frozenUnitCost,
      itemCurrency,
      targetCurrency,
      rates
    );
    return {
      lineCost: roundCurrencyValue(convertedUnit * item.quantity),
      unitCostResolved: convertedUnit,
      quality: 'exact_frozen_at_sale',
    };
  }

  // 2. If product is missing from catalog, never fabricate a 45% cost ratio
  if (!product || !(product.costPrice > 0 || (product.packCostPrice && product.packCostPrice > 0))) {
    return {
      lineCost: 0,
      unitCostResolved: 0,
      quality: 'incomplete_missing_cost',
    };
  }

  const pkg = getProductPackaging(product);
  const prodCurrency = (
    product.priceCurrency ||
    product.customFields?.priceCurrency ||
    'SDG'
  )
    .toString()
    .toUpperCase();

  // 3. Reconstruct from product.priceHistory[] if available
  const history = Array.isArray(product.priceHistory) ? product.priceHistory : [];
  const txMs = new Date(txTimestamp).getTime();

  if (history.length > 0 && !isNaN(txMs)) {
    const sortedHist = [...history]
      .filter((h) => h && !isNaN(new Date(h.timestamp).getTime()))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (sortedHist.length > 0) {
      let historicalBaseUnitCost = product.costPrice;
      const firstChangeMs = new Date(sortedHist[0].timestamp).getTime();

      if (txMs < firstChangeMs && sortedHist[0].previousCostPrice > 0) {
        historicalBaseUnitCost = sortedHist[0].previousCostPrice;
      } else {
        for (const h of sortedHist) {
          const hMs = new Date(h.timestamp).getTime();
          if (txMs >= hMs && h.newCostPrice > 0) {
            historicalBaseUnitCost = h.newCostPrice;
          }
        }
      }

      const histCurrency = (sortedHist[0].currency || prodCurrency).toUpperCase();
      const effectiveSourceCost = isPackSale
        ? historicalBaseUnitCost * (pkg.unitsPerPack > 1 ? pkg.unitsPerPack : 1)
        : historicalBaseUnitCost;
      const convertedUnitCost = convertCurrencyAmount(
        effectiveSourceCost,
        histCurrency,
        targetCurrency,
        rates
      );
      return {
        lineCost: roundCurrencyValue(convertedUnitCost * item.quantity),
        unitCostResolved: convertedUnitCost,
        quality: 'reconstructed_from_price_history',
      };
    }
  }

  // 4. Fallback to current catalog cost (explicitly flagged as estimated_from_current_catalog_cost)
  const prices = getProductPricesInCurrency(product, targetCurrency, rates);
  const currentUnitCost =
    isPackSale && prices.packCostPrice > 0 ? prices.packCostPrice : prices.costPrice;

  return {
    lineCost: roundCurrencyValue(currentUnitCost * item.quantity),
    unitCostResolved: currentUnitCost,
    quality: 'estimated_from_current_catalog_cost',
  };
}

/**
 * Legacy helper wrapper for callers needing just the numeric cost.
 */
export function computeLineItemCostInCurrency(
  item: Transaction['items'][number],
  product: Product | undefined,
  targetCurrency: string,
  rates: Record<string, number>,
  txTimestamp: string = new Date().toISOString()
): number {
  return resolveHistoricalLineItemCost(item, product, txTimestamp, targetCurrency, rates)
    .lineCost;
}

/**
 * Detects whether a transaction was calculated using tax-inclusive pricing
 * (where subtotal - discountAmount already includes taxAmount, so grandTotal == subtotal - discountAmount).
 */
export function isTransactionTaxInclusive(tx: Transaction): boolean {
  if ((tx as any).isTaxInclusive === true) return true;
  if ((tx as any).isTaxInclusive === false) return false;
  if (tx.taxAmount <= 0) return false;

  const netSub = Math.max(0, roundCurrencyValue(tx.subtotal - (tx.discountAmount || 0)));
  const diffInclusive = Math.abs(netSub - tx.grandTotal);
  const diffExclusive = Math.abs(netSub + tx.taxAmount - tx.grandTotal);

  return diffInclusive <= 0.05 && diffInclusive < diffExclusive;
}

const returnsIndexCache = new WeakMap<
  ReturnRecordInput[],
  Map<string, ReturnRecordInput[]>
>();

function getIndexedReturnsMap(
  datasetReturns: ReturnRecordInput[]
): Map<string, ReturnRecordInput[]> {
  let indexed = returnsIndexCache.get(datasetReturns);
  if (!indexed) {
    indexed = new Map<string, ReturnRecordInput[]>();
    for (const r of datasetReturns) {
      if (r && r.saleId) {
        const list = indexed.get(r.saleId);
        if (list) {
          list.push(r);
        } else {
          indexed.set(r.saleId, [r]);
        }
      }
    }
    returnsIndexCache.set(datasetReturns, indexed);
  }
  return indexed;
}

/**
 * Aggregates and deduplicates all merchandise returns associated with a transaction in O(1) via WeakMap index.
 */
export function resolveReturnsForTransaction(
  tx: Transaction,
  datasetReturns: ReturnRecordInput[]
): ReturnRecordInput[] {
  const byId = new Map<string, ReturnRecordInput>();
  if (Array.isArray(datasetReturns) && datasetReturns.length > 0) {
    const matching = getIndexedReturnsMap(datasetReturns).get(tx.id);
    if (matching) {
      for (const r of matching) {
        byId.set(r.id, r);
      }
    }
  }
  const inlineReturns = (tx as any).returns as ReturnRecordInput[] | undefined;
  if (Array.isArray(inlineReturns)) {
    for (const r of inlineReturns) {
      if (r && r.id) {
        byId.set(r.id, { ...r, saleId: tx.id });
      }
    }
  }
  return byId.size > 0 ? Array.from(byId.values()) : [];
}

/**
 * Matches a converted view line item to its exact original transaction line item (`tx.items[idx]`)
 * using line index, line-item ID, or composite key (`productId`, `sku`, `saleUnit`, `quantity`, `discountPercent`)
 * while tracking consumed indices so mixed `pack` and `unit` lines for the same SKU on the same invoice
 * never collide (Fixes INV-10 / FIN-09).
 */
export function resolveOriginalSaleLineItem(
  viewItem: Transaction['items'][number],
  viewIdx: number,
  origItems: Transaction['items'],
  consumedIndices: Set<number>
): Transaction['items'][number] {
  const normUnit = (u?: string) => (u === 'pack' ? 'pack' : 'unit');
  const targetUnit = normUnit(viewItem.saleUnit);

  // 1. Direct index correspondence (getConvertedTransactionView maps tx.items 1-to-1)
  const direct = origItems[viewIdx];
  if (
    direct &&
    !consumedIndices.has(viewIdx) &&
    direct.productId === viewItem.productId &&
    normUnit(direct.saleUnit) === targetUnit &&
    direct.quantity === viewItem.quantity
  ) {
    consumedIndices.add(viewIdx);
    return direct;
  }

  // 2. Stable line-item ID if present
  const viewLineId = (viewItem as any).id || (viewItem as any).lineId;
  if (viewLineId) {
    for (let i = 0; i < origItems.length; i++) {
      if (consumedIndices.has(i)) continue;
      const cand = origItems[i] as any;
      if ((cand.id && cand.id === viewLineId) || (cand.lineId && cand.lineId === viewLineId)) {
        consumedIndices.add(i);
        return origItems[i];
      }
    }
  }

  // 3. Exact composite key match (productId + sku + saleUnit + quantity + discountPercent)
  for (let i = 0; i < origItems.length; i++) {
    if (consumedIndices.has(i)) continue;
    const cand = origItems[i];
    if (
      cand.productId === viewItem.productId &&
      cand.sku === viewItem.sku &&
      normUnit(cand.saleUnit) === targetUnit &&
      cand.quantity === viewItem.quantity &&
      (cand.discountPercent || 0) === (viewItem.discountPercent || 0)
    ) {
      consumedIndices.add(i);
      return cand;
    }
  }

  // 4. Fallback composite match on productId + saleUnit
  for (let i = 0; i < origItems.length; i++) {
    if (consumedIndices.has(i)) continue;
    const cand = origItems[i];
    if (cand.productId === viewItem.productId && normUnit(cand.saleUnit) === targetUnit) {
      consumedIndices.add(i);
      return cand;
    }
  }

  return viewItem;
}

/**
 * Filters transactions matching branch, customer, cashier, paymentMethod, category, and product filters.
 */
export function filterTransactionsByScope(
  transactions: Transaction[],
  productsMap: Map<string, Product>,
  branches: AnalyticsDatasetSnapshot['branches'],
  filters: AnalyticsFilterParams
): Transaction[] {
  return transactions.filter((tx) => {
    if (!tx || !tx.timestamp) return false;

    if (filters.branchId && filters.branchId !== 'all') {
      const branch = resolveTransactionBranch(tx, branches);
      if (branch.id !== filters.branchId && tx.cashierName !== filters.branchId) {
        return false;
      }
    }

    if (filters.cashierName && filters.cashierName !== 'all') {
      if ((tx.cashierName || '').toLowerCase() !== filters.cashierName.toLowerCase()) {
        return false;
      }
    }

    if (filters.customerId && filters.customerId !== 'all') {
      if (tx.customerId !== filters.customerId) {
        return false;
      }
    }

    if (filters.paymentMethod && filters.paymentMethod !== 'all') {
      const normalizedTxMethod = tx.paymentMethod === 'card' ? 'bank_transfer' : tx.paymentMethod;
      const normalizedFilter =
        filters.paymentMethod === 'card' ? 'bank_transfer' : filters.paymentMethod;
      if (normalizedTxMethod !== normalizedFilter && tx.paymentMethod !== filters.paymentMethod) {
        return false;
      }
    }

    if (
      (filters.productId && filters.productId !== 'all') ||
      (filters.category && filters.category !== 'all')
    ) {
      const hasMatchingItem = tx.items.some((item) => {
        if (filters.productId && filters.productId !== 'all' && item.productId !== filters.productId) {
          return false;
        }
        if (filters.category && filters.category !== 'all') {
          const prod = productsMap.get(item.productId);
          if (!prod || prod.category !== filters.category) {
            return false;
          }
        }
        return true;
      });
      if (!hasMatchingItem) return false;
    }

    return true;
  });
}

/**
 * Combines individual line-item COGS data quality flags into an overall status.
 */
function combineCogsQualities(
  qualities: Set<Exclude<CogsDataQualityStatus, 'mixed_historical_and_estimated'>>
): CogsDataQualityStatus {
  if (qualities.size === 0) return 'exact_frozen_at_sale';
  if (qualities.has('incomplete_missing_cost')) return 'incomplete_missing_cost';
  if (qualities.size === 1) {
    return Array.from(qualities)[0];
  }
  return 'mixed_historical_and_estimated';
}

/**
 * Computes comprehensive Sales Analytics across the active filter window with strict
 * separation of voided invoices vs merchandise returns, tax-inclusive vs tax-exclusive math,
 * and historical COGS quality tracking.
 */
export function computeSalesAnalytics(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  referenceDate: Date = new Date()
): SalesAnalyticsResult {
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

  const scopedAllDates = filterTransactionsByScope(
    dataset.transactions,
    productsMap,
    dataset.branches,
    filters
  );

  const inCurrentWindow = scopedAllDates.filter((tx) => {
    const t = new Date(tx.timestamp).getTime();
    return t >= window.startDate.getTime() && t <= window.endDate.getTime();
  });

  const inPrevWindow = scopedAllDates.filter((tx) => {
    const t = new Date(tx.timestamp).getTime();
    return t >= window.prevStartDate.getTime() && t <= window.prevEndDate.getTime();
  });

  let grossSales = 0;
  let discountsTotal = 0;
  let merchandiseReturnsNetSales = 0;
  let merchandiseReturnsTax = 0;
  let merchandiseReturnsBilledTotal = 0;
  let merchandiseReturnsCount = 0;
  let netSales = 0;
  let taxCollected = 0;
  let billedGrandTotal = 0;
  let voidedSalesAmount = 0;
  let voidedTransactionCount = 0;
  let completedCount = 0;
  let grossUnitsSoldBeforeReturns = 0;
  let returnedUnitsCount = 0;

  const overallQualities = new Set<
    Exclude<CogsDataQualityStatus, 'mixed_historical_and_estimated'>
  >();

  // Daily buckets across the entire date window
  const dailyMap = new Map<
    string,
    {
      date: Date;
      grossSales: number;
      netSales: number;
      billedGrandTotal: number;
      discounts: number;
      returnsNet: number;
      tax: number;
      cogs: number;
      grossProfit: number;
      transactionCount: number;
      unitsSold: number;
      hourlyNetSales: Map<number, number>;
    }
  >();

  for (let i = 0; i < window.calendarDays; i++) {
    const d = new Date(window.startDate);
    d.setDate(window.startDate.getDate() + i);
    const key = toDateKey(d);
    dailyMap.set(key, {
      date: d,
      grossSales: 0,
      netSales: 0,
      billedGrandTotal: 0,
      discounts: 0,
      returnsNet: 0,
      tax: 0,
      cogs: 0,
      grossProfit: 0,
      transactionCount: 0,
      unitsSold: 0,
      hourlyNetSales: new Map<number, number>(),
    });
  }

  // Hourly 0..23
  const hourlyBuckets: HourlySalesBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    grossSales: 0,
    netSales: 0,
    transactionCount: 0,
    unitsSold: 0,
    averageTransactionValue: 0,
  }));

  // Weekdays 0..6
  const weekdayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdayNamesAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const weekdayBuckets: WeekdaySalesBucket[] = Array.from({ length: 7 }, (_, day) => ({
    dayOfWeek: day,
    labelEn: weekdayNamesEn[day],
    labelAr: weekdayNamesAr[day],
    grossSales: 0,
    netSales: 0,
    transactionCount: 0,
    unitsSold: 0,
    averageTransactionValue: 0,
  })) as any;

  const categoryMap = new Map<string, SalesByDimensionItem>();
  const productMap = new Map<string, SalesByDimensionItem>();
  const branchMap = new Map<string, SalesByDimensionItem>();
  const employeeMap = new Map<string, SalesByDimensionItem>();
  const paymentMap = new Map<
    PaymentMethod,
    { count: number; grossAmount: number; netSalesAmount: number }
  >([
    ['cash', { count: 0, grossAmount: 0, netSalesAmount: 0 }],
    ['bank_transfer', { count: 0, grossAmount: 0, netSalesAmount: 0 }],
    ['qr_nfc', { count: 0, grossAmount: 0, netSalesAmount: 0 }],
  ]);

  const currencyMap = new Map<
    string,
    {
      count: number;
      originalAmount: number;
      convertedNetSales: number;
      rateSum: number;
    }
  >();

  for (const tx of inCurrentWindow) {
    const view = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      valuationMode,
      anchorCurrency
    );

    const isTaxInclusive = isTransactionTaxInclusive(tx);

    // Filter line items while preserving their original index in view.items / tx.items
    const matchingIndexedItems: { item: Transaction['items'][number]; idx: number }[] = [];
    for (let idx = 0; idx < view.items.length; idx++) {
      const item = view.items[idx];
      if (filters.productId && filters.productId !== 'all' && item.productId !== filters.productId) {
        continue;
      }
      if (filters.category && filters.category !== 'all') {
        const prod = productsMap.get(item.productId);
        if (!prod || prod.category !== filters.category) continue;
      }
      matchingIndexedItems.push({ item, idx });
    }

    if (matchingIndexedItems.length === 0) continue;

    const itemFilterRatio =
      view.subtotal > 0
        ? matchingIndexedItems.reduce((acc, it) => acc + it.item.total, 0) / view.subtotal
        : 1;

    // Voided transactions are excluded from sales, tax, discounts, and COGS
    if (tx.status === 'voided') {
      const voidBilled = roundCurrencyValue(view.grandTotal * itemFilterRatio);
      voidedSalesAmount = roundCurrencyValue(voidedSalesAmount + voidBilled);
      voidedTransactionCount += 1;
      continue;
    }

    const snapshotRates: Record<string, number> =
      valuationMode === 'historical'
        ? {
            ...DEFAULT_BASELINE_EXCHANGE_RATES,
            ...(tx.exchangeRatesSnapshot || {}),
            SDG: 1,
          }
        : liveRates;

    // Resolve any merchandise returns for this completed transaction
    const txReturns = resolveReturnsForTransaction(tx, dataset.returns || []);
    const returnedQtyByProduct = new Map<string, number>();
    const returnedRefundByProduct = new Map<string, number>();
    let rawRefundBilledInTxCurrency = 0;

    for (const ret of txReturns) {
      merchandiseReturnsCount += 1;
      if (Array.isArray(ret.items) && ret.items.length > 0) {
        for (const ri of ret.items) {
          if (
            filters.productId &&
            filters.productId !== 'all' &&
            ri.productId !== filters.productId
          ) {
            continue;
          }
          if (filters.category && filters.category !== 'all') {
            const p = productsMap.get(ri.productId);
            if (!p || p.category !== filters.category) continue;
          }
          returnedQtyByProduct.set(
            ri.productId,
            (returnedQtyByProduct.get(ri.productId) || 0) + Math.max(0, ri.quantity)
          );
          returnedRefundByProduct.set(
            ri.productId,
            roundCurrencyValue(
              (returnedRefundByProduct.get(ri.productId) || 0) + Math.max(0, ri.refundAmount)
            )
          );
          rawRefundBilledInTxCurrency = roundCurrencyValue(
            rawRefundBilledInTxCurrency + Math.max(0, ri.refundAmount)
          );
        }
      } else if (ret.refundTotal > 0) {
        rawRefundBilledInTxCurrency = roundCurrencyValue(
          rawRefundBilledInTxCurrency + ret.refundTotal * itemFilterRatio
        );
      }
    }

    // Conversion ratio from tx.currency to targetCurrency
    const txToTargetFactor = tx.grandTotal > 0 ? view.grandTotal / tx.grandTotal : 1;

    let txRawPreDiscount = 0;
    let txItemsNetAfterItemDiscount = 0;
    let txGrossUnits = 0;
    let txReturnedUnits = 0;
    let txCogs = 0;

    const consumedOrigIndices = new Set<number>();
    const remainingRetQtyByProd = new Map(returnedQtyByProduct);
    const remainingRetRefundByProd = new Map(returnedRefundByProduct);

    for (const { item, idx } of matchingIndexedItems) {
      const origTxItem = resolveOriginalSaleLineItem(
        item,
        idx,
        tx.items,
        consumedOrigIndices
      );
      const discPct = Math.max(0, Math.min(100, item.discountPercent || 0));
      const itemGrossBeforeItemDisc =
        discPct > 0 && discPct < 100
          ? roundCurrencyValue(item.total / (1 - discPct / 100))
          : roundCurrencyValue(item.unitPrice * item.quantity);
      const itemDiscAmount = Math.max(0, roundCurrencyValue(itemGrossBeforeItemDisc - item.total));

      txRawPreDiscount = roundCurrencyValue(txRawPreDiscount + itemGrossBeforeItemDisc);
      txItemsNetAfterItemDiscount = roundCurrencyValue(txItemsNetAfterItemDiscount + item.total);

      const availRetQty = remainingRetQtyByProd.get(item.productId) || 0;
      const retQty = Math.min(item.quantity, availRetQty);
      remainingRetQtyByProd.set(item.productId, Math.max(0, availRetQty - retQty));

      const netQty = Math.max(0, item.quantity - retQty);
      txGrossUnits += item.quantity;
      txReturnedUnits += retQty;

      const prod = productsMap.get(item.productId);
      const costRes = resolveHistoricalLineItemCost(
        origTxItem,
        prod,
        tx.timestamp,
        targetCurrency,
        snapshotRates
      );
      overallQualities.add(costRes.quality);

      // Net COGS after subtracting returned units' cost
      const netLineCost = roundCurrencyValue(costRes.unitCostResolved * netQty);
      txCogs = roundCurrencyValue(txCogs + netLineCost);

      // Allocate global discount & tax to this line item
      const itemShareOfSubtotal = view.subtotal > 0 ? item.total / view.subtotal : 0;
      const allocatedGlobalDiscount = roundCurrencyValue(view.discountAmount * itemShareOfSubtotal);
      const allocatedTax = roundCurrencyValue(view.taxAmount * itemShareOfSubtotal);

      const itemGrossExclTax = isTaxInclusive
        ? Math.max(0, roundCurrencyValue(itemGrossBeforeItemDisc - allocatedTax))
        : itemGrossBeforeItemDisc;
      const itemNetBeforeReturn = isTaxInclusive
        ? Math.max(0, roundCurrencyValue(item.total - allocatedGlobalDiscount - allocatedTax))
        : Math.max(0, roundCurrencyValue(item.total - allocatedGlobalDiscount));
      const itemBilledBeforeReturn = isTaxInclusive
        ? Math.max(0, roundCurrencyValue(item.total - allocatedGlobalDiscount))
        : roundCurrencyValue(itemNetBeforeReturn + allocatedTax);

      // Item return deduction (consuming refund amount across matching product lines without double-deducting)
      let itemReturnBilled = 0;
      if (remainingRetRefundByProd.has(item.productId)) {
        const availRefundInTarget = roundCurrencyValue(
          (remainingRetRefundByProd.get(item.productId) || 0) * txToTargetFactor
        );
        itemReturnBilled = Math.min(itemBilledBeforeReturn, availRefundInTarget);
        const usedRefundInTxCurr =
          txToTargetFactor > 0 ? itemReturnBilled / txToTargetFactor : itemReturnBilled;
        remainingRetRefundByProd.set(
          item.productId,
          Math.max(0, (remainingRetRefundByProd.get(item.productId) || 0) - usedRefundInTxCurr)
        );
      } else if (rawRefundBilledInTxCurrency > 0 && txReturns.every((r) => !r.items?.length)) {
        itemReturnBilled = Math.min(
          itemBilledBeforeReturn,
          roundCurrencyValue(rawRefundBilledInTxCurrency * txToTargetFactor * itemShareOfSubtotal)
        );
      }

      const itemNetTaxRatio =
        itemBilledBeforeReturn > 0 ? itemNetBeforeReturn / itemBilledBeforeReturn : 1;
      const itemReturnNet = roundCurrencyValue(itemReturnBilled * itemNetTaxRatio);
      const itemReturnTax = Math.max(0, roundCurrencyValue(itemReturnBilled - itemReturnNet));

      const itemFinalNetRevenue = Math.max(0, roundCurrencyValue(itemNetBeforeReturn - itemReturnNet));
      const itemFinalTax = Math.max(0, roundCurrencyValue(allocatedTax - itemReturnTax));
      const itemTotalDiscount = roundCurrencyValue(itemDiscAmount + allocatedGlobalDiscount);
      const itemProfit = roundCurrencyValue(itemFinalNetRevenue - netLineCost);

      // Product dimension
      const existingProd = productMap.get(item.productId) || {
        id: item.productId,
        name: prod?.name || item.productName,
        nameAr: prod?.nameAr || item.productName,
        grossSales: 0,
        netSales: 0,
        discounts: 0,
        returnsDeducted: 0,
        tax: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPercent: 0,
        cogsDataQuality: costRes.quality,
        transactionCount: 0,
        unitsSold: 0,
        shareOfNetSalesPercent: 0,
      };
      existingProd.grossSales = roundCurrencyValue(existingProd.grossSales + itemGrossExclTax);
      existingProd.netSales = roundCurrencyValue(existingProd.netSales + itemFinalNetRevenue);
      existingProd.discounts = roundCurrencyValue(existingProd.discounts + itemTotalDiscount);
      existingProd.returnsDeducted = roundCurrencyValue(
        existingProd.returnsDeducted + itemReturnNet
      );
      existingProd.tax = roundCurrencyValue(existingProd.tax + itemFinalTax);
      existingProd.cogs = roundCurrencyValue((existingProd.cogs ?? 0) + netLineCost);
      existingProd.grossProfit = roundCurrencyValue(
        (existingProd.grossProfit ?? 0) + itemProfit
      );
      existingProd.transactionCount += 1;
      existingProd.unitsSold += netQty;
      productMap.set(item.productId, existingProd);

      // Category dimension
      const catKey = prod?.category || 'Uncategorized';
      const catNameAr = prod?.categoryAr || catKey;
      const existingCat = categoryMap.get(catKey) || {
        id: catKey,
        name: catKey,
        nameAr: catNameAr,
        grossSales: 0,
        netSales: 0,
        discounts: 0,
        returnsDeducted: 0,
        tax: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPercent: 0,
        cogsDataQuality: costRes.quality,
        transactionCount: 0,
        unitsSold: 0,
        shareOfNetSalesPercent: 0,
      };
      existingCat.grossSales = roundCurrencyValue(existingCat.grossSales + itemGrossExclTax);
      existingCat.netSales = roundCurrencyValue(existingCat.netSales + itemFinalNetRevenue);
      existingCat.discounts = roundCurrencyValue(existingCat.discounts + itemTotalDiscount);
      existingCat.returnsDeducted = roundCurrencyValue(
        existingCat.returnsDeducted + itemReturnNet
      );
      existingCat.tax = roundCurrencyValue(existingCat.tax + itemFinalTax);
      existingCat.cogs = roundCurrencyValue((existingCat.cogs ?? 0) + netLineCost);
      existingCat.grossProfit = roundCurrencyValue(
        (existingCat.grossProfit ?? 0) + itemProfit
      );
      existingCat.transactionCount += 1;
      existingCat.unitsSold += netQty;
      categoryMap.set(catKey, existingCat);
    }

    const allocatedGlobalDisc = roundCurrencyValue(view.discountAmount * itemFilterRatio);
    const allocatedTax = roundCurrencyValue(view.taxAmount * itemFilterRatio);
    const txTotalDiscounts = roundCurrencyValue(
      Math.max(0, txRawPreDiscount - txItemsNetAfterItemDiscount) + allocatedGlobalDisc
    );

    const txGrossExclTax = isTaxInclusive
      ? Math.max(0, roundCurrencyValue(txRawPreDiscount - allocatedTax))
      : txRawPreDiscount;
    const txNetBeforeReturns = isTaxInclusive
      ? Math.max(
          0,
          roundCurrencyValue(txItemsNetAfterItemDiscount - allocatedGlobalDisc - allocatedTax)
        )
      : Math.max(0, roundCurrencyValue(txItemsNetAfterItemDiscount - allocatedGlobalDisc));
    const txBilledBeforeReturns = isTaxInclusive
      ? Math.max(0, roundCurrencyValue(txItemsNetAfterItemDiscount - allocatedGlobalDisc))
      : roundCurrencyValue(txNetBeforeReturns + allocatedTax);

    // Cap return billed amount at txBilledBeforeReturns so returns are never double-counted
    const cappedReturnBilled = Math.min(
      txBilledBeforeReturns,
      roundCurrencyValue(rawRefundBilledInTxCurrency * txToTargetFactor)
    );
    const netToBilledRatio =
      txBilledBeforeReturns > 0 ? txNetBeforeReturns / txBilledBeforeReturns : 1;
    const txReturnNet = roundCurrencyValue(cappedReturnBilled * netToBilledRatio);
    const txReturnTax = Math.max(0, roundCurrencyValue(cappedReturnBilled - txReturnNet));

    // If a full return occurred without line-item quantities, deduct all units
    if (
      cappedReturnBilled >= txBilledBeforeReturns - 0.01 &&
      txBilledBeforeReturns > 0 &&
      txReturnedUnits === 0
    ) {
      txReturnedUnits = txGrossUnits;
      txCogs = 0;
    }

    const txNetUnits = Math.max(0, txGrossUnits - txReturnedUnits);
    const txNetSales = Math.max(0, roundCurrencyValue(txNetBeforeReturns - txReturnNet));
    const txFinalTax = Math.max(0, roundCurrencyValue(allocatedTax - txReturnTax));
    const txBilledTotal = roundCurrencyValue(txNetSales + txFinalTax);
    const txGrossProfit = roundCurrencyValue(txNetSales - txCogs);

    completedCount += 1;
    grossSales = roundCurrencyValue(grossSales + txGrossExclTax);
    discountsTotal = roundCurrencyValue(discountsTotal + txTotalDiscounts);
    merchandiseReturnsNetSales = roundCurrencyValue(merchandiseReturnsNetSales + txReturnNet);
    merchandiseReturnsTax = roundCurrencyValue(merchandiseReturnsTax + txReturnTax);
    merchandiseReturnsBilledTotal = roundCurrencyValue(
      merchandiseReturnsBilledTotal + cappedReturnBilled
    );
    netSales = roundCurrencyValue(netSales + txNetSales);
    taxCollected = roundCurrencyValue(taxCollected + txFinalTax);
    billedGrandTotal = roundCurrencyValue(billedGrandTotal + txBilledTotal);
    grossUnitsSoldBeforeReturns += txGrossUnits;
    returnedUnitsCount += txReturnedUnits;

    const txDate = new Date(tx.timestamp);
    const dateKey = toDateKey(txDate);
    const hour = txDate.getHours();
    const weekday = txDate.getDay();

    const dayBucket = dailyMap.get(dateKey);
    if (dayBucket) {
      dayBucket.grossSales = roundCurrencyValue(dayBucket.grossSales + txGrossExclTax);
      dayBucket.netSales = roundCurrencyValue(dayBucket.netSales + txNetSales);
      dayBucket.billedGrandTotal = roundCurrencyValue(dayBucket.billedGrandTotal + txBilledTotal);
      dayBucket.discounts = roundCurrencyValue(dayBucket.discounts + txTotalDiscounts);
      dayBucket.returnsNet = roundCurrencyValue(dayBucket.returnsNet + txReturnNet);
      dayBucket.tax = roundCurrencyValue(dayBucket.tax + txFinalTax);
      dayBucket.cogs = roundCurrencyValue(dayBucket.cogs + txCogs);
      dayBucket.grossProfit = roundCurrencyValue(dayBucket.grossProfit + txGrossProfit);
      dayBucket.transactionCount += 1;
      dayBucket.unitsSold += txNetUnits;
      const prevHourVal = dayBucket.hourlyNetSales.get(hour) || 0;
      dayBucket.hourlyNetSales.set(hour, roundCurrencyValue(prevHourVal + txNetSales));
    }

    if (hourlyBuckets[hour]) {
      hourlyBuckets[hour].grossSales = roundCurrencyValue(
        hourlyBuckets[hour].grossSales + txGrossExclTax
      );
      hourlyBuckets[hour].netSales = roundCurrencyValue(hourlyBuckets[hour].netSales + txNetSales);
      hourlyBuckets[hour].transactionCount += 1;
      hourlyBuckets[hour].unitsSold += txNetUnits;
    }

    if (weekdayBuckets[weekday]) {
      weekdayBuckets[weekday].grossSales = roundCurrencyValue(
        weekdayBuckets[weekday].grossSales + txGrossExclTax
      );
      weekdayBuckets[weekday].netSales = roundCurrencyValue(
        weekdayBuckets[weekday].netSales + txNetSales
      );
      weekdayBuckets[weekday].transactionCount += 1;
      weekdayBuckets[weekday].unitsSold += txNetUnits;
    }

    // Branch dimension
    const branchInfo = resolveTransactionBranch(tx, dataset.branches);
    const existingBranch = branchMap.get(branchInfo.id) || {
      id: branchInfo.id,
      name: branchInfo.name,
      nameAr: branchInfo.nameAr,
      grossSales: 0,
      netSales: 0,
      discounts: 0,
      returnsDeducted: 0,
      tax: 0,
      cogs: 0,
      grossProfit: 0,
      grossMarginPercent: 0,
      cogsDataQuality: 'estimated_from_current_catalog_cost',
      transactionCount: 0,
      unitsSold: 0,
      shareOfNetSalesPercent: 0,
    };
    existingBranch.grossSales = roundCurrencyValue(existingBranch.grossSales + txGrossExclTax);
    existingBranch.netSales = roundCurrencyValue(existingBranch.netSales + txNetSales);
    existingBranch.discounts = roundCurrencyValue(existingBranch.discounts + txTotalDiscounts);
    existingBranch.returnsDeducted = roundCurrencyValue(
      existingBranch.returnsDeducted + txReturnNet
    );
    existingBranch.tax = roundCurrencyValue(existingBranch.tax + txFinalTax);
    existingBranch.cogs = roundCurrencyValue((existingBranch.cogs ?? 0) + txCogs);
    existingBranch.grossProfit = roundCurrencyValue(
      (existingBranch.grossProfit ?? 0) + txGrossProfit
    );
    existingBranch.transactionCount += 1;
    existingBranch.unitsSold += txNetUnits;
    branchMap.set(branchInfo.id, existingBranch);

    // Employee / Cashier dimension
    const empKey = tx.cashierName || 'POS Terminal 01';
    const matchedUser = dataset.users.find(
      (u) => u.terminalName === empKey || u.name === empKey || u.nameAr === empKey
    );
    const existingEmp = employeeMap.get(empKey) || {
      id: empKey,
      name: matchedUser ? `${matchedUser.name} (${empKey})` : empKey,
      nameAr: matchedUser?.nameAr ? `${matchedUser.nameAr} (${empKey})` : empKey,
      grossSales: 0,
      netSales: 0,
      discounts: 0,
      returnsDeducted: 0,
      tax: 0,
      cogs: 0,
      grossProfit: 0,
      grossMarginPercent: 0,
      cogsDataQuality: 'estimated_from_current_catalog_cost',
      transactionCount: 0,
      unitsSold: 0,
      shareOfNetSalesPercent: 0,
    };
    existingEmp.grossSales = roundCurrencyValue(existingEmp.grossSales + txGrossExclTax);
    existingEmp.netSales = roundCurrencyValue(existingEmp.netSales + txNetSales);
    existingEmp.discounts = roundCurrencyValue(existingEmp.discounts + txTotalDiscounts);
    existingEmp.returnsDeducted = roundCurrencyValue(
      existingEmp.returnsDeducted + txReturnNet
    );
    existingEmp.tax = roundCurrencyValue(existingEmp.tax + txFinalTax);
    existingEmp.cogs = roundCurrencyValue((existingEmp.cogs ?? 0) + txCogs);
    existingEmp.grossProfit = roundCurrencyValue(
      (existingEmp.grossProfit ?? 0) + txGrossProfit
    );
    existingEmp.transactionCount += 1;
    existingEmp.unitsSold += txNetUnits;
    employeeMap.set(empKey, existingEmp);

    // Payment method dimension
    const methodKey: PaymentMethod =
      tx.paymentMethod === 'card' ? 'bank_transfer' : tx.paymentMethod;
    const pm = paymentMap.get(methodKey) || { count: 0, grossAmount: 0, netSalesAmount: 0 };
    pm.count += 1;
    pm.grossAmount = roundCurrencyValue(pm.grossAmount + txBilledTotal);
    pm.netSalesAmount = roundCurrencyValue(pm.netSalesAmount + txNetSales);
    paymentMap.set(methodKey, pm);

    // Currency dimension
    const origCurr = (tx.currency || 'SDG').toUpperCase();
    const currEntry = currencyMap.get(origCurr) || {
      count: 0,
      originalAmount: 0,
      convertedNetSales: 0,
      rateSum: 0,
    };
    currEntry.count += 1;
    currEntry.originalAmount = roundCurrencyValue(
      currEntry.originalAmount + tx.grandTotal * itemFilterRatio
    );
    currEntry.convertedNetSales = roundCurrencyValue(currEntry.convertedNetSales + txNetSales);
    currEntry.rateSum += Number(tx.exchangeRateUsed || liveRates[origCurr] || 1);
    currencyMap.set(origCurr, currEntry);
  }

  // Previous period net sales for PoP growth
  let previousPeriodNetSales = 0;
  for (const tx of inPrevWindow) {
    if (tx.status !== 'completed') continue;
    const view = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      valuationMode,
      anchorCurrency
    );
    const isInc = isTransactionTaxInclusive(tx);
    const txNet = isInc
      ? Math.max(0, roundCurrencyValue(view.subtotal - view.discountAmount - view.taxAmount))
      : Math.max(0, roundCurrencyValue(view.subtotal - view.discountAmount));
    previousPeriodNetSales = roundCurrencyValue(previousPeriodNetSales + txNet);
  }

  const periodOverPeriodGrowthPercent =
    previousPeriodNetSales > 0
      ? Math.round(((netSales - previousPeriodNetSales) / previousPeriodNetSales) * 1000) / 10
      : netSales > 0
      ? 100
      : 0;

  const unitsSold = Math.max(0, grossUnitsSoldBeforeReturns - returnedUnitsCount);
  const averageTransactionValue =
    completedCount > 0 ? roundCurrencyValue(netSales / completedCount) : 0;
  const averageBilledTicket =
    completedCount > 0 ? roundCurrencyValue(billedGrandTotal / completedCount) : 0;
  const unitsPerTransaction =
    completedCount > 0 ? Math.round((unitsSold / completedCount) * 100) / 100 : 0;
  const discountRatePercent =
    grossSales > 0 ? Math.round((discountsTotal / grossSales) * 1000) / 10 : 0;

  const returnedOrVoidedSales = roundCurrencyValue(
    voidedSalesAmount + merchandiseReturnsBilledTotal
  );
  const returnedOrVoidedCount = voidedTransactionCount + merchandiseReturnsCount;

  const cogsDataQuality = combineCogsQualities(overallQualities);

  for (const h of hourlyBuckets) {
    h.averageTransactionValue =
      h.transactionCount > 0 ? roundCurrencyValue(h.netSales / h.transactionCount) : 0;
  }

  const finalizeDimensionList = (map: Map<string, SalesByDimensionItem>): SalesByDimensionItem[] =>
    Array.from(map.values())
      .map((item) => ({
        ...item,
        grossMarginPercent:
          item.netSales > 0 && item.grossProfit !== null
            ? Math.round((item.grossProfit / item.netSales) * 1000) / 10
            : 0,
        shareOfNetSalesPercent:
          netSales > 0 ? Math.round((item.netSales / netSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.netSales - a.netSales);

  const dailySeries: SalesAnalyticsResult['dailySeries'] = [];
  const intradayCandlesticks: DailyIntradayCandlestick[] = [];

  for (const [dateKey, bucket] of dailyMap.entries()) {
    const label = bucket.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const atv =
      bucket.transactionCount > 0
        ? roundCurrencyValue(bucket.netSales / bucket.transactionCount)
        : 0;

    dailySeries.push({
      dateKey,
      label,
      grossSales: bucket.grossSales,
      netSales: bucket.netSales,
      billedGrandTotal: bucket.billedGrandTotal,
      discounts: bucket.discounts,
      returnsNet: bucket.returnsNet,
      tax: bucket.tax,
      cogs: bucket.cogs,
      grossProfit: bucket.grossProfit,
      transactionCount: bucket.transactionCount,
      unitsSold: bucket.unitsSold,
      averageTransactionValue: atv,
    });

    const activeHours = Array.from(bucket.hourlyNetSales.entries()).sort((a, b) => a[0] - b[0]);
    if (activeHours.length === 0) {
      intradayCandlesticks.push({
        dateKey,
        label,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        dailyTotalSales: 0,
        transactionCount: 0,
        unitsSold: 0,
        peakHour: null,
        intradayDirection: 'flat',
      });
    } else {
      const open = activeHours[0][1];
      const close = activeHours[activeHours.length - 1][1];
      let high = activeHours[0][1];
      let low = activeHours[0][1];
      let peakHour = activeHours[0][0];

      for (const [hr, val] of activeHours) {
        if (val > high) {
          high = val;
          peakHour = hr;
        }
        if (val < low) {
          low = val;
        }
      }

      intradayCandlesticks.push({
        dateKey,
        label,
        open,
        high,
        low,
        close,
        dailyTotalSales: bucket.netSales,
        transactionCount: bucket.transactionCount,
        unitsSold: bucket.unitsSold,
        peakHour,
        intradayDirection:
          close > open + 0.01 ? 'bullish' : close < open - 0.01 ? 'bearish' : 'flat',
      });
    }
  }

  const byPaymentMethod: SalesAnalyticsResult['byPaymentMethod'] = Array.from(
    paymentMap.entries()
  ).map(([method, stat]) => ({
    method,
    labelEn: formatPaymentMethodLabel(method, 'en'),
    labelAr: formatPaymentMethodLabel(method, 'ar'),
    transactionCount: stat.count,
    grossAmount: stat.grossAmount,
    netSalesAmount: stat.netSalesAmount,
    sharePercent: netSales > 0 ? Math.round((stat.netSalesAmount / netSales) * 1000) / 10 : 0,
  }));

  const byCurrency: SalesAnalyticsResult['byCurrency'] = Array.from(currencyMap.entries()).map(
    ([code, stat]) => ({
      originalCurrency: code,
      transactionCount: stat.count,
      originalAmount: stat.originalAmount,
      convertedNetSales: stat.convertedNetSales,
      averageHistoricalRateToSdg:
        stat.count > 0 ? roundCurrencyValue(stat.rateSum / stat.count) : 1,
      sharePercent: netSales > 0 ? Math.round((stat.convertedNetSales / netSales) * 1000) / 10 : 0,
    })
  );

  return {
    currency: targetCurrency,
    valuationMode,
    costAccessStatus: 'authorized',
    cogsDataQuality,
    cogsValuationNoteEn:
      cogsDataQuality === 'exact_frozen_at_sale'
        ? 'COGS is computed from exact unit costs frozen on each sale item at checkout.'
        : cogsDataQuality === 'reconstructed_from_price_history'
        ? 'COGS is reconstructed from product price history timelines at transaction timestamps.'
        : 'Historical unit cost was not frozen on all sale_items; COGS uses product priceHistory where available and current catalog cost as an estimate.',
    cogsValuationNoteAr:
      cogsDataQuality === 'exact_frozen_at_sale'
        ? 'تم احتساب تكلفة البضاعة المباعة (COGS) من التكلفة المثبتة على كل صنف وقت البيع.'
        : cogsDataQuality === 'reconstructed_from_price_history'
        ? 'تمت إعادة بناء تكلفة البضاعة المباعة من سجل تاريخ أسعار المنتج في وقت كل فاتورة.'
        : 'لم يتم تثبيت تكلفة الوحدة التاريخية على جميع بنود المبيعات؛ تستخدم التكلفة سجل تاريخ الأسعار إن وجد والتكلفة الحالية كتقدير.',
    periodStart: window.startDate.toISOString(),
    periodEnd: window.endDate.toISOString(),
    summary: {
      grossSales,
      discountsTotal,
      discountRatePercent,
      merchandiseReturnsNetSales,
      merchandiseReturnsTax,
      merchandiseReturnsBilledTotal,
      merchandiseReturnsCount,
      netSales,
      taxCollected,
      billedGrandTotal,
      voidedSalesAmount,
      voidedTransactionCount,
      returnedOrVoidedSales,
      returnedOrVoidedCount,
      transactionCount: completedCount,
      unitsSold,
      grossUnitsSoldBeforeReturns,
      returnedUnitsCount,
      averageTransactionValue,
      averageBilledTicket,
      unitsPerTransaction,
      previousPeriodNetSales,
      periodOverPeriodGrowthPercent,
    },
    dailySeries,
    intradayCandlesticks,
    hourlyDistribution: hourlyBuckets,
    weekdayDistribution: weekdayBuckets,
    byCategory: finalizeDimensionList(categoryMap),
    byProduct: finalizeDimensionList(productMap),
    byBranch: finalizeDimensionList(branchMap),
    byEmployee: finalizeDimensionList(employeeMap),
    byPaymentMethod,
    byCurrency,
  };
}
