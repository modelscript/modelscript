// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEdifCleanroomSchemas,
  EdifArchetypeId,
  ensureBuiltInEdifLibraryRegistered,
  getEdifSchemasFromLibraries,
  getEdifStdLibWasmBytes,
  lookupEdifModelSchema,
} from "../src/index.js";

const REQUIRED_CELLS = ["RES", "CAP", "IND", "GND", "VCC", "AND2", "OR2", "NAND2", "NOR2", "INV", "XOR2", "DFF"];

describe("@modelscript/edif Cleanroom Standard Library Suite", () => {
  it("registers all 12 standard EDIF GENERIC cells with cleanroom SVG icons and zero-I/O WASM bytes", () => {
    ensureBuiltInEdifLibraryRegistered();
    const schemas = getEdifSchemasFromLibraries();
    assert.strictEqual(schemas.length, 12);
    assert.strictEqual(buildEdifCleanroomSchemas().length, 12);

    for (const cellName of REQUIRED_CELLS) {
      const schema = lookupEdifModelSchema(cellName);
      assert.ok(schema, `Expected standard EDIF cell '${cellName}' in library registry`);
      assert.ok(schema.svg && schema.svg.includes("<svg"), `Expected SVG icon for '${cellName}'`);
      assert.ok(schema.ports.length >= 1, `Expected ports on '${cellName}'`);
    }

    const wasmBytes = getEdifStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty compiled runtime.wasm bytes");
    // Check WASM magic header \0asm
    assert.strictEqual(wasmBytes[0], 0x00);
    assert.strictEqual(wasmBytes[1], 0x61);
    assert.strictEqual(wasmBytes[2], 0x73);
    assert.strictEqual(wasmBytes[3], 0x6d);
  });

  it("instantiates and executes cleanroom AssemblyScript runtime.wasm kernels for RES and XOR2", async () => {
    const wasmBytes = getEdifStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      init: (arch: number, ptr: number) => number;
      edif_eval: (arch: number, ptr: number, dt: number) => number;
    };

    const slotPtr = 4096;
    const view = new DataView(exports.memory.buffer);

    // Test RES: R = 2000 Ohm, vP = 10 V, vN = 2 V => I = (10 - 2) / 2000 = 4 mA
    view.setFloat64(slotPtr + 0x080, 2000.0, true); // CON[0] = R
    view.setFloat64(slotPtr + 0x780, 10.0, true); // IO[0] = vP
    view.setFloat64(slotPtr + 0x788, 2.0, true); // IO[1] = vN
    assert.strictEqual(exports.edif_eval(EdifArchetypeId.RES, slotPtr, 0), 0);
    const iRes = view.getFloat64(slotPtr + 0x790, true);
    assert.ok(Math.abs(iRes - 0.004) < 1e-12, `Expected 0.004 A, got ${iRes}`);

    // Test XOR2: VDD = 5 V, A = 5 V, B = 0 V => Y = 5 V
    view.setFloat64(slotPtr + 0x080, 5.0, true); // CON[0] = VDD
    view.setFloat64(slotPtr + 0x780, 5.0, true); // IO[0] = A
    view.setFloat64(slotPtr + 0x788, 0.0, true); // IO[1] = B
    assert.strictEqual(exports.edif_eval(EdifArchetypeId.XOR2, slotPtr, 0), 0);
    const yXor = view.getFloat64(slotPtr + 0x790, true);
    assert.strictEqual(yXor, 5.0);
  });
});
