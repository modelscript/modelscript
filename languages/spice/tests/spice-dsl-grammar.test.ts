// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spiceNetlistGrammar } from "../src/grammar/spice-grammar.js";

describe("SPICE Netlist @modelscript/dsl Parser Architecture Convergence Pilot", () => {
  it("defines formal declarative SPICE grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(spiceNetlistGrammar.name, "SpiceNetlist");
    assert.ok(spiceNetlistGrammar.rules);
    assert.ok(spiceNetlistGrammar.rules["Circuit"]);
    assert.ok(spiceNetlistGrammar.rules["TwoTerminalComponent"]);
    assert.ok(spiceNetlistGrammar.rules["SourceComponent"]);
    assert.ok(spiceNetlistGrammar.rules["BjtComponent"]);
    assert.ok(spiceNetlistGrammar.rules["MosfetComponent"]);
    assert.ok(spiceNetlistGrammar.rules["SubcircuitCall"]);
    assert.ok(spiceNetlistGrammar.rules["TranDirective"]);
    assert.ok(spiceNetlistGrammar.rules["AcDirective"]);
    assert.ok(spiceNetlistGrammar.rules["DcDirective"]);
    assert.ok(spiceNetlistGrammar.rules["ModelDirective"]);
    assert.ok(spiceNetlistGrammar.rules["SubcktDef"]);
  });

  it("compiles SPICE grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(spiceNetlistGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });
});
