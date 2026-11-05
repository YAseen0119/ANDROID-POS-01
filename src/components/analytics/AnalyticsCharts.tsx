/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { formatCurrency } from '../../lib/pos-calculations';
import { AppLanguage, SupportedCurrency } from '../../lib/types';
import {
  DailyIntradayCandlestick,
  ForecastPoint,
  ProductInventoryAnalyticsItem,
  TechnicalIndicatorPoint,
} from '../../analytics/analytics.types';

interface TechnicalTrendOverlayChartProps {
  series: TechnicalIndicatorPoint[];
  supportFloor: number;
  resistanceCeiling: number;
  currency: SupportedCurrency;
  language: AppLanguage;
}

export function TechnicalTrendOverlayChart({
  series,
  supportFloor,
  resistanceCeiling,
  currency,
  language,
}: TechnicalTrendOverlayChartProps) {
  const isAr = language === 'ar';
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!series || series.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-xs text-slate-400">
        {isAr ? 'لا توجد بيانات زمنية كافية للرسم البياني' : 'Insufficient time-series data for chart'}
      </div>
    );
  }

  const width = 760;
  const height = 250;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allVals = series.flatMap((p) =>
    [p.value, p.sma7, p.ema7, p.trendlineValue, supportFloor, resistanceCeiling].filter(
      (v): v is number => v !== null && Number.isFinite(v)
    )
  );
  const maxVal = Math.max(10, ...allVals) * 1.12;

  const xAt = (i: number) =>
    series.length <= 1
      ? padLeft + plotW / 2
      : padLeft + (i / (series.length - 1)) * plotW;
  const yAt = (v: number) => padTop + plotH - Math.min(1, Math.max(0, v / maxVal)) * plotH;

  const buildPath = (getter: (p: TechnicalIndicatorPoint) => number | null) => {
    const segments: string[] = [];
    let started = false;
    series.forEach((pt, idx) => {
      const val = getter(pt);
      if (val === null || !Number.isFinite(val)) {
        started = false;
        return;
      }
      const x = xAt(idx).toFixed(1);
      const y = yAt(val).toFixed(1);
      segments.push(`${started ? 'L' : 'M'} ${x} ${y}`);
      started = true;
    });
    return segments.join(' ');
  };

  const mainLinePath = buildPath((p) => p.value);
  const areaPath =
    mainLinePath.length > 0
      ? `${mainLinePath} L ${xAt(series.length - 1).toFixed(1)} ${(padTop + plotH).toFixed(
          1
        )} L ${xAt(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : '';
  const sma7Path = buildPath((p) => p.sma7);
  const ema7Path = buildPath((p) => p.ema7);
  const trendPath = buildPath((p) => p.trendlineValue);

  const activePoint = hoverIdx !== null && series[hoverIdx] ? series[hoverIdx] : series[series.length - 1];

  return (
    <div className="space-y-2.5">
      {/* Legend & Live Readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-500">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            {isAr ? 'صافي المبيعات اليومي' : 'Daily Net Sales'}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" />
            SMA(7)
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-sky-400">
            <span className="w-3 h-0.5 bg-sky-400 inline-block" />
            EMA(7)
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-fuchsia-400">
            <span className="w-3 h-0.5 border-b border-dashed border-fuchsia-400 inline-block" />
            {isAr ? 'خط الاتجاه (Regression)' : 'Linear Trendline'}
          </span>
        </div>
        {activePoint && (
          <div className="px-2.5 py-1 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-200 font-mono text-[11px] flex items-center gap-3">
            <span className="text-slate-400">{activePoint.dateKey}</span>
            <span className="text-emerald-400 font-bold">
              {formatCurrency(activePoint.value, currency, language)}
            </span>
            {activePoint.sma7 !== null && (
              <span className="text-amber-300">SMA7: {activePoint.sma7}</span>
            )}
            {activePoint.ema7 !== null && (
              <span className="text-sky-300">EMA7: {activePoint.ema7}</span>
            )}
          </div>
        )}
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-60 select-none overflow-visible"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="biTechAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Y gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const val = maxVal * ratio;
            const y = yAt(val);
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-700/30"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[9px] font-mono"
                >
                  {Math.round(val)}
                </text>
              </g>
            );
          })}

          {/* Support & Resistance Zones */}
          {resistanceCeiling > 0 && (
            <g>
              <line
                x1={padLeft}
                y1={yAt(resistanceCeiling)}
                x2={width - padRight}
                y2={yAt(resistanceCeiling)}
                stroke="#f43f5e"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <text
                x={width - padRight - 4}
                y={yAt(resistanceCeiling) - 4}
                textAnchor="end"
                className="fill-rose-400 text-[9px] font-mono"
              >
                {isAr ? `مقاومة/ذروة ${resistanceCeiling}` : `Resistance ${resistanceCeiling}`}
              </text>
            </g>
          )}

          {supportFloor > 0 && (
            <g>
              <line
                x1={padLeft}
                y1={yAt(supportFloor)}
                x2={width - padRight}
                y2={yAt(supportFloor)}
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.65"
              />
              <text
                x={width - padRight - 4}
                y={yAt(supportFloor) - 4}
                textAnchor="end"
                className="fill-sky-400 text-[9px] font-mono"
              >
                {isAr ? `دعم ${supportFloor}` : `Support ${supportFloor}`}
              </text>
            </g>
          )}

          {/* Area & Lines */}
          {areaPath && <path d={areaPath} fill="url(#biTechAreaGrad)" />}
          {trendPath && (
            <path
              d={trendPath}
              fill="none"
              stroke="#e879f9"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          )}
          {sma7Path && (
            <path d={sma7Path} fill="none" stroke="#fbbf24" strokeWidth="2" />
          )}
          {ema7Path && (
            <path d={ema7Path} fill="none" stroke="#38bdf8" strokeWidth="2" />
          )}
          {mainLinePath && (
            <path d={mainLinePath} fill="none" stroke="#10b981" strokeWidth="2.5" />
          )}

          {/* Data Points & Interactive Hit Columns */}
          {series.map((pt, i) => {
            const cx = xAt(i);
            const cy = yAt(pt.value);
            const isHovered = hoverIdx === i;
            const showTick =
              series.length <= 12 ||
              i === 0 ||
              i === series.length - 1 ||
              i % Math.ceil(series.length / 8) === 0;

            return (
              <g key={pt.dateKey}>
                {isHovered && (
                  <line
                    x1={cx}
                    y1={padTop}
                    x2={cx}
                    y2={padTop + plotH}
                    stroke="#10b981"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 5 : pt.value > 0 ? 3 : 2}
                  className={
                    pt.value > 0
                      ? 'fill-emerald-400 stroke-slate-950 stroke-2'
                      : 'fill-slate-600'
                  }
                />
                {showTick && (
                  <text
                    x={cx}
                    y={height - 10}
                    textAnchor="middle"
                    className="fill-slate-400 text-[9px] font-mono"
                  >
                    {pt.label}
                  </text>
                )}
                <rect
                  x={cx - plotW / Math.max(2, series.length) / 2}
                  y={padTop}
                  width={plotW / Math.max(1, series.length)}
                  height={plotH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverIdx(i)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

interface IntradayCandlestickChartProps {
  candles: DailyIntradayCandlestick[];
  currency: SupportedCurrency;
  language: AppLanguage;
}

export function IntradayCandlestickChart({
  candles,
  currency,
  language,
}: IntradayCandlestickChartProps) {
  const isAr = language === 'ar';
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visibleCandles = candles.length > 14 ? candles.slice(-14) : candles;
  if (visibleCandles.length === 0) {
    return null;
  }

  const width = 760;
  const height = 220;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxHigh = Math.max(
    10,
    ...visibleCandles.map((c) => Math.max(c.high, c.dailyTotalSales))
  ) * 1.1;

  const yAt = (v: number) =>
    padTop + plotH - Math.min(1, Math.max(0, v / maxHigh)) * plotH;

  const stepW = plotW / Math.max(1, visibleCandles.length);
  const candleW = Math.max(8, Math.min(26, stepW * 0.48));

  const active =
    hoverIdx !== null && visibleCandles[hoverIdx]
      ? visibleCandles[hoverIdx]
      : visibleCandles[visibleCandles.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            {isAr ? 'إغلاق أعلى من الافتتاح (زخم مسائي)' : 'Close ≥ Open (Strong Closing Hour)'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
            {isAr ? 'افتتاح أعلى من الإغلاق (ذروة صباحية)' : 'Open > Close (Morning Front-Loaded)'}
          </span>
        </div>
        {active && (
          <div className="px-2.5 py-1 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] font-mono text-slate-200 flex flex-wrap items-center gap-2.5">
            <span className="text-slate-400">{active.dateKey}</span>
            <span>O: {active.open}</span>
            <span className="text-emerald-400">H: {active.high}</span>
            <span className="text-rose-400">L: {active.low}</span>
            <span className="text-sky-400">C: {active.close}</span>
            <span className="text-amber-300 font-bold">
              {isAr ? 'الإجمالي:' : 'Total:'}{' '}
              {formatCurrency(active.dailyTotalSales, currency, language)}
            </span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-52 select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.5, 1].map((r) => {
          const val = maxHigh * r;
          const y = yAt(val);
          return (
            <g key={r}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="currentColor"
                className="text-slate-700/30"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[9px] font-mono"
              >
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {visibleCandles.map((c, idx) => {
          const cx = padLeft + idx * stepW + stepW / 2;
          const isBull = c.close >= c.open;
          const color = c.dailyTotalSales === 0 ? '#475569' : isBull ? '#10b981' : '#f59e0b';
          const yHigh = yAt(c.high);
          const yLow = yAt(c.low);
          const yOpen = yAt(c.open);
          const yClose = yAt(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(3, Math.abs(yClose - yOpen));
          const yTotal = yAt(c.dailyTotalSales);

          return (
            <g
              key={c.dateKey}
              className="cursor-pointer"
              onMouseEnter={() => setHoverIdx(idx)}
            >
              {/* Daily Total translucent bar */}
              {c.dailyTotalSales > 0 && (
                <rect
                  x={cx - candleW * 0.7}
                  y={yTotal}
                  width={candleW * 1.4}
                  height={Math.max(2, padTop + plotH - yTotal)}
                  rx={2}
                  fill={color}
                  opacity={0.14}
                />
              )}
              {/* High-Low Wick */}
              {c.high > 0 && (
                <line
                  x1={cx}
                  y1={yHigh}
                  x2={cx}
                  y2={yLow}
                  stroke={color}
                  strokeWidth="2"
                />
              )}
              {/* Open-Close Body */}
              <rect
                x={cx - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyHeight}
                rx={2}
                fill={color}
              />
              <text
                x={cx}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-400 text-[9px] font-mono"
              >
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface StatisticalForecastFanChartProps {
  series: ForecastPoint[];
  currency: SupportedCurrency;
  language: AppLanguage;
}

export function StatisticalForecastFanChart({
  series,
  currency,
  language,
}: StatisticalForecastFanChartProps) {
  const isAr = language === 'ar';
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!series || series.length === 0) return null;

  const width = 760;
  const height = 250;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal =
    Math.max(
      10,
      ...series.map((p) =>
        Math.max(
          p.actualValue ?? 0,
          p.fittedOrForecastValue,
          p.upperBound95 ?? 0
        )
      )
    ) * 1.1;

  const xAt = (i: number) =>
    series.length <= 1
      ? padLeft + plotW / 2
      : padLeft + (i / (series.length - 1)) * plotW;
  const yAt = (v: number) =>
    padTop + plotH - Math.min(1, Math.max(0, v / maxVal)) * plotH;

  // Build 95% and 80% fan polygons for forecast points
  const forecastIndices = series
    .map((p, idx) => (!p.isHistorical ? idx : -1))
    .filter((idx) => idx >= 0);

  let band95Path = '';
  let band80Path = '';
  if (forecastIndices.length > 1) {
    const upper95Pts = forecastIndices.map(
      (i) => `${xAt(i).toFixed(1)},${yAt(series[i].upperBound95 ?? series[i].fittedOrForecastValue).toFixed(1)}`
    );
    const lower95Pts = [...forecastIndices]
      .reverse()
      .map(
        (i) => `${xAt(i).toFixed(1)},${yAt(series[i].lowerBound95 ?? 0).toFixed(1)}`
      );
    band95Path = `M ${upper95Pts.join(' L ')} L ${lower95Pts.join(' L ')} Z`;

    const upper80Pts = forecastIndices.map(
      (i) => `${xAt(i).toFixed(1)},${yAt(series[i].upperBound80 ?? series[i].fittedOrForecastValue).toFixed(1)}`
    );
    const lower80Pts = [...forecastIndices]
      .reverse()
      .map(
        (i) => `${xAt(i).toFixed(1)},${yAt(series[i].lowerBound80 ?? 0).toFixed(1)}`
      );
    band80Path = `M ${upper80Pts.join(' L ')} L ${lower80Pts.join(' L ')} Z`;
  }

  // Historical actual path
  const histPts = series
    .map((p, i) =>
      p.isHistorical && p.actualValue !== null
        ? `${xAt(i).toFixed(1)},${yAt(p.actualValue).toFixed(1)}`
        : null
    )
    .filter(Boolean);
  const actualPath = histPts.length > 0 ? `M ${histPts.join(' L ')}` : '';

  // Fitted + Forecast continuous path
  const modelPts = series.map(
    (p, i) => `${xAt(i).toFixed(1)},${yAt(p.fittedOrForecastValue).toFixed(1)}`
  );
  const modelPath = modelPts.length > 0 ? `M ${modelPts.join(' L ')}` : '';

  const splitIdx = series.findIndex((p) => !p.isHistorical);
  const active =
    hoverIdx !== null && series[hoverIdx] ? series[hoverIdx] : series[series.length - 1];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            {isAr ? 'المبيعات الفعلية التاريخية' : 'Historical Actuals'}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" />
            {isAr ? 'مسار التنبؤ الإحصائي' : 'Statistical Forecast'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-300/80">
            <span className="w-3 h-2 rounded-sm bg-amber-500/30 inline-block" />
            {isAr
              ? 'نطاقات عدم يقين تقديرية (80% / 95%)'
              : '80% & 95% Estimated Uncertainty Ranges'}
          </span>
        </div>
        {active && (
          <div className="px-2.5 py-1 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] font-mono text-slate-200 flex items-center gap-3">
            <span className="text-slate-400">{active.dateKey}</span>
            {active.isHistorical ? (
              <span className="text-emerald-400 font-bold">
                {isAr ? 'فعلي:' : 'Actual:'}{' '}
                {formatCurrency(active.actualValue ?? 0, currency, language)}
              </span>
            ) : (
              <>
                <span className="text-amber-400 font-bold">
                  {isAr ? 'متوقع:' : 'Forecast:'}{' '}
                  {formatCurrency(active.fittedOrForecastValue, currency, language)}
                </span>
                <span className="text-slate-400">
                  80%: [{active.lowerBound80} – {active.upperBound80}]
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-60 select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const val = maxVal * r;
          const y = yAt(val);
          return (
            <g key={r}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="currentColor"
                className="text-slate-700/30"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[9px] font-mono"
              >
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* Forecast horizon divider */}
        {splitIdx > 0 && (
          <g>
            <line
              x1={xAt(splitIdx)}
              y1={padTop}
              x2={xAt(splitIdx)}
              y2={padTop + plotH}
              stroke="#fbbf24"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text
              x={xAt(splitIdx) + 6}
              y={padTop + 10}
              className="fill-amber-400 text-[9px] font-semibold"
            >
              {isAr ? 'بداية التوقعات المستقبلية ←' : 'Forecast Horizon →'}
            </text>
          </g>
        )}

        {/* Confidence Bands */}
        {band95Path && <path d={band95Path} fill="#f59e0b" opacity="0.12" />}
        {band80Path && <path d={band80Path} fill="#f59e0b" opacity="0.22" />}

        {/* Model Fit + Forecast Line */}
        {modelPath && (
          <path
            d={modelPath}
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2"
            strokeDasharray="5 3"
          />
        )}

        {/* Historical Actual Line */}
        {actualPath && (
          <path d={actualPath} fill="none" stroke="#10b981" strokeWidth="2.5" />
        )}

        {series.map((pt, i) => {
          const cx = xAt(i);
          const cy = yAt(
            pt.isHistorical && pt.actualValue !== null
              ? pt.actualValue
              : pt.fittedOrForecastValue
          );
          const showTick =
            series.length <= 14 ||
            i === 0 ||
            i === series.length - 1 ||
            i % Math.ceil(series.length / 8) === 0;

          return (
            <g key={`${pt.dateKey}-${i}`}>
              <circle
                cx={cx}
                cy={cy}
                r={hoverIdx === i ? 4.5 : 2.5}
                fill={pt.isHistorical ? '#10b981' : '#fbbf24'}
              />
              {showTick && (
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-slate-400 text-[9px] font-mono"
                >
                  {pt.label}
                </text>
              )}
              <rect
                x={cx - plotW / Math.max(2, series.length) / 2}
                y={padTop}
                width={plotW / Math.max(1, series.length)}
                height={plotH}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface AbcParetoChartProps {
  products: ProductInventoryAnalyticsItem[];
  language: AppLanguage;
}

export function AbcParetoChart({ products, language }: AbcParetoChartProps) {
  const isAr = language === 'ar';
  const topItems = products.slice(0, 10);
  if (topItems.length === 0) return null;

  const width = 760;
  const height = 210;
  const padLeft = 48;
  const padRight = 48;
  const padTop = 18;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxBasis = Math.max(1, ...topItems.map((p) => p.abcBasisValue));
  const stepW = plotW / topItems.length;
  const barW = Math.max(14, Math.min(38, stepW * 0.55));

  const yVal = (v: number) => padTop + plotH - (v / maxBasis) * plotH;
  const yPct = (pct: number) => padTop + plotH - (Math.min(100, Math.max(0, pct)) / 100) * plotH;

  const paretoPts = topItems.map(
    (p, i) =>
      `${(padLeft + i * stepW + stepW / 2).toFixed(1)},${yPct(
        p.abcCumulativeSharePercent
      ).toFixed(1)}`
  );
  const paretoPath = paretoPts.length > 0 ? `M ${paretoPts.join(' L ')}` : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-52 select-none">
      {/* 80% Pareto cutoff line */}
      <line
        x1={padLeft}
        y1={yPct(80)}
        x2={width - padRight}
        y2={yPct(80)}
        stroke="#10b981"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.6"
      />
      <text
        x={width - padRight + 4}
        y={yPct(80) + 3}
        className="fill-emerald-400 text-[9px] font-mono"
      >
        80%
      </text>

      {topItems.map((item, i) => {
        const cx = padLeft + i * stepW + stepW / 2;
        const bh = Math.max(3, (item.abcBasisValue / maxBasis) * plotH);
        const by = padTop + plotH - bh;
        const fill =
          item.abcClass === 'A'
            ? '#10b981'
            : item.abcClass === 'B'
            ? '#f59e0b'
            : '#64748b';

        return (
          <g key={item.productId}>
            <rect
              x={cx - barW / 2}
              y={by}
              width={barW}
              height={bh}
              rx={4}
              fill={fill}
              opacity={0.85}
            />
            <text
              x={cx}
              y={by - 4}
              textAnchor="middle"
              className="fill-slate-300 text-[9px] font-mono font-bold"
            >
              {item.abcClass}
            </text>
            <text
              x={cx}
              y={height - 12}
              textAnchor="middle"
              className="fill-slate-400 text-[9px] font-mono"
            >
              {item.sku}
            </text>
          </g>
        );
      })}

      {paretoPath && (
        <path d={paretoPath} fill="none" stroke="#38bdf8" strokeWidth="2" />
      )}
      {topItems.map((item, i) => {
        const cx = padLeft + i * stepW + stepW / 2;
        const cy = yPct(item.abcCumulativeSharePercent);
        return (
          <circle
            key={`pt-${item.productId}`}
            cx={cx}
            cy={cy}
            r={3.5}
            fill="#38bdf8"
          />
        );
      })}
      <text
        x={padLeft}
        y={12}
        className="fill-sky-400 text-[10px] font-semibold"
      >
        {isAr
          ? 'الأعمدة: قيمة مساهمة الصنف (A/B/C) • الخط الأزرق: النسبة التراكمية لباريتو %'
          : 'Bars: SKU Value Contribution (Class A/B/C) • Blue Curve: Cumulative Pareto Share %'}
      </text>
    </svg>
  );
}
