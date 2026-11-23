// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureBuiltInTrasysLibraryRegistered,
  getTrasysSchemasFromLibraries,
  lookupTrasysModelSchema,
} from "../src/catalog/index.js";
import { getTrasysStdLibWasmBytes } from "../src/catalog/trasys-std-lib-data.js";
import { viewFactorCoaxialDisks, viewFactorParallelRectangles } from "../src/solver/index.js";

describe("TRASYS Cleanroom Standard Library (@modelscript/trasys-std-lib)", () => {
  it("auto-registers zero-I/O standard library into globalLibraryRegistry with all primitives and coatings", () => {
    ensureBuiltInTrasysLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("trasys");
    assert.ok(pkgs.length >= 1, "Should have registered @modelscript/trasys-std-lib");

    const schemas = getTrasysSchemasFromLibraries();
    assert.strictEqual(schemas.length, 13, "Expected 7 surface primitives + 6 spacecraft thermal coatings");

    // Verify all 7 primitives
    for (const prim of ["RECTANGLE", "DISK", "CYLINDER", "CONE", "SPHERE", "PARABOLOID", "POLYGON"]) {
      const s = lookupTrasysModelSchema(prim);
      assert.ok(s, `Missing surface primitive schema: ${prim}`);
      assert.ok(s.svg && s.svg.includes("<svg"), `Missing SVG icon for ${prim}`);
    }

    // Verify all 6 spacecraft thermal coatings
    const coatings: Array<[string, number, number]> = [
      ["WHITE_PAINT_Z93", 0.17, 0.92],
      ["SILVER_TEFLON", 0.08, 0.8],
      ["GOLD_KAPTON", 0.25, 0.03],
      ["SOLAR_CELL", 0.82, 0.85],
      ["BLACK_PAINT", 0.96, 0.9],
      ["OPTICAL_SOLAR_REFLECTOR", 0.07, 0.81],
    ];
    for (const [name, expectedAlpha, expectedEps] of coatings) {
      const s = lookupTrasysModelSchema(name);
      assert.ok(s, `Missing thermal coating schema: ${name}`);
      const alphaParam = s.parameters.find((p) => p.key === "alpha");
      const epsParam = s.parameters.find((p) => p.key === "epsilon");
      assert.strictEqual(alphaParam?.defaultValue, expectedAlpha);
      assert.strictEqual(epsParam?.defaultValue, expectedEps);
    }

    // Alias lookup
    assert.strictEqual(lookupTrasysModelSchema("OSR")?.name, "OPTICAL_SOLAR_REFLECTOR");
    assert.strictEqual(lookupTrasysModelSchema("Z93")?.name, "WHITE_PAINT_Z93");
  });

  it("instantiates AssemblyScript runtime.wasm and matches TS view-factor & equilibrium kernels", async () => {
    const wasmBytes = getTrasysStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "WASM runtime bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as {
      viewFactorCoaxialDisksWasm: (r1: number, r2: number, h: number) => number;
      viewFactorParallelRectanglesWasm: (a: number, b: number, c: number) => number;
      radiativeEquilibriumTempK: (q: number, a: number, e: number) => number;
      trasysEvalKernel: (arch: number, d1: number, d2: number, d3: number) => number;
    };

    const fDiskWasm = exports.viewFactorCoaxialDisksWasm(1.0, 1.5, 1.0);
    const fDiskTs = viewFactorCoaxialDisks(1.0, 1.5, 1.0);
    assert.ok(Math.abs(fDiskWasm - fDiskTs) < 1e-12);

    const fRectWasm = exports.viewFactorParallelRectanglesWasm(2.0, 1.0, 1.0);
    const fRectTs = viewFactorParallelRectangles(2.0, 1.0, 1.0);
    assert.ok(Math.abs(fRectWasm - fRectTs) < 1e-12);

    const tEq = exports.radiativeEquilibriumTempK(400.0, 1.0, 0.9);
    assert.ok(tEq > 290 && tEq < 305, `Expected ~297.5 K, got ${tEq}`);

    // Sphere area (archetype 5, R=0.5 -> pi)
    const sphereArea = exports.trasysEvalKernel(5, 0.5, 0, 0);
    assert.ok(Math.abs(sphereArea - Math.PI) < 1e-12);
  });
});
