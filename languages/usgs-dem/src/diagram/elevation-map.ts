// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG Hypsometric-Tint Elevation Map, Marching-Squares Topographic Contour Lines,
 * and Elevation Cross-Section Profile renderer for USGS DEM grids.
 */

import { computeHypsometricIntegral, extractElevationProfile } from "../solver/index.js";
import type { UsgsDemModel } from "../types.js";

export interface UsgsDemMapSvgOptions {
  width?: number | undefined;
  height?: number | undefined;
  showContours?: boolean | undefined;
  contourLevels?: number | undefined;
  /** Normalized row fraction (0..1) for the West-to-East elevation cross-section transect (default 0.5). */
  transectFraction?: number | undefined;
  showCrossSection?: boolean | undefined;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Classic USGS hypsometric tint ramp: lowland emerald -> olive -> ochre -> sienna -> alpine snow
const HYPSOMETRIC_STOPS: ReadonlyArray<readonly [number, Rgb]> = [
  [0.0, { r: 30, g: 92, b: 64 }],
  [0.25, { r: 94, g: 148, b: 84 }],
  [0.5, { r: 196, g: 176, b: 104 }],
  [0.75, { r: 162, g: 108, b: 74 }],
  [0.92, { r: 198, g: 186, b: 178 }],
  [1.0, { r: 245, g: 247, b: 250 }],
];

function hypsometricColor(tRaw: number): string {
  const t = Math.max(0, Math.min(1, tRaw));
  for (let i = 0; i < HYPSOMETRIC_STOPS.length - 1; i++) {
    const [t0, c0] = HYPSOMETRIC_STOPS[i]!;
    const [t1, c1] = HYPSOMETRIC_STOPS[i + 1]!;
    if (t >= t0 && t <= t1) {
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const r = Math.round(c0.r + f * (c1.r - c0.r));
      const g = Math.round(c0.g + f * (c1.g - c0.g));
      const b = Math.round(c0.b + f * (c1.b - c0.b));
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(245,247,250)";
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function interpEdge(v0: number, v1: number, level: number): number {
  const d = v1 - v0;
  if (Math.abs(d) < 1e-12) return 0.5;
  return Math.max(0, Math.min(1, (level - v0) / d));
}

/**
 * Render a pure SVG hypsometric-tint elevation map with topographic contour lines
 * and an embedded West-to-East elevation cross-section profile.
 */
export function renderUsgsDemMapSvg(model: UsgsDemModel, options: UsgsDemMapSvgOptions = {}): string {
  const width = options.width ?? 760;
  const showCrossSection = options.showCrossSection ?? true;
  const height = options.height ?? (showCrossSection ? 560 : 410);
  const showContours = options.showContours ?? true;
  const contourLevels = Math.max(2, Math.min(20, options.contourLevels ?? 8));
  const transectFrac = Math.max(0, Math.min(1, options.transectFraction ?? 0.5));

  const { grid, header } = model;
  const hypso = computeHypsometricIntegral(grid);

  const mapLeft = 48;
  const mapTop = 44;
  const legendWidth = 68;
  const mapWidth = width - mapLeft - legendWidth - 28;
  const mapHeight = showCrossSection ? 320 : height - mapTop - 42;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#0f172a" rx="8"/>`,
    `<text x="${mapLeft}" y="26" font-family="ui-monospace, SFMono-Regular, monospace" font-size="13" font-weight="700" fill="#f8fafc">${escapeXml(header.quadrangleName || "USGS DEM")}</text>`,
    `<text x="${mapLeft + mapWidth}" y="26" text-anchor="end" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" fill="#94a3b8">${grid.numCols}x${grid.numRows} | dx=${grid.dx} dy=${grid.dy} | Z=[${hypso.minElevation.toFixed(1)}, ${hypso.maxElevation.toFixed(1)}]</text>`,
  ];

  if (grid.numCols < 2 || grid.numRows < 2) {
    parts.push(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="monospace" font-size="12" fill="#94a3b8">Insufficient elevation grid data to render map.</text>`,
      `</svg>`,
    );
    return parts.join("\n");
  }

  // Downsample cell rendering if grid is huge so SVG stays crisp and fast
  const maxRenderCols = 64;
  const maxRenderRows = 48;
  const stepC = Math.max(1, Math.ceil(grid.numCols / maxRenderCols));
  const stepR = Math.max(1, Math.ceil(grid.numRows / maxRenderRows));
  const renderCols = Math.ceil(grid.numCols / stepC);
  const renderRows = Math.ceil(grid.numRows / stepR);
  const cellW = mapWidth / renderCols;
  const cellH = mapHeight / renderRows;
  const relief = Math.max(1e-9, hypso.maxElevation - hypso.minElevation);

  // 1. Hypsometric-tint raster cells (row 0 = south at bottom, row numRows-1 = north at top)
  parts.push(`<g id="hypsometric-cells">`);
  for (let rr = 0; rr < renderRows; rr++) {
    const srcR = Math.min(grid.numRows - 1, rr * stepR);
    const py = mapTop + (renderRows - 1 - rr) * cellH;
    for (let cc = 0; cc < renderCols; cc++) {
      const srcC = Math.min(grid.numCols - 1, cc * stepC);
      const val = grid.z[srcR * grid.numCols + srcC]!;
      const color = val === grid.voidValue ? "#1e293b" : hypsometricColor((val - hypso.minElevation) / relief);
      const px = mapLeft + cc * cellW;
      parts.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(cellW + 0.5).toFixed(2)}" height="${(cellH + 0.5).toFixed(2)}" fill="${color}"/>`,
      );
    }
  }
  parts.push(`</g>`);

  // 2. Topographic contour lines via marching squares on the sampled grid
  if (showContours && relief > 1e-6) {
    const contourPaths: string[] = [];
    for (let lv = 1; lv < contourLevels; lv++) {
      const level = hypso.minElevation + (lv / contourLevels) * relief;
      const segs: string[] = [];

      for (let rr = 0; rr < renderRows - 1; rr++) {
        const r0 = Math.min(grid.numRows - 1, rr * stepR);
        const r1 = Math.min(grid.numRows - 1, (rr + 1) * stepR);
        for (let cc = 0; cc < renderCols - 1; cc++) {
          const c0 = Math.min(grid.numCols - 1, cc * stepC);
          const c1 = Math.min(grid.numCols - 1, (cc + 1) * stepC);

          const z00 = grid.z[r0 * grid.numCols + c0]!;
          const z10 = grid.z[r0 * grid.numCols + c1]!;
          const z11 = grid.z[r1 * grid.numCols + c1]!;
          const z01 = grid.z[r1 * grid.numCols + c0]!;
          if (z00 === grid.voidValue || z10 === grid.voidValue || z11 === grid.voidValue || z01 === grid.voidValue) {
            continue;
          }

          const pts: Array<[number, number]> = [];
          const xL = mapLeft + (cc + 0.5) * cellW;
          const xR = mapLeft + (cc + 1.5) * cellW;
          const yB = mapTop + (renderRows - 1 - rr + 0.5) * cellH;
          const yT = mapTop + (renderRows - 2 - rr + 0.5) * cellH;

          // Bottom edge (z00 -> z10)
          if (z00 < level !== z10 < level) {
            const t = interpEdge(z00, z10, level);
            pts.push([xL + t * (xR - xL), yB]);
          }
          // Right edge (z10 -> z11)
          if (z10 < level !== z11 < level) {
            const t = interpEdge(z10, z11, level);
            pts.push([xR, yB + t * (yT - yB)]);
          }
          // Top edge (z01 -> z11)
          if (z01 < level !== z11 < level) {
            const t = interpEdge(z01, z11, level);
            pts.push([xL + t * (xR - xL), yT]);
          }
          // Left edge (z00 -> z01)
          if (z00 < level !== z01 < level) {
            const t = interpEdge(z00, z01, level);
            pts.push([xL, yB + t * (yT - yB)]);
          }

          if (pts.length >= 2) {
            segs.push(
              `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}L${pts[1]![0].toFixed(1)},${pts[1]![1].toFixed(1)}`,
            );
            if (pts.length === 4) {
              segs.push(
                `M${pts[2]![0].toFixed(1)},${pts[2]![1].toFixed(1)}L${pts[3]![0].toFixed(1)},${pts[3]![1].toFixed(1)}`,
              );
            }
          }
        }
      }

      if (segs.length > 0) {
        const isIndex = lv % 2 === 0;
        contourPaths.push(
          `<path d="${segs.join("")}" fill="none" stroke="#0f172a" stroke-opacity="${isIndex ? "0.75" : "0.42"}" stroke-width="${isIndex ? "1.25" : "0.75"}"/>`,
        );
      }
    }
    parts.push(`<g id="contour-lines">${contourPaths.join("")}</g>`);
  }

  // Map border frame
  parts.push(
    `<rect x="${mapLeft}" y="${mapTop}" width="${mapWidth}" height="${mapHeight}" fill="none" stroke="#475569" stroke-width="1.2"/>`,
  );

  // 3. Transect line on map
  const transectYMap = mapTop + (1 - transectFrac) * mapHeight;
  if (showCrossSection) {
    parts.push(
      `<line x1="${mapLeft}" y1="${transectYMap.toFixed(1)}" x2="${(mapLeft + mapWidth).toFixed(1)}" y2="${transectYMap.toFixed(1)}" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="5,3"/>`,
      `<text x="${mapLeft + 4}" y="${(transectYMap - 4).toFixed(1)}" font-family="monospace" font-size="9" fill="#38bdf8">A</text>`,
      `<text x="${mapLeft + mapWidth - 10}" y="${(transectYMap - 4).toFixed(1)}" font-family="monospace" font-size="9" fill="#38bdf8">A'</text>`,
    );
  }

  // 4. Hypsometric color legend bar
  const legX = mapLeft + mapWidth + 16;
  const legW = 14;
  const legSteps = 20;
  for (let i = 0; i < legSteps; i++) {
    const t = 1 - i / (legSteps - 1);
    const y = mapTop + (i / legSteps) * mapHeight;
    const h = mapHeight / legSteps + 0.5;
    parts.push(
      `<rect x="${legX}" y="${y.toFixed(1)}" width="${legW}" height="${h.toFixed(1)}" fill="${hypsometricColor(t)}"/>`,
    );
  }
  parts.push(
    `<rect x="${legX}" y="${mapTop}" width="${legW}" height="${mapHeight}" fill="none" stroke="#475569" stroke-width="1"/>`,
    `<text x="${legX + legW + 5}" y="${mapTop + 9}" font-family="monospace" font-size="9" fill="#cbd5e1">${hypso.maxElevation.toFixed(0)}</text>`,
    `<text x="${legX + legW + 5}" y="${mapTop + mapHeight / 2 + 3}" font-family="monospace" font-size="9" fill="#cbd5e1">${((hypso.minElevation + hypso.maxElevation) / 2).toFixed(0)}</text>`,
    `<text x="${legX + legW + 5}" y="${mapTop + mapHeight}" font-family="monospace" font-size="9" fill="#cbd5e1">${hypso.minElevation.toFixed(0)}</text>`,
  );

  // 5. Embedded Elevation Cross-Section Profile (A -> A')
  if (showCrossSection) {
    const profTop = mapTop + mapHeight + 30;
    const profH = height - profTop - 28;
    const totalX = (grid.numCols - 1) * grid.dx;
    const yLocal = transectFrac * (grid.numRows - 1) * grid.dy;
    const profilePts = extractElevationProfile(grid, 0, yLocal, totalX, yLocal, 60, true);

    parts.push(
      `<text x="${mapLeft}" y="${profTop - 8}" font-family="monospace" font-size="10" font-weight="600" fill="#38bdf8">Elevation Cross-Section (A → A' at y=${yLocal.toFixed(0)})</text>`,
      `<rect x="${mapLeft}" y="${profTop}" width="${mapWidth}" height="${profH}" fill="#1e293b" stroke="#334155" stroke-width="1" rx="3"/>`,
    );

    const validPts = profilePts.filter((p) => Number.isFinite(p.elevation));
    if (validPts.length >= 2) {
      const polyCoords = validPts.map((p) => {
        const px = mapLeft + (totalX > 0 ? (p.distance / totalX) * mapWidth : 0);
        const py = profTop + profH - ((p.elevation - hypso.minElevation) / relief) * (profH - 12) - 6;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      });
      const firstX = mapLeft;
      const lastX = mapLeft + mapWidth;
      const baseY = profTop + profH;
      const fillPath = `M${firstX},${baseY} L${polyCoords.join(" L")} L${lastX},${baseY} Z`;
      parts.push(
        `<path d="${fillPath}" fill="#38bdf8" fill-opacity="0.18"/>`,
        `<polyline points="${polyCoords.join(" ")}" fill="none" stroke="#38bdf8" stroke-width="1.8"/>`,
      );
    }

    parts.push(
      `<text x="${mapLeft - 4}" y="${profTop + 10}" text-anchor="end" font-family="monospace" font-size="8.5" fill="#94a3b8">${hypso.maxElevation.toFixed(0)}</text>`,
      `<text x="${mapLeft - 4}" y="${profTop + profH}" text-anchor="end" font-family="monospace" font-size="8.5" fill="#94a3b8">${hypso.minElevation.toFixed(0)}</text>`,
      `<text x="${mapLeft}" y="${profTop + profH + 14}" font-family="monospace" font-size="8.5" fill="#94a3b8">0</text>`,
      `<text x="${mapLeft + mapWidth}" y="${profTop + profH + 14}" text-anchor="end" font-family="monospace" font-size="8.5" fill="#94a3b8">${totalX.toFixed(0)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
