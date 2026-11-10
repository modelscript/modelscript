// SPDX-License-Identifier: AGPL-3.0-or-later

import { GtfsErrorCode } from "../errors.js";
import { solveTractionProfiles, timeStringToSeconds } from "../solver/index.js";
import type { GtfsFeed } from "../types.js";

export interface GtfsDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintGtfs(feed: GtfsFeed): GtfsDiagnostic[] {
  const diags: GtfsDiagnostic[] = [];
  const { stops, routes, trips, stopTimes } = feed;

  const stopSet = new Set(stops.map((s) => s.stop_id));
  const routeSet = new Set(routes.map((r) => r.route_id));

  // 1. Validate route references in trips
  for (const t of trips) {
    if (routes.length > 0 && !routeSet.has(t.route_id)) {
      diags.push({
        code: GtfsErrorCode.ROUTE_NOT_FOUND.code,
        rule: GtfsErrorCode.ROUTE_NOT_FOUND.rule,
        severity: GtfsErrorCode.ROUTE_NOT_FOUND.severity,
        message: GtfsErrorCode.ROUTE_NOT_FOUND.message(t.route_id, t.trip_id),
        line: t.line ?? 1,
      });
    }
  }

  // 2. Validate stop references and chronological time ordering in stopTimes
  const tripStopMap = new Map<string, typeof stopTimes>();
  for (const st of stopTimes) {
    if (stops.length > 0 && !stopSet.has(st.stop_id)) {
      diags.push({
        code: GtfsErrorCode.STOP_NOT_FOUND.code,
        rule: GtfsErrorCode.STOP_NOT_FOUND.rule,
        severity: GtfsErrorCode.STOP_NOT_FOUND.severity,
        message: GtfsErrorCode.STOP_NOT_FOUND.message(st.stop_id, st.trip_id),
        line: st.line ?? 1,
      });
    }

    const list = tripStopMap.get(st.trip_id) ?? [];
    list.push(st);
    tripStopMap.set(st.trip_id, list);
  }

  // 3. Time reversal checks
  for (const [tripId, list] of tripStopMap.entries()) {
    list.sort((a, b) => a.stop_sequence - b.stop_sequence);
    for (let k = 0; k < list.length - 1; k++) {
      const st1 = list[k]!;
      const st2 = list[k + 1]!;
      const tDep = timeStringToSeconds(st1.departure_time);
      const tArr = timeStringToSeconds(st2.arrival_time);
      if (tArr < tDep) {
        diags.push({
          code: GtfsErrorCode.TIME_REVERSAL.code,
          rule: GtfsErrorCode.TIME_REVERSAL.rule,
          severity: GtfsErrorCode.TIME_REVERSAL.severity,
          message: GtfsErrorCode.TIME_REVERSAL.message(tripId, st2.stop_sequence),
          line: st2.line ?? 1,
        });
      }
    }
  }

  // 4. Kinematic & battery depletion checks via traction solver
  const profiles = solveTractionProfiles(feed);
  for (const p of profiles) {
    if (p.peakSpeedKmh > 120.0) {
      diags.push({
        code: GtfsErrorCode.EXCESSIVE_TRANSIT_SPEED.code,
        rule: GtfsErrorCode.EXCESSIVE_TRANSIT_SPEED.rule,
        severity: GtfsErrorCode.EXCESSIVE_TRANSIT_SPEED.severity,
        message: GtfsErrorCode.EXCESSIVE_TRANSIT_SPEED.message(p.tripId, p.peakSpeedKmh),
        line: 1,
      });
    }

    if (p.finalSoc < 10.0) {
      diags.push({
        code: GtfsErrorCode.BATTERY_DEPLETION.code,
        rule: GtfsErrorCode.BATTERY_DEPLETION.rule,
        severity: GtfsErrorCode.BATTERY_DEPLETION.severity,
        message: GtfsErrorCode.BATTERY_DEPLETION.message(p.tripId, p.finalSoc),
        line: 1,
      });
    }
  }

  return diags;
}
