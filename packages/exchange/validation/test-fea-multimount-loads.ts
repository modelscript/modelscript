// SPDX-License-Identifier: AGPL-3.0-or-later

import { FeaCoSimParticipant } from "@modelscript/exchange/cosim";
import assert from "node:assert";
import { Tet4Mesher, type MaterialProperties } from "../src/index.js";

async function runMultiMountTest() {
  console.log("=== Testing: FeaCoSimParticipant Multi-Mount Differential Vector Loads ===");

  // Create a T-shaped or dual-tip beam mesh with 2 separate load patches: motor1_mount, motor2_mount
  const nx = 12,
    ny = 4,
    nz = 2;
  const grid = new Uint8Array(nx * ny * nz);

  // Center root (x = 0..3) with 2 branches: branch 1 (y < 2, x >= 4), branch 2 (y >= 2, x >= 4)
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x < 4 || y === 0 || y === ny - 1) {
          grid[x + y * nx + z * nx * ny] = 1;
        }
      }
    }
  }

  const dx = 0.01;
  const mesh = Tet4Mesher.createFromVoxelGrid({
    grid,
    nx,
    ny,
    nz,
    dx,
    tagRules: [
      { name: "fixed_hub", predicate: (x) => x <= 0.015 },
      { name: "motor1_mount", predicate: (x, y) => x >= 0.1 && y <= 0.015 },
      { name: "motor2_mount", predicate: (x, y) => x >= 0.1 && y >= 0.025 },
    ],
  });

  console.log(`Dual-arm mesh: ${mesh.numNodes} nodes, ${mesh.numElements} elements`);
  assert.ok((mesh.boundaryNodes.get("motor1_mount")?.length ?? 0) > 0, "motor1_mount nodes must exist");
  assert.ok((mesh.boundaryNodes.get("motor2_mount")?.length ?? 0) > 0, "motor2_mount nodes must exist");

  const mat: MaterialProperties = { E: 69e9, nu: 0.33, rho: 2700 };
  const fea = new FeaCoSimParticipant("multi-arm", "DualArmFrame", mesh, mat, {
    fixedTag: "fixed_hub",
  });

  // Apply differential loads: motor1 gets 25 N, motor2 gets 5 N
  const inputs = new Map<string, number>();
  inputs.set("motor1.thrust.fy", 25.0);
  inputs.set("motor2.thrust.fy", 5.0);

  await fea.initialize(0, 0.1, 0.01);
  await fea.setInputs(inputs);
  await fea.doStep(0, 0.01);

  const outputs = await fea.getOutputs();
  const m1Disp = Number(outputs.get("motor1_mount.uy") ?? 0);
  const m2Disp = Number(outputs.get("motor2_mount.uy") ?? 0);

  console.log(`Motor 1 displacement (25N load): ${(m1Disp * 1000).toFixed(4)} mm`);
  console.log(`Motor 2 displacement (5N load):  ${(m2Disp * 1000).toFixed(4)} mm`);

  assert.ok(
    m1Disp > m2Disp,
    `Motor 1 deflection (${m1Disp}) must exceed Motor 2 deflection (${m2Disp}) under 5x load!`,
  );
  assert.ok(m1Disp > 0, "Motor 1 deflection must be positive");
  assert.ok(m2Disp > 0, "Motor 2 deflection must be positive");

  console.log("✔ Multi-mount differential vector loads and patch outputs verified successfully!");
}

runMultiMountTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
