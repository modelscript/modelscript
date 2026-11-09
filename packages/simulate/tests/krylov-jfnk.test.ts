// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  bicgstab,
  ccsMatVec,
  gmres,
  ilu0Factor,
  ilu0Preconditioner,
  ilu0Solve,
  jacobiPreconditioner,
  jfnkSolve,
  SparseTripletBuilder,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solveRadauIIA } from "../src/solvers/radau-iia.js";

describe("Preconditioned Iterative Krylov & Matrix-Free JFNK Solvers (Track 6)", () => {
  it("solves a sparse non-symmetric convection-diffusion system using GMRES(m) + ILU(0)", () => {
    const n = 80;
    const h = 1.0 / (n + 1);
    const peclet = 25.0; // Non-symmetric convection term
    const builder = new SparseTripletBuilder(n, n);

    for (let i = 0; i < n; i++) {
      const diag = 2.0 / (h * h);
      const west = -1.0 / (h * h) - peclet / (2.0 * h);
      const east = -1.0 / (h * h) + peclet / (2.0 * h);
      builder.add(i, i, diag);
      if (i > 0) builder.add(i, i - 1, west);
      if (i < n - 1) builder.add(i, i + 1, east);
      // Add slight non-tridiagonal bandwidth coupling
      if (i + 2 < n) builder.add(i, i + 2, 0.1 / (h * h));
      if (i - 2 >= 0) builder.add(i, i - 2, -0.05 / (h * h));
    }

    const A = builder.toCCS();
    const xExact = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xExact[i] = Math.sin(((i + 1) * Math.PI) / (n + 1));
    }

    const b = new Float64Array(n);
    ccsMatVec(A, xExact, b);

    const iluPrecond = ilu0Preconditioner(A);
    const resPrecond = gmres(A, b, {
      tol: 1e-11,
      restart: 20,
      maxIter: 100,
      preconditioner: iluPrecond,
    });

    assert.equal(resPrecond.converged, true, "ILU(0)-preconditioned GMRES should converge");
    assert.ok(resPrecond.iterations <= 15, `Expected <= 15 iterations with ILU(0), got ${resPrecond.iterations}`);

    for (let i = 0; i < n; i++) {
      assert.ok(
        Math.abs(resPrecond.x[i]! - xExact[i]!) < 1e-9,
        `Component ${i} error too large: ${Math.abs(resPrecond.x[i]! - xExact[i]!)}`,
      );
    }
  });

  it("solves a sparse non-symmetric system using BiCGStab + ILU(0) and Jacobi preconditioners", () => {
    const n = 60;
    const builder = new SparseTripletBuilder(n, n);
    for (let i = 0; i < n; i++) {
      builder.add(i, i, 5.0 + 0.1 * i);
      if (i > 0) builder.add(i, i - 1, -1.8);
      if (i < n - 1) builder.add(i, i + 1, -1.2);
      if (i + 3 < n) builder.add(i, i + 3, 0.3);
    }
    const A = builder.toCCS();
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = 1.0 + Math.cos(0.2 * i);

    const ilu = ilu0Factor(A);
    const resBicg = bicgstab(A, b, {
      tol: 1e-11,
      maxIter: 100,
      preconditioner: (r, out) => ilu0Solve(ilu, r, out),
    });

    assert.equal(resBicg.converged, true, "BiCGStab + ILU(0) should converge");
    assert.ok(resBicg.residualNorm < 1e-9, `Residual norm ${resBicg.residualNorm} should be < 1e-9`);

    const jacPrecond = jacobiPreconditioner(A);
    const resJac = bicgstab(A, b, {
      tol: 1e-10,
      maxIter: 150,
      preconditioner: jacPrecond,
    });
    assert.equal(resJac.converged, true, "BiCGStab + Jacobi should converge");

    for (let i = 0; i < n; i++) {
      assert.ok(Math.abs(resBicg.x[i]! - resJac.x[i]!) < 1e-8);
    }
  });

  it("solves a nonlinear Bratu reaction-diffusion system using Matrix-Free JFNK without forming a Jacobian", () => {
    // 1D Bratu nonlinear boundary value problem: -u'' - lambda * exp(u) = 0 on (0, 1), u(0)=u(1)=0
    const n = 50;
    const h = 1.0 / (n + 1);
    const lambda = 1.0;

    const residualFn = (u: Float64Array, outF: Float64Array): void => {
      for (let i = 0; i < n; i++) {
        const uLeft = i > 0 ? u[i - 1]! : 0.0;
        const uRight = i < n - 1 ? u[i + 1]! : 0.0;
        const uCenter = u[i]!;
        const lap = (uLeft - 2.0 * uCenter + uRight) / (h * h);
        outF[i] = -lap - lambda * Math.exp(uCenter);
      }
    };

    const u0 = new Float64Array(n); // Initial guess u = 0
    const jfnkRes = jfnkSolve(residualFn, u0, {
      tol: 1e-9,
      maxNewtonIter: 15,
      krylovTol: 1e-5,
      maxKrylovIter: 60,
      restart: 50,
    });

    assert.equal(jfnkRes.converged, true, "Matrix-Free JFNK should converge on Bratu BVP");
    assert.ok(jfnkRes.residualNorm < 1e-9, `Expected residual < 1e-9, got ${jfnkRes.residualNorm}`);
    // Midpoint of Bratu problem for lambda = 1.0 is ~0.1405
    const midVal = jfnkRes.x[Math.floor(n / 2)]!;
    assert.ok(midVal > 0.13 && midVal < 0.15, `Expected Bratu midpoint ~0.1405, got ${midVal}`);
  });

  it("integrates a stiff discretized heat-reaction PDE in Radau IIA using linearSolver: 'jfnk' with zero Jacobian evaluations", () => {
    const n = 20;
    const alpha = 0.25;
    const dx = 1.0 / (n + 1);
    const y0 = Array.from({ length: n }, (_, i) => Math.sin(((i + 1) * Math.PI) / (n + 1)));

    const problem = {
      tSpan: [0, 0.2] as [number, number],
      y0,
      f: (_t: number, y: number[]) => {
        const dy = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          const left = i > 0 ? y[i - 1]! : 0.0;
          const right = i < n - 1 ? y[i + 1]! : 0.0;
          const center = y[i]!;
          dy[i] = alpha * ((left - 2.0 * center + right) / (dx * dx)) - 0.5 * center * center;
        }
        return dy;
      },
    };

    const resDirect = solveRadauIIA(problem, {
      order: 5,
      atol: 1e-7,
      rtol: 1e-6,
      linearSolver: "direct",
    });

    const resJfnk = solveRadauIIA(problem, {
      order: 5,
      atol: 1e-7,
      rtol: 1e-6,
      linearSolver: "jfnk",
    });

    assert.equal(resJfnk.stats.converged, true, "Radau IIA with JFNK should converge");
    assert.equal(resJfnk.stats.jacobianEvals, 0, "JFNK mode should perform 0 dense Jacobian evaluations");
    assert.equal(resJfnk.stats.luFactorizations, 0, "JFNK mode should perform 0 LU factorizations");

    const finalDirect = resDirect.states[resDirect.states.length - 1]!;
    const finalJfnk = resJfnk.states[resJfnk.states.length - 1]!;
    for (let i = 0; i < n; i++) {
      assert.ok(
        Math.abs(finalDirect[i]! - finalJfnk[i]!) < 1e-4,
        `JFNK vs Direct mismatch at node ${i}: ${finalJfnk[i]} vs ${finalDirect[i]}`,
      );
    }
  });
});
