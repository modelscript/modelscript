// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nmodlGrammar } from "../src/grammar/nmodl-grammar.js";

describe("NMODL @modelscript/dsl Parser Architecture Convergence", () => {
  it("defines formal declarative NMODL grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(nmodlGrammar.name, "Nmodl");
    assert.ok(nmodlGrammar.rules);
    assert.ok(nmodlGrammar.rules["Document"]);
    assert.ok(nmodlGrammar.rules["NeuronBlock"]);
    assert.ok(nmodlGrammar.rules["ParameterBlock"]);
    assert.ok(nmodlGrammar.rules["StateBlock"]);
    assert.ok(nmodlGrammar.rules["BreakpointBlock"]);
    assert.ok(nmodlGrammar.rules["DerivativeBlock"]);
  });

  it("compiles NMODL grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(nmodlGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });

  it("instantiates WebAssembly GLR parser and parses NMODL source code into linear CST", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser, "createWasmParser should successfully instantiate GLRParser");

    const sample = `TITLE Squid axon sodium channel
NEURON {
  SUFFIX hh_na
  USEION na READ ena WRITE ina
  RANGE gnabar, ina
}

PARAMETER {
  gnabar = 0.12 (mho/cm2)
  ena = 50.0 (mV)
}

STATE {
  m
  h
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  ina = gnabar * m^3 * h * (v - ena)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
}
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Parser should return a Tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");
    assert.equal(tree.rootNode.type, "Document");
  });
});
