// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, collectWasmSyntaxErrors } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chemkinLanguage, getChemkinWasmParser } from "../src/index.js";

describe("@modelscript/chemkin — DSL Grammar & Native WASM GLR Parser", () => {
  it("defines formal declarative CHEMKIN language specification at Beta maturity", () => {
    assert.equal(chemkinLanguage.name, "chemkin");
    assert.equal(chemkinLanguage.maturity, "beta");
    assert.deepEqual(chemkinLanguage.fileExtensions, [".inp", ".ck", ".therm"]);
    assert.ok(chemkinLanguage.rules["Deck"]);
    assert.ok(chemkinLanguage.rules["ElementsSection"]);
    assert.ok(chemkinLanguage.rules["SpeciesSection"]);
    assert.ok(chemkinLanguage.rules["ThermoSection"]);
    assert.ok(chemkinLanguage.rules["ReactionsSection"]);
    assert.ok(chemkinLanguage.rules["ReactionEntry"]);
    assert.ok(chemkinLanguage.rules["ReactionAuxClause"]);
  });

  it("compiles CHEMKIN grammar via buildParser into AssemblyScript GLR tables", () => {
    const result = buildParser(chemkinLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return a compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });

  it("parses a valid CHEMKIN deck cleanly with the compiled parser.wasm", () => {
    const parser = getChemkinWasmParser();
    const tree = parser.parse(`
! Simple H2 mechanism
ELEMENTS
  H O
END
SPECIES
  H2 O2 H2O OH H O
END
REACTIONS CAL/MOLE MOLES
  H + O2 <=> O + OH 1.915E+14 0.0 16440.0
  H + OH + M <=> H2O + M 2.2E+22 -2.0 0.0
    H2O / 12.0 /
  H + O2 (+M) <=> H2O (+M) 1.475E+12 0.6 0.0
    LOW / 6.366E+20 -1.72 525.0 /
    TROE / 0.5 1.0E-30 1.0E+30 /
    DUPLICATE
END
`);
    assert.ok(tree?.rootNode, "WASM parser should produce a CST root node");
    const errs = collectWasmSyntaxErrors(tree.rootNode);
    assert.equal(
      tree.rootNode.hasError,
      false,
      `Valid CHEMKIN deck should parse with zero CST errors: ${JSON.stringify(errs)}`,
    );
  });
});
