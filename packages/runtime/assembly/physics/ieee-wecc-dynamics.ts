// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared cleanroom AssemblyScript IEEE/WECC power-system dynamic equations
 * for reuse across `@modelscript/psse`, `@modelscript/pslf`, `@modelscript/powerworld`,
 * `@modelscript/powerfactory`, and `@modelscript/rtds`.
 *
 * Provenance: IEEE Std 1110, IEEE Std 421.5-2016, IEEE 1992 Hydraulic Turbine WG,
 * WECC Second-Generation IBR & Composite Load (CMPLDW) Specifications.
 */

@inline
export function clampF64(x: f64, lo: f64, hi: f64): f64 {
  if (!isFinite(x)) return lo;
  const actualLo = lo <= hi ? lo : hi;
  const actualHi = lo <= hi ? hi : lo;
  if (x < actualLo) return actualLo;
  if (x > actualHi) return actualHi;
  return x;
}

/**
 * IEEE Std 1110 / 421.5-2016 quadratic magnetic saturation `S(x) = B * (x - A)^2 / x`
 * fitted through `(1.0, s10)` and `(1.2, s12)`.
 */
export function evalIeeeQuadraticSat(x: f64, s10: f64, s12: f64): f64 {
  if (s10 <= 1e-9 || s12 <= 1e-9 || x <= 0.0) return 0.0;
  const r = Math.sqrt((1.2 * s12) / s10);
  if (r <= 1.0001) return 0.0;
  const a = (1.2 - r) / (1.0 - r);
  const denom = (1.0 - a) * (1.0 - a);
  if (denom <= 1e-12 || x <= a) return 0.0;
  const b = s10 / denom;
  const dx = x - a;
  return (b * dx * dx) / x;
}

/**
 * IEEE Std 421.5-2016 general 2-point quadratic magnetic saturation `S_E(E) = B * max(0, E - A)^2 / E`
 * calibrated through `(e1, se1)` and `(e2, se2)` for DC/AC rotating exciters.
 */
export function evalIeeeQuadraticSat2Pt(e: f64, e1: f64, se1: f64, e2: f64, se2: f64): f64 {
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
 * IEEE Std 421.5-2016 exact 3-mode rectifier regulation function `F_EX(I_N)`
 * where `I_N = K_C * I_FD / V_E`.
 */
@inline
export function evalIeeeRectifierFex(inVal: f64): f64 {
  if (inVal <= 0.0) return 1.0;
  if (inVal <= 0.433) return 1.0 - 0.577 * inVal;
  if (inVal < 0.75) {
    const rad = 0.75 - inVal * inVal;
    return rad > 0.0 ? Math.sqrt(rad) : 0.0;
  }
  if (inVal <= 1.0) return 1.732 * (1.0 - inVal);
  return 0.0;
}

/**
 * Classical synchronous machine swing acceleration `d(dw)/dt = (pmech - pelec - D*dw) / (2*H)`.
 */
@inline
export function evalSwingAccel(pmech: f64, pelec: f64, dw: f64, h: f64, d: f64): f64 {
  const hSafe = h > 0.1 ? h : 0.1;
  return (pmech - pelec - d * dw) / (2.0 * hSafe);
}

/**
 * WECC REGC_A Low-Voltage Active Power Management (LVPL) scaling factor in `[0, 1]`.
 */
@inline
export function evalWeccLvplScale(vterm: f64, zerox: f64, brkpt: f64): f64 {
  if (vterm >= brkpt) return 1.0;
  if (vterm <= zerox || brkpt <= zerox + 1e-9) return 0.0;
  return clampF64((vterm - zerox) / (brkpt - zerox), 0.0, 1.0);
}

/**
 * WECC CMPLDW power-electronic load linear voltage-drop scaling factor in `[0, 1]`.
 * Full load above `vd1`, linear drop between `vd1` and `vd2`, zero below `vd2`.
 */
@inline
export function evalElectronicLoadScale(vterm: f64, vd1: f64, vd2: f64): f64 {
  if (vterm >= vd1) return 1.0;
  if (vterm <= vd2 || vd1 <= vd2 + 1e-9) return 0.0;
  return clampF64((vterm - vd2) / (vd1 - vd2), 0.0, 1.0);
}

/**
 * First-order lag derivative `dx/dt = (K * u - x) / T` with degenerate pass-through for `T <= 1e-6`.
 */
@inline
export function firstOrderLagDeriv(x: f64, u: f64, k: f64, t: f64): f64 {
  if (t <= 1e-6) return 0.0;
  return (k * u - x) / t;
}

/**
 * IEEE Std 421.5 Annex E non-windup lag limiter derivative.
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
  const rate = clampF64((u - x) / tSafe, rMin, rMax);
  if (x >= yMax && rate > 0.0) return 0.0;
  if (x <= yMin && rate < 0.0) return 0.0;
  return rate;
}

/**
 * Lead-lag output `y = (Tc/Tb)*u + (1 - Tc/Tb)*x` with degenerate pass-through when `Tb <= 1e-6`.
 */
@inline
export function leadLagOutput(u: f64, x: f64, tc: f64, tb: f64): f64 {
  if (tb <= 1e-6) return u;
  const ratio = tc / tb;
  return ratio * u + (1.0 - ratio) * x;
}
