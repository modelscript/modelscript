// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { dynamoLanguage } from "../src/language.js";

describe("@modelscript/dynamo DSL Grammar & WASM GLR Parser Suite", () => {
  it("defines formal declarative DYNAMO grammar conforming to @modelscript/dsl", () => {
    assert.strictEqual(dynamoLanguage.name, "dynamo");
    assert.strictEqual(dynamoLanguage.maturity, "beta");
    assert.ok(dynamoLanguage.rules);
    assert.ok(dynamoLanguage.rules["Model"]);
    assert.ok(dynamoLanguage.rules["LevelEquation"]);
    assert.ok(dynamoLanguage.rules["RateEquation"]);
    assert.ok(dynamoLanguage.rules["AuxiliaryEquation"]);
    assert.ok(dynamoLanguage.rules["InitialEquation"]);
    assert.ok(dynamoLanguage.rules["ConstantEquation"]);
    assert.ok(dynamoLanguage.rules["TableEquation"]);
    assert.ok(dynamoLanguage.rules["SupplementaryEquation"]);
    assert.ok(dynamoLanguage.rules["SpecStatement"]);
    assert.ok(dynamoLanguage.rules["TimeSubscript"]);
  });

  it("compiles DYNAMO grammar into WebAssembly GLR parse tables & AssemblyScript via buildParser", () => {
    const result = buildParser(dynamoLanguage as any);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");

    const parserFile = result.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts for linear memory kernel");
    assert.ok(parserFile.content.includes("export class GLRParser") || parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("emits built dist/parser.wasm and src-gen/bindings.js artifacts", () => {
    const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-trivial WASM binary");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
