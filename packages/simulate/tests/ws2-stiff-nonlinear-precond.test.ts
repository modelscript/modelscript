// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  amgPreconditioner,
  broydenSolve,
  ccsMatVec,
  denseToCCS,
  gmres,
  ilutPreconditioner,
  nonlinearPolyalgorithmSolve,
  trustRegionSolve,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoCompositeSolve, rodas5p } from "../src/solvers/rodas5p.js";

describe("WS2: Rodas5P, AutoComposite, Nonlinear Polyalgorithm & ILUT/AMG Preconditioners", () => {
  it("Rodas5P accurately integrates stiff Robertson chemical kinetics and index-1 DAE", () => {
    // Stiff linear/nonlinear test: dy/dt = -1000*(y - cos(t)) - sin(t), exact y(t) = cos(t)
    const fStiff = (t: number, y: number[]) => [-1000 * (y[0]! - Math.cos(t)) - Math.sin(t)];
    const res = rodas5p(fStiff, 0, [1.0], 2.0, [0, 0.5, 1.0, 2.0], { rtol: 1e-7, atol: 1e-9 });
    assert.equal(res.success, true);
    const yEnd = res.y[res.y.length - 1]![0]!;
    assert.ok(Math.abs(yEnd - Math.cos(2.0)) < 1e-5, `Expected cos(2)=${Math.cos(2)}, got ${yEnd}`);

    // Index-1 DAE with singular mass matrix M = [[1, 0], [0, 0]]:
    //   dx/dt = -z,  0 = z - 2*x  => x(t) = exp(-2t), z(t) = 2*exp(-2t)
    const fDae = (_t: number, y: number[]) => [-y[1]!, y[1]! - 2 * y[0]!];
    const M = [
      [1, 0],
      [0, 0],
    ];
    const daeRes = rodas5p(fDae, 0, [1.0, 2.0], 1.0, [0, 0.5, 1.0], { rtol: 1e-7, atol: 1e-9 }, M);
    assert.equal(daeRes.success, true);
    const xEnd = daeRes.y[daeRes.y.length - 1]![0]!;
    const zEnd = daeRes.y[daeRes.y.length - 1]![1]!;
    assert.ok(Math.abs(xEnd - Math.exp(-2)) < 1e-5, `Expected e^-2, got ${xEnd}`);
    assert.ok(Math.abs(zEnd - 2 * Math.exp(-2)) < 1e-5, `Expected 2e^-2, got ${zEnd}`);
  });

  it("autoCompositeSolve uses Tsit5 for non-stiff and automatically switches to Rodas5P for stiff systems", () => {
    // Non-stiff harmonic oscillator
    const nonStiff = autoCompositeSolve((_t, y) => [y[1]!, -y[0]!], 0, [1, 0], 1.0, undefined, { rtol: 1e-6 });
    assert.equal(nonStiff.success, true);
    assert.equal(nonStiff.switchedToStiff, false);

    // Stiff decay
    const stiff = autoCompositeSolve((_t, y) => [-5000 * y[0]!], 0, [1.0], 1.0, undefined, { rtol: 1e-6, atol: 1e-9 });
    assert.equal(stiff.success, true);
    assert.equal(stiff.switchedToStiff, true);
    assert.ok(Math.abs(stiff.y[stiff.y.length - 1]![0]!) < 1e-6);
  });

  it("Trust-Region, Broyden, and Polyalgorithm solve nonlinear Rosenbrock & singular-start roots", () => {
    // Rosenbrock root: F1 = 1 - x1, F2 = 10*(x2 - x1^2) -> root (1, 1)
    const fRosen = (x: Float64Array, out: Float64Array) => {
      out[0] = 1 - x[0]!;
      out[1] = 10 * (x[1]! - x[0]! * x[0]!);
    };

    const tr = trustRegionSolve(fRosen, new Float64Array([-1.2, 1.0]), { tol: 1e-10 });
    assert.equal(tr.converged, true);
    assert.ok(Math.abs(tr.x[0]! - 1) < 1e-8 && Math.abs(tr.x[1]! - 1) < 1e-8);

    const br = broydenSolve(fRosen, new Float64Array([0.5, 0.5]), { tol: 1e-9 });
    assert.equal(br.converged, true);
    assert.ok(Math.abs(br.x[0]! - 1) < 1e-7 && Math.abs(br.x[1]! - 1) < 1e-7);

    const poly = nonlinearPolyalgorithmSolve(fRosen, new Float64Array([-2.0, 2.0]), { tol: 1e-10 });
    assert.equal(poly.converged, true);
    assert.ok(poly.residualNorm < 1e-9);
  });

  it("ILUT and AMG preconditioners accelerate GMRES on sparse 1D/2D elliptic systems", () => {
    // 64-node 2D-coupled elliptic Poisson matrix (8×8 grid): 5-point stencil with slight diagonal shift
    const g = 8;
    const n = g * g;
    const dense: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
    for (let r = 0; r < g; r++) {
      for (let c = 0; c < g; c++) {
        const idx = r * g + c;
        dense[idx]![idx] = 4.02;
        if (r > 0) dense[idx]![(r - 1) * g + c] = -1.0;
        if (r < g - 1) dense[idx]![(r + 1) * g + c] = -1.0;
        if (c > 0) dense[idx]![r * g + (c - 1)] = -1.0;
        if (c < g - 1) dense[idx]![r * g + (c + 1)] = -1.0;
      }
    }
    const A = denseToCCS(dense, n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.sin(i + 1) + 0.3 * ((i * 7) % 11);
    const matvec = (v: Float64Array, out: Float64Array) => ccsMatVec(A, v, out);

    const plain = gmres(matvec, b, { tol: 1e-9, maxIter: 200, restart: 30 });
    const ilutPre = ilutPreconditioner(A, { maxFill: 15, dropTol: 1e-4 });
    const withIlut = gmres(matvec, b, { tol: 1e-9, maxIter: 200, restart: 30, preconditioner: ilutPre });

    const amgPre = amgPreconditioner(A, { smoothingSweeps: 2, maxLevels: 4 });
    const withAmg = gmres(matvec, b, { tol: 1e-9, maxIter: 200, restart: 30, preconditioner: amgPre });

    assert.equal(withIlut.converged, true);
    assert.equal(withAmg.converged, true);
    assert.ok(
      withIlut.iterations < plain.iterations,
      `ILUT (${withIlut.iterations}) should beat plain GMRES (${plain.iterations})`,
    );
    assert.ok(
      withAmg.iterations < plain.iterations,
      `AMG (${withAmg.iterations}) should beat plain GMRES (${plain.iterations})`,
    );
  });
});
