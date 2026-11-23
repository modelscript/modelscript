// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMps, solveMps, writeMps } from "../src/index.js";

describe("@modelscript/mps Writer & Roundtrip Suite", () => {
  const sampleMip = `
NAME          RT_MIP
OBJSENSE
  MAX
ROWS
 N  OBJ
 L  CAP
 G  MINREQ
COLUMNS
    X1        OBJ       6        CAP       2
    X1        MINREQ    1
    MARK0001  'MARKER'           'INTORG'
    Y1        OBJ       11       CAP       3
    Y1        MINREQ    1
    MARK0002  'MARKER'           'INTEND'
RHS
    RHS1      CAP       10       MINREQ    2
RANGES
    RNG1      CAP       6
BOUNDS
 LO BND1      X1        0.5
 UP BND1      X1        4.0
 BV BND1      Y1
ENDATA
`;

  it("round-trips MILP through free-format writeMps -> parseMps with identical solution", () => {
    const m1 = parseMps(sampleMip);
    const sol1 = solveMps(m1);

    const emitted = writeMps(m1, { fixedFormat: false });
    const m2 = parseMps(emitted);
    const sol2 = solveMps(m2);

    assert.strictEqual(m2.name, m1.name);
    assert.strictEqual(m2.sense, m1.sense);
    assert.strictEqual(m2.problemClass, m1.problemClass);
    assert.strictEqual(m2.rows.size, m1.rows.size);
    assert.strictEqual(m2.columns.size, m1.columns.size);
    assert.strictEqual(sol1.status, "optimal");
    assert.strictEqual(sol2.status, "optimal");
    assert.ok(Math.abs(sol1.objectiveValue - sol2.objectiveValue) < 1e-8);
  });

  it("round-trips LP/MILP through 80-column fixed-format writeMps -> parseMps", () => {
    const m1 = parseMps(sampleMip);
    const fixedText = writeMps(m1, { fixedFormat: true });

    // Every non-empty line in fixed format should stay within 80 columns
    for (const line of fixedText.split(/\r?\n/)) {
      assert.ok(line.length <= 80, `Fixed-format line exceeded 80 columns: '${line}'`);
    }

    const m2 = parseMps(fixedText, { format: "fixed" });
    assert.strictEqual(m2.format, "fixed");
    assert.strictEqual(m2.rows.size, m1.rows.size);
    assert.strictEqual(m2.columns.size, m1.columns.size);
    assert.strictEqual(m2.columns.get("Y1")?.varType, "binary");
    assert.strictEqual(m2.columns.get("X1")?.lb, 0.5);
    assert.strictEqual(m2.columns.get("X1")?.ub, 4.0);
  });

  it("round-trips QUADOBJ quadratic program", () => {
    const qp = `
NAME          QP_RT
ROWS
 N  OBJ
 E  SUM1
COLUMNS
    X1        OBJ       -1       SUM1      1
    X2        OBJ       -2       SUM1      1
RHS
    RHS1      SUM1      5
QUADOBJ
    X1        X1        2
    X1        X2        0.5
    X2        X2        3
ENDATA
`;
    const m1 = parseMps(qp);
    const emitted = writeMps(m1);
    const m2 = parseMps(emitted);

    assert.strictEqual(m2.problemClass, "QP");
    assert.strictEqual(m2.quadObj.length, 3);
    assert.strictEqual(m2.quadObj[2]?.coeff, 3);
  });
});
