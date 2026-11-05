# Statistical Forecasting & Rolling-Origin Backtest Report

## 1. Candidate Models Evaluated (Phase 6)

The forecasting engine evaluates **5 statistical retail time-series models** (including the mandatory Naive baseline):

1. **`naive_last_value` (Baseline)**: Projects the most recent active observation forward ($\hat{y}_{T+h} = y_T$).
2. **`moving_average_7`**: 7-day trailing simple moving average ($\hat{y}_{T+h} = \frac{1}{k}\sum_{i=0}^{k-1} y_{T-i}$).
3. **`seasonal_naive_weekly`**: 7-day day-of-week seasonal cycle ($\hat{y}_{T+h} = y_{T+h-7}$).
4. **`simple_exponential_smoothing`**: Level smoothing with $\alpha = 0.35$.
5. **`holt_linear_exponential`**: Damped-trend Holt linear exponential smoothing ($\alpha = 0.40, \beta = 0.20, \phi = 0.88$).

---

## 2. Multi-Origin Rolling Backtesting Methodology

Instead of a single static train/test split, `evaluateAndSelectBestModel(series, requestedHorizonDays)` performs **Rolling-Origin Backtesting**:
- Up to **5 chronological cutoff origins** ($t_1 < t_2 < \dots < t_k$) are generated across the active historical series.
- At each cutoff origin $t_j$, every candidate model is fit strictly on the training prefix $y_{1..t_j}$ (zero future leakage) and forecasts multi-step out-of-sample test observations up to $H_{\text{eval}} = \min(\text{requestedHorizonDays}, \lfloor n/3 \rfloor)$.
- Out-of-sample errors are aggregated across all rolling origins to compute:
  - **MAE (Mean Absolute Error)**: $\frac{1}{M}\sum |y_i - \hat{y}_i|$
  - **WAPE % (Weighted Absolute Percentage Error)**: $\frac{\sum |y_i - \hat{y}_i|}{\sum |y_i|} \times 100$
  - **Forecast Bias (Signed Error)**: $\frac{1}{M}\sum (\hat{y}_i - y_i)$
  - **Bias %**: $\frac{\sum (\hat{y}_i - y_i)}{\sum |y_i|} \times 100$
  - **Empirical 80% & 95% Interval Coverage**: Percentage of out-of-sample test actuals falling inside the model's $[L_{80}, U_{80}]$ and $[L_{95}, U_{95}]$ intervals constructed at each origin.
  - **Beats Naive Baseline (`beatsNaiveBaseline`)**: Boolean flag indicating whether the model achieved lower WAPE/MAE than `naive_last_value`.

---

## 3. Horizon Sufficiency Rules & Uncertainty Interval Labeling

| Requested Horizon | Minimum Recommended Active History | Sufficiency Status When History < Minimum | Model Selection Guard |
| :--- | :--- | :--- | :--- |
| **7 Days (`7d`)** | `14` active days | `extrapolated_beyond_observed_history` (or `insufficient_history_warning` if `< 5` days) | Ranked by lowest rolling WAPE %, then lowest `|biasPercent|`, then lowest MAE |
| **30 Days (`30d`)** | `30` active days | `extrapolated_beyond_observed_history` | Penalizes `holt_linear_exponential` when active history `< 21` days to prevent runaway trend extrapolation from short samples |
| **90 Days (`90d`)** | `60` active days | `extrapolated_beyond_observed_history` | Penalizes `holt_linear_exponential` when active history `< 21` days; favors conservative level/seasonal models |

### Interval Calibration Transparency
- Residual standard deviation uses sample degrees of freedom $n - 1$: $\hat{\sigma} = \sqrt{\frac{1}{n-1}\sum (y_t - \hat{y}_t)^2}$ with sub-linear horizon scaling $\sigma_h = \hat{\sigma}\sqrt{1 + 0.12(h-1)}$.
- When out-of-sample rolling test points $< 10$ or active history $< 21$ days, `intervalCalibrationStatus` is set to `'estimated_uncertainty_range'` and labeled in the UI and API as **"Estimated Uncertainty Ranges (80% / 95%)"** (`"نطاقات عدم يقين تقديرية (80% / 95%)"`) rather than claiming guaranteed statistical confidence coverage.
