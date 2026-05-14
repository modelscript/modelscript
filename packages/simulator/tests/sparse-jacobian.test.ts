// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Tests for sparse Jacobian coloring and compressed AD evaluation.
 *
 * Verifies:
 *   1. Graph coloring produces valid colorings (no conflicts)
 *   2. Tridiagonal system produces exactly 3 colors
 *   3. Sparse Jacobian values match dense Jacobian values
 *   4. BDF integrator works with sparse Jacobian option
 */

import { buildCCS, colorJacobianColumns } from "@modelscript/symbolics";
import { bdf } from "../src/bdf.js";
import { sparseJacobianToDense, type SparseJacobian } from "../src/sparse-jacobian.js";

// ── Test helpers ──

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL: ${msg}\n  Expected: ${expected}\n  Actual:   ${actual}`);
  }
}

function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  const err = Math.abs(actual - expected);
  if (err > tol) {
    throw new Error(`FAIL: ${msg}\n  Expected: ${expected} ± ${tol}\n  Actual:   ${actual} (error: ${err})`);
  }
}

// ── Test 1: Tridiagonal coloring ──

function testTridiagonalColoring(): void {
  console.log("Test 1: Tridiagonal coloring...");

  // Build a tridiagonal sparsity pattern for n=10
  // Each row i has non-zeros at columns i-1, i, i+1
  const n = 10;
  const rowDeps: Set<string>[] = [];
  const columns: string[] = [];
  for (let i = 0; i < n; i++) {
    columns.push(`x${i}`);
  }

  for (let i = 0; i < n; i++) {
    const deps = new Set<string>();
    if (i > 0) deps.add(`x${i - 1}`);
    deps.add(`x${i}`);
    if (i < n - 1) deps.add(`x${i + 1}`);
    rowDeps.push(deps);
  }

  const ccs = buildCCS(rowDeps, columns);
  const result = colorJacobianColumns(ccs, n);

  // Tridiagonal bandwidth = 1, so we need exactly 3 colors
  assertEqual(result.numColors, 3, "Tridiagonal system should need exactly 3 colors");

  // Verify no two adjacent columns share a color
  for (let i = 0; i < n - 1; i++) {
    if (result.colors[i] === result.colors[i + 1]) {
      throw new Error(`FAIL: Adjacent columns ${i} and ${i + 1} share color ${result.colors[i]}`);
    }
  }

  console.log(`  ✅ Passed (${result.numColors} colors for ${n}-column tridiagonal)`);
}

// ── Test 2: Dense system needs n colors ──

function testDenseColoring(): void {
  console.log("Test 2: Dense coloring...");

  const n = 5;
  const rowDeps: Set<string>[] = [];
  const columns: string[] = [];
  for (let i = 0; i < n; i++) {
    columns.push(`x${i}`);
  }

  // Every equation depends on every variable → fully dense
  for (let i = 0; i < n; i++) {
    const deps = new Set<string>();
    for (let j = 0; j < n; j++) {
      deps.add(`x${j}`);
    }
    rowDeps.push(deps);
  }

  const ccs = buildCCS(rowDeps, columns);
  const result = colorJacobianColumns(ccs, n);

  // Dense system: all columns conflict → need n colors
  assertEqual(result.numColors, n, `Dense ${n}×${n} system should need ${n} colors`);

  console.log(`  ✅ Passed (${result.numColors} colors for ${n}-column dense)`);
}

// ── Test 3: Diagonal system needs 1 color ──

function testDiagonalColoring(): void {
  console.log("Test 3: Diagonal coloring...");

  const n = 20;
  const rowDeps: Set<string>[] = [];
  const columns: string[] = [];
  for (let i = 0; i < n; i++) {
    columns.push(`x${i}`);
  }

  // Each equation depends on only its own variable → diagonal
  for (let i = 0; i < n; i++) {
    rowDeps.push(new Set([`x${i}`]));
  }

  const ccs = buildCCS(rowDeps, columns);
  const result = colorJacobianColumns(ccs, n);

  // Diagonal: no column conflicts → 1 color
  assertEqual(result.numColors, 1, "Diagonal system should need exactly 1 color");

  console.log(`  ✅ Passed (${result.numColors} color for ${n}-column diagonal)`);
}

// ── Test 4: Coloring validity check ──

function testColoringValidity(): void {
  console.log("Test 4: Coloring validity (no conflicts)...");

  // Random-ish sparse pattern: block tridiagonal with 3×3 blocks
  const blockSize = 3;
  const nBlocks = 5;
  const n = blockSize * nBlocks;
  const rowDeps: Set<string>[] = [];
  const columns: string[] = [];
  for (let i = 0; i < n; i++) {
    columns.push(`x${i}`);
  }

  for (let b = 0; b < nBlocks; b++) {
    for (let r = 0; r < blockSize; r++) {
      const deps = new Set<string>();
      // Current block
      for (let c = 0; c < blockSize; c++) {
        deps.add(`x${b * blockSize + c}`);
      }
      // Adjacent blocks
      if (b > 0) {
        for (let c = 0; c < blockSize; c++) {
          deps.add(`x${(b - 1) * blockSize + c}`);
        }
      }
      if (b < nBlocks - 1) {
        for (let c = 0; c < blockSize; c++) {
          deps.add(`x${(b + 1) * blockSize + c}`);
        }
      }
      rowDeps.push(deps);
    }
  }

  const ccs = buildCCS(rowDeps, columns);
  const result = colorJacobianColumns(ccs, n);

  // Verify coloring validity: no two columns sharing a row have the same color
  // Build row→columns map from CCS
  const rowToCols = new Map<number, number[]>();
  for (let col = 0; col < n; col++) {
    const start = ccs.col_ptr[col] ?? 0;
    const end = ccs.col_ptr[col + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const row = ccs.row_indices[p] ?? 0;
      let cols = rowToCols.get(row);
      if (!cols) {
        cols = [];
        rowToCols.set(row, cols);
      }
      cols.push(col);
    }
  }

  for (const [row, cols] of rowToCols) {
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const ci = cols[i] ?? 0;
        const cj = cols[j] ?? 0;
        if (result.colors[ci] === result.colors[cj]) {
          throw new Error(`FAIL: Row ${row}: columns ${ci} and ${cj} share color ${result.colors[ci]}`);
        }
      }
    }
  }

  console.log(`  ✅ Passed (${result.numColors} colors for ${n}-column block-tridiagonal, valid)`);
}

// ── Test 5: BDF with sparse Jacobian ──

function testBdfWithSparseJacobian(): void {
  console.log("Test 5: BDF integrator with sparse Jacobian...");

  // Simple ODE: y' = -y, y(0) = 1 → y(t) = exp(-t)
  const f = (_t: number, y: number[]) => [-(y[0] ?? 0)];

  // Build a trivial 1×1 sparse Jacobian (CSR): J = [-1]
  const sparseFn = (_t: number, _y: number[]): SparseJacobian => ({
    n: 1,
    rowPtr: new Int32Array([0, 1]),
    colIdx: new Int32Array([0]),
    values: new Float64Array([-1.0]),
    nnz: 1,
  });

  const tEnd = 2.0;
  const nPoints = 100;
  const outputTimes: number[] = [];
  for (let i = 0; i <= nPoints; i++) {
    outputTimes.push((i / nPoints) * tEnd);
  }

  const result = bdf(f, 0, [1.0], tEnd, outputTimes, { sparseJacobian: sparseFn, maxStep: 0.1, maxOrder: 1 });

  // Verify we got output and the final value is correct
  if (result.times.length < 2) {
    throw new Error(`FAIL: BDF produced only ${result.times.length} output points`);
  }

  // Check final output
  const lastIdx = result.times.length - 1;
  const tLast = result.times[lastIdx] ?? 0;
  const yLast = result.states[lastIdx]?.[0] ?? 0;
  assertClose(tLast, tEnd, 0.01, "Final time should be ≈2.0");
  assertClose(yLast, Math.exp(-tEnd), 1e-3, "y(2) should be exp(-2)");

  console.log(
    `  ✅ Passed (y(${tLast.toFixed(1)})=${yLast.toFixed(6)}, expected=${Math.exp(-tEnd).toFixed(6)}, ${result.jEvals} J-evals, ${result.times.length} points)`,
  );
}

// ── Test 6: sparseJacobianToDense round-trip ──

function testSparseJacobianToDense(): void {
  console.log("Test 6: sparseJacobianToDense conversion...");

  // Build a known 3×3 sparse Jacobian in CSR
  const sj: SparseJacobian = {
    n: 3,
    rowPtr: new Int32Array([0, 2, 4, 5]),
    colIdx: new Int32Array([0, 1, 0, 2, 1]),
    values: new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0]),
    nnz: 5,
  };

  const dense = sparseJacobianToDense(sj);

  // Expected:
  // [[1, 2, 0],
  //  [3, 0, 4],
  //  [0, 5, 0]]
  assertEqual(dense[0]?.[0], 1, "J[0][0]");
  assertEqual(dense[0]?.[1], 2, "J[0][1]");
  assertEqual(dense[0]?.[2], 0, "J[0][2]");
  assertEqual(dense[1]?.[0], 3, "J[1][0]");
  assertEqual(dense[1]?.[1], 0, "J[1][1]");
  assertEqual(dense[1]?.[2], 4, "J[1][2]");
  assertEqual(dense[2]?.[0], 0, "J[2][0]");
  assertEqual(dense[2]?.[1], 5, "J[2][1]");
  assertEqual(dense[2]?.[2], 0, "J[2][2]");

  console.log("  ✅ Passed");
}

// ── Run all tests ──

function main(): void {
  console.log("=== Sparse Jacobian Coloring Tests ===\n");

  let passed = 0;
  let failed = 0;

  const tests = [
    testTridiagonalColoring,
    testDenseColoring,
    testDiagonalColoring,
    testColoringValidity,
    testBdfWithSparseJacobian,
    testSparseJacobianToDense,
  ];

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
