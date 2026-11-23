// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for @modelscript/nmea0183.
 *
 * Lowers 2D/3D vehicle trajectory kinematics from decoded NMEA 0183 GNSS tracks
 * directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory representation
 * without allocating intermediate AST wrapper objects.
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInNmea0183LibraryRegistered } from "../catalog/library-package-adapter.js";
import { parseNmea0183 } from "../parser/index.js";
import { solveNmeaTrack } from "../solver/index.js";
import type { Nmea0183Document, NmeaTrackSolution } from "../types.js";

export interface NmeaDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  track: NmeaTrackSolution;
}

/**
 * Lowers 3D local ENU vehicle trajectory kinematics and marine sensor parameters
 * directly into an `IDaeBuilder` arena.
 *
 * Continuous states lowered:
 * - `pos_e`, `pos_n`, `pos_u` (local ENU meters)
 * - `vel_e`, `vel_n`, `vel_u` (ENU velocity components, m/s)
 * - `s_dist` (cumulative geodesic arc length, m)
 *
 * Differential & algebraic equations lowered:
 * - `der(pos_e) = vel_e`
 * - `der(pos_n) = vel_n`
 * - `der(pos_u) = vel_u`
 * - `der(s_dist) = speed_mps`
 * - `der(vel_e) = accel_e`
 * - `der(vel_n) = accel_n`
 * - `der(vel_u) = accel_u`
 * - `speed_sq = vel_e * vel_e + vel_n * vel_n + vel_u * vel_u`
 */
export function lowerNmea0183ToDae(
  builder: IDaeBuilder,
  docOrSource: Nmea0183Document | string,
): NmeaDaeLoweringResult {
  ensureBuiltInNmea0183LibraryRegistered();
  const doc = typeof docOrSource === "string" ? parseNmea0183(docOrSource) : docOrSource;
  const track = solveNmeaTrack(doc);

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
    causality: Causality = Causality.Local,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const lookedUp = builder.lookupVariable(name);
    if (lookedUp !== -1) {
      variableMap.set(name, lookedUp);
      return lookedUp;
    }
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Initial kinematics from solved track
  const first = track.epochs[0];
  const last = track.epochs[track.epochs.length - 1];

  const initE = first?.enu.e ?? 0;
  const initN = first?.enu.n ?? 0;
  const initU = first?.enu.u ?? 0;

  const meanSpeed = track.meanSpeedMps;
  const meanCourseRad = ((track.meanCourseDeg ?? 0) * Math.PI) / 180;

  // Estimate initial ENU velocity from first segment or mean course/speed
  let v0E = meanSpeed * Math.sin(meanCourseRad);
  let v0N = meanSpeed * Math.cos(meanCourseRad);
  let v0U = 0;
  let aE = 0;
  let aN = 0;
  let aU = 0;

  if (track.epochs.length >= 2 && first && last) {
    const second = track.epochs[1]!;
    const dt1 =
      first.utcSeconds !== undefined && second.utcSeconds !== undefined && second.utcSeconds > first.utcSeconds
        ? second.utcSeconds - first.utcSeconds
        : 1.0;
    v0E = (second.enu.e - first.enu.e) / dt1;
    v0N = (second.enu.n - first.enu.n) / dt1;
    v0U = (second.enu.u - first.enu.u) / dt1;

    if (track.epochs.length >= 3 && track.durationSec > 0) {
      const prevLast = track.epochs[track.epochs.length - 2]!;
      const dtN =
        prevLast.utcSeconds !== undefined && last.utcSeconds !== undefined && last.utcSeconds > prevLast.utcSeconds
          ? last.utcSeconds - prevLast.utcSeconds
          : 1.0;
      const vEndE = (last.enu.e - prevLast.enu.e) / dtN;
      const vEndN = (last.enu.n - prevLast.enu.n) / dtN;
      const vEndU = (last.enu.u - prevLast.enu.u) / dtN;
      aE = (vEndE - v0E) / track.durationSec;
      aN = (vEndN - v0N) / track.durationSec;
      aU = (vEndU - v0U) / track.durationSec;
    }
  }

  // Reference origin parameters
  addVar("origin_lat_deg", Variability.Parameter, track.origin?.latDeg ?? 0);
  addVar("origin_lon_deg", Variability.Parameter, track.origin?.lonDeg ?? 0);
  addVar("origin_alt_m", Variability.Parameter, track.origin?.altM ?? 0);

  // Mean acceleration parameters
  const accelEVar = addVar("accel_e", Variability.Parameter, aE);
  const accelNVar = addVar("accel_n", Variability.Parameter, aN);
  const accelUVar = addVar("accel_u", Variability.Parameter, aU);
  const speedParamVar = addVar("speed_mps", Variability.Parameter, meanSpeed);

  // Continuous 3D ENU position & velocity states + arc-length state
  const posE = addVar("pos_e", Variability.Continuous, initE);
  const posN = addVar("pos_n", Variability.Continuous, initN);
  const posU = addVar("pos_u", Variability.Continuous, initU);
  const velE = addVar("vel_e", Variability.Continuous, v0E);
  const velN = addVar("vel_n", Variability.Continuous, v0N);
  const velU = addVar("vel_u", Variability.Continuous, v0U);
  const sDist = addVar("s_dist", Variability.Continuous, 0.0);
  const speedSq = addVar("speed_sq", Variability.Continuous, v0E * v0E + v0N * v0N + v0U * v0U);

  stateVarIndices.push(posE, posN, posU, velE, velN, velU, sDist);

  // der(pos_e) = vel_e
  builder.addEquation(EqKind.Simple, builder.addDer(posE), builder.addName(velE));
  equationCount++;

  // der(pos_n) = vel_n
  builder.addEquation(EqKind.Simple, builder.addDer(posN), builder.addName(velN));
  equationCount++;

  // der(pos_u) = vel_u
  builder.addEquation(EqKind.Simple, builder.addDer(posU), builder.addName(velU));
  equationCount++;

  // der(s_dist) = speed_mps
  builder.addEquation(EqKind.Simple, builder.addDer(sDist), builder.addName(speedParamVar));
  equationCount++;

  // der(vel_e) = accel_e
  builder.addEquation(EqKind.Simple, builder.addDer(velE), builder.addName(accelEVar));
  equationCount++;

  // der(vel_n) = accel_n
  builder.addEquation(EqKind.Simple, builder.addDer(velN), builder.addName(accelNVar));
  equationCount++;

  // der(vel_u) = accel_u
  builder.addEquation(EqKind.Simple, builder.addDer(velU), builder.addName(accelUVar));
  equationCount++;

  // speed_sq = vel_e * vel_e + vel_n * vel_n + vel_u * vel_u
  const ve2 = builder.addBinaryExpr(BinOp.Mul, builder.addName(velE), builder.addName(velE));
  const vn2 = builder.addBinaryExpr(BinOp.Mul, builder.addName(velN), builder.addName(velN));
  const vu2 = builder.addBinaryExpr(BinOp.Mul, builder.addName(velU), builder.addName(velU));
  const sumHoriz = builder.addBinaryExpr(BinOp.Add, ve2, vn2);
  const sum3d = builder.addBinaryExpr(BinOp.Add, sumHoriz, vu2);
  builder.addEquation(EqKind.Simple, builder.addName(speedSq), sum3d);
  equationCount++;

  // Optional marine sensor telemetry parameters (HDG / DBT / MWV)
  if (track.latestHeadingDeg !== undefined) {
    addVar("heading_mag_deg", Variability.Parameter, track.latestHeadingDeg);
  }
  if (track.latestDepthM !== undefined) {
    addVar("depth_below_transducer_m", Variability.Parameter, track.latestDepthM);
  }
  if (track.latestWindSpeed !== undefined) {
    addVar("wind_speed", Variability.Parameter, track.latestWindSpeed);
  }
  if (track.latestWindAngleDeg !== undefined) {
    addVar("wind_angle_deg", Variability.Parameter, track.latestWindAngleDeg);
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
    track,
  };
}

/**
 * High-level helper that creates a fresh `DAEBuilder` arena and lowers an NMEA 0183 track into it.
 */
export function nmea0183ToDae(docOrSource: Nmea0183Document | string): {
  builder: DAEBuilder;
  result: NmeaDaeLoweringResult;
} {
  const builder = new DAEBuilder();
  const result = lowerNmea0183ToDae(builder, docOrSource);
  return { builder, result };
}
