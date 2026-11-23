// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { trasysLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("TRASYS @modelscript/dsl WASM GLR Grammar", () => {
  it("defines formal declarative trasysLanguage conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(trasysLanguage.name, "trasys");
    assert.strictEqual(trasysLanguage.maturity, "beta");
    assert.ok(trasysLanguage.fileExtensions.includes(".tra"));
    assert.ok(trasysLanguage.rules["Deck"]);
    assert.ok(trasysLanguage.rules["OptionsSection"]);
    assert.ok(trasysLanguage.rules["SurfaceSection"]);
    assert.ok(trasysLanguage.rules["SurfaceDeclaration"]);
    assert.ok(trasysLanguage.rules["SurfaceKind"]);
    assert.ok(trasysLanguage.rules["OrbitSection"]);
    assert.ok(trasysLanguage.rules["OperationsSection"]);
    assert.ok(trasysLanguage.rules["EndOfData"]);
  });

  it("compiles trasysLanguage via buildParser into AssemblyScript GLR kernel & JS wrapper", () => {
    const result = buildParser(trasysLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });

  it("has materialized dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 100, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
