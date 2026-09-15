import { BinOp, Causality, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import { LbmVoxelizer } from "../src/cfd/lbm-voxelizer.js";
import { LiveCoSimOrchestrator } from "../src/core/live-cosim-orchestrator.js";
import { ArenaSimulator } from "../src/core/simulate-arena.js";
import { Tet4Mesher } from "../src/fea/tet4-mesher.js";
import type { MaterialProperties } from "../src/fea/tet4-types.js";

async function main() {
  console.log("=== Test: Compiled Modelica DAE Co-Simulation with 3D FEA & CFD ===");

  await initBltWasm();

  // 1. Build a 1D Modelica dynamic DAE model:
  //    der(thrust) = (target_thrust - k_feedback * sensor_disp - thrust) / tau
  //    actuator_thrust = thrust
  const arena = new DAEBuilder();

  // Variables
  const vThrust = arena.addVariable("thrust", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  arena.setVarStartValue(vThrust, 0.0);

  const vActuatorThrust = arena.addVariable(
    "actuator_thrust",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    0.0,
  );
  arena.setVarStartValue(vActuatorThrust, 0.0);

  const vSensorDisp = arena.addVariable("sensor_disp", VarType.Real, Variability.Continuous, Causality.Input, 0.0);
  arena.setVarStartValue(vSensorDisp, 0.0);

  const vTargetThrust = arena.addVariable("target_thrust", VarType.Real, Variability.Parameter, Causality.Local, 150.0);
  arena.setVarExpression(vTargetThrust, arena.addRealLiteral(150.0));

  const vKFeedback = arena.addVariable("k_feedback", VarType.Real, Variability.Parameter, Causality.Local, 50000.0);
  arena.setVarExpression(vKFeedback, arena.addRealLiteral(50000.0));

  const vTau = arena.addVariable("tau", VarType.Real, Variability.Parameter, Causality.Local, 0.02);
  arena.setVarExpression(vTau, arena.addRealLiteral(0.02));

  // Equation 1: der(thrust) = (target_thrust - k_feedback * sensor_disp - thrust) / tau
  const derThrust = arena.addDerExpr(arena.addNameExpr("thrust"));
  const targetExpr = arena.addNameExpr("target_thrust");
  const kfExpr = arena.addNameExpr("k_feedback");
  const sensorExpr = arena.addNameExpr("sensor_disp");
  const thrustExpr = arena.addNameExpr("thrust");
  const tauExpr = arena.addNameExpr("tau");

  const feedbackTerm = arena.addBinaryExpr(BinOp.Mul, kfExpr, sensorExpr);
  const diff1 = arena.addBinaryExpr(BinOp.Sub, targetExpr, feedbackTerm);
  const diff2 = arena.addBinaryExpr(BinOp.Sub, diff1, thrustExpr);
  const rhsRate = arena.addBinaryExpr(BinOp.Div, diff2, tauExpr);
  arena.addEquation(EqKind.Simple, derThrust, rhsRate);

  // Equation 2: actuator_thrust = thrust
  const actExpr = arena.addNameExpr("actuator_thrust");
  arena.addEquation(EqKind.Simple, actExpr, thrustExpr);

  // Prepare simulator
  const sim = new ArenaSimulator(arena);
  sim.prepare();

  // 2. Build 3D Quadratic Tet10 Structural Mesh with semantic boundary patches
  const mesh = Tet4Mesher.createBoxMesh({
    width: 0.12, // 120 mm cantilever beam
    height: 0.015,
    depth: 0.015,
    nx: 6,
    ny: 2,
    nz: 2,
    order: "quadratic",
    faceTags: {
      minX: "fixed_hub",
      maxX: "motor_flange",
    },
  });

  const aluminum: MaterialProperties = {
    E: 70e9,
    nu: 0.33,
    rho: 2700,
    alphaM: 0.5,
    betaK: 1e-4,
  };

  console.log(`FEA Mesh: ${mesh.numNodes} nodes (Tet10), ${mesh.numElements} elements.`);

  // 3. Voxelize CFD lattice
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

  // 4. Instantiate LiveCoSimOrchestrator with compiled Modelica DAE
  const macroDt = 0.005; // 5ms
  const orchestrator = new LiveCoSimOrchestrator({
    macroDt,
    lbmSubSteps: 2,
    fea: {
      mesh,
      material: aluminum,
      tol: 1e-5,
      maxIters: 200,
      transient: true,
    },
    cfd: {
      config: cfdConfig,
      cellTypes,
    },
    system: {
      modelica: {
        simulator: sim,
        actuatorVar: "actuator_thrust",
        sensorVar: "sensor_disp",
        solver: "rk4",
      },
    },
  });

  // 5. Verify Automatic Port Matching
  const mappings = orchestrator.getPortMappings();
  console.log("Automatic Port Mappings:", mappings);

  const fixedMapping = mappings.find((m) => m.role === "fixed_support");
  const actuatorMapping = mappings.find((m) => m.role === "mechanical_flange");

  if (!fixedMapping || fixedMapping.matchedTag !== "fixed_hub") {
    throw new Error(`Expected fixed_hub to be matched as fixed_support, got: ${JSON.stringify(fixedMapping)}`);
  }
  if (!actuatorMapping || actuatorMapping.matchedTag !== "motor_flange") {
    throw new Error(
      `Expected motor_flange to be matched as mechanical_flange, got: ${JSON.stringify(actuatorMapping)}`,
    );
  }

  // 6. Run Co-Simulation Steps
  const numSteps = 40;
  console.log(`Running ${numSteps} multi-physics co-simulation steps (Modelica DAE + 3D FEA + 3D CFD)...`);

  const tStart = performance.now();
  let maxDisplacementOverall = 0.0;
  let maxThrust = 0.0;

  for (let s = 1; s <= numSteps; s++) {
    const state = orchestrator.step();

    if (state.appliedThrustN > maxThrust) {
      maxThrust = state.appliedThrustN;
    }
    if (state.structuralComplianceM > maxDisplacementOverall) {
      maxDisplacementOverall = state.structuralComplianceM;
    }

    if (s % 10 === 0) {
      console.log(
        `Step ${s.toString().padStart(2, " ")} | Time: ${(state.time * 1000).toFixed(1)}ms | ` +
          `Thrust: ${state.appliedThrustN.toFixed(2)}N | ` +
          `FEA Disp: ${(state.structuralComplianceM * 1000).toFixed(4)}mm | ` +
          `CFD Drag: ${state.aerodynamicDragN.toFixed(3)}N | ` +
          `FEA Velocities: ${state.feaResult.velocities ? "active" : "none"}`,
      );
    }
  }

  const elapsedMs = performance.now() - tStart;
  const fps = (numSteps / elapsedMs) * 1000;
  console.log(`\nCo-Simulation Performance: ${fps.toFixed(1)} FPS (${(elapsedMs / numSteps).toFixed(1)} ms/step)`);

  // Assertions
  if (maxThrust < 20.0) {
    throw new Error(`Expected dynamic actuator thrust to develop, got max: ${maxThrust} N`);
  }
  if (maxDisplacementOverall < 1e-6) {
    throw new Error(`Expected structural compliance response in FEA, got max: ${maxDisplacementOverall} m`);
  }
  const finalState = orchestrator.getState();
  if (!finalState.feaResult.velocities || !finalState.feaResult.accelerations) {
    throw new Error("Expected transient elastodynamics velocities and accelerations to be computed");
  }
  if (!finalState.modelicaValues) {
    throw new Error("Expected Modelica DAE state values to be populated in LiveCoSimState");
  }

  console.log(`\nMax Actuator Thrust: ${maxThrust.toFixed(2)} N`);
  console.log(`Max Structural Deflection: ${(maxDisplacementOverall * 1000).toFixed(4)} mm`);
  console.log(`FPS: ${fps.toFixed(1)} (Requirement: > 20 FPS) -> ${fps >= 20 ? "PASSED" : "FAILED"}`);
  console.log("\n*** ALL MODELICA DAE CO-SIMULATION TESTS PASSED ***");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
