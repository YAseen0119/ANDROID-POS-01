# Final Database Integrity & Protection Report

**Application:** Dqnamo POS — Business Intelligence & Predictive Analytics Module  
**Audit Date:** 2026-11-03  
**Database Engine:** Google Cloud SQL / PostgreSQL 16 + Drizzle ORM (`src/db/schema.ts`) & Local Fallback Store (`.data/products.json`, `.data/store-state.json`)  
**Audit Verdict:** **PASS — 100% READ-ONLY & ZERO DATA MUTATION VERIFIED**

---

## 1. Schema & Operational File Cryptographic Verification

Before and after executing the full certification test suite and 15-iteration performance benchmark, SHA-256 cryptographic digests, byte sizes, and file modification timestamps (`mtime`) were captured for the database schema definition and local operational data stores:

| File Path | Pre-Certification SHA-256 | Post-Certification SHA-256 | Size (Bytes) | `mtime` (UTC) | Status |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `src/db/schema.ts` | `33138e91cdedf677043b720637c631005334ba708673b241a5c4c92623b5a006` | `33138e91cdedf677043b720637c631005334ba708673b241a5c4c92623b5a006` | `21,220` | `2026-11-03T08:10:45.609Z` | **UNCHANGED** |
| `.data/products.json` | `4506722aa877109a9dee8672325d8445a53293400a7dab9c2793388a4dbbae08` | `4506722aa877109a9dee8672325d8445a53293400a7dab9c2793388a4dbbae08` | `14,335` | `2026-11-03T08:10:45.632Z` | **UNCHANGED** |
| `.data/store-state.json` | `MISSING` (Not created/mutated) | `MISSING` (Not created/mutated) | `0` | `null` | **UNCHANGED** |

### Live PostgreSQL Operational Record Count Verification

| Operational Entity / Table | Pre-Certification Count | Post-Certification Count | Delta |
| :--- | :---: | :---: | :---: |
| `products` (PostgreSQL + fallback deduplicated) | `113` | `113` | `0` |
| `sales` (`transactions`) | `9` | `9` | `0` |
| `stock_movements` | `2` | `2` | `0` |
| `customers` | `3` | `3` | `0` |
| `returns` | `0` | `0` | `0` |
| `purchases` (`purchaseOrders`) | `0` | `0` | `0` |
| `expenses` | `0` | `0` | `0` |
| `suppliers` | `0` | `0` | `0` |

---

## 2. Static & Runtime Audit of Analytics Database Operations

A complete inspection of all files in `src/analytics/**` (`analytics.repository.ts`, `analytics.service.ts`, `analytics.routes.ts`, `analytics.permissions.ts`, `analytics.types.ts`, `calculations/*.ts`, `forecasting/*.ts`, `indicators/*.ts`, `insights/*.ts`) confirmed that **only `src/analytics/analytics.repository.ts` interacts with the database or filesystem**, and every operation is strictly **read-only (`SELECT` / `fs.readFileSync`)**.

### 2.1 Complete Inventory of SQL Queries in `src/analytics/analytics.repository.ts`

All database queries in `loadServerAnalyticsDataset()` (`src/analytics/analytics.repository.ts`, lines 128–211) are strictly `SELECT` queries:

| # | Target Table / Repository | Query Operation | SQL Predicate Pushdown (`PERF-05`) | Write Capability |
| :---: | :--- | :--- | :--- | :---: |
| 1 | `products` (`getAllProducts()`) | `db.select().from(products)` | Active products lookup | **None (`SELECT` only)** |
| 2 | `exchange_rates` (`getLatestRates()`) | `db.select().from(exchangeRates)` | Latest effective exchange rates | **None (`SELECT` only)** |
| 3 | `sales` | `db.select().from(schema.sales)` | `WHERE timestamp >= effectiveSinceDate [AND status = statusFilter] ORDER BY timestamp DESC` | **None (`SELECT` only)** |
| 4 | `sale_items` | `db.select().from(schema.saleItems)` | Joined in memory via `saleId` map | **None (`SELECT` only)** |
| 5 | `returns` | `db.select().from(schema.returns)` | `WHERE created_at >= effectiveSinceDate` | **None (`SELECT` only)** |
| 6 | `return_items` | `db.select().from(schema.returnItems)` | Joined in memory via `returnId` map | **None (`SELECT` only)** |
| 7 | `purchases` | `db.select().from(schema.purchases)` | `WHERE invoice_date >= effectiveSinceDate` | **None (`SELECT` only)** |
| 8 | `purchase_items` | `db.select().from(schema.purchaseItems)` | Joined in memory via `purchaseId` map | **None (`SELECT` only)** |
| 9 | `stock_movements` | `db.select().from(schema.stockMovements)` | `WHERE timestamp >= effectiveSinceDate ORDER BY timestamp DESC` | **None (`SELECT` only)** |
| 10 | `customers` | `db.select().from(schema.customers)` | Full customer directory lookup | **None (`SELECT` only)** |
| 11 | `users` | `db.select().from(schema.users)` | Server-side RBAC identity & branch lookup (`SEC-01`/`SEC-02`) | **None (`SELECT` only)** |

### 2.2 Forbidden Operation Scan Across `src/analytics/**`

| Forbidden Pattern / Call | Occurrences in `src/analytics/**` | Verification Status |
| :--- | :---: | :---: |
| `db.insert(...)` / `INSERT INTO` | `0` | **PASS** |
| `db.update(...)` / `UPDATE ` | `0` | **PASS** |
| `db.delete(...)` / `DELETE FROM` | `0` | **PASS** |
| `DROP ` / `ALTER ` / `TRUNCATE ` | `0` | **PASS** |
| `db.execute(...)` (raw SQL execution) | `0` | **PASS** |
| `fs.writeFileSync` / `fs.writeFile` / `fs.appendFile` / `fs.unlink` | `0` | **PASS** |

---

## 3. Branch Scoping & User RBAC Enforcement Verification

1. **Server-Authoritative User Resolution (`src/analytics/analytics.permissions.ts`):**
   - `resolveAnalyticsUserContext()` looks up the requesting `userId` in `snapshot.users` (populated from PostgreSQL `users` table and server state).
   - If `userId` is missing or not found in `snapshot.users`, `roleVerifiedFromServerStore` is set to `false` and the route guard `enforceAuthenticatedAnalyticsUser()` immediately returns HTTP `401 Unauthorized`.
2. **Branch Isolation Enforcement (`src/analytics/analytics.permissions.ts` L138–L165):**
   - When an authenticated user has `canViewAllBranches === false` (e.g., `cashier`, `inventory_clerk`, or branch-restricted `manager`) and is assigned to a specific `assignedBranchId`, `enforceFilterScopeForUser()` forcibly overrides `filter.branchId = userContext.assignedBranchId` and `filter.cashierName = userContext.userName` (for cashiers), preventing cross-branch data leakage regardless of client query parameters.
3. **Role-Based Financial Redaction (`src/analytics/analytics.permissions.ts` L170–L235):**
   - Non-admin roles (`canViewFinancials === false` or `canViewCostAndMargin === false`) have sensitive P&L and cost fields (`cogs`, `grossProfit`, `grossMarginPct`, `operatingProfit`, `netMarginPct`, `inventoryCostValue`, `potentialGrossProfit`, and cost/profit insights) redacted to `null` before the response leaves the server, and direct calls to `/api/analytics/financial` or `/api/analytics/forecasts` are blocked with HTTP `403 Forbidden`.
