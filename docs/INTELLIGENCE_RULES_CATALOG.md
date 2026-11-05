# Smart Store Operations & Intelligence Rules Catalog (Phase 10)

## 1. Overview
The Dqnamo POS Smart Store Operations & Business Insights Engine (`src/analytics/calculations/replenishment.metrics.ts`) evaluates real-time store inventory, historical sales velocity, customer unmet demand inquiries, purchase lead times, financial margins, and inter-branch stock distributions across **10 standardized intelligence categories**.

Every generated alert and recommendation adheres to strict anti-noise and operational safety principles:
- **Deterministic Deduplication:** Every alert computes a canonical `dedupeKey` (`<CATEGORY>:<branchId>:<productId|scope>`) to prevent duplicate alert spam.
- **5-Tier Confidence Grading:** `VERIFIED`, `HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT_DATA`.
- **5-Tier Severity Classification:** `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`.
- **Alert Lifecycle Management:** `active`, `acknowledged`, `resolved`, `dismissed`.
- **Mandatory Human-in-the-Loop Approval:** Every replenishment and transfer recommendation carries `approvalStatus: 'requires_user_approval'`. No rule automatically creates purchase orders, modifies inventory, or changes prices.

---

## 2. The 10 Standardized Intelligence Categories

### Category 1: `INVENTORY_RISK` (Dead Stock, Overstock & Near-Expiry Risk)
- **Trigger Conditions:**
  1. **Near-Expiry / Expired Stock (`CRITICAL` / `HIGH`):** Product has `stock > 0` and `expiryDate` is either in the past (`daysToExpiry <= 0`) or within 45 days (`daysToExpiry <= 45`) where current stock exceeds projected sales before expiration.
  2. **Dead Stock / Capital Lock (`MEDIUM`):** Product has `stock > minStockAlert * 2`, zero units sold in the analysis period, and zero unmet demand inquiries.
- **Evidence Metrics:** `currentStock`, `daysToExpiry`, `inventoryCostLocked`, `projectedUnitsBeforeExpiry`.
- **Confidence Level:** `VERIFIED` (for exact batch expiration dates and physical stock counts).

### Category 2: `UNMET_DEMAND` (Repeated Unavailable Customer Requests & Catalog Gaps)
- **Trigger Conditions:**
  1. **Repeated Out-of-Stock Inquiries (`CRITICAL` / `HIGH`):** Registered catalog product has $\ge 2$ recorded customer inquiries (`inquiryCount >= 2`) or $\ge 3$ requested base units while out of stock or expired.
  2. **Unregistered Catalog Gap (`MEDIUM` / `HIGH`):** Unregistered product (`isRegisteredProduct = false`) has repeated customer inquiries across one or more branches.
- **Evidence Metrics:** `inquiryCount`, `requestedBaseUnitsTotal`, `confirmedPurchaseIntentUnits`, `estimatedLostRevenueConservative`.
- **Confidence Level:** `HIGH` when `inquiryCount >= 3` and product pricing is verified; `MEDIUM` when `inquiryCount == 2`; `INSUFFICIENT_DATA` for monetary lost sales on unpriced unregistered items.

### Category 3: `RISING_DEMAND` (Accelerating Latent Customer Demand)
- **Trigger Conditions:**
  - Product's combined latent daily demand (`observedSalesDailyVelocity + unmetDemandDailyVelocity`) exceeds historical baseline velocity by $\ge 25\%$, or recent 7-day demand velocity exceeds 30-day average velocity by $\ge 30\%$ with at least 3 units demanded.
- **Evidence Metrics:** `observedSalesDailyVelocity`, `estimatedLatentDailyDemand`, `velocityGrowthPercent`.
- **Confidence Level:** `HIGH` ($\ge 14$ days history), `MEDIUM` (7–13 days history).

### Category 4: `STOCKOUT_RISK` (Imminent Stock Depletion Within Lead Time)
- **Trigger Conditions:**
  - Product is currently out of stock (`currentStock === 0`) with active sales or unmet demand (`CRITICAL`), OR estimated days until stockout (`currentStock / estimatedLatentDailyDemand`) is less than or equal to supplier lead time (`daysUntilStockout <= leadTimeDays + 2`) (`HIGH`).
- **Evidence Metrics:** `currentStock`, `estimatedLatentDailyDemand`, `daysUntilStockout`, `leadTimeDays`.
- **Confidence Level:** `VERIFIED` when `currentStock === 0`; `HIGH` when `daysUntilStockout <= leadTimeDays`.

### Category 5: `REPLENISHMENT` (Smart Purchase Order Recommendations)
- **Formula:**
  $$\text{LatentDailyDemand} = \frac{\text{SoldUnits}}{\max(1, \text{ActiveInStockDays})} + \frac{0.85 \times \text{DedupedConfirmedUnmetUnits}}{\text{PeriodDays}}$$
  $$\text{SafetyStock} = Z_{95\%} \times \sigma_{\text{demand}} \times \sqrt{\text{LeadTimeDays}}$$
  $$\text{ReorderPoint (ROP)} = (\text{LatentDailyDemand} \times \text{LeadTimeDays}) + \text{SafetyStock}$$
  $$\text{TargetStock} = \text{ROP} + (\text{LatentDailyDemand} \times \text{ReviewCycleDays})$$
  $$\text{RecommendedOrderUnits} = \max\left(0, \lceil \text{TargetStock} - (\text{CurrentStock} + \text{PendingInboundUnits}) \rceil\right)$$
- **Expiry Cap Safeguard:** If a product has shelf-life constraints (`daysToExpiry <= 60`), `RecommendedOrderUnits` is capped so total stock does not exceed 70% of projected sell-through before expiry.
- **Approval Policy:** `requires_user_approval`.

### Category 6: `FINANCIAL_RISK` (Negative/Low Margins, High Return Rates & Overdue Receivables)
- **Trigger Conditions:**
  1. **Margin Compression / Negative Margin (`CRITICAL` / `HIGH`):** Product or category realized gross margin is $< 10\%$ or negative.
  2. **Elevated Return Rate (`HIGH` / `MEDIUM`):** Product return rate exceeds $12\%$ of gross units sold.
  3. **Customer Credit / Overdue Debt Exposure (`HIGH` / `MEDIUM`):** Customer receivables concentration or overdue balances exceed safe working-capital thresholds.
- **Role Scoping:** Automatically redacted (`financialRisks = []`) for `cashier` and `inventory` roles lacking `canViewCostsAndMargins`.

### Category 7: `SALES_ANOMALY` (Statistical Revenue & Transaction Spikes/Drops)
- **Trigger Conditions:**
  - Daily revenue or unit volume deviates from the 20-day rolling mean by $|Z| \ge 2.0\sigma$ (Bollinger Band breakout or breakdown).
- **Evidence Metrics:** `dailyRevenue`, `rollingMean20`, `zScore`, `deviationPercent`.

### Category 8: `BRANCH_IMBALANCE` (Cross-Branch Demand & Fulfillment Disparity)
- **Trigger Conditions:**
  - Significant divergence in demand capture efficiency (`DemandCaptureEfficiency = ActualSold / (ActualSold + UnmetDemand)`) or stock-to-sales ratio across branches ($\ge 25\%$ gap between branches).
- **Evidence Metrics:** `branchDemandCapturePercent`, `unmetInquiriesCount`, `branchStockCoverageDays`.

### Category 9: `SEASONAL_PATTERN` (Day-of-Week & Weekly Demand Cyclicality)
- **Trigger Conditions:**
  - Statistically meaningful day-of-week peak demand concentration (e.g., peak day demand exceeds mean daily demand by $\ge 35\%$) with sufficient sample depth.
- **Evidence Metrics:** `peakDayName`, `peakDayMultiplier`, `sampleWeeks`.

### Category 10: `TRANSFER_OPPORTUNITY` (Inter-Branch Surplus-to-Shortage Stock Transfers)
- **Trigger Conditions:**
  - **Source Branch (`fromBranch`):** Holds verifiable surplus stock (`SurplusUnits = CurrentStock - max(MinStockAlert * 1.5, LatentDailyDemand * 21) > 0`).
  - **Destination Branch (`toBranch`):** Experiencing stockout (`CurrentStock <= MinStockAlert`) or active unmet customer demand (`toBranchUnmetUnits > 0`) for the exact same registered `productId`.
- **Formula:**
  $$\text{RecommendedTransferUnits} = \min\left(\lfloor \text{fromBranchSurplusUnits} \rfloor, \lceil \text{toBranchShortageOrUnmetUnits} \rceil\right)$$
- **Approval Policy:** `requires_user_approval`.
