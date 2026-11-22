// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared cleanroom AssemblyScript protection relay kernels for reuse across
 * `@modelscript/powerfactory`, `@modelscript/cyme`, `@modelscript/oneliner`,
 * `@modelscript/sel`, and `@modelscript/rtds`.
 *
 * Provenance: IEEE Std C37.112-2018, IEC 60255-151, IEEE Std C37.113, IEEE Std C37.91.
 */

/**
 * Evaluates IEEE C37.112-2018 / IEC 60255-151 inverse-time overcurrent trip time (seconds):
 * `t = td * (A / (M^p - 1) + B)`.
 * Returns `-1.0` when `multiple <= 1.0` (no pickup).
 *
 * Curve IDs:
 *  - 0: IEEE Moderately Inverse (U1)
 *  - 1: IEEE Very Inverse (U3)
 *  - 2: IEEE Extremely Inverse (U4)
 *  - 3: IEC Standard Inverse (C1)
 *  - 4: IEC Very Inverse (C2)
 *  - 5: IEC Extremely Inverse (C3)
 *  - 6: IEC Long-Time Inverse (C4)
 */
export function evalInverseOvercurrentTripTime(curveId: i32, multiple: f64, td: f64): f64 {
  if (multiple <= 1.0) return -1.0;
  let a: f64 = 0.0515;
  let b: f64 = 0.114;
  let p: f64 = 0.02;

  if (curveId == 1) {
    a = 19.61;
    b = 0.491;
    p = 2.0;
  } else if (curveId == 2) {
    a = 28.2;
    b = 0.1217;
    p = 2.0;
  } else if (curveId == 3) {
    a = 0.14;
    b = 0.0;
    p = 0.02;
  } else if (curveId == 4) {
    a = 13.5;
    b = 0.0;
    p = 1.0;
  } else if (curveId == 5) {
    a = 80.0;
    b = 0.0;
    p = 2.0;
  } else if (curveId == 6) {
    a = 120.0;
    b = 0.0;
    p = 1.0;
  }

  const denom = Math.pow(multiple, p) - 1.0;
  if (denom <= 1e-12) return 1e6;
  return td * (a / denom + b);
}

/**
 * Self-polarized Mho circle distance relay (ANSI 21) trip check:
 * returns `1` if apparent impedance `(r, x)` lies inside circle of diameter `(zr, zx)` through origin.
 */
export function evalMhoZoneCheck(r: f64, x: f64, zr: f64, zx: f64): i32 {
  const cr = 0.5 * zr;
  const cx = 0.5 * zx;
  const dr = r - cr;
  const dx = x - cx;
  const distSq = dr * dr + dx * dx;
  const radSq = cr * cr + cx * cx;
  return distSq <= radSq + 1e-12 ? 1 : 0;
}

/**
 * Dual-slope percentage-restraint differential relay (ANSI 87) trip check.
 * Returns `1` if `iDiff >= max(iPickup, slope1 * iRestraint)` (with 2nd-harmonic restraint blocking).
 */
export function evalDiff87Check(
  iDiff: f64,
  iRestraint: f64,
  iPickup: f64,
  slope1: f64,
  h2Ratio: f64,
  h2Block: f64,
): i32 {
  if (h2Block > 0.0 && h2Ratio >= h2Block) return 0;
  const thresh = Math.max(iPickup, slope1 * iRestraint);
  return iDiff >= thresh ? 1 : 0;
}
