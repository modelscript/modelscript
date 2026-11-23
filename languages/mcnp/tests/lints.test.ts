// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintMcnpDeck } from "../src/lints/index.js";
import { parseMcnpDeck } from "../src/parser/index.js";

describe("MCNP Static Linter (MCNP1001–MCNP5006)", () => {
  it("reports zero errors on a valid criticality deck", () => {
    const deck = parseMcnpDeck(`Valid Godiva Deck
1 1 -18.74 -1 IMP:N=1
2 0 1 IMP:N=0

1 SO 8.741

MODE N
M1 92235.80c 1.0
KCODE 1000 1.0 10 50
KSRC 0 0 0
F4:N 1
`);
    const diags = lintMcnpDeck(deck);
    assert.strictEqual(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
  });

  it("detects duplicate cell, surface, and material IDs (MCNP2001–MCNP2003)", () => {
    const deck = parseMcnpDeck(`Duplicates Deck
1 1 -1.0 -1 IMP:N=1
1 0 1 IMP:N=0

1 SO 5.0
1 SO 10.0

M1 1001.80c 1.0
M1 8016.80c 1.0
SDEF POS=0 0 0
`);
    const codes = lintMcnpDeck(deck).map((d) => d.id);
    assert.ok(codes.includes("MCNP2001"), "Expected MCNP2001 duplicate cell ID");
    assert.ok(codes.includes("MCNP2002"), "Expected MCNP2002 duplicate surface ID");
    assert.ok(codes.includes("MCNP2003"), "Expected MCNP2003 duplicate material ID");
  });

  it("detects undefined surfaces, undefined materials, and undefined tally targets (MCNP2004–MCNP2006)", () => {
    const deck = parseMcnpDeck(`Undefined Refs Deck
1 99 -1.0 -42 IMP:N=1
2 0 1 IMP:N=0

1 SO 5.0

M1 1001.80c 1.0
SDEF POS=0 0 0
F1:N 77
F4:N 88
`);
    const codes = lintMcnpDeck(deck).map((d) => d.id);
    assert.ok(codes.includes("MCNP2004"), "Expected MCNP2004 undefined surface");
    assert.ok(codes.includes("MCNP2005"), "Expected MCNP2005 undefined material");
    assert.strictEqual(codes.filter((c) => c === "MCNP2006").length, 2, "Expected 2 MCNP2006 tally target errors");
  });

  it("detects invalid ZAID and mixed atom/weight fraction signs (MCNP3001, MCNP3002)", () => {
    const deck = parseMcnpDeck(`Material Errors Deck
1 1 -1.0 -1 IMP:N=1
2 0 1 IMP:N=0

1 SO 5.0

M1 92X.bad 0.5 8016.80c -0.5
SDEF POS=0 0 0
`);
    const codes = lintMcnpDeck(deck).map((d) => d.id);
    assert.ok(codes.includes("MCNP3001"), "Expected MCNP3001 invalid ZAID");
    assert.ok(codes.includes("MCNP3002"), "Expected MCNP3002 mixed fraction signs");
  });

  it("detects missing graveyard cell and missing source card (MCNP4001, MCNP4002)", () => {
    const deck = parseMcnpDeck(`No Graveyard Or Source
1 1 -1.0 -1 IMP:N=1

1 SO 5.0

M1 1001.80c 1.0
`);
    const codes = lintMcnpDeck(deck).map((d) => d.id);
    assert.ok(codes.includes("MCNP4001"), "Expected MCNP4001 missing graveyard cell");
    assert.ok(codes.includes("MCNP4002"), "Expected MCNP4002 missing source card");
  });

  it("detects invalid surface params, non-positive radius, invalid VOL/NPS/KCODE, and circular complement (MCNP5001–MCNP5006)", () => {
    const deck = parseMcnpDeck(`Structural Errors Deck
1 0 -1 #2 IMP:N=1 VOL=-5.0
2 0 -2 #1 IMP:N=0

1 SO -3.0
2 RPP 0 1 2

KCODE -10 1.0 20 10
NPS -50
`);
    const codes = lintMcnpDeck(deck).map((d) => d.id);
    assert.ok(codes.includes("MCNP5001"), "Expected MCNP5001 invalid surface param count");
    assert.ok(codes.includes("MCNP5002"), "Expected MCNP5002 non-positive radius");
    assert.ok(codes.includes("MCNP5003"), "Expected MCNP5003 invalid cell volume");
    assert.ok(codes.includes("MCNP5004"), "Expected MCNP5004 invalid NPS");
    assert.ok(codes.includes("MCNP5005"), "Expected MCNP5005 invalid KCODE params");
    assert.ok(codes.includes("MCNP5006"), "Expected MCNP5006 circular cell complement");
  });
});
