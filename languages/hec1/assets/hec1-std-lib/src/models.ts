// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript hydrologic runtime for `@modelscript/hec1-std-lib`.
 *
 * Implements public-domain USDA NRCS TR-55 / USACE HEC-1 (1968) hydrologic kernels:
 *   - SCS Curve Number rainfall-excess: Q = (P - Ia)^2 / (P - Ia + S)
 *   - Clark linear-reservoir routing step
 *   - Muskingum single-subreach routing step (C0 + C1 + C2 = 1)
 *   - Snyder synthetic peak discharge
 */

/**
 * Computes SCS Curve Number cumulative rainfall-excess Q.
 * @param p Cumulative precipitation (in if metric=0, mm if metric=1)
 * @param cn SCS Curve Number in (0, 100]
 * @param iaOverride Initial abstraction; pass < 0 to use default 0.2 * S
 * @param metric 0 for English (in), 1 for Metric (mm)
 */
export function scsExcessRunoff(p: f64, cn: f64, iaOverride: f64, metric: i32): f64 {
  if (p <= 0.0) return 0.0;
  let safeCn: f64 = cn;
  if (safeCn < 1e-6) safeCn = 1e-6;
  if (safeCn > 100.0) safeCn = 100.0;

  const s: f64 = metric !== 0 ? 25400.0 / safeCn - 254.0 : 1000.0 / safeCn - 10.0;
  const ia: f64 = iaOverride >= 0.0 ? iaOverride : 0.2 * s;
  if (p <= ia) return 0.0;

  const excess: f64 = p - ia;
  const denom: f64 = excess + s;
  return denom > 0.0 ? (excess * excess) / denom : excess;
}

/**
 * Computes one Muskingum channel routing step for a single subreach.
 */
export function muskingumStep(iCurr: f64, iPrev: f64, oPrev: f64, kSub: f64, x: f64, dt: f64): f64 {
  let safeX: f64 = x;
  if (safeX < 0.0) safeX = 0.0;
  if (safeX > 0.5) safeX = 0.5;
  const safeK: f64 = kSub > 1e-9 ? kSub : 1e-9;

  const denom: f64 = 2.0 * safeK * (1.0 - safeX) + dt;
  const c0: f64 = (dt - 2.0 * safeK * safeX) / denom;
  const c1: f64 = (dt + 2.0 * safeK * safeX) / denom;
  const c2: f64 = (2.0 * safeK * (1.0 - safeX) - dt) / denom;
  return c0 * iCurr + c1 * iPrev + c2 * oPrev;
}

/**
 * Computes one Clark linear-reservoir routing step:
 *   O_i = c * I_i + (1 - c) * O_{i-1},  c = dt / (R + 0.5 * dt)
 */
export function clarkReservoirStep(inflow: f64, oPrev: f64, r: f64, dt: f64): f64 {
  const safeR: f64 = r > 1e-6 ? r : 1e-6;
  const c: f64 = dt / (safeR + 0.5 * dt);
  return c * inflow + (1.0 - c) * oPrev;
}

/**
 * Computes Snyder synthetic unit hydrograph peak discharge q_p.
 */
export function snyderPeakDischarge(area: f64, tp: f64, cp: f64, metric: i32): f64 {
  const safeTp: f64 = tp > 1e-6 ? tp : 1e-6;
  const coeff: f64 = metric !== 0 ? 0.275 : 640.0;
  return (coeff * cp * area) / safeTp;
}
