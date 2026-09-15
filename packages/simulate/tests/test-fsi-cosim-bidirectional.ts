// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CoSimSession,
  FeaCoSimParticipant,
  LbmCoSimParticipant,
  Orchestrator,
  type CoSimParticipant,
  type CosimValue,
  type ParticipantMetadata,
} from "@modelscript/exchange/cosim";
import assert from "node:assert";
import { Tet4Mesher, type LbmGridConfig, type MaterialProperties } from "../src/index.js";

/**
 * Mock 1D Modelica Vehicle Dynamics Participant with Bidirectional Feedback.
 * Equations:
 *   m * dv/dt = F_thrust - F_drag
 *   deflection = structural_compliance * F_thrust
 */
class ModelicaVehicleParticipant implements CoSimParticipant {
  public readonly id = "1d-vehicle";
  public readonly modelName = "VehicleDynamics";
  public readonly metadata: ParticipantMetadata;

  public velocity = 0; // m/s
  public thrust = 20.0; // N
  public drag = 0; // N (fed back from CFD)
  public deflection = 0; // m (fed back from FEA)
  public readonly mass = 2.0; // kg

  constructor() {
    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "js-simulator",
      classKind: "model",
      timestamp: new Date().toISOString(),
      variables: [
        { name: "velocity", type: "Real", causality: "output" },
        { name: "thrust", type: "Real", causality: "output" },
        { name: "f_drag", type: "Real", causality: "input" },
        { name: "structural_deflection", type: "Real", causality: "input" },
      ],
    };
  }

  public async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    this.velocity = 1.0;
    this.drag = 0;
    this.deflection = 0;
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Semi-implicit Euler step: dv/dt = (thrust - drag) / mass
    const netForce = this.thrust - this.drag;
    const accel = netForce / this.mass;
    this.velocity = Math.max(0, this.velocity + accel * stepSize);
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const map = new Map<string, CosimValue>();
    map.set("velocity", this.velocity);
    map.set("thrust", this.thrust);
    return map;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    if (values.has("f_drag")) {
      this.drag = Number(values.get("f_drag"));
    }
    if (values.has("structural_deflection")) {
      this.deflection = Number(values.get("structural_deflection"));
    }
  }

  public async terminate(): Promise<void> {}
}

async function runTest() {
  console.log("=== Testing: Bidirectional 2-Way FSI (1D Modelica ↔ 3D LBM CFD + 3D FEA) ===");

  const session = new CoSimSession("test-2way-fsi");
  session.experiment = {
    startTime: 0,
    stopTime: 0.1,
    stepSize: 0.01, // 10 communication intervals
  };

  // 1. Participant 1: 1D Modelica vehicle dynamics
  const vehicle = new ModelicaVehicleParticipant();
  session.addParticipant(vehicle);

  // 2. Participant 2: 3D LBM Aerodynamics CFD
  const lbmConfig: LbmGridConfig = {
    nx: 24,
    ny: 12,
    nz: 12,
    dx: 0.01,
    dt: 2e-4,
    tau: 0.6,
    density: 1.225,
    inletVelocity: [1.0, 0, 0],
    turbulenceModel: "smagorinsky_les",
  };
  const cfd = new LbmCoSimParticipant("3d-lbm", "AerodynamicBody", {
    config: lbmConfig,
    obstacles: {
      cylinders: [{ center: [0.4, 0.5, 0.5], radius: 0.2, axis: "z", length: 0.5 }],
    },
  });
  session.addParticipant(cfd);

  // 3. Participant 3: 3D FEA Structural cantilever arm
  const armMesh = Tet4Mesher.createBoxMesh({
    width: 0.1,
    height: 0.01,
    depth: 0.01,
    nx: 8,
    ny: 2,
    nz: 2,
    faceTags: { minX: "fixed_hub", maxX: "motor_mount" },
  });
  const mat: MaterialProperties = { E: 69e9, nu: 0.33, rho: 2700 };
  const fea = new FeaCoSimParticipant("3d-fea", "WingSpar", armMesh, mat, {
    fixedTag: "fixed_hub",
    loadTag: "motor_mount",
  });
  session.addParticipant(fea);

  // 4. Bidirectional Coupling Graph
  // Forward: Vehicle velocity -> CFD moving wall velocity
  session.coupling.addCoupling({
    from: { participantId: "1d-vehicle", variableName: "velocity" },
    to: { participantId: "3d-lbm", variableName: "velocity_x" },
  });

  // Backward: CFD aerodynamic drag -> Vehicle drag force
  session.coupling.addCoupling({
    from: { participantId: "3d-lbm", variableName: "aerodynamic_drag" },
    to: { participantId: "1d-vehicle", variableName: "f_drag" },
  });

  // Forward: Vehicle thrust -> FEA load
  session.coupling.addCoupling({
    from: { participantId: "1d-vehicle", variableName: "thrust" },
    to: { participantId: "3d-fea", variableName: "load.force" },
  });

  // Backward: FEA structural deflection -> Vehicle deflection monitor
  session.coupling.addCoupling({
    from: { participantId: "3d-fea", variableName: "maxDisplacement" },
    to: { participantId: "1d-vehicle", variableName: "structural_deflection" },
  });

  const cfdFrames: any[] = [];
  const feaFrames: any[] = [];
  const velocityHistory: number[] = [];
  const dragHistory: number[] = [];

  const orchestrator = new Orchestrator(session, null, {
    onStep: (stepRes) => {
      velocityHistory.push(vehicle.velocity);
      dragHistory.push(vehicle.drag);

      const feaPayload = fea.getMeshPayload();
      feaFrames.push(feaPayload);

      const cfdPayload = cfd.getMeshPayload();
      cfdFrames.push(cfdPayload);
    },
  });

  const tStart = performance.now();
  await orchestrator.run();
  const elapsed = performance.now() - tStart;

  console.log(`2-way FSI co-simulation completed in ${elapsed.toFixed(2)} ms (10 steps).`);
  console.log(`Initial: v = ${velocityHistory[0].toFixed(3)} m/s, Drag = ${dragHistory[0].toFixed(4)} N`);
  console.log(
    `Final:   v = ${velocityHistory[velocityHistory.length - 1].toFixed(3)} m/s, Drag = ${dragHistory[dragHistory.length - 1].toFixed(4)} N`,
  );
  console.log(`FEA Deflection: ${(vehicle.deflection * 1000).toFixed(4)} mm`);

  // Assertions
  assert.strictEqual(feaFrames.length, 10, "Expected 10 FEA frames");
  assert.strictEqual(cfdFrames.length, 10, "Expected 10 CFD frames");

  // Validate FEA payload
  const lastFea = feaFrames[feaFrames.length - 1];
  assert.strictEqual(lastFea.type, "fea-mesh");
  assert.ok(lastFea.geometry.positions.length > 0);
  assert.ok(lastFea.fields.vonMisesStress.length > 0);
  assert.ok(lastFea.stats.maxStress > 0);

  // Validate CFD payload
  const lastCfd = cfdFrames[cfdFrames.length - 1];
  assert.strictEqual(lastCfd.type, "cfd-mesh");
  assert.ok(lastCfd.geometry.positions.length > 0);
  assert.ok(lastCfd.fields.velocityMagnitude.length > 0);
  assert.ok(lastCfd.fields.pressure.length > 0);

  // Validate 2-way coupling physics
  assert.ok(vehicle.velocity > 1.0, "Velocity should increase under thrust");
  assert.ok(vehicle.deflection > 0, "Structural deflection must be fed back to 1D model");

  console.log("✔ Bidirectional 2-Way FSI co-simulation and streaming verified successfully!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
