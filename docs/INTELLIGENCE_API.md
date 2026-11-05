# Smart Store Operations & Unmet Demand Intelligence API Reference (Phase 10)

## 1. Authentication, Authorization & Branch Scoping

All intelligence and unmet demand endpoints are mounted under `/api` via `createAnalyticsRouter` (`src/analytics/analytics.routes.ts`) and enforce strict server-side authentication and role-based access control (`src/analytics/analytics.permissions.ts`):

- **Server-Verified Identity:** Requires `x-user-id` header matching an active user in the authoritative server dataset (`serverDataset.users`).
- **Missing or Unknown Identity:** Returns `401 Unauthorized` (`AUTHENTICATION_REQUIRED` or `UNKNOWN_USER_IDENTITY`). Client-supplied role headers (`x-user-role`) are ignored.
- **Branch Isolation:** Non-global users (`branch_manager`, `cashier`, `inventory`, `accountant` with assigned `branchId`) are strictly restricted to their assigned branch. Cross-branch queries return `403 Forbidden` (`BRANCH_ACCESS_DENIED`).
- **Role-Based Redaction:**
  - `cashier`: Can record unmet demand (`POST /api/unmet-demand/requests`) for their assigned branch; cannot access `/api/analytics/*` or `/api/intelligence/*` (`403 Forbidden`).
  - `inventory`: Full access to inventory risks, unmet demand quantities, predictive unit forecasts, replenishment quantities, and branch transfer quantities. All unit costs (`estimatedOrderCost`, `unitCost`), profit margins (`estimatedLostGrossProfit`), financial risks (`financialRisks = []`), and customer PII (`customerReference`) are redacted (`null`).

---

## 2. Unmet Demand Capture Endpoint

### `POST /api/unmet-demand/requests`
Records a customer product inquiry or unavailable item request in PostgreSQL (`unmet_demand_requests`) and updates the synchronized analytics state without modifying sales, inventory, or accounting tables.

#### Request Headers
- `x-user-id`: Active user ID (e.g., `user-1`, `user-2`).
- `Content-Type`: `application/json`.

#### Request Body Schema
```json
{
  "productId": "prod-5",
  "productNameSnapshot": "Panadol Extra",
  "productNameArSnapshot": "بنادول إكسترا",
  "skuSnapshot": "MED-005",
  "barcode": "6281000005",
  "categorySnapshot": "Analgesics",
  "branchId": "branch-1",
  "requestedQuantity": 2,
  "saleUnitMode": "base",
  "packConversionFactor": 1,
  "availabilityStatus": "out_of_stock",
  "unavailabilityReason": "OUT_OF_STOCK",
  "confirmedPurchaseIntent": true,
  "fulfillmentStatus": "unfulfilled",
  "sourceScreen": "checkout",
  "customerId": "cust-1",
  "customerReference": "Walk-in customer",
  "notes": "Requested 2 boxes urgently"
}
```

#### Validation & Anti-Duplicate Rules (`src/analytics/unmet-demand.validation.ts`)
- `requestedQuantity` must be $> 0$ and $\le 10,000$.
- Either `productId`, `productNameSnapshot` ($\ge 2$ chars), or `barcode` ($\ge 3$ chars) must be provided.
- `unavailabilityReason` must be one of: `OUT_OF_STOCK`, `EXPIRED`, `NOT_STOCKED`, `TEMPORARILY_UNAVAILABLE`, `OTHER`.
- `recordedByUserId` is always injected from the authenticated server session (`access.userId`), ignoring any client payload override.
- **Accidental Double-Tap Protection:** Rejects identical requests (`branchId` + `productId`/`productNameSnapshot` + `recordedByUserId` + `requestedBaseUnits` + `unavailabilityReason`) submitted within `60` seconds with `409 Conflict` (`DUPLICATE_SUBMISSION`).

---

## 3. Smart Store Operations Intelligence Endpoints

All `GET` endpoints accept standard query filters:
- `startDate` (`YYYY-MM-DD`)
- `endDate` (`YYYY-MM-DD`)
- `branchId` (`all` or specific branch ID)
- `category` (`all` or specific category)
- `currency` (`USD`, `SAR`, `EUR`, etc.)
- `horizonDays` (`7`, `30`, or `90`)

### `GET /api/intelligence/overview`
Returns the executive intelligence summary (`intelligence.overview`) and top-level unmet demand summary (`unmetDemandSummary`), including active alert counts across all 10 categories, replenishment count/cost, and branch transfer count/units.

### `GET /api/intelligence/alerts`
Optional query filter: `insightCategory` (`INVENTORY_RISK`, `UNMET_DEMAND`, `RISING_DEMAND`, `STOCKOUT_RISK`, `REPLENISHMENT`, `FINANCIAL_RISK`, `SALES_ANOMALY`, `BRANCH_IMBALANCE`, `SEASONAL_PATTERN`, `TRANSFER_OPPORTUNITY`).
Returns deduplicated `SmartIntelligenceAlertItem[]` with bilingual explanations, evidence metrics, confidence levels, and lifecycle status.

### `GET /api/intelligence/recommendations`
Returns:
- `replenishmentRecommendations`: Explainable purchase order suggestions (`SmartReplenishmentRecommendationItem[]`) with `approvalStatus: "requires_user_approval"`.
- `branchTransferOpportunities`: Surplus-to-shortage inter-branch transfer recommendations (`BranchTransferRecommendationItem[]`) with `approvalStatus: "requires_user_approval"`.

### `GET /api/intelligence/inventory-risks`
Returns `inventoryRisks` (`INVENTORY_RISK` and `STOCKOUT_RISK` alerts) covering near-expiry batches, dead stock, and imminent lead-time stockouts.

### `GET /api/intelligence/financial-risks`
Returns `financialRisks` (`FINANCIAL_RISK` and `SALES_ANOMALY` alerts). Automatically returns an empty list with `redactedForRole: true` if the user lacks `canViewCostsAndMargins`.

### `GET /api/intelligence/branch-insights`
Returns `branchInsights` (`BRANCH_IMBALANCE` and `TRANSFER_OPPORTUNITY` alerts) alongside `branchTransferOpportunities` and `unmetDemandByBranch`.

---

## 4. Customer Demand Intelligence (Unmet Demand) Endpoints

### `GET /api/intelligence/unmet-demand/overview`
Returns:
- `summary`: `totalInquiries`, `totalRequestedBaseUnits`, `confirmedIntentInquiries`, `confirmedIntentBaseUnits`, `distinctProductsRequested`, `registeredProductInquiries`, `unregisteredProductInquiries`, `repeatedStockoutProductsCount`, `actualUnitsSoldInPeriod`, `observedTotalDemandUnits`, `demandCaptureEfficiencyPercent`.
- `lostSalesEstimation`: Conservative lost revenue and gross profit estimation with `status` (`ESTIMATED` or `INSUFFICIENT_DATA`), `confidenceLevel`, `assumptionsEn`/`assumptionsAr`, and `limitationsEn`/`limitationsAr`.
- `byReason` and `byCategory`.

### `GET /api/intelligence/unmet-demand/products`
Returns:
- `topRequestedProducts`: Ranked catalog and unregistered items with inquiry count, requested units, actual units sold, demand capture ratio, repeated stockout flag, and conservative lost sales estimate.
- `recentRequests`: Role-scoped recent inquiries (with `customerReference` redacted for non-customer-PII roles).

### `GET /api/intelligence/unmet-demand/trends`
Returns `dailyTrends`, `weeklyTrends`, and `monthlyTrends` comparing `inquiryCount`, `requestedBaseUnits`, `confirmedIntentUnits`, and `actualUnitsSold`.

### `GET /api/intelligence/unmet-demand/branches`
Returns `byBranch` unmet demand breakdown and `branchTransferOpportunities`.

### `GET /api/intelligence/unmet-demand/forecast`
Returns:
- `predictiveDemandComparison`: Rolling-origin backtesting comparison between baseline sales-only forecasting and stockout-compensated latent-demand forecasting (`WAPE`, `MAE`, `Bias`).
- `productDemandForecasts`: 7/30/90-day product forecasts containing both `forecastedTotalUnits` (sales-only) and `forecastedLatentTotalUnits` (sales + stockout-censoring compensation + weighted unmet demand).
