// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GTSUITE_MODEL_SPECS,
  createFmuGtSuiteInstance,
  fmuToGtSuiteBlock,
  getGtSuiteSchemasFromLibraries,
  instantiateGtSuiteWasmModel,
  lookupGtSuiteModelSchema,
  registerBuiltInGtSuiteLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/gtsuite-std-lib");

describe("@modelscript/gtsuite — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/gtsuite-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected gtsuite-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/gtsuite-std-lib");
    assert.equal(pkg.manifest.language, "gtsuite");
    assert.equal(pkg.symbols.length, GTSUITE_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, GTSUITE_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & provenance metadata on every registered template
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
    registerBuiltInGtSuiteLibrarySync();
    const schemas = getGtSuiteSchemasFromLibraries();
    assert.ok(schemas.length >= GTSUITE_MODEL_SPECS.length);

    assert.equal(lookupGtSuiteModelSchema("PipeRound")?.name, "PipeRound");
    assert.equal(lookupGtSuiteModelSchema("wiebe")?.name, "EngCylCombWiebe");
    assert.equal(lookupGtSuiteModelSchema("WOSCHNI")?.name, "EngCylHeatTrWoschni");
    assert.equal(lookupGtSuiteModelSchema("turbo_compressor")?.name, "Compressor");
    assert.equal(lookupGtSuiteModelSchema("battery_pack")?.name, "Battery");
  });

  it("evaluates EngCylCombWiebe, OrificeConn, Compressor, and Battery in runtime.wasm", () => {
    // 1. EngCylCombWiebe: x_b(theta) = 1 - exp(-a * ((theta - theta0)/dTheta)^(m + 1))
    const wiebe = instantiateGtSuiteWasmModel({
      id: "comb_1",
      modelType: "EngCylCombWiebe",
      params: { anchorAngleDeg: -10.0, durationDeg: 50.0, wiebeExponentM: 2.0, wiebeEfficiencyA: 5.0 },
    });
    assert.ok(wiebe, "Expected EngCylCombWiebe WASM instance");
    wiebe.init();

    const preComb = wiebe.doStep(0.0, 0.001, { crankAngleDeg: -15.0 });
    assert.equal(preComb.burnFraction, 0.0, "Expected zero burn fraction before start of combustion");

    const midComb = wiebe.doStep(0.001, 0.001, { crankAngleDeg: 15.0 }); // u = 0.5 -> 1 - exp(-5 * 0.5^3)
    const expectedMidXb = 1.0 - Math.exp(-5.0 * Math.pow(0.5, 3.0));
    assert.ok(
      Math.abs(midComb.burnFraction - expectedMidXb) < 1e-9,
      `Expected Wiebe burnFraction=${expectedMidXb}, got ${midComb.burnFraction}`,
    );

    const endComb = wiebe.doStep(0.002, 0.001, { crankAngleDeg: 40.0 }); // u = 1.0 -> 1 - exp(-5) ~ 0.99326
    assert.ok(
      endComb.burnFraction > 0.99,
      `Expected near-complete combustion at end of duration, got ${endComb.burnFraction}`,
    );

    // 2. OrificeConn: isentropic compressible orifice flow (subsonic & choked regimes)
    const orifice = instantiateGtSuiteWasmModel({
      id: "orif_1",
      modelType: "OrificeConn",
      params: { diameter: 0.04, dischargeCoeff: 0.85, gamma: 1.4, gasConstant: 287.05, openFraction: 1.0 },
    });
    assert.ok(orifice, "Expected OrificeConn WASM instance");
    orifice.init();

    const subsonic = orifice.doStep(0.0, 0.001, { pIn: 120000.0, pOut: 100000.0, tIn: 300.0 });
    assert.ok(
      subsonic.massFlow > 0.15 && subsonic.massFlow < 0.35,
      `Expected realistic subsonic flow, got ${subsonic.massFlow}`,
    );

    const choked1 = orifice.doStep(0.001, 0.001, { pIn: 250000.0, pOut: 100000.0, tIn: 300.0 });
    const choked2 = orifice.doStep(0.002, 0.001, { pIn: 250000.0, pOut: 50000.0, tIn: 300.0 });
    assert.ok(choked1.massFlow > subsonic.massFlow, "Expected higher mass flow in choked regime");
    assert.ok(
      Math.abs(choked1.massFlow - choked2.massFlow) < 1e-9,
      `Expected choked mass flow independent of downstream pressure: ${choked1.massFlow} vs ${choked2.massFlow}`,
    );

    // 3. Compressor: isentropic enthalpy rise & outlet temperature
    const comp = instantiateGtSuiteWasmModel({
      id: "comp_1",
      modelType: "Compressor",
      params: { pressureRatio: 2.0, efficiency: 0.75, gamma: 1.4, cp: 1005.0, designMassFlow: 0.2 },
    });
    assert.ok(comp, "Expected Compressor WASM instance");
    comp.init();

    const compOut = comp.doStep(0.0, 0.001, { pIn: 100000.0, tIn: 300.0, massFlow: 0.2 });
    const expectedT2s = 300.0 * Math.pow(2.0, 0.4 / 1.4);
    const expectedT2 = 300.0 + (expectedT2s - 300.0) / 0.75;
    const expectedPower = 0.2 * 1005.0 * (expectedT2 - 300.0);
    assert.ok(Math.abs(compOut.tOut - expectedT2) < 1e-6, `Expected T2=${expectedT2}, got ${compOut.tOut}`);
    assert.ok(
      Math.abs(compOut.powerW - expectedPower) < 1e-3,
      `Expected powerW=${expectedPower}, got ${compOut.powerW}`,
    );

    // 4. Battery: Thévenin equivalent-circuit voltage drop & SoC discharge dynamics
    const batt = instantiateGtSuiteWasmModel({
      id: "batt_1",
      modelType: "Battery",
      params: { capacityAh: 60.0, vNom: 350.0, r0: 0.05, r1: 0.02, c1: 1000.0, initSoc: 0.8 },
    });
    assert.ok(batt, "Expected Battery WASM instance");
    batt.init();

    const vOcInit = 350.0 * (0.88 + 0.2 * 0.8);
    let battOut = batt.doStep(0.0, 1.0, { currentA: 100.0 });
    for (let k = 1; k < 36; k++) {
      battOut = batt.doStep(k, 1.0, { currentA: 100.0 });
    }
    // 100 A for 36 s = 1 Ah out of 60 Ah -> deltaSoC = -1/60 (~0.01667)
    const expectedSoc = 0.8 - 1.0 / 60.0;
    assert.ok(Math.abs(battOut.soc - expectedSoc) < 1e-5, `Expected SoC=${expectedSoc}, got ${battOut.soc}`);
    assert.ok(
      battOut.voltageV < vOcInit - 5.0,
      `Expected ohmic + RC polarization voltage sag, got ${battOut.voltageV}`,
    );

    // 5. Bonus sanity check: Woschni heat transfer & ThermalMass 1st-order heating
    const woschni = instantiateGtSuiteWasmModel({ id: "ht_1", modelType: "EngCylHeatTrWoschni" });
    assert.ok(woschni);
    woschni.init();
    const htOut = woschni.doStep(0.0, 0.001, { pIn: 4.0e6, tIn: 1800.0, speedRpm: 3000.0 });
    assert.ok(htOut.heatTransferCoeff > 500.0, `Expected realistic Woschni hc, got ${htOut.heatTransferCoeff}`);

    const tmass = instantiateGtSuiteWasmModel({ id: "tm_1", modelType: "ThermalMass" });
    assert.ok(tmass);
    tmass.init();
    const tmOut = tmass.doStep(0.0, 1.0, { qHeatW: 5000.0 });
    assert.ok(tmOut.tempK > 300.5, `Expected ThermalMass temperature rise, got ${tmOut.tempK}`);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via FMI_CoSim", () => {
    const proj = fmuToGtSuiteBlock(
      {
        modelName: "VendorEcuControllerFmu",
        variables: [
          { name: "boostTargetPa", causality: "parameter", type: "Real", valueReference: 1, start: 220000.0 },
          { name: "pIn", causality: "input", type: "Real", valueReference: 2 },
          { name: "powerW", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "ecu_1",
    );
    assert.ok(proj.gtmRecord.includes("FMI_CoSim"));
    assert.ok(proj.gtmRecord.includes("VendorEcuControllerFmu"));
    assert.deepEqual(proj.parameterNames, ["boostTargetPa"]);

    const fmuInst = createFmuGtSuiteInstance("ecu_1", proj.modelName, (_t, _dt, io) => ({
      powerW: ((io.pIn ?? 101325.0) - 101325.0) * 0.5,
    }));
    const out = fmuInst.doStep(0.01, 0.01, { pIn: 151325.0 });
    assert.ok(Math.abs(out.powerW - 25000.0) < 1e-9);
  });
});
