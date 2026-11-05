/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AppSettings,
  BranchRecord,
  CompanyProfile,
  Currency,
  Customer,
  ExchangeRateHistoryEntry,
  ExchangeRateItem,
  POSUser,
  Product,
  StockMovement,
  Transaction,
} from './types';
import type { UnmetDemandRequestRecord } from '../analytics/analytics.types';
import {
  ALL_CAPABILITY_CODES,
  deriveLegacyPermissionsFromCapabilities,
  getDefaultCapabilitiesForRole,
} from './rbac-capabilities';

// ============================================================================
// 1. BACKUP MODULE DEFINITIONS, MANIFEST & ENVELOPE TYPES
// ============================================================================

export type BackupModuleId =
  | 'company_settings'
  | 'currencies'
  | 'branches'
  | 'employees_permissions'
  | 'uom_custom_fields'
  | 'categories'
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'inventory'
  | 'purchases'
  | 'sales'
  | 'expenses'
  | 'accounting'
  | 'intelligence_audit';

export const ALL_BACKUP_MODULE_IDS: BackupModuleId[] = [
  'company_settings',
  'currencies',
  'branches',
  'employees_permissions',
  'uom_custom_fields',
  'categories',
  'products',
  'customers',
  'suppliers',
  'inventory',
  'purchases',
  'sales',
  'expenses',
  'accounting',
  'intelligence_audit',
];

export interface BackupModuleDefinition {
  id: BackupModuleId;
  labelEn: string;
  labelAr: string;
  descriptionEn: string;
  descriptionAr: string;
  hardDependencies: BackupModuleId[];
  softDependencies: BackupModuleId[];
}

export const BACKUP_MODULE_DEFINITIONS: BackupModuleDefinition[] = [
  {
    id: 'company_settings',
    labelEn: 'Company Profile, Store & Invoice Branding',
    labelAr: 'ملف الشركة وإعدادات المتجر والفواتير والشعار',
    descriptionEn: 'Company legal profile, tax policy, receipt header/footer, and store logo.',
    descriptionAr: 'بيانات الشركة، الرقم الضريبي، ترويسة وتذييل الفاتورة، وشعار المتجر.',
    hardDependencies: [],
    softDependencies: ['currencies'],
  },
  {
    id: 'currencies',
    labelEn: 'Currencies & Exchange Rate History',
    labelAr: 'العملات وسجل أسعار الصرف التاريخية',
    descriptionEn: 'Configured base and secondary currencies with historical exchange-rate records.',
    descriptionAr: 'العملة الأساسية والعملات الإضافية وسجل تغيرات أسعار الصرف.',
    hardDependencies: [],
    softDependencies: [],
  },
  {
    id: 'branches',
    labelEn: 'Branches & Locations',
    labelAr: 'الفروع والمواقع',
    descriptionEn: 'Company branches, branch codes, and contact details.',
    descriptionAr: 'فروع الشركة وأكوادها وعناوينها.',
    hardDependencies: ['company_settings'],
    softDependencies: [],
  },
  {
    id: 'employees_permissions',
    labelEn: 'Employees, Roles & Permissions (Zero Credentials)',
    labelAr: 'الموظفون والأدوار والصلاحيات (بدون كلمات المرور)',
    descriptionEn: 'Employee profiles, branch assignments, and RBAC capabilities (passwords & tokens stripped).',
    descriptionAr: 'ملفات الموظفين والفروع المعينة والصلاحيات التفصيلية (بدون كلمات المرور أو الجلسات).',
    hardDependencies: ['branches'],
    softDependencies: ['company_settings'],
  },
  {
    id: 'uom_custom_fields',
    labelEn: 'Units of Measurement & Custom Product Fields',
    labelAr: 'وحدات القياس والحقول المخصصة للمنتجات',
    descriptionEn: 'Units of measure (UOM), conversion definitions, and custom product field schemas.',
    descriptionAr: 'وحدات القياس ومعاملات التحويل وتعريفات الحقول الإضافية.',
    hardDependencies: [],
    softDependencies: [],
  },
  {
    id: 'categories',
    labelEn: 'Product Categories',
    labelAr: 'فئات وتصنيفات المنتجات',
    descriptionEn: 'Product categories and classification slugs.',
    descriptionAr: 'تصنيفات وأقسام المنتجات.',
    hardDependencies: [],
    softDependencies: [],
  },
  {
    id: 'products',
    labelEn: 'Products, Barcodes & UOM Conversions',
    labelAr: 'المنتجات والباركودات المتعددة ووحدات البيع',
    descriptionEn: 'Full product catalog, primary/additional barcodes, unit conversions, and custom field values.',
    descriptionAr: 'دليل المنتجات الكامل، الباركود الأساسي والإضافي، أسعار الوحدات، والحقول المخصصة.',
    hardDependencies: ['categories', 'uom_custom_fields'],
    softDependencies: ['currencies', 'branches'],
  },
  {
    id: 'customers',
    labelEn: 'Customers & Receivables Directory',
    labelAr: 'سجل العملاء والذمم والولاء',
    descriptionEn: 'Customer profiles, contact numbers, loyalty points, and credit balances.',
    descriptionAr: 'بيانات العملاء، أرقام الهواتف، نقاط الولاء، وأرصدة الديون.',
    hardDependencies: [],
    softDependencies: [],
  },
  {
    id: 'suppliers',
    labelEn: 'Suppliers Directory',
    labelAr: 'سجل الموردين',
    descriptionEn: 'Suppliers, tax numbers, and contact details.',
    descriptionAr: 'بيانات الموردين والأرقام الضريبية وبيانات التواصل.',
    hardDependencies: [],
    softDependencies: [],
  },
  {
    id: 'inventory',
    labelEn: 'Inventory Balances, Stock Movements & Transfers',
    labelAr: 'أرصدة المخزون والحركات المخزنية والتحويلات',
    descriptionEn: 'Stock balances, audit movements, goods receipts, and inter-branch stock transfers.',
    descriptionAr: 'أرصدة المخزون، سجل الحركات المخزنية، التسويات، والتحويلات بين الفروع.',
    hardDependencies: ['products', 'branches', 'uom_custom_fields'],
    softDependencies: ['suppliers'],
  },
  {
    id: 'purchases',
    labelEn: 'Purchase Orders & Supplier Invoices',
    labelAr: 'أوامر وفواتير المشتريات',
    descriptionEn: 'Purchase orders, supplier invoices, and purchase line items.',
    descriptionAr: 'أوامر الشراء وفواتير الموردين وتفاصيل الأصناف المشتراة.',
    hardDependencies: ['products', 'suppliers', 'branches', 'currencies'],
    softDependencies: ['inventory', 'accounting'],
  },
  {
    id: 'sales',
    labelEn: 'Sales, Invoices, Payments, Debt Settlements & Returns',
    labelAr: 'المبيعات والفواتير والمدفوعات وتسديدات الديون والمرتجعات',
    descriptionEn: 'POS sales transactions, line items, payment records, debt settlements, returns, and locked exchange-rate snapshots.',
    descriptionAr: 'فواتير المبيعات، الأصناف المباعة، الدفعات، تحصيل الديون، المرتجعات،ولقطات أسعار الصرف التاريخية.',
    hardDependencies: ['products', 'categories', 'branches', 'currencies'],
    softDependencies: ['customers', 'accounting', 'employees_permissions'],
  },
  {
    id: 'expenses',
    labelEn: 'Operating Expenses',
    labelAr: 'المصروفات التشغيلية',
    descriptionEn: 'Recorded store operating expenses and expense categories.',
    descriptionAr: 'المصروفات التشغيلية المسجلة وتصنيفاتها.',
    hardDependencies: ['currencies', 'branches'],
    softDependencies: ['accounting'],
  },
  {
    id: 'accounting',
    labelEn: 'Chart of Accounts & Journal Entries',
    labelAr: 'دليل الحسابات والقيود اليومية المحاسبية',
    descriptionEn: 'Custom chart of accounts and double-entry accounting journal entries.',
    descriptionAr: 'شجرة الحسابات المخصصة والقيود المحاسبية المزدوجة.',
    hardDependencies: ['currencies'],
    softDependencies: ['sales', 'purchases', 'expenses'],
  },
  {
    id: 'intelligence_audit',
    labelEn: 'Unmet Demand, Intelligence Lifecycle & Audit Logs',
    labelAr: 'الطلبات غير المتوفرة ودورة حياة التنبيهات وسجل التدقيق',
    descriptionEn: 'Customer unmet demand records, intelligence alert workflow states, and security audit trail.',
    descriptionAr: 'سجل طلبات العملاء غير المتوفرة، حالات معالجة التنبيهات الذكية، وسجل التدقيق الأمني.',
    hardDependencies: ['branches', 'products'],
    softDependencies: ['customers'],
  },
];

export interface BackupCategoryRecord {
  id: string;
  companyId?: string;
  name: string;
  nameAr?: string;
  slug: string;
  description?: string;
}

export interface BackupSupplierRecord {
  id: string;
  companyId?: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  balance?: number;
  createdAt?: string;
}

export interface BackupPurchaseOrderRecord {
  id: string;
  companyId?: string;
  purchaseNumber: string;
  supplierId?: string;
  supplierName?: string;
  branchId?: string;
  status: string;
  currency?: string;
  totalAmount: number;
  paidAmount?: number;
  items: {
    id?: string;
    productId: string;
    productName: string;
    sku?: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }[];
  notes?: string;
  createdAt: string;
}

export interface BackupExpenseRecord {
  id: string;
  companyId?: string;
  branchId?: string;
  title: string;
  category: string;
  amount: number;
  currency: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  date: string;
  createdBy?: string;
}

export interface BackupAccountRecord {
  id: string;
  companyId?: string;
  code: string;
  name: string;
  nameAr?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | string;
  currency?: string;
  balance: number;
  isActive?: boolean;
}

export interface BackupJournalEntryRecord {
  id: string;
  companyId?: string;
  date: string;
  reference?: string;
  description: string;
  currency?: string;
  totalDebit: number;
  totalCredit: number;
  lines: {
    accountId: string;
    accountCode?: string;
    accountName?: string;
    debit: number;
    credit: number;
    memo?: string;
  }[];
}

export type ScrubbedBackupUserRecord = Omit<
  POSUser,
  'pin' | 'passwordHash' | 'passwordSalt'
> & {
  requiresCredentialSetup?: boolean;
};

export interface BackupPayloadV1 {
  companyProfile: CompanyProfile;
  storeSettings?: Partial<AppSettings>;
  invoiceSettings?: Record<string, any>;
  currencies: Currency[];
  exchangeRates: Record<string, number>;
  exchangeRateItems: ExchangeRateItem[];
  exchangeRateHistory: ExchangeRateHistoryEntry[];
  branches: BranchRecord[];
  employees: ScrubbedBackupUserRecord[];
  unitsOfMeasure: any[];
  customFieldDefinitions: any[];
  categories: BackupCategoryRecord[];
  products: Product[];
  customers: Customer[];
  suppliers: BackupSupplierRecord[];
  stockMovements: StockMovement[];
  branchTransfers: any[];
  purchases: BackupPurchaseOrderRecord[];
  transactions: Transaction[];
  expenses: BackupExpenseRecord[];
  accounts: BackupAccountRecord[];
  journalEntries: BackupJournalEntryRecord[];
  unmetDemandRequests: UnmetDemandRequestRecord[];
  intelligenceLifecycleItems: any[];
  auditLogs: any[];
}

export interface BackupManifestV1 {
  backupId: string;
  backupType: 'FULL_COMPANY' | 'SELECTIVE_MODULES' | 'PRE_RESTORE_CHECKPOINT';
  schemaVersion: '2025.05.1';
  appVersion: '2.4.0';
  createdAt: string;
  createdByUserId: string;
  createdByUsername: string;
  notes?: string;
  sourceCompany: {
    companyId: string;
    code: string;
    legalName: string;
    displayName: string;
    displayNameAr?: string;
    baseCurrency: string | null;
    businessType?: string;
  };
  modulesIncluded: BackupModuleId[];
  autoIncludedDependencies: BackupModuleId[];
  dependencyWarnings: string[];
  recordCounts: Record<BackupModuleId, number>;
  moduleChecksumsSha256: Record<BackupModuleId, string>;
  totalRecords: number;
}

export interface BackupEnvelopeV1 {
  formatSignature: 'DQNAMO_POS_BACKUP_V1';
  formatVersion: '1.0.0';
  createdAt: string;
  encrypted: boolean;
  compression: 'gzip' | 'none';
  encryptionMeta?: {
    algorithm: 'AES-256-GCM';
    kdf: 'scrypt';
    saltHex: string;
    ivHex: string;
    authTagHex: string;
    kdfParams: { N: number; r: number; p: number; keyLen: number };
  };
  manifest: BackupManifestV1;
  payloadChecksumSha256: string;
  payloadData: string;
}

// ============================================================================
// 2. DEPENDENCY RESOLUTION ENGINE FOR SELECTIVE BACKUPS
// ============================================================================

export function resolveBackupModuleDependencies(
  selectedModules: BackupModuleId[],
  options?: { autoIncludeHardDependencies?: boolean }
): {
  requestedModules: BackupModuleId[];
  modulesIncluded: BackupModuleId[];
  autoIncludedDependencies: BackupModuleId[];
  dependencyWarnings: string[];
  dependencyWarningsAr: string[];
} {
  const autoInclude = options?.autoIncludeHardDependencies ?? true;
  const requestedSet = new Set<BackupModuleId>(
    selectedModules.filter((m) => ALL_BACKUP_MODULE_IDS.includes(m))
  );
  const finalSet = new Set<BackupModuleId>(requestedSet);
  const autoIncludedSet = new Set<BackupModuleId>();
  const warningsEn: string[] = [];
  const warningsAr: string[] = [];

  const defMap = new Map<BackupModuleId, BackupModuleDefinition>(
    BACKUP_MODULE_DEFINITIONS.map((d) => [d.id, d])
  );

  if (autoInclude) {
    // Transitively resolve all hard dependencies
    let added = true;
    while (added) {
      added = false;
      for (const modId of Array.from(finalSet)) {
        const def = defMap.get(modId);
        if (!def) continue;
        for (const dep of def.hardDependencies) {
          if (!finalSet.has(dep)) {
            finalSet.add(dep);
            autoIncludedSet.add(dep);
            added = true;
          }
        }
      }
    }
  } else {
    // Do not auto-include, but emit explicit warnings for missing hard dependencies
    for (const modId of Array.from(requestedSet)) {
      const def = defMap.get(modId);
      if (!def) continue;
      for (const dep of def.hardDependencies) {
        if (!requestedSet.has(dep)) {
          const depDef = defMap.get(dep);
          warningsEn.push(
            `Module "${def.labelEn}" requires "${depDef?.labelEn || dep}" for full referential integrity.`
          );
          warningsAr.push(
            `قسم "${def.labelAr}" يعتمد على "${depDef?.labelAr || dep}" لضمان سلامة الروابط المرجعية.`
          );
        }
      }
    }
  }

  // Check soft dependencies and emit informational warnings if omitted
  for (const modId of Array.from(finalSet)) {
    const def = defMap.get(modId);
    if (!def) continue;
    for (const softDep of def.softDependencies) {
      if (!finalSet.has(softDep)) {
        const softDef = defMap.get(softDep);
        warningsEn.push(
          `Note: "${def.labelEn}" is exported without optional related module "${softDef?.labelEn || softDep}".`
        );
        warningsAr.push(
          `ملاحظة: تم تضمين "${def.labelAr}" بدون القسم المرتبط الاختياري "${softDef?.labelAr || softDep}".`
        );
      }
    }
  }

  // Order according to topological ALL_BACKUP_MODULE_IDS order
  const modulesIncluded = ALL_BACKUP_MODULE_IDS.filter((m) => finalSet.has(m));
  const autoIncludedDependencies = ALL_BACKUP_MODULE_IDS.filter((m) =>
    autoIncludedSet.has(m)
  );

  return {
    requestedModules: ALL_BACKUP_MODULE_IDS.filter((m) => requestedSet.has(m)),
    modulesIncluded,
    autoIncludedDependencies,
    dependencyWarnings: warningsEn,
    dependencyWarningsAr: warningsAr,
  };
}

// ============================================================================
// 3. ZERO-CREDENTIAL SCRUBBING & PAYLOAD SANITIZATION
// ============================================================================

export function scrubSensitiveUserFields(user: any): ScrubbedBackupUserRecord {
  if (!user || typeof user !== 'object') {
    return {
      id: 'unknown',
      name: 'Employee',
      role: 'cashier',
      terminalName: 'POS Terminal',
      avatarColor: '#3b82f6',
      isActive: true,
      permissions: deriveLegacyPermissionsFromCapabilities(
        getDefaultCapabilitiesForRole('CASHIER')
      ),
      lastActiveAt: new Date().toISOString(),
      requiresCredentialSetup: true,
    };
  }
  const clone: Record<string, any> = { ...user };
  // Strictly strip all password hashes, salts, PIN codes, and session tokens
  delete clone.passwordHash;
  delete clone.passwordSalt;
  delete clone.password;
  delete clone.confirmPassword;
  delete clone.pin;
  delete clone.pinCode;
  delete clone.sessionToken;
  delete clone.tokenHash;
  clone.hasPassword = false;
  clone.requiresCredentialSetup = true;
  return clone as ScrubbedBackupUserRecord;
}

export function computeBackupModuleRecordCounts(
  payload: Partial<BackupPayloadV1>,
  modulesIncluded: BackupModuleId[]
): {
  recordCounts: Record<BackupModuleId, number>;
  totalRecords: number;
} {
  const inc = new Set<BackupModuleId>(modulesIncluded);
  const counts: Record<BackupModuleId, number> = {
    company_settings: inc.has('company_settings') && payload.companyProfile ? 1 : 0,
    currencies: inc.has('currencies')
      ? (payload.currencies?.length || 0) + (payload.exchangeRateItems?.length || 0)
      : 0,
    branches: inc.has('branches') ? payload.branches?.length || 0 : 0,
    employees_permissions: inc.has('employees_permissions')
      ? payload.employees?.length || 0
      : 0,
    uom_custom_fields: inc.has('uom_custom_fields')
      ? (payload.unitsOfMeasure?.length || 0) +
        (payload.customFieldDefinitions?.length || 0)
      : 0,
    categories: inc.has('categories') ? payload.categories?.length || 0 : 0,
    products: inc.has('products') ? payload.products?.length || 0 : 0,
    customers: inc.has('customers') ? payload.customers?.length || 0 : 0,
    suppliers: inc.has('suppliers') ? payload.suppliers?.length || 0 : 0,
    inventory: inc.has('inventory')
      ? (payload.stockMovements?.length || 0) + (payload.branchTransfers?.length || 0)
      : 0,
    purchases: inc.has('purchases') ? payload.purchases?.length || 0 : 0,
    sales: inc.has('sales') ? payload.transactions?.length || 0 : 0,
    expenses: inc.has('expenses') ? payload.expenses?.length || 0 : 0,
    accounting: inc.has('accounting')
      ? (payload.accounts?.length || 0) + (payload.journalEntries?.length || 0)
      : 0,
    intelligence_audit: inc.has('intelligence_audit')
      ? (payload.unmetDemandRequests?.length || 0) +
        (payload.intelligenceLifecycleItems?.length || 0) +
        (payload.auditLogs?.length || 0)
      : 0,
  };

  const totalRecords = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { recordCounts: counts, totalRecords };
}

export function filterPayloadByIncludedModules(
  fullPayload: BackupPayloadV1,
  modulesIncluded: BackupModuleId[]
): BackupPayloadV1 {
  const inc = new Set<BackupModuleId>(modulesIncluded);
  return {
    companyProfile: fullPayload.companyProfile,
    storeSettings: inc.has('company_settings') ? fullPayload.storeSettings : undefined,
    invoiceSettings: inc.has('company_settings') ? fullPayload.invoiceSettings : undefined,
    currencies: inc.has('currencies') ? fullPayload.currencies || [] : [],
    exchangeRates: inc.has('currencies') ? fullPayload.exchangeRates || { SDG: 1 } : { SDG: 1 },
    exchangeRateItems: inc.has('currencies') ? fullPayload.exchangeRateItems || [] : [],
    exchangeRateHistory: inc.has('currencies') ? fullPayload.exchangeRateHistory || [] : [],
    branches: inc.has('branches') ? fullPayload.branches || [] : [],
    employees: inc.has('employees_permissions')
      ? (fullPayload.employees || []).map((u) => scrubSensitiveUserFields(u))
      : [],
    unitsOfMeasure: inc.has('uom_custom_fields') ? fullPayload.unitsOfMeasure || [] : [],
    customFieldDefinitions: inc.has('uom_custom_fields')
      ? fullPayload.customFieldDefinitions || []
      : [],
    categories: inc.has('categories') ? fullPayload.categories || [] : [],
    products: inc.has('products') ? fullPayload.products || [] : [],
    customers: inc.has('customers') ? fullPayload.customers || [] : [],
    suppliers: inc.has('suppliers') ? fullPayload.suppliers || [] : [],
    stockMovements: inc.has('inventory') ? fullPayload.stockMovements || [] : [],
    branchTransfers: inc.has('inventory') ? fullPayload.branchTransfers || [] : [],
    purchases: inc.has('purchases') ? fullPayload.purchases || [] : [],
    transactions: inc.has('sales') ? fullPayload.transactions || [] : [],
    expenses: inc.has('expenses') ? fullPayload.expenses || [] : [],
    accounts: inc.has('accounting') ? fullPayload.accounts || [] : [],
    journalEntries: inc.has('accounting') ? fullPayload.journalEntries || [] : [],
    unmetDemandRequests: inc.has('intelligence_audit')
      ? fullPayload.unmetDemandRequests || []
      : [],
    intelligenceLifecycleItems: inc.has('intelligence_audit')
      ? fullPayload.intelligenceLifecycleItems || []
      : [],
    auditLogs: inc.has('intelligence_audit') ? fullPayload.auditLogs || [] : [],
  };
}

// ============================================================================
// 4. NORMALIZATION & SIMILARITY ENGINE (ARABIC + ENGLISH + PHONE + CODES)
// ============================================================================

function normalizeEasternArabicDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeEntityName(raw?: string | null): string {
  if (!raw) return '';
  return normalizeEasternArabicDigits(String(raw))
    .normalize('NFKC')
    // Remove Arabic diacritics (Tashkeel) and Tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    // Normalize Arabic Alef variants
    .replace(/[أإآ]/g, 'ا')
    // Normalize Teh Marbuta to Heh
    .replace(/ة/g, 'ه')
    // Normalize Alef Maksura to Yeh
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCode(raw?: string | null): string {
  if (!raw) return '';
  return normalizeEasternArabicDigits(String(raw))
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function normalizePhone(raw?: string | null): string {
  if (!raw) return '';
  let digits = normalizeEasternArabicDigits(String(raw)).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00249')) {
    digits = digits.slice(5);
  } else if (digits.startsWith('249') && digits.length >= 11) {
    digits = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length >= 9) {
    digits = digits.slice(1);
  }
  return digits;
}

export function normalizeEmail(raw?: string | null): string {
  if (!raw) return '';
  return String(raw).trim().toLowerCase();
}

export function computeStringSimilarity(a?: string | null, b?: string | null): number {
  const normA = normalizeEntityName(a);
  const normB = normalizeEntityName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.length < 2 || normB.length < 2) return normA === normB ? 1 : 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < normA.length - 1; i++) {
    const bg = normA.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < normB.length - 1; i++) {
    const bg = normB.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (normA.length - 1 + (normB.length - 1));
}

// ============================================================================
// 5. INTELLIGENT DUPLICATE DETECTION & MERGE PREVIEW ENGINE (PHASES E & F)
// ============================================================================

export type MergeClassification =
  | 'EXACT_MATCH'
  | 'STRONG_MATCH'
  | 'POSSIBLE_MATCH'
  | 'NO_MATCH'
  | 'CONFLICTING_RECORD';

export type MergeResolutionStrategy =
  | 'KEEP_EXISTING'
  | 'UPDATE_EXISTING'
  | 'MERGE'
  | 'IMPORT_AS_NEW'
  | 'SKIP';

export interface MergeRecordPreviewItem {
  itemKey: string;
  moduleId: BackupModuleId;
  entityType: string;
  sourceId: string;
  matchedTargetId: string | null;
  displayName: string;
  naturalKeyLabel: string;
  classification: MergeClassification;
  matchedByField: string | null;
  similarityScore: number;
  recommendedAction: MergeResolutionStrategy;
  conflictReasonEn?: string;
  conflictReasonAr?: string;
  existingSummary?: Record<string, any>;
  incomingSummary?: Record<string, any>;
}

export interface ModuleMergePreviewSummary {
  moduleId: BackupModuleId;
  incomingCount: number;
  existingCount: number;
  exactMatches: number;
  strongMatches: number;
  possibleMatches: number;
  noMatchesNew: number;
  conflicts: number;
  defaultModuleStrategy: MergeResolutionStrategy;
}

export interface BackupMergePreviewReport {
  sourceCompany: BackupManifestV1['sourceCompany'];
  targetCompanyId: string;
  targetCompanyName: string;
  baseCurrencyConflict: {
    hasConflict: boolean;
    targetBaseCurrency: string;
    incomingBaseCurrency: string | null;
    resolutionNoteEn: string;
    resolutionNoteAr: string;
  };
  totals: {
    incomingRecords: number;
    exactMatches: number;
    strongMatches: number;
    possibleMatches: number;
    newRecords: number;
    conflicts: number;
  };
  moduleSummaries: Record<BackupModuleId, ModuleMergePreviewSummary>;
  items: MergeRecordPreviewItem[];
}

function getAllProductBarcodes(p: Partial<Product>): string[] {
  const codes = new Set<string>();
  if (p.barcode && String(p.barcode).trim()) {
    codes.add(normalizeCode(p.barcode));
  }
  if (Array.isArray(p.barcodes)) {
    for (const b of p.barcodes) {
      if (b && String(b).trim()) codes.add(normalizeCode(b));
    }
  }
  if (Array.isArray((p as any).additionalBarcodes)) {
    for (const b of (p as any).additionalBarcodes) {
      const val = typeof b === 'string' ? b : b?.barcode;
      if (val && String(val).trim()) codes.add(normalizeCode(val));
    }
  }
  return Array.from(codes);
}

export function analyzeBackupMergePreview(
  incomingPayload: BackupPayloadV1,
  targetDataset: BackupPayloadV1,
  modulesIncluded?: BackupModuleId[]
): BackupMergePreviewReport {
  const activeModules = new Set<BackupModuleId>(
    modulesIncluded && modulesIncluded.length > 0
      ? modulesIncluded
      : ALL_BACKUP_MODULE_IDS
  );

  const items: MergeRecordPreviewItem[] = [];

  const targetBaseCurr = normalizeCode(targetDataset.companyProfile?.baseCurrency || 'SDG');
  const incomingBaseCurr = normalizeCode(incomingPayload.companyProfile?.baseCurrency || '');
  const hasBaseCurrencyConflict = Boolean(
    incomingBaseCurr && targetBaseCurr && incomingBaseCurr !== targetBaseCurr
  );

  // 1. CATEGORIES
  if (activeModules.has('categories')) {
    const existingCats = targetDataset.categories || [];
    for (const inc of incomingPayload.categories || []) {
      const incSlug = normalizeCode(inc.slug || inc.name);
      const incName = normalizeEntityName(inc.name);
      const incNameAr = normalizeEntityName(inc.nameAr);

      const exactById = existingCats.find((e) => e.id === inc.id);
      const bySlugOrName = existingCats.find(
        (e) =>
          normalizeCode(e.slug || e.name) === incSlug ||
          (incName && normalizeEntityName(e.name) === incName) ||
          (incNameAr && normalizeEntityName(e.nameAr) === incNameAr)
      );
      const matched = exactById || bySlugOrName || null;

      let classification: MergeClassification = 'NO_MATCH';
      let recommendedAction: MergeResolutionStrategy = 'IMPORT_AS_NEW';
      let matchedByField: string | null = null;

      if (matched) {
        matchedByField = exactById ? 'id' : 'name/slug';
        const sameName =
          normalizeEntityName(matched.name) === incName &&
          normalizeEntityName(matched.nameAr || '') === incNameAr;
        classification = sameName ? 'EXACT_MATCH' : 'STRONG_MATCH';
        recommendedAction = sameName ? 'KEEP_EXISTING' : 'MERGE';
      }

      items.push({
        itemKey: `categories:${inc.id}`,
        moduleId: 'categories',
        entityType: 'category',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: inc.nameAr ? `${inc.name} (${inc.nameAr})` : inc.name,
        naturalKeyLabel: inc.slug || inc.name,
        classification,
        matchedByField,
        similarityScore: matched ? 1 : 0,
        recommendedAction,
        existingSummary: matched ? { id: matched.id, name: matched.name, nameAr: matched.nameAr } : undefined,
        incomingSummary: { id: inc.id, name: inc.name, nameAr: inc.nameAr },
      });
    }
  }

  // 2. PRODUCTS
  if (activeModules.has('products')) {
    const existingProds = targetDataset.products || [];
    for (const inc of incomingPayload.products || []) {
      const incBarcodes = getAllProductBarcodes(inc);
      const incSku = normalizeCode(inc.sku);
      const incName = normalizeEntityName(inc.name);
      const incNameAr = normalizeEntityName(inc.nameAr);

      const byBarcode =
        incBarcodes.length > 0
          ? existingProds.find((e) => {
              const eCodes = getAllProductBarcodes(e);
              return incBarcodes.some((code) => eCodes.includes(code));
            })
          : undefined;
      const bySku =
        !byBarcode && incSku
          ? existingProds.find((e) => normalizeCode(e.sku) === incSku)
          : undefined;
      const byId =
        !byBarcode && !bySku ? existingProds.find((e) => e.id === inc.id) : undefined;

      let byNameFuzzy: Product | undefined;
      let bestSim = 0;
      if (!byBarcode && !bySku && !byId) {
        for (const e of existingProds) {
          const simEn = computeStringSimilarity(inc.name, e.name);
          const simAr =
            incNameAr && e.nameAr ? computeStringSimilarity(inc.nameAr, e.nameAr) : 0;
          const sim = Math.max(simEn, simAr);
          if (sim > bestSim) {
            bestSim = sim;
            if (sim >= 0.88) {
              byNameFuzzy = e;
            }
          }
        }
      }

      const matched = byBarcode || bySku || byId || byNameFuzzy || null;
      let classification: MergeClassification = 'NO_MATCH';
      let recommendedAction: MergeResolutionStrategy = 'IMPORT_AS_NEW';
      let matchedByField: string | null = null;
      let conflictReasonEn: string | undefined;
      let conflictReasonAr: string | undefined;
      let similarityScore = 0;

      if (byBarcode || bySku || byId) {
        matchedByField = byBarcode ? 'barcode' : bySku ? 'sku' : 'id';
        const nameSim = Math.max(
          computeStringSimilarity(inc.name, matched!.name),
          computeStringSimilarity(inc.nameAr || inc.name, matched!.nameAr || matched!.name)
        );
        similarityScore = nameSim;

        if (nameSim < 0.35) {
          // Same barcode or SKU, but completely different product name!
          classification = 'CONFLICTING_RECORD';
          recommendedAction = 'KEEP_EXISTING';
          conflictReasonEn = `Incoming product "${inc.name}" shares ${matchedByField.toUpperCase()} with existing product "${matched!.name}" but has a different name.`;
          conflictReasonAr = `المنتج الوارد "${inc.nameAr || inc.name}" يشترك في (${matchedByField.toUpperCase()}) مع المنتج الحالي "${matched!.nameAr || matched!.name}" ولكن باسم مختلف تماماً.`;
        } else {
          const identicalPricesAndMeta =
            Number(matched!.sellingPrice) === Number(inc.sellingPrice) &&
            Number(matched!.costPrice) === Number(inc.costPrice) &&
            normalizeEntityName(matched!.name) === incName;
          classification = identicalPricesAndMeta ? 'EXACT_MATCH' : 'STRONG_MATCH';
          recommendedAction = identicalPricesAndMeta ? 'KEEP_EXISTING' : 'MERGE';
        }
      } else if (byNameFuzzy) {
        matchedByField = 'name+category';
        similarityScore = bestSim;
        classification = 'POSSIBLE_MATCH';
        recommendedAction = 'MERGE';
        conflictReasonEn = `Similar product name (${Math.round(bestSim * 100)}% match) with different SKU/Barcode (${inc.sku} vs ${byNameFuzzy.sku}).`;
        conflictReasonAr = `تشابه في اسم المنتج (${Math.round(bestSim * 100)}%) مع اختلاف رمز SKU أو الباركود (${inc.sku} مقابل ${byNameFuzzy.sku}).`;
      }

      items.push({
        itemKey: `products:${inc.id}`,
        moduleId: 'products',
        entityType: 'product',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: inc.nameAr ? `${inc.name} — ${inc.nameAr}` : inc.name,
        naturalKeyLabel: `SKU: ${inc.sku || '—'} | Barcode: ${inc.barcode || '—'}`,
        classification,
        matchedByField,
        similarityScore,
        recommendedAction,
        conflictReasonEn,
        conflictReasonAr,
        existingSummary: matched
          ? {
              id: matched.id,
              name: matched.name,
              sku: matched.sku,
              barcode: matched.barcode,
              sellingPrice: matched.sellingPrice,
              costPrice: matched.costPrice,
              stock: matched.stock,
            }
          : undefined,
        incomingSummary: {
          id: inc.id,
          name: inc.name,
          sku: inc.sku,
          barcode: inc.barcode,
          sellingPrice: inc.sellingPrice,
          costPrice: inc.costPrice,
          stock: inc.stock,
        },
      });
    }
  }

  // 3. CUSTOMERS
  if (activeModules.has('customers')) {
    const existingCusts = targetDataset.customers || [];
    for (const inc of incomingPayload.customers || []) {
      const incPhone = normalizePhone(inc.phone);
      const incEmail = normalizeEmail(inc.email);
      const incName = normalizeEntityName(inc.name);

      const byPhone =
        incPhone.length >= 6
          ? existingCusts.find((e) => normalizePhone(e.phone) === incPhone)
          : undefined;
      const byEmail =
        !byPhone && incEmail
          ? existingCusts.find((e) => normalizeEmail(e.email) === incEmail)
          : undefined;
      const byId =
        !byPhone && !byEmail ? existingCusts.find((e) => e.id === inc.id) : undefined;
      const byName =
        !byPhone && !byEmail && !byId && incName
          ? existingCusts.find((e) => normalizeEntityName(e.name) === incName)
          : undefined;

      const matched = byPhone || byEmail || byId || byName || null;
      let classification: MergeClassification = 'NO_MATCH';
      let recommendedAction: MergeResolutionStrategy = 'IMPORT_AS_NEW';
      let matchedByField: string | null = null;

      if (byPhone || byEmail || byId) {
        matchedByField = byPhone ? 'phone' : byEmail ? 'email' : 'id';
        const sameName = normalizeEntityName(matched!.name) === incName;
        classification = sameName ? 'EXACT_MATCH' : 'STRONG_MATCH';
        recommendedAction = 'MERGE';
      } else if (byName) {
        matchedByField = 'name';
        classification = 'POSSIBLE_MATCH';
        recommendedAction = 'MERGE';
      }

      items.push({
        itemKey: `customers:${inc.id}`,
        moduleId: 'customers',
        entityType: 'customer',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: inc.name,
        naturalKeyLabel: `Phone: ${inc.phone || '—'} | Email: ${inc.email || '—'}`,
        classification,
        matchedByField,
        similarityScore: matched ? 1 : 0,
        recommendedAction,
        existingSummary: matched
          ? { id: matched.id, name: matched.name, phone: matched.phone, totalSpent: matched.totalSpent }
          : undefined,
        incomingSummary: { id: inc.id, name: inc.name, phone: inc.phone, totalSpent: inc.totalSpent },
      });
    }
  }

  // 4. SUPPLIERS
  if (activeModules.has('suppliers')) {
    const existingSups = targetDataset.suppliers || [];
    for (const inc of incomingPayload.suppliers || []) {
      const incTax = normalizeCode(inc.taxNumber);
      const incPhone = normalizePhone(inc.phone);
      const incName = normalizeEntityName(inc.name);

      const byTax =
        incTax.length >= 3
          ? existingSups.find((e) => normalizeCode(e.taxNumber) === incTax)
          : undefined;
      const byPhone =
        !byTax && incPhone.length >= 6
          ? existingSups.find((e) => normalizePhone(e.phone) === incPhone)
          : undefined;
      const byName =
        !byTax && !byPhone && incName
          ? existingSups.find((e) => normalizeEntityName(e.name) === incName)
          : undefined;

      const matched = byTax || byPhone || byName || null;
      let classification: MergeClassification = 'NO_MATCH';
      let recommendedAction: MergeResolutionStrategy = 'IMPORT_AS_NEW';
      let matchedByField: string | null = null;

      if (byTax || byPhone) {
        matchedByField = byTax ? 'taxNumber' : 'phone';
        classification =
          normalizeEntityName(matched!.name) === incName ? 'EXACT_MATCH' : 'STRONG_MATCH';
        recommendedAction = 'MERGE';
      } else if (byName) {
        matchedByField = 'name';
        classification = 'POSSIBLE_MATCH';
        recommendedAction = 'MERGE';
      }

      items.push({
        itemKey: `suppliers:${inc.id}`,
        moduleId: 'suppliers',
        entityType: 'supplier',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: inc.name,
        naturalKeyLabel: `Tax: ${inc.taxNumber || '—'} | Phone: ${inc.phone || '—'}`,
        classification,
        matchedByField,
        similarityScore: matched ? 1 : 0,
        recommendedAction,
        existingSummary: matched ? { id: matched.id, name: matched.name, phone: matched.phone } : undefined,
        incomingSummary: { id: inc.id, name: inc.name, phone: inc.phone },
      });
    }
  }

  // 5. CURRENCIES
  if (activeModules.has('currencies')) {
    const existingCurrs = targetDataset.currencies || [];
    for (const inc of incomingPayload.currencies || []) {
      const code = normalizeCode(inc.code);
      const matched = existingCurrs.find((e) => normalizeCode(e.code) === code) || null;
      const isBaseConflict = Boolean(inc.isBase && hasBaseCurrencyConflict);

      items.push({
        itemKey: `currencies:${code}`,
        moduleId: 'currencies',
        entityType: 'currency',
        sourceId: code,
        matchedTargetId: matched?.code || null,
        displayName: `${code} — ${inc.nameAr || inc.name}`,
        naturalKeyLabel: `ISO: ${code}${inc.isBase ? ' (Incoming Base)' : ''}`,
        classification: isBaseConflict
          ? 'CONFLICTING_RECORD'
          : matched
          ? 'EXACT_MATCH'
          : 'NO_MATCH',
        matchedByField: matched ? 'code' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'KEEP_EXISTING' : 'IMPORT_AS_NEW',
        conflictReasonEn: isBaseConflict
          ? `Backup currency ${code} is marked as base currency, but target company uses ${targetBaseCurr}. Target base currency ${targetBaseCurr} will be preserved.`
          : undefined,
        conflictReasonAr: isBaseConflict
          ? `عملة النسخة الاحتياطية (${code}) محددة كعملة أساسية، بينما العملة الأساسية للشركة الحالية هي (${targetBaseCurr}). سيتم الحفاظ على العملة الأساسية الحالية.`
          : undefined,
        existingSummary: matched ? { code: matched.code, isBase: matched.isBase } : undefined,
        incomingSummary: { code: inc.code, isBase: inc.isBase },
      });
    }
  }

  // 6. BRANCHES
  if (activeModules.has('branches')) {
    const existingBranches = targetDataset.branches || [];
    for (const inc of incomingPayload.branches || []) {
      const incCode = normalizeCode(inc.code);
      const incName = normalizeEntityName(inc.name);
      const matched =
        existingBranches.find(
          (e) =>
            normalizeCode(e.code) === incCode ||
            normalizeEntityName(e.name) === incName ||
            e.id === inc.id
        ) || null;

      items.push({
        itemKey: `branches:${inc.id}`,
        moduleId: 'branches',
        entityType: 'branch',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: inc.nameAr ? `${inc.name} (${inc.nameAr})` : inc.name,
        naturalKeyLabel: `Code: ${inc.code}`,
        classification: matched ? 'EXACT_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'code/name' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'KEEP_EXISTING' : 'IMPORT_AS_NEW',
      });
    }
  }

  // 7. EMPLOYEES & PERMISSIONS
  if (activeModules.has('employees_permissions')) {
    const existingUsers = targetDataset.employees || [];
    for (const inc of incomingPayload.employees || []) {
      const incUser = normalizeCode(inc.username || inc.id);
      const incEmail = normalizeEmail(inc.email);
      const matched =
        existingUsers.find(
          (e) =>
            normalizeCode(e.username || e.id) === incUser ||
            (incEmail && normalizeEmail(e.email) === incEmail) ||
            e.id === inc.id
        ) || null;

      items.push({
        itemKey: `employees_permissions:${inc.id}`,
        moduleId: 'employees_permissions',
        entityType: 'employee',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: inc.nameAr ? `${inc.name} (${inc.nameAr})` : inc.name,
        naturalKeyLabel: `User: ${inc.username || inc.id} | Role: ${inc.systemRole || inc.role}`,
        classification: matched ? 'STRONG_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'username' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'KEEP_EXISTING' : 'IMPORT_AS_NEW',
      });
    }
  }

  // 8. SALES TRANSACTIONS (STRICT FINANCIAL PROTECTION)
  if (activeModules.has('sales')) {
    const existingTxs = targetDataset.transactions || [];
    for (const inc of incomingPayload.transactions || []) {
      const matched =
        existingTxs.find(
          (e) =>
            e.id === inc.id ||
            (inc.idempotencyKey && e.idempotencyKey === inc.idempotencyKey)
        ) || null;

      let classification: MergeClassification = 'NO_MATCH';
      let recommendedAction: MergeResolutionStrategy = 'IMPORT_AS_NEW';
      let conflictReasonEn: string | undefined;
      let conflictReasonAr: string | undefined;

      if (matched) {
        const sameTotal = Math.abs(Number(matched.grandTotal) - Number(inc.grandTotal)) < 0.01;
        if (sameTotal) {
          classification = 'EXACT_MATCH';
          recommendedAction = 'SKIP';
        } else {
          classification = 'CONFLICTING_RECORD';
          recommendedAction = 'KEEP_EXISTING';
          conflictReasonEn = `Invoice #${inc.id} already exists with grandTotal ${matched.grandTotal} vs incoming ${inc.grandTotal}. Posted invoices are protected against overwrite.`;
          conflictReasonAr = `الفاتورة رقم #${inc.id} موجودة مسبقاً بإجمالي (${matched.grandTotal}) مقابل (${inc.grandTotal}) في النسخة الواردة. الفواتير المرحلة محمية من الكتابة الفوقية.`;
        }
      }

      items.push({
        itemKey: `sales:${inc.id}`,
        moduleId: 'sales',
        entityType: 'transaction',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: `Invoice #${inc.id} (${inc.customerName || 'Walk-in'})`,
        naturalKeyLabel: `Total: ${inc.grandTotal} ${inc.currency || 'SDG'} | ${inc.timestamp?.slice(0, 10) || ''}`,
        classification,
        matchedByField: matched ? 'transactionId' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction,
        conflictReasonEn,
        conflictReasonAr,
        existingSummary: matched
          ? { id: matched.id, grandTotal: matched.grandTotal, status: matched.status }
          : undefined,
        incomingSummary: { id: inc.id, grandTotal: inc.grandTotal, status: inc.status },
      });
    }
  }

  // 9. INVENTORY STOCK MOVEMENTS
  if (activeModules.has('inventory')) {
    const existingMovs = targetDataset.stockMovements || [];
    for (const inc of incomingPayload.stockMovements || []) {
      const matched =
        existingMovs.find(
          (e) =>
            e.id === inc.id ||
            (e.productId === inc.productId &&
              e.type === inc.type &&
              e.timestamp === inc.timestamp &&
              e.quantityChange === inc.quantityChange)
        ) || null;

      items.push({
        itemKey: `inventory:${inc.id}`,
        moduleId: 'inventory',
        entityType: 'stock_movement',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: `${inc.productName} (${inc.type}: ${inc.quantityChange > 0 ? '+' : ''}${inc.quantityChange})`,
        naturalKeyLabel: `Ref: ${inc.referenceId || inc.id}`,
        classification: matched ? 'EXACT_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'id/timestamp' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'SKIP' : 'IMPORT_AS_NEW',
      });
    }
  }

  // 10. PURCHASES
  if (activeModules.has('purchases')) {
    const existingPurchases = targetDataset.purchases || [];
    for (const inc of incomingPayload.purchases || []) {
      const matched =
        existingPurchases.find(
          (e) =>
            e.id === inc.id ||
            normalizeCode(e.purchaseNumber) === normalizeCode(inc.purchaseNumber)
        ) || null;

      items.push({
        itemKey: `purchases:${inc.id}`,
        moduleId: 'purchases',
        entityType: 'purchase',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: `PO #${inc.purchaseNumber} (${inc.supplierName || 'Supplier'})`,
        naturalKeyLabel: `Total: ${inc.totalAmount}`,
        classification: matched ? 'EXACT_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'purchaseNumber' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'SKIP' : 'IMPORT_AS_NEW',
      });
    }
  }

  // 11. ACCOUNTING (ACCOUNTS + JOURNAL ENTRIES)
  if (activeModules.has('accounting')) {
    const existingAccs = targetDataset.accounts || [];
    for (const inc of incomingPayload.accounts || []) {
      const matched =
        existingAccs.find(
          (e) =>
            normalizeCode(e.code) === normalizeCode(inc.code) ||
            normalizeEntityName(e.name) === normalizeEntityName(inc.name) ||
            e.id === inc.id
        ) || null;

      items.push({
        itemKey: `accounting:acc:${inc.id}`,
        moduleId: 'accounting',
        entityType: 'account',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: `${inc.code} — ${inc.nameAr || inc.name}`,
        naturalKeyLabel: `Code: ${inc.code} (${inc.type})`,
        classification: matched ? 'EXACT_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'code/name' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'KEEP_EXISTING' : 'IMPORT_AS_NEW',
      });
    }

    const existingJournals = targetDataset.journalEntries || [];
    for (const inc of incomingPayload.journalEntries || []) {
      const matched =
        existingJournals.find(
          (e) =>
            e.id === inc.id ||
            (inc.reference && e.reference === inc.reference && e.date === inc.date)
        ) || null;

      items.push({
        itemKey: `accounting:je:${inc.id}`,
        moduleId: 'accounting',
        entityType: 'journal_entry',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: `Journal ${inc.reference || inc.id}: ${inc.description}`,
        naturalKeyLabel: `Debit/Credit: ${inc.totalDebit}`,
        classification: matched ? 'EXACT_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'id/reference' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'SKIP' : 'IMPORT_AS_NEW',
      });
    }
  }

  // 12. EXPENSES
  if (activeModules.has('expenses')) {
    const existingExps = targetDataset.expenses || [];
    for (const inc of incomingPayload.expenses || []) {
      const matched =
        existingExps.find(
          (e) =>
            e.id === inc.id ||
            (normalizeEntityName(e.title) === normalizeEntityName(inc.title) &&
              e.date === inc.date &&
              Number(e.amount) === Number(inc.amount))
        ) || null;

      items.push({
        itemKey: `expenses:${inc.id}`,
        moduleId: 'expenses',
        entityType: 'expense',
        sourceId: inc.id,
        matchedTargetId: matched?.id || null,
        displayName: `${inc.title} (${inc.amount} ${inc.currency || 'SDG'})`,
        naturalKeyLabel: `${inc.category} | ${inc.date?.slice(0, 10) || ''}`,
        classification: matched ? 'EXACT_MATCH' : 'NO_MATCH',
        matchedByField: matched ? 'id/title+date' : null,
        similarityScore: matched ? 1 : 0,
        recommendedAction: matched ? 'SKIP' : 'IMPORT_AS_NEW',
      });
    }
  }

  // Build per-module summaries
  const moduleSummaries = {} as Record<BackupModuleId, ModuleMergePreviewSummary>;
  for (const modId of ALL_BACKUP_MODULE_IDS) {
    const modItems = items.filter((i) => i.moduleId === modId);
    moduleSummaries[modId] = {
      moduleId: modId,
      incomingCount: modItems.length,
      existingCount:
        modId === 'products'
          ? targetDataset.products?.length || 0
          : modId === 'customers'
          ? targetDataset.customers?.length || 0
          : modId === 'categories'
          ? targetDataset.categories?.length || 0
          : modId === 'suppliers'
          ? targetDataset.suppliers?.length || 0
          : modId === 'sales'
          ? targetDataset.transactions?.length || 0
          : modId === 'inventory'
          ? targetDataset.stockMovements?.length || 0
          : modId === 'currencies'
          ? targetDataset.currencies?.length || 0
          : modId === 'branches'
          ? targetDataset.branches?.length || 0
          : modId === 'employees_permissions'
          ? targetDataset.employees?.length || 0
          : modId === 'accounting'
          ? (targetDataset.accounts?.length || 0) + (targetDataset.journalEntries?.length || 0)
          : modId === 'expenses'
          ? targetDataset.expenses?.length || 0
          : modId === 'purchases'
          ? targetDataset.purchases?.length || 0
          : 0,
      exactMatches: modItems.filter((i) => i.classification === 'EXACT_MATCH').length,
      strongMatches: modItems.filter((i) => i.classification === 'STRONG_MATCH').length,
      possibleMatches: modItems.filter((i) => i.classification === 'POSSIBLE_MATCH').length,
      noMatchesNew: modItems.filter((i) => i.classification === 'NO_MATCH').length,
      conflicts: modItems.filter((i) => i.classification === 'CONFLICTING_RECORD').length,
      defaultModuleStrategy:
        modId === 'sales' || modId === 'inventory' || modId === 'purchases' || modId === 'expenses'
          ? 'KEEP_EXISTING'
          : 'MERGE',
    };
  }

  const totals = {
    incomingRecords: items.length,
    exactMatches: items.filter((i) => i.classification === 'EXACT_MATCH').length,
    strongMatches: items.filter((i) => i.classification === 'STRONG_MATCH').length,
    possibleMatches: items.filter((i) => i.classification === 'POSSIBLE_MATCH').length,
    newRecords: items.filter((i) => i.classification === 'NO_MATCH').length,
    conflicts: items.filter((i) => i.classification === 'CONFLICTING_RECORD').length,
  };

  return {
    sourceCompany: {
      companyId: incomingPayload.companyProfile?.id || 'unknown',
      code: incomingPayload.companyProfile?.code || 'BACKUP',
      legalName: incomingPayload.companyProfile?.legalName || 'Backup Company',
      displayName: incomingPayload.companyProfile?.displayName || 'Backup Company',
      displayNameAr: incomingPayload.companyProfile?.displayNameAr,
      baseCurrency: incomingPayload.companyProfile?.baseCurrency || null,
      businessType: incomingPayload.companyProfile?.businessType,
    },
    targetCompanyId: targetDataset.companyProfile?.id || 'target-company',
    targetCompanyName:
      targetDataset.companyProfile?.displayName ||
      targetDataset.companyProfile?.legalName ||
      'Target Company',
    baseCurrencyConflict: {
      hasConflict: hasBaseCurrencyConflict,
      targetBaseCurrency: targetBaseCurr,
      incomingBaseCurrency: incomingBaseCurr || null,
      resolutionNoteEn: hasBaseCurrencyConflict
        ? `Target company base currency (${targetBaseCurr}) will be preserved. Incoming base currency (${incomingBaseCurr}) will be imported as a secondary currency.`
        : `Base currency (${targetBaseCurr}) matches.`,
      resolutionNoteAr: hasBaseCurrencyConflict
        ? `سيتم الحفاظ على العملة الأساسية للشركة الحالية (${targetBaseCurr}) وإدراج عملة النسخة الاحتياطية (${incomingBaseCurr}) كعملة فرعية.`
        : `العملة الأساسية (${targetBaseCurr}) متطابقة.`,
    },
    totals,
    moduleSummaries,
    items,
  };
}

// ============================================================================
// 6. TRANSACTIONAL INTELLIGENT MERGE EXECUTOR (PHASE E & F)
// ============================================================================

export interface ExecuteBackupMergeOptions {
  selectedModules?: BackupModuleId[];
  moduleStrategies?: Partial<Record<BackupModuleId, MergeResolutionStrategy>>;
  itemResolutions?: Record<string, MergeResolutionStrategy>;
  applyIncomingStockDelta?: boolean;
}

export interface BackupMergeExecutionSummary {
  insertedCount: number;
  updatedCount: number;
  mergedCount: number;
  keptExistingCount: number;
  skippedCount: number;
  remappedReferencesCount: number;
  byModule: Record<
    BackupModuleId,
    {
      inserted: number;
      updated: number;
      merged: number;
      kept: number;
      skipped: number;
    }
  >;
}

export function applyIntelligentBackupMerge(
  incomingPayload: BackupPayloadV1,
  targetDataset: BackupPayloadV1,
  options: ExecuteBackupMergeOptions = {}
): {
  mergedDataset: BackupPayloadV1;
  summary: BackupMergeExecutionSummary;
  idRemapTable: Record<string, string>;
} {
  const activeModules = new Set<BackupModuleId>(
    options.selectedModules && options.selectedModules.length > 0
      ? options.selectedModules
      : ALL_BACKUP_MODULE_IDS
  );

  const preview = analyzeBackupMergePreview(
    incomingPayload,
    targetDataset,
    Array.from(activeModules)
  );
  const previewItemMap = new Map<string, MergeRecordPreviewItem>(
    preview.items.map((item) => [item.itemKey, item])
  );

  // Clone target dataset so execution is pure and atomic
  const result: BackupPayloadV1 = JSON.parse(JSON.stringify(targetDataset));
  const targetCompanyId = result.companyProfile.id;
  const targetBaseCurr = normalizeCode(result.companyProfile.baseCurrency || 'SDG');

  const idRemapTable: Record<string, string> = {};
  let remappedReferencesCount = 0;

  const summary: BackupMergeExecutionSummary = {
    insertedCount: 0,
    updatedCount: 0,
    mergedCount: 0,
    keptExistingCount: 0,
    skippedCount: 0,
    remappedReferencesCount: 0,
    byModule: {} as any,
  };
  for (const modId of ALL_BACKUP_MODULE_IDS) {
    summary.byModule[modId] = { inserted: 0, updated: 0, merged: 0, kept: 0, skipped: 0 };
  }

  const resolveAction = (
    itemKey: string,
    moduleId: BackupModuleId,
    fallback: MergeResolutionStrategy
  ): MergeResolutionStrategy => {
    if (options.itemResolutions && options.itemResolutions[itemKey]) {
      return options.itemResolutions[itemKey];
    }
    const previewItem = previewItemMap.get(itemKey);
    if (options.moduleStrategies && options.moduleStrategies[moduleId]) {
      const modStrat = options.moduleStrategies[moduleId]!;
      // If record is NO_MATCH, unless module strategy is SKIP, import it as new
      if (previewItem?.classification === 'NO_MATCH' && modStrat !== 'SKIP') {
        return 'IMPORT_AS_NEW';
      }
      // Protect posted transactions from overwrite even if module strategy is UPDATE_EXISTING
      if (
        moduleId === 'sales' &&
        previewItem?.classification === 'CONFLICTING_RECORD' &&
        (modStrat === 'UPDATE_EXISTING' || modStrat === 'MERGE')
      ) {
        return 'KEEP_EXISTING';
      }
      return modStrat;
    }
    return previewItem?.recommendedAction || fallback;
  };

  const recordOutcome = (modId: BackupModuleId, action: 'inserted' | 'updated' | 'merged' | 'kept' | 'skipped') => {
    summary.byModule[modId][action]++;
    if (action === 'inserted') summary.insertedCount++;
    else if (action === 'updated') summary.updatedCount++;
    else if (action === 'merged') summary.mergedCount++;
    else if (action === 'kept') summary.keptExistingCount++;
    else if (action === 'skipped') summary.skippedCount++;
  };

  // 1. CURRENCIES & EXCHANGE RATES
  if (activeModules.has('currencies')) {
    result.currencies = result.currencies || [];
    result.exchangeRates = result.exchangeRates || { [targetBaseCurr]: 1, SDG: 1 };
    result.exchangeRateItems = result.exchangeRateItems || [];

    for (const inc of incomingPayload.currencies || []) {
      const code = normalizeCode(inc.code);
      const itemKey = `currencies:${code}`;
      const action = resolveAction(itemKey, 'currencies', 'MERGE');
      const existingIdx = result.currencies.findIndex((c) => normalizeCode(c.code) === code);

      if (action === 'SKIP') {
        recordOutcome('currencies', 'skipped');
        continue;
      }

      // Never overwrite target company's baseCurrency flag
      const safeCurrency: Currency = {
        ...inc,
        code,
        isBase: result.currencies.length === 0 ? Boolean(inc.isBase) : code === targetBaseCurr,
        isActive: true,
      };

      if (existingIdx === -1) {
        result.currencies.push(safeCurrency);
        recordOutcome('currencies', 'inserted');
      } else if (action === 'UPDATE_EXISTING' || action === 'MERGE') {
        result.currencies[existingIdx] = {
          ...result.currencies[existingIdx],
          name: result.currencies[existingIdx].name || inc.name,
          nameAr: result.currencies[existingIdx].nameAr || inc.nameAr,
          symbol: result.currencies[existingIdx].symbol || inc.symbol,
          isBase: result.currencies[existingIdx].isBase,
        };
        recordOutcome('currencies', 'merged');
      } else {
        recordOutcome('currencies', 'kept');
      }
    }

    // Merge exchange rate items by (sourceCurrency, targetCurrency) without overwriting newer existing rates unless UPDATE_EXISTING
    for (const incRate of incomingPayload.exchangeRateItems || []) {
      const src = normalizeCode(incRate.sourceCurrency);
      const tgt = normalizeCode(incRate.targetCurrency);
      const existsIdx = result.exchangeRateItems.findIndex(
        (r) => normalizeCode(r.sourceCurrency) === src && normalizeCode(r.targetCurrency) === tgt
      );
      if (existsIdx === -1) {
        result.exchangeRateItems.push({ ...incRate });
        if (tgt === targetBaseCurr || tgt === 'SDG') {
          result.exchangeRates[src] = Number(incRate.rate);
        }
      }
    }
  }

  // 2. BRANCHES
  if (activeModules.has('branches')) {
    result.branches = result.branches || [];
    for (const inc of incomingPayload.branches || []) {
      const itemKey = `branches:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'branches', 'MERGE');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        if (matchedId) idRemapTable[inc.id] = matchedId;
        recordOutcome('branches', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        remappedReferencesCount++;
        const idx = result.branches.findIndex((b) => b.id === matchedId);
        if (idx !== -1 && (action === 'MERGE' || action === 'UPDATE_EXISTING')) {
          const ex = result.branches[idx];
          result.branches[idx] = {
            ...ex,
            nameAr: ex.nameAr || inc.nameAr,
            city: ex.city || inc.city,
            address: ex.address || inc.address,
            phone: ex.phone || inc.phone,
          };
          recordOutcome('branches', action === 'MERGE' ? 'merged' : 'updated');
        } else {
          recordOutcome('branches', 'kept');
        }
      } else {
        const newId = result.branches.some((b) => b.id === inc.id)
          ? `br-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : inc.id;
        idRemapTable[inc.id] = newId;
        result.branches.push({
          ...inc,
          id: newId,
          companyId: targetCompanyId,
          isMain: result.branches.length === 0 ? true : false,
          isMainBranch: result.branches.length === 0 ? true : false,
        });
        recordOutcome('branches', 'inserted');
      }
    }
  }

  // 3. CATEGORIES
  if (activeModules.has('categories')) {
    result.categories = result.categories || [];
    for (const inc of incomingPayload.categories || []) {
      const itemKey = `categories:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'categories', 'MERGE');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        if (matchedId) idRemapTable[inc.id] = matchedId;
        recordOutcome('categories', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        remappedReferencesCount++;
        const idx = result.categories.findIndex((c) => c.id === matchedId);
        if (idx !== -1 && (action === 'MERGE' || action === 'UPDATE_EXISTING')) {
          const ex = result.categories[idx];
          result.categories[idx] = {
            ...ex,
            name: action === 'UPDATE_EXISTING' ? inc.name : ex.name || inc.name,
            nameAr: action === 'UPDATE_EXISTING' ? inc.nameAr || ex.nameAr : ex.nameAr || inc.nameAr,
          };
          recordOutcome('categories', action === 'MERGE' ? 'merged' : 'updated');
        } else {
          recordOutcome('categories', 'kept');
        }
      } else {
        const newId = result.categories.some((c) => c.id === inc.id)
          ? `cat-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : inc.id;
        idRemapTable[inc.id] = newId;
        result.categories.push({
          ...inc,
          id: newId,
          companyId: targetCompanyId,
        });
        recordOutcome('categories', 'inserted');
      }
    }
  }

  // 4. UOM & CUSTOM FIELDS
  if (activeModules.has('uom_custom_fields')) {
    result.unitsOfMeasure = result.unitsOfMeasure || [];
    for (const uom of incomingPayload.unitsOfMeasure || []) {
      const exists = result.unitsOfMeasure.find(
        (e) => normalizeCode(e.code) === normalizeCode(uom.code) || e.id === uom.id
      );
      if (!exists) {
        result.unitsOfMeasure.push({ ...uom });
        recordOutcome('uom_custom_fields', 'inserted');
      } else {
        idRemapTable[uom.id] = exists.id;
        recordOutcome('uom_custom_fields', 'kept');
      }
    }

    result.customFieldDefinitions = result.customFieldDefinitions || [];
    for (const cf of incomingPayload.customFieldDefinitions || []) {
      const exists = result.customFieldDefinitions.find(
        (e) => normalizeEntityName(e.name) === normalizeEntityName(cf.name) || e.id === cf.id
      );
      if (!exists) {
        result.customFieldDefinitions.push({ ...cf });
        recordOutcome('uom_custom_fields', 'inserted');
      } else {
        idRemapTable[cf.id] = exists.id;
        recordOutcome('uom_custom_fields', 'kept');
      }
    }
  }

  // 5. PRODUCTS
  if (activeModules.has('products')) {
    result.products = result.products || [];
    result.stockMovements = result.stockMovements || [];

    for (const inc of incomingPayload.products || []) {
      const itemKey = `products:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'products', 'MERGE');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        if (matchedId) idRemapTable[inc.id] = matchedId;
        recordOutcome('products', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        remappedReferencesCount++;
        const idx = result.products.findIndex((p) => p.id === matchedId);
        if (idx === -1) {
          recordOutcome('products', 'skipped');
          continue;
        }
        const ex = result.products[idx];

        if (action === 'KEEP_EXISTING') {
          recordOutcome('products', 'kept');
          continue;
        }

        // Union barcodes without duplicates
        const combinedBarcodes = Array.from(
          new Set([...getAllProductBarcodes(ex), ...getAllProductBarcodes(inc)])
        );

        let nextStock = ex.stock;
        if (options.applyIncomingStockDelta && Number(inc.stock) > 0) {
          nextStock = ex.stock + Number(inc.stock);
          result.stockMovements.unshift({
            id: `mov-merge-${Date.now()}-${ex.id}`,
            timestamp: new Date().toISOString(),
            productId: ex.id,
            productName: ex.name,
            type: 'restock',
            quantityChange: Number(inc.stock),
            previousStock: ex.stock,
            newStock: nextStock,
            reason: `Backup Merge Stock Addition (${inc.id})`,
          });
        }

        if (action === 'UPDATE_EXISTING') {
          result.products[idx] = {
            ...ex,
            ...inc,
            id: ex.id,
            companyId: targetCompanyId,
            stock: nextStock,
            barcodes: combinedBarcodes,
            updatedAt: new Date().toISOString(),
          };
          recordOutcome('products', 'updated');
        } else {
          // MERGE: keep existing core values, fill missing fields, union barcodes & customFields
          result.products[idx] = {
            ...ex,
            nameAr: ex.nameAr || inc.nameAr,
            description: ex.description || inc.description,
            descriptionAr: ex.descriptionAr || inc.descriptionAr,
            category: ex.category || inc.category,
            categoryAr: ex.categoryAr || inc.categoryAr,
            barcode: ex.barcode || inc.barcode,
            barcodes: combinedBarcodes,
            image: ex.image || inc.image,
            minStockAlert: ex.minStockAlert ?? inc.minStockAlert,
            stock: nextStock,
            customFields: {
              ...(inc.customFields || {}),
              ...(ex.customFields || {}),
            },
            updatedAt: new Date().toISOString(),
          };
          recordOutcome('products', 'merged');
        }
      } else {
        // IMPORT_AS_NEW
        const collisionId = result.products.some((p) => p.id === inc.id);
        const collisionSku = result.products.some(
          (p) => normalizeCode(p.sku) === normalizeCode(inc.sku)
        );
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        const newId = collisionId ? `prod-imp-${Date.now().toString(36)}-${suffix.toLowerCase()}` : inc.id;
        const newSku = collisionSku ? `${inc.sku}-IMP-${suffix}` : inc.sku;

        idRemapTable[inc.id] = newId;
        result.products.push({
          ...inc,
          id: newId,
          sku: newSku,
          companyId: targetCompanyId,
          updatedAt: new Date().toISOString(),
        });
        recordOutcome('products', 'inserted');
      }
    }
  }

  // 6. CUSTOMERS
  if (activeModules.has('customers')) {
    result.customers = result.customers || [];
    for (const inc of incomingPayload.customers || []) {
      const itemKey = `customers:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'customers', 'MERGE');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        if (matchedId) idRemapTable[inc.id] = matchedId;
        recordOutcome('customers', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        remappedReferencesCount++;
        const idx = result.customers.findIndex((c) => c.id === matchedId);
        if (idx === -1) {
          recordOutcome('customers', 'skipped');
          continue;
        }
        const ex = result.customers[idx];

        if (action === 'KEEP_EXISTING') {
          recordOutcome('customers', 'kept');
          continue;
        }

        result.customers[idx] = {
          ...ex,
          name: action === 'UPDATE_EXISTING' ? inc.name : ex.name || inc.name,
          phone: action === 'UPDATE_EXISTING' ? inc.phone || ex.phone : ex.phone || inc.phone,
          email: action === 'UPDATE_EXISTING' ? inc.email || ex.email : ex.email || inc.email,
          notes: ex.notes
            ? inc.notes && !ex.notes.includes(inc.notes)
              ? `${ex.notes} | ${inc.notes}`
              : ex.notes
            : inc.notes,
        };
        recordOutcome('customers', action === 'MERGE' ? 'merged' : 'updated');
      } else {
        const newId = result.customers.some((c) => c.id === inc.id)
          ? `cust-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : inc.id;
        idRemapTable[inc.id] = newId;
        result.customers.push({
          ...inc,
          id: newId,
        });
        recordOutcome('customers', 'inserted');
      }
    }
  }

  // 7. SUPPLIERS
  if (activeModules.has('suppliers')) {
    result.suppliers = result.suppliers || [];
    for (const inc of incomingPayload.suppliers || []) {
      const itemKey = `suppliers:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'suppliers', 'MERGE');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        if (matchedId) idRemapTable[inc.id] = matchedId;
        recordOutcome('suppliers', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        remappedReferencesCount++;
        const idx = result.suppliers.findIndex((s) => s.id === matchedId);
        if (idx !== -1 && (action === 'MERGE' || action === 'UPDATE_EXISTING')) {
          const ex = result.suppliers[idx];
          result.suppliers[idx] = {
            ...ex,
            contactName: ex.contactName || inc.contactName,
            phone: ex.phone || inc.phone,
            email: ex.email || inc.email,
            address: ex.address || inc.address,
            taxNumber: ex.taxNumber || inc.taxNumber,
          };
          recordOutcome('suppliers', action === 'MERGE' ? 'merged' : 'updated');
        } else {
          recordOutcome('suppliers', 'kept');
        }
      } else {
        const newId = result.suppliers.some((s) => s.id === inc.id)
          ? `sup-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : inc.id;
        idRemapTable[inc.id] = newId;
        result.suppliers.push({
          ...inc,
          id: newId,
          companyId: targetCompanyId,
        });
        recordOutcome('suppliers', 'inserted');
      }
    }
  }

  // 8. EMPLOYEES & PERMISSIONS (Always scrubbed, never overwrites active Owner credentials)
  if (activeModules.has('employees_permissions')) {
    result.employees = result.employees || [];
    for (const inc of incomingPayload.employees || []) {
      const itemKey = `employees_permissions:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'employees_permissions', 'KEEP_EXISTING');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        recordOutcome('employees_permissions', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        recordOutcome('employees_permissions', 'kept');
      } else {
        const newId = result.employees.some((u) => u.id === inc.id)
          ? `usr-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : inc.id;
        idRemapTable[inc.id] = newId;
        const safeUser = scrubSensitiveUserFields(inc);
        result.employees.push({
          ...safeUser,
          id: newId,
          companyId: targetCompanyId,
          branchId: (inc.branchId && idRemapTable[inc.branchId]) || inc.branchId || result.branches[0]?.id || 'branch-main',
        });
        recordOutcome('employees_permissions', 'inserted');
      }
    }
  }

  // 9. SALES TRANSACTIONS (Never duplicate or overwrite posted invoices)
  if (activeModules.has('sales')) {
    result.transactions = result.transactions || [];
    for (const inc of incomingPayload.transactions || []) {
      const itemKey = `sales:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'sales', 'KEEP_EXISTING');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        recordOutcome('sales', 'skipped');
        continue;
      }

      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        recordOutcome('sales', 'kept');
        continue;
      }

      // Import as new transaction, remapping productId and customerId references
      const newTxId = result.transactions.some((t) => t.id === inc.id)
        ? `${inc.id}-IMP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        : inc.id;
      idRemapTable[inc.id] = newTxId;

      const remappedCustomerId = inc.customerId
        ? idRemapTable[inc.customerId] || inc.customerId
        : undefined;
      if (inc.customerId && idRemapTable[inc.customerId]) {
        remappedReferencesCount++;
      }

      const remappedItems = (inc.items || []).map((line) => {
        const mappedProdId = idRemapTable[line.productId] || line.productId;
        if (idRemapTable[line.productId]) remappedReferencesCount++;
        return {
          ...line,
          productId: mappedProdId,
        };
      });

      result.transactions.push({
        ...inc,
        id: newTxId,
        customerId: remappedCustomerId,
        items: remappedItems,
        // Strictly preserve historical locked exchangeRatesSnapshot
        exchangeRatesSnapshot: inc.exchangeRatesSnapshot
          ? { ...inc.exchangeRatesSnapshot }
          : undefined,
      });
      recordOutcome('sales', 'inserted');
    }
  }

  // 10. INVENTORY STOCK MOVEMENTS
  if (activeModules.has('inventory')) {
    result.stockMovements = result.stockMovements || [];
    for (const inc of incomingPayload.stockMovements || []) {
      const itemKey = `inventory:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'inventory', 'SKIP');
      const matchedId = pItem?.matchedTargetId || null;

      if (matchedId || action === 'SKIP' || action === 'KEEP_EXISTING') {
        recordOutcome('inventory', matchedId ? 'kept' : 'skipped');
        continue;
      }

      const mappedProductId = idRemapTable[inc.productId] || inc.productId;
      if (idRemapTable[inc.productId]) remappedReferencesCount++;

      result.stockMovements.push({
        ...inc,
        id: result.stockMovements.some((m) => m.id === inc.id)
          ? `mov-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : inc.id,
        productId: mappedProductId,
        referenceId: inc.referenceId ? idRemapTable[inc.referenceId] || inc.referenceId : undefined,
      });
      recordOutcome('inventory', 'inserted');
    }
  }

  // 11. PURCHASES
  if (activeModules.has('purchases')) {
    result.purchases = result.purchases || [];
    for (const inc of incomingPayload.purchases || []) {
      const itemKey = `purchases:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'purchases', 'KEEP_EXISTING');
      if (pItem?.matchedTargetId || action === 'SKIP' || action === 'KEEP_EXISTING') {
        recordOutcome('purchases', pItem?.matchedTargetId ? 'kept' : 'skipped');
        continue;
      }

      const mappedSupplierId = inc.supplierId
        ? idRemapTable[inc.supplierId] || inc.supplierId
        : undefined;
      result.purchases.push({
        ...inc,
        id: result.purchases.some((p) => p.id === inc.id)
          ? `po-imp-${Date.now().toString(36)}`
          : inc.id,
        companyId: targetCompanyId,
        supplierId: mappedSupplierId,
        items: (inc.items || []).map((li) => ({
          ...li,
          productId: idRemapTable[li.productId] || li.productId,
        })),
      });
      recordOutcome('purchases', 'inserted');
    }
  }

  // 12. ACCOUNTING
  if (activeModules.has('accounting')) {
    result.accounts = result.accounts || [];
    for (const inc of incomingPayload.accounts || []) {
      const itemKey = `accounting:acc:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'accounting', 'MERGE');
      const matchedId = pItem?.matchedTargetId || null;

      if (action === 'SKIP') {
        recordOutcome('accounting', 'skipped');
        continue;
      }
      if (matchedId && action !== 'IMPORT_AS_NEW') {
        idRemapTable[inc.id] = matchedId;
        remappedReferencesCount++;
        recordOutcome('accounting', 'kept');
      } else {
        const newId = result.accounts.some((a) => a.id === inc.id)
          ? `acc-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
          : inc.id;
        idRemapTable[inc.id] = newId;
        result.accounts.push({
          ...inc,
          id: newId,
          companyId: targetCompanyId,
        });
        recordOutcome('accounting', 'inserted');
      }
    }

    result.journalEntries = result.journalEntries || [];
    for (const inc of incomingPayload.journalEntries || []) {
      const itemKey = `accounting:je:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'accounting', 'KEEP_EXISTING');
      if (pItem?.matchedTargetId || action === 'SKIP') {
        recordOutcome('accounting', pItem?.matchedTargetId ? 'kept' : 'skipped');
        continue;
      }
      result.journalEntries.push({
        ...inc,
        id: result.journalEntries.some((j) => j.id === inc.id)
          ? `je-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
          : inc.id,
        companyId: targetCompanyId,
        lines: (inc.lines || []).map((ln) => ({
          ...ln,
          accountId: idRemapTable[ln.accountId] || ln.accountId,
        })),
      });
      recordOutcome('accounting', 'inserted');
    }
  }

  // 13. EXPENSES
  if (activeModules.has('expenses')) {
    result.expenses = result.expenses || [];
    for (const inc of incomingPayload.expenses || []) {
      const itemKey = `expenses:${inc.id}`;
      const pItem = previewItemMap.get(itemKey);
      const action = resolveAction(itemKey, 'expenses', 'KEEP_EXISTING');
      if (pItem?.matchedTargetId || action === 'SKIP') {
        recordOutcome('expenses', pItem?.matchedTargetId ? 'kept' : 'skipped');
        continue;
      }
      result.expenses.push({
        ...inc,
        id: result.expenses.some((e) => e.id === inc.id)
          ? `exp-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
          : inc.id,
        companyId: targetCompanyId,
      });
      recordOutcome('expenses', 'inserted');
    }
  }

  summary.remappedReferencesCount = remappedReferencesCount;
  return {
    mergedDataset: result,
    summary,
    idRemapTable,
  };
}

// ============================================================================
// 7. RESTORE AS NEW ISOLATED COMPANY REMAPPER (PHASE C — OPTION 2)
// ============================================================================

export interface RestoreAsNewCompanyInput {
  newCompanyId?: string;
  newCompanyCode?: string;
  companyName: string;
  companyNameAr?: string;
  businessType?: string;
  ownerId?: string;
  ownerName: string;
  ownerUsername: string;
  ownerEmail?: string;
  ownerPin?: string;
}

export function remapBackupPayloadForNewCompany(
  sourcePayload: BackupPayloadV1,
  newCompanyInput: RestoreAsNewCompanyInput
): {
  remappedPayload: BackupPayloadV1;
  idRemapTable: Record<string, string>;
  newCompany: CompanyProfile;
  newMainBranch: BranchRecord;
  newOwnerProfile: POSUser;
} {
  const nowIso = new Date().toISOString();
  const suffix = Date.now().toString(36).slice(-5).toLowerCase();
  const newCompanyId = newCompanyInput.newCompanyId || `comp-${suffix}`;
  const newCompanyCode =
    newCompanyInput.newCompanyCode || `CMP-${suffix.toUpperCase()}`;
  const idRemapTable: Record<string, string> = {};

  const mapId = (prefix: string, oldId: string): string => {
    if (!oldId) return `${prefix}-${suffix}-${Math.random().toString(36).slice(2, 6)}`;
    if (idRemapTable[oldId]) return idRemapTable[oldId];
    const generated = `${prefix}-${suffix}-${Math.random().toString(36).slice(2, 7)}`;
    idRemapTable[oldId] = generated;
    return generated;
  };

  idRemapTable[sourcePayload.companyProfile?.id || 'source-company'] = newCompanyId;

  const baseCurr = sourcePayload.companyProfile?.baseCurrency || 'SDG';
  const newCompany: CompanyProfile = {
    ...(sourcePayload.companyProfile || ({} as CompanyProfile)),
    id: newCompanyId,
    code: newCompanyCode,
    legalName: newCompanyInput.companyName.trim(),
    displayName: newCompanyInput.companyName.trim(),
    displayNameAr: (
      newCompanyInput.companyNameAr || newCompanyInput.companyName
    ).trim(),
    businessType:
      newCompanyInput.businessType ||
      sourcePayload.companyProfile?.businessType ||
      'retail',
    baseCurrency: baseCurr,
    isDemo: false,
    isDemoPractice: false,
    setupCompleted: true,
    onboardingCompleted: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // Remap branches
  const sourceBranches = sourcePayload.branches || [];
  const remappedBranches: BranchRecord[] =
    sourceBranches.length > 0
      ? sourceBranches.map((b, idx) => {
          const nbId = mapId('br', b.id);
          return {
            ...b,
            id: nbId,
            companyId: newCompanyId,
            code: `${b.code || 'BR'}-${suffix.toUpperCase()}-${idx + 1}`,
            isMain: idx === 0 ? true : Boolean(b.isMain),
            isMainBranch: idx === 0 ? true : Boolean(b.isMainBranch),
            createdAt: nowIso,
          };
        })
      : [
          {
            id: `br-${suffix}-main`,
            companyId: newCompanyId,
            code: `BR-${suffix.toUpperCase()}-01`,
            name: `${newCompany.displayName} — Main Branch`,
            nameAr: `${newCompany.displayNameAr} — الفرع الرئيسي`,
            city: newCompany.city || 'Khartoum',
            address: newCompany.address || '',
            phone: newCompany.phone || '',
            isMain: true,
            isMainBranch: true,
            isActive: true,
            createdAt: nowIso,
          },
        ];

  const newMainBranch = remappedBranches[0];
  const ownerId = newCompanyInput.ownerId || `usr-owner-${suffix}`;
  newCompany.ownerUserId = ownerId;

  const ownerCaps = [...ALL_CAPABILITY_CODES];
  const newOwnerProfile: POSUser = {
    id: ownerId,
    companyId: newCompanyId,
    branchId: newMainBranch.id,
    assignedBranchIds: remappedBranches.map((b) => b.id),
    name: newCompanyInput.ownerName.trim() || newCompanyInput.ownerUsername.trim(),
    nameAr: newCompanyInput.ownerName.trim() || newCompanyInput.ownerUsername.trim(),
    username: newCompanyInput.ownerUsername.trim().toLowerCase(),
    email: newCompanyInput.ownerEmail?.trim() || undefined,
    role: 'admin',
    systemRole: 'COMPANY_OWNER',
    capabilities: ownerCaps,
    pin: newCompanyInput.ownerPin?.trim() || '1111',
    terminalName: `${newMainBranch.name} — Owner Terminal`,
    terminalNameAr: `${newMainBranch.nameAr} — جهاز المالك`,
    avatarColor: '#10b981',
    isActive: true,
    permissions: deriveLegacyPermissionsFromCapabilities(ownerCaps),
    lastActiveAt: nowIso,
  };

  // Remap non-owner employees (scrubbing all credentials from source backup)
  const remappedEmployees: ScrubbedBackupUserRecord[] = [
    scrubSensitiveUserFields(newOwnerProfile),
    ...(sourcePayload.employees || [])
      .filter((e) => e.systemRole !== 'COMPANY_OWNER')
      .map((e, idx) => {
        const neId = mapId('usr', e.id);
        const scrubbed = scrubSensitiveUserFields(e);
        return {
          ...scrubbed,
          id: neId,
          companyId: newCompanyId,
          username: `${e.username || `emp${idx + 1}`}.${suffix}`,
          branchId:
            (e.branchId && idRemapTable[e.branchId]) || newMainBranch.id,
          assignedBranchIds: Array.isArray(e.assignedBranchIds)
            ? e.assignedBranchIds.map((bid) => idRemapTable[bid] || newMainBranch.id)
            : [newMainBranch.id],
          requiresCredentialSetup: true,
        };
      }),
  ];

  // Remap categories
  const remappedCategories: BackupCategoryRecord[] = (
    sourcePayload.categories || []
  ).map((c) => ({
    ...c,
    id: mapId('cat', c.id),
    companyId: newCompanyId,
    slug: `${c.slug || c.id}-${suffix}`,
  }));

  // Remap suppliers
  const remappedSuppliers: BackupSupplierRecord[] = (
    sourcePayload.suppliers || []
  ).map((s) => ({
    ...s,
    id: mapId('sup', s.id),
    companyId: newCompanyId,
  }));

  // Remap customers
  const remappedCustomers: Customer[] = (sourcePayload.customers || []).map((c) => ({
    ...c,
    id: mapId('cust', c.id),
  }));

  // Remap products
  const remappedProducts: Product[] = (sourcePayload.products || []).map((p) => {
    const npId = mapId('prod', p.id);
    const remappedBranchStock: Record<string, number> | undefined = (p as any).branchStock
      ? Object.fromEntries(
          Object.entries((p as any).branchStock).map(([bId, qty]) => [
            idRemapTable[bId] || newMainBranch.id,
            Number(qty) || 0,
          ])
        )
      : undefined;

    return {
      ...p,
      id: npId,
      companyId: newCompanyId,
      ...(remappedBranchStock ? { branchStock: remappedBranchStock } : {}),
    } as Product;
  });

  // Remap accounts
  const remappedAccounts: BackupAccountRecord[] = (
    sourcePayload.accounts || []
  ).map((a) => ({
    ...a,
    id: mapId('acc', a.id),
    companyId: newCompanyId,
  }));

  // Remap purchases
  const remappedPurchases: BackupPurchaseOrderRecord[] = (
    sourcePayload.purchases || []
  ).map((po) => ({
    ...po,
    id: mapId('po', po.id),
    companyId: newCompanyId,
    purchaseNumber: `${po.purchaseNumber}-${suffix.toUpperCase()}`,
    supplierId: po.supplierId ? idRemapTable[po.supplierId] || po.supplierId : undefined,
    branchId: po.branchId ? idRemapTable[po.branchId] || newMainBranch.id : newMainBranch.id,
    items: (po.items || []).map((item) => ({
      ...item,
      productId: idRemapTable[item.productId] || item.productId,
    })),
  }));

  // Remap transactions (sales)
  const remappedTransactions: Transaction[] = (
    sourcePayload.transactions || []
  ).map((tx) => {
    const nTxId = mapId('tx', tx.id);
    return {
      ...tx,
      id: nTxId,
      idempotencyKey: `idem-${nTxId}`,
      customerId: tx.customerId ? idRemapTable[tx.customerId] || tx.customerId : undefined,
      items: (tx.items || []).map((item) => ({
        ...item,
        productId: idRemapTable[item.productId] || item.productId,
      })),
      exchangeRatesSnapshot: tx.exchangeRatesSnapshot
        ? { ...tx.exchangeRatesSnapshot }
        : undefined,
    };
  });

  // Remap stock movements
  const remappedStockMovements: StockMovement[] = (
    sourcePayload.stockMovements || []
  ).map((mov) => ({
    ...mov,
    id: mapId('mov', mov.id),
    productId: idRemapTable[mov.productId] || mov.productId,
    referenceId: mov.referenceId ? idRemapTable[mov.referenceId] || mov.referenceId : undefined,
  }));

  // Remap expenses
  const remappedExpenses: BackupExpenseRecord[] = (
    sourcePayload.expenses || []
  ).map((exp) => ({
    ...exp,
    id: mapId('exp', exp.id),
    companyId: newCompanyId,
    branchId: exp.branchId ? idRemapTable[exp.branchId] || newMainBranch.id : newMainBranch.id,
  }));

  // Remap journal entries
  const remappedJournalEntries: BackupJournalEntryRecord[] = (
    sourcePayload.journalEntries || []
  ).map((je) => ({
    ...je,
    id: mapId('je', je.id),
    companyId: newCompanyId,
    lines: (je.lines || []).map((ln) => ({
      ...ln,
      accountId: idRemapTable[ln.accountId] || ln.accountId,
    })),
  }));

  // Remap unmet demand requests
  const remappedDemand: UnmetDemandRequestRecord[] = (
    sourcePayload.unmetDemandRequests || []
  ).map((req) => ({
    ...req,
    id: mapId('udr', req.id),
    idempotencyKey: `idem-udr-${suffix}-${req.id}`,
    ...((req as any).matchedProductId
      ? {
          matchedProductId:
            idRemapTable[(req as any).matchedProductId] || (req as any).matchedProductId,
        }
      : {}),
  }));

  const remappedPayload: BackupPayloadV1 = {
    companyProfile: newCompany,
    storeSettings: sourcePayload.storeSettings
      ? {
          ...sourcePayload.storeSettings,
          storeName: newCompany.displayName,
          storeNameAr: newCompany.displayNameAr,
        }
      : undefined,
    invoiceSettings: sourcePayload.invoiceSettings
      ? { ...sourcePayload.invoiceSettings }
      : undefined,
    currencies: JSON.parse(JSON.stringify(sourcePayload.currencies || [])),
    exchangeRates: JSON.parse(JSON.stringify(sourcePayload.exchangeRates || { SDG: 1 })),
    exchangeRateItems: JSON.parse(JSON.stringify(sourcePayload.exchangeRateItems || [])),
    exchangeRateHistory: JSON.parse(JSON.stringify(sourcePayload.exchangeRateHistory || [])),
    branches: remappedBranches,
    employees: remappedEmployees,
    unitsOfMeasure: JSON.parse(JSON.stringify(sourcePayload.unitsOfMeasure || [])),
    customFieldDefinitions: JSON.parse(
      JSON.stringify(sourcePayload.customFieldDefinitions || [])
    ),
    categories: remappedCategories,
    products: remappedProducts,
    customers: remappedCustomers,
    suppliers: remappedSuppliers,
    stockMovements: remappedStockMovements,
    branchTransfers: [],
    purchases: remappedPurchases,
    transactions: remappedTransactions,
    expenses: remappedExpenses,
    accounts: remappedAccounts,
    journalEntries: remappedJournalEntries,
    unmetDemandRequests: remappedDemand,
    intelligenceLifecycleItems: [],
    auditLogs: [],
  };

  return {
    remappedPayload,
    idRemapTable,
    newCompany,
    newMainBranch,
    newOwnerProfile,
  };
}
