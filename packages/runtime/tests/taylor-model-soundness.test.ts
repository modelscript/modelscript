// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval, TaylorModel } from "../src/analysis/wasm_taylor_model.js";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Soundness property of a Taylor model: for every v in the domain,
 *   f(center + v) - P(v)  is contained in the remainder interval.
 * Coefficient arithmetic is plain floating point (no directed rounding), so a small relative
 * tolerance is allowed; it is orders of magnitude below the truncation errors being tested.
 */
function assertSound(
  name: string,
  tm: TaylorModel,
  domain: Interval[],
  truth: (v: number[]) => number,
  r: () => number,
  samples = 400,
): void {
  for (let s = 0; s < samples; s++) {
    const v = domain.map(
      (d, i) => (s === 0 ? d.lo : s === 1 ? d.hi : s === 2 ? 0 : d.lo + r() * (d.hi - d.lo)) + 0 * i,
    );
    const err = truth(v) - tm.evaluateAt(v);
    const tol = 1e-12 * Math.max(1, Math.abs(truth(v)));
    assert.ok(
      err >= tm.remainder.lo - tol && err <= tm.remainder.hi + tol,
      `${name}: truncation error ${err} at v=[${v.join(", ")}] outside remainder [${tm.remainder.lo}, ${tm.remainder.hi}]`,
    );
  }
}

describe("Taylor model soundness", () => {
  const r = rng(11);

  it("polynomial arithmetic (add/mul/scale) is sound", () => {
    for (const order of [2, 3, 4]) {
      const dom = [new Interval(-0.6, 0.6), new Interval(-0.5, 0.5)];
      const c = [0.4, -0.3];
      const x = TaylorModel.variable(0, dom, order, c[0]);
      const y = TaylorModel.variable(1, dom, order, c[1]);
      // f = (x*y + 2x) * (y - x) + x*x*x*y
      const f = x.mul(y).add(x.scale(2)).mul(y.sub(x)).add(x.mul(x).mul(x).mul(y));
      assertSound(
        `poly order ${order}`,
        f,
        dom,
        (v) => {
          const X = c[0]! + v[0]!;
          const Y = c[1]! + v[1]!;
          return (X * Y + 2 * X) * (Y - X) + X * X * X * Y;
        },
        r,
      );
    }
  });

  it("exp is sound for wide domains", () => {
    for (const order of [2, 3, 4]) {
      const dom = [new Interval(-0.9, 0.9)];
      const x = TaylorModel.variable(0, dom, order, 0.2);
      assertSound(`exp order ${order}`, x.exp(), dom, (v) => Math.exp(0.2 + v[0]!), r);
    }
  });

  it("sin and cos are sound for wide domains (combined-series truncation bound)", () => {
    for (const order of [2, 3, 4]) {
      for (const c0 of [0.0, 0.5, 0.78, 1.2, 2.0]) {
        const dom = [new Interval(-1.0, 1.0)];
        const x = TaylorModel.variable(0, dom, order, c0);
        assertSound(`sin order ${order} c=${c0}`, x.sin(), dom, (v) => Math.sin(c0 + v[0]!), r);
        assertSound(`cos order ${order} c=${c0}`, x.cos(), dom, (v) => Math.cos(c0 + v[0]!), r);
      }
    }
  });

  it("composition carries the inner remainder: sin(exp(x)) and exp(sin(x))", () => {
    for (const order of [2, 3]) {
      const dom = [new Interval(-0.8, 0.8)];
      const x = TaylorModel.variable(0, dom, order, 0.3);
      assertSound(`sin(exp) order ${order}`, x.exp().sin(), dom, (v) => Math.sin(Math.exp(0.3 + v[0]!)), r);
      assertSound(`cos(exp) order ${order}`, x.exp().cos(), dom, (v) => Math.cos(Math.exp(0.3 + v[0]!)), r);
      assertSound(`exp(sin) order ${order}`, x.sin().exp(), dom, (v) => Math.exp(Math.sin(0.3 + v[0]!)), r);
      assertSound(`exp(exp) order ${order}`, x.exp().exp(), dom, (v) => Math.exp(Math.exp(0.3 + v[0]!)), r);
    }
  });

  it("negative remainders are handled (exp of a model with remainder below zero)", () => {
    const dom = [new Interval(-0.7, 0.7)];
    const x = TaylorModel.variable(0, dom, 2, 0.1);
    // x*x*x*x has truncated (positive) excess; negate it to force a negative remainder
    const q = x.mul(x).mul(x).mul(x).scale(-1);
    assertSound("neg-rem", q, dom, (v) => -Math.pow(0.1 + v[0]!, 4), r);
    assertSound("exp(neg-rem)", q.exp(), dom, (v) => Math.exp(-Math.pow(0.1 + v[0]!, 4)), r);
    assertSound("sin(neg-rem)", q.sin(), dom, (v) => Math.sin(-Math.pow(0.1 + v[0]!, 4)), r);
  });

  it("tiny coefficients are swept into the remainder instead of being dropped", () => {
    const dom = [new Interval(-2, 2)];
    const tm = TaylorModel.constant(0, 1, dom, 2);
    tm.set([1], 5e-16); // |c| < 1e-15 used to be silently deleted
    tm.set([2], -3e-16);
    // The polynomial may drop the terms, but then the remainder must account for them:
    //   true value at v = 2 is 5e-16*2 - 3e-16*4 = -2e-16 ; at v = -2: -1e-15 - 1.2e-15
    const range = tm.evaluateRange();
    for (const v of [-2, -1, 0, 1, 2]) {
      const truth = 5e-16 * v - 3e-16 * v * v;
      assert.ok(truth >= range.lo && truth <= range.hi, `v=${v}: ${truth} not in [${range.lo}, ${range.hi}]`);
    }
  });

  it("cancelling terms leave a sound model", () => {
    const dom = [new Interval(-1, 1)];
    const x = TaylorModel.variable(0, dom, 3, 0);
    const y = x.add(x.scale(1 + 1e-17)).sub(x.scale(2));
    assertSound("cancel", y, dom, (v) => v[0]! + v[0]! * (1 + 1e-17) - 2 * v[0]!, r, 50);
  });
});
