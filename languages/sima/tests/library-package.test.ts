// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SIMA_MODEL_SPECS,
  createFmuSimaInstance,
  fmuToSimaXml,
  getSimaSchemasFromLibraries,
  instantiateSimaWasmModel,
  lookupSimaModelSchema,
  registerBuiltInSimaLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/sima-std-lib");

describe("@modelscript/sima — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/sima-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected sima-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/sima-std-lib");
    assert.equal(pkg.manifest.language, "sima");
    assert.equal(pkg.symbols.length, SIMA_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, SIMA_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered model
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
    registerBuiltInSimaLibrarySync();
    const schemas = getSimaSchemasFromLibraries();
    assert.ok(schemas.length >= SIMA_MODEL_SPECS.length);
    assert.equal(SIMA_MODEL_SPECS.length, 20);

    assert.equal(lookupSimaModelSchema("simo_morisonmember")?.name, "SIMO_MorisonMember");
    assert.equal(lookupSimaModelSchema("MorisonCylinder")?.name, "SIMO_MorisonMember");
    assert.equal(lookupSimaModelSchema("catenaryline")?.name, "RIFLEX_CatenaryLine");
    assert.equal(lookupSimaModelSchema("JONSWAP")?.name, "ENV_JONSWAPWave");
    assert.equal(lookupSimaModelSchema("fender")?.name, "SIMO_Fender");
    assert.equal(lookupSimaModelSchema("FroyaWind")?.name, "ENV_NPDWind");
  });

  it("evaluates SIMO_MorisonMember drag + inertia hydrodynamic force in runtime.wasm", () => {
    const D = 1.0;
    const L = 10.0;
    const cd = 1.0;
    const cm = 2.0;
    const rho = 1025.0;
    const morison = instantiateSimaWasmModel({
      id: "col1",
      modelType: "SIMO_MorisonMember",
      params: { diameter: D, length: L, cd, cm, waterDensity: rho },
    });
    assert.ok(morison, "Expected SIMO_MorisonMember WASM instance");
    morison.init();

    const uFluid = 2.0;
    const vBody = 0.5;
    const aFluid = 1.5;
    const out = morison.eval(0.0, 0.05, { velocity: vBody, fluidVelocity: uFluid, fluidAccel: aFluid });

    const uRel = uFluid - vBody;
    const expectedDrag = 0.5 * rho * cd * D * L * Math.abs(uRel) * uRel;
    const expectedInertia = rho * cm * (0.25 * Math.PI * D * D) * L * aFluid;
    assert.ok(
      Math.abs(out.secondary - expectedDrag) < 1e-6,
      `Expected Morison drag ${expectedDrag}, got ${out.secondary}`,
    );
    assert.ok(
      Math.abs(out.tertiary - expectedInertia) < 1e-6,
      `Expected Morison inertia ${expectedInertia}, got ${out.tertiary}`,
    );
    assert.ok(
      Math.abs(out.primary - (expectedDrag + expectedInertia)) < 1e-6,
      `Expected total Morison force ${expectedDrag + expectedInertia}, got ${out.primary}`,
    );
  });

  it("solves RIFLEX_CatenaryLine inelastic mooring tension and touchdown geometry in runtime.wasm", () => {
    const line = instantiateSimaWasmModel({
      id: "moor1",
      modelType: "RIFLEX_CatenaryLine",
      params: {
        submergedWeight: 1200.0,
        totalLength: 1200.0,
        waterDepth: 300.0,
        horizontalSpan: 1080.0,
        axialStiffnessEA: 8.0e8,
      },
    });
    assert.ok(line, "Expected RIFLEX_CatenaryLine WASM instance");
    line.init();

    const base = line.eval(0.0, 0.1, { displacement: 1080.0 });
    assert.ok(base.primary > 0, `Expected positive fairlead tension, got ${base.primary}`);
    assert.ok(base.secondary > 0, `Expected positive horizontal tension T_H, got ${base.secondary}`);
    assert.ok(base.tertiary > 0, `Expected positive vertical tension T_V, got ${base.tertiary}`);
    assert.ok(
      Math.abs(base.primary - Math.hypot(base.secondary, base.tertiary)) < 1e-3,
      "Expected T_F = sqrt(T_H^2 + T_V^2)",
    );
    assert.ok(base.aux1 > 300.0 && base.aux1 < 1200.0, `Expected partial suspended length, got ${base.aux1}`);
    assert.ok(Math.abs(base.aux1 + base.aux2 - 1200.0) < 1e-3, "Expected s + L_grounded = L");

    // Increasing fairlead offset must increase horizontal tension and reduce grounded length
    const offset = line.eval(0.1, 0.1, { displacement: 1120.0 });
    assert.ok(offset.secondary > base.secondary, "Expected higher horizontal tension at larger offset");
    assert.ok(offset.aux2 < base.aux2, "Expected shorter grounded length at larger offset");
  });

  it("evaluates ENV_JONSWAPWave, ENV_NPDWind, SIMO_Fender, and SIMO_Thruster in runtime.wasm", () => {
    // 1. ENV_JONSWAPWave
    const jonswap = instantiateSimaWasmModel({
      id: "wave1",
      modelType: "ENV_JONSWAPWave",
      params: { hs: 4.5, tp: 10.0, gamma: 3.3 },
    });
    assert.ok(jonswap, "Expected ENV_JONSWAPWave WASM instance");
    jonswap.init();

    const omegaP = (2.0 * Math.PI) / 10.0;
    const atPeak = jonswap.eval(0.0, 0.1, { frequency: omegaP });
    const offPeak = jonswap.eval(0.0, 0.1, { frequency: omegaP * 1.5 });
    assert.ok(Math.abs(atPeak.secondary - omegaP) < 1e-9, "Expected omega_p output");
    assert.ok(atPeak.primary > offPeak.primary && atPeak.primary > 0, "Expected peak S(omega_p) > off-peak S(omega)");
    assert.ok(atPeak.primary > atPeak.tertiary, "Expected JONSWAP peak > Pierson-Moskowitz peak for gamma = 3.3");

    // 2. ENV_NPDWind
    const wind = instantiateSimaWasmModel({
      id: "wind1",
      modelType: "ENV_NPDWind",
      params: { u0: 25.0, heightZ: 20.0 },
    });
    assert.ok(wind, "Expected ENV_NPDWind WASM instance");
    wind.init();
    const windOut = wind.eval(0.0, 0.1, { frequency: 0.02 });
    assert.ok(windOut.primary > 0, `Expected positive NPD wind PSD, got ${windOut.primary}`);
    assert.ok(windOut.secondary > 25.0, `Expected higher wind speed at z=20m than u0=25m/s, got ${windOut.secondary}`);

    // 3. SIMO_Fender
    const fender = instantiateSimaWasmModel({
      id: "fend1",
      modelType: "SIMO_Fender",
      params: { k1: 4.0e5, k2: 1.5e5, k3: 8.0e4, damping: 6.0e4, muFriction: 0.2, maxDeflection: 1.8 },
    });
    assert.ok(fender, "Expected SIMO_Fender WASM instance");
    fender.init();

    const noContact = fender.eval(0.0, 0.05, { displacement: -0.1, velocity: 0.5 });
    assert.equal(noContact.primary, 0, "Expected zero fender force when not compressed");

    const compressed = fender.eval(0.05, 0.05, { displacement: 0.5, velocity: 0.4 });
    const expectedFender = 4.0e5 * 0.5 + 1.5e5 * 0.25 + 8.0e4 * 0.125 + 6.0e4 * 0.4;
    assert.ok(
      Math.abs(compressed.primary - expectedFender) < 1e-3,
      `Expected fender force ${expectedFender}, got ${compressed.primary}`,
    );
    assert.ok(Math.abs(compressed.secondary - 0.2 * expectedFender) < 1e-3, "Expected fender friction = mu * F_normal");

    // 4. SIMO_Thruster
    const thruster = instantiateSimaWasmModel({
      id: "thr1",
      modelType: "SIMO_Thruster",
      params: { bollardPull: 6.0e5, advanceLossCoeff: 0.35, maxInflowVel: 6.0 },
    });
    assert.ok(thruster, "Expected SIMO_Thruster WASM instance");
    thruster.init();
    const bollard = thruster.eval(0.0, 0.05, { command: 1.0, velocity: 0.0, angle: 0.0 });
    assert.ok(Math.abs(bollard.primary - 6.0e5) < 1e-3, "Expected full bollard pull at zero inflow");
    const moving = thruster.eval(0.05, 0.05, { command: 1.0, velocity: 3.0, angle: Math.PI / 2 });
    assert.ok(moving.primary < bollard.primary, "Expected inflow degradation on thrust");
    assert.ok(Math.abs(moving.tertiary - moving.primary) < 1e-3, "Expected thrust directed along +Y at 90 deg");
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU alongside SIMA models", () => {
    const proj = fmuToSimaXml(
      {
        modelName: "VendorDPControllerFmu",
        variables: [
          { name: "kpSurge", causality: "parameter", type: "Real", valueReference: 1, start: 3.0e5 },
          { name: "xErr", causality: "input", type: "Real", valueReference: 2 },
          { name: "fxCmd", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "FPSO_Hull",
    );
    assert.ok(proj.simaXmlFragment.includes("ExternalFmuForce"));
    assert.ok(proj.simaXmlFragment.includes("VendorDPControllerFmu"));
    assert.ok(proj.simaXmlFragment.includes("FPSO_Hull"));
    assert.deepEqual(proj.parameterNames, ["kpSurge"]);

    const fmuInst = createFmuSimaInstance("dp_fmu_1", proj.modelName, (_t, _dt, io) => ({
      primary: 3.0e5 * (io?.displacement ?? 0),
    }));
    const out = fmuInst.eval(0.1, 0.1, { displacement: 2.0 });
    assert.ok(Math.abs(out.primary - 6.0e5) < 1e-9);
  });
});
