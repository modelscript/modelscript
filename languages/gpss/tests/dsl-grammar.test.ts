// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { gpssLanguage } from "../src/language.js";

describe("GPSS @modelscript/dsl Grammar & WASM GLR Parser", () => {
  it("defines formal declarative GPSS grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(gpssLanguage.name, "gpss");
    assert.strictEqual(gpssLanguage.maturity, "beta");
    assert.ok(gpssLanguage.fileExtensions.includes(".gps"));
    assert.ok(gpssLanguage.fileExtensions.includes(".gpss"));
    assert.ok(gpssLanguage.rules);
    assert.ok(gpssLanguage.rules["Program"]);
    assert.ok(gpssLanguage.rules["Statement"]);
    assert.ok(gpssLanguage.rules["Opcode"]);
    assert.ok(gpssLanguage.rules["OperandList"]);
    assert.ok(gpssLanguage.rules["SnaRef"]);
    assert.ok(gpssLanguage.rules["Comment"]);
  });

  it("compiles GPSS grammar into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(gpssLanguage as Parameters<typeof buildParser>[0]);

    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.length > 0);

    assert.ok(result.javascriptWrapper, "Should generate JS tree wrapper");
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
