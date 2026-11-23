// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { igesLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/iges — DSL Grammar & Native WASM GLR Parser", () => {
  it("defines declarative @modelscript/dsl igesLanguage with IGES 5.3 section rules", () => {
    assert.equal(igesLanguage.name, "iges");
    assert.equal(igesLanguage.maturity, "beta");
    assert.ok(igesLanguage.fileExtensions.includes(".igs"));
    assert.ok(igesLanguage.fileExtensions.includes(".iges"));
    assert.ok(igesLanguage.rules);
    assert.ok(igesLanguage.rules["IgesFile"]);
    assert.ok(igesLanguage.rules["StartRecord"]);
    assert.ok(igesLanguage.rules["GlobalRecord"]);
    assert.ok(igesLanguage.rules["DirectoryRecord"]);
    assert.ok(igesLanguage.rules["ParameterRecord"]);
    assert.ok(igesLanguage.rules["TerminateRecord"]);
    assert.ok(igesLanguage.rules["EntityTypeCode"]);
    assert.ok(igesLanguage.rules["HollerithString"]);
    assert.ok(igesLanguage.rules["TerminateSummary"]);
  });

  it("compiles igesLanguage via buildParser into AssemblyScript GLR parser & JS wrapper", () => {
    const result = buildParser(igesLanguage as never);
    assert.ok(result, "buildParser should return compilation output");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f: { filename: string }) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS wrapper");
  });

  it("builds dist/parser.wasm and src-gen/bindings.js and parses an IGES document in WASM", async () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsPath = path.join(PKG_ROOT, "src-gen", "bindings.js");
    assert.ok(fs.existsSync(wasmPath), "Expected compiled dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsPath), "Expected generated src-gen/bindings.js");
    assert.ok(fs.statSync(wasmPath).size > 1024, "Expected non-empty parser.wasm");

    const bindings = (await import(bindingsPath)) as {
      createWasmParser?: (p: string) => Promise<{ parser: { parse: (src: string) => unknown } }>;
    };
    if (typeof bindings.createWasmParser === "function") {
      const { parser } = await bindings.createWasmParser(wasmPath);
      const sample = [
        "S 1",
        "1H,,1H;,5HModel; G 1",
        "110 1 0 1 0 0 0 0 0 D 1",
        "110 0 0 1 0 0 0 D 2",
        "110,0.0,0.0,0.0,1.0,0.0,0.0; 1 P 1",
        "S0000001G0000001D0000002P0000001 T 1",
      ].join("\n");
      const tree = parser.parse(sample);
      assert.ok(tree, "WASM GLR parser should return a parse tree");
    }
  });
});
