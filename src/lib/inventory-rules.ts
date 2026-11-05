/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Product,
  ProductModificationEntry,
  ProductPriceHistoryEntry,
  StockMovementType,
} from './types';

/**
 * Checks if product has sufficient stock for requested quantity.
 */
export function checkStockAvailability(
  product: Pick<Product, 'stock'>,
  requestedQuantity: number
): { available: boolean; remainingAfterSale: number } {
  if (requestedQuantity <= 0) {
    return { available: false, remainingAfterSale: product.stock };
  }
  const remaining = product.stock - requestedQuantity;
  return {
    available: remaining >= 0,
    remainingAfterSale: remaining,
  };
}

/**
 * Calculates updated stock quantity based on stock movement type and quantity delta.
 */
export function calculateStockAdjustment(
  currentStock: number,
  type: StockMovementType,
  amount: number
): number {
  const safeAmount = Math.max(0, Math.floor(amount));
  switch (type) {
    case 'sale':
    case 'damage':
    case 'loss':
      return Math.max(0, currentStock - safeAmount);
    case 'restock':
      return currentStock + safeAmount;
    case 'audit':
      return safeAmount;
    default:
      return currentStock;
  }
}

/**
 * Checks if product is at or below its low stock alert threshold.
 */
export function isLowStock(stock: number, minStockAlert: number = 5): boolean {
  return stock <= minStockAlert;
}

/**
 * Generates an audit-safe transaction reference ID.
 */
export function generateTransactionId(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TXN-${y}${m}${d}-${rand}`;
}

/**
 * Generates a valid 12-digit EAN/UPC-like barcode ONLY when explicitly requested by the user.
 */
export function generateBarcode(): string {
  let code = '200'; // In-store prefix
  for (let i = 0; i < 9; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

/**
 * Generates an idempotency key to prevent duplicate checkout requests.
 */
export function generateIdempotencyKey(): string {
  return `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Normalizes a primary barcode and optional additional barcodes into a deduplicated array
 * where the first item is always the primary barcode.
 */
export function normalizeProductBarcodes(
  primaryBarcode?: string | null,
  extraBarcodes?: string[] | null
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const addCode = (raw?: string | null) => {
    if (!raw || typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  };

  addCode(primaryBarcode);
  if (Array.isArray(extraBarcodes)) {
    for (const code of extraBarcodes) {
      addCode(code);
    }
  }
  return result;
}

/**
 * Returns all barcodes associated with a product (primary + any secondary barcodes in barcodes or customFields).
 */
export function getAllProductBarcodes(
  product: Pick<Product, 'barcode' | 'barcodes' | 'customFields'>
): string[] {
  const extra = product.barcodes || product.customFields?.barcodes || [];
  return normalizeProductBarcodes(product.barcode, extra);
}

/**
 * Checks whether a search query or scanned code matches a product's primary barcode or any secondary barcode.
 */
export function matchesProductBarcode(
  product: Pick<Product, 'barcode' | 'barcodes' | 'customFields'>,
  queryOrCode: string,
  exact: boolean = false
): boolean {
  const clean = queryOrCode.trim();
  if (!clean) return false;
  const allCodes = getAllProductBarcodes(product);
  if (exact) {
    return allCodes.some((c) => c === clean);
  }
  return allCodes.some((c) => c.toLowerCase().includes(clean.toLowerCase()));
}

export interface ScannedBarcodeResolution {
  ok: boolean;
  code: string;
  primaryBarcode: string;
  additionalBarcodes: string[];
  errorEn?: string;
  errorAr?: string;
}

/**
 * Resolves a barcode scanned via camera (or captured from image) into a product's primary or additional barcode list,
 * checking for duplicates and conflicts with other products.
 * IMPORTANT: Never auto-generates a barcode if scannedCode is empty.
 */
export function resolveScannedProductBarcode(params: {
  scannedCode?: string;
  target: 'primary' | 'additional';
  currentPrimary: string;
  currentAdditional: string[];
  existingProducts: Pick<Product, 'id' | 'name' | 'nameAr' | 'barcode' | 'barcodes' | 'customFields'>[];
  editingProductId?: string | null;
}): ScannedBarcodeResolution {
  const code = (params.scannedCode || '').trim();
  if (!code) {
    return {
      ok: false,
      code: '',
      primaryBarcode: params.currentPrimary,
      additionalBarcodes: params.currentAdditional,
      errorEn: 'No barcode was detected or entered. Point the camera at a clear barcode or click Generate Barcode explicitly.',
      errorAr: 'لم يتم قراءة أو إدخال أي باركود. يرجى توجيه الكاميرا نحو باركود واضح أو الضغط على زر توليد باركود يدوياً.',
    };
  }

  // Check if another product already owns this barcode
  const conflict = params.existingProducts.find(
    (p) => (!params.editingProductId || p.id !== params.editingProductId) && matchesProductBarcode(p, code, true)
  );
  if (conflict) {
    return {
      ok: false,
      code,
      primaryBarcode: params.currentPrimary,
      additionalBarcodes: params.currentAdditional,
      errorEn: `Barcode "${code}" is already assigned to "${conflict.name}".`,
      errorAr: `الباركود "${code}" مستخدم بالفعل للمنتج "${conflict.nameAr || conflict.name}".`,
    };
  }

  const allExisting = normalizeProductBarcodes(params.currentPrimary, params.currentAdditional);

  if (params.target === 'primary') {
    const nextAdditional = params.currentAdditional.filter((c) => c.trim() !== code);
    return {
      ok: true,
      code,
      primaryBarcode: code,
      additionalBarcodes: nextAdditional,
    };
  }

  // target === 'additional'
  if (!params.currentPrimary.trim()) {
    return {
      ok: true,
      code,
      primaryBarcode: code,
      additionalBarcodes: params.currentAdditional,
    };
  }

  if (allExisting.includes(code)) {
    return {
      ok: false,
      code,
      primaryBarcode: params.currentPrimary,
      additionalBarcodes: params.currentAdditional,
      errorEn: `Barcode "${code}" is already added to this product.`,
      errorAr: `الباركود "${code}" مضاف بالفعل لهذا المنتج.`,
    };
  }

  return {
    ok: true,
    code,
    primaryBarcode: params.currentPrimary,
    additionalBarcodes: [...params.currentAdditional, code],
  };
}

/**
 * Extracts or infers the sequential serial number of a product.
 */
export function getProductSerialNumber(
  product: Partial<Pick<Product, 'id' | 'serialNumber' | 'customFields'>>,
  fallbackIndex?: number
): number {
  const direct = Number(product.serialNumber ?? product.customFields?.serialNumber);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.floor(direct);
  }
  if (typeof product.id === 'string') {
    const match = product.id.match(/^prod-(\d+)$/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (parsed > 0 && parsed < 100000) {
        return parsed;
      }
    }
  }
  return fallbackIndex !== undefined && fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
}

/**
 * Formats a product serial number into a padded badge string (e.g. #0001).
 */
export function formatProductSerialNumber(serialNumber?: number | null): string {
  const safe = Number(serialNumber);
  if (!Number.isFinite(safe) || safe <= 0) return '#0001';
  return `#${String(Math.floor(safe)).padStart(4, '0')}`;
}

/**
 * Calculates the next sequential product serial number based on existing products.
 */
export function getNextProductSerialNumber(
  products: Array<Partial<Pick<Product, 'id' | 'serialNumber' | 'customFields'>>>
): number {
  if (!products || products.length === 0) return 1;
  let maxSerial = 0;
  products.forEach((p, idx) => {
    const s = getProductSerialNumber(p, idx);
    if (s > maxSerial) maxSerial = s;
  });
  return maxSerial + 1;
}

/**
 * Multi-word tokenized search across product Name (EN/AR), Description (EN/AR),
 * Sequential Serial Number (e.g. "1", "#1", "0001", "#0001"), SKU, Category, or any Barcode.
 */
export function matchesProductSearchQuery(
  product: Partial<Product>,
  query: string,
  fallbackIndex?: number
): boolean {
  const cleanQuery = (query || '').trim().toLowerCase();
  if (!cleanQuery) return true;

  const serial = getProductSerialNumber(product, fallbackIndex);
  const serialPlain = String(serial);
  const serialPadded3 = String(serial).padStart(3, '0');
  const serialPadded4 = String(serial).padStart(4, '0');
  const serialHashPlain = `#${serialPlain}`;
  const serialHashPadded3 = `#${serialPadded3}`;
  const serialHashPadded4 = `#${serialPadded4}`;

  const descEn = (product.description || product.customFields?.description || '').toString().toLowerCase();
  const descAr = (product.descriptionAr || product.customFields?.descriptionAr || '').toString().toLowerCase();
  const nameEn = (product.name || '').toLowerCase();
  const nameAr = (product.nameAr || '').toLowerCase();
  const sku = (product.sku || '').toLowerCase();
  const catEn = (product.category || '').toLowerCase();
  const catAr = (product.categoryAr || '').toLowerCase();
  const barcodes = getAllProductBarcodes({
    barcode: product.barcode || '',
    barcodes: product.barcodes,
    customFields: product.customFields,
  }).map((b) => b.toLowerCase());

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  return tokens.every((token) => {
    // Check serial number match (exact numeric token or #0001 prefix match)
    const strippedHash = token.startsWith('#') ? token.slice(1) : token;
    const isNumericToken = /^\d+$/.test(strippedHash);
    if (
      token === serialPlain ||
      token === serialPadded3 ||
      token === serialPadded4 ||
      token === serialHashPlain ||
      token === serialHashPadded3 ||
      token === serialHashPadded4 ||
      (isNumericToken && parseInt(strippedHash, 10) === serial)
    ) {
      return true;
    }

    if (nameEn.includes(token) || nameAr.includes(token)) return true;
    if (descEn.includes(token) || descAr.includes(token)) return true;
    if (sku.includes(token)) return true;
    if (catEn.includes(token) || catAr.includes(token)) return true;
    if (barcodes.some((code) => code.includes(token))) return true;

    return false;
  });
}

/**
 * Builds the price history and modification audit trail when creating or updating a product.
 */
export function buildProductAuditTrail(params: {
  existingProduct?: Product | null;
  nextProduct: Partial<Product>;
  changedBy?: string;
  nowIso?: string;
}): {
  createdAt: string;
  previousCostPrice?: number;
  previousSellingPrice?: number;
  priceUpdatedAt?: string;
  priceHistory: ProductPriceHistoryEntry[];
  modificationHistory: ProductModificationEntry[];
} {
  const now = params.nowIso || new Date().toISOString();
  const actor = params.changedBy || 'Main Terminal';
  const existing = params.existingProduct;
  const next = params.nextProduct;

  const nextCurrency = (
    next.priceCurrency ||
    next.customFields?.priceCurrency ||
    existing?.priceCurrency ||
    existing?.customFields?.priceCurrency ||
    'SDG'
  )
    .toString()
    .toUpperCase();

  const nextCost = Number(next.costPrice ?? existing?.costPrice ?? 0);
  const nextSell = Number(next.sellingPrice ?? existing?.sellingPrice ?? 0);

  if (!existing) {
    const initMod: ProductModificationEntry = {
      id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      action: 'created',
      summaryEn: `Product created with selling price ${nextSell} ${nextCurrency}`,
      summaryAr: `تمت إضافة المنتج بسعر بيع ${nextSell} ${nextCurrency}`,
      changedFields: ['created'],
      changedBy: actor,
    };
    const initPrice: ProductPriceHistoryEntry = {
      id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      previousCostPrice: nextCost,
      newCostPrice: nextCost,
      previousSellingPrice: nextSell,
      newSellingPrice: nextSell,
      currency: nextCurrency,
      changedBy: actor,
      note: 'Initial price / السعر الابتدائي',
    };
    return {
      createdAt: next.createdAt || now,
      previousCostPrice: undefined,
      previousSellingPrice: undefined,
      priceUpdatedAt: now,
      priceHistory: [initPrice],
      modificationHistory: [initMod],
    };
  }

  const prevPriceHistory: ProductPriceHistoryEntry[] =
    existing.priceHistory || existing.customFields?.priceHistory || [];
  const prevModHistory: ProductModificationEntry[] =
    existing.modificationHistory || existing.customFields?.modificationHistory || [];

  const oldCost = Number(existing.costPrice || 0);
  const oldSell = Number(existing.sellingPrice || 0);
  const costChanged = Math.abs(nextCost - oldCost) > 0.0001;
  const sellChanged = Math.abs(nextSell - oldSell) > 0.0001;
  const priceChanged = costChanged || sellChanged;

  const changedFields: string[] = [];
  const summaryPartsEn: string[] = [];
  const summaryPartsAr: string[] = [];

  if (next.name !== undefined && next.name !== existing.name) {
    changedFields.push('name');
    summaryPartsEn.push(`Name: "${existing.name}" → "${next.name}"`);
    summaryPartsAr.push(`الاسم: "${existing.name}" ← "${next.name}"`);
  }
  if (next.nameAr !== undefined && (next.nameAr || '') !== (existing.nameAr || '')) {
    changedFields.push('nameAr');
    summaryPartsEn.push(`Arabic Name updated`);
    summaryPartsAr.push(`تعديل الاسم العربي إلى "${next.nameAr}"`);
  }
  const oldDesc = existing.description || existing.customFields?.description || '';
  const newDesc = next.description ?? next.customFields?.description ?? oldDesc;
  if (newDesc !== oldDesc) {
    changedFields.push('description');
    summaryPartsEn.push(`Description updated`);
    summaryPartsAr.push(`تحديث وصف المنتج`);
  }
  if (sellChanged) {
    changedFields.push('sellingPrice');
    summaryPartsEn.push(`Selling Price: ${oldSell} → ${nextSell} ${nextCurrency}`);
    summaryPartsAr.push(`سعر البيع: ${oldSell} ← ${nextSell} ${nextCurrency}`);
  }
  if (costChanged) {
    changedFields.push('costPrice');
    summaryPartsEn.push(`Cost Price: ${oldCost} → ${nextCost} ${nextCurrency}`);
    summaryPartsAr.push(`سعر التكلفة: ${oldCost} ← ${nextCost} ${nextCurrency}`);
  }
  if (next.stock !== undefined && Number(next.stock) !== Number(existing.stock)) {
    changedFields.push('stock');
    summaryPartsEn.push(`Stock: ${existing.stock} → ${next.stock}`);
    summaryPartsAr.push(`المخزون: ${existing.stock} ← ${next.stock}`);
  }
  const oldCodes = getAllProductBarcodes(existing).join(',');
  const newCodes = normalizeProductBarcodes(
    next.barcode !== undefined ? next.barcode : existing.barcode,
    next.barcodes !== undefined ? next.barcodes : existing.barcodes
  ).join(',');
  if (oldCodes !== newCodes) {
    changedFields.push('barcode');
    summaryPartsEn.push(`Barcodes updated (${newCodes || 'cleared'})`);
    summaryPartsAr.push(`تحديث الباركود (${newCodes || 'بدون باركود'})`);
  }
  if (next.sku !== undefined && next.sku !== existing.sku) {
    changedFields.push('sku');
    summaryPartsEn.push(`SKU: ${existing.sku} → ${next.sku}`);
    summaryPartsAr.push(`رمز SKU: ${existing.sku} ← ${next.sku}`);
  }

  let nextPriceHistory = [...prevPriceHistory];
  let previousCostPrice = existing.previousCostPrice ?? existing.customFields?.previousCostPrice;
  let previousSellingPrice = existing.previousSellingPrice ?? existing.customFields?.previousSellingPrice;
  let priceUpdatedAt = existing.priceUpdatedAt ?? existing.customFields?.priceUpdatedAt;

  if (priceChanged) {
    previousCostPrice = oldCost;
    previousSellingPrice = oldSell;
    priceUpdatedAt = now;
    const priceEntry: ProductPriceHistoryEntry = {
      id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      previousCostPrice: oldCost,
      newCostPrice: nextCost,
      previousSellingPrice: oldSell,
      newSellingPrice: nextSell,
      currency: nextCurrency,
      changedBy: actor,
    };
    nextPriceHistory = [priceEntry, ...prevPriceHistory].slice(0, 30);
  }

  let nextModHistory = [...prevModHistory];
  if (changedFields.length > 0) {
    const modEntry: ProductModificationEntry = {
      id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      action: priceChanged
        ? 'price_changed'
        : changedFields.includes('barcode')
        ? 'barcode_changed'
        : 'updated',
      summaryEn: summaryPartsEn.join(' • ') || 'Product details updated',
      summaryAr: summaryPartsAr.join(' • ') || 'تم تعديل بيانات المنتج',
      changedFields,
      changedBy: actor,
    };
    nextModHistory = [modEntry, ...prevModHistory].slice(0, 40);
  }

  return {
    createdAt: existing.createdAt || existing.customFields?.createdAt || now,
    previousCostPrice,
    previousSellingPrice,
    priceUpdatedAt,
    priceHistory: nextPriceHistory,
    modificationHistory: nextModHistory,
  };
}


