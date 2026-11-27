// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasPlotController,
  type CanvasRenderResult,
  type ChartViewMode,
  type CrossplotConfig,
  type CursorState,
  type HistogramConfig,
  type IndexedDataset,
  type OverlayConfig,
  type TrackConfig,
  type ViewportRange,
} from "@modelscript/simulate/charts";
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface IndexedCanvasPlotProps {
  dataset: IndexedDataset;
  mode: ChartViewMode;
  isDark: boolean;
  cursorMode?: boolean | undefined;
  overlay?: OverlayConfig | undefined;
  tracks?: TrackConfig[] | undefined;
  crossplot?: CrossplotConfig | undefined;
  histogram?: HistogramConfig | undefined;
  viewport?: ViewportRange | undefined;
  cursors?: CursorState | undefined;
  resetSignal?: number | undefined;
  onViewportChange?: ((viewport: ViewportRange) => void) | undefined;
  onRender?: ((result: CanvasRenderResult | null) => void) | undefined;
  onCursorUpdate?: ((cursors: { c1?: number | null | undefined; c2?: number | null | undefined }) => void) | undefined;
}

/**
 * Reusable React <canvas> host wrapping `@modelscript/simulate/charts`'s `CanvasPlotController`
 * for Multi-Track, Crossplot, Histogram, and Canvas Overlay modes with wheel-zoom, Shift+drag pan,
 * box-zoom, Dual-Y axes, and multi-panel synchronized viewports/cursors.
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
  viewport,
  cursors,
  resetSignal = 0,
  onViewportChange,
  onRender,
  onCursorUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctrlRef = useRef<CanvasPlotController>(new CanvasPlotController({ mode, isDark }));
  const [internalZoomed, setInternalZoomed] = useState(false);
  const dragRef = useRef<{
    active: boolean;
    panning: boolean;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    lastX: number;
  }>({
    active: false,
    panning: false,
    startX: 0,
    startY: 0,
    curX: 0,
    curY: 0,
    lastX: 0,
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
      dragRef.current.active && !dragRef.current.panning && Math.abs(dragRef.current.curX - dragRef.current.startX) > 4
        ? { startPx: dragRef.current.startX, endPx: dragRef.current.curX }
        : undefined;

    const result = ctrlRef.current.render(ctx, width, height, dpr, selBox);
    onRender?.(result);
  }, [onRender]);

  useEffect(() => {
    ctrlRef.current.setDataset(dataset);
    if (viewport) ctrlRef.current.setViewport(viewport);
    if (cursors) ctrlRef.current.setCursors(cursors);
    redraw();
  }, [dataset, redraw]);

  useEffect(() => {
    if (viewport !== undefined) {
      ctrlRef.current.setViewport(viewport);
      redraw();
    }
  }, [viewport, redraw]);

  useEffect(() => {
    if (cursors !== undefined) {
      ctrlRef.current.setCursors(cursors);
      redraw();
    }
  }, [cursors, redraw]);

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
      setInternalZoomed(false);
      onViewportChange?.({});
      redraw();
    }
  }, [resetSignal, redraw, onViewportChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [redraw]);

  const getLocalCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const isZoomed = Boolean(viewport?.minIndex !== undefined || viewport?.maxIndex !== undefined || internalZoomed);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        minHeight: "140px",
        cursor: cursorMode ? "crosshair" : "default",
      }}
    >
      <canvas
        ref={canvasRef}
        onWheel={(e) => {
          const last = ctrlRef.current.getLastResult();
          if (!last || (mode !== "overlay" && mode !== "multitrack")) return;
          e.preventDefault();
          const pt = getLocalCoords(e);
          const frac = (pt.x - last.plotRect.x) / Math.max(1, last.plotRect.width);
          const zoomFactor = e.deltaY < 0 ? 0.78 : 1.28;
          if (ctrlRef.current.zoomAtFraction(zoomFactor, frac)) {
            const vp = ctrlRef.current.getState().viewport;
            setInternalZoomed(vp.minIndex !== undefined || vp.maxIndex !== undefined);
            onViewportChange?.(vp);
            redraw();
          }
        }}
        onMouseDown={(e) => {
          const pt = getLocalCoords(e);
          if (cursorMode && e.button === 0 && !e.shiftKey) {
            const placed = ctrlRef.current.placeCursorAtPixel(pt.x, pt.y);
            if (placed !== null) {
              onCursorUpdate?.(ctrlRef.current.getState().cursors);
              redraw();
            }
            return;
          }
          const panning = e.shiftKey || e.button === 1;
          dragRef.current = { active: true, panning, startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y, lastX: pt.x };
        }}
        onMouseMove={(e) => {
          if (!dragRef.current.active) return;
          const pt = getLocalCoords(e);
          if (dragRef.current.panning) {
            const last = ctrlRef.current.getLastResult();
            const dxPx = pt.x - dragRef.current.lastX;
            dragRef.current.lastX = pt.x;
            if (last && Math.abs(dxPx) > 0) {
              const dxFrac = -dxPx / Math.max(1, last.plotRect.width);
              if (ctrlRef.current.panByFraction(dxFrac)) {
                onViewportChange?.(ctrlRef.current.getState().viewport);
              }
            }
            redraw();
            return;
          }
          dragRef.current.curX = pt.x;
          dragRef.current.curY = pt.y;
          redraw();
        }}
        onMouseUp={(e) => {
          if (!dragRef.current.active) return;
          const pt = getLocalCoords(e);
          const { startX, startY, panning } = dragRef.current;
          dragRef.current.active = false;
          if (!panning && ctrlRef.current.zoomToPixelRange(startX, pt.x, startY, pt.y)) {
            const vp = ctrlRef.current.getState().viewport;
            setInternalZoomed(vp.minIndex !== undefined || vp.maxIndex !== undefined);
            onViewportChange?.(vp);
            redraw();
          } else {
            redraw();
          }
        }}
        onDoubleClick={() => {
          ctrlRef.current.resetZoom();
          setInternalZoomed(false);
          onViewportChange?.({});
          redraw();
        }}
      />
      {isZoomed && (
        <button
          type="button"
          onClick={() => {
            ctrlRef.current.resetZoom();
            setInternalZoomed(false);
            onViewportChange?.({});
            redraw();
          }}
          title="Reset Zoom (or double-click canvas · Scroll = Zoom · Shift+Drag = Pan)"
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            fontSize: 10.5,
            fontWeight: 600,
            padding: "2px 7px",
            borderRadius: 4,
            border: `1px solid ${isDark ? "var(--ms-border, #30363d)" : "#d0d7de"}`,
            background: isDark ? "rgba(22,27,34,0.85)" : "rgba(255,255,255,0.9)",
            color: isDark ? "var(--ms-text-1, #e6edf3)" : "#1f2328",
            cursor: "pointer",
          }}
        >
          Reset Zoom
        </button>
      )}
    </div>
  );
};

export default IndexedCanvasPlot;
