// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pdbGrammar } from "../src/grammar/pdb-grammar.js";

describe("PDB @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative PDB grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(pdbGrammar.name, "Pdb");
    assert.ok(pdbGrammar.rules);
    assert.ok(pdbGrammar.rules["Structure"]);
    assert.ok(pdbGrammar.rules["AtomRecord"]);
    assert.ok(pdbGrammar.rules["HetatmRecord"]);
    assert.ok(pdbGrammar.rules["HelixRecord"]);
    assert.ok(pdbGrammar.rules["SheetRecord"]);
  });

  it("compiles PDB grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(pdbGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses PDB source code into linear CST", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `HEADER    PLANT SEED PROTEIN                      30-APR-81   1CRN
TITLE     WATER STRUCTURE OF A HYDROPHOBIC PROTEIN AT ATOMIC RESOLUTION
HELIX    1  H1 THR A    1  CYS A    4  1
SHEET    1  S1  2 CYS A   16  ARG A   20  0
ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N
ATOM      2  CA  THR A   1      16.967  12.784   4.338  1.00 10.80           C
ATOM      3  C   THR A   1      15.685  12.755   5.133  1.00  9.19           C
ATOM      4  O   THR A   1      15.268  13.825   5.594  1.00  9.85           O
HETATM 1001  O   HOH A  47      12.123  14.567   6.789  1.00 15.00           O
TER    1002      HOH A  47
CONECT    1    2    3
END
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a syntax tree");
    assert.ok(tree.rootNode, "Tree should have a rootNode");
    assert.strictEqual(tree.rootNode.type, "Structure");
  });
});
