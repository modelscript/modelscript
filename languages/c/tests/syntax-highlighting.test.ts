// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateTextMate } from "@modelscript/dsl";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { cLanguage } from "../src/language.js";

describe("@modelscript/c IDE Syntax Highlighting & Grammar Suite", () => {
  test("generates valid TextMate grammar (.tmLanguage.json) with C keywords, types, and operators", () => {
    const { tm, monarch } = generateTextMate(cLanguage);
    assert.ok(tm, "TextMate grammar JSON should be generated");
    assert.ok(monarch, "Monarch grammar JSON should be generated");

    const tmObj = JSON.parse(tm);
    assert.equal(tmObj.name, "c");
    assert.equal(tmObj.scopeName, "source.c");

    // Check patterns include keywords, types, operators, numbers, strings, comments
    const includes = tmObj.patterns.map((p: any) => p.include);
    assert.ok(includes.includes("#keywords"));
    assert.ok(includes.includes("#types"));
    assert.ok(includes.includes("#operators"));
    assert.ok(includes.includes("#numbers"));
    assert.ok(includes.includes("#strings"));
    assert.ok(includes.includes("#comments"));

    // Check keywords patterns include C keywords
    const kwMatch = tmObj.repository.keywords.patterns[0]?.match ?? "";
    assert.ok(kwMatch.includes("while"));
    assert.ok(kwMatch.includes("return"));
    assert.ok(kwMatch.includes("struct"));
    assert.ok(kwMatch.includes("typedef"));

    // Check types patterns include C types
    const typeMatch = tmObj.repository.types.patterns[0]?.match ?? "";
    assert.ok(typeMatch.includes("double"));
    assert.ok(typeMatch.includes("int"));
    assert.ok(typeMatch.includes("uint32_t"));
    assert.ok(typeMatch.includes("float"));

    // Check Monarch keywords
    const monarchObj = JSON.parse(monarch);
    assert.ok(monarchObj.keywords.includes("while"));
    assert.ok(monarchObj.keywords.includes("return"));
    assert.ok(monarchObj.typeKeywords.includes("double"));
    assert.ok(monarchObj.typeKeywords.includes("uint32_t"));
  });

  test("exports IDE language configuration and Monarch tokens provider", async () => {
    const { getCLanguageConfiguration, getCMonarchDefinition, getCTextMateGrammar } = await import("../src/index.js");

    const config = getCLanguageConfiguration();
    assert.equal(config.comments.lineComment, "//");
    assert.deepEqual(config.comments.blockComment, ["/*", "*/"]);
    assert.ok(config.brackets.length >= 3);
    assert.ok(config.autoClosingPairs.some((p: any) => p.open === "{"));

    const monarch = getCMonarchDefinition();
    assert.ok(Array.isArray(monarch.keywords));
    assert.ok(monarch.keywords.includes("while"));
    assert.ok(monarch.tokenizer.root.length > 0);

    const tmGrammar = getCTextMateGrammar();
    assert.ok(tmGrammar.tm.includes("source.c"));
  });
});
