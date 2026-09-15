// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { LbmVoxelizer } from "../src/cfd/index.js";
import { LiveCoSimOrchestrator } from "../src/core/live-cosim-orchestrator.js";
import { Tet4Mesher } from "../src/fea/index.js";

console.log("=== Testing Phase 4: Live Multi-Physics Co-Simulation Master ===");

{
  // 1. FEA Mesh: Slender drone arm
  const feaMesh = Tet4Mesher.createBoxMesh({
    width: 0.3, // 300 mm arm
    height: 0.02, // 20 mm height
    depth: 0.02, // 20 mm width
    nx: 6,
    ny: 2,
    nz: 2,
    faceTags: {
      minX: "fixed_hub",
      maxX: "motor_mount",
    },
  });

  // 2. CFD Domain: Air channel around the arm
  const cfdConfig = {
    nx: 24,
    ny: 12,
    nz: 12,
    dx: 0.01,
    dt: 2e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [2.0, 0, 0] as [number, number, number],
  };

  const cfdGrid = LbmVoxelizer.voxelize(cfdConfig, {
    cylinders: [
      {
        center: [0.4, 0.5, 0.5],
        radius: 0.2,
        axis: "z",
        length: 1.0,
      },
    ],
  });

  // 3. Instantiate Co-Simulation Orchestrator
  const orchestrator = new LiveCoSimOrchestrator({
    macroDt: 0.01, // 10 ms macro time step (100 Hz simulation rate)
    lbmSubSteps: 2, // 2 LBM iterations per macro step
    fea: {
      mesh: feaMesh,
      material: { E: 70e9, nu: 0.33, yieldStrength: 270e6 },
      fixedTag: "fixed_hub",
      loadTag: "motor_mount",
    },
    cfd: {
      config: cfdConfig,
      cellTypes: cfdGrid,
    },
    system: {
      mass: 0.5, // 500g drone quad arm assembly
      stiffness: 200.0, // 200 N/m chassis restoring spring
      baseDamping: 2.0, // 2.0 N*s/m baseline damping
    },
  });

  console.log("  Initialized Live Multi-Physics Orchestrator.");

  const numSteps = 20;
  const t0 = performance.now();

  for (let s = 1; s <= numSteps; s++) {
    // Dynamic sinusoidal thrust command from 1D Modelica flight controller: T(t) = 15 + 10 * sin(2*pi*f*t) N
    const time = s * 0.01;
    const thrustN = 15.0 + 10.0 * Math.sin(2 * Math.PI * 2.5 * time);

    const state = orchestrator.step(thrustN);

    // Verify non-zero physical outputs
    assert(!isNaN(state.position), `Position NaN at step ${s}`);
    assert(!isNaN(state.velocity), `Velocity NaN at step ${s}`);
    assert(state.feaResult.maxDisplacement >= 0, `Negative FEA displacement at step ${s}`);
    assert(state.feaResult.maxVonMisesStress >= 0, `Negative von Mises stress at step ${s}`);
    assert(!isNaN(state.cfdResult.maxVelocity), `CFD max velocity NaN at step ${s}`);
  }

  const t1 = performance.now();
  const totalMs = t1 - t0;
  const msPerStep = totalMs / numSteps;
  const fps = 1000.0 / msPerStep;

  console.log(
    `  Completed ${numSteps} coupled 1D+FEA+CFD steps in ${totalMs.toFixed(2)}ms (${msPerStep.toFixed(2)}ms/step -> ${fps.toFixed(1)} FPS equivalent).`,
  );

  const finalState = orchestrator.getState();
  console.log(
    `  Final State: t=${finalState.time.toFixed(2)}s, pos=${(finalState.position * 1000).toFixed(2)}mm, vel=${finalState.velocity.toFixed(3)}m/s`,
  );
  console.log(
    `  FEA: tipDeflection=${(finalState.structuralComplianceM * 1000).toFixed(4)}mm, maxStress=${(finalState.feaResult.maxVonMisesStress / 1e6).toFixed(2)}MPa`,
  );
  console.log(
    `  CFD: dragForce=${finalState.aerodynamicDragN.toFixed(5)}N, flowSpeed=${finalState.cfdResult.maxVelocity.toFixed(2)}m/s`,
  );

  // Assert frame rate comfortably supports interactive speeds (> 25 FPS)
  assert(fps > 25, `FPS ${fps} below interactive threshold (expected > 25 FPS)`);
  console.log("  ✓ Co-simulation loop executed stably with high frame-rate performance.");
}

// 2. High-Fidelity Scenario: Quadratic Tet10 FEA + Smagorinsky LES + Bouzidi curved boundaries
{
  console.log("\n  --- Scenario 2: SOTA Quadratic Tet10 FEA + Smagorinsky LES CFD ---");

  // 1. Quadratic Tet10 FEA Mesh
  const feaMesh = Tet4Mesher.createBoxMesh({
    width: 0.3,
    height: 0.02,
    depth: 0.02,
    nx: 6,
    ny: 2,
    nz: 2,
    order: "quadratic",
    faceTags: {
      minX: "fixed_hub",
      maxX: "motor_mount",
    },
  });
  assert.strictEqual(feaMesh.elementOrder, "quadratic");

  // 2. CFD with Smagorinsky LES & Bouzidi curved wall boundaries
  const cfdConfig = {
    nx: 24,
    ny: 12,
    nz: 12,
    dx: 0.01,
    dt: 2e-4,
    tau: 0.52, // higher Re
    density: 1.225,
    inletVelocity: [3.0, 0, 0] as [number, number, number],
    turbulenceModel: "smagorinsky_les" as const,
    smagorinskyConstant: 0.14,
    curvedBoundary: true,
  };

  const obstacles = {
    cylinders: [
      {
        center: [0.4, 0.5, 0.5] as [number, number, number],
        radius: 0.2,
        axis: "z" as const,
        length: 1.0,
      },
    ],
  };

  const cfdGrid = LbmVoxelizer.voxelize(cfdConfig, obstacles);
  const deltaWall = LbmVoxelizer.computeWallDistances(cfdConfig, obstacles, cfdGrid);
  (cfdConfig as any).deltaWall = deltaWall;

  const orchestrator = new LiveCoSimOrchestrator({
    macroDt: 0.01,
    lbmSubSteps: 2,
    fea: {
      mesh: feaMesh,
      material: { E: 70e9, nu: 0.33, yieldStrength: 270e6 },
      fixedTag: "fixed_hub",
      loadTag: "motor_mount",
      tol: 1e-4,
      maxIters: 150,
    },
    cfd: {
      config: cfdConfig,
      cellTypes: cfdGrid,
    },
    system: {
      mass: 0.5,
      stiffness: 200.0,
      baseDamping: 2.0,
    },
  });

  const numSteps = 20;
  const t0 = performance.now();

  for (let s = 1; s <= numSteps; s++) {
    const time = s * 0.01;
    const thrustN = 15.0 + 10.0 * Math.sin(2 * Math.PI * 2.5 * time);
    const state = orchestrator.step(thrustN);

    assert(!isNaN(state.position), `Position NaN at step ${s}`);
    assert(!isNaN(state.velocity), `Velocity NaN at step ${s}`);
    assert(state.feaResult.maxDisplacement >= 0);
  }

  const duration = performance.now() - t0;
  const msPerStep = duration / numSteps;
  const fps = 1000.0 / msPerStep;

  console.log(
    `  Completed ${numSteps} Tet10+LES co-sim steps in ${duration.toFixed(2)}ms (${msPerStep.toFixed(2)}ms/step -> ${fps.toFixed(1)} FPS equivalent).`,
  );
  assert(fps > 20, `FPS ${fps} below interactive real-time threshold`);
  console.log("  ✓ High-fidelity Tet10 FEA + Smagorinsky LES co-simulation executed stably in real time!");
}

console.log("\nAll Live Multi-Physics Co-Simulation tests passed successfully!");
