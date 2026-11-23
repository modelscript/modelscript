// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSlam } from "../src/lints/index.js";
import { parseSlamDeck } from "../src/parser/index.js";

describe("@modelscript/slam — Lints & Diagnostics (SLAM1001–SLAM5006)", () => {
  it("produces zero diagnostics on a valid combined SLAM II model", () => {
    const valid = `
GEN, PRITSKER, VALID_MODEL, 1/1/1979, 1;
LIMITS, 2, 2, 50;
CONTINUOUS, 1, 0, 0.01, 0.1, 0.1;
INTLC, SS(1)=0.0, XX(1)=1.0;
INITIALIZE, 0.0, 10.0;
DD(1) = 10.0 * XX(1);
NETWORK;
  RESOURCE/SERVER(1), 1;
  CREATE, 2.0, 0.0, 1;
  AWAIT(1), SERVER/1;
  ACTIVITY/1, 1.0, 1.0, REL;
REL FREE, SERVER/1;
  TERMINATE;
  DETECT, SS(1), XP, 50.0, 0.01;
  ASSIGN, XX(1)=0.0;
  TERMINATE;
ENDNETWORK;
FIN;
`;
    const diags = lintSlam(parseSlamDeck(valid));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("flags SLAM1001 syntax error and SLAM3002 missing FIN", () => {
    const deck = `
GEN, TEST, BAD_SYNTAX, 1/1/1979, 1;
BOGUS_NODE, 123;
`;
    const diags = lintSlam(parseSlamDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SLAM1001"), "Expected SLAM1001 syntax error");
    assert.ok(ids.has("SLAM3002"), "Expected SLAM3002 missing FIN");
  });

  it("flags SLAM2001 undefined resource, SLAM2002 undefined label, SLAM2003 undefined gate", () => {
    const deck = `
NETWORK;
  AWAIT(1), GHOST_RES/1;
  FREE, GHOST_RES/1;
  OPEN, GHOST_GATE;
  ACTIVITY/1, 1.0, 1.0, NO_SUCH_LABEL;
ENDNETWORK;
FIN;
`;
    const diags = lintSlam(parseSlamDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SLAM2001"), "Expected SLAM2001 undefined resource");
    assert.ok(ids.has("SLAM2002"), "Expected SLAM2002 undefined node label");
    assert.ok(ids.has("SLAM2003"), "Expected SLAM2003 undefined gate");
  });

  it("flags SLAM3001 unmatched NETWORK/ENDNETWORK", () => {
    const deck = `
NETWORK;
  CREATE, 1.0;
  TERMINATE;
FIN;
`;
    const diags = lintSlam(parseSlamDeck(deck));
    assert.ok(
      diags.some((d) => d.id === "SLAM3001"),
      "Expected SLAM3001 unmatched NETWORK",
    );
  });

  it("flags SLAM4001 invalid CONTINUOUS NNEQD/NNEQS count and SLAM5006 undeclared state", () => {
    const badCount = `
CONTINUOUS, 1, 0, 0.01, 0.1, 0.1;
DD(2) = 1.0;
FIN;
`;
    const d1 = lintSlam(parseSlamDeck(badCount));
    assert.ok(
      d1.some((d) => d.id === "SLAM4001"),
      "Expected SLAM4001 for DD(2) > NNEQD=1",
    );

    const zeroCount = `
CONTINUOUS, 0, 0, 0.01, 0.1, 0.1;
FIN;
`;
    const d2 = lintSlam(parseSlamDeck(zeroCount));
    assert.ok(
      d2.some((d) => d.id === "SLAM4001"),
      "Expected SLAM4001 for NNEQD+NNEQS=0",
    );

    const noCont = `
DD(1) = -0.5 * SS(1);
FIN;
`;
    const d3 = lintSlam(parseSlamDeck(noCont));
    assert.ok(
      d3.some((d) => d.id === "SLAM5006"),
      "Expected SLAM5006 for DD(1) without CONTINUOUS",
    );
  });

  it("flags SLAM4002 invalid DETECT direction and SLAM5002/SLAM5004/SLAM5005 node errors", () => {
    const deck = `
NETWORK;
  RESOURCE/BADRES(0), 1;
L1 CREATE, 1.0, 0.0, 1, -5;
L1 QUEUE(1), 0, -2;
  ACTIVITY/1, 1.0, 1.5;
  DETECT, SS(1), SIDEWAYS, 10.0, 0.01;
ENDNETWORK;
FIN;
`;
    const diags = lintSlam(parseSlamDeck(deck));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("SLAM4002"), "Expected SLAM4002 invalid DETECT direction");
    assert.ok(ids.has("SLAM5001"), "Expected SLAM5001 invalid CREATE MC");
    assert.ok(ids.has("SLAM5002"), "Expected SLAM5002 invalid RESOURCE capacity");
    assert.ok(ids.has("SLAM5003"), "Expected SLAM5003 invalid QUEUE capacity");
    assert.ok(ids.has("SLAM5004"), "Expected SLAM5004 invalid ACTIVITY probability");
    assert.ok(ids.has("SLAM5005"), "Expected SLAM5005 duplicate node label");
  });
});
