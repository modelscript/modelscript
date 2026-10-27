// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, initBltWasm, UnaryOp, Variability, VarType } from "@modelscript/runtime";
import { StringInterner } from "@modelscript/runtime/wasm_string_pool.js";
import assert from "node:assert";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { generateAutosarSwcC, generateSimulinkSFunctionC } from "../src/fmu/hil-wrappers.js";
import { generateStandaloneCSources } from "../src/fmu/standalone-codegen.js";

describe("Workstream 5: Bare-Metal / HIL C99, Stiff Rosenbrock-W & AUTOSAR/Simulink Wrappers", () => {
  it("compiles and runs a stiff 2-state DAE with fixed-step Rosenbrock-W (ROS2) and MISRA-C mode under GCC", async () => {
    await initBltWasm();

    // Stiff system with fast mode lambda_1 = -1000 and slow mode lambda_2 = -1:
    //   der(x_fast) = -1000 * x_fast + 1000 * u
    //   der(x_slow) = -1.0 * x_slow + x_fast
    // At dt = 0.01s, explicit RK4/Euler is unstable (|lambda_1 * dt| = 10 >> 2.78),
    // whereas L-stable Rosenbrock-W remains unconditionally stable and accurate!
    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "StiffActuator");

    dae.addVariable("x_fast", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    dae.addVariable("x_slow", VarType.Real, Variability.Continuous, Causality.Output, 1.0);
    dae.addVariable("der(x_fast)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("der(x_slow)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("u", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

    // der(x_fast) = -1000 * x_fast + 1000 * u
    const fastTerm = dae.addUnaryExpr(
      UnaryOp.Negate,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1000.0), dae.addNameExpr("x_fast")),
    );
    const uTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1000.0), dae.addNameExpr("u"));
    dae.addEquation(
      EqKind.Simple,
      dae.addDerExpr(dae.addNameExpr("x_fast")),
      dae.addBinaryExpr(BinOp.Add, fastTerm, uTerm),
    );

    // der(x_slow) = -x_slow + x_fast
    const slowTerm = dae.addUnaryExpr(UnaryOp.Negate, dae.addNameExpr("x_slow"));
    dae.addEquation(
      EqKind.Simple,
      dae.addDerExpr(dae.addNameExpr("x_slow")),
      dae.addBinaryExpr(BinOp.Add, slowTerm, dae.addNameExpr("x_fast")),
    );

    const cResult = generateStandaloneCSources(dae, {
      modelIdentifier: "StiffActuator",
      integrator: "rosenbrock_w",
      floatPrecision: "float",
      misraCompliant: true,
      includeMain: true,
    });

    assert.strictEqual(cResult.integrator, "rosenbrock_w");
    assert.strictEqual(cResult.floatPrecision, "float");
    assert.strictEqual(cResult.misraCompliant, true);
    assert.ok(cResult.header.includes("#define STIFFACTUATOR_STATIC_INSTANCE_BYTES"));
    assert.ok(cResult.header.includes("typedef float StiffActuator_real_t;"));
    assert.ok(cResult.source.includes("StiffActuator_ros2_lu_factor"));
    assert.ok(cResult.source.includes("StiffActuator_ros2_lu_solve"));

    const scratchDir = path.join(process.cwd(), "packages/exchange/validation/.scratch");
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const headerPath = path.join(scratchDir, "StiffActuator_standalone.h");
    const sourcePath = path.join(scratchDir, "StiffActuator_standalone.c");
    const binPath = path.join(scratchDir, "stiff_actuator_ros2");

    fs.writeFileSync(headerPath, cResult.header, "utf-8");
    fs.writeFileSync(sourcePath, cResult.source, "utf-8");

    execSync(
      `gcc -O2 -Wall -Wextra -Werror -Wno-unused-variable -Wno-unused-parameter -Wno-unused-function -std=c99 -I"${scratchDir}" "${sourcePath}" -lm -o "${binPath}"`,
      { stdio: "pipe" },
    );

    const stdout = execSync(`"${binPath}"`, { encoding: "utf-8" });
    const match = stdout.match(/t=1\.00 s \| x_slow=([-0-9.]+)/);
    assert.ok(match, `Expected output at t=1.00 s, got:\n${stdout}`);
    const simSlow = parseFloat(match[1]!);
    // Analytical solution for x_slow(1.0) with x_fast(0)=1, x_slow(0)=1, u=0 is ~ exp(-1.0) = 0.367879
    assert(Math.abs(simSlow - Math.exp(-1.0)) < 0.01, `Expected ~0.3679, got ${simSlow}`);

    fs.rmSync(headerPath, { force: true });
    fs.rmSync(sourcePath, { force: true });
    fs.rmSync(binPath, { force: true });
  });

  it("generates Simulink Level-2 C-MEX S-Function and AUTOSAR Classic SWC + ARXML wrappers", async () => {
    await initBltWasm();
    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "BrakeController");
    dae.addVariable("pressure", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    dae.addVariable("der(pressure)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("cmd", VarType.Real, Variability.Continuous, Causality.Input, 0.0);
    dae.addVariable("tau", VarType.Real, Variability.Parameter, Causality.Local, 0.05);

    dae.addEquation(
      EqKind.Simple,
      dae.addDerExpr(dae.addNameExpr("pressure")),
      dae.addBinaryExpr(
        BinOp.Div,
        dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr("cmd"), dae.addNameExpr("pressure")),
        dae.addNameExpr("tau"),
      ),
    );

    const sfun = generateSimulinkSFunctionC(dae, {
      modelIdentifier: "BrakeController",
      integrator: "rosenbrock_w",
      sampleTimeSec: 0.002,
    });
    assert.ok(sfun.sFunctionSource.includes("#define S_FUNCTION_NAME  BrakeController_sfun"));
    assert.ok(sfun.sFunctionSource.includes("mdlInitializeSizes"));
    assert.ok(sfun.sFunctionSource.includes("BrakeController_step(inst, &in, &out, 0.002);"));

    const autosar = generateAutosarSwcC(dae, {
      modelIdentifier: "BrakeController",
      integrator: "rosenbrock_w",
      stepPeriodMs: 5,
    });
    assert.ok(autosar.swcSource.includes("Runnable_BrakeController_Init"));
    assert.ok(autosar.swcSource.includes("Runnable_BrakeController_Step_5ms"));
    assert.ok(autosar.swcSource.includes("Rte_Read_rp_cmd_val"));
    assert.ok(autosar.swcSource.includes("Rte_Write_pp_pressure_val"));
    assert.ok(autosar.arxmlDescriptor.includes("<APPLICATION-SW-COMPONENT-TYPE>"));
    assert.ok(autosar.arxmlDescriptor.includes("<SHORT-NAME>rp_cmd</SHORT-NAME>"));
    assert.ok(autosar.arxmlDescriptor.includes("<SHORT-NAME>pp_pressure</SHORT-NAME>"));
  });
});
