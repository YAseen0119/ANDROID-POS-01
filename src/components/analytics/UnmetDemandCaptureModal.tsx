/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 (Part 4A & 4B): Fast Customer Unmet Demand Request Capture Modal
 * Enables cashiers and inventory staff to record unavailable/out-of-stock/expired/unregistered
 * customer product requests in 2–3 clicks without mutating sales, stock, or accounting ledgers.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Barcode,
  Building2,
  CheckCircle2,
  ClipboardList,
  Layers,
  PackagePlus,
  PackageX,
  Plus,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { DEFAULT_ANALYTICS_BRANCHES as DEFAULT_BRANCHES } from '../../analytics/analytics.snapshot';
import {
  SUPPORTED_UNAVAILABILITY_REASONS,
  UnavailabilityReason,
} from '../../analytics/analytics.types';
import { getProductPackaging } from '../../lib/pos-calculations';

const REASON_OPTIONS: Array<{
  value: UnavailabilityReason;
  labelEn: string;
  labelAr: string;
  badgeClass: string;
}> = [
  {
    value: 'OUT_OF_STOCK',
    labelEn: 'Out of Stock (Zero / Insufficient Inventory)',
    labelAr: 'نفاد المخزون (الرصيد صفر أو غير كافٍ)',
    badgeClass: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  },
  {
    value: 'EXPIRED',
    labelEn: 'Expired Batch on Shelf',
    labelAr: 'المنتج منتهي الصلاحية على الرف',
    badgeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  },
  {
    value: 'NOT_STOCKED',
    labelEn: 'Not Stocked / Unregistered Product',
    labelAr: 'غير مسجل أو غير متوفر بالمتجر',
    badgeClass: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  },
  {
    value: 'TEMPORARILY_UNAVAILABLE',
    labelEn: 'Temporarily Unavailable / In Transit',
    labelAr: 'غير متوفر مؤقتاً / قيد التوريد',
    badgeClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  },
  {
    value: 'OTHER',
    labelEn: 'Other Reason',
    labelAr: 'سبب آخر',
    badgeClass: 'border-neutral-500/40 bg-neutral-500/15 text-neutral-300',
  },
];

export const UnmetDemandCaptureModal: React.FC = () => {
  const {
    products,
    customers,
    settings,
    currentUser,
    selectedCustomer,
    isUnmetDemandModalOpen,
    unmetDemandModalInitialData,
    closeUnmetDemandModal,
    recordUnmetDemandRequest,
  } = usePOS();

  const isAr = settings.language === 'ar';

  const [mode, setMode] = useState<'registered' | 'unregistered'>('registered');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productSearch, setProductSearch] = useState<string>('');
  const [unregisteredName, setUnregisteredName] = useState<string>('');
  const [unregisteredNameAr, setUnregisteredNameAr] = useState<string>('');
  const [barcode, setBarcode] = useState<string>('');
  const [categorySnapshot, setCategorySnapshot] = useState<string>('General');
  const [requestedQuantity, setRequestedQuantity] = useState<number>(1);
  const [saleUnitMode, setSaleUnitMode] = useState<'unit' | 'pack'>('unit');
  const [unavailabilityReason, setUnavailabilityReason] =
    useState<UnavailabilityReason>('OUT_OF_STOCK');
  const [confirmedPurchaseIntent, setConfirmedPurchaseIntent] =
    useState<boolean>(true);
  const [branchId, setBranchId] = useState<string>('branch-main');
  const [customerId, setCustomerId] = useState<string>('');
  const [customerReference, setCustomerReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [sourceScreen, setSourceScreen] = useState<
    'checkout' | 'products' | 'analytics' | 'other'
  >('checkout');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'duplicate' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isUnmetDemandModalOpen) return;
    setFeedback(null);

    const init = unmetDemandModalInitialData || {};
    const initialProdId = init.productId || '';
    const hasInitialProduct = Boolean(
      initialProdId && products.some((p) => p.id === initialProdId)
    );

    if (init.isRegisteredProduct === false || (!hasInitialProduct && init.productNameSnapshot)) {
      setMode('unregistered');
      setSelectedProductId('');
      setUnregisteredName(init.productNameSnapshot || '');
      setUnregisteredNameAr(init.productNameArSnapshot || '');
      setBarcode(init.barcode || '');
      setCategorySnapshot(init.categorySnapshot || 'General');
      setUnavailabilityReason(
        (init.unavailabilityReason as UnavailabilityReason) || 'NOT_STOCKED'
      );
    } else {
      setMode('registered');
      if (hasInitialProduct) {
        setSelectedProductId(initialProdId!);
      } else {
        // Default to first low-stock or zero-stock product for convenience
        const lowOrZero =
          products.find((p) => p.stock <= 0) ||
          products.find((p) => p.stock <= (p.minStockAlert || 5)) ||
          products[0];
        setSelectedProductId(lowOrZero ? lowOrZero.id : '');
      }
      setUnregisteredName('');
      setUnregisteredNameAr('');
      setBarcode(init.barcode || '');
      setUnavailabilityReason(
        (init.unavailabilityReason as UnavailabilityReason) || 'OUT_OF_STOCK'
      );
    }

    setProductSearch('');
    setRequestedQuantity(
      init.requestedQuantity && init.requestedQuantity > 0
        ? init.requestedQuantity
        : 1
    );
    setSaleUnitMode(init.saleUnitMode === 'pack' ? 'pack' : 'unit');
    setConfirmedPurchaseIntent(init.confirmedPurchaseIntent ?? true);
    setBranchId(init.branchId || 'branch-main');
    setCustomerId(init.customerId || selectedCustomer?.id || '');
    setCustomerReference(init.customerReference || selectedCustomer?.name || '');
    setNotes(init.notes || '');
    setSourceScreen(
      (init.sourceScreen as 'checkout' | 'products' | 'analytics' | 'other') ||
        'checkout'
    );
  }, [
    isUnmetDemandModalOpen,
    unmetDemandModalInitialData,
    products,
    selectedCustomer,
  ]);

  const activeProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const activePackaging = useMemo(
    () => (activeProduct ? getProductPackaging(activeProduct) : null),
    [activeProduct]
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    const sorted = [...products].sort((a, b) => a.stock - b.stock);
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q)
    );
  }, [products, productSearch]);

  if (!isUnmetDemandModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    try {
      const isRegistered = mode === 'registered' && Boolean(activeProduct);
      const selectedCust = customers.find((c) => c.id === customerId);

      const res = await recordUnmetDemandRequest({
        branchId,
        productId: isRegistered ? activeProduct!.id : null,
        isRegisteredProduct: isRegistered,
        productNameSnapshot: isRegistered
          ? activeProduct!.name
          : unregisteredName.trim(),
        productNameArSnapshot: isRegistered
          ? activeProduct!.nameAr || null
          : unregisteredNameAr.trim() || null,
        barcode: isRegistered
          ? activeProduct!.barcode
          : barcode.trim() || null,
        categorySnapshot: isRegistered
          ? activeProduct!.category
          : categorySnapshot.trim() || 'General',
        requestedQuantity,
        saleUnitMode:
          isRegistered && activePackaging?.enablePackaging ? saleUnitMode : 'unit',
        unavailabilityReason:
          mode === 'unregistered' && unavailabilityReason === 'OUT_OF_STOCK'
            ? 'NOT_STOCKED'
            : unavailabilityReason,
        confirmedPurchaseIntent,
        customerId: customerId || null,
        customerReference:
          customerReference.trim() || selectedCust?.name || null,
        notes: notes.trim() || null,
        sourceScreen,
      });

      if (!res.ok) {
        setFeedback({
          type: 'error',
          message: isAr
            ? res.errorAr || 'تعذر تسجيل الطلب'
            : res.errorEn || 'Could not record request',
        });
        setSubmitting(false);
        return;
      }

      if (res.isDuplicateRapidSubmission) {
        setFeedback({
          type: 'duplicate',
          message: isAr
            ? 'تم تسجيل هذا الطلب بالفعل خلال آخر 60 ثانية (حماية من النقر المزدوج).'
            : 'This identical request was already recorded within the last 60 seconds (double-tap protection).',
        });
        setSubmitting(false);
        return;
      }

      setFeedback({
        type: 'success',
        message: isAr
          ? 'تم تسجيل طلب العميل غير المتوفر في سجل الذكاء التشغيلي بنجاح!'
          : 'Customer unmet demand inquiry recorded in Store Intelligence!',
      });

      setTimeout(() => {
        closeUnmetDemandModal();
      }, 900);
    } finally {
      setSubmitting(false);
    }
  };

  const canChangeBranch =
    currentUser.role === 'admin' || currentUser.role === 'manager';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      dir={isAr ? 'rtl' : 'ltr'}
      data-testid="unmet-demand-modal"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
              <PackageX className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {isAr
                  ? 'تسجيل سريع لطلب عميل غير متوفر'
                  : 'Fast Customer Unmet Demand Capture'}
              </h2>
              <p className="text-xs text-neutral-400">
                {isAr
                  ? 'يسجل الطلب لتحليلات الطلب المفقود والتنبؤ دون التأثير على المبيعات أو المخزون الفعلي'
                  : 'Logs customer inquiry for demand forecasting & replenishment without altering sales or stock'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeUnmetDemandModal}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            data-testid="close-unmet-demand-modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-4 overflow-y-auto p-5"
        >
          {/* Mode Switch: Registered Catalog Product vs Unregistered Inquiry */}
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode('registered');
                if (unavailabilityReason === 'NOT_STOCKED') {
                  setUnavailabilityReason('OUT_OF_STOCK');
                }
              }}
              data-testid="unmet-mode-registered"
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                mode === 'registered'
                  ? 'bg-amber-500 text-neutral-950 shadow'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              {isAr
                ? 'منتج مسجل بالكتالوج (نافد / منتهي)'
                : 'Registered Product (Out of Stock / Expired)'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('unregistered');
                setUnavailabilityReason('NOT_STOCKED');
              }}
              data-testid="unmet-mode-unregistered"
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                mode === 'unregistered'
                  ? 'bg-amber-500 text-neutral-950 shadow'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <PackagePlus className="h-4 w-4" />
              {isAr
                ? 'منتج جديد غير مسجل بالمتجر'
                : 'Unregistered / Not Stocked Product'}
            </button>
          </div>

          {mode === 'registered' ? (
            <div className="space-y-2.5 rounded-xl border border-neutral-800/80 bg-neutral-950/50 p-3.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-300">
                  {isAr ? 'اختر المنتج المطلوب' : 'Select Requested Product'}
                </label>
                {activeProduct && (
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                      activeProduct.stock <= 0
                        ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                        : activeProduct.stock <= (activeProduct.minStockAlert || 5)
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {isAr
                      ? `الرصيد الحالي: ${activeProduct.stock}`
                      : `Current Stock: ${activeProduct.stock}`}
                  </span>
                )}
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 start-3 h-4 w-4 text-neutral-500" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder={
                    isAr
                      ? 'ابحث بالاسم أو الباركود أو الكود (SKU)...'
                      : 'Filter by product name, SKU, or barcode...'
                  }
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 py-2 ps-9 pe-3 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                data-testid="unmet-product-select"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white focus:border-amber-500 focus:outline-none"
              >
                {filteredProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {isAr && p.nameAr ? p.nameAr : p.name} ({p.sku}) —{' '}
                    {isAr ? `المخزون: ${p.stock}` : `Stock: ${p.stock}`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-violet-500/25 bg-violet-950/10 p-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-neutral-300">
                  {isAr
                    ? 'اسم المنتج غير المسجل (مطلوب) *'
                    : 'Requested Unregistered Product Name *'}
                </label>
                <input
                  type="text"
                  required={mode === 'unregistered'}
                  value={unregisteredName}
                  onChange={(e) => setUnregisteredName(e.target.value)}
                  data-testid="unmet-unregistered-name"
                  placeholder={
                    isAr
                      ? 'مثال: شاي ماتشا ياباني 100 جم / كبسولات قهوة...'
                      : 'e.g., Ceremonial Matcha Tin 100g / Specialty Syrup...'
                  }
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-400">
                  <Barcode className="h-3.5 w-3.5" />
                  {isAr ? 'الباركود الممسوح (اختياري)' : 'Scanned Barcode (Optional)'}
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  data-testid="unmet-unregistered-barcode"
                  placeholder="490101099281"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-400">
                  <Layers className="h-3.5 w-3.5" />
                  {isAr ? 'التصنيف المتوقع' : 'Expected Category'}
                </label>
                <input
                  type="text"
                  value={categorySnapshot}
                  onChange={(e) => setCategorySnapshot(e.target.value)}
                  placeholder="Coffee & Drinks / Bakery / Retail"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Quantity & Sale Unit Row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
              <label className="mb-1.5 block text-xs font-semibold text-neutral-300">
                {isAr ? 'الكمية المطلوبة من العميل' : 'Requested Quantity'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={requestedQuantity}
                  onChange={(e) =>
                    setRequestedQuantity(Math.max(1, Number(e.target.value) || 1))
                  }
                  data-testid="unmet-quantity-input"
                  className="w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-center text-sm font-bold text-white focus:border-amber-500 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1">
                  {[1, 2, 3, 5, 10].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setRequestedQuantity(q)}
                      className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${
                        requestedQuantity === q
                          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                          : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              {mode === 'registered' &&
                activePackaging?.enablePackaging &&
                activePackaging.unitsPerPack > 1 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">
                      {isAr ? 'وحدة الطلب:' : 'Unit Mode:'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSaleUnitMode('unit')}
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        saleUnitMode === 'unit'
                          ? 'bg-amber-500 text-neutral-950'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {isAr ? activePackaging.unitNameAr : activePackaging.unitName}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSaleUnitMode('pack')}
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        saleUnitMode === 'pack'
                          ? 'bg-amber-500 text-neutral-950'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {isAr ? activePackaging.packNameAr : activePackaging.packName}{' '}
                      ({activePackaging.unitsPerPack})
                    </button>
                  </div>
                )}
            </div>

            {/* Unavailability Reason */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
              <label className="mb-1.5 block text-xs font-semibold text-neutral-300">
                {isAr ? 'سبب عدم التوفر' : 'Unavailability Reason'}
              </label>
              <select
                value={unavailabilityReason}
                onChange={(e) =>
                  setUnavailabilityReason(e.target.value as UnavailabilityReason)
                }
                data-testid="unmet-reason-select"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-white focus:border-amber-500 focus:outline-none"
              >
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {isAr ? opt.labelAr : opt.labelEn}
                  </option>
                ))}
              </select>

              {/* Confirmed Purchase Intent Toggle */}
              <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={confirmedPurchaseIntent}
                  onChange={(e) => setConfirmedPurchaseIntent(e.target.checked)}
                  data-testid="unmet-confirmed-intent"
                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-amber-500"
                />
                <span>
                  {isAr
                    ? 'نية شراء مؤكدة (العميل كان مستعداً للدفع فوراً)'
                    : 'Confirmed Purchase Intent (Customer ready to buy)'}
                </span>
              </label>
            </div>
          </div>

          {/* Branch & Optional Customer / Notes */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-400">
                <Building2 className="h-3.5 w-3.5" />
                {isAr ? 'الفرع المسجل للطلب' : 'Store Branch'}
              </label>
              <select
                value={branchId}
                disabled={!canChangeBranch}
                onChange={(e) => setBranchId(e.target.value)}
                data-testid="unmet-branch-select"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white disabled:opacity-60"
              >
                {DEFAULT_BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {isAr ? b.nameAr : b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-400">
                <User className="h-3.5 w-3.5" />
                {isAr ? 'العميل (اختياري)' : 'Customer (Optional)'}
              </label>
              <select
                value={customerId}
                onChange={(e) => {
                  const cId = e.target.value;
                  setCustomerId(cId);
                  const found = customers.find((c) => c.id === cId);
                  if (found) setCustomerReference(found.name);
                }}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white"
              >
                <option value="">
                  {isAr ? 'عميل نقدي عابر (بدون تحديد)' : 'Walk-in Customer (Unspecified)'}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              {isAr
                ? 'ملاحظات إضافية (مثل: العميل طلب توفيره غداً أو بديل مفضل)'
                : 'Notes (e.g., Customer asked for restock by tomorrow)'}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="unmet-notes-input"
              placeholder={
                isAr
                  ? 'أضف ملاحظة مختصرة لفريق المشتريات والمخزون...'
                  : 'Short note for purchasing & inventory team...'
              }
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {feedback && (
            <div
              data-testid="unmet-feedback-banner"
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-medium ${
                feedback.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : feedback.type === 'duplicate'
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-neutral-800 pt-3">
            <button
              type="button"
              onClick={closeUnmetDemandModal}
              className="rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-800"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="submit-unmet-demand-btn"
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-neutral-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {submitting
                ? isAr
                  ? 'جاري التسجيل...'
                  : 'Recording...'
                : isAr
                ? 'تسجيل الطلب غير المتوفر'
                : 'Record Unmet Demand'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
