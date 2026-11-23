// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GerberErrorCode } from "../src/errors.js";
import { lintGerber } from "../src/lints/index.js";
import { parseGerber } from "../src/parser/index.js";

describe("@modelscript/gerber — Lints & DFM Diagnostics (GRB1001–GRB5006)", () => {
  it("produces zero diagnostics for a clean RS-274X PCB layer", () => {
    const src = [
      "G04 Clean 2-pad trace*",
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.254*%",
      "%ADD11C,1.200X0.600*%",
      "%LPD*%",
      "G01*",
      "D10*",
      "X0Y0D02*",
      "X100000Y0D01*",
      "D11*",
      "X0Y0D03*",
      "X100000Y0D03*",
      "M02*",
    ].join("\n");

    const diags = lintGerber(parseGerber(src));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("reports GRB1001 syntax error, GRB2001 missing %FS, GRB2002 missing %MO, and GRB4001 missing M02", () => {
    const src = ["%ADD10C,0.254*%", "BADCMD*", "D10*", "X0Y0D03*"].join("\n");
    const diags = lintGerber(parseGerber(src));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(GerberErrorCode.SYNTAX_ERROR.id), "Expected GRB1001");
    assert.ok(ids.has(GerberErrorCode.MISSING_FORMAT_SPEC.id), "Expected GRB2001");
    assert.ok(ids.has(GerberErrorCode.MISSING_UNIT_SPEC.id), "Expected GRB2002");
    assert.ok(ids.has(GerberErrorCode.MISSING_EOF.id), "Expected GRB4001");
  });

  it("reports GRB2003 undefined aperture and GRB3001 draw/flash before aperture selection", () => {
    const src = ["%FSLAX24Y24*%", "%MOMM*%", "X0Y0D02*", "X10000Y0D01*", "D99*", "X10000Y0D03*", "M02*"].join("\n");

    const diags = lintGerber(parseGerber(src));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(GerberErrorCode.DRAW_BEFORE_APERTURE.id), "Expected GRB3001");
    assert.ok(ids.has(GerberErrorCode.UNDEFINED_APERTURE.id), "Expected GRB2003");
  });

  it("reports GRB3002 unclosed G36 region and GRB3003 unmatched G37", () => {
    const unclosed = ["%FSLAX24Y24*%", "%MOMM*%", "G36*", "X0Y0D02*", "X10000Y0D01*", "M02*"].join("\n");
    const diags1 = lintGerber(parseGerber(unclosed));
    assert.ok(
      diags1.some((d) => d.id === "GRB3002"),
      "Expected GRB3002",
    );

    const unmatched = ["%FSLAX24Y24*%", "%MOMM*%", "G37*", "M02*"].join("\n");
    const diags2 = lintGerber(parseGerber(unmatched));
    assert.ok(
      diags2.some((d) => d.id === "GRB3003"),
      "Expected GRB3003",
    );
  });

  it("reports DFM violations: GRB5001 min trace width, GRB5002 min annular ring, GRB5003 zero aperture, GRB5004 hole >= pad", () => {
    const src = [
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.080*%", // 0.080 mm < 0.127 mm min trace width -> GRB5001
      "%ADD11C,0.800X0.650*%", // annular ring = 0.075 mm < 0.127 mm -> GRB5002
      "%ADD12C,0.000*%", // zero-size -> GRB5003
      "%ADD13C,0.600X0.700*%", // hole > pad -> GRB5004
      "D10*",
      "X0Y0D02*",
      "X50000Y0D01*",
      "M02*",
    ].join("\n");

    const diags = lintGerber(parseGerber(src));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("GRB5001"), "Expected GRB5001 min trace width");
    assert.ok(ids.has("GRB5002"), "Expected GRB5002 min annular ring");
    assert.ok(ids.has("GRB5003"), "Expected GRB5003 zero-size aperture");
    assert.ok(ids.has("GRB5004"), "Expected GRB5004 hole exceeds pad");
  });

  it("reports GRB5005 legacy RS-274-D mode and GRB5006 arc radius mismatch", () => {
    const src = [
      "%FSLAX24Y24*%",
      "G71*",
      "%ADD10C,0.254*%",
      "G75*",
      "D10*",
      "X10000Y0D02*",
      // Start (1,0), center (0,0) -> rStart = 1.0 mm, end (0, 2.0) -> rEnd = 2.0 mm -> mismatch!
      "G03X0Y20000I-10000J0D01*",
      "M02*",
    ].join("\n");

    const diags = lintGerber(parseGerber(src));
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("GRB5005"), "Expected GRB5005 legacy RS-274-D info");
    assert.ok(ids.has("GRB5006"), "Expected GRB5006 arc radius mismatch");
  });
});
