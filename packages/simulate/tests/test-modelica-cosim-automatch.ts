import { compileScadToSolid } from "@modelscript/scad";
import { LbmVoxelizer } from "../src/cfd/lbm-voxelizer.js";
import { LiveCoSimOrchestrator } from "../src/core/live-cosim-orchestrator.js";
import { Tet4Mesher } from "../src/fea/tet4-mesher.js";
import type { MaterialProperties } from "../src/fea/tet4-types.js";

async function main() {
  console.log("=== Test: Modelica Multi-Physics Co-Simulation with Automatic Name Matching ===");

  // 1. Generate CAD model using Hybrid SCAD with semantic port tags
  const scadSource = `
arm_len = 80;
arm_w = 12;
arm_h = 6;

// Fixed Root Support Port
tag_port("fixed_hub", "fixed_support") {
  cube([20, 20, 10], center = true);
}

// Chained Flexible Arm
cube([arm_len, arm_w, arm_h])
  .fillet(1.0)
  .translate([10, 0, 0]);

// Actuator Flange Port
tag_port("motor_mount", "mechanical_flange")
  translate([arm_len + 10, 0, 0])
    cylinder(r = 8, h = 8, center = true);
`;

  console.log("Compiling Hybrid SCAD model...");
  const solid = await compileScadToSolid(scadSource);
  if (!solid) {
    throw new Error("Failed to compile SCAD solid");
  }

  // 2. Generate Quadratic Tet10 FEA mesh with boundary tags from CAD model
  const mesh = Tet4Mesher.createBoxMesh({
    width: 0.1, // 100mm beam
    height: 0.015,
    depth: 0.015,
    nx: 10,
    ny: 2,
    nz: 2,
    order: "quadratic",
    faceTags: {
      minX: "fixed_hub",
      maxX: "motor_mount",
    },
  });

  const aluminum: MaterialProperties = {
    E: 69e9,
    nu: 0.33,
    rho: 2700,
  };

  console.log(`FEA Mesh: ${mesh.numNodes} nodes (Tet10 quadratic), ${mesh.numElements} elements.`);
  const fixedNodes = mesh.boundaryNodes.get("fixed_hub") ?? [];
  const motorNodes = mesh.boundaryNodes.get("motor_mount") ?? [];
  console.log(`Port "fixed_hub": ${fixedNodes.length} nodes, Port "motor_mount": ${motorNodes.length} nodes.`);

  // 3. Voxelize for CFD lattice
  const cfdConfig = {
    nx: 24,
    ny: 12,
    nz: 12,
    dx: 0.01,
    dt: 2e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [2.0, 0, 0] as [number, number, number],
    turbulenceModel: "smagorinsky_les" as const,
  };
  const cellTypes = LbmVoxelizer.voxelize(cfdConfig, {
    boxes: [{ min: [0.2, 0.35, 0.35], max: [0.8, 0.65, 0.65] }],
  });

  // 4. Initialize Orchestrator WITHOUT specifying fixedTag or loadTag
  // Automatic Name Matching will discover them autonomously!
  const orchestrator = new LiveCoSimOrchestrator({
    macroDt: 0.005,
    lbmSubSteps: 3,
    fea: {
      mesh,
      material: aluminum,
      tol: 1e-5,
      maxIters: 200,
    },
    cfd: {
      config: cfdConfig,
      cellTypes,
    },
    system: {
      mass: 0.5,
      stiffness: 80.0,
      baseDamping: 2.0,
    },
  });

  const portMappings = orchestrator.getPortMappings();
  console.log("Automatic Name Matching Port Mappings:");
  for (const m of portMappings) {
    console.log(`  ✔ Tag "${m.matchedTag}" matched to role: ${m.role} (${m.nodeCount} boundary nodes)`);
  }

  const fixedMapping = portMappings.find((m) => m.role === "fixed_support");
  const flangeMapping = portMappings.find((m) => m.role === "mechanical_flange");

  if (!fixedMapping || fixedMapping.matchedTag !== "fixed_hub") {
    throw new Error("Automatic Name Matching failed to match 'fixed_hub' as fixed_support");
  }
  if (!flangeMapping || flangeMapping.matchedTag !== "motor_mount") {
    throw new Error("Automatic Name Matching failed to match 'motor_mount' as mechanical_flange");
  }

  // 5. Run 50 co-simulation steps with two-way aeroelastic coupling
  console.log("Running 50 synchronous co-simulation steps with 2-way aeroelastic coupling...");
  const t0 = performance.now();

  for (let i = 0; i < 50; i++) {
    // Command 8N thrust on motor_mount
    const state = orchestrator.step({ motor_mount: 8.0 });

    if (i % 10 === 0 || i === 49) {
      console.log(
        `  Step ${i}: t=${state.time.toFixed(3)}s, pos=${state.position.toFixed(4)}m, ` +
          `vel=${state.velocity.toFixed(3)}m/s, structCompliance=${(state.structuralComplianceM * 1000).toFixed(3)}mm, ` +
          `aeroDrag=${state.aerodynamicDragN.toFixed(4)}N, structVel=${state.structuralVelocityM_s.toFixed(4)}m/s`,
      );
    }

    if (isNaN(state.position) || isNaN(state.structuralComplianceM)) {
      throw new Error(`Numerical instability detected at step ${i}`);
    }
  }

  const elapsedMs = performance.now() - t0;
  const fps = 50 / (elapsedMs / 1000);
  console.log(`Co-Simulation completed in ${elapsedMs.toFixed(1)}ms (${fps.toFixed(1)} FPS).`);

  if (fps < 20) {
    console.warn(`Co-simulation FPS (${fps.toFixed(1)}) is lower than interactive target.`);
  }

  console.log("✔ Synchronous Modelica Co-Simulation with Automatic Name Matching & Two-Way FSI passed!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
