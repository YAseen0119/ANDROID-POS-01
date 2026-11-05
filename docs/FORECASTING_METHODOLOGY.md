# Statistical Forecasting & Retail Technical Analysis Methodology

**Application:** Dqnamo POS (`com.dqnamo.pos`)  
**Engine Files:** `src/analytics/forecasting/forecasting.engine.ts` & `src/analytics/indicators/technical-analysis.ts`

---

## 1. Statistical Forecasting Models

The forecasting engine implements four transparent, deterministic statistical time-series models without external black-box dependencies:

### 1.1 7-Day Trailing Moving Average (`moving_average_7`)
$$\hat{y}_{T+h} = \frac{1}{k} \sum_{i=T-k+1}^{T} y_i, \quad k = \min(7, T)$$
Captures the recent local level while filtering out single-day noise.

### 1.2 Weekly Seasonal Naive (`seasonal_naive_weekly`)
$$\hat{y}_{T+h} = y_{T + ((h - 1) \bmod 7) - 6}$$
Preserves day-of-week retail cyclicity (e.g., Thursday/Weekend traffic surges vs mid-week baselines).

### 1.3 Simple Exponential Smoothing (`simple_exponential_smoothing`)
$$\ell_t = \alpha y_t + (1 - \alpha)\ell_{t-1}, \quad \hat{y}_{T+h} = \ell_T \quad (\alpha = 0.35)$$
Assigns exponentially decaying weights to older observations, adapting rapidly to recent shifts in daily store revenue.

### 1.4 Holt Damped-Trend Double Exponential Smoothing (`holt_linear_exponential`)
$$\begin{aligned}
\ell_t &= \alpha y_t + (1 - \alpha)(\ell_{t-1} + \phi b_{t-1}) \\
b_t &= \beta (\ell_t - \ell_{t-1}) + (1 - \beta)\phi b_{t-1} \\
\hat{y}_{T+h} &= \ell_T + \left(\sum_{j=1}^{h} \phi^j\right) b_T
\end{aligned}$$
where $\alpha = 0.40$, $\beta = 0.20$, and damping factor $\phi = 0.88$. The damping parameter $\phi < 1$ prevents unrealistic runaway linear extrapolation on 30-day and 90-day horizons, while clamping all retail sales/demand predictions to $\ge 0$.

---

## 2. Chronological Out-of-Sample Backtesting & Automatic Model Selection

To prevent data leakage:
1. The historical active series $y_1, \dots, y_N$ is split **strictly chronologically** into:
   - **Training Window:** $y_1, \dots, y_{N - H_{\text{test}}}$
   - **Out-of-Sample Test Window:** $y_{N - H_{\text{test}} + 1}, \dots, y_N$, where $H_{\text{test}} = \max(1, \min(7, \lfloor N / 3 \rfloor))$.
2. Each of the 4 candidate models is fitted exclusively on the Training Window and evaluated on the Test Window using:
   - **Mean Absolute Error (MAE):**
     $$\text{MAE} = \frac{1}{H_{\text{test}}} \sum_{t=1}^{H_{\text{test}}} |y_t - \hat{y}_t|$$
   - **Weighted Absolute Percentage Error (WAPE %):**
     $$\text{WAPE} = \frac{\sum_{t=1}^{H_{\text{test}}} |y_t - \hat{y}_t|}{\sum_{t=1}^{H_{\text{test}}} |y_t|} \times 100$$
     (Used instead of standard MAPE because MAPE divides by zero on days with zero sales).
3. The model achieving the **lowest out-of-sample WAPE** (with MAE as tie-breaker) is automatically selected as the winning model (`isSelectedWinner: true`) and refitted on the full observed series to generate the 7, 30, or 90-day forecast.

---

## 3. Prediction Intervals (80% & 95% Confidence Bands)

Empirical residual standard error $\sigma_e = \sqrt{\frac{1}{N-1}\sum (y_t - \hat{y}_t)^2}$ is scaled over forecast step $h \in \{1, \dots, H\}$ via:
$$\sigma_h = \sigma_e \sqrt{1 + 0.12(h - 1)}$$
- **80% Confidence Band:** $\left[\max(0, \hat{y}_{T+h} - 1.28\sigma_h), \; \hat{y}_{T+h} + 1.28\sigma_h\right]$
- **95% Confidence Band:** $\left[\max(0, \hat{y}_{T+h} - 1.96\sigma_h), \; \hat{y}_{T+h} + 1.96\sigma_h\right]$

---

## 4. Adaptation of Financial Technical Indicators to Retail POS Data

| Indicator | Retail Time-Series Definition | Business Interpretation |
| :--- | :--- | :--- |
| **SMA(7, 30, 90)** | Arithmetic mean of daily net sales over $N \in \{7, 30, 90\}$ days | Smooths daily volatility to reveal weekly, monthly, and quarterly baseline revenue levels. |
| **EMA(7, 30)** | Exponentially weighted daily net sales ($k = \frac{2}{N+1}$) | Reacts faster than SMA to new promotions, price updates, or demand shifts. `EMA(7) > SMA(7)` signals short-term sales expansion. |
| **RSI(14 / Adaptive 7)** | Wilder momentum oscillator ($0\text{–}100$) on daily sales deltas | $\text{RSI} > 70$ indicates an unusual demand surge (stockout risk); $\text{RSI} < 30$ indicates a demand dip (promotion opportunity). |
| **MACD(12, 26, 9)** | $\text{EMA}_{12} - \text{EMA}_{26}$ vs 9-day Signal EMA | Positive histogram indicates medium-term store revenue is accelerating above its monthly trend. Requires 34+ daily points (available in 90-Day view). |
| **Support & Resistance** | 20th and 85th percentiles of active daily net sales | Defines the store's reliable daily baseline revenue floor (Support) and peak operational capacity zone (Resistance). |
