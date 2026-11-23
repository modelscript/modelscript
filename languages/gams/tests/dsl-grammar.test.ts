// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gamsLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/gams — Declarative @modelscript/dsl Grammar & WASM Parser", () => {
  it("defines formal GAMS grammar conforming to @modelscript/dsl language spec", () => {
    assert.equal(gamsLanguage.name, "gams");
    assert.equal(gamsLanguage.maturity, "beta");
    assert.ok(gamsLanguage.fileExtensions.includes(".gms"));
    assert.ok(gamsLanguage.rules);
    assert.ok(gamsLanguage.rules["Program"]);
    assert.ok(gamsLanguage.rules["SetSection"]);
    assert.ok(gamsLanguage.rules["AliasStatement"]);
    assert.ok(gamsLanguage.rules["ParameterSection"]);
    assert.ok(gamsLanguage.rules["ScalarSection"]);
    assert.ok(gamsLanguage.rules["TableSection"]);
    assert.ok(gamsLanguage.rules["VariableSection"]);
    assert.ok(gamsLanguage.rules["EquationSection"]);
    assert.ok(gamsLanguage.rules["EquationDefinition"]);
    assert.ok(gamsLanguage.rules["ModelStatement"]);
    assert.ok(gamsLanguage.rules["SolveStatement"]);
    assert.ok(gamsLanguage.rules["DisplayStatement"]);
    assert.ok(gamsLanguage.rules["IndexedOpExpr"]);
    assert.ok(gamsLanguage.rules["DollarCondition"]);
  });

  it("compiles gamsLanguage into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(gamsLanguage as never);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("produces built dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");
    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm");
    assert.ok(fs.statSync(wasmPath).size > 0, "Expected non-empty dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts");
  });
});
