// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { usgsDemLanguage } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

const SAMPLE_DEM = [
  'TYPE_A "TEST_QUAD" LEVEL=1 PATTERN=1 REF=1 ZONE=13 UNITS=2 ZUNITS=2 DX=30 DY=30 DZ=1 MINZ=100 MAXZ=120 NROWS=1 NCOLS=2',
  "TYPE_B 1 1 2 1 500000 4400000 0 100 110 : 100 110",
  "TYPE_B 1 2 2 1 500030 4400000 0 110 120 : 110 120",
  "TYPE_C 1 1 1 1 10 1 1 1 1 20",
].join("\n");

describe("@modelscript/usgs-dem WASM GLR grammar", () => {
  it("exports usgsDemLanguage with beta maturity, extensions, and UI panel", () => {
    assert.equal(usgsDemLanguage.name, "usgs-dem");
    assert.equal(usgsDemLanguage.maturity, "beta");
    assert.ok(usgsDemLanguage.fileExtensions.includes(".dem"));
    assert.ok(usgsDemLanguage.ui?.panels?.some((p) => p.entry.includes("UsgsDemPanel.tsx")));
  });

  it("compiles dist/parser.wasm and parses USGS DEM records without syntax errors", async () => {
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm must exist");
    const { parser } = await createWasmParser(wasmPath);
    const tree = parser.parse(SAMPLE_DEM);
    assert.ok(tree, "WASM parser should return a parse tree");
    assert.equal(tree.rootNode.hasError, false, `Parse tree should have no syntax errors: ${tree.rootNode.toString()}`);
  });
});
