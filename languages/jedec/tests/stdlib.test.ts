// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJedecCleanroomSchemas,
  ensureBuiltInJedecLibraryRegistered,
  getJedecSchemasFromLibraries,
  JedecArchetypeId,
  lookupJedecModelSchema,
} from "../src/catalog/index.js";
import { getJedecStdLibWasmBytes } from "../src/catalog/jedec-std-lib-data.js";

describe("@modelscript/jedec — Cleanroom Standard Library & WASM Kernel", () => {
  it("registers @modelscript/jedec-std-lib with classic 1980s PLDs and JESD3 field descriptors", () => {
    ensureBuiltInJedecLibraryRegistered();
    const schemas = getJedecSchemasFromLibraries();
    const declared = buildJedecCleanroomSchemas();

    assert.equal(schemas.length, declared.length);
    assert.ok(schemas.length >= 9, "Expected 4 PLDs + 5 JESD3 field descriptors");

    for (const expectedName of ["PAL16L8", "PAL16R8", "GAL16V8", "GAL22V10", "QP", "QF", "L", "C", "V"]) {
      const found = lookupJedecModelSchema(expectedName);
      assert.ok(found, `Expected schema '${expectedName}' in jedec-std-lib`);
      assert.ok(found.svg && found.svg.startsWith("<svg"), `Expected cleanroom SVG icon for '${expectedName}'`);
    }

    // Alias lookup
    assert.equal(lookupJedecModelSchema("16L8")?.name, "PAL16L8");
    assert.equal(lookupJedecModelSchema("22V10")?.name, "GAL22V10");
  });

  it("instantiates the pre-bundled AssemblyScript runtime.wasm and evaluates PLD kernels", async () => {
    const wasmBytes = getJedecStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 64, "Expected non-empty stdlib runtime.wasm");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      jedecFuseCountForDevice: (id: number) => number;
      jedecPinCountForDevice: (id: number) => number;
      jedecBlownFuseRatio: (blown: number, total: number) => number;
      jedecChecksumAccumulateByte: (acc: number, byteVal: number) => number;
    };

    assert.equal(exports.jedecFuseCountForDevice(JedecArchetypeId.PAL16L8), 2048);
    assert.equal(exports.jedecFuseCountForDevice(JedecArchetypeId.PAL16R8), 2048);
    assert.equal(exports.jedecFuseCountForDevice(JedecArchetypeId.GAL16V8), 2194);
    assert.equal(exports.jedecFuseCountForDevice(JedecArchetypeId.GAL22V10), 5892);
    assert.equal(exports.jedecPinCountForDevice(JedecArchetypeId.PAL16L8), 20);
    assert.equal(exports.jedecPinCountForDevice(JedecArchetypeId.GAL22V10), 24);
    assert.equal(exports.jedecBlownFuseRatio(512, 2048), 0.25);
    assert.equal(exports.jedecChecksumAccumulateByte(0xffff, 0x02), 0x0001);
  });
});
