// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Analytical Fresnel Integral Clothoid & Spatial Geometry Kernel.
 *
 * Implements high-precision numerical evaluation of Euler spirals (clothoids),
 * circular arcs, cubic polynomials, elevation profiles, and 3D road trajectories.
 */

import type {
  OpenDriveDocument,
  OpenDriveElevationRecord,
  OpenDriveGeometry,
  OpenDriveLaneSection,
  OpenDriveRoad,
  OpenDriveSuperelevationRecord,
  TrackPoint3D,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Gauss-Legendre Quadrature Weights & Abscissae (8-point and 16-point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Positive half-interval abscissae for 8-point Gauss-Legendre quadrature on [-1, 1].
 * Paired symmetrically as +/- GL8_X[i] with weights GL8_W[i] (4 symmetric pairs = 8 nodes).
 */
export const GL8_X = new Float64Array([0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363]);

export const GL8_W = new Float64Array([0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763]);

/**
 * 8-point Gauss-Legendre quadrature for Fresnel integrals / Euler spirals (clothoid):
 *   x(s) = x0 + int_0^s cos(hdg0 + k0*u + 0.5*kDot*u^2) du
 *   y(s) = y0 + int_0^s sin(hdg0 + k0*u + 0.5*kDot*u^2) du
 */
export function integrateClothoidGL8(
  x0: number,
  y0: number,
  hdg0: number,
  k0: number,
  kDot: number,
  s: number,
): [number, number] {
  let sumCos = 0.0;
  let sumSin = 0.0;
  const halfS = 0.5 * s;

  for (let i = 0; i < 4; i++) {
    const xi = GL8_X[i] ?? 0;
    const wi = GL8_W[i] ?? 0;
    const tau1 = halfS * (1.0 + xi);
    const tau2 = halfS * (1.0 - xi);
    const theta1 = hdg0 + (k0 + 0.5 * kDot * tau1) * tau1;
    const theta2 = hdg0 + (k0 + 0.5 * kDot * tau2) * tau2;

    sumCos += wi * (Math.cos(theta1) + Math.cos(theta2));
    sumSin += wi * (Math.sin(theta1) + Math.sin(theta2));
  }

  return [x0 + halfS * sumCos, y0 + halfS * sumSin];
}

export const GL16_X = new Float64Array([
  0.0483076656877383, 0.1444719615827965, 0.2392873622521371, 0.3318686022821276, 0.4213512761306353,
  0.5068999089322294, 0.5877157572407623, 0.6630442669302152, 0.7321821187402897, 0.7944837959679424, 0.84936761373257,
  0.8963211557660521, 0.9349060759377397, 0.9647622555875064, 0.9856115115452684, 0.9972638618494816,
]);

export const GL16_W = new Float64Array([
  0.0965400885147278, 0.0956387200792749, 0.0938443990808046, 0.0911738786957639, 0.0876520930044038,
  0.0833119242269467, 0.0781938957870703, 0.0723457941088485, 0.0658222227763618, 0.0586840934785355,
  0.0509980592623762, 0.0428358980222267, 0.0342738629130214, 0.0253920653092621, 0.0162743947309057,
  0.0070186100094701,
]);

/**
 * 16-point Gauss-Legendre quadrature for Fresnel integrals / Euler spirals (clothoid).
 * Evaluates exact (x, y) coordinates with unrolled trigonometric evaluations.
 */
export function integrateClothoidGL16(
  x0: number,
  y0: number,
  hdg0: number,
  k0: number,
  kDot: number,
  s: number,
): [number, number] {
  let sumCos = 0.0;
  let sumSin = 0.0;
  const halfS = 0.5 * s;

  for (let i = 0; i < 16; i++) {
    const xi = GL16_X[i] ?? 0;
    const wi = GL16_W[i] ?? 0;
    const tau1 = halfS * (1.0 + xi);
    const tau2 = halfS * (1.0 - xi);
    const theta1 = hdg0 + (k0 + 0.5 * kDot * tau1) * tau1;
    const theta2 = hdg0 + (k0 + 0.5 * kDot * tau2) * tau2;

    sumCos += wi * (Math.cos(theta1) + Math.cos(theta2));
    sumSin += wi * (Math.sin(theta1) + Math.sin(theta2));
  }

  return [x0 + halfS * sumCos, y0 + halfS * sumSin];
}

/**
 * Evaluates exact state (x, y, heading, curvature) along an Euler spiral (clothoid).
 */
export function evaluateClothoid(
  x0: number,
  y0: number,
  hdg0: number,
  k0: number,
  k1: number,
  length: number,
  s: number,
): { x: number; y: number; hdg: number; curvature: number } {
  const sClamped = Math.max(0, Math.min(length, s));
  const kDot = length > 1e-9 ? (k1 - k0) / length : 0.0;
  const curvature = k0 + kDot * sClamped;
  const hdg = hdg0 + (k0 + 0.5 * kDot * sClamped) * sClamped;
  const [x, y] = integrateClothoidGL16(x0, y0, hdg0, k0, kDot, sClamped);
  return { x, y, hdg: normalizeAngle(hdg), curvature };
}

/**
 * Evaluates an Euler spiral (clothoid) using 8-point Gauss-Legendre quadrature.
 */
export function evaluateSpiral(
  x0: number,
  y0: number,
  hdg0: number,
  k0: number,
  k1: number,
  length: number,
  s: number,
): { x: number; y: number; hdg: number; curvature: number } {
  const sClamped = Math.max(0, Math.min(length, s));
  const kDot = length > 1e-9 ? (k1 - k0) / length : 0.0;
  const curvature = k0 + kDot * sClamped;
  const hdg = hdg0 + (k0 + 0.5 * kDot * sClamped) * sClamped;
  const [x, y] = integrateClothoidGL8(x0, y0, hdg0, k0, kDot, sClamped);
  return { x, y, hdg: normalizeAngle(hdg), curvature };
}

/**
 * Evaluates the (x, y, heading, curvature) along an OpenDRIVE geometry element at relative distance ds.
 */
export function evaluateGeometry(
  geom: OpenDriveGeometry,
  ds: number,
): { x: number; y: number; hdg: number; curvature: number } {
  const sClamped = Math.max(0, Math.min(geom.length, ds));

  switch (geom.type) {
    case "line": {
      const x = geom.x + sClamped * Math.cos(geom.hdg);
      const y = geom.y + sClamped * Math.sin(geom.hdg);
      return { x, y, hdg: geom.hdg, curvature: 0.0 };
    }

    case "arc": {
      const k = geom.curvature;
      if (Math.abs(k) < 1e-9) {
        const x = geom.x + sClamped * Math.cos(geom.hdg);
        const y = geom.y + sClamped * Math.sin(geom.hdg);
        return { x, y, hdg: geom.hdg, curvature: 0.0 };
      }
      const r = 1.0 / k;
      const hdg = geom.hdg + k * sClamped;
      const dx = r * (Math.sin(hdg) - Math.sin(geom.hdg));
      const dy = -r * (Math.cos(hdg) - Math.cos(geom.hdg));
      return {
        x: geom.x + dx,
        y: geom.y + dy,
        hdg: normalizeAngle(hdg),
        curvature: k,
      };
    }

    case "spiral": {
      return evaluateClothoid(geom.x, geom.y, geom.hdg, geom.curvStart, geom.curvEnd, geom.length, sClamped);
    }

    case "poly3": {
      const u = sClamped;
      const v = geom.a + geom.b * u + geom.c * u * u + geom.d * u * u * u;
      const dv_du = geom.b + 2 * geom.c * u + 3 * geom.d * u * u;
      const d2v_du2 = 2 * geom.c + 6 * geom.d * u;
      const localHdg = Math.atan(dv_du);
      const curvature = d2v_du2 / Math.pow(1 + dv_du * dv_du, 1.5);

      const cosH = Math.cos(geom.hdg);
      const sinH = Math.sin(geom.hdg);
      const x = geom.x + u * cosH - v * sinH;
      const y = geom.y + u * sinH + v * cosH;
      return {
        x,
        y,
        hdg: normalizeAngle(geom.hdg + localHdg),
        curvature,
      };
    }

    case "paramPoly3": {
      const p = geom.pRange === "normalized" && geom.length > 0 ? sClamped / geom.length : sClamped;
      const u = geom.aU + geom.bU * p + geom.cU * p * p + geom.dU * p * p * p;
      const v = geom.aV + geom.bV * p + geom.cV * p * p + geom.dV * p * p * p;
      const du = geom.bU + 2 * geom.cU * p + 3 * geom.dU * p * p;
      const dv = geom.bV + 2 * geom.cV * p + 3 * geom.dV * p * p;
      const d2u = 2 * geom.cU + 6 * geom.dU * p;
      const d2v = 2 * geom.cV + 6 * geom.dV * p;
      const localHdg = Math.atan2(dv, du);
      const curvature = (du * d2v - dv * d2u) / Math.pow(du * du + dv * dv, 1.5);

      const cosH = Math.cos(geom.hdg);
      const sinH = Math.sin(geom.hdg);
      const x = geom.x + u * cosH - v * sinH;
      const y = geom.y + u * sinH + v * cosH;
      return {
        x,
        y,
        hdg: normalizeAngle(geom.hdg + localHdg),
        curvature,
      };
    }
  }
}

/**
 * Evaluates polynomial elevation record z(s) and pitch angle.
 */
export function evaluateElevation(
  records: OpenDriveElevationRecord[],
  s: number,
): { z: number; slope: number; pitch: number } {
  const firstRec = records[0];
  if (!firstRec) {
    return { z: 0.0, slope: 0.0, pitch: 0.0 };
  }

  // Find applicable record with largest start s <= target s
  let rec = firstRec;
  for (let i = 1; i < records.length; i++) {
    const candidate = records[i];
    if (candidate && candidate.s <= s) {
      rec = candidate;
    } else {
      break;
    }
  }

  const ds = s - rec.s;
  const z = rec.a + rec.b * ds + rec.c * ds * ds + rec.d * ds * ds * ds;
  const slope = rec.b + 2 * rec.c * ds + 3 * rec.d * ds * ds;
  const pitch = Math.atan(slope);

  return { z, slope, pitch };
}

/**
 * Evaluates superelevation (cross-fall banking angle).
 */
export function evaluateSuperelevation(records: OpenDriveSuperelevationRecord[], s: number): number {
  const firstRec = records[0];
  if (!firstRec) return 0.0;

  let rec = firstRec;
  for (let i = 1; i < records.length; i++) {
    const candidate = records[i];
    if (candidate && candidate.s <= s) {
      rec = candidate;
    } else {
      break;
    }
  }

  const ds = s - rec.s;
  return rec.a + rec.b * ds + rec.c * ds * ds + rec.d * ds * ds * ds;
}

/**
 * Generates a discrete 3D spatial track trajectory along the entire road reference line.
 */
export function sampleRoadTrack(road: OpenDriveRoad, step = 1.0): TrackPoint3D[] {
  const points: TrackPoint3D[] = [];
  const maxS = road.length;

  for (let s = 0.0; s <= maxS + 1e-6; s += step) {
    const sEval = Math.min(s, maxS);
    const geom = findGeometryAt(road.planView, sEval);

    if (geom) {
      const ds = sEval - geom.s;
      const { x, y, hdg, curvature } = evaluateGeometry(geom, ds);
      const { z, pitch } = evaluateElevation(road.elevationProfile, sEval);
      const roll = evaluateSuperelevation(road.lateralProfile, sEval);

      points.push({
        s: sEval,
        x,
        y,
        z,
        hdg,
        curvature,
        roll,
        pitch,
      });
    }

    if (s >= maxS) break;
  }

  return points;
}

/**
 * Samples the 3D road trajectory into a contiguous Float64Array buffer with zero heap allocations.
 * Each point stores 8 consecutive float64 values: [s, x, y, z, hdg, curvature, roll, pitch].
 */
export function sampleRoadTrackFlat(road: OpenDriveRoad, step = 1.0, outBuffer?: Float64Array): Float64Array {
  const maxS = road.length;
  const numPoints = Math.max(1, Math.floor(maxS / Math.max(1e-4, step)) + 2);
  const neededLength = numPoints * 8;
  const buf = outBuffer && outBuffer.length >= neededLength ? outBuffer : new Float64Array(neededLength);

  let pointIdx = 0;
  for (let s = 0.0; s <= maxS + 1e-6; s += step) {
    const sEval = Math.min(s, maxS);
    const geom = findGeometryAt(road.planView, sEval);

    if (geom) {
      const ds = sEval - geom.s;
      const { x, y, hdg, curvature } = evaluateGeometry(geom, ds);
      const { z, pitch } = evaluateElevation(road.elevationProfile, sEval);
      const roll = evaluateSuperelevation(road.lateralProfile, sEval);

      const offset = pointIdx * 8;
      buf[offset + 0] = sEval;
      buf[offset + 1] = x;
      buf[offset + 2] = y;
      buf[offset + 3] = z;
      buf[offset + 4] = hdg;
      buf[offset + 5] = curvature;
      buf[offset + 6] = roll;
      buf[offset + 7] = pitch;
      pointIdx++;
    }

    if (s >= maxS) break;
  }

  return buf.subarray(0, pointIdx * 8);
}

function findGeometryAt(geometries: OpenDriveGeometry[], s: number): OpenDriveGeometry | undefined {
  if (geometries.length === 0) return undefined;
  for (let i = geometries.length - 1; i >= 0; i--) {
    const geom = geometries[i];
    if (geom && s >= geom.s - 1e-9) {
      return geom;
    }
  }
  return geometries[0];
}

function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Evaluates exact 3D road pose (x, y, z, hdg, curvature, roll, pitch) at longitudinal
 * station `s` and optional lateral offset `t` (positive to the left of the reference line),
 * accounting for cubic elevation profile z(s) and superelevation roll angle phi(s).
 */
export function sampleRoadPose(road: OpenDriveRoad, s: number, t = 0.0): TrackPoint3D {
  const sClamped = Math.max(0.0, Math.min(road.length, s));
  const geom = findGeometryAt(road.planView, sClamped);
  if (!geom) {
    return { s: sClamped, x: 0, y: 0, z: 0, hdg: 0, curvature: 0, roll: 0, pitch: 0 };
  }
  const ds = sClamped - geom.s;
  const { x: xRef, y: yRef, hdg, curvature } = evaluateGeometry(geom, ds);
  const { z: zRef, pitch } = evaluateElevation(road.elevationProfile, sClamped);
  const roll = evaluateSuperelevation(road.lateralProfile, sClamped);

  if (t === 0.0) {
    return { s: sClamped, x: xRef, y: yRef, z: zRef, hdg, curvature, roll, pitch };
  }

  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const x = xRef - t * cosRoll * Math.sin(hdg);
  const y = yRef + t * cosRoll * Math.cos(hdg);
  const z = zRef + t * sinRoll;

  return { s: sClamped, x, y, z, hdg, curvature, roll, pitch };
}

export interface FrenetCoordinate {
  roadId: string;
  s: number;
  t: number;
  laneId: number;
  z: number;
  hdg: number;
  distance: number;
}

function resolveLaneIdAt(
  sectionsOrContainer: OpenDriveLaneSection[] | { laneSections?: OpenDriveLaneSection[] } | undefined,
  s: number,
  t: number,
): number {
  const sections: OpenDriveLaneSection[] = Array.isArray(sectionsOrContainer)
    ? sectionsOrContainer
    : (sectionsOrContainer?.laneSections ?? []);
  const firstSection = sections[0];
  if (!firstSection || Math.abs(t) < 1e-6) return 0;

  let section = firstSection;
  for (let i = 1; i < sections.length; i++) {
    const cand = sections[i];
    if (cand && cand.s <= s) {
      section = cand;
    } else {
      break;
    }
  }

  const evalLaneWidth = (
    laneObj: {
      widths?: { sOffset: number; a: number; b: number; c: number; d: number }[];
      widthRecords?: { sOffset: number; a: number; b: number; c: number; d: number }[];
    },
    dsSec: number,
  ) => {
    const widths = laneObj.widths ?? laneObj.widthRecords ?? [];
    const firstWidth = widths[0];
    if (!firstWidth) return 3.5;
    let wRec = firstWidth;
    for (let i = 1; i < widths.length; i++) {
      const cand = widths[i];
      if (cand && cand.sOffset <= dsSec) wRec = cand;
      else break;
    }
    const du = Math.max(0, dsSec - wRec.sOffset);
    return Math.max(0, wRec.a + wRec.b * du + wRec.c * du * du + wRec.d * du * du * du);
  };

  const dsSection = Math.max(0, s - section.s);
  if (t > 0) {
    // Left lanes have positive IDs sorted 1, 2, 3... outward from center
    const leftSorted = [...(section.leftLanes ?? [])].sort((a, b) => a.id - b.id);
    let accum = 0.0;
    for (const lane of leftSorted) {
      accum += evalLaneWidth(lane, dsSection);
      if (t <= accum) return lane.id;
    }
    return leftSorted[leftSorted.length - 1]?.id ?? 1;
  } else {
    // Right lanes have negative IDs sorted -1, -2, -3... outward from center
    const rightSorted = [...(section.rightLanes ?? [])].sort((a, b) => b.id - a.id);
    let accum = 0.0;
    const absT = -t;
    for (const lane of rightSorted) {
      accum += evalLaneWidth(lane, dsSection);
      if (absT <= accum) return lane.id;
    }
    return rightSorted[rightSorted.length - 1]?.id ?? -1;
  }
}

/**
 * Projects a world Cartesian coordinate (x, y) onto an OpenDRIVE road or road network
 * to recover curvilinear Frenet coordinates (roadId, s, t, laneId, z, hdg, distance)
 * using coarse multi-seed sampling followed by damped Newton-Raphson closest-point iteration.
 */
export function worldToFrenet(
  network: OpenDriveDocument | OpenDriveRoad | OpenDriveRoad[],
  x: number,
  y: number,
): FrenetCoordinate {
  const roads: OpenDriveRoad[] = Array.isArray(network) ? network : "roads" in network ? network.roads : [network];

  let bestResult: FrenetCoordinate = {
    roadId: roads[0]?.id ?? "0",
    s: 0,
    t: 0,
    laneId: 0,
    z: 0,
    hdg: 0,
    distance: Number.POSITIVE_INFINITY,
  };

  for (const road of roads) {
    const L = Math.max(0, road.length);
    if (L <= 0 || road.planView.length === 0) continue;

    // 1. Coarse search along the road reference line
    const numSamples = Math.max(32, Math.min(500, Math.ceil(L / 1.0)));
    let bestS = 0.0;
    let minDistSq = Number.POSITIVE_INFINITY;

    for (let i = 0; i <= numSamples; i++) {
      const sCand = (i / numSamples) * L;
      const pose = sampleRoadPose(road, sCand, 0.0);
      const dx = x - pose.x;
      const dy = y - pose.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minDistSq) {
        minDistSq = d2;
        bestS = sCand;
      }
    }

    // 2. Newton-Raphson refinement on f(s) = (x(s) - x) * cos(hdg(s)) + (y(s) - y) * sin(hdg(s)) = 0
    let s = bestS;
    for (let iter = 0; iter < 15; iter++) {
      const pose = sampleRoadPose(road, s, 0.0);
      const cosH = Math.cos(pose.hdg);
      const sinH = Math.sin(pose.hdg);
      const dx = pose.x - x;
      const dy = pose.y - y;

      // Signed lateral offset t (positive to left of reference line)
      const tCur = -(x - pose.x) * sinH + (y - pose.y) * cosH;
      // Derivative of 0.5 * dist^2 with respect to s
      const f = dx * cosH + dy * sinH;
      if (Math.abs(f) < 1e-12) break;

      // Second derivative f'(s) = 1 - curvature * t
      const df = Math.max(1e-4, 1.0 - pose.curvature * tCur);
      const step = f / df;
      const sNext = Math.max(0.0, Math.min(L, s - step));
      if (Math.abs(sNext - s) < 1e-10) {
        s = sNext;
        break;
      }
      s = sNext;
    }

    const finalPose = sampleRoadPose(road, s, 0.0);
    const cosH = Math.cos(finalPose.hdg);
    const sinH = Math.sin(finalPose.hdg);
    const t = -(x - finalPose.x) * sinH + (y - finalPose.y) * cosH;
    const dist = Math.hypot(x - finalPose.x, y - finalPose.y);

    if (dist < bestResult.distance) {
      const laneId = resolveLaneIdAt(road.lanes, s, t);
      const poseAtT = sampleRoadPose(road, s, t);
      bestResult = {
        roadId: road.id,
        s,
        t,
        laneId,
        z: poseAtT.z,
        hdg: finalPose.hdg,
        distance: dist,
      };
    }
  }

  return bestResult;
}
