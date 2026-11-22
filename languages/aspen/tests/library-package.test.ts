// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ASPEN_MODEL_SPECS,
  capeOpenToAspenBlock,
  createFmuAspenInstance,
  fmuToAspenUser2,
  getAspenSchemasFromLibraries,
  instantiateAspenWasmModel,
  lookupAspenModelSchema,
  lowerAspenToDae,
  parseAspen,
  registerBuiltInAspenLibrarySync,
  solveFlashRachfordRice,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/aspen-std-lib");

describe("@modelscript/aspen — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU/CAPE-OPEN Linking)", () => {
  it("loads @modelscript/aspen-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected aspen-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/aspen-std-lib");
    assert.equal(pkg.manifest.language, "aspen");
    assert.equal(pkg.symbols.length, ASPEN_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, ASPEN_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered schema
    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected public provenance citation for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and case-insensitive alias lookup", () => {
    registerBuiltInAspenLibrarySync();
    const schemas = getAspenSchemasFromLibraries();
    assert.ok(schemas.length >= 100, `Expected 100+ Aspen schemas, got ${schemas.length}`);
    assert.ok(schemas.length >= ASPEN_MODEL_SPECS.length);

    assert.equal(lookupAspenModelSchema("FLASH2")?.name, "Flash2");
    assert.equal(lookupAspenModelSchema("PENG-ROB")?.name, "PENG_ROB");
    assert.equal(lookupAspenModelSchema("STEAM-TA")?.name, "STEAM_TA");
    assert.equal(lookupAspenModelSchema("H2O")?.name, "COMP_H2O");
    assert.equal(lookupAspenModelSchema("C6H6")?.name, "COMP_BENZENE");
    assert.equal(lookupAspenModelSchema("cstr")?.name, "RCSTR");
    assert.equal(lookupAspenModelSchema("O_XYLENE")?.name, "COMP_O_XYLENE");
    assert.equal(lookupAspenModelSchema("R134A")?.name, "COMP_R134A");
    assert.equal(lookupAspenModelSchema("MEA")?.name, "COMP_MEA");
  });

  it("evaluates Flash2 (Rachford-Rice), Compr (isentropic work), HeatX (LMTD), PENG_ROB EOS, RCSTR, and Antoine in runtime.wasm", () => {
    // 1. Flash2: Benzene/Toluene isothermal VLE flash at 368.15 K, 1 atm, z1 = 0.5
    const flash = instantiateAspenWasmModel({ id: "V101", modelType: "Flash2" });
    assert.ok(flash, "Expected Flash2 WASM instance");
    flash.init();
    const flashOut = flash.eval({ T_in: 368.15, P_in: 101325, F_in: 100, z1: 0.5 });
    assert.equal(flashOut.status, 0);
    assert.ok(
      flashOut.vaporFraction > 0.2 && flashOut.vaporFraction < 0.7,
      `Expected two-phase vapor fraction in (0.2, 0.7), got ${flashOut.vaporFraction}`,
    );
    const x1 = flashOut.compressibilityOrLmtd;
    const y1 = flashOut.fugacityOrY1OrPsat;
    const K1 = flashOut.aux1;
    assert.ok(x1 < 0.5 && y1 > 0.5, `Expected light component enrichment in vapor (x1=${x1}, y1=${y1})`);
    assert.ok(Math.abs(y1 - K1 * x1) < 1e-6, `Expected y1 = K1 * x1, got y1=${y1}, K1*x1=${K1 * x1}`);

    // 2. Compr: Isentropic compression of ideal diatomic gas (gamma=1.4) from 300 K, 1 bar -> 5 bar, eta_is=0.80, eta_mech=1.0
    const compr = instantiateAspenWasmModel({
      id: "K101",
      modelType: "Compr",
      params: { P_out: 500000, eta_is: 0.8, gamma: 1.4, eta_mech: 1.0 },
    });
    assert.ok(compr, "Expected Compr WASM instance");
    compr.init();
    const comprOut = compr.eval({ T_in: 300, P_in: 100000, F_in: 10 });
    assert.equal(comprOut.status, 0);
    const expectedT2s = 300 * Math.pow(5.0, 0.4 / 1.4);
    const expectedT2 = 300 + (expectedT2s - 300) / 0.8;
    const expectedCp = (1.4 * 8.31446261815324) / 0.4;
    const expectedW = 10 * expectedCp * (expectedT2 - 300);
    assert.ok(
      Math.abs(comprOut.T_out - expectedT2) < 1e-3,
      `Expected Compr T_out=${expectedT2.toFixed(2)} K, got ${comprOut.T_out.toFixed(2)} K`,
    );
    assert.ok(
      Math.abs(comprOut.dutyW - expectedW) / expectedW < 1e-4,
      `Expected Compr shaft work=${expectedW.toFixed(1)} W, got ${comprOut.dutyW.toFixed(1)} W`,
    );

    // 3. HeatX: Countercurrent heat exchanger LMTD & energy balance
    const heatx = instantiateAspenWasmModel({
      id: "E101",
      modelType: "HeatX",
      params: { UA: 12000, T_cold_in: 300, F_cold: 80, Cp_hot: 75, Cp_cold: 75 },
    });
    assert.ok(heatx, "Expected HeatX WASM instance");
    heatx.init();
    const hxOut = heatx.eval({ T_in: 420, P_in: 200000, F_in: 100 });
    assert.equal(hxOut.status, 0);
    const lmtd = hxOut.compressibilityOrLmtd;
    const T_c_out = hxOut.vaporFraction;
    assert.ok(hxOut.T_out < 420 && hxOut.T_out > 300, `Expected hot outlet T in (300, 420), got ${hxOut.T_out}`);
    assert.ok(T_c_out > 300 && T_c_out < 420, `Expected cold outlet T in (300, 420), got ${T_c_out}`);
    assert.ok(
      Math.abs(hxOut.dutyW - 12000 * lmtd) / hxOut.dutyW < 1e-4,
      `Expected Q = UA * LMTD (${12000 * lmtd}), got ${hxOut.dutyW}`,
    );
    const qHot = 100 * 75 * (420 - hxOut.T_out);
    const qCold = 80 * 75 * (T_c_out - 300);
    assert.ok(Math.abs(qHot - qCold) < 1e-3, `Expected energy balance qHot=${qHot} == qCold=${qCold}`);

    // 4. PENG_ROB: Peng-Robinson cubic EOS compressibility Z & fugacity phi for methane at 300 K, 50 bar
    const pr = instantiateAspenWasmModel({ id: "EOS1", modelType: "PENG-ROB" });
    assert.ok(pr, "Expected PENG_ROB WASM instance");
    pr.init();
    const prOut = pr.eval({ T_in: 300, P_in: 5000000 });
    assert.equal(prOut.status, 0);
    const Z = prOut.compressibilityOrLmtd;
    const phi = prOut.fugacityOrY1OrPsat;
    assert.ok(Z > 0.85 && Z < 0.96, `Expected methane Z at 300K/50bar in (0.85, 0.96), got ${Z}`);
    assert.ok(phi > 0.85 && phi < 0.98, `Expected methane fugacity coeff phi in (0.85, 0.98), got ${phi}`);

    // 5. RCSTR: Arrhenius first-order CSTR conversion X = Da / (1 + Da)
    const cstr = instantiateAspenWasmModel({
      id: "R101",
      modelType: "RCSTR",
      params: { volume: 2.0, k0: 1.0e5, Ea: 45000, dH_rxn: -40000, c_total: 1000 },
    });
    assert.ok(cstr, "Expected RCSTR WASM instance");
    cstr.init();
    const cstrOut = cstr.eval({ T_in: 350, P_in: 101325, F_in: 50, z1: 1.0 });
    assert.equal(cstrOut.status, 0);
    assert.ok(
      cstrOut.vaporFraction > 0.1 && cstrOut.vaporFraction < 0.99,
      `Expected CSTR conversion X in (0.1, 0.99), got ${cstrOut.vaporFraction}`,
    );
    assert.ok(cstrOut.dutyW < 0, `Expected exothermic reaction duty < 0, got ${cstrOut.dutyW}`);

    // 6. Pure component Antoine vapor pressure: Water at 373.15 K (~1 atm)
    const h2o = instantiateAspenWasmModel({ id: "WATER", modelType: "COMP_H2O" });
    assert.ok(h2o, "Expected COMP_H2O WASM instance");
    h2o.init();
    const h2oOut = h2o.eval({ T_in: 373.15, P_in: 101325 });
    assert.equal(h2oOut.status, 0);
    const pSat = h2oOut.fugacityOrY1OrPsat;
    assert.ok(
      Math.abs(pSat - 101325) / 101325 < 0.02,
      `Expected water Psat(373.15 K) within 2% of 101325 Pa, got ${pSat.toFixed(1)} Pa`,
    );

    // 7. STEAM_TA: Exact IAPWS-IF97 P_sat(373.1243 K) ~ 101325 Pa
    const steamTa = instantiateAspenWasmModel({ id: "STM1", modelType: "STEAM-TA" });
    assert.ok(steamTa, "Expected STEAM_TA WASM instance");
    steamTa.init();
    const stmOut = steamTa.eval({ T_in: 373.1243, P_in: 101325 });
    assert.equal(stmOut.status, 0);
    assert.ok(
      Math.abs(stmOut.fugacityOrY1OrPsat - 101325) < 50,
      `Expected STEAM_TA IAPWS-IF97 P_sat(373.1243 K) ~ 101325 Pa, got ${stmOut.fugacityOrY1OrPsat}`,
    );

    // 8. RadFrac: Stage-by-stage MESH Thomas TDMA column enriches light key in distillate
    const radFrac = instantiateAspenWasmModel({ id: "COL1", modelType: "RadFrac" });
    assert.ok(radFrac, "Expected RadFrac WASM instance");
    radFrac.init();
    const colOut = radFrac.eval({ T_in: 368.15, P_in: 101325, F_in: 100, z1: 0.5 });
    assert.equal(colOut.status, 0);
    assert.ok(
      colOut.fugacityOrY1OrPsat > 0.5 && colOut.compressibilityOrLmtd < 0.5,
      `Expected RadFrac enrichment (xDist=${colOut.fugacityOrY1OrPsat}, xBot=${colOut.compressibilityOrLmtd})`,
    );
  });

  it("projects and links FMI 2.0/3.0 FMUs via USER2 and CAPE-OPEN 1.1 unit operations", () => {
    const fmuProj = fmuToAspenUser2(
      {
        modelName: "VendorMembraneFmu",
        variables: [
          { name: "permeance", causality: "parameter", type: "Real", valueReference: 1, start: 1.5e-4 },
          { name: "area_m2", causality: "parameter", type: "Real", valueReference: 2, start: 25.0 },
          { name: "T_in", causality: "input", type: "Real", valueReference: 3 },
          { name: "permeate_frac", causality: "output", type: "Real", valueReference: 4 },
        ],
      },
      "MEM1",
      "GAS_IN",
      "PERM_OUT",
    );
    assert.ok(fmuProj.aspenBlockSnippet.includes("USER2"));
    assert.ok(fmuProj.aspenBlockSnippet.includes("VendorMembraneFmu"));
    assert.deepEqual(fmuProj.parameterNames, ["permeance", "area_m2"]);

    const coProj = capeOpenToAspenBlock(
      {
        progId: "Vendor.CapeOpen.Electrolyzer.1",
        name: "PEMElectrolyzer",
        capeOpenVersion: "1.1",
        inletPorts: ["H2O_IN"],
        outletPorts: ["H2_OUT", "O2_OUT"],
        parameters: [{ name: "current_density", defaultValue: 2.0, unit: "A/cm^2" }],
      },
      "ELEC1",
    );
    assert.ok(coProj.aspenBlockSnippet.includes("CAPE-OPEN"));
    assert.ok(coProj.aspenBlockSnippet.includes("Vendor.CapeOpen.Electrolyzer.1"));

    const fmuInst = createFmuAspenInstance("MEM1", fmuProj.modelName, (io) => ({
      T_out: io.T_in - 2.0,
      P_out: io.P_in * 0.9,
      vaporFraction: 0.35,
    }));
    const out = fmuInst.eval({ T_in: 310, P_in: 500000, F_in: 50 });
    assert.equal(out.T_out, 308);
    assert.equal(out.P_out, 450000);
    assert.equal(out.vaporFraction, 0.35);
    assert.equal(out.status, 0);
  });

  it("automatically registers stdlib and falls back to schema defaults in DAE lowering and flash solver", () => {
    // Flash2 and Heater omit TEMP/PRES parameters -> resolved from @modelscript/aspen-std-lib
    const deck = parseAspen(`TITLE 'AUTO CATALOG DEFAULTS'
COMPONENTS
    BENZENE C6H6
    TOLUENE C7H8
FLOWSHEET
    BLOCK H1 IN=FEED OUT=WARM
    BLOCK F1 IN=WARM OUT=VAP LIQ
STREAM FEED
    SUBSTREAM MIXED TEMP=25.0 PRES=1.0 MOLE-FLOW=100.0
    MOLE-FRAC BENZENE 0.5 / TOLUENE 0.5
BLOCK H1 HEATER
BLOCK F1 FLASH2
`);
    const dae = lowerAspenToDae(deck);
    assert.ok(globalLibraryRegistry.getPackagesForLanguage("aspen").length > 0);
    assert.equal(dae.variables().length, dae.equations().length);
    assert.notEqual(dae.lookupVariable("psi_F1"), -1);

    // Formula aliases (C6H6, H2O) resolve critical properties from cleanroom catalog in flash solver
    const flash = solveFlashRachfordRice({
      temperature: 90.0,
      pressure: 1.01325,
      components: ["C6H6", "H2O"],
      moleFractions: [0.5, 0.5],
    });
    assert.ok(flash.kValues[0]! > flash.kValues[1]!, "Expected C6H6 to be more volatile than H2O");
  });
});
