// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SVG 2D/Isometric Toolpath Projection for `@modelscript/gcode`.
 */

import { simulateToolpath } from "../cad/toolpath.js";
import type { GCodeProgram, ToolpathOptions, ToolpathSegment, ToolpathSummary } from "../types.js";

export interface SvgProjectionOptions extends ToolpathOptions {
  width?: number | undefined;
  height?: number | undefined;
  padding?: number | undefined;
  showRapid?: boolean | undefined;
  background?: string | undefined;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Projects a G-code program or simulated toolpath into a standalone XY-plane SVG schematic.
 */
export function gcodeToSvg(input: GCodeProgram | ToolpathSummary | string, options: SvgProjectionOptions = {}): string {
  const summary: ToolpathSummary =
    typeof input === "object" && "segments" in input ? input : simulateToolpath(input, options);

  const width = options.width ?? 640;
  const height = options.height ?? 480;
  const pad = options.padding ?? 36;
  const showRapid = options.showRapid ?? true;
  const bg = options.background ?? "#0f172a";

  const bb = summary.boundingBox;
  const spanX = Math.max(1e-3, bb.maxX - bb.minX);
  const spanY = Math.max(1e-3, bb.maxY - bb.minY);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);

  const mapX = (x: number): number => pad + (x - bb.minX) * scale;
  // Flip Y so +Y points upward (standard CNC right-handed XY plane)
  const mapY = (y: number): number => height - pad - (y - bb.minY) * scale;

  const elements: string[] = [];

  for (const seg of summary.segments) {
    if (seg.kind === "dwell") continue;
    if ((seg.kind === "rapid" || seg.kind === "drill_retract") && !showRapid) continue;

    if (seg.kind === "rapid" || seg.kind === "drill_retract") {
      elements.push(
        `  <line class="gcode-rapid" x1="${fmt(mapX(seg.start.x))}" y1="${fmt(mapY(seg.start.y))}" ` +
          `x2="${fmt(mapX(seg.end.x))}" y2="${fmt(mapY(seg.end.y))}" ` +
          `stroke="#64748b" stroke-width="1" stroke-dasharray="4 3" opacity="0.75"/>`,
      );
    } else if (seg.kind === "linear") {
      elements.push(
        `  <line class="gcode-cut" x1="${fmt(mapX(seg.start.x))}" y1="${fmt(mapY(seg.start.y))}" ` +
          `x2="${fmt(mapX(seg.end.x))}" y2="${fmt(mapY(seg.end.y))}" ` +
          `stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>`,
      );
    } else if (seg.kind === "arc_cw" || seg.kind === "arc_ccw") {
      elements.push(renderArcSvg(seg, mapX, mapY, scale));
    } else if (seg.kind === "drill_plunge") {
      const cx = fmt(mapX(seg.end.x));
      const cy = fmt(mapY(seg.end.y));
      elements.push(
        `  <circle class="gcode-drill" cx="${cx}" cy="${cy}" r="4.5" fill="none" stroke="#f97316" stroke-width="1.8"/>`,
      );
    }
  }

  const title = `${escapeXml(summary.programName)} — Cut: ${summary.cuttingLengthMm.toFixed(1)} mm | Cycle: ${summary.totalCycleTimeSec.toFixed(1)} s`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>`,
    `  <text x="12" y="20" font-family="monospace" font-size="11" fill="#cbd5e1">${title}</text>`,
    ...elements,
    `</svg>`,
    "",
  ].join("\n");
}

function renderArcSvg(
  seg: ToolpathSegment,
  mapX: (x: number) => number,
  mapY: (y: number) => number,
  scale: number,
): string {
  const r = (seg.radiusMm ?? 0) * scale;
  const sweep = seg.sweepAngleRad ?? 0;

  // Full circle case: render SVG <circle>
  if (seg.center && sweep >= 2 * Math.PI - 1e-4) {
    return (
      `  <circle class="gcode-arc" cx="${fmt(mapX(seg.center.x))}" cy="${fmt(mapY(seg.center.y))}" ` +
      `r="${fmt(r)}" fill="none" stroke="#34d399" stroke-width="2"/>`
    );
  }

  const largeArcFlag = sweep > Math.PI ? 1 : 0;
  // Since Y is flipped in SVG screen coords, CNC CW (G02) maps to SVG sweep=1, CCW (G03) maps to sweep=0
  const sweepFlag = seg.kind === "arc_cw" ? 1 : 0;
  return (
    `  <path class="gcode-arc" d="M ${fmt(mapX(seg.start.x))} ${fmt(mapY(seg.start.y))} ` +
    `A ${fmt(r)} ${fmt(r)} 0 ${largeArcFlag} ${sweepFlag} ${fmt(mapX(seg.end.x))} ${fmt(mapY(seg.end.y))}" ` +
    `fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>`
  );
}
