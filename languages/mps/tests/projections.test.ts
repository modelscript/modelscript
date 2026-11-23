// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mpsToAmpl, mpsToCplexLp, mpsToModelica, parseMps } from "../src/index.js";

describe("@modelscript/mps Projections Suite (CPLEX LP, Modelica, AMPL)", () => {
  const sample = `
NAME          DIET_MIP
OBJSENSE
  MIN
ROWS
 N  COST
 G  PROTEIN
 L  CALORIES
COLUMNS
    OATS      COST      3        PROTEIN   4
    OATS      CALORIES  110
    MARK0001  'MARKER'           'INTORG'
    MILK      COST      5        PROTEIN   8
    MILK      CALORIES  160
    MARK0002  'MARKER'           'INTEND'
RHS
    RHS1      PROTEIN   20       CALORIES  500
BOUNDS
 UP BND1      OATS      10
 BV BND1      MILK
ENDATA
`;

  it("projects MPS model to valid CPLEX LP format", () => {
    const lp = mpsToCplexLp(sample);
    assert.ok(lp.includes("Minimize"));
    assert.ok(lp.includes("COST:"));
    assert.ok(lp.includes("Subject To"));
    assert.ok(lp.includes("PROTEIN:"));
    assert.ok(lp.includes(">= 20"));
    assert.ok(lp.includes("CALORIES:"));
    assert.ok(lp.includes("<= 500"));
    assert.ok(lp.includes("Bounds"));
    assert.ok(lp.includes("Binaries"));
    assert.ok(lp.includes("MILK"));
    assert.ok(lp.includes("End"));
  });

  it("projects MPS model to valid Modelica model", () => {
    const mo = mpsToModelica(sample);
    assert.ok(mo.includes("model DIET_MIP"));
    assert.ok(mo.includes("Real OATS(min = 0, max = 10);"));
    assert.ok(mo.includes("Integer MILK(min = 0, max = 1);"));
    assert.ok(mo.includes("output Real COST"));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("end DIET_MIP;"));
  });

  it("projects MPS model to valid AMPL .mod format", () => {
    const ampl = mpsToAmpl(parseMps(sample));
    assert.ok(ampl.includes("var OATS >= 0 <= 10;"));
    assert.ok(ampl.includes("var MILK binary;"));
    assert.ok(ampl.includes("minimize COST:"));
    assert.ok(ampl.includes("subject to PROTEIN:"));
    assert.ok(ampl.includes("subject to CALORIES:"));
  });
});
