/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { AppModal } from '../ui/AppModal';
import { TactileButton } from '../ui/TactileButton';
import { AppInput } from '../ui/AppInput';
import {
  ReceiptPrinter,
  ReceiptPrinterStage,
  ReceiptFeedMotion,
} from '../ui/ReceiptPrinter';
import { Transaction, SalesRateValuationMode } from '../../lib/types';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import {
  formatCurrency,
  formatPaymentMethodLabel,
  getConvertedTransactionView,
} from '../../lib/pos-calculations';
import { playTactileClick, playSuccessChime, triggerHaptic } from '../../lib/sound-fx';
import {
  Printer,
  Plus,
  RotateCcw,
  Edit3,
  Upload,
  Trash2,
  Check,
  Store,
  Sparkles,
} from 'lucide-react';

export interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  onNewSale: () => void;
  valuationMode?: SalesRateValuationMode;
  anchorCurrency?: string;
}

/**
 * Helper to compress an uploaded logo image into a compact Data URL for localStorage.
 */
function compressLogoFile(file: File, maxDim = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png', 0.9));
      };
      img.onerror = () => resolve(reader.result as string);
      img.src = reader.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onNewSale,
  valuationMode = 'historical',
  anchorCurrency = 'USD',
}) => {
  const { settings, updateSettings, exchangeRates } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [stage, setStage] = useState<ReceiptPrinterStage>('processing');
  const [feedMotion, setFeedMotion] = useState<ReceiptFeedMotion>('stepped');
  const [printCycleKey, setPrintCycleKey] = useState(0);

  // Quick Store Branding Editor state inside the Receipt Modal
  const [isEditingBranding, setIsEditingBranding] = useState(false);
  const [draftNameEn, setDraftNameEn] = useState(settings.storeName);
  const [draftNameAr, setDraftNameAr] = useState(settings.storeNameAr);
  const [draftLogo, setDraftLogo] = useState(settings.storeLogo || '');
  const [brandingSaved, setBrandingSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync draft state when settings change
  useEffect(() => {
    setDraftNameEn(settings.storeName);
    setDraftNameAr(settings.storeNameAr);
    setDraftLogo(settings.storeLogo || '');
  }, [settings.storeName, settings.storeNameAr, settings.storeLogo]);

  // Run the thermal printer stage sequence whenever modal opens or user replays print
  const triggerPrintSequence = useCallback(() => {
    setStage('processing');
    playTactileClick(settings.soundEnabled);

    const printingTimer = setTimeout(() => {
      setStage('printing');
      triggerHaptic('light', settings.hapticsEnabled);
    }, 420);

    const completeDelay = feedMotion === 'stepped' ? 2200 : 1800;
    const completeTimer = setTimeout(() => {
      setStage('complete');
      playSuccessChime(settings.soundEnabled);
      triggerHaptic('success', settings.hapticsEnabled);
    }, completeDelay);

    return () => {
      clearTimeout(printingTimer);
      clearTimeout(completeTimer);
    };
  }, [feedMotion, settings.soundEnabled, settings.hapticsEnabled]);

  useEffect(() => {
    if (!isOpen || !transaction) return;

    const cleanup = triggerPrintSequence();

    try {
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#f59e0b', '#10b981', '#3b82f6', '#ec4899'],
      });
    } catch {
      // Ignore confetti errors in headless environments
    }

    return cleanup;
  }, [isOpen, transaction?.id, printCycleKey, triggerPrintSequence]);

  if (!transaction) return null;

  const converted = getConvertedTransactionView(
    transaction,
    settings.currency,
    exchangeRates,
    valuationMode,
    anchorCurrency
  );

  const displayStoreName = isAr
    ? settings.storeNameAr || settings.storeName
    : settings.storeName || settings.storeNameAr;

  const storeMonogram =
    displayStoreName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'DQ';

  const handleReplayPrint = () => {
    setPrintCycleKey((prev) => prev + 1);
  };

  const handleSystemPrint = () => {
    setStage('complete');
    setTimeout(() => {
      window.print();
    }, 120);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressLogoFile(file);
      setDraftLogo(compressed);
      updateSettings({ storeLogo: compressed });
      setBrandingSaved(true);
      setTimeout(() => setBrandingSaved(false), 2000);
    } catch {
      // Ignore upload error
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEn = draftNameEn.trim() || settings.storeName;
    const cleanAr = draftNameAr.trim() || settings.storeNameAr;
    updateSettings({
      storeName: cleanEn,
      storeNameAr: cleanAr,
      storeLogo: draftLogo.trim(),
    });
    playTactileClick(settings.soundEnabled);
    setBrandingSaved(true);
    setTimeout(() => {
      setBrandingSaved(false);
      setIsEditingBranding(false);
    }, 900);
  };

  const statusText =
    stage === 'processing'
      ? isAr
        ? 'جاري تجهيز الفاتورة...'
        : 'Processing transaction...'
      : stage === 'printing'
      ? isAr
        ? 'جاري طباعة الفاتورة الحرارية...'
        : 'Printing thermal receipt...'
      : isAr
      ? 'اكتملت طباعة الفاتورة'
      : 'Receipt printed';

  return (
    <AppModal isOpen={isOpen} onClose={onClose} title={t.receipt} maxWidth="md">
      <div className="flex flex-col gap-3.5">
        {/* Top Toolbar: Customize Store Logo & Name + Feed Motion Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950/70 border border-neutral-800 rounded-xl p-2.5 print:hidden">
          <button
            type="button"
            onClick={() => {
              playTactileClick(settings.soundEnabled);
              setIsEditingBranding((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              isEditingBranding
                ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                : 'bg-neutral-900 text-amber-400 border-neutral-700 hover:border-amber-500/60'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>
              {isAr ? 'تعديل لوقو واسم المتجر' : 'Edit Store Logo & Name'}
            </span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                setFeedMotion((prev) => (prev === 'stepped' ? 'smooth' : 'stepped'));
              }}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-[11px] font-mono text-neutral-300 flex items-center gap-1"
              title="Toggle thermal paper feed motion"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>
                {feedMotion === 'stepped'
                  ? isAr
                    ? 'سحب متدرج (Stepped)'
                    : 'Stepped Feed'
                  : isAr
                  ? 'سحب سلس (Smooth)'
                  : 'Smooth Feed'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleReplayPrint}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-amber-500/50 text-[11px] font-mono text-neutral-200 flex items-center gap-1"
              title={isAr ? 'إعادة حركة الطباعة' : 'Replay print animation'}
            >
              <RotateCcw className="w-3 h-3 text-emerald-400" />
              <span>{isAr ? 'إعادة الطباعة' : 'Replay'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Store Logo & Name Editor */}
        {isEditingBranding && (
          <form
            onSubmit={handleSaveBranding}
            className="bg-neutral-950 border border-amber-500/40 rounded-2xl p-3.5 space-y-3 animate-in fade-in duration-150 print:hidden"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-white">
                  {isAr
                    ? 'تخصيص شعار (لوقو) واسم المتجر على الفاتورة'
                    : 'Customize Receipt Store Logo & Name'}
                </span>
              </div>
              {brandingSaved && (
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تم الحفظ!' : 'Saved!'}</span>
                </span>
              )}
            </div>

            {/* Logo Preview + Upload / URL Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="w-16 h-16 rounded-2xl border border-neutral-700 bg-neutral-900 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                {draftLogo ? (
                  <img
                    src={draftLogo}
                    alt="Store Logo Preview"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <span className="font-mono font-extrabold text-lg text-amber-400">
                    {storeMonogram}
                  </span>
                )}
              </div>

              <div className="flex-1 w-full space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <TactileButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    leftIcon={<Upload className="w-3.5 h-3.5" />}
                  >
                    {isAr ? 'رفع صورة اللوقو' : 'Upload Logo'}
                  </TactileButton>

                  {draftLogo && (
                    <TactileButton
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDraftLogo('');
                        updateSettings({ storeLogo: '' });
                      }}
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      {isAr ? 'حذف الشعار' : 'Remove'}
                    </TactileButton>
                  )}
                </div>

                <input
                  type="text"
                  dir="ltr"
                  value={draftLogo.startsWith('data:') ? '' : draftLogo}
                  onChange={(e) => setDraftLogo(e.target.value)}
                  placeholder={
                    draftLogo.startsWith('data:')
                      ? isAr
                        ? 'تم رفع صورة شعار مخصصة من الجهاز'
                        : 'Custom uploaded logo image active'
                      : isAr
                      ? 'أو الصق رابط صورة اللوقو (https://...)'
                      : 'Or paste logo image URL (https://...)'
                  }
                  className="w-full px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Store Name Inputs (Arabic & English) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <AppInput
                label={isAr ? 'اسم المتجر (بالعربية)' : 'Arabic Store Name (اسم المتجر)'}
                value={draftNameAr}
                onChange={(e) => setDraftNameAr(e.target.value)}
                placeholder="محمصة ومخبز دينامو الحرفي"
              />
              <AppInput
                label={isAr ? 'اسم المتجر ( بالإنجليزية)' : 'Store Name (English)'}
                value={draftNameEn}
                onChange={(e) => setDraftNameEn(e.target.value)}
                placeholder="Dqnamo Artisan Roasters"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <TactileButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditingBranding(false)}
              >
                {isAr ? 'إغلاق' : 'Close'}
              </TactileButton>
              <TactileButton
                type="submit"
                variant="amber"
                size="sm"
                leftIcon={<Check className="w-3.5 h-3.5" />}
              >
                {isAr ? 'حفظ وتطبيق على الفاتورة' : 'Save & Apply to Receipt'}
              </TactileButton>
            </div>
          </form>
        )}

        {/* Tactile Thermal Receipt Printer Component */}
        <ReceiptPrinter.Root
          key={printCycleKey}
          stage={stage}
          feedMotion={feedMotion}
          animate={true}
        >
          <ReceiptPrinter.Machine>
            <ReceiptPrinter.Header>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0">
                  {settings.storeLogo ? (
                    <img
                      src={settings.storeLogo}
                      alt={displayStoreName}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="font-mono text-[10px] font-bold text-amber-400">
                      {storeMonogram}
                    </span>
                  )}
                </div>
                <span className="text-xs font-bold tracking-tight text-neutral-200 truncate">
                  {displayStoreName}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                  POS-80MM
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    stage === 'complete'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                      : 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                  }`}
                />
              </div>
            </ReceiptPrinter.Header>

            <ReceiptPrinter.Screen>
              <div className="flex items-center justify-between gap-2">
                <ReceiptPrinter.Status>{statusText}</ReceiptPrinter.Status>
                <span className="font-mono text-xs font-bold text-amber-400 tabular-nums shrink-0">
                  {formatCurrency(converted.grandTotal, settings.currency, settings.language)}
                </span>
              </div>
            </ReceiptPrinter.Screen>

            <ReceiptPrinter.Output>
              <ReceiptPrinter.Paper>
                {/* Store Logo & Name Header on Thermal Paper */}
                <div className="text-center pb-3 border-b border-dashed border-neutral-400">
                  <div className="flex justify-center mb-2">
                    {settings.storeLogo ? (
                      <div className="w-16 h-16 rounded-xl border border-neutral-300 bg-white p-1.5 flex items-center justify-center shadow-xs">
                        <img
                          src={settings.storeLogo}
                          alt={displayStoreName}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-xl border-2 border-neutral-900 bg-neutral-900 text-white flex items-center justify-center font-mono font-extrabold text-base tracking-wider">
                        {storeMonogram}
                      </div>
                    )}
                  </div>

                  <h4 className="font-extrabold text-sm text-neutral-950 uppercase tracking-wider">
                    {displayStoreName}
                  </h4>
                  {settings.storeName && settings.storeNameAr && (
                    <p className="text-[10px] font-semibold text-neutral-600 mt-0.5">
                      {isAr ? settings.storeName : settings.storeNameAr}
                    </p>
                  )}
                  <p className="text-[11px] text-neutral-600 mt-0.5">
                    {isAr ? settings.addressAr : settings.address}
                  </p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">
                    TAX ID: {settings.taxNumber}
                  </p>
                  <p className="text-[10px] text-neutral-500">
                    TEL: {settings.phone}
                  </p>
                </div>

                {/* Meta Details */}
                <div className="py-2.5 border-b border-dashed border-neutral-400 text-[11px] space-y-1">
                  <div className="flex justify-between">
                    <span>Receipt #:</span>
                    <span className="font-bold">{transaction.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{new Date(transaction.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cashier:</span>
                    <span>{transaction.cashierName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span className="font-semibold">
                      {transaction.customerName || 'Walk-in'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payment:</span>
                    <span className="uppercase font-bold">
                      {formatPaymentMethodLabel(transaction.paymentMethod, settings.language)}
                    </span>
                  </div>
                  {transaction.transferReference && (
                    <div className="flex justify-between">
                      <span>{t.transferReference}:</span>
                      <span className="font-bold font-mono">{transaction.transferReference}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>{isAr ? 'سعر الصرف وقت البيع:' : 'Sale Exchange Rate:'}</span>
                    <span className="font-bold font-mono" dir="ltr">
                      1 {converted.referenceCurrency} = {converted.historicalRate} SDG
                    </span>
                  </div>
                  {converted.originalCurrency !== settings.currency && (
                    <div className="flex justify-between text-neutral-600">
                      <span>{t.originalInvoiceValue}:</span>
                      <span className="font-mono font-semibold">
                        {formatCurrency(
                          transaction.grandTotal,
                          converted.originalCurrency,
                          settings.language
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>{t.status}:</span>
                    <span
                      className={`font-bold ${
                        converted.debtAmount > 0
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {transaction.paymentStatus === 'unpaid'
                        ? t.unpaidFullDebt
                        : transaction.paymentStatus === 'partial'
                        ? t.partialPaymentDebt
                        : t.paidInFull}
                    </span>
                  </div>
                </div>

                {/* Items Table */}
                <div className="py-3 border-b border-dashed border-neutral-400">
                  <div className="flex justify-between font-bold text-[11px] pb-1 border-b border-neutral-300">
                    <span>Item</span>
                    <span>Total</span>
                  </div>
                  <div className="divide-y divide-neutral-200/80 mt-1">
                    {converted.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="py-1.5 flex justify-between items-start gap-2"
                      >
                        <div>
                          <div className="font-semibold text-neutral-900">
                            {item.productName}
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            {item.quantity} x{' '}
                            {formatCurrency(item.unitPrice, settings.currency, settings.language)}
                            {item.discountPercent > 0 &&
                              ` (-${item.discountPercent}%)`}
                          </div>
                        </div>
                        <span className="font-bold text-neutral-950 tabular-nums shrink-0">
                          {formatCurrency(item.total, settings.currency, settings.language)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals Breakdown */}
                <div className="py-2.5 space-y-1 text-[11px] border-b border-dashed border-neutral-400">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="tabular-nums">
                      {formatCurrency(converted.subtotal, settings.currency, settings.language)}
                    </span>
                  </div>
                  {converted.discountAmount > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>Discount:</span>
                      <span className="tabular-nums">
                        -{formatCurrency(converted.discountAmount, settings.currency, settings.language)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>VAT / Tax ({transaction.taxRatePercent}%):</span>
                    <span className="tabular-nums">
                      {formatCurrency(converted.taxAmount, settings.currency, settings.language)}
                    </span>
                  </div>
                  <div className="flex justify-between font-extrabold text-sm pt-1.5 text-neutral-950 border-t border-neutral-300">
                    <span>TOTAL DUE:</span>
                    <span className="tabular-nums">
                      {formatCurrency(converted.grandTotal, settings.currency, settings.language)}
                    </span>
                  </div>

                  {/* Paid vs Remaining Debt Breakdown */}
                  <div className="flex justify-between pt-1 font-semibold text-emerald-800">
                    <span>{t.amountPaidLabel}:</span>
                    <span className="tabular-nums">
                      {formatCurrency(
                        converted.amountPaid,
                        settings.currency,
                        settings.language
                      )}
                    </span>
                  </div>

                  {converted.debtAmount > 0 && (
                    <div className="flex justify-between font-extrabold text-rose-700">
                      <span>{t.remainingDebt}:</span>
                      <span className="tabular-nums">
                        {formatCurrency(converted.debtAmount, settings.currency, settings.language)}
                      </span>
                    </div>
                  )}

                  {transaction.paymentMethod === 'cash' &&
                    converted.debtAmount === 0 && (
                      <>
                        <div className="flex justify-between pt-1">
                          <span>Tendered:</span>
                          <span className="tabular-nums">
                            {formatCurrency(
                              converted.amountTendered,
                              settings.currency,
                              settings.language
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-emerald-700">
                          <span>Change Due:</span>
                          <span className="tabular-nums">
                            {formatCurrency(converted.changeDue, settings.currency, settings.language)}
                          </span>
                        </div>
                      </>
                    )}
                </div>

                {/* Attached Bank Transfer Notification Image on Receipt */}
                {transaction.transferReceiptImage && (
                  <div className="py-2.5 border-b border-dashed border-neutral-400 text-center">
                    <span className="text-[10px] font-bold text-neutral-700 block mb-1.5">
                      {t.transferReceiptImage}
                    </span>
                    <div className="mx-auto max-w-[180px] rounded-lg overflow-hidden border border-neutral-300 bg-white p-1">
                      <img
                        src={transaction.transferReceiptImage}
                        alt={t.transferReceiptImage}
                        className="w-full h-auto max-h-36 object-contain mx-auto"
                      />
                    </div>
                  </div>
                )}

                {/* Footer & Barcode Simulation */}
                <div className="pt-3 text-center">
                  <p className="text-[10px] text-neutral-600">
                    {isAr ? settings.receiptFooterAr : settings.receiptFooter}
                  </p>
                  <div className="mt-3 flex flex-col items-center">
                    <div className="flex items-center gap-0.5 h-7">
                      {[2, 1, 3, 1, 2, 4, 1, 3, 2, 1, 2, 3, 1, 2, 1, 3, 2, 1, 3, 1].map(
                        (w, i) => (
                          <div
                            key={i}
                            className="bg-neutral-950 h-full"
                            style={{ width: `${w}px` }}
                          />
                        )
                      )}
                    </div>
                    <span className="text-[9px] tracking-widest mt-1 text-neutral-500">
                      *{transaction.id}*
                    </span>
                  </div>
                </div>
              </ReceiptPrinter.Paper>
            </ReceiptPrinter.Output>
          </ReceiptPrinter.Machine>
        </ReceiptPrinter.Root>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pt-1 print:hidden">
          <TactileButton
            variant="secondary"
            size="md"
            onClick={handleSystemPrint}
            leftIcon={<Printer className="w-4 h-4" />}
            className="flex-1"
          >
            {t.printReceipt}
          </TactileButton>

          <TactileButton
            variant="emerald"
            size="md"
            onClick={onNewSale}
            leftIcon={<Plus className="w-4 h-4" />}
            className="flex-1"
          >
            {t.newTransaction}
          </TactileButton>
        </div>
      </div>
    </AppModal>
  );
};
