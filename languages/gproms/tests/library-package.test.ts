// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GPROMS_MODEL_SPECS,
  createFmuGpromsInstance,
  fmuToGpromsForeignObject,
  getGpromsSchemasFromLibraries,
  instantiateGpromsWasmModel,
  lookupGpromsModelSchema,
  registerBuiltInGpromsLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/gproms-std-lib");

describe("@modelscript/gproms — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU/CAPE-OPEN Linking)", () => {
  it("loads @modelscript/gproms-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected gproms-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/gproms-std-lib");
    assert.equal(pkg.manifest.language, "gproms");
    assert.equal(pkg.symbols.length, GPROMS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, GPROMS_MODEL_SPECS.length);
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
    registerBuiltInGpromsLibrarySync();
    const schemas = getGpromsSchemasFromLibraries();
    assert.ok(schemas.length >= GPROMS_MODEL_SPECS.length);

    assert.equal(lookupGpromsModelSchema("PML_CSTR")?.name, "PML_CSTR");
    assert.equal(lookupGpromsModelSchema("cstr")?.name, "PML_CSTR");
    assert.equal(lookupGpromsModelSchema("hx")?.name, "PML_HeatExchanger");
    assert.equal(lookupGpromsModelSchema("pr")?.name, "PROP_PengRobinson");
    assert.equal(lookupGpromsModelSchema("if97")?.name, "PROP_IAPWS_IF97");
    assert.equal(lookupGpromsModelSchema("cape_open")?.name, "CAPE_OPEN_ForeignObject");
  });

  it("steps PML_CSTR, PML_TankBuffer, PML_HeatExchanger, PML_ControlValve, and PML_PIDController in runtime.wasm", () => {
    // 1. PML_CSTR: exothermic Arrhenius reaction converts reactant and heats reactor
    const cstr = instantiateGpromsWasmModel({
      unitName: "R101",
      modelType: "PML_CSTR",
      params: { V: 1.0, A: 1.0e5, Ea: 45000.0, dHrxn: -50000.0, rho: 1000.0, Cp: 4184.0, UA: 500.0 },
    });
    assert.ok(cstr, "Expected PML_CSTR WASM instance");
    const cstrIo = {
      flowIn: 0.01,
      concIn: 1000.0,
      tempIn: 350.0,
      pressureIn: 101325.0,
      coolantTemp: 340.0,
    };
    assert.equal(cstr.init(cstrIo), 2);
    let cstrOut = cstr.doStep(0.0, 1.0, cstrIo);
    for (let k = 1; k < 30; k++) {
      cstrOut = cstr.doStep(k * 1.0, 1.0, cstrIo);
    }
    assert.ok(cstrOut.concOut < cstrIo.concIn, `Expected CSTR reactant consumption, got C=${cstrOut.concOut}`);
    assert.ok(cstrOut.tempOut > cstrIo.tempIn, `Expected exothermic temperature rise, got T=${cstrOut.tempOut}`);
    assert.ok(cstrOut.conversion > 0.05, `Expected positive conversion, got X=${cstrOut.conversion}`);

    // 2. PML_TankBuffer: dynamic holdup increases when inflow exceeds gravity discharge
    const tank = instantiateGpromsWasmModel({
      unitName: "T101",
      modelType: "PML_TankBuffer",
      params: { area: 2.0, hMax: 5.0, hInit: 1.0, kOut: 0.05 },
    });
    assert.ok(tank, "Expected PML_TankBuffer WASM instance");
    const tankIo = { flowIn: 0.2, concIn: 500.0, tempIn: 310.0, pressureIn: 101325.0 };
    assert.equal(tank.init(tankIo), 3);
    let tankOut = tank.doStep(0.0, 0.5, tankIo);
    for (let k = 1; k < 20; k++) {
      tankOut = tank.doStep(k * 0.5, 0.5, tankIo);
    }
    assert.ok(tankOut.holdup > 2.0, `Expected tank holdup to rise above initial 2.0 m^3, got ${tankOut.holdup}`);
    assert.ok(tankOut.flowOut > 0.05, `Expected gravity discharge flow to increase, got ${tankOut.flowOut}`);

    // 3. PML_HeatExchanger: counter-current LMTD cools hot stream and reports positive heat duty
    const hx = instantiateGpromsWasmModel({
      unitName: "E101",
      modelType: "PML_HeatExchanger",
    });
    assert.ok(hx, "Expected PML_HeatExchanger WASM instance");
    const hxIo = { flowIn: 0.05, concIn: 100.0, tempIn: 400.0, coolantTemp: 300.0 };
    hx.init(hxIo);
    let hxOut = hx.doStep(0.0, 1.0, hxIo);
    for (let k = 1; k < 20; k++) {
      hxOut = hx.doStep(k * 1.0, 1.0, hxIo);
    }
    assert.ok(hxOut.tempOut < 400.0 && hxOut.tempOut > 300.0, `Expected cooled hot outlet, got ${hxOut.tempOut}`);
    assert.ok(hxOut.heatDuty > 1000.0, `Expected positive LMTD heat duty, got ${hxOut.heatDuty}`);

    // 4. PML_ControlValve: stem tracks opening command and computes ISA-75.01 Cv flow
    const valve = instantiateGpromsWasmModel({
      unitName: "V101",
      modelType: "PML_ControlValve",
      params: { Cv: 0.002, tau: 0.5, pDown: 101325.0, rho: 1000.0 },
    });
    assert.ok(valve, "Expected PML_ControlValve WASM instance");
    valve.init({ pressureIn: 301325.0, valveOpening: 0.2 });
    let valveOut = valve.doStep(0.0, 0.25, { pressureIn: 301325.0, valveOpening: 0.8 });
    for (let k = 1; k < 15; k++) {
      valveOut = valve.doStep(k * 0.25, 0.25, { pressureIn: 301325.0, valveOpening: 0.8 });
    }
    const expectedFlow = 0.002 * 0.8 * Math.sqrt(200000.0);
    assert.ok(
      Math.abs(valveOut.flowOut - expectedFlow) / expectedFlow < 0.02,
      `Expected Cv flow ~ ${expectedFlow}, got ${valveOut.flowOut}`,
    );

    // 5. PML_PIDController: raises output on positive error and respects [uMin, uMax]
    const pid = instantiateGpromsWasmModel({
      unitName: "TIC101",
      modelType: "PML_PIDController",
      params: { Kc: 1.5, tauI: 5.0, tauD: 0.2, uBias: 0.4, uMin: 0.0, uMax: 1.0, tauF: 0.1 },
    });
    assert.ok(pid, "Expected PML_PIDController WASM instance");
    pid.init({ setpoint: 0.5, measurement: 0.5 });
    let pidOut = pid.doStep(0.0, 0.2, { setpoint: 0.7, measurement: 0.5 });
    for (let k = 1; k < 15; k++) {
      pidOut = pid.doStep(k * 0.2, 0.2, { setpoint: 0.7, measurement: 0.5 });
    }
    assert.ok(pidOut.controlOut > 0.7, `Expected PID output to rise above 0.7, got ${pidOut.controlOut}`);
    assert.ok(pidOut.controlOut <= 1.0, `Expected PID output clamped <= 1.0, got ${pidOut.controlOut}`);
  });

  it("projects and links an FMI 2.0/3.0 or CAPE-OPEN Foreign Object alongside cleanroom models", () => {
    const proj = fmuToGpromsForeignObject(
      {
        modelName: "VendorThermoFlash",
        capeOpenProgId: "CAPE-OPEN.VendorThermo.1",
        variables: [
          { name: "Kval", causality: "parameter", type: "Real", valueReference: 1, start: 2.4 },
          { name: "T", causality: "input", type: "Real", valueReference: 2 },
          { name: "P", causality: "input", type: "Real", valueReference: 3 },
          { name: "vaporFrac", causality: "output", type: "Real", valueReference: 4 },
        ],
      },
      "FLASH_FO",
    );
    assert.ok(proj.gpromsSource.includes("FOREIGN_OBJECT"));
    assert.ok(proj.gpromsSource.includes("CAPE-OPEN.VendorThermo.1"));
    assert.ok(proj.gpromsSource.includes("VendorThermoFlash"));
    assert.deepEqual(proj.parameterNames, ["Kval"]);

    const fmuInst = createFmuGpromsInstance("FLASH_FO", proj.modelName, (_t, _dt, io) => ({
      tempOut: (io.tempIn ?? 350.0) - 5.0,
      conversion: 0.62,
    }));
    const out = fmuInst.doStep(0.0, 0.1, { flowIn: 0.05, tempIn: 360.0 });
    assert.equal(out.tempOut, 355.0);
    assert.equal(out.conversion, 0.62);
  });
});
