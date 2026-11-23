// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arinc429Language } from "../src/language.js";

describe("ARINC 429 @modelscript/dsl Grammar & WASM GLR Compilation", () => {
  it("declares Beta maturity, file extensions, ui.panels, and grammar rules", () => {
    assert.strictEqual(arinc429Language.name, "arinc429");
    assert.strictEqual(arinc429Language.maturity, "beta");
    assert.ok(arinc429Language.fileExtensions?.includes(".a429"));
    assert.ok(arinc429Language.ui?.panels?.some((p) => p.entry === "./src/ui/Arinc429Panel.tsx"));
    assert.ok(arinc429Language.rules["Document"]);
    assert.ok(arinc429Language.rules["BusDecl"]);
    assert.ok(arinc429Language.rules["RateDecl"]);
    assert.ok(arinc429Language.rules["LabelDecl"]);
    assert.ok(arinc429Language.rules["FrameDecl"]);
    assert.ok(arinc429Language.rules["WordDecl"]);
  });

  it("compiles arinc429Language into AssemblyScript GLR parser & JS bindings via buildParser", () => {
    const result = buildParser(arinc429Language as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });
});
