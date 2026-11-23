// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG 2D Heatmap & Contour Slice Visualizer for Unidata NetCDF Classic datasets.
 */

import { computeFieldStats, computeVariableShape, sliceVariable, unpackVariableValues } from "../solver/field-ops.js";
import type { NetcdfDataset, NetcdfVariable } from "../types.js";

export interface NetcdfHeatmapOptions {
  variableName?: string | undefined;
  /** Leading-axis index for 3D+ variables (default: 0). */
  sliceIndex?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  showContours?: boolean | undefined;
  colorMode?: "light" | "dark" | undefined;
}

// 5-stop Viridis perceptual colormap (RGB)
const VIRIDIS_STOPS: ReadonlyArray<[number, number, number]> = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function viridisColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (VIRIDIS_STOPS.length - 1);
  const idx = Math.min(VIRIDIS_STOPS.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = VIRIDIS_STOPS[idx]!;
  const c1 = VIRIDIS_STOPS[idx + 1]!;
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
  return `rgb(${r},${g},${b})`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "NaN";
  if (Math.abs(v) >= 1e4 || (Math.abs(v) > 0 && Math.abs(v) < 1e-2)) {
    return v.toExponential(2);
  }
  return Number(v.toFixed(2)).toString();
}

function pickDefaultVariable(dataset: NetcdfDataset, requested?: string): NetcdfVariable | undefined {
  if (requested) {
    const found = dataset.variables.find((v) => v.name === requested);
    if (found) return found;
  }
  const dimNames = new Set(dataset.dimensions.map((d) => d.name));
  // Prefer >=2D numeric non-coordinate variables
  const gridVar = dataset.variables.find(
    (v) => v.type !== "char" && v.dimensions.length >= 2 && !(v.dimensions.length === 1 && dimNames.has(v.name)),
  );
  if (gridVar) return gridVar;
  return dataset.variables.find((v) => v.type !== "char");
}

/**
 * Renders a pure SVG 2D heatmap & contour isoline visualization for a NetCDF variable slice.
 */
export function renderNetcdfHeatmapSvg(dataset: NetcdfDataset, options: NetcdfHeatmapOptions = {}): string {
  const width = options.width ?? 640;
  const height = options.height ?? 400;
  const isDark = options.colorMode !== "light";
  const showContours = options.showContours !== false;

  const bg = isDark ? "#0f172a" : "#ffffff";
  const fg = isDark ? "#e2e8f0" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#475569";
  const border = isDark ? "#334155" : "#cbd5e1";

  const variable = pickDefaultVariable(dataset, options.variableName);
  if (!variable) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="${bg}"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="${muted}">` +
      `No numeric variables available in '${escapeXml(dataset.name)}'` +
      `</text></svg>`
    );
  }

  const shape = computeVariableShape(dataset, variable);
  let rows = 1;
  let cols = 1;
  let gridData: number[] = [];
  let xDimName = "index";
  let yDimName = "row";
  let sliceLabel = "";

  if (shape.length === 0) {
    gridData = unpackVariableValues(variable);
  } else if (shape.length === 1) {
    rows = 1;
    cols = Math.max(1, shape[0]!);
    gridData = unpackVariableValues(variable);
    xDimName = variable.dimensions[0]!;
    yDimName = variable.name;
  } else if (shape.length === 2) {
    rows = Math.max(1, shape[0]!);
    cols = Math.max(1, shape[1]!);
    gridData = unpackVariableValues(variable);
    yDimName = variable.dimensions[0]!;
    xDimName = variable.dimensions[1]!;
  } else {
    // 3D+: fix leading axes (first axis at sliceIndex, intermediate at 0), keep last two axes
    const leadLen = Math.max(1, shape[0]!);
    const sIdx = Math.max(0, Math.min(leadLen - 1, options.sliceIndex ?? 0));
    const sliceSpec: Array<number | ":"> = shape.map((_, axis) => {
      if (axis === shape.length - 2 || axis === shape.length - 1) return ":";
      return axis === 0 ? sIdx : 0;
    });
    const sliced = sliceVariable(dataset, variable.name, sliceSpec);
    rows = Math.max(1, sliced.shape[0] ?? 1);
    cols = Math.max(1, sliced.shape[1] ?? 1);
    gridData = sliced.data;
    yDimName = sliced.dimensions[0] ?? "y";
    xDimName = sliced.dimensions[1] ?? "x";
    sliceLabel = ` [${variable.dimensions[0]}=${sIdx}]`;
  }

  const stats = computeFieldStats(gridData);
  const vMin = Number.isFinite(stats.min) ? stats.min : 0;
  const vMax = Number.isFinite(stats.max) ? stats.max : 1;
  const span = vMax > vMin ? vMax - vMin : 1;

  const unitsAttr = variable.attributes.find((a) => a.name === "units");
  const units = unitsAttr && typeof unitsAttr.value === "string" ? unitsAttr.value : "";
  const longNameAttr = variable.attributes.find((a) => a.name === "long_name");
  const titleText =
    (longNameAttr && typeof longNameAttr.value === "string" ? longNameAttr.value : variable.name) +
    (units ? ` (${units})` : "") +
    sliceLabel;

  const padLeft = 64;
  const padRight = 92;
  const padTop = 44;
  const padBottom = 48;
  const plotW = Math.max(80, width - padLeft - padRight);
  const plotH = Math.max(80, height - padTop - padBottom);
  const cellW = plotW / cols;
  const cellH = plotH / rows;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-netcdf-var="${escapeXml(variable.name)}">`,
  );
  parts.push(`<defs><linearGradient id="nc-viridis" x1="0" y1="1" x2="0" y2="0">`);
  VIRIDIS_STOPS.forEach((rgb, i) => {
    const pct = Math.round((i / (VIRIDIS_STOPS.length - 1)) * 100);
    parts.push(`<stop offset="${pct}%" stop-color="rgb(${rgb[0]},${rgb[1]},${rgb[2]})"/>`);
  });
  parts.push(`</linearGradient></defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="${bg}"/>`);

  // Header title
  const lineAttr = variable.line ? ` data-line="${variable.line}"` : "";
  parts.push(
    `<text x="${padLeft}" y="26" font-family="sans-serif" font-size="13" font-weight="600" fill="${fg}"${lineAttr}>${escapeXml(titleText)}</text>`,
  );
  parts.push(
    `<text x="${padLeft + plotW}" y="26" text-anchor="end" font-family="monospace" font-size="10" fill="${muted}">shape=[${shape.join("×")}] mean=${fmtNum(stats.mean)}</text>`,
  );

  // Heatmap cells
  parts.push(`<g class="nc-heatmap-cells"${lineAttr}>`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = gridData[r * cols + c];
      const x = padLeft + c * cellW;
      // Flip Y so row 0 is at bottom (standard geophysical lat/y orientation)
      const y = padTop + (rows - 1 - r) * cellH;
      const fill = val !== undefined && Number.isFinite(val) ? viridisColor((val - vMin) / span) : "#475569";
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellW + 0.4).toFixed(2)}" height="${(cellH + 0.4).toFixed(2)}" fill="${fill}"/>`,
      );
    }
  }
  parts.push(`</g>`);

  // Contour isoline segments (cell-boundary crossing approximation for 2D grids)
  if (showContours && rows >= 2 && cols >= 2 && vMax > vMin) {
    const levels = [0.2, 0.4, 0.6, 0.8].map((f) => vMin + f * span);
    parts.push(`<g class="nc-contours" stroke="rgba(255,255,255,0.45)" stroke-width="0.9" fill="none">`);
    for (const lvl of levels) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = gridData[r * cols + c]!;
          if (!Number.isFinite(v)) continue;
          const x = padLeft + c * cellW;
          const y = padTop + (rows - 1 - r) * cellH;
          if (c + 1 < cols) {
            const vr = gridData[r * cols + (c + 1)]!;
            if (Number.isFinite(vr) && (v - lvl) * (vr - lvl) < 0) {
              const bx = (x + cellW).toFixed(2);
              parts.push(`<line x1="${bx}" y1="${y.toFixed(2)}" x2="${bx}" y2="${(y + cellH).toFixed(2)}"/>`);
            }
          }
          if (r + 1 < rows) {
            const vu = gridData[(r + 1) * cols + c]!;
            if (Number.isFinite(vu) && (v - lvl) * (vu - lvl) < 0) {
              const by = y.toFixed(2);
              parts.push(`<line x1="${x.toFixed(2)}" y1="${by}" x2="${(x + cellW).toFixed(2)}" y2="${by}"/>`);
            }
          }
        }
      }
    }
    parts.push(`</g>`);
  }

  // Plot frame
  parts.push(
    `<rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="none" stroke="${border}" stroke-width="1"/>`,
  );

  // Coordinate axis labels & min/max ticks
  const getAxisEnds = (dimName: string, len: number): [string, string] => {
    const cv = dataset.variables.find((v) => v.name === dimName && v.dimensions.length === 1);
    if (cv && cv.data && cv.data.length >= len && len > 0) {
      const vals = unpackVariableValues(cv);
      return [fmtNum(vals[0]!), fmtNum(vals[len - 1]!)];
    }
    return ["0", String(Math.max(0, len - 1))];
  };

  const [xStart, xEnd] = getAxisEnds(xDimName, cols);
  const [yStart, yEnd] = getAxisEnds(yDimName, rows);

  parts.push(
    `<text x="${padLeft}" y="${padTop + plotH + 15}" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(xStart)}</text>`,
  );
  parts.push(
    `<text x="${padLeft + plotW}" y="${padTop + plotH + 15}" text-anchor="end" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(xEnd)}</text>`,
  );
  parts.push(
    `<text x="${padLeft + plotW / 2}" y="${padTop + plotH + 32}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${fg}">${escapeXml(xDimName)}</text>`,
  );

  parts.push(
    `<text x="${padLeft - 8}" y="${padTop + plotH}" text-anchor="end" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(yStart)}</text>`,
  );
  parts.push(
    `<text x="${padLeft - 8}" y="${padTop + 10}" text-anchor="end" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(yEnd)}</text>`,
  );
  parts.push(
    `<text x="16" y="${padTop + plotH / 2}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${fg}" transform="rotate(-90 16 ${padTop + plotH / 2})">${escapeXml(yDimName)}</text>`,
  );

  // Colorbar legend
  const cbX = padLeft + plotW + 16;
  const cbW = 14;
  parts.push(
    `<rect x="${cbX}" y="${padTop}" width="${cbW}" height="${plotH}" fill="url(#nc-viridis)" stroke="${border}" stroke-width="0.8"/>`,
  );
  parts.push(
    `<text x="${cbX + cbW + 6}" y="${padTop + 10}" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(fmtNum(vMax))}</text>`,
  );
  parts.push(
    `<text x="${cbX + cbW + 6}" y="${padTop + plotH / 2 + 4}" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(fmtNum((vMin + vMax) / 2))}</text>`,
  );
  parts.push(
    `<text x="${cbX + cbW + 6}" y="${padTop + plotH}" font-family="monospace" font-size="10" fill="${muted}">${escapeXml(fmtNum(vMin))}</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("");
}
