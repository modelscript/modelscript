// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Probability Box (P-Box) & Dempster-Shafer Focal Interval Kernels:
 * - Independent Cartesian focal combination (add, sub, mul, div) with bit-exact IEEE-754 outward rounding
 * - Sound probability bounds P(X op threshold) and P(lo <= X <= hi)
 * - Sound outward-rounded mean bounds
 */

@inline
function pbNextUp(x: f64): f64 {
  if (isNaN(x) || x == Infinity) return x;
  if (x == 0.0) return reinterpret<f64>(1 as u64);
  const bits = reinterpret<u64>(x);
  return reinterpret<f64>(x > 0.0 ? bits + 1 : bits - 1);
}

@inline
function pbNextDown(x: f64): f64 {
  if (isNaN(x) || x == -Infinity) return x;
  if (x == 0.0) return reinterpret<f64>(0x8000000000000001 as u64);
  const bits = reinterpret<u64>(x);
  return reinterpret<f64>(x > 0.0 ? bits - 1 : bits + 1);
}

/**
 * Independent Cartesian combination of two Dempster-Shafer focal sets A (nA) and B (nB).
 * opCode: 0 = add, 1 = sub, 2 = mul, 3 = div.
 * Writes nA * nB focal elements into outLoPtr, outHiPtr, outMassPtr.
 * Returns total focal count written (nA * nB).
 */
export function pbox_combineIndependent(
  aLoPtr: usize,
  aHiPtr: usize,
  aMassPtr: usize,
  nA: i32,
  bLoPtr: usize,
  bHiPtr: usize,
  bMassPtr: usize,
  nB: i32,
  opCode: i32,
  outLoPtr: usize,
  outHiPtr: usize,
  outMassPtr: usize,
): i32 {
  let outIdx: i32 = 0;
  for (let i: i32 = 0; i < nA; i++) {
    const aLo = load<f64>(aLoPtr + (<usize>i << 3));
    const aHi = load<f64>(aHiPtr + (<usize>i << 3));
    const aM = load<f64>(aMassPtr + (<usize>i << 3));

    for (let j: i32 = 0; j < nB; j++) {
      const bLo = load<f64>(bLoPtr + (<usize>j << 3));
      const bHi = load<f64>(bHiPtr + (<usize>j << 3));
      const bM = load<f64>(bMassPtr + (<usize>j << 3));

      let rLo: f64 = 0.0;
      let rHi: f64 = 0.0;

      if (opCode == 0) {
        // add
        rLo = pbNextDown(aLo + bLo);
        rHi = pbNextUp(aHi + bHi);
      } else if (opCode == 1) {
        // sub
        rLo = pbNextDown(aLo - bHi);
        rHi = pbNextUp(aHi - bLo);
      } else if (opCode == 2) {
        // mul
        const p1 = aLo * bLo;
        const p2 = aLo * bHi;
        const p3 = aHi * bLo;
        const p4 = aHi * bHi;
        rLo = pbNextDown(Math.min(Math.min(p1, p2), Math.min(p3, p4)));
        rHi = pbNextUp(Math.max(Math.max(p1, p2), Math.max(p3, p4)));
      } else {
        // div
        if (bLo <= 0.0 && bHi >= 0.0) {
          rLo = -Infinity;
          rHi = Infinity;
        } else {
          const q1 = aLo / bLo;
          const q2 = aLo / bHi;
          const q3 = aHi / bLo;
          const q4 = aHi / bHi;
          rLo = pbNextDown(Math.min(Math.min(q1, q2), Math.min(q3, q4)));
          rHi = pbNextUp(Math.max(Math.max(q1, q2), Math.max(q3, q4)));
        }
      }

      const off = (<usize>outIdx) << 3;
      store<f64>(outLoPtr + off, rLo);
      store<f64>(outHiPtr + off, rHi);
      store<f64>(outMassPtr + off, aM * bM);
      outIdx++;
    }
  }
  return outIdx;
}

/**
 * Computes sound probability bounds [pMin, pMax] for P(X op threshold).
 * opCode: 0 = '>', 1 = '>=', 2 = '<', 3 = '<='.
 */
export function pbox_probBound(
  loPtr: usize,
  hiPtr: usize,
  massPtr: usize,
  n: i32,
  opCode: i32,
  threshold: f64,
  outBoundsPtr: usize,
): void {
  let pMin: f64 = 0.0;
  let pMax: f64 = 0.0;

  for (let i: i32 = 0; i < n; i++) {
    const off = (<usize>i) << 3;
    const lo = load<f64>(loPtr + off);
    const hi = load<f64>(hiPtr + off);
    const mass = load<f64>(massPtr + off);

    let alwaysTrue: bool = false;
    let possiblyTrue: bool = false;
    if (opCode == 0) {
      alwaysTrue = lo > threshold;
      possiblyTrue = hi > threshold;
    } else if (opCode == 1) {
      alwaysTrue = lo >= threshold;
      possiblyTrue = hi >= threshold;
    } else if (opCode == 2) {
      alwaysTrue = hi < threshold;
      possiblyTrue = lo < threshold;
    } else {
      alwaysTrue = hi <= threshold;
      possiblyTrue = lo <= threshold;
    }

    if (alwaysTrue) pMin += mass;
    if (possiblyTrue) pMax += mass;
  }

  if (pMin < 0.0) pMin = 0.0;
  else if (pMin > 1.0) pMin = 1.0;
  if (pMax < 0.0) pMax = 0.0;
  else if (pMax > 1.0) pMax = 1.0;

  store<f64>(outBoundsPtr, pMin);
  store<f64>(outBoundsPtr + 8, pMax);
}

/**
 * Computes sound outward-rounded mean bounds [lo, hi].
 */
export function pbox_meanBounds(
  loPtr: usize,
  hiPtr: usize,
  massPtr: usize,
  n: i32,
  outBoundsPtr: usize,
): void {
  let lo: f64 = 0.0;
  let hi: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const off = (<usize>i) << 3;
    const m = load<f64>(massPtr + off);
    lo += m * load<f64>(loPtr + off);
    hi += m * load<f64>(hiPtr + off);
  }
  store<f64>(outBoundsPtr, isFinite(lo) ? pbNextDown(lo) : lo);
  store<f64>(outBoundsPtr + 8, isFinite(hi) ? pbNextUp(hi) : hi);
}
