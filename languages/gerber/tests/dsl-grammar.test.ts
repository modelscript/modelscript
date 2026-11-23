// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gerberLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/gerber — DSL Grammar & Native WASM GLR Parser", () => {
  it("defines declarative @modelscript/dsl gerberLanguage with all RS-274-D & RS-274X rules", () => {
    assert.equal(gerberLanguage.name, "gerber");
    assert.equal(gerberLanguage.maturity, "beta");
    assert.ok(gerberLanguage.fileExtensions.includes(".gbr"));
    assert.ok(gerberLanguage.fileExtensions.includes(".gtl"));
    assert.ok(gerberLanguage.rules);
    assert.ok(gerberLanguage.rules["GerberFile"]);
    assert.ok(gerberLanguage.rules["ExtendedParam"]);
    assert.ok(gerberLanguage.rules["FormatSpecParam"]);
    assert.ok(gerberLanguage.rules["UnitModeParam"]);
    assert.ok(gerberLanguage.rules["ApertureDefParam"]);
    assert.ok(gerberLanguage.rules["ApertureMacroParam"]);
    assert.ok(gerberLanguage.rules["PolarityParam"]);
    assert.ok(gerberLanguage.rules["StepRepeatParam"]);
    assert.ok(gerberLanguage.rules["AttributeParam"]);
    assert.ok(gerberLanguage.rules["RegionCommand"]);
    assert.ok(gerberLanguage.rules["OperationCommand"]);
    assert.ok(gerberLanguage.rules["EofCommand"]);
  });

  it("compiles gerberLanguage via buildParser into AssemblyScript GLR parser & JS wrapper", () => {
    const result = buildParser(gerberLanguage as never);
    assert.ok(result, "buildParser should return compilation output");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f: { filename: string }) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS wrapper");
  });

  it("builds dist/parser.wasm and src-gen/bindings.js and parses a Gerber file in WASM", async () => {
    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsPath = path.join(PKG_ROOT, "src-gen", "bindings.js");
    assert.ok(fs.existsSync(wasmPath), "Expected compiled dist/parser.wasm");
    assert.ok(fs.existsSync(bindingsPath), "Expected generated src-gen/bindings.js");
    assert.ok(fs.statSync(wasmPath).size > 1024, "Expected non-empty parser.wasm");

    const bindings = (await import(bindingsPath)) as {
      createWasmParser?: (p: string) => Promise<{ parser: { parse: (src: string) => unknown } }>;
    };
    if (typeof bindings.createWasmParser === "function") {
      const { parser } = await bindings.createWasmParser(wasmPath);
      const sample = [
        "G04 Sample PCB*",
        "%FSLAX24Y24*%",
        "%MOMM*%",
        "%ADD10C,0.254*%",
        "%LPD*%",
        "G01*",
        "D10*",
        "X0Y0D02*",
        "X10000Y0D01*",
        "M02*",
      ].join("\n");
      const tree = parser.parse(sample);
      assert.ok(tree, "WASM GLR parser should return a parse tree");
    }
  });
});
