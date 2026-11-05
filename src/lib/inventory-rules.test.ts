/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStockAvailability,
  calculateStockAdjustment,
  isLowStock,
  generateTransactionId,
  generateBarcode,
  normalizeProductBarcodes,
  getAllProductBarcodes,
  matchesProductBarcode,
  resolveScannedProductBarcode,
  getProductSerialNumber,
  formatProductSerialNumber,
  getNextProductSerialNumber,
  matchesProductSearchQuery,
  buildProductAuditTrail,
} from './inventory-rules';

test('checkStockAvailability correctly determines availability', () => {
  const product = { stock: 10 };
  assert.deepEqual(checkStockAvailability(product, 5), { available: true, remainingAfterSale: 5 });
  assert.deepEqual(checkStockAvailability(product, 10), { available: true, remainingAfterSale: 0 });
  assert.deepEqual(checkStockAvailability(product, 11), { available: false, remainingAfterSale: -1 });
  assert.deepEqual(checkStockAvailability(product, 0), { available: false, remainingAfterSale: 10 });
});

test('calculateStockAdjustment computes stock changes for various event types', () => {
  assert.equal(calculateStockAdjustment(20, 'sale', 5), 15);
  assert.equal(calculateStockAdjustment(10, 'damage', 2), 8);
  assert.equal(calculateStockAdjustment(5, 'loss', 10), 0); // clamped to zero
  assert.equal(calculateStockAdjustment(15, 'restock', 25), 40);
  assert.equal(calculateStockAdjustment(10, 'audit', 17), 17); // sets exact count
});

test('isLowStock identifies items at or below threshold', () => {
  assert.equal(isLowStock(3, 5), true);
  assert.equal(isLowStock(5, 5), true);
  assert.equal(isLowStock(6, 5), false);
});

test('generateTransactionId creates consistent format with TXN prefix', () => {
  const d = new Date(2026, 9, 29);
  const txnId = generateTransactionId(d);
  assert.ok(txnId.startsWith('TXN-20261029-'));
});

test('generateBarcode produces 12 character numeric code', () => {
  const barcode = generateBarcode();
  assert.equal(barcode.length, 12);
  assert.match(barcode, /^\d+$/);
});

test('normalizeProductBarcodes and matchesProductBarcode handle multiple barcodes per product', () => {
  const codes = normalizeProductBarcodes('200111222333', ['200111222333', ' 628100000111 ', '', '628100000222']);
  assert.deepEqual(codes, ['200111222333', '628100000111', '628100000222']);

  const prod = {
    barcode: '200111222333',
    barcodes: ['200111222333', '628100000111', 'BOX-998877'],
  };
  assert.deepEqual(getAllProductBarcodes(prod), ['200111222333', '628100000111', 'BOX-998877']);
  assert.equal(matchesProductBarcode(prod, '628100000111', true), true);
  assert.equal(matchesProductBarcode(prod, 'BOX-9988', false), true);
  assert.equal(matchesProductBarcode(prod, 'BOX-9988', true), false);
  assert.equal(matchesProductBarcode(prod, '999999999999', true), false);
});

test('resolveScannedProductBarcode adds camera-scanned barcodes, rejects empty input without auto-generating, and detects duplicates/conflicts', () => {
  const existingProducts = [
    {
      id: 'prod-1',
      name: 'Espresso',
      nameAr: 'إسبريسو',
      barcode: '628111111111',
      barcodes: ['628111111111'],
    },
  ];

  // 0. Never auto-generate a barcode when scannedCode is empty
  const resEmpty = resolveScannedProductBarcode({
    scannedCode: '   ',
    target: 'primary',
    currentPrimary: '',
    currentAdditional: [],
    existingProducts,
  });
  assert.equal(resEmpty.ok, false);
  assert.equal(resEmpty.code, '');
  assert.equal(resEmpty.primaryBarcode, '');

  // 1. Add additional scanned barcode
  const res1 = resolveScannedProductBarcode({
    scannedCode: '628222222222',
    target: 'additional',
    currentPrimary: '200000000001',
    currentAdditional: [],
    existingProducts,
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.code, '628222222222');
  assert.deepEqual(res1.additionalBarcodes, ['628222222222']);

  // 2. Reject duplicate on same product
  const resDup = resolveScannedProductBarcode({
    scannedCode: '200000000001',
    target: 'additional',
    currentPrimary: '200000000001',
    currentAdditional: ['628222222222'],
    existingProducts,
  });
  assert.equal(resDup.ok, false);
  assert.ok(resDup.errorAr?.includes('مضاف بالفعل'));

  // 3. Reject conflict with another product
  const resConflict = resolveScannedProductBarcode({
    scannedCode: '628111111111',
    target: 'additional',
    currentPrimary: '200000000001',
    currentAdditional: [],
    existingProducts,
  });
  assert.equal(resConflict.ok, false);
  assert.ok(resConflict.errorAr?.includes('إسبريسو'));

  // 4. Primary target replaces primary barcode cleanly
  const resPrimary = resolveScannedProductBarcode({
    scannedCode: '628333333333',
    target: 'primary',
    currentPrimary: '200000000001',
    currentAdditional: ['628222222222'],
    existingProducts,
  });
  assert.equal(resPrimary.ok, true);
  assert.equal(resPrimary.primaryBarcode, '628333333333');
});

test('getProductSerialNumber, formatProductSerialNumber, and getNextProductSerialNumber work sequentially', () => {
  const list = [
    { id: 'prod-1', serialNumber: 1 },
    { id: 'prod-2', serialNumber: 2 },
    { id: 'prod-10' }, // infers 10 from prod-10
  ];
  assert.equal(getProductSerialNumber(list[0]), 1);
  assert.equal(getProductSerialNumber(list[2]), 10);
  assert.equal(formatProductSerialNumber(1), '#0001');
  assert.equal(formatProductSerialNumber(15), '#0015');
  assert.equal(getNextProductSerialNumber(list), 11);
});

test('matchesProductSearchQuery supports multi-word search across name, description, serial number, SKU, and barcode', () => {
  const dyeProduct = {
    id: 'prod-10',
    serialNumber: 10,
    name: 'Natural Hair Dye (Pack = 8 Strips)',
    nameAr: 'صبغة شعر طبيعية (الباكو 8 أشرطة)',
    description: 'Herbal ammonia-free black henna hair color sachets',
    descriptionAr: 'صبغة حناء سوداء خالية من الأمونيا للشعر تباع بالشريط أو الباكو',
    sku: 'COS-008',
    barcode: '200801008018',
    barcodes: ['200801008018', '628999000111'],
    category: 'Packaged Retail',
    categoryAr: 'منتجات التجزئة والبن',
  };

  // Search by Arabic keywords across name and description
  assert.equal(matchesProductSearchQuery(dyeProduct, 'صبغة أمونيا'), true);
  assert.equal(matchesProductSearchQuery(dyeProduct, 'حناء سوداء شريط'), true);
  // Search by English keywords across name and description
  assert.equal(matchesProductSearchQuery(dyeProduct, 'herbal strips'), true);
  // Search by sequential serial number in any format
  assert.equal(matchesProductSearchQuery(dyeProduct, '10'), true);
  assert.equal(matchesProductSearchQuery(dyeProduct, '#10'), true);
  assert.equal(matchesProductSearchQuery(dyeProduct, '#0010'), true);
  assert.equal(matchesProductSearchQuery(dyeProduct, '0010'), true);
  // Search by secondary barcode
  assert.equal(matchesProductSearchQuery(dyeProduct, '628999000111'), true);
  // Non-matching word returns false
  assert.equal(matchesProductSearchQuery(dyeProduct, 'صبغة كرواسون'), false);
});

test('buildProductAuditTrail records creation date, old price history, and field modifications', () => {
  const createdAudit = buildProductAuditTrail({
    existingProduct: null,
    nextProduct: {
      name: 'Test Item',
      costPrice: 10,
      sellingPrice: 15,
      priceCurrency: 'USD',
    },
    changedBy: 'Ahmed (Admin)',
    nowIso: '2026-10-20T10:00:00.000Z',
  });
  assert.equal(createdAudit.createdAt, '2026-10-20T10:00:00.000Z');
  assert.equal(createdAudit.priceHistory.length, 1);
  assert.equal(createdAudit.modificationHistory.length, 1);
  assert.equal(createdAudit.modificationHistory[0].action, 'created');

  const existingProduct: any = {
    id: 'prod-99',
    name: 'Test Item',
    nameAr: 'صنف تجريبي',
    sku: 'TST-01',
    barcode: '200123456789',
    costPrice: 10,
    sellingPrice: 15,
    priceCurrency: 'USD',
    stock: 20,
    createdAt: '2026-10-20T10:00:00.000Z',
    priceHistory: createdAudit.priceHistory,
    modificationHistory: createdAudit.modificationHistory,
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  const updatedAudit = buildProductAuditTrail({
    existingProduct,
    nextProduct: {
      name: 'Test Item Pro',
      costPrice: 12,
      sellingPrice: 18.5,
      priceCurrency: 'USD',
      stock: 35,
    },
    changedBy: 'Sara (Manager)',
    nowIso: '2026-10-25T14:30:00.000Z',
  });

  assert.equal(updatedAudit.createdAt, '2026-10-20T10:00:00.000Z');
  assert.equal(updatedAudit.previousCostPrice, 10);
  assert.equal(updatedAudit.previousSellingPrice, 15);
  assert.equal(updatedAudit.priceUpdatedAt, '2026-10-25T14:30:00.000Z');
  assert.equal(updatedAudit.priceHistory.length, 2);
  assert.equal(updatedAudit.priceHistory[0].previousSellingPrice, 15);
  assert.equal(updatedAudit.priceHistory[0].newSellingPrice, 18.5);
  assert.equal(updatedAudit.priceHistory[0].changedBy, 'Sara (Manager)');
  assert.equal(updatedAudit.modificationHistory.length, 2);
  assert.ok(updatedAudit.modificationHistory[0].changedFields.includes('sellingPrice'));
  assert.ok(updatedAudit.modificationHistory[0].changedFields.includes('stock'));
});


