// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript control-block and physical-primitive library
 * for `@modelscript/psse-std-lib` (zero-allocation linear memory).
 */

export const OFF_ICON: usize = 0x000;
export const OFF_CON: usize = 0x080;
export const OFF_STATE: usize = 0x580;
export const OFF_DSTATE: usize = 0x680;
export const OFF_IO: usize = 0x780;

export const MAX_MODEL_STATES: i32 = 24;
export const SLOT_META_NSTATES: i32 = 30;
export const SLOT_META_TMIN: i32 = 31;

// Fixed linear-memory scratch regions below memoryBase (2048) for zero-import, zero-heap Heun integration
export const SCRATCH_HEUN_Y0: usize = 0x200; // 24 * 8 = 192 bytes (0x200..0x2BF)
export const SCRATCH_HEUN_K1: usize = 0x300; // 24 * 8 = 192 bytes (0x300..0x3BF)

@inline
export function sanitize(v: f64, fallback: f64): f64 {
  return isFinite(v) ? v : fallback;
}

@inline
export function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (!isFinite(x)) return lo;
  const actualLo = lo <= hi ? lo : hi;
  const actualHi = lo <= hi ? hi : lo;
  return x < actualLo ? actualLo : x > actualHi ? actualHi : x;
}

@inline
export function getCon(conPtr: usize, count: i32, idx: i32, fallback: f64): f64 {
  if (idx < 0 || idx >= count) return fallback;
  const v = load<f64>(conPtr + ((<usize>idx) << 3));
  return isFinite(v) ? v : fallback;
}

@inline
export function getIcon(slotPtr: usize, iconCount: i32, idx: i32, fallback: i32): i32 {
  if (idx < 0 || idx >= iconCount || idx >= 32) return fallback;
  return load<i32>(slotPtr + OFF_ICON + ((<usize>idx) << 2));
}

@inline
export function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + ((<usize>idx) << 3));
}

@inline
export function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + ((<usize>idx) << 3), isFinite(v) ? v : 0.0);
}

@inline
export function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + ((<usize>idx) << 3));
}

@inline
export function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + ((<usize>idx) << 3), isFinite(v) ? v : 0.0);
}

@inline
export function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + ((<usize>idx) << 3));
}

@inline
export function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + ((<usize>idx) << 3), isFinite(v) ? v : 0.0);
}

@inline
export function setSlotMeta(slotPtr: usize, nStates: i32, tMin: f64): void {
  store<f64>(slotPtr + OFF_STATE + ((<usize>SLOT_META_NSTATES) << 3), <f64>nStates);
  store<f64>(slotPtr + OFF_STATE + ((<usize>SLOT_META_TMIN) << 3), tMin > 1e-4 ? tMin : 0.01);
}

@inline
export function getSlotNStates(slotPtr: usize): i32 {
  const n = <i32>load<f64>(slotPtr + OFF_STATE + ((<usize>SLOT_META_NSTATES) << 3));
  return n > 0 && n <= MAX_MODEL_STATES ? n : 6;
}

@inline
export function getSlotTMin(slotPtr: usize): f64 {
  const t = load<f64>(slotPtr + OFF_STATE + ((<usize>SLOT_META_TMIN) << 3));
  return isFinite(t) && t > 1e-4 ? t : 0.02;
}

/**
 * Deadband block: returns 0 inside `[lo, hi]`, else distance past the nearest boundary.
 */
@inline
export function deadband(x: f64, lo: f64, hi: f64): f64 {
  if (x > hi) return x - hi;
  if (x < lo) return x - lo;
  return 0.0;
}

/**
 * First-order lag derivative `dx/dt = (K * u - x) / T`.
 * Degenerate time constant (`T <= 1e-6`) returns 0 (algebraic pass-through).
 */
@inline
export function firstOrderLagDeriv(x: f64, u: f64, k: f64, t: f64): f64 {
  if (t <= 1e-6) return 0.0;
  return (k * u - x) / t;
}

/**
 * IEEE Std 421.5 Annex E non-windup lag limiter derivative.
 * Prevents integrator windup when `x` is at `[lo, hi]` and input drives further out of bounds.
 */
@inline
export function nonWindupLagDeriv(x: f64, u: f64, k: f64, t: f64, lo: f64, hi: f64): f64 {
  if (t <= 1e-6) return 0.0;
  const raw = (k * u - x) / t;
  if (x >= hi && raw > 0.0) return 0.0;
  if (x <= lo && raw < 0.0) return 0.0;
  return raw;
}

/**
 * IEEE Std 421.5 non-windup pure integrator derivative `dx/dt = u / T` bounded on `[lo, hi]`.
 */
@inline
export function nonWindupIntDeriv(x: f64, u: f64, t: f64, lo: f64, hi: f64): f64 {
  if (t <= 1e-6) return 0.0;
  const raw = u / t;
  if (x >= hi && raw > 0.0) return 0.0;
  if (x <= lo && raw < 0.0) return 0.0;
  return raw;
}

/**
 * Rate- and position-limited servo lag derivative (governor valves & hydro gates).
 */
@inline
export function rateLimitedServoDeriv(
  x: f64,
  u: f64,
  t: f64,
  rMin: f64,
  rMax: f64,
  yMin: f64,
  yMax: f64,
): f64 {
  const tSafe = t > 1e-4 ? t : 1e-4;
  const rate = clamp((u - x) / tSafe, rMin, rMax);
  if (x >= yMax && rate > 0.0) return 0.0;
  if (x <= yMin && rate < 0.0) return 0.0;
  return rate;
}

/**
 * Lead-lag output `y = (Tc/Tb)*u + (1 - Tc/Tb)*x` with degenerate pass-through if `Tb <= 1e-6`.
 */
@inline
export function leadLagOutput(u: f64, x: f64, tc: f64, tb: f64): f64 {
  if (tb <= 1e-6) return u;
  const ratio = tc / tb;
  return ratio * u + (1.0 - ratio) * x;
}

/**
 * Quadratic magnetic saturation `S_E(E) = B * max(0, E - A)^2 / E` calibrated from `(E1, SE1)` and `(E2, SE2)`.
 * Mirrors `computeQuadraticSatCoeffs` + `evalQuadraticSat` in `src/dae/blocks.ts`.
 */
export function evalQuadraticSat(e: f64, e1: f64, se1: f64, e2: f64, se2: f64): f64 {
  if (e <= 1e-6 || e1 <= 0.0 || e2 <= e1 || se1 <= 0.0 || se2 <= 0.0) return 0.0;
  const prod1 = e1 * se1;
  const prod2 = e2 * se2;
  let a: f64;
  let b: f64;
  if (prod2 <= prod1) {
    a = 0.8 * e1;
    const d2 = e2 - a;
    if (d2 <= 1e-6) return 0.0;
    b = prod2 / (d2 * d2);
  } else {
    const r = Math.sqrt(prod1 / prod2);
    a = (e1 - r * e2) / (1.0 - r);
    const d2 = e2 - a;
    if (d2 <= 1e-6) return 0.0;
    b = prod2 / (d2 * d2);
  }
  if (e <= a) return 0.0;
  const excess = e - a;
  return (b * excess * excess) / e;
}

/**
 * Exponential magnetic saturation `S_E(E) = A * exp(B * E)` calibrated from `(E1, SE1)` and `(E2, SE2)`
 * for `GENROE` / `GENSAE`.
 */
export function evalExponentialSat(e: f64, e1: f64, se1: f64, e2: f64, se2: f64): f64 {
  if (se1 <= 1e-9 || se2 <= 1e-9 || e2 <= e1 + 1e-6 || se2 <= se1) {
    return evalQuadraticSat(e, e1, se1, e2, se2);
  }
  const bExp = Math.log(se2 / se1) / (e2 - e1);
  const arg = clamp(bExp * (e - e1), -20.0, 20.0);
  return se1 * Math.exp(arg);
}

/**
 * IEEE Std 421.5 exact 3-mode rectifier regulation function `F_EX(I_N)` where `I_N = K_C * I_FD / V_E`.
 */
@inline
export function evalFex(inVal: f64): f64 {
  if (inVal <= 0.0) return 1.0;
  if (inVal <= 0.433) return 1.0 - 0.577 * inVal;
  if (inVal < 0.75) {
    const rad = 0.75 - inVal * inVal;
    return rad > 0.0 ? Math.sqrt(rad) : 0.0;
  }
  if (inVal <= 1.0) return 1.732 * (1.0 - inVal);
  return 0.0;
}
