# Business Intelligence & Predictive Analytics REST API Reference

**Base Path:** `/api/analytics`  
**Router Implementation:** `src/analytics/analytics.routes.ts`  
**Operational Guarantee:** Strictly Read-Only (`GET` and snapshot-evaluation `POST /overview`).

---

## 1. Common Query Parameters (`AnalyticsFilterParams`)

All 10 endpoints accept the following query string parameters:

| Parameter | Allowed Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `datePreset` | `today`, `yesterday`, `7d`, `30d`, `90d`, `mtd`, `ytd`, `custom` | `30d` | Date window preset |
| `startDate` | `YYYY-MM-DD` or ISO timestamp | — | Start date when `datePreset=custom` |
| `endDate` | `YYYY-MM-DD` or ISO timestamp | — | End date when `datePreset=custom` |
| `branchId` | `all`, `branch-main`, `branch-bahri` | `all` | Branch filter (automatically scoped for non-admin roles) |
| `category` | `all` or category name | `all` | Product category filter |
| `productId` | `all` or product ID (`prod-1`..`prod-10`) | `all` | Specific SKU filter |
| `customerId` | `all` or customer ID (`cust-1`..`cust-3`) | `all` | Customer filter |
| `cashierName` | `all` or terminal/cashier name | `all` | Employee / POS terminal filter |
| `paymentMethod` | `all`, `cash`, `bank_transfer`, `qr_nfc` | `all` | Payment method filter |
| `currency` | `SDG`, `USD`, `SAR`, `AED`, `EUR`, `GBP` | `SDG` | Target reporting currency |
| `valuationMode` | `historical`, `indexed`, `live` | `historical` | Multi-currency exchange rate valuation mode |
| `abcBasis` | `revenue`, `gross_profit`, `consumption_value` | `revenue` | ABC Pareto classification basis |
| `leadTimeDays` | Integer `1..90` | `3` | Assumed supplier lead time in days for ROP |
| `safetyStockDays` | Integer `1..30` | `2` | Safety stock buffer days |
| `forecastHorizonDays` | `7`, `30`, `90` | `7` | Statistical forecasting horizon in days |
| `missingDateStrategy` | `zero_fill`, `skip_missing` | `zero_fill` | Handling for open calendar days with zero sales |

---

## 2. Role & Branch Security Headers

| Header | Example | Purpose |
| :--- | :--- | :--- |
| `x-user-id` | `usr-admin-1` | Active POS user identifier |
| `x-user-role` | `admin`, `manager`, `inventory_clerk`, `cashier` | Enforces RBAC permissions and field masking |
| `x-branch-id` | `branch-main` | Assigned branch for non-global users |
| `x-terminal-name` | `POS Terminal 01` | Assigned terminal for cashier scoping |

---

## 3. Endpoints Catalog

### 3.1 `GET /api/analytics/overview` (and `POST /api/analytics/overview`)
Returns the complete `AnalyticsOverviewResponse` combining all 10 analytical domains and the `metricsDictionary` in a single atomic payload.

### 3.2 `GET /api/analytics/sales`
Returns `SalesAnalyticsResult`:
- `summary`: `grossSales`, `netSales`, `billedGrandTotal`, `returnedOrVoidedSales`, `discountsTotal`, `taxCollected`, `transactionCount`, `unitsSold`, `averageTransactionValue`, `unitsPerTransaction`, `periodOverPeriodGrowthPercent`
- `dailySeries`: Daily revenue, COGS, profit, and transaction series
- `intradayCandlesticks`: Daily OHLC hourly sales candlesticks
- `hourlyDistribution` (0..23) & `weekdayDistribution` (0..6)
- `byCategory`, `byProduct`, `byBranch`, `byEmployee`, `byPaymentMethod`, `byCurrency`

### 3.3 `GET /api/analytics/financial`
Returns `FinancialAnalyticsResult`:
- `profitAndLoss`: Full P&L reconciliation (`grossSalesPreDiscount`, `salesDiscounts`, `netSalesRevenue`, `costOfGoodsSold`, `grossProfit`, `recordedShrinkageAndDamageExpense`, `generalOperatingExpensesStatus`, `netOperatingProfit`)
- `cashFlowAndWorkingCapital`: Checkout cash inflows, debt settlement inflows, restock purchase outflows, net cash flow, AR, AP, inventory valuation at cost & retail
- `breakEvenAnalysis` & `fxSensitivityAndValuation`

### 3.4 `GET /api/analytics/inventory`
Returns `InventoryAnalyticsResult`:
- `summary`: Total SKUs, units, cost/retail valuation, turnover ratio, DOH, healthy/low/out/overstock counts, fast/slow/dead counts, reorder count & estimated cost
- `abcSummary`: Class A, B, and C SKU counts and value shares
- `products`: Per-SKU inventory velocity, ABC class, and reorder recommendation

### 3.5 `GET /api/analytics/products`
Returns product and category profitability rankings, ABC classifications, and product-level demand forecasts.

### 3.6 `GET /api/analytics/customers`
Returns `CustomerAnalyticsResult` with RFM/credit segmentation (`vip_champion`, `repeat_loyal`, `credit_risk`, `new_active`, `at_risk_inactive`), repeat purchase rate, and credit exposure ranking.

### 3.7 `GET /api/analytics/branches`
Returns `BranchAnalyticsResult` with multi-branch ranking across revenue, gross profit, margin %, ATV, and collection efficiency.

### 3.8 `GET /api/analytics/technical-indicators`
Returns `TechnicalIndicatorsResult` (`SMA 7/30/90`, `EMA 7/30`, `RSI 14/7`, `MACD 12/26/9`, Linear Regression Trendline, Support/Resistance levels, Intraday Candlesticks, and plain-language `signals`).

### 3.9 `GET /api/analytics/forecasts`
Returns `ForecastingResult` (`7`, `30`, or `90` day forecasts, `backtestEvaluations` with `MAE` & `WAPE %`, `revenueSeries` and `profitSeries` with 80%/95% intervals, and `productDemandForecasts`).

### 3.10 `GET /api/analytics/insights`
Returns `BusinessInsightItem[]` with deterministic, explainable findings, supporting evidence, root causes, confidence levels, and recommended actions.
