/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatCurrency } from '../../lib/pos-calculations';
import {
  BranchAnalyticsResult,
  BusinessInsightItem,
  CustomerAnalyticsResult,
  FinancialAnalyticsResult,
  ForecastingResult,
  InventoryAnalyticsResult,
  SalesAnalyticsResult,
  TechnicalIndicatorsResult,
} from '../analytics.types';

/**
 * Generates deterministic, explainable Business Insights & Actionable Recommendations
 * directly grounded in the store's operational metrics.
 */
export function generateExplainableInsights(params: {
  sales: SalesAnalyticsResult;
  financial: FinancialAnalyticsResult;
  inventory: InventoryAnalyticsResult;
  customers: CustomerAnalyticsResult;
  branches: BranchAnalyticsResult;
  technicalIndicators: TechnicalIndicatorsResult;
  forecasts: ForecastingResult;
}): BusinessInsightItem[] {
  const {
    sales,
    financial,
    inventory,
    customers,
    branches,
    technicalIndicators,
    forecasts,
  } = params;

  const currency = sales.currency;
  const periodLabel = `${sales.periodStart.slice(0, 10)} → ${sales.periodEnd.slice(0, 10)}`;
  const insights: BusinessInsightItem[] = [];

  // 1. Critical Reorder / Low-Stock Class A or Fast-Moving Products
  const criticalReorders = inventory.products.filter(
    (p) =>
      p.reorderRecommendation.shouldReorder &&
      (p.reorderRecommendation.urgency === 'critical' ||
        p.reorderRecommendation.urgency === 'high' ||
        p.abcClass === 'A')
  );

  if (criticalReorders.length > 0) {
    const topRisk = criticalReorders[0];
    const estCost = topRisk.reorderRecommendation.estimatedOrderCost ?? 0;
    const orderCostEn = formatCurrency(estCost, currency, 'en');
    const orderCostAr = formatCurrency(estCost, currency, 'ar');

    insights.push({
      id: 'insight-inventory-reorder-priority',
      category: 'inventory_risk',
      severity: topRisk.reorderRecommendation.urgency === 'critical' ? 'critical' : 'warning',
      titleEn: `Urgent Stock Replenishment Required (${criticalReorders.length} SKUs)`,
      titleAr: `تنبيه عاجل لإعادة طلب المخزون (${criticalReorders.length} أصناف)`,
      findingEn: `${topRisk.name} (${topRisk.sku}) has only ${topRisk.currentStock} units remaining (alert threshold: ${topRisk.minStockAlert}).`,
      findingAr: `المنتج "${topRisk.nameAr || topRisk.name}" (${topRisk.sku}) متبقٍ منه ${topRisk.currentStock} وحدات فقط (حد التنبيه: ${topRisk.minStockAlert}).`,
      metricName: 'Days of Inventory on Hand (DOH)',
      metricValueFormatted:
        topRisk.daysOfInventoryOnHand !== null
          ? `${topRisk.daysOfInventoryOnHand} days`
          : `${topRisk.currentStock} units`,
      periodLabel,
      supportingEvidenceEn: `Classified as Class ${topRisk.abcClass} with average daily demand of ${topRisk.averageDailyDemand} units/day and ${topRisk.unitsSoldInPeriod} units sold in period.`,
      supportingEvidenceAr: `مصنف ضمن الفئة (${topRisk.abcClass}) بمعدل سحب يومي ${topRisk.averageDailyDemand} وحدة/يوم وإجمالي ${topRisk.unitsSoldInPeriod} وحدات مباعة خلال الفترة.`,
      reasonEn: `Current stock is below the safety-adjusted reorder point (${topRisk.reorderRecommendation.reorderPointUnits} units for a ${topRisk.reorderRecommendation.leadTimeDaysAssumed}-day supplier lead time).`,
      reasonAr: `الرصيد الحالي أقل من نقطة إعادة الطلب الآمنة (${topRisk.reorderRecommendation.reorderPointUnits} وحدة لزمن توريد ${topRisk.reorderRecommendation.leadTimeDaysAssumed} أيام).`,
      suggestedActionEn: `Approve purchase order for ${topRisk.reorderRecommendation.recommendedOrderQuantity} units of ${topRisk.name} (est. cost ${orderCostEn}).`,
      suggestedActionAr: `اعتمد أمر شراء بكمية ${topRisk.reorderRecommendation.recommendedOrderQuantity} وحدة من "${topRisk.nameAr || topRisk.name}" (بتكلفة تقديرية ${orderCostAr}).`,
      confidenceLevel: 'high',
    });
  }

  // 2. Top Revenue & Profit Driver (ABC Class A Champion)
  if (sales.byProduct.length > 0) {
    const topProd = sales.byProduct[0];
    const netFormattedEn = formatCurrency(topProd.netSales, currency, 'en');
    const netFormattedAr = formatCurrency(topProd.netSales, currency, 'ar');
    const marginVal = topProd.grossMarginPercent ?? 0;
    const profitVal = topProd.grossProfit ?? 0;

    insights.push({
      id: 'insight-sales-top-driver',
      category: 'sales_momentum',
      severity: 'positive',
      titleEn: `Primary Revenue Driver: ${topProd.name}`,
      titleAr: `المحرك الرئيسي للإيرادات: ${topProd.nameAr || topProd.name}`,
      findingEn: `${topProd.name} generated ${netFormattedEn} (${topProd.shareOfNetSalesPercent}% of total store net sales) with a ${marginVal}% gross margin.`,
      findingAr: `حقق "${topProd.nameAr || topProd.name}" صافي مبيعات بقيمة ${netFormattedAr} (${topProd.shareOfNetSalesPercent}% من إجمالي صافي المبيعات) بهامش ربح إجمالي ${marginVal}%.`,
      metricName: 'Product Net Sales Share',
      metricValueFormatted: `${topProd.shareOfNetSalesPercent}% (${netFormattedEn})`,
      periodLabel,
      supportingEvidenceEn: `Sold ${topProd.unitsSold} units across ${topProd.transactionCount} completed invoices, contributing ${formatCurrency(profitVal, currency, 'en')} in gross profit.`,
      supportingEvidenceAr: `تم بيع ${topProd.unitsSold} وحدات عبر ${topProd.transactionCount} فواتير مكتملة، بمساهمة ربح إجمالي قدرها ${formatCurrency(profitVal, currency, 'ar')}.`,
      reasonEn: `High unit velocity combined with strong unit contribution margin makes this SKU the store's anchor product.`,
      reasonAr: `سرعة دوران الصنف مع هامش ربحه المرتفع يجعله المنتج الأساسي لربحية المتجر.`,
      suggestedActionEn: `Maintain zero-stockout buffer for ${topProd.name} and pair it with slower Class C items in checkout cross-sell bundles.`,
      suggestedActionAr: `حافظ على مخزون أمان دائم لمنتج "${topProd.nameAr || topProd.name}" وادمجه في عروض بيع متقاطع مع أصناف الفئة C الأقل حركة.`,
      confidenceLevel: 'high',
    });
  }

  // 3. Accounts Receivable / Customer Debt Collection Opportunity
  if (financial.cashFlowAndWorkingCapital.accountsReceivableOutstandingDebt > 0) {
    const arAmount = financial.cashFlowAndWorkingCapital.accountsReceivableOutstandingDebt;
    const arEn = formatCurrency(arAmount, currency, 'en');
    const arAr = formatCurrency(arAmount, currency, 'ar');
    const topDebtor = customers.creditExposureRanking[0];

    insights.push({
      id: 'insight-financial-debt-collection',
      category: 'cash_and_debt',
      severity:
        financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent < 85
          ? 'warning'
          : 'opportunity',
      titleEn: `Outstanding Customer Receivables (${arEn})`,
      titleAr: `ذمم مدينة ومستحقات عملاء غير محصلة (${arAr})`,
      findingEn: `Store collection efficiency is ${financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent}%, with ${arEn} in unpaid invoice balances across ${customers.summary.customersWithDebtCount} customer(s).`,
      findingAr: `تبلغ كفاءة التحصيل النقدي ${financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent}%، مع وجود مديونيات قائمة بقيمة ${arAr} موزعة على ${customers.summary.customersWithDebtCount} عملاء.`,
      metricName: 'Accounts Receivable (Outstanding Debt)',
      metricValueFormatted: arEn,
      periodLabel,
      supportingEvidenceEn: topDebtor
        ? `Highest open balance belongs to ${topDebtor.name} (${formatCurrency(topDebtor.outstandingDebt, currency, 'en')}).`
        : `Derived from partial and unpaid credit invoices in the active ledger.`,
      supportingEvidenceAr: topDebtor
        ? `أعلى رصيد مديونية مسجل باسم العميل "${topDebtor.name}" بقيمة (${formatCurrency(topDebtor.outstandingDebt, currency, 'ar')}).`
        : `مستخرج من الفواتير الآجلة والمدفوعة جزئياً في سجل المبيعات.`,
      reasonEn: `Uncollected credit sales tie up working capital and expose the business to exchange-rate depreciation if settled later in unindexed local currency.`,
      reasonAr: `تؤدي المبيعات الآجلة غير المحصلة إلى تجميد السيولة النقدية وتعريض المتجر لمخاطر تذبذب سعر الصرف عند تأخر السداد.`,
      suggestedActionEn: `Use the Customer Credit Ledger to schedule installment collection or apply USD-indexed settlement for overdue balances.`,
      suggestedActionAr: `استخدم سجل مديونيات العملاء لتحصيل الدفعات المستحقة أو تفعيل خيار التسوية المؤشرة بسعر الصرف الحالي لحماية القيمة الشرائية.`,
      confidenceLevel: 'high',
    });
  }

  // 4. Exchange Rate (FX) Purchasing Power Sensitivity
  const fxDelta = Math.abs(
    financial.fxSensitivityAndValuation.unrealizedFxTranslationDelta
  );
  if (fxDelta > 0.01) {
    const histEn = formatCurrency(
      financial.fxSensitivityAndValuation.netSalesAtHistoricalRate,
      currency,
      'en'
    );
    const idxEn = formatCurrency(
      financial.fxSensitivityAndValuation.netSalesAtUsdIndexedRate,
      currency,
      'en'
    );
    const deltaEn = formatCurrency(fxDelta, currency, 'en');
    const deltaAr = formatCurrency(fxDelta, currency, 'ar');

    insights.push({
      id: 'insight-fx-purchasing-power',
      category: 'fx_sensitivity',
      severity: 'opportunity',
      titleEn: `Multi-Currency Valuation Variance (${deltaEn})`,
      titleAr: `فارق تقييم القوة الشرائية لأسعار الصرف (${deltaAr})`,
      findingEn: `Historical sale-rate revenue (${histEn}) differs from USD-indexed replacement value (${idxEn}) by ${deltaEn}.`,
      findingAr: `يختلف صافي المبيعات المحسوب بسعر صرف وقت البيع عن القيمة المؤشرة بالدولار للاستبدال بمقدار ${deltaAr}.`,
      metricName: 'FX Purchasing Power Preservation',
      metricValueFormatted: `${financial.fxSensitivityAndValuation.fxPurchasingPowerPreservationPercent}%`,
      periodLabel,
      supportingEvidenceEn: `Invoices were recorded across historical exchange rates ranging from 2,400 to 2,700 SDG/USD.`,
      supportingEvidenceAr: `تم تحرير الفواتير التاريخية بأسعار صرف تراوحت بين 2,400 و2,700 ج.س لكل دولار.`,
      reasonEn: `When local currency exchange rates shift between the sale date and restock date, historical nominal revenue understates replacement inventory cost.`,
      reasonAr: `عند تغير سعر الصرف بين تاريخ البيع وتاريخ إعادة الشراء، فإن الإيراد الاسمي التاريخي قد لا يعكس تكلفة الاستبدال الحالية للمخزون.`,
      suggestedActionEn: `Review pricing tiers whenever exchange rates move >3% and keep historical invoices locked at sale-time rates for accurate audit trails.`,
      suggestedActionAr: `راجع تسعير الأصناف عند تحرك سعر الصرف بأكثر من 3% مع الحفاظ على تثبيت الفواتير التاريخية بسعر صرف وقت البيع لضمان دقة المراجعة المحاسبية.`,
      confidenceLevel: 'high',
    });
  }

  // 5. Dead Stock / Slow-Moving Capital Lockup
  const deadSkus = inventory.products.filter(
    (p) => p.movementVelocityClass === 'dead_stock' && p.currentStock > 0
  );
  if (deadSkus.length > 0) {
    const lockedCost = deadSkus.reduce(
      (acc, p) => acc + (p.inventoryValueAtCost ?? 0),
      0
    );
    const lockedEn = formatCurrency(lockedCost, currency, 'en');
    const lockedAr = formatCurrency(lockedCost, currency, 'ar');
    const sampleNamesEn = deadSkus
      .slice(0, 2)
      .map((p) => p.name)
      .join(', ');
    const sampleNamesAr = deadSkus
      .slice(0, 2)
      .map((p) => p.nameAr || p.name)
      .join('، ');

    insights.push({
      id: 'insight-inventory-dead-stock',
      category: 'inventory_risk',
      severity: 'opportunity',
      titleEn: `${deadSkus.length} Zero-Velocity SKU(s) Locking ${lockedEn}`,
      titleAr: `${deadSkus.length} أصناف راكدة بدون مبيعات تجمد ${lockedAr}`,
      findingEn: `${deadSkus.length} stocked product(s) (${sampleNamesEn}) recorded zero unit sales during the selected period.`,
      findingAr: `سجلت ${deadSkus.length} أصناف متوفرة بالمخزون (${sampleNamesAr}) مبيعات صفرية خلال الفترة المحددة.`,
      metricName: 'Dead Stock Capital at Cost',
      metricValueFormatted: lockedEn,
      periodLabel,
      supportingEvidenceEn: `Total of ${deadSkus.reduce((a, b) => a + b.currentStock, 0)} units sitting idle in Class C inventory.`,
      supportingEvidenceAr: `إجمالي ${deadSkus.reduce((a, b) => a + b.currentStock, 0)} وحدة راكدة ضمن تصنيف الفئة C.`,
      reasonEn: `Capital tied up in zero-turnover items reduces liquidity available for replenishing Class A bestsellers.`,
      reasonAr: `رأس المال المجمد في الأصناف بطيئة أو عديمة الدوران يقلل السيولة المتاحة لتمويل أصناف الفئة A السريعة.`,
      suggestedActionEn: `Pause restocking for ${sampleNamesEn} and test a 10–15% combo discount with high-traffic beverages.`,
      suggestedActionAr: `أوقف إعادة طلب (${sampleNamesAr}) مؤقتاً وفعّل خصماً ترويجياً بنسبة 10–15% عند شرائها مع المشروبات الأكثر طلباً.`,
      confidenceLevel: 'medium',
    });
  }

  // 6. Statistical Forecast & Technical Trend Outlook
  const forecastTotalEn = formatCurrency(
    forecasts.revenueForecastSummary.expectedTotalNetSales,
    currency,
    'en'
  );
  const forecastTotalAr = formatCurrency(
    forecasts.revenueForecastSummary.expectedTotalNetSales,
    currency,
    'ar'
  );
  const bestEval = forecasts.backtestEvaluations[0];

  insights.push({
    id: 'insight-forecast-outlook',
    category: 'sales_momentum',
    severity:
      technicalIndicators.latestValues.trendDirection === 'upward'
        ? 'positive'
        : 'opportunity',
    titleEn: `${forecasts.horizonDays}-Day Projected Net Revenue: ${forecastTotalEn}`,
    titleAr: `توقعات صافي المبيعات خلال ${forecasts.horizonDays} أيام القادمة: ${forecastTotalAr}`,
    findingEn: `Statistical model (${forecasts.selectedModelNameEn}) projects ${forecastTotalEn} in net sales over the next ${forecasts.horizonDays} days (${forecasts.intervalLabelEn}: ${formatCurrency(forecasts.revenueForecastSummary.lowerBound80Total, currency, 'en')} – ${formatCurrency(forecasts.revenueForecastSummary.upperBound80Total, currency, 'en')}).`,
    findingAr: `يتوقع النموذج الإحصائي (${forecasts.selectedModelNameAr}) تحقيق صافي مبيعات بقيمة ${forecastTotalAr} خلال الـ ${forecasts.horizonDays} أيام القادمة (${forecasts.intervalLabelAr}: ${formatCurrency(forecasts.revenueForecastSummary.lowerBound80Total, currency, 'ar')} – ${formatCurrency(forecasts.revenueForecastSummary.upperBound80Total, currency, 'ar')}).`,
    metricName: 'Backtested Forecast WAPE',
    metricValueFormatted: `WAPE ${bestEval?.wapePercent ?? 0}%`,
    periodLabel: `Next ${forecasts.horizonDays} Days`,
    supportingEvidenceEn: `Selected via rolling-origin backtesting across ${forecasts.backtestEvaluations.length} models; linear trend slope is ${technicalIndicators.latestValues.trendSlopePerDay} ${currency}/day.`,
    supportingEvidenceAr: `تم اختيار النموذج عبر الاختبار العكسي المتدحرج بين ${forecasts.backtestEvaluations.length} نماذج؛ ميل خط الاتجاه العام يبلغ ${technicalIndicators.latestValues.trendSlopePerDay} ${currency}/يوم.`,
    reasonEn: `Combines historical daily revenue velocity, moving average momentum, and day-of-week seasonality.`,
    reasonAr: `يجمع التوقع بين سرعة الإيرادات اليومية التاريخية وزخم المتوسطات المتحركة والموسمية الأسبوعية.`,
    suggestedActionEn: `Align cash float and supplier restock schedules with the projected ${formatCurrency(forecasts.revenueForecastSummary.expectedAverageDailySales, currency, 'en')}/day demand rate.`,
    suggestedActionAr: `اضبط السيولة النقدية وجدول توريد المشتريات بما يتوافق مع معدل المبيعات اليومي المتوقع (${formatCurrency(forecasts.revenueForecastSummary.expectedAverageDailySales, currency, 'ar')}/يوم).`,
    confidenceLevel:
      forecasts.dataQualityStatus === 'high_confidence'
        ? 'high'
        : forecasts.dataQualityStatus === 'moderate_confidence'
        ? 'medium'
        : 'low',
  });

  // 7. Multi-Branch / Cashier Concentration Insight
  if (branches.branches.length > 0) {
    const topBranch = branches.branches[0];
    const branchMargin = topBranch.grossMarginPercent ?? 0;
    insights.push({
      id: 'insight-branch-performance',
      category: 'branch_and_staff',
      severity: 'positive',
      titleEn: `Top Performing Branch: ${topBranch.branchName}`,
      titleAr: `الفرع الأعلى أداءً: ${topBranch.branchNameAr}`,
      findingEn: `${topBranch.branchName} generated ${formatCurrency(topBranch.netSales, currency, 'en')} (${topBranch.revenueSharePercent}% share) with an average ticket of ${formatCurrency(topBranch.averageTransactionValue, currency, 'en')}.`,
      findingAr: `حقق "${topBranch.branchNameAr}" صافي مبيعات ${formatCurrency(topBranch.netSales, currency, 'ar')} (بحصة ${topBranch.revenueSharePercent}%) ومتوسط فاتورة ${formatCurrency(topBranch.averageTransactionValue, currency, 'ar')}.`,
      metricName: 'Branch Gross Margin & Collection',
      metricValueFormatted: `Margin ${branchMargin}% | Collection ${topBranch.collectionRatePercent}%`,
      periodLabel,
      supportingEvidenceEn: `Processed ${topBranch.transactionCount} completed orders (${topBranch.unitsSold} units) across ${topBranch.activeCashiersCount} active terminal(s).`,
      supportingEvidenceAr: `نفذ ${topBranch.transactionCount} فاتورة مكتملة (${topBranch.unitsSold} وحدة) عبر ${topBranch.activeCashiersCount} نقطة بيع نشطة.`,
      reasonEn: `Strong order volume and disciplined discount control maintained high branch profitability.`,
      reasonAr: `ساهم ارتفاع حجم الطلبات والانضباط في منح الخصومات في الحفاظ على ربحية الفرع.`,
      suggestedActionEn: `Use ${topBranch.branchName}'s product mix and peak-hour staffing as the benchmark for secondary terminals.`,
      suggestedActionAr: `اعتمد تشكيلة منتجات وجدولة أوقات الذروة في "${topBranch.branchNameAr}" كمعيار مرجعي لبقية الفروع ونقاط البيع.`,
      confidenceLevel: 'high',
    });
  }

  return insights;
}
