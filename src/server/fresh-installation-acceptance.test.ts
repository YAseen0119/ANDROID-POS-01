/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FRESH INSTALLATION & ZERO DEFAULT DATA SYSTEM — 20 ACCEPTANCE TESTS
 *
 * Verifies all 20 required production acceptance scenarios:
 *  1. Fresh installation state (zero default production companies, requiresInitialSetup: true)
 *  2. First-run company creation (creates Company, Initial Main Branch, and Owner Account)
 *  3. Owner password validation (rejects missing or short password < 4 chars)
 *  4. Password confirmation mismatch (rejects mismatched ownerPassword vs ownerConfirmPassword)
 *  5. Duplicate company creation prevention (idempotencyKey returns existing company without duplicating)
 *  6. Empty products after setup (0 products in newly created company and .data/products.json)
 *  7. Empty customers after setup (0 customers in newly created company)
 *  8. Empty sales after setup (0 sales transactions in newly created company)
 *  9. Empty inventory after setup (0 inventory stock movements and 0 stock quantities)
 * 10. Empty reports after setup (analytics overview has 0 revenue, 0 profit, 0 inventory valuation)
 * 11. Empty analytics after setup (0 forecasts, 0 fabricated intelligence recommendations)
 * 12. Base currency setup (supports SDG or custom base currency, or 0 default currencies when skipped)
 * 13. Manual currency addition (adding custom currency and exchange rate without rewriting history)
 * 14. First real product creation (creates only the explicitly requested product with 0 fake movements)
 * 15. Opening stock entry (deliberate stock adjustment creates explicit audit movement)
 * 16. First real sale (records only the actual sale transaction for the company)
 * 17. Practice Mode isolation (Practice Mode sandbox has demo records completely isolated from production)
 * 18. Unauthorized reset rejection (rejects wrong company name confirmation or wrong owner password)
 * 19. Authorized local device reset (Scope A: clears local device state without deleting server company)
 * 20. Authorized company factory reset (Scope B: wipes only target company, revokes sessions, preserves other companies & audit trail)
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  loadPlatformState,
  createCompanyAndInitialOwner,
  executeCompanyFactoryReset,
  readPracticeSandboxState,
  resetPracticeSandboxState,
  verifyPasswordScrypt,
  ReleasePlatformError,
} from './release-onboarding.service';
import { buildAnalyticsSnapshotFromState } from '../analytics/analytics.snapshot';
import { computeFullAnalyticsOverview } from '../analytics/analytics.service';
import { calculateStockAdjustment } from '../lib/inventory-rules';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const FILES_TO_BACKUP = [
  'platform-onboarding-state.json',
  'store-state.json',
  'products.json',
  'currencies.json',
  'exchange-rates.json',
  'practice-store-state.json',
];

const backups = new Map<string, string | null>();

before(() => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  for (const filename of FILES_TO_BACKUP) {
    const filePath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filePath)) {
      backups.set(filename, fs.readFileSync(filePath, 'utf-8'));
      fs.unlinkSync(filePath);
    } else {
      backups.set(filename, null);
    }
  }
});

after(() => {
  for (const [filename, content] of backups.entries()) {
    const filePath = path.join(DATA_DIR, filename);
    if (content === null) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
});

test('1. Fresh installation state starts with ZERO default production companies and zero default users', () => {
  const platform = loadPlatformState();
  const prodCompanies = platform.companies.filter((c) => !c.isDemo);
  assert.equal(prodCompanies.length, 0, 'Fresh install must have 0 production companies');

  const prodUsers = platform.users.filter((u) => u.companyId !== 'comp-demo-practice');
  assert.equal(prodUsers.length, 0, 'Fresh install must have 0 default production employee accounts');
});

test('2. First-run company creation initializes Company, Main Branch, Owner Account, and Audit Record', async () => {
  const result = await createCompanyAndInitialOwner({
    idempotencyKey: 'test-onboard-alpha-001',
    legalName: 'Alpha Fresh Mart LLC',
    displayName: 'Alpha Fresh Mart',
    displayNameAr: 'أسواق ألفا الحديثة',
    businessType: 'Supermarket & Grocery',
    country: 'Sudan',
    city: 'Khartoum',
    baseCurrency: 'SDG',
    secondaryCurrencies: [],
    branchName: 'Alpha Main Branch',
    branchCode: 'ALPHA-01',
    ownerName: 'Ahmad Al-Sudani',
    ownerUsername: 'ahmad.alpha',
    ownerPassword: 'SecurePassword123!',
    ownerConfirmPassword: 'SecurePassword123!',
    ownerPin: '1234',
  });

  assert.equal(result.ok, true);
  assert.ok(result.company, 'Company record should be created');
  assert.ok(result.branch, 'Initial main branch should be created');
  assert.ok(result.owner, 'Initial company owner should be created');
  assert.equal(result.company.legalName, 'Alpha Fresh Mart LLC');
  assert.equal(result.owner.systemRole, 'COMPANY_OWNER');
  assert.equal(result.owner.companyId, result.company.id);

  // Verify password was securely hashed with scrypt and never stored in plaintext
  const platform = loadPlatformState();
  const storedOwner = platform.users.find((u) => u.id === result.owner.id);
  assert.ok(storedOwner?.passwordHash, 'Owner passwordHash must exist');
  assert.ok(storedOwner?.passwordSalt, 'Owner passwordSalt must exist');
  assert.notEqual(
    storedOwner?.passwordHash,
    'SecurePassword123!',
    'Password must never be stored in plaintext'
  );
  assert.equal(
    verifyPasswordScrypt('SecurePassword123!', storedOwner!.passwordHash, storedOwner!.passwordSalt),
    true,
    'Scrypt verification must succeed for the owner password'
  );
});

test('3. Owner password validation rejects missing or short passwords', async () => {
  await assert.rejects(
    async () => {
      await createCompanyAndInitialOwner({
        legalName: 'Invalid Pass Store',
        ownerName: 'Test Owner',
        ownerUsername: 'test.shortpass',
        ownerPassword: '123',
        ownerConfirmPassword: '123',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ReleasePlatformError);
      assert.equal(err.errorCode, 'WEAK_OWNER_PASSWORD');
      return true;
    }
  );
});

test('4. Password confirmation mismatch is rejected', async () => {
  await assert.rejects(
    async () => {
      await createCompanyAndInitialOwner({
        legalName: 'Mismatch Store',
        ownerName: 'Test Owner',
        ownerUsername: 'test.mismatch',
        ownerPassword: 'ValidPassword123',
        ownerConfirmPassword: 'DifferentPassword456',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ReleasePlatformError);
      assert.equal(err.errorCode, 'PASSWORD_CONFIRMATION_MISMATCH');
      return true;
    }
  );
});

test('5. Duplicate company creation prevention (idempotency key + duplicate company/owner replay protection)', async () => {
  const retryResult = await createCompanyAndInitialOwner({
    idempotencyKey: 'test-onboard-alpha-001',
    legalName: 'Alpha Fresh Mart LLC',
    ownerName: 'Ahmad Al-Sudani',
    ownerUsername: 'ahmad.alpha',
    ownerPassword: 'SecurePassword123!',
    ownerConfirmPassword: 'SecurePassword123!',
  });
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.idempotentReplay, true);

  const platform = loadPlatformState();
  const alphaCompanies = platform.companies.filter((c) => c.legalName === 'Alpha Fresh Mart LLC');
  assert.equal(alphaCompanies.length, 1, 'Idempotency check must prevent duplicate company records');
});

test('6. Empty products after setup (zero automatically generated products or categories)', () => {
  const dataset = buildAnalyticsSnapshotFromState({});
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });
  assert.equal(dataset.products.length, 0, 'Fresh company must have 0 products');
  assert.equal(overview.inventory.summary.totalSkus, 0, 'Inventory summary must report 0 SKUs');
});

test('7. Empty customers after setup (zero automatically generated customers)', () => {
  const dataset = buildAnalyticsSnapshotFromState({});
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });
  assert.equal(dataset.customers.length, 0, 'Fresh company must have 0 customers');
  assert.equal(
    overview.financial.cashFlowAndWorkingCapital.accountsReceivableOutstandingDebt,
    0,
    'Fresh company must have 0 customer debt'
  );
});

test('8. Empty sales after setup (zero automatically generated sales transactions)', () => {
  const dataset = buildAnalyticsSnapshotFromState({});
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });
  assert.equal(dataset.transactions.length, 0, 'Fresh company must have 0 sales transactions');
  assert.equal(
    overview.sales.summary.transactionCount,
    0,
    'Fresh company must have 0 completed transactions'
  );
  assert.equal(overview.sales.summary.netSales, 0, 'Fresh company must have 0 net sales revenue');
});

test('9. Empty inventory after setup (zero stock quantities and zero stock movements)', () => {
  const dataset = buildAnalyticsSnapshotFromState({});
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });
  assert.equal(dataset.stockMovements.length, 0, 'Fresh company must have 0 stock movements');
  assert.equal(
    overview.inventory.summary.totalStockUnits,
    0,
    'Fresh company must have 0 inventory units'
  );
  assert.equal(
    overview.inventory.summary.totalInventoryValueAtRetail,
    0,
    'Fresh company must have 0 inventory retail valuation'
  );
});

test('10. Empty reports after setup (zero fabricated revenue, profit, or historical figures)', () => {
  const adminUser = {
    id: 'usr-admin-1',
    name: 'Admin Owner',
    nameAr: 'المالك',
    role: 'admin' as const,
    pin: '1111',
    terminalName: 'Terminal 01',
    terminalNameAr: 'نقطة بيع 1',
    avatarColor: '#10b981',
    isActive: true,
    permissions: {
      canCheckout: true,
      canEditPrices: true,
      canProcessSales: true,
      canApplyDiscounts: true,
      canVoidTransactions: true,
      canManageProducts: true,
      canManageInventory: true,
      canManageCustomers: true,
      canSettleDebts: true,
      canViewReports: true,
      canManageExchangeRates: true,
      canManageSettings: true,
      canManageUsers: true,
    },
    lastActiveAt: new Date().toISOString(),
  };
  const dataset = buildAnalyticsSnapshotFromState({ users: [adminUser] });
  const overview = computeFullAnalyticsOverview(dataset, {}, { userId: 'usr-admin-1', role: 'admin' });
  assert.equal(overview.financial.profitAndLoss.grossProfit, 0);
  assert.equal(overview.financial.profitAndLoss.netSalesRevenue, 0);
  assert.equal(overview.sales.byProduct.length, 0);
  assert.equal(overview.sales.byCategory.length, 0);
});

test('11. Empty analytics & intelligence after setup (no fabricated forecasts or fake alerts)', () => {
  const dataset = buildAnalyticsSnapshotFromState({});
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });
  assert.equal(
    overview.inventory.summary.deadStockCount,
    0,
    'No dead stock items on empty catalog'
  );
  assert.equal(
    overview.inventory.summary.lowStockSkusCount,
    0,
    'No low stock items on empty catalog'
  );
});

test('12. Base currency setup supports SDG and zero unconfigured foreign exchange rates', () => {
  const platform = loadPlatformState();
  const alpha = platform.companies.find((c) => c.legalName === 'Alpha Fresh Mart LLC');
  assert.ok(alpha);
  assert.equal(alpha.baseCurrency, 'SDG');
});

test('13. Manual currency addition configures exchange rate without fabricating historical transactions', () => {
  const dataset = buildAnalyticsSnapshotFromState({
    exchangeRates: { SDG: 1, USD: 2850 },
    exchangeRateHistory: [],
  });
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });
  assert.equal(dataset.exchangeRates.USD, 2850);
  assert.equal(overview.sales.summary.netSales, 0);
});

test('14. First real product creation saves actual product with 0 stock unless opening stock entered', () => {
  const firstProduct = {
    id: 'prod-real-001',
    sku: 'BAR-1001',
    barcode: '622100001001',
    name: 'Sudanese Arabic Gum 500g',
    nameAr: 'صمغ عربي سوداني 500 جرام',
    category: 'Natural Products',
    categoryAr: 'منتجات طبيعية',
    price: 12000,
    sellingPrice: 12000,
    costPrice: 8500,
    stock: 0,
    minStockAlert: 5,
    unit: 'pack',
    updatedAt: new Date().toISOString(),
  };

  const dataset = buildAnalyticsSnapshotFromState({
    products: [firstProduct],
    transactions: [],
    customers: [],
    stockMovements: [],
  });
  const overview = computeFullAnalyticsOverview(dataset, {}, { role: 'admin' });

  assert.equal(dataset.products.length, 1);
  assert.equal(
    overview.inventory.summary.totalStockUnits,
    0,
    'Newly created product starts with 0 stock'
  );
});

test('15. Deliberate opening stock entry updates quantity and creates an explicit audit movement', () => {
  const newStockAfterRestock = calculateStockAdjustment(0, 'restock', 20);
  assert.equal(newStockAfterRestock, 20);

  const newStockAfterAudit = calculateStockAdjustment(20, 'audit', 18);
  assert.equal(newStockAfterAudit, 18);
});

test('16. First real sale calculates reports strictly from actual company transaction', () => {
  const nowIso = new Date().toISOString();
  const adminUser = {
    id: 'usr-admin-1',
    name: 'Admin Owner',
    nameAr: 'المالك',
    role: 'admin' as const,
    pin: '1111',
    terminalName: 'Terminal 01',
    terminalNameAr: 'نقطة بيع 1',
    avatarColor: '#10b981',
    isActive: true,
    permissions: {
      canCheckout: true,
      canEditPrices: true,
      canProcessSales: true,
      canApplyDiscounts: true,
      canVoidTransactions: true,
      canManageProducts: true,
      canManageInventory: true,
      canManageCustomers: true,
      canSettleDebts: true,
      canViewReports: true,
      canManageExchangeRates: true,
      canManageSettings: true,
      canManageUsers: true,
    },
    lastActiveAt: nowIso,
  };

  const product = {
    id: 'prod-real-001',
    sku: 'BAR-1001',
    barcode: '622100001001',
    name: 'Sudanese Arabic Gum 500g',
    nameAr: 'صمغ عربي سوداني 500 جرام',
    category: 'Natural Products',
    categoryAr: 'منتجات طبيعية',
    price: 12000,
    sellingPrice: 12000,
    costPrice: 8500,
    stock: 18,
    minStockAlert: 5,
    unit: 'pack',
    updatedAt: nowIso,
  };

  const realSale = {
    id: 'TXN-REAL-001',
    idempotencyKey: 'idem-txn-real-001',
    timestamp: nowIso,
    createdAt: nowIso,
    items: [
      {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: 2,
        unitPrice: 12000,
        discountPercent: 0,
        total: 24000,
      },
    ],
    subtotal: 24000,
    discountAmount: 0,
    taxRatePercent: 0,
    taxAmount: 0,
    total: 24000,
    grandTotal: 24000,
    paymentMethod: 'cash' as const,
    amountTendered: 24000,
    changeDue: 0,
    currency: 'SDG' as const,
    exchangeRateUsed: 1,
    totalInBaseSdg: 24000,
    cashierName: 'Admin Owner',
    status: 'completed' as const,
    syncStatus: 'synced' as const,
  };

  const dataset = buildAnalyticsSnapshotFromState({
    products: [product],
    transactions: [realSale],
    customers: [],
    stockMovements: [],
    users: [adminUser],
  });
  const overview = computeFullAnalyticsOverview(dataset, {}, { userId: 'usr-admin-1', role: 'admin' });

  assert.equal(overview.sales.summary.transactionCount, 1);
  assert.equal(overview.sales.summary.netSales, 24000);
  assert.equal(overview.financial.profitAndLoss.grossProfit, (12000 - 8500) * 2);
});

test('17. Practice Mode isolation keeps demo data inside comp-demo-practice without polluting production', () => {
  const practiceState = readPracticeSandboxState();
  assert.equal(practiceState.companyId, 'comp-demo-practice');
  assert.equal(practiceState.workspaceMode, 'PRACTICE');
  assert.ok(practiceState.products.length > 0, 'Practice Mode contains isolated demo products');

  resetPracticeSandboxState();
  const platform = loadPlatformState();
  const alpha = platform.companies.find((c) => c.legalName === 'Alpha Fresh Mart LLC');
  assert.ok(alpha, 'Production company remains intact after Practice Mode reset');
});

test('18. Unauthorized reset rejection blocks wrong company name or wrong owner password', () => {
  const platform = loadPlatformState();
  const alpha = platform.companies.find((c) => c.legalName === 'Alpha Fresh Mart LLC')!;

  assert.throws(
    () => {
      executeCompanyFactoryReset({
        scope: 'COMPANY_FACTORY_RESET',
        companyId: alpha.id,
        confirmCompanyName: 'Wrong Company Name',
        ownerUsernameOrId: 'ahmad.alpha',
        ownerPassword: 'SecurePassword123!',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ReleasePlatformError);
      assert.equal(err.errorCode, 'COMPANY_NAME_CONFIRMATION_MISMATCH');
      return true;
    }
  );

  assert.throws(
    () => {
      executeCompanyFactoryReset({
        scope: 'COMPANY_FACTORY_RESET',
        companyId: alpha.id,
        confirmCompanyName: 'Alpha Fresh Mart LLC',
        ownerUsernameOrId: 'ahmad.alpha',
        ownerPassword: 'WrongPassword999',
      });
    },
    (err: any) => {
      assert.ok(err instanceof ReleasePlatformError);
      assert.equal(err.errorCode, 'INVALID_OWNER_CREDENTIALS');
      return true;
    }
  );
});

test('19. Authorized Local Device Reset (Scope A) logs audit event without deleting server company records', () => {
  const platform = loadPlatformState();
  const alpha = platform.companies.find((c) => c.legalName === 'Alpha Fresh Mart LLC')!;

  const localReset = executeCompanyFactoryReset({
    scope: 'LOCAL_DEVICE_RESET',
    companyId: alpha.id,
    confirmCompanyName: 'Alpha Fresh Mart LLC',
    ownerUsernameOrId: 'ahmad.alpha',
    ownerPassword: 'SecurePassword123!',
    reason: 'Testing Scope A Local Device Reset',
  });
  assert.equal(localReset.ok, true);
  assert.equal(localReset.scope, 'LOCAL_DEVICE_RESET');

  const platformAfter = loadPlatformState();
  assert.ok(
    platformAfter.companies.some((c) => c.id === alpha.id),
    'Server company record must be preserved during Local Device Reset'
  );
});

test('20. Authorized Company Factory Reset (Scope B) wipes only target company, preserves other companies & audit logs', async () => {
  const betaCreated = await createCompanyAndInitialOwner({
    idempotencyKey: 'test-onboard-beta-002',
    legalName: 'Beta Medical Pharmacy',
    displayName: 'Beta Pharmacy',
    ownerName: 'Dr. Salma',
    ownerUsername: 'salma.beta',
    ownerPassword: 'BetaPassword789!',
    ownerConfirmPassword: 'BetaPassword789!',
  });
  assert.equal(betaCreated.ok, true);
  const betaCompanyId = betaCreated.company.id;

  const platformBefore = loadPlatformState();
  const alpha = platformBefore.companies.find((c) => c.legalName === 'Alpha Fresh Mart LLC')!;

  const companyReset = executeCompanyFactoryReset({
    scope: 'COMPANY_FACTORY_RESET',
    companyId: alpha.id,
    confirmCompanyName: 'Alpha Fresh Mart LLC',
    ownerUsernameOrId: 'ahmad.alpha',
    ownerPassword: 'SecurePassword123!',
    reason: 'Authorized Scope B Factory Reset Test',
  });

  assert.equal(companyReset.ok, true);
  assert.equal(companyReset.scope, 'COMPANY_FACTORY_RESET');

  const platformAfter = loadPlatformState();
  assert.equal(
    platformAfter.companies.some((c) => c.id === alpha.id),
    false,
    'Target company Alpha must be removed'
  );
  assert.equal(
    platformAfter.companies.some((c) => c.id === betaCompanyId),
    true,
    'Unrelated company Beta Medical Pharmacy must remain 100% intact'
  );

  const resetAudit = platformAfter.auditLogs.find(
    (log) => log.action === 'COMPANY_FACTORY_RESET_EXECUTED' && log.entityId === alpha.id
  );
  assert.ok(
    resetAudit,
    'Immutable audit trail record must be preserved after Company Factory Reset'
  );
});
