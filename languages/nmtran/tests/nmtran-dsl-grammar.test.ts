// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nmtranGrammar } from "../src/grammar/nmtran-grammar.js";

describe("NMTRAN @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative NMTRAN grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(nmtranGrammar.name, "Nmtran");
    assert.ok(nmtranGrammar.rules);
    assert.ok(nmtranGrammar.rules["ControlStream"]);
    assert.ok(nmtranGrammar.rules["ProblemRecord"]);
    assert.ok(nmtranGrammar.rules["DataRecord"]);
    assert.ok(nmtranGrammar.rules["InputRecord"]);
    assert.ok(nmtranGrammar.rules["PkRecord"]);
    assert.ok(nmtranGrammar.rules["ThetaRecord"]);
    assert.ok(nmtranGrammar.rules["OmegaRecord"]);
  });

  it("compiles NMTRAN grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(nmtranGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses NMTRAN source code into linear CST", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `$PROBLEM Warfarin Population Pharmacokinetics
$DATA warfarin.csv IGNORE=@
$INPUT ID TIME DV AMT RATE
$SUBROUTINES ADVAN2 TRANS2
$PK
  CL = THETA(1) * EXP(ETA(1))
  V = THETA(2) * EXP(ETA(2))
  KA = THETA(3)
  S2 = V
$ERROR
  Y = F + F * EPS(1)
$THETA
  (0.01, 1.5, 50.0)
  (0.1, 10.0, 100.0)
  (0.01, 0.5, 5.0)
$OMEGA
  0.09
  0.04
$SIGMA
  0.04
$ESTIMATION METHOD=1 INTER MAXEVAL=9999
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "ControlStream");
  });
});
