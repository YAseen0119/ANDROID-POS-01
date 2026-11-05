/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CartItem,
  CheckoutPaymentDetails,
  DebtSettlementInput,
  DebtSettlementPayment,
  PaymentMethod,
  PaymentSettlementStatus,
  Product,
  SupportedCurrency,
  AppLanguage,
  Transaction,
  SalesRateValuationMode,
  StockMovement,
  ExchangeRateHistoryEntry,
} from './types';

/**
 * Rounds monetary amounts cleanly: 2 decimals for standard values, up to 4 decimals for micro unit conversions.
 */
export function roundCurrencyValue(value: number, _currency?: string): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.05) {
    return Math.round(value * 10000) / 10000;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Converts a monetary amount between any two currencies using an exchangeRates map
 * where exchangeRates[CODE] represents 1 unit of CODE in base currency (SDG = 1).
 */
export function convertCurrencyAmount(
  amount: number,
  fromCurrency: string = 'SDG',
  toCurrency: string = 'SDG',
  exchangeRates: Record<string, number> = { SDG: 1 }
): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  const from = (fromCurrency || 'SDG').toUpperCase().trim();
  const to = (toCurrency || 'SDG').toUpperCase().trim();
  if (from === to) return roundCurrencyValue(amount);

  const fromRateToSdg =
    from === 'SDG'
      ? 1
      : exchangeRates && exchangeRates[from] && exchangeRates[from] > 0
      ? Number(exchangeRates[from])
      : 1;
  const toRateToSdg =
    to === 'SDG'
      ? 1
      : exchangeRates && exchangeRates[to] && exchangeRates[to] > 0
      ? Number(exchangeRates[to])
      : 1;

  const amountInSdg = amount * fromRateToSdg;
  const converted = amountInSdg / toRateToSdg;
  return roundCurrencyValue(converted);
}

export interface NormalizedProductPackaging {
  enablePackaging: boolean;
  unitName: string;
  unitNameAr: string;
  packName: string;
  packNameAr: string;
  unitsPerPack: number;
  defaultSaleUnit: 'unit' | 'pack';
  allowedSaleUnits: 'both' | 'unit_only' | 'pack_only';
  unitCostPrice: number;
  unitSellingPrice: number;
  packCostPrice: number;
  packSellingPrice: number;
}

/**
 * Extracts and normalizes multi-unit packaging (e.g. Strip vs Pack of 8 Strips) from a Product.
 */
export function getProductPackaging(
  product: Pick<
    Product,
    | 'costPrice'
    | 'sellingPrice'
    | 'enablePackaging'
    | 'unitName'
    | 'unitNameAr'
    | 'packName'
    | 'packNameAr'
    | 'unitsPerPack'
    | 'defaultSaleUnit'
    | 'allowedSaleUnits'
    | 'packCostPrice'
    | 'packSellingPrice'
    | 'customFields'
  >
): NormalizedProductPackaging {
  const cf = product.customFields || {};
  const rawUnitsPerPack = Number(product.unitsPerPack ?? cf.unitsPerPack ?? 1);
  const unitsPerPack =
    Number.isFinite(rawUnitsPerPack) && rawUnitsPerPack >= 2
      ? Math.floor(rawUnitsPerPack)
      : 1;

  const enablePackaging = Boolean(
    (product.enablePackaging ?? cf.enablePackaging ?? false) && unitsPerPack >= 2
  ) || unitsPerPack >= 2;

  const unitName = String(product.unitName || cf.unitName || 'Piece').trim() || 'Piece';
  const unitNameAr = String(product.unitNameAr || cf.unitNameAr || 'قطعة').trim() || 'قطعة';
  const packName = String(product.packName || cf.packName || 'Pack').trim() || 'Pack';
  const packNameAr = String(product.packNameAr || cf.packNameAr || 'باكو').trim() || 'باكو';

  const allowedRaw = product.allowedSaleUnits || cf.allowedSaleUnits || 'both';
  const allowedSaleUnits: 'both' | 'unit_only' | 'pack_only' =
    allowedRaw === 'unit_only' || allowedRaw === 'pack_only' ? allowedRaw : 'both';

  const defaultRaw = product.defaultSaleUnit || cf.defaultSaleUnit || 'unit';
  const defaultSaleUnit: 'unit' | 'pack' =
    !enablePackaging || allowedSaleUnits === 'unit_only'
      ? 'unit'
      : allowedSaleUnits === 'pack_only'
      ? 'pack'
      : defaultRaw === 'pack'
      ? 'pack'
      : 'unit';

  const unitCostPrice = Number(product.costPrice) || 0;
  const unitSellingPrice = Number(product.sellingPrice) || 0;

  const rawPackCost = product.packCostPrice ?? cf.packCostPrice;
  const packCostPrice =
    rawPackCost !== undefined && Number.isFinite(Number(rawPackCost)) && Number(rawPackCost) > 0
      ? roundCurrencyValue(Number(rawPackCost))
      : roundCurrencyValue(unitCostPrice * (enablePackaging ? unitsPerPack : 1));

  const rawPackSelling = product.packSellingPrice ?? cf.packSellingPrice;
  const packSellingPrice =
    rawPackSelling !== undefined &&
    Number.isFinite(Number(rawPackSelling)) &&
    Number(rawPackSelling) > 0
      ? roundCurrencyValue(Number(rawPackSelling))
      : roundCurrencyValue(unitSellingPrice * (enablePackaging ? unitsPerPack : 1));

  return {
    enablePackaging,
    unitName,
    unitNameAr,
    packName,
    packNameAr,
    unitsPerPack: enablePackaging ? unitsPerPack : 1,
    defaultSaleUnit,
    allowedSaleUnits,
    unitCostPrice,
    unitSellingPrice,
    packCostPrice,
    packSellingPrice,
  };
}

/**
 * Formats a product's stock in individual units into a readable Pack + Sub-Unit breakdown
 * (e.g., 40 strips with 8 strips/pack -> "5 باكو (40 شريط)").
 */
export function formatProductStockBreakdown(
  stockOrProduct: number | (Parameters<typeof getProductPackaging>[0] & { stock?: number }),
  productOrLanguage?: Parameters<typeof getProductPackaging>[0] | AppLanguage,
  language: AppLanguage = 'ar'
): string {
  const isFirstArgObject = typeof stockOrProduct === 'object' && stockOrProduct !== null;
  const product = isFirstArgObject
    ? stockOrProduct
    : (productOrLanguage as Parameters<typeof getProductPackaging>[0]);
  const resolvedLanguage: AppLanguage = isFirstArgObject
    ? ((productOrLanguage as AppLanguage) || 'ar')
    : language;
  const rawStock = isFirstArgObject ? Number(stockOrProduct.stock ?? 0) : Number(stockOrProduct);

  const safeStock = Math.max(0, Math.floor(rawStock));
  const pkg = getProductPackaging(product);
  const isAr = resolvedLanguage === 'ar';
  const uLabel = isAr ? pkg.unitNameAr : pkg.unitName;
  const pLabel = isAr ? pkg.packNameAr : pkg.packName;

  if (!pkg.enablePackaging || pkg.unitsPerPack <= 1) {
    return `${safeStock} ${uLabel}`;
  }

  const fullPacks = Math.floor(safeStock / pkg.unitsPerPack);
  const remainderUnits = safeStock % pkg.unitsPerPack;

  if (fullPacks === 0) {
    return `${safeStock} ${uLabel}`;
  }

  if (remainderUnits === 0) {
    return `${fullPacks} ${pLabel} (${safeStock} ${uLabel})`;
  }

  return `${fullPacks} ${pLabel} + ${remainderUnits} ${uLabel} (${safeStock} ${uLabel})`;
}

/**
 * Resolves a product's cost price, selling price, pack prices, unit profit, and profit margin % in the target currency.
 */
export function getProductPricesInCurrency(
  product: Pick<
    Product,
    | 'costPrice'
    | 'sellingPrice'
    | 'priceCurrency'
    | 'enablePackaging'
    | 'unitName'
    | 'unitNameAr'
    | 'packName'
    | 'packNameAr'
    | 'unitsPerPack'
    | 'defaultSaleUnit'
    | 'allowedSaleUnits'
    | 'packCostPrice'
    | 'packSellingPrice'
    | 'customFields'
  >,
  targetCurrency: string = 'SDG',
  exchangeRates: Record<string, number> = { SDG: 1 }
): {
  costPrice: number;
  sellingPrice: number;
  profit: number;
  marginPercent: number;
  packCostPrice: number;
  packSellingPrice: number;
  packProfit: number;
  packMarginPercent: number;
  packaging: NormalizedProductPackaging;
  sourceCurrency: string;
} {
  const sourceCurrency = (
    product.priceCurrency ||
    product.customFields?.priceCurrency ||
    'SDG'
  )
    .toString()
    .toUpperCase()
    .trim();

  const packaging = getProductPackaging(product);

  const costPrice = convertCurrencyAmount(
    product.costPrice,
    sourceCurrency,
    targetCurrency,
    exchangeRates
  );
  const sellingPrice = convertCurrencyAmount(
    product.sellingPrice,
    sourceCurrency,
    targetCurrency,
    exchangeRates
  );
  const profit = roundCurrencyValue(sellingPrice - costPrice);
  const marginPercent =
    sellingPrice > 0 ? Math.round(((sellingPrice - costPrice) / sellingPrice) * 1000) / 10 : 0;

  const packCostPrice = convertCurrencyAmount(
    packaging.packCostPrice,
    sourceCurrency,
    targetCurrency,
    exchangeRates
  );
  const packSellingPrice = convertCurrencyAmount(
    packaging.packSellingPrice,
    sourceCurrency,
    targetCurrency,
    exchangeRates
  );
  const packProfit = roundCurrencyValue(packSellingPrice - packCostPrice);
  const packMarginPercent =
    packSellingPrice > 0
      ? Math.round(((packSellingPrice - packCostPrice) / packSellingPrice) * 1000) / 10
      : 0;

  return {
    costPrice,
    sellingPrice,
    profit,
    marginPercent,
    packCostPrice,
    packSellingPrice,
    packProfit,
    packMarginPercent,
    packaging,
    sourceCurrency,
  };
}

/**
 * Resolves the active sale unit ('unit' vs 'pack'), unit price in targetCurrency, localized unit label,
 * and total base stock units required for a CartItem.
 */
export function getCartItemUnitPricing(
  item: CartItem,
  targetCurrency?: string,
  exchangeRates?: Record<string, number>,
  language: AppLanguage = 'ar'
): {
  saleUnit: 'unit' | 'pack';
  unitLabel: string;
  saleUnitLabel: string;
  unitPrice: number;
  unitSellingPrice: number;
  stockUnitsPerItem: number;
  totalStockUnitsRequired: number;
  packaging: NormalizedProductPackaging;
} {
  const pkg = getProductPackaging(item.product);
  const isAr = language === 'ar';

  const resolvedSaleUnit: 'unit' | 'pack' =
    pkg.enablePackaging &&
    pkg.unitsPerPack > 1 &&
    (item.selectedSaleUnit === 'pack' ||
      (!item.selectedSaleUnit && pkg.defaultSaleUnit === 'pack'))
      ? 'pack'
      : 'unit';

  const converted =
    targetCurrency && exchangeRates
      ? getProductPricesInCurrency(item.product, targetCurrency, exchangeRates)
      : {
          sellingPrice: item.product.sellingPrice,
          packSellingPrice: pkg.packSellingPrice,
        };

  const unitPrice =
    resolvedSaleUnit === 'pack' ? converted.packSellingPrice : converted.sellingPrice;
  const stockUnitsPerItem = resolvedSaleUnit === 'pack' ? pkg.unitsPerPack : 1;
  const totalStockUnitsRequired = Math.max(0, item.quantity * stockUnitsPerItem);

  const unitLabel =
    resolvedSaleUnit === 'pack'
      ? isAr
        ? `${pkg.packNameAr} (${pkg.unitsPerPack} ${pkg.unitNameAr})`
        : `${pkg.packName} (${pkg.unitsPerPack} ${pkg.unitName})`
      : isAr
      ? pkg.unitNameAr
      : pkg.unitName;

  return {
    saleUnit: resolvedSaleUnit,
    unitLabel,
    saleUnitLabel: unitLabel,
    unitPrice,
    unitSellingPrice: unitPrice,
    stockUnitsPerItem,
    totalStockUnitsRequired,
    packaging: pkg,
  };
}

/**
 * Calculates line-item total taking into account unit price, quantity, and item-specific discount percentage.
 */
export function calculateItemTotal(
  price: number,
  quantity: number,
  discountPercent: number = 0
): number {
  if (price < 0 || quantity <= 0) return 0;
  const clampedDiscount = Math.max(0, Math.min(100, discountPercent));
  const rawTotal = price * quantity * (1 - clampedDiscount / 100);
  return roundCurrencyValue(rawTotal);
}

export interface CartTotalsResult {
  subtotal: number;
  discountAmount: number;
  netSubtotal: number;
  taxAmount: number;
  grandTotal: number;
  totalItemsCount: number;
}

/**
 * Computes all cart monetary totals, supporting tax-inclusive, tax-exclusive, multi-unit (piece/strip vs pack),
 * and active currency conversion.
 */
export function calculateCartTotals(
  items: CartItem[],
  taxRatePercent: number = 0,
  globalDiscountPercent: number = 0,
  isTaxInclusive: boolean = false,
  targetCurrency?: string,
  exchangeRates?: Record<string, number>,
  globalDiscountFixedAmount: number = 0
): CartTotalsResult {
  if (!items || items.length === 0) {
    return {
      subtotal: 0,
      discountAmount: 0,
      netSubtotal: 0,
      taxAmount: 0,
      grandTotal: 0,
      totalItemsCount: 0,
    };
  }

  let subtotal = 0;
  let totalItemsCount = 0;

  for (const item of items) {
    const { unitPrice } = getCartItemUnitPricing(
      item,
      targetCurrency,
      exchangeRates
    );

    const itemTotal = calculateItemTotal(
      unitPrice,
      item.quantity,
      item.itemDiscountPercent
    );
    subtotal += itemTotal;
    totalItemsCount += item.quantity;
  }

  subtotal = roundCurrencyValue(subtotal);

  const clampedGlobalDiscount = Math.max(0, Math.min(100, globalDiscountPercent));
  const safeFixedDiscount = Number.isFinite(globalDiscountFixedAmount)
    ? Math.max(0, globalDiscountFixedAmount)
    : 0;
  const discountAmount =
    safeFixedDiscount > 0
      ? roundCurrencyValue(Math.min(subtotal, safeFixedDiscount))
      : roundCurrencyValue(subtotal * (clampedGlobalDiscount / 100));
  const netSubtotal = Math.max(0, roundCurrencyValue(subtotal - discountAmount));

  const safeTaxRate = Math.max(0, taxRatePercent);
  let taxAmount = 0;
  let grandTotal = 0;

  if (isTaxInclusive) {
    // Tax is already baked into prices: Tax = netSubtotal - (netSubtotal / (1 + rate/100))
    taxAmount = roundCurrencyValue(netSubtotal - netSubtotal / (1 + safeTaxRate / 100));
    grandTotal = netSubtotal;
  } else {
    // Tax is added on top of net subtotal
    taxAmount = roundCurrencyValue(netSubtotal * (safeTaxRate / 100));
    grandTotal = roundCurrencyValue(netSubtotal + taxAmount);
  }

  return {
    subtotal,
    discountAmount,
    netSubtotal,
    taxAmount,
    grandTotal,
    totalItemsCount,
  };
}

/**
 * Calculates change to be returned to customer for cash transactions.
 */
export function calculateChangeDue(amountTendered: number, grandTotal: number): number {
  if (amountTendered < grandTotal) return 0;
  return roundCurrencyValue(amountTendered - grandTotal);
}

export interface DebtBreakdownResult {
  paymentStatus: PaymentSettlementStatus;
  amountPaid: number;
  debtAmount: number;
  changeDue: number;
}

/**
 * Calculates paid amount, remaining debt, and change due based on payment status and tendered amount.
 */
export function calculateDebtBreakdown(
  grandTotal: number,
  paymentStatus: PaymentSettlementStatus = 'paid',
  amountTendered?: number
): DebtBreakdownResult {
  const safeTotal = Math.max(0, roundCurrencyValue(grandTotal));

  if (paymentStatus === 'unpaid') {
    return {
      paymentStatus: 'unpaid',
      amountPaid: 0,
      debtAmount: safeTotal,
      changeDue: 0,
    };
  }

  if (paymentStatus === 'partial') {
    const rawPaid = Number.isFinite(amountTendered) ? Math.max(0, Number(amountTendered)) : 0;
    const clampedPaid = roundCurrencyValue(Math.min(safeTotal, rawPaid));
    const debt = roundCurrencyValue(Math.max(0, safeTotal - clampedPaid));
    return {
      paymentStatus: debt <= 0 ? 'paid' : clampedPaid <= 0 ? 'unpaid' : 'partial',
      amountPaid: clampedPaid,
      debtAmount: debt,
      changeDue: 0,
    };
  }

  // Default: 'paid' (Paid in full)
  const tendered =
    amountTendered !== undefined && Number.isFinite(amountTendered)
      ? Math.max(safeTotal, Number(amountTendered))
      : safeTotal;
  return {
    paymentStatus: 'paid',
    amountPaid: safeTotal,
    debtAmount: 0,
    changeDue: roundCurrencyValue(Math.max(0, tendered - safeTotal)),
  };
}

/**
 * Returns a localized display label for any payment method.
 */
export function formatPaymentMethodLabel(
  method: PaymentMethod,
  language: AppLanguage = 'en'
): string {
  const isAr = language === 'ar';
  switch (method) {
    case 'bank_transfer':
      return isAr ? 'تحويل بنكي' : 'Bank Transfer';
    case 'cash':
      return isAr ? 'نقداً (كاش)' : 'Cash';
    case 'qr_nfc':
      return isAr ? 'محفظة رقمية (QR/NFC)' : 'Digital Wallet (QR/NFC)';
    case 'card':
      return isAr ? 'تحويل بنكي / بطاقة' : 'Bank Transfer / Card';
    default:
      return String(method);
  }
}

export interface CheckoutValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates whether a checkout submission satisfies business criteria, including multi-unit stock (strip vs pack),
 * bank transfer reference, and debt rules.
 */
export function validateCheckout(
  items: CartItem[],
  paymentMethod: PaymentMethod,
  amountTendered: number,
  grandTotal: number,
  details?: CheckoutPaymentDetails
): CheckoutValidationResult {
  if (!items || items.length === 0) {
    return { valid: false, error: 'Shopping cart cannot be empty.' };
  }

  if (grandTotal < 0) {
    return { valid: false, error: 'Total amount cannot be negative.' };
  }

  for (const item of items) {
    if (item.quantity <= 0) {
      return { valid: false, error: `Invalid quantity for ${item.product.name}.` };
    }
    const { totalStockUnitsRequired } = getCartItemUnitPricing(item);
    if (totalStockUnitsRequired > item.product.stock) {
      return {
        valid: false,
        error: `Insufficient stock for ${item.product.name}. In stock: ${item.product.stock}, requested: ${totalStockUnitsRequired}.`,
      };
    }
  }

  const paymentStatus: PaymentSettlementStatus = details?.paymentStatus || 'paid';

  // If bank_transfer is chosen and customer is paying (full or partial), require operation reference number
  if (paymentMethod === 'bank_transfer' && paymentStatus !== 'unpaid') {
    const ref = details?.transferReference?.trim() || '';
    if (!ref) {
      return {
        valid: false,
        error: 'Transaction reference number (رقم العملية) is required for Bank Transfer.',
      };
    }
  }

  if (paymentStatus === 'partial') {
    const paid = details?.amountPaid !== undefined ? details.amountPaid : amountTendered;
    if (!Number.isFinite(paid) || paid <= 0) {
      return {
        valid: false,
        error: 'Partial payment amount must be greater than zero, or choose Unpaid (Full Debt).',
      };
    }
    if (paid > grandTotal + 0.0001) {
      return {
        valid: false,
        error: 'Partial payment amount cannot exceed the grand total.',
      };
    }
  } else if (paymentStatus === 'paid' && paymentMethod === 'cash') {
    if (amountTendered < grandTotal - 0.0001) {
      return {
        valid: false,
        error: `Tendered amount ($${amountTendered.toFixed(2)}) is less than total due ($${grandTotal.toFixed(2)}).`,
      };
    }
  }

  return { valid: true };
}

/**
 * Currency formatter with symbol placement and localized numerals.
 */
export function formatCurrency(
  amount: number,
  currency: SupportedCurrency = 'USD',
  locale: string = 'en'
): string {
  const safeAmount = isNaN(amount) ? 0 : amount;
  const code = (currency || 'SDG').toUpperCase();

  const currencySymbols: Record<string, { en: string; ar: string }> = {
    SDG: { en: 'SDG ', ar: ' ج.س' },
    USD: { en: '$', ar: '$' },
    SAR: { en: 'SAR ', ar: ' ر.س' },
    AED: { en: 'AED ', ar: ' د.إ' },
    EUR: { en: '€', ar: '€' },
    GBP: { en: '£', ar: '£' },
    EGP: { en: 'EGP ', ar: ' ج.م' },
    QAR: { en: 'QAR ', ar: ' ر.ق' },
    KWD: { en: 'KWD ', ar: ' د.ك' },
    TRY: { en: '₺', ar: '₺' },
  };

  const isMicro = Math.abs(safeAmount) > 0 && Math.abs(safeAmount) < 0.05;
  const formattedNum = safeAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: isMicro ? 4 : 2,
  });

  const sym = currencySymbols[code] || { en: `${code} `, ar: ` ${code}` };

  if (locale === 'ar') {
    if (['SAR', 'AED', 'SDG', 'EGP', 'QAR', 'KWD'].includes(code) || !currencySymbols[code]) {
      return `${formattedNum}${sym.ar}`;
    }
    return `${sym.ar}${formattedNum}`;
  }

  return `${sym.en}${formattedNum}`;
}

export const DEFAULT_BASELINE_EXCHANGE_RATES: Record<string, number> = {
  SDG: 1,
  USD: 2700,
  SAR: 720,
  AED: 735,
  EUR: 2950,
  GBP: 3450,
};

export interface ConvertedTransactionView {
  currency: SupportedCurrency;
  originalCurrency: SupportedCurrency;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  grandTotal: number;
  amountPaid: number;
  debtAmount: number;
  amountTendered: number;
  changeDue: number;
  items: {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    total: number;
  }[];
  historicalGrandTotal: number;
  liveGrandTotal: number;
  indexedGrandTotal: number;
  rateDifference: number;
  referenceCurrency: string;
  historicalRate: number;
  currentRate: number;
  hasRateChanged: boolean;
}

/**
 * Converts all monetary fields of a Transaction into targetCurrency according to the chosen
 * exchange rate valuation mode:
 * - 'live': Converts from tx.currency -> targetCurrency using current live exchange rates.
 * - 'indexed': Anchors the transaction's value at the time of sale in anchorCurrency (e.g. USD)
 *              using the invoice's historical rate snapshot, and re-values it at the current live rate.
 * - 'historical': Converts from tx.currency -> targetCurrency using the historical snapshot rate at the time of sale.
 */
export function getConvertedTransactionView(
  tx: Transaction,
  targetCurrency: SupportedCurrency = 'SDG',
  currentExchangeRates: Record<string, number> = DEFAULT_BASELINE_EXCHANGE_RATES,
  mode: SalesRateValuationMode = 'historical',
  anchorCurrency: string = 'USD'
): ConvertedTransactionView {
  const txCurrency = (tx.currency || 'SDG').toString().toUpperCase().trim();
  const target = (targetCurrency || 'SDG').toString().toUpperCase().trim();
  const anchor = (anchorCurrency || 'USD').toString().toUpperCase().trim();

  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(currentExchangeRates || {}),
    SDG: 1,
  };

  const snapshotRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(tx.exchangeRatesSnapshot || {}),
    SDG: 1,
  };

  if (tx.exchangeRateUsed && tx.exchangeRateUsed > 0) {
    if (txCurrency !== 'SDG') {
      snapshotRates[txCurrency] = Number(tx.exchangeRateUsed);
    } else {
      snapshotRates[anchor] = Number(tx.exchangeRateUsed);
    }
  }

  const convertAmount = (amount: number, evalMode: SalesRateValuationMode): number => {
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    if (evalMode === 'historical') {
      return convertCurrencyAmount(amount, txCurrency, target, snapshotRates);
    }

    if (evalMode === 'indexed') {
      const txRateSnapshot =
        txCurrency === 'SDG'
          ? 1
          : snapshotRates[txCurrency] && snapshotRates[txCurrency] > 0
          ? Number(snapshotRates[txCurrency])
          : 1;
      const anchorRateSnapshot =
        anchor === 'SDG'
          ? 1
          : snapshotRates[anchor] && snapshotRates[anchor] > 0
          ? Number(snapshotRates[anchor])
          : 1;

      const anchorAmountRaw = (amount * txRateSnapshot) / anchorRateSnapshot;

      const anchorRateLive =
        anchor === 'SDG'
          ? 1
          : liveRates[anchor] && liveRates[anchor] > 0
          ? Number(liveRates[anchor])
          : 1;
      const targetRateLive =
        target === 'SDG'
          ? 1
          : liveRates[target] && liveRates[target] > 0
          ? Number(liveRates[target])
          : 1;

      const finalTargetRaw = (anchorAmountRaw * anchorRateLive) / targetRateLive;
      return roundCurrencyValue(finalTargetRaw);
    }

    // Default: 'live'
    return convertCurrencyAmount(amount, txCurrency, target, liveRates);
  };

  const rawPaid = tx.amountPaid !== undefined ? tx.amountPaid : tx.grandTotal;
  const rawDebt = tx.debtAmount || 0;

  const subtotal = convertAmount(tx.subtotal, mode);
  const taxAmount = convertAmount(tx.taxAmount, mode);
  const discountAmount = convertAmount(tx.discountAmount, mode);
  const grandTotal = convertAmount(tx.grandTotal, mode);
  const amountPaid = convertAmount(rawPaid, mode);
  const debtAmount = convertAmount(rawDebt, mode);
  const amountTendered = convertAmount(tx.amountTendered, mode);
  const changeDue = convertAmount(tx.changeDue, mode);

  const items = tx.items.map((item) => ({
    ...item,
    unitPrice: convertAmount(item.unitPrice, mode),
    total: convertAmount(item.total, mode),
  }));

  const historicalGrandTotal = convertAmount(tx.grandTotal, 'historical');
  const liveGrandTotal = convertAmount(tx.grandTotal, 'live');
  const indexedGrandTotal = convertAmount(tx.grandTotal, 'indexed');
  const rateDifference = roundCurrencyValue(grandTotal - historicalGrandTotal);

  const referenceCurrency = target !== 'SDG' ? target : anchor;
  const historicalRate =
    referenceCurrency === 'SDG' ? 1 : Number(snapshotRates[referenceCurrency] || 1);
  const currentRate =
    referenceCurrency === 'SDG' ? 1 : Number(liveRates[referenceCurrency] || 1);
  const hasRateChanged = Math.abs(currentRate - historicalRate) > 0.0001;

  return {
    currency: target,
    originalCurrency: txCurrency,
    subtotal,
    taxAmount,
    discountAmount,
    grandTotal,
    amountPaid,
    debtAmount,
    amountTendered,
    changeDue,
    items,
    historicalGrandTotal,
    liveGrandTotal,
    indexedGrandTotal,
    rateDifference,
    referenceCurrency,
    historicalRate,
    currentRate,
    hasRateChanged,
  };
}

/**
 * Locks and saves a specific sale-time exchange rate onto a transaction without altering its original sale amounts,
 * ensuring the invoice remains permanently saved at the exchange rate at which the sale was made.
 */
export function lockTransactionSaleExchangeRate(
  tx: Transaction,
  saleRateToSdg: number,
  referenceCurrency: string = 'USD'
): Transaction {
  const safeRate = Number.isFinite(saleRateToSdg) && saleRateToSdg > 0 ? Number(saleRateToSdg) : 2700;
  const txCurrency = (tx.currency || 'SDG').toString().toUpperCase().trim();
  const refCurr = (
    txCurrency !== 'SDG' ? txCurrency : referenceCurrency || 'USD'
  )
    .toString()
    .toUpperCase()
    .trim();

  const existingSnapshot: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(tx.exchangeRatesSnapshot || {}),
    SDG: 1,
  };

  const oldRefRate =
    existingSnapshot[refCurr] && existingSnapshot[refCurr] > 0
      ? existingSnapshot[refCurr]
      : DEFAULT_BASELINE_EXCHANGE_RATES[refCurr] || 2700;
  const scaleFactor = oldRefRate > 0 ? safeRate / oldRefRate : 1;

  const updatedSnapshot: Record<string, number> = { ...existingSnapshot, SDG: 1 };
  for (const [code, val] of Object.entries(existingSnapshot)) {
    if (code === 'SDG') {
      updatedSnapshot[code] = 1;
    } else if (code === refCurr) {
      updatedSnapshot[code] = roundCurrencyValue(safeRate);
    } else if (Number.isFinite(val) && val > 0) {
      updatedSnapshot[code] = roundCurrencyValue(val * scaleFactor);
    }
  }
  updatedSnapshot[refCurr] = roundCurrencyValue(safeRate);

  return {
    ...tx,
    exchangeRateUsed: roundCurrencyValue(safeRate),
    exchangeRatesSnapshot: updatedSnapshot,
  };
}

/**
 * Re-prices a transaction's stored monetary values and remaining debt to the current exchange rate
 * (anchored against anchorCurrency, e.g. USD) and updates its exchangeRatesSnapshot.
 */
export function repriceTransactionToNewRate(
  tx: Transaction,
  currentExchangeRates: Record<string, number>,
  anchorCurrency: string = 'USD'
): Transaction {
  const txCurrency = (tx.currency || 'SDG').toString().toUpperCase().trim();
  const indexedViewInTxCurrency = getConvertedTransactionView(
    tx,
    txCurrency,
    currentExchangeRates,
    'indexed',
    anchorCurrency
  );

  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(currentExchangeRates || {}),
    SDG: 1,
  };
  const anchor = (anchorCurrency || 'USD').toString().toUpperCase().trim();
  const nextRateUsed =
    txCurrency === 'SDG' ? Number(liveRates[anchor] || 2700) : Number(liveRates[txCurrency] || 1);

  return {
    ...tx,
    currency: txCurrency,
    subtotal: indexedViewInTxCurrency.subtotal,
    taxAmount: indexedViewInTxCurrency.taxAmount,
    discountAmount: indexedViewInTxCurrency.discountAmount,
    grandTotal: indexedViewInTxCurrency.grandTotal,
    amountPaid: indexedViewInTxCurrency.amountPaid,
    debtAmount: indexedViewInTxCurrency.debtAmount,
    amountTendered: indexedViewInTxCurrency.amountTendered,
    changeDue: indexedViewInTxCurrency.changeDue,
    items: indexedViewInTxCurrency.items,
    exchangeRateUsed: nextRateUsed,
    exchangeRatesSnapshot: liveRates,
  };
}

/**
 * Returns all unique receipt notification images attached to a transaction
 * (including initial transferReceiptImage, transferReceiptImages array, and all debtPayments installments).
 */
export function getAllTransactionReceiptImages(
  tx?: Pick<Transaction, 'transferReceiptImage' | 'transferReceiptImages' | 'debtPayments'> | null
): string[] {
  if (!tx) return [];
  const list: string[] = [];
  if (tx.transferReceiptImage && tx.transferReceiptImage.trim()) {
    list.push(tx.transferReceiptImage.trim());
  }
  if (Array.isArray(tx.transferReceiptImages)) {
    for (const img of tx.transferReceiptImages) {
      if (img && img.trim() && !list.includes(img.trim())) {
        list.push(img.trim());
      }
    }
  }
  if (Array.isArray(tx.debtPayments)) {
    for (const payment of tx.debtPayments) {
      if (Array.isArray(payment.receiptImages)) {
        for (const img of payment.receiptImages) {
          if (img && img.trim() && !list.includes(img.trim())) {
            list.push(img.trim());
          }
        }
      }
    }
  }
  return list;
}

/**
 * Applies a customizable debt installment or full settlement to a Transaction,
 * supporting custom amount paid, custom total paid, payment method selection,
 * transfer reference, and attaching multiple receipt notification images across installments.
 */
export function applyDebtSettlementPayment(
  tx: Transaction,
  input: DebtSettlementInput = {},
  currentExchangeRates: Record<string, number> = DEFAULT_BASELINE_EXCHANGE_RATES
): {
  updatedTransaction: Transaction;
  paymentRecord: DebtSettlementPayment;
  settledDeltaInTxCurrency: number;
} {
  let baseTx = input.useIndexedNewRate
    ? repriceTransactionToNewRate(tx, currentExchangeRates, input.anchorCurrency || 'USD')
    : tx;

  if (input.customSaleExchangeRate && input.customSaleExchangeRate > 0) {
    baseTx = lockTransactionSaleExchangeRate(
      baseTx,
      input.customSaleExchangeRate,
      input.anchorCurrency || 'USD'
    );
  }

  const txCurrency = (baseTx.currency || 'SDG').toString().toUpperCase().trim();
  const displayCurr = (input.displayCurrency || txCurrency).toString().toUpperCase().trim();
  const anchor = (input.anchorCurrency || 'USD').toString().toUpperCase().trim();

  // Use the transaction's saved sale rate snapshot unless explicitly re-indexing to live rate
  const conversionRatesMap: Record<string, number> = input.useIndexedNewRate
    ? {
        ...DEFAULT_BASELINE_EXCHANGE_RATES,
        ...(currentExchangeRates || {}),
        SDG: 1,
      }
    : {
        ...DEFAULT_BASELINE_EXCHANGE_RATES,
        ...(baseTx.exchangeRatesSnapshot || {}),
        ...(baseTx.exchangeRateUsed && baseTx.exchangeRateUsed > 0
          ? { [txCurrency !== 'SDG' ? txCurrency : anchor]: Number(baseTx.exchangeRateUsed) }
          : {}),
        SDG: 1,
      };

  const grandTotal = Math.max(0, roundCurrencyValue(baseTx.grandTotal));
  const previousPaid = Math.max(
    0,
    roundCurrencyValue(
      baseTx.amountPaid !== undefined
        ? baseTx.amountPaid
        : Math.max(0, grandTotal - (baseTx.debtAmount || 0))
    )
  );
  const previousDebt = Math.max(0, roundCurrencyValue(grandTotal - previousPaid));

  let nextTotalPaid = grandTotal;
  let installmentPaid = previousDebt;

  if (
    input.customTotalPaidInDisplayCurrency !== undefined &&
    Number.isFinite(input.customTotalPaidInDisplayCurrency)
  ) {
    const customTotalInTx =
      displayCurr === txCurrency
        ? input.customTotalPaidInDisplayCurrency
        : convertCurrencyAmount(
            input.customTotalPaidInDisplayCurrency,
            displayCurr,
            txCurrency,
            conversionRatesMap
          );
    nextTotalPaid = roundCurrencyValue(Math.max(0, Math.min(grandTotal, customTotalInTx)));
    installmentPaid = roundCurrencyValue(Math.max(0, nextTotalPaid - previousPaid));
  } else if (
    input.amountPaidInDisplayCurrency !== undefined &&
    Number.isFinite(input.amountPaidInDisplayCurrency)
  ) {
    const rawInstallmentInTx =
      displayCurr === txCurrency
        ? input.amountPaidInDisplayCurrency
        : convertCurrencyAmount(
            input.amountPaidInDisplayCurrency,
            displayCurr,
            txCurrency,
            conversionRatesMap
          );
    // If within 0.02 of remaining debt, snap to full remaining debt to avoid currency conversion dust
    const snappedInstallment =
      Math.abs(rawInstallmentInTx - previousDebt) <= 0.02 ? previousDebt : rawInstallmentInTx;
    installmentPaid = roundCurrencyValue(Math.max(0, Math.min(previousDebt, snappedInstallment)));
    nextTotalPaid = roundCurrencyValue(Math.min(grandTotal, previousPaid + installmentPaid));
  }

  const nextRemainingDebt = Math.max(0, roundCurrencyValue(grandTotal - nextTotalPaid));
  const nextStatus: PaymentSettlementStatus =
    nextRemainingDebt <= 0 ? 'paid' : nextTotalPaid <= 0 ? 'unpaid' : 'partial';

  const chosenMethod: PaymentMethod = input.paymentMethod || baseTx.paymentMethod || 'cash';
  const cleanRef = input.transferReference?.trim() || baseTx.transferReference;
  const newImages = (input.receiptImages || [])
    .map((img) => img.trim())
    .filter((img) => img.length > 0);

  const paymentRecord: DebtSettlementPayment = {
    id: `debt_pay_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`,
    timestamp: new Date().toISOString(),
    amountPaid: installmentPaid > 0 ? installmentPaid : nextTotalPaid,
    remainingDebtAfter: nextRemainingDebt,
    paymentMethod: chosenMethod,
    transferReference: input.transferReference?.trim() || undefined,
    receiptImages: newImages.length > 0 ? newImages : undefined,
    note: input.note?.trim() || undefined,
  };

  const existingPayments = Array.isArray(baseTx.debtPayments) ? baseTx.debtPayments : [];
  const combinedReceiptImages = getAllTransactionReceiptImages({
    transferReceiptImage: baseTx.transferReceiptImage,
    transferReceiptImages: baseTx.transferReceiptImages,
    debtPayments: [...existingPayments, paymentRecord],
  });

  const settledDeltaInTxCurrency = roundCurrencyValue(nextTotalPaid - previousPaid);

  const updatedTransaction: Transaction = {
    ...baseTx,
    paymentMethod: chosenMethod,
    paymentStatus: nextStatus,
    amountPaid: nextTotalPaid,
    debtAmount: nextRemainingDebt,
    amountTendered: Math.max(baseTx.amountTendered || 0, nextTotalPaid),
    transferReference: cleanRef,
    transferReceiptImage:
      newImages[newImages.length - 1] ||
      baseTx.transferReceiptImage ||
      combinedReceiptImages[0] ||
      undefined,
    transferReceiptImages: combinedReceiptImages,
    debtPayments: [...existingPayments, paymentRecord],
  };

  return {
    updatedTransaction,
    paymentRecord,
    settledDeltaInTxCurrency,
  };
}

export type PerformanceBadgeLevel = 'excellent' | 'good' | 'warning';

export interface ProductSalesAndCurrencyReport {
  productId: string;
  name: string;
  nameAr?: string;
  sku: string;
  emoji?: string;
  stock: number;
  minStockAlert: number;
  unitsSold: number;
  orderCount: number;
  revenue: number;
  estimatedCost: number;
  netProfit: number;
  marginPercent: number;
  revenueSharePercent: number;
  unitPriceInActiveCurrency: number;
  pricesByCurrency: Record<string, number>;
  revenuesByCurrency: Record<string, number>;
  historicalUnitPriceInSdg: number;
  currentUnitPriceInSdg: number;
  priceChangeDeltaInSdg: number;
  priceChangePercentInSdg: number;
  salesTrendPoints: number[];
}

export interface StoreReportAnalytics {
  currency: SupportedCurrency;
  grossSales: number;
  collectedSales: number;
  outstandingDebt: number;
  totalTaxCollected: number;
  totalDiscountsGiven: number;
  estimatedCost: number;
  netGrossProfit: number;
  avgOrderValue: number;
  totalOrders: number;
  profitMarginPercent: number;
  collectionRatePercent: number;
  fulfillmentStats: {
    receivedCount: number;
    pendingGoodsCount: number;
    pendingInvoiceCount: number;
    totalPendingCount: number;
    fulfillmentRatePercent: number;
    supplierGoodsReceiptsCount: number;
  };
  inventoryHealth: {
    totalSkus: number;
    healthySkus: number;
    lowStockSkus: number;
    outOfStockSkus: number;
    readinessPercent: number;
  };
  performanceBadges: {
    profit: { level: PerformanceBadgeLevel; valuePercent: number };
    collection: { level: PerformanceBadgeLevel; valuePercent: number };
    fulfillment: { level: PerformanceBadgeLevel; valuePercent: number };
    inventory: { level: PerformanceBadgeLevel; valuePercent: number };
  };
  paymentCounts: Record<string, { count: number; total: number; sharePercent: number }>;
  productReports: ProductSalesAndCurrencyReport[];
}

export const HISTORICAL_BASELINE_RATES_TO_SDG: Record<string, number> = {
  SDG: 1,
  USD: 2500,
  SAR: 670,
  AED: 680,
  EUR: 2700,
  GBP: 3150,
};

/**
 * Computes store performance metrics, badges, and per-product sales + multi-currency price analytics.
 */
export function computeStoreReportAnalytics(
  transactions: Transaction[],
  products: Product[],
  stockMovements: StockMovement[] = [],
  targetCurrency: SupportedCurrency = 'SDG',
  currentExchangeRates: Record<string, number> = DEFAULT_BASELINE_EXCHANGE_RATES,
  valuationMode: SalesRateValuationMode = 'indexed',
  anchorCurrency: string = 'USD'
): StoreReportAnalytics {
  const completedTx = transactions.filter((t) => t.status === 'completed');
  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(currentExchangeRates || {}),
    SDG: 1,
  };

  let grossSales = 0;
  let collectedSales = 0;
  let outstandingDebt = 0;
  let totalTaxCollected = 0;
  let totalDiscountsGiven = 0;
  let estimatedCost = 0;

  let receivedCount = 0;
  let pendingGoodsCount = 0;
  let pendingInvoiceCount = 0;

  const paymentCounts: Record<string, { count: number; total: number; sharePercent: number }> = {
    bank_transfer: { count: 0, total: 0, sharePercent: 0 },
    cash: { count: 0, total: 0, sharePercent: 0 },
    qr_nfc: { count: 0, total: 0, sharePercent: 0 },
  };

  const prodStatsMap: Record<
    string,
    {
      units: number;
      orders: number;
      revenue: number;
      cost: number;
      trend: number[];
    }
  > = {};

  for (const p of products) {
    prodStatsMap[p.id] = {
      units: 0,
      orders: 0,
      revenue: 0,
      cost: 0,
      trend: [],
    };
  }

  // Process oldest to newest for chronological product trend points
  const chronologicalTx = [...completedTx].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const tx of chronologicalTx) {
    const view = getConvertedTransactionView(
      tx,
      targetCurrency,
      liveRates,
      valuationMode,
      anchorCurrency
    );

    grossSales += view.grandTotal;
    collectedSales += view.amountPaid;
    outstandingDebt += view.debtAmount;
    totalTaxCollected += view.taxAmount;
    totalDiscountsGiven += view.discountAmount;

    const fStatus = tx.fulfillmentStatus || 'received';
    if (fStatus === 'pending_goods') {
      pendingGoodsCount += 1;
    } else if (fStatus === 'pending_invoice') {
      pendingInvoiceCount += 1;
    } else {
      receivedCount += 1;
    }

    const methodKey = tx.paymentMethod === 'card' ? 'bank_transfer' : tx.paymentMethod;
    if (paymentCounts[methodKey]) {
      paymentCounts[methodKey].count += 1;
      paymentCounts[methodKey].total = roundCurrencyValue(
        paymentCounts[methodKey].total + view.grandTotal
      );
    }

    const seenInThisTx = new Set<string>();

    for (const item of view.items) {
      const prod = products.find((p) => p.id === item.productId);
      const unitCostConverted = prod
        ? getProductPricesInCurrency(prod, targetCurrency, liveRates).costPrice
        : roundCurrencyValue(item.unitPrice * 0.45);
      const lineCost = roundCurrencyValue(unitCostConverted * item.quantity);
      estimatedCost += lineCost;

      if (!prodStatsMap[item.productId]) {
        prodStatsMap[item.productId] = {
          units: 0,
          orders: 0,
          revenue: 0,
          cost: 0,
          trend: [],
        };
      }
      prodStatsMap[item.productId].units += item.quantity;
      prodStatsMap[item.productId].revenue = roundCurrencyValue(
        prodStatsMap[item.productId].revenue + item.total
      );
      prodStatsMap[item.productId].cost = roundCurrencyValue(
        prodStatsMap[item.productId].cost + lineCost
      );
      prodStatsMap[item.productId].trend.push(item.quantity);

      if (!seenInThisTx.has(item.productId)) {
        prodStatsMap[item.productId].orders += 1;
        seenInThisTx.add(item.productId);
      }
    }
  }

  grossSales = roundCurrencyValue(grossSales);
  collectedSales = roundCurrencyValue(collectedSales);
  outstandingDebt = roundCurrencyValue(outstandingDebt);
  totalTaxCollected = roundCurrencyValue(totalTaxCollected);
  totalDiscountsGiven = roundCurrencyValue(totalDiscountsGiven);
  estimatedCost = roundCurrencyValue(estimatedCost);

  const netGrossProfit = roundCurrencyValue(
    Math.max(0, grossSales - estimatedCost - totalTaxCollected)
  );
  const avgOrderValue =
    completedTx.length > 0 ? roundCurrencyValue(grossSales / completedTx.length) : 0;

  const profitMarginPercent =
    grossSales > 0 ? Math.round((netGrossProfit / grossSales) * 1000) / 10 : 0;
  const collectionRatePercent =
    grossSales > 0 ? Math.round((collectedSales / grossSales) * 1000) / 10 : 100;

  const totalPendingCount = pendingGoodsCount + pendingInvoiceCount;
  const fulfillmentRatePercent =
    completedTx.length > 0
      ? Math.round((receivedCount / completedTx.length) * 1000) / 10
      : 100;

  const supplierGoodsReceiptsCount = stockMovements.filter((m) => m.type === 'restock').length;

  let healthySkus = 0;
  let lowStockSkus = 0;
  let outOfStockSkus = 0;
  for (const p of products) {
    if (p.stock <= 0) {
      outOfStockSkus += 1;
    } else if (p.stock <= p.minStockAlert) {
      lowStockSkus += 1;
    } else {
      healthySkus += 1;
    }
  }
  const readinessPercent =
    products.length > 0 ? Math.round((healthySkus / products.length) * 1000) / 10 : 100;

  for (const key of Object.keys(paymentCounts)) {
    paymentCounts[key].sharePercent =
      grossSales > 0
        ? Math.round((paymentCounts[key].total / grossSales) * 1000) / 10
        : 0;
  }

  const classifyBadge = (
    pct: number,
    excellentThreshold: number,
    goodThreshold: number
  ): PerformanceBadgeLevel => {
    if (pct >= excellentThreshold) return 'excellent';
    if (pct >= goodThreshold) return 'good';
    return 'warning';
  };

  const comparisonCurrencies = ['SDG', 'USD', 'SAR', 'AED', 'EUR'];

  const productReports: ProductSalesAndCurrencyReport[] = products
    .map((p) => {
      const stat = prodStatsMap[p.id] || {
        units: 0,
        orders: 0,
        revenue: 0,
        cost: 0,
        trend: [],
      };
      const convertedCurrent = getProductPricesInCurrency(p, targetCurrency, liveRates);

      // Compute how this product's local SDG price changed between historical baseline rate and current rate
      const prodSourceCurrency = (
        p.priceCurrency ||
        p.customFields?.priceCurrency ||
        'SDG'
      )
        .toString()
        .toUpperCase()
        .trim();

      let historicalUnitPriceInSdg = 0;
      let currentUnitPriceInSdg = 0;

      if (prodSourceCurrency !== 'SDG') {
        historicalUnitPriceInSdg = convertCurrencyAmount(
          p.sellingPrice,
          prodSourceCurrency,
          'SDG',
          HISTORICAL_BASELINE_RATES_TO_SDG
        );
        currentUnitPriceInSdg = convertCurrencyAmount(
          p.sellingPrice,
          prodSourceCurrency,
          'SDG',
          liveRates
        );
      } else {
        // Product stored in SDG or USD-equivalent baseline: anchor against USD to illustrate currency rate shift
        const usdBaseline = HISTORICAL_BASELINE_RATES_TO_SDG[anchorCurrency] || 2500;
        const usdCurrent = liveRates[anchorCurrency] || 2700;
        const basePriceInSdg =
          p.sellingPrice < 100 ? p.sellingPrice * usdBaseline : p.sellingPrice;
        historicalUnitPriceInSdg = roundCurrencyValue(basePriceInSdg);
        currentUnitPriceInSdg = roundCurrencyValue(
          (basePriceInSdg / usdBaseline) * usdCurrent
        );
      }

      const pricesByCurrency: Record<string, number> = {};
      const revenuesByCurrency: Record<string, number> = {};
      for (const code of comparisonCurrencies) {
        pricesByCurrency[code] =
          prodSourceCurrency === 'SDG' && p.sellingPrice < 100
            ? convertCurrencyAmount(currentUnitPriceInSdg, 'SDG', code, liveRates)
            : getProductPricesInCurrency(p, code, liveRates).sellingPrice;
        revenuesByCurrency[code] = convertCurrencyAmount(
          stat.revenue,
          targetCurrency,
          code,
          liveRates
        );
      }

      const priceChangeDeltaInSdg = roundCurrencyValue(
        currentUnitPriceInSdg - historicalUnitPriceInSdg
      );
      const priceChangePercentInSdg =
        historicalUnitPriceInSdg > 0
          ? Math.round((priceChangeDeltaInSdg / historicalUnitPriceInSdg) * 1000) / 10
          : 0;

      const netProfit = roundCurrencyValue(Math.max(0, stat.revenue - stat.cost));
      const marginPercent =
        stat.revenue > 0
          ? Math.round((netProfit / stat.revenue) * 1000) / 10
          : convertedCurrent.marginPercent;
      const revenueSharePercent =
        grossSales > 0 ? Math.round((stat.revenue / grossSales) * 1000) / 10 : 0;

      const trendPoints =
        stat.trend.length > 0 ? stat.trend : [0];

      return {
        productId: p.id,
        name: p.name,
        nameAr: p.nameAr,
        sku: p.sku,
        emoji: p.emoji,
        stock: p.stock,
        minStockAlert: p.minStockAlert,
        unitsSold: stat.units,
        orderCount: stat.orders,
        revenue: stat.revenue,
        estimatedCost: stat.cost,
        netProfit,
        marginPercent,
        revenueSharePercent,
        unitPriceInActiveCurrency: convertedCurrent.sellingPrice,
        pricesByCurrency,
        revenuesByCurrency,
        historicalUnitPriceInSdg,
        currentUnitPriceInSdg,
        priceChangeDeltaInSdg,
        priceChangePercentInSdg,
        salesTrendPoints: trendPoints,
      };
    })
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue);

  return {
    currency: targetCurrency,
    grossSales,
    collectedSales,
    outstandingDebt,
    totalTaxCollected,
    totalDiscountsGiven,
    estimatedCost,
    netGrossProfit,
    avgOrderValue,
    totalOrders: completedTx.length,
    profitMarginPercent,
    collectionRatePercent,
    fulfillmentStats: {
      receivedCount,
      pendingGoodsCount,
      pendingInvoiceCount,
      totalPendingCount,
      fulfillmentRatePercent,
      supplierGoodsReceiptsCount,
    },
    inventoryHealth: {
      totalSkus: products.length,
      healthySkus,
      lowStockSkus,
      outOfStockSkus,
      readinessPercent,
    },
    performanceBadges: {
      profit: {
        level: classifyBadge(profitMarginPercent, 45, 25),
        valuePercent: profitMarginPercent,
      },
      collection: {
        level: classifyBadge(collectionRatePercent, 85, 60),
        valuePercent: collectionRatePercent,
      },
      fulfillment: {
        level: classifyBadge(fulfillmentRatePercent, 90, 70),
        valuePercent: fulfillmentRatePercent,
      },
      inventory: {
        level: classifyBadge(readinessPercent, 80, 60),
        valuePercent: readinessPercent,
      },
    },
    paymentCounts,
    productReports,
  };
}

export interface CurrencyFluctuationBadgeItem {
  currency: string;
  baselineRate: number;
  previousRate: number;
  currentRate: number;
  delta: number;
  changePercent: number;
  direction: 'up' | 'down' | 'stable';
  historyPoints: number[];
  lastUpdated?: string;
}

/**
 * Computes exchange rate fluctuation badges and historical rate trend series for all foreign currencies.
 */
export function computeExchangeRateFluctuationSummary(
  currentExchangeRates: Record<string, number> = DEFAULT_BASELINE_EXCHANGE_RATES,
  rateHistory: ExchangeRateHistoryEntry[] = [],
  baselineRates: Record<string, number> = HISTORICAL_BASELINE_RATES_TO_SDG
): CurrencyFluctuationBadgeItem[] {
  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(currentExchangeRates || {}),
    SDG: 1,
  };

  const codes = Array.from(
    new Set([
      'USD',
      'SAR',
      'AED',
      'EUR',
      'GBP',
      ...Object.keys(liveRates).filter((c) => c.toUpperCase() !== 'SDG'),
    ])
  );

  return codes.map((code) => {
    const cleanCode = code.toUpperCase().trim();
    const currentRate = Number(liveRates[cleanCode] || 1);
    const baselineRate = Number(
      baselineRates[cleanCode] ||
        Math.round(currentRate * 0.92 * 100) / 100 ||
        currentRate
    );

    const matchingHistory = rateHistory
      .filter((h) => h.currency.toUpperCase() === cleanCode)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const lastEntry =
      matchingHistory.length > 0 ? matchingHistory[matchingHistory.length - 1] : undefined;
    const previousRate =
      lastEntry && Math.abs(lastEntry.previousRate - currentRate) > 0.0001
        ? lastEntry.previousRate
        : baselineRate;

    const delta = roundCurrencyValue(currentRate - previousRate);
    const changePercent =
      previousRate > 0 ? Math.round((delta / previousRate) * 1000) / 10 : 0;

    const direction: 'up' | 'down' | 'stable' =
      changePercent > 0.05 ? 'up' : changePercent < -0.05 ? 'down' : 'stable';

    const rawPoints: number[] = [
      baselineRate,
      ...matchingHistory.map((h) => h.newRate),
      currentRate,
    ];
    // Deduplicate consecutive identical points while preserving at least 4 points for visual chart
    const historyPoints =
      rawPoints.length >= 4
        ? rawPoints.slice(-6)
        : [
            Math.round(baselineRate * 0.96 * 100) / 100,
            baselineRate,
            Math.round(((baselineRate + currentRate) / 2) * 100) / 100,
            currentRate,
          ];

    return {
      currency: cleanCode,
      baselineRate,
      previousRate,
      currentRate,
      delta,
      changePercent,
      direction,
      historyPoints,
      lastUpdated: lastEntry?.timestamp,
    };
  });
}

export interface DailyRevenueTrendPoint {
  dateKey: string;
  timestamp: string;
  label: string;
  weekdayLabel: string;
  revenue: number;
  collected: number;
  debt: number;
  transactionCount: number;
  avgOrderValue: number;
  isPeak: boolean;
  isToday: boolean;
}

export interface DailyRevenueTrendSummary {
  points: DailyRevenueTrendPoint[];
  peakPoint: DailyRevenueTrendPoint | null;
  totalRevenue: number;
  totalCollected: number;
  totalDebt: number;
  averageDailyRevenue: number;
  activeDaysAverageRevenue: number;
  totalTransactions: number;
  growthPercent: number;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Aggregates completed transactions into chronological daily revenue buckets for D3 visualization,
 * identifying performance peaks, daily averages, and period-over-period momentum in the active currency.
 */
export function computeDailyRevenueTrends(
  transactions: Transaction[],
  daysCount: number = 7,
  targetCurrency: SupportedCurrency = 'SDG',
  currentExchangeRates: Record<string, number> = DEFAULT_BASELINE_EXCHANGE_RATES,
  valuationMode: SalesRateValuationMode = 'historical',
  language: AppLanguage = 'en',
  referenceDate: Date = new Date(),
  anchorCurrency: string = 'USD'
): DailyRevenueTrendSummary {
  const safeDays = Math.max(2, Math.min(90, Math.floor(daysCount || 7)));
  const isAr = language === 'ar';
  const localeCode = isAr ? 'ar-SA' : 'en-US';

  const endDay = new Date(referenceDate);
  endDay.setHours(0, 0, 0, 0);
  const todayKey = toLocalDateKey(endDay);

  const bucketsMap = new Map<
    string,
    {
      date: Date;
      revenue: number;
      collected: number;
      debt: number;
      transactionCount: number;
    }
  >();

  for (let i = safeDays - 1; i >= 0; i--) {
    const d = new Date(endDay);
    d.setDate(endDay.getDate() - i);
    const key = toLocalDateKey(d);
    bucketsMap.set(key, {
      date: d,
      revenue: 0,
      collected: 0,
      debt: 0,
      transactionCount: 0,
    });
  }

  const completedTx = (transactions || []).filter((t) => t && t.status === 'completed');

  for (const tx of completedTx) {
    const txDate = new Date(tx.timestamp);
    if (isNaN(txDate.getTime())) continue;
    const key = toLocalDateKey(txDate);
    const bucket = bucketsMap.get(key);
    if (!bucket) continue;

    const converted = getConvertedTransactionView(
      tx,
      targetCurrency,
      currentExchangeRates,
      valuationMode,
      anchorCurrency
    );

    bucket.revenue = roundCurrencyValue(bucket.revenue + converted.grandTotal);
    bucket.collected = roundCurrencyValue(bucket.collected + converted.amountPaid);
    bucket.debt = roundCurrencyValue(bucket.debt + converted.debtAmount);
    bucket.transactionCount += 1;
  }

  let maxRevenue = 0;
  let peakKey: string | null = null;

  for (const [key, bucket] of bucketsMap.entries()) {
    if (bucket.revenue > maxRevenue) {
      maxRevenue = bucket.revenue;
      peakKey = key;
    }
  }

  let totalRevenue = 0;
  let totalCollected = 0;
  let totalDebt = 0;
  let totalTransactions = 0;
  let activeDaysCount = 0;

  const points: DailyRevenueTrendPoint[] = [];

  for (const [key, bucket] of bucketsMap.entries()) {
    const avgOrderValue =
      bucket.transactionCount > 0
        ? roundCurrencyValue(bucket.revenue / bucket.transactionCount)
        : 0;
    const isPeak = peakKey !== null && key === peakKey && bucket.revenue > 0;
    const isToday = key === todayKey;

    const label = bucket.date.toLocaleDateString(localeCode, {
      month: 'short',
      day: 'numeric',
    });
    const weekdayLabel = bucket.date.toLocaleDateString(localeCode, {
      weekday: 'short',
    });

    totalRevenue = roundCurrencyValue(totalRevenue + bucket.revenue);
    totalCollected = roundCurrencyValue(totalCollected + bucket.collected);
    totalDebt = roundCurrencyValue(totalDebt + bucket.debt);
    totalTransactions += bucket.transactionCount;
    if (bucket.revenue > 0) {
      activeDaysCount += 1;
    }

    points.push({
      dateKey: key,
      timestamp: bucket.date.toISOString(),
      label,
      weekdayLabel,
      revenue: bucket.revenue,
      collected: bucket.collected,
      debt: bucket.debt,
      transactionCount: bucket.transactionCount,
      avgOrderValue,
      isPeak,
      isToday,
    });
  }

  const peakPoint = points.find((p) => p.isPeak) || null;
  const averageDailyRevenue = roundCurrencyValue(totalRevenue / safeDays);
  const activeDaysAverageRevenue =
    activeDaysCount > 0 ? roundCurrencyValue(totalRevenue / activeDaysCount) : 0;

  // Compute momentum growth % comparing recent half vs earlier half of the window
  const halfIndex = Math.floor(points.length / 2);
  const firstHalfRev = points
    .slice(0, halfIndex)
    .reduce((acc, p) => acc + p.revenue, 0);
  const secondHalfRev = points
    .slice(halfIndex)
    .reduce((acc, p) => acc + p.revenue, 0);
  const firstHalfAvg = halfIndex > 0 ? firstHalfRev / halfIndex : 0;
  const secondHalfCount = Math.max(1, points.length - halfIndex);
  const secondHalfAvg = secondHalfRev / secondHalfCount;

  const growthPercent =
    firstHalfAvg > 0
      ? Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 1000) / 10
      : secondHalfAvg > 0
      ? 100
      : 0;

  return {
    points,
    peakPoint,
    totalRevenue,
    totalCollected,
    totalDebt,
    averageDailyRevenue,
    activeDaysAverageRevenue,
    totalTransactions,
    growthPercent,
  };
}
