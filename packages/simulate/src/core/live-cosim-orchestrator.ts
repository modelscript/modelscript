import type { LbmGridConfig, LbmStepResult } from "../cfd/lbm-types.js";
import { WebGPULbmRunner } from "../cfd/webgpu-lbm-runner.js";
import { FeaSolver } from "../fea/fea-solver.js";
import type { FeaStepResult, MaterialProperties, Tet4Mesh } from "../fea/tet4-types.js";
import {
  type CfdStepOutput,
  type FeaStepOutput,
  type ICfdContinuumParticipant,
  type IFeaContinuumParticipant,
  type Vector3D,
  WasmFeaAdapter,
  WebGpuLbmAdapter,
} from "./continuum-participant.js";
import { MultiRateSubCycleScheduler, VectorAitkenRelaxation } from "./fsi-relaxation.js";
import type { ConservationVerificationResult, MultiphysicsPortCoupler } from "./multiphysics-port-coupler.js";
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
  /** FEA mesh and structural material properties (optional if feaProvider is supplied). */
  fea?: {
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
  /** CFD lattice configuration and obstacle occupancy mask (optional if cfdProvider is supplied). */
  cfd?: {
    config: LbmGridConfig;
    cellTypes: Uint8Array;
  };
  /** Pluggable CFD continuum participant (WebGPU, Native SHM OpenFOAM, HPC Slurm, or Surrogate ROM). */
  cfdProvider?: ICfdContinuumParticipant;
  /** Pluggable FEA continuum participant (in-WASM Tet4/Tet10, CalculiX, or Surrogate ROM). */
  feaProvider?: IFeaContinuumParticipant;
  /** Optional multi-physics port coupler for formal boundary flux verification and digital thread federation. */
  portCoupler?: MultiphysicsPortCoupler;
  /** 1D Modelica system parameters or compiled Modelica DAE model. */
  system: {
    mass?: number; // kg
    stiffness?: number; // N/m
    baseDamping?: number; // N*s/m
    modelica?: ModelicaSystemConfig;
  };
  /** Fluid-Structure Interaction dynamic stabilization. */
  fsi?: {
    /** Enable Aitken dynamic relaxation to prevent numerical added-mass instability (default: false). */
    enableAitkenRelaxation?: boolean;
    /** Initial relaxation factor omega_0 in (0, 1] (default: 0.5). */
    initialOmega?: number;
    /** Lower bound on relaxation factor (default: 0.05). */
    minOmega?: number;
    /** Upper bound on relaxation factor (default: 1.0). */
    maxOmega?: number;
    /** Vector mode for multi-degree-of-freedom boundary relaxation. */
    vectorMode?: boolean;
    /** Custom VectorAitkenRelaxation instance. */
    vectorAitken?: VectorAitkenRelaxation;
  };
  /** Multi-rate sub-cycling scheduler across CFD, FEA, and 1D DAE. */
  subCycleScheduler?: MultiRateSubCycleScheduler;
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
  feaResult: FeaStepResult | FeaStepOutput;
  cfdResult: LbmStepResult | CfdStepOutput;
  // Formal conservation verification result from FlowAlgebraOracle
  couplingVerification?: ConservationVerificationResult;
  // Modelica DAE state values
  modelicaValues?: Float64Array;
  // Aitken relaxation factor
  aitkenOmega?: number;
  // Multi-fidelity tracking
  activeFidelity?: "continuum" | "surrogate";
  surrogateConfidence?: number;
}

/**
 * Multi-Physics Co-Simulation Master.
 * Synchronizes 1D Modelica dynamic states with in-WASM 3D Tet4/Tet10 FEA
 * and WebGPU 3D LBM CFD in real time (30-60 FPS) with automatic name matching
 * and 2-way dynamic aeroelastic moving boundary coupling.
 */
export class LiveCoSimOrchestrator {
  public readonly config: LiveCoSimConfig;
  public readonly feaSolver?: FeaSolver;
  public readonly cfdRunner?: WebGPULbmRunner;
  public readonly feaProvider: IFeaContinuumParticipant;
  public readonly cfdProvider: ICfdContinuumParticipant;
  public readonly portCoupler?: MultiphysicsPortCoupler;
  public readonly vectorAitken?: VectorAitkenRelaxation;
  public readonly subCycleScheduler?: MultiRateSubCycleScheduler;

  private state: LiveCoSimState;
  private resolvedFixedTags: string[] = [];
  private resolvedLoadTags: string[] = [];
  private portMappings: ModelicaPortMapping[] = [];
  private prevStructuralDisplacement = 0.0;
  private currentStepIndex = 0;
  private aitkenOmega = 0.5;
  private prevResidual = 0.0;
  private relaxedDisplacement = 0.0;

  private modelicaValues?: Float64Array;
  private modelicaActuatorId?: number;
  private modelicaSensorId?: number;
  private modelicaStateIds: number[] = [];
  private modelicaDerivIds: number[] = [];

  constructor(config: LiveCoSimConfig) {
    this.config = config;
    this.portCoupler = config.portCoupler;

    // Initialize Vector Aitken Relaxation
    if (config.fsi?.vectorAitken) {
      this.vectorAitken = config.fsi.vectorAitken;
    } else if (config.fsi?.enableAitkenRelaxation) {
      this.vectorAitken = new VectorAitkenRelaxation({
        initialOmega: config.fsi.initialOmega,
        minOmega: config.fsi.minOmega,
        maxOmega: config.fsi.maxOmega,
      });
    }

    // Initialize Multi-Rate Sub-Cycling Scheduler
    if (config.subCycleScheduler) {
      this.subCycleScheduler = config.subCycleScheduler;
    } else if (config.lbmSubSteps) {
      this.subCycleScheduler = new MultiRateSubCycleScheduler({
        macroDt: config.macroDt,
        cfdDt: config.macroDt / config.lbmSubSteps,
      });
    }

    // 1. Initialize FEA Participant / Solver
    if (config.feaProvider) {
      this.feaProvider = config.feaProvider;
      if (this.feaProvider instanceof WasmFeaAdapter) {
        this.feaSolver = this.feaProvider.solver;
      }
    } else if (config.fea) {
      const wasmFea = new WasmFeaAdapter(
        "fea-embedded",
        config.fea.mesh,
        config.fea.material,
        config.fea.fixedTag ? [config.fea.fixedTag] : [],
        config.fea.transient ?? config.fea.material.rho !== undefined,
      );
      this.feaSolver = wasmFea.solver;
      this.feaProvider = wasmFea;
    } else {
      throw new Error("LiveCoSimConfig requires either 'fea' configuration or a 'feaProvider'.");
    }

    // 2. Initialize CFD Participant / Runner
    if (config.cfdProvider) {
      this.cfdProvider = config.cfdProvider;
      if (this.cfdProvider instanceof WebGpuLbmAdapter) {
        this.cfdRunner = this.cfdProvider.runner;
      }
    } else if (config.cfd) {
      const lbm = new WebGpuLbmAdapter("cfd-embedded", config.cfd.config, config.cfd.cellTypes);
      this.cfdRunner = lbm.runner;
      this.cfdProvider = lbm;
    } else {
      throw new Error("LiveCoSimConfig requires either 'cfd' configuration or a 'cfdProvider'.");
    }

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

    // Initial zero state
    let initialFea: FeaStepResult | FeaStepOutput;
    if (this.feaSolver && config.fea) {
      const fixedNodeSet = new Set<number>();
      for (const tag of this.resolvedFixedTags) {
        const nodes = config.fea.mesh.boundaryNodes.get(tag);
        if (nodes) {
          for (const n of nodes) fixedNodeSet.add(n);
        }
      }
      const isTransient = config.fea.transient ?? config.fea.material.rho !== undefined;
      const initialBcs = {
        fixedNodes: fixedNodeSet,
        nodalLoads: new Map(),
        transient: isTransient,
        dt: config.macroDt,
      };
      initialFea = this.feaSolver.step(initialBcs);
    } else {
      initialFea = this.feaProvider.step(new Map(), config.macroDt) as FeaStepOutput;
    }

    const initialCfd = (this.cfdRunner ? this.cfdRunner.step(1) : this.cfdProvider.step(config.macroDt, 1)) as
      | LbmStepResult
      | CfdStepOutput;

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
    const mesh = this.config.fea?.mesh ?? this.feaProvider.getMesh?.();
    const boundaryMap = mesh?.boundaryNodes;
    this.resolvedFixedTags = [];
    this.resolvedLoadTags = [];
    this.portMappings = [];

    if (boundaryMap && boundaryMap.size > 0) {
      for (const [tag, nodes] of boundaryMap.entries()) {
        const lower = tag.toLowerCase();

        // 1. Match Fixed Support
        if (
          (this.config.fea?.fixedTag && this.config.fea.fixedTag === tag) ||
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
          (this.config.fea?.loadTag && this.config.fea.loadTag === tag) ||
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
    } else {
      // Abstract tags from feaProvider
      for (const tag of this.feaProvider.boundaryTags) {
        const lower = tag.toLowerCase();
        if (lower.includes("fixed") || lower.includes("support")) {
          this.resolvedFixedTags.push(tag);
          this.portMappings.push({ portName: tag, matchedTag: tag, role: "fixed_support", nodeCount: 0 });
        } else {
          this.resolvedLoadTags.push(tag);
          this.portMappings.push({ portName: tag, matchedTag: tag, role: "mechanical_flange", nodeCount: 0 });
        }
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
    this.currentStepIndex++;
    const rawDisplacement = this.state.structuralComplianceM;
    let effectiveDisplacement = rawDisplacement;

    // Apply Aitken dynamic relaxation if enabled
    if (this.vectorAitken) {
      const rel = this.vectorAitken.relaxScalar(rawDisplacement);
      effectiveDisplacement = rel.relaxedValue;
      this.aitkenOmega = rel.omega;
    } else {
      const fsiConfig = this.config.fsi;
      if (fsiConfig?.enableAitkenRelaxation) {
        const minOmega = fsiConfig.minOmega ?? 0.05;
        const maxOmega = fsiConfig.maxOmega ?? 1.0;
        const residual = rawDisplacement - this.relaxedDisplacement;

        if (this.currentStepIndex > 1 && Math.abs(residual - this.prevResidual) > 1e-12) {
          const deltaR = residual - this.prevResidual;
          const newOmega = -this.aitkenOmega * (this.prevResidual / deltaR);
          this.aitkenOmega = Math.min(maxOmega, Math.max(minOmega, Math.abs(newOmega)));
        } else {
          this.aitkenOmega = fsiConfig.initialOmega ?? 0.5;
        }

        this.relaxedDisplacement = this.relaxedDisplacement + this.aitkenOmega * residual;
        this.prevResidual = residual;
        effectiveDisplacement = this.relaxedDisplacement;
      }
    }

    // Compute structural velocity from deformation
    const structVel = (effectiveDisplacement - this.prevStructuralDisplacement) / dt;
    this.prevStructuralDisplacement = effectiveDisplacement;

    const forwardSpeed = Math.max(0.1, Math.abs(this.state.velocity));

    // Impart structural surface velocity into CFD moving wall boundary
    if (this.cfdRunner) {
      this.cfdRunner.setMovingWallVelocity([0, structVel, 0]);
      if (this.config.cfd?.config) {
        this.config.cfd.config.inletVelocity = [forwardSpeed, 0, 0];
      }
    }
    this.cfdProvider.setBoundaryCondition("obstacle", { velocity: [0, structVel, 0] });
    this.cfdProvider.setBoundaryCondition("inlet", { velocity: [forwardSpeed, 0, 0] });

    const rawCfdRes = this.cfdRunner ? this.cfdRunner.step(lbmSubSteps) : this.cfdProvider.step(dt, lbmSubSteps);
    if (rawCfdRes instanceof Promise) {
      throw new Error(
        `cfdProvider '${this.cfdProvider.id}' returned a Promise in synchronous step(). Use orchestrator.stepAsync() for asynchronous/remote continuum participants.`,
      );
    }
    const cfdRes = rawCfdRes as LbmStepResult | CfdStepOutput;
    const aeroDrag = Math.abs(cfdRes.aerodynamicForceN[0]);

    // 2. 1D Dynamics Integration: Runge-Kutta / Symplectic Euler step
    // Net force = Thrust - Spring Force - Damping - Aero Drag
    const netForce = totalThrustN - stiffness * this.state.position - baseDamping * this.state.velocity - aeroDrag;
    const accel = netForce / mass;
    const newVel = this.state.velocity + accel * dt;
    const newPos = this.state.position + newVel * dt;

    // 3. FEA Step: Apply combined thrust & aerodynamic force
    let feaRes: FeaStepResult | FeaStepOutput;
    if (this.feaSolver && this.config.fea) {
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
      feaRes = this.feaSolver.step(
        {
          fixedNodes,
          nodalLoads,
          transient: isTransient,
          dt,
        },
        this.config.fea.tol,
        this.config.fea.maxIters,
      );
    } else {
      const boundaryLoads = new Map<string, Vector3D>();
      for (const tag of this.resolvedLoadTags) {
        const tagThrust = loadForces.get(tag) ?? 0.0;
        boundaryLoads.set(tag, [-aeroDrag, tagThrust, 0]);
      }
      feaRes = this.feaProvider.step(boundaryLoads, dt) as FeaStepOutput;
    }

    // 4. Verify conservation invariants across 1D-3D interfaces if portCoupler is active
    let couplingVerification: ConservationVerificationResult | undefined;
    if (this.portCoupler) {
      this.portCoupler.syncContinuumTo1D(this.cfdProvider);
      this.portCoupler.syncContinuumTo1D(this.feaProvider);
      couplingVerification = this.portCoupler.verifyConservation();
    }

    // 5. Package synchronized multi-physics state
    let activeFidelity: "continuum" | "surrogate" | undefined;
    let surrogateConfidence: number | undefined;
    if ("getActiveFidelity" in this.cfdProvider && typeof (this.cfdProvider as any).getActiveFidelity === "function") {
      activeFidelity = (this.cfdProvider as any).getActiveFidelity();
    }
    if ("getLastConfidence" in this.cfdProvider && typeof (this.cfdProvider as any).getLastConfidence === "function") {
      surrogateConfidence = (this.cfdProvider as any).getLastConfidence();
    }

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
      couplingVerification,
      modelicaValues: this.modelicaValues,
      aitkenOmega: this.aitkenOmega,
      activeFidelity,
      surrogateConfidence,
    };

    return this.state;
  }

  /**
   * Asynchronously advances the multi-physics system by one macro time step (macroDt).
   * Supports remote, IPC socket, and HPC batch participants.
   */
  public async stepAsync(thrustInput: number | Record<string, number> = 0.0): Promise<LiveCoSimState> {
    const dt = this.config.macroDt;
    const lbmSubSteps = this.config.lbmSubSteps ?? 5;
    const mass = this.config.system.mass ?? 1.0;
    const stiffness = this.config.system.stiffness ?? 0.0;
    const baseDamping = this.config.system.baseDamping ?? 0.0;
    const mConfig = this.config.system.modelica;

    let modelicaForce = 0.0;
    if (mConfig && this.modelicaValues && this.modelicaActuatorId !== undefined) {
      if (this.modelicaSensorId !== undefined) {
        this.modelicaValues[this.modelicaSensorId] = this.state.structuralComplianceM;
      }
      mConfig.simulator.step(dt, this.modelicaValues, this.modelicaStateIds, this.modelicaDerivIds, {
        solver: mConfig.solver === "euler" ? "euler" : "rk4",
      });
      modelicaForce = this.modelicaValues[this.modelicaActuatorId] ?? 0.0;
    }

    let totalThrustN = 0.0;
    const loadForces = new Map<string, number>();

    if (typeof thrustInput === "number") {
      totalThrustN = thrustInput + modelicaForce;
      for (const tag of this.resolvedLoadTags) {
        loadForces.set(tag, totalThrustN / Math.max(1, this.resolvedLoadTags.length));
      }
    } else {
      for (const [key, val] of Object.entries(thrustInput)) {
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

    this.currentStepIndex++;
    const rawDisplacement = this.state.structuralComplianceM;
    let effectiveDisplacement = rawDisplacement;

    // Apply Aitken dynamic relaxation if enabled
    if (this.vectorAitken) {
      const rel = this.vectorAitken.relaxScalar(rawDisplacement);
      effectiveDisplacement = rel.relaxedValue;
      this.aitkenOmega = rel.omega;
    } else {
      const fsiConfig = this.config.fsi;
      if (fsiConfig?.enableAitkenRelaxation) {
        const minOmega = fsiConfig.minOmega ?? 0.05;
        const maxOmega = fsiConfig.maxOmega ?? 1.0;
        const residual = rawDisplacement - this.relaxedDisplacement;

        if (this.currentStepIndex > 1 && Math.abs(residual - this.prevResidual) > 1e-12) {
          const deltaR = residual - this.prevResidual;
          const newOmega = -this.aitkenOmega * (this.prevResidual / deltaR);
          this.aitkenOmega = Math.min(maxOmega, Math.max(minOmega, Math.abs(newOmega)));
        } else {
          this.aitkenOmega = fsiConfig.initialOmega ?? 0.5;
        }

        this.relaxedDisplacement = this.relaxedDisplacement + this.aitkenOmega * residual;
        this.prevResidual = residual;
        effectiveDisplacement = this.relaxedDisplacement;
      }
    }

    const structVel = (effectiveDisplacement - this.prevStructuralDisplacement) / dt;
    this.prevStructuralDisplacement = effectiveDisplacement;

    const forwardSpeed = Math.max(0.1, Math.abs(this.state.velocity));
    if (this.cfdRunner) {
      this.cfdRunner.setMovingWallVelocity([0, structVel, 0]);
      if (this.config.cfd?.config) {
        this.config.cfd.config.inletVelocity = [forwardSpeed, 0, 0];
      }
    }
    this.cfdProvider.setBoundaryCondition("obstacle", { velocity: [0, structVel, 0] });
    this.cfdProvider.setBoundaryCondition("inlet", { velocity: [forwardSpeed, 0, 0] });

    const cfdRes = (await this.cfdProvider.step(dt, lbmSubSteps)) as CfdStepOutput;
    const aeroDrag = Math.abs(cfdRes.aerodynamicForceN[0]);

    const netForce = totalThrustN - stiffness * this.state.position - baseDamping * this.state.velocity - aeroDrag;
    const accel = netForce / mass;
    const newVel = this.state.velocity + accel * dt;
    const newPos = this.state.position + newVel * dt;

    const boundaryLoads = new Map<string, Vector3D>();
    for (const tag of this.resolvedLoadTags) {
      const tagThrust = loadForces.get(tag) ?? 0.0;
      boundaryLoads.set(tag, [-aeroDrag, tagThrust, 0]);
    }
    const feaRes = (await this.feaProvider.step(boundaryLoads, dt)) as FeaStepOutput;

    // 4. Verify conservation invariants across 1D-3D interfaces if portCoupler is active
    let couplingVerification: ConservationVerificationResult | undefined;
    if (this.portCoupler) {
      this.portCoupler.syncContinuumTo1D(this.cfdProvider);
      this.portCoupler.syncContinuumTo1D(this.feaProvider);
      couplingVerification = this.portCoupler.verifyConservation();
    }

    let activeFidelity: "continuum" | "surrogate" | undefined;
    let surrogateConfidence: number | undefined;
    if ("getActiveFidelity" in this.cfdProvider && typeof (this.cfdProvider as any).getActiveFidelity === "function") {
      activeFidelity = (this.cfdProvider as any).getActiveFidelity();
    }
    if ("getLastConfidence" in this.cfdProvider && typeof (this.cfdProvider as any).getLastConfidence === "function") {
      surrogateConfidence = (this.cfdProvider as any).getLastConfidence();
    }

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
      couplingVerification,
      modelicaValues: this.modelicaValues,
      aitkenOmega: this.aitkenOmega,
      activeFidelity,
      surrogateConfidence,
    };

    return this.state;
  }
}
