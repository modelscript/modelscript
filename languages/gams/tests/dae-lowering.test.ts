// SPDX-License-Identifier: AGPL-3.0-or-later

import { VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { instantiateGams, lowerGamsToDae } from "../src/index.js";

const SIMPLE_MIP = `
Sets i / item1, item2, item3 / ;
Parameters
  v(i) / item1 10, item2 20, item3 30 /
  w(i) / item1 2,  item2 3,  item3 5 / ;
Scalar cap / 5 / ;
Binary Variable x(i) ;
Variable z ;
Equations obj, wt ;
obj.. z =e= sum(i, v(i)*x(i)) ;
wt..  sum(i, w(i)*x(i)) =l= cap ;
Model knap / all / ;
Solve knap using mip maximizing z ;
`;

describe("@modelscript/gams — Relational Instantiation & DAEBuilder Lowering", () => {
  it("instantiates sets, parameters, variables, and equations into a flat problem", () => {
    const prob = instantiateGams(SIMPLE_MIP);
    assert.equal(prob.name, "knap");
    assert.equal(prob.sense, "maximizing");
    assert.equal(prob.solverType, "mip");
    assert.equal(prob.variables.length, 4); // x('item1'), x('item2'), x('item3'), z
    assert.equal(prob.constraints.length, 2); // obj, wt

    const xVars = prob.variables.filter((v) => v.baseName === "x");
    assert.equal(xVars.length, 3);
    for (const xv of xVars) {
      assert.equal(xv.varKind, "binary");
      assert.equal(xv.lb, 0);
      assert.equal(xv.ub, 1);
    }
  });

  it("lowers instantiated GAMS problem directly into DAEBuilder linear memory arena", () => {
    const dae = lowerGamsToDae(SIMPLE_MIP);
    const vars = dae.variables();
    const eqs = dae.equations();
    // 4 decision vars + 1 _obj_z + 1 _slack_wt = 6 variables
    assert.equal(vars.length, 6);
    // 1 objective equation + 2 constraint equations = 3 equations
    assert.equal(eqs.length, 3);

    // Binary variables lowered as VarType.Integer
    assert.equal(dae.getVarType(0), VarType.Integer);
    assert.equal(dae.getVarType(1), VarType.Integer);
    assert.equal(dae.getVarType(2), VarType.Integer);
    // Free scalar objective variable z lowered as VarType.Real
    assert.equal(dae.getVarType(3), VarType.Real);
  });
});
