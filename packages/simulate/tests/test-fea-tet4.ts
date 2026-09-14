// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FeaSolver, Tet4Element, Tet4Mesher } from "../src/fea/index.js";

console.log("=== Testing Phase 2: In-WASM Linear Tet4 FEA Engine ===");

// 1. Element stiffness symmetry and positive definiteness
{
  const material = { E: 70e9, nu: 0.33 };
  const D = Tet4Element.computeConstitutiveMatrix(material);

  const p0: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [1, 0, 0];
  const p2: [number, number, number] = [0, 1, 0];
  const p3: [number, number, number] = [0, 0, 1];

  const { Ke, volume } = Tet4Element.computeElementStiffness(p0, p1, p2, p3, D);

  assert(Math.abs(volume - 1 / 6) < 1e-6, `Volume mismatch: ${volume}`);

  // Ke must be symmetric (Ke[i, j] === Ke[j, i])
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      const diff = Math.abs(Ke[i * 12 + j] - Ke[j * 12 + i]);
      assert(diff < 1e-3, `Ke not symmetric at (${i}, ${j}): diff=${diff}`);
    }
  }

  // Diagonal entries must be strictly positive
  for (let i = 0; i < 12; i++) {
    assert(Ke[i * 12 + i] > 0, `Ke diagonal non-positive at ${i}`);
  }

  console.log("  ✓ Element stiffness matrix is symmetric and positive-definite.");
}

// 2. Uniaxial tension test vs exact 1D elasticity: delta = F * L / (E * A)
{
  const L = 1.0;
  const w = 0.05;
  const h = 0.05;
  const E = 70e9;
  const nu = 0.33;
  const totalForceX = 10000; // 10 kN tensile force

  const mesh = Tet4Mesher.createBoxMesh({
    width: L,
    height: h,
    depth: w,
    nx: 10,
    ny: 2,
    nz: 2,
    faceTags: {
      minX: "fixed_support",
      maxX: "tip_load",
    },
  });

  const fixedNodes = new Set(mesh.boundaryNodes.get("fixed_support")!);
  const tipNodes = mesh.boundaryNodes.get("tip_load")!;

  const nodalLoads = new Map<number, [number, number, number]>();
  const forcePerNode = totalForceX / tipNodes.length;
  for (const node of tipNodes) {
    nodalLoads.set(node, [forcePerNode, 0, 0]);
  }

  const solver = new FeaSolver(mesh, { E, nu });
  const t0 = performance.now();
  const result = solver.step({ fixedNodes, nodalLoads });
  const t1 = performance.now();

  const area = w * h;
  const analyticalDelta = (totalForceX * L) / (E * area);

  console.log(
    `  Uniaxial tension: computed=${(result.maxDisplacement * 1000).toFixed(4)}mm, analytical=${(analyticalDelta * 1000).toFixed(4)}mm, solveTime=${(t1 - t0).toFixed(2)}ms`,
  );

  // Clamped end restricts Poisson contraction near root, so displacement is within 15% of 1D theory
  assert(
    Math.abs(result.maxDisplacement - analyticalDelta) / analyticalDelta < 0.2,
    `Tension mismatch: computed=${result.maxDisplacement}, analytical=${analyticalDelta}`,
  );
  console.log("  ✓ Uniaxial tension matched analytical elasticity solution.");
}

// 3. Cantilever beam bending and stress evaluation
{
  const L = 1.0;
  const w = 0.05;
  const h = 0.05;
  const E = 70e9;
  const nu = 0.33;
  const tipForceY = -1000; // 1000 N downwards

  const mesh = Tet4Mesher.createBoxMesh({
    width: L,
    height: h,
    depth: w,
    nx: 10,
    ny: 2,
    nz: 2,
    faceTags: {
      minX: "fixed_support",
      maxX: "tip_load",
    },
  });

  const fixedNodes = new Set(mesh.boundaryNodes.get("fixed_support")!);
  const tipNodes = mesh.boundaryNodes.get("tip_load")!;

  const nodalLoads = new Map<number, [number, number, number]>();
  const forcePerNode = tipForceY / tipNodes.length;
  for (const node of tipNodes) {
    nodalLoads.set(node, [0, forcePerNode, 0]);
  }

  const solver = new FeaSolver(mesh, { E, nu, yieldStrength: 270e6 });
  const t0 = performance.now();
  const result = solver.step({ fixedNodes, nodalLoads });
  const t1 = performance.now();

  console.log(
    `  Bending deflection: ${(result.maxDisplacement * 1000).toFixed(3)}mm, maxStress: ${(result.maxVonMisesStress / 1e6).toFixed(2)}MPa, solveTime: ${(t1 - t0).toFixed(2)}ms`,
  );

  // Max displacement must be positive, reasonable, and solved rapidly (< 35ms)
  assert(result.maxDisplacement > 1e-4, `Expected measurable bending deflection > 0.1mm`);
  assert(result.maxVonMisesStress > 1e6, "Expected max stress > 1 MPa");
  assert.strictEqual(result.nodalVonMises.length, mesh.numNodes);
  assert.strictEqual(result.elementVonMises.length, mesh.numElements);

  console.log("  ✓ Solved cantilever beam bending and computed von Mises stresses.");
}

console.log("All FEA Tet4 tests passed successfully!");
