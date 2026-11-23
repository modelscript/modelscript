// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gaussianLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/gaussian — DSL Grammar & WASM GLR Parser", () => {
  it("defines declarative Gaussian grammar conforming to @modelscript/dsl language spec", () => {
    assert.equal(gaussianLanguage.name, "gaussian");
    assert.equal(gaussianLanguage.maturity, "beta");
    assert.deepEqual(gaussianLanguage.fileExtensions, [".gjf", ".com"]);
    assert.ok(gaussianLanguage.rules["Document"]);
    assert.ok(gaussianLanguage.rules["Link0Command"]);
    assert.ok(gaussianLanguage.rules["RouteSection"]);
    assert.ok(gaussianLanguage.rules["MethodBasis"]);
    assert.ok(gaussianLanguage.rules["AtomSpec"]);
    assert.ok(gaussianLanguage.rules["Link1Separator"]);
    assert.ok(gaussianLanguage.rules["Comment"]);
  });

  it("compiles gaussianLanguage into AssemblyScript GLR parser & JS bindings via buildParser", () => {
    const result = buildParser(gaussianLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation artifacts");
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected AssemblyScript kernel files");

    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Expected generated parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Expected JS bindings");
  });

  it("emits built dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm to exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "Expected non-empty dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js to exist");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts to exist");
  });
});
