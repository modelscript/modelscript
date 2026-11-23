// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standalone XY-Plane SVG Toolpath Projection for `@modelscript/apt`.
 */

import { solveAptToClData, type SolveClDataOptions } from "../cad/geometry-solver.js";
import { parseAptProgram } from "../parser/apt-parser.js";
import type { AptProgram, ClDataProgram, ClDataRecord } from "../types.js";

export interface AptSvgOptions extends SolveClDataOptions {
  width?: number | undefined;
  height?: number | undefined;
  padding?: number | undefined;
  showRapid?: boolean | undefined;
  showGeometry?: boolean | undefined;
  background?: string | undefined;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderArcSvg(
  rec: ClDataRecord,
  mapX: (x: number) => number,
  mapY: (y: number) => number,
  scale: number,
): string {
  const r = (rec.radius ?? 0) * scale;
  const sweepMag = Math.abs(rec.sweepAngle ?? 0);

  if (rec.cx !== undefined && rec.cy !== undefined && sweepMag >= 2 * Math.PI - 1e-4) {
    return (
      `  <circle class="apt-arc" cx="${fmt(mapX(rec.cx))}" cy="${fmt(mapY(rec.cy))}" ` +
      `r="${fmt(r)}" fill="none" stroke="#34d399" stroke-width="2"/>`
    );
  }

  const x0 = rec.x0 ?? 0;
  const y0 = rec.y0 ?? 0;
  const x1 = rec.x ?? 0;
  const y1 = rec.y ?? 0;
  const largeArcFlag = sweepMag > Math.PI ? 1 : 0;
  // Because Y is flipped in SVG screen coordinates, CW maps to sweep=1 and CCW maps to sweep=0.
  const sweepFlag = rec.kind === "ARC_CW" ? 1 : 0;
  return (
    `  <path class="apt-arc" d="M ${fmt(mapX(x0))} ${fmt(mapY(y0))} ` +
    `A ${fmt(r)} ${fmt(r)} 0 ${largeArcFlag} ${sweepFlag} ${fmt(mapX(x1))} ${fmt(mapY(y1))}" ` +
    `fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>`
  );
}

/**
 * Projects an APT part program or solved CLDATA toolpath into a standalone XY-plane SVG diagram.
 */
export function aptToSvg(input: AptProgram | ClDataProgram | string, options: AptSvgOptions = {}): string {
  const clData: ClDataProgram =
    typeof input === "string"
      ? solveAptToClData(parseAptProgram(input), options)
      : "records" in input
        ? input
        : solveAptToClData(input, options);

  const width = options.width ?? 640;
  const height = options.height ?? 480;
  const pad = options.padding ?? 40;
  const showRapid = options.showRapid ?? true;
  const showGeometry = options.showGeometry ?? true;
  const bg = options.background ?? "#0f172a";

  const bb = clData.boundingBox;
  const spanX = Math.max(1e-3, bb.maxX - bb.minX);
  const spanY = Math.max(1e-3, bb.maxY - bb.minY);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);

  const mapX = (x: number): number => pad + (x - bb.minX) * scale;
  const mapY = (y: number): number => height - pad - (y - bb.minY) * scale;

  const elements: string[] = [];

  // Optional canonical geometry overlay (reference points & circles)
  if (showGeometry) {
    for (const geom of clData.geometries.values()) {
      if (geom.kind === "POINT") {
        const px = fmt(mapX(geom.x));
        const py = fmt(mapY(geom.y));
        elements.push(`  <circle class="apt-geom-point" cx="${px}" cy="${py}" r="2.5" fill="#94a3b8" opacity="0.65"/>`);
      } else if (geom.kind === "CIRCLE") {
        elements.push(
          `  <circle class="apt-geom-circle" cx="${fmt(mapX(geom.cx))}" cy="${fmt(mapY(geom.cy))}" ` +
            `r="${fmt(geom.radius * scale)}" fill="none" stroke="#475569" stroke-width="1" stroke-dasharray="3 3"/>`,
        );
      }
    }
  }

  // Toolpath segments
  for (const rec of clData.records) {
    if (rec.kind === "FROM" && rec.x !== undefined && rec.y !== undefined) {
      elements.push(
        `  <circle class="apt-from" cx="${fmt(mapX(rec.x))}" cy="${fmt(mapY(rec.y))}" ` +
          `r="4.5" fill="none" stroke="#f59e0b" stroke-width="1.8"/>`,
      );
    } else if (
      rec.kind === "RAPID" &&
      showRapid &&
      rec.x0 !== undefined &&
      rec.y0 !== undefined &&
      rec.x !== undefined &&
      rec.y !== undefined
    ) {
      elements.push(
        `  <line class="apt-rapid" x1="${fmt(mapX(rec.x0))}" y1="${fmt(mapY(rec.y0))}" ` +
          `x2="${fmt(mapX(rec.x))}" y2="${fmt(mapY(rec.y))}" ` +
          `stroke="#64748b" stroke-width="1" stroke-dasharray="4 3" opacity="0.8"/>`,
      );
    } else if (
      rec.kind === "LINEAR" &&
      rec.x0 !== undefined &&
      rec.y0 !== undefined &&
      rec.x !== undefined &&
      rec.y !== undefined
    ) {
      elements.push(
        `  <line class="apt-cut" x1="${fmt(mapX(rec.x0))}" y1="${fmt(mapY(rec.y0))}" ` +
          `x2="${fmt(mapX(rec.x))}" y2="${fmt(mapY(rec.y))}" ` +
          `stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>`,
      );
    } else if (rec.kind === "ARC_CW" || rec.kind === "ARC_CCW") {
      elements.push(renderArcSvg(rec, mapX, mapY, scale));
    }
  }

  const unitLabel = clData.units === "MM" ? "mm" : "in";
  const title = `${escapeXml(clData.partno)} — Cut: ${clData.totalCuttingLength.toFixed(2)} ${unitLabel} | Cycle: ${clData.totalCycleTimeSec.toFixed(1)} s`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>`,
    `  <text x="12" y="20" font-family="monospace" font-size="11" fill="#cbd5e1">${title}</text>`,
    ...elements,
    `</svg>`,
    "",
  ].join("\n");
}
