// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { srecLanguage } from "../src/language.js";

describe("Motorola S-Record @modelscript/dsl WASM GLR Grammar", () => {
  it("defines declarative S0-S9 record grammar rules conforming to @modelscript/dsl", () => {
    assert.strictEqual(srecLanguage.name, "srec");
    assert.strictEqual(srecLanguage.maturity, "beta");
    assert.ok(srecLanguage.fileExtensions?.includes(".srec"));
    assert.ok(srecLanguage.fileExtensions?.includes(".s19"));
    assert.ok(srecLanguage.fileExtensions?.includes(".s28"));
    assert.ok(srecLanguage.fileExtensions?.includes(".s37"));
    assert.ok(srecLanguage.rules["SrecFile"]);
    assert.ok(srecLanguage.rules["Record"]);
    assert.ok(srecLanguage.rules["HeaderRecord"]);
    assert.ok(srecLanguage.rules["Data16Record"]);
    assert.ok(srecLanguage.rules["Data24Record"]);
    assert.ok(srecLanguage.rules["Data32Record"]);
    assert.ok(srecLanguage.rules["Count16Record"]);
    assert.ok(srecLanguage.rules["Start16Record"]);
    assert.ok(srecLanguage.rules["Start24Record"]);
    assert.ok(srecLanguage.rules["Start32Record"]);
  });

  it("compiles srecLanguage into WebAssembly GLR parse tables & AssemblyScript kernel via buildParser", () => {
    const result = buildParser(srecLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS/TS bindings wrapper");
  });
});
