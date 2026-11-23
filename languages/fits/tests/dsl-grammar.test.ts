// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fitsLanguage } from "../src/language.js";

describe("FITS 4.0 @modelscript/dsl Grammar & WASM GLR Parser", () => {
  it("defines formal declarative FITS header grammar conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(fitsLanguage.name, "fits");
    assert.strictEqual(fitsLanguage.maturity, "beta");
    assert.ok(fitsLanguage.fileExtensions?.includes(".fits"));
    assert.ok(fitsLanguage.rules);
    assert.ok(fitsLanguage.rules["FitsDocument"]);
    assert.ok(fitsLanguage.rules["HduHeader"]);
    assert.ok(fitsLanguage.rules["MandatoryCard"]);
    assert.ok(fitsLanguage.rules["WcsCard"]);
    assert.ok(fitsLanguage.rules["TableCard"]);
    assert.ok(fitsLanguage.rules["ScalingCard"]);
    assert.ok(fitsLanguage.rules["HistoryCard"]);
    assert.ok(fitsLanguage.rules["CommentCard"]);
    assert.ok(fitsLanguage.rules["EndCard"]);
  });

  it("compiles fitsLanguage into WebAssembly GLR parse tables & AssemblyScript kernel via buildParser", () => {
    const result = buildParser(fitsLanguage as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.length > 0);
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
