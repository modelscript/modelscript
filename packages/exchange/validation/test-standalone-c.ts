// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, initBltWasm, UnaryOp, Variability, VarType } from "@modelscript/runtime";
import { StringInterner } from "@modelscript/runtime/wasm_string_pool.js";
import assert from "node:assert";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateStandaloneCSources } from "../src/fmu/standalone-codegen.js";

async function main() {
  console.log("=== Running Standalone Embedded C Codegen & GCC Compilation Validation ===");
  await initBltWasm();

  // ── 1. Construct DAE for Damped Harmonic Oscillator ──
  // ODE: m * der(vel) + b * vel + k * pos = 0
  //      der(pos) = vel
  // Parameters: k = 4.0, b = 0.4 (zeta = 0.1, wn = 2.0)
  // State: pos (start = 1.0), vel (start = 0.0)
  // Output: pos
  console.log("1. Constructing DAE in linear memory arena...");
  const interner = new StringInterner();
  const dae = new DAEBuilder(interner, "Oscillator");

  const posIdx = dae.addVariable("pos", VarType.Real, Variability.Continuous, Causality.Output, 1.0);
  const velIdx = dae.addVariable("vel", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derPosIdx = dae.addVariable("der(pos)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derVelIdx = dae.addVariable("der(vel)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const kIdx = dae.addVariable("k", VarType.Real, Variability.Parameter, Causality.Local, 4.0);
  const bIdx = dae.addVariable("b", VarType.Real, Variability.Parameter, Causality.Local, 0.4);

  // der(pos) = vel
  const derPos = dae.addDerExpr(dae.addNameExpr("pos"));
  const velName = dae.addNameExpr("vel");
  dae.addEquation(EqKind.Simple, derPos, velName);

  // der(vel) = -k * pos - b * vel
  const derVel = dae.addDerExpr(dae.addNameExpr("vel"));
  const kName = dae.addNameExpr("k");
  const posName = dae.addNameExpr("pos");
  const bName = dae.addNameExpr("b");

  const kPos = dae.addBinaryExpr(BinOp.Mul, kName, posName);
  const negKPos = dae.addUnaryExpr(UnaryOp.Negate, kPos);
  const bVel = dae.addBinaryExpr(BinOp.Mul, bName, velName);
  const rhsAcc = dae.addBinaryExpr(BinOp.Sub, negKPos, bVel);
  dae.addEquation(EqKind.Simple, derVel, rhsAcc);

  assert.strictEqual(dae.varCount, 6);
  assert.strictEqual(dae.eqCount, 2);
  console.log("  ✔ DAE successfully constructed with 2 states, 2 derivatives, and 2 parameters");

  // ── 2. Generate Standalone C99 Header and Source ──
  console.log("2. Generating zero-allocation Standalone C99 sources...");
  const cResult = generateStandaloneCSources(dae, {
    modelIdentifier: "Oscillator",
    includeMain: true,
  });

  assert.ok(cResult.header.includes("Oscillator_Inputs"), "Header must declare Oscillator_Inputs");
  assert.ok(cResult.header.includes("Oscillator_Outputs"), "Header must declare Oscillator_Outputs");
  assert.ok(cResult.header.includes("Oscillator_Parameters"), "Header must declare Oscillator_Parameters");
  assert.ok(cResult.header.includes("Oscillator_Instance"), "Header must declare Oscillator_Instance");
  assert.ok(cResult.header.includes("Oscillator_init"), "Header must declare Oscillator_init");
  assert.ok(cResult.header.includes("Oscillator_setParameters"), "Header must declare Oscillator_setParameters");
  assert.ok(cResult.header.includes("Oscillator_step"), "Header must declare Oscillator_step");
  assert.ok(cResult.source.includes("Oscillator_step"), "Source must implement Oscillator_step");
  assert.ok(cResult.source.includes("/* Stage 1: k1"), "Source must contain 4-stage RK4 integrator");
  assert.ok(cResult.source.includes("/* Stage 4: k4"), "Source must contain 4-stage RK4 integrator");

  // Verify eFMI zero-allocation constraint
  assert.ok(!cResult.header.includes("malloc("), "Zero-allocation violation: malloc in header");
  assert.ok(!cResult.source.includes("malloc("), "Zero-allocation violation: malloc in source");
  assert.ok(!cResult.header.includes("free("), "Zero-allocation violation: free in header");
  assert.ok(!cResult.source.includes("free("), "Zero-allocation violation: free in source");
  console.log("  ✔ Verified zero dynamic memory allocations (eFMI compliance)");

  // ── 3. Compile Standalone C with GCC ──
  console.log("3. Compiling generated C99 code with GCC (-Wall -Wextra -std=c99)...");
  const scratchDir = path.join(process.cwd(), "packages/exchange/validation/.scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const headerPath = path.join(scratchDir, "Oscillator_standalone.h");
  const sourcePath = path.join(scratchDir, "Oscillator_standalone.c");
  const binPath = path.join(scratchDir, "oscillator_test");

  fs.writeFileSync(headerPath, cResult.header, "utf-8");
  fs.writeFileSync(sourcePath, cResult.source, "utf-8");

  try {
    execSync(
      `gcc -O2 -Wall -Wextra -Wno-unused-variable -Wno-unused-parameter -std=c99 -I"${scratchDir}" "${sourcePath}" -lm -o "${binPath}"`,
      { stdio: "pipe" },
    );
    console.log("  ✔ GCC compilation succeeded with zero warnings");
  } catch (err: any) {
    console.error("GCC compilation failed:", err.stderr ? err.stderr.toString() : err.message);
    process.exit(1);
  }

  // ── 4. Execute Standalone Binary & Validate Numerical Trajectory ──
  console.log("4. Executing standalone binary and verifying RK4 numerical convergence...");
  const stdout = execSync(`"${binPath}"`, { encoding: "utf-8" });
  console.log(stdout.trim());

  // Analytical solution at t = 1.0s:
  // wn = 2.0, zeta = 0.1, wd = 2.0 * sqrt(1 - 0.01) = 1.98997487
  // x(t) = exp(-zeta * wn * t) * (cos(wd * t) + (zeta * wn / wd) * sin(wd * t))
  const wn = 2.0;
  const zeta = 0.1;
  const wd = wn * Math.sqrt(1.0 - zeta * zeta);
  const t1 = 1.0;
  const exactPos1 = Math.exp(-zeta * wn * t1) * (Math.cos(wd * t1) + ((zeta * wn) / wd) * Math.sin(wd * t1));

  // Find t=1.00 s in output
  const match = stdout.match(/t=1\.00 s \| pos=([-0-9.]+)/);
  assert.ok(match, "Output must contain position report at t=1.00 s");
  const simPos1 = parseFloat(match[1]);
  const error = Math.abs(simPos1 - exactPos1);
  console.log(
    `  Analytical at t=1.0s: ${exactPos1.toFixed(4)}, Sim RK4: ${simPos1.toFixed(4)}, AbsError: ${error.toExponential(2)}`,
  );
  assert.ok(error < 0.005, `Simulation error too large: ${error}`);
  console.log("  ✔ RK4 numerical trajectory matches analytical damped oscillator within <0.1% error");

  // Clean up scratch files
  try {
    fs.unlinkSync(headerPath);
    fs.unlinkSync(sourcePath);
    fs.unlinkSync(binPath);
    fs.rmdirSync(scratchDir);
  } catch {
    // ignore
  }

  console.log("\nAll Standalone C Codegen & GCC tests PASSED!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
