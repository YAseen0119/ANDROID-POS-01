import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  extractCandidatesFromOverview,
  reconcileIntelligenceLifecycleState,
  applyLifecycleTransition,
  queryLifecycleItems,
  LifecycleActionError,
} from './intelligence.lifecycle.ts';
import { intelligenceRouter, analyticsRouter } from './analytics.routes.ts';
import { loadServerAnalyticsDataset } from './analytics.repository.ts';
import { resolveAnalyticsUserContext } from './analytics.permissions.ts';
import type { POSUser } from '../lib/types.ts';

const KNOWN_USERS: POSUser[] = [
  {
    id: 'usr-admin-1',
    name: 'System Admin',
    role: 'admin',
    pin: '1111',
    isActive: true,
    terminalName: 'POS-01 Main',
    avatarColor: '#10b981',
    permissions: {} as any,
    lastActiveAt: '2026-04-12T10:00:00.000Z',
  },
  {
    id: 'usr-mgr-main',
    name: 'Main Branch Manager',
    role: 'manager',
    pin: '2222',
    isActive: true,
    terminalName: 'POS-01 Main',
    avatarColor: '#6366f1',
    permissions: {} as any,
    lastActiveAt: '2026-04-12T10:00:00.000Z',
  },
  {
    id: 'usr-cashier-main',
    name: 'Main Cashier',
    role: 'cashier',
    pin: '3333',
    isActive: true,
    terminalName: 'POS-01 Main',
    avatarColor: '#f59e0b',
    permissions: {} as any,
    lastActiveAt: '2026-04-12T10:00:00.000Z',
  },
  {
    id: 'usr-clerk-bahri',
    name: 'Bahri Inventory Clerk',
    role: 'inventory_clerk',
    pin: '4444',
    isActive: true,
    terminalName: 'POS-02 Bahri',
    avatarColor: '#06b6d4',
    permissions: {} as any,
    lastActiveAt: '2026-04-12T10:00:00.000Z',
  },
];

function buildSampleOverview(): any {
  const nowIso = '2026-04-12T10:00:00.000Z';
  return {
    generatedAt: nowIso,
    filtersApplied: {
      branchId: 'all',
    },
    insights: [
      {
        id: 'INS-MARGIN-01',
        category: 'profit_margin',
        smartCategory: 'FINANCIAL_RISK',
        severity: 'warning',
        smartSeverity: 'HIGH',
        priority: 82,
        confidenceLevel: 'high',
        smartConfidenceLevel: 'HIGH',
        titleAr: 'انخفاض هامش الربح في قسم المشروبات',
        titleEn: 'Margin compression in Beverages',
        findingAr: 'انخفض هامش الربح بمقدار 4.2%',
        findingEn: 'Gross margin dropped by 4.2%',
        supportingEvidenceAr: 'بيانات فواتير مكتملة',
        supportingEvidenceEn: 'Complete invoice data',
        reasonAr: 'ارتفاع تكلفة المورد',
        reasonEn: 'Supplier cost increase',
        suggestedActionAr: 'مراجعة أسعار الموردين',
        suggestedActionEn: 'Review supplier pricing',
        metricName: 'Gross Margin',
        metricValueFormatted: '18.4%',
        periodLabel: 'Last 30 Days',
      },
    ],
    intelligence: {
      smartAlerts: [
        {
          id: 'ALERT-STOCK-1',
          dedupeKey: 'smart_alert:STOCKOUT_IMMINENT:branch-main:prod-1',
          category: 'STOCKOUT_IMMINENT',
          legacyCategory: 'inventory',
          severity: 'CRITICAL',
          priority: 95,
          confidenceLevel: 'HIGH',
          branchId: 'branch-main',
          productId: 'prod-1',
          titleAr: 'خطر نفاد مخزون وشيك: حليب كامل الدسم 1 لتر',
          titleEn: 'Imminent Stockout Risk: Full Cream Milk 1L',
          descriptionAr: 'الرصيد المتاح يكفي 1.2 يوم فقط مع طلب مرتفع',
          descriptionEn: 'Available stock covers only 1.2 days with high velocity',
          explanationAr: 'معدل السحب اليومي 5 وحدات مقابل 6 وحدات متبقية',
          explanationEn: 'Daily velocity 5 units vs 6 units remaining',
          recommendedActionAr: 'إصدار أمر شراء عاجل لـ 48 وحدة',
          recommendedActionEn: 'Issue urgent PO for 48 units',
          evidenceMetrics: [
            { name: 'Current Stock', valueFormatted: '6 units', rawValue: 6 },
            { name: 'Days of Cover', valueFormatted: '1.2 days', rawValue: 1.2 },
          ],
          affectedRecords: ['prod-1'],
          periodAnalyzed: 'Last 30 Days',
          sourceMetrics: ['currentStock', 'dailySalesVelocity'],
        },
        {
          id: 'ALERT-FIN-1',
          dedupeKey: 'smart_alert:FINANCIAL_RISK:branch-bahri:refunds',
          category: 'FINANCIAL_RISK',
          legacyCategory: 'cash_and_debt',
          severity: 'HIGH',
          priority: 85,
          confidenceLevel: 'HIGH',
          branchId: 'branch-bahri',
          productId: null,
          titleAr: 'ارتفاع غير معتاد في المرتجعات النقدية',
          titleEn: 'Unusual spike in cash refunds',
          descriptionAr: 'معدل المرتجعات ارتفع إلى 6.5% من إجمالي المبيعات',
          descriptionEn: 'Refund rate increased to 6.5% of gross sales',
          explanationAr: 'مقابل 1.8% في الفترة المرجعية',
          explanationEn: 'Compared to 1.8% baseline',
          recommendedActionAr: 'تدقيق سجل المرتجعات للكاشير',
          recommendedActionEn: 'Audit cashier refund log',
          evidenceMetrics: [{ name: 'Refund Rate', valueFormatted: '6.5%', rawValue: 6.5 }],
          affectedRecords: ['branch-bahri'],
          periodAnalyzed: 'Last 14 Days',
          sourceMetrics: ['refundRate'],
        },
      ],
      replenishmentRecommendations: [
        {
          productId: 'prod-1',
          sku: 'MILK-001',
          productName: 'Full Cream Milk 1L',
          productNameAr: 'حليب كامل الدسم 1 لتر',
          branchId: 'branch-main',
          currentStock: 6,
          recommendedOrderUnits: 74,
          reorderPointUnits: 25,
          unmetDemandInquiriesCount: 4,
          observedUnmetDemandUnits: 8,
          urgency: 'CRITICAL',
          confidenceLevel: 'HIGH',
          explanationAr: 'الطلب المدمج 5 وحدات يومياً مع مخزون يكفي 1.2 يوم',
          explanationEn: 'Blended demand 5/day with 1.2 days of stock remaining',
          suggestedActionAr: 'إصدار أمر شراء لـ 74 وحدة',
          suggestedActionEn: 'Issue PO for 74 units',
          estimatedOrderCost: 1480,
          daysUntilStockout: 1.2,
          leadTimeDays: 3,
          safetyStockUnits: 10,
        },
      ],
      branchTransferOpportunities: [
        {
          productId: 'prod-2',
          sku: 'COF-002',
          productName: 'Arabica Coffee Beans 1kg',
          productNameAr: 'بن قهوة أرابيكا 1 كجم',
          fromBranchId: 'branch-bahri',
          fromBranchName: 'Bahri Branch',
          fromBranchNameAr: 'فرع بحري',
          fromBranchEstimatedSurplusUnits: 18,
          toBranchId: 'branch-main',
          toBranchName: 'Main Branch',
          toBranchNameAr: 'الفرع الرئيسي',
          toBranchShortageOrUnmetUnits: 12,
          toBranchUnmetInquiriesCount: 3,
          recommendedTransferUnits: 12,
          estimatedRetailValueProtected: 1440,
          priority: 'HIGH',
          confidenceLevel: 'HIGH',
          explanationAr: 'فائض 18 وحدة في فرع بحري وعجز 12 وحدة في الفرع الرئيسي',
          explanationEn: 'Surplus of 18 units in Bahri Branch and shortage of 12 units in Main Branch',
          suggestedActionAr: 'تحويل 12 وحدة من فرع بحري إلى الفرع الرئيسي',
          suggestedActionEn: 'Transfer 12 units from Bahri Branch to Main Branch',
        },
      ],
    },
  };
}

test('Phase 9.5 — 1. Candidate extraction & initial reconciliation create ACTIVE items with CREATED events', () => {
  const overview = buildSampleOverview();
  const candidates = extractCandidatesFromOverview(overview);
  assert.equal(
    candidates.length,
    5,
    'Should extract 2 smart alerts + 1 replenishment + 1 branch transfer + 1 BI insight'
  );

  const reconciled = reconcileIntelligenceLifecycleState({
    candidates,
    existingItems: [],
    existingEvents: [],
    nowIso: '2026-04-12T10:00:00.000Z',
  });

  assert.equal(reconciled.items.length, 5);
  assert.equal(reconciled.events.length, 5);
  for (const item of reconciled.items) {
    assert.equal(item.status, 'ACTIVE');
    assert.ok(item.dedupeKey.length > 5);
  }
  for (const ev of reconciled.events) {
    assert.equal(ev.eventType, 'CREATED');
    assert.equal(ev.toStatus, 'ACTIVE');
  }
});

test('Phase 9.5 — 2. Lifecycle transitions: ACKNOWLEDGE -> RESOLVE -> REOPEN & DISMISS with non-reactivation guarantee', () => {
  const overview = buildSampleOverview();
  const candidates = extractCandidatesFromOverview(overview);
  let state = reconcileIntelligenceLifecycleState({
    candidates,
    existingItems: [],
    existingEvents: [],
    nowIso: '2026-04-12T10:00:00.000Z',
  });

  const stockAlertItem = state.items.find(
    (i) => i.itemStream === 'smart_alert' && i.category === 'STOCKOUT_IMMINENT'
  )!;
  assert.ok(stockAlertItem);

  const managerContext = resolveAnalyticsUserContext({ userId: 'usr-mgr-main' }, KNOWN_USERS);

  // 1. Acknowledge
  const ackRes = applyLifecycleTransition({
    items: state.items,
    events: state.events,
    input: {
      itemIdOrDedupeKey: stockAlertItem.id,
      action: 'ACKNOWLEDGE',
      userContext: managerContext,
      userName: managerContext.userName,
      note: 'Checking warehouse inventory count',
      nowIso: '2026-04-12T10:05:00.000Z',
    },
  });
  state = { items: ackRes.items, events: ackRes.events, upsertedItems: [], newEvents: [] };
  assert.equal(ackRes.updatedItem.status, 'ACKNOWLEDGED');
  assert.equal(ackRes.updatedItem.acknowledgedByUserId, 'usr-mgr-main');
  assert.equal(ackRes.updatedItem.acknowledgedByName, 'Main Branch Manager');
  assert.equal(ackRes.createdEvent.eventType, 'ACKNOWLEDGED');
  assert.equal(ackRes.createdEvent.fromStatus, 'ACTIVE');
  assert.equal(ackRes.createdEvent.toStatus, 'ACKNOWLEDGED');

  // 2. Resolve with resolution note & actionType
  const resRes = applyLifecycleTransition({
    items: state.items,
    events: state.events,
    input: {
      itemIdOrDedupeKey: stockAlertItem.id,
      action: 'RESOLVE',
      userContext: managerContext,
      userName: managerContext.userName,
      note: 'Created Purchase Order PO-2026-089 for 75 units',
      actionType: 'PO_CREATED',
      nowIso: '2026-04-12T10:15:00.000Z',
    },
  });
  state = { items: resRes.items, events: resRes.events, upsertedItems: [], newEvents: [] };
  assert.equal(resRes.updatedItem.status, 'RESOLVED');
  assert.equal(resRes.updatedItem.resolvedByUserId, 'usr-mgr-main');
  assert.equal(resRes.updatedItem.resolutionNote, 'Created Purchase Order PO-2026-089 for 75 units');
  assert.equal(resRes.updatedItem.resolutionActionType, 'PO_CREATED');
  assert.equal(resRes.createdEvent.eventType, 'RESOLVED');

  // 3. Routine analytics refresh MUST NOT reactivate ACKNOWLEDGED or RESOLVED items
  const refreshedState = reconcileIntelligenceLifecycleState({
    candidates,
    existingItems: state.items,
    existingEvents: state.events,
    nowIso: '2026-04-12T10:30:00.000Z',
  });
  const afterRefresh = refreshedState.items.find((i) => i.id === stockAlertItem.id)!;
  assert.equal(
    afterRefresh.status,
    'RESOLVED',
    'Resolved item must remain RESOLVED after routine refresh'
  );
  assert.equal(afterRefresh.resolutionNote, 'Created Purchase Order PO-2026-089 for 75 units');

  // 4. Dismiss another item
  const transferItem = refreshedState.items.find((i) => i.itemStream === 'branch_transfer')!;
  const adminContext = resolveAnalyticsUserContext({ userId: 'usr-admin-1' }, KNOWN_USERS);
  const disRes = applyLifecycleTransition({
    items: refreshedState.items,
    events: refreshedState.events,
    input: {
      itemIdOrDedupeKey: transferItem.id,
      action: 'DISMISS',
      userContext: adminContext,
      userName: adminContext.userName,
      note: 'Bahri Branch stock is reserved for upcoming weekend promotion',
      nowIso: '2026-04-12T10:35:00.000Z',
    },
  });
  assert.equal(disRes.updatedItem.status, 'DISMISSED');
  assert.equal(
    disRes.updatedItem.dismissReason,
    'Bahri Branch stock is reserved for upcoming weekend promotion'
  );

  // 5. Reopen dismissed item by admin
  const reopenRes = applyLifecycleTransition({
    items: disRes.items,
    events: disRes.events,
    input: {
      itemIdOrDedupeKey: transferItem.id,
      action: 'REOPEN',
      userContext: adminContext,
      userName: adminContext.userName,
      note: 'Promotion cancelled, transfer can proceed now',
      nowIso: '2026-04-12T11:00:00.000Z',
    },
  });
  assert.equal(reopenRes.updatedItem.status, 'ACTIVE');
  assert.equal(reopenRes.updatedItem.reopenedCount, 1);
  assert.equal(reopenRes.createdEvent.eventType, 'REOPENED');
});

test('Phase 9.5 — 3. RBAC enforcement: branch scope, financial restrictions, and REOPEN role restrictions', () => {
  const overview = buildSampleOverview();
  const candidates = extractCandidatesFromOverview(overview);
  let state = reconcileIntelligenceLifecycleState({
    candidates,
    existingItems: [],
    existingEvents: [],
    nowIso: '2026-04-12T10:00:00.000Z',
  });

  const mainBranchStockItem = state.items.find(
    (i) => i.branchId === 'branch-main' && i.itemStream === 'smart_alert'
  )!;
  const bahriFinItem = state.items.find(
    (i) => i.branchId === 'branch-bahri' && i.category === 'FINANCIAL_RISK'
  )!;

  const mainCashierContext = {
    ...resolveAnalyticsUserContext({ userId: 'usr-cashier-main' }, KNOWN_USERS),
    branchRestriction: 'branch-main',
  };

  // Cashier cannot modify financial item (403 FORBIDDEN_LIFECYCLE_ITEM_ACCESS)
  assert.throws(
    () =>
      applyLifecycleTransition({
        items: state.items,
        events: state.events,
        input: {
          itemIdOrDedupeKey: bahriFinItem.id,
          action: 'ACKNOWLEDGE',
          userContext: mainCashierContext,
          userName: mainCashierContext.userName,
        },
      }),
    (err: unknown) =>
      err instanceof LifecycleActionError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_LIFECYCLE_ITEM_ACCESS'
  );

  // Cashier in Main Branch CAN acknowledge Main Branch non-financial inventory item
  const cashAck = applyLifecycleTransition({
    items: state.items,
    events: state.events,
    input: {
      itemIdOrDedupeKey: mainBranchStockItem.id,
      action: 'ACKNOWLEDGE',
      userContext: mainCashierContext,
      userName: mainCashierContext.userName,
      note: 'Notified floor supervisor',
    },
  });
  state = { items: cashAck.items, events: cashAck.events, upsertedItems: [], newEvents: [] };

  // Resolve it as manager
  const mainManagerContext = resolveAnalyticsUserContext({ userId: 'usr-mgr-main' }, KNOWN_USERS);
  const mgrResolve = applyLifecycleTransition({
    items: state.items,
    events: state.events,
    input: {
      itemIdOrDedupeKey: mainBranchStockItem.id,
      action: 'RESOLVE',
      userContext: mainManagerContext,
      userName: mainManagerContext.userName,
      note: 'Restocked from backroom',
    },
  });
  state = { items: mgrResolve.items, events: mgrResolve.events, upsertedItems: [], newEvents: [] };

  // Cashier CANNOT reopen resolved item (restricted to admin/manager -> 403 FORBIDDEN_REOPEN_ROLE)
  assert.throws(
    () =>
      applyLifecycleTransition({
        items: state.items,
        events: state.events,
        input: {
          itemIdOrDedupeKey: mainBranchStockItem.id,
          action: 'REOPEN',
          userContext: mainCashierContext,
          userName: mainCashierContext.userName,
          note: 'Trying to reopen as cashier',
        },
      }),
    (err: unknown) =>
      err instanceof LifecycleActionError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_REOPEN_ROLE'
  );

  // Query filtering for Main Cashier hides financial items and Bahri-only items
  const cashierQuery = queryLifecycleItems({
    items: state.items,
    userContext: mainCashierContext,
    filter: { status: 'ALL_HISTORY' },
  });
  assert.equal(
    cashierQuery.items.some(
      (i) => i.category === 'FINANCIAL_RISK' || i.category === 'profit_margin'
    ),
    false,
    'Cashier must never receive financial lifecycle items'
  );
  assert.equal(
    cashierQuery.items.some((i) => i.scopeType === 'BRANCH' && i.branchId === 'branch-bahri'),
    false,
    'Main branch cashier must never receive Bahri branch-scoped items'
  );
});

test('Phase 9.5 — 4. HTTP API routes (/api/intelligence/lifecycle) enforce auth and persist transitions & history end-to-end', async () => {
  const dataset = await loadServerAnalyticsDataset();
  const adminUser = dataset.users.find((u) => u.role === 'admin') || dataset.users[0];
  assert.ok(adminUser, 'Server dataset must have an admin user');
  const adminUserId = adminUser.id;

  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/intelligence', intelligenceRouter);

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated request returns 401
    const unauthRes = await fetch(`${baseUrl}/api/intelligence/lifecycle`);
    assert.equal(unauthRes.status, 401);

    // 2. List ALL_HISTORY lifecycle items as admin
    const listRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle?status=ALL_HISTORY&userId=${encodeURIComponent(adminUserId)}`
    );
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.success, true);
    assert.ok(Array.isArray(listBody.data.items), 'Should return lifecycle items array');
    assert.ok(listBody.data.items.length >= 1, 'Should have at least 1 intelligence lifecycle item');

    const targetItem = listBody.data.items[0];
    const targetId = targetItem.id;

    // 3. Acknowledge item via POST /api/intelligence/lifecycle/:id/acknowledge
    const ackRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle/${encodeURIComponent(targetId)}/acknowledge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': adminUserId },
        body: JSON.stringify({ note: 'Acknowledged via Phase 9.5 API integration test' }),
      }
    );
    assert.equal(ackRes.status, 200);
    const ackBody = await ackRes.json();
    assert.equal(ackBody.data.item.status, 'ACKNOWLEDGED');
    assert.equal(ackBody.data.item.acknowledgedByUserId, adminUserId);

    // 4. Resolve item via POST /api/intelligence/lifecycle/:id/resolve
    const resolveRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle/${encodeURIComponent(targetId)}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': adminUserId },
        body: JSON.stringify({
          resolutionNote: 'Resolved and ordered replenishment stock',
          actionType: 'PO_ORDERED',
        }),
      }
    );
    assert.equal(resolveRes.status, 200);
    const resolveBody = await resolveRes.json();
    assert.equal(resolveBody.data.item.status, 'RESOLVED');
    assert.equal(resolveBody.data.item.resolutionNote, 'Resolved and ordered replenishment stock');

    // 5. Verify item appears in RESOLVED tab and NOT in ACTIVE tab (simulating browser reload)
    const activeAfterRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle?status=ACTIVE&userId=${encodeURIComponent(adminUserId)}`
    );
    const activeAfterBody = await activeAfterRes.json();
    assert.equal(
      activeAfterBody.data.items.some((i: any) => i.id === targetId),
      false,
      'Resolved item must no longer appear in ACTIVE tab after reload'
    );

    const resolvedAfterRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle?status=RESOLVED&userId=${encodeURIComponent(adminUserId)}`
    );
    const resolvedAfterBody = await resolvedAfterRes.json();
    assert.equal(
      resolvedAfterBody.data.items.some((i: any) => i.id === targetId),
      true,
      'Resolved item must appear in RESOLVED tab after reload'
    );

    // 6. Fetch chronological history via GET /api/intelligence/lifecycle/:id/history
    const histRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle/${encodeURIComponent(targetId)}/history?userId=${encodeURIComponent(adminUserId)}`
    );
    assert.equal(histRes.status, 200);
    const histBody = await histRes.json();
    assert.ok(histBody.data.history.length >= 2, 'Should have ACKNOWLEDGED and RESOLVED events');

    // 7. Reopen back to ACTIVE so operational test state remains clean
    const reopenRes = await fetch(
      `${baseUrl}/api/intelligence/lifecycle/${encodeURIComponent(targetId)}/reopen`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': adminUserId },
        body: JSON.stringify({ note: 'Reopened after integration test verification' }),
      }
    );
    assert.equal(reopenRes.status, 200);
    const reopenBody = await reopenRes.json();
    assert.equal(reopenBody.data.item.status, 'ACTIVE');
  } finally {
    server.close();
  }
});
