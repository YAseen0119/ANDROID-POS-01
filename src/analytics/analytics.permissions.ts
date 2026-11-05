/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { POSUser, UserRole } from '../lib/types';
import {
  AnalyticsFilterParams,
  AnalyticsUserContext,
  BranchAnalyticsResult,
  BusinessInsightItem,
  CustomerAnalyticsResult,
  FinancialAnalyticsResult,
  ForecastingResult,
  InventoryAnalyticsResult,
  SalesAnalyticsResult,
  SmartStoreIntelligenceResult,
} from './analytics.types';
import { redactUnmetDemandRecordForRole } from './unmet-demand.validation';

/**
 * Resolves the authenticated/active POS user context and verifies the user's role
 * and assigned branch against the server-side user directory (`knownUsers`) to prevent
 * header/query privilege spoofing.
 *
 * Security Rules (SEC-01 & SEC-02):
 * - Never default to `'admin'` or `'usr-admin-1'`.
 * - Never infer administrator or manager privileges from client headers or query parameters (`input.role`).
 * - Missing `userId` or unknown `userId` (not found in `knownUsers`) receives `roleVerifiedFromServerStore = false`
 *   and zero sensitive permissions (`canViewFinancials = false`, `canViewCostAndMargin = false`, etc.).
 */
export function resolveAnalyticsUserContext(
  input: {
    userId?: string;
    userName?: string;
    role?: string;
    branchId?: string;
    terminalName?: string;
  },
  knownUsers?: POSUser[]
): AnalyticsUserContext {
  const validRoles: UserRole[] = ['admin', 'manager', 'cashier', 'inventory_clerk'];
  const normalizedUserId =
    typeof input.userId === 'string' ? input.userId.trim() : '';

  // Look up user strictly in the authoritative server-side user store
  const matchedServerUser =
    Array.isArray(knownUsers) && knownUsers.length > 0 && normalizedUserId.length > 0
      ? knownUsers.find((u) => u && u.id === normalizedUserId)
      : undefined;

  if (!matchedServerUser) {
    // Missing or unknown user identity: NEVER grant admin/manager or trust input.role
    return {
      userId: normalizedUserId || 'unauthenticated',
      userName: 'Unverified User',
      role: 'cashier',
      assignedBranchId: 'unverified-restricted-branch',
      assignedTerminalName: 'unverified-restricted-terminal',
      canViewFinancials: false,
      canViewCostAndMargin: false,
      canViewAllBranches: false,
      canViewCustomerPII: false,
      canExportAnalytics: false,
      roleVerifiedFromServerStore: false,
      branchRestrictionEnforced: true,
    };
  }

  // Server-authoritative role and branch override any client-supplied headers/query params
  const role: UserRole = validRoles.includes(matchedServerUser.role)
    ? matchedServerUser.role
    : 'cashier';

  const explicitUserBranch = (
    matchedServerUser as POSUser & { branchId?: string }
  ).branchId;
  const inferredBranchFromTerminal =
    matchedServerUser.terminalName &&
    (matchedServerUser.terminalName.includes('02') ||
      matchedServerUser.terminalName.toLowerCase().includes('bahri'))
      ? 'branch-bahri'
      : 'branch-main';
  const assignedBranchId =
    explicitUserBranch || inferredBranchFromTerminal || undefined;
  const assignedTerminalName = matchedServerUser.terminalName || undefined;
  const userName = matchedServerUser.name || 'POS User';

  const canViewFinancials = role === 'admin' || role === 'manager';
  const canViewCostAndMargin =
    role === 'admin' || role === 'manager' || role === 'inventory_clerk';
  const canViewAllBranches = role === 'admin' || role === 'manager';
  const canViewCustomerPII =
    role === 'admin' || role === 'manager' || role === 'cashier';
  const canExportAnalytics = role === 'admin' || role === 'manager';
  const branchRestrictionEnforced = !canViewAllBranches;

  return {
    userId: matchedServerUser.id,
    userName,
    role,
    assignedBranchId,
    assignedTerminalName,
    canViewFinancials,
    canViewCostAndMargin,
    canViewAllBranches,
    canViewCustomerPII,
    canExportAnalytics,
    roleVerifiedFromServerStore: true,
    branchRestrictionEnforced,
  };
}

/**
 * Enforces server-side branch and cashier scope restrictions on incoming filter parameters.
 * Non-admin/non-manager users are automatically scoped to their assigned branch or terminal.
 */
export function enforceScopedFilters(
  filters: AnalyticsFilterParams,
  user: AnalyticsUserContext
): AnalyticsFilterParams {
  const scoped: AnalyticsFilterParams = {
    datePreset: filters.datePreset || '30d',
    branchId: filters.branchId || 'all',
    category: filters.category || 'all',
    productId: filters.productId || 'all',
    customerId: filters.customerId || 'all',
    supplierName: filters.supplierName || 'all',
    cashierName: filters.cashierName || 'all',
    paymentMethod: filters.paymentMethod || 'all',
    currency: filters.currency || 'SDG',
    valuationMode: filters.valuationMode || 'historical',
    anchorCurrency: filters.anchorCurrency || 'USD',
    transactionStatus: filters.transactionStatus || 'completed',
    abcBasis: filters.abcBasis || 'revenue',
    leadTimeDays: Number.isFinite(filters.leadTimeDays)
      ? Math.max(1, Math.min(90, Number(filters.leadTimeDays)))
      : 3,
    safetyStockDays: Number.isFinite(filters.safetyStockDays)
      ? Math.max(1, Math.min(30, Number(filters.safetyStockDays)))
      : 2,
    forecastHorizonDays:
      filters.forecastHorizonDays === 7 ||
      filters.forecastHorizonDays === 30 ||
      filters.forecastHorizonDays === 90
        ? filters.forecastHorizonDays
        : 7,
    missingDateStrategy: filters.missingDateStrategy || 'zero_fill',
    fixedOperatingExpensesOverride: filters.fixedOperatingExpensesOverride,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };

  if (!user.canViewAllBranches) {
    if (user.assignedBranchId && user.assignedBranchId !== 'all') {
      scoped.branchId = user.assignedBranchId;
    }
    if (user.role === 'cashier' && user.assignedTerminalName) {
      scoped.cashierName = user.assignedTerminalName;
    }
  }

  return scoped;
}

/**
 * Masks sensitive cost/margin fields in SalesAnalyticsResult as `null` (NEVER `0`)
 * if user lacks cost/margin permission.
 */
export function sanitizeSalesForRole(
  sales: SalesAnalyticsResult,
  user: AnalyticsUserContext
): SalesAnalyticsResult {
  if (user.canViewCostAndMargin) return sales;

  const maskDimension = (items: SalesAnalyticsResult['byCategory']) =>
    items.map((item) => ({
      ...item,
      cogs: null,
      grossProfit: null,
      grossMarginPercent: null,
    }));

  return {
    ...sales,
    costAccessStatus: 'restricted_by_role',
    dailySeries: sales.dailySeries.map((d) => ({
      ...d,
      cogs: null,
      grossProfit: null,
    })),
    byCategory: maskDimension(sales.byCategory),
    byProduct: maskDimension(sales.byProduct),
    byBranch: maskDimension(sales.byBranch),
    byEmployee: maskDimension(sales.byEmployee),
  };
}

/**
 * Masks sensitive P&L, Cost, Working Capital, and Break-Even fields in FinancialAnalyticsResult
 * as `null` (NEVER `0`) if user lacks financial report permission.
 */
export function sanitizeFinancialsForRole(
  financial: FinancialAnalyticsResult,
  user: AnalyticsUserContext
): FinancialAnalyticsResult {
  if (user.canViewFinancials) return financial;

  return {
    ...financial,
    financialAccessStatus: 'restricted_by_role',
    profitAndLoss: {
      ...financial.profitAndLoss,
      costOfGoodsSold: null,
      exactHistoricalCogsPortion: null,
      estimatedCurrentCostCogsPortion: null,
      unresolvableCostRevenuePortion: null,
      grossProfit: null,
      estimatedGrossProfit: null,
      grossProfitMarginPercent: null,
      recordedShrinkageAndDamageExpense: null,
      profitAfterRecordedShrinkage: null,
      profitAfterShrinkageMarginPercent: null,
      generalOperatingExpenses: null,
      operatingProfitStatus: 'restricted_by_role',
      netOperatingProfit: null,
      netProfitMarginPercent: null,
    },
    cashFlowAndWorkingCapital: {
      ...financial.cashFlowAndWorkingCapital,
      inventoryValuationAtCost: null,
      potentialInventoryGrossProfit: null,
    },
    breakEvenAnalysis: {
      ...financial.breakEvenAnalysis,
      status: 'restricted_by_role',
      fixedOperatingCosts: null,
      variableCostsCogs: null,
      contributionMargin: null,
      contributionMarginRatio: null,
      averageGrossMarginRatio: null,
      recordedShrinkageCosts: null,
      breakEvenSalesRevenue: null,
      surplusOrDeficitRevenue: null,
      isAboveBreakEven: null,
    },
    categoryProfitability: [],
    productProfitability: [],
  };
}

/**
 * Masks sensitive unit cost, inventory cost valuation, and COGS fields in InventoryAnalyticsResult
 * as `null` (NEVER `0`) if user lacks cost/margin permission (e.g. `cashier`).
 */
export function sanitizeInventoryForRole(
  inventory: InventoryAnalyticsResult,
  user: AnalyticsUserContext
): InventoryAnalyticsResult {
  if (user.canViewCostAndMargin) return inventory;

  return {
    ...inventory,
    costAccessStatus: 'restricted_by_role',
    summary: {
      ...inventory.summary,
      totalInventoryValueAtCost: null,
      totalAverageInventoryValueAtCost: null,
      overallCostBasedTurnoverRatio: null,
      shrinkageCostTotal: null,
      restockCostTotal: null,
      totalRecommendedOrderCost: null,
    },
    products: inventory.products.map((p) => ({
      ...p,
      unitCost: null,
      inventoryValueAtCost: null,
      averageInventoryValueAtCost: null,
      cogsInPeriod: null,
      grossProfitInPeriod: null,
      costBasedStockTurnoverRatio: null,
      reorderRecommendation: {
        ...p.reorderRecommendation,
        estimatedOrderCost: null,
      },
    })),
    recentMovementsSummary: inventory.recentMovementsSummary.map((m) => ({
      ...m,
      estimatedValue: null,
    })),
  };
}

/**
 * Enforces branch visibility and cost/margin masking on BranchAnalyticsResult.
 */
export function sanitizeBranchesForRole(
  branches: BranchAnalyticsResult,
  user: AnalyticsUserContext
): BranchAnalyticsResult {
  let scopedBranches = branches.branches;
  if (
    !user.canViewAllBranches &&
    user.assignedBranchId &&
    user.assignedBranchId !== 'all'
  ) {
    scopedBranches = scopedBranches.filter(
      (b) => b.branchId === user.assignedBranchId
    );
  }

  if (!user.canViewCostAndMargin) {
    scopedBranches = scopedBranches.map((b) => ({
      ...b,
      cogs: null,
      grossProfit: null,
      grossMarginPercent: null,
    }));
  }

  return {
    ...branches,
    costAccessStatus: user.canViewCostAndMargin
      ? 'authorized'
      : 'restricted_by_role',
    branches: scopedBranches,
    topBranchId: scopedBranches[0]?.branchId || null,
  };
}

/**
 * Masks profit forecast series if user lacks cost/margin permission.
 */
export function sanitizeForecastsForRole(
  forecasts: ForecastingResult,
  user: AnalyticsUserContext
): ForecastingResult {
  if (user.canViewCostAndMargin) return forecasts;

  return {
    ...forecasts,
    revenueForecastSummary: {
      ...forecasts.revenueForecastSummary,
      expectedTotalGrossProfit: null,
    },
    profitSeries: [],
  };
}

/**
 * Filters out sensitive financial/margin insights for roles without financial or cost access.
 */
export function sanitizeInsightsForRole(
  insights: BusinessInsightItem[],
  user: AnalyticsUserContext
): BusinessInsightItem[] {
  return insights.filter((item) => {
    if (!user.canViewFinancials) {
      if (item.category === 'cash_and_debt' || item.category === 'fx_sensitivity') {
        return false;
      }
    }
    if (!user.canViewCostAndMargin) {
      if (item.id === 'insight-inventory-dead-stock') {
        return false;
      }
    }
    return true;
  });
}

/**
 * Masks customer phone numbers if user lacks customer PII permission.
 */
export function sanitizeCustomersForRole(
  customers: CustomerAnalyticsResult,
  user: AnalyticsUserContext
): CustomerAnalyticsResult {
  if (user.canViewCustomerPII) return customers;

  const maskPhone = (phone: string) =>
    phone && phone.length > 4
      ? `${'*'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`
      : '****';

  return {
    ...customers,
    piiAccessStatus: 'restricted_by_role',
    topCustomers: customers.topCustomers.map((c) => ({
      ...c,
      phone: maskPhone(c.phone),
    })),
    creditExposureRanking: customers.creditExposureRanking.map((c) => ({
      ...c,
      phone: maskPhone(c.phone),
    })),
  };
}

/**
 * Masks sensitive financial alerts, unit costs, and customer PII from SmartStoreIntelligenceResult
 * according to the verified server-side user role.
 */
export function sanitizeIntelligenceForRole(
  intelligence: SmartStoreIntelligenceResult,
  user: AnalyticsUserContext
): SmartStoreIntelligenceResult {
  const filterAlerts = (alerts: SmartStoreIntelligenceResult['smartAlerts']) =>
    alerts.filter((a) => {
      if (!user.canViewFinancials && a.category === 'FINANCIAL_RISK') {
        return false;
      }
      if (
        !user.canViewAllBranches &&
        user.assignedBranchId &&
        user.assignedBranchId !== 'all' &&
        a.branchId !== 'all' &&
        a.branchId !== user.assignedBranchId
      ) {
        return false;
      }
      return true;
    });

  const filteredSmartAlerts = filterAlerts(intelligence.smartAlerts);
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
  for (const a of filteredSmartAlerts) {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  }

  return {
    ...intelligence,
    overview: {
      ...intelligence.overview,
      totalActiveAlerts: filteredSmartAlerts.length,
      criticalAlertsCount: filteredSmartAlerts.filter(
        (a) => a.severity === 'CRITICAL'
      ).length,
      highAlertsCount: filteredSmartAlerts.filter((a) => a.severity === 'HIGH')
        .length,
      totalRecommendedReplenishmentCost: user.canViewCostAndMargin
        ? intelligence.overview.totalRecommendedReplenishmentCost
        : null,
      byCategory: byCategory as any,
    },
    unmetDemand: {
      ...intelligence.unmetDemand,
      topRequestedProducts: intelligence.unmetDemand.topRequestedProducts.map((p) => ({
        ...p,
        estimatedLostGrossProfitConservative: user.canViewCostAndMargin
          ? p.estimatedLostGrossProfitConservative
          : null,
      })),
      lostSalesEstimation: {
        ...intelligence.unmetDemand.lostSalesEstimation,
        estimatedLostGrossProfit: user.canViewCostAndMargin
          ? intelligence.unmetDemand.lostSalesEstimation.estimatedLostGrossProfit
          : null,
      },
      recentRequests: intelligence.unmetDemand.recentRequests.map((r) =>
        redactUnmetDemandRecordForRole(r, user.canViewCustomerPII)
      ),
    },
    smartAlerts: filteredSmartAlerts,
    inventoryRisks: filterAlerts(intelligence.inventoryRisks),
    financialRisks: user.canViewFinancials
      ? filterAlerts(intelligence.financialRisks)
      : [],
    branchInsights: filterAlerts(intelligence.branchInsights),
    replenishmentRecommendations: intelligence.replenishmentRecommendations.map((r) => ({
      ...r,
      unitCost: user.canViewCostAndMargin ? r.unitCost : null,
      estimatedOrderCost: user.canViewCostAndMargin ? r.estimatedOrderCost : null,
    })),
    branchTransferOpportunities: user.canViewAllBranches
      ? intelligence.branchTransferOpportunities
      : intelligence.branchTransferOpportunities.filter(
          (t) =>
            !user.assignedBranchId ||
            t.fromBranchId === user.assignedBranchId ||
            t.toBranchId === user.assignedBranchId
        ),
  };
}
