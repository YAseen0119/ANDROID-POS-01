/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PaymentMethod,
  Product,
  StockMovement,
  SupportedCurrency,
  Transaction,
  Customer,
  POSUser,
  SalesRateValuationMode,
  ExchangeRateHistoryEntry,
} from '../lib/types';
import {
  AvailabilityStatusAtRequest,
  SUPPORTED_UNAVAILABILITY_REASONS,
  UnavailabilityReason,
  UnmetDemandFulfillmentStatus,
  UnmetDemandRequestInput,
  UnmetDemandRequestRecord,
} from './unmet-demand.validation';

export {
  SUPPORTED_UNAVAILABILITY_REASONS,
  type AvailabilityStatusAtRequest,
  type UnavailabilityReason,
  type UnmetDemandFulfillmentStatus,
  type UnmetDemandRequestInput,
  type UnmetDemandRequestRecord,
};

export type AnalyticsDatePreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'mtd'
  | 'ytd'
  | 'custom';

export type MissingDateStrategy = 'zero_fill' | 'skip_missing';

export type ABCClassificationBasis = 'revenue' | 'gross_profit' | 'consumption_value';

export type CogsDataQualityStatus =
  | 'exact_frozen_at_sale'
  | 'reconstructed_from_price_history'
  | 'estimated_from_current_catalog_cost'
  | 'mixed_historical_and_estimated'
  | 'incomplete_missing_cost';

export type FinancialAccessStatus = 'authorized' | 'restricted_by_role';

export interface ReturnRecordInput {
  id: string;
  saleId: string; // matches Transaction.id or sales.transactionId
  timestamp?: string;
  reason?: string;
  refundTotal: number;
  items?: {
    productId: string;
    quantity: number;
    refundAmount: number;
  }[];
}

export interface PurchaseOrderRecordInput {
  id: string;
  purchaseNumber: string;
  supplierName?: string;
  branchId?: string;
  totalAmount: number;
  paidAmount?: number;
  status: 'ordered' | 'received' | 'cancelled';
  paymentStatus?: 'paid' | 'partial' | 'unpaid';
  currency?: SupportedCurrency;
  invoiceDate: string;
  items?: {
    productId: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }[];
}

export interface SourceOfTruthDomainMeta {
  domain:
    | 'sales_and_items'
    | 'returns'
    | 'products_and_costs'
    | 'inventory_and_movements'
    | 'customers_and_payments'
    | 'purchases_and_suppliers'
    | 'exchange_rates'
    | 'unmet_demand_requests';
  primarySource: string;
  fallbackSource: string;
  deduplicationKey: string;
  reconciliationRule: string;
  recordCount: number;
}

export interface AnalyticsFilterParams {
  datePreset?: AnalyticsDatePreset;
  startDate?: string; // ISO or YYYY-MM-DD
  endDate?: string;   // ISO or YYYY-MM-DD
  branchId?: string;  // 'all' or specific branch/terminal ID
  category?: string;  // 'all' or specific category name
  productId?: string; // 'all' or specific product ID
  customerId?: string; // 'all' or specific customer ID
  supplierName?: string; // 'all' or specific supplier
  cashierName?: string; // 'all' or specific cashier/terminal
  paymentMethod?: PaymentMethod | 'all';
  currency?: SupportedCurrency;
  valuationMode?: SalesRateValuationMode; // default: 'historical'
  anchorCurrency?: SupportedCurrency;     // default: 'USD'
  transactionStatus?: 'completed' | 'voided' | 'all';
  abcBasis?: ABCClassificationBasis;
  leadTimeDays?: number;
  safetyStockDays?: number;
  forecastHorizonDays?: 7 | 30 | 90;
  missingDateStrategy?: MissingDateStrategy;
  fixedOperatingExpensesOverride?: number; // Optional explicit fixed overhead if provided
}

export interface AnalyticsUserContext {
  userId: string;
  userName: string;
  role: 'admin' | 'manager' | 'cashier' | 'inventory_clerk';
  assignedBranchId?: string;
  assignedTerminalName?: string;
  canViewFinancials: boolean;
  canViewCostAndMargin: boolean;
  canViewAllBranches: boolean;
  canViewCustomerPII: boolean;
  canExportAnalytics: boolean;
  branchRestrictionEnforced: boolean;
  roleVerifiedFromServerStore: boolean;
}

export interface AnalyticsDatasetSnapshot {
  products: Product[];
  transactions: Transaction[];
  returns: ReturnRecordInput[];
  purchases: PurchaseOrderRecordInput[];
  customers: Customer[];
  stockMovements: StockMovement[];
  users: POSUser[];
  unmetDemandRequests?: UnmetDemandRequestRecord[];
  exchangeRates: Record<string, number>;
  exchangeRateHistory: ExchangeRateHistoryEntry[];
  branches: {
    id: string;
    name: string;
    nameAr: string;
    code: string;
    terminalNames: string[];
  }[];
  dataSource: 'postgresql_and_store_state' | 'store_state_snapshot';
  sourceOfTruthMatrix: SourceOfTruthDomainMeta[];
}

export interface MetricDefinitionMeta {
  key: string;
  nameEn: string;
  nameAr: string;
  formulaEn: string;
  formulaAr: string;
  unit: 'currency' | 'percentage' | 'count' | 'days' | 'ratio';
  sourceTables: string[];
}

export interface HourlySalesBucket {
  hour: number; // 0..23
  label: string;
  grossSales: number;
  netSales: number;
  transactionCount: number;
  unitsSold: number;
  averageTransactionValue: number;
}

export interface WeekdaySalesBucket {
  dayOfWeek: number; // 0 (Sun) .. 6 (Sat)
  labelEn: string;
  labelAr: string;
  grossSales: number;
  netSales: number;
  transactionCount: number;
  unitsSold: number;
}

export interface DailyIntradayCandlestick {
  dateKey: string;
  label: string;
  /** First active hour's net sales on this date (0 if no sales) */
  open: number;
  /** Highest hourly net sales on this date */
  high: number;
  /** Lowest active hourly net sales on this date */
  low: number;
  /** Last active hour's net sales on this date */
  close: number;
  /** Total daily net sales volume */
  dailyTotalSales: number;
  /** Total transactions on this date */
  transactionCount: number;
  /** Total units sold on this date */
  unitsSold: number;
  /** Peak hour (0..23) on this date */
  peakHour: number | null;
  /** Direction of closing hour vs opening hour */
  intradayDirection: 'bullish' | 'bearish' | 'flat';
}

export interface SalesByDimensionItem {
  id: string;
  name: string;
  nameAr?: string;
  grossSales: number;
  netSales: number;
  discounts: number;
  returnsDeducted: number;
  tax: number;
  cogs: number | null;
  grossProfit: number | null;
  grossMarginPercent: number | null;
  cogsDataQuality: CogsDataQualityStatus;
  transactionCount: number;
  unitsSold: number;
  shareOfNetSalesPercent: number;
}

export interface SalesAnalyticsResult {
  currency: SupportedCurrency;
  valuationMode: SalesRateValuationMode;
  costAccessStatus: FinancialAccessStatus;
  cogsDataQuality: CogsDataQualityStatus;
  cogsValuationNoteEn: string;
  cogsValuationNoteAr: string;
  periodStart: string;
  periodEnd: string;
  summary: {
    grossSales: number;               // Pre-discount, tax-exclusive gross of completed sales
    discountsTotal: number;           // Item discounts + invoice global discounts on completed sales
    discountRatePercent: number;
    merchandiseReturnsNetSales: number; // Net revenue deducted due to full/partial returns
    merchandiseReturnsTax: number;      // Tax refunded on returns
    merchandiseReturnsBilledTotal: number;
    merchandiseReturnsCount: number;
    netSales: number;                 // GrossSales - DiscountsTotal - MerchandiseReturnsNetSales (Excl. tax & voids)
    taxCollected: number;             // Net tax collected after return tax adjustments
    billedGrandTotal: number;         // NetSales + TaxCollected
    voidedSalesAmount: number;        // Excluded voided invoices total
    voidedTransactionCount: number;
    returnedOrVoidedSales: number;    // Combined returns + voids for backward compatibility
    returnedOrVoidedCount: number;
    transactionCount: number;         // Completed non-voided transactions
    unitsSold: number;                // Net units sold (after subtracting returned units)
    grossUnitsSoldBeforeReturns: number;
    returnedUnitsCount: number;
    averageTransactionValue: number;  // Net Sales / Completed Transactions
    averageBilledTicket: number;      // Billed Grand Total / Completed Transactions
    unitsPerTransaction: number;      // Net Units Sold / Completed Transactions
    previousPeriodNetSales: number;
    periodOverPeriodGrowthPercent: number;
  };
  dailySeries: {
    dateKey: string;
    label: string;
    grossSales: number;
    netSales: number;
    billedGrandTotal: number;
    discounts: number;
    returnsNet: number;
    tax: number;
    cogs: number | null;
    grossProfit: number | null;
    transactionCount: number;
    unitsSold: number;
    averageTransactionValue: number;
  }[];
  intradayCandlesticks: DailyIntradayCandlestick[];
  hourlyDistribution: HourlySalesBucket[];
  weekdayDistribution: WeekdaySalesBucket[];
  byCategory: SalesByDimensionItem[];
  byProduct: SalesByDimensionItem[];
  byBranch: SalesByDimensionItem[];
  byEmployee: SalesByDimensionItem[];
  byPaymentMethod: {
    method: PaymentMethod;
    labelEn: string;
    labelAr: string;
    transactionCount: number;
    grossAmount: number;
    netSalesAmount: number;
    sharePercent: number;
  }[];
  byCurrency: {
    originalCurrency: string;
    transactionCount: number;
    originalAmount: number;
    convertedNetSales: number;
    averageHistoricalRateToSdg: number;
    sharePercent: number;
  }[];
}

export interface FinancialAnalyticsResult {
  currency: SupportedCurrency;
  valuationMode: SalesRateValuationMode;
  financialAccessStatus: FinancialAccessStatus;
  cogsDataQuality: CogsDataQualityStatus;
  periodStart: string;
  periodEnd: string;
  profitAndLoss: {
    grossRevenueBilled: number;
    grossSalesPreDiscount: number;
    salesDiscounts: number;
    merchandiseReturnsNet: number;
    voidedInvoicesExcluded: number;
    returnsAndVoids: number;
    taxesCollected: number;
    netSalesRevenue: number;
    costOfGoodsSold: number | null;
    exactHistoricalCogsPortion: number | null;
    estimatedCurrentCostCogsPortion: number | null;
    unresolvableCostRevenuePortion: number | null;
    cogsDataQuality: CogsDataQualityStatus;
    cogsStatusNoteEn: string;
    cogsStatusNoteAr: string;
    grossProfit: number | null; // null if restricted by role
    estimatedGrossProfit: number | null;
    grossProfitMarginPercent: number | null;
    isGrossProfitEstimated: boolean;
    recordedShrinkageAndDamageExpense: number | null;
    profitAfterRecordedShrinkage: number | null;
    profitAfterShrinkageMarginPercent: number | null;
    generalOperatingExpenses: number | null;
    generalOperatingExpensesStatus: 'recorded' | 'not_recorded_in_schema';
    generalOperatingExpensesNoteEn: string;
    generalOperatingExpensesNoteAr: string;
    operatingProfitStatus: 'available' | 'unavailable_missing_operating_expenses' | 'restricted_by_role';
    netOperatingProfit: number | null; // Strictly null when generalOperatingExpenses is unavailable
    netProfitMarginPercent: number | null;
  };
  cashFlowAndWorkingCapital: {
    cashInflowsFromSalesAtCheckout: number;
    cashInflowsFromDebtSettlements: number;
    cashRefundsForReturns: number;
    totalCashInflows: number;
    purchaseCommitmentsTotal: number;
    cashOutflowsForRestockPurchases: number;
    supplierCashOutflowStatus: 'verified_payment_records' | 'estimated_from_received_paid_restocks';
    supplierCashOutflowNoteEn: string;
    supplierCashOutflowNoteAr: string;
    netCashFlow: number;
    accountsReceivableOutstandingDebt: number;
    accountsPayablePendingInvoices: number;
    inventoryValuationAtCost: number | null;
    inventoryValuationAtRetail: number;
    potentialInventoryGrossProfit: number | null;
    collectionEfficiencyPercent: number;
  };
  breakEvenAnalysis: {
    status: 'available' | 'unavailable_missing_fixed_costs' | 'restricted_by_role';
    fixedOperatingCosts: number | null;
    variableCostsCogs: number | null;
    contributionMargin: number | null;
    contributionMarginRatio: number | null;
    averageGrossMarginRatio: number | null;
    recordedShrinkageCosts: number | null;
    breakEvenSalesRevenue: number | null;
    currentNetSalesRevenue: number;
    surplusOrDeficitRevenue: number | null;
    isAboveBreakEven: boolean | null;
    noteEn: string;
    noteAr: string;
  };
  fxSensitivityAndValuation: {
    netSalesAtHistoricalRate: number;
    netSalesAtLiveRate: number;
    netSalesAtUsdIndexedRate: number;
    unrealizedFxTranslationDelta: number;
    fxPurchasingPowerPreservationPercent: number;
    anchorCurrency: string;
  };
  categoryProfitability: SalesByDimensionItem[];
  productProfitability: SalesByDimensionItem[];
}

export interface ProductInventoryAnalyticsItem {
  productId: string;
  sku: string;
  name: string;
  nameAr?: string;
  category: string;
  categoryAr?: string;
  reconstructedBeginningStock: number;
  currentStock: number;
  averageStockUnits: number;
  pendingInboundPurchaseUnits: number;
  minStockAlert: number;
  unitCost: number | null;
  unitSellingPrice: number;
  inventoryValueAtCost: number | null;
  averageInventoryValueAtCost: number | null;
  inventoryValueAtRetail: number;
  unitsSoldInPeriod: number;
  netSalesInPeriod: number;
  cogsInPeriod: number | null;
  grossProfitInPeriod: number | null;
  averageDailyDemand: number;
  /** Standard Cost-Based Inventory Turnover = COGS / AverageInventoryValueAtCost */
  costBasedStockTurnoverRatio: number | null;
  /** Unit Sell-Through Proxy = UnitsSold / (CurrentStock + UnitsSold) */
  estimatedUnitSellThroughRatio: number;
  /** Legacy alias kept for UI compatibility, equals costBasedStockTurnoverRatio ?? estimatedUnitSellThroughRatio */
  stockTurnoverRatio: number;
  turnoverFormulaUsed: 'cogs_over_reconstructed_avg_inventory_cost' | 'unit_sell_through_proxy';
  daysOfInventoryOnHand: number | null; // null if demand is 0
  daysSinceLastSale: number | null;
  stockStatus: 'healthy' | 'low_stock' | 'out_of_stock' | 'overstock';
  movementVelocityClass: 'fast_moving' | 'moderate_moving' | 'slow_moving' | 'dead_stock';
  abcClass: 'A' | 'B' | 'C';
  abcBasisValue: number;
  abcCumulativeSharePercent: number;
  shrinkageUnitsInPeriod: number;
  restockedUnitsInPeriod: number;
  reorderRecommendation: {
    shouldReorder: boolean;
    urgency: 'critical' | 'high' | 'medium' | 'none';
    reorderPointUnits: number;
    safetyStockUnits: number;
    leadTimeDaysAssumed: number;
    pendingInboundUnitsDeducted: number;
    recommendedOrderQuantity: number;
    estimatedOrderCost: number | null;
    estimatedStockoutDate: string | null;
    daysUntilStockout: number | null;
    explanationEn: string;
    explanationAr: string;
    approvalStatus: 'requires_user_approval';
  };
}

export interface InventoryAnalyticsResult {
  currency: SupportedCurrency;
  costAccessStatus: FinancialAccessStatus;
  abcBasis: ABCClassificationBasis;
  leadTimeDaysAssumed: number;
  safetyStockDaysAssumed: number;
  valuationMethod: 'standard_unit_cost_replacement';
  turnoverCalculationBasis: 'reconstructed_average_inventory_cost' | 'unit_sell_through_proxy';
  turnoverMethodologyNoteEn: string;
  turnoverMethodologyNoteAr: string;
  valuationMethodNoteEn: string;
  valuationMethodNoteAr: string;
  summary: {
    totalSkus: number;
    totalStockUnits: number;
    totalPendingInboundUnits: number;
    totalInventoryValueAtCost: number | null;
    totalAverageInventoryValueAtCost: number | null;
    totalInventoryValueAtRetail: number;
    overallCostBasedTurnoverRatio: number | null;
    overallUnitSellThroughRatio: number;
    overallStockTurnoverRatio: number;
    overallDaysOfInventoryOnHand: number | null;
    healthySkusCount: number;
    lowStockSkusCount: number;
    outOfStockSkusCount: number;
    overstockSkusCount: number;
    fastMovingCount: number;
    slowMovingCount: number;
    deadStockCount: number;
    shrinkageUnitsTotal: number;
    shrinkageCostTotal: number | null;
    restockUnitsTotal: number;
    restockCostTotal: number | null;
    reorderActionRequiredCount: number;
    totalRecommendedOrderCost: number | null;
  };
  abcSummary: {
    classA: { count: number; valueSharePercent: number; skuSharePercent: number };
    classB: { count: number; valueSharePercent: number; skuSharePercent: number };
    classC: { count: number; valueSharePercent: number; skuSharePercent: number };
  };
  products: ProductInventoryAnalyticsItem[];
  recentMovementsSummary: {
    type: StockMovement['type'];
    count: number;
    totalUnits: number;
    estimatedValue: number | null;
  }[];
}

export interface CustomerAnalyticsItem {
  customerId: string;
  name: string;
  phone: string;
  periodPurchaseCount: number;
  periodNetSpend: number;
  periodBilledTotal: number;
  lifetimeSpend: number;
  lifetimeTransactionCount: number;
  averagePurchaseValue: number;
  outstandingDebt: number;
  daysSinceLastPurchase: number | null;
  segment: 'vip_champion' | 'repeat_loyal' | 'credit_risk' | 'new_active' | 'at_risk_inactive';
  segmentLabelEn: string;
  segmentLabelAr: string;
}

export interface CustomerAnalyticsResult {
  currency: SupportedCurrency;
  piiAccessStatus: FinancialAccessStatus;
  summary: {
    totalRegisteredCustomers: number;
    activeCustomersInPeriod: number;
    repeatCustomersCount: number;
    repeatPurchaseRatePercent: number;
    walkInTransactionsCount: number;
    registeredCustomerTransactionsCount: number;
    registeredRevenueSharePercent: number;
    totalCustomerDebt: number;
    customersWithDebtCount: number;
    averageCustomerSpend: number;
  };
  topCustomers: CustomerAnalyticsItem[];
  creditExposureRanking: CustomerAnalyticsItem[];
  segmentationCounts: {
    segment: CustomerAnalyticsItem['segment'];
    labelEn: string;
    labelAr: string;
    count: number;
    totalSpend: number;
    totalDebt: number;
  }[];
}

export interface BranchPerformanceItem {
  branchId: string;
  branchName: string;
  branchNameAr: string;
  branchCode: string;
  grossSales: number;
  netSales: number;
  cogs: number | null;
  grossProfit: number | null;
  grossMarginPercent: number | null;
  transactionCount: number;
  unitsSold: number;
  averageTransactionValue: number;
  outstandingDebt: number;
  collectionRatePercent: number;
  activeCashiersCount: number;
  revenueSharePercent: number;
  rank: number;
}

export interface BranchAnalyticsResult {
  currency: SupportedCurrency;
  costAccessStatus: FinancialAccessStatus;
  branches: BranchPerformanceItem[];
  topBranchId: string | null;
}

export interface TechnicalIndicatorPoint {
  dateKey: string;
  label: string;
  value: number; // Daily Net Sales
  unitsSold: number;
  transactionCount: number;
  sma7: number | null;
  sma30: number | null;
  sma90: number | null;
  ema7: number | null;
  ema30: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  trendlineValue: number;
}

export interface TechnicalSignalSummary {
  indicator: 'SMA_EMA_CROSS' | 'RSI_14' | 'MACD_12_26_9' | 'LINEAR_TREND' | 'SUPPORT_RESISTANCE' | 'VOLUME_MOMENTUM';
  nameEn: string;
  nameAr: string;
  status: 'bullish_expansion' | 'bearish_contraction' | 'overbought_peak' | 'oversold_dip' | 'neutral_consolidation' | 'insufficient_data';
  currentValue: number | null;
  referenceThreshold: string;
  interpretationEn: string;
  interpretationAr: string;
  dataPointsUsed: number;
  minimumPointsRequired: number;
}

export interface TechnicalIndicatorsResult {
  currency: SupportedCurrency;
  targetMetric: 'net_sales' | 'gross_profit' | 'units_sold';
  missingDateStrategy: MissingDateStrategy;
  calendarDaysCount: number;
  activeSalesDaysCount: number;
  dataSufficiencyNoteEn: string;
  dataSufficiencyNoteAr: string;
  latestValues: {
    currentValue: number;
    sma7: number | null;
    sma30: number | null;
    sma90: number | null;
    ema7: number | null;
    ema30: number | null;
    rsi14: number | null;
    rsiAdaptive7: number | null;
    macdLine: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    trendSlopePerDay: number;
    trendDirection: 'upward' | 'downward' | 'flat';
    supportFloor: number;
    resistanceCeiling: number;
    momentumPercent: number;
  };
  signals: TechnicalSignalSummary[];
  series: TechnicalIndicatorPoint[];
  intradayCandlesticks: DailyIntradayCandlestick[];
}

export type ForecastingModelName =
  | 'naive_last_value'
  | 'moving_average_7'
  | 'seasonal_naive_weekly'
  | 'simple_exponential_smoothing'
  | 'holt_linear_exponential';

export interface ModelBacktestEvaluation {
  model: ForecastingModelName;
  modelNameEn: string;
  modelNameAr: string;
  horizonTestedDays: number;
  rollingOriginsCount: number;
  mae: number;
  wapePercent: number;
  forecastBias: number; // Mean signed error: mean(forecast - actual)
  biasPercent: number;
  empiricalCoverage80Percent: number | null;
  empiricalCoverage95Percent: number | null;
  beatsNaiveBaseline: boolean;
  trainPoints: number;
  testPoints: number;
  isSelectedWinner: boolean;
}

export interface ForecastPoint {
  dateKey: string;
  label: string;
  isHistorical: boolean;
  actualValue: number | null;
  fittedOrForecastValue: number;
  lowerBound80: number | null;
  upperBound80: number | null;
  lowerBound95: number | null;
  upperBound95: number | null;
}

export interface ProductDemandForecastItem {
  productId: string;
  sku: string;
  name: string;
  nameAr?: string;
  currentStock: number;
  pendingInboundUnits: number;
  historicalDailyDemand: number;
  forecastedDailyDemand: number;
  forecastHorizonDays: number;
  forecastedTotalUnits: number;
  forecastedRevenue: number;
  estimatedDaysUntilDepletion: number | null;
  estimatedDepletionDate: string | null;
  recommendedReorderUnits: number;
  selectedModel: ForecastingModelName;
  wapePercent: number;
  forecastBias: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  // Phase 10 Predictive Demand Extensions
  observedSalesDemandUnits?: number;
  observedUnmetDemandUnits?: number;
  estimatedLatentDailyDemand?: number;
  forecastedLatentTotalUnits?: number;
  stockoutDaysObservedInWindow?: number;
  censoringAdjusted?: boolean;
  fallbackHierarchyUsed?: 'branch_product' | 'store_product' | 'category_baseline';
}

export interface PredictiveDemandComparisonSummary {
  baselineSalesOnlyWapePercent: number;
  latentDemandAdjustedWapePercent: number;
  baselineSalesOnlyMae: number;
  latentDemandAdjustedMae: number;
  baselineBias: number;
  latentDemandAdjustedBias: number;
  improvementDemonstrated: boolean;
  unmetDemandSignalsCount: number;
  censoringCompensatedProductsCount: number;
  comparisonNoteEn: string;
  comparisonNoteAr: string;
}

export interface ForecastingResult {
  currency: SupportedCurrency;
  horizonDays: 7 | 30 | 90;
  minimumHistoryRequiredDays: number;
  observedHistoryDays: number;
  activeHistoryDays: number;
  horizonSufficiencyStatus: 'sufficient_history' | 'extrapolated_beyond_observed_history' | 'insufficient_history';
  intervalCalibrationStatus: 'calibrated_empirical_coverage' | 'estimated_uncertainty_range';
  intervalLabelEn: string;
  intervalLabelAr: string;
  selectedModel: ForecastingModelName;
  selectedModelNameEn: string;
  selectedModelNameAr: string;
  selectionReasonEn: string;
  selectionReasonAr: string;
  dataQualityStatus: 'high_confidence' | 'moderate_confidence' | 'short_history_warning';
  dataQualityNoteEn: string;
  dataQualityNoteAr: string;
  backtestEvaluations: ModelBacktestEvaluation[];
  revenueForecastSummary: {
    horizonDays: number;
    expectedTotalNetSales: number;
    lowerBound80Total: number;
    upperBound80Total: number;
    expectedAverageDailySales: number;
    expectedTotalGrossProfit: number | null;
    projectedGrowthVsHistoricalPercent: number;
    // Phase 10 Latent Demand extensions
    observedHistoricalDemandRevenue?: number;
    observedUnmetDemandEstimatedRevenue?: number;
    estimatedLatentDemandRevenue?: number;
  };
  revenueSeries: ForecastPoint[];
  profitSeries: ForecastPoint[];
  productDemandForecasts: ProductDemandForecastItem[];
  predictiveDemandComparison?: PredictiveDemandComparisonSummary;
}

export type SmartInsightCategory =
  | 'INVENTORY_RISK'
  | 'UNMET_DEMAND'
  | 'RISING_DEMAND'
  | 'STOCKOUT_RISK'
  | 'REPLENISHMENT'
  | 'FINANCIAL_RISK'
  | 'SALES_ANOMALY'
  | 'BRANCH_IMBALANCE'
  | 'SEASONAL_PATTERN'
  | 'TRANSFER_OPPORTUNITY';

export const SUPPORTED_SMART_INSIGHT_CATEGORIES: readonly SmartInsightCategory[] = [
  'INVENTORY_RISK',
  'UNMET_DEMAND',
  'RISING_DEMAND',
  'STOCKOUT_RISK',
  'REPLENISHMENT',
  'FINANCIAL_RISK',
  'SALES_ANOMALY',
  'BRANCH_IMBALANCE',
  'SEASONAL_PATTERN',
  'TRANSFER_OPPORTUNITY',
] as const;

export type SmartInsightSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type SmartInsightConfidenceLevel =
  | 'VERIFIED'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INSUFFICIENT_DATA';

export type SmartAlertLifecycleStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

export interface SmartIntelligenceAlertItem {
  id: string;
  dedupeKey: string;
  category: SmartInsightCategory;
  legacyCategory: BusinessInsightItem['category'];
  severity: SmartInsightSeverity;
  priority: number; // 1 (lowest) .. 100 (highest)
  confidenceLevel: SmartInsightConfidenceLevel;
  lifecycleStatus: SmartAlertLifecycleStatus;
  branchId: string;
  productId?: string | null;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  evidenceMetrics: {
    name: string;
    valueFormatted: string;
    rawValue?: number | null;
  }[];
  affectedRecords: string[];
  periodAnalyzed: string;
  explanationEn: string;
  explanationAr: string;
  recommendedActionEn: string;
  recommendedActionAr: string;
  dataQualityStatus: 'complete' | 'partial_history' | 'estimated_cost' | 'insufficient_data';
  sourceMetrics: string[];
  approvalStatus: 'requires_user_approval' | 'informational';
}

export interface UnmetDemandProductSummaryItem {
  productKey: string;
  productId: string | null;
  isRegisteredProduct: boolean;
  productName: string;
  productNameAr: string | null;
  sku: string | null;
  barcode: string | null;
  category: string;
  inquiryCount: number;
  requestedQuantityTotal: number;
  requestedBaseUnitsTotal: number;
  confirmedPurchaseIntentCount: number;
  confirmedPurchaseIntentUnits: number;
  fulfilledLaterCount: number;
  unfulfilledCount: number;
  repeatCustomerInquiryCount: number;
  distinctBranchesCount: number;
  branchesRequested: string[];
  primaryReason: UnavailabilityReason;
  reasonBreakdown: Record<UnavailabilityReason, number>;
  currentStock: number | null;
  pendingInboundUnits: number;
  actualUnitsSoldInPeriod: number;
  actualNetSalesInPeriod: number;
  demandCaptureRatioPercent: number | null;
  repeatedStockoutPatternDetected: boolean;
  stockoutOverlapInquiriesCount: number;
  estimatedLostUnitsConservative: number | null;
  estimatedLostRevenueConservative: number | null;
  estimatedLostGrossProfitConservative: number | null;
  lostSalesEstimationStatus: 'ESTIMATED' | 'INSUFFICIENT_DATA';
  lostSalesConfidence: SmartInsightConfidenceLevel;
  firstRequestedAt: string;
  lastRequestedAt: string;
}

export interface UnmetDemandTrendPoint {
  periodKey: string;
  label: string;
  granularity: 'daily' | 'weekly' | 'monthly';
  inquiryCount: number;
  requestedBaseUnits: number;
  confirmedIntentUnits: number;
  actualUnitsSold: number;
  registeredProductInquiries: number;
  unregisteredProductInquiries: number;
  estimatedLostRevenue: number | null;
}

export interface UnmetDemandBranchComparisonItem {
  branchId: string;
  branchName: string;
  branchNameAr: string;
  inquiryCount: number;
  requestedBaseUnits: number;
  distinctProductsRequested: number;
  outOfStockInquiries: number;
  notStockedInquiries: number;
  expiredInquiries: number;
  estimatedLostRevenue: number | null;
  topRequestedProductName: string | null;
}

export interface LostSalesEstimationSummary {
  status: 'ESTIMATED' | 'INSUFFICIENT_DATA';
  methodologyEn: string;
  methodologyAr: string;
  assumptionsEn: string[];
  assumptionsAr: string[];
  confidenceLevel: SmartInsightConfidenceLevel;
  sampleSizeInquiries: number;
  pricedInquiriesCount: number;
  dataCoveragePercent: number;
  limitationsEn: string[];
  limitationsAr: string[];
  rawRequestedUnitsTotal: number;
  dedupedConfirmedWeightedUnits: number | null;
  estimatedLostRevenue: number | null;
  estimatedLostGrossProfit: number | null;
}

export interface UnmetDemandAnalyticsResult {
  currency: SupportedCurrency;
  periodStart: string;
  periodEnd: string;
  summary: {
    totalInquiries: number;
    totalRequestedQuantity: number;
    totalRequestedBaseUnits: number;
    confirmedIntentInquiries: number;
    confirmedIntentBaseUnits: number;
    registeredProductInquiries: number;
    unregisteredProductInquiries: number;
    fulfilledLaterCount: number;
    unfulfilledCount: number;
    repeatCustomerInquiries: number;
    distinctProductsRequested: number;
    repeatedStockoutProductsCount: number;
    actualUnitsSoldInPeriod: number;
    observedTotalDemandUnits: number;
    demandCaptureEfficiencyPercent: number | null;
  };
  byReason: {
    reason: UnavailabilityReason;
    labelEn: string;
    labelAr: string;
    inquiryCount: number;
    requestedBaseUnits: number;
    sharePercent: number;
  }[];
  byCategory: {
    category: string;
    inquiryCount: number;
    requestedBaseUnits: number;
    distinctProducts: number;
    estimatedLostRevenue: number | null;
  }[];
  topRequestedProducts: UnmetDemandProductSummaryItem[];
  unregisteredProductsDemand: UnmetDemandProductSummaryItem[];
  dailyTrends: UnmetDemandTrendPoint[];
  weeklyTrends: UnmetDemandTrendPoint[];
  monthlyTrends: UnmetDemandTrendPoint[];
  byBranch: UnmetDemandBranchComparisonItem[];
  lostSalesEstimation: LostSalesEstimationSummary;
  recentRequests: UnmetDemandRequestRecord[];
}

export interface SmartReplenishmentRecommendationItem {
  id: string;
  productId: string | null;
  isRegisteredProduct: boolean;
  sku: string | null;
  productName: string;
  productNameAr: string | null;
  category: string;
  branchId: string;
  currentStock: number | null;
  pendingInboundUnits: number;
  minStockAlert: number;
  observedSalesDailyVelocity: number;
  observedUnmetDemandUnits: number;
  unmetDemandInquiriesCount: number;
  estimatedLatentDailyDemand: number;
  leadTimeDays: number;
  safetyStockUnits: number;
  reorderPointUnits: number;
  recommendedOrderUnits: number;
  unitCost: number | null;
  estimatedOrderCost: number | null;
  daysUntilStockout: number | null;
  expirationRiskDetected: boolean;
  expiryDateSnapshot: string | null;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceLevel: SmartInsightConfidenceLevel;
  explanationEn: string;
  explanationAr: string;
  suggestedActionEn: string;
  suggestedActionAr: string;
  approvalStatus: 'requires_user_approval';
}

export interface BranchTransferRecommendationItem {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  productNameAr: string | null;
  fromBranchId: string;
  fromBranchName: string;
  fromBranchNameAr: string;
  toBranchId: string;
  toBranchName: string;
  toBranchNameAr: string;
  fromBranchEstimatedSurplusUnits: number;
  toBranchShortageOrUnmetUnits: number;
  toBranchUnmetInquiriesCount: number;
  recommendedTransferUnits: number;
  estimatedRetailValueProtected: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  confidenceLevel: SmartInsightConfidenceLevel;
  explanationEn: string;
  explanationAr: string;
  suggestedActionEn: string;
  suggestedActionAr: string;
  approvalStatus: 'requires_user_approval';
}

export interface SmartStoreIntelligenceResult {
  generatedAt: string;
  currency: SupportedCurrency;
  overview: {
    totalActiveAlerts: number;
    criticalAlertsCount: number;
    highAlertsCount: number;
    replenishmentRecommendationsCount: number;
    totalRecommendedReplenishmentCost: number | null;
    branchTransferOpportunitiesCount: number;
    totalTransferableUnits: number;
    expiringProductsCount: number;
    byCategory: Record<SmartInsightCategory, number>;
  };
  unmetDemand: UnmetDemandAnalyticsResult;
  smartAlerts: SmartIntelligenceAlertItem[];
  inventoryRisks: SmartIntelligenceAlertItem[];
  financialRisks: SmartIntelligenceAlertItem[];
  branchInsights: SmartIntelligenceAlertItem[];
  replenishmentRecommendations: SmartReplenishmentRecommendationItem[];
  branchTransferOpportunities: BranchTransferRecommendationItem[];
}

export interface BusinessInsightItem {
  id: string;
  category: 'sales_momentum' | 'inventory_risk' | 'profit_margin' | 'cash_and_debt' | 'branch_and_staff' | 'fx_sensitivity';
  smartCategory?: SmartInsightCategory;
  severity: 'critical' | 'warning' | 'opportunity' | 'positive';
  smartSeverity?: SmartInsightSeverity;
  priority?: number;
  titleEn: string;
  titleAr: string;
  findingEn: string;
  findingAr: string;
  metricName: string;
  metricValueFormatted: string;
  periodLabel: string;
  supportingEvidenceEn: string;
  supportingEvidenceAr: string;
  reasonEn: string;
  reasonAr: string;
  suggestedActionEn: string;
  suggestedActionAr: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  smartConfidenceLevel?: SmartInsightConfidenceLevel;
  dataQualityStatus?: 'complete' | 'partial_history' | 'estimated_cost' | 'insufficient_data';
  sourceMetrics?: string[];
  lifecycleStatus?: SmartAlertLifecycleStatus;
}

export type IntelligenceLifecycleStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

export type IntelligenceLifecycleStream =
  | 'smart_alert'
  | 'replenishment'
  | 'branch_transfer'
  | 'bi_insight';

export type IntelligenceLifecycleScopeType = 'GLOBAL' | 'BRANCH';

export type IntelligenceLifecycleEventType =
  | 'CREATED'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'DISMISSED'
  | 'REOPENED'
  | 'AUTO_RECURRED';

export interface IntelligenceLifecycleItemRecord {
  id: string;
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
  evidenceJson: {
    metrics?: { name: string; valueFormatted: string; rawValue?: number | null }[];
    affectedRecords?: string[];
    periodAnalyzed?: string;
    sourceMetrics?: string[];
    extra?: Record<string, any>;
  };
  status: IntelligenceLifecycleStatus;
  conditionHash: string;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedByName: string | null;
  acknowledgedByRole: string | null;
  acknowledgmentNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByName: string | null;
  resolvedByRole: string | null;
  resolutionNote: string | null;
  resolutionActionType: string | null;
  dismissedAt: string | null;
  dismissedByUserId: string | null;
  dismissedByName: string | null;
  dismissedByRole: string | null;
  dismissReason: string | null;
  reopenedCount: number;
  lastReopenedAt: string | null;
  lastReopenedByUserId: string | null;
  lastReopenedByName: string | null;
  updatedAt: string;
}

export interface IntelligenceLifecycleEventRecord {
  id: string;
  lifecycleItemId: string;
  dedupeKey: string;
  eventType: IntelligenceLifecycleEventType;
  fromStatus: IntelligenceLifecycleStatus | null;
  toStatus: IntelligenceLifecycleStatus;
  performedByUserId: string | null;
  performedByName: string;
  performedByRole: string;
  note: string | null;
  actionType: string | null;
  metadataJson: Record<string, any>;
  createdAt: string;
}

export interface IntelligenceLifecycleQueryFilter {
  status?: IntelligenceLifecycleStatus | 'ALL_HISTORY';
  itemStream?: IntelligenceLifecycleStream | 'all';
  category?: string;
  severity?: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sortBy?: 'priority_desc' | 'updated_desc' | 'created_desc' | 'severity_desc';
  page?: number;
  pageSize?: number;
}

export interface IntelligenceLifecycleSummaryCounts {
  active: number;
  acknowledged: number;
  resolved: number;
  dismissed: number;
  allHistory: number;
  criticalActive: number;
  highActive: number;
}

export interface IntelligenceLifecycleListResponse {
  items: IntelligenceLifecycleItemRecord[];
  counts: IntelligenceLifecycleSummaryCounts;
  pagination: {
    page: number;
    pageSize: number;
    totalMatching: number;
    totalPages: number;
  };
  filtersApplied: Required<IntelligenceLifecycleQueryFilter>;
}

export interface AnalyticsOverviewResponse {
  generatedAt: string;
  filtersApplied: AnalyticsFilterParams;
  userContext: AnalyticsUserContext;
  sourceOfTruthMatrix: SourceOfTruthDomainMeta[];
  sales: SalesAnalyticsResult;
  financial: FinancialAnalyticsResult;
  inventory: InventoryAnalyticsResult;
  customers: CustomerAnalyticsResult;
  branches: BranchAnalyticsResult;
  technicalIndicators: TechnicalIndicatorsResult;
  forecasts: ForecastingResult;
  insights: BusinessInsightItem[];
  intelligence: SmartStoreIntelligenceResult;
  lifecycleSummary?: IntelligenceLifecycleSummaryCounts;
  lifecycleItems?: IntelligenceLifecycleItemRecord[];
  metricsDictionary: MetricDefinitionMeta[];
}

