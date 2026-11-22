// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/adams-std-lib`.
 *
 * Implements standardized multibody dynamics, contact mechanics, compliance, and tire
 * mathematical formulations using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — element parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — 6-DOF wrench / derivative output buffer:
 *       DSTATE[0] = fx (or scalar value), DSTATE[1] = fy, DSTATE[2] = fz,
 *       DSTATE[3] = tx, DSTATE[4] = ty, DSTATE[5] = tz (or mz aligning torque)
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — input/output bus:
 *       IO[0]  = x / dx / kappa (longitudinal slip)
 *       IO[1]  = xdot / vx / alpha (slip angle, rad)
 *       IO[2]  = y / dy / fz (vertical load, N)
 *       IO[3]  = z / dz / gamma (camber angle, rad)
 *       IO[4]  = rx (roll angle, rad)
 *       IO[5]  = ry (pitch angle, rad)
 *       IO[6]  = rz (yaw angle, rad)
 *       IO[7]  = vy (y-velocity)
 *       IO[8]  = vz (z-velocity)
 *       IO[9]  = wx (x-angular velocity)
 *       IO[10] = wy (y-angular velocity)
 *       IO[11] = wz (z-angular velocity)
 *       IO[12] = outValue / Fx
 *       IO[13] = outFy
 *       IO[14] = outFz
 *       IO[15] = outMz / Tz
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `AdamsArchetypeId` in adams-std-schemas.ts)
const ARCH_FUNC_STEP: i32 = 1;
const ARCH_FUNC_STEP5: i32 = 2;
const ARCH_FUNC_IMPACT: i32 = 3;
const ARCH_FUNC_BISTOP: i32 = 4;
const ARCH_FUNC_AKISPL: i32 = 5;
const ARCH_FUNC_CUBSPL: i32 = 6;
const ARCH_FUNC_HAVSIN: i32 = 7;
const ARCH_FUNC_SHF: i32 = 8;
const ARCH_FUNC_MEASURE_DISP: i32 = 9;
const ARCH_FUNC_MEASURE_VEL: i32 = 10;

const ARCH_JOINT_REVOLUTE: i32 = 20;
const ARCH_JOINT_TRANSLATIONAL: i32 = 21;
const ARCH_JOINT_SPHERICAL: i32 = 22;
const ARCH_JOINT_UNIVERSAL: i32 = 23;
const ARCH_JOINT_CYLINDRICAL: i32 = 24;
const ARCH_JOINT_FIXED: i32 = 25;
const ARCH_JOINT_PLANAR: i32 = 26;
const ARCH_JOINT_CV: i32 = 27;
const ARCH_JOINT_HOOKE: i32 = 28;
const ARCH_JOINT_POINT_CURVE: i32 = 29;
const ARCH_CONSTRAINT_MOTION: i32 = 30;

const ARCH_FORCE_SPRING_DAMPER: i32 = 40;
const ARCH_FORCE_BUSHING: i32 = 41;
const ARCH_FORCE_BEAM: i32 = 42;
const ARCH_FORCE_FIELD: i32 = 43;
const ARCH_FORCE_SFORCE: i32 = 44;
const ARCH_FORCE_VFORCE: i32 = 45;
const ARCH_FORCE_GFORCE: i32 = 46;
const ARCH_FORCE_CONTACT_3D: i32 = 47;

const ARCH_TIRE_PAC2002: i32 = 60;
const ARCH_TIRE_FIALA: i32 = 61;
const ARCH_TIRE_UA: i32 = 62;
const ARCH_ROAD_FLAT: i32 = 63;
const ARCH_ROAD_CLEAT: i32 = 64;

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
function writeWrench(slotPtr: usize, fx: f64, fy: f64, fz: f64, tx: f64, ty: f64, tz: f64): f64 {
  setDState(slotPtr, 0, fx);
  setDState(slotPtr, 1, fy);
  setDState(slotPtr, 2, fz);
  setDState(slotPtr, 3, tx);
  setDState(slotPtr, 4, ty);
  setDState(slotPtr, 5, tz);
  setIo(slotPtr, 12, fx);
  setIo(slotPtr, 13, fy);
  setIo(slotPtr, 14, fz);
  setIo(slotPtr, 15, tz);
  return fx;
}

/**
 * Smooth C1 cubic Hermite step transition: STEP(x, x0, h0, x1, h1).
 */
@inline
function evalStep(x: f64, x0: f64, h0: f64, x1: f64, h1: f64): f64 {
  const dx = x1 - x0;
  if (Math.abs(dx) < 1e-15) return x < x0 ? h0 : h1;
  if (dx > 0.0) {
    if (x <= x0) return h0;
    if (x >= x1) return h1;
  } else {
    if (x >= x0) return h0;
    if (x <= x1) return h1;
  }
  const u = (x - x0) / dx;
  return h0 + (h1 - h0) * u * u * (3.0 - 2.0 * u);
}

/**
 * Smooth C2 quintic polynomial step transition: STEP5(x, x0, h0, x1, h1).
 */
@inline
function evalStep5(x: f64, x0: f64, h0: f64, x1: f64, h1: f64): f64 {
  const dx = x1 - x0;
  if (Math.abs(dx) < 1e-15) return x < x0 ? h0 : h1;
  if (dx > 0.0) {
    if (x <= x0) return h0;
    if (x >= x1) return h1;
  } else {
    if (x >= x0) return h0;
    if (x <= x1) return h1;
  }
  const u = (x - x0) / dx;
  const u3 = u * u * u;
  return h0 + (h1 - h0) * u3 * (10.0 - 15.0 * u + 6.0 * u * u);
}

/**
 * Unilateral Hertzian IMPACT contact force with cubic-step damping ramp:
 *   F = max(0, k * (x1 - x)^e - STEP(x1 - x, 0, 0, d, cmax) * xdot)   for x < x1
 *   F = 0                                                              for x >= x1
 */
@inline
function evalImpact(x: f64, xdot: f64, x1: f64, k: f64, e: f64, cmax: f64, d: f64): f64 {
  if (x >= x1) return 0.0;
  const pen = x1 - x;
  const fSpring = k * Math.pow(pen, e);
  const cEff = d > 1e-15 ? evalStep(pen, 0.0, 0.0, d, cmax) : cmax;
  const fTotal = fSpring - cEff * xdot;
  return fTotal > 0.0 ? fTotal : 0.0;
}

/**
 * Pacejka Magic Formula 2002 core curve:
 *   F = D * sin(C * atan(B * x - E * (B * x - atan(B * x))))
 */
@inline
function evalMagicFormula(x: f64, B: f64, C: f64, D: f64, E: f64): f64 {
  const bx = B * x;
  const at = Math.atan(bx);
  return D * Math.sin(C * Math.atan(bx - E * (bx - at)));
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function adamsGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes element state slots to zero/equilibrium and returns the active state count.
 */
export function adamsModelInit(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  for (let i: i32 = 0; i < 6; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  setIo(slotPtr, 12, 0.0);
  setIo(slotPtr, 13, 0.0);
  setIo(slotPtr, 14, 0.0);
  setIo(slotPtr, 15, 0.0);

  if (archetypeId == ARCH_FORCE_BUSHING || archetypeId == ARCH_FORCE_BEAM || archetypeId == ARCH_FORCE_FIELD) {
    return 6;
  }
  if (archetypeId == ARCH_TIRE_PAC2002 || archetypeId == ARCH_TIRE_FIALA || archetypeId == ARCH_TIRE_UA) {
    return 4;
  }
  return 1;
}

/**
 * Evaluates a cleanroom MSC Adams runtime function, kinematic constraint, force/bushing,
 * or tire/road element at time `t` with step `dt`.
 *
 * Writes outputs to `IO[12..15]` and `DSTATE[0..5]`, and returns the primary scalar value (`IO[12]`).
 */
export function adamsModelEval(
  archetypeId: i32,
  t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): f64 {
  const x = getIo(slotPtr, 0);
  const xdot = getIo(slotPtr, 1);
  const dy = getIo(slotPtr, 2);
  const dz = getIo(slotPtr, 3);
  const rx = getIo(slotPtr, 4);
  const ry = getIo(slotPtr, 5);
  const rz = getIo(slotPtr, 6);
  const vy = getIo(slotPtr, 7);
  const vz = getIo(slotPtr, 8);
  const wx = getIo(slotPtr, 9);
  const wy = getIo(slotPtr, 10);
  const wz = getIo(slotPtr, 11);

  // --- 1. Runtime Functions ---
  if (archetypeId == ARCH_FUNC_STEP) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const h0 = getCon(slotPtr, conCount, 1, 0.0);
    const x1 = getCon(slotPtr, conCount, 2, 1.0);
    const h1 = getCon(slotPtr, conCount, 3, 1.0);
    return writeWrench(slotPtr, evalStep(x, x0, h0, x1, h1), 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_STEP5) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const h0 = getCon(slotPtr, conCount, 1, 0.0);
    const x1 = getCon(slotPtr, conCount, 2, 1.0);
    const h1 = getCon(slotPtr, conCount, 3, 1.0);
    return writeWrench(slotPtr, evalStep5(x, x0, h0, x1, h1), 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_IMPACT) {
    const x1 = getCon(slotPtr, conCount, 0, 0.0);
    const k = getCon(slotPtr, conCount, 1, 1.0e5);
    const e = getCon(slotPtr, conCount, 2, 1.5);
    const cmax = getCon(slotPtr, conCount, 3, 100.0);
    const d = getCon(slotPtr, conCount, 4, 1.0e-3);
    return writeWrench(slotPtr, evalImpact(x, xdot, x1, k, e, cmax, d), 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_BISTOP) {
    const x1 = getCon(slotPtr, conCount, 0, -0.05);
    const x2 = getCon(slotPtr, conCount, 1, 0.05);
    const k = getCon(slotPtr, conCount, 2, 1.0e5);
    const e = getCon(slotPtr, conCount, 3, 1.5);
    const cmax = getCon(slotPtr, conCount, 4, 100.0);
    const d = getCon(slotPtr, conCount, 5, 1.0e-3);
    let f: f64 = 0.0;
    if (x < x1) {
      f = evalImpact(x, xdot, x1, k, e, cmax, d);
    } else if (x > x2) {
      f = -evalImpact(-x, -xdot, -x2, k, e, cmax, d);
    }
    return writeWrench(slotPtr, f, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_HAVSIN) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const h0 = getCon(slotPtr, conCount, 1, 0.0);
    const x1 = getCon(slotPtr, conCount, 2, 1.0);
    const h1 = getCon(slotPtr, conCount, 3, 1.0);
    let val = h0;
    if (x >= x1) {
      val = h1;
    } else if (x > x0 && Math.abs(x1 - x0) > 1e-15) {
      const u = (x - x0) / (x1 - x0);
      val = h0 + 0.5 * (h1 - h0) * (1.0 - Math.cos(Math.PI * u));
    }
    return writeWrench(slotPtr, val, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_SHF) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const a = getCon(slotPtr, conCount, 1, 1.0);
    const omega = getCon(slotPtr, conCount, 2, 6.283185307179586);
    const phi = getCon(slotPtr, conCount, 3, 0.0);
    const b = getCon(slotPtr, conCount, 4, 0.0);
    const val = a * Math.sin(omega * (x - x0) - phi) + b;
    return writeWrench(slotPtr, val, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_AKISPL || archetypeId == ARCH_FUNC_CUBSPL) {
    // 3-knot quadratic/Hermite spline interpolation over (x0,y0), (x1,y1), (x2,y2)
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const y0 = getCon(slotPtr, conCount, 1, 0.0);
    const x1 = getCon(slotPtr, conCount, 2, 1.0);
    const y1 = getCon(slotPtr, conCount, 3, 1.0);
    const x2 = getCon(slotPtr, conCount, 4, 2.0);
    const y2 = getCon(slotPtr, conCount, 5, 1.5);
    const m0 = Math.abs(x1 - x0) > 1e-15 ? (y1 - y0) / (x1 - x0) : 0.0;
    const m1 = Math.abs(x2 - x1) > 1e-15 ? (y2 - y1) / (x2 - x1) : 0.0;
    const s1 = 0.5 * (m0 + m1);
    let val: f64;
    if (x <= x1) {
      const h = Math.max(1e-15, x1 - x0);
      const u = clamp((x - x0) / h, 0.0, 1.0);
      const h00 = (1.0 + 2.0 * u) * (1.0 - u) * (1.0 - u);
      const h10 = u * (1.0 - u) * (1.0 - u);
      const h01 = u * u * (3.0 - 2.0 * u);
      const h11 = u * u * (u - 1.0);
      val = h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * s1;
    } else {
      const h = Math.max(1e-15, x2 - x1);
      const u = clamp((x - x1) / h, 0.0, 1.0);
      const h00 = (1.0 + 2.0 * u) * (1.0 - u) * (1.0 - u);
      const h10 = u * (1.0 - u) * (1.0 - u);
      const h01 = u * u * (3.0 - 2.0 * u);
      const h11 = u * u * (u - 1.0);
      val = h00 * y1 + h10 * h * s1 + h01 * y2 + h11 * h * m1;
    }
    return writeWrench(slotPtr, val, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_MEASURE_DISP) {
    const axis = <i32>Math.round(getCon(slotPtr, conCount, 0, 0.0));
    const scale = getCon(slotPtr, conCount, 1, 1.0);
    let val: f64 = 0.0;
    if (axis == 0) {
      val = Math.sqrt(x * x + dy * dy + dz * dz);
    } else if (axis == 1) {
      val = x;
    } else if (axis == 2) {
      val = dy;
    } else {
      val = dz;
    }
    return writeWrench(slotPtr, val * scale, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FUNC_MEASURE_VEL) {
    const axis = <i32>Math.round(getCon(slotPtr, conCount, 0, 1.0));
    const scale = getCon(slotPtr, conCount, 1, 1.0);
    let val: f64 = 0.0;
    if (axis == 1) {
      val = xdot;
    } else if (axis == 2) {
      val = vy;
    } else if (axis == 3) {
      val = vz;
    } else {
      const dist = Math.sqrt(x * x + dy * dy + dz * dz);
      val = dist > 1e-15 ? (x * xdot + dy * vy + dz * vz) / dist : 0.0;
    }
    return writeWrench(slotPtr, val * scale, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  // --- 2. Forces & Bushings ---
  if (archetypeId == ARCH_FORCE_SPRING_DAMPER) {
    const k = getCon(slotPtr, conCount, 0, 1.0e4);
    const c = getCon(slotPtr, conCount, 1, 100.0);
    const l0 = getCon(slotPtr, conCount, 2, 0.0);
    const f0 = getCon(slotPtr, conCount, 3, 0.0);
    const kNl = getCon(slotPtr, conCount, 4, 0.0);
    const defl = x - l0;
    const f = -k * defl - kNl * defl * defl * defl - c * xdot + f0;
    return writeWrench(slotPtr, f, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FORCE_BUSHING || archetypeId == ARCH_FORCE_FIELD) {
    const kx = getCon(slotPtr, conCount, 0, 1.0e5);
    const ky = getCon(slotPtr, conCount, 1, 1.0e5);
    const kz = getCon(slotPtr, conCount, 2, 1.0e5);
    const krx = getCon(slotPtr, conCount, 3, 1.0e3);
    const kry = getCon(slotPtr, conCount, 4, 1.0e3);
    const krz = getCon(slotPtr, conCount, 5, 1.0e3);
    const cx = getCon(slotPtr, conCount, 6, 500.0);
    const cy = getCon(slotPtr, conCount, 7, 500.0);
    const cz = getCon(slotPtr, conCount, 8, 500.0);
    const crx = getCon(slotPtr, conCount, 9, 10.0);
    const cry = getCon(slotPtr, conCount, 10, 10.0);
    const crz = getCon(slotPtr, conCount, 11, 10.0);

    const fx = -kx * x - cx * xdot;
    const fy = -ky * dy - cy * vy;
    const fz = -kz * dz - cz * vz;
    const tx = -krx * rx - crx * wx;
    const ty = -kry * ry - cry * wy;
    const tz = -krz * rz - crz * wz;
    return writeWrench(slotPtr, fx, fy, fz, tx, ty, tz);
  }

  if (archetypeId == ARCH_FORCE_BEAM) {
    const L = Math.max(1e-6, getCon(slotPtr, conCount, 0, 1.0));
    const A = getCon(slotPtr, conCount, 1, 1.0e-3);
    const Iyy = getCon(slotPtr, conCount, 2, 1.0e-6);
    const Izz = getCon(slotPtr, conCount, 3, 1.0e-6);
    const J = getCon(slotPtr, conCount, 4, 2.0e-6);
    const E = getCon(slotPtr, conCount, 5, 2.1e11);
    const G = getCon(slotPtr, conCount, 6, 8.0e10);
    const cr = getCon(slotPtr, conCount, 7, 0.01);

    const kAxial = (E * A) / L;
    const kShearY = (12.0 * E * Izz) / (L * L * L);
    const kShearZ = (12.0 * E * Iyy) / (L * L * L);
    const kTors = (G * J) / L;
    const kBendY = (4.0 * E * Iyy) / L;
    const kBendZ = (4.0 * E * Izz) / L;

    const fx = -kAxial * (x + cr * xdot);
    const fy = -kShearY * (dy + cr * vy);
    const fz = -kShearZ * (dz + cr * vz);
    const tx = -kTors * (rx + cr * wx);
    const ty = -kBendY * (ry + cr * wy);
    const tz = -kBendZ * (rz + cr * wz);
    return writeWrench(slotPtr, fx, fy, fz, tx, ty, tz);
  }

  if (archetypeId == ARCH_FORCE_SFORCE) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const bias = getCon(slotPtr, conCount, 1, 0.0);
    const fmin = getCon(slotPtr, conCount, 2, -1.0e9);
    const fmax = getCon(slotPtr, conCount, 3, 1.0e9);
    const f = clamp(gain * x + bias, fmin, fmax);
    return writeWrench(slotPtr, f, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FORCE_VFORCE) {
    const fx = getCon(slotPtr, conCount, 0, 0.0);
    const fy = getCon(slotPtr, conCount, 1, 0.0);
    const fz = getCon(slotPtr, conCount, 2, 0.0);
    return writeWrench(slotPtr, fx, fy, fz, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_FORCE_GFORCE) {
    const fx = getCon(slotPtr, conCount, 0, 0.0);
    const fy = getCon(slotPtr, conCount, 1, 0.0);
    const fz = getCon(slotPtr, conCount, 2, 0.0);
    const tx = getCon(slotPtr, conCount, 3, 0.0);
    const ty = getCon(slotPtr, conCount, 4, 0.0);
    const tz = getCon(slotPtr, conCount, 5, 0.0);
    return writeWrench(slotPtr, fx, fy, fz, tx, ty, tz);
  }

  if (archetypeId == ARCH_FORCE_CONTACT_3D) {
    // x = gap (contact if x < 0), xdot = normal velocity, vy = tangential slip speed
    const k = getCon(slotPtr, conCount, 0, 1.0e5);
    const e = getCon(slotPtr, conCount, 1, 1.5);
    const cmax = getCon(slotPtr, conCount, 2, 100.0);
    const d = getCon(slotPtr, conCount, 3, 1.0e-3);
    const muS = getCon(slotPtr, conCount, 4, 0.3);
    const muD = getCon(slotPtr, conCount, 5, 0.25);
    const vs = Math.max(1e-6, getCon(slotPtr, conCount, 6, 0.01));
    const vd = Math.max(vs + 1e-6, getCon(slotPtr, conCount, 7, 0.1));

    const fn = evalImpact(x, xdot, 0.0, k, e, cmax, d);
    const vAbs = Math.abs(vy);
    let mu: f64 = 0.0;
    if (vAbs < vs) {
      mu = evalStep(vAbs, 0.0, 0.0, vs, muS);
    } else if (vAbs < vd) {
      mu = evalStep(vAbs, vs, muS, vd, muD);
    } else {
      mu = muD;
    }
    const ft = vy >= 0.0 ? -mu * fn : mu * fn;
    return writeWrench(slotPtr, fn, ft, 0.0, 0.0, 0.0, 0.0);
  }

  // --- 3. Tires & Automotive ---
  if (archetypeId == ARCH_TIRE_PAC2002) {
    // IO[0] = kappa (longitudinal slip), IO[1] = alpha (slip angle rad), IO[2] = Fz (vertical load N)
    const Bx = getCon(slotPtr, conCount, 0, 10.0);
    const Cx = getCon(slotPtr, conCount, 1, 1.65);
    const muX = getCon(slotPtr, conCount, 2, 1.0);
    const Ex = getCon(slotPtr, conCount, 3, 0.1);
    const By = getCon(slotPtr, conCount, 4, 8.5);
    const Cy = getCon(slotPtr, conCount, 5, 1.3);
    const muY = getCon(slotPtr, conCount, 6, 0.95);
    const Ey = getCon(slotPtr, conCount, 7, -0.5);
    const fz0 = getCon(slotPtr, conCount, 8, 4000.0);
    const trail = getCon(slotPtr, conCount, 9, 0.03);

    const fz = dy > 0.0 ? dy : fz0;
    const fx = evalMagicFormula(x, Bx, Cx, muX * fz, Ex);
    const fy = evalMagicFormula(xdot, By, Cy, muY * fz, Ey);
    const mz = -trail * fy;
    return writeWrench(slotPtr, fx, fy, fz, 0.0, 0.0, mz);
  }

  if (archetypeId == ARCH_TIRE_FIALA || archetypeId == ARCH_TIRE_UA) {
    const cSlip = getCon(slotPtr, conCount, 2, 1.0e5);
    const cAlpha = getCon(slotPtr, conCount, 3, 6.0e4);
    const mu = getCon(slotPtr, conCount, 5, 0.95);
    const fz = dy > 0.0 ? dy : 4000.0;
    const fMax = mu * fz;
    const fxRaw = cSlip * x;
    const fyRaw = cAlpha * Math.tan(xdot);
    const mag = Math.sqrt(fxRaw * fxRaw + fyRaw * fyRaw);
    const scale = mag > fMax && mag > 1e-12 ? fMax / mag : 1.0;
    const fx = fxRaw * scale;
    const fy = fyRaw * scale;
    const mz = -0.025 * fy;
    return writeWrench(slotPtr, fx, fy, fz, 0.0, 0.0, mz);
  }

  if (archetypeId == ARCH_ROAD_FLAT) {
    const z0 = getCon(slotPtr, conCount, 0, 0.0);
    const mu = getCon(slotPtr, conCount, 1, 1.0);
    const grade = getCon(slotPtr, conCount, 2, 0.0);
    const zRoad = z0 + x * Math.tan(grade);
    return writeWrench(slotPtr, zRoad, mu, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId == ARCH_ROAD_CLEAT) {
    const xStart = getCon(slotPtr, conCount, 0, 5.0);
    const length = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.2));
    const height = getCon(slotPtr, conCount, 2, 0.025);
    const ramp = Math.min(0.5 * length, Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.03)));
    const mu = getCon(slotPtr, conCount, 4, 1.0);
    const xEnd = xStart + length;
    let zRoad: f64 = 0.0;
    if (x > xStart && x < xStart + ramp) {
      zRoad = evalStep(x, xStart, 0.0, xStart + ramp, height);
    } else if (x >= xStart + ramp && x <= xEnd - ramp) {
      zRoad = height;
    } else if (x > xEnd - ramp && x < xEnd) {
      zRoad = evalStep(x, xEnd - ramp, height, xEnd, 0.0);
    }
    return writeWrench(slotPtr, zRoad, mu, 0.0, 0.0, 0.0, 0.0);
  }

  // --- 4. Joints & Constraints ---
  if (archetypeId == ARCH_CONSTRAINT_MOTION) {
    const amp = getCon(slotPtr, conCount, 0, 1.0);
    const omega = getCon(slotPtr, conCount, 1, 1.0);
    const phase = getCon(slotPtr, conCount, 2, 0.0);
    const offset = getCon(slotPtr, conCount, 3, 0.0);
    const val = Math.abs(omega) < 1e-12 ? offset + amp * t : offset + amp * Math.sin(omega * t + phase);
    return writeWrench(slotPtr, val, 0.0, 0.0, 0.0, 0.0, 0.0);
  }

  if (archetypeId >= ARCH_JOINT_REVOLUTE && archetypeId <= ARCH_JOINT_POINT_CURVE) {
    // Penalty-regularized kinematic reaction wrench on constrained coordinates
    const kP = getCon(slotPtr, conCount, 1, 1.0e7);
    const cP = getCon(slotPtr, conCount, 2, 1.0e3);
    const fx = -kP * x - cP * xdot;
    const fy = -kP * dy - cP * vy;
    const fz =
      archetypeId == ARCH_JOINT_TRANSLATIONAL || archetypeId == ARCH_JOINT_CYLINDRICAL
        ? 0.0
        : -kP * dz - cP * vz;
    const tx =
      archetypeId == ARCH_JOINT_SPHERICAL || archetypeId == ARCH_JOINT_UNIVERSAL || archetypeId == ARCH_JOINT_HOOKE
        ? 0.0
        : -kP * rx - cP * wx;
    const ty =
      archetypeId == ARCH_JOINT_SPHERICAL || archetypeId == ARCH_JOINT_UNIVERSAL || archetypeId == ARCH_JOINT_HOOKE
        ? 0.0
        : -kP * ry - cP * wy;
    const tz =
      archetypeId == ARCH_JOINT_REVOLUTE ||
      archetypeId == ARCH_JOINT_CYLINDRICAL ||
      archetypeId == ARCH_JOINT_SPHERICAL ||
      archetypeId == ARCH_JOINT_PLANAR ||
      archetypeId == ARCH_JOINT_CV
        ? 0.0
        : -kP * rz - cP * wz;
    return writeWrench(slotPtr, fx, fy, fz, tx, ty, tz);
  }

  return 0.0;
}
