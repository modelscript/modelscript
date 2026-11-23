// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gamsToAmpl, gamsToModelica, gamsToMps } from "../src/index.js";

const SAMPLE_MIP = `
$title Sample Knapsack
Set i / i1, i2 / ;
Parameters
  v(i) / i1 10, i2 25 /
  w(i) / i1 3,  i2 4 / ;
Scalar cap / 5 / ;
Binary Variables x(i) ;
Variable z ;
Equations obj, wt ;
obj.. z =e= sum(i, v(i)*x(i)) ;
wt..  sum(i, w(i)*x(i)) =l= cap ;
Model knap / all / ;
Solve knap using mip maximizing z ;
`;

describe("@modelscript/gams — Projections (MPS, AMPL, Modelica)", () => {
  it("projects GAMS MIP to valid MPS with OBJSENSE, ROWS, COLUMNS, INTORG/INTEND, RHS, BOUNDS, ENDATA", () => {
    const mps = gamsToMps(SAMPLE_MIP);
    assert.ok(mps.includes("NAME          knap"));
    assert.ok(mps.includes("MAX"));
    assert.ok(mps.includes("ROWS"));
    assert.ok(mps.includes("COLUMNS"));
    assert.ok(mps.includes("'INTORG'"));
    assert.ok(mps.includes("'INTEND'"));
    assert.ok(mps.includes("RHS"));
    assert.ok(mps.includes("BOUNDS"));
    assert.ok(mps.includes("BV BND1"));
    assert.ok(mps.includes("FR BND1"));
    assert.ok(mps.trimEnd().endsWith("ENDATA"));
  });

  it("projects GAMS model to AMPL .mod and .dat", () => {
    const { mod, dat } = gamsToAmpl(SAMPLE_MIP);
    assert.ok(mod.includes("set i;"));
    assert.ok(mod.includes("param v{i};"));
    assert.ok(mod.includes("var x{i} binary;"));
    assert.ok(mod.includes("maximize Objective: z;"));
    assert.ok(mod.includes("subject to obj:"));
    assert.ok(mod.includes("subject to wt:"));
    assert.ok(dat.includes("set i := 'i1' 'i2';"));
    assert.ok(dat.includes("param cap := 5;"));
  });

  it("projects GAMS model to Modelica .mo with bounds and slack variables", () => {
    const mo = gamsToModelica(SAMPLE_MIP);
    assert.ok(mo.includes("model knap"));
    assert.ok(mo.includes("Integer x_i1(min=0, max=1);"));
    assert.ok(mo.includes("Real slack_wt(min=0.0);"));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("end knap;"));
  });
});
