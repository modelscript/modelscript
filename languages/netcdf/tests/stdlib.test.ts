// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNetcdfCleanroomSchemas,
  ensureBuiltInNetcdfLibraryRegistered,
  getNetcdfSchemasFromLibraries,
  lookupNetcdfModelSchema,
} from "../src/catalog/index.js";
import { getNetcdfStdLibWasmBytes } from "../src/catalog/netcdf-std-lib-data.js";

describe("NetCDF Cleanroom Standard Library (@modelscript/netcdf-std-lib)", () => {
  it("registers and resolves all CF-1.x standard variables and NetCDF Classic data types", () => {
    ensureBuiltInNetcdfLibraryRegistered();
    const schemas = getNetcdfSchemasFromLibraries();
    const declared = buildNetcdfCleanroomSchemas();
    assert.strictEqual(schemas.length, declared.length);
    assert.ok(schemas.length >= 12);

    for (const name of [
      "temperature",
      "pressure",
      "u_wind",
      "v_wind",
      "salinity",
      "elevation",
      "byte",
      "char",
      "short",
      "int",
      "float",
      "double",
    ]) {
      const found = lookupNetcdfModelSchema(name);
      assert.ok(found, `Schema '${name}' should be registered`);
      assert.ok(found.svg?.startsWith("<svg"), `Schema '${name}' should have cleanroom SVG block icon`);
    }

    // Alias lookup
    assert.strictEqual(lookupNetcdfModelSchema("air_temperature")?.name, "temperature");
    assert.strictEqual(lookupNetcdfModelSchema("NC_DOUBLE")?.name, "double");
  });

  it("instantiates and executes cleanroom AssemblyScript runtime.wasm kernels", async () => {
    const wasmBytes = getNetcdfStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Embedded runtime.wasm should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      ncUnpackValue: (raw: number, scale: number, offset: number) => number;
      ncPackValue: (phys: number, scale: number, offset: number) => number;
      ncBilinear2D: (q00: number, q10: number, q01: number, q11: number, tx: number, ty: number) => number;
      ncPotentialTemp: (tempK: number, pPa: number) => number;
      ncWindSpeed: (u: number, v: number) => number;
    };

    assert.ok(Math.abs(exports.ncUnpackValue(20, 0.5, 270) - 280) < 1e-12);
    assert.ok(Math.abs(exports.ncPackValue(280, 0.5, 270) - 20) < 1e-12);
    assert.ok(Math.abs(exports.ncBilinear2D(0, 10, 20, 30, 0.5, 0.5) - 15) < 1e-12);
    assert.ok(Math.abs(exports.ncPotentialTemp(300, 100000) - 300) < 1e-12);
    assert.ok(Math.abs(exports.ncWindSpeed(3, 4) - 5) < 1e-12);
  });
});
