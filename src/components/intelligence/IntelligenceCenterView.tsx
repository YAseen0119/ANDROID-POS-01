/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  UserCheck,
  XCircle,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Building2,
} from 'lucide-react';
import {
  IntelligenceLifecycleEventRecord,
  IntelligenceLifecycleItemRecord,
  IntelligenceLifecycleListResponse,
  IntelligenceLifecycleStatus,
  IntelligenceLifecycleStream,
  IntelligenceLifecycleSummaryCounts,
} from '../../analytics/analytics.types';
import { DEFAULT_ANALYTICS_BRANCHES } from '../../analytics/analytics.snapshot';
import { AppModal } from '../ui/AppModal';

export interface IntelligenceCenterViewProps {
  isAr: boolean;
  currentUserId: string;
  currentUserRole: string;
  initialBranchId?: string;
  onLifecycleMutated?: (counts: IntelligenceLifecycleSummaryCounts) => void;
  onOpenUnmetDemandModal?: () => void;
}

type LifecycleTabKey = IntelligenceLifecycleStatus | 'ALL_HISTORY';

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  MEDIUM: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  LOW: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  INFO: 'bg-neutral-800 text-neutral-300 border-neutral-700',
};

const STATUS_BADGE_STYLES: Record<IntelligenceLifecycleStatus, { cls: string; en: string; ar: string }> = {
  ACTIVE: {
    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    en: 'Active',
    ar: 'نشط',
  },
  ACKNOWLEDGED: {
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    en: 'Acknowledged',
    ar: 'تم الاطلاع',
  },
  RESOLVED: {
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    en: 'Resolved',
    ar: 'تم الحل',
  },
  DISMISSED: {
    cls: 'bg-neutral-800 text-neutral-400 border-neutral-700',
    en: 'Dismissed',
    ar: 'مستبعد',
  },
};

const STREAM_LABELS: Record<IntelligenceLifecycleStream, { en: string; ar: string; badge: string }> = {
  smart_alert: {
    en: 'Operational Alert',
    ar: 'تنبيه تشغيلي',
    badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  },
  replenishment: {
    en: 'Smart Replenishment',
    ar: 'توصية إعادة تزويد',
    badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  },
  branch_transfer: {
    en: 'Branch Transfer',
    ar: 'تحويل بين الفروع',
    badge: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  },
  bi_insight: {
    en: 'BI Insight',
    ar: 'توصية تحليلية',
    badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  },
};

export const IntelligenceCenterView: React.FC<IntelligenceCenterViewProps> = ({
  isAr,
  currentUserId,
  currentUserRole,
  initialBranchId = 'all',
  onLifecycleMutated,
  onOpenUnmetDemandModal,
}) => {
  const [activeStatusTab, setActiveStatusTab] = useState<LifecycleTabKey>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');
  const [itemStreamFilter, setItemStreamFilter] = useState<IntelligenceLifecycleStream | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState(initialBranchId || 'all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<'priority_desc' | 'updated_desc' | 'created_desc' | 'severity_desc'>('priority_desc');
  const [page, setPage] = useState(1);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  const [listData, setListData] = useState<IntelligenceLifecycleListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  // Action Dialog State (Resolve / Dismiss / Reopen)
  const [actionDialog, setActionDialog] = useState<{
    isOpen: boolean;
    mode: 'RESOLVE' | 'DISMISS' | 'REOPEN';
    item: IntelligenceLifecycleItemRecord | null;
    note: string;
    actionType: string;
  }>({
    isOpen: false,
    mode: 'RESOLVE',
    item: null,
    note: '',
    actionType: 'RESTOCK_ORDERED',
  });

  // Detail & Event Audit Drawer/Modal State
  const [detailState, setDetailState] = useState<{
    isOpen: boolean;
    loading: boolean;
    item: IntelligenceLifecycleItemRecord | null;
    history: IntelligenceLifecycleEventRecord[];
  }>({
    isOpen: false,
    loading: false,
    item: null,
    history: [],
  });

  const canReopen = currentUserRole === 'admin' || currentUserRole === 'manager';

  const fetchLifecycleList = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({
        status: activeStatusTab,
        itemStream: itemStreamFilter,
        category: categoryFilter,
        severity: severityFilter,
        branchId: branchFilter,
        sortBy,
        page: String(page),
        pageSize: '15',
      });
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/intelligence/lifecycle?${params.toString()}`, {
        headers: {
          'x-user-id': currentUserId,
        },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load intelligence lifecycle items');
      }
      setListData(json.data);
      if (onLifecycleMutated && json.data?.counts) {
        onLifecycleMutated(json.data.counts);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error loading intelligence lifecycle');
    } finally {
      setIsLoading(false);
    }
  }, [
    activeStatusTab,
    itemStreamFilter,
    categoryFilter,
    severityFilter,
    branchFilter,
    startDate,
    endDate,
    searchQuery,
    sortBy,
    page,
    currentUserId,
    onLifecycleMutated,
  ]);

  useEffect(() => {
    fetchLifecycleList();
  }, [fetchLifecycleList]);

  const handleDirectAcknowledge = async (item: IntelligenceLifecycleItemRecord) => {
    setBusyItemId(item.id);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/intelligence/lifecycle/${encodeURIComponent(item.id)}/acknowledge`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUserId,
          },
          body: JSON.stringify({
            note: isAr ? 'تم الاطلاع والمتابعة التشغيلية' : 'Acknowledged for operational follow-up',
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to acknowledge item');
      }
      await fetchLifecycleList();
      if (detailState.isOpen && detailState.item?.id === item.id) {
        setDetailState({
          isOpen: true,
          loading: false,
          item: json.data.item,
          history: json.data.history || [],
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Action failed');
    } finally {
      setBusyItemId(null);
    }
  };

  const handleSubmitActionDialog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionDialog.item) return;

    const item = actionDialog.item;
    const endpointMap = {
      RESOLVE: 'resolve',
      DISMISS: 'dismiss',
      REOPEN: 'reopen',
    };
    const endpoint = endpointMap[actionDialog.mode];

    setBusyItemId(item.id);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/intelligence/lifecycle/${encodeURIComponent(item.id)}/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUserId,
          },
          body: JSON.stringify({
            note:
              actionDialog.note.trim() ||
              (actionDialog.mode === 'RESOLVE'
                ? isAr
                  ? 'تمت المعالجة التشغيلية بنجاح'
                  : 'Operational issue resolved'
                : actionDialog.mode === 'DISMISS'
                ? isAr
                  ? 'تم الاستبعاد لعدم الحاجة لإجراء'
                  : 'Dismissed by operator'
                : isAr
                ? 'إعادة فتح للمراجعة'
                : 'Reopened for review'),
            actionType: actionDialog.actionType,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Lifecycle transition failed');
      }
      setActionDialog((prev) => ({ ...prev, isOpen: false, item: null, note: '' }));
      await fetchLifecycleList();
      if (detailState.isOpen && detailState.item?.id === item.id) {
        setDetailState({
          isOpen: true,
          loading: false,
          item: json.data.item,
          history: json.data.history || [],
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lifecycle transition failed');
    } finally {
      setBusyItemId(null);
    }
  };

  const handleOpenDetailDrawer = async (item: IntelligenceLifecycleItemRecord) => {
    setDetailState({
      isOpen: true,
      loading: true,
      item,
      history: [],
    });
    try {
      const res = await fetch(
        `/api/intelligence/lifecycle/${encodeURIComponent(item.id)}/history`,
        {
          headers: {
            'x-user-id': currentUserId,
          },
        }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setDetailState({
          isOpen: true,
          loading: false,
          item: json.data.item,
          history: json.data.history || [],
        });
      } else {
        setDetailState((prev) => ({ ...prev, loading: false }));
      }
    } catch {
      setDetailState((prev) => ({ ...prev, loading: false }));
    }
  };

  const counts = listData?.counts || {
    active: 0,
    acknowledged: 0,
    resolved: 0,
    dismissed: 0,
    allHistory: 0,
    criticalActive: 0,
    highActive: 0,
  };

  const tabs: { id: LifecycleTabKey; labelEn: string; labelAr: string; count: number; badgeCls: string }[] = [
    {
      id: 'ACTIVE',
      labelEn: 'Active',
      labelAr: 'التنبيهات النشطة',
      count: counts.active,
      badgeCls: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    },
    {
      id: 'ACKNOWLEDGED',
      labelEn: 'Acknowledged',
      labelAr: 'قيد المتابعة',
      count: counts.acknowledged,
      badgeCls: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
    {
      id: 'RESOLVED',
      labelEn: 'Resolved',
      labelAr: 'تم الحل',
      count: counts.resolved,
      badgeCls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    },
    {
      id: 'DISMISSED',
      labelEn: 'Dismissed',
      labelAr: 'المستبعدة',
      count: counts.dismissed,
      badgeCls: 'bg-neutral-800 text-neutral-400 border-neutral-700',
    },
    {
      id: 'ALL_HISTORY',
      labelEn: 'All History',
      labelAr: 'السجل الكامل',
      count: counts.allHistory,
      badgeCls: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    },
  ];

  const formatTimestamp = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(isAr ? 'ar-SD' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div data-testid="intelligence-center-view" className="space-y-4">
      {/* Top Summary Strip */}
      <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                {isAr
                  ? 'مركز الذكاء التشغيلي وإدارة دورة حياة التوصيات'
                  : 'Intelligence Center & Recommendation Lifecycle'}
              </h3>
              <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
                {isAr ? 'محفوظ في قاعدة البيانات' : 'Database Persisted'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              {isAr
                ? 'إدارة موحدة للتنبيهات، توصيات التزويد، والتحويلات بين الفروع مع توثيق كامل للمستخدم والوقت والملاحظات'
                : 'Unified lifecycle management for alerts, replenishment, and branch transfers with full audit history'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenUnmetDemandModal && (
            <button
              type="button"
              data-testid="intel-center-log-demand-btn"
              onClick={onOpenUnmetDemandModal}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-extrabold transition-colors"
            >
              {isAr ? '+ تسجيل طلب غير متوفر' : '+ Log Unmet Demand'}
            </button>
          )}
          <button
            type="button"
            data-testid="intel-center-refresh-btn"
            onClick={() => fetchLifecycleList()}
            disabled={isLoading}
            className="px-3 py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            <span>{isAr ? 'تحديث' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* 5 Lifecycle Status Tabs */}
      <div
        data-testid="intelligence-lifecycle-tabs"
        className="grid grid-cols-2 sm:grid-cols-5 gap-2"
      >
        {tabs.map((tab) => {
          const isSelected = activeStatusTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`lifecycle-tab-${tab.id.toLowerCase()}`}
              onClick={() => {
                setActiveStatusTab(tab.id);
                setPage(1);
              }}
              className={`p-3 rounded-2xl border text-start transition-all flex items-center justify-between gap-2 ${
                isSelected
                  ? 'bg-neutral-900 border-amber-500/60 shadow-sm ring-1 ring-amber-500/30'
                  : 'bg-neutral-900/60 border-neutral-800/80 hover:border-neutral-700 text-neutral-400'
              }`}
            >
              <span className={`text-xs font-extrabold truncate ${isSelected ? 'text-white' : 'text-neutral-300'}`}>
                {isAr ? tab.labelAr : tab.labelEn}
              </span>
              <span
                className={`px-2 py-0.5 rounded-lg text-xs font-mono font-extrabold border tabular-nums ${tab.badgeCls}`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Bar */}
      <div className="p-3.5 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              data-testid="lifecycle-search-input"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder={
                isAr
                  ? 'ابحث باسم المنتج، الكود، سبب التنبيه، أو اسم الموظف...'
                  : 'Search by product, SKU, alert title, recommendation, or operator...'
              }
              className="w-full min-h-[38px] ps-9 pe-3 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2">
            <select
              aria-label={isAr ? 'ترتيب حسب' : 'Sort By'}
              data-testid="lifecycle-sort-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as any);
                setPage(1);
              }}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs font-bold text-neutral-200 focus:outline-none focus:border-amber-500"
            >
              <option value="priority_desc">
                {isAr ? 'الأولوية (الأعلى أولاً)' : 'Priority (Highest First)'}
              </option>
              <option value="severity_desc">
                {isAr ? 'الخطورة (الحرجة أولاً)' : 'Severity (Critical First)'}
              </option>
              <option value="updated_desc">
                {isAr ? 'أحدث إجراء / تحديث' : 'Recently Updated'}
              </option>
              <option value="created_desc">
                {isAr ? 'تاريخ الاكتشاف' : 'Detection Date'}
              </option>
            </select>

            <button
              type="button"
              onClick={() => setShowFiltersMobile((prev) => !prev)}
              className="lg:hidden min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs font-bold text-amber-400 flex items-center gap-1.5"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{isAr ? 'تصفية' : 'Filters'}</span>
            </button>
          </div>
        </div>

        {/* Advanced Filter Grid (Always visible on desktop, toggleable on mobile) */}
        <div
          className={`${
            showFiltersMobile ? 'grid' : 'hidden lg:grid'
          } grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2 border-t border-neutral-800/80`}
        >
          {/* Stream Filter */}
          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">
              {isAr ? 'نوع التوصية' : 'Intelligence Stream'}
            </label>
            <select
              data-testid="lifecycle-stream-filter"
              value={itemStreamFilter}
              onChange={(e) => {
                setItemStreamFilter(e.target.value as any);
                setPage(1);
              }}
              className="w-full min-h-[34px] px-2.5 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white"
            >
              <option value="all">{isAr ? 'كل الأنواع' : 'All Streams'}</option>
              <option value="smart_alert">{isAr ? 'تنبيهات تشغيلية' : 'Operational Alerts'}</option>
              <option value="replenishment">{isAr ? 'توصيات إعادة التزويد' : 'Smart Replenishment'}</option>
              <option value="branch_transfer">{isAr ? 'تحويلات بين الفروع' : 'Branch Transfers'}</option>
              <option value="bi_insight">{isAr ? 'تحليلات ذكاء الأعمال' : 'BI Insights'}</option>
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">
              {isAr ? 'التصنيف' : 'Category'}
            </label>
            <select
              data-testid="lifecycle-category-filter"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[34px] px-2.5 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white"
            >
              <option value="all">{isAr ? 'كل التصنيفات' : 'All Categories'}</option>
              <option value="STOCKOUT_RISK">{isAr ? 'مخاطر نفاد المخزون' : 'Stockout Risk'}</option>
              <option value="INVENTORY_RISK">{isAr ? 'مخاطر المخزون' : 'Inventory Risk'}</option>
              <option value="UNMET_DEMAND">{isAr ? 'الطلب غير الملبي' : 'Unmet Demand'}</option>
              <option value="REPLENISHMENT">{isAr ? 'إعادة التزويد' : 'Replenishment'}</option>
              <option value="TRANSFER_OPPORTUNITY">{isAr ? 'فرص التحويل' : 'Branch Transfer'}</option>
              <option value="FINANCIAL_RISK">{isAr ? 'المخاطر المالية' : 'Financial Risk'}</option>
              <option value="SALES_ANOMALY">{isAr ? 'شذوذ المبيعات' : 'Sales Anomaly'}</option>
              <option value="BRANCH_IMBALANCE">{isAr ? 'تباين الفروع' : 'Branch Imbalance'}</option>
            </select>
          </div>

          {/* Severity Filter */}
          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">
              {isAr ? 'درجة الأهمية' : 'Severity'}
            </label>
            <select
              data-testid="lifecycle-severity-filter"
              value={severityFilter}
              onChange={(e) => {
                setSeverityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[34px] px-2.5 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white"
            >
              <option value="all">{isAr ? 'كل الدرجات' : 'All Severities'}</option>
              <option value="CRITICAL">{isAr ? 'حرج (Critical)' : 'Critical'}</option>
              <option value="HIGH">{isAr ? 'مرتفع (High)' : 'High'}</option>
              <option value="MEDIUM">{isAr ? 'متوسط (Medium)' : 'Medium'}</option>
              <option value="LOW">{isAr ? 'منخفض (Low)' : 'Low'}</option>
            </select>
          </div>

          {/* Branch Filter */}
          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">
              {isAr ? 'الفرع' : 'Branch'}
            </label>
            <select
              data-testid="lifecycle-branch-filter"
              value={branchFilter}
              onChange={(e) => {
                setBranchFilter(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[34px] px-2.5 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white"
            >
              <option value="all">{isAr ? 'كل الفروع + العام' : 'All Branches & Global'}</option>
              {DEFAULT_ANALYTICS_BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {isAr ? b.nameAr : b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[10px] font-bold text-neutral-400 mb-1">
                {isAr ? 'من تاريخ' : 'From Date'}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="w-full min-h-[34px] px-2 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-neutral-400 mb-1">
                {isAr ? 'إلى تاريخ' : 'To Date'}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="w-full min-h-[34px] px-2 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] text-white"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div
          data-testid="lifecycle-error-banner"
          className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center justify-between gap-2"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-300 hover:text-white px-2 py-0.5 rounded-lg bg-rose-500/20"
          >
            ✕
          </button>
        </div>
      )}

      {/* Items List */}
      <div data-testid="lifecycle-items-list" className="space-y-3">
        {isLoading && (!listData || listData.items.length === 0) ? (
          <div className="p-8 rounded-2xl bg-neutral-900 border border-neutral-800 text-center text-xs text-neutral-400">
            {isAr ? 'جاري تحميل سجل التوصيات والتنبيهات...' : 'Loading intelligence lifecycle records...'}
          </div>
        ) : !listData || listData.items.length === 0 ? (
          <div
            data-testid="lifecycle-empty-state"
            className="p-8 rounded-2xl bg-neutral-900 border border-neutral-800 text-center space-y-2"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <div className="text-sm font-bold text-white">
              {isAr
                ? 'لا توجد عناصر مطابقة في هذا التبويب حالياً'
                : 'No intelligence items match the selected lifecycle tab & filters'}
            </div>
            <p className="text-xs text-neutral-400 max-w-md mx-auto">
              {isAr
                ? 'يمكنك التبديل بين تبويبات (النشطة، قيد المتابعة، تم الحل، المستبعدة، أو السجل الكامل) لمراجعة كافة القرارات السابقة.'
                : 'Switch between Active, Acknowledged, Resolved, Dismissed, or All History tabs to review past operational actions.'}
            </p>
          </div>
        ) : (
          listData.items.map((item) => {
            const statusMeta = STATUS_BADGE_STYLES[item.status] || STATUS_BADGE_STYLES.ACTIVE;
            const streamMeta = STREAM_LABELS[item.itemStream] || STREAM_LABELS.smart_alert;
            const sevClass = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.MEDIUM;
            const isBusy = busyItemId === item.id;
            const branchObj = DEFAULT_ANALYTICS_BRANCHES.find((b) => b.id === item.branchId);
            const branchLabel = branchObj
              ? isAr
                ? branchObj.nameAr
                : branchObj.name
              : isAr
              ? 'كافة الفروع (عام)'
              : 'All Branches (Global)';

            return (
              <div
                key={item.id}
                data-testid={`lifecycle-item-card-${item.id}`}
                data-lifecycle-status={item.status}
                className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-all space-y-3"
              >
                {/* Card Top Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${sevClass}`}>
                        {item.severity}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${statusMeta.cls}`}>
                        {isAr ? statusMeta.ar : statusMeta.en}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${streamMeta.badge}`}>
                        {isAr ? streamMeta.ar : streamMeta.en}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-neutral-950 border border-neutral-800 text-neutral-300 text-[10px] font-medium flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-amber-400" />
                        <span>{branchLabel}</span>
                      </span>
                      <span className="text-[10px] font-mono text-neutral-500">
                        {isAr ? 'الأولوية:' : 'Priority:'} {item.priority}/100
                      </span>
                    </div>

                    <h4 className="text-sm sm:text-base font-extrabold text-white leading-snug">
                      {isAr ? item.titleAr : item.titleEn}
                    </h4>
                  </div>

                  {/* Lifecycle Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {item.status === 'ACTIVE' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        data-testid={`lifecycle-ack-btn-${item.id}`}
                        onClick={() => handleDirectAcknowledge(item)}
                        className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1 transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>{isAr ? 'اطلاع ومتابعة' : 'Acknowledge'}</span>
                      </button>
                    )}

                    {(item.status === 'ACTIVE' || item.status === 'ACKNOWLEDGED') && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          data-testid={`lifecycle-resolve-btn-${item.id}`}
                          onClick={() =>
                            setActionDialog({
                              isOpen: true,
                              mode: 'RESOLVE',
                              item,
                              note: '',
                              actionType: 'RESTOCK_ORDERED',
                            })
                          }
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1 transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isAr ? 'تم الحل' : 'Resolve'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          data-testid={`lifecycle-dismiss-btn-${item.id}`}
                          onClick={() =>
                            setActionDialog({
                              isOpen: true,
                              mode: 'DISMISS',
                              item,
                              note: '',
                              actionType: 'NOT_APPLICABLE',
                            })
                          }
                          className="px-2.5 py-1.5 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 text-xs font-bold flex items-center gap-1 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{isAr ? 'استبعاد' : 'Dismiss'}</span>
                        </button>
                      </>
                    )}

                    {(item.status === 'RESOLVED' || item.status === 'DISMISSED') && canReopen && (
                      <button
                        type="button"
                        disabled={isBusy}
                        data-testid={`lifecycle-reopen-btn-${item.id}`}
                        onClick={() =>
                          setActionDialog({
                            isOpen: true,
                            mode: 'REOPEN',
                            item,
                            note: '',
                            actionType: 'MANUAL_REOPEN',
                          })
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 text-xs font-bold flex items-center gap-1 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{isAr ? 'إعادة فتح' : 'Reopen'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid={`lifecycle-detail-btn-${item.id}`}
                      onClick={() => handleOpenDetailDrawer(item)}
                      className="px-2.5 py-1.5 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isAr ? 'التفاصيل والسجل' : 'Details & History'}</span>
                    </button>
                  </div>
                </div>

                {/* Summary & Recommendation */}
                <p className="text-xs text-neutral-300 leading-relaxed">
                  {isAr ? item.summaryAr : item.summaryEn}
                </p>

                <div className="p-2.5 rounded-xl bg-neutral-950/90 border border-neutral-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-bold text-emerald-400">
                      {isAr ? 'الإجراء المقترح: ' : 'Recommended Action: '}
                    </span>
                    <span className="text-neutral-200">
                      {isAr ? item.recommendationAr : item.recommendationEn}
                    </span>
                  </div>
                </div>

                {/* Evidence Metrics Strip */}
                {item.evidenceJson?.metrics && item.evidenceJson.metrics.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {item.evidenceJson.metrics.slice(0, 4).map((m, mIdx) => (
                      <span
                        key={mIdx}
                        className="px-2.5 py-1 rounded-lg bg-neutral-950 border border-neutral-800/90 text-[11px] text-neutral-300"
                      >
                        <span className="text-neutral-500">{m.name}: </span>
                        <span className="font-mono font-bold text-white">{m.valueFormatted}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Lifecycle Audit Metadata Footer */}
                <div className="pt-2 border-t border-neutral-800/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      {isAr ? 'تاريخ الرصد:' : 'Detected:'}{' '}
                      <strong className="text-neutral-300 font-mono">
                        {formatTimestamp(item.firstDetectedAt)}
                      </strong>
                    </span>

                    {item.acknowledgedAt && (
                      <span className="text-amber-300/90">
                        • {isAr ? 'اطلع عليه:' : 'Acknowledged by:'}{' '}
                        <strong>{item.acknowledgedByName}</strong> ({formatTimestamp(item.acknowledgedAt)})
                      </span>
                    )}

                    {item.resolvedAt && (
                      <span className="text-emerald-300/90">
                        • {isAr ? 'تم الحل بواسطة:' : 'Resolved by:'}{' '}
                        <strong>{item.resolvedByName}</strong> ({formatTimestamp(item.resolvedAt)})
                        {item.resolutionNote ? ` — "${item.resolutionNote}"` : ''}
                      </span>
                    )}

                    {item.dismissedAt && (
                      <span className="text-neutral-400">
                        • {isAr ? 'استُبعد بواسطة:' : 'Dismissed by:'}{' '}
                        <strong>{item.dismissedByName}</strong> ({formatTimestamp(item.dismissedAt)})
                        {item.dismissReason ? ` — "${item.dismissReason}"` : ''}
                      </span>
                    )}
                  </div>

                  {item.reopenedCount > 0 && (
                    <span className="text-sky-400 font-mono text-[10px]">
                      {isAr
                        ? `أُعيد فتحه ${item.reopenedCount} مرة`
                        : `Reopened ${item.reopenedCount}×`}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Bar */}
      {listData && listData.pagination.totalPages > 1 && (
        <div className="p-3 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-between gap-2 text-xs">
          <span className="text-neutral-400">
            {isAr
              ? `صفحة ${listData.pagination.page} من ${listData.pagination.totalPages} (${listData.pagination.totalMatching} عنصر)`
              : `Page ${listData.pagination.page} of ${listData.pagination.totalPages} (${listData.pagination.totalMatching} items)`}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={listData.pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-300 disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{isAr ? 'السابق' : 'Prev'}</span>
            </button>
            <button
              type="button"
              disabled={listData.pagination.page >= listData.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-300 disabled:opacity-40 flex items-center gap-1"
            >
              <span>{isAr ? 'التالي' : 'Next'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Action Modal: Resolve / Dismiss / Reopen */}
      <AppModal
        isOpen={actionDialog.isOpen}
        onClose={() => setActionDialog((prev) => ({ ...prev, isOpen: false }))}
        title={
          actionDialog.mode === 'RESOLVE'
            ? isAr
              ? 'تأكيد حل ومعالجة التوصية'
              : 'Resolve Intelligence Item'
            : actionDialog.mode === 'DISMISS'
            ? isAr
              ? 'استبعاد التنبيه مع ذكر السبب'
              : 'Dismiss Intelligence Item'
            : isAr
            ? 'إعادة فتح العنصر للمتابعة النشطة'
            : 'Reopen Intelligence Item'
        }
        description={
          actionDialog.item
            ? isAr
              ? actionDialog.item.titleAr
              : actionDialog.item.titleEn
            : ''
        }
        maxWidth="md"
      >
        <form onSubmit={handleSubmitActionDialog} className="space-y-4">
          {actionDialog.mode === 'RESOLVE' && (
            <div>
              <label className="block text-xs font-bold text-neutral-300 mb-1.5">
                {isAr ? 'نوع الإجراء المتخذ' : 'Resolution Action Taken'}
              </label>
              <select
                data-testid="lifecycle-modal-action-type"
                value={actionDialog.actionType}
                onChange={(e) =>
                  setActionDialog((prev) => ({ ...prev, actionType: e.target.value }))
                }
                className="w-full min-h-[38px] px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white"
              >
                <option value="RESTOCK_ORDERED">
                  {isAr ? 'تم إصدار أمر شراء / تزويد مخزون' : 'Purchase Order / Restock Issued'}
                </option>
                <option value="BRANCH_TRANSFER_INITIATED">
                  {isAr ? 'تم اعتماد تحويل مخزني بين الفروع' : 'Inter-Branch Transfer Initiated'}
                </option>
                <option value="INVENTORY_AUDITED">
                  {isAr ? 'تم جرد وتصحيح الرصيد المخزني' : 'Physical Inventory Audited & Adjusted'}
                </option>
                <option value="PRICE_OR_MARGIN_ADJUSTED">
                  {isAr ? 'تمت مراجعة التسعير / هامش الربح' : 'Pricing or Margin Policy Adjusted'}
                </option>
                <option value="OPERATIONAL_FIX">
                  {isAr ? 'معالجة تشغيلية مباشرة بالفرع' : 'Direct Store Operational Fix'}
                </option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-300 mb-1.5">
              {actionDialog.mode === 'RESOLVE'
                ? isAr
                  ? 'ملاحظات الحل والتوثيق'
                  : 'Resolution Note'
                : actionDialog.mode === 'DISMISS'
                ? isAr
                  ? 'سبب الاستبعاد'
                  : 'Dismissal Reason'
                : isAr
                ? 'سبب إعادة الفتح'
                : 'Reason for Reopening'}
            </label>
            <textarea
              rows={3}
              data-testid="lifecycle-modal-note-input"
              value={actionDialog.note}
              onChange={(e) => setActionDialog((prev) => ({ ...prev, note: e.target.value }))}
              placeholder={
                actionDialog.mode === 'RESOLVE'
                  ? isAr
                    ? 'مثال: تم طلب 40 وحدة من المورد، رقم الطلب PO-104...'
                    : 'e.g., Ordered 40 units from supplier, PO-104...'
                  : actionDialog.mode === 'DISMISS'
                  ? isAr
                    ? 'مثال: منتج موسمي متوقف حالياً بناءً على قرار الإدارة...'
                    : 'e.g., Seasonal SKU intentionally discontinued...'
                  : isAr
                  ? 'مثال: تكرر الطلب على الصنف في الفرع...'
                  : 'e.g., Customer inquiries recurred at branch...'
              }
              className="w-full p-3 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActionDialog((prev) => ({ ...prev, isOpen: false }))}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              data-testid="lifecycle-modal-confirm-btn"
              disabled={busyItemId !== null}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-colors ${
                actionDialog.mode === 'RESOLVE'
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-neutral-950'
                  : actionDialog.mode === 'DISMISS'
                  ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
                  : 'bg-sky-500 hover:bg-sky-400 text-neutral-950'
              }`}
            >
              {actionDialog.mode === 'RESOLVE'
                ? isAr
                  ? 'حفظ وإغلاق كمحلول'
                  : 'Confirm Resolution'
                : actionDialog.mode === 'DISMISS'
                ? isAr
                  ? 'تأكيد الاستبعاد'
                  : 'Confirm Dismissal'
                : isAr
                ? 'تأكيد إعادة الفتح'
                : 'Confirm Reopen'}
            </button>
          </div>
        </form>
      </AppModal>

      {/* Detail & Full Audit History Modal */}
      <AppModal
        isOpen={detailState.isOpen}
        onClose={() => setDetailState((prev) => ({ ...prev, isOpen: false }))}
        title={
          detailState.item
            ? isAr
              ? detailState.item.titleAr
              : detailState.item.titleEn
            : isAr
            ? 'تفاصيل التوصية وسجل الأحداث'
            : 'Intelligence Item Details & Audit History'
        }
        description={
          detailState.item
            ? `${detailState.item.dedupeKey} • ${detailState.item.status}`
            : ''
        }
        maxWidth="2xl"
      >
        {detailState.item && (
          <div data-testid="lifecycle-detail-modal-body" className="space-y-4 text-xs">
            {/* Explanation & Evidence */}
            <div className="p-3.5 rounded-2xl bg-neutral-950 border border-neutral-800 space-y-2">
              <div className="font-bold text-amber-400">
                {isAr ? 'التحليل والأدلة الرقمية' : 'Analytical Evidence & Explanation'}
              </div>
              <p className="text-neutral-200 leading-relaxed">
                {isAr ? detailState.item.explanationAr : detailState.item.explanationEn}
              </p>
              <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-emerald-300">
                <strong>{isAr ? 'التوصية:' : 'Recommendation:'} </strong>
                {isAr ? detailState.item.recommendationAr : detailState.item.recommendationEn}
              </div>

              {detailState.item.evidenceJson?.metrics &&
                detailState.item.evidenceJson.metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                    {detailState.item.evidenceJson.metrics.map((m, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-xl bg-neutral-900 border border-neutral-800"
                      >
                        <div className="text-[10px] text-neutral-400">{m.name}</div>
                        <div className="font-mono font-bold text-white mt-0.5">
                          {m.valueFormatted}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* Lifecycle State Snapshot */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800">
                <div className="text-[10px] text-neutral-400">
                  {isAr ? 'تاريخ الاكتشاف الأول' : 'First Detected'}
                </div>
                <div className="font-mono font-bold text-white mt-0.5">
                  {formatTimestamp(detailState.item.firstDetectedAt)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800">
                <div className="text-[10px] text-neutral-400">
                  {isAr ? 'حالة المتابعة / الاطلاع' : 'Acknowledgment'}
                </div>
                <div className="font-bold text-amber-300 mt-0.5">
                  {detailState.item.acknowledgedAt
                    ? `${detailState.item.acknowledgedByName} (${formatTimestamp(
                        detailState.item.acknowledgedAt
                      )})`
                    : isAr
                    ? 'لم يتم الاطلاع بعد'
                    : 'Not yet acknowledged'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800">
                <div className="text-[10px] text-neutral-400">
                  {isAr ? 'حالة الحل / الاستبعاد' : 'Resolution / Dismissal'}
                </div>
                <div className="font-bold text-emerald-300 mt-0.5">
                  {detailState.item.resolvedAt
                    ? `${detailState.item.resolvedByName} (${formatTimestamp(
                        detailState.item.resolvedAt
                      )})`
                    : detailState.item.dismissedAt
                    ? `${detailState.item.dismissedByName} (${formatTimestamp(
                        detailState.item.dismissedAt
                      )})`
                    : isAr
                    ? 'مفتوح'
                    : 'Open'}
                </div>
              </div>
            </div>

            {/* Chronological Event Audit Log */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 font-extrabold text-white">
                <History className="w-4 h-4 text-amber-400" />
                <span>
                  {isAr
                    ? 'سجل التدقيق الزمني لدورة الحياة (Audit Trail)'
                    : 'Chronological Lifecycle Event History'}
                </span>
              </div>

              {detailState.loading ? (
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-400">
                  {isAr ? 'جاري تحميل السجل...' : 'Loading event history...'}
                </div>
              ) : detailState.history.length === 0 ? (
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-400">
                  {isAr ? 'لا توجد أحداث مسجلة' : 'No history events recorded'}
                </div>
              ) : (
                <div
                  data-testid="lifecycle-detail-history-list"
                  className="space-y-2 max-h-60 overflow-y-auto pe-1"
                >
                  {detailState.history.map((evt) => (
                    <div
                      key={evt.id}
                      className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-neutral-800 text-amber-300 font-mono font-bold text-[10px]">
                            {evt.eventType}
                          </span>
                          <span className="text-neutral-400 font-mono text-[10px]">
                            {evt.fromStatus ? `${evt.fromStatus} → ${evt.toStatus}` : evt.toStatus}
                          </span>
                          <span className="font-bold text-white">
                            {evt.performedByName} ({evt.performedByRole})
                          </span>
                        </div>
                        {evt.note && <p className="text-neutral-300">{evt.note}</p>}
                      </div>
                      <span className="font-mono text-[10px] text-neutral-400 shrink-0">
                        {formatTimestamp(evt.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AppModal>
    </div>
  );
};
