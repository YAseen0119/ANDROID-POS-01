/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsSnapshotFromState } from './analytics.repository';
import { computeFullAnalyticsOverview } from './analytics.service';
import {
  computeEMA,
  computeLinearRegressionTrend,
  computeMACD,
  computeRSI,
  computeSMA,
  computeSupportAndResistance,
} from './indicators/technical-analysis';
import {
  computeAccuracyMetrics,
  evaluateAndSelectBestModel,
} from './forecasting/forecasting.engine';
import { Product, Transaction } from '../lib/types';

test('Phase 1: Data Source Consistency & Deduplication eliminates duplicate transactions, SKUs, returns, and stock movements', () => {
  const now = new Date('2026-10-29T18:00:00.000Z');
  const tx1: Transaction = {
    id: 'TX-DUP-1',
    idempotencyKey: 'idem-key-100',
    timestamp: '2026-10-29T10:00:00.000Z',
    currency: 'SDG',
    exchangeRateUsed: 2500,
    exchangeRatesSnapshot: { SDG: 1, USD: 2500 },
    items: [
      {
        productId: 'prod-1',
        productName: 'Espresso Double Shot',
        sku: 'BEV-001',
        quantity: 2,
        unitPrice: 10,
        discountPercent: 0,
        total: 20,
      },
    ],
    subtotal: 20,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 20,
    paymentMethod: 'cash',
    amountTendered: 20,
    changeDue: 0,
    paymentStatus: 'paid',
    amountPaid: 20,
    debtAmount: 0,
    cashierName: 'POS Terminal 01',
    status: 'completed',
    syncStatus: 'pending_sync',
  };

  // Duplicate with same idempotencyKey but different id and 'synced' status
  const tx1SyncedCopy: Transaction = {
    ...tx1,
    id: 'TX-DUP-1-PG',
    syncStatus: 'synced',
  };

  const snapshot = buildAnalyticsSnapshotFromState({
    transactions: [tx1, tx1SyncedCopy, tx1],
  });

  assert.equal(
    snapshot.transactions.length,
    1,
    'Duplicate transactions by id or idempotencyKey must be deduplicated to 1 canonical record'
  );
  assert.equal(snapshot.transactions[0].syncStatus, 'synced');
  assert.ok(Array.isArray(snapshot.sourceOfTruthMatrix));
  assert.ok((snapshot.sourceOfTruthMatrix?.length ?? 0) >= 6);

  const overview = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '7d', currency: 'SDG' },
    { userId: 'user-1', role: 'admin' },
    now
  );
  assert.equal(overview.sales.summary.netSales, 20);
  assert.equal(overview.sales.summary.transactionCount, 1);
});

test('Phase 2: 4-Tier Historical COGS Hierarchy reconstructs cost from priceHistory, flags current catalog cost as estimated, and never fabricates 0.45 fallback cost', () => {
  const now = new Date('2026-10-29T18:00:00.000Z');

  // Product repriced on Oct 27 from cost 4.00 -> 7.00 SDG
  const repricedProduct: Product = {
    id: 'prod-hist-1',
    name: 'Repriced Coffee Beans',
    sku: 'COF-HIST-1',
    barcode: '200100999001',
    category: 'Coffee',
    sellingPrice: 15,
    costPrice: 7, // Today's cost is 7
    priceCurrency: 'SDG',
    stock: 20,
    minStockAlert: 5,
    updatedAt: '2026-10-27T12:00:00.000Z',
    priceHistory: [
      {
        id: 'ph-1',
        timestamp: '2026-10-27T12:00:00.000Z',
        previousSellingPrice: 12,
        newSellingPrice: 15,
        previousCostPrice: 4, // Before Oct 27, cost was 4
        newCostPrice: 7,
        currency: 'SDG',
        note: 'Supplier cost increase',
      },
    ],
  };

  // Sale 1 occurred on Oct 25 (BEFORE the Oct 27 cost increase -> historical cost was 4, NOT 7!)
  const txBeforeCostChange: Transaction = {
    id: 'TX-COGS-HIST',
    idempotencyKey: 'cogs-hist-1',
    timestamp: '2026-10-25T10:00:00.000Z',
    currency: 'SDG',
    exchangeRateUsed: 1,
    exchangeRatesSnapshot: { SDG: 1, USD: 2500 },
    items: [
      {
        productId: 'prod-hist-1',
        productName: 'Repriced Coffee Beans',
        sku: 'COF-HIST-1',
        quantity: 2,
        unitPrice: 12,
        discountPercent: 0,
        total: 24,
      },
    ],
    subtotal: 24,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 24,
    paymentMethod: 'cash',
    amountTendered: 24,
    changeDue: 0,
    paymentStatus: 'paid',
    amountPaid: 24,
    debtAmount: 0,
    cashierName: 'POS Terminal 01',
    status: 'completed',
    syncStatus: 'synced',
  };

  const snapshotHist = buildAnalyticsSnapshotFromState({
    products: [repricedProduct],
    transactions: [txBeforeCostChange],
    stockMovements: [],
  });

  const overviewHist = computeFullAnalyticsOverview(
    snapshotHist,
    { datePreset: '30d', currency: 'SDG', valuationMode: 'historical' },
    { userId: 'user-1', role: 'admin' },
    now
  );

  // Historical cost on Oct 25 must be 2 * 4 = 8 SDG (NOT 2 * 7 = 14 SDG!)
  assert.equal(overviewHist.financial.profitAndLoss.costOfGoodsSold, 8);
  assert.equal(overviewHist.financial.profitAndLoss.grossProfit, 16);
  assert.equal(
    overviewHist.sales.cogsDataQuality,
    'reconstructed_from_price_history'
  );
  assert.equal(overviewHist.financial.profitAndLoss.isGrossProfitEstimated, false);
  assert.equal(
    overviewHist.financial.profitAndLoss.exactHistoricalCogsPortion,
    8
  );

  // Now test a deleted/unknown product with no cost record: must NOT invent 0.45 * total!
  const txDeletedProduct: Transaction = {
    ...txBeforeCostChange,
    id: 'TX-DELETED-PROD',
    idempotencyKey: 'cogs-del-1',
    items: [
      {
        productId: 'prod-deleted-999',
        productName: 'Deleted Legacy Item',
        sku: 'DEL-999',
        quantity: 1,
        unitPrice: 100,
        discountPercent: 0,
        total: 100,
      },
    ],
    subtotal: 100,
    grandTotal: 100,
    amountTendered: 100,
    amountPaid: 100,
  };

  const snapshotMissingCost = buildAnalyticsSnapshotFromState({
    products: [repricedProduct],
    transactions: [txDeletedProduct],
    stockMovements: [],
  });

  const overviewMissing = computeFullAnalyticsOverview(
    snapshotMissingCost,
    { datePreset: '30d', currency: 'SDG', valuationMode: 'historical' },
    { userId: 'user-1', role: 'admin' },
    now
  );

  assert.equal(
    overviewMissing.financial.profitAndLoss.costOfGoodsSold,
    0,
    'Missing product cost must NEVER fabricate 45% of revenue'
  );
  assert.equal(
    overviewMissing.sales.cogsDataQuality,
    'incomplete_missing_cost'
  );
  assert.equal(overviewMissing.financial.profitAndLoss.isGrossProfitEstimated, true);
  assert.equal(
    overviewMissing.financial.profitAndLoss.unresolvableCostRevenuePortion,
    100
  );
});

test('Phase 3: Completed, Voided, Full Return, Single Partial Return, Multiple Partial Returns, Tax-Inclusive vs Tax-Exclusive, and Credit Split Payments reconcile accurately', () => {
  const now = new Date('2026-10-29T18:00:00.000Z');
  const testProd: Product = {
    id: 'prod-1',
    name: 'Espresso Double Shot',
    sku: 'BEV-001',
    barcode: '200100999002',
    category: 'Coffee',
    sellingPrice: 10,
    costPrice: 4,
    priceCurrency: 'SDG',
    stock: 50,
    minStockAlert: 10,
    updatedAt: '2026-10-28T08:00:00.000Z',
  };

  // 1. Tax-Exclusive Invoice with item + global discounts + 2 partial returns
  const txTaxExclusive: Transaction = {
    id: 'TX-EX-1',
    idempotencyKey: 'tx-ex-1',
    timestamp: '2026-10-28T10:00:00.000Z',
    currency: 'SDG',
    exchangeRateUsed: 1,
    exchangeRatesSnapshot: { SDG: 1, USD: 2500 },
    items: [
      {
        productId: 'prod-1',
        productName: 'Espresso Double Shot',
        sku: 'BEV-001',
        quantity: 4,
        unitPrice: 10,
        discountPercent: 10, // Gross = 40, item discount = 4 -> line total = 36
        total: 36,
      },
    ],
    subtotal: 36,
    discountAmount: 6, // Global discount = 6 -> ex-tax net before return = 30
    taxRatePercent: 10,
    taxAmount: 3, // 10% tax on 30 = 3
    grandTotal: 33, // Tax-exclusive: 30 + 3 = 33
    paymentMethod: 'cash',
    amountTendered: 20,
    changeDue: 0,
    paymentStatus: 'partial',
    amountPaid: 25, // 20 upfront + 5 debt payment
    debtAmount: 8,
    debtPayments: [
      {
        id: 'dp-1',
        timestamp: '2026-10-28T15:00:00.000Z',
        amountPaid: 5,
        remainingDebtAfter: 8,
        paymentMethod: 'bank_transfer',
        note: 'Partial installment',
      },
    ],
    cashierName: 'POS Terminal 01',
    status: 'completed',
    syncStatus: 'synced',
  };

  // 2. Tax-Inclusive Invoice: subtotal = 110, discount = 0, taxAmount = 10, grandTotal = 110 (tax already inside subtotal)
  const txTaxInclusive: Transaction = {
    id: 'TX-INC-2',
    idempotencyKey: 'tx-inc-2',
    timestamp: '2026-10-28T12:00:00.000Z',
    currency: 'SDG',
    exchangeRateUsed: 1,
    exchangeRatesSnapshot: { SDG: 1, USD: 2500 },
    items: [
      {
        productId: 'prod-1',
        productName: 'Espresso Double Shot',
        sku: 'BEV-001',
        quantity: 10,
        unitPrice: 11,
        discountPercent: 0,
        total: 110,
      },
    ],
    subtotal: 110,
    discountAmount: 0,
    taxRatePercent: 10,
    taxAmount: 10,
    grandTotal: 110, // Tax-inclusive: grandTotal == subtotal (110), so ex-tax net = 100!
    paymentMethod: 'cash',
    amountTendered: 110,
    changeDue: 0,
    paymentStatus: 'paid',
    amountPaid: 110,
    debtAmount: 0,
    cashierName: 'POS Terminal 01',
    status: 'completed',
    syncStatus: 'synced',
  };

  // 3. Voided Invoice: must be excluded from Gross Sales, Net Sales, and Tax Collected
  const txVoided: Transaction = {
    ...txTaxInclusive,
    id: 'TX-VOID-3',
    idempotencyKey: 'tx-void-3',
    status: 'voided',
  };

  // Two partial returns against TX-EX-1 (1 unit returned each time = 2 units returned total, 16.50 SDG billed refund = 15 net + 1.50 tax)
  const snapshot = buildAnalyticsSnapshotFromState({
    products: [testProd],
    transactions: [txTaxExclusive, txTaxInclusive, txVoided],
    returns: [
      {
        id: 'RET-1',
        saleId: 'TX-EX-1',
        refundTotal: 8.25, // 1/4 of 33 billed grandTotal (7.50 net + 0.75 tax)
        timestamp: '2026-10-28T16:00:00.000Z',
        items: [{ productId: 'prod-1', quantity: 1, refundAmount: 8.25 }],
      },
      {
        id: 'RET-2',
        saleId: 'TX-EX-1',
        refundTotal: 8.25, // Another 1/4 returned -> total returned = 16.50 billed (15.00 net + 1.50 tax, 2 units)
        timestamp: '2026-10-28T17:00:00.000Z',
        items: [{ productId: 'prod-1', quantity: 1, refundAmount: 8.25 }],
      },
    ],
    stockMovements: [],
  });

  const overview = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '7d', currency: 'SDG', valuationMode: 'historical' },
    { userId: 'user-1', role: 'admin' },
    now
  );

  const s = overview.sales.summary;
  // Gross Sales (ex-tax, pre-discount): TX-EX-1 (40) + TX-INC-2 (110 - 10 tax = 100) = 140
  assert.equal(s.grossSales, 140);
  // Total Discounts: TX-EX-1 (4 item + 6 global = 10)
  assert.equal(s.discountsTotal, 10);
  // Net Sales before returns = 30 + 100 = 130; minus net returns (15) = 115
  assert.equal(s.netSales, 115);
  // Tax Collected: TX-EX-1 (3 - 1.50 returned = 1.50) + TX-INC-2 (10) = 11.50
  assert.equal(s.taxCollected, 11.5);
  // Returns tracked separately from Voids
  assert.equal(s.merchandiseReturnsCount, 2);
  assert.equal(s.merchandiseReturnsBilledTotal, 16.5);
  assert.equal(s.voidedTransactionCount, 1);
  assert.equal(s.voidedSalesAmount, 110);
  // COGS: (4 + 10 - 2 returned = 12 net units) * 4 SDG cost = 48 SDG
  assert.equal(s.unitsSold, 12);
  assert.equal(overview.financial.profitAndLoss.costOfGoodsSold, 48);
  assert.equal(overview.financial.profitAndLoss.grossProfit, 67); // 115 - 48 = 67

  // Cash flow separation: upfront (20 + 110 = 130), debt settlements (5), minus cash refund (16.5) = 118.5
  const cf = overview.financial.cashFlowAndWorkingCapital;
  assert.equal(cf.cashInflowsFromSalesAtCheckout, 130);
  assert.equal(cf.cashInflowsFromDebtSettlements, 5);
  assert.equal(cf.cashRefundsForReturns, 16.5);
  assert.equal(cf.totalCashInflows, 118.5);
});

test('Phase 4: Financial P&L separates Profit After Recorded Shrinkage from unavailable Net Operating Profit and Break-Even requires Fixed Operating Costs', () => {
  const now = new Date();
  const snapshot = buildAnalyticsSnapshotFromState();

  // Default (without fixedOperatingExpensesOverride): NetOperatingProfit and BreakEven must be null / unavailable
  const defaultView = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', currency: 'SDG', valuationMode: 'historical' },
    { userId: 'user-1', role: 'admin' },
    now
  );

  const pnl = defaultView.financial.profitAndLoss;
  assert.equal(pnl.netSalesRevenue, defaultView.sales.summary.netSales);
  assert.equal(
    pnl.profitAfterRecordedShrinkage,
    Math.round(
      ((pnl.grossProfit ?? 0) - (pnl.recordedShrinkageAndDamageExpense ?? 0)) * 100
    ) / 100
  );
  assert.equal(pnl.generalOperatingExpenses, null);
  assert.equal(pnl.operatingProfitStatus, 'unavailable_missing_operating_expenses');
  assert.equal(
    pnl.netOperatingProfit,
    null,
    'Net Operating Profit must be null when general operating expenses are not recorded'
  );
  assert.equal(
    defaultView.financial.breakEvenAnalysis.status,
    'unavailable_missing_fixed_costs'
  );
  assert.equal(
    defaultView.financial.breakEvenAnalysis.breakEvenSalesRevenue,
    null,
    'Break-even revenue must not divide inventory restock purchases by gross margin'
  );

  // With explicit fixedOperatingExpensesOverride = 50 SDG: both Net Operating Profit and Break-Even compute accurately
  const overrideView = computeFullAnalyticsOverview(
    snapshot,
    {
      datePreset: '30d',
      currency: 'SDG',
      valuationMode: 'historical',
      fixedOperatingExpensesOverride: 50,
    },
    { userId: 'user-1', role: 'admin' },
    now
  );

  const pnlWithOpEx = overrideView.financial.profitAndLoss;
  assert.equal(pnlWithOpEx.generalOperatingExpenses, 50);
  assert.equal(
    pnlWithOpEx.operatingProfitStatus,
    'available'
  );
  assert.equal(
    pnlWithOpEx.netOperatingProfit,
    Math.round(((pnlWithOpEx.profitAfterRecordedShrinkage ?? 0) - 50) * 100) / 100
  );
  assert.equal(
    overrideView.financial.breakEvenAnalysis.status,
    'available'
  );
  assert.ok((overrideView.financial.breakEvenAnalysis.breakEvenSalesRevenue ?? 0) > 50);
});

test('Phase 5: Inventory metrics reconstruct beginning stock, compute cost-based turnover (COGS / AvgInventoryCost) separately from unit sell-through, and deduct pending inbound orders from reorder quantity', () => {
  const now = new Date('2026-10-29T18:00:00.000Z');
  const snapshot = buildAnalyticsSnapshotFromState({
    purchases: [
      {
        id: 'PO-PENDING-1',
        purchaseNumber: 'PO-2026-001',
        supplierName: 'Al-Nilein Roasters',
        branchId: 'branch-main',
        invoiceDate: '2026-10-28T10:00:00.000Z',
        totalAmount: 100,
        paidAmount: 0,
        status: 'ordered', // Pending inbound order of 15 units for prod-3
        currency: 'SDG',
        items: [{ productId: 'prod-3', quantity: 15, unitCost: 12, totalCost: 180 }],
      },
    ],
  });

  const inv = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', abcBasis: 'revenue', leadTimeDays: 3, safetyStockDays: 2 },
    { userId: 'user-1', role: 'admin' },
    now
  ).inventory;

  assert.equal(inv.costAccessStatus, 'authorized');
  assert.ok((inv.summary.totalInventoryValueAtCost ?? 0) > 0);
  assert.ok((inv.summary.totalAverageInventoryValueAtCost ?? 0) > 0);
  assert.ok((inv.summary.overallCostBasedTurnoverRatio ?? 0) >= 0);
  assert.ok(inv.summary.overallUnitSellThroughRatio >= 0);

  // Verify prod-3 has pendingInboundPurchaseUnits = 15 accounted for in reorder evaluation
  const prod3 = inv.products.find((p) => p.productId === 'prod-3');
  assert.ok(prod3);
  assert.equal(prod3.pendingInboundPurchaseUnits, 15);
  assert.equal(prod3.reorderRecommendation.pendingInboundUnitsDeducted, 15);
  // Since currentStock (6) + pendingInbound (15) = 21 units > reorderPointUnits, prod-3 no longer needs duplicate reorder!
  assert.equal(prod3.reorderRecommendation.shouldReorder, false);
  assert.equal(prod3.reorderRecommendation.recommendedOrderQuantity, 0);
});

test('Phase 6: Statistical forecasting engine performs multi-origin rolling backtesting across 7, 30, and 90-day horizons against Naive baseline and reports bias & coverage', () => {
  const steadySeries = [45, 48, 52, 50, 49, 51, 50, 48, 52, 50, 49, 51, 50, 50];
  const eval7 = evaluateAndSelectBestModel(steadySeries, 7);

  // Must evaluate all 5 models including naive_last_value
  assert.equal(eval7.evaluations.length, 5);
  assert.ok(eval7.evaluations.some((e) => e.model === 'naive_last_value'));
  assert.equal(eval7.evaluations.filter((e) => e.isSelectedWinner).length, 1);
  assert.ok(eval7.evaluations[0].rollingOriginsCount >= 1);
  assert.ok(eval7.evaluations[0].empiricalCoverage80Percent !== null);
  assert.ok(eval7.evaluations[0].empiricalCoverage95Percent !== null);

  // Signed bias check
  const acc = computeAccuracyMetrics([100, 100], [110, 120]);
  assert.equal(acc.mae, 15);
  assert.equal(acc.wapePercent, 15);
  assert.equal(acc.forecastBias, 15); // Over-forecast by +15
  assert.equal(acc.biasPercent, 15); // +15% positive bias

  const snapshot = buildAnalyticsSnapshotFromState();
  for (const horizon of [7, 30, 90] as const) {
    const overview = computeFullAnalyticsOverview(
      snapshot,
      {
        datePreset: '30d',
        forecastHorizonDays: horizon,
      },
      { userId: 'user-1' }
    );
    const f = overview.forecasts;
    assert.equal(f.horizonDays, horizon);
    // Since sample store has 8 active days (< 21), bands must be labeled 'estimated_uncertainty_range'
    assert.equal(f.intervalCalibrationStatus, 'estimated_uncertainty_range');
    assert.ok(f.intervalLabelEn.includes('Estimated Uncertainty Ranges'));
    const futurePoints = f.revenueSeries.filter((p) => !p.isHistorical);
    assert.equal(futurePoints.length, horizon);
  }
});

test('Phase 7: Server-side RBAC prevents client role/branch spoofing and masks restricted financial & cost fields as null (NEVER 0)', () => {
  const now = new Date();
  const snapshot = buildAnalyticsSnapshotFromState();

  // 1. Cashier ('user-3') attempts to spoof role='admin' and branchId='all'
  const spoofAttemptView = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', branchId: 'all' },
    {
      userId: 'user-3', // Registered in dataset.users as role: 'cashier', terminalName: 'POS Terminal 03 (Express)'
      role: 'admin', // Spoofed header!
      assignedBranchId: 'all', // Spoofed branch!
    },
    now
  );

  // Server store verification must override spoofed role back to 'cashier'
  assert.equal(spoofAttemptView.userContext.roleVerifiedFromServerStore, true);
  assert.equal(spoofAttemptView.userContext.role, 'cashier');
  assert.equal(spoofAttemptView.userContext.canViewFinancials, false);
  assert.equal(spoofAttemptView.userContext.canViewCostAndMargin, false);
  assert.equal(spoofAttemptView.filtersApplied.branchId, 'branch-main');
  assert.equal(
    spoofAttemptView.filtersApplied.cashierName,
    'POS Terminal 03 (Express)'
  );

  // Restricted fields must be masked as `null`, NEVER `0`!
  assert.equal(
    spoofAttemptView.financial.financialAccessStatus,
    'restricted_by_role'
  );
  assert.equal(spoofAttemptView.financial.profitAndLoss.grossProfit, null);
  assert.equal(spoofAttemptView.financial.profitAndLoss.costOfGoodsSold, null);
  assert.equal(
    spoofAttemptView.financial.profitAndLoss.profitAfterRecordedShrinkage,
    null
  );
  assert.equal(spoofAttemptView.sales.costAccessStatus, 'restricted_by_role');
  assert.equal(spoofAttemptView.sales.dailySeries[0]?.cogs, null);
  assert.equal(spoofAttemptView.sales.dailySeries[0]?.grossProfit, null);
  assert.equal(spoofAttemptView.inventory.products[0]?.grossProfitInPeriod, null);
  assert.equal(
    spoofAttemptView.inventory.costAccessStatus,
    'restricted_by_role'
  );
  assert.equal(spoofAttemptView.inventory.summary.totalInventoryValueAtCost, null);
  assert.equal(spoofAttemptView.inventory.products[0]?.unitCost, null);

  // 2. Inventory Clerk ('user-4') can view inventory costs, but cannot view P&L financials or customer full phone PII
  const clerkView = computeFullAnalyticsOverview(
    snapshot,
    { datePreset: '30d', branchId: 'all' },
    {
      userId: 'user-4',
    },
    now
  );

  assert.equal(clerkView.userContext.role, 'inventory_clerk');
  assert.equal(clerkView.userContext.canViewCostAndMargin, true);
  assert.equal(clerkView.userContext.canViewFinancials, false);
  assert.equal(clerkView.userContext.canViewCustomerPII, false);
  assert.ok((clerkView.inventory.summary.totalInventoryValueAtCost ?? 0) > 0);
  assert.equal(clerkView.financial.profitAndLoss.grossProfit, null);
  assert.equal(clerkView.customers.piiAccessStatus, 'restricted_by_role');
  assert.ok(clerkView.customers.topCustomers[0]?.phone.includes('*'));
});

test('Phase 8: Technical indicators (SMA, EMA, RSI, MACD, Linear Regression, Support/Resistance) and empty dataset edge cases', () => {
  const series = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38];

  const sma7 = computeSMA(series, 7);
  assert.equal(sma7[5], null);
  assert.equal(sma7[6], 16);
  assert.equal(sma7[14], 32);

  const ema7 = computeEMA(series, 7);
  assert.equal(ema7[5], null);
  assert.equal(ema7[6], 16);
  assert.ok((ema7[14] ?? 0) > 30);

  const rsi14 = computeRSI(series, 14);
  assert.equal(rsi14[13], null);
  assert.equal(rsi14[14], 100);

  const trend = computeLinearRegressionTrend(series);
  assert.equal(trend.slope, 2);
  assert.equal(trend.direction, 'upward');

  const sr = computeSupportAndResistance(series);
  assert.ok(sr.supportFloor >= 10 && sr.supportFloor <= 16);
  assert.ok(sr.resistanceCeiling >= 32 && sr.resistanceCeiling <= 38);

  const longSeries = Array.from({ length: 40 }, (_, i) => 50 + i * 1.5);
  const macd = computeMACD(longSeries, 12, 26, 9);
  assert.equal(macd.macdLine[24], null);
  assert.ok(macd.macdLine[25] !== null);
  assert.ok(macd.signalLine[35] !== null);
  assert.ok(macd.histogram[35] !== null);

  // Empty store edge case
  const emptySnapshot = buildAnalyticsSnapshotFromState({
    transactions: [],
  });
  emptySnapshot.transactions = [];

  const overview = computeFullAnalyticsOverview(
    emptySnapshot,
    {
      datePreset: '7d',
      forecastHorizonDays: 7,
    },
    { userId: 'user-1' }
  );

  assert.equal(overview.sales.summary.netSales, 0);
  assert.equal(overview.sales.summary.transactionCount, 0);
  assert.equal(overview.financial.profitAndLoss.grossProfit, 0);
  assert.equal(overview.technicalIndicators.latestValues.sma30, null);
  assert.equal(overview.forecasts.revenueSeries.filter((p) => !p.isHistorical).length, 7);
});
