// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { melcorLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@modelscript/melcor — DSL Grammar & WASM GLR Parser", () => {
  it("defines declarative MELCOR grammar conforming to @modelscript/dsl spec", () => {
    assert.equal(melcorLanguage.name, "melcor");
    assert.ok(melcorLanguage.rules);
    assert.ok(melcorLanguage.rules["Deck"]);
    assert.ok(melcorLanguage.rules["PhaseHeader"]);
    assert.ok(melcorLanguage.rules["TitleRecord"]);
    assert.ok(melcorLanguage.rules["PackageHeader"]);
    assert.ok(melcorLanguage.rules["CvhRecord"]);
    assert.ok(melcorLanguage.rules["FlRecord"]);
    assert.ok(melcorLanguage.rules["HsRecord"]);
    assert.ok(melcorLanguage.rules["CorRecord"]);
    assert.ok(melcorLanguage.rules["Rn1Record"]);
    assert.ok(melcorLanguage.rules["CfRecord"]);
    assert.ok(melcorLanguage.rules["TfRecord"]);
    assert.ok(melcorLanguage.rules["MpRecord"]);
    assert.ok(melcorLanguage.rules["NcgRecord"]);
    assert.ok(melcorLanguage.rules["EndDirective"]);
  });

  it("compiles melcorLanguage via buildParser into AssemblyScript + JS bindings", () => {
    const result = buildParser(melcorLanguage as never);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0);
    assert.ok(result.javascriptWrapper.dts.length > 0);
  });

  it("instantiates dist/parser.wasm and parses MELCOR source into linear CST without errors", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);

    const sample = `! Test deck
MELGEN_INPUT
TITLE 'Blowdown'
EXEC_INPUT
  EXEC_TEND 10.0
CVH_INPUT
  CV_ID 'V1' 100
  CV_THR 2.0e6 500.0
  CV_PAS 10.0
END
`;
    const tree = parser.parse(sample);
    assert.ok(tree?.rootNode);
    assert.equal(tree.rootNode.type, "Deck");
    assert.equal(tree.rootNode.hasError, false);
  });
});
