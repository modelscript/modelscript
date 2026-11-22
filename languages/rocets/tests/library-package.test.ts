// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PUMP_MAP,
  ROCETS_MODEL_SPECS,
  ROCETS_MODULE_DESCRIPTORS,
  createFmuRocetsInstance,
  fmuToRocetsModule,
  getModuleDescriptor,
  getRocetsSchemasFromLibraries,
  instantiateRocetsWasmModel,
  lookupRocetsModelSchema,
  registerBuiltInRocetsLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/rocets-std-lib");

describe("@modelscript/rocets — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/rocets-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected rocets-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/rocets-std-lib");
    assert.equal(pkg.manifest.language, "rocets");
    assert.equal(pkg.symbols.length, ROCETS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, ROCETS_MODEL_SPECS.length);
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

  it("supports zero-I/O sync registration, case-insensitive alias lookup, and preserves legacy catalog exports", () => {
    registerBuiltInRocetsLibrarySync();
    const schemas = getRocetsSchemasFromLibraries();
    assert.ok(schemas.length >= ROCETS_MODEL_SPECS.length);

    assert.equal(lookupRocetsModelSchema("PUMP")?.name, "PUMP");
    assert.equal(lookupRocetsModelSchema("GP/CHAMBER")?.name, "CHAMBER");
    assert.equal(lookupRocetsModelSchema("gas_generator")?.name, "GASGEN");
    assert.equal(lookupRocetsModelSchema("lch4")?.name, "FLUID_CH4");
    assert.equal(lookupRocetsModelSchema("mov")?.name, "VALVE");

    // Legacy exports remain intact
    assert.ok(ROCETS_MODULE_DESCRIPTORS["PUMP"]);
    assert.equal(getModuleDescriptor("GP/PUMP")?.type, "PUMP");
    assert.equal(DEFAULT_PUMP_MAP.name, "DEFAULT_CENTRIFUGAL_PUMP");
  });

  it("executes PUMP, NOZZLE (choked flow), CHAMBER, VALVE, and cryogenic FLUID_LOX in runtime.wasm", () => {
    // 1. PUMP: affinity-law head/pressure rise and shaft torque
    const pump = instantiateRocetsWasmModel({ id: "LOX_PUMP", modelType: "PUMP" });
    assert.ok(pump, "Expected PUMP WASM instance");
    pump.init();
    const pumpNom = pump.doStep(0.0, 0.01, {
      pIn: 3.5e5,
      tIn: 90.2,
      mdotIn: 50.0,
      speedRpm: 30000.0,
      density: 1141.0,
    });
    assert.ok(Math.abs(pumpNom.headM - 1500.0) < 1e-3, `Expected nominal head ~1500 m, got ${pumpNom.headM}`);
    assert.ok(pumpNom.pOut > 1.6e7, `Expected pump discharge pressure > 16 MPa, got ${pumpNom.pOut}`);
    assert.ok(pumpNom.torqueNm > 0 && pumpNom.powerW > 5e5, "Expected positive pump torque and power");

    // Affinity law check: doubling flow/speed or reducing speed to 50% scales head ~ N^2
    const pumpHalf = pump.doStep(0.01, 0.01, {
      pIn: 3.5e5,
      tIn: 90.2,
      mdotIn: 25.0,
      speedRpm: 15000.0,
      density: 1141.0,
    });
    assert.ok(
      Math.abs(pumpHalf.headM / pumpNom.headM - 0.25) < 1e-3,
      `Expected pump affinity law H ~ N^2 (ratio 0.25), got ${pumpHalf.headM / pumpNom.headM}`,
    );

    // 2. NOZZLE: exact choked isentropic mass flow mdot = Pc * At / c*, positive thrust and Isp
    const nozzle = instantiateRocetsWasmModel({
      id: "MAIN_NOZ",
      modelType: "NOZZLE",
      params: { throatArea: 0.05, expansionRatio: 35.0, cstar: 2300.0, gamma: 1.2, cfEff: 0.98, pAmbient: 101325.0 },
    });
    assert.ok(nozzle, "Expected NOZZLE WASM instance");
    nozzle.init();
    const nozOut = nozzle.doStep(0.0, 0.01, { pIn: 1.0e7, tIn: 3450.0, pOut: 101325.0 });
    const expectedMdot = (1.0e7 * 0.05) / 2300.0;
    assert.ok(
      Math.abs(nozOut.mdotOut - expectedMdot) < 1e-6,
      `Expected choked mdot=${expectedMdot}, got ${nozOut.mdotOut}`,
    );
    assert.ok(
      nozOut.thrustN > 7.0e5 && nozOut.thrustN < 8.5e5,
      `Expected sea-level nozzle thrust ~744 kN, got ${nozOut.thrustN}`,
    );
    assert.ok(nozOut.ispSec > 320.0 && nozOut.ispSec < 400.0, `Expected realistic sea-level Isp, got ${nozOut.ispSec}`);
    const nozVac = nozzle.doStep(0.01, 0.01, { pIn: 1.0e7, tIn: 3450.0, pOut: 1.0 });
    assert.ok(
      nozVac.thrustN > nozOut.thrustN && nozVac.thrustN > 9.0e5,
      `Expected vacuum thrust > 900 kN, got ${nozVac.thrustN}`,
    );
    assert.ok(nozVac.ispSec > 420.0, `Expected vacuum Isp > 420 s, got ${nozVac.ispSec}`);

    // 3. CHAMBER: flat-start equilibrium, then pressure rises when propellant inflow increases
    const chamber = instantiateRocetsWasmModel({ id: "MCC", modelType: "CHAMBER" });
    assert.ok(chamber, "Expected CHAMBER WASM instance");
    const initIo = { mdotIn: 160.0, mdotFuel: 40.0 };
    chamber.init(initIo);
    assert.ok(
      chamber.checkFlatStart() < 1e-3,
      `Expected CHAMBER flat-start residual < 1e-3, got ${chamber.checkFlatStart()}`,
    );
    const pc0 = chamber.doStep(0.0, 0.001, initIo).pOut;
    let chOut = chamber.doStep(0.001, 0.001, { mdotIn: 185.0, mdotFuel: 45.0 });
    for (let k = 1; k < 25; k++) {
      chOut = chamber.doStep(0.001 * (k + 1), 0.001, { mdotIn: 185.0, mdotFuel: 45.0 });
    }
    assert.ok(chOut.pOut > pc0, `Expected chamber pressure to rise on increased flow (${chOut.pOut} > ${pc0})`);
    assert.ok(chOut.thrustN > 0 && chOut.ispSec > 300.0, "Expected positive chamber thrust and Isp");

    // 4. VALVE: first-order stroke lag and CdA orifice flow throttling
    const valve = instantiateRocetsWasmModel({ id: "MOV", modelType: "VALVE" });
    assert.ok(valve, "Expected VALVE WASM instance");
    valve.init({ pIn: 1.4e7, pOut: 1.0e7, tIn: 90.2, density: 1141.0, valveCmd: 1.0 });
    const fullOpen = valve.doStep(0.0, 0.01, { pIn: 1.4e7, pOut: 1.0e7, tIn: 90.2, density: 1141.0, valveCmd: 1.0 });
    assert.ok(fullOpen.mdotOut > 100.0, `Expected high open valve flow, got ${fullOpen.mdotOut}`);
    let throttled = fullOpen;
    for (let k = 0; k < 50; k++) {
      throttled = valve.doStep(0.01 * (k + 1), 0.01, {
        pIn: 1.4e7,
        pOut: 1.0e7,
        tIn: 90.2,
        density: 1141.0,
        valveCmd: 0.4,
      });
    }
    assert.ok(
      throttled.mdotOut < fullOpen.mdotOut * 0.5,
      `Expected throttled valve flow < 50% of full open (${throttled.mdotOut} vs ${fullOpen.mdotOut})`,
    );

    // 5. Cryogenic Fluid Property Table (FLUID_LOX)
    const lox = instantiateRocetsWasmModel({ id: "LOX_TBL", modelType: "FLUID_LOX" });
    assert.ok(lox, "Expected FLUID_LOX WASM instance");
    lox.init();
    const loxOut = lox.doStep(0.0, 0.01, { pIn: 5.0e6, tIn: 90.19, mdotIn: 50.0 });
    assert.ok(
      loxOut.density > 1140.0 && loxOut.density < 1160.0,
      `Expected LOX density ~1149 kg/m3, got ${loxOut.density}`,
    );
    assert.ok(Number.isFinite(loxOut.enthalpy), "Expected finite LOX specific enthalpy");
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via USER_ROUTINE", () => {
    const proj = fmuToRocetsModule(
      {
        modelName: "VendorTurbopumpFmu",
        variables: [
          { name: "eta_design", causality: "parameter", type: "Real", valueReference: 1, start: 0.81 },
          { name: "pIn", causality: "input", type: "Real", valueReference: 2 },
          { name: "pOut", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "TP_FMU",
    );
    assert.ok(proj.deckBlock.includes("USER_ROUTINE"));
    assert.ok(proj.deckBlock.includes("VendorTurbopumpFmu"));
    assert.deepEqual(proj.parameterNames, ["eta_design"]);

    const fmuInst = createFmuRocetsInstance("TP_FMU", proj.modelName, (_t, _dt, io) => ({
      pOut: (io.pIn ?? 0) + 1.5e7,
      mdotOut: io.mdotIn ?? 0,
    }));
    const out = fmuInst.doStep(0.01, 0.01, { pIn: 4.0e5, mdotIn: 60.0 });
    assert.ok(Math.abs(out.pOut - 1.54e7) < 1e-6);
    assert.equal(out.mdotOut, 60.0);
  });
});
