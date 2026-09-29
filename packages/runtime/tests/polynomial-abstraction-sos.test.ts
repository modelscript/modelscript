// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { PolynomialAbstraction } from "../src/analysis/wasm_polynomial_abstraction.js";
import { SosBarrierSynthesizer } from "../src/analysis/wasm_sos_barrier.js";

describe("Native Higher-Degree SOS & Transcendental Polynomial Abstraction Suite", () => {
  it("should abstract sin(x) with certified interval remainder bounds", () => {
    // sin(x) on [-1, 1]
    const domain = new Interval(-1.0, 1.0);
    const absRes = PolynomialAbstraction.abstractSin(domain, 3);

    assert.strictEqual(absRes.degree, 3);
    assert.strictEqual(absRes.coefficients[1], 1.0); // x coeff
    assert(Math.abs(absRes.coefficients[3]! - -1.0 / 6.0) < 1e-6); // -x^3/6

    // Remainder should bound truncation error on [-1, 1]
    assert(absRes.remainder.hi > 0);
    assert(absRes.remainder.lo < 0);
    assert(absRes.remainder.hi <= 1.0 / 24.0 + 1e-6);
  });

  it("should abstract cos(x) and exp(x) with tight remainder bounds", () => {
    const domain = new Interval(-0.5, 0.5);
    const cosRes = PolynomialAbstraction.abstractCos(domain, 4);
    assert.strictEqual(cosRes.degree, 4);
    assert.strictEqual(cosRes.coefficients[0], 1.0);
    assert.strictEqual(cosRes.coefficients[2], -0.5);

    const expRes = PolynomialAbstraction.abstractExp(domain, 2);
    assert.strictEqual(expRes.degree, 2);
    assert.strictEqual(expRes.coefficients[0], 1.0);
    assert.strictEqual(expRes.coefficients[1], 1.0);
  });

  it("should synthesize Degree-4 SOS Barrier Certificates for infinite-time safety", () => {
    // Non-linear damped oscillator: dx0 = -2*x0 - x0^3, dx1 = -3*x1
    const res = SosBarrierSynthesizer.synthesizeHigherDegree(
      {
        numVars: 2,
        f: (x) => [-2.0 * x[0]! - Math.pow(x[0]!, 3), -3.0 * x[1]!],
      },
      {
        initialRadius: 1.0,
        unsafeRadius: 3.5,
      },
      4,
    );

    assert(res.isCertifiedSafe);
    assert.strictEqual(res.barrierDegree, 4);
    assert(res.barrierCoefficients.length >= 6);
  });
});
