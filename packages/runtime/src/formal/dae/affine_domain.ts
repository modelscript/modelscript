// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Sound affine arithmetic domain.
 *
 * A form is  x = c + Σ t_i·ε_i ± err,  ε_i ∈ [-1, 1],  err ≥ 0.
 *
 * Soundness:
 *  - Every floating-point coefficient operation adds a rounding bound (|y|·2^-52 + 2^-1074 ≥ 0.5 ulp)
 *    into `err`, so the form encloses the exact real result of the mathematical operation.
 *  - Nonlinear functions use the mean-value form  f(x) ∈ f(m) + α·(x − m) ± rad(f'(X))·r,
 *    where X is the interval hull, m ∈ X, r = max|x − m|, and f(m), f'(X) are enclosed with the
 *    outward-rounded interval kernel. If the interval enclosure f(X) is tighter than the
 *    mean-value hull, the interval enclosure is used (as a fresh independent symbol).
 *  - Anything unbounded or NaN becomes TOP (err = ∞); TOP absorbs all operations.
 */

import {
  addDown,
  addUp,
  ivAbs,
  ivAtan,
  ivCos,
  ivDiv,
  ivExp,
  ivLog,
  ivMul,
  ivPowInt,
  ivSin,
  ivSqrt,
  ivSub,
  ivTan,
  ivTanh,
  nextUp,
  subDown,
  subUp,
} from "../../analysis/outward_rounding.js";
import { Interval } from "../../analysis/wasm_interval.js";
import type { ArenaEvalEnv } from "./arena_eval.js";
import { IntervalDomain, type AbstractDomain } from "./arena_eval.js";

const EPS = 2 ** -52;
const TINY = 2 ** -1074;
const rnd = (y: number): number => Math.abs(y) * EPS + TINY;

export class Aff {
  constructor(
    public readonly c: number,
    public readonly terms: ReadonlyMap<number, number>,
    public readonly err: number,
  ) {}

  get isTop(): boolean {
    return !Number.isFinite(this.c) || !Number.isFinite(this.err);
  }

  /** Upward-rounded total deviation radius. */
  radius(): number {
    let r = this.err;
    for (const t of this.terms.values()) r = addUp(r, Math.abs(t));
    return r;
  }

  hull(): Interval {
    if (this.isTop) return new Interval(-Infinity, Infinity);
    const r = this.radius();
    if (!Number.isFinite(r)) return new Interval(-Infinity, Infinity);
    return new Interval(subDown(this.c, r), addUp(this.c, r));
  }
}

const TOP = new Aff(0, new Map(), Infinity);

function finiteForm(c: number, terms: Map<number, number>, err: number): Aff {
  if (!Number.isFinite(c) || !Number.isFinite(err)) return TOP;
  for (const t of terms.values()) if (!Number.isFinite(t)) return TOP;
  return new Aff(c, terms, err);
}

function ivToCenterErr(iv: Interval): { c: number; r: number } | null {
  if (Number.isNaN(iv.lo) || Number.isNaN(iv.hi) || !Number.isFinite(iv.lo) || !Number.isFinite(iv.hi)) return null;
  const c = iv.lo + (iv.hi - iv.lo) / 2;
  const cc = Number.isFinite(c) ? c : 0.5 * iv.lo + 0.5 * iv.hi;
  const r = Math.max(subUp(iv.hi, cc), subUp(cc, iv.lo));
  return Number.isFinite(r) ? { c: cc, r } : null;
}

export interface AffineDomainHandle {
  domain: AbstractDomain<Aff>;
  /** Fresh form for an interval, with a new noise symbol. */
  fresh(iv: Interval): Aff;
}

/** Create an affine domain with its own noise-symbol counter. */
export function createAffineDomain(): AffineDomain {
  return new AffineDomain();
}

export class AffineDomain implements AbstractDomain<Aff>, AffineDomainHandle {
  private next = 1;
  get domain(): AbstractDomain<Aff> {
    return this;
  }

  constant(v: number): Aff {
    return Number.isFinite(v) ? new Aff(v, new Map(), 0) : TOP;
  }

  fresh(iv: Interval): Aff {
    const ce = ivToCenterErr(iv);
    if (!ce) return TOP;
    if (ce.r === 0) return new Aff(ce.c, new Map(), 0);
    return new Aff(ce.c, new Map([[this.next++, ce.r]]), 0);
  }

  fromInterval(iv: Interval): Aff {
    return this.fresh(iv);
  }

  /** Interval as c ± err with no noise symbol (independent, uncorrelated). */
  private boxed(iv: Interval): Aff {
    const ce = ivToCenterErr(iv);
    return ce ? new Aff(ce.c, new Map(), ce.r) : TOP;
  }

  toInterval(t: Aff): Interval {
    return t.hull();
  }

  add(a: Aff, b: Aff): Aff {
    if (a.isTop || b.isTop) return TOP;
    const c = a.c + b.c;
    let err = addUp(addUp(a.err, b.err), rnd(c));
    const terms = new Map<number, number>();
    for (const [k, v] of a.terms) terms.set(k, v);
    for (const [k, v] of b.terms) {
      const prev = terms.get(k);
      if (prev === undefined) terms.set(k, v);
      else {
        const s = prev + v;
        err = addUp(err, rnd(s));
        terms.set(k, s);
      }
    }
    return finiteForm(c, terms, err);
  }

  neg(a: Aff): Aff {
    if (a.isTop) return TOP;
    const terms = new Map<number, number>();
    for (const [k, v] of a.terms) terms.set(k, -v);
    return new Aff(-a.c, terms, a.err);
  }

  sub(a: Aff, b: Aff): Aff {
    return this.add(a, this.neg(b));
  }

  /** Multiply by an exactly-representable scalar. */
  private scale(a: Aff, k: number): Aff {
    if (a.isTop || !Number.isFinite(k)) return TOP;
    const c = a.c * k;
    let err = addUp(nextUp(Math.abs(k) * a.err), rnd(c));
    const terms = new Map<number, number>();
    for (const [i, v] of a.terms) {
      const p = v * k;
      err = addUp(err, rnd(p));
      terms.set(i, p);
    }
    return finiteForm(c, terms, err);
  }

  mul(a: Aff, b: Aff): Aff {
    if (a.isTop || b.isTop) return TOP;
    if (a.terms.size === 0 && a.err === 0) return this.scale(b, a.c);
    if (b.terms.size === 0 && b.err === 0) return this.scale(a, b.c);
    const c = a.c * b.c;
    let err = rnd(c);
    const terms = new Map<number, number>();
    const acc = (k: number, v: number) => {
      const prev = terms.get(k);
      if (prev === undefined) terms.set(k, v);
      else {
        const s = prev + v;
        err = addUp(err, rnd(s));
        terms.set(k, s);
      }
    };
    for (const [k, v] of b.terms) {
      const p = a.c * v;
      err = addUp(err, rnd(p));
      acc(k, p);
    }
    for (const [k, v] of a.terms) {
      const p = b.c * v;
      err = addUp(err, rnd(p));
      acc(k, p);
    }
    const ra = a.radius();
    const rb = b.radius();
    err = addUp(err, nextUp(Math.abs(a.c) * b.err));
    err = addUp(err, nextUp(Math.abs(b.c) * a.err));
    err = addUp(err, nextUp(ra * rb));
    return finiteForm(c, terms, err);
  }

  /** Mean-value-form lift of a unary function with interval enclosures `f` and derivative `df`. */
  private lift(a: Aff, f: (x: Interval) => Interval, df: ((x: Interval) => Interval) | null): Aff {
    if (a.isTop) {
      return this.boxed(f(new Interval(-Infinity, Infinity)));
    }
    const X = a.hull();
    const direct = f(X);
    if (!df) return this.fresh(direct);
    const D = df(X);
    if (Number.isNaN(D.lo) || Number.isNaN(D.hi) || !Number.isFinite(D.lo) || !Number.isFinite(D.hi)) {
      return this.fresh(direct);
    }
    const m = Math.min(X.hi, Math.max(X.lo, X.lo + (X.hi - X.lo) / 2));
    const Fm = f(new Interval(m, m));
    const alpha = D.lo + (D.hi - D.lo) / 2;
    const dev = Math.max(subUp(D.hi, alpha), subUp(alpha, D.lo));
    const r = Math.max(subUp(m, X.lo), subUp(X.hi, m));
    const delta = nextUp(dev * r);
    const xm = this.add(a, this.constant(-m));
    let res = this.add(this.scale(xm, alpha), this.boxed(Fm));
    res = this.add(res, new Aff(0, new Map(), delta));
    if (res.isTop) return this.fresh(direct);
    const hw = res.hull();
    const dw = direct.hi - direct.lo;
    if (Number.isFinite(dw) && hw.hi - hw.lo > dw) return this.fresh(direct);
    return res;
  }

  div(a: Aff, b: Aff): Aff {
    const B = b.hull();
    if (b.isTop || (B.lo <= 0 && B.hi >= 0)) return TOP;
    const inv = this.lift(
      b,
      (x) => ivDiv(new Interval(1, 1), x),
      (x) => ivSub(new Interval(0, 0), ivDiv(new Interval(1, 1), ivPowInt(x, 2))),
    );
    return this.mul(a, inv);
  }

  abs(a: Aff): Aff {
    const X = a.hull();
    if (X.lo >= 0) return a;
    if (X.hi <= 0) return this.neg(a);
    return this.fresh(ivAbs(X));
  }

  powInt(a: Aff, n: number): Aff {
    if (n === 0) return this.constant(1);
    if (n === 1) return a;
    if (n === 2)
      return this.lift(
        a,
        (x) => ivPowInt(x, 2),
        (x) => ivMul(new Interval(2, 2), x),
      );
    return this.lift(
      a,
      (x) => ivPowInt(x, n),
      (x) => ivMul(new Interval(n, n), ivPowInt(x, n - 1)),
    );
  }

  exp(a: Aff): Aff {
    return this.lift(a, ivExp, ivExp);
  }

  log(a: Aff): Aff {
    return this.lift(a, ivLog, (x) => ivDiv(new Interval(1, 1), x));
  }

  sqrt(a: Aff): Aff {
    const X = a.hull();
    return this.lift(
      a,
      ivSqrt,
      X.lo > 0 ? (x) => ivDiv(new Interval(1, 1), ivMul(new Interval(2, 2), ivSqrt(x))) : null,
    );
  }

  sin(a: Aff): Aff {
    return this.lift(a, ivSin, ivCos);
  }

  cos(a: Aff): Aff {
    return this.lift(a, ivCos, (x) => {
      const s = ivSin(x);
      return new Interval(-s.hi, -s.lo);
    });
  }

  tan(a: Aff): Aff {
    return this.lift(a, ivTan, (x) => {
      const t = ivPowInt(ivTan(x), 2);
      return new Interval(addDown(1, t.lo), addUp(1, t.hi));
    });
  }

  atan(a: Aff): Aff {
    return this.lift(a, ivAtan, (x) => {
      const q = ivPowInt(x, 2);
      return ivDiv(new Interval(1, 1), new Interval(addDown(1, q.lo), addUp(1, q.hi)));
    });
  }

  tanh(a: Aff): Aff {
    return this.lift(a, ivTanh, (x) => {
      const t = ivPowInt(ivTanh(x), 2);
      return new Interval(Math.max(0, subDown(1, t.hi)), Math.min(1, subUp(1, t.lo)));
    });
  }

  min(a: Aff, b: Aff): Aff {
    return this.fresh(IntervalDomain.min(a.hull(), b.hull()));
  }

  max(a: Aff, b: Aff): Aff {
    return this.fresh(IntervalDomain.max(a.hull(), b.hull()));
  }

  join(a: Aff, b: Aff): Aff {
    return this.fresh(IntervalDomain.join(a.hull(), b.hull()));
  }
}

/**
 * Environment that maps each variable to ONE affine form (one noise symbol), so that
 * correlations between occurrences of the same variable are preserved.
 */
export function affineBoxEnv(
  dom: AffineDomain,
  bound: (varIdx: number, name: string) => Interval | undefined,
  derivative?: ArenaEvalEnv<Aff>["derivative"],
): ArenaEvalEnv<Aff> {
  const cache = new Map<number, Aff>();
  return {
    variable(varIdx, name) {
      const hit = cache.get(varIdx);
      if (hit) return hit;
      const b = bound(varIdx, name);
      if (!b) return undefined;
      const f = dom.fresh(b);
      cache.set(varIdx, f);
      return f;
    },
    derivative,
  };
}
