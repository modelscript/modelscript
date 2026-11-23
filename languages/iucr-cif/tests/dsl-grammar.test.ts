// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CANONICAL_CIF_TEMPLATES } from "../src/catalog/iucr-cif-std-schemas.js";
import { iucrCifLanguage } from "../src/language.js";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("IUCr CIF DSL Grammar & WASM GLR Parser", () => {
  it("declares Beta maturity, file extensions, UI panel, and error codes", () => {
    assert.equal(iucrCifLanguage.name, "iucr-cif");
    assert.equal(iucrCifLanguage.maturity, "beta");
    assert.ok(iucrCifLanguage.fileExtensions.includes(".cif"));
    assert.ok(iucrCifLanguage.fileExtensions.includes(".star"));
    assert.ok(iucrCifLanguage.ui?.panels?.some((p) => p.entry.includes("IucrCifPanel.tsx")));
    assert.ok(iucrCifLanguage.errorCodes);
  });

  it("compiles dist/parser.wasm and src-gen/bindings and parses canonical Silicon CIF", async () => {
    const wasmPath = path.join(pkgDir, "dist", "parser.wasm");
    const bindingsPath = path.join(pkgDir, "src-gen", "bindings.js");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(bindingsPath), "src-gen/bindings.js should exist");

    const { parser } = await createWasmParser(wasmPath);
    const tree = parser.parse(CANONICAL_CIF_TEMPLATES.silicon);
    assert.ok(tree, "WASM GLR parser should produce a parse tree");
    assert.ok(tree.rootNode, "Parse tree should have a root node");
    assert.equal(tree.rootNode.hasError, false, "Canonical Silicon CIF should parse without syntax errors");
  });
});
