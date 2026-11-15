// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HistogramBin, HistogramResult, IndexedDataset, RegressionResult, VariableStats } from "./types.js";

/**
 * Returns true if `value` is a finite number and not equal to an optional sentinel null value.
 */
export function isValidSample(value: unknown, nullValue?: number): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (nullValue !== undefined && Number.isFinite(nullValue) && Math.abs(value - nullValue) <= 1e-9) {
    return false;
  }
  return true;
}

/**
 * Computes linear percentile on an already sorted numeric array using linear interpolation.
 */
function sortedPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function emptyStats(name: string, unit?: string): VariableStats {
  return {
    name,
    ...(unit !== undefined ? { unit } : {}),
    count: 0,
    min: 0,
    max: 0,
    mean: 0,
    rms: 0,
    stddev: 0,
    final: 0,
    p10: 0,
    p50: 0,
    p90: 0,
  };
}

/**
 * Core single-pass + percentile statistics calculator over `(index, value)` pairs.
 */
function computeSeriesStatsCore(
  name: string,
  length: number,
  getIndex: (i: number) => number,
  getValue: (i: number) => unknown,
  nullValue?: number,
  unit?: string,
): VariableStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sqSum = 0;
  let count = 0;
  let finalVal = 0;
  let prevIdx: number | null = null;
  let prevVal: number | null = null;
  let totalDelta = 0;
  let trapSum = 0;
  let trapSqSum = 0;
  const validValues: number[] = [];

  for (let i = 0; i < length; i++) {
    const val = getValue(i);
    if (!isValidSample(val, nullValue)) continue;

    if (val < min) min = val;
    if (val > max) max = val;
    sum += val;
    sqSum += val * val;
    count++;
    finalVal = val;
    validValues.push(val);

    const idxVal = getIndex(i);
    if (Number.isFinite(idxVal)) {
      if (prevIdx !== null && prevVal !== null) {
        const delta = Math.abs(idxVal - prevIdx);
        if (delta > 0) {
          totalDelta += delta;
          trapSum += 0.5 * (prevVal + val) * delta;
          trapSqSum += 0.5 * (prevVal * prevVal + val * val) * delta;
        }
      }
      prevIdx = idxVal;
      prevVal = val;
    }
  }

  if (count === 0) return emptyStats(name, unit);

  const sampleMean = sum / count;
  let varianceSum = 0;
  for (let i = 0; i < validValues.length; i++) {
    const d = validValues[i]! - sampleMean;
    varianceSum += d * d;
  }
  const stddev = count > 1 ? Math.sqrt(varianceSum / (count - 1)) : 0;
  const mean = totalDelta > 0 ? trapSum / totalDelta : sampleMean;
  const rms = totalDelta > 0 ? Math.sqrt(trapSqSum / totalDelta) : Math.sqrt(sqSum / count);

  validValues.sort((a, b) => a - b);

  return {
    name,
    ...(unit !== undefined ? { unit } : {}),
    count,
    min,
    max,
    mean,
    rms,
    stddev,
    final: finalVal,
    p10: sortedPercentile(validValues, 0.1),
    p50: sortedPercentile(validValues, 0.5),
    p90: sortedPercentile(validValues, 0.9),
  };
}

/**
 * Slices an `IndexedDataset` to entries falling within `[minIndex, maxIndex]` (inclusive).
 */
export function sliceDatasetByRange(
  dataset: IndexedDataset,
  minIndex = -Infinity,
  maxIndex = Infinity,
): IndexedDataset {
  const lo = Math.min(minIndex, maxIndex);
  const hi = Math.max(minIndex, maxIndex);
  const keepIndices: number[] = [];

  for (let i = 0; i < dataset.indexValues.length; i++) {
    const idxVal = dataset.indexValues[i]!;
    if (Number.isFinite(idxVal) && idxVal >= lo && idxVal <= hi) {
      keepIndices.push(i);
    }
  }

  if (keepIndices.length === dataset.indexValues.length) return dataset;

  return {
    ...dataset,
    indexValues: keepIndices.map((idx) => dataset.indexValues[idx]!),
    series: dataset.series.map((s) => ({
      ...s,
      values: keepIndices.map((idx) => s.values[idx]!),
    })),
  };
}

/**
 * Computes descriptive statistics for series in an `IndexedDataset`, optionally restricted to an index window.
 */
export function computeVariableStats(
  dataset: IndexedDataset,
  options?: { minIndex?: number | undefined; maxIndex?: number | undefined; seriesNames?: string[] | undefined },
): VariableStats[] {
  const windowed =
    options?.minIndex !== undefined || options?.maxIndex !== undefined
      ? sliceDatasetByRange(dataset, options.minIndex ?? -Infinity, options.maxIndex ?? Infinity)
      : dataset;
  const target = windowed.indexValues.length > 0 ? windowed : dataset;
  const nullValue = dataset.indexAxis.nullValue;
  const filterSet = options?.seriesNames ? new Set(options.seriesNames) : null;

  return target.series
    .filter((s) => !filterSet || filterSet.has(s.name))
    .map((s) =>
      computeSeriesStatsCore(
        s.name,
        target.indexValues.length,
        (i) => target.indexValues[i]!,
        (i) => s.values[i],
        nullValue,
        s.unit,
      ),
    );
}

/**
 * Computes descriptive statistics directly over row-oriented records (e.g., Recharts/PapaParse rows).
 */
export function computeRowsVariableStats(
  rows: Record<string, unknown>[],
  variables: string[],
  options?: {
    indexKey?: string | undefined;
    minIndex?: number | undefined;
    maxIndex?: number | undefined;
    nullValue?: number | undefined;
  },
): VariableStats[] {
  if (rows.length === 0 || variables.length === 0) return [];
  const indexKey = options?.indexKey ?? "time";
  const minT = options?.minIndex ?? -Infinity;
  const maxT = options?.maxIndex ?? Infinity;
  const lo = Math.min(minT, maxT);
  const hi = Math.max(minT, maxT);

  const getIndexFromRow = (row: Record<string, unknown>): number =>
    Number(row[indexKey] ?? row["time"] ?? row["t"] ?? 0);

  let targetRows = rows;
  if (Number.isFinite(lo) || Number.isFinite(hi)) {
    const windowed = rows.filter((row) => {
      const t = getIndexFromRow(row);
      return Number.isFinite(t) && t >= lo && t <= hi;
    });
    if (windowed.length > 0) targetRows = windowed;
  }

  return variables.map((v) =>
    computeSeriesStatsCore(
      v,
      targetRows.length,
      (i) => getIndexFromRow(targetRows[i]!),
      (i) => targetRows[i]?.[v],
      options?.nullValue,
    ),
  );
}

/**
 * Computes a histogram distribution over numeric samples, ignoring NaN/null sentinel values.
 */
export function computeHistogram(
  values: number[],
  options?: {
    binCount?: number | undefined;
    min?: number | undefined;
    max?: number | undefined;
    nullValue?: number | undefined;
  },
): HistogramResult {
  const valid: number[] = [];
  let dataMin = Infinity;
  let dataMax = -Infinity;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isValidSample(v, options?.nullValue)) continue;
    valid.push(v);
    if (v < dataMin) dataMin = v;
    if (v > dataMax) dataMax = v;
  }

  if (valid.length === 0) {
    return { bins: [], totalCount: 0, min: 0, max: 0, binWidth: 0 };
  }

  const min = options?.min ?? dataMin;
  const max = options?.max ?? dataMax;
  const requestedBins = options?.binCount ?? Math.max(5, Math.min(50, Math.ceil(Math.sqrt(valid.length))));
  const binCount = Math.max(1, Math.floor(requestedBins));
  const span = max - min;
  const effectiveSpan = span > 1e-12 ? span : 1;
  const binWidth = effectiveSpan / binCount;

  const counts = new Array<number>(binCount).fill(0);
  let includedCount = 0;
  for (let i = 0; i < valid.length; i++) {
    const v = valid[i]!;
    if (v < min || v > max) continue;
    let binIdx = span <= 1e-12 ? 0 : Math.floor((v - min) / binWidth);
    if (binIdx >= binCount) binIdx = binCount - 1;
    if (binIdx < 0) binIdx = 0;
    counts[binIdx]!++;
    includedCount++;
  }

  const bins: HistogramBin[] = counts.map((count, i) => {
    const start = min + i * binWidth;
    const end = i === binCount - 1 ? min + effectiveSpan : start + binWidth;
    return {
      start,
      end,
      center: 0.5 * (start + end),
      count,
      frequency: includedCount > 0 ? count / includedCount : 0,
    };
  });

  return {
    bins,
    totalCount: includedCount,
    min,
    max,
    binWidth,
  };
}

/**
 * Computes ordinary least squares regression (`y = slope * x + intercept`) and R^2.
 */
export function computeLinearRegression(x: number[], y: number[], nullValue?: number): RegressionResult | null {
  const nMax = Math.min(x.length, y.length);
  let sumX = 0;
  let sumY = 0;
  let n = 0;

  for (let i = 0; i < nMax; i++) {
    const xi = x[i];
    const yi = y[i];
    if (!isValidSample(xi, nullValue) || !isValidSample(yi, nullValue)) continue;
    sumX += xi;
    sumY += yi;
    n++;
  }

  if (n < 2) return null;

  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;

  for (let i = 0; i < nMax; i++) {
    const xi = x[i];
    const yi = y[i];
    if (!isValidSample(xi, nullValue) || !isValidSample(yi, nullValue)) continue;
    const dx = xi - meanX;
    const dy = yi - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  if (sxx <= 1e-15) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = syy > 1e-15 ? Math.min(1, Math.max(0, (sxy * sxy) / (sxx * syy))) : 1;

  return { slope, intercept, r2, n };
}

/**
 * Applies optional `[0, 1]` normalization and logarithmic clamping to a single sample value.
 */
export function transformSeriesValue(
  raw: unknown,
  options: {
    normalize?: { min: number; span: number } | undefined;
    logScale?: boolean | undefined;
    nullValue?: number | undefined;
  },
): number | null {
  if (!isValidSample(raw, options.nullValue)) return null;
  let val = raw;
  if (options.normalize) {
    const span = options.normalize.span > 1e-12 ? options.normalize.span : 1;
    val = (val - options.normalize.min) / span;
  }
  if (options.logScale) {
    if (options.normalize) {
      return Math.max(1e-6, val);
    }
    return val <= 0 ? null : val;
  }
  return val;
}
