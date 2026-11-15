// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderDatasetCanvas, type Canvas2DContextLike } from "./canvas-renderer.js";
import type {
  CanvasRenderOptions,
  CanvasRenderResult,
  ChartViewMode,
  CrossplotConfig,
  CursorState,
  HistogramConfig,
  OverlayConfig,
  TrackConfig,
  ViewportRange,
} from "./canvas-types.js";
import type { IndexedDataset } from "./types.js";

export interface PlotControllerState {
  mode: ChartViewMode;
  isDark: boolean;
  viewport: ViewportRange;
  cursors: CursorState;
  cursorMode: boolean;
  nextCursorTarget: 1 | 2;
  overlay: OverlayConfig;
  tracks?: TrackConfig[] | undefined;
  crossplot?: CrossplotConfig | undefined;
  histogram?: HistogramConfig | undefined;
}

/**
 * Framework-agnostic stateful controller coordinating `IndexedDataset`, viewport zoom,
 * dual cursors, and Canvas2D redraws across VS Code webviews and React hosts.
 */
export class CanvasPlotController {
  private dataset: IndexedDataset | null = null;
  private state: PlotControllerState;
  private lastResult: CanvasRenderResult | null = null;

  constructor(initial?: Partial<PlotControllerState>) {
    this.state = {
      mode: initial?.mode ?? "overlay",
      isDark: initial?.isDark ?? true,
      viewport: initial?.viewport ?? {},
      cursors: initial?.cursors ?? { c1: null, c2: null },
      cursorMode: initial?.cursorMode ?? false,
      nextCursorTarget: initial?.nextCursorTarget ?? 1,
      overlay: initial?.overlay ?? {},
      tracks: initial?.tracks,
      crossplot: initial?.crossplot,
      histogram: initial?.histogram,
    };
  }

  setDataset(dataset: IndexedDataset | null): void {
    this.dataset = dataset;
    this.state.viewport = {};
    this.state.cursors = { c1: null, c2: null };
    this.state.nextCursorTarget = 1;
  }

  getDataset(): IndexedDataset | null {
    return this.dataset;
  }

  getState(): Readonly<PlotControllerState> {
    return this.state;
  }

  getLastResult(): CanvasRenderResult | null {
    return this.lastResult;
  }

  setMode(mode: ChartViewMode): void {
    this.state.mode = mode;
  }

  setDark(isDark: boolean): void {
    this.state.isDark = isDark;
  }

  setViewport(viewport: ViewportRange): void {
    this.state.viewport = viewport;
  }

  resetZoom(): void {
    this.state.viewport = {};
  }

  setCursorMode(enabled: boolean): void {
    this.state.cursorMode = enabled;
  }

  placeCursorAtPixel(px: number, py: number): number | null {
    if (!this.lastResult || !this.dataset) return null;
    const { plotRect, indexBounds, mode } = this.lastResult;
    let t = 0;

    if (mode === "multitrack") {
      if (py < plotRect.y || py > plotRect.y + plotRect.height) return null;
      const inverted = this.dataset.indexAxis.inverted ?? true;
      const frac = (py - plotRect.y) / Math.max(1, plotRect.height);
      t = inverted
        ? indexBounds.min + frac * (indexBounds.max - indexBounds.min)
        : indexBounds.max - frac * (indexBounds.max - indexBounds.min);
    } else if (mode === "overlay") {
      if (px < plotRect.x || px > plotRect.x + plotRect.width) return null;
      const inverted = this.state.overlay.invertedIndex ?? Boolean(this.dataset.indexAxis.inverted);
      const frac = (px - plotRect.x) / Math.max(1, plotRect.width);
      t = inverted
        ? indexBounds.max - frac * (indexBounds.max - indexBounds.min)
        : indexBounds.min + frac * (indexBounds.max - indexBounds.min);
    } else {
      return null;
    }

    if (this.state.nextCursorTarget === 1) {
      this.state.cursors.c1 = t;
      this.state.nextCursorTarget = 2;
    } else {
      this.state.cursors.c2 = t;
      this.state.nextCursorTarget = 1;
    }
    return t;
  }

  zoomToPixelRange(startPx: number, endPx: number, startPy: number, endPy: number): boolean {
    if (!this.lastResult || !this.dataset) return false;
    const { plotRect, indexBounds, mode } = this.lastResult;

    if (mode === "multitrack") {
      const yLo = Math.max(plotRect.y, Math.min(startPy, endPy));
      const yHi = Math.min(plotRect.y + plotRect.height, Math.max(startPy, endPy));
      if (yHi - yLo < 6) return false;
      const inverted = this.dataset.indexAxis.inverted ?? true;
      const f1 = (yLo - plotRect.y) / Math.max(1, plotRect.height);
      const f2 = (yHi - plotRect.y) / Math.max(1, plotRect.height);
      const span = indexBounds.max - indexBounds.min;
      const v1 = inverted ? indexBounds.min + f1 * span : indexBounds.max - f1 * span;
      const v2 = inverted ? indexBounds.min + f2 * span : indexBounds.max - f2 * span;
      this.state.viewport = { minIndex: Math.min(v1, v2), maxIndex: Math.max(v1, v2) };
      return true;
    }

    if (mode === "overlay") {
      const xLo = Math.max(plotRect.x, Math.min(startPx, endPx));
      const xHi = Math.min(plotRect.x + plotRect.width, Math.max(startPx, endPx));
      if (xHi - xLo < 6) return false;
      const inverted = this.state.overlay.invertedIndex ?? Boolean(this.dataset.indexAxis.inverted);
      const f1 = (xLo - plotRect.x) / Math.max(1, plotRect.width);
      const f2 = (xHi - plotRect.x) / Math.max(1, plotRect.width);
      const span = indexBounds.max - indexBounds.min;
      const v1 = inverted ? indexBounds.max - f1 * span : indexBounds.min + f1 * span;
      const v2 = inverted ? indexBounds.max - f2 * span : indexBounds.min + f2 * span;
      this.state.viewport = { minIndex: Math.min(v1, v2), maxIndex: Math.max(v1, v2) };
      return true;
    }

    return false;
  }

  updateConfig(patch: Partial<Omit<PlotControllerState, "viewport" | "cursors">>): void {
    this.state = { ...this.state, ...patch };
  }

  render(
    ctx: Canvas2DContextLike,
    width: number,
    height: number,
    dpr = 1,
    selectionBox?: { startPx: number; endPx: number },
  ): CanvasRenderResult | null {
    if (!this.dataset || width <= 0 || height <= 0) return null;
    const renderOptions: CanvasRenderOptions = {
      width,
      height,
      dpr,
      mode: this.state.mode,
      isDark: this.state.isDark,
      viewport: this.state.viewport,
      cursors: this.state.cursors,
      selectionBox,
      overlay: this.state.overlay,
      tracks: this.state.tracks,
      crossplot: this.state.crossplot,
      histogram: this.state.histogram,
    };
    this.lastResult = renderDatasetCanvas(ctx, this.dataset, renderOptions);
    return this.lastResult;
  }
}
