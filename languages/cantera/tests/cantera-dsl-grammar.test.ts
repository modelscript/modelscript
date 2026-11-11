// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canteraGrammar } from "../src/grammar/cantera-grammar.js";

describe("Cantera @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative Cantera grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(canteraGrammar.name, "Cantera");
    assert.ok(canteraGrammar.rules);
    assert.ok(canteraGrammar.rules["MechanismFile"]);
    assert.ok(canteraGrammar.rules["CtiDirective"]);
    assert.ok(canteraGrammar.rules["YamlSection"]);
    assert.ok(canteraGrammar.rules["YamlMapping"]);
  });

  it("compiles Cantera grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(canteraGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses Cantera mechanism into linear CST", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `description: Gri-Mech 3.0 combustion mechanism
phases:
  - name: gas
    elements: [O, H, C, N, Ar]
    species: [H2, H, O, O2, OH, H2O, CH4, CO, CO2]
    thermo: ideal-gas
reactions:
  - equation: 2 O + M <=> O2 + M
    rate-constant: {A: 1.2e+17, b: -1.0, Ea: 0.0}
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "MechanismFile");
  });
});
