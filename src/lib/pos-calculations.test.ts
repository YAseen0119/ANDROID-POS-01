/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateItemTotal,
  calculateCartTotals,
  calculateChangeDue,
  calculateDebtBreakdown,
  formatPaymentMethodLabel,
  validateCheckout,
  formatCurrency,
  convertCurrencyAmount,
  getProductPricesInCurrency,
  getProductPackaging,
  getCartItemUnitPricing,
  formatProductStockBreakdown,
  getConvertedTransactionView,
  repriceTransactionToNewRate,
  lockTransactionSaleExchangeRate,
  computeStoreReportAnalytics,
  computeExchangeRateFluctuationSummary,
  applyDebtSettlementPayment,
  getAllTransactionReceiptImages,
  computeDailyRevenueTrends,
} from './pos-calculations';
import { CartItem, Product, Transaction } from './types';

const mockProductA: Product = {
  id: 'prod-1',
  name: 'Organic Espresso Roast',
  sku: 'COF-001',
  barcode: '200123456789',
  category: 'Beverages',
  costPrice: 4.5,
  sellingPrice: 12.0,
  stock: 25,
  minStockAlert: 5,
  updatedAt: new Date().toISOString(),
};

const mockProductB: Product = {
  id: 'prod-2',
  name: 'Artisan Sourdough Loaf',
  sku: 'BAK-002',
  barcode: '200987654321',
  category: 'Bakery',
  costPrice: 2.0,
  sellingPrice: 8.0,
  stock: 2,
  minStockAlert: 5,
  updatedAt: new Date().toISOString(),
};

test('calculateItemTotal calculates line totals with and without discounts', () => {
  assert.equal(calculateItemTotal(10, 2, 0), 20);
  // 10% discount on $20 = $18
  assert.equal(calculateItemTotal(10, 2, 10), 18);
  // Boundary cases
  assert.equal(calculateItemTotal(0, 5, 0), 0);
  assert.equal(calculateItemTotal(-5, 2, 0), 0);
  assert.equal(calculateItemTotal(10, -1, 0), 0);
  assert.equal(calculateItemTotal(10, 1, 100), 0);
});

test('calculateCartTotals calculates subtotal, tax-exclusive tax, and global discount', () => {
  const cart: CartItem[] = [
    { product: mockProductA, quantity: 2, itemDiscountPercent: 0 }, // 24
    { product: mockProductB, quantity: 1, itemDiscountPercent: 0 }, // 8
  ];
  // Subtotal = 32. 10% tax on 32 = 3.20. Grand total = 35.20
  const result = calculateCartTotals(cart, 10, 0, false);
  assert.equal(result.subtotal, 32.0);
  assert.equal(result.taxAmount, 3.2);
  assert.equal(result.grandTotal, 35.2);
  assert.equal(result.totalItemsCount, 3);
});

test('calculateCartTotals handles tax-inclusive mode correctly', () => {
  const cart: CartItem[] = [
    { product: mockProductA, quantity: 1, itemDiscountPercent: 0 }, // 12
  ];
  // Subtotal = 12. Tax included at 20%: Tax = 12 - (12 / 1.2) = 2.00. Grand total = 12.00
  const result = calculateCartTotals(cart, 20, 0, true);
  assert.equal(result.subtotal, 12.0);
  assert.equal(result.taxAmount, 2.0);
  assert.equal(result.grandTotal, 12.0);
});

test('calculateCartTotals handles empty cart gracefully', () => {
  const result = calculateCartTotals([], 15, 0, false);
  assert.equal(result.subtotal, 0);
  assert.equal(result.grandTotal, 0);
  assert.equal(result.totalItemsCount, 0);
});

test('calculateChangeDue returns correct change amount', () => {
  assert.equal(calculateChangeDue(50.0, 35.2), 14.8);
  assert.equal(calculateChangeDue(35.2, 35.2), 0);
  assert.equal(calculateChangeDue(30.0, 35.2), 0); // Less tendered returns 0
});

test('validateCheckout flags empty cart, insufficient stock, and under-tendered cash', () => {
  const cart: CartItem[] = [
    { product: mockProductA, quantity: 2, itemDiscountPercent: 0 },
  ];

  // Valid card payment
  assert.equal(validateCheckout(cart, 'card', 0, 24).valid, true);

  // Cash underpayment
  const underpaid = validateCheckout(cart, 'cash', 20, 24);
  assert.equal(underpaid.valid, false);
  assert.ok(underpaid.error?.includes('less than total due'));

  // Insufficient stock validation
  const overStockCart: CartItem[] = [
    { product: mockProductB, quantity: 10, itemDiscountPercent: 0 }, // Product B only has 2 in stock
  ];
  const stockExceeded = validateCheckout(overStockCart, 'card', 0, 80);
  assert.equal(stockExceeded.valid, false);
  assert.ok(stockExceeded.error?.includes('Insufficient stock'));

  // Empty cart
  const emptyCheck = validateCheckout([], 'cash', 10, 0);
  assert.equal(emptyCheck.valid, false);
});

test('formatCurrency formats multiple currencies accurately', () => {
  assert.equal(formatCurrency(12.5, 'USD', 'en'), '$12.50');
  assert.equal(formatCurrency(50, 'EUR', 'en'), '€50.00');
  assert.equal(formatCurrency(100, 'SAR', 'en'), 'SAR 100.00');
  assert.equal(formatCurrency(100, 'SAR', 'ar'), '100.00 ر.س');
});

test('convertCurrencyAmount and getProductPricesInCurrency convert accurately across SDG, USD, and SAR', () => {
  const rates = { SDG: 1, USD: 2700, SAR: 720 };

  assert.equal(convertCurrencyAmount(2700, 'SDG', 'USD', rates), 1);
  assert.equal(convertCurrencyAmount(5400, 'SDG', 'USD', rates), 2);
  assert.equal(convertCurrencyAmount(10, 'USD', 'SDG', rates), 27000);
  assert.equal(convertCurrencyAmount(10, 'USD', 'SAR', rates), 37.5);

  const sdgProduct: Product = {
    ...mockProductA,
    costPrice: 2700,
    sellingPrice: 5400,
    priceCurrency: 'SDG',
  };

  const inUsd = getProductPricesInCurrency(sdgProduct, 'USD', rates);
  assert.equal(inUsd.costPrice, 1);
  assert.equal(inUsd.sellingPrice, 2);
  assert.equal(inUsd.profit, 1);
  assert.equal(inUsd.marginPercent, 50);

  const inSar = getProductPricesInCurrency(sdgProduct, 'SAR', rates);
  assert.equal(inSar.costPrice, 3.75);
  assert.equal(inSar.sellingPrice, 7.5);

  // Cart totals automatically convert when targetCurrency & exchangeRates are provided
  const cart: CartItem[] = [{ product: sdgProduct, quantity: 2, itemDiscountPercent: 0 }];
  const totalsInUsd = calculateCartTotals(cart, 0, 0, false, 'USD', rates);
  assert.equal(totalsInUsd.subtotal, 4);
  assert.equal(totalsInUsd.grandTotal, 4);
});

test('calculateDebtBreakdown accurately computes paid, partial debt, and full unpaid debt', () => {
  // Paid in full with cash change
  const fullPaid = calculateDebtBreakdown(100, 'paid', 120);
  assert.equal(fullPaid.paymentStatus, 'paid');
  assert.equal(fullPaid.amountPaid, 100);
  assert.equal(fullPaid.debtAmount, 0);
  assert.equal(fullPaid.changeDue, 20);

  // Partial payment leaves remaining debt
  const partial = calculateDebtBreakdown(100, 'partial', 40);
  assert.equal(partial.paymentStatus, 'partial');
  assert.equal(partial.amountPaid, 40);
  assert.equal(partial.debtAmount, 60);
  assert.equal(partial.changeDue, 0);

  // Unpaid (full debt)
  const unpaid = calculateDebtBreakdown(100, 'unpaid', 0);
  assert.equal(unpaid.paymentStatus, 'unpaid');
  assert.equal(unpaid.amountPaid, 0);
  assert.equal(unpaid.debtAmount, 100);
  assert.equal(unpaid.changeDue, 0);
});

test('validateCheckout validates bank_transfer reference number and debt payment statuses', () => {
  const cart: CartItem[] = [{ product: mockProductA, quantity: 2, itemDiscountPercent: 0 }];

  // Bank transfer without operation reference number fails when paid
  const missingRef = validateCheckout(cart, 'bank_transfer', 24, 24, {
    paymentStatus: 'paid',
    transferReference: '   ',
  });
  assert.equal(missingRef.valid, false);
  assert.ok(missingRef.error?.includes('reference number'));

  // Bank transfer with valid operation reference number succeeds
  const validBankTransfer = validateCheckout(cart, 'bank_transfer', 24, 24, {
    paymentStatus: 'paid',
    transferReference: 'TRX-998877',
    transferReceiptImage: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.equal(validBankTransfer.valid, true);

  // Unpaid (full debt) allows 0 tendered even on cash/bank_transfer
  const unpaidDebt = validateCheckout(cart, 'cash', 0, 24, {
    paymentStatus: 'unpaid',
  });
  assert.equal(unpaidDebt.valid, true);

  // Partial payment with valid partial amount succeeds
  const partialDebt = validateCheckout(cart, 'cash', 10, 24, {
    paymentStatus: 'partial',
    amountPaid: 10,
  });
  assert.equal(partialDebt.valid, true);

  // Partial payment with 0 amount fails
  const zeroPartial = validateCheckout(cart, 'cash', 0, 24, {
    paymentStatus: 'partial',
    amountPaid: 0,
  });
  assert.equal(zeroPartial.valid, false);

  // Labels format accurately in Arabic and English
  assert.equal(formatPaymentMethodLabel('bank_transfer', 'ar'), 'تحويل بنكي');
  assert.equal(formatPaymentMethodLabel('bank_transfer', 'en'), 'Bank Transfer');
});

test('getConvertedTransactionView and repriceTransactionToNewRate handle currency switching and fluctuating exchange rates', () => {
  const sampleTx: Transaction = {
    id: 'TXN-TEST-100',
    idempotencyKey: 'idem-100',
    timestamp: new Date().toISOString(),
    currency: 'SDG',
    exchangeRateUsed: 2500,
    exchangeRatesSnapshot: {
      SDG: 1,
      USD: 2500,
      SAR: 666.6667,
    },
    items: [
      {
        productId: 'prod-1',
        productName: 'Coffee Beans',
        sku: 'COF-1',
        quantity: 2,
        unitPrice: 12500,
        discountPercent: 0,
        total: 25000,
      },
    ],
    subtotal: 25000,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 25000, // Worth $10 USD at sale time (rate = 2500)
    paymentMethod: 'bank_transfer',
    transferReference: 'REF-100',
    amountTendered: 10000,
    changeDue: 0,
    paymentStatus: 'partial',
    amountPaid: 10000, // Paid $4 USD at sale time
    debtAmount: 15000, // Remaining debt $6 USD at sale time
    cashierName: 'Terminal 1',
    status: 'completed',
    syncStatus: 'synced',
  };

  // New fluctuating exchange rate: 1 USD = 3000 SDG, 1 SAR = 800 SDG
  const newLiveRates = {
    SDG: 1,
    USD: 3000,
    SAR: 800,
  };

  // 1. Historical Mode in USD: uses the sale-time rate (2500 SDG/USD) => $10.00 total, $6.00 debt
  const histUsd = getConvertedTransactionView(sampleTx, 'USD', newLiveRates, 'historical', 'USD');
  assert.equal(histUsd.grandTotal, 10);
  assert.equal(histUsd.amountPaid, 4);
  assert.equal(histUsd.debtAmount, 6);
  assert.equal(histUsd.hasRateChanged, true);

  // 2. Live Direct Mode in USD: converts 25,000 SDG directly at today's 3000 rate => $8.33 total, $5.00 debt
  const liveUsd = getConvertedTransactionView(sampleTx, 'USD', newLiveRates, 'live', 'USD');
  assert.equal(liveUsd.grandTotal, 8.33);
  assert.equal(liveUsd.debtAmount, 5);

  // 3. Indexed Mode (Linked to New Rate) in SDG: $10 USD anchor * 3000 new rate = 30,000 SDG total, 18,000 SDG debt (+5,000 SDG rate diff)
  const indexedSdg = getConvertedTransactionView(sampleTx, 'SDG', newLiveRates, 'indexed', 'USD');
  assert.equal(indexedSdg.grandTotal, 30000);
  assert.equal(indexedSdg.amountPaid, 12000);
  assert.equal(indexedSdg.debtAmount, 18000);
  assert.equal(indexedSdg.rateDifference, 5000);

  // 4. Indexed Mode in SAR: $10 USD anchor * (3000 / 800) = 37.50 SAR total
  const indexedSar = getConvertedTransactionView(sampleTx, 'SAR', newLiveRates, 'indexed', 'USD');
  assert.equal(indexedSar.grandTotal, 37.5);
  assert.equal(indexedSar.debtAmount, 22.5);

  // 5. Permanently re-pricing transaction to the new exchange rate
  const repriced = repriceTransactionToNewRate(sampleTx, newLiveRates, 'USD');
  assert.equal(repriced.grandTotal, 30000);
  assert.equal(repriced.debtAmount, 18000);
  assert.equal(repriced.exchangeRateUsed, 3000);
  assert.equal(repriced.exchangeRatesSnapshot?.USD, 3000);
});

test('computeStoreReportAnalytics and computeExchangeRateFluctuationSummary compute store badges, product currency charts, and rate fluctuations', () => {
  const products: Product[] = [
    {
      ...mockProductA,
      id: 'prod-1',
      costPrice: 1,
      sellingPrice: 4,
      priceCurrency: 'USD',
      stock: 20,
      minStockAlert: 5,
    },
    {
      ...mockProductB,
      id: 'prod-2',
      costPrice: 2,
      sellingPrice: 5,
      priceCurrency: 'USD',
      stock: 2,
      minStockAlert: 5,
    },
  ];

  const tx1: Transaction = {
    id: 'TXN-REP-1',
    idempotencyKey: 'rep-1',
    timestamp: new Date().toISOString(),
    currency: 'USD',
    exchangeRateUsed: 2700,
    exchangeRatesSnapshot: { SDG: 1, USD: 2700, SAR: 720 },
    items: [
      {
        productId: 'prod-1',
        productName: mockProductA.name,
        sku: mockProductA.sku,
        quantity: 3,
        unitPrice: 4,
        discountPercent: 0,
        total: 12,
      },
    ],
    subtotal: 12,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 12,
    paymentMethod: 'cash',
    amountTendered: 12,
    changeDue: 0,
    paymentStatus: 'paid',
    amountPaid: 12,
    debtAmount: 0,
    fulfillmentType: 'goods_and_invoice',
    fulfillmentStatus: 'received',
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  const tx2: Transaction = {
    id: 'TXN-REP-2',
    idempotencyKey: 'rep-2',
    timestamp: new Date().toISOString(),
    currency: 'USD',
    exchangeRateUsed: 2700,
    exchangeRatesSnapshot: { SDG: 1, USD: 2700, SAR: 720 },
    items: [
      {
        productId: 'prod-2',
        productName: mockProductB.name,
        sku: mockProductB.sku,
        quantity: 2,
        unitPrice: 5,
        discountPercent: 0,
        total: 10,
      },
    ],
    subtotal: 10,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 10,
    paymentMethod: 'bank_transfer',
    amountTendered: 5,
    changeDue: 0,
    paymentStatus: 'partial',
    amountPaid: 5,
    debtAmount: 5,
    fulfillmentType: 'invoice_only',
    fulfillmentStatus: 'pending_goods',
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  const rates = { SDG: 1, USD: 2700, SAR: 720, AED: 735, EUR: 2950, GBP: 3450 };

  const reportInUsd = computeStoreReportAnalytics(
    [tx1, tx2],
    products,
    [],
    'USD',
    rates,
    'live',
    'USD'
  );

  assert.equal(reportInUsd.grossSales, 22);
  assert.equal(reportInUsd.collectedSales, 17);
  assert.equal(reportInUsd.outstandingDebt, 5);
  assert.equal(reportInUsd.fulfillmentStats.receivedCount, 1);
  assert.equal(reportInUsd.fulfillmentStats.pendingGoodsCount, 1);
  assert.equal(reportInUsd.fulfillmentStats.fulfillmentRatePercent, 50);

  // Switch currency to SDG: 22 USD * 2700 = 59,400 SDG
  const reportInSdg = computeStoreReportAnalytics(
    [tx1, tx2],
    products,
    [],
    'SDG',
    rates,
    'live',
    'USD'
  );
  assert.equal(reportInSdg.grossSales, 59400);
  assert.equal(reportInSdg.productReports[0].productId, 'prod-1');
  assert.equal(reportInSdg.productReports[0].unitsSold, 3);
  assert.equal(reportInSdg.productReports[0].pricesByCurrency.USD, 4);
  assert.equal(reportInSdg.productReports[0].pricesByCurrency.SDG, 10800);
  // Historical USD baseline is 2500 -> 4 * 2500 = 10000 SDG vs current 10800 SDG (+8%)
  assert.equal(reportInSdg.productReports[0].historicalUnitPriceInSdg, 10000);
  assert.equal(reportInSdg.productReports[0].currentUnitPriceInSdg, 10800);
  assert.equal(reportInSdg.productReports[0].priceChangePercentInSdg, 8);

  const fluctuations = computeExchangeRateFluctuationSummary(rates, []);
  const usdFluct = fluctuations.find((f) => f.currency === 'USD');
  assert.ok(usdFluct);
  assert.equal(usdFluct.currentRate, 2700);
  assert.equal(usdFluct.previousRate, 2500);
  assert.equal(usdFluct.changePercent, 8);
  assert.equal(usdFluct.direction, 'up');
});

test('multi-unit packaging (strip vs pack of 8 strips) computes unit/pack prices, stock breakdown, and cart totals accurately', () => {
  const dyeProduct: Product = {
    id: 'prod-dye-1',
    name: 'Natural Hair Dye',
    nameAr: 'صبغة شعر طبيعية',
    sku: 'DYE-008',
    barcode: '628990011223',
    category: 'Cosmetics',
    costPrice: 1000, // 1 strip cost = 1000 SDG
    sellingPrice: 1500, // 1 strip sell = 1500 SDG
    priceCurrency: 'SDG',
    stock: 40, // 40 strips = 5 packs of 8 strips
    minStockAlert: 8,
    enablePackaging: true,
    unitName: 'Strip',
    unitNameAr: 'شريط',
    packName: 'Pack',
    packNameAr: 'باكو',
    unitsPerPack: 8,
    defaultSaleUnit: 'unit',
    allowedSaleUnits: 'both',
    packCostPrice: 8000,
    packSellingPrice: 11500, // Custom discounted pack selling price (11,500 SDG instead of 12,000 SDG)
    updatedAt: new Date().toISOString(),
  };

  const pkg = getProductPackaging(dyeProduct);
  assert.equal(pkg.enablePackaging, true);
  assert.equal(pkg.unitsPerPack, 8);
  assert.equal(pkg.unitNameAr, 'شريط');
  assert.equal(pkg.packNameAr, 'باكو');
  assert.equal(pkg.packSellingPrice, 11500);

  // Stock breakdown formatting: 40 strips = "5 باكو (40 شريط)"
  assert.equal(formatProductStockBreakdown(40, dyeProduct, 'ar'), '5 باكو (40 شريط)');
  assert.equal(formatProductStockBreakdown(42, dyeProduct, 'ar'), '5 باكو + 2 شريط (42 شريط)');

  const rates = { SDG: 1, USD: 2500 };

  // Cart item sold by strip ('unit') vs sold by pack ('pack')
  const stripItem: CartItem = {
    product: dyeProduct,
    quantity: 3, // 3 strips
    itemDiscountPercent: 0,
    selectedSaleUnit: 'unit',
  };
  const packItem: CartItem = {
    product: dyeProduct,
    quantity: 2, // 2 packs = 16 strips
    itemDiscountPercent: 0,
    selectedSaleUnit: 'pack',
  };

  const stripPricing = getCartItemUnitPricing(stripItem, 'SDG', rates, 'ar');
  assert.equal(stripPricing.saleUnit, 'unit');
  assert.equal(stripPricing.unitPrice, 1500);
  assert.equal(stripPricing.totalStockUnitsRequired, 3);

  const packPricing = getCartItemUnitPricing(packItem, 'SDG', rates, 'ar');
  assert.equal(packPricing.saleUnit, 'pack');
  assert.equal(packPricing.unitPrice, 11500);
  assert.equal(packPricing.totalStockUnitsRequired, 16);
  assert.equal(packPricing.unitLabel, 'باكو (8 شريط)');

  // Cart totals for 2 packs (2 * 11,500 = 23,000 SDG)
  const totals = calculateCartTotals([packItem], 0, 0, false, 'SDG', rates);
  assert.equal(totals.subtotal, 23000);
  assert.equal(totals.grandTotal, 23000);

  // Validate checkout when ordering 6 packs (48 strips > 40 in stock) -> should fail stock check!
  const overStockPackItem: CartItem = {
    product: dyeProduct,
    quantity: 6,
    itemDiscountPercent: 0,
    selectedSaleUnit: 'pack',
  };
  const invalidCheck = validateCheckout([overStockPackItem], 'cash', 100000, 69000);
  assert.equal(invalidCheck.valid, false);
  assert.ok(invalidCheck.error?.includes('requested: 48'));

  // Fixed discount amount: 23,000 SDG subtotal minus 3,000 SDG custom discount amount = 20,000 SDG
  const fixedDiscountTotals = calculateCartTotals([packItem], 10, 0, false, 'SDG', rates, 3000);
  assert.equal(fixedDiscountTotals.subtotal, 23000);
  assert.equal(fixedDiscountTotals.discountAmount, 3000);
  assert.equal(fixedDiscountTotals.netSubtotal, 20000);
  assert.equal(fixedDiscountTotals.taxAmount, 2000);
  assert.equal(fixedDiscountTotals.grandTotal, 22000);

  // Clamping fixed discount when entered amount exceeds subtotal
  const clampedFixedTotals = calculateCartTotals([packItem], 0, 0, false, 'SDG', rates, 50000);
  assert.equal(clampedFixedTotals.discountAmount, 23000);
  assert.equal(clampedFixedTotals.grandTotal, 0);
});

test('applyDebtSettlementPayment supports partial installments, remaining balance tracking, payment method changes, and multiple receipt images', () => {
  const initialTx: Transaction = {
    id: 'TXN-DEBT-100',
    idempotencyKey: 'idem_100',
    timestamp: '2026-10-30T10:00:00.000Z',
    currency: 'SDG',
    exchangeRateUsed: 2700,
    items: [
      {
        productId: 'prod-1',
        productName: 'Coffee Beans',
        sku: 'CFB-1',
        quantity: 2,
        unitPrice: 5000,
        discountPercent: 0,
        total: 10000,
      },
    ],
    subtotal: 10000,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 10000,
    paymentMethod: 'cash',
    amountTendered: 2000,
    changeDue: 0,
    paymentStatus: 'partial',
    amountPaid: 2000,
    debtAmount: 8000,
    transferReceiptImage: 'https://example.com/receipt-initial.jpg',
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  // 1st installment: Customer pays 5,000 SDG via bank_transfer and attaches 2 receipt images
  const firstStep = applyDebtSettlementPayment(initialTx, {
    amountPaidInDisplayCurrency: 5000,
    displayCurrency: 'SDG',
    paymentMethod: 'bank_transfer',
    transferReference: 'BNK-INST-1',
    receiptImages: ['https://example.com/receipt-inst1-a.jpg', 'https://example.com/receipt-inst1-b.jpg'],
    note: 'First installment',
  });

  assert.equal(firstStep.settledDeltaInTxCurrency, 5000);
  assert.equal(firstStep.updatedTransaction.amountPaid, 7000);
  assert.equal(firstStep.updatedTransaction.debtAmount, 3000);
  assert.equal(firstStep.updatedTransaction.paymentStatus, 'partial');
  assert.equal(firstStep.updatedTransaction.paymentMethod, 'bank_transfer');
  assert.equal(firstStep.updatedTransaction.transferReference, 'BNK-INST-1');
  assert.equal(firstStep.updatedTransaction.debtPayments?.length, 1);
  assert.equal(
    getAllTransactionReceiptImages(firstStep.updatedTransaction).length,
    3
  );

  // 2nd installment: Customer pays remaining 3,000 SDG via qr_nfc and attaches 1 more receipt image
  const secondStep = applyDebtSettlementPayment(firstStep.updatedTransaction, {
    amountPaidInDisplayCurrency: 3000,
    displayCurrency: 'SDG',
    paymentMethod: 'qr_nfc',
    transferReference: 'WALLET-INST-2',
    receiptImages: ['https://example.com/receipt-inst2.jpg'],
    note: 'Final settlement',
  });

  assert.equal(secondStep.settledDeltaInTxCurrency, 3000);
  assert.equal(secondStep.updatedTransaction.amountPaid, 10000);
  assert.equal(secondStep.updatedTransaction.debtAmount, 0);
  assert.equal(secondStep.updatedTransaction.paymentStatus, 'paid');
  assert.equal(secondStep.updatedTransaction.debtPayments?.length, 2);
  assert.equal(
    getAllTransactionReceiptImages(secondStep.updatedTransaction).length,
    4
  );
});

test('invoices default to saved sale-time exchange rate (historical mode) and support locking custom sale rates', () => {
  const txAt2400: Transaction = {
    id: 'TXN-SALE-RATE-2400',
    idempotencyKey: 'idem_2400',
    timestamp: '2026-10-31T08:00:00.000Z',
    currency: 'SDG',
    exchangeRateUsed: 2400,
    exchangeRatesSnapshot: {
      SDG: 1,
      USD: 2400,
      SAR: 640,
    },
    items: [
      {
        productId: 'prod-1',
        productName: 'Roast Coffee',
        sku: 'RC-1',
        quantity: 1,
        unitPrice: 24000,
        discountPercent: 0,
        total: 24000,
      },
    ],
    subtotal: 24000,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 24000, // Worth $10 USD at sale time (rate = 2400)
    paymentMethod: 'cash',
    amountTendered: 12000,
    changeDue: 0,
    paymentStatus: 'partial',
    amountPaid: 12000,
    debtAmount: 12000,
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  // Even when live rates jump to 3000 SDG/USD, default getConvertedTransactionView preserves the saved 2400 sale rate
  const liveRates = { SDG: 1, USD: 3000, SAR: 800 };
  const defaultSdgView = getConvertedTransactionView(txAt2400, 'SDG', liveRates);
  assert.equal(defaultSdgView.grandTotal, 24000);
  assert.equal(defaultSdgView.historicalRate, 2400);
  assert.equal(defaultSdgView.currentRate, 3000);

  const defaultUsdView = getConvertedTransactionView(txAt2400, 'USD', liveRates);
  assert.equal(defaultUsdView.grandTotal, 10);
  assert.equal(defaultUsdView.amountPaid, 5);
  assert.equal(defaultUsdView.debtAmount, 5);

  // Locking a custom sale exchange rate (e.g. 2600 SDG/USD) updates exchangeRateUsed & snapshot without altering SDG total
  const locked2600 = lockTransactionSaleExchangeRate(txAt2400, 2600, 'USD');
  assert.equal(locked2600.grandTotal, 24000);
  assert.equal(locked2600.exchangeRateUsed, 2600);
  assert.equal(locked2600.exchangeRatesSnapshot?.USD, 2600);
});

test('computeDailyRevenueTrends aggregates daily revenue, converts currencies, and identifies performance peaks', () => {
  const refDate = new Date('2026-10-31T15:00:00.000Z');
  const dayMinus2 = new Date(refDate);
  dayMinus2.setDate(refDate.getDate() - 2);
  const dayMinus1 = new Date(refDate);
  dayMinus1.setDate(refDate.getDate() - 1);

  const txDayMinus2: Transaction = {
    id: 'TXN-TREND-1',
    idempotencyKey: 'trend_1',
    timestamp: dayMinus2.toISOString(),
    currency: 'SDG',
    exchangeRateUsed: 2500,
    exchangeRatesSnapshot: { SDG: 1, USD: 2500 },
    items: [
      {
        productId: 'prod-1',
        productName: 'Coffee',
        sku: 'COF-1',
        quantity: 2,
        unitPrice: 25000,
        discountPercent: 0,
        total: 50000,
      },
    ],
    subtotal: 50000,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 50000, // $20 USD at 2500 rate
    paymentMethod: 'cash',
    amountTendered: 50000,
    changeDue: 0,
    paymentStatus: 'paid',
    amountPaid: 50000,
    debtAmount: 0,
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  const txDayMinus1Peak: Transaction = {
    id: 'TXN-TREND-2',
    idempotencyKey: 'trend_2',
    timestamp: dayMinus1.toISOString(),
    currency: 'SDG',
    exchangeRateUsed: 2500,
    exchangeRatesSnapshot: { SDG: 1, USD: 2500 },
    items: [
      {
        productId: 'prod-1',
        productName: 'Coffee',
        sku: 'COF-1',
        quantity: 5,
        unitPrice: 25000,
        discountPercent: 0,
        total: 125000,
      },
    ],
    subtotal: 125000,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 125000, // $50 USD at 2500 rate (Peak Day)
    paymentMethod: 'bank_transfer',
    amountTendered: 100000,
    changeDue: 0,
    paymentStatus: 'partial',
    amountPaid: 100000,
    debtAmount: 25000,
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  const txToday: Transaction = {
    id: 'TXN-TREND-3',
    idempotencyKey: 'trend_3',
    timestamp: refDate.toISOString(),
    currency: 'SDG',
    exchangeRateUsed: 2700,
    exchangeRatesSnapshot: { SDG: 1, USD: 2700 },
    items: [
      {
        productId: 'prod-1',
        productName: 'Coffee',
        sku: 'COF-1',
        quantity: 3,
        unitPrice: 27000,
        discountPercent: 0,
        total: 81000,
      },
    ],
    subtotal: 81000,
    taxRatePercent: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 81000, // $30 USD at 2700 rate
    paymentMethod: 'cash',
    amountTendered: 81000,
    changeDue: 0,
    paymentStatus: 'paid',
    amountPaid: 81000,
    debtAmount: 0,
    cashierName: 'Main',
    status: 'completed',
    syncStatus: 'synced',
  };

  const rates = { SDG: 1, USD: 2700 };

  // Evaluate 7-day trend in SDG
  const summarySdg = computeDailyRevenueTrends(
    [txDayMinus2, txDayMinus1Peak, txToday],
    7,
    'SDG',
    rates,
    'historical',
    'en',
    refDate
  );

  assert.equal(summarySdg.points.length, 7);
  assert.equal(summarySdg.totalRevenue, 256000);
  assert.equal(summarySdg.totalCollected, 231000);
  assert.equal(summarySdg.totalDebt, 25000);
  assert.equal(summarySdg.totalTransactions, 3);
  assert.ok(summarySdg.peakPoint);
  assert.equal(summarySdg.peakPoint?.revenue, 125000);
  assert.equal(summarySdg.peakPoint?.isPeak, true);

  // Evaluate 7-day trend in USD using historical sale-time exchange rates ($20 + $50 + $30 = $100)
  const summaryUsd = computeDailyRevenueTrends(
    [txDayMinus2, txDayMinus1Peak, txToday],
    7,
    'USD',
    rates,
    'historical',
    'en',
    refDate
  );
  assert.equal(summaryUsd.totalRevenue, 100);
  assert.equal(summaryUsd.peakPoint?.revenue, 50);
});
