/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import {
  INITIAL_CUSTOMERS,
  INITIAL_EXCHANGE_RATE_HISTORY,
  INITIAL_PRODUCTS,
  INITIAL_SETTINGS,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_TRANSACTIONS,
  INITIAL_USERS,
} from '../lib/initial-data';
import { DEFAULT_BASELINE_EXCHANGE_RATES } from '../lib/pos-calculations';
import { Customer, Product, StockMovement, Transaction } from '../lib/types';
import {
  AnalyticsDatasetSnapshot,
  PurchaseOrderRecordInput,
  ReturnRecordInput,
  UnmetDemandRequestInput,
  UnmetDemandRequestRecord,
} from './analytics.types';
import {
  buildAnalyticsSnapshotFromState,
  DEFAULT_ANALYTICS_BRANCHES,
  deduplicateCustomers,
  deduplicateProducts,
  deduplicateReturns,
  deduplicateStockMovements,
  deduplicateTransactions,
  deduplicateUnmetDemandRequests,
} from './analytics.snapshot';
import {
  UnmetDemandValidationResult,
  validateAndBuildUnmetDemandRequest,
} from './unmet-demand.validation';

export { buildAnalyticsSnapshotFromState, DEFAULT_ANALYTICS_BRANCHES };

// Short-TTL in-memory snapshot cache to prevent repeated disk/DB scans on rapid dashboard tab switches
let cachedSnapshot: {
  snapshot: AnalyticsDatasetSnapshot;
  expiresAt: number;
  storeFileMtimeMs: number;
  prodFileMtimeMs: number;
} | null = null;

const CACHE_TTL_MS = 1500;

function getFileMtimeMs(filePath: string): number {
  try {
    if (fs.existsSync(filePath)) {
      return fs.statSync(filePath).mtimeMs;
    }
  } catch {
    // Ignore
  }
  return 0;
}

export function invalidateAnalyticsSnapshotCache(): void {
  cachedSnapshot = null;
}

export interface LoadAnalyticsDatasetOptions {
  sinceDate?: Date;
  statusFilter?: 'completed' | 'voided' | 'all';
}

/**
 * Loads the active operational dataset on the backend by reading `.data/store-state.json`,
 * `.data/products.json`, and PostgreSQL repositories/tables (`products-repo`, `currencies-repo`,
 * `sales`, `sale_items`, `returns`, `return_items`, `purchases`, `stock_movements`, `customers`, `users`, `unmet_demand_requests`)
 * in a strictly read-only, deduplicated manner with SQL date/status predicate pushdown (PERF-05).
 */
export async function loadServerAnalyticsDataset(
  options?: LoadAnalyticsDatasetOptions
): Promise<AnalyticsDatasetSnapshot> {
  const stateFile = path.join(process.cwd(), '.data', 'store-state.json');
  const prodFile = path.join(process.cwd(), '.data', 'products.json');
  const storeMtime = getFileMtimeMs(stateFile);
  const prodMtime = getFileMtimeMs(prodFile);

  const hasCustomSqlScope = Boolean(
    options?.sinceDate || (options?.statusFilter && options.statusFilter !== 'completed')
  );

  if (
    !hasCustomSqlScope &&
    cachedSnapshot &&
    Date.now() < cachedSnapshot.expiresAt &&
    cachedSnapshot.storeFileMtimeMs === storeMtime &&
    cachedSnapshot.prodFileMtimeMs === prodMtime
  ) {
    return cachedSnapshot.snapshot;
  }

  let localStoreState: any = null;
  let localProducts: Product[] | null = null;

  try {
    if (storeMtime > 0) {
      const raw = fs.readFileSync(stateFile, 'utf-8');
      localStoreState = JSON.parse(raw);
    }
  } catch {
    // Ignore read errors and fall back cleanly
  }

  try {
    if (prodMtime > 0) {
      const raw = fs.readFileSync(prodFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localProducts = parsed;
      }
    }
  } catch {
    // Ignore read errors
  }

  let repoProducts: Product[] | null = null;
  let repoRates: Record<string, number> = {};
  const pgTransactions: Transaction[] = [];
  const pgReturns: ReturnRecordInput[] = [];
  const pgPurchases: PurchaseOrderRecordInput[] = [];
  const pgStockMovements: StockMovement[] = [];
  const pgCustomers: Customer[] = [];
  const pgUsers: any[] = [];
  const pgUnmetDemand: UnmetDemandRequestRecord[] = [];

  try {
    const { getAllProducts } = await import('../db/products-repo');
    const fetched = await getAllProducts();
    if (Array.isArray(fetched) && fetched.length > 0) {
      repoProducts = fetched.map((p) => ({
        ...p,
        nameAr: p.nameAr ?? undefined,
        description: p.description ?? undefined,
        descriptionAr: p.descriptionAr ?? undefined,
        categoryAr: p.categoryAr ?? undefined,
      })) as unknown as Product[];
    }
  } catch {
    // Fallback to localProducts / INITIAL_PRODUCTS
  }

  try {
    const { getEffectiveExchangeRates } = await import('../db/currencies-repo');
    const effRates = await getEffectiveExchangeRates();
    if (Array.isArray(effRates)) {
      for (const r of effRates) {
        if (r.isActive && r.targetCurrency === 'SDG' && Number(r.rate) > 0) {
          repoRates[r.sourceCurrency.toUpperCase()] = Number(r.rate);
        }
      }
    }
  } catch {
    // Fallback to localStoreState exchangeRates
  }

  // Query PostgreSQL operational tables if `db` is connected (strictly SELECT-only with SQL predicate pushdown)
  try {
    const { db } = await import('../db/index');
    if (db) {
      const schema = await import('../db/schema');
      const { and, desc, eq, gte } = await import('drizzle-orm');

      // Default analytical lookback horizon (370 days covers full YTD + 90d + prior-period comparison)
      const defaultCutoffDate = new Date(Date.now() - 370 * 24 * 3600 * 1000);
      const effectiveSinceDate = options?.sinceDate || defaultCutoffDate;

      const salesConditions = [gte(schema.sales.timestamp, effectiveSinceDate)];
      if (options?.statusFilter && options.statusFilter !== 'all') {
        salesConditions.push(eq(schema.sales.status, options.statusFilter));
      }

      const [
        dbSales,
        dbSaleItems,
        dbReturns,
        dbReturnItems,
        dbPurchases,
        dbPurchaseItems,
        dbMovements,
        dbCustomers,
        dbUsers,
        dbUnmetDemand,
      ] = await Promise.all([
        db
          .select()
          .from(schema.sales)
          .where(and(...salesConditions))
          .orderBy(desc(schema.sales.timestamp))
          .catch(() => []),
        db.select().from(schema.saleItems).catch(() => []),
        db
          .select()
          .from(schema.returns)
          .where(gte(schema.returns.createdAt, effectiveSinceDate))
          .catch(() => []),
        db.select().from(schema.returnItems).catch(() => []),
        db
          .select()
          .from(schema.purchases)
          .where(gte(schema.purchases.invoiceDate, effectiveSinceDate))
          .catch(() => []),
        db.select().from(schema.purchaseItems).catch(() => []),
        db
          .select()
          .from(schema.stockMovements)
          .where(gte(schema.stockMovements.timestamp, effectiveSinceDate))
          .orderBy(desc(schema.stockMovements.timestamp))
          .catch(() => []),
        db.select().from(schema.customers).catch(() => []),
        db.select().from(schema.users).catch(() => []),
        db
          .select()
          .from(schema.unmetDemandRequests)
          .where(gte(schema.unmetDemandRequests.requestedTimestamp, effectiveSinceDate))
          .orderBy(desc(schema.unmetDemandRequests.requestedTimestamp))
          .catch(() => []),
      ]);

      if (Array.isArray(dbUsers) && dbUsers.length > 0) {
        for (const u of dbUsers) {
          if (u && u.isActive !== false) {
            pgUsers.push({
              id: u.id,
              name: u.name,
              role:
                u.roleId === 'admin' ||
                u.roleId === 'manager' ||
                u.roleId === 'cashier' ||
                u.roleId === 'inventory_clerk'
                  ? u.roleId
                  : 'cashier',
              branchId: u.branchId || undefined,
              pin: u.pinCode || '0000',
            });
          }
        }
      }

      if (dbSales.length > 0) {
        const itemsBySaleId = new Map<string, typeof dbSaleItems>();
        for (const si of dbSaleItems) {
          const list = itemsBySaleId.get(si.saleId) || [];
          list.push(si);
          itemsBySaleId.set(si.saleId, list);
        }
        for (const s of dbSales) {
          const sItems = itemsBySaleId.get(s.id) || [];
          pgTransactions.push({
            id: s.transactionId || s.id,
            idempotencyKey: s.idempotencyKey,
            timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : String(s.timestamp),
            currency: 'SDG',
            items: sItems.map((si) => ({
              productId: si.productId,
              productName: si.productName,
              sku: si.sku,
              quantity: Number(si.quantity),
              unitPrice: Number(si.unitPrice),
              discountPercent: Number(si.discountPercent || 0),
              total: Number(si.total),
            })),
            subtotal: Number(s.subtotal),
            taxRatePercent: Number(s.taxRatePercent),
            taxAmount: Number(s.taxAmount),
            discountAmount: Number(s.discountAmount || 0),
            grandTotal: Number(s.grandTotal),
            paymentMethod: (s.paymentMethod as any) || 'cash',
            amountTendered: Number(s.amountTendered),
            changeDue: Number(s.changeDue || 0),
            customerId: s.customerId || undefined,
            customerName: s.customerName || undefined,
            cashierName: s.cashierName || 'POS Terminal 01',
            status: s.status === 'voided' ? 'voided' : 'completed',
            syncStatus: 'synced',
          });
        }
      }

      if (dbReturns.length > 0) {
        const retItemsMap = new Map<string, typeof dbReturnItems>();
        for (const ri of dbReturnItems) {
          const list = retItemsMap.get(ri.returnId) || [];
          list.push(ri);
          retItemsMap.set(ri.returnId, list);
        }
        // Map sale internal UUID to transactionId if needed
        const saleUuidToTxId = new Map<string, string>();
        for (const s of dbSales) {
          saleUuidToTxId.set(s.id, s.transactionId || s.id);
        }
        for (const r of dbReturns) {
          const rItems = retItemsMap.get(r.id) || [];
          pgReturns.push({
            id: r.id,
            saleId: saleUuidToTxId.get(r.saleId) || r.saleId,
            timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            reason: r.reason,
            refundTotal: Number(r.refundTotal),
            items: rItems.map((ri) => ({
              productId: ri.productId,
              quantity: Number(ri.quantity),
              refundAmount: Number(ri.refundAmount),
            })),
          });
        }
      }

      if (dbPurchases.length > 0) {
        const pItemsMap = new Map<string, typeof dbPurchaseItems>();
        for (const pi of dbPurchaseItems) {
          const list = pItemsMap.get(pi.purchaseId) || [];
          list.push(pi);
          pItemsMap.set(pi.purchaseId, list);
        }
        for (const p of dbPurchases) {
          const pItems = pItemsMap.get(p.id) || [];
          pgPurchases.push({
            id: p.id,
            purchaseNumber: p.purchaseNumber,
            branchId: p.branchId || undefined,
            totalAmount: Number(p.totalAmount),
            status: (p.status as any) || 'received',
            invoiceDate:
              p.invoiceDate instanceof Date ? p.invoiceDate.toISOString() : String(p.invoiceDate),
            items: pItems.map((pi) => ({
              productId: pi.productId,
              quantity: Number(pi.quantity),
              unitCost: Number(pi.unitCost),
              totalCost: Number(pi.totalCost),
            })),
          });
        }
      }

      for (const m of dbMovements) {
        pgStockMovements.push({
          id: m.id,
          timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
          productId: m.productId,
          productName: m.productName,
          type: (m.type as any) || 'audit',
          quantityChange: Number(m.quantityChange),
          previousStock: Number(m.previousStock),
          newStock: Number(m.newStock),
          reason: m.reason,
          referenceId: m.referenceId || undefined,
        });
      }

      for (const c of dbCustomers) {
        pgCustomers.push({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email || undefined,
          notes: c.notes || undefined,
          totalSpent: Number(c.totalSpent || 0),
          transactionCount: Number(c.transactionCount || 0),
          loyaltyPoints: Number(c.loyaltyPoints || 0),
          createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
        });
      }

      if (Array.isArray(dbUnmetDemand)) {
        for (const udr of dbUnmetDemand) {
          pgUnmetDemand.push({
            id: udr.id,
            idempotencyKey: udr.idempotencyKey,
            dedupeFingerprint: udr.dedupeFingerprint,
            productId: udr.productId || null,
            isRegisteredProduct: Boolean(udr.isRegisteredProduct),
            productNameSnapshot: udr.productNameSnapshot,
            productNameArSnapshot: udr.productNameArSnapshot || null,
            skuSnapshot: udr.skuSnapshot || null,
            barcode: udr.barcode || null,
            categorySnapshot: udr.categorySnapshot || 'General',
            branchId: udr.branchId || 'branch-main',
            terminalName: udr.terminalName || 'Main Terminal',
            requestedTimestamp:
              udr.requestedTimestamp instanceof Date
                ? udr.requestedTimestamp.toISOString()
                : String(udr.requestedTimestamp),
            requestedQuantity: Number(udr.requestedQuantity || 1),
            saleUnitMode: udr.saleUnitMode === 'pack' ? 'pack' : 'unit',
            requestedBaseUnits: Number(udr.requestedBaseUnits || 1),
            availableStockAtRequest:
              udr.availableStockAtRequest !== null && udr.availableStockAtRequest !== undefined
                ? Number(udr.availableStockAtRequest)
                : null,
            availabilityStatus: (udr.availabilityStatus as any) || 'OUT_OF_STOCK',
            unavailabilityReason: (udr.unavailabilityReason as any) || 'OUT_OF_STOCK',
            confirmedPurchaseIntent: Boolean(udr.confirmedPurchaseIntent),
            fulfillmentStatus: (udr.fulfillmentStatus as any) || 'unfulfilled',
            customerId: udr.customerId || null,
            customerReference: udr.customerReference || null,
            unitSellingPriceSnapshot:
              udr.unitSellingPriceSnapshot !== null && udr.unitSellingPriceSnapshot !== undefined
                ? Number(udr.unitSellingPriceSnapshot)
                : null,
            unitCostPriceSnapshot:
              udr.unitCostPriceSnapshot !== null && udr.unitCostPriceSnapshot !== undefined
                ? Number(udr.unitCostPriceSnapshot)
                : null,
            currencySnapshot: (udr.currencySnapshot as any) || 'SDG',
            exchangeRateSnapshot: Number(udr.exchangeRateSnapshot || 1),
            notes: udr.notes || null,
            recordedByUserId: udr.recordedByUserId || 'user-1',
            recordedByName: udr.recordedByName || 'POS Operator',
            createdAt:
              udr.createdAt instanceof Date
                ? udr.createdAt.toISOString()
                : String(udr.createdAt),
          });
        }
      }
    }
  } catch {
    // Clean fallback if PostgreSQL is offline or unconfigured
  }

  // Reconcile & deduplicate across PostgreSQL, .data/store-state.json, and .data/products.json (NO fallback to demo seed data!)
  const DEMO_PROD_IDS = new Set([
    'prod-1',
    'prod-2',
    'prod-3',
    'prod-4',
    'prod-5',
    'prod-6',
    'prod-7',
    'prod-8',
    'prod-9',
    'prod-10',
  ]);
  const DEMO_TX_IDS = new Set(['TX-10420', 'TX-10419', 'TX-10418']);
  const DEMO_CUST_IDS = new Set(['cust-1', 'cust-2', 'cust-3', 'cust-4']);
  const DEMO_MOV_IDS = new Set(['mov-1', 'mov-2', 'mov-3', 'mov-4']);
  const DEMO_USER_IDS = new Set(['user-1', 'user-2', 'user-3', 'user-4']);

  const products = deduplicateProducts([
    ...(repoProducts || []),
    ...(Array.isArray(localProducts) ? localProducts : []),
    ...(Array.isArray(localStoreState?.products) ? localStoreState.products : []),
  ]).filter((p) => !DEMO_PROD_IDS.has(p.id));

  const stateTransactions: Transaction[] = Array.isArray(localStoreState?.transactions)
    ? localStoreState.transactions
    : [];
  const transactions = deduplicateTransactions([
    ...pgTransactions,
    ...stateTransactions,
  ]).filter((t) => !DEMO_TX_IDS.has(t.id));

  const stateReturns: ReturnRecordInput[] = Array.isArray(localStoreState?.returns)
    ? localStoreState.returns
    : [];
  const returns = deduplicateReturns([...pgReturns, ...stateReturns]);

  const statePurchases: PurchaseOrderRecordInput[] = Array.isArray(localStoreState?.purchases)
    ? localStoreState.purchases
    : [];
  const purchases = [...pgPurchases, ...statePurchases];

  const stateCustomers: Customer[] = Array.isArray(localStoreState?.customers)
    ? localStoreState.customers
    : [];
  const customers = deduplicateCustomers([...pgCustomers, ...stateCustomers]).filter(
    (c) => !DEMO_CUST_IDS.has(c.id)
  );

  const stateMovements: StockMovement[] = Array.isArray(localStoreState?.stockMovements)
    ? localStoreState.stockMovements
    : [];
  const stockMovements = deduplicateStockMovements([
    ...pgStockMovements,
    ...stateMovements,
  ]).filter((m) => !DEMO_MOV_IDS.has(m.id));

  const stateUnmetDemand: UnmetDemandRequestRecord[] = Array.isArray(
    localStoreState?.unmetDemandRequests
  )
    ? localStoreState.unmetDemandRequests
    : [];
  const unmetDemandRequests = deduplicateUnmetDemandRequests([
    ...pgUnmetDemand,
    ...stateUnmetDemand,
  ]);

  const stateUsers = Array.isArray(localStoreState?.users) ? localStoreState.users : [];
  let platformUsers: any[] = [];
  let platformBranches: any[] = [];
  const platformFile = path.join(process.cwd(), '.data', 'platform-onboarding-state.json');
  const platformMtime = getFileMtimeMs(platformFile);
  try {
    if (platformMtime > 0) {
      const rawPlatform = JSON.parse(fs.readFileSync(platformFile, 'utf-8'));
      if (Array.isArray(rawPlatform?.users)) {
        platformUsers = rawPlatform.users.filter(
          (u: any) => u.companyId !== 'comp-demo-practice' && !DEMO_USER_IDS.has(u.id)
        );
      }
      if (Array.isArray(rawPlatform?.branches)) {
        platformBranches = rawPlatform.branches.filter(
          (b: any) => b.companyId !== 'comp-demo-practice'
        );
      }
    }
  } catch {
    // Ignore platform file parse issues
  }

  const usersById = new Map<string, any>();
  for (const u of [...stateUsers, ...pgUsers, ...platformUsers]) {
    if (u && u.id && !DEMO_USER_IDS.has(u.id)) {
      usersById.set(u.id, { ...(usersById.get(u.id) || {}), ...u });
    }
  }
  const users = Array.from(usersById.values());

  const branchesById = new Map<string, any>();
  for (const b of platformBranches) {
    if (b && b.id) {
      branchesById.set(b.id, { ...(branchesById.get(b.id) || {}), ...b });
    }
  }
  const branches = Array.from(branchesById.values());

  const exchangeRates: Record<string, number> = {
    ...(localStoreState?.settings?.exchangeRates || {}),
    ...repoRates,
    SDG: 1,
  };

  const exchangeRateHistory = Array.isArray(localStoreState?.exchangeRateHistory)
    ? localStoreState.exchangeRateHistory
    : [];

  const snapshot = buildAnalyticsSnapshotFromState({
    products,
    transactions,
    returns,
    purchases,
    customers,
    stockMovements,
    users,
    unmetDemandRequests,
    exchangeRates,
    exchangeRateHistory,
    branches,
    dataSource: 'postgresql_and_store_state',
  });

  if (!hasCustomSqlScope) {
    cachedSnapshot = {
      snapshot,
      expiresAt: Date.now() + CACHE_TTL_MS,
      storeFileMtimeMs: storeMtime + platformMtime,
      prodFileMtimeMs: prodMtime,
    };
  }

  return snapshot;
}

/**
 * Validates and persists a new Customer Demand Inquiry (Unmet Demand Request) into PostgreSQL
 * `unmet_demand_requests` and `.data/store-state.json` without touching sales, inventory, or accounting tables.
 */
export async function recordUnmetDemandRequestServer(params: {
  input: UnmetDemandRequestInput;
  claimingUserId?: string;
}): Promise<UnmetDemandValidationResult> {
  const dataset = await loadServerAnalyticsDataset();
  const validation = validateAndBuildUnmetDemandRequest({
    input: params.input,
    claimingUserId: params.claimingUserId,
    serverUsers: dataset.users,
    catalogProducts: dataset.products,
    existingRequests: dataset.unmetDemandRequests || [],
    exchangeRates: dataset.exchangeRates,
    now: new Date(),
  });

  if (!validation.valid || !validation.record) {
    return validation;
  }

  const record = validation.record;

  // 1. Insert into PostgreSQL `unmet_demand_requests` if connected (additive, FK-safe)
  try {
    const { db } = await import('../db/index');
    if (db) {
      const schema = await import('../db/schema');
      await db
        .insert(schema.unmetDemandRequests)
        .values({
          id: record.id,
          idempotencyKey: record.idempotencyKey,
          dedupeFingerprint: record.dedupeFingerprint,
          productId: null, // Keep null in PG if product is in .data/products.json only to avoid FK constraint error when catalog IDs differ
          isRegisteredProduct: record.isRegisteredProduct,
          productNameSnapshot: record.productNameSnapshot,
          productNameArSnapshot: record.productNameArSnapshot,
          skuSnapshot: record.skuSnapshot,
          barcode: record.barcode,
          categorySnapshot: record.categorySnapshot,
          branchId: null,
          terminalName: record.terminalName || 'Main Terminal',
          requestedTimestamp: new Date(record.requestedTimestamp),
          requestedQuantity: record.requestedQuantity,
          saleUnitMode: record.saleUnitMode,
          requestedBaseUnits: record.requestedBaseUnits,
          availableStockAtRequest: record.availableStockAtRequest,
          availabilityStatus: record.availabilityStatus,
          unavailabilityReason: record.unavailabilityReason,
          confirmedPurchaseIntent: record.confirmedPurchaseIntent,
          fulfillmentStatus: record.fulfillmentStatus,
          customerId: null,
          customerReference: record.customerReference,
          unitSellingPriceSnapshot:
            record.unitSellingPriceSnapshot !== null && record.unitSellingPriceSnapshot !== undefined
              ? String(record.unitSellingPriceSnapshot)
              : null,
          unitCostPriceSnapshot:
            record.unitCostPriceSnapshot !== null && record.unitCostPriceSnapshot !== undefined
              ? String(record.unitCostPriceSnapshot)
              : null,
          currencySnapshot: record.currencySnapshot,
          exchangeRateSnapshot: String(record.exchangeRateSnapshot ?? 1),
          notes: record.notes,
          recordedByUserId: null,
          recordedByName: record.recordedByName || record.recordedByUserNameSnapshot || 'System',
          createdAt: new Date(record.createdAt),
        })
        .catch(() => {
          // Non-blocking if PG foreign keys or connection are unavailable
        });
    }
  } catch {
    // Non-blocking fallback to store-state.json
  }

  // 2. Append to `.data/store-state.json` `unmetDemandRequests` (preserving all existing operational state)
  try {
    const dataDir = path.join(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const stateFile = path.join(dataDir, 'store-state.json');
    let currentState: any = {};
    if (fs.existsSync(stateFile)) {
      try {
        currentState = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) || {};
      } catch {
        currentState = {};
      }
    }
    const existingList: UnmetDemandRequestRecord[] = Array.isArray(
      currentState.unmetDemandRequests
    )
      ? currentState.unmetDemandRequests
      : [];
    currentState.unmetDemandRequests = [record, ...existingList];
    fs.writeFileSync(stateFile, JSON.stringify(currentState, null, 2), 'utf-8');
  } catch {
    // Ignore disk write failure in read-only environments
  }

  invalidateAnalyticsSnapshotCache();
  return validation;
}
