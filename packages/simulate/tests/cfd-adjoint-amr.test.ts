// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { AdjointLbmSolver, LbmVoxelizer, WebGPULbmRunner, type LbmGridConfig } from "../src/cfd/index.js";
import type { Tet4Mesh } from "../src/fea/tet4-types.js";
import { AmrErrorIndicator, OctreeLbmRefiner, TetAmrRefiner } from "../src/meshing/index.js";

console.log("=== Testing Workstream 4: Discrete Adjoint LBM Sensitivities & Goal-Oriented AMR ===");

// 1. Finite-Difference Verification of Exact Reverse-Mode Discrete Adjoint Gradient
{
  const config: LbmGridConfig = {
    nx: 10,
    ny: 6,
    nz: 6,
    dx: 0.01,
    dt: 1e-4,
    tau: 0.7,
    density: 1.225,
    inletVelocity: [2.0, 0.0, 0.0],
  };

  const grid = LbmVoxelizer.voxelize(config, {});
  const solver = new AdjointLbmSolver(config, grid, { numSteps: 6, maxResistance: 0.8 });

  // Place a porous obstacle patch in the center of the channel
  const alpha = new Float64Array(solver.totalCells);
  const probeCells: number[] = [];
  for (let z = 2; z <= 3; z++) {
    for (let y = 2; y <= 3; y++) {
      for (let x = 4; x <= 5; x++) {
        const idx = x + y * config.nx + z * config.nx * config.ny;
        alpha[idx] = 0.5;
        probeCells.push(idx);
      }
    }
  }

  const res = solver.evaluate(alpha, true);
  assert.ok(res.objective > 0, "Objective must be strictly positive");

  const eps = 1e-6;
  let maxRelErr = 0.0;
  for (const idx of probeCells.slice(0, 4)) {
    const aPlus = Float64Array.from(alpha);
    const aMinus = Float64Array.from(alpha);
    aPlus[idx] = alpha[idx]! + eps;
    aMinus[idx] = alpha[idx]! - eps;

    const jPlus = solver.evaluate(aPlus, false).objective;
    const jMinus = solver.evaluate(aMinus, false).objective;
    const fdGrad = (jPlus - jMinus) / (2 * eps);
    const adjGrad = res.gradient[idx]!;
    const relErr = Math.abs(adjGrad - fdGrad) / Math.max(1e-12, Math.abs(fdGrad));
    if (relErr > maxRelErr) maxRelErr = relErr;
  }

  console.log(`  Discrete adjoint vs central FD max relative error: ${(maxRelErr * 100).toExponential(2)}%`);
  assert.ok(maxRelErr < 1e-4, `Adjoint gradient mismatch vs finite difference: ${maxRelErr}`);

  // 2. Gradient-descent shape optimization smoke test using oracle
  const oracle = solver.createOptimizerOracle();
  const aOpt = Float64Array.from(alpha);
  const j0 = oracle.evaluate(aOpt).value;
  for (let iter = 0; iter < 5; iter++) {
    const { gradient } = oracle.evaluate(aOpt);
    const stepSize = 200.0;
    for (const idx of probeCells) {
      aOpt[idx] = Math.max(0.0, Math.min(1.0, aOpt[idx]! - stepSize * gradient[idx]!));
    }
  }
  const jFinal = oracle.evaluate(aOpt).value;
  console.log(`  Shape optimization objective: J_0=${j0.toExponential(3)} -> J_5=${jFinal.toExponential(3)}`);
  assert.ok(jFinal < j0, `Expected monotonic drag-power reduction: ${jFinal} vs ${j0}`);

  // 2b. Real L-BFGS-B box-constrained shape optimization via optimizeShapeLbfgsb()
  const lbfgsRes = solver.optimizeShapeLbfgsb(alpha, probeCells, { maxIterations: 15, tolerance: 1e-8 });
  assert.ok(
    lbfgsRes.finalObjective < lbfgsRes.initialObjective,
    `Expected L-BFGS-B to reduce objective: ${lbfgsRes.finalObjective} vs ${lbfgsRes.initialObjective}`,
  );
  assert.ok(lbfgsRes.iterations >= 1, `Expected >=1 L-BFGS-B iterations, got ${lbfgsRes.iterations}`);
  for (const idx of probeCells) {
    assert.ok(
      lbfgsRes.alpha[idx]! >= 0.0 && lbfgsRes.alpha[idx]! <= 1.0,
      `Design variable alpha[${idx}] out of [0, 1] bounds: ${lbfgsRes.alpha[idx]}`,
    );
  }
  console.log(
    `  ✓ L-BFGS-B shape optimization (${lbfgsRes.iterations} iters, converged=${lbfgsRes.converged}): J_0=${lbfgsRes.initialObjective.toExponential(3)} -> J_opt=${lbfgsRes.finalObjective.toExponential(3)}`,
  );

  // 3. Adjoint-weighted + Feature-based 2:1 Balanced Octree AMR
  const feat = AmrErrorIndicator.computeFeatureIndicator(
    config.nx,
    config.ny,
    config.nz,
    config.dx,
    res.velocityMagnitude,
    new Float32Array(solver.totalCells),
    new Float32Array(solver.totalCells),
  );
  const goalErr = AmrErrorIndicator.computeAdjointWeightedIndicator(feat.indicator, res.sensitivityField);
  const octree = OctreeLbmRefiner.buildRefinementMap(config.nx, config.ny, config.nz, goalErr.indicator, {
    refineFraction: 0.15,
    maxLevel: 2,
  });
  assert.ok(octree.isBalanced2To1, "Octree AMR must satisfy strict 2:1 neighbor balance");
  assert.ok(octree.refinedCellCount > 0, "Octree AMR must mark high-error cells for refinement");
  console.log(
    `  ✓ Octree AMR marked ${octree.refinedCellCount}/${solver.totalCells} cells (${(octree.refinedFraction * 100).toFixed(1)}%), 2:1 balanced=${octree.isBalanced2To1}`,
  );
}

// 3b. OctreeLbmRefiner Prolongation (Coarse->Fine) & Restriction (Fine->Coarse) Field Preservation
{
  const nx = 6,
    ny = 5,
    nz = 4;
  const total = nx * ny * nz;

  // Constant field preservation
  const constCoarse = new Float32Array(total).fill(3.25);
  const constFine = OctreeLbmRefiner.interpolateCoarseToFine(constCoarse, nx, ny, nz);
  assert.strictEqual(constFine.length, total * 8, "Fine field must have 8x coarse cell count");
  let maxConstFineErr = 0;
  for (let i = 0; i < constFine.length; i++) {
    maxConstFineErr = Math.max(maxConstFineErr, Math.abs(constFine[i]! - 3.25));
  }
  const constRestricted = OctreeLbmRefiner.restrictFineToCoarse(constFine, nx, ny, nz);
  assert.strictEqual(constRestricted.length, total, "Restricted field must match coarse cell count");
  let maxConstRestrErr = 0;
  for (let i = 0; i < total; i++) {
    maxConstRestrErr = Math.max(maxConstRestrErr, Math.abs(constRestricted[i]! - 3.25));
  }
  assert.ok(maxConstFineErr < 1e-5, `Constant prolongation error too high: ${maxConstFineErr}`);
  assert.ok(maxConstRestrErr < 1e-5, `Constant restriction error too high: ${maxConstRestrErr}`);

  // Linear field preservation: f(x, y, z) = 1.5 + 0.7*x - 0.4*y + 1.1*z
  const linCoarse = new Float32Array(total);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        linCoarse[x + y * nx + z * nx * ny] = 1.5 + 0.7 * x - 0.4 * y + 1.1 * z;
      }
    }
  }
  const linFine = OctreeLbmRefiner.interpolateCoarseToFine(linCoarse, nx, ny, nz);
  const fnx = nx * 2,
    fny = ny * 2,
    fnz = nz * 2;
  let maxLinFineErr = 0;
  for (let fz = 0; fz < fnz; fz++) {
    const cz = 0.5 * fz - 0.25;
    for (let fy = 0; fy < fny; fy++) {
      const cy = 0.5 * fy - 0.25;
      for (let fx = 0; fx < fnx; fx++) {
        const cx = 0.5 * fx - 0.25;
        const expected = 1.5 + 0.7 * cx - 0.4 * cy + 1.1 * cz;
        const actual = linFine[fx + fy * fnx + fz * fnx * fny]!;
        maxLinFineErr = Math.max(maxLinFineErr, Math.abs(actual - expected));
      }
    }
  }
  const linRestricted = OctreeLbmRefiner.restrictFineToCoarse(linFine, nx, ny, nz);
  let maxLinRestrErr = 0;
  for (let i = 0; i < total; i++) {
    maxLinRestrErr = Math.max(maxLinRestrErr, Math.abs(linRestricted[i]! - linCoarse[i]!));
  }
  assert.ok(maxLinFineErr < 1e-5, `Linear prolongation error too high: ${maxLinFineErr}`);
  assert.ok(maxLinRestrErr < 1e-5, `Linear restriction error too high: ${maxLinRestrErr}`);
  console.log(
    `  ✓ Octree prolongation/restriction errors: const=${maxConstRestrErr.toExponential(2)}, linearFine=${maxLinFineErr.toExponential(2)}, linearRoundTrip=${maxLinRestrErr.toExponential(2)}`,
  );
}

// 4. Unstructured Tet4 Longest-Edge Bisection AMR with Green-Closure Conformity
{
  const unitCubeMesh: Tet4Mesh = {
    nodeCoords: new Float32Array([
      0,
      0,
      0, // 0
      1,
      0,
      0, // 1
      1,
      1,
      0, // 2
      0,
      1,
      0, // 3
      0,
      0,
      1, // 4
      1,
      0,
      1, // 5
      1,
      1,
      1, // 6
      0,
      1,
      1, // 7
    ]),
    elements: new Uint32Array([0, 1, 3, 4, 1, 2, 3, 6, 1, 4, 5, 6, 3, 4, 6, 7, 1, 3, 4, 6]),
    numNodes: 8,
    numElements: 5,
    boundaryNodes: new Map(),
  };
  const tetErr = new Float32Array([0.1, 0.2, 0.9, 0.85, 0.3]);
  const adapted = TetAmrRefiner.refineMarkedTetrahedra(unitCubeMesh, tetErr, 0.4);
  assert.ok(adapted.refinedTetCount >= 2, `Expected >=2 tets refined, got ${adapted.refinedTetCount}`);
  assert.ok(
    adapted.mesh.numElements >= 5 + adapted.refinedTetCount,
    `Expected >=${5 + adapted.refinedTetCount} elements after green-closure, got ${adapted.mesh.numElements}`,
  );
  assert.ok(adapted.mesh.numNodes > 8, "Midpoint nodes must be inserted");
  assert.strictEqual(adapted.hangingNodeCount, 0, `Expected 0 hanging nodes, got ${adapted.hangingNodeCount}`);

  // Verify total volume conservation of the unit cube (= 1.0)
  let totalVol = 0;
  const c = adapted.mesh.nodeCoords;
  for (let t = 0; t < adapted.mesh.numElements; t++) {
    const a = adapted.mesh.elements[t * 4]!;
    const b = adapted.mesh.elements[t * 4 + 1]!;
    const p = adapted.mesh.elements[t * 4 + 2]!;
    const d = adapted.mesh.elements[t * 4 + 3]!;
    const ax = c[a * 3]!,
      ay = c[a * 3 + 1]!,
      az = c[a * 3 + 2]!;
    const bx = c[b * 3]! - ax,
      by = c[b * 3 + 1]! - ay,
      bz = c[b * 3 + 2]! - az;
    const px = c[p * 3]! - ax,
      py = c[p * 3 + 1]! - ay,
      pz = c[p * 3 + 2]! - az;
    const dx = c[d * 3]! - ax,
      dy = c[d * 3 + 1]! - ay,
      dz = c[d * 3 + 2]! - az;
    const det = bx * (py * dz - pz * dy) - by * (px * dz - pz * dx) + bz * (px * dy - py * dx);
    assert.ok(det > 0, `Element ${t} has non-positive Jacobian det=${det}`);
    totalVol += det / 6.0;
  }
  assert.ok(Math.abs(totalVol - 1.0) < 1e-5, `Expected unit cube volume 1.0, got ${totalVol}`);
  console.log(
    `  ✓ TetAmrRefiner green-closure split ${adapted.refinedTetCount} marked tets -> ${adapted.mesh.numElements} conforming elements, ${adapted.mesh.numNodes} nodes, hangingNodes=${adapted.hangingNodeCount}, vol=${totalVol.toFixed(6)}`,
  );
}

// 5. Feature-based wake vorticity AMR on live LBM cylinder run
{
  const cfg: LbmGridConfig = {
    nx: 24,
    ny: 12,
    nz: 8,
    dx: 0.005,
    dt: 1e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [4.0, 0.0, 0.0],
  };
  const grid = LbmVoxelizer.voxelize(cfg, {
    cylinders: [{ center: [0.35, 0.5, 0.5], radius: 0.15, axis: "z", length: 1.0 }],
  });
  const runner = new WebGPULbmRunner(cfg, grid);
  runner.step(15);
  const vort = AmrErrorIndicator.computeFeatureIndicator(
    cfg.nx,
    cfg.ny,
    cfg.nz,
    cfg.dx,
    runner.vx,
    runner.vy,
    runner.vz,
  );
  assert.ok(vort.maxIndicator > 0, "Wake vorticity indicator must be strictly positive");
  console.log(`  ✓ Wake vorticity max |curl(u)| = ${vort.maxIndicator.toFixed(1)} 1/s`);
}

console.log("All Workstream 4 Adjoint & Goal-Oriented AMR tests passed!");
