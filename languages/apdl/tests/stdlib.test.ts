// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApdlArchetypeId,
  ensureBuiltInApdlLibraryRegistered,
  getApdlSchemasFromLibraries,
  getApdlStdLibWasmBytes,
  lookupApdlElementSchema,
} from "../src/catalog/index.js";

describe("APDL Cleanroom Standard Library (@modelscript/apdl-std-lib)", () => {
  it("registers all 7 cleanroom APDL element schemas with deterministic SVG icons", () => {
    ensureBuiltInApdlLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("apdl");
    assert.ok(pkgs.length >= 1, "apdl-std-lib should be registered in globalLibraryRegistry");

    const schemas = getApdlSchemasFromLibraries();
    const expectedElements = ["LINK180", "BEAM188", "PLANE182", "SHELL181", "SOLID185", "MASS21", "COMBIN14"];
    for (const elem of expectedElements) {
      const schema = lookupApdlElementSchema(elem);
      assert.ok(schema, `Missing schema for ${elem}`);
      assert.ok(schema.svg && schema.svg.includes("<svg"), `${elem} should have a cleanroom SVG icon`);
      assert.ok(schema.parameters.length > 0, `${elem} should declare default parameters`);
    }
    assert.ok(schemas.length >= 7);
  });

  it("resolves element aliases case-insensitively", () => {
    assert.strictEqual(lookupApdlElementSchema("beam188")?.name, "BEAM188");
    assert.strictEqual(lookupApdlElementSchema("truss")?.name, "LINK180");
    assert.strictEqual(lookupApdlElementSchema("hex8")?.name, "SOLID185");
    assert.strictEqual(lookupApdlElementSchema("spring")?.name, "COMBIN14");
  });

  it("executes the AssemblyScript WASM runtime kernel for LINK180 and BEAM188", async () => {
    const wasmBytes = getApdlStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "WASM runtime bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      evalElement: (slotPtr: number, archetypeId: number, conCount: number) => number;
    };

    const slotPtr = 2048;
    const view = new DataView(exports.memory.buffer);
    const writeCon = (idx: number, val: number) => view.setFloat64(slotPtr + 0x080 + idx * 8, val, true);
    const writeIo = (idx: number, val: number) => view.setFloat64(slotPtr + 0x780 + idx * 8, val, true);
    const readIo = (idx: number) => view.getFloat64(slotPtr + 0x780 + idx * 8, true);

    // Evaluate LINK180: E=200e9, A=1e-4, L=2.0, rho=7850, du=0.001 -> kAxial=1e7, F=1e4
    writeCon(0, 200e9);
    writeCon(1, 1e-4);
    writeCon(2, 2.0);
    writeCon(3, 7850.0);
    writeIo(0, 0.001);
    const rc = exports.evalElement(slotPtr, ApdlArchetypeId.LINK180, 4);
    assert.strictEqual(rc, 0);
    assert.ok(Math.abs(readIo(8) - 1e7) < 1e-3, `Expected kAxial=1e7, got ${readIo(8)}`);
    assert.ok(Math.abs(readIo(9) - 1e4) < 1e-6, `Expected F=1e4, got ${readIo(9)}`);
  });
});
