// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGribStdLibWasmBytes } from "../src/catalog/grib-std-lib-data.js";
import { buildGribCleanroomSchemas, WMO_LEVEL_TYPES, WMO_TABLE_2 } from "../src/catalog/grib-std-schemas.js";
import {
  ensureBuiltInGribLibraryRegistered,
  getGribSchemasFromLibraries,
  lookupGribSchema,
} from "../src/catalog/library-package-adapter.js";

describe("GRIB1 Cleanroom Standard Library (@modelscript/grib-std-lib)", () => {
  it("defines WMO Table 2 parameters (PRES, PRMSL, HGT, TMP, RH, UGRD, VGRD, APCP) and Table 3 levels", () => {
    const schemas = buildGribCleanroomSchemas();
    const names = new Set(schemas.map((s) => s.name));
    for (const req of ["PRES", "PRMSL", "HGT", "TMP", "RH", "UGRD", "VGRD", "APCP", "SFC", "ISBL", "MSL", "TGL"]) {
      assert.ok(names.has(req), `Missing cleanroom schema '${req}'`);
    }
    assert.equal(WMO_TABLE_2[11]?.mnemonic, "TMP");
    assert.equal(WMO_LEVEL_TYPES[100]?.mnemonic, "ISBL");
  });

  it("registers into globalLibraryRegistry with zero I/O and resolves schemas + cleanroom SVGs", () => {
    ensureBuiltInGribLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("grib");
    assert.ok(pkgs.length >= 1, "grib-std-lib package should be registered");

    const schemas = getGribSchemasFromLibraries();
    assert.ok(schemas.length >= 12);

    const tmp = lookupGribSchema("TMP");
    assert.ok(tmp);
    assert.ok(tmp.svg?.includes("<svg"));
    assert.equal(lookupGribSchema("mslp")?.name, "PRMSL");
  });

  it("instantiates and executes the AssemblyScript WASM runtime kernel", async () => {
    const wasmBytes = getGribStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "stdlib runtime.wasm bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      gribUnpackValue: (r: number, x: number, e: number, d: number) => number;
      gribHypsometricThickness: (t: number, p1: number, p2: number) => number;
      gribGeostrophicWind: (dzdn: number, lat: number) => number;
    };

    const y = exports.gribUnpackValue(2500, 100, 1, 1);
    // (2500 + 100 * 2) * 10^(-1) = 270.0
    assert.ok(Math.abs(y - 270.0) < 1e-9);

    const dz = exports.gribHypsometricThickness(255.0, 100000.0, 50000.0);
    assert.ok(dz > 5000 && dz < 5500, `Expected 1000-500 hPa thickness ~5175 m, got ${dz}`);

    const vg = exports.gribGeostrophicWind(1e-4, 45.0);
    assert.ok(vg > 9 && vg < 10, `Expected geostrophic wind ~9.5 m/s, got ${vg}`);
  });
});
