/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 (Phase B): Automated Validation Tests for Unmet Customer Demand Data Model
 * Strictly isolated in-memory fixtures — zero database or operational file mutations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactUnmetDemandRecordForRole,
  validateAndBuildUnmetDemandRequest,
  UnmetDemandRequestRecord,
} from './unmet-demand.validation';
import { POSUser, Product } from '../lib/types';

const TEST_USERS: POSUser[] = [
  {
    id: 'usr-admin-1',
    name: 'Admin User',
    role: 'admin',
    terminalName: 'Main Terminal',
    avatarColor: '#10b981',
    isActive: true,
    permissions: {
      canCheckout: true,
      canManageProducts: true,
      canEditPrices: true,
      canManageInventory: true,
      canVoidTransactions: true,
      canManageExchangeRates: true,
      canViewReports: true,
      canManageUsers: true,
      canApplyDiscounts: true,
    },
    lastActiveAt: '2026-11-03T00:00:00.000Z',
  },
  {
    id: 'usr-cashier-2',
    name: 'Branch 2 Cashier',
    role: 'cashier',
    terminalName: 'T2',
    avatarColor: '#3b82f6',
    isActive: true,
    permissions: {
      canCheckout: true,
      canManageProducts: false,
      canEditPrices: false,
      canManageInventory: false,
      canVoidTransactions: false,
      canManageExchangeRates: false,
      canViewReports: false,
      canManageUsers: false,
      canApplyDiscounts: false,
    },
    lastActiveAt: '2026-11-03T00:00:00.000Z',
  },
];

const TEST_PRODUCTS: Product[] = [
  {
    id: 'prod-zero-stock',
    name: 'Panadol Extra 500mg',
    nameAr: 'بنادول إكسترا 500 ملجم',
    sku: 'MED-001',
    barcode: '6281000001011',
    category: 'Analgesics',
    costPrice: 1200,
    sellingPrice: 1800,
    priceCurrency: 'SDG',
    stock: 0,
    minStockAlert: 10,
    enablePackaging: true,
    unitName: 'Strip',
    packName: 'Box',
    unitsPerPack: 10,
    packSellingPrice: 17000,
    packCostPrice: 11500,
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'prod-low-stock',
    name: 'Vitamin C Effervescent',
    nameAr: 'فيتامين سي فوار',
    sku: 'VIT-002',
    barcode: '6281000002022',
    category: 'Supplements',
    costPrice: 2500,
    sellingPrice: 3500,
    priceCurrency: 'SDG',
    stock: 3,
    minStockAlert: 8,
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
];

test('Phase B.1: Captures registered zero-stock product request and snapshots catalog metadata accurately', () => {
  const now = new Date('2026-11-03T10:00:00.000Z');
  const res = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-zero-stock',
      requestedQuantity: 2,
      saleUnitMode: 'pack',
      unavailabilityReason: 'OUT_OF_STOCK',
      confirmedPurchaseIntent: true,
      notes: 'Customer needed 2 full boxes urgently',
    },
    claimingUserId: 'usr-cashier-2',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
    now,
  });

  assert.equal(res.valid, true);
  assert.equal(res.statusCode, 201);
  assert.ok(res.record);
  assert.equal(res.record.isRegisteredProduct, true);
  assert.equal(res.record.productId, 'prod-zero-stock');
  assert.equal(res.record.productNameSnapshot, 'Panadol Extra 500mg');
  assert.equal(res.record.skuSnapshot, 'MED-001');
  assert.equal(res.record.barcode, '6281000001011');
  assert.equal(res.record.requestedQuantity, 2);
  assert.equal(res.record.saleUnitMode, 'pack');
  assert.equal(res.record.requestedBaseUnits, 20); // 2 boxes * 10 strips/box
  assert.equal(res.record.availableStockAtRequest, 0);
  assert.equal(res.record.availabilityStatus, 'OUT_OF_STOCK');
  assert.equal(res.record.unavailabilityReason, 'OUT_OF_STOCK');
  assert.equal(res.record.confirmedPurchaseIntent, true);
  assert.equal(res.record.fulfillmentStatus, 'unfulfilled');
  assert.equal(res.record.recordedByUserId, 'usr-cashier-2');
  assert.equal(res.record.terminalName, 'T2');
});

test('Phase B.2: Captures unregistered catalog product request without creating a catalog product or fabricating price/stock', () => {
  const now = new Date('2026-11-03T10:05:00.000Z');
  const catalogBefore = JSON.stringify(TEST_PRODUCTS);

  const res = validateAndBuildUnmetDemandRequest({
    input: {
      productName: 'Imported Organic Almond Milk 1L',
      productNameAr: 'حليب لوز عضوي مستورد 1 لتر',
      barcode: '8901234567890',
      requestedQuantity: 3,
      unavailabilityReason: 'NOT_STOCKED',
    },
    claimingUserId: 'usr-admin-1',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
    now,
  });

  assert.equal(res.valid, true);
  assert.ok(res.record);
  assert.equal(res.record.isRegisteredProduct, false);
  assert.equal(res.record.productId, null);
  assert.equal(res.record.availableStockAtRequest, null);
  assert.equal(res.record.unitSellingPriceSnapshot, null);
  assert.equal(res.record.unitCostPriceSnapshot, null);
  assert.equal(res.record.availabilityStatus, 'UNREGISTERED');
  assert.equal(res.record.unavailabilityReason, 'NOT_STOCKED');
  // Catalog array must remain 100% untouched
  assert.equal(JSON.stringify(TEST_PRODUCTS), catalogBefore);
});

test('Phase B.3: Detects INSUFFICIENT_QUANTITY when stock > 0 but less than requested quantity, and EXPIRED when reason is EXPIRED', () => {
  const now = new Date('2026-11-03T10:10:00.000Z');

  const partialRes = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-low-stock', // stock = 3
      requestedQuantity: 6,
      unavailabilityReason: 'OUT_OF_STOCK',
    },
    claimingUserId: 'usr-admin-1',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
    now,
  });

  assert.equal(partialRes.valid, true);
  assert.equal(partialRes.record?.availableStockAtRequest, 3);
  assert.equal(partialRes.record?.availabilityStatus, 'INSUFFICIENT_QUANTITY');

  const expiredRes = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-low-stock',
      requestedQuantity: 1,
      unavailabilityReason: 'EXPIRED',
    },
    claimingUserId: 'usr-admin-1',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
    now,
  });

  assert.equal(expiredRes.valid, true);
  assert.equal(expiredRes.record?.availabilityStatus, 'EXPIRED');
  assert.equal(expiredRes.record?.unavailabilityReason, 'EXPIRED');
});

test('Phase B.4: Prevents accidental duplicate double-tap within 60s while preserving separate customer inquiries', () => {
  const t0 = new Date('2026-11-03T11:00:00.000Z');
  const existing: UnmetDemandRequestRecord[] = [];

  const first = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-zero-stock',
      requestedQuantity: 1,
      unavailabilityReason: 'OUT_OF_STOCK',
    },
    claimingUserId: 'usr-cashier-2',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: existing,
    now: t0,
  });
  assert.equal(first.valid, true);
  existing.push(first.record!);

  // Accidental double-tap 12 seconds later by same cashier for same item & qty
  const accidentalRepeat = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-zero-stock',
      requestedQuantity: 1,
      unavailabilityReason: 'OUT_OF_STOCK',
    },
    claimingUserId: 'usr-cashier-2',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: existing,
    now: new Date(t0.getTime() + 12 * 1000),
  });
  assert.equal(accidentalRepeat.valid, false);
  assert.equal(accidentalRepeat.statusCode, 409);
  assert.equal(accidentalRepeat.errorCode, 'DUPLICATE_RAPID_SUBMISSION');

  // Separate customer inquiry 90 seconds later is preserved as a distinct record (not merged)
  const secondCustomerLater = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-zero-stock',
      requestedQuantity: 1,
      unavailabilityReason: 'OUT_OF_STOCK',
    },
    claimingUserId: 'usr-cashier-2',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: existing,
    now: new Date(t0.getTime() + 90 * 1000),
  });
  assert.equal(secondCustomerLater.valid, true);
  assert.notEqual(secondCustomerLater.record?.id, first.record?.id);
});

test('Phase B.5: Enforces server-side authentication, branch isolation, invalid input rejection, and PII redaction', () => {
  // Missing user ID -> 401
  const noUser = validateAndBuildUnmetDemandRequest({
    input: { productId: 'prod-zero-stock', unavailabilityReason: 'OUT_OF_STOCK' },
    claimingUserId: '',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
  });
  assert.equal(noUser.valid, false);
  assert.equal(noUser.statusCode, 401);

  // Unknown user ID -> 401
  const unknownUser = validateAndBuildUnmetDemandRequest({
    input: { productId: 'prod-zero-stock', unavailabilityReason: 'OUT_OF_STOCK' },
    claimingUserId: 'spoofed-admin-999',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
  });
  assert.equal(unknownUser.valid, false);
  assert.equal(unknownUser.statusCode, 401);

  // Invalid reason -> 400
  const badReason = validateAndBuildUnmetDemandRequest({
    input: { productId: 'prod-zero-stock', unavailabilityReason: 'INVALID_REASON_CODE' },
    claimingUserId: 'usr-admin-1',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
  });
  assert.equal(badReason.valid, false);
  assert.equal(badReason.statusCode, 400);
  assert.equal(badReason.errorCode, 'INVALID_REASON');

  // Invalid quantity -> 400
  const badQty = validateAndBuildUnmetDemandRequest({
    input: { productId: 'prod-zero-stock', requestedQuantity: 0, unavailabilityReason: 'OUT_OF_STOCK' },
    claimingUserId: 'usr-admin-1',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
  });
  assert.equal(badQty.valid, false);
  assert.equal(badQty.statusCode, 400);
  assert.equal(badQty.errorCode, 'INVALID_QUANTITY');

  // PII Redaction check
  const validWithRef = validateAndBuildUnmetDemandRequest({
    input: {
      productId: 'prod-zero-stock',
      unavailabilityReason: 'OUT_OF_STOCK',
      customerReference: 'VIP-Phone-0912345678',
    },
    claimingUserId: 'usr-cashier-2',
    serverUsers: TEST_USERS,
    catalogProducts: TEST_PRODUCTS,
    existingRequests: [],
  });
  assert.equal(validWithRef.valid, true);
  const redacted = redactUnmetDemandRecordForRole(validWithRef.record!, false);
  assert.equal(redacted.customerReference, '[REDACTED]');
});
