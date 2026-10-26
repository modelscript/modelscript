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

import type { CcsdsKeplerianElements, CcsdsSpacecraftParameters } from "../types.js";

// Standard Geodetic & Astrodynamic Constants (WGS-84 / IERS)
export const MU_EARTH_KM = 398600.4418; // km^3 / s^2
export const R_EARTH_KM = 6378.137; // km
export const J2_EARTH = 1.08263e-3; // Non-dimensional
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
  includeDrag?: boolean | undefined;
  includeSrp?: boolean | undefined;
}

export interface OrbitPropagationOptions extends OrbitAccelerationOptions {
  durationSeconds?: number | undefined;
  stepSeconds?: number | undefined;
}

/**
 * Convert Keplerian classical orbital elements to Cartesian state vector (km, km/s).
 */
export function keplerianToCartesian(elem: CcsdsKeplerianElements, mu: number = MU_EARTH_KM): StateVector {
  const a = elem.semiMajorAxisKm;
  const e = elem.eccentricity;
  const deg2rad = Math.PI / 180.0;
  const inc = elem.inclinationDeg * deg2rad;
  const raan = elem.raanDeg * deg2rad;
  const argP = elem.argOfPericenterDeg * deg2rad;
  const nu = elem.trueAnomalyDeg * deg2rad;

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

  // 2. Earth J2 Zonal Harmonic Perturbation
  if (opts?.includeJ2 !== false) {
    const R2 = R_EARTH_KM * R_EARTH_KM;
    const z2_r2 = (z * z) / r2;
    const factor = (1.5 * J2_EARTH * MU_EARTH_KM * R2) / (r2 * r3);

    ax += factor * x * (5.0 * z2_r2 - 1.0);
    ay += factor * y * (5.0 * z2_r2 - 1.0);
    az += factor * z * (5.0 * z2_r2 - 3.0);
  }

  // 3. Atmospheric Drag: a_drag = -0.5 * rho * (Cd * A / m) * v_rel * v_rel_vec
  if (opts?.includeDrag && sc && sc.massKg && sc.massKg > 0 && sc.dragAreaM2 && sc.dragCoeff) {
    const altKm = r - R_EARTH_KM;
    if (altKm < 1000.0 && altKm > 0) {
      // Exponential scale height atmosphere model (H ~ 60 km, rho0 ~ 1.225 kg/m^3)
      const H_km = 60.0;
      const rho0 = 1.225; // kg/m^3
      const rho = rho0 * Math.exp(-altKm / H_km) * 1e-9; // kg/m^3 -> kg / (km * m^2)

      const vx = vel[0];
      const vy = vel[1];
      const vz = vel[2];
      const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz); // km/s

      // a_drag in km/s^2: 0.5 * rho * (Cd * A_m2 / m_kg) * (v_km_s * 1000)^2 / 1000
      const bCoeff = (sc.dragCoeff * sc.dragAreaM2) / sc.massKg;
      const dragMag = 0.5 * rho * bCoeff * vMag * vMag;

      ax -= dragMag * (vx / vMag);
      ay -= dragMag * (vy / vMag);
      az -= dragMag * (vz / vMag);
    }
  }

  // 4. Solar Radiation Pressure (SRP)
  if (opts?.includeSrp && sc && sc.massKg && sc.massKg > 0 && sc.solarRadAreaM2 && sc.solarRadCoeff) {
    // Sun direction vector approx along +X in inertial EME2000
    const srpMag = (SOLAR_PRESSURE_N_M2 * sc.solarRadCoeff * sc.solarRadAreaM2) / (sc.massKg * 1000.0); // km/s^2
    ax -= srpMag;
  }

  return [ax, ay, az];
}

/**
 * Propagate orbit state vector over time using 4th-Order Runge-Kutta (RK4).
 */
export function propagateOrbit(
  initialState: StateVector,
  sc?: CcsdsSpacecraftParameters | undefined,
  options?: OrbitPropagationOptions,
): OrbitPropagationPoint[] {
  const duration = options?.durationSeconds ?? 5400; // ~90 min nominal LEO orbit
  const dt = options?.stepSeconds ?? 30.0;
  const steps = Math.ceil(duration / dt);

  const traj: OrbitPropagationPoint[] = [];

  let state: StateVector = { ...initialState };
  let t = 0;

  for (let s = 0; s <= steps; s++) {
    const rMag = Math.sqrt(state.x * state.x + state.y * state.y + state.z * state.z);
    const altKm = rMag - R_EARTH_KM;

    // Sub-satellite latitude and longitude (spherical Earth approximation)
    const latDeg = Math.asin(Math.max(-1.0, Math.min(1.0, state.z / rMag))) * (180.0 / Math.PI);
    // Earth rotation angle: omega_e ~ 7.292115e-5 rad/s
    const earthRotDeg = (7.292115e-5 * t * 180.0) / Math.PI;
    let lonDeg = (Math.atan2(state.y, state.x) * (180.0 / Math.PI) - earthRotDeg) % 360.0;
    if (lonDeg > 180.0) lonDeg -= 360.0;
    if (lonDeg < -180.0) lonDeg += 360.0;

    traj.push({
      ...state,
      timeSeconds: t,
      altitudeKm: altKm,
      latitudeDeg: latDeg,
      longitudeDeg: lonDeg,
    });

    if (s === steps) break;

    // RK4 step
    const px = state.x;
    const py = state.y;
    const pz = state.z;
    const vx = state.vx;
    const vy = state.vy;
    const vz = state.vz;

    // k1
    const [k1_vx, k1_vy, k1_vz] = computeOrbitAcceleration([px, py, pz], [vx, vy, vz], sc, options);
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
    const [k2_vx, k2_vy, k2_vz] = computeOrbitAcceleration([p2x, p2y, p2z], [v2x, v2y, v2z], sc, options);
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
    const [k3_vx, k3_vy, k3_vz] = computeOrbitAcceleration([p3x, p3y, p3z], [v3x, v3y, v3z], sc, options);
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
    const [k4_vx, k4_vy, k4_vz] = computeOrbitAcceleration([p4x, p4y, p4z], [v4x, v4y, v4z], sc, options);
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
