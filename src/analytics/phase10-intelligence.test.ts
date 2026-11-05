/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 (Part 12): Comprehensive Automated Test Suite for Intelligent Store Operations,
 * Customer Demand Intelligence, Predictive Latent Demand Forecasting, and Smart Replenishment.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_CUSTOMERS,
  INITIAL_EXCHANGE_RATE_HISTORY,
  INITIAL_PRODUCTS,
  INITIAL_SETTINGS,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_TRANSACTIONS,
  INITIAL_UNMET_DEMAND_REQUESTS,
  INITIAL_USERS,
} from '../lib/initial-data';
import {
  buildAnalyticsSnapshotFromState,
  DEFAULT_ANALYTICS_BRANCHES,
} from './analytics.snapshot';
import { computeFullAnalyticsOverview } from './analytics.service';
import { validateAndBuildUnmetDemandRequest } from './unmet-demand.validation';
import {
  SUPPORTED_SMART_INSIGHT_CATEGORIES,
  UnmetDemandRequestRecord,
} from './analytics.types';

test('Phase 10.1: Recording unmet demand for zero-stock, expired, and unregistered products preserves strict separation from sales, inventory, and accounting', () => {
  const baseSnapshot = buildAnalyticsSnapshotFromState({
    products: INITIAL_PRODUCTS,
    transactions: INITIAL_TRANSACTIONS,
    customers: INITIAL_CUSTOMERS,
    stockMovements: INITIAL_STOCK_MOVEMENTS,
    users: INITIAL_USERS,
    exchangeRates: INITIAL_SETTINGS.exchangeRates,
    exchangeRateHistory: INITIAL_EXCHANGE_RATE_HISTORY,
    branches: DEFAULT_ANALYTICS_BRANCHES,
    unmetDemandRequests: [],
  });

  const baselineOverview = computeFullAnalyticsOverview(
    baseSnapshot,
    { datePreset: '30d', currency: 'SDG' },
    { userId: 'user-1', role: 'admin' }
  );

  // Build 3 distinct inquiries:
  // 1) Registered zero-stock product
  const zeroStockProduct = { ...INITIAL_PRODUCTS[4], stock: 0 }; // prod-5 Pistachio Cardamom Bun
  const req1 = validateAndBuildUnmetDemandRequest({
    input: {
      productId: zeroStockProduct.id,
      requestedQuantity: 5,
      unavailabilityReason: 'OUT_OF_STOCK',
      confirmedPurchaseIntent: true,
      branchId: 'branch-main',
      customerId: 'cust-1',
      customerReference: 'Sarah Al-Mansoor',
    },
    claimingUserId: INITIAL_USERS[0].id,
    serverUsers: INITIAL_USERS,
    catalogProducts: [zeroStockProduct, ...INITIAL_PRODUCTS.slice(0, 4)],
    existingRequests: [],
    now: new Date(),
  });
  assert.equal(req1.valid, true);
  assert.equal(req1.record?.availabilityStatus, 'OUT_OF_STOCK');

  // 2) Expired batch product
  const req2 = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-4',
      requestedQuantity: 2,
      unavailabilityReason: 'EXPIRED',
      confirmedPurchaseIntent: true,
      branchId: 'branch-main',
    },
    claimingUserId: INITIAL_USERS[0].id,
    serverUsers: INITIAL_USERS,
    catalogProducts: INITIAL_PRODUCTS,
    existingRequests: [req1.record!],
    now: new Date(),
  });
  assert.equal(req2.valid, true);
  assert.equal(req2.record?.availabilityStatus, 'EXPIRED');

  // 3) Unregistered catalog product
  const req3 = validateAndBuildUnmetDemandRequest({
    input: {
      productName: 'Organic Ceremonial Matcha 100g',
      barcode: '490101099281',
      requestedQuantity: 4,
      unavailabilityReason: 'NOT_STOCKED',
      confirmedPurchaseIntent: false,
      branchId: 'branch-main',
    },
    claimingUserId: INITIAL_USERS[2].id, // Cashier
    serverUsers: INITIAL_USERS,
    catalogProducts: INITIAL_PRODUCTS,
    existingRequests: [req1.record!, req2.record!],
    now: new Date(),
  });
  assert.equal(req3.valid, true);
  assert.equal(req3.record?.isRegisteredProduct, false);
  assert.equal(req3.record?.unitSellingPriceSnapshot, null);

  const withUnmetSnapshot = buildAnalyticsSnapshotFromState({
    products: INITIAL_PRODUCTS,
    transactions: INITIAL_TRANSACTIONS,
    customers: INITIAL_CUSTOMERS,
    stockMovements: INITIAL_STOCK_MOVEMENTS,
    users: INITIAL_USERS,
    exchangeRates: INITIAL_SETTINGS.exchangeRates,
    exchangeRateHistory: INITIAL_EXCHANGE_RATE_HISTORY,
    branches: DEFAULT_ANALYTICS_BRANCHES,
    unmetDemandRequests: [req1.record!, req2.record!, req3.record!],
  });

  const withUnmetOverview = computeFullAnalyticsOverview(
    withUnmetSnapshot,
    { datePreset: '30d', currency: 'SDG' },
    { userId: 'user-1', role: 'admin' }
  );

  // STRICT SEPARATION VERIFICATION:
  // Completed sales, COGS, Gross Profit, Cash Flow, and On-Hand Stock MUST NOT change when unmet demand is recorded!
  assert.equal(
    withUnmetOverview.sales.summary.grossSales,
    baselineOverview.sales.summary.grossSales
  );
  assert.equal(
    withUnmetOverview.sales.summary.netSales,
    baselineOverview.sales.summary.netSales
  );
  assert.equal(
    withUnmetOverview.sales.summary.unitsSold,
    baselineOverview.sales.summary.unitsSold
  );
  assert.equal(
    withUnmetOverview.financial.profitAndLoss.grossProfit,
    baselineOverview.financial.profitAndLoss.grossProfit
  );
  assert.equal(
    withUnmetOverview.inventory.summary.totalStockUnits,
    baselineOverview.inventory.summary.totalStockUnits
  );

  // Verify Unmet Demand aggregation
  const ud = withUnmetOverview.intelligence.unmetDemand;
  assert.equal(ud.summary.totalInquiries, 3);
  assert.equal(ud.summary.totalRequestedBaseUnits, 5 + 2 + 4);
  assert.equal(ud.summary.registeredProductInquiries, 2);
  assert.equal(ud.summary.unregisteredProductInquiries, 1);
  assert.equal(ud.unregisteredProductsDemand.length, 1);
  assert.equal(
    ud.unregisteredProductsDemand[0].lostSalesEstimationStatus,
    'INSUFFICIENT_DATA'
  );
  assert.equal(
    ud.unregisteredProductsDemand[0].estimatedLostRevenueConservative,
    null
  );
});

test('Phase 10.2: Conservative Lost Sales Estimation applies intent weights, discounts 24h repeat customer inquiries, and never overstates raw requests as 100% lost sales', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');
  const t1 = new Date('2026-11-03T09:00:00.000Z').toISOString();
  const t2 = new Date('2026-11-03T11:00:00.000Z').toISOString(); // Same customer within 2 hours (<24h)

  // Product 5 sellingPrice = 4.75 SDG, costPrice = 1.60 SDG
  const inquiries: UnmetDemandRequestRecord[] = [
    {
      id: 'udr-repeat-1',
      idempotencyKey: 'idem-rep-1',
      dedupeFingerprint: 'fp-rep-1',
      branchId: 'branch-main',
      productId: 'prod-5',
      isRegisteredProduct: true,
      productNameSnapshot: 'Pistachio Cardamom Bun',
      productNameArSnapshot: 'لفافة الفستق والهيل',
      skuSnapshot: 'BAK-002',
      barcode: '200201002025',
      categorySnapshot: 'Bakery',
      requestedTimestamp: t1,
      requestedQuantity: 10,
      saleUnitMode: 'unit',
      requestedBaseUnits: 10,
      availableStockAtRequest: 0,
      availabilityStatus: 'OUT_OF_STOCK',
      unavailabilityReason: 'OUT_OF_STOCK',
      confirmedPurchaseIntent: true, // Weight = 0.65 => 6.5 weighted units
      fulfillmentStatus: 'unfulfilled',
      unitSellingPriceSnapshot: 4.75,
      unitCostPriceSnapshot: 1.6,
      currencySnapshot: 'SDG',
      exchangeRateSnapshot: 1,
      customerId: 'cust-1',
      customerReference: 'Sarah Al-Mansoor',
      notes: 'First morning inquiry',
      recordedByUserId: 'user-1',
      recordedByName: 'Ahmed Al-Amin',
      sourceScreen: 'checkout',
      createdAt: t1,
    },
    {
      id: 'udr-repeat-2',
      idempotencyKey: 'idem-rep-2',
      dedupeFingerprint: 'fp-rep-2',
      branchId: 'branch-main',
      productId: 'prod-5',
      isRegisteredProduct: true,
      productNameSnapshot: 'Pistachio Cardamom Bun',
      productNameArSnapshot: 'لفافة الفستق والهيل',
      skuSnapshot: 'BAK-002',
      barcode: '200201002025',
      categorySnapshot: 'Bakery',
      requestedTimestamp: t2,
      requestedQuantity: 10,
      saleUnitMode: 'unit',
      requestedBaseUnits: 10,
      availableStockAtRequest: 0,
      availabilityStatus: 'OUT_OF_STOCK',
      unavailabilityReason: 'OUT_OF_STOCK',
      confirmedPurchaseIntent: true, // Repeat customer within 24h => Weight = 0.15 => 1.5 weighted units
      fulfillmentStatus: 'unfulfilled',
      unitSellingPriceSnapshot: 4.75,
      unitCostPriceSnapshot: 1.6,
      currencySnapshot: 'SDG',
      exchangeRateSnapshot: 1,
      customerId: 'cust-1',
      customerReference: 'Sarah Al-Mansoor',
      notes: 'Asked again 2 hours later',
      recordedByUserId: 'user-1',
      recordedByName: 'Ahmed Al-Amin',
      sourceScreen: 'checkout',
      createdAt: t2,
    },
  ];

  const snapshot = buildAnalyticsSnapshotFromState({
    products: INITIAL_PRODUCTS,
    transactions: INITIAL_TRANSACTIONS,
    customers: INITIAL_CUSTOMERS,
    stockMovements: INITIAL_STOCK_MOVEMENTS,
    users: INITIAL_USERS,
    exchangeRates: INITIAL_SETTINGS.exchangeRates,
    exchangeRateHistory: INITIAL_EXCHANGE_RATE_HISTORY,
    branches: DEFAULT_ANALYTICS_BRANCHES,
    unmetDemandRequests: inquiries,
  });

  const overview = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', currency: 'SDG' },
    { userId: 'user-1', role: 'admin' },
    now
  );

  const ls = overview.intelligence.unmetDemand.lostSalesEstimation;
  assert.equal(ls.status, 'ESTIMATED');
  assert.equal(ls.rawRequestedUnitsTotal, 20);
  // 10 * 0.65 + 10 * 0.15 = 8.0 weighted units (strictly less than 20 raw units)
  assert.equal(ls.dedupedConfirmedWeightedUnits, 8);
  // 8.0 * 4.75 = 38.00 SDG
  assert.equal(ls.estimatedLostRevenue, 38);
  // 8.0 * (4.75 - 1.60) = 8.0 * 3.15 = 25.20 SDG
  assert.equal(ls.estimatedLostGrossProfit, 25.2);
  assert.equal(overview.intelligence.unmetDemand.summary.repeatCustomerInquiries, 1);
  assert.equal(
    overview.intelligence.unmetDemand.summary.repeatedStockoutProductsCount,
    1
  );
});

test('Phase 10.3: Predictive Demand Engine compensates for stockout censoring across 7, 30, and 90-day horizons and produces Baseline vs. Latent comparison', () => {
  const snapshot = buildAnalyticsSnapshotFromState({
    products: INITIAL_PRODUCTS,
    transactions: INITIAL_TRANSACTIONS,
    customers: INITIAL_CUSTOMERS,
    stockMovements: INITIAL_STOCK_MOVEMENTS,
    users: INITIAL_USERS,
    exchangeRates: INITIAL_SETTINGS.exchangeRates,
    exchangeRateHistory: INITIAL_EXCHANGE_RATE_HISTORY,
    branches: DEFAULT_ANALYTICS_BRANCHES,
    unmetDemandRequests: INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[],
  });

  for (const horizon of [7, 30, 90] as const) {
    const overview = computeFullAnalyticsOverview(
      snapshot,
      { datePreset: '30d', currency: 'SDG', forecastHorizonDays: horizon },
      { userId: 'user-1', role: 'admin' }
    );

    const fc = overview.forecasts;
    assert.equal(fc.horizonDays, horizon);
    assert.ok(fc.predictiveDemandComparison);
    assert.ok(
      fc.predictiveDemandComparison.unmetDemandSignalsCount >= 5,
      'Should include unmet demand signals from seed requests'
    );
    assert.ok(
      (fc.revenueForecastSummary.estimatedLatentDemandRevenue || 0) >=
        fc.revenueForecastSummary.expectedTotalNetSales,
      'Latent-adjusted forecast revenue must be >= baseline sales-only forecast when unmet demand exists'
    );

    const prod5Forecast = fc.productDemandForecasts.find(
      (p) => p.productId === 'prod-5'
    );
    assert.ok(prod5Forecast);
    assert.equal(prod5Forecast.observedUnmetDemandUnits, 10); // 6 + 4 from seed
    assert.ok(
      (prod5Forecast.estimatedLatentDailyDemand || 0) >
        prod5Forecast.forecastedDailyDemand,
      'Latent daily demand for stockout-censored prod-5 must exceed observed sales-only daily demand'
    );
  }
});

test('Phase 10.4: Smart Replenishment, Inter-Branch Stock Transfers, and Unified 10-Category Alerts generate explainable recommendations requiring approval', () => {
  const snapshot = buildAnalyticsSnapshotFromState({
    products: INITIAL_PRODUCTS,
    transactions: INITIAL_TRANSACTIONS,
    customers: INITIAL_CUSTOMERS,
    stockMovements: INITIAL_STOCK_MOVEMENTS,
    users: INITIAL_USERS,
    exchangeRates: INITIAL_SETTINGS.exchangeRates,
    exchangeRateHistory: INITIAL_EXCHANGE_RATE_HISTORY,
    branches: DEFAULT_ANALYTICS_BRANCHES,
    unmetDemandRequests: INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[],
  });

  const overview = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', currency: 'SDG', leadTimeDays: 4, safetyStockDays: 2 },
    { userId: 'user-1', role: 'admin' }
  );

  const intel = overview.intelligence;
  assert.ok(intel.overview.totalActiveAlerts > 0);
  assert.ok(intel.replenishmentRecommendations.length > 0);

  // Every replenishment recommendation must require user approval
  for (const rec of intel.replenishmentRecommendations) {
    assert.equal(rec.approvalStatus, 'requires_user_approval');
    assert.ok(rec.recommendedOrderUnits > 0);
    assert.ok(rec.explanationEn.length > 10);
  }

  // Verify Inter-Branch Transfer Opportunity is generated where main branch has surplus and another branch has unmet demand
  assert.ok(
    intel.branchTransferOpportunities.length > 0,
    'Should recommend inter-branch transfer when one branch has surplus stock and another branch has unmet demand'
  );
  for (const tr of intel.branchTransferOpportunities) {
    assert.equal(tr.approvalStatus, 'requires_user_approval');
    assert.notEqual(tr.fromBranchId, tr.toBranchId);
    assert.ok(tr.recommendedTransferUnits > 0);
  }

  // Verify category coverage map has all 10 supported categories initialized
  for (const cat of SUPPORTED_SMART_INSIGHT_CATEGORIES) {
    assert.equal(typeof intel.overview.byCategory[cat], 'number');
  }
});

test('Phase 10.5: Role-Based Access Control (RBAC) masks financial/cost intelligence and redacts customer PII for Cashier and Inventory Clerk roles', () => {
  const snapshot = buildAnalyticsSnapshotFromState({
    products: INITIAL_PRODUCTS,
    transactions: INITIAL_TRANSACTIONS,
    customers: INITIAL_CUSTOMERS,
    stockMovements: INITIAL_STOCK_MOVEMENTS,
    users: INITIAL_USERS,
    exchangeRates: INITIAL_SETTINGS.exchangeRates,
    exchangeRateHistory: INITIAL_EXCHANGE_RATE_HISTORY,
    branches: DEFAULT_ANALYTICS_BRANCHES,
    unmetDemandRequests: INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[],
  });

  // Cashier (user-3)
  const cashierOverview = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', currency: 'SDG' },
    {
      userId: 'user-3',
      role: 'cashier',
      assignedTerminalName: 'POS Terminal 03 (Express)',
    }
  );

  // 1) Cost and Gross Profit in Lost Sales must be masked as null for Cashier
  assert.equal(
    cashierOverview.intelligence.unmetDemand.lostSalesEstimation
      .estimatedLostGrossProfit,
    null
  );
  for (const p of cashierOverview.intelligence.unmetDemand.topRequestedProducts) {
    assert.equal(p.estimatedLostGrossProfitConservative, null);
  }

  // 2) Financial risks must be empty for Cashier (no financial permission)
  assert.equal(cashierOverview.intelligence.financialRisks.length, 0);

  // 3) Replenishment cost must be masked as null for Cashier
  assert.equal(
    cashierOverview.intelligence.overview.totalRecommendedReplenishmentCost,
    null
  );
  for (const rec of cashierOverview.intelligence.replenishmentRecommendations) {
    assert.equal(rec.estimatedOrderCost, null);
    assert.equal(rec.unitCost, null);
  }

  // Inventory Clerk (user-4) — cannot view customer PII
  const clerkOverview = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', currency: 'SDG' },
    {
      userId: 'user-4',
      role: 'inventory_clerk',
      assignedTerminalName: 'Warehouse Terminal 04',
    }
  );
  for (const req of clerkOverview.intelligence.unmetDemand.recentRequests) {
    if (req.customerReference) {
      assert.equal(req.customerReference, '[REDACTED]');
    }
  }
});
