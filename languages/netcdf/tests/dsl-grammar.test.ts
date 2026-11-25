// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { netcdfLanguage } from "../src/language.js";

describe("NetCDF Classic CDL @modelscript/dsl Grammar & WASM GLR Parser", () => {
  it("defines formal declarative CDL grammar and UI panel metadata", () => {
    assert.strictEqual(netcdfLanguage.name, "netcdf");
    assert.strictEqual(netcdfLanguage.maturity, "beta");
    assert.ok(netcdfLanguage.fileExtensions?.includes(".cdl"));
    assert.ok(netcdfLanguage.fileExtensions?.includes(".nc"));
    assert.ok(netcdfLanguage.fileExtensions?.includes(".cdf"));
    assert.ok(netcdfLanguage.rules);
    assert.ok(netcdfLanguage.rules["NetcdfDocument"]);
    assert.ok(netcdfLanguage.rules["DimensionsSection"]);
    assert.ok(netcdfLanguage.rules["VariablesSection"]);
    assert.ok(netcdfLanguage.rules["DataSection"]);
    assert.ok(netcdfLanguage.rules["DataType"]);

    const panel = netcdfLanguage.ui?.panels?.[0];
    assert.ok(panel, "Should register NetcdfPanel in ui.panels");
    assert.strictEqual(panel.entry, "./src/ui/NetcdfPanel.tsx");
    assert.deepStrictEqual(panel.targets, ["vscode", "ansatz", "artifact"]);
  });

  it("compiles netcdfLanguage into WebAssembly GLR parse tables & AssemblyScript kernel", () => {
    const result = buildParser(netcdfLanguage as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
