// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { csmpLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/csmp — DSL WASM GLR Grammar Specification", () => {
  it("defines formal declarative CSMP/360 & CSSL-67 grammar in csmpLanguage", () => {
    assert.equal(csmpLanguage.name, "csmp");
    assert.equal(csmpLanguage.maturity, "beta");
    assert.ok(csmpLanguage.fileExtensions.includes(".csmp"));
    assert.ok(csmpLanguage.fileExtensions.includes(".cssl"));

    const rules = csmpLanguage.rules;
    assert.ok(rules["Program"]);
    assert.ok(rules["TitleStmt"]);
    assert.ok(rules["SectionHeader"]);
    assert.ok(rules["SortDirective"]);
    assert.ok(rules["ParamDecl"]);
    assert.ok(rules["ConstDecl"]);
    assert.ok(rules["InconDecl"]);
    assert.ok(rules["FixedDecl"]);
    assert.ok(rules["FunctionDecl"]);
    assert.ok(rules["MacroBlock"]);
    assert.ok(rules["ProcedureBlock"]);
    assert.ok(rules["TimerStmt"]);
    assert.ok(rules["MethodStmt"]);
    assert.ok(rules["PrintStmt"]);
    assert.ok(rules["PrtpltStmt"]);
    assert.ok(rules["AssignmentStmt"]);
    assert.ok(rules["CallExpr"]);
    assert.ok(rules["Comment"]);
  });

  it("compiles csmpLanguage into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(csmpLanguage);
    assert.ok(result, "buildParser should return a compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Expected generated parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Expected generated JS bindings wrapper");
  });

  it("produces built dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJsPath = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDtsPath = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm to be built");
    assert.ok(fs.statSync(wasmPath).size > 0, "Expected non-empty dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsJsPath), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(bindingsDtsPath), "Expected src-gen/bindings.d.ts");
  });
});
