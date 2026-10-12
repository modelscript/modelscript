// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Rigorous Scalar Kernel (outward-rounded interval arithmetic).
 *
 * Provides:
 *  - bit-exact `nextUp` / `nextDown`;
 *  - exactly directed `addUp/addDown/subUp/subDown` (via TwoSum error-free transform);
 *  - conservative 1-ulp outward `mul`/`div` (IEEE operations are correctly rounded, error <= 0.5 ulp);
 *  - interval enclosures of elementary functions. `Math.*` transcendental functions are NOT
 *    correctly rounded, so each endpoint evaluation is widened by {@link LIBM_SLACK_ULPS} ulps.
 *
 * Soundness contract: for every function `f` below and every real x in the input interval,
 * the true mathematical f(x) lies in the returned interval (assuming `Math.*` error <= LIBM_SLACK_ULPS - 1 ulp,
 * which holds for V8's fdlibm-derived implementations, documented < 1 ulp).
 *
 * NOT covered: values of decimal literals (callers must pass exactly-representable doubles or
 * widen the literal themselves).
 */

import { Interval } from "./wasm_interval.js";

/** ulps of slack applied around libm (`Math.*`) results. */
export const LIBM_SLACK_ULPS = 2;

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Smallest double strictly greater than x (x itself for NaN and +Infinity). */
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  f64[0] = x;
  u64[0] = x > 0 ? u64[0]! + 1n : u64[0]! - 1n;
  return f64[0]!;
}

/** Largest double strictly less than x (x itself for NaN and -Infinity). */
export function nextDown(x: number): number {
  if (Number.isNaN(x) || x === -Infinity) return x;
  if (x === 0) return -Number.MIN_VALUE;
  f64[0] = x;
  u64[0] = x > 0 ? u64[0]! - 1n : u64[0]! + 1n;
  return f64[0]!;
}

function upN(x: number, n: number): number {
  for (let i = 0; i < n; i++) x = nextUp(x);
  return x;
}

function downN(x: number, n: number): number {
  for (let i = 0; i < n; i++) x = nextDown(x);
  return x;
}

/** Rounded-toward +Infinity a + b. */
export function addUp(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s)) return s === -Infinity && Number.isFinite(a) && Number.isFinite(b) ? -Number.MAX_VALUE : s;
  const bb = s - a;
  const err = a - (s - bb) + (b - bb); // exact: a + b = s + err (TwoSum)
  return err > 0 ? nextUp(s) : s;
}

/** Rounded-toward -Infinity a + b. */
export function addDown(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s)) return s === Infinity && Number.isFinite(a) && Number.isFinite(b) ? Number.MAX_VALUE : s;
  const bb = s - a;
  const err = a - (s - bb) + (b - bb);
  return err < 0 ? nextDown(s) : s;
}

export function subUp(a: number, b: number): number {
  return addUp(a, -b);
}

export function subDown(a: number, b: number): number {
  return addDown(a, -b);
}

/** Product with the interval convention 0 * ±Infinity = 0. */
function mulPoint(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : a * b;
}

// ── Basic outward interval arithmetic ──

export function ivAdd(a: Interval, b: Interval): Interval {
  return new Interval(addDown(a.lo, b.lo), addUp(a.hi, b.hi));
}

export function ivSub(a: Interval, b: Interval): Interval {
  return new Interval(subDown(a.lo, b.hi), subUp(a.hi, b.lo));
}

export function ivNeg(a: Interval): Interval {
  return new Interval(-a.hi, -a.lo);
}

export function ivMul(a: Interval, b: Interval): Interval {
  const p1 = mulPoint(a.lo, b.lo);
  const p2 = mulPoint(a.lo, b.hi);
  const p3 = mulPoint(a.hi, b.lo);
  const p4 = mulPoint(a.hi, b.hi);
  return new Interval(nextDown(Math.min(p1, p2, p3, p4)), nextUp(Math.max(p1, p2, p3, p4)));
}

/** Division; if the divisor contains 0 the (sound) whole line is returned. */
export function ivDiv(a: Interval, b: Interval): Interval {
  if (b.lo <= 0 && b.hi >= 0) return new Interval(-Infinity, Infinity);
  const q = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi];
  return new Interval(nextDown(Math.min(...q)), nextUp(Math.max(...q)));
}

export function ivAbs(a: Interval): Interval {
  if (a.lo >= 0) return new Interval(a.lo, a.hi);
  if (a.hi <= 0) return new Interval(-a.hi, -a.lo);
  return new Interval(0, Math.max(-a.lo, a.hi));
}

/** Integer power x^n (n >= 0), outward rounded via repeated multiplication of the enclosure. */
export function ivPowInt(a: Interval, n: number): Interval {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`ivPowInt requires integer n >= 0, got ${n}`);
  if (n === 0) return new Interval(1, 1);
  if (n === 1) return new Interval(a.lo, a.hi);
  if (n % 2 === 0) {
    // even power: monotone in |x|, avoids the dependency problem of x*x*...
    const m = ivAbs(a);
    return new Interval(Math.max(0, powDown(m.lo, n)), powUp(m.hi, n));
  }
  return new Interval(powDown(a.lo, n), powUp(a.hi, n));
}

function powUp(x: number, n: number): number {
  const r = Math.pow(x, n);
  return Number.isFinite(r) ? upN(r, LIBM_SLACK_ULPS + n) : r;
}

function powDown(x: number, n: number): number {
  const r = Math.pow(x, n);
  return Number.isFinite(r) ? downN(r, LIBM_SLACK_ULPS + n) : r;
}

// ── Elementary functions ──

/** Monotone-increasing function with libm slack. */
function monotoneUp(f: (x: number) => number, a: Interval, domainLo = -Infinity): Interval {
  const lo = Math.max(a.lo, domainLo);
  const rlo = f(lo);
  const rhi = f(a.hi);
  return new Interval(downN(rlo, LIBM_SLACK_ULPS), upN(rhi, LIBM_SLACK_ULPS));
}

export function ivExp(a: Interval): Interval {
  const r = monotoneUp(Math.exp, a);
  return new Interval(Math.max(0, r.lo), r.hi);
}

/** Natural log; the part of the interval with x <= 0 is outside the domain and dropped (lo -> -Infinity at 0). */
export function ivLog(a: Interval): Interval {
  if (a.hi <= 0) return new Interval(NaN, NaN);
  const lo = a.lo <= 0 ? -Infinity : downN(Math.log(a.lo), LIBM_SLACK_ULPS);
  return new Interval(lo, upN(Math.log(a.hi), LIBM_SLACK_ULPS));
}

/** Square root (correctly rounded by IEEE), negative part clipped. */
export function ivSqrt(a: Interval): Interval {
  if (a.hi < 0) return new Interval(NaN, NaN);
  const lo = a.lo <= 0 ? 0 : nextDown(Math.sqrt(a.lo));
  return new Interval(Math.max(0, lo), nextUp(Math.sqrt(a.hi)));
}

export function ivAtan(a: Interval): Interval {
  return monotoneUp(Math.atan, a);
}

export function ivTanh(a: Interval): Interval {
  const r = monotoneUp(Math.tanh, a);
  return new Interval(Math.max(-1, r.lo), Math.min(1, r.hi));
}

const TWO_PI = 2 * Math.PI;

/** True if [lo, hi] may contain a point c + k*pi (conservative: errs toward true). */
function mayContainCritical(lo: number, hi: number, c: number): boolean {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return true;
  // Inflate to absorb the rounding error of the floating-point pi and of the division.
  const scale = Math.max(1, Math.abs(lo), Math.abs(hi));
  const eps = scale * 2 ** -45;
  const kLo = Math.ceil((lo - eps - c) / Math.PI);
  const kHi = Math.floor((hi + eps - c) / Math.PI);
  return kLo <= kHi;
}

/** Parity of the critical point nearest in the interval: even k -> sin max (+1), odd k -> sin min (-1). */
function criticalKinds(lo: number, hi: number, c: number): { hasMax: boolean; hasMin: boolean } {
  const scale = Math.max(1, Math.abs(lo), Math.abs(hi));
  const eps = scale * 2 ** -45;
  const kLo = Math.ceil((lo - eps - c) / Math.PI);
  const kHi = Math.floor((hi + eps - c) / Math.PI);
  if (kLo > kHi) return { hasMax: false, hasMin: false };
  if (kHi - kLo >= 1) return { hasMax: true, hasMin: true };
  const even = Math.abs(kLo % 2) === 0;
  return { hasMax: even, hasMin: !even };
}

export function ivSin(a: Interval): Interval {
  if (!Number.isFinite(a.lo) || !Number.isFinite(a.hi) || a.hi - a.lo >= TWO_PI) return new Interval(-1, 1);
  const s1 = Math.sin(a.lo);
  const s2 = Math.sin(a.hi);
  let lo = downN(Math.min(s1, s2), LIBM_SLACK_ULPS);
  let hi = upN(Math.max(s1, s2), LIBM_SLACK_ULPS);
  const { hasMax, hasMin } = criticalKinds(a.lo, a.hi, Math.PI / 2);
  if (hasMax) hi = 1;
  if (hasMin) lo = -1;
  return new Interval(Math.max(-1, lo), Math.min(1, hi));
}

export function ivCos(a: Interval): Interval {
  if (!Number.isFinite(a.lo) || !Number.isFinite(a.hi) || a.hi - a.lo >= TWO_PI) return new Interval(-1, 1);
  const c1 = Math.cos(a.lo);
  const c2 = Math.cos(a.hi);
  let lo = downN(Math.min(c1, c2), LIBM_SLACK_ULPS);
  let hi = upN(Math.max(c1, c2), LIBM_SLACK_ULPS);
  // cos extremes at k*pi: even k -> +1, odd k -> -1
  const { hasMax, hasMin } = criticalKinds(a.lo, a.hi, 0);
  if (hasMax) hi = 1;
  if (hasMin) lo = -1;
  return new Interval(Math.max(-1, lo), Math.min(1, hi));
}

/** tan; any interval that may contain a pole pi/2 + k*pi yields the whole line. */
export function ivTan(a: Interval): Interval {
  if (mayContainCritical(a.lo, a.hi, Math.PI / 2)) return new Interval(-Infinity, Infinity);
  return monotoneUp(Math.tan, a);
}
