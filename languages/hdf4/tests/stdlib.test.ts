// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHdf4StdLibWasmBytes } from "../src/catalog/hdf4-std-lib-data.js";
import {
  Hdf4ArchetypeId,
  buildHdf4CleanroomSchemas,
  ensureBuiltInHdf4LibraryRegistered,
  getHdf4SchemasFromLibraries,
  lookupHdf4ModelSchema,
} from "../src/catalog/index.js";

describe("HDF4 cleanroom standard library (@modelscript/hdf4-std-lib)", () => {
  it("registers core HDF4 object tags and NASA EOS-HDF archetypes in globalLibraryRegistry", () => {
    ensureBuiltInHdf4LibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("hdf4");
    assert.ok(pkgs.length >= 1, "Expected @modelscript/hdf4-std-lib registered");

    const schemas = getHdf4SchemasFromLibraries();
    assert.equal(schemas.length, buildHdf4CleanroomSchemas().length);
    assert.ok(schemas.length >= 12);

    for (const required of [
      "SDS",
      "Vgroup",
      "Vdata",
      "Raster8",
      "Palette",
      "NDG",
      "EOS_SWATH",
      "EOS_GRID",
      "MODIS_L1B",
    ]) {
      const found = lookupHdf4ModelSchema(required);
      assert.ok(found, `Expected schema for ${required}`);
      assert.ok(found.svg?.includes("<svg"), `Expected cleanroom SVG icon for ${required}`);
    }
  });

  it("instantiates and executes the compiled AssemblyScript WASM runtime kernel", async () => {
    const wasmBytes = getHdf4StdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 32, "Expected non-empty WASM binary");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      hdf4ModelEval: (archetypeId: number, slotPtr: number, conCount: number) => number;
    };

    if (exports.memory.buffer.byteLength < 256) {
      exports.memory.grow(1);
    }
    const slotPtr = 0;
    const f64 = new Float64Array(exports.memory.buffer, slotPtr, 32);
    // MODIS_L1B: con[1]=scale=0.005, con[2]=offset=10.0, io[0]=raw=210.0 -> 0.005*(210-10) = 1.0
    f64[0] = 15;
    f64[1] = 0.005;
    f64[2] = 10.0;
    f64[16] = 210.0; // OFF_IO = 0x80 = 16 f64s

    const result = exports.hdf4ModelEval(Hdf4ArchetypeId.MODIS_L1B, slotPtr, 3);
    assert.ok(Math.abs(result - 1.0) < 1e-12, `Expected 1.0, got ${result}`);
  });
});
