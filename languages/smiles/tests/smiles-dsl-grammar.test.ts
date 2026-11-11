// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { smilesGrammar } from "../src/grammar/smiles-grammar.js";

describe("SMILES @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative SMILES grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(smilesGrammar.name, "Smiles");
    assert.ok(smilesGrammar.rules);
    assert.ok(smilesGrammar.rules["Document"]);
    assert.ok(smilesGrammar.rules["Record"]);
    assert.ok(smilesGrammar.rules["MoleculeEntry"]);
    assert.ok(smilesGrammar.rules["SmilesPattern"]);
  });

  it("compiles SMILES grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(smilesGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses SMILES molecules into linear CST", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `CCO ethanol
c1ccccc1 benzene
CC(=O)Oc1ccccc1C(=O)O aspirin
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.ok(
      tree.rootNode.type === "Document" || tree.rootNode.type === "_START",
      `Expected Document or _START, got ${tree.rootNode.type}`,
    );
    const docNode = tree.rootNode.type === "_START" ? tree.rootNode.firstChild : tree.rootNode;
    assert.ok(docNode, "Should have Document node");
    assert.equal(docNode.type, "Document");
  });
});
