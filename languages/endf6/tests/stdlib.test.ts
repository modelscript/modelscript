// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLEANROOM_ENDF6_NUCLIDES,
  ENDF6_MT_DESCRIPTORS,
  ensureBuiltInEndf6LibraryRegistered,
  getEndf6SchemasFromLibraries,
  lookupEndf6ModelSchema,
  lookupReferenceNuclide,
} from "../src/catalog/index.js";

describe("ENDF-6 Cleanroom Standard Library & WASM Runtime", () => {
  it("registers @modelscript/endf6-std-lib in globalLibraryRegistry with MF/MT and reference nuclide schemas", () => {
    ensureBuiltInEndf6LibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("endf6");
    assert.ok(pkgs.length >= 1, "Expected at least 1 registered endf6 library package");

    const schemas = getEndf6SchemasFromLibraries();
    // 6 MF/MT schemas (1, 2, 18, 102, 451, 457) + 5 reference nuclides (H-1, B-10, U-235, U-238, Pu-239) = 11
    assert.equal(schemas.length, 11);

    for (const mt of [1, 2, 18, 102, 451, 457]) {
      assert.ok(ENDF6_MT_DESCRIPTORS.has(mt), `Expected MT=${mt} descriptor`);
      assert.ok(lookupEndf6ModelSchema(`MT${mt}`), `Expected MT${mt} schema in stdlib`);
    }

    for (const sym of ["H-1", "B-10", "U-235", "U-238", "Pu-239"]) {
      assert.ok(CLEANROOM_ENDF6_NUCLIDES.has(sym), `Expected reference nuclide ${sym}`);
      assert.ok(lookupReferenceNuclide(sym), `Expected lookupReferenceNuclide(${sym})`);
      assert.ok(lookupEndf6ModelSchema(sym), `Expected ${sym} schema in stdlib`);
    }
  });

  it("instantiates and executes the compiled AssemblyScript endf6-std-lib runtime.wasm", async () => {
    ensureBuiltInEndf6LibraryRegistered();
    const pkg = globalLibraryRegistry.getPackagesForLanguage("endf6")[0]!;
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 100, "Expected non-empty runtime.wasm bytes");

    const { instance } = await WebAssembly.instantiate(pkg.wasmBytes);
    const exports = instance.exports as {
      endf6Interp: (x: number, x1: number, y1: number, x2: number, y2: number, interp: number) => number;
      endf6ThermalSigmaCapture: (za: number) => number;
      endf6OneOverVCapture: (sigTh: number, energyEv: number) => number;
      endf6SlbwCapture: (e: number, er: number, awr: number, gJ: number, gn: number, gg: number, gf: number) => number;
    };

    // INT=5 log-log interpolation: (1, 10) -> (100, 1000) at x=10 => 100
    assert.ok(Math.abs(exports.endf6Interp(10, 1, 10, 100, 1000, 5) - 100) < 1e-10);
    // Thermal capture lookup for B-10 (ZA=5010) = 3837.0 barns
    assert.equal(exports.endf6ThermalSigmaCapture(5010), 3837.0);
    // 1/v scaling at 4x thermal energy = 0.5x cross-section
    assert.ok(Math.abs(exports.endf6OneOverVCapture(100.0, 0.0253 * 4) - 50.0) < 1e-10);
    // SLBW U-238 6.674 eV peak capture > 20,000 b
    const peak = exports.endf6SlbwCapture(6.674, 6.674, 236.006, 1.0, 0.001493, 0.023, 0.0);
    assert.ok(peak > 20000);
  });
});
