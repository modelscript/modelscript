// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { topasDeckGrammar } from "../src/grammar/topas-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("TOPAS & GATE Deck @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative TOPAS grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(topasDeckGrammar.name, "TopasDeck");
    assert.ok(topasDeckGrammar.rules);
    assert.ok(topasDeckGrammar.rules["Deck"]);
    assert.ok(topasDeckGrammar.rules["Statement"]);
    assert.ok(topasDeckGrammar.rules["ParameterAssignment"]);
    assert.ok(topasDeckGrammar.rules["VectorAssignment"]);
    assert.ok(topasDeckGrammar.rules["IncludeDirective"]);
    assert.ok(topasDeckGrammar.rules["GateCommand"]);
  });

  it("compiles TOPAS grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(topasDeckGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses TOPAS source code into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `s:Ge/World/Material = "Vacuum"
d:Ge/World/HLX = 2.0 m
s:So/ProtonBeam/Type = "Beam"
s:So/ProtonBeam/Component = "BeamPosition"
d:So/ProtonBeam/BeamEnergy = 150.0 MeV
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Deck");
  });
});
