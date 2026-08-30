// SPDX-License-Identifier: AGPL-3.0-or-later
import * as assert from "assert";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";
import {
  CvodeFmuDirectSolver,
  CvodeSolver,
  loadSundialsWasm,
  simulateDaeWithSundials,
} from "../src/compiler/simulator/solvers/sundials-wasm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== Testing SUNDIALS Direct In-WASM DAE & FMU Solvers ===");

  const sundialsMod = await loadSundialsWasm();
  assert.ok(sundialsMod, "SUNDIALS WebAssembly module must load successfully");
  console.log("  ✓ SUNDIALS WebAssembly module loaded:", Object.keys(sundialsMod));

  // Compile Modelica runtime parser for DaeBuilder
  const result = buildParser(modelicaLanguage);
  const tmpDir = path.resolve(__dirname, "../build/tmp-sundials-direct-test");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const f of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
  }

  const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
  childProcess.execSync(
    `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
    { cwd: tmpDir, stdio: "inherit" },
  );

  const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
  const imports = {
    env: {
      memory: memory,
      abort: () => {},
      logNode: () => {},
      debugLog: () => {},
    },
    JavaScript: { debugLog: () => {}, logNode: () => {} },
    engine: { debugLog: () => {} },
    parser: { logInt: () => {} },
    recovery: {},
    host: { runHostQuery: () => {} },
  };

  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const wasmExports = instance.exports as any;

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Stiff Van der Pol Oscillator (CVODE BDF)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 1: Stiff Van der Pol Oscillator via CvodeSolver...");
  // dx0/dt = x1
  // dx1/dt = mu * (1 - x0^2) * x1 - x0, mu = 10.0
  const mu = 10.0;
  const vdpRhs = (_t: number, y: Float64Array, ydot: Float64Array): number => {
    const x0 = y[0] ?? 0;
    const x1 = y[1] ?? 0;
    ydot[0] = x1;
    ydot[1] = mu * (1.0 - x0 * x0) * x1 - x0;
    return 0;
  };

  const vdpSolver = new CvodeSolver(sundialsMod, 2, 0.0, [2.0, 0.0], vdpRhs, 0, undefined, {
    atol: 1e-6,
    rtol: 1e-6,
  });

  let t = 0.0;
  let steps = 0;
  while (t < 5.0 - 1e-6 && steps < 1000) {
    const nextT = Math.min(t + 0.1, 5.0);
    const stepRes = vdpSolver.step(nextT);
    assert.strictEqual(stepRes.flag, 0, "CVODE step should succeed");
    t = stepRes.t;
    steps++;
  }
  vdpSolver.dispose();
  assert.ok(t >= 4.99, "Van der Pol simulation should reach t=5.0");
  console.log(`  ✓ Van der Pol integrated to t=${t.toFixed(2)} in ${steps} steps`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Direct In-WASM DaeBuilder CVODE Solver (Zero-Trampoline)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 2: Direct In-WASM DaeBuilder integration via CvodeDaeDirectSolver...");
  const dae = wasmExports.dae_createBuilder();
  assert.ok(dae > 0);

  // Harmonic oscillator in DaeBuilder:
  // x0 (id 0), x1 (id 1)
  // dx0/dt = x1
  // dx1/dt = -x0
  const x0Var = wasmExports.dae_addVariable(dae, 100, 0, 0, 0, 1.0);
  const x1Var = wasmExports.dae_addVariable(dae, 101, 0, 0, 0, 0.0);
  const x0Expr = wasmExports.dae_addExpression(dae, 0, x0Var, 0, 0);
  const x1Expr = wasmExports.dae_addExpression(dae, 0, x1Var, 0, 0);

  // Eq 0: der(x0) = x1
  const eq0Rhs = x1Expr;
  // Eq 1: der(x1) = -x0
  const eq1Rhs = wasmExports.dae_addExpression(dae, 14, 0, x0Expr, 0); // Negate

  const daeSimRes = await simulateDaeWithSundials(
    sundialsMod,
    wasmExports,
    dae,
    [x0Var, x1Var],
    [eq0Rhs, eq1Rhs],
    [1.0, 0.0],
    { startTime: 0.0, stopTime: Math.PI, stepSize: 0.1, atol: 1e-7, rtol: 1e-7 },
  );

  assert.ok(daeSimRes.converged, "Direct In-WASM DAE simulation should converge");
  const trajX0 = daeSimRes.trajectories["x_0"];
  const trajX1 = daeSimRes.trajectories["x_1"];
  assert.ok(trajX0 && trajX1, "Trajectories must be defined");
  const finalX0 = trajX0[trajX0.length - 1] ?? 0;
  const finalX1 = trajX1[trajX1.length - 1] ?? 0;

  // at t = PI, x0(PI) ≈ -1.0, x1(PI) ≈ 0.0
  assert.ok(Math.abs(finalX0 - -1.0) < 1e-3, `Expected x0(PI) ≈ -1.0, got ${finalX0}`);
  assert.ok(Math.abs(finalX1 - 0.0) < 1e-3, `Expected x1(PI) ≈ 0.0, got ${finalX1}`);
  console.log(`  ✓ Harmonic oscillator x0(PI)=${finalX0.toFixed(4)}, x1(PI)=${finalX1.toFixed(4)} passed`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Direct Compiled FMU Simulation via CvodeFmuDirectSolver
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 3: Compiled FMU integration via CvodeFmuDirectSolver...");
  // Mock FMU state object
  const fmuState = [1.0, 0.0];
  const mockFmu = {
    fmiSetTime: (_t: number) => {},
    setContinuousStates: (y: Float64Array) => {
      fmuState[0] = y[0] ?? 0;
      fmuState[1] = y[1] ?? 0;
    },
    getDerivatives: () => {
      // Exponential decay dx0/dt = -0.5*x0
      const state0 = fmuState[0] ?? 0;
      return [-0.5 * state0, 0.0];
    },
  };

  const fmuSolver = new CvodeFmuDirectSolver(sundialsMod, mockFmu, 2, 0.0, [1.0, 0.0], {
    atol: 1e-6,
    rtol: 1e-6,
  });

  const stepFmu = fmuSolver.step(1.0);
  assert.strictEqual(stepFmu.flag, 0);
  // x0(1) = exp(-0.5) ≈ 0.6065
  const expectedExp = Math.exp(-0.5);
  const finalFmuX0 = stepFmu.y[0] ?? 0;
  assert.ok(Math.abs(finalFmuX0 - expectedExp) < 1e-3, `Expected ${expectedExp}, got ${finalFmuX0}`);
  fmuSolver.dispose();
  console.log(`  ✓ Compiled FMU x0(1.0)=${finalFmuX0.toFixed(4)} ≈ exp(-0.5) passed`);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("=== All SUNDIALS Direct In-WASM DAE & FMU Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
