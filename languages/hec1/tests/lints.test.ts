// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintHec1Deck, parseHec1Deck } from "../src/index.js";

describe("@modelscript/hec1 — Static Linter Diagnostics (HEC11001–HEC15006)", () => {
  it("reports zero diagnostics on a valid multi-station HEC-1 deck", () => {
    const deck = parseHec1Deck(
      [
        "ID VALID WATERSHED MODEL",
        "IT 15 01JUN90 0000 100",
        "KK SUB1",
        "BA 4.5",
        "PB 3.5",
        "LS 0.5 78 10",
        "UC 1.5 2.0",
        "KK RCH1",
        "RM 4 1.0 0.2",
        "KK SUB2",
        "BA 3.2",
        "PI 0.5 1.0 1.5 0.5",
        "LS 0.4 82 20",
        "UD 1.0",
        "KK JUNC1",
        "HC 2",
        "ZZ",
      ].join("\n"),
    );

    const diags = lintHec1Deck(deck);
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("flags syntax errors (HEC11001), missing IT (HEC12001), and missing ZZ (HEC12002)", () => {
    const deck = parseHec1Deck(["ID INCOMPLETE DECK", "QX 1.0", "KK SUB1", "BA 5.0", "PB 2.0", "UD 1.0"].join("\n"));
    const ids = new Set(lintHec1Deck(deck).map((d) => d.id));
    assert.ok(ids.has("HEC11001"));
    assert.ok(ids.has("HEC12001"));
    assert.ok(ids.has("HEC12002"));
  });

  it("flags duplicate KK station ID (HEC12003), non-positive BA (HEC13001), bad CN (HEC13002), and missing precip (HEC13003)", () => {
    const deck = parseHec1Deck(
      [
        "ID ERROR TEST",
        "IT 15 01JUN90 0000 60",
        "KK SUB1",
        "BA -2.5",
        "LS 0.2 105 0",
        "UD 1.0",
        "KK SUB1",
        "BA 3.0",
        "PB 2.0",
        "LS 0.2 0 120",
        "UC -1.0 0.0",
        "ZZ",
      ].join("\n"),
    );

    const ids = new Set(lintHec1Deck(deck).map((d) => d.id));
    assert.ok(ids.has("HEC12003"), "Expected duplicate station ID");
    assert.ok(ids.has("HEC13001"), "Expected non-positive drainage area");
    assert.ok(ids.has("HEC13002"), "Expected CN out of (0, 100]");
    assert.ok(ids.has("HEC13003"), "Expected missing precipitation");
    assert.ok(ids.has("HEC15003"), "Expected invalid Clark UH params");
    assert.ok(ids.has("HEC15004"), "Expected RTIMP out of [0, 100]");
  });

  it("flags Muskingum X out of [0, 0.5] (HEC14001), stability violation dt/(2K) < X (HEC14002), and bad K/NSTPS (HEC14003)", () => {
    const deck = parseHec1Deck(
      [
        "ID MUSKINGUM ERRORS",
        "IT 15 01JUN90 0000 60",
        "KK SUB1",
        "BA 5.0",
        "PB 3.0",
        "LS 0.3 75 0",
        "UD 1.0",
        "KK RCH_BAD_X",
        "RM 2 1.0 0.65",
        "KK RCH_UNSTABLE",
        "RM 1 4.0 0.40",
        "KK RCH_BAD_K",
        "RM 0 -1.0 0.20",
        "ZZ",
      ].join("\n"),
    );

    const ids = new Set(lintHec1Deck(deck).map((d) => d.id));
    assert.ok(ids.has("HEC14001"), "Expected HEC14001 for X = 0.65 > 0.5");
    assert.ok(ids.has("HEC14002"), "Expected HEC14002 for dt/(2K) = 0.25/8 = 0.03125 < 0.40");
    assert.ok(ids.has("HEC14003"), "Expected HEC14003 for K <= 0 / NSTPS < 1");
  });

  it("flags HC combine with < 2 upstream stations (HEC15001), invalid IT (HEC15002), missing UH (HEC15005), and routing without upstream (HEC15006)", () => {
    const deck = parseHec1Deck(
      [
        "ID TOPOLOGY ERRORS",
        "IT 0 01JUN90 0000 -5",
        "KK RCH_ORPHAN",
        "RM 2 1.0 0.2",
        "KK SUB_NO_UH",
        "BA 4.0",
        "PB 2.0",
        "LS 0.3 75 0",
        "KK JUNC_BAD",
        "HC 1",
        "ZZ",
      ].join("\n"),
    );

    const ids = new Set(lintHec1Deck(deck).map((d) => d.id));
    assert.ok(ids.has("HEC15001"), "Expected HEC15001 for HC < 2");
    assert.ok(ids.has("HEC15002"), "Expected HEC15002 for invalid IT");
    assert.ok(ids.has("HEC15005"), "Expected HEC15005 for missing UH");
    assert.ok(ids.has("HEC15006"), "Expected HEC15006 for routing without upstream");
  });
});
