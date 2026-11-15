// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasPlotController,
  type CanvasRenderResult,
  type ChartViewMode,
  type CrossplotConfig,
  type HistogramConfig,
  type IndexedDataset,
  type OverlayConfig,
  type TrackConfig,
} from "@modelscript/simulate/charts";
import React, { useCallback, useEffect, useRef } from "react";

export interface IndexedCanvasPlotProps {
  dataset: IndexedDataset;
  mode: ChartViewMode;
  isDark: boolean;
  cursorMode?: boolean | undefined;
  overlay?: OverlayConfig | undefined;
  tracks?: TrackConfig[] | undefined;
  crossplot?: CrossplotConfig | undefined;
  histogram?: HistogramConfig | undefined;
  resetSignal?: number | undefined;
  onRender?: ((result: CanvasRenderResult | null) => void) | undefined;
  onCursorUpdate?: ((cursors: { c1?: number | null | undefined; c2?: number | null | undefined }) => void) | undefined;
}

/**
 * Reusable React <canvas> host wrapping `@modelscript/simulate/charts`'s `CanvasPlotController`
 * for Multi-Track, Crossplot, Histogram, and Canvas Overlay modes.
 */
export const IndexedCanvasPlot: React.FC<IndexedCanvasPlotProps> = ({
  dataset,
  mode,
  isDark,
  cursorMode = false,
  overlay,
  tracks,
  crossplot,
  histogram,
  resetSignal = 0,
  onRender,
  onCursorUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctrlRef = useRef<CanvasPlotController>(new CanvasPlotController({ mode, isDark }));
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; curX: number; curY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    curX: 0,
    curY: 0,
  });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(100, Math.floor(rect.width));
    const height = Math.max(120, Math.floor(rect.height));
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const selBox =
      dragRef.current.active && Math.abs(dragRef.current.curX - dragRef.current.startX) > 4
        ? { startPx: dragRef.current.startX, endPx: dragRef.current.curX }
        : undefined;

    const result = ctrlRef.current.render(ctx, width, height, dpr, selBox);
    onRender?.(result);
  }, [onRender]);

  useEffect(() => {
    ctrlRef.current.setDataset(dataset);
    redraw();
  }, [dataset, redraw]);

  useEffect(() => {
    ctrlRef.current.updateConfig({
      mode,
      isDark,
      cursorMode,
      overlay: overlay ?? {},
      tracks,
      crossplot,
      histogram,
    });
    redraw();
  }, [mode, isDark, cursorMode, overlay, tracks, crossplot, histogram, redraw]);

  useEffect(() => {
    if (resetSignal > 0) {
      ctrlRef.current.resetZoom();
      redraw();
    }
  }, [resetSignal, redraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [redraw]);

  const getLocalCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        minHeight: "200px",
        cursor: cursorMode ? "crosshair" : "default",
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={(e) => {
          const pt = getLocalCoords(e);
          if (cursorMode) {
            const placed = ctrlRef.current.placeCursorAtPixel(pt.x, pt.y);
            if (placed !== null) {
              onCursorUpdate?.(ctrlRef.current.getState().cursors);
              redraw();
            }
            return;
          }
          dragRef.current = { active: true, startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
        }}
        onMouseMove={(e) => {
          if (!dragRef.current.active) return;
          const pt = getLocalCoords(e);
          dragRef.current.curX = pt.x;
          dragRef.current.curY = pt.y;
          redraw();
        }}
        onMouseUp={(e) => {
          if (!dragRef.current.active) return;
          const pt = getLocalCoords(e);
          const { startX, startY } = dragRef.current;
          dragRef.current.active = false;
          if (ctrlRef.current.zoomToPixelRange(startX, pt.x, startY, pt.y)) {
            redraw();
          } else {
            redraw();
          }
        }}
        onDoubleClick={() => {
          ctrlRef.current.resetZoom();
          redraw();
        }}
      />
    </div>
  );
};

export default IndexedCanvasPlot;
