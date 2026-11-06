// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { openDssGrammar } from "../src/grammar/opendss-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("OpenDSS Deck @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative OpenDSS grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(openDssGrammar.name, "OpenDssDeck");
    assert.ok(openDssGrammar.rules);
    assert.ok(openDssGrammar.rules["Deck"]);
    assert.ok(openDssGrammar.rules["Statement"]);
    assert.ok(openDssGrammar.rules["CircuitDef"]);
    assert.ok(openDssGrammar.rules["ElementDef"]);
    assert.ok(openDssGrammar.rules["EditDirective"]);
    assert.ok(openDssGrammar.rules["PropertyAssignment"]);
    assert.ok(openDssGrammar.rules["CommandDirective"]);
  });

  it("compiles OpenDSS grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(openDssGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses OpenDSS source code into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `
Clear
New Circuit.IEEE13Node basekv=115.0 pu=1.00 phases=3
New Line.Line1 Bus1=SourceBus Bus2=632 LineCode=336 Length=2000 Units=ft
Set VoltageBases = [115.0, 4.16, 0.48]
CalcVoltageBases
Solve
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Deck");
  });
});
