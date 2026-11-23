// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMps } from "../src/index.js";

describe("@modelscript/mps Parser Suite (Fixed & Free MPS)", () => {
  it("parses classic 80-column fixed-format IBM MPS deck", () => {
    const fixedDeck = [
      "* CLASSIC 80-COLUMN IBM MPSX/370 LP DECK",
      "NAME          TESTLP",
      "ROWS",
      " N  COST",
      " L  LIM1",
      " G  LIM2",
      " E  MYEQN",
      "COLUMNS",
      "    XONE      COST      1              LIM1      1",
      "    XONE      LIM2      1",
      "    YTWO      COST      4              LIM1      1",
      "    YTWO      MYEQN     -1",
      "    ZTHREE    COST      9              LIM2      1",
      "    ZTHREE    MYEQN     1",
      "RHS",
      "    RHS1      LIM1      5              LIM2      10",
      "    RHS1      MYEQN     7",
      "BOUNDS",
      " UP BND1      XONE      4",
      " LO BND1      YTWO      -1",
      " UP BND1      YTWO      1",
      "ENDATA",
    ].join("\n");

    const model = parseMps(fixedDeck, { format: "fixed" });
    assert.strictEqual(model.name, "TESTLP");
    assert.strictEqual(model.format, "fixed");
    assert.strictEqual(model.sense, "MIN");
    assert.strictEqual(model.problemClass, "LP");
    assert.strictEqual(model.objectiveRow, "COST");
    assert.strictEqual(model.rows.size, 4);
    assert.strictEqual(model.columns.size, 3);
    assert.strictEqual(model.parseIssues.length, 0);

    assert.strictEqual(model.rows.get("LIM1")?.rhs, 5);
    assert.strictEqual(model.rows.get("LIM2")?.rhs, 10);
    assert.strictEqual(model.rows.get("MYEQN")?.rhs, 7);

    const x1 = model.columns.get("XONE")!;
    assert.strictEqual(x1.lb, 0);
    assert.strictEqual(x1.ub, 4);
    assert.strictEqual(x1.entries.length, 3);

    const y2 = model.columns.get("YTWO")!;
    assert.strictEqual(y2.lb, -1);
    assert.strictEqual(y2.ub, 1);
  });

  it("parses free-format MPS with OBJSENSE MAX, RANGES, and all BOUNDS types", () => {
    const freeDeck = `
* Free-format MPS with all bound types
NAME          ALLBOUNDS
OBJSENSE
  MAX
ROWS
 N  OBJ
 L  R1
 G  R2
 E  R3
COLUMNS
    X_FREE    OBJ       2.5          R1        1.0
    X_FIXED   OBJ       1.0          R1        1.0
    X_MI      OBJ       -0.5         R2        1.0
    X_PL      OBJ       3.0          R3        1.0
    MARK0001  'MARKER'               'INTORG'
    Y_BIN     OBJ       5.0          R1        2.0
    Y_INT     OBJ       4.0          R2        1.5
    MARK0002  'MARKER'               'INTEND'
RHS
    RHS1      R1        20.0         R2        5.0
    RHS1      R3        10.0
RANGES
    RNG1      R1        6.0          R3        2.0
BOUNDS
 FR BND1      X_FREE
 FX BND1      X_FIXED   3.5
 MI BND1      X_MI
 PL BND1      X_PL
 BV BND1      Y_BIN
 LI BND1      Y_INT     1
 UI BND1      Y_INT     8
ENDATA
`;

    const model = parseMps(freeDeck);
    assert.strictEqual(model.name, "ALLBOUNDS");
    assert.strictEqual(model.sense, "MAX");
    assert.strictEqual(model.problemClass, "MILP");
    assert.strictEqual(model.parseIssues.length, 0);

    assert.strictEqual(model.rows.get("R1")?.range, 6.0);
    assert.strictEqual(model.rows.get("R3")?.range, 2.0);

    assert.strictEqual(model.columns.get("X_FREE")?.lb, -Infinity);
    assert.strictEqual(model.columns.get("X_FREE")?.ub, Infinity);
    assert.strictEqual(model.columns.get("X_FIXED")?.lb, 3.5);
    assert.strictEqual(model.columns.get("X_FIXED")?.ub, 3.5);
    assert.strictEqual(model.columns.get("X_MI")?.lb, -Infinity);
    assert.strictEqual(model.columns.get("X_MI")?.ub, 0);
    assert.strictEqual(model.columns.get("X_PL")?.lb, 0);
    assert.strictEqual(model.columns.get("X_PL")?.ub, Infinity);

    assert.strictEqual(model.columns.get("Y_BIN")?.varType, "binary");
    assert.strictEqual(model.columns.get("Y_BIN")?.lb, 0);
    assert.strictEqual(model.columns.get("Y_BIN")?.ub, 1);

    assert.strictEqual(model.columns.get("Y_INT")?.varType, "integer");
    assert.strictEqual(model.columns.get("Y_INT")?.lb, 1);
    assert.strictEqual(model.columns.get("Y_INT")?.ub, 8);
  });

  it("parses QUADOBJ and QMATRIX quadratic programming decks", () => {
    const qpDeck = `
NAME          QP_DEMO
ROWS
 N  OBJ
 G  C1
COLUMNS
    X1        OBJ       -2           C1        1
    X2        OBJ       -6           C1        1
RHS
    RHS1      C1        2
QUADOBJ
    X1        X1        2
    X1        X2        -1
    X2        X2        4
ENDATA
`;
    const model = parseMps(qpDeck);
    assert.strictEqual(model.problemClass, "QP");
    assert.strictEqual(model.quadObj.length, 3);
    assert.strictEqual(model.quadObj[0]?.coeff, 2);
    assert.strictEqual(model.quadObj[1]?.col1, "X1");
    assert.strictEqual(model.quadObj[1]?.col2, "X2");
    assert.strictEqual(model.quadObj[1]?.coeff, -1);
  });
});
