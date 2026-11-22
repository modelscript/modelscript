// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SIMPACK_MODEL_SPECS,
  createFmuSimpackInstance,
  fmuToSimpackElement,
  getSimpackSchemasFromLibraries,
  instantiateSimpackWasmModel,
  lookupSimpackModelSchema,
  registerBuiltInSimpackLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/simpack-std-lib");

describe("@modelscript/simpack — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/simpack-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected simpack-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/simpack-std-lib");
    assert.equal(pkg.manifest.language, "simpack");
    assert.equal(pkg.symbols.length, SIMPACK_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, SIMPACK_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance metadata on every registered model
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
    registerBuiltInSimpackLibrarySync();
    const schemas = getSimpackSchemasFromLibraries();
    assert.ok(schemas.length >= SIMPACK_MODEL_SPECS.length);

    assert.equal(lookupSimpackModelSchema("$F_PtP_SpringDamper")?.name, "$F_PtP_SpringDamper");
    assert.equal(lookupSimpackModelSchema("FE5")?.name, "$F_PtP_SpringDamper");
    assert.equal(lookupSimpackModelSchema("polach")?.name, "$R_WheelRail_Polach");
    assert.equal(lookupSimpackModelSchema("MagicFormula")?.name, "$T_Pacejka_MF");
    assert.equal(lookupSimpackModelSchema("S1002")?.name, "$R_Wheel_S1002");
    assert.equal(lookupSimpackModelSchema("UIC60")?.name, "$R_Track_UIC60");
  });

  it("evaluates core force, wheel-rail, and tire models in runtime.wasm", () => {
    // 1. Point-to-Point Spring-Damper ($F_PtP_SpringDamper): F = f0 + k*(disp - l0) + c*vel
    const sd = instantiateSimpackWasmModel("$F_PtP_SpringDamper", {
      k: 10000,
      c: 500,
      l0: 0.0,
      f0: 100,
      k3: 0.0,
    });
    assert.ok(sd, "Expected $F_PtP_SpringDamper WASM instance");
    sd.init();
    const sdOut = sd.eval(0.01, 0.01, { disp: 0.1, vel: 0.5 });
    // Expected: 100 + 10000*0.1 + 500*0.5 = 1350 N
    assert.ok(Math.abs(sdOut.fx - 1350.0) < 1e-6, `Expected fx=1350 N, got ${sdOut.fx}`);
    assert.ok(Math.abs(sdOut.stiffnessEff - 10000.0) < 1e-6, `Expected kEff=10000 N/m, got ${sdOut.stiffnessEff}`);
    assert.ok(Math.abs(sdOut.powerLoss - 125.0) < 1e-6, `Expected powerLoss=125 W, got ${sdOut.powerLoss}`);

    // 2. Polach Nonlinear Wheel-Rail Creep Force ($R_WheelRail_Polach)
    const polach = instantiateSimpackWasmModel("$R_WheelRail_Polach");
    assert.ok(polach, "Expected $R_WheelRail_Polach WASM instance");
    polach.init();
    const fn = 80000; // 80 kN wheel load
    const lowSlip = polach.eval(0.01, 0.01, { disp: 0.002, vel: 0.0, normalLoad: fn, aux2: 30.0 });
    const midSlip = polach.eval(0.02, 0.01, { disp: 0.015, vel: 0.0, normalLoad: fn, aux2: 30.0 });
    const highSlip = polach.eval(0.03, 0.01, { disp: 0.25, vel: 0.0, normalLoad: fn, aux2: 30.0 });

    assert.ok(lowSlip.fx < 0, `Expected creep force opposing positive creepage, got ${lowSlip.fx}`);
    assert.ok(
      Math.abs(midSlip.fx) > Math.abs(lowSlip.fx),
      `Expected larger creep force at 1.5% creep vs 0.2% creep: ${midSlip.fx} vs ${lowSlip.fx}`,
    );
    // Polach variable friction falls at very high slip velocity (w = 0.25 * 30 = 7.5 m/s)
    assert.ok(
      Math.abs(highSlip.fx) < Math.abs(midSlip.fx),
      `Expected Polach falling friction at high slip: |${highSlip.fx}| < |${midSlip.fx}|`,
    );
    assert.ok(Math.abs(midSlip.fx) <= 0.4 * fn + 1e-3, "Creep force must not exceed mu0 * Fn");

    // 3. Pacejka Magic Formula Tire ($T_Pacejka_MF)
    const tire = instantiateSimpackWasmModel("$T_Pacejka_MF");
    assert.ok(tire, "Expected $T_Pacejka_MF WASM instance");
    tire.init();
    const fz = 4500; // 4.5 kN vertical load
    const pureLat = tire.eval(0.01, 0.01, { disp: 0.0, vel: 0.08, normalLoad: fz, aux2: 20.0 });
    const pureLong = tire.eval(0.02, 0.01, { disp: 0.1, vel: 0.0, normalLoad: fz, aux2: 20.0 });
    assert.ok(pureLat.fy < -2000, `Expected strong negative lateral force for positive slip angle, got ${pureLat.fy}`);
    assert.ok(pureLat.tz > 0, `Expected positive self-aligning torque Mz, got ${pureLat.tz}`);
    assert.ok(pureLong.fx > 3000, `Expected strong positive longitudinal force at kappa=0.1, got ${pureLong.fx}`);

    // 4. Nonlinear Progressive Bumpstop ($F_Cmp_Bumpstop)
    const bump = instantiateSimpackWasmModel("$F_Cmp_Bumpstop", {
      clearance: 0.03,
      kLin: 50000,
      kExp: 2.5e7,
      expN: 2.5,
      c: 3000,
    });
    assert.ok(bump, "Expected $F_Cmp_Bumpstop WASM instance");
    bump.init();
    const inGap = bump.eval(0.01, 0.01, { disp: 0.02, vel: 0.5 });
    assert.equal(inGap.fx, 0, "Expected zero bumpstop force inside clearance gap");
    assert.equal(inGap.stiffnessEff, 0, "Expected zero bumpstop stiffness inside clearance gap");

    const penSmall = bump.eval(0.02, 0.01, { disp: 0.04, vel: 0.0 }); // 10 mm penetration
    const penLarge = bump.eval(0.03, 0.01, { disp: 0.05, vel: 0.0 }); // 20 mm penetration
    assert.ok(penSmall.fx > 500, `Expected positive contact force beyond clearance, got ${penSmall.fx}`);
    assert.ok(
      penLarge.fx > 2.5 * penSmall.fx,
      `Expected super-linear progressive stiffening: ${penLarge.fx} vs ${penSmall.fx}`,
    );

    // 5. Stribeck Friction ($F_Cmp_Friction) & Polytropic Air Spring ($F_Cmp_AirSpring)
    const fric = instantiateSimpackWasmModel("$F_Cmp_Friction");
    assert.ok(fric, "Expected $F_Cmp_Friction WASM instance");
    const fricLowV = fric.eval(0.01, 0.01, { vel: 0.01, normalLoad: 1000 });
    const fricHighV = fric.eval(0.02, 0.01, { vel: 0.3, normalLoad: 1000 });
    assert.ok(fricLowV.fx < 0 && fricHighV.fx < 0, "Friction must oppose positive velocity");
    assert.ok(fricLowV.stiffnessEff > fricHighV.stiffnessEff, "Stribeck mu_eff should drop from static to kinetic");

    const air = instantiateSimpackWasmModel("$F_Cmp_AirSpring");
    assert.ok(air, "Expected $F_Cmp_AirSpring WASM instance");
    const airNominal = air.eval(0.01, 0.01, { disp: 0.0, vel: 0.0 });
    const airCompressed = air.eval(0.02, 0.01, { disp: 0.04, vel: 0.0 });
    assert.ok(airCompressed.fx > airNominal.fx, "Compressing air spring must increase force");
    assert.ok(
      airCompressed.stiffnessEff > airNominal.stiffnessEff,
      "Polytropic stiffness must increase on compression",
    );
  });

  it("evaluates cleanroom Kalker FASTSIM 2D contact patch discretization ($R_WheelRail_Kalker)", () => {
    const kalker = instantiateSimpackWasmModel("$R_WheelRail_Kalker", {
      mu: 0.35,
      a: 0.006,
      b: 0.0045,
      G: 8.1e10,
      c11: 4.12,
      c22: 3.67,
      c23: 1.47,
    });
    assert.ok(kalker, "Expected $R_WheelRail_Kalker WASM instance");
    kalker.init();

    const fn = 80000.0;
    const fMax = 0.35 * fn;

    // 1. Small-creepage linear regime matches Kalker linear theory Fx ~ -G * a * b * c11 * xi_x
    const xiSmall = 1e-4;
    const linOut = kalker.eval(0.01, 0.01, { disp: xiSmall, vel: 0.0, normalLoad: fn, aux1: 0.0, aux2: 25.0 });
    const expectedLinFx = -8.1e10 * 0.006 * 0.0045 * 4.12 * xiSmall;
    assert.ok(
      Math.abs(linOut.fx - expectedLinFx) / Math.abs(expectedLinFx) < 0.05,
      `Expected FASTSIM linear Fx ~ ${expectedLinFx}, got ${linOut.fx}`,
    );

    // 2. High-creepage Coulomb saturation |Fx| -> mu * Fn
    const satOut = kalker.eval(0.02, 0.01, { disp: 0.05, vel: 0.0, normalLoad: fn, aux1: 0.0, aux2: 25.0 });
    assert.ok(satOut.fx < 0, `Expected negative longitudinal creep force, got ${satOut.fx}`);
    assert.ok(
      Math.abs(satOut.fx) > 0.9 * fMax && Math.abs(satOut.fx) <= fMax + 1e-6,
      `Expected FASTSIM Coulomb saturation near ${fMax} N, got ${Math.abs(satOut.fx)} N`,
    );

    // 3. Pure spin creepage generates opposing lateral force Fy < 0 and spin moment Mz < 0
    const spinOut = kalker.eval(0.03, 0.01, { disp: 0.0, vel: 0.0, normalLoad: fn, aux1: 0.5, aux2: 25.0 });
    assert.ok(spinOut.fy < -100.0, `Expected resisting lateral force from positive spin, got ${spinOut.fy}`);
    assert.ok(spinOut.tz < 0.0, `Expected opposing spin moment Mz < 0 for positive spin, got ${spinOut.tz}`);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU as a SIMPACK co-simulation element", () => {
    const proj = fmuToSimpackElement(
      {
        modelName: "ActiveDamperFmu",
        variables: [
          { name: "cSkyhook", causality: "parameter", type: "Real", valueReference: 1, start: 4200 },
          { name: "vel", causality: "input", type: "Real", valueReference: 2 },
          { name: "fx", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "$F_Skyhook_FL",
      "$M_Chassis_FL",
      "$M_Wheel_FL",
    );
    assert.ok(proj.spckBlock.includes("$F_FMU_CoSim"));
    assert.ok(proj.spckBlock.includes("ActiveDamperFmu"));
    assert.deepEqual(proj.parameterNames, ["cSkyhook"]);

    const fmuInst = createFmuSimpackInstance("$F_Skyhook_FL", proj.modelName, (_t, _dt, io) => ({
      fx: -4200 * (io.vel ?? 0),
    }));
    const out = fmuInst.eval(0.01, 0.01, { vel: 0.25 });
    assert.ok(Math.abs(out.fx - -1050.0) < 1e-9);
  });
});
