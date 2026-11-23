// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  VHDL_STD_SPECS,
  VhdlArchetypeId,
  getVhdlSchemasFromLibraries,
  getVhdlStdLibWasmBytes,
  lookupVhdlModelSchema,
  registerBuiltInVhdlLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/vhdl-std-lib");

describe("@modelscript/vhdl — Cleanroom IEEE Standard Library & WASM Runtime", () => {
  it("loads @modelscript/vhdl-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected vhdl-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/vhdl-std-lib");
    assert.equal(pkg.manifest.language, "vhdl");
    assert.equal(pkg.symbols.length, VHDL_STD_SPECS.length);
    assert.equal(pkg.diagrams.length, VHDL_STD_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and lookup for STD.STANDARD, IEEE.STD_LOGIC_1164, IEEE.NUMERIC_STD, and gates", () => {
    registerBuiltInVhdlLibrarySync();
    const schemas = getVhdlSchemasFromLibraries();
    assert.ok(schemas.length >= VHDL_STD_SPECS.length);

    assert.equal(lookupVhdlModelSchema("STD_LOGIC")?.namePath, "IEEE.STD_LOGIC_1164.STD_LOGIC");
    assert.equal(lookupVhdlModelSchema("UNSIGNED")?.namePath, "IEEE.NUMERIC_STD.UNSIGNED");
    assert.equal(lookupVhdlModelSchema("BIT")?.namePath, "STD.STANDARD.BIT");
    assert.equal(lookupVhdlModelSchema("full_adder")?.name, "FA1");
    assert.equal(lookupVhdlModelSchema("d_flip_flop")?.name, "DFF");
  });

  it("executes IEEE 1164 resolution, 9-value gates, full adder, edge detection, and NUMERIC_STD in runtime.wasm", async () => {
    const wasmBytes = getVhdlStdLibWasmBytes();
    const mod = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
      },
    });
    const exports = mod.instance.exports as {
      resolveStdLogic: (a: number, b: number) => number;
      stdAnd: (a: number, b: number) => number;
      stdOr: (a: number, b: number) => number;
      stdXor: (a: number, b: number) => number;
      fullAdder1: (a: number, b: number, cin: number) => number;
      isRisingEdge: (prev: number, curr: number) => number;
      addUnsigned: (a: number, b: number, width: number) => number;
      vhdlStdEval: (arch: number, i0: number, i1: number, i2: number) => number;
    };

    // Encoding: 0='U', 1='X', 2='0', 3='1', 4='Z', 5='W', 6='L', 7='H', 8='-'
    assert.equal(exports.resolveStdLogic(2, 3), 1); // '0' + '1' = 'X'
    assert.equal(exports.resolveStdLogic(3, 4), 3); // '1' + 'Z' = '1'
    assert.equal(exports.stdAnd(3, 2), 2); // '1' AND '0' = '0'
    assert.equal(exports.stdOr(2, 3), 3); // '0' OR '1' = '1'
    assert.equal(exports.stdXor(3, 3), 2); // '1' XOR '1' = '0'

    // 1-bit full adder: 1 + 1 + 1 => sum = '1' (3), cout = '1' (3)
    const faRes = exports.fullAdder1(3, 3, 3);
    assert.equal(faRes & 0xf, 3);
    assert.equal((faRes >> 4) & 0xf, 3);

    // Rising edge: '0'(2) -> '1'(3) = 1; '1'(3) -> '1'(3) = 0
    assert.equal(exports.isRisingEdge(2, 3), 1);
    assert.equal(exports.isRisingEdge(3, 3), 0);

    // 4-bit modular unsigned addition: 15 + 2 mod 16 = 1
    assert.equal(exports.addUnsigned(15, 2, 4), 1);
    assert.equal(exports.vhdlStdEval(VhdlArchetypeId.AND2, 3, 3, 0), 3);
  });
});
