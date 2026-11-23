// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Canvas2DContextLike } from "../engine/glyph-compiler.js";
import type { TileLodTier } from "../schema/canvas-document.js";

/**
 * Canvas2D-Native Plot & Chart Engine (Modelon Impact style).
 *
 * Renders multi-series time-series waveforms (with LTTB downsampling), XY phase
 * portraits, Bode diagrams, and 50,000-point Monte Carlo scatter/Pareto plots
 * directly onto any Canvas2D context — working identically on Desktop 2D Canvas,
 * inside Modelica schematics as pinned widgets, inside `.mscanvas` analytics tiles,
 * AND uploaded as crisp `THREE.CanvasTexture`s in 3D / WebXR VR mode.
 */

export type CanvasPlotKind = "timeseries" | "xy" | "bode" | "scatter" | "pareto";

export interface PlotSeriesData {
  id: string;
  label: string;
  color: string;
  unit?: string | undefined;
  x: Float64Array | number[];
  y: Float64Array | number[];
}

export interface PlotThresholdBand {
  label: string;
  axis: "x" | "y";
  value: number;
  direction: "above-fail" | "below-fail";
  color?: string | undefined;
}

export interface WidgetTetherTarget {
  x: number;
  y: number;
  label?: string | undefined;
}

export interface PlotBrushRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScatterBrushHitResult {
  indices: number[];
  linkedIds: string[];
}

export interface CanvasPlotSpec {
  id: string;
  title: string;
  kind: CanvasPlotKind;
  series: PlotSeriesData[];
  xLabel?: string | undefined;
  yLabel?: string | undefined;
  thresholds?: PlotThresholdBand[] | undefined;
  /** Synchronized simulation timeline crosshair value (world X / time). */
  crosshairX?: number | undefined;
  /** Optional brushed highlight window in data X coordinates. */
  brushX?: [number, number] | undefined;
  /** Optional 2D pixel selection rectangle in parent canvas coordinates for Monte Carlo brush-linking. */
  brushRect?: PlotBrushRect | undefined;
  /** Optional per-sample entity/requirement IDs aligned with scatter point indices for cross-widget brush-linking. */
  sampleEntityIds?: string[] | undefined;
  /** Optional schematic anchor point in parent canvas coordinates to draw a dashed leader tether. */
  tetherTarget?: WidgetTetherTarget | undefined;
  dark?: boolean | undefined;
  lod?: TileLodTier | undefined;
}

export interface DownsampledPoint {
  x: number;
  y: number;
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampler preserving visual peaks and
 * transients while reducing 100k+ simulation points to pixel-accurate buckets.
 */
export function downsampleLTTB(
  xs: Float64Array | number[],
  ys: Float64Array | number[],
  threshold: number,
): DownsampledPoint[] {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return [];
  if (threshold >= n || threshold <= 2) {
    const out: DownsampledPoint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = { x: xs[i]!, y: ys[i]! };
    }
    return out;
  }

  const sampled: DownsampledPoint[] = [{ x: xs[0]!, y: ys[0]! }];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(n, Math.floor((i + 2) * bucketSize) + 1);
    const avgLen = Math.max(1, avgRangeEnd - avgRangeStart);
    let avgX = 0;
    let avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += xs[j]!;
      avgY += ys[j]!;
    }
    avgX /= avgLen;
    avgY /= avgLen;

    const rangeOffs = Math.floor(i * bucketSize) + 1;
    const rangeTo = Math.min(n - 1, Math.floor((i + 1) * bucketSize) + 1);
    const pointAX = xs[a]!;
    const pointAY = ys[a]!;

    let maxArea = -1;
    let nextA = rangeOffs;
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs((pointAX - avgX) * (ys[j]! - pointAY) - (pointAX - xs[j]!) * (avgY - pointAY));
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    sampled.push({ x: xs[nextA]!, y: ys[nextA]! });
    a = nextA;
  }

  sampled.push({ x: xs[n - 1]!, y: ys[n - 1]! });
  return sampled;
}

export interface PlotDataBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function computePlotBounds(spec: CanvasPlotSpec): PlotDataBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const s of spec.series) {
    const n = Math.min(s.x.length, s.y.length);
    for (let i = 0; i < n; i++) {
      const xv = s.x[i]!;
      const yv = s.y[i]!;
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      if (xv < minX) minX = xv;
      if (xv > maxX) maxX = xv;
      if (yv < minY) minY = yv;
      if (yv > maxY) maxY = yv;
    }
  }
  if (spec.thresholds) {
    for (const th of spec.thresholds) {
      if (th.axis === "y") {
        if (th.value < minY) minY = th.value;
        if (th.value > maxY) maxY = th.value;
      } else {
        if (th.value < minX) minX = th.value;
        if (th.value > maxX) maxX = th.value;
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  if (maxX === minX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (maxY === minY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  const padY = (maxY - minY) * 0.06;
  return { minX, maxX, minY: minY - padY, maxY: maxY + padY };
}

type Canvas2DOptionalExtras = Canvas2DContextLike & {
  quadraticCurveTo?: (cpx: number, cpy: number, x: number, y: number) => void;
  measureText?: (text: string) => { width: number };
};

interface PlotLayoutGeometry {
  bounds: PlotDataBounds;
  isSparkline: boolean;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  mapX: (vx: number) => number;
  mapY: (vy: number) => number;
  unmapX: (canvasPxX: number) => number;
  unmapY: (canvasPxY: number) => number;
}

function computePlotLayout(
  spec: CanvasPlotSpec,
  x: number,
  y: number,
  width: number,
  height: number,
): PlotLayoutGeometry {
  const bounds = computePlotBounds(spec);
  const isSparkline = spec.lod === "macro" || spec.lod === "thumbnail" || width < 140 || height < 80;
  const padL = isSparkline ? 6 : 42;
  const padR = isSparkline ? 6 : 12;
  const padT = isSparkline ? 6 : 24;
  const padB = isSparkline ? 6 : 24;
  const plotW = Math.max(8, width - padL - padR);
  const plotH = Math.max(8, height - padT - padB);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  const mapX = (vx: number) => padL + ((vx - bounds.minX) / spanX) * plotW;
  const mapY = (vy: number) => padT + plotH - ((vy - bounds.minY) / spanY) * plotH;
  const unmapX = (canvasPxX: number) => bounds.minX + ((canvasPxX - x - padL) / plotW) * spanX;
  const unmapY = (canvasPxY: number) => bounds.minY + ((y + padT + plotH - canvasPxY) / plotH) * spanY;

  return {
    bounds,
    isSparkline,
    padL,
    padR,
    padT,
    padB,
    plotW,
    plotH,
    mapX,
    mapY,
    unmapX,
    unmapY,
  };
}

function computeWidgetAnchorPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { x: cx, y: cy };
  }
  const scaleX = Math.abs(dx) > 1e-6 ? width / 2 / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 1e-6 ? height / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(scaleX, scaleY, 1);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Draws a curved dashed leader tether from a floating widget anchor to a schematic
 * component/port target, complete with target halo/dot and optional midpoint pill label.
 */
export function paintWidgetLeaderTether(
  ctx: Canvas2DContextLike,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color = "#38bdf8",
  label?: string,
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  const bend = dist > 1e-3 ? Math.min(36, dist * 0.18) : 0;
  const nx = dist > 1e-3 ? -dy / dist : 0;
  const ny = dist > 1e-3 ? dx / dist : 0;
  const cpX = (fromX + toX) * 0.5 + nx * bend;
  const cpY = (fromY + toY) * 0.5 + ny * bend;

  const extra = ctx as Canvas2DOptionalExtras;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash?.([5, 3]);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  if (typeof extra.quadraticCurveTo === "function") {
    extra.quadraticCurveTo(cpX, cpY, toX, toY);
  } else {
    const steps = 12;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const mt = 1 - t;
      const px = mt * mt * fromX + 2 * mt * t * cpX + t * t * toX;
      const py = mt * mt * fromY + 2 * mt * t * cpY + t * t * toY;
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.setLineDash?.([]);

  // Small origin dot on widget edge
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(fromX, fromY, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Target anchor halo + solid dot
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * 0.28;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(toX, toY, 5.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = prevAlpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(toX, toY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // Optional midpoint pill label
  if (label && label.length > 0) {
    const midX = 0.25 * fromX + 0.5 * cpX + 0.25 * toX;
    const midY = 0.25 * fromY + 0.5 * cpY + 0.25 * toY;
    ctx.font = "600 9px sans-serif";
    const textWidth = typeof extra.measureText === "function" ? extra.measureText(label).width : label.length * 5.8;
    const pillW = Math.max(24, textWidth + 12);
    const pillH = 16;
    const pillX = midX - pillW / 2;
    const pillY = midY - pillH / 2;

    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, midX, midY);
  }

  ctx.restore();
}

/**
 * Maps a 2D pixel brush rectangle in parent canvas coordinates back into the plot's
 * data domain and returns all brushed scatter sample indices and unique linked entity IDs.
 */
export function hitTestScatterBrush(
  spec: CanvasPlotSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  brush: PlotBrushRect,
): ScatterBrushHitResult {
  const layout = computePlotLayout(spec, x, y, w, h);
  const bx0 = Math.min(brush.x0, brush.x1);
  const bx1 = Math.max(brush.x0, brush.x1);
  const by0 = Math.min(brush.y0, brush.y1);
  const by1 = Math.max(brush.y0, brush.y1);

  const plotLeft = x + layout.padL;
  const plotRight = plotLeft + layout.plotW;
  const plotTop = y + layout.padT;
  const plotBottom = plotTop + layout.plotH;

  if (bx1 < plotLeft || bx0 > plotRight || by1 < plotTop || by0 > plotBottom) {
    return { indices: [], linkedIds: [] };
  }

  const cx0 = Math.max(plotLeft, bx0);
  const cx1 = Math.min(plotRight, bx1);
  const cy0 = Math.max(plotTop, by0);
  const cy1 = Math.min(plotBottom, by1);

  const epsX = Math.max(1e-12, (layout.bounds.maxX - layout.bounds.minX) * 1e-9);
  const epsY = Math.max(1e-12, (layout.bounds.maxY - layout.bounds.minY) * 1e-9);
  const dataMinX = layout.unmapX(cx0) - epsX;
  const dataMaxX = layout.unmapX(cx1) + epsX;
  const dataMinY = layout.unmapY(cy1) - epsY;
  const dataMaxY = layout.unmapY(cy0) + epsY;

  const seenIndices = new Set<number>();
  const indices: number[] = [];
  const linkedIdSet = new Set<string>();
  const entityIds = spec.sampleEntityIds;

  for (const s of spec.series) {
    const n = Math.min(s.x.length, s.y.length);
    for (let i = 0; i < n; i++) {
      const vx = s.x[i]!;
      const vy = s.y[i]!;
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
      if (vx >= dataMinX && vx <= dataMaxX && vy >= dataMinY && vy <= dataMaxY) {
        if (!seenIndices.has(i)) {
          seenIndices.add(i);
          indices.push(i);
        }
        const entityId = entityIds?.[i];
        if (entityId !== undefined && entityId.length > 0) {
          linkedIdSet.add(entityId);
        }
      }
    }
  }

  return {
    indices,
    linkedIds: Array.from(linkedIdSet),
  };
}

/**
 * Paints a Modelon Impact-style interactive plot directly onto a Canvas2D context.
 * Automatically collapses into a lightweight sparkline at `macro` or `thumbnail` LOD.
 */
export function paintCanvasPlot(
  ctx: Canvas2DContextLike,
  spec: CanvasPlotSpec,
  x: number,
  y: number,
  width: number,
  height: number,
): { renderedPoints: number; bounds: PlotDataBounds } {
  const dark = spec.dark ?? true;
  const bg = dark ? "#0b1220" : "#ffffff";
  const border = dark ? "#334155" : "#cbd5e1";
  const gridColor = dark ? "rgba(148,163,184,0.16)" : "rgba(15,23,42,0.1)";
  const textColor = dark ? "#cbd5e1" : "#1e293b";
  const mutedText = dark ? "#94a3b8" : "#64748b";
  const layout = computePlotLayout(spec, x, y, width, height);
  const { bounds, isSparkline, padL, padT, plotW, plotH, mapX, mapY } = layout;

  ctx.save();

  // Optional dashed leader tether anchored to the schematic component/port
  if (spec.tetherTarget) {
    const anchor = computeWidgetAnchorPoint(x, y, width, height, spec.tetherTarget.x, spec.tetherTarget.y);
    const tetherColor = spec.series[0]?.color ?? "#38bdf8";
    paintWidgetLeaderTether(
      ctx,
      anchor.x,
      anchor.y,
      spec.tetherTarget.x,
      spec.tetherTarget.y,
      tetherColor,
      spec.tetherTarget.label,
    );
  }

  ctx.translate(x, y);

  // Frame background
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(0, 0, width, height, 6);
  } else {
    ctx.rect(0, 0, width, height);
  }
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!isSparkline) {
    // Title bar
    ctx.font = "600 11px sans-serif";
    ctx.fillStyle = textColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.title, 10, 12);

    // Subtle 4x4 grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = padL + (plotW * i) / 4;
      const gy = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
    }

    // Min/max axis ticks
    ctx.font = "10px monospace";
    ctx.fillStyle = mutedText;
    ctx.textAlign = "right";
    ctx.fillText(bounds.maxY.toPrecision(3), padL - 4, padT + 4);
    ctx.fillText(bounds.minY.toPrecision(3), padL - 4, padT + plotH - 2);
    ctx.textAlign = "left";
    ctx.fillText(bounds.minX.toPrecision(3), padL, height - 10);
    ctx.textAlign = "right";
    ctx.fillText(bounds.maxX.toPrecision(3), padL + plotW, height - 10);
  }

  // Requirement threshold fail bands
  if (spec.thresholds) {
    for (const th of spec.thresholds) {
      if (th.axis === "y") {
        const ty = mapY(th.value);
        ctx.fillStyle = th.color ?? "rgba(239,68,68,0.14)";
        if (th.direction === "above-fail") {
          ctx.beginPath();
          ctx.rect(padL, padT, plotW, Math.max(0, ty - padT));
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.rect(padL, ty, plotW, Math.max(0, padT + plotH - ty));
          ctx.fill();
        }
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1;
        ctx.setLineDash?.([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, ty);
        ctx.lineTo(padL + plotW, ty);
        ctx.stroke();
        ctx.setLineDash?.([]);
      }
    }
  }

  // Brushed 1D X-window highlight
  if (spec.brushX) {
    const bx0 = mapX(Math.min(spec.brushX[0], spec.brushX[1]));
    const bx1 = mapX(Math.max(spec.brushX[0], spec.brushX[1]));
    ctx.fillStyle = "rgba(56,189,248,0.18)";
    ctx.beginPath();
    ctx.rect(bx0, padT, Math.max(1, bx1 - bx0), plotH);
    ctx.fill();
  }

  // Active 2D scatter brush rectangle (widget-local coordinates clamped to plot frame)
  let localBrush: { x0: number; y0: number; x1: number; y1: number } | null = null;
  if (spec.brushRect) {
    const rawX0 = Math.min(spec.brushRect.x0, spec.brushRect.x1) - x;
    const rawX1 = Math.max(spec.brushRect.x0, spec.brushRect.x1) - x;
    const rawY0 = Math.min(spec.brushRect.y0, spec.brushRect.y1) - y;
    const rawY1 = Math.max(spec.brushRect.y0, spec.brushRect.y1) - y;
    const plotRight = padL + plotW;
    const plotBottom = padT + plotH;
    if (rawX1 >= padL && rawX0 <= plotRight && rawY1 >= padT && rawY0 <= plotBottom) {
      localBrush = {
        x0: Math.max(padL, rawX0),
        y0: Math.max(padT, rawY0),
        x1: Math.min(plotRight, rawX1),
        y1: Math.min(plotBottom, rawY1),
      };
      ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
      ctx.beginPath();
      ctx.rect(
        localBrush.x0,
        localBrush.y0,
        Math.max(1, localBrush.x1 - localBrush.x0),
        Math.max(1, localBrush.y1 - localBrush.y0),
      );
      ctx.fill();
    }
  }

  let renderedPoints = 0;
  const maxBuckets = Math.max(32, Math.min(800, Math.round(plotW * 2)));

  for (const s of spec.series) {
    const n = Math.min(s.x.length, s.y.length);
    if (n === 0) continue;

    if (spec.kind === "scatter" || spec.kind === "pareto") {
      // Strided scatter render so 50,000+ Monte Carlo samples stay under 2ms
      const stride = n > 6000 ? Math.ceil(n / 6000) : 1;
      if (!localBrush) {
        ctx.fillStyle = s.color;
        for (let i = 0; i < n; i += stride) {
          const px = mapX(s.x[i]!);
          const py = mapY(s.y[i]!);
          ctx.beginPath();
          ctx.rect(px - 1.2, py - 1.2, 2.4, 2.4);
          ctx.fill();
          renderedPoints++;
        }
      } else {
        const highlightedCoords: number[] = [];
        ctx.fillStyle = s.color;
        for (let i = 0; i < n; i += stride) {
          const px = mapX(s.x[i]!);
          const py = mapY(s.y[i]!);
          if (px >= localBrush.x0 && px <= localBrush.x1 && py >= localBrush.y0 && py <= localBrush.y1) {
            highlightedCoords.push(px, py);
          } else {
            ctx.beginPath();
            ctx.rect(px - 1.2, py - 1.2, 2.4, 2.4);
            ctx.fill();
          }
          renderedPoints++;
        }

        // Paint brushed points on top in bright amber with crisp cyan accent ring
        if (highlightedCoords.length > 0) {
          ctx.fillStyle = "#f59e0b";
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 0.8;
          for (let h = 0; h < highlightedCoords.length; h += 2) {
            const hx = highlightedCoords[h]!;
            const hy = highlightedCoords[h + 1]!;
            ctx.beginPath();
            ctx.rect(hx - 1.8, hy - 1.8, 3.6, 3.6);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    } else {
      const pts = downsampleLTTB(s.x, s.y, maxBuckets);
      if (pts.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = isSparkline ? 1.4 : 1.8;
      ctx.beginPath();
      ctx.moveTo(mapX(pts[0]!.x), mapY(pts[0]!.y));
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(mapX(pts[i]!.x), mapY(pts[i]!.y));
      }
      ctx.stroke();
      renderedPoints += pts.length;
    }
  }

  // Crisp selection border on top of scatter dots when brushRect is active
  if (localBrush) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.2;
    ctx.setLineDash?.([4, 2]);
    ctx.beginPath();
    ctx.rect(
      localBrush.x0,
      localBrush.y0,
      Math.max(1, localBrush.x1 - localBrush.x0),
      Math.max(1, localBrush.y1 - localBrush.y0),
    );
    ctx.stroke();
    ctx.setLineDash?.([]);
  }

  // Synchronized vertical timeline crosshair
  if (spec.crosshairX !== undefined && spec.crosshairX >= bounds.minX && spec.crosshairX <= bounds.maxX) {
    const cx = mapX(spec.crosshairX);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.2;
    ctx.setLineDash?.([3, 2]);
    ctx.beginPath();
    ctx.moveTo(cx, padT);
    ctx.lineTo(cx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash?.([]);
  }

  ctx.restore();
  return { renderedPoints, bounds };
}
