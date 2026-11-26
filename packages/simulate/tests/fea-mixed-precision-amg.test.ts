// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type CsrMatrix, solvePcgAmg, spmvCsr } from "../src/fea/amg-preconditioner.js";
import {
  MixedPrecisionAmgPreconditioner,
  solveMixedPrecisionIterativeRefinement,
  solvePcgMixedPrecisionAmg,
} from "../src/fea/mixed-precision-amg.js";

/**
 * Builds a 3D anisotropic 7-point SPD finite-difference Poisson/elasticity-like
 * CSR matrix on an nx x ny x nz interior grid with homogeneous Dirichlet BCs.
 */
function build3DAnisotropicPoissonCsr(
  nx: number,
  ny: number,
  nz: number,
  kx: number,
  ky: number,
  kz: number,
): CsrMatrix {
  const n = nx * ny * nz;
  const rowOffsets = new Int32Array(n + 1);
  const colList: number[] = [];
  const valList: number[] = [];

  const idx = (ix: number, iy: number, iz: number) => (ix * ny + iy) * nz + iz;
  const diagVal = 2.0 * (kx + ky + kz);

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const row = idx(ix, iy, iz);
        const entries: Array<[number, number]> = [[row, diagVal]];
        if (ix > 0) entries.push([idx(ix - 1, iy, iz), -kx]);
        if (ix + 1 < nx) entries.push([idx(ix + 1, iy, iz), -kx]);
        if (iy > 0) entries.push([idx(ix, iy - 1, iz), -ky]);
        if (iy + 1 < ny) entries.push([idx(ix, iy + 1, iz), -ky]);
        if (iz > 0) entries.push([idx(ix, iy, iz - 1), -kz]);
        if (iz + 1 < nz) entries.push([idx(ix, iy, iz + 1), -kz]);

        entries.sort((a, b) => a[0] - b[0]);
        for (const [col, val] of entries) {
          colList.push(col);
          valList.push(val);
        }
        rowOffsets[row + 1] = colList.length;
      }
    }
  }

  return {
    n,
    rowOffsets,
    colIndices: Int32Array.from(colList),
    values: Float64Array.from(valList),
  };
}

function l2RelResidual(A: CsrMatrix, x: Float64Array, b: Float64Array): number {
  const Ax = new Float64Array(A.n);
  spmvCsr(A, x, Ax);
  let errSq = 0.0;
  let bSq = 0.0;
  for (let i = 0; i < A.n; i++) {
    const d = b[i]! - Ax[i]!;
    errSq += d * d;
    bSq += b[i]! * b[i]!;
  }
  return Math.sqrt(errSq / bSq);
}

function l2RelDiff(a: Float64Array, b: Float64Array): number {
  let diffSq = 0.0;
  let refSq = 0.0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    diffSq += d * d;
    refSq += b[i]! * b[i]!;
  }
  return Math.sqrt(diffSq / refSq);
}

describe("Mixed-Precision (f32 Inner + f64 Outer) SA-AMG & Iterative Refinement", () => {
  const nx = 16;
  const ny = 8;
  const nz = 8;
  const A = build3DAnisotropicPoissonCsr(nx, ny, nz, 100.0, 1.0, 1.0);
  const b = new Float64Array(A.n);
  for (let i = 0; i < A.n; i++) {
    b[i] = 1.0 + 0.5 * Math.sin(0.13 * i) + 0.25 * Math.cos(0.37 * i);
  }

  it("converges to full f64 residual < 1e-10 in < 20 iterations and matches pure f64 AMG-PCG within < 1e-9", () => {
    assert.equal(A.n, 1024);

    const mpRes = solvePcgMixedPrecisionAmg(A, b, {
      tolerance: 1e-10,
      maxIterations: 100,
    });
    const f64Res = solvePcgAmg(A, b, {
      tolerance: 1e-12,
      maxIterations: 100,
    });

    assert.equal(mpRes.converged, true, "Mixed-precision FPCG must converge");
    assert.equal(f64Res.converged, true, "Pure f64 AMG-PCG reference must converge");
    assert.ok(mpRes.residualNorm < 1e-10, `Expected mixed-precision residual < 1e-10, got ${mpRes.residualNorm}`);
    assert.ok(
      mpRes.iterations < 20,
      `Expected mixed-precision FPCG to converge in < 20 iterations, got ${mpRes.iterations}`,
    );

    // Direct f64 residual verification
    const directRes = l2RelResidual(A, mpRes.x, b);
    assert.ok(directRes < 1e-10, `Direct f64 residual check must be < 1e-10, got ${directRes}`);

    // Solution agreement with pure f64 AMG-PCG
    const relErr = l2RelDiff(mpRes.x, f64Res.x);
    assert.ok(relErr < 1e-9, `Expected L2 relative error vs pure f64 < 1e-9, got ${relErr}`);

    // Preconditioner memory bandwidth reduction check
    assert.ok(
      mpRes.preconditionerBytesF32 < mpRes.equivalentBytesF64,
      "f32 preconditioner bytes must be strictly less than equivalent f64 bytes",
    );
    assert.ok(
      mpRes.bandwidthReductionPct >= 35,
      `Expected bandwidthReductionPct >= 35%, got ${mpRes.bandwidthReductionPct.toFixed(2)}%`,
    );

    // Also verify damped-Jacobi smoother variant in f32
    const mpJacobi = solvePcgMixedPrecisionAmg(A, b, {
      tolerance: 1e-10,
      maxIterations: 100,
      amg: { smoother: "jacobi", smootherSweeps: 2 },
    });
    assert.equal(mpJacobi.converged, true, "Mixed-precision FPCG (Jacobi smoother) must converge");
    assert.ok(mpJacobi.residualNorm < 1e-10, `Jacobi smoother residual must be < 1e-10`);

    console.log(
      `[Mixed-Precision SA-AMG FPCG 1024-DOF 100:1] ` +
        `iters=${mpRes.iterations} (f64 ref=${f64Res.iterations}), ` +
        `res=${mpRes.residualNorm.toExponential(2)}, ` +
        `relErrVsF64=${relErr.toExponential(2)}, ` +
        `bytesF32=${mpRes.preconditionerBytesF32}, bytesF64=${mpRes.equivalentBytesF64}, ` +
        `bwReduction=${mpRes.bandwidthReductionPct.toFixed(2)}%`,
    );
  });

  it("quantizes AMG hierarchy operators into Float32Array and preserves multi-level structure", () => {
    const precond = new MixedPrecisionAmgPreconditioner(A, {
      strengthThreshold: 0.25,
      maxCoarseSize: 64,
    });
    assert.ok(precond.numLevels >= 2, `Expected >= 2 AMG levels, got ${precond.numLevels}`);
    assert.ok(precond.coarseSize <= 64, `Expected coarse size <= 64, got ${precond.coarseSize}`);
    for (const lvl of precond.levels) {
      assert.ok(lvl.A.values instanceof Float32Array, "Level A.values must be Float32Array");
      assert.ok(lvl.diagInv instanceof Float32Array, "Level diagInv must be Float32Array");
      if (lvl.P) assert.ok(lvl.P.values instanceof Float32Array, "Level P.values must be Float32Array");
      if (lvl.R) assert.ok(lvl.R.values instanceof Float32Array, "Level R.values must be Float32Array");
    }
    assert.ok(
      precond.bandwidthReductionPct >= 35,
      `Expected bandwidthReductionPct >= 35%, got ${precond.bandwidthReductionPct.toFixed(2)}%`,
    );
  });

  it("mixed-precision iterative refinement achieves < 1e-10 f64 residual using f32 inner solves", () => {
    const irRes = solveMixedPrecisionIterativeRefinement(A, b, {
      tolerance: 1e-10,
      maxOuterIterations: 10,
      innerTolerance: 1e-5,
      innerMaxIterations: 25,
    });

    assert.equal(irRes.converged, true, "Mixed-precision iterative refinement must converge");
    assert.ok(irRes.residualNorm < 1e-10, `Expected IR residual < 1e-10, got ${irRes.residualNorm}`);

    const directRes = l2RelResidual(A, irRes.x, b);
    assert.ok(directRes < 1e-10, `Direct f64 residual check for IR must be < 1e-10, got ${directRes}`);
    assert.ok(
      irRes.bandwidthReductionPct >= 35,
      `Expected IR bandwidthReductionPct >= 35%, got ${irRes.bandwidthReductionPct.toFixed(2)}%`,
    );

    console.log(
      `[Mixed-Precision Iterative Refinement 1024-DOF 100:1] ` +
        `outerIters=${irRes.outerIterations}, innerIters=${irRes.innerIterations}, ` +
        `res=${irRes.residualNorm.toExponential(2)}, ` +
        `bwReduction=${irRes.bandwidthReductionPct.toFixed(2)}%`,
    );
  });
});
