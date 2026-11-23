// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLEANROOM_ISOTOPE_LIBRARY,
  ensureBuiltInMcnpLibraryRegistered,
  getMcnpSchemasFromLibraries,
  lookupIsotopeCrossSection,
  lookupMcnpModelSchema,
} from "../src/catalog/index.js";

describe("MCNP Cleanroom Standard Library (@modelscript/mcnp-std-lib)", () => {
  it("registers @modelscript/mcnp-std-lib in globalLibraryRegistry with all 8 ENDF-like isotopes and archetypes", () => {
    ensureBuiltInMcnpLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("mcnp");
    assert.ok(pkgs.length >= 1, "Expected @modelscript/mcnp-std-lib registered");

    const schemas = getMcnpSchemasFromLibraries();
    assert.strictEqual(schemas.length, 20, "Expected 8 isotopes + 6 surfaces + 6 tallies = 20 schemas");

    const requiredZaids = [1001, 5010, 6012, 8016, 26056, 92235, 92238, 94239];
    for (const zaid of requiredZaids) {
      const iso = lookupIsotopeCrossSection(zaid);
      assert.ok(iso, `Missing isotope ${zaid}`);
      assert.ok(iso.fast.sigmaT > 0, `Expected positive fast sigmaT for ${zaid}`);
      assert.ok(CLEANROOM_ISOTOPE_LIBRARY.has(zaid));

      const schema = lookupMcnpModelSchema(`${zaid}.80c`);
      assert.ok(schema, `Missing schema lookup for ${zaid}.80c`);
      assert.ok(schema.svg?.includes("<svg"), `Expected deterministic SVG block icon for ${zaid}`);
    }

    assert.ok(lookupMcnpModelSchema("SO"));
    assert.ok(lookupMcnpModelSchema("RPP"));
    assert.ok(lookupMcnpModelSchema("F4"));
    assert.ok(lookupMcnpModelSchema("F1:N"));
  });

  it("instantiates and executes the cleanroom AssemblyScript WASM cross-section runtime", async () => {
    ensureBuiltInMcnpLibraryRegistered();
    const pkg = globalLibraryRegistry.getPackagesForLanguage("mcnp")[0]!;
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 100, "Expected embedded WASM runtime bytes");

    const { instance } = await WebAssembly.instantiate(pkg.wasmBytes);
    const exports = instance.exports as {
      mcnpFastSigmaTotal: (zaid: number) => number;
      mcnpEvalMacroscopicXs: (zaid: number, rho: number) => number;
      mcnpBeerLambertAttenuation: (sigmaT: number, thickness: number) => number;
    };

    assert.ok(Math.abs(exports.mcnpFastSigmaTotal(92235) - 5.899) < 1e-9);
    const sigmaT = exports.mcnpEvalMacroscopicXs(92235, 18.74);
    assert.ok(sigmaT > 0.25 && sigmaT < 0.35, `Unexpected U-235 Sigma_t: ${sigmaT}`);

    const atten = exports.mcnpBeerLambertAttenuation(0.5, 2.0);
    assert.ok(Math.abs(atten - Math.exp(-1.0)) < 1e-12);
  });
});
