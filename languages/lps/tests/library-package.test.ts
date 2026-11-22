// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LPS_MODEL_SPECS,
  createFmuLpsInstance,
  fmuToLpsEquipment,
  getLpsSchemasFromLibraries,
  instantiateLpsWasmModel,
  lookupLpsModelSchema,
  registerBuiltInLpsLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/lps-std-lib");

describe("@modelscript/lps — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/lps-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected lps-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/lps-std-lib");
    assert.equal(pkg.manifest.language, "lps");
    assert.equal(pkg.symbols.length, LPS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, LPS_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & provenance metadata on every registered model
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
    registerBuiltInLpsLibrarySync();
    const schemas = getLpsSchemasFromLibraries();
    assert.ok(schemas.length >= LPS_MODEL_SPECS.length);

    assert.equal(lookupLpsModelSchema("pipe_gas")?.name, "PIPE_GAS");
    assert.equal(lookupLpsModelSchema("tlnet_pipe")?.name, "PIPE_LIQUID");
    assert.equal(lookupLpsModelSchema("AGA-8")?.name, "EOS_AGA8");
    assert.equal(lookupLpsModelSchema("GERG-2008")?.name, "EOS_GERG2008");
    assert.equal(lookupLpsModelSchema("PR76")?.name, "EOS_PENG_ROBINSON");
    assert.equal(lookupLpsModelSchema("PRV")?.name, "REGULATOR_PRESSURE");
  });

  it("evaluates PIPE_GAS, COMPRESSOR_CENTRIFUGAL, EOS_AGA8, PIPE_LIQUID (Joukowsky surge), and REGULATOR_PRESSURE in runtime.wasm", () => {
    // 1. PIPE_GAS: steady-state compressible Weymouth/Darcy-Weisbach pressure drop
    const gasPipe = instantiateLpsWasmModel({
      id: "P_MAIN_1",
      modelType: "PIPE_GAS",
      params: { length: 20000, diameter: 0.6, roughness: 4.5e-5 },
    });
    assert.ok(gasPipe, "Expected PIPE_GAS WASM instance");
    gasPipe.init({ pinPa: 7.0e6, tinK: 288.15, massFlowKgS: 120.0 });
    const gasOut = gasPipe.eval({ pinPa: 7.0e6, tinK: 288.15, massFlowKgS: 120.0 });
    assert.ok(
      gasOut.poutPa < 7.0e6 && gasOut.poutPa > 4.0e6,
      `Expected realistic gas outlet pressure, got ${gasOut.poutPa}`,
    );
    assert.ok(gasOut.deltaPPa > 0, `Expected positive gas pressure drop, got ${gasOut.deltaPPa}`);
    assert.ok(gasOut.zFactor > 0.7 && gasOut.zFactor < 0.95, `Expected realistic gas Z-factor, got ${gasOut.zFactor}`);
    assert.ok(
      gasOut.velocityMs > 1.0 && gasOut.velocityMs < 40.0,
      `Expected realistic gas velocity, got ${gasOut.velocityMs}`,
    );

    // 2. COMPRESSOR_CENTRIFUGAL: polytropic head, discharge temperature & shaft power
    const comp = instantiateLpsWasmModel({
      id: "CS_01",
      modelType: "COMPRESSOR_CENTRIFUGAL",
      params: { pressureRatio: 1.5, polytropicEfficiency: 0.82, gamma: 1.3 },
    });
    assert.ok(comp, "Expected COMPRESSOR_CENTRIFUGAL WASM instance");
    comp.init({ pinPa: 5.0e6, tinK: 290.0, massFlowKgS: 100.0 });
    const compOut = comp.eval({ pinPa: 5.0e6, tinK: 290.0, massFlowKgS: 100.0 });
    assert.ok(Math.abs(compOut.poutPa - 7.5e6) < 1.0, `Expected Pout = 7.5 MPa, got ${compOut.poutPa}`);
    assert.ok(compOut.toutK > 290.0, `Expected discharge heating Tout > 290 K, got ${compOut.toutK}`);
    assert.ok(compOut.headM > 3000.0, `Expected positive polytropic head, got ${compOut.headM}`);
    assert.ok(
      compOut.powerW > 4.0e6 && compOut.powerW < 1.5e7,
      `Expected realistic shaft power, got ${compOut.powerW}`,
    );

    // 3. EOS_AGA8: compressibility factor Z(P,T), density & speed of sound
    const aga8 = instantiateLpsWasmModel({ id: "EOS_1", modelType: "EOS_AGA8" });
    assert.ok(aga8, "Expected EOS_AGA8 WASM instance");
    aga8.init({ pinPa: 7.0e6, tinK: 288.15 });
    const eosOut = aga8.eval({ pinPa: 7.0e6, tinK: 288.15 });
    assert.ok(
      eosOut.zFactor > 0.75 && eosOut.zFactor < 0.92,
      `Expected AGA-8 Z(7 MPa, 288.15 K) in (0.75, 0.92), got ${eosOut.zFactor}`,
    );
    assert.ok(
      eosOut.densityKgM3 > 45.0 && eosOut.densityKgM3 < 75.0,
      `Expected realistic gas density, got ${eosOut.densityKgM3}`,
    );
    assert.ok(
      eosOut.waveSpeedMs > 350.0 && eosOut.waveSpeedMs < 500.0,
      `Expected realistic acoustic speed, got ${eosOut.waveSpeedMs}`,
    );

    // 3b. EOS_AGA8 at 5 MPa, 300 K (ISO 20765-1 benchmark) & GERG-2008 H2 blend effect
    const eos5MPa = aga8.eval({ pinPa: 5.0e6, tinK: 300.0 });
    assert.ok(
      eos5MPa.zFactor > 0.87 && eos5MPa.zFactor < 0.94,
      `Expected AGA-8 Z(5 MPa, 300 K) in (0.87, 0.94), got ${eos5MPa.zFactor}`,
    );
    const gergH2 = instantiateLpsWasmModel({
      id: "EOS_H2",
      modelType: "EOS_GERG2008",
      params: { hydrogenFraction: 0.25 },
    });
    assert.ok(gergH2, "Expected EOS_GERG2008 WASM instance");
    const gergOut = gergH2.eval({ pinPa: 5.0e6, tinK: 300.0 });
    assert.ok(
      gergOut.zFactor > eos5MPa.zFactor,
      `Expected 25% H2 blend to increase Z: ${gergOut.zFactor} vs ${eos5MPa.zFactor}`,
    );

    // 4. PIPE_LIQUID: Darcy-Weisbach pressure drop + Joukowsky water-hammer surge (DeltaP = rho * a * DeltaV)
    const liqPipe = instantiateLpsWasmModel({
      id: "L_TRUNK_1",
      modelType: "PIPE_LIQUID",
      params: { length: 10000, diameter: 0.5, density: 850.0, bulkModulus: 1.5e9, wallThickness: 0.012 },
    });
    assert.ok(liqPipe, "Expected PIPE_LIQUID WASM instance");
    liqPipe.init({ pinPa: 5.0e6, tinK: 293.15, massFlowKgS: 350.0, deltaVelocityMs: 2.0 });
    const liqOut = liqPipe.eval({ pinPa: 5.0e6, tinK: 293.15, massFlowKgS: 350.0, deltaVelocityMs: 2.0 });
    assert.ok(liqOut.deltaPPa > 0, `Expected positive liquid Darcy-Weisbach pressure drop, got ${liqOut.deltaPPa}`);
    assert.ok(
      liqOut.waveSpeedMs > 900.0 && liqOut.waveSpeedMs < 1400.0,
      `Expected Korteweg-Moens wave speed, got ${liqOut.waveSpeedMs}`,
    );
    const expectedJoukowsky = 850.0 * liqOut.waveSpeedMs * 2.0;
    assert.ok(
      Math.abs(liqOut.surgeDeltaPPa - expectedJoukowsky) < 1e-3,
      `Expected Joukowsky surge ${expectedJoukowsky}, got ${liqOut.surgeDeltaPPa}`,
    );

    // 5. REGULATOR_PRESSURE: clamps downstream pressure to setpoint without boosting
    const reg = instantiateLpsWasmModel({
      id: "REG_01",
      modelType: "REGULATOR_PRESSURE",
      params: { setpointPressurePa: 4.0e6 },
    });
    assert.ok(reg, "Expected REGULATOR_PRESSURE WASM instance");
    const regClamp = reg.eval({ pinPa: 6.5e6, tinK: 290.0, massFlowKgS: 80.0 });
    assert.ok(
      Math.abs(regClamp.poutPa - 4.0e6) < 1.0,
      `Expected regulator to clamp Pout to 4.0 MPa, got ${regClamp.poutPa}`,
    );
    assert.ok(regClamp.toutK < 290.0, `Expected Joule-Thomson cooling across regulator, got ${regClamp.toutK}`);
    const regNoBoost = reg.eval({ pinPa: 3.2e6, tinK: 290.0, massFlowKgS: 80.0 });
    assert.ok(
      Math.abs(regNoBoost.poutPa - 3.2e6) < 1.0,
      `Expected regulator not to boost below setpoint, got ${regNoBoost.poutPa}`,
    );
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU for pipeline equipment", () => {
    const proj = fmuToLpsEquipment(
      {
        modelName: "VendorCompressorFmu",
        variables: [
          { name: "etaPoly", causality: "parameter", type: "Real", valueReference: 1, start: 0.84 },
          { name: "pinPa", causality: "input", type: "Real", valueReference: 2 },
          { name: "poutPa", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "CS_VENDOR_1",
      "NODE_SUCTION",
      "NODE_DISCHARGE",
    );
    assert.ok(proj.lpsRecord.includes("USER_EQUIPMENT"));
    assert.ok(proj.lpsRecord.includes("VendorCompressorFmu"));
    assert.deepEqual(proj.parameterNames, ["etaPoly"]);

    const fmuInst = createFmuLpsInstance("CS_VENDOR_1", proj.modelName, (io) => ({
      poutPa: io.pinPa * 1.4,
      powerW: 6.2e6,
    }));
    const out = fmuInst.eval({ pinPa: 5.0e6, tinK: 290.0, massFlowKgS: 90.0 });
    assert.ok(Math.abs(out.poutPa - 7.0e6) < 1e-6);
    assert.ok(Math.abs(out.pressureRatio - 1.4) < 1e-9);
    assert.equal(out.powerW, 6.2e6);
  });
});
