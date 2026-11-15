// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { cmaesSolve, cmaesSolveSync } from "../src/optimizer/solvers/cma-es.js";

test("CMA-ES WASM covariance & Jacobi eigendecomposition (n = 10 >= 8)", async () => {
  const n = 10;
  const bounds = { min: new Float64Array(n).fill(-5.0), max: new Float64Array(n).fill(5.0) };
  const target = new Float64Array(n);
  for (let i = 0; i < n; i++) target[i] = (i - 4.5) * 0.4;

  // Anisotropic ellipsoid to exercise full covariance rotation B * D * B^T
  const fitness = (x: Float64Array): number => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const diff = x[i]! - target[i]!;
      const scale = Math.pow(10, (3 * i) / (n - 1));
      sum += scale * diff * diff;
    }
    return sum;
  };

  const res = cmaesSolveSync({ dimension: n, bounds, fitness }, { maxGenerations: 250, tolerance: 1e-8, seed: 42 });
  assert.ok(res.bestFitness < 1e-4, `Expected CMA-ES sync bestFitness < 1e-4, got ${res.bestFitness}`);

  const resAsync = await cmaesSolve(
    { dimension: n, bounds, fitness },
    { maxGenerations: 250, tolerance: 1e-8, seed: 42 },
  );
  assert.ok(resAsync.bestFitness < 1e-4, `Expected CMA-ES async bestFitness < 1e-4, got ${resAsync.bestFitness}`);
});
