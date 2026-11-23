// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { rinexLanguage } from "../src/language.js";

const pkgRoot = new URL("..", import.meta.url).pathname;

describe("RINEX v2 @modelscript/dsl WASM GLR Grammar", () => {
  it("defines formal declarative RINEX v2 grammar and UI panel metadata", () => {
    assert.strictEqual(rinexLanguage.name, "rinex");
    assert.strictEqual(rinexLanguage.maturity, "beta");
    assert.ok(rinexLanguage.fileExtensions.includes(".obs"));
    assert.ok(rinexLanguage.fileExtensions.includes(".nav"));
    assert.ok(rinexLanguage.rules["RinexFile"]);
    assert.ok(rinexLanguage.rules["HeaderSection"]);
    assert.ok(rinexLanguage.rules["VersionTypeHeader"]);
    assert.ok(rinexLanguage.rules["ApproxPositionHeader"]);
    assert.ok(rinexLanguage.rules["ObsTypesHeader"]);
    assert.ok(rinexLanguage.rules["EndOfHeaderRecord"]);
    assert.ok(rinexLanguage.rules["ObsEpochRecord"]);
    assert.ok(rinexLanguage.rules["NavEphemerisRecord"]);
    assert.ok(rinexLanguage.ui?.panels?.some((p) => p.id === "rinexEditor" && p.entry.includes("RinexPanel.tsx")));
  });

  it("compiles rinexLanguage grammar via buildParser into AssemblyScript GLR kernel", () => {
    const result = buildParser(rinexLanguage);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("produces dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    assert.ok(fs.existsSync(path.join(pkgRoot, "dist", "parser.wasm")), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.js")), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.d.ts")), "src-gen/bindings.d.ts should exist");
  });
});
