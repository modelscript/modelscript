// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TrasysErrorCode, lintTrasys } from "../src/lints/index.js";
import { parseTrasysDeck } from "../src/parser/index.js";

describe("TRASYS Static Analysis Lints (TRA1001–TRA5006)", () => {
  it("produces zero diagnostics for a valid TRASYS deck", () => {
    const deck = parseTrasysDeck(`
HEADER OPTIONS DATA
  MODEL = VALID_SAT
HEADER SURFACE DATA
  S D1 DISK R=1.0 NODE=10 PROP=WHITE_PAINT_Z93 ACTIVE=TOP
  S D2 DISK R=1.0 NODE=20 PROP=SILVER_TEFLON ACTIVE=BOTTOM TZ=1.0
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = 500
  BETA = 15
  SOLAR = 1361
  ALBEDO = 0.30
  PLANETIR = 237
HEADER OPERATIONS DATA
  FFCAL
  RKCAL
  QCAL
END OF DATA
`);
    const diags = lintTrasys(deck);
    assert.strictEqual(diags.length, 0);
  });

  it("detects TRA1001 syntax error and TRA1002 missing END OF DATA", () => {
    const deck = parseTrasysDeck(`
BAD LINE OUTSIDE HEADER
HEADER SURFACE DATA
  S P1 SPHERE R=1.0 NODE=1 PROP=0.5, 0.5
`);
    const diags = lintTrasys(deck);
    const ids = diags.map((d) => d.id);
    assert.ok(ids.includes(TrasysErrorCode.SYNTAX_ERROR.id));
    assert.ok(ids.includes(TrasysErrorCode.MISSING_END_OF_DATA.id));
  });

  it("detects TRA2001 duplicate surface ID and TRA2002 duplicate node ID", () => {
    const deck = parseTrasysDeck(`
HEADER SURFACE DATA
  S P1 RECTANGLE W=1 H=1 NODE=100 PROP=0.5, 0.8
  S P1 RECTANGLE W=1 H=1 NODE=100 PROP=0.5, 0.8
END OF DATA
`);
    const diags = lintTrasys(deck);
    const ids = diags.map((d) => d.id);
    assert.ok(ids.includes("TRA2001"));
    assert.ok(ids.includes("TRA2002"));
  });

  it("detects TRA3001 invalid alpha_s and TRA3002 invalid epsilon_IR", () => {
    const deck = parseTrasysDeck(`
HEADER SURFACE DATA
  S P1 SPHERE R=1.0 NODE=10 PROP=1.25, -0.1
END OF DATA
`);
    const diags = lintTrasys(deck);
    const ids = diags.map((d) => d.id);
    assert.ok(ids.includes("TRA3001"));
    assert.ok(ids.includes("TRA3002"));
  });

  it("detects TRA4001 non-positive dimension and TRA4002 invalid polygon vertices", () => {
    const deck = parseTrasysDeck(`
HEADER SURFACE DATA
  S R1 RECTANGLE W=-2.0 H=0.0 NODE=1 PROP=0.5, 0.8
  S PG1 POLYGON (0,0,0) (1,0,0) NODE=2 PROP=0.5, 0.8
END OF DATA
`);
    const diags = lintTrasys(deck);
    const ids = diags.map((d) => d.id);
    assert.ok(ids.includes("TRA4001"));
    assert.ok(ids.includes("TRA4002"));
  });

  it("detects TRA5001–TRA5004 invalid orbit parameters", () => {
    const deck = parseTrasysDeck(`
HEADER SURFACE DATA
  S P1 SPHERE R=1.0 NODE=1 PROP=0.5, 0.8
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = -100
  BETA = 120
  ALBEDO = 1.5
  SOLAR = -50
END OF DATA
`);
    const diags = lintTrasys(deck);
    const ids = diags.map((d) => d.id);
    assert.ok(ids.includes("TRA5001"));
    assert.ok(ids.includes("TRA5002"));
    assert.ok(ids.includes("TRA5003"));
    assert.ok(ids.includes("TRA5004"));
  });

  it("detects TRA5005 unmapped thermal node and TRA5006 no active surfaces", () => {
    const deckUnmapped = parseTrasysDeck(`
HEADER SURFACE DATA
  S P1 SPHERE R=1.0 PROP=0.5, 0.8 ACTIVE=TOP
END OF DATA
`);
    assert.ok(lintTrasys(deckUnmapped).some((d) => d.id === "TRA5005"));

    const deckInactive = parseTrasysDeck(`
HEADER SURFACE DATA
  S SHADE1 RECTANGLE W=2 H=2 PROP=0.5, 0.8 ACTIVE=NONE SHADE=YES
END OF DATA
`);
    assert.ok(lintTrasys(deckInactive).some((d) => d.id === "TRA5006"));
  });
});
