# Product Demand Forecasting Retest Report (`FC-08` & `FC-09`)

**Date:** 2026-11-03  
**Target Files:** `src/analytics/forecasting/forecasting.engine.ts`, `src/analytics/calculations/inventory.metrics.ts`  
**Status:** **PASS — 100% REMEDIATED**

---

## 1. Defect `FC-08` — Scope Filtering & Return Deduction in `productDemandForecasts`

### 1.1 Root Cause
In `src/analytics/forecasting/forecasting.engine.ts`, `productDemandForecasts` previously iterated over `dataset.transactions.filter((t) => t.status === 'completed')` without applying `filterTransactionsByScope(...)` and without deducting returned merchandise quantities (`resolveReturnsForTransaction`). As a result:
- Branch, cashier, customer, and payment-method filters were ignored in SKU-level demand forecasts.
- Returned merchandise inflated historical daily demand and projected SKU reorder quantities.

### 1.2 Remediation Implemented
1. Applied `filterTransactionsByScope(dataset.transactions, productsMap, dataset.branches, filters)` and filtered `tx.status === 'completed'` before building `productDailyNetUnits`.
2. For each transaction in the active window, resolved returns via `resolveReturnsForTransaction(tx, dataset.returns || [])`, converted pack vs. unit quantities consistently (`unitsPerPack`), and deducted returned base units from gross base units sold (`netUnits = Math.max(0, grossUnits - deductedRet)`).

---

## 2. Defect `FC-09` — Pending Inbound Units & Reorder Quantity Adjustment

### 2.1 Root Cause
In `src/analytics/forecasting/forecasting.engine.ts`, `pendingInboundUnits` was hardcoded to `0` on every `ProductDemandForecastItem`, and `recommendedReorderUnits` was computed as `Math.max(0, Math.ceil(forecastedTotalUnits + safetyBuffer - currentStock))` without subtracting `pendingInboundUnits`.

### 2.2 Remediation Implemented
1. Extracted shared helper `computePendingInboundByProduct(dataset, filters)` in `src/analytics/calculations/inventory.metrics.ts` and imported it into `src/analytics/forecasting/forecasting.engine.ts`.
2. `computePendingInboundByProduct` aggregates inbound quantities from:
   - `dataset.purchases` where `status === 'ordered'` (respecting branch/product/category scope filters).
   - `dataset.stockMovements` where `type === 'restock'` and `receiptMode === 'invoice_only'`.
   - Deduplicates records by matching `mov.referenceId` and `mov.invoiceNumber` against `po.id` and `po.purchaseNumber` (`handledInboundRefs`).
3. Updated `recommendedReorderUnits` in `src/analytics/forecasting/forecasting.engine.ts`:
   $$\text{recommendedReorderUnits} = \max\left(0, \lceil \text{forecastedTotalUnits} + \text{safetyBuffer} - (\text{currentStock} + \text{pendingInboundUnits}) \rceil\right)$$

---

## 3. Retest Verification Matrix

| Test Case | Input Fixture | Pre-Fix Result | Post-Fix Expected & Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Branch Scope Filter (`FC-08`)** | 65 days of `~13` units/day on `branch-main` + `500` units on `branch-bahri`, filtered by `branchId: 'branch-main'` | `historicalDailyDemand = 21.02` (included `branch-bahri`) | `historicalDailyDemand = 13.25` (`branch-bahri` excluded) | **PASS** |
| **Merchandise Return Deduction (`FC-08`)** | `RET-FC-64` returning `5` units against `TX-FC-64` | Ignored return (`+5` units over-counted) | `5` returned units deducted from day 64 net demand | **PASS** |
| **Deduplicated Pending Inbound (`FC-09`)** | `PO-FC-ORD-1` (`status: 'ordered'`, `50` units) + `MOV-FC-DUP` (`receiptMode: 'invoice_only'`, `referenceId: 'PO-FC-ORD-1'`, `50` units) | `pendingInboundUnits = 0` | `pendingInboundUnits = 50` (deduplicated) | **PASS** |
| **Reorder Deduction (`FC-09`)** | `currentStock = 30`, `pendingInboundUnits = 50`, `7d` horizon (`forecastedTotalUnits = 96`, `safetyBuffer = 28`) | `recommendedReorderUnits = 94` (`124 - 30`) | `recommendedReorderUnits = 44` (`124 - (30 + 50)`) | **PASS** |
