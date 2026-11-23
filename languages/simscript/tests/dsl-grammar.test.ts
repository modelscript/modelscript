// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { simscriptLanguage } from "../src/language.js";

describe("SIMSCRIPT II.5 @modelscript/dsl Grammar & WASM Parser", () => {
  it("defines declarative SIMSCRIPT II.5 grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(simscriptLanguage.name, "simscript");
    assert.strictEqual(simscriptLanguage.maturity, "beta");
    assert.ok(simscriptLanguage.rules);
    assert.ok(simscriptLanguage.rules["Program"]);
    assert.ok(simscriptLanguage.rules["PreambleSection"]);
    assert.ok(simscriptLanguage.rules["EveryDeclaration"]);
    assert.ok(simscriptLanguage.rules["DefineDeclaration"]);
    assert.ok(simscriptLanguage.rules["TallyDeclaration"]);
    assert.ok(simscriptLanguage.rules["AccumulateDeclaration"]);
    assert.ok(simscriptLanguage.rules["MainSection"]);
    assert.ok(simscriptLanguage.rules["ProcessSection"]);
    assert.ok(simscriptLanguage.rules["RequestStmt"]);
    assert.ok(simscriptLanguage.rules["RelinquishStmt"]);
    assert.ok(simscriptLanguage.rules["StartSimulationStmt"]);
    assert.ok(simscriptLanguage.rules["Comment"]);
  });

  it("compiles SIMSCRIPT II.5 grammar into WebAssembly GLR parse tables & AssemblyScript kernel", () => {
    const result = buildParser(simscriptLanguage as any);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS bindings");
  });

  it("produces dist/parser.wasm and src-gen/bindings.{js,d.ts} build artifacts", () => {
    const pkgDir = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgDir, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgDir, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgDir, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 100, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
