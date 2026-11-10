// SPDX-License-Identifier: AGPL-3.0-or-later

import { HecRasErrorCode } from "../errors.js";
import type { HecRasFlow, HecRasGeometry } from "../types.js";

export interface HecRasDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintHecRas(geom: HecRasGeometry, flow?: HecRasFlow): HecRasDiagnostic[] {
  const diags: HecRasDiagnostic[] = [];

  // Group cross-sections by reach
  const reachesMap = new Map<string, typeof geom.crossSections>();
  for (const cs of geom.crossSections) {
    const key = `${cs.river},${cs.reach}`;
    const list = reachesMap.get(key) ?? [];
    list.push(cs);
    reachesMap.set(key, list);

    // Rule 1: Station offset monotonicity
    const pts = cs.stationElevations;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i + 1]!.station <= pts[i]!.station) {
        diags.push({
          code: HecRasErrorCode.STATION_INVERSION.code,
          rule: HecRasErrorCode.STATION_INVERSION.rule,
          severity: HecRasErrorCode.STATION_INVERSION.severity,
          message: HecRasErrorCode.STATION_INVERSION.message(cs.station, pts[i]!.station, pts[i + 1]!.station),
          line: cs.line,
        });
        break;
      }
    }

    // Rule 2: Manning bounds
    const mannings = [
      cs.manning.leftOverbank,
      cs.manning.channel,
      cs.manning.rightOverbank,
    ];
    for (const n of mannings) {
      if (n < 0.01 || n > 0.2) {
        diags.push({
          code: HecRasErrorCode.MANNING_OUT_OF_BOUNDS.code,
          rule: HecRasErrorCode.MANNING_OUT_OF_BOUNDS.rule,
          severity: HecRasErrorCode.MANNING_OUT_OF_BOUNDS.severity,
          message: HecRasErrorCode.MANNING_OUT_OF_BOUNDS.message(cs.station, n),
          line: cs.line,
        });
        break;
      }
    }

    // Rule 3: Bank stations within cross-section range
    if (pts.length >= 2) {
      const minSta = pts[0]!.station;
      const maxSta = pts[pts.length - 1]!.station;
      if (cs.bankStations.left < minSta || cs.bankStations.left > maxSta) {
        diags.push({
          code: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.code,
          rule: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.rule,
          severity: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.severity,
          message: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.message(cs.station, cs.bankStations.left, minSta, maxSta),
          line: cs.line,
        });
      }
      if (cs.bankStations.right < minSta || cs.bankStations.right > maxSta) {
        diags.push({
          code: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.code,
          rule: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.rule,
          severity: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.severity,
          message: HecRasErrorCode.BANK_STATION_OUT_OF_BOUNDS.message(cs.station, cs.bankStations.right, minSta, maxSta),
          line: cs.line,
        });
      }
    }
  }

  // Reach connectivity and slopes
  for (const [key, sections] of reachesMap.entries()) {
    const [river = "River1", reach = "Reach1"] = key.split(",");

    if (sections.length < 2) {
      diags.push({
        code: HecRasErrorCode.DISCONNECTED_REACH.code,
        rule: HecRasErrorCode.DISCONNECTED_REACH.rule,
        severity: HecRasErrorCode.DISCONNECTED_REACH.severity,
        message: HecRasErrorCode.DISCONNECTED_REACH.message(river, reach),
        line: sections[0]?.line ?? 1,
      });
      continue;
    }

    // Sort upstream to downstream (highest station to lowest station)
    const sorted = [...sections].sort((a, b) => b.station - a.station);
    for (let i = 0; i < sorted.length - 1; i++) {
      const us = sorted[i]!;
      const ds = sorted[i + 1]!;
      const usBed = us.stationElevations.reduce((min, p) => Math.min(min, p.elevation), Infinity);
      const dsBed = ds.stationElevations.reduce((min, p) => Math.min(min, p.elevation), Infinity);

      if (dsBed > usBed) {
        diags.push({
          code: HecRasErrorCode.ADVERSE_SLOPE.code,
          rule: HecRasErrorCode.ADVERSE_SLOPE.rule,
          severity: HecRasErrorCode.ADVERSE_SLOPE.severity,
          message: HecRasErrorCode.ADVERSE_SLOPE.message(us.station, ds.station, usBed, dsBed),
          line: us.line,
        });
      }
    }

    // Flow downstream boundary condition check
    if (flow) {
      const hasDsBc = flow.boundaryConditions.some(
        (bc) =>
          bc.river.toLowerCase() === river.toLowerCase() &&
          bc.reach.toLowerCase() === reach.toLowerCase() &&
          (bc.type === "Normal Depth" || bc.type === "Known WS" || bc.type === "Rating Curve"),
      );
      if (!hasDsBc) {
        diags.push({
          code: HecRasErrorCode.MISSING_DOWNSTREAM_BOUNDARY.code,
          rule: HecRasErrorCode.MISSING_DOWNSTREAM_BOUNDARY.rule,
          severity: HecRasErrorCode.MISSING_DOWNSTREAM_BOUNDARY.severity,
          message: HecRasErrorCode.MISSING_DOWNSTREAM_BOUNDARY.message(river, reach),
          line: sections[sections.length - 1]!.line,
        });
      }
    }
  }

  return diags;
}
