# Phase 10 — Unified Store Operations & Customer Demand Intelligence Architecture

**Application:** Dqnamo POS (`src/analytics/**`)  
**Phase Status:** Phase A (Repository Audit) & Phase B (Data Model & Capture Design)  
**Database Protection Status:** Strictly Read-Only Analytics; Zero Unapproved Schema Executions

---

## 1. Architectural Vision & Core Principles

Phase 10 transforms Dqnamo POS from a historical transaction reporting system into a **Unified Retail Intelligence System** that combines:
1. **Smart Store Operations & Business Insights** (Inventory, Financial, Sales, and Branch Intelligence).
2. **Customer Demand Intelligence (Unmet Demand Analytics)** — capturing and analyzing what customers request when products are out of stock, expired, temporarily unavailable, or not yet carried in the catalog.
3. **Stockout-Aware Predictive Demand & Inventory Forecasting** — distinguishing observed sales, observed unmet demand, estimated latent demand, and forecasted future demand without double-counting.
4. **Smart Replenishment & Inter-Branch Transfer Recommendations** — generating explainable, human-approved purchase order and stock transfer recommendations.

### Non-Negotiable Architectural Guardrails
- **Single Unified Engine:** Extends the existing `src/analytics/` pipeline (`analytics.repository.ts`, `analytics.service.ts`, `analytics.permissions.ts`, `forecasting.engine.ts`, `insights.service.ts`). Does **not** introduce a competing analytics or forecasting engine.
- **Strict Operational Safety (Read-Only Recommendations):** The intelligence engine never automatically creates purchase orders, transfers stock, changes selling prices, mutates inventory balances, records sales, or alters accounting entries. Every recommendation carries `approvalStatus: 'requires_user_approval'`.
- **Server-Authoritative RBAC (`SEC-01` & `SEC-02`):** User identity (`userId`), role (`admin`, `manager`, `cashier`, `inventory_clerk`), and branch assignment (`branchId`) are verified exclusively against the server-side user directory (`snapshot.users`). Client-supplied role or branch headers are ignored.
- **Multi-Currency & Historical Valuation Fidelity:** Preserves `SDG` as base currency, supports live/historical/USD-indexed valuation modes, and locks historical transactions to their sale-time exchange rate snapshots.

---

## 2. Eight-Layer Separation of Concerns

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Data Collection (PostgreSQL + .data/store-state.json)             │
│  - Existing: sales, sale_items, returns, return_items, products,           │
│    stock_movements, purchases, purchase_items, branch_transfers,           │
│    customers, suppliers, currencies, exchange_rates, users                 │
│  - New (Additive): unmet_demand_requests                                   │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Data Validation, Normalization & Deduplication                    │
│  - src/analytics/unmet-demand.validation.ts                                │
│  - Validates registered vs. unregistered requests, unavailability reasons, │
│    server-side user/branch binding, 60s duplicate submission guard,        │
│    and PII redaction for aggregate analytics.                              │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Domain Analytics Calculations (src/analytics/calculations/*)      │
│  - sales.metrics.ts (Gross/Net sales, line-level returns INV-10/FIN-09)    │
│  - financial.metrics.ts (P&L, COGS quality, partial PO FIN-14, FX delta)   │
│  - inventory.metrics.ts (Stock conservation, ABC, DOH, turnover, aging)    │
│  - customer-branch.metrics.ts (Branch performance, customer segmentation)  │
│  - unmet-demand.metrics.ts (Inquiries vs. quantities, stockout overlap,    │
│    reason breakdown, category/branch/trend series, lost-sales estimation)  │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Predictive Demand Engine (src/analytics/forecasting/*)            │
│  - Extends forecasting.engine.ts (Naive, MA-7, Weekly Seasonal, SES,       │
│    Damped Holt-Winters) with stockout-period censoring compensation and    │
│    conservative conversion-weighted latent demand signals.                 │
│  - Rolling-origin backtesting (MAE, WAPE %, Bias %, Coverage) comparing    │
│    baseline sales-only model vs. unmet-demand-enhanced model.              │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 5: Rules & Anomaly Detection (src/analytics/insights/*)              │
│  - Inventory anomalies (repeated stockouts, dead stock, excess stock)      │
│  - Financial anomalies (margin erosion, cost spikes, overdue AR/AP, FX)    │
│  - Sales anomalies (demand surges, return spikes, demand vs. sales gap)    │
│  - Branch anomalies (performance drops, cross-branch stock imbalance)      │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 6: Smart Replenishment & Unified Recommendations                     │
│  - Replenishment quantities & timing (forecast + safety stock - current    │
│    stock - pending inbound POs, adjusted for shelf-life & unmet demand)    │
│  - Inter-branch transfer recommendations (excess branch → shortage branch) │
│  - 10-category Unified Insights with Confidence & Severity classifications │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 7: API Presentation (src/analytics/analytics.routes.ts)              │
│  - Preserves /api/analytics/* endpoints                                    │
│  - Adds /api/intelligence/* (GET) and /api/unmet-demand/requests (POST)    │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer 8: Frontend Visualization (RTL Arabic & LTR English)                 │
│  - Fast Cashier & Product Search Request Capture Modal                     │
│  - Unified Smart Intelligence Dashboard (9 specialized operational views)  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Existing Reusable Modules vs. New Phase 10 Modules

| Module Path | Status | Responsibility |
| :--- | :---: | :--- |
| `src/analytics/analytics.permissions.ts` | **Existing (Reused)** | Server-side user verification, role permissions, branch scoping, financial/PII redaction. |
| `src/analytics/analytics.repository.ts` | **Existing (Extended)** | Loads authoritative snapshot from PostgreSQL + `.data/store-state.json` with 15s TTL cache and SQL date predicate pushdown. |
| `src/analytics/unmet-demand.validation.ts` | **New (Phase B)** | Pure validation, normalization, server user/branch binding, and duplicate-submission detection for customer demand requests. |
| `src/analytics/calculations/unmet-demand.metrics.ts` | **Planned (Phase D)** | Computes inquiry frequency, requested quantities, branch/category/season/stockout trends, and statistical lost-sales estimates. |
| `src/analytics/calculations/replenishment.metrics.ts` | **Planned (Phase G)** | Computes explainable reorder recommendations and inter-branch stock transfer opportunities. |
| `src/analytics/forecasting/forecasting.engine.ts` | **Existing (Extended in Phase F)** | Adds latent demand & stockout-censoring adjustments and baseline-vs-enhanced rolling-origin backtest comparison. |
| `src/analytics/insights/insights.service.ts` | **Existing (Extended in Phase E)** | Expands explainable insights to cover all 10 intelligence categories, 5 confidence levels, 5 severities, and alert deduplication. |
