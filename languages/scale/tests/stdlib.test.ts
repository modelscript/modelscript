// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureBuiltInScaleLibraryRegistered,
  getScaleSchemasFromLibraries,
  lookupScaleModelSchema,
  SCALE_NUCLIDE_DATA,
} from "../src/catalog/index.js";
import { getScaleStdLibWasmBytes } from "../src/catalog/scale-std-lib-data.js";

describe("SCALE Cleanroom Standard Library (@modelscript/scale-std-lib)", () => {
  it("registers @modelscript/scale-std-lib in globalLibraryRegistry with all standard compositions and nuclides", () => {
    ensureBuiltInScaleLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("scale");
    assert.ok(pkgs.length >= 1, "Should register at least one scale library package");

    const schemas = getScaleSchemasFromLibraries();
    const names = new Set(schemas.map((s) => s.name));

    for (const comp of ["UO2", "H2O", "SS304", "ZIRC4", "B4C", "MOX"]) {
      assert.ok(names.has(comp), `Missing standard composition schema: ${comp}`);
    }
    for (const nuc of ["U-235", "U-238", "Pu-239", "Xe-135", "I-135", "Cs-137", "Sr-90"]) {
      assert.ok(names.has(nuc), `Missing nuclide schema: ${nuc}`);
    }
  });

  it("supports case-insensitive & alias lookup with valid SVG icons", () => {
    const uo2 = lookupScaleModelSchema("uo2");
    assert.ok(uo2);
    assert.equal(uo2.name, "UO2");
    assert.ok(uo2.svg?.includes("<svg"));

    const xe = lookupScaleModelSchema("54135");
    assert.ok(xe);
    assert.equal(xe.name, "Xe-135");
    assert.ok(xe.svg?.includes("<svg"));
  });

  it("instantiates embedded AssemblyScript WASM runtime and evaluates Bateman kernels", async () => {
    const wasmBytes = getScaleStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Embedded WASM runtime bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(new Uint8Array(wasmBytes), {});
    const exports = instance.exports as {
      scaleDepleteSingle: (n0: number, lam: number, sig: number, flux: number, dt: number) => number;
      scaleBatemanTwoStep: (n10: number, n20: number, k1: number, k2: number, b12: number, dt: number) => number;
      scaleDecayHeatWatts: (atoms: number, lam: number, eMeV: number) => number;
    };

    const u235 = SCALE_NUCLIDE_DATA["U-235"]!;
    const depleted = exports.scaleDepleteSingle(1e21, u235.decayConstant, u235.sigmaAbsorptionBarns, 3e13, 86400 * 30);
    const expected = 1e21 * Math.exp(-(u235.decayConstant + u235.sigmaAbsorptionBarns * 1e-24 * 3e13) * 86400 * 30);
    assert.ok(Math.abs(depleted - expected) / expected < 1e-12);

    const k1 = SCALE_NUCLIDE_DATA["I-135"]!.decayConstant;
    const k2 = SCALE_NUCLIDE_DATA["Xe-135"]!.decayConstant;
    const xeAt10h = exports.scaleBatemanTwoStep(1e16, 0, k1, k2, k1, 36000);
    assert.ok(xeAt10h > 0 && xeAt10h < 1e16);

    const watts = exports.scaleDecayHeatWatts(1e16, k1, 1.16);
    assert.ok(watts > 0);
  });
});
