// SPDX-License-Identifier: AGPL-3.0-or-later

/** Supported axis scale types for series and tracks. */
export type AxisScale = "linear" | "log";

/**
 * Describes the independent axis of an indexed dataset (e.g., time, frequency, or borehole depth).
 */
export interface IndexAxisDescriptor {
  /** Property/column key representing the independent axis. */
  key: string;
  /** Human-readable axis label (e.g., "Time", "Depth", "Frequency"). */
  label: string;
  /** Physical unit (e.g., "s", "m", "ft", "Hz"). */
  unit?: string | undefined;
  /** Whether values increase downward (true for depth-indexed logs). */
  inverted?: boolean | undefined;
  /** Sentinel numeric value treated as missing/null (e.g., -999.25 in LAS files). */
  nullValue?: number | undefined;
  /** Preferred axis scale. */
  scale?: AxisScale | undefined;
}

/**
 * Describes a single dependent variable / curve series aligned with `indexValues`.
 */
export interface SeriesDescriptor {
  /** Variable or curve mnemonic name. */
  name: string;
  /** Physical unit (e.g., "V", "gAPI", "ohm.m"). */
  unit?: string | undefined;
  /** Optional description. */
  description?: string | undefined;
  /** Dependent sample values aligned by index with `IndexedDataset.indexValues`. */
  values: number[];
  /** Preferred axis scale for this curve/series. */
  scale?: AxisScale | undefined;
}

/**
 * Canonical indexed multi-series dataset shared across simulations, CSVs, and well logs.
 */
export interface IndexedDataset {
  /** Optional title (model name, well name, or file name). */
  title?: string | undefined;
  /** Origin format identifier. */
  sourceFormat?: "simulation" | "csv" | "las" | "tabular" | (string & {}) | undefined;
  /** Independent axis specification. */
  indexAxis: IndexAxisDescriptor;
  /** Independent axis coordinates. */
  indexValues: number[];
  /** Dependent variable series. */
  series: SeriesDescriptor[];
  /** Additional format-specific metadata (e.g., solver name, well UWI, field). */
  metadata?: Record<string, string | number | boolean> | undefined;
}

/**
 * Descriptive statistics computed over a series or windowed interval.
 */
export interface VariableStats {
  name: string;
  unit?: string | undefined;
  count: number;
  min: number;
  max: number;
  mean: number;
  rms: number;
  stddev: number;
  final: number;
  p10: number;
  p50: number;
  p90: number;
}

/**
 * Single bin in a histogram distribution.
 */
export interface HistogramBin {
  start: number;
  end: number;
  center: number;
  count: number;
  frequency: number;
}

/**
 * Binned histogram result for a variable over an interval.
 */
export interface HistogramResult {
  bins: HistogramBin[];
  totalCount: number;
  min: number;
  max: number;
  binWidth: number;
}

/**
 * Ordinary least squares linear regression summary (`y = slope * x + intercept`).
 */
export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}
