// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintCplexLpSource } from "../src/index.js";

describe("@modelscript/cplex-lp Lints & Diagnostics Suite (LP1001–LP5006)", () => {
  it("reports zero diagnostics on a clean valid model", () => {
    const source = `
Maximize
  z: 3 x1 + 5 x2
Subject To
  c1: x1 <= 4
  c2: 2 x2 <= 12
  c3: 3 x1 + 2 x2 <= 18
Bounds
  0 <= x1 <= 10
  0 <= x2 <= 10
End
`;
    const diags = lintCplexLpSource(source);
    assert.strictEqual(diags.length, 0);
  });

  it("detects LP1001 syntax error", () => {
    const source = `
Minimize
  x1 + x2
Subject To
  c1: x1 + x2
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP1001" && d.severity === "error"));
  });

  it("detects LP2001 missing objective and LP2002 missing End", () => {
    const source = `
Subject To
  c1: x1 + x2 <= 10
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP2001" && d.severity === "error"));
    assert.ok(diags.some((d) => d.id === "LP2002" && d.severity === "warning"));
  });

  it("detects LP3001 duplicate constraint name", () => {
    const source = `
Minimize
  x1 + x2
Subject To
  cap: x1 <= 5
  cap: x2 <= 5
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP3001" && d.symbol === "cap"));
  });

  it("detects LP4001 contradictory variable bounds", () => {
    const source = `
Minimize
  x1
Subject To
  c1: x1 >= 0
Bounds
  10 <= x1 <= 2
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP4001" && d.symbol === "x1"));
  });

  it("detects LP4002 variable declared both binary and free", () => {
    const source = `
Minimize
  y1
Subject To
  c1: y1 <= 1
Bounds
  y1 free
Binaries
  y1
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP4002" && d.symbol === "y1"));
  });

  it("detects LP5001 empty/unbounded constraint", () => {
    const source = `
Minimize
  x1
Subject To
  empty_row: <= 5
  c1: x1 >= 1
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP5001" && d.symbol === "empty_row"));
  });

  it("detects LP5002 invalid SOS weights and LP5003 invalid SOS type", () => {
    const source = `
Minimize
  x1 + x2 + x3
Subject To
  c1: x1 + x2 + x3 <= 1
SOS
  s_dup: S1:: x1:1 x2:1
  s_bad: S3:: x1:1 x3:2
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP5002"));
    assert.ok(diags.some((d) => d.id === "LP5003" && d.symbol === "s_bad"));
  });

  it("detects LP5004 binary bound conflict, LP5005 semi-continuous negative bound, and LP5006 unreferenced variable", () => {
    const source = `
Minimize
  y1 + s1
Subject To
  c1: y1 + s1 >= 1
Bounds
  0 <= y1 <= 5
  -2 <= s1 <= 10
Binaries
  y1
Semi-Continuous
  s1
Generals
  unused_g
End
`;
    const diags = lintCplexLpSource(source);
    assert.ok(diags.some((d) => d.id === "LP5004" && d.symbol === "y1"));
    assert.ok(diags.some((d) => d.id === "LP5005" && d.symbol === "s1"));
    assert.ok(diags.some((d) => d.id === "LP5006" && d.symbol === "unused_g"));
  });
});
