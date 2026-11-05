/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { AppModal } from '../ui/AppModal';
import { DynamicButton, DynamicButtonStatus } from '../ui/DynamicButton';
import { TactileButton } from '../ui/TactileButton';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { formatCurrency, calculateDebtBreakdown, roundCurrencyValue } from '../../lib/pos-calculations';
import {
  PaymentMethod,
  PaymentSettlementStatus,
  InvoiceFulfillmentType,
  Transaction,
  SupportedCurrency,
} from '../../lib/types';
import {
  Banknote,
  Landmark,
  QrCode,
  User,
  AlertCircle,
  Coins,
  Upload,
  Trash2,
  Hash,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  FileWarning,
  PackageCheck,
  FileText,
  Truck,
} from 'lucide-react';
import { playTactileClick } from '../../lib/sound-fx';
import { normalizeNumberInput, parseNormalizedNumber } from '../../lib/number-utils';
import { api } from '../../services/api';

export interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (transaction: Transaction) => void;
}

/**
 * Compresses an uploaded transfer notification receipt image into a compact Data URL for localStorage.
 */
function compressReceiptNotificationImage(file: File, maxDim = 640): Promise<string> {
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
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(reader.result as string);
      img.src = reader.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const {
    cartTotals,
    settings,
    currencies: contextCurrencies,
    exchangeRates: contextExchangeRates,
    customers,
    selectedCustomer,
    setSelectedCustomer,
    processCheckout,
  } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentStatus, setPaymentStatus] = useState<PaymentSettlementStatus>('paid');
  const [fulfillmentType, setFulfillmentType] =
    useState<InvoiceFulfillmentType>('goods_and_invoice');
  const [transferReference, setTransferReference] = useState<string>('');
  const [transferReceiptImage, setTransferReceiptImage] = useState<string>('');
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null);

  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>(() =>
    contextCurrencies && contextCurrencies.length > 0
      ? contextCurrencies.map((c) => c.code)
      : ['SDG', 'USD', 'SAR', 'AED', 'EUR', 'GBP']
  );
  const [tenderCurrency, setTenderCurrency] = useState<SupportedCurrency>(settings.currency);
  const [exchangeRatesMap, setExchangeRatesMap] = useState<Record<string, number>>(() => ({
    USD: 2700,
    SAR: 720,
    AED: 735,
    EUR: 2950,
    GBP: 3450,
    SDG: 1,
    ...(contextExchangeRates || {}),
  }));
  const [tenderedInput, setTenderedInput] = useState<string>('');
  const [buttonStatus, setButtonStatus] = useState<DynamicButtonStatus>('ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (contextCurrencies && contextCurrencies.length > 0) {
      setAvailableCurrencies(contextCurrencies.map((c) => c.code));
    }
  }, [contextCurrencies]);

  useEffect(() => {
    if (contextExchangeRates) {
      setExchangeRatesMap((prev) => ({ ...prev, ...contextExchangeRates, SDG: 1 }));
    }
  }, [contextExchangeRates]);

  // Calculate rate relative to cart base currency (settings.currency)
  const getRateToBase = (curr: string, mapObj: Record<string, number> = exchangeRatesMap): number => {
    if (curr === settings.currency) return 1;
    if (settings.currency === 'SDG') {
      return mapObj[curr] || 1;
    }
    const currToSdg = mapObj[curr] || 1;
    const baseToSdg = mapObj[settings.currency] || 1;
    return baseToSdg > 0 ? currToSdg / baseToSdg : 1;
  };

  const formatAmountForInput = (val: number): string => {
    if (!Number.isFinite(val) || val <= 0) return '0';
    const rounded = roundCurrencyValue(val);
    if (rounded > 0 && rounded < 0.05) {
      return rounded.toString();
    }
    return rounded.toFixed(2);
  };

  // Reset modal state on open
  useEffect(() => {
    if (isOpen) {
      setTenderCurrency(settings.currency);
      setTenderedInput(formatAmountForInput(cartTotals.grandTotal));
      setPaymentStatus('paid');
      setFulfillmentType('goods_and_invoice');
      setTransferReference('');
      setTransferReceiptImage('');
      setButtonStatus('ready');
      setErrorMessage(null);

      Promise.all([api.getCurrencies(), api.getExchangeRates(true)])
        .then(([currData, rates]) => {
          if (currData.currencies && currData.currencies.length > 0) {
            setAvailableCurrencies(currData.currencies.map((c) => c.code));
          }
          const map: Record<string, number> = { SDG: 1 };
          for (const r of rates) {
            if (r.targetCurrency === 'SDG') {
              map[r.sourceCurrency] = r.rate;
            } else if (r.sourceCurrency === 'SDG' && r.rate > 0) {
              map[r.targetCurrency] = 1 / r.rate;
            }
          }
          setExchangeRatesMap((prev) => ({ ...prev, ...map }));
        })
        .catch(() => {
          // Keep defaults if network fails
        });
    }
  }, [isOpen, cartTotals.grandTotal, settings.currency]);

  // Converted total in selected tender currency
  const conversionRate = getRateToBase(tenderCurrency);
  const totalInTenderCurrency =
    tenderCurrency === settings.currency
      ? cartTotals.grandTotal
      : cartTotals.grandTotal / (conversionRate || 1);

  // Explicit currency switch handler so user can freely edit or clear the input
  const handleSelectTenderCurrency = (newCurr: SupportedCurrency) => {
    playTactileClick(settings.soundEnabled);
    setTenderCurrency(newCurr);
    const rate = getRateToBase(newCurr);
    const convertedTotal =
      newCurr === settings.currency
        ? cartTotals.grandTotal
        : cartTotals.grandTotal / (rate || 1);
    if (paymentStatus === 'paid') {
      setTenderedInput(formatAmountForInput(convertedTotal));
    } else if (paymentStatus === 'unpaid') {
      setTenderedInput('0');
    } else {
      setTenderedInput(formatAmountForInput(convertedTotal / 2));
    }
    setErrorMessage(null);
  };

  const handleSelectPaymentStatus = (nextStatus: PaymentSettlementStatus) => {
    playTactileClick(settings.soundEnabled);
    setPaymentStatus(nextStatus);
    setErrorMessage(null);
    if (nextStatus === 'paid') {
      setTenderedInput(formatAmountForInput(totalInTenderCurrency));
    } else if (nextStatus === 'unpaid') {
      setTenderedInput('0');
    } else if (nextStatus === 'partial') {
      setTenderedInput(formatAmountForInput(totalInTenderCurrency / 2));
    }
  };

  const tenderedAmount = parseNormalizedNumber(tenderedInput, 0);

  // Tendered amount converted back to store base currency for checkout
  const tenderedInBaseCurrency =
    tenderCurrency === settings.currency
      ? tenderedAmount
      : tenderedAmount * (conversionRate || 1);

  const debtBreakdown = calculateDebtBreakdown(
    cartTotals.grandTotal,
    paymentStatus,
    paymentStatus === 'paid' && paymentMethod !== 'cash'
      ? cartTotals.grandTotal
      : tenderedInBaseCurrency
  );

  const changeDueInBase =
    paymentMethod === 'cash' && paymentStatus === 'paid'
      ? Math.max(0, Math.round((tenderedInBaseCurrency - cartTotals.grandTotal) * 100) / 100)
      : 0;

  const changeDueInTender =
    tenderCurrency === settings.currency
      ? changeDueInBase
      : changeDueInBase / (conversionRate || 1);

  const isCashUnderpaid =
    paymentStatus === 'paid' &&
    paymentMethod === 'cash' &&
    tenderedInBaseCurrency < cartTotals.grandTotal - 0.01;

  // Generate dynamic cash presets based on currency
  const getCashPresets = () => {
    const exact = { label: t.exactAmount, value: totalInTenderCurrency };
    const needed = totalInTenderCurrency;

    if (tenderCurrency === 'SDG') {
      const presets = [exact];
      const steps = [1000, 5000, 10000, 50000, 100000];
      for (const step of steps) {
        const nextRounded = Math.ceil(needed / step) * step;
        if (nextRounded > needed && !presets.some((p) => p.value === nextRounded)) {
          presets.push({ label: `${nextRounded.toLocaleString()} ج.س`, value: nextRounded });
        }
      }
      return presets.slice(0, 5);
    }

    if (tenderCurrency === 'USD' || tenderCurrency === 'EUR' || tenderCurrency === 'GBP') {
      const sym = tenderCurrency === 'USD' ? '$' : tenderCurrency === 'EUR' ? '€' : '£';
      const common = [10, 20, 50, 100, 200];
      const valid = common
        .filter((v) => v >= needed)
        .map((v) => ({ label: `${sym}${v}`, value: v }));
      return [exact, ...valid].slice(0, 5);
    }

    if (tenderCurrency === 'SAR' || tenderCurrency === 'AED') {
      const unit = tenderCurrency === 'SAR' ? 'ر.س' : 'د.إ';
      const common = [50, 100, 200, 500];
      const valid = common
        .filter((v) => v >= needed)
        .map((v) => ({ label: `${v} ${unit}`, value: v }));
      return [exact, ...valid].slice(0, 5);
    }

    return [exact];
  };

  const cashPresets = getCashPresets();

  const handleCashPreset = (val: number) => {
    playTactileClick(settings.soundEnabled);
    setTenderedInput(val.toFixed(2));
    setErrorMessage(null);
  };

  const handleReceiptImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressReceiptNotificationImage(file);
      setTransferReceiptImage(compressed);
      setErrorMessage(null);
    } catch {
      // Ignore compression error
    } finally {
      if (receiptFileInputRef.current) {
        receiptFileInputRef.current.value = '';
      }
    }
  };

  const handleExecutePayment = async () => {
    if (paymentMethod === 'bank_transfer' && paymentStatus !== 'unpaid' && !transferReference.trim()) {
      setErrorMessage(
        isAr
          ? 'يرجى إدخال رقم العملية للتحويل البنكي قبل إتمام الدفع.'
          : 'Please enter the Bank Transfer operation reference number before completing payment.'
      );
      setButtonStatus('error');
      setTimeout(() => setButtonStatus('ready'), 2500);
      return;
    }

    if (paymentStatus === 'partial' && (tenderedInBaseCurrency <= 0 || tenderedInBaseCurrency >= cartTotals.grandTotal)) {
      setErrorMessage(
        isAr
          ? 'في حالة الدفع الجزئي يجب أن يكون المبلغ المدفوع أكبر من صفر وأقل من إجمالي الفاتورة.'
          : 'For partial payment, the paid amount must be greater than zero and less than the invoice total.'
      );
      setButtonStatus('error');
      setTimeout(() => setButtonStatus('ready'), 2500);
      return;
    }

    if (isCashUnderpaid) {
      setErrorMessage(
        isAr
          ? `المبلغ المدفوع (${tenderedAmount.toFixed(2)} ${tenderCurrency}) أقل من الإجمالي المطلوب (${totalInTenderCurrency.toFixed(2)} ${tenderCurrency}). يمكنك اختيار "دفع جزئي" أو "لم يدفع (دين)" لتسجيل المتبقي كدين.`
          : `Tendered amount (${tenderedAmount.toFixed(2)} ${tenderCurrency}) is less than total due (${totalInTenderCurrency.toFixed(2)} ${tenderCurrency}). Choose Partial or Unpaid Debt to record the balance as debt.`
      );
      setButtonStatus('error');
      setTimeout(() => setButtonStatus('ready'), 2500);
      return;
    }

    setButtonStatus('processing');
    setErrorMessage(null);

    // Realistic terminal authorization delay
    await new Promise((res) => setTimeout(res, 500));

    const activeCurrencyCode = (settings.currency || 'SDG').toUpperCase().trim();
    const saleRateSnapshot: Record<string, number> = {
      ...exchangeRatesMap,
      ...(contextExchangeRates || {}),
      SDG: 1,
    };
    const saleRateUsed =
      activeCurrencyCode === 'SDG'
        ? Number(saleRateSnapshot[tenderCurrency !== 'SDG' ? tenderCurrency : 'USD'] || 2700)
        : Number(saleRateSnapshot[activeCurrencyCode] || 1);

    // Submit payment in base store currency with full transfer, debt, fulfillment & locked sale exchange rate details
    const result = await processCheckout(paymentMethod, tenderedInBaseCurrency, {
      transferReference: paymentMethod === 'bank_transfer' ? transferReference.trim() : undefined,
      transferReceiptImage: paymentMethod === 'bank_transfer' ? transferReceiptImage : undefined,
      paymentStatus,
      amountPaid: debtBreakdown.amountPaid,
      debtAmount: debtBreakdown.debtAmount,
      fulfillmentType,
      fulfillmentStatus:
        fulfillmentType === 'invoice_only'
          ? 'pending_goods'
          : fulfillmentType === 'goods_only'
          ? 'pending_invoice'
          : 'received',
      exchangeRateUsed: saleRateUsed,
      exchangeRatesSnapshot: saleRateSnapshot,
    });

    if (result.success && result.transaction) {
      setButtonStatus('success');
      setTimeout(() => {
        onSuccess(result.transaction!);
      }, 650);
    } else {
      setButtonStatus('error');
      setErrorMessage(result.error || 'Payment failed to process');
      setTimeout(() => setButtonStatus('ready'), 2500);
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title={t.payNow}
      description={`${cartTotals.totalItemsCount} ${t.itemsCount} • ${formatCurrency(
        cartTotals.grandTotal,
        settings.currency,
        settings.language
      )}`}
      maxWidth="lg"
    >
      <div className="flex flex-col gap-4">
        {/* 1. Total Display Banner with Multi-Currency & Live Debt/Change indicator */}
        <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs text-neutral-400 block font-medium">{t.total}</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-400 tracking-tight tabular-nums">
                {formatCurrency(cartTotals.grandTotal, settings.currency, settings.language)}
              </span>
              {tenderCurrency !== settings.currency && (
                <span className="text-sm font-mono text-neutral-300 font-semibold">
                  ≈ {totalInTenderCurrency.toFixed(2)} {tenderCurrency}
                </span>
              )}
            </div>
            <span className="text-[11px] text-emerald-400 font-semibold block mt-1">
              {isAr ? (
                <>
                  يحفظ بسعر صرف البيع:{' '}
                  <span className="font-mono font-bold text-white" dir="ltr">
                    1 {tenderCurrency !== 'SDG' ? tenderCurrency : settings.currency !== 'SDG' ? settings.currency : 'USD'} ={' '}
                    {(
                      exchangeRatesMap[
                        tenderCurrency !== 'SDG'
                          ? tenderCurrency
                          : settings.currency !== 'SDG'
                          ? settings.currency
                          : 'USD'
                      ] || 2700
                    ).toLocaleString()}{' '}
                    SDG
                  </span>
                </>
              ) : (
                <>
                  Saved at Sale Rate:{' '}
                  <span className="font-mono font-bold text-white" dir="ltr">
                    1 {tenderCurrency !== 'SDG' ? tenderCurrency : settings.currency !== 'SDG' ? settings.currency : 'USD'} ={' '}
                    {(
                      exchangeRatesMap[
                        tenderCurrency !== 'SDG'
                          ? tenderCurrency
                          : settings.currency !== 'SDG'
                          ? settings.currency
                          : 'USD'
                      ] || 2700
                    ).toLocaleString()}{' '}
                    SDG
                  </span>
                </>
              )}
            </span>
          </div>

          {paymentStatus === 'paid' && paymentMethod === 'cash' && changeDueInBase > 0 && (
            <div className="text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-neutral-800">
              <span className="text-xs text-neutral-400 block font-medium">{t.changeDue}</span>
              <div className="flex flex-col items-end">
                <span className="text-xl sm:text-2xl font-bold text-emerald-400 font-mono tracking-tight tabular-nums">
                  {formatCurrency(changeDueInBase, settings.currency, settings.language)}
                </span>
                {tenderCurrency !== settings.currency && (
                  <span className="text-xs font-mono text-emerald-300/80 font-semibold">
                    ≈ {changeDueInTender.toFixed(2)} {tenderCurrency}
                  </span>
                )}
              </div>
            </div>
          )}

          {debtBreakdown.debtAmount > 0 && (
            <div className="text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-neutral-800">
              <span className="text-xs text-rose-400 block font-bold">
                {t.remainingDebt}
              </span>
              <div className="flex flex-col items-end">
                <span className="text-xl sm:text-2xl font-extrabold text-rose-400 font-mono tracking-tight tabular-nums">
                  {formatCurrency(debtBreakdown.debtAmount, settings.currency, settings.language)}
                </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {t.amountPaidLabel}:{' '}
                  {formatCurrency(debtBreakdown.amountPaid, settings.currency, settings.language)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 2. Customer Selector */}
        <div>
          <label className="text-xs font-semibold text-neutral-300 block mb-1.5 flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-neutral-400" />
              <span>{t.selectCustomer}</span>
            </span>
            {debtBreakdown.debtAmount > 0 && !selectedCustomer && (
              <span className="text-[11px] text-amber-400 font-medium">
                {isAr ? 'يفضل اختيار العميل لتسجيل الدين باسمه' : 'Assign customer to track debt'}
              </span>
            )}
          </label>
          <select
            value={selectedCustomer?.id || ''}
            onChange={(e) => {
              const cust = customers.find((c) => c.id === e.target.value) || null;
              setSelectedCustomer(cust);
            }}
            aria-label={t.selectCustomer}
            className="w-full min-h-[44px] px-3 py-2 bg-neutral-850 border border-neutral-750 text-neutral-100 rounded-xl text-sm focus:outline-none focus:border-amber-500"
          >
            <option value="">{t.walkInCustomer}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.phone}) - {c.loyaltyPoints} pts
                {c.totalDebt && c.totalDebt > 0
                  ? ` • ${isAr ? 'دين:' : 'Debt:'} ${formatCurrency(c.totalDebt, settings.currency, settings.language)}`
                  : ''}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Payment Method & Debt Settlement Selector (Focus Element div:nth-of-type(3)) */}
        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-2">
              {t.paymentMethod}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('bank_transfer');
                  playTactileClick(settings.soundEnabled);
                  setErrorMessage(null);
                }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all min-h-[58px] ${
                  paymentMethod === 'bank_transfer'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold shadow-sm'
                    : 'bg-neutral-850 border-neutral-750 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Landmark className="w-5 h-5 mb-1 text-current" />
                <span className="text-xs">{t.bankTransfer}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('cash');
                  playTactileClick(settings.soundEnabled);
                  setErrorMessage(null);
                }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all min-h-[58px] ${
                  paymentMethod === 'cash'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold shadow-sm'
                    : 'bg-neutral-850 border-neutral-750 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Banknote className="w-5 h-5 mb-1 text-current" />
                <span className="text-xs">{t.cash}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('qr_nfc');
                  playTactileClick(settings.soundEnabled);
                  setErrorMessage(null);
                }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all min-h-[58px] ${
                  paymentMethod === 'qr_nfc'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold shadow-sm'
                    : 'bg-neutral-850 border-neutral-750 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <QrCode className="w-5 h-5 mb-1 text-current" />
                <span className="text-xs">{t.qrNfc}</span>
              </button>
            </div>
          </div>

          {/* Invoice Payment / Debt Status Selector (Paid in Full vs Partial Debt vs Unpaid Debt) */}
          <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-2.5">
            <label className="text-xs font-semibold text-neutral-300 block">
              {t.paymentSettlementStatus}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectPaymentStatus('paid')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                  paymentStatus === 'paid'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-xs'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t.paidInFull}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPaymentStatus('partial')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                  paymentStatus === 'partial'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300 shadow-xs'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>{t.partialPaymentDebt}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPaymentStatus('unpaid')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                  paymentStatus === 'unpaid'
                    ? 'bg-rose-500/15 border-rose-500 text-rose-300 shadow-xs'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <FileWarning className="w-3.5 h-3.5 shrink-0" />
                <span>{t.unpaidFullDebt}</span>
              </button>
            </div>

            {/* Debt Summary Strip when Partial or Unpaid is selected */}
            {paymentStatus !== 'paid' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800">
                  <span className="text-[11px] text-neutral-400 block">{t.amountPaidLabel}</span>
                  <span className="text-sm font-mono font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(debtBreakdown.amountPaid, settings.currency, settings.language)}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60">
                  <span className="text-[11px] text-rose-300 block">{t.remainingDebt}</span>
                  <span className="text-sm font-mono font-bold text-rose-400 tabular-nums">
                    {formatCurrency(debtBreakdown.debtAmount, settings.currency, settings.language)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Invoice Receipt vs Goods Receipt Option (خيار استلام الفاتورة أو استلام البضاعة) */}
          <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-2">
            <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
              <PackageCheck className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.fulfillmentOptionTitle}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                data-testid="fulfillment-opt-goods-and-invoice"
                onClick={() => {
                  playTactileClick(settings.soundEnabled);
                  setFulfillmentType('goods_and_invoice');
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                  fulfillmentType === 'goods_and_invoice'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-xs'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <PackageCheck className="w-3.5 h-3.5 shrink-0" />
                <span>{isAr ? 'استلام البضاعة والفاتورة' : 'Goods & Invoice'}</span>
              </button>

              <button
                type="button"
                data-testid="fulfillment-opt-invoice-only"
                onClick={() => {
                  playTactileClick(settings.soundEnabled);
                  setFulfillmentType('invoice_only');
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                  fulfillmentType === 'invoice_only'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300 shadow-xs'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span>{isAr ? 'استلام الفاتورة فقط' : 'Invoice Only'}</span>
              </button>

              <button
                type="button"
                data-testid="fulfillment-opt-goods-only"
                onClick={() => {
                  playTactileClick(settings.soundEnabled);
                  setFulfillmentType('goods_only');
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-xs font-bold transition-all ${
                  fulfillmentType === 'goods_only'
                    ? 'bg-blue-500/15 border-blue-500 text-blue-300 shadow-xs'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Truck className="w-3.5 h-3.5 shrink-0" />
                <span>{isAr ? 'استلام بضاعة فقط' : 'Goods Only'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bank Transfer Details: Operation Reference Number + Receipt Notification Image */}
        {paymentMethod === 'bank_transfer' && (
          <div className="flex flex-col gap-3 p-3.5 bg-neutral-950/70 border border-amber-500/30 rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <Landmark className="w-4 h-4" />
                <span>
                  {isAr ? 'بيانات التحويل البنكي والإشعار' : 'Bank Transfer & Notification Details'}
                </span>
              </span>
              {paymentStatus !== 'unpaid' && (
                <span className="text-[10px] font-mono text-neutral-400">
                  {isAr ? '* رقم العملية مطلوب' : '* Reference # required'}
                </span>
              )}
            </div>

            {/* Operation / Reference Number Input */}
            <div>
              <label className="text-xs font-semibold text-neutral-300 block mb-1 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.transferReference}</span>
              </label>
              <input
                type="text"
                dir="ltr"
                value={transferReference}
                onChange={(e) => {
                  setTransferReference(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder={t.transferReferencePlaceholder}
                aria-label={t.transferReference}
                className="w-full bg-neutral-900 border border-neutral-750 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Transfer Notification Image Upload & Preview */}
            <div>
              <label className="text-xs font-semibold text-neutral-300 block mb-1.5 flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.transferReceiptImage}</span>
              </label>

              <input
                ref={receiptFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleReceiptImageUpload}
                className="hidden"
                aria-label={t.uploadReceiptImage}
              />

              {transferReceiptImage ? (
                <div className="flex items-center justify-between gap-3 p-2.5 bg-neutral-900 border border-neutral-750 rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-14 h-14 rounded-lg overflow-hidden bg-neutral-950 border border-neutral-700 shrink-0">
                      <img
                        src={transferReceiptImage}
                        alt={t.transferReceiptImage}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-emerald-400 block">
                        {isAr ? 'تم إرفاق صورة الإشعار بنجاح' : 'Notification image attached'}
                      </span>
                      <span className="text-[11px] text-neutral-400 block truncate">
                        {isAr ? 'ستظهر مع الفاتورة وفي سجل المبيعات' : 'Saved with invoice & receipt'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <TactileButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => receiptFileInputRef.current?.click()}
                      leftIcon={<Upload className="w-3.5 h-3.5" />}
                    >
                      {t.changeReceiptImage}
                    </TactileButton>
                    <TactileButton
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => setTransferReceiptImage('')}
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      aria-label={t.removeReceiptImage}
                    >
                      {t.removeReceiptImage}
                    </TactileButton>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => receiptFileInputRef.current?.click()}
                  className="w-full py-3 px-4 rounded-xl border border-dashed border-neutral-700 hover:border-amber-500/70 bg-neutral-900/60 hover:bg-neutral-900 text-neutral-300 hover:text-amber-300 flex items-center justify-center gap-2 text-xs font-semibold transition-all"
                >
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>{t.uploadReceiptImage}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cash Tender Details or Partial Payment Amount Input */}
        {((paymentMethod === 'cash' && paymentStatus !== 'unpaid') ||
          (paymentStatus === 'partial' && paymentMethod !== 'cash')) && (
          <div className="flex flex-col gap-3 p-3.5 bg-neutral-950/70 border border-neutral-800 rounded-2xl">
            {/* Currency selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {isAr ? 'اختر عملة الدفع المسلمة من العميل' : 'Customer Tender Currency'}
                  </span>
                </span>
                <span className="text-[11px] font-mono text-neutral-400">
                  Base: {settings.currency}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {availableCurrencies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleSelectTenderCurrency(c)}
                    className={`py-1.5 px-3 rounded-xl border text-xs font-mono font-bold transition-all ${
                      tenderCurrency === c
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                        : 'bg-neutral-850 border-neutral-750 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Tendered / Paid Input */}
            <div>
              <label className="text-xs font-semibold text-neutral-300 block mb-1">
                {paymentStatus === 'partial' ? t.amountPaidLabel : t.amountTendered} ({tenderCurrency})
              </label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={tenderedInput}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const normalized = normalizeNumberInput(e.target.value);
                    setTenderedInput(normalized);
                    setErrorMessage(null);
                  }}
                  placeholder="0.00"
                  aria-label={paymentStatus === 'partial' ? t.amountPaidLabel : t.amountTendered}
                  className="w-full bg-neutral-900 border border-neutral-750 focus:border-amber-500 rounded-xl pl-3.5 pr-20 py-2.5 text-xl font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-amber-500 tabular-nums"
                />
                {tenderedInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setTenderedInput('');
                      setErrorMessage(null);
                    }}
                    className="absolute right-14 px-2 py-0.5 text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                  >
                    {isAr ? 'مسح' : 'CLR'}
                  </button>
                )}
                <span className="absolute right-3.5 text-xs font-mono font-bold text-amber-400 pointer-events-none">
                  {tenderCurrency}
                </span>
              </div>
            </div>

            {/* Presets for Full Cash Payment */}
            {paymentMethod === 'cash' && paymentStatus === 'paid' && (
              <div className="flex flex-wrap gap-2">
                {cashPresets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleCashPreset(preset.value)}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold rounded-lg font-mono border border-neutral-700 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {paymentMethod === 'qr_nfc' && (
          <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl flex items-center gap-3 text-xs text-neutral-400">
            <QrCode className="w-8 h-8 text-amber-500 shrink-0" />
            <div>
              <div className="text-white font-medium">
                {isAr ? 'مسح رمز QR / محفظة رقمية' : 'Scan Dynamic QR / NFC Terminal'}
              </div>
              <div>
                {isAr
                  ? 'يدعم الدفع الفوري عبر المحافظ الرقمية ونقاط الاتصال القريب.'
                  : 'Supports instant wallet checkout and peer-to-peer settlement.'}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-rose-950/80 border border-rose-800/80 rounded-xl text-rose-300 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Actions with DynamicButton */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <TactileButton variant="ghost" onClick={onClose} size="md">
            {t.cancel}
          </TactileButton>

          <DynamicButton
            status={buttonStatus}
            onClick={handleExecutePayment}
            readyLabel={
              paymentStatus === 'unpaid'
                ? `${isAr ? 'تسجيل الفاتورة كدين' : 'Record Invoice on Debt'} (${formatCurrency(
                    cartTotals.grandTotal,
                    settings.currency,
                    settings.language
                  )})`
                : paymentStatus === 'partial'
                ? `${isAr ? 'تأكيد الدفع الجزئي والدين' : 'Confirm Partial & Debt'} (${formatCurrency(
                    debtBreakdown.amountPaid,
                    settings.currency,
                    settings.language
                  )})`
                : `${t.payNow} (${formatCurrency(
                    cartTotals.grandTotal,
                    settings.currency,
                    settings.language
                  )})`
            }
            processingLabel={t.processingPayment}
            successLabel={t.paymentCompleted}
            errorLabel={t.paymentFailed}
            variant="emerald"
            className="flex-1"
          />
        </div>
      </div>
    </AppModal>
  );
};


