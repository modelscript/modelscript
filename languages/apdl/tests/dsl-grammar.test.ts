// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apdlLanguage } from "../src/language.js";
import { getApdlWasmParser } from "../src/wasm-loader.js";

describe("APDL @modelscript/dsl Grammar & WASM GLR Parser", () => {
  it("defines declarative APDL language specification conforming to @modelscript/dsl", () => {
    assert.strictEqual(apdlLanguage.name, "apdl");
    assert.strictEqual(apdlLanguage.maturity, "beta");
    assert.ok(apdlLanguage.fileExtensions.includes(".apdl"));
    assert.ok(apdlLanguage.fileExtensions.includes(".mac"));
    assert.ok(apdlLanguage.rules);
    assert.ok(apdlLanguage.rules["Program"]);
    assert.ok(apdlLanguage.rules["ProcessorCommand"]);
    assert.ok(apdlLanguage.rules["MacroCommand"]);
    assert.ok(apdlLanguage.rules["AssignmentStatement"]);
    assert.ok(apdlLanguage.rules["CommandStatement"]);
    assert.ok(apdlLanguage.rules["Comment"]);
  });

  it("compiles apdlLanguage into WebAssembly GLR parse tables & AssemblyScript kernel via buildParser", () => {
    const result = buildParser(apdlLanguage as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper bindings");
  });

  it("parses APDL processors, commands, macros, and comments via compiled parser.wasm", () => {
    const parser = getApdlWasmParser();
    const src = `
! Cantilever beam
/PREP7
L = 2.0
*SET, P, 1000
ET, 1, BEAM188
MP, EX, 1, 210e9
*DO, I, 1, 3, 1
  N, I, (I - 1) * L / 2, 0, 0
*ENDDO
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, 3, FY, -P
SOLVE
FINISH
`;
    const tree = parser.parse(src);
    assert.ok(tree?.rootNode, "WASM parser should return a root CST node");
    assert.strictEqual(tree.rootNode.hasError, false, "Valid APDL script should have no WASM CST errors");
  });
});
