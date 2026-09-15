// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FeaSolver, Tet4Mesher, type FeaBoundaryConditions, type MaterialProperties } from "../src/index.js";

async function runTests() {
  console.log("=== Testing: In-Engine Tetrahedral Mesher for Arbitrary Voxel & Surface Geometry ===");

  // ── Test 1: Voxel-Based Meshing (L-bracket) ──
  const nx = 6,
    ny = 4,
    nz = 3;
  const grid = new Uint8Array(nx * ny * nz);

  // Form an L-bracket solid
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x < 2 || y < 2) {
          grid[x + y * nx + z * nx * ny] = 1;
        }
      }
    }
  }

  const mesh = Tet4Mesher.createFromVoxelGrid({
    grid,
    nx,
    ny,
    nz,
    dx: 0.01,
    origin: [0, 0, 0],
  });

  console.log(`L-bracket mesh generated: ${mesh.numNodes} nodes, ${mesh.numElements} elements`);
  assert.ok(mesh.numNodes > 0, "Nodes must be allocated");
  assert.ok(mesh.numElements > 0, "Elements must be allocated");

  // Verify all tetrahedra have positive volume Jacobian
  const coords = mesh.nodeCoords;
  for (let e = 0; e < mesh.numElements; e++) {
    const n0 = mesh.elements[e * 4 + 0];
    const n1 = mesh.elements[e * 4 + 1];
    const n2 = mesh.elements[e * 4 + 2];
    const n3 = mesh.elements[e * 4 + 3];

    const v1x = coords[n1 * 3] - coords[n0 * 3];
    const v1y = coords[n1 * 3 + 1] - coords[n0 * 3 + 1];
    const v1z = coords[n1 * 3 + 2] - coords[n0 * 3 + 2];

    const v2x = coords[n2 * 3] - coords[n0 * 3];
    const v2y = coords[n2 * 3 + 1] - coords[n0 * 3 + 1];
    const v2z = coords[n2 * 3 + 2] - coords[n0 * 3 + 2];

    const v3x = coords[n3 * 3] - coords[n0 * 3];
    const v3y = coords[n3 * 3 + 1] - coords[n0 * 3 + 1];
    const v3z = coords[n3 * 3 + 2] - coords[n0 * 3 + 2];

    const crossX = v1y * v2z - v1z * v2y;
    const crossY = v1z * v2x - v1x * v2z;
    const crossZ = v1x * v2y - v1y * v2x;

    const det = crossX * v3x + crossY * v3y + crossZ * v3z;
    assert.ok(det > 1e-12, `Element ${e} must have positive volume Jacobian, got ${det}`);
  }

  // ── Test 2: FEA Solver Execution on In-Engine Voxel Mesh ──
  const fixedNodes = new Set(mesh.boundaryNodes.get("fixed_support") ?? [0, 1, 2]);
  const loadNodes = mesh.boundaryNodes.get("tip_load") ?? [mesh.numNodes - 1];
  const nodalLoads = new Map<number, [number, number, number]>();
  for (const n of loadNodes) {
    nodalLoads.set(n, [0, -10.0 / loadNodes.length, 0]); // 10 N downward
  }

  const mat: MaterialProperties = { E: 69e9, nu: 0.33 }; // Aluminum
  const bcs: FeaBoundaryConditions = { fixedNodes, nodalLoads };

  const solver = new FeaSolver(mesh, mat);
  const result = solver.solve(bcs);

  let maxDisp = 0;
  for (let i = 0; i < mesh.numNodes; i++) {
    const d = Math.hypot(result.displacements[i * 3], result.displacements[i * 3 + 1], result.displacements[i * 3 + 2]);
    if (d > maxDisp) maxDisp = d;
  }
  console.log(
    `FEA result on voxel L-bracket: maxDisp = ${(maxDisp * 1000).toFixed(4)} mm, maxStress = ${(Math.max(...result.nodalVonMises) / 1e6).toFixed(2)} MPa`,
  );
  assert.ok(maxDisp > 0, "Deflection must be positive");
  assert.ok(!isNaN(maxDisp), "Deflection must not be NaN");

  // ── Test 3: Surface-Based Meshing (Cube Triangulation) ──
  // 8 vertices of a cube
  const cubeVerts = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
  // 12 triangles (2 per face)
  const cubeTris = new Uint32Array([
    0,
    2,
    1,
    0,
    3,
    2, // bottom (z=0)
    4,
    5,
    6,
    4,
    6,
    7, // top (z=1)
    0,
    1,
    5,
    0,
    5,
    4, // front (y=0)
    2,
    3,
    7,
    2,
    7,
    6, // back (y=1)
    0,
    4,
    7,
    0,
    7,
    3, // left (x=0)
    1,
    2,
    6,
    1,
    6,
    5, // right (x=1)
  ]);

  const surfaceMesh = Tet4Mesher.createFromSurfaceMesh({
    vertices: cubeVerts,
    indices: cubeTris,
    resolution: 6,
  });

  console.log(`Surface mesh tetrahedralized: ${surfaceMesh.numNodes} nodes, ${surfaceMesh.numElements} elements`);
  assert.ok(surfaceMesh.numElements > 0, "Surface mesh must produce tetrahedra");

  console.log("✔ In-engine tetrahedral meshing verified successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
