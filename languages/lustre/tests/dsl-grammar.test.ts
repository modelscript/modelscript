// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { lustreLanguage } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/lustre — DSL Grammar & WASM GLR Parser", () => {
  it("defines formal declarative Lustre grammar conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(lustreLanguage.name, "lustre");
    assert.deepStrictEqual(lustreLanguage.fileExtensions, [".lus", ".ec"]);
    assert.strictEqual(lustreLanguage.maturity, "beta");
    assert.ok(lustreLanguage.rules["Program"]);
    assert.ok(lustreLanguage.rules["ConstSection"]);
    assert.ok(lustreLanguage.rules["TypeSection"]);
    assert.ok(lustreLanguage.rules["NodeDecl"]);
    assert.ok(lustreLanguage.rules["Equation"]);
    assert.ok(lustreLanguage.rules["AssertStmt"]);
    assert.ok(lustreLanguage.rules["IfExpr"]);
    assert.ok(lustreLanguage.rules["MergeExpr"]);
    assert.ok(lustreLanguage.rules["ClockExpr"]);
  });

  it("compiles Lustre grammar into AssemblyScript GLR parse tables via buildParser", () => {
    const result = buildParser(lustreLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript kernel files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    assert.ok(fs.existsSync(path.join(PKG_ROOT, "dist", "parser.wasm")), "Expected dist/parser.wasm");
    assert.ok(fs.existsSync(path.join(PKG_ROOT, "src-gen", "bindings.js")), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(path.join(PKG_ROOT, "src-gen", "bindings.d.ts")), "Expected src-gen/bindings.d.ts");
  });
});
