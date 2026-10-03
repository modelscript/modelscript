// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FeaSolver, Tet4Mesher, type FeaBoundaryConditions, type MaterialProperties } from "../src/fea/index.js";

console.log("=== Testing 3D Transient Elastodynamics FEA Engine (Newmark-beta) ===");

{
  const L = 0.5; // 0.5 m cantilever beam
  const w = 0.04; // 40 mm
  const h = 0.04; // 40 mm
  const E = 70e9; // 70 GPa Aluminum
  const nu = 0.33;
  const rho = 2700; // 2700 kg/m^3
  const alphaM = 0.5; // Rayleigh mass damping (1/s)
  const betaK = 0.0001; // Rayleigh stiffness damping (s)

  // Theoretical Euler-Bernoulli cantilever first natural frequency:
  // omega_1 = 3.516 * sqrt(E * I / (rho * A * L^4))
  const A = w * h;
  const I = (w * Math.pow(h, 3)) / 12.0;
  const omega1 = 3.516 * Math.sqrt((E * I) / (rho * A * Math.pow(L, 4)));
  const f1 = omega1 / (2 * Math.PI);
  const T1 = 1.0 / f1;

  console.log(`  Theoretical natural frequency f1: ${f1.toFixed(2)} Hz (Period T1 = ${(T1 * 1000).toFixed(2)} ms)`);

  // Mesh as Tet10 quadratic elements for high bending fidelity
  const mesh = Tet4Mesher.createBoxMesh({
    width: L,
    height: h,
    depth: w,
    nx: 10,
    ny: 2,
    nz: 2,
    order: "quadratic",
    faceTags: {
      minX: "fixed_root",
      maxX: "tip",
    },
  });

  console.log(`  Mesh created: ${mesh.numNodes} nodes, ${mesh.numElements} quadratic elements`);

  const material: MaterialProperties = { E, nu, rho, alphaM, betaK };
  const solver = new FeaSolver(mesh, material);

  const fixedNodes = new Set(mesh.boundaryNodes.get("fixed_root") ?? []);
  const tipNodes = mesh.boundaryNodes.get("tip") ?? [];
  assert(fixedNodes.size > 0, "No fixed root nodes found");
  assert(tipNodes.length > 0, "No tip nodes found");

  const dt = 0.0005; // 0.5 ms time step
  const totalSteps = 60;
  const tipDisplacements: number[] = [];

  // Step 1: Apply initial tip pulse load of 500 N downward
  const pulseLoads = new Map<number, [number, number, number]>();
  for (const n of tipNodes) {
    pulseLoads.set(n, [0, -500 / tipNodes.length, 0]);
  }

  const freeLoads = new Map<number, [number, number, number]>();

  console.log(`  Stepping transient dynamics for ${totalSteps} steps (dt = ${(dt * 1000).toFixed(2)} ms)...`);
  const tStart = performance.now();

  for (let s = 0; s < totalSteps; s++) {
    const t = s * dt;
    // Drive for first 30 steps (approx 2 full periods), then release for free decay
    const fCurrent = s < 30 ? -500 * Math.sin(2 * Math.PI * f1 * t) : 0;
    const stepLoads = new Map<number, [number, number, number]>();
    if (Math.abs(fCurrent) > 1e-6) {
      for (const n of tipNodes) {
        stepLoads.set(n, [0, fCurrent / tipNodes.length, 0]);
      }
    }

    const bcs: FeaBoundaryConditions = {
      fixedNodes,
      nodalLoads: stepLoads,
      transient: true,
      dt,
    };

    const res = solver.step(bcs, 1e-6, 300);

    // Verify velocities and accelerations are returned
    assert(res.velocities !== undefined, `Step ${s}: velocities must be returned in transient mode`);
    assert(res.accelerations !== undefined, `Step ${s}: accelerations must be returned in transient mode`);
    assert(!isNaN(res.maxDisplacement), `Step ${s}: displacement must not be NaN`);

    let tipDispYSum = 0;
    for (const n of tipNodes) {
      tipDispYSum += res.displacements[n * 3 + 1];
    }
    const avgTipY = tipDispYSum / tipNodes.length;
    tipDisplacements.push(avgTipY);
  }

  const duration = performance.now() - tStart;
  console.log(
    `  Completed ${totalSteps} transient steps in ${duration.toFixed(2)} ms (${(duration / totalSteps).toFixed(2)} ms/step, ${(1000 / (duration / totalSteps)).toFixed(1)} FPS)`,
  );
  console.log(
    `  First 10 tip displacements: ${tipDisplacements
      .slice(0, 10)
      .map((y) => (y * 1000).toFixed(4))
      .join(", ")} mm`,
  );
  console.log(
    `  Steps 10-20 tip displacements: ${tipDisplacements
      .slice(10, 20)
      .map((y) => (y * 1000).toFixed(4))
      .join(", ")} mm`,
  );

  // Verify dynamic behavior:
  // 1. Tip displacement oscillates (changes sign or shows wave peaks)
  let zeroCrossings = 0;
  for (let i = 1; i < tipDisplacements.length; i++) {
    if (
      (tipDisplacements[i - 1] < 0 && tipDisplacements[i] >= 0) ||
      (tipDisplacements[i - 1] > 0 && tipDisplacements[i] <= 0)
    ) {
      zeroCrossings++;
    }
  }
  console.log(`  Observed zero crossings in ${totalSteps * dt * 1000} ms: ${zeroCrossings}`);
  assert(zeroCrossings >= 1, "Transient dynamics must exhibit structural oscillation (zero-crossings)");

  // 2. Rayleigh damping decays oscillation amplitude
  const maxInitialAmp = Math.max(...tipDisplacements.slice(0, 15).map(Math.abs));
  const maxLateAmp = Math.max(...tipDisplacements.slice(40, 60).map(Math.abs));
  console.log(`  Initial vibration amplitude: ${(maxInitialAmp * 1000).toFixed(3)} mm`);
  console.log(`  Damped vibration amplitude (late): ${(maxLateAmp * 1000).toFixed(3)} mm`);
  assert(maxLateAmp < maxInitialAmp, "Damping must decay late vibration amplitude relative to initial peak");

  console.log("  ✓ 3D Transient Elastodynamics correctly captures inertia, natural oscillation, and Rayleigh damping!");
}

console.log("All Transient Elastodynamics tests passed successfully!");
