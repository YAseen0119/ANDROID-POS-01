/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './index.ts';
import { products, categories, stockMovements, productBarcodes } from './schema.ts';
import { eq, and, or, ilike, desc } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { INITIAL_PRODUCTS } from '../lib/initial-data.ts';
import {
  normalizeProductBarcodes,
  matchesProductBarcode,
  matchesProductSearchQuery,
  getProductSerialNumber,
  getNextProductSerialNumber,
  buildProductAuditTrail,
} from '../lib/inventory-rules.ts';
import { ProductModificationEntry, ProductPriceHistoryEntry } from '../lib/types.ts';

export interface ProductRecord {
  id: string;
  serialNumber?: number;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  sku: string;
  barcode: string;
  barcodes?: string[];
  categoryId?: string | null;
  category: string;
  categoryAr?: string | null;
  costPrice: number;
  sellingPrice: number;
  previousCostPrice?: number;
  previousSellingPrice?: number;
  priceUpdatedAt?: string;
  priceHistory?: ProductPriceHistoryEntry[];
  modificationHistory?: ProductModificationEntry[];
  priceCurrency?: string;
  stock: number;
  minStockAlert: number;
  image?: string;
  emoji?: string | null;
  colorHex?: string | null;
  baseUomId?: string | null;
  defaultSellingUomId?: string | null;
  imageUrl?: string | null;
  customFields?: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Persistent fallback file storage in project root directory (.data/products.json)
const DATA_DIR = path.resolve('.data');
const DATA_FILE = path.join(DATA_DIR, 'products.json');

const DEMO_SEED_PRODUCT_IDS = new Set([
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

function ensureDataFile(): ProductRecord[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      const initial: ProductRecord[] = [];
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    const cleaned = parsed.filter((p: any) => p && !DEMO_SEED_PRODUCT_IDS.has(String(p.id)));
    if (cleaned.length !== parsed.length) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(cleaned, null, 2), 'utf-8');
    }
    return cleaned;
  } catch (err) {
    console.error('Error reading fallback products file:', err);
    return [];
  }
}

function writeDataFile(items: ProductRecord[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing fallback products file:', err);
  }
}

function hydrateProductRecord(raw: any, fallbackIdx?: number): ProductRecord {
  const cf = (raw.customFields && typeof raw.customFields === 'object' ? raw.customFields : {}) as Record<string, any>;
  const barcodes = normalizeProductBarcodes(raw.barcode, raw.barcodes || cf.barcodes);
  const priceCurrency = (raw.priceCurrency || cf.priceCurrency || 'SDG').toString().toUpperCase();
  const resolvedImage = raw.image || raw.imageUrl || cf.image || undefined;
  const serialNumber = getProductSerialNumber(raw, fallbackIdx);
  const description = raw.description ?? cf.description ?? null;
  const descriptionAr = raw.descriptionAr ?? cf.descriptionAr ?? null;
  const previousCostPrice = raw.previousCostPrice ?? cf.previousCostPrice;
  const previousSellingPrice = raw.previousSellingPrice ?? cf.previousSellingPrice;
  const priceUpdatedAt = raw.priceUpdatedAt ?? cf.priceUpdatedAt;
  const priceHistory = raw.priceHistory || cf.priceHistory || [];
  const modificationHistory = raw.modificationHistory || cf.modificationHistory || [];
  const createdAtStr =
    raw.createdAt instanceof Date
      ? raw.createdAt.toISOString()
      : String(raw.createdAt || cf.createdAt || new Date().toISOString());

  return {
    id: raw.id,
    serialNumber,
    name: raw.name,
    nameAr: raw.nameAr ?? null,
    description,
    descriptionAr,
    sku: raw.sku,
    barcode: raw.barcode ?? '',
    barcodes,
    categoryId: raw.categoryId ?? null,
    category: raw.category ?? raw.categoryName ?? 'General',
    categoryAr: raw.categoryAr ?? raw.categoryNameAr ?? null,
    costPrice: typeof raw.costPrice === 'number' ? raw.costPrice : parseFloat(raw.costPrice || '0'),
    sellingPrice: typeof raw.sellingPrice === 'number' ? raw.sellingPrice : parseFloat(raw.sellingPrice || '0'),
    previousCostPrice: previousCostPrice !== undefined ? Number(previousCostPrice) : undefined,
    previousSellingPrice: previousSellingPrice !== undefined ? Number(previousSellingPrice) : undefined,
    priceUpdatedAt,
    priceHistory,
    modificationHistory,
    priceCurrency,
    stock: Number(raw.stock) || 0,
    minStockAlert: Number(raw.minStockAlert) || 0,
    image: resolvedImage,
    imageUrl: resolvedImage || null,
    emoji: raw.emoji || '📦',
    colorHex: raw.colorHex || '#d97706',
    baseUomId: raw.baseUomId ?? null,
    defaultSellingUomId: raw.defaultSellingUomId ?? null,
    customFields: {
      ...cf,
      serialNumber,
      description,
      descriptionAr,
      barcodes,
      priceCurrency,
      createdAt: createdAtStr,
      previousCostPrice,
      previousSellingPrice,
      priceUpdatedAt,
      priceHistory,
      modificationHistory,
      ...(resolvedImage ? { image: resolvedImage } : {}),
    },
    isActive: raw.isActive !== undefined ? Boolean(raw.isActive) : true,
    createdAt: createdAtStr,
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt.toISOString() : String(raw.updatedAt || new Date().toISOString()),
  };
}

/**
 * Fetch products with optional search query and category filtering.
 */
export async function getAllProducts(query?: string, category?: string): Promise<ProductRecord[]> {
  if (db) {
    try {
      const dbProducts = await db.select().from(products).orderBy(desc(products.updatedAt));
      if (dbProducts.length === 0) {
        const fileItems = ensureDataFile();
        const seenSkus = new Set<string>();
        const seenBarcodes = new Set<string>();
        for (const item of fileItems) {
          const skuLower = item.sku.toLowerCase();
          if (!seenSkus.has(skuLower) && (!item.barcode || !seenBarcodes.has(item.barcode))) {
            seenSkus.add(skuLower);
            if (item.barcode) seenBarcodes.add(item.barcode);
            try {
              await db.insert(products).values({
                id: item.id,
                name: item.name,
                nameAr: item.nameAr || null,
                sku: item.sku,
                barcode: item.barcode || '',
                categoryName: item.category,
                categoryNameAr: item.categoryAr || null,
                costPrice: item.costPrice.toFixed(2),
                sellingPrice: item.sellingPrice.toFixed(2),
                stock: item.stock,
                minStockAlert: item.minStockAlert,
                emoji: item.emoji || '📦',
                colorHex: item.colorHex || '#d97706',
                imageUrl: item.image || item.imageUrl || null,
                customFields: item.customFields || {},
                isActive: item.isActive,
                createdAt: new Date(item.createdAt),
                updatedAt: new Date(item.updatedAt),
              }).onConflictDoNothing();
            } catch {
              // Ignore seed collision
            }
          }
        }
        const refreshed = await db.select().from(products).orderBy(desc(products.updatedAt));
        if (refreshed.length > 0) {
          const mappedRefreshed: ProductRecord[] = refreshed.map((p, idx) => hydrateProductRecord(p, idx));
          return filterProductList(mappedRefreshed, query, category);
        }
      }

      const mapped: ProductRecord[] = dbProducts.map((p, idx) => hydrateProductRecord(p, idx));
      return filterProductList(mapped, query, category);
    } catch (err) {
      console.warn('PostgreSQL query failed, falling back to durable file store:', err);
    }
  }

  const items = ensureDataFile().map((p, idx) => hydrateProductRecord(p, idx));
  return filterProductList(items, query, category);
}

function filterProductList(
  items: ProductRecord[],
  query?: string,
  category?: string
): ProductRecord[] {
  return items.filter((p, idx) => {
    if (!p.isActive) return false;
    const matchesSearch = !query || matchesProductSearchQuery(p as any, query, idx);
    const matchesCat = !category || category === 'all' || p.category === category;
    return matchesSearch && matchesCat;
  });
}

/**
 * Fetch a single product by ID.
 */
export async function getProductById(id: string): Promise<ProductRecord | null> {
  if (db) {
    try {
      const res = await db.select().from(products).where(eq(products.id, id));
      if (res.length > 0) {
        return hydrateProductRecord(res[0]);
      }
      return null;
    } catch (err) {
      console.warn('PostgreSQL getById failed, using file fallback:', err);
    }
  }

  const items = ensureDataFile().map((p, idx) => hydrateProductRecord(p, idx));
  return items.find((p) => p.id === id && p.isActive) || null;
}

/**
 * Create a new product with uniqueness validation on SKU and all non-empty Barcodes.
 */
export async function createProduct(
  data: Omit<ProductRecord, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>
): Promise<ProductRecord> {
  const currentItems = await getAllProducts();
  const normalizedBarcodes = normalizeProductBarcodes(data.barcode, data.barcodes);
  const primaryBarcode = normalizedBarcodes[0] || (data.barcode || '').trim();

  // Validate Barcode Uniqueness across all non-empty primary and secondary barcodes
  for (const candidateCode of normalizedBarcodes) {
    if (!candidateCode) continue;
    const conflict = currentItems.find((p) => matchesProductBarcode(p, candidateCode, true));
    if (conflict) {
      throw new Error(
        `Duplicate barcode: A product with barcode "${candidateCode}" already exists (${conflict.name}).`
      );
    }
  }

  if (currentItems.some((p) => p.sku.toLowerCase() === data.sku.toLowerCase())) {
    throw new Error(`Duplicate SKU: A product with SKU "${data.sku}" already exists.`);
  }

  const now = new Date().toISOString();
  const newId = `prod-${Date.now()}`;
  const serialNumber =
    data.serialNumber && Number(data.serialNumber) > 0
      ? Math.floor(Number(data.serialNumber))
      : getNextProductSerialNumber(currentItems);
  const resolvedImage = data.image || data.imageUrl || (data.customFields as any)?.image || undefined;
  const resolvedCurrency = (data.priceCurrency || (data.customFields as any)?.priceCurrency || 'SDG')
    .toString()
    .toUpperCase();

  const audit = buildProductAuditTrail({
    existingProduct: null,
    nextProduct: {
      name: data.name,
      nameAr: data.nameAr || undefined,
      description: data.description || undefined,
      descriptionAr: data.descriptionAr || undefined,
      sku: data.sku,
      barcode: normalizedBarcodes[0] || '',
      barcodes: normalizedBarcodes,
      category: data.category,
      categoryAr: data.categoryAr || undefined,
      costPrice: data.costPrice,
      sellingPrice: data.sellingPrice,
      priceCurrency: resolvedCurrency as any,
      stock: data.stock,
      minStockAlert: data.minStockAlert,
    },
    changedBy: (data.customFields as any)?.changedBy || 'Main Terminal',
    nowIso: now,
  });

  const mergedCustomFields: Record<string, any> = {
    ...(data.customFields || {}),
    serialNumber,
    description: data.description || (data.customFields as any)?.description || null,
    descriptionAr: data.descriptionAr || (data.customFields as any)?.descriptionAr || null,
    barcodes: normalizedBarcodes,
    priceCurrency: resolvedCurrency,
    createdAt: now,
    priceUpdatedAt: audit.priceUpdatedAt,
    priceHistory: data.priceHistory && data.priceHistory.length > 0 ? data.priceHistory : audit.priceHistory,
    modificationHistory:
      data.modificationHistory && data.modificationHistory.length > 0
        ? data.modificationHistory
        : audit.modificationHistory,
    ...(resolvedImage ? { image: resolvedImage } : {}),
  };

  const record: ProductRecord = {
    ...data,
    id: newId,
    serialNumber,
    description: mergedCustomFields.description,
    descriptionAr: mergedCustomFields.descriptionAr,
    barcode: primaryBarcode,
    barcodes: normalizedBarcodes,
    priceCurrency: resolvedCurrency,
    priceUpdatedAt: audit.priceUpdatedAt,
    priceHistory: mergedCustomFields.priceHistory,
    modificationHistory: mergedCustomFields.modificationHistory,
    image: resolvedImage,
    imageUrl: resolvedImage || null,
    customFields: mergedCustomFields,
    costPrice: Math.round(data.costPrice * 100) / 100,
    sellingPrice: Math.round(data.sellingPrice * 100) / 100,
    stock: Math.max(0, data.stock),
    minStockAlert: Math.max(0, data.minStockAlert),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  if (db) {
    try {
      await db.insert(products).values({
        id: record.id,
        name: record.name,
        nameAr: record.nameAr || null,
        sku: record.sku,
        barcode: record.barcode,
        categoryName: record.category,
        categoryNameAr: record.categoryAr || null,
        costPrice: record.costPrice.toFixed(2),
        sellingPrice: record.sellingPrice.toFixed(2),
        stock: record.stock,
        minStockAlert: record.minStockAlert,
        emoji: record.emoji || '📦',
        colorHex: record.colorHex || '#d97706',
        baseUomId: (data as any).baseUomId || 'uom-pcs',
        defaultSellingUomId: (data as any).defaultSellingUomId || 'uom-pcs',
        imageUrl: record.imageUrl || null,
        customFields: mergedCustomFields,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Synchronize all barcodes into product_barcodes table
      for (let i = 0; i < normalizedBarcodes.length; i++) {
        const code = normalizedBarcodes[i];
        try {
          await db
            .insert(productBarcodes)
            .values({
              id: i === 0 ? `pb-${record.id}-primary` : `pb-${record.id}-${i}-${Date.now()}`,
              productId: record.id,
              barcode: code,
              barcodeType: 'CODE128',
              uomId: (data as any).baseUomId || 'uom-pcs',
              isPrimary: i === 0,
              isActive: true,
              notes: i === 0 ? 'Primary barcode' : 'Additional barcode',
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoNothing();
        } catch {
          // Safe ignore
        }
      }

      const items = ensureDataFile();
      items.unshift(record);
      writeDataFile(items);
      return record;
    } catch (err) {
      console.warn('PostgreSQL insert failed, persisting to file store:', err);
    }
  }

  const items = ensureDataFile();
  items.unshift(record);
  writeDataFile(items);
  return record;
}

/**
 * Update an existing product with uniqueness check across all barcodes and SKU.
 */
export async function updateProduct(
  id: string,
  updates: Partial<Omit<ProductRecord, 'id' | 'createdAt'>>
): Promise<ProductRecord> {
  const existing = await getProductById(id);
  if (!existing) {
    throw new Error(`Product with ID "${id}" not found.`);
  }

  const allItems = await getAllProducts();
  const nextPrimaryBarcode = updates.barcode !== undefined ? updates.barcode : existing.barcode;
  const nextBarcodes = normalizeProductBarcodes(
    nextPrimaryBarcode,
    updates.barcodes !== undefined ? updates.barcodes : existing.barcodes
  );

  // Check unique barcodes against all other products
  for (const candidateCode of nextBarcodes) {
    const conflict = allItems.find((p) => p.id !== id && matchesProductBarcode(p, candidateCode, true));
    if (conflict) {
      throw new Error(
        `Duplicate barcode: A product with barcode "${candidateCode}" already exists (${conflict.name}).`
      );
    }
  }

  // Check unique SKU if changed
  if (updates.sku && updates.sku.toLowerCase() !== existing.sku.toLowerCase()) {
    if (allItems.some((p) => p.id !== id && p.sku.toLowerCase() === updates.sku!.toLowerCase())) {
      throw new Error(`Duplicate SKU: A product with SKU "${updates.sku}" already exists.`);
    }
  }

  const resolvedImage =
    updates.image !== undefined
      ? updates.image
      : updates.imageUrl !== undefined
      ? updates.imageUrl || undefined
      : existing.image;

  const resolvedCurrency = (
    updates.priceCurrency ||
    (updates.customFields as any)?.priceCurrency ||
    existing.priceCurrency ||
    'SDG'
  )
    .toString()
    .toUpperCase();

  const now = new Date().toISOString();
  const audit = buildProductAuditTrail({
    existingProduct: existing as any,
    nextProduct: {
      ...(updates as any),
      barcode: nextBarcodes[0] || nextPrimaryBarcode || '',
      barcodes: nextBarcodes,
      priceCurrency: resolvedCurrency as any,
    },
    changedBy: (updates.customFields as any)?.changedBy || 'Main Terminal',
    nowIso: now,
  });

  const nextSerial =
    updates.serialNumber !== undefined
      ? Number(updates.serialNumber)
      : existing.serialNumber ?? getProductSerialNumber(existing);
  const nextDesc =
    updates.description !== undefined
      ? updates.description
      : existing.description ?? existing.customFields?.description ?? null;
  const nextDescAr =
    updates.descriptionAr !== undefined
      ? updates.descriptionAr
      : existing.descriptionAr ?? existing.customFields?.descriptionAr ?? null;

  const finalPriceHistory =
    updates.priceHistory && updates.priceHistory.length > 0
      ? updates.priceHistory
      : audit.priceHistory;
  const finalModHistory =
    updates.modificationHistory && updates.modificationHistory.length > 0
      ? updates.modificationHistory
      : audit.modificationHistory;
  const finalPrevCost =
    updates.previousCostPrice !== undefined ? updates.previousCostPrice : audit.previousCostPrice;
  const finalPrevSell =
    updates.previousSellingPrice !== undefined
      ? updates.previousSellingPrice
      : audit.previousSellingPrice;
  const finalPriceUpdatedAt =
    updates.priceUpdatedAt !== undefined ? updates.priceUpdatedAt : audit.priceUpdatedAt;

  const mergedCustomFields: Record<string, any> = {
    ...(existing.customFields || {}),
    ...(updates.customFields || {}),
    serialNumber: nextSerial,
    description: nextDesc,
    descriptionAr: nextDescAr,
    barcodes: nextBarcodes,
    priceCurrency: resolvedCurrency,
    previousCostPrice: finalPrevCost,
    previousSellingPrice: finalPrevSell,
    priceUpdatedAt: finalPriceUpdatedAt,
    priceHistory: finalPriceHistory,
    modificationHistory: finalModHistory,
  };
  if (resolvedImage) {
    mergedCustomFields.image = resolvedImage;
  } else {
    delete mergedCustomFields.image;
  }

  const updatedRecord: ProductRecord = {
    ...existing,
    ...updates,
    serialNumber: nextSerial,
    description: nextDesc,
    descriptionAr: nextDescAr,
    barcode: nextBarcodes[0] || nextPrimaryBarcode || '',
    barcodes: nextBarcodes,
    priceCurrency: resolvedCurrency,
    previousCostPrice: finalPrevCost,
    previousSellingPrice: finalPrevSell,
    priceUpdatedAt: finalPriceUpdatedAt,
    priceHistory: finalPriceHistory,
    modificationHistory: finalModHistory,
    image: resolvedImage,
    imageUrl: resolvedImage || null,
    customFields: mergedCustomFields,
    updatedAt: now,
  };

  if (db) {
    try {
      const setPayload: any = {
        name: updatedRecord.name,
        nameAr: updatedRecord.nameAr || null,
        sku: updatedRecord.sku,
        barcode: updatedRecord.barcode,
        categoryName: updatedRecord.category,
        categoryNameAr: updatedRecord.categoryAr || null,
        costPrice: Number(updatedRecord.costPrice).toFixed(2),
        sellingPrice: Number(updatedRecord.sellingPrice).toFixed(2),
        stock: updatedRecord.stock,
        minStockAlert: updatedRecord.minStockAlert,
        emoji: updatedRecord.emoji || '📦',
        colorHex: updatedRecord.colorHex || '#d97706',
        imageUrl: updatedRecord.imageUrl || null,
        customFields: mergedCustomFields,
        updatedAt: new Date(),
      };

      if (updates.baseUomId !== undefined) setPayload.baseUomId = updates.baseUomId;
      if (updates.defaultSellingUomId !== undefined) setPayload.defaultSellingUomId = updates.defaultSellingUomId;

      await db.update(products).set(setPayload).where(eq(products.id, id));

      // Sync product_barcodes table
      try {
        await db.delete(productBarcodes).where(eq(productBarcodes.productId, id));
        for (let i = 0; i < nextBarcodes.length; i++) {
          const code = nextBarcodes[i];
          await db
            .insert(productBarcodes)
            .values({
              id: i === 0 ? `pb-${id}-primary` : `pb-${id}-${i}-${Date.now()}`,
              productId: id,
              barcode: code,
              barcodeType: 'CODE128',
              uomId: updatedRecord.baseUomId || 'uom-pcs',
              isPrimary: i === 0,
              isActive: true,
              notes: i === 0 ? 'Primary barcode' : 'Additional barcode',
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoNothing();
        }
      } catch {
        // Safe ignore if barcode sync encounters conflict
      }
    } catch (err) {
      console.warn('PostgreSQL update failed, updating file store:', err);
    }
  }

  const fileItems = ensureDataFile();
  const index = fileItems.findIndex((p) => p.id === id);
  if (index !== -1) {
    fileItems[index] = updatedRecord;
  } else {
    fileItems.unshift(updatedRecord);
  }
  writeDataFile(fileItems);

  return updatedRecord;
}

/**
 * Delete (or soft delete) a product by ID.
 */
export async function deleteProduct(id: string): Promise<boolean> {
  if (db) {
    try {
      await db.delete(products).where(eq(products.id, id));
    } catch (err) {
      console.warn('PostgreSQL delete failed, using file store:', err);
    }
  }

  const items = ensureDataFile();
  const filtered = items.filter((p) => p.id !== id);
  writeDataFile(filtered);
  return true;
}

/**
 * Add a secondary or packaging barcode to an existing product.
 * Enforces uniqueness across all primary and secondary barcodes.
 */
export async function addProductBarcode(data: {
  productId: string;
  barcode: string;
  barcodeType?: string;
  isPrimary?: boolean;
  uomId?: string;
  notes?: string;
}): Promise<{
  id: string;
  productId: string;
  barcode: string;
  barcodeType: string;
  isPrimary: boolean;
  uomId: string | null;
}> {
  const cleanBarcode = data.barcode.trim();
  if (!cleanBarcode) {
    throw new Error('Barcode cannot be empty.');
  }

  if (db) {
    // 1. Check uniqueness against existing products.barcode
    const matchProd = await db
      .select()
      .from(products)
      .where(eq(products.barcode, cleanBarcode));
    if (matchProd.length > 0 && matchProd[0].id !== data.productId) {
      throw new Error(
        `Duplicate barcode: Barcode "${cleanBarcode}" is already assigned to product "${matchProd[0].name}".`
      );
    }

    // 2. Check uniqueness against product_barcodes table
    const matchPb = await db
      .select()
      .from(productBarcodes)
      .where(eq(productBarcodes.barcode, cleanBarcode));
    if (matchPb.length > 0) {
      throw new Error(`Duplicate barcode: Barcode "${cleanBarcode}" already exists in the system.`);
    }

    const id = `pb-${data.productId}-${Date.now()}`;
    await db.insert(productBarcodes).values({
      id,
      productId: data.productId,
      barcode: cleanBarcode,
      barcodeType: data.barcodeType || 'CODE128',
      uomId: data.uomId || null,
      isPrimary: Boolean(data.isPrimary),
      isActive: true,
      notes: data.notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      id,
      productId: data.productId,
      barcode: cleanBarcode,
      barcodeType: data.barcodeType || 'CODE128',
      isPrimary: Boolean(data.isPrimary),
      uomId: data.uomId || null,
    };
  }

  return {
    id: `pb-${data.productId}-${Date.now()}`,
    productId: data.productId,
    barcode: cleanBarcode,
    barcodeType: data.barcodeType || 'CODE128',
    isPrimary: Boolean(data.isPrimary),
    uomId: data.uomId || null,
  };
}

/**
 * Retrieve all barcodes associated with a product.
 */
export async function getProductBarcodes(productId: string): Promise<
  Array<{
    id: string;
    barcode: string;
    barcodeType: string;
    isPrimary: boolean;
    uomId: string | null;
  }>
> {
  if (db) {
    const res = await db
      .select()
      .from(productBarcodes)
      .where(and(eq(productBarcodes.productId, productId), eq(productBarcodes.isActive, true)));
    return res.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      barcodeType: r.barcodeType,
      isPrimary: r.isPrimary,
      uomId: r.uomId,
    }));
  }
  return [];
}

/**
 * Find a product by ANY associated barcode (primary or secondary).
 */
export async function getProductByAnyBarcode(barcode: string): Promise<ProductRecord | null> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;

  if (db) {
    // 1. Check primary product barcode column
    const prodMatch = await db.select().from(products).where(eq(products.barcode, cleanBarcode));
    if (prodMatch.length > 0) {
      return getProductById(prodMatch[0].id);
    }

    // 2. Check secondary barcodes table
    const secMatch = await db
      .select()
      .from(productBarcodes)
      .where(and(eq(productBarcodes.barcode, cleanBarcode), eq(productBarcodes.isActive, true)));
    if (secMatch.length > 0) {
      return getProductById(secMatch[0].productId);
    }
  }

  const all = await getAllProducts();
  return all.find((p) => p.barcode === cleanBarcode) || null;
}
