// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ICD-GPS-200 Broadcast Keplerian Orbit Propagator & Gauss-Newton Weighted
 * Least-Squares 3D Receiver Position / DOP Solver for `@modelscript/rinex`.
 */

import type {
  DopMetrics,
  EcefCoords,
  GeodeticCoords,
  RinexDocument,
  RinexNavEphemeris,
  RinexPositionSolution,
  SatelliteEcefState,
  SatelliteGeometryInfo,
  SatellitePseudorange,
} from "../types.js";

/** WGS-84 Earth's gravitational parameter mu (m^3/s^2), ICD-GPS-200 Table 20-IV. */
export const WGS84_MU = 3.986005e14;

/** WGS-84 Earth rotation rate Omega_e_dot (rad/s), ICD-GPS-200 Table 20-IV. */
export const WGS84_OMEGA_E_DOT = 7.2921151467e-5;

/** Speed of light in vacuum c (m/s). */
export const SPEED_OF_LIGHT = 299792458.0;

/** GPS relativistic clock correction constant F = -2 * sqrt(mu) / c^2 (s / m^(1/2)). */
export const GPS_F_REL = -4.442807633e-10;

/** WGS-84 semi-major axis a (m). */
export const WGS84_A = 6378137.0;

/** WGS-84 flattening f. */
export const WGS84_F = 1.0 / 298.257223563;

/** WGS-84 first eccentricity squared e^2 = 2f - f^2. */
export const WGS84_E2 = 2.0 * WGS84_F - WGS84_F * WGS84_F;

const HALF_WEEK_SEC = 302400.0;
const FULL_WEEK_SEC = 604800.0;
const RAD_TO_DEG = 180.0 / Math.PI;
const DEG_TO_RAD = Math.PI / 180.0;

/**
 * Wraps a GPS time difference into [-302400, +302400] seconds to handle week crossovers.
 */
export function wrapGpsTimeDelta(dt: number): number {
  let t = dt;
  while (t > HALF_WEEK_SEC) t -= FULL_WEEK_SEC;
  while (t < -HALF_WEEK_SEC) t += FULL_WEEK_SEC;
  return t;
}

/**
 * Solves Kepler's equation E - e * sin(E) = M via Newton-Raphson iteration.
 */
export function solveKeplerEquation(meanAnomalyRad: number, eccentricity: number, tol: number = 1e-14): number {
  let E = meanAnomalyRad;
  for (let iter = 0; iter < 30; iter++) {
    const f = E - eccentricity * Math.sin(E) - meanAnomalyRad;
    const fp = 1.0 - eccentricity * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

function evalKeplerPosition(
  ephem: RinexNavEphemeris,
  transmitTimeSec: number,
): {
  pos: EcefCoords;
  semiMajorAxisM: number;
  orbitalRadiusM: number;
  eccentricAnomalyRad: number;
  trueAnomalyRad: number;
} {
  const A = ephem.sqrtA * ephem.sqrtA;
  const n0 = Math.sqrt(WGS84_MU / (A * A * A));
  const tk = wrapGpsTimeDelta(transmitTimeSec - ephem.toe);
  const n = n0 + ephem.deltaN;
  const Mk = ephem.m0 + n * tk;
  const Ek = solveKeplerEquation(Mk, ephem.e);

  const sinE = Math.sin(Ek);
  const cosE = Math.cos(Ek);
  const sqrtOneMinusE2 = Math.sqrt(Math.max(0, 1.0 - ephem.e * ephem.e));
  const nuK = Math.atan2(sqrtOneMinusE2 * sinE, cosE - ephem.e);

  const phiK = nuK + ephem.omega;
  const sin2Phi = Math.sin(2.0 * phiK);
  const cos2Phi = Math.cos(2.0 * phiK);

  const duK = ephem.cus * sin2Phi + ephem.cuc * cos2Phi;
  const drK = ephem.crs * sin2Phi + ephem.crc * cos2Phi;
  const diK = ephem.cis * sin2Phi + ephem.cic * cos2Phi;

  const uK = phiK + duK;
  const rK = A * (1.0 - ephem.e * cosE) + drK;
  const iK = ephem.i0 + diK + ephem.idot * tk;

  const xpK = rK * Math.cos(uK);
  const ypK = rK * Math.sin(uK);

  const omegaK = ephem.omega0 + (ephem.omegaDot - WGS84_OMEGA_E_DOT) * tk - WGS84_OMEGA_E_DOT * ephem.toe;
  const cosO = Math.cos(omegaK);
  const sinO = Math.sin(omegaK);
  const cosI = Math.cos(iK);
  const sinI = Math.sin(iK);

  const x = xpK * cosO - ypK * cosI * sinO;
  const y = xpK * sinO + ypK * cosI * cosO;
  const z = ypK * sinI;

  return {
    pos: { x, y, z },
    semiMajorAxisM: A,
    orbitalRadiusM: rK,
    eccentricAnomalyRad: Ek,
    trueAnomalyRad: nuK,
  };
}

/**
 * Computes GPS satellite ECEF position, velocity, and relativistic clock correction
 * from a RINEX v2 broadcast Keplerian ephemeris per ICD-GPS-200 Table 20-IV.
 */
export function computeSatelliteEcef(ephem: RinexNavEphemeris, transmitTimeSec: number): SatelliteEcefState {
  const core = evalKeplerPosition(ephem, transmitTimeSec);
  const dtVel = 0.01;
  const plus = evalKeplerPosition(ephem, transmitTimeSec + dtVel).pos;
  const minus = evalKeplerPosition(ephem, transmitTimeSec - dtVel).pos;

  const velocity: EcefCoords = {
    x: (plus.x - minus.x) / (2.0 * dtVel),
    y: (plus.y - minus.y) / (2.0 * dtVel),
    z: (plus.z - minus.z) / (2.0 * dtVel),
  };

  const relativisticCorrectionSec = GPS_F_REL * ephem.e * ephem.sqrtA * Math.sin(core.eccentricAnomalyRad);
  const dtClk = wrapGpsTimeDelta(transmitTimeSec - ephem.toc.gpsTow);
  const clockCorrectionSec =
    ephem.af0 + ephem.af1 * dtClk + ephem.af2 * dtClk * dtClk + relativisticCorrectionSec - ephem.tgd;

  return {
    prn: ephem.prn,
    position: core.pos,
    velocity,
    semiMajorAxisM: core.semiMajorAxisM,
    orbitalRadiusM: core.orbitalRadiusM,
    eccentricAnomalyRad: core.eccentricAnomalyRad,
    trueAnomalyRad: core.trueAnomalyRad,
    relativisticCorrectionSec,
    clockCorrectionSec,
    transmitTimeSec,
  };
}

/**
 * Converts WGS-84 geodetic coordinates (latDeg, lonDeg, altM) to ECEF (m).
 */
export function geodeticToEcef(geo: GeodeticCoords): EcefCoords {
  const lat = geo.latDeg * DEG_TO_RAD;
  const lon = geo.lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const N = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (N + geo.altM) * cosLat * cosLon,
    y: (N + geo.altM) * cosLat * sinLon,
    z: (N * (1.0 - WGS84_E2) + geo.altM) * sinLat,
  };
}

/**
 * Converts WGS-84 ECEF coordinates (m) to geodetic (latDeg, lonDeg, altM).
 */
export function ecefToGeodetic(ecef: EcefCoords): GeodeticCoords {
  const p = Math.hypot(ecef.x, ecef.y);
  const lon = Math.atan2(ecef.y, ecef.x);
  if (p < 1e-6) {
    const lat = ecef.z >= 0 ? 90 : -90;
    const b = WGS84_A * (1.0 - WGS84_F);
    return { latDeg: lat, lonDeg: 0, altM: Math.abs(ecef.z) - b };
  }

  let lat = Math.atan2(ecef.z, p * (1.0 - WGS84_E2));
  let alt = 0;
  for (let i = 0; i < 10; i++) {
    const sinLat = Math.sin(lat);
    const N = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
    alt = p / Math.cos(lat) - N;
    const nextLat = Math.atan2(ecef.z, p * (1.0 - (WGS84_E2 * N) / (N + alt)));
    if (Math.abs(nextLat - lat) < 1e-13) {
      lat = nextLat;
      break;
    }
    lat = nextLat;
  }
  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  alt = p / Math.cos(lat) - N;
  return {
    latDeg: lat * RAD_TO_DEG,
    lonDeg: lon * RAD_TO_DEG,
    altM: alt,
  };
}

/**
 * Computes satellite azimuth (deg, 0..360 clockwise from North) and elevation (deg, -90..+90)
 * relative to a receiver position in ECEF.
 */
export function computeAzEl(rxEcef: EcefCoords, satEcef: EcefCoords): { azimuthDeg: number; elevationDeg: number } {
  const geo = ecefToGeodetic(rxEcef);
  const lat = geo.latDeg * DEG_TO_RAD;
  const lon = geo.lonDeg * DEG_TO_RAD;

  const dx = satEcef.x - rxEcef.x;
  const dy = satEcef.y - rxEcef.y;
  const dz = satEcef.z - rxEcef.z;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const e = -sinLon * dx + cosLon * dy;
  const n = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const u = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const horiz = Math.hypot(e, n);
  let az = Math.atan2(e, n) * RAD_TO_DEG;
  if (az < 0) az += 360.0;
  const el = Math.atan2(u, horiz) * RAD_TO_DEG;

  return { azimuthDeg: az, elevationDeg: el };
}

/**
 * Inverts a 4x4 matrix via Gauss-Jordan elimination with partial pivoting.
 * Returns null if the matrix is singular.
 */
function invert4x4(m: number[][]): number[][] | null {
  const aug: number[][] = m.map((row, i) => [
    row[0]!,
    row[1]!,
    row[2]!,
    row[3]!,
    i === 0 ? 1 : 0,
    i === 1 ? 1 : 0,
    i === 2 ? 1 : 0,
    i === 3 ? 1 : 0,
  ]);

  for (let col = 0; col < 4; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(aug[col]![col]!);
    for (let r = col + 1; r < 4; r++) {
      const v = Math.abs(aug[r]![col]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-18) return null;

    if (pivotRow !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivotRow]!;
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col]![col]!;
    for (let j = 0; j < 8; j++) {
      aug[col]![j] = aug[col]![j]! / pivot;
    }

    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = aug[r]![col]!;
      for (let j = 0; j < 8; j++) {
        aug[r]![j] = aug[r]![j]! - factor * aug[col]![j]!;
      }
    }
  }

  return aug.map((row) => row.slice(4, 8));
}

export interface ReceiverSolverOptions {
  /** Maximum Gauss-Newton iterations (default 20). */
  maxIterations?: number | undefined;
  /** Convergence tolerance on ||delta_x|| in meters (default 1e-8). */
  toleranceM?: number | undefined;
  /** Apply Sagnac Earth-rotation correction during signal flight time (default false for pure geometric range). */
  sagnacCorrection?: boolean | undefined;
}

/**
 * Solves 3D receiver ECEF position (X, Y, Z) and receiver clock bias (c * delta_t)
 * using weighted least-squares Gauss-Newton iteration from >= 4 satellite pseudoranges.
 */
export function solveReceiverPosition(
  observations: SatellitePseudorange[],
  initialGuess: EcefCoords = { x: 0, y: 0, z: 0 },
  options: ReceiverSolverOptions = {},
): RinexPositionSolution {
  const maxIter = options.maxIterations ?? 20;
  const tol = options.toleranceM ?? 1e-8;
  const applySagnac = options.sagnacCorrection ?? false;

  if (observations.length < 4) {
    throw new Error(`At least 4 satellites are required for a 3D GNSS fix (received ${observations.length}).`);
  }

  let x = initialGuess.x;
  let y = initialGuess.y;
  let z = initialGuess.z;
  let cdt = 0.0;
  let converged = false;
  let iterations = 0;

  let lastH: number[][] = [];
  let lastRes: number[] = [];
  let lastGeomRanges: number[] = [];

  for (let iter = 1; iter <= maxIter; iter++) {
    iterations = iter;
    const H: number[][] = [];
    const dy: number[] = [];
    const weights: number[] = [];
    const geomRanges: number[] = [];

    for (const obs of observations) {
      let sx = obs.satPos.x;
      let sy = obs.satPos.y;
      const sz = obs.satPos.z;

      let rho = Math.hypot(sx - x, sy - y, sz - z);
      if (applySagnac) {
        const tau = rho / SPEED_OF_LIGHT;
        const rot = WGS84_OMEGA_E_DOT * tau;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const rxSat = sx * cosR + sy * sinR;
        const rySat = -sx * sinR + sy * cosR;
        sx = rxSat;
        sy = rySat;
        rho = Math.hypot(sx - x, sy - y, sz - z);
      }

      const safeRho = Math.max(rho, 1.0);
      H.push([-(sx - x) / safeRho, -(sy - y) / safeRho, -(sz - z) / safeRho, 1.0]);
      const correctedPr = obs.pseudorangeM + SPEED_OF_LIGHT * (obs.satClockBiasSec ?? 0);
      const predicted = rho + cdt;
      dy.push(correctedPr - predicted);
      weights.push(obs.weight ?? 1.0);
      geomRanges.push(rho);
    }

    // Form normal matrix N = H^T W H and RHS b = H^T W dy
    const N: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const b: number[] = [0, 0, 0, 0];

    for (let k = 0; k < observations.length; k++) {
      const w = weights[k]!;
      const hk = H[k]!;
      const dyk = dy[k]!;
      for (let r = 0; r < 4; r++) {
        b[r] = b[r]! + w * hk[r]! * dyk;
        for (let c = 0; c < 4; c++) {
          N[r]![c] = N[r]![c]! + w * hk[r]! * hk[c]!;
        }
      }
    }

    const Ninv = invert4x4(N);
    if (!Ninv) {
      break;
    }

    const dx = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        sum += Ninv[r]![c]! * b[c]!;
      }
      dx[r] = sum;
    }

    x += dx[0]!;
    y += dx[1]!;
    z += dx[2]!;
    cdt += dx[3]!;

    lastH = H;
    lastRes = dy;
    lastGeomRanges = geomRanges;

    const stepNorm = Math.hypot(dx[0]!, dx[1]!, dx[2]!, dx[3]!);
    if (stepNorm < tol) {
      converged = true;
      break;
    }
  }

  // Re-evaluate final residuals & unweighted DOP geometry matrix Q = (H^T H)^-1
  const ecef: EcefCoords = { x, y, z };
  const geodetic = ecefToGeodetic(ecef);

  const HtH: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  const satInfos: SatelliteGeometryInfo[] = [];
  let sumSqRes = 0;
  let maxResidualM = 0;

  for (let k = 0; k < observations.length; k++) {
    const obs = observations[k]!;
    const rho = Math.hypot(obs.satPos.x - x, obs.satPos.y - y, obs.satPos.z - z);
    const correctedPr = obs.pseudorangeM + SPEED_OF_LIGHT * (obs.satClockBiasSec ?? 0);
    const residual = correctedPr - (rho + cdt);
    sumSqRes += residual * residual;
    if (Math.abs(residual) > maxResidualM) maxResidualM = Math.abs(residual);

    const row = lastH[k] ?? [-(obs.satPos.x - x) / rho, -(obs.satPos.y - y) / rho, -(obs.satPos.z - z) / rho, 1.0];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        HtH[r]![c] = HtH[r]![c]! + row[r]! * row[c]!;
      }
    }

    const { azimuthDeg, elevationDeg } = computeAzEl(ecef, obs.satPos);
    satInfos.push({
      prn: obs.prn,
      azimuthDeg,
      elevationDeg,
      pseudorangeM: obs.pseudorangeM,
      computedRangeM: lastGeomRanges[k] ?? rho,
      residualM: lastRes.length > 0 ? residual : 0,
      satPos: obs.satPos,
    });
  }

  const Q = invert4x4(HtH);
  let dop: DopMetrics = { gdop: Number.NaN, pdop: Number.NaN, hdop: Number.NaN, vdop: Number.NaN, tdop: Number.NaN };
  if (Q) {
    const qxx = Math.max(0, Q[0]![0]!);
    const qyy = Math.max(0, Q[1]![1]!);
    const qzz = Math.max(0, Q[2]![2]!);
    const qtt = Math.max(0, Q[3]![3]!);

    // Rotate 3x3 ECEF covariance to local ENU frame for HDOP / VDOP
    const lat = geodetic.latDeg * DEG_TO_RAD;
    const lon = geodetic.lonDeg * DEG_TO_RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const R = [
      [-sinLon, cosLon, 0],
      [-sinLat * cosLon, -sinLat * sinLon, cosLat],
      [cosLat * cosLon, cosLat * sinLon, sinLat],
    ];
    const Q3 = [
      [Q[0]![0]!, Q[0]![1]!, Q[0]![2]!],
      [Q[1]![0]!, Q[1]![1]!, Q[1]![2]!],
      [Q[2]![0]!, Q[2]![1]!, Q[2]![2]!],
    ];
    // Q_enu = R * Q3 * R^T
    const RQ: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        RQ[r]![c] = R[r]![0]! * Q3[0]![c]! + R[r]![1]! * Q3[1]![c]! + R[r]![2]! * Q3[2]![c]!;
      }
    }
    const qEE = Math.max(0, RQ[0]![0]! * R[0]![0]! + RQ[0]![1]! * R[0]![1]! + RQ[0]![2]! * R[0]![2]!);
    const qNN = Math.max(0, RQ[1]![0]! * R[1]![0]! + RQ[1]![1]! * R[1]![1]! + RQ[1]![2]! * R[1]![2]!);
    const qUU = Math.max(0, RQ[2]![0]! * R[2]![0]! + RQ[2]![1]! * R[2]![1]! + RQ[2]![2]! * R[2]![2]!);

    dop = {
      gdop: Math.sqrt(qxx + qyy + qzz + qtt),
      pdop: Math.sqrt(qxx + qyy + qzz),
      hdop: Math.sqrt(qEE + qNN),
      vdop: Math.sqrt(qUU),
      tdop: Math.sqrt(qtt),
    };
  }

  return {
    converged,
    iterations,
    ecef,
    geodetic,
    clockBiasM: cdt,
    clockBiasSec: cdt / SPEED_OF_LIGHT,
    rmseM: Math.sqrt(sumSqRes / observations.length),
    maxResidualM,
    dop,
    satellites: satInfos,
  };
}

/**
 * Selects the closest healthy broadcast ephemeris for a given PRN and GPS time of week.
 */
export function selectBestEphemeris(
  ephemerides: RinexNavEphemeris[],
  prn: string,
  gpsTow: number,
): RinexNavEphemeris | undefined {
  let best: RinexNavEphemeris | undefined;
  let bestDt = Number.POSITIVE_INFINITY;
  for (const e of ephemerides) {
    if (e.prn !== prn) continue;
    const dt = Math.abs(wrapGpsTimeDelta(gpsTow - e.toe));
    if (dt < bestDt) {
      bestDt = dt;
      best = e;
    }
  }
  return best;
}

/**
 * Solves a 3D receiver position fix for a specific epoch by pairing an OBS document with a NAV document.
 */
export function solveRinexEpoch(
  obsDoc: RinexDocument,
  navDoc: RinexDocument,
  epochIndex: number = 0,
  options: ReceiverSolverOptions = {},
): RinexPositionSolution {
  const epoch = obsDoc.epochs[epochIndex];
  if (!epoch) {
    throw new Error(`Epoch index ${epochIndex} out of range (${obsDoc.epochs.length} epochs available).`);
  }

  const satObs: SatellitePseudorange[] = [];
  for (const sat of epoch.satellites) {
    const prObj = sat.observations["C1"] ?? sat.observations["P1"] ?? sat.observations["P2"];
    if (!prObj) continue;
    const ephem = selectBestEphemeris(navDoc.ephemerides, sat.prn, epoch.timestamp.gpsTow);
    if (!ephem) continue;

    // Estimate signal transmission time t_tx = t_rx - P / c
    const transmitTimeSec = epoch.timestamp.gpsTow - prObj.value / SPEED_OF_LIGHT;
    const svState = computeSatelliteEcef(ephem, transmitTimeSec);
    satObs.push({
      prn: sat.prn,
      satPos: svState.position,
      pseudorangeM: prObj.value,
      satClockBiasSec: svState.clockCorrectionSec,
    });
  }

  const initialGuess = obsDoc.header.approxPositionXyz ?? { x: 0, y: 0, z: 0 };
  const solution = solveReceiverPosition(satObs, initialGuess, options);
  return {
    ...solution,
    timestamp: epoch.timestamp,
  };
}
