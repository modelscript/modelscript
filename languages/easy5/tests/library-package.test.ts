// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EASY5_MODEL_SPECS,
  GP_BLOCK_DESCRIPTORS,
  createFmuEasy5Instance,
  fmuToEasy5Block,
  getBlockDescriptor,
  getEasy5SchemasFromLibraries,
  instantiateEasy5WasmModel,
  lookupEasy5ModelSchema,
  registerBuiltInEasy5LibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/easy5-std-lib");

describe("@modelscript/easy5 — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("preserves legacy gp-library exports without breaking compatibility", () => {
    assert.ok(GP_BLOCK_DESCRIPTORS["IN"]);
    assert.equal(getBlockDescriptor("GP/LA")?.type, "LA");
    assert.equal(getBlockDescriptor("SJ")?.type, "SJ");
  });

  it("loads @modelscript/easy5-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected easy5-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/easy5-std-lib");
    assert.equal(pkg.manifest.language, "easy5");
    assert.equal(pkg.symbols.length, EASY5_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, EASY5_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons, ports & textbook provenance metadata on every registered model
    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(
        typeof prov === "string" && prov.length > 10,
        `Expected public provenance citation for ${sym.namePath}`,
      );
    }
  });

  it("supports zero-I/O sync registration and case-insensitive alias lookup across all 6 domain libraries", () => {
    registerBuiltInEasy5LibrarySync();
    const schemas = getEasy5SchemasFromLibraries();
    assert.ok(schemas.length >= EASY5_MODEL_SPECS.length);

    // Verify all 6 classic libraries (GP, HC, GD, EC, AE, VC)
    assert.equal(lookupEasy5ModelSchema("GP/IN")?.name, "IN");
    assert.equal(lookupEasy5ModelSchema("hc/or")?.name, "OR");
    assert.equal(lookupEasy5ModelSchema("GD/OR_GD")?.name, "OR_GD");
    assert.equal(lookupEasy5ModelSchema("EC/DC_M")?.name, "DC_M");
    assert.equal(lookupEasy5ModelSchema("AE/AT")?.name, "AT");
    assert.equal(lookupEasy5ModelSchema("VC/EV")?.name, "EV");
  });

  it("steps IN (integrator), LA (1st-order lag), OR (hydraulic orifice), and AT (ISA atmosphere) in runtime.wasm", () => {
    // 1. GP/IN — Integrator: dx/dt = GAIN * u, with GAIN = 2.0, S0 = 1.0, u = 3.0 over 0.5 s => x = 1 + 2*3*0.5 = 4.0
    const integ = instantiateEasy5WasmModel({
      id: "IN01",
      type: "GP/IN",
      parameters: { GAIN: 2.0, S0: 1.0 },
    });
    assert.ok(integ, "Expected IN WASM instance");
    assert.equal(integ.init({ u0: 0.0 }), 1);
    assert.ok(integ.checkFlatStart() < 1e-12);
    let outIn = { y0: 0, y1: 0, y2: 0, y3: 0 };
    const dt = 0.05;
    for (let k = 0; k < 10; k++) {
      outIn = integ.doStep(k * dt, dt, { u0: 3.0 });
    }
    assert.ok(Math.abs(outIn.y0 - 4.0) < 1e-9, `Expected integrator output 4.0, got ${outIn.y0}`);

    // 2. GP/LA — First-Order Lag: tau = 1.0, GAIN = 2.0, step u = 1.0 => y(1.0) = 2 * (1 - e^-1) ≈ 1.26424
    const lag = instantiateEasy5WasmModel({
      id: "LA01",
      type: "GP/LA",
      parameters: { GAIN: 2.0, TAU: 1.0, S0: 0.0 },
    });
    assert.ok(lag, "Expected LA WASM instance");
    assert.equal(lag.init({ u0: 0.0 }), 1);
    let outLa = { y0: 0, y1: 0, y2: 0, y3: 0 };
    const dtLa = 0.01;
    for (let k = 0; k < 100; k++) {
      outLa = lag.doStep(k * dtLa, dtLa, { u0: 1.0 });
    }
    const expectedLa = 2.0 * (1.0 - Math.exp(-1.0));
    assert.ok(Math.abs(outLa.y0 - expectedLa) < 1e-3, `Expected lag output ~${expectedLa}, got ${outLa.y0}`);

    // 3. HC/OR — Hydraulic Orifice: Q = Cd * A * sqrt(2 * dP / rho)
    const cd = 0.61;
    const area = 1e-4;
    const rho = 850.0;
    const pIn = 2.0e6;
    const pOut = 1.0e6;
    const orifice = instantiateEasy5WasmModel({
      id: "OR01",
      type: "HC/OR",
      parameters: { CD: cd, AREA: area, RHO: rho },
    });
    assert.ok(orifice, "Expected OR WASM instance");
    orifice.init({ u0: pIn, u1: pOut });
    const outOr = orifice.doStep(0.0, 0.01, { u0: pIn, u1: pOut });
    const expectedQ = cd * area * Math.sqrt((2.0 * (pIn - pOut)) / rho);
    assert.ok(Math.abs(outOr.y0 - expectedQ) < 1e-9, `Expected hydraulic orifice Q=${expectedQ}, got ${outOr.y0}`);

    // 4. AE/AT — US Standard Atmosphere 1976 (ISA): sea level (h=0) and cruise (h=11000 m)
    const atm = instantiateEasy5WasmModel({ id: "AT01", type: "AE/AT" });
    assert.ok(atm, "Expected AT WASM instance");
    atm.init({ u0: 0.0 });
    const seaLevel = atm.doStep(0.0, 0.01, { u0: 0.0 });
    assert.ok(Math.abs(seaLevel.y0 - 1.225) < 1e-3, `Expected sea-level rho ~1.225 kg/m^3, got ${seaLevel.y0}`);
    assert.ok(Math.abs(seaLevel.y1 - 101325.0) < 1.0, `Expected sea-level P ~101325 Pa, got ${seaLevel.y1}`);
    assert.ok(Math.abs(seaLevel.y2 - 288.15) < 1e-3, `Expected sea-level T=288.15 K, got ${seaLevel.y2}`);

    const tropopause = atm.doStep(0.01, 0.01, { u0: 11000.0 });
    assert.ok(Math.abs(tropopause.y0 - 0.3639) < 2e-3, `Expected 11km rho ~0.3639 kg/m^3, got ${tropopause.y0}`);
    assert.ok(Math.abs(tropopause.y1 - 22632.0) < 50.0, `Expected 11km P ~22632 Pa, got ${tropopause.y1}`);
    assert.ok(Math.abs(tropopause.y2 - 216.65) < 1e-3, `Expected 11km T=216.65 K, got ${tropopause.y2}`);
  });

  it("integrates HC/PI_HC bulk-modulus capacitance and GD/VO real-gas energy/pressure states", () => {
    // 1. HC/PI_HC — Hydraulic pipe bulk-modulus compressibility dP/dt = (beta / V) * (Q_in - Q_out)
    const length = 2.0;
    const diam = 0.02;
    const vol = 0.25 * Math.PI * diam * diam * length;
    const beta = 1.4e9;
    const pipe = instantiateEasy5WasmModel({
      id: "PI01",
      type: "HC/PI_HC",
      parameters: { LENGTH: length, DIAM: diam, RHO: 850.0, RF: 1e7 },
    });
    assert.ok(pipe, "Expected HC/PI_HC WASM instance");
    assert.equal(pipe.init({ u0: 1.0e6, u1: 1.0e6 }), 2, "Expected 2 states (Q, P_pipe)");

    const qIn = 1.0e-6; // 1 cm^3/s net inflow
    const dtPipe = 0.001;
    const pipeOut = pipe.doStep(0.0, dtPipe, { u0: 1.0e6, u1: 1.0e6, u2: qIn, u3: 0.0 });
    const expectedP = 1.0e6 + (beta / vol) * qIn * dtPipe;
    assert.ok(
      Math.abs(pipeOut.y1 - expectedP) / expectedP < 1e-4,
      `Expected bulk-modulus pressure rise to ${expectedP} Pa, got ${pipeOut.y1} Pa`,
    );
    assert.ok(pipeOut.y3 > 1000.0, `Expected hydraulic acoustic wave speed > 1000 m/s, got ${pipeOut.y3}`);

    // 2. GD/VO — Real-gas open-system energy/pressure integration with Virial compressibility Z(P, T)
    const gasVol = instantiateEasy5WasmModel({
      id: "VO01",
      type: "GD/VO",
      parameters: { VOL: 0.05, R_GAS: 287.05, GAMMA: 1.4, P0: 101325.0, T0: 293.15 },
    });
    assert.ok(gasVol, "Expected GD/VO WASM instance");
    assert.equal(gasVol.init({ u0: 0.0, u1: 0.0, u2: 293.15, u3: 0.0 }), 2);
    assert.ok(gasVol.checkFlatStart() < 1e-9, `Expected GD/VO flat-start residual ~0, got ${gasVol.checkFlatStart()}`);

    // Adiabatic charging with 0.05 kg/s of 300 K air -> both pressure AND temperature rise (compression heating)
    let voOut = gasVol.doStep(0.0, 0.01, { u0: 0.05, u1: 0.0, u2: 300.0, u3: 0.0 });
    for (let k = 1; k < 20; k++) {
      voOut = gasVol.doStep(k * 0.01, 0.01, { u0: 0.05, u1: 0.0, u2: 300.0, u3: 0.0 });
    }
    assert.ok(voOut.y0 > 120000.0, `Expected gas volume pressure rise during charging, got ${voOut.y0}`);
    assert.ok(voOut.y2 > 310.0, `Expected first-law adiabatic compression heating T > 310 K, got ${voOut.y2}`);

    // High-pressure real-gas compressibility check (P0 = 15 MPa -> Virial Z != 1)
    const hpVol = instantiateEasy5WasmModel({
      id: "VO_HP",
      type: "GD/VO",
      parameters: { VOL: 0.05, R_GAS: 287.05, GAMMA: 1.4, P0: 1.5e7, T0: 250.0 },
    });
    assert.ok(hpVol);
    hpVol.init({ u0: 0.0, u1: 0.0, u2: 250.0, u3: 0.0 });
    const hpOut = hpVol.doStep(0.0, 0.001, { u0: 0.0, u1: 0.0, u2: 250.0, u3: 0.0 });
    assert.ok(Math.abs(hpOut.y1 - 1.0) > 1e-3, `Expected non-ideal Virial Z(P,T) != 1 at 15 MPa, got ${hpOut.y1}`);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via GP/UG", () => {
    const proj = fmuToEasy5Block(
      {
        modelName: "HydraulicServoFmu",
        variables: [
          { name: "GAIN", causality: "parameter", type: "Real", valueReference: 1, start: 2.5 },
          { name: "CMD", causality: "input", type: "Real", valueReference: 2 },
          { name: "POS", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "FMU01",
    );
    assert.ok(proj.easy5Block.includes("COMPONENT FMU01 = GP/UG"));
    assert.ok(proj.easy5Block.includes("HydraulicServoFmu"));
    assert.deepEqual(proj.parameterNames, ["GAIN"]);
    assert.deepEqual(proj.inputNames, ["CMD"]);
    assert.deepEqual(proj.outputNames, ["POS"]);

    const fmuInst = createFmuEasy5Instance("FMU01", proj.modelName, (_t, _dt, io) => ({
      y0: 2.5 * io.u0,
    }));
    const out = fmuInst.doStep(0.01, 0.01, { u0: 0.4 });
    assert.ok(Math.abs(out.y0 - 1.0) < 1e-9);
  });
});
