// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHEMKIN_ELEMENT_ATOMIC_WEIGHTS,
  CHEMKIN_STD_SPECIES,
  evaluateNasa7,
  getChemkinSchemasFromLibraries,
  getChemkinStdLibWasmBytes,
  getStdThermoRecord,
  lookupChemkinSpeciesSchema,
  registerBuiltInChemkinLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/chemkin-std-lib");

const REQUIRED_SPECIES = ["H2", "O2", "H2O", "OH", "H", "O", "HO2", "H2O2", "CH4", "CO", "CO2", "N2"];

describe("@modelscript/chemkin — Cleanroom Standard Library (modelscript.yaml & WASM Runtime)", () => {
  it("loads @modelscript/chemkin-std-lib via modelscript.yaml with all 12 NASA-7 species, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected chemkin-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/chemkin-std-lib");
    assert.equal(pkg.manifest.language, "chemkin");
    assert.equal(pkg.symbols.length, CHEMKIN_STD_SPECIES.length);
    assert.equal(pkg.diagrams.length, CHEMKIN_STD_SPECIES.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
    }
  });

  it("registers zero-I/O sync bundle and exposes IUPAC atomic weights & all 12 H2/O2/CH4 species", () => {
    registerBuiltInChemkinLibrarySync();
    const schemas = getChemkinSchemasFromLibraries();
    assert.ok(schemas.length >= REQUIRED_SPECIES.length);

    for (const sp of REQUIRED_SPECIES) {
      assert.ok(lookupChemkinSpeciesSchema(sp), `Missing cleanroom schema for '${sp}'`);
      assert.ok(getStdThermoRecord(sp), `Missing NASA-7 thermo record for '${sp}'`);
    }

    // Verify standard IUPAC atomic weights
    assert.ok(Math.abs(CHEMKIN_ELEMENT_ATOMIC_WEIGHTS["H"]! - 1.00794) < 1e-4);
    assert.ok(Math.abs(CHEMKIN_ELEMENT_ATOMIC_WEIGHTS["O"]! - 15.9994) < 1e-4);
    assert.ok(Math.abs(CHEMKIN_ELEMENT_ATOMIC_WEIGHTS["C"]! - 12.0107) < 1e-4);
    assert.ok(Math.abs(CHEMKIN_ELEMENT_ATOMIC_WEIGHTS["N"]! - 14.0067) < 1e-4);

    // Verify NASA-7 standard enthalpies of formation at 298.15 K (NIST/JANAF reference)
    const h2o = evaluateNasa7(getStdThermoRecord("H2O")!, 298.15);
    assert.ok(
      Math.abs(h2o.hMolar / 1000 - -241.826) < 0.5,
      `Expected H2O Hf ~ -241.8 kJ/mol, got ${h2o.hMolar / 1000}`,
    );

    const co2 = evaluateNasa7(getStdThermoRecord("CO2")!, 298.15);
    assert.ok(Math.abs(co2.hMolar / 1000 - -393.51) < 0.5, `Expected CO2 Hf ~ -393.5 kJ/mol, got ${co2.hMolar / 1000}`);

    const ch4 = evaluateNasa7(getStdThermoRecord("CH4")!, 298.15);
    assert.ok(Math.abs(ch4.hMolar / 1000 - -74.6) < 0.5, `Expected CH4 Hf ~ -74.6 kJ/mol, got ${ch4.hMolar / 1000}`);
  });

  it("executes NASA-7, Arrhenius, and Troe kernels directly in compiled runtime.wasm", async () => {
    const wasmBytes = getChemkinStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      chemkinEvalNasa7Cp: (a1: number, a2: number, a3: number, a4: number, a5: number, T: number) => number;
      chemkinEvalNasa7H: (a1: number, a2: number, a3: number, a4: number, a5: number, a6: number, T: number) => number;
      chemkinArrheniusRate: (A: number, b: number, Ea: number, T: number) => number;
      chemkinTroeFactor: (a: number, T3: number, T1: number, T2: number, T: number, Pr: number) => number;
    };

    const h2o = getStdThermoRecord("H2O")!;
    const lc = h2o.lowCoeffs;
    const cpWasm = exports.chemkinEvalNasa7Cp(lc[0], lc[1], lc[2], lc[3], lc[4], 298.15);
    const hWasm = exports.chemkinEvalNasa7H(lc[0], lc[1], lc[2], lc[3], lc[4], lc[5], 298.15);
    const ref = evaluateNasa7(h2o, 298.15);

    assert.ok(Math.abs(cpWasm - ref.cpMolar) < 1e-9, "WASM Cp must match TS NASA-7 evaluation");
    assert.ok(Math.abs(hWasm - ref.hMolar) < 1e-6, "WASM H must match TS NASA-7 evaluation");

    const kWasm = exports.chemkinArrheniusRate(1e6, 0.0, 83144.6261815324, 1000.0);
    assert.ok(Math.abs(kWasm - 1e6 * Math.exp(-10.0)) < 1e-9, "WASM Arrhenius rate must match analytical value");

    const fTroe = exports.chemkinTroeFactor(0.5, 1e-30, 1e30, 0.0, 1000.0, 1.0);
    assert.ok(fTroe > 0 && fTroe <= 1.0, `Expected Troe broadening factor in (0, 1], got ${fTroe}`);
  });
});
