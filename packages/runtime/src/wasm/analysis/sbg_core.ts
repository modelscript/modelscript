// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Set-Based Graph (SBG) Strided Integer Interval Core Kernels.
 * Implements O(log(step)) extended-GCD diophantine intersection and batch
 * Multi-Dimensional Interval (MDI) intersection in WASM linear memory.
 */

@inline
function i64Abs(x: i64): i64 {
  return x < 0 ? -x : x;
}

@inline
function floorDiv(a: i64, b: i64): i64 {
  const q = a / b;
  const r = a % b;
  return (r != 0 && ((a < 0) != (b < 0))) ? q - 1 : q;
}

@inline
function ceilDiv(a: i64, b: i64): i64 {
  const q = a / b;
  const r = a % b;
  return (r != 0 && ((a > 0) == (b > 0))) ? q + 1 : q;
}

/**
 * Intersects two 1D strided intervals [lo1, step1, hi1] and [lo2, step2, hi2].
 * Writes resulting [lo, step, hi] to `outPtr` (3 x i32) and returns 1 if non-empty, 0 if empty.
 */
export function sbg_intervalIntersect(
  lo1: i32,
  step1: i32,
  hi1: i32,
  lo2: i32,
  step2: i32,
  hi2: i32,
  outPtr: usize,
): i32 {
  if (lo1 > hi1 || lo2 > hi2 || step1 <= 0 || step2 <= 0) return 0;

  // Extended Euclidean algorithm: g = s1*x + s2*y
  let oldR: i64 = <i64>step1;
  let r: i64 = <i64>step2;
  let oldS: i64 = 1;
  let s: i64 = 0;
  while (r != 0) {
    const q = oldR / r;
    const tmpR = r;
    r = oldR - q * r;
    oldR = tmpR;
    const tmpS = s;
    s = oldS - q * s;
    oldS = tmpS;
  }

  const g = oldR;
  const diff: i64 = <i64>lo2 - <i64>lo1;
  if (diff % g != 0) return 0;

  const lcmStep: i64 = (<i64>step1 / g) * <i64>step2;
  const k0: i64 = (diff / g) * oldS;
  let firstVal: i64 = <i64>lo1 + <i64>step1 * k0;

  const minBound: i64 = lo1 > lo2 ? <i64>lo1 : <i64>lo2;
  const maxBound: i64 = hi1 < hi2 ? <i64>hi1 : <i64>hi2;
  if (minBound > maxBound) return 0;

  // Shift firstVal into [minBound, minBound + lcmStep - 1]
  const shift = ceilDiv(minBound - firstVal, lcmStep);
  const resLo = firstVal + shift * lcmStep;
  if (resLo > maxBound) return 0;

  const countSteps = floorDiv(maxBound - resLo, lcmStep);
  const resHi = resLo + countSteps * lcmStep;

  store<i32>(outPtr, <i32>resLo);
  store<i32>(outPtr + 4, <i32>lcmStep);
  store<i32>(outPtr + 8, <i32>resHi);
  return 1;
}

/**
 * Batch-intersects two d-dimensional Multi-Intervals (each stored as d x [lo, step, hi] i32 triples).
 * Writes resulting d triples to `outPtr`. Returns 1 if non-empty, 0 if empty in any dimension.
 */
export function sbg_mdiIntersect(
  aPtr: usize,
  bPtr: usize,
  dims: i32,
  outPtr: usize,
): i32 {
  for (let d: i32 = 0; d < dims; d++) {
    const off = <usize>(d * 12);
    const ok = sbg_intervalIntersect(
      load<i32>(aPtr + off),
      load<i32>(aPtr + off + 4),
      load<i32>(aPtr + off + 8),
      load<i32>(bPtr + off),
      load<i32>(bPtr + off + 4),
      load<i32>(bPtr + off + 8),
      outPtr + off,
    );
    if (ok == 0) return 0;
  }
  return 1;
}
