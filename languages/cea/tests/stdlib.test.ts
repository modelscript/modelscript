// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CEA_STD_SPECIES_DATA,
  CEA_STD_SPECIES_NAMES,
  evalCeaSpeciesInWasm,
  evalNasa7,
  getCeaSchemasFromLibraries,
  lookupCeaSpecies,
  lookupCeaSpeciesSchema,
  registerBuiltInCeaLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/cea-std-lib");

describe("@modelscript/cea — Cleanroom Standard Library (@modelscript/cea-std-lib)", () => {
  it("loads @modelscript/cea-std-lib via modelscript.yaml with all 17 species, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected cea-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/cea-std-lib");
    assert.equal(pkg.manifest.language, "cea");
    assert.equal(pkg.symbols.length, 17);
    assert.equal(pkg.diagrams.length, 17);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length >= 2, `Expected diagram ports for ${diag.namePath}`);
    }
  });

  it("registers all 17 required species synchronously with zero I/O and alias lookup", () => {
    registerBuiltInCeaLibrarySync();
    const schemas = getCeaSchemasFromLibraries();
    assert.equal(schemas.length, CEA_STD_SPECIES_DATA.length);

    for (const spName of CEA_STD_SPECIES_NAMES) {
      const schema = lookupCeaSpeciesSchema(spName);
      assert.ok(schema, `Expected standard-library schema for '${spName}'`);
      assert.equal(schema.name, spName);
    }

    // Alias lookup checks
    assert.equal(lookupCeaSpeciesSchema("LOX")?.name, "O2");
    assert.equal(lookupCeaSpeciesSchema("LH2")?.name, "H2");
    assert.equal(lookupCeaSpeciesSchema("RP1")?.name, "RP-1");
    assert.equal(lookupCeaSpeciesSchema("NTO")?.name, "N2O4");
  });

  it("evaluates NASA-7 polynomials in runtime.wasm with exact parity against TypeScript evaluator", () => {
    for (const spName of ["H2", "O2", "H2O", "OH", "CO2", "CH4", "N2", "Ar"]) {
      const sp = lookupCeaSpecies(spName)!;
      for (const T of [298.15, 1500.0, 3500.0]) {
        const tsEv = evalNasa7(sp.nasa7, T);
        const wasmEv = evalCeaSpeciesInWasm(spName, T);
        assert.ok(Math.abs(wasmEv.cpOverR - tsEv.cpOverR) < 1e-12, `Cp/R mismatch for ${spName} at ${T} K`);
        assert.ok(Math.abs(wasmEv.hOverRT - tsEv.hOverRT) < 1e-12, `H/RT mismatch for ${spName} at ${T} K`);
        assert.ok(Math.abs(wasmEv.sOverR - tsEv.sOverR) < 1e-12, `S/R mismatch for ${spName} at ${T} K`);
        assert.ok(Math.abs(wasmEv.gOverRT - tsEv.gOverRT) < 1e-12, `G/RT mismatch for ${spName} at ${T} K`);
      }
    }
  });
});
