# Final Forecast Validation Results — Business Intelligence & Predictive Analytics

- **Application**: Dqnamo POS (`com.dqnamo.pos`)
- **Audit Date**: 2026-11-03
- **Audit Scope**: Independent statistical validation of `src/analytics/forecasting/forecasting.engine.ts` across 7-day, 30-day, and 90-day horizons, all 5 forecasting models, rolling-origin backtesting, error/bias metrics, empirical interval coverage, and SKU-level demand forecasting.
- **Verification Harness**: `src/analytics/acceptance-audit.test.ts` (Section 5), `src/analytics/analytics.test.ts` (Phase 6), and live REST probes against `GET /api/analytics/forecasts`.

---

## 1. Live Store Dataset Backtest Measurements (8 Active Days / 30-Day Window)

Measured directly from `GET /api/analytics/forecasts?datePreset=30d&forecastHorizonDays={7|30|90}&userId=user-1` on the active store dataset (`8` active sales days, `5` rolling origins, `9` out-of-sample evaluation steps):

| Model ID | Model Name | MAE (SDG) | WAPE (%) | Signed Bias (SDG) | Bias (%) | Rolling Origins | Out-of-Sample Steps (`testPoints`) | Empirical 80% Coverage | Empirical 95% Coverage | Beats Naive Baseline | Selected Winner |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `moving_average_7` | 7-Day Trailing Moving Average (MA) | **15.43** | **25.4%** | -9.22 | -15.2% | 5 | 9 | 77.8% | 77.8% | `true` | **Yes (`true`)** |
| `seasonal_naive_weekly` | Weekly Seasonal Naive (Day-of-Week Cycle) | 15.80 | 26.0% | -9.17 | -15.1% | 5 | 9 | 88.9% | 88.9% | `true` | No |
| `simple_exponential_smoothing` | Simple Exponential Smoothing (SES α=0.35) | 15.99 | 26.3% | -8.91 | -14.7% | 5 | 9 | 66.7% | 77.8% | `true` | No |
| `holt_linear_exponential` | Holt Damped Trend Exponential Smoothing | 24.94 | 41.0% | +0.84 | +1.4% | 5 | 9 | 55.6% | 55.6% | `true` | No (Penalized +5% WAPE on 30d/90d due to `<21` active days) |
| `naive_last_value` | Naive Last-Observation Baseline | 25.72 | 42.3% | -1.21 | -2.0% | 5 | 9 | 66.7% | 77.8% | `false` | No |

### Key Observations from Live Backtest Data
1. **Honest Accuracy Assessment**: On the default store dataset (`8` active sales days), the winning model (`moving_average_7`) achieves **WAPE = 25.4%** and **MAE = 15.43 SDG** (improving over the `naive_last_value` baseline WAPE of **42.3%** by **16.9 percentage points**), with a negative signed bias of **-15.2%** (`-9.22 SDG`) due to recent end-of-window sales peaks (`96.02 SDG` on Oct 31).
2. **Interval Calibration Honesty**: Because the default store dataset has only `8` active days (`< 21` days required) and `9` out-of-sample test steps (`< 10` required), empirical 95% coverage (`77.8%`) falls short of nominal `95%`. The engine accurately detects this and sets `intervalCalibrationStatus: 'estimated_uncertainty_range'` and `horizonSufficiencyStatus: 'extrapolated_beyond_observed_history'` rather than claiming calibrated 95% statistical confidence.
3. **65-Day Synthetic Seasonal Series Validation (`acceptance-audit.test.ts` Section 5)**: When tested on a 65-active-day series (`>= 60` days required for 90d horizon), all three horizons (`7d`, `30d`, `90d`) achieve `horizonSufficiencyStatus: 'sufficient_history'`, `intervalCalibrationStatus: 'calibrated_empirical_coverage'`, and `dataQualityStatus: 'high_confidence'`.

---

## 2. Forecasting Validation Test Matrix

| Test Case ID | Test Scenario | Classification | Expected Result | Actual Result | Evidence (File / Line / Test) | Severity | Recommended Action |
| :--- | :--- | :---: | :--- | :--- | :--- | :---: | :--- |
| **FC-01** | **7-Day Horizon Forecast (`forecastHorizonDays: 7`)** | **PASS** | Generates `7` future `ForecastPoint` entries with 80%/95% bounds; checks `minimumHistoryRequiredDays = 14`. | `7` future points generated; `minimumHistoryRequiredDays = 14`; `horizonSufficiencyStatus = 'extrapolated_beyond_observed_history'` on 8-day store data and `'sufficient_history'` on 65-day fixture. | `src/analytics/forecasting/forecasting.engine.ts:468-535`, verified in `acceptance-audit.test.ts` & `analytics.test.ts` | Low | None — verified exact. |
| **FC-02** | **30-Day Horizon Forecast (`forecastHorizonDays: 30`)** | **PASS** | Generates `30` future `ForecastPoint` entries; checks `minimumHistoryRequiredDays = 30`; applies +5% WAPE penalty to `holt_linear_exponential` when active history `< 21` days. | `30` future points generated; `minimumHistoryRequiredDays = 30`; `holt_linear_exponential` sorted below `naive_last_value` on 8-day store dataset due to short-history horizon guard. | `src/analytics/forecasting/forecasting.engine.ts:348-362, 485-494`, verified in `acceptance-audit.test.ts` | Low | None — verified exact. |
| **FC-03** | **90-Day Horizon Forecast (`forecastHorizonDays: 90`)** | **PASS** | Generates `90` future `ForecastPoint` entries; checks `minimumHistoryRequiredDays = 60`; widens uncertainty bands via `Math.sqrt(1 + 0.12 * h)`. | `90` future points generated; `minimumHistoryRequiredDays = 60`; uncertainty bands widen monotonically with horizon step `h`. | `src/analytics/forecasting/forecasting.engine.ts:433-451, 485-494`, verified in `acceptance-audit.test.ts` | Low | None — verified exact. |
| **FC-04** | **All 5 Statistical Models Evaluated Against `naive_last_value` Baseline** | **PASS** | Every call to `evaluateAndSelectBestModel` evaluates `naive_last_value`, `moving_average_7`, `seasonal_naive_weekly`, `simple_exponential_smoothing`, and `holt_linear_exponential`, setting `beatsNaiveBaseline` accurately. | All `5` models returned in `backtestEvaluations[]`; `beatsNaiveBaseline` is `false` for `naive_last_value` and `true` only when a candidate model has lower WAPE (or equal WAPE and `<=` MAE). | `src/analytics/forecasting/forecasting.engine.ts:52-182, 232-343`, verified in `analytics.test.ts` (Phase 6) | Low | None — verified exact. |
| **FC-05** | **Multi-Origin Rolling Backtesting & Accuracy Metrics (`MAE`, `WAPE %`, Signed `forecastBias`, `biasPercent`)** | **PASS** | Up to `5` rolling origins evaluated out-of-sample; `MAE = Σ|A - F|/n`, `WAPE = Σ|A - F|/Σ|A| * 100`, `forecastBias = Σ(F - A)/n`, `biasPercent = Σ(F - A)/Σ|A| * 100`. | For `Actual=[100, 100]`, `Forecast=[110, 120]`: `mae = 15`, `wapePercent = 15%`, `forecastBias = +15`, `biasPercent = +15%`. Rolling origins count = `5` on store data. | `src/analytics/forecasting/forecasting.engine.ts:188-328`, verified in `analytics.test.ts:511-515` | Low | None — verified exact. |
| **FC-06** | **Empirical 80% & 95% Interval Coverage & Calibration Status** | **PASS** | Computes `empiricalCoverage80Percent` and `empiricalCoverage95Percent` across rolling out-of-sample residuals; sets `intervalCalibrationStatus = 'estimated_uncertainty_range'` unless `testPoints >= 10 && activeDaysCount >= 21`. | Correctly reports `empiricalCoverage80Percent` (`77.8%`) and `empiricalCoverage95Percent` (`77.8%`) and labels intervals `'Estimated Uncertainty Ranges (80% / 95%)'` when history `< 21` days. | `src/analytics/forecasting/forecasting.engine.ts:276-310, 511-515`, verified in `acceptance-audit.test.ts` | Low | None — verified exact. |
| **FC-07** | **Insufficient / Empty Historical Data Behavior (`0` to `<5` active days)** | **PASS** | Does not crash or return `NaN`/`Infinity`; sets `horizonSufficiencyStatus = 'insufficient_history'` and `dataQualityStatus = 'short_history_warning'`. | On empty transaction dataset (`analytics.test.ts:631-647`), returns `0` expected sales, `horizonSufficiencyStatus = 'insufficient_history'`, `dataQualityStatus = 'short_history_warning'`, and `7` zero-valued future points. | `src/analytics/forecasting/forecasting.engine.ts:242-259, 485-494`, verified in `analytics.test.ts` (Phase 8) | Low | None — verified exact. |
| **FC-08** | **SKU-Level Demand Forecast Pending Inbound Stock Deduction (`productDemandForecasts`)** | **FAIL** | `productDemandForecasts[].pendingInboundUnits` should reflect pending inbound purchase orders (`status === 'ordered'`) and deduct them from `recommendedReorderUnits`, matching `inventory.products[].reorderRecommendation`. | `forecasting.engine.ts:667` hardcodes `pendingInboundUnits: 0` and computes `recommendedReorderUnits = Math.max(0, Math.ceil(forecastedTotalUnits + safetyBuffer - currentStock))` without subtracting pending inbound purchase orders. | `src/analytics/forecasting/forecasting.engine.ts:652-680` vs `src/analytics/calculations/inventory.metrics.ts:307-316` | Low-Medium | Pass `pendingInboundByProduct` into `computeForecasts` so `productDemandForecasts[].pendingInboundUnits` and `recommendedReorderUnits` match `computeInventoryAnalytics`. |
| **FC-09** | **SKU-Level Demand Forecast Branch/Scope Filtering & Return Reversal** | **FAIL** | `productDemandForecasts` should filter transactions via `filterTransactionsByScope(dataset.transactions, ...)` and subtract returned units (`dataset.returns`), matching `sales.byProduct`. | `forecasting.engine.ts:560` uses `const completedTx = dataset.transactions.filter((t) => t.status === 'completed')` without applying branch/cashier/payment filters or subtracting returned merchandise units from `dailyUnitsMap`. (Top-level `revenueSeries` and `profitSeries` DO use scoped/net `sales.dailySeries`). | `src/analytics/forecasting/forecasting.engine.ts:560-600` | Medium | Filter `completedTx` in `computeForecasts` using `filterTransactionsByScope` and subtract returned units per SKU per day via `resolveReturnsForTransaction`. |

---

## 3. Summary of Forecasting Validation Audit

- **Total Forecasting Scenarios Audited**: 9
- **PASS**: 7 / 9 (`FC-01` through `FC-07`)
- **FAIL**: 2 / 9 (`FC-08` hardcoded `pendingInboundUnits: 0` in SKU forecast table; `FC-09` unscoped `completedTx` in SKU demand loop)
