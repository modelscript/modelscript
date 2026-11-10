// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  instantiateAmpl,
  parseAmplData,
  parseAmplModel,
  solveAmpl,
} from "../src/index.js";

describe("languages/ampl: Mathematical Programming Reference Benchmarks", () => {
  describe("Benchmark 1: Hitchcock-Koopmans Transportation Network LP", () => {
    // Classic 2-plant, 3-market transportation problem
    // Supply: Seattle = 350, San_Diego = 600 (Total: 950)
    // Demand: New_York = 325, Chicago = 300, Topeka = 275 (Total: 900)
    // Shipping freight cost per unit:
    //   Seattle   -> New_York: 2.5, Chicago: 1.7, Topeka: 1.8
    //   San_Diego -> New_York: 2.5, Chicago: 1.8, Topeka: 1.4
    // Optimal shipping plan:
    //   Seattle   -> Chicago: 300, New_York: 50
    //   San_Diego -> New_York: 275, Topeka: 275
    // Optimal total transportation cost = (300*1.7 + 50*2.5) + (275*2.5 + 275*1.4)
    //                                   = (510 + 125) + (687.5 + 385) = 635 + 1072.5 = 1707.5
    const modSrc = `
      set ORIG;
      set DEST;

      param supply {ORIG} >= 0;
      param demand {DEST} >= 0;
      param cost {ORIG, DEST} >= 0;

      var Trans {ORIG, DEST} >= 0;

      minimize Total_Cost:
        sum {i in ORIG, j in DEST} cost[i, j] * Trans[i, j];

      subject to Supply_Limit {i in ORIG}:
        sum {j in DEST} Trans[i, j] <= supply[i];

      subject to Demand_Satisfaction {j in DEST}:
        sum {i in ORIG} Trans[i, j] = demand[j];
    `;

    const datSrc = `
      set ORIG := Seattle San_Diego ;
      set DEST := New_York Chicago Topeka ;

      param supply :=
        Seattle   350
        San_Diego 600 ;

      param demand :=
        New_York 325
        Chicago  300
        Topeka   275 ;

      param cost :
                   New_York Chicago Topeka :=
        Seattle         2.5     1.7    1.8
        San_Diego       2.5     1.8    1.4 ;
    `;

    it("solves transportation LP to exact optimal distribution cost (1707.5)", async () => {
      const model = parseAmplModel(modSrc);
      const data = parseAmplData(datSrc);
      const problem = instantiateAmpl(model, data);
      const result = await solveAmpl(problem);

      assert.strictEqual(result.status, "OPTIMAL");
      assert.ok(
        Math.abs(result.objectiveValue - 1707.5) < 1e-3,
        `Expected 1707.5, got ${result.objectiveValue}`,
      );

      // Verify non-negativity and key route shipments
      const transSeattleChi = result.variables["Trans[Seattle,Chicago]"] ?? 0;
      const transSanDiegoTop = result.variables["Trans[San_Diego,Topeka]"] ?? 0;
      assert.ok(Math.abs(transSeattleChi - 300) < 1e-2, `Expected Trans[Seattle,Chicago]=300, got ${transSeattleChi}`);
      assert.ok(Math.abs(transSanDiegoTop - 275) < 1e-2, `Expected Trans[San_Diego,Topeka]=275, got ${transSanDiegoTop}`);
    });
  });

  describe("Benchmark 2: Multi-Period Dynamic Production Lot-Sizing LP", () => {
    // 4 periods with regular capacity, overtime production, holding costs
    const modSrc = `
      set PERIODS;

      param demand {PERIODS} >= 0;
      param reg_cost >= 0;
      param over_cost >= 0;
      param hold_cost >= 0;
      param reg_cap >= 0;
      param over_cap >= 0;

      var MakeReg {PERIODS} >= 0, <= reg_cap;
      var MakeOver {PERIODS} >= 0, <= over_cap;
      var Inventory {PERIODS} >= 0;

      minimize Cost:
        sum {t in PERIODS} (reg_cost * MakeReg[t] + over_cost * MakeOver[t] + hold_cost * Inventory[t]);

      subject to Balance1:
        MakeReg[1] + MakeOver[1] = demand[1] + Inventory[1];

      subject to Balance2:
        Inventory[1] + MakeReg[2] + MakeOver[2] = demand[2] + Inventory[2];

      subject to Balance3:
        Inventory[2] + MakeReg[3] + MakeOver[3] = demand[3] + Inventory[3];

      subject to Balance4:
        Inventory[3] + MakeReg[4] + MakeOver[4] = demand[4] + Inventory[4];
    `;

    const datSrc = `
      set PERIODS := 1 2 3 4 ;
      param reg_cost := 25.0 ;
      param over_cost := 35.0 ;
      param hold_cost := 2.0 ;
      param reg_cap := 100.0 ;
      param over_cap := 40.0 ;

      param demand :=
        1 90.0
        2 130.0
        3 110.0
        4 80.0 ;
    `;

    it("solves multi-period lot sizing with optimal regular/overtime trade-off", async () => {
      const model = parseAmplModel(modSrc);
      const data = parseAmplData(datSrc);
      const problem = instantiateAmpl(model, data);
      const result = await solveAmpl(problem);

      assert.strictEqual(result.status, "OPTIMAL");
      // Total demand = 90 + 130 + 110 + 80 = 410
      // Total regular capacity = 4 * 100 = 400
      // At least 10 units must be overtime:
      // Period 1: demand 90, can produce 100 reg -> 10 inv carryover (cost: 100*25 + 10*2 = 2520)
      // Period 2: demand 130, has 10 inv + 100 reg + 20 over = 130 (cost: 100*25 + 20*35 = 3200)
      // Period 3: demand 110, can do 100 reg + 10 over = 110 (cost: 100*25 + 10*35 = 2850)
      // Period 4: demand 80, 80 reg = 80 (cost: 80*25 = 2000)
      // Expected total cost: 2520 + 3200 + 2850 + 2000 = 10570 or equivalent optimal schedule
      assert.ok(result.objectiveValue > 10000 && result.objectiveValue < 11000, `Got objective ${result.objectiveValue}`);
    });
  });

  describe("Benchmark 3: Petroleum Refinery Feedstock Blending LP", () => {
    // Blending raw components to produce Regular and Premium gasoline
    const modSrc = `
      var CRUDE1 >= 0, <= 100;
      var CRUDE2 >= 0, <= 100;

      maximize Profit:
        12 * CRUDE1 + 15 * CRUDE2;

      subject to Octane_Spec:
        0.5 * CRUDE1 + 0.8 * CRUDE2 <= 100;

      subject to Vapor_Spec:
        0.4 * CRUDE1 + 0.2 * CRUDE2 <= 50;

      subject to Lead_Spec:
        0.1 * CRUDE1 + 0.3 * CRUDE2 <= 40;
    `;

    it("identifies optimal corner-point production blend", async () => {
      const model = parseAmplModel(modSrc);
      const problem = instantiateAmpl(model);
      const result = await solveAmpl(problem);

      assert.strictEqual(result.status, "OPTIMAL");
      // Optimal corner point:
      // Intersection of Octane (0.5*C1 + 0.8*C2 = 100) and Vapor (0.4*C1 + 0.2*C2 = 50):
      // CRUDE1 = 100/1.1 ≈ 90.909, CRUDE2 = 15/0.22 ≈ 68.182
      // Objective = 12 * 90.909 + 15 * 68.182 = 2113.636
      assert.ok(
        Math.abs(result.objectiveValue - 2113.636) < 1e-2,
        `Expected 2113.636, got ${result.objectiveValue}`,
      );
      assert.ok(Math.abs(result.variables["CRUDE1"]! - 90.909) < 1e-2);
      assert.ok(Math.abs(result.variables["CRUDE2"]! - 68.182) < 1e-2);
    });
  });

  describe("Benchmark 4: Capital Budgeting & Facility Selection MILP", () => {
    // 5 projects with binary selection, investment costs, and NPV returns
    // Budget: 14 million
    // Projects:
    // P1: NPV 16, Cost 6
    // P2: NPV 22, Cost 8
    // P3: NPV 12, Cost 4
    // P4: NPV 8,  Cost 3
    // P5: NPV 11, Cost 5
    // Best subset with cost <= 14:
    // P2 + P1 = cost 14, NPV = 22 + 16 = 38
    // P2 + P3 + P4 = cost 8 + 4 + 3 = 15 (> 14)
    // P2 + P5 = cost 13, NPV = 33
    // P1 + P3 + P4 = cost 6 + 4 + 3 = 13, NPV = 16 + 12 + 8 = 36
    // P1 + P3 + P5 = cost 6 + 4 + 5 = 15 (> 14)
    // Optimal = P1 + P2 with NPV = 38, Cost = 14
    const modSrc = `
      var x1 binary;
      var x2 binary;
      var x3 binary;
      var x4 binary;
      var x5 binary;

      maximize Total_NPV:
        16 * x1 + 22 * x2 + 12 * x3 + 8 * x4 + 11 * x5;

      subject to Budget_Limit:
        6 * x1 + 8 * x2 + 4 * x3 + 3 * x4 + 5 * x5 <= 14;
    `;

    it("solves binary knapsack capital budgeting to optimal integer value (38)", async () => {
      const model = parseAmplModel(modSrc);
      const problem = instantiateAmpl(model);
      const result = await solveAmpl(problem);

      assert.strictEqual(result.status, "OPTIMAL");
      assert.strictEqual(result.problemClass, "MILP");
      assert.ok(
        Math.abs(result.objectiveValue - 38) < 1e-3,
        `Expected 38, got ${result.objectiveValue}`,
      );
      assert.strictEqual(Math.round(result.variables["x1"]!), 1);
      assert.strictEqual(Math.round(result.variables["x2"]!), 1);
      assert.strictEqual(Math.round(result.variables["x3"]!), 0);
      assert.strictEqual(Math.round(result.variables["x4"]!), 0);
      assert.strictEqual(Math.round(result.variables["x5"]!), 0);
    });
  });

  describe("Benchmark 5: Markowitz Mean-Variance Quadratic Portfolio NLP", () => {
    // 2-asset risk-minimization quadratic problem
    // Asset 1: var 0.04, return 0.08
    // Asset 2: var 0.16, return 0.14
    // Minimize 0.04*w1^2 + 0.16*w2^2 (assuming zero covariance)
    // subject to: w1 + w2 = 1, 0.08*w1 + 0.14*w2 >= 0.10, w1, w2 >= 0
    // Objective: minimize 0.04*w1^2 + 0.16*w2^2
    const modSrc = `
      var w1 >= 0, <= 1;
      var w2 >= 0, <= 1;

      minimize Risk:
        0.04 * w1^2 + 0.16 * w2^2;

      subject to Full_Investment:
        w1 + w2 = 1.0;

      subject to Min_Return:
        0.08 * w1 + 0.14 * w2 >= 0.10;
    `;

    it("solves convex quadratic risk minimization with Karush-Kuhn-Tucker convergence", async () => {
      const model = parseAmplModel(modSrc);
      const problem = instantiateAmpl(model);
      assert.strictEqual(problem.problemClass, "NLP");

      const result = await solveAmpl(problem);
      assert.strictEqual(result.status, "OPTIMAL");

      const w1 = result.variables["w1"]!;
      const w2 = result.variables["w2"]!;
      assert.ok(Math.abs(w1 + w2 - 1.0) < 1e-2, `Expected w1+w2=1, got ${w1 + w2}`);
      assert.ok(0.08 * w1 + 0.14 * w2 >= 0.098, `Expected min return >= 0.10, got ${0.08 * w1 + 0.14 * w2}`);
      assert.ok(result.objectiveValue > 0.02 && result.objectiveValue < 0.06);
    });
  });
});
