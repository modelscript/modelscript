// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical IEEE-754 outward-rounded interval arithmetic kernel.
 *
 * Uses fast 32-bit Uint32Array word manipulation for `nextUp`/`nextDown` (zero BigInt
 * allocation overhead) and Dekker/Knuth error-free transformations with overflow guards.
 */

const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);

// Detect endianness once at module load (little-endian on x86/ARM/WASM)
_f64[0] = 1.0;
const _IS_LE = _u32[1] === 0x3ff00000;
const _LO_IDX = _IS_LE ? 0 : 1;
const _HI_IDX = _IS_LE ? 1 : 0;

/** Returns the least IEEE-754 float64 strictly greater than `x` (or `x` if `+Infinity` / `NaN`). */
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  _f64[0] = x;
  let lo = _u32[_LO_IDX]!;
  let hi = _u32[_HI_IDX]!;
  if (x > 0) {
    lo = (lo + 1) >>> 0;
    if (lo === 0) hi = (hi + 1) >>> 0;
  } else {
    if (lo === 0) hi = (hi - 1) >>> 0;
    lo = (lo - 1) >>> 0;
  }
  _u32[_LO_IDX] = lo;
  _u32[_HI_IDX] = hi;
  const r = _f64[0]!;
  return r === 0 ? 0 : r;
}

/** Returns the greatest IEEE-754 float64 strictly less than `x` (or `x` if `-Infinity` / `NaN`). */
export function nextDown(x: number): number {
  if (Number.isNaN(x) || x === -Infinity) return x;
  if (x === 0) return -Number.MIN_VALUE;
  _f64[0] = x;
  let lo = _u32[_LO_IDX]!;
  let hi = _u32[_HI_IDX]!;
  if (x > 0) {
    if (lo === 0) hi = (hi - 1) >>> 0;
    lo = (lo - 1) >>> 0;
  } else {
    lo = (lo + 1) >>> 0;
    if (lo === 0) hi = (hi + 1) >>> 0;
  }
  _u32[_LO_IDX] = lo;
  _u32[_HI_IDX] = hi;
  const r = _f64[0]!;
  return r === 0 ? 0 : r;
}

/** Outward-rounded sum toward +Infinity with TwoSum overflow protection. */
export function addUp(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s) || !Number.isFinite(a) || !Number.isFinite(b)) return s;
  const bb = s - a;
  if (!Number.isFinite(bb)) return nextUp(s);
  const err = a - (s - bb) + (b - bb);
  if (Number.isNaN(err) || err > 0) return nextUp(s);
  return s;
}

/** Outward-rounded sum toward -Infinity with TwoSum overflow protection. */
export function addDown(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s) || !Number.isFinite(a) || !Number.isFinite(b)) return s;
  const bb = s - a;
  if (!Number.isFinite(bb)) return nextDown(s);
  const err = a - (s - bb) + (b - bb);
  if (Number.isNaN(err) || err < 0) return nextDown(s);
  return s;
}

export function subUp(a: number, b: number): number {
  return addUp(a, -b);
}

export function subDown(a: number, b: number): number {
  return addDown(a, -b);
}

/** IEEE-754 interval multiplication helper: `0 * +/-Infinity = 0` by interval convention. */
function mulBound(a: number, b: number, up: boolean): number {
  if (a === 0 || b === 0) return 0;
  const p = a * b;
  if (!Number.isFinite(p)) return p;
  return up ? nextUp(p) : nextDown(p);
}

function divBound(a: number, b: number, up: boolean): number {
  if (a === 0) return 0;
  if (!Number.isFinite(b)) return 0;
  const q = a / b;
  if (!Number.isFinite(q)) return q;
  return up ? nextUp(q) : nextDown(q);
}

/** Conservative libm ULP slack for transcendental functions (V8/SpiderMonkey/JSC). */
const LIBM_ULPS = 2;

function bumpUp(x: number, ulps: number): number {
  let r = x;
  for (let i = 0; i < ulps; i++) r = nextUp(r);
  return r;
}

function bumpDown(x: number, ulps: number): number {
  let r = x;
  for (let i = 0; i < ulps; i++) r = nextDown(r);
  return r;
}

/**
 * Immutable, outward-rounded closed interval `[lo, hi]` with explicit empty (`BOTTOM`)
 * and unbounded (`TOP`) lattice representations.
 */
export class OutwardInterval {
  public readonly lo: number;
  public readonly hi: number;
  public readonly isEmpty: boolean;

  private constructor(lo: number, hi: number, isEmpty: boolean) {
    this.lo = lo;
    this.hi = hi;
    this.isEmpty = isEmpty;
  }

  public static readonly EMPTY = new OutwardInterval(Infinity, -Infinity, true);
  public static readonly ENTIRE = new OutwardInterval(-Infinity, Infinity, false);
  public static readonly ZERO = new OutwardInterval(0, 0, false);
  public static readonly ONE = new OutwardInterval(1, 1, false);

  /** Constructs a closed interval `[lo, hi]`. Returns `EMPTY` if `lo > hi` or either bound is `NaN`. */
  public static of(lo: number, hi: number): OutwardInterval {
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) {
      return OutwardInterval.EMPTY;
    }
    return new OutwardInterval(lo, hi, false);
  }

  /** Constructs a point interval `[v, v]`. */
  public static point(v: number): OutwardInterval {
    if (Number.isNaN(v)) return OutwardInterval.EMPTY;
    return new OutwardInterval(v, v, false);
  }

  public get isEntire(): boolean {
    return !this.isEmpty && this.lo === -Infinity && this.hi === Infinity;
  }

  public get isFinite(): boolean {
    return !this.isEmpty && Number.isFinite(this.lo) && Number.isFinite(this.hi);
  }

  public get mid(): number {
    if (this.isEmpty) return NaN;
    if (this.lo === -Infinity && this.hi === Infinity) return 0;
    if (this.lo === -Infinity) return -Number.MAX_VALUE;
    if (this.hi === Infinity) return Number.MAX_VALUE;
    return this.lo * 0.5 + this.hi * 0.5;
  }

  public get width(): number {
    if (this.isEmpty) return 0;
    return subUp(this.hi, this.lo);
  }

  public get radius(): number {
    if (this.isEmpty) return 0;
    const m = this.mid;
    return Math.max(subUp(this.hi, m), subUp(m, this.lo));
  }

  public contains(x: number): boolean {
    return !this.isEmpty && x >= this.lo && x <= this.hi;
  }

  public containsZero(): boolean {
    return this.contains(0);
  }

  public isSubsetOf(other: OutwardInterval): boolean {
    if (this.isEmpty) return true;
    if (other.isEmpty) return false;
    return this.lo >= other.lo && this.hi <= other.hi;
  }

  public equals(other: OutwardInterval): boolean {
    if (this.isEmpty && other.isEmpty) return true;
    if (this.isEmpty !== other.isEmpty) return false;
    return this.lo === other.lo && this.hi === other.hi;
  }

  // ── Lattice Operations ──

  public join(other: OutwardInterval): OutwardInterval {
    if (this.isEmpty) return other;
    if (other.isEmpty) return this;
    return OutwardInterval.of(Math.min(this.lo, other.lo), Math.max(this.hi, other.hi));
  }

  public meet(other: OutwardInterval): OutwardInterval {
    if (this.isEmpty || other.isEmpty) return OutwardInterval.EMPTY;
    return OutwardInterval.of(Math.max(this.lo, other.lo), Math.min(this.hi, other.hi));
  }

  public widen(next: OutwardInterval, thresholds?: readonly number[]): OutwardInterval {
    if (this.isEmpty) return next;
    if (next.isEmpty) return this;

    let lo = this.lo;
    if (next.lo < this.lo) {
      lo = -Infinity;
      if (thresholds && thresholds.length > 0) {
        let best = -Infinity;
        for (const t of thresholds) {
          if (t <= next.lo && t > best) best = t;
        }
        lo = best;
      }
    }

    let hi = this.hi;
    if (next.hi > this.hi) {
      hi = Infinity;
      if (thresholds && thresholds.length > 0) {
        let best = Infinity;
        for (const t of thresholds) {
          if (t >= next.hi && t < best) best = t;
        }
        hi = best;
      }
    }

    return OutwardInterval.of(lo, hi);
  }

  public narrow(next: OutwardInterval): OutwardInterval {
    if (this.isEmpty || next.isEmpty) return OutwardInterval.EMPTY;
    const lo = this.lo === -Infinity ? next.lo : this.lo;
    const hi = this.hi === Infinity ? next.hi : this.hi;
    return OutwardInterval.of(lo, hi);
  }

  // ── Outward-Rounded Arithmetic ──

  public neg(): OutwardInterval {
    if (this.isEmpty) return OutwardInterval.EMPTY;
    return OutwardInterval.of(-this.hi, -this.lo);
  }

  public abs(): OutwardInterval {
    if (this.isEmpty) return OutwardInterval.EMPTY;
    if (this.lo >= 0) return this;
    if (this.hi <= 0) return this.neg();
    return OutwardInterval.of(0, Math.max(-this.lo, this.hi));
  }

  public add(other: OutwardInterval): OutwardInterval {
    if (this.isEmpty || other.isEmpty) return OutwardInterval.EMPTY;
    return OutwardInterval.of(addDown(this.lo, other.lo), addUp(this.hi, other.hi));
  }

  public sub(other: OutwardInterval): OutwardInterval {
    if (this.isEmpty || other.isEmpty) return OutwardInterval.EMPTY;
    return OutwardInterval.of(subDown(this.lo, other.hi), subUp(this.hi, other.lo));
  }

  public mul(other: OutwardInterval): OutwardInterval {
    if (this.isEmpty || other.isEmpty) return OutwardInterval.EMPTY;
    const lo = Math.min(
      mulBound(this.lo, other.lo, false),
      mulBound(this.lo, other.hi, false),
      mulBound(this.hi, other.lo, false),
      mulBound(this.hi, other.hi, false),
    );
    const hi = Math.max(
      mulBound(this.lo, other.lo, true),
      mulBound(this.lo, other.hi, true),
      mulBound(this.hi, other.lo, true),
      mulBound(this.hi, other.hi, true),
    );
    return OutwardInterval.of(lo, hi);
  }

  public div(other: OutwardInterval): OutwardInterval {
    if (this.isEmpty || other.isEmpty) return OutwardInterval.EMPTY;
    if (other.lo === 0 && other.hi === 0) return OutwardInterval.EMPTY;
    if (other.lo < 0 && other.hi > 0) return OutwardInterval.ENTIRE;

    if (other.lo === 0) {
      // other is [0, hi] with hi > 0
      if (this.lo === 0 && this.hi === 0) return OutwardInterval.ZERO;
      if (this.lo >= 0) return OutwardInterval.of(divBound(this.lo, other.hi, false), Infinity);
      if (this.hi <= 0) return OutwardInterval.of(-Infinity, divBound(this.hi, other.hi, true));
      return OutwardInterval.ENTIRE;
    }

    if (other.hi === 0) {
      // other is [lo, 0] with lo < 0
      if (this.lo === 0 && this.hi === 0) return OutwardInterval.ZERO;
      if (this.lo >= 0) return OutwardInterval.of(-Infinity, divBound(this.lo, other.lo, true));
      if (this.hi <= 0) return OutwardInterval.of(divBound(this.hi, other.lo, false), Infinity);
      return OutwardInterval.ENTIRE;
    }

    // 0 not in other; handle unbounded/unbounded without NaN
    if (!Number.isFinite(this.lo) || !Number.isFinite(this.hi)) {
      if (!Number.isFinite(other.lo) || !Number.isFinite(other.hi)) {
        // Compute signs conservatively
        const sPos = other.lo > 0;
        if (this.lo >= 0) return sPos ? OutwardInterval.of(0, Infinity) : OutwardInterval.of(-Infinity, 0);
        if (this.hi <= 0) return sPos ? OutwardInterval.of(-Infinity, 0) : OutwardInterval.of(0, Infinity);
        return OutwardInterval.ENTIRE;
      }
    }

    const lo = Math.min(
      divBound(this.lo, other.lo, false),
      divBound(this.lo, other.hi, false),
      divBound(this.hi, other.lo, false),
      divBound(this.hi, other.hi, false),
    );
    const hi = Math.max(
      divBound(this.lo, other.lo, true),
      divBound(this.lo, other.hi, true),
      divBound(this.hi, other.lo, true),
      divBound(this.hi, other.hi, true),
    );
    return OutwardInterval.of(lo, hi);
  }

  public sqr(): OutwardInterval {
    if (this.isEmpty) return OutwardInterval.EMPTY;
    if (this.lo >= 0) return OutwardInterval.of(mulBound(this.lo, this.lo, false), mulBound(this.hi, this.hi, true));
    if (this.hi <= 0) return OutwardInterval.of(mulBound(this.hi, this.hi, false), mulBound(this.lo, this.lo, true));
    const maxAbs = Math.max(-this.lo, this.hi);
    return OutwardInterval.of(0, mulBound(maxAbs, maxAbs, true));
  }

  /** Fast O(log n) outward-rounded integer power. */
  public powInt(n: number): OutwardInterval {
    if (this.isEmpty) return OutwardInterval.EMPTY;
    if (!Number.isInteger(n)) return OutwardInterval.ENTIRE;
    if (n === 0) return OutwardInterval.ONE;
    if (n === 1) return this;
    if (n === 2) return this.sqr();
    if (n < 0) return OutwardInterval.ONE.div(this.powInt(-n));

    if (this.lo === 0 && this.hi === 0) return OutwardInterval.ZERO;

    // Exponentiation by squaring using exact monotonic bounds
    const powPos = (base: OutwardInterval, exp: number): OutwardInterval => {
      let acc = OutwardInterval.ONE;
      let cur = base;
      let e = exp;
      while (e > 0) {
        if ((e & 1) === 1) acc = acc.mul(cur);
        e >>= 1;
        if (e > 0) cur = cur.sqr();
      }
      return acc;
    };

    if (n % 2 === 0 && this.lo < 0 && this.hi > 0) {
      const hi = powPos(OutwardInterval.point(Math.max(-this.lo, this.hi)), n).hi;
      return OutwardInterval.of(0, hi);
    }
    return powPos(this, n);
  }

  public sqrt(): OutwardInterval {
    if (this.isEmpty || this.hi < 0) return OutwardInterval.EMPTY;
    const clampedLo = Math.max(0, this.lo);
    const lo = clampedLo === 0 ? 0 : Math.max(0, nextDown(Math.sqrt(clampedLo)));
    const hi = this.hi === 0 ? 0 : nextUp(Math.sqrt(this.hi));
    return OutwardInterval.of(lo, hi);
  }

  public exp(): OutwardInterval {
    if (this.isEmpty) return OutwardInterval.EMPTY;
    const lo = this.lo === -Infinity ? 0 : Math.max(0, bumpDown(Math.exp(this.lo), LIBM_ULPS));
    const hi = this.hi === Infinity ? Infinity : bumpUp(Math.exp(this.hi), LIBM_ULPS);
    return OutwardInterval.of(lo, hi);
  }

  public log(): OutwardInterval {
    if (this.isEmpty || this.hi <= 0) return OutwardInterval.EMPTY;
    const lo = this.lo <= 0 ? -Infinity : bumpDown(Math.log(this.lo), LIBM_ULPS);
    const hi = this.hi === Infinity ? Infinity : bumpUp(Math.log(this.hi), LIBM_ULPS);
    return OutwardInterval.of(lo, hi);
  }

  public toString(): string {
    return this.isEmpty ? "∅" : `[${this.lo}, ${this.hi}]`;
  }
}
