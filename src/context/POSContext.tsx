/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  Product,
  CartItem,
  Transaction,
  Customer,
  StockMovement,
  AppSettings,
  AppNavTab,
  PaymentMethod,
  CheckoutPaymentDetails,
  StockMovementType,
  Currency,
  ExchangeRateItem,
  InvoiceFulfillmentStatus,
  InvoiceFulfillmentType,
  GoodsReceiptInput,
  ExchangeRateHistoryEntry,
  ProductSaleUnitMode,
  DebtSettlementInput,
  POSUser,
  ActiveUserSession,
  UserRole,
  RolePermissions,
  WorkspaceMode,
  CompanyProfile,
  BranchRecord,
  OnboardingChecklistStatus,
} from '../lib/types';
import {
  CapabilityCode,
  deriveCapabilitiesFromUser,
  deriveLegacyPermissionsFromCapabilities,
  mapSystemRoleToLegacyRole,
  userHasCapability,
} from '../lib/rbac-capabilities';
import {
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_TRANSACTIONS,
  INITIAL_SETTINGS,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_EXCHANGE_RATE_HISTORY,
  INITIAL_USERS,
  INITIAL_ACTIVE_SESSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  INITIAL_UNMET_DEMAND_REQUESTS,
} from '../lib/initial-data';
import {
  UnmetDemandRequestInput,
  UnmetDemandRequestRecord,
} from '../analytics/analytics.types';
import {
  UnmetDemandValidationResult,
  validateAndBuildUnmetDemandRequest,
} from '../analytics/unmet-demand.validation';
import {
  calculateCartTotals,
  calculateDebtBreakdown,
  validateCheckout,
  CartTotalsResult,
  getProductPricesInCurrency,
  getProductPackaging,
  getCartItemUnitPricing,
  repriceTransactionToNewRate,
  lockTransactionSaleExchangeRate,
  convertCurrencyAmount,
  applyDebtSettlementPayment,
} from '../lib/pos-calculations';
import {
  calculateStockAdjustment,
  generateTransactionId,
  generateIdempotencyKey,
  getProductSerialNumber,
  getNextProductSerialNumber,
  buildProductAuditTrail,
} from '../lib/inventory-rules';
import { playSuccessChime, triggerHaptic } from '../lib/sound-fx';
import { api } from '../services/api';
import {
  EXCHANGE_RATES_STORAGE_KEY,
  EXCHANGE_RATE_ITEMS_STORAGE_KEY,
  CURRENCIES_STORAGE_KEY,
  DEFAULT_EXCHANGE_RATES_MAP,
  DEFAULT_CURRENCIES_LIST,
  loadPersistedCurrencies,
  savePersistedCurrencies,
  reconcileCurrenciesWithPersisted,
  loadPersistedExchangeRates,
  savePersistedExchangeRates,
  loadPersistedExchangeRateItems,
  savePersistedExchangeRateItems,
  reconcileRatesWithPersisted,
} from '../lib/exchange-rate-storage';
import {
  TRAINING_TOUR_STORAGE_KEY,
  TRAINING_TOUR_STEPS,
  TrainingTourProgressState,
  createInitialTourProgress,
  clampTourStepIndex,
  markTourStepVisited,
  markTourCompleted,
  getUserTourStorageKey,
  computeOnboardingChecklistStatus,
} from '../lib/training-tour';
import {
  BackupPayloadV1,
  scrubSensitiveUserFields,
} from '../lib/backup-merge-engine';

export type OnboardingModalView =
  | 'hub'
  | 'create-company'
  | 'restore-backup'
  | 'practice'
  | 'switch-company';

interface POSContextType {
  products: Product[];
  cart: CartItem[];
  transactions: Transaction[];
  customers: Customer[];
  stockMovements: StockMovement[];
  settings: AppSettings;
  currencies: Currency[];
  exchangeRates: Record<string, number>;
  exchangeRateItems: ExchangeRateItem[];
  exchangeRateHistory: ExchangeRateHistoryEntry[];
  activeTab: AppNavTab;
  setActiveTab: (tab: AppNavTab) => void;
  selectedCustomer: Customer | null;
  setSelectedCustomer: (customer: Customer | null) => void;
  globalDiscountPercent: number;
  setGlobalDiscountPercent: (discount: number) => void;
  globalDiscountAmount: number;
  setGlobalDiscountAmount: (amount: number) => void;
  cartTotals: CartTotalsResult;

  // Phase 11: Workspace Mode, Company Isolation, Onboarding & Branch Management
  workspaceMode: WorkspaceMode;
  currentCompany: CompanyProfile;
  companies: CompanyProfile[];
  branches: BranchRecord[];
  activeBranchId: string;
  setActiveBranchId: (branchId: string) => void;
  enterPracticeMode: () => Promise<void>;
  exitPracticeMode: () => Promise<void>;
  resetPracticeModeData: () => Promise<void>;
  createNewCompanyWorkspace: (input: Record<string, any>) => Promise<{
    ok: boolean;
    error?: string;
    company?: CompanyProfile;
    owner?: POSUser;
    branch?: BranchRecord;
  }>;
  switchCompanyWorkspace: (companyId: string, userId?: string) => Promise<void>;
  isOnboardingModalOpen: boolean;
  onboardingModalInitialView: OnboardingModalView;
  openOnboardingModal: (view?: OnboardingModalView) => void;
  closeOnboardingModal: () => void;
  createBranch: (input: {
    name: string;
    nameAr?: string;
    code?: string;
    city?: string;
    address?: string;
    phone?: string;
    isMainBranch?: boolean;
  }) => Promise<BranchRecord | null>;
  updateBranch: (branchId: string, updates: Partial<BranchRecord>) => void;
  deleteBranch: (branchId: string) => void;
  onboardingChecklist: OnboardingChecklistStatus;

  // Users, Role Permissions, Granular Capabilities & Multi-User Concurrent Active Sessions
  users: POSUser[];
  activeSessions: ActiveUserSession[];
  currentUser: POSUser;
  switchCurrentUser: (userId: string) => void;
  saveUser: (
    userData: Partial<POSUser> & { name: string; role: UserRole; password?: string }
  ) => POSUser;
  removeUser: (userId: string) => void;
  deleteUserAccount: (userId: string) => void;
  clearAllUserAccounts: () => void;
  deactivateUserAccount: (
    userId: string,
    reason?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  reactivateUserAccount: (userId: string) => Promise<{ ok: boolean; error?: string }>;
  resetUserPasswordOrPin: (
    userId: string,
    newPassword?: string,
    newPin?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleUserActiveSession: (userId: string, terminalName?: string) => void;
  hasPermission: (permission: keyof RolePermissions) => boolean;
  hasCapability: (capability: CapabilityCode) => boolean;

  // Cart actions
  addToCart: (product: Product, quantity?: number, saleUnit?: ProductSaleUnitMode) => boolean;
  updateCartQuantity: (productId: string, delta: number) => void;
  setCartItemSaleUnit: (productId: string, saleUnit: ProductSaleUnitMode) => void;
  setCartItemDiscount: (productId: string, discountPercent: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;

  // Checkout
  processCheckout: (
    paymentMethod: PaymentMethod,
    amountTendered: number,
    details?: CheckoutPaymentDetails
  ) => Promise<{ success: boolean; transaction?: Transaction; error?: string }>;

  // Products
  addProduct: (product: Omit<Product, 'id' | 'updatedAt'>) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<Product | void>;
  deleteProduct: (id: string) => Promise<void>;
  pendingNewProductBarcode: string | null;
  setPendingNewProductBarcode: (code: string | null) => void;
  openAddProductWithBarcode: (code: string) => void;

  // Inventory & Goods Receipt
  recordStockAdjustment: (
    productId: string,
    type: StockMovementType,
    amount: number,
    reason: string
  ) => void;
  recordGoodsReceipt: (input: GoodsReceiptInput) => boolean;

  // Customers
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'totalSpent' | 'transactionCount' | 'loyaltyPoints'>) => Customer;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  // Transactions
  voidTransaction: (transactionId: string) => boolean;
  settleTransactionDebt: (
    transactionId: string,
    useIndexedNewRate?: boolean,
    anchorCurrency?: string,
    settlementDetails?: DebtSettlementInput
  ) => boolean;
  updateTransactionFulfillment: (
    transactionId: string,
    fulfillmentStatus: InvoiceFulfillmentStatus,
    fulfillmentType?: InvoiceFulfillmentType
  ) => boolean;
  applyNewRateToTransaction: (transactionId: string, anchorCurrency?: string) => boolean;
  applyNewRateToAllTransactions: (onlyDebt?: boolean, anchorCurrency?: string) => number;
  lockTransactionSaleRate: (
    transactionId: string,
    saleRateToSdg: number,
    referenceCurrency?: string
  ) => boolean;

  // Settings, Currencies, Exchange Rates & Sync
  updateSettings: (updates: Partial<AppSettings>) => void;
  saveCurrency: (data: {
    code: string;
    name: string;
    nameAr?: string;
    symbol: string;
    decimalPlaces?: number;
    initialRateToBase?: number;
    isBase?: boolean;
  }) => Promise<Currency>;
  removeCurrency: (code: string) => Promise<void>;
  clearAllCurrencies: () => void;
  setBaseCurrencyCode: (code: string) => void;
  syncCurrenciesState: (list: Currency[]) => void;
  updateExchangeRate: (data: {
    sourceCurrency: string;
    targetCurrency: string;
    rate: number;
    effectiveFrom?: string;
    expiryDate?: string | null;
  }) => Promise<ExchangeRateItem>;
  syncExchangeRatesState: (items: ExchangeRateItem[]) => void;
  resetAllData: () => void;
  executeAuthorizedFactoryReset: (params: {
    scope: 'LOCAL_DEVICE_RESET' | 'COMPANY_FACTORY_RESET';
    confirmCompanyName?: string;
    ownerUsernameOrId?: string;
    ownerPassword?: string;
    reason?: string;
  }) => Promise<{ ok: boolean; error?: string; scope?: string; deletedCounts?: Record<string, number> }>;
  collectClientBackupDataset: () => BackupPayloadV1;
  hydrateCompanyFromBackupPayload: (
    payload: BackupPayloadV1,
    options?: { switchToNewCompany?: boolean; newOwner?: POSUser }
  ) => void;
  syncTransactions: () => Promise<void>;
  isSyncing: boolean;
  lastSyncedAt: Date | null;

  // Interactive Training Tour & Onboarding
  isTrainingTourOpen: boolean;
  trainingTourStepIndex: number;
  trainingTourProgress: TrainingTourProgressState;
  startTrainingTour: (stepIndex?: number) => void;
  closeTrainingTour: () => void;
  nextTrainingTourStep: () => void;
  prevTrainingTourStep: () => void;
  selectTrainingTourStep: (stepIndex: number) => void;
  finishTrainingTour: () => void;
  resetTrainingTour: () => void;

  // Phase 10: Customer Demand Intelligence (Unmet Demand Capture)
  unmetDemandRequests: UnmetDemandRequestRecord[];
  recordUnmetDemandRequest: (
    input: Partial<UnmetDemandRequestInput>
  ) => Promise<UnmetDemandValidationResult>;
  isUnmetDemandModalOpen: boolean;
  unmetDemandModalInitialData: Partial<UnmetDemandRequestInput> | null;
  openUnmetDemandModal: (initial?: Partial<UnmetDemandRequestInput>) => void;
  closeUnmetDemandModal: () => void;
}

const POSContext = createContext<POSContextType | null>(null);

const STORAGE_KEYS = {
  PRODUCTS: 'dqnamo_pos_products_v1',
  TRANSACTIONS: 'dqnamo_pos_transactions_v1',
  CUSTOMERS: 'dqnamo_pos_customers_v1',
  MOVEMENTS: 'dqnamo_pos_movements_v1',
  SETTINGS: 'dqnamo_pos_settings_v1',
  CURRENCIES: CURRENCIES_STORAGE_KEY,
  EXCHANGE_RATES: EXCHANGE_RATES_STORAGE_KEY,
  EXCHANGE_RATE_ITEMS: EXCHANGE_RATE_ITEMS_STORAGE_KEY,
  RATE_HISTORY: 'dqnamo_pos_rate_history_v1',
  USERS: 'dqnamo_pos_users_v1',
  ACTIVE_SESSIONS: 'dqnamo_pos_active_sessions_v1',
  CURRENT_USER_ID: 'dqnamo_pos_current_user_id_v1',
  UNMET_DEMAND_REQUESTS: 'dqnamo_pos_unmet_demand_v1',
  WORKSPACE_MODE: 'dqnamo_pos_workspace_mode_v1',
  CURRENT_COMPANY_ID: 'dqnamo_pos_current_company_id_v1',
  COMPANIES: 'dqnamo_pos_companies_v1',
  BRANCHES: 'dqnamo_pos_branches_v1',
  ACTIVE_BRANCH_ID: 'dqnamo_pos_active_branch_id_v1',
};

const PRACTICE_STORAGE_KEYS = {
  PRODUCTS: 'dqnamo_pos_practice_products_v1',
  TRANSACTIONS: 'dqnamo_pos_practice_transactions_v1',
  CUSTOMERS: 'dqnamo_pos_practice_customers_v1',
  MOVEMENTS: 'dqnamo_pos_practice_movements_v1',
  SETTINGS: 'dqnamo_pos_practice_settings_v1',
  USERS: 'dqnamo_pos_practice_users_v1',
  UNMET_DEMAND_REQUESTS: 'dqnamo_pos_practice_unmet_demand_v1',
};

const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  id: 'comp-default',
  legalName: 'Dqnamo Artisan Roasters & Deli LLC',
  displayName: 'Dqnamo Artisan Roasters & Deli',
  displayNameAr: 'دقنامو للتحميص المختص والديلي',
  businessType: 'Specialty Retail, Roastery & Deli',
  country: 'Sudan',
  city: 'Khartoum',
  address: '104 Nile Avenue, Downtown District, Khartoum',
  phone: '+249 91 230 0000',
  email: 'ops@dqnamo.sd',
  taxNumber: 'SD-TIN-904821',
  defaultLanguage: 'ar',
  timezone: 'Africa/Khartoum',
  fiscalYearStartMonth: 1,
  baseCurrency: 'SDG',
  secondaryCurrencies: ['USD', 'SAR', 'AED', 'EGP'],
  exchangeRatePolicy: 'manual_daily',
  isDemoPractice: false,
  onboardingCompleted: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const PRACTICE_COMPANY_PROFILE: CompanyProfile = {
  id: 'comp-demo-practice',
  legalName: 'Al-Noor Retail Training Sandbox LLC',
  displayName: 'Al-Noor Retail Training Co. (Practice)',
  displayNameAr: 'شركة النور للتدريب التجريبي (بيئة معزولة)',
  businessType: 'Retail & Wholesale Training Sandbox',
  country: 'Sudan',
  city: 'Khartoum',
  address: 'Practice Sandbox Avenue — Isolated Demo Environment',
  phone: '+249 90 000 0000',
  email: 'training@practice.local',
  taxNumber: 'PRACTICE-DEMO-000',
  defaultLanguage: 'ar',
  timezone: 'Africa/Khartoum',
  fiscalYearStartMonth: 1,
  baseCurrency: 'SDG',
  secondaryCurrencies: ['USD', 'SAR', 'AED', 'EGP'],
  exchangeRatePolicy: 'manual_daily',
  isDemoPractice: true,
  onboardingCompleted: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const DEFAULT_BRANCHES_LIST: BranchRecord[] = [
  {
    id: 'branch-main',
    companyId: 'comp-default',
    code: 'KRT-MAIN',
    name: 'Khartoum Main Branch',
    nameAr: 'فرع الخرطوم الرئيسي',
    city: 'Khartoum',
    address: '104 Nile Avenue, Khartoum',
    phone: '+249 91 230 0000',
    isMainBranch: true,
    isActive: true,
  },
  {
    id: 'branch-omdurman',
    companyId: 'comp-default',
    code: 'OMD-02',
    name: 'Omdurman Souq Branch',
    nameAr: 'فرع سوق أمدرمان',
    city: 'Omdurman',
    address: 'Al-Arbaeen Street, Omdurman',
    phone: '+249 91 230 0002',
    isMainBranch: false,
    isActive: true,
  },
  {
    id: 'branch-bahri',
    companyId: 'comp-default',
    code: 'BHR-03',
    name: 'Bahri Industrial Branch',
    nameAr: 'فرع بحري الصناعات',
    city: 'Bahri',
    address: 'Industrial Area Block 4, Bahri',
    phone: '+249 91 230 0003',
    isMainBranch: false,
    isActive: true,
  },
];

function enrichProductWithSeedMetadata(p: Product, idx: number): Product {
  const seedMatch = INITIAL_PRODUCTS.find((sp) => sp.id === p.id || sp.sku === p.sku);
  const serialNumber = getProductSerialNumber(p, seedMatch?.serialNumber ? seedMatch.serialNumber - 1 : idx);
  const description = p.description ?? p.customFields?.description ?? seedMatch?.description;
  const descriptionAr = p.descriptionAr ?? p.customFields?.descriptionAr ?? seedMatch?.descriptionAr;
  const createdAt = p.createdAt ?? p.customFields?.createdAt ?? seedMatch?.createdAt ?? p.updatedAt;
  const previousCostPrice = p.previousCostPrice ?? p.customFields?.previousCostPrice ?? seedMatch?.previousCostPrice;
  const previousSellingPrice =
    p.previousSellingPrice ?? p.customFields?.previousSellingPrice ?? seedMatch?.previousSellingPrice;
  const priceUpdatedAt = p.priceUpdatedAt ?? p.customFields?.priceUpdatedAt ?? seedMatch?.priceUpdatedAt;
  const priceHistory =
    p.priceHistory && p.priceHistory.length > 0
      ? p.priceHistory
      : p.customFields?.priceHistory && p.customFields.priceHistory.length > 0
      ? p.customFields.priceHistory
      : seedMatch?.priceHistory;
  const modificationHistory =
    p.modificationHistory && p.modificationHistory.length > 0
      ? p.modificationHistory
      : p.customFields?.modificationHistory && p.customFields.modificationHistory.length > 0
      ? p.customFields.modificationHistory
      : seedMatch?.modificationHistory;

  return {
    ...p,
    serialNumber,
    description,
    descriptionAr,
    createdAt,
    previousCostPrice,
    previousSellingPrice,
    priceUpdatedAt,
    priceHistory,
    modificationHistory,
    customFields: {
      ...(p.customFields || {}),
      serialNumber,
      description,
      descriptionAr,
      createdAt,
      previousCostPrice,
      previousSellingPrice,
      priceUpdatedAt,
      priceHistory,
      modificationHistory,
    },
  };
}

const CLEAN_PRODUCTION_MIGRATION_KEY = 'dqnamo_pos_clean_prod_v5';

const DEMO_SEED_PRODUCT_IDS = new Set(INITIAL_PRODUCTS.map((p) => p.id));
const DEMO_SEED_SKUS = new Set(INITIAL_PRODUCTS.map((p) => p.sku));
const DEMO_SEED_TX_IDS = new Set(INITIAL_TRANSACTIONS.map((t) => t.id));
const DEMO_SEED_CUSTOMER_IDS = new Set(INITIAL_CUSTOMERS.map((c) => c.id));
const DEMO_SEED_MOVEMENT_IDS = new Set(INITIAL_STOCK_MOVEMENTS.map((m) => m.id));
const DEMO_SEED_USER_IDS = new Set(INITIAL_USERS.map((u) => u.id));
const DEMO_SEED_DEMAND_IDS = new Set(
  (INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[]).map((d) => d.id)
);

const BASE_SDG_CURRENCY: Currency = {
  code: 'SDG',
  name: 'Sudanese Pound',
  nameAr: 'جنيه سوداني',
  symbol: 'ج.س',
  decimalPlaces: 2,
  isBase: true,
  isActive: true,
};

function getCompanyStorageKey(baseKey: string, companyId: string): string {
  const cleanId = (companyId || 'comp-default').trim();
  return `${baseKey}_${cleanId}`;
}

function filterOutDemoProducts(list: Product[]): Product[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p) =>
      p &&
      !DEMO_SEED_PRODUCT_IDS.has(p.id) &&
      !DEMO_SEED_SKUS.has(p.sku) &&
      !String(p.sku || '').startsWith('PERF-SKU-')
  );
}

function filterOutDemoUsers(list: POSUser[]): POSUser[] {
  if (!Array.isArray(list)) return [];
  return list.filter((u) => u && !DEMO_SEED_USER_IDS.has(u.id));
}

function ensureCleanProductionMigration(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(CLEAN_PRODUCTION_MIGRATION_KEY) === 'true') return;
    // Purge legacy default seed data from production keys so demo data only lives in Practice Mode
    localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
    localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
    localStorage.removeItem(STORAGE_KEYS.CUSTOMERS);
    localStorage.removeItem(STORAGE_KEYS.MOVEMENTS);
    localStorage.removeItem(STORAGE_KEYS.CURRENCIES);
    localStorage.removeItem(STORAGE_KEYS.EXCHANGE_RATES);
    localStorage.removeItem(STORAGE_KEYS.EXCHANGE_RATE_ITEMS);
    localStorage.removeItem(STORAGE_KEYS.RATE_HISTORY);
    localStorage.removeItem(STORAGE_KEYS.UNMET_DEMAND_REQUESTS);
    localStorage.removeItem(STORAGE_KEYS.USERS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);

    // Also remove any per-company legacy default currencies or rates so zero unentered currencies remain
    const keysToPurge: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith(STORAGE_KEYS.CURRENCIES) ||
          k.startsWith(STORAGE_KEYS.EXCHANGE_RATES) ||
          k.startsWith(STORAGE_KEYS.EXCHANGE_RATE_ITEMS) ||
          k.startsWith(STORAGE_KEYS.RATE_HISTORY) ||
          k.startsWith('dqnamo_pos_exchange_rate_inputs_v1'))
      ) {
        keysToPurge.push(k);
      }
    }
    for (const k of keysToPurge) {
      localStorage.removeItem(k);
    }

    const savedCompanies = localStorage.getItem(STORAGE_KEYS.COMPANIES);
    if (savedCompanies) {
      const parsed = JSON.parse(savedCompanies);
      if (Array.isArray(parsed)) {
        const userCompanies = parsed.filter(
          (c: CompanyProfile) => c && !c.isDemoPractice && c.id !== 'comp-default'
        );
        localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(userCompanies));
      }
    }
    localStorage.setItem(CLEAN_PRODUCTION_MIGRATION_KEY, 'true');
  } catch {}
}

function buildPracticeExchangeRateItems(): ExchangeRateItem[] {
  const nowIso = new Date().toISOString();
  return DEFAULT_CURRENCIES_LIST.filter((c) => !c.isBase).map((c) => {
    const r = DEFAULT_EXCHANGE_RATES_MAP[c.code] || 100;
    return {
      id: `prac-rate-${c.code.toLowerCase()}-sdg`,
      sourceCurrency: c.code,
      targetCurrency: 'SDG',
      rate: r,
      inverseRate: Math.round((1 / r) * 1000000) / 1000000,
      effectiveFrom: nowIso,
      expiryDate: null,
      isActive: true,
      sourceSymbol: c.symbol,
      targetSymbol: 'ج.س',
      sourceName: c.name,
      targetName: 'Sudanese Pound',
    };
  });
}

function loadCompanyOperationalState(companyId: string) {
  let products: Product[] = [];
  let transactions: Transaction[] = [];
  let customers: Customer[] = [];
  let stockMovements: StockMovement[] = [];
  let unmetDemandRequests: UnmetDemandRequestRecord[] = [];
  let currencies: Currency[] = [];
  let exchangeRates: Record<string, number> = { SDG: 1 };
  let exchangeRateItems: ExchangeRateItem[] = [];
  let exchangeRateHistory: ExchangeRateHistoryEntry[] = [];
  let users: POSUser[] = [];
  let activeSessions: ActiveUserSession[] = [];

  try {
    const rawProds = localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.PRODUCTS, companyId));
    if (rawProds) {
      products = filterOutDemoProducts(JSON.parse(rawProds));
    }
  } catch {}

  try {
    const rawTxs = localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.TRANSACTIONS, companyId));
    if (rawTxs) {
      const parsed: Transaction[] = JSON.parse(rawTxs);
      transactions = Array.isArray(parsed)
        ? parsed.filter((t) => t && !DEMO_SEED_TX_IDS.has(t.id))
        : [];
    }
  } catch {}

  try {
    const rawCusts = localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.CUSTOMERS, companyId));
    if (rawCusts) {
      const parsed: Customer[] = JSON.parse(rawCusts);
      customers = Array.isArray(parsed)
        ? parsed.filter((c) => c && !DEMO_SEED_CUSTOMER_IDS.has(c.id))
        : [];
    }
  } catch {}

  try {
    const rawMovs = localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.MOVEMENTS, companyId));
    if (rawMovs) {
      const parsed: StockMovement[] = JSON.parse(rawMovs);
      stockMovements = Array.isArray(parsed)
        ? parsed.filter((m) => m && !DEMO_SEED_MOVEMENT_IDS.has(m.id))
        : [];
    }
  } catch {}

  try {
    const rawDemand = localStorage.getItem(
      getCompanyStorageKey(STORAGE_KEYS.UNMET_DEMAND_REQUESTS, companyId)
    );
    if (rawDemand) {
      const parsed: UnmetDemandRequestRecord[] = JSON.parse(rawDemand);
      unmetDemandRequests = Array.isArray(parsed)
        ? parsed.filter((d) => d && !DEMO_SEED_DEMAND_IDS.has(d.id))
        : [];
    }
  } catch {}

  try {
    const rawCur = localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.CURRENCIES, companyId));
    if (rawCur) {
      const parsed: Currency[] = JSON.parse(rawCur);
      if (Array.isArray(parsed)) {
        currencies = parsed;
      }
    }
  } catch {}

  try {
    const rawRates = localStorage.getItem(
      getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATES, companyId)
    );
    if (rawRates) {
      const parsed = JSON.parse(rawRates);
      if (parsed && typeof parsed === 'object') {
        exchangeRates = { ...parsed, SDG: 1 };
      }
    }
  } catch {}

  try {
    const rawItems = localStorage.getItem(
      getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATE_ITEMS, companyId)
    );
    if (rawItems) {
      const parsed = JSON.parse(rawItems);
      if (Array.isArray(parsed)) {
        exchangeRateItems = parsed;
      }
    }
  } catch {}

  try {
    const rawHist = localStorage.getItem(
      getCompanyStorageKey(STORAGE_KEYS.RATE_HISTORY, companyId)
    );
    if (rawHist) {
      const parsed = JSON.parse(rawHist);
      if (Array.isArray(parsed)) {
        exchangeRateHistory = parsed;
      }
    }
  } catch {}

  try {
    const rawUsers = localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.USERS, companyId));
    if (rawUsers) {
      users = filterOutDemoUsers(JSON.parse(rawUsers));
    }
  } catch {}

  try {
    const rawSessions = localStorage.getItem(
      getCompanyStorageKey(STORAGE_KEYS.ACTIVE_SESSIONS, companyId)
    );
    if (rawSessions) {
      const parsed: ActiveUserSession[] = JSON.parse(rawSessions);
      const validUserIds = new Set(users.map((u) => u.id));
      activeSessions = Array.isArray(parsed)
        ? parsed.filter((s) => s && validUserIds.has(s.userId) && !DEMO_SEED_USER_IDS.has(s.userId))
        : [];
    }
  } catch {}

  return {
    products,
    transactions,
    customers,
    stockMovements,
    unmetDemandRequests,
    currencies,
    exchangeRates,
    exchangeRateItems,
    exchangeRateHistory,
    users,
    activeSessions,
  };
}

export const POSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  ensureCleanProductionMigration();

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WORKSPACE_MODE);
      return saved === 'PRACTICE' ? 'PRACTICE' : 'PRODUCTION';
    } catch {
      return 'PRODUCTION';
    }
  });

  const [companies, setCompanies] = useState<CompanyProfile[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.COMPANIES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((c: CompanyProfile) => c && !c.isDemoPractice && c.id !== 'comp-default');
        }
      }
    } catch {}
    return [];
  });

  const [currentCompanyId, setCurrentCompanyId] = useState<string>(() => {
    try {
      const savedId = localStorage.getItem(STORAGE_KEYS.CURRENT_COMPANY_ID);
      if (savedId && savedId !== 'comp-default') return savedId;
      const savedCompanies = localStorage.getItem(STORAGE_KEYS.COMPANIES);
      if (savedCompanies) {
        const parsed = JSON.parse(savedCompanies);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id) {
          return parsed[0].id;
        }
      }
    } catch {}
    return 'comp-clean-store';
  });

  const currentCompany = useMemo<CompanyProfile>(() => {
    if (workspaceMode === 'PRACTICE') {
      return PRACTICE_COMPANY_PROFILE;
    }
    const found =
      companies.find((c) => c.id === currentCompanyId && !c.isDemoPractice) ||
      companies.find((c) => !c.isDemoPractice);
    if (found) return found;
    return {
      ...DEFAULT_COMPANY_PROFILE,
      id: currentCompanyId || 'comp-clean-store',
      legalName: '',
      displayName: 'New Store (Offline)',
      displayNameAr: 'متجر جديد (أوفلاين)',
      businessType: '',
      address: '',
      phone: '',
      email: '',
      taxNumber: '',
      secondaryCurrencies: [],
      onboardingCompleted: false,
    };
  }, [workspaceMode, companies, currentCompanyId]);

  const initialCompanyData = useMemo(
    () => loadCompanyOperationalState(currentCompanyId),
    []
  );

  // Load persistent states (Production starts 100% clean; Practice Mode uses demo seeds)
  const [products, setProducts] = useState<Product[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      try {
        const stored = localStorage.getItem(PRACTICE_STORAGE_KEYS.PRODUCTS);
        if (stored) return JSON.parse(stored);
      } catch {}
      return INITIAL_PRODUCTS.map((p, idx) => enrichProductWithSeedMetadata(p, idx));
    }
    return initialCompanyData.products;
  });

  const [users, setUsers] = useState<POSUser[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      try {
        const stored = localStorage.getItem(PRACTICE_STORAGE_KEYS.USERS);
        if (stored) return JSON.parse(stored);
      } catch {}
      return INITIAL_USERS;
    }
    return initialCompanyData.users;
  });

  const [activeSessions, setActiveSessions] = useState<ActiveUserSession[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      return INITIAL_ACTIVE_SESSIONS;
    }
    return initialCompanyData.activeSessions;
  });

  const [currentUserId, setCurrentUserId] = useState<string>(() => {
    if (workspaceMode === 'PRACTICE') return 'user-1';
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
      if (saved && !DEMO_SEED_USER_IDS.has(saved)) return saved;
    } catch {}
    return initialCompanyData.users[0]?.id || 'unassigned-operator';
  });

  const currentUser = useMemo<POSUser>(() => {
    const found = users.find((u) => u.id === currentUserId) || users[0];
    if (found) return found;
    if (workspaceMode === 'PRACTICE') return INITIAL_USERS[0];
    const fullCaps = deriveCapabilitiesFromUser({
      role: 'admin',
      systemRole: 'COMPANY_OWNER',
      permissions: { ...DEFAULT_ROLE_PERMISSIONS.admin },
    });
    return {
      id: 'unassigned-operator',
      companyId: currentCompany.id,
      branchId: `branch-${currentCompany.id}-main`,
      assignedBranchIds: [`branch-${currentCompany.id}-main`],
      name: 'No Account Added',
      nameAr: 'لم يتم إضافة حساب',
      username: '',
      role: 'admin',
      systemRole: 'COMPANY_OWNER',
      capabilities: fullCaps,
      pin: '',
      terminalName: 'POS Terminal',
      terminalNameAr: 'نقطة بيع',
      avatarColor: '#f59e0b',
      isActive: true,
      permissions: { ...DEFAULT_ROLE_PERMISSIONS.admin },
      lastActiveAt: new Date().toISOString(),
    };
  }, [users, currentUserId, workspaceMode, currentCompany.id]);

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      try {
        const stored = localStorage.getItem(PRACTICE_STORAGE_KEYS.TRANSACTIONS);
        if (stored) return JSON.parse(stored);
      } catch {}
      return INITIAL_TRANSACTIONS;
    }
    return initialCompanyData.transactions;
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      try {
        const stored = localStorage.getItem(PRACTICE_STORAGE_KEYS.CUSTOMERS);
        if (stored) return JSON.parse(stored);
      } catch {}
      return INITIAL_CUSTOMERS;
    }
    return initialCompanyData.customers;
  });

  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      try {
        const stored = localStorage.getItem(PRACTICE_STORAGE_KEYS.MOVEMENTS);
        if (stored) return JSON.parse(stored);
      } catch {}
      return INITIAL_STOCK_MOVEMENTS;
    }
    return initialCompanyData.stockMovements;
  });

  const [currencies, setCurrencies] = useState<Currency[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      return [...DEFAULT_CURRENCIES_LIST];
    }
    return initialCompanyData.currencies;
  });

  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(() => {
    if (workspaceMode === 'PRACTICE') {
      return { ...DEFAULT_EXCHANGE_RATES_MAP };
    }
    return initialCompanyData.exchangeRates;
  });

  const [exchangeRateItems, setExchangeRateItems] = useState<ExchangeRateItem[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      return buildPracticeExchangeRateItems();
    }
    return initialCompanyData.exchangeRateItems;
  });

  const [exchangeRateHistory, setExchangeRateHistory] = useState<ExchangeRateHistoryEntry[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      return INITIAL_EXCHANGE_RATE_HISTORY;
    }
    return initialCompanyData.exchangeRateHistory;
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    if (workspaceMode === 'PRACTICE') {
      return {
        ...INITIAL_SETTINGS,
        storeName: PRACTICE_COMPANY_PROFILE.displayName,
        storeNameAr: PRACTICE_COMPANY_PROFILE.displayNameAr,
        exchangeRates: { ...DEFAULT_EXCHANGE_RATES_MAP },
      };
    }
    try {
      const stored =
        localStorage.getItem(getCompanyStorageKey(STORAGE_KEYS.SETTINGS, currentCompanyId)) ||
        localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...INITIAL_SETTINGS,
          ...parsed,
          exchangeRates: initialCompanyData.exchangeRates,
        };
      }
    } catch {}
    return {
      ...INITIAL_SETTINGS,
      storeName: currentCompany.displayName || 'متجر جديد',
      storeNameAr: currentCompany.displayNameAr || 'متجر جديد',
      storeAddress: currentCompany.address || '',
      storePhone: currentCompany.phone || '',
      exchangeRates: initialCompanyData.exchangeRates,
    };
  });

  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeTab, setActiveTab] = useState<AppNavTab>('checkout');
  const [pendingNewProductBarcode, setPendingNewProductBarcode] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [globalDiscountPercent, setGlobalDiscountPercentState] = useState<number>(0);
  const [globalDiscountAmount, setGlobalDiscountAmountState] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const [unmetDemandRequests, setUnmetDemandRequests] = useState<UnmetDemandRequestRecord[]>(() => {
    if (workspaceMode === 'PRACTICE') {
      try {
        const stored = localStorage.getItem(PRACTICE_STORAGE_KEYS.UNMET_DEMAND_REQUESTS);
        if (stored) return JSON.parse(stored);
      } catch {}
      return INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[];
    }
    return initialCompanyData.unmetDemandRequests;
  });
  const [isUnmetDemandModalOpen, setIsUnmetDemandModalOpen] = useState(false);
  const [unmetDemandModalInitialData, setUnmetDemandModalInitialData] =
    useState<Partial<UnmetDemandRequestInput> | null>(null);

  const [allBranches, setAllBranches] = useState<BranchRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BRANCHES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });

  const branches = useMemo<BranchRecord[]>(() => {
    const targetCompanyId =
      workspaceMode === 'PRACTICE' ? 'comp-demo-practice' : currentCompany.id;
    const filtered = allBranches.filter(
      (b) => (b.companyId || 'comp-default') === targetCompanyId
    );
    if (filtered.length > 0) return filtered;
    if (workspaceMode === 'PRACTICE') {
      return [
        {
          id: 'branch-practice-main',
          companyId: 'comp-demo-practice',
          code: 'PRAC-01',
          name: 'Practice Main Showroom',
          nameAr: 'صالة العرض التجريبية الرئيسية',
          city: 'Khartoum',
          isMainBranch: true,
          isActive: true,
        },
        {
          id: 'branch-practice-2',
          companyId: 'comp-demo-practice',
          code: 'PRAC-02',
          name: 'Practice North Branch',
          nameAr: 'فرع التدريب الشمالي',
          city: 'Bahri',
          isMainBranch: false,
          isActive: true,
        },
      ];
    }
    return [
      {
        id: `branch-${currentCompany.id}-main`,
        companyId: currentCompany.id,
        code: 'MAIN-01',
        name: currentCompany.displayName || 'Main Branch',
        nameAr: currentCompany.displayNameAr || 'الفرع الرئيسي',
        city: currentCompany.city || '',
        isMainBranch: true,
        isActive: true,
      },
    ];
  }, [allBranches, workspaceMode, currentCompany]);

  const [activeBranchId, setActiveBranchIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ACTIVE_BRANCH_ID) || 'branch-main';
    } catch {
      return 'branch-main';
    }
  });

  const setActiveBranchId = useCallback((branchId: string) => {
    setActiveBranchIdState(branchId);
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_BRANCH_ID, branchId);
    } catch {}
  }, []);

  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [onboardingModalInitialView, setOnboardingModalInitialView] =
    useState<OnboardingModalView>('hub');

  const openOnboardingModal = useCallback((view: OnboardingModalView = 'hub') => {
    setOnboardingModalInitialView(view);
    setIsOnboardingModalOpen(true);
  }, []);

  const closeOnboardingModal = useCallback(() => {
    setIsOnboardingModalOpen(false);
  }, []);

  // Snapshot of production state before entering Practice Mode so exiting restores production cleanly
  const [productionSnapshot, setProductionSnapshot] = useState<{
    products: Product[];
    transactions: Transaction[];
    customers: Customer[];
    stockMovements: StockMovement[];
    users: POSUser[];
    settings: AppSettings;
    currencies: Currency[];
    exchangeRates: Record<string, number>;
    exchangeRateItems: ExchangeRateItem[];
    exchangeRateHistory: ExchangeRateHistoryEntry[];
    unmetDemandRequests: UnmetDemandRequestRecord[];
    currentUserId: string;
  } | null>(null);

  const openAddProductWithBarcode = useCallback((code: string) => {
    const clean = String(code ?? '').trim();
    if (!clean) return;
    setPendingNewProductBarcode(clean);
    setActiveTab('products');
  }, []);

  const setGlobalDiscountPercent = useCallback((discount: number) => {
    const safePercent = Math.max(0, Math.min(100, Number(discount) || 0));
    setGlobalDiscountPercentState(safePercent);
    setGlobalDiscountAmountState(0);
  }, []);

  const setGlobalDiscountAmount = useCallback((amount: number) => {
    const safeAmount = Math.max(0, Number(amount) || 0);
    setGlobalDiscountAmountState(safeAmount);
    if (safeAmount > 0) {
      setGlobalDiscountPercentState(0);
    }
  }, []);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(new Date());

  // Offline-first startup: only load Practice Mode demo state when in PRACTICE mode.
  // In PRODUCTION mode, never overwrite user company data with default seed products or seed exchange rates.
  useEffect(() => {
    if (workspaceMode === 'PRACTICE') {
      fetch('/api/onboarding/practice/state')
        .then((res) => (res.ok ? res.json() : null))
        .then((payload) => {
          const prac = payload?.data;
          if (!prac) return;
          if (Array.isArray(prac.products) && prac.products.length > 0) setProducts(prac.products);
          if (Array.isArray(prac.transactions)) setTransactions(prac.transactions);
          if (Array.isArray(prac.customers)) setCustomers(prac.customers);
          if (Array.isArray(prac.stockMovements)) setStockMovements(prac.stockMovements);
          if (Array.isArray(prac.users) && prac.users.length > 0) {
            setUsers(prac.users);
            setCurrentUserId(prac.users[0].id);
          }
          if (Array.isArray(prac.unmetDemandRequests)) {
            setUnmetDemandRequests(prac.unmetDemandRequests);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Save to localStorage whenever state changes (strictly isolated per Production Company vs Practice Mode)
  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.PRODUCTS
          : getCompanyStorageKey(STORAGE_KEYS.PRODUCTS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(products));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
      }
    } catch {}
  }, [products, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.USERS
          : getCompanyStorageKey(STORAGE_KEYS.USERS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(users));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
      }
    } catch {}
  }, [users, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(
          getCompanyStorageKey(STORAGE_KEYS.ACTIVE_SESSIONS, currentCompanyId),
          JSON.stringify(activeSessions)
        );
        localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSIONS, JSON.stringify(activeSessions));
      }
    } catch {}
  }, [activeSessions, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, currentUserId);
      }
    } catch {}
  }, [currentUserId, workspaceMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WORKSPACE_MODE, workspaceMode);
    } catch {}
  }, [workspaceMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_COMPANY_ID, currentCompanyId);
    } catch {}
  }, [currentCompanyId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));
    } catch {}
  }, [companies]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.BRANCHES, JSON.stringify(allBranches));
    } catch {}
  }, [allBranches]);

  // Cross-tab / multi-terminal storage sync so multiple active users see real-time updates
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorageSync = (e: StorageEvent) => {
      if (!e.newValue || workspaceMode === 'PRACTICE') return;
      try {
        if (e.key === getCompanyStorageKey(STORAGE_KEYS.PRODUCTS, currentCompanyId)) {
          setProducts(JSON.parse(e.newValue));
        } else if (e.key === getCompanyStorageKey(STORAGE_KEYS.TRANSACTIONS, currentCompanyId)) {
          setTransactions(JSON.parse(e.newValue));
        } else if (e.key === STORAGE_KEYS.USERS) {
          setUsers(JSON.parse(e.newValue));
        } else if (e.key === STORAGE_KEYS.ACTIVE_SESSIONS) {
          setActiveSessions(JSON.parse(e.newValue));
        } else if (
          e.key === getCompanyStorageKey(STORAGE_KEYS.UNMET_DEMAND_REQUESTS, currentCompanyId)
        ) {
          setUnmetDemandRequests(JSON.parse(e.newValue));
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, [workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.UNMET_DEMAND_REQUESTS
          : getCompanyStorageKey(STORAGE_KEYS.UNMET_DEMAND_REQUESTS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(unmetDemandRequests));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(
          STORAGE_KEYS.UNMET_DEMAND_REQUESTS,
          JSON.stringify(unmetDemandRequests)
        );
      }
    } catch {}
  }, [unmetDemandRequests, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.TRANSACTIONS
          : getCompanyStorageKey(STORAGE_KEYS.TRANSACTIONS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(transactions));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
      }
    } catch {}
  }, [transactions, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.CUSTOMERS
          : getCompanyStorageKey(STORAGE_KEYS.CUSTOMERS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(customers));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
      }
    } catch {}
  }, [customers, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.MOVEMENTS
          : getCompanyStorageKey(STORAGE_KEYS.MOVEMENTS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(stockMovements));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.MOVEMENTS, JSON.stringify(stockMovements));
      }
    } catch {}
  }, [stockMovements, workspaceMode, currentCompanyId]);

  useEffect(() => {
    if (workspaceMode === 'PRODUCTION') {
      try {
        localStorage.setItem(
          getCompanyStorageKey(STORAGE_KEYS.CURRENCIES, currentCompanyId),
          JSON.stringify(currencies)
        );
      } catch {}
      savePersistedCurrencies(currencies);
    }
  }, [currencies, workspaceMode, currentCompanyId]);

  useEffect(() => {
    if (workspaceMode === 'PRODUCTION') {
      try {
        localStorage.setItem(
          getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATES, currentCompanyId),
          JSON.stringify(exchangeRates)
        );
      } catch {}
      savePersistedExchangeRates(exchangeRates);
    }
  }, [exchangeRates, workspaceMode, currentCompanyId]);

  useEffect(() => {
    if (workspaceMode === 'PRODUCTION') {
      try {
        localStorage.setItem(
          getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATE_ITEMS, currentCompanyId),
          JSON.stringify(exchangeRateItems)
        );
      } catch {}
      savePersistedExchangeRateItems(exchangeRateItems);
    }
  }, [exchangeRateItems, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(
          getCompanyStorageKey(STORAGE_KEYS.RATE_HISTORY, currentCompanyId),
          JSON.stringify(exchangeRateHistory)
        );
        localStorage.setItem(STORAGE_KEYS.RATE_HISTORY, JSON.stringify(exchangeRateHistory));
      }
    } catch {}
  }, [exchangeRateHistory, workspaceMode, currentCompanyId]);

  useEffect(() => {
    try {
      const key =
        workspaceMode === 'PRACTICE'
          ? PRACTICE_STORAGE_KEYS.SETTINGS
          : getCompanyStorageKey(STORAGE_KEYS.SETTINGS, currentCompanyId);
      localStorage.setItem(key, JSON.stringify(settings));
      if (workspaceMode === 'PRODUCTION') {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      }
    } catch {}

    // Update document HTML direction and language
    if (typeof document !== 'undefined') {
      document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = settings.language;
      if (settings.theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        document.documentElement.classList.add('dark');
      }
    }
  }, [settings, workspaceMode]);

  // Derived cart totals calculation with active currency and exchange rate conversion
  const cartTotals = useMemo(() => {
    return calculateCartTotals(
      cart,
      settings.taxRatePercent,
      globalDiscountPercent,
      settings.isTaxInclusive,
      settings.currency,
      exchangeRates,
      globalDiscountAmount
    );
  }, [
    cart,
    settings.taxRatePercent,
    globalDiscountPercent,
    globalDiscountAmount,
    settings.isTaxInclusive,
    settings.currency,
    exchangeRates,
  ]);

  // Add product to cart (supports selling by individual unit/strip or by pack)
  const addToCart = useCallback(
    (product: Product, quantity = 1, saleUnit?: ProductSaleUnitMode) => {
      const currentProduct = products.find((p) => p.id === product.id) || product;
      const pkg = getProductPackaging(currentProduct);
      const existingItem = cart.find((item) => item.product.id === currentProduct.id);

      const resolvedUnit: ProductSaleUnitMode =
        pkg.enablePackaging && pkg.unitsPerPack > 1
          ? saleUnit || existingItem?.selectedSaleUnit || pkg.defaultSaleUnit
          : 'unit';

      const stockPerItem = resolvedUnit === 'pack' ? pkg.unitsPerPack : 1;

      // If switching unit mode on an existing cart item vs incrementing same mode
      const currentQtyInResolvedUnit =
        existingItem && (existingItem.selectedSaleUnit || 'unit') === resolvedUnit
          ? existingItem.quantity
          : 0;
      const newQty = currentQtyInResolvedUnit + quantity;
      const requiredStock = newQty * stockPerItem;

      if (requiredStock > currentProduct.stock) {
        triggerHaptic('warning', settings.hapticsEnabled);
        return false;
      }

      setCart((prev) => {
        if (existingItem) {
          return prev.map((item) =>
            item.product.id === currentProduct.id
              ? {
                  ...item,
                  product: currentProduct,
                  quantity: newQty,
                  selectedSaleUnit: resolvedUnit,
                }
              : item
          );
        }
        return [
          ...prev,
          {
            product: currentProduct,
            quantity,
            itemDiscountPercent: 0,
            selectedSaleUnit: resolvedUnit,
          },
        ];
      });

      triggerHaptic('light', settings.hapticsEnabled);
      return true;
    },
    [cart, products, settings.hapticsEnabled]
  );

  // Update quantity in cart
  const updateCartQuantity = useCallback(
    (productId: string, delta: number) => {
      setCart((prev) => {
        return prev
          .map((item) => {
            if (item.product.id === productId) {
              const freshProduct = products.find((p) => p.id === productId) || item.product;
              const pkg = getProductPackaging(freshProduct);
              const isPack =
                pkg.enablePackaging &&
                pkg.unitsPerPack > 1 &&
                (item.selectedSaleUnit || pkg.defaultSaleUnit) === 'pack';
              const stockPerItem = isPack ? pkg.unitsPerPack : 1;
              const newQty = item.quantity + delta;
              if (newQty <= 0) return null;
              if (newQty * stockPerItem > freshProduct.stock) {
                triggerHaptic('warning', settings.hapticsEnabled);
                return item;
              }
              return { ...item, product: freshProduct, quantity: newQty };
            }
            return item;
          })
          .filter((item): item is CartItem => item !== null);
      });
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [products, settings.hapticsEnabled]
  );

  // Switch sale unit ('unit' vs 'pack') for a product already in the cart
  const setCartItemSaleUnit = useCallback(
    (productId: string, saleUnit: ProductSaleUnitMode) => {
      setCart((prev) =>
        prev.map((item) => {
          if (item.product.id !== productId) return item;
          const freshProduct = products.find((p) => p.id === productId) || item.product;
          const pkg = getProductPackaging(freshProduct);
          if (!pkg.enablePackaging || pkg.unitsPerPack <= 1) {
            return { ...item, product: freshProduct, selectedSaleUnit: 'unit' };
          }
          const stockPerItem = saleUnit === 'pack' ? pkg.unitsPerPack : 1;
          const maxAffordableQty = Math.max(1, Math.floor(freshProduct.stock / stockPerItem));
          const clampedQty = Math.min(item.quantity, maxAffordableQty);
          return {
            ...item,
            product: freshProduct,
            selectedSaleUnit: saleUnit,
            quantity: clampedQty,
          };
        })
      );
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [products, settings.hapticsEnabled]
  );

  const setCartItemDiscount = useCallback((productId: string, discountPercent: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, itemDiscountPercent: Math.max(0, Math.min(100, discountPercent)) }
          : item
      )
    );
  }, []);

  const removeFromCart = useCallback(
    (productId: string) => {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
      triggerHaptic('medium', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  const clearCart = useCallback(() => {
    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscountPercentState(0);
    setGlobalDiscountAmountState(0);
    triggerHaptic('medium', settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

  // Execute Checkout
  const processCheckout = useCallback(
    async (
      paymentMethod: PaymentMethod,
      amountTendered: number,
      details?: CheckoutPaymentDetails
    ): Promise<{ success: boolean; transaction?: Transaction; error?: string }> => {
      // 1. Validate
      const validation = validateCheckout(
        cart,
        paymentMethod,
        amountTendered,
        cartTotals.grandTotal,
        details
      );
      if (!validation.valid) {
        triggerHaptic('warning', settings.hapticsEnabled);
        return { success: false, error: validation.error };
      }

      // 2. Prevent duplicate submissions using idempotency key
      const idempotencyKey = generateIdempotencyKey();
      const transactionId = generateTransactionId();

      const requestedStatus = details?.paymentStatus || 'paid';
      const breakdown = calculateDebtBreakdown(
        cartTotals.grandTotal,
        requestedStatus,
        details?.amountPaid !== undefined ? details.amountPaid : amountTendered
      );

      const changeDue =
        paymentMethod === 'cash' && breakdown.paymentStatus === 'paid'
          ? Math.max(0, amountTendered - cartTotals.grandTotal)
          : 0;

      const activeCurrency = (settings.currency || 'SDG').toUpperCase().trim();
      const baseSnapshot: Record<string, number> = {
        ...DEFAULT_EXCHANGE_RATES_MAP,
        ...exchangeRates,
        ...(details?.exchangeRatesSnapshot || {}),
        SDG: 1,
      };
      const rateUsedAtSale =
        details?.exchangeRateUsed && details.exchangeRateUsed > 0
          ? Number(details.exchangeRateUsed)
          : activeCurrency === 'SDG'
          ? Number(baseSnapshot['USD'] || 2700)
          : Number(baseSnapshot[activeCurrency] || 1);

      const activeRateSnapshot: Record<string, number> = {
        ...baseSnapshot,
        [activeCurrency === 'SDG' ? 'USD' : activeCurrency]: rateUsedAtSale,
        SDG: 1,
      };

      const newTransaction: Transaction = {
        id: transactionId,
        idempotencyKey,
        timestamp: new Date().toISOString(),
        currency: activeCurrency,
        exchangeRateUsed: rateUsedAtSale,
        exchangeRatesSnapshot: activeRateSnapshot,
        items: cart.map((item) => {
          const unitPricing = getCartItemUnitPricing(
            item,
            settings.currency,
            exchangeRates,
            settings.language
          );
          return {
            productId: item.product.id,
            productName: item.product.name,
            sku: item.product.sku,
            quantity: item.quantity,
            unitPrice: unitPricing.unitPrice,
            discountPercent: item.itemDiscountPercent,
            total:
              unitPricing.unitPrice *
              item.quantity *
              (1 - item.itemDiscountPercent / 100),
            saleUnit: unitPricing.saleUnit,
            saleUnitLabel: unitPricing.unitLabel,
            unitsPerPack: unitPricing.packaging.unitsPerPack,
            stockDeducted: unitPricing.totalStockUnitsRequired,
          };
        }),
        subtotal: cartTotals.subtotal,
        taxRatePercent: settings.taxRatePercent,
        taxAmount: cartTotals.taxAmount,
        discountAmount: cartTotals.discountAmount,
        grandTotal: cartTotals.grandTotal,
        paymentMethod,
        amountTendered:
          breakdown.paymentStatus === 'paid' && paymentMethod === 'cash'
            ? amountTendered
            : breakdown.amountPaid,
        changeDue: Math.round(changeDue * 100) / 100,
        paymentStatus: breakdown.paymentStatus,
        amountPaid: breakdown.amountPaid,
        debtAmount: breakdown.debtAmount,
        transferReference: details?.transferReference?.trim() || undefined,
        transferReceiptImage:
          details?.transferReceiptImage ||
          (details?.transferReceiptImages && details.transferReceiptImages[0]) ||
          undefined,
        transferReceiptImages:
          details?.transferReceiptImages && details.transferReceiptImages.length > 0
            ? details.transferReceiptImages
            : details?.transferReceiptImage
            ? [details.transferReceiptImage]
            : undefined,
        fulfillmentType: details?.fulfillmentType || 'goods_and_invoice',
        fulfillmentStatus:
          details?.fulfillmentStatus ||
          (details?.fulfillmentType === 'invoice_only'
            ? 'pending_goods'
            : details?.fulfillmentType === 'goods_only'
            ? 'pending_invoice'
            : 'received'),
        fulfilledAt:
          !details?.fulfillmentType || details?.fulfillmentType === 'goods_and_invoice'
            ? new Date().toISOString()
            : undefined,
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer ? selectedCustomer.name : 'Walk-in Customer',
        cashierName: `${
          settings.language === 'ar'
            ? currentUser.nameAr || currentUser.name
            : currentUser.name
        } (${
          settings.language === 'ar'
            ? currentUser.terminalNameAr || currentUser.terminalName
            : currentUser.terminalName
        })`,
        status: 'completed',
        syncStatus: 'synced',
      };

      // 3. Deduct stock (accounting for pack vs strip/unit) and record movements
      const newMovements: StockMovement[] = [];
      setProducts((prev) =>
        prev.map((prod) => {
          const cartItem = cart.find((item) => item.product.id === prod.id);
          if (cartItem) {
            const { totalStockUnitsRequired, unitLabel } = getCartItemUnitPricing(
              cartItem,
              settings.currency,
              exchangeRates,
              settings.language
            );
            const updatedStock = Math.max(0, prod.stock - totalStockUnitsRequired);
            newMovements.push({
              id: `mov_${Date.now()}_${prod.id}`,
              timestamp: new Date().toISOString(),
              productId: prod.id,
              productName: prod.name,
              type: 'sale',
              quantityChange: -totalStockUnitsRequired,
              previousStock: prod.stock,
              newStock: updatedStock,
              reason: `POS Checkout (${transactionId}) — ${cartItem.quantity} × ${unitLabel}`,
              referenceId: transactionId,
            });
            return {
              ...prod,
              stock: updatedStock,
              updatedAt: new Date().toISOString(),
            };
          }
          return prod;
        })
      );

      // 4. Update stock movements log
      setStockMovements((prev) => [...newMovements, ...prev]);

      // 5. Update Customer metrics if customer was attached
      if (selectedCustomer) {
        setCustomers((prev) =>
          prev.map((cust) => {
            if (cust.id === selectedCustomer.id) {
              const addedPoints = Math.floor(cartTotals.grandTotal);
              const prevDebt = cust.totalDebt || 0;
              return {
                ...cust,
                totalSpent: Math.round((cust.totalSpent + cartTotals.grandTotal) * 100) / 100,
                totalDebt: Math.round((prevDebt + breakdown.debtAmount) * 100) / 100,
                transactionCount: cust.transactionCount + 1,
                loyaltyPoints: cust.loyaltyPoints + addedPoints,
              };
            }
            return cust;
          })
        );
      }

      // 6. Record transaction
      setTransactions((prev) => [newTransaction, ...prev]);

      // 7. Clear cart & sound chime
      setCart([]);
      setSelectedCustomer(null);
      setGlobalDiscountPercentState(0);
      setGlobalDiscountAmountState(0);

      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);

      return { success: true, transaction: newTransaction };
    },
    [cart, cartTotals, selectedCustomer, settings, exchangeRates]
  );

  // Settle or customize debt/installments on a transaction (supporting partial payments, payment method, and multiple receipt images)
  const settleTransactionDebt = useCallback(
    (
      transactionId: string,
      useIndexedNewRate: boolean = false,
      anchorCurrency: string = 'USD',
      settlementDetails?: DebtSettlementInput
    ): boolean => {
      const txn = transactions.find((t) => t.id === transactionId);
      if (!txn || txn.status === 'voided') {
        return false;
      }
      if (!settlementDetails && (!txn.debtAmount || txn.debtAmount <= 0)) {
        return false;
      }

      const { updatedTransaction, settledDeltaInTxCurrency } = applyDebtSettlementPayment(
        txn,
        {
          ...settlementDetails,
          useIndexedNewRate:
            settlementDetails?.useIndexedNewRate !== undefined
              ? settlementDetails.useIndexedNewRate
              : useIndexedNewRate,
          anchorCurrency: settlementDetails?.anchorCurrency || anchorCurrency,
        },
        exchangeRates
      );

      setTransactions((prev) =>
        prev.map((t) => (t.id === transactionId ? updatedTransaction : t))
      );

      if (txn.customerId && Math.abs(settledDeltaInTxCurrency) > 0.0001) {
        setCustomers((prev) =>
          prev.map((cust) => {
            if (cust.id === txn.customerId) {
              const prevDebt = cust.totalDebt || 0;
              return {
                ...cust,
                totalDebt: Math.max(
                  0,
                  Math.round((prevDebt - settledDeltaInTxCurrency) * 100) / 100
                ),
              };
            }
            return cust;
          })
        );
      }

      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return true;
    },
    [transactions, exchangeRates, settings.soundEnabled, settings.hapticsEnabled]
  );

  // Update fulfillment status of a transaction (e.g. Confirm receipt of goods or invoice)
  const updateTransactionFulfillment = useCallback(
    (
      transactionId: string,
      fulfillmentStatus: InvoiceFulfillmentStatus,
      fulfillmentType?: InvoiceFulfillmentType
    ): boolean => {
      const txn = transactions.find((t) => t.id === transactionId);
      if (!txn || txn.status === 'voided') return false;

      setTransactions((prev) =>
        prev.map((t) => {
          if (t.id !== transactionId) return t;
          return {
            ...t,
            fulfillmentStatus,
            fulfillmentType:
              fulfillmentType ||
              (fulfillmentStatus === 'received'
                ? 'goods_and_invoice'
                : fulfillmentStatus === 'pending_goods'
                ? 'invoice_only'
                : 'goods_only'),
            fulfilledAt:
              fulfillmentStatus === 'received' ? new Date().toISOString() : t.fulfilledAt,
          };
        })
      );

      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return true;
    },
    [transactions, settings.soundEnabled, settings.hapticsEnabled]
  );

  // Permanently re-price a single transaction (and its remaining customer debt) to the current exchange rate
  const applyNewRateToTransaction = useCallback(
    (transactionId: string, anchorCurrency: string = 'USD'): boolean => {
      const txn = transactions.find((t) => t.id === transactionId);
      if (!txn || txn.status === 'voided') return false;

      const repriced = repriceTransactionToNewRate(txn, exchangeRates, anchorCurrency);
      const oldDebt = txn.debtAmount || 0;
      const newDebt = repriced.debtAmount || 0;
      const debtDelta = Math.round((newDebt - oldDebt) * 100) / 100;

      setTransactions((prev) => prev.map((t) => (t.id === transactionId ? repriced : t)));

      if (txn.customerId && Math.abs(debtDelta) > 0.0001) {
        setCustomers((prev) =>
          prev.map((cust) => {
            if (cust.id === txn.customerId) {
              const prevDebt = cust.totalDebt || 0;
              return {
                ...cust,
                totalDebt: Math.max(0, Math.round((prevDebt + debtDelta) * 100) / 100),
              };
            }
            return cust;
          })
        );
      }

      playSuccessChime(settings.soundEnabled);
      triggerHaptic('light', settings.hapticsEnabled);
      return true;
    },
    [transactions, exchangeRates, settings.soundEnabled, settings.hapticsEnabled]
  );

  // Lock and save a specific sale-time exchange rate onto a transaction
  const lockTransactionSaleRate = useCallback(
    (transactionId: string, saleRateToSdg: number, referenceCurrency: string = 'USD'): boolean => {
      const txn = transactions.find((t) => t.id === transactionId);
      if (!txn || txn.status === 'voided' || !Number.isFinite(saleRateToSdg) || saleRateToSdg <= 0) {
        return false;
      }

      const updated = lockTransactionSaleExchangeRate(txn, saleRateToSdg, referenceCurrency);
      setTransactions((prev) => prev.map((t) => (t.id === transactionId ? updated : t)));

      playSuccessChime(settings.soundEnabled);
      triggerHaptic('light', settings.hapticsEnabled);
      return true;
    },
    [transactions, settings.soundEnabled, settings.hapticsEnabled]
  );

  // Permanently re-price all transactions (or only unpaid/partial debt transactions) to the current exchange rate
  const applyNewRateToAllTransactions = useCallback(
    (onlyDebt: boolean = false, anchorCurrency: string = 'USD'): number => {
      let updatedCount = 0;
      const customerDebtDeltas: Record<string, number> = {};

      setTransactions((prev) =>
        prev.map((t) => {
          if (t.status === 'voided') return t;
          if (onlyDebt && (!t.debtAmount || t.debtAmount <= 0)) return t;

          const repriced = repriceTransactionToNewRate(t, exchangeRates, anchorCurrency);
          const changed =
            Math.abs(repriced.grandTotal - t.grandTotal) > 0.0001 ||
            Math.abs((repriced.debtAmount || 0) - (t.debtAmount || 0)) > 0.0001 ||
            repriced.exchangeRateUsed !== t.exchangeRateUsed;

          if (changed) {
            updatedCount += 1;
            if (t.customerId) {
              const delta = (repriced.debtAmount || 0) - (t.debtAmount || 0);
              customerDebtDeltas[t.customerId] = (customerDebtDeltas[t.customerId] || 0) + delta;
            }
          }
          return repriced;
        })
      );

      if (Object.keys(customerDebtDeltas).length > 0) {
        setCustomers((prev) =>
          prev.map((cust) => {
            const delta = customerDebtDeltas[cust.id];
            if (!delta) return cust;
            const prevDebt = cust.totalDebt || 0;
            return {
              ...cust,
              totalDebt: Math.max(0, Math.round((prevDebt + delta) * 100) / 100),
            };
          })
        );
      }

      if (updatedCount > 0) {
        playSuccessChime(settings.soundEnabled);
        triggerHaptic('success', settings.hapticsEnabled);
      }
      return updatedCount;
    },
    [exchangeRates, settings.soundEnabled, settings.hapticsEnabled]
  );

  // Void / Refund Transaction
  const voidTransaction = useCallback(
    (transactionId: string): boolean => {
      const txn = transactions.find((t) => t.id === transactionId);
      if (!txn || txn.status === 'voided') return false;

      // 1. Restore product stock levels
      const returnMovements: StockMovement[] = [];
      setProducts((prev) =>
        prev.map((prod) => {
          const item = txn.items.find((i) => i.productId === prod.id);
          if (item) {
            const restoredStock = prod.stock + item.quantity;
            returnMovements.push({
              id: `mov_void_${Date.now()}_${prod.id}`,
              timestamp: new Date().toISOString(),
              productId: prod.id,
              productName: prod.name,
              type: 'restock',
              quantityChange: item.quantity,
              previousStock: prod.stock,
              newStock: restoredStock,
              reason: `Transaction Void/Refund (${txn.id})`,
              referenceId: txn.id,
            });
            return {
              ...prod,
              stock: restoredStock,
              updatedAt: new Date().toISOString(),
            };
          }
          return prod;
        })
      );

      // 2. Add movements to log
      setStockMovements((prev) => [...returnMovements, ...prev]);

      // 3. Mark transaction as voided
      setTransactions((prev) =>
        prev.map((t) => (t.id === transactionId ? { ...t, status: 'voided' as const } : t))
      );

      // 4. Revert customer stats if applicable
      if (txn.customerId) {
        setCustomers((prev) =>
          prev.map((cust) => {
            if (cust.id === txn.customerId) {
              const prevDebt = cust.totalDebt || 0;
              const txnDebt = txn.debtAmount || 0;
              return {
                ...cust,
                totalSpent: Math.max(0, Math.round((cust.totalSpent - txn.grandTotal) * 100) / 100),
                totalDebt: Math.max(0, Math.round((prevDebt - txnDebt) * 100) / 100),
                loyaltyPoints: Math.max(0, cust.loyaltyPoints - Math.floor(txn.grandTotal)),
              };
            }
            return cust;
          })
        );
      }

      triggerHaptic('medium', settings.hapticsEnabled);
      return true;
    },
    [transactions, settings.hapticsEnabled]
  );

  // Add Product
  const addProduct = useCallback(
    async (productData: Omit<Product, 'id' | 'updatedAt'>): Promise<Product> => {
      const nowIso = new Date().toISOString();
      const actorName =
        settings.language === 'ar'
          ? currentUser.nameAr || currentUser.name
          : currentUser.name;
      const nextSerial =
        productData.serialNumber && Number(productData.serialNumber) > 0
          ? Math.floor(Number(productData.serialNumber))
          : getNextProductSerialNumber(products);
      const audit = buildProductAuditTrail({
        existingProduct: null,
        nextProduct: productData,
        changedBy: actorName,
        nowIso,
      });

      const enrichedPayload: Omit<Product, 'id' | 'updatedAt'> = {
        ...productData,
        serialNumber: nextSerial,
        createdAt: productData.createdAt || audit.createdAt,
        priceUpdatedAt: audit.priceUpdatedAt,
        priceHistory:
          productData.priceHistory && productData.priceHistory.length > 0
            ? productData.priceHistory
            : audit.priceHistory,
        modificationHistory:
          productData.modificationHistory && productData.modificationHistory.length > 0
            ? productData.modificationHistory
            : audit.modificationHistory,
        customFields: {
          ...(productData.customFields || {}),
          serialNumber: nextSerial,
          description: productData.description || productData.customFields?.description,
          descriptionAr: productData.descriptionAr || productData.customFields?.descriptionAr,
          createdAt: productData.createdAt || audit.createdAt,
          priceUpdatedAt: audit.priceUpdatedAt,
          priceHistory:
            productData.priceHistory && productData.priceHistory.length > 0
              ? productData.priceHistory
              : audit.priceHistory,
          modificationHistory:
            productData.modificationHistory && productData.modificationHistory.length > 0
              ? productData.modificationHistory
              : audit.modificationHistory,
          changedBy: actorName,
        },
      };

      let created: Product;
      try {
        const apiRes = await api.createProduct(enrichedPayload);
        created = {
          ...apiRes,
          ...enrichedPayload,
          id: apiRes.id,
          updatedAt: apiRes.updatedAt || nowIso,
        };
      } catch (err: any) {
        if (err?.message?.includes('Duplicate')) {
          throw err;
        }
        console.warn('Backend API createProduct failed, saving locally:', err);
        created = {
          ...enrichedPayload,
          id: `prod-${Date.now()}`,
          updatedAt: nowIso,
        };
      }

      setProducts((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);

      // Record initial inventory movement
      if (created.stock > 0) {
        setStockMovements((prev) => [
          {
            id: `mov_init_${created.id}`,
            timestamp: nowIso,
            productId: created.id,
            productName: created.name,
            type: 'restock',
            quantityChange: created.stock,
            previousStock: 0,
            newStock: created.stock,
            reason: `Initial Product Stock In (${actorName})`,
          },
          ...prev,
        ]);
      }

      triggerHaptic('success', settings.hapticsEnabled);
      return created;
    },
    [products, currentUser, settings.language, settings.hapticsEnabled]
  );

  // Update Product
  const updateProduct = useCallback(
    async (id: string, updates: Partial<Product>) => {
      const existing = products.find((p) => p.id === id) || null;
      const nowIso = new Date().toISOString();
      const actorName =
        settings.language === 'ar'
          ? currentUser.nameAr || currentUser.name
          : currentUser.name;

      const audit = buildProductAuditTrail({
        existingProduct: existing,
        nextProduct: updates,
        changedBy: actorName,
        nowIso,
      });

      const nextSerial =
        updates.serialNumber !== undefined
          ? Number(updates.serialNumber)
          : existing
          ? getProductSerialNumber(existing)
          : undefined;

      const enrichedUpdates: Partial<Product> = {
        ...updates,
        serialNumber: nextSerial,
        createdAt: existing?.createdAt || audit.createdAt,
        previousCostPrice: audit.previousCostPrice,
        previousSellingPrice: audit.previousSellingPrice,
        priceUpdatedAt: audit.priceUpdatedAt,
        priceHistory: audit.priceHistory,
        modificationHistory: audit.modificationHistory,
        customFields: {
          ...(existing?.customFields || {}),
          ...(updates.customFields || {}),
          serialNumber: nextSerial,
          description:
            updates.description !== undefined
              ? updates.description
              : existing?.description || existing?.customFields?.description,
          descriptionAr:
            updates.descriptionAr !== undefined
              ? updates.descriptionAr
              : existing?.descriptionAr || existing?.customFields?.descriptionAr,
          createdAt: existing?.createdAt || audit.createdAt,
          previousCostPrice: audit.previousCostPrice,
          previousSellingPrice: audit.previousSellingPrice,
          priceUpdatedAt: audit.priceUpdatedAt,
          priceHistory: audit.priceHistory,
          modificationHistory: audit.modificationHistory,
          changedBy: actorName,
        },
      };

      try {
        const apiUpdated = await api.updateProduct(id, enrichedUpdates);
        const mergedUpdated: Product = {
          ...(existing || ({} as Product)),
          ...apiUpdated,
          ...enrichedUpdates,
          updatedAt: nowIso,
        };
        setProducts((prev) => prev.map((p) => (p.id === id ? mergedUpdated : p)));
        setCart((prev) =>
          prev.map((item) => (item.product.id === id ? { ...item, product: mergedUpdated } : item))
        );
        triggerHaptic('light', settings.hapticsEnabled);
        return mergedUpdated;
      } catch (err: any) {
        if (err?.message?.includes('Duplicate')) {
          throw err;
        }
        console.warn('Backend API updateProduct failed, applying local update:', err);
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, ...enrichedUpdates, updatedAt: nowIso } : p
          )
        );
        setCart((prev) =>
          prev.map((item) =>
            item.product.id === id
              ? { ...item, product: { ...item.product, ...enrichedUpdates, updatedAt: nowIso } }
              : item
          )
        );
        triggerHaptic('light', settings.hapticsEnabled);
      }
    },
    [products, currentUser, settings.language, settings.hapticsEnabled]
  );

  // Delete Product
  const deleteProduct = useCallback(
    async (id: string) => {
      try {
        await api.deleteProduct(id);
      } catch (err) {
        console.warn('Backend API deleteProduct failed, removing locally:', err);
      }
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setCart((prev) => prev.filter((item) => item.product.id !== id));
      triggerHaptic('medium', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  // Record Stock Adjustment
  const recordStockAdjustment = useCallback(
    (productId: string, type: StockMovementType, amount: number, reason: string) => {
      const prod = products.find((p) => p.id === productId);
      if (!prod) return;

      const newStock = calculateStockAdjustment(prod.stock, type, amount);
      const delta = type === 'audit' ? newStock - prod.stock : newStock - prod.stock;

      const movement: StockMovement = {
        id: `mov_${Date.now()}`,
        timestamp: new Date().toISOString(),
        productId: prod.id,
        productName: prod.name,
        type,
        quantityChange: delta,
        previousStock: prod.stock,
        newStock,
        reason: reason || 'Manual Stock Adjustment',
      };

      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, stock: newStock, updatedAt: new Date().toISOString() } : p))
      );
      setStockMovements((prev) => [movement, ...prev]);
      triggerHaptic('medium', settings.hapticsEnabled);
    },
    [products, settings.hapticsEnabled]
  );

  // Record Goods Receipt / Supplier Purchase Invoice (استلام فاتورة أو استلام بضاعة)
  const recordGoodsReceipt = useCallback(
    (input: GoodsReceiptInput): boolean => {
      const prod = products.find((p) => p.id === input.productId);
      if (!prod || input.quantity <= 0) return false;

      const qty = Math.round(input.quantity);
      const newStock =
        input.receiptMode === 'invoice_only' ? prod.stock : prod.stock + qty;

      const receiptCurrency = (input.currency || settings.currency || 'SDG')
        .toString()
        .toUpperCase()
        .trim();
      const prodCurrency = (
        prod.priceCurrency ||
        prod.customFields?.priceCurrency ||
        'SDG'
      )
        .toString()
        .toUpperCase()
        .trim();

      let nextCostPrice = prod.costPrice;
      if (input.updateProductCost && input.unitCost && input.unitCost > 0) {
        nextCostPrice = convertCurrencyAmount(
          input.unitCost,
          receiptCurrency,
          prodCurrency,
          exchangeRates
        );
      }

      const modeLabel =
        input.receiptMode === 'goods_and_invoice'
          ? 'Goods & Invoice Receipt'
          : input.receiptMode === 'goods_only'
          ? 'Goods Receipt Only'
          : 'Purchase Invoice Recorded (Goods Pending)';

      const reasonParts = [modeLabel];
      if (input.invoiceNumber?.trim()) reasonParts.push(`#${input.invoiceNumber.trim()}`);
      if (input.supplierName?.trim()) reasonParts.push(`Supplier: ${input.supplierName.trim()}`);
      if (input.notes?.trim()) reasonParts.push(input.notes.trim());

      const movement: StockMovement = {
        id: `mov_rcpt_${Date.now()}`,
        timestamp: new Date().toISOString(),
        productId: prod.id,
        productName: prod.name,
        type: 'restock',
        quantityChange: input.receiptMode === 'invoice_only' ? 0 : qty,
        previousStock: prod.stock,
        newStock,
        reason: reasonParts.join(' • '),
        referenceId: input.invoiceNumber?.trim() || undefined,
        receiptMode: input.receiptMode,
        supplierName: input.supplierName?.trim() || undefined,
        invoiceNumber: input.invoiceNumber?.trim() || undefined,
        unitCost: input.unitCost,
        currency: receiptCurrency,
      };

      setProducts((prev) =>
        prev.map((p) =>
          p.id === prod.id
            ? {
                ...p,
                stock: newStock,
                costPrice: nextCostPrice,
                updatedAt: new Date().toISOString(),
              }
            : p
        )
      );
      setStockMovements((prev) => [movement, ...prev]);
      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return true;
    },
    [products, settings.currency, settings.soundEnabled, settings.hapticsEnabled, exchangeRates]
  );

  // Add Customer
  const addCustomer = useCallback(
    (
      customerData: Omit<
        Customer,
        'id' | 'createdAt' | 'totalSpent' | 'transactionCount' | 'loyaltyPoints'
      >
    ): Customer => {
      const newCust: Customer = {
        ...customerData,
        id: `cust-${Date.now()}`,
        totalSpent: 0,
        transactionCount: 0,
        loyaltyPoints: 0,
        createdAt: new Date().toISOString(),
      };
      setCustomers((prev) => [newCust, ...prev]);
      triggerHaptic('success', settings.hapticsEnabled);
      return newCust;
    },
    [settings.hapticsEnabled]
  );

  const updateCustomer = useCallback(
    (id: string, updates: Partial<Customer>) => {
      setCustomers((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  const deleteCustomer = useCallback(
    (id: string) => {
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      setSelectedCustomer((prev) => (prev?.id === id ? null : prev));
      triggerHaptic('medium', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  const updateSettings = useCallback(
    (updates: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        if (updates.exchangeRates) {
          const mergedRates = { ...prev.exchangeRates, ...updates.exchangeRates, SDG: 1 };
          next.exchangeRates = mergedRates;
          setExchangeRates(mergedRates);
          savePersistedExchangeRates(mergedRates);
        }
        return next;
      });
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  // Sync currencies list into POSContext and LocalStorage
  const syncCurrenciesState = useCallback((list: Currency[]) => {
    if (!list) return;
    setCurrencies(list);
    savePersistedCurrencies(list);
  }, []);

  // Create or update a currency and its initial exchange rate in PostgreSQL + POSContext + LocalStorage
  const saveCurrency = useCallback(
    async (data: {
      code: string;
      name: string;
      nameAr?: string;
      symbol: string;
      decimalPlaces?: number;
      initialRateToBase?: number;
      isBase?: boolean;
    }): Promise<Currency> => {
      const code = data.code.toUpperCase().trim();
      const name = data.name.trim() || code;
      const nameAr = data.nameAr?.trim() || name;
      const symbol = data.symbol.trim() || code;
      const decimalPlaces = data.decimalPlaces ?? 2;
      const initialRate =
        data.initialRateToBase && data.initialRateToBase > 0
          ? Number(data.initialRateToBase)
          : undefined;
      const shouldBeBase = Boolean(data.isBase) || currencies.length === 0;

      let savedCurrency: Currency = {
        code,
        name,
        nameAr,
        symbol,
        decimalPlaces,
        isBase: shouldBeBase,
        isActive: true,
      };

      if (
        workspaceMode === 'PRACTICE' ||
        (currentCompany.id !== 'comp-clean-store' && currentUser.id !== 'unassigned-operator')
      ) {
        try {
          const remoteSaved = await api.saveCurrency({
            code,
            name,
            nameAr,
            symbol,
            decimalPlaces,
            initialRateToBase: !shouldBeBase ? initialRate : undefined,
          });
          savedCurrency = { ...remoteSaved, isBase: shouldBeBase, isActive: true };
        } catch {
          // Offline mode: local currency record is used directly
        }
      }

      // Immediately update currencies list in POSContext & LocalStorage
      setCurrencies((prev) => {
        const exists = prev.some((c) => c.code.toUpperCase() === code);
        let nextList = exists
          ? prev.map((c) =>
              c.code.toUpperCase() === code
                ? { ...c, ...savedCurrency, isBase: shouldBeBase, isActive: true }
                : shouldBeBase
                ? { ...c, isBase: false }
                : c
            )
          : [
              ...(shouldBeBase ? prev.map((c) => ({ ...c, isBase: false })) : prev),
              savedCurrency,
            ];
        if (!nextList.some((c) => c.isBase) && nextList.length > 0) {
          nextList = nextList.map((c, idx) => (idx === 0 ? { ...c, isBase: true } : c));
        }
        savePersistedCurrencies(nextList);
        return nextList;
      });

      if (shouldBeBase) {
        setExchangeRates((prev) => {
          const nextMap = { ...prev, [code]: 1, SDG: prev.SDG || 1 };
          savePersistedExchangeRates(nextMap);
          return nextMap;
        });
        setSettings((prevSettings) => ({
          ...prevSettings,
          currency: code,
          exchangeRates: { ...(prevSettings.exchangeRates || {}), [code]: 1, SDG: 1 },
        }));
      } else if (initialRate && initialRate > 0) {
        const currentBase = currencies.find((c) => c.isBase) || currencies[0];
        const targetCode = currentBase?.code || 'SDG';
        const targetSymbol = currentBase?.symbol || 'ج.س';
        const targetName = currentBase?.name || 'Base Currency';
        const nowIso = new Date().toISOString();
        setExchangeRates((prev) => {
          const nextMap = { ...prev, [code]: initialRate, SDG: prev.SDG || 1 };
          savePersistedExchangeRates(nextMap);
          return nextMap;
        });
        setSettings((prevSettings) => ({
          ...prevSettings,
          exchangeRates: { ...(prevSettings.exchangeRates || {}), [code]: initialRate, SDG: 1 },
        }));

        setExchangeRateItems((prevItems) => {
          const newItem: ExchangeRateItem = {
            id: `rate-${code.toLowerCase()}-${targetCode.toLowerCase()}-${Date.now()}`,
            sourceCurrency: code,
            targetCurrency: targetCode,
            rate: initialRate,
            inverseRate: Math.round((1 / initialRate) * 1000000) / 1000000,
            effectiveFrom: nowIso,
            expiryDate: null,
            isActive: true,
            sourceSymbol: symbol,
            targetSymbol,
            sourceName: name,
            targetName,
          };
          const exists = prevItems.some(
            (i) => i.sourceCurrency.toUpperCase() === code && i.targetCurrency.toUpperCase() === targetCode
          );
          const nextItems = exists
            ? prevItems.map((i) =>
                i.sourceCurrency.toUpperCase() === code && i.targetCurrency.toUpperCase() === targetCode
                  ? { ...i, ...newItem }
                  : i
              )
            : [...prevItems, newItem];
          savePersistedExchangeRateItems(nextItems);
          return nextItems;
        });
      }

      return savedCurrency;
    },
    [currencies, workspaceMode, currentCompany.id, currentUser.id]
  );

  // Remove/deactivate any currency in POSContext + LocalStorage
  const removeCurrency = useCallback(
    async (code: string): Promise<void> => {
      const cleanCode = code.toUpperCase().trim();
      if (!cleanCode) return;

      if (
        workspaceMode === 'PRACTICE' ||
        (currentCompany.id !== 'comp-clean-store' && currentUser.id !== 'unassigned-operator')
      ) {
        try {
          if (cleanCode !== 'SDG') {
            await api.deleteCurrency(cleanCode);
          }
        } catch {
          // Offline mode: local removal proceeds cleanly
        }
      }

      setCurrencies((prev) => {
        let nextList = prev.filter((c) => c.code.toUpperCase() !== cleanCode);
        if (nextList.length > 0 && !nextList.some((c) => c.isBase)) {
          nextList = nextList.map((c, idx) => (idx === 0 ? { ...c, isBase: true } : c));
        }
        savePersistedCurrencies(nextList);
        return nextList;
      });

      setExchangeRateItems((prev) => {
        const nextItems = prev.filter(
          (r) =>
            r.sourceCurrency.toUpperCase() !== cleanCode &&
            r.targetCurrency.toUpperCase() !== cleanCode
        );
        savePersistedExchangeRateItems(nextItems);
        return nextItems;
      });

      setSettings((prev) => {
        if (prev.currency === cleanCode) {
          const remaining = currencies.filter((c) => c.code.toUpperCase() !== cleanCode);
          return {
            ...prev,
            currency: remaining[0]?.code || 'SDG',
          };
        }
        return prev;
      });
    },
    [currencies, workspaceMode, currentCompany.id, currentUser.id]
  );

  const clearAllCurrencies = useCallback(() => {
    setCurrencies([]);
    setExchangeRateItems([]);
    setExchangeRates({ SDG: 1 });
    setExchangeRateHistory([]);
    savePersistedCurrencies([]);
    savePersistedExchangeRateItems([]);
    try {
      localStorage.removeItem(STORAGE_KEYS.CURRENCIES);
      localStorage.removeItem(STORAGE_KEYS.EXCHANGE_RATES);
      localStorage.removeItem(STORAGE_KEYS.EXCHANGE_RATE_ITEMS);
      localStorage.removeItem(STORAGE_KEYS.RATE_HISTORY);
      localStorage.removeItem(getCompanyStorageKey(STORAGE_KEYS.CURRENCIES, currentCompanyId));
      localStorage.removeItem(getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATES, currentCompanyId));
      localStorage.removeItem(
        getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATE_ITEMS, currentCompanyId)
      );
      localStorage.removeItem(getCompanyStorageKey(STORAGE_KEYS.RATE_HISTORY, currentCompanyId));
    } catch {}
    playSuccessChime(settings.soundEnabled);
    triggerHaptic('heavy', settings.hapticsEnabled);
  }, [currentCompanyId, settings.soundEnabled, settings.hapticsEnabled]);

  const setBaseCurrencyCode = useCallback(
    (code: string) => {
      const cleanCode = code.toUpperCase().trim();
      if (!cleanCode) return;
      setCurrencies((prev) => {
        const nextList = prev.map((c) => ({
          ...c,
          isBase: c.code.toUpperCase() === cleanCode,
        }));
        savePersistedCurrencies(nextList);
        return nextList;
      });
      setSettings((prev) => ({
        ...prev,
        currency: cleanCode,
      }));
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  // Sync a full list of ExchangeRateItems into POSContext and LocalStorage
  const syncExchangeRatesState = useCallback((items: ExchangeRateItem[]) => {
    setExchangeRateItems(items);
    savePersistedExchangeRateItems(items);

    const ratesPatch: Record<string, number> = { SDG: 1 };
    for (const r of items) {
      if (r.targetCurrency === 'SDG' && r.rate > 0) {
        ratesPatch[r.sourceCurrency.toUpperCase()] = r.rate;
      }
    }

    setExchangeRates((prevMap) => {
      const nextMap: Record<string, number> = { ...prevMap, ...ratesPatch, SDG: 1 };
      savePersistedExchangeRates(nextMap);
      return nextMap;
    });

    setSettings((prevSettings) => ({
      ...prevSettings,
      exchangeRates: { ...(prevSettings.exchangeRates || {}), ...ratesPatch, SDG: 1 },
    }));
  }, []);

  // Update a single currency exchange rate and persist to LocalStorage + PostgreSQL backend
  const updateExchangeRate = useCallback(
    async (data: {
      sourceCurrency: string;
      targetCurrency: string;
      rate: number;
      effectiveFrom?: string;
      expiryDate?: string | null;
    }): Promise<ExchangeRateItem> => {
      const source = data.sourceCurrency.toUpperCase().trim();
      const target = data.targetCurrency.toUpperCase().trim();
      const rateNum = Number(data.rate);
      const effectiveIso = data.effectiveFrom || new Date().toISOString();

      let savedRecord: ExchangeRateItem;
      try {
        savedRecord = await api.saveExchangeRate({
          sourceCurrency: source,
          targetCurrency: target,
          rate: rateNum,
          effectiveFrom: effectiveIso,
          expiryDate: data.expiryDate ?? null,
        });
      } catch (err) {
        // Fallback local record if offline so LocalStorage persistence still succeeds
        savedRecord = {
          id: `rate-${source.toLowerCase()}-${target.toLowerCase()}-${Date.now()}`,
          sourceCurrency: source,
          targetCurrency: target,
          rate: rateNum,
          inverseRate: rateNum > 0 ? Math.round((1 / rateNum) * 1000000) / 1000000 : 0,
          effectiveFrom: effectiveIso,
          expiryDate: data.expiryDate ?? null,
          isActive: true,
        };
      }

      // Immediately persist updated rate in POSContext state and LocalStorage
      const computedRateToSdg =
        target === 'SDG' ? savedRecord.rate : source === 'SDG' && savedRecord.rate > 0 ? 1 / savedRecord.rate : null;

      if (computedRateToSdg && computedRateToSdg > 0) {
        const foreignCode = target === 'SDG' ? source : target;
        setExchangeRates((prev) => {
          const prevRate = Number(prev[foreignCode] || computedRateToSdg);
          if (Math.abs(computedRateToSdg - prevRate) > 0.0001) {
            const pct =
              prevRate > 0
                ? Math.round(((computedRateToSdg - prevRate) / prevRate) * 1000) / 10
                : 0;
            setExchangeRateHistory((prevHist) => [
              ...prevHist,
              {
                id: `hist-${foreignCode.toLowerCase()}-${Date.now()}`,
                currency: foreignCode,
                previousRate: prevRate,
                newRate: computedRateToSdg,
                changePercent: pct,
                timestamp: effectiveIso,
              },
            ]);
          }
          const nextMap = { ...prev, [foreignCode]: computedRateToSdg, SDG: 1 };
          savePersistedExchangeRates(nextMap);
          return nextMap;
        });
        setSettings((prevSettings) => ({
          ...prevSettings,
          exchangeRates: { ...(prevSettings.exchangeRates || {}), [foreignCode]: computedRateToSdg, SDG: 1 },
        }));
      }

      setExchangeRateItems((prevItems) => {
        const exists = prevItems.some(
          (i) => i.sourceCurrency === savedRecord.sourceCurrency && i.targetCurrency === savedRecord.targetCurrency
        );
        const nextItems = exists
          ? prevItems.map((i) =>
              i.sourceCurrency === savedRecord.sourceCurrency && i.targetCurrency === savedRecord.targetCurrency
                ? { ...i, ...savedRecord }
                : i
            )
          : [...prevItems, savedRecord];
        savePersistedExchangeRateItems(nextItems);
        return nextItems;
      });

      return savedRecord;
    },
    []
  );

  const enterPracticeMode = useCallback(async () => {
    if (workspaceMode !== 'PRACTICE') {
      setProductionSnapshot({
        products,
        transactions,
        customers,
        stockMovements,
        users,
        settings,
        currencies,
        exchangeRates,
        exchangeRateItems,
        exchangeRateHistory,
        unmetDemandRequests,
        currentUserId,
      });
    }

    setWorkspaceMode('PRACTICE');
    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscountPercentState(0);
    setGlobalDiscountAmountState(0);

    // Load Practice Mode demo currencies and rates immediately (works 100% offline)
    setCurrencies([...DEFAULT_CURRENCIES_LIST]);
    setExchangeRates({ ...DEFAULT_EXCHANGE_RATES_MAP });
    setExchangeRateItems(buildPracticeExchangeRateItems());
    setExchangeRateHistory(INITIAL_EXCHANGE_RATE_HISTORY);
    setSettings((prev) => ({
      ...prev,
      storeName: PRACTICE_COMPANY_PROFILE.displayName,
      storeNameAr: PRACTICE_COMPANY_PROFILE.displayNameAr || PRACTICE_COMPANY_PROFILE.displayName,
      exchangeRates: { ...DEFAULT_EXCHANGE_RATES_MAP },
    }));

    // Load Practice Mode operational seed data locally first so it works offline
    setProducts(INITIAL_PRODUCTS.map((p, idx) => enrichProductWithSeedMetadata(p, idx)));
    setTransactions(INITIAL_TRANSACTIONS);
    setCustomers(INITIAL_CUSTOMERS);
    setStockMovements(INITIAL_STOCK_MOVEMENTS);
    setUnmetDemandRequests(INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[]);
    setUsers(INITIAL_USERS);
    setActiveSessions(INITIAL_ACTIVE_SESSIONS);
    setCurrentUserId('user-1');

    try {
      const res = await fetch('/api/onboarding/practice/state');
      if (res.ok) {
        const payload = await res.json();
        const prac = payload?.data;
        if (prac) {
          if (Array.isArray(prac.products) && prac.products.length > 0) setProducts(prac.products);
          if (Array.isArray(prac.transactions)) setTransactions(prac.transactions);
          if (Array.isArray(prac.customers)) setCustomers(prac.customers);
          if (Array.isArray(prac.stockMovements)) setStockMovements(prac.stockMovements);
          if (Array.isArray(prac.users) && prac.users.length > 0) {
            setUsers(prac.users);
            setCurrentUserId(prac.users[0].id);
          }
          if (Array.isArray(prac.unmetDemandRequests)) {
            setUnmetDemandRequests(prac.unmetDemandRequests);
          }
        }
      }
    } catch {
      // Offline mode: local seed data is already active
    }

    setActiveBranchId('branch-practice-main');
    setIsOnboardingModalOpen(false);
    playSuccessChime(settings.soundEnabled);
    triggerHaptic('success', settings.hapticsEnabled);
  }, [
    workspaceMode,
    products,
    transactions,
    customers,
    stockMovements,
    users,
    settings,
    currencies,
    exchangeRates,
    exchangeRateItems,
    exchangeRateHistory,
    unmetDemandRequests,
    currentUserId,
    setActiveBranchId,
  ]);

  const exitPracticeMode = useCallback(async () => {
    setWorkspaceMode('PRODUCTION');
    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscountPercentState(0);
    setGlobalDiscountAmountState(0);

    if (productionSnapshot) {
      setProducts(productionSnapshot.products);
      setTransactions(productionSnapshot.transactions);
      setCustomers(productionSnapshot.customers);
      setStockMovements(productionSnapshot.stockMovements);
      setUsers(productionSnapshot.users);
      setSettings(productionSnapshot.settings);
      setCurrencies(productionSnapshot.currencies);
      setExchangeRates(productionSnapshot.exchangeRates);
      setExchangeRateItems(productionSnapshot.exchangeRateItems);
      setExchangeRateHistory(productionSnapshot.exchangeRateHistory);
      setUnmetDemandRequests(productionSnapshot.unmetDemandRequests);
      setCurrentUserId(
        productionSnapshot.currentUserId ||
          productionSnapshot.users[0]?.id ||
          'unassigned-operator'
      );
      const validIds = new Set(productionSnapshot.users.map((u) => u.id));
      setActiveSessions((prev) => prev.filter((s) => validIds.has(s.userId)));
    } else {
      const loaded = loadCompanyOperationalState(currentCompanyId);
      setProducts(loaded.products);
      setTransactions(loaded.transactions);
      setCustomers(loaded.customers);
      setStockMovements(loaded.stockMovements);
      setCurrencies(loaded.currencies);
      setExchangeRates(loaded.exchangeRates);
      setExchangeRateItems(loaded.exchangeRateItems);
      setExchangeRateHistory(loaded.exchangeRateHistory);
      setUnmetDemandRequests(loaded.unmetDemandRequests);
      setUsers(loaded.users);
      setActiveSessions(loaded.activeSessions);
      setCurrentUserId(loaded.users[0]?.id || 'unassigned-operator');
    }

    setActiveBranchId('branch-main');
    triggerHaptic('medium', settings.hapticsEnabled);
  }, [productionSnapshot, currentCompanyId, settings.hapticsEnabled, setActiveBranchId]);

  const resetPracticeModeData = useCallback(async () => {
    // Strictly resets ONLY the Practice Mode demo environment — never production!
    Object.values(PRACTICE_STORAGE_KEYS).forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });

    if (workspaceMode === 'PRACTICE') {
      setProducts(INITIAL_PRODUCTS.map((p, idx) => enrichProductWithSeedMetadata(p, idx)));
      setTransactions(INITIAL_TRANSACTIONS);
      setCustomers(INITIAL_CUSTOMERS);
      setStockMovements(INITIAL_STOCK_MOVEMENTS);
      setUnmetDemandRequests(INITIAL_UNMET_DEMAND_REQUESTS as UnmetDemandRequestRecord[]);
      setCurrencies([...DEFAULT_CURRENCIES_LIST]);
      setExchangeRates({ ...DEFAULT_EXCHANGE_RATES_MAP });
      setExchangeRateItems(buildPracticeExchangeRateItems());
      setExchangeRateHistory(INITIAL_EXCHANGE_RATE_HISTORY);
      setUsers(INITIAL_USERS);
      setActiveSessions(INITIAL_ACTIVE_SESSIONS);
      setCurrentUserId('user-1');
    }

    try {
      const res = await fetch('/api/onboarding/practice/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const payload = await res.json();
        const prac = payload?.data?.state;
        if (prac && workspaceMode === 'PRACTICE') {
          if (Array.isArray(prac.products)) setProducts(prac.products);
          if (Array.isArray(prac.transactions)) setTransactions(prac.transactions);
          if (Array.isArray(prac.customers)) setCustomers(prac.customers);
          if (Array.isArray(prac.stockMovements)) setStockMovements(prac.stockMovements);
          if (Array.isArray(prac.users) && prac.users.length > 0) {
            setUsers(prac.users);
            setCurrentUserId(prac.users[0].id);
          }
          if (Array.isArray(prac.unmetDemandRequests)) {
            setUnmetDemandRequests(prac.unmetDemandRequests);
          }
        }
      }
    } catch {
      // Offline Practice Mode reset already applied above
    }

    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscountPercentState(0);
    setGlobalDiscountAmountState(0);
    playSuccessChime(settings.soundEnabled);
    triggerHaptic('heavy', true);
  }, [workspaceMode, settings.soundEnabled]);

  const resetAllData = useCallback(() => {
    if (workspaceMode === 'PRACTICE') {
      resetPracticeModeData();
      return;
    }

    // In Production mode: wipe all default/company data to 100% empty (no default products, rates, or accounts)
    const keysToRemove = [
      STORAGE_KEYS.PRODUCTS,
      STORAGE_KEYS.TRANSACTIONS,
      STORAGE_KEYS.CUSTOMERS,
      STORAGE_KEYS.MOVEMENTS,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.CURRENCIES,
      STORAGE_KEYS.EXCHANGE_RATES,
      STORAGE_KEYS.EXCHANGE_RATE_ITEMS,
      STORAGE_KEYS.RATE_HISTORY,
      STORAGE_KEYS.UNMET_DEMAND_REQUESTS,
      STORAGE_KEYS.USERS,
      STORAGE_KEYS.ACTIVE_SESSIONS,
      STORAGE_KEYS.CURRENT_USER_ID,
      getCompanyStorageKey(STORAGE_KEYS.PRODUCTS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.TRANSACTIONS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.CUSTOMERS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.MOVEMENTS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.SETTINGS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.CURRENCIES, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATES, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.EXCHANGE_RATE_ITEMS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.RATE_HISTORY, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.UNMET_DEMAND_REQUESTS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.USERS, currentCompanyId),
      getCompanyStorageKey(STORAGE_KEYS.ACTIVE_SESSIONS, currentCompanyId),
    ];
    for (const k of keysToRemove) {
      try {
        localStorage.removeItem(k);
      } catch {}
    }

    setProducts([]);
    setTransactions([]);
    setCustomers([]);
    setStockMovements([]);
    setCurrencies([]);
    setExchangeRates({ SDG: 1 });
    setExchangeRateItems([]);
    setExchangeRateHistory([]);
    setUnmetDemandRequests([]);
    setUsers([]);
    setActiveSessions([]);
    setCurrentUserId('unassigned-operator');
    setSettings((prev) => ({
      ...prev,
      currency: 'SDG',
      exchangeRates: { SDG: 1 },
    }));
    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscountPercent(0);

    playSuccessChime(settings.soundEnabled);
    triggerHaptic('heavy', true);
  }, [workspaceMode, currentCompanyId, resetPracticeModeData, setGlobalDiscountPercent, settings.soundEnabled]);

  const executeAuthorizedFactoryReset = useCallback(
    async (params: {
      scope: 'LOCAL_DEVICE_RESET' | 'COMPANY_FACTORY_RESET';
      confirmCompanyName?: string;
      ownerUsernameOrId?: string;
      ownerPassword?: string;
      reason?: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      scope?: string;
      deletedCounts?: Record<string, number>;
    }> => {
      if (workspaceMode === 'PRACTICE') {
        await resetPracticeModeData();
        return { ok: true, scope: 'PRACTICE_MODE_RESET' };
      }

      const scope = params.scope || 'LOCAL_DEVICE_RESET';

      // Scope A: Local Device Reset (resets local cache & device session without deleting server-side company records)
      if (scope === 'LOCAL_DEVICE_RESET') {
        try {
          await fetch('/api/onboarding/factory-reset', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': currentUser.id,
              'x-company-id': currentCompany.id,
            },
            body: JSON.stringify({
              scope: 'LOCAL_DEVICE_RESET',
              companyId: currentCompany.id,
              reason: params.reason || 'Local device cache reset',
            }),
          });
        } catch {}

        resetAllData();
        return { ok: true, scope: 'LOCAL_DEVICE_RESET' };
      }

      // Scope B: Authorized Company Factory Reset
      const confirmName = String(params.confirmCompanyName || '').trim();
      const password = String(params.ownerPassword || '').trim();
      const expectedLegal = String(currentCompany.legalName || '').trim().toLowerCase();
      const expectedDisplay = String(currentCompany.displayName || '').trim().toLowerCase();
      const expectedAr = String(currentCompany.displayNameAr || '').trim().toLowerCase();
      const enteredLower = confirmName.toLowerCase();

      if (
        !enteredLower ||
        (enteredLower !== expectedLegal &&
          enteredLower !== expectedDisplay &&
          enteredLower !== expectedAr)
      ) {
        return {
          ok: false,
          error:
            settings.language === 'ar'
              ? 'اسم الشركة المدخل للتأكيد لا يطابق اسم الشركة الحالية.'
              : 'Company name confirmation does not match the active company name.',
        };
      }

      if (!password) {
        return {
          ok: false,
          error:
            settings.language === 'ar'
              ? 'يرجى إدخال كلمة مرور المالك أو الرمز السري لتأكيد إعادة ضبط المصنع.'
              : 'Owner password or PIN is required to authorize Company Factory Reset.',
        };
      }

      let serverDeletedCounts: Record<string, number> | undefined;
      try {
        const res = await fetch('/api/onboarding/factory-reset', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
            'x-company-id': currentCompany.id,
          },
          body: JSON.stringify({
            scope: 'COMPANY_FACTORY_RESET',
            companyId: currentCompany.id,
            confirmCompanyName: confirmName,
            ownerUsernameOrId: params.ownerUsernameOrId || currentUser.username || currentUser.id,
            ownerPassword: password,
            reason: params.reason || 'Authorized Company Factory Reset',
          }),
        });
        if (res.ok) {
          const payload = await res.json();
          serverDeletedCounts = payload?.data?.deletedCounts;
        } else {
          const errPayload = await res.json().catch(() => null);
          // Only block on explicit password/name mismatch from server if company exists on server
          if (errPayload?.code === 'INVALID_OWNER_PASSWORD' || errPayload?.code === 'COMPANY_NAME_CONFIRMATION_MISMATCH') {
            return {
              ok: false,
              error: errPayload?.message || 'Owner authentication failed.',
            };
          }
        }
      } catch {
        // Offline verification fallback: check against local owner PIN if available
        const localOwner = users.find(
          (u) =>
            u.companyId === currentCompany.id &&
            (u.systemRole === 'COMPANY_OWNER' || u.role === 'admin')
        );
        if (localOwner && localOwner.pin && localOwner.pin !== password) {
          return {
            ok: false,
            error:
              settings.language === 'ar'
                ? 'كلمة المرور أو رمز PIN للمالك غير صحيح.'
                : 'Invalid Owner password or PIN.',
          };
        }
      }

      const resetCompanyId = currentCompany.id;
      resetAllData();

      // Remove only the target company and its branches; preserve any other companies
      const remainingCompanies = companies.filter((c) => c.id !== resetCompanyId);
      setCompanies(remainingCompanies);
      setAllBranches((prev) => prev.filter((b) => b.companyId !== resetCompanyId));

      if (remainingCompanies.length > 0) {
        setCurrentCompanyId(remainingCompanies[0].id);
      } else {
        setCurrentCompanyId('comp-clean-store');
        setOnboardingModalInitialView('create-company');
        setIsOnboardingModalOpen(true);
      }

      return {
        ok: true,
        scope: 'COMPANY_FACTORY_RESET',
        deletedCounts: serverDeletedCounts,
      };
    },
    [
      workspaceMode,
      resetPracticeModeData,
      currentUser,
      currentCompany,
      resetAllData,
      settings.language,
      users,
      companies,
    ]
  );

  const createNewCompanyWorkspace = useCallback(
    async (
      input: Record<string, any>
    ): Promise<{
      ok: boolean;
      error?: string;
      company?: CompanyProfile;
      owner?: POSUser;
      branch?: BranchRecord;
    }> => {
      const nowIso = new Date().toISOString();
      const suffix = Date.now().toString(36).slice(-5);
      const rawUserBase = String(input.baseCurrency || '').toUpperCase().trim();
      const skipInitialCurrencies = Boolean(input.skipInitialCurrencies);
      const cleanBase = rawUserBase || 'SDG';
      const secondaryList: string[] = Array.isArray(input.secondaryCurrencies)
        ? input.secondaryCurrencies.map((c: string) => String(c).toUpperCase().trim()).filter(Boolean)
        : [];
      const rawRatesMap: Record<string, number> =
        input.initialExchangeRates && typeof input.initialExchangeRates === 'object'
          ? input.initialExchangeRates
          : {};

      // Build offline-ready company, branch, and owner records first
      const localCompany: CompanyProfile = {
        id: `comp-${suffix}`,
        legalName: String(input.legalName || input.displayName || '').trim(),
        displayName: String(input.displayName || input.legalName || '').trim(),
        displayNameAr: String(input.displayNameAr || input.displayName || input.legalName || '').trim(),
        businessType: String(input.businessType || '').trim(),
        country: String(input.country || '').trim(),
        city: String(input.city || '').trim(),
        address: String(input.address || '').trim(),
        phone: String(input.phone || '').trim(),
        email: String(input.email || '').trim(),
        taxNumber: String(input.taxNumber || '').trim(),
        defaultLanguage: input.defaultLanguage === 'en' ? 'en' : 'ar',
        timezone: String(input.timezone || 'Africa/Khartoum'),
        fiscalYearStartMonth: Number(input.fiscalYearStartMonth) || 1,
        baseCurrency: cleanBase,
        secondaryCurrencies: secondaryList,
        exchangeRatePolicy: input.exchangeRatePolicy || 'manual_daily',
        isDemoPractice: false,
        onboardingCompleted: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const localBranch: BranchRecord = {
        id: `br-${suffix}-main`,
        companyId: localCompany.id,
        code: String(input.branchCode || `BR-${suffix.toUpperCase()}`).trim(),
        name: String(input.branchName || localCompany.displayName || 'Main Branch').trim(),
        nameAr: String(input.branchNameAr || input.branchName || localCompany.displayNameAr || 'الفرع الرئيسي').trim(),
        city: String(input.branchCity || localCompany.city || '').trim(),
        address: String(input.branchAddress || localCompany.address || '').trim(),
        phone: String(input.branchPhone || localCompany.phone || '').trim(),
        isMainBranch: true,
        isActive: true,
        createdAt: nowIso,
      };

      const ownerCapabilities = deriveCapabilitiesFromUser({
        role: 'admin',
        systemRole: 'COMPANY_OWNER',
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.admin },
      });
      const localOwner: POSUser = {
        id: `usr-owner-${suffix}`,
        companyId: localCompany.id,
        branchId: localBranch.id,
        assignedBranchIds: [localBranch.id],
        name: String(input.ownerName || localCompany.displayName).trim(),
        nameAr: String(input.ownerNameAr || input.ownerName || localCompany.displayNameAr).trim(),
        username: String(input.ownerUsername || `owner.${suffix}`).trim(),
        email: String(input.ownerEmail || '').trim() || undefined,
        phone: String(input.ownerPhone || localCompany.phone || '').trim() || undefined,
        role: 'admin',
        systemRole: 'COMPANY_OWNER',
        capabilities: ownerCapabilities,
        pin: String(input.ownerPin || '1111').trim(),
        terminalName: `${localBranch.name} Terminal 01`,
        terminalNameAr: `نقطة بيع ${localBranch.nameAr}`,
        avatarColor: '#10b981',
        isActive: true,
        permissions: deriveLegacyPermissionsFromCapabilities(ownerCapabilities),
        lastActiveAt: nowIso,
      };

      let finalCompany = localCompany;
      let finalBranch = localBranch;
      let finalOwner = localOwner;

      // Try syncing to backend if online; if offline or error, continue seamlessly with local records
      try {
        const res = await fetch('/api/onboarding/companies', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
            'x-company-id': currentCompany.id,
          },
          body: JSON.stringify(input),
        });
        if (res.ok) {
          const payload = await res.json();
          if (payload?.data?.company) finalCompany = payload.data.company;
          if (payload?.data?.branch) finalBranch = payload.data.branch;
          if (payload?.data?.owner) finalOwner = payload.data.owner;
        }
      } catch {
        // Offline mode: localCompany, localBranch, localOwner are used directly
      }

      // Build ONLY the currencies and exchange rates explicitly entered by the user (zero default currencies unless entered!)
      const newCompanyCurrencies: Currency[] = [];
      const newCompanyRatesMap: Record<string, number> = { [cleanBase]: 1, SDG: 1 };
      const newCompanyRateItems: ExchangeRateItem[] = [];

      if (!skipInitialCurrencies && rawUserBase.length >= 2) {
        const matchedBasePreset = DEFAULT_CURRENCIES_LIST.find((c) => c.code === rawUserBase);
        newCompanyCurrencies.push(
          matchedBasePreset
            ? { ...matchedBasePreset, isBase: true, isActive: true }
            : {
                code: rawUserBase,
                name: rawUserBase,
                nameAr: rawUserBase,
                symbol: rawUserBase,
                decimalPlaces: 2,
                isBase: true,
                isActive: true,
              }
        );
      }

      for (const code of secondaryList) {
        if (skipInitialCurrencies) break;
        const cleanCode = code.toUpperCase().trim();
        const enteredRate = Number(rawRatesMap[cleanCode]);
        if (cleanCode && cleanCode !== cleanBase && !isNaN(enteredRate) && enteredRate > 0) {
          const matchedPreset = DEFAULT_CURRENCIES_LIST.find((c) => c.code === cleanCode);
          const curObj: Currency = matchedPreset
            ? { ...matchedPreset, isBase: false, isActive: true }
            : {
                code: cleanCode,
                name: cleanCode,
                nameAr: cleanCode,
                symbol: cleanCode,
                decimalPlaces: 2,
                isBase: false,
                isActive: true,
              };
          newCompanyCurrencies.push(curObj);
          newCompanyRatesMap[cleanCode] = enteredRate;
          newCompanyRateItems.push({
            id: `rate-${cleanCode.toLowerCase()}-${cleanBase.toLowerCase()}-${Date.now()}`,
            sourceCurrency: cleanCode,
            targetCurrency: cleanBase,
            rate: enteredRate,
            inverseRate: Math.round((1 / enteredRate) * 1000000) / 1000000,
            effectiveFrom: nowIso,
            expiryDate: null,
            isActive: true,
            sourceSymbol: curObj.symbol,
            targetSymbol: newCompanyCurrencies[0]?.symbol || cleanBase,
            sourceName: curObj.name,
            targetName: newCompanyCurrencies[0]?.name || cleanBase,
          });
        }
      }

      // Activate new company with 100% clean operational state (empty products, sales, customers, movements)
      setCompanies((prev) => {
        const filtered = prev.filter((c) => c.id !== 'comp-default');
        const exists = filtered.some((c) => c.id === finalCompany.id);
        return exists
          ? filtered.map((c) => (c.id === finalCompany.id ? finalCompany : c))
          : [...filtered, finalCompany];
      });
      setCurrentCompanyId(finalCompany.id);
      setWorkspaceMode('PRODUCTION');

      setProducts([]);
      setTransactions([]);
      setCustomers([]);
      setStockMovements([]);
      setUnmetDemandRequests([]);
      setExchangeRateHistory([]);
      setCurrencies(newCompanyCurrencies);
      setExchangeRates(newCompanyRatesMap);
      setExchangeRateItems(newCompanyRateItems);
      setCart([]);
      setSelectedCustomer(null);

      setSettings((prev) => ({
        ...prev,
        storeName: finalCompany.displayName || finalCompany.legalName,
        storeNameAr: finalCompany.displayNameAr || finalCompany.displayName,
        storeAddress: finalCompany.address || '',
        storePhone: finalCompany.phone || '',
        currency: finalCompany.baseCurrency || 'SDG',
        language: finalCompany.defaultLanguage || prev.language,
        exchangeRates: newCompanyRatesMap,
      }));

      setAllBranches((prev) => {
        const exists = prev.some((b) => b.id === finalBranch.id);
        return exists ? prev.map((b) => (b.id === finalBranch.id ? finalBranch : b)) : [...prev, finalBranch];
      });
      setActiveBranchId(finalBranch.id);

      const hasEnteredOwnerAccount = Boolean(
        String(input.ownerName || '').trim() || String(input.ownerNameAr || '').trim()
      );
      if (hasEnteredOwnerAccount) {
        setUsers([finalOwner]);
        setCurrentUserId(finalOwner.id);
        setActiveSessions([
          {
            sessionId: `sess-${finalOwner.id}-${Date.now()}`,
            userId: finalOwner.id,
            userName: finalOwner.name,
            userNameAr: finalOwner.nameAr,
            role: finalOwner.role,
            terminalName: finalOwner.terminalName,
            terminalNameAr: finalOwner.terminalNameAr,
            startedAt: nowIso,
            lastPingAt: nowIso,
            status: 'online',
          },
        ]);
      } else {
        setUsers([]);
        setActiveSessions([]);
        setCurrentUserId('unassigned-operator');
      }

      setIsOnboardingModalOpen(false);
      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return { ok: true, company: finalCompany, branch: finalBranch, owner: finalOwner };
    },
    [settings.soundEnabled, settings.hapticsEnabled, setActiveBranchId]
  );

  const switchCompanyWorkspace = useCallback(
    async (companyId: string, userId?: string) => {
      if (companyId === 'comp-demo-practice') {
        await enterPracticeMode();
        return;
      }

      if (workspaceMode === 'PRACTICE') {
        setWorkspaceMode('PRODUCTION');
      }

      setCurrentCompanyId(companyId);
      const loaded = loadCompanyOperationalState(companyId);
      setProducts(loaded.products);
      setTransactions(loaded.transactions);
      setCustomers(loaded.customers);
      setStockMovements(loaded.stockMovements);
      setUnmetDemandRequests(loaded.unmetDemandRequests);
      setCurrencies(loaded.currencies);
      setExchangeRates(loaded.exchangeRates);
      setExchangeRateItems(loaded.exchangeRateItems);
      setExchangeRateHistory(loaded.exchangeRateHistory);
      setUsers(loaded.users);
      setActiveSessions(loaded.activeSessions);
      setCart([]);
      setSelectedCustomer(null);

      const targetCompany = companies.find((c) => c.id === companyId);
      if (targetCompany) {
        setSettings((prev) => ({
          ...prev,
          storeName: targetCompany.displayName || targetCompany.legalName,
          storeNameAr: targetCompany.displayNameAr || targetCompany.displayName,
          storeAddress: targetCompany.address || '',
          storePhone: targetCompany.phone || '',
          currency: targetCompany.baseCurrency || 'SDG',
          exchangeRates: loaded.exchangeRates,
        }));
      }

      const companyBranches = allBranches.filter(
        (b) => (b.companyId || 'comp-default') === companyId
      );
      if (companyBranches.length > 0) {
        setActiveBranchId(companyBranches[0].id);
      }

      if (userId) {
        setCurrentUserId(userId);
      } else if (loaded.users.length > 0) {
        setCurrentUserId(loaded.users[0].id);
      } else {
        setCurrentUserId('unassigned-operator');
      }

      setIsOnboardingModalOpen(false);
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [
      workspaceMode,
      enterPracticeMode,
      companies,
      allBranches,
      settings.hapticsEnabled,
      setActiveBranchId,
    ]
  );

  const createBranch = useCallback(
    async (input: {
      name: string;
      nameAr?: string;
      code?: string;
      city?: string;
      address?: string;
      phone?: string;
      isMainBranch?: boolean;
    }): Promise<BranchRecord | null> => {
      const targetCompanyId =
        workspaceMode === 'PRACTICE' ? 'comp-demo-practice' : currentCompany.id;
      try {
        const res = await fetch('/api/branches', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
            'x-company-id': targetCompanyId,
          },
          body: JSON.stringify({
            ...input,
            companyId: targetCompanyId,
          }),
        });
        if (res.ok) {
          const payload = await res.json();
          const created: BranchRecord = payload?.data?.branch;
          if (created) {
            setAllBranches((prev) => [...prev, created]);
            playSuccessChime(settings.soundEnabled);
            triggerHaptic('success', settings.hapticsEnabled);
            return created;
          }
        }
      } catch {}

      const fallbackBranch: BranchRecord = {
        id: `branch-${Date.now()}`,
        companyId: targetCompanyId,
        code: (input.code || `BR-0${branches.length + 1}`).toUpperCase(),
        name: input.name.trim(),
        nameAr: input.nameAr?.trim() || input.name.trim(),
        city: input.city?.trim() || '',
        address: input.address?.trim() || '',
        phone: input.phone?.trim() || '',
        isMainBranch: Boolean(input.isMainBranch),
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      setAllBranches((prev) => [...prev, fallbackBranch]);
      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return fallbackBranch;
    },
    [workspaceMode, currentCompany.id, currentUser.id, branches.length, settings.soundEnabled, settings.hapticsEnabled]
  );

  const updateBranch = useCallback(
    (branchId: string, updates: Partial<BranchRecord>) => {
      setAllBranches((prev) =>
        prev.map((b) => (b.id === branchId ? { ...b, ...updates } : b))
      );
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  const deleteBranch = useCallback(
    (branchId: string) => {
      setAllBranches((prev) => prev.filter((b) => b.id !== branchId));
      triggerHaptic('medium', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  const syncTransactions = useCallback(async () => {
    setIsSyncing(true);
    triggerHaptic('light', settings.hapticsEnabled);
    try {
      const response = await fetch('/api/store-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-mode': workspaceMode,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({
          workspaceMode,
          companyId: currentCompany.id,
          transactions: transactions.map((t) => ({ ...t, syncStatus: 'synced' })),
          customers,
          stockMovements,
          users,
          activeSessions,
          unmetDemandRequests,
        }),
      });
      if (response.ok) {
        const syncedData = await response.json();
        if (workspaceMode === 'PRACTICE') {
          if (Array.isArray(syncedData.transactions) && syncedData.transactions.length > 0) {
            setTransactions(
              syncedData.transactions.map((t: Transaction) => ({ ...t, syncStatus: 'synced' }))
            );
          }
          if (Array.isArray(syncedData.customers) && syncedData.customers.length > 0) {
            setCustomers(syncedData.customers);
          }
          if (Array.isArray(syncedData.stockMovements) && syncedData.stockMovements.length > 0) {
            setStockMovements(syncedData.stockMovements);
          }
          if (Array.isArray(syncedData.users) && syncedData.users.length > 0) {
            setUsers(syncedData.users);
          }
          if (Array.isArray(syncedData.activeSessions) && syncedData.activeSessions.length > 0) {
            setActiveSessions(syncedData.activeSessions);
          }
          if (Array.isArray(syncedData.products) && syncedData.products.length > 0) {
            setProducts(syncedData.products);
          }
        } else {
          // In Production mode: mark local transactions synced without injecting any server seed accounts/products
          setTransactions((prev) =>
            prev.map((t) => (t.syncStatus !== 'synced' ? { ...t, syncStatus: 'synced' } : t))
          );
        }
      } else {
        setTransactions((prev) =>
          prev.map((t) => (t.syncStatus !== 'synced' ? { ...t, syncStatus: 'synced' } : t))
        );
      }
    } catch {
      setTransactions((prev) =>
        prev.map((t) => (t.syncStatus !== 'synced' ? { ...t, syncStatus: 'synced' } : t))
      );
    } finally {
      setLastSyncedAt(new Date());
      setIsSyncing(false);
      triggerHaptic('success', settings.hapticsEnabled);
    }
  }, [
    workspaceMode,
    currentCompany.id,
    settings.hapticsEnabled,
    transactions,
    customers,
    stockMovements,
    users,
    activeSessions,
    unmetDemandRequests,
  ]);

  // Multi-User & Role Permissions actions
  const switchCurrentUser = useCallback(
    (userId: string) => {
      const targetUser = users.find((u) => u.id === userId);
      if (!targetUser || targetUser.isActive === false) return;
      const nowIso = new Date().toISOString();
      setCurrentUserId(userId);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, lastActiveAt: nowIso, isActive: true } : u))
      );
      setActiveSessions((prev) => {
        const exists = prev.some((s) => s.userId === userId);
        if (exists) {
          return prev.map((s) =>
            s.userId === userId ? { ...s, lastPingAt: nowIso, status: 'online' } : s
          );
        }
        return [
          ...prev,
          {
            sessionId: `sess-${userId}-${Date.now()}`,
            userId: targetUser.id,
            userName: targetUser.name,
            userNameAr: targetUser.nameAr,
            role: targetUser.role,
            terminalName: targetUser.terminalName,
            terminalNameAr: targetUser.terminalNameAr,
            startedAt: nowIso,
            lastPingAt: nowIso,
            status: 'online',
          },
        ];
      });
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [users, settings.hapticsEnabled]
  );

  const saveUser = useCallback(
    (userData: Partial<POSUser> & { name: string; role: UserRole; password?: string }): POSUser => {
      const nowIso = new Date().toISOString();
      const existing = userData.id ? users.find((u) => u.id === userData.id) : undefined;
      const resolvedLegacyRole = userData.systemRole
        ? mapSystemRoleToLegacyRole(userData.systemRole)
        : userData.role;
      const fallbackPerms = {
        ...DEFAULT_ROLE_PERMISSIONS[resolvedLegacyRole],
      };
      const resolvedCapabilities =
        Array.isArray(userData.capabilities) && userData.capabilities.length > 0
          ? (userData.capabilities as CapabilityCode[])
          : deriveCapabilitiesFromUser({
              role: resolvedLegacyRole,
              systemRole: userData.systemRole,
              permissions: userData.permissions || fallbackPerms,
            });
      const rolePerms =
        userData.permissions ||
        deriveLegacyPermissionsFromCapabilities(resolvedCapabilities) ||
        fallbackPerms;

      const saved: POSUser = existing
        ? {
            ...existing,
            ...userData,
            role: resolvedLegacyRole,
            capabilities: resolvedCapabilities,
            permissions: rolePerms,
            lastActiveAt: nowIso,
          }
        : {
            id: `user-${Date.now()}`,
            companyId: currentCompany.id,
            branchId: userData.branchId || activeBranchId || 'branch-main',
            assignedBranchIds: userData.assignedBranchIds || [
              userData.branchId || activeBranchId || 'branch-main',
            ],
            name: userData.name.trim(),
            nameAr: userData.nameAr?.trim() || userData.name.trim(),
            username:
              userData.username?.trim() ||
              userData.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '.'),
            email: userData.email?.trim() || undefined,
            phone: userData.phone?.trim() || undefined,
            role: resolvedLegacyRole,
            systemRole: userData.systemRole,
            capabilities: resolvedCapabilities,
            pin: userData.pin || '0000',
            terminalName: userData.terminalName || `POS Terminal 0${users.length + 1}`,
            terminalNameAr: userData.terminalNameAr || `نقطة بيع ${users.length + 1}`,
            avatarColor: userData.avatarColor || '#f59e0b',
            isActive: userData.isActive ?? true,
            permissions: rolePerms,
            lastActiveAt: nowIso,
          };

      setUsers((prev) => {
        const exists = prev.some((u) => u.id === saved.id);
        return exists ? prev.map((u) => (u.id === saved.id ? saved : u)) : [...prev, saved];
      });

      // Persist employee change to backend RBAC service when in Production mode and authenticated on server
      if (
        workspaceMode === 'PRODUCTION' &&
        currentUser.id !== 'unassigned-operator' &&
        currentCompany.id !== 'comp-clean-store'
      ) {
        const endpoint = existing ? `/api/users/${saved.id}` : '/api/users';
        const method = existing ? 'PUT' : 'POST';
        fetch(endpoint, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
            'x-company-id': currentCompany.id,
          },
          body: JSON.stringify({
            ...saved,
            password: userData.password,
          }),
        }).catch(() => {});
      }

      if (saved.isActive) {
        setActiveSessions((prev) => {
          const hasSess = prev.some((s) => s.userId === saved.id);
          if (hasSess) {
            return prev.map((s) =>
              s.userId === saved.id
                ? {
                    ...s,
                    userName: saved.name,
                    userNameAr: saved.nameAr,
                    role: saved.role,
                    terminalName: saved.terminalName,
                    terminalNameAr: saved.terminalNameAr,
                    lastPingAt: nowIso,
                  }
                : s
            );
          }
          return [
            ...prev,
            {
              sessionId: `sess-${saved.id}-${Date.now()}`,
              userId: saved.id,
              userName: saved.name,
              userNameAr: saved.nameAr,
              role: saved.role,
              terminalName: saved.terminalName,
              terminalNameAr: saved.terminalNameAr,
              startedAt: nowIso,
              lastPingAt: nowIso,
              status: 'online',
            },
          ];
        });
      } else {
        setActiveSessions((prev) => prev.filter((s) => s.userId !== saved.id));
      }

      triggerHaptic('success', settings.hapticsEnabled);
      return saved;
    },
    [
      users,
      currentCompany.id,
      activeBranchId,
      workspaceMode,
      currentUser.id,
      settings.hapticsEnabled,
    ]
  );

  const deactivateUserAccount = useCallback(
    async (userId: string, reason?: string): Promise<{ ok: boolean; error?: string }> => {
      const target = users.find((u) => u.id === userId);
      if (!target) return { ok: false, error: 'User not found.' };

      if (
        workspaceMode === 'PRODUCTION' &&
        currentUser.id !== 'unassigned-operator' &&
        currentCompany.id !== 'comp-clean-store'
      ) {
        try {
          await fetch(`/api/users/${userId}/deactivate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': currentUser.id,
              'x-company-id': currentCompany.id,
            },
            body: JSON.stringify({ reason }),
          });
        } catch {}
      }

      const nowIso = new Date().toISOString();
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                isActive: false,
                deactivatedAt: nowIso,
                deactivatedBy: currentUser.id,
                deactivationReason: reason || 'Deactivated by administrator',
              }
            : u
        )
      );
      setActiveSessions((prev) => prev.filter((s) => s.userId !== userId));
      if (currentUserId === userId) {
        const nextActive = users.find((u) => u.id !== userId && u.isActive !== false);
        setCurrentUserId(nextActive?.id || 'unassigned-operator');
      }
      triggerHaptic('medium', settings.hapticsEnabled);
      return { ok: true };
    },
    [users, workspaceMode, currentUser.id, currentCompany.id, currentUserId, settings.hapticsEnabled]
  );

  const reactivateUserAccount = useCallback(
    async (userId: string): Promise<{ ok: boolean; error?: string }> => {
      if (
        workspaceMode === 'PRODUCTION' &&
        currentUser.id !== 'unassigned-operator' &&
        currentCompany.id !== 'comp-clean-store'
      ) {
        try {
          await fetch(`/api/users/${userId}/activate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': currentUser.id,
              'x-company-id': currentCompany.id,
            },
          });
        } catch {}
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                isActive: true,
                deactivatedAt: undefined,
                deactivatedBy: undefined,
              }
            : u
        )
      );
      triggerHaptic('success', settings.hapticsEnabled);
      return { ok: true };
    },
    [workspaceMode, currentUser.id, currentCompany.id, settings.hapticsEnabled]
  );

  const resetUserPasswordOrPin = useCallback(
    async (
      userId: string,
      newPassword?: string,
      newPin?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      if (
        workspaceMode === 'PRODUCTION' &&
        currentUser.id !== 'unassigned-operator' &&
        currentCompany.id !== 'comp-clean-store'
      ) {
        try {
          await fetch(`/api/users/${userId}/reset-password`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': currentUser.id,
              'x-company-id': currentCompany.id,
            },
            body: JSON.stringify({ newPassword, newPin }),
          });
        } catch {}
      }
      if (newPin && newPin.trim().length > 0) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, pin: newPin.trim() } : u))
        );
      }
      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return { ok: true };
    },
    [workspaceMode, currentUser.id, currentCompany.id, settings.soundEnabled, settings.hapticsEnabled]
  );

  const deleteUserAccount = useCallback(
    (userId: string) => {
      setUsers((prev) => {
        const next = prev.filter((u) => u.id !== userId);
        if (currentUserId === userId) {
          setCurrentUserId(next[0]?.id || 'unassigned-operator');
        }
        return next;
      });
      setActiveSessions((prev) => prev.filter((s) => s.userId !== userId));
      triggerHaptic('medium', settings.hapticsEnabled);
    },
    [currentUserId, settings.hapticsEnabled]
  );

  const clearAllUserAccounts = useCallback(() => {
    setUsers([]);
    setActiveSessions([]);
    setCurrentUserId('unassigned-operator');
    try {
      localStorage.removeItem(STORAGE_KEYS.USERS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSIONS);
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
      localStorage.removeItem(getCompanyStorageKey(STORAGE_KEYS.USERS, currentCompanyId));
      localStorage.removeItem(getCompanyStorageKey(STORAGE_KEYS.ACTIVE_SESSIONS, currentCompanyId));
    } catch {}
    playSuccessChime(settings.soundEnabled);
    triggerHaptic('heavy', settings.hapticsEnabled);
  }, [currentCompanyId, settings.soundEnabled, settings.hapticsEnabled]);

  const removeUser = useCallback(
    (userId: string) => {
      deleteUserAccount(userId);
    },
    [deleteUserAccount]
  );

  const toggleUserActiveSession = useCallback(
    (userId: string, terminalName?: string) => {
      const targetUser = users.find((u) => u.id === userId);
      if (!targetUser || targetUser.isActive === false) return;
      const nowIso = new Date().toISOString();

      setActiveSessions((prev) => {
        const exists = prev.some((s) => s.userId === userId);
        if (exists) {
          if (prev.length <= 1) return prev;
          return prev.filter((s) => s.userId !== userId);
        }
        return [
          ...prev,
          {
            sessionId: `sess-${userId}-${Date.now()}`,
            userId: targetUser.id,
            userName: targetUser.name,
            userNameAr: targetUser.nameAr,
            role: targetUser.role,
            terminalName: terminalName || targetUser.terminalName,
            terminalNameAr: targetUser.terminalNameAr,
            startedAt: nowIso,
            lastPingAt: nowIso,
            status: 'online',
          },
        ];
      });
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [users, settings.hapticsEnabled]
  );

  const hasPermission = useCallback(
    (permission: keyof RolePermissions): boolean => {
      if (!currentUser || !currentUser.permissions) return true;
      return Boolean(currentUser.permissions[permission]);
    },
    [currentUser]
  );

  const hasCapability = useCallback(
    (capability: CapabilityCode): boolean => {
      return userHasCapability(currentUser, capability);
    },
    [currentUser]
  );

  // Interactive Guided Training Tour State & Per-User Persistence
  const userTourStorageKey = useMemo(
    () => getUserTourStorageKey(currentUser?.id, currentCompany?.id),
    [currentUser?.id, currentCompany?.id]
  );

  const [trainingTourProgress, setTrainingTourProgress] = useState<TrainingTourProgressState>(() => {
    try {
      const saved =
        localStorage.getItem(getUserTourStorageKey(currentUser?.id, currentCompany?.id)) ||
        localStorage.getItem(TRAINING_TOUR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.completedStepIds)) {
          return parsed;
        }
      }
    } catch {}
    return createInitialTourProgress();
  });

  useEffect(() => {
    try {
      const saved =
        localStorage.getItem(userTourStorageKey) ||
        localStorage.getItem(TRAINING_TOUR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.completedStepIds)) {
          setTrainingTourProgress(parsed);
          return;
        }
      }
    } catch {}
  }, [userTourStorageKey]);

  const [isTrainingTourOpen, setIsTrainingTourOpen] = useState(false);
  const [trainingTourStepIndex, setTrainingTourStepIndex] = useState<number>(() =>
    clampTourStepIndex(trainingTourProgress.lastStepIndex || 0, TRAINING_TOUR_STEPS.length)
  );

  useEffect(() => {
    try {
      localStorage.setItem(userTourStorageKey, JSON.stringify(trainingTourProgress));
      localStorage.setItem(TRAINING_TOUR_STORAGE_KEY, JSON.stringify(trainingTourProgress));
    } catch {}
  }, [trainingTourProgress, userTourStorageKey]);

  const onboardingChecklist = useMemo<OnboardingChecklistStatus>(() => {
    return computeOnboardingChecklistStatus({
      companyProfileConfigured: Boolean(
        currentCompany?.legalName && currentCompany?.onboardingCompleted !== false
      ),
      currenciesConfigured: Boolean(
        currentCompany?.baseCurrency === 'SDG' && Object.keys(exchangeRates || {}).length > 1
      ),
      branchCreated: branches.length > 0,
      productsCount: products.length,
      employeesCount: users.filter((u) => u.isActive !== false).length,
      salesCount: transactions.filter((t) => t.status === 'completed').length,
      inventoryReviewed: stockMovements.length > 0,
      guidedTourCompleted: Boolean(trainingTourProgress.isCompleted),
    });
  }, [
    currentCompany,
    exchangeRates,
    branches.length,
    products.length,
    users,
    transactions,
    stockMovements.length,
    trainingTourProgress.isCompleted,
  ]);

  const startTrainingTour = useCallback(
    (stepIndex = 0) => {
      const safeIdx = clampTourStepIndex(stepIndex, TRAINING_TOUR_STEPS.length);
      setTrainingTourStepIndex(safeIdx);
      setTrainingTourProgress((prev) => markTourStepVisited(prev, safeIdx, TRAINING_TOUR_STEPS));
      const targetTab = TRAINING_TOUR_STEPS[safeIdx]?.tab;
      if (targetTab) {
        setActiveTab(targetTab);
      }
      setIsTrainingTourOpen(true);
    },
    [setActiveTab]
  );

  const closeTrainingTour = useCallback(() => {
    setIsTrainingTourOpen(false);
  }, []);

  const selectTrainingTourStep = useCallback(
    (stepIndex: number) => {
      const safeIdx = clampTourStepIndex(stepIndex, TRAINING_TOUR_STEPS.length);
      setTrainingTourStepIndex(safeIdx);
      setTrainingTourProgress((prev) => markTourStepVisited(prev, safeIdx, TRAINING_TOUR_STEPS));
      const targetTab = TRAINING_TOUR_STEPS[safeIdx]?.tab;
      if (targetTab) {
        setActiveTab(targetTab);
      }
    },
    [setActiveTab]
  );

  const nextTrainingTourStep = useCallback(() => {
    setTrainingTourStepIndex((prevIdx) => {
      const nextIdx = clampTourStepIndex(prevIdx + 1, TRAINING_TOUR_STEPS.length);
      setTrainingTourProgress((prevProg) =>
        markTourStepVisited(prevProg, nextIdx, TRAINING_TOUR_STEPS)
      );
      const targetTab = TRAINING_TOUR_STEPS[nextIdx]?.tab;
      if (targetTab) {
        setActiveTab(targetTab);
      }
      return nextIdx;
    });
  }, [setActiveTab]);

  const prevTrainingTourStep = useCallback(() => {
    setTrainingTourStepIndex((prevIdx) => {
      const prevStep = clampTourStepIndex(prevIdx - 1, TRAINING_TOUR_STEPS.length);
      setTrainingTourProgress((prevProg) =>
        markTourStepVisited(prevProg, prevStep, TRAINING_TOUR_STEPS)
      );
      const targetTab = TRAINING_TOUR_STEPS[prevStep]?.tab;
      if (targetTab) {
        setActiveTab(targetTab);
      }
      return prevStep;
    });
  }, [setActiveTab]);

  const finishTrainingTour = useCallback(() => {
    setTrainingTourProgress((prev) => markTourCompleted(prev, TRAINING_TOUR_STEPS));
    setIsTrainingTourOpen(false);
    playSuccessChime(settings.soundEnabled);
    triggerHaptic('success', settings.hapticsEnabled);
  }, [settings.soundEnabled, settings.hapticsEnabled]);

  const resetTrainingTour = useCallback(() => {
    const fresh = createInitialTourProgress();
    setTrainingTourProgress(fresh);
    setTrainingTourStepIndex(0);
  }, []);

  const openUnmetDemandModal = useCallback(
    (initial?: Partial<UnmetDemandRequestInput>) => {
      setUnmetDemandModalInitialData(initial || null);
      setIsUnmetDemandModalOpen(true);
      triggerHaptic('light', settings.hapticsEnabled);
    },
    [settings.hapticsEnabled]
  );

  const closeUnmetDemandModal = useCallback(() => {
    setIsUnmetDemandModalOpen(false);
    setUnmetDemandModalInitialData(null);
  }, []);

  const recordUnmetDemandRequest = useCallback(
    async (
      input: Partial<UnmetDemandRequestInput>
    ): Promise<UnmetDemandValidationResult> => {
      const validation = validateAndBuildUnmetDemandRequest(input, {
        authenticatedUser: currentUser,
        products,
        existingRequests: unmetDemandRequests,
        activeCurrency: settings.currency || 'SDG',
        exchangeRates,
      });

      if (!validation.ok || !validation.record) {
        triggerHaptic('warning', settings.hapticsEnabled);
        return validation;
      }

      if (!validation.isDuplicateRapidSubmission) {
        const newRecord = validation.record;
        setUnmetDemandRequests((prev) => [newRecord, ...prev]);

        if (workspaceMode === 'PRODUCTION') {
          fetch('/api/unmet-demand/requests', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': currentUser.id,
            },
            body: JSON.stringify({
              ...input,
              idempotencyKey: newRecord.idempotencyKey,
            }),
          }).catch(() => {});
        }
      }

      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
      return validation;
    },
    [
      workspaceMode,
      currentUser,
      products,
      unmetDemandRequests,
      settings.currency,
      settings.soundEnabled,
      settings.hapticsEnabled,
      exchangeRates,
    ]
  );

  const collectClientBackupDataset = useCallback((): BackupPayloadV1 => {
    const compId = currentCompany.id;
    const readScopedJson = <T,>(baseKey: string, fallback: T): T => {
      try {
        const raw =
          localStorage.getItem(getCompanyStorageKey(baseKey, compId)) ||
          localStorage.getItem(`${baseKey}__${compId}`) ||
          localStorage.getItem(baseKey);
        if (raw) return JSON.parse(raw);
      } catch {}
      return fallback;
    };

    const categoriesFromProducts = Array.from(
      new Set(products.map((p) => p.category).filter(Boolean))
    ).map((catName, idx) => ({
      id: `cat-${idx + 1}-${catName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      companyId: compId,
      name: catName,
      nameAr: products.find((p) => p.category === catName)?.categoryAr || catName,
      slug: catName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    }));

    return {
      companyProfile: currentCompany,
      storeSettings: settings,
      invoiceSettings: readScopedJson<Record<string, any>>('pos_invoice_settings', {}),
      currencies,
      exchangeRates,
      exchangeRateItems,
      exchangeRateHistory,
      branches,
      employees: users.map((u) => scrubSensitiveUserFields(u)),
      unitsOfMeasure: readScopedJson<any[]>('pos_uom', []),
      customFieldDefinitions: readScopedJson<any[]>('pos_custom_fields', []),
      categories: readScopedJson<any[]>('pos_categories', categoriesFromProducts),
      products,
      customers,
      suppliers: readScopedJson<any[]>('pos_suppliers', []),
      stockMovements,
      branchTransfers: readScopedJson<any[]>('pos_branch_transfers', []),
      purchases: readScopedJson<any[]>('pos_purchase_orders', []),
      transactions,
      expenses: readScopedJson<any[]>('pos_expenses', []),
      accounts: readScopedJson<any[]>('pos_accounts', []),
      journalEntries: readScopedJson<any[]>('pos_journal_entries', []),
      unmetDemandRequests,
      intelligenceLifecycleItems: [],
      auditLogs: [],
    };
  }, [
    currentCompany,
    settings,
    currencies,
    exchangeRates,
    exchangeRateItems,
    exchangeRateHistory,
    branches,
    users,
    products,
    customers,
    stockMovements,
    transactions,
    unmetDemandRequests,
  ]);

  const hydrateCompanyFromBackupPayload = useCallback(
    (
      payload: BackupPayloadV1,
      options?: { switchToNewCompany?: boolean; newOwner?: POSUser }
    ) => {
      if (!payload || !payload.companyProfile) return;
      const targetComp = payload.companyProfile;
      const targetCompId = targetComp.id;

      setWorkspaceMode('PRODUCTION');
      setCompanies((prev) => {
        const filtered = prev.filter((c) => c.id !== 'comp-default');
        const exists = filtered.some((c) => c.id === targetCompId);
        return exists
          ? filtered.map((c) => (c.id === targetCompId ? targetComp : c))
          : [...filtered, targetComp];
      });
      setCurrentCompanyId(targetCompId);

      if (Array.isArray(payload.branches) && payload.branches.length > 0) {
        setAllBranches((prev) => {
          const other = prev.filter((b) => b.companyId !== targetCompId);
          return [...other, ...payload.branches];
        });
        setActiveBranchId(payload.branches[0].id);
      }

      if (Array.isArray(payload.products)) setProducts(payload.products);
      if (Array.isArray(payload.transactions)) setTransactions(payload.transactions);
      if (Array.isArray(payload.customers)) setCustomers(payload.customers);
      if (Array.isArray(payload.stockMovements)) setStockMovements(payload.stockMovements);
      if (Array.isArray(payload.unmetDemandRequests)) {
        setUnmetDemandRequests(payload.unmetDemandRequests);
      }

      if (Array.isArray(payload.currencies)) {
        setCurrencies(payload.currencies);
        savePersistedCurrencies(payload.currencies);
      }
      if (payload.exchangeRates && typeof payload.exchangeRates === 'object') {
        setExchangeRates({ ...payload.exchangeRates, SDG: 1 });
        savePersistedExchangeRates({ ...payload.exchangeRates, SDG: 1 });
      }
      if (Array.isArray(payload.exchangeRateItems)) {
        setExchangeRateItems(payload.exchangeRateItems);
        savePersistedExchangeRateItems(payload.exchangeRateItems);
      }
      if (Array.isArray(payload.exchangeRateHistory)) {
        setExchangeRateHistory(payload.exchangeRateHistory);
      }

      if (payload.storeSettings) {
        setSettings((prev) => ({
          ...prev,
          ...payload.storeSettings,
          storeName:
            payload.storeSettings?.storeName ||
            targetComp.displayName ||
            targetComp.legalName,
          storeNameAr:
            payload.storeSettings?.storeNameAr ||
            targetComp.displayNameAr ||
            targetComp.displayName,
        }));
      }

      if (options?.newOwner) {
        const ownerRecord = options.newOwner;
        const otherEmployees = (payload.employees || [])
          .filter((e) => e.id !== ownerRecord.id && e.systemRole !== 'COMPANY_OWNER')
          .map((e) => ({
            ...e,
            pin: '0000',
          })) as POSUser[];
        setUsers([ownerRecord, ...otherEmployees]);
        setCurrentUserId(ownerRecord.id);
      } else if (Array.isArray(payload.employees) && payload.employees.length > 0) {
        setUsers((prev) => {
          const existingMap = new Map<string, POSUser>(prev.map((u) => [u.id, u]));
          const mergedUsers: POSUser[] = payload.employees.map((e) => {
            const ex = existingMap.get(e.id);
            return {
              ...(e as any),
              pin: ex?.pin || '1111',
            };
          });
          if (
            currentUser &&
            currentUser.id !== 'unassigned-operator' &&
            !mergedUsers.some((u) => u.id === currentUser.id)
          ) {
            mergedUsers.unshift(currentUser);
          }
          return mergedUsers;
        });
      }

      // Persist auxiliary modules in company-scoped localStorage
      try {
        if (payload.categories) {
          localStorage.setItem(
            getCompanyStorageKey('pos_categories', targetCompId),
            JSON.stringify(payload.categories)
          );
        }
        if (payload.suppliers) {
          localStorage.setItem(
            getCompanyStorageKey('pos_suppliers', targetCompId),
            JSON.stringify(payload.suppliers)
          );
        }
        if (payload.purchases) {
          localStorage.setItem(
            getCompanyStorageKey('pos_purchase_orders', targetCompId),
            JSON.stringify(payload.purchases)
          );
        }
        if (payload.expenses) {
          localStorage.setItem(
            getCompanyStorageKey('pos_expenses', targetCompId),
            JSON.stringify(payload.expenses)
          );
        }
        if (payload.accounts) {
          localStorage.setItem(
            getCompanyStorageKey('pos_accounts', targetCompId),
            JSON.stringify(payload.accounts)
          );
        }
        if (payload.journalEntries) {
          localStorage.setItem(
            getCompanyStorageKey('pos_journal_entries', targetCompId),
            JSON.stringify(payload.journalEntries)
          );
        }
      } catch {}

      setCart([]);
      setSelectedCustomer(null);
      setIsOnboardingModalOpen(false);
      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
    },
    [currentUser, settings.soundEnabled, settings.hapticsEnabled, setActiveBranchId]
  );

  const value: POSContextType = {
    products,
    cart,
    transactions,
    customers,
    stockMovements,
    settings,
    currencies,
    exchangeRates,
    exchangeRateItems,
    exchangeRateHistory,
    activeTab,
    setActiveTab,
    selectedCustomer,
    setSelectedCustomer,
    globalDiscountPercent,
    setGlobalDiscountPercent,
    globalDiscountAmount,
    setGlobalDiscountAmount,
    cartTotals,
    workspaceMode,
    currentCompany,
    companies,
    branches,
    activeBranchId,
    setActiveBranchId,
    enterPracticeMode,
    exitPracticeMode,
    resetPracticeModeData,
    createNewCompanyWorkspace,
    switchCompanyWorkspace,
    isOnboardingModalOpen,
    onboardingModalInitialView,
    openOnboardingModal,
    closeOnboardingModal,
    createBranch,
    updateBranch,
    deleteBranch,
    onboardingChecklist,
    users,
    activeSessions,
    currentUser,
    switchCurrentUser,
    saveUser,
    removeUser,
    deleteUserAccount,
    clearAllUserAccounts,
    deactivateUserAccount,
    reactivateUserAccount,
    resetUserPasswordOrPin,
    toggleUserActiveSession,
    hasPermission,
    hasCapability,
    addToCart,
    setCartItemSaleUnit,
    updateCartQuantity,
    setCartItemDiscount,
    removeFromCart,
    clearCart,
    processCheckout,
    addProduct,
    updateProduct,
    deleteProduct,
    pendingNewProductBarcode,
    setPendingNewProductBarcode,
    openAddProductWithBarcode,
    recordStockAdjustment,
    recordGoodsReceipt,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    voidTransaction,
    settleTransactionDebt,
    updateTransactionFulfillment,
    applyNewRateToTransaction,
    applyNewRateToAllTransactions,
    lockTransactionSaleRate,
    updateSettings,
    saveCurrency,
    removeCurrency,
    clearAllCurrencies,
    setBaseCurrencyCode,
    syncCurrenciesState,
    updateExchangeRate,
    syncExchangeRatesState,
    resetAllData,
    executeAuthorizedFactoryReset,
    collectClientBackupDataset,
    hydrateCompanyFromBackupPayload,
    syncTransactions,
    isSyncing,
    lastSyncedAt,
    isTrainingTourOpen,
    trainingTourStepIndex,
    trainingTourProgress,
    startTrainingTour,
    closeTrainingTour,
    nextTrainingTourStep,
    prevTrainingTourStep,
    selectTrainingTourStep,
    finishTrainingTour,
    resetTrainingTour,
    unmetDemandRequests,
    recordUnmetDemandRequest,
    isUnmetDemandModalOpen,
    unmetDemandModalInitialData,
    openUnmetDemandModal,
    closeUnmetDemandModal,
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
};

export function usePOS() {
  const context = useContext(POSContext);
  if (!context) {
    throw new Error('usePOS must be used within a POSProvider');
  }
  return context;
}
