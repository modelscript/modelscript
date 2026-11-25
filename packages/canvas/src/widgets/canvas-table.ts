// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Canvas2DContextLike } from "../engine/glyph-compiler.js";
import { paintWidgetLeaderTether, type WidgetTetherTarget } from "./canvas-plot.js";
import type { CanvasWidgetPalette } from "./palette.js";

/**
 * Canvas2D Compact Table & KPI Sticky Badge Painter.
 *
 * Powers Modelon Impact-style pinned parameter/ReqIF tables and value stickies
 * directly on Layer 0 (thumbnails / embedded schematic widgets) AND inside
 * WebXR VR surfaces where HTML DOM overlays are unavailable.
 */

export interface CanvasTableColumn {
  key: string;
  label: string;
  widthRatio: number;
  align?: "left" | "right" | undefined;
}

export interface CanvasTableRow {
  id: string;
  cells: Record<string, string>;
  status?: "pass" | "fail" | "stale" | "neutral" | undefined;
}

export interface CanvasTableSpec {
  title: string;
  columns: CanvasTableColumn[];
  rows: CanvasTableRow[];
  scrollRowOffset?: number | undefined;
  /** Optional list of row IDs brushed/linked from another widget (e.g. Monte Carlo scatter). */
  highlightedRowIds?: string[] | undefined;
  dark?: boolean | undefined;
  /** Optional colour overrides (board themes such as `blueprint`). Unset keys fall back to the `dark` defaults. */
  palette?: Partial<CanvasWidgetPalette> | undefined;
}

export interface StickyBadgeSpec {
  label: string;
  value: string;
  unit?: string | undefined;
  status?: "ok" | "warning" | "error" | "stale" | undefined;
  tetherTarget?: WidgetTetherTarget | undefined;
  dark?: boolean | undefined;
  /** Optional colour overrides (board themes such as `blueprint`). */
  palette?: Partial<CanvasWidgetPalette> | undefined;
}

const STATUS_COLORS: Record<NonNullable<CanvasTableRow["status"]>, string> = {
  pass: "#10b981",
  fail: "#ef4444",
  stale: "#f59e0b",
  neutral: "#64748b",
};

function computeBadgeAnchor(
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

/** Paints a crisp virtualized data/ReqIF table onto any Canvas2D context. */
export function paintCanvasTable(
  ctx: Canvas2DContextLike,
  spec: CanvasTableSpec,
  x: number,
  y: number,
  width: number,
  height: number,
): { visibleRowCount: number; highlightedRowCount: number } {
  const dark = spec.dark ?? true;
  const pal = spec.palette;
  const bg = pal?.background ?? (dark ? "#0f172a" : "#ffffff");
  const headerBg = pal?.headerBackground ?? (dark ? "#1e293b" : "#f1f5f9");
  const border = pal?.border ?? (dark ? "#334155" : "#cbd5e1");
  const text = pal?.text ?? (dark ? "#e2e8f0" : "#0f172a");
  const muted = pal?.mutedText ?? (dark ? "#94a3b8" : "#475569");
  const stripe = pal?.stripe ?? (dark ? "rgba(255,255,255,0.03)" : "rgba(15,23,42,0.03)");
  const highlightText = pal?.highlightText ?? (dark ? "#fef3c7" : "#92400e");
  const highlightedSet =
    spec.highlightedRowIds && spec.highlightedRowIds.length > 0 ? new Set(spec.highlightedRowIds) : null;

  ctx.save();
  ctx.translate(x, y);

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

  const titleH = 22;
  const colHeaderH = 20;
  const rowH = 20;

  // Title bar
  ctx.fillStyle = headerBg;
  ctx.beginPath();
  ctx.rect(1, 1, width - 2, titleH);
  ctx.fill();

  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.title, 8, titleH / 2 + 1);

  // Column headers
  const totalRatio = spec.columns.reduce((sum, c) => sum + Math.max(0.05, c.widthRatio), 0) || 1;
  let colX = 8;
  const usableW = Math.max(16, width - 16);
  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = muted;
  for (const col of spec.columns) {
    const cw = (usableW * Math.max(0.05, col.widthRatio)) / totalRatio;
    ctx.textAlign = col.align === "right" ? "right" : "left";
    ctx.fillText(col.label, col.align === "right" ? colX + cw - 4 : colX, titleH + colHeaderH / 2);
    colX += cw;
  }

  // Visible rows
  const startRow = Math.max(0, Math.floor(spec.scrollRowOffset ?? 0));
  const maxVisible = Math.max(0, Math.floor((height - titleH - colHeaderH - 4) / rowH));
  const endRow = Math.min(spec.rows.length, startRow + maxVisible);
  let highlightedRowCount = 0;

  ctx.font = "10px monospace";
  for (let r = startRow; r < endRow; r++) {
    const row = spec.rows[r]!;
    const ry = titleH + colHeaderH + (r - startRow) * rowH;
    const isHighlighted = highlightedSet?.has(row.id) ?? false;

    if (isHighlighted) {
      highlightedRowCount++;
      // Accent background fill + crisp highlight ring for brushed ReqIF/BOM rows
      ctx.fillStyle = dark ? "rgba(245, 158, 11, 0.2)" : "rgba(245, 158, 11, 0.16)";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(2, ry + 1, Math.max(2, width - 4), rowH - 2, 3);
      } else {
        ctx.rect(2, ry + 1, Math.max(2, width - 4), rowH - 2);
      }
      ctx.fill();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Left accent bar
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.rect(2, ry + 1, 3, rowH - 2);
      ctx.fill();
    } else if ((r - startRow) % 2 === 1) {
      ctx.fillStyle = stripe;
      ctx.beginPath();
      ctx.rect(1, ry, width - 2, rowH);
      ctx.fill();
    }

    if (row.status) {
      ctx.fillStyle = STATUS_COLORS[row.status];
      ctx.beginPath();
      ctx.arc(isHighlighted ? 8 : 5, ry + rowH / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    let cx = isHighlighted ? 14 : 12;
    for (const col of spec.columns) {
      const cw = ((usableW - 4) * Math.max(0.05, col.widthRatio)) / totalRatio;
      const cellText = row.cells[col.key] ?? "";
      ctx.fillStyle = isHighlighted ? highlightText : text;
      ctx.textAlign = col.align === "right" ? "right" : "left";
      ctx.fillText(
        cellText.slice(0, Math.max(3, Math.floor(cw / 6))),
        col.align === "right" ? cx + cw - 4 : cx,
        ry + rowH / 2,
      );
      cx += cw;
    }
  }

  ctx.restore();
  return { visibleRowCount: endRow - startRow, highlightedRowCount };
}

/** Paints a Modelon Impact-style pinned KPI sticky readout with optional dashed leader tether. */
export function paintStickyBadge(
  ctx: Canvas2DContextLike,
  spec: StickyBadgeSpec,
  x: number,
  y: number,
  width = 128,
  height = 38,
): void {
  const dark = spec.dark ?? true;
  const pal = spec.palette;
  const accent =
    spec.status === "error" ? "#ef4444" : spec.status === "warning" || spec.status === "stale" ? "#f59e0b" : "#10b981";

  ctx.save();
  if (spec.tetherTarget) {
    const anchor = computeBadgeAnchor(x, y, width, height, spec.tetherTarget.x, spec.tetherTarget.y);
    paintWidgetLeaderTether(
      ctx,
      anchor.x,
      anchor.y,
      spec.tetherTarget.x,
      spec.tetherTarget.y,
      accent,
      spec.tetherTarget.label,
    );
  }

  ctx.translate(x, y);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(0, 0, width, height, 6);
  } else {
    ctx.rect(0, 0, width, height);
  }
  ctx.fillStyle = pal?.background ?? (dark ? "#0f172a" : "#ffffff");
  ctx.fill();
  ctx.strokeStyle = pal?.border ?? accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = "600 9px sans-serif";
  ctx.fillStyle = pal?.mutedText ?? (dark ? "#94a3b8" : "#64748b");
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.label, 8, 12);

  ctx.font = "700 12px monospace";
  ctx.fillStyle = pal?.text ?? (dark ? "#f8fafc" : "#0f172a");
  const display = spec.unit ? `${spec.value} ${spec.unit}` : spec.value;
  ctx.fillText(display, 8, 26);

  ctx.restore();
}
