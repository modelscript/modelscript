// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMps, presolveMps, solveMps } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

describe("@modelscript/mps Numerical Benchmarks (Netlib-style LP, Bounded LP, Binary MIP)", () => {
  it("solves Netlib-style AFIRO mini-benchmark LP to optimal tolerance", () => {
    // Classic Netlib AFIRO-style multi-activity linear program (minimization)
    // min -0.4 X02 - 0.32 X14 + 0.6 X23 + 0.48 X36
    // with equality balance rows and upper capacity limits
    const afiroMini = `
* Netlib-style AFIRO mini-benchmark
NAME          AFIRO_MINI
ROWS
 N  COST
 E  R09
 E  R10
 L  X05
 L  X21
 E  R12
COLUMNS
    X01       R09       1.0          X05       1.0
    X02       COST      -0.4         R09       -1.06
    X02       R10       1.0
    X03       R10       -1.0         X21       1.0
    X04       R10       -1.0         R12       1.0
    X14       COST      -0.32        R12       -1.4
    X14       X21       1.0
    X23       COST      0.6          X05       1.0
    X23       R12       1.0
RHS
    RHS1      X05       80.0         X21       50.0
    RHS1      R09       0.0          R10       0.0
    RHS1      R12       0.0
ENDATA
`;
    const res = solveMps(afiroMini);
    assert.strictEqual(res.status, "optimal");
    // Analytical check:
    // X01 <= 80 => X02 = X01 / 1.06 <= 80 / 1.06 = 75.4716981132
    // X03 + X04 = X02; X14 = X04 / 1.4; X03 + X14 <= 50
    // Maximize 0.4 * X02 + 0.32 * X14: set X03 = 0, X04 = X02, X14 = X02 / 1.4 <= 50 => X02 <= 70
    // Optimal: X02 = 70, X01 = 74.2, X04 = 70, X14 = 50, X03 = 0, X23 = 0
    // Objective = -0.4 * 70 - 0.32 * 50 = -28 - 16 = -44.0
    const expectedObj = -44.0;
    const tolerance = 1e-6;
    assert.ok(
      relErr(res.objectiveValue, expectedObj) < tolerance,
      `Expected obj ${expectedObj}, got ${res.objectiveValue} (relErr=${relErr(res.objectiveValue, expectedObj)})`,
    );
    assert.ok(relErr(res.primal["X02"]!, 70) < tolerance);
    assert.ok(relErr(res.primal["X14"]!, 50) < tolerance);
  });

  it("solves Netlib-style SC50A staircase dynamic LP mini-benchmark", () => {
    // Staircase two-period production/inventory LP (Netlib SC50A structure)
    // Period 1 & 2 production P1, P2, inventory I1, I2, capacity constraints
    const sc50aMini = `
* Netlib-style SC50A staircase LP mini-benchmark
NAME          SC50A_MINI
ROWS
 N  OBJ
 E  BAL1
 E  BAL2
 L  CAP1
 L  CAP2
COLUMNS
    P1        OBJ       10.0         BAL1      1.0
    P1        CAP1      1.0
    I1        OBJ       2.0          BAL1      -1.0
    I1        BAL2      1.0
    P2        OBJ       15.0         BAL2      1.0
    P2        CAP2      1.0
    I2        OBJ       2.0          BAL2      -1.0
RHS
    RHS1      BAL1      30.0         BAL2      50.0
    RHS1      CAP1      60.0         CAP2      40.0
ENDATA
`;
    const res = solveMps(sc50aMini);
    assert.strictEqual(res.status, "optimal");
    // Optimal: produce 60 in period 1 (cheaper: 10+2=12 < 15), carry I1=30 to period 2, produce P2=20, I2=0
    // Objective = 10*60 + 2*30 + 15*20 = 600 + 60 + 300 = 960.0
    const expectedObj = 960.0;
    const tolerance = 1e-6;
    assert.ok(
      relErr(res.objectiveValue, expectedObj) < tolerance,
      `Expected obj ${expectedObj}, got ${res.objectiveValue}`,
    );
    assert.ok(relErr(res.primal["P1"]!, 60) < tolerance);
    assert.ok(relErr(res.primal["I1"]!, 30) < tolerance);
    assert.ok(relErr(res.primal["P2"]!, 20) < tolerance);
  });

  it("solves bounded LP with LO, UP, FX, FR, and RANGES (including presolve)", () => {
    const boundedLp = `
NAME          BOUNDED_LP
OBJSENSE
  MAX
ROWS
 N  PROFIT
 L  RES1
 G  RES2
COLUMNS
    X1        PROFIT    5.0          RES1      2.0
    X1        RES2      1.0
    X2        PROFIT    4.0          RES1      1.0
    X2        RES2      1.0
    X3        PROFIT    10.0         RES1      1.0
    X4        PROFIT    -1.0         RES2      1.0
RHS
    RHS1      RES1      16.0         RES2      6.0
RANGES
    RNG1      RES1      10.0
BOUNDS
 LO BND1      X1        1.0
 UP BND1      X1        5.0
 UP BND1      X2        8.0
 FX BND1      X3        2.0
 FR BND1      X4
 LO BND1      X4        -2.0
 UP BND1      X4        3.0
ENDATA
`;
    const model = parseMps(boundedLp);
    const pre = presolveMps(model);
    assert.strictEqual(pre.status, "reduced");
    assert.strictEqual(pre.stats.fixedVarsEliminated, 1, "X3 fixed variable should be eliminated by presolve");

    const res = solveMps(model);
    assert.strictEqual(res.status, "optimal");
    // X3 = 2 (fixed, contributes 20 to profit and 2 to RES1 => 2*X1 + X2 <= 14)
    // X4 maximizes -X4 subject to X1 + X2 + X4 >= 6, X4 >= -2 => X4 = -2 (contributes +2 to profit)
    // Maximize 5*X1 + 4*X2 subject to 2*X1 + X2 <= 14, 1<=X1<=5, 0<=X2<=8, X1+X2 >= 8:
    // Corner (3, 8): 2*3 + 8 = 14, X1+X2 = 11 >= 8, profit = 15 + 32 = 47
    // Total objective = 20 + 2 + 47 = 69.0
    const expectedObj = 69.0;
    const tolerance = 1e-6;
    assert.ok(
      relErr(res.objectiveValue, expectedObj) < tolerance,
      `Expected obj ${expectedObj}, got ${res.objectiveValue}`,
    );
    assert.ok(relErr(res.primal["X1"]!, 3) < tolerance);
    assert.ok(relErr(res.primal["X2"]!, 8) < tolerance);
    assert.ok(relErr(res.primal["X3"]!, 2) < tolerance);
    assert.ok(relErr(res.primal["X4"]!, -2) < tolerance);
  });

  it("solves 0-1 binary knapsack MIP via Branch-and-Bound to exact integer optimum", () => {
    // 0-1 Knapsack: max 10*x1 + 13*x2 + 18*x3 + 31*x4 + 7*x5
    // s.t. 2*x1 + 3*x2 + 4*x3 + 7*x4 + 2*x5 <= 10, x_i in {0, 1}
    // Optimal integer solution: x1=1 (w=2,v=10), x2=0, x3=1 (w=4,v=18), x4=0, x5=1 (w=2,v=7) -> w=8,v=35
    // Wait: x2=1(3,13) + x4=1(7,31) -> w=10, v=44!
    // Check x1(2,10)+x2(3,13)+x3(4,18) -> w=9, v=41; x1(2,10)+x4(7,31) -> w=9, v=41; x2(3,13)+x4(7,31) -> w=10, v=44!
    // LP relaxation would take x1=1(10), x3=1(18), x4=4/7(17.71) -> 45.71 (fractional!), so B&B must branch!
    const knapsackMip = `
NAME          KNAPSACK01
OBJSENSE
  MAX
ROWS
 N  VALUE
 L  WEIGHT
COLUMNS
    MARK0001  'MARKER'           'INTORG'
    X1        VALUE     10       WEIGHT    2
    X2        VALUE     13       WEIGHT    3
    X3        VALUE     18       WEIGHT    4
    X4        VALUE     31       WEIGHT    7
    X5        VALUE     7        WEIGHT    2
    MARK0002  'MARKER'           'INTEND'
RHS
    RHS1      WEIGHT    10
BOUNDS
 BV BND1      X1
 BV BND1      X2
 BV BND1      X3
 BV BND1      X4
 BV BND1      X5
ENDATA
`;
    const res = solveMps(knapsackMip);
    assert.strictEqual(res.status, "optimal");
    const expectedObj = 44.0;
    const tolerance = 1e-6;
    assert.ok(
      relErr(res.objectiveValue, expectedObj) < tolerance,
      `Expected MIP obj ${expectedObj}, got ${res.objectiveValue}`,
    );
    assert.strictEqual(res.primal["X1"], 0);
    assert.strictEqual(res.primal["X2"], 1);
    assert.strictEqual(res.primal["X3"], 0);
    assert.strictEqual(res.primal["X4"], 1);
    assert.strictEqual(res.primal["X5"], 0);
    assert.ok((res.nodesExplored ?? 0) >= 3, "Expected Branch-and-Bound to explore multiple nodes");
  });
});
