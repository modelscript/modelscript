// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSinda, parseSindaDeck } from "../src/index.js";

describe("@modelscript/sinda — Static Thermal Network Linter (SIN1001–SIN5006)", () => {
  it("passes cleanly with zero diagnostics on a valid thermal network", () => {
    const valid = `
HEADER OPTIONS DATA
  TITLE = "Valid Thermal Wall"
HEADER NODE DATA
  1, 350.0, 100.0
  -2, 300.0, 0.0
HEADER CONDUCTOR DATA
  10, 1, 2, 5.0
HEADER SOURCE DATA
  1, 25.0
HEADER CONSTANTS DATA
  TIMEO = 0.0, TIMEND = 100.0, DTIMEI = 1.0
HEADER EXECUTION
  CALL STDSTL
END OF DATA
`;
    const diags = lintSinda(parseSindaDeck(valid));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects SIN1001 (syntax), SIN1002 (missing END OF DATA), SIN2001/2002 (duplicates), SIN2003 (undefined node)", () => {
    const deck = `
HEADER NODE DATA
  1, 300.0, 50.0
  1, 310.0, 50.0
  -2, 290.0, 0.0
  BADLINE
HEADER CONDUCTOR DATA
  10, 1, 2, 1.0
  10, 1, 2, 2.0
  11, 1, 999, 1.0
`;
    const diags = lintSinda(parseSindaDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SIN1001"), "Expected SIN1001 syntax error");
    assert.ok(ids.has("SIN1002"), "Expected SIN1002 missing END OF DATA");
    assert.ok(ids.has("SIN2001"), "Expected SIN2001 duplicate node ID");
    assert.ok(ids.has("SIN2002"), "Expected SIN2002 duplicate conductor ID");
    assert.ok(ids.has("SIN2003"), "Expected SIN2003 undefined conductor node");
  });

  it("detects SIN3001 (self-loop), SIN3002 (negative capacitance), SIN3003 (negative conductance)", () => {
    const deck = `
HEADER NODE DATA
  1, 300.0, -25.0
  -2, 290.0, 0.0
HEADER CONDUCTOR DATA
  10, 1, 1, 2.0
  11, 1, 2, -0.5
END OF DATA
`;
    const diags = lintSinda(parseSindaDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SIN3001"), "Expected SIN3001 self-loop conductor");
    assert.ok(ids.has("SIN3002"), "Expected SIN3002 negative capacitance");
    assert.ok(ids.has("SIN3003"), "Expected SIN3003 negative conductance");
  });

  it("detects SIN4001 (floating subnetwork with no boundary node) and SIN5001 (<= 0 K in radiation network)", () => {
    const deck = `
HEADER NODE DATA
  1, 300.0, 100.0
  2, 300.0, 100.0
  3, 0.0, 50.0
  -4, 4.0, 0.0
HEADER CONDUCTOR DATA
  10, 1, 2, 1.5
  -20, 3, 4, 0.9
END OF DATA
`;
    const diags = lintSinda(parseSindaDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SIN4001"), "Expected SIN4001 floating subnetwork [1, 2]");
    assert.ok(ids.has("SIN5001"), "Expected SIN5001 invalid initial temperature <= 0 K in radiation network");
  });

  it("detects SIN5002 (invalid time control) and SIN5006 (empty thermal network)", () => {
    const deck = `
HEADER CONSTANTS DATA
  TIMEO = 50.0, TIMEND = 10.0, DTIMEI = -1.0
END OF DATA
`;
    const diags = lintSinda(parseSindaDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SIN5002"), "Expected SIN5002 invalid time control");
    assert.ok(ids.has("SIN5006"), "Expected SIN5006 empty thermal network");
  });
});
