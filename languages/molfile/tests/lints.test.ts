// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { lintMolfile } from "../src/lints/index.js";
import { parseMolfileDocument } from "../src/parser/molfile-parser.js";

describe("Molfile Chemical Structure Lints (MOL1001–MOL5006)", () => {
  it("reports zero diagnostics for valid canonical Molfiles", () => {
    for (const molText of Object.values(CANONICAL_MOLFILES)) {
      const diags = lintMolfile(parseMolfileDocument(molText));
      assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
    }
  });

  it("detects MOL1001 syntax error and MOL1002 missing M  END", () => {
    const truncated = ["Incomplete", "  ModelScript", "missing counts"].join("\n");
    const diags = lintMolfile(parseMolfileDocument(truncated));
    assert.ok(diags.some((d) => d.code === "MOL1001"));
    assert.ok(diags.some((d) => d.code === "MOL1002"));
  });

  it("detects MOL2001 atom count mismatch and MOL2002 bond count mismatch", () => {
    const mismatch = [
      "CountMismatch",
      "  ModelScript         2D",
      "",
      "  4  3  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5200    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
    ].join("\n");
    const diags = lintMolfile(parseMolfileDocument(mismatch));
    assert.ok(diags.some((d) => d.code === "MOL2001"));
    assert.ok(diags.some((d) => d.code === "MOL2002"));
  });

  it("detects MOL2003 out-of-range bond atom index", () => {
    const badBondIdx = [
      "OutOfRange",
      "  ModelScript         2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5200    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  9  1  0  0  0  0",
      "M  END",
    ].join("\n");
    const diags = lintMolfile(parseMolfileDocument(badBondIdx));
    assert.ok(diags.some((d) => d.code === "MOL2003"));
  });

  it("detects MOL3001 unknown element, MOL3002 invalid bond order, and MOL3003 invalid stereo flag", () => {
    const badChem = [
      "BadChem",
      "  ModelScript         2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 Xz  0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5200    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  9  7  0  0  0",
      "M  END",
    ].join("\n");
    const diags = lintMolfile(parseMolfileDocument(badChem));
    assert.ok(diags.some((d) => d.code === "MOL3001"));
    assert.ok(diags.some((d) => d.code === "MOL3002"));
    assert.ok(diags.some((d) => d.code === "MOL3003"));
  });

  it("detects MOL4001 self-loop bond and MOL4002 duplicate bond", () => {
    const badTopo = [
      "BadTopo",
      "  ModelScript         2D",
      "",
      "  2  3  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5200    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  1  1  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "  2  1  1  0  0  0  0",
      "M  END",
    ].join("\n");
    const diags = lintMolfile(parseMolfileDocument(badTopo));
    assert.ok(diags.some((d) => d.code === "MOL4001"));
    assert.ok(diags.some((d) => d.code === "MOL4002"));
  });

  it("detects MOL5001 pentavalent neutral carbon violation and MOL5006 zero-length 3D bond", () => {
    const pentavalentC = [
      "TexasCarbon",
      "  ModelScript         3D",
      "",
      "  6  5  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.0900    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
      "   -1.0900    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    1.0900    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000   -1.0900    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "  1  3  1  0  0  0  0",
      "  1  4  1  0  0  0  0",
      "  1  5  1  0  0  0  0",
      "  1  6  1  0  0  0  0",
      "M  END",
    ].join("\n");
    const diags = lintMolfile(parseMolfileDocument(pentavalentC));
    assert.ok(diags.some((d) => d.code === "MOL5001"));
    assert.ok(diags.some((d) => d.code === "MOL5006"));
  });
});
