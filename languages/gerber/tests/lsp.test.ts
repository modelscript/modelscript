// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gerberIndexing } from "../src/indexing.js";
import { getGerberCompletions, getGerberDocumentSymbols, getGerberHover, validateGerber } from "../src/lsp.js";

describe("@modelscript/gerber — Workspace Indexing & LSP Services", () => {
  const sample = [
    "G04 Demo Top Copper*",
    "%FSLAX34Y34*%",
    "%MOMM*%",
    "%AMTHERM*7,0,0,2.0,1.2,0.3,45*%",
    "%ADD10C,0.254*%",
    "%ADD11C,1.200X0.600*%",
    "%LPD*%",
    "G01*",
    "D10*",
    "X0Y0D02*",
    "X100000Y0D01*",
    "D11*",
    "X0Y0D03*",
    "M02*",
  ].join("\n");

  it("identifies Gerber files by extension or content sniffing and indexes apertures and macros", () => {
    assert.equal(gerberIndexing.canIndex("board.gbr", ""), true);
    assert.equal(gerberIndexing.canIndex("top.gtl", ""), true);
    assert.equal(gerberIndexing.canIndex("unknown.txt", "%FSLAX24Y24*%\n%MOMM*%\nM02*"), true);
    assert.equal(gerberIndexing.canIndex("readme.md", "# Hello"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;
    gerberIndexing.indexFile({
      uri: "file:///demo/top.gtl",
      text: sample,
      setParsedModel(m: unknown) {
        parsedModel = m;
      },
      addSymbol(name: string, kind: string) {
        added.push({ name, kind });
        return added.length;
      },
    } as never);

    assert.ok(parsedModel);
    assert.ok(added.some((s) => s.name === "D10" && s.kind === "Component"));
    assert.ok(added.some((s) => s.name === "D11" && s.kind === "Component"));
    assert.ok(added.some((s) => s.name === "THERM" && s.kind === "Class"));
  });

  it("validates Gerber documents and returns LSP diagnostics with GRB codes", () => {
    assert.equal(validateGerber(sample, "top.gtl").length, 0);

    const broken = "%MOMM*%\nD55*\nX0Y0D03*\n";
    const diags = validateGerber(broken, "broken.gbr");
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("GRB2001"));
    assert.ok(codes.has("GRB2003"));
    assert.ok(codes.has("GRB4001"));
    assert.ok(diags.every((d) => d.source === "modelscript-gerber"));
  });

  it("extracts hierarchical document symbols, hover docs, and completions", () => {
    const syms = getGerberDocumentSymbols(sample, "top.gtl");
    assert.equal(syms.length, 1);
    const root = syms[0]!;
    assert.ok(root.children && root.children.length >= 4);
    assert.ok(root.children.some((c) => c.name === "D10"));
    assert.ok(root.children.some((c) => c.name === "THERM"));

    // Hover on D10 on line 8 ("D10*")
    const hoverD10 = getGerberHover(sample, { line: 8, character: 1 }, "top.gtl");
    assert.ok(hoverD10);
    assert.ok(hoverD10.contents.value.includes("Aperture D10"));
    assert.ok(hoverD10.contents.value.includes("0.2540 mm"));

    // Hover on G01 on line 7 ("G01*")
    const hoverG01 = getGerberHover(sample, { line: 7, character: 1 }, "top.gtl");
    assert.ok(hoverG01);
    assert.ok(hoverG01.contents.value.includes("Linear interpolation"));

    // Hover on %FS on line 1 ("%FSLAX34Y34*%")
    const hoverFs = getGerberHover(sample, { line: 1, character: 1 }, "top.gtl");
    assert.ok(hoverFs);
    assert.ok(hoverFs.contents.value.includes("Format Specification"));

    // Completions include standard commands and defined apertures
    const completions = getGerberCompletions(sample, "top.gtl");
    assert.ok(completions.some((c) => c.label === "D10*"));
    assert.ok(completions.some((c) => c.label === "D11*"));
    assert.ok(completions.some((c) => c.label === "M02*"));
  });
});
