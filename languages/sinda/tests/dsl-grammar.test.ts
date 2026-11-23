// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sindaLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/sinda — DSL Grammar & WASM GLR Parser", () => {
  it("defines formal declarative SINDA grammar conforming to @modelscript/dsl", () => {
    assert.equal(sindaLanguage.name, "sinda");
    assert.equal(sindaLanguage.maturity, "beta");
    assert.ok(sindaLanguage.rules["SindaDeck"]);
    assert.ok(sindaLanguage.rules["OptionsBlock"]);
    assert.ok(sindaLanguage.rules["NodeDataBlock"]);
    assert.ok(sindaLanguage.rules["ConductorDataBlock"]);
    assert.ok(sindaLanguage.rules["ConstantsDataBlock"]);
    assert.ok(sindaLanguage.rules["ArrayDataBlock"]);
    assert.ok(sindaLanguage.rules["SourceDataBlock"]);
    assert.ok(sindaLanguage.rules["ExecutionBlock"]);
    assert.ok(sindaLanguage.rules["Variables1Block"]);
    assert.ok(sindaLanguage.rules["Variables2Block"]);
    assert.ok(sindaLanguage.rules["OutputCallsBlock"]);
    assert.ok(sindaLanguage.rules["EndOfData"]);
  });

  it("compiles sindaLanguage with buildParser and emits dist/parser.wasm & src-gen/bindings", () => {
    const result = buildParser(sindaLanguage);
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Expected generated JS wrapper");

    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "Expected compiled dist/parser.wasm");
    assert.ok(fs.statSync(wasmPath).size > 0, "Expected non-empty dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), "Expected generated src-gen/bindings.js");
    assert.ok(fs.existsSync(bindingsDts), "Expected generated src-gen/bindings.d.ts");
  });
});
