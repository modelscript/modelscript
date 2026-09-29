// SPDX-License-Identifier: AGPL-3.0-or-later

import { DigitalThreadHypergraph, ThreadDomain } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LbmVoxelizer } from "../src/cfd/index.js";
import {
  LiveCoSimOrchestrator,
  MultiphysicsPortCoupler,
  type PortCouplingBinding,
  type Vector3D,
  WasmFeaAdapter,
  WebGpuLbmAdapter,
} from "../src/core/index.js";
import { Tet4Mesher } from "../src/fea/index.js";

describe("Phase 2: Formal Conjugated Port Coupling & Conservative 1D-3D Interface", () => {
  it("binds mechanical flange and fluid port with formal FlowAlgebraOracle verification", () => {
    const hypergraph = new DigitalThreadHypergraph(64);
    const coupler = new MultiphysicsPortCoupler({ hypergraph });

    // 1. Register a 1D-3D fluid port binding
    const fluidBinding: PortCouplingBinding = {
      id: "binding-hydraulic-inflow",
      oneDPortName: "pipe_inflow",
      continuumTagOrPatch: "inlet_boundary",
      role: "fluid_port",
      axis: [-1, 0, 0],
      areaM2: 0.05,
      fluidDensity: 1.225,
      digitalThreadIds: {
        threadId: 601,
        modelicaNodeId: 101, // e.g., pipe.port_a
        continuumNodeId: 201, // e.g., CFD inlet patch
      },
    };

    coupler.registerBinding(fluidBinding);
    assert.equal(coupler.getBindings().length, 1);

    // Verify digital thread slot binding and blast radius
    const radius = hypergraph.computeBlastRadius(ThreadDomain.CFD, 201);
    assert.equal(radius.impactedThreads.length, 1);
    assert.equal(radius.impactedThreads[0], 601);
    const hasModelicaNode = radius.impactedNodes.some((n) => n.domain === ThreadDomain.Modelica && n.nodeId === 101);
    assert.ok(hasModelicaNode, "Blast radius must trace across CFD patch to Modelica port");

    // 2. Mock CFD participant
    const mockCfd = {
      id: "cfd-mock",
      patchNames: ["inlet_boundary"],
      lastBc: undefined as any,
      initialize: () => {},
      step: () => ({
        aerodynamicForceN: [0, 0, 0] as Vector3D,
        maxVelocity: 10.0,
        pressureDropPa: 0.0,
      }),
      setBoundaryCondition(patchName: string, bc: any) {
        this.lastBc = bc;
      },
      getPatchMetrics(patchName: string) {
        return {
          patchName,
          integratedForce: [0, 0, 0] as Vector3D,
          meanPressure: 101325.0,
          integratedMassFlow: 0.6, // Inflow = 0.6 kg/s into 3D domain
        };
      },
      terminate: () => {},
    };

    // 3. Sync 1D to Continuum: Inflow 1D mass flow = -0.6 kg/s (leaving 1D component into CFD)
    coupler.sync1DToContinuum(
      {
        "pipe_inflow.m_flow": -0.6,
        "pipe_inflow.p": 101325.0,
      },
      mockCfd,
    );

    assert.ok(mockCfd.lastBc);
    assert.equal(mockCfd.lastBc.massFlow, -0.6);

    // 4. Sync Continuum to 1D and verify conservation
    const feedback = coupler.syncContinuumTo1D(mockCfd);
    assert.equal(feedback.get("pipe_inflow.p_feedback"), 101325.0);
    assert.equal(feedback.get("pipe_inflow.m_flow_feedback"), 0.6);

    // Mass balance: -0.6 + 0.6 = 0 kg/s (Conservative)
    const verification = coupler.verifyConservation();
    assert.equal(verification.isConservative, true, "Balanced interface must be certified conservative");
    assert.equal(verification.metrics.massFluxImbalanceKg_s, 0.0);
    assert.equal(verification.metrics.pressureDeltaPa, 0.0);

    // 5. Test Flux Imbalance Conflict Detection:
    // Suppose CFD boundary integral reports 0.95 kg/s (+0.35 kg/s mass creation)
    mockCfd.getPatchMetrics = () => ({
      patchName: "inlet_boundary",
      integratedForce: [0, 0, 0] as Vector3D,
      meanPressure: 101325.0,
      integratedMassFlow: 0.95,
    });
    coupler.syncContinuumTo1D(mockCfd);

    const conflictVerification = coupler.verifyConservation();
    assert.equal(conflictVerification.isConservative, false, "Mass flux imbalance must produce CONFLICT");
    assert.ok(conflictVerification.conflict);
    assert.ok(conflictVerification.conflict.explanation.includes("Spatial Boundary Mass Flux Imbalance"));
  });

  it("integrates MultiphysicsPortCoupler directly into LiveCoSimOrchestrator stepping loop", () => {
    // 1. FEA Cantilever Arm
    const feaMesh = Tet4Mesher.createBoxMesh({
      width: 0.25,
      height: 0.02,
      depth: 0.02,
      nx: 4,
      ny: 2,
      nz: 2,
      faceTags: {
        minX: "fixed_hub",
        maxX: "thrust_flange",
      },
    });
    const feaAdapter = new WasmFeaAdapter("fea-spar", feaMesh, { E: 70e9, nu: 0.33, rho: 2700 }, ["fixed_hub"]);

    // 2. CFD Domain
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

    // 3. Port Coupler
    const portCoupler = new MultiphysicsPortCoupler();
    portCoupler.registerBinding({
      id: "flange-coupling",
      oneDPortName: "motor_actuator",
      continuumTagOrPatch: "thrust_flange",
      role: "mechanical_flange",
      axis: [0, 1, 0],
    });

    const orchestrator = new LiveCoSimOrchestrator({
      macroDt: 0.01,
      lbmSubSteps: 2,
      cfdProvider: cfdAdapter,
      feaProvider: feaAdapter,
      portCoupler,
      system: {
        mass: 1.0,
        stiffness: 50.0,
        baseDamping: 2.0,
      },
    });

    // Step orchestrator
    const state = orchestrator.step({ thrust_flange: 20.0 });
    assert.ok(state.time > 0);
    assert.ok(state.couplingVerification);
    assert.equal(state.couplingVerification.isConservative, true);

    // Verify feedback was captured
    const feedback = portCoupler.syncContinuumTo1D(feaAdapter);
    assert.ok(feedback.has("motor_actuator.s"));
  });
});
