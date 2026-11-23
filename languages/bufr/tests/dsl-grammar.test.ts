// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { bufrLanguage } from "../src/language.js";

describe("@modelscript/bufr WASM GLR Grammar", () => {
  it("exports bufrLanguage metadata, extensions, and UI panel config", () => {
    assert.equal(bufrLanguage.name, "bufr");
    assert.equal(bufrLanguage.maturity, "beta");
    assert.ok(bufrLanguage.fileExtensions.includes(".bufr"));
    assert.ok(bufrLanguage.fileExtensions.includes(".bfr"));
    assert.ok(bufrLanguage.ui?.panels && bufrLanguage.ui.panels.length >= 1);
    assert.equal(bufrLanguage.ui?.panels?.[0]?.entry, "./src/ui/BufrPanel.tsx");
  });

  it("compiles dist/parser.wasm and parses BUFR descriptors via WASM GLR parser", async () => {
    const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    assert.equal(fs.existsSync(wasmPath), true, `Expected compiled WASM parser at ${wasmPath}`);

    const bindings = await import("../src-gen/bindings.js");
    const { parser } = await bindings.createWasmParser(wasmPath);

    const sample = `
# Radiosonde sample
BUFR EDITION 4 NAME SONDE_01
SECTION 1
  CENTRE = 7
  YEAR = 2026
SECTION 3
  SUBSETS = 1
  DESCRIPTORS:
    0-01-001
    1-02-003
    2-01-130
    3-01-001
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-12-101 = 288.15
SECTION 5
7777
`;
    const tree = parser.parse(sample);
    assert.ok(tree, "Expected non-null parse tree");
    assert.equal(tree.rootNode.hasError, false, "Expected zero GLR syntax errors on valid BUFR document");
  });
});
