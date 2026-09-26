// SPDX-License-Identifier: AGPL-3.0-or-later

import { DigitalThreadHypergraph, ThreadDomain } from "@modelscript/runtime";
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
  type PortCouplingBinding,
  type Vector3D,
  VectorAitkenRelaxation,
  WasmFeaAdapter,
  WebGpuLbmAdapter,
} from "../src/index.js";

describe("End-to-End Live Multiphysics Co-Simulation Integration (Phases 1-5)", () => {
  it("executes unified 1D-3D multiphysics co-simulation with formal verification, multi-fidelity surrogate ROM, and Aitken relaxation", async () => {
    // -------------------------------------------------------------
    // 1. Digital Thread Hypergraph & Port Coupler (Phase 2)
    // -------------------------------------------------------------
    const hypergraph = new DigitalThreadHypergraph(128);
    const portCoupler = new MultiphysicsPortCoupler({ hypergraph });

    // Register 1D-3D mechanical actuator flange binding
    const mechanicalBinding: PortCouplingBinding = {
      id: "wing-actuator-flange",
      oneDPortName: "motor.flange",
      continuumTagOrPatch: "thrust_flange",
      role: "mechanical_flange",
      axis: [0, 1, 0],
      digitalThreadIds: {
        threadId: 701,
        modelicaNodeId: 301,
        continuumNodeId: 401,
      },
    };
    portCoupler.registerBinding(mechanicalBinding);

    // Register 1D-3D fluid port binding
    const fluidBinding: PortCouplingBinding = {
      id: "intake-fluid-port",
      oneDPortName: "pump.port_b",
      continuumTagOrPatch: "inlet",
      role: "fluid_port",
      axis: [-1, 0, 0],
      areaM2: 0.04,
      fluidDensity: 1.225,
      digitalThreadIds: {
        threadId: 702,
        modelicaNodeId: 302,
        continuumNodeId: 402,
      },
    };
    portCoupler.registerBinding(fluidBinding);

    // Verify digital thread federation
    const cfdRadius = hypergraph.computeBlastRadius(ThreadDomain.CFD, 402);
    assert.ok(cfdRadius.impactedThreads.includes(702));

    // -------------------------------------------------------------
    // 2. High-Fidelity 3D Continuum Solvers (Phase 1)
    // -------------------------------------------------------------
    // FEA Cantilever Wing Spar (Tet4)
    const feaMesh = Tet4Mesher.createBoxMesh({
      width: 0.3,
      height: 0.03,
      depth: 0.02,
      nx: 6,
      ny: 2,
      nz: 2,
      faceTags: {
        minX: "wing_root",
        maxX: "thrust_flange",
      },
    });
    const feaParticipant = new WasmFeaAdapter(
      "wing-spar-fea",
      feaMesh,
      { E: 70e9, nu: 0.33, rho: 2700 },
      ["wing_root"],
      true, // Transient elastodynamics
    );

    // CFD Aerodynamic Domain (WebGPU LBM)
    const cfdConfig = {
      nx: 20,
      ny: 12,
      nz: 12,
      dx: 0.01,
      dt: 2e-4,
      tau: 0.6,
      density: 1.225,
      inletVelocity: [2.0, 0, 0] as Vector3D,
    };
    const cfdGrid = LbmVoxelizer.voxelize(cfdConfig, {
      cylinders: [{ center: [0.5, 0.5, 0.5], radius: 0.15, axis: "z", length: 1.0 }],
    });
    const highFidelityCfd = new WebGpuLbmAdapter("aero-lbm", cfdConfig, cfdGrid, ["obstacle", "inlet", "outlet"]);

    // -------------------------------------------------------------
    // 3. Multi-Fidelity Surrogate Acceleration Setup (Phase 3)
    // -------------------------------------------------------------
    const numCells = cfdConfig.nx * cfdConfig.ny * cfdConfig.nz;
    const snapshotCollector = new CfdSnapshotCollector(numCells);

    // Pre-seed snapshot dataset for POD training
    const speeds = [1.0, 2.5, 4.0, 5.5];
    for (let j = 0; j < speeds.length; j++) {
      const u = speeds[j]!;
      const field = new Float32Array(numCells).fill(u);
      snapshotCollector.record({ inletVelocity: u }, field, j * 0.01, {
        dragForce: 0.5 * 1.225 * u * u * 0.03,
        maxVelocity: u * 1.2,
      });
    }

    const podSurrogate = CaeSurrogateBridge.trainSurrogateFromSnapshots(snapshotCollector.toDataset(), {
      maxModes: 3,
      polynomialDegree: 2,
    });
    const surrogateParticipant = new CfdSurrogateParticipant(podSurrogate, {
      trainingDataset: snapshotCollector.toDataset(),
    });

    const transitions: string[] = [];
    const multiFidelityCfd = new MultiFidelityContinuumParticipant(highFidelityCfd, surrogateParticipant, {
      mode: "adaptive",
      confidenceThreshold: 0.85,
      enrichmentInterval: 15,
      snapshotCollector,
      onFidelityTransition: (from, to, reason) => {
        transitions.push(`${from}->${to}: ${reason}`);
      },
    });

    // -------------------------------------------------------------
    // 4. Multi-Rate Sub-Cycling & Vector Aitken Setup (Phase 4)
    // -------------------------------------------------------------
    const subCycleScheduler = new MultiRateSubCycleScheduler({
      macroDt: 0.01,
      cfdDt: 0.002, // 5 sub-steps per macro communication step
      feaDt: 0.005, // 2 sub-steps
      oneDDt: 0.01, // 1 sub-step
    });

    const vectorAitken = new VectorAitkenRelaxation({
      initialOmega: 0.5,
      minOmega: 0.05,
      maxOmega: 1.0,
      tolerance: 1e-4,
    });

    // -------------------------------------------------------------
    // 5. Live Multi-Physics Master Orchestrator Integration
    // -------------------------------------------------------------
    const orchestrator = new LiveCoSimOrchestrator({
      macroDt: 0.01,
      lbmSubSteps: 5,
      cfdProvider: multiFidelityCfd,
      feaProvider: feaParticipant,
      portCoupler,
      subCycleScheduler,
      system: {
        mass: 2.0,
        stiffness: 80.0,
        baseDamping: 3.0,
      },
      fsi: {
        enableAitkenRelaxation: true,
        vectorAitken,
      },
    });

    // -------------------------------------------------------------
    // 6. Execute Multi-Step Simulation Trajectory (Phases 1-5 validation)
    // -------------------------------------------------------------
    const history: {
      time: number;
      fidelity: "continuum" | "surrogate" | undefined;
      drag: number;
      compliance: number;
      conservative: boolean;
      omega?: number;
    }[] = [];

    // Step in-domain (forward speed in training range [1.0, 5.5] m/s)
    for (let step = 0; step < 10; step++) {
      const state = orchestrator.step({ thrust_flange: 25.0 });

      assert.ok(state.time > 0);
      assert.ok(state.velocity >= 0);
      assert.ok(state.structuralComplianceM >= 0);
      assert.ok(state.couplingVerification);
      assert.equal(state.couplingVerification.isConservative, true, "1D-3D interface must be conservative");

      history.push({
        time: state.time,
        fidelity: state.activeFidelity,
        drag: state.aerodynamicDragN,
        compliance: state.structuralComplianceM,
        conservative: state.couplingVerification.isConservative,
        omega: state.aitkenOmega,
      });
    }

    // Verify surrogate mode accelerated execution inside trust region
    const surrogateSteps = history.filter((h) => h.fidelity === "surrogate");
    assert.ok(surrogateSteps.length > 0, "Adaptive manager must utilize surrogate in trust region");

    // Accelerate vehicle past training envelope ([1.0, 5.5] m/s) to trigger continuum fallback
    let fallbackState;
    for (let i = 0; i < 15; i++) {
      fallbackState = orchestrator.step({ thrust_flange: 400.0 });
      if (fallbackState.activeFidelity === "continuum") break;
    }
    assert.equal(fallbackState?.activeFidelity, "continuum", "Must fall back to continuum solver on parameter drift");

    // Decelerate back into trained trust region
    let recoveryState;
    for (let i = 0; i < 30; i++) {
      recoveryState = orchestrator.step({ thrust_flange: -300.0 });
      if (recoveryState.activeFidelity === "surrogate") break;
    }
    assert.equal(recoveryState?.activeFidelity, "surrogate", "Must re-enter surrogate mode in trust region");

    // -------------------------------------------------------------
    // 7. Verify Asynchronous Remote Step Execution (Phase 1)
    // -------------------------------------------------------------
    const asyncState = await orchestrator.stepAsync({ thrust_flange: 25.0 });
    assert.ok(asyncState.time > 0.1);
    assert.ok(asyncState.couplingVerification?.isConservative);

    // Verify Telemetry and digital thread integrity
    assert.ok(transitions.length >= 2, "Transition log must capture excursion and recovery");
    assert.ok(vectorAitken.currentOmega > 0, "Aitken omega must remain valid");
  });
});
