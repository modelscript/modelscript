// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  arnoldiIteration,
  computeHessenbergEigenvalues,
  daeShiftInvertArnoldi,
  type LinearOperator,
  sparseArnoldiEigensolver,
} from "../src/solvers/sparse_arnoldi.js";
import { SparseTripletBuilder } from "../src/solvers/sparse_lu.js";

test("arnoldiIteration: generates orthonormal Krylov basis and upper Hessenberg matrix", () => {
  const n = 10;
  // Construct symmetric tridiagonal test matrix
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    A[i * n + i] = 4.0;
    if (i > 0) A[i * n + (i - 1)] = -1.0;
    if (i < n - 1) A[i * n + (i + 1)] = -1.0;
  }

  const op: LinearOperator = {
    dim: n,
    apply: (v: Float64Array, out: Float64Array) => {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += A[i * n + j]! * v[j]!;
        out[i] = sum;
      }
    },
  };

  const m = 6;
  const { V, H, actualSteps } = arnoldiIteration(op, m);
  assert.strictEqual(actualSteps, m);

  // Check orthogonality: V_m^T * V_m = I
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let dot = 0;
      for (let k = 0; k < n; k++) {
        dot += V[i * n + k]! * V[j * n + k]!;
      }
      const expected = i === j ? 1.0 : 0.0;
      assert.ok(
        Math.abs(dot - expected) < 1e-10,
        `V_m orthogonality violated at (${i}, ${j}): got ${dot}, expected ${expected}`,
      );
    }
  }

  // Check Upper Hessenberg structure: H[i, j] = 0 for i > j + 1
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j < m; j++) {
      if (i > j + 1) {
        assert.strictEqual(H[i * m + j], 0, `H should be zero at (${i}, ${j})`);
      }
    }
  }
});

test("computeHessenbergEigenvalues: Francis QR correctly finds real and complex conjugate pairs", () => {
  // 4x4 upper Hessenberg matrix with known eigenvalues:
  // lambda = -0.5 +/- 2j (oscillation mode) and lambda = -2, -5
  // Characteristic polynomial: (s^2 + s + 4.25)(s + 2)(s + 5)
  // Let's create an explicit 4x4 companion-like Hessenberg matrix
  const m = 4;
  const H = new Float64Array(m * m);
  // Diagonal and upper triangular:
  H[0 * m + 0] = -0.5;
  H[0 * m + 1] = -2.0;
  H[1 * m + 0] = 2.0;
  H[1 * m + 1] = -0.5;
  H[1 * m + 2] = 1.0;
  H[2 * m + 2] = -2.0;
  H[2 * m + 3] = 3.0;
  H[3 * m + 3] = -5.0;

  const evs = computeHessenbergEigenvalues(H, m);
  assert.strictEqual(evs.length, 4);

  // Check that complex pair -0.5 +/- 2j was extracted
  const complexPair = evs.filter((e) => Math.abs(Math.abs(e.im) - 2.0) < 1e-3);
  assert.strictEqual(complexPair.length, 2);
  for (const cp of complexPair) {
    assert.ok(Math.abs(cp.re - (-0.5)) < 1e-3, `Expected real part -0.5, got ${cp.re}`);
  }

  // Check real eigenvalues -2 and -5
  const realEvs = evs.filter((e) => Math.abs(e.im) < 1e-4).map((e) => e.re);
  assert.ok(realEvs.some((r) => Math.abs(r - (-2.0)) < 1e-3), "Should contain -2.0");
  assert.ok(realEvs.some((r) => Math.abs(r - (-5.0)) < 1e-3), "Should contain -5.0");
});

test("sparseArnoldiEigensolver: extracts dominant oscillatory modes with damping ratios", () => {
  // Construct a 20x20 matrix representing electromechanical power grid dynamics
  // with a dominant poorly-damped inter-area mode at -0.1 +/- 2*pi*0.5j (0.5 Hz, ~3% damping)
  const n = 20;
  const A = new Float64Array(n * n);

  // Stable background modes on diagonal
  for (let i = 2; i < n; i++) {
    A[i * n + i] = -(0.5 + 0.1 * (i - 2));
  }

  // Inject 0.5 Hz oscillation between states 0 and 1:
  // dot(x0) = -0.1*x0 - 3.14159*x1
  // dot(x1) = 3.14159*x0 - 0.1*x1
  const omega = 2.0 * Math.PI * 0.5; // ~3.14159 rad/s (0.5 Hz)
  A[0 * n + 0] = -0.1;
  A[0 * n + 1] = -omega;
  A[1 * n + 0] = omega;
  A[1 * n + 1] = -0.1;

  // Weak inter-state coupling
  for (let i = 2; i < n; i++) {
    A[0 * n + i] = 0.05 / i;
    A[i * n + 0] = 0.02 / i;
  }

  const op: LinearOperator = {
    dim: n,
    apply: (v, out) => {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += A[i * n + j]! * v[j]!;
        out[i] = sum;
      }
    },
  };

  const res = sparseArnoldiEigensolver(op, {
    k: 6,
    m: 14,
    which: "LM",
  });

  assert.ok(res.eigenvalues.length >= 4);

  // Find the oscillatory mode
  const oscMode = res.eigenvalues.find(
    (e) => Math.abs(e.frequencyHz - 0.5) < 0.05 && Math.abs(e.real - (-0.1)) < 0.05,
  );
  assert.ok(oscMode, "Must detect the 0.5 Hz electromechanical mode");
  assert.ok(oscMode.dampingRatio > 0.01 && oscMode.dampingRatio < 0.06, `Damping ratio should be ~3%, got ${oscMode.dampingRatio}`);
  assert.ok(oscMode.residualNorm < 1e-4, `Residual norm should be small, got ${oscMode.residualNorm}`);
});

test("daeShiftInvertArnoldi: solves DAE modal modes without dense A_red formation", () => {
  // Differential states x (nx = 2: delta, omega)
  // Algebraic states y (ny = 2: Vr, Vi)
  // Total dimension = 4
  const nx = 2;
  const ny = 2;

  // fx block (nx x nx):
  // [  0,   1  ]
  // [ -10, -0.2]
  const fxB = new SparseTripletBuilder(nx, nx);
  fxB.add(0, 1, 1.0);
  fxB.add(1, 0, -10.0);
  fxB.add(1, 1, -0.2);
  const fx = fxB.toCCS();

  // fy block (nx x ny):
  // [ 0,  0 ]
  // [ 2, -1 ]
  const fyB = new SparseTripletBuilder(nx, ny);
  fyB.add(1, 0, 2.0);
  fyB.add(1, 1, -1.0);
  const fy = fyB.toCCS();

  // gx block (ny x nx):
  // [ 1, 0 ]
  // [ 0, 0 ]
  const gxB = new SparseTripletBuilder(ny, nx);
  gxB.add(0, 0, 1.0);
  const gx = gxB.toCCS();

  // gy block (ny x ny): diagonal admittance
  // [ 4, 0 ]
  // [ 0, 2 ]
  const gyB = new SparseTripletBuilder(ny, ny);
  gyB.add(0, 0, 4.0);
  gyB.add(1, 1, 2.0);
  const gy = gyB.toCCS();

  // Analytical A_red = fx - fy * gy^-1 * gx:
  // gy^-1 = [ 0.25, 0; 0, 0.5 ]
  // fy * gy^-1 = [ 0, 0; 2*0.25, -1*0.5 ] = [ 0, 0; 0.5, -0.5 ]
  // fy * gy^-1 * gx = [ 0, 0; 0.5*1 + (-0.5)*0, 0 ] = [ 0, 0; 0.5, 0 ]
  // A_red = [ 0, 1; -10 - 0.5, -0.2 ] = [ 0, 1; -10.5, -0.2 ]
  // Trace = -0.2, Det = 10.5
  // Char poly: s^2 + 0.2*s + 10.5 = 0
  // Roots: -0.1 +/- sqrt(0.01 - 10.5) = -0.1 +/- j*sqrt(10.49) = -0.1 +/- j*3.2388
  // Natural freq = sqrt(10.5) ≈ 3.2404 rad/s => f ≈ 0.5157 Hz

  const res = daeShiftInvertArnoldi(fx, fy, gx, gy, {
    shift: -0.1,
    k: 2,
    m: 4,
  });

  assert.strictEqual(res.eigenvalues.length, 2);
  const mode = res.eigenvalues[0]!;
  assert.ok(Math.abs(mode.real - (-0.1)) < 0.05, `Expected real part ≈ -0.1, got ${mode.real}`);
  assert.ok(Math.abs(Math.abs(mode.imag) - 3.2388) < 0.05, `Expected imag part ≈ 3.2388, got ${mode.imag}`);
  assert.ok(Math.abs(mode.frequencyHz - 0.5157) < 0.02, `Expected freq ≈ 0.5157 Hz, got ${mode.frequencyHz}`);
});
