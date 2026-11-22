// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAGICDRAW_MODEL_SPECS,
  createFmuMagicDrawInstance,
  fmuToMagicDrawBlock,
  getMagicDrawSchemasFromLibraries,
  instantiateMagicDrawWasmModel,
  lookupMagicDrawModelSchema,
  registerBuiltInMagicDrawLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/magicdraw-std-lib");

describe("@modelscript/magicdraw — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/magicdraw-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected magicdraw-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/magicdraw-std-lib");
    assert.equal(pkg.manifest.language, "magicdraw");
    assert.equal(pkg.symbols.length, MAGICDRAW_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, MAGICDRAW_MODEL_SPECS.length);
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
    registerBuiltInMagicDrawLibrarySync();
    const schemas = getMagicDrawSchemasFromLibraries();
    assert.ok(schemas.length >= MAGICDRAW_MODEL_SPECS.length);

    assert.equal(lookupMagicDrawModelSchema("Block")?.name, "MD_Block");
    assert.equal(lookupMagicDrawModelSchema("SI::newton")?.name, "SI_Newton");
    assert.equal(lookupMagicDrawModelSchema("QUDV::Unit")?.name, "QUDV_Unit");
    assert.equal(lookupMagicDrawModelSchema("MassRollup")?.name, "CST_RollupPattern");
    assert.equal(lookupMagicDrawModelSchema("ConstraintEvaluator")?.name, "CST_ConstraintEvaluator");
  });

  it("evaluates SI_Newton, QUDV_Unit conversion, CST_RollupPattern, CST_ConstraintEvaluator, and MD_Requirement in runtime.wasm", () => {
    // 1. SI_Newton coherent force scaling (kN -> N: factor = 1000, offset = 0)
    const newton = instantiateMagicDrawWasmModel({
      elementId: "val_thrust",
      modelType: "SI_Newton",
      params: { factor: 1000.0, offset: 0.0 },
    });
    assert.ok(newton, "Expected SI_Newton WASM instance");
    newton.init();
    const thrustOut = newton.eval({ x: 4.5 });
    assert.equal(thrustOut.pass, true);
    assert.ok(Math.abs(thrustOut.value - 4500.0) < 1e-9, `Expected 4500 N, got ${thrustOut.value}`);

    // 2. QUDV_Unit affine temperature conversion (°C -> K: y = 1.0 * x + 273.15)
    const qudvTemp = instantiateMagicDrawWasmModel({
      elementId: "unit_celsius_to_kelvin",
      modelType: "QUDV_Unit",
      params: { factor: 1.0, offset: 273.15 },
    });
    assert.ok(qudvTemp, "Expected QUDV_Unit WASM instance");
    qudvTemp.init();
    const tempOut = qudvTemp.eval({ x: 25.0 });
    assert.equal(tempOut.pass, true);
    assert.ok(Math.abs(tempOut.value - 298.15) < 1e-9, `Expected 298.15 K, got ${tempOut.value}`);

    // 3. CST_RollupPattern mass rollup with 10% contingency margin and 100 kg budget
    const rollup = instantiateMagicDrawWasmModel({
      elementId: "rollup_sat_mass",
      modelType: "CST_RollupPattern",
      params: { ownValue: 12.0, contingencyMarginPct: 10.0, multiplier: 1.0, budgetLimit: 100.0 },
    });
    assert.ok(rollup, "Expected CST_RollupPattern WASM instance");
    rollup.init();
    const rollupPass = rollup.eval({ values: [25.0, 18.0, 15.0, 10.0] });
    // rawTotal = 12 + 25 + 18 + 15 + 10 = 80; with 10% margin = 88 <= 100
    assert.ok(Math.abs(rollupPass.value - 80.0) < 1e-9, `Expected raw rollup 80, got ${rollupPass.value}`);
    assert.ok(Math.abs(rollupPass.tertiary - 88.0) < 1e-9, `Expected margined rollup 88, got ${rollupPass.tertiary}`);
    assert.equal(rollupPass.pass, true);

    const rollupFail = rollup.eval({ values: [40.0, 30.0, 20.0] });
    // rawTotal = 12 + 90 = 102; with 10% margin = 112.2 > 100
    assert.equal(rollupFail.pass, false);

    // 4. CST_ConstraintEvaluator residual check |lhs - rhs| <= tol
    const constraint = instantiateMagicDrawWasmModel({
      elementId: "cst_force_balance",
      modelType: "CST_ConstraintEvaluator",
      params: { tolerance: 1e-3, mode: 0.0 },
    });
    assert.ok(constraint, "Expected CST_ConstraintEvaluator WASM instance");
    constraint.init();
    const eqPass = constraint.eval({ x: 98.1004, rhs: 98.1 });
    assert.equal(eqPass.pass, true);
    assert.ok(eqPass.secondary <= 1e-3);

    const eqFail = constraint.eval({ x: 98.5, rhs: 98.1 });
    assert.equal(eqFail.pass, false);
    assert.ok(Math.abs(eqFail.secondary - 0.4) < 1e-9);

    // 5. MD_Requirement verification margin pass/fail (actual <= 500 W with 10% min margin)
    const req = instantiateMagicDrawWasmModel({
      elementId: "req_power_budget",
      modelType: "MD_Requirement",
      params: { targetLimit: 500.0, comparisonOp: 0.0, tolerance: 1e-6, minMarginPct: 10.0 },
    });
    assert.ok(req, "Expected MD_Requirement WASM instance");
    req.init();
    const reqPass = req.eval({ x: 420.0 });
    assert.equal(reqPass.pass, true);
    assert.ok(Math.abs(reqPass.value - 80.0) < 1e-9);
    assert.ok(Math.abs(reqPass.secondary - 16.0) < 1e-9);

    const reqFailMargin = req.eval({ x: 480.0 }); // 4% margin < 10% required
    assert.equal(reqFailMargin.pass, false);
  });

  it("projects and links an FMI 2.0/3.0 FMU into a Cameo «Block» + «FMU» co-simulation instance", () => {
    const proj = fmuToMagicDrawBlock(
      {
        modelName: "ThermalControllerFmu",
        fmiVersion: "2.0",
        variables: [
          { name: "kp", causality: "parameter", type: "Real", valueReference: 1, start: 2.5 },
          { name: "tempErr", causality: "input", type: "Real", valueReference: 2, unit: "K" },
          { name: "heaterPower", causality: "output", type: "Real", valueReference: 3, unit: "W" },
        ],
      },
      "blk_thermal_fmu",
    );
    assert.ok(proj.xmiBlockFragment.includes("ThermalControllerFmu"));
    assert.ok(proj.xmiBlockFragment.includes("CST:FMU"));
    assert.deepEqual(proj.parameterNames, ["kp"]);
    assert.deepEqual(proj.inputNames, ["tempErr"]);
    assert.deepEqual(proj.outputNames, ["heaterPower"]);

    const fmuInst = createFmuMagicDrawInstance("blk_thermal_fmu", proj.modelName, (io) => ({
      value: 2.5 * (io.x ?? 0),
      pass: (io.x ?? 0) >= 0,
    }));
    fmuInst.init();
    const out = fmuInst.eval({ x: 12.0 }, 0.1, 0.01);
    assert.ok(Math.abs(out.value - 30.0) < 1e-9);
    assert.equal(out.pass, true);
    assert.equal(out.evalCount, 1);
  });

  it("executes CST_MonteCarloConfig Welford online mean/variance and CST_SimulationConfig SysML StateMachine & Activity steps", () => {
    // 1. CST_MonteCarloConfig Welford online mean, sample stddev, and sample variance
    const mc = instantiateMagicDrawWasmModel({
      elementId: "mc_mass_sweep",
      modelType: "CST_MonteCarloConfig",
      params: { startTime: 0.0, stopTime: 100.0, stepSize: 1.0, sampleCount: 5 },
    });
    assert.ok(mc, "Expected CST_MonteCarloConfig WASM instance");
    mc.init();

    const samples = [10.0, 12.0, 14.0, 16.0, 18.0];
    let mcOut = mc.eval({ x: samples[0]! }, 0.0, 1.0);
    for (let i = 1; i < samples.length; i++) {
      mcOut = mc.eval({ x: samples[i]! }, i * 1.0, 1.0);
    }
    // Exact mean = 14, sample variance = ((16+4+0+4+16)/4) = 10, sample stddev = sqrt(10)
    assert.ok(Math.abs(mcOut.value - 14.0) < 1e-12, `Expected Welford mean=14, got ${mcOut.value}`);
    assert.ok(Math.abs(mcOut.tertiary - 10.0) < 1e-12, `Expected Welford variance=10, got ${mcOut.tertiary}`);
    assert.ok(
      Math.abs(mcOut.secondary - Math.sqrt(10.0)) < 1e-12,
      `Expected Welford stddev=${Math.sqrt(10)}, got ${mcOut.secondary}`,
    );
    assert.equal(mcOut.evalCount, 5);

    // 2. CST_SimulationConfig SysML StateMachine & Activity execution step (execMode = 1)
    // Transitions:
    //   0 (Idle) -> 1 (Active) on event=1 with guard x > 300 (op=1)
    //   1 (Active) -> 2 (Fault) on wildcard (-1) with guard x >= 400 (op=2)
    //   2 (Fault) -> 0 (Idle) on event=2 with guard x <= 320 (op=4)
    const sm = instantiateMagicDrawWasmModel({
      elementId: "sm_thermal_controller",
      modelType: "CST_SimulationConfig",
      params: [
        0.0,
        10.0,
        0.1,
        100.0, // CON[0..3]: startTime, stopTime, stepSize, sampleCount
        1.0,
        0.0,
        3.0, // CON[4]=execMode(1=StateMachine), CON[5]=initialState(0), CON[6]=nTransitions(3)
        0.0,
        1.0,
        1.0,
        300.0,
        1.0,
        1.0,
        -1.0,
        2.0,
        400.0,
        2.0,
        2.0,
        2.0,
        4.0,
        320.0,
        0.0,
      ],
    });
    assert.ok(sm, "Expected CST_SimulationConfig StateMachine WASM instance");
    assert.equal(sm.init(), 7);

    // Step 1: event=1 but guard x=290 fails (> 300) -> remains in state 0
    const s1 = sm.eval({ x: 290.0, rhs: 1.0 }, 0.1, 0.1);
    assert.equal(s1.value, 0);
    assert.equal(s1.statusCode, 0);
    assert.equal(s1.secondary, 0);
    assert.equal(s1.tertiary, 1);

    // Step 2: event=1 and guard x=310 passes -> transitions 0 -> 1
    const s2 = sm.eval({ x: 310.0, rhs: 1.0 }, 0.2, 0.1);
    assert.equal(s2.value, 1);
    assert.equal(s2.statusCode, 1);
    assert.equal(s2.secondary, 1);
    assert.equal(s2.tertiary, 2);

    // Step 3: wildcard over-temp x=410 >= 400 -> transitions 1 -> 2
    const s3 = sm.eval({ x: 410.0, rhs: 0.0 }, 0.3, 0.1);
    assert.equal(s3.value, 2);
    assert.equal(s3.statusCode, 1);
    assert.equal(s3.secondary, 2);
    assert.equal(s3.tertiary, 3);

    // Step 4: reset event=2 with x=305 <= 320 -> transitions 2 -> 0
    const s4 = sm.eval({ x: 305.0, rhs: 2.0 }, 0.4, 0.1);
    assert.equal(s4.value, 0);
    assert.equal(s4.statusCode, 1);
    assert.equal(s4.secondary, 3);
    assert.equal(s4.tertiary, 4);
  });
});
