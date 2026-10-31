// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Orbital Mechanics & Perturbed Orbit Propagation.
 *
 * Implements Cowell's 6-DOF orbital formulation with:
 * - Central gravitational field (point mass Earth)
 * - J2 zonal harmonic Earth oblateness
 * - Atmospheric drag (Harris-Priester / exponential scale height)
 * - Solar radiation pressure (SRP)
 * - Keplerian <-> Cartesian coordinate transformations
 */

import type {
  CcsdsEphemerisPoint,
  CcsdsKeplerianElements,
  CcsdsOemDocument,
  CcsdsSpacecraftParameters,
} from "../types.js";

// Standard Geodetic & Astrodynamic Constants (WGS-84 / IERS / DE440)
export const MU_EARTH_KM = 398600.4418; // km^3 / s^2
export const MU_SUN_KM = 1.32712440018e11; // km^3 / s^2
export const MU_MOON_KM = 4902.800066; // km^3 / s^2
export const R_EARTH_KM = 6378.137; // km
export const AU_KM = 149597870.7; // km
export const J2_EARTH = 1.08263e-3; // Non-dimensional
export const J3_EARTH = -2.53266e-6; // Non-dimensional
export const J4_EARTH = -1.61962e-6; // Non-dimensional
export const SOLAR_PRESSURE_N_M2 = 4.56e-6; // N / m^2 at 1 AU

export interface StateVector {
  x: number; // km
  y: number; // km
  z: number; // km
  vx: number; // km/s
  vy: number; // km/s
  vz: number; // km/s
}

export interface OrbitPropagationPoint extends StateVector {
  timeSeconds: number;
  altitudeKm: number;
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface OrbitAccelerationOptions {
  includeJ2?: boolean | undefined;
  includeJ3?: boolean | undefined;
  includeJ4?: boolean | undefined;
  includeZonalHarmonics?: boolean | undefined;
  includeDrag?: boolean | undefined;
  includeSrp?: boolean | undefined;
  includeShadow?: boolean | undefined;
  includeThirdBody?: boolean | undefined;
  includeLuniSolar?: boolean | undefined;
  epochSeconds?: number | undefined;
  sunPositionKm?: [number, number, number] | undefined;
  moonPositionKm?: [number, number, number] | undefined;
}

export interface OrbitPropagationOptions extends OrbitAccelerationOptions {
  durationSeconds?: number | undefined;
  stepSeconds?: number | undefined;
  integrator?: "rk4" | "rk45" | undefined;
  rtol?: number | undefined;
  atol?: number | undefined;
  minStepSeconds?: number | undefined;
  maxStepSeconds?: number | undefined;
}

/**
 * Solves Kepler's equation M = E - e * sin(E) via Newton-Raphson to convert
 * Mean Anomaly (deg) to True Anomaly (deg).
 */
export function meanToTrueAnomalyDeg(meanAnomalyDeg: number, eccentricity: number): number {
  const deg2rad = Math.PI / 180.0;
  const rad2deg = 180.0 / Math.PI;
  const e = Math.max(0.0, Math.min(0.999999, eccentricity));
  const M = (((meanAnomalyDeg * deg2rad) % (2.0 * Math.PI)) + 2.0 * Math.PI) % (2.0 * Math.PI);

  let E = e > 0.8 ? Math.PI : M;
  for (let iter = 0; iter < 30; iter++) {
    const f = E - e * Math.sin(E) - M;
    const fPrime = 1.0 - e * Math.cos(E);
    const dE = f / Math.max(1e-12, fPrime);
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }

  const nu = 2.0 * Math.atan2(Math.sqrt(1.0 + e) * Math.sin(E * 0.5), Math.sqrt(1.0 - e) * Math.cos(E * 0.5));
  return (nu * rad2deg + 360.0) % 360.0;
}

/**
 * Standard CIRA-72 / Vallado multi-layer exponential thermospheric density table (0 - 1000 km).
 * Columns: [baseAltitudeKm, baseDensityKgM3, scaleHeightKm]
 */
const THERMOSPHERE_LAYERS: readonly [number, number, number][] = [
  [0, 1.225, 7.249],
  [25, 3.899e-2, 6.349],
  [30, 1.774e-2, 6.682],
  [40, 3.972e-3, 7.554],
  [50, 1.057e-3, 8.382],
  [60, 3.206e-4, 7.714],
  [70, 8.77e-5, 6.549],
  [80, 1.905e-5, 5.799],
  [90, 3.396e-6, 5.382],
  [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263],
  [120, 2.438e-8, 9.473],
  [130, 8.484e-9, 12.636],
  [140, 3.845e-9, 16.149],
  [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74],
  [200, 2.789e-10, 37.105],
  [250, 7.248e-11, 45.546],
  [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298],
  [400, 3.725e-12, 58.515],
  [450, 1.585e-12, 60.828],
  [500, 6.967e-13, 63.822],
  [600, 1.454e-13, 71.835],
  [700, 3.614e-14, 88.667],
  [800, 1.17e-14, 124.64],
  [900, 5.245e-15, 181.05],
  [1000, 3.019e-15, 268.0],
];

export function evaluateThermosphericDensityKgM3(altKm: number): number {
  if (altKm <= 0) return 1.225;
  if (altKm > 1000.0) return 0.0;
  let baseAlt = 0;
  let rho0 = 1.225;
  let H = 7.249;
  for (let i = THERMOSPHERE_LAYERS.length - 1; i >= 0; i--) {
    const layer = THERMOSPHERE_LAYERS[i]!;
    if (altKm >= layer[0]) {
      baseAlt = layer[0];
      rho0 = layer[1];
      H = layer[2];
      break;
    }
  }
  return rho0 * Math.exp(-(altKm - baseAlt) / H);
}

/**
 * Convert Keplerian classical orbital elements to Cartesian state vector (km, km/s).
 */
export function keplerianToCartesian(elem: CcsdsKeplerianElements, mu: number = MU_EARTH_KM): StateVector {
  let a = elem.semiMajorAxisKm;
  if ((a === undefined || Number.isNaN(a) || a <= 0) && elem.meanMotionRevsPerDay && elem.meanMotionRevsPerDay > 0) {
    const nRadPerSec = (elem.meanMotionRevsPerDay * 2.0 * Math.PI) / 86400.0;
    a = Math.cbrt(mu / (nRadPerSec * nRadPerSec));
  }
  if (a === undefined || Number.isNaN(a) || a <= 0) {
    a = 7000.0;
  }

  const e = elem.eccentricity ?? 0.0;
  const deg2rad = Math.PI / 180.0;
  const inc = (elem.inclinationDeg ?? 0.0) * deg2rad;
  const raan = (elem.raanDeg ?? 0.0) * deg2rad;
  const argP = (elem.argOfPericenterDeg ?? 0.0) * deg2rad;

  let trueAnomDeg = elem.trueAnomalyDeg;
  if ((trueAnomDeg === undefined || Number.isNaN(trueAnomDeg)) && elem.meanAnomalyDeg !== undefined) {
    trueAnomDeg = meanToTrueAnomalyDeg(elem.meanAnomalyDeg, e);
  }
  const nu = (trueAnomDeg ?? 0.0) * deg2rad;

  // Semilatus rectum p = a * (1 - e^2)
  const p = a * (1.0 - e * e);
  const r = p / (1.0 + e * Math.cos(nu));

  // Position and velocity in orbital perifocal frame (PQW)
  const rPQW = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const vScale = Math.sqrt(mu / p);
  const vPQW = [-vScale * Math.sin(nu), vScale * (e + Math.cos(nu)), 0];

  // Rotation matrix from PQW to Inertial ECI frame
  // R = R_z(-raan) * R_x(-inc) * R_z(-argP)
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosi = Math.cos(inc);
  const sini = Math.sin(inc);
  const cosw = Math.cos(argP);
  const sinw = Math.sin(argP);

  const Px = cosO * cosw - sinO * sinw * cosi;
  const Py = sinO * cosw + cosO * sinw * cosi;
  const Pz = sinw * sini;

  const Qx = -cosO * sinw - sinO * cosw * cosi;
  const Qy = -sinO * sinw + cosO * cosw * cosi;
  const Qz = cosw * sini;

  return {
    x: rPQW[0]! * Px + rPQW[1]! * Qx,
    y: rPQW[0]! * Py + rPQW[1]! * Qy,
    z: rPQW[0]! * Pz + rPQW[1]! * Qz,
    vx: vPQW[0]! * Px + vPQW[1]! * Qx,
    vy: vPQW[0]! * Py + vPQW[1]! * Qy,
    vz: vPQW[0]! * Pz + vPQW[1]! * Qz,
  };
}

/**
 * Convert Cartesian state vector (km, km/s) to Keplerian classical elements.
 */
export function cartesianToKeplerian(sv: StateVector, mu: number = MU_EARTH_KM): CcsdsKeplerianElements {
  const rVec = [sv.x, sv.y, sv.z];
  const vVec = [sv.vx, sv.vy, sv.vz];
  const r = Math.sqrt(sv.x * sv.x + sv.y * sv.y + sv.z * sv.z);
  const v2 = sv.vx * sv.vx + sv.vy * sv.vy + sv.vz * sv.vz;

  // Specific angular momentum h = r x v
  const hx = rVec[1]! * vVec[2]! - rVec[2]! * vVec[1]!;
  const hy = rVec[2]! * vVec[0]! - rVec[0]! * vVec[2]!;
  const hz = rVec[0]! * vVec[1]! - rVec[1]! * vVec[0]!;
  const h = Math.sqrt(hx * hx + hy * hy + hz * hz);

  // Line of nodes vector n = k x h = [-hy, hx, 0]
  const nMag = Math.sqrt(hx * hx + hy * hy);

  // Eccentricity vector e = ((v^2 - mu/r)*r - (r.v)*v) / mu
  const rdotv = sv.x * sv.vx + sv.y * sv.vy + sv.z * sv.vz;
  const c1 = v2 - mu / r;
  const ex = (c1 * sv.x - rdotv * sv.vx) / mu;
  const ey = (c1 * sv.y - rdotv * sv.vy) / mu;
  const ez = (c1 * sv.z - rdotv * sv.vz) / mu;
  const e = Math.sqrt(ex * ex + ey * ey + ez * ez);

  // Specific orbital energy epsilon = v^2/2 - mu/r = -mu / (2*a)
  const energy = v2 / 2.0 - mu / r;
  const a = Math.abs(energy) > 1e-10 ? -mu / (2.0 * energy) : Infinity;

  // Inclination
  const incRad = Math.acos(Math.max(-1.0, Math.min(1.0, hz / h)));

  // RAAN
  let raanRad = 0;
  if (nMag > 1e-10) {
    raanRad = Math.acos(Math.max(-1.0, Math.min(1.0, -hy / nMag)));
    if (hx < 0) raanRad = 2.0 * Math.PI - raanRad;
  }

  // Argument of pericenter
  let argPRad = 0;
  if (nMag > 1e-10 && e > 1e-8) {
    const ndote = (-hy * ex + hx * ey) / (nMag * e);
    argPRad = Math.acos(Math.max(-1.0, Math.min(1.0, ndote)));
    if (ez < 0) argPRad = 2.0 * Math.PI - argPRad;
  }

  // True anomaly
  let nuRad = 0;
  if (e > 1e-8) {
    const edotr = (ex * sv.x + ey * sv.y + ez * sv.z) / (e * r);
    nuRad = Math.acos(Math.max(-1.0, Math.min(1.0, edotr)));
    if (rdotv < 0) nuRad = 2.0 * Math.PI - nuRad;
  }

  const rad2deg = 180.0 / Math.PI;
  return {
    semiMajorAxisKm: a,
    eccentricity: e,
    inclinationDeg: incRad * rad2deg,
    raanDeg: raanRad * rad2deg,
    argOfPericenterDeg: argPRad * rad2deg,
    trueAnomalyDeg: nuRad * rad2deg,
  };
}

/**
 * Low-precision analytical solar ECI position vector (km) from epoch seconds.
 * If epochSeconds < 1e8, treated as seconds elapsed since J2000.0; otherwise Unix epoch seconds.
 */
export function computeSolarPositionEciKm(epochSeconds: number = 0): [number, number, number] {
  const j2000Unix = 946728000.0; // 2000-01-01T12:00:00Z
  const dtSec = Math.abs(epochSeconds) > 1e8 ? epochSeconds - j2000Unix : epochSeconds;
  const T = dtSec / (36525.0 * 86400.0); // Julian centuries from J2000
  const deg2rad = Math.PI / 180.0;

  const meanLon = (280.46 + 36000.771 * T) * deg2rad;
  const meanAnom = (357.5277233 + 35999.05034 * T) * deg2rad;
  const eclLon = meanLon + (1.914666471 * Math.sin(meanAnom) + 0.019994643 * Math.sin(2.0 * meanAnom)) * deg2rad;
  const obliquity = (23.439291 - 0.0130042 * T) * deg2rad;
  const rAu = 1.000140612 - 0.016708617 * Math.cos(meanAnom) - 0.000139589 * Math.cos(2.0 * meanAnom);
  const rKm = rAu * AU_KM;

  return [
    rKm * Math.cos(eclLon),
    rKm * Math.cos(obliquity) * Math.sin(eclLon),
    rKm * Math.sin(obliquity) * Math.sin(eclLon),
  ];
}

/**
 * Low-precision analytical lunar ECI position vector (km) from epoch seconds.
 */
export function computeLunarPositionEciKm(epochSeconds: number = 0): [number, number, number] {
  const j2000Unix = 946728000.0;
  const dtSec = Math.abs(epochSeconds) > 1e8 ? epochSeconds - j2000Unix : epochSeconds;
  const T = dtSec / (36525.0 * 86400.0);
  const deg2rad = Math.PI / 180.0;

  const L0 = (218.316 + 481267.8813 * T) * deg2rad;
  const l = (134.963 + 477198.8676 * T) * deg2rad;
  const F = (93.272 + 483202.0175 * T) * deg2rad;
  const D = (297.85 + 445267.1115 * T) * deg2rad;
  const obliquity = (23.439291 - 0.0130042 * T) * deg2rad;

  const eclLon = L0 + (6.289 * Math.sin(l) + 1.274 * Math.sin(2 * D - l) + 0.658 * Math.sin(2 * D)) * deg2rad;
  const eclLat = (5.128 * Math.sin(F) + 0.28 * Math.sin(l + F)) * deg2rad;
  const rKm = 385000.56 - 20905.355 * Math.cos(l) - 3699.111 * Math.cos(2 * D - l) - 2955.968 * Math.cos(2 * D);

  const cosB = Math.cos(eclLat);
  const sinB = Math.sin(eclLat);
  const cosL = Math.cos(eclLon);
  const sinL = Math.sin(eclLon);
  const cosEps = Math.cos(obliquity);
  const sinEps = Math.sin(obliquity);

  return [
    rKm * cosB * cosL,
    rKm * (cosEps * cosB * sinL - sinEps * sinB),
    rKm * (sinEps * cosB * sinL + cosEps * sinB),
  ];
}

/**
 * Computes third-body gravitational acceleration (km/s^2) on a satellite at `pos`
 * due to a perturbing body at `bodyPos` with gravitational parameter `muBody`:
 *   a_3B = mu_3 * ( (r_3 - r) / ||r_3 - r||^3 - r_3 / ||r_3||^3 )
 */
export function computeThirdBodyAcceleration(
  pos: [number, number, number],
  bodyPos: [number, number, number],
  muBody: number,
): [number, number, number] {
  const dx = bodyPos[0] - pos[0];
  const dy = bodyPos[1] - pos[1];
  const dz = bodyPos[2] - pos[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  const d3 = d2 * Math.sqrt(d2);

  const r3_2 = bodyPos[0] * bodyPos[0] + bodyPos[1] * bodyPos[1] + bodyPos[2] * bodyPos[2];
  const r3_3 = r3_2 * Math.sqrt(r3_2);

  if (d3 < 1e-12 || r3_3 < 1e-12) return [0, 0, 0];

  return [
    muBody * (dx / d3 - bodyPos[0] / r3_3),
    muBody * (dy / d3 - bodyPos[1] / r3_3),
    muBody * (dz / d3 - bodyPos[2] / r3_3),
  ];
}

/**
 * Determines whether a spacecraft at `pos` (km) is inside Earth's cylindrical shadow (umbra)
 * given the Sun's ECI position `sunPosKm` (defaults to +X axis at 1 AU).
 */
export function isInEarthCylindricalShadow(
  pos: [number, number, number],
  sunPosKm: [number, number, number] = [AU_KM, 0, 0],
): boolean {
  const sMag = Math.sqrt(sunPosKm[0] * sunPosKm[0] + sunPosKm[1] * sunPosKm[1] + sunPosKm[2] * sunPosKm[2]);
  const sx = sMag > 1e-12 ? sunPosKm[0] / sMag : 1.0;
  const sy = sMag > 1e-12 ? sunPosKm[1] / sMag : 0.0;
  const sz = sMag > 1e-12 ? sunPosKm[2] / sMag : 0.0;

  const proj = pos[0] * sx + pos[1] * sy + pos[2] * sz;
  if (proj >= 0.0) return false; // Sunlit hemisphere

  const r2 = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2];
  const perpDist2 = Math.max(0.0, r2 - proj * proj);
  return perpDist2 < R_EARTH_KM * R_EARTH_KM;
}

/**
 * Computes acceleration vector [ax, ay, az] in km/s^2 given position and velocity.
 */
export function computeOrbitAcceleration(
  pos: [number, number, number],
  vel: [number, number, number],
  sc?: CcsdsSpacecraftParameters | undefined,
  opts?: OrbitAccelerationOptions | undefined,
): [number, number, number] {
  const x = pos[0];
  const y = pos[1];
  const z = pos[2];
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2);
  const r3 = r2 * r;

  // 1. Two-Body Keplerian Acceleration: a_grav = -mu/r^3 * r
  let ax = (-MU_EARTH_KM * x) / r3;
  let ay = (-MU_EARTH_KM * y) / r3;
  let az = (-MU_EARTH_KM * z) / r3;

  const R2 = R_EARTH_KM * R_EARTH_KM;
  const z2_r2 = (z * z) / r2;

  // 2a. Earth J2 Zonal Harmonic Perturbation
  if (opts?.includeJ2 !== false || opts?.includeZonalHarmonics) {
    const factorJ2 = (1.5 * J2_EARTH * MU_EARTH_KM * R2) / (r2 * r3);

    ax += factorJ2 * x * (5.0 * z2_r2 - 1.0);
    ay += factorJ2 * y * (5.0 * z2_r2 - 1.0);
    az += factorJ2 * z * (5.0 * z2_r2 - 3.0);
  }

  // 2b. Earth J3 Zonal Harmonic Perturbation (pear-shaped north-south asymmetry)
  if (opts?.includeJ3 || opts?.includeZonalHarmonics) {
    const R3 = R2 * R_EARTH_KM;
    const r5 = r2 * r3;
    const r7 = r5 * r2;
    const factorJ3xy = (2.5 * J3_EARTH * MU_EARTH_KM * R3) / r7;
    const xyTerm = 7.0 * z * z2_r2 - 3.0 * z;

    ax += factorJ3xy * x * xyTerm;
    ay += factorJ3xy * y * xyTerm;
    az += ((1.5 * J3_EARTH * MU_EARTH_KM * R3) / r5) * (1.0 - 10.0 * z2_r2 + (35.0 / 3.0) * z2_r2 * z2_r2);
  }

  // 2c. Earth J4 Zonal Harmonic Perturbation
  if (opts?.includeJ4 || opts?.includeZonalHarmonics) {
    const R4 = R2 * R2;
    const r7 = r2 * r2 * r3;
    const factorJ4 = (1.875 * J4_EARTH * MU_EARTH_KM * R4) / r7; // 15/8 = 1.875
    const z4_r4 = z2_r2 * z2_r2;

    ax += factorJ4 * x * (1.0 - 14.0 * z2_r2 + 21.0 * z4_r4);
    ay += factorJ4 * y * (1.0 - 14.0 * z2_r2 + 21.0 * z4_r4);
    az += factorJ4 * z * (5.0 - (70.0 / 3.0) * z2_r2 + 21.0 * z4_r4);
  }

  // 3. Atmospheric Drag: a_drag = -0.5 * rho * (Cd * A / m) * v_rel * v_rel_vec
  if (opts?.includeDrag && sc && sc.massKg && sc.massKg > 0 && sc.dragAreaM2 && sc.dragCoeff) {
    const altKm = r - R_EARTH_KM;
    if (altKm < 1000.0 && altKm > 0) {
      const rhoKgM3 = evaluateThermosphericDensityKgM3(altKm);

      const vx = vel[0];
      const vy = vel[1];
      const vz = vel[2];
      const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz); // km/s

      if (vMag > 1e-12) {
        const bCoeff = (sc.dragCoeff * sc.dragAreaM2) / sc.massKg;
        const dragMag = 0.5 * rhoKgM3 * bCoeff * vMag * vMag * 1000.0;

        ax -= dragMag * (vx / vMag);
        ay -= dragMag * (vy / vMag);
        az -= dragMag * (vz / vMag);
      }
    }
  }

  // 4. Solar Radiation Pressure (SRP) with Cylindrical Earth Shadow (Umbra)
  if (opts?.includeSrp && sc && sc.massKg && sc.massKg > 0 && sc.solarRadAreaM2 && sc.solarRadCoeff) {
    const sunPos: [number, number, number] =
      opts.sunPositionKm ??
      (opts.epochSeconds !== undefined ? computeSolarPositionEciKm(opts.epochSeconds) : [AU_KM, 0, 0]);
    const inShadow = opts.includeShadow !== false && isInEarthCylindricalShadow(pos, sunPos);
    if (!inShadow) {
      const sMag = Math.sqrt(sunPos[0] * sunPos[0] + sunPos[1] * sunPos[1] + sunPos[2] * sunPos[2]);
      const sx = sMag > 1e-12 ? sunPos[0] / sMag : 1.0;
      const sy = sMag > 1e-12 ? sunPos[1] / sMag : 0.0;
      const sz = sMag > 1e-12 ? sunPosKmVecComponent(sunPos[2], sMag) : 0.0;
      const srpMag = (SOLAR_PRESSURE_N_M2 * sc.solarRadCoeff * sc.solarRadAreaM2) / (sc.massKg * 1000.0); // km/s^2
      ax -= srpMag * sx;
      ay -= srpMag * sy;
      az -= srpMag * sz;
    }
  }

  // 5. Third-Body Moon & Sun Point-Mass Perturbations
  if (opts?.includeThirdBody || opts?.includeLuniSolar) {
    const tEpoch = opts.epochSeconds ?? 0;
    const sunPos = opts.sunPositionKm ?? computeSolarPositionEciKm(tEpoch);
    const moonPos = opts.moonPositionKm ?? computeLunarPositionEciKm(tEpoch);

    const [asx, asy, asz] = computeThirdBodyAcceleration(pos, sunPos, MU_SUN_KM);
    const [amx, amy, amz] = computeThirdBodyAcceleration(pos, moonPos, MU_MOON_KM);
    ax += asx + amx;
    ay += asy + amy;
    az += asz + amz;
  }

  return [ax, ay, az];
}

function sunPosKmVecComponent(val: number, mag: number): number {
  return val / mag;
}

function stateToPropagationPoint(state: StateVector, t: number): OrbitPropagationPoint {
  const rMag = Math.sqrt(state.x * state.x + state.y * state.y + state.z * state.z);
  const altKm = rMag - R_EARTH_KM;
  const latDeg = Math.asin(Math.max(-1.0, Math.min(1.0, state.z / rMag))) * (180.0 / Math.PI);
  const earthRotDeg = (7.292115e-5 * t * 180.0) / Math.PI;
  let lonDeg = (Math.atan2(state.y, state.x) * (180.0 / Math.PI) - earthRotDeg) % 360.0;
  if (lonDeg > 180.0) lonDeg -= 360.0;
  if (lonDeg < -180.0) lonDeg += 360.0;

  return {
    ...state,
    timeSeconds: t,
    altitudeKm: altKm,
    latitudeDeg: latDeg,
    longitudeDeg: lonDeg,
  };
}

/**
 * Propagate orbit state vector over time using 4th-Order Runge-Kutta (RK4) or
 * adaptive Dormand-Prince 5(4) (RK45).
 */
export function propagateOrbit(
  initialState: StateVector,
  sc?: CcsdsSpacecraftParameters | undefined,
  options?: OrbitPropagationOptions,
): OrbitPropagationPoint[] {
  const duration = options?.durationSeconds ?? 5400; // ~90 min nominal LEO orbit
  const dtNominal = options?.stepSeconds ?? 30.0;
  const baseEpoch = options?.epochSeconds;

  if (options?.integrator === "rk45") {
    const rtol = options.rtol ?? 1e-8;
    const atol = options.atol ?? 1e-9;
    const hMin = options.minStepSeconds ?? 0.1;
    const hMax = options.maxStepSeconds ?? Math.max(dtNominal, 300.0);

    const traj: OrbitPropagationPoint[] = [];
    let state: StateVector = { ...initialState };
    let t = 0.0;
    let h = Math.min(Math.max(dtNominal, hMin), hMax);

    traj.push(stateToPropagationPoint(state, t));

    const evalDeriv = (tLocal: number, y: readonly [number, number, number, number, number, number]) => {
      const stepOpts = baseEpoch !== undefined ? { ...options, epochSeconds: baseEpoch + tLocal } : options;
      const [ax, ay, az] = computeOrbitAcceleration([y[0], y[1], y[2]], [y[3], y[4], y[5]], sc, stepOpts);
      return [y[3], y[4], y[5], ax, ay, az] as const;
    };

    let guard = 0;
    while (t < duration - 1e-9 && guard < 100000) {
      guard++;
      if (t + h > duration) {
        h = duration - t;
      }

      const y0: [number, number, number, number, number, number] = [
        state.x,
        state.y,
        state.z,
        state.vx,
        state.vy,
        state.vz,
      ];

      // Dormand-Prince RK45 stages
      const k1 = evalDeriv(t, y0);
      const y2: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) y2[i] = y0[i]! + h * (0.2 * k1[i]!);
      const k2 = evalDeriv(t + 0.2 * h, y2);

      const y3: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) y3[i] = y0[i]! + h * ((3 / 40) * k1[i]! + (9 / 40) * k2[i]!);
      const k3 = evalDeriv(t + 0.3 * h, y3);

      const y4: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) {
        y4[i] = y0[i]! + h * ((44 / 45) * k1[i]! - (56 / 15) * k2[i]! + (32 / 9) * k3[i]!);
      }
      const k4 = evalDeriv(t + 0.8 * h, y4);

      const y5: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) {
        y5[i] =
          y0[i]! +
          h * ((19372 / 6561) * k1[i]! - (25360 / 2187) * k2[i]! + (64448 / 6561) * k3[i]! - (212 / 729) * k4[i]!);
      }
      const k5 = evalDeriv(t + (8 / 9) * h, y5);

      const y6: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) {
        y6[i] =
          y0[i]! +
          h *
            ((9017 / 3168) * k1[i]! -
              (355 / 33) * k2[i]! +
              (46732 / 5247) * k3[i]! +
              (49 / 176) * k4[i]! -
              (5103 / 18656) * k5[i]!);
      }
      const k6 = evalDeriv(t + h, y6);

      // 5th-order solution
      const yNext5: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) {
        yNext5[i] =
          y0[i]! +
          h *
            ((35 / 384) * k1[i]! +
              (500 / 1113) * k3[i]! +
              (125 / 192) * k4[i]! -
              (2187 / 6784) * k5[i]! +
              (11 / 84) * k6[i]!);
      }
      const k7 = evalDeriv(t + h, yNext5);

      // Error estimate (difference between 5th and 4th order solutions)
      let errNorm2 = 0.0;
      for (let i = 0; i < 6; i++) {
        const err_i =
          h *
          ((71 / 57600) * k1[i]! -
            (71 / 16695) * k3[i]! +
            (71 / 1920) * k4[i]! -
            (17253 / 339200) * k5[i]! +
            (22 / 525) * k6[i]! -
            (1 / 40) * k7[i]!);
        const scale = atol + rtol * Math.max(Math.abs(y0[i]!), Math.abs(yNext5[i]!));
        const ratio = err_i / scale;
        errNorm2 += ratio * ratio;
      }
      const errNorm = Math.sqrt(errNorm2 / 6.0);

      if (errNorm <= 1.0 || h <= hMin) {
        t += h;
        state = {
          x: yNext5[0],
          y: yNext5[1],
          z: yNext5[2],
          vx: yNext5[3],
          vy: yNext5[4],
          vz: yNext5[5],
        };
        traj.push(stateToPropagationPoint(state, t));
      }

      const factor = errNorm > 1e-16 ? Math.min(2.5, Math.max(0.2, 0.9 * Math.pow(errNorm, -0.2))) : 2.0;
      h = Math.min(hMax, Math.max(hMin, h * factor));
    }

    return traj;
  }

  const dt = dtNominal;
  const steps = Math.ceil(duration / dt);

  const traj: OrbitPropagationPoint[] = [];

  let state: StateVector = { ...initialState };
  let t = 0;

  for (let s = 0; s <= steps; s++) {
    traj.push(stateToPropagationPoint(state, t));

    if (s === steps) break;

    // RK4 step
    const px = state.x;
    const py = state.y;
    const pz = state.z;
    const vx = state.vx;
    const vy = state.vy;
    const vz = state.vz;

    const opts1 = baseEpoch !== undefined ? { ...options, epochSeconds: baseEpoch + t } : options;
    const optsMid = baseEpoch !== undefined ? { ...options, epochSeconds: baseEpoch + t + 0.5 * dt } : options;
    const optsEnd = baseEpoch !== undefined ? { ...options, epochSeconds: baseEpoch + t + dt } : options;

    // k1
    const [k1_vx, k1_vy, k1_vz] = computeOrbitAcceleration([px, py, pz], [vx, vy, vz], sc, opts1);
    const k1_px = vx;
    const k1_py = vy;
    const k1_pz = vz;

    // k2
    const p2x = px + 0.5 * dt * k1_px;
    const p2y = py + 0.5 * dt * k1_py;
    const p2z = pz + 0.5 * dt * k1_pz;
    const v2x = vx + 0.5 * dt * k1_vx;
    const v2y = vy + 0.5 * dt * k1_vy;
    const v2z = vz + 0.5 * dt * k1_vz;
    const [k2_vx, k2_vy, k2_vz] = computeOrbitAcceleration([p2x, p2y, p2z], [v2x, v2y, v2z], sc, optsMid);
    const k2_px = v2x;
    const k2_py = v2y;
    const k2_pz = v2z;

    // k3
    const p3x = px + 0.5 * dt * k2_px;
    const p3y = py + 0.5 * dt * k2_py;
    const p3z = pz + 0.5 * dt * k2_pz;
    const v3x = vx + 0.5 * dt * k2_vx;
    const v3y = vy + 0.5 * dt * k2_vy;
    const v3z = vz + 0.5 * dt * k2_vz;
    const [k3_vx, k3_vy, k3_vz] = computeOrbitAcceleration([p3x, p3y, p3z], [v3x, v3y, v3z], sc, optsMid);
    const k3_px = v3x;
    const k3_py = v3y;
    const k3_pz = v3z;

    // k4
    const p4x = px + dt * k3_px;
    const p4y = py + dt * k3_py;
    const p4z = pz + dt * k3_pz;
    const v4x = vx + dt * k3_vx;
    const v4y = vy + dt * k3_vy;
    const v4z = vz + dt * k3_vz;
    const [k4_vx, k4_vy, k4_vz] = computeOrbitAcceleration([p4x, p4y, p4z], [v4x, v4y, v4z], sc, optsEnd);
    const k4_px = v4x;
    const k4_py = v4y;
    const k4_pz = v4z;

    // Update state
    state = {
      x: px + (dt / 6.0) * (k1_px + 2.0 * k2_px + 2.0 * k3_px + k4_px),
      y: py + (dt / 6.0) * (k1_py + 2.0 * k2_py + 2.0 * k3_py + k4_py),
      z: pz + (dt / 6.0) * (k1_pz + 2.0 * k2_pz + 2.0 * k3_pz + k4_pz),
      vx: vx + (dt / 6.0) * (k1_vx + 2.0 * k2_vx + 2.0 * k3_vx + k4_vx),
      vy: vy + (dt / 6.0) * (k1_vy + 2.0 * k2_vy + 2.0 * k3_vy + k4_vy),
      vz: vz + (dt / 6.0) * (k1_vz + 2.0 * k2_vz + 2.0 * k3_vz + k4_vz),
    };

    t += dt;
  }

  return traj;
}

/**
 * Cubic Hermite interpolation of position and velocity across CCSDS OEM ephemeris state vectors.
 * Uses exact position and velocity end-conditions on each ephemeris interval [t_0, t_1].
 */
export function interpolateOemState(
  oemOrPoints: CcsdsOemDocument | readonly CcsdsEphemerisPoint[],
  targetEpochOrSeconds: string | number,
): StateVector {
  const points = Array.isArray(oemOrPoints) ? oemOrPoints : (oemOrPoints as CcsdsOemDocument).points;
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  }
  if (points.length === 1) {
    const p = points[0]!;
    return { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz };
  }

  const targetSec =
    typeof targetEpochOrSeconds === "number" ? targetEpochOrSeconds : Date.parse(targetEpochOrSeconds) / 1000.0;

  if (targetSec <= points[0]!.epochSeconds) {
    const p = points[0]!;
    return { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz };
  }
  const last = points[points.length - 1]!;
  if (targetSec >= last.epochSeconds) {
    return { x: last.x, y: last.y, z: last.z, vx: last.vx, vy: last.vy, vz: last.vz };
  }

  // Binary search for bracketing interval [p0, p1]
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.epochSeconds <= targetSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const p0 = points[lo]!;
  const p1 = points[hi]!;
  const dt = p1.epochSeconds - p0.epochSeconds;
  if (dt <= 1e-12) {
    return { x: p0.x, y: p0.y, z: p0.z, vx: p0.vx, vy: p0.vy, vz: p0.vz };
  }

  const tau = (targetSec - p0.epochSeconds) / dt;
  const tau2 = tau * tau;
  const tau3 = tau2 * tau;

  // Cubic Hermite basis functions for position
  const h00 = 2.0 * tau3 - 3.0 * tau2 + 1.0;
  const h10 = tau3 - 2.0 * tau2 + tau;
  const h01 = -2.0 * tau3 + 3.0 * tau2;
  const h11 = tau3 - tau2;

  // Derivatives dh/dtau for velocity (v(t) = (1/dt) * dr/dtau)
  const dh00 = 6.0 * tau2 - 6.0 * tau;
  const dh10 = 3.0 * tau2 - 4.0 * tau + 1.0;
  const dh01 = -6.0 * tau2 + 6.0 * tau;
  const dh11 = 3.0 * tau2 - 2.0 * tau;

  return {
    x: h00 * p0.x + h10 * dt * p0.vx + h01 * p1.x + h11 * dt * p1.vx,
    y: h00 * p0.y + h10 * dt * p0.vy + h01 * p1.y + h11 * dt * p1.vy,
    z: h00 * p0.z + h10 * dt * p0.vz + h01 * p1.z + h11 * dt * p1.vz,
    vx: (dh00 * p0.x + dh10 * dt * p0.vx + dh01 * p1.x + dh11 * dt * p1.vx) / dt,
    vy: (dh00 * p0.y + dh10 * dt * p0.vy + dh01 * p1.y + dh11 * dt * p1.vy) / dt,
    vz: (dh00 * p0.z + dh10 * dt * p0.vz + dh01 * p1.z + dh11 * dt * p1.vz) / dt,
  };
}
