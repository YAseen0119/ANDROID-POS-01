/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { roundCurrencyValue } from '../../lib/pos-calculations';
import {
  AnalyticsDatasetSnapshot,
  AnalyticsFilterParams,
  SalesAnalyticsResult,
  TechnicalIndicatorPoint,
  TechnicalIndicatorsResult,
  TechnicalSignalSummary,
} from '../analytics.types';
import { computeSalesAnalytics } from '../calculations/sales.metrics';

/**
 * Computes Simple Moving Average (SMA) for a numeric array over a given period N.
 * Returns null for indices < period - 1.
 */
export function computeSMA(values: number[], period: number): (number | null)[] {
  if (period <= 0) return values.map(() => null);
  const result: (number | null)[] = [];
  let windowSum = 0;

  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) {
      windowSum -= values[i - period];
    }
    if (i >= period - 1) {
      result.push(roundCurrencyValue(windowSum / period));
    } else {
      result.push(null);
    }
  }
  return result;
}

/**
 * Computes Exponential Moving Average (EMA) for a numeric array over a given period N.
 * Uses standard smoothing multiplier k = 2 / (period + 1), seeded with the initial N-period SMA.
 */
export function computeEMA(values: number[], period: number): (number | null)[] {
  if (period <= 0 || values.length < period) {
    return values.map(() => null);
  }
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sum += values[i];
      result.push(null);
    } else if (i === period - 1) {
      sum += values[i];
      const initialSma = sum / period;
      result.push(roundCurrencyValue(initialSma));
    } else {
      const prevEma = result[i - 1]!;
      const nextEma = values[i] * k + prevEma * (1 - k);
      result.push(roundCurrencyValue(nextEma));
    }
  }
  return result;
}

/**
 * Computes Wilder's Relative Strength Index (RSI) over a given period (standard: 14).
 * Requires at least period + 1 data points.
 */
export function computeRSI(values: number[], period: number = 14): (number | null)[] {
  if (period <= 0 || values.length < period + 1) {
    return values.map(() => null);
  }

  const result: (number | null)[] = new Array(values.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const calcRsiVal = (g: number, l: number): number => {
    if (l === 0 && g === 0) return 50;
    if (l === 0) return 100;
    const rs = g / l;
    return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
  };

  result[period] = calcRsiVal(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    result[i] = calcRsiVal(avgGain, avgLoss);
  }

  return result;
}

/**
 * Computes MACD (12, 26, 9):
 * - macdLine = EMA(12) - EMA(26)
 * - signalLine = EMA(9) of macdLine
 * - histogram = macdLine - signalLine
 */
export function computeMACD(
  values: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const emaFast = computeEMA(values, fastPeriod);
  const emaSlow = computeEMA(values, slowPeriod);

  const macdLine: (number | null)[] = [];
  const validMacdValues: number[] = [];
  const validMacdIndices: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      const m = roundCurrencyValue(emaFast[i]! - emaSlow[i]!);
      macdLine.push(m);
      validMacdValues.push(m);
      validMacdIndices.push(i);
    } else {
      macdLine.push(null);
    }
  }

  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  const histogram: (number | null)[] = new Array(values.length).fill(null);

  if (validMacdValues.length >= signalPeriod) {
    const rawSignal = computeEMA(validMacdValues, signalPeriod);
    for (let j = 0; j < validMacdValues.length; j++) {
      const origIdx = validMacdIndices[j];
      const sig = rawSignal[j];
      signalLine[origIdx] = sig;
      if (sig !== null && macdLine[origIdx] !== null) {
        histogram[origIdx] = roundCurrencyValue(macdLine[origIdx]! - sig);
      }
    }
  }

  return { macdLine, signalLine, histogram };
}

/**
 * Computes ordinary least-squares (OLS) linear regression trendline y = slope * x + intercept.
 */
export function computeLinearRegressionTrend(values: number[]): {
  slope: number;
  intercept: number;
  fittedValues: number[];
  direction: 'upward' | 'downward' | 'flat';
} {
  const n = values.length;
  if (n === 0) {
    return { slope: 0, intercept: 0, fittedValues: [], direction: 'flat' };
  }
  if (n === 1) {
    return { slope: 0, intercept: values[0], fittedValues: [values[0]], direction: 'flat' };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;

  const fittedValues = values.map((_, i) =>
    Math.max(0, roundCurrencyValue(slope * i + intercept))
  );

  const avgVal = sumY / n;
  const normalizedSlope = avgVal > 0 ? slope / avgVal : slope;
  const direction: 'upward' | 'downward' | 'flat' =
    normalizedSlope > 0.015 ? 'upward' : normalizedSlope < -0.015 ? 'downward' : 'flat';

  return {
    slope: roundCurrencyValue(slope),
    intercept: roundCurrencyValue(intercept),
    fittedValues,
    direction,
  };
}

/**
 * Computes historical Support (baseline floor, 20th percentile of active sales days)
 * and Resistance (peak ceiling, 85th percentile of active sales days).
 */
export function computeSupportAndResistance(values: number[]): {
  supportFloor: number;
  resistanceCeiling: number;
} {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    return { supportFloor: 0, resistanceCeiling: 0 };
  }
  if (nonZero.length === 1) {
    return { supportFloor: nonZero[0], resistanceCeiling: nonZero[0] };
  }

  const p20Idx = Math.max(0, Math.floor((nonZero.length - 1) * 0.2));
  const p85Idx = Math.min(nonZero.length - 1, Math.ceil((nonZero.length - 1) * 0.85));

  return {
    supportFloor: roundCurrencyValue(nonZero[p20Idx]),
    resistanceCeiling: roundCurrencyValue(nonZero[p85Idx]),
  };
}

/**
 * Computes the complete Technical Analysis suite adapted for Retail Business Data.
 */
export function computeTechnicalIndicators(
  dataset: AnalyticsDatasetSnapshot,
  filters: AnalyticsFilterParams,
  precomputedSales?: SalesAnalyticsResult,
  referenceDate: Date = new Date()
): TechnicalIndicatorsResult {
  const targetCurrency = filters.currency || 'SDG';
  const missingDateStrategy = filters.missingDateStrategy || 'zero_fill';
  const sales =
    precomputedSales || computeSalesAnalytics(dataset, filters, referenceDate);

  const rawDaily = sales.dailySeries;
  const activeDaily = rawDaily.filter((d) => d.netSales > 0 || d.transactionCount > 0);

  const effectiveDaily =
    missingDateStrategy === 'skip_missing' && activeDaily.length > 0
      ? activeDaily
      : rawDaily;

  const values = effectiveDaily.map((d) => d.netSales);

  const sma7Arr = computeSMA(values, 7);
  const sma30Arr = computeSMA(values, 30);
  const sma90Arr = computeSMA(values, 90);
  const ema7Arr = computeEMA(values, 7);
  const ema30Arr = computeEMA(values, 30);
  const rsi14Arr = computeRSI(values, 14);
  const rsi7Arr = computeRSI(values, 6);
  const macdObj = computeMACD(values, 12, 26, 9);
  const trendObj = computeLinearRegressionTrend(values);
  const srObj = computeSupportAndResistance(values);

  const series: TechnicalIndicatorPoint[] = effectiveDaily.map((d, i) => ({
    dateKey: d.dateKey,
    label: d.label,
    value: d.netSales,
    unitsSold: d.unitsSold,
    transactionCount: d.transactionCount,
    sma7: sma7Arr[i],
    sma30: sma30Arr[i],
    sma90: sma90Arr[i],
    ema7: ema7Arr[i],
    ema30: ema30Arr[i],
    rsi14: rsi14Arr[i] !== null ? rsi14Arr[i] : rsi7Arr[i],
    macdLine: macdObj.macdLine[i],
    macdSignal: macdObj.signalLine[i],
    macdHistogram: macdObj.histogram[i],
    trendlineValue: trendObj.fittedValues[i] ?? 0,
  }));

  const lastIdx = Math.max(0, series.length - 1);
  const latest = series[lastIdx];

  const latestSma7 = sma7Arr[lastIdx] ?? null;
  const latestSma30 = sma30Arr[lastIdx] ?? null;
  const latestSma90 = sma90Arr[lastIdx] ?? null;
  const latestEma7 = ema7Arr[lastIdx] ?? null;
  const latestEma30 = ema30Arr[lastIdx] ?? null;
  const latestRsi14 = rsi14Arr[lastIdx] ?? null;
  const latestRsiAdaptive7 = rsi7Arr[lastIdx] ?? null;
  const latestMacdLine = macdObj.macdLine[lastIdx] ?? null;
  const latestMacdSignal = macdObj.signalLine[lastIdx] ?? null;
  const latestMacdHist = macdObj.histogram[lastIdx] ?? null;

  // Momentum comparing recent 3 active days vs earlier active days
  const activeVals = activeDaily.map((d) => d.netSales);
  let momentumPercent = 0;
  if (activeVals.length >= 2) {
    const split = Math.max(1, Math.floor(activeVals.length / 2));
    const earlyAvg =
      activeVals.slice(0, split).reduce((a, b) => a + b, 0) / split;
    const recentAvg =
      activeVals.slice(split).reduce((a, b) => a + b, 0) /
      Math.max(1, activeVals.length - split);
    momentumPercent =
      earlyAvg > 0 ? Math.round(((recentAvg - earlyAvg) / earlyAvg) * 1000) / 10 : 0;
  }

  const signals: TechnicalSignalSummary[] = [];

  // 1. SMA / EMA Crossover Signal
  if (latestEma7 !== null && latestSma7 !== null) {
    const isBullish = latestEma7 >= latestSma7;
    signals.push({
      indicator: 'SMA_EMA_CROSS',
      nameEn: 'Short-Term Moving Average Crossover (EMA 7 vs SMA 7)',
      nameAr: 'تقاطع المتوسطات المتحركة قصيرة الأجل (EMA 7 مقابل SMA 7)',
      status: isBullish ? 'bullish_expansion' : 'bearish_contraction',
      currentValue: latestEma7,
      referenceThreshold: `SMA(7) = ${latestSma7}`,
      interpretationEn: isBullish
        ? `7-day Exponential Moving Average (${latestEma7}) is above or equal to the 7-day Simple Moving Average (${latestSma7}), indicating accelerating recent daily sales.`
        : `7-day Exponential Moving Average (${latestEma7}) is below the 7-day Simple Moving Average (${latestSma7}), indicating a short-term cooling in daily sales pace.`,
      interpretationAr: isBullish
        ? `المتوسط المتحرك الأسي لـ 7 أيام (${latestEma7}) أعلى من أو يساوي المتوسط البسيط (${latestSma7})، مما يشير إلى تسارع إيجابي في المبيعات اليومية الأخيرة.`
        : `المتوسط المتحرك الأسي لـ 7 أيام (${latestEma7}) أقل من المتوسط البسيط (${latestSma7})، مما يشير إلى تباطؤ قصير الأجل في وتيرة المبيعات.`,
      dataPointsUsed: values.length,
      minimumPointsRequired: 7,
    });
  } else {
    signals.push({
      indicator: 'SMA_EMA_CROSS',
      nameEn: 'Short-Term Moving Average Crossover (EMA 7 vs SMA 7)',
      nameAr: 'تقاطع المتوسطات المتحركة قصيرة الأجل (EMA 7 مقابل SMA 7)',
      status: 'insufficient_data',
      currentValue: null,
      referenceThreshold: '7 days required',
      interpretationEn: `At least 7 daily points are required to compute 7-day moving averages (currently ${values.length} points).`,
      interpretationAr: `يلزم توفر 7 أيام على الأقل لاحتساب المتوسط المتحرك لـ 7 أيام (المتوفر حالياً ${values.length} أيام).`,
      dataPointsUsed: values.length,
      minimumPointsRequired: 7,
    });
  }

  // 2. RSI Signal
  const effectiveRsi = latestRsi14 !== null ? latestRsi14 : latestRsiAdaptive7;
  if (effectiveRsi !== null) {
    const isOverbought = effectiveRsi >= 70;
    const isOversold = effectiveRsi <= 30;
    const status: TechnicalSignalSummary['status'] = isOverbought
      ? 'overbought_peak'
      : isOversold
      ? 'oversold_dip'
      : effectiveRsi >= 52
      ? 'bullish_expansion'
      : 'neutral_consolidation';

    signals.push({
      indicator: 'RSI_14',
      nameEn:
        latestRsi14 !== null
          ? 'Retail Sales Momentum Index (RSI 14)'
          : 'Adaptive Sales Momentum Index (RSI 7)',
      nameAr:
        latestRsi14 !== null
          ? 'مؤشر القوة النسبية لزخم المبيعات (RSI 14)'
          : 'مؤشر القوة النسبية التكيفي لزخم المبيعات (RSI 7)',
      status,
      currentValue: effectiveRsi,
      referenceThreshold: '30 (Oversold Dip) – 70 (Demand Surge Peak)',
      interpretationEn: isOverbought
        ? `RSI is at ${effectiveRsi} (>70), signaling an unusually strong demand surge. Ensure fast-moving stock is replenished to prevent stockouts.`
        : isOversold
        ? `RSI is at ${effectiveRsi} (<30), signaling a pronounced sales slowdown compared to recent norms. Consider promotional bundles.`
        : `RSI is at ${effectiveRsi} (balanced 30–70 zone), reflecting steady, sustainable daily demand.`,
      interpretationAr: isOverbought
        ? `مؤشر القوة النسبية عند ${effectiveRsi} (>70)، مما يدل على ذروة طلب قوية غير معتادة. تأكد من تعزيز مخزون الأصناف السريعة لتجنب النفاد.`
        : isOversold
        ? `مؤشر القوة النسبية عند ${effectiveRsi} (<30)، مما يشير إلى هدوء ملحوظ في المبيعات مقارنة بالمعدلات السابقة. يُنصح بتنشيط العروض الترويجية.`
        : `مؤشر القوة النسبية عند ${effectiveRsi} (ضمن النطاق المتوازن 30–70)، مما يعكس استقراراً طبيعياً في الطلب اليومي.`,
      dataPointsUsed: values.length,
      minimumPointsRequired: latestRsi14 !== null ? 15 : 7,
    });
  } else {
    signals.push({
      indicator: 'RSI_14',
      nameEn: 'Retail Sales Momentum Index (RSI 14)',
      nameAr: 'مؤشر القوة النسبية لزخم المبيعات (RSI 14)',
      status: 'insufficient_data',
      currentValue: null,
      referenceThreshold: '15 days required',
      interpretationEn:
        'Select at least a 14-day or 30-day window to compute Relative Strength Index (RSI).',
      interpretationAr:
        'يرجى اختيار نطاق زمني 14 أو 30 يوماً على الأقل لاحتساب مؤشر القوة النسبية (RSI).',
      dataPointsUsed: values.length,
      minimumPointsRequired: 15,
    });
  }

  // 3. MACD (12, 26, 9) Signal
  if (latestMacdLine !== null && latestMacdSignal !== null) {
    const isBullish = (latestMacdHist ?? 0) >= 0;
    signals.push({
      indicator: 'MACD_12_26_9',
      nameEn: 'MACD Trend Acceleration (12, 26, 9)',
      nameAr: 'مؤشر تقارب وتباعد المتوسطات (MACD 12, 26, 9)',
      status: isBullish ? 'bullish_expansion' : 'bearish_contraction',
      currentValue: latestMacdHist,
      referenceThreshold: `MACD=${latestMacdLine}, Signal=${latestMacdSignal}`,
      interpretationEn: isBullish
        ? `MACD Histogram is positive (${latestMacdHist}), showing medium-term sales momentum is expanding faster than the 26-day baseline.`
        : `MACD Histogram is negative (${latestMacdHist}), indicating recent 12-day sales pace is trailing the 26-day trend.`,
      interpretationAr: isBullish
        ? `مدرج MACD إيجابي (${latestMacdHist})، مما يوضح أن زخم المبيعات متوسط الأجل ينمو أسرع من خط الأساس لـ 26 يوماً.`
        : `مدرج MACD سلبي (${latestMacdHist})، مما يشير إلى أن وتيرة المبيعات لآخر 12 يوماً أقل من متوسط 26 يوماً.`,
      dataPointsUsed: values.length,
      minimumPointsRequired: 34,
    });
  } else {
    signals.push({
      indicator: 'MACD_12_26_9',
      nameEn: 'MACD Trend Acceleration (12, 26, 9)',
      nameAr: 'مؤشر تقارب وتباعد المتوسطات (MACD 12, 26, 9)',
      status: 'insufficient_data',
      currentValue: latestMacdLine,
      referenceThreshold: '34 daily points required for full Signal(9)',
      interpretationEn: `MACD (12,26,9) requires at least 34 daily points (26 slow EMA + 9 signal EMA). Switch the Date Filter to 90 Days to view the full MACD Signal & Histogram.`,
      interpretationAr: `يتطلب مؤشر MACD (12,26,9) الكامل 34 نقطة يومية على الأقل (26 يوم للمتوسط البطيء + 9 أيام لخط الإشارة). اختر نطاق 90 يوماً لعرض إشارة ومدرج MACD الكامل.`,
      dataPointsUsed: values.length,
      minimumPointsRequired: 34,
    });
  }

  // 4. Linear Regression Trendline Signal
  signals.push({
    indicator: 'LINEAR_TREND',
    nameEn: 'Least-Squares Linear Regression Trendline',
    nameAr: 'خط الاتجاه العام للانحدار الخطي',
    status:
      trendObj.direction === 'upward'
        ? 'bullish_expansion'
        : trendObj.direction === 'downward'
        ? 'bearish_contraction'
        : 'neutral_consolidation',
    currentValue: trendObj.slope,
    referenceThreshold: '0.00 / day slope',
    interpretationEn:
      trendObj.direction === 'upward'
        ? `Sales trendline is sloping upward at +${trendObj.slope} ${targetCurrency}/day across the selected window.`
        : trendObj.direction === 'downward'
        ? `Sales trendline is sloping downward at ${trendObj.slope} ${targetCurrency}/day across the selected window.`
        : `Sales trendline is stable (${trendObj.slope} ${targetCurrency}/day) across the selected window.`,
    interpretationAr:
      trendObj.direction === 'upward'
        ? `خط الاتجاه العام للمبيعات صاعد بمعدل +${trendObj.slope} ${targetCurrency}/يوم خلال الفترة المحددة.`
        : trendObj.direction === 'downward'
        ? `خط الاتجاه العام للمبيعات هابط بمعدل ${trendObj.slope} ${targetCurrency}/يوم خلال الفترة المحددة.`
        : `خط الاتجاه العام للمبيعات مستقر (${trendObj.slope} ${targetCurrency}/يوم) خلال الفترة المحددة.`,
    dataPointsUsed: values.length,
    minimumPointsRequired: 2,
  });

  // 5. Support & Resistance Zone Signal
  signals.push({
    indicator: 'SUPPORT_RESISTANCE',
    nameEn: 'Historical Sales Support Floor & Resistance Ceiling',
    nameAr: 'مستويات الدعم (الحد الأدنى المعتاد) والمقاومة (ذروة المبيعات)',
    status:
      (latest?.value ?? 0) >= srObj.resistanceCeiling && srObj.resistanceCeiling > 0
        ? 'overbought_peak'
        : 'neutral_consolidation',
    currentValue: latest?.value ?? 0,
    referenceThreshold: `Support: ${srObj.supportFloor} | Resistance: ${srObj.resistanceCeiling}`,
    interpretationEn: `Active daily revenue typically holds above the ${srObj.supportFloor} ${targetCurrency} support floor and tests peak capacity near ${srObj.resistanceCeiling} ${targetCurrency}.`,
    interpretationAr: `تستقر المبيعات اليومية النشطة عادة فوق مستوى الدعم (${srObj.supportFloor} ${targetCurrency}) وتختبر سقف الذروة عند (${srObj.resistanceCeiling} ${targetCurrency}).`,
    dataPointsUsed: activeDaily.length,
    minimumPointsRequired: 2,
  });

  return {
    currency: targetCurrency,
    targetMetric: 'net_sales',
    missingDateStrategy,
    calendarDaysCount: rawDaily.length,
    activeSalesDaysCount: activeDaily.length,
    dataSufficiencyNoteEn:
      activeDaily.length < 14
        ? `Dataset contains ${activeDaily.length} active sales days across a ${rawDaily.length}-day calendar window. Open calendar days without transactions are zero-filled (${missingDateStrategy}).`
        : `Dataset contains ${activeDaily.length} active sales days across ${rawDaily.length} calendar days.`,
    dataSufficiencyNoteAr:
      activeDaily.length < 14
        ? `تحتوي البيانات على ${activeDaily.length} أيام مبيعات نشطة ضمن نافذة تقويمية مدتها ${rawDaily.length} يوماً. يتم تعبئة الأيام الخالية من الفواتير بقيمة صفر (${missingDateStrategy}).`
        : `تحتوي البيانات على ${activeDaily.length} أيام مبيعات نشطة ضمن ${rawDaily.length} يوماً تقويمياً.`,
    latestValues: {
      currentValue: latest?.value ?? 0,
      sma7: latestSma7,
      sma30: latestSma30,
      sma90: latestSma90,
      ema7: latestEma7,
      ema30: latestEma30,
      rsi14: latestRsi14,
      rsiAdaptive7: latestRsiAdaptive7,
      macdLine: latestMacdLine,
      macdSignal: latestMacdSignal,
      macdHistogram: latestMacdHist,
      trendSlopePerDay: trendObj.slope,
      trendDirection: trendObj.direction,
      supportFloor: srObj.supportFloor,
      resistanceCeiling: srObj.resistanceCeiling,
      momentumPercent,
    },
    signals,
    series,
    intradayCandlesticks: sales.intradayCandlesticks,
  };
}
