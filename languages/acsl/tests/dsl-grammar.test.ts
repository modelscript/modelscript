// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acslLanguage } from "../src/language.js";

describe("ACSL @modelscript/dsl Grammar Specification", () => {
  it("defines formal declarative ACSL grammar with all required sections and directives", () => {
    assert.strictEqual(acslLanguage.name, "acsl");
    assert.deepStrictEqual(acslLanguage.fileExtensions, [".csl", ".acsl"]);
    assert.strictEqual(acslLanguage.maturity, "beta");

    const rules = acslLanguage.rules;
    assert.ok(rules["Program"]);
    assert.ok(rules["InitialSection"]);
    assert.ok(rules["DynamicSection"]);
    assert.ok(rules["DerivativeSection"]);
    assert.ok(rules["DiscreteSection"]);
    assert.ok(rules["TerminalSection"]);
    assert.ok(rules["MacroSection"]);
    assert.ok(rules["ProceduralBlock"]);
    assert.ok(rules["ConstantDecl"]);
    assert.ok(rules["IntegerDecl"]);
    assert.ok(rules["LogicalDecl"]);
    assert.ok(rules["ArrayDecl"]);
    assert.ok(rules["TableDecl"]);
    assert.ok(rules["CintervalStmt"]);
    assert.ok(rules["MaxtervalStmt"]);
    assert.ok(rules["AlgorithmStmt"]);
    assert.ok(rules["DerivtStmt"]);
    assert.ok(rules["TermtStmt"]);
    assert.ok(rules["ScheduleStmt"]);
    assert.ok(rules["CallExpr"]);
    assert.ok(rules["Comment"]);
  });

  it("compiles acslLanguage into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(acslLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });
});
