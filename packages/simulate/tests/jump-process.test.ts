// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstReactionSSA,
  gillespieSSA,
  massActionChannel,
  simulateJumpEnsemble,
  tauLeaping,
  type JumpProblem,
} from "../src/solvers/jump-process.js";

describe("Discrete-State Stochastic Jump Processes (Gillespie SSA & Tau-Leaping) (Track 5)", () => {
  it("converges to the exact stationary Poisson distribution on a birth-death gene expression process", () => {
    // 0 --k_b--> X --k_d--> 0
    // Exact stationary distribution: X(infinity) ~ Poisson(k_b / k_d) => mean = 25, variance = 25
    const kb = 50.0;
    const kd = 2.0;

    const problem: JumpProblem = {
      tSpan: [0.0, 5.0],
      u0: [0],
      channels: [
        massActionChannel({
          name: "birth",
          rate: kb,
          numSpecies: 1,
          reactants: [],
          products: [{ speciesIndex: 0, count: 1 }],
        }),
        massActionChannel({
          name: "death",
          rate: kd,
          numSpecies: 1,
          reactants: [{ speciesIndex: 0, count: 1 }],
          products: [],
        }),
      ],
    };

    const ensemble = simulateJumpEnsemble(problem, 200, {
      method: "direct",
      gridSteps: 20,
      seed: 12345,
    });

    const finalMean = ensemble.mean[ensemble.mean.length - 1]![0]!;
    const finalVar = ensemble.variance[ensemble.variance.length - 1]![0]!;

    assert.ok(Math.abs(finalMean - 25.0) < 1.5, `Expected stationary mean ~ 25.0, got ${finalMean}`);
    assert.ok(Math.abs(finalVar - 25.0) < 6.0, `Expected stationary variance ~ 25.0, got ${finalVar}`);
  });

  it("conserves total population and non-negativity in an SIR stochastic epidemic jump model across Direct SSA, First-Reaction, and Tau-Leaping", () => {
    // S + I --beta/N--> 2 I
    // I --gamma--> R
    const N = 200;
    const beta = 1.5;
    const gamma = 0.4;

    const problem: JumpProblem = {
      tSpan: [0.0, 15.0],
      u0: [190, 10, 0],
      channels: [
        massActionChannel({
          name: "infection",
          rate: beta / N,
          numSpecies: 3,
          reactants: [
            { speciesIndex: 0, count: 1 },
            { speciesIndex: 1, count: 1 },
          ],
          products: [{ speciesIndex: 1, count: 2 }],
        }),
        massActionChannel({
          name: "recovery",
          rate: gamma,
          numSpecies: 3,
          reactants: [{ speciesIndex: 1, count: 1 }],
          products: [{ speciesIndex: 2, count: 1 }],
        }),
      ],
    };

    const resDirect = gillespieSSA(problem, { seed: 77, dtSave: 0.5 });
    const resFirst = firstReactionSSA(problem, { seed: 77, dtSave: 0.5 });
    const resTau = tauLeaping(problem, { seed: 77, dtSave: 0.5, epsilon: 0.03 });

    for (const res of [resDirect, resFirst, resTau]) {
      assert.ok(res.totalReactions > 50, `Expected active epidemic jumps, got ${res.totalReactions}`);
      for (const state of res.states) {
        const S = state[0]!;
        const I = state[1]!;
        const R = state[2]!;
        assert.ok(S >= 0 && I >= 0 && R >= 0, `Populations must be non-negative: [${S}, ${I}, ${R}]`);
        assert.equal(S + I + R, N, `Total population S + I + R must equal ${N}, got ${S + I + R}`);
      }
    }
  });

  it("handles bimolecular dimerization 2 A <-> A2 with exact combinatorial propensity", () => {
    // 2 A --k_on--> A2, A2 --k_off--> 2 A
    // Conservation law: X_A + 2 * X_A2 = const = 100
    const problem: JumpProblem = {
      tSpan: [0.0, 2.0],
      u0: [100, 0],
      channels: [
        massActionChannel({
          name: "dimerize",
          rate: 0.05,
          numSpecies: 2,
          reactants: [{ speciesIndex: 0, count: 2 }],
          products: [{ speciesIndex: 1, count: 1 }],
        }),
        massActionChannel({
          name: "dissociate",
          rate: 1.0,
          numSpecies: 2,
          reactants: [{ speciesIndex: 1, count: 1 }],
          products: [{ speciesIndex: 0, count: 2 }],
        }),
      ],
    };

    const res = gillespieSSA(problem, { seed: 99 });
    for (const st of res.states) {
      assert.equal(st[0]! + 2 * st[1]!, 100, "Monomer + 2*Dimer conservation law must hold exactly");
    }
  });
});
