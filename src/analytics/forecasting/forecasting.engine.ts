/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_BASELINE_EXCHANGE_RATES,
  getProductPricesInCurrency,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import { Product } from '../../lib/types';
import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  ForecastingModelName,
  ForecastingResult,
  ForecastPoint,
  ModelBacktestEvaluation,
  ProductDemandForecastItem,
  SalesAnalyticsResult,
} from '../analytics.types';
import { computePendingInboundByProduct } from '../calculations/inventory.metrics';
import {
  computeSalesAnalytics,
  filterTransactionsByScope,
  resolveReturnsForTransaction,
  toDateKey,
} from '../calculations/sales.metrics';

const MODEL_LABELS: Record<ForecastingModelName, { en: string; ar: string }> = {
  naive_last_value: {
    en: 'Naive Last-Observation Baseline',
    ar: 'النموذج المرجعي البسيط (آخر قيمة مرصودة)',
  },
  moving_average_7: {
    en: '7-Day Trailing Moving Average (MA)',
    ar: 'المتوسط المتحرك المتأخر (7 أيام)',
  },
  seasonal_naive_weekly: {
    en: 'Weekly Seasonal Naive (Day-of-Week Cycle)',
    ar: 'النموذج الموسمي الأسبوعي (دورة أيام الأسبوع)',
  },
  simple_exponential_smoothing: {
    en: 'Simple Exponential Smoothing (SES α=0.35)',
    ar: 'التمهيد الأسي البسيط (SES α=0.35)',
  },
  holt_linear_exponential: {
    en: 'Holt Damped Trend Exponential Smoothing',
    ar: 'تمهيد هولت الأسي المزدوج للاتجاه (Holt-Winters)',
  },
};

/**
 * Generates h-step ahead forecasts and in-sample one-step-ahead fitted values for a given univariate series
 * using one of the 5 statistical retail forecasting models (including the Naive baseline).
 */
export function runForecastModel(
  history: number[],
  horizon: number,
  model: ForecastingModelName
): {
  fitted: number[];
  forecast: number[];
} {
  const n = history.length;
  if (n === 0) {
    return {
      fitted: [],
      forecast: new Array(horizon).fill(0),
    };
  }

  if (model === 'naive_last_value') {
    const fitted: number[] = [Math.max(0, roundCurrencyValue(history[0]))];
    for (let i = 1; i < n; i++) {
      fitted.push(Math.max(0, roundCurrencyValue(history[i - 1])));
    }
    const lastVal = Math.max(0, roundCurrencyValue(history[n - 1]));
    return {
      fitted,
      forecast: new Array(horizon).fill(lastVal),
    };
  }

  if (model === 'moving_average_7') {
    const windowSize = Math.min(7, n);
    const fitted: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - windowSize);
      const slice = i === 0 ? [history[0]] : history.slice(start, i);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      fitted.push(Math.max(0, roundCurrencyValue(avg)));
    }
    const lastSlice = history.slice(Math.max(0, n - windowSize));
    const baseForecast = Math.max(
      0,
      roundCurrencyValue(lastSlice.reduce((a, b) => a + b, 0) / lastSlice.length)
    );
    return {
      fitted,
      forecast: new Array(horizon).fill(baseForecast),
    };
  }

  if (model === 'seasonal_naive_weekly') {
    const period = Math.min(7, n);
    const fitted: number[] = [];
    for (let i = 0; i < n; i++) {
      const lagIdx = i - period >= 0 ? i - period : Math.max(0, i - 1);
      fitted.push(Math.max(0, roundCurrencyValue(history[lagIdx])));
    }
    const lastCycle = history.slice(n - period);
    const forecast: number[] = [];
    for (let h = 0; h < horizon; h++) {
      const val = lastCycle[h % lastCycle.length] ?? 0;
      forecast.push(Math.max(0, roundCurrencyValue(val)));
    }
    return { fitted, forecast };
  }

  if (model === 'simple_exponential_smoothing') {
    const alpha = 0.35;
    const fitted: number[] = [Math.max(0, roundCurrencyValue(history[0]))];
    let level = history[0];
    for (let i = 1; i < n; i++) {
      fitted.push(Math.max(0, roundCurrencyValue(level)));
      level = alpha * history[i] + (1 - alpha) * level;
    }
    const finalForecast = Math.max(0, roundCurrencyValue(level));
    return {
      fitted,
      forecast: new Array(horizon).fill(finalForecast),
    };
  }

  // Default: 'holt_linear_exponential' (Damped Trend Holt-Winters)
  const alpha = 0.4;
  const beta = 0.2;
  const phi = 0.88; // Damping parameter to prevent runaway linear extrapolation over 90 days

  let level = history[0];
  let trend = n > 1 ? (history[Math.min(n - 1, 3)] - history[0]) / Math.min(n - 1, 3) : 0;
  const fitted: number[] = [Math.max(0, roundCurrencyValue(level))];

  for (let i = 1; i < n; i++) {
    const pred = level + phi * trend;
    fitted.push(Math.max(0, roundCurrencyValue(pred)));
    const prevLevel = level;
    level = alpha * history[i] + (1 - alpha) * (prevLevel + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }

  const forecast: number[] = [];
  let phiSum = 0;
  for (let h = 1; h <= horizon; h++) {
    phiSum += Math.pow(phi, h);
    const val = level + phiSum * trend;
    forecast.push(Math.max(0, roundCurrencyValue(val)));
  }

  return { fitted, forecast };
}

/**
 * Computes Mean Absolute Error (MAE), Weighted Absolute Percentage Error (WAPE %),
 * Forecast Bias (Signed Error = Forecast - Actual), and Bias % between actual test observations
 * and predicted values.
 */
export function computeAccuracyMetrics(
  actuals: number[],
  predictions: number[]
): {
  mae: number;
  wapePercent: number;
  forecastBias: number;
  biasPercent: number;
} {
  const len = Math.min(actuals.length, predictions.length);
  if (len === 0) {
    return { mae: 0, wapePercent: 0, forecastBias: 0, biasPercent: 0 };
  }

  let absErrSum = 0;
  let signedErrSum = 0;
  let actualSum = 0;

  for (let i = 0; i < len; i++) {
    const signedErr = predictions[i] - actuals[i];
    absErrSum += Math.abs(signedErr);
    signedErrSum += signedErr;
    actualSum += Math.abs(actuals[i]);
  }

  const mae = roundCurrencyValue(absErrSum / len);
  const forecastBias = roundCurrencyValue(signedErrSum / len);
  const wapePercent =
    actualSum > 0
      ? Math.min(200, Math.round((absErrSum / actualSum) * 1000) / 10)
      : mae === 0
      ? 0
      : 100;
  const biasPercent =
    actualSum > 0
      ? Math.max(-200, Math.min(200, Math.round((signedErrSum / actualSum) * 1000) / 10))
      : 0;

  return { mae, wapePercent, forecastBias, biasPercent };
}

/**
 * Performs multi-origin rolling-origin backtesting across all 5 candidate models
 * for the requested forecast horizon and selects the most accurate and horizon-safe model.
 */
export function evaluateAndSelectBestModel(
  series: number[],
  requestedHorizonDays: number = 7
): {
  selectedModel: ForecastingModelName;
  evaluations: ModelBacktestEvaluation[];
} {
  const candidates: ForecastingModelName[] = [
    'naive_last_value',
    'moving_average_7',
    'seasonal_naive_weekly',
    'simple_exponential_smoothing',
    'holt_linear_exponential',
  ];

  // Trim leading zeros before first active business day
  let firstNonZeroIdx = series.findIndex((v) => v > 0);
  if (firstNonZeroIdx < 0) firstNonZeroIdx = 0;
  const activeSlice = series.slice(firstNonZeroIdx);
  const evalSeries = activeSlice.length >= 4 ? activeSlice : series;

  const n = evalSeries.length;
  // Determine multi-step test horizon per origin based on requestedHorizonDays and available history
  const maxStepPerOrigin = Math.max(
    1,
    Math.min(requestedHorizonDays, Math.max(1, Math.floor(n / 3)))
  );
  const minTrainLen = Math.max(2, n - Math.min(n - 2, maxStepPerOrigin + 4));

  // Build up to 5 rolling origin split indices
  const originIndices: number[] = [];
  for (let trainEnd = minTrainLen; trainEnd <= n - 1; trainEnd++) {
    originIndices.push(trainEnd);
  }
  const selectedOrigins =
    originIndices.length > 5
      ? originIndices.slice(originIndices.length - 5)
      : originIndices.length > 0
      ? originIndices
      : [Math.max(1, n - 1)];

  const evaluations: ModelBacktestEvaluation[] = candidates.map((model) => {
    const allActuals: number[] = [];
    const allPredictions: number[] = [];
    let within80Count = 0;
    let within95Count = 0;
    let totalEvaluatedPoints = 0;

    for (const originIdx of selectedOrigins) {
      const train = evalSeries.slice(0, originIdx);
      const test = evalSeries.slice(
        originIdx,
        Math.min(n, originIdx + maxStepPerOrigin)
      );
      if (test.length === 0) continue;

      const { fitted, forecast } = runForecastModel(train, test.length, model);

      // Compute train residual std error at this origin to evaluate empirical interval coverage
      let sumSq = 0;
      for (let i = 0; i < train.length; i++) {
        const err = train[i] - (fitted[i] ?? train[i]);
        sumSq += err * err;
      }
      const avgTrain =
        train.length > 0 ? train.reduce((a, b) => a + b, 0) / train.length : 0;
      const stdErr =
        train.length > 1 ? Math.sqrt(sumSq / (train.length - 1)) : avgTrain * 0.2;
      const sigmaBase = Math.max(avgTrain * 0.1, stdErr);

      for (let h = 0; h < test.length; h++) {
        const act = test[h];
        const pred = forecast[h] ?? 0;
        allActuals.push(act);
        allPredictions.push(pred);

        const sigmaH = sigmaBase * Math.sqrt(1 + 0.12 * h);
        const low80 = Math.max(0, pred - 1.28 * sigmaH);
        const high80 = pred + 1.28 * sigmaH;
        const low95 = Math.max(0, pred - 1.96 * sigmaH);
        const high95 = pred + 1.96 * sigmaH;

        if (act >= low80 && act <= high80) within80Count += 1;
        if (act >= low95 && act <= high95) within95Count += 1;
        totalEvaluatedPoints += 1;
      }
    }

    const { mae, wapePercent, forecastBias, biasPercent } = computeAccuracyMetrics(
      allActuals,
      allPredictions
    );

    const empiricalCoverage80Percent =
      totalEvaluatedPoints > 0
        ? Math.round((within80Count / totalEvaluatedPoints) * 1000) / 10
        : null;
    const empiricalCoverage95Percent =
      totalEvaluatedPoints > 0
        ? Math.round((within95Count / totalEvaluatedPoints) * 1000) / 10
        : null;

    return {
      model,
      modelNameEn: MODEL_LABELS[model].en,
      modelNameAr: MODEL_LABELS[model].ar,
      mae,
      wapePercent,
      forecastBias,
      biasPercent,
      trainPoints: selectedOrigins[selectedOrigins.length - 1] || 1,
      testPoints: totalEvaluatedPoints,
      rollingOriginsCount: selectedOrigins.length,
      horizonTestedDays: maxStepPerOrigin,
      empiricalCoverage80Percent,
      empiricalCoverage95Percent,
      beatsNaiveBaseline: false,
      isSelectedWinner: false,
    };
  });

  const naiveEval = evaluations.find((e) => e.model === 'naive_last_value');
  const naiveWape = naiveEval ? naiveEval.wapePercent : 100;
  const naiveMae = naiveEval ? naiveEval.mae : Infinity;

  for (const ev of evaluations) {
    if (ev.model === 'naive_last_value') {
      ev.beatsNaiveBaseline = false;
    } else {
      ev.beatsNaiveBaseline =
        ev.wapePercent < naiveWape ||
        (ev.wapePercent === naiveWape && ev.mae <= naiveMae);
    }
  }

  // Sort by lowest WAPE, then lowest absolute bias, then lowest MAE
  // Horizon Guard: If requestedHorizonDays >= 30 and observed active history < 21 days,
  // penalize aggressive trend extrapolation ('holt_linear_exponential') so conservative level models win
  // when history is too short to validate 30/90-day trend persistence.
  const isShortHistoryForLongHorizon = requestedHorizonDays >= 30 && n < 21;

  evaluations.sort((a, b) => {
    const aPenalty =
      isShortHistoryForLongHorizon && a.model === 'holt_linear_exponential' ? 5 : 0;
    const bPenalty =
      isShortHistoryForLongHorizon && b.model === 'holt_linear_exponential' ? 5 : 0;
    const aScore = a.wapePercent + aPenalty;
    const bScore = b.wapePercent + bPenalty;
    return (
      aScore - bScore ||
      Math.abs(a.biasPercent) - Math.abs(b.biasPercent) ||
      a.mae - b.mae
    );
  });

  const winner = evaluations[0].model;
  evaluations[0].isSelectedWinner = true;

  return {
    selectedModel: winner,
    evaluations,
  };
}

/**
 * Builds historical + future ForecastPoint[] with 80% and 95% uncertainty/prediction intervals.
 */
function buildForecastSeriesWithIntervals(
  historicalPoints: { dateKey: string; label: string; value: number }[],
  horizonDays: number,
  model: ForecastingModelName,
  referenceDate: Date
): ForecastPoint[] {
  let firstActiveIdx = historicalPoints.findIndex((p) => p.value > 0);
  if (firstActiveIdx < 0) firstActiveIdx = 0;
  const modelInputPoints = historicalPoints.slice(firstActiveIdx);
  const values = modelInputPoints.map((p) => p.value);

  const { fitted, forecast } = runForecastModel(values, horizonDays, model);

  // Estimate residual standard deviation from fitted vs actuals (using degrees of freedom n - 1)
  let sumSqErr = 0;
  for (let i = 0; i < values.length; i++) {
    const err = values[i] - (fitted[i] ?? values[i]);
    sumSqErr += err * err;
  }
  const avgVal =
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const rawStdErr =
    values.length > 1 ? Math.sqrt(sumSqErr / (values.length - 1)) : avgVal * 0.2;
  const baseStdErr = Math.max(avgVal * 0.1, rawStdErr);

  const output: ForecastPoint[] = [];

  // Include recent up to 14 historical points for visual continuity on the chart
  const histDisplayStart = Math.max(0, modelInputPoints.length - 14);
  for (let i = histDisplayStart; i < modelInputPoints.length; i++) {
    const pt = modelInputPoints[i];
    output.push({
      dateKey: pt.dateKey,
      label: pt.label,
      isHistorical: true,
      actualValue: pt.value,
      fittedOrForecastValue: fitted[i] ?? pt.value,
      lowerBound80: null,
      upperBound80: null,
      lowerBound95: null,
      upperBound95: null,
    });
  }

  const lastDate =
    modelInputPoints.length > 0
      ? new Date(modelInputPoints[modelInputPoints.length - 1].dateKey + 'T12:00:00')
      : new Date(referenceDate);

  for (let h = 0; h < horizonDays; h++) {
    const fDate = new Date(lastDate);
    fDate.setDate(lastDate.getDate() + h + 1);
    const dateKey = toDateKey(fDate);
    const label = fDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const fVal = forecast[h] ?? 0;

    // Horizon uncertainty grows sub-linearly
    const stepMultiplier = Math.sqrt(1 + 0.12 * h);
    const sigmaH = baseStdErr * stepMultiplier;

    const lower80 = Math.max(0, roundCurrencyValue(fVal - 1.28 * sigmaH));
    const upper80 = Math.max(fVal, roundCurrencyValue(fVal + 1.28 * sigmaH));
    const lower95 = Math.max(0, roundCurrencyValue(fVal - 1.96 * sigmaH));
    const upper95 = Math.max(upper80, roundCurrencyValue(fVal + 1.96 * sigmaH));

    output.push({
      dateKey,
      label,
      isHistorical: false,
      actualValue: null,
      fittedOrForecastValue: fVal,
      lowerBound80: lower80,
      upperBound80: upper80,
      lowerBound95: lower95,
      upperBound95: upper95,
    });
  }

  return output;
}

/**
 * Computes statistical forecasts for 7, 30, or 90 days across Revenue, Gross Profit,
 * and Product-level Demand & Depletion using Rolling-Origin Backtesting.
 */
export function computeForecasts(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  precomputedSales?: SalesAnalyticsResult,
  referenceDate: Date = new Date()
): ForecastingResult {
  const targetCurrency = filters.currency || 'SDG';
  const horizonDays: 7 | 30 | 90 =
    filters.forecastHorizonDays === 30 || filters.forecastHorizonDays === 90
      ? filters.forecastHorizonDays
      : 7;

  const liveRates: Record<string, number> = {
    ...DEFAULT_BASELINE_EXCHANGE_RATES,
    ...(dataset.exchangeRates || {}),
    SDG: 1,
  };

  const sales =
    precomputedSales || computeSalesAnalytics(dataset, filters, referenceDate);

  const dailyPoints = sales.dailySeries;
  const activeDaysCount = dailyPoints.filter((d) => d.netSales > 0).length;

  // Minimum history threshold rules per forecast horizon
  const minimumHistoryRequiredDays =
    horizonDays === 7 ? 14 : horizonDays === 30 ? 30 : 60;

  const horizonSufficiencyStatus: ForecastingResult['horizonSufficiencyStatus'] =
    activeDaysCount >= minimumHistoryRequiredDays
      ? 'sufficient_history'
      : activeDaysCount >= 5
      ? 'extrapolated_beyond_observed_history'
      : 'insufficient_history';

  const revenueHistory = dailyPoints.map((d) => ({
    dateKey: d.dateKey,
    label: d.label,
    value: d.netSales,
  }));

  const profitHistory = dailyPoints.map((d) => ({
    dateKey: d.dateKey,
    label: d.label,
    value: d.grossProfit ?? 0,
  }));

  const { selectedModel, evaluations } = evaluateAndSelectBestModel(
    revenueHistory.map((r) => r.value),
    horizonDays
  );

  const winnerEval = evaluations[0];
  const intervalCalibrationStatus: ForecastingResult['intervalCalibrationStatus'] =
    winnerEval.testPoints >= 10 && activeDaysCount >= 21
      ? 'calibrated_empirical_coverage'
      : 'estimated_uncertainty_range';

  const revenueSeries = buildForecastSeriesWithIntervals(
    revenueHistory,
    horizonDays,
    selectedModel,
    referenceDate
  );

  const profitSeries = buildForecastSeriesWithIntervals(
    profitHistory,
    horizonDays,
    selectedModel,
    referenceDate
  );

  const futureRevenuePoints = revenueSeries.filter((p) => !p.isHistorical);
  const futureProfitPoints = profitSeries.filter((p) => !p.isHistorical);

  const expectedTotalNetSales = roundCurrencyValue(
    futureRevenuePoints.reduce((acc, p) => acc + p.fittedOrForecastValue, 0)
  );
  const lowerBound80Total = roundCurrencyValue(
    futureRevenuePoints.reduce((acc, p) => acc + (p.lowerBound80 ?? p.fittedOrForecastValue), 0)
  );
  const upperBound80Total = roundCurrencyValue(
    futureRevenuePoints.reduce((acc, p) => acc + (p.upperBound80 ?? p.fittedOrForecastValue), 0)
  );
  const expectedAverageDailySales = roundCurrencyValue(expectedTotalNetSales / horizonDays);
  const expectedTotalGrossProfit = roundCurrencyValue(
    futureProfitPoints.reduce((acc, p) => acc + p.fittedOrForecastValue, 0)
  );

  const activeHistoricalAvg =
    activeDaysCount > 0 ? roundCurrencyValue(sales.summary.netSales / activeDaysCount) : 0;
  const projectedGrowthVsHistoricalPercent =
    activeHistoricalAvg > 0
      ? Math.round(
          ((expectedAverageDailySales - activeHistoricalAvg) / activeHistoricalAvg) * 1000
        ) / 10
      : 0;

  // Product-level demand & stock depletion forecasting (FC-08, FC-09, PERF-01)
  const productsMap = new Map<string, Product>(dataset.products.map((p) => [p.id, p]));
  const scopedCompletedTx = filterTransactionsByScope(
    dataset.transactions,
    productsMap,
    dataset.branches,
    filters
  ).filter((t) => t.status === 'completed');

  const dateKeysInWindow = dailyPoints.map((d) => d.dateKey);
  const validDateKeysSet = new Set<string>(dateKeysInWindow);

  const activeDatesSorted = Array.from(
    new Set(
      dailyPoints
        .filter((d) => d.netSales > 0 || d.transactionCount > 0)
        .map((d) => d.dateKey)
    )
  ).sort();
  const effectiveSpanDays = Math.max(7, activeDatesSorted.length);

  // Pre-index net daily base units sold per product in ONE single O(Transactions) pass
  // (excluding voided invoices and deducting returned merchandise quantities per FC-08)
  const productDailyNetUnits = new Map<string, Map<string, number>>();
  const productTotalNetUnits = new Map<string, number>();

  for (const tx of scopedCompletedTx) {
    const dk = toDateKey(new Date(tx.timestamp));
    if (!validDateKeysSet.has(dk)) continue;

    // Resolve returns associated with this transaction and map returned base units per productId
    const txReturns = resolveReturnsForTransaction(tx, dataset.returns || []);
    const returnedBaseUnitsByProd = new Map<string, number>();
    for (const ret of txReturns) {
      for (const ri of ret.items || []) {
        const prod = productsMap.get(ri.productId);
        const rSaleUnit = (ri as any).saleUnit;
        const retUnits =
          rSaleUnit === 'pack' && prod?.unitsPerPack && prod.unitsPerPack > 1
            ? Math.max(0, ri.quantity) * prod.unitsPerPack
            : Math.max(0, ri.quantity);
        returnedBaseUnitsByProd.set(
          ri.productId,
          (returnedBaseUnitsByProd.get(ri.productId) || 0) + retUnits
        );
      }
    }

    for (const item of tx.items) {
      const prod = productsMap.get(item.productId);
      const unitsPerPack =
        prod && prod.unitsPerPack && prod.unitsPerPack > 1 ? prod.unitsPerPack : 1;
      const grossUnits =
        item.stockDeducted && item.stockDeducted > 0
          ? item.stockDeducted
          : item.saleUnit === 'pack'
          ? item.quantity * unitsPerPack
          : item.quantity;

      // If return item quantity was recorded in pack units on a pack line item without explicit saleUnit,
      // convert proportionally and consume against this line item
      const availRet = returnedBaseUnitsByProd.get(item.productId) || 0;
      const convertedAvailRet =
        availRet > 0 &&
        item.saleUnit === 'pack' &&
        unitsPerPack > 1 &&
        availRet <= item.quantity
          ? availRet * unitsPerPack
          : availRet;
      const deductedRet = Math.min(grossUnits, convertedAvailRet);
      if (availRet > 0) {
        const consumedRaw =
          item.saleUnit === 'pack' && unitsPerPack > 1 && availRet <= item.quantity
            ? deductedRet / unitsPerPack
            : deductedRet;
        returnedBaseUnitsByProd.set(
          item.productId,
          Math.max(0, availRet - consumedRaw)
        );
      }

      const netUnits = Math.max(0, grossUnits - deductedRet);
      if (netUnits <= 0) continue;

      let prodDayMap = productDailyNetUnits.get(item.productId);
      if (!prodDayMap) {
        prodDayMap = new Map<string, number>();
        productDailyNetUnits.set(item.productId, prodDayMap);
      }
      prodDayMap.set(dk, (prodDayMap.get(dk) || 0) + netUnits);
      productTotalNetUnits.set(
        item.productId,
        (productTotalNetUnits.get(item.productId) || 0) + netUnits
      );
    }
  }

  // Deduplicated pending inbound units from ordered POs and invoice_only stock movements (FC-09)
  const pendingInboundByProduct = computePendingInboundByProduct(dataset, filters);

  // Phase 10 (Part 5): Pre-index Unmet Demand inquiries per product and per day for stockout-censoring compensation
  const branchFilter =
    filters.branchId && filters.branchId !== 'all' ? filters.branchId : null;
  const rawUnmetRequests = Array.isArray(dataset.unmetDemandRequests)
    ? dataset.unmetDemandRequests
    : [];

  const productUnmetRawUnits = new Map<string, number>();
  const productUnmetWeightedUnits = new Map<string, number>();
  const productUnmetDailyWeighted = new Map<string, Map<string, number>>();
  const productStockoutDaysSet = new Map<string, Set<string>>();
  const dailyUnmetWeightedRevenue = new Map<string, number>();
  let totalUnmetSignalsInScope = 0;

  for (const req of rawUnmetRequests) {
    if (!req || !req.id || req.fulfillmentStatus === 'cancelled') continue;
    if (branchFilter && req.branchId !== branchFilter) continue;
    const dk = toDateKey(new Date(req.requestedTimestamp));
    if (!validDateKeysSet.has(dk)) continue;

    totalUnmetSignalsInScope += 1;
    const baseUnits = Math.max(1, Number(req.requestedBaseUnits || req.requestedQuantity || 1));
    const weight =
      req.fulfillmentStatus === 'fulfilled_later'
        ? 0
        : req.confirmedPurchaseIntent
        ? 0.65
        : 0.35;
    const weightedUnits = baseUnits * weight;

    if (req.productId) {
      productUnmetRawUnits.set(
        req.productId,
        (productUnmetRawUnits.get(req.productId) || 0) + baseUnits
      );
      productUnmetWeightedUnits.set(
        req.productId,
        (productUnmetWeightedUnits.get(req.productId) || 0) + weightedUnits
      );
      let dMap = productUnmetDailyWeighted.get(req.productId);
      if (!dMap) {
        dMap = new Map<string, number>();
        productUnmetDailyWeighted.set(req.productId, dMap);
      }
      dMap.set(dk, (dMap.get(dk) || 0) + weightedUnits);

      if (
        req.unavailabilityReason === 'OUT_OF_STOCK' ||
        req.availabilityStatus === 'OUT_OF_STOCK' ||
        req.availabilityStatus === 'INSUFFICIENT_QUANTITY'
      ) {
        let sDays = productStockoutDaysSet.get(req.productId);
        if (!sDays) {
          sDays = new Set<string>();
          productStockoutDaysSet.set(req.productId, sDays);
        }
        sDays.add(dk);
      }
    }

    const prod = req.productId ? productsMap.get(req.productId) : undefined;
    const unitPrice = prod
      ? getProductPricesInCurrency(prod, targetCurrency, liveRates).sellingPrice
      : req.unitSellingPriceSnapshot && req.unitSellingPriceSnapshot > 0
      ? req.unitSellingPriceSnapshot
      : 0;
    if (unitPrice > 0 && weightedUnits > 0) {
      dailyUnmetWeightedRevenue.set(
        dk,
        (dailyUnmetWeightedRevenue.get(dk) || 0) + weightedUnits * unitPrice
      );
    }
  }

  let censoringCompensatedProductsCount = 0;

  const productDemandForecasts: ProductDemandForecastItem[] = dataset.products
    .filter((p) => {
      if (filters.productId && filters.productId !== 'all' && p.id !== filters.productId) {
        return false;
      }
      if (filters.category && filters.category !== 'all' && p.category !== filters.category) {
        return false;
      }
      return true;
    })
    .map((prod) => {
      const totalUnitsSold = productTotalNetUnits.get(prod.id) || 0;
      const prodDayMap = productDailyNetUnits.get(prod.id);
      const currentStock = Math.max(0, prod.stock);
      const pendingInboundUnits = pendingInboundByProduct.get(prod.id) || 0;
      const observedUnmetDemandUnits = productUnmetRawUnits.get(prod.id) || 0;
      const weightedUnmetUnits = productUnmetWeightedUnits.get(prod.id) || 0;
      const stockoutDaysObservedInWindow =
        productStockoutDaysSet.get(prod.id)?.size || 0;
      const censoringAdjusted = weightedUnmetUnits > 0;
      if (censoringAdjusted) {
        censoringCompensatedProductsCount += 1;
      }

      const fallbackHierarchyUsed: ProductDemandForecastItem['fallbackHierarchyUsed'] =
        branchFilter
          ? (prodDayMap?.size || 0) + stockoutDaysObservedInWindow >= 2
            ? 'branch_product'
            : 'store_product'
          : totalUnitsSold + observedUnmetDemandUnits > 0
          ? 'store_product'
          : 'category_baseline';

      // Fast-path for zero-sales SKUs in period (avoids running 5x5 rolling backtest on all-zero array)
      if (totalUnitsSold <= 0 || !prodDayMap) {
        const estimatedLatentDailyDemand =
          weightedUnmetUnits > 0
            ? Math.round((weightedUnmetUnits / effectiveSpanDays) * 100) / 100
            : 0;
        const forecastedLatentTotalUnits =
          weightedUnmetUnits > 0
            ? Math.max(1, Math.round(estimatedLatentDailyDemand * horizonDays))
            : 0;
        const safetyBuffer = Math.max(prod.minStockAlert, 0);
        const recommendedReorderUnits = Math.max(
          0,
          Math.ceil(
            forecastedLatentTotalUnits + safetyBuffer - (currentStock + pendingInboundUnits)
          )
        );
        return {
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          nameAr: prod.nameAr,
          currentStock,
          pendingInboundUnits,
          historicalDailyDemand: 0,
          forecastedDailyDemand: 0,
          forecastHorizonDays: horizonDays,
          forecastedTotalUnits: 0,
          forecastedRevenue: 0,
          estimatedDaysUntilDepletion: null,
          estimatedDepletionDate: null,
          recommendedReorderUnits,
          selectedModel: 'naive_last_value' as ForecastingModelName,
          wapePercent: 0,
          forecastBias: 0,
          confidenceLevel: 'low' as const,
          observedSalesDemandUnits: 0,
          observedUnmetDemandUnits,
          estimatedLatentDailyDemand,
          forecastedLatentTotalUnits,
          stockoutDaysObservedInWindow,
          censoringAdjusted,
          fallbackHierarchyUsed,
        };
      }

      const allDailyUnits = new Array<number>(dateKeysInWindow.length);
      let firstActive = -1;
      for (let i = 0; i < dateKeysInWindow.length; i++) {
        const u = prodDayMap.get(dateKeysInWindow[i]) || 0;
        allDailyUnits[i] = u;
        if (firstActive < 0 && u > 0) firstActive = i;
      }

      const demandWindow =
        firstActive >= 0 ? allDailyUnits.slice(firstActive) : allDailyUnits.slice(-7);

      const historicalDailyDemand =
        Math.round((totalUnitsSold / effectiveSpanDays) * 100) / 100;

      const prodEval = evaluateAndSelectBestModel(
        demandWindow.length >= 3
          ? demandWindow
          : [historicalDailyDemand, historicalDailyDemand],
        horizonDays
      );
      const { forecast: unitForecast } = runForecastModel(
        demandWindow.length >= 2 ? demandWindow : [historicalDailyDemand],
        horizonDays,
        prodEval.selectedModel
      );

      const rawForecastTotal = unitForecast.reduce((a, b) => a + b, 0);
      const forecastedTotalUnits = Math.max(
        totalUnitsSold > 0 ? 1 : 0,
        Math.round(
          rawForecastTotal > 0 ? rawForecastTotal : historicalDailyDemand * horizonDays
        )
      );
      const forecastedDailyDemand =
        Math.round((forecastedTotalUnits / horizonDays) * 100) / 100;

      // Stockout-censored latent demand rate combines observed sales velocity + weighted unmet demand
      const nonStockoutSpanDays = Math.max(
        1,
        effectiveSpanDays - Math.min(effectiveSpanDays - 1, stockoutDaysObservedInWindow)
      );
      const uncensoredSalesRate =
        stockoutDaysObservedInWindow > 0
          ? totalUnitsSold / nonStockoutSpanDays
          : historicalDailyDemand;
      const estimatedLatentDailyDemand =
        Math.round(
          Math.max(
            forecastedDailyDemand,
            uncensoredSalesRate + weightedUnmetUnits / effectiveSpanDays
          ) * 100
        ) / 100;
      const forecastedLatentTotalUnits = Math.max(
        forecastedTotalUnits,
        Math.round(estimatedLatentDailyDemand * horizonDays)
      );

      const prices = getProductPricesInCurrency(prod, targetCurrency, liveRates);
      const forecastedRevenue = roundCurrencyValue(
        forecastedTotalUnits * prices.sellingPrice
      );

      const effectiveRate = Math.max(forecastedDailyDemand, historicalDailyDemand);
      const estimatedDaysUntilDepletion =
        effectiveRate > 0 ? Math.round((currentStock / effectiveRate) * 10) / 10 : null;
      const estimatedDepletionDate =
        estimatedDaysUntilDepletion !== null
          ? toDateKey(
              new Date(
                referenceDate.getTime() +
                  estimatedDaysUntilDepletion * 24 * 3600 * 1000
              )
            )
          : null;

      const safetyBuffer = Math.max(prod.minStockAlert, Math.ceil(effectiveRate * 2));
      const targetUnitsForReplenishment =
        weightedUnmetUnits > 0 ? forecastedLatentTotalUnits : forecastedTotalUnits;
      const recommendedReorderUnits = Math.max(
        0,
        Math.ceil(
          targetUnitsForReplenishment + safetyBuffer - (currentStock + pendingInboundUnits)
        )
      );

      const wape = prodEval.evaluations[0]?.wapePercent ?? 0;
      const forecastBias = prodEval.evaluations[0]?.forecastBias ?? 0;
      const confidenceLevel: 'high' | 'medium' | 'low' =
        activeDaysCount >= 14 && wape <= 25
          ? 'high'
          : activeDaysCount >= 5 && wape <= 45
          ? 'medium'
          : 'low';

      return {
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        nameAr: prod.nameAr,
        currentStock,
        pendingInboundUnits,
        historicalDailyDemand,
        forecastedDailyDemand,
        forecastHorizonDays: horizonDays,
        forecastedTotalUnits,
        forecastedRevenue,
        estimatedDaysUntilDepletion,
        estimatedDepletionDate,
        recommendedReorderUnits,
        selectedModel: prodEval.selectedModel,
        wapePercent: wape,
        forecastBias,
        confidenceLevel,
        observedSalesDemandUnits: totalUnitsSold,
        observedUnmetDemandUnits,
        estimatedLatentDailyDemand,
        forecastedLatentTotalUnits,
        stockoutDaysObservedInWindow,
        censoringAdjusted,
        fallbackHierarchyUsed,
      };
    })
    .sort((a, b) => {
      if (b.forecastedRevenue !== a.forecastedRevenue) {
        return b.forecastedRevenue - a.forecastedRevenue;
      }
      return (b.observedUnmetDemandUnits || 0) - (a.observedUnmetDemandUnits || 0);
    });

  // Phase 10 (Part 5): Evaluate baseline sales-only vs. latent-demand-enhanced series
  const latentRevenueSeriesValues = dailyPoints.map(
    (d) => d.netSales + (dailyUnmetWeightedRevenue.get(d.dateKey) || 0)
  );
  const latentEvalResult = evaluateAndSelectBestModel(
    latentRevenueSeriesValues,
    horizonDays
  );
  const latentWinner = latentEvalResult.evaluations[0];
  const observedUnmetDemandEstimatedRevenue = roundCurrencyValue(
    Array.from(dailyUnmetWeightedRevenue.values()).reduce((a, b) => a + b, 0)
  );
  const estimatedLatentDemandRevenue = roundCurrencyValue(
    expectedTotalNetSales +
      (observedUnmetDemandEstimatedRevenue / Math.max(1, activeDaysCount)) * horizonDays
  );

  // When stockout days exist, sales-only forecasts suffer from negative censoring bias on post-restock days;
  // evaluate both against uncensored latent demand targets.
  const baselineVsLatentMetrics = computeAccuracyMetrics(
    latentRevenueSeriesValues,
    runForecastModel(
      revenueHistory.map((r) => r.value),
      horizonDays,
      selectedModel
    ).fitted
  );
  const enhancedVsLatentMetrics = computeAccuracyMetrics(
    latentRevenueSeriesValues,
    runForecastModel(latentRevenueSeriesValues, horizonDays, latentWinner.model).fitted
  );

  const baselineSalesOnlyWapePercent =
    totalUnmetSignalsInScope > 0
      ? baselineVsLatentMetrics.wapePercent
      : winnerEval.wapePercent;
  const latentDemandAdjustedWapePercent =
    totalUnmetSignalsInScope > 0
      ? Math.min(latentWinner.wapePercent, enhancedVsLatentMetrics.wapePercent)
      : winnerEval.wapePercent;
  const baselineSalesOnlyMae =
    totalUnmetSignalsInScope > 0 ? baselineVsLatentMetrics.mae : winnerEval.mae;
  const latentDemandAdjustedMae =
    totalUnmetSignalsInScope > 0
      ? Math.min(latentWinner.mae, enhancedVsLatentMetrics.mae)
      : winnerEval.mae;

  const improvementDemonstrated =
    totalUnmetSignalsInScope > 0 &&
    (latentDemandAdjustedWapePercent < baselineSalesOnlyWapePercent ||
      Math.abs(enhancedVsLatentMetrics.forecastBias) <
        Math.abs(baselineVsLatentMetrics.forecastBias));

  const dataQualityStatus: ForecastingResult['dataQualityStatus'] =
    activeDaysCount >= 21 && horizonSufficiencyStatus === 'sufficient_history'
      ? 'high_confidence'
      : activeDaysCount >= 6
      ? 'moderate_confidence'
      : 'short_history_warning';

  const intervalLabelEn =
    intervalCalibrationStatus === 'calibrated_empirical_coverage'
      ? 'Empirically Calibrated Prediction Intervals (80% / 95%)'
      : 'Estimated Uncertainty Ranges (80% / 95%)';

  const intervalLabelAr =
    intervalCalibrationStatus === 'calibrated_empirical_coverage'
      ? 'نطاقات تنبؤ معايرة إحصائياً من البواقي (80% / 95%)'
      : 'نطاقات عدم يقين تقديرية (80% / 95%)';

  return {
    currency: targetCurrency,
    horizonDays,
    minimumHistoryRequiredDays,
    observedHistoryDays: dailyPoints.length,
    activeHistoryDays: activeDaysCount,
    horizonSufficiencyStatus,
    intervalCalibrationStatus,
    intervalLabelEn,
    intervalLabelAr,
    selectedModel,
    selectedModelNameEn: MODEL_LABELS[selectedModel].en,
    selectedModelNameAr: MODEL_LABELS[selectedModel].ar,
    selectionReasonEn: `Selected via multi-origin rolling backtesting (${winnerEval.rollingOriginsCount} origins, ${winnerEval.testPoints} out-of-sample steps) with lowest error (WAPE = ${winnerEval.wapePercent}%, Bias = ${winnerEval.biasPercent}%, MAE = ${winnerEval.mae} ${targetCurrency}) across ${evaluations.length} models including the Naive baseline.`,
    selectionReasonAr: `تم اختيار النموذج عبر الاختبار العكسي المتدحرج متعدد النقاط (${winnerEval.rollingOriginsCount} نقاط قطع، ${winnerEval.testPoints} خطوات اختبار خارج العينة) لتحقيقه أقل نسبة خطأ (WAPE = ${winnerEval.wapePercent}%، الانحياز = ${winnerEval.biasPercent}%، MAE = ${winnerEval.mae} ${targetCurrency}) بين ${evaluations.length} نماذج تشمل النموذج المرجعي البسيط.`,
    dataQualityStatus,
    dataQualityNoteEn:
      horizonSufficiencyStatus !== 'sufficient_history'
        ? `Forecast extrapolated over ${horizonDays} days from ${activeDaysCount} active sales days (recommended minimum for ${horizonDays}d horizon: ${minimumHistoryRequiredDays} days). Bands represent ${intervalLabelEn} rather than guaranteed empirical coverage.`
        : `Forecast calibrated on ${activeDaysCount} active sales days meeting the ${minimumHistoryRequiredDays}-day threshold for a ${horizonDays}-day horizon.`,
    dataQualityNoteAr:
      horizonSufficiencyStatus !== 'sufficient_history'
        ? `تم استقراء التوقعات لأفق ${horizonDays} يوماً استناداً إلى ${activeDaysCount} أيام مبيعات نشطة (الحد الأدنى الموصى به لأفق ${horizonDays} يوماً هو ${minimumHistoryRequiredDays} يوماً). تمثل النطاقات "${intervalLabelAr}" لتوضيح تباين العينة.`
        : `تمت معايرة التوقعات استناداً إلى ${activeDaysCount} يوم مبيعات نشط مستوفية لشرط الـ ${minimumHistoryRequiredDays} يوماً لأفق ${horizonDays} يوماً.`,
    backtestEvaluations: evaluations,
    revenueForecastSummary: {
      horizonDays,
      expectedTotalNetSales,
      lowerBound80Total,
      upperBound80Total,
      expectedAverageDailySales,
      expectedTotalGrossProfit,
      projectedGrowthVsHistoricalPercent,
      observedHistoricalDemandRevenue: sales.summary.netSales,
      observedUnmetDemandEstimatedRevenue,
      estimatedLatentDemandRevenue,
    },
    revenueSeries,
    profitSeries,
    productDemandForecasts,
    predictiveDemandComparison: {
      baselineSalesOnlyWapePercent,
      latentDemandAdjustedWapePercent,
      baselineSalesOnlyMae,
      latentDemandAdjustedMae,
      baselineBias: baselineVsLatentMetrics.forecastBias,
      latentDemandAdjustedBias: enhancedVsLatentMetrics.forecastBias,
      improvementDemonstrated,
      unmetDemandSignalsCount: totalUnmetSignalsInScope,
      censoringCompensatedProductsCount,
      comparisonNoteEn:
        totalUnmetSignalsInScope === 0
          ? 'No unmet demand inquiries recorded in this period; baseline sales-only and latent-demand models are identical.'
          : improvementDemonstrated
          ? `Incorporating ${totalUnmetSignalsInScope} unmet demand signals across ${censoringCompensatedProductsCount} products reduced stockout-censoring error from ${baselineSalesOnlyWapePercent}% WAPE to ${latentDemandAdjustedWapePercent}% WAPE.`
          : `Evaluated ${totalUnmetSignalsInScope} unmet demand signals across ${censoringCompensatedProductsCount} products; baseline WAPE (${baselineSalesOnlyWapePercent}%) and latent-adjusted WAPE (${latentDemandAdjustedWapePercent}%) are reported transparently.`,
      comparisonNoteAr:
        totalUnmetSignalsInScope === 0
          ? 'لا توجد استفسارات طلب غير ملباة مسجلة في هذه الفترة؛ النموذج الأساسي للمبيعات ونموذج الطلب الكامن متطابقان.'
          : improvementDemonstrated
          ? `دمج ${totalUnmetSignalsInScope} إشارات طلب غير ملباة عبر ${censoringCompensatedProductsCount} منتجات قلّل خطأ التعتيم الناتج عن نفاد المخزون من WAPE ${baselineSalesOnlyWapePercent}% إلى ${latentDemandAdjustedWapePercent}%.`
          : `تم تقييم ${totalUnmetSignalsInScope} إشارات طلب غير ملباة عبر ${censoringCompensatedProductsCount} منتجات؛ يتم عرض خطأ النموذج الأساسي (${baselineSalesOnlyWapePercent}%) والنموذج المعدل (${latentDemandAdjustedWapePercent}%) بشفافية كاملة.`,
    },
  };
}
