// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Doe2ErrorCode } from "../src/errors.js";
import { lintDoe2 } from "../src/lints/index.js";
import { parseDoe2 } from "../src/parser/index.js";

describe("@modelscript/doe2 — Pre-Flight Linter (DOE1001–DOE5006)", () => {
  it("passes cleanly on a valid DOE-2 BDL deck", () => {
    const valid = `
INPUT LOADS ..
"MAT-1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.5 CONDUCTIVITY = 0.8 ..
"LAY-1" = LAYERS MATERIAL = ("MAT-1") ..
"CON-1" = CONSTRUCTION TYPE = LAYERS LAYERS = "LAY-1" ..
"GLZ-1" = GLASS-TYPE GLASS-CONDUCTANCE = 0.35 SHADING-COEFF = 0.55 ..
"DS-1" = DAY-SCHEDULE TYPE = FRACTION VALUES = (0.1, 0.5, 1.0) ..
"SP-1" = SPACE AREA = 500 HEIGHT = 10 ..
"WALL-1" = EXTERIOR-WALL CONSTRUCTION = "CON-1" AREA = 200 ..
"WIN-1" = WINDOW GLASS-TYPE = "GLZ-1" AREA = 40 ..
COMPUTE LOADS ..
INPUT SYSTEMS ..
"SYS-1" = SYSTEM TYPE = PSZ ..
"Z-1" = ZONE SPACE = "SP-1" ..
COMPUTE SYSTEMS ..
STOP ..
`;
    const diags = lintDoe2(parseDoe2(valid));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects DOE1001 syntax error and DOE1002 missing '..' terminator", () => {
    const deck = `
INPUT LOADS ..
"M1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.5 @
"M2" = MATERIAL TYPE = RESISTANCE RESISTANCE = 5 ..
STOP ..
`;
    const diags = lintDoe2(parseDoe2(deck));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(Doe2ErrorCode.SYNTAX_ERROR.code), "Expected DOE1001");
    assert.ok(codes.has(Doe2ErrorCode.MISSING_TERMINATOR.code), "Expected DOE1002");
  });

  it("detects duplicate object names (DOE2001) and undefined cross-references (DOE2002–DOE2006)", () => {
    const deck = `
INPUT LOADS ..
"M1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.5 CONDUCTIVITY = 0.8 ..
"M1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.3 CONDUCTIVITY = 0.5 ..
"L1" = LAYERS MATERIAL = ("M1", "NO-SUCH-MAT") ..
"C1" = CONSTRUCTION TYPE = LAYERS LAYERS = "NO-SUCH-LAYERS" ..
"S1" = SPACE AREA = 400 HEIGHT = 10 ..
"W1" = EXTERIOR-WALL CONSTRUCTION = "NO-SUCH-CON" AREA = 100 ..
"WIN1" = WINDOW GLASS-TYPE = "NO-SUCH-GLZ" AREA = 20 ..
INPUT SYSTEMS ..
"Z1" = ZONE SPACE = "NO-SUCH-SPACE" ..
STOP ..
`;
    const diags = lintDoe2(parseDoe2(deck));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("DOE2001"), "Expected DOE2001 duplicate object name");
    assert.ok(codes.has("DOE2002"), "Expected DOE2002 undefined construction LAYERS");
    assert.ok(codes.has("DOE2003"), "Expected DOE2003 undefined surface CONSTRUCTION");
    assert.ok(codes.has("DOE2004"), "Expected DOE2004 undefined window GLASS-TYPE");
    assert.ok(codes.has("DOE2005"), "Expected DOE2005 undefined zone SPACE");
    assert.ok(codes.has("DOE2006"), "Expected DOE2006 undefined layers MATERIAL");
  });

  it("detects non-positive thickness, conductivity, area, invalid schedule values, and missing STOP", () => {
    const deck = `
INPUT LOADS ..
"M-BAD" = MATERIAL TYPE = PROPERTIES THICKNESS = 0 CONDUCTIVITY = -0.5 ..
"DS-BAD" = DAY-SCHEDULE TYPE = FRACTION VALUES = (0.5, 1.4, 0.2) ..
"SP-BAD" = SPACE AREA = -100 HEIGHT = 10 ..
"WALL-BAD" = EXTERIOR-WALL AREA = 0 ..
`;
    const diags = lintDoe2(parseDoe2(deck));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("DOE3001"), "Expected DOE3001 non-positive thickness");
    assert.ok(codes.has("DOE3002"), "Expected DOE3002 non-positive conductivity");
    assert.ok(codes.has("DOE3003"), "Expected DOE3003 non-positive area");
    assert.ok(codes.has("DOE3004"), "Expected DOE3004 invalid schedule value");
    assert.ok(codes.has("DOE5001"), "Expected DOE5001 missing STOP");
  });
});
