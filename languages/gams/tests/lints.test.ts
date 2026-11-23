// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GamsErrorCode, lintGamsSource } from "../src/index.js";

describe("@modelscript/gams — Lints & Diagnostics (GAMS1001–GAMS5006)", () => {
  it("reports zero errors on a valid GAMS LP model", () => {
    const valid = `
Sets i / a, b / ;
Parameter c(i) / a 2, b 3 / ;
Variables x(i), z ;
Positive Variable x ;
Equations obj, cap ;
obj.. z =e= sum(i, c(i)*x(i)) ;
cap.. sum(i, x(i)) =g= 10 ;
Model m / obj, cap / ;
Solve m using lp minimizing z ;
`;
    const diags = lintGamsSource(valid);
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects GAMS1001 syntax errors", () => {
    const diags = lintGamsSource(`eq.. x + y ;`);
    assert.ok(diags.some((d) => d.id === GamsErrorCode.SYNTAX_ERROR.id));
  });

  it("detects GAMS2001 duplicate symbols, GAMS2002 undefined set, GAMS2003 undefined parameter, GAMS2004 undefined variable", () => {
    const src = `
Set i / a, b / ;
Set i / c, d / ;
Parameter p(missingSet) / a 1 / ;
Variables x(i), z ;
Equations eq ;
eq.. z =e= sum(i, missingParam(i) * x(i)) ;
ghostVar.lo = 0 ;
Model m / eq / ;
Solve m using lp minimizing z ;
`;
    const diags = lintGamsSource(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("GAMS2001"), "Expected GAMS2001 duplicate symbol");
    assert.ok(ids.has("GAMS2002"), "Expected GAMS2002 undefined set");
    assert.ok(ids.has("GAMS2003"), "Expected GAMS2003 undefined parameter");
    assert.ok(ids.has("GAMS2004"), "Expected GAMS2004 undefined variable");
  });

  it("detects GAMS3001 domain index mismatch", () => {
    const src = `
Sets i / a, b /, j / c, d / ;
Variables x(i,j), z ;
Equations eq ;
eq.. z =e= sum(i, x(i)) ;
Model m / eq / ;
Solve m using lp minimizing z ;
`;
    const diags = lintGamsSource(src);
    assert.ok(diags.some((d) => d.id === "GAMS3001"));
  });

  it("detects GAMS4001 undeclared equation in Model, GAMS4002 missing objective variable, GAMS4003 invalid solver type, and GAMS5006 undeclared model", () => {
    const src = `
Variables x, z ;
Equations eq1 ;
eq1.. z =e= x ;
Model m / eq1, ghostEq / ;
Solve ghostModel using bogusSolver minimizing ghostObj ;
`;
    const diags = lintGamsSource(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("GAMS4001"), "Expected GAMS4001 undeclared equation in Model");
    assert.ok(ids.has("GAMS4002"), "Expected GAMS4002 missing objective variable");
    assert.ok(ids.has("GAMS4003"), "Expected GAMS4003 invalid solver type");
    assert.ok(ids.has("GAMS5006"), "Expected GAMS5006 undeclared model in Solve");
  });

  it("detects GAMS5001 conflicting bounds, GAMS5002 empty set, GAMS5003 undefined equation, GAMS5004 non-free objective, GAMS5005 nonlinear in LP", () => {
    const src = `
Set emptySet / / ;
Positive Variables x, z ;
x.lo = 10 ;
x.up = 5 ;
Equations eq1, eqUnused ;
eq1.. z =e= x * x ;
Model m / eq1 / ;
Solve m using lp minimizing z ;
`;
    const diags = lintGamsSource(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("GAMS5001"), "Expected GAMS5001 conflicting bounds");
    assert.ok(ids.has("GAMS5002"), "Expected GAMS5002 empty set");
    assert.ok(ids.has("GAMS5003"), "Expected GAMS5003 equation not defined");
    assert.ok(ids.has("GAMS5004"), "Expected GAMS5004 non-free objective variable");
    assert.ok(ids.has("GAMS5005"), "Expected GAMS5005 nonlinear in LP");
  });
});
