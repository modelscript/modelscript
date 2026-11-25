// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedGraph, type UnifiedPortItem } from "../engine/custom-graph.js";
import type { Canvas2DContextLike, DiagramMarkupNode } from "../engine/glyph-compiler.js";
import type {
  CanvasCommentThread,
  CanvasDocument,
  CanvasFrame,
  CanvasTile,
  CanvasWire,
  TileAnchorSpec,
  TileLodTier,
  WorldBounds,
} from "../schema/canvas-document.js";
import { resolveAnchorWorldPoint } from "../threads/anchor-projector.js";
import { routeCanvasWire } from "../threads/wire-router.js";
import {
  CANVAS_BOARD_THEMES,
  themedAccent,
  type CanvasBoardTheme,
  type CanvasEcadPalette,
  type CanvasSchematicPalette,
} from "./board-theme.js";
import { paintCanvasPlot, type CanvasPlotSpec, type PlotSeriesData } from "./canvas-plot.js";
import { paintCanvasTable, type CanvasTableSpec } from "./canvas-table.js";
import type { CanvasWidgetPalette } from "./palette.js";

/**
 * Shared Canvas2D `.mscanvas` board & tile painters.
 *
 * These are the single source of truth for how a canvas tile *looks* when painted onto a
 * Canvas2D surface — used by the 2D infinite canvas tile renderers (apps/web) AND by the VR
 * drafting desk texture (editor/vr-rotunda board-painter). Themes (dark / studio / blueprint)
 * only swap colours; geometry, layout and data derivation are identical so the desk keeps
 * parity with 2D by construction.
 */

/** Superset of `Canvas2DContextLike` with the optional extras the board painters feature-detect. */
export interface CanvasBoardPaintContext extends Canvas2DContextLike {
  fillRect?(x: number, y: number, w: number, h: number): void;
  strokeRect?(x: number, y: number, w: number, h: number): void;
  clip?(): void;
  quadraticCurveTo?(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo?(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  measureText?(text: string): { width: number };
  createLinearGradient?(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { addColorStop(offset: number, color: string): void };
  createRadialGradient?(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): { addColorStop(offset: number, color: string): void };
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  lineCap?: string;
  lineJoin?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitive helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG (shared with the 2D Monte Carlo preview). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function truncateCanvasLabel(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}

/** Traces a rounded rectangle path, feature-detecting `roundRect` / `quadraticCurveTo`. */
export function traceCanvasRoundedRect(
  ctx: CanvasBoardPaintContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (r > 0 && typeof ctx.quadraticCurveTo === "function") {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  } else if (r > 0 && typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
  } else {
    ctx.rect(x, y, width, height);
  }
}

function fillBox(ctx: CanvasBoardPaintContext, x: number, y: number, w: number, h: number): void {
  if (typeof ctx.fillRect === "function") {
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
  }
}

function strokeBox(ctx: CanvasBoardPaintContext, x: number, y: number, w: number, h: number): void {
  if (typeof ctx.strokeRect === "function") {
    ctx.strokeRect(x, y, w, h);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
  }
}

function clipRect(ctx: CanvasBoardPaintContext, x: number, y: number, w: number, h: number): void {
  if (typeof ctx.clip !== "function") return;
  ctx.beginPath();
  ctx.rect(x, y, Math.max(1, w), Math.max(1, h));
  ctx.clip();
}

function setShadow(ctx: CanvasBoardPaintContext, color: string, blur: number, offsetY: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = offsetY;
}

function clearShadow(ctx: CanvasBoardPaintContext): void {
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function measureWidth(ctx: CanvasBoardPaintContext, text: string, fontPx: number): number {
  if (typeof ctx.measureText === "function") {
    const m = ctx.measureText(text);
    if (m && Number.isFinite(m.width) && m.width > 0) return m.width;
  }
  return text.length * fontPx * 0.58;
}

function sampleCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Traces an absolute `M`/`L`/`C` SVG path (as produced by `routeCanvasWire`) onto a Canvas2D
 * context, so the VR desk and any Canvas2D host share the 2D canvas's exact wire routing.
 */
export function traceCanvasSvgPath(ctx: CanvasBoardPaintContext, d: string): void {
  ctx.beginPath();
  const re = /([MLC])([^MLC]*)/g;
  let cx = 0;
  let cy = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1];
    const nums = (m[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (cmd === "M" && nums.length >= 2) {
      cx = nums[0]!;
      cy = nums[1]!;
      ctx.moveTo(cx, cy);
    } else if (cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cx = nums[i]!;
        cy = nums[i + 1]!;
        ctx.lineTo(cx, cy);
      }
    } else if (cmd === "C") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const [c1x, c1y, c2x, c2y, x, y] = nums.slice(i, i + 6) as [number, number, number, number, number, number];
        if (typeof ctx.bezierCurveTo === "function") {
          ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
        } else {
          for (let s = 1; s <= 16; s++) {
            const t = s / 16;
            ctx.lineTo(sampleCubic(cx, c1x, c2x, x, t), sampleCubic(cy, c1y, c2y, y, t));
          }
        }
        cx = x;
        cy = y;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Board background, frames, wires, comments, title block
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasBoardBackgroundOptions {
  /** Screen-space pan offset for the grid (logical px). */
  panX?: number | undefined;
  panY?: number | undefined;
  /** World→screen scale applied to grid spacing. */
  scale?: number | undefined;
  /** Seed for the deterministic paper fibre pattern. */
  seed?: number | undefined;
}

/**
 * Paints the board substrate for a theme: paper fill + wash, deterministic fibre noise,
 * minor/major drafting grid (pan-aware), intersection dots and sheet-edge curl shading.
 * All strokes are batched into a handful of paths so repaints stay cheap.
 */
export function paintCanvasBoardBackground(
  ctx: CanvasBoardPaintContext,
  width: number,
  height: number,
  theme: CanvasBoardTheme,
  options: CanvasBoardBackgroundOptions = {},
): void {
  const panX = options.panX ?? 0;
  const panY = options.panY ?? 0;
  const scale = options.scale ?? 1;

  ctx.save();
  ctx.fillStyle = theme.paper;
  fillBox(ctx, 0, 0, width, height);

  if (theme.paperWash && typeof ctx.createRadialGradient === "function") {
    const g = ctx.createRadialGradient(
      width * 0.45,
      height * 0.4,
      0,
      width * 0.45,
      height * 0.4,
      Math.max(width, height) * 0.75,
    );
    g.addColorStop(0, theme.paperWash);
    g.addColorStop(1, theme.paper);
    ctx.fillStyle = g;
    fillBox(ctx, 0, 0, width, height);
  }

  if (theme.paperFiber) {
    const rand = mulberry32(options.seed ?? 0x5eed);
    ctx.strokeStyle = theme.fiberColor;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    const fibers = Math.round((width * height) / 1400);
    for (let i = 0; i < fibers; i++) {
      const fx = rand() * width;
      const fy = rand() * height;
      const ang = rand() * Math.PI;
      const len = 2 + rand() * 7;
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len);
    }
    ctx.stroke();
  }

  const step = Math.max(4, theme.gridStep * scale);
  const majorEvery = Math.max(1, Math.round(theme.gridMajorEvery));
  const majorStep = step * majorEvery;
  const offX = ((panX % majorStep) + majorStep) % majorStep;
  const offY = ((panY % majorStep) + majorStep) % majorStep;
  const startX = offX - majorStep;
  const startY = offY - majorStep;

  // Minor grid (skips lines that coincide with major lines)
  if (majorEvery > 1) {
    ctx.strokeStyle = theme.gridMinor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let idx = 0;
    for (let gx = startX; gx < width; gx += step, idx++) {
      if (idx % majorEvery === 0 || gx < 0) continue;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
    }
    idx = 0;
    for (let gy = startY; gy < height; gy += step, idx++) {
      if (idx % majorEvery === 0 || gy < 0) continue;
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = theme.gridMajor;
  ctx.lineWidth = majorEvery > 1 ? 1.2 : 1;
  ctx.beginPath();
  for (let gx = startX; gx < width; gx += majorStep) {
    if (gx < 0) continue;
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
  }
  for (let gy = startY; gy < height; gy += majorStep) {
    if (gy < 0) continue;
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
  }
  ctx.stroke();

  if (theme.gridDot) {
    ctx.fillStyle = theme.gridDot;
    ctx.beginPath();
    for (let gx = startX; gx < width; gx += majorStep) {
      if (gx < 0) continue;
      for (let gy = startY; gy < height; gy += majorStep) {
        if (gy < 0) continue;
        ctx.moveTo(gx + 1.5, gy);
        ctx.arc(gx, gy, 1.5, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  if (theme.edgeShade && typeof ctx.createLinearGradient === "function") {
    const band = Math.min(width, height) * 0.06;
    const edges: [number, number, number, number, number, number, number, number][] = [
      [0, 0, 0, band, 0, 0, width, band],
      [0, height, 0, height - band, 0, height - band, width, band],
      [0, 0, band, 0, 0, 0, band, height],
      [width, 0, width - band, 0, width - band, 0, band, height],
    ];
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, theme.edgeShade);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      fillBox(ctx, rx, ry, rw, rh);
    }
  }
  ctx.restore();
}

/** Paints grouping frames (dashed rounded outline, tinted fill, title) exactly like the 2D canvas. */
export function paintCanvasFrames(
  ctx: CanvasBoardPaintContext,
  frames: Iterable<CanvasFrame>,
  theme: CanvasBoardTheme,
): number {
  let count = 0;
  const sorted = Array.from(frames).sort((a, b) => a.zIndex - b.zIndex);
  for (const frame of sorted) {
    const b = frame.bounds;
    ctx.save();
    if (theme.frameFillAlpha !== "00" && /^#[0-9a-fA-F]{6}$/.test(frame.color)) {
      ctx.fillStyle = `${frame.color}${theme.frameFillAlpha}`;
      traceCanvasRoundedRect(ctx, b.x, b.y, b.width, b.height, 12);
      ctx.fill();
    }
    ctx.strokeStyle = theme.frameStrokeOverride ?? frame.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash?.([6, 4]);
    traceCanvasRoundedRect(ctx, b.x, b.y, b.width, b.height, 12);
    ctx.stroke();
    ctx.setLineDash?.([]);
    ctx.fillStyle = theme.frameTitle;
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(frame.title, b.x + 12, b.y + 16);
    ctx.restore();
    count++;
  }
  return count;
}

export interface CanvasWirePaintOptions {
  /** Substitutes live tile state (e.g. transient drag bounds) before anchor projection. */
  resolveTile?: ((tile: CanvasTile) => CanvasTile) | undefined;
  /** Paint `liveValue` labels at the routed midpoint (2D hides them below zoom 0.4). */
  showLabels?: boolean | undefined;
  /** Wire IDs to fade (blast-radius lens). */
  dimmedWireIds?: ReadonlySet<string> | undefined;
  /** Multiplier for stroke widths (e.g. to stay legible on a down-scaled VR desk). */
  lineScale?: number | undefined;
}

export function resolveCanvasWireColor(wire: CanvasWire, theme: CanvasBoardTheme): string {
  if (wire.status === "conflict") return theme.wireConflict;
  if (wire.status === "stale" || wire.status === "unit-mismatch") return theme.wireStale;
  return theme.wireColors[wire.kind];
}

/**
 * Paints Digital Thread wires using the 2D canvas's anchor projection (`resolveAnchorWorldPoint`)
 * and routing (`routeCanvasWire`): orthogonal FMI pipes, bezier ribbons, endpoint dots and labels.
 */
export function paintCanvasWires(
  ctx: CanvasBoardPaintContext,
  doc: Pick<CanvasDocument, "tiles" | "wires">,
  theme: CanvasBoardTheme,
  options: CanvasWirePaintOptions = {},
): number {
  const lineScale = options.lineScale ?? 1;
  const showLabels = options.showLabels ?? true;
  let drawn = 0;
  for (const wire of Object.values(doc.wires)) {
    const rawSrc = doc.tiles[wire.source.tileId];
    const rawDst = doc.tiles[wire.target.tileId];
    if (!rawSrc || !rawDst) continue;
    const srcTile = options.resolveTile ? options.resolveTile(rawSrc) : rawSrc;
    const dstTile = options.resolveTile ? options.resolveTile(rawDst) : rawDst;
    const src = resolveAnchorWorldPoint(srcTile, wire.source.anchorPath, { isSource: true, lod: "interactive" });
    const dst = resolveAnchorWorldPoint(dstTile, wire.target.anchorPath, { isSource: false, lod: "interactive" });
    const routed = routeCanvasWire(wire, src, dst);
    const color = resolveCanvasWireColor(wire, theme);
    const dimmed = options.dimmedWireIds?.has(wire.id) ?? false;

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.15 : 0.92;
    ctx.strokeStyle = color;
    ctx.lineWidth = (wire.kind === "fmi-signal" ? 2.5 : 2) * lineScale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (wire.status === "stale") ctx.setLineDash?.([6, 4]);
    traceCanvasSvgPath(ctx, routed.svgPath);
    ctx.stroke();
    ctx.setLineDash?.([]);

    ctx.fillStyle = color;
    ctx.strokeStyle = theme.wireEndpointStroke;
    ctx.lineWidth = 1.2 * lineScale;
    for (const pt of [routed.start, routed.end]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4 * lineScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (showLabels && wire.liveValue) {
      const fontPx = 11 * Math.max(1, lineScale * 0.9);
      ctx.font = `600 ${fontPx}px sans-serif`;
      const tw = measureWidth(ctx, wire.liveValue, fontPx);
      const lx = routed.labelPoint.x;
      const ly = routed.labelPoint.y - 6 * lineScale;
      ctx.fillStyle = theme.wireLabelHalo;
      traceCanvasRoundedRect(ctx, lx - tw / 2 - 4, ly - fontPx * 0.7, tw + 8, fontPx * 1.4, 4);
      ctx.fill();
      ctx.fillStyle = theme.wireLabel;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(wire.liveValue, lx, ly);
    }
    ctx.restore();
    drawn++;
  }
  return drawn;
}

/** Paints unresolved review comment pins (sticky notes) like the 2D canvas overlay. */
export function paintCanvasComments(
  ctx: CanvasBoardPaintContext,
  comments: Iterable<CanvasCommentThread>,
  theme: CanvasBoardTheme,
): number {
  let drawn = 0;
  for (const c of comments) {
    if (c.resolved) continue;
    const text = truncateCanvasLabel(c.text, 64);
    ctx.save();
    ctx.font = "500 11px sans-serif";
    const w = Math.min(200, Math.max(80, measureWidth(ctx, text, 11) + 20));
    const h = 38;
    setShadow(ctx, "rgba(0,0,0,0.35)", 12, 4);
    ctx.fillStyle = theme.commentFill;
    traceCanvasRoundedRect(ctx, c.position.x, c.position.y, w, h, 8);
    ctx.fill();
    clearShadow(ctx);
    ctx.fillStyle = theme.commentText;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "700 10px sans-serif";
    ctx.fillText(c.authorName, c.position.x + 10, c.position.y + 12);
    ctx.font = "500 11px sans-serif";
    ctx.fillText(text, c.position.x + 10, c.position.y + 27);
    ctx.restore();
    drawn++;
  }
  return drawn;
}

export interface CanvasTitleBlockSpec {
  title: string;
  drawingNumber?: string | undefined;
  subtitle?: string | undefined;
  drawnBy?: string | undefined;
  sheet?: string | undefined;
  scale?: string | undefined;
  tileCount?: number | undefined;
  wireCount?: number | undefined;
  date?: string | undefined;
  revision?: string | undefined;
}

/**
 * Paints an ANSI/ISO-style blueprint engineering border frame (double perimeter rule,
 * alphanumeric zone ticks 1–6 / A–D, and midpoint registration marks) around a drawing sheet.
 */
export function paintCanvasBlueprintFrame(
  ctx: CanvasBoardPaintContext,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: CanvasBoardTheme,
): void {
  if (!theme.borderFrame || width < 120 || height < 80) return;

  const outerInset = 10;
  const innerInset = 24;
  const ox = x + outerInset;
  const oy = y + outerInset;
  const ow = width - outerInset * 2;
  const oh = height - outerInset * 2;
  const ix = x + innerInset;
  const iy = y + innerInset;
  const iw = width - innerInset * 2;
  const ih = height - innerInset * 2;

  ctx.save();
  // Outer thick framing border + inner drawing field hairline
  ctx.strokeStyle = theme.cardStroke;
  ctx.lineWidth = 1.6;
  strokeBox(ctx, ox, oy, ow, oh);

  ctx.strokeStyle = theme.cardHairline;
  ctx.lineWidth = 0.9;
  strokeBox(ctx, ix, iy, iw, ih);

  // Zone dividers & alphanumeric references (1..6 horizontally, A..D vertically)
  const hZones = 6;
  const vZones = 4;
  const zoneLetters = ["A", "B", "C", "D"];

  ctx.strokeStyle = theme.cardHairline;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  for (let i = 1; i < hZones; i++) {
    const zx = ix + (iw * i) / hZones;
    ctx.moveTo(zx, oy);
    ctx.lineTo(zx, iy);
    ctx.moveTo(zx, iy + ih);
    ctx.lineTo(zx, oy + oh);
  }
  for (let j = 1; j < vZones; j++) {
    const zy = iy + (ih * j) / vZones;
    ctx.moveTo(ox, zy);
    ctx.lineTo(ix, zy);
    ctx.moveTo(ix + iw, zy);
    ctx.lineTo(ox + ow, zy);
  }
  ctx.stroke();

  // Midpoint centering registration ticks (heavier lineweight)
  const midX = x + width * 0.5;
  const midY = y + height * 0.5;
  ctx.strokeStyle = theme.cardStroke;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(midX, oy - 3);
  ctx.lineTo(midX, iy + 6);
  ctx.moveTo(midX, oy + oh + 3);
  ctx.lineTo(midX, iy + ih - 6);
  ctx.moveTo(ox - 3, midY);
  ctx.lineTo(ix + 6, midY);
  ctx.moveTo(ox + ow + 3, midY);
  ctx.lineTo(ix + iw - 6, midY);
  ctx.stroke();

  // Zone numbers & letters centered in margin channels
  ctx.fillStyle = theme.chromeMuted;
  ctx.font = "700 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const topLabelY = (oy + iy) * 0.5;
  const botLabelY = (iy + ih + oy + oh) * 0.5;
  for (let i = 0; i < hZones; i++) {
    const zx = ix + (iw * (i + 0.5)) / hZones;
    const lbl = String(i + 1);
    ctx.fillText(lbl, zx, topLabelY);
    ctx.fillText(lbl, zx, botLabelY);
  }
  const leftLabelX = (ox + ix) * 0.5;
  const rightLabelX = (ix + iw + ox + ow) * 0.5;
  for (let j = 0; j < vZones; j++) {
    const zy = iy + (ih * (j + 0.5)) / vZones;
    const lbl = zoneLetters[j] ?? String.fromCharCode(65 + j);
    ctx.fillText(lbl, leftLabelX, zy);
    ctx.fillText(lbl, rightLabelX, zy);
  }

  ctx.restore();
}

/** Paints an engineering drawing title block (blueprint sheets) at the given rectangle. */
export function paintCanvasTitleBlock(
  ctx: CanvasBoardPaintContext,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: CanvasBoardTheme,
  spec: CanvasTitleBlockSpec,
): void {
  ctx.save();
  ctx.fillStyle = theme.chromeFill;
  ctx.globalAlpha = 0.92;
  fillBox(ctx, x, y, width, height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.cardStroke;
  ctx.lineWidth = 1.6;
  strokeBox(ctx, x, y, width, height);

  const rowH = height / 3;
  const col1X = x + width * 0.52;
  const col2X = x + width * 0.78;
  ctx.strokeStyle = theme.cardHairline;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(x, y + rowH);
  ctx.lineTo(x + width, y + rowH);
  ctx.moveTo(x, y + rowH * 2);
  ctx.lineTo(x + width, y + rowH * 2);
  ctx.moveTo(col1X, y + rowH);
  ctx.lineTo(col1X, y + height);
  ctx.moveTo(col2X, y + rowH);
  ctx.lineTo(col2X, y + height);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.chromeText;
  ctx.font = `700 ${Math.max(10, Math.round(rowH * 0.44))}px sans-serif`;
  ctx.fillText(truncateCanvasLabel(spec.title.toUpperCase(), 38), x + 8, y + rowH * 0.5);

  const label = (text: string, lx: number, ly: number): void => {
    ctx.fillStyle = theme.chromeMuted;
    ctx.font = `600 ${Math.max(7, Math.round(rowH * 0.25))}px monospace`;
    ctx.fillText(text, lx, ly);
  };
  const value = (text: string, lx: number, ly: number): void => {
    ctx.fillStyle = theme.chromeText;
    ctx.font = `600 ${Math.max(8, Math.round(rowH * 0.32))}px monospace`;
    ctx.fillText(text, lx, ly);
  };

  const dwgNo = spec.drawingNumber ?? spec.subtitle ?? "MS-001";
  const itemsText =
    spec.tileCount !== undefined
      ? `${spec.tileCount} TILES${spec.wireCount !== undefined ? ` · ${spec.wireCount} WIRES` : ""}`
      : (spec.drawnBy ?? "MODELSCRIPT");
  const dateRev = [spec.date, spec.revision ?? "REV A"].filter(Boolean).join(" · ");

  label("DWG NO", x + 8, y + rowH * 1.28);
  value(truncateCanvasLabel(dwgNo.toUpperCase(), 20), x + 8, y + rowH * 1.72);
  label("SCALE", col1X + 6, y + rowH * 1.28);
  value(spec.scale ?? "1:1", col1X + 6, y + rowH * 1.72);
  label("SHEET", col2X + 6, y + rowH * 1.28);
  value(spec.sheet ?? "1/1", col2X + 6, y + rowH * 1.72);

  label("INVENTORY", x + 8, y + rowH * 2.28);
  value(truncateCanvasLabel(itemsText, 22), x + 8, y + rowH * 2.72);
  label("DATE / REV", col1X + 6, y + rowH * 2.28);
  value(truncateCanvasLabel(dateRev, 18), col1X + 6, y + rowH * 2.72);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile card chrome
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasTileCardOptions {
  /** Semantic tile accent (descriptor accent colour); themes may override it. */
  accent: string;
  /** Header strip height (2D canvas: 36). */
  headerHeight?: number | undefined;
  /** Title font size in px (2D canvas: 12). */
  titleFontPx?: number | undefined;
  /** Optional right-aligned badge text (2D canvas: language id). */
  badge?: string | undefined;
  /** Optional subtitle drawn under the title when the header is tall enough. */
  subtitle?: string | undefined;
  selected?: boolean | undefined;
  focused?: boolean | undefined;
  /** Corner radius (2D canvas: 10). */
  radius?: number | undefined;
  /** Width reserved at the right of the header for host buttons (e.g. VR maximize). */
  reserveRight?: number | undefined;
  /** Inner content padding (2D canvas: 8). */
  padding?: number | undefined;
}

/**
 * Paints a tile card (raised card + header strip with title & language badge + accent rule +
 * health/selection border) and returns the inner content rectangle.
 */
export function paintCanvasTileCard(
  ctx: CanvasBoardPaintContext,
  tile: CanvasTile,
  b: WorldBounds,
  theme: CanvasBoardTheme,
  options: CanvasTileCardOptions,
): WorldBounds {
  const headerH = options.headerHeight ?? 36;
  const fontPx = options.titleFontPx ?? 12;
  const radius = options.radius ?? 10;
  const pad = options.padding ?? 8;
  const accent = themedAccent(theme, options.accent);

  ctx.save();
  setShadow(ctx, theme.cardShadow, theme.cardShadowBlur, theme.cardShadowOffsetY);
  ctx.fillStyle = theme.cardFill;
  traceCanvasRoundedRect(ctx, b.x, b.y, b.width, b.height, radius);
  ctx.fill();
  clearShadow(ctx);

  // Header strip + accent rule clipped to the card silhouette
  ctx.save();
  traceCanvasRoundedRect(ctx, b.x, b.y, b.width, b.height, radius);
  if (typeof ctx.clip === "function") ctx.clip();
  ctx.fillStyle = theme.cardHeaderFill;
  fillBox(ctx, b.x, b.y, b.width, headerH);
  ctx.fillStyle = accent;
  fillBox(ctx, b.x, b.y + headerH - 2, b.width, 2);
  ctx.restore();

  if (theme.cardInnerRule) {
    ctx.strokeStyle = theme.cardInnerRule;
    ctx.lineWidth = 0.8;
    traceCanvasRoundedRect(ctx, b.x + 3.5, b.y + 3.5, b.width - 7, b.height - 7, Math.max(0, radius - 3));
    ctx.stroke();
  }

  const isError = tile.health === "error";
  ctx.strokeStyle = isError ? theme.wireConflict : options.selected ? accent : theme.cardStroke;
  ctx.lineWidth = isError || options.selected ? 2 : theme.accentOverride ? 1.4 : 1;
  traceCanvasRoundedRect(ctx, b.x, b.y, b.width, b.height, radius);
  ctx.stroke();
  if (options.focused) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    traceCanvasRoundedRect(ctx, b.x - 3, b.y - 3, b.width + 6, b.height + 6, radius + 3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Language badge (right) + title (left)
  const reserveRight = options.reserveRight ?? 0;
  let titleMaxRight = b.x + b.width - 10 - reserveRight;
  if (options.badge) {
    const badgeFont = Math.max(9, Math.round(fontPx * 0.82));
    ctx.font = `600 ${badgeFont}px sans-serif`;
    const text = options.badge.toUpperCase();
    const bw = measureWidth(ctx, text, badgeFont) + 12;
    const bh = badgeFont + 8;
    const bx = titleMaxRight - bw;
    const by = b.y + (headerH - bh) / 2 - 1;
    ctx.fillStyle = theme.accentOverride ? theme.badgeFill : `${accent}33`;
    traceCanvasRoundedRect(ctx, bx, by, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = theme.accentOverride ? theme.badgeText : accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
    titleMaxRight = bx - 8;
  }

  const hasSubtitle = Boolean(options.subtitle) && headerH >= fontPx * 2.6 + 8;
  ctx.fillStyle = theme.cardTitle;
  ctx.font = `600 ${fontPx}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const maxChars = Math.max(6, Math.floor((titleMaxRight - b.x - 10) / (fontPx * 0.56)));
  ctx.fillText(
    truncateCanvasLabel(tile.title, maxChars),
    b.x + 10,
    b.y + (hasSubtitle ? headerH * 0.36 : headerH / 2 - 1),
  );
  if (hasSubtitle && options.subtitle) {
    const subPx = Math.max(9, Math.round(fontPx * 0.68));
    ctx.fillStyle = theme.cardSubtitle;
    ctx.font = `${subPx}px monospace`;
    ctx.fillText(
      truncateCanvasLabel(options.subtitle, Math.max(6, Math.floor((titleMaxRight - b.x - 10) / (subPx * 0.6)))),
      b.x + 10,
      b.y + headerH * 0.7,
    );
  }
  ctx.restore();

  return {
    x: b.x + pad,
    y: b.y + headerH + pad,
    width: Math.max(10, b.width - pad * 2),
    height: Math.max(10, b.height - headerH - pad * 2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared tile data derivation (identical in 2D and VR)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasDiagramNodeLike {
  id?: string | undefined;
  shape?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  opacity?: number | undefined;
  zIndex?: number | undefined;
  label?: string | undefined;
  markup?: DiagramMarkupNode | DiagramMarkupNode[] | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  ports?:
    | { items?: UnifiedPortItem[] | undefined; groups?: Record<string, unknown> | undefined }
    | UnifiedPortItem[]
    | undefined;
  data?: Record<string, unknown> | undefined;
  properties?: { name?: string | undefined; className?: string | undefined } | undefined;
}

export interface CanvasDiagramEdgeLike {
  id?: string | undefined;
  source?:
    | string
    | { cell?: string | undefined; port?: string | undefined; x?: number | undefined; y?: number | undefined }
    | undefined;
  target?:
    | string
    | { cell?: string | undefined; port?: string | undefined; x?: number | undefined; y?: number | undefined }
    | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  connector?: unknown;
  router?: unknown;
  zIndex?: number | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
}

export interface CanvasDiagramDataLike {
  nodes: CanvasDiagramNodeLike[];
  edges: CanvasDiagramEdgeLike[];
}

/** Extracts serialized schematic nodes & edges from `tile.viewState.diagramData`. */
export function extractCanvasDiagramData(raw: unknown): CanvasDiagramDataLike | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec["nodes"]) || rec["nodes"].length === 0) return null;
  const nodes: CanvasDiagramNodeLike[] = [];
  for (const item of rec["nodes"]) {
    if (item && typeof item === "object") nodes.push(item as CanvasDiagramNodeLike);
  }
  if (nodes.length === 0) return null;
  const edges: CanvasDiagramEdgeLike[] = [];
  if (Array.isArray(rec["edges"])) {
    for (const item of rec["edges"]) {
      if (item && typeof item === "object") edges.push(item as CanvasDiagramEdgeLike);
    }
  }
  return { nodes, edges };
}

/** Extracts validated `PlotSeriesData` trajectories from `tile.viewState.simulationSeries`. */
export function extractCanvasSimulationSeries(raw: unknown, defaultColor = "#14b8a6"): PlotSeriesData[] {
  if (!Array.isArray(raw)) return [];
  const out: PlotSeriesData[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec["id"] === "string" && rec["id"].length > 0 ? rec["id"] : `series_${i}`;
    const label = typeof rec["label"] === "string" && rec["label"].length > 0 ? rec["label"] : id;
    const color = typeof rec["color"] === "string" && rec["color"].length > 0 ? rec["color"] : defaultColor;
    const unit = typeof rec["unit"] === "string" ? rec["unit"] : undefined;
    const rawX = rec["x"];
    const rawY = rec["y"];
    const validX = rawX instanceof Float64Array || (Array.isArray(rawX) && rawX.every((v) => typeof v === "number"));
    const validY = rawY instanceof Float64Array || (Array.isArray(rawY) && rawY.every((v) => typeof v === "number"));
    if (!validX || !validY) continue;
    const x = rawX as Float64Array | number[];
    const y = rawY as Float64Array | number[];
    if (Math.min(x.length, y.length) === 0) continue;
    out.push({ id, label, color, unit, x, y });
  }
  return out;
}

export function computeCanvasSeriesXRange(series: PlotSeriesData[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const n = Math.min(s.x.length, s.y.length);
    for (let i = 0; i < n; i++) {
      const xv = s.x[i];
      if (xv !== undefined && Number.isFinite(xv)) {
        if (xv < lo) lo = xv;
        if (xv > hi) hi = xv;
      }
    }
  }
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return [lo, hi];
  return [0, 10];
}

/** Live Monte Carlo mean mass bound to the `input.mass` anchor (defaults to 2.14 kg). */
export function resolveCanvasTileMeanMass(tile: CanvasTile): number {
  const raw = tile.pinnedAnchors?.find((a) => a.path === "input.mass")?.currentValue ?? "2.14";
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 2.14;
}

export interface CanvasAnalyticsPlotOptions {
  simulationTime?: number | undefined;
  brushX?: [number, number] | undefined;
  lod?: TileLodTier | undefined;
  dark?: boolean | undefined;
  palette?: Partial<CanvasWidgetPalette> | undefined;
  /** Colour for the synthesized parametric series (real series keep their own colours). */
  parametricColor?: string | undefined;
  /** Pre-extracted real series (avoids re-validating on every repaint). */
  realSeries?: PlotSeriesData[] | undefined;
}

/**
 * Builds the analytics tile plot spec: real `simulationSeries` when present, otherwise the
 * deterministic 2,000-sample transient envelope bound to the live mass parameter with the
 * REQ-042 threshold band.
 */
export function buildCanvasAnalyticsPlotSpec(
  tile: CanvasTile,
  options: CanvasAnalyticsPlotOptions = {},
): CanvasPlotSpec {
  const realSeries = options.realSeries ?? extractCanvasSimulationSeries(tile.viewState?.["simulationSeries"]);
  let series: PlotSeriesData[];
  let title: string;
  let thresholds: CanvasPlotSpec["thresholds"];
  if (realSeries.length > 0) {
    series = realSeries;
    title = tile.title;
    thresholds = undefined;
  } else {
    const meanMass = resolveCanvasTileMeanMass(tile);
    const n = 2000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 10;
      xs[i] = t;
      ys[i] = 330 + (meanMass - 1.8) * 32 + 14 * Math.sin(t * 0.9) + 4 * Math.cos(t * 2.7);
    }
    series = [
      { id: "T_max", label: "T_max (K)", color: options.parametricColor ?? "#14b8a6", unit: "K", x: xs, y: ys },
    ];
    title = `${tile.title} (m=${meanMass.toFixed(2)} kg)`;
    thresholds = [{ label: "REQ-042 Max Temp (360 K)", axis: "y", value: 360, direction: "above-fail" }];
  }
  return {
    id: tile.id,
    title,
    kind: "timeseries",
    series,
    thresholds,
    crosshairX: options.simulationTime,
    brushX: options.brushX,
    dark: options.dark ?? true,
    palette: options.palette,
    lod: options.lod,
  };
}

/** Builds the ReqIF / specification table spec (ID · Specification · Verification) for a table tile. */
export function buildCanvasRequirementTableSpec(
  tile: CanvasTile,
  options: {
    highlightedRowIds?: string[] | undefined;
    dark?: boolean | undefined;
    palette?: Partial<CanvasWidgetPalette> | undefined;
  } = {},
): CanvasTableSpec {
  return {
    title: tile.title,
    columns: [
      { key: "id", label: "ID", widthRatio: 0.22 },
      { key: "spec", label: "Specification", widthRatio: 0.5 },
      { key: "verify", label: "Verification", widthRatio: 0.28, align: "right" },
    ],
    rows: (tile.pinnedAnchors ?? []).map((a) => {
      const upper = (a.currentValue ?? "").toUpperCase();
      return {
        id: a.path,
        cells: { id: a.path, spec: a.label, verify: a.currentValue ?? "PENDING" },
        status: upper.includes("FAIL") ? "fail" : upper.includes("PASS") ? "pass" : "stale",
      };
    }),
    highlightedRowIds: options.highlightedRowIds,
    dark: options.dark ?? true,
    palette: options.palette,
  };
}

export const CANVAS_CODE_KEYWORDS: ReadonlySet<string> = new Set([
  "model",
  "end",
  "parameter",
  "constant",
  "equation",
  "algorithm",
  "Real",
  "Integer",
  "Boolean",
  "String",
  "connect",
  "der",
  "import",
  "package",
  "block",
  "connector",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "const",
  "let",
  "var",
  "struct",
  "param",
  "set",
  "minimize",
  "maximize",
  "subject",
]);

/** Source text shown in a code/markdown/notes tile: `viewState.code/sourceCode/markdown/notes/text`, else anchor projection. */
export function buildCanvasTileSourceCode(tile: CanvasTile): string {
  const fromViewState =
    tile.viewState?.["code"] ??
    tile.viewState?.["sourceCode"] ??
    tile.viewState?.["markdown"] ??
    tile.viewState?.["notes"] ??
    tile.viewState?.["text"];
  if (typeof fromViewState === "string" && fromViewState.trim().length > 0) {
    return fromViewState;
  }
  const symbol = tile.targetSymbol ?? "SystemComponent";
  const anchorLines: string[] = [];
  for (const anchor of tile.pinnedAnchors ?? []) {
    const match = /-?\d+(?:\.\d+)?/.exec(anchor.currentValue ?? "");
    const val = match ? match[0] : "1.0";
    const varName = anchor.path.split(".").pop() ?? anchor.path;
    anchorLines.push(`  parameter Real ${varName} = ${val}; // ${anchor.label}`);
  }
  if (anchorLines.length === 0) {
    anchorLines.push("  parameter Real mass = 2.14;", "  parameter Real R_th = 1.4;");
  }
  return [
    `// ${tile.artifactUri}`,
    `model ${symbol}`,
    ...anchorLines,
    "equation",
    "  // Live ModelScript / Polyglot workspace projection",
    `end ${symbol};`,
  ].join("\n");
}

export type CanvasCodeTokenKind = "plain" | "ident" | "keyword" | "string" | "number" | "comment";

export interface CanvasCodeToken {
  text: string;
  kind: CanvasCodeTokenKind;
}

/** Lightweight polyglot syntax tokenizer shared by the 2D code preview and Canvas2D listings. */
export function tokenizeCanvasCodeLine(line: string): CanvasCodeToken[] {
  const commentMatch = /(\/\/.*$|--.*$|#.*$)/.exec(line);
  const codePart = commentMatch ? line.slice(0, commentMatch.index) : line;
  const commentPart = commentMatch ? commentMatch[0] : "";
  const tokens: CanvasCodeToken[] = [];
  const tokenRe =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null = tokenRe.exec(codePart);
  while (match !== null) {
    if (match.index > lastIdx) tokens.push({ text: codePart.slice(lastIdx, match.index), kind: "plain" });
    const text = match[0];
    const kind: CanvasCodeTokenKind =
      text.startsWith('"') || text.startsWith("'")
        ? "string"
        : /^\d/.test(text)
          ? "number"
          : CANVAS_CODE_KEYWORDS.has(text)
            ? "keyword"
            : "ident";
    tokens.push({ text, kind });
    lastIdx = match.index + text.length;
    match = tokenRe.exec(codePart);
  }
  if (lastIdx < codePart.length) tokens.push({ text: codePart.slice(lastIdx), kind: "plain" });
  if (commentPart) tokens.push({ text: commentPart, kind: "comment" });
  return tokens;
}

export interface CanvasEcadLayerVisibility {
  fCu: boolean;
  bCu: boolean;
  silk: boolean;
  edge: boolean;
}

/** Initial PCB layer visibility from `tile.viewState.layers`. */
export function resolveCanvasEcadLayers(viewState: Record<string, unknown> | undefined): CanvasEcadLayerVisibility {
  const raw = viewState?.["layers"];
  if (!Array.isArray(raw)) return { fCu: true, bCu: true, silk: true, edge: true };
  const names = new Set(raw.filter((v): v is string => typeof v === "string"));
  return {
    fCu: names.size === 0 || names.has("F.Cu"),
    bCu: names.size === 0 || names.has("B.Cu"),
    silk: names.size === 0 || names.has("F.SilkS"),
    edge: names.size === 0 || names.has("Edge.Cuts"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schematic (UnifiedGraph) population
// ─────────────────────────────────────────────────────────────────────────────

export function createCanvasSchematicBlockMarkup(
  width: number,
  height: number,
  strokeColor: string,
  title: string,
  subtitle: string | undefined,
  ports: { x: number; y: number; color: string }[],
  palette: CanvasSchematicPalette = CANVAS_BOARD_THEMES.dark.schematic,
): DiagramMarkupNode[] {
  const nodes: DiagramMarkupNode[] = [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        x: 0,
        y: 0,
        width,
        height,
        rx: 6,
        ry: 6,
        fill: palette.nodeFill,
        stroke: strokeColor,
        "stroke-width": palette.strokeWidth,
      },
    },
    {
      tagName: "rect",
      selector: "headerBg",
      attrs: {
        x: 1,
        y: 1,
        width: Math.max(2, width - 2),
        height: Math.min(16, Math.max(10, height * 0.34)),
        rx: 5,
        ry: 5,
        fill: strokeColor,
        opacity: palette.headerOpacity,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        x: width / 2,
        y: subtitle ? height * 0.42 : height * 0.52,
        "text-anchor": "middle",
        fill: palette.label,
        "font-size": 10,
        "font-weight": "600",
        "font-family": "sans-serif",
      },
      textContent: title,
    },
  ];
  if (subtitle) {
    nodes.push({
      tagName: "text",
      selector: "sublabel",
      attrs: {
        x: width / 2,
        y: height * 0.74,
        "text-anchor": "middle",
        fill: palette.sublabel,
        "font-size": 8.5,
        "font-family": "monospace",
      },
      textContent: subtitle,
    });
  }
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    if (!p) continue;
    nodes.push({
      tagName: "circle",
      selector: `port_dot_${i}`,
      attrs: { cx: p.x, cy: p.y, r: 3.4, fill: p.color, stroke: palette.portStroke, "stroke-width": 1.2 },
    });
  }
  return nodes;
}

/**
 * Populates a `UnifiedGraph` for a `schematic`/`fmu` tile: either the serialized
 * `viewState.diagramData`, or a synthesized I/O block diagram from the pinned anchors
 * (inputs left, outputs right, parameters below the core block).
 */
export function populateCanvasSchematicGraph(
  graph: UnifiedGraph,
  tile: CanvasTile,
  accentColor: string,
  simulationTime: number,
  diagramData: CanvasDiagramDataLike | null,
  palette: CanvasSchematicPalette = CANVAS_BOARD_THEMES.dark.schematic,
): void {
  if (diagramData) {
    for (let i = 0; i < diagramData.nodes.length; i++) {
      const n = diagramData.nodes[i];
      if (!n) continue;
      const id = n.id ?? `node_${i}`;
      const width = typeof n.width === "number" && n.width > 0 ? n.width : 96;
      const height = typeof n.height === "number" && n.height > 0 ? n.height : 50;
      const x = typeof n.x === "number" ? n.x : 20 + (i % 3) * 130;
      const y = typeof n.y === "number" ? n.y : 24 + Math.floor(i / 3) * 84;
      const fallbackLabel = truncateCanvasLabel(n.label ?? n.properties?.name ?? id, 16);
      graph.addNode({
        id,
        shape: n.shape ?? "rect",
        x,
        y,
        width,
        height,
        angle: n.angle ?? 0,
        opacity: n.opacity ?? 1,
        zIndex: n.zIndex ?? 1,
        markup: n.markup,
        attrs: n.attrs ?? {
          body: { fill: palette.nodeFill, stroke: accentColor, strokeWidth: palette.strokeWidth, rx: 6, ry: 6 },
          label: { text: fallbackLabel, fill: palette.label, fontSize: 10 },
        },
        ports: n.ports,
        data: n.data,
      });
    }
    for (let i = 0; i < diagramData.edges.length; i++) {
      const e = diagramData.edges[i];
      if (!e) continue;
      graph.addEdge({
        id: e.id ?? `edge_${i}`,
        source: e.source,
        target: e.target,
        vertices: e.vertices,
        connector: e.connector ?? { name: "rounded", args: { radius: 6 } },
        router: e.router,
        zIndex: e.zIndex ?? 0,
        attrs: e.attrs ?? { line: { stroke: accentColor, strokeWidth: 1.8 } },
      });
    }
    return;
  }

  const coreStroke = palette.coreStroke ?? accentColor;
  const anchors = tile.pinnedAnchors ?? [];
  const coreTitle = truncateCanvasLabel(tile.targetSymbol ?? tile.title.replace(/\s*\([^)]*\)\s*$/, ""), 16);
  const coreSubtitle =
    simulationTime > 0
      ? `t=${simulationTime.toFixed(2)}s`
      : tile.archetype === "fmu"
        ? "FMU 3.0"
        : tile.languageId.toUpperCase();

  if (anchors.length === 0) {
    const leftTitle = tile.archetype === "fmu" ? "FMU In" : tile.languageId === "simulink" ? "PID Gain" : "Source";
    const rightTitle = tile.archetype === "fmu" ? "FMU Out" : tile.languageId === "simulink" ? "Clamp" : "Monitor";
    graph.addNode({
      id: "stage_in",
      x: 16,
      y: 62,
      width: 76,
      height: 46,
      markup: createCanvasSchematicBlockMarkup(
        76,
        46,
        palette.input,
        leftTitle,
        undefined,
        [{ x: 76, y: 23, color: palette.input }],
        palette,
      ),
      ports: { items: [{ id: "out", args: { x: 76, y: 23 } }] },
    });
    graph.addNode({
      id: "stage_core",
      x: 126,
      y: 48,
      width: 108,
      height: 74,
      markup: createCanvasSchematicBlockMarkup(
        108,
        74,
        coreStroke,
        coreTitle,
        coreSubtitle,
        [
          { x: 0, y: 37, color: palette.input },
          { x: 108, y: 37, color: palette.output },
        ],
        palette,
      ),
      ports: {
        items: [
          { id: "in", args: { x: 0, y: 37 } },
          { id: "out", args: { x: 108, y: 37 } },
        ],
      },
    });
    graph.addNode({
      id: "stage_out",
      x: 268,
      y: 62,
      width: 76,
      height: 46,
      markup: createCanvasSchematicBlockMarkup(
        76,
        46,
        palette.output,
        rightTitle,
        undefined,
        [{ x: 0, y: 23, color: palette.output }],
        palette,
      ),
      ports: { items: [{ id: "in", args: { x: 0, y: 23 } }] },
    });
    graph.addEdge({
      id: "e_in_core",
      source: { cell: "stage_in", port: "out" },
      target: { cell: "stage_core", port: "in" },
      vertices: [
        { x: 109, y: 85 },
        { x: 109, y: 85 },
      ],
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: palette.input, strokeWidth: 1.8 } },
    });
    graph.addEdge({
      id: "e_core_out",
      source: { cell: "stage_core", port: "out" },
      target: { cell: "stage_out", port: "in" },
      vertices: [
        { x: 251, y: 85 },
        { x: 251, y: 85 },
      ],
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: palette.output, strokeWidth: 1.8 } },
    });
    return;
  }

  const inputs: TileAnchorSpec[] = [];
  const outputs: TileAnchorSpec[] = [];
  const params: TileAnchorSpec[] = [];
  for (const anchor of anchors) {
    if (anchor.kind === "fmi-input") inputs.push(anchor);
    else if (anchor.kind === "fmi-output") outputs.push(anchor);
    else if (anchor.kind === "parameter") params.push(anchor);
    else if (anchor.side === "left") inputs.push(anchor);
    else if (anchor.side === "right") outputs.push(anchor);
    else params.push(anchor);
  }

  const sideSlots = Math.max(1, inputs.length, outputs.length);
  const coreX = 122;
  const coreY = 18;
  const coreW = 114;
  const coreH = Math.max(76, sideSlots * 38 + 16);
  const corePorts: UnifiedPortItem[] = [];
  const corePortMarkers: { x: number; y: number; color: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const py = ((i + 1) / (inputs.length + 1)) * coreH;
    corePorts.push({ id: `in_${i}`, group: "in", args: { x: 0, y: py } });
    corePortMarkers.push({ x: 0, y: py, color: palette.input });
  }
  for (let i = 0; i < outputs.length; i++) {
    const py = ((i + 1) / (outputs.length + 1)) * coreH;
    corePorts.push({ id: `out_${i}`, group: "out", args: { x: coreW, y: py } });
    corePortMarkers.push({ x: coreW, y: py, color: palette.output });
  }
  for (let i = 0; i < params.length; i++) {
    const px = ((i + 1) / (params.length + 1)) * coreW;
    corePorts.push({ id: `param_${i}`, group: "param", args: { x: px, y: coreH } });
    corePortMarkers.push({ x: px, y: coreH, color: palette.parameter });
  }
  graph.addNode({
    id: "core",
    x: coreX,
    y: coreY,
    width: coreW,
    height: coreH,
    markup: createCanvasSchematicBlockMarkup(
      coreW,
      coreH,
      coreStroke,
      coreTitle,
      coreSubtitle,
      corePortMarkers,
      palette,
    ),
    ports: { items: corePorts },
  });

  const sideNodeW = 86;
  const sideNodeH = 34;
  for (let i = 0; i < inputs.length; i++) {
    const a = inputs[i];
    if (!a) continue;
    const targetY = coreY + ((i + 1) / (inputs.length + 1)) * coreH;
    const ny = Math.max(8, targetY - sideNodeH / 2 + (inputs.length > 1 ? (i - (inputs.length - 1) / 2) * 8 : 0));
    const nx = 6;
    const nodeId = `in_node_${i}`;
    graph.addNode({
      id: nodeId,
      x: nx,
      y: ny,
      width: sideNodeW,
      height: sideNodeH,
      markup: createCanvasSchematicBlockMarkup(
        sideNodeW,
        sideNodeH,
        palette.input,
        truncateCanvasLabel(a.label, 12),
        a.currentValue ? truncateCanvasLabel(a.currentValue, 12) : a.unit,
        [{ x: sideNodeW, y: sideNodeH / 2, color: palette.input }],
        palette,
      ),
      ports: { items: [{ id: "out", args: { x: sideNodeW, y: sideNodeH / 2 } }] },
    });
    const srcY = ny + sideNodeH / 2;
    const midX = (nx + sideNodeW + coreX) / 2;
    graph.addEdge({
      id: `edge_in_${i}`,
      source: { cell: nodeId, port: "out" },
      target: { cell: "core", port: `in_${i}` },
      vertices: [
        { x: midX, y: srcY },
        { x: midX, y: targetY },
      ],
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: palette.input, strokeWidth: 1.8 } },
    });
  }

  for (let i = 0; i < outputs.length; i++) {
    const a = outputs[i];
    if (!a) continue;
    const srcY = coreY + ((i + 1) / (outputs.length + 1)) * coreH;
    const ny = Math.max(8, srcY - sideNodeH / 2 + (outputs.length > 1 ? (i - (outputs.length - 1) / 2) * 8 : 0));
    const nx = coreX + coreW + 30;
    const nodeId = `out_node_${i}`;
    graph.addNode({
      id: nodeId,
      x: nx,
      y: ny,
      width: sideNodeW,
      height: sideNodeH,
      markup: createCanvasSchematicBlockMarkup(
        sideNodeW,
        sideNodeH,
        palette.output,
        truncateCanvasLabel(a.label, 12),
        a.currentValue ? truncateCanvasLabel(a.currentValue, 12) : a.unit,
        [{ x: 0, y: sideNodeH / 2, color: palette.output }],
        palette,
      ),
      ports: { items: [{ id: "in", args: { x: 0, y: sideNodeH / 2 } }] },
    });
    const tgtY = ny + sideNodeH / 2;
    const midX = (coreX + coreW + nx) / 2;
    graph.addEdge({
      id: `edge_out_${i}`,
      source: { cell: "core", port: `out_${i}` },
      target: { cell: nodeId, port: "in" },
      vertices: [
        { x: midX, y: srcY },
        { x: midX, y: tgtY },
      ],
      connector: { name: "rounded", args: { radius: 5 } },
      attrs: { line: { stroke: palette.output, strokeWidth: 1.8 } },
    });
  }

  const paramW = 104;
  const paramH = 30;
  const paramRowY = coreY + coreH + 24;
  const totalParamsWidth = params.length * paramW + Math.max(0, params.length - 1) * 14;
  const paramStartX = coreX + coreW / 2 - totalParamsWidth / 2;
  for (let i = 0; i < params.length; i++) {
    const a = params[i];
    if (!a) continue;
    const px = paramStartX + i * (paramW + 14);
    const nodeId = `param_node_${i}`;
    graph.addNode({
      id: nodeId,
      x: px,
      y: paramRowY,
      width: paramW,
      height: paramH,
      markup: createCanvasSchematicBlockMarkup(
        paramW,
        paramH,
        palette.parameter,
        truncateCanvasLabel(a.label, 14),
        a.currentValue ? truncateCanvasLabel(a.currentValue, 14) : a.unit,
        [{ x: paramW / 2, y: 0, color: palette.parameter }],
        palette,
      ),
      ports: { items: [{ id: "top", args: { x: paramW / 2, y: 0 } }] },
    });
    const srcX = px + paramW / 2;
    const tgtX = coreX + ((i + 1) / (params.length + 1)) * coreW;
    const midY = (paramRowY + coreY + coreH) / 2;
    graph.addEdge({
      id: `edge_param_${i}`,
      source: { cell: nodeId, port: "top" },
      target: { cell: "core", port: `param_${i}` },
      vertices: [
        { x: srcX, y: midY },
        { x: tgtX, y: midY },
      ],
      connector: { name: "rounded", args: { radius: 4 } },
      attrs: { line: { stroke: palette.parameter, strokeWidth: 1.5 } },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Archetype visual painters
// ─────────────────────────────────────────────────────────────────────────────

function paintInsetGrid(
  ctx: CanvasBoardPaintContext,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  step: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = x + step; gx < x + w; gx += step) {
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
  }
  for (let gy = y + step; gy < y + h; gy += step) {
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
  }
  ctx.stroke();
}

/**
 * Paints a schematic / FMU tile visual (grid backdrop + UnifiedGraph block diagram) into a rect.
 * This is the exact code path the 2D `LiveUnifiedSchematicTile` uses.
 */
export function paintCanvasSchematicPreview(
  ctx: CanvasBoardPaintContext,
  tile: CanvasTile,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: CanvasBoardTheme,
  options: {
    accent: string;
    simulationTime?: number | undefined;
    diagramData?: CanvasDiagramDataLike | null | undefined;
    maxScale?: number | undefined;
    padding?: number | undefined;
    radius?: number | undefined;
  },
): { drawnNodes: number } {
  const pal = theme.schematic;
  const accent = themedAccent(theme, options.accent);
  const diagramData =
    options.diagramData !== undefined ? options.diagramData : extractCanvasDiagramData(tile.viewState?.["diagramData"]);
  const graph = new UnifiedGraph({
    width,
    height,
    renderMode: "canvas2d",
    background: { color: pal.background },
  });
  populateCanvasSchematicGraph(graph, tile, accent, options.simulationTime ?? 0, diagramData, pal);
  graph.zoomToFit({ padding: options.padding ?? 14, maxScale: options.maxScale ?? 1.25 });

  ctx.save();
  if ((x !== 0 || y !== 0) && typeof ctx.translate === "function") {
    ctx.translate(x, y);
  }
  ctx.fillStyle = pal.background;
  traceCanvasRoundedRect(ctx, 0, 0, width, height, options.radius ?? 6);
  ctx.fill();
  if (typeof ctx.clip === "function") ctx.clip();
  if (pal.grid) paintInsetGrid(ctx, 0, 0, width, height, pal.grid, 20);
  const result = graph.paintToCanvas2D(ctx, { dark: theme.graphDark });
  ctx.restore();
  graph.dispose();
  return { drawnNodes: result.drawnNodes };
}

const ECAD_DESIGN_W = 356;
const ECAD_DESIGN_H = 152;

function tracePolyline(ctx: CanvasBoardPaintContext, poly: [number, number][]): void {
  const first = poly[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < poly.length; i++) {
    const pt = poly[i];
    if (pt) ctx.lineTo(pt[0], pt[1]);
  }
  ctx.stroke();
}

/**
 * Multi-layer PCB preview for `ecad` tiles: Edge.Cuts substrate, mounting holes, B.Cu/F.Cu traces &
 * vias, SMD footprints with pads and F.SilkS designators. Authored in a 356×152 design space and
 * uniformly fitted into the target rect (the 2D tile paints it 1:1).
 */
export function paintCanvasEcadPreview(
  ctx: CanvasBoardPaintContext,
  tile: CanvasTile,
  x: number,
  y: number,
  width: number,
  height: number,
  layers: CanvasEcadLayerVisibility,
  palette: CanvasEcadPalette = CANVAS_BOARD_THEMES.dark.ecad,
): void {
  const s = Math.min(width / ECAD_DESIGN_W, height / ECAD_DESIGN_H);
  const ox = x + (width - ECAD_DESIGN_W * s) / 2;
  const oy = y + (height - ECAD_DESIGN_H * s) / 2;

  ctx.save();
  ctx.fillStyle = palette.backdrop;
  fillBox(ctx, x, y, width, height);
  if ((ox !== 0 || oy !== 0) && typeof ctx.translate === "function") {
    ctx.translate(ox, oy);
  }
  if (s !== 1 && typeof ctx.scale === "function") {
    ctx.scale(s, s);
  }

  const bx = 14;
  const by = 8;
  const bw = ECAD_DESIGN_W - 28;
  const bh = ECAD_DESIGN_H - 16;
  ctx.fillStyle = palette.substrate;
  traceCanvasRoundedRect(ctx, bx, by, bw, bh, 8);
  ctx.fill();
  if (layers.edge) {
    ctx.strokeStyle = palette.edgeCuts;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  ctx.fillStyle = palette.gridDot;
  ctx.beginPath();
  for (let gx = bx + 16; gx < bx + bw - 8; gx += 16) {
    for (let gy = by + 16; gy < by + bh - 8; gy += 16) {
      ctx.rect(gx, gy, 1.2, 1.2);
    }
  }
  ctx.fill();

  const mountingHoles: [number, number][] = [
    [bx + 14, by + 14],
    [bx + bw - 14, by + 14],
    [bx + 14, by + bh - 14],
    [bx + bw - 14, by + bh - 14],
  ];
  for (const [mx, my] of mountingHoles) {
    ctx.beginPath();
    ctx.arc(mx, my, 6.2, 0, Math.PI * 2);
    ctx.fillStyle = palette.holeRing;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, my, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = palette.holeDrill;
    ctx.fill();
    ctx.strokeStyle = palette.holeCross;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(mx - 8, my);
    ctx.lineTo(mx + 8, my);
    ctx.moveTo(mx, my - 8);
    ctx.lineTo(mx, my + 8);
    ctx.stroke();
  }

  if (layers.bCu) {
    ctx.strokeStyle = palette.backCopper;
    ctx.lineWidth = 2.4;
    tracePolyline(ctx, [
      [56, 100],
      [104, 100],
      [124, 114],
      [222, 114],
      [242, 98],
      [286, 98],
    ]);
    tracePolyline(ctx, [
      [56, 116],
      [92, 116],
      [110, 128],
      [268, 128],
    ]);
    for (const [vx, vy] of [
      [104, 100],
      [222, 114],
      [268, 128],
    ] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(vx, vy, 3, 0, Math.PI * 2);
      ctx.fillStyle = palette.backVia;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(vx, vy, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = palette.holeDrill;
      ctx.fill();
    }
  }

  if (layers.fCu) {
    ctx.strokeStyle = palette.frontCopper;
    ctx.lineWidth = 3;
    const fTraces: [number, number][][] = [
      [
        [56, 48],
        [112, 48],
        [130, 64],
        [148, 64],
      ],
      [
        [56, 66],
        [102, 66],
        [122, 78],
        [148, 78],
      ],
      [
        [214, 58],
        [244, 58],
        [258, 44],
        [272, 44],
      ],
      [
        [214, 76],
        [248, 76],
        [262, 62],
        [272, 62],
      ],
      [
        [214, 92],
        [252, 92],
        [272, 92],
      ],
    ];
    for (const poly of fTraces) tracePolyline(ctx, poly);
  }

  // J1 header
  ctx.fillStyle = palette.body;
  fillBox(ctx, 36, 38, 22, 84);
  ctx.fillStyle = palette.pad;
  for (let p = 0; p < 5; p++) fillBox(ctx, 52, 43 + p * 16, 8, 7);

  // U1 QFN gate driver
  const icX = 148;
  const icY = 44;
  const icW = 66;
  const icH = 62;
  ctx.fillStyle = palette.pad;
  for (let p = 0; p < 5; p++) {
    fillBox(ctx, icX - 5, icY + 8 + p * 11, 5, 5);
    fillBox(ctx, icX + icW, icY + 8 + p * 11, 5, 5);
    fillBox(ctx, icX + 9 + p * 11, icY - 5, 5, 5);
    fillBox(ctx, icX + 9 + p * 11, icY + icH, 5, 5);
  }
  ctx.fillStyle = palette.body;
  fillBox(ctx, icX, icY, icW, icH);
  ctx.strokeStyle = layers.silk ? palette.silk : palette.silkDim;
  ctx.lineWidth = 1.2;
  strokeBox(ctx, icX, icY, icW, icH);
  ctx.beginPath();
  ctx.arc(icX + 8, icY + 8, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = palette.silk;
  ctx.fill();

  // Q1-Q6 MOSFET bank
  const fetX = 272;
  const fetY = 32;
  const fetW = 48;
  const fetH = 38;
  ctx.fillStyle = palette.pad;
  for (let p = 0; p < 3; p++) {
    fillBox(ctx, fetX - 4, fetY + 6 + p * 11, 4, 6);
    fillBox(ctx, fetX + fetW, fetY + 6 + p * 11, 4, 6);
  }
  ctx.fillStyle = palette.body;
  fillBox(ctx, fetX, fetY, fetW, fetH);
  ctx.strokeStyle = palette.fetStroke;
  ctx.lineWidth = 1.2;
  strokeBox(ctx, fetX, fetY, fetW, fetH);

  // R1 shunt & C1 decoupling cap
  ctx.fillStyle = palette.pad;
  fillBox(ctx, 272, 84, 6, 16);
  fillBox(ctx, 306, 84, 6, 16);
  ctx.fillStyle = palette.passive;
  fillBox(ctx, 278, 85, 28, 14);
  ctx.fillStyle = palette.pad;
  fillBox(ctx, 92, 22, 5, 10);
  fillBox(ctx, 113, 22, 5, 10);
  ctx.fillStyle = palette.capacitor;
  fillBox(ctx, 97, 23, 16, 8);

  if (layers.silk) {
    ctx.font = "600 9.5px sans-serif";
    ctx.fillStyle = palette.silk;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateCanvasLabel(tile.targetSymbol ?? "U1 DRV8353", 12), icX + icW / 2, icY + icH / 2);
    ctx.font = "600 8.5px monospace";
    ctx.fillStyle = palette.pad;
    ctx.fillText("Q1-Q6", fetX + fetW / 2, fetY + fetH / 2);
    ctx.fillStyle = palette.silk;
    ctx.fillText("J1", 46, 30);
    ctx.fillText("C1", 105, 17);
    ctx.fillText("R1", 292, 92);
    const primaryNet = tile.pinnedAnchors?.[0]?.label ?? "VBUS_24V";
    ctx.textAlign = "left";
    ctx.fillStyle = palette.netLabel;
    ctx.font = "600 8.5px monospace";
    ctx.fillText(truncateCanvasLabel(primaryNet, 16), 66, 40);
  }
  ctx.restore();
}

const CAD_DESIGN_W = 380;
const CAD_DESIGN_H = 180;

/**
 * STEP / CAD snapshot preview (isometric hex prism, bore, mass callout) matching the 2D
 * `renderCad3DPreview` SVG used whenever the shared-scissor WebGL slot is not live.
 */
export function paintCanvasCad3DPreview(
  ctx: CanvasBoardPaintContext,
  tile: CanvasTile,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: CanvasBoardTheme,
  options: { caption?: string | undefined; isWebGlLive?: boolean | undefined } = {},
): void {
  const pal = theme.cad3d;
  const s = Math.min(width / CAD_DESIGN_W, height / CAD_DESIGN_H);
  const ox = x + (width - CAD_DESIGN_W * s) / 2;
  const oy = y + (height - CAD_DESIGN_H * s) / 2;
  const massLabel = tile.pinnedAnchors?.find((a) => a.path === "body.mass")?.currentValue ?? "2.14 kg";

  ctx.save();
  ctx.fillStyle = pal.backdrop;
  traceCanvasRoundedRect(ctx, x, y, width, height, 6);
  ctx.fill();
  if ((ox !== 0 || oy !== 0) && typeof ctx.translate === "function") {
    ctx.translate(ox, oy);
  }
  if (s !== 1 && typeof ctx.scale === "function") {
    ctx.scale(s, s);
  }

  const hex: [number, number][] = [
    [190, 22],
    [295, 62],
    [295, 134],
    [190, 164],
    [85, 134],
    [85, 62],
  ];
  ctx.beginPath();
  hex.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  if (typeof ctx.createLinearGradient === "function") {
    const g = ctx.createLinearGradient(85, 22, 295, 164);
    g.addColorStop(0, pal.metalStops[0]);
    g.addColorStop(0.5, pal.metalStops[1]);
    g.addColorStop(1, pal.metalStops[2]);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = pal.metalStops[1];
  }
  ctx.fill();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(190, 22);
  ctx.lineTo(295, 62);
  ctx.lineTo(190, 96);
  ctx.lineTo(85, 62);
  ctx.closePath();
  ctx.fillStyle = pal.topFace;
  ctx.fill();
  ctx.strokeStyle = pal.topStroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = pal.edge;
  ctx.beginPath();
  ctx.moveTo(190, 96);
  ctx.lineTo(190, 164);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(190, 60, 38, 18, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.boreFill;
  ctx.fill();
  ctx.strokeStyle = pal.boreStroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(190, 60, 4, 0, Math.PI * 2);
  ctx.fillStyle = pal.label;
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "9px sans-serif";
  ctx.fillStyle = pal.label;
  ctx.fillText(`Mass: ${massLabel}`, 200, 56);
  ctx.fillStyle = pal.caption;
  ctx.fillText(
    options.caption ??
      (options.isWebGlLive ? "WebGL PBR Live (Pool Slot Active)" : "STEP Snapshot (Click to Orbit 3D)"),
    14,
    168,
  );
  ctx.restore();
}

/** Syntax-highlighted, line-numbered code listing (2D `LiveCodeTile` preview parity). */
export function paintCanvasCodeListing(
  ctx: CanvasBoardPaintContext,
  code: string,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: CanvasBoardTheme,
  options: { fontPx?: number | undefined; footerLeft?: string | undefined; footerRight?: string | undefined } = {},
): { drawnLines: number } {
  const pal = theme.code;
  const fontPx = options.fontPx ?? 10.5;
  const lineH = fontPx * 1.45;
  const footerH = options.footerLeft !== undefined || options.footerRight !== undefined ? fontPx * 1.9 : 0;

  ctx.save();
  ctx.fillStyle = pal.background;
  traceCanvasRoundedRect(ctx, x, y, width, height, 6);
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  clipRect(ctx, x + 1, y + 1, width - 2, height - 2);

  ctx.font = `${fontPx}px monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const charW = typeof ctx.measureText === "function" ? measureWidth(ctx, "M", fontPx) : fontPx * 0.6;
  const lines = code.split(/\r?\n/);
  const maxLines = Math.max(1, Math.floor((height - footerH - 12) / lineH));
  const gutterW = charW * 3 + 8;
  const maxChars = Math.max(4, Math.floor((width - gutterW - 16) / Math.max(1, charW)));
  let drawn = 0;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const ly = y + 6 + i * lineH;
    ctx.fillStyle = pal.gutter;
    ctx.textAlign = "right";
    ctx.fillText(String(i + 1), x + 8 + charW * 2.5, ly);
    ctx.textAlign = "left";
    let cx = x + 8 + gutterW;
    let used = 0;
    for (const tok of tokenizeCanvasCodeLine(lines[i] ?? "")) {
      if (used >= maxChars) break;
      const text =
        tok.text.length + used > maxChars ? `${tok.text.slice(0, Math.max(0, maxChars - used - 1))}…` : tok.text;
      ctx.fillStyle =
        tok.kind === "keyword"
          ? pal.keyword
          : tok.kind === "string"
            ? pal.string
            : tok.kind === "number"
              ? pal.number
              : tok.kind === "comment"
                ? pal.comment
                : pal.plain;
      ctx.fillText(text, cx, ly);
      cx += text.length * charW;
      used += text.length;
    }
    drawn++;
  }

  if (footerH > 0) {
    const fy = y + height - footerH;
    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(x, fy);
    ctx.lineTo(x + width, fy);
    ctx.stroke();
    ctx.fillStyle = pal.footer;
    ctx.font = `${Math.max(8, fontPx * 0.86)}px monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    if (options.footerLeft) ctx.fillText(options.footerLeft, x + 8, fy + footerH / 2);
    ctx.textAlign = "right";
    if (options.footerRight) ctx.fillText(options.footerRight, x + width - 8, fy + footerH / 2);
  }
  ctx.restore();
  return { drawnLines: drawn };
}

interface AnchorPillLayout {
  anchor: TileAnchorSpec;
  x: number;
  y: number;
  width: number;
  labelWidth: number;
}

function layoutAnchorPills(
  ctx: CanvasBoardPaintContext,
  anchors: TileAnchorSpec[],
  width: number,
  fontPx: number,
): { pills: AnchorPillLayout[]; height: number } {
  const pillH = fontPx + 8;
  const gap = 4;
  const pills: AnchorPillLayout[] = [];
  ctx.font = `${fontPx}px sans-serif`;
  let cx = 0;
  let cy = 0;
  for (const anchor of anchors) {
    const labelWidth = measureWidth(ctx, anchor.label, fontPx);
    const valueWidth = anchor.currentValue ? measureWidth(ctx, anchor.currentValue, fontPx) + 4 : 0;
    const w = Math.min(width, 6 + 6 + 4 + labelWidth + valueWidth + 6);
    if (cx > 0 && cx + w > width) {
      cx = 0;
      cy += pillH + gap;
    }
    pills.push({ anchor, x: cx, y: cy, width: w, labelWidth });
    cx += w + gap;
  }
  return { pills, height: pills.length > 0 ? cy + pillH : 0 };
}

/** Anchor pill bar (2D `AnchorPillBar` parity): kind dot + label + live value. Returns height used. */
export function paintCanvasAnchorPills(
  ctx: CanvasBoardPaintContext,
  tile: CanvasTile,
  x: number,
  bottomY: number,
  width: number,
  theme: CanvasBoardTheme,
  options: { accent: string; fontPx?: number | undefined; activeAnchorPath?: string | null | undefined },
): number {
  const anchors = tile.pinnedAnchors ?? [];
  if (anchors.length === 0) return 0;
  const fontPx = options.fontPx ?? 10;
  const accent = themedAccent(theme, options.accent);
  const { pills, height } = layoutAnchorPills(ctx, anchors, width, fontPx);
  const pillH = fontPx + 8;
  const top = bottomY - height;
  ctx.save();
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const p of pills) {
    const px = x + p.x;
    const py = top + p.y;
    const isActive = options.activeAnchorPath === p.anchor.path;
    ctx.fillStyle = isActive ? "rgba(245,158,11,0.2)" : theme.pillFill;
    traceCanvasRoundedRect(ctx, px, py, p.width, pillH, 4);
    ctx.fill();
    ctx.strokeStyle = isActive ? "#f59e0b" : theme.accentOverride ? theme.insetStroke : `${accent}55`;
    ctx.lineWidth = 1;
    ctx.stroke();
    const dot =
      p.anchor.kind === "fmi-output"
        ? theme.pillAnchorColors.output
        : p.anchor.kind === "fmi-input"
          ? theme.pillAnchorColors.input
          : p.anchor.kind === "requirement"
            ? theme.pillAnchorColors.requirement
            : accent;
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(px + 9, py + pillH / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.pillText;
    ctx.fillText(p.anchor.label, px + 16, py + pillH / 2 + 0.5);
    if (p.anchor.currentValue) {
      ctx.fillStyle = accent;
      ctx.fillText(p.anchor.currentValue, px + 16 + p.labelWidth + 4, py + pillH / 2 + 0.5);
    }
  }
  ctx.restore();
  return height;
}

export interface CanvasTileBodyOptions {
  /** Descriptor accent colour (cluster colour); themes may override it. */
  accent: string;
  /** LOD tier (`macro` paints the label/URI summary; others paint the live visual). */
  lod?: TileLodTier | undefined;
  /** Optional descriptor label for the macro LOD summary. */
  label?: string | undefined;
  simulationTime?: number | undefined;
  ecadLayers?: CanvasEcadLayerVisibility | undefined;
  highlightedRowIds?: string[] | undefined;
  brushX?: [number, number] | undefined;
  /** Paint the anchor pill bar under the visual (2D parity, default true). */
  showAnchorPills?: boolean | undefined;
  /** Scales fonts for large (full-screen / zoomed) presentations. */
  fontScale?: number | undefined;
  /** Caption for the CAD snapshot preview (host-specific hint). */
  cadCaption?: string | undefined;
  isWebGlLive?: boolean | undefined;
  /**
   * Host hook to replace the archetype visual (e.g. a captured SVG bitmap). Return `true`
   * when the visual rect was painted.
   */
  paintVisualOverride?: ((ctx: CanvasBoardPaintContext, rect: WorldBounds) => boolean) | undefined;
}

/**
 * Paints the content of a tile (archetype visual + anchor pill bar) into `rect` using the shared
 * 2D parity painters. Returns the archetype rendered.
 */
export function paintCanvasTileBody(
  ctx: CanvasBoardPaintContext,
  tile: CanvasTile,
  rect: WorldBounds,
  theme: CanvasBoardTheme,
  options: CanvasTileBodyOptions,
): string {
  const fontScale = options.fontScale ?? 1;
  const lod = options.lod ?? "interactive";

  if (lod === "macro") {
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = theme.text;
    ctx.font = `700 ${14 * fontScale}px sans-serif`;
    ctx.fillText(options.label ?? tile.languageId, rect.x, rect.y + rect.height / 2 - 8 * fontScale);
    ctx.fillStyle = theme.mutedText;
    ctx.font = `${11 * fontScale}px sans-serif`;
    ctx.fillText(tile.artifactUri, rect.x, rect.y + rect.height / 2 + 10 * fontScale);
    ctx.restore();
    return "macro";
  }

  const pillsH =
    options.showAnchorPills === false || lod === "thumbnail"
      ? 0
      : paintCanvasAnchorPills(ctx, tile, rect.x, rect.y + rect.height, rect.width, theme, {
          accent: options.accent,
          fontPx: 10 * fontScale,
        });
  const visual: WorldBounds = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.max(24, rect.height - (pillsH > 0 ? pillsH + 6 : 0)),
  };

  if (options.paintVisualOverride?.(ctx, visual)) {
    return tile.archetype;
  }

  switch (tile.archetype) {
    case "schematic":
    case "fmu":
      paintCanvasSchematicPreview(ctx, tile, visual.x, visual.y, visual.width, visual.height, theme, {
        accent: tile.archetype === "fmu" ? "#10b981" : options.accent,
        simulationTime: options.simulationTime,
        maxScale: 1.25 * Math.max(1, fontScale),
      });
      break;
    case "ecad":
      paintCanvasEcadPreview(
        ctx,
        tile,
        visual.x,
        visual.y,
        visual.width,
        visual.height,
        options.ecadLayers ?? resolveCanvasEcadLayers(tile.viewState),
        theme.ecad,
      );
      break;
    case "cad3d":
      paintCanvasCad3DPreview(ctx, tile, visual.x, visual.y, visual.width, visual.height, theme, {
        caption: options.cadCaption,
        isWebGlLive: options.isWebGlLive,
      });
      break;
    case "table":
      paintCanvasTable(
        ctx,
        buildCanvasRequirementTableSpec(tile, {
          highlightedRowIds: options.highlightedRowIds,
          dark: theme.graphDark,
          palette: theme.widget,
        }),
        visual.x,
        visual.y,
        visual.width,
        visual.height,
      );
      break;
    case "analytics":
      paintCanvasPlot(
        ctx,
        buildCanvasAnalyticsPlotSpec(tile, {
          simulationTime: options.simulationTime,
          brushX: options.brushX,
          lod,
          dark: theme.graphDark,
          palette: theme.widget,
          parametricColor: themedAccent(theme, "#14b8a6"),
        }),
        visual.x,
        visual.y,
        visual.width,
        visual.height,
      );
      break;
    case "code":
    default:
      paintCanvasCodeListing(
        ctx,
        buildCanvasTileSourceCode(tile),
        visual.x,
        visual.y,
        visual.width,
        visual.height,
        theme,
        { fontPx: 10.5 * fontScale, footerLeft: tile.languageId, footerRight: "Double-click to focus" },
      );
      break;
  }
  return tile.archetype;
}
