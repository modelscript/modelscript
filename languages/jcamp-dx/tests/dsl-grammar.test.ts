// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jcampDxLanguage } from "../src/language.js";

describe("@modelscript/jcamp-dx DSL Grammar & WASM GLR Compilation", () => {
  it("defines formal declarative JCAMP-DX grammar conforming to @modelscript/dsl", () => {
    assert.strictEqual(jcampDxLanguage.name, "jcamp-dx");
    assert.strictEqual(jcampDxLanguage.maturity, "beta");
    assert.ok(jcampDxLanguage.fileExtensions?.includes(".jdx"));
    assert.ok(jcampDxLanguage.fileExtensions?.includes(".dx"));
    assert.ok(jcampDxLanguage.fileExtensions?.includes(".jcamp"));
    assert.ok(jcampDxLanguage.rules["Document"]);
    assert.ok(jcampDxLanguage.rules["TitleRecord"]);
    assert.ok(jcampDxLanguage.rules["VersionRecord"]);
    assert.ok(jcampDxLanguage.rules["DataTypeRecord"]);
    assert.ok(jcampDxLanguage.rules["XyDataRecord"]);
    assert.ok(jcampDxLanguage.rules["PeakTableRecord"]);
    assert.ok(jcampDxLanguage.rules["EndRecord"]);
    assert.ok(jcampDxLanguage.rules["Comment"]);
  });

  it("compiles jcampDxLanguage into WebAssembly GLR parse tables & AssemblyScript kernel via buildParser", () => {
    const result = buildParser(jcampDxLanguage as never);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });
});
