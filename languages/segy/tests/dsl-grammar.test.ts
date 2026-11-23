// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { segyLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "..");

describe("@modelscript/segy — DSL Grammar & WASM GLR Parser", () => {
  it("defines declarative segyLanguage conforming to @modelscript/dsl spec", () => {
    assert.equal(segyLanguage.name, "segy");
    assert.equal(segyLanguage.maturity, "beta");
    assert.ok(segyLanguage.fileExtensions?.includes(".sgy"));
    assert.ok(segyLanguage.fileExtensions?.includes(".segy"));
    assert.ok(segyLanguage.rules["TextualHeader"]);
    assert.ok(segyLanguage.rules["Card"]);
    assert.ok(segyLanguage.rules["ClientCard"]);
    assert.ok(segyLanguage.rules["LineCard"]);
    assert.ok(segyLanguage.rules["AreaCard"]);
    assert.ok(segyLanguage.rules["SampleIntervalCard"]);
    assert.ok(segyLanguage.rules["TraceLengthCard"]);
    assert.ok(segyLanguage.rules["FormatCard"]);
    assert.ok(segyLanguage.rules["RevisionCard"]);
    assert.ok(segyLanguage.rules["EndTextualHeaderCard"]);
  });

  it("compiles segyLanguage via buildParser into AssemblyScript GLR kernel and JS wrapper", () => {
    const result = buildParser(segyLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("produces built dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    assert.ok(fs.existsSync(path.join(PKG_DIR, "dist", "parser.wasm")), "Expected dist/parser.wasm");
    assert.ok(fs.existsSync(path.join(PKG_DIR, "src-gen", "bindings.js")), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(path.join(PKG_DIR, "src-gen", "bindings.d.ts")), "Expected src-gen/bindings.d.ts");
  });
});
