// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mpsLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("@modelscript/mps DSL Grammar & WASM Parser Suite", () => {
  it("defines formal declarative MPS grammar conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(mpsLanguage.name, "mps");
    assert.strictEqual(mpsLanguage.maturity, "beta");
    assert.ok(mpsLanguage.rules);
    assert.ok(mpsLanguage.rules["MpsDeck"]);
    assert.ok(mpsLanguage.rules["NameCard"]);
    assert.ok(mpsLanguage.rules["ObjSenseSection"]);
    assert.ok(mpsLanguage.rules["RowsSection"]);
    assert.ok(mpsLanguage.rules["ColumnsSection"]);
    assert.ok(mpsLanguage.rules["MarkerCard"]);
    assert.ok(mpsLanguage.rules["RhsSection"]);
    assert.ok(mpsLanguage.rules["RangesSection"]);
    assert.ok(mpsLanguage.rules["BoundsSection"]);
    assert.ok(mpsLanguage.rules["QuadObjSection"]);
    assert.ok(mpsLanguage.rules["EndataCard"]);
  });

  it("compiles mpsLanguage into WebAssembly GLR parse tables & AssemblyScript kernel", () => {
    const result = buildParser(mpsLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("verifies compiled dist/parser.wasm and src-gen/bindings.js exist on disk", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should be built");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should be generated");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should be generated");
  });
});
