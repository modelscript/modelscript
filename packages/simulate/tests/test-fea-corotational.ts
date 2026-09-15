// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FeaSolver, Tet4Mesher, type MaterialProperties } from "../src/fea/index.js";

console.log("=== Testing Corotational Kinematics: 45° Rigid Body Rotation Invariance ===");

{
  const L = 0.5;
  const w = 0.05;
  const h = 0.05;
  const E = 70e9; // 70 GPa Aluminum
  const nu = 0.33;

  const mesh = Tet4Mesher.createBoxMesh({
    width: L,
    height: h,
    depth: w,
    nx: 6,
    ny: 2,
    nz: 2,
    order: "linear",
  });

  const material: MaterialProperties = { E, nu, yieldStrength: 270e6 };
  const solver = new FeaSolver(mesh, material);

  // Apply pure 45-degree rigid body rotation around Z axis
  const theta = (45.0 * Math.PI) / 180.0;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const uRigid = new Float64Array(mesh.numNodes * 3);
  for (let i = 0; i < mesh.numNodes; i++) {
    const x0 = mesh.nodeCoords[i * 3 + 0];
    const y0 = mesh.nodeCoords[i * 3 + 1];
    const z0 = mesh.nodeCoords[i * 3 + 2];

    const xRot = cosT * x0 - sinT * y0;
    const yRot = sinT * x0 + cosT * y0;
    const zRot = z0;

    uRigid[i * 3 + 0] = xRot - x0;
    uRigid[i * 3 + 1] = yRot - y0;
    uRigid[i * 3 + 2] = zRot - z0;
  }

  // 1. Without corotational formulation (standard small-displacement assumption):
  const standardRes = solver.postProcess(uRigid, false);
  console.log(
    `  Standard Linear FEA artificial stress under 45° rotation: ${(standardRes.maxVonMisesStress / 1e6).toFixed(2)} MPa`,
  );
  assert(
    standardRes.maxVonMisesStress > 1e6,
    "Linear FEA should exhibit severe artificial stress under large rotation",
  );

  // 2. With Corotational Kinematics:
  const corotRes = solver.postProcess(uRigid, true);
  console.log(
    `  Corotational FEA resolved stress under 45° rotation: ${corotRes.maxVonMisesStress.toExponential(4)} Pa`,
  );

  // Max stress under rigid rotation should be virtually zero (numerical roundoff < 1 Pa)
  assert(corotRes.maxVonMisesStress < 1.0, `Corotational stress ${corotRes.maxVonMisesStress} exceeds 1.0 Pa`);

  console.log("  ✓ Corotational kinematics eliminates artificial strain under 45° large rigid rotation!");
}

console.log("All Corotational FEA tests passed successfully!");
