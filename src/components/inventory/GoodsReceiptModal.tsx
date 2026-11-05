/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppModal } from '../ui/AppModal';
import { AppInput } from '../ui/AppInput';
import { TactileButton } from '../ui/TactileButton';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { formatCurrency, convertCurrencyAmount } from '../../lib/pos-calculations';
import { Product } from '../../lib/types';
import { normalizeNumberInput, parseNormalizedNumber } from '../../lib/number-utils';
import {
  PackageCheck,
  FileText,
  Truck,
  Coins,
  Building2,
  Hash,
  CheckCircle2,
} from 'lucide-react';

export interface GoodsReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProduct?: Product | null;
}

export const GoodsReceiptModal: React.FC<GoodsReceiptModalProps> = ({
  isOpen,
  onClose,
  initialProduct,
}) => {
  const {
    products,
    recordGoodsReceipt,
    settings,
    currencies,
    exchangeRates,
  } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [receiptMode, setReceiptMode] = useState<
    'goods_and_invoice' | 'goods_only' | 'invoice_only'
  >('goods_and_invoice');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantityInput, setQuantityInput] = useState<string>('10');
  const [receiptCurrency, setReceiptCurrency] = useState<string>(settings.currency || 'SDG');
  const [unitCostInput, setUnitCostInput] = useState<string>('');
  const [updateProductCost, setUpdateProductCost] = useState<boolean>(true);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [supplierName, setSupplierName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const activeCurrencyCodes =
    currencies && currencies.length > 0
      ? currencies.filter((c) => c.isActive !== false).map((c) => c.code.toUpperCase())
      : ['SDG', 'USD', 'SAR', 'AED', 'EUR', 'GBP'];

  const selectedProduct = products.find((p) => p.id === selectedProductId) || products[0] || null;

  useEffect(() => {
    if (isOpen) {
      const targetProd = initialProduct || products[0] || null;
      setSelectedProductId(targetProd?.id || '');
      setReceiptMode('goods_and_invoice');
      setQuantityInput('15');
      setReceiptCurrency(settings.currency || 'SDG');
      if (targetProd) {
        const prodCurr = (
          targetProd.priceCurrency ||
          targetProd.customFields?.priceCurrency ||
          'SDG'
        )
          .toString()
          .toUpperCase();
        const convertedCost = convertCurrencyAmount(
          targetProd.costPrice,
          prodCurr,
          settings.currency || 'SDG',
          exchangeRates
        );
        setUnitCostInput(String(convertedCost));
      } else {
        setUnitCostInput('');
      }
      setUpdateProductCost(true);
      setInvoiceNumber(`INV-${Math.floor(1000 + Math.random() * 9000)}`);
      setSupplierName('');
      setNotes('');
    }
  }, [isOpen, initialProduct, products, settings.currency, exchangeRates]);

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
      const prodCurr = (
        prod.priceCurrency ||
        prod.customFields?.priceCurrency ||
        'SDG'
      )
        .toString()
        .toUpperCase();
      const convertedCost = convertCurrencyAmount(
        prod.costPrice,
        prodCurr,
        receiptCurrency,
        exchangeRates
      );
      setUnitCostInput(String(convertedCost));
    }
  };

  const handleCurrencyChange = (nextCurr: string) => {
    const prevCurr = receiptCurrency;
    setReceiptCurrency(nextCurr);
    const currentVal = parseNormalizedNumber(unitCostInput, 0);
    if (currentVal > 0) {
      const converted = convertCurrencyAmount(currentVal, prevCurr, nextCurr, exchangeRates);
      setUnitCostInput(String(converted));
    }
  };

  const qtyNum = Math.max(0, Math.round(parseNormalizedNumber(quantityInput, 0)));
  const unitCostNum = Math.max(0, parseNormalizedNumber(unitCostInput, 0));
  const totalInvoiceValue = Math.round(qtyNum * unitCostNum * 100) / 100;
  const totalInStoreCurrency = convertCurrencyAmount(
    totalInvoiceValue,
    receiptCurrency,
    settings.currency,
    exchangeRates
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || qtyNum <= 0) return;

    const ok = recordGoodsReceipt({
      productId: selectedProduct.id,
      quantity: qtyNum,
      receiptMode,
      supplierName: supplierName.trim() || undefined,
      invoiceNumber: invoiceNumber.trim() || undefined,
      unitCost: unitCostNum > 0 ? unitCostNum : undefined,
      currency: receiptCurrency,
      updateProductCost,
      notes: notes.trim() || undefined,
    });

    if (ok) {
      onClose();
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title={t.receiveSupplierGoodsBtn}
      description={
        isAr
          ? 'تسجيل استلام فاتورة مشتريات أو استلام بضاعة للمخزون مع تحديث الكميات والتكلفة حسب سعر الصرف'
          : 'Record a supplier invoice or goods receipt with automatic stock and multi-currency cost updates'
      }
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 1. Receipt Mode Selector (استلام بضاعة وفاتورة | استلام بضاعة فقط | استلام فاتورة فقط) */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-neutral-300 block">
            {isAr ? 'نوع الاستلام' : 'Receipt Mode'}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              data-testid="goods-receipt-mode-both"
              onClick={() => setReceiptMode('goods_and_invoice')}
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                receiptMode === 'goods_and_invoice'
                  ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-xs'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              <PackageCheck className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{isAr ? 'استلام بضاعة وفاتورة' : 'Goods & Invoice'}</span>
            </button>

            <button
              type="button"
              data-testid="goods-receipt-mode-goods"
              onClick={() => setReceiptMode('goods_only')}
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                receiptMode === 'goods_only'
                  ? 'bg-amber-500/15 border-amber-500 text-amber-300 shadow-xs'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              <Truck className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{isAr ? 'استلام بضاعة فقط' : 'Goods Receipt Only'}</span>
            </button>

            <button
              type="button"
              data-testid="goods-receipt-mode-invoice"
              onClick={() => setReceiptMode('invoice_only')}
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                receiptMode === 'invoice_only'
                  ? 'bg-blue-500/15 border-blue-500 text-blue-300 shadow-xs'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4 shrink-0 text-blue-400" />
              <span>{isAr ? 'استلام فاتورة فقط' : 'Invoice Only'}</span>
            </button>
          </div>
        </div>

        {/* 2. Product & Quantity */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
              {t.productName}
            </label>
            <select
              value={selectedProduct?.id || ''}
              onChange={(e) => handleProductChange(e.target.value)}
              aria-label={t.productName}
              className="w-full min-h-[42px] px-3 py-2 bg-neutral-900 border border-neutral-750 text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-amber-500"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {isAr && p.nameAr ? p.nameAr : p.name} ({p.sku}) — {isAr ? 'المخزون:' : 'Stock:'}{' '}
                  {p.stock}
                </option>
              ))}
            </select>
          </div>

          <div>
            <AppInput
              label={isAr ? 'الكمية المستلمة' : 'Quantity'}
              type="text"
              inputMode="numeric"
              dir="ltr"
              data-testid="goods-receipt-qty-input"
              value={quantityInput}
              onChange={(e) => setQuantityInput(normalizeNumberInput(e.target.value))}
              required
            />
          </div>
        </div>

        {/* 3. Currency & Unit Cost */}
        <div className="p-3.5 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>{isAr ? 'عملة الفاتورة وسعر الشراء' : 'Invoice Currency & Unit Cost'}</span>
            </span>

            <div className="flex flex-wrap gap-1">
              {activeCurrencyCodes.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => handleCurrencyChange(code)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-all ${
                    receiptCurrency === code
                      ? 'bg-amber-500 text-neutral-950 border-amber-400'
                      : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <AppInput
              label={`${isAr ? 'سعر الشراء للوحدة' : 'Unit Cost Price'} (${receiptCurrency})`}
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={unitCostInput}
              onChange={(e) => setUnitCostInput(normalizeNumberInput(e.target.value))}
              placeholder="0.00"
            />

            <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-neutral-400 block">
                  {isAr ? 'إجمالي قيمة الاستلام' : 'Total Receipt Value'}
                </span>
                <span className="text-sm font-mono font-extrabold text-amber-400 tabular-nums">
                  {formatCurrency(totalInvoiceValue, receiptCurrency, settings.language)}
                </span>
              </div>
              {receiptCurrency !== settings.currency && (
                <div className="text-right">
                  <span className="text-[10px] text-neutral-500 block">
                    {isAr ? 'بعمـلة المتجر' : 'In Store Currency'}
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(totalInStoreCurrency, settings.currency, settings.language)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={updateProductCost}
              onChange={(e) => setUpdateProductCost(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-amber-500"
            />
            <span>
              {isAr
                ? 'تحديث سعر التكلفة الأساسي للمنتج تلقائياً حسب سعر الصرف الحالي'
                : 'Automatically update product unit cost price using current exchange rate'}
            </span>
          </label>
        </div>

        {/* 4. Invoice Reference & Supplier Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AppInput
            label={isAr ? 'رقم فاتورة المشتريات / الاستلام' : 'Invoice / Receipt Reference #'}
            dir="ltr"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            leftIcon={<Hash className="w-3.5 h-3.5 text-amber-400" />}
            placeholder="INV-2026-001"
          />

          <AppInput
            label={isAr ? 'اسم المورد / الجهة' : 'Supplier Name'}
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            leftIcon={<Building2 className="w-3.5 h-3.5 text-neutral-400" />}
            placeholder={isAr ? 'مثال: شركة النيلين للتوريد' : 'e.g. Global Roasters Co.'}
          />
        </div>

        <AppInput
          label={t.reason}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            isAr
              ? 'ملاحظات إضافية حول حالة البضاعة أو الفاتورة...'
              : 'Optional notes about goods condition or delivery...'
          }
        />

        {/* Stock Preview Banner */}
        {selectedProduct && (
          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/50 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                {receiptMode === 'invoice_only'
                  ? isAr
                    ? 'سيتم تسجيل الفاتورة فقط دون زيادة المخزون حتى وصول البضاعة'
                    : 'Invoice will be logged; stock remains unchanged until goods arrive'
                  : isAr
                  ? 'سيتم إضافة الكمية المستلمة مباشرة إلى مخزون المنتج'
                  : 'Received quantity will be added immediately to product stock'}
              </span>
            </div>
            <span className="font-mono font-bold text-white tabular-nums shrink-0">
              {selectedProduct.stock} →{' '}
              {receiptMode === 'invoice_only'
                ? selectedProduct.stock
                : selectedProduct.stock + qtyNum}
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
          <TactileButton type="button" variant="ghost" onClick={onClose}>
            {t.cancel}
          </TactileButton>
          <TactileButton
            type="submit"
            variant="emerald"
            data-testid="goods-receipt-submit-btn"
            leftIcon={<PackageCheck className="w-4 h-4" />}
          >
            {isAr ? 'تأكيد وحفظ الاستلام' : 'Confirm Receipt'}
          </TactileButton>
        </div>
      </form>
    </AppModal>
  );
};
