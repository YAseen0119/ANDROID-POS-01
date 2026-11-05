/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 (Parts 3, 6 & 7): Smart Store Operations, Replenishment, Branch Transfers & Unified Smart Insights Engine
 * Pure, deterministic O(N) analytical rules engine.
 * All outputs are strictly read-only recommendations (`requires_user_approval` / `informational`).
 */

import { formatCurrency } from '../../lib/pos-calculations';
import { Product } from '../../lib/types';
import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  AnalyticsUserContext,
  BranchAnalyticsResult,
  BranchTransferRecommendationItem,
  CustomerAnalyticsResult,
  FinancialAnalyticsResult,
  ForecastingResult,
  InventoryAnalyticsResult,
  SalesAnalyticsResult,
  SmartInsightConfidenceLevel,
  SmartIntelligenceAlertItem,
  SmartReplenishmentRecommendationItem,
  SmartStoreIntelligenceResult,
  TechnicalIndicatorsResult,
  UnmetDemandAnalyticsResult,
} from '../analytics.types';
function round2(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function extractExpiryDateFromProduct(product?: Product): string | null {
  if (!product || !product.customFields) return null;
  const raw =
    product.customFields.expiry_date ||
    product.customFields.expiryDate ||
    product.customFields.expirationDate;
  if (typeof raw === 'string' && raw.trim().length >= 8) {
    return raw.trim();
  }
  return null;
}

export function computeSmartReplenishmentAndTransfers(params: {
  dataset: AnalyticsDatasetSnapshot;
  filters: AnalyticsFilterParams;
  sales: SalesAnalyticsResult;
  inventory: InventoryAnalyticsResult;
  forecasts: ForecastingResult;
  unmetDemand: UnmetDemandAnalyticsResult;
  userContext?: AnalyticsUserContext;
  now?: Date;
}): {
  replenishmentRecommendations: SmartReplenishmentRecommendationItem[];
  branchTransferOpportunities: BranchTransferRecommendationItem[];
} {
  const {
    dataset,
    filters,
    sales,
    inventory,
    forecasts,
    unmetDemand,
    userContext,
    now = new Date(),
  } = params;

  const currency = sales.currency;
  const canViewCost = userContext?.canViewCostAndMargin ?? false;
  const leadTimeDays = Math.max(1, Number(filters.leadTimeDays ?? inventory.leadTimeDaysAssumed ?? 3));
  const safetyStockDays = Math.max(1, Number(filters.safetyStockDays ?? inventory.safetyStockDaysAssumed ?? 2));
  const effectiveBranchId =
    filters.branchId && filters.branchId !== 'all' ? filters.branchId : 'branch-main';

  const catalogById = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));
  const forecastByProdId = new Map(
    forecasts.productDemandForecasts.map((f) => [f.productId, f])
  );
  const unmetByProdId = new Map(
    unmetDemand.topRequestedProducts
      .filter((u) => u.productId)
      .map((u) => [u.productId!, u])
  );

  const replenishmentRecommendations: SmartReplenishmentRecommendationItem[] = [];

  // 1. Registered catalog products replenishment evaluation
  for (const invProd of inventory.products) {
    const rawProd = catalogById.get(invProd.productId);
    const fcItem = forecastByProdId.get(invProd.productId);
    const unmetItem = unmetByProdId.get(invProd.productId);

    const observedSalesDailyVelocity = invProd.averageDailyDemand;
    const observedUnmetDemandUnits = unmetItem?.requestedBaseUnitsTotal ?? 0;
    const unmetDemandInquiriesCount = unmetItem?.inquiryCount ?? 0;
    const weightedUnmetUnits = unmetItem?.estimatedLostUnitsConservative ?? 0;

    const estimatedLatentDailyDemand = round2(
      Math.max(
        fcItem?.estimatedLatentDailyDemand ?? 0,
        observedSalesDailyVelocity + weightedUnmetUnits / 7
      )
    );

    const expiryDateSnapshot = extractExpiryDateFromProduct(rawProd);
    let isExpiringSoonOrExpired = Boolean(
      unmetItem && unmetItem.reasonBreakdown.EXPIRED > 0
    );
    if (expiryDateSnapshot) {
      const expMs = new Date(expiryDateSnapshot).getTime();
      if (!Number.isNaN(expMs) && expMs <= now.getTime() + 14 * 24 * 3600 * 1000) {
        isExpiringSoonOrExpired = true;
      }
    }

    const safetyStockUnits = Math.max(
      invProd.minStockAlert,
      Math.ceil(estimatedLatentDailyDemand * safetyStockDays)
    );
    const reorderPointUnits =
      Math.ceil(estimatedLatentDailyDemand * leadTimeDays) + safetyStockUnits;
    const targetCycleUnits =
      Math.ceil(estimatedLatentDailyDemand * (leadTimeDays + safetyStockDays)) +
      safetyStockUnits;

    const availableAndInbound =
      invProd.currentStock + invProd.pendingInboundPurchaseUnits;
    const rawRecommendedUnits = Math.max(0, targetCycleUnits - availableAndInbound);

    const needsReorder =
      invProd.reorderRecommendation.shouldReorder ||
      rawRecommendedUnits > 0 &&
        (invProd.currentStock <= reorderPointUnits || observedUnmetDemandUnits > 0);

    if (!needsReorder) continue;

    const recommendedOrderUnits = Math.max(
      rawRecommendedUnits,
      invProd.reorderRecommendation.recommendedOrderQuantity,
      observedUnmetDemandUnits > 0
        ? Math.max(1, Math.ceil((weightedUnmetUnits || 1) - availableAndInbound))
        : 0
    );
    if (recommendedOrderUnits <= 0) continue;

    const unitCost = canViewCost ? invProd.unitCost : null;
    const estimatedOrderCost =
      canViewCost && unitCost !== null && unitCost > 0
        ? round2(recommendedOrderUnits * unitCost)
        : null;

    const daysUntilStockout =
      estimatedLatentDailyDemand > 0
        ? round2(invProd.currentStock / estimatedLatentDailyDemand)
        : invProd.daysOfInventoryOnHand;

    let urgency: SmartReplenishmentRecommendationItem['urgency'] = 'MEDIUM';
    if (
      invProd.currentStock <= 0 ||
      (daysUntilStockout !== null && daysUntilStockout <= leadTimeDays) ||
      (observedUnmetDemandUnits >= 3 && invProd.currentStock <= invProd.minStockAlert)
    ) {
      urgency = 'CRITICAL';
    } else if (
      invProd.currentStock <= invProd.minStockAlert ||
      observedUnmetDemandUnits > 0
    ) {
      urgency = 'HIGH';
    }

    const confidenceLevel: SmartInsightConfidenceLevel =
      invProd.unitsSoldInPeriod >= 3 || unmetDemandInquiriesCount >= 3
        ? 'HIGH'
        : invProd.unitsSoldInPeriod >= 1 || unmetDemandInquiriesCount >= 1
        ? 'MEDIUM'
        : 'LOW';

    const costNoteEn =
      estimatedOrderCost !== null
        ? ` (est. PO cost: ${formatCurrency(estimatedOrderCost, currency, 'en')})`
        : '';
    const costNoteAr =
      estimatedOrderCost !== null
        ? ` (بتكلفة تقديرية ${formatCurrency(estimatedOrderCost, currency, 'ar')})`
        : '';

    replenishmentRecommendations.push({
      id: `repl-${invProd.productId}`,
      productId: invProd.productId,
      isRegisteredProduct: true,
      sku: invProd.sku,
      productName: invProd.name,
      productNameAr: invProd.nameAr || null,
      category: invProd.category,
      branchId: effectiveBranchId,
      currentStock: invProd.currentStock,
      pendingInboundUnits: invProd.pendingInboundPurchaseUnits,
      minStockAlert: invProd.minStockAlert,
      observedSalesDailyVelocity,
      observedUnmetDemandUnits,
      unmetDemandInquiriesCount,
      estimatedLatentDailyDemand,
      leadTimeDays,
      safetyStockUnits,
      reorderPointUnits,
      recommendedOrderUnits,
      unitCost,
      estimatedOrderCost,
      daysUntilStockout,
      expirationRiskDetected: isExpiringSoonOrExpired,
      expiryDateSnapshot,
      urgency,
      confidenceLevel,
      explanationEn:
        observedUnmetDemandUnits > 0
          ? `Combines actual sales velocity (${observedSalesDailyVelocity} units/day) with ${unmetDemandInquiriesCount} unmet customer inquiry(s) (${observedUnmetDemandUnits} units requested). Current stock (${invProd.currentStock}) + pending inbound (${invProd.pendingInboundPurchaseUnits}) is below the ${reorderPointUnits}-unit reorder point.`
          : `Current stock (${invProd.currentStock} units) and pending inbound (${invProd.pendingInboundPurchaseUnits} units) are below the safety-adjusted reorder point (${reorderPointUnits} units for a ${leadTimeDays}-day lead time).`,
      explanationAr:
        observedUnmetDemandUnits > 0
          ? `يجمع بين سرعة المبيعات الفعلية (${observedSalesDailyVelocity} وحدة/يوم) وعدد ${unmetDemandInquiriesCount} استفسارات عملاء غير ملباة (${observedUnmetDemandUnits} وحدات مطلوبة). الرصيد الحالي (${invProd.currentStock}) والوارد قيد التوريد (${invProd.pendingInboundPurchaseUnits}) أقل من نقطة إعادة الطلب (${reorderPointUnits} وحدة).`
          : `الرصيد الحالي (${invProd.currentStock} وحدة) والكميات قيد التوريد (${invProd.pendingInboundPurchaseUnits} وحدة) أقل من نقطة إعادة الطلب الآمنة (${reorderPointUnits} وحدة لزمن توريد ${leadTimeDays} أيام).`,
      suggestedActionEn: isExpiringSoonOrExpired
        ? `Inspect shelf batch expiration date first, then approve PO for ${recommendedOrderUnits} fresh units of ${invProd.name}${costNoteEn}.`
        : `Approve purchase order for ${recommendedOrderUnits} units of ${invProd.name}${costNoteEn}.`,
      suggestedActionAr: isExpiringSoonOrExpired
        ? `افحص صلاحية الدفعة الحالية على الرف أولاً، ثم اعتمد أمر شراء لـ ${recommendedOrderUnits} وحدة جديدة من "${invProd.nameAr || invProd.name}"${costNoteAr}.`
        : `اعتمد أمر شراء بكمية ${recommendedOrderUnits} وحدة من "${invProd.nameAr || invProd.name}"${costNoteAr}.`,
      approvalStatus: 'requires_user_approval',
    });
  }

  // 2. Unregistered products with repeated customer inquiries (New Catalog Assortment Opportunities)
  for (const unreg of unmetDemand.unregisteredProductsDemand) {
    if (unreg.isRegisteredProduct) continue;
    const recommendedTrialUnits = Math.max(
      5,
      Math.ceil((unreg.estimatedLostUnitsConservative || unreg.requestedBaseUnitsTotal) * 1.2)
    );
    replenishmentRecommendations.push({
      id: `repl-unreg-${unreg.productKey}`,
      productId: null,
      isRegisteredProduct: false,
      sku: unreg.sku,
      productName: unreg.productName,
      productNameAr: unreg.productNameAr,
      category: unreg.category,
      branchId: unreg.branchesRequested[0] || effectiveBranchId,
      currentStock: null,
      pendingInboundUnits: 0,
      minStockAlert: 5,
      observedSalesDailyVelocity: 0,
      observedUnmetDemandUnits: unreg.requestedBaseUnitsTotal,
      unmetDemandInquiriesCount: unreg.inquiryCount,
      estimatedLatentDailyDemand: round2((unreg.estimatedLostUnitsConservative || 1) / 7),
      leadTimeDays,
      safetyStockUnits: 5,
      reorderPointUnits: 5,
      recommendedOrderUnits: recommendedTrialUnits,
      unitCost: null,
      estimatedOrderCost: null,
      daysUntilStockout: 0,
      expirationRiskDetected: false,
      expiryDateSnapshot: null,
      urgency: unreg.inquiryCount >= 3 ? 'HIGH' : 'MEDIUM',
      confidenceLevel: unreg.inquiryCount >= 3 ? 'HIGH' : 'MEDIUM',
      explanationEn: `Unregistered product requested ${unreg.inquiryCount} time(s) (${unreg.requestedBaseUnitsTotal} total units requested) across ${unreg.distinctBranchesCount} branch(es).`,
      explanationAr: `منتج غير مسجل بالكتالوج طلبه العملاء ${unreg.inquiryCount} مرات (بإجمالي ${unreg.requestedBaseUnitsTotal} وحدات مطلوبة) في ${unreg.distinctBranchesCount} فرع.`,
      suggestedActionEn: `Evaluate supplier availability and approve initial trial batch of ${recommendedTrialUnits} units for "${unreg.productName}".`,
      suggestedActionAr: `قيّم توفر المورد واعتمد دفعة تجريبية أولية بكمية ${recommendedTrialUnits} وحدة من "${unreg.productNameAr || unreg.productName}".`,
      approvalStatus: 'requires_user_approval',
    });
  }

  const urgencyRank: Record<SmartReplenishmentRecommendationItem['urgency'], number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };
  replenishmentRecommendations.sort((a, b) => {
    if (urgencyRank[b.urgency] !== urgencyRank[a.urgency]) {
      return urgencyRank[b.urgency] - urgencyRank[a.urgency];
    }
    return b.observedUnmetDemandUnits - a.observedUnmetDemandUnits || b.recommendedOrderUnits - a.recommendedOrderUnits;
  });

  // 3. Inter-Branch Transfer Opportunities (Part 6)
  // Identify products where one branch has unmet demand inquiries (or high shortage pressure)
  // while another branch has zero unmet demand and available stock above minStockAlert.
  const branchTransferOpportunities: BranchTransferRecommendationItem[] = [];
  if (dataset.branches.length >= 2) {
    const branchById = new Map(dataset.branches.map((b) => [b.id, b]));
    const unmetByProdAndBranch = new Map<
      string,
      Map<string, { inquiries: number; units: number }>
    >();

    for (const req of dataset.unmetDemandRequests || []) {
      if (!req || !req.productId || req.fulfillmentStatus === 'cancelled') continue;
      const bId = req.branchId || 'branch-main';
      let bMap = unmetByProdAndBranch.get(req.productId);
      if (!bMap) {
        bMap = new Map();
        unmetByProdAndBranch.set(req.productId, bMap);
      }
      const entry = bMap.get(bId) || { inquiries: 0, units: 0 };
      entry.inquiries += 1;
      entry.units += Math.max(1, Number(req.requestedBaseUnits || req.requestedQuantity || 1));
      bMap.set(bId, entry);
    }

    for (const invProd of inventory.products) {
      const bMap = unmetByProdAndBranch.get(invProd.productId);
      if (!bMap || invProd.currentStock <= invProd.minStockAlert) continue;

      // Check if one branch has unmet demand while another branch has 0 unmet inquiries
      for (const [shortageBranchId, demandStat] of bMap.entries()) {
        if (demandStat.units <= 0) continue;
        if (
          filters.branchId &&
          filters.branchId !== 'all' &&
          shortageBranchId !== filters.branchId
        ) {
          continue;
        }

        const candidateDonor = dataset.branches.find(
          (b) => b.id !== shortageBranchId && !bMap.has(b.id)
        );
        const shortageBranch = branchById.get(shortageBranchId);
        if (!candidateDonor || !shortageBranch) continue;

        const surplusUnits = Math.max(0, invProd.currentStock - invProd.minStockAlert);
        if (surplusUnits <= 0) continue;

        const recommendedTransferUnits = Math.max(
          1,
          Math.min(surplusUnits, demandStat.units)
        );
        const estimatedRetailValueProtected = round2(
          recommendedTransferUnits * invProd.unitSellingPrice
        );

        branchTransferOpportunities.push({
          id: `transfer-${invProd.productId}-${candidateDonor.id}-to-${shortageBranch.id}`,
          productId: invProd.productId,
          sku: invProd.sku,
          productName: invProd.name,
          productNameAr: invProd.nameAr || null,
          fromBranchId: candidateDonor.id,
          fromBranchName: candidateDonor.name,
          fromBranchNameAr: candidateDonor.nameAr,
          toBranchId: shortageBranch.id,
          toBranchName: shortageBranch.name,
          toBranchNameAr: shortageBranch.nameAr,
          fromBranchEstimatedSurplusUnits: surplusUnits,
          toBranchShortageOrUnmetUnits: demandStat.units,
          toBranchUnmetInquiriesCount: demandStat.inquiries,
          recommendedTransferUnits,
          estimatedRetailValueProtected,
          priority: demandStat.inquiries >= 3 ? 'CRITICAL' : 'HIGH',
          confidenceLevel: demandStat.inquiries >= 2 ? 'HIGH' : 'MEDIUM',
          explanationEn: `${shortageBranch.name} recorded ${demandStat.inquiries} unmet inquiry(s) (${demandStat.units} units) for ${invProd.name}, while ${candidateDonor.name} holds ${surplusUnits} surplus units above minimum alert threshold (${invProd.minStockAlert}).`,
          explanationAr: `سجل "${shortageBranch.nameAr}" عدد ${demandStat.inquiries} استفسارات غير ملباة (${demandStat.units} وحدات) للمنتج "${invProd.nameAr || invProd.name}"، بينما يتوفر فائض يبلغ ${surplusUnits} وحدة فوق حد التنبيه في "${candidateDonor.nameAr}".`,
          suggestedActionEn: `Approve inter-branch transfer of ${recommendedTransferUnits} units from ${candidateDonor.name} to ${shortageBranch.name} (protects ${formatCurrency(estimatedRetailValueProtected, currency, 'en')} in retail demand).`,
          suggestedActionAr: `اعتمد تحويل مخزني بكمية ${recommendedTransferUnits} وحدة من "${candidateDonor.nameAr}" إلى "${shortageBranch.nameAr}" (لتغطية طلب بقيمة بيعية ${formatCurrency(estimatedRetailValueProtected, currency, 'ar')}).`,
          approvalStatus: 'requires_user_approval',
        });
      }
    }
  }

  return {
    replenishmentRecommendations,
    branchTransferOpportunities,
  };
}

/**
 * Generates the Unified Smart Store Intelligence Alerts across all 10 required categories (Part 3 & Part 7),
 * with deterministic deduplication, priority ranking, confidence levels, and role-based redaction.
 */
export function computeSmartStoreIntelligence(params: {
  dataset: AnalyticsDatasetSnapshot;
  filters: AnalyticsFilterParams;
  sales: SalesAnalyticsResult;
  financial: FinancialAnalyticsResult;
  inventory: InventoryAnalyticsResult;
  customers: CustomerAnalyticsResult;
  branches: BranchAnalyticsResult;
  technicalIndicators: TechnicalIndicatorsResult;
  forecasts: ForecastingResult;
  unmetDemand: UnmetDemandAnalyticsResult;
  userContext?: AnalyticsUserContext;
  now?: Date;
}): SmartStoreIntelligenceResult {
  const {
    dataset,
    filters,
    sales,
    financial,
    inventory,
    customers,
    branches,
    technicalIndicators,
    forecasts,
    unmetDemand,
    userContext,
    now = new Date(),
  } = params;

  const currency = sales.currency;
  const canViewFinancials = userContext?.canViewFinancials ?? false;
  const canViewCost = userContext?.canViewCostAndMargin ?? false;
  const periodLabel = `${sales.periodStart.slice(0, 10)} → ${sales.periodEnd.slice(0, 10)}`;
  const effectiveBranchId =
    filters.branchId && filters.branchId !== 'all' ? filters.branchId : 'all';

  const { replenishmentRecommendations, branchTransferOpportunities } =
    computeSmartReplenishmentAndTransfers({
      dataset,
      filters,
      sales,
      inventory,
      forecasts,
      unmetDemand,
      userContext,
      now,
    });

  const rawAlerts: SmartIntelligenceAlertItem[] = [];
  const seenDedupeKeys = new Set<string>();

  function pushAlert(alert: SmartIntelligenceAlertItem) {
    if (seenDedupeKeys.has(alert.dedupeKey)) return;
    seenDedupeKeys.add(alert.dedupeKey);
    rawAlerts.push(alert);
  }

  // 1. UNMET_DEMAND Alerts (Catalog & Unregistered)
  if (unmetDemand.topRequestedProducts.length > 0) {
    const topUnmet = unmetDemand.topRequestedProducts[0];
    const lostRevFormattedEn =
      topUnmet.estimatedLostRevenueConservative !== null
        ? formatCurrency(topUnmet.estimatedLostRevenueConservative, currency, 'en')
        : 'INSUFFICIENT_DATA';
    const lostRevFormattedAr =
      topUnmet.estimatedLostRevenueConservative !== null
        ? formatCurrency(topUnmet.estimatedLostRevenueConservative, currency, 'ar')
        : 'بيانات تسعير غير كافية';

    pushAlert({
      id: `smart-unmet-top-${topUnmet.productKey}`,
      dedupeKey: `UNMET_DEMAND:${topUnmet.productKey}:${effectiveBranchId}`,
      category: 'UNMET_DEMAND',
      legacyCategory: 'inventory_risk',
      severity:
        topUnmet.inquiryCount >= 3 || topUnmet.confirmedPurchaseIntentCount >= 2
          ? 'CRITICAL'
          : 'HIGH',
      priority: 96,
      confidenceLevel: topUnmet.lostSalesConfidence === 'INSUFFICIENT_DATA' ? 'MEDIUM' : topUnmet.lostSalesConfidence,
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      productId: topUnmet.productId,
      titleEn: `High Unmet Customer Demand: ${topUnmet.productName} (${topUnmet.requestedBaseUnitsTotal} units)`,
      titleAr: `طلب عملاء مرتفع غير ملبى: ${topUnmet.productNameAr || topUnmet.productName} (${topUnmet.requestedBaseUnitsTotal} وحدات)`,
      descriptionEn: `Customers inquired ${topUnmet.inquiryCount} time(s) for ${topUnmet.requestedBaseUnitsTotal} units (${topUnmet.confirmedPurchaseIntentUnits} units with confirmed purchase intent) due to ${topUnmet.primaryReason}.`,
      descriptionAr: `سجل العملاء ${topUnmet.inquiryCount} استفسارات لإجمالي ${topUnmet.requestedBaseUnitsTotal} وحدات (منها ${topUnmet.confirmedPurchaseIntentUnits} وحدات بنية شراء مؤكدة) بسبب (${topUnmet.primaryReason}).`,
      evidenceMetrics: [
        {
          name: 'Customer Inquiries',
          valueFormatted: `${topUnmet.inquiryCount} inquiries (${topUnmet.requestedBaseUnitsTotal} units)`,
          rawValue: topUnmet.requestedBaseUnitsTotal,
        },
        {
          name: 'Conservative Lost Revenue',
          valueFormatted: lostRevFormattedEn,
          rawValue: topUnmet.estimatedLostRevenueConservative,
        },
      ],
      affectedRecords: [topUnmet.productId || topUnmet.productKey],
      periodAnalyzed: periodLabel,
      explanationEn: `Recorded directly at POS terminals when customers requested unavailable stock. Separate from completed sales.`,
      explanationAr: `تم توثيقها مباشرة من نقاط البيع عند طلب العملاء لصنف غير متوفر، وهي مفصولة تماماً عن المبيعات الفعلية.`,
      recommendedActionEn: topUnmet.isRegisteredProduct
        ? `Prioritize restocking ${topUnmet.productName} and notify returning customers when inventory arrives.`
        : `Evaluate adding "${topUnmet.productName}" (${lostRevFormattedAr}) as a trial catalog item.`,
      recommendedActionAr: topUnmet.isRegisteredProduct
        ? `أعطِ الأولوية لإعادة توفير "${topUnmet.productNameAr || topUnmet.productName}" وإبلاغ العملاء المهتمين فور وصول الشحنة.`
        : `ادرس إضافة "${topUnmet.productNameAr || topUnmet.productName}" كصنف تجريبي جديد في الكتالوج.`,
      dataQualityStatus:
        topUnmet.lostSalesEstimationStatus === 'ESTIMATED'
          ? 'complete'
          : 'insufficient_data',
      sourceMetrics: ['unmet_demand_requests', 'products.stock'],
      approvalStatus: 'requires_user_approval',
    });
  }

  // Expired batch unmet demand alert
  const expiredUnmetItems = unmetDemand.topRequestedProducts.filter(
    (p) => p.reasonBreakdown.EXPIRED > 0
  );
  if (expiredUnmetItems.length > 0) {
    const expProd = expiredUnmetItems[0];
    pushAlert({
      id: `smart-expired-demand-${expProd.productKey}`,
      dedupeKey: `INVENTORY_RISK:EXPIRED_INQUIRY:${expProd.productKey}`,
      category: 'INVENTORY_RISK',
      legacyCategory: 'inventory_risk',
      severity: 'CRITICAL',
      priority: 95,
      confidenceLevel: 'VERIFIED',
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      productId: expProd.productId,
      titleEn: `Expired Shelf Stock Prevented Sale: ${expProd.productName}`,
      titleAr: `منتج منتهي الصلاحية منع إتمام البيع: ${expProd.productNameAr || expProd.productName}`,
      descriptionEn: `${expProd.reasonBreakdown.EXPIRED} customer inquiry(s) for ${expProd.productName} could not be fulfilled because available shelf units were expired.`,
      descriptionAr: `تعذر تلبية ${expProd.reasonBreakdown.EXPIRED} طلبات عملاء للمنتج "${expProd.productNameAr || expProd.productName}" بسبب انتهاء صلاحية الوحدات الموجودة.`,
      evidenceMetrics: [
        {
          name: 'Expired Batch Inquiries',
          valueFormatted: `${expProd.reasonBreakdown.EXPIRED} inquiries`,
          rawValue: expProd.reasonBreakdown.EXPIRED,
        },
      ],
      affectedRecords: [expProd.productId || expProd.productKey],
      periodAnalyzed: periodLabel,
      explanationEn: `Cashier recorded EXPIRED unavailability reason when attempting to fulfill customer request.`,
      explanationAr: `سجل الكاشير سبب عدم التوفر (منتهي الصلاحية EXPIRED) أثناء محاولة البيع للعميل.`,
      recommendedActionEn: `Quarantine expired units of ${expProd.productName} via a Damage/Loss stock movement and order fresh replacement batch.`,
      recommendedActionAr: `اعزل الوحدات المنتهية الصلاحية من "${expProd.productNameAr || expProd.productName}" عبر حركة تالف/فاقد واطلب دفعة جديدة صالحة.`,
      dataQualityStatus: 'complete',
      sourceMetrics: ['unmet_demand_requests', 'products.customFields'],
      approvalStatus: 'requires_user_approval',
    });
  }

  // 2. STOCKOUT_RISK (Repeated stockouts & critical low stock)
  const criticalReorders = inventory.products.filter(
    (p) =>
      p.reorderRecommendation.shouldReorder &&
      (p.reorderRecommendation.urgency === 'critical' ||
        p.reorderRecommendation.urgency === 'high' ||
        p.currentStock <= 0)
  );
  if (criticalReorders.length > 0) {
    const topRisk = criticalReorders[0];
    pushAlert({
      id: `smart-stockout-risk-${topRisk.productId}`,
      dedupeKey: `STOCKOUT_RISK:${topRisk.productId}:${effectiveBranchId}`,
      category: 'STOCKOUT_RISK',
      legacyCategory: 'inventory_risk',
      severity: topRisk.currentStock <= 0 ? 'CRITICAL' : 'HIGH',
      priority: 92,
      confidenceLevel: 'VERIFIED',
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      productId: topRisk.productId,
      titleEn: `Stockout Risk across ${criticalReorders.length} SKU(s): ${topRisk.name}`,
      titleAr: `مخاطر نفاد المخزون في ${criticalReorders.length} أصناف: ${topRisk.nameAr || topRisk.name}`,
      descriptionEn: `${topRisk.name} (${topRisk.sku}) has ${topRisk.currentStock} units remaining vs. alert threshold of ${topRisk.minStockAlert} units (Pending inbound: ${topRisk.pendingInboundPurchaseUnits}).`,
      descriptionAr: `المنتج "${topRisk.nameAr || topRisk.name}" (${topRisk.sku}) متبقٍ منه ${topRisk.currentStock} وحدات مقابل حد تنبيه ${topRisk.minStockAlert} وحدات (الوارد قيد التوريد: ${topRisk.pendingInboundPurchaseUnits}).`,
      evidenceMetrics: [
        {
          name: 'Current Stock',
          valueFormatted: `${topRisk.currentStock} units`,
          rawValue: topRisk.currentStock,
        },
        {
          name: 'Days of Inventory on Hand',
          valueFormatted:
            topRisk.daysOfInventoryOnHand !== null
              ? `${topRisk.daysOfInventoryOnHand} days`
              : '0 days',
          rawValue: topRisk.daysOfInventoryOnHand,
        },
      ],
      affectedRecords: criticalReorders.map((c) => c.productId),
      periodAnalyzed: periodLabel,
      explanationEn: `Available stock plus pending inbound orders is below the lead-time safety reorder point (${topRisk.reorderRecommendation.reorderPointUnits} units).`,
      explanationAr: `الرصيد المتاح مضافاً إليه الكميات قيد التوريد أقل من نقطة إعادة الطلب الآمنة (${topRisk.reorderRecommendation.reorderPointUnits} وحدة).`,
      recommendedActionEn: `Review and approve replenishment order of ${topRisk.reorderRecommendation.recommendedOrderQuantity} units for ${topRisk.name}.`,
      recommendedActionAr: `راجع واعتمد أمر التزويد بكمية ${topRisk.reorderRecommendation.recommendedOrderQuantity} وحدة للمنتج "${topRisk.nameAr || topRisk.name}".`,
      dataQualityStatus: 'complete',
      sourceMetrics: ['products.stock', 'purchases', 'sale_items'],
      approvalStatus: 'requires_user_approval',
    });
  }

  // 3. REPLENISHMENT (Smart Replenishment Summary Alert)
  if (replenishmentRecommendations.length > 0) {
    const topRepl = replenishmentRecommendations[0];
    const totalOrderCost = replenishmentRecommendations.reduce(
      (acc, r) => acc + (r.estimatedOrderCost ?? 0),
      0
    );
    pushAlert({
      id: `smart-replenishment-batch`,
      dedupeKey: `REPLENISHMENT:BATCH:${effectiveBranchId}`,
      category: 'REPLENISHMENT',
      legacyCategory: 'inventory_risk',
      severity: topRepl.urgency === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      priority: 88,
      confidenceLevel: topRepl.confidenceLevel,
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      productId: topRepl.productId,
      titleEn: `${replenishmentRecommendations.length} Smart Replenishment Recommendation(s) Ready`,
      titleAr: `${replenishmentRecommendations.length} توصيات ذكية لإعادة التزويد والشراء جاهزة للمراجعة`,
      descriptionEn: `Top priority: ${topRepl.productName} requires ${topRepl.recommendedOrderUnits} units (Latent demand: ${topRepl.estimatedLatentDailyDemand} units/day).`,
      descriptionAr: `الأولوية القصوى: "${topRepl.productNameAr || topRepl.productName}" يتطلب شراء ${topRepl.recommendedOrderUnits} وحدة (معدل الطلب الكامن: ${topRepl.estimatedLatentDailyDemand} وحدة/يوم).`,
      evidenceMetrics: [
        {
          name: 'Recommended SKUs',
          valueFormatted: `${replenishmentRecommendations.length} SKUs`,
          rawValue: replenishmentRecommendations.length,
        },
        ...(canViewCost && totalOrderCost > 0
          ? [
              {
                name: 'Estimated Total PO Cost',
                valueFormatted: formatCurrency(totalOrderCost, currency, 'en'),
                rawValue: totalOrderCost,
              },
            ]
          : []),
      ],
      affectedRecords: replenishmentRecommendations.map(
        (r) => r.productId || r.id
      ),
      periodAnalyzed: periodLabel,
      explanationEn: topRepl.explanationEn,
      explanationAr: topRepl.explanationAr,
      recommendedActionEn: topRepl.suggestedActionEn,
      recommendedActionAr: topRepl.suggestedActionAr,
      dataQualityStatus: 'complete',
      sourceMetrics: ['products', 'sale_items', 'unmet_demand_requests', 'purchases'],
      approvalStatus: 'requires_user_approval',
    });
  }

  // 4. TRANSFER_OPPORTUNITY (Inter-Branch Stock Transfer)
  if (branchTransferOpportunities.length > 0) {
    const topTr = branchTransferOpportunities[0];
    pushAlert({
      id: topTr.id,
      dedupeKey: `TRANSFER_OPPORTUNITY:${topTr.productId}:${topTr.fromBranchId}:${topTr.toBranchId}`,
      category: 'TRANSFER_OPPORTUNITY',
      legacyCategory: 'branch_and_staff',
      severity: topTr.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
      priority: 85,
      confidenceLevel: topTr.confidenceLevel,
      lifecycleStatus: 'active',
      branchId: topTr.toBranchId,
      productId: topTr.productId,
      titleEn: `Branch Transfer Opportunity: ${topTr.recommendedTransferUnits} units of ${topTr.productName}`,
      titleAr: `فرصة تحويل بين الفروع: ${topTr.recommendedTransferUnits} وحدة من ${topTr.productNameAr || topTr.productName}`,
      descriptionEn: topTr.explanationEn,
      descriptionAr: topTr.explanationAr,
      evidenceMetrics: [
        {
          name: 'Transfer Quantity',
          valueFormatted: `${topTr.recommendedTransferUnits} units`,
          rawValue: topTr.recommendedTransferUnits,
        },
        {
          name: 'Retail Demand Protected',
          valueFormatted: formatCurrency(topTr.estimatedRetailValueProtected, currency, 'en'),
          rawValue: topTr.estimatedRetailValueProtected,
        },
      ],
      affectedRecords: [topTr.productId, topTr.fromBranchId, topTr.toBranchId],
      periodAnalyzed: periodLabel,
      explanationEn: `Reallocating existing surplus stock avoids external supplier lead time while capturing unmet branch inquiries.`,
      explanationAr: `إعادة توزيع الفائض المتاح بين الفروع يوفر وقت انتظار المورد الخارجي ويلبي طلبات العملاء فوراً.`,
      recommendedActionEn: topTr.suggestedActionEn,
      recommendedActionAr: topTr.suggestedActionAr,
      dataQualityStatus: 'complete',
      sourceMetrics: ['products.stock', 'unmet_demand_requests', 'branches'],
      approvalStatus: 'requires_user_approval',
    });
  }

  // 5. RISING_DEMAND (Top velocity & growing demand)
  if (sales.byProduct.length > 0) {
    const topProd = sales.byProduct[0];
    const netEn = formatCurrency(topProd.netSales, currency, 'en');
    const netAr = formatCurrency(topProd.netSales, currency, 'ar');
    pushAlert({
      id: `smart-rising-demand-${topProd.id}`,
      dedupeKey: `RISING_DEMAND:${topProd.id}:${effectiveBranchId}`,
      category: 'RISING_DEMAND',
      legacyCategory: 'sales_momentum',
      severity: 'INFO',
      priority: 74,
      confidenceLevel: 'VERIFIED',
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      productId: topProd.id,
      titleEn: `Leading Demand Velocity: ${topProd.name} (${topProd.unitsSold} units sold)`,
      titleAr: `أعلى زخم طلب ومبيعات: ${topProd.nameAr || topProd.name} (${topProd.unitsSold} وحدة مباعة)`,
      descriptionEn: `${topProd.name} generated ${netEn} (${topProd.shareOfNetSalesPercent}% of store net sales) across ${topProd.transactionCount} completed orders.`,
      descriptionAr: `حقق "${topProd.nameAr || topProd.name}" صافي مبيعات ${netAr} (${topProd.shareOfNetSalesPercent}% من إجمالي صافي المبيعات) عبر ${topProd.transactionCount} فواتير مكتملة.`,
      evidenceMetrics: [
        {
          name: 'Net Sales Share',
          valueFormatted: `${topProd.shareOfNetSalesPercent}% (${netEn})`,
          rawValue: topProd.netSales,
        },
        {
          name: 'Units Sold',
          valueFormatted: `${topProd.unitsSold} units`,
          rawValue: topProd.unitsSold,
        },
      ],
      affectedRecords: [topProd.id],
      periodAnalyzed: periodLabel,
      explanationEn: `High unit velocity and consistent checkout frequency make this SKU the primary traffic driver.`,
      explanationAr: `سرعة دوران الصنف وتكرار شرائه في الفواتير يجعلانه المحرك الأول للمبيعات.`,
      recommendedActionEn: `Maintain zero-stockout safety buffer for ${topProd.name} and cross-merchandise with slower Class C items.`,
      recommendedActionAr: `حافظ على مخزون أمان دائم للمنتج "${topProd.nameAr || topProd.name}" وادمجه مع أصناف الفئة C لرفع متوسط الفاتورة.`,
      dataQualityStatus: 'complete',
      sourceMetrics: ['sales', 'sale_items'],
      approvalStatus: 'informational',
    });
  }

  // 6. INVENTORY_RISK (Dead stock / slow moving capital lockup)
  const deadSkus = inventory.products.filter(
    (p) => p.movementVelocityClass === 'dead_stock' && p.currentStock > 0
  );
  if (deadSkus.length > 0) {
    const lockedCost = deadSkus.reduce(
      (acc, p) => acc + (p.inventoryValueAtCost ?? 0),
      0
    );
    const lockedRetail = deadSkus.reduce(
      (acc, p) => acc + p.inventoryValueAtRetail,
      0
    );
    const valToShow = canViewCost && lockedCost > 0 ? lockedCost : lockedRetail;
    const valEn = formatCurrency(valToShow, currency, 'en');
    const valAr = formatCurrency(valToShow, currency, 'ar');
    const sampleEn = deadSkus.slice(0, 2).map((p) => p.name).join(', ');
    const sampleAr = deadSkus.slice(0, 2).map((p) => p.nameAr || p.name).join('، ');

    pushAlert({
      id: `smart-inventory-dead-stock`,
      dedupeKey: `INVENTORY_RISK:DEAD_STOCK:${effectiveBranchId}`,
      category: 'INVENTORY_RISK',
      legacyCategory: 'inventory_risk',
      severity: 'MEDIUM',
      priority: 68,
      confidenceLevel: 'HIGH',
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      titleEn: `${deadSkus.length} Dead-Stock SKU(s) Holding ${valEn}`,
      titleAr: `${deadSkus.length} أصناف راكدة بدون مبيعات بقيمة ${valAr}`,
      descriptionEn: `${deadSkus.length} stocked product(s) (${sampleEn}) recorded zero unit sales and zero customer inquiries during the analyzed period.`,
      descriptionAr: `سجلت ${deadSkus.length} أصناف متوفرة بالمخزون (${sampleAr}) صفراً في المبيعات خلال الفترة المحللة.`,
      evidenceMetrics: [
        {
          name: canViewCost ? 'Capital Locked at Cost' : 'Retail Value Idle',
          valueFormatted: valEn,
          rawValue: valToShow,
        },
        {
          name: 'Idle Units',
          valueFormatted: `${deadSkus.reduce((a, b) => a + b.currentStock, 0)} units`,
          rawValue: deadSkus.reduce((a, b) => a + b.currentStock, 0),
        },
      ],
      affectedRecords: deadSkus.map((d) => d.productId),
      periodAnalyzed: periodLabel,
      explanationEn: `Zero inventory turnover ties up shelf space and working capital needed for high-demand items.`,
      explanationAr: `توقف دوران هذه الأصناف يجمد السيولة النقدية والمساحة التخزينية التي تحتاجها الأصناف السريعة.`,
      recommendedActionEn: `Pause restocking for ${sampleEn} and run a promotional bundle with fast-moving products.`,
      recommendedActionAr: `أوقف إعادة شراء (${sampleAr}) مؤقتاً وفعّل عرض ترويجي مدمج لتصفيتها.`,
      dataQualityStatus: 'complete',
      sourceMetrics: ['products.stock', 'sale_items'],
      approvalStatus: 'informational',
    });
  }

  // 7. FINANCIAL_RISK (Receivables, Payables, Cost Increases, Margin Compression, FX Variance)
  if (canViewFinancials) {
    if (financial.cashFlowAndWorkingCapital.accountsReceivableOutstandingDebt > 0) {
      const arAmount = financial.cashFlowAndWorkingCapital.accountsReceivableOutstandingDebt;
      const arEn = formatCurrency(arAmount, currency, 'en');
      const arAr = formatCurrency(arAmount, currency, 'ar');
      const topDebtor = customers.creditExposureRanking[0];

      pushAlert({
        id: `smart-financial-receivables`,
        dedupeKey: `FINANCIAL_RISK:RECEIVABLES:${effectiveBranchId}`,
        category: 'FINANCIAL_RISK',
        legacyCategory: 'cash_and_debt',
        severity:
          financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent < 85
            ? 'HIGH'
            : 'MEDIUM',
        priority: 82,
        confidenceLevel: 'VERIFIED',
        lifecycleStatus: 'active',
        branchId: effectiveBranchId,
        titleEn: `Outstanding Customer Receivables: ${arEn}`,
        titleAr: `ذمم مدينة ومستحقات عملاء غير محصلة: ${arAr}`,
        descriptionEn: `Collection efficiency is ${financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent}% with ${arEn} unpaid across ${customers.summary.customersWithDebtCount} customer(s).`,
        descriptionAr: `نسبة التحصيل النقدي ${financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent}% مع مديونيات قائمة بقيمة ${arAr} لدى ${customers.summary.customersWithDebtCount} عملاء.`,
        evidenceMetrics: [
          {
            name: 'Accounts Receivable',
            valueFormatted: arEn,
            rawValue: arAmount,
          },
          {
            name: 'Collection Efficiency',
            valueFormatted: `${financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent}%`,
            rawValue: financial.cashFlowAndWorkingCapital.collectionEfficiencyPercent,
          },
        ],
        affectedRecords: customers.creditExposureRanking.map((c) => c.customerId),
        periodAnalyzed: periodLabel,
        explanationEn: topDebtor
          ? `Largest open balance is ${topDebtor.name} (${formatCurrency(topDebtor.outstandingDebt, currency, 'en')}). Delaying collection risks FX purchasing power erosion.`
          : `Uncollected credit balances reduce available cash for inventory replenishment.`,
        explanationAr: topDebtor
          ? `أعلى مديونية مسجلة على "${topDebtor.name}" (${formatCurrency(topDebtor.outstandingDebt, currency, 'ar')}). تأخر التحصيل يعرض السيولة لتآكل القوة الشرائية.`
          : `الأرصدة الآجلة غير المحصلة تقلل السيولة النقدية المتاحة لتمويل المشتريات.`,
        recommendedActionEn: `Follow up on overdue balances in the Customer Debt Ledger and use USD-indexed settlement where applicable.`,
        recommendedActionAr: `تابع تحصيل المديونيات من سجل ديون العملاء مع استخدام خيار التسوية المؤشرة بسعر الصرف لحماية القيمة.`,
        dataQualityStatus: 'complete',
        sourceMetrics: ['sales', 'payments', 'customers'],
        approvalStatus: 'informational',
      });
    }

    // Check abnormal supplier cost increases (>10% increase in priceHistory)
    const costJumpProducts = dataset.products.filter(
      (p) =>
        p.previousCostPrice !== undefined &&
        p.previousCostPrice > 0 &&
        p.costPrice > p.previousCostPrice * 1.1
    );
    if (canViewCost && costJumpProducts.length > 0) {
      const topJump = costJumpProducts[0];
      const jumpPct = round2(
        ((topJump.costPrice - (topJump.previousCostPrice || topJump.costPrice)) /
          (topJump.previousCostPrice || 1)) *
          100
      );
      pushAlert({
        id: `smart-financial-cost-increase-${topJump.id}`,
        dedupeKey: `FINANCIAL_RISK:COST_SPIKE:${topJump.id}`,
        category: 'FINANCIAL_RISK',
        legacyCategory: 'profit_margin',
        severity: jumpPct >= 20 ? 'HIGH' : 'MEDIUM',
        priority: 77,
        confidenceLevel: 'VERIFIED',
        lifecycleStatus: 'active',
        branchId: effectiveBranchId,
        productId: topJump.id,
        titleEn: `Supplier Cost Increase Detected (+${jumpPct}% on ${topJump.name})`,
        titleAr: `ارتفاع ملحوظ في تكلفة المورد (+${jumpPct}% على ${topJump.nameAr || topJump.name})`,
        descriptionEn: `${topJump.name} unit cost rose from ${topJump.previousCostPrice} to ${topJump.costPrice} (${costJumpProducts.length} SKU(s) experienced >10% cost increases).`,
        descriptionAr: `ارتفعت تكلفة الوحدة للمنتج "${topJump.nameAr || topJump.name}" من ${topJump.previousCostPrice} إلى ${topJump.costPrice} (${costJumpProducts.length} أصناف شهدت زيادة تكلفة >10%).`,
        evidenceMetrics: [
          {
            name: 'Unit Cost Increase',
            valueFormatted: `+${jumpPct}%`,
            rawValue: jumpPct,
          },
        ],
        affectedRecords: costJumpProducts.map((p) => p.id),
        periodAnalyzed: periodLabel,
        explanationEn: `Verified from product priceHistory audit trail. Unadjusted selling prices after supplier cost hikes compress gross margins.`,
        explanationAr: `موثق من سجل تغييرات الأسعار (priceHistory). عدم مراجعة سعر البيع بعد ارتفاع تكلفة المورد يقلص هامش الربح الإجمالي.`,
        recommendedActionEn: `Audit gross margin on ${topJump.name} and compare alternative supplier quotes before next PO.`,
        recommendedActionAr: `راجع هامش الربح للمنتج "${topJump.nameAr || topJump.name}" وقارن عروض أسعار الموردين قبل أمر الشراء القادم.`,
        dataQualityStatus: 'complete',
        sourceMetrics: ['products.priceHistory'],
        approvalStatus: 'informational',
      });
    }

    // FX Sensitivity Alert
    const fxDelta = Math.abs(
      financial.fxSensitivityAndValuation.unrealizedFxTranslationDelta
    );
    if (fxDelta > 0.01) {
      const deltaEn = formatCurrency(fxDelta, currency, 'en');
      const deltaAr = formatCurrency(fxDelta, currency, 'ar');
      pushAlert({
        id: `smart-financial-fx-variance`,
        dedupeKey: `FINANCIAL_RISK:FX_VARIANCE:${effectiveBranchId}`,
        category: 'FINANCIAL_RISK',
        legacyCategory: 'fx_sensitivity',
        severity: 'MEDIUM',
        priority: 72,
        confidenceLevel: 'VERIFIED',
        lifecycleStatus: 'active',
        branchId: effectiveBranchId,
        titleEn: `Multi-Currency Replacement Value Variance (${deltaEn})`,
        titleAr: `فارق القيمة الاستبدالية لأسعار الصرف (${deltaAr})`,
        descriptionEn: `Historical sale-rate revenue differs from USD-indexed replacement valuation by ${deltaEn} (Preservation: ${financial.fxSensitivityAndValuation.fxPurchasingPowerPreservationPercent}%).`,
        descriptionAr: `يختلف صافي المبيعات بسعر صرف وقت البيع عن القيمة المؤشرة بالدولار للاستبدال بمقدار ${deltaAr} (نسبة الحفاظ على القوة الشرائية: ${financial.fxSensitivityAndValuation.fxPurchasingPowerPreservationPercent}%).`,
        evidenceMetrics: [
          {
            name: 'FX Purchasing Power Preservation',
            valueFormatted: `${financial.fxSensitivityAndValuation.fxPurchasingPowerPreservationPercent}%`,
            rawValue: financial.fxSensitivityAndValuation.fxPurchasingPowerPreservationPercent,
          },
        ],
        affectedRecords: ['exchange_rates'],
        periodAnalyzed: periodLabel,
        explanationEn: `Exchange rate shifts between invoice timestamp and restock date create replacement cost variance.`,
        explanationAr: `تغير سعر الصرف بين تاريخ تحرير الفاتورة وتاريخ إعادة الشراء يولد فارقاً في تكلفة استبدال البضاعة.`,
        recommendedActionEn: `Review foreign-currency-linked product pricing whenever USD/SDG moves by >3%.`,
        recommendedActionAr: `راجع تسعير الأصناف المرتبطة بالعملات الأجنبية عند تحرك سعر الصرف بأكثر من 3%.`,
        dataQualityStatus: 'complete',
        sourceMetrics: ['sales.exchangeRatesSnapshot', 'exchange_rates'],
        approvalStatus: 'informational',
      });
    }
  }

  // 8. SALES_ANOMALY (Returns / Discount Rate / Demand Capture Gap)
  if (
    sales.summary.discountRatePercent >= 5 ||
    sales.summary.merchandiseReturnsCount > 0 ||
    unmetDemand.summary.totalRequestedBaseUnits > 0
  ) {
    const capturePct = unmetDemand.summary.demandCaptureEfficiencyPercent ?? 100;
    pushAlert({
      id: `smart-sales-demand-capture`,
      dedupeKey: `SALES_ANOMALY:DEMAND_CAPTURE:${effectiveBranchId}`,
      category: 'SALES_ANOMALY',
      legacyCategory: 'sales_momentum',
      severity: capturePct < 80 ? 'HIGH' : 'LOW',
      priority: 70,
      confidenceLevel: 'HIGH',
      lifecycleStatus: 'active',
      branchId: effectiveBranchId,
      titleEn: `Demand Capture Efficiency: ${capturePct}% (${sales.summary.unitsSold} sold vs ${unmetDemand.summary.totalRequestedBaseUnits} unmet units)`,
      titleAr: `كفاءة استيعاب طلبات العملاء: ${capturePct}% (${sales.summary.unitsSold} مباعة مقابل ${unmetDemand.summary.totalRequestedBaseUnits} غير ملباة)`,
      descriptionEn: `Store fulfilled ${sales.summary.unitsSold} net units out of ${unmetDemand.summary.observedTotalDemandUnits} total observed customer demand units (Discount rate: ${sales.summary.discountRatePercent}%, Returns: ${sales.summary.merchandiseReturnsCount}).`,
      descriptionAr: `لبى المتجر ${sales.summary.unitsSold} وحدة صافية من إجمالي ${unmetDemand.summary.observedTotalDemandUnits} وحدة طلب مرصود (نسبة الخصومات: ${sales.summary.discountRatePercent}%، المرتجعات: ${sales.summary.merchandiseReturnsCount}).`,
      evidenceMetrics: [
        {
          name: 'Demand Capture Ratio',
          valueFormatted: `${capturePct}%`,
          rawValue: capturePct,
        },
        {
          name: 'Discount Rate',
          valueFormatted: `${sales.summary.discountRatePercent}%`,
          rawValue: sales.summary.discountRatePercent,
        },
      ],
      affectedRecords: ['sales', 'unmet_demand_requests'],
      periodAnalyzed: periodLabel,
      explanationEn: `Compares completed net unit sales against recorded customer inquiries for unavailable items.`,
      explanationAr: `يقارن الوحدات المباعة الفعلية بإجمالي طلبات العملاء المسجلة للأصناف غير المتوفرة.`,
      recommendedActionEn: `Target replenishment on the top requested unavailable SKUs to raise demand capture above 92%.`,
      recommendedActionAr: `وجه السيولة لتوفير الأصناف الأعلى طلباً لرفع كفاءة استيعاب الطلب إلى أكثر من 92%.`,
      dataQualityStatus: 'complete',
      sourceMetrics: ['sales', 'returns', 'unmet_demand_requests'],
      approvalStatus: 'informational',
    });
  }

  // 9. BRANCH_IMBALANCE (Branch performance & unmet demand comparison)
  if (branches.branches.length > 0) {
    const topBranch = branches.branches[0];
    pushAlert({
      id: `smart-branch-leader-${topBranch.branchId}`,
      dedupeKey: `BRANCH_IMBALANCE:${topBranch.branchId}`,
      category: 'BRANCH_IMBALANCE',
      legacyCategory: 'branch_and_staff',
      severity: 'INFO',
      priority: 64,
      confidenceLevel: 'VERIFIED',
      lifecycleStatus: 'active',
      branchId: topBranch.branchId,
      titleEn: `Branch Performance Benchmark: ${topBranch.branchName} (${topBranch.revenueSharePercent}% share)`,
      titleAr: `مؤشر أداء الفروع: ${topBranch.branchNameAr} (حصة ${topBranch.revenueSharePercent}%)`,
      descriptionEn: `${topBranch.branchName} processed ${topBranch.transactionCount} orders (${formatCurrency(topBranch.netSales, currency, 'en')}) with ${topBranch.collectionRatePercent}% cash collection efficiency.`,
      descriptionAr: `نفذ "${topBranch.branchNameAr}" عدد ${topBranch.transactionCount} فاتورة (${formatCurrency(topBranch.netSales, currency, 'ar')}) بكفاءة تحصيل نقدي ${topBranch.collectionRatePercent}%.`,
      evidenceMetrics: [
        {
          name: 'Branch Revenue Share',
          valueFormatted: `${topBranch.revenueSharePercent}%`,
          rawValue: topBranch.revenueSharePercent,
        },
        {
          name: 'Collection Rate',
          valueFormatted: `${topBranch.collectionRatePercent}%`,
          rawValue: topBranch.collectionRatePercent,
        },
      ],
      affectedRecords: [topBranch.branchId],
      periodAnalyzed: periodLabel,
      explanationEn: `Evaluates revenue distribution, average ticket size, and stock availability across branches.`,
      explanationAr: `يقيم توزيع الإيرادات ومتوسط الفاتورة وتوفر المخزون بين الفروع.`,
      recommendedActionEn: `Align secondary branch assortment with ${topBranch.branchName}'s top-selling SKUs.`,
      recommendedActionAr: `وائم تشكيلة المخزون في الفروع الأخرى مع الأصناف الأكثر مبيعاً في "${topBranch.branchNameAr}".`,
      dataQualityStatus: 'complete',
      sourceMetrics: ['sales', 'branches'],
      approvalStatus: 'informational',
    });
  }

  // 10. SEASONAL_PATTERN (Weekly / Intraday Peak Pattern & Forecast Outlook)
  const activeWeekdays = [...sales.weekdayDistribution].sort(
    (a, b) => b.netSales - a.netSales
  );
  const peakWeekday = activeWeekdays[0];
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
  pushAlert({
    id: `smart-seasonal-forecast-outlook`,
    dedupeKey: `SEASONAL_PATTERN:OUTLOOK:${effectiveBranchId}:${forecasts.horizonDays}`,
    category: 'SEASONAL_PATTERN',
    legacyCategory: 'sales_momentum',
    severity: 'INFO',
    priority: 60,
    confidenceLevel:
      forecasts.dataQualityStatus === 'high_confidence'
        ? 'HIGH'
        : forecasts.dataQualityStatus === 'moderate_confidence'
        ? 'MEDIUM'
        : 'LOW',
    lifecycleStatus: 'active',
    branchId: effectiveBranchId,
    titleEn: `${forecasts.horizonDays}-Day Demand Outlook (${forecastTotalEn}) & Weekly Cycle`,
    titleAr: `توقعات الطلب لـ ${forecasts.horizonDays} أيام (${forecastTotalAr}) والنمط الأسبوعي`,
    descriptionEn: `${forecasts.selectedModelNameEn} projects ${forecastTotalEn} over ${forecasts.horizonDays} days.${peakWeekday && peakWeekday.netSales > 0 ? ` Peak day-of-week is ${peakWeekday.labelEn}.` : ''}`,
    descriptionAr: `يتوقع نموذج (${forecasts.selectedModelNameAr}) صافي مبيعات ${forecastTotalAr} خلال ${forecasts.horizonDays} أيام.${peakWeekday && peakWeekday.netSales > 0 ? ` يوم الذروة الأسبوعي هو ${peakWeekday.labelAr}.` : ''}`,
    evidenceMetrics: [
      {
        name: `${forecasts.horizonDays}d Projected Sales`,
        valueFormatted: forecastTotalEn,
        rawValue: forecasts.revenueForecastSummary.expectedTotalNetSales,
      },
      {
        name: 'Backtest WAPE',
        valueFormatted: `${forecasts.backtestEvaluations[0]?.wapePercent ?? 0}%`,
        rawValue: forecasts.backtestEvaluations[0]?.wapePercent ?? 0,
      },
    ],
    affectedRecords: ['forecasts'],
    periodAnalyzed: `Next ${forecasts.horizonDays} Days`,
    explanationEn:
      forecasts.predictiveDemandComparison?.comparisonNoteEn ||
      forecasts.selectionReasonEn,
    explanationAr:
      forecasts.predictiveDemandComparison?.comparisonNoteAr ||
      forecasts.selectionReasonAr,
    recommendedActionEn: `Schedule supplier deliveries 24 hours prior to ${peakWeekday?.labelEn || 'peak trading days'} and prepare ${formatCurrency(forecasts.revenueForecastSummary.expectedAverageDailySales, currency, 'en')}/day working stock.`,
    recommendedActionAr: `جدول استلام طلبيات الموردين قبل 24 ساعة من ${peakWeekday?.labelAr || 'أيام الذروة'} وجهز مخزوناً تشغيلياً يغطي ${formatCurrency(forecasts.revenueForecastSummary.expectedAverageDailySales, currency, 'ar')}/يوم.`,
    dataQualityStatus:
      forecasts.horizonSufficiencyStatus === 'sufficient_history'
        ? 'complete'
        : 'partial_history',
    sourceMetrics: ['sales.dailySeries', 'unmet_demand_requests', 'forecasts'],
    approvalStatus: 'informational',
  });

  rawAlerts.sort((a, b) => b.priority - a.priority);

  const inventoryRisks = rawAlerts.filter(
    (a) =>
      a.category === 'INVENTORY_RISK' ||
      a.category === 'STOCKOUT_RISK' ||
      a.category === 'REPLENISHMENT' ||
      a.category === 'UNMET_DEMAND'
  );
  const financialRisks = rawAlerts.filter((a) => a.category === 'FINANCIAL_RISK');
  const branchInsights = rawAlerts.filter(
    (a) =>
      a.category === 'BRANCH_IMBALANCE' || a.category === 'TRANSFER_OPPORTUNITY'
  );

  const byCategory: Record<string, number> = {
    INVENTORY_RISK: 0,
    UNMET_DEMAND: 0,
    RISING_DEMAND: 0,
    STOCKOUT_RISK: 0,
    REPLENISHMENT: 0,
    FINANCIAL_RISK: 0,
    SALES_ANOMALY: 0,
    BRANCH_IMBALANCE: 0,
    SEASONAL_PATTERN: 0,
    TRANSFER_OPPORTUNITY: 0,
  };
  for (const a of rawAlerts) {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  }

  const totalReplCost = replenishmentRecommendations.reduce(
    (sum, r) => sum + (r.estimatedOrderCost ?? 0),
    0
  );
  const totalTransferableUnits = branchTransferOpportunities.reduce(
    (sum, t) => sum + (t.recommendedTransferUnits || 0),
    0
  );
  const expiringProductsCount = replenishmentRecommendations.filter(
    (r) => r.expirationRiskDetected
  ).length;

  return {
    generatedAt: now.toISOString(),
    currency,
    overview: {
      totalActiveAlerts: rawAlerts.length,
      criticalAlertsCount: rawAlerts.filter((a) => a.severity === 'CRITICAL')
        .length,
      highAlertsCount: rawAlerts.filter((a) => a.severity === 'HIGH').length,
      replenishmentRecommendationsCount: replenishmentRecommendations.length,
      totalRecommendedReplenishmentCost: canViewCost
        ? round2(totalReplCost)
        : null,
      branchTransferOpportunitiesCount: branchTransferOpportunities.length,
      totalTransferableUnits,
      expiringProductsCount,
      byCategory: byCategory as any,
    },
    unmetDemand,
    smartAlerts: rawAlerts,
    inventoryRisks,
    financialRisks,
    branchInsights,
    replenishmentRecommendations,
    branchTransferOpportunities,
  };
}
