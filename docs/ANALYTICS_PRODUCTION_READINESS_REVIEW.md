# Analytics Production Readiness Review — Dqnamo POS

## 1. Executive Summary

An independent, line-by-line forensic code audit was conducted across the Business Intelligence & Predictive Analytics module (`/src/analytics/*`, `/src/components/analytics/*`, `/server.ts`, `/src/db/schema.ts`, and `/src/db/products-repo.ts`).

All verified mathematical, accounting, inventory valuation, statistical forecasting, data-consistency, and RBAC security issues have been corrected in code and verified against independent test fixtures without modifying or resetting the PostgreSQL database schema.

---

## 2. Phase-by-Phase Audit Matrix & Source-of-Truth Ownership

### 2.1 Authoritative Source-of-Truth Matrix (Phase 1)

| Domain | Primary Store | Secondary / Fallback Store | Ownership & Precedence Rule | Deduplication & Reconciliation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Sales & Sale Items** | PostgreSQL (`sales`, `sale_items`) + `.data/store-state.json` | Initial seed ledger (`INITIAL_TRANSACTIONS`) | Union of PostgreSQL rows and unsynced local state transactions; PostgreSQL / `syncStatus: 'synced'` takes precedence on conflict | Deterministic deduplication by canonical `id` AND `idempotencyKey` (`deduplicateTransactions`) |
| **Returns & Return Items** | PostgreSQL (`returns`, `return_items`) | `.data/store-state.json` (`returns`) | PostgreSQL `returns` + `return_items` joined by `return_id`; reconciled against `sale_id` | Deduplicated by `return.id`; cumulative refunds per invoice capped at original invoice total (`resolveReturnsForTransaction`) |
| **Products & Historical Costs** | PostgreSQL (`products`) | `.data/products.json` / `.data/store-state.json` | PostgreSQL `products` merged with local `priceHistory[]`, `unitsPerPack`, and `costPrice` metadata | Deduplicated by `product.id` and normalized `sku` (`deduplicateProducts`) |
| **Inventory & Stock Movements** | PostgreSQL (`inventory`, `stock_movements`) | `.data/store-state.json` (`stockMovements`) | Live `Product.stock` combined with chronological `stock_movements` deltas (`restock`, `sale`, `damage`, `loss`, `audit`) | Deduplicated by movement `id` or composite key `(productId, type, timestamp, quantityChange)` (`deduplicateStockMovements`) |
| **Customers & Receivables** | PostgreSQL (`customers`, `payments`) | `.data/store-state.json` (`customers`, `debtPayments`) | PostgreSQL `customers` merged with invoice `debtAmount` and `debtPayments[]` | Deduplicated by `customer.id` and normalized phone number (`deduplicateCustomers`) |
| **Purchases & Supplier Payables** | PostgreSQL (`purchases`, `purchase_items`, `suppliers`) | `stock_movements` (`type = 'restock'`, `receiptMode`) | PostgreSQL purchase orders (`ordered`, `received`, `paid`, `unpaid`) + restock movements | Deduplicated by `purchase.id`; distinguishes commitments vs paid cash outflows vs `goods_only` accounts payable |
| **Exchange Rates** | PostgreSQL (`exchange_rates`) | `.data/store-state.json` (`settings.exchangeRates`, `exchangeRateHistory`) | Historical invoices use frozen `tx.exchangeRatesSnapshot`; live mode uses `getEffectiveExchangeRates()` | Validated finite positive rates with `SDG: 1` base anchor |

---

## 3. Classification of Audit Findings

### 3.1 Verified and Corrected in Code
1. **Multi-Source Deduplication (`analytics.snapshot.ts`, `analytics.repository.ts`)**: Added deterministic deduplication across `products`, `transactions` (by `id` and `idempotencyKey`), `returns`, `stockMovements`, and `customers`, plus a `1500ms` mtime-validated snapshot cache.
2. **4-Tier Historical COGS Resolution (`sales.metrics.ts`, `financial.metrics.ts`)**: Eliminated the silent `item.total * 0.45` fallback and stopped presenting today's catalog cost as audited historical COGS. Implemented a 4-tier hierarchy:
   - Tier 1: `exact_frozen_at_sale` (`item.unitCostAtSale`)
   - Tier 2: `reconstructed_from_price_history` (`Product.priceHistory[]` timeline lookup at `tx.timestamp`)
   - Tier 3: `estimated_from_current_catalog_cost` (explicitly flagged as `isGrossProfitEstimated: true`)
   - Tier 4: `incomplete_missing_cost` (`0` cost with `unresolvableCostRevenuePortion` tracked)
3. **Voided Invoices vs Merchandise Returns & Tax-Inclusive/Exclusive Handling (`sales.metrics.ts`)**: Separated voided invoices (`status === 'voided'`, excluded from sales) from merchandise returns (`returns` / `return_items`, deducted from Net Sales, Tax Collected, and COGS). Added automatic detection of tax-inclusive vs tax-exclusive invoices (`isTransactionTaxInclusive`).
4. **Operating Profit & Break-Even Integrity (`financial.metrics.ts`)**: Renamed `grossProfit - recordedShrinkage` to `profitAfterRecordedShrinkage`. Set `netOperatingProfit: null` (`unavailable_missing_operating_expenses`) and `breakEvenSalesRevenue: null` (`unavailable_missing_fixed_costs`) unless fixed operating expenses are explicitly provided via `fixedOperatingExpensesOverride`.
5. **Reconstructed Cost-Based Inventory Turnover & Pending Inbound Stock (`inventory.metrics.ts`)**: Reconstructed beginning inventory per SKU from period movements to compute `averageInventoryValueAtCost` and `costBasedStockTurnoverRatio = COGS / AverageInventoryValueAtCost`, separately from `estimatedUnitSellThroughRatio`. Subtracted `pendingInboundPurchaseUnits` (`ordered` purchases and `invoice_only` restocks) from reorder recommendations.
6. **Multi-Origin Rolling Backtesting & Uncertainty Range Labeling (`forecasting.engine.ts`)**: Added `naive_last_value` baseline, multi-origin rolling backtesting across 7/30/90-day horizons, signed `forecastBias` & `biasPercent`, empirical 80%/95% coverage evaluation, horizon sufficiency guards, and `Estimated Uncertainty Ranges (80% / 95%)` labeling when active history is short.
7. **Server-Side RBAC Anti-Spoofing & `null` Masking (`analytics.permissions.ts`, `analytics.routes.ts`)**: Verified user role and branch against server-side `dataset.users`, blocked `/api/analytics/financial` with HTTP `403 Forbidden` for unauthorized roles, and masked restricted financial/cost metrics as `null` instead of `0`.

### 3.2 Requires Database Schema Change & Business-Owner Approval (Not Executed per Protection Rules)
1. **Frozen Cost Column on `sale_items`**: Adding `unit_cost_at_sale NUMERIC(12, 2)` and `cost_currency TEXT` to the PostgreSQL `sale_items` table so future checkout transactions freeze unit cost directly on the SQL row without relying on `Product.priceHistory[]`.
2. **Dedicated `operating_expenses` Table**: Adding an `operating_expenses` table in PostgreSQL to record rent, payroll, and utilities so `netOperatingProfit` and `breakEvenSalesRevenue` can be computed from persisted general ledger rows without requiring `fixedOperatingExpensesOverride`.
