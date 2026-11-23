// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cplexLpLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("@modelscript/cplex-lp DSL Grammar & WASM Parser Suite", () => {
  it("defines declarative CPLEX LP / LINDO grammar conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(cplexLpLanguage.name, "cplex-lp");
    assert.strictEqual(cplexLpLanguage.maturity, "beta");
    assert.deepStrictEqual(cplexLpLanguage.fileExtensions, [".lp", ".ltx", ".lindo"]);
    assert.ok(cplexLpLanguage.rules["Model"]);
    assert.ok(cplexLpLanguage.rules["ObjectiveSection"]);
    assert.ok(cplexLpLanguage.rules["ConstraintsSection"]);
    assert.ok(cplexLpLanguage.rules["QuadraticBlock"]);
    assert.ok(cplexLpLanguage.rules["BoundsSection"]);
    assert.ok(cplexLpLanguage.rules["GeneralsSection"]);
    assert.ok(cplexLpLanguage.rules["BinariesSection"]);
    assert.ok(cplexLpLanguage.rules["SemiContinuousSection"]);
    assert.ok(cplexLpLanguage.rules["SosSection"]);
    assert.ok(cplexLpLanguage.rules["LindoDirective"]);
    assert.ok(cplexLpLanguage.rules["EndSection"]);
  });

  it("compiles cplexLpLanguage via buildParser into AssemblyScript kernel and JS/TS bindings", () => {
    const result = buildParser(cplexLpLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0);
    assert.ok(result.javascriptWrapper.dts.length > 0);
  });

  it("produces built dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 0, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
