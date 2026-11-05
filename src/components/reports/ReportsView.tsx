/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import {
  formatCurrency,
  computeStoreReportAnalytics,
  computeExchangeRateFluctuationSummary,
  PerformanceBadgeLevel,
} from '../../lib/pos-calculations';
import { SalesRateValuationMode } from '../../lib/types';
import { AppCard } from '../ui/AppCard';
import { TactileButton } from '../ui/TactileButton';
import { BusinessIntelligenceDashboard } from '../analytics/BusinessIntelligenceDashboard';
import {
  BarChart3,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingBag,
  CreditCard,
  Banknote,
  QrCode,
  Award,
  ShieldCheck,
  PackageCheck,
  AlertTriangle,
  Coins,
  ArrowRightLeft,
  Check,
  Activity,
  Layers,
  Sparkles,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const {
    transactions,
    products,
    stockMovements,
    settings,
    updateSettings,
    currencies,
    exchangeRates,
    exchangeRateHistory,
    updateExchangeRate,
  } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [reportViewMode, setReportViewMode] = useState<'bi_suite' | 'classic_reports'>('bi_suite');
  const [valuationMode, setValuationMode] = useState<SalesRateValuationMode>('indexed');
  const [anchorCurrency, setAnchorCurrency] = useState<string>('USD');
  const [selectedRateChartCurrency, setSelectedRateChartCurrency] = useState<string>('USD');
  const [rateInputDraft, setRateInputDraft] = useState<string>(() =>
    String(exchangeRates['USD'] || 2700)
  );
  const [rateFeedback, setRateFeedback] = useState<string | null>(null);

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

  useEffect(() => {
    if (exchangeRates[selectedRateChartCurrency]) {
      setRateInputDraft(String(exchangeRates[selectedRateChartCurrency]));
    }
  }, [selectedRateChartCurrency, exchangeRates]);

  // Compute full store report analytics converted into settings.currency
  const analytics = useMemo(() => {
    return computeStoreReportAnalytics(
      transactions,
      products,
      stockMovements,
      settings.currency,
      exchangeRates,
      valuationMode,
      anchorCurrency
    );
  }, [
    transactions,
    products,
    stockMovements,
    settings.currency,
    exchangeRates,
    valuationMode,
    anchorCurrency,
  ]);

  // Compute exchange rate fluctuation badges & history series
  const rateFluctuations = useMemo(() => {
    return computeExchangeRateFluctuationSummary(exchangeRates, exchangeRateHistory);
  }, [exchangeRates, exchangeRateHistory]);

  const activeFluctuationItem = useMemo(() => {
    return (
      rateFluctuations.find((f) => f.currency === selectedRateChartCurrency) ||
      rateFluctuations[0]
    );
  }, [rateFluctuations, selectedRateChartCurrency]);

  const handleQuickRateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(rateInputDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    await updateExchangeRate({
      sourceCurrency: selectedRateChartCurrency,
      targetCurrency: 'SDG',
      rate: parsed,
    });
    setRateFeedback(
      isAr
        ? `تم تحديث سعر ${selectedRateChartCurrency} إلى ${parsed} ج.س وتحديث جميع الشارتات`
        : `Updated ${selectedRateChartCurrency} to ${parsed} SDG & refreshed charts`
    );
    setTimeout(() => setRateFeedback(null), 3000);
  };

  // Helper to style performance badges
  const getBadgeStyle = (level: PerformanceBadgeLevel) => {
    if (level === 'excellent') {
      return {
        bg: 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300',
        bar: 'bg-emerald-500',
        label: isAr ? 'أداء ممتاز' : 'Excellent',
      };
    }
    if (level === 'good') {
      return {
        bg: 'bg-amber-950/70 border-amber-700/60 text-amber-300',
        bar: 'bg-amber-500',
        label: isAr ? 'أداء جيد' : 'Good',
      };
    }
    return {
      bg: 'bg-rose-950/70 border-rose-700/60 text-rose-300',
      bar: 'bg-rose-500',
      label: isAr ? 'يحتاج متابعة' : 'Needs Attention',
    };
  };

  // Export Sales to CSV
  const exportSalesCsv = () => {
    const headers = [
      'Transaction ID',
      'Date',
      'Customer',
      'Payment Method',
      'Fulfillment Status',
      'Items Count',
      `Grand Total (${settings.currency})`,
      'Status',
    ];
    const rows = transactions.map((tx) => [
      tx.id,
      new Date(tx.timestamp).toISOString(),
      `"${tx.customerName || 'Walk-in'}"`,
      tx.paymentMethod,
      tx.fulfillmentStatus || 'received',
      tx.items.reduce((acc, i) => acc + i.quantity, 0),
      tx.grandTotal.toFixed(2),
      tx.status,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `dqnamo_pos_sales_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Inventory to CSV
  const exportInventoryCsv = () => {
    const headers = [
      'SKU',
      'Name',
      'Category',
      'Barcode',
      'Cost Price',
      'Selling Price',
      'Stock Qty',
      'Asset Value',
    ];
    const rows = products.map((p) => [
      p.sku,
      `"${p.name}"`,
      `"${p.category}"`,
      p.barcode,
      p.costPrice.toFixed(2),
      p.sellingPrice.toFixed(2),
      p.stock,
      (p.costPrice * p.stock).toFixed(2),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `dqnamo_pos_inventory_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Store Financial Bar Chart Data
  const storeChartBars = useMemo(() => {
    const maxVal = Math.max(
      1,
      analytics.grossSales,
      analytics.collectedSales,
      analytics.netGrossProfit,
      analytics.estimatedCost,
      analytics.outstandingDebt
    );
    return [
      {
        id: 'gross',
        label: isAr ? 'إجمالي المبيعات' : 'Gross Sales',
        value: analytics.grossSales,
        pct: Math.round((analytics.grossSales / maxVal) * 100),
        color: 'bg-emerald-500',
        textColor: 'text-emerald-400',
      },
      {
        id: 'collected',
        label: isAr ? 'المبالغ المحصلة' : 'Collected Revenue',
        value: analytics.collectedSales,
        pct: Math.round((analytics.collectedSales / maxVal) * 100),
        color: 'bg-amber-500',
        textColor: 'text-amber-400',
      },
      {
        id: 'profit',
        label: isAr ? 'صافي الربح التقديري' : 'Net Gross Profit',
        value: analytics.netGrossProfit,
        pct: Math.round((analytics.netGrossProfit / maxVal) * 100),
        color: 'bg-cyan-500',
        textColor: 'text-cyan-400',
      },
      {
        id: 'cogs',
        label: isAr ? 'تكلفة البضاعة' : 'Cost of Goods (COGS)',
        value: analytics.estimatedCost,
        pct: Math.round((analytics.estimatedCost / maxVal) * 100),
        color: 'bg-purple-500',
        textColor: 'text-purple-400',
      },
      {
        id: 'debt',
        label: isAr ? 'الديون المتبقية' : 'Outstanding Debt',
        value: analytics.outstandingDebt,
        pct: Math.round((analytics.outstandingDebt / maxVal) * 100),
        color: 'bg-rose-500',
        textColor: 'text-rose-400',
      },
    ];
  }, [analytics, isAr]);

  const maxProductUnits = useMemo(() => {
    return Math.max(1, ...analytics.productReports.map((p) => p.unitsSold));
  }, [analytics.productReports]);

  return (
    <div className="flex-1 max-w-[1600px] mx-auto w-full p-3 sm:p-4 md:p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {t.analyticsAndReports}
          </h2>
          <span className="text-xs text-neutral-400">
            {isAr
              ? 'شارات أداء المتجر، شارت مبيعات كل منتج حسب العملة، ومؤشرات تغير أسعار الصرف'
              : 'Store performance badges, per-product multi-currency sales charts & exchange rate fluctuation indicators'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl p-1 bg-neutral-900 border border-neutral-800">
            <button
              type="button"
              onClick={() => setReportViewMode('bi_suite')}
              data-testid="reports-mode-bi-suite"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                reportViewMode === 'bi_suite'
                  ? 'bg-amber-500 text-neutral-950 shadow-sm'
                  : 'text-neutral-300 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isAr
                ? 'ذكاء الأعمال والتنبؤ الإحصائي (BI Suite)'
                : 'BI & Predictive Analytics Suite'}
            </button>
            <button
              type="button"
              onClick={() => setReportViewMode('classic_reports')}
              data-testid="reports-mode-classic"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                reportViewMode === 'classic_reports'
                  ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                  : 'text-neutral-300 hover:text-white'
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              {isAr
                ? 'تقارير العملات وأسعار الصرف'
                : 'Multi-Currency & FX Reports'}
            </button>
          </div>

          <TactileButton
            variant="secondary"
            size="sm"
            onClick={exportSalesCsv}
            leftIcon={<Download className="w-3.5 h-3.5" />}
          >
            {t.exportCsv}
          </TactileButton>

          <TactileButton
            variant="secondary"
            size="sm"
            onClick={exportInventoryCsv}
            leftIcon={<Download className="w-3.5 h-3.5" />}
          >
            {t.exportInventoryCsv}
          </TactileButton>
        </div>
      </div>

      {reportViewMode === 'bi_suite' ? (
        <BusinessIntelligenceDashboard />
      ) : (
        <>
      {/* Multi-Currency & Live Exchange Rate Control Bar for Reports */}
      <AppCard className="p-4 border-amber-500/30 bg-neutral-900/95">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Currency Switcher */}
          <div className="lg:col-span-5 space-y-1.5">
            <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {isAr ? 'عملة عرض التقارير والشارتات' : 'Reports Display Currency'}
              </span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {activeCurrencyCodes.map((code) => {
                const isSelected = settings.currency.toUpperCase() === code;
                return (
                  <button
                    key={code}
                    type="button"
                    data-testid={`reports-currency-btn-${code}`}
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

          {/* Valuation Mode Switcher */}
          <div className="lg:col-span-3 space-y-1.5">
            <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isAr ? 'تقييم الفواتير' : 'Rate Valuation'}</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
              <button
                type="button"
                onClick={() => setValuationMode('indexed')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  valuationMode === 'indexed'
                    ? 'bg-amber-500 text-neutral-950'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {isAr ? 'مربوط بالسعر الجديد' : 'Linked Rate'}
              </button>
              <button
                type="button"
                onClick={() => setValuationMode('live')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  valuationMode === 'live'
                    ? 'bg-emerald-500 text-neutral-950'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {isAr ? 'تحويل مباشر' : 'Live Direct'}
              </button>
            </div>
          </div>

          {/* Quick Exchange Rate Simulator / Updater */}
          <div className="lg:col-span-4 space-y-1.5">
            <label className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {isAr ? 'تحديث سعر الصرف ومشاهدة الأثر فوراً' : 'Update Rate & Preview Impact'}
              </span>
            </label>
            <form onSubmit={handleQuickRateSubmit} className="flex items-center gap-1.5">
              <div className="flex items-center bg-neutral-950 border border-neutral-800 rounded-xl px-2 py-1 text-xs font-mono text-neutral-300 shrink-0">
                <span>1</span>
                <select
                  aria-label="Select currency for rate update"
                  value={selectedRateChartCurrency}
                  onChange={(e) => {
                    const code = e.target.value;
                    setSelectedRateChartCurrency(code);
                    setAnchorCurrency(code);
                    setRateInputDraft(String(exchangeRates[code] || 1));
                  }}
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
                data-testid="reports-quick-rate-input"
                value={rateInputDraft}
                onChange={(e) => setRateInputDraft(e.target.value)}
                className="w-24 px-2.5 py-1.5 rounded-xl bg-neutral-950 border border-neutral-700 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
              />
              <span className="text-[11px] font-mono text-neutral-400">SDG</span>
              <TactileButton
                type="submit"
                variant="emerald"
                size="sm"
                data-testid="reports-quick-rate-submit"
                className="px-2.5 py-1.5 text-xs shrink-0"
              >
                {isAr ? 'تحديث' : 'Apply'}
              </TactileButton>
            </form>
            {rateFeedback && (
              <p className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>{rateFeedback}</span>
              </p>
            )}
          </div>
        </div>
      </AppCard>

      {/* Top Level Metric Cards in Active Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <AppCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-400">
              {t.grossSales} ({settings.currency})
            </span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div
            data-testid="reports-gross-sales"
            className="text-2xl font-bold font-mono text-emerald-400 tabular-nums"
          >
            {formatCurrency(analytics.grossSales, settings.currency, settings.language)}
          </div>
          <span className="text-[11px] text-neutral-500">
            {isAr ? (
              <>
                عبر <span className="font-mono tabular-nums">{analytics.totalOrders}</span> فاتورة
                مكتملة
              </>
            ) : (
              <>
                Across <span className="font-mono tabular-nums">{analytics.totalOrders}</span>{' '}
                completed transactions
              </>
            )}
          </span>
        </AppCard>

        <AppCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-400">
              {t.netProfit} ({settings.currency})
            </span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div
            data-testid="reports-net-profit"
            className="text-2xl font-bold font-mono text-amber-400 tabular-nums"
          >
            {formatCurrency(analytics.netGrossProfit, settings.currency, settings.language)}
          </div>
          <span className="text-[11px] text-neutral-500">
            {isAr ? 'الإيراد بعد خصم تكلفة البضاعة والضريبة' : 'Gross revenue minus COGS & VAT'}
          </span>
        </AppCard>

        <AppCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-400">
              {t.averageOrderValue} ({settings.currency})
            </span>
            <ShoppingBag className="w-4 h-4 text-blue-400" />
          </div>
          <div
            data-testid="reports-avg-order"
            className="text-2xl font-bold font-mono text-white tabular-nums"
          >
            {formatCurrency(analytics.avgOrderValue, settings.currency, settings.language)}
          </div>
          <span className="text-[11px] text-neutral-500">
            {isAr ? 'متوسط قيمة سلة الشراء للعميل' : 'Per customer checkout ticket'}
          </span>
        </AppCard>
      </div>

      {/* SECTION 1: Store Performance Badges (شارات معرفة أداء المتجر في التقارير) */}
      <AppCard data-testid="store-performance-badges-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">{t.storePerformanceBadges}</h3>
          </div>
          <span className="text-[11px] text-neutral-400">
            {isAr
              ? 'مؤشرات وشارات حيوية لقياس ربحية المتجر، التحصيل، استلام البضاعة، وجاهزية المخزون'
              : 'Live operational health badges measuring profitability, debt collection, fulfillment & stock'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {/* Badge 1: Profit Margin Health */}
          {(() => {
            const st = getBadgeStyle(analytics.performanceBadges.profit.level);
            return (
              <div
                data-testid="perf-badge-profit"
                className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">
                    {isAr ? 'شارة هامش الربح' : 'Profit Margin Badge'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${st.bg}`}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold font-mono text-emerald-400 tabular-nums">
                    {analytics.profitMarginPercent}%
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {isAr ? 'صافي:' : 'Net:'}{' '}
                    <span className="font-mono font-semibold text-neutral-200 tabular-nums">
                      {formatCurrency(
                        analytics.netGrossProfit,
                        settings.currency,
                        settings.language
                      )}
                    </span>
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${st.bar}`}
                    style={{ width: `${Math.min(100, Math.max(6, analytics.profitMarginPercent))}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Badge 2: Cash/Bank Collection vs Debt */}
          {(() => {
            const st = getBadgeStyle(analytics.performanceBadges.collection.level);
            return (
              <div
                data-testid="perf-badge-collection"
                className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">
                    {isAr ? 'شارة كفاءة التحصيل' : 'Collection Rate Badge'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${st.bg}`}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold font-mono text-amber-400 tabular-nums">
                    {analytics.collectionRatePercent}%
                  </span>
                  <span className="text-[11px] text-rose-400">
                    {isAr ? 'الديون:' : 'Debt:'}{' '}
                    <span className="font-mono font-semibold tabular-nums">
                      {formatCurrency(
                        analytics.outstandingDebt,
                        settings.currency,
                        settings.language
                      )}
                    </span>
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${st.bar}`}
                    style={{
                      width: `${Math.min(100, Math.max(6, analytics.collectionRatePercent))}%`,
                    }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Badge 3: Invoice & Goods Receipt Fulfillment */}
          {(() => {
            const st = getBadgeStyle(analytics.performanceBadges.fulfillment.level);
            return (
              <div
                data-testid="perf-badge-fulfillment"
                className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">
                    {isAr ? 'شارة استلام البضاعة والفواتير' : 'Goods & Invoice Receipt'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${st.bg}`}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold font-mono text-cyan-400 tabular-nums">
                    {analytics.fulfillmentStats.fulfillmentRatePercent}%
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {isAr ? 'مستلم:' : 'Received:'}{' '}
                    <span className="font-mono font-bold text-emerald-400 tabular-nums">
                      {analytics.fulfillmentStats.receivedCount}
                    </span>{' '}
                    / {isAr ? 'معلق:' : 'Pending:'}{' '}
                    <span className="font-mono font-bold text-amber-400 tabular-nums">
                      {analytics.fulfillmentStats.totalPendingCount}
                    </span>
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${st.bar}`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(6, analytics.fulfillmentStats.fulfillmentRatePercent)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Badge 4: Inventory Stock Readiness */}
          {(() => {
            const st = getBadgeStyle(analytics.performanceBadges.inventory.level);
            return (
              <div
                data-testid="perf-badge-inventory"
                className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">
                    {isAr ? 'شارة جاهزية المخزون' : 'Inventory Readiness'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${st.bg}`}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold font-mono text-purple-400 tabular-nums">
                    {analytics.inventoryHealth.readinessPercent}%
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {isAr ? 'توريدات مستلمة:' : 'Restock batches:'}{' '}
                    <span className="font-mono font-bold text-emerald-400 tabular-nums">
                      {analytics.fulfillmentStats.supplierGoodsReceiptsCount}
                    </span>
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${st.bar}`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(6, analytics.inventoryHealth.readinessPercent)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </AppCard>

      {/* SECTION 2: Store Financial Performance Visual Chart & Payment Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Store Financial Performance Bar Chart */}
        <AppCard className="lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">
                  {t.storePerformanceChart} ({settings.currency})
                </h3>
              </div>
              <span className="text-[11px] text-neutral-400">
                {isAr ? 'مقارنة المبيعات، الأرباح، التكلفة والديون' : 'Revenue, Profit, COGS & Debt'}
              </span>
            </div>

            <div className="space-y-3.5 mt-4">
              {storeChartBars.map((bar) => (
                <div key={bar.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-200">{bar.label}</span>
                    <span className={`font-mono font-bold tabular-nums ${bar.textColor}`}>
                      {formatCurrency(bar.value, settings.currency, settings.language)}
                    </span>
                  </div>
                  <div className="w-full h-3 rounded-lg bg-neutral-950 border border-neutral-800/80 overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-md transition-all duration-300 ${bar.color}`}
                      style={{ width: `${Math.max(bar.value > 0 ? 4 : 0, bar.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
            <span>
              {isAr ? 'إجمالي الضريبة المحصلة:' : 'Total Tax Collected:'}{' '}
              <span className="font-mono font-bold text-white tabular-nums">
                {formatCurrency(analytics.totalTaxCollected, settings.currency, settings.language)}
              </span>
            </span>
            <span>
              {isAr ? 'إجمالي الخصومات الممنوحة:' : 'Total Discounts Given:'}{' '}
              <span className="font-mono font-bold text-amber-400 tabular-nums">
                {formatCurrency(
                  analytics.totalDiscountsGiven,
                  settings.currency,
                  settings.language
                )}
              </span>
            </span>
          </div>
        </AppCard>

        {/* Payment Method Breakdown with Visual Share Bars */}
        <AppCard className="lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-500" />
                <h3 className="font-bold text-sm text-white">{t.salesByMethod}</h3>
              </div>
              <span className="text-[11px] font-mono text-neutral-400">{settings.currency}</span>
            </div>

            <div className="space-y-3 mt-4">
              {/* Bank Transfer */}
              <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-4 h-4 text-amber-400" />
                    <div>
                      <span className="text-xs font-bold text-white block">{t.bankTransfer}</span>
                      <span className="text-[10px] text-neutral-500">
                        <span className="font-mono tabular-nums">
                          {analytics.paymentCounts.bank_transfer.count}
                        </span>{' '}
                        {isAr ? 'عمليات' : 'orders'} (
                        <span className="font-mono tabular-nums">
                          {analytics.paymentCounts.bank_transfer.sharePercent}%
                        </span>
                        )
                      </span>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-sm text-amber-400 tabular-nums">
                    {formatCurrency(
                      analytics.paymentCounts.bank_transfer.total,
                      settings.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full"
                    style={{
                      width: `${Math.max(
                        analytics.paymentCounts.bank_transfer.total > 0 ? 5 : 0,
                        analytics.paymentCounts.bank_transfer.sharePercent
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Cash */}
              <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Banknote className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="text-xs font-bold text-white block">{t.cash}</span>
                      <span className="text-[10px] text-neutral-500">
                        <span className="font-mono tabular-nums">
                          {analytics.paymentCounts.cash.count}
                        </span>{' '}
                        {isAr ? 'عمليات' : 'orders'} (
                        <span className="font-mono tabular-nums">
                          {analytics.paymentCounts.cash.sharePercent}%
                        </span>
                        )
                      </span>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-sm text-emerald-400 tabular-nums">
                    {formatCurrency(
                      analytics.paymentCounts.cash.total,
                      settings.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${Math.max(
                        analytics.paymentCounts.cash.total > 0 ? 5 : 0,
                        analytics.paymentCounts.cash.sharePercent
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Digital Wallet QR/NFC */}
              <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <QrCode className="w-4 h-4 text-blue-400" />
                    <div>
                      <span className="text-xs font-bold text-white block">{t.qrNfc}</span>
                      <span className="text-[10px] text-neutral-500">
                        <span className="font-mono tabular-nums">
                          {analytics.paymentCounts.qr_nfc.count}
                        </span>{' '}
                        {isAr ? 'عمليات' : 'orders'} (
                        <span className="font-mono tabular-nums">
                          {analytics.paymentCounts.qr_nfc.sharePercent}%
                        </span>
                        )
                      </span>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-sm text-blue-400 tabular-nums">
                    {formatCurrency(
                      analytics.paymentCounts.qr_nfc.total,
                      settings.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-neutral-900 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{
                      width: `${Math.max(
                        analytics.paymentCounts.qr_nfc.total > 0 ? 5 : 0,
                        analytics.paymentCounts.qr_nfc.sharePercent
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </AppCard>
      </div>

      {/* SECTION 3: Exchange Rate Fluctuation Badges & Interactive Chart (شارات وشارت تغير أسعار الصرف) */}
      <AppCard data-testid="exchange-rate-fluctuation-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">{t.exchangeRateFluctuationBadges}</h3>
          </div>
          <span className="text-[11px] text-neutral-400">
            {isAr
              ? 'اضغط على أي عملة لعرض شارت مسار تغير سعر الصرف مقابل الجنيه السوداني (SDG)'
              : 'Click any currency badge to inspect its exchange rate trajectory vs SDG'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4 items-stretch">
          {/* Rate Fluctuation Badges Grid */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rateFluctuations.map((item) => {
              const isSelected = selectedRateChartCurrency === item.currency;
              const isUp = item.direction === 'up';
              const isDown = item.direction === 'down';

              return (
                <button
                  key={item.currency}
                  type="button"
                  data-testid={`rate-fluctuation-badge-${item.currency}`}
                  onClick={() => {
                    setSelectedRateChartCurrency(item.currency);
                    setRateInputDraft(String(item.currentRate));
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2.5 ${
                    isSelected
                      ? 'bg-neutral-900 border-amber-500 shadow-sm'
                      : 'bg-neutral-950/80 border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono font-extrabold text-xs">
                        {item.currency} / SDG
                      </span>
                    </div>

                    {/* Fluctuation Badge */}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                        isUp
                          ? 'bg-amber-950/80 border-amber-700/60 text-amber-300'
                          : isDown
                          ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                          : 'bg-neutral-900 border-neutral-700 text-neutral-300'
                      }`}
                    >
                      {isUp ? (
                        <TrendingUp className="w-3 h-3 text-amber-400" />
                      ) : isDown ? (
                        <TrendingDown className="w-3 h-3 text-emerald-400" />
                      ) : null}
                      <span className="font-mono tabular-nums">
                        {item.changePercent > 0 ? `+${item.changePercent}%` : `${item.changePercent}%`}
                      </span>
                      <span>
                        {isUp
                          ? isAr
                            ? 'ارتفاع'
                            : 'Surge'
                          : isDown
                          ? isAr
                            ? 'انخفاض'
                            : 'Drop'
                          : isAr
                          ? 'مستقر'
                          : 'Stable'}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between w-full">
                    <div>
                      <span className="text-[10px] text-neutral-400 block">
                        {isAr ? 'السعر الحالي' : 'Current Rate'}
                      </span>
                      <span className="text-lg font-extrabold font-mono text-white tabular-nums">
                        {item.currentRate.toLocaleString()}
                      </span>{' '}
                      <span className="text-[10px] font-mono text-neutral-400">SDG</span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-neutral-500 block">
                        {isAr ? 'السعر السابق' : 'Previous'}
                      </span>
                      <span dir="ltr" className="text-xs font-mono text-neutral-300 tabular-nums inline-block">
                        {item.previousRate.toLocaleString()} SDG
                      </span>
                    </div>
                  </div>

                  {/* Mini Bar Sparkline */}
                  <div className="flex items-end gap-1 h-7 pt-1 w-full">
                    {item.historyPoints.map((pt, idx) => {
                      const minP = Math.min(...item.historyPoints) * 0.92;
                      const maxP = Math.max(...item.historyPoints, 1);
                      const heightPct = Math.max(
                        20,
                        Math.min(100, Math.round(((pt - minP) / Math.max(1, maxP - minP)) * 100))
                      );
                      const isLast = idx === item.historyPoints.length - 1;
                      return (
                        <div
                          key={idx}
                          className="flex-1 flex flex-col items-center justify-end h-full"
                        >
                          <div
                            className={`w-full rounded-t transition-all ${
                              isLast
                                ? 'bg-amber-400'
                                : 'bg-neutral-700'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Interactive SVG Exchange Rate Trajectory Chart for Selected Currency */}
          {activeFluctuationItem && (
            <div className="lg:col-span-5 p-4 rounded-2xl bg-neutral-950 border border-neutral-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-white block">
                      {isAr
                        ? `شارت مسار سعر صرف (${activeFluctuationItem.currency})`
                        : `${activeFluctuationItem.currency} Exchange Rate Trend Chart`}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      {isAr ? 'مقابل الجنيه السوداني (SDG)' : 'Against Sudanese Pound (SDG)'}
                    </span>
                  </div>
                  <span dir="ltr" className="text-sm font-mono font-extrabold text-amber-400 tabular-nums inline-block">
                    1 {activeFluctuationItem.currency} ={' '}
                    {activeFluctuationItem.currentRate.toLocaleString()} SDG
                  </span>
                </div>

                {/* SVG Line & Area Chart */}
                {(() => {
                  const pts = activeFluctuationItem.historyPoints;
                  const minVal = Math.min(...pts) * 0.95;
                  const maxVal = Math.max(...pts) * 1.03;
                  const range = Math.max(1, maxVal - minVal);
                  const width = 320;
                  const height = 130;
                  const padX = 24;
                  const padY = 20;

                  const coords = pts.map((val, idx) => {
                    const x =
                      padX +
                      (idx / Math.max(1, pts.length - 1)) * (width - padX * 2);
                    const y =
                      height -
                      padY -
                      ((val - minVal) / range) * (height - padY * 2);
                    return { x, y, val };
                  });

                  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
                  const areaPoints = `${coords[0].x},${height - padY} ${polylinePoints} ${
                    coords[coords.length - 1].x
                  },${height - padY}`;

                  return (
                    <div className="w-full overflow-hidden my-2">
                      <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className="w-full h-36 overflow-visible"
                        role="img"
                        aria-label={`${activeFluctuationItem.currency} exchange rate chart`}
                      >
                        <defs>
                          <linearGradient id="rateAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        {/* Grid lines */}
                        <line
                          x1={padX}
                          y1={padY}
                          x2={width - padX}
                          y2={padY}
                          stroke="#262626"
                          strokeDasharray="3 3"
                        />
                        <line
                          x1={padX}
                          y1={height / 2}
                          x2={width - padX}
                          y2={height / 2}
                          stroke="#262626"
                          strokeDasharray="3 3"
                        />
                        <line
                          x1={padX}
                          y1={height - padY}
                          x2={width - padX}
                          y2={height - padY}
                          stroke="#262626"
                        />

                        {/* Shaded Area */}
                        <polygon points={areaPoints} fill="url(#rateAreaGrad)" />

                        {/* Trend Line */}
                        <polyline
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={polylinePoints}
                        />

                        {/* Data Points & Labels */}
                        {coords.map((c, idx) => (
                          <g key={idx}>
                            <circle
                              cx={c.x}
                              cy={c.y}
                              r={idx === coords.length - 1 ? 5 : 3.5}
                              fill={idx === coords.length - 1 ? '#10b981' : '#f59e0b'}
                              stroke="#0a0a0a"
                              strokeWidth="1.5"
                            />
                            <text
                              x={c.x}
                              y={c.y - 8}
                              textAnchor="middle"
                              fill={idx === coords.length - 1 ? '#34d399' : '#d4d4d8'}
                              fontSize="9"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {c.val}
                            </text>
                          </g>
                        ))}
                      </svg>
                    </div>
                  );
                })()}
              </div>

              <div className="pt-2 border-t border-neutral-800 flex items-center justify-between text-xs">
                <span className="text-neutral-400">
                  {isAr ? 'مقدار التغير عن السعر المرجعي:' : 'Delta vs Previous Rate:'}
                </span>
                <span
                  dir="ltr"
                  className={`font-mono font-bold tabular-nums inline-block ${
                    activeFluctuationItem.delta > 0
                      ? 'text-amber-400'
                      : activeFluctuationItem.delta < 0
                      ? 'text-emerald-400'
                      : 'text-neutral-300'
                  }`}
                >
                  {activeFluctuationItem.delta > 0 ? '+' : ''}
                  {activeFluctuationItem.delta.toLocaleString()} SDG (
                  {activeFluctuationItem.changePercent > 0 ? '+' : ''}
                  {activeFluctuationItem.changePercent}%)
                </span>
              </div>
            </div>
          )}
        </div>
      </AppCard>

      {/* SECTION 4: Per-Product Sales & Currency Price Change Chart (شارت لكل منتج لمعرفة بيعه وتغير سعر العملة) */}
      <AppCard data-testid="per-product-sales-currency-charts">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm text-white">
              {t.productSalesAndCurrencyChart}
            </h3>
          </div>
          <span className="text-[11px] text-neutral-400">
            {isAr
              ? 'يعرض لكل منتج حجم مبيعاته، حصته من الإيراد، وتغير سعره وإيراده عبر العملات'
              : 'Displays each product sales volume, revenue share, and unit price across currencies & exchange rates'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {analytics.productReports.map((prod) => {
            const unitsBarPct = Math.round((prod.unitsSold / maxProductUnits) * 100);
            const maxPriceCompare = Math.max(
              1,
              prod.historicalUnitPriceInSdg,
              prod.currentUnitPriceInSdg
            );
            const histBarPct = Math.round(
              (prod.historicalUnitPriceInSdg / maxPriceCompare) * 100
            );
            const currBarPct = Math.round(
              (prod.currentUnitPriceInSdg / maxPriceCompare) * 100
            );

            return (
              <div
                key={prod.productId}
                data-testid={`product-report-card-${prod.productId}`}
                className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 flex flex-col justify-between gap-3.5"
              >
                {/* Product Header & Sales Summary */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl p-2 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0">
                      {prod.emoji || '📦'}
                    </span>
                    <div>
                      <div className="font-bold text-sm text-white">
                        {isAr && prod.nameAr ? prod.nameAr : prod.name}
                      </div>
                      <div className="text-[11px] text-neutral-400 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono">{prod.sku}</span>
                        <span>·</span>
                        <span>
                          {isAr ? 'المخزون:' : 'Stock:'}{' '}
                          <span className="font-mono font-bold text-neutral-200 tabular-nums">
                            {prod.stock}
                          </span>
                        </span>
                        <span>·</span>
                        <span className="text-emerald-400">
                          {isAr ? 'هامش الربح:' : 'Margin:'}{' '}
                          <span className="font-mono font-bold tabular-nums">
                            {prod.marginPercent}%
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-base font-extrabold font-mono text-emerald-400 tabular-nums block">
                      {formatCurrency(prod.revenue, settings.currency, settings.language)}
                    </span>
                    <span className="text-[11px] text-amber-300 font-semibold">
                      <span className="font-mono font-bold tabular-nums">{prod.unitsSold}</span>{' '}
                      {isAr ? 'وحدة مباعة' : 'units sold'} (
                      <span className="font-mono tabular-nums">{prod.revenueSharePercent}%</span>)
                    </span>
                  </div>
                </div>

                {/* 1. Sales Volume Visual Chart Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-400">
                      {isAr ? 'مؤشر أداء مبيعات المنتج' : 'Product Sales Volume Indicator'}
                    </span>
                    <span className="text-neutral-300">
                      {isAr ? 'صافي الربح:' : 'Net Profit:'}{' '}
                      <span className="font-mono font-bold text-emerald-400 tabular-nums">
                        {formatCurrency(prod.netProfit, settings.currency, settings.language)}
                      </span>
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-neutral-900 overflow-hidden p-0.5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all"
                      style={{ width: `${Math.max(prod.unitsSold > 0 ? 8 : 2, unitsBarPct)}%` }}
                    />
                  </div>
                </div>

                {/* 2. Exchange Rate Price Shift Chart (تغير سعر المنتج مع تغير سعر الصرف) */}
                <div className="p-2.5 rounded-xl bg-neutral-900/90 border border-neutral-800/90 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-neutral-300">
                      {isAr
                        ? 'شارت تغير سعر بيع الوحدة حسب سعر الصرف'
                        : 'Unit Price Shift by Exchange Rate'}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        prod.priceChangePercentInSdg > 0
                          ? 'bg-amber-950/80 border-amber-700/60 text-amber-300'
                          : prod.priceChangePercentInSdg < 0
                          ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                      }`}
                    >
                      <span dir="ltr" className="font-mono tabular-nums inline-block">
                        {prod.priceChangePercentInSdg > 0
                          ? `+${prod.priceChangePercentInSdg}%`
                          : `${prod.priceChangePercentInSdg}%`}
                      </span>{' '}
                      {isAr ? 'فرق السعر' : 'Rate Shift'}
                    </span>
                  </div>

                  {/* Dual Comparison Bars: Old Rate vs Current Rate */}
                  <div className="space-y-1.5 text-[10px]">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-neutral-400">
                        <span>{isAr ? 'السعر بالسعر السابق:' : 'At Historical Rate:'}</span>
                        <span className="font-mono font-semibold text-neutral-300 tabular-nums">
                          {formatCurrency(prod.historicalUnitPriceInSdg, 'SDG', settings.language)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-neutral-950 overflow-hidden">
                        <div
                          className="h-full bg-neutral-600 rounded-full"
                          style={{ width: `${Math.max(10, histBarPct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex justify-between text-amber-300">
                        <span>{isAr ? 'السعر بالسعر الجديد:' : 'At Current Live Rate:'}</span>
                        <span className="font-mono font-bold text-amber-400 tabular-nums">
                          {formatCurrency(prod.currentUnitPriceInSdg, 'SDG', settings.language)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-neutral-950 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full"
                          style={{ width: `${Math.max(10, currBarPct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Multi-Currency Unit Price Strip (SDG / USD / SAR / AED) */}
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {(['SDG', 'USD', 'SAR', 'AED'] as const).map((code) => (
                    <div
                      key={code}
                      className={`p-1.5 rounded-lg border text-center ${
                        settings.currency.toUpperCase() === code
                          ? 'bg-amber-500/10 border-amber-500/50'
                          : 'bg-neutral-900/60 border-neutral-800/80'
                      }`}
                    >
                      <span className="text-[9px] font-mono font-bold text-neutral-400 block">
                        {code}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-white tabular-nums block truncate">
                        {prod.pricesByCurrency[code]?.toLocaleString('en-US', {
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </AppCard>
        </>
      )}
    </div>
  );
};
