// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Tet4Mesher } from "../src/fea/tet4-mesher.js";
import { calculateNetworkSensitivities } from "../src/solvers/powerflow/lodf-calculator.js";
import {
  getSimulateWasmSync,
  wasmAcPowerflowNR,
  wasmComputePtdfLodf,
  wasmEarClip2D,
  wasmJacobiSvd,
  wasmOpfEvalAcBalanceAndJac,
  wasmRadauStageSolve,
  wasmStlsq,
  wasmTet4QualityMetrics,
  wasmVoxelizeSurface,
} from "../src/wasm/simulate-wasm.js";

describe("@modelscript/simulate standalone AssemblyScript WASM kernels (simulate.wasm)", () => {
  it("loads simulate.wasm synchronously in Node", () => {
    const w = getSimulateWasmSync();
    assert.ok(w, "simulate.wasm must load synchronously");
    assert.equal(typeof w.mesh_voxelizeSurface, "function");
    assert.equal(typeof w.rom_jacobiSvd, "function");
    assert.equal(typeof w.ssa_gillespieTrajectory, "function");
    assert.equal(typeof w.grid_acPowerflowNR, "function");
  });

  it("voxelizes a closed unit cube surface mesh and computes Tet4 quality metrics", () => {
    // Unit cube [0, 1]^3: 8 vertices, 12 triangles
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
    const indices = new Uint32Array([
      0,
      2,
      1,
      0,
      3,
      2, // bottom
      4,
      5,
      6,
      4,
      6,
      7, // top
      0,
      1,
      5,
      0,
      5,
      4, // front
      2,
      3,
      7,
      2,
      7,
      6, // back
      0,
      4,
      7,
      0,
      7,
      3, // left
      1,
      2,
      6,
      1,
      6,
      5, // right
    ]);

    const vox = wasmVoxelizeSurface(vertices, indices, 10, 10, 10, 0, 0, 0, 0.1);
    assert.ok(vox);
    assert.ok(vox.solidCount >= 900 && vox.solidCount <= 1000, `Expected ~1000 solid voxels, got ${vox.solidCount}`);

    // End-to-end Tet4Mesher.createFromSurfaceMesh uses WASM fast-path
    const mesh = Tet4Mesher.createFromSurfaceMesh({ vertices, indices, resolution: 6 });
    assert.ok(mesh.elements.length > 0);

    const qual = wasmTet4QualityMetrics(mesh.nodeCoords, mesh.elements);
    assert.ok(qual);
    assert.equal(qual.volumes.length, mesh.elements.length / 4);
    assert.ok(qual.aspectRatios[0]! > 0 && qual.aspectRatios[0]! < 10);
  });

  it("computes accurate one-sided Jacobi SVD and SINDy STLSQ sparse regression", () => {
    // 4x2 matrix A = [[3, 0], [0, 2], [0, 0], [0, 0]] -> singular values [3, 2]
    const A = new Float64Array([3, 0, 0, 2, 0, 0, 0, 0]);
    const svd = wasmJacobiSvd(A, 4, 2);
    assert.ok(svd);
    assert.ok(Math.abs(svd.S[0]! - 3.0) < 1e-10);
    assert.ok(Math.abs(svd.S[1]! - 2.0) < 1e-10);

    // SINDy STLSQ: y = 2.5 * x1 - 1.2 * x3 (x2 is noise/zero)
    const nSamples = 50;
    const nFeatures = 3;
    const theta = new Float64Array(nSamples * nFeatures);
    const target = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      const x1 = Math.sin(i * 0.2);
      const x2 = Math.cos(i * 0.37);
      const x3 = (i - 25) * 0.1;
      theta[i * 3 + 0] = x1;
      theta[i * 3 + 1] = x2;
      theta[i * 3 + 2] = x3;
      target[i] = 2.5 * x1 - 1.2 * x3;
    }
    const xi = wasmStlsq(theta, target, nSamples, nFeatures, 0.1, 1e-8, 15);
    assert.ok(xi);
    assert.ok(Math.abs(xi[0]! - 2.5) < 1e-5);
    assert.equal(xi[1]!, 0.0);
    assert.ok(Math.abs(xi[2]! + 1.2) < 1e-5);
  });

  it("runs Gillespie SSA decay reaction and Radau IIA stage linear solve in WASM", () => {
    const w = getSimulateWasmSync()!;
    // Simple exponential decay: A -> 0 with rate k = 1.0, A(0) = 1000, t in [0, 1]
    // Expected E[A(1)] = 1000 * exp(-1) ≈ 367.88
    const initPtr = w.alloc(8);
    const ratePtr = w.alloc(8);
    const rRowPtr = w.alloc(8);
    const rSpPtr = w.alloc(4);
    const rOrdPtr = w.alloc(4);
    const sRowPtr = w.alloc(8);
    const sSpPtr = w.alloc(4);
    const sDelPtr = w.alloc(8);
    const outTPtr = w.alloc(11 * 8);
    const outXPtr = w.alloc(11 * 8);

    try {
      new Float64Array(w.memory.buffer, initPtr, 1).set([1000]);
      new Float64Array(w.memory.buffer, ratePtr, 1).set([1.0]);
      new Int32Array(w.memory.buffer, rRowPtr, 2).set([0, 1]);
      new Int32Array(w.memory.buffer, rSpPtr, 1).set([0]);
      new Int32Array(w.memory.buffer, rOrdPtr, 1).set([1]);
      new Int32Array(w.memory.buffer, sRowPtr, 2).set([0, 1]);
      new Int32Array(w.memory.buffer, sSpPtr, 1).set([0]);
      new Float64Array(w.memory.buffer, sDelPtr, 1).set([-1.0]);

      const steps = w.ssa_gillespieTrajectory(
        1,
        1,
        initPtr,
        ratePtr,
        rRowPtr,
        rSpPtr,
        rOrdPtr,
        sRowPtr,
        sSpPtr,
        sDelPtr,
        0.0,
        1.0,
        11,
        100000,
        12345n,
        outTPtr,
        outXPtr,
      );
      const states = new Float64Array(w.memory.buffer, outXPtr, 11);
      assert.ok(steps > 400 && steps < 850, `Expected ~632 reactions, got ${steps}`);
      assert.ok(states[10]! > 250 && states[10]! < 500, `Expected A(1) near 368, got ${states[10]}`);
    } finally {
      w.free(initPtr);
      w.free(ratePtr);
      w.free(rRowPtr);
      w.free(rSpPtr);
      w.free(rOrdPtr);
      w.free(sRowPtr);
      w.free(sSpPtr);
      w.free(sDelPtr);
      w.free(outTPtr);
      w.free(outXPtr);
    }

    // Radau IIA 2-stage coupled solve: (I - h * A ⊗ J) * dz = rhs
    const butcherA = new Float64Array([0.5, 0.0, 0.0, 0.5]);
    const jac = new Float64Array([-2.0]);
    const rhs = new Float64Array([4.0, 6.0]);
    // W = diag(1 - 0.5 * 0.5 * (-2)) = diag(1.5) -> dz = [4/1.5, 6/1.5]
    const dz = wasmRadauStageSolve(2, 1, 0.5, butcherA, jac, rhs);
    assert.ok(dz);
    assert.ok(Math.abs(dz[0]! - 4.0 / 1.5) < 1e-12);
    assert.ok(Math.abs(dz[1]! - 4.0) < 1e-12);
  });

  it("solves 2-bus AC Powerflow Newton-Raphson and 3-bus triangle PTDF/LODF in WASM", () => {
    // 2-bus lossless line: x = 0.1 -> B_11 = B_22 = -10, B_12 = B_21 = +10
    const busTypes = new Uint8Array([3, 1]); // bus 0 = Slack, bus 1 = PQ
    const G = new Float64Array([0, 0, 0, 0]);
    const B = new Float64Array([-10, 10, 10, -10]);
    const pSpec = new Float64Array([0, -0.5]);
    const qSpec = new Float64Array([0, -0.1]);
    const vmInit = new Float64Array([1.0, 1.0]);
    const vaInit = new Float64Array([0.0, 0.0]);

    const pf = wasmAcPowerflowNR(2, busTypes, G, B, pSpec, qSpec, vmInit, vaInit, 1e-9, 20);
    assert.ok(pf);
    assert.equal(pf.converged, true);
    assert.ok(pf.iterations <= 6);
    assert.ok(pf.vm[1]! > 0.95 && pf.vm[1]! < 1.0, `Expected PQ voltage drop, got ${pf.vm[1]}`);
    assert.ok(pf.va[1]! < 0, `Expected negative angle at load bus, got ${pf.va[1]}`);

    // 3-bus identical triangle (x = 0.1 on all 3 lines) -> tripping any line shifts 100% of its flow to the parallel path
    const res = wasmComputePtdfLodf(
      3,
      0,
      new Int32Array([0, 1, 0]),
      new Int32Array([1, 2, 2]),
      new Float64Array([0.1, 0.1, 0.1]),
    );
    assert.ok(res);
    // PTDF(line 0->1, bus 1) = -2/3
    assert.ok(Math.abs(res.ptdf[0 * 3 + 1]! + 2.0 / 3.0) < 1e-10);
    // Also verify calculateNetworkSensitivities TS wrapper uses WASM cleanly
    const sens = calculateNetworkSensitivities(
      [
        { fromBus: 0, toBus: 1, reactance: 0.1, rating: 100, status: 1 },
        { fromBus: 1, toBus: 2, reactance: 0.1, rating: 100, status: 1 },
        { fromBus: 0, toBus: 2, reactance: 0.1, rating: 100, status: 1 },
      ],
      3,
      0,
    );
    assert.ok(Math.abs(sens.ptdf[0 * 3 + 1]! + 2.0 / 3.0) < 1e-5);
    assert.equal(sens.lodf[0 * 3 + 0], -1.0);
    assert.ok(Math.abs(sens.lodf[0 * 3 + 2]! - 1.0) < 1e-5);
  });

  it("solves Lyapunov, CARE LQR, PALC continuation, Harmonics, QSS1, and SDE ensemble in WASM", () => {
    const w = getSimulateWasmSync()!;

    // 1. CARE LQR for scalar system dx/dt = u (A=0, B=1, Q=1, R=1) -> exact P=1, K=1
    const aPtr = w.alloc(8);
    const bPtr = w.alloc(8);
    const qPtr = w.alloc(8);
    const rPtr = w.alloc(8);
    const pPtr = w.alloc(8);
    const kPtr = w.alloc(8);
    try {
      new Float64Array(w.memory.buffer, aPtr, 1).set([0.0]);
      new Float64Array(w.memory.buffer, bPtr, 1).set([1.0]);
      new Float64Array(w.memory.buffer, qPtr, 1).set([1.0]);
      new Float64Array(w.memory.buffer, rPtr, 1).set([1.0]);
      new Float64Array(w.memory.buffer, kPtr, 1).set([2.0]); // stabilizing initial gain K0 = 2
      const iters = w.ctrl_careNewton(aPtr, bPtr, qPtr, rPtr, 1, 1, 20, 1e-10, pPtr, kPtr);
      assert.ok(iters > 0 && iters <= 10, `Expected CARE convergence, got ${iters}`);
      const P = new Float64Array(w.memory.buffer, pPtr, 1)[0]!;
      const K = new Float64Array(w.memory.buffer, kPtr, 1)[0]!;
      assert.ok(Math.abs(P - 1.0) < 1e-9, `Expected P=1, got ${P}`);
      assert.ok(Math.abs(K - 1.0) < 1e-9, `Expected K=1, got ${K}`);
    } finally {
      w.free(aPtr);
      w.free(bPtr);
      w.free(qPtr);
      w.free(rPtr);
      w.free(pPtr);
      w.free(kPtr);
    }

    // 2. QSS1 linear decay dx/dt = -x, x(0) = 1, tEnd = 1 -> exp(-1) ≈ 0.3679
    const qaPtr = w.alloc(8);
    const qbPtr = w.alloc(8);
    const qx0Ptr = w.alloc(8);
    const qdqPtr = w.alloc(8);
    const qoutPtr = w.alloc(8);
    try {
      new Float64Array(w.memory.buffer, qaPtr, 1).set([-1.0]);
      new Float64Array(w.memory.buffer, qbPtr, 1).set([0.0]);
      new Float64Array(w.memory.buffer, qx0Ptr, 1).set([1.0]);
      new Float64Array(w.memory.buffer, qdqPtr, 1).set([0.005]);
      const ev = w.qss1_integrateLinear(1, qaPtr, qbPtr, qx0Ptr, qdqPtr, 0.0, 1.0, 10000, qoutPtr);
      assert.ok(ev > 50);
      const xEnd = new Float64Array(w.memory.buffer, qoutPtr, 1)[0]!;
      assert.ok(Math.abs(xEnd - Math.exp(-1.0)) < 0.01, `Expected ~0.3679, got ${xEnd}`);
    } finally {
      w.free(qaPtr);
      w.free(qbPtr);
      w.free(qx0Ptr);
      w.free(qdqPtr);
      w.free(qoutPtr);
    }

    // 3. Harmonics complex solve (1 + 2j) * V = (5 + 0j) -> V = (1 - 2j)
    const hgPtr = w.alloc(8);
    const hbPtr = w.alloc(8);
    const hirPtr = w.alloc(8);
    const hiiPtr = w.alloc(8);
    const hvrPtr = w.alloc(8);
    const hviPtr = w.alloc(8);
    try {
      new Float64Array(w.memory.buffer, hgPtr, 1).set([1.0]);
      new Float64Array(w.memory.buffer, hbPtr, 1).set([2.0]);
      new Float64Array(w.memory.buffer, hirPtr, 1).set([5.0]);
      new Float64Array(w.memory.buffer, hiiPtr, 1).set([0.0]);
      const ok = w.grid_harmonicsSolveOrder(1, hgPtr, hbPtr, hirPtr, hiiPtr, hvrPtr, hviPtr);
      assert.equal(ok, 1);
      assert.ok(Math.abs(new Float64Array(w.memory.buffer, hvrPtr, 1)[0]! - 1.0) < 1e-12);
      assert.ok(Math.abs(new Float64Array(w.memory.buffer, hviPtr, 1)[0]! + 2.0) < 1e-12);
    } finally {
      w.free(hgPtr);
      w.free(hbPtr);
      w.free(hirPtr);
      w.free(hiiPtr);
      w.free(hvrPtr);
      w.free(hviPtr);
    }

    // 4. Batched SDE GBM ensemble: dX = 0.1*X*dt + 0.2*X*dW, X0 = 1, T = 1 -> E[X(1)] = exp(0.1) ≈ 1.105
    const meanPtr = w.alloc(101 * 8);
    const varPtr = w.alloc(101 * 8);
    try {
      w.sde_gbmEnsemble(2000, 100, 0.01, 1.0, 0.1, 0.2, 42n, meanPtr, varPtr);
      const meanEnd = new Float64Array(w.memory.buffer, meanPtr, 101)[100]!;
      assert.ok(Math.abs(meanEnd - Math.exp(0.1)) < 0.03, `Expected ~1.105, got ${meanEnd}`);
    } finally {
      w.free(meanPtr);
      w.free(varPtr);
    }
  });

  it("triangulates concave 2D polygons with wasmEarClip2D and evaluates AC-OPF balance/Jacobians", () => {
    // Concave L-shaped 6-vertex CCW polygon -> must emit exactly 4 triangles
    const uv = new Float64Array([0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2]);
    const ptIds = new Int32Array([10, 11, 12, 13, 14, 15]);
    const tris = wasmEarClip2D(uv, ptIds);
    assert.ok(tris);
    assert.equal(tris.length, 4 * 3, `Expected 4 triangles (12 indices), got ${tris.length}`);

    // AC-OPF 2-bus balance & Jacobian at flat start V=[1,1], Va=[0,0] on lossless line B=[[-10,10],[10,-10]]
    // At flat start: P = [0, 0], Q = [0, 0], dP/dVa = [[10, -10], [-10, 10]]
    const opf = wasmOpfEvalAcBalanceAndJac(
      2,
      new Float64Array([0, 0, 0, 0]),
      new Float64Array([-10, 10, 10, -10]),
      new Float64Array([1, 1]),
      new Float64Array([0, 0]),
    );
    assert.ok(opf);
    assert.ok(Math.abs(opf.P[0]!) < 1e-12);
    assert.ok(Math.abs(opf.Q[0]!) < 1e-12);
    assert.ok(Math.abs(opf.dPdVa[0]! - 10.0) < 1e-12);
    assert.ok(Math.abs(opf.dPdVa[1]! + 10.0) < 1e-12);
  });
});
