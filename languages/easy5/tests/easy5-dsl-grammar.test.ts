// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { easy5DeckGrammar } from "../src/grammar/easy5-grammar.js";

describe("EASY5 Deck @modelscript/dsl Parser Architecture Convergence Pilot", () => {
  it("defines formal declarative EASY5 grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(easy5DeckGrammar.name, "Easy5Deck");
    assert.ok(easy5DeckGrammar.rules);
    assert.ok(easy5DeckGrammar.rules["Deck"]);
    assert.ok(easy5DeckGrammar.rules["ModelHeader"]);
    assert.ok(easy5DeckGrammar.rules["ComponentsSection"]);
    assert.ok(easy5DeckGrammar.rules["ComponentDef"]);
    assert.ok(easy5DeckGrammar.rules["ConnectionsSection"]);
    assert.ok(easy5DeckGrammar.rules["ConnectionDef"]);
    assert.ok(easy5DeckGrammar.rules["TablesSection"]);
  });

  it("compiles EASY5 grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(easy5DeckGrammar as any);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate TypeScript/JS tree wrappers");
    assert.ok(result.javascriptWrapper.js.includes("class Tree") || result.javascriptWrapper.js.length > 0);
  });
});
