// SPDX-License-Identifier: AGPL-3.0-or-later
import * as assert from "assert";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";
import { SolversBridge } from "../src/runtime/solvers_bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== Testing WASM Forward-Mode Dual AD Engine ===");

  const result = buildParser(modelicaLanguage);
  const tmpDir = path.resolve(__dirname, "../build/tmp-wasm-dual-ad-test");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const f of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
  }
  fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

  const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
  console.log("Compiling WebAssembly with asc...");
  childProcess.execSync(
    `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
    { cwd: tmpDir, stdio: "inherit" },
  );

  const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
  const imports = {
    env: {
      memory: memory,
      abort: (msg: number, file: number, line: number, col: number) => {
        console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`);
      },
      logNode: () => {},
      debugLog: () => {},
    },
    JavaScript: {
      debugLog: () => {},
      logNode: () => {},
    },
    engine: {
      debugLog: () => {},
    },
    parser: { logInt: () => {} },
    recovery: {},
    host: { runHostQuery: () => {} },
  };

  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const wasmExports = instance.exports as any;
  const bridge = new SolversBridge(memory, wasmExports);

  console.log("Checking exported WASM dual functions...");
  assert.strictEqual(typeof wasmExports.dae_evalDualExpr, "function", "dae_evalDualExpr must be exported");
  assert.strictEqual(
    typeof wasmExports.dae_evalDualEquationResidual,
    "function",
    "dae_evalDualEquationResidual must be exported",
  );
  assert.strictEqual(
    typeof wasmExports.dae_evalDualJacobianColumn,
    "function",
    "dae_evalDualJacobianColumn must be exported",
  );

  const dae = wasmExports.dae_createBuilder();
  assert.ok(dae > 0, "dae_createBuilder should return valid pointer");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Polynomial expressions
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 1: Polynomial expression evaluation with exact derivatives...");
  const xVar = wasmExports.dae_addVariable(dae, 100, 0, 0, 0, 2.0); // Real, Continuous, Local
  const xExpr = wasmExports.dae_addExpression(dae, 0, xVar, 0, 0); // ExprKind.Name

  // f(x) = x^2 + 3*x + 5
  // at x = 2.0: f(2) = 4 + 6 + 5 = 15, f'(2) = 2*x + 3 = 7
  const xSq = wasmExports.dae_addExpression(dae, 5, 2, xExpr, xExpr); // Mul(x, x)
  const c3 = wasmExports.dae_addRealLiteral(dae, 3.0);
  const threeX = wasmExports.dae_addExpression(dae, 5, 2, c3, xExpr); // Mul(3, x)
  const xSqPlus3X = wasmExports.dae_addExpression(dae, 5, 0, xSq, threeX); // Add
  const c5 = wasmExports.dae_addRealLiteral(dae, 5.0);
  const polyExpr = wasmExports.dae_addExpression(dae, 5, 0, xSqPlus3X, c5); // Add 5

  const dualVarsPoly = new Float64Array([2.0, 1.0]);
  const resPoly = bridge.evalDualExpr(dae, polyExpr, dualVarsPoly);

  assert.ok(Math.abs(resPoly.val - 15.0) < 1e-6, `Expected 15.0, got ${resPoly.val}`);
  assert.ok(Math.abs(resPoly.dot - 7.0) < 1e-6, `Expected 7.0, got ${resPoly.dot}`);
  console.log("  ✓ f(2) = 15.0, f'(2) = 7.0 passed");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Transcendental and trigonometric functions
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 2: Transcendental and trigonometric functions (sin * exp)...");
  // f(x) = sin(x) * exp(x)
  // BuiltinMathFunc.Sin = 0, BuiltinMathFunc.Exp = 10
  const sinExpr = wasmExports.dae_addExpression(dae, 7, 0, xExpr, 0); // Call sin(x)
  const expExpr = wasmExports.dae_addExpression(dae, 7, 10, xExpr, 0); // Call exp(x)
  const mulTrans = wasmExports.dae_addExpression(dae, 5, 2, sinExpr, expExpr); // Mul(sin, exp)

  const dualVars0 = new Float64Array([0.0, 1.0]);
  const res0 = bridge.evalDualExpr(dae, mulTrans, dualVars0);
  assert.ok(Math.abs(res0.val - 0.0) < 1e-6, `Expected 0.0, got ${res0.val}`);
  assert.ok(Math.abs(res0.dot - 1.0) < 1e-6, `Expected 1.0, got ${res0.dot}`);
  console.log("  ✓ f(0) = 0.0, f'(0) = 1.0 passed");

  const xVal = Math.PI / 4;
  const dualVarsPi4 = new Float64Array([xVal, 1.0]);
  const resPi4 = bridge.evalDualExpr(dae, mulTrans, dualVarsPi4);
  const expectedVal = Math.sin(xVal) * Math.exp(xVal);
  const expectedDot = (Math.cos(xVal) + Math.sin(xVal)) * Math.exp(xVal);
  assert.ok(Math.abs(resPi4.val - expectedVal) < 1e-6, `Expected ${expectedVal}, got ${resPi4.val}`);
  assert.ok(Math.abs(resPi4.dot - expectedDot) < 1e-6, `Expected ${expectedDot}, got ${resPi4.dot}`);
  console.log(`  ✓ f(PI/4) = ${resPi4.val.toFixed(4)}, f'(PI/4) = ${resPi4.dot.toFixed(4)} passed`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Quotients, roots, and multi-variable partial derivatives
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 3: Quotients, roots, and multi-variable partials...");
  const yVar = wasmExports.dae_addVariable(dae, 101, 0, 0, 0, 2.0);
  const yExpr = wasmExports.dae_addExpression(dae, 0, yVar, 0, 0);

  // f(x, y) = x / y + sqrt(x)
  // at x = 4.0, y = 2.0:
  // df/dx = 1/y + 1/(2*sqrt(x)) = 1/2 + 1/4 = 0.75
  // df/dy = -x / y^2 = -4 / 4 = -1.0
  const divExpr = wasmExports.dae_addExpression(dae, 5, 3, xExpr, yExpr); // Div(x, y)
  const sqrtExpr = wasmExports.dae_addExpression(dae, 7, 13, xExpr, 0); // Sqrt(x) (13)
  const fMulti = wasmExports.dae_addExpression(dae, 5, 0, divExpr, sqrtExpr);

  // Differentiate w.r.t x (dx = 1, dy = 0)
  const dualVarsWrtX = new Float64Array([4.0, 1.0, 2.0, 0.0]);
  const resX = bridge.evalDualExpr(dae, fMulti, dualVarsWrtX);
  assert.ok(Math.abs(resX.val - 4.0) < 1e-6, `Expected 4.0, got ${resX.val}`);
  assert.ok(Math.abs(resX.dot - 0.75) < 1e-6, `Expected 0.75, got ${resX.dot}`);
  console.log("  ✓ df/dx = 0.75 passed");

  // Differentiate w.r.t y (dx = 0, dy = 1)
  const dualVarsWrtY = new Float64Array([4.0, 0.0, 2.0, 1.0]);
  const resY = bridge.evalDualExpr(dae, fMulti, dualVarsWrtY);
  assert.ok(Math.abs(resY.val - 4.0) < 1e-6, `Expected 4.0, got ${resY.val}`);
  assert.ok(Math.abs(resY.dot - -1.0) < 1e-6, `Expected -1.0, got ${resY.dot}`);
  console.log("  ✓ df/dy = -1.0 passed");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Conditional IfElse evaluation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 4: Conditional IfElse evaluation...");
  const zero = wasmExports.dae_addRealLiteral(dae, 0.0);
  const condExpr = wasmExports.dae_addExpression(dae, 5, 15, xExpr, zero); // x > 0 (BinOp.Gt = 15)
  const thenExpr = wasmExports.dae_addExpression(dae, 5, 2, xExpr, xExpr); // x^2
  const elseExpr = wasmExports.dae_addExpression(dae, 14, 0, xExpr, 0); // Negate (-x)
  const ifElseExpr = wasmExports.dae_addExpression(dae, 11, condExpr, thenExpr, elseExpr); // IfElse

  const resPos = bridge.evalDualExpr(dae, ifElseExpr, new Float64Array([3.0, 1.0, 0.0, 0.0]));
  assert.ok(Math.abs(resPos.val - 9.0) < 1e-6, `Expected 9.0, got ${resPos.val}`);
  assert.ok(Math.abs(resPos.dot - 6.0) < 1e-6, `Expected 6.0, got ${resPos.dot}`);
  console.log("  ✓ IfElse branch positive (x=3): f=9.0, f'=6.0 passed");

  const resNeg = bridge.evalDualExpr(dae, ifElseExpr, new Float64Array([-3.0, 1.0, 0.0, 0.0]));
  assert.ok(Math.abs(resNeg.val - 3.0) < 1e-6, `Expected 3.0, got ${resNeg.val}`);
  assert.ok(Math.abs(resNeg.dot - -1.0) < 1e-6, `Expected -1.0, got ${resNeg.dot}`);
  console.log("  ✓ IfElse branch negative (x=-3): f=3.0, f'=-1.0 passed");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: Non-linear equation residuals and Jacobian columns
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 5: Non-linear equation residuals and Jacobian column evaluations...");
  // Eq 0: x0^2 + x1 = 7.0  => Residual R0 = 7.0 - (x0^2 + x1)
  // dR0/dx0 = -2*x0 = -4.0, dR0/dx1 = -1.0
  const x0Var = xVar;
  const x1Var = yVar;
  const x0ExprVar = xExpr;
  const x1ExprVar = yExpr;

  const x0SqVar = wasmExports.dae_addExpression(dae, 5, 2, x0ExprVar, x0ExprVar);
  const lhs0 = wasmExports.dae_addExpression(dae, 5, 0, x0SqVar, x1ExprVar);
  const rhs0 = wasmExports.dae_addRealLiteral(dae, 7.0);
  const eq0 = wasmExports.dae_addEquation(dae, 0, lhs0, rhs0);

  // Eq 1: x0 * x1 = 6.0  => Residual R1 = 6.0 - (x0 * x1)
  // dR1/dx0 = -x1 = -3.0, dR1/dx1 = -x0 = -2.0
  const lhs1 = wasmExports.dae_addExpression(dae, 5, 2, x0ExprVar, x1ExprVar);
  const rhs1 = wasmExports.dae_addRealLiteral(dae, 6.0);
  const eq1 = wasmExports.dae_addEquation(dae, 0, lhs1, rhs1);

  const dualVarsSys = new Float64Array([2.0, 0.0, 3.0, 0.0]);

  const r0 = bridge.evalDualEquationResidual(dae, eq0, dualVarsSys);
  assert.ok(Math.abs(r0.val - 0.0) < 1e-6, `Expected R0 = 0.0, got ${r0.val}`);

  const r1 = bridge.evalDualEquationResidual(dae, eq1, dualVarsSys);
  assert.ok(Math.abs(r1.val - 0.0) < 1e-6, `Expected R1 = 0.0, got ${r1.val}`);
  console.log("  ✓ Residuals R0 = 0.0, R1 = 0.0 passed");

  const col0 = bridge.evalDualJacobianColumn(dae, [eq0, eq1], dualVarsSys, 0);
  assert.strictEqual(col0.length, 2);
  assert.ok(Math.abs(col0[0] - -4.0) < 1e-6, `Expected J[0,0] = -4.0, got ${col0[0]}`);
  assert.ok(Math.abs(col0[1] - -3.0) < 1e-6, `Expected J[1,0] = -3.0, got ${col0[1]}`);
  console.log("  ✓ Jacobian Column 0: [-4.0, -3.0] passed");

  const col1 = bridge.evalDualJacobianColumn(dae, [eq0, eq1], dualVarsSys, 1);
  assert.strictEqual(col1.length, 2);
  assert.ok(Math.abs(col1[0] - -1.0) < 1e-6, `Expected J[0,1] = -1.0, got ${col1[0]}`);
  assert.ok(Math.abs(col1[1] - -2.0) < 1e-6, `Expected J[1,1] = -2.0, got ${col1[1]}`);
  console.log("  ✓ Jacobian Column 1: [-1.0, -2.0] passed");

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("=== All WASM Forward-Mode Dual AD Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
