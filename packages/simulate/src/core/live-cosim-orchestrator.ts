// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LbmGridConfig, LbmStepResult } from "../cfd/lbm-types.js";
import { WebGPULbmRunner } from "../cfd/webgpu-lbm-runner.js";
import { FeaSolver } from "../fea/fea-solver.js";
import type { FeaStepResult, MaterialProperties, Tet4Mesh } from "../fea/tet4-types.js";
import { ArenaSimulator, initializeArenaEnvironment } from "./simulate-arena.js";

export interface ModelicaPortMapping {
  portName: string;
  matchedTag: string;
  role: "fixed_support" | "mechanical_flange" | "fluid_inlet" | "fluid_outlet" | "aerodynamic_surface";
  nodeCount: number;
}

export interface ModelicaSystemConfig {
  /** Compiled Modelica DAE simulator instance. */
  simulator: ArenaSimulator;
  /** Variable name in Modelica model providing actuator thrust/force (e.g. "motor.flange.f"). */
  actuatorVar: string;
  /** Variable name in Modelica model receiving displacement/velocity sensor feedback (e.g. "motor.flange.s"). */
  sensorVar?: string;
  /** Optional simulation environment array. */
  values?: Float64Array;
  /** State variable name IDs. */
  stateStringIds?: number[];
  /** Derivative variable name IDs. */
  derivStringIds?: number[];
  /** ODE solver algorithm (default: 'rk4'). */
  solver?: "euler" | "rk4" | "dopri5" | "bdf";
}

export interface LiveCoSimConfig {
  /** 1D simulation time step in seconds (e.g., 0.005s = 5ms). */
  macroDt: number;
  /** Number of sub-cycled LBM iterations per macro-step (default: 5). */
  lbmSubSteps?: number;
  /** FEA mesh and structural material properties. */
  fea: {
    mesh: Tet4Mesh;
    material: MaterialProperties;
    /** Optional boundary tag name for fixed Dirichlet support. If omitted, automatically matched from CAD tags. */
    fixedTag?: string;
    /** Optional boundary tag name where motor thrust/flange load is applied. If omitted, automatically matched from CAD tags. */
    loadTag?: string;
    /** PCG convergence tolerance (default 1e-6). */
    tol?: number;
    /** PCG maximum iterations (default 500). */
    maxIters?: number;
    /** Enable transient dynamic elastodynamics via Newmark-beta integration. */
    transient?: boolean;
  };
  /** CFD lattice configuration and obstacle occupancy mask. */
  cfd: {
    config: LbmGridConfig;
    cellTypes: Uint8Array;
  };
  /** 1D Modelica system parameters or compiled Modelica DAE model. */
  system: {
    mass?: number; // kg
    stiffness?: number; // N/m
    baseDamping?: number; // N*s/m
    modelica?: ModelicaSystemConfig;
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
  structuralVelocityM_s: number;
  // Automatic name matching introspection
  activePortMappings: readonly ModelicaPortMapping[];
  // 3D Field outputs
  feaResult: FeaStepResult;
  cfdResult: LbmStepResult;
  // Modelica DAE state values
  modelicaValues?: Float64Array;
}

/**
 * Multi-Physics Co-Simulation Master.
 * Synchronizes 1D Modelica dynamic states with in-WASM 3D Tet4/Tet10 FEA
 * and WebGPU 3D LBM CFD in real time (30-60 FPS) with automatic name matching
 * and 2-way dynamic aeroelastic moving boundary coupling.
 */
export class LiveCoSimOrchestrator {
  public readonly config: LiveCoSimConfig;
  public readonly feaSolver: FeaSolver;
  public readonly cfdRunner: WebGPULbmRunner;

  private state: LiveCoSimState;
  private resolvedFixedTags: string[] = [];
  private resolvedLoadTags: string[] = [];
  private portMappings: ModelicaPortMapping[] = [];
  private prevStructuralDisplacement = 0.0;

  private modelicaValues?: Float64Array;
  private modelicaActuatorId?: number;
  private modelicaSensorId?: number;
  private modelicaStateIds: number[] = [];
  private modelicaDerivIds: number[] = [];

  constructor(config: LiveCoSimConfig) {
    this.config = config;
    this.feaSolver = new FeaSolver(config.fea.mesh, config.fea.material);
    this.cfdRunner = new WebGPULbmRunner(config.cfd.config, config.cfd.cellTypes);

    if (this.config.system.modelica) {
      const mConfig = this.config.system.modelica;
      if (mConfig.simulator.sortedEquations.length === 0) {
        mConfig.simulator.prepare();
      }
      if (mConfig.values && mConfig.stateStringIds && mConfig.derivStringIds) {
        this.modelicaValues = mConfig.values;
        this.modelicaStateIds = mConfig.stateStringIds;
        this.modelicaDerivIds = mConfig.derivStringIds;
      } else {
        const init = initializeArenaEnvironment(mConfig.simulator.arena, mConfig.simulator);
        this.modelicaValues = mConfig.values ?? init.valuesByStringId;
        this.modelicaStateIds = mConfig.stateStringIds ?? init.stateStringIds;
        this.modelicaDerivIds = mConfig.derivStringIds ?? init.derivStringIds;
      }
      this.modelicaActuatorId = mConfig.simulator.arena.interner.intern(mConfig.actuatorVar);
      if (mConfig.sensorVar) {
        this.modelicaSensorId = mConfig.simulator.arena.interner.intern(mConfig.sensorVar);
      }
    }

    this.autoMatchPorts();

    // Collect all fixed nodes across all matched fixed tags
    const fixedNodeSet = new Set<number>();
    for (const tag of this.resolvedFixedTags) {
      const nodes = config.fea.mesh.boundaryNodes.get(tag);
      if (nodes) {
        for (const n of nodes) fixedNodeSet.add(n);
      }
    }

    // Initial zero state
    const isTransient = config.fea.transient ?? config.fea.material.rho !== undefined;
    const initialBcs = {
      fixedNodes: fixedNodeSet,
      nodalLoads: new Map(),
      transient: isTransient,
      dt: config.macroDt,
    };
    const initialFea = this.feaSolver.step(initialBcs);
    const initialCfd = this.cfdRunner.step(1);

    const initialThrust =
      this.modelicaValues && this.modelicaActuatorId !== undefined
        ? (this.modelicaValues[this.modelicaActuatorId] ?? 0.0)
        : 0.0;

    this.state = {
      time: 0.0,
      position: 0.0,
      velocity: 0.0,
      acceleration: 0.0,
      appliedThrustN: initialThrust,
      aerodynamicDragN: 0.0,
      structuralComplianceM: 0.0,
      structuralVelocityM_s: 0.0,
      activePortMappings: this.portMappings,
      feaResult: initialFea,
      cfdResult: initialCfd,
      modelicaValues: this.modelicaValues,
    };
  }

  /**
   * Automatically introspects CAD boundary patch tags and matches them
   * with Modelica structural supports and actuator flanges.
   */
  private autoMatchPorts(): void {
    const boundaryMap = this.config.fea.mesh.boundaryNodes;
    this.resolvedFixedTags = [];
    this.resolvedLoadTags = [];
    this.portMappings = [];

    for (const [tag, nodes] of boundaryMap.entries()) {
      const lower = tag.toLowerCase();

      // 1. Match Fixed Support
      if (
        (this.config.fea.fixedTag && this.config.fea.fixedTag === tag) ||
        lower.includes("fixed") ||
        lower.includes("support") ||
        lower.includes("hub") ||
        lower.includes("root") ||
        lower.includes("ground")
      ) {
        this.resolvedFixedTags.push(tag);
        this.portMappings.push({
          portName: tag,
          matchedTag: tag,
          role: "fixed_support",
          nodeCount: nodes.length,
        });
        continue;
      }

      // 2. Match Actuator / Flange Load
      const isModelicaActuator =
        this.config.system.modelica &&
        (this.config.system.modelica.actuatorVar === tag ||
          this.config.system.modelica.actuatorVar.toLowerCase().includes(lower) ||
          lower.includes(this.config.system.modelica.actuatorVar.toLowerCase()));

      if (
        isModelicaActuator ||
        (this.config.fea.loadTag && this.config.fea.loadTag === tag) ||
        lower.includes("motor") ||
        lower.includes("flange") ||
        lower.includes("thrust") ||
        lower.includes("load") ||
        lower.includes("tip")
      ) {
        this.resolvedLoadTags.push(tag);
        this.portMappings.push({
          portName: this.config.system.modelica?.actuatorVar ?? tag,
          matchedTag: tag,
          role: "mechanical_flange",
          nodeCount: nodes.length,
        });
        continue;
      }

      // Default unrecognized port
      this.portMappings.push({
        portName: tag,
        matchedTag: tag,
        role: "aerodynamic_surface",
        nodeCount: nodes.length,
      });
    }

    // Fallbacks if no explicit pattern matched
    if (this.resolvedFixedTags.length === 0 && boundaryMap.size > 0) {
      const firstTag = boundaryMap.keys().next().value;
      if (firstTag) {
        this.resolvedFixedTags.push(firstTag);
      }
    }
    if (this.resolvedLoadTags.length === 0 && boundaryMap.size > 1) {
      const tags = Array.from(boundaryMap.keys());
      const secondTag = tags.find((t) => !this.resolvedFixedTags.includes(t));
      if (secondTag) {
        this.resolvedLoadTags.push(secondTag);
      }
    }
  }

  public getState(): LiveCoSimState {
    return this.state;
  }

  public getPortMappings(): readonly ModelicaPortMapping[] {
    return this.portMappings;
  }

  /**
   * Advances the multi-physics system by one macro time step (macroDt).
   *
   * @param thrustInput Motor thrust command (either scalar N or map of tag -> N).
   */
  public step(thrustInput: number | Record<string, number> = 0.0): LiveCoSimState {
    const dt = this.config.macroDt;
    const lbmSubSteps = this.config.lbmSubSteps ?? 5;
    const mass = this.config.system.mass ?? 1.0;
    const stiffness = this.config.system.stiffness ?? 0.0;
    const baseDamping = this.config.system.baseDamping ?? 0.0;
    const mConfig = this.config.system.modelica;

    // 0. Modelica DAE Step & Actuator Resolution
    let modelicaForce = 0.0;
    if (mConfig && this.modelicaValues && this.modelicaActuatorId !== undefined) {
      // Feedback: inject structural compliance / displacement into sensor variable
      if (this.modelicaSensorId !== undefined) {
        this.modelicaValues[this.modelicaSensorId] = this.state.structuralComplianceM;
      }

      // Step Modelica continuous dynamic states
      mConfig.simulator.step(dt, this.modelicaValues, this.modelicaStateIds, this.modelicaDerivIds, {
        solver: mConfig.solver === "euler" ? "euler" : "rk4",
      });

      modelicaForce = this.modelicaValues[this.modelicaActuatorId] ?? 0.0;
    }

    // Resolve thrust command per load tag
    let totalThrustN = 0.0;
    const loadForces = new Map<string, number>();

    if (typeof thrustInput === "number") {
      totalThrustN = thrustInput + modelicaForce;
      for (const tag of this.resolvedLoadTags) {
        loadForces.set(tag, totalThrustN / Math.max(1, this.resolvedLoadTags.length));
      }
    } else {
      for (const [key, val] of Object.entries(thrustInput)) {
        // Find matching tag (exact or lowercase substring match)
        const matched = this.resolvedLoadTags.find((t) => t === key || t.toLowerCase().includes(key.toLowerCase()));
        if (matched) {
          loadForces.set(matched, (loadForces.get(matched) ?? 0) + val);
          totalThrustN += val;
        }
      }
      totalThrustN += modelicaForce;
      if (modelicaForce !== 0) {
        const forcePerTag = modelicaForce / Math.max(1, this.resolvedLoadTags.length);
        for (const tag of this.resolvedLoadTags) {
          loadForces.set(tag, (loadForces.get(tag) ?? 0) + forcePerTag);
        }
      }
    }

    // 1. CFD Step: Dynamic Aeroelastic coupling
    // Compute structural velocity from previous deformation
    const structVel = (this.state.structuralComplianceM - this.prevStructuralDisplacement) / dt;
    this.prevStructuralDisplacement = this.state.structuralComplianceM;

    // Impart structural surface velocity into LBM moving wall boundary
    this.cfdRunner.setMovingWallVelocity([0, structVel, 0]);

    const forwardSpeed = Math.max(0.1, Math.abs(this.state.velocity));
    this.config.cfd.config.inletVelocity = [forwardSpeed, 0, 0];
    const cfdRes = this.cfdRunner.step(lbmSubSteps);
    const aeroDrag = Math.abs(cfdRes.aerodynamicForceN[0]);

    // 2. 1D Dynamics Integration: Runge-Kutta / Symplectic Euler step
    // Net force = Thrust - Spring Force - Damping - Aero Drag
    const netForce = totalThrustN - stiffness * this.state.position - baseDamping * this.state.velocity - aeroDrag;
    const accel = netForce / mass;
    const newVel = this.state.velocity + accel * dt;
    const newPos = this.state.position + newVel * dt;

    // 3. FEA Step: Apply combined thrust & aerodynamic force to automatically matched boundary nodes
    const fixedNodes = new Set<number>();
    for (const tag of this.resolvedFixedTags) {
      const nodes = this.config.fea.mesh.boundaryNodes.get(tag);
      if (nodes) {
        for (const n of nodes) fixedNodes.add(n);
      }
    }

    const nodalLoads = new Map<number, [number, number, number]>();

    for (const tag of this.resolvedLoadTags) {
      const loadNodes = this.config.fea.mesh.boundaryNodes.get(tag) ?? [];
      const numNodes = Math.max(1, loadNodes.length);
      const tagThrust = loadForces.get(tag) ?? 0.0;
      const forcePerNodeY = tagThrust / numNodes;
      const dragPerNodeX = -aeroDrag / numNodes;

      for (const node of loadNodes) {
        nodalLoads.set(node, [dragPerNodeX, forcePerNodeY, 0]);
      }
    }

    const isTransient = this.config.fea.transient ?? this.config.fea.material.rho !== undefined;
    const feaRes = this.feaSolver.step(
      {
        fixedNodes,
        nodalLoads,
        transient: isTransient,
        dt,
      },
      this.config.fea.tol,
      this.config.fea.maxIters,
    );

    // 4. Package synchronized multi-physics state
    this.state = {
      time: this.state.time + dt,
      position: newPos,
      velocity: newVel,
      acceleration: accel,
      appliedThrustN: totalThrustN,
      aerodynamicDragN: aeroDrag,
      structuralComplianceM: feaRes.maxDisplacement,
      structuralVelocityM_s: structVel,
      activePortMappings: this.portMappings,
      feaResult: feaRes,
      cfdResult: cfdRes,
      modelicaValues: this.modelicaValues,
    };

    return this.state;
  }
}
