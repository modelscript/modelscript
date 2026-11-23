// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { jedecLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/jedec — DSL Grammar & Native WASM GLR Parser", () => {
  it("defines declarative @modelscript/dsl jedecLanguage with all JESD3 field rules", () => {
    assert.equal(jedecLanguage.name, "jedec");
    assert.equal(jedecLanguage.maturity, "beta");
    assert.ok(jedecLanguage.fileExtensions.includes(".jed"));
    assert.ok(jedecLanguage.fileExtensions.includes(".jedec"));
    assert.ok(jedecLanguage.ui?.panels?.some((p) => p.entry.includes("JedecPanel.tsx")));
    assert.ok(jedecLanguage.rules);
    assert.ok(jedecLanguage.rules["JedecFile"]);
    assert.ok(jedecLanguage.rules["PinCountField"]);
    assert.ok(jedecLanguage.rules["FuseCountField"]);
    assert.ok(jedecLanguage.rules["MaxVectorsField"]);
    assert.ok(jedecLanguage.rules["DefaultFuseField"]);
    assert.ok(jedecLanguage.rules["SecurityFuseField"]);
    assert.ok(jedecLanguage.rules["DefaultTestField"]);
    assert.ok(jedecLanguage.rules["FuseListField"]);
    assert.ok(jedecLanguage.rules["TestVectorField"]);
    assert.ok(jedecLanguage.rules["NoteField"]);
    assert.ok(jedecLanguage.rules["FuseChecksumField"]);
  });

  it("compiles jedecLanguage via buildParser into AssemblyScript GLR parser & JS wrapper", () => {
    const result = buildParser(jedecLanguage as never);
    assert.ok(result, "buildParser should return compilation output");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f: { filename: string }) => f.filename === "parser.ts");
    assert.ok(parserFile, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS wrapper");
  });

  it("builds dist/parser.wasm and src-gen/bindings.js and parses a JESD3 file in WASM", async () => {
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
        "\x02QP20*",
        "QF2048*",
        "QV2*",
        "F0*",
        "G0*",
        "X0*",
        "N DEVICE PAL16L8*",
        "L0000 11111111111111111111111111111111*",
        "V0001 000000000N0XXXXXXXXN*",
        "C03FC*",
        "\x031A2B",
      ].join("\n");
      const cst = parser.parse(sample);
      assert.ok(cst, "WASM GLR parser should return a valid CST for JESD3 input");
    }
  });
});
