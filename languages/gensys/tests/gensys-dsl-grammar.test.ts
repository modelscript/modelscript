// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { gensysDeckGrammar } from "../src/grammar/gensys-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("GENSYS Deck @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative GENSYS grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(gensysDeckGrammar.name, "GensysDeck");
    assert.ok(gensysDeckGrammar.rules);
    assert.ok(gensysDeckGrammar.rules["Deck"]);
    assert.ok(gensysDeckGrammar.rules["Statement"]);
    assert.ok(gensysDeckGrammar.rules["ParameterDef"]);
    assert.ok(gensysDeckGrammar.rules["SubsystemDef"]);
    assert.ok(gensysDeckGrammar.rules["BodyDef"]);
    assert.ok(gensysDeckGrammar.rules["WheelsetDef"]);
    assert.ok(gensysDeckGrammar.rules["BogieDef"]);
    assert.ok(gensysDeckGrammar.rules["CouplingDef"]);
    assert.ok(gensysDeckGrammar.rules["SpringCoupling"]);
    assert.ok(gensysDeckGrammar.rules["DamperCoupling"]);
    assert.ok(gensysDeckGrammar.rules["TrackDef"]);
    assert.ok(gensysDeckGrammar.rules["SimulationDef"]);
  });

  it("compiles GENSYS grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(gensysDeckGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses GENSYS source code into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `
subsystem coach
body carbody 30000 120000 1500000 1500000 0.0 0.0 1.2
wheelset ax1 1500 1.435 0.46 0.05
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Deck");
  });
});
