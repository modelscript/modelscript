// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FeaSolver, Tet4Mesher, type FeaBoundaryConditions, type MaterialProperties } from "../src/fea/index.js";

console.log("=== Testing Tet10 Quadratic FEA Engine: Bending Accuracy vs Euler-Bernoulli ===");

{
  const L = 1.0;
  const w = 0.05;
  const h = 0.05;
  const E = 70e9; // 70 GPa Aluminum
  const nu = 0.33;
  const F_total = -1000; // 1000 N downward at tip

  // Analytical Euler-Bernoulli deflection: delta = F * L^3 / (3 * E * I)
  const I = (w * Math.pow(h, 3)) / 12.0;
  const deltaAnalytical = Math.abs((F_total * Math.pow(L, 3)) / (3 * E * I)); // ~0.009142857 m = 9.143 mm
  console.log(`  Analytical Euler-Bernoulli tip deflection: ${(deltaAnalytical * 1000).toFixed(4)} mm`);

  // Mesh as quadratic Tet10
  const mesh = Tet4Mesher.createBoxMesh({
    width: L,
    height: h,
    depth: w,
    nx: 20,
    ny: 2,
    nz: 2,
    order: "quadratic",
    faceTags: {
      minX: "fixed_root",
      maxX: "tip_load",
    },
  });

  console.log(`  Tet10 Mesh created: ${mesh.numNodes} nodes, ${mesh.numElements} quadratic elements`);
  assert.strictEqual(mesh.elementOrder, "quadratic");
  assert.strictEqual(mesh.nodesPerElement, 10);

  const material: MaterialProperties = { E, nu, yieldStrength: 270e6 };
  const solver = new FeaSolver(mesh, material);

  const fixedNodes = new Set(mesh.boundaryNodes.get("fixed_root") ?? []);
  const tipNodes = mesh.boundaryNodes.get("tip_load") ?? [];
  assert(fixedNodes.size > 0, "No fixed root nodes found");
  assert(tipNodes.length > 0, "No tip nodes found");

  const nodalLoads = new Map<number, [number, number, number]>();
  const fPerNode = F_total / tipNodes.length;
  for (const n of tipNodes) {
    nodalLoads.set(n, [0, fPerNode, 0]);
  }

  const bcs: FeaBoundaryConditions = { fixedNodes, nodalLoads };

  const startTime = performance.now();
  const res = solver.step(bcs, 1e-7, 1500);
  const duration = performance.now() - startTime;

  // Measure tip deflection (average Y displacement at maxX tip nodes)
  let tipDispYSum = 0;
  for (const n of tipNodes) {
    tipDispYSum += res.displacements[n * 3 + 1];
  }
  const avgTipDisp = Math.abs(tipDispYSum / tipNodes.length);
  const errorPercent = Math.abs((avgTipDisp - deltaAnalytical) / deltaAnalytical) * 100;

  console.log(`  Tet10 computed tip deflection: ${(avgTipDisp * 1000).toFixed(4)} mm`);
  console.log(`  Discrepancy vs analytical: ${errorPercent.toFixed(2)}% (Solve time: ${duration.toFixed(2)}ms)`);
  console.log(`  Max von Mises stress: ${(res.maxVonMisesStress / 1e6).toFixed(2)} MPa`);

  // Verify sub-2% accuracy target (fixing the 84% linear Tet4 shear-locking deficit!)
  assert(errorPercent < 2.0, `Tet10 deflection error ${errorPercent.toFixed(2)}% exceeds 2% threshold`);
  assert(res.maxVonMisesStress > 0, "Stress should be non-zero");

  console.log(
    "  ✓ Quadratic Tet10 matches Euler-Bernoulli analytical bending within < 2% error without shear locking!",
  );
}

console.log("All Tet10 FEA tests passed successfully!");
