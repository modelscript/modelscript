// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import {
  GaussianTuple,
  WasmGaussian,
  emitGaussianForwardC,
  evaluateTapeGaussian,
  gaAdd,
  gaExp,
  gaMul,
  gaSin,
  luFactor,
  luSolve,
  unscentedTransform,
} from "../src/runtime/wasm_gaussian.js";
import { StaticTapeBuilder, TapeOpKind } from "../src/runtime/wasm_tape.js";

console.log("Testing WASM Gaussian Uncertainty & Linear Algebra...");

// Test 1: GaussianTuple and basic arithmetic
{
  const g1 = GaussianTuple.fromMeanStddev(10.0, 2.0); // mean=10, var=4
  const g2 = GaussianTuple.fromMeanStddev(5.0, 1.0); // mean=5, var=1

  assert.strictEqual(g1.mean, 10.0);
  assert.strictEqual(g1.variance, 4.0);
  assert.strictEqual(g1.stddev, 2.0);

  const sum = gaAdd(g1, g2); // mean=15, var=5
  assert.strictEqual(sum.mean, 15.0);
  assert.strictEqual(sum.variance, 5.0);

  const prod = gaMul(g1, g2); // mean=50
  assert.strictEqual(prod.mean, 50.0);
  assert.ok(prod.variance > 0);

  const sinG = gaSin(GaussianTuple.point(0.0));
  assert.strictEqual(sinG.mean, 0.0);
  assert.strictEqual(sinG.variance, 0.0);

  const expG = gaExp(GaussianTuple.point(0.0));
  assert.strictEqual(expG.mean, 1.0);
  assert.strictEqual(expG.variance, 0.0);

  console.log("  ✔ GaussianTuple moment propagation rules passed");
}

// Test 2: Unscented Transform (UT)
{
  // Non-linear function: f(x) = x^2
  // For X ~ N(2, 1), E[X^2] = Var(X) + E[X]^2 = 1 + 4 = 5
  const input = [GaussianTuple.fromMeanStddev(2.0, 1.0)];
  const utRes = unscentedTransform(input, (x) => x[0]! * x[0]!);

  assert.ok(Math.abs(utRes.mean - 5.0) < 0.1, `Expected E[X^2] ≈ 5.0, got ${utRes.mean}`);
  assert.ok(utRes.variance > 0);
  console.log("  ✔ Unscented Transform (UT) nonlinear propagation passed");
}

// Test 3: evaluateTapeGaussian forward pass
{
  const tape = new StaticTapeBuilder();
  // z = a * b + 3
  const aNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("a"));
  const bNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("b"));
  const mulNode = tape.pushScalarOp(TapeOpKind.Mul, aNode, bNode);
  const constNode = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 3.0);
  const zNode = tape.pushScalarOp(TapeOpKind.Add, mulNode, constNode);

  const dists = new Map<string, GaussianTuple>([
    ["a", GaussianTuple.fromMeanStddev(2.0, 0.1)],
    ["b", GaussianTuple.fromMeanStddev(4.0, 0.2)],
  ]);

  const results = evaluateTapeGaussian(tape, dists);
  const zRes = results[zNode]!;

  // E[z] = 2 * 4 + 3 = 11
  assert.ok(Math.abs(zRes.mean - 11.0) < 1e-6);
  assert.ok(zRes.variance > 0);
  console.log("  ✔ Tape Gaussian forward evaluation passed");
}

// Test 4: C-Code Emission
{
  const tape = new StaticTapeBuilder();
  const aNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("a"));
  const bNode = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 5.0);
  tape.pushScalarOp(TapeOpKind.Add, aNode, bNode);

  const cCode = emitGaussianForwardC(tape, (name) => ({ mean: `${name}_mu`, var: `${name}_var` }));
  assert.ok(cCode.length > 0);
  assert.ok(cCode[0]!.includes("double t_mu"));
  console.log("  ✔ Gaussian forward C-code generation passed");
}

// Test 5: Dense LU Factorization & Linear Solver (Ax = b)
{
  // A = [ [3, 2], [1, 4] ], b = [5, 5]
  // Solution: x = [1, 1]
  const A = [new Float64Array([3.0, 2.0]), new Float64Array([1.0, 4.0])];
  const b = new Float64Array([5.0, 5.0]);

  const fact = luFactor(A, 2);
  luSolve(fact, b);

  assert.ok(Math.abs(b[0]! - 1.0) < 1e-10, `Expected x[0] = 1, got ${b[0]}`);
  assert.ok(Math.abs(b[1]! - 1.0) < 1e-10, `Expected x[1] = 1, got ${b[1]}`);
  console.log("  ✔ Dense LU factorization and linear solver passed");
}

// Test 6: WasmGaussian bridge wrapper
{
  const mockWasm = {
    exports: {
      luFactor: () => true,
      luSolve: () => {},
    },
    memory: new WebAssembly.Memory({ initial: 1 }),
  };

  const wasmGauss = new WasmGaussian(mockWasm);
  const A = [new Float64Array([2.0, 0.0]), new Float64Array([0.0, 3.0])];
  const b = new Float64Array([4.0, 9.0]);

  const x = wasmGauss.solveLinearSystem(A, b);
  assert.strictEqual(x.length, 2);
  console.log("  ✔ WasmGaussian bridge passed");
}

console.log("=== All WASM Gaussian & Linear Algebra Tests Passed Cleanly ===");
