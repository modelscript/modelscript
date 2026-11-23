// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { datcomLanguage } from "../src/language.js";

describe("DATCOM @modelscript/dsl Grammar & WASM Parser", () => {
  it("defines declarative DATCOM grammar with NAMELIST and control card rules", () => {
    assert.strictEqual(datcomLanguage.name, "datcom");
    assert.strictEqual(datcomLanguage.maturity, "beta");
    assert.ok(datcomLanguage.rules);
    assert.ok(datcomLanguage.rules["Deck"]);
    assert.ok(datcomLanguage.rules["NamelistBlock"]);
    assert.ok(datcomLanguage.rules["NamelistHeader"]);
    assert.ok(datcomLanguage.rules["ControlCard"]);
    assert.ok(datcomLanguage.rules["NacaCard"]);
  });

  it("compiles DATCOM grammar into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(datcomLanguage as any);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile);
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgDir = new URL("..", import.meta.url).pathname;
    assert.ok(fs.existsSync(path.join(pkgDir, "dist", "parser.wasm")));
    assert.ok(fs.existsSync(path.join(pkgDir, "src-gen", "bindings.js")));
    assert.ok(fs.existsSync(path.join(pkgDir, "src-gen", "bindings.d.ts")));
  });
});
