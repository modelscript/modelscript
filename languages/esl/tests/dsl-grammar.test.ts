// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { eslLanguage } from "../src/language.js";

describe("@modelscript/esl DSL Grammar & WASM Parser Suite", () => {
  it("defines formal declarative ESL grammar conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(eslLanguage.name, "esl");
    assert.deepStrictEqual(eslLanguage.fileExtensions, [".esl"]);
    assert.strictEqual(eslLanguage.maturity, "beta");
    assert.ok(eslLanguage.rules["Program"]);
    assert.ok(eslLanguage.rules["StudyBlock"]);
    assert.ok(eslLanguage.rules["ModelBlock"]);
    assert.ok(eslLanguage.rules["SubmodelBlock"]);
    assert.ok(eslLanguage.rules["SegmentBlock"]);
    assert.ok(eslLanguage.rules["PackageBlock"]);
    assert.ok(eslLanguage.rules["DerivativeEquation"]);
    assert.ok(eslLanguage.rules["WhenStmt"]);
    assert.ok(eslLanguage.rules["IfStmt"]);
    assert.ok(eslLanguage.rules["Comment"]);
  });

  it("compiles ESL grammar via buildParser into AssemblyScript GLR kernel & JS bindings", () => {
    const result = buildParser(eslLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript parser kernel files");
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserTs && parserTs.content.length > 0, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });

  it("produces dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgDir = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgDir, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgDir, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgDir, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
