// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { verilogLanguage } from "../src/language.js";

describe("Verilog @modelscript/dsl WASM Grammar", () => {
  it("defines declarative verilogLanguage spec conforming to @modelscript/dsl", () => {
    assert.strictEqual(verilogLanguage.name, "verilog");
    assert.strictEqual(verilogLanguage.maturity, "beta");
    assert.ok(verilogLanguage.rules["SourceFile"]);
    assert.ok(verilogLanguage.rules["ModuleDeclaration"]);
    assert.ok(verilogLanguage.rules["ContinuousAssign"]);
    assert.ok(verilogLanguage.rules["AlwaysBlock"]);
    assert.ok(verilogLanguage.rules["InitialBlock"]);
    assert.ok(verilogLanguage.rules["CaseStatement"]);
    assert.ok(verilogLanguage.rules["GateInstantiation"]);
    assert.ok(verilogLanguage.rules["ModuleInstantiation"]);
    assert.ok(verilogLanguage.rules["SizedNumber"]);
  });

  it("compiles verilogLanguage with buildParser and emits dist/parser.wasm & src-gen/bindings", () => {
    const result = buildParser(verilogLanguage as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");

    const pkgRoot = new URL("..", import.meta.url).pathname;
    assert.ok(fs.existsSync(path.join(pkgRoot, "dist", "parser.wasm")), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.js")), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.d.ts")), "src-gen/bindings.d.ts should exist");
  });
});
