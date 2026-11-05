/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  AnalyticsOverviewResponse,
  AnalyticsUserContext,
  MetricDefinitionMeta,
} from './analytics.types';
import {
  enforceScopedFilters,
  resolveAnalyticsUserContext,
  sanitizeBranchesForRole,
  sanitizeCustomersForRole,
  sanitizeFinancialsForRole,
  sanitizeForecastsForRole,
  sanitizeInsightsForRole,
  sanitizeIntelligenceForRole,
  sanitizeInventoryForRole,
  sanitizeSalesForRole,
} from './analytics.permissions';
import { computeSalesAnalytics } from './calculations/sales.metrics';
import { computeFinancialAnalytics } from './calculations/financial.metrics';
import { computeInventoryAnalytics } from './calculations/inventory.metrics';
import {
  computeBranchAnalytics,
  computeCustomerAnalytics,
} from './calculations/customer-branch.metrics';
import { computeTechnicalIndicators } from './indicators/technical-analysis';
import { computeForecasts } from './forecasting/forecasting.engine';
import { generateExplainableInsights } from './insights/insights.service';
import { computeUnmetDemandAnalytics } from './calculations/unmet-demand.metrics';
import { computeSmartStoreIntelligence } from './calculations/replenishment.metrics';

export const ANALYTICS_METRICS_DICTIONARY: MetricDefinitionMeta[] = [
  {
    key: 'gross_sales',
    nameEn: 'Gross Sales (Pre-Discount, Ex-Tax)',
    nameAr: 'إجمالي المبيعات (قبل الخصم وبدون الضريبة)',
    formulaEn: 'Σ (Ex-Tax Line Subtotal before Discount) for completed transactions (voided excluded)',
    formulaAr: 'مجموع قيمة الأصناف قبل الخصم وبدون الضريبة للفواتير المكتملة (مع استبعاد الفواتير الملغاة)',
    unit: 'currency',
    sourceTables: ['sales', 'sale_items'],
  },
  {
    key: 'net_sales',
    nameEn: 'Net Sales Revenue',
    nameAr: 'صافي المبيعات (بعد الخصم والمرتجعات وبدون الضريبة)',
    formulaEn: 'Gross Sales − Item Discounts − Global Invoice Discounts − Returned Merchandise Net Amount',
    formulaAr: 'إجمالي المبيعات − خصومات الأصناف − خصم الفاتورة العام − صافي المرتجعات الفعلية',
    unit: 'currency',
    sourceTables: ['sales', 'sale_items', 'returns', 'return_items'],
  },
  {
    key: 'cogs',
    nameEn: 'Cost of Goods Sold (COGS) & Cost Quality Hierarchy',
    nameAr: 'تكلفة البضاعة المباعة (COGS) وتصنيف دقة التكلفة',
    formulaEn: 'Σ (Historical Frozen Cost → PriceHistory Timeline Cost → Current Catalog Cost [flagged Estimated]) − Returned Units Cost',
    formulaAr: 'مجموع (التكلفة المثبتة وقت البيع ← سجل تغيرات الأسعار التاريخي ← تكلفة الكتالوج الحالية مع وسمها كتقديرية) − تكلفة المرتجعات',
    unit: 'currency',
    sourceTables: ['sale_items', 'products', 'returns'],
  },
  {
    key: 'gross_profit',
    nameEn: 'Gross Profit & Profit After Recorded Shrinkage',
    nameAr: 'إجمالي الربح والربح بعد الفاقد المسجل',
    formulaEn: 'Gross Profit = Net Sales − COGS; Profit After Shrinkage = Gross Profit − Recorded Damage/Loss; Net Operating Profit = null unless Fixed Operating Expenses supplied',
    formulaAr: 'إجمالي الربح = صافي المبيعات − تكلفة البضاعة المباعة؛ الربح بعد الفاقد = إجمالي الربح − التلف والفاقد المسجل',
    unit: 'currency',
    sourceTables: ['sales', 'sale_items', 'products', 'stock_movements'],
  },
  {
    key: 'atv_upt',
    nameEn: 'Average Transaction Value (ATV) & Units Per Transaction (UPT)',
    nameAr: 'متوسط قيمة الفاتورة (ATV) ومتوسط الوحدات لكل فاتورة (UPT)',
    formulaEn: 'ATV = Net Sales / Completed Transactions; UPT = Net Units Sold / Completed Transactions',
    formulaAr: 'متوسط الفاتورة = صافي المبيعات ÷ عدد الفواتير المكتملة؛ الوحدات للفاتورة = صافي الوحدات المباعة ÷ عدد الفواتير',
    unit: 'currency',
    sourceTables: ['sales', 'sale_items'],
  },
  {
    key: 'stock_turnover_doh',
    nameEn: 'Cost-Based Stock Turnover, Unit Sell-Through & DOH',
    nameAr: 'معدل دوران المخزون بالتكلفة، نسبة تصريف الوحدات، وأيام الكفاية (DOH)',
    formulaEn: 'Cost Turnover = COGS / Reconstructed Avg Inventory at Cost ((Begin + End)/2); Sell-Through = Net Units Sold / Avg Stock Units; DOH = Current Stock / Avg Daily Demand',
    formulaAr: 'معدل الدوران المالي = تكلفة المبيعات ÷ متوسط المخزون بالتكلفة؛ تصريف الوحدات = الوحدات المباعة ÷ متوسط الوحدات؛ أيام الكفاية = الرصيد ÷ السحب اليومي',
    unit: 'ratio',
    sourceTables: ['products', 'stock_movements', 'sale_items'],
  },
  {
    key: 'abc_classification',
    nameEn: 'ABC Pareto Classification',
    nameAr: 'تصنيف باريتو للمخزون والمنتجات (ABC)',
    formulaEn: 'Class A: top ~75% cumulative value; Class B: 75%–92%; Class C: remaining ~8%',
    formulaAr: 'الفئة A: أعلى ~75% من القيمة التراكمية؛ الفئة B: من 75% إلى 92%؛ الفئة C: النسبة المتبقية',
    unit: 'percentage',
    sourceTables: ['products', 'sale_items'],
  },
  {
    key: 'technical_sma_ema_rsi_macd',
    nameEn: 'Retail Technical Indicators (SMA, EMA, RSI 14, MACD 12/26/9)',
    nameAr: 'المؤشرات الفنية للمبيعات (SMA, EMA, RSI 14, MACD 12/26/9)',
    formulaEn: 'SMA(N) = ΣY/N; EMA(N) = αY_t + (1−α)EMA_{t−1}; RSI(14) = 100 − 100/(1 + AvgGain/AvgLoss); MACD = EMA(12) − EMA(26)',
    formulaAr: 'المتوسط البسيط والأسي ومؤشر القوة النسبية لـ 14 يوماً وتقارب وتباعد المتوسطات المتحركة على السلسلة الزمنية للمبيعات',
    unit: 'currency',
    sourceTables: ['sales'],
  },
  {
    key: 'statistical_forecast_wape',
    nameEn: 'Rolling-Origin Statistical Forecasting (MAE, WAPE %, Bias % & Coverage)',
    nameAr: 'التنبؤ الإحصائي بالاختبار العكسي المتدحرج (MAE, WAPE %, Bias %)',
    formulaEn: 'WAPE % = (Σ |Actual − Forecast| / Σ |Actual|) × 100; Bias % = (Σ (Forecast − Actual) / Σ |Actual|) × 100 across multi-origin rolling splits vs Naive baseline',
    formulaAr: 'نسبة الخطأ المطلق المرجح (WAPE %) ونسبة الانحياز (Bias %) عبر نقاط قطع زمنية متعددة مقارنة بالنموذج المرجعي البسيط',
    unit: 'percentage',
    sourceTables: ['sales', 'sale_items', 'products'],
  },
  {
    key: 'unmet_demand_and_lost_sales',
    nameEn: 'Customer Demand Intelligence & Conservative Lost Sales Estimation',
    nameAr: 'ذكاء طلبات العملاء وتقدير المبيعات المفقودة التحفظي',
    formulaEn: 'Weighted Lost Units = Σ (BaseUnits × IntentWeight[0.65 confirmed, 0.35 standard, 0.15 24h-repeat, 0.0 fulfilled]); Demand Capture % = Actual Sold / (Actual Sold + Unmet Base Units)',
    formulaAr: 'الوحدات المفقودة المرجحة = مجموع (الوحدات × معامل التحقق [65% نية مؤكدة، 35% عادي، 15% تكرار 24 ساعة])؛ كفاءة استيعاب الطلب = المباع الفعلي ÷ إجمالي الطلب المرصود',
    unit: 'count',
    sourceTables: ['unmet_demand_requests', 'products', 'sale_items'],
  },
];

/**
 * Pure, deterministic orchestrator that computes the complete BI & Predictive Analytics suite
 * from a dataset snapshot, filter parameters, and server-verified user context.
 */
export function computeFullAnalyticsOverview(
  dataset: AnalyticsDatasetSnapshot,
  rawFilters: AnalyticsFilterParams = {},
  rawUser?: Partial<AnalyticsUserContext>,
  referenceDate: Date = new Date()
): AnalyticsOverviewResponse {
  const userContext = resolveAnalyticsUserContext(
    {
      userId: rawUser?.userId,
      userName: rawUser?.userName,
      role: rawUser?.role,
      branchId: rawUser?.assignedBranchId,
      terminalName: rawUser?.assignedTerminalName,
    },
    dataset.users
  );

  const filtersApplied = enforceScopedFilters(rawFilters, userContext);

  const rawSales = computeSalesAnalytics(dataset, filtersApplied, referenceDate);
  const rawFinancial = computeFinancialAnalytics(
    dataset,
    filtersApplied,
    rawSales,
    referenceDate
  );
  const rawInventory = computeInventoryAnalytics(
    dataset,
    filtersApplied,
    rawSales,
    referenceDate
  );
  const rawCustomers = computeCustomerAnalytics(
    dataset,
    filtersApplied,
    referenceDate
  );
  const rawBranches = computeBranchAnalytics(dataset, filtersApplied, referenceDate);
  const technicalIndicators = computeTechnicalIndicators(
    dataset,
    filtersApplied,
    rawSales,
    referenceDate
  );
  const rawForecasts = computeForecasts(
    dataset,
    filtersApplied,
    rawSales,
    referenceDate
  );

  const rawUnmetDemand = computeUnmetDemandAnalytics(
    dataset,
    filtersApplied,
    rawSales,
    rawInventory,
    userContext,
    referenceDate
  );

  const rawIntelligence = computeSmartStoreIntelligence({
    dataset,
    filters: filtersApplied,
    sales: rawSales,
    financial: rawFinancial,
    inventory: rawInventory,
    customers: rawCustomers,
    branches: rawBranches,
    technicalIndicators,
    forecasts: rawForecasts,
    unmetDemand: rawUnmetDemand,
    userContext,
    now: referenceDate,
  });

  const rawInsights = generateExplainableInsights({
    sales: rawSales,
    financial: rawFinancial,
    inventory: rawInventory,
    customers: rawCustomers,
    branches: rawBranches,
    technicalIndicators,
    forecasts: rawForecasts,
  });

  return {
    generatedAt: referenceDate.toISOString(),
    filtersApplied,
    userContext,
    sourceOfTruthMatrix: dataset.sourceOfTruthMatrix,
    sales: sanitizeSalesForRole(rawSales, userContext),
    financial: sanitizeFinancialsForRole(rawFinancial, userContext),
    inventory: sanitizeInventoryForRole(rawInventory, userContext),
    customers: sanitizeCustomersForRole(rawCustomers, userContext),
    branches: sanitizeBranchesForRole(rawBranches, userContext),
    technicalIndicators,
    forecasts: sanitizeForecastsForRole(rawForecasts, userContext),
    insights: sanitizeInsightsForRole(rawInsights, userContext),
    intelligence: sanitizeIntelligenceForRole(rawIntelligence, userContext),
    metricsDictionary: ANALYTICS_METRICS_DICTIONARY,
  };
}
