// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — ASAM OpenDRIVE Pre-Flight Diagnostic Linter Rules.
 *
 * Conforms to OpenModelica diagnostic conventions:
 * 1. Single quotes for identifiers ('${name}').
 * 2. Period-terminated message.
 * 3. Exact error codes M7801–M7820.
 */

import { evaluateGeometry } from "../geometry/clothoid.js";
import type { OpenDriveDiagnostic, OpenDriveDocument, OpenDriveRange } from "../types.js";

export const OpenDriveErrorCode = {
  ROAD_TANGENCY_DISCONTINUITY: {
    code: "M7801",
    severity: "error" as const,
    message: (roadId: string, s: number, posGap: number, hdgGap: number) =>
      `Tangency discontinuity between geometry segments in road '${roadId}' at s=${s}: position gap ${posGap.toFixed(3)}m, heading gap ${hdgGap.toFixed(3)}rad.`,
  },
  UNLINKED_LANE_BOUNDARY: {
    code: "M7802",
    severity: "error" as const,
    message: (roadId: string, laneId: number, dir: string, targetId: number) =>
      `Unlinked lane connection: lane '${laneId}' in road '${roadId}' links to non-existent ${dir} lane '${targetId}'.`,
  },
  CLOTHOID_CURVATURE_DIVERGENCE: {
    code: "M7803",
    severity: "error" as const,
    message: (roadId: string, s: number, kDot: number) =>
      `Clothoid curvature rate of change in road '${roadId}' at s=${s} diverges (${kDot.toFixed(4)} 1/m^2).`,
  },
  OVERLAPPING_JUNCTION_PATHS: {
    code: "M7804",
    severity: "warning" as const,
    message: (junctionId: string, road1: string, road2: string) =>
      `Connecting path in junction '${junctionId}' between road '${road1}' and '${road2}' conflicts without priority control.`,
  },
  ELEVATION_GRADIENT_EXTREME: {
    code: "M7805",
    severity: "warning" as const,
    message: (roadId: string, s: number, slopePct: number) =>
      `Extreme elevation gradient in road '${roadId}' at s=${s}: slope ${slopePct.toFixed(1)}% exceeds standard 15% safety threshold.`,
  },
  NEGATIVE_LANE_WIDTH: {
    code: "M7806",
    severity: "error" as const,
    message: (roadId: string, laneId: number, sOffset: number) =>
      `Negative or zero lane width in lane '${laneId}' of road '${roadId}' at sOffset=${sOffset}m.`,
  },
  DUPLICATE_ROAD_ID: {
    code: "M7807",
    severity: "error" as const,
    message: (roadId: string) => `Duplicate road ID '${roadId}' detected in roadway network.`,
  },
  MISSING_CENTER_LANE: {
    code: "M7808",
    severity: "error" as const,
    message: (roadId: string, s: number) =>
      `Lane section in road '${roadId}' at s=${s} is missing mandatory center lane (ID 0).`,
  },
  DISCONTINUOUS_LANE_LINK: {
    code: "M7809",
    severity: "error" as const,
    message: (laneId: number, secA: number, secB: number) =>
      `Lane '${laneId}' in road section ${secA} has discontinuous successor link in section ${secB}.`,
  },
  SPIRAL_CLOTHOID_SINGULARITY: {
    code: "M7810",
    severity: "error" as const,
    message: (roadId: string) =>
      `Transition spiral in road '${roadId}' specifies zero length with non-zero curvature delta.`,
  },
  INVALID_SPEED_LIMIT: {
    code: "M7811",
    severity: "error" as const,
    message: (roadId: string, speed: number) =>
      `Speed limit record in road '${roadId}' specifies non-positive maximum velocity (${speed} m/s).`,
  },
};

export function lintOpenDrive(doc: OpenDriveDocument): OpenDriveDiagnostic[] {
  const diagnostics: OpenDriveDiagnostic[] = [];

  // 1. Duplicate Road ID Check (M7807)
  const seenRoadIds = new Map<string, OpenDriveRange>();
  for (const road of doc.roads) {
    const existing = seenRoadIds.get(road.id);
    if (existing) {
      diagnostics.push({
        code: OpenDriveErrorCode.DUPLICATE_ROAD_ID.code,
        severity: OpenDriveErrorCode.DUPLICATE_ROAD_ID.severity,
        message: OpenDriveErrorCode.DUPLICATE_ROAD_ID.message(road.id),
        range: road.range,
      });
    } else {
      seenRoadIds.set(road.id, road.range);
    }
  }

  for (const road of doc.roads) {
    // 2. Geometry Tangency & Clothoid Divergence Checks (M7801, M7803)
    for (let i = 0; i < road.planView.length; i++) {
      const g = road.planView[i];
      if (!g) continue;

      // Clothoid curvature rate & singularity check (M7803, M7810)
      if (g.type === "spiral") {
        if (g.length <= 1e-6) {
          if (Math.abs(g.curvEnd - g.curvStart) > 1e-9) {
            diagnostics.push({
              code: OpenDriveErrorCode.SPIRAL_CLOTHOID_SINGULARITY.code,
              severity: OpenDriveErrorCode.SPIRAL_CLOTHOID_SINGULARITY.severity,
              message: OpenDriveErrorCode.SPIRAL_CLOTHOID_SINGULARITY.message(road.id),
              range: g.range,
            });
          } else {
            diagnostics.push({
              code: OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.code,
              severity: OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.severity,
              message: OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.message(road.id, g.s, 0.0),
              range: g.range,
            });
          }
        } else {
          const kDot = Math.abs(g.curvEnd - g.curvStart) / g.length;
          if (kDot > 10.0) {
            diagnostics.push({
              code: OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.code,
              severity: OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.severity,
              message: OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.message(road.id, g.s, kDot),
              range: g.range,
            });
          }
        }
      }

      // Check tangency with next geometry element
      if (i < road.planView.length - 1) {
        const nextG = road.planView[i + 1];
        if (!nextG) continue;
        const endEval = evaluateGeometry(g, g.length);
        const startNextX = nextG.x;
        const startNextY = nextG.y;
        const startNextHdg = nextG.hdg;

        const posGap = Math.hypot(endEval.x - startNextX, endEval.y - startNextY);
        let hdgGap = Math.abs(endEval.hdg - startNextHdg);
        if (hdgGap > Math.PI) hdgGap = Math.abs(hdgGap - 2 * Math.PI);

        if (posGap > 0.05 || hdgGap > 0.05) {
          diagnostics.push({
            code: OpenDriveErrorCode.ROAD_TANGENCY_DISCONTINUITY.code,
            severity: OpenDriveErrorCode.ROAD_TANGENCY_DISCONTINUITY.severity,
            message: OpenDriveErrorCode.ROAD_TANGENCY_DISCONTINUITY.message(road.id, nextG.s, posGap, hdgGap),
            range: nextG.range,
          });
        }
      }
    }

    // 3. Elevation Profile Gradient Check (M7805)
    for (const elev of road.elevationProfile) {
      const slope = Math.abs(elev.b);
      if (slope > 0.15) {
        diagnostics.push({
          code: OpenDriveErrorCode.ELEVATION_GRADIENT_EXTREME.code,
          severity: OpenDriveErrorCode.ELEVATION_GRADIENT_EXTREME.severity,
          message: OpenDriveErrorCode.ELEVATION_GRADIENT_EXTREME.message(road.id, elev.s, slope * 100),
          range: elev.range ?? road.range,
        });
      }
    }

    // 3b. Speed Limit Check (M7811)
    if (road.speedLimits) {
      for (const sl of road.speedLimits) {
        if (sl.max <= 0) {
          diagnostics.push({
            code: OpenDriveErrorCode.INVALID_SPEED_LIMIT.code,
            severity: OpenDriveErrorCode.INVALID_SPEED_LIMIT.severity,
            message: OpenDriveErrorCode.INVALID_SPEED_LIMIT.message(road.id, sl.max),
            range: sl.range,
          });
        }
      }
    }

    // 4. Lane Sections, Center Lane & Width Checks (M7808, M7806, M7802, M7809)
    const sections = road.lanes.laneSections;
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      if (!sec) continue;

      // Center lane check
      if (!sec.centerLane || sec.centerLane.id !== 0) {
        diagnostics.push({
          code: OpenDriveErrorCode.MISSING_CENTER_LANE.code,
          severity: OpenDriveErrorCode.MISSING_CENTER_LANE.severity,
          message: OpenDriveErrorCode.MISSING_CENTER_LANE.message(road.id, sec.s),
          range: sec.range,
        });
      }

      const allLanes = [...sec.leftLanes, ...sec.rightLanes];

      // Lane width check
      for (const lane of allLanes) {
        if (lane.type === "driving") {
          for (const w of lane.widthRecords) {
            if (w.a <= 0.0) {
              diagnostics.push({
                code: OpenDriveErrorCode.NEGATIVE_LANE_WIDTH.code,
                severity: OpenDriveErrorCode.NEGATIVE_LANE_WIDTH.severity,
                message: OpenDriveErrorCode.NEGATIVE_LANE_WIDTH.message(road.id, lane.id, w.sOffset),
                range: lane.range,
              });
            }
          }
        }
      }

      // Lane linking check across adjacent sections (M7802, M7809)
      if (si < sections.length - 1) {
        const nextSec = sections[si + 1];
        if (!nextSec) continue;
        const nextLanesById = new Map<number, (typeof allLanes)[number]>();
        if (nextSec.centerLane) nextLanesById.set(nextSec.centerLane.id, nextSec.centerLane);
        for (const l of nextSec.leftLanes) nextLanesById.set(l.id, l);
        for (const l of nextSec.rightLanes) nextLanesById.set(l.id, l);

        for (const lane of allLanes) {
          if (lane.link?.successor !== undefined) {
            const targetLane = nextLanesById.get(lane.link.successor);
            if (!targetLane) {
              diagnostics.push({
                code: OpenDriveErrorCode.UNLINKED_LANE_BOUNDARY.code,
                severity: OpenDriveErrorCode.UNLINKED_LANE_BOUNDARY.severity,
                message: OpenDriveErrorCode.UNLINKED_LANE_BOUNDARY.message(
                  road.id,
                  lane.id,
                  "successor",
                  lane.link.successor,
                ),
                range: lane.range,
              });
            } else if (
              (targetLane.link?.predecessor !== undefined && targetLane.link.predecessor !== lane.id) ||
              Math.sign(lane.id) !== Math.sign(lane.link.successor)
            ) {
              diagnostics.push({
                code: OpenDriveErrorCode.DISCONTINUOUS_LANE_LINK.code,
                severity: OpenDriveErrorCode.DISCONTINUOUS_LANE_LINK.severity,
                message: OpenDriveErrorCode.DISCONTINUOUS_LANE_LINK.message(lane.id, si, si + 1),
                range: lane.range,
              });
            }
          }
        }
      }
    }
  }

  // 5. Junction Overlapping Connections Check (M7804)
  for (const junc of doc.junctions) {
    const seenPairs = new Set<string>();
    for (const conn of junc.connections) {
      const pairKey = `${conn.incomingRoad}->${conn.connectingRoad}`;
      if (seenPairs.has(pairKey)) {
        diagnostics.push({
          code: OpenDriveErrorCode.OVERLAPPING_JUNCTION_PATHS.code,
          severity: OpenDriveErrorCode.OVERLAPPING_JUNCTION_PATHS.severity,
          message: OpenDriveErrorCode.OVERLAPPING_JUNCTION_PATHS.message(
            junc.id,
            conn.incomingRoad,
            conn.connectingRoad,
          ),
          range: junc.range,
        });
      } else {
        seenPairs.add(pairKey);
      }
    }
  }

  return diagnostics;
}
