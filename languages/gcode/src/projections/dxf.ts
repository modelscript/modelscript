// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AutoCAD ASCII DXF Projection for `@modelscript/gcode`.
 *
 * Exports CNC toolpaths into layered DXF (`RAPID`, `CUTTING`, `ARC`, `DRILL`)
 * using standard `LINE`, `ARC`, and `CIRCLE` entities.
 */

import { simulateToolpath } from "../cad/toolpath.js";
import type { GCodeProgram, ToolpathOptions, ToolpathSummary } from "../types.js";

export interface DxfProjectionOptions extends ToolpathOptions {
  /** Include rapid traverse moves on the RAPID layer (default: true). */
  includeRapid?: boolean | undefined;
  /** Radius in mm for DRILL hole circle markers (default: 2.0). */
  drillMarkerRadiusMm?: number | undefined;
}

const RAD_TO_DEG = 180 / Math.PI;

function degNorm(rad: number): number {
  let d = (rad * RAD_TO_DEG) % 360;
  if (d < 0) d += 360;
  return d;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(6) : "0.000000";
}

/**
 * Projects a G-code program or simulated toolpath into an AutoCAD-compatible ASCII DXF string.
 */
export function gcodeToDxf(input: GCodeProgram | ToolpathSummary | string, options: DxfProjectionOptions = {}): string {
  const summary: ToolpathSummary =
    typeof input === "object" && "segments" in input ? input : simulateToolpath(input, options);

  const includeRapid = options.includeRapid ?? true;
  const drillRadius = options.drillMarkerRadiusMm ?? 2.0;

  const lines: string[] = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "70",
    "4",
    // RAPID layer (color 8 = gray)
    "0",
    "LAYER",
    "2",
    "RAPID",
    "70",
    "0",
    "62",
    "8",
    "6",
    "DASHED",
    // CUTTING layer (color 5 = blue)
    "0",
    "LAYER",
    "2",
    "CUTTING",
    "70",
    "0",
    "62",
    "5",
    "6",
    "CONTINUOUS",
    // ARC layer (color 3 = green)
    "0",
    "LAYER",
    "2",
    "ARC",
    "70",
    "0",
    "62",
    "3",
    "6",
    "CONTINUOUS",
    // DRILL layer (color 1 = red)
    "0",
    "LAYER",
    "2",
    "DRILL",
    "70",
    "0",
    "62",
    "1",
    "6",
    "CONTINUOUS",
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];

  for (const seg of summary.segments) {
    if (seg.kind === "dwell") continue;

    if (seg.kind === "rapid" || seg.kind === "drill_retract") {
      if (!includeRapid) continue;
      lines.push(
        "0",
        "LINE",
        "8",
        "RAPID",
        "10",
        fmt(seg.start.x),
        "20",
        fmt(seg.start.y),
        "30",
        fmt(seg.start.z),
        "11",
        fmt(seg.end.x),
        "21",
        fmt(seg.end.y),
        "31",
        fmt(seg.end.z),
      );
    } else if (seg.kind === "linear") {
      lines.push(
        "0",
        "LINE",
        "8",
        "CUTTING",
        "10",
        fmt(seg.start.x),
        "20",
        fmt(seg.start.y),
        "30",
        fmt(seg.start.z),
        "11",
        fmt(seg.end.x),
        "21",
        fmt(seg.end.y),
        "31",
        fmt(seg.end.z),
      );
    } else if ((seg.kind === "arc_cw" || seg.kind === "arc_ccw") && seg.center && seg.radiusMm) {
      const sweep = seg.sweepAngleRad ?? 0;
      if (sweep >= 2 * Math.PI - 1e-4) {
        lines.push(
          "0",
          "CIRCLE",
          "8",
          "ARC",
          "10",
          fmt(seg.center.x),
          "20",
          fmt(seg.center.y),
          "30",
          fmt(seg.start.z),
          "40",
          fmt(seg.radiusMm),
        );
      } else {
        const aStart = degNorm(Math.atan2(seg.start.y - seg.center.y, seg.start.x - seg.center.x));
        const aEnd = degNorm(Math.atan2(seg.end.y - seg.center.y, seg.end.x - seg.center.x));
        // DXF ARC entities are always counter-clockwise from group 50 to group 51
        const dxfStart = seg.kind === "arc_cw" ? aEnd : aStart;
        const dxfEnd = seg.kind === "arc_cw" ? aStart : aEnd;
        lines.push(
          "0",
          "ARC",
          "8",
          "ARC",
          "10",
          fmt(seg.center.x),
          "20",
          fmt(seg.center.y),
          "30",
          fmt(seg.start.z),
          "40",
          fmt(seg.radiusMm),
          "50",
          fmt(dxfStart),
          "51",
          fmt(dxfEnd),
        );
      }
    } else if (seg.kind === "drill_plunge") {
      lines.push(
        "0",
        "CIRCLE",
        "8",
        "DRILL",
        "10",
        fmt(seg.end.x),
        "20",
        fmt(seg.end.y),
        "30",
        fmt(seg.end.z),
        "40",
        fmt(drillRadius),
      );
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF", "");
  return lines.join("\n");
}
