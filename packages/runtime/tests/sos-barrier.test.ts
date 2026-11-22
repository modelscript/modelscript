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
    assert.ok(res.status === "OPTIMAL" || res.status === "FEASIBLE", `Unexpected status: ${res.status}`);
    assert(SdpSolver.isPsd(res.X));
    assert.ok(res.residual < 1e-4, `Primal residual too large: ${res.residual}`);
  });

  it("should solve an optimization SDP to certified OPTIMAL with near-zero duality gap", () => {
    // min <[[2, 1], [1, 2]], X> s.t. X_00 = 1, X_11 = 1, X >= 0
    // Optimal X* = [[1, -1], [-1, 1]] with primalObj = 2*1 + 2*(-1) + 2*1 = 2.0
    const problem: SdpProblem = {
      n: 2,
      m: 2,
      C: [
        [2, 1],
        [1, 2],
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

    const res = SdpSolver.solve(problem, 60, 1e-5);
    assert.strictEqual(res.status, "OPTIMAL");
    assert.ok(Math.abs(res.primalObj - 2.0) < 1e-3, `Expected optimal obj 2.0, got ${res.primalObj}`);
    assert.ok((res.dualityGap ?? Infinity) < 1e-3, `Expected duality gap < 1e-3, got ${res.dualityGap}`);
    assert(SdpSolver.isPsd(res.X));
  });

  it("should synthesize a heuristic Lyapunov barrier candidate without falsely claiming rigorous certification", () => {
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

    assert.strictEqual(result.isCertifiedSafe, false);
    assert.strictEqual(result.verdict.kind, "unknown");
    assert.strictEqual((result.verdict as any).reason, "not-rigorous");
    assert(result.candidateFound, `Barrier candidate should be found: ${result.summary}`);
    assert.strictEqual(result.barrierDegree, 2);
    assert(result.barrierCoefficients.length === 4);

    // Nonlinear blow-up system dx/dt = -x + x^3 must NEVER be certified safe
    const blowupRes = SosBarrierSynthesizer.synthesizeQuadratic(
      {
        numVars: 1,
        f: (x) => [-x[0]! + x[0]! * x[0]! * x[0]!],
      },
      {
        initialRadius: 1.5,
        unsafeRadius: 3.0,
      },
    );
    assert.strictEqual(blowupRes.isCertifiedSafe, false);
    assert.strictEqual(blowupRes.verdict.kind, "unknown");

    // Higher-degree (quartic) SOS barrier synthesis
    const higherRes = SosBarrierSynthesizer.synthesizeHigherDegree(
      {
        numVars: 2,
        f: (x) => [-2.0 * x[0]!, -3.0 * x[1]!],
      },
      {
        initialRadius: 1.0,
        unsafeRadius: 3.0,
      },
      4,
    );
    assert.strictEqual(higherRes.isCertifiedSafe, false);
    assert.strictEqual(higherRes.verdict.kind, "unknown");
    assert.strictEqual(higherRes.candidateFound, true);
    assert.strictEqual(higherRes.barrierDegree, 4);
  });
});
