// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateReferenceEndf6Tape } from "../src/catalog/reference-tapes.js";
import { endf6Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("ENDF-6 DSL Language & WASM GLR Parser", () => {
  it("exports endf6Language with beta maturity, extensions, and Endf6Panel UI metadata", () => {
    assert.equal(endf6Language.name, "endf6");
    assert.equal(endf6Language.maturity, "beta");
    assert.ok(endf6Language.fileExtensions.includes(".endf"));
    assert.ok(endf6Language.fileExtensions.includes(".endf6"));
    assert.ok(endf6Language.ui?.panels && endf6Language.ui.panels.length > 0);
    assert.equal(endf6Language.ui.panels[0]!.entry, "./src/ui/Endf6Panel.tsx");
    assert.ok(endf6Language.indexing);
  });

  it("compiles endf6Language into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(endf6Language as never);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("produces dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist after build");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });

  it("parses an 80-column ENDF-6 tape with the compiled WASM GLR parser", async () => {
    const { createWasmParser } = await import("@modelscript/dsl");
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const { parser } = await createWasmParser(wasmPath);

    const sampleTape = generateReferenceEndf6Tape("H-1");
    const tree = parser.parse(sampleTape);
    assert.ok(tree, "WASM GLR parser should return a CST");
    assert.ok(tree.rootNode.childCount > 10, `Expected > 10 CST nodes, got ${tree.rootNode.childCount}`);
  });
});
