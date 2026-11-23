// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { mcnpLanguage } from "../src/language.js";

describe("MCNP @modelscript/dsl Formal Grammar & WASM Parser", () => {
  it("defines formal declarative MCNP grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(mcnpLanguage.name, "mcnp");
    assert.strictEqual(mcnpLanguage.maturity, "beta");
    assert.ok(mcnpLanguage.rules["Deck"]);
    assert.ok(mcnpLanguage.rules["CellCard"]);
    assert.ok(mcnpLanguage.rules["CsgExpr"]);
    assert.ok(mcnpLanguage.rules["SurfaceCard"]);
    assert.ok(mcnpLanguage.rules["SurfaceMnemonic"]);
    assert.ok(mcnpLanguage.rules["DataCard"]);
    assert.ok(mcnpLanguage.rules["MaterialCard"]);
    assert.ok(mcnpLanguage.rules["KcodeCard"]);
    assert.ok(mcnpLanguage.rules["SdefCard"]);
    assert.ok(mcnpLanguage.rules["TallyCard"]);
  });

  it("compiles mcnpLanguage into WebAssembly GLR parse tables & AssemblyScript kernel via buildParser", () => {
    const result = buildParser(mcnpLanguage as never);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgDir = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgDir, "dist", "parser.wasm");
    const bindingsJsPath = path.join(pkgDir, "src-gen", "bindings.js");
    const bindingsDtsPath = path.join(pkgDir, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJsPath), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDtsPath), "src-gen/bindings.d.ts should exist");
  });
});
