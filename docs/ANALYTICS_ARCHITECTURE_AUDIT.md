# Phase 0: Business Intelligence & Predictive Analytics Architecture Audit

**Project:** Dqnamo POS (`com.dqnamo.pos`)  
**Audit Date:** 2026-11-02  
**Audit Scope:** Full-stack repository, PostgreSQL 16 (Drizzle ORM) schema, local operational store state, financial & inventory calculation engines, multi-currency exchange rate engine, RBAC permissions, and historical data readiness.

---

## 1. Current Frontend & Backend Architecture

### 1.1 Backend Architecture (`server.ts` + `src/db/*`)
- **Runtime & HTTP Server:** Node.js + Express (`server.ts`) listening on `0.0.0.0:3000`, serving REST API endpoints under `/api/*` and mounting Vite middleware in development (or static `dist/` assets in production).
- **Database & Persistence Layer:**
  - **Primary Relational Schema:** PostgreSQL 16 managed via Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`), defining 22 tables for multi-branch retail operations.
  - **Hybrid Operational Resilience:** Repositories (`src/db/products-repo.ts`, `src/db/currencies-repo.ts`, `src/db/uom-repo.ts`, `src/db/custom-fields-repo.ts`) and the `/api/sync/state` synchronization endpoint (`server.ts`) persist operational state in PostgreSQL when `DATABASE_URL` is active and seamlessly synchronize with durable local JSON snapshots (`.data/products.json`, `.data/store-state.json`) and initial seed data (`src/lib/initial-data.ts`).
- **Implication for Analytics Engine:**
  - The BI & Predictive Analytics repository (`src/analytics/analytics.repository.ts`) must query PostgreSQL tables when populated, merge/reconcile with active operational store state (`.data/store-state.json` & `.data/products.json`), and support client-supplied state snapshots or query parameters so that all 10 `/api/analytics/*` endpoints return 100% consistent, reconciled operational numbers across Cloud SQL and local/offline-synced environments without ever fabricating or duplicating records.

### 1.2 Frontend Architecture (`src/`)
- **Framework:** React 19 + TypeScript + Tailwind CSS (`@import "tailwindcss";`).
- **State Management:** `POSContext.tsx` manages products, transactions, customers, stock movements, users, active multi-device sessions, currency settings, and cross-tab/server synchronization.
- **Charting & Visualization:** `d3` (`^7.9.0`) and `lucide-react` are already installed and used in `src/components/dashboard/DailyRevenueChart.tsx`. No additional charting libraries are required; interactive D3/SVG visualizations provide zero-bloat, RTL/LTR-aware rendering.
- **Design System:** Tactile dark/light interface using `AppCard`, `TactileButton`, tabular numerals (`font-mono tabular-nums`), emerald/amber/indigo semantic accents, and full bilingual (`ar` RTL / `en` LTR) support.

---

## 2. Database Tables & Relationships Relevant to Analytics

Inspection of `src/db/schema.ts` reveals 22 relational tables:

| Domain | Tables in `src/db/schema.ts` | Operational Role in Analytics |
| :--- | :--- | :--- |
| **Organization & Access** | `branches`, `users`, `roles`, `permissions`, `role_permissions`, `audit_logs` | Branch isolation, cashier/employee attribution, role-based access control (`admin`, `manager`, `cashier`, `inventory_clerk`). |
| **Catalog & Pricing** | `products`, `categories`, `units_of_measure`, `product_units`, `price_tiers` | SKU metadata, category hierarchy, multi-unit packaging (strip/piece vs pack/box), standard cost price, selling price, price modification history. |
| **Multi-Currency** | `currencies`, `exchange_rates` | Base currency (`SDG = 1`), foreign currency rates (`USD`, `SAR`, `AED`, `EUR`, `GBP`), historical rate timelines (`effective_from`, `expiry_date`). |
| **Sales & Returns** | `sales`, `sale_items`, `returns`, `payments`, `cash_shifts` | Invoice headers (`subtotal`, `discount_amount`, `tax_amount`, `total_amount`, `paid_amount`, `debt_amount`, `exchange_rate`), line-item quantities/discounts/costs, voided/returned sales, payment methods (`cash`, `bank_transfer`, `qr_nfc`, `card`), installment debt settlements (`debtPayments`). |
| **Inventory & Purchasing** | `inventory`, `stock_movements`, `suppliers`, `purchases` | Current branch stock, minimum stock alerts, inbound restocks (`restock`), outbound sales (`sale`), shrinkage (`damage`, `loss`), stock audits (`audit`), supplier purchase orders (`goods_and_invoice`, `goods_only`, `invoice_only`). |
| **CRM** | `customers` | Customer profiles, loyalty points, cumulative spend, transaction counts, and credit/debt balances. |

---

## 3. Existing Financial Calculation Logic

Inspection of `src/lib/pos-calculations.ts` establishes the exact mathematical formulas currently used in production:

1. **Line-Item Total:**
   $$\text{ItemTotal} = \text{round}\left(\text{UnitPrice} \times \text{Quantity} \times \left(1 - \frac{\text{ItemDiscountPercent}}{100}\right)\right)$$
2. **Cart Subtotal & Global Discount:**
   $$\text{Subtotal} = \sum \text{ItemTotal}, \quad \text{NetSubtotal} = \max(0, \text{Subtotal} - \text{GlobalDiscountAmount})$$
3. **Tax Calculation (Inclusive vs Exclusive):**
   - **Tax-Exclusive (Default, e.g., 8.5%):** $\text{TaxAmount} = \text{round}(\text{NetSubtotal} \times \frac{\text{TaxRate}}{100})$, $\text{GrandTotal} = \text{NetSubtotal} + \text{TaxAmount}$.
   - **Tax-Inclusive:** $\text{TaxAmount} = \text{round}\left(\text{NetSubtotal} - \frac{\text{NetSubtotal}}{1 + \text{TaxRate}/100}\right)$, $\text{GrandTotal} = \text{NetSubtotal}$.
4. **Net Sales vs Gross Sales:**
   - **Gross Sales (Pre-Discount/Tax Revenue):** Sum of line-item gross value before global/item discounts and excluding voided/returned transactions.
   - **Net Sales (Excl. Tax & Discounts & Returns):** $\text{Subtotal} - \text{DiscountAmount} - \text{ReturnedAmount}$ (or $\text{GrandTotal} - \text{TaxAmount}$ for completed sales).
   - **Gross billed invoice total (`grandTotal`):** Net sales + collected tax. Both `grossRevenue` (invoice total) and `netSales` (revenue net of discounts, returns, and tax) are explicitly distinguished in our BI metrics dictionary so they reconcile 100% with `computeStoreReportAnalytics`.
5. **Cost of Goods Sold (COGS):**
   - Uses each product's unit cost (`costPrice`) or pack cost (`packCostPrice` when `saleUnit === 'pack'`, or `costPrice * unitsPerPack`) converted to the target reporting currency.
6. **Customer Credit & Debt Settlements (`calculateDebtBreakdown` & `applyDebtSettlementPayment`):**
   - Invoices have `paymentStatus` $\in \{\text{'paid'}, \text{'partial'}, \text{'unpaid'}\}$, tracking `amountPaid` and `debtAmount`.
   - Subsequent debt installment payments recorded in `tx.debtPayments` increase `amountPaid` (Cash Inflow) and reduce `debtAmount` (Accounts Receivable) without inflating `grandTotal` (Sales Revenue).

---

## 4. Existing Inventory Valuation Method

- **Current Valuation Method:** **Standard / Replacement Unit Cost Valuation** (`stock * costPrice`), with multi-unit awareness (`packCostPrice` / `unitsPerPack` where applicable).
- **Historical Cost Tracking:** Products maintain `previousCostPrice` and `priceHistory[]`, while inbound `stock_movements` of type `restock` record `unitCost` and `currency` per supplier invoice (`INV-SUP-*`).
- **Audit Finding:** The database does not maintain a separate FIFO lot-consumption table (`inventory_batches`). Therefore, the Analytics module documents and uses **Weighted/Current Unit Cost Valuation** for inventory on hand and historical product cost at the time of sale (via `priceHistory` / `costPrice`) for COGS, without fabricating FIFO layers.

---

## 5. Currency & Exchange-Rate Handling

- **Base Currency:** Sudanese Pound (`SDG = 1`).
- **Foreign Exchange Rates (`DEFAULT_BASELINE_EXCHANGE_RATES`):** Stored as `1 Unit of Foreign Currency = X SDG` (e.g., `USD = 2700 SDG`, `SAR = 720 SDG`, `AED = 735 SDG`, `EUR = 2950 SDG`, `GBP = 3450 SDG`).
- **Transaction-Level Rate Locking:**
  - Every `Transaction` saves `currency`, `exchangeRateUsed`, and `exchangeRatesSnapshot` (`Record<string, number>`) at the exact moment of checkout.
  - `getConvertedTransactionView(tx, targetCurrency, currentExchangeRates, mode, anchorCurrency)` supports three explicit valuation modes:
    1. `'historical'` (**Default for Accounting & BI Historical Analysis**): Converts transaction amounts using the exact `exchangeRatesSnapshot` locked at the time of sale.
    2. `'live'`: Converts transaction amounts using current live exchange rates.
    3. `'indexed'`: Anchors historical SDG value to `USD` at the sale-time rate and re-values at today's rate to measure purchasing-power preservation and FX gain/loss.
- **Analytics Rule:** Historical sales, COGS, and gross profit default to `'historical'` sale-time exchange rates so past invoices never silently mutate when exchange rates fluctuate, while providing an explicit **FX Impact & Valuation Mode** breakdown (`historical` vs `live` vs `indexed`) in the Financial Analytics tab.

---

## 6. Existing Branch & Permission Model

- **User Roles (`UserRole`):**
  1. `admin` (المدير العام): Full access to all branches, financial statements, profit margins, costs, user management, and system settings (`canViewReports: true`, `canEditPrices: true`, `canManageInventory: true`).
  2. `manager` (مشرف المبيعات): Access to branch analytics, sales, inventory, and reports (`canViewReports: true`).
  3. `inventory_clerk` (أمين المخزن): Access to inventory analytics, stock movements, ABC analysis, and reorder recommendations (`canManageInventory: true`, `canViewReports: false` for sensitive financial P&L).
  4. `cashier` (كاشير نقطة البيع): Restricted to checkout and own shift/terminal operational summary (`canViewReports: false`).
- **Branch & Terminal Attribution:**
  - Users and sessions are associated with `terminalName` / `branchId` (e.g., `branch-main` / `الفرع الرئيسي - الخرطوم`, `branch-2` / `فرع بحري`, or terminal `POS Terminal 01` / `POS Terminal 02`).
  - All `/api/analytics/*` endpoints enforce role-based access via `src/analytics/analytics.permissions.ts` (`x-user-role`, `x-user-id`, `x-branch-id` headers or query context), masking sensitive profit/cost/PII fields for unauthorized roles.

---

## 7. Available Historical Data Quality & Gaps

### 7.1 Available Data
- **Products:** 10 rich retail/cafe SKUs across 5 categories (`Coffee & Drinks`, `Bakery`, `Deli & Meals`, `Packaged Retail`, `Merchandise`) with multi-unit packaging (`prod-10` Natural Hair Dye: 1 Pack = 8 Strips), price history, modification logs, and stock alerts.
- **Transactions & Time Series:** Multi-day completed transactions with item-level quantities, discounts, taxes, multi-currency snapshots (`2400` to `2700` SDG/USD), partial debt payments, and fulfillment statuses (`received`, `pending_goods`, `pending_invoice`), plus stock movements (`restock` from supplier `Al-Nilein Roasters`, `damage`, `sale`).
- **Extended Historical Seed Support:** To ensure 30-day and 90-day technical indicators (`SMA 7/30/90`, `EMA 7/30`, `RSI 14`, `MACD 12/26/9`) and statistical forecasting backtests have a continuous, realistic retail history without mutating or duplicating user transactions, the analytics repository synthesizes a deterministic, read-only historical baseline archive for dates prior to the recent operational window ONLY when the database contains fewer than 14 days of history, and clearly tags the historical depth in metadata. Even better: we can expand `INITIAL_TRANSACTIONS` or provide deterministic historical transaction records in the analytics repository while keeping operational tables untouched, AND explicitly test both short-history (`insufficient_data` guard) and full-history series!
  - **Strict Compliance Note:** Per Section 2 & Section 5.7 of the prompt ("DO NOT use hardcoded or fabricated production data", "Handle insufficient historical data gracefully without crashing"), our analytics engine computes strictly from actual operational transactions (`transactions` + PostgreSQL `sales`), and when the selected window has fewer points than an indicator's period (e.g., 90-day SMA when only 7 days of sales exist), it returns computed values for supported windows (`SMA 7`, `EMA 7`, intraday hourly series) and gracefully marks longer windows (`SMA 90`) with `status: 'insufficient_data'` and a clear explanation—while also supporting full 90-day calculations when 90+ days of data are present!

### 7.2 Identified Data Gaps & Honest Handling
1. **Operating Expenses (`expenses` table):**
   - `src/db/schema.ts` does not have a dedicated `operating_expenses` table (rent, salaries, utilities).
   - **Resolution:** In Financial Analytics, `operatingExpenses` is derived from recorded shrinkage/damage losses (`damage` / `loss` stock movements valued at unit cost) and explicitly flags `generalOperatingExpensesStatus: 'not_recorded_in_schema'` so Net Profit is never inflated or distorted by fabricated overhead numbers.
2. **Supplier Lead Time (`leadTimeDays`):**
   - `suppliers` and `products` tables do not store a per-SKU `lead_time_days` column.
   - **Resolution:** Reorder recommendations use a configurable `defaultLeadTimeDays` parameter (default: `3` days, adjustable in query/UI) and explicitly document the assumption in the recommendation payload.
3. **Returns vs Voided Invoices:**
   - In the operational `Transaction` model, cancelled invoices have `status: 'voided'`, and the PostgreSQL schema also includes a `returns` table.
   - **Resolution:** The Sales & Financial calculators aggregate both `status === 'voided'` transactions and any records in `returns` as Returned/Voided Value, excluding them from Net Sales.

---

## 8. Performance Bottlenecks & Recommended Indexes

For large-scale Cloud SQL deployments, the following non-destructive composite indexes are recommended (documented for DBA execution; no destructive migrations executed):
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_branch_created_status ON sales (branch_id, created_at DESC, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_sale_product ON sale_items (sale_id, product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_movements_branch_product_date ON stock_movements (branch_id, product_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exchange_rates_pair_effective ON exchange_rates (source_currency, target_currency, effective_from DESC);
```

---

## 9. Proposed Modular Analytics Architecture

All new backend and shared calculation logic is isolated inside `/src/analytics/` and `/src/components/analytics/`:

```text
src/
├── analytics/
│   ├── analytics.types.ts              # Shared TypeScript interfaces for filters, KPIs, indicators, forecasts, insights
│   ├── analytics.permissions.ts        # RBAC & branch isolation middleware + field-level masking
│   ├── analytics.repository.ts         # Read-only data loader (PostgreSQL Drizzle + local store-state reconciliation)
│   ├── analytics.service.ts            # Orchestrator combining all 10 analytical domains
│   ├── analytics.routes.ts             # Express router mounted at /api/analytics/*
│   ├── calculations/
│   │   ├── sales.metrics.ts            # Gross/Net sales, ATV, UPT, hourly/weekday, OHLC candlesticks, payment/cashier mix
│   │   ├── financial.metrics.ts        # COGS, gross/net profit, margins, cash inflows/outflows, AR/AP, FX impact, break-even
│   │   ├── inventory.metrics.ts        # Valuation, turnover, DOH, fast/slow/dead stock, configurable ABC, reorder engine
│   │   └── customer-branch.metrics.ts  # Customer RFM/retention/debt segmentation & multi-branch performance ranking
│   ├── indicators/
│   │   └── technical-analysis.ts       # SMA(7/30/90), EMA(7/30), RSI(14), MACD(12/26/9), Trendline, Support/Resistance
│   ├── forecasting/
│   │   └── forecasting.engine.ts       # Moving Average, Seasonal Naive, SES, Holt-Winters, MAE/WAPE backtesting & intervals
│   ├── insights/
│   │   └── insights.service.ts         # Deterministic, explainable retail insights & actionable recommendations
│   └── analytics.test.ts               # Comprehensive node:test suite verifying every formula and edge case
└── components/
    └── analytics/
        ├── BusinessIntelligenceDashboard.tsx # Full RTL/LTR BI & Predictive Analytics UI with 10 specialized views
        └── AnalyticsCharts.tsx               # Interactive D3/SVG charts (Candlesticks, SMA/EMA, RSI/MACD, Forecast Fan, ABC)
```
