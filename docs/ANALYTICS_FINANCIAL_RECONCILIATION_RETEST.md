# Financial & COGS Reconciliation Retest Report (`FIN-14`, `INV-10` / `FIN-09`)

**Date:** 2026-11-03  
**Target Files:** `src/analytics/calculations/financial.metrics.ts`, `src/analytics/calculations/sales.metrics.ts`  
**Status:** **PASS — 100% REMEDIATED**

---

## 1. Defect `FIN-14` — Partial Purchase Order Payment Splitting, Clamping & Deduplication

### 1.1 Root Cause
In `src/analytics/calculations/financial.metrics.ts`, supplier purchase orders (`dataset.purchases`) previously checked only `if (po.paymentStatus === 'paid')`, routing the entire `poTotalInTarget` of partially paid purchase orders (`paymentStatus === 'partial'`, `paidAmount > 0`) to `accountsPayablePendingInvoices` and `0` to `cashOutflowsForRestockPurchases`.

### 1.2 Remediation Implemented
1. **Exact Paid vs. Unpaid Split:**
   - Resolves `rawPaid` from `po.paidAmount` (or `rawTotal` when `po.paymentStatus === 'paid'` and `paidAmount` is omitted, and `0` when `po.paymentStatus === 'unpaid'`).
   - Clamps `paidAmount` to `[0, totalAmount]` in both source and target currencies so negative or overpaid inputs can never corrupt cash flow or create negative Accounts Payable.
   - Computes:
     $$\text{cashOutflowsForRestockPurchases} \mathrel{+}= \text{clampedPaidInTarget}$$
     $$\text{accountsPayablePendingInvoices} \mathrel{+}= \max(0, \text{poTotalInTarget} - \text{clampedPaidInTarget})$$
2. **Deduplication Against `stockMovements`:**
   - Records `po.id` and `po.purchaseNumber` in `handledPurchaseRefs` and skips any `restock` stock movement whose `referenceId` or `invoiceNumber` matches a processed PO.

### 1.3 Retest Verification Results

| Scenario | Input Fixture | Expected `purchaseCommitmentsTotal` | Expected `cashOutflowsForRestockPurchases` | Expected `accountsPayablePendingInvoices` | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Partial Supplier PO** | `totalAmount: 1000, paidAmount: 400, paymentStatus: 'partial'` | `1000` | `400` | `600` | `1000 / 400 / 600` | **PASS** |
| **Overpaid PO Clamping** | `totalAmount: 500, paidAmount: 900, paymentStatus: 'paid'` | `500` | `500` | `0` | `500 / 500 / 0` | **PASS** |
| **Negative Paid Clamping** | `totalAmount: 300, paidAmount: -50, paymentStatus: 'partial'` | `300` | `0` | `300` | `300 / 0 / 300` | **PASS** |
| **PO + Matching Restock Movement** | `PO-PARTIAL-AUDIT` (`1000` SDG) + `mov-dup-po` (`referenceId: 'PO-PARTIAL-AUDIT'`, `1000` SDG) | `1000` (not `2000`) | `400` | `600` | `1000 / 400 / 600` | **PASS** |

---

## 2. Defect `INV-10` / `FIN-09` — Multi-Line Pack vs. Unit Historical COGS Resolution

### 2.1 Root Cause
In `src/analytics/calculations/sales.metrics.ts`, `tx.items.find((i) => i.productId === item.productId && i.sku === item.sku)` always returned the first line item of a SKU on an invoice. When an invoice contained both a `pack` line (`2` packs @ `16` SDG cost = `32` SDG) and a `unit` line (`4` strips @ `2` SDG cost = `8` SDG) for the same SKU, both lines resolved `origTxItem` to the `pack` line, inflating COGS to `2*16 + 4*16 = 96` SDG instead of `40` SDG.

### 2.2 Remediation Implemented
1. Added `resolveOriginalSaleLineItem(viewItem, viewIdx, origItems, consumedIndices)` in `src/analytics/calculations/sales.metrics.ts`:
   - Matches first by 1-to-1 index `viewIdx` (`getConvertedTransactionView` maps `tx.items` 1-to-1 in order) verifying `productId`, `saleUnit`, and `quantity`.
   - Falls back to stable line-item ID (`id` / `lineId`) or composite key (`productId`, `sku`, `saleUnit`, `quantity`, `discountPercent`) while tracking `consumedIndices` so duplicate SKU lines never collide.
2. Consumes returned quantities (`remainingRetQtyByProd`) and refund amounts (`remainingRetRefundByProd`) across multi-line items of the same SKU so partial returns are never deducted twice.

### 2.3 Retest Verification Results

| Metric on Mixed Pack + Unit Invoice (`TX-INV-PACK`) | Pre-Fix Value | Expected Value | Post-Fix Actual Value | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Line 1 (`2` Packs @ `16` SDG Pack Cost)** | `32.00` SDG | `32.00` SDG | `32.00` SDG | **PASS** |
| **Line 2 (`4` Units @ `2` SDG Unit Cost)** | `64.00` SDG *(Bug)* | `8.00` SDG | `8.00` SDG | **PASS** |
| **Total Invoice & Period COGS (`cogsInPeriod`)** | `96.00` SDG *(Bug)* | `40.00` SDG | `40.00` SDG | **PASS** |
| **Invoice Gross Profit (`92` Net Sales − `40` COGS)** | `-4.00` SDG *(Bug)* | `52.00` SDG | `52.00` SDG | **PASS** |
| **Cost-Based Stock Turnover (`40` COGS ÷ `90` Avg Cost)** | `1.07` *(Bug)* | `0.44` | `0.44` | **PASS** |
