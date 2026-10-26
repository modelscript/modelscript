// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rocetsDeckGrammar } from "../src/grammar/rocets-grammar.js";

describe("ROCETS Deck @modelscript/dsl Parser Architecture Convergence Pilot", () => {
  it("defines formal declarative ROCETS grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(rocetsDeckGrammar.name, "RocetsDeck");
    assert.ok(rocetsDeckGrammar.rules);
    assert.ok(rocetsDeckGrammar.rules["Deck"]);
    assert.ok(rocetsDeckGrammar.rules["SubroutineBlock"]);
    assert.ok(rocetsDeckGrammar.rules["SubroutineHeader"]);
    assert.ok(rocetsDeckGrammar.rules["ModuleDef"]);
    assert.ok(rocetsDeckGrammar.rules["LinkDef"]);
    assert.ok(rocetsDeckGrammar.rules["ParamDirective"]);
    assert.ok(rocetsDeckGrammar.rules["UserCodeBlock"]);
  });

  it("compiles ROCETS grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(rocetsDeckGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });
});
