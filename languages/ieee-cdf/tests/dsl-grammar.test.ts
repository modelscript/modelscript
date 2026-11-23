// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ieeeCdfLanguage } from "../src/language.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("@modelscript/ieee-cdf DSL Grammar & WASM Parser", () => {
  it("defines declarative ieeeCdfLanguage conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(ieeeCdfLanguage.name, "ieee-cdf");
    assert.strictEqual(ieeeCdfLanguage.maturity, "beta");
    assert.ok(ieeeCdfLanguage.rules);
    assert.ok(ieeeCdfLanguage.rules["Document"]);
    assert.ok(ieeeCdfLanguage.rules["BusDataSection"]);
    assert.ok(ieeeCdfLanguage.rules["BranchDataSection"]);
    assert.ok(ieeeCdfLanguage.rules["LossZonesSection"]);
    assert.ok(ieeeCdfLanguage.rules["InterchangeSection"]);
    assert.ok(ieeeCdfLanguage.rules["TieLinesSection"]);
    assert.ok(ieeeCdfLanguage.rules["EndOfData"]);
    assert.ok(ieeeCdfLanguage.rules["BpaCard"]);
  });

  it("compiles ieeeCdfLanguage into AssemblyScript GLR kernel and JS bindings via buildParser", () => {
    const result = buildParser(ieeeCdfLanguage as never);
    assert.ok(result, "buildParser should return compilation output");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS wrapper");
  });

  it("produces dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 100, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
