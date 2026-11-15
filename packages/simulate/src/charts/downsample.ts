// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IndexedDataset } from "./types.js";

export const DEFAULT_DOWNSAMPLE_THRESHOLD = 2000;
export const DEFAULT_TARGET_POINTS = 1500;

/**
 * Downsamples a 2D series using the Largest-Triangle-Three-Buckets (LTTB) algorithm.
 * Preserves visual peaks, troughs, and waveform shape while reducing rendering latency.
 */
export function lttbDecimate<T extends { x: number; y: number }>(data: T[], threshold: number): T[] {
  if (threshold >= data.length || threshold <= 2) {
    return data;
  }

  const sampled: T[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  let aIdx = 0;
  sampled.push(data[aIdx]!);

  for (let i = 0; i < threshold - 2; i++) {
    const cStart = Math.floor((i + 1) * bucketSize) + 1;
    const cEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
    let avgX = 0;
    let avgY = 0;
    const cLen = cEnd - cStart;
    if (cLen > 0) {
      for (let c = cStart; c < cEnd; c++) {
        avgX += data[c]!.x;
        avgY += data[c]!.y;
      }
      avgX /= cLen;
      avgY /= cLen;
    } else {
      const fallback = data[Math.min(cStart, data.length - 1)]!;
      avgX = fallback.x;
      avgY = fallback.y;
    }

    const bStart = Math.floor(i * bucketSize) + 1;
    const bEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length);

    const aPt = data[aIdx]!;
    let maxArea = -1;
    let maxAreaIdx = bStart;

    for (let b = bStart; b < bEnd; b++) {
      const bPt = data[b]!;
      const area = Math.abs((aPt.x - avgX) * (bPt.y - aPt.y) - (aPt.x - bPt.x) * (avgY - aPt.y)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = b;
      }
    }

    sampled.push(data[maxAreaIdx]!);
    aIdx = maxAreaIdx;
  }

  sampled.push(data[data.length - 1]!);
  return sampled;
}

/**
 * Computes indices to keep when applying min-max envelope decimation across a numeric array.
 */
function computeMinMaxKeepIndices(
  length: number,
  getValue: (idx: number) => unknown,
  targetPoints: number,
  threshold: number,
): number[] | null {
  if (length <= threshold) return null;
  if (targetPoints <= 2) return [0, length - 1];

  const bucketCount = Math.max(1, Math.floor((targetPoints - 2) / 2));
  const bucketSize = (length - 2) / bucketCount;
  const indices: number[] = [0];

  for (let b = 0; b < bucketCount; b++) {
    const start = 1 + Math.floor(b * bucketSize);
    const end = Math.min(length - 1, 1 + Math.floor((b + 1) * bucketSize));
    if (start >= end) {
      if (start < length) indices.push(start);
      continue;
    }
    let minIdx = start;
    let maxIdx = start;
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = start; i < end; i++) {
      const v = getValue(i);
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < minVal) {
          minVal = v;
          minIdx = i;
        }
        if (v > maxVal) {
          maxVal = v;
          maxIdx = i;
        }
      }
    }
    if (minIdx === maxIdx) {
      indices.push(minIdx);
    } else if (minIdx < maxIdx) {
      indices.push(minIdx, maxIdx);
    } else {
      indices.push(maxIdx, minIdx);
    }
  }

  indices.push(length - 1);
  return indices;
}

/**
 * Min-max envelope downsampling over row-oriented tabular data.
 */
export function downsampleMinMaxRows<T extends Record<string, number>>(
  rows: T[],
  primaryVar: string | undefined,
  targetPoints = DEFAULT_TARGET_POINTS,
  threshold = DEFAULT_DOWNSAMPLE_THRESHOLD,
): T[] {
  if (rows.length <= threshold) return rows;
  if (!primaryVar) {
    const step = Math.max(1, Math.floor(rows.length / targetPoints));
    const sampled: T[] = [];
    for (let i = 0; i < rows.length; i += step) {
      sampled.push(rows[i]!);
    }
    if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
      sampled.push(rows[rows.length - 1]!);
    }
    return sampled;
  }

  const indices = computeMinMaxKeepIndices(rows.length, (i) => rows[i]?.[primaryVar], targetPoints, threshold);
  if (!indices) return rows;
  return indices.map((idx) => rows[idx]!);
}

/**
 * Min-max envelope downsampling over an `IndexedDataset`, keeping all series aligned.
 */
export function downsampleDataset(
  dataset: IndexedDataset,
  primarySeriesName?: string,
  targetPoints = DEFAULT_TARGET_POINTS,
  threshold = DEFAULT_DOWNSAMPLE_THRESHOLD,
): IndexedDataset {
  const n = dataset.indexValues.length;
  if (n <= threshold) return dataset;

  const targetSeries =
    (primarySeriesName ? dataset.series.find((s) => s.name === primarySeriesName) : undefined) ?? dataset.series[0];

  const indices = targetSeries
    ? computeMinMaxKeepIndices(n, (i) => targetSeries.values[i], targetPoints, threshold)
    : (() => {
        const step = Math.max(1, Math.floor(n / targetPoints));
        const out: number[] = [];
        for (let i = 0; i < n; i += step) out.push(i);
        if (out[out.length - 1] !== n - 1) out.push(n - 1);
        return out;
      })();

  if (!indices) return dataset;

  return {
    ...dataset,
    indexValues: indices.map((idx) => dataset.indexValues[idx]!),
    series: dataset.series.map((s) => ({
      ...s,
      values: indices.map((idx) => s.values[idx]!),
    })),
  };
}
