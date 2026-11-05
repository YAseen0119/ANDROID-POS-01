/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 (Phase B): Customer Demand Intelligence (Unmet Demand)
 * Pure Data Model, Input Validation, Server-Side RBAC Binding & Deduplication Logic
 */

import { POSUser, Product, ProductSaleUnitMode, SupportedCurrency } from '../lib/types';
import { resolveAnalyticsUserContext } from './analytics.permissions';

export const SUPPORTED_UNAVAILABILITY_REASONS = [
  'OUT_OF_STOCK',
  'EXPIRED',
  'NOT_STOCKED',
  'TEMPORARILY_UNAVAILABLE',
  'OTHER',
] as const;

export type UnavailabilityReason = (typeof SUPPORTED_UNAVAILABILITY_REASONS)[number];

export type AvailabilityStatusAtRequest =
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_QUANTITY'
  | 'EXPIRED'
  | 'UNREGISTERED'
  | 'TEMPORARILY_UNAVAILABLE';

export type UnmetDemandFulfillmentStatus =
  | 'unfulfilled'
  | 'fulfilled_later'
  | 'cancelled';

export interface UnmetDemandRequestInput {
  idempotencyKey?: string;
  productId?: string | null;
  isRegisteredProduct?: boolean;
  productName?: string;
  productNameSnapshot?: string;
  productNameAr?: string | null;
  productNameArSnapshot?: string | null;
  skuSnapshot?: string | null;
  barcode?: string | null;
  category?: string;
  categorySnapshot?: string;
  branchId?: string | null;
  requestedTimestamp?: string;
  requestedQuantity?: number;
  saleUnitMode?: ProductSaleUnitMode;
  unavailabilityReason?: UnavailabilityReason | string;
  confirmedPurchaseIntent?: boolean;
  customerId?: string | null;
  customerReference?: string | null;
  notes?: string | null;
  sourceScreen?: 'checkout' | 'products' | 'analytics' | string;
  recordedByUserId?: string;
  allowRapidRepeat?: boolean;
}

export interface UnmetDemandRequestRecord {
  id: string;
  idempotencyKey: string;
  dedupeFingerprint: string;
  productId: string | null;
  isRegisteredProduct: boolean;
  productNameSnapshot: string;
  productNameArSnapshot: string | null;
  skuSnapshot: string | null;
  barcode: string | null;
  categorySnapshot: string;
  branchId: string;
  terminalName?: string;
  requestedTimestamp: string;
  requestedQuantity: number;
  saleUnitMode: ProductSaleUnitMode;
  packConversionFactor?: number;
  requestedBaseUnits: number;
  availableStockAtRequest: number | null;
  availabilityStatus: AvailabilityStatusAtRequest;
  unavailabilityReason: UnavailabilityReason;
  confirmedPurchaseIntent: boolean;
  fulfillmentStatus: UnmetDemandFulfillmentStatus;
  customerId: string | null;
  customerReference: string | null;
  unitSellingPriceSnapshot: number | null;
  unitCostPriceSnapshot?: number | null;
  unitCostSnapshot?: number | null;
  currencySnapshot: SupportedCurrency;
  exchangeRateSnapshot?: number;
  notes: string | null;
  sourceScreen?: 'checkout' | 'products' | 'analytics' | string;
  recordedByUserId: string;
  recordedByUserNameSnapshot?: string;
  recordedByRoleSnapshot?: string;
  recordedByName?: string;
  createdAt: string;
}

export interface UnmetDemandValidationResult {
  valid: boolean;
  ok: boolean;
  statusCode: 201 | 400 | 401 | 403 | 409;
  isDuplicateRapidSubmission?: boolean;
  errorCode?:
    | 'UNAUTHENTICATED_USER'
    | 'INVALID_REASON'
    | 'INVALID_QUANTITY'
    | 'MISSING_PRODUCT_IDENTITY'
    | 'UNREGISTERED_PRODUCT_ID_NOT_FOUND'
    | 'DUPLICATE_IDEMPOTENCY_KEY'
    | 'DUPLICATE_RAPID_SUBMISSION';
  errorMessage?: string;
  errorMessageAr?: string;
  errorEn?: string;
  errorAr?: string;
  record?: UnmetDemandRequestRecord;
}

const RAPID_DEDUPE_WINDOW_MS = 60 * 1000; // 60 seconds accidental double-tap guard

function sanitizeText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Generates a deterministic fingerprint for 60-second accidental duplicate detection.
 * Separate customers or requests separated by >60s are preserved as distinct inquiries.
 */
export function buildUnmetDemandDedupeFingerprint(params: {
  branchId: string;
  recordedByUserId: string;
  productId: string | null;
  barcode: string | null;
  productNameSnapshot: string;
  unavailabilityReason: UnavailabilityReason;
  requestedQuantity: number;
  saleUnitMode: ProductSaleUnitMode;
  customerId: string | null;
  customerReference: string | null;
}): string {
  const itemKey = (
    params.productId ||
    params.barcode ||
    params.productNameSnapshot.toLowerCase().replace(/\s+/g, ' ')
  ).trim();
  const custKey = (params.customerId || params.customerReference || 'walk_in')
    .trim()
    .toLowerCase();
  return [
    params.branchId,
    params.recordedByUserId,
    itemKey,
    params.unavailabilityReason,
    `${params.requestedQuantity}:${params.saleUnitMode}`,
    custKey,
  ].join('|');
}

export interface UnmetDemandValidationParams {
  input: Partial<UnmetDemandRequestInput>;
  claimingUserId?: string;
  serverUsers: POSUser[];
  catalogProducts: Product[];
  existingRequests: UnmetDemandRequestRecord[];
  exchangeRates?: Record<string, number>;
  now?: Date;
}

export interface UnmetDemandValidationContextLegacy {
  authenticatedUser?: POSUser | null;
  products: Product[];
  existingRequests: UnmetDemandRequestRecord[];
  activeCurrency?: SupportedCurrency;
  exchangeRates?: Record<string, number>;
  now?: Date;
}

function makeErrorResult(
  statusCode: 400 | 401 | 403 | 409,
  errorCode: NonNullable<UnmetDemandValidationResult['errorCode']>,
  errorMessage: string,
  errorMessageAr: string,
  isDuplicateRapidSubmission = false
): UnmetDemandValidationResult {
  return {
    valid: false,
    ok: false,
    statusCode,
    isDuplicateRapidSubmission,
    errorCode,
    errorMessage,
    errorMessageAr,
    errorEn: errorMessage,
    errorAr: errorMessageAr,
  };
}

/**
 * Pure, deterministic validator and normalizer for Customer Demand Capture (Part 4A & 4B).
 * Supports both single-object `(params)` and two-argument `(input, context)` invocation styles.
 */
export function validateAndBuildUnmetDemandRequest(
  paramsOrInput: UnmetDemandValidationParams | Partial<UnmetDemandRequestInput>,
  legacyContext?: UnmetDemandValidationContextLegacy
): UnmetDemandValidationResult {
  const normalizedParams: UnmetDemandValidationParams = legacyContext
    ? {
        input: paramsOrInput as Partial<UnmetDemandRequestInput>,
        claimingUserId: legacyContext.authenticatedUser?.id,
        serverUsers: legacyContext.authenticatedUser ? [legacyContext.authenticatedUser] : [],
        catalogProducts: legacyContext.products,
        existingRequests: legacyContext.existingRequests,
        exchangeRates: legacyContext.exchangeRates,
        now: legacyContext.now,
      }
    : (paramsOrInput as UnmetDemandValidationParams);

  const {
    input,
    claimingUserId,
    serverUsers,
    catalogProducts,
    existingRequests,
    exchangeRates = { SDG: 1, USD: 2700 },
    now = new Date(),
  } = normalizedParams;

  // 1. Server-side authentication & user resolution (never trust client role or branch)
  const cleanUserId = sanitizeText(claimingUserId, 64);
  if (!cleanUserId) {
    return makeErrorResult(
      401,
      'UNAUTHENTICATED_USER',
      'Authentication required: recording employee ID is missing.',
      'يلزم تسجيل الدخول: معرف الموظف المسجل للطلب مفقود.'
    );
  }

  const userContext = resolveAnalyticsUserContext({ userId: cleanUserId }, serverUsers);
  if (!userContext.roleVerifiedFromServerStore) {
    return makeErrorResult(
      401,
      'UNAUTHENTICATED_USER',
      `Authentication failed: user "${cleanUserId}" is not recognized in the server user directory.`,
      `فشل التحقق من الهوية: المستخدم "${cleanUserId}" غير مسجل في دليل موظفي النظام.`
    );
  }

  // 2. Validate unavailability reason
  const rawReason = sanitizeText(input.unavailabilityReason || 'OUT_OF_STOCK', 40).toUpperCase();
  if (!SUPPORTED_UNAVAILABILITY_REASONS.includes(rawReason as UnavailabilityReason)) {
    return makeErrorResult(
      400,
      'INVALID_REASON',
      `Invalid unavailability reason "${rawReason}". Supported: ${SUPPORTED_UNAVAILABILITY_REASONS.join(', ')}.`,
      'سبب عدم التوفر غير صالح. يرجى اختيار سبب معتمد.'
    );
  }
  const unavailabilityReason = rawReason as UnavailabilityReason;

  // 3. Validate requested quantity (default 1 when omitted)
  const rawQty =
    input.requestedQuantity === undefined || input.requestedQuantity === null
      ? 1
      : Number(input.requestedQuantity);
  if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty) || rawQty < 1 || rawQty > 10000) {
    return makeErrorResult(
      400,
      'INVALID_QUANTITY',
      'Requested quantity must be a whole number between 1 and 10,000.',
      'يجب أن تكون الكمية المطلوبة عدداً صحيحاً موجباً بين 1 و 10,000.'
    );
  }
  const requestedQuantity = rawQty;

  // 4. Resolve registered product vs. unregistered product request
  const cleanProductId =
    input.isRegisteredProduct === false ? null : sanitizeText(input.productId, 100) || null;
  const cleanBarcode = sanitizeText(input.barcode, 64) || null;
  let matchedProduct: Product | undefined;

  if (cleanProductId) {
    matchedProduct = catalogProducts.find((p) => p.id === cleanProductId);
    if (!matchedProduct) {
      return makeErrorResult(
        400,
        'UNREGISTERED_PRODUCT_ID_NOT_FOUND',
        `Product ID "${cleanProductId}" does not exist in the catalog. Omit productId for unregistered product requests.`,
        `معرف المنتج "${cleanProductId}" غير موجود في الكتالوج. لتسجيل منتج غير مسجل، اترك معرف المنتج فارغاً.`
      );
    }
  } else if (
    cleanBarcode &&
    unavailabilityReason !== 'NOT_STOCKED' &&
    input.isRegisteredProduct !== false
  ) {
    matchedProduct = catalogProducts.find(
      (p) =>
        p.barcode === cleanBarcode ||
        (Array.isArray(p.barcodes) && p.barcodes.includes(cleanBarcode))
    );
  }

  const isRegisteredProduct = Boolean(matchedProduct);
  const rawProvidedName = input.productName || input.productNameSnapshot;
  const rawProvidedNameAr = input.productNameAr || input.productNameArSnapshot;
  const rawProvidedCategory = input.category || input.categorySnapshot;

  const productNameSnapshot = matchedProduct
    ? matchedProduct.name
    : sanitizeText(rawProvidedName, 160);
  const productNameArSnapshot = matchedProduct
    ? matchedProduct.nameAr || null
    : sanitizeText(rawProvidedNameAr, 160) || null;

  if (!productNameSnapshot && !cleanBarcode) {
    return makeErrorResult(
      400,
      'MISSING_PRODUCT_IDENTITY',
      'A product selection, descriptive product name, or barcode is required.',
      'يرجى تحديد منتج من الكتالوج أو إدخال اسم وصفي أو باركود للمنتج المطلوب.'
    );
  }

  const finalProductName = productNameSnapshot || `Unregistered Barcode (${cleanBarcode})`;
  const saleUnitMode: ProductSaleUnitMode =
    input.saleUnitMode === 'pack' &&
    matchedProduct?.enablePackaging &&
    (matchedProduct?.unitsPerPack ?? 1) > 1
      ? 'pack'
      : 'unit';
  const unitsPerPack =
    saleUnitMode === 'pack' && matchedProduct?.unitsPerPack && matchedProduct.unitsPerPack > 1
      ? matchedProduct.unitsPerPack
      : 1;
  const requestedBaseUnits = requestedQuantity * unitsPerPack;

  // 5. Determine availability status at the time of request without fabricating missing stock
  const availableStockAtRequest = matchedProduct ? matchedProduct.stock : null;
  let availabilityStatus: AvailabilityStatusAtRequest;
  if (!isRegisteredProduct || unavailabilityReason === 'NOT_STOCKED') {
    availabilityStatus = 'UNREGISTERED';
  } else if (unavailabilityReason === 'EXPIRED') {
    availabilityStatus = 'EXPIRED';
  } else if (unavailabilityReason === 'TEMPORARILY_UNAVAILABLE') {
    availabilityStatus = 'TEMPORARILY_UNAVAILABLE';
  } else if (availableStockAtRequest !== null && availableStockAtRequest <= 0) {
    availabilityStatus = 'OUT_OF_STOCK';
  } else if (availableStockAtRequest !== null && availableStockAtRequest < requestedBaseUnits) {
    availabilityStatus = 'INSUFFICIENT_QUANTITY';
  } else {
    availabilityStatus = 'OUT_OF_STOCK';
  }

  // 6. Enforce branch scoping on the server
  const requestedBranch = sanitizeText(input.branchId, 64);
  const effectiveBranchId = userContext.canViewAllBranches
    ? requestedBranch && requestedBranch !== 'all'
      ? requestedBranch
      : userContext.assignedBranchId || 'branch-main'
    : userContext.assignedBranchId || 'branch-main';

  const effectiveTerminalName = userContext.assignedTerminalName || 'Main Terminal';

  // 7. Validate timestamp
  let reqDate = now;
  if (input.requestedTimestamp) {
    const parsed = new Date(input.requestedTimestamp);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime() + 5 * 60 * 1000) {
      reqDate = parsed;
    }
  }

  const customerId = sanitizeText(input.customerId, 64) || null;
  const customerReference = sanitizeText(input.customerReference, 100) || null;
  const notes = sanitizeText(input.notes, 500) || null;

  const dedupeFingerprint = buildUnmetDemandDedupeFingerprint({
    branchId: effectiveBranchId,
    recordedByUserId: userContext.userId,
    productId: matchedProduct ? matchedProduct.id : null,
    barcode: cleanBarcode || (matchedProduct ? matchedProduct.barcode : null),
    productNameSnapshot: finalProductName,
    unavailabilityReason,
    requestedQuantity,
    saleUnitMode,
    customerId,
    customerReference,
  });

  // 8. Check idempotency key & 60-second accidental duplicate submission window
  const idempotencyKey =
    sanitizeText(input.idempotencyKey, 100) ||
    `udr-idem-${reqDate.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

  for (const existing of existingRequests) {
    if (existing.idempotencyKey === idempotencyKey) {
      return makeErrorResult(
        409,
        'DUPLICATE_IDEMPOTENCY_KEY',
        'Duplicate submission: this request idempotency key has already been recorded.',
        'تم تسجيل هذا الطلب مسبقاً (مفتاح عدم التكرار مطابق).',
        true
      );
    }

    if (!input.allowRapidRepeat && existing.dedupeFingerprint === dedupeFingerprint) {
      const existingMs = new Date(existing.requestedTimestamp).getTime();
      const deltaMs = Math.abs(reqDate.getTime() - existingMs);
      if (deltaMs <= RAPID_DEDUPE_WINDOW_MS) {
        return makeErrorResult(
          409,
          'DUPLICATE_RAPID_SUBMISSION',
          'Duplicate submission prevented: an identical inquiry was logged by you within the last 60 seconds.',
          'تم منع التكرار غير المقصود: تم تسجيل نفس الاستفسار خلال آخر 60 ثانية.',
          true
        );
      }
    }
  }

  // 9. Price & Currency Snapshot (read-only snapshot for valuation; never fabricates unknown prices)
  const currencySnapshot: SupportedCurrency = matchedProduct?.priceCurrency || 'SDG';
  const rateSnapshot =
    currencySnapshot === 'SDG'
      ? 1
      : Number(exchangeRates[currencySnapshot]) > 0
      ? Number(exchangeRates[currencySnapshot])
      : 1;

  const unitSellingPriceSnapshot = matchedProduct
    ? saleUnitMode === 'pack' &&
      matchedProduct.packSellingPrice &&
      matchedProduct.packSellingPrice > 0
      ? matchedProduct.packSellingPrice
      : matchedProduct.sellingPrice
    : null;

  const unitCostPriceSnapshot = matchedProduct
    ? saleUnitMode === 'pack' && matchedProduct.packCostPrice && matchedProduct.packCostPrice > 0
      ? matchedProduct.packCostPrice
      : matchedProduct.costPrice > 0
      ? matchedProduct.costPrice
      : null
    : null;

  const record: UnmetDemandRequestRecord = {
    id: `UDR-${reqDate.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`,
    idempotencyKey,
    dedupeFingerprint,
    productId: matchedProduct ? matchedProduct.id : null,
    isRegisteredProduct,
    productNameSnapshot: finalProductName,
    productNameArSnapshot,
    skuSnapshot: matchedProduct ? matchedProduct.sku : null,
    barcode: cleanBarcode || (matchedProduct ? matchedProduct.barcode : null),
    categorySnapshot: matchedProduct
      ? matchedProduct.category
      : sanitizeText(rawProvidedCategory, 80) || 'Unregistered',
    branchId: effectiveBranchId,
    terminalName: effectiveTerminalName,
    requestedTimestamp: reqDate.toISOString(),
    requestedQuantity,
    saleUnitMode,
    packConversionFactor: unitsPerPack,
    requestedBaseUnits,
    availableStockAtRequest,
    availabilityStatus,
    unavailabilityReason,
    confirmedPurchaseIntent: Boolean(input.confirmedPurchaseIntent),
    fulfillmentStatus: 'unfulfilled',
    customerId,
    customerReference,
    unitSellingPriceSnapshot,
    unitCostPriceSnapshot,
    unitCostSnapshot: unitCostPriceSnapshot,
    currencySnapshot,
    exchangeRateSnapshot: rateSnapshot,
    notes,
    sourceScreen: input.sourceScreen || 'checkout',
    recordedByUserId: userContext.userId,
    recordedByName: userContext.userName,
    recordedByUserNameSnapshot: userContext.userName,
    recordedByRoleSnapshot: userContext.role,
    createdAt: now.toISOString(),
  };

  return {
    valid: true,
    ok: true,
    statusCode: 201,
    isDuplicateRapidSubmission: false,
    record,
  };
}

/**
 * Redacts customer PII from unmet demand records when viewed by unauthorized roles
 * or exported in aggregate analytics (Part 4B & Part 8).
 */
export function redactUnmetDemandRecordForRole(
  record: UnmetDemandRequestRecord,
  canViewCustomerPII: boolean
): Omit<UnmetDemandRequestRecord, 'customerReference'> & { customerReference: string | null } {
  if (canViewCustomerPII) {
    return record;
  }
  return {
    ...record,
    customerReference: record.customerReference ? '[REDACTED]' : null,
  };
}
