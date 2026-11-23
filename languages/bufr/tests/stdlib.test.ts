// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBufrStdLibWasmBytes } from "../src/catalog/bufr-std-lib-data.js";
import {
  buildBufrCleanroomSchemas,
  ensureBuiltInBufrLibraryRegistered,
  getBufrSchemasFromLibraries,
  lookupBufrModelSchema,
} from "../src/catalog/index.js";

describe("@modelscript/bufr Cleanroom Stdlib", () => {
  it("registers @modelscript/bufr-std-lib schemas and compiles WASM runtime", () => {
    ensureBuiltInBufrLibraryRegistered();
    const schemas = getBufrSchemasFromLibraries();
    const built = buildBufrCleanroomSchemas();

    assert.equal(schemas.length, built.length);
    assert.ok(schemas.length >= 10);

    const radiosonde = lookupBufrModelSchema("3-09-052");
    assert.ok(radiosonde, "Expected radiosonde 3-09-052 schema in stdlib");
    assert.equal(radiosonde.name, "RadiosondeSoundingSequence");
    assert.ok(radiosonde.svg && radiosonde.svg.includes("<svg"));

    const temp = lookupBufrModelSchema("0-12-101");
    assert.ok(temp, "Expected dry-bulb temperature 0-12-101 schema in stdlib");
    assert.equal(temp.name, "DryBulbTemperature");

    const wasmBytes = getBufrStdLibWasmBytes();
    assert.ok(wasmBytes.length > 32, "Expected non-empty compiled AssemblyScript WASM runtime");
    // Check WASM magic header \0asm
    assert.equal(wasmBytes[0], 0x00);
    assert.equal(wasmBytes[1], 0x61);
    assert.equal(wasmBytes[2], 0x73);
    assert.equal(wasmBytes[3], 0x6d);
  });
});
