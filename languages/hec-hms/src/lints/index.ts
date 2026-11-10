// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for USACE HEC-HMS watershed models (.basin).
 */

import type { HmsBasinModel } from "../types.js";

export interface HmsDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  elementName?: string;
}

export const HmsErrorCode = {
  INVALID_AREA: "HMS1001",
  UNKNOWN_DOWNSTREAM: "HMS2001",
  TOPOLOGICAL_CYCLE: "HMS2002",
  INVALID_CURVE_NUMBER: "HMS3001",
  INVALID_MUSKINGUM_X: "HMS3002",
  INVALID_MUSKINGUM_K: "HMS3003",
} as const;

/**
 * Validates a HEC-HMS basin model for topological, hydrologic, and numerical consistency.
 */
export function lintHmsBasin(basin: HmsBasinModel): HmsDiagnostic[] {
  const diagnostics: HmsDiagnostic[] = [];

  const allElements = new Set<string>([
    ...basin.subbasins.keys(),
    ...basin.reaches.keys(),
    ...basin.junctions.keys(),
    ...basin.reservoirs.keys(),
    ...basin.sinks.keys(),
  ]);

  // 1. Subbasin validation
  for (const [name, sb] of basin.subbasins) {
    if (sb.area <= 0) {
      diagnostics.push({
        code: HmsErrorCode.INVALID_AREA,
        severity: "error",
        message: `Subbasin '${name}' has invalid non-positive drainage area (${sb.area}).`,
        elementName: name,
      });
    }

    if (sb.downstream && !allElements.has(sb.downstream)) {
      diagnostics.push({
        code: HmsErrorCode.UNKNOWN_DOWNSTREAM,
        severity: "error",
        message: `Subbasin '${name}' references unknown downstream element '${sb.downstream}'.`,
        elementName: name,
      });
    }

    if (sb.curveNumber !== undefined && (sb.curveNumber <= 0 || sb.curveNumber > 100)) {
      diagnostics.push({
        code: HmsErrorCode.INVALID_CURVE_NUMBER,
        severity: "error",
        message: `Subbasin '${name}' has out-of-bounds Curve Number (${sb.curveNumber}). Must be in (0, 100].`,
        elementName: name,
      });
    }
  }

  // 2. Reach validation
  for (const [name, r] of basin.reaches) {
    if (r.downstream && !allElements.has(r.downstream)) {
      diagnostics.push({
        code: HmsErrorCode.UNKNOWN_DOWNSTREAM,
        severity: "error",
        message: `Reach '${name}' references unknown downstream element '${r.downstream}'.`,
        elementName: name,
      });
    }

    if (r.muskingumK !== undefined && r.muskingumK <= 0) {
      diagnostics.push({
        code: HmsErrorCode.INVALID_MUSKINGUM_K,
        severity: "error",
        message: `Reach '${name}' has non-positive Muskingum travel time K (${r.muskingumK} hrs).`,
        elementName: name,
      });
    }

    if (r.muskingumX !== undefined && (r.muskingumX < 0 || r.muskingumX > 0.5)) {
      diagnostics.push({
        code: HmsErrorCode.INVALID_MUSKINGUM_X,
        severity: "error",
        message: `Reach '${name}' has Muskingum X weighting factor (${r.muskingumX}) outside stable range [0.0, 0.5].`,
        elementName: name,
      });
    }
  }

  // 3. Topological cycle detection
  const downstreamMap = new Map<string, string>();
  for (const [name, sb] of basin.subbasins) {
    if (sb.downstream) downstreamMap.set(name, sb.downstream);
  }
  for (const [name, r] of basin.reaches) {
    if (r.downstream) downstreamMap.set(name, r.downstream);
  }
  for (const [name, j] of basin.junctions) {
    if (j.downstream) downstreamMap.set(name, j.downstream);
  }

  for (const startNode of downstreamMap.keys()) {
    const visited = new Set<string>();
    let curr: string | undefined = startNode;
    while (curr) {
      if (visited.has(curr)) {
        diagnostics.push({
          code: HmsErrorCode.TOPOLOGICAL_CYCLE,
          severity: "error",
          message: `Drainage network contains a topological cycle involving element '${curr}'.`,
          elementName: curr,
        });
        break;
      }
      visited.add(curr);
      curr = downstreamMap.get(curr);
    }
  }

  return diagnostics;
}
