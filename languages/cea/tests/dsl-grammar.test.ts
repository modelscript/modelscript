// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ceaLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "..");

describe("@modelscript/cea — @modelscript/dsl WASM GLR Grammar", () => {
  it("defines formal declarative NASA CEA grammar conforming to @modelscript/dsl spec", () => {
    assert.equal(ceaLanguage.name, "cea");
    assert.equal(ceaLanguage.maturity, "beta");
    assert.ok(ceaLanguage.rules["Deck"]);
    assert.ok(ceaLanguage.rules["ProblemSection"]);
    assert.ok(ceaLanguage.rules["ReactantsSection"]);
    assert.ok(ceaLanguage.rules["OnlySection"]);
    assert.ok(ceaLanguage.rules["OmitSection"]);
    assert.ok(ceaLanguage.rules["InsertSection"]);
    assert.ok(ceaLanguage.rules["OutputSection"]);
    assert.ok(ceaLanguage.rules["EndStatement"]);
    assert.ok(ceaLanguage.rules["Comment"]);
  });

  it("compiles ceaLanguage into AssemblyScript GLR parser & JS bindings via buildParser", () => {
    const result = buildParser(ceaLanguage);
    assert.ok(result, "buildParser should return a compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should emit AssemblyScript parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should emit JS wrapper");
  });

  it("emits dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    assert.ok(fs.existsSync(path.join(PKG_DIR, "dist", "parser.wasm")), "Expected dist/parser.wasm");
    assert.ok(fs.existsSync(path.join(PKG_DIR, "src-gen", "bindings.js")), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(path.join(PKG_DIR, "src-gen", "bindings.d.ts")), "Expected src-gen/bindings.d.ts");
  });
});
