// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Specialized Modeling Paradigms Verification Suite (Phases 7 & 8)
 *
 * Verifies:
 * 1. Phase 7:
 *    - Network flow modeling with `node` and `arc` (including `from`, `to`, gains, and flow conservation)
 *    - Column-wise formulation with `to_come`, `obj`, and `coeff` clauses
 *    - User-defined algebraic functions (`function`) with inlined evaluation
 * 2. Phase 8:
 *    - Named subproblems with `problem` definitions and dynamic switching (`switchProblem`)
 *    - Custom suffixes (`suffix`, `S` segments in ASCII and binary ASL .nl / .sol)
 *    - Quadratic term extraction, problem classification (`QP`), and MPS `QUADOBJ` generation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AmplSession,
  instantiateAmpl,
  parseAmplModel,
  readBinaryNlProblem,
  readSolResult,
  solveAmpl,
  writeBinaryNlProblem,
  writeMpsProblem,
  writeNlProblem,
} from "../src/index.js";

describe("languages/ampl: Phase 7 — Network Flow, Column-Wise & User Functions", () => {
  it("synthesizes flow conservation and solves minimum-cost transshipment with node and arc", async () => {
    const modSrc = `
      set NODES := {"S1", "S2", "T1", "T2"};

      node Balance{i in NODES}: net_out = (if i = "S1" then 10 else if i = "S2" then 15 else if i = "T1" then -12 else -13);

      arc Flow1 >= 0: from Balance["S1"] to Balance["T1"], obj TotalCost 3;
      arc Flow2 >= 0: from Balance["S1"] to Balance["T2"], obj TotalCost 5;
      arc Flow3 >= 0: from Balance["S2"] to Balance["T1"], obj TotalCost 4;
      arc Flow4 >= 0: from Balance["S2"] to Balance["T2"], obj TotalCost 2;

      minimize TotalCost;
    `;

    const model = parseAmplModel(modSrc);
    assert.strictEqual(model.nodes?.size, 1);
    assert.strictEqual(model.arcs?.size, 4);

    const problem = instantiateAmpl(model);

    // 4 arc variables created: Flow1, Flow2, Flow3, Flow4
    assert.strictEqual(problem.variables.length, 4);

    // 4 node balance constraints synthesized
    assert.strictEqual(problem.constraints.length, 4);

    const result = await solveAmpl(problem);
    assert.strictEqual(result.status, "OPTIMAL");

    // S1 supplies 10 to T1 (cost 3*10 = 30)
    // S2 supplies 2 to T1 (cost 4*2 = 8) and 13 to T2 (cost 2*13 = 26)
    // Total cost = 30 + 8 + 26 = 64
    assert.ok(
      Math.abs(result.objectiveValue - 64) < 1e-4,
      `Expected total cost 64, got ${result.objectiveValue}`,
    );
    assert.ok(Math.abs((result.variables["Flow1"] ?? 0) - 10) < 1e-4);
    assert.ok(Math.abs((result.variables["Flow2"] ?? 0) - 0) < 1e-4);
    assert.ok(Math.abs((result.variables["Flow3"] ?? 0) - 2) < 1e-4);
    assert.ok(Math.abs((result.variables["Flow4"] ?? 0) - 13) < 1e-4);
  });

  it("handles arc gain multipliers in network flow conservation", async () => {
    const modSrc = `
      node Src: net_out = 8;
      node Mid: net_out = 0;
      node Snk: net_out = -16;

      arc A1 >= 0: from Src to Mid gain 2;
      arc A2 >= 0: from Mid to Snk gain 1;

      minimize Cost: A1 + A2;
    `;

    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    assert.strictEqual(problem.variables.length, 2);
    assert.strictEqual(problem.constraints.length, 3);

    const result = await solveAmpl(problem);
    assert.strictEqual(result.status, "OPTIMAL");
    // Src outputs A1 = 10 -> enters Mid with gain 2 (effective 20). Mid needs to send out 16 to Snk.
    // Flow conservation at Mid: -2*A1 + A2 = 0 -> A2 = 2*A1.
    // Snk: -A2 = -16 -> A2 = 16 -> A1 = 8.
    // Total Cost = 8 + 16 = 24.
    assert.ok(
      Math.abs(result.variables["A1"]! - 8) < 1e-4,
      `Expected A1 = 8, got ${result.variables["A1"]}`,
    );
    assert.ok(
      Math.abs(result.variables["A2"]! - 16) < 1e-4,
      `Expected A2 = 16, got ${result.variables["A2"]}`,
    );
  });

  it("formulates and solves column-wise models using to_come, obj, and coeff", async () => {
    const modSrc = `
      minimize TotalCost: to_come;

      subject to Demand1: to_come >= 100;
      subject to Demand2: to_come >= 150;

      var ProcessA >= 0, obj TotalCost 2, coeff Demand1 1, coeff Demand2 2;
      var ProcessB >= 0, obj TotalCost 3, coeff Demand1 2, coeff Demand2 1;
    `;

    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);

    // Check that column specs populated Demand1 and Demand2
    const d1 = problem.constraints.find((c) => c.name === "Demand1");
    const d2 = problem.constraints.find((c) => c.name === "Demand2");
    assert.ok(d1 && d2, "Missing Demand constraints");

    const paId = problem.varNameMap.get("ProcessA")!;
    const pbId = problem.varNameMap.get("ProcessB")!;

    // Demand1 has coeff 1 for ProcessA, 2 for ProcessB
    const d1_pa = d1.expr.linearTerms.find((t) => t.varId === paId);
    const d1_pb = d1.expr.linearTerms.find((t) => t.varId === pbId);
    assert.strictEqual(d1_pa?.coeff, 1);
    assert.strictEqual(d1_pb?.coeff, 2);

    // Objective TotalCost has coeff 2 for ProcessA, 3 for ProcessB
    const obj_pa = problem.objective.expr.linearTerms.find((t) => t.varId === paId);
    const obj_pb = problem.objective.expr.linearTerms.find((t) => t.varId === pbId);
    assert.strictEqual(obj_pa?.coeff, 2);
    assert.strictEqual(obj_pb?.coeff, 3);

    const result = await solveAmpl(problem);
    assert.strictEqual(result.status, "OPTIMAL");
    // System:
    // ProcessA + 2*ProcessB >= 100
    // 2*ProcessA + ProcessB >= 150
    // min 2*ProcessA + 3*ProcessB
    // Optimal corner point:
    // ProcessA + 2*ProcessB = 100 -> ProcessA = 100 - 2*ProcessB
    // 2*(100 - 2*ProcessB) + ProcessB = 150 -> 200 - 3*ProcessB = 150 -> 3*ProcessB = 50 -> ProcessB = 50/3 = 16.6667
    // ProcessA = 200/3 = 66.6667
    // Cost = 2*(200/3) + 3*(50/3) = 400/3 + 150/3 = 550/3 = 183.3333
    const pa = result.variables["ProcessA"]!;
    const pb = result.variables["ProcessB"]!;
    assert.ok(Math.abs(pa - 200 / 3) < 0.1);
    assert.ok(Math.abs(pb - 50 / 3) < 0.1);
    assert.ok(Math.abs(result.objectiveValue - 550 / 3) < 0.1);
  });

  it("inlines and evaluates user-defined algebraic functions in optimization", async () => {
    const modSrc = `
      function huber(r) = if abs(r) <= 1 then 0.5 * r^2 else abs(r) - 0.5;

      var x := 3.0;

      minimize ResidualLoss:
        huber(x - 1.0);
    `;

    const model = parseAmplModel(modSrc);
    assert.ok(model.functions?.has("huber"));

    const problem = instantiateAmpl(model);
    assert.strictEqual(problem.problemClass, "NLP");

    const result = await solveAmpl(problem);
    assert.strictEqual(result.status, "OPTIMAL");
    // Minimum of huber(x - 1) is at x = 1, where loss = 0.5 * 0^2 = 0
    assert.ok(
      Math.abs(result.variables["x"]! - 1.0) < 0.05,
      `Expected x ≈ 1.0, got ${result.variables["x"]}`,
    );
    assert.ok(
      Math.abs(result.objectiveValue) < 0.01,
      `Expected objective ≈ 0, got ${result.objectiveValue}`,
    );
  });
});

describe("languages/ampl: Phase 8 — Subproblems, Custom Suffixes & Quadratic Term Extraction", () => {
  it("switches named subproblems and partitions objectives and constraints", async () => {
    const script = `
      var x >= 0, <= 10;
      var y >= 0, <= 10;

      minimize MasterObj: 2 * x;
      minimize SubObj: 3 * y;

      subject to ConMaster: x >= 4;
      subject to ConSub: y >= 6;

      problem Master: MasterObj, x, ConMaster;
      problem Sub: SubObj, y, ConSub;

      problem Master;
      solve;

      problem Sub;
      solve;
    `;

    const session = new AmplSession();
    const result = await session.evalScript(script);

    assert.strictEqual(result.solveHistory.length, 2);

    // First solve: Master (min 2*x, x >= 4) -> x = 4, obj = 8
    const resMaster = result.solveHistory[0]!;
    assert.strictEqual(resMaster.status, "OPTIMAL");
    assert.ok(Math.abs(resMaster.variables["x"]! - 4) < 1e-4);
    assert.ok(Math.abs(resMaster.objectiveValue - 8) < 1e-4);

    // Second solve: Sub (min 3*y, y >= 6) -> y = 6, obj = 18
    const resSub = result.solveHistory[1]!;
    assert.strictEqual(resSub.status, "OPTIMAL");
    assert.ok(Math.abs(resSub.variables["y"]! - 6) < 1e-4);
    assert.ok(Math.abs(resSub.objectiveValue - 18) < 1e-4);
  });

  it("serializes and parses custom suffixes in ASCII and binary ASL (.nl / .sol)", () => {
    const modSrc = `
      suffix priority integer IN;
      suffix iis integer OUT;

      var x >= 0, <= 10;
      var y >= 0, <= 10;

      minimize Obj: x + y;
      subject to Con: x + y >= 5;
    `;

    const model = parseAmplModel(modSrc);
    assert.ok(model.suffixes?.has("priority"));
    assert.ok(model.suffixes?.has("iis"));

    // Attach custom suffixes via varBoundOverrides
    const customVarSuffixes = new Map<string, Map<string, number | string>>();
    const xSuf = new Map<string, number | string>();
    xSuf.set("priority", 42);
    customVarSuffixes.set("x", xSuf);

    const problem = instantiateAmpl(model, undefined, {
      varBoundOverrides: new Map([
        ["x", { customSuffixes: xSuf }],
      ]),
    });

    const xVar = problem.variables.find((v) => v.name === "x")!;
    assert.strictEqual(xVar.customSuffixes?.get("priority"), 42);

    // 1. ASCII NL serialization
    const asciiNl = writeNlProblem(problem);
    assert.ok(asciiNl.includes("S0 1 priority"), "Missing integer variable suffix in ASCII .nl");
    assert.ok(asciiNl.includes(`${xVar.id} 42`), "Missing suffix value in ASCII .nl");

    // 2. Binary NL serialization
    const binNl = writeBinaryNlProblem(problem);
    const readBack = readBinaryNlProblem(binNl);
    assert.strictEqual(readBack.variables.length, 2);
    assert.strictEqual(readBack.constraints.length, 1);
    assert.strictEqual(readBack.variables[xVar.id]?.customSuffixes?.get("priority"), 42);

    // 3. Solution (.sol) file with custom suffixes
    const mockSol = [
      "Optimal solution found",
      "Options 3 0 0 1",
      "S1 1 iis",
      "0 1",
      "0.0", // dual for Con
      "2.0", // primal x
      "3.0", // primal y
    ].join("\n");

    const parsedSol = readSolResult(mockSol, 2, 1);
    assert.strictEqual(parsedSol.suffixes?.["iis"]?.[0], 1);
    assert.strictEqual(parsedSol.primalValues[0], 2.0);
    assert.strictEqual(parsedSol.primalValues[1], 3.0);
  });

  it("extracts quadratic terms and writes MPS QUADOBJ section for QP problems", () => {
    const modSrc = `
      var w1 >= 0;
      var w2 >= 0;

      minimize Portfolio_Risk:
        0.04 * w1^2 + 0.09 * w2^2 + 2 * 0.01 * w1 * w2;

      subject to Full_Investment:
        w1 + w2 = 1.0;
    `;

    const model = parseAmplModel(modSrc);

    // Default classification is backward-compatible NLP
    const problemNlp = instantiateAmpl(model);
    assert.strictEqual(problemNlp.problemClass, "NLP");

    // Explicit QP classification requested via preferQp: true
    const problemQp = instantiateAmpl(model, undefined, { preferQp: true });
    assert.strictEqual(problemQp.problemClass, "QP");

    // Both retain quadratic terms in the objective
    const qTerms = problemQp.objective.expr.quadraticTerms;
    assert.ok(qTerms && qTerms.length === 3, "Expected 3 quadratic terms");

    // MPS serialization contains QUADOBJ section
    const mps = writeMpsProblem(problemQp);
    assert.ok(mps.includes("QUADOBJ"), "MPS output missing QUADOBJ header");

    assert.ok(mps.includes("w1"), "MPS missing w1");
    assert.ok(mps.includes("w2"), "MPS missing w2");
  });
});
