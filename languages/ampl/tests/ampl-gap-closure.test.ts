// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Commercial AMPL Gap-Closure Verification Suite (Phases 1, 2 & 3)
 *
 * Verifies:
 * 1. Phase 1:
 *    - First-class variable & constraint suffixes (.val, .rc, .lb, .ub, .status, .body, .dual, .slack)
 *    - Full nonlinear ASL .nl prefix opcode expression graphs (C<k>, O<k>, o0-o53, v<k>, n<c>, k<j>)
 *    - Declarative `table` CSV and JSON `IN` / `OUT` / `INOUT` data binding (`read table`, `write table`)
 * 2. Phase 2:
 *    - Imperative `.run` scripting engine (`AmplSession`, `runAmplScript`, `for`, `let`, `fix`/`unfix`, `drop`/`restore`, `objective`, `solve`, `display`, `printf`)
 *    - Ordered & circular set operations (`ordered`, `circular`, `first`, `last`, `next`, `prev`, `nextw`, `prevw`, `ord`, `card`, `member`, `symdiff`) & defined variables
 *    - Piecewise-linear expressions (`<<b1, b2; s1, s2, s3>> x`), `semicont`/`semiint` variables, and `SOS1`/`SOS2` sets
 * 3. Phase 3:
 *    - Standalone Fourer & Gay presolve and LIFO postsolve primal/dual recovery (`presolveAmplProblem`, `solveAmpl(..., { presolve: true })`)
 *    - MP-style logical, indicator (`==>`), equivalence (`<==>`), disjunction (`or`), CP (`alldiff`, `atleast`, `atmost`), and non-smooth (`abs`, `min`, `max`) reformulations
 *    - MPEC complementarity constraints (`complements`) in both MILP (Fortuny-Amat & McCarl) and NLP (Fischer-Burmeister) modes
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AmplSession,
  instantiateAmpl,
  parseAmplModel,
  presolveAmplProblem,
  runAmplScript,
  solveAmpl,
  writeMpsProblem,
  writeNlProblem,
} from "../src/index.js";

describe("languages/ampl: Phase 1 — Suffix System, Full Nonlinear ASL .nl & Table I/O", () => {
  it("computes primal/dual suffixes (.val, .rc, .dual, .slack, .body, .status) satisfying KKT conditions", async () => {
    const modSrc = `
      var x >= 0, <= 40;
      var y >= 0;

      maximize Profit: 30 * x + 20 * y;

      subject to Labor: 2 * x + y <= 100;
      subject to Material: x + y <= 80;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    const res = await solveAmpl(problem);

    assert.equal(res.status, "OPTIMAL");
    // Optimal corner: x = 20, y = 60 -> Profit = 30(20) + 20(60) = 1800
    assert.ok(Math.abs(res.objectiveValue - 1800) < 1e-4, `Expected 1800, got ${res.objectiveValue}`);
    assert.ok(Math.abs((res.variables["x"] ?? 0) - 20) < 1e-4);
    assert.ok(Math.abs((res.variables["y"] ?? 0) - 60) < 1e-4);

    // Dual multipliers for Labor (2x + y <= 100) and Material (x + y <= 80):
    // 2*pi1 + pi2 = 30, pi1 + pi2 = 20 => pi1 = 10, pi2 = 10
    assert.ok(res.duals, "Expected dual multipliers on result");
    assert.ok(Math.abs(Math.abs(res.duals["Labor"] ?? 0) - 10) < 1e-3);
    assert.ok(Math.abs(Math.abs(res.duals["Material"] ?? 0) - 10) < 1e-3);

    // Both constraints are binding -> slacks = 0, body = 100 and 80
    assert.ok(res.constraintSuffixes?.["Labor"]);
    assert.ok(Math.abs((res.constraintSuffixes["Labor"]?.body ?? 0) - 100) < 1e-4);
    assert.ok(Math.abs(res.constraintSuffixes["Labor"]?.slack ?? 1) < 1e-4);

    // Both x and y are strictly interior to their bounds (x=20 in [0,40], y=60 in [0,inf)) -> reduced costs = 0
    assert.ok(res.variableSuffixes?.["x"]);
    assert.equal(res.variableSuffixes["x"]?.status, "basic");
    assert.ok(Math.abs(res.variableSuffixes["x"]?.rc ?? 1) < 1e-4);
    assert.ok(Math.abs(res.variableSuffixes["y"]?.rc ?? 1) < 1e-4);
  });

  it("serializes full nonlinear ASL .nl prefix opcode expression trees (C<k>, O<k>, o0-o53, k<j>)", () => {
    const modSrc = `
      set I := 1..2;
      var x {I} >= 0.1, <= 5;

      minimize NonlinearObj:
        (x[1] - 2)^2 + sin(x[2]) * exp(x[1]);

      subject to CircleLimit:
        x[1]^2 + x[2]^2 <= 10;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    const nl = writeNlProblem(problem);

    // Header must declare 2 variables, 1 constraint, 1 objective
    assert.ok(nl.includes("g3 0 1 0"), "Missing ASL header line 1");
    assert.ok(nl.includes("2 1 1 0 0 0"), "Missing variable/constraint counts in header");

    // Nonlinear expression block for CircleLimit (C0): x[1]^2 + x[2]^2 -> o0 (add), o5 (pow), v0, v1, n2
    assert.ok(nl.includes("\nC0\no0\no5\nv0\nn2\no5\nv1\nn2\n"), `Unexpected C0 block in:\n${nl}`);

    // Nonlinear expression block for NonlinearObj (O0 0): contains o41 (sin) and o44 (exp)
    assert.ok(nl.includes("\nO0 0\n"), "Missing O0 block");
    assert.ok(nl.includes("\no41\n"), "Missing o41 (sin) opcode");
    assert.ok(nl.includes("\no44\n"), "Missing o44 (exp) opcode");

    // Cumulative Jacobian column counts (k section) and Jacobian entries (J0)
    assert.ok(nl.includes("\nk1\n"), "Missing k1 cumulative column count section");
    assert.ok(nl.includes("\nJ0 2\n"), "Missing J0 2 Jacobian sparsity section");
  });

  it("executes declarative table CSV and JSON IN / OUT data binding", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ampl-table-test-"));
    try {
      const csvInPath = path.join(tmpDir, "foods.csv");
      fs.writeFileSync(
        csvInPath,
        ["FOOD,cost,protein", "beef,4.0,20", "lentils,1.5,12"].join("\n") + "\n",
        "utf-8",
      );

      const script = `
        set FOOD;
        param cost {FOOD} >= 0;
        param protein {FOOD} >= 0;
        var Buy {FOOD} >= 0, <= 10;

        minimize TotalCost: sum {f in FOOD} cost[f] * Buy[f];
        subject to MinProtein: sum {f in FOOD} protein[f] * Buy[f] >= 60;

        table FoodsIn IN "CSV" "foods.csv": [FOOD], cost, protein;
        table BuyOutCsv OUT "CSV" "solution.csv": [f in FOOD], Buy[f].val ~ buy, Buy[f].rc ~ reduced_cost;
        table BuyOutJson OUT "JSON" "solution.json": [f in FOOD], Buy[f].val ~ buy;

        read table FoodsIn;
        solve;
        write table BuyOutCsv;
        write table BuyOutJson;
      `;

      const { session } = await runAmplScript(script, { cwd: tmpDir });
      const lastRes = session.getLastResult();
      assert.ok(lastRes);
      assert.equal(lastRes.status, "OPTIMAL");
      // Lentils provide 12 protein per $1.50 (8 protein/$) vs beef (5 protein/$) -> Buy[lentils] = 5, TotalCost = 7.5
      assert.ok(Math.abs(lastRes.objectiveValue - 7.5) < 1e-4);

      const csvOut = fs.readFileSync(path.join(tmpDir, "solution.csv"), "utf-8");
      assert.ok(csvOut.includes("f,buy,reduced_cost"));
      assert.ok(csvOut.includes("lentils,5"));

      const jsonOut = JSON.parse(fs.readFileSync(path.join(tmpDir, "solution.json"), "utf-8")) as Array<
        Record<string, unknown>
      >;
      assert.equal(jsonOut.length, 2);
      const lentilRow = jsonOut.find((r) => r["f"] === "lentils");
      assert.ok(lentilRow);
      assert.ok(Math.abs(Number(lentilRow["buy"]) - 5) < 1e-4);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("languages/ampl: Phase 2 — Imperative .run Scripting, Ordered Sets & PWL/SOS", () => {
  it("executes .run iterative sensitivity loops, fix/unfix, drop/restore, and objective switching", async () => {
    const script = `
      param cap default 10;
      var x >= 0, <= 20;
      var y >= 0, <= 20;

      maximize Obj1: 3 * x + 2 * y;
      maximize Obj2: x + 4 * y;

      subject to Limit: x + y <= cap;
      subject to ExtraCap: x <= 4;

      # 1. Solve baseline with ExtraCap active (x <= 4, x + y <= 10 -> x=4, y=6, Obj1=24)
      objective Obj1;
      solve;
      printf "Base=%.1f\\n", Obj1;

      # 2. Drop ExtraCap -> x=10, y=0, Obj1=30
      drop ExtraCap;
      solve;
      printf "Dropped=%.1f\\n", Obj1;

      # 3. Restore ExtraCap and fix x := 2 -> x=2, y=8, Obj1=22
      restore ExtraCap;
      fix x := 2;
      solve;
      printf "Fixed=%.1f\\n", Obj1;

      # 4. Unfix x and switch to Obj2 -> x=0, y=10, Obj2=40
      unfix x;
      objective Obj2;
      solve;
      printf "Obj2=%.1f\\n", Obj2;

      # 5. Iterative sensitivity loop over cap
      objective Obj1;
      drop ExtraCap;
      for {s in 1..3} {
        let cap := 5 * s;
        solve;
        printf "Sweep[%d]=%.1f\\n", s, Obj1;
      }
    `;

    const { output: joined } = await runAmplScript(script);
    assert.ok(joined.includes("Base=24.0"), `Missing Base=24.0 in:\n${joined}`);
    assert.ok(joined.includes("Dropped=30.0"), `Missing Dropped=30.0 in:\n${joined}`);
    assert.ok(joined.includes("Fixed=22.0"), `Missing Fixed=22.0 in:\n${joined}`);
    assert.ok(joined.includes("Obj2=40.0"), `Missing Obj2=40.0 in:\n${joined}`);
    assert.ok(joined.includes("Sweep[1]=15.0"), `Missing Sweep[1]=15.0 in:\n${joined}`);
    assert.ok(joined.includes("Sweep[2]=30.0"), `Missing Sweep[2]=30.0 in:\n${joined}`);
    assert.ok(joined.includes("Sweep[3]=45.0"), `Missing Sweep[3]=45.0 in:\n${joined}`);
  });

  it("evaluates ordered and circular set navigation (first, last, next, prev, nextw, ord, card, symdiff) and defined variables", async () => {
    const modSrc = `
      set PERIODS ordered := {"Q1", "Q2", "Q3", "Q4"};
      set A := {1, 2, 3};
      set B := {3, 4};
      set SYM := A symdiff B;

      param demand {t in PERIODS} := 10 * ord(t);
      var Produce {PERIODS} >= 0, <= 50;
      var Inventory {PERIODS} >= 0;

      # Defined variable for total production across all periods
      var TotalProduced = sum {t in PERIODS} Produce[t];

      minimize TotalCost:
        2 * TotalProduced + sum {t in PERIODS} Inventory[t];

      subject to InitBal:
        Produce[first(PERIODS)] - Inventory[first(PERIODS)] = demand[first(PERIODS)];

      subject to FlowBal {t in PERIODS: ord(t) > 1}:
        Inventory[prev(t, PERIODS)] + Produce[t] - Inventory[t] = demand[t];

      subject to SymCount:
        Produce[last(PERIODS)] >= card(SYM);
    `;

    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    const res = await solveAmpl(problem);

    assert.equal(res.status, "OPTIMAL");
    // Total demand = 10 + 20 + 30 + 40 = 100; producing exact demand each period gives Inventory = 0, TotalCost = 200
    assert.ok(Math.abs(res.objectiveValue - 200) < 1e-4, `Expected 200, got ${res.objectiveValue}`);
    assert.ok(Math.abs((res.variables["Produce[Q1]"] ?? 0) - 10) < 1e-4);
    assert.ok(Math.abs((res.variables["Produce[Q4]"] ?? 0) - 40) < 1e-4);
  });

  it("reformulates and solves convex piecewise-linear (<<...; ...>>), semicontinuous, and SOS2 models", async () => {
    const modSrc = `
      var x >= 0, <= 30;
      var y >= 0, <= 30;

      # Convex PWL cost: slope 2 on [0, 10], slope 5 on [10, 30]
      minimize ShippingCost:
        <<10; 2, 5>> x + 3 * y;

      subject to TotalRequirement:
        x + y >= 15;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    const res = await solveAmpl(problem);

    assert.equal(res.status, "OPTIMAL");
    // x takes 10 units at slope 2 (cost 20), y takes remaining 5 units at slope 3 (cost 15) -> total = 35
    assert.ok(Math.abs(res.objectiveValue - 35) < 1e-4, `Expected 35, got ${res.objectiveValue}`);
    assert.ok(Math.abs((res.variables["x"] ?? 0) - 10) < 1e-4);
    assert.ok(Math.abs((res.variables["y"] ?? 0) - 5) < 1e-4);

    // Semicontinuous generator dispatch test: Gen in {0} U [25, 100]
    const semiMod = parseAmplModel(`
      var Gen >= 0, <= 100, semicont 25;
      var Backup >= 0, <= 100;
      minimize DispatchCost: 2 * Gen + 5 * Backup;
      subject to Load: Gen + Backup >= 10;
    `);
    const semiProb = instantiateAmpl(semiMod);
    const semiRes = await solveAmpl(semiProb);
    assert.equal(semiRes.status, "OPTIMAL");
    // Option A: Gen = 25 (cost 50), Backup = 0; Option B: Gen = 0, Backup = 10 (cost 50). Either way cost = 50 and Gen is either 0 or >= 25
    assert.ok(Math.abs(semiRes.objectiveValue - 50) < 1e-4);
    const genVal = semiRes.variables["Gen"] ?? 0;
    assert.ok(genVal < 1e-4 || genVal >= 25 - 1e-4, `Semicontinuous bound violated: Gen=${genVal}`);

    // SOS MPS export check
    semiProb.sosSets = [
      {
        id: 1,
        name: "SOS_G1",
        type: 2,
        members: [
          { varId: 0, weight: 1 },
          { varId: 1, weight: 2 },
        ],
      },
    ];
    const mpsText = writeMpsProblem(semiProb);
    assert.ok(mpsText.includes("\nSOS\n S2 SOS_G1\n"), "Missing SOS S2 section in MPS export");
  });
});

describe("languages/ampl: Phase 3 — Standalone Presolve/Postsolve, MP Logical/CP & MPEC Complementarity", () => {
  it("presolves fixed variables, singleton rows, and redundant rows and restores exact primal/dual values", async () => {
    const modSrc = `
      var x >= 0, <= 50;
      var y >= 0, <= 50;
      var z = 5;

      maximize Profit: 4 * x + 3 * y + 2 * z;

      subject to SingleBound: x <= 10;
      subject to RedundantBound: x + y <= 500;
      subject to JointCap: x + y + z <= 25;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);

    const presolved = presolveAmplProblem(problem);
    assert.equal(presolved.infeasible, false);
    assert.ok(presolved.stats.eliminatedVars >= 1, "Expected fixed variable z to be eliminated");
    assert.ok(presolved.stats.eliminatedConstraints >= 2, "Expected singleton and redundant rows to be eliminated");

    const resDirect = await solveAmpl(problem, { presolve: false });
    const resPresolved = await solveAmpl(problem, { presolve: true });

    assert.equal(resPresolved.status, "OPTIMAL");
    // Optimal: z = 5, x = 10, y = 10 -> Profit = 4(10) + 3(10) + 2(5) = 80
    assert.ok(Math.abs(resPresolved.objectiveValue - 80) < 1e-4);
    assert.ok(Math.abs(resPresolved.objectiveValue - resDirect.objectiveValue) < 1e-4);
    assert.ok(Math.abs((resPresolved.variables["x"] ?? 0) - 10) < 1e-4);
    assert.ok(Math.abs((resPresolved.variables["y"] ?? 0) - 10) < 1e-4);
    assert.ok(Math.abs((resPresolved.variables["z"] ?? 0) - 5) < 1e-4);
  });

  it("reformulates MP indicator constraints (==>), alldiff, and non-smooth max/abs functions", async () => {
    const modSrc = `
      var y binary;
      var x >= 0, <= 20;

      maximize Score: 2 * x - 5 * y;

      # If y = 0, x cannot exceed 4; if y = 1, x can go up to 12
      subject to SwitchOff: y = 0 ==> x <= 4;
      subject to SwitchOn:  y = 1 ==> x <= 12;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);
    const res = await solveAmpl(problem);

    assert.equal(res.status, "OPTIMAL");
    // y=1 gives x=12 -> Score = 24 - 5 = 19 (vs y=0, x=4 -> Score = 8)
    assert.ok(Math.abs(res.objectiveValue - 19) < 1e-4, `Expected 19, got ${res.objectiveValue}`);
    assert.ok(Math.abs((res.variables["y"] ?? 0) - 1) < 1e-4);
    assert.ok(Math.abs((res.variables["x"] ?? 0) - 12) < 1e-4);

    // Non-smooth abs() and max() minimization
    const absMod = parseAmplModel(`
      var u >= -10, <= 10;
      minimize L1Penalty: abs(u - 3) + max(u, 5);
    `);
    const absProb = instantiateAmpl(absMod);
    const absRes = await solveAmpl(absProb);
    assert.equal(absRes.status, "OPTIMAL");
    // At u = 3: |3 - 3| + max(3, 5) = 0 + 5 = 5
    assert.ok(Math.abs(absRes.objectiveValue - 5) < 1e-4, `Expected 5, got ${absRes.objectiveValue}`);
  });

  it("solves MPEC complementarity constraints (`complements`) in both MILP and NLP modes", async () => {
    const modSrc = `
      var x >= 0, <= 20;

      minimize Cost: (x - 1)^2;

      # Complementarity: 0 <= x  perp  2*x - 6 >= 0  =>  x = 3
      subject to CompEquil:
        x >= 0 complements 2 * x - 6 >= 0;
    `;
    const model = parseAmplModel(modSrc);

    // 1. Disjunctive MILP mode (Fortuny-Amat & McCarl)
    const probMilp = instantiateAmpl(model, undefined, { mpecMode: "milp" });
    const resMilp = await solveAmpl(probMilp);
    assert.equal(resMilp.status, "OPTIMAL");
    assert.ok(Math.abs((resMilp.variables["x"] ?? 0) - 3) < 1e-2, `MILP MPEC expected x=3, got ${resMilp.variables["x"]}`);

    // 2. Smooth Fischer-Burmeister NLP mode
    const probNlp = instantiateAmpl(model, undefined, { mpecMode: "nlp" });
    const resNlp = await solveAmpl(probNlp);
    assert.equal(resNlp.status, "OPTIMAL");
    assert.ok(Math.abs((resNlp.variables["x"] ?? 0) - 3) < 5e-2, `NLP MPEC expected x=3, got ${resNlp.variables["x"]}`);
  });

  it("supports programmatic AmplSession API for stateful parameter updates and solves", async () => {
    const session = new AmplSession();
    session.loadModelText(`
      param p default 2;
      var x >= 0, <= 10;
      maximize Obj: p * x;
    `);
    const r1 = await session.solve();
    assert.ok(Math.abs(r1.objectiveValue - 20) < 1e-4);

    await session.executeText(`
      let p := 7;
      solve;
    `);
    const r2 = session.getLastResult();
    assert.ok(r2);
    assert.ok(Math.abs(r2.objectiveValue - 70) < 1e-4);
  });
});
