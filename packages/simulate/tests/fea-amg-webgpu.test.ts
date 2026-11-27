// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  computeLaminateABD,
  computeOrthotropicConstitutiveMatrix,
  type LaminatePly,
  returnMapJ2Plasticity,
} from "../src/fea/aerospace-materials.js";
import {
  type CsrMatrix,
  SmoothedAggregationAmg,
  solvePcgAmg,
  solvePcgJacobi,
  spmvCsr,
} from "../src/fea/amg-preconditioner.js";
import { FEA_CSR_SPMV_WGSL, FEA_DAMPED_JACOBI_WGSL } from "../src/fea/shaders/fea-spmv-amg.wgsl.js";
import { Tet4Element } from "../src/fea/tet4-stiffness.js";

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

describe("WS-D: Smoothed-Aggregation AMG Preconditioner + Aerospace Materials + GPU Kernels", () => {
  it("converges < 1e-8 on 1024-DOF 100:1 anisotropic 3D SPD system in far fewer iterations than Jacobi PCG", () => {
    const nx = 16;
    const ny = 8;
    const nz = 8;
    const A = build3DAnisotropicPoissonCsr(nx, ny, nz, 100.0, 1.0, 1.0);
    assert.equal(A.n, 1024);

    // Smooth + oscillatory RHS to exercise all frequency modes
    const b = new Float64Array(A.n);
    for (let i = 0; i < A.n; i++) {
      b[i] = 1.0 + 0.5 * Math.sin(0.13 * i) + 0.25 * Math.cos(0.37 * i);
    }

    const amg = new SmoothedAggregationAmg(A, { strengthThreshold: 0.25, maxCoarseSize: 64 });
    assert.ok(amg.numLevels >= 2, `Expected multi-level AMG hierarchy, got ${amg.numLevels} levels`);
    assert.ok(amg.coarseSize <= 64, `Expected coarse size <= 64, got ${amg.coarseSize}`);

    const amgRes = solvePcgAmg(A, b, { tolerance: 1e-8, maxIterations: 200 });
    const jacobiRes = solvePcgJacobi(A, b, { tolerance: 1e-8, maxIterations: 500 });

    assert.equal(amgRes.converged, true, "AMG-PCG must converge");
    assert.equal(jacobiRes.converged, true, "Jacobi-PCG must converge");
    assert.ok(amgRes.residualNorm < 1e-8, `AMG residual ${amgRes.residualNorm} must be < 1e-8`);
    assert.ok(amgRes.iterations < 20, `AMG-PCG should converge in < 20 iterations, got ${amgRes.iterations}`);
    assert.ok(jacobiRes.iterations > 40, `Jacobi-PCG should take > 40 iterations, got ${jacobiRes.iterations}`);
    assert.ok(
      amgRes.iterations * 2 < jacobiRes.iterations,
      `AMG-PCG (${amgRes.iterations}) should be at least 2x fewer iterations than Jacobi-PCG (${jacobiRes.iterations})`,
    );

    // Verify both solutions agree and satisfy A * x = b
    const Ax = new Float64Array(A.n);
    spmvCsr(A, amgRes.x, Ax);
    let errSq = 0.0;
    let bSq = 0.0;
    let diffMax = 0.0;
    for (let i = 0; i < A.n; i++) {
      const r = b[i] - Ax[i];
      errSq += r * r;
      bSq += b[i] * b[i];
      diffMax = Math.max(diffMax, Math.abs(amgRes.x[i] - jacobiRes.x[i]));
    }
    assert.ok(Math.sqrt(errSq / bSq) < 1e-8, "Direct residual check must be < 1e-8");
    assert.ok(diffMax < 1e-6, `AMG and Jacobi solutions should agree, max diff = ${diffMax}`);

    // Also verify damped-Jacobi smoother variant converges cleanly
    const amgJacobiSmooth = solvePcgAmg(A, b, {
      tolerance: 1e-8,
      maxIterations: 200,
      amg: { smoother: "jacobi", smootherSweeps: 2 },
    });
    assert.equal(amgJacobiSmooth.converged, true, "AMG-PCG (damped-Jacobi smoother) must converge");
    assert.ok(
      amgJacobiSmooth.iterations < 25,
      `AMG-PCG (damped-Jacobi) expected < 25 iterations, got ${amgJacobiSmooth.iterations}`,
    );

    console.log(
      `[SA-AMG 1024-DOF 100:1 Anisotropic] levels=${amg.numLevels}, coarse=${amg.coarseSize}, ` +
        `AMG-PCG(Chebyshev)=${amgRes.iterations} iters (res=${amgRes.residualNorm.toExponential(2)}), ` +
        `AMG-PCG(Jacobi)=${amgJacobiSmooth.iterations} iters, ` +
        `Jacobi-PCG=${jacobiRes.iterations} iters (res=${jacobiRes.residualNorm.toExponential(2)})`,
    );
  });

  it("orthotropic constitutive matrix reduces identically to isotropic elasticity and supports CFRP", () => {
    const E = 70e9; // 70 GPa aluminum
    const nu = 0.33;
    const G = E / (2.0 * (1.0 + nu));

    const D_ortho = computeOrthotropicConstitutiveMatrix({
      E1: E,
      E2: E,
      E3: E,
      nu12: nu,
      nu23: nu,
      nu13: nu,
      G12: G,
      G23: G,
      G13: G,
    });
    const D_iso = Tet4Element.computeConstitutiveMatrix({ E, nu });

    assert.equal(D_ortho.length, 36);
    for (let i = 0; i < 36; i++) {
      assert.ok(
        Math.abs(D_ortho[i] - D_iso[i]) <= 1e-5 * Math.max(1.0, Math.abs(D_iso[i])),
        `Mismatch at index ${i}: ortho=${D_ortho[i]}, iso=${D_iso[i]}`,
      );
    }

    // Typical IM7/8552 aerospace CFRP unidirectional lamina
    const D_cfrp = computeOrthotropicConstitutiveMatrix({
      E1: 161e9,
      E2: 11.4e9,
      E3: 11.4e9,
      nu12: 0.32,
      nu23: 0.43,
      nu13: 0.32,
      G12: 5.17e9,
      G23: 3.98e9,
      G13: 5.17e9,
    });
    // Symmetry check D_ij == D_ji and fiber stiffness >> transverse stiffness
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        assert.ok(
          Math.abs(D_cfrp[i * 6 + j] - D_cfrp[j * 6 + i]) <= 1e-6 * Math.max(1.0, Math.abs(D_cfrp[i * 6 + j])),
          `D_cfrp must be symmetric at (${i}, ${j})`,
        );
      }
    }
    assert.ok(D_cfrp[0] > 10.0 * D_cfrp[7], "CFRP fiber-direction D11 must be >> transverse D22");
  });

  it("Classical Laminate Theory yields B = 0 for symmetric [0/45/-45/90]s quasi-isotropic CFRP", () => {
    const basePly = {
      E1: 161e9,
      E2: 11.4e9,
      nu12: 0.32,
      G12: 5.17e9,
      thickness: 0.125e-3, // 0.125 mm per ply
    };
    const anglesSym = [0, 45, -45, 90, 90, -45, 45, 0];
    const pliesSym: LaminatePly[] = anglesSym.map((angleDeg) => ({ ...basePly, angleDeg }));

    const { A, B, D, ABD, totalThickness } = computeLaminateABD(pliesSym);
    assert.ok(Math.abs(totalThickness - 1.0e-3) < 1e-12, "8 plies * 0.125mm = 1.0mm");

    // B must vanish identically for symmetric stackup
    for (let i = 0; i < 9; i++) {
      assert.ok(Math.abs(B[i]) < 1e-6, `Expected B[${i}] == 0 for symmetric laminate, got ${B[i]}`);
    }

    // Quasi-isotropic [0/45/-45/90]s has A11 == A22 and A16 == A26 == 0
    assert.ok(Math.abs(A[0] - A[4]) / A[0] < 1e-12, "Quasi-isotropic laminate must have A11 == A22");
    assert.ok(Math.abs(A[2]) / A[0] < 1e-12, "Balanced symmetric laminate must have A16 == 0");
    assert.ok(Math.abs(A[5]) / A[0] < 1e-12, "Balanced symmetric laminate must have A26 == 0");
    assert.ok(D[0] > 0 && D[4] > 0 && D[8] > 0, "Bending stiffness D diagonal must be positive");
    assert.equal(ABD.length, 36);

    // Unsymmetric [0/90] laminate must have non-zero bending-extension coupling B
    const unsym = computeLaminateABD([
      { ...basePly, angleDeg: 0 },
      { ...basePly, angleDeg: 90 },
    ]);
    assert.ok(Math.abs(unsym.B[0]) > 1e3, "Unsymmetric [0/90] laminate must have non-zero B11");
  });

  it("J2 von Mises radial return mapping projects over-yield trial stress exactly onto yield surface", () => {
    const E = 210e9; // 210 GPa steel / Ti alloy
    const nu = 0.3;
    const yieldStress = 400e6; // 400 MPa
    const H = 20e9; // 20 GPa linear isotropic hardening

    // 1. Elastic trial stress (below yield)
    const elasticTrial = new Float64Array([200e6, 50e6, 20e6, 30e6, -15e6, 10e6]);
    const elRes = returnMapJ2Plasticity(elasticTrial, 0.0, E, nu, yieldStress, H);
    assert.equal(elRes.yielded, false);
    assert.equal(elRes.deltaPlasticStrain, 0.0);
    for (let i = 0; i < 6; i++) {
      assert.equal(elRes.stress[i], elasticTrial[i]);
    }

    // 2. Over-yield general 3D stress state with prior plastic strain eps_p = 0.002
    const epsP0 = 0.002;
    const plasticTrial = new Float64Array([650e6, -120e6, 80e6, 180e6, -90e6, 110e6]);
    const plRes = returnMapJ2Plasticity(plasticTrial, epsP0, E, nu, yieldStress, H);

    assert.equal(plRes.yielded, true);
    assert.ok(plRes.deltaPlasticStrain > 0, "Delta plastic strain must be > 0");
    assert.ok(Math.abs(plRes.eqPlasticStrain - (epsP0 + plRes.deltaPlasticStrain)) < 1e-15);

    // Exact yield surface condition: sigma_vm == (yieldStress + H * eps_p^n) + H * Delta(eps_p)
    const expectedYield = yieldStress + H * epsP0 + H * plRes.deltaPlasticStrain;
    assert.ok(
      Math.abs(plRes.vonMisesStress - expectedYield) <= 1e-10 * expectedYield,
      `sigma_vm (${plRes.vonMisesStress}) must equal sigma_y + H * deps_p (${expectedYield})`,
    );

    // Hydrostatic pressure must be preserved by J2 deviatoric return mapping
    const pTrial = (plasticTrial[0] + plasticTrial[1] + plasticTrial[2]) / 3.0;
    const pReturned = (plRes.stress[0] + plRes.stress[1] + plRes.stress[2]) / 3.0;
    assert.ok(Math.abs(pReturned - pTrial) <= 1e-9 * Math.abs(pTrial), "Mean stress must be invariant");

    // Plastic strain increment must be volume-preserving (tr(deps_p) == 0)
    const tracePl =
      plRes.plasticStrainIncrement6[0] + plRes.plasticStrainIncrement6[1] + plRes.plasticStrainIncrement6[2];
    assert.ok(Math.abs(tracePl) < 1e-14, `J2 plastic flow must be isochoric, tr(deps_p) = ${tracePl}`);

    // Consistent tangent C_ep must be symmetric
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        assert.ok(
          Math.abs(plRes.consistentTangent[i * 6 + j] - plRes.consistentTangent[j * 6 + i]) <= 1e-4,
          `Consistent tangent must be symmetric at (${i}, ${j})`,
        );
      }
    }
  });

  it("provides valid WebGPU WGSL shaders and native FP64 CUDA/HIP FEA AMG kernels", () => {
    // WebGPU WGSL shaders
    assert.ok(FEA_CSR_SPMV_WGSL.includes("@compute @workgroup_size(64)"));
    assert.ok(FEA_CSR_SPMV_WGSL.includes("fn csr_spmv"));
    assert.ok(FEA_CSR_SPMV_WGSL.includes("rowOffsets"));
    assert.ok(FEA_CSR_SPMV_WGSL.includes("colIndices"));

    assert.ok(FEA_DAMPED_JACOBI_WGSL.includes("@compute @workgroup_size(64)"));
    assert.ok(FEA_DAMPED_JACOBI_WGSL.includes("fn damped_jacobi_smooth"));
    assert.ok(FEA_DAMPED_JACOBI_WGSL.includes("params.omega * invDiag[row] * residual"));

    // Native FP64 CUDA/HIP kernel file
    const cuPath = new URL("../../native/src/kernels/fea_amg_fp64.cu", import.meta.url);
    const cuSrc = readFileSync(cuPath, "utf8");
    assert.ok(cuSrc.includes("#include <cuda_runtime.h>"));
    assert.ok(cuSrc.includes("#include <hip/hip_runtime.h>"));
    assert.ok(cuSrc.includes("__global__ void ms_fea_csr_spmv_fp64"));
    assert.ok(cuSrc.includes("__global__ void ms_fea_damped_jacobi_fp64"));
    assert.ok(cuSrc.includes("__global__ void ms_fea_axpy_fp64"));
    assert.ok(cuSrc.includes("__global__ void ms_fea_dot_fp64"));
    assert.ok(cuSrc.includes("const double* __restrict__"));
    assert.ok(!cuSrc.includes("vec2<f32>"), "Native FP64 kernel must not use emulated double-single");
  });
});
