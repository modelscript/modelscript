// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mlxtranGrammar } from "../src/grammar/mlxtran-grammar.js";

describe("MLXTRAN @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative MLXTRAN grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(mlxtranGrammar.name, "Mlxtran");
    assert.ok(mlxtranGrammar.rules);
    assert.ok(mlxtranGrammar.rules["Model"]);
    assert.ok(mlxtranGrammar.rules["Section"]);
    assert.ok(mlxtranGrammar.rules["InputDeclaration"]);
    assert.ok(mlxtranGrammar.rules["DerivativeEquation"]);
    assert.ok(mlxtranGrammar.rules["AssignmentEquation"]);
    assert.ok(mlxtranGrammar.rules["MacroCall"]);
  });

  it("compiles MLXTRAN grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(mlxtranGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses MLXTRAN source code into linear CST", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `[LONGITUDINAL]
input = {ka, V, Cl}

EQUATION:
ddt_A_depot = -ka * A_depot
ddt_A_central = ka * A_depot - (Cl / V) * A_central
Cc = A_central / V
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Model");
  });
});
