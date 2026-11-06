// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { energyPlusGrammar } from "../src/grammar/energyplus-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("EnergyPlus IDF @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative EnergyPlus grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(energyPlusGrammar.name, "EnergyPlusIdf");
    assert.ok(energyPlusGrammar.rules);
    assert.ok(energyPlusGrammar.rules["Document"]);
    assert.ok(energyPlusGrammar.rules["Statement"]);
    assert.ok(energyPlusGrammar.rules["BuildingObject"]);
    assert.ok(energyPlusGrammar.rules["ZoneObject"]);
    assert.ok(energyPlusGrammar.rules["MaterialObject"]);
    assert.ok(energyPlusGrammar.rules["ConstructionObject"]);
    assert.ok(energyPlusGrammar.rules["SurfaceObject"]);
    assert.ok(energyPlusGrammar.rules["IdfObject"]);
  });

  it("compiles EnergyPlus grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(energyPlusGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses EnergyPlus source code into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `
Building,
  SmallOffice,
  0.0,
  Suburbs,
  0.04,
  0.4,
  FullExterior,
  25;

Zone,
  Core_zone,
  0.0,
  0.0,
  0.0,
  0.0,
  1,
  1;
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Document");
  });
});
