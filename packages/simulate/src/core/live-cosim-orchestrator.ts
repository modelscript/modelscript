// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LbmGridConfig, LbmStepResult } from "../cfd/lbm-types.js";
import { WebGPULbmRunner } from "../cfd/webgpu-lbm-runner.js";
import { FeaSolver } from "../fea/fea-solver.js";
import type { FeaStepResult, MaterialProperties, Tet4Mesh } from "../fea/tet4-types.js";

export interface LiveCoSimConfig {
  /** 1D simulation time step in seconds (e.g., 0.005s = 5ms). */
  macroDt: number;
  /** Number of sub-cycled LBM iterations per macro-step (default: 5). */
  lbmSubSteps?: number;
  /** FEA mesh and structural material properties. */
  fea: {
    mesh: Tet4Mesh;
    material: MaterialProperties;
    /** Boundary tag name for fixed Dirichlet support (e.g., "fixed_support"). */
    fixedTag: string;
    /** Boundary tag name where motor thrust/flange load is applied (e.g., "tip_load"). */
    loadTag: string;
  };
  /** CFD lattice configuration and obstacle occupancy mask. */
  cfd: {
    config: LbmGridConfig;
    cellTypes: Uint8Array;
  };
  /** 1D Modelica system parameters (e.g. mass, damping, spring stiffness). */
  system: {
    mass: number; // kg
    stiffness: number; // N/m
    baseDamping: number; // N*s/m
  };
}

export interface LiveCoSimState {
  time: number;
  // 1D System states (e.g. drone altitude / position and velocity)
  position: number;
  velocity: number;
  acceleration: number;
  // Dynamic coupling variables
  appliedThrustN: number;
  aerodynamicDragN: number;
  structuralComplianceM: number;
  // 3D Field outputs
  feaResult: FeaStepResult;
  cfdResult: LbmStepResult;
}

/**
 * Multi-Physics Co-Simulation Master.
 * Synchronizes 1D Modelica dynamic states with in-WASM 3D Tet4 FEA
 * and WebGPU 3D LBM CFD in real time (30-60 FPS).
 */
export class LiveCoSimOrchestrator {
  public readonly config: LiveCoSimConfig;
  public readonly feaSolver: FeaSolver;
  public readonly cfdRunner: WebGPULbmRunner;

  private state: LiveCoSimState;

  constructor(config: LiveCoSimConfig) {
    this.config = config;
    this.feaSolver = new FeaSolver(config.fea.mesh, config.fea.material);
    this.cfdRunner = new WebGPULbmRunner(config.cfd.config, config.cfd.cellTypes);

    // Initial zero state
    const initialBcs = {
      fixedNodes: new Set(config.fea.mesh.boundaryNodes.get(config.fea.fixedTag) ?? []),
      nodalLoads: new Map(),
    };
    const initialFea = this.feaSolver.step(initialBcs);
    const initialCfd = this.cfdRunner.step(1);

    this.state = {
      time: 0.0,
      position: 0.0,
      velocity: 0.0,
      acceleration: 0.0,
      appliedThrustN: 0.0,
      aerodynamicDragN: 0.0,
      structuralComplianceM: 0.0,
      feaResult: initialFea,
      cfdResult: initialCfd,
    };
  }

  public getState(): LiveCoSimState {
    return this.state;
  }

  /**
   * Advances the multi-physics system by one macro time step (macroDt).
   *
   * @param thrustCommandN Motor thrust force commanded by Modelica controller.
   */
  public step(thrustCommandN: number): LiveCoSimState {
    const dt = this.config.macroDt;
    const lbmSubSteps = this.config.lbmSubSteps ?? 5;
    const { mass, stiffness, baseDamping } = this.config.system;

    // 1. CFD Step: Update inlet velocity based on current body velocity and run sub-steps
    const forwardSpeed = Math.max(0.1, Math.abs(this.state.velocity));
    this.config.cfd.config.inletVelocity = [forwardSpeed, 0, 0];
    const cfdRes = this.cfdRunner.step(lbmSubSteps);
    const aeroDrag = Math.abs(cfdRes.aerodynamicForceN[0]);

    // 2. 1D Dynamics Integration: Runge-Kutta / Symplectic Euler step
    // Net force = Thrust - Spring Force - Damping - Aero Drag
    const netForce = thrustCommandN - stiffness * this.state.position - baseDamping * this.state.velocity - aeroDrag;
    const accel = netForce / mass;
    const newVel = this.state.velocity + accel * dt;
    const newPos = this.state.position + newVel * dt;

    // 3. FEA Step: Apply combined thrust & aerodynamic force to tagged boundary nodes
    const fixedNodes = new Set(this.config.fea.mesh.boundaryNodes.get(this.config.fea.fixedTag) ?? []);
    const loadNodes = this.config.fea.mesh.boundaryNodes.get(this.config.fea.loadTag) ?? [];

    const nodalLoads = new Map<number, [number, number, number]>();
    const numLoadNodes = Math.max(1, loadNodes.length);
    const forcePerNodeY = thrustCommandN / numLoadNodes;
    const dragPerNodeX = -aeroDrag / numLoadNodes;

    for (const node of loadNodes) {
      nodalLoads.set(node, [dragPerNodeX, forcePerNodeY, 0]);
    }

    const feaRes = this.feaSolver.step({ fixedNodes, nodalLoads });

    // 4. Package synchronized state
    this.state = {
      time: this.state.time + dt,
      position: newPos,
      velocity: newVel,
      acceleration: accel,
      appliedThrustN: thrustCommandN,
      aerodynamicDragN: aeroDrag,
      structuralComplianceM: feaRes.maxDisplacement,
      feaResult: feaRes,
      cfdResult: cfdRes,
    };

    return this.state;
  }
}
