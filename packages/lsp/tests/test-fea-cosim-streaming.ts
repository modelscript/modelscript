// SPDX-License-Identifier: AGPL-3.0-or-later

import { CoSimSession, FeaCoSimParticipant, Orchestrator, type FeaMeshPayload } from "@modelscript/exchange/cosim";
import { Causality, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert";
import { Tet4Mesher } from "../src/fea/index.js";
import { ModelScriptParticipant } from "../src/handlers/modelscriptParticipant.js";

console.log("=== Testing: 1D Modelica Dynamic Simulation Synchronized to 3D FEA with LSP Streaming Payloads ===");

async function run() {
  await initBltWasm();

  // 1. Build a 1D Modelica dynamic DAE model representing ramp thrust: der(thrust) = 100.0
  const arena = new DAEBuilder();
  const vThrust = arena.addVariable("thrust", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  arena.setVarStartValue(vThrust, 0.0);

  const vSlope = arena.addVariable("slope", VarType.Real, Variability.Parameter, Causality.Local, 100.0);
  const slopeLit = arena.addRealLiteral(100.0);
  arena.setVarExpression(vSlope, slopeLit);

  // Equation: der(thrust) = slope
  const thrustExpr = arena.addNameExpr("thrust");
  const derThrust = arena.addDerExpr(thrustExpr);
  const slopeExpr = arena.addNameExpr("slope");
  arena.addEquation(EqKind.Simple, derThrust, slopeExpr);

  const modelicaParticipant = new ModelScriptParticipant("1d-thrust-system", "DroneThrustController", arena);

  // 2. Build 3D Quadratic Tet10 Structural Mesh with semantic boundary patches
  const mesh = Tet4Mesher.createBoxMesh({
    width: 0.2, // 200 mm beam
    height: 0.02, // 20 mm height
    depth: 0.02, // 20 mm depth
    nx: 8,
    ny: 2,
    nz: 2,
    order: "quadratic",
    faceTags: {
      minX: "fixed_root",
      maxX: "tip_actuator",
    },
  });

  const aluminum = {
    E: 70e9, // 70 GPa
    nu: 0.33,
    rho: 2700,
    yieldStrength: 270e6,
  };

  const feaParticipant = new FeaCoSimParticipant("3d-fea-arm", "FlexibleArmStructure", mesh, aluminum, {
    fixedTag: "fixed_root",
    loadTag: "tip_actuator",
    loadAxis: "y",
    tolerance: 1e-6,
    maxIterations: 200,
  });

  // 3. Setup Gauss-Seidel Co-Simulation Session
  const session = new CoSimSession("test-modelica-fea-session");
  session.experiment = {
    startTime: 0.0,
    stopTime: 0.1,
    stepSize: 0.01, // 10 ms communication step
    tolerance: 1e-4,
  };

  session.addParticipant(modelicaParticipant);
  session.addParticipant(feaParticipant);

  // Couple Modelica output 'thrust' -> FEA boundary condition input 'load.force'
  session.coupling.addCoupling({
    from: { participantId: "1d-thrust-system", variableName: "thrust" },
    to: { participantId: "3d-fea-arm", variableName: "load.force" },
  });

  const streamedPayloads: FeaMeshPayload[] = [];

  // 4. Orchestrate Co-Simulation and Stream LSP Payloads
  const orchestrator = new Orchestrator(session, null, {
    onStep: (stepResult) => {
      const payload = feaParticipant.getMeshPayload();
      streamedPayloads.push(payload);
    },
  });

  const t0 = performance.now();
  await orchestrator.run();
  const elapsedMs = performance.now() - t0;

  console.log(`Co-simulation completed in ${elapsedMs.toFixed(2)} ms (${streamedPayloads.length} steps).`);

  // 5. Assertions on the synchronized Multi-Physics result
  assert.strictEqual(streamedPayloads.length, 10, "Expected 10 communication steps");

  for (const frame of streamedPayloads) {
    assert.strictEqual(frame.type, "fea-mesh");
    assert.strictEqual(frame.participantId, "3d-fea-arm");
    assert.ok(frame.geometry.positions.length > 0, "Geometry positions must not be empty");
    assert.ok(frame.geometry.indices.length > 0, "Surface triangle indices must not be empty");
    assert.strictEqual(
      frame.fields.vonMisesStress.length,
      frame.geometry.positions.length / 3,
      "Von Mises stress must be defined per vertex",
    );
    assert.strictEqual(
      frame.fields.displacements.length,
      frame.geometry.positions.length,
      "Displacements must be 3-component per vertex",
    );
  }

  const initialFrame = streamedPayloads[0];
  const finalFrame = streamedPayloads[streamedPayloads.length - 1];

  console.log(
    `Step 0 (t=${initialFrame.time.toFixed(3)}s): maxDeflection = ${(initialFrame.stats.maxDisplacement * 1000).toFixed(4)} mm, maxStress = ${(initialFrame.stats.maxStress / 1e6).toFixed(2)} MPa`,
  );
  console.log(
    `Step 9 (t=${finalFrame.time.toFixed(3)}s): maxDeflection = ${(finalFrame.stats.maxDisplacement * 1000).toFixed(4)} mm, maxStress = ${(finalFrame.stats.maxStress / 1e6).toFixed(2)} MPa`,
  );

  // Thrust increases over time from 0 to 10 N -> deflection and stress must increase monotonically
  assert.ok(
    finalFrame.stats.maxDisplacement > initialFrame.stats.maxDisplacement,
    "Final displacement must exceed initial displacement as thrust ramps up",
  );
  assert.ok(
    finalFrame.stats.maxStress > initialFrame.stats.maxStress,
    "Final Von Mises stress must exceed initial stress as thrust ramps up",
  );

  // Surface triangles check: indices must be multiples of 3
  assert.strictEqual(finalFrame.geometry.indices.length % 3, 0, "Surface indices must form complete triangles");

  console.log("✔ Modelica-to-FEA co-simulation and LSP mesh streaming verified successfully!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
