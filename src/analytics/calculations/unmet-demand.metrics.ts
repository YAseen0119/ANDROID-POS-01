/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 (Part 4C & 4D): Customer Demand Intelligence & Lost Sales Estimation Engine
 * Pure, deterministic O(N) analytical calculations for unmet customer demand.
 * Strictly separated from completed sales, inventory stock, and accounting ledgers.
 */

import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  AnalyticsUserContext,
  InventoryAnalyticsResult,
  LostSalesEstimationSummary,
  SalesAnalyticsResult,
  SmartInsightConfidenceLevel,
  SUPPORTED_UNAVAILABILITY_REASONS,
  UnavailabilityReason,
  UnmetDemandAnalyticsResult,
  UnmetDemandBranchComparisonItem,
  UnmetDemandProductSummaryItem,
  UnmetDemandRequestRecord,
  UnmetDemandTrendPoint,
} from '../analytics.types';
import { redactUnmetDemandRecordForRole } from '../unmet-demand.validation';
import { convertCurrencyAmount } from '../../lib/pos-calculations';
import { resolveAnalyticsDateWindow, toDateKey } from './sales.metrics';

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function formatDateKey(date: Date): string {
  return toDateKey(date);
}

function resolveDateRange(filters: AnalyticsFilterParams, now: Date): { start: Date; end: Date } {
  const win = resolveAnalyticsDateWindow(filters, now);
  return { start: win.startDate, end: win.endDate };
}

function convertSdgToTargetCurrency(
  amountInSdg: number,
  targetCurrency: string,
  liveRates: Record<string, number>
): number {
  return convertCurrencyAmount(amountInSdg, 'SDG', targetCurrency, liveRates);
}

const REASON_LABELS: Record<UnavailabilityReason, { en: string; ar: string }> = {
  OUT_OF_STOCK: {
    en: 'Out of Stock (Zero Inventory)',
    ar: 'نفاد المخزون (الرصيد صفر)',
  },
  EXPIRED: {
    en: 'Expired Batch On Shelf',
    ar: 'المنتج منتهي الصلاحية',
  },
  NOT_STOCKED: {
    en: 'Unregistered / Not Stocked in Store',
    ar: 'غير مسجل أو غير متوفر بالمتجر',
  },
  TEMPORARILY_UNAVAILABLE: {
    en: 'Temporarily Unavailable / In Transit',
    ar: 'غير متوفر مؤقتاً / قيد التوريد',
  },
  OTHER: {
    en: 'Other Unavailability Reason',
    ar: 'سبب آخر لعدم التوفر',
  },
};

function getIsoWeekKey(date: Date): { key: string; label: string } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const key = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  return { key, label: key };
}

function getMonthKey(date: Date): { key: string; label: string } {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { key, label: key };
}

/**
 * Converts a request's unit selling/cost price snapshot into the target analytics display currency.
 */
function convertPriceSnapshotToTarget(
  amount: number | null,
  currencySnapshot: string,
  exchangeRateSnapshot: number,
  targetCurrency: string,
  liveRates: Record<string, number>
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const srcCurr = (currencySnapshot || 'SDG').toUpperCase();
  const rateToSdg =
    srcCurr === 'SDG'
      ? 1
      : Number(exchangeRateSnapshot) > 0
      ? Number(exchangeRateSnapshot)
      : Number(liveRates[srcCurr]) > 0
      ? Number(liveRates[srcCurr])
      : 1;
  const amountInSdg = amount * rateToSdg;
  return convertSdgToTargetCurrency(amountInSdg, targetCurrency as any, liveRates);
}

export function computeUnmetDemandAnalytics(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  sales: SalesAnalyticsResult,
  inventory: InventoryAnalyticsResult,
  userContext?: AnalyticsUserContext,
  now: Date = new Date()
): UnmetDemandAnalyticsResult {
  const currency = filters.currency || 'SDG';
  const canViewPII = userContext?.canViewCustomerPII ?? false;
  const canViewCost = userContext?.canViewCostAndMargin ?? false;

  const { start, end } = resolveDateRange(filters, now);
  const startMs = start.getTime();
  const endMs = end.getTime();

  const branchFilter =
    filters.branchId && filters.branchId !== 'all' ? filters.branchId : null;
  const categoryFilter =
    filters.category && filters.category !== 'all'
      ? filters.category.toLowerCase()
      : null;
  const productFilter =
    filters.productId && filters.productId !== 'all' ? filters.productId : null;

  const rawRequests: UnmetDemandRequestRecord[] = Array.isArray(
    dataset.unmetDemandRequests
  )
    ? dataset.unmetDemandRequests
    : [];

  // Index catalog & inventory by productId for O(1) lookup
  const invByProductId = new Map<
    string,
    InventoryAnalyticsResult['products'][number]
  >();
  for (const invItem of inventory.products) {
    invByProductId.set(invItem.productId, invItem);
  }

  const salesByProductId = new Map<
    string,
    SalesAnalyticsResult['byProduct'][number]
  >();
  for (const sProd of sales.byProduct) {
    salesByProductId.set(sProd.id, sProd);
  }

  // Filter requests in O(N)
  const filteredRequests: UnmetDemandRequestRecord[] = [];
  for (const req of rawRequests) {
    if (!req || !req.id) continue;
    if (req.fulfillmentStatus === 'cancelled') continue;

    const ts = new Date(req.requestedTimestamp).getTime();
    if (Number.isNaN(ts) || ts < startMs || ts > endMs) continue;

    if (branchFilter && req.branchId !== branchFilter) continue;
    if (
      categoryFilter &&
      (req.categorySnapshot || '').toLowerCase() !== categoryFilter
    ) {
      continue;
    }
    if (productFilter && req.productId !== productFilter) continue;

    filteredRequests.push(req);
  }

  // Sort chronologically for deduplication of same-customer 24h repeat inquiries
  filteredRequests.sort(
    (a, b) =>
      new Date(a.requestedTimestamp).getTime() -
      new Date(b.requestedTimestamp).getTime()
  );

  // Track totals
  let totalInquiries = 0;
  let totalRequestedQuantity = 0;
  let totalRequestedBaseUnits = 0;
  let confirmedIntentInquiries = 0;
  let confirmedIntentBaseUnits = 0;
  let registeredProductInquiries = 0;
  let unregisteredProductInquiries = 0;
  let fulfilledLaterCount = 0;
  let unfulfilledCount = 0;
  let repeatCustomerInquiries = 0;
  let pricedInquiriesCount = 0;
  let dedupedConfirmedWeightedUnitsTotal = 0;
  let estimatedLostRevenueTotal = 0;
  let estimatedLostGrossProfitTotal = 0;
  let pricedCostInquiriesCount = 0;

  const reasonMap = new Map<
    UnavailabilityReason,
    { inquiryCount: number; requestedBaseUnits: number }
  >();
  for (const r of SUPPORTED_UNAVAILABILITY_REASONS) {
    reasonMap.set(r, { inquiryCount: 0, requestedBaseUnits: 0 });
  }

  interface ProductAccumulator {
    productKey: string;
    productId: string | null;
    isRegisteredProduct: boolean;
    productName: string;
    productNameAr: string | null;
    sku: string | null;
    barcode: string | null;
    category: string;
    inquiryCount: number;
    requestedQuantityTotal: number;
    requestedBaseUnitsTotal: number;
    confirmedPurchaseIntentCount: number;
    confirmedPurchaseIntentUnits: number;
    fulfilledLaterCount: number;
    unfulfilledCount: number;
    repeatCustomerInquiryCount: number;
    branchesSet: Set<string>;
    reasonBreakdown: Record<UnavailabilityReason, number>;
    stockoutOverlapInquiriesCount: number;
    weightedLostUnits: number;
    pricedLostUnits: number;
    estimatedLostRevenue: number;
    estimatedLostProfit: number;
    hasValidCostForProfit: boolean;
    firstRequestedAt: string;
    lastRequestedAt: string;
    customerLastSeenMs: Map<string, number>;
  }

  const productMap = new Map<string, ProductAccumulator>();
  const categoryMap = new Map<
    string,
    {
      inquiryCount: number;
      requestedBaseUnits: number;
      productsSet: Set<string>;
      estimatedLostRevenue: number;
      pricedCount: number;
    }
  >();
  const branchMap = new Map<
    string,
    {
      branchId: string;
      branchName: string;
      branchNameAr: string;
      inquiryCount: number;
      requestedBaseUnits: number;
      productsSet: Set<string>;
      outOfStockInquiries: number;
      notStockedInquiries: number;
      expiredInquiries: number;
      estimatedLostRevenue: number;
      pricedCount: number;
      productCounts: Map<string, { name: string; units: number }>;
    }
  >();

  for (const b of dataset.branches) {
    if (branchFilter && b.id !== branchFilter) continue;
    branchMap.set(b.id, {
      branchId: b.id,
      branchName: b.name,
      branchNameAr: b.nameAr,
      inquiryCount: 0,
      requestedBaseUnits: 0,
      productsSet: new Set(),
      outOfStockInquiries: 0,
      notStockedInquiries: 0,
      expiredInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
      productCounts: new Map(),
    });
  }

  // Daily, Weekly, Monthly buckets
  const dailySalesMap = new Map<string, number>();
  for (const ds of sales.dailySeries) {
    dailySalesMap.set(ds.dateKey, ds.unitsSold);
  }

  const dailyBuckets = new Map<
    string,
    {
      periodKey: string;
      label: string;
      inquiryCount: number;
      requestedBaseUnits: number;
      confirmedIntentUnits: number;
      registeredProductInquiries: number;
      unregisteredProductInquiries: number;
      estimatedLostRevenue: number;
      pricedCount: number;
    }
  >();
  const weeklyBuckets = new Map<
    string,
    {
      periodKey: string;
      label: string;
      inquiryCount: number;
      requestedBaseUnits: number;
      confirmedIntentUnits: number;
      actualUnitsSold: number;
      registeredProductInquiries: number;
      unregisteredProductInquiries: number;
      estimatedLostRevenue: number;
      pricedCount: number;
    }
  >();
  const monthlyBuckets = new Map<
    string,
    {
      periodKey: string;
      label: string;
      inquiryCount: number;
      requestedBaseUnits: number;
      confirmedIntentUnits: number;
      actualUnitsSold: number;
      registeredProductInquiries: number;
      unregisteredProductInquiries: number;
      estimatedLostRevenue: number;
      pricedCount: number;
    }
  >();

  // Pre-seed daily buckets from sales.dailySeries so charts align across the full date window
  for (const ds of sales.dailySeries) {
    dailyBuckets.set(ds.dateKey, {
      periodKey: ds.dateKey,
      label: ds.label,
      inquiryCount: 0,
      requestedBaseUnits: 0,
      confirmedIntentUnits: 0,
      registeredProductInquiries: 0,
      unregisteredProductInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
    });
    const dObj = new Date(`${ds.dateKey}T12:00:00.000Z`);
    const wk = getIsoWeekKey(dObj);
    const wkEntry = weeklyBuckets.get(wk.key) || {
      periodKey: wk.key,
      label: wk.label,
      inquiryCount: 0,
      requestedBaseUnits: 0,
      confirmedIntentUnits: 0,
      actualUnitsSold: 0,
      registeredProductInquiries: 0,
      unregisteredProductInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
    };
    wkEntry.actualUnitsSold += ds.unitsSold;
    weeklyBuckets.set(wk.key, wkEntry);

    const mo = getMonthKey(dObj);
    const moEntry = monthlyBuckets.get(mo.key) || {
      periodKey: mo.key,
      label: mo.label,
      inquiryCount: 0,
      requestedBaseUnits: 0,
      confirmedIntentUnits: 0,
      actualUnitsSold: 0,
      registeredProductInquiries: 0,
      unregisteredProductInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
    };
    moEntry.actualUnitsSold += ds.unitsSold;
    monthlyBuckets.set(mo.key, moEntry);
  }

  for (const req of filteredRequests) {
    totalInquiries += 1;
    const qty = Math.max(1, Number(req.requestedQuantity || 1));
    const baseUnits = Math.max(1, Number(req.requestedBaseUnits || qty));
    totalRequestedQuantity += qty;
    totalRequestedBaseUnits += baseUnits;

    if (req.confirmedPurchaseIntent) {
      confirmedIntentInquiries += 1;
      confirmedIntentBaseUnits += baseUnits;
    }
    if (req.isRegisteredProduct && req.productId) {
      registeredProductInquiries += 1;
    } else {
      unregisteredProductInquiries += 1;
    }

    if (req.fulfillmentStatus === 'fulfilled_later') {
      fulfilledLaterCount += 1;
    } else {
      unfulfilledCount += 1;
    }

    const reason: UnavailabilityReason = SUPPORTED_UNAVAILABILITY_REASONS.includes(
      req.unavailabilityReason
    )
      ? req.unavailabilityReason
      : 'OUT_OF_STOCK';

    const rBucket = reasonMap.get(reason)!;
    rBucket.inquiryCount += 1;
    rBucket.requestedBaseUnits += baseUnits;

    const prodKey =
      req.productId ||
      (req.barcode ? `barcode:${req.barcode}` : null) ||
      `unreg:${(req.productNameSnapshot || 'unknown').toLowerCase().trim()}`;

    let prodAcc = productMap.get(prodKey);
    if (!prodAcc) {
      prodAcc = {
        productKey: prodKey,
        productId: req.productId || null,
        isRegisteredProduct: Boolean(req.isRegisteredProduct && req.productId),
        productName: req.productNameSnapshot,
        productNameAr: req.productNameArSnapshot || null,
        sku: req.skuSnapshot || null,
        barcode: req.barcode || null,
        category: req.categorySnapshot || 'General',
        inquiryCount: 0,
        requestedQuantityTotal: 0,
        requestedBaseUnitsTotal: 0,
        confirmedPurchaseIntentCount: 0,
        confirmedPurchaseIntentUnits: 0,
        fulfilledLaterCount: 0,
        unfulfilledCount: 0,
        repeatCustomerInquiryCount: 0,
        branchesSet: new Set(),
        reasonBreakdown: {
          OUT_OF_STOCK: 0,
          EXPIRED: 0,
          NOT_STOCKED: 0,
          TEMPORARILY_UNAVAILABLE: 0,
          OTHER: 0,
        },
        stockoutOverlapInquiriesCount: 0,
        weightedLostUnits: 0,
        pricedLostUnits: 0,
        estimatedLostRevenue: 0,
        estimatedLostProfit: 0,
        hasValidCostForProfit: false,
        firstRequestedAt: req.requestedTimestamp,
        lastRequestedAt: req.requestedTimestamp,
        customerLastSeenMs: new Map(),
      };
      productMap.set(prodKey, prodAcc);
    }

    prodAcc.inquiryCount += 1;
    prodAcc.requestedQuantityTotal += qty;
    prodAcc.requestedBaseUnitsTotal += baseUnits;
    if (req.confirmedPurchaseIntent) {
      prodAcc.confirmedPurchaseIntentCount += 1;
      prodAcc.confirmedPurchaseIntentUnits += baseUnits;
    }
    if (req.fulfillmentStatus === 'fulfilled_later') {
      prodAcc.fulfilledLaterCount += 1;
    } else {
      prodAcc.unfulfilledCount += 1;
    }
    prodAcc.branchesSet.add(req.branchId || 'branch-main');
    prodAcc.reasonBreakdown[reason] = (prodAcc.reasonBreakdown[reason] || 0) + 1;
    if (
      req.availabilityStatus === 'OUT_OF_STOCK' ||
      req.availabilityStatus === 'INSUFFICIENT_QUANTITY' ||
      (req.availableStockAtRequest !== null && req.availableStockAtRequest <= 0)
    ) {
      prodAcc.stockoutOverlapInquiriesCount += 1;
    }

    if (req.requestedTimestamp < prodAcc.firstRequestedAt) {
      prodAcc.firstRequestedAt = req.requestedTimestamp;
    }
    if (req.requestedTimestamp > prodAcc.lastRequestedAt) {
      prodAcc.lastRequestedAt = req.requestedTimestamp;
    }

    // Check repeat customer inquiry within 24h window for conservative lost-sales deduplication
    const custIdentity = (
      req.customerId ||
      req.customerReference ||
      ''
    )
      .trim()
      .toLowerCase();
    const reqMs = new Date(req.requestedTimestamp).getTime();
    let isRepeatCustomerWithin24h = false;
    if (custIdentity) {
      const prevSeen = prodAcc.customerLastSeenMs.get(custIdentity);
      if (prevSeen !== undefined) {
        prodAcc.repeatCustomerInquiryCount += 1;
        repeatCustomerInquiries += 1;
        if (Math.abs(reqMs - prevSeen) <= 24 * 3600 * 1000) {
          isRepeatCustomerWithin24h = true;
        }
      }
      prodAcc.customerLastSeenMs.set(custIdentity, reqMs);
    }

    // Conservative Lost Sales Weighting (Part 4D):
    // - fulfilled_later => 0.0 (not lost)
    // - same-customer repeat within 24h => 0.15 (marginal incremental intent)
    // - confirmed purchase intent => 0.65
    // - standard unconfirmed inquiry => 0.35
    const realizationWeight =
      req.fulfillmentStatus === 'fulfilled_later'
        ? 0
        : isRepeatCustomerWithin24h
        ? 0.15
        : req.confirmedPurchaseIntent
        ? 0.65
        : 0.35;

    const weightedUnits = baseUnits * realizationWeight;
    prodAcc.weightedLostUnits += weightedUnits;
    dedupedConfirmedWeightedUnitsTotal += weightedUnits;

    // Resolve unit selling price & unit cost price in target currency
    const invItem = req.productId ? invByProductId.get(req.productId) : undefined;
    const unitSellConverted =
      convertPriceSnapshotToTarget(
        req.unitSellingPriceSnapshot ?? null,
        req.currencySnapshot,
        req.exchangeRateSnapshot ?? 1,
        currency,
        dataset.exchangeRates
      ) ?? (invItem && invItem.unitSellingPrice > 0 ? invItem.unitSellingPrice : null);

    const unitCostConverted =
      convertPriceSnapshotToTarget(
        req.unitCostPriceSnapshot ?? req.unitCostSnapshot ?? null,
        req.currencySnapshot,
        req.exchangeRateSnapshot ?? 1,
        currency,
        dataset.exchangeRates
      ) ?? (invItem && invItem.unitCost !== null && invItem.unitCost > 0 ? invItem.unitCost : null);

    let reqEstimatedLostRevenue = 0;
    if (unitSellConverted !== null && unitSellConverted > 0) {
      pricedInquiriesCount += 1;
      // Note: unitSellingPriceSnapshot is per saleUnitMode; normalize to base unit if pack
      const perBaseUnitSell =
        req.saleUnitMode === 'pack' && baseUnits > qty
          ? unitSellConverted / (baseUnits / qty)
          : unitSellConverted;
      reqEstimatedLostRevenue = weightedUnits * perBaseUnitSell;
      prodAcc.pricedLostUnits += weightedUnits;
      prodAcc.estimatedLostRevenue += reqEstimatedLostRevenue;
      estimatedLostRevenueTotal += reqEstimatedLostRevenue;

      if (canViewCost && unitCostConverted !== null && unitCostConverted > 0) {
        const perBaseUnitCost =
          req.saleUnitMode === 'pack' && baseUnits > qty
            ? unitCostConverted / (baseUnits / qty)
            : unitCostConverted;
        const unitMargin = Math.max(0, perBaseUnitSell - perBaseUnitCost);
        const lostProfit = weightedUnits * unitMargin;
        prodAcc.estimatedLostProfit += lostProfit;
        prodAcc.hasValidCostForProfit = true;
        estimatedLostGrossProfitTotal += lostProfit;
        pricedCostInquiriesCount += 1;
      }
    }

    // Category aggregation
    const catName = req.categorySnapshot || 'General';
    const catAcc = categoryMap.get(catName) || {
      inquiryCount: 0,
      requestedBaseUnits: 0,
      productsSet: new Set<string>(),
      estimatedLostRevenue: 0,
      pricedCount: 0,
    };
    catAcc.inquiryCount += 1;
    catAcc.requestedBaseUnits += baseUnits;
    catAcc.productsSet.add(prodKey);
    if (reqEstimatedLostRevenue > 0) {
      catAcc.estimatedLostRevenue += reqEstimatedLostRevenue;
      catAcc.pricedCount += 1;
    }
    categoryMap.set(catName, catAcc);

    // Branch aggregation
    const bId = req.branchId || 'branch-main';
    let bAcc = branchMap.get(bId);
    if (!bAcc) {
      bAcc = {
        branchId: bId,
        branchName: bId,
        branchNameAr: bId,
        inquiryCount: 0,
        requestedBaseUnits: 0,
        productsSet: new Set(),
        outOfStockInquiries: 0,
        notStockedInquiries: 0,
        expiredInquiries: 0,
        estimatedLostRevenue: 0,
        pricedCount: 0,
        productCounts: new Map(),
      };
      branchMap.set(bId, bAcc);
    }
    bAcc.inquiryCount += 1;
    bAcc.requestedBaseUnits += baseUnits;
    bAcc.productsSet.add(prodKey);
    if (reason === 'OUT_OF_STOCK') bAcc.outOfStockInquiries += 1;
    if (reason === 'NOT_STOCKED') bAcc.notStockedInquiries += 1;
    if (reason === 'EXPIRED') bAcc.expiredInquiries += 1;
    if (reqEstimatedLostRevenue > 0) {
      bAcc.estimatedLostRevenue += reqEstimatedLostRevenue;
      bAcc.pricedCount += 1;
    }
    const existingProdInBranch = bAcc.productCounts.get(prodKey) || {
      name: req.productNameSnapshot,
      units: 0,
    };
    existingProdInBranch.units += baseUnits;
    bAcc.productCounts.set(prodKey, existingProdInBranch);

    // Time bucket aggregation
    const reqDateObj = new Date(req.requestedTimestamp);
    const dayKey = formatDateKey(reqDateObj);
    const dayEntry = dailyBuckets.get(dayKey) || {
      periodKey: dayKey,
      label: dayKey.slice(5),
      inquiryCount: 0,
      requestedBaseUnits: 0,
      confirmedIntentUnits: 0,
      registeredProductInquiries: 0,
      unregisteredProductInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
    };
    dayEntry.inquiryCount += 1;
    dayEntry.requestedBaseUnits += baseUnits;
    if (req.confirmedPurchaseIntent) dayEntry.confirmedIntentUnits += baseUnits;
    if (req.isRegisteredProduct && req.productId) {
      dayEntry.registeredProductInquiries += 1;
    } else {
      dayEntry.unregisteredProductInquiries += 1;
    }
    if (reqEstimatedLostRevenue > 0) {
      dayEntry.estimatedLostRevenue += reqEstimatedLostRevenue;
      dayEntry.pricedCount += 1;
    }
    dailyBuckets.set(dayKey, dayEntry);

    const wk = getIsoWeekKey(reqDateObj);
    const wkEntry = weeklyBuckets.get(wk.key) || {
      periodKey: wk.key,
      label: wk.label,
      inquiryCount: 0,
      requestedBaseUnits: 0,
      confirmedIntentUnits: 0,
      actualUnitsSold: 0,
      registeredProductInquiries: 0,
      unregisteredProductInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
    };
    wkEntry.inquiryCount += 1;
    wkEntry.requestedBaseUnits += baseUnits;
    if (req.confirmedPurchaseIntent) wkEntry.confirmedIntentUnits += baseUnits;
    if (req.isRegisteredProduct && req.productId) {
      wkEntry.registeredProductInquiries += 1;
    } else {
      wkEntry.unregisteredProductInquiries += 1;
    }
    if (reqEstimatedLostRevenue > 0) {
      wkEntry.estimatedLostRevenue += reqEstimatedLostRevenue;
      wkEntry.pricedCount += 1;
    }
    weeklyBuckets.set(wk.key, wkEntry);

    const mo = getMonthKey(reqDateObj);
    const moEntry = monthlyBuckets.get(mo.key) || {
      periodKey: mo.key,
      label: mo.label,
      inquiryCount: 0,
      requestedBaseUnits: 0,
      confirmedIntentUnits: 0,
      actualUnitsSold: 0,
      registeredProductInquiries: 0,
      unregisteredProductInquiries: 0,
      estimatedLostRevenue: 0,
      pricedCount: 0,
    };
    moEntry.inquiryCount += 1;
    moEntry.requestedBaseUnits += baseUnits;
    if (req.confirmedPurchaseIntent) moEntry.confirmedIntentUnits += baseUnits;
    if (req.isRegisteredProduct && req.productId) {
      moEntry.registeredProductInquiries += 1;
    } else {
      moEntry.unregisteredProductInquiries += 1;
    }
    if (reqEstimatedLostRevenue > 0) {
      moEntry.estimatedLostRevenue += reqEstimatedLostRevenue;
      moEntry.pricedCount += 1;
    }
    monthlyBuckets.set(mo.key, moEntry);
  }

  // Build product summaries
  let repeatedStockoutProductsCount = 0;
  const allProductSummaries: UnmetDemandProductSummaryItem[] = [];

  for (const acc of productMap.values()) {
    const invItem = acc.productId ? invByProductId.get(acc.productId) : undefined;
    const sItem = acc.productId ? salesByProductId.get(acc.productId) : undefined;

    const currentStock = invItem ? invItem.currentStock : null;
    const pendingInboundUnits = invItem ? invItem.pendingInboundPurchaseUnits : 0;
    const actualUnitsSoldInPeriod = sItem ? sItem.unitsSold : 0;
    const actualNetSalesInPeriod = sItem ? sItem.netSales : 0;

    const totalCombinedUnits = actualUnitsSoldInPeriod + acc.requestedBaseUnitsTotal;
    const demandCaptureRatioPercent =
      totalCombinedUnits > 0
        ? round2((actualUnitsSoldInPeriod / totalCombinedUnits) * 100)
        : null;

    // Determine primary unavailability reason
    let primaryReason: UnavailabilityReason = 'OUT_OF_STOCK';
    let maxReasonCount = -1;
    for (const r of SUPPORTED_UNAVAILABILITY_REASONS) {
      if ((acc.reasonBreakdown[r] || 0) > maxReasonCount) {
        maxReasonCount = acc.reasonBreakdown[r] || 0;
        primaryReason = r;
      }
    }

    // Repeated stockout pattern: product is registered, has >=2 OUT_OF_STOCK inquiries (or stockout overlap >=2), and either currentStock <= minStockAlert or had actual sales in period
    const repeatedStockoutPatternDetected = Boolean(
      acc.isRegisteredProduct &&
        (acc.reasonBreakdown.OUT_OF_STOCK >= 2 ||
          acc.stockoutOverlapInquiriesCount >= 2) &&
        (actualUnitsSoldInPeriod > 0 ||
          (currentStock !== null &&
            invItem &&
            currentStock <= invItem.minStockAlert))
    );
    if (repeatedStockoutPatternDetected) {
      repeatedStockoutProductsCount += 1;
    }

    const hasSufficientPricing = acc.pricedLostUnits > 0 && acc.estimatedLostRevenue > 0;
    const lostSalesEstimationStatus: 'ESTIMATED' | 'INSUFFICIENT_DATA' =
      hasSufficientPricing ? 'ESTIMATED' : 'INSUFFICIENT_DATA';

    let lostSalesConfidence: SmartInsightConfidenceLevel = 'INSUFFICIENT_DATA';
    if (hasSufficientPricing) {
      if (acc.inquiryCount >= 5 && acc.confirmedPurchaseIntentCount >= 2) {
        lostSalesConfidence = 'HIGH';
      } else if (acc.inquiryCount >= 2) {
        lostSalesConfidence = 'MEDIUM';
      } else {
        lostSalesConfidence = 'LOW';
      }
    }

    allProductSummaries.push({
      productKey: acc.productKey,
      productId: acc.productId,
      isRegisteredProduct: acc.isRegisteredProduct,
      productName: acc.productName,
      productNameAr: acc.productNameAr,
      sku: acc.sku,
      barcode: acc.barcode,
      category: acc.category,
      inquiryCount: acc.inquiryCount,
      requestedQuantityTotal: acc.requestedQuantityTotal,
      requestedBaseUnitsTotal: acc.requestedBaseUnitsTotal,
      confirmedPurchaseIntentCount: acc.confirmedPurchaseIntentCount,
      confirmedPurchaseIntentUnits: acc.confirmedPurchaseIntentUnits,
      fulfilledLaterCount: acc.fulfilledLaterCount,
      unfulfilledCount: acc.unfulfilledCount,
      repeatCustomerInquiryCount: acc.repeatCustomerInquiryCount,
      distinctBranchesCount: acc.branchesSet.size,
      branchesRequested: Array.from(acc.branchesSet),
      primaryReason,
      reasonBreakdown: acc.reasonBreakdown,
      currentStock,
      pendingInboundUnits,
      actualUnitsSoldInPeriod,
      actualNetSalesInPeriod: round2(actualNetSalesInPeriod),
      demandCaptureRatioPercent,
      repeatedStockoutPatternDetected,
      stockoutOverlapInquiriesCount: acc.stockoutOverlapInquiriesCount,
      estimatedLostUnitsConservative: round2(acc.weightedLostUnits),
      estimatedLostRevenueConservative: hasSufficientPricing
        ? round2(acc.estimatedLostRevenue)
        : null,
      estimatedLostGrossProfitConservative:
        canViewCost && acc.hasValidCostForProfit
          ? round2(acc.estimatedLostProfit)
          : null,
      lostSalesEstimationStatus,
      lostSalesConfidence,
      firstRequestedAt: acc.firstRequestedAt,
      lastRequestedAt: acc.lastRequestedAt,
    });
  }

  allProductSummaries.sort((a, b) => {
    if (b.requestedBaseUnitsTotal !== a.requestedBaseUnitsTotal) {
      return b.requestedBaseUnitsTotal - a.requestedBaseUnitsTotal;
    }
    return b.inquiryCount - a.inquiryCount;
  });

  const topRequestedProducts = allProductSummaries.slice(0, 25);
  const unregisteredProductsDemand = allProductSummaries.filter(
    (p) => !p.isRegisteredProduct || p.primaryReason === 'NOT_STOCKED'
  );

  const byReason = SUPPORTED_UNAVAILABILITY_REASONS.map((reason) => {
    const r = reasonMap.get(reason)!;
    return {
      reason,
      labelEn: REASON_LABELS[reason].en,
      labelAr: REASON_LABELS[reason].ar,
      inquiryCount: r.inquiryCount,
      requestedBaseUnits: r.requestedBaseUnits,
      sharePercent:
        totalRequestedBaseUnits > 0
          ? round2((r.requestedBaseUnits / totalRequestedBaseUnits) * 100)
          : 0,
    };
  });

  const byCategory = Array.from(categoryMap.entries())
    .map(([category, c]) => ({
      category,
      inquiryCount: c.inquiryCount,
      requestedBaseUnits: c.requestedBaseUnits,
      distinctProducts: c.productsSet.size,
      estimatedLostRevenue:
        c.pricedCount > 0 ? round2(c.estimatedLostRevenue) : null,
    }))
    .sort((a, b) => b.requestedBaseUnits - a.requestedBaseUnits);

  const byBranch: UnmetDemandBranchComparisonItem[] = Array.from(
    branchMap.values()
  )
    .map((b) => {
      let topProd: string | null = null;
      let topUnits = 0;
      for (const p of b.productCounts.values()) {
        if (p.units > topUnits) {
          topUnits = p.units;
          topProd = p.name;
        }
      }
      return {
        branchId: b.branchId,
        branchName: b.branchName,
        branchNameAr: b.branchNameAr,
        inquiryCount: b.inquiryCount,
        requestedBaseUnits: b.requestedBaseUnits,
        distinctProductsRequested: b.productsSet.size,
        outOfStockInquiries: b.outOfStockInquiries,
        notStockedInquiries: b.notStockedInquiries,
        expiredInquiries: b.expiredInquiries,
        estimatedLostRevenue:
          b.pricedCount > 0 ? round2(b.estimatedLostRevenue) : null,
        topRequestedProductName: topProd,
      };
    })
    .sort((a, b) => b.requestedBaseUnits - a.requestedBaseUnits);

  const dailyTrends: UnmetDemandTrendPoint[] = Array.from(dailyBuckets.values())
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .map((d) => ({
      periodKey: d.periodKey,
      label: d.label,
      granularity: 'daily',
      inquiryCount: d.inquiryCount,
      requestedBaseUnits: d.requestedBaseUnits,
      confirmedIntentUnits: d.confirmedIntentUnits,
      actualUnitsSold: dailySalesMap.get(d.periodKey) || 0,
      registeredProductInquiries: d.registeredProductInquiries,
      unregisteredProductInquiries: d.unregisteredProductInquiries,
      estimatedLostRevenue:
        d.pricedCount > 0 ? round2(d.estimatedLostRevenue) : null,
    }));

  const weeklyTrends: UnmetDemandTrendPoint[] = Array.from(weeklyBuckets.values())
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .map((w) => ({
      periodKey: w.periodKey,
      label: w.label,
      granularity: 'weekly',
      inquiryCount: w.inquiryCount,
      requestedBaseUnits: w.requestedBaseUnits,
      confirmedIntentUnits: w.confirmedIntentUnits,
      actualUnitsSold: w.actualUnitsSold,
      registeredProductInquiries: w.registeredProductInquiries,
      unregisteredProductInquiries: w.unregisteredProductInquiries,
      estimatedLostRevenue:
        w.pricedCount > 0 ? round2(w.estimatedLostRevenue) : null,
    }));

  const monthlyTrends: UnmetDemandTrendPoint[] = Array.from(
    monthlyBuckets.values()
  )
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .map((m) => ({
      periodKey: m.periodKey,
      label: m.label,
      granularity: 'monthly',
      inquiryCount: m.inquiryCount,
      requestedBaseUnits: m.requestedBaseUnits,
      confirmedIntentUnits: m.confirmedIntentUnits,
      actualUnitsSold: m.actualUnitsSold,
      registeredProductInquiries: m.registeredProductInquiries,
      unregisteredProductInquiries: m.unregisteredProductInquiries,
      estimatedLostRevenue:
        m.pricedCount > 0 ? round2(m.estimatedLostRevenue) : null,
    }));

  const actualUnitsSoldInPeriod = sales.summary.unitsSold;
  const observedTotalDemandUnits =
    actualUnitsSoldInPeriod + totalRequestedBaseUnits;
  const demandCaptureEfficiencyPercent =
    observedTotalDemandUnits > 0
      ? round2((actualUnitsSoldInPeriod / observedTotalDemandUnits) * 100)
      : null;

  const dataCoveragePercent =
    totalInquiries > 0
      ? round2((pricedInquiriesCount / totalInquiries) * 100)
      : 0;

  const hasEnoughForEstimation =
    totalInquiries > 0 && pricedInquiriesCount > 0;

  let overallConfidence: SmartInsightConfidenceLevel = 'INSUFFICIENT_DATA';
  if (hasEnoughForEstimation) {
    if (totalInquiries >= 5 && dataCoveragePercent >= 80) {
      overallConfidence = 'HIGH';
    } else if (totalInquiries >= 2 && dataCoveragePercent >= 50) {
      overallConfidence = 'MEDIUM';
    } else {
      overallConfidence = 'LOW';
    }
  }

  const lostSalesEstimation: LostSalesEstimationSummary = {
    status: hasEnoughForEstimation ? 'ESTIMATED' : 'INSUFFICIENT_DATA',
    methodologyEn:
      'Conservative Intent-Weighted & 24h-Deduplicated Lost Sales Model: weights confirmed purchase intent at 65%, standard unconfirmed inquiries at 35%, same-customer 24h repeat inquiries at 15%, and fulfilled-later requests at 0%. Multiplies weighted base units by locked catalog selling/cost price snapshots.',
    methodologyAr:
      'نموذج تقدير المبيعات المفقودة التحفظي الموزون بنية الشراء وإزالة التكرار خلال 24 ساعة: يحتسب وزن 65% للطلبات ذات نية الشراء المؤكدة، و35% للاستفسارات العادية، و15% لتكرار طلب نفس العميل خلال 24 ساعة، و0% للطلبات التي تم تلبيتها لاحقاً، مضروباً في لقطة سعر البيع والتكلفة المسجلة.',
    assumptionsEn: [
      'Customer inquiries represent potential demand, not guaranteed 100% completed sales.',
      'Confirmed purchase intent (65% conversion weight) converts at a higher rate than casual browsing inquiries (35% weight).',
      'Repeat inquiries by the same identified customer within 24 hours represent the same underlying purchase need (discounted to 15% weight).',
      'Unregistered products without catalog prices are excluded from monetary lost-sales valuation (never fabricated).',
    ],
    assumptionsAr: [
      'استفسارات العملاء تمثل طلباً محتملاً وليست مبيعات مؤكدة بنسبة 100%.',
      'الطلبات ذات نية الشراء المؤكدة (وزن 65%) تتحول لمبيعات بمعدل أعلى من الاستفسارات العابرة (وزن 35%).',
      'تكرار استفسار نفس العميل خلال 24 ساعة لنفس المنتج يعبر عن نفس الحاجة الشرائية (يُخفض وزنه إلى 15%).',
      'المنتجات غير المسجلة التي لا تملك سعر بيع معروف تُستثنى من التقييم المالي ولا يتم اختلاق أسعار لها.',
    ],
    confidenceLevel: overallConfidence,
    sampleSizeInquiries: totalInquiries,
    pricedInquiriesCount,
    dataCoveragePercent,
    limitationsEn: [
      'Walk-in inquiries without a customer reference cannot be deduplicated across different hours of the day.',
      'Substitution effects (customers buying an alternative available product) may partially offset estimated lost revenue.',
    ],
    limitationsAr: [
      'الاستفسارات النقدية العابرة بدون مرجع للعميل لا يمكن تتبع تكرارها لنفس الشخص عبر ساعات اليوم المختلفة.',
      'تأثير الإحلال (شراء العميل لمنتج بديل متوفر) قد يعوض جزءاً من الإيرادات المفقودة المقدرة.',
    ],
    rawRequestedUnitsTotal: totalRequestedBaseUnits,
    dedupedConfirmedWeightedUnits: hasEnoughForEstimation
      ? round2(dedupedConfirmedWeightedUnitsTotal)
      : null,
    estimatedLostRevenue: hasEnoughForEstimation
      ? round2(estimatedLostRevenueTotal)
      : null,
    estimatedLostGrossProfit:
      hasEnoughForEstimation && canViewCost && pricedCostInquiriesCount > 0
        ? round2(estimatedLostGrossProfitTotal)
        : null,
  };

  // Recent requests (newest first, up to 50, PII redacted according to role)
  const recentRequests = [...filteredRequests]
    .reverse()
    .slice(0, 50)
    .map((r) => redactUnmetDemandRecordForRole(r, canViewPII));

  return {
    currency,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    summary: {
      totalInquiries,
      totalRequestedQuantity,
      totalRequestedBaseUnits,
      confirmedIntentInquiries,
      confirmedIntentBaseUnits,
      registeredProductInquiries,
      unregisteredProductInquiries,
      fulfilledLaterCount,
      unfulfilledCount,
      repeatCustomerInquiries,
      distinctProductsRequested: productMap.size,
      repeatedStockoutProductsCount,
      actualUnitsSoldInPeriod,
      observedTotalDemandUnits,
      demandCaptureEfficiencyPercent,
    },
    byReason,
    byCategory,
    topRequestedProducts,
    unregisteredProductsDemand,
    dailyTrends,
    weeklyTrends,
    monthlyTrends,
    byBranch,
    lostSalesEstimation,
    recentRequests,
  };
}
