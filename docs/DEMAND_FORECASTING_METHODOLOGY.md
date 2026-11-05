# Predictive Demand & Stockout-Compensated Forecasting Methodology (Phase 10)

## 1. Core Problem: Stockout Censoring in Retail POS Data
Traditional POS forecasting models train exclusively on completed checkout transactions (`actualUnitsSold`). When a high-demand product runs out of stock for several days during a 30-day window:
1. Sales during stockout days drop to `0`.
2. A naive sales-only average divides total sold units by all calendar days (`30`), artificially depressing velocity.
3. Subsequent reorder recommendations systematically under-order, perpetuating a chronic stockout cycle.

Phase 10 resolves stockout censoring in `src/analytics/forecasting/forecasting.engine.ts` while strictly preserving separate reporting for **Sales-Only Forecast** vs. **Latent-Demand Adjusted Forecast**.

---

## 2. Mathematical Formulation

### 2.1 Active In-Stock Day Reconstruction (`stockoutDaysObservedInWindow`)
For each registered product $i$ over an analysis window of $D$ days:
- The engine inspects current stock, stock movement history (`stockMovements`), and recorded `OUT_OF_STOCK` / `EXPIRED` customer inquiries (`unmetDemandRequests`) to identify censored stockout days $D_{\text{stockout}, i} \in [0, D - 1]$.
- Active in-stock selling days are defined as:
  $$D_{\text{active}, i} = \max(1, D - D_{\text{stockout}, i})$$

### 2.2 Uncensored Sales Velocity vs. Naive Sales Velocity
- **Naive Sales-Only Daily Velocity:**
  $$v_{\text{naive}, i} = \frac{U_{\text{sold}, i}}{D}$$
- **Stockout-Uncensored Daily Velocity:**
  $$v_{\text{uncensored}, i} = \frac{U_{\text{sold}, i}}{D_{\text{active}, i}}$$

### 2.3 Incorporating Deduplicated Customer Unmet Demand Signals
Not every customer inquiry represents an additional lost sale beyond normal uncensored velocity, and repeated inquiries within 24 hours may come from the same customer or batch shortage. To prevent demand inflation:
1. **24-Hour Rolling Deduplication & Cap:** Multiple inquiries for the same product in the same branch on the same day are damped by `0.75` after the first inquiry.
2. **Purchase Intent Weighting:**
   - Confirmed purchase intent (`confirmedPurchaseIntent = true`, reason `OUT_OF_STOCK` or `EXPIRED`): weight $w = 0.85$.
   - General availability inquiry (`confirmedPurchaseIntent = false`): weight $w = 0.35$.
3. **Incremental Unmet Daily Velocity ($v_{\text{unmet}, i}$):**
   $$v_{\text{unmet}, i} = \frac{\sum w \cdot U_{\text{unmet, deduped}, i}}{D}$$
   When stockout censoring compensation already lifts velocity ($v_{\text{uncensored}, i} - v_{\text{naive}, i}$), only the incremental portion of unmet demand above the censoring lift is added, plus a conservative blending factor ($0.65$), preventing double-counting of stockout days.

### 2.4 Latent Daily Demand ($v_{\text{latent}, i}$) & Horizon Projection ($H \in \{7, 30, 90\}$)
$$v_{\text{latent}, i} = \max\left(v_{\text{naive}, i},\; v_{\text{uncensored}, i} + 0.65 \cdot \max\left(0, v_{\text{unmet}, i} - (v_{\text{uncensored}, i} - v_{\text{naive}, i})\right)\right)$$
For forecast horizon $H \in \{7, 30, 90\}$ days:
$$\text{ForecastedTotalUnits}_{i}(H) = \text{round}\left(v_{\text{naive}, i} \times H\right)$$
$$\text{ForecastedLatentTotalUnits}_{i}(H) = \text{round}\left(v_{\text{latent}, i} \times H\right)$$

---

## 3. Multi-Tier Fallback Hierarchy for Sparse Data
When product-branch history is sparse, the engine applies an explicit, auditable fallback hierarchy (`fallbackHierarchyUsed`):
1. **`branch_product` (Tier 1 — High Confidence):** Product has $\ge 3$ active demand observations in the target branch.
2. **`store_product` (Tier 2 — Medium Confidence):** Product has sparse branch history ($1\text{–}2$ observations) or global store history across branches.
3. **`category_baseline` (Tier 3 — Low Confidence / Cold Start):** Newly introduced or zero-sale product with recorded unmet inquiries falls back to conservative category-level velocity priors and explicit unmet inquiry counts.

---

## 4. Rolling-Origin Backtesting & Baseline Comparison (`predictiveDemandComparison`)
Every forecast response computes `forecasts.predictiveDemandComparison`, evaluating:
- **Baseline Sales-Only Model:** Naive historical sales velocity without stockout censoring compensation or unmet demand signals.
- **Latent-Demand Adjusted Model:** Stockout-compensated velocity incorporating weighted unmet demand signals.
- **Accuracy Metrics Compared:**
  - `baselineSalesOnlyWapePercent` vs. `latentDemandAdjustedWapePercent` (Weighted Absolute Percentage Error against true uncensored demand).
  - `baselineSalesOnlyMae` vs. `latentDemandAdjustedMae` (Mean Absolute Error).
  - `baselineBias` vs. `latentDemandAdjustedBias` (Demonstrating how sales-only models exhibit negative under-forecasting bias during stockouts, whereas latent-demand adjustment reduces downward bias).
