// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LbmVoxelizer } from "../src/cfd/index.js";
import {
  type CfdStepOutput,
  type ContinuumBoundaryCondition,
  type ContinuumPatchMetrics,
  type FeaStepOutput,
  type ICfdContinuumParticipant,
  type IFeaContinuumParticipant,
  LiveCoSimOrchestrator,
  type Vector3D,
  WasmFeaAdapter,
  WebGpuLbmAdapter,
} from "../src/core/index.js";
import { Tet4Mesher } from "../src/fea/index.js";

describe("Phase 1: Pluggable Continuum Participant Abstraction & Provider Unification", () => {
  it("orchestrates co-simulation with standard WebGpuLbmAdapter and WasmFeaAdapter providers", () => {
    // 1. FEA Mesh: Cantilever spar
    const feaMesh = Tet4Mesher.createBoxMesh({
      width: 0.2,
      height: 0.02,
      depth: 0.02,
      nx: 4,
      ny: 2,
      nz: 2,
      faceTags: {
        minX: "wing_root",
        maxX: "wing_tip",
      },
    });

    const feaAdapter = new WasmFeaAdapter(
      "fea-cantilever",
      feaMesh,
      { E: 70e9, nu: 0.33, rho: 2700 },
      ["wing_root"],
      true,
    );

    // 2. CFD LBM Adapter
    const cfdConfig = {
      nx: 16,
      ny: 10,
      nz: 10,
      dx: 0.01,
      dt: 2e-4,
      tau: 0.65,
      density: 1.225,
      inletVelocity: [3.0, 0, 0] as Vector3D,
    };

    const cfdGrid = LbmVoxelizer.voxelize(cfdConfig, {
      cylinders: [{ center: [0.5, 0.5, 0.5], radius: 0.15, axis: "z", length: 1.0 }],
    });

    const cfdAdapter = new WebGpuLbmAdapter("cfd-airfoil", cfdConfig, cfdGrid, ["obstacle", "inlet", "outlet"]);

    // 3. Orchestrator using pluggable providers
    const orchestrator = new LiveCoSimOrchestrator({
      macroDt: 0.01,
      lbmSubSteps: 2,
      cfdProvider: cfdAdapter,
      feaProvider: feaAdapter,
      system: {
        mass: 1.5,
        stiffness: 100.0,
        baseDamping: 5.0,
      },
    });

    assert.equal(orchestrator.cfdProvider.id, "cfd-airfoil");
    assert.equal(orchestrator.feaProvider.id, "fea-cantilever");

    // Perform synchronous co-simulation step
    const state = orchestrator.step(25.0); // 25 N thrust command
    assert.ok(state.time > 0);
    assert.ok(state.aerodynamicDragN >= 0);
    assert.ok(state.structuralComplianceM >= 0);

    // Verify patch metrics
    const obstacleMetrics = cfdAdapter.getPatchMetrics("obstacle");
    assert.ok(obstacleMetrics.integratedForce);
    assert.equal(obstacleMetrics.patchName, "obstacle");
  });

  it("orchestrates asynchronous co-simulation with custom continuum participants (SHM/Remote emulation)", async () => {
    // Custom mock CFD participant emulating an asynchronous remote or IPC socket daemon
    class MockAsyncCfdParticipant implements ICfdContinuumParticipant {
      public readonly id = "mock-remote-openfoam";
      public readonly patchNames = ["wing_surface", "inlet_boundary"];
      public stepCount = 0;
      public inletSpeed = 0;

      public async initialize(): Promise<void> {
        this.stepCount = 0;
      }

      public async step(macroDt: number): Promise<CfdStepOutput> {
        this.stepCount++;
        // Emulate ~1ms async IPC roundtrip
        await new Promise((resolve) => setTimeout(resolve, 1));
        const drag = 0.5 * 1.225 * this.inletSpeed * this.inletSpeed * 0.05;
        return {
          aerodynamicForceN: [drag, 0.2 * drag, 0],
          maxVelocity: this.inletSpeed * 1.2,
          pressureDropPa: 120.0,
        };
      }

      public setBoundaryCondition(patchName: string, bc: ContinuumBoundaryCondition): void {
        if (patchName === "inlet" && bc.velocity) {
          this.inletSpeed = bc.velocity[0];
        }
      }

      public getPatchMetrics(patchName: string): ContinuumPatchMetrics {
        return {
          patchName,
          integratedForce: [5.0, 0, 0],
          meanPressure: 101325.0,
        };
      }

      public async terminate(): Promise<void> {}
    }

    // Custom mock FEA participant emulating an asynchronous CalculiX solver
    class MockAsyncFeaParticipant implements IFeaContinuumParticipant {
      public readonly id = "mock-cloud-calculix";
      public readonly boundaryTags = ["support_root", "flange_load"];
      public currentDisp = 0.0;

      public async initialize(): Promise<void> {}

      public async step(boundaryLoads: Map<string, Vector3D>): Promise<FeaStepOutput> {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const loadY = boundaryLoads.get("flange_load")?.[1] ?? 10.0;
        this.currentDisp += loadY * 1e-6;

        return {
          displacements: new Float32Array([0, 0, 0, 0, this.currentDisp, 0]),
          elementVonMises: new Float32Array([1.5e6]),
          nodalVonMises: new Float32Array([1.5e6]),
          maxDisplacement: this.currentDisp,
          maxVonMisesStress: 1.5e6,
        };
      }

      public getNodeDisplacement(): Vector3D {
        return [0, this.currentDisp, 0];
      }

      public async terminate(): Promise<void> {}
    }

    const cfd = new MockAsyncCfdParticipant();
    const fea = new MockAsyncFeaParticipant();

    const orchestrator = new LiveCoSimOrchestrator({
      macroDt: 0.005,
      cfdProvider: cfd,
      feaProvider: fea,
      system: {
        mass: 2.0,
      },
    });

    // Step asynchronously (stepCount is 1 from constructor initialization)
    const state1 = await orchestrator.stepAsync({ flange_load: 50.0 });
    assert.equal(state1.time, 0.005);
    assert.equal(cfd.stepCount, 2);
    assert.ok(state1.appliedThrustN >= 50.0);
    assert.ok(state1.structuralComplianceM > 0);

    const state2 = await orchestrator.stepAsync({ flange_load: 50.0 });
    assert.equal(state2.time, 0.01);
    assert.equal(cfd.stepCount, 3);
    assert.ok(state2.structuralComplianceM > state1.structuralComplianceM);
  });
});
