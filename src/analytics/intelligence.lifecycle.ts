/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import {
  AnalyticsOverviewResponse,
  AnalyticsUserContext,
  BusinessInsightItem,
  IntelligenceLifecycleEventRecord,
  IntelligenceLifecycleEventType,
  IntelligenceLifecycleItemRecord,
  IntelligenceLifecycleListResponse,
  IntelligenceLifecycleQueryFilter,
  IntelligenceLifecycleScopeType,
  IntelligenceLifecycleStatus,
  IntelligenceLifecycleStream,
  IntelligenceLifecycleSummaryCounts,
  SmartAlertLifecycleStatus,
  SmartInsightConfidenceLevel,
} from './analytics.types';

export interface IntelligenceLifecycleCandidate {
  dedupeKey: string;
  itemStream: IntelligenceLifecycleStream;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  priority: number;
  confidenceLevel: SmartInsightConfidenceLevel;
  scopeType: IntelligenceLifecycleScopeType;
  branchId: string | null;
  productId: string | null;
  titleEn: string;
  titleAr: string;
  summaryEn: string;
  summaryAr: string;
  explanationEn: string;
  explanationAr: string;
  recommendationEn: string;
  recommendationAr: string;
  conditionHash: string;
  evidenceJson: IntelligenceLifecycleItemRecord['evidenceJson'];
}

export class LifecycleActionError extends Error {
  statusCode: number;
  errorCode: string;
  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const FINANCIAL_CATEGORIES = new Set([
  'FINANCIAL_RISK',
  'profit_margin',
  'cash_and_debt',
  'fx_sensitivity',
]);

export function isFinancialLifecycleItem(item: { category: string }): boolean {
  return FINANCIAL_CATEGORIES.has(item.category);
}

export function canUserAccessLifecycleItem(
  item: { scopeType: IntelligenceLifecycleScopeType; branchId: string | null; category: string },
  userContext: AnalyticsUserContext
): boolean {
  if (isFinancialLifecycleItem(item) && !userContext.canViewFinancials) {
    return false;
  }
  if (!userContext.canViewAllBranches && userContext.assignedBranchId) {
    if (
      item.scopeType === 'BRANCH' &&
      item.branchId &&
      item.branchId !== 'all' &&
      item.branchId !== userContext.assignedBranchId
    ) {
      return false;
    }
  }
  return true;
}

export function toLegacyAlertStatus(status: IntelligenceLifecycleStatus): SmartAlertLifecycleStatus {
  switch (status) {
    case 'ACKNOWLEDGED':
      return 'acknowledged';
    case 'RESOLVED':
      return 'resolved';
    case 'DISMISSED':
      return 'dismissed';
    default:
      return 'active';
  }
}

function normalizeBranchId(branchId?: string | null): string | null {
  if (!branchId || branchId === 'all' || branchId === 'global') {
    return null;
  }
  return branchId;
}

function mapLegacySeverity(
  sev: BusinessInsightItem['severity'],
  smartSev?: BusinessInsightItem['smartSeverity']
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' {
  if (smartSev) return smartSev;
  switch (sev) {
    case 'critical':
      return 'CRITICAL';
    case 'warning':
      return 'HIGH';
    case 'opportunity':
      return 'MEDIUM';
    default:
      return 'INFO';
  }
}

/**
 * Extracts deterministic IntelligenceLifecycleCandidate items from all 4 intelligence engines
 * (`smartAlerts`, `replenishmentRecommendations`, `branchTransferOpportunities`, `insights`).
 */
export function extractCandidatesFromOverview(
  overview: AnalyticsOverviewResponse
): IntelligenceLifecycleCandidate[] {
  const candidates: IntelligenceLifecycleCandidate[] = [];
  const seenKeys = new Set<string>();

  // 1. Smart Operational Alerts (`overview.intelligence.smartAlerts`)
  for (const alert of overview.intelligence?.smartAlerts || []) {
    const dedupeKey = alert.dedupeKey || `smart_alert:${alert.id}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const branchId = normalizeBranchId(alert.branchId);
    const scopeType: IntelligenceLifecycleScopeType = branchId ? 'BRANCH' : 'GLOBAL';
    const metricSig = (alert.evidenceMetrics || [])
      .map((m) => `${m.name}:${m.rawValue ?? m.valueFormatted}`)
      .join('|');

    candidates.push({
      dedupeKey,
      itemStream: 'smart_alert',
      category: alert.category,
      severity: alert.severity,
      priority: alert.priority ?? 70,
      confidenceLevel: alert.confidenceLevel || 'HIGH',
      scopeType,
      branchId,
      productId: alert.productId || null,
      titleEn: alert.titleEn,
      titleAr: alert.titleAr,
      summaryEn: alert.descriptionEn,
      summaryAr: alert.descriptionAr,
      explanationEn: alert.explanationEn,
      explanationAr: alert.explanationAr,
      recommendationEn: alert.recommendedActionEn,
      recommendationAr: alert.recommendedActionAr,
      conditionHash: `${alert.category}:${alert.severity}:${metricSig}`,
      evidenceJson: {
        metrics: alert.evidenceMetrics || [],
        affectedRecords: alert.affectedRecords || [],
        periodAnalyzed: alert.periodAnalyzed,
        sourceMetrics: alert.sourceMetrics || [],
        extra: {
          legacyCategory: alert.legacyCategory,
          dataQualityStatus: alert.dataQualityStatus,
          approvalStatus: alert.approvalStatus,
        },
      },
    });
  }

  // 2. Smart Replenishment Recommendations (`overview.intelligence.replenishmentRecommendations`)
  for (const rec of overview.intelligence?.replenishmentRecommendations || []) {
    const prodKey = rec.productId || rec.sku || rec.productName.toLowerCase().replace(/\s+/g, '-');
    const branchId = normalizeBranchId(rec.branchId);
    const dedupeKey = `replenishment:${prodKey}:${branchId || 'global'}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const severityMap: Record<typeof rec.urgency, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> = {
      CRITICAL: 'CRITICAL',
      HIGH: 'HIGH',
      MEDIUM: 'MEDIUM',
      LOW: 'LOW',
    };
    const priorityMap: Record<typeof rec.urgency, number> = {
      CRITICAL: 94,
      HIGH: 82,
      MEDIUM: 65,
      LOW: 45,
    };

    candidates.push({
      dedupeKey,
      itemStream: 'replenishment',
      category: 'REPLENISHMENT',
      severity: severityMap[rec.urgency] || 'MEDIUM',
      priority: priorityMap[rec.urgency] || 65,
      confidenceLevel: rec.confidenceLevel || 'HIGH',
      scopeType: branchId ? 'BRANCH' : 'GLOBAL',
      branchId,
      productId: rec.productId || null,
      titleEn: `Restock ${rec.productName} (+${rec.recommendedOrderUnits} units)`,
      titleAr: `إعادة تزويد ${rec.productNameAr || rec.productName} (+${rec.recommendedOrderUnits} وحدة)`,
      summaryEn: rec.explanationEn,
      summaryAr: rec.explanationAr,
      explanationEn: rec.explanationEn,
      explanationAr: rec.explanationAr,
      recommendationEn: rec.suggestedActionEn,
      recommendationAr: rec.suggestedActionAr,
      conditionHash: `replenish:${rec.currentStock ?? 'na'}:${rec.recommendedOrderUnits}:${rec.unmetDemandInquiriesCount}`,
      evidenceJson: {
        metrics: [
          {
            name: 'Current Stock',
            valueFormatted: `${rec.currentStock ?? 0} units`,
            rawValue: rec.currentStock ?? 0,
          },
          {
            name: 'Recommended Order',
            valueFormatted: `${rec.recommendedOrderUnits} units`,
            rawValue: rec.recommendedOrderUnits,
          },
          {
            name: 'Reorder Point (ROP)',
            valueFormatted: `${rec.reorderPointUnits} units`,
            rawValue: rec.reorderPointUnits,
          },
          {
            name: 'Unmet Inquiries',
            valueFormatted: `${rec.unmetDemandInquiriesCount} (${rec.observedUnmetDemandUnits} units)`,
            rawValue: rec.unmetDemandInquiriesCount,
          },
        ],
        affectedRecords: [rec.productId || rec.sku || rec.productName],
        periodAnalyzed: overview.intelligence?.unmetDemand?.periodEnd || 'Current Period',
        sourceMetrics: ['currentStock', 'estimatedLatentDailyDemand', 'reorderPointUnits'],
        extra: {
          sku: rec.sku,
          estimatedOrderCost: rec.estimatedOrderCost,
          daysUntilStockout: rec.daysUntilStockout,
          leadTimeDays: rec.leadTimeDays,
          safetyStockUnits: rec.safetyStockUnits,
        },
      },
    });
  }

  // 3. Inter-Branch Transfer Opportunities (`overview.intelligence.branchTransferOpportunities`)
  for (const tr of overview.intelligence?.branchTransferOpportunities || []) {
    const dedupeKey = `branch_transfer:${tr.productId}:${tr.fromBranchId}:${tr.toBranchId}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    candidates.push({
      dedupeKey,
      itemStream: 'branch_transfer',
      category: 'TRANSFER_OPPORTUNITY',
      severity: tr.priority === 'CRITICAL' ? 'CRITICAL' : tr.priority === 'HIGH' ? 'HIGH' : 'MEDIUM',
      priority: tr.priority === 'CRITICAL' ? 90 : tr.priority === 'HIGH' ? 78 : 62,
      confidenceLevel: tr.confidenceLevel || 'HIGH',
      scopeType: 'GLOBAL',
      branchId: normalizeBranchId(tr.toBranchId),
      productId: tr.productId,
      titleEn: `Transfer ${tr.recommendedTransferUnits} units of ${tr.productName} (${tr.fromBranchName} → ${tr.toBranchName})`,
      titleAr: `تحويل ${tr.recommendedTransferUnits} وحدة من ${tr.productNameAr || tr.productName} (${tr.fromBranchNameAr} ← ${tr.toBranchNameAr})`,
      summaryEn: tr.explanationEn,
      summaryAr: tr.explanationAr,
      explanationEn: tr.explanationEn,
      explanationAr: tr.explanationAr,
      recommendationEn: tr.suggestedActionEn,
      recommendationAr: tr.suggestedActionAr,
      conditionHash: `transfer:${tr.recommendedTransferUnits}:${tr.toBranchUnmetInquiriesCount}`,
      evidenceJson: {
        metrics: [
          {
            name: 'Recommended Transfer',
            valueFormatted: `${tr.recommendedTransferUnits} units`,
            rawValue: tr.recommendedTransferUnits,
          },
          {
            name: 'Source Surplus',
            valueFormatted: `${tr.fromBranchEstimatedSurplusUnits} units (${tr.fromBranchName})`,
            rawValue: tr.fromBranchEstimatedSurplusUnits,
          },
          {
            name: 'Destination Shortage',
            valueFormatted: `${tr.toBranchShortageOrUnmetUnits} units (${tr.toBranchName})`,
            rawValue: tr.toBranchShortageOrUnmetUnits,
          },
          {
            name: 'Protected Retail Value',
            valueFormatted: `${tr.estimatedRetailValueProtected}`,
            rawValue: tr.estimatedRetailValueProtected,
          },
        ],
        affectedRecords: [tr.productId, tr.fromBranchId, tr.toBranchId],
        periodAnalyzed: 'Active Multi-Branch Snapshot',
        sourceMetrics: ['fromBranchEstimatedSurplusUnits', 'toBranchShortageOrUnmetUnits'],
        extra: {
          sku: tr.sku,
          fromBranchId: tr.fromBranchId,
          fromBranchName: tr.fromBranchName,
          toBranchId: tr.toBranchId,
          toBranchName: tr.toBranchName,
        },
      },
    });
  }

  // 4. Explainable BI Insights (`overview.insights`)
  for (const ins of overview.insights || []) {
    const dedupeKey = `bi_insight:${ins.id}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const severity = mapLegacySeverity(ins.severity, ins.smartSeverity);
    const branchId = normalizeBranchId(overview.filtersApplied?.branchId);

    candidates.push({
      dedupeKey,
      itemStream: 'bi_insight',
      category: ins.smartCategory || ins.category,
      severity,
      priority: ins.priority ?? (severity === 'CRITICAL' ? 90 : severity === 'HIGH' ? 75 : 55),
      confidenceLevel:
        ins.smartConfidenceLevel ||
        (ins.confidenceLevel === 'high'
          ? 'HIGH'
          : ins.confidenceLevel === 'medium'
          ? 'MEDIUM'
          : 'LOW'),
      scopeType: branchId ? 'BRANCH' : 'GLOBAL',
      branchId,
      productId: null,
      titleEn: ins.titleEn,
      titleAr: ins.titleAr,
      summaryEn: ins.findingEn,
      summaryAr: ins.findingAr,
      explanationEn: `${ins.supportingEvidenceEn} — ${ins.reasonEn}`,
      explanationAr: `${ins.supportingEvidenceAr} — ${ins.reasonAr}`,
      recommendationEn: ins.suggestedActionEn,
      recommendationAr: ins.suggestedActionAr,
      conditionHash: `insight:${ins.id}:${ins.metricValueFormatted}`,
      evidenceJson: {
        metrics: [
          {
            name: ins.metricName,
            valueFormatted: ins.metricValueFormatted,
            rawValue: null,
          },
        ],
        affectedRecords: [ins.id],
        periodAnalyzed: ins.periodLabel,
        sourceMetrics: ins.sourceMetrics || [ins.metricName],
        extra: {
          legacyCategory: ins.category,
          dataQualityStatus: ins.dataQualityStatus,
        },
      },
    });
  }

  return candidates;
}

/**
 * Pure reconciliation of newly evaluated candidates against existing persisted lifecycle records.
 * Guarantees:
 * - Existing ACKNOWLEDGED, RESOLVED, or DISMISSED items are NEVER overwritten back to ACTIVE
 *   during normal analytics refreshes unless `allowAutoRecur` is explicitly true AND `conditionHash`
 *   changed after resolution/dismissal.
 * - Duplicate records are never created for the same `dedupeKey`.
 */
export function reconcileIntelligenceLifecycleState(params: {
  candidates: IntelligenceLifecycleCandidate[];
  existingItems: IntelligenceLifecycleItemRecord[];
  existingEvents: IntelligenceLifecycleEventRecord[];
  nowIso?: string;
  allowAutoRecur?: boolean;
}): {
  items: IntelligenceLifecycleItemRecord[];
  events: IntelligenceLifecycleEventRecord[];
  upsertedItems: IntelligenceLifecycleItemRecord[];
  newEvents: IntelligenceLifecycleEventRecord[];
} {
  const nowIso = params.nowIso || new Date().toISOString();
  const itemByDedupe = new Map<string, IntelligenceLifecycleItemRecord>();
  for (const item of params.existingItems) {
    itemByDedupe.set(item.dedupeKey, { ...item });
  }

  const events = [...params.existingEvents];
  const upsertedItems: IntelligenceLifecycleItemRecord[] = [];
  const newEvents: IntelligenceLifecycleEventRecord[] = [];

  for (const cand of params.candidates) {
    const existing = itemByDedupe.get(cand.dedupeKey);

    if (!existing) {
      const safeId = `ilc-${cand.dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 96);
      const createdItem: IntelligenceLifecycleItemRecord = {
        id: safeId,
        dedupeKey: cand.dedupeKey,
        itemStream: cand.itemStream,
        category: cand.category,
        severity: cand.severity,
        priority: cand.priority,
        confidenceLevel: cand.confidenceLevel,
        scopeType: cand.scopeType,
        branchId: cand.branchId,
        productId: cand.productId,
        titleEn: cand.titleEn,
        titleAr: cand.titleAr,
        summaryEn: cand.summaryEn,
        summaryAr: cand.summaryAr,
        explanationEn: cand.explanationEn,
        explanationAr: cand.explanationAr,
        recommendationEn: cand.recommendationEn,
        recommendationAr: cand.recommendationAr,
        evidenceJson: cand.evidenceJson,
        status: 'ACTIVE',
        conditionHash: cand.conditionHash,
        firstDetectedAt: nowIso,
        lastEvaluatedAt: nowIso,
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        acknowledgedByName: null,
        acknowledgedByRole: null,
        acknowledgmentNote: null,
        resolvedAt: null,
        resolvedByUserId: null,
        resolvedByName: null,
        resolvedByRole: null,
        resolutionNote: null,
        resolutionActionType: null,
        dismissedAt: null,
        dismissedByUserId: null,
        dismissedByName: null,
        dismissedByRole: null,
        dismissReason: null,
        reopenedCount: 0,
        lastReopenedAt: null,
        lastReopenedByUserId: null,
        lastReopenedByName: null,
        updatedAt: nowIso,
      };

      const createdEvent: IntelligenceLifecycleEventRecord = {
        id: `ile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lifecycleItemId: createdItem.id,
        dedupeKey: createdItem.dedupeKey,
        eventType: 'CREATED',
        fromStatus: null,
        toStatus: 'ACTIVE',
        performedByUserId: null,
        performedByName: 'Intelligence Engine',
        performedByRole: 'system',
        note: 'Detected automatically by deterministic store intelligence evaluation.',
        actionType: 'AUTO_DETECT',
        metadataJson: {
          conditionHash: cand.conditionHash,
          severity: cand.severity,
          priority: cand.priority,
        },
        createdAt: nowIso,
      };

      itemByDedupe.set(cand.dedupeKey, createdItem);
      upsertedItems.push(createdItem);
      events.unshift(createdEvent);
      newEvents.push(createdEvent);
      continue;
    }

    // Existing item found
    if (
      params.allowAutoRecur &&
      (existing.status === 'RESOLVED' || existing.status === 'DISMISSED') &&
      existing.conditionHash !== cand.conditionHash
    ) {
      const prevStatus = existing.status;
      const recurredItem: IntelligenceLifecycleItemRecord = {
        ...existing,
        severity: cand.severity,
        priority: cand.priority,
        confidenceLevel: cand.confidenceLevel,
        titleEn: cand.titleEn,
        titleAr: cand.titleAr,
        summaryEn: cand.summaryEn,
        summaryAr: cand.summaryAr,
        explanationEn: cand.explanationEn,
        explanationAr: cand.explanationAr,
        recommendationEn: cand.recommendationEn,
        recommendationAr: cand.recommendationAr,
        evidenceJson: cand.evidenceJson,
        conditionHash: cand.conditionHash,
        status: 'ACTIVE',
        lastEvaluatedAt: nowIso,
        reopenedCount: (existing.reopenedCount || 0) + 1,
        lastReopenedAt: nowIso,
        lastReopenedByUserId: null,
        lastReopenedByName: 'Intelligence Engine (Recurrence)',
        updatedAt: nowIso,
      };

      const recurEvent: IntelligenceLifecycleEventRecord = {
        id: `ile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lifecycleItemId: recurredItem.id,
        dedupeKey: recurredItem.dedupeKey,
        eventType: 'AUTO_RECURRED',
        fromStatus: prevStatus,
        toStatus: 'ACTIVE',
        performedByUserId: null,
        performedByName: 'Intelligence Engine',
        performedByRole: 'system',
        note: 'Underlying operational condition recurred with updated metric threshold.',
        actionType: 'CONDITION_RECURRED',
        metadataJson: {
          previousConditionHash: existing.conditionHash,
          newConditionHash: cand.conditionHash,
        },
        createdAt: nowIso,
      };

      itemByDedupe.set(cand.dedupeKey, recurredItem);
      upsertedItems.push(recurredItem);
      events.unshift(recurEvent);
      newEvents.push(recurEvent);
    } else {
      // Preserve existing status (ACTIVE, ACKNOWLEDGED, RESOLVED, or DISMISSED) and refresh evidence
      const metadataChanged =
        existing.titleEn !== cand.titleEn ||
        existing.summaryEn !== cand.summaryEn ||
        existing.severity !== cand.severity ||
        existing.priority !== cand.priority;

      const updated: IntelligenceLifecycleItemRecord = {
        ...existing,
        severity: cand.severity,
        priority: cand.priority,
        confidenceLevel: cand.confidenceLevel,
        titleEn: cand.titleEn,
        titleAr: cand.titleAr,
        summaryEn: cand.summaryEn,
        summaryAr: cand.summaryAr,
        explanationEn: cand.explanationEn,
        explanationAr: cand.explanationAr,
        recommendationEn: cand.recommendationEn,
        recommendationAr: cand.recommendationAr,
        evidenceJson: cand.evidenceJson,
        lastEvaluatedAt: nowIso,
      };

      itemByDedupe.set(cand.dedupeKey, updated);
      if (metadataChanged) {
        upsertedItems.push(updated);
      }
    }
  }

  return {
    items: Array.from(itemByDedupe.values()),
    events,
    upsertedItems,
    newEvents,
  };
}

export interface LifecycleTransitionInput {
  itemIdOrDedupeKey: string;
  action: 'ACKNOWLEDGE' | 'RESOLVE' | 'DISMISS' | 'REOPEN';
  userContext: AnalyticsUserContext;
  userName: string;
  note?: string;
  actionType?: string;
  nowIso?: string;
}

/**
 * Pure state transition validator and executor for Intelligence Lifecycle items.
 */
export function applyLifecycleTransition(params: {
  items: IntelligenceLifecycleItemRecord[];
  events: IntelligenceLifecycleEventRecord[];
  input: LifecycleTransitionInput;
}): {
  updatedItem: IntelligenceLifecycleItemRecord;
  createdEvent: IntelligenceLifecycleEventRecord;
  items: IntelligenceLifecycleItemRecord[];
  events: IntelligenceLifecycleEventRecord[];
} {
  const { items, events, input } = params;
  const nowIso = input.nowIso || new Date().toISOString();

  const idx = items.findIndex(
    (it) => it.id === input.itemIdOrDedupeKey || it.dedupeKey === input.itemIdOrDedupeKey
  );
  if (idx === -1) {
    throw new LifecycleActionError(
      404,
      'LIFECYCLE_ITEM_NOT_FOUND',
      `Intelligence item "${input.itemIdOrDedupeKey}" was not found.`
    );
  }

  const target = items[idx];

  // Enforce RBAC branch & financial access permissions
  if (!canUserAccessLifecycleItem(target, input.userContext)) {
    throw new LifecycleActionError(
      403,
      'FORBIDDEN_LIFECYCLE_ITEM_ACCESS',
      `Access denied: user "${input.userContext.userId}" (${input.userContext.role}) is not authorized to modify this intelligence item.`
    );
  }

  // Enforce role restriction for REOPEN (admin or manager only)
  if (
    input.action === 'REOPEN' &&
    input.userContext.role !== 'admin' &&
    input.userContext.role !== 'manager'
  ) {
    throw new LifecycleActionError(
      403,
      'FORBIDDEN_REOPEN_ROLE',
      `Access denied: role "${input.userContext.role}" is not authorized to reopen resolved or dismissed intelligence items. Manager or Admin role required.`
    );
  }

  const trimmedNote = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : null;
  const trimmedActionType =
    typeof input.actionType === 'string' ? input.actionType.trim().slice(0, 120) : null;

  const fromStatus = target.status;
  let toStatus: IntelligenceLifecycleStatus = target.status;
  let eventType: IntelligenceLifecycleEventType = 'ACKNOWLEDGED';

  const updatedItem: IntelligenceLifecycleItemRecord = {
    ...target,
    updatedAt: nowIso,
  };

  if (input.action === 'ACKNOWLEDGE') {
    toStatus = 'ACKNOWLEDGED';
    eventType = 'ACKNOWLEDGED';
    updatedItem.status = 'ACKNOWLEDGED';
    updatedItem.acknowledgedAt = nowIso;
    updatedItem.acknowledgedByUserId = input.userContext.userId;
    updatedItem.acknowledgedByName = input.userName;
    updatedItem.acknowledgedByRole = input.userContext.role;
    updatedItem.acknowledgmentNote = trimmedNote || updatedItem.acknowledgmentNote;
  } else if (input.action === 'RESOLVE') {
    toStatus = 'RESOLVED';
    eventType = 'RESOLVED';
    updatedItem.status = 'RESOLVED';
    updatedItem.resolvedAt = nowIso;
    updatedItem.resolvedByUserId = input.userContext.userId;
    updatedItem.resolvedByName = input.userName;
    updatedItem.resolvedByRole = input.userContext.role;
    updatedItem.resolutionNote = trimmedNote || 'Resolved by operator';
    updatedItem.resolutionActionType = trimmedActionType || 'OPERATIONAL_FIX';
    if (!updatedItem.acknowledgedAt) {
      updatedItem.acknowledgedAt = nowIso;
      updatedItem.acknowledgedByUserId = input.userContext.userId;
      updatedItem.acknowledgedByName = input.userName;
      updatedItem.acknowledgedByRole = input.userContext.role;
    }
  } else if (input.action === 'DISMISS') {
    toStatus = 'DISMISSED';
    eventType = 'DISMISSED';
    updatedItem.status = 'DISMISSED';
    updatedItem.dismissedAt = nowIso;
    updatedItem.dismissedByUserId = input.userContext.userId;
    updatedItem.dismissedByName = input.userName;
    updatedItem.dismissedByRole = input.userContext.role;
    updatedItem.dismissReason = trimmedNote || 'Dismissed as non-actionable';
  } else if (input.action === 'REOPEN') {
    toStatus = 'ACTIVE';
    eventType = 'REOPENED';
    updatedItem.status = 'ACTIVE';
    updatedItem.reopenedCount = (target.reopenedCount || 0) + 1;
    updatedItem.lastReopenedAt = nowIso;
    updatedItem.lastReopenedByUserId = input.userContext.userId;
    updatedItem.lastReopenedByName = input.userName;
  } else {
    throw new LifecycleActionError(
      400,
      'INVALID_LIFECYCLE_ACTION',
      `Unsupported lifecycle action: ${String(input.action)}`
    );
  }

  const createdEvent: IntelligenceLifecycleEventRecord = {
    id: `ile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lifecycleItemId: updatedItem.id,
    dedupeKey: updatedItem.dedupeKey,
    eventType,
    fromStatus,
    toStatus,
    performedByUserId: input.userContext.userId,
    performedByName: input.userName,
    performedByRole: input.userContext.role,
    note:
      trimmedNote ||
      (input.action === 'RESOLVE'
        ? updatedItem.resolutionNote
        : input.action === 'DISMISS'
        ? updatedItem.dismissReason
        : null),
    actionType: trimmedActionType || input.action,
    metadataJson: {
      branchId: updatedItem.branchId,
      category: updatedItem.category,
      severity: updatedItem.severity,
    },
    createdAt: nowIso,
  };

  const nextItems = [...items];
  nextItems[idx] = updatedItem;
  const nextEvents = [createdEvent, ...events];

  return {
    updatedItem,
    createdEvent,
    items: nextItems,
    events: nextEvents,
  };
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

/**
 * Pure query, filter, sort, count, and pagination engine for Intelligence Center.
 */
export function queryLifecycleItems(params: {
  items: IntelligenceLifecycleItemRecord[];
  userContext: AnalyticsUserContext;
  filter?: IntelligenceLifecycleQueryFilter;
}): IntelligenceLifecycleListResponse {
  const f = params.filter || {};
  const statusFilter = f.status || 'ACTIVE';
  const itemStream = f.itemStream || 'all';
  const category = f.category || 'all';
  const severity = f.severity || 'all';
  const branchId = f.branchId || 'all';
  const startDate = f.startDate || '';
  const endDate = f.endDate || '';
  const search = (f.search || '').trim().toLowerCase();
  const sortBy = f.sortBy || 'priority_desc';
  const page = Math.max(1, Number(f.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(f.pageSize) || 20));

  // 1. Apply RBAC scoping first
  const accessible = params.items.filter((item) =>
    canUserAccessLifecycleItem(item, params.userContext)
  );

  // 2. Apply non-status filters so tab counts reflect current search/branch/category/date filters
  const baseFiltered = accessible.filter((item) => {
    if (itemStream !== 'all' && item.itemStream !== itemStream) return false;
    if (category !== 'all' && item.category.toLowerCase() !== category.toLowerCase()) return false;
    if (severity !== 'all' && item.severity.toLowerCase() !== severity.toLowerCase()) return false;
    if (branchId !== 'all') {
      if (item.branchId !== branchId && item.scopeType !== 'GLOBAL') return false;
    }
    if (startDate) {
      const startMs = new Date(startDate).getTime();
      const itemMs = new Date(item.updatedAt || item.firstDetectedAt).getTime();
      if (Number.isFinite(startMs) && itemMs < startMs) return false;
    }
    if (endDate) {
      const endMs = new Date(endDate).getTime() + 86399999;
      const itemMs = new Date(item.updatedAt || item.firstDetectedAt).getTime();
      if (Number.isFinite(endMs) && itemMs > endMs) return false;
    }
    if (search) {
      const haystack = [
        item.id,
        item.dedupeKey,
        item.category,
        item.titleEn,
        item.titleAr,
        item.summaryEn,
        item.summaryAr,
        item.recommendationEn,
        item.recommendationAr,
        item.acknowledgedByName || '',
        item.resolvedByName || '',
        item.resolutionNote || '',
        item.dismissedByName || '',
        item.dismissReason || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // 3. Compute tab counts across baseFiltered
  const counts: IntelligenceLifecycleSummaryCounts = {
    active: 0,
    acknowledged: 0,
    resolved: 0,
    dismissed: 0,
    allHistory: baseFiltered.length,
    criticalActive: 0,
    highActive: 0,
  };

  for (const item of baseFiltered) {
    if (item.status === 'ACTIVE') {
      counts.active += 1;
      if (item.severity === 'CRITICAL') counts.criticalActive += 1;
      if (item.severity === 'HIGH') counts.highActive += 1;
    } else if (item.status === 'ACKNOWLEDGED') {
      counts.acknowledged += 1;
    } else if (item.status === 'RESOLVED') {
      counts.resolved += 1;
    } else if (item.status === 'DISMISSED') {
      counts.dismissed += 1;
    }
  }

  // 4. Filter by requested status tab
  const statusFiltered =
    statusFilter === 'ALL_HISTORY'
      ? baseFiltered
      : baseFiltered.filter((item) => item.status === statusFilter);

  // 5. Sort
  const sorted = [...statusFiltered].sort((a, b) => {
    if (sortBy === 'updated_desc') {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    if (sortBy === 'created_desc') {
      return new Date(b.firstDetectedAt).getTime() - new Date(a.firstDetectedAt).getTime();
    }
    if (sortBy === 'severity_desc') {
      const diff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (diff !== 0) return diff;
    }
    // Default: priority_desc, then severity, then updatedAt
    if (b.priority !== a.priority) return b.priority - a.priority;
    const sevDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const totalMatching = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pagedItems = sorted.slice(startIdx, startIdx + pageSize);

  return {
    items: pagedItems,
    counts,
    pagination: {
      page: safePage,
      pageSize,
      totalMatching,
      totalPages,
    },
    filtersApplied: {
      status: statusFilter,
      itemStream,
      category,
      severity,
      branchId,
      startDate,
      endDate,
      search,
      sortBy,
      page: safePage,
      pageSize,
    },
  };
}

// ============================================================================
// SERVER-SIDE PERSISTENCE (PostgreSQL + .data/store-state.json mirror)
// ============================================================================

function getStoreStateFilePath(): string {
  return path.join(process.cwd(), '.data', 'store-state.json');
}

function readLocalLifecycleState(): {
  items: IntelligenceLifecycleItemRecord[];
  events: IntelligenceLifecycleEventRecord[];
} {
  try {
    const file = getStoreStateFilePath();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
      return {
        items: Array.isArray(parsed.intelligenceLifecycleItems)
          ? parsed.intelligenceLifecycleItems
          : [],
        events: Array.isArray(parsed.intelligenceLifecycleEvents)
          ? parsed.intelligenceLifecycleEvents
          : [],
      };
    }
  } catch {
    // Ignore read error
  }
  return { items: [], events: [] };
}

function writeLocalLifecycleState(
  items: IntelligenceLifecycleItemRecord[],
  events: IntelligenceLifecycleEventRecord[]
): void {
  try {
    const dataDir = path.join(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const file = getStoreStateFilePath();
    let current: any = {};
    if (fs.existsSync(file)) {
      try {
        current = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
      } catch {
        current = {};
      }
    }
    current.intelligenceLifecycleItems = items;
    current.intelligenceLifecycleEvents = events.slice(0, 1000);
    fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8');
  } catch {
    // Non-blocking
  }
}

function mapDbRowToLifecycleItem(row: any): IntelligenceLifecycleItemRecord {
  const toIso = (d: any): string | null => {
    if (!d) return null;
    return d instanceof Date ? d.toISOString() : String(d);
  };
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    itemStream: (row.itemStream as IntelligenceLifecycleStream) || 'smart_alert',
    category: row.category,
    severity: (row.severity as any) || 'MEDIUM',
    priority: Number(row.priority ?? 50),
    confidenceLevel: (row.confidenceLevel as SmartInsightConfidenceLevel) || 'HIGH',
    scopeType: row.scopeType === 'GLOBAL' ? 'GLOBAL' : 'BRANCH',
    branchId: row.branchId || null,
    productId: row.productId || null,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    summaryEn: row.summaryEn,
    summaryAr: row.summaryAr,
    explanationEn: row.explanationEn,
    explanationAr: row.explanationAr,
    recommendationEn: row.recommendationEn,
    recommendationAr: row.recommendationAr,
    evidenceJson:
      row.evidenceJson && typeof row.evidenceJson === 'object' ? row.evidenceJson : {},
    status: (row.status as IntelligenceLifecycleStatus) || 'ACTIVE',
    conditionHash: row.conditionHash || '',
    firstDetectedAt: toIso(row.firstDetectedAt) || new Date().toISOString(),
    lastEvaluatedAt: toIso(row.lastEvaluatedAt) || new Date().toISOString(),
    acknowledgedAt: toIso(row.acknowledgedAt),
    acknowledgedByUserId: row.acknowledgedByUserId || null,
    acknowledgedByName: row.acknowledgedByName || null,
    acknowledgedByRole: row.acknowledgedByRole || null,
    acknowledgmentNote: row.acknowledgmentNote || null,
    resolvedAt: toIso(row.resolvedAt),
    resolvedByUserId: row.resolvedByUserId || null,
    resolvedByName: row.resolvedByName || null,
    resolvedByRole: row.resolvedByRole || null,
    resolutionNote: row.resolutionNote || null,
    resolutionActionType: row.resolutionActionType || null,
    dismissedAt: toIso(row.dismissedAt),
    dismissedByUserId: row.dismissedByUserId || null,
    dismissedByName: row.dismissedByName || null,
    dismissedByRole: row.dismissedByRole || null,
    dismissReason: row.dismissReason || null,
    reopenedCount: Number(row.reopenedCount || 0),
    lastReopenedAt: toIso(row.lastReopenedAt),
    lastReopenedByUserId: row.lastReopenedByUserId || null,
    lastReopenedByName: row.lastReopenedByName || null,
    updatedAt: toIso(row.updatedAt) || new Date().toISOString(),
  };
}

function mapDbRowToLifecycleEvent(row: any): IntelligenceLifecycleEventRecord {
  return {
    id: row.id,
    lifecycleItemId: row.lifecycleItemId,
    dedupeKey: row.dedupeKey,
    eventType: (row.eventType as IntelligenceLifecycleEventType) || 'CREATED',
    fromStatus: (row.fromStatus as IntelligenceLifecycleStatus) || null,
    toStatus: (row.toStatus as IntelligenceLifecycleStatus) || 'ACTIVE',
    performedByUserId: row.performedByUserId || null,
    performedByName: row.performedByName || 'System',
    performedByRole: row.performedByRole || 'system',
    note: row.note || null,
    actionType: row.actionType || null,
    metadataJson:
      row.metadataJson && typeof row.metadataJson === 'object' ? row.metadataJson : {},
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export async function loadPersistedLifecycleState(): Promise<{
  items: IntelligenceLifecycleItemRecord[];
  events: IntelligenceLifecycleEventRecord[];
}> {
  const local = readLocalLifecycleState();
  const pgItems: IntelligenceLifecycleItemRecord[] = [];
  const pgEvents: IntelligenceLifecycleEventRecord[] = [];

  try {
    const { db } = await import('../db/index');
    if (db) {
      const schema = await import('../db/schema');
      const { desc } = await import('drizzle-orm');
      const [dbItems, dbEvents] = await Promise.all([
        db
          .select()
          .from(schema.intelligenceLifecycleItems)
          .orderBy(desc(schema.intelligenceLifecycleItems.updatedAt))
          .catch(() => []),
        db
          .select()
          .from(schema.intelligenceLifecycleEvents)
          .orderBy(desc(schema.intelligenceLifecycleEvents.createdAt))
          .limit(500)
          .catch(() => []),
      ]);

      for (const r of dbItems) {
        pgItems.push(mapDbRowToLifecycleItem(r));
      }
      for (const e of dbEvents) {
        pgEvents.push(mapDbRowToLifecycleEvent(e));
      }
    }
  } catch {
    // Fallback to local state
  }

  // Merge by dedupeKey preferring whichever record has the latest `updatedAt`
  const mergedItemsMap = new Map<string, IntelligenceLifecycleItemRecord>();
  for (const item of [...local.items, ...pgItems]) {
    const existing = mergedItemsMap.get(item.dedupeKey);
    if (
      !existing ||
      new Date(item.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()
    ) {
      mergedItemsMap.set(item.dedupeKey, item);
    }
  }

  const mergedEventsMap = new Map<string, IntelligenceLifecycleEventRecord>();
  for (const evt of [...local.events, ...pgEvents]) {
    if (!mergedEventsMap.has(evt.id)) {
      mergedEventsMap.set(evt.id, evt);
    }
  }

  const sortedEvents = Array.from(mergedEventsMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    items: Array.from(mergedItemsMap.values()),
    events: sortedEvents,
  };
}

async function persistUpsertedLifecycleRecords(params: {
  allItems: IntelligenceLifecycleItemRecord[];
  allEvents: IntelligenceLifecycleEventRecord[];
  upsertedItems: IntelligenceLifecycleItemRecord[];
  newEvents: IntelligenceLifecycleEventRecord[];
}): Promise<void> {
  writeLocalLifecycleState(params.allItems, params.allEvents);

  if (params.upsertedItems.length === 0 && params.newEvents.length === 0) {
    return;
  }

  try {
    const { db } = await import('../db/index');
    if (db) {
      const schema = await import('../db/schema');
      for (const item of params.upsertedItems) {
        await db
          .insert(schema.intelligenceLifecycleItems)
          .values({
            id: item.id,
            dedupeKey: item.dedupeKey,
            itemStream: item.itemStream,
            category: item.category,
            severity: item.severity,
            priority: item.priority,
            confidenceLevel: item.confidenceLevel,
            scopeType: item.scopeType,
            branchId: null, // Null in PG column if branchId is virtual ('br-main') to avoid FK rejection; actual branchId is preserved in evidenceJson.extra.branchId
            productId: null,
            titleEn: item.titleEn,
            titleAr: item.titleAr,
            summaryEn: item.summaryEn,
            summaryAr: item.summaryAr,
            explanationEn: item.explanationEn,
            explanationAr: item.explanationAr,
            recommendationEn: item.recommendationEn,
            recommendationAr: item.recommendationAr,
            evidenceJson: {
              ...item.evidenceJson,
              extra: {
                ...(item.evidenceJson?.extra || {}),
                branchId: item.branchId,
                productId: item.productId,
              },
            },
            status: item.status,
            conditionHash: item.conditionHash,
            firstDetectedAt: new Date(item.firstDetectedAt),
            lastEvaluatedAt: new Date(item.lastEvaluatedAt),
            acknowledgedAt: item.acknowledgedAt ? new Date(item.acknowledgedAt) : null,
            acknowledgedByUserId: item.acknowledgedByUserId,
            acknowledgedByName: item.acknowledgedByName,
            acknowledgedByRole: item.acknowledgedByRole,
            acknowledgmentNote: item.acknowledgmentNote,
            resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : null,
            resolvedByUserId: item.resolvedByUserId,
            resolvedByName: item.resolvedByName,
            resolvedByRole: item.resolvedByRole,
            resolutionNote: item.resolutionNote,
            resolutionActionType: item.resolutionActionType,
            dismissedAt: item.dismissedAt ? new Date(item.dismissedAt) : null,
            dismissedByUserId: item.dismissedByUserId,
            dismissedByName: item.dismissedByName,
            dismissedByRole: item.dismissedByRole,
            dismissReason: item.dismissReason,
            reopenedCount: item.reopenedCount,
            lastReopenedAt: item.lastReopenedAt ? new Date(item.lastReopenedAt) : null,
            lastReopenedByUserId: item.lastReopenedByUserId,
            lastReopenedByName: item.lastReopenedByName,
            updatedAt: new Date(item.updatedAt),
          })
          .onConflictDoUpdate({
            target: schema.intelligenceLifecycleItems.dedupeKey,
            set: {
              severity: item.severity,
              priority: item.priority,
              confidenceLevel: item.confidenceLevel,
              titleEn: item.titleEn,
              titleAr: item.titleAr,
              summaryEn: item.summaryEn,
              summaryAr: item.summaryAr,
              explanationEn: item.explanationEn,
              explanationAr: item.explanationAr,
              recommendationEn: item.recommendationEn,
              recommendationAr: item.recommendationAr,
              evidenceJson: {
                ...item.evidenceJson,
                extra: {
                  ...(item.evidenceJson?.extra || {}),
                  branchId: item.branchId,
                  productId: item.productId,
                },
              },
              status: item.status,
              conditionHash: item.conditionHash,
              lastEvaluatedAt: new Date(item.lastEvaluatedAt),
              acknowledgedAt: item.acknowledgedAt ? new Date(item.acknowledgedAt) : null,
              acknowledgedByUserId: item.acknowledgedByUserId,
              acknowledgedByName: item.acknowledgedByName,
              acknowledgedByRole: item.acknowledgedByRole,
              acknowledgmentNote: item.acknowledgmentNote,
              resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : null,
              resolvedByUserId: item.resolvedByUserId,
              resolvedByName: item.resolvedByName,
              resolvedByRole: item.resolvedByRole,
              resolutionNote: item.resolutionNote,
              resolutionActionType: item.resolutionActionType,
              dismissedAt: item.dismissedAt ? new Date(item.dismissedAt) : null,
              dismissedByUserId: item.dismissedByUserId,
              dismissedByName: item.dismissedByName,
              dismissedByRole: item.dismissedByRole,
              dismissReason: item.dismissReason,
              reopenedCount: item.reopenedCount,
              lastReopenedAt: item.lastReopenedAt ? new Date(item.lastReopenedAt) : null,
              lastReopenedByUserId: item.lastReopenedByUserId,
              lastReopenedByName: item.lastReopenedByName,
              updatedAt: new Date(item.updatedAt),
            },
          })
          .catch(() => {});
      }

      for (const evt of params.newEvents) {
        await db
          .insert(schema.intelligenceLifecycleEvents)
          .values({
            id: evt.id,
            lifecycleItemId: evt.lifecycleItemId,
            dedupeKey: evt.dedupeKey,
            eventType: evt.eventType,
            fromStatus: evt.fromStatus,
            toStatus: evt.toStatus,
            performedByUserId: evt.performedByUserId,
            performedByName: evt.performedByName,
            performedByRole: evt.performedByRole,
            note: evt.note,
            actionType: evt.actionType,
            metadataJson: evt.metadataJson,
            createdAt: new Date(evt.createdAt),
          })
          .catch(() => {});
      }
    }
  } catch {
    // Non-blocking fallback
  }
}

/**
 * Synchronizes an evaluated `AnalyticsOverviewResponse` with the persistent Intelligence Lifecycle store,
 * updating `overview.intelligence.smartAlerts`, `overview.insights`, `overview.lifecycleItems`,
 * and `overview.lifecycleSummary` in place.
 */
export async function syncOverviewWithLifecycleStore(
  overview: AnalyticsOverviewResponse
): Promise<{
  items: IntelligenceLifecycleItemRecord[];
  events: IntelligenceLifecycleEventRecord[];
}> {
  const persisted = await loadPersistedLifecycleState();
  // Restore virtual branchId/productId from evidenceJson.extra if PG stored null FK
  for (const it of persisted.items) {
    if (!it.branchId && it.evidenceJson?.extra?.branchId) {
      it.branchId = it.evidenceJson.extra.branchId;
    }
    if (!it.productId && it.evidenceJson?.extra?.productId) {
      it.productId = it.evidenceJson.extra.productId;
    }
  }

  const candidates = extractCandidatesFromOverview(overview);
  const reconciled = reconcileIntelligenceLifecycleState({
    candidates,
    existingItems: persisted.items,
    existingEvents: persisted.events,
    allowAutoRecur: false,
  });

  if (reconciled.upsertedItems.length > 0 || reconciled.newEvents.length > 0) {
    await persistUpsertedLifecycleRecords({
      allItems: reconciled.items,
      allEvents: reconciled.events,
      upsertedItems: reconciled.upsertedItems,
      newEvents: reconciled.newEvents,
    });
  }

  const statusByDedupe = new Map<string, IntelligenceLifecycleStatus>();
  for (const item of reconciled.items) {
    statusByDedupe.set(item.dedupeKey, item.status);
  }

  // Reflect authoritative lifecycle status on smartAlerts and insights
  for (const alert of overview.intelligence?.smartAlerts || []) {
    const st = statusByDedupe.get(alert.dedupeKey || `smart_alert:${alert.id}`);
    if (st) {
      alert.lifecycleStatus = toLegacyAlertStatus(st);
    }
  }
  for (const ins of overview.insights || []) {
    const st = statusByDedupe.get(`bi_insight:${ins.id}`);
    if (st) {
      ins.lifecycleStatus = toLegacyAlertStatus(st);
    }
  }

  const queried = queryLifecycleItems({
    items: reconciled.items,
    userContext: overview.userContext,
    filter: { status: 'ALL_HISTORY', pageSize: 100 },
  });

  overview.lifecycleSummary = queried.counts;
  overview.lifecycleItems = queried.items;

  // Update overview.intelligence.overview.totalActiveAlerts to reflect truly ACTIVE smart alerts
  if (overview.intelligence?.overview) {
    const activeSmartAlerts = (overview.intelligence.smartAlerts || []).filter(
      (a) => a.lifecycleStatus === 'active'
    );
    overview.intelligence.overview.totalActiveAlerts = activeSmartAlerts.length;
    overview.intelligence.overview.criticalAlertsCount = activeSmartAlerts.filter(
      (a) => a.severity === 'CRITICAL'
    ).length;
    overview.intelligence.overview.highAlertsCount = activeSmartAlerts.filter(
      (a) => a.severity === 'HIGH'
    ).length;
  }

  return {
    items: reconciled.items,
    events: reconciled.events,
  };
}

/**
 * Executes and persists an authenticated lifecycle transition (`ACKNOWLEDGE`, `RESOLVE`, `DISMISS`, `REOPEN`).
 */
export async function executeServerLifecycleTransition(params: {
  overview: AnalyticsOverviewResponse;
  itemIdOrDedupeKey: string;
  action: 'ACKNOWLEDGE' | 'RESOLVE' | 'DISMISS' | 'REOPEN';
  userName: string;
  note?: string;
  actionType?: string;
}): Promise<{
  item: IntelligenceLifecycleItemRecord;
  event: IntelligenceLifecycleEventRecord;
  history: IntelligenceLifecycleEventRecord[];
  counts: IntelligenceLifecycleSummaryCounts;
}> {
  const synced = await syncOverviewWithLifecycleStore(params.overview);

  const result = applyLifecycleTransition({
    items: synced.items,
    events: synced.events,
    input: {
      itemIdOrDedupeKey: params.itemIdOrDedupeKey,
      action: params.action,
      userContext: params.overview.userContext,
      userName: params.userName,
      note: params.note,
      actionType: params.actionType,
    },
  });

  await persistUpsertedLifecycleRecords({
    allItems: result.items,
    allEvents: result.events,
    upsertedItems: [result.updatedItem],
    newEvents: [result.createdEvent],
  });

  const itemHistory = result.events.filter(
    (e) =>
      e.lifecycleItemId === result.updatedItem.id ||
      e.dedupeKey === result.updatedItem.dedupeKey
  );

  const queried = queryLifecycleItems({
    items: result.items,
    userContext: params.overview.userContext,
    filter: { status: 'ALL_HISTORY', pageSize: 100 },
  });

  return {
    item: result.updatedItem,
    event: result.createdEvent,
    history: itemHistory,
    counts: queried.counts,
  };
}
