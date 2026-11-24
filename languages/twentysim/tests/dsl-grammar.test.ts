// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { twentySimLanguage } from "../src/language.js";

describe("20-sim @modelscript/dsl Grammar Specification", () => {
  it("defines declarative SIDOPS grammar with required sections and expressions", () => {
    assert.strictEqual(twentySimLanguage.name, "twentysim");
    assert.deepStrictEqual(twentySimLanguage.fileExtensions, [".emx", ".emxz", ".sid"]);

    const rules = twentySimLanguage.rules;
    assert.ok(rules["Model"]);
    assert.ok(rules["ParametersSection"]);
    assert.ok(rules["VariablesSection"]);
    assert.ok(rules["PortsSection"]);
    assert.ok(rules["SubmodelsSection"]);
    assert.ok(rules["ConnectionsSection"]);
    assert.ok(rules["InitialEquationsSection"]);
    assert.ok(rules["EquationsSection"]);
    assert.ok(rules["BinaryExpr"]);
    assert.ok(rules["CallExpr"]);
    assert.ok(rules["MemberExpr"]);
  });

  it("compiles twentySimLanguage into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(twentySimLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });
});
