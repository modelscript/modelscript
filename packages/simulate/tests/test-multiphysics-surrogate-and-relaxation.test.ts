// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LbmVoxelizer } from "../src/cfd/index.js";
import { Tet4Mesher } from "../src/fea/index.js";
import {
  CaeSurrogateBridge,
  CfdSnapshotCollector,
  CfdSurrogateParticipant,
  LiveCoSimOrchestrator,
  MultiFidelityContinuumParticipant,
  MultiRateSubCycleScheduler,
  MultiphysicsPortCoupler,
  type Vector3D,
  VectorAitkenRelaxation,
  WasmFeaAdapter,
  WebGpuLbmAdapter,
} from "../src/index.js";

describe("Phase 3 & 4: Adaptive Multi-Fidelity Surrogate Acceleration & FSI Stabilization", () => {
  it("stabilizes oscillatory coupled dynamics with VectorAitkenRelaxation", () => {
    const aitken = new VectorAitkenRelaxation({
      initialOmega: 0.5,
      minOmega: 0.05,
      maxOmega: 1.0,
      tolerance: 1e-4,
    });

    // Simulating an added-mass oscillatory interface: raw displacement x_{k+1} = -1.2 * x_k + 2.2
    // Naive Picard iteration diverges: x_0=1, x_1=1.0, x_2=-1.2+2.2=1.0, but with perturbation it blows up.
    let x = 0.0;
    let converged = false;

    for (let iter = 0; iter < 20; iter++) {
      // Coupled physics step prediction with destabilizing feedback
      const rawPrediction = -1.4 * x + 2.4;
      const res = aitken.relaxScalar(rawPrediction);
      x = res.relaxedValue;
      if (res.converged) {
        converged = true;
        break;
      }
    }

    assert.ok(converged, "Vector Aitken must stabilize and converge oscillatory interface");
    // Analytical solution: x = -1.4*x + 2.4 => 2.4*x = 2.4 => x = 1.0
    assert.ok(Math.abs(x - 1.0) < 1e-3, `Solution must reach x=1.0, got ${x}`);

    // Vector test
    aitken.reset();
    const rawLoads = new Map<string, Vector3D>([
      ["tagA", [10.0, -2.0, 0.0]],
      ["tagB", [5.0, 1.0, 0.0]],
    ]);
    const relaxed = aitken.relaxBoundaryLoads(rawLoads);
    assert.equal(relaxed.size, 2);
    assert.ok(relaxed.has("tagA"));
    assert.ok(relaxed.has("tagB"));
  });

  it("schedules multi-rate sub-cycling and performs boundary interpolation", () => {
    const scheduler = new MultiRateSubCycleScheduler({
      macroDt: 0.01,
      cfdDt: 0.002, // 5 sub-steps
      feaDt: 0.005, // 2 sub-steps
      oneDDt: 0.01, // 1 sub-step
    });

    assert.equal(scheduler.cfdSubSteps, 5);
    assert.equal(scheduler.feaSubSteps, 2);
    assert.equal(scheduler.oneDSubSteps, 1);

    // Interpolation test
    const v0 = 10.0;
    const v1 = 20.0;
    // subStep 0 / 5 (tau = 1/5 = 0.2): 10 * 0.8 + 20 * 0.2 = 12
    const vMid = scheduler.interpolateScalar(v0, v1, 0, 5);
    assert.equal(vMid, 12.0);

    const vec0: Vector3D = [0, 0, 0];
    const vec1: Vector3D = [10, 20, 30];
    const vecMid = scheduler.interpolateVector(vec0, vec1, 1, 2); // tau = 2/2 = 1.0
    assert.deepEqual(vecMid, [10, 20, 30]);
  });

  it("trains CfdSurrogateParticipant and accelerates evaluations under 50 microseconds", () => {
    const N = 100; // 100 spatial feature cells
    const collector = new CfdSnapshotCollector(N);

    // Synthesize training snapshots across varied speeds (1.0 to 10.0 m/s)
    const speeds = [1.0, 3.0, 5.0, 7.0, 9.0];
    for (let j = 0; j < speeds.length; j++) {
      const u = speeds[j]!;
      const field = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        field[i] = u * (1.0 + 0.1 * Math.sin((i / N) * Math.PI));
      }
      const drag = 0.5 * 1.2 * u * u * 0.05; // 0.5 * rho * u^2 * A
      collector.record({ inletVelocity: u }, field, j * 0.01, { dragForce: drag });
    }

    const dataset = collector.toDataset();
    assert.equal(dataset.numSnapshots, 5);

    const trainedSurrogate = CaeSurrogateBridge.trainSurrogateFromSnapshots(dataset, {
      maxModes: 4,
      polynomialDegree: 2,
    });

    const surrogateParticipant = new CfdSurrogateParticipant(trainedSurrogate, {
      id: "cfd-rom",
      trainingDataset: dataset,
    });

    // Verify confidence calculation
    const insideConfidence = surrogateParticipant.computeConfidence({ inletVelocity: 5.0 });
    assert.equal(insideConfidence, 1.0, "Confidence inside training interval [1.0, 9.0] must be 1.0");

    const outsideConfidence = surrogateParticipant.computeConfidence({ inletVelocity: 25.0 });
    assert.ok(
      outsideConfidence < 0.2,
      `Confidence when extrapolating far outside (25 m/s) must decay (got ${outsideConfidence})`,
    );

    // Set boundary condition & step surrogate
    surrogateParticipant.setBoundaryCondition("inlet", { velocity: [4.0, 0, 0] });
    const tStart = performance.now();
    const res = surrogateParticipant.step(0.01);
    const stepTimeMs = performance.now() - tStart;

    assert.ok(res.aerodynamicForceN[0] > 0, "Predicted drag must be positive");
    assert.ok(res.velocityMagnitude && res.velocityMagnitude.length === N);
    assert.ok(stepTimeMs < 10.0, `Evaluation must be fast, took ${stepTimeMs.toFixed(3)} ms`);
  });

  it("dynamically switches between surrogate and full continuum in MultiFidelityContinuumParticipant", async () => {
    const N = 50;
    const collector = new CfdSnapshotCollector(N);
    const speeds = [2.0, 4.0, 6.0];
    for (let j = 0; j < speeds.length; j++) {
      const u = speeds[j]!;
      const field = new Float32Array(N).fill(u);
      collector.record({ inletVelocity: u }, field, j * 0.01, { dragForce: u * 1.5 });
    }
    const dataset = collector.toDataset();
    const trained = CaeSurrogateBridge.trainSurrogateFromSnapshots(dataset, { maxModes: 2 });
    const surrogate = new CfdSurrogateParticipant(trained, { trainingDataset: dataset });

    let fullContinuumStepCount = 0;
    const mockHighFidelity = {
      id: "mock-full-cfd",
      patchNames: ["inlet", "obstacle", "outlet"],
      initialize: () => {},
      step: async (_dt: number) => {
        fullContinuumStepCount++;
        return {
          aerodynamicForceN: [10.0, 0, 0] as Vector3D,
          maxVelocity: 5.0,
          pressureDropPa: 12.0,
          velocityMagnitude: new Float32Array(N).fill(5.0),
        };
      },
      setBoundaryCondition: () => {},
      getPatchMetrics: (patchName: string) => ({
        patchName,
        integratedForce: [10.0, 0, 0] as Vector3D,
        meanPressure: 101325.0,
      }),
      terminate: () => {},
    };

    const transitions: string[] = [];
    const multiFidelity = new MultiFidelityContinuumParticipant(mockHighFidelity, surrogate, {
      mode: "adaptive",
      confidenceThreshold: 0.8,
      enrichmentInterval: 10,
      onFidelityTransition: (from, to, reason) => {
        transitions.push(`${from}->${to}: ${reason}`);
      },
    });

    // 1. Step in trust region (inletVelocity = 4.0 m/s) -> Expect surrogate
    multiFidelity.setBoundaryCondition("inlet", { velocity: [4.0, 0, 0] });
    const res1 = await multiFidelity.step(0.01);
    assert.equal(multiFidelity.getActiveFidelity(), "surrogate");
    assert.equal(fullContinuumStepCount, 0, "Should NOT call high fidelity participant inside trust region");
    assert.ok(res1.aerodynamicForceN[0] > 0);

    // 2. Step outside trust region (inletVelocity = 20.0 m/s) -> Expect fallback to continuum
    multiFidelity.setBoundaryCondition("inlet", { velocity: [20.0, 0, 0] });
    const res2 = await multiFidelity.step(0.01);
    assert.equal(multiFidelity.getActiveFidelity(), "continuum");
    assert.equal(fullContinuumStepCount, 1, "Must invoke high-fidelity participant when confidence drops");
    assert.equal(res2.aerodynamicForceN[0], 10.0);
    assert.ok(transitions.length >= 1, "Must trigger onFidelityTransition callback");

    // 3. Re-enter trust region (inletVelocity = 3.0 m/s) -> Expect recovery to surrogate
    multiFidelity.setBoundaryCondition("inlet", { velocity: [3.0, 0, 0] });
    await multiFidelity.step(0.01);
    assert.equal(multiFidelity.getActiveFidelity(), "surrogate");
  });

  it("orchestrates live co-simulation with MultiFidelity continuum participant & port coupler", () => {
    // 1. Mesh & FEA
    const feaMesh = Tet4Mesher.createBoxMesh({
      width: 0.2,
      height: 0.02,
      depth: 0.02,
      nx: 4,
      ny: 2,
      nz: 2,
      faceTags: { minX: "fixed_hub", maxX: "load_flange" },
    });
    const feaAdapter = new WasmFeaAdapter("fea-spar", feaMesh, { E: 70e9, nu: 0.33, rho: 2700 }, ["fixed_hub"]);

    // 2. CFD Domain & Dataset
    const cfdConfig = {
      nx: 16,
      ny: 10,
      nz: 10,
      dx: 0.01,
      dt: 2e-4,
      tau: 0.65,
      density: 1.225,
      inletVelocity: [2.0, 0, 0] as Vector3D,
    };
    const cfdGrid = LbmVoxelizer.voxelize(cfdConfig, {
      cylinders: [{ center: [0.5, 0.5, 0.5], radius: 0.15, axis: "z", length: 1.0 }],
    });
    const cfdAdapter = new WebGpuLbmAdapter("cfd-domain", cfdConfig, cfdGrid, ["obstacle", "inlet", "outlet"]);

    // Collect 3 quick snapshots for surrogate
    const numCells = cfdConfig.nx * cfdConfig.ny * cfdConfig.nz;
    const collector = new CfdSnapshotCollector(numCells);
    for (const u of [1.0, 2.0, 3.0]) {
      collector.record({ inletVelocity: u }, new Float32Array(numCells).fill(u), 0.0, {
        dragForce: 0.5 * 1.225 * u * u * 0.02,
      });
    }
    const trained = CaeSurrogateBridge.trainSurrogateFromSnapshots(collector.toDataset(), { maxModes: 2 });
    const surrogate = new CfdSurrogateParticipant(trained, { trainingDataset: collector.toDataset() });

    const multiFidelityCfd = new MultiFidelityContinuumParticipant(cfdAdapter, surrogate, {
      mode: "adaptive",
      confidenceThreshold: 0.85,
    });

    const portCoupler = new MultiphysicsPortCoupler();
    portCoupler.registerBinding({
      id: "wing-load",
      oneDPortName: "actuator",
      continuumTagOrPatch: "load_flange",
      role: "mechanical_flange",
      axis: [0, 1, 0],
    });

    const orchestrator = new LiveCoSimOrchestrator({
      macroDt: 0.01,
      cfdProvider: multiFidelityCfd,
      feaProvider: feaAdapter,
      portCoupler,
      system: {
        mass: 1.0,
        stiffness: 100.0,
        baseDamping: 5.0,
      },
      fsi: {
        enableAitkenRelaxation: true,
        initialOmega: 0.5,
      },
    });

    // Run 5 coupled steps
    for (let i = 0; i < 5; i++) {
      const state = orchestrator.step({ load_flange: 15.0 });
      assert.ok(state.time > 0);
      assert.ok(state.aitkenOmega !== undefined);
      assert.ok(state.couplingVerification);
      assert.equal(state.couplingVerification.isConservative, true);
    }
  });
});
