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

  it("should achieve true Latin Hypercube space-filling coverage across off-diagonal quadrants", async () => {
    const res = await SysML2DSEEngine.explore({
      sampleCount: 40,
      seed: 42,
      parameters: [
        { name: "x", min: 0, max: 100 },
        { name: "y", min: 0, max: 100 },
      ],
      objectives: [{ name: "obj", direction: "minimize" }],
      evaluate: (p) => ({ obj: p.x + p.y }),
    });

    let q1 = 0; // x > 50, y > 50
    let q2 = 0; // x < 50, y > 50 (off-diagonal)
    let q3 = 0; // x < 50, y < 50
    let q4 = 0; // x > 50, y < 50 (off-diagonal)

    for (const c of res.candidates) {
      const x = c.parameters["x"]!;
      const y = c.parameters["y"]!;
      if (x >= 50 && y >= 50) q1++;
      else if (x < 50 && y >= 50) q2++;
      else if (x < 50 && y < 50) q3++;
      else q4++;
    }

    // A true Latin Hypercube must explore off-diagonal quadrants (q2 and q4)
    assert.ok(q2 >= 3, `Expected at least 3 samples in off-diagonal quadrant 2 (x<50, y>50), got ${q2}`);
    assert.ok(q4 >= 3, `Expected at least 3 samples in off-diagonal quadrant 4 (x>50, y<50), got ${q4}`);
  });

  it("should produce deterministic reproducible samples when seeded", async () => {
    const problem = {
      sampleCount: 20,
      seed: 9999,
      parameters: [
        { name: "a", min: 10, max: 50 },
        { name: "b", min: 100, max: 500 },
      ],
      objectives: [{ name: "cost", direction: "minimize" }],
      evaluate: (p: Record<string, number>) => ({ cost: p.a * 2 + p.b }),
    };

    const run1 = await SysML2DSEEngine.explore(problem);
    const run2 = await SysML2DSEEngine.explore(problem);

    for (let i = 0; i < run1.candidates.length; i++) {
      assert.strictEqual(run1.candidates[i]!.parameters["a"], run2.candidates[i]!.parameters["a"]);
      assert.strictEqual(run1.candidates[i]!.parameters["b"], run2.candidates[i]!.parameters["b"]);
      assert.strictEqual(run1.candidates[i]!.objectives["cost"], run2.candidates[i]!.objectives["cost"]);
    }
  });
});
