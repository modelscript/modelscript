// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { vhdlLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/vhdl — Declarative @modelscript/dsl WASM GLR Grammar", () => {
  it("defines vhdlLanguage with Beta maturity and all core VHDL grammar rules", () => {
    assert.equal(vhdlLanguage.name, "vhdl");
    assert.equal(vhdlLanguage.maturity, "beta");
    assert.deepEqual(vhdlLanguage.fileExtensions, [".vhd", ".vhdl"]);
    assert.ok(vhdlLanguage.rules);
    assert.ok(vhdlLanguage.rules["DesignFile"]);
    assert.ok(vhdlLanguage.rules["LibraryClause"]);
    assert.ok(vhdlLanguage.rules["UseClause"]);
    assert.ok(vhdlLanguage.rules["EntityDeclaration"]);
    assert.ok(vhdlLanguage.rules["ArchitectureBody"]);
    assert.ok(vhdlLanguage.rules["PackageDeclaration"]);
    assert.ok(vhdlLanguage.rules["PackageBody"]);
    assert.ok(vhdlLanguage.rules["ProcessStmt"]);
    assert.ok(vhdlLanguage.rules["IfStmt"]);
    assert.ok(vhdlLanguage.rules["CaseStmt"]);
    assert.ok(vhdlLanguage.rules["ForLoopStmt"]);
    assert.ok(vhdlLanguage.rules["ComponentInst"]);
    assert.ok(vhdlLanguage.rules["SelectedSignalAssign"]);
    assert.ok(vhdlLanguage.rules["CondSignalAssign"]);
  });

  it("compiles vhdlLanguage via buildParser into AssemblyScript GLR kernel and JS bindings", () => {
    const result = buildParser(vhdlLanguage);
    assert.ok(result.assemblyScriptFiles.length > 0);
    assert.ok(result.assemblyScriptFiles.some((f) => f.filename === "parser.ts"));
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm to exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "Expected non-empty parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js to exist");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts to exist");
  });
});
