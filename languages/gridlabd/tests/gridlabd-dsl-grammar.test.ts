// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { gridlabdGrammar } from "../src/grammar/gridlabd-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("GridLAB-D @modelscript/dsl WASM Parser", () => {
  it("defines formal declarative GridLAB-D grammar conforming to @modelscript/dsl", () => {
    assert.strictEqual(gridlabdGrammar.name, "GridlabdModel");
    assert.ok(gridlabdGrammar.rules["GlmFile"]);
    assert.ok(gridlabdGrammar.rules["ClockBlock"]);
    assert.ok(gridlabdGrammar.rules["ModuleBlock"]);
    assert.ok(gridlabdGrammar.rules["ObjectBlock"]);
    assert.ok(gridlabdGrammar.rules["PropertyAssignment"]);
  });

  it("compiles GridLAB-D grammar into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(gridlabdGrammar as any);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    assert.ok(result.javascriptWrapper);
  });

  it("instantiates WebAssembly GLR parser and parses .glm source into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser);

    const sample = `
#set profiler=1
clock {
  timezone PST+8PDT;
  starttime '2000-01-01 00:00:00';
  stoptime '2000-01-02 00:00:00';
}
module powerflow {
  solver_method NR;
}
object node {
  name bus_1;
  phases ABCN;
  bustype SWING;
  nominal_voltage 7200;
}
`;
    const tree = parser.parse(sample);
    assert.ok(tree);
    assert.ok(tree.rootNode);
    assert.equal(tree.rootNode.type, "GlmFile");
  });
});
