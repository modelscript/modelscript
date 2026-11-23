// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintHec2Text } from "../src/index.js";

describe("@modelscript/hec2 — Lints & Diagnostics (HEC21001–HEC25006)", () => {
  it("produces zero diagnostics for a valid HEC-2 card deck", () => {
    const valid = [
      "T1  VALID HEC-2 CHANNEL",
      "J1,0,0,0,0,0.001,1,0,50,12.0",
      "NC,0.04,0.04,0.025,0.1,0.3",
      "X1,100,4,0,10,0,0,0",
      "GR,20,0,10,0,10,10,20,10",
      "X1,200,4,0,10,100,100,100",
      "GR,20.1,0,10.1,0,10.1,10,20.1,10",
      "EJ",
    ].join("\n");

    const diags = lintHec2Text(valid);
    assert.equal(diags.length, 0, `Expected no diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("reports HEC21001 syntax error for unrecognized card codes and bad numbers", () => {
    const bad = ["T1  BAD CARD", "ZZ  123 456", "J1,0,0,0,0,0.001,1,0,abc,12.0", "EJ"].join("\n");

    const diags = lintHec2Text(bad);
    const syntaxDiags = diags.filter((d) => d.codeId === "HEC21001");
    assert.ok(syntaxDiags.length >= 2, `Expected >= 2 HEC21001 diagnostics, got ${syntaxDiags.length}`);
  });

  it("reports HEC22001 missing J1 and HEC22002 missing EJ/ER", () => {
    const missing = [
      "T1  NO JOB OR END CARD",
      "NC,0.04,0.04,0.03,0.1,0.3",
      "X1,100,4,0,10,0,0,0",
      "GR,20,0,10,0,10,10,20,10",
      "X1,200,4,0,10,100,100,100",
      "GR,20.1,0,10.1,0,10.1,10,20.1,10",
    ].join("\n");

    const diags = lintHec2Text(missing);
    assert.ok(
      diags.some((d) => d.codeId === "HEC22001"),
      "Expected HEC22001 missing J1",
    );
    assert.ok(
      diags.some((d) => d.codeId === "HEC22002"),
      "Expected HEC22002 missing EJ/ER",
    );
  });

  it("reports HEC23001 non-positive Manning's n on NC and NH cards", () => {
    const badN = [
      "T1  BAD MANNING",
      "J1,0,0,0,0,0.001,1,0,50,12.0",
      "NC,0.04,-0.02,0.0,0.1,0.3",
      "NH,2,0.03,5,-0.01,10",
      "X1,100,4,0,10,0,0,0",
      "GR,20,0,10,0,10,10,20,10",
      "X1,200,4,0,10,100,100,100",
      "GR,20.1,0,10.1,0,10.1,10,20.1,10",
      "EJ",
    ].join("\n");

    const diags = lintHec2Text(badN);
    const nDiags = diags.filter((d) => d.codeId === "HEC23001");
    assert.equal(nDiags.length, 3, `Expected 3 HEC23001 diagnostics (XNR, XNCH, NH), got ${nDiags.length}`);
  });

  it("reports HEC24001 GR count mismatch, HEC24002 non-monotonic station, and HEC24003 out-of-bounds bank stations", () => {
    const badGeom = [
      "T1  BAD GEOMETRY",
      "J1,0,0,0,0,0.001,1,0,50,12.0",
      "NC,0.04,0.04,0.03,0.1,0.3",
      "X1,100,5,-5,15,0,0,0",
      "GR,20,0,10,8,10,5,20,10",
      "X1,200,4,0,10,100,100,100",
      "GR,20.1,0,10.1,0,10.1,10,20.1,10",
      "EJ",
    ].join("\n");

    const diags = lintHec2Text(badGeom);
    assert.ok(
      diags.some((d) => d.codeId === "HEC24001"),
      "Expected HEC24001 GR count mismatch",
    );
    assert.ok(
      diags.some((d) => d.codeId === "HEC24002"),
      "Expected HEC24002 non-monotonic GR station",
    );
    assert.ok(
      diags.some((d) => d.codeId === "HEC24003"),
      "Expected HEC24003 bank station out of GR range",
    );
  });

  it("reports HEC25001 negative reach lengths, HEC25002 non-positive discharge, and HEC25006 insufficient cross-sections", () => {
    const badFlow = [
      "T1  BAD REACH AND FLOW",
      "J1,0,0,0,0,0.001,1,0,-10,12.0",
      "NC,0.04,0.04,0.03,0.1,0.3",
      "X1,100,4,0,10,-50,0,-100",
      "GR,20,0,10,0,10,10,20,10",
      "EJ",
    ].join("\n");

    const diags = lintHec2Text(badFlow);
    assert.ok(
      diags.some((d) => d.codeId === "HEC25001"),
      "Expected HEC25001 negative reach length",
    );
    assert.ok(
      diags.some((d) => d.codeId === "HEC25002"),
      "Expected HEC25002 non-positive discharge",
    );
    assert.ok(
      diags.some((d) => d.codeId === "HEC25006"),
      "Expected HEC25006 insufficient cross-sections",
    );
  });
});
