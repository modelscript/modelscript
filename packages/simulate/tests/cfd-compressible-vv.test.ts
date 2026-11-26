// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CompressibleFieldArena } from "../src/cfd/compressible-arena.js";
import { CompressibleDgSolver, buildLagrangeDiffMatrix, getGllNodesAndWeights } from "../src/cfd/compressible-dg.js";
import { CompressibleFvmSolver, solveMatrixFreeGmres, sutherlandViscosity } from "../src/cfd/compressible-fvm.js";
import { COMPRESSIBLE_FVM_HLLC_WGSL } from "../src/cfd/shaders/compressible-fvm.wgsl.js";

/**
 * Exact analytical 1D Riemann solver for the Sod shock tube problem
 * (Toro, "Riemann Solvers and Numerical Methods for Fluid Dynamics", Ch. 4).
 */
function exactSodSolution(
  x: number,
  t: number,
  x0: number = 0.5,
  rhoL: number = 1.0,
  uL: number = 0.0,
  pL: number = 1.0,
  rhoR: number = 0.125,
  uR: number = 0.0,
  pR: number = 0.1,
  gamma: number = 1.4,
): { rho: number; u: number; p: number } {
  const gm1 = gamma - 1.0;
  const gp1 = gamma + 1.0;
  const cL = Math.sqrt((gamma * pL) / rhoL);
  const cR = Math.sqrt((gamma * pR) / rhoR);

  const AL = 2.0 / (gp1 * rhoL);
  const BL = (gm1 / gp1) * pL;
  const AR = 2.0 / (gp1 * rhoR);
  const BR = (gm1 / gp1) * pR;

  const fAndDf = (p: number, pk: number, ck: number, Ak: number, Bk: number): [number, number] => {
    if (p > pk) {
      const q = Math.sqrt(Ak / (p + Bk));
      const f = (p - pk) * q;
      const df = q * (1.0 - (0.5 * (p - pk)) / (p + Bk));
      return [f, df];
    }
    const pr = p / pk;
    const exp1 = gm1 / (2.0 * gamma);
    const f = ((2.0 * ck) / gm1) * (Math.pow(pr, exp1) - 1.0);
    const df = (1.0 / (rhoKFrom(pk, ck, gamma) * ck)) * Math.pow(pr, -gp1 / (2.0 * gamma));
    return [f, df];
  };

  const rhoKFrom = (pk: number, ck: number, g: number): number => (g * pk) / (ck * ck);

  // Newton-Raphson for p*
  let pStar = 0.5 * (pL + pR);
  for (let iter = 0; iter < 50; iter++) {
    const [fL, dfL] = fAndDf(pStar, pL, cL, AL, BL);
    const [fR, dfR] = fAndDf(pStar, pR, cR, AR, BR);
    const g = fL + fR + (uR - uL);
    const dg = dfL + dfR;
    const pNext = Math.max(pStar - g / dg, 1e-12);
    if (Math.abs(pNext - pStar) < 1e-13 * (1.0 + pStar)) {
      pStar = pNext;
      break;
    }
    pStar = pNext;
  }

  const [fL] = fAndDf(pStar, pL, cL, AL, BL);
  const [fR] = fAndDf(pStar, pR, cR, AR, BR);
  const uStar = 0.5 * (uL + uR) + 0.5 * (fR - fL);

  const s = (x - x0) / t;
  if (s <= uStar) {
    // Left of contact: rarefaction (since pStar < pL for Sod)
    const sHead = uL - cL;
    const cStarL = cL * Math.pow(pStar / pL, gm1 / (2.0 * gamma));
    const sTail = uStar - cStarL;
    if (s <= sHead) {
      return { rho: rhoL, u: uL, p: pL };
    }
    if (s >= sTail) {
      const rhoStarL = rhoL * Math.pow(pStar / pL, 1.0 / gamma);
      return { rho: rhoStarL, u: uStar, p: pStar };
    }
    const uFan = (2.0 / gp1) * (cL + 0.5 * gm1 * uL + s);
    const cFan = (2.0 / gp1) * (cL + 0.5 * gm1 * (uL - s));
    const rhoFan = rhoL * Math.pow(cFan / cL, 2.0 / gm1);
    const pFan = pL * Math.pow(cFan / cL, (2.0 * gamma) / gm1);
    return { rho: rhoFan, u: uFan, p: pFan };
  } else {
    // Right of contact: shock (since pStar > pR for Sod)
    const pr = pStar / pR;
    const sShock = uR + cR * Math.sqrt((gp1 / (2.0 * gamma)) * pr + gm1 / (2.0 * gamma));
    if (s >= sShock) {
      return { rho: rhoR, u: uR, p: pR };
    }
    const rhoStarR = rhoR * ((pr + gm1 / gp1) / ((gm1 / gp1) * pr + 1.0));
    return { rho: rhoStarR, u: uStar, p: pStar };
  }
}

function countBalancedBraces(src: string): boolean {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

describe("WS-B: Compressible Navier-Stokes FVM & Higher-Order Nodal DG V&V", () => {
  it("Sod Shock Tube (HLLC + MUSCL-minmod & Roe + Harten entropy fix) matches exact Riemann solution", () => {
    const nx = 200;
    const dx = 1.0 / nx;
    const tEnd = 0.2;

    for (const cfg of [
      { flux: "hllc" as const, limiter: "minmod" as const },
      { flux: "roe" as const, limiter: "venkatakrishnan" as const },
    ]) {
      const arena = new CompressibleFieldArena({ nx, dx, gamma: 1.4 });
      arena.initRiemann1D(0.5, { rho: 1.0, u: 0.0, p: 1.0 }, { rho: 0.125, u: 0.0, p: 0.1 });

      const solver = new CompressibleFvmSolver(arena, {
        flux: cfg.flux,
        limiter: cfg.limiter,
        reconstructionOrder: 2,
        bcX: "extrapolation",
        cfl: 0.45,
      });

      const { time, steps } = solver.advanceToTime(tEnd);
      assert.ok(Math.abs(time - tEnd) < 1e-10, `Reached t=${time} in ${steps} steps`);

      const pos = arena.checkPositivity();
      assert.ok(pos.valid, `${cfg.flux}: positivity violated (minRho=${pos.minRho}, minP=${pos.minPressure})`);
      assert.ok(pos.minRho > 0.05, `${cfg.flux}: minRho=${pos.minRho} should stay positive`);
      assert.ok(pos.minPressure > 0.05, `${cfg.flux}: minP=${pos.minPressure} should stay positive`);

      let l1Rho = 0.0;
      let l1P = 0.0;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx;
        const exact = exactSodSolution(x, tEnd);
        const prim = arena.getPrimitive(i);
        l1Rho += Math.abs(prim.rho - exact.rho) * dx;
        l1P += Math.abs(prim.p - exact.p) * dx;
      }

      assert.ok(l1Rho < 0.04, `${cfg.flux}/${cfg.limiter} Sod density L1 error ${l1Rho.toFixed(5)} must be < 0.04`);
      assert.ok(l1P < 0.04, `${cfg.flux}/${cfg.limiter} Sod pressure L1 error ${l1P.toFixed(5)} must be < 0.04`);
    }
  });

  it("Viscous Sutherland + Spalart-Allmaras / DDES 3D step preserves positivity and extracts macro fields", () => {
    const mu300 = sutherlandViscosity(300.0);
    assert.ok(mu300 > 1.7e-5 && mu300 < 2.0e-5, `Sutherland mu(300K) = ${mu300}`);

    const arena = new CompressibleFieldArena({
      nx: 6,
      ny: 4,
      nz: 4,
      dx: 0.05,
      includeSpalartAllmaras: true,
    });
    arena.initCustom((_x, y) => ({
      rho: 1.225,
      u: 50.0 * (0.2 + y),
      v: 0.0,
      w: 0.0,
      p: 101325.0,
      nuTilde: 1e-4,
    }));

    const solver = new CompressibleFvmSolver(arena, {
      flux: "hllc",
      limiter: "minmod",
      viscous: true,
      turbulence: "ddes",
      cfl: 0.3,
    });

    for (let s = 0; s < 3; s++) {
      solver.stepSspRk3();
    }

    const pos = arena.checkPositivity();
    assert.ok(pos.valid, `3D viscous DDES positivity failed: minRho=${pos.minRho}, minP=${pos.minPressure}`);
    const fields = arena.extractFields();
    assert.equal(fields.pressure.length, arena.totalCells);
    assert.ok((fields.temperature[0] ?? 0) > 200 && (fields.temperature[0] ?? 0) < 400);
    assert.ok((fields.mach[0] ?? 0) > 0 && (fields.mach[0] ?? 0) < 1.0);
  });

  it("Nodal DG (p = 1, 2, 3) achieves rapid p-convergence and O(h^(p+1)) mesh refinement order", () => {
    // Verify GLL weights sum to 2 and Lagrange diff matrix row sums vanish
    for (const p of [1, 2, 3] as const) {
      const { nodes, weights } = getGllNodesAndWeights(p);
      let wSum = 0.0;
      for (let i = 0; i < weights.length; i++) wSum += weights[i] ?? 0;
      assert.ok(Math.abs(wSum - 2.0) < 1e-14, `GLL weights for p=${p} sum to ${wSum}`);

      const D = buildLagrangeDiffMatrix(nodes);
      const n = nodes.length;
      for (let i = 0; i < n; i++) {
        let rowSum = 0.0;
        for (let j = 0; j < n; j++) rowSum += D[i * n + j] ?? 0;
        assert.ok(Math.abs(rowSum) < 1e-13, `Diff matrix row ${i} sum=${rowSum}`);
      }
    }

    const u0 = 1.0;
    const p0 = 1.0;
    const tEnd = 0.2;
    const exactRho = (x: number, t: number): number => 1.0 + 0.2 * Math.sin(2.0 * Math.PI * (x - u0 * t));

    const runDg = (order: 1 | 2 | 3, nx: number): number => {
      const dx = 1.0 / nx;
      const dg = new CompressibleDgSolver({
        nx,
        dx,
        order,
        gamma: 1.4,
        flux: "hllc",
        bcX: "periodic",
        cfl: 0.2,
      });
      dg.initFromFunction((x) => ({
        rho: exactRho(x, 0.0),
        u: u0,
        p: p0,
      }));
      // Use small fixed dt for p=3 so SSP-RK3 temporal error stays well below O(h^4) spatial error
      const dtFixed = order === 3 ? 2.5e-4 : undefined;
      dg.advanceToTime(tEnd, 50000, dtFixed);
      return dg.computeL2Error((x) => exactRho(x, tEnd), 0);
    };

    // 1. p-convergence at fixed mesh nx = 8
    const errP1N8 = runDg(1, 8);
    const errP2N8 = runDg(2, 8);
    const errP3N8 = runDg(3, 8);
    assert.ok(errP2N8 < errP1N8 * 0.15, `Expected rapid p-convergence p=1->2: errP1=${errP1N8}, errP2=${errP2N8}`);
    assert.ok(errP3N8 < errP2N8 * 0.15, `Expected rapid p-convergence p=2->3: errP2=${errP2N8}, errP3=${errP3N8}`);

    // 2. h-convergence O(h^(p+1)) for p = 1, 2, 3
    const errP1N16 = runDg(1, 16);
    const orderP1 = Math.log2(errP1N8 / errP1N16);
    assert.ok(orderP1 > 1.8, `DG p=1 observed order ${orderP1.toFixed(2)} (expected ~2)`);

    const errP2N16 = runDg(2, 16);
    const orderP2 = Math.log2(errP2N8 / errP2N16);
    assert.ok(orderP2 > 2.75, `DG p=2 observed order ${orderP2.toFixed(2)} (expected ~3)`);

    const errP3N16 = runDg(3, 16);
    const orderP3 = Math.log2(errP3N8 / errP3N16);
    assert.ok(orderP3 > 3.6, `DG p=3 observed order ${orderP3.toFixed(2)} (expected ~4)`);

    // 3. Smoke test 3D tensor-product Nodal DG (p=1, 3x3x3 elements)
    const dg3d = new CompressibleDgSolver({
      nx: 3,
      ny: 3,
      nz: 3,
      dx: 1.0 / 3.0,
      order: 1,
      flux: "rusanov",
      bcX: "periodic",
      bcY: "periodic",
      bcZ: "periodic",
    });
    dg3d.initFromFunction((x) => ({
      rho: 1.0 + 0.05 * Math.sin(2.0 * Math.PI * x),
      u: 0.5,
      v: 0.2,
      w: -0.1,
      p: 1.0,
    }));
    dg3d.stepSspRk3();
    assert.ok(Number.isFinite(dg3d.state[0] ?? NaN) && (dg3d.state[0] ?? 0) > 0.5);
  });

  it("Matrix-Free GMRES solves stiff linear system to < 1e-8 and drives implicit FVM pseudo-step", () => {
    const n = 64;
    // Stiff non-symmetric convection-diffusion operator with varying diagonal stiffness
    const matvec = (v: Float64Array, out: Float64Array): void => {
      for (let i = 0; i < n; i++) {
        const diag = 10.0 + 50.0 * (i / n);
        let sum = diag * (v[i] ?? 0);
        if (i > 0) sum -= 4.2 * (v[i - 1] ?? 0);
        if (i < n - 1) sum -= 1.8 * (v[i + 1] ?? 0);
        if (i + 4 < n) sum += 0.35 * (v[i + 4] ?? 0);
        out[i] = sum;
      }
    };

    const xExact = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xExact[i] = Math.sin((2.0 * Math.PI * (i + 1)) / n) + 0.5;
    }
    const b = new Float64Array(n);
    matvec(xExact, b);

    const res = solveMatrixFreeGmres(matvec, b, undefined, {
      restart: 30,
      maxIter: 200,
      tol: 1e-11,
    });

    assert.ok(res.converged, `GMRES failed to converge: relRes=${res.relativeResidual}`);
    assert.ok(res.relativeResidual < 1e-8, `GMRES relative residual ${res.relativeResidual} must be < 1e-8`);

    let maxErr = 0.0;
    for (let i = 0; i < n; i++) {
      maxErr = Math.max(maxErr, Math.abs((res.x[i] ?? 0) - (xExact[i] ?? 0)));
    }
    assert.ok(maxErr < 1e-7, `GMRES solution max error ${maxErr} too large`);

    // Implicit pseudo-timestep on a small compressible FVM grid
    const arena = new CompressibleFieldArena({ nx: 12, dx: 0.1 });
    arena.initCustom((x) => ({
      rho: 1.0 + 0.05 * Math.sin((2.0 * Math.PI * x) / 1.2),
      u: 0.5,
      p: 1.0,
    }));
    const fvm = new CompressibleFvmSolver(arena, {
      flux: "hllc",
      reconstructionOrder: 1,
      bcX: "periodic",
    });
    const imp = fvm.stepImplicitPseudoTime(0.05, { tol: 1e-9, restart: 30, maxIter: 120 });
    assert.ok(imp.converged && imp.relativeResidual < 1e-8, `Implicit FVM GMRES relRes=${imp.relativeResidual}`);
    assert.ok(arena.checkPositivity().valid, "Implicit pseudo-step must preserve positivity");
  });

  it("WGSL f32 and CUDA/HIP FP64 HLLC + SSP-RK3 kernels pass structural integrity assertions", () => {
    // WGSL f32 shader integrity
    assert.ok(COMPRESSIBLE_FVM_HLLC_WGSL.includes("@compute"), "WGSL missing @compute");
    assert.ok(COMPRESSIBLE_FVM_HLLC_WGSL.includes("fn compute_hllc_rhs"), "WGSL missing compute_hllc_rhs");
    assert.ok(COMPRESSIBLE_FVM_HLLC_WGSL.includes("fn ssp_rk3_update"), "WGSL missing ssp_rk3_update");
    assert.ok(COMPRESSIBLE_FVM_HLLC_WGSL.includes("fn hllc_flux_3d"), "WGSL missing hllc_flux_3d");
    assert.ok(COMPRESSIBLE_FVM_HLLC_WGSL.includes("sStar"), "WGSL missing HLLC contact wave speed");
    assert.ok(COMPRESSIBLE_FVM_HLLC_WGSL.includes("f32"), "WGSL missing f32 type");
    assert.ok(countBalancedBraces(COMPRESSIBLE_FVM_HLLC_WGSL), "WGSL has unbalanced braces");

    // CUDA/HIP FP64 kernel integrity
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cuPath = path.resolve(here, "../../native/src/kernels/cfd_compressible_fp64.cu");
    const cuSrc = readFileSync(cuPath, "utf8");

    assert.ok(
      cuSrc.includes('extern "C" __global__ void ms_cfd_compressible_hllc_rhs_fp64'),
      "CUDA/HIP kernel missing extern C __global__ HLLC RHS entry",
    );
    assert.ok(
      cuSrc.includes('extern "C" __global__ void ms_cfd_compressible_ssp_rk3_fp64'),
      "CUDA/HIP kernel missing extern C __global__ SSP-RK3 entry",
    );
    assert.ok(cuSrc.includes("const double* __restrict__"), "CUDA/HIP kernel must use native FP64 double pointers");
    assert.ok(cuSrc.includes("ms_hllc_flux_3d_fp64"), "CUDA/HIP kernel missing HLLC flux helper");
    assert.ok(cuSrc.includes("sStar"), "CUDA/HIP kernel missing HLLC contact speed");
    assert.ok(!cuSrc.includes("#include"), "NVRTC/hipRTC kernel should be self-contained without external headers");
    assert.ok(countBalancedBraces(cuSrc), "CUDA/HIP kernel has unbalanced braces");
  });
});
