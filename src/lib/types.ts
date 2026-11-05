/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProductSaleUnitMode = 'unit' | 'pack';
export type AllowedSaleUnitsMode = 'both' | 'unit_only' | 'pack_only';

export interface ProductPriceHistoryEntry {
  id: string;
  timestamp: string;
  previousCostPrice: number;
  newCostPrice: number;
  previousSellingPrice: number;
  newSellingPrice: number;
  currency: string;
  changedBy?: string;
  note?: string;
}

export interface ProductModificationEntry {
  id: string;
  timestamp: string;
  action: 'created' | 'updated' | 'price_changed' | 'barcode_changed' | 'stock_changed';
  summaryEn: string;
  summaryAr: string;
  changedFields: string[];
  changedBy?: string;
}

export type UserRole = 'admin' | 'manager' | 'cashier' | 'inventory_clerk';

export type WorkspaceMode = 'PRODUCTION' | 'PRACTICE';

export interface RolePermissions {
  canCheckout: boolean;
  canManageProducts: boolean;
  canEditPrices: boolean;
  canManageInventory: boolean;
  canVoidTransactions: boolean;
  canManageExchangeRates: boolean;
  canViewReports: boolean;
  canManageUsers: boolean;
  canApplyDiscounts: boolean;
}

export interface POSUser {
  id: string;
  companyId?: string;
  username?: string;
  email?: string;
  phone?: string;
  name: string;
  nameAr?: string;
  role: UserRole;
  systemRole?: string; // 'COMPANY_OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'INVENTORY_MANAGER' | 'ACCOUNTANT' | 'PURCHASING_MANAGER' | 'REPORT_VIEWER' | 'CUSTOM_ROLE'
  capabilities?: string[];
  branchId?: string;
  assignedBranchIds?: string[];
  pin?: string;
  hasPassword?: boolean;
  mustChangePassword?: boolean;
  terminalName: string;
  terminalNameAr?: string;
  avatarColor: string;
  isActive: boolean;
  permissions: RolePermissions;
  lastActiveAt: string;
  lastLoginAt?: string | null;
  deactivatedAt?: string | null;
  deactivatedBy?: string | null;
  deactivationReason?: string | null;
}

export interface ActiveUserSession {
  sessionId: string;
  userId: string;
  companyId?: string;
  workspaceMode?: WorkspaceMode;
  userName: string;
  userNameAr?: string;
  role: UserRole;
  systemRole?: string;
  branchId?: string;
  terminalName: string;
  terminalNameAr?: string;
  startedAt: string;
  lastPingAt: string;
  status: 'online' | 'busy' | 'idle';
}

export interface BranchRecord {
  id: string;
  companyId: string;
  name: string;
  nameAr?: string;
  code: string;
  city?: string;
  address?: string;
  phone?: string;
  managerUserId?: string | null;
  isMain?: boolean;
  isMainBranch?: boolean;
  isActive: boolean;
  createdAt?: string;
}

export interface CompanyProfile {
  id: string;
  code?: string;
  legalName: string;
  displayName: string;
  displayNameAr?: string;
  businessType: string;
  logoUrl?: string | null;
  country: string;
  city?: string;
  address?: string;
  addressAr?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  defaultLanguage: AppLanguage;
  defaultTimezone?: string;
  timezone?: string;
  baseCurrency: SupportedCurrency;
  secondaryCurrencies?: string[];
  currencyDisplayFormat?: 'symbol_amount' | 'code_amount' | 'amount_symbol';
  fiscalYearStartMonth: number;
  rateUpdatePolicy?: 'owner_only' | 'admin_only' | 'admin_or_manager';
  exchangeRatePolicy?: 'manual_daily' | 'locked_per_shift' | 'flexible_cashier';
  isDemo?: boolean;
  isDemoPractice?: boolean;
  setupCompleted?: boolean;
  onboardingCompleted?: boolean;
  ownerUserId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface OnboardingChecklistStatus {
  companyProfileCompleted: boolean;
  companyProfileConfigured: boolean;
  currencyConfigured: boolean;
  currenciesConfigured: boolean;
  branchesCreated: boolean;
  branchCreated: boolean;
  productsAdded: boolean;
  firstProductsAdded: boolean;
  employeesAdded: boolean;
  firstEmployeeCreated: boolean;
  permissionsAssigned: boolean;
  firstSaleCompleted: boolean;
  openingInventoryConfigured: boolean;
  inventoryReviewed: boolean;
  guidedTourCompleted: boolean;
  completedCount: number;
  totalCount: number;
  completionPercent: number;
}

export interface Product {
  id: string;
  companyId?: string;
  branchId?: string;
  categoryId?: string;
  serialNumber?: number;
  name: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  sku: string;
  barcode: string;
  barcodes?: string[];
  category: string;
  categoryAr?: string;
  costPrice: number;
  sellingPrice: number;
  previousCostPrice?: number;
  previousSellingPrice?: number;
  priceUpdatedAt?: string;
  priceHistory?: ProductPriceHistoryEntry[];
  modificationHistory?: ProductModificationEntry[];
  priceCurrency?: SupportedCurrency;
  stock: number;
  minStockAlert: number;
  // Multi-Unit / Pack & Strip Packaging customization
  enablePackaging?: boolean;
  unitName?: string; // e.g. 'Strip', 'Piece'
  unitNameAr?: string; // e.g. 'شريط', 'قطعة'
  packName?: string; // e.g. 'Pack', 'Box', 'Carton'
  packNameAr?: string; // e.g. 'باكو', 'كرتون', 'دستة'
  unitsPerPack?: number; // e.g. 8 strips per pack
  defaultSaleUnit?: ProductSaleUnitMode; // 'unit' or 'pack'
  allowedSaleUnits?: AllowedSaleUnitsMode; // 'both', 'unit_only', 'pack_only'
  packCostPrice?: number;
  packSellingPrice?: number;
  image?: string;
  imageUrl?: string | null;
  emoji?: string;
  colorHex?: string;
  customFields?: Record<string, any>;
  createdAt?: string;
  updatedAt: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  itemDiscountPercent: number; // 0 to 100
  selectedSaleUnit?: ProductSaleUnitMode; // 'unit' (شريط/قطعة) or 'pack' (باكو)
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'qr_nfc' | 'card';

export type PaymentSettlementStatus = 'paid' | 'partial' | 'unpaid';

export type InvoiceFulfillmentType =
  | 'goods_and_invoice'
  | 'invoice_only'
  | 'goods_only';

export type InvoiceFulfillmentStatus = 'received' | 'pending_goods' | 'pending_invoice';

export interface DebtSettlementPayment {
  id: string;
  timestamp: string;
  amountPaid: number;
  remainingDebtAfter: number;
  paymentMethod: PaymentMethod;
  transferReference?: string;
  receiptImages?: string[];
  note?: string;
}

export interface DebtSettlementInput {
  amountPaidInDisplayCurrency?: number;
  customTotalPaidInDisplayCurrency?: number;
  displayCurrency?: SupportedCurrency;
  paymentMethod?: PaymentMethod;
  transferReference?: string;
  receiptImages?: string[];
  note?: string;
  useIndexedNewRate?: boolean;
  anchorCurrency?: string;
  customSaleExchangeRate?: number;
}

export interface CheckoutPaymentDetails {
  transferReference?: string;
  transferReceiptImage?: string;
  transferReceiptImages?: string[];
  paymentStatus?: PaymentSettlementStatus;
  amountPaid?: number;
  debtAmount?: number;
  fulfillmentType?: InvoiceFulfillmentType;
  fulfillmentStatus?: InvoiceFulfillmentStatus;
  exchangeRateUsed?: number;
  exchangeRatesSnapshot?: Record<string, number>;
}

export type SalesRateValuationMode = 'live' | 'indexed' | 'historical';

export interface Transaction {
  id: string; // e.g., TXN-20261029-4821
  idempotencyKey: string;
  timestamp: string;
  currency?: SupportedCurrency;
  exchangeRateUsed?: number;
  exchangeRatesSnapshot?: Record<string, number>;
  items: {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    total: number;
    saleUnit?: ProductSaleUnitMode;
    saleUnitLabel?: string;
    unitsPerPack?: number;
    stockDeducted?: number;
  }[];
  subtotal: number;
  taxRatePercent: number;
  taxAmount: number;
  discountAmount: number;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  amountTendered: number;
  changeDue: number;
  paymentStatus?: PaymentSettlementStatus;
  amountPaid?: number;
  debtAmount?: number;
  transferReference?: string;
  transferReceiptImage?: string;
  transferReceiptImages?: string[];
  debtPayments?: DebtSettlementPayment[];
  fulfillmentType?: InvoiceFulfillmentType;
  fulfillmentStatus?: InvoiceFulfillmentStatus;
  fulfilledAt?: string;
  customerId?: string;
  customerName?: string;
  cashierName: string;
  status: 'completed' | 'voided';
  syncStatus: 'synced' | 'pending_sync' | 'failed';
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  totalSpent: number;
  totalDebt?: number;
  transactionCount: number;
  loyaltyPoints: number;
  createdAt: string;
}

export type StockMovementType = 'sale' | 'restock' | 'damage' | 'loss' | 'audit';

export interface StockMovement {
  id: string;
  timestamp: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  quantityChange: number;
  previousStock: number;
  newStock: number;
  reason: string;
  referenceId?: string; // e.g. transaction ID or purchase invoice ID
  receiptMode?: 'goods_and_invoice' | 'goods_only' | 'invoice_only';
  supplierName?: string;
  invoiceNumber?: string;
  unitCost?: number;
  currency?: SupportedCurrency;
}

export interface GoodsReceiptInput {
  productId: string;
  quantity: number;
  receiptMode: 'goods_and_invoice' | 'goods_only' | 'invoice_only';
  supplierName?: string;
  invoiceNumber?: string;
  unitCost?: number;
  currency?: SupportedCurrency;
  updateProductCost?: boolean;
  notes?: string;
}

export type SupportedCurrency = 'SDG' | 'USD' | 'SAR' | 'AED' | 'EUR' | 'GBP' | (string & {});
export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'en' | 'ar';

export interface Currency {
  code: string;
  name: string;
  nameAr?: string | null;
  symbol: string;
  decimalPlaces: number;
  isBase: boolean;
  isActive: boolean;
}

export interface ExchangeRateItem {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  inverseRate: number;
  effectiveFrom: string;
  expiryDate?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  sourceSymbol?: string;
  targetSymbol?: string;
  sourceName?: string;
  targetName?: string;
}

export interface ExchangeRateHistoryEntry {
  id: string;
  currency: string;
  previousRate: number;
  newRate: number;
  changePercent: number;
  timestamp: string;
  note?: string;
}

export interface AppSettings {
  storeName: string;
  storeNameAr: string;
  storeLogo?: string;
  address: string;
  addressAr: string;
  storeAddress?: string;
  taxNumber: string;
  phone: string;
  storePhone?: string;
  receiptFooter: string;
  receiptFooterAr: string;
  currency: SupportedCurrency;
  exchangeRates?: Record<string, number>;
  taxRatePercent: number;
  isTaxInclusive: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  theme: AppTheme;
  language: AppLanguage;
}

export type AppNavTab =
  | 'dashboard'
  | 'checkout'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'sales'
  | 'reports'
  | 'settings';
