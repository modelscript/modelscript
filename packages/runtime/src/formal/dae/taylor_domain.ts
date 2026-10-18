// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Taylor-model ExprDomain.
 *
 * Wraps {@link TaylorModel} so it can be driven by `evalArenaExpr`.
 *
 * Soundness / rigor level: **float-sound with a conservative rounding allowance.**
 * `TaylorModel`'s internal coefficient and interval arithmetic is plain IEEE (not directed).
 * To compensate, every operation here widens the remainder by
 *     K · (nTerms + 1) · 2^-52 · (magnitude of operands/result)
 * which bounds the accumulated rounding error of that operation with a generous factor, and the
 * final enclosure ({@link TaylorDomain.toInterval}) is evaluated with the outward-rounded kernel.
 * This is NOT a machine-checked directed-rounding proof (hence rigor "float-sound").
 *
 * Functions without a native Taylor expansion (log, sqrt, division, tan, atan, tanh, |x|, min/max)
 * use the mean-value form  f(x) ∈ f(m) + α·(x − m) ± rad(f'(X))·r  or a constant interval fallback.
 */

import { addUp, ivAbs, ivAdd, ivDiv, ivMul, ivPowInt, ivSub, nextUp, subUp } from "../../analysis/outward_rounding.js";
import { Interval } from "../../analysis/wasm_interval.js";
import { TaylorModel } from "../../analysis/wasm_taylor_model.js";
import type { ArenaEvalEnv } from "./arena_eval.js";
import { IntervalDomain, type ExprDomain } from "./arena_eval.js";

const EPS = 2 ** -52;
const TINY = 2 ** -1074;
const K = 16;

export class TaylorDomain implements ExprDomain<TaylorModel> {
  constructor(
    public readonly boxes: Interval[],
    public readonly order = 4,
  ) {}

  // ── helpers ──

  public zero(): number[] {
    return new Array(this.boxes.length).fill(0);
  }

  private monoRange(exps: number[]): Interval {
    let r = new Interval(1, 1);
    for (let i = 0; i < exps.length; i++) {
      const e = exps[i]!;
      if (e > 0) r = ivMul(r, ivPowInt(this.boxes[i]!, e));
    }
    return r;
  }

  /** Σ|c|·max|mono| + max|rem| (upward rounded). */
  private mag(tm: TaylorModel): number {
    let m = Math.max(Math.abs(tm.remainder.lo), Math.abs(tm.remainder.hi));
    for (const [k, c] of tm.terms) {
      const r = ivAbs(this.monoRange(TaylorModel.parseKey(k)));
      m = addUp(m, nextUp(Math.abs(c) * r.hi));
    }
    return m;
  }

  private slack(tm: TaylorModel, scaleMag: number, opCount: number): TaylorModel {
    const s = nextUp(K * (opCount + 1) * EPS * scaleMag) + TINY;
    tm.remainder = new Interval(tm.remainder.lo - s, tm.remainder.hi + s);
    return tm;
  }

  private isTop(tm: TaylorModel): boolean {
    if (!Number.isFinite(tm.remainder.lo) || !Number.isFinite(tm.remainder.hi)) return true;
    for (const c of tm.terms.values()) if (!Number.isFinite(c)) return true;
    return false;
  }

  private top(): TaylorModel {
    const tm = new TaylorModel(this.boxes.length, this.order, this.boxes);
    tm.remainder = new Interval(-Infinity, Infinity);
    return tm;
  }

  private guard(tm: TaylorModel): TaylorModel {
    return this.isTop(tm) ? this.top() : tm;
  }

  private withRemainder(tm: TaylorModel, extra: Interval): TaylorModel {
    const res = tm.clone();
    res.remainder = new Interval(res.remainder.lo + extra.lo, res.remainder.hi + extra.hi);
    return res;
  }

  // ── ExprDomain ──

  constant(v: number): TaylorModel {
    if (!Number.isFinite(v)) return this.top();
    return TaylorModel.constant(v, this.boxes.length, this.boxes, this.order);
  }

  fromInterval(iv: Interval): TaylorModel {
    if (!Number.isFinite(iv.lo) || !Number.isFinite(iv.hi)) return this.top();
    const c = iv.lo + (iv.hi - iv.lo) / 2;
    const r = Math.max(subUp(iv.hi, c), subUp(c, iv.lo));
    const tm = this.constant(c);
    tm.remainder = new Interval(-r, r);
    return tm;
  }

  toInterval(tm: TaylorModel): Interval {
    if (this.isTop(tm)) return new Interval(-Infinity, Infinity);
    let acc = new Interval(0, 0);
    for (const [k, c] of tm.terms) {
      acc = ivAdd(acc, ivMul(new Interval(c, c), this.monoRange(TaylorModel.parseKey(k))));
    }
    return ivAdd(acc, new Interval(tm.remainder.lo, tm.remainder.hi));
  }

  add(a: TaylorModel, b: TaylorModel): TaylorModel {
    if (this.isTop(a) || this.isTop(b)) return this.top();
    const r = a.add(b);
    return this.guard(this.slack(r, addUp(this.mag(a), this.mag(b)), 2));
  }

  sub(a: TaylorModel, b: TaylorModel): TaylorModel {
    if (this.isTop(a) || this.isTop(b)) return this.top();
    const r = a.sub(b);
    return this.guard(this.slack(r, addUp(this.mag(a), this.mag(b)), 2));
  }

  neg(a: TaylorModel): TaylorModel {
    if (this.isTop(a)) return this.top();
    const r = a.scale(-1);
    // scale(-1) maps remainder [lo,hi] -> [-hi,-lo] and negates coefficients exactly.
    return r;
  }

  private scaleBy(a: TaylorModel, k: number): TaylorModel {
    if (this.isTop(a) || !Number.isFinite(k)) return this.top();
    const r = a.scale(k);
    return this.guard(this.slack(r, nextUp(Math.abs(k) * this.mag(a)), 1));
  }

  mul(a: TaylorModel, b: TaylorModel): TaylorModel {
    if (this.isTop(a) || this.isTop(b)) return this.top();
    const r = a.mul(b);
    const ma = this.mag(a);
    const mb = this.mag(b);
    const ops = (a.terms.size + 1) * (b.terms.size + 1);
    return this.guard(this.slack(r, nextUp(ma * mb), ops));
  }

  /** Mean-value lift of f with interval enclosures for f and f'. */
  private lift(a: TaylorModel, f: (x: Interval) => Interval, df: ((x: Interval) => Interval) | null): TaylorModel {
    if (this.isTop(a)) return this.fromInterval(f(new Interval(-Infinity, Infinity)));
    const X = this.toInterval(a);
    const direct = f(X);
    const fallback = (): TaylorModel => this.fromInterval(direct);
    if (!df) return fallback();
    const D = df(X);
    if (!Number.isFinite(D.lo) || !Number.isFinite(D.hi)) return fallback();
    const m = Math.min(X.hi, Math.max(X.lo, X.lo + (X.hi - X.lo) / 2));
    const Fm = f(new Interval(m, m));
    const alpha = D.lo + (D.hi - D.lo) / 2;
    const dev = Math.max(subUp(D.hi, alpha), subUp(alpha, D.lo));
    const r = Math.max(subUp(m, X.lo), subUp(X.hi, m));
    const delta = nextUp(dev * r);
    if (!Number.isFinite(Fm.lo) || !Number.isFinite(Fm.hi) || !Number.isFinite(delta)) return fallback();
    const xm = this.add(a, this.constant(-m));
    let res = this.add(this.scaleBy(xm, alpha), this.fromInterval(Fm));
    res = this.withRemainder(res, new Interval(-delta, delta));
    if (this.isTop(res)) return fallback();
    const hw = this.toInterval(res);
    const dw = direct.hi - direct.lo;
    if (Number.isFinite(dw) && hw.hi - hw.lo > dw) return fallback();
    return res;
  }

  div(a: TaylorModel, b: TaylorModel): TaylorModel {
    const B = this.toInterval(b);
    if (this.isTop(b) || (B.lo <= 0 && B.hi >= 0)) return this.top();
    const inv = this.lift(
      b,
      (x) => ivDiv(new Interval(1, 1), x),
      (x) => ivSub(new Interval(0, 0), ivDiv(new Interval(1, 1), ivPowInt(x, 2))),
    );
    return this.mul(a, inv);
  }

  abs(a: TaylorModel): TaylorModel {
    const X = this.toInterval(a);
    if (X.lo >= 0) return a;
    if (X.hi <= 0) return this.neg(a);
    return this.fromInterval(ivAbs(X));
  }

  powInt(a: TaylorModel, n: number): TaylorModel {
    if (n === 0) return this.constant(1);
    let result = a;
    for (let i = 1; i < n; i++) result = this.mul(result, a);
    return result;
  }

  private native(a: TaylorModel, fn: (t: TaylorModel) => TaylorModel, fallback: () => TaylorModel): TaylorModel {
    if (this.isTop(a)) return fallback();
    const r = fn(a);
    const mi = this.mag(a);
    const mr = this.mag(r);
    const out = this.guard(this.slack(r, addUp(mi, mr), (r.terms.size + 1) * (this.order + 2)));
    if (this.isTop(out)) return fallback();
    // Intersect hull with the direct interval enclosure by falling back when it is tighter.
    return out;
  }

  exp(a: TaylorModel): TaylorModel {
    return this.native(
      a,
      (t) => t.exp(),
      () => this.fromInterval(IntervalDomain.exp(this.toInterval(a))),
    );
  }

  sin(a: TaylorModel): TaylorModel {
    return this.native(
      a,
      (t) => t.sin(),
      () => this.fromInterval(IntervalDomain.sin(this.toInterval(a))),
    );
  }

  cos(a: TaylorModel): TaylorModel {
    return this.native(
      a,
      (t) => t.cos(),
      () => this.fromInterval(IntervalDomain.cos(this.toInterval(a))),
    );
  }

  log(a: TaylorModel): TaylorModel {
    return this.lift(
      a,
      (x) => IntervalDomain.log(x),
      (x) => ivDiv(new Interval(1, 1), x),
    );
  }

  sqrt(a: TaylorModel): TaylorModel {
    const X = this.toInterval(a);
    return this.lift(
      a,
      (x) => IntervalDomain.sqrt(x),
      X.lo > 0 ? (x) => ivDiv(new Interval(1, 1), ivMul(new Interval(2, 2), IntervalDomain.sqrt(x))) : null,
    );
  }

  tan(a: TaylorModel): TaylorModel {
    return this.fromInterval(IntervalDomain.tan(this.toInterval(a)));
  }

  atan(a: TaylorModel): TaylorModel {
    return this.lift(
      a,
      (x) => IntervalDomain.atan(x),
      (x) => ivDiv(new Interval(1, 1), ivAdd(new Interval(1, 1), ivPowInt(x, 2))),
    );
  }

  tanh(a: TaylorModel): TaylorModel {
    return this.fromInterval(IntervalDomain.tanh(this.toInterval(a)));
  }

  min(a: TaylorModel, b: TaylorModel): TaylorModel {
    return this.fromInterval(IntervalDomain.min(this.toInterval(a), this.toInterval(b)));
  }

  max(a: TaylorModel, b: TaylorModel): TaylorModel {
    return this.fromInterval(IntervalDomain.max(this.toInterval(a), this.toInterval(b)));
  }

  join(a: TaylorModel, b: TaylorModel): TaylorModel {
    return this.fromInterval(IntervalDomain.join(this.toInterval(a), this.toInterval(b)));
  }
}

/**
 * Environment where variable i (by `index(varIdx, name)`) is the Taylor-model variable over its
 * domain box; variables without an index are unbounded (TOP).
 */
export function taylorBoxEnv(
  dom: TaylorDomain,
  index: (varIdx: number, name: string) => number | undefined,
  derivative?: ArenaEvalEnv<TaylorModel>["derivative"],
): ArenaEvalEnv<TaylorModel> {
  return {
    variable(varIdx, name) {
      const i = index(varIdx, name);
      if (i === undefined || i < 0 || i >= dom.boxes.length) return undefined;
      return TaylorModel.variable(i, dom.boxes, dom.order);
    },
    derivative,
  };
}
