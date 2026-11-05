# Final Performance & Reliability Test Results — Business Intelligence & Predictive Analytics

- **Application**: Dqnamo POS (`com.dqnamo.pos`)
- **Audit Date**: 2026-11-03
- **Test Environment**: Linux Container (`node` / `tsx`, Express + Vite middleware on Port `3000`, `.data/store-state.json` + `.data/products.json` + PostgreSQL fallback).
- **Verification Harness**: `src/analytics/acceptance-audit.test.ts` (Section 7) and live HTTP load probes against `http://localhost:3000/api/analytics/*`.

---

## 1. Recorded Empirical Performance Measurements

### A. Live REST API Endpoint Latencies (Default Store Dataset: 12 Products, 9 Transactions, 2 Branches)

| Endpoint | HTTP Method | Cache State | HTTP Status | Measured Response Time (ms) |
| :--- | :---: | :---: | :---: | :---: |
| `/api/analytics/overview?datePreset=30d&currency=SDG&userId=user-1` | `GET` | Cold Cache (Disk + Repo Load) | `200` | **464.88 ms** |
| `/api/analytics/sales?datePreset=30d&currency=SDG&userId=user-1` | `GET` | Warm Cache (`1500ms` TTL) | `200` | **16.05 ms** |
| `/api/analytics/financial?datePreset=30d&currency=SDG&userId=user-1` | `GET` | Warm Cache | `200` | **16.73 ms** |
| `/api/analytics/financial?datePreset=30d&currency=SDG&userId=user-3&userRole=admin` | `GET` | Warm Cache (RBAC 403 Reject) | `403` | **13.63 ms** |
| `/api/analytics/inventory?datePreset=30d&currency=SDG&userId=user-1` | `GET` | Warm Cache | `200` | **14.89 ms** |
| `/api/analytics/customers?datePreset=30d&currency=SDG&userId=user-4` | `GET` | Warm Cache | `200` | **15.49 ms** |
| `/api/analytics/forecasts?datePreset=30d&forecastHorizonDays=7&userId=user-1` | `GET` | Warm Cache | `200` | **18.10 ms** |
| `/api/analytics/forecasts?datePreset=30d&forecastHorizonDays=30&userId=user-1` | `GET` | Warm Cache | `200` | **18.27 ms** |
| `/api/analytics/forecasts?datePreset=30d&forecastHorizonDays=90&userId=user-1` | `GET` | Warm Cache | `200` | **28.34 ms** |
| **25 Concurrent Requests** (`Promise.all` × 25 `/api/analytics/overview`) | `GET` | Shared Snapshot Cache | `200` (all 25) | **451.26 ms total** (~**18.05 ms** avg/req) |

### B. High-Volume Stress Benchmark (`10,000` Transactions × `1,000` Products × `5` Branches)

Measured in `src/analytics/acceptance-audit.test.ts` (Section 7):
- **Dataset Size**: `10,000` completed transactions across `90` days, `1,000` distinct SKUs across `10` categories, `5` branches (`B1`–`B5`).
- **Snapshot Deduplication & Build Time (`buildAnalyticsSnapshotFromState`)**: **`10.14 ms`**
- **Full Analytics Suite Compute Time (`computeFullAnalyticsOverview`, 30d horizon)**: **`10,177.68 ms` (`10.18 s`)**
- **Heap Memory Delta (`process.memoryUsage().heapUsed`)**: **`+6.59 MB`**
- **Cold Dataset Load (`loadServerAnalyticsDataset`)**: **`963.30 ms`**
- **Warm Snapshot Cache Hit (`loadServerAnalyticsDataset` within `1500ms` TTL)**: **`0.13 ms`**

---

## 2. Performance & Reliability Test Matrix

| Test Case ID | Test Scenario | Classification | Expected Result | Actual Result | Evidence (File / Line / Benchmark) | Severity | Recommended Action |
| :--- | :--- | :---: | :--- | :--- | :--- | :---: | :--- |
| **PERF-01** | **High-Volume Dataset Compute (`10,000` Transactions × `1,000` SKUs × `5` Branches)** | **PARTIAL** | Sub-second (`< 1,000 ms`) synchronous execution so the Node.js event loop is not blocked under enterprise catalog + transaction volumes. | Snapshot deduplication took **`10.14 ms`**, but `computeFullAnalyticsOverview` took **`10,177.68 ms` (`10.18 s`)**. Root cause: `inventory.metrics.ts:178-197` and `forecasting.engine.ts:570-600` each iterate over all `completedTx` inside `products.map(...)` (`O(Products × Transactions)` = `10,000,000` iterations each), and `forecasting.engine.ts:611` runs 5-model rolling-origin backtesting for all `1,000` SKUs synchronously (`25,000` model fits). | `src/analytics/calculations/inventory.metrics.ts:178-197`, `src/analytics/forecasting/forecasting.engine.ts:570-621`, measured in `acceptance-audit.test.ts` (Section 7). | **Medium-High** | 1. Pre-index daily units sold per `productId` in a single `O(Transactions)` pass instead of nested `O(Products × Transactions)` loops.<br>2. Limit full 5-model rolling-origin backtesting at the SKU level to top Class A/B products (or top 50 SKUs by volume) and use a fast 7-day moving average for long-tail Class C SKUs. |
| **PERF-02** | **Snapshot Cache Hit vs. Miss & `mtime` Invalidation (`loadServerAnalyticsDataset`)** | **PASS** | Cache miss loads from disk/DB; subsequent calls within `1500ms` with unchanged `.data/store-state.json` and `.data/products.json` `mtimeMs` return in `< 1 ms`; `invalidateAnalyticsSnapshotCache()` forces reload. | Cold load = **`963.30 ms`**; warm cache hit = **`0.13 ms`** (7,400× speedup); file `mtimeMs` check invalidates immediately when `.data/store-state.json` or `.data/products.json` is updated. | `src/analytics/analytics.repository.ts:37-80`, measured in `acceptance-audit.test.ts`. | Low | None — verified working. |
| **PERF-03** | **Concurrent Analytics Requests (`25` Parallel `/api/analytics/overview` Requests)** | **PASS** | Zero failed requests, zero race conditions, deterministic output across all 25 responses. | All `25` concurrent requests returned HTTP `200` with identical payloads in **`451.26 ms` total** (`18.05 ms` average per request). | Live HTTP concurrency test against `http://localhost:3000/api/analytics/overview`. | Low | None — verified working. |
| **PERF-04** | **Memory Consumption & Garbage Collection Stability** | **PASS** | Heap delta for `10,000` transactions and `1,000` products remains bounded (`< 50 MB`) with no unbounded memory leak in module scope. | Heap delta for 10k transactions + 1k products was **`+6.59 MB`**; module cache stores only a single `cachedSnapshot` reference (`analytics.repository.ts:37`). | `src/analytics/acceptance-audit.test.ts` (`heapDeltaMb: 6.59`). | Low | None — verified bounded memory usage. |
| **PERF-05** | **Database Query Efficiency (`analytics.repository.ts`)** | **PARTIAL** | Queries should push date/branch filters down to PostgreSQL (`WHERE timestamp >= ...`) rather than loading entire historical tables into Node.js memory. | `analytics.repository.ts:159-166` executes un-filtered `db.select().from(schema.sales)`, `db.select().from(schema.saleItems)`, etc., loading all rows into memory before filtering by date window in JavaScript. Safe for small/medium stores (`< 5,000` sales), but will degrade as PostgreSQL table size grows over multiple years. | `src/analytics/analytics.repository.ts:149-167` | Medium | Push date range (`gte(schema.sales.timestamp, prevStartDate)`) and `branchId` predicates down to the Drizzle `SELECT` queries. |
| **PERF-06** | **Error Handling, Malformed Query Params & Empty Dataset Resilience** | **PASS** | Invalid query params (`datePreset=invalid`, `forecastHorizonDays=999`, `leadTimeDays=-50`, invalid dates) and empty datasets degrade gracefully without unhandled exceptions or `NaN`/`Infinity`. | Invalid params sanitize cleanly to safe defaults (`30d`, `7` days horizon, `leadTimeDays` clamped to `[1, 90]`); empty datasets return `0` totals and valid empty arrays. | `src/analytics/analytics.routes.ts:25-93`, `src/analytics/analytics.permissions.ts:111-126`, `src/analytics/analytics.test.ts:631-647`. | Low | None — verified resilient. |

---

## 3. Summary of Performance & Reliability Audit

- **Total Performance Scenarios Audited**: 6
- **PASS**: 4 / 6 (`PERF-02`, `PERF-03`, `PERF-04`, `PERF-06`)
- **PARTIAL**: 2 / 6 (`PERF-01` `10.18s` synchronous compute on 10k tx × 1k SKUs due to `O(P × T)` loops and per-SKU backtesting; `PERF-05` full-table `db.select()` without SQL `WHERE` pushdown)
