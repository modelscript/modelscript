// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hec2Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/hec2 — @modelscript/dsl Grammar & WASM Parser Build", () => {
  it("defines formal declarative HEC-2 card deck grammar with all required card rules", () => {
    assert.equal(hec2Language.name, "hec2");
    assert.ok(hec2Language.rules);
    assert.ok(hec2Language.rules["Deck"]);
    assert.ok(hec2Language.rules["TitleCard"]);
    assert.ok(hec2Language.rules["JobCard"]);
    assert.ok(hec2Language.rules["ManningCard"]);
    assert.ok(hec2Language.rules["DischargeCard"]);
    assert.ok(hec2Language.rules["CrossSectionCard"]);
    assert.ok(hec2Language.rules["GroundProfileCard"]);
    assert.ok(hec2Language.rules["BridgeCard"]);
    assert.ok(hec2Language.rules["EndCard"]);
    assert.ok(hec2Language.rules["CommentCard"]);
  });

  it("compiles hec2Language into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(hec2Language as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should succeed");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("emits compiled dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm to exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "Expected non-trivial parser.wasm binary");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js to exist");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts to exist");
  });
});
