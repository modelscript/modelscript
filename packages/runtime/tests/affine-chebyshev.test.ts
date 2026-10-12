// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { Aff, createAffineDomain } from "../src/formal/dae/affine_domain.js";

describe("Phase 2: Enhanced Affine Arithmetic with Chebyshev Minimax & Condensation (K4)", () => {
  it("1. Aff.condense caps active noise symbols and preserves hull enclosure", () => {
    const terms = new Map<number, number>();
    for (let i = 1; i <= 20; i++) {
      terms.set(i, 0.05 * i); // 0.05, 0.10, ..., 1.00
    }
    const aff = new Aff(3.0, terms, 0.02);
    const origHull = aff.hull();
    const origRadius = aff.radius();

    const condensed = aff.condense(5);
    assert.strictEqual(condensed.terms.size, 5);

    // The top 5 terms should be the largest: 20, 19, 18, 17, 16
    for (let i = 16; i <= 20; i++) {
      assert.strictEqual(condensed.terms.get(i), 0.05 * i);
    }

    const condHull = condensed.hull();
    const condRadius = condensed.radius();

    // Radius must not decrease (soundness condition)
    assert.ok(condRadius >= origRadius - 1e-14);
    // Condensed hull must enclose the original hull
    assert.ok(condHull.lo <= origHull.lo + 1e-14);
    assert.ok(condHull.hi >= origHull.hi - 1e-14);
  });

  it("2. chebyshevSqr achieves minimax equioscillation error tighter than mean-value form", () => {
    const dom = createAffineDomain();
    const iv = new Interval(-1.0, 3.0);
    const a = dom.fresh(iv);
    const sqrAff = dom.powInt(a, 2);
    const sqrHull = sqrAff.hull();

    // Soundness: 100 sample points must be strictly inside the hull
    for (let k = 0; k <= 100; k++) {
      const x = -1.0 + (k / 100) * 4.0;
      const x2 = x * x;
      assert.ok(x2 >= sqrHull.lo - 1e-14, `x=${x}, x^2=${x2} < lo=${sqrHull.lo}`);
      assert.ok(x2 <= sqrHull.hi + 1e-14, `x=${x}, x^2=${x2} > hi=${sqrHull.hi}`);
    }

    // Minimax error on [-1, 3] is (b-a)^2 / 8 = 16 / 8 = 2.0
    // Mean-value form would give (b-a)^2 / 2 = 8.0 (4x looser)
    assert.ok(sqrHull.width < 14.0, `Expected tight Chebyshev width, got ${sqrHull.width}`);
  });

  it("3. chebyshevSqrt provides sound minimax enclosure on positive intervals", () => {
    const dom = createAffineDomain();
    const iv = new Interval(0.25, 4.0);
    const a = dom.fresh(iv);
    const sqrtAff = dom.sqrt(a);
    const hull = sqrtAff.hull();

    for (let k = 0; k <= 100; k++) {
      const x = 0.25 + (k / 100) * 3.75;
      const fx = Math.sqrt(x);
      assert.ok(fx >= hull.lo - 1e-14, `x=${x}, sqrt(x)=${fx} < lo=${hull.lo}`);
      assert.ok(fx <= hull.hi + 1e-14, `x=${x}, sqrt(x)=${fx} > hi=${hull.hi}`);
    }
  });

  it("4. chebyshevInv provides sound minimax reciprocal enclosure", () => {
    const dom = createAffineDomain();
    const iv = new Interval(0.5, 2.5);
    const a = dom.fresh(iv);
    const invAff = dom.div(dom.constant(1.0), a);
    const hull = invAff.hull();

    for (let k = 0; k <= 100; k++) {
      const x = 0.5 + (k / 100) * 2.0;
      const fx = 1.0 / x;
      assert.ok(fx >= hull.lo - 1e-14, `x=${x}, 1/x=${fx} < lo=${hull.lo}`);
      assert.ok(fx <= hull.hi + 1e-14, `x=${x}, 1/x=${fx} > hi=${hull.hi}`);
    }
  });

  it("5. chebyshevExp and chebyshevLog provide sound enclosures", () => {
    const dom = createAffineDomain();

    // Exp on [-1.0, 1.5]
    const ivExp = new Interval(-1.0, 1.5);
    const aExp = dom.fresh(ivExp);
    const expAff = dom.exp(aExp);
    const expHull = expAff.hull();

    for (let k = 0; k <= 100; k++) {
      const x = -1.0 + (k / 100) * 2.5;
      const fx = Math.exp(x);
      assert.ok(fx >= expHull.lo - 1e-14, `x=${x}, exp(x)=${fx} < lo=${expHull.lo}`);
      assert.ok(fx <= expHull.hi + 1e-14, `x=${x}, exp(x)=${fx} > hi=${expHull.hi}`);
    }

    // Log on [0.5, 3.0]
    const ivLog = new Interval(0.5, 3.0);
    const aLog = dom.fresh(ivLog);
    const logAff = dom.log(aLog);
    const logHull = logAff.hull();

    for (let k = 0; k <= 100; k++) {
      const x = 0.5 + (k / 100) * 2.5;
      const fx = Math.log(x);
      assert.ok(fx >= logHull.lo - 1e-14, `x=${x}, log(x)=${fx} < lo=${logHull.lo}`);
      assert.ok(fx <= logHull.hi + 1e-14, `x=${x}, log(x)=${fx} > hi=${logHull.hi}`);
    }
  });

  it("6. AffineDomain automatic condensation caps noise symbols during long operations", () => {
    // Domain with tight maxTerms cap = 4
    const dom = createAffineDomain(4);
    let acc = dom.constant(0.0);

    // Sum 20 independent interval variables
    for (let i = 0; i < 20; i++) {
      const v = dom.fresh(new Interval(0.1 * i, 0.1 * i + 0.5));
      acc = dom.add(acc, v);
      // Active terms must never exceed maxTerms (4)
      assert.ok(acc.terms.size <= 4, `terms.size ${acc.terms.size} exceeded maxTerms 4 at step ${i}`);
    }

    // The accumulated hull must enclose the sum of all 20 interval bounds
    let totalLo = 0;
    let totalHi = 0;
    for (let i = 0; i < 20; i++) {
      totalLo += 0.1 * i;
      totalHi += 0.1 * i + 0.5;
    }
    const accHull = acc.hull();
    assert.ok(accHull.lo <= totalLo + 1e-12);
    assert.ok(accHull.hi >= totalHi - 1e-12);
  });
});
