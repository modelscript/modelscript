// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  denseToCCS,
  factorizeLinearMatrix,
  sparseLuFactor,
  sparseLuSolve,
} from "../src/solvers/sparse-solver-bridge.js";
import { trbdf2 } from "../src/solvers/trbdf2.js";

console.log("=== Testing Sparse Linear Algebra Solver Bridge ===");

// 1. Test CCS conversion & Gilbert-Peierls Sparse LU on known sparse system
{
  console.log("Test 1: Gilbert-Peierls Sparse LU Factor & Solve");
  // 4x4 Sparse Tridiagonal Matrix:
  // [ 4, -1,  0,  0 ]   x   [ 1 ]     [  2 ]
  // [-1,  4, -1,  0 ] * [ 2 ]  =  [  6 ]
  // [ 0, -1,  4, -1 ]   [ 3 ]     [  6 ]
  // [ 0,  0, -1,  4 ]   [ 4 ]     [ 13 ]
  const n = 4;
  const dense: Float64Array[] = [
    new Float64Array([4, -1, 0, 0]),
    new Float64Array([-1, 4, -1, 0]),
    new Float64Array([0, -1, 4, -1]),
    new Float64Array([0, 0, -1, 4]),
  ];
  const b = new Float64Array([2, 4, 6, 13]);
  const expectedX = [1, 2, 3, 4];

  const ccs = denseToCCS(dense, n);
  assert.strictEqual(ccs.nnz, 10, "4x4 tridiagonal matrix must have 10 non-zeros");

  const lu = sparseLuFactor(ccs);
  const x = new Float64Array(n);
  sparseLuSolve(lu, b, x);

  for (let i = 0; i < n; i++) {
    const diff = Math.abs(x[i]! - expectedX[i]!);
    assert(diff < 1e-12, `Sparse LU solution mismatch at index ${i}: got ${x[i]}, expected ${expectedX[i]}`);
  }
  console.log("  ✓ Gilbert-Peierls Sparse LU solved 4x4 tridiagonal system exactly");
}

// 2. Test factorizeLinearMatrix universal factory
{
  console.log("Test 2: Universal factorizeLinearMatrix Factory (Dense vs Sparse)");
  const n = 3;
  const W = [new Float64Array([2, 1, 0]), new Float64Array([1, 3, 1]), new Float64Array([0, 1, 2])];
  const bDense = new Float64Array([4, 9, 5]); // Solution: x = [1, 2, 1] (2*1+2=4, 1+6+1=8? wait: 1*1+3*2+1*1 = 8) -> b = [4, 8, 4]
  const b = new Float64Array([4, 8, 4]);

  const solverDense = factorizeLinearMatrix(W, n, { linearSolver: "dense" });
  assert.strictEqual(solverDense.isSparse, false);
  const rhsDense = new Float64Array(b);
  solverDense.solve(rhsDense);
  assert(
    Math.abs(rhsDense[0]! - 1.0) < 1e-12 &&
      Math.abs(rhsDense[1]! - 2.0) < 1e-12 &&
      Math.abs(rhsDense[2]! - 1.0) < 1e-12,
  );

  const solverSparse = factorizeLinearMatrix(W, n, { linearSolver: "sparse" });
  assert.strictEqual(solverSparse.isSparse, true);
  const rhsSparse = new Float64Array(b);
  solverSparse.solve(rhsSparse);
  assert(
    Math.abs(rhsSparse[0]! - 1.0) < 1e-12 &&
      Math.abs(rhsSparse[1]! - 2.0) < 1e-12 &&
      Math.abs(rhsSparse[2]! - 1.0) < 1e-12,
  );
  console.log("  ✓ factorizeLinearMatrix factory verified for both dense and sparse solvers");
}

// 3. Test TR-BDF2 with linearSolver: "sparse" on Stiff Robertson system
{
  console.log("Test 3: TR-BDF2 with linearSolver = 'sparse'");
  const robertson = (_t: number, y: number[]) => {
    const y1 = y[0] ?? 0;
    const y2 = y[1] ?? 0;
    const y3 = y[2] ?? 0;
    return [-0.04 * y1 + 1e4 * y2 * y3, 0.04 * y1 - 1e4 * y2 * y3 - 3e7 * y2 * y2, 3e7 * y2 * y2];
  };

  const y0 = [1.0, 0.0, 0.0];
  const resSparse = trbdf2(robertson, 0.0, y0, 10.0, undefined, {
    atol: 1e-5,
    rtol: 1e-4,
    linearSolver: "sparse",
  });

  assert(resSparse.stats.converged, "TR-BDF2 with sparse linear solver must converge");
  const finalState = resSparse.states[resSparse.states.length - 1]!;
  const sum = (finalState[0] ?? 0) + (finalState[1] ?? 0) + (finalState[2] ?? 0);
  assert(Math.abs(sum - 1.0) < 1e-3, `Mass conservation preserved with sparse solver: ${sum}`);
  console.log(`  ✓ TR-BDF2 with sparse solver completed in ${resSparse.stats.acceptedSteps} steps`);
}

console.log("All Sparse Linear Algebra Solver Bridge tests completed successfully!");
