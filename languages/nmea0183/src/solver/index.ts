// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WGS-84 Geodesic Solver, ECEF/ENU Coordinate Transforms, and Track Kinematics
 * for @modelscript/nmea0183.
 */

import { parseNmea0183 } from "../parser/index.js";
import type {
  EcefCoord,
  EnuCoord,
  GeodeticCoord,
  Nmea0183Document,
  NmeaTrackEpoch,
  NmeaTrackSolution,
  VincentyResult,
} from "../types.js";

/** WGS-84 semi-major axis (meters). */
export const WGS84_A = 6378137.0;
/** WGS-84 flattening. */
export const WGS84_F = 1 / 298.257223563;
/** WGS-84 semi-minor axis (meters). */
export const WGS84_B = WGS84_A * (1 - WGS84_F);
/** WGS-84 first eccentricity squared. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** WGS-84 mean Earth radius (meters, IUGG R1). */
export const WGS84_MEAN_RADIUS_M = 6371008.7714;
/** Conversion factor from knots to meters per second. */
export const KNOTS_TO_MPS = 0.5144444444444445;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Normalizes an angle in degrees to `[0, 360)`.
 */
export function normalizeBearingDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Computes spherical great-circle distance in meters using the Haversine formula
 * on the WGS-84 mean radius sphere.
 */
export function haversineDistance(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): number {
  const phi1 = lat1Deg * DEG2RAD;
  const phi2 = lat2Deg * DEG2RAD;
  const dPhi = (lat2Deg - lat1Deg) * DEG2RAD;
  const dLam = (lon2Deg - lon1Deg) * DEG2RAD;

  const sinDPhi = Math.sin(dPhi * 0.5);
  const sinDLam = Math.sin(dLam * 0.5);
  const a = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLam * sinDLam;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return WGS84_MEAN_RADIUS_M * c;
}

/**
 * Computes initial great-circle forward azimuth (bearing) in degrees `[0, 360)` from point 1 to point 2.
 */
export function initialBearing(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): number {
  const phi1 = lat1Deg * DEG2RAD;
  const phi2 = lat2Deg * DEG2RAD;
  const dLam = (lon2Deg - lon1Deg) * DEG2RAD;

  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return normalizeBearingDeg(Math.atan2(y, x) * RAD2DEG);
}

/**
 * Solves the WGS-84 ellipsoidal inverse geodesic problem via Thaddeus Vincenty's
 * iterative algorithm (sub-millimeter accuracy for non-antipodal point pairs).
 */
export function vincentyInverse(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
  maxIterations: number = 200,
): VincentyResult {
  if (Math.abs(lat1Deg - lat2Deg) < 1e-13 && Math.abs(lon1Deg - lon2Deg) < 1e-13) {
    return { distanceM: 0, initialBearingDeg: 0, finalBearingDeg: 0, converged: true, iterations: 0 };
  }

  const phi1 = lat1Deg * DEG2RAD;
  const phi2 = lat2Deg * DEG2RAD;
  const L = (lon2Deg - lon1Deg) * DEG2RAD;

  const U1 = Math.atan((1 - WGS84_F) * Math.tan(phi1));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= maxIterations; iter++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);

    const t1 = cosU2 * sinLambda;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLambda;
    sinSigma = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinSigma === 0) {
      return { distanceM: 0, initialBearingDeg: 0, finalBearingDeg: 0, converged: true, iterations: iter };
    }

    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;

    const C = (WGS84_F / 16) * cos2Alpha * (4 + WGS84_F * (4 - 3 * cos2Alpha));
    const lambdaPrev = lambda;
    lambda =
      L +
      (1 - C) *
        WGS84_F *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

    if (Math.abs(lambda - lambdaPrev) < 1e-12) {
      converged = true;
      break;
    }
  }

  const uSq = (cos2Alpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  const distanceM = WGS84_B * A * (sigma - deltaSigma);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);

  const alpha1 = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
  const alpha2 = Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda);

  return {
    distanceM,
    initialBearingDeg: normalizeBearingDeg(alpha1 * RAD2DEG),
    finalBearingDeg: normalizeBearingDeg(alpha2 * RAD2DEG),
    converged,
    iterations: iter,
  };
}

/**
 * Converts WGS-84 geodetic coordinates `(latDeg, lonDeg, altM)` to Earth-Centered Earth-Fixed (ECEF) meters.
 */
export function geodeticToEcef(latDeg: number, lonDeg: number, altM: number = 0): EcefCoord {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return {
    x: (N + altM) * cosPhi * cosLam,
    y: (N + altM) * cosPhi * sinLam,
    z: (N * (1 - WGS84_E2) + altM) * sinPhi,
  };
}

/**
 * Converts ECEF `(x, y, z)` meters back to WGS-84 geodetic `(latDeg, lonDeg, altM)` using
 * iterative Bowring/Heiskanen-Moritz convergence (`< 1e-12` rad).
 */
export function ecefToGeodetic(x: number, y: number, z: number): GeodeticCoord {
  const lonRad = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);

  if (p < 1e-10) {
    const latDeg = z >= 0 ? 90 : -90;
    const altM = Math.abs(z) - WGS84_B;
    return { latDeg, lonDeg: 0, altM };
  }

  let phi = Math.atan2(z, p * (1 - WGS84_E2));
  let N = WGS84_A;
  let altM = 0;

  for (let i = 0; i < 12; i++) {
    const sinPhi = Math.sin(phi);
    N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    altM = p / Math.cos(phi) - N;
    const nextPhi = Math.atan2(z, p * (1 - WGS84_E2 * (N / (N + altM))));
    if (Math.abs(nextPhi - phi) < 1e-13) {
      phi = nextPhi;
      break;
    }
    phi = nextPhi;
  }

  const sinPhi = Math.sin(phi);
  N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  altM = p / Math.cos(phi) - N;

  return {
    latDeg: phi * RAD2DEG,
    lonDeg: lonRad * RAD2DEG,
    altM,
  };
}

/**
 * Converts an ECEF coordinate `(x, y, z)` to local tangent-plane East-North-Up (ENU) meters
 * relative to a WGS-84 geodetic reference origin.
 */
export function ecefToEnu(
  x: number,
  y: number,
  z: number,
  refLatDeg: number,
  refLonDeg: number,
  refAltM: number = 0,
): EnuCoord {
  const ref = geodeticToEcef(refLatDeg, refLonDeg, refAltM);
  const dx = x - ref.x;
  const dy = y - ref.y;
  const dz = z - ref.z;

  const phi = refLatDeg * DEG2RAD;
  const lam = refLonDeg * DEG2RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  return {
    e: -sinLam * dx + cosLam * dy,
    n: -sinPhi * cosLam * dx - sinPhi * sinLam * dy + cosPhi * dz,
    u: cosPhi * cosLam * dx + cosPhi * sinLam * dy + sinPhi * dz,
  };
}

/**
 * Converts a WGS-84 geodetic coordinate to local tangent-plane ENU meters relative to a reference origin.
 */
export function geodeticToEnu(
  latDeg: number,
  lonDeg: number,
  altM: number,
  refLatDeg: number,
  refLonDeg: number,
  refAltM: number = 0,
): EnuCoord {
  const ecef = geodeticToEcef(latDeg, lonDeg, altM);
  return ecefToEnu(ecef.x, ecef.y, ecef.z, refLatDeg, refLonDeg, refAltM);
}

/**
 * Solves track kinematics (ECEF, local ENU, Vincenty & Haversine distances, segment speeds,
 * headings, altitude bounds, and sensor summaries) for an NMEA 0183 document.
 */
export function solveNmeaTrack(docOrSource: Nmea0183Document | string): NmeaTrackSolution {
  const doc = typeof docOrSource === "string" ? parseNmea0183(docOrSource) : docOrSource;

  // Merge GGA and RMC sentences sharing the same UTC timestamp into unified track epochs
  interface RawFix {
    line: number;
    address: string;
    utcRaw?: string | undefined;
    utcSeconds?: number | undefined;
    dateRaw?: string | undefined;
    latDeg: number;
    lonDeg: number;
    altM: number;
    fixQuality?: number | undefined;
    status?: string | undefined;
    hdop?: number | undefined;
    satellitesUsed?: number | undefined;
    sogKnots?: number | undefined;
    cogDeg?: number | undefined;
  }

  const fixes: RawFix[] = [];
  let latestHeadingDeg: number | undefined;
  let latestDepthM: number | undefined;
  let latestWindSpeed: number | undefined;
  let latestWindAngleDeg: number | undefined;
  let latestAltM = 0;

  for (const s of doc.sentences) {
    const p = s.payload;
    if (p.kind === "HDG" && p.headingMagneticDeg !== undefined) {
      latestHeadingDeg = p.headingMagneticDeg;
    } else if (p.kind === "DBT" && p.depthMeters !== undefined) {
      latestDepthM = p.depthMeters;
    } else if (p.kind === "MWV") {
      if (p.windSpeed !== undefined) latestWindSpeed = p.windSpeed;
      if (p.windAngleDeg !== undefined) latestWindAngleDeg = p.windAngleDeg;
    } else if (p.kind === "GGA") {
      if (p.altitudeM !== undefined) latestAltM = p.altitudeM;
      if (p.latitudeDeg !== undefined && p.longitudeDeg !== undefined && p.fixQuality > 0) {
        const last = fixes[fixes.length - 1];
        if (last && p.utcSeconds !== undefined && last.utcSeconds === p.utcSeconds) {
          // Merge GGA altitude/hdop/satellites into existing RMC epoch
          last.altM = p.altitudeM ?? last.altM;
          last.fixQuality = p.fixQuality;
          last.hdop = p.hdop ?? last.hdop;
          last.satellitesUsed = p.satellitesUsed ?? last.satellitesUsed;
        } else {
          fixes.push({
            line: s.line,
            address: s.address,
            utcRaw: p.utcRaw,
            utcSeconds: p.utcSeconds,
            latDeg: p.latitudeDeg,
            lonDeg: p.longitudeDeg,
            altM: p.altitudeM ?? latestAltM,
            fixQuality: p.fixQuality,
            hdop: p.hdop,
            satellitesUsed: p.satellitesUsed,
          });
        }
      }
    } else if (p.kind === "RMC") {
      if (p.latitudeDeg !== undefined && p.longitudeDeg !== undefined && p.status !== "V") {
        const last = fixes[fixes.length - 1];
        if (last && p.utcSeconds !== undefined && last.utcSeconds === p.utcSeconds) {
          // Merge RMC speed/course/date into existing GGA epoch
          last.status = p.status;
          last.dateRaw = p.dateRaw || last.dateRaw;
          last.sogKnots = p.speedKnots ?? last.sogKnots;
          last.cogDeg = p.courseDeg ?? last.cogDeg;
        } else {
          fixes.push({
            line: s.line,
            address: s.address,
            utcRaw: p.utcRaw,
            utcSeconds: p.utcSeconds,
            dateRaw: p.dateRaw,
            latDeg: p.latitudeDeg,
            lonDeg: p.longitudeDeg,
            altM: latestAltM,
            status: p.status,
            sogKnots: p.speedKnots,
            cogDeg: p.courseDeg,
          });
        }
      }
    }
  }

  if (fixes.length === 0) {
    return {
      epochs: [],
      totalDistanceVincentyM: 0,
      totalDistanceHaversineM: 0,
      durationSec: 0,
      meanSpeedMps: 0,
      maxSpeedMps: 0,
      meanSpeedKnots: 0,
      maxSpeedKnots: 0,
      latestHeadingDeg,
      latestDepthM,
      latestWindSpeed,
      latestWindAngleDeg,
      satelliteCount: doc.satellites.length,
    };
  }

  const origin: GeodeticCoord = {
    latDeg: fixes[0]!.latDeg,
    lonDeg: fixes[0]!.lonDeg,
    altM: fixes[0]!.altM,
  };

  const epochs: NmeaTrackEpoch[] = [];
  let totalDistanceVincentyM = 0;
  let totalDistanceHaversineM = 0;
  let maxSpeedMps = 0;
  let sumSinCourse = 0;
  let sumCosCourse = 0;
  let courseSamples = 0;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  let minAltM = Infinity;
  let maxAltM = -Infinity;

  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i]!;
    const ecef = geodeticToEcef(f.latDeg, f.lonDeg, f.altM);
    const enu = ecefToEnu(ecef.x, ecef.y, ecef.z, origin.latDeg, origin.lonDeg, origin.altM);

    let segmentDistanceM = 0;
    let computedSpeedMps: number | undefined;
    let computedBearingDeg: number | undefined;

    if (i > 0) {
      const prev = fixes[i - 1]!;
      const v = vincentyInverse(prev.latDeg, prev.lonDeg, f.latDeg, f.lonDeg);
      const h = haversineDistance(prev.latDeg, prev.lonDeg, f.latDeg, f.lonDeg);
      segmentDistanceM = v.distanceM;
      totalDistanceVincentyM += v.distanceM;
      totalDistanceHaversineM += h;
      computedBearingDeg = v.initialBearingDeg;

      if (f.utcSeconds !== undefined && prev.utcSeconds !== undefined) {
        let dt = f.utcSeconds - prev.utcSeconds;
        if (dt < -43200) dt += 86400; // midnight rollover
        if (dt > 0) {
          computedSpeedMps = segmentDistanceM / dt;
        }
      }
    }

    const sogMps = f.sogKnots !== undefined ? f.sogKnots * KNOTS_TO_MPS : computedSpeedMps;
    if (sogMps !== undefined && sogMps > maxSpeedMps) {
      maxSpeedMps = sogMps;
    }

    const course = f.cogDeg ?? computedBearingDeg;
    if (course !== undefined) {
      sumSinCourse += Math.sin(course * DEG2RAD);
      sumCosCourse += Math.cos(course * DEG2RAD);
      courseSamples++;
    }

    if (f.latDeg < minLat) minLat = f.latDeg;
    if (f.latDeg > maxLat) maxLat = f.latDeg;
    if (f.lonDeg < minLon) minLon = f.lonDeg;
    if (f.lonDeg > maxLon) maxLon = f.lonDeg;
    if (enu.e < minE) minE = enu.e;
    if (enu.e > maxE) maxE = enu.e;
    if (enu.n < minN) minN = enu.n;
    if (enu.n > maxN) maxN = enu.n;
    if (f.altM < minAltM) minAltM = f.altM;
    if (f.altM > maxAltM) maxAltM = f.altM;

    epochs.push({
      index: i,
      line: f.line,
      sentenceAddress: f.address,
      utcRaw: f.utcRaw,
      utcSeconds: f.utcSeconds,
      dateRaw: f.dateRaw,
      latDeg: f.latDeg,
      lonDeg: f.lonDeg,
      altM: f.altM,
      ecef,
      enu,
      fixQuality: f.fixQuality,
      status: f.status,
      hdop: f.hdop,
      satellitesUsed: f.satellitesUsed,
      sogKnots: f.sogKnots,
      sogMps,
      cogDeg: f.cogDeg,
      segmentDistanceM,
      cumulativeDistanceM: totalDistanceVincentyM,
      computedSpeedMps,
      computedBearingDeg,
    });
  }

  let durationSec = 0;
  const firstUtc = epochs[0]?.utcSeconds;
  const lastUtc = epochs[epochs.length - 1]?.utcSeconds;
  if (firstUtc !== undefined && lastUtc !== undefined) {
    durationSec = lastUtc >= firstUtc ? lastUtc - firstUtc : lastUtc + 86400 - firstUtc;
  }

  const meanSpeedMps = durationSec > 0 ? totalDistanceVincentyM / durationSec : maxSpeedMps;
  const meanCourseDeg =
    courseSamples > 0 ? normalizeBearingDeg(Math.atan2(sumSinCourse, sumCosCourse) * RAD2DEG) : undefined;

  return {
    origin,
    epochs,
    totalDistanceVincentyM,
    totalDistanceHaversineM,
    durationSec,
    meanSpeedMps,
    maxSpeedMps,
    meanSpeedKnots: meanSpeedMps / KNOTS_TO_MPS,
    maxSpeedKnots: maxSpeedMps / KNOTS_TO_MPS,
    meanCourseDeg,
    minAltM,
    maxAltM,
    bounds: {
      minLat,
      maxLat,
      minLon,
      maxLon,
      minE,
      maxE,
      minN,
      maxN,
    },
    latestHeadingDeg,
    latestDepthM,
    latestWindSpeed,
    latestWindAngleDeg,
    satelliteCount: doc.satellites.length,
  };
}
