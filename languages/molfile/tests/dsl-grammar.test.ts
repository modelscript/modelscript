// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { molfileGrammar } from "../src/grammar/molfile-grammar.js";
import { molfileLanguage } from "../src/language.js";
import { createMolfileWasmParser } from "../src/parser/wasm-loader.js";

describe("Molfile @modelscript/dsl WASM GLR Grammar", () => {
  it("exports molfileLanguage and formal molfileGrammar with V2000/V3000/SDF rules", () => {
    assert.strictEqual(molfileLanguage.name, "molfile");
    assert.strictEqual(molfileGrammar.name, "Molfile");
    assert.ok(molfileGrammar.rules["Document"]);
    assert.ok(molfileGrammar.rules["SdfDelimiter"]);
    assert.ok(molfileGrammar.rules["SdfDataHeader"]);
    assert.ok(molfileGrammar.rules["V3000BeginCtab"]);
    assert.ok(molfileGrammar.rules["V3000EndCtab"]);
    assert.ok(molfileGrammar.rules["PropertyChgLine"]);
    assert.ok(molfileGrammar.rules["PropertyIsoLine"]);
    assert.ok(molfileGrammar.rules["PropertyRadLine"]);
    assert.ok(molfileGrammar.rules["PropertyEndLine"]);
    assert.ok(molfileGrammar.rules["VersionTag"]);
  });

  it("compiles molfileGrammar into GLR parse tables via buildParser", () => {
    const result = buildParser(molfileGrammar as never);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("instantiates dist/parser.wasm and parses V2000, V3000, and SDF documents without CST errors", async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm must exist");

    const { parser } = await createMolfileWasmParser(wasmPath);

    // 1. V2000 Benzene
    const v2000Tree = parser.parse(CANONICAL_MOLFILES.Benzene);
    assert.ok(v2000Tree.rootNode);
    assert.strictEqual(v2000Tree.rootNode.hasError, false);

    // 2. V3000 CTAB
    const v3000Sample = [
      "Ethane",
      "  ModelScript         3D",
      "",
      "  0  0  0     0  0            999 V3000",
      "M  V30 BEGIN CTAB",
      "M  V30 COUNTS 2 1 0 0 0",
      "M  V30 BEGIN ATOM",
      "M  V30 1 C 0.0000 0.0000 0.0000 0",
      "M  V30 2 C 1.5400 0.0000 0.0000 0",
      "M  V30 END ATOM",
      "M  V30 BEGIN BOND",
      "M  V30 1 1 1 2",
      "M  V30 END BOND",
      "M  V30 END CTAB",
      "M  END",
    ].join("\n");
    const v3000Tree = parser.parse(v3000Sample);
    assert.ok(v3000Tree.rootNode);
    assert.strictEqual(v3000Tree.rootNode.hasError, false);

    // 3. Multi-record SDF
    const sdfSample = [
      CANONICAL_MOLFILES.Water,
      "> <FORMULA>",
      "H2O",
      "",
      "$$$$",
      CANONICAL_MOLFILES.Ethanol,
      "> <FORMULA>",
      "C2H6O",
      "",
      "$$$$",
    ].join("\n");
    const sdfTree = parser.parse(sdfSample);
    assert.ok(sdfTree.rootNode);
    assert.strictEqual(sdfTree.rootNode.hasError, false);
  });
});
