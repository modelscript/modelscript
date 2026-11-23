// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VerilogArchetypeId,
  ensureBuiltInVerilogLibraryRegistered,
  getVerilogSchemasFromLibraries,
  lookupVerilogModelSchema,
} from "../src/catalog/index.js";
import { getVerilogStdLibWasmBytes } from "../src/catalog/verilog-std-lib-data.js";

describe("Verilog Cleanroom Standard Library (@modelscript/verilog-std-lib)", () => {
  it("registers @modelscript/verilog-std-lib in globalLibraryRegistry with all IEEE 1364 gates & RTL blocks", () => {
    ensureBuiltInVerilogLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("verilog");
    assert.ok(pkgs.length >= 1, "Should register verilog stdlib package");

    const schemas = getVerilogSchemasFromLibraries();
    assert.ok(schemas.length >= 24, `Expected >= 24 schemas, got ${schemas.length}`);

    const requiredPrimitives = [
      "and",
      "nand",
      "or",
      "nor",
      "xor",
      "xnor",
      "buf",
      "not",
      "bufif0",
      "bufif1",
      "notif0",
      "notif1",
      "dff",
      "dffr",
      "mux2",
      "full_adder",
      "alu4",
      "shift_reg",
      "lfsr7",
    ];
    for (const name of requiredPrimitives) {
      const schema = lookupVerilogModelSchema(name);
      assert.ok(schema, `Missing cleanroom schema for '${name}'`);
      assert.ok(schema.svg?.includes("<svg"), `Missing SVG icon for '${name}'`);
    }
  });

  it("executes compiled AssemblyScript runtime.wasm 4-state gate & full-adder kernels", async () => {
    const bytes = getVerilogStdLibWasmBytes();
    assert.ok(bytes.byteLength > 0, "WASM bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(bytes);
    const evalPrim = instance.exports["verilogEvalPrimitive"] as (
      arch: number,
      a: number,
      b: number,
      c: number,
    ) => number;

    // 4-state encoding: 0=0, 1=1, 2=X, 3=Z
    assert.strictEqual(evalPrim(VerilogArchetypeId.AND, 1, 1, 0), 1);
    assert.strictEqual(evalPrim(VerilogArchetypeId.AND, 0, 2, 0), 0); // 0 & X = 0
    assert.strictEqual(evalPrim(VerilogArchetypeId.OR, 1, 2, 0), 1); // 1 | X = 1
    assert.strictEqual(evalPrim(VerilogArchetypeId.XOR, 1, 0, 0), 1);
    assert.strictEqual(evalPrim(VerilogArchetypeId.XOR, 1, 3, 0), 2); // 1 ^ Z = X
    assert.strictEqual(evalPrim(VerilogArchetypeId.BUFIF1, 1, 0, 0), 3); // en=0 -> Z
    assert.strictEqual(evalPrim(VerilogArchetypeId.BUFIF1, 1, 1, 0), 1); // en=1 -> 1
    assert.strictEqual(evalPrim(VerilogArchetypeId.NOTIF0, 1, 0, 0), 0); // en=0 -> ~1 = 0
    assert.strictEqual(evalPrim(VerilogArchetypeId.NOTIF0, 1, 1, 0), 3); // en=1 -> Z

    // Full adder: 1 + 1 + 1 => sum=1, cout=1 -> (1 << 8) | 1
    assert.strictEqual(evalPrim(VerilogArchetypeId.FULL_ADDER, 1, 1, 1), (1 << 8) | 1);
    // 4-bit ALU ADD: 7 + 5 = 12
    assert.strictEqual(evalPrim(VerilogArchetypeId.ALU4, 7, 5, 0), 12);
  });
});
