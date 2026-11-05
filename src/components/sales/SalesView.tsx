/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import {
  formatCurrency,
  formatPaymentMethodLabel,
  getConvertedTransactionView,
  getAllTransactionReceiptImages,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import { normalizeNumberInput, parseNormalizedNumber } from '../../lib/number-utils';
import { Transaction, SalesRateValuationMode, PaymentMethod } from '../../lib/types';
import { AppCard } from '../ui/AppCard';
import { AppInput } from '../ui/AppInput';
import { AppModal } from '../ui/AppModal';
import { TactileButton } from '../ui/TactileButton';
import { HoldToConfirm } from '../ui/HoldToConfirm';
import { ReceiptModal } from '../checkout/ReceiptModal';
import { GoodsReceiptModal } from '../inventory/GoodsReceiptModal';
import {
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  RotateCcw,
  X,
  Hash,
  Image as ImageIcon,
  AlertCircle,
  Check,
  Coins,
  TrendingUp,
  RefreshCw,
  History,
  ShieldCheck,
  ArrowRightLeft,
  PackageCheck,
  FileText,
  Truck,
  Banknote,
  Landmark,
  QrCode,
  Upload,
  Plus,
  Trash2,
} from 'lucide-react';
import { playTactileClick } from '../../lib/sound-fx';

function compressReceiptImageToDataUrl(file: File, maxDim = 640): Promise<string> {
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

export const SalesView: React.FC = () => {
  const {
    transactions,
    voidTransaction,
    settleTransactionDebt,
    updateTransactionFulfillment,
    applyNewRateToTransaction,
    applyNewRateToAllTransactions,
    settings,
    updateSettings,
    currencies,
    exchangeRates,
    updateExchangeRate,
    setActiveTab,
  } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'voided'>('all');
  const [valuationMode, setValuationMode] = useState<SalesRateValuationMode>('historical');
  const [anchorCurrency, setAnchorCurrency] = useState<string>('USD');
  const [rateEditCurrency, setRateEditCurrency] = useState<string>(
    settings.currency && settings.currency !== 'SDG' ? settings.currency : 'USD'
  );
  const [rateInputDraft, setRateInputDraft] = useState<string>(() => {
    const initialCode =
      settings.currency && settings.currency !== 'SDG' ? settings.currency : 'USD';
    return String(exchangeRates[initialCode] || 2700);
  });
  const [rateSaveFeedback, setRateSaveFeedback] = useState<string | null>(null);

  const [selectedReceiptTxn, setSelectedReceiptTxn] = useState<Transaction | null>(null);
  const [previewNotificationTxn, setPreviewNotificationTxn] = useState<Transaction | null>(null);
  const [isGoodsReceiptOpen, setIsGoodsReceiptOpen] = useState<boolean>(false);

  // Debt Settlement & Multi-Installment Customization Modal State
  const [settlingTxnId, setSettlingTxnId] = useState<string | null>(null);
  const [debtInstallmentInput, setDebtInstallmentInput] = useState<string>('');
  const [debtTotalPaidInput, setDebtTotalPaidInput] = useState<string>('');
  const [debtRemainingInput, setDebtRemainingInput] = useState<string>('');
  const [debtSaleRateInput, setDebtSaleRateInput] = useState<string>('');
  const [debtPaymentMethod, setDebtPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [debtTransferRef, setDebtTransferRef] = useState<string>('');
  const [debtNewReceiptImages, setDebtNewReceiptImages] = useState<string[]>([]);
  const [debtReceiptUrlInput, setDebtReceiptUrlInput] = useState<string>('');
  const [debtSettlementNote, setDebtSettlementNote] = useState<string>('');
  const [debtErrorMsg, setDebtErrorMsg] = useState<string | null>(null);
  const debtReceiptFileInputRef = useRef<HTMLInputElement | null>(null);

  const activeCurrencyCodes = useMemo(() => {
    const list =
      currencies && currencies.length > 0
        ? currencies.filter((c) => c.isActive !== false).map((c) => c.code.toUpperCase())
        : ['SDG', 'USD', 'SAR', 'AED', 'EUR', 'GBP'];
    return Array.from(new Set(['SDG', ...list]));
  }, [currencies]);

  const foreignCurrencyCodes = useMemo(() => {
    const list = activeCurrencyCodes.filter((c) => c !== 'SDG');
    return list.length > 0 ? list : ['USD', 'SAR', 'AED', 'EUR', 'GBP'];
  }, [activeCurrencyCodes]);

  // Sync quick rate editor currency when active display currency or exchangeRates change
  useEffect(() => {
    const targetCode =
      settings.currency && settings.currency !== 'SDG'
        ? settings.currency.toUpperCase()
        : anchorCurrency.toUpperCase();
    setRateEditCurrency(targetCode);
    if (exchangeRates[targetCode]) {
      setRateInputDraft(String(exchangeRates[targetCode]));
    }
  }, [settings.currency, anchorCurrency, exchangeRates]);

  const handleSelectRateEditCurrency = (code: string) => {
    const clean = code.toUpperCase();
    setRateEditCurrency(clean);
    setAnchorCurrency(clean);
    setRateInputDraft(String(exchangeRates[clean] || 1));
  };

  const handleSaveQuickRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(rateInputDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    setAnchorCurrency(rateEditCurrency);
    await updateExchangeRate({
      sourceCurrency: rateEditCurrency,
      targetCurrency: 'SDG',
      rate: parsed,
    });

    setRateSaveFeedback(
      isAr
        ? `تم تحديث سعر الصرف: 1 ${rateEditCurrency} = ${parsed} ج.س`
        : `Updated rate: 1 ${rateEditCurrency} = ${parsed} SDG`
    );
    setTimeout(() => setRateSaveFeedback(null), 3000);
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        tx.id.toLowerCase().includes(q) ||
        (tx.customerName && tx.customerName.toLowerCase().includes(q)) ||
        tx.paymentMethod.toLowerCase().includes(q) ||
        (tx.transferReference && tx.transferReference.toLowerCase().includes(q));

      const matchStatus = statusFilter === 'all' || tx.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [transactions, searchQuery, statusFilter]);

  // Pre-compute converted view for each filtered transaction
  const convertedRows = useMemo(() => {
    return filteredTransactions.map((tx) => ({
      tx,
      view: getConvertedTransactionView(
        tx,
        settings.currency,
        exchangeRates,
        valuationMode,
        anchorCurrency
      ),
    }));
  }, [filteredTransactions, settings.currency, exchangeRates, valuationMode, anchorCurrency]);

  // Summary KPIs in active currency
  const salesSummary = useMemo(() => {
    let grossTotal = 0;
    let collectedTotal = 0;
    let debtTotal = 0;
    let outOfSyncCount = 0;

    for (const { tx, view } of convertedRows) {
      if (tx.status === 'completed') {
        grossTotal += view.grandTotal;
        collectedTotal += view.amountPaid;
        debtTotal += view.debtAmount;
        if (view.hasRateChanged) {
          outOfSyncCount += 1;
        }
      }
    }

    return {
      grossTotal,
      collectedTotal,
      debtTotal,
      outOfSyncCount,
    };
  }, [convertedRows]);

  const handleVoid = (id: string) => {
    voidTransaction(id);
  };

  const handleSyncAllToNewRate = () => {
    const count = applyNewRateToAllTransactions(false, anchorCurrency);
    setRateSaveFeedback(
      isAr
        ? `تم ربط وتحديث ${count} فاتورة بسعر الصرف الجديد بنجاح`
        : `Successfully linked & updated ${count} invoices to the new exchange rate`
    );
    setTimeout(() => setRateSaveFeedback(null), 3000);
  };

  // Active transaction selected for Debt Settlement & Installment Customization
  const activeSettlingData = useMemo(() => {
    if (!settlingTxnId) return null;
    const found = convertedRows.find((r) => r.tx.id === settlingTxnId);
    if (found) return found;
    const rawTx = transactions.find((t) => t.id === settlingTxnId);
    if (!rawTx) return null;
    return {
      tx: rawTx,
      view: getConvertedTransactionView(
        rawTx,
        settings.currency,
        exchangeRates,
        valuationMode,
        anchorCurrency
      ),
    };
  }, [settlingTxnId, convertedRows, transactions, settings.currency, exchangeRates, valuationMode, anchorCurrency]);

  const openDebtSettlementModal = (tx: Transaction) => {
    playTactileClick(settings.soundEnabled);
    const view = getConvertedTransactionView(
      tx,
      settings.currency,
      exchangeRates,
      valuationMode,
      anchorCurrency
    );
    const grandTotal = roundCurrencyValue(view.grandTotal);
    const prevPaid = roundCurrencyValue(view.amountPaid);
    const currentDebt = roundCurrencyValue(view.debtAmount);
    const defaultInstallment = currentDebt > 0 ? currentDebt : 0;
    const nextTotalPaid = roundCurrencyValue(Math.min(grandTotal, prevPaid + defaultInstallment));
    const nextRemaining = roundCurrencyValue(Math.max(0, grandTotal - nextTotalPaid));

    setSettlingTxnId(tx.id);
    setDebtInstallmentInput(String(defaultInstallment));
    setDebtTotalPaidInput(String(nextTotalPaid));
    setDebtRemainingInput(String(nextRemaining));
    setDebtSaleRateInput(String(view.historicalRate || tx.exchangeRateUsed || 2700));
    setDebtPaymentMethod(tx.paymentMethod || 'bank_transfer');
    setDebtTransferRef(tx.transferReference || '');
    setDebtNewReceiptImages([]);
    setDebtReceiptUrlInput('');
    setDebtSettlementNote('');
    setDebtErrorMsg(null);
  };

  const handleInstallmentAmountChange = (rawVal: string) => {
    if (!activeSettlingData) return;
    const cleaned = normalizeNumberInput(rawVal);
    setDebtInstallmentInput(cleaned);
    const grandTotal = roundCurrencyValue(activeSettlingData.view.grandTotal);
    const prevPaid = roundCurrencyValue(activeSettlingData.view.amountPaid);
    const maxInstallment = roundCurrencyValue(Math.max(0, grandTotal - prevPaid));
    const parsedInstallment = Math.max(
      0,
      Math.min(maxInstallment, parseNormalizedNumber(cleaned, 0))
    );
    const nextTotalPaid = roundCurrencyValue(Math.min(grandTotal, prevPaid + parsedInstallment));
    const nextRemaining = roundCurrencyValue(Math.max(0, grandTotal - nextTotalPaid));
    setDebtTotalPaidInput(String(nextTotalPaid));
    setDebtRemainingInput(String(nextRemaining));
    setDebtErrorMsg(null);
  };

  const handleTotalPaidDirectChange = (rawVal: string) => {
    if (!activeSettlingData) return;
    const cleaned = normalizeNumberInput(rawVal);
    setDebtTotalPaidInput(cleaned);
    const grandTotal = roundCurrencyValue(activeSettlingData.view.grandTotal);
    const prevPaid = roundCurrencyValue(activeSettlingData.view.amountPaid);
    const parsedTotalPaid = Math.max(0, Math.min(grandTotal, parseNormalizedNumber(cleaned, 0)));
    const nextRemaining = roundCurrencyValue(Math.max(0, grandTotal - parsedTotalPaid));
    const nextInstallment = roundCurrencyValue(Math.max(0, parsedTotalPaid - prevPaid));
    setDebtRemainingInput(String(nextRemaining));
    setDebtInstallmentInput(String(nextInstallment));
    setDebtErrorMsg(null);
  };

  const handleRemainingDirectChange = (rawVal: string) => {
    if (!activeSettlingData) return;
    const cleaned = normalizeNumberInput(rawVal);
    setDebtRemainingInput(cleaned);
    const grandTotal = roundCurrencyValue(activeSettlingData.view.grandTotal);
    const prevPaid = roundCurrencyValue(activeSettlingData.view.amountPaid);
    const parsedRemaining = Math.max(0, Math.min(grandTotal, parseNormalizedNumber(cleaned, 0)));
    const nextTotalPaid = roundCurrencyValue(Math.max(0, grandTotal - parsedRemaining));
    const nextInstallment = roundCurrencyValue(Math.max(0, nextTotalPaid - prevPaid));
    setDebtTotalPaidInput(String(nextTotalPaid));
    setDebtInstallmentInput(String(nextInstallment));
    setDebtErrorMsg(null);
  };

  const handleDebtReceiptFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files: File[] = Array.from(fileList);
    try {
      const compressedList: string[] = [];
      for (const file of files) {
        const dataUrl = await compressReceiptImageToDataUrl(file);
        if (dataUrl) compressedList.push(dataUrl);
      }
      setDebtNewReceiptImages((prev) => [...prev, ...compressedList]);
      setDebtErrorMsg(null);
    } catch {
      setDebtErrorMsg(
        isAr ? 'تعذر معالجة إحدى صور الإشعار' : 'Failed to process one of the receipt images'
      );
    } finally {
      if (debtReceiptFileInputRef.current) {
        debtReceiptFileInputRef.current.value = '';
      }
    }
  };

  const handleAddDebtReceiptUrl = () => {
    const clean = debtReceiptUrlInput.trim();
    if (!clean) return;
    playTactileClick(settings.soundEnabled);
    setDebtNewReceiptImages((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    setDebtReceiptUrlInput('');
  };

  const handleRemoveStagedReceiptImage = (index: number) => {
    playTactileClick(settings.soundEnabled);
    setDebtNewReceiptImages((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmitDebtSettlement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSettlingData) return;

    const grandTotal = roundCurrencyValue(activeSettlingData.view.grandTotal);
    const customTotalPaid = Math.max(
      0,
      Math.min(grandTotal, parseNormalizedNumber(debtTotalPaidInput, 0))
    );
    const pendingUrl = debtReceiptUrlInput.trim();
    const finalReceiptImages = pendingUrl
      ? Array.from(new Set([...debtNewReceiptImages, pendingUrl]))
      : debtNewReceiptImages;

    if (
      debtPaymentMethod === 'bank_transfer' &&
      customTotalPaid > 0 &&
      !debtTransferRef.trim() &&
      !activeSettlingData.tx.transferReference
    ) {
      setDebtErrorMsg(
        isAr
          ? 'يرجى إدخال رقم العملية للتحويل البنكي أو اختيار طريقة دفع أخرى.'
          : 'Please enter the Bank Transfer reference number or select another payment method.'
      );
      return;
    }

    const parsedCustomSaleRate = parseNormalizedNumber(
      debtSaleRateInput,
      activeSettlingData.view.historicalRate
    );

    settleTransactionDebt(
      activeSettlingData.tx.id,
      valuationMode === 'indexed',
      anchorCurrency,
      {
        customTotalPaidInDisplayCurrency: customTotalPaid,
        displayCurrency: settings.currency,
        paymentMethod: debtPaymentMethod,
        transferReference: debtTransferRef.trim() || undefined,
        receiptImages: finalReceiptImages,
        note: debtSettlementNote.trim() || undefined,
        useIndexedNewRate: valuationMode === 'indexed',
        anchorCurrency,
        customSaleExchangeRate:
          Number.isFinite(parsedCustomSaleRate) && parsedCustomSaleRate > 0
            ? parsedCustomSaleRate
            : undefined,
      }
    );

    setSettlingTxnId(null);
  };

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {t.salesHistory}
          </h2>
          <span className="text-xs text-neutral-400">
            {isAr
              ? `${transactions.length} فاتورة مسجلة • يتم تحويل القيم والديون تلقائياً حسب العملة وسعر الصرف`
              : `${transactions.length} total orders • Totals & debts convert dynamically by currency & exchange rate`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TactileButton
            variant="emerald"
            size="sm"
            data-testid="sales-open-goods-receipt-btn"
            onClick={() => setIsGoodsReceiptOpen(true)}
            leftIcon={<PackageCheck className="w-3.5 h-3.5" />}
          >
            {t.receiveSupplierGoodsBtn}
          </TactileButton>

          {salesSummary.outOfSyncCount > 0 && (
            <TactileButton
              variant="amber"
              size="sm"
              onClick={handleSyncAllToNewRate}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {isAr
                ? `تثبيت كل الفواتير والديون بالسعر الجديد (${salesSummary.outOfSyncCount})`
                : `Sync All Invoices to New Rate (${salesSummary.outOfSyncCount})`}
            </TactileButton>
          )}
        </div>
      </div>

      {/* Summary KPI Cards in Active Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AppCard className="p-4 border-neutral-800 bg-neutral-900/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-neutral-400 block mb-1">
              {t.grossSales} ({settings.currency})
            </span>
            <span
              data-testid="sales-kpi-gross"
              className="text-lg sm:text-xl font-extrabold text-emerald-400 tabular-nums"
            >
              {formatCurrency(salesSummary.grossTotal, settings.currency, settings.language)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/50 flex items-center justify-center text-emerald-400">
            <TrendingUp className="w-5 h-5" />
          </div>
        </AppCard>

        <AppCard className="p-4 border-neutral-800 bg-neutral-900/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-neutral-400 block mb-1">
              {t.totalCollectedSales} ({settings.currency})
            </span>
            <span
              data-testid="sales-kpi-collected"
              className="text-lg sm:text-xl font-extrabold text-amber-400 tabular-nums"
            >
              {formatCurrency(salesSummary.collectedTotal, settings.currency, settings.language)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-800/50 flex items-center justify-center text-amber-400">
            <Coins className="w-5 h-5" />
          </div>
        </AppCard>

        <AppCard className="p-4 border-neutral-800 bg-neutral-900/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-neutral-400 block mb-1">
              {t.totalOutstandingDebts} ({settings.currency})
            </span>
            <span
              data-testid="sales-kpi-debt"
              className="text-lg sm:text-xl font-extrabold text-rose-400 tabular-nums"
            >
              {formatCurrency(salesSummary.debtTotal, settings.currency, settings.language)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-800/50 flex items-center justify-center text-rose-400">
            <AlertCircle className="w-5 h-5" />
          </div>
        </AppCard>
      </div>

      {/* Multi-Currency & Fluctuating Exchange Rate Control Panel */}
      <AppCard className="p-4 border-amber-500/30 bg-neutral-900/95 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* 1. Display Currency Switcher */}
          <div className="lg:col-span-4 space-y-1.5">
            <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.salesDisplayCurrency}</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {activeCurrencyCodes.map((code) => {
                const isSelected = settings.currency.toUpperCase() === code;
                return (
                  <button
                    key={code}
                    type="button"
                    data-testid={`sales-currency-btn-${code}`}
                    onClick={() => updateSettings({ currency: code })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all border ${
                      isSelected
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                        : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-amber-500/50 hover:text-white'
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Quick Live Exchange Rate Editor */}
          <div className="lg:col-span-4 space-y-1.5">
            <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t.quickRateUpdate}</span>
            </label>
            <form onSubmit={handleSaveQuickRate} className="flex items-center gap-1.5">
              <div className="flex items-center bg-neutral-950 border border-neutral-800 rounded-xl px-2 py-1 text-xs font-mono text-neutral-300 shrink-0">
                <span>1</span>
                <select
                  aria-label="Currency to edit exchange rate"
                  value={rateEditCurrency}
                  onChange={(e) => handleSelectRateEditCurrency(e.target.value)}
                  className="bg-transparent font-bold text-amber-400 pl-1 pr-0.5 py-0.5 focus:outline-none cursor-pointer"
                >
                  {foreignCurrencyCodes.map((code) => (
                    <option key={code} value={code} className="bg-neutral-900 text-white">
                      {code}
                    </option>
                  ))}
                </select>
                <span className="mx-1">=</span>
              </div>

              <input
                type="number"
                step="any"
                min="0.0001"
                dir="ltr"
                data-testid="sales-quick-rate-input"
                value={rateInputDraft}
                onChange={(e) => setRateInputDraft(e.target.value)}
                className="w-28 px-2.5 py-1.5 rounded-xl bg-neutral-950 border border-neutral-700 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                placeholder="2700"
              />

              <span className="text-[11px] font-mono text-neutral-400 shrink-0">SDG</span>

              <TactileButton
                type="submit"
                variant="emerald"
                size="sm"
                data-testid="sales-quick-rate-submit"
                className="shrink-0 px-3 py-1.5 text-xs"
              >
                {t.applyNewRateBtn}
              </TactileButton>
            </form>
            {rateSaveFeedback && (
              <p className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>{rateSaveFeedback}</span>
              </p>
            )}
          </div>

          {/* 3. Fluctuating Exchange Rate Valuation Mode Selector */}
          <div className="lg:col-span-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.rateValuationMode}</span>
              </label>

              {valuationMode === 'indexed' && (
                <div className="flex items-center gap-1 text-[10px] text-neutral-400">
                  <span>{isAr ? 'العملة المرجعية:' : 'Anchor:'}</span>
                  <select
                    aria-label="Anchor Hard Currency"
                    value={anchorCurrency}
                    onChange={(e) => handleSelectRateEditCurrency(e.target.value)}
                    className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-0.5 text-amber-400 font-mono font-bold focus:outline-none"
                  >
                    {foreignCurrencyCodes.map((c) => (
                      <option key={c} value={c} className="bg-neutral-900 text-white">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
              <button
                type="button"
                data-testid="valuation-mode-historical"
                onClick={() => setValuationMode('historical')}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                  valuationMode === 'historical'
                    ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title={t.modeHistoricalRate}
              >
                <History className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {isAr ? 'سعر الصرف وقت البيع' : 'Saved Sale Rate'}
                </span>
              </button>

              <button
                type="button"
                data-testid="valuation-mode-indexed"
                onClick={() => setValuationMode('indexed')}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                  valuationMode === 'indexed'
                    ? 'bg-amber-500 text-neutral-950 shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title={t.modeIndexedRate}
              >
                <ShieldCheck className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {isAr ? 'ربط بالسعر الجديد' : 'Linked New Rate'}
                </span>
              </button>

              <button
                type="button"
                data-testid="valuation-mode-live"
                onClick={() => setValuationMode('live')}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                  valuationMode === 'live'
                    ? 'bg-blue-500 text-neutral-950 shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title={t.modeLiveRate}
              >
                <RefreshCw className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {isAr ? 'تحويل مباشر' : 'Live Direct'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Contextual Explanation Banner for the Active Mode */}
        <div className="pt-2 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
          <div>
            {valuationMode === 'historical' && (
              <span className="text-emerald-300 font-semibold">
                {isAr
                  ? 'وضع حفظ الفواتير بسعر الصرف وقت البيع (مفعل افتراضياً): تحفظ وتُعرض كل فاتورة بسعر الصرف الذي تم البيع به لحظة إصدارها دون أن تتغير عند تعديل سعر الصرف لاحقاً.'
                  : 'Saved Sale Exchange Rate Mode (Default): Every invoice is saved and displayed at the exact exchange rate locked when the sale was made.'}
              </span>
            )}
            {valuationMode === 'indexed' && (
              <span>
                {isAr
                  ? `وضع الحماية من تغير الصرف: يتم حفظ قيمة الفاتورة والدين بعملة (${anchorCurrency}) وقت البيع، وعند تغير سعر الصرف تتعدل القيمة تلقائياً بالسعر الجديد (${exchangeRates[anchorCurrency] || 2700} ج.س).`
                  : `Inflation-Protected Mode: Invoices & debts retain their ${anchorCurrency} value at time of sale and automatically adjust to the new exchange rate (${exchangeRates[anchorCurrency] || 2700} SDG).`}
              </span>
            )}
            {valuationMode === 'live' && (
              <span>
                {isAr
                  ? `وضع التحويل المباشر: يحول مبلغ الفاتورة المسجل مباشرة إلى (${settings.currency}) باستخدام سعر الصرف الحالي.`
                  : `Direct Live Mode: Converts the recorded invoice amount directly to ${settings.currency} using today's exchange rate.`}
              </span>
            )}
          </div>
        </div>
      </AppCard>

      {/* Filters Strip */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <AppInput
            placeholder={t.searchTransactions}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
            rightIcon={
              searchQuery ? (
                <button onClick={() => setSearchQuery('')} className="p-1 text-neutral-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : undefined
            }
          />
        </div>

        <div className="flex items-center gap-1.5 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
          {(['all', 'completed', 'voided'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                statusFilter === st
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {st === 'all'
                ? isAr
                  ? 'الكل'
                  : 'All'
                : st === 'completed'
                ? t.completed
                : t.voided}
            </button>
          ))}
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-3">
        {convertedRows.length === 0 ? (
          <AppCard className="text-center p-12 text-xs text-neutral-500">
            {isAr ? 'لا توجد فواتير مطابقة للبحث.' : 'No transactions match your search filter.'}
          </AppCard>
        ) : (
          convertedRows.map(({ tx, view }) => {
            const isCompleted = tx.status === 'completed';
            const hasDebt = isCompleted && view.debtAmount > 0;
            const allReceiptImages = getAllTransactionReceiptImages(tx);
            const installmentsCount = tx.debtPayments?.length || 0;
            const showOriginalBadge =
              view.originalCurrency !== settings.currency ||
              Math.abs(view.grandTotal - tx.grandTotal) > 0.0001;

            return (
              <AppCard
                key={tx.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-mono font-bold text-sm text-white">{tx.id}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                        isCompleted
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                          : 'bg-rose-950/80 text-rose-400 border border-rose-800/50'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      <span className="capitalize">
                        {isCompleted ? t.completed : t.voided}
                      </span>
                    </span>

                    <span className="text-[11px] font-semibold text-amber-300 px-2 py-0.5 bg-neutral-800 border border-neutral-700 rounded">
                      {formatPaymentMethodLabel(tx.paymentMethod, settings.language)}
                    </span>

                    {tx.transferReference && (
                      <span className="text-[11px] font-mono text-neutral-300 px-2 py-0.5 bg-neutral-900 border border-neutral-750 rounded flex items-center gap-1">
                        <Hash className="w-3 h-3 text-amber-400" />
                        <span>{tx.transferReference}</span>
                      </span>
                    )}

                    {hasDebt ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-950/90 text-rose-300 border border-rose-700/70 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        <span>
                          {t.remainingDebt}:{' '}
                          <span className="tabular-nums">
                            {formatCurrency(view.debtAmount, settings.currency, settings.language)}
                          </span>
                        </span>
                      </span>
                    ) : (
                      isCompleted && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-950/50 text-emerald-300 border border-emerald-800/40">
                          {t.paidInFull}
                        </span>
                      )
                    )}

                    {installmentsCount > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/40">
                        {isAr ? (
                          <>
                            دفعات السداد: <span className="font-mono">{installmentsCount}</span>
                          </>
                        ) : (
                          <>
                            Installments: <span className="font-mono">{installmentsCount}</span>
                          </>
                        )}
                      </span>
                    )}

                    {allReceiptImages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPreviewNotificationTxn(tx)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 transition-colors"
                      >
                        <ImageIcon className="w-3 h-3" />
                        <span>
                          {isAr ? (
                            <>
                              إشعارات الدفع (<span className="font-mono">{allReceiptImages.length}</span>)
                            </>
                          ) : (
                            <>
                              Receipts (<span className="font-mono">{allReceiptImages.length}</span>)
                            </>
                          )}
                        </span>
                      </button>
                    )}

                    {/* Fulfillment / Goods & Invoice Receipt Status Badge */}
                    {isCompleted && (
                      <>
                        {(!tx.fulfillmentStatus || tx.fulfillmentStatus === 'received') && (
                          <span
                            data-testid={`sales-fulfillment-badge-${tx.id}`}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 flex items-center gap-1"
                          >
                            <PackageCheck className="w-3 h-3" />
                            <span>{t.fulfillmentReceivedBadge}</span>
                          </span>
                        )}
                        {tx.fulfillmentStatus === 'pending_goods' && (
                          <span
                            data-testid={`sales-fulfillment-badge-${tx.id}`}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-700/60 flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" />
                            <span>{t.fulfillmentPendingGoodsBadge}</span>
                          </span>
                        )}
                        {tx.fulfillmentStatus === 'pending_invoice' && (
                          <span
                            data-testid={`sales-fulfillment-badge-${tx.id}`}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-950/80 text-blue-300 border border-blue-700/60 flex items-center gap-1"
                          >
                            <Truck className="w-3 h-3" />
                            <span>{t.fulfillmentPendingInvoiceBadge}</span>
                          </span>
                        )}
                      </>
                    )}

                    {/* Original Invoice Value & Saved Sale Exchange Rate Badges */}
                    {showOriginalBadge && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-neutral-950 text-neutral-300 border border-neutral-800">
                        {t.originalInvoiceValue}:{' '}
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(tx.grandTotal, view.originalCurrency, settings.language)}
                        </span>
                      </span>
                    )}

                    {/* Always display the saved sale-time exchange rate on every invoice card */}
                    <button
                      type="button"
                      data-testid={`saved-sale-rate-badge-${tx.id}`}
                      onClick={() => openDebtSettlementModal(tx)}
                      className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1.5 transition-colors"
                      title={
                        isAr
                          ? 'الفاتورة محفوظة بسعر الصرف الذي تم البيع به (اضغط للتخصيص)'
                          : 'Invoice is saved at the exchange rate used at time of sale (click to customize)'
                      }
                    >
                      <History className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>
                        {isAr ? 'سعر الصرف المحفوظ وقت البيع:' : 'Saved Sale Rate:'}{' '}
                        <span className="font-mono font-extrabold text-white tabular-nums" dir="ltr">
                          1 {view.referenceCurrency} = {view.historicalRate} SDG
                        </span>
                      </span>
                      {view.hasRateChanged && (
                        <span className="text-[9px] text-amber-300 font-semibold">
                          {valuationMode === 'historical'
                            ? isAr
                              ? `(ثابت • الحالي ${view.currentRate})`
                              : `(Locked • Live ${view.currentRate})`
                            : `→ ${view.currentRate}`}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="text-xs text-neutral-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono">{new Date(tx.timestamp).toLocaleString()}</span>
                    <span>·</span>
                    <span>{tx.customerName || t.walkInCustomer}</span>
                    <span>·</span>
                    <span>
                      {tx.items.reduce((acc, i) => acc + i.quantity, 0)} {t.itemsCount} (
                      {tx.items
                        .map((i) => i.productName)
                        .slice(0, 2)
                        .join(', ')}
                      {tx.items.length > 2 ? '...' : ''})
                    </span>
                  </div>
                </div>

                {/* Amount, Paid vs Remaining Breakdown & Actions */}
                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-neutral-800">
                  <div className="text-left sm:text-right">
                    <span
                      data-testid={`sales-row-total-${tx.id}`}
                      className="text-base font-bold text-emerald-400 tabular-nums block"
                    >
                      {formatCurrency(view.grandTotal, settings.currency, settings.language)}
                    </span>
                    <div className="flex items-center sm:justify-end gap-2 text-[10px]">
                      <span className="text-neutral-300">
                        {isAr ? 'المدفوع:' : 'Paid:'}{' '}
                        <span className="font-semibold text-emerald-300 tabular-nums">
                          {formatCurrency(view.amountPaid, settings.currency, settings.language)}
                        </span>
                      </span>
                      {hasDebt && (
                        <span className="text-rose-400 font-semibold">
                          {isAr ? 'المتبقي:' : 'Remaining:'}{' '}
                          <span className="font-bold tabular-nums">
                            {formatCurrency(view.debtAmount, settings.currency, settings.language)}
                          </span>
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-neutral-400 block mt-0.5">
                      {isAr ? (
                        <>
                          بسعر صرف البيع:{' '}
                          <span className="font-mono font-semibold text-amber-300 tabular-nums" dir="ltr">
                            1 {view.referenceCurrency} = {view.historicalRate}
                          </span>
                        </>
                      ) : (
                        <>
                          At Sale Rate:{' '}
                          <span className="font-mono font-semibold text-amber-300 tabular-nums" dir="ltr">
                            1 {view.referenceCurrency} = {view.historicalRate}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isCompleted &&
                      tx.fulfillmentStatus &&
                      tx.fulfillmentStatus !== 'received' && (
                        <TactileButton
                          variant="emerald"
                          size="sm"
                          data-testid={`confirm-fulfillment-btn-${tx.id}`}
                          onClick={() => updateTransactionFulfillment(tx.id, 'received')}
                          leftIcon={<PackageCheck className="w-3.5 h-3.5" />}
                        >
                          {t.confirmGoodsReceiptBtn}
                        </TactileButton>
                      )}

                    {isCompleted && view.hasRateChanged && (
                      <TactileButton
                        variant="secondary"
                        size="sm"
                        onClick={() => applyNewRateToTransaction(tx.id, anchorCurrency)}
                        leftIcon={<RefreshCw className="w-3.5 h-3.5 text-amber-400" />}
                        title={t.syncInvoiceToNewRate}
                      >
                        {t.syncInvoiceToNewRate}
                      </TactileButton>
                    )}

                    {allReceiptImages.length > 0 && (
                      <TactileButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setPreviewNotificationTxn(tx)}
                        leftIcon={<ImageIcon className="w-3.5 h-3.5 text-amber-400" />}
                      >
                        {t.transferReceiptImage} ({allReceiptImages.length})
                      </TactileButton>
                    )}

                    {isCompleted && (
                      <TactileButton
                        variant={hasDebt ? 'emerald' : 'secondary'}
                        size="sm"
                        data-testid={`open-debt-settlement-btn-${tx.id}`}
                        onClick={() => openDebtSettlementModal(tx)}
                        leftIcon={
                          hasDebt ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Coins className="w-3.5 h-3.5 text-amber-400" />
                          )
                        }
                      >
                        {hasDebt
                          ? t.settleDebt
                          : isAr
                          ? 'تخصيص الدفع / الإشعارات'
                          : 'Customize Payment'}
                      </TactileButton>
                    )}

                    <TactileButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedReceiptTxn(tx)}
                      leftIcon={<Eye className="w-3.5 h-3.5" />}
                    >
                      {isAr ? 'الفاتورة' : 'Receipt'}
                    </TactileButton>

                    {isCompleted && (
                      <HoldToConfirm
                        onConfirm={() => handleVoid(tx.id)}
                        label={isAr ? 'إلغاء' : 'Void'}
                        confirmingLabel={isAr ? 'جارٍ الإلغاء...' : 'Voiding...'}
                        confirmedLabel={isAr ? 'ملغاة' : 'Voided'}
                        variant="danger"
                        className="py-1 px-3 text-xs min-h-[36px]"
                        icon={<RotateCcw className="w-3.5 h-3.5" />}
                      />
                    )}
                  </div>
                </div>
              </AppCard>
            );
          })
        )}
      </div>

      {/* Custom Debt Settlement & Multi-Installment Modal */}
      <AppModal
        isOpen={Boolean(activeSettlingData)}
        onClose={() => setSettlingTxnId(null)}
        title={
          isAr
            ? `تسديد الدين وتخصيص الدفعات • ${activeSettlingData?.tx.id || ''}`
            : `Debt Settlement & Payment Customization • ${activeSettlingData?.tx.id || ''}`
        }
        description={
          isAr
            ? 'خصّص المبلغ المدفوع من الإجمالي والمبلغ المتبقي، وحدد طريقة الدفع، وأرفق صورة أو عدة صور إشعار لكل دفعة'
            : 'Customize how much was paid out of the total and how much remains, choose payment method, and attach multiple receipt images'
        }
        maxWidth="2xl"
      >
        {activeSettlingData && (
          <form
            onSubmit={handleSubmitDebtSettlement}
            data-testid="debt-settlement-modal"
            className="flex flex-col gap-4 max-h-[78vh] overflow-y-auto pr-1"
          >
            {debtErrorMsg && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{debtErrorMsg}</span>
              </div>
            )}

            {/* 1. Financial Summary Cards: Total Invoice, Previously Paid, Current Remaining Debt */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-2xl bg-neutral-950 border border-neutral-800">
                <span className="text-[11px] text-neutral-400 block mb-0.5">
                  {isAr ? 'المبلغ الإجمالي للفاتورة' : 'Invoice Grand Total'}
                </span>
                <span className="text-base font-extrabold text-white tabular-nums">
                  {formatCurrency(
                    activeSettlingData.view.grandTotal,
                    settings.currency,
                    settings.language
                  )}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-950/30 border border-emerald-800/50">
                <span className="text-[11px] text-emerald-300 block mb-0.5">
                  {isAr ? 'المدفوع سابقاً' : 'Previously Paid'}
                </span>
                <span className="text-base font-extrabold text-emerald-400 tabular-nums">
                  {formatCurrency(
                    activeSettlingData.view.amountPaid,
                    settings.currency,
                    settings.language
                  )}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-800/50">
                <span className="text-[11px] text-rose-300 block mb-0.5">
                  {isAr ? 'الدين المتبقي حالياً' : 'Current Remaining Debt'}
                </span>
                <span className="text-base font-extrabold text-rose-400 tabular-nums">
                  {formatCurrency(
                    activeSettlingData.view.debtAmount,
                    settings.currency,
                    settings.language
                  )}
                </span>
              </div>
            </div>

            {/* 2. Customize Paid vs Remaining Balance */}
            <div className="p-3.5 rounded-2xl bg-neutral-950/90 border border-amber-500/30 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Coins className="w-4 h-4" />
                  <span>
                    {isAr
                      ? 'تخصيص كم دفع من المبلغ الإجمالي وكم المتبقي'
                      : 'Customize Paid Amount & Remaining Balance'}
                  </span>
                </span>

                {/* Quick Fraction Presets */}
                <div className="flex items-center flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-testid="debt-preset-full-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      handleTotalPaidDirectChange(
                        String(roundCurrencyValue(activeSettlingData.view.grandTotal))
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold transition-colors"
                  >
                    {isAr ? 'سداد كامل المتبقي (100%)' : 'Pay Full Remaining (100%)'}
                  </button>
                  {activeSettlingData.view.debtAmount > 0 && (
                    <button
                      type="button"
                      data-testid="debt-preset-half-btn"
                      onClick={() => {
                        playTactileClick(settings.soundEnabled);
                        handleInstallmentAmountChange(
                          String(roundCurrencyValue(activeSettlingData.view.debtAmount / 2))
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-bold transition-colors"
                    >
                      {isAr ? 'نصف المتبقي (50%)' : 'Half Remaining (50%)'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      handleTotalPaidDirectChange('0');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-semibold transition-colors"
                  >
                    {isAr ? 'تصفير المدفوع (دين كامل)' : 'Reset to Unpaid'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AppInput
                  label={
                    isAr
                      ? `مبلغ الدفعة الحالية الآن (${settings.currency})`
                      : `Current Installment Paid (${settings.currency})`
                  }
                  data-testid="debt-installment-amount-input"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={debtInstallmentInput}
                  onChange={(e) => handleInstallmentAmountChange(e.target.value)}
                />

                <AppInput
                  label={
                    isAr
                      ? `إجمالي المدفوع من الفاتورة (${settings.currency})`
                      : `Total Paid of Invoice (${settings.currency})`
                  }
                  data-testid="debt-custom-total-paid-input"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={debtTotalPaidInput}
                  onChange={(e) => handleTotalPaidDirectChange(e.target.value)}
                />

                <AppInput
                  label={
                    isAr
                      ? `المبلغ المتبقي كدين (${settings.currency})`
                      : `Remaining Debt Balance (${settings.currency})`
                  }
                  data-testid="debt-custom-remaining-input"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={debtRemainingInput}
                  onChange={(e) => handleRemainingDirectChange(e.target.value)}
                />
              </div>

              {/* Live Outcome Status Strip */}
              <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-neutral-400">
                    {isAr ? 'حالة الفاتورة بعد الحفظ:' : 'Status After Save:'}
                  </span>
                  {parseNormalizedNumber(debtRemainingInput, 0) <= 0 ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                      {isAr ? 'مدفوعة بالكامل (لا يوجد دين متبقي)' : 'Paid in Full (0 Debt)'}
                    </span>
                  ) : parseNormalizedNumber(debtTotalPaidInput, 0) > 0 ? (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                      {isAr ? 'مدفوعة جزئياً (يوجد متبقي)' : 'Partially Paid (Remaining Debt)'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">
                      {isAr ? 'غير مدفوعة (دين كامل)' : 'Unpaid (Full Debt)'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="text-neutral-300">
                    {isAr ? 'المدفوع:' : 'Paid:'}{' '}
                    <span className="font-bold text-emerald-400 tabular-nums">
                      {formatCurrency(
                        parseNormalizedNumber(debtTotalPaidInput, 0),
                        settings.currency,
                        settings.language
                      )}
                    </span>
                  </span>
                  <span className="text-neutral-300">
                    {isAr ? 'المتبقي:' : 'Remaining:'}{' '}
                    <span className="font-bold text-rose-400 tabular-nums">
                      {formatCurrency(
                        parseNormalizedNumber(debtRemainingInput, 0),
                        settings.currency,
                        settings.language
                      )}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Select Payment Method & Reference Number */}
            <div className="p-3.5 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-3">
              <span className="text-xs font-bold text-white block">
                {isAr ? 'تحديد طريقة دفع هذه الدفعة' : 'Select Payment Method'}
              </span>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'cash' as PaymentMethod,
                      labelAr: 'نقداً (كاش)',
                      labelEn: 'Cash',
                      icon: <Banknote className="w-4 h-4" />,
                    },
                    {
                      id: 'bank_transfer' as PaymentMethod,
                      labelAr: 'تحويل بنكي',
                      labelEn: 'Bank Transfer',
                      icon: <Landmark className="w-4 h-4" />,
                    },
                    {
                      id: 'qr_nfc' as PaymentMethod,
                      labelAr: 'محفظة رقمية',
                      labelEn: 'Digital Wallet',
                      icon: <QrCode className="w-4 h-4" />,
                    },
                  ]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`debt-method-${m.id}`}
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setDebtPaymentMethod(m.id);
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      debtPaymentMethod === m.id
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                        : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    {m.icon}
                    <span>{isAr ? m.labelAr : m.labelEn}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AppInput
                  label={
                    isAr
                      ? 'رقم العملية / مرجع التحويل أو السداد'
                      : 'Operation / Transfer Reference Number'
                  }
                  data-testid="debt-transfer-ref-input"
                  value={debtTransferRef}
                  onChange={(e) => setDebtTransferRef(e.target.value)}
                  placeholder={isAr ? 'مثال: BNK-2026-9941' : 'e.g. BNK-2026-9941'}
                />

                <AppInput
                  label={
                    isAr
                      ? `سعر الصرف المحفوظ وقت البيع (1 ${activeSettlingData.view.referenceCurrency} = ج.س)`
                      : `Saved Sale Rate (1 ${activeSettlingData.view.referenceCurrency} = SDG)`
                  }
                  data-testid="debt-sale-rate-input"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={debtSaleRateInput}
                  onChange={(e) => setDebtSaleRateInput(normalizeNumberInput(e.target.value))}
                />

                <AppInput
                  label={isAr ? 'ملاحظة على الدفعة (اختياري)' : 'Installment Note (Optional)'}
                  value={debtSettlementNote}
                  onChange={(e) => setDebtSettlementNote(e.target.value)}
                  placeholder={
                    isAr ? 'مثال: الدفعة الثانية عبر بنكك' : 'e.g. Second installment via bank app'
                  }
                />
              </div>
            </div>

            {/* 4. Attach Multiple Receipt / Notification Images */}
            <div className="p-3.5 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4" />
                    <span>
                      {isAr
                        ? 'إرفاق صور إشعارات الدفع (يدعم إرفاق أكثر من صورة إشعار للدفعات المتعددة)'
                        : 'Attach Payment Notification Receipts (Multiple Images Supported)'}
                    </span>
                  </span>
                  <span className="text-[11px] text-neutral-400 block mt-0.5">
                    {isAr
                      ? 'يمكنك رفع صورة أو عدة صور إشعار في كل مرة يدفع فيها العميل دفعة من الدين'
                      : 'Upload one or more receipt photos each time the customer makes an installment payment'}
                  </span>
                </div>

                <div>
                  <input
                    ref={debtReceiptFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleDebtReceiptFilesUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    data-testid="debt-upload-receipts-btn"
                    onClick={() => debtReceiptFileInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isAr ? '+ رفع صورة / عدة صور إشعار' : '+ Upload Receipt Image(s)'}</span>
                  </button>
                </div>
              </div>

              {/* Direct Image URL Input for Receipt Notification */}
              <div className="flex gap-2">
                <input
                  type="text"
                  dir="ltr"
                  data-testid="debt-receipt-url-input"
                  value={debtReceiptUrlInput}
                  onChange={(e) => setDebtReceiptUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddDebtReceiptUrl();
                    }
                  }}
                  placeholder={
                    isAr
                      ? 'أو الصق رابط صورة إشعار الدفع واضغط إضافة (https://...)'
                      : 'Or paste receipt image URL and click Add (https://...)'
                  }
                  className="flex-1 min-h-[38px] px-3 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-mono text-neutral-200 placeholder:font-sans focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  data-testid="debt-add-receipt-url-btn"
                  onClick={handleAddDebtReceiptUrl}
                  className="px-3.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-amber-300 text-xs font-bold flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAr ? 'إضافة إشعار' : 'Add Receipt'}</span>
                </button>
              </div>

              {/* Newly Staged Receipt Images for This Installment */}
              {debtNewReceiptImages.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-amber-300 block">
                    {isAr ? (
                      <>
                        إشعارات الدفعة الجديدة المرفقة (<span className="font-mono">{debtNewReceiptImages.length}</span>):
                      </>
                    ) : (
                      <>
                        New Staged Receipt Images (<span className="font-mono">{debtNewReceiptImages.length}</span>):
                      </>
                    )}
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {debtNewReceiptImages.map((imgSrc, idx) => (
                      <div
                        key={`${idx}-${imgSrc.slice(0, 24)}`}
                        className="relative group h-20 rounded-xl overflow-hidden bg-neutral-900 border border-amber-500/50"
                      >
                        <img
                          src={imgSrc}
                          alt={`Receipt ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveStagedReceiptImage(idx)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                          title={isAr ? 'حذف الإشعار' : 'Remove receipt'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Previously Attached Receipt Images on This Transaction */}
              {getAllTransactionReceiptImages(activeSettlingData.tx).length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-neutral-800/80">
                  <span className="text-[11px] font-semibold text-neutral-400 block">
                    {isAr ? (
                      <>
                        صور الإشعارات المحفوظة مسبقاً لهذه الفاتورة (
                        <span className="font-mono">
                          {getAllTransactionReceiptImages(activeSettlingData.tx).length}
                        </span>
                        ):
                      </>
                    ) : (
                      <>
                        Previously Saved Receipt Images (
                        <span className="font-mono">
                          {getAllTransactionReceiptImages(activeSettlingData.tx).length}
                        </span>
                        ):
                      </>
                    )}
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {getAllTransactionReceiptImages(activeSettlingData.tx).map((imgSrc, idx) => (
                      <div
                        key={`prev-${idx}`}
                        className="relative h-16 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-700"
                      >
                        <img
                          src={imgSrc}
                          alt={`Saved Receipt ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-neutral-950/80 text-[9px] font-mono text-neutral-200">
                          #{idx + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 5. Previous Installments History Log */}
            {activeSettlingData.tx.debtPayments &&
              activeSettlingData.tx.debtPayments.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-2">
                  <span className="text-xs font-bold text-neutral-200 block">
                    {isAr ? (
                      <>
                        سجل دفعات السداد السابقة (<span className="font-mono">{activeSettlingData.tx.debtPayments.length}</span>)
                      </>
                    ) : (
                      <>
                        Previous Debt Installments (<span className="font-mono">{activeSettlingData.tx.debtPayments.length}</span>)
                      </>
                    )}
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {activeSettlingData.tx.debtPayments.map((inst, idx) => (
                      <div
                        key={inst.id}
                        className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono font-bold text-[10px]">
                            #{idx + 1}
                          </span>
                          <span className="font-mono text-[11px] text-neutral-400">
                            {new Date(inst.timestamp).toLocaleString()}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-200 text-[10px] font-semibold">
                            {formatPaymentMethodLabel(inst.paymentMethod, settings.language)}
                          </span>
                          {inst.transferReference && (
                            <span className="font-mono text-[10px] text-amber-300">
                              #{inst.transferReference}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-emerald-400 font-bold tabular-nums">
                            +{formatCurrency(inst.amountPaid, activeSettlingData.view.originalCurrency, settings.language)}
                          </span>
                          <span className="text-neutral-400 text-[11px]">
                            {isAr ? 'المتبقي بعدها:' : 'Remained:'}{' '}
                            <span className="text-rose-300 tabular-nums">
                              {formatCurrency(
                                inst.remainingDebtAfter,
                                activeSettlingData.view.originalCurrency,
                                settings.language
                              )}
                            </span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Submit & Cancel Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
              <TactileButton
                variant="ghost"
                type="button"
                onClick={() => setSettlingTxnId(null)}
              >
                {t.cancel}
              </TactileButton>
              <TactileButton
                variant="emerald"
                type="submit"
                data-testid="debt-submit-settlement-btn"
                leftIcon={<Check className="w-4 h-4" />}
              >
                {isAr ? 'حفظ الدفعة وتحديث الفاتورة' : 'Save Payment & Update Invoice'}
              </TactileButton>
            </div>
          </form>
        )}
      </AppModal>

      {/* Receipt Modal */}
      <ReceiptModal
        isOpen={Boolean(selectedReceiptTxn)}
        onClose={() => setSelectedReceiptTxn(null)}
        transaction={selectedReceiptTxn}
        valuationMode={valuationMode}
        anchorCurrency={anchorCurrency}
        onNewSale={() => {
          setSelectedReceiptTxn(null);
          setActiveTab('checkout');
        }}
      />

      {/* Multi-Image Transfer Notification Gallery Modal */}
      <AppModal
        isOpen={Boolean(previewNotificationTxn)}
        onClose={() => setPreviewNotificationTxn(null)}
        title={`${t.transferReceiptImage} • ${previewNotificationTxn?.id || ''}`}
        description={
          previewNotificationTxn?.transferReference
            ? `${t.transferReference}: ${previewNotificationTxn.transferReference}`
            : undefined
        }
        maxWidth="lg"
      >
        {previewNotificationTxn && (
          <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {getAllTransactionReceiptImages(previewNotificationTxn).map((imgUrl, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-950 flex flex-col"
                >
                  <div className="px-3 py-1.5 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between text-xs">
                    <span className="font-bold text-amber-300">
                      {isAr ? `صورة الإشعار #${idx + 1}` : `Receipt Image #${idx + 1}`}
                    </span>
                  </div>
                  <div className="p-2 flex items-center justify-center max-h-64">
                    <img
                      src={imgUrl}
                      alt={`${t.transferReceiptImage} #${idx + 1}`}
                      className="max-w-full max-h-60 object-contain rounded-lg"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2 border-t border-neutral-800">
              <TactileButton
                variant="secondary"
                size="sm"
                onClick={() => setPreviewNotificationTxn(null)}
              >
                {isAr ? 'إغلاق' : 'Close'}
              </TactileButton>
            </div>
          </div>
        )}
      </AppModal>
      {/* Goods Receipt / Supplier Purchase Invoice Modal */}
      <GoodsReceiptModal
        isOpen={isGoodsReceiptOpen}
        onClose={() => setIsGoodsReceiptOpen(false)}
      />
    </div>
  );
};


