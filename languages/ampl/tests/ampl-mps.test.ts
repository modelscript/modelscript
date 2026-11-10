// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  instantiateAmpl,
  parseAmplModel,
  parseMpsProblem,
  solveAmpl,
  writeMpsProblem,
} from "../src/index.js";

test("AMPL MPS Writer & Parser — roundtrips and solves linear program (LP)", async () => {
  const modelText = `
var x1 >= 0, <= 40;
var x2 >= 0;

maximize Total_Profit: 3 * x1 + 2 * x2;

subject to Labor_Limit: 2 * x1 + x2 <= 100;
subject to Material_Limit: x1 + x2 <= 80;
`;

  const model = parseAmplModel(modelText);
  const instantiated = instantiateAmpl(model);

  // 1. Serialize to MPS format
  const mpsText = writeMpsProblem(instantiated, { name: "PROD_PLAN" });

  assert.ok(mpsText.includes("NAME          PROD_PLAN"), "MPS should include NAME card");
  assert.ok(mpsText.includes("OBJSENSE\n  MAX"), "MPS should include OBJSENSE MAX");
  assert.ok(mpsText.includes("ROWS"), "MPS should include ROWS section");
  assert.ok(mpsText.includes("COLUMNS"), "MPS should include COLUMNS section");
  assert.ok(mpsText.includes("RHS"), "MPS should include RHS section");
  assert.ok(mpsText.includes("BOUNDS"), "MPS should include BOUNDS section");
  assert.ok(mpsText.includes("ENDATA"), "MPS should include ENDATA card");

  // 2. Parse back from MPS
  const parsed = parseMpsProblem(mpsText);

  assert.strictEqual(parsed.name, "PROD_PLAN");
  assert.strictEqual(parsed.problemClass, "LP");
  assert.strictEqual(parsed.objective.direction, "maximize");
  assert.strictEqual(parsed.variables.length, 2);
  assert.strictEqual(parsed.constraints.length, 2);

  // 3. Solve the parsed MPS problem using in-WASM simplex solver
  const result = await solveAmpl(parsed);

  assert.strictEqual(result.status, "OPTIMAL");
  assert.ok(Math.abs(result.objectiveValue - 180) < 1e-4, `Expected 180, got ${result.objectiveValue}`);

  const x1Val = result.variables["x1"] ?? 0;
  const x2Val = result.variables["x2"] ?? 0;
  assert.ok(Math.abs(x1Val - 20) < 1e-4, `Expected x1=20, got ${x1Val}`);
  assert.ok(Math.abs(x2Val - 60) < 1e-4, `Expected x2=60, got ${x2Val}`);
});

test("AMPL MPS Parser — ingests standard Free MPS text with integer markers (MILP)", async () => {
  // Classical 0-1 Knapsack MILP in MPS format
  const sampleMps = `
NAME          KNAPSACK
OBJSENSE
  MAX
ROWS
 N  OBJ
 L  CAPACITY
COLUMNS
    MARK0001  'MARKER'                 'INTORG'
    X1        OBJ                  5.0   CAPACITY             2.0
    X2        OBJ                  3.0   CAPACITY             8.0
    X3        OBJ                  2.0   CAPACITY             4.0
    X4        OBJ                  7.0   CAPACITY             2.0
    X5        OBJ                  4.0   CAPACITY             5.0
    MARK0002  'MARKER'                 'INTEND'
RHS
    RHS1      CAPACITY            10.0
BOUNDS
 BV BND1      X1
 BV BND1      X2
 BV BND1      X3
 BV BND1      X4
 BV BND1      X5
ENDATA
`;

  const problem = parseMpsProblem(sampleMps);

  assert.strictEqual(problem.name, "KNAPSACK");
  assert.strictEqual(problem.problemClass, "MILP");
  assert.strictEqual(problem.variables.length, 5);
  for (const v of problem.variables) {
    assert.strictEqual(v.type, "binary");
    assert.strictEqual(v.lb, 0);
    assert.strictEqual(v.ub, 1);
  }

  // Solve with in-WASM Branch-and-Bound solver
  const result = await solveAmpl(problem);

  assert.strictEqual(result.status, "OPTIMAL");
  // Optimal knapsack: items X1(5, w=2), X4(7, w=2), X5(4, w=5) -> Total weight = 9 <= 10, Total value = 16
  assert.ok(Math.abs(result.objectiveValue - 16) < 1e-4, `Expected objective 16, got ${result.objectiveValue}`);
  assert.strictEqual(result.variables["X1"], 1);
  assert.strictEqual(result.variables["X2"], 0);
  assert.strictEqual(result.variables["X3"], 0);
  assert.strictEqual(result.variables["X4"], 1);
  assert.strictEqual(result.variables["X5"], 1);
});

test("AMPL MPS Writer & Parser — handles range constraints and double-sided bounds", async () => {
  const sampleMpsWithRanges = `
NAME          RANGED_PROBLEM
ROWS
 N  COST
 E  CORRIDOR
COLUMNS
    Y1        COST                 10.0   CORRIDOR             1.0
    Y2        COST                 15.0   CORRIDOR             2.0
RHS
    RHS1      CORRIDOR            100.0
RANGES
    RHS1      CORRIDOR             20.0
BOUNDS
 LO BND       Y1                   10.0
 UP BND       Y1                   50.0
 LO BND       Y2                   20.0
 UP BND       Y2                   60.0
ENDATA
`;

  const parsed = parseMpsProblem(sampleMpsWithRanges);

  assert.strictEqual(parsed.name, "RANGED_PROBLEM");
  assert.strictEqual(parsed.constraints.length, 1);
  const corridor = parsed.constraints[0]!;
  assert.strictEqual(corridor.name, "CORRIDOR");
  // Range r=20 on E row with rhs=100 means 100 <= sum <= 120
  assert.strictEqual(corridor.lb, 100);
  assert.strictEqual(corridor.ub, 120);

  // Solve minimization: min 10*Y1 + 15*Y2 s.t. 100 <= Y1 + 2*Y2 <= 120, 10<=Y1<=50, 20<=Y2<=60
  const result = await solveAmpl(parsed);
  assert.strictEqual(result.status, "OPTIMAL");
  // Optimal solution: Y1 = 10, Y2 = 45 => 10 + 2*45 = 100, Cost = 10*10 + 15*45 = 100 + 675 = 775.
  assert.ok(Math.abs(result.objectiveValue - 775) < 1e-4, `Expected 775, got ${result.objectiveValue}`);
});
