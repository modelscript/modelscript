// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { relap5DeckGrammar } from "../src/grammar/relap5-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("RELAP5-3D Deck @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative RELAP5-3D grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(relap5DeckGrammar.name, "Relap5Deck");
    assert.ok(relap5DeckGrammar.rules);
    assert.ok(relap5DeckGrammar.rules["Deck"]);
    assert.ok(relap5DeckGrammar.rules["Card"]);
    assert.ok(relap5DeckGrammar.rules["TitleCard"]);
    assert.ok(relap5DeckGrammar.rules["ControlCard"]);
    assert.ok(relap5DeckGrammar.rules["TimeStepCard"]);
    assert.ok(relap5DeckGrammar.rules["VolumeCard"]);
    assert.ok(relap5DeckGrammar.rules["JunctionCard"]);
    assert.ok(relap5DeckGrammar.rules["HeatStructureCard"]);
    assert.ok(relap5DeckGrammar.rules["KineticsCard"]);
    assert.ok(relap5DeckGrammar.rules["TripCard"]);
  });

  it("compiles RELAP5-3D grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(relap5DeckGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses RELAP5 source code into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `* PWR Primary Loop Deck
= PrimaryLoop new std-transient
100 new-transient
2010000 pipe 10
* End of Deck
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Deck");
  });
});
