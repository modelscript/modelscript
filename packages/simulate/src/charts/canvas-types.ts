// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartTheme } from "./theme.js";
import type { AxisScale, HistogramResult, RegressionResult, VariableStats } from "./types.js";

export type ChartViewMode = "overlay" | "multitrack" | "crossplot" | "histogram";

export interface TrackConfig {
  id: string;
  title?: string | undefined;
  seriesNames: string[];
  scale?: AxisScale | undefined;
  min?: number | undefined;
  max?: number | undefined;
  fillUnder?: boolean | undefined;
}

export interface OverlayConfig {
  visibleSeries?: string[] | undefined;
  normalize?: boolean | undefined;
  logScale?: boolean | undefined;
  invertedIndex?: boolean | undefined;
  /** Optional series names plotted against a dedicated right-hand Y-axis (Dual-Y). */
  rightAxisSeries?: string[] | undefined;
  /** Optional explicit left Y-axis [min, max] bounds. */
  yRange?: [number, number] | undefined;
  /** Optional explicit right Y-axis [min, max] bounds. */
  rightYRange?: [number, number] | undefined;
  /** Optional explicit per-series stroke colors keyed by series name. */
  seriesColors?: Record<string, string> | undefined;
  /** Optional left Y-axis label. */
  yTitle?: string | undefined;
  /** Optional right Y-axis label. */
  rightYTitle?: string | undefined;
}

export interface CrossplotConfig {
  xSeries: string;
  ySeries: string;
  colorSeries?: string | undefined;
  showRegression?: boolean | undefined;
  pointRadius?: number | undefined;
}

export interface HistogramConfig {
  seriesName: string;
  binCount?: number | undefined;
}

export interface CursorState {
  c1?: number | null | undefined;
  c2?: number | null | undefined;
}

export interface ViewportRange {
  minIndex?: number | undefined;
  maxIndex?: number | undefined;
  minValue?: number | undefined;
  maxValue?: number | undefined;
}

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasRenderOptions {
  width: number;
  height: number;
  dpr?: number | undefined;
  mode: ChartViewMode;
  isDark?: boolean | undefined;
  theme?: Partial<ChartTheme> | undefined;
  viewport?: ViewportRange | undefined;
  cursors?: CursorState | undefined;
  selectionBox?: { startPx: number; endPx: number } | undefined;
  overlay?: OverlayConfig | undefined;
  tracks?: TrackConfig[] | undefined;
  crossplot?: CrossplotConfig | undefined;
  histogram?: HistogramConfig | undefined;
}

export interface RenderedTrackGeometry {
  id: string;
  x: number;
  width: number;
  series: string[];
}

export interface CanvasRenderResult {
  mode: ChartViewMode;
  plotRect: PlotRect;
  indexBounds: { min: number; max: number };
  stats?: VariableStats[] | undefined;
  regression?: RegressionResult | null | undefined;
  histogram?: HistogramResult | undefined;
  tracks?: RenderedTrackGeometry[] | undefined;
}
