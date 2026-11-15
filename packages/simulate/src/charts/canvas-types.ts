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
