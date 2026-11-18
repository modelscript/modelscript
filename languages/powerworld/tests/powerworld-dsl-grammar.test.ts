// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { powerworldGrammar } from "../src/grammar/powerworld-grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("PowerWorld AUX @modelscript/dsl WASM Parser", () => {
  it("defines formal declarative PowerWorld AUX grammar", () => {
    assert.strictEqual(powerworldGrammar.name, "PowerWorldAux");
    assert.ok(powerworldGrammar.rules["AuxFile"]);
    assert.ok(powerworldGrammar.rules["DataSection"]);
    assert.ok(powerworldGrammar.rules["ScriptBlock"]);
  });

  it("compiles PowerWorld AUX grammar via buildParser", () => {
    const result = buildParser(powerworldGrammar as any);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    assert.ok(result.javascriptWrapper);
  });

  it("instantiates WebAssembly GLR parser and parses .aux source into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser);

    const sample = `
DATA (Bus, [BusNum, BusName, BusNomVolt, BusSlack])
{
  1 "SubstationA" 138.0 YES
  2 "SubstationB" 138.0 NO
}
SCRIPT
{
  EnterMode(RUN);
  SolvePowerFlow(RECTNEWT);
}
`;
    const tree = parser.parse(sample);
    assert.ok(tree);
    assert.ok(tree.rootNode);
    assert.equal(tree.rootNode.type, "AuxFile");
  });
});
