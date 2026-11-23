// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stlLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/stl — WASM GLR Grammar & Language Spec", () => {
  it("defines stlLanguage conforming to @modelscript/dsl Beta tier with UI panel metadata", () => {
    assert.equal(stlLanguage.name, "stl");
    assert.deepEqual(stlLanguage.fileExtensions, [".stl"]);
    assert.equal(stlLanguage.maturity, "beta");
    assert.ok(stlLanguage.rules["StlFile"]);
    assert.ok(stlLanguage.rules["SolidBlock"]);
    assert.ok(stlLanguage.rules["FacetBlock"]);
    assert.ok(stlLanguage.rules["OuterLoop"]);
    assert.ok(stlLanguage.rules["VertexLine"]);
    assert.ok(stlLanguage.ui?.panels?.some((p) => p.entry === "./src/ui/StlPanel.tsx"));
  });

  it("compiles stlLanguage grammar into AssemblyScript GLR parser tables via buildParser", () => {
    const result = buildParser(stlLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });

  it("has compiled dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts on disk", () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");
    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm");
    assert.ok(fs.statSync(wasmPath).size > 100, "Expected non-empty dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts");
  });
});
