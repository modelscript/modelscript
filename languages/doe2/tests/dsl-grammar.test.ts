// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { doe2Grammar } from "../src/grammar/doe2-grammar.js";
import { doe2Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(__dirname, "../dist/parser.wasm");

describe("@modelscript/doe2 — DSL Grammar & Native WASM GLR Parser", () => {
  it("defines formal DOE-2 BDL grammar conforming to @modelscript/dsl spec", () => {
    assert.equal(doe2Grammar.name, "Doe2Bdl");
    assert.equal(doe2Language.name, "doe2");
    assert.ok(doe2Grammar.rules["Document"]);
    assert.ok(doe2Grammar.rules["SectionCommand"]);
    assert.ok(doe2Grammar.rules["MaterialCommand"]);
    assert.ok(doe2Grammar.rules["LayersCommand"]);
    assert.ok(doe2Grammar.rules["ConstructionCommand"]);
    assert.ok(doe2Grammar.rules["GlassTypeCommand"]);
    assert.ok(doe2Grammar.rules["ScheduleCommand"]);
    assert.ok(doe2Grammar.rules["SpaceCommand"]);
    assert.ok(doe2Grammar.rules["EnvelopeCommand"]);
    assert.ok(doe2Grammar.rules["ZoneCommand"]);
    assert.ok(doe2Grammar.rules["SystemCommand"]);
    assert.ok(doe2Grammar.rules["PlantCommand"]);
  });

  it("compiles DOE-2 grammar into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(doe2Grammar as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation output");
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript files");
    assert.ok(
      result.assemblyScriptFiles.some((f) => f.filename === "parser.ts"),
      "Expected generated parser.ts",
    );
    assert.ok(result.javascriptWrapper.js.length > 0, "Expected generated JS wrapper");
  });

  it("parses DOE-2 BDL text with compiled dist/parser.wasm and src-gen/bindings.js", () => {
    assert.ok(fs.existsSync(WASM_PATH), "Expected compiled dist/parser.wasm");
    const wasmBytes = fs.readFileSync(WASM_PATH);
    const { parser } = createWasmParserSync(wasmBytes);

    const bdl = `
$ Comment line
INPUT LOADS ..
TITLE LINE-1 = "WASM Test" ..
"M1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.5 CONDUCTIVITY = 0.8 ..
"L1" = LAYERS MATERIAL = ("M1") ..
"C1" = CONSTRUCTION TYPE = LAYERS LAYERS = "L1" ..
"S1" = SPACE AREA = 400 HEIGHT = 10 ..
"W1" = EXTERIOR-WALL CONSTRUCTION = "C1" AREA = 200 ..
COMPUTE LOADS ..
STOP ..
`;
    const tree = parser.parse(bdl);
    assert.ok(tree, "WASM parser should return a parse tree");
    assert.ok(tree.rootNode, "Parse tree should have rootNode");
    assert.equal(tree.rootNode.hasError, false, `Expected error-free WASM CST, got: ${tree.rootNode.toString()}`);
  });
});
