// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { cifLanguage } from "../src/language.js";

describe("CIF 2.0 @modelscript/dsl Grammar & WASM Parser", () => {
  it("defines declarative cifLanguage grammar with all CIF 2.0 command rules", () => {
    assert.strictEqual(cifLanguage.name, "cif");
    assert.strictEqual(cifLanguage.maturity, "beta");
    assert.deepStrictEqual(cifLanguage.fileExtensions, [".cif"]);
    assert.ok(cifLanguage.rules);
    assert.ok(cifLanguage.rules["Document"]);
    assert.ok(cifLanguage.rules["DefStartCommand"]);
    assert.ok(cifLanguage.rules["DefFinishCommand"]);
    assert.ok(cifLanguage.rules["DefDeleteCommand"]);
    assert.ok(cifLanguage.rules["CallCommand"]);
    assert.ok(cifLanguage.rules["Transform"]);
    assert.ok(cifLanguage.rules["LayerCommand"]);
    assert.ok(cifLanguage.rules["BoxCommand"]);
    assert.ok(cifLanguage.rules["PolygonCommand"]);
    assert.ok(cifLanguage.rules["RoundflashCommand"]);
    assert.ok(cifLanguage.rules["WireCommand"]);
    assert.ok(cifLanguage.rules["UserExtensionCommand"]);
    assert.ok(cifLanguage.rules["EndCommand"]);
    assert.ok(cifLanguage.rules["CommentCommand"]);
  });

  it("compiles cifLanguage into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(cifLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS bindings");
  });

  it("emits built dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
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
