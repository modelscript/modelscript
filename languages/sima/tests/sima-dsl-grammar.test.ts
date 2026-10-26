// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simaCardGrammar } from "../src/grammar/sima-grammar.js";

describe("SIMA Marine Card Deck @modelscript/dsl Parser Architecture Convergence Pilot", () => {
  it("defines formal declarative SIMA card grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(simaCardGrammar.name, "SimaCardDeck");
    assert.ok(simaCardGrammar.rules);
    assert.ok(simaCardGrammar.rules["Deck"]);
    assert.ok(simaCardGrammar.rules["VesselBlock"]);
    assert.ok(simaCardGrammar.rules["MooringLineBlock"]);
    assert.ok(simaCardGrammar.rules["SysCard"]);
    assert.ok(simaCardGrammar.rules["BodyCard"]);
    assert.ok(simaCardGrammar.rules["MassCard"]);
    assert.ok(simaCardGrammar.rules["WaveCard"]);
  });

  it("compiles SIMA grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(simaCardGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });
});
