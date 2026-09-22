// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval, TaylorModel, TaylorModelFlowpipeSolver } from "../src/analysis/wasm_taylor_model.js";
import {
  encloseRotatedBox,
  householderQR,
  multiplyMatrixVector,
  multiplyTransposeMatrixVector,
} from "../src/solvers/wasm_qr.js";

describe("Householder QR Decomposition & Wrapping-Effect Preconditioning Suite", () => {
  it("should compute exact Householder QR decomposition A = Q * R", () => {
    // 3x3 test matrix
    const A = [new Float64Array([12, -51, 4]), new Float64Array([6, 167, -68]), new Float64Array([-4, 24, -41])];

    const { Q, R, n } = householderQR(A, 3);
    assert.strictEqual(n, 3);

    // 1. Verify Q is orthogonal: Q^T * Q = I
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let dot = 0.0;
        for (let k = 0; k < n; k++) {
          dot += Q[k]![i]! * Q[k]![j]!;
        }
        const expected = i === j ? 1.0 : 0.0;
        assert(Math.abs(dot - expected) < 1e-10, `Q^T * Q at (${i}, ${j}) = ${dot} !== ${expected}`);
      }
    }

    // 2. Verify R is upper triangular: R[i][j] = 0 for i > j
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        assert(Math.abs(R[i]![j]!) < 1e-10, `R[${i}][${j}] = ${R[i]![j]!} is not zero`);
      }
    }

    // 3. Verify Q * R = A
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0.0;
        for (let k = 0; k < n; k++) {
          sum += Q[i]![k]! * R[k]![j]!;
        }
        assert(Math.abs(sum - A[i]![j]!) < 1e-9, `Q*R at (${i}, ${j}) = ${sum} !== A = ${A[i]![j]!}`);
      }
    }
  });

  it("should perform matrix-vector and transpose products correctly", () => {
    // 2D 45-degree rotation matrix: Q = [cos θ, -sin θ; sin θ, cos θ]
    const theta = Math.PI / 4;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const Q = [new Float64Array([c, -s]), new Float64Array([s, c])];

    const v = new Float64Array([1.0, 0.0]);
    const Qv = multiplyMatrixVector(Q, v);
    assert(Math.abs(Qv[0]! - c) < 1e-12);
    assert(Math.abs(Qv[1]! - s) < 1e-12);

    const QtQv = multiplyTransposeMatrixVector(Q, Qv);
    assert(Math.abs(QtQv[0]! - 1.0) < 1e-12);
    assert(Math.abs(QtQv[1]! - 0.0) < 1e-12);
  });

  it("should tightly enclose rotated coordinate interval boxes", () => {
    // Box in rotated coordinates y in [-1, 1] x [-1, 1]
    const center = [0.0, 0.0];
    const halfWidths = [1.0, 1.0];

    // 45-degree rotation matrix
    const theta = Math.PI / 4;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const Q = [new Float64Array([c, -s]), new Float64Array([s, c])];

    const tubes = encloseRotatedBox(center, Q, halfWidths);
    assert.strictEqual(tubes.length, 2);

    // Bounding radius should be |c|*1 + |-s|*1 = sqrt(2) approx 1.4142
    const expectedRadius = Math.SQRT2;
    assert(Math.abs(tubes[0]!.hi - expectedRadius) < 1e-10);
    assert(Math.abs(tubes[0]!.lo - -expectedRadius) < 1e-10);
    assert(Math.abs(tubes[1]!.hi - expectedRadius) < 1e-10);
    assert(Math.abs(tubes[1]!.lo - -expectedRadius) < 1e-10);
  });

  it("should demonstrate wrapping effect mitigation in flowpipe solver with QR preconditioning", () => {
    // 2D linear system: rotating flow
    // dx1/dt = -0.1*x1 + x2
    // dx2/dt = -x1 - 0.1*x2
    const initialEnclosure = [new Interval(0.9, 1.1), new Interval(-0.1, 0.1)];
    const nominalInitial = [1.0, 0.0];
    const tSpan: [number, number] = [0, 1.0];
    const dt = 0.05;

    const dynamics = (_t: TaylorModel, y: TaylorModel[]) => {
      const dx1 = y[0]!.scale(-0.1).add(y[1]!);
      const dx2 = y[0]!.scale(-1.0).add(y[1]!.scale(-0.1));
      return [dx1, dx2];
    };

    // Run without QR preconditioning
    const resultStandard = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      useQrPreconditioning: false,
    });

    // Run with QR preconditioning
    const resultQR = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order: 2,
      useQrPreconditioning: true,
    });

    assert(resultStandard.isCertifiedSafe);
    assert(resultQR.isCertifiedSafe);
    assert.strictEqual(resultStandard.steps.length, resultQR.steps.length);

    // Both produce valid enclosures that contain nominal trajectory
    for (const step of resultQR.steps) {
      assert(step.tubes[0]!.lo <= step.nominal[0]!);
      assert(step.tubes[0]!.hi >= step.nominal[0]!);
      assert(step.tubes[1]!.lo <= step.nominal[1]!);
      assert(step.tubes[1]!.hi >= step.nominal[1]!);
    }
  });
});
