// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintNec2, parseNec2Deck } from "../src/index.js";

describe("@modelscript/nec2 Static Analysis & Lints (NEC1001–NEC5006)", () => {
  it("reports zero diagnostics on a clean half-wave dipole deck", () => {
    const deck = parseNec2Deck(`
CM Clean Half-Wave Dipole
CE
GW 1 21 0 0 -0.25 0 0 0.25 0.001
GE 0
FR 0 1 0 0 300 0
EX 0 1 11 0 1 0
RP 0 37 1 1000 0 0 5 0
EN
`);
    const diags = lintNec2(deck);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects NEC1001 syntax error and NEC1002/NEC1003/NEC1004 missing termination cards", () => {
    const deck = parseNec2Deck(`
CM Missing CE, GE, and EN
ZZ 1 2 3
GW 1 11 0 0 -0.25 0 0 0.25 0.001
`);
    const ids = new Set(lintNec2(deck).map((d) => d.id));
    assert.ok(ids.has("NEC1001"), "Expected NEC1001 syntax error");
    assert.ok(ids.has("NEC1002"), "Expected NEC1002 missing CE");
    assert.ok(ids.has("NEC1003"), "Expected NEC1003 missing GE");
    assert.ok(ids.has("NEC1004"), "Expected NEC1004 missing EN");
  });

  it("detects NEC2001 zero-length wire, NEC2002 radius >= segLen, and NEC2003 thin-wire ratio < 2", () => {
    const deck = parseNec2Deck(`
CM Geometry Defects
CE
GW 1 11 0 0 0 0 0 0 0.001
GW 2 10 0 0 0 0 0 0.1 0.015
GW 3 10 0 0 0 0 0 0.1 0.007
GE 0
FR 0 1 0 0 300 0
EX 0 3 5 0 1 0
EN
`);
    const ids = new Set(lintNec2(deck).map((d) => d.id));
    assert.ok(ids.has("NEC2001"), "Expected NEC2001 zero-length wire");
    assert.ok(ids.has("NEC2002"), "Expected NEC2002 wire radius >= segment length");
    assert.ok(ids.has("NEC2003"), "Expected NEC2003 thin-wire ratio Δ/a < 2");
  });

  it("detects NEC3001 undefined wire tag and NEC3002 segment out of range on EX and LD", () => {
    const deck = parseNec2Deck(`
CM Bad Tag and Segment
CE
GW 1 11 0 0 -0.25 0 0 0.25 0.001
GE 0
FR 0 1 0 0 300 0
EX 0 99 1 0 1 0
EX 0 1 15 0 1 0
LD 0 88 1 1 50 0 0
LD 0 1 1 20 50 0 0
EN
`);
    const diags = lintNec2(deck);
    assert.strictEqual(diags.filter((d) => d.id === "NEC3001").length, 2);
    assert.strictEqual(diags.filter((d) => d.id === "NEC3002").length, 2);
  });

  it("detects NEC4001 under-segmented wire (> lambda/10) and NEC5001–NEC5006 control defects", () => {
    const deck = parseNec2Deck(`
CM Under-segmented and Control Defects
CE
GW 1 3 0 0 -0.5 0 0 0.5 0.001
GW 1 11 1 0 -0.1 1 0 0.2 0.001
GE 1
GN -1
FR 0 1 0 0 -10 0
FR 0 1 0 0 300 0
LD 4 1 1 1 -50 0 0
RP 0 19 1 1000 0 0 5 0
EN
`);
    const ids = new Set(lintNec2(deck).map((d) => d.id));
    assert.ok(ids.has("NEC4001"), "Expected NEC4001 under-segmented wire");
    assert.ok(ids.has("NEC5001"), "Expected NEC5001 invalid frequency <= 0");
    assert.ok(ids.has("NEC5002"), "Expected NEC5002 missing EX before RP");
    assert.ok(ids.has("NEC5003"), "Expected NEC5003 GE/GN mismatch");
    assert.ok(ids.has("NEC5004"), "Expected NEC5004 wire below ground");
    assert.ok(ids.has("NEC5005"), "Expected NEC5005 duplicate wire tag");
    assert.ok(ids.has("NEC5006"), "Expected NEC5006 negative load resistance");
  });
});
