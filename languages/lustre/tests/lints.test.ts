// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintLustreSource } from "../src/index.js";

describe("@modelscript/lustre — Static Analysis, Clock Calculus & Causality Lints", () => {
  it("passes clean synchronous Lustre nodes with zero diagnostics", () => {
    const valid = `
node Integrator(u, dt: real) returns (y: real);
let
  y = 0.0 -> (pre(y) + dt * u);
  assert dt > 0.0;
tel
`;
    const diags = lintLustreSource(valid);
    assert.strictEqual(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
  });

  it("detects syntax errors (LUST1001) and duplicate declarations (LUST2001, LUST2002)", () => {
    const dupNode = `
node A(x: int) returns (y: int); let y = x; tel
node A(x: int) returns (y: int); let y = x; tel
`;
    assert.ok(lintLustreSource(dupNode).some((d) => d.id === "LUST2001"));

    const dupVar = `
node B(x: int) returns (y: int);
var y: int;
let y = x; tel
`;
    assert.ok(lintLustreSource(dupVar).some((d) => d.id === "LUST2002"));

    const syntaxErr = `node Bad(x: int) returns (y: int); let y = ; tel`;
    assert.ok(lintLustreSource(syntaxErr).some((d) => d.id === "LUST1001"));
  });

  it("detects undefined variables (LUST2003) and undefined nodes (LUST2004)", () => {
    const undef = `
node U(x: int) returns (y: int);
let
  y = MissingNode(x + ghost);
tel
`;
    const diags = lintLustreSource(undef);
    assert.ok(diags.some((d) => d.id === "LUST2003" && d.symbolName === "ghost"));
    assert.ok(diags.some((d) => d.id === "LUST2004" && d.symbolName === "MissingNode"));
  });

  it("detects instantaneous algebraic causality cycles without pre (LUST4001)", () => {
    const cyclic = `
node Cycle(u: int) returns (a, b: int);
let
  a = b + u;
  b = a + 1;
tel
`;
    const diags = lintLustreSource(cyclic);
    assert.ok(
      diags.some((d) => d.id === "LUST4001"),
      "Expected LUST4001 causality cycle",
    );

    // Breaking the cycle with `pre` must be accepted cleanly
    const acyclic = `
node Acyclic(u: int) returns (a, b: int);
let
  a = 0 -> (pre(b) + u);
  b = a + 1;
tel
`;
    const acyclicDiags = lintLustreSource(acyclic);
    assert.strictEqual(acyclicDiags.filter((d) => d.id === "LUST4001").length, 0);
  });

  it("detects uninitialized pre without -> guard (LUST4002)", () => {
    const uninit = `
node Uninit(x: int) returns (y: int);
let
  y = pre(x) + 1;
tel
`;
    const diags = lintLustreSource(uninit);
    assert.ok(
      diags.some((d) => d.id === "LUST4002"),
      "Expected LUST4002 uninitialized pre warning",
    );
  });

  it("detects clock mismatch in binary expressions (LUST3002)", () => {
    const badClock = `
node BadClock(x, y: int; c: bool) returns (z: int);
var
  xs: int when c;
let
  xs = x when c;
  z = xs + y;
tel
`;
    const diags = lintLustreSource(badClock);
    assert.ok(
      diags.some((d) => d.id === "LUST3002"),
      "Expected LUST3002 clock mismatch",
    );
  });

  it("detects type mismatches (LUST3001) and missing output equations (LUST5001)", () => {
    const badTypes = `
node BadTypes(x: int; b: bool) returns (y: real; missing_out: int);
let
  y = x + b;
tel
`;
    const diags = lintLustreSource(badTypes);
    assert.ok(
      diags.some((d) => d.id === "LUST3001"),
      "Expected LUST3001 type mismatch",
    );
    assert.ok(
      diags.some((d) => d.id === "LUST5001" && d.symbolName === "missing_out"),
      "Expected LUST5001 missing output",
    );
  });

  it("rejects temporal operators inside pure functions (LUST5004) and non-bool asserts (LUST5005)", () => {
    const badFn = `
function Pure(x: int) returns (y: int);
let
  y = 0 -> pre(x);
  assert x;
tel
`;
    const diags = lintLustreSource(badFn);
    assert.ok(diags.some((d) => d.id === "LUST5004"));
    assert.ok(diags.some((d) => d.id === "LUST5005"));
  });
});
