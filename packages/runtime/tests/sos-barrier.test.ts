// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SosBarrierSynthesizer } from "../src/analysis/wasm_sos_barrier.js";
import { SdpSolver, type SdpProblem } from "../src/solvers/wasm_sdp_solver.js";

describe("Native Sum-of-Squares (SOS) Barrier Certificate & SDP Solver Suite", () => {
  it("should perform Cholesky factorization and verify positive definiteness", () => {
    // Positive definite 2x2 matrix: [[2, 1], [1, 2]]
    const A = [
      [2, 1],
      [1, 2],
    ];
    const L = SdpSolver.cholesky(A);
    assert(L !== null, "Matrix should be positive definite");

    // L * L^T should reconstruct A
    const reconstructed00 = L[0]![0]! * L[0]![0]!;
    assert(Math.abs(reconstructed00 - 2) < 1e-6);

    // Non-positive-definite matrix: [[1, 2], [2, 1]] (det = -3 < 0)
    const nonPsd = [
      [1, 2],
      [2, 1],
    ];
    const L_bad = SdpSolver.cholesky(nonPsd);
    assert.strictEqual(L_bad, null, "Indefinite matrix must fail Cholesky");
  });

  it("should solve feasibility Semidefinite Program (SDP) in WASM memory", () => {
    // Problem: Find X >= 0 such that X_00 = 1, X_11 = 1
    const problem: SdpProblem = {
      n: 2,
      m: 2,
      C: [
        [1, 0],
        [0, 1],
      ],
      A: [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 0],
          [0, 1],
        ],
      ],
      b: [1.0, 1.0],
    };

    const res = SdpSolver.solve(problem);
    assert.strictEqual(res.status, "FEASIBLE");
    assert(SdpSolver.isPsd(res.X));
  });

  it("should synthesize certified Barrier Certificate for infinite time t in [0, inf)", () => {
    // Stable damped system: dx0/dt = -2 * x0, dx1/dt = -3 * x1
    // Initial set: ||x|| <= 1.0
    // Unsafe set: ||x|| >= 3.0
    const result = SosBarrierSynthesizer.synthesizeQuadratic(
      {
        numVars: 2,
        f: (x) => [-2.0 * x[0]!, -3.0 * x[1]!],
      },
      {
        initialRadius: 1.0,
        unsafeRadius: 3.0,
      },
    );

    assert(result.isCertifiedSafe, `Barrier certificate should certify safety: ${result.summary}`);
    assert.strictEqual(result.barrierDegree, 2);
    assert(result.barrierCoefficients.length === 4);
  });
});
