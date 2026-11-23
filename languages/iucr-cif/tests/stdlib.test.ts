// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIucrCifCleanroomSchemas,
  ensureBuiltInIucrCifLibraryRegistered,
  getIucrCifSchemasFromLibraries,
  getIucrCifStdLibWasmBytes,
  lookupIucrCifSchema,
} from "../src/catalog/index.js";

describe("Cleanroom IUCr CIF Standard Library (@modelscript/iucr-cif-std-lib)", () => {
  it("registers core CIF dictionary categories and canonical crystal schemas with zero I/O", () => {
    ensureBuiltInIucrCifLibraryRegistered();
    const schemas = getIucrCifSchemasFromLibraries();
    const expected = buildIucrCifCleanroomSchemas();

    assert.equal(schemas.length, expected.length);
    assert.ok(lookupIucrCifSchema("_cell"));
    assert.ok(lookupIucrCifSchema("_symmetry"));
    assert.ok(lookupIucrCifSchema("_atom_site"));
    assert.ok(lookupIucrCifSchema("_diffrn"));
    assert.ok(lookupIucrCifSchema("SILICON_FD3M"));
    assert.ok(lookupIucrCifSchema("NACL_FM3M"));
    assert.ok(lookupIucrCifSchema("ALPHA_QUARTZ"));
    assert.ok(lookupIucrCifSchema("FCC_COPPER"));
  });

  it("instantiates AssemblyScript WASM runtime and computes unit-cell volume & Bragg 2θ", async () => {
    const wasmBytes = getIucrCifStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Stdlib WASM runtime bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      unitCellVolume: (a: number, b: number, c: number, al: number, be: number, ga: number) => number;
      cubicDSpacing: (a: number, h: number, k: number, l: number) => number;
      braggTwoTheta: (d: number, lambda: number) => number;
    };

    const volSi = exports.unitCellVolume(5.431, 5.431, 5.431, 90, 90, 90);
    assert.ok(Math.abs(volSi - Math.pow(5.431, 3)) < 1e-6);

    const d111 = exports.cubicDSpacing(5.431, 1, 1, 1);
    const twoTheta = exports.braggTwoTheta(d111, 1.5406);
    assert.ok(Math.abs(twoTheta - 28.4428) < 0.01);
  });
});
