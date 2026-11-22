// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript multibody & wheel-rail contact runtime for `@modelscript/gensys-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI identical in structure to `@modelscript/pslf-std-lib`:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — GENSYS element parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — internal state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — kinematic inputs & force outputs:
 *       Inputs:
 *         IO[0] = dx (m), IO[1] = dy (m), IO[2] = dz (m)
 *         IO[3] = vx (m/s), IO[4] = vy (m/s), IO[5] = vz (m/s)
 *         IO[6] = normalForce N (N)
 *         IO[7] = creepX (-), IO[8] = creepY (-), IO[9] = spin (rad/m)
 *       Outputs:
 *         IO[10] = fx (N), IO[11] = fy (N), IO[12] = fz (N)
 *         IO[13] = mz (N*m), IO[14] = aux1 (adhesionRatio or bellows pressure Pa)
 *         IO[15] = aux2 (stored elastic energy J or dissipated power W)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `GensysArchetypeId` in gensys-std-schemas.ts)
const ARCH_SPRING_LINEAR: i32 = 1;
const ARCH_SPRING_PIECEWISE: i32 = 2;
const ARCH_DAMPER_VISCOUS: i32 = 10;
const ARCH_SPRING_DAMPER_SERIES: i32 = 11;
const ARCH_AIRSPRING: i32 = 12;
const ARCH_FRICTION_COULOMB: i32 = 13;
const ARCH_WHEEL_RAIL_PE3: i32 = 20;
const ARCH_WHEEL_RAIL_PRA: i32 = 21;
const ARCH_WHEEL_RAIL_PE1: i32 = 22;
const ARCH_CONTACT_HERTZ: i32 = 23;
const ARCH_CREEP_KALKER: i32 = 24;
const ARCH_CREEP_POLACH: i32 = 25;
const ARCH_PROFILE_WHEEL: i32 = 30;
const ARCH_PROFILE_RAIL: i32 = 31;
const ARCH_TRACK_IRREG: i32 = 32;
const ARCH_BODY_RIGID: i32 = 40;
const ARCH_CONSTRAINT_KINEMATIC: i32 = 50;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

@inline
function applyDeadband(d: f64, gap: f64): f64 {
  if (gap <= 0.0) return d;
  if (d > gap) return d - gap;
  if (d < -gap) return d + gap;
  return 0.0;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function gensysGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes internal states for a GENSYS standard library element.
 * Returns the number of active internal states.
 */
export function gensysModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_SPRING_DAMPER_SERIES) {
    // State 0: internal damper displacement x_d (initialized to current dx for zero-transient start)
    setState(slotPtr, 0, getIo(slotPtr, 0));
    return 1;
  }

  if (archetypeId == ARCH_AIRSPRING) {
    // State 0: reservoir displacement z_r, State 1: instantaneous pressure p
    const p0 = getCon(slotPtr, conCount, 6, 4.5e5);
    setState(slotPtr, 0, getIo(slotPtr, 2));
    setState(slotPtr, 1, p0);
    setIo(slotPtr, 14, p0);
    return 2;
  }

  if (archetypeId == ARCH_FRICTION_COULOMB) {
    // State 0: stick-slip elastic shear displacement x_s, State 1: y_s
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    return 2;
  }

  return 0;
}

/**
 * Cleanroom Kalker FASTSIM (1982) 2D contact patch discretization solver.
 * Discretizes the Hertzian contact ellipse into Ny x Nx strips, marches tangential
 * shear traction from leading to trailing edge with Coulomb saturation |p_t| <= mu * p_z(x,y),
 * and integrates longitudinal Fx, lateral Fy, spin moment Mz, adhesion ratio, and slip power.
 */
function evalKalkerFastsim(
  slotPtr: usize,
  mu: f64,
  a: f64,
  b: f64,
  gSteel: f64,
  c11: f64,
  c22: f64,
  c23: f64,
  normalForce: f64,
  creepX: f64,
  creepY: f64,
  spin: f64,
  vForward: f64,
): void {
  if (normalForce <= 1e-6) {
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  const ab = a * b;
  const l1 = (8.0 * a) / (3.0 * gSteel * Math.max(0.5, c11));
  const l2 = (8.0 * a) / (3.0 * gSteel * Math.max(0.5, c22));
  const l3 = (Math.PI * a * Math.sqrt(a / b)) / (4.0 * gSteel * Math.max(0.1, c23));

  const pz0 = (2.0 * normalForce) / (Math.PI * ab);
  const invA2 = 1.0 / (a * a);
  const invB2 = 1.0 / (b * b);

  const ny: i32 = 16;
  const nx: i32 = 16;
  const dy = (2.0 * b) / (<f64>ny);

  let fx: f64 = 0.0;
  let fy: f64 = 0.0;
  let mz: f64 = 0.0;

  for (let j: i32 = 0; j < ny; j++) {
    const y = -b + (<f64>j + 0.5) * dy;
    const yTerm = 1.0 - y * y * invB2;
    if (yTerm <= 1e-12) continue;
    const aj = a * Math.sqrt(yTerm);
    const dx = (2.0 * aj) / (<f64>nx);
    const dA = dx * dy;

    let px: f64 = 0.0;
    let py: f64 = 0.0;
    for (let i: i32 = 0; i < nx; i++) {
      const x = aj - (<f64>i + 0.5) * dx;
      const stepDx = i == 0 ? 0.5 * dx : dx;
      px -= (creepX / l1 - (spin * y) / l3) * stepDx;
      py -= (creepY / l2 + (spin * x) / l3) * stepDx;

      const pz = pz0 * Math.max(0.0, yTerm - x * x * invA2);
      const gMax = mu * pz;
      const pMag = Math.sqrt(px * px + py * py);
      if (pMag > gMax) {
        if (gMax > 0.0 && pMag > 1e-18) {
          const s = gMax / pMag;
          px *= s;
          py *= s;
        } else {
          px = 0.0;
          py = 0.0;
        }
      }

      fx += px * dA;
      fy += py * dA;
      mz += (x * py - y * px) * dA;
    }
  }

  const fMax = mu * normalForce;
  let fMag = Math.sqrt(fx * fx + fy * fy);
  if (fMag > fMax && fMag > 1e-12) {
    const s = fMax / fMag;
    fx *= s;
    fy *= s;
    fMag = fMax;
  }

  const vRef = Math.abs(vForward) > 0.1 ? Math.abs(vForward) : 20.0;
  const adhesion = fMax > 0.0 ? fMag / fMax : 0.0;
  const power = (Math.abs(fx * creepX) + Math.abs(fy * creepY) + Math.abs(mz * spin)) * vRef;

  setIo(slotPtr, 10, fx);
  setIo(slotPtr, 11, fy);
  setIo(slotPtr, 12, normalForce);
  setIo(slotPtr, 13, mz);
  setIo(slotPtr, 14, adhesion);
  setIo(slotPtr, 15, power);
}

/**
 * Evaluates Polach (2005) nonlinear wheel-rail creep forces and Kalker spin moment.
 */
function evalPolachCreep(
  slotPtr: usize,
  conCount: i32,
  normalForce: f64,
  creepX: f64,
  creepY: f64,
  spin: f64,
  vForward: f64,
): void {
  const mu0 = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.36));
  const a = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.0065));
  const b = Math.max(1e-4, getCon(slotPtr, conCount, 2, 0.0045));
  const gSteel = Math.max(1e9, getCon(slotPtr, conCount, 3, 8.2e10));
  const kA = Math.max(0.05, getCon(slotPtr, conCount, 5, 0.6));
  const kS = Math.max(0.05, getCon(slotPtr, conCount, 6, 0.3));
  const polachA = clamp(getCon(slotPtr, conCount, 7, 0.4), 0.1, 1.0);
  const polachB = Math.max(0.0, getCon(slotPtr, conCount, 8, 0.6));

  if (normalForce <= 1e-6) {
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  // Approximate Kalker coefficients for a/b contact ellipse (Kalker 1990)
  const ratio = a / b;
  const c11 = 3.2893 + 0.975 / ratio - 0.012 / (ratio * ratio);
  const c22 = 2.4014 + 1.3179 / ratio - 0.02 / (ratio * ratio);
  const c23 = 0.4147 + 1.0184 / ratio + 0.056 / (ratio * ratio);

  const ab = a * b;
  const sqrtAb = Math.sqrt(ab);

  // Spin contribution to lateral creepage
  const creepYEff = creepY + (c23 / c22) * sqrtAb * spin;
  const sTotal = Math.sqrt(creepX * creepX + creepYEff * creepYEff);

  // Slip velocity for Polach falling friction law
  const vRef = Math.abs(vForward) > 0.1 ? Math.abs(vForward) : 20.0;
  const wSlip = sTotal * vRef;
  const mu = mu0 * ((1.0 - polachA) * Math.exp(-polachB * wSlip) + polachA);

  if (sTotal < 1e-12) {
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, normalForce);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  // Directional weighted Kalker stiffness C_eff
  const nx = creepX / sTotal;
  const ny = creepYEff / sTotal;
  const cEff = Math.sqrt((c11 * nx) * (c11 * nx) + (c22 * ny) * (c22 * ny));

  // Polach dimensionless gradient epsilon (Polach 2005 Eq. 4-6)
  const eps = (0.25 * gSteel * ab * cEff * sTotal) / (normalForce * mu);
  const kAEps = kA * eps;
  const kSEps = kS * eps;
  const fMag = (2.0 * normalForce * mu / Math.PI) * (kAEps / (1.0 + kAEps * kAEps) + Math.atan(kSEps));

  const fx = -fMag * nx;
  const fy = -fMag * ny;
  const mz = -gSteel * ab * sqrtAb * c23 * creepY * 0.1 - 0.02 * a * fMag * Math.tanh(spin * a * 10.0);
  const adhesion = Math.sqrt(fx * fx + fy * fy) / (normalForce * mu);

  setIo(slotPtr, 10, fx);
  setIo(slotPtr, 11, fy);
  setIo(slotPtr, 12, normalForce);
  setIo(slotPtr, 13, mz);
  setIo(slotPtr, 14, adhesion);
  setIo(slotPtr, 15, fMag * wSlip);
}

/**
 * Evaluates a cleanroom GENSYS multibody coupling, contact, profile, or body element.
 */
export function gensysModelEval(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const dx = getIo(slotPtr, 0);
  const dy = getIo(slotPtr, 1);
  const dz = getIo(slotPtr, 2);
  const vx = getIo(slotPtr, 3);
  const vy = getIo(slotPtr, 4);
  const vz = getIo(slotPtr, 5);
  const nIn = getIo(slotPtr, 6);
  const creepX = getIo(slotPtr, 7);
  const creepY = getIo(slotPtr, 8);
  const spin = getIo(slotPtr, 9);

  if (archetypeId == ARCH_SPRING_LINEAR) {
    const kx = getCon(slotPtr, conCount, 0, 1.0e6);
    const ky = getCon(slotPtr, conCount, 1, 1.0e6);
    const kz = getCon(slotPtr, conCount, 2, 1.2e6);
    const f0 = getCon(slotPtr, conCount, 3, 0.0);
    const gap = getCon(slotPtr, conCount, 4, 0.0);

    const ex = applyDeadband(dx, gap);
    const ey = applyDeadband(dy, gap);
    const ez = applyDeadband(dz, gap);

    const fx = -kx * ex;
    const fy = -ky * ey;
    const fz = -kz * ez + f0;
    const energy = 0.5 * (kx * ex * ex + ky * ey * ey + kz * ez * ez);

    setIo(slotPtr, 10, fx);
    setIo(slotPtr, 11, fy);
    setIo(slotPtr, 12, fz);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, energy);
    return;
  }

  if (archetypeId == ARCH_SPRING_PIECEWISE) {
    const k1 = getCon(slotPtr, conCount, 0, 2.0e5);
    const d1 = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.025));
    const k2 = getCon(slotPtr, conCount, 2, 1.2e7);
    const cInt = getCon(slotPtr, conCount, 3, 1.0e3);

    const absX = Math.abs(dx);
    const sgnX: f64 = dx >= 0.0 ? 1.0 : -1.0;
    const fxEl = absX <= d1 ? -k1 * dx : -sgnX * (k1 * d1 + k2 * (absX - d1));

    const absY = Math.abs(dy);
    const sgnY: f64 = dy >= 0.0 ? 1.0 : -1.0;
    const fyEl = absY <= d1 ? -k1 * dy : -sgnY * (k1 * d1 + k2 * (absY - d1));

    const absZ = Math.abs(dz);
    const sgnZ: f64 = dz >= 0.0 ? 1.0 : -1.0;
    const fzEl = absZ <= d1 ? -k1 * dz : -sgnZ * (k1 * d1 + k2 * (absZ - d1));

    setIo(slotPtr, 10, fxEl - cInt * vx);
    setIo(slotPtr, 11, fyEl - cInt * vy);
    setIo(slotPtr, 12, fzEl - cInt * vz);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, absY > d1 ? 1.0 : 0.0);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  if (archetypeId == ARCH_DAMPER_VISCOUS) {
    const cx = getCon(slotPtr, conCount, 0, 2.0e4);
    const cy = getCon(slotPtr, conCount, 1, 2.5e4);
    const cz = getCon(slotPtr, conCount, 2, 3.0e4);
    const fmax = Math.max(1.0, getCon(slotPtr, conCount, 3, 1.0e5));

    const fx = clamp(-cx * vx, -fmax, fmax);
    const fy = clamp(-cy * vy, -fmax, fmax);
    const fz = clamp(-cz * vz, -fmax, fmax);
    const power = -(fx * vx + fy * vy + fz * vz);

    setIo(slotPtr, 10, fx);
    setIo(slotPtr, 11, fy);
    setIo(slotPtr, 12, fz);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, power);
    return;
  }

  if (archetypeId == ARCH_SPRING_DAMPER_SERIES) {
    // Maxwell series spring-damper: dx_d/dt = (k/c) * (dx - x_d)
    const kSer = Math.max(1.0, getCon(slotPtr, conCount, 0, 1.5e7));
    const cSer = Math.max(1.0, getCon(slotPtr, conCount, 1, 5.0e5));
    const fmax = Math.max(1.0, getCon(slotPtr, conCount, 2, 4.0e4));

    let xd = getState(slotPtr, 0);
    const tau = cSer / kSer;
    const dxdDt = (dx - xd) / tau;
    setDState(slotPtr, 0, dxdDt);

    if (dt > 0.0) {
      // Exact exponential update for unconditional stiffness stability
      const alpha = Math.exp(-dt / tau);
      xd = dx - (dx - xd) * alpha;
      setState(slotPtr, 0, xd);
    }

    const fx = clamp(-kSer * (dx - xd), -fmax, fmax);
    setIo(slotPtr, 10, fx);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, xd);
    setIo(slotPtr, 15, 0.5 * kSer * (dx - xd) * (dx - xd));
    return;
  }

  if (archetypeId == ARCH_AIRSPRING) {
    // Pneumatic Berg/Nishimura airspring: series stiffness ks, reservoir stiffness kr, orifice damping cr
    const ks = Math.max(1.0, getCon(slotPtr, conCount, 0, 6.0e5));
    const kr = Math.max(1.0, getCon(slotPtr, conCount, 1, 2.2e5));
    const cr = Math.max(1.0, getCon(slotPtr, conCount, 2, 4.5e4));
    const kx = getCon(slotPtr, conCount, 3, 1.6e5);
    const ky = getCon(slotPtr, conCount, 4, 1.6e5);
    const aeff = Math.max(0.01, getCon(slotPtr, conCount, 5, 0.28));
    const p0 = Math.max(1.0e4, getCon(slotPtr, conCount, 6, 4.5e5));
    const v0 = Math.max(0.005, getCon(slotPtr, conCount, 7, 0.065));
    const nPoly = Math.max(1.0, getCon(slotPtr, conCount, 8, 1.35));

    let zr = getState(slotPtr, 0);
    const kSum = ks + kr;
    const dzrDt = (ks * (dz - zr) - kr * zr) / cr;
    setDState(slotPtr, 0, dzrDt);

    if (dt > 0.0) {
      const zEq = (ks / kSum) * dz;
      const alpha = Math.exp(-(kSum / cr) * dt);
      zr = zEq + (zr - zEq) * alpha;
      setState(slotPtr, 0, zr);
    }

    // Restoring force from bellows + polytropic volume compression
    const fzLin = -ks * (dz - zr);
    const volRatio = clamp(v0 / Math.max(0.2 * v0, v0 - aeff * dz), 0.2, 5.0);
    const pInst = p0 * Math.pow(volRatio, nPoly);
    setState(slotPtr, 1, pInst);

    const fz = fzLin - (pInst - p0) * aeff * 0.15;
    const fx = -kx * dx;
    const fy = -ky * dy;

    setIo(slotPtr, 10, fx);
    setIo(slotPtr, 11, fy);
    setIo(slotPtr, 12, fz);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, pInst);
    setIo(slotPtr, 15, 0.5 * ks * (dz - zr) * (dz - zr) + 0.5 * kr * zr * zr);
    return;
  }

  if (archetypeId == ARCH_FRICTION_COULOMB) {
    const mu = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.35));
    const fn0 = Math.max(0.0, getCon(slotPtr, conCount, 1, 2.5e4));
    const vEps = Math.max(1e-6, getCon(slotPtr, conCount, 2, 1.0e-3));
    const normalF = nIn > 0.0 ? nIn : fn0;
    const fMax = mu * normalF;

    const vMag = Math.sqrt(vx * vx + vy * vy);
    let fx: f64 = 0.0;
    let fy: f64 = 0.0;
    if (vMag > 1e-12) {
      const reg = Math.tanh(vMag / vEps);
      fx = -fMax * reg * (vx / vMag);
      fy = -fMax * reg * (vy / vMag);
    }

    setIo(slotPtr, 10, fx);
    setIo(slotPtr, 11, fy);
    setIo(slotPtr, 12, normalF);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, fMax > 0.0 ? Math.sqrt(fx * fx + fy * fy) / fMax : 0.0);
    setIo(slotPtr, 15, -(fx * vx + fy * vy));
    return;
  }

  if (archetypeId == ARCH_WHEEL_RAIL_PE3) {
    let normalF = nIn;
    if (normalF <= 0.0 && dz > 0.0) {
      const cHertz = getCon(slotPtr, conCount, 9, 9.5e10);
      normalF = cHertz * dz * Math.sqrt(dz);
    }
    const mu0 = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.36));
    const a = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.0065));
    const b = Math.max(1e-4, getCon(slotPtr, conCount, 2, 0.0045));
    const gSteel = Math.max(1e9, getCon(slotPtr, conCount, 3, 8.2e10));
    const ratio = a / b;
    const c11 = 3.2893 + 0.975 / ratio - 0.012 / (ratio * ratio);
    const c22 = 2.4014 + 1.3179 / ratio - 0.02 / (ratio * ratio);
    const c23 = 0.4147 + 1.0184 / ratio + 0.056 / (ratio * ratio);
    evalKalkerFastsim(slotPtr, mu0, a, b, gSteel, c11, c22, c23, normalF, creepX, creepY, spin, vx);
    return;
  }

  if (
    archetypeId == ARCH_WHEEL_RAIL_PRA ||
    archetypeId == ARCH_WHEEL_RAIL_PE1 ||
    archetypeId == ARCH_CREEP_POLACH
  ) {
    let normalF = nIn;
    if (normalF <= 0.0 && dz > 0.0) {
      const cHertz = getCon(slotPtr, conCount, 9, 9.5e10);
      normalF = cHertz * dz * Math.sqrt(dz);
    }
    evalPolachCreep(slotPtr, conCount, normalF, creepX, creepY, spin, vx);
    return;
  }

  if (archetypeId == ARCH_CONTACT_HERTZ) {
    const cHertz = Math.max(1e6, getCon(slotPtr, conCount, 0, 9.5e10));
    const cDamp = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.0e5));
    const pen = dz > 0.0 ? dz : dx > 0.0 ? dx : 0.0;
    const penRate = dz > 0.0 ? vz : vx;
    const p32 = pen * Math.sqrt(pen);
    const fn = pen > 0.0 ? Math.max(0.0, cHertz * p32 + cDamp * p32 * penRate) : 0.0;

    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, fn);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, pen);
    setIo(slotPtr, 15, 0.4 * cHertz * p32 * pen);
    return;
  }

  if (archetypeId == ARCH_CREEP_KALKER) {
    const mu0 = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.36));
    const a = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.0065));
    const b = Math.max(1e-4, getCon(slotPtr, conCount, 2, 0.0045));
    const gSteel = Math.max(1e9, getCon(slotPtr, conCount, 3, 8.2e10));
    const c11 = getCon(slotPtr, conCount, 4, 4.12);
    const c22 = getCon(slotPtr, conCount, 5, 3.67);
    const c23 = getCon(slotPtr, conCount, 6, 1.47);
    evalKalkerFastsim(slotPtr, mu0, a, b, gSteel, c11, c22, c23, Math.max(0.0, nIn), creepX, creepY, spin, vx);
    return;
  }

  if (archetypeId == ARCH_PROFILE_WHEEL || archetypeId == ARCH_PROFILE_RAIL) {
    // Outputs rolling radius difference delta_r = conicity * dy in IO[14]
    const conicity = getCon(slotPtr, conCount, 1, 0.12);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, conicity * dy);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  if (archetypeId == ARCH_TRACK_IRREG) {
    // Deterministic harmonic track irregularity sample at spatial coordinate dx (or v*t)
    const av = getCon(slotPtr, conCount, 0, 4.032e-7);
    const wavelength = Math.max(1.0, getCon(slotPtr, conCount, 4, 15.0));
    const s = dx != 0.0 ? dx : vx * t;
    const omega = (2.0 * Math.PI) / wavelength;
    const amp = Math.sqrt(av * wavelength);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, amp * Math.sin(omega * s));
    setIo(slotPtr, 12, amp * Math.cos(omega * s));
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, amp);
    setIo(slotPtr, 15, 0.0);
    return;
  }

  if (archetypeId == ARCH_BODY_RIGID) {
    const mass = Math.max(1.0, getCon(slotPtr, conCount, 0, 1000.0));
    const g = getCon(slotPtr, conCount, 4, 9.80665);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, mass * g);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, mass);
    setIo(slotPtr, 15, 0.5 * mass * (vx * vx + vy * vy + vz * vz));
    return;
  }

  if (archetypeId == ARCH_CONSTRAINT_KINEMATIC) {
    const kPen = getCon(slotPtr, conCount, 0, 1.0e9);
    const cPen = getCon(slotPtr, conCount, 1, 1.0e5);
    setIo(slotPtr, 10, -kPen * dx - cPen * vx);
    setIo(slotPtr, 11, -kPen * dy - cPen * vy);
    setIo(slotPtr, 12, -kPen * dz - cPen * vz);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, 0.0);
    return;
  }
}
