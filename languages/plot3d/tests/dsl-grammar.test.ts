// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { plot3dLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("PLOT3D @modelscript/dsl Grammar & WASM GLR Parser", () => {
  it("defines formal declarative plot3dLanguage conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(plot3dLanguage.name, "plot3d");
    assert.strictEqual(plot3dLanguage.maturity, "beta");
    assert.ok(plot3dLanguage.fileExtensions.includes(".xyz"));
    assert.ok(plot3dLanguage.fileExtensions.includes(".q"));
    assert.ok(plot3dLanguage.fileExtensions.includes(".f"));
    assert.ok(plot3dLanguage.fileExtensions.includes(".nam"));
    assert.ok(plot3dLanguage.rules["Plot3dDocument"]);
    assert.ok(plot3dLanguage.rules["NumberLiteral"]);
    assert.ok(plot3dLanguage.rules["RepeatValue"]);
    assert.ok(plot3dLanguage.rules["VariableName"]);
  });

  it("compiles plot3dLanguage into AssemblyScript GLR parser tables via buildParser", () => {
    const result = buildParser(plot3dLanguage);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("loads compiled dist/parser.wasm and parses ASCII PLOT3D .xyz, .q, and .nam documents", async () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsPath = path.join(pkgRoot, "src-gen", "bindings.js");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(bindingsPath), "src-gen/bindings.js should exist");

    const bindings = (await import(bindingsPath)) as {
      createWasmParser: (wasmBytes: Uint8Array) => Promise<{
        parser: { parse: (src: string) => { rootNode: { type: string; hasError: boolean; childCount: number } } };
      }>;
    };
    const wasmBytes = new Uint8Array(fs.readFileSync(wasmPath));
    const { parser } = await bindings.createWasmParser(wasmBytes);

    const gridTree = parser.parse("1\n2 2 2\n0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0\n");
    assert.strictEqual(gridTree.rootNode.hasError, false, gridTree.rootNode.toString());
    assert.ok(gridTree.rootNode.childCount > 0);

    const solTree = parser.parse("# Q-file\n0.8 0.0 1.0D+6 0.0\n4*1.225\n");
    assert.strictEqual(solTree.rootNode.hasError, false, solTree.rootNode.toString());

    const namTree = parser.parse("# Variable names\nDensity\nPressure\nMach_Number\n");
    assert.strictEqual(namTree.rootNode.hasError, false, namTree.rootNode.toString());
  });
});
