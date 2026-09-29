// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysML2DSEEngine, dominates, type DSECandidate, type DSEObjective } from "../src/dse-engine.js";

describe("SysML v2 Multi-Objective Design Space Exploration (DSE) Engine", () => {
  it("should evaluate Pareto dominance correctly between two candidates", () => {
    const objectives: DSEObjective[] = [
      { name: "mass", direction: "minimize" },
      { name: "range", direction: "maximize" },
    ];

    const candidateA: DSECandidate = {
      id: "A",
      parameters: {},
      objectives: { mass: 5, range: 100 },
      isFeasible: true,
    };

    const candidateB: DSECandidate = {
      id: "B",
      parameters: {},
      objectives: { mass: 6, range: 90 }, // strictly worse in both
      isFeasible: true,
    };

    const candidateC: DSECandidate = {
      id: "C",
      parameters: {},
      objectives: { mass: 4, range: 80 }, // trade-off: lighter mass but less range
      isFeasible: true,
    };

    // A dominates B
    assert.strictEqual(dominates(candidateA, candidateB, objectives), true);
    assert.strictEqual(dominates(candidateB, candidateA, objectives), false);

    // A and C are mutually non-dominating (tradeoff)
    assert.strictEqual(dominates(candidateA, candidateC, objectives), false);
    assert.strictEqual(dominates(candidateC, candidateA, objectives), false);
  });

  it("should explore design space and synthesize ranked Pareto frontier with TOPSIS", async () => {
    const res = await SysML2DSEEngine.explore({
      sampleCount: 25,
      parameters: [
        { name: "wingspan", min: 1.0, max: 3.0 },
        { name: "batteryWh", min: 50, max: 200 },
      ],
      objectives: [
        { name: "mass", direction: "minimize", weight: 1.0 },
        { name: "flightHours", direction: "maximize", weight: 2.0 },
      ],
      constraints: [
        {
          name: "maxMass",
          evaluate: (_p, obj) => obj.mass <= 8.0,
        },
      ],
      evaluate: (p) => {
        // mass = 1.5 * wingspan + 0.02 * batteryWh
        const mass = 1.5 * p.wingspan + 0.02 * p.batteryWh;
        // flightHours = batteryWh / (15 + 10 * wingspan)
        const flightHours = p.batteryWh / (15 + 10 * p.wingspan);
        return { mass, flightHours };
      },
    });

    assert.strictEqual(res.candidates.length, 25);
    assert.ok(res.paretoFrontier.length > 0, "Pareto frontier should not be empty");
    assert.ok(res.recommendedCandidate !== undefined, "Should select a recommended tradeoff candidate");
    assert.ok((res.recommendedCandidate!.topsisScore ?? 0) > 0, "Recommended candidate should have valid TOPSIS score");

    // All Pareto frontier candidates must satisfy constraints
    for (const c of res.paretoFrontier) {
      assert.strictEqual(c.isFeasible, true);
      assert.ok(c.objectives.mass <= 8.0);
    }

    assert.ok(res.summary.includes("non-dominated Pareto designs"));
  });
});
