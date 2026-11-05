# Business Intelligence & Predictive Analytics Test Report

**Application:** Dqnamo POS (`com.dqnamo.pos`)  
**Test Runner:** Node.js Built-in Test Runner (`npx tsx --test`)  
**Date:** 2026-11-02

---

## 1. Automated Unit & Integration Test Suites

All 45 automated unit tests across 5 test suites pass with **0 failures**:

| Test Suite File | Tests | Pass | Fail | Coverage Focus |
| :--- | :---: | :---: | :---: | :--- |
| `src/analytics/analytics.test.ts` | 8 | 8 | 0 | Gross/Net sales reconciliation, discounts/tax/voids, COGS & multi-unit pack cost, P&L & unrecorded overhead handling, multi-currency `historical`/`live`/`indexed` conversion, RBAC & branch isolation, ABC classification & reorder engine, SMA/EMA/RSI/MACD/Trendline math, chronological backtesting (MAE/WAPE) across 7/30/90d horizons, and zero-transaction edge cases. |
| `src/lib/pos-calculations.test.ts` | 15 | 15 | 0 | Cart totals, tax-inclusive/exclusive math, multi-currency conversions, debt settlements, store reports, and daily revenue trends. |
| `src/lib/inventory-rules.test.ts` | 6 | 6 | 0 | Stock movement validations, restock/damage adjustments, and multi-unit packaging stock deductions. |
| `src/lib/barcode-scanner-engine.test.ts` | 10 | 10 | 0 | Dual browser/Android ML Kit barcode engine, format normalization, deduplication cooldown, and product lookup. |
| `src/lib/training-tour.test.ts` | 6 | 6 | 0 | Bilingual interactive POS training tour state machine and role filtering. |

---

## 2. Detailed Verification of BI & Predictive Analytics Test Cases (`src/analytics/analytics.test.ts`)

1. **Test 1 — Gross Sales, Net Sales, Discounts, Tax, and Voided/Returned Reconciliation:**
   - Verified pre-discount gross ($4 \times 10 = 40$), 10% item discount ($4$) + global invoice discount ($6$) = $10$ total discount, Net Sales = $30$, Tax = $3$, Billed Grand Total = $33$, and voided invoice ($33$) excluded from Net Sales and tracked in `returnedOrVoidedSales`.
2. **Test 2 — COGS, Multi-Unit Pack Costing & P&L Reconciliation:**
   - Verified `financial.profitAndLoss.netSalesRevenue === sales.summary.netSales`, `grossProfit === netSalesRevenue - costOfGoodsSold`, `generalOperatingExpenses === null` (`'not_recorded_in_schema'`), and `netOperatingProfit === grossProfit - recordedShrinkageAndDamageExpense`.
3. **Test 3 — Multi-Currency Historical Sale-Rate vs Live vs USD-Indexed Conversion:**
   - Verified a 2,500 SDG invoice recorded when `1 USD = 2,500 SDG` evaluates to `$1.00 USD` in `'historical'` mode even when today's live rate is `2,700 SDG/USD`, and evaluates to `2,700 SDG` (`+200 SDG` FX translation delta) in `'indexed'` purchasing-power mode.
4. **Test 4 — Role-Based Access Control (RBAC) & Branch Scoping:**
   - Verified `cashier` role is automatically restricted to their assigned branch (`branch-main`) and terminal (`POS Terminal 01`), with `canViewFinancials: false`, `canViewCostAndMargin: false`, and sensitive P&L / COGS / Gross Profit fields masked to `0`.
5. **Test 5 — Inventory Valuation, ABC Pareto Classification & Reorder Recommendations:**
   - Verified Class A + Class B + Class C SKU counts sum to total catalog SKUs, low-stock items (`prod-3` and `prod-5`) trigger `shouldReorder: true`, and `approvalStatus` is `'requires_user_approval'`.
6. **Test 6 — Retail Technical Indicators Math:**
   - Verified exact numerical accuracy for `SMA(7)`, `EMA(7)`, `RSI(14)`, `MACD(12, 26, 9)`, Ordinary Least-Squares Linear Regression slope, and 20th/85th percentile Support & Resistance levels.
7. **Test 7 — Statistical Forecasting & Chronological Backtesting:**
   - Verified out-of-sample MAE and WAPE % computation, automatic winner selection across all 4 candidate models, and non-negative 80% and 95% confidence bounds across 7, 30, and 90-day horizons.
8. **Test 8 — Empty / Insufficient Historical Data Resilience:**
   - Verified zero-transaction datasets return `0` for sales/profit and `null` for multi-week moving averages without throwing `NaN` or runtime exceptions.
