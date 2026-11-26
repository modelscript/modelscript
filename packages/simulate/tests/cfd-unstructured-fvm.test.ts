// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UnstructuredCompressibleFvmSolver } from "../src/cfd/unstructured-compressible-fvm.js";
import { Tet4Mesher } from "../src/fea/tet4-mesher.js";

describe("Unstructured Body-Fitted Tet4 Compressible FVM Solver", () => {
  it("preserves M=0.8 transonic freestream to < 1e-11 residual after 5 SSP-RK3 steps (HLLC & Roe, 1st & 2nd order)", () => {
    const Lx = 2.0;
    const Ly = 1.0;
    const Lz = 1.0;
    const mesh = Tet4Mesher.createBoxMesh({
      width: Lx,
      height: Ly,
      depth: Lz,
      nx: 4,
      ny: 3,
      nz: 3,
      faceTags: {
        minX: "farfield",
        maxX: "farfield",
        minY: "farfield",
        maxY: "farfield",
        minZ: "farfield",
        maxZ: "farfield",
      },
    });

    const gamma = 1.4;
    const rhoInf = 1.0;
    const pInf = 1.0;
    const cInf = Math.sqrt((gamma * pInf) / rhoInf);
    const mach = 0.8;
    const uInf = mach * cInf;
    const vInf = 0.1 * cInf;
    const wInf = -0.05 * cInf;

    const configs: Array<{ flux: "hllc" | "roe"; order: 1 | 2 }> = [
      { flux: "hllc", order: 1 },
      { flux: "hllc", order: 2 },
      { flux: "roe", order: 1 },
      { flux: "roe", order: 2 },
    ];

    for (const cfg of configs) {
      const solver = new UnstructuredCompressibleFvmSolver(mesh, {
        gamma,
        flux: cfg.flux,
        reconstructionOrder: cfg.order,
        farfieldState: { rho: rhoInf, u: uInf, v: vInf, w: wInf, p: pInf },
      });

      // Verify exact geometric conservation sum_f (A_f n_f) = 0 on all tets
      assert.ok(
        solver.topology.maxGeometricConservationError < 1e-13,
        `GCL error too large: ${solver.topology.maxGeometricConservationError}`,
      );

      // Verify total mesh volume matches box volume
      let totalVol = 0.0;
      for (let i = 0; i < solver.numCells; i++) {
        totalVol += solver.volumes[i]!;
      }
      assert.ok(
        Math.abs(totalVol - Lx * Ly * Lz) < 1e-12,
        `Total volume mismatch: got ${totalVol}, expected ${Lx * Ly * Lz}`,
      );

      solver.fillUniform(rhoInf, uInf, vInf, wInf, pInf);

      const initialResidual = solver.computeMaxResidual();
      assert.ok(
        initialResidual < 1e-11,
        `[${cfg.flux} O${cfg.order}] Initial freestream residual too high: ${initialResidual}`,
      );

      for (let step = 0; step < 5; step++) {
        const dt = solver.computeCflTimestep(0.45);
        assert.ok(dt > 0 && Number.isFinite(dt), `Invalid CFL dt=${dt}`);
        solver.stepSspRk3(dt);
      }

      const finalResidual = solver.computeMaxResidual();
      assert.ok(
        finalResidual < 1e-11,
        `[${cfg.flux} O${cfg.order}] Freestream residual after 5 SSP-RK3 steps exceeded 1e-11: ${finalResidual}`,
      );

      // Verify state itself remained exact
      for (let i = 0; i < solver.numCells; i++) {
        const prim = solver.getCellPrimitive(i);
        assert.ok(Math.abs(prim.rho - rhoInf) < 1e-12, `rho drifted at cell ${i}: ${prim.rho}`);
        assert.ok(Math.abs(prim.u - uInf) < 1e-12, `u drifted at cell ${i}: ${prim.u}`);
        assert.ok(Math.abs(prim.v - vInf) < 1e-12, `v drifted at cell ${i}: ${prim.v}`);
        assert.ok(Math.abs(prim.w - wInf) < 1e-12, `w drifted at cell ${i}: ${prim.w}`);
        assert.ok(Math.abs(prim.p - pInf) < 1e-12, `p drifted at cell ${i}: ${prim.p}`);
      }
    }
  });

  it("propagates a 3D unstructured Riemann shock over 15 SSP-RK3 steps with positivity preserved", () => {
    const Lx = 2.0;
    const Ly = 0.5;
    const Lz = 0.5;
    const mesh = Tet4Mesher.createBoxMesh({
      width: Lx,
      height: Ly,
      depth: Lz,
      nx: 10,
      ny: 2,
      nz: 2,
      faceTags: {
        minX: "farfield",
        maxX: "farfield",
        minY: "slip_wall",
        maxY: "slip_wall",
        minZ: "slip_wall",
        maxZ: "slip_wall",
      },
    });

    const solver = new UnstructuredCompressibleFvmSolver(mesh, {
      gamma: 1.4,
      flux: "hllc",
      reconstructionOrder: 2,
      cfl: 0.4,
    });

    const xMid = 0.5 * Lx;
    const rhoL = 1.0;
    const pL = 1.0;
    const rhoR = 0.125;
    const pR = 0.1;

    solver.initCustom((x) =>
      x < xMid ? { rho: rhoL, u: 0.0, v: 0.0, w: 0.0, p: pL } : { rho: rhoR, u: 0.0, v: 0.0, w: 0.0, p: pR },
    );

    let totalTime = 0.0;
    for (let step = 0; step < 15; step++) {
      const dt = solver.computeCflTimestep(0.4);
      assert.ok(dt > 0 && Number.isFinite(dt), `Invalid dt=${dt} at step ${step}`);
      solver.stepSspRk3(dt);
      totalTime += dt;
    }

    assert.ok(totalTime > 0, "Elapsed simulation time must be positive");

    let minRho = Number.POSITIVE_INFINITY;
    let minP = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let downstreamPerturbedCount = 0;

    for (let i = 0; i < solver.numCells; i++) {
      const prim = solver.getCellPrimitive(i);
      assert.ok(Number.isFinite(prim.rho) && prim.rho > 0, `Non-positive rho at cell ${i}: ${prim.rho}`);
      assert.ok(Number.isFinite(prim.p) && prim.p > 0, `Non-positive p at cell ${i}: ${prim.p}`);
      assert.ok(Number.isFinite(prim.u), `Non-finite u at cell ${i}: ${prim.u}`);

      if (prim.rho < minRho) minRho = prim.rho;
      if (prim.p < minP) minP = prim.p;
      if (prim.u > maxU) maxU = prim.u;

      const cx = solver.centroids[i * 3]!;
      if (cx > xMid && prim.p > pR + 0.02 && prim.rho > rhoR + 0.02) {
        downstreamPerturbedCount++;
      }
    }

    assert.ok(minRho > 0, `Minimum density must be positive, got ${minRho}`);
    assert.ok(minP > 0, `Minimum pressure must be positive, got ${minP}`);
    assert.ok(maxU > 0.1, `Expected positive shock-induced velocity u > 0.1, got maxU=${maxU}`);
    assert.ok(downstreamPerturbedCount > 0, `Expected shock wave to propagate past x=${xMid} into downstream cells`);
  });

  it("integrates wall pressure forces matching analytical p_inf * A_wall on a slip_wall face", () => {
    const Lx = 3.0;
    const Ly = 1.5;
    const Lz = 2.0;
    const mesh = Tet4Mesher.createBoxMesh({
      width: Lx,
      height: Ly,
      depth: Lz,
      nx: 4,
      ny: 3,
      nz: 3,
      faceTags: {
        minX: "farfield",
        maxX: "farfield",
        minY: "slip_wall",
        maxY: "farfield",
        minZ: "farfield",
        maxZ: "farfield",
      },
    });

    const pInf = 101325.0;
    const rhoInf = 1.225;
    const uInf = 50.0;

    const solver = new UnstructuredCompressibleFvmSolver(mesh, {
      gamma: 1.4,
      flux: "hllc",
      boundaryConditions: {
        slip_wall: "slip_wall",
        farfield: "farfield",
      },
    });

    solver.fillUniform(rhoInf, uInf, 0.0, 0.0, pInf);

    const [fx, fy, fz] = solver.computeWallForces();
    const expectedArea = Lx * Lz;
    // Outward normal of minY face points in -Y direction: (0, -1, 0)
    const expectedFy = -pInf * expectedArea;

    assert.ok(Math.abs(fx) < 1e-9, `Expected Fx = 0, got ${fx}`);
    assert.ok(Math.abs(fz) < 1e-9, `Expected Fz = 0, got ${fz}`);
    assert.ok(Math.abs(fy - expectedFy) / Math.abs(expectedFy) < 1e-12, `Expected Fy = ${expectedFy}, got ${fy}`);

    // Also verify after stepping tangent flow along the slip wall
    const dt = solver.computeCflTimestep(0.45);
    solver.stepSspRk3(dt);
    const [fx2, fy2, fz2] = solver.computeWallForces();
    assert.ok(Math.abs(fx2) < 1e-6, `Expected Fx ~ 0 after step, got ${fx2}`);
    assert.ok(Math.abs(fz2) < 1e-6, `Expected Fz ~ 0 after step, got ${fz2}`);
    assert.ok(
      Math.abs(fy2 - expectedFy) / Math.abs(expectedFy) < 1e-11,
      `Expected Fy = ${expectedFy} after step, got ${fy2}`,
    );
  });
});
