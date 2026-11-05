/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  CandlestickChart,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Filter,
  Flame,
  Info,
  Layers,
  LineChart,
  Package,
  PackageX,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { formatCurrency } from '../../lib/pos-calculations';
import { PaymentMethod, SalesRateValuationMode } from '../../lib/types';
import {
  ABCClassificationBasis,
  AnalyticsDatePreset,
  AnalyticsFilterParams,
  SmartAlertLifecycleStatus,
  SmartInsightCategory,
  SUPPORTED_SMART_INSIGHT_CATEGORIES,
} from '../../analytics/analytics.types';
import {
  buildAnalyticsSnapshotFromState,
  DEFAULT_ANALYTICS_BRANCHES,
} from '../../analytics/analytics.snapshot';
import { computeFullAnalyticsOverview } from '../../analytics/analytics.service';
import { AppCard } from '../ui/AppCard';
import {
  AbcParetoChart,
  IntradayCandlestickChart,
  StatisticalForecastFanChart,
  TechnicalTrendOverlayChart,
} from './AnalyticsCharts';
import { IntelligenceCenterView } from '../intelligence/IntelligenceCenterView';
import { IntelligenceLifecycleSummaryCounts } from '../../analytics/analytics.types';

type BiSubTab =
  | 'overview'
  | 'intelligence_center'
  | 'unmet_demand'
  | 'smart_intelligence'
  | 'sales'
  | 'financial'
  | 'inventory'
  | 'products'
  | 'customers'
  | 'branches'
  | 'technical'
  | 'forecasts'
  | 'insights';

export function BusinessIntelligenceDashboard() {
  const {
    products,
    transactions,
    customers,
    stockMovements,
    users,
    currentUser,
    settings,
    exchangeRateHistory,
    unmetDemandRequests,
    openUnmetDemandModal,
  } = usePOS();

  const isAr = settings.language === 'ar';
  const isDark = settings.theme === 'dark';

  const [activeTab, setActiveTab] = useState<BiSubTab>('overview');
  const [datePreset, setDatePreset] = useState<AnalyticsDatePreset>('30d');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [productIdFilter, setProductIdFilter] = useState<string>('all');
  const [customerIdFilter, setCustomerIdFilter] = useState<string>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentMethod | 'all'>('all');
  const [valuationMode, setValuationMode] = useState<SalesRateValuationMode>('historical');
  const [abcBasis, setAbcBasis] = useState<ABCClassificationBasis>('revenue');
  const [leadTimeDays, setLeadTimeDays] = useState<number>(3);
  const [safetyStockDays, setSafetyStockDays] = useState<number>(2);
  const [forecastHorizonDays, setForecastHorizonDays] = useState<7 | 30 | 90>(7);
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);

  // Phase 10 UI Controls
  const [demandTrendGranularity, setDemandTrendGranularity] = useState<
    'daily' | 'weekly' | 'monthly'
  >('daily');
  const [alertCategoryFilter, setAlertCategoryFilter] = useState<
    SmartInsightCategory | 'ALL'
  >('ALL');
  const [alertLifecycleOverrides, setAlertLifecycleOverrides] = useState<
    Record<string, SmartAlertLifecycleStatus>
  >({});
  const [persistedLifecycleCounts, setPersistedLifecycleCounts] =
    useState<IntelligenceLifecycleSummaryCounts | null>(null);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [overviewRecommendationFilter, setOverviewRecommendationFilter] = useState<
    'all' | 'smart_alerts' | 'replenishment' | 'transfers' | 'executive'
  >('all');

  const activeUserId = currentUser?.id || users[0]?.id || 'user-1';

  const syncPersistedLifecycleFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/intelligence/lifecycle?status=ALL_HISTORY&pageSize=100', {
        headers: { 'x-user-id': activeUserId },
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data) {
        if (json.data.counts) {
          setPersistedLifecycleCounts(json.data.counts);
        }
        if (Array.isArray(json.data.items)) {
          const map: Record<string, SmartAlertLifecycleStatus> = {};
          for (const item of json.data.items) {
            const mapped: SmartAlertLifecycleStatus =
              item.status === 'ACKNOWLEDGED'
                ? 'acknowledged'
                : item.status === 'RESOLVED'
                ? 'resolved'
                : item.status === 'DISMISSED'
                ? 'dismissed'
                : 'active';
            map[item.dedupeKey] = mapped;
            map[item.id] = mapped;
          }
          setAlertLifecycleOverrides(map);
        }
      }
    } catch {
      // Ignore offline fallback
    }
  }, [activeUserId]);

  useEffect(() => {
    syncPersistedLifecycleFromServer();
  }, [syncPersistedLifecycleFromServer]);

  const handlePersistAlertStatusChange = async (
    alertId: string,
    dedupeKey: string,
    nextStatus: SmartAlertLifecycleStatus
  ) => {
    setAlertLifecycleOverrides((prev) => ({
      ...prev,
      [alertId]: nextStatus,
      [dedupeKey]: nextStatus,
    }));

    const endpointMap: Record<SmartAlertLifecycleStatus, string> = {
      active: 'reopen',
      acknowledged: 'acknowledge',
      resolved: 'resolve',
      dismissed: 'dismiss',
    };
    const endpoint = endpointMap[nextStatus];
    try {
      await fetch(
        `/api/intelligence/lifecycle/${encodeURIComponent(dedupeKey || alertId)}/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': activeUserId,
          },
          body: JSON.stringify({
            note: `Updated to ${nextStatus} from BI Suite`,
          }),
        }
      );
      await syncPersistedLifecycleFromServer();
    } catch {
      // Ignore network error
    }
  };

  const getCategoryLabel = (cat: SmartInsightCategory): string => {
    const map: Record<SmartInsightCategory, { ar: string; en: string }> = {
      INVENTORY_RISK: { ar: 'مخاطر المخزون والصلاحية', en: 'Inventory & Expiry Risk' },
      UNMET_DEMAND: { ar: 'طلبات عملاء غير متوفرة', en: 'Unmet Customer Demand' },
      RISING_DEMAND: { ar: 'تصاعد الطلب والمبيعات', en: 'Rising Demand Velocity' },
      STOCKOUT_RISK: { ar: 'خطر نفاد المخزون', en: 'Stockout Risk' },
      REPLENISHMENT: { ar: 'توصيات الشراء والتوريد', en: 'Smart Replenishment' },
      FINANCIAL_RISK: { ar: 'المخاطر المالية والربحية', en: 'Financial & Margin Risk' },
      SALES_ANOMALY: { ar: 'تقلبات المبيعات غير المعتادة', en: 'Sales Volume Anomaly' },
      BRANCH_IMBALANCE: { ar: 'اختلال التوزيع بين الفروع', en: 'Branch Stock Imbalance' },
      SEASONAL_PATTERN: { ar: 'الأنماط الموسمية وأيام الذروة', en: 'Seasonal & Peak Pattern' },
      TRANSFER_OPPORTUNITY: { ar: 'فرص التحويل بين الفروع', en: 'Branch Transfer Opportunity' },
    };
    return isAr ? map[cat]?.ar || cat : map[cat]?.en || cat;
  };

  const getSeverityLabel = (sev: string): string => {
    const map: Record<string, { ar: string; en: string }> = {
      CRITICAL: { ar: 'حرج جداً', en: 'Critical' },
      HIGH: { ar: 'أولوية عالية', en: 'High Priority' },
      MEDIUM: { ar: 'متوسط', en: 'Medium' },
      LOW: { ar: 'منخفض', en: 'Low' },
      INFO: { ar: 'معلومة', en: 'Info' },
      critical: { ar: 'حرج جداً', en: 'Critical' },
      warning: { ar: 'تنبيه هام', en: 'Warning' },
      info: { ar: 'توصية تحليلية', en: 'Insight' },
    };
    return isAr ? map[sev]?.ar || sev : map[sev]?.en || sev;
  };

  const getLifecycleLabel = (st: 'active' | 'acknowledged' | 'resolved' | 'dismissed'): string => {
    const map = {
      active: { ar: 'نشط', en: 'Active' },
      acknowledged: { ar: 'تم الاطلاع', en: 'Acknowledged' },
      resolved: { ar: 'تم الحل', en: 'Resolved' },
      dismissed: { ar: 'تجاهل', en: 'Dismissed' },
    };
    return isAr ? map[st].ar : map[st].en;
  };

  const uniqueCategories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).filter(Boolean),
    [products]
  );

  const uniqueCashiers = useMemo(() => {
    const fromTx = transactions.map((t) => t.cashierName).filter(Boolean);
    const fromUsers = users.map((u) => u.terminalName).filter(Boolean);
    return Array.from(new Set([...fromTx, ...fromUsers]));
  }, [transactions, users]);

  const filters: AnalyticsFilterParams = useMemo(
    () => ({
      datePreset,
      startDate: datePreset === 'custom' && customStartDate ? customStartDate : undefined,
      endDate: datePreset === 'custom' && customEndDate ? customEndDate : undefined,
      branchId,
      category: categoryFilter,
      productId: productIdFilter,
      customerId: customerIdFilter,
      cashierName: cashierFilter,
      paymentMethod: paymentMethodFilter,
      currency: settings.currency,
      valuationMode,
      anchorCurrency: 'USD',
      abcBasis,
      leadTimeDays,
      safetyStockDays,
      forecastHorizonDays,
      missingDateStrategy: 'zero_fill',
    }),
    [
      datePreset,
      customStartDate,
      customEndDate,
      branchId,
      categoryFilter,
      productIdFilter,
      customerIdFilter,
      cashierFilter,
      paymentMethodFilter,
      settings.currency,
      valuationMode,
      abcBasis,
      leadTimeDays,
      safetyStockDays,
      forecastHorizonDays,
    ]
  );

  const overview = useMemo(() => {
    const snapshot = buildAnalyticsSnapshotFromState({
      products,
      transactions,
      customers,
      stockMovements,
      users,
      exchangeRates: settings.exchangeRates,
      exchangeRateHistory,
      branches: DEFAULT_ANALYTICS_BRANCHES,
      unmetDemandRequests,
    });
    return computeFullAnalyticsOverview(snapshot, filters, {
      userId: currentUser?.id || users[0]?.id || 'user-1',
      userName: currentUser?.name,
      role: currentUser?.role,
      assignedTerminalName: currentUser?.terminalName,
    });
  }, [
    products,
    transactions,
    customers,
    stockMovements,
    users,
    settings.exchangeRates,
    exchangeRateHistory,
    unmetDemandRequests,
    filters,
    currentUser,
  ]);

  const {
    sales,
    financial,
    inventory,
    customers: customerAnalytics,
    branches: branchAnalytics,
    technicalIndicators,
    forecasts,
    insights,
    intelligence,
    metricsDictionary,
  } = overview;

  const unmetDemand = intelligence.unmetDemand;

  const formatNullableCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) {
      return isAr ? 'غير مصرح / غير متاح' : 'Restricted / N/A';
    }
    return formatCurrency(val, sales.currency, settings.language);
  };

  const resetFilters = () => {
    setDatePreset('30d');
    setCustomStartDate('');
    setCustomEndDate('');
    setBranchId('all');
    setCategoryFilter('all');
    setProductIdFilter('all');
    setCustomerIdFilter('all');
    setCashierFilter('all');
    setPaymentMethodFilter('all');
    setValuationMode('historical');
  };

  const handleExportAnalyticsCsv = () => {
    const headers = [
      'Date',
      'Gross Sales',
      'Net Sales',
      'Discounts',
      'Tax',
      'COGS',
      'Gross Profit',
      'Transactions',
      'Units Sold',
      'Currency',
    ];
    const rows = sales.dailySeries.map((d) => [
      d.dateKey,
      d.grossSales,
      d.netSales,
      d.discounts,
      d.tax,
      d.cogs,
      d.grossProfit,
      d.transactionCount,
      d.unitsSold,
      sales.currency,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `pos-bi-analytics-${sales.currency}-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const primarySections: {
    id: string;
    targetTab: BiSubTab;
    matchTabs: BiSubTab[];
    labelEn: string;
    labelAr: string;
    badge?: number;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'section-overview',
      targetTab: 'overview',
      matchTabs: ['overview'],
      labelEn: '1. Business Overview',
      labelAr: '1. الملخص التنفيذي',
      icon: <BarChart3 className="w-3.5 h-3.5" />,
    },
    {
      id: 'section-sales',
      targetTab: 'sales',
      matchTabs: ['sales', 'products'],
      labelEn: '2. Sales',
      labelAr: '2. المبيعات',
      icon: <CandlestickChart className="w-3.5 h-3.5" />,
    },
    {
      id: 'section-inventory',
      targetTab: 'inventory',
      matchTabs: ['inventory', 'forecasts', 'unmet_demand'],
      labelEn: '3. Inventory & Demand',
      labelAr: '3. المخزون والطلب',
      badge: unmetDemand.summary.totalInquiries,
      icon: <Package className="w-3.5 h-3.5" />,
    },
    {
      id: 'section-financial',
      targetTab: 'financial',
      matchTabs: ['financial'],
      labelEn: '4. Financial Overview',
      labelAr: '4. المركز المالي',
      icon: <DollarSign className="w-3.5 h-3.5" />,
    },
    {
      id: 'section-branches',
      targetTab: 'branches',
      matchTabs: ['branches'],
      labelEn: '5. Branch Performance',
      labelAr: '5. أداء الفروع',
      icon: <Building2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'section-intelligence',
      targetTab: 'intelligence_center',
      matchTabs: ['intelligence_center', 'smart_intelligence', 'insights'],
      labelEn: '6. Intelligence Center',
      labelAr: '6. مركز الذكاء والتوصيات',
      badge: persistedLifecycleCounts?.active ?? intelligence.overview.totalActiveAlerts,
      icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      id: 'section-reports',
      targetTab: 'technical',
      matchTabs: ['technical', 'customers'],
      labelEn: '7. Reports & Signals',
      labelAr: '7. التقارير والمؤشرات',
      icon: <Activity className="w-3.5 h-3.5" />,
    },
  ];

  const subTabs: { id: BiSubTab; labelEn: string; labelAr: string; icon: React.ReactNode }[] = [
    {
      id: 'overview',
      labelEn: 'Executive Overview',
      labelAr: 'الملخص التنفيذي',
      icon: <BarChart3 className="w-3.5 h-3.5" />,
    },
    {
      id: 'intelligence_center',
      labelEn: `Intelligence Center (${
        persistedLifecycleCounts?.active ?? intelligence.overview.totalActiveAlerts
      })`,
      labelAr: `مركز الذكاء ودورة الحياة (${
        persistedLifecycleCounts?.active ?? intelligence.overview.totalActiveAlerts
      })`,
      icon: <Sparkles className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      id: 'unmet_demand',
      labelEn: `Customer Demand (${unmetDemand.summary.totalInquiries})`,
      labelAr: `طلبات العملاء غير المتوفرة (${unmetDemand.summary.totalInquiries})`,
      icon: <PackageX className="w-3.5 h-3.5 text-rose-400" />,
    },
    {
      id: 'smart_intelligence',
      labelEn: `Smart Operations & Replenishment (${intelligence.overview.totalActiveAlerts})`,
      labelAr: `الذكاء التشغيلي والتوريد (${intelligence.overview.totalActiveAlerts})`,
      icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      id: 'sales',
      labelEn: 'Sales & Candlesticks',
      labelAr: 'تحليل المبيعات والشموع',
      icon: <CandlestickChart className="w-3.5 h-3.5" />,
    },
    {
      id: 'financial',
      labelEn: 'Financial & P&L',
      labelAr: 'التحليل المالي والأرباح',
      icon: <DollarSign className="w-3.5 h-3.5" />,
    },
    {
      id: 'inventory',
      labelEn: 'Inventory & ABC / Reorder',
      labelAr: 'المخزون وتصنيف ABC وإعادة الطلب',
      icon: <Package className="w-3.5 h-3.5" />,
    },
    {
      id: 'products',
      labelEn: 'Products & Categories',
      labelAr: 'المنتجات والفئات',
      icon: <Layers className="w-3.5 h-3.5" />,
    },
    {
      id: 'customers',
      labelEn: 'Customers & Credit',
      labelAr: 'العملاء والائتمان',
      icon: <Users className="w-3.5 h-3.5" />,
    },
    {
      id: 'branches',
      labelEn: 'Branches & Cashiers',
      labelAr: 'الفروع والكاشير',
      icon: <Building2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'technical',
      labelEn: 'Technical Indicators',
      labelAr: 'المؤشرات الفنية (SMA/RSI/MACD)',
      icon: <Activity className="w-3.5 h-3.5" />,
    },
    {
      id: 'forecasts',
      labelEn: 'Predictive Forecasting',
      labelAr: 'التوقعات الإحصائية (7/30/90 يوم)',
      icon: <LineChart className="w-3.5 h-3.5" />,
    },
    {
      id: 'insights',
      labelEn: `All Recommendations (${
        intelligence.smartAlerts.length +
        intelligence.replenishmentRecommendations.length +
        intelligence.branchTransferOpportunities.length +
        insights.length
      })`,
      labelAr: `كل التوصيات الذكية (${
        intelligence.smartAlerts.length +
        intelligence.replenishmentRecommendations.length +
        intelligence.branchTransferOpportunities.length +
        insights.length
      })`,
      icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
    },
  ];

  const selectClass = `px-3 py-2 rounded-xl text-xs font-medium border outline-none transition-colors ${
    isDark
      ? 'bg-neutral-900 border-neutral-800 text-neutral-100 focus:border-amber-500'
      : 'bg-white border-neutral-200 text-neutral-800 focus:border-amber-500'
  }`;

  return (
    <div className="space-y-4" data-testid="bi-analytics-dashboard">
      {/* 7-Section Primary Navigation Bar (Part 3 Dashboard Structure) */}
      <div
        data-testid="bi-primary-sections-nav"
        className="p-2 rounded-2xl bg-neutral-900 border border-neutral-800 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5"
      >
        {primarySections.map((sec) => {
          const isSecActive = sec.matchTabs.includes(activeTab);
          return (
            <button
              key={sec.id}
              type="button"
              data-testid={`bi-primary-${sec.id}`}
              onClick={() => setActiveTab(sec.targetTab)}
              className={`px-2.5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-between gap-1.5 transition-all border ${
                isSecActive
                  ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                  : 'bg-neutral-950/80 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0">{sec.icon}</span>
                <span className="truncate">{isAr ? sec.labelAr : sec.labelEn}</span>
              </div>
              {sec.badge !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-black shrink-0 ${
                    isSecActive
                      ? 'bg-neutral-950/20 text-neutral-950'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {sec.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Global Filter Bar (Collapsible on Mobile/Tablet <1024px) */}
      <AppCard className="p-3.5 border-amber-500/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Filter className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                {isAr
                  ? 'محرك الفلترة الشامل لذكاء الأعمال والتنبؤ الإحصائي'
                  : 'Global Business Intelligence & Forecasting Filter Bar'}
              </h3>
              <p className="text-[11px] text-neutral-400">
                {isAr
                  ? `العملة النشطة: ${settings.currency} • وضع التقييم: ${
                      valuationMode === 'historical'
                        ? 'سعر الصرف التاريخي وقت البيع'
                        : valuationMode === 'indexed'
                        ? 'مؤشر بالدولار (حفظ القوة الشرائية)'
                        : 'سعر الصرف الحي الحالي'
                    }`
                  : `Active Currency: ${settings.currency} • Valuation: ${valuationMode.toUpperCase()}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              data-testid="bi-toggle-filters-btn"
              onClick={() => setIsMobileFiltersOpen((prev) => !prev)}
              className="lg:hidden px-2.5 py-1.5 rounded-lg text-xs font-bold border border-amber-500/40 bg-amber-500/10 text-amber-300 flex items-center gap-1"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{isAr ? (isMobileFiltersOpen ? 'إخفاء الفلاتر' : 'إظهار الفلاتر') : isMobileFiltersOpen ? 'Hide Filters' : 'Filters'}</span>
            </button>
            <button
              type="button"
              data-testid="bi-open-unmet-demand-btn"
              onClick={() =>
                openUnmetDemandModal({
                  sourceScreen: 'analytics',
                  branchId: branchId !== 'all' ? branchId : undefined,
                  productId: productIdFilter !== 'all' ? productIdFilter : undefined,
                })
              }
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 flex items-center gap-1.5"
            >
              <PackageX className="w-3.5 h-3.5" />
              {isAr ? '+ تسجيل طلب غير متوفر' : '+ Record Unmet Demand'}
            </button>
            <button
              type="button"
              onClick={() => setShowDictionaryModal(!showDictionaryModal)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 flex items-center gap-1.5"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isAr ? 'قاموس المعادلات والمؤشرات' : 'Metrics Dictionary'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportAnalyticsCsv}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isAr ? 'تصدير CSV' : 'Export CSV'}</span>
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-neutral-700 bg-neutral-800/60 text-neutral-300 hover:bg-neutral-800 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">{isAr ? 'إعادة ضبط' : 'Reset'}</span>
            </button>
          </div>
        </div>

        {/* Date Preset Quick Buttons + Dropdowns */}
        <div
          className={`${
            isMobileFiltersOpen ? 'grid' : 'hidden lg:grid'
          } grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 pt-3 mt-3 border-t border-neutral-800/60`}
        >
          <div>
            <label className="block text-[10px] font-semibold text-neutral-400 mb-1">
              {isAr ? 'الفترة الزمنية' : 'Date Range'}
            </label>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as AnalyticsDatePreset)}
              className={`w-full ${selectClass}`}
              data-testid="bi-filter-date-preset"
            >
              <option value="today">{isAr ? 'اليوم' : 'Today'}</option>
              <option value="yesterday">{isAr ? 'أمس' : 'Yesterday'}</option>
              <option value="7d">{isAr ? 'آخر 7 أيام' : 'Last 7 Days'}</option>
              <option value="30d">{isAr ? 'آخر 30 يوماً' : 'Last 30 Days'}</option>
              <option value="90d">{isAr ? 'آخر 90 يوماً (MACD كامل)' : 'Last 90 Days (Full MACD)'}</option>
              <option value="mtd">{isAr ? 'منذ بداية الشهر (MTD)' : 'Month to Date (MTD)'}</option>
              <option value="ytd">{isAr ? 'منذ بداية السنة (YTD)' : 'Year to Date (YTD)'}</option>
              <option value="custom">{isAr ? 'نطاق مخصص' : 'Custom Range'}</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">
              {isAr ? 'الفرع' : 'Branch'}
            </label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="all">{isAr ? 'كل الفروع' : 'All Branches'}</option>
              {DEFAULT_ANALYTICS_BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {isAr ? b.nameAr : b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">
              {isAr ? 'الفئة' : 'Category'}
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="all">{isAr ? 'كل الفئات' : 'All Categories'}</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">
              {isAr ? 'المنتج' : 'Product'}
            </label>
            <select
              value={productIdFilter}
              onChange={(e) => setProductIdFilter(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="all">{isAr ? 'كل المنتجات' : 'All Products'}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {isAr ? p.nameAr || p.name : p.name} ({p.sku})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">
              {isAr ? 'العميل' : 'Customer'}
            </label>
            <select
              value={customerIdFilter}
              onChange={(e) => setCustomerIdFilter(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="all">{isAr ? 'كل العملاء' : 'All Customers'}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">
              {isAr ? 'طريقة الدفع' : 'Payment Method'}
            </label>
            <select
              value={paymentMethodFilter}
              onChange={(e) => setPaymentMethodFilter(e.target.value as PaymentMethod | 'all')}
              className={`w-full ${selectClass}`}
            >
              <option value="all">{isAr ? 'الكل' : 'All Methods'}</option>
              <option value="cash">{isAr ? 'نقداً (كاش)' : 'Cash'}</option>
              <option value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank Transfer'}</option>
              <option value="qr_nfc">{isAr ? 'محفظة رقمية' : 'Digital Wallet'}</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">
              {isAr ? 'تقييم سعر الصرف' : 'FX Valuation Mode'}
            </label>
            <select
              value={valuationMode}
              onChange={(e) => setValuationMode(e.target.value as SalesRateValuationMode)}
              className={`w-full ${selectClass}`}
            >
              <option value="historical">
                {isAr ? 'سعر وقت البيع (تاريخي)' : 'Historical Sale Rate'}
              </option>
              <option value="indexed">
                {isAr ? 'مؤشر بالدولار (استبدال)' : 'USD-Indexed Replacement'}
              </option>
              <option value="live">{isAr ? 'السعر الحي الحالي' : 'Current Live Rate'}</option>
            </select>
          </div>
        </div>

        {datePreset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800/50">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">
                {isAr ? 'من تاريخ' : 'Start Date'}
              </label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className={`w-full ${selectClass}`}
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">
                {isAr ? 'إلى تاريخ' : 'End Date'}
              </label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className={`w-full ${selectClass}`}
              />
            </div>
          </div>
        )}
      </AppCard>

      {/* Metrics Dictionary Drawer / Modal */}
      {showDictionaryModal && (
        <AppCard className="p-4 border-sky-500/40 bg-sky-950/10 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              {isAr
                ? 'قاموس المعادلات المحاسبية والإحصائية المعتمدة'
                : 'Approved Financial, Inventory & Statistical Metrics Dictionary'}
            </h4>
            <button
              type="button"
              onClick={() => setShowDictionaryModal(false)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded"
            >
              {isAr ? 'إغلاق ✕' : 'Close ✕'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {metricsDictionary.map((m) => (
              <div
                key={m.key}
                className={`p-2.5 rounded-xl border ${
                  isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="text-xs font-bold text-amber-400">
                  {isAr ? m.nameAr : m.nameEn}
                </div>
                <div className="text-[11px] font-mono text-slate-300 mt-1">
                  {isAr ? m.formulaAr : m.formulaEn}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {isAr ? 'الجداول:' : 'Tables:'} {m.sourceTables.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </AppCard>
      )}

      {/* Module Sub-Navigation Bar (Wraps cleanly so all tabs are visible without hidden scrolling) */}
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        {subTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              data-testid={`bi-tab-${tab.id}`}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all border ${
                isActive
                  ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md shadow-amber-500/15'
                  : isDark
                  ? 'bg-neutral-900/90 text-neutral-200 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/80'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {tab.icon}
              <span>{isAr ? tab.labelAr : tab.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* SECTION 6 PRIMARY VIEW: PERSISTENT INTELLIGENCE CENTER                */}
      {/* ===================================================================== */}
      {activeTab === 'intelligence_center' && (
        <IntelligenceCenterView
          isAr={isAr}
          currentUserId={activeUserId}
          currentUserRole={currentUser?.role || 'admin'}
          initialBranchId={branchId}
          onLifecycleMutated={(counts) => setPersistedLifecycleCounts(counts)}
          onOpenUnmetDemandModal={() =>
            openUnmetDemandModal({
              sourceScreen: 'analytics',
              branchId: branchId !== 'all' ? branchId : undefined,
              productId: productIdFilter !== 'all' ? productIdFilter : undefined,
            })
          }
        />
      )}

      {/* ===================================================================== */}
      {/* TAB 1: EXECUTIVE OVERVIEW                                             */}
      {/* ===================================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Primary Executive KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <AppCard className="p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>{isAr ? 'صافي المبيعات' : 'Net Sales'}</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-lg font-black font-mono tabular-nums text-emerald-400">
                {formatCurrency(sales.summary.netSales, sales.currency, settings.language)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                {sales.summary.periodOverPeriodGrowthPercent >= 0 ? (
                  <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 text-rose-400" />
                )}
                <span>
                  {sales.summary.periodOverPeriodGrowthPercent >= 0 ? '+' : ''}
                  {sales.summary.periodOverPeriodGrowthPercent}%{' '}
                  {isAr ? 'مقابل الفترة السابقة' : 'vs prior period'}
                </span>
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>
                  {isAr ? 'إجمالي الربح' : 'Gross Profit'}
                  {financial.profitAndLoss.isGrossProfitEstimated && (
                    <span className="ml-1 text-[9px] text-amber-400">
                      ({isAr ? 'تقديري' : 'Est.'})
                    </span>
                  )}
                </span>
                <TrendingUp className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-lg font-black font-mono tabular-nums text-amber-400">
                {formatNullableCurrency(financial.profitAndLoss.grossProfit)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'هامش الربح الإجمالي:' : 'Gross Margin:'}{' '}
                <strong className="text-slate-200">
                  {financial.profitAndLoss.grossProfitMarginPercent !== null
                    ? `${financial.profitAndLoss.grossProfitMarginPercent}%`
                    : isAr
                    ? 'غير مصرح'
                    : 'Restricted'}
                </strong>
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>{isAr ? 'متوسط الفاتورة (ATV)' : 'Avg Ticket (ATV)'}</span>
                <Activity className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-lg font-black font-mono tabular-nums">
                {formatCurrency(
                  sales.summary.averageTransactionValue,
                  sales.currency,
                  settings.language
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {sales.summary.transactionCount} {isAr ? 'فاتورة' : 'orders'} • UPT:{' '}
                <strong className="text-slate-200">{sales.summary.unitsPerTransaction}</strong>
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>{isAr ? 'توقعات 7 أيام القادمة' : '7-Day Sales Forecast'}</span>
                <LineChart className="w-4 h-4 text-fuchsia-400" />
              </div>
              <div className="text-lg font-black font-mono tabular-nums text-fuchsia-400">
                {formatCurrency(
                  forecasts.revenueForecastSummary.expectedTotalNetSales,
                  sales.currency,
                  settings.language
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                WAPE: {forecasts.backtestEvaluations[0]?.wapePercent ?? 0}% (
                {forecasts.selectedModel.replace(/_/g, ' ')})
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>{isAr ? 'قيمة المخزون بالتكلفة' : 'Inventory at Cost'}</span>
                <Package className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-lg font-black font-mono tabular-nums">
                {formatNullableCurrency(inventory.summary.totalInventoryValueAtCost)}
              </div>
              <div className="text-[10px] text-amber-400 mt-1">
                {inventory.summary.reorderActionRequiredCount}{' '}
                {isAr ? 'أصناف تحتاج إعادة طلب' : 'SKUs need reorder'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>{isAr ? 'التدفق النقدي المحصل' : 'Total Cash Inflow'}</span>
                <Wallet className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-lg font-black font-mono tabular-nums">
                {formatCurrency(
                  financial.cashFlowAndWorkingCapital.totalCashInflows,
                  sales.currency,
                  settings.language
                )}
              </div>
              <div className="text-[10px] text-rose-400 mt-1">
                {isAr ? 'ديون قائمة:' : 'Open AR:'}{' '}
                {formatCurrency(
                  financial.cashFlowAndWorkingCapital.accountsReceivableOutstandingDebt,
                  sales.currency,
                  settings.language
                )}
              </div>
            </AppCard>
          </div>

          {/* Main Interactive Technical Trend & Forecast Split */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AppCard className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    {isAr
                      ? 'الاتجاه الزمني للمبيعات والمتوسطات المتحركة (SMA 7 / EMA 7)'
                      : 'Daily Net Sales & Moving Averages (SMA 7 / EMA 7 / Trendline)'}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {isAr
                      ? technicalIndicators.dataSufficiencyNoteAr
                      : technicalIndicators.dataSufficiencyNoteEn}
                  </p>
                </div>
              </div>
              <TechnicalTrendOverlayChart
                series={technicalIndicators.series}
                supportFloor={technicalIndicators.latestValues.supportFloor}
                resistanceCeiling={technicalIndicators.latestValues.resistanceCeiling}
                currency={sales.currency}
                language={settings.language}
              />
            </AppCard>

            <AppCard className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <LineChart className="w-4 h-4 text-amber-400" />
                    {isAr
                      ? `التوقعات الإحصائية للمبيعات (${forecasts.horizonDays} أيام القادمة)`
                      : `Statistical Revenue Forecast (${forecasts.horizonDays}-Day Horizon)`}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {isAr ? forecasts.selectionReasonAr : forecasts.selectionReasonEn}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {([7, 30, 90] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setForecastHorizonDays(h)}
                      className={`px-2 py-1 rounded text-[11px] font-bold font-mono ${
                        forecastHorizonDays === h
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {h}D
                    </button>
                  ))}
                </div>
              </div>
              <StatisticalForecastFanChart
                series={forecasts.revenueSeries}
                currency={sales.currency}
                language={settings.language}
              />
            </AppCard>
          </div>

          {/* Unified Comprehensive Store Recommendations & Actionable Insights Hub */}
          <AppCard
            className="p-5 sm:p-6 space-y-5 border-neutral-800 bg-neutral-900/95"
            data-testid="bi-overview-recommendations-hub"
          >
            {/* Header & Filter Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
              <div className="space-y-1">
                <h4 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2.5">
                  <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>
                    {isAr
                      ? 'مركز التوصيات الذكية والتنبيهات التشغيلية الشامل'
                      : 'Complete Smart Store Recommendations & Actionable Insights'}
                  </span>
                </h4>
                <p className="text-xs sm:text-sm text-neutral-400">
                  {isAr
                    ? `يعرض جميع التوصيات الفورية (${
                        intelligence.smartAlerts.length +
                        intelligence.replenishmentRecommendations.length +
                        intelligence.branchTransferOpportunities.length +
                        insights.length
                      } توصية نشطة) تشمل المخزون، طلبات العملاء غير المتوفرة، أوامر الشراء، التحويل بين الفروع، والتحليل المالي.`
                    : `Showing all ${
                        intelligence.smartAlerts.length +
                        intelligence.replenishmentRecommendations.length +
                        intelligence.branchTransferOpportunities.length +
                        insights.length
                      } active recommendations across inventory, unmet customer demand, replenishment, branch transfers, and finance.`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    {
                      id: 'all',
                      labelAr: `كل التوصيات (${
                        intelligence.smartAlerts.length +
                        intelligence.replenishmentRecommendations.length +
                        intelligence.branchTransferOpportunities.length +
                        insights.length
                      })`,
                      labelEn: `All (${
                        intelligence.smartAlerts.length +
                        intelligence.replenishmentRecommendations.length +
                        intelligence.branchTransferOpportunities.length +
                        insights.length
                      })`,
                    },
                    {
                      id: 'smart_alerts',
                      labelAr: `التنبيهات الذكية (${intelligence.smartAlerts.length})`,
                      labelEn: `Smart Alerts (${intelligence.smartAlerts.length})`,
                    },
                    {
                      id: 'replenishment',
                      labelAr: `توصيات الشراء (${intelligence.replenishmentRecommendations.length})`,
                      labelEn: `Replenishment POs (${intelligence.replenishmentRecommendations.length})`,
                    },
                    {
                      id: 'transfers',
                      labelAr: `تحويلات الفروع (${intelligence.branchTransferOpportunities.length})`,
                      labelEn: `Branch Transfers (${intelligence.branchTransferOpportunities.length})`,
                    },
                    {
                      id: 'executive',
                      labelAr: `التوصيات التنفيذية (${insights.length})`,
                      labelEn: `Executive Insights (${insights.length})`,
                    },
                  ] as const
                ).map((btn) => (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setOverviewRecommendationFilter(btn.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      overviewRecommendationFilter === btn.id
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                        : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    {isAr ? btn.labelAr : btn.labelEn}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Quick Filter when viewing All or Smart Alerts */}
            {(overviewRecommendationFilter === 'all' ||
              overviewRecommendationFilter === 'smart_alerts') && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAlertCategoryFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    alertCategoryFilter === 'ALL'
                      ? 'bg-neutral-100 text-neutral-950 font-bold'
                      : 'bg-neutral-950/80 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                  }`}
                >
                  {isAr
                    ? `جميع الفئات (${intelligence.smartAlerts.length})`
                    : `All Categories (${intelligence.smartAlerts.length})`}
                </button>
                {SUPPORTED_SMART_INSIGHT_CATEGORIES.map((cat) => {
                  const count = intelligence.overview.byCategory[cat] || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setAlertCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        alertCategoryFilter === cat
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                          : 'bg-neutral-950/80 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                      }`}
                    >
                      {getCategoryLabel(cat)} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {/* SECTION 1: Smart Operational Alerts across all 10 categories */}
            {(overviewRecommendationFilter === 'all' ||
              overviewRecommendationFilter === 'smart_alerts') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-bold text-amber-400">
                    {isAr
                      ? `1. التنبيهات والتوصيات التشغيلية الذكية (${
                          intelligence.smartAlerts.filter(
                            (a) =>
                              alertCategoryFilter === 'ALL' || a.category === alertCategoryFilter
                          ).length
                        })`
                      : `1. Smart Store Operations & Risk Recommendations (${
                          intelligence.smartAlerts.filter(
                            (a) =>
                              alertCategoryFilter === 'ALL' || a.category === alertCategoryFilter
                          ).length
                        })`}
                  </h5>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                  {intelligence.smartAlerts
                    .filter(
                      (a) =>
                        alertCategoryFilter === 'ALL' || a.category === alertCategoryFilter
                    )
                    .map((alert) => {
                      const status =
                        alertLifecycleOverrides[alert.id] || alert.lifecycleStatus;
                      const topEvidence = alert.evidenceMetrics[0];
                      return (
                        <div
                          key={alert.id}
                          className={`p-4 rounded-2xl border space-y-2.5 transition-colors ${
                            alert.severity === 'CRITICAL'
                              ? 'bg-neutral-950/90 border-rose-500/40'
                              : alert.severity === 'HIGH'
                              ? 'bg-neutral-950/90 border-amber-500/40'
                              : 'bg-neutral-950/90 border-neutral-800'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                                <span
                                  className={
                                    alert.severity === 'CRITICAL'
                                      ? 'font-bold text-rose-400'
                                      : alert.severity === 'HIGH'
                                      ? 'font-bold text-amber-400'
                                      : 'font-semibold text-sky-400'
                                  }
                                >
                                  {getSeverityLabel(alert.severity)}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-neutral-300 font-medium">
                                  {getCategoryLabel(alert.category)}
                                </span>
                              </div>
                              <h6 className="text-sm sm:text-base font-bold text-white">
                                {isAr ? alert.titleAr : alert.titleEn}
                              </h6>
                            </div>
                            {topEvidence && (
                              <span className="font-mono text-xs font-bold text-amber-400">
                                {topEvidence.name}: {topEvidence.valueFormatted}
                              </span>
                            )}
                          </div>

                          <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                            <strong className="text-white">
                              {isAr ? 'التشخيص: ' : 'Finding: '}
                            </strong>
                            {isAr ? alert.descriptionAr : alert.descriptionEn}
                          </p>

                          <p className="text-xs text-neutral-400 leading-relaxed">
                            <strong className="text-neutral-300">
                              {isAr ? 'السبب والدليل الرقمي: ' : 'Evidence & Reason: '}
                            </strong>
                            {isAr ? alert.explanationAr : alert.explanationEn}
                          </p>

                          <div className="pt-2 border-t border-neutral-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="text-xs sm:text-sm font-bold text-emerald-400">
                              {isAr ? 'التوصية المقترحة: ' : 'Recommended Action: '}
                              <span className="font-semibold text-emerald-300">
                                {isAr ? alert.recommendedActionAr : alert.recommendedActionEn}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {(
                                ['active', 'acknowledged', 'resolved', 'dismissed'] as const
                              ).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() =>
                                    setAlertLifecycleOverrides((prev) => ({
                                      ...prev,
                                      [alert.id]: st,
                                    }))
                                  }
                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                                    status === st
                                      ? 'bg-amber-500 text-neutral-950 font-bold'
                                      : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
                                  }`}
                                >
                                  {getLifecycleLabel(st)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* SECTION 2: Smart Replenishment & Purchase Order Recommendations */}
            {(overviewRecommendationFilter === 'all' ||
              overviewRecommendationFilter === 'replenishment') &&
              intelligence.replenishmentRecommendations.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-neutral-800/80">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-sm font-bold text-sky-400">
                      {isAr
                        ? `2. توصيات التوريد وأوامر الشراء الذكية (${intelligence.replenishmentRecommendations.length})`
                        : `2. Smart Purchase Order & Replenishment Recommendations (${intelligence.replenishmentRecommendations.length})`}
                    </h5>
                    <span className="text-xs text-neutral-400">
                      {isAr
                        ? 'تدمج المبيعات الفعلية + طلبات العملاء غير المتوفرة + زمن التوريد (تتطلب موافقة الإدارة)'
                        : 'Combines actual sales + unmet customer demand + lead time (Requires Manager Approval)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                    {intelligence.replenishmentRecommendations.map((rec) => (
                      <div
                        key={rec.id}
                        className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-xs text-neutral-400">
                              <span
                                className={
                                  rec.urgency === 'CRITICAL'
                                    ? 'font-bold text-rose-400'
                                    : rec.urgency === 'HIGH'
                                    ? 'font-bold text-amber-400'
                                    : 'font-semibold text-sky-400'
                                }
                              >
                                {getSeverityLabel(rec.urgency)}
                              </span>
                              <span className="mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-mono">{rec.sku}</span>
                              <span className="mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span>{rec.category}</span>
                            </div>
                            <h6 className="text-sm sm:text-base font-bold text-white mt-0.5">
                              {isAr ? rec.productNameAr || rec.productName : rec.productName}
                            </h6>
                          </div>
                          <div className="text-end font-mono">
                            <div className="text-sm font-black text-emerald-400">
                              {isAr
                                ? `اطلب +${rec.recommendedOrderUnits} وحدة`
                                : `Order +${rec.recommendedOrderUnits} units`}
                            </div>
                            <div className="text-xs text-neutral-400">
                              {isAr ? 'التكلفة التقديرية:' : 'Est. Cost:'}{' '}
                              {formatNullableCurrency(rec.estimatedOrderCost)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 p-2.5 rounded-xl bg-neutral-900/90 border border-neutral-800/80 text-xs font-mono">
                          <div>
                            <div className="text-[11px] text-neutral-400 font-sans">
                              {isAr ? 'الرصيد الحالي' : 'Stock'}
                            </div>
                            <div className="font-bold text-white">{rec.currentStock}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-neutral-400 font-sans">
                              {isAr ? 'مبيعات/يوم' : 'Sales/Day'}
                            </div>
                            <div className="font-bold text-sky-400">
                              {rec.observedSalesDailyVelocity}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-neutral-400 font-sans">
                              {isAr ? 'طلبات مفقودة' : 'Unmet Req.'}
                            </div>
                            <div className="font-bold text-rose-400">
                              {rec.observedUnmetDemandUnits} ({rec.unmetDemandInquiriesCount})
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-neutral-400 font-sans">
                              {isAr ? 'نقطة الطلب' : 'Reorder Pt'}
                            </div>
                            <div className="font-bold text-amber-400">{rec.reorderPointUnits}</div>
                          </div>
                        </div>

                        <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
                          {isAr ? rec.explanationAr : rec.explanationEn}
                        </p>
                        <div className="text-xs sm:text-sm font-bold text-emerald-400 pt-1">
                          {isAr ? 'الإجراء المقترح: ' : 'Suggested Action: '}
                          <span className="font-semibold text-emerald-300">
                            {isAr ? rec.suggestedActionAr : rec.suggestedActionEn}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* SECTION 3: Smart Inter-Branch Transfer Opportunities */}
            {(overviewRecommendationFilter === 'all' ||
              overviewRecommendationFilter === 'transfers') &&
              intelligence.branchTransferOpportunities.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-neutral-800/80">
                  <h5 className="text-sm font-bold text-emerald-400">
                    {isAr
                      ? `3. توصيات التحويل الذكي للمخزون بين الفروع (${intelligence.branchTransferOpportunities.length})`
                      : `3. Smart Inter-Branch Stock Transfer Opportunities (${intelligence.branchTransferOpportunities.length})`}
                  </h5>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                    {intelligence.branchTransferOpportunities.map((tr) => (
                      <div
                        key={tr.id}
                        className="p-4 rounded-2xl bg-neutral-950/90 border border-emerald-500/30 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h6 className="text-sm sm:text-base font-bold text-white">
                            {isAr ? tr.productNameAr || tr.productName : tr.productName}{' '}
                            <span className="font-mono text-xs text-neutral-400">({tr.sku})</span>
                          </h6>
                          <span className="font-mono text-sm font-black text-emerald-400">
                            {isAr
                              ? `تحويل ${tr.recommendedTransferUnits} وحدة`
                              : `Transfer ${tr.recommendedTransferUnits} units`}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-mono">
                          <span className="text-sky-300">
                            {isAr ? 'من فرع الفائض:' : 'From Surplus:'}{' '}
                            {isAr ? tr.fromBranchNameAr : tr.fromBranchName} (+
                            {tr.fromBranchEstimatedSurplusUnits})
                          </span>
                          <span className="text-amber-400 font-bold">⇄</span>
                          <span className="text-rose-300">
                            {isAr ? 'إلى فرع العجز:' : 'To Shortage:'}{' '}
                            {isAr ? tr.toBranchNameAr : tr.toBranchName} (
                            {tr.toBranchShortageOrUnmetUnits})
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                          {isAr ? tr.explanationAr : tr.explanationEn}
                        </p>
                        <div className="text-xs sm:text-sm font-bold text-emerald-400">
                          {isAr ? 'التوصية: ' : 'Action: '}
                          <span className="font-semibold text-emerald-300">
                            {isAr ? tr.suggestedActionAr : tr.suggestedActionEn}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* SECTION 4: All Explainable Executive & Financial Insights (No slice truncation!) */}
            {(overviewRecommendationFilter === 'all' ||
              overviewRecommendationFilter === 'executive') &&
              insights.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-neutral-800/80">
                  <h5 className="text-sm font-bold text-amber-300">
                    {isAr
                      ? `4. التوصيات التحليلية والمالية التنفيذية (${insights.length})`
                      : `4. Explainable Financial & Executive Business Insights (${insights.length})`}
                  </h5>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                    {insights.map((ins) => (
                      <div
                        key={ins.id}
                        className={`p-4 rounded-2xl border space-y-2 ${
                          ins.severity === 'critical'
                            ? 'border-rose-500/40 bg-neutral-950/90'
                            : ins.severity === 'warning'
                            ? 'border-amber-500/40 bg-neutral-950/90'
                            : 'border-neutral-800 bg-neutral-950/90'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span
                              className={`text-xs font-bold ${
                                ins.severity === 'critical'
                                  ? 'text-rose-400'
                                  : ins.severity === 'warning'
                                  ? 'text-amber-400'
                                  : 'text-sky-400'
                              }`}
                            >
                              {getSeverityLabel(ins.severity)}
                            </span>
                            <h6 className="text-sm sm:text-base font-bold text-white mt-0.5">
                              {isAr ? ins.titleAr : ins.titleEn}
                            </h6>
                          </div>
                          <span className="text-xs font-mono font-bold text-amber-400 shrink-0">
                            {ins.metricValueFormatted}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                          <strong className="text-white">
                            {isAr ? 'النتيجة: ' : 'Finding: '}
                          </strong>
                          {isAr ? ins.findingAr : ins.findingEn}
                        </p>
                        <p className="text-xs text-neutral-400 leading-relaxed">
                          <strong className="text-neutral-300">
                            {isAr ? 'السبب والدليل: ' : 'Reason & Evidence: '}
                          </strong>
                          {isAr ? ins.reasonAr : ins.reasonEn} —{' '}
                          {isAr ? ins.supportingEvidenceAr : ins.supportingEvidenceEn}
                        </p>
                        <div className="text-xs sm:text-sm font-bold text-emerald-400 pt-1">
                          {isAr ? 'الإجراء المقترح: ' : 'Recommended Action: '}
                          <span className="font-semibold text-emerald-300">
                            {isAr ? ins.suggestedActionAr : ins.suggestedActionEn}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: SALES ANALYTICS & INTRADAY CANDLESTICKS                        */}
      {/* ===================================================================== */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'إجمالي المبيعات (قبل الخصم)' : 'Gross Sales (Pre-Discount)'}
              </div>
              <div className="text-lg font-black font-mono mt-1">
                {formatCurrency(sales.summary.grossSales, sales.currency, settings.language)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'الخصومات الممنوحة:' : 'Discounts:'}{' '}
                {formatCurrency(sales.summary.discountsTotal, sales.currency, settings.language)} (
                {sales.summary.discountRatePercent}%)
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'صافي المبيعات (بدون الضريبة)' : 'Net Sales (Excl. Tax & Voids)'}
              </div>
              <div className="text-lg font-black font-mono text-emerald-400 mt-1">
                {formatCurrency(sales.summary.netSales, sales.currency, settings.language)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'الضريبة المحصلة:' : 'Tax Collected:'}{' '}
                {formatCurrency(sales.summary.taxCollected, sales.currency, settings.language)}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'إجمالي الفواتير شاملة الضريبة' : 'Billed Grand Total (Incl. Tax)'}
              </div>
              <div className="text-lg font-black font-mono text-amber-400 mt-1">
                {formatCurrency(
                  sales.summary.billedGrandTotal,
                  sales.currency,
                  settings.language
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'متوسط الفاتورة الإجمالي:' : 'Avg Billed Ticket:'}{' '}
                {formatCurrency(
                  sales.summary.averageBilledTicket,
                  sales.currency,
                  settings.language
                )}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'المرتجعات والفواتير الملغاة' : 'Returns & Voided Invoices'}
              </div>
              <div className="text-lg font-black font-mono text-rose-400 mt-1">
                {formatCurrency(
                  sales.summary.returnedOrVoidedSales,
                  sales.currency,
                  settings.language
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {sales.summary.returnedOrVoidedCount}{' '}
                {isAr ? 'فاتورة ملغاة/مرتجعة' : 'voided/returned orders'}
              </div>
            </AppCard>
          </div>

          {/* Intraday Hourly Sales Candlesticks (OHLC) */}
          <AppCard className="p-4">
            <h4 className="text-sm font-bold mb-1 flex items-center gap-2">
              <CandlestickChart className="w-4 h-4 text-amber-400" />
              {isAr
                ? 'مخطط الشموع اليابانية للمبيعات اليومية بالساعة (Intraday Hourly Sales OHLC)'
                : 'Retail Intraday Hourly Sales Candlesticks (Open / High / Low / Close + Daily Total)'}
            </h4>
            <p className="text-[11px] text-slate-400 mb-3">
              {isAr
                ? 'الافتتاح (O) = مبيعات أول ساعة عمل نشطة • الأعلى (H) = ذروة مبيعات الساعة • الأدنى (L) = أقل ساعة نشطة • الإغلاق (C) = آخر ساعة عمل نشطة'
                : 'Open = First active hour net sales • High = Peak hourly sales • Low = Lowest active hour • Close = Last active hour net sales'}
            </p>
            <IntradayCandlestickChart
              candles={sales.intradayCandlesticks}
              currency={sales.currency}
              language={settings.language}
            />
          </AppCard>

          {/* Hourly & Weekday Distributions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AppCard className="p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                {isAr ? 'توزيع المبيعات حسب ساعات اليوم' : 'Sales by Hour of Day'}
              </h4>
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {sales.hourlyDistribution
                  .filter((h) => h.transactionCount > 0)
                  .map((h) => {
                    const maxHrNet = Math.max(
                      1,
                      ...sales.hourlyDistribution.map((x) => x.netSales)
                    );
                    const pct = Math.round((h.netSales / maxHrNet) * 100);
                    return (
                      <div key={h.hour} className="text-xs space-y-1">
                        <div className="flex justify-between font-mono">
                          <span>
                            {h.label} ({h.transactionCount} {isAr ? 'طلب' : 'orders'})
                          </span>
                          <span className="font-bold text-emerald-400">
                            {formatCurrency(h.netSales, sales.currency, settings.language)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-sky-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </AppCard>

            <AppCard className="p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                {isAr ? 'توزيع المبيعات حسب أيام الأسبوع' : 'Sales by Day of Week'}
              </h4>
              <div className="space-y-2">
                {sales.weekdayDistribution.map((w) => {
                  const maxDayNet = Math.max(
                    1,
                    ...sales.weekdayDistribution.map((x) => x.netSales)
                  );
                  const pct = Math.round((w.netSales / maxDayNet) * 100);
                  return (
                    <div key={w.dayOfWeek} className="text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="font-semibold">
                          {isAr ? w.labelAr : w.labelEn}{' '}
                          <span className="text-slate-400 font-mono">
                            ({w.transactionCount})
                          </span>
                        </span>
                        <span className="font-mono font-bold text-amber-400">
                          {formatCurrency(w.netSales, sales.currency, settings.language)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </AppCard>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: FINANCIAL & ACCOUNTING ANALYTICS (P&L, CASH FLOW, FX)          */}
      {/* ===================================================================== */}
      {activeTab === 'financial' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Income Statement (P&L) */}
            <AppCard className="p-4">
              <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                {isAr
                  ? 'قائمة الدخل والأرباح والخسائر (P&L Statement)'
                  : 'Income Statement (Profit & Loss Reconciliation)'}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                  <span className="text-slate-400">
                    {isAr
                      ? 'إجمالي المبيعات (قبل الخصم والضريبة)'
                      : 'Gross Sales (Pre-Discount)'}
                  </span>
                  <span className="font-mono font-bold">
                    {formatCurrency(
                      financial.profitAndLoss.grossSalesPreDiscount,
                      sales.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-amber-400">
                  <span>{isAr ? '(-) الخصومات الممنوحة' : '(-) Sales Discounts'}</span>
                  <span className="font-mono">
                    -
                    {formatCurrency(
                      financial.profitAndLoss.salesDiscounts,
                      sales.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-rose-300">
                  <span>
                    {isAr
                      ? '(-) مرتجعات المبيعات الفعلية'
                      : '(-) Merchandise Returns (Deducted)'}
                  </span>
                  <span className="font-mono">
                    -
                    {formatCurrency(
                      financial.profitAndLoss.merchandiseReturnsNet,
                      sales.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/60 font-bold text-emerald-400">
                  <span>
                    {isAr ? '(=) صافي إيرادات المبيعات' : '(=) Net Sales Revenue'}
                  </span>
                  <span className="font-mono">
                    {formatCurrency(
                      financial.profitAndLoss.netSalesRevenue,
                      sales.currency,
                      settings.language
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-rose-400">
                  <span>
                    {isAr ? '(-) تكلفة البضاعة المباعة (COGS)' : '(-) Cost of Goods Sold (COGS)'}
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[9px] text-amber-300 font-mono">
                      {financial.profitAndLoss.cogsDataQuality.replace(/_/g, ' ')}
                    </span>
                  </span>
                  <span className="font-mono">
                    {financial.profitAndLoss.costOfGoodsSold !== null
                      ? `-${formatNullableCurrency(financial.profitAndLoss.costOfGoodsSold)}`
                      : formatNullableCurrency(null)}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-800 font-bold text-amber-300 bg-amber-500/5 px-2 rounded">
                  <span>
                    {isAr ? '(=) مجمل الربح (Gross Profit)' : '(=) Gross Profit'} (
                    {financial.profitAndLoss.grossProfitMarginPercent !== null
                      ? `${financial.profitAndLoss.grossProfitMarginPercent}%`
                      : '—'}
                    )
                  </span>
                  <span className="font-mono">
                    {formatNullableCurrency(financial.profitAndLoss.grossProfit)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/60 text-rose-300">
                  <span>
                    {isAr
                      ? '(-) مصروفات التلف والفاقد المسجلة'
                      : '(-) Recorded Inventory Shrinkage / Damage'}
                  </span>
                  <span className="font-mono">
                    {financial.profitAndLoss.recordedShrinkageAndDamageExpense !== null
                      ? `-${formatNullableCurrency(
                          financial.profitAndLoss.recordedShrinkageAndDamageExpense
                        )}`
                      : formatNullableCurrency(null)}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-800 font-bold text-emerald-300 bg-emerald-500/5 px-2 rounded">
                  <span>
                    {isAr
                      ? '(=) الربح بعد الفاقد المسجل'
                      : '(=) Profit After Recorded Shrinkage'}{' '}
                    (
                    {financial.profitAndLoss.profitAfterShrinkageMarginPercent !== null
                      ? `${financial.profitAndLoss.profitAfterShrinkageMarginPercent}%`
                      : '—'}
                    )
                  </span>
                  <span className="font-mono">
                    {formatNullableCurrency(
                      financial.profitAndLoss.profitAfterRecordedShrinkage
                    )}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400">
                  <Info className="w-3.5 h-3.5 inline-block mr-1 text-sky-400" />
                  {isAr
                    ? financial.profitAndLoss.generalOperatingExpensesNoteAr
                    : financial.profitAndLoss.generalOperatingExpensesNoteEn}
                </div>
                <div className="flex justify-between py-2.5 px-2.5 rounded-lg bg-slate-900/90 border border-slate-800 font-bold text-slate-300 text-xs">
                  <span>
                    {isAr
                      ? '(=) صافي الربح التشغيلي (يتطلب مصروفات تشغيلية)'
                      : '(=) Net Operating Profit (Requires Operating Expenses)'}
                  </span>
                  <span className="font-mono text-amber-400">
                    {financial.profitAndLoss.netOperatingProfit !== null
                      ? formatNullableCurrency(financial.profitAndLoss.netOperatingProfit)
                      : isAr
                      ? 'غير متاح (المصروفات غير مسجلة)'
                      : 'Unavailable (Missing OpEx)'}
                  </span>
                </div>
              </div>
            </AppCard>

            {/* Cash Flow, Working Capital, Break-Even & FX Valuation Sensitivity */}
            <div className="space-y-4">
              <AppCard className="p-4">
                <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-sky-400" />
                  {isAr
                    ? 'التدفقات النقدية ورأس المال العامل ونقطة التعادل'
                    : 'Cash Flow, Working Capital & Break-Even Analysis'}
                </h4>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">
                      {isAr ? 'مقبوضات نقدية عند البيع' : 'Checkout Cash Inflows'}
                    </div>
                    <div className="font-mono font-bold text-emerald-400 mt-0.5">
                      {formatCurrency(
                        financial.cashFlowAndWorkingCapital.cashInflowsFromSalesAtCheckout,
                        sales.currency,
                        settings.language
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">
                      {isAr ? 'تحصيل دفعات الديون' : 'Debt Settlement Inflows'}
                    </div>
                    <div className="font-mono font-bold text-sky-400 mt-0.5">
                      {formatCurrency(
                        financial.cashFlowAndWorkingCapital.cashInflowsFromDebtSettlements,
                        sales.currency,
                        settings.language
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">
                      {isAr ? 'مدفوعات توريد البضاعة' : 'Restock Purchase Outflows'}
                    </div>
                    <div className="font-mono font-bold text-rose-400 mt-0.5">
                      {formatNullableCurrency(
                        financial.cashFlowAndWorkingCapital.cashOutflowsForRestockPurchases
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">
                      {isAr ? 'صافي التدفق النقدي' : 'Net Cash Flow'}
                    </div>
                    <div className="font-mono font-bold text-amber-400 mt-0.5">
                      {formatNullableCurrency(
                        financial.cashFlowAndWorkingCapital.netCashFlow
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-2.5 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-400">
                    {isAr
                      ? 'تحليل نقطة التعادل المحاسبية (Break-Even):'
                      : 'Accounting Break-Even Status:'}
                  </span>
                  <span className="font-mono font-bold text-amber-300">
                    {financial.breakEvenAnalysis.breakEvenSalesRevenue !== null
                      ? formatNullableCurrency(
                          financial.breakEvenAnalysis.breakEvenSalesRevenue
                        )
                      : isAr
                      ? 'غير متاح (يتطلب التكاليف التشغيلية الثابتة)'
                      : 'Unavailable (Requires Fixed Operating Costs)'}
                  </span>
                </div>
              </AppCard>

              <AppCard className="p-4">
                <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-amber-400" />
                  {isAr
                    ? 'تحليل حساسية سعر الصرف وحفظ القوة الشرائية'
                    : 'Multi-Currency FX Valuation & Purchasing Power Analysis'}
                </h4>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      {isAr ? 'بسعر وقت البيع (تاريخي)' : 'At Sale-Time Rate'}
                    </div>
                    <div className="font-mono font-bold mt-1">
                      {formatCurrency(
                        financial.fxSensitivityAndValuation.netSalesAtHistoricalRate,
                        sales.currency,
                        settings.language
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      {isAr ? 'مؤشر بالدولار (استبدال)' : 'USD-Indexed Value'}
                    </div>
                    <div className="font-mono font-bold text-amber-400 mt-1">
                      {formatCurrency(
                        financial.fxSensitivityAndValuation.netSalesAtUsdIndexedRate,
                        sales.currency,
                        settings.language
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] text-slate-400">
                      {isAr ? 'فارق ترجمة العملة' : 'FX Translation Delta'}
                    </div>
                    <div className="font-mono font-bold text-sky-400 mt-1">
                      {formatCurrency(
                        financial.fxSensitivityAndValuation.unrealizedFxTranslationDelta,
                        sales.currency,
                        settings.language
                      )}
                    </div>
                  </div>
                </div>
              </AppCard>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: INVENTORY, ABC PARETO & REORDER ENGINE                         */}
      {/* ===================================================================== */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Controls for ABC Basis & Reorder Lead Time */}
          <AppCard className="p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  {isAr ? 'أساس تصنيف ABC باريتو' : 'ABC Classification Basis'}
                </label>
                <select
                  value={abcBasis}
                  onChange={(e) => setAbcBasis(e.target.value as ABCClassificationBasis)}
                  className={selectClass}
                >
                  <option value="revenue">{isAr ? 'صافي الإيرادات' : 'Net Revenue'}</option>
                  <option value="gross_profit">{isAr ? 'مجمل الربح' : 'Gross Profit'}</option>
                  <option value="consumption_value">
                    {isAr ? 'قيمة الاستهلاك (COGS)' : 'Consumption Value (COGS)'}
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  {isAr ? 'زمن التوريد المفترض (أيام)' : 'Supplier Lead Time (Days)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={leadTimeDays}
                  onChange={(e) => setLeadTimeDays(Math.max(1, Number(e.target.value) || 3))}
                  className={`w-20 font-mono ${selectClass}`}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  {isAr ? 'أيام مخزون الأمان' : 'Safety Stock (Days)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={safetyStockDays}
                  onChange={(e) => setSafetyStockDays(Math.max(1, Number(e.target.value) || 2))}
                  className={`w-20 font-mono ${selectClass}`}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
                A: {inventory.abcSummary.classA.count} SKUs (
                {inventory.abcSummary.classA.valueSharePercent}%)
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold">
                B: {inventory.abcSummary.classB.count} SKUs (
                {inventory.abcSummary.classB.valueSharePercent}%)
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-bold">
                C: {inventory.abcSummary.classC.count} SKUs (
                {inventory.abcSummary.classC.valueSharePercent}%)
              </span>
            </div>
          </AppCard>

          <AppCard className="p-4">
            <h4 className="text-sm font-bold mb-2">
              {isAr
                ? 'منحنى باريتو لتصنيف المخزون (ABC Pareto Analysis)'
                : 'ABC Pareto Cumulative Value Distribution'}
            </h4>
            <AbcParetoChart products={inventory.products} language={settings.language} />
          </AppCard>

          {/* Actionable Reorder & Inventory Velocity Table */}
          <AppCard className="p-4 overflow-x-auto">
            <h4 className="text-sm font-bold mb-3">
              {isAr
                ? 'جدول دوران المخزون وتوصيات إعادة الطلب (خاضع لاعتماد الإدارة)'
                : 'SKU Stock Turnover, Days on Hand (DOH) & Reorder Recommendations'}
            </h4>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2 px-2">{isAr ? 'المنتج' : 'Product'}</th>
                  <th className="py-2 px-2">ABC</th>
                  <th className="py-2 px-2">{isAr ? 'الرصيد' : 'Stock'}</th>
                  <th className="py-2 px-2">{isAr ? 'السحب/يوم' : 'Daily Demand'}</th>
                  <th className="py-2 px-2">DOH</th>
                  <th className="py-2 px-2">{isAr ? 'السرعة' : 'Velocity'}</th>
                  <th className="py-2 px-2">{isAr ? 'نقطة الطلب' : 'Reorder Pt'}</th>
                  <th className="py-2 px-2">{isAr ? 'الكمية المقترحة' : 'Rec. Order'}</th>
                  <th className="py-2 px-2">{isAr ? 'التكلفة التقديرية' : 'Est. Cost'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {inventory.products.map((item) => (
                  <tr key={item.productId} className="hover:bg-slate-800/30">
                    <td className="py-2 px-2 font-sans font-semibold">
                      {isAr ? item.nameAr || item.name : item.name}
                      <div className="text-[10px] text-slate-400 font-mono">{item.sku}</div>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                          item.abcClass === 'A'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : item.abcClass === 'B'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {item.abcClass}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-bold">
                      {item.currentStock}{' '}
                      <span className="text-[10px] text-slate-500">
                        (min {item.minStockAlert})
                      </span>
                    </td>
                    <td className="py-2 px-2">{item.averageDailyDemand}/d</td>
                    <td className="py-2 px-2">
                      {item.daysOfInventoryOnHand !== null
                        ? `${item.daysOfInventoryOnHand}d`
                        : '∞'}
                    </td>
                    <td className="py-2 px-2 font-sans text-[11px]">
                      {item.movementVelocityClass.replace('_', ' ')}
                    </td>
                    <td className="py-2 px-2">
                      {item.reorderRecommendation.reorderPointUnits}
                    </td>
                    <td className="py-2 px-2">
                      {item.reorderRecommendation.shouldReorder ? (
                        <span className="text-amber-400 font-bold">
                          +{item.reorderRecommendation.recommendedOrderQuantity}
                        </span>
                      ) : (
                        <span className="text-slate-500">0</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      {item.reorderRecommendation.shouldReorder
                        ? formatNullableCurrency(
                            item.reorderRecommendation.estimatedOrderCost
                          )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 5: PRODUCTS & CATEGORIES                                          */}
      {/* ===================================================================== */}
      {activeTab === 'products' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <AppCard className="p-4 lg:col-span-1">
            <h4 className="text-sm font-bold mb-3">
              {isAr ? 'ربحية الفئات (Categories)' : 'Category Profitability Breakdown'}
            </h4>
            <div className="space-y-2.5">
              {sales.byCategory.map((cat) => (
                <div
                  key={cat.id}
                  className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                >
                  <div className="flex justify-between font-bold">
                    <span>{isAr ? cat.nameAr || cat.name : cat.name}</span>
                    <span className="font-mono text-emerald-400">
                      {formatCurrency(cat.netSales, sales.currency, settings.language)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>
                      {cat.unitsSold} {isAr ? 'وحدة' : 'units'} ({cat.shareOfNetSalesPercent}%)
                    </span>
                    <span>
                      {isAr ? 'الربح:' : 'Profit:'}{' '}
                      {formatNullableCurrency(cat.grossProfit)} (
                      {cat.grossMarginPercent ?? '—'}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </AppCard>

          <AppCard className="p-4 lg:col-span-2 overflow-x-auto">
            <h4 className="text-sm font-bold mb-3">
              {isAr ? 'أداء وربحية المنتجات التفصيلية' : 'Product Performance & Margin Matrix'}
            </h4>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-2">{isAr ? 'المنتج' : 'Product'}</th>
                  <th className="py-2 px-2">{isAr ? 'الوحدات' : 'Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'صافي المبيعات' : 'Net Sales'}</th>
                  <th className="py-2 px-2">COGS</th>
                  <th className="py-2 px-2">{isAr ? 'مجمل الربح' : 'Gross Profit'}</th>
                  <th className="py-2 px-2">{isAr ? 'الهامش %' : 'Margin %'}</th>
                  <th className="py-2 px-2">{isAr ? 'الحصة %' : 'Share %'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {sales.byProduct.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 px-2 font-sans font-semibold">
                      {isAr ? p.nameAr || p.name : p.name}
                    </td>
                    <td className="py-2 px-2">{p.unitsSold}</td>
                    <td className="py-2 px-2 text-emerald-400 font-bold">
                      {formatCurrency(p.netSales, sales.currency, settings.language)}
                    </td>
                    <td className="py-2 px-2 text-rose-300">
                      {formatNullableCurrency(p.cogs)}
                    </td>
                    <td className="py-2 px-2 text-amber-400 font-bold">
                      {formatNullableCurrency(p.grossProfit)}
                    </td>
                    <td className="py-2 px-2">
                      {p.grossMarginPercent !== null ? `${p.grossMarginPercent}%` : '—'}
                    </td>
                    <td className="py-2 px-2">{p.shareOfNetSalesPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 6: CUSTOMERS & CREDIT EXPOSURE                                    */}
      {/* ===================================================================== */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'معدل تكرار الشراء' : 'Repeat Purchase Rate'}
              </div>
              <div className="text-lg font-black font-mono text-emerald-400 mt-1">
                {customerAnalytics.summary.repeatPurchaseRatePercent}%
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {customerAnalytics.summary.repeatCustomersCount} /{' '}
                {customerAnalytics.summary.totalRegisteredCustomers}{' '}
                {isAr ? 'عملاء مسجلين' : 'registered'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'حصة مبيعات العملاء المسجلين' : 'Registered Customer Share'}
              </div>
              <div className="text-lg font-black font-mono text-sky-400 mt-1">
                {customerAnalytics.summary.registeredRevenueSharePercent}%
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {customerAnalytics.summary.walkInTransactionsCount}{' '}
                {isAr ? 'فاتورة عميل عابر' : 'walk-in orders'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'إجمالي مديونيات العملاء' : 'Total Customer Debt (AR)'}
              </div>
              <div className="text-lg font-black font-mono text-rose-400 mt-1">
                {formatCurrency(
                  customerAnalytics.summary.totalCustomerDebt,
                  sales.currency,
                  settings.language
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {customerAnalytics.summary.customersWithDebtCount}{' '}
                {isAr ? 'عملاء بذمم مفتوحة' : 'customers with open debt'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'متوسط إنفاق العميل النشط' : 'Avg Active Customer Spend'}
              </div>
              <div className="text-lg font-black font-mono text-amber-400 mt-1">
                {formatCurrency(
                  customerAnalytics.summary.averageCustomerSpend,
                  sales.currency,
                  settings.language
                )}
              </div>
            </AppCard>
          </div>

          <AppCard className="p-4 overflow-x-auto">
            <h4 className="text-sm font-bold mb-3">
              {isAr
                ? 'تصنيف العملاء والمديونيات (RFM & Credit Segmentation)'
                : 'Customer Segmentation, Spend & Credit Exposure'}
            </h4>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-2">{isAr ? 'العميل' : 'Customer'}</th>
                  <th className="py-2 px-2">{isAr ? 'التصنيف' : 'Segment'}</th>
                  <th className="py-2 px-2">{isAr ? 'طلبات الفترة' : 'Period Orders'}</th>
                  <th className="py-2 px-2">{isAr ? 'مشتريات الفترة' : 'Period Spend'}</th>
                  <th className="py-2 px-2">{isAr ? 'إجمالي المشتريات' : 'Lifetime Spend'}</th>
                  <th className="py-2 px-2">{isAr ? 'المديونية القائمة' : 'Open Debt'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {customerAnalytics.topCustomers.map((c) => (
                  <tr key={c.customerId}>
                    <td className="py-2 px-2 font-sans font-semibold">
                      {c.name}
                      <div className="text-[10px] text-slate-400 font-mono">{c.phone}</div>
                    </td>
                    <td className="py-2 px-2 font-sans">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 text-[11px] font-semibold">
                        {isAr ? c.segmentLabelAr : c.segmentLabelEn}
                      </span>
                    </td>
                    <td className="py-2 px-2">{c.periodPurchaseCount}</td>
                    <td className="py-2 px-2 text-emerald-400 font-bold">
                      {formatCurrency(c.periodBilledTotal, sales.currency, settings.language)}
                    </td>
                    <td className="py-2 px-2">
                      {formatCurrency(c.lifetimeSpend, sales.currency, settings.language)}
                    </td>
                    <td className="py-2 px-2 text-rose-400 font-bold">
                      {c.outstandingDebt > 0
                        ? formatCurrency(c.outstandingDebt, sales.currency, settings.language)
                        : '0.00'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 7: BRANCHES & CASHIERS                                            */}
      {/* ===================================================================== */}
      {activeTab === 'branches' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AppCard className="p-4">
            <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-400" />
              {isAr ? 'مقارنة أداء الفروع' : 'Multi-Branch Performance Ranking'}
            </h4>
            <div className="space-y-3">
              {branchAnalytics.branches.map((b) => (
                <div
                  key={b.branchId}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">
                      #{b.rank} {isAr ? b.branchNameAr : b.branchName}{' '}
                      <span className="text-[10px] font-mono text-slate-400">({b.branchCode})</span>
                    </span>
                    <span className="font-mono font-black text-emerald-400">
                      {formatCurrency(b.netSales, sales.currency, settings.language)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-slate-300">
                    <div>
                      {isAr ? 'الربح:' : 'Profit:'}{' '}
                      {formatNullableCurrency(b.grossProfit)} (
                      {b.grossMarginPercent ?? '—'}%)
                    </div>
                    <div>
                      {isAr ? 'الفواتير:' : 'Orders:'} {b.transactionCount}
                    </div>
                    <div>
                      {isAr ? 'التحصيل:' : 'Collection:'} {b.collectionRatePercent}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </AppCard>

          <AppCard className="p-4">
            <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-400" />
              {isAr ? 'أداء الكاشير ونقاط البيع' : 'Employee & POS Terminal Performance'}
            </h4>
            <div className="space-y-2.5">
              {sales.byEmployee.map((emp) => (
                <div
                  key={emp.id}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold">{isAr ? emp.nameAr || emp.name : emp.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {emp.transactionCount} {isAr ? 'فاتورة' : 'orders'} • {emp.unitsSold}{' '}
                      {isAr ? 'وحدة' : 'units'}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-emerald-400">
                      {formatCurrency(emp.netSales, sales.currency, settings.language)}
                    </div>
                    <div className="text-[10px] text-amber-400">
                      {isAr ? 'الربح:' : 'Profit:'}{' '}
                      {formatNullableCurrency(emp.grossProfit)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 8: TECHNICAL ANALYSIS INDICATORS                                  */}
      {/* ===================================================================== */}
      {activeTab === 'technical' && (
        <div className="space-y-4">
          <AppCard className="p-4">
            <h4 className="text-sm font-bold mb-2">
              {isAr
                ? 'المؤشرات الفنية للسلسلة الزمنية للمبيعات (SMA / EMA / Trendline / Support & Resistance)'
                : 'Retail Time-Series Technical Analysis (SMA / EMA / Regression Trend / Support & Resistance)'}
            </h4>
            <TechnicalTrendOverlayChart
              series={technicalIndicators.series}
              supportFloor={technicalIndicators.latestValues.supportFloor}
              resistanceCeiling={technicalIndicators.latestValues.resistanceCeiling}
              currency={sales.currency}
              language={settings.language}
            />
          </AppCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {technicalIndicators.signals.map((sig) => (
              <AppCard key={sig.indicator} className="p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400">
                    {isAr ? sig.nameAr : sig.nameEn}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-200">
                    {sig.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isAr ? sig.interpretationAr : sig.interpretationEn}
                </p>
                <div className="text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/50 flex justify-between">
                  <span>{sig.referenceThreshold}</span>
                  <span>
                    {isAr ? 'نقاط البيانات:' : 'Points:'} {sig.dataPointsUsed} /{' '}
                    {sig.minimumPointsRequired}
                  </span>
                </div>
              </AppCard>
            ))}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 9: STATISTICAL FORECASTING ENGINE                                 */}
      {/* ===================================================================== */}
      {activeTab === 'forecasts' && (
        <div className="space-y-4">
          <AppCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h4 className="text-sm font-bold">
                  {isAr
                    ? `محرك التنبؤ الإحصائي واختبار الدقة العكسي (${forecasts.horizonDays} يوم)`
                    : `Statistical Forecasting Engine & Backtest Evaluation (${forecasts.horizonDays}-Day Horizon)`}
                </h4>
                <p className="text-xs text-slate-400">
                  {isAr ? forecasts.selectionReasonAr : forecasts.selectionReasonEn}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {([7, 30, 90] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForecastHorizonDays(h)}
                    data-testid={`bi-forecast-horizon-${h}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono ${
                      forecastHorizonDays === h
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-900 border border-slate-800 text-slate-300'
                    }`}
                  >
                    {h} {isAr ? 'يوم' : 'Days'}
                  </button>
                ))}
              </div>
            </div>

            <StatisticalForecastFanChart
              series={forecasts.revenueSeries}
              currency={sales.currency}
              language={settings.language}
            />
          </AppCard>

          {/* Backtest Model Comparison Leaderboard */}
          <AppCard className="p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              {isAr
                ? 'نتائج الاختبار العكسي الزمني للنماذج الإحصائية (Chronological Train/Test Backtesting)'
                : 'Chronological Out-of-Sample Backtest Leaderboard (MAE & WAPE %)'}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
              {forecasts.backtestEvaluations.map((ev) => (
                <div
                  key={ev.model}
                  className={`p-3 rounded-xl border text-xs ${
                    ev.isSelectedWinner
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold">
                      {isAr ? ev.modelNameAr : ev.modelNameEn}
                    </span>
                    {ev.isSelectedWinner && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-slate-300 mt-1">
                    WAPE: <strong className="text-amber-300">{ev.wapePercent}%</strong> • MAE:{' '}
                    <strong>{ev.mae}</strong>
                  </div>
                  <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                    Bias: {ev.biasPercent > 0 ? `+${ev.biasPercent}%` : `${ev.biasPercent}%`} •
                    Cov80: {ev.empiricalCoverage80Percent ?? 100}%
                  </div>
                </div>
              ))}
            </div>
          </AppCard>

          {/* Phase 10 (Part 5): Baseline Sales-Only vs. Latent-Demand Adjusted Forecast Comparison */}
          {forecasts.predictiveDemandComparison && (
            <AppCard
              className="p-4 border-amber-500/30 bg-amber-950/10 space-y-2.5"
              data-testid="bi-predictive-demand-comparison"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {isAr
                    ? 'مقارنة التنبؤ القياسي (المبيعات فقط) مقابل التنبؤ المعدل بالطلب الكامن (مع تعويض نفاد المخزون)'
                    : 'Baseline Sales-Only vs. Stockout-Compensated Latent Demand Forecast Comparison'}
                </h4>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-400">
                  {isAr ? 'أصناف تم تعويض نفادها:' : 'Censoring-Compensated SKUs:'}{' '}
                  {forecasts.predictiveDemandComparison.censoringCompensatedProductsCount}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {isAr
                  ? forecasts.predictiveDemandComparison.comparisonNoteAr
                  : forecasts.predictiveDemandComparison.comparisonNoteEn}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs font-mono pt-1">
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">
                    {isAr ? 'خطأ WAPE (مبيعات فقط)' : 'Baseline Sales WAPE'}
                  </div>
                  <div className="font-bold text-slate-300 mt-0.5">
                    {forecasts.predictiveDemandComparison.baselineSalesOnlyWapePercent}%
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">
                    {isAr ? 'خطأ WAPE (الطلب الكامن)' : 'Latent-Adjusted WAPE'}
                  </div>
                  <div className="font-bold text-emerald-400 mt-0.5">
                    {forecasts.predictiveDemandComparison.latentDemandAdjustedWapePercent}%
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">
                    {isAr ? 'متوسط الخطأ MAE (قياسي)' : 'Baseline Sales MAE'}
                  </div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    {forecasts.predictiveDemandComparison.baselineSalesOnlyMae}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">
                    {isAr ? 'متوسط الخطأ MAE (كامن)' : 'Latent-Adjusted MAE'}
                  </div>
                  <div className="font-bold text-amber-400 mt-0.5">
                    {forecasts.predictiveDemandComparison.latentDemandAdjustedMae}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">
                    {isAr ? 'إشارات الطلب غير المتوفر' : 'Unmet Demand Signals'}
                  </div>
                  <div className="font-bold text-rose-400 mt-0.5">
                    {forecasts.predictiveDemandComparison.unmetDemandSignalsCount}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">
                    {isAr ? 'تحسن دقة التنبؤ' : 'Accuracy Improved'}
                  </div>
                  <div className="font-bold text-emerald-400 mt-0.5">
                    {forecasts.predictiveDemandComparison.improvementDemonstrated
                      ? isAr
                        ? 'محقق (نعم)'
                        : 'VERIFIED (YES)'
                      : isAr
                      ? 'متساوٍ'
                      : 'NEUTRAL'}
                  </div>
                </div>
              </div>
            </AppCard>
          )}

          {/* Product-Level Demand & Stock Depletion Forecasts */}
          <AppCard className="p-4 overflow-x-auto">
            <h4 className="text-sm font-bold mb-3">
              {isAr
                ? `توقعات الطلب الفعلي والكامن ونفاد المخزون على مستوى الصنف (${forecasts.horizonDays} يوم)`
                : `Product-Level Sales vs. Latent Demand & Stock Depletion Forecast (${forecasts.horizonDays} Days)`}
            </h4>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-2">{isAr ? 'المنتج' : 'Product'}</th>
                  <th className="py-2 px-2">{isAr ? 'الرصيد الحالي' : 'Current Stock'}</th>
                  <th className="py-2 px-2">{isAr ? 'توقع المبيعات' : 'Sales Forecast'}</th>
                  <th className="py-2 px-2">{isAr ? 'طلبات غير متوفرة' : 'Unmet Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'الطلب الكامن المتوقع' : 'Latent Forecast'}</th>
                  <th className="py-2 px-2">{isAr ? 'الإيراد المتوقع' : 'Forecast Revenue'}</th>
                  <th className="py-2 px-2">
                    {isAr ? 'تاريخ النفاد المتوقع' : 'Est. Depletion Date'}
                  </th>
                  <th className="py-2 px-2">
                    {isAr ? 'كمية الشراء المقترحة' : 'Suggested Reorder'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {forecasts.productDemandForecasts.map((pf) => (
                  <tr key={pf.productId}>
                    <td className="py-2 px-2 font-sans font-semibold">
                      {isAr ? pf.nameAr || pf.name : pf.name}
                      {pf.stockoutDaysObservedInWindow && pf.stockoutDaysObservedInWindow > 0 ? (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 text-[10px] font-mono">
                          {isAr
                            ? `${pf.stockoutDaysObservedInWindow} يوم نفاد`
                            : `${pf.stockoutDaysObservedInWindow}d stockout`}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 px-2">{pf.currentStock}</td>
                    <td className="py-2 px-2 text-sky-400">
                      {pf.forecastedTotalUnits} ({pf.forecastedDailyDemand}/d)
                    </td>
                    <td className="py-2 px-2 text-rose-400">
                      {pf.observedUnmetDemandUnits || 0}
                    </td>
                    <td className="py-2 px-2 text-amber-400 font-bold">
                      {pf.forecastedLatentTotalUnits ?? pf.forecastedTotalUnits} (
                      {pf.estimatedLatentDailyDemand ?? pf.forecastedDailyDemand}/d)
                    </td>
                    <td className="py-2 px-2 text-emerald-400">
                      {formatCurrency(pf.forecastedRevenue, sales.currency, settings.language)}
                    </td>
                    <td className="py-2 px-2">
                      {pf.estimatedDepletionDate
                        ? `${pf.estimatedDepletionDate} (${pf.estimatedDaysUntilDepletion}d)`
                        : '—'}
                    </td>
                    <td className="py-2 px-2 font-bold text-sky-400">
                      {pf.recommendedReorderUnits > 0 ? `+${pf.recommendedReorderUnits}` : '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PHASE 10 TAB A: CUSTOMER DEMAND INTELLIGENCE & LOST SALES ANALYTICS   */}
      {/* ===================================================================== */}
      {activeTab === 'unmet_demand' && (
        <div className="space-y-4" data-testid="bi-unmet-demand-view">
          {/* Header Banner + Fast Capture Button */}
          <AppCard className="p-4 border-rose-500/30 bg-rose-950/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <PackageX className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {isAr
                    ? 'ذكاء طلبات العملاء غير المتوفرة وتحليل المبيعات المفقودة التحفظي'
                    : 'Customer Demand Intelligence (Unmet Demand & Conservative Lost Sales Analytics)'}
                </h3>
                <p className="text-xs text-slate-400">
                  {isAr
                    ? 'يتتبع المنتجات التي يطلبها العملاء عند نفاد المخزون أو انتهاء الصلاحية أو عدم توفر الصنف بالمتجر — منفصل تماماً عن المبيعات الفعلية.'
                    : 'Tracks products requested by customers when out of stock, expired, or unregistered — strictly separated from completed sales.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="unmet-tab-record-btn"
              onClick={() =>
                openUnmetDemandModal({
                  sourceScreen: 'analytics',
                  branchId: branchId !== 'all' ? branchId : undefined,
                })
              }
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-4 h-4" />
              {isAr ? 'تسجيل طلب عميل غير متوفر' : 'Record Unmet Customer Request'}
            </button>
          </AppCard>

          {/* Primary KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'إجمالي استفسارات الطلب' : 'Total Inquiries'}
              </div>
              <div
                className="text-lg font-black font-mono text-rose-400 mt-1"
                data-testid="unmet-kpi-total-inquiries"
              >
                {unmetDemand.summary.totalInquiries}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {unmetDemand.summary.distinctProductsRequested}{' '}
                {isAr ? 'منتجات مختلفة مطلوبة' : 'distinct items requested'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'إجمالي الوحدات المطلوبة' : 'Requested Base Units'}
              </div>
              <div
                className="text-lg font-black font-mono text-amber-400 mt-1"
                data-testid="unmet-kpi-requested-units"
              >
                {unmetDemand.summary.totalRequestedBaseUnits}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {unmetDemand.summary.confirmedIntentBaseUnits}{' '}
                {isAr ? 'وحدة بنية شراء مؤكدة' : 'units with confirmed intent'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'الإيراد المفقود التقديري (تحفظي)' : 'Conservative Est. Lost Revenue'}
              </div>
              <div
                className="text-lg font-black font-mono text-rose-300 mt-1"
                data-testid="unmet-kpi-lost-revenue"
              >
                {unmetDemand.lostSalesEstimation.status === 'ESTIMATED' &&
                unmetDemand.lostSalesEstimation.estimatedLostRevenue !== null
                  ? formatCurrency(
                      unmetDemand.lostSalesEstimation.estimatedLostRevenue,
                      sales.currency,
                      settings.language
                    )
                  : isAr
                  ? 'بيانات تسعير غير كافية'
                  : 'INSUFFICIENT_DATA'}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'درجة الثقة:' : 'Confidence:'}{' '}
                <strong className="text-amber-300">
                  {unmetDemand.lostSalesEstimation.confidenceLevel}
                </strong>{' '}
                ({unmetDemand.lostSalesEstimation.dataCoveragePercent}%{' '}
                {isAr ? 'مسعّر' : 'priced'})
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'الربح المفقود التقديري' : 'Conservative Est. Lost Profit'}
              </div>
              <div className="text-lg font-black font-mono text-amber-300 mt-1">
                {formatNullableCurrency(
                  unmetDemand.lostSalesEstimation.estimatedLostGrossProfit
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'وحدات موزونة بعد خصم التكرار:' : 'Weighted Deduped Units:'}{' '}
                {unmetDemand.lostSalesEstimation.dedupedConfirmedWeightedUnits ?? 0}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'كفاءة تلبية الطلب الكلي' : 'Demand Capture Efficiency'}
              </div>
              <div className="text-lg font-black font-mono text-emerald-400 mt-1">
                {unmetDemand.summary.demandCaptureEfficiencyPercent !== null
                  ? `${unmetDemand.summary.demandCaptureEfficiencyPercent}%`
                  : '—'}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {unmetDemand.summary.actualUnitsSoldInPeriod}{' '}
                {isAr ? 'مباع فعلياً من' : 'sold of'}{' '}
                {unmetDemand.summary.observedTotalDemandUnits}{' '}
                {isAr ? 'طلب كلي' : 'total demand'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'منتجات غير مسجلة / نفاد متكرر' : 'Unregistered / Repeat Stockouts'}
              </div>
              <div className="text-lg font-black font-mono text-violet-400 mt-1">
                {unmetDemand.summary.unregisteredProductInquiries} /{' '}
                <span className="text-rose-400">
                  {unmetDemand.summary.repeatedStockoutProductsCount}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr
                  ? 'طلبات غير مسجلة / أصناف بنفاد متكرر'
                  : 'Unregistered inquiries / repeat stockouts'}
              </div>
            </AppCard>
          </div>

          {/* Conservative Lost Sales Methodology & Statistical Honesty Disclosure */}
          <AppCard className="p-4 border-amber-500/20 bg-slate-900/60 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                {isAr
                  ? 'منهجية تقدير المبيعات المفقودة التحفظية (عدم تضخيم الطلب)'
                  : 'Conservative Lost Sales Estimation Methodology & Anti-Overstatement Safeguards'}
              </h4>
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-300">
                Status: {unmetDemand.lostSalesEstimation.status} • Sample:{' '}
                {unmetDemand.lostSalesEstimation.sampleSizeInquiries}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isAr
                ? unmetDemand.lostSalesEstimation.methodologyAr
                : unmetDemand.lostSalesEstimation.methodologyEn}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-[11px] text-slate-400">
              <div>
                <strong className="text-slate-200 block mb-1">
                  {isAr ? 'الافتراضات المحاسبية:' : 'Model Assumptions:'}
                </strong>
                <ul className="list-disc list-inside space-y-0.5">
                  {(isAr
                    ? unmetDemand.lostSalesEstimation.assumptionsAr
                    : unmetDemand.lostSalesEstimation.assumptionsEn
                  ).map((a, idx) => (
                    <li key={idx}>{a}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong className="text-slate-200 block mb-1">
                  {isAr ? 'الحدود الإحصائية:' : 'Known Limitations:'}
                </strong>
                <ul className="list-disc list-inside space-y-0.5">
                  {(isAr
                    ? unmetDemand.lostSalesEstimation.limitationsAr
                    : unmetDemand.lostSalesEstimation.limitationsEn
                  ).map((l, idx) => (
                    <li key={idx}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
          </AppCard>

          {/* Most Requested Unavailable Products Table */}
          <AppCard className="p-4 overflow-x-auto">
            <h4 className="text-sm font-bold mb-3">
              {isAr
                ? 'أكثر المنتجات غير المتوفرة طلباً ومقارنتها بالمبيعات الفعلية والرصيد الحالي'
                : 'Most Requested Unavailable Products vs. Actual Sales & Current Stock'}
            </h4>
            <table
              className="w-full text-xs text-left border-collapse"
              data-testid="unmet-top-products-table"
            >
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2 px-2">{isAr ? 'المنتج' : 'Product'}</th>
                  <th className="py-2 px-2">{isAr ? 'النوع' : 'Catalog Status'}</th>
                  <th className="py-2 px-2">{isAr ? 'السبب الرئيسي' : 'Primary Reason'}</th>
                  <th className="py-2 px-2">{isAr ? 'عدد الاستفسارات' : 'Inquiries'}</th>
                  <th className="py-2 px-2">{isAr ? 'الوحدات المطلوبة' : 'Req. Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'الرصيد الحالي' : 'Current Stock'}</th>
                  <th className="py-2 px-2">{isAr ? 'المباع فعلياً' : 'Actual Sold'}</th>
                  <th className="py-2 px-2">{isAr ? 'نسبة التلبية' : 'Capture %'}</th>
                  <th className="py-2 px-2">
                    {isAr ? 'الإيراد المفقود التقديري' : 'Conservative Lost Rev.'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {unmetDemand.topRequestedProducts.map((item) => (
                  <tr key={item.productKey} className="hover:bg-slate-800/30">
                    <td className="py-2 px-2 font-sans font-semibold">
                      <div>{isAr ? item.productNameAr || item.productName : item.productName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {item.sku || item.barcode || 'Unregistered'} • {item.category}
                      </div>
                      {item.repeatedStockoutPatternDetected && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-sans font-bold">
                          {isAr ? 'نفاد متكرر حرج' : 'Repeated Stockout Pattern'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-sans">
                      {item.isRegisteredProduct ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-bold">
                          {isAr ? 'مسجل بالكتالوج' : 'Registered'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px] font-bold">
                          {isAr ? 'غير مسجل بالمتجر' : 'Unregistered'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-sans text-[11px] text-amber-300">
                      {item.primaryReason.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 px-2 font-bold text-rose-400">{item.inquiryCount}</td>
                    <td className="py-2 px-2 font-bold text-amber-400">
                      {item.requestedBaseUnitsTotal}{' '}
                      <span className="text-[10px] text-slate-400">
                        ({item.confirmedPurchaseIntentUnits} {isAr ? 'مؤكد' : 'confirmed'})
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      {item.currentStock !== null ? item.currentStock : '—'}
                    </td>
                    <td className="py-2 px-2 text-emerald-400">{item.actualUnitsSoldInPeriod}</td>
                    <td className="py-2 px-2">
                      {item.demandCaptureRatioPercent !== null
                        ? `${item.demandCaptureRatioPercent}%`
                        : '—'}
                    </td>
                    <td className="py-2 px-2 text-rose-300 font-bold">
                      {item.lostSalesEstimationStatus === 'ESTIMATED' &&
                      item.estimatedLostRevenueConservative !== null
                        ? formatCurrency(
                            item.estimatedLostRevenueConservative,
                            sales.currency,
                            settings.language
                          )
                        : isAr
                        ? 'بدون تسعير (غير مسجل)'
                        : 'INSUFFICIENT_DATA'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>

          {/* Breakdown by Unavailability Reason, Category, and Branch */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <AppCard className="p-4">
              <h4 className="text-sm font-bold mb-3">
                {isAr ? 'توزيع الطلبات حسب سبب عدم التوفر' : 'Unmet Demand by Reason'}
              </h4>
              <div className="space-y-2.5">
                {unmetDemand.byReason.map((r) => (
                  <div
                    key={r.reason}
                    className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                  >
                    <div className="flex justify-between font-bold">
                      <span>{isAr ? r.labelAr : r.labelEn}</span>
                      <span className="font-mono text-amber-400">
                        {r.requestedBaseUnits} {isAr ? 'وحدة' : 'units'} ({r.sharePercent}%)
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {r.inquiryCount} {isAr ? 'استفسار مسجل' : 'recorded inquiries'}
                    </div>
                  </div>
                ))}
              </div>
            </AppCard>

            <AppCard className="p-4">
              <h4 className="text-sm font-bold mb-3">
                {isAr ? 'توزيع الطلب غير المتوفر حسب الفئة' : 'Unmet Demand by Category'}
              </h4>
              <div className="space-y-2.5">
                {unmetDemand.byCategory.map((cat) => (
                  <div
                    key={cat.category}
                    className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                  >
                    <div className="flex justify-between font-bold">
                      <span>{cat.category}</span>
                      <span className="font-mono text-rose-400">
                        {cat.requestedBaseUnits} {isAr ? 'وحدة' : 'units'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                      <span>
                        {cat.inquiryCount} {isAr ? 'استفسار' : 'inquiries'} •{' '}
                        {cat.distinctProducts} {isAr ? 'أصناف' : 'SKUs'}
                      </span>
                      <span>
                        {cat.estimatedLostRevenue !== null
                          ? formatCurrency(
                              cat.estimatedLostRevenue,
                              sales.currency,
                              settings.language
                            )
                          : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </AppCard>

            <AppCard className="p-4">
              <h4 className="text-sm font-bold mb-3">
                {isAr ? 'مقارنة الطلب غير المتوفر بين الفروع' : 'Unmet Demand by Branch'}
              </h4>
              <div className="space-y-2.5">
                {unmetDemand.byBranch.map((b) => (
                  <div
                    key={b.branchId}
                    className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                  >
                    <div className="flex justify-between font-bold">
                      <span>{isAr ? b.branchNameAr : b.branchName}</span>
                      <span className="font-mono text-amber-400">
                        {b.requestedBaseUnits} {isAr ? 'وحدة' : 'units'} ({b.inquiryCount}{' '}
                        {isAr ? 'طلب' : 'inquiries'})
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {isAr ? 'الأكثر طلباً:' : 'Top Requested:'}{' '}
                      <strong className="text-slate-200">
                        {b.topRequestedProductName || '—'}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            </AppCard>
          </div>

          {/* Daily / Weekly / Monthly Demand Trend Comparison */}
          <AppCard className="p-4 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h4 className="text-sm font-bold">
                {isAr
                  ? 'اتجاه الطلبات غير المتوفرة مقابل المبيعات الفعلية عبر الزمن'
                  : 'Unmet Customer Demand vs. Actual Units Sold Trend'}
              </h4>
              <div className="flex items-center gap-1.5">
                {(['daily', 'weekly', 'monthly'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setDemandTrendGranularity(g)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold ${
                      demandTrendGranularity === g
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-900 border border-slate-800 text-slate-300'
                    }`}
                  >
                    {g === 'daily'
                      ? isAr
                        ? 'يومي'
                        : 'Daily'
                      : g === 'weekly'
                      ? isAr
                        ? 'أسبوعي'
                        : 'Weekly'
                      : isAr
                      ? 'شهري'
                      : 'Monthly'}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2 px-2">{isAr ? 'الفترة' : 'Period'}</th>
                  <th className="py-2 px-2">{isAr ? 'الاستفسارات' : 'Inquiries'}</th>
                  <th className="py-2 px-2">{isAr ? 'الوحدات غير المتوفرة' : 'Unmet Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'نية شراء مؤكدة' : 'Confirmed Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'الوحدات المباعة فعلياً' : 'Actual Sold Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'مسجل / غير مسجل' : 'Reg / Unreg'}</th>
                  <th className="py-2 px-2">{isAr ? 'الإيراد المفقود التقديري' : 'Est. Lost Rev.'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {(demandTrendGranularity === 'daily'
                  ? unmetDemand.dailyTrends.filter(
                      (t) => t.inquiryCount > 0 || t.actualUnitsSold > 0
                    )
                  : demandTrendGranularity === 'weekly'
                  ? unmetDemand.weeklyTrends
                  : unmetDemand.monthlyTrends
                ).map((pt) => (
                  <tr key={pt.periodKey}>
                    <td className="py-2 px-2 font-bold">{pt.label}</td>
                    <td className="py-2 px-2 text-rose-400">{pt.inquiryCount}</td>
                    <td className="py-2 px-2 text-amber-400 font-bold">
                      {pt.requestedBaseUnits}
                    </td>
                    <td className="py-2 px-2 text-slate-300">{pt.confirmedIntentUnits}</td>
                    <td className="py-2 px-2 text-emerald-400 font-bold">
                      {pt.actualUnitsSold}
                    </td>
                    <td className="py-2 px-2 text-slate-400">
                      {pt.registeredProductInquiries} / {pt.unregisteredProductInquiries}
                    </td>
                    <td className="py-2 px-2 text-rose-300">
                      {pt.estimatedLostRevenue !== null
                        ? formatCurrency(
                            pt.estimatedLostRevenue,
                            sales.currency,
                            settings.language
                          )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>

          {/* Recent Customer Inquiries Log */}
          <AppCard className="p-4 overflow-x-auto">
            <h4 className="text-sm font-bold mb-3">
              {isAr
                ? 'سجل استفسارات وطلبات العملاء الأخيرة (محمي حسب الصلاحيات)'
                : 'Recent Recorded Customer Unmet Demand Inquiries (Role-Scoped & PII-Protected)'}
            </h4>
            <table
              className="w-full text-xs text-left border-collapse"
              data-testid="unmet-recent-requests-table"
            >
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2 px-2">{isAr ? 'الوقت' : 'Timestamp'}</th>
                  <th className="py-2 px-2">{isAr ? 'المنتج' : 'Requested Item'}</th>
                  <th className="py-2 px-2">{isAr ? 'الكمية' : 'Qty'}</th>
                  <th className="py-2 px-2">{isAr ? 'السبب' : 'Reason'}</th>
                  <th className="py-2 px-2">{isAr ? 'الفرع' : 'Branch'}</th>
                  <th className="py-2 px-2">{isAr ? 'العميل / ملاحظات' : 'Customer / Notes'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {unmetDemand.recentRequests.map((req) => (
                  <tr key={req.id}>
                    <td className="py-2 px-2 text-[11px] text-slate-400">
                      {new Date(req.requestedTimestamp).toLocaleString(
                        isAr ? 'ar-SA' : 'en-US',
                        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                      )}
                    </td>
                    <td className="py-2 px-2 font-sans font-semibold">
                      {isAr
                        ? req.productNameArSnapshot || req.productNameSnapshot
                        : req.productNameSnapshot}
                      {!req.isRegisteredProduct && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px]">
                          {isAr ? 'غير مسجل' : 'Unregistered'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-amber-400 font-bold">
                      {req.requestedBaseUnits}
                    </td>
                    <td className="py-2 px-2 font-sans text-[11px]">
                      {req.unavailabilityReason}
                    </td>
                    <td className="py-2 px-2 font-sans text-[11px]">{req.branchId}</td>
                    <td className="py-2 px-2 font-sans text-[11px] text-slate-300">
                      {req.customerReference ? `${req.customerReference} — ` : ''}
                      {req.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PHASE 10 TAB B: SMART STORE OPERATIONS, REPLENISHMENT & TRANSFERS     */}
      {/* ===================================================================== */}
      {activeTab === 'smart_intelligence' && (
        <div className="space-y-4" data-testid="bi-smart-intelligence-view">
          {/* Overview KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'إجمالي التنبيهات الذكية' : 'Active Smart Alerts'}
              </div>
              <div
                className="text-lg font-black font-mono text-amber-400 mt-1"
                data-testid="smart-kpi-total-alerts"
              >
                {intelligence.overview.totalActiveAlerts}
              </div>
              <div className="text-[10px] text-rose-400 mt-1 font-bold">
                {intelligence.overview.criticalAlertsCount}{' '}
                {isAr ? 'حرجة' : 'critical'} • {intelligence.overview.highAlertsCount}{' '}
                {isAr ? 'عالية' : 'high'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'توصيات أوامر الشراء' : 'Replenishment PO Recs'}
              </div>
              <div
                className="text-lg font-black font-mono text-sky-400 mt-1"
                data-testid="smart-kpi-replenishment-count"
              >
                {intelligence.overview.replenishmentRecommendationsCount}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'التكلفة التقديرية:' : 'Est. Cost:'}{' '}
                {formatNullableCurrency(
                  intelligence.overview.totalRecommendedReplenishmentCost
                )}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'فرص التحويل بين الفروع' : 'Branch Transfer Recs'}
              </div>
              <div
                className="text-lg font-black font-mono text-emerald-400 mt-1"
                data-testid="smart-kpi-transfer-count"
              >
                {intelligence.overview.branchTransferOpportunitiesCount}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {intelligence.overview.totalTransferableUnits}{' '}
                {isAr ? 'وحدة فائضة قابلة للتحويل' : 'surplus units transferable'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'مخاطر المخزون والنفاد' : 'Inventory & Stockout Risks'}
              </div>
              <div className="text-lg font-black font-mono text-rose-400 mt-1">
                {intelligence.inventoryRisks.length}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {intelligence.overview.expiringProductsCount}{' '}
                {isAr ? 'أصناف بمخاطر صلاحية' : 'with expiration risk'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'المخاطر المالية والربحية' : 'Financial & Margin Risks'}
              </div>
              <div className="text-lg font-black font-mono text-amber-300 mt-1">
                {intelligence.financialRisks.length}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr ? 'مراقبة الهوامش والديون والمرتجعات' : 'Margin, debt & return alerts'}
              </div>
            </AppCard>

            <AppCard className="p-3.5">
              <div className="text-xs text-slate-400">
                {isAr ? 'حالة التنفيذ الآلي' : 'Automation Safety Mode'}
              </div>
              <div className="text-xs font-black font-mono text-emerald-400 mt-1.5">
                {isAr ? 'يتطلب اعتماد الإدارة' : 'REQUIRES APPROVAL'}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {isAr
                  ? 'لا يتم تعديل المخزون أو الأسعار تلقائياً'
                  : 'Read-only advisory recommendations'}
              </div>
            </AppCard>
          </div>

          {/* Smart Purchase Replenishment Recommendations Table (Part 6A) */}
          <AppCard className="p-4 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h4 className="text-sm font-bold flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  {isAr
                    ? 'توصيات التوريد وأوامر الشراء الذكية (تدمج المبيعات الفعلية + الطلب غير المتوفر + زمن التوريد)'
                    : 'Smart Replenishment & Purchase Order Recommendations (Sales + Unmet Demand + Lead Time)'}
                </h4>
                <p className="text-xs text-slate-400">
                  {isAr
                    ? 'جميع التوصيات استشارية وتتطلب اعتماد مدير المشتريات قبل إنشاء أمر شراء فعلي.'
                    : 'All recommendations are strictly advisory and require manager approval before creating a PO.'}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                {isAr ? 'الحالة: يتطلب اعتماد المستخدم' : 'Status: Requires User Approval'}
              </span>
            </div>
            <table
              className="w-full text-xs text-left border-collapse"
              data-testid="smart-replenishment-table"
            >
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2 px-2">{isAr ? 'المنتج' : 'Product'}</th>
                  <th className="py-2 px-2">{isAr ? 'الأولوية' : 'Urgency'}</th>
                  <th className="py-2 px-2">{isAr ? 'الرصيد الحالي' : 'Stock'}</th>
                  <th className="py-2 px-2">{isAr ? 'مبيعات/يوم' : 'Sales/Day'}</th>
                  <th className="py-2 px-2">{isAr ? 'طلبات غير متوفرة' : 'Unmet Units'}</th>
                  <th className="py-2 px-2">{isAr ? 'الطلب الكامن/يوم' : 'Latent/Day'}</th>
                  <th className="py-2 px-2">{isAr ? 'نقطة الطلب' : 'Reorder Pt'}</th>
                  <th className="py-2 px-2">{isAr ? 'الكمية المقترحة' : 'Rec. Order Qty'}</th>
                  <th className="py-2 px-2">{isAr ? 'التكلفة التقديرية' : 'Est. Cost'}</th>
                  <th className="py-2 px-2">{isAr ? 'الاعتماد' : 'Approval'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {intelligence.replenishmentRecommendations.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/30">
                    <td className="py-2 px-2 font-sans font-semibold">
                      <div>{isAr ? rec.productNameAr || rec.productName : rec.productName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {rec.sku} • {rec.category} • Lead {rec.leadTimeDays}d
                      </div>
                      {rec.expirationRiskDetected && (
                        <div className="text-[10px] text-amber-400 font-sans mt-0.5">
                          ⚠️{' '}
                          {isAr
                            ? `تنبيه صلاحية (${rec.expiryDateSnapshot || 'قريب'})`
                            : `Expiration Risk (${rec.expiryDateSnapshot || 'Near Expiry'})`}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          rec.urgency === 'CRITICAL'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : rec.urgency === 'HIGH'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-sky-500/20 text-sky-300'
                        }`}
                      >
                        {rec.urgency}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-bold">{rec.currentStock}</td>
                    <td className="py-2 px-2">{rec.observedSalesDailyVelocity}/d</td>
                    <td className="py-2 px-2 text-rose-400 font-bold">
                      {rec.observedUnmetDemandUnits} ({rec.unmetDemandInquiriesCount})
                    </td>
                    <td className="py-2 px-2 text-amber-300 font-bold">
                      {rec.estimatedLatentDailyDemand}/d
                    </td>
                    <td className="py-2 px-2">{rec.reorderPointUnits}</td>
                    <td className="py-2 px-2 text-emerald-400 font-bold">
                      +{rec.recommendedOrderUnits}
                    </td>
                    <td className="py-2 px-2">
                      {formatNullableCurrency(rec.estimatedOrderCost)}
                    </td>
                    <td className="py-2 px-2 font-sans">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px]">
                        {isAr ? 'يتطلب موافقة' : 'Requires Approval'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AppCard>

          {/* Inter-Branch Stock Transfer Opportunities (Part 6B) */}
          <AppCard className="p-4 overflow-x-auto">
            <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-400" />
              {isAr
                ? 'فرص التحويل الذكي للمخزون بين الفروع (من فرع الفائض إلى فرع العجز والطلب)'
                : 'Smart Inter-Branch Stock Transfer Recommendations (Surplus Branch → Shortage Branch)'}
            </h4>
            {intelligence.branchTransferOpportunities.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">
                {isAr
                  ? 'لا توجد حالياً اختلالات مخزنية تتطلب تحويلاً بين الفروع.'
                  : 'No inter-branch stock imbalances requiring transfer at this time.'}
              </p>
            ) : (
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                data-testid="smart-branch-transfers-list"
              >
                {intelligence.branchTransferOpportunities.map((tr) => (
                  <div
                    key={tr.id}
                    className="p-3.5 rounded-xl bg-slate-900/70 border border-emerald-500/30 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">
                        {isAr ? tr.productNameAr || tr.productName : tr.productName}{' '}
                        <span className="font-mono text-slate-400">({tr.sku})</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                        {isAr
                          ? `تحويل ${tr.recommendedTransferUnits} وحدة`
                          : `Transfer ${tr.recommendedTransferUnits} units`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px]">
                      <span className="text-sky-300">
                        {isAr ? 'من:' : 'From:'}{' '}
                        {isAr ? tr.fromBranchNameAr : tr.fromBranchName} ({isAr ? 'فائض' : 'Surplus'}:{' '}
                        {tr.fromBranchEstimatedSurplusUnits})
                      </span>
                      <span className="text-amber-400 font-bold">→</span>
                      <span className="text-rose-300">
                        {isAr ? 'إلى:' : 'To:'} {isAr ? tr.toBranchNameAr : tr.toBranchName} (
                        {isAr ? 'عجز/طلبات:' : 'Shortage/Unmet:'} {tr.toBranchShortageOrUnmetUnits})
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {isAr ? tr.explanationAr : tr.explanationEn}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                      <span>
                        {isAr ? 'الثقة:' : 'Confidence:'} {tr.confidenceLevel}
                      </span>
                      <span className="text-amber-300 font-semibold">
                        {isAr
                          ? 'الحالة: مقترح يتطلب موافقة الإدارة'
                          : 'Approval: requires_user_approval'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AppCard>

          {/* Unified 10-Category Smart Alerts Explorer (Parts 3 & 7) */}
          <AppCard className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                {isAr
                  ? 'مستكشف التنبيهات والتوصيات الذكية الموحد (10 فئات تحليلية)'
                  : 'Unified 10-Category Smart Store Operations & Risk Alerts'}
              </h4>
              <select
                value={alertCategoryFilter}
                onChange={(e) =>
                  setAlertCategoryFilter(e.target.value as SmartInsightCategory | 'ALL')
                }
                data-testid="smart-alert-category-filter"
                className={selectClass}
              >
                <option value="ALL">
                  {isAr
                    ? `كل الفئات (${intelligence.smartAlerts.length})`
                    : `All Categories (${intelligence.smartAlerts.length})`}
                </option>
                {SUPPORTED_SMART_INSIGHT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {getCategoryLabel(cat)} ({intelligence.overview.byCategory[cat] || 0})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5" data-testid="smart-alerts-list">
              {intelligence.smartAlerts
                .filter(
                  (a) =>
                    alertCategoryFilter === 'ALL' || a.category === alertCategoryFilter
                )
                .map((alert) => {
                  const status =
                    alertLifecycleOverrides[alert.dedupeKey] ||
                    alertLifecycleOverrides[alert.id] ||
                    alert.lifecycleStatus;
                  const topEvidence = alert.evidenceMetrics[0];
                  return (
                    <div
                      key={alert.id}
                      className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-neutral-400">
                            <span
                              className={
                                alert.severity === 'CRITICAL'
                                  ? 'font-bold text-rose-400'
                                  : alert.severity === 'HIGH'
                                  ? 'font-bold text-amber-400'
                                  : 'font-semibold text-sky-400'
                              }
                            >
                              {getSeverityLabel(alert.severity)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-neutral-300 font-medium">
                              {getCategoryLabel(alert.category)}
                            </span>
                          </div>
                          <h5 className="font-bold text-sm sm:text-base text-white">
                            {isAr ? alert.titleAr : alert.titleEn}
                          </h5>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-xs">
                          {topEvidence && (
                            <span className="font-bold text-amber-400">
                              {topEvidence.name}: {topEvidence.valueFormatted}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-neutral-200 text-xs sm:text-sm leading-relaxed">
                        <strong>{isAr ? 'النتيجة: ' : 'Finding: '}</strong>
                        {isAr ? alert.descriptionAr : alert.descriptionEn}
                      </p>
                      <p className="text-neutral-400 text-xs leading-relaxed">
                        <strong>{isAr ? 'التفسير التحليلي: ' : 'Explanation: '}</strong>
                        {isAr ? alert.explanationAr : alert.explanationEn}
                      </p>
                      <div className="pt-2 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-emerald-400 font-bold text-xs sm:text-sm">
                          {isAr ? 'الإجراء المقترح: ' : 'Recommended Action: '}
                          <span className="font-semibold text-emerald-300">
                            {isAr ? alert.recommendedActionAr : alert.recommendedActionEn}
                          </span>
                        </span>
                        <div className="flex items-center gap-1">
                          {(
                            ['active', 'acknowledged', 'resolved', 'dismissed'] as const
                          ).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() =>
                                handlePersistAlertStatusChange(
                                  alert.id,
                                  alert.dedupeKey || `smart_alert:${alert.id}`,
                                  st
                                )
                              }
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${
                                status === st
                                  ? 'bg-amber-500 text-neutral-950 font-bold'
                                  : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
                              }`}
                            >
                              {getLifecycleLabel(st)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </AppCard>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 10: ALL UNIFIED BUSINESS & OPERATIONAL RECOMMENDATIONS            */}
      {/* ===================================================================== */}
      {activeTab === 'insights' && (
        <div className="space-y-4">
          <AppCard className="p-5 border-neutral-800 bg-neutral-900/95 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-800">
              <div>
                <h4 className="text-base font-extrabold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  {isAr
                    ? `جميع التوصيات الذكية والتنبيهات التشغيلية (${
                        intelligence.smartAlerts.length +
                        intelligence.replenishmentRecommendations.length +
                        intelligence.branchTransferOpportunities.length +
                        insights.length
                      })`
                    : `All Unified Smart Store & Business Recommendations (${
                        intelligence.smartAlerts.length +
                        intelligence.replenishmentRecommendations.length +
                        intelligence.branchTransferOpportunities.length +
                        insights.length
                      })`}
                </h4>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {isAr
                    ? 'قائمة شاملة بجميع توصيات الذكاء التشغيلي، أوامر الشراء المقترحة، فرص التحويل بين الفروع، والتوصيات المالية.'
                    : 'Complete list of operational alerts, purchase order recommendations, branch transfers, and financial insights.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {intelligence.smartAlerts.map((alert) => {
                const topEvidence = alert.evidenceMetrics[0];
                return (
                  <div
                    key={alert.id}
                    className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-neutral-400">
                          <span className="font-bold text-amber-400">
                            {getSeverityLabel(alert.severity)}
                          </span>{' '}
                          · <span>{getCategoryLabel(alert.category)}</span>
                        </div>
                        <h5 className="text-sm sm:text-base font-bold text-white mt-0.5">
                          {isAr ? alert.titleAr : alert.titleEn}
                        </h5>
                      </div>
                      {topEvidence && (
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {topEvidence.name}: {topEvidence.valueFormatted}
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                      <strong>{isAr ? 'النتيجة: ' : 'Finding: '}</strong>
                      {isAr ? alert.descriptionAr : alert.descriptionEn}
                    </p>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      <strong>{isAr ? 'التفسير: ' : 'Explanation: '}</strong>
                      {isAr ? alert.explanationAr : alert.explanationEn}
                    </p>
                    <div className="pt-2 border-t border-neutral-800 text-xs sm:text-sm font-bold text-emerald-400">
                      {isAr ? 'التوصية المقترحة: ' : 'Recommended Action: '}
                      <span className="font-semibold text-emerald-300">
                        {isAr ? alert.recommendedActionAr : alert.recommendedActionEn}
                      </span>
                    </div>
                  </div>
                );
              })}

              {insights.map((ins) => (
                <div
                  key={ins.id}
                  className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-sky-400">
                        {getSeverityLabel(ins.severity)}
                      </span>
                      <h5 className="text-sm sm:text-base font-bold text-white mt-0.5">
                        {isAr ? ins.titleAr : ins.titleEn}
                      </h5>
                    </div>
                    <span className="font-mono text-xs font-bold text-amber-400">
                      {ins.metricName}: {ins.metricValueFormatted}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                    <strong>{isAr ? 'النتيجة: ' : 'Finding: '}</strong>
                    {isAr ? ins.findingAr : ins.findingEn}
                  </p>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    <strong>{isAr ? 'الدليل والسبب: ' : 'Evidence & Reason: '}</strong>
                    {isAr ? ins.supportingEvidenceAr : ins.supportingEvidenceEn} —{' '}
                    {isAr ? ins.reasonAr : ins.reasonEn}
                  </p>
                  <div className="pt-2 border-t border-neutral-800 text-xs sm:text-sm font-bold text-emerald-400">
                    {isAr ? 'التوصية التنفيذية المقترحة: ' : 'Recommended Action: '}
                    <span className="font-semibold text-emerald-300">
                      {isAr ? ins.suggestedActionAr : ins.suggestedActionEn}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </AppCard>
        </div>
      )}
    </div>
  );
}
