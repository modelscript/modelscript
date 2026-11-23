// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Pure SVG Geographic Lat/Lon Scalar Heatmap, Isobar & Wind-Barb Renderer.
 */

import { lookupWmoLevelType, lookupWmoParameterByCode } from "../catalog/grib-std-schemas.js";
import { computeGeostrophicWindField } from "../solver/meteorology.js";
import { computeGribFieldStats, getGdsLatitudes, getGdsLongitudes } from "../solver/packing.js";
import type { GribDocument, GribMessage } from "../types.js";

export interface GribMapSvgOptions {
  /** Message index to render (default: 0). */
  messageIndex?: number | undefined;
  /** SVG viewport width in pixels (default: 720). */
  width?: number | undefined;
  /** SVG viewport height in pixels (default: 420). */
  height?: number | undefined;
  /** Render marching-squares isobar/isopleth contours (default: true). */
  showIsobars?: boolean | undefined;
  /** Render wind barbs / vectors from UGRD/VGRD pair or geostrophic gradient (default: true). */
  showWindBarbs?: boolean | undefined;
  /** Number of contour levels (default: 6). */
  contourLevels?: number | undefined;
  /** Color palette: "viridis" | "thermal" (default: "viridis"). */
  palette?: "viridis" | "thermal" | undefined;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lerpColor(t: number, palette: "viridis" | "thermal"): string {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: Array<[number, number, number]> =
    palette === "thermal"
      ? [
          [18, 52, 128],
          [34, 148, 212],
          [78, 204, 152],
          [246, 201, 68],
          [224, 62, 45],
        ]
      : [
          [68, 1, 84],
          [59, 82, 139],
          [33, 145, 140],
          [94, 201, 98],
          [253, 231, 37],
        ];
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - idx;
  const c0 = stops[idx]!;
  const c1 = stops[idx + 1]!;
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
  return `rgb(${r},${g},${b})`;
}

/**
 * Generates marching-squares contour line segments for a 2D scalar grid at threshold `level`.
 */
function buildContourSegments(
  values: readonly number[],
  ni: number,
  nj: number,
  level: number,
  plotX: number,
  plotY: number,
  plotW: number,
  plotH: number,
): string[] {
  const segments: string[] = [];
  if (ni < 2 || nj < 2) return segments;

  const cellW = plotW / ni;
  const cellH = plotH / nj;
  const xAt = (i: number): number => plotX + (i + 0.5) * cellW;
  const yAt = (j: number): number => plotY + (j + 0.5) * cellH;

  const interp = (v1: number, v2: number): number => {
    const d = v2 - v1;
    if (Math.abs(d) < 1e-12) return 0.5;
    return Math.max(0, Math.min(1, (level - v1) / d));
  };

  for (let j = 0; j < nj - 1; j++) {
    for (let i = 0; i < ni - 1; i++) {
      const vTL = values[j * ni + i]!;
      const vTR = values[j * ni + i + 1]!;
      const vBR = values[(j + 1) * ni + i + 1]!;
      const vBL = values[(j + 1) * ni + i]!;
      if (!Number.isFinite(vTL) || !Number.isFinite(vTR) || !Number.isFinite(vBR) || !Number.isFinite(vBL)) {
        continue;
      }

      const pts: Array<[number, number]> = [];
      // Top edge
      if (vTL >= level !== vTR >= level) {
        const t = interp(vTL, vTR);
        pts.push([xAt(i) + t * cellW, yAt(j)]);
      }
      // Right edge
      if (vTR >= level !== vBR >= level) {
        const t = interp(vTR, vBR);
        pts.push([xAt(i + 1), yAt(j) + t * cellH]);
      }
      // Bottom edge
      if (vBL >= level !== vBR >= level) {
        const t = interp(vBL, vBR);
        pts.push([xAt(i) + t * cellW, yAt(j + 1)]);
      }
      // Left edge
      if (vTL >= level !== vBL >= level) {
        const t = interp(vTL, vBL);
        pts.push([xAt(i), yAt(j) + t * cellH]);
      }

      if (pts.length >= 2) {
        segments.push(
          `<line x1="${pts[0]![0].toFixed(1)}" y1="${pts[0]![1].toFixed(1)}" x2="${pts[1]![0].toFixed(1)}" y2="${pts[1]![1].toFixed(1)}" stroke="rgba(255,255,255,0.72)" stroke-width="1.1"/>`,
        );
      }
    }
  }
  return segments;
}

/**
 * Renders a single wind barb / meteorological vector arrow at `(cx, cy)` for wind `(u, v)`.
 */
function renderWindBarb(cx: number, cy: number, u: number, v: number): string {
  const speed = Math.hypot(u, v);
  if (!Number.isFinite(speed) || speed < 0.25) {
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="none" stroke="#f8fafc" stroke-width="1.1"/>`;
  }
  const len = 14;
  // Wind vector direction (pointing downwind, standard meteorological barb staff points upwind)
  const ux = u / speed;
  const uy = -v / speed; // SVG y points downward (south)
  const x2 = cx - ux * len;
  const y2 = cy - uy * len;
  // Perpendicular for barbs
  const px = -uy;
  const py = ux;

  const parts: string[] = [];
  parts.push(
    `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#f8fafc" stroke-width="1.2" stroke-linecap="round"/>`,
  );
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.6" fill="#f8fafc"/>`);

  // Add full (10 m/s) and half (5 m/s) ticks along the staff
  let rem = Math.min(speed, 45);
  let pos = 0;
  while (rem >= 7.5 && pos < 3) {
    const bx = x2 + ux * (pos * 3.5);
    const by = y2 + uy * (pos * 3.5);
    const tx = bx + px * 5.5;
    const ty = by + py * 5.5;
    parts.push(
      `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#f8fafc" stroke-width="1.1"/>`,
    );
    rem -= 10;
    pos++;
  }
  if (rem >= 2.5 && pos < 4) {
    const bx = x2 + ux * (pos * 3.5 + 1.5);
    const by = y2 + uy * (pos * 3.5 + 1.5);
    const tx = bx + px * 3.2;
    const ty = by + py * 3.2;
    parts.push(
      `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#f8fafc" stroke-width="1.1"/>`,
    );
  }
  return parts.join("");
}

/**
 * Renders a pure SVG geographic lat/lon scalar heatmap with optional isobars and wind barbs.
 */
export function renderGribMapSvg(doc: GribDocument, options: GribMapSvgOptions = {}): string {
  const width = options.width ?? 720;
  const height = options.height ?? 420;
  const showIsobars = options.showIsobars ?? true;
  const showWindBarbs = options.showWindBarbs ?? true;
  const contourLevels = options.contourLevels ?? 6;
  const palette = options.palette ?? "viridis";

  const msg: GribMessage | undefined = doc.messages[options.messageIndex ?? 0] ?? doc.messages[0];
  if (!msg || !msg.bds || msg.bds.values.length === 0) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="#0f172a"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="monospace" font-size="13" fill="#94a3b8">No GRIB1 gridded field data to display</text>` +
      `</svg>`
    );
  }

  const gds = msg.gds ?? {
    dataRepresentationType: 0,
    ni: msg.bds.values.length,
    nj: 1,
    la1: 0,
    lo1: 0,
    resolutionFlags: 128,
    la2: 0,
    lo2: Math.max(1, msg.bds.values.length - 1),
    di: 1,
    dj: 1,
    scanningMode: 0,
  };

  const ni = Math.max(1, gds.ni);
  const nj = Math.max(1, gds.nj);
  const values = msg.bds.values;
  const stats = computeGribFieldStats(values, gds);
  const span = Math.max(1e-9, stats.max - stats.min);

  const paramMeta = msg.pds ? lookupWmoParameterByCode(msg.pds.parameterCode) : undefined;
  const levelMeta = msg.pds ? lookupWmoLevelType(msg.pds.levelType) : undefined;
  const titleParam = msg.pds?.parameterName ?? paramMeta?.mnemonic ?? `Param ${msg.pds?.parameterCode ?? "?"}`;
  const unit = paramMeta?.unit ?? "";
  const levelLabel = msg.pds
    ? `${msg.pds.levelValue} ${levelMeta?.unit === "1" ? levelMeta.mnemonic : (levelMeta?.unit ?? "")}`.trim()
    : "";
  const dateLabel = msg.pds
    ? `${String(msg.pds.year).padStart(4, "0")}-${String(msg.pds.month).padStart(2, "0")}-${String(msg.pds.day).padStart(2, "0")} ${String(msg.pds.hour).padStart(2, "0")}:${String(msg.pds.minute).padStart(2, "0")} UTC`
    : "";

  const plotX = 56;
  const plotY = 42;
  const plotW = width - 138;
  const plotH = height - 88;
  const cellW = plotW / ni;
  const cellH = plotH / nj;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#0b1220"/>`);

  // Header
  parts.push(
    `<text x="${plotX}" y="22" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#f8fafc">${escapeXml(`${titleParam}${unit ? ` (${unit})` : ""}${levelLabel ? ` @ ${levelLabel}` : ""}`)}</text>`,
  );
  if (dateLabel) {
    parts.push(
      `<text x="${plotX + plotW}" y="22" text-anchor="end" font-family="monospace" font-size="11" fill="#94a3b8">${escapeXml(dateLabel)}</text>`,
    );
  }

  // Scalar heatmap cells
  parts.push(`<g class="grib-heatmap">`);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const idx = j * ni + i;
      const v = idx < values.length ? values[idx]! : NaN;
      const x = plotX + i * cellW;
      const y = plotY + j * cellH;
      const fill = Number.isFinite(v) ? lerpColor((v - stats.min) / span, palette) : "#1e293b";
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellW + 0.4).toFixed(2)}" height="${(cellH + 0.4).toFixed(2)}" fill="${fill}"/>`,
      );
    }
  }
  parts.push(`</g>`);

  // Lat/Lon Graticule
  const lats = getGdsLatitudes(gds);
  const lons = getGdsLongitudes(gds);
  parts.push(`<g class="grib-graticule">`);
  const latTicks = Math.min(5, nj);
  for (let t = 0; t < latTicks; t++) {
    const jIdx = latTicks === 1 ? 0 : Math.round((t / (latTicks - 1)) * (nj - 1));
    const y = plotY + (jIdx + 0.5) * cellH;
    const lat = lats[jIdx] ?? 0;
    parts.push(
      `<line x1="${plotX}" y1="${y.toFixed(1)}" x2="${plotX + plotW}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.22)" stroke-dasharray="3 3"/>`,
    );
    parts.push(
      `<text x="${plotX - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="9.5" fill="#94a3b8">${lat.toFixed(1)}°</text>`,
    );
  }
  const lonTicks = Math.min(6, ni);
  for (let t = 0; t < lonTicks; t++) {
    const iIdx = lonTicks === 1 ? 0 : Math.round((t / (lonTicks - 1)) * (ni - 1));
    const x = plotX + (iIdx + 0.5) * cellW;
    const lon = lons[iIdx] ?? 0;
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${plotY}" x2="${x.toFixed(1)}" y2="${plotY + plotH}" stroke="rgba(148,163,184,0.22)" stroke-dasharray="3 3"/>`,
    );
    parts.push(
      `<text x="${x.toFixed(1)}" y="${plotY + plotH + 15}" text-anchor="middle" font-family="monospace" font-size="9.5" fill="#94a3b8">${lon.toFixed(1)}°</text>`,
    );
  }
  parts.push(`</g>`);

  // Isobar / Isopleth Contours
  if (showIsobars && ni >= 2 && nj >= 2 && stats.max > stats.min) {
    parts.push(`<g class="grib-isobars">`);
    for (let c = 1; c <= contourLevels; c++) {
      const level = stats.min + (c / (contourLevels + 1)) * span;
      const segs = buildContourSegments(values, ni, nj, level, plotX, plotY, plotW, plotH);
      parts.push(...segs);
    }
    parts.push(`</g>`);
  }

  // Wind Barbs (from matching UGRD/VGRD messages if present, else geostrophic wind from HGT/PRMSL)
  if (showWindBarbs && ni >= 2 && nj >= 2) {
    const uMsg = doc.messages.find((m) => m.pds?.parameterCode === 33 && m.bds?.values.length === ni * nj);
    const vMsg = doc.messages.find((m) => m.pds?.parameterCode === 34 && m.bds?.values.length === ni * nj);
    let uField: number[] | null = null;
    let vField: number[] | null = null;
    if (uMsg?.bds && vMsg?.bds) {
      uField = uMsg.bds.values;
      vField = vMsg.bds.values;
    } else if (msg.pds?.parameterCode === 7 || msg.pds?.parameterCode === 2) {
      const geo = computeGeostrophicWindField(values, gds);
      uField = geo.u;
      vField = geo.v;
    }

    if (uField && vField) {
      parts.push(`<g class="grib-wind-barbs">`);
      const stepJ = Math.max(1, Math.floor(nj / 5));
      const stepI = Math.max(1, Math.floor(ni / 7));
      for (let j = 0; j < nj; j += stepJ) {
        for (let i = 0; i < ni; i += stepI) {
          const idx = j * ni + i;
          const cx = plotX + (i + 0.5) * cellW;
          const cy = plotY + (j + 0.5) * cellH;
          parts.push(renderWindBarb(cx, cy, uField[idx] ?? 0, vField[idx] ?? 0));
        }
      }
      parts.push(`</g>`);
    }
  }

  // Plot Frame
  parts.push(
    `<rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="none" stroke="#475569" stroke-width="1.2"/>`,
  );

  // Colorbar Legend
  const cbX = plotX + plotW + 18;
  const cbW = 14;
  const cbSteps = 24;
  parts.push(`<g class="grib-colorbar">`);
  for (let s = 0; s < cbSteps; s++) {
    const t = 1 - s / (cbSteps - 1);
    const y = plotY + (s / cbSteps) * plotH;
    const h = plotH / cbSteps + 0.6;
    parts.push(
      `<rect x="${cbX}" y="${y.toFixed(1)}" width="${cbW}" height="${h.toFixed(1)}" fill="${lerpColor(t, palette)}"/>`,
    );
  }
  parts.push(
    `<rect x="${cbX}" y="${plotY}" width="${cbW}" height="${plotH}" fill="none" stroke="#475569" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${cbX + cbW + 5}" y="${plotY + 8}" font-family="monospace" font-size="9.5" fill="#cbd5e1">${stats.max.toFixed(1)}</text>`,
  );
  parts.push(
    `<text x="${cbX + cbW + 5}" y="${(plotY + plotH / 2 + 3).toFixed(1)}" font-family="monospace" font-size="9.5" fill="#cbd5e1">${stats.mean.toFixed(1)}</text>`,
  );
  parts.push(
    `<text x="${cbX + cbW + 5}" y="${plotY + plotH}" font-family="monospace" font-size="9.5" fill="#cbd5e1">${stats.min.toFixed(1)}</text>`,
  );
  parts.push(`</g>`);

  // Footer statistics strip
  parts.push(
    `<text x="${plotX}" y="${height - 12}" font-family="monospace" font-size="10" fill="#94a3b8">Grid: ${ni}×${nj} | Min: ${stats.min.toFixed(2)} | Max: ${stats.max.toFixed(2)} | Area-Weighted Mean: ${stats.areaWeightedMean.toFixed(2)} ${escapeXml(unit)}</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("");
}
