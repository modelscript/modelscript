// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { StaticTapeBuilder, TapeOpKind } from "../src/autodiff/wasm_tape.js";
import { getDefaultWasmExports } from "../src/dae/wasm_dae.js";
import { bicgstab, gmres, ilu0Factor, ilu0Preconditioner, ilu0Solve } from "../src/solvers/krylov.js";
import { arnoldiIteration, type LinearOperator } from "../src/solvers/sparse_arnoldi.js";
import { SparseTripletBuilder, sparseLuFactor, sparseLuRefactorize, sparseLuSolve } from "../src/solvers/sparse_lu.js";
import { luFactorFlat, luSolveFlat } from "../src/solvers/wasm_gaussian.js";

function ensureWasmReady(): void {
  const wasm = getDefaultWasmExports();
  assert.ok(wasm, "Expected release.wasm exports to be loaded");
}

test("WASM Tier 1: luFactorFlat & luSolveFlat for n >= 16", async () => {
  ensureWasmReady();
  const n = 20;
  const A = new Float64Array(n * n);
  const xTrue = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xTrue[i] = (i + 1) * 0.5;
    A[i * n + i] = 4.0 + i * 0.1;
    if (i > 0) A[i * n + (i - 1)] = -1.0;
    if (i < n - 1) A[i * n + (i + 1)] = -0.8;
  }
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += A[i * n + j]! * xTrue[j]!;
    b[i] = sum;
  }

  const fact = luFactorFlat(new Float64Array(A), n);
  const x = new Float64Array(b);
  luSolveFlat(fact, x);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(x[i]! - xTrue[i]!) < 1e-11, `luSolveFlat mismatch at ${i}: ${x[i]} vs ${xTrue[i]}`);
  }
});

test("WASM Tier 1: sparseLuFactor, sparseLuRefactorize, sparseLuSolve for n >= 16", async () => {
  ensureWasmReady();
  const n = 24;
  const builder = new SparseTripletBuilder(n, n);
  for (let i = 0; i < n; i++) {
    builder.add(i, i, 5.0 + i * 0.05);
    if (i > 0) builder.add(i, i - 1, -1.2);
    if (i < n - 1) builder.add(i, i + 1, -0.9);
  }
  const A = builder.toCCS();
  const xTrue = new Float64Array(n);
  for (let i = 0; i < n; i++) xTrue[i] = Math.sin(i + 1);

  const b = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    for (let p = A.colPtr[j]!; p < A.colPtr[j + 1]!; p++) {
      b[A.rowIndices[p]!]! += A.values[p]! * xTrue[j]!;
    }
  }

  const factors = sparseLuFactor(A, { keepStructuralPattern: true })!;
  assert.ok(factors, "Expected sparseLuFactor to succeed");
  const x = sparseLuSolve(factors, b);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(x[i]! - xTrue[i]!) < 1e-11, `sparseLuSolve mismatch at ${i}: ${x[i]} vs ${xTrue[i]}`);
  }

  // Refactorize with perturbed values on the same sparsity pattern
  const builder2 = new SparseTripletBuilder(n, n);
  for (let i = 0; i < n; i++) {
    builder2.add(i, i, 8.0 + i * 0.1);
    if (i > 0) builder2.add(i, i - 1, -1.5);
    if (i < n - 1) builder2.add(i, i + 1, -1.1);
  }
  const A2 = builder2.toCCS();
  const b2 = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    for (let p = A2.colPtr[j]!; p < A2.colPtr[j + 1]!; p++) {
      b2[A2.rowIndices[p]!]! += A2.values[p]! * xTrue[j]!;
    }
  }

  const refactOk = sparseLuRefactorize(A2, factors);
  assert.strictEqual(refactOk, true, "Expected sparseLuRefactorize to succeed");
  const x2 = sparseLuSolve(factors, b2);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(x2[i]! - xTrue[i]!) < 1e-11, `sparseLuRefactorize mismatch at ${i}: ${x2[i]} vs ${xTrue[i]}`);
  }
});

test("WASM Tier 1: ilu0Factor, ilu0Solve, gmres, bicgstab for n >= 16", async () => {
  ensureWasmReady();
  const n = 24;
  const builder = new SparseTripletBuilder(n, n);
  for (let i = 0; i < n; i++) {
    builder.add(i, i, 4.5);
    if (i > 0) builder.add(i, i - 1, -1.2);
    if (i < n - 1) builder.add(i, i + 1, -0.7);
  }
  const A = builder.toCCS();
  const xTrue = new Float64Array(n);
  for (let i = 0; i < n; i++) xTrue[i] = (i + 1) * 0.25;

  const b = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    for (let p = A.colPtr[j]!; p < A.colPtr[j + 1]!; p++) {
      b[A.rowIndices[p]!]! += A.values[p]! * xTrue[j]!;
    }
  }

  const ilu = ilu0Factor(A);
  const preconditioner = ilu0Preconditioner(A);
  const testOut = new Float64Array(n);
  ilu0Solve(ilu, b, testOut);
  assert.ok(
    Math.abs(testOut[0]! - xTrue[0]!) < 1e-10,
    `ilu0Solve mismatch at 0: ${testOut[0]} vs ${xTrue[0]} (b[0]=${b[0]})`,
  );

  const gmresRes = gmres(A, b, { preconditioner, tol: 1e-10, restart: 15, maxIter: 50 });
  assert.ok(gmresRes.converged, `GMRES failed to converge: norm=${gmresRes.residualNorm}`);
  for (let i = 0; i < n; i++) {
    assert.ok(
      Math.abs(gmresRes.x[i]! - xTrue[i]!) < 1e-8,
      `gmres mismatch at ${i}: ${gmresRes.x[i]} vs ${xTrue[i]} (iters=${gmresRes.iterations}, norm=${gmresRes.residualNorm})`,
    );
  }

  const bicgRes = bicgstab(A, b, { preconditioner, tol: 1e-10, maxIter: 50 });
  assert.ok(bicgRes.converged, `BiCGStab failed to converge: norm=${bicgRes.residualNorm}`);
  for (let i = 0; i < n; i++) {
    assert.ok(
      Math.abs(bicgRes.x[i]! - xTrue[i]!) < 1e-8,
      `bicgstab mismatch at ${i}: ${bicgRes.x[i]} vs ${xTrue[i]} (iters=${bicgRes.iterations}, norm=${bicgRes.residualNorm})`,
    );
  }
});

test("WASM Tier 1: arnoldiIteration with mgsOrthogonalizeWasm for n >= 16", async () => {
  ensureWasmReady();
  const n = 20;
  const m = 8;
  const op: LinearOperator = {
    dim: n,
    apply: (v, out) => {
      for (let i = 0; i < n; i++) {
        let sum = 4.0 * v[i]!;
        if (i > 0) sum -= v[i - 1]!;
        if (i < n - 1) sum -= v[i + 1]!;
        out[i] = sum;
      }
    },
  };
  const { V, H, actualSteps } = arnoldiIteration(op, m);
  assert.strictEqual(actualSteps, m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let dot = 0;
      for (let k = 0; k < n; k++) dot += V[i * n + k]! * V[j * n + k]!;
      const expected = i === j ? 1.0 : 0.0;
      assert.ok(Math.abs(dot - expected) < 1e-10, `Orthonormality failed at (${i},${j}): ${dot}`);
    }
  }
  assert.ok(Number.isFinite(H[0]!));
});

test("WASM Tier 2: StaticTapeBuilder forward & reverse sweep for length >= 32", async () => {
  ensureWasmReady();
  const tape = new StaticTapeBuilder();
  const xIdx = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("x"));
  const yIdx = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("y"));
  const c2 = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 2.0);
  // Build >= 32 ops (avoid CSE deduplication with distinct constants)
  let acc = tape.pushScalarOp(TapeOpKind.Mul, xIdx, c2);
  acc = tape.pushScalarOp(TapeOpKind.Sin, acc);
  const expY = tape.pushScalarOp(TapeOpKind.Exp, yIdx);
  let sum = tape.pushScalarOp(TapeOpKind.Add, acc, expY);
  let expectedSumCoeff = 0;
  for (let k = 1; k <= 12; k++) {
    const ck = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, k * 0.1);
    const xk = tape.pushScalarOp(TapeOpKind.Mul, xIdx, ck);
    const s = tape.pushScalarOp(TapeOpKind.Sin, xk);
    const p = tape.pushScalarOp(TapeOpKind.Mul, s, yIdx);
    sum = tape.pushScalarOp(TapeOpKind.Add, sum, p);
    expectedSumCoeff += k * 0.1;
  }
  assert.ok(tape.length >= 32, `Expected tape length >= 32, got ${tape.length}`);

  const xVal = 0.7;
  const yVal = 0.3;
  const vals = tape.evaluateForward(
    new Map([
      ["x", xVal],
      ["y", yVal],
    ]),
  );
  let expectedVal = Math.sin(2 * xVal) + Math.exp(yVal);
  let expectedDx = 2 * Math.cos(2 * xVal);
  let expectedDy = Math.exp(yVal);
  for (let k = 1; k <= 12; k++) {
    const c = k * 0.1;
    expectedVal += Math.sin(c * xVal) * yVal;
    expectedDx += c * Math.cos(c * xVal) * yVal;
    expectedDy += Math.sin(c * xVal);
  }
  assert.ok(Math.abs(vals[sum]! - expectedVal) < 1e-11, `Forward mismatch: ${vals[sum]} vs ${expectedVal}`);

  const grads = tape.evaluateReverse(vals, sum);
  assert.ok(Math.abs((grads.get("x") ?? 0) - expectedDx) < 1e-11, `dx mismatch: ${grads.get("x")} vs ${expectedDx}`);
  assert.ok(Math.abs((grads.get("y") ?? 0) - expectedDy) < 1e-11, `dy mismatch: ${grads.get("y")} vs ${expectedDy}`);
});
