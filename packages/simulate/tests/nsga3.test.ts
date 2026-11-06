// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  generateDasDennisReferencePoints,
  type MultiObjectiveProblem,
  solveNsga3,
  solveTepNsga3,
} from "../src/optimizer/index.js";
import type { GenericPowerCase } from "../src/solvers/opf/types.js";

test("NSGA-III generates correct Das-Dennis reference points on simplex", () => {
  // M = 3 objectives, p = 4 divisions -> (3+4-1)! / (4! * 2!) = 15 points
  const refPoints = generateDasDennisReferencePoints(3, 4);
  assert.equal(refPoints.length, 15);

  for (const pt of refPoints) {
    assert.equal(pt.length, 3);
    const sum = pt[0]! + pt[1]! + pt[2]!;
    assert.ok(Math.abs(sum - 1.0) < 1e-6, `Simplex sum should be 1.0, got ${sum}`);
    assert.ok(pt.every((v) => v >= -1e-6 && v <= 1.0 + 1e-6));
  }
});

test("NSGA-III solves 3-objective DTLZ2 benchmark on spherical Pareto front", async () => {
  // DTLZ2 benchmark with M=3, D=5
  const M = 3;
  const D = 5;

  const dtlz2: MultiObjectiveProblem = {
    dimension: D,
    numObjectives: M,
    bounds: {
      min: new Float64Array(D).fill(0.0),
      max: new Float64Array(D).fill(1.0),
    },
    fitness: (x: Float64Array) => {
      let g = 0.0;
      for (let i = 2; i < D; i++) {
        const diff = x[i]! - 0.5;
        g += diff * diff;
      }

      const f1 = (1.0 + g) * Math.cos((x[0]! * Math.PI) / 2.0) * Math.cos((x[1]! * Math.PI) / 2.0);
      const f2 = (1.0 + g) * Math.cos((x[0]! * Math.PI) / 2.0) * Math.sin((x[1]! * Math.PI) / 2.0);
      const f3 = (1.0 + g) * Math.sin((x[0]! * Math.PI) / 2.0);

      return new Float64Array([f1, f2, f3]);
    },
  };

  const res = await solveNsga3(dtlz2, {
    maxGenerations: 20,
    populationSize: 40,
    seed: 42,
  });

  assert.ok(res.paretoFront.length > 0, "Should return non-empty Pareto front");
  assert.equal(res.iterations, 20);

  // Check that all Pareto points lie near the unit sphere (radius ~ 1.0)
  for (const sol of res.paretoFront) {
    const f1 = sol.objectives[0]!;
    const f2 = sol.objectives[1]!;
    const f3 = sol.objectives[2]!;
    const radius = Math.sqrt(f1 * f1 + f2 * f2 + f3 * f3);
    assert.ok(radius >= 0.95 && radius <= 1.5, `Radius should be near 1.0, got ${radius}`);
  }
});

test("NSGA-III solves Multi-Objective Transmission Expansion Planning (TEP)", async () => {
  // Base 3-bus network with constrained line 1-3
  const buses = new Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>();
  buses.set(1, { i: 1, name: "B1", baseKv: 230, ide: 3, vm: 1, va: 0 });
  buses.set(2, { i: 2, name: "B2", baseKv: 230, ide: 2, vm: 1, va: 0 });
  buses.set(3, { i: 3, name: "B3", baseKv: 230, ide: 1, vm: 1, va: 0 });

  const baseCase: GenericPowerCase = {
    header: { sbase: 100 },
    buses,
    loads: [{ i: 3, pl: 120, ql: 30, status: 1 }],
    generators: [
      { i: 1, id: "1", pg: 80, qg: 10, pb: 0, pt: 150, stat: 1 }, // Cheap gen ($20/MWh)
      { i: 2, id: "1", pg: 40, qg: 10, pb: 0, pt: 150, stat: 1 }, // Expensive gen ($70/MWh)
    ],
    branches: [
      { i: 1, j: 2, ckt: "1", r: 0.01, x: 0.05, rateA: 150, st: 1 },
      { i: 1, j: 3, ckt: "1", r: 0.015, x: 0.08, rateA: 50, st: 1 }, // Congested 50 MVA line
      { i: 2, j: 3, ckt: "1", r: 0.01, x: 0.06, rateA: 150, st: 1 },
    ],
  };

  const result = await solveTepNsga3({
    baseCase,
    candidateLines: [
      {
        id: "CAND_1_3_PARALLEL",
        fromBus: 1,
        toBus: 3,
        r: 0.015,
        x: 0.08,
        rateMva: 100.0,
        capexMillions: 12.5,
      },
      {
        id: "CAND_2_3_REINFORCE",
        fromBus: 2,
        toBus: 3,
        r: 0.01,
        x: 0.06,
        rateMva: 200.0,
        capexMillions: 8.0,
      },
    ],
    maxGenerations: 10,
    populationSize: 16,
  });

  assert.ok(result.paretoPlans.length > 0);

  // Pareto front should demonstrate trade-off: higher CAPEX yields lower OPEX
  const plans = result.paretoPlans;
  const zeroCapexPlan = plans.find((p) => p.capexMillions === 0);
  const investedPlan = plans.find((p) => p.capexMillions > 0);

  if (zeroCapexPlan && investedPlan) {
    assert.ok(
      investedPlan.annualOpexMillions <= zeroCapexPlan.annualOpexMillions,
      "Reinforcing transmission should reduce annual OPEX through cheaper power dispatch",
    );
  }
});
