/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_BACKUP_MODULE_IDS,
  analyzeBackupMergePreview,
  applyIntelligentBackupMerge,
  BackupPayloadV1,
  normalizeEntityName,
  normalizePhone,
  remapBackupPayloadForNewCompany,
  resolveBackupModuleDependencies,
  scrubSensitiveUserFields,
} from '../lib/backup-merge-engine.ts';
import {
  createCompanyBackupArchive,
  deleteSavedCompanyBackup,
  executeCompanyBackupMerge,
  listCompanySavedBackups,
  packBackupEnvelope,
  previewCompanyBackupMerge,
  restoreBackupAsNewCompany,
  restoreBackupIntoOriginalCompany,
  verifyAndUnpackBackupEnvelope,
} from './backup-restore.service.ts';
import {
  AuthenticatedActorContext,
  createCompanyAndInitialOwner,
  createEmployeeAccount,
  loadPlatformState,
} from './release-onboarding.service.ts';

function buildSamplePayload(companyId: string, companyName: string, baseCurrency = 'SDG'): BackupPayloadV1 {
  const now = new Date().toISOString();
  return {
    companyProfile: {
      id: companyId,
      code: `CMP-${companyId.slice(-4).toUpperCase()}`,
      legalName: companyName,
      displayName: companyName,
      displayNameAr: companyName,
      businessType: 'retail',
      country: 'Sudan',
      defaultLanguage: 'ar',
      fiscalYearStartMonth: 1,
      baseCurrency,
      isDemo: false,
      setupCompleted: true,
      createdAt: now,
      updatedAt: now,
    },
    storeSettings: {
      storeName: companyName,
      storeNameAr: companyName,
      currency: baseCurrency,
      taxRatePercent: 15,
    },
    invoiceSettings: {
      showLogo: true,
      footerNote: 'Thank you for shopping with us',
    },
    currencies: [
      {
        code: baseCurrency,
        name: baseCurrency === 'SDG' ? 'Sudanese Pound' : 'US Dollar',
        nameAr: baseCurrency === 'SDG' ? 'جنيه سوداني' : 'دولار أمريكي',
        symbol: baseCurrency === 'SDG' ? 'ج.س' : '$',
        decimalPlaces: 2,
        isBase: true,
        isActive: true,
      },
      {
        code: 'SAR',
        name: 'Saudi Riyal',
        nameAr: 'ريال سعودي',
        symbol: 'ر.س',
        decimalPlaces: 2,
        isBase: false,
        isActive: true,
      },
    ],
    exchangeRates: { [baseCurrency]: 1, SDG: 1, SAR: 720 },
    exchangeRateItems: [
      {
        id: 'rate-sar-sdg',
        sourceCurrency: 'SAR',
        targetCurrency: baseCurrency,
        rate: 720,
        inverseRate: 1 / 720,
        effectiveFrom: now,
        expiryDate: null,
        isActive: true,
      },
    ],
    exchangeRateHistory: [],
    branches: [
      {
        id: `br-${companyId}-main`,
        companyId,
        code: `BR-${companyId.slice(-4).toUpperCase()}`,
        name: 'Khartoum Main Branch',
        nameAr: 'فرع الخرطوم الرئيسي',
        city: 'Khartoum',
        isMain: true,
        isActive: true,
        createdAt: now,
      },
    ],
    employees: [
      scrubSensitiveUserFields({
        id: `emp-${companyId}-1`,
        companyId,
        username: `cashier.${companyId}`,
        name: 'Omer Cashier',
        role: 'cashier',
        systemRole: 'CASHIER',
        passwordHash: 'SECRET_HASH_MUST_BE_STRIPPED',
        passwordSalt: 'SECRET_SALT_MUST_BE_STRIPPED',
        pin: '9999',
        isActive: true,
      }),
    ],
    unitsOfMeasure: [
      { id: 'uom-box', code: 'BOX', name: 'Box', dimension: 'count', isBaseUnit: false },
    ],
    customFieldDefinitions: [
      { id: 'cf-expiry', name: 'Batch Code', fieldType: 'text' },
    ],
    categories: [
      { id: 'cat-beverages', companyId, name: 'Beverages', nameAr: 'مشروبات', slug: 'beverages' },
    ],
    products: [
      {
        id: 'prod-coffee-1',
        companyId,
        name: 'Artisan Arabic Coffee 500g',
        nameAr: 'قهوة عربية فاخرة 500 جرام',
        sku: 'COF-500',
        barcode: '628100000101',
        barcodes: ['628100000101', '628100000102'],
        category: 'Beverages',
        categoryAr: 'مشروبات',
        costPrice: 4000,
        sellingPrice: 5500,
        priceCurrency: baseCurrency,
        stock: 25,
        minStockAlert: 5,
        updatedAt: now,
      },
    ],
    customers: [
      {
        id: 'cust-101',
        name: 'Ahmed Al-Mansoor',
        phone: '+249 91 234 5678',
        email: 'ahmed@example.com',
        totalSpent: 11000,
        transactionCount: 2,
        loyaltyPoints: 110,
        createdAt: now,
      },
    ],
    suppliers: [
      {
        id: 'sup-201',
        companyId,
        name: 'Blue Nile Roasters Supply',
        phone: '0915556677',
        taxNumber: 'TIN-889900',
      },
    ],
    stockMovements: [
      {
        id: 'mov-301',
        timestamp: now,
        productId: 'prod-coffee-1',
        productName: 'Artisan Arabic Coffee 500g',
        type: 'restock',
        quantityChange: 25,
        previousStock: 0,
        newStock: 25,
        reason: 'Opening Inventory',
      },
    ],
    branchTransfers: [],
    purchases: [
      {
        id: 'po-401',
        companyId,
        purchaseNumber: 'PO-2025-001',
        supplierId: 'sup-201',
        supplierName: 'Blue Nile Roasters Supply',
        status: 'received',
        currency: baseCurrency,
        totalAmount: 100000,
        items: [
          {
            productId: 'prod-coffee-1',
            productName: 'Artisan Arabic Coffee 500g',
            sku: 'COF-500',
            quantity: 25,
            unitCost: 4000,
            totalCost: 100000,
          },
        ],
        createdAt: now,
      },
    ],
    transactions: [
      {
        id: 'TXN-501',
        idempotencyKey: 'idem-txn-501',
        timestamp: now,
        currency: baseCurrency,
        exchangeRateUsed: 2700,
        exchangeRatesSnapshot: { USD: 2700, SAR: 720, SDG: 1 },
        items: [
          {
            productId: 'prod-coffee-1',
            productName: 'Artisan Arabic Coffee 500g',
            sku: 'COF-500',
            quantity: 2,
            unitPrice: 5500,
            discountPercent: 0,
            total: 11000,
          },
        ],
        subtotal: 11000,
        taxRatePercent: 0,
        taxAmount: 0,
        discountAmount: 0,
        grandTotal: 11000,
        paymentMethod: 'cash',
        amountTendered: 11000,
        changeDue: 0,
        paymentStatus: 'paid',
        amountPaid: 11000,
        debtAmount: 0,
        customerId: 'cust-101',
        customerName: 'Ahmed Al-Mansoor',
        cashierName: 'Owner',
        status: 'completed',
        syncStatus: 'synced',
      },
    ],
    expenses: [
      {
        id: 'exp-601',
        companyId,
        title: 'Store Electricity Bill',
        category: 'Utilities',
        amount: 15000,
        currency: baseCurrency,
        date: now,
      },
    ],
    accounts: [
      {
        id: 'acc-1010',
        companyId,
        code: '1010',
        name: 'Main Cash Register',
        nameAr: 'الخزينة الرئيسية',
        type: 'asset',
        currency: baseCurrency,
        balance: 96000,
      },
    ],
    journalEntries: [
      {
        id: 'je-701',
        companyId,
        date: now,
        reference: 'TXN-501',
        description: 'POS Cash Sale TXN-501',
        currency: baseCurrency,
        totalDebit: 11000,
        totalCredit: 11000,
        lines: [
          { accountId: 'acc-1010', accountCode: '1010', debit: 11000, credit: 0 },
        ],
      },
    ],
    unmetDemandRequests: [],
    intelligenceLifecycleItems: [],
    auditLogs: [],
  };
}

// ============================================================================
// TEST 1: FULL COMPANY BACKUP & ZERO-CREDENTIAL SCRUBBING
// ============================================================================
test('1. Full company backup packages all 15 modules, computes SHA-256 checksums, and strips all credentials', () => {
  const sample = buildSamplePayload('comp-alpha', 'Alpha Trading Co.');
  const envelope = packBackupEnvelope({
    payload: sample,
    backupType: 'FULL_COMPANY',
    createdByUserId: 'usr-owner-1',
    createdByUsername: 'alpha.owner',
    notes: 'Monthly Full Backup',
  });

  assert.equal(envelope.formatSignature, 'DQNAMO_POS_BACKUP_V1');
  assert.equal(envelope.encrypted, false);
  assert.equal(envelope.compression, 'gzip');
  assert.equal(envelope.manifest.modulesIncluded.length, ALL_BACKUP_MODULE_IDS.length);
  assert.equal(envelope.manifest.recordCounts.products, 1);
  assert.equal(envelope.manifest.recordCounts.sales, 1);
  assert.equal(envelope.manifest.recordCounts.accounting, 2);

  const unpacked = verifyAndUnpackBackupEnvelope(envelope);
  assert.equal(unpacked.integrityVerified, true);
  assert.equal(unpacked.payload.products.length, 1);
  assert.equal(unpacked.payload.transactions[0].exchangeRatesSnapshot?.SAR, 720);

  // Verify credentials were completely stripped
  const exportedUser = unpacked.payload.employees[0] as any;
  assert.equal(exportedUser.passwordHash, undefined);
  assert.equal(exportedUser.passwordSalt, undefined);
  assert.equal(exportedUser.pin, undefined);
  assert.equal(exportedUser.requiresCredentialSetup, true);
});

// ============================================================================
// TEST 2: SELECTIVE BACKUP & DEPENDENCY GRAPH RESOLUTION
// ============================================================================
test('2. Selective backup resolves hard dependencies automatically or emits warnings when disabled', () => {
  const autoResolved = resolveBackupModuleDependencies(['sales'], {
    autoIncludeHardDependencies: true,
  });
  assert.ok(autoResolved.modulesIncluded.includes('sales'));
  assert.ok(autoResolved.modulesIncluded.includes('products'));
  assert.ok(autoResolved.modulesIncluded.includes('categories'));
  assert.ok(autoResolved.modulesIncluded.includes('branches'));
  assert.ok(autoResolved.modulesIncluded.includes('currencies'));
  assert.ok(autoResolved.autoIncludedDependencies.includes('products'));

  const manualWarnings = resolveBackupModuleDependencies(['sales'], {
    autoIncludeHardDependencies: false,
  });
  assert.equal(manualWarnings.modulesIncluded.length, 1);
  assert.ok(manualWarnings.dependencyWarnings.length >= 4);

  const sample = buildSamplePayload('comp-selective', 'Selective Store');
  const selectiveEnvelope = packBackupEnvelope({
    payload: sample,
    backupType: 'SELECTIVE_MODULES',
    selectedModules: ['products'],
    autoIncludeHardDependencies: true,
    createdByUserId: 'usr-1',
    createdByUsername: 'owner',
  });
  const unpacked = verifyAndUnpackBackupEnvelope(selectiveEnvelope);
  assert.equal(unpacked.payload.products.length, 1);
  assert.equal(unpacked.payload.categories.length, 1); // auto-included hard dependency
  assert.equal(unpacked.payload.transactions.length, 0); // excluded module is empty
});

// ============================================================================
// TEST 3: AES-256-GCM ENCRYPTION & PASSWORD VALIDATION
// ============================================================================
test('3. Encrypted backup with AES-256-GCM decrypts with valid password and rejects wrong or missing password', () => {
  const sample = buildSamplePayload('comp-enc', 'Encrypted Store');
  const encryptedEnvelope = packBackupEnvelope({
    payload: sample,
    backupType: 'FULL_COMPANY',
    createdByUserId: 'usr-1',
    createdByUsername: 'owner',
    encryptionPassword: 'StrongBackupSecret!2025',
  });

  assert.equal(encryptedEnvelope.encrypted, true);
  assert.equal(encryptedEnvelope.encryptionMeta?.algorithm, 'AES-256-GCM');

  // Missing password must fail
  assert.throws(
    () => verifyAndUnpackBackupEnvelope(encryptedEnvelope),
    (err: any) => err.errorCode === 'BACKUP_PASSWORD_REQUIRED'
  );

  // Wrong password must fail
  assert.throws(
    () => verifyAndUnpackBackupEnvelope(encryptedEnvelope, 'WrongPassword123'),
    (err: any) => err.errorCode === 'INVALID_BACKUP_PASSWORD_OR_TAMPERED'
  );

  // Correct password succeeds and verifies SHA-256 checksums
  const unpacked = verifyAndUnpackBackupEnvelope(
    encryptedEnvelope,
    'StrongBackupSecret!2025'
  );
  assert.equal(unpacked.integrityVerified, true);
  assert.equal(unpacked.payload.products[0].sku, 'COF-500');
});

// ============================================================================
// TEST 4: CORRUPTED / TAMPERED BACKUP REJECTION
// ============================================================================
test('4. Tampered backup payload or mismatched module SHA-256 checksum is rejected before restore', () => {
  const sample = buildSamplePayload('comp-tamper', 'Tamper Test Store');
  const envelope = packBackupEnvelope({
    payload: sample,
    backupType: 'FULL_COMPANY',
    createdByUserId: 'usr-1',
    createdByUsername: 'owner',
  });

  // Tamper with master checksum
  const tamperedMaster = {
    ...envelope,
    payloadChecksumSha256: '0000000000000000000000000000000000000000000000000000000000000000',
  };
  assert.throws(
    () => verifyAndUnpackBackupEnvelope(tamperedMaster),
    (err: any) => err.errorCode === 'BACKUP_CHECKSUM_MISMATCH'
  );

  // Tamper with module checksum
  const tamperedModule: any = JSON.parse(JSON.stringify(envelope));
  tamperedModule.manifest.moduleChecksumsSha256.products = 'bad_module_hash';
  assert.throws(
    () => verifyAndUnpackBackupEnvelope(tamperedModule),
    (err: any) => err.errorCode === 'MODULE_CHECKSUM_MISMATCH'
  );
});

// ============================================================================
// TEST 5: ARABIC / ENGLISH NORMALIZATION & DUPLICATE DETECTION
// ============================================================================
test('5. Normalization engine unifies Arabic Alef/Teh-Marbuta/Diacritics and Sudan phone numbers', () => {
  assert.equal(
    normalizeEntityName('أرز البسمتي الفاخر - عبوة ٥ كجم'),
    normalizeEntityName('ارز البسمتى الفاخر عبوه 5 كجم')
  );
  assert.equal(normalizePhone('+249 91 234 5678'), '912345678');
  assert.equal(normalizePhone('00249912345678'), '912345678');
  assert.equal(normalizePhone('091-234-5678'), '912345678');
});

// ============================================================================
// TEST 6: INTELLIGENT MERGE — PRODUCTS, CUSTOMERS, CATEGORIES & FINANCIAL PROTECTION
// ============================================================================
test('6. Intelligent Merge detects duplicates, unions barcodes, preserves live stock, remaps category/customer IDs, and prevents duplicate sales', () => {
  const targetDataset = buildSamplePayload('comp-live', 'Live Store', 'SDG');
  // Live company has 40 units in stock for COF-500, category ID 'cat-live-bev', and customer ID 'cust-live-ahmed'
  targetDataset.categories = [
    { id: 'cat-live-bev', companyId: 'comp-live', name: 'Beverages', nameAr: 'مشروبات', slug: 'beverages' },
  ];
  targetDataset.products = [
    {
      id: 'prod-live-coffee',
      companyId: 'comp-live',
      name: 'Artisan Arabic Coffee 500g',
      nameAr: '', // Missing Arabic name in live store
      sku: 'COF-500',
      barcode: '628100000101',
      barcodes: ['628100000101'],
      category: 'Beverages',
      costPrice: 4000,
      sellingPrice: 6000,
      stock: 40, // Live stock is 40
      minStockAlert: 5,
      updatedAt: new Date().toISOString(),
    },
  ];
  targetDataset.customers = [
    {
      id: 'cust-live-ahmed',
      name: 'Ahmed Al-Mansoor',
      phone: '0912345678', // Matches +249 91 234 5678 in incoming backup!
      email: '',
      totalSpent: 11000,
      transactionCount: 1,
      loyaltyPoints: 110,
      createdAt: new Date().toISOString(),
    },
  ];

  // Incoming backup has:
  // 1. Same product (COF-500) with Arabic name filled, an extra barcode '628100000102', and stock=25
  // 2. A brand-new product (TEA-250)
  // 3. Same customer with +249 91 234 5678 and email 'ahmed@example.com'
  // 4. Existing invoice TXN-501 + a new invoice TXN-502 for cust-101 and prod-coffee-1
  // 5. Conflicting product with same barcode '628100000101' but completely different name
  const incomingDataset = buildSamplePayload('comp-backup-src', 'Backup Source', 'USD');
  incomingDataset.products.push({
    id: 'prod-tea-new',
    companyId: 'comp-backup-src',
    name: 'hibiscus Tea 250g',
    nameAr: 'كركديه فاخر 250 جرام',
    sku: 'TEA-250',
    barcode: '628100000999',
    category: 'Beverages',
    costPrice: 1500,
    sellingPrice: 2500,
    stock: 15,
    minStockAlert: 3,
    updatedAt: new Date().toISOString(),
  });
  incomingDataset.products.push({
    id: 'prod-conflict-barcode',
    companyId: 'comp-backup-src',
    name: 'Industrial Motor Oil 5L',
    nameAr: 'زيت محركات صناعي 5 لتر',
    sku: 'OIL-5L',
    barcode: '628100000101', // Collides with Coffee barcode!
    category: 'Automotive',
    costPrice: 20000,
    sellingPrice: 28000,
    stock: 5,
    minStockAlert: 1,
    updatedAt: new Date().toISOString(),
  });
  incomingDataset.transactions.push({
    ...incomingDataset.transactions[0],
    id: 'TXN-502',
    idempotencyKey: 'idem-txn-502',
    customerId: 'cust-101', // Should remap to 'cust-live-ahmed'
    items: [
      {
        productId: 'prod-coffee-1', // Should remap to 'prod-live-coffee'
        productName: 'Artisan Arabic Coffee 500g',
        sku: 'COF-500',
        quantity: 1,
        unitPrice: 5500,
        discountPercent: 0,
        total: 5500,
      },
    ],
    grandTotal: 5500,
  });

  // Step A: Run dry-run preview
  const preview = analyzeBackupMergePreview(incomingDataset, targetDataset);
  assert.equal(preview.baseCurrencyConflict.hasConflict, true);
  assert.equal(preview.baseCurrencyConflict.targetBaseCurrency, 'SDG');
  assert.equal(preview.baseCurrencyConflict.incomingBaseCurrency, 'USD');

  const coffeePreview = preview.items.find((i) => i.itemKey === 'products:prod-coffee-1');
  assert.equal(coffeePreview?.classification, 'STRONG_MATCH');
  assert.equal(coffeePreview?.matchedTargetId, 'prod-live-coffee');

  const teaPreview = preview.items.find((i) => i.itemKey === 'products:prod-tea-new');
  assert.equal(teaPreview?.classification, 'NO_MATCH');

  const oilConflict = preview.items.find((i) => i.itemKey === 'products:prod-conflict-barcode');
  assert.equal(oilConflict?.classification, 'CONFLICTING_RECORD');

  const custPreview = preview.items.find((i) => i.itemKey === 'customers:cust-101');
  assert.equal(custPreview?.matchedByField, 'phone');
  assert.equal(custPreview?.matchedTargetId, 'cust-live-ahmed');

  const duplicateTxPreview = preview.items.find((i) => i.itemKey === 'sales:TXN-501');
  assert.equal(duplicateTxPreview?.classification, 'EXACT_MATCH');
  assert.equal(duplicateTxPreview?.recommendedAction, 'SKIP');

  // Step B: Execute merge
  const { mergedDataset, summary, idRemapTable } = applyIntelligentBackupMerge(
    incomingDataset,
    targetDataset,
    {
      itemResolutions: {
        'products:prod-conflict-barcode': 'SKIP',
      },
    }
  );

  // Target baseCurrency SDG must be preserved
  assert.equal(mergedDataset.companyProfile.baseCurrency, 'SDG');
  const sdgCur = mergedDataset.currencies.find((c) => c.code === 'SDG');
  const usdCur = mergedDataset.currencies.find((c) => c.code === 'USD');
  assert.equal(sdgCur?.isBase, true);
  assert.equal(usdCur?.isBase, false); // Imported as secondary currency!

  // Category was not duplicated
  assert.equal(mergedDataset.categories.length, 1);
  assert.equal(idRemapTable['cat-beverages'], 'cat-live-bev');

  // Coffee product merged missing Arabic name & extra barcode while keeping live stock = 40
  const mergedCoffee = mergedDataset.products.find((p) => p.id === 'prod-live-coffee')!;
  assert.equal(mergedCoffee.stock, 40);
  assert.equal(mergedCoffee.nameAr, 'قهوة عربية فاخرة 500 جرام');
  assert.ok(mergedCoffee.barcodes?.includes('628100000102'));

  // New Tea product was inserted
  assert.ok(mergedDataset.products.some((p) => p.sku === 'TEA-250'));

  // Customer was merged (email filled, not duplicated)
  assert.equal(mergedDataset.customers.length, 1);
  assert.equal(mergedDataset.customers[0].email, 'ahmed@example.com');

  // Duplicate TXN-501 was skipped; new TXN-502 was imported with remapped customerId & productId
  assert.equal(mergedDataset.transactions.length, 2);
  const importedTx502 = mergedDataset.transactions.find((t) => t.id === 'TXN-502')!;
  assert.equal(importedTx502.customerId, 'cust-live-ahmed');
  assert.equal(importedTx502.items[0].productId, 'prod-live-coffee');
  assert.equal(importedTx502.exchangeRatesSnapshot?.USD, 2700);
  assert.ok(summary.remappedReferencesCount >= 3);
});

// ============================================================================
// TEST 7: END-TO-END SERVER BACKUP, RESTORE IN PLACE, RESTORE AS NEW COMPANY & RBAC ISOLATION
// ============================================================================
test('7. End-to-end server backup, pre-restore checkpoint, restore in place, restore as new company, and RBAC/cross-company security', async () => {
  const uniqueSuffix = Date.now().toString(36).slice(-4);

  // Create Company A & Owner A
  const onboardA = await createCompanyAndInitialOwner({
    legalName: `Nile Star Market ${uniqueSuffix}`,
    ownerName: 'Hassan Owner A',
    ownerUsername: `hassan.a.${uniqueSuffix}`,
    ownerPassword: 'OwnerPassA!123',
    ownerConfirmPassword: 'OwnerPassA!123',
    baseCurrency: 'SDG',
  });

  // Create Company B & Owner B
  const onboardB = await createCompanyAndInitialOwner({
    legalName: `Red Sea Trade ${uniqueSuffix}`,
    ownerName: 'Tariq Owner B',
    ownerUsername: `tariq.b.${uniqueSuffix}`,
    ownerPassword: 'OwnerPassB!123',
    ownerConfirmPassword: 'OwnerPassB!123',
    baseCurrency: 'SDG',
  });

  const pState = loadPlatformState();
  const ownerAUser = pState.users.find((u) => u.id === onboardA.owner.id)!;
  const ownerBUser = pState.users.find((u) => u.id === onboardB.owner.id)!;

  const actorA: AuthenticatedActorContext = {
    user: ownerAUser,
    company: onboardA.company,
    workspaceMode: 'PRODUCTION',
  };
  const actorB: AuthenticatedActorContext = {
    user: ownerBUser,
    company: onboardB.company,
    workspaceMode: 'PRODUCTION',
  };

  // Create a Cashier in Company A (who lacks backup.create / backup.restore / backup.merge)
  const cashierCreated = createEmployeeAccount(actorA, {
    name: 'Salma Cashier',
    username: `salma.cashier.${uniqueSuffix}`,
    systemRole: 'CASHIER',
    password: 'CashierPass!123',
  });
  const stateWithCashier = loadPlatformState();
  const cashierUser = stateWithCashier.users.find((u) => u.id === cashierCreated.id)!;
  const cashierActor: AuthenticatedActorContext = {
    user: cashierUser,
    company: onboardA.company,
    workspaceMode: 'PRODUCTION',
  };

  // 7A: Cashier is blocked from creating backups
  assert.throws(
    () =>
      createCompanyBackupArchive(cashierActor, {
        backupType: 'FULL_COMPANY',
      }),
    (err: any) => err.errorCode === 'FORBIDDEN_MISSING_CAPABILITY'
  );

  // 7B: Owner A creates a full backup of Company A with custom products & sales
  const companyADataset = buildSamplePayload(
    onboardA.company.id,
    onboardA.company.displayName,
    'SDG'
  );
  const { envelope: backupA } = createCompanyBackupArchive(actorA, {
    backupType: 'FULL_COMPANY',
    clientDataset: companyADataset,
    notes: 'Pre-migration full backup',
  });

  const listA = listCompanySavedBackups(onboardA.company.id);
  const listB = listCompanySavedBackups(onboardB.company.id);
  assert.ok(listA.some((b) => b.backupId === backupA.manifest.backupId));
  assert.equal(
    listB.some((b) => b.backupId === backupA.manifest.backupId),
    false,
    'Company B must not see Company A backups'
  );

  // 7C: Cross-company restore protection — Company B cannot restore Company A's backup in-place without override
  assert.throws(
    () =>
      restoreBackupIntoOriginalCompany(actorB, {
        envelope: backupA,
        ownerPassword: 'OwnerPassB!123',
      }),
    (err: any) => err.errorCode === 'BACKUP_COMPANY_IDENTITY_MISMATCH'
  );

  // 7D: Restore into Original Company A requires valid Owner A password and creates an automatic pre-restore checkpoint
  assert.throws(
    () =>
      restoreBackupIntoOriginalCompany(actorA, {
        envelope: backupA,
        ownerPassword: 'WrongPassword!',
      }),
    (err: any) => err.errorCode === 'INVALID_OWNER_CREDENTIALS'
  );

  const inPlaceResult = restoreBackupIntoOriginalCompany(actorA, {
    envelope: backupA,
    ownerPassword: 'OwnerPassA!123',
  });
  assert.equal(inPlaceResult.ok, true);
  assert.ok(inPlaceResult.checkpointBackupId.startsWith('chk-pre-restore-'));
  assert.equal(inPlaceResult.restoredPayload.products.length, 1);

  // Verify the automatic pre-restore checkpoint is stored in Company A's backup list
  const listAAfterRestore = listCompanySavedBackups(onboardA.company.id);
  assert.ok(
    listAAfterRestore.some((b) => b.backupId === inPlaceResult.checkpointBackupId)
  );

  // 7E: Restore Backup A as a Completely New Company C (Option 2)
  const mockReqForOwnerA = {
    headers: { 'x-user-id': ownerAUser.id },
    query: {},
    body: {},
  } as any;

  const newCompanyResult = restoreBackupAsNewCompany(mockReqForOwnerA, {
    envelope: backupA,
    companyName: `Restored Branch Co ${uniqueSuffix}`,
    ownerName: 'New Company C Owner',
    ownerUsername: `owner.c.${uniqueSuffix}`,
    ownerPassword: 'OwnerPassC!123',
    ownerConfirmPassword: 'OwnerPassC!123',
  });

  assert.equal(newCompanyResult.ok, true);
  assert.notEqual(newCompanyResult.company.id, onboardA.company.id);
  assert.equal(newCompanyResult.company.displayName, `Restored Branch Co ${uniqueSuffix}`);
  assert.ok(newCompanyResult.sessionToken.startsWith('dqsess_'));
  assert.ok(newCompanyResult.idRemapCount > 0);
  assert.equal(newCompanyResult.restoredPayload.products.length, 1);
  assert.notEqual(
    newCompanyResult.restoredPayload.products[0].id,
    companyADataset.products[0].id,
    'Product ID in restored New Company C must be remapped to avoid cross-company collision'
  );
  assert.equal(
    newCompanyResult.restoredPayload.transactions[0].items[0].productId,
    newCompanyResult.restoredPayload.products[0].id,
    'Sale item productId must reference the newly remapped product ID'
  );

  // 7F: Preview & Execute Intelligent Merge into Company B
  const previewB = previewCompanyBackupMerge(actorB, {
    envelope: backupA,
  });
  assert.equal(previewB.preview.totals.newRecords > 0, true);

  const mergeB = executeCompanyBackupMerge(actorB, {
    envelope: backupA,
    ownerPassword: 'OwnerPassB!123',
  });
  assert.equal(mergeB.ok, true);
  assert.ok(mergeB.checkpointBackupId.startsWith('chk-pre-merge-'));
  assert.equal(mergeB.mergedPayload.products.length, 1);

  // 7G: Delete checkpoint with Owner password verification
  const delResult = deleteSavedCompanyBackup(
    actorA,
    inPlaceResult.checkpointBackupId,
    'OwnerPassA!123'
  );
  assert.equal(delResult.ok, true);
});
