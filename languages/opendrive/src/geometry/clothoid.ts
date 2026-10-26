// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Analytical Fresnel Integral Clothoid & Spatial Geometry Kernel.
 *
 * Implements high-precision numerical evaluation of Euler spirals (clothoids),
 * circular arcs, cubic polynomials, elevation profiles, and 3D road trajectories.
 */

import type {
  OpenDriveElevationRecord,
  OpenDriveGeometry,
  OpenDriveRoad,
  OpenDriveSuperelevationRecord,
  TrackPoint3D,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Gauss-Legendre Quadrature Weights & Abscissae (16-point)
// ─────────────────────────────────────────────────────────────────────────────

const GL16_X = [
  0.0483076384160383, 0.1444719615827965, 0.2392873622521371, 0.3318686022821877, 0.4213512761306353,
  0.5068999089322294, 0.5877157572407623, 0.6630442669302152, 0.7321821187402897, 0.7944837959679424,
  0.8493676110372199, 0.8963211557660521, 0.9349060759377397, 0.9647622555875064, 0.9856115115452683,
  0.9972638618494816,
];

const GL16_W = [
  0.0964608656181412, 0.0956387200792749, 0.0939999710777595, 0.0915609440624059, 0.0883391784964648,
  0.0843657936357903, 0.0796836109968817, 0.0743403212776814, 0.0683944322434544, 0.0619077180486047,
  0.0549467125039912, 0.0475850989977884, 0.0399009848560514, 0.0319736166393529, 0.023886477386997, 0.0157297059050608,
];

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
      const k0 = geom.curvStart;
      const k1 = geom.curvEnd;
      const L = geom.length;
      const kDot = L > 1e-9 ? (k1 - k0) / L : 0.0;
      const curvature = k0 + kDot * sClamped;
      const hdg = geom.hdg + k0 * sClamped + 0.5 * kDot * sClamped * sClamped;

      // Integrate x(s), y(s) using 16-point Gauss-Legendre quadrature
      let sumCos = 0.0;
      let sumSin = 0.0;
      const halfS = 0.5 * sClamped;

      for (let i = 0; i < 16; i++) {
        // Map [-1, 1] to [0, sClamped]: tau = halfS * (x + 1)
        const tau1 = halfS * (1.0 + GL16_X[i]!);
        const tau2 = halfS * (1.0 - GL16_X[i]!);
        const theta1 = geom.hdg + k0 * tau1 + 0.5 * kDot * tau1 * tau1;
        const theta2 = geom.hdg + k0 * tau2 + 0.5 * kDot * tau2 * tau2;
        const w = GL16_W[i]!;

        sumCos += w * (Math.cos(theta1) + Math.cos(theta2));
        sumSin += w * (Math.sin(theta1) + Math.sin(theta2));
      }

      const x = geom.x + halfS * sumCos;
      const y = geom.y + halfS * sumSin;

      return {
        x,
        y,
        hdg: normalizeAngle(hdg),
        curvature,
      };
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
  if (records.length === 0) {
    return { z: 0.0, slope: 0.0, pitch: 0.0 };
  }

  // Find applicable record with largest start s <= target s
  let rec = records[0]!;
  for (let i = 1; i < records.length; i++) {
    if (records[i]!.s <= s) {
      rec = records[i]!;
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
  if (records.length === 0) return 0.0;

  let rec = records[0]!;
  for (let i = 1; i < records.length; i++) {
    if (records[i]!.s <= s) {
      rec = records[i]!;
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

function findGeometryAt(geometries: OpenDriveGeometry[], s: number): OpenDriveGeometry | undefined {
  if (geometries.length === 0) return undefined;
  for (let i = geometries.length - 1; i >= 0; i--) {
    if (s >= geometries[i]!.s - 1e-9) {
      return geometries[i]!;
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
