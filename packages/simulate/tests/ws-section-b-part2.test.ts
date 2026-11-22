// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeSymmetricHessianColoring,
  evaluateCompressedSparseHessian,
  Interval,
  PolynomialZonotope,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitExplicitMpcC99, fitExplicitMpcSurrogate } from "../src/control/explicit-mpc-codegen.js";
import { RtiNonlinearMpcController } from "../src/control/nmpc.js";

describe("Section B Part 2: Polynomial Zonotopes, Sparse Hessian Coloring & Explicit MPC Codegen", () => {
  it("PolynomialZonotope tightly encloses non-convex quadratic map exploiting even-exponent bounds", () => {
    // x ∈ [-1, 1], y = x^2 ∈ [0, 1] (standard interval/zonotope without even-exponent tracking gives [-1, 1])
    const pz = PolynomialZonotope.fromBox([new Interval(-1.0, 1.0)]);
    const pzSq = pz.quadraticMap([[[1.0]]]);
    const box = pzSq.toIntervalBox();
    assert.ok(Math.abs(box[0]!.lo - 0.0) < 1e-12, `Expected tight lower bound 0 for x^2, got ${box[0]!.lo}`);
    assert.ok(Math.abs(box[0]!.hi - 1.0) < 1e-12, `Expected tight upper bound 1 for x^2, got ${box[0]!.hi}`);

    // Exact addition preserves correlation: x + (-x) = 0 exactly!
    const negPz = pz.linearMap([[-1.0]]);
    const zeroPz = pz.exactAdd(negPz);
    const zBox = zeroPz.toIntervalBox();
    assert.ok(Math.abs(zBox[0]!.lo) < 1e-12 && Math.abs(zBox[0]!.hi) < 1e-12);
  });

  it("computeSymmetricHessianColoring compresses 30-variable banded Hessian into 3 colors and recovers exact entries", () => {
    // f(x) = Σ_{i=0}^{n-1} 2*x_i^2 + Σ_{i=0}^{n-2} (x_i - x_{i+1})^2 (tridiagonal Hessian)
    const n = 30;
    const edges: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);

    const coloring = computeSymmetricHessianColoring(n, edges);
    assert.ok(coloring.numColors <= 4, `Expected <= 4 colors for tridiagonal n=30, got ${coloring.numColors}`);

    const gradFn = (x: Float64Array): Float64Array => {
      const g = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        g[i] = 4 * x[i]!;
        if (i > 0) g[i] = g[i]! + 2 * (x[i]! - x[i - 1]!);
        if (i < n - 1) g[i] = g[i]! + 2 * (x[i]! - x[i + 1]!);
      }
      return g;
    };

    const x = new Float64Array(n).fill(1.0);
    const { hessian, gradEvals } = evaluateCompressedSparseHessian(gradFn, x, coloring);
    assert.equal(gradEvals, 2 * coloring.numColors);

    // Check interior diagonal entry H[5,5] = 4 + 2 + 2 = 8 and off-diagonal H[5,6] = -2
    let h55 = 0;
    let h56 = 0;
    for (let p = hessian.colPtr[5]!; p < hessian.colPtr[6]!; p++) {
      if (hessian.rowIndices[p] === 5) h55 = hessian.values[p]!;
      if (hessian.rowIndices[p] === 6) h56 = hessian.values[p]!;
    }
    assert.ok(Math.abs(h55 - 8.0) < 1e-6, `Expected H[5,5]=8, got ${h55}`);
    assert.ok(Math.abs(h56 - -2.0) < 1e-6, `Expected H[5,6]=-2, got ${h56}`);
  });

  it("fitExplicitMpcSurrogate approximates RTI-NMPC and emits valid zero-alloc C99 embedded code", () => {
    const mpc = new RtiNonlinearMpcController({
      dynamics: (x, u) => [-x[0]! + u[0]!],
      nStates: 1,
      nControls: 1,
      horizon: 8,
      dt: 0.1,
      Q: [10],
      R: [0.2],
      uMin: [-4],
      uMax: [4],
      rtiInnerIterations: 12,
    });

    const surr = fitExplicitMpcSurrogate(mpc, {
      xMin: [-2],
      xMax: [2],
      xRef: [0],
      uMin: [-4],
      uMax: [4],
      numSamples: 40,
      numRbfCenters: 12,
    });

    assert.ok(surr.fitRmse < 0.15, `Expected explicit MPC fit RMSE < 0.15 (<2% of span), got ${surr.fitRmse}`);
    // Stabilizing direction: for x = 1.5 > 0, explicit control must be negative
    assert.ok(surr.evaluate([1.5])[0]! < -0.5);

    const cCode = emitExplicitMpcC99(surr, "controller_tick");
    assert.ok(cCode.includes("void controller_tick(const double x[1], double u_out[1])"));
    assert.ok(cCode.includes("exp(-gamma * d2)"));
  });
});
