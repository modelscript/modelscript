// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DdeFlowpipeSolver, type DdeProblem } from "../src/analysis/wasm_dde_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { StochasticBarrierSynthesizer } from "../src/analysis/wasm_stochastic_barrier.js";

describe("Native DDE & Stochastic Martingale Barrier Suite", () => {
  it("should integrate Delay Differential Equations (DDEs) across multiple delay periods", () => {
    // Delay differential equation: \dot{x}(t) = -x(t) + 0.5 * x(t - 1)
    // Delay tau = 1.0
    const delay = 1.0;
    const problem: DdeProblem = {
      numStates: 1,
      delay,
      f: (_t, x, xDelayed) => [-x[0]! + 0.5 * xDelayed[0]!],
      historyEnclosure: (_t) => [new Interval(0.9, 1.1)],
      nominalHistory: (_t) => [1.0],
    };

    // Integrate over [0, 2.0] (two full delay horizons)
    const res = DdeFlowpipeSolver.solve(problem, [0, 2.0], 0.2);

    assert(res.isCertifiedSafe);
    assert.strictEqual(res.totalSteps, 11);

    const finalStep = res.steps[res.steps.length - 1]!;
    assert(finalStep.tubes[0]!.lo > 0, "State x should remain strictly positive");
    assert(finalStep.tubes[0]!.hi < 1.0, "State x should decay towards equilibrium");
  });

  it("should certify formal upper bounds on failure probability for continuous Itô diffusions", () => {
    // Damped 2D Langevin / Ornstein-Uhlenbeck process:
    // dx = -2 * x dt + 0.1 * dW
    const res = StochasticBarrierSynthesizer.synthesize(
      {
        numVars: 2,
        f: (x) => [-2.0 * x[0]!, -2.0 * x[1]!],
        sigma: (_x) => [
          [0.1, 0.0],
          [0.0, 0.1],
        ],
      },
      {
        initialState: [0.1, 0.1],
        unsafeRadius: 2.0,
        riskTolerance: 0.05,
      },
    );

    assert(res.isCertifiedSafe, `Stochastic system should be certified safe: ${res.summary}`);
    assert(res.maxFailureProbability < 0.02, `Failure probability ${res.maxFailureProbability} must be < 2%`);
  });
});
