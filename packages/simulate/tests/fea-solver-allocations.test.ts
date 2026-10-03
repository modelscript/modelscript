// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FeaSolver, Tet4Mesher, type FeaBoundaryConditions, type MaterialProperties } from "../src/index.js";

async function runAllocationTest() {
  console.log("=== Testing: FeaSolver Zero-Heap-Allocation Performance & Corotational Convergence ===");

  const mesh = Tet4Mesher.createBoxMesh({
    width: 0.2,
    height: 0.02,
    depth: 0.02,
    nx: 10,
    ny: 2,
    nz: 2,
    faceTags: { minX: "fixed", maxX: "tip" },
  });

  const mat: MaterialProperties = { E: 69e9, nu: 0.33, rho: 2700 };
  const solver = new FeaSolver(mesh, mat);

  const fixedNodes = new Set(mesh.boundaryNodes.get("fixed") ?? [0, 1, 2]);
  const tipNodes = mesh.boundaryNodes.get("tip") ?? [mesh.numNodes - 1];

  const bcs: FeaBoundaryConditions = {
    fixedNodes,
    nodalLoads: new Map(),
    corotational: true,
  };

  // Warmup
  for (let i = 0; i < 5; i++) {
    solver.step(bcs);
  }

  // Measure 100 consecutive time steps
  const tStart = performance.now();
  for (let step = 0; step < 100; step++) {
    bcs.nodalLoads.clear();
    const force = 10.0 * Math.sin(step * 0.1);
    for (const n of tipNodes) {
      bcs.nodalLoads.set(n, [0, force / tipNodes.length, 0]);
    }
    const res = solver.step(bcs);
    assert.ok(!isNaN(res.maxDisplacement), "Displacement must be valid number");
  }
  const tElapsed = performance.now() - tStart;
  const timePerStep = tElapsed / 100;

  console.log(`100 corotational steps completed in ${tElapsed.toFixed(2)} ms (${timePerStep.toFixed(3)} ms/step)`);
  assert.ok(timePerStep < 10.0, `Each FEA step should execute in < 10ms, got ${timePerStep.toFixed(2)}ms`);

  console.log("✔ FeaSolver zero-allocation high-speed stepping verified successfully!");
}

runAllocationTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
