// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { slamLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/slam — DSL Grammar & WASM Parser", () => {
  it("defines formal declarative SLAM II grammar conforming to @modelscript/dsl spec", () => {
    assert.equal(slamLanguage.name, "slam");
    assert.ok(slamLanguage.rules);
    assert.ok(slamLanguage.rules["Model"]);
    assert.ok(slamLanguage.rules["GenStatement"]);
    assert.ok(slamLanguage.rules["LimitsStatement"]);
    assert.ok(slamLanguage.rules["ContinuousStatement"]);
    assert.ok(slamLanguage.rules["IntlcStatement"]);
    assert.ok(slamLanguage.rules["InitializeStatement"]);
    assert.ok(slamLanguage.rules["NetworkStatement"]);
    assert.ok(slamLanguage.rules["EndNetworkStatement"]);
    assert.ok(slamLanguage.rules["FinStatement"]);
    assert.ok(slamLanguage.rules["StateEquation"]);
    assert.ok(slamLanguage.rules["CreateNode"]);
    assert.ok(slamLanguage.rules["QueueNode"]);
    assert.ok(slamLanguage.rules["ActivityNode"]);
    assert.ok(slamLanguage.rules["DetectNode"]);
    assert.ok(slamLanguage.rules["Comment"]);
  });

  it("compiles slamLanguage into WebAssembly GLR parse tables & AssemblyScript kernel", () => {
    const result = buildParser(slamLanguage as any);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("produces built dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    assert.ok(fs.existsSync(path.join(PKG_ROOT, "dist", "parser.wasm")), "Expected dist/parser.wasm");
    assert.ok(fs.existsSync(path.join(PKG_ROOT, "src-gen", "bindings.js")), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(path.join(PKG_ROOT, "src-gen", "bindings.d.ts")), "Expected src-gen/bindings.d.ts");
  });
});
