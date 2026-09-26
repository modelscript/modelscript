// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  CfdStepOutput,
  ContinuumBoundaryCondition,
  ContinuumPatchMetrics,
  ICfdContinuumParticipant,
  Vector3D,
} from "../core/continuum-participant.js";
import type { TrainedCaeSurrogate } from "./cae-surrogate-bridge.js";
import { CfdPodSurrogate, type PodSurrogatePrediction } from "./cfd-pod-surrogate.js";
import type { CfdSnapshotCollector, SnapshotMatrixDataset } from "./cfd-snapshot-collector.js";

export interface ParameterRange {
  min: number;
  max: number;
  mean: number;
  std: number;
}

export interface CfdSurrogateParticipantConfig {
  id?: string;
  patchNames?: string[];
  /** Optional parameter extractor from boundary conditions map. */
  parameterExtractor?: (
    boundaryConditions: Map<string, ContinuumBoundaryCondition>,
    time: number,
  ) => Record<string, number>;
  /** Optional scalar outputs mapper to Vector3D force. */
  scalarOutputsMapper?: (scalarOutputs: Record<string, number>) => {
    aerodynamicForceN: Vector3D;
    maxVelocity?: number;
    pressureDropPa?: number;
  };
  /** Training dataset for parameter bounding and confidence evaluation. */
  trainingDataset?: SnapshotMatrixDataset;
}

/**
 * High-Performance POD-Galerkin ROM Continuum Participant.
 *
 * Implements ICfdContinuumParticipant backed by CfdPodSurrogate or TrainedCaeSurrogate.
 * Executes full 3D spatial field reconstruction and scalar force prediction in < 50 microseconds.
 */
export class CfdSurrogateParticipant implements ICfdContinuumParticipant {
  public readonly id: string;
  public readonly patchNames: readonly string[];
  public readonly surrogate: CfdPodSurrogate | TrainedCaeSurrogate;
  private readonly config: CfdSurrogateParticipantConfig;

  private boundaryConditions: Map<string, ContinuumBoundaryCondition> = new Map();
  private currentTime: number = 0.0;
  private parameterRanges: Map<string, ParameterRange> = new Map();
  private lastPrediction?: PodSurrogatePrediction;
  private lastOutput?: CfdStepOutput;
  private patchMetricsCache: Map<string, ContinuumPatchMetrics> = new Map();

  constructor(surrogate: CfdPodSurrogate | TrainedCaeSurrogate, config: CfdSurrogateParticipantConfig = {}) {
    this.surrogate = surrogate;
    this.config = config;
    this.id = config.id ?? "cfd-surrogate-pod";
    this.patchNames = config.patchNames ?? ["obstacle", "inlet", "outlet"];

    // Initialize parameter ranges from training dataset if available
    if (config.trainingDataset) {
      this.computeParameterRanges(config.trainingDataset);
    }
  }

  private computeParameterRanges(ds: SnapshotMatrixDataset): void {
    const P = ds.parameterNames.length;
    const M = ds.numSnapshots;

    for (let p = 0; p < P; p++) {
      const name = ds.parameterNames[p]!;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0.0;

      for (let j = 0; j < M; j++) {
        const val = ds.parameters[j * P + p]!;
        if (val < min) min = val;
        if (val > max) max = val;
        sum += val;
      }

      const mean = sum / Math.max(1, M);
      let sumVar = 0.0;
      for (let j = 0; j < M; j++) {
        const val = ds.parameters[j * P + p]!;
        sumVar += (val - mean) ** 2;
      }
      const std = Math.sqrt(sumVar / Math.max(1, M)) || 1.0;

      this.parameterRanges.set(name, { min, max, mean, std });
    }
  }

  public initialize(startTime: number, _stopTime: number, _dt: number): void {
    this.currentTime = startTime;
  }

  public setBoundaryCondition(patchName: string, bc: ContinuumBoundaryCondition): void {
    this.boundaryConditions.set(patchName, bc);
  }

  /**
   * Extracts parameter map for surrogate evaluation from current boundary conditions.
   */
  public extractParameters(): Record<string, number> {
    if (this.config.parameterExtractor) {
      return this.config.parameterExtractor(this.boundaryConditions, this.currentTime);
    }

    const params: Record<string, number> = {};

    // Default heuristic parameter mapping
    const inlet = this.boundaryConditions.get("inlet");
    if (inlet) {
      if (inlet.velocity) {
        const speed = Math.hypot(inlet.velocity[0], inlet.velocity[1], inlet.velocity[2]);
        params["inletVelocity"] = speed;
        params["inlet_velocity"] = speed;
        params["speed"] = speed;
        params["u_in"] = speed;
        params["vx"] = inlet.velocity[0];
        params["vy"] = inlet.velocity[1];
        params["vz"] = inlet.velocity[2];
      }
      if (inlet.pressure !== undefined) {
        params["pressure"] = inlet.pressure;
      }
      if (inlet.massFlow !== undefined) {
        params["massFlow"] = inlet.massFlow;
      }
    }

    const obstacle = this.boundaryConditions.get("obstacle");
    if (obstacle && obstacle.velocity) {
      params["wallVelocity"] = obstacle.velocity[1];
      params["structVel"] = obstacle.velocity[1];
      params["vy_wall"] = obstacle.velocity[1];
    }

    return params;
  }

  /**
   * Computes trust region confidence score gamma in [0, 1].
   * Returns 1.0 if inside training bounding box, decays smoothly towards 0.0 when extrapolating.
   */
  public computeConfidence(parameters: Record<string, number>): number {
    if (this.parameterRanges.size === 0) {
      return 1.0; // No reference dataset provided, assume 100% confidence
    }

    let maxExcursion = 0.0;

    for (const [name, range] of this.parameterRanges.entries()) {
      const val = parameters[name];
      if (val === undefined) continue;

      const delta = range.max - range.min;
      const span = delta > 1e-9 ? delta : range.std;

      if (val < range.min) {
        const exc = (range.min - val) / span;
        if (exc > maxExcursion) maxExcursion = exc;
      } else if (val > range.max) {
        const exc = (val - range.max) / span;
        if (exc > maxExcursion) maxExcursion = exc;
      }
    }

    // Exponential decay: gamma = exp(-2.0 * maxExcursion)
    return Math.exp(-2.0 * maxExcursion);
  }

  public step(macroDt: number, _subSteps = 1): CfdStepOutput {
    this.currentTime += macroDt;
    const params = this.extractParameters();

    // Evaluate surrogate
    let pred: PodSurrogatePrediction;
    if ("evaluate" in this.surrogate) {
      pred = this.surrogate.evaluate(params);
    } else {
      pred = this.surrogate.predict(params);
    }
    this.lastPrediction = pred;

    // Map outputs
    let aeroForce: Vector3D = [0, 0, 0];
    let maxVel = 0.0;
    let pDrop = 0.0;

    if (this.config.scalarOutputsMapper) {
      const mapped = this.config.scalarOutputsMapper(pred.scalarOutputs);
      aeroForce = mapped.aerodynamicForceN;
      maxVel = mapped.maxVelocity ?? 0.0;
      pDrop = mapped.pressureDropPa ?? 0.0;
    } else {
      // Heuristic scalar lookup
      const fx =
        pred.scalarOutputs["dragForce"] ??
        pred.scalarOutputs["drag"] ??
        pred.scalarOutputs["fx"] ??
        pred.scalarOutputs["aerodynamicForceX"] ??
        0.0;
      const fy =
        pred.scalarOutputs["liftForce"] ??
        pred.scalarOutputs["lift"] ??
        pred.scalarOutputs["fy"] ??
        pred.scalarOutputs["aerodynamicForceY"] ??
        0.0;
      const fz = pred.scalarOutputs["fz"] ?? pred.scalarOutputs["aerodynamicForceZ"] ?? 0.0;
      aeroForce = [fx, fy, fz];

      maxVel = pred.scalarOutputs["maxVelocity"] ?? pred.scalarOutputs["v_max"] ?? params["inletVelocity"] ?? 1.0;
      pDrop = pred.scalarOutputs["pressureDropPa"] ?? pred.scalarOutputs["dp"] ?? 0.0;
    }

    // Update patch metrics
    const obstacleMetrics: ContinuumPatchMetrics = {
      patchName: "obstacle",
      integratedForce: aeroForce,
      meanPressure: 101325.0 + pDrop * 0.5,
    };
    this.patchMetricsCache.set("obstacle", obstacleMetrics);

    const inletBc = this.boundaryConditions.get("inlet");
    const inletMetrics: ContinuumPatchMetrics = {
      patchName: "inlet",
      integratedForce: [0, 0, 0],
      meanPressure: inletBc?.pressure ?? 101325.0,
      integratedMassFlow: inletBc?.massFlow,
    };
    this.patchMetricsCache.set("inlet", inletMetrics);

    const output: CfdStepOutput = {
      aerodynamicForceN: aeroForce,
      maxVelocity: maxVel,
      pressureDropPa: pDrop,
      patchMetrics: new Map(this.patchMetricsCache),
      velocityMagnitude: pred.field,
    };

    this.lastOutput = output;
    return output;
  }

  public getPatchMetrics(patchName: string): ContinuumPatchMetrics {
    const cached = this.patchMetricsCache.get(patchName);
    if (cached) return cached;
    return {
      patchName,
      integratedForce: [0, 0, 0],
      meanPressure: 101325.0,
    };
  }

  public getVisualField(): Float32Array | null {
    return this.lastPrediction?.field ?? null;
  }

  public terminate(): void {
    // No-op for surrogate
  }
}

export type FidelityMode = "adaptive" | "surrogate" | "continuum";

export interface MultiFidelityManagerConfig {
  /** Fidelity mode (default: 'adaptive'). */
  mode?: FidelityMode;
  /** Trust region confidence threshold gamma_th in (0, 1] (default: 0.85). */
  confidenceThreshold?: number;
  /** Periodic high-fidelity validation & snapshot enrichment interval in macro-steps (default: 50). */
  enrichmentInterval?: number;
  /** Optional snapshot collector to record new snapshots during high-fidelity steps. */
  snapshotCollector?: CfdSnapshotCollector;
  /** Callback fired whenever fidelity mode transitions occur. */
  onFidelityTransition?: (from: "surrogate" | "continuum", to: "surrogate" | "continuum", reason: string) => void;
}

/**
 * Adaptive Multi-Fidelity Continuum Participant.
 *
 * Coordinates a full-order continuum participant (e.g. WebGPU LBM / HPC CFD) and a
 * fast POD-Galerkin ROM surrogate participant (CfdSurrogateParticipant).
 * Dynamically switches between the microsecond ROM in the high-confidence trust region
 * and the full-order solver when parameter drift or periodic validation requires enrichment.
 */
export class MultiFidelityContinuumParticipant implements ICfdContinuumParticipant {
  public readonly id: string;
  public readonly patchNames: readonly string[];
  public readonly highFidelity: ICfdContinuumParticipant;
  public readonly surrogate: CfdSurrogateParticipant;
  public readonly config: MultiFidelityManagerConfig;

  private currentFidelity: "surrogate" | "continuum" = "surrogate";
  private stepCount: number = 0;
  private lastConfidence: number = 1.0;
  private currentTime: number = 0.0;
  private lastBcMap: Map<string, ContinuumBoundaryCondition> = new Map();

  public readonly stats = {
    surrogateSteps: 0,
    continuumSteps: 0,
    totalSteps: 0,
  };

  constructor(
    highFidelity: ICfdContinuumParticipant,
    surrogate: CfdSurrogateParticipant,
    config: MultiFidelityManagerConfig = {},
  ) {
    this.id = `multi-fidelity-${highFidelity.id}`;
    this.highFidelity = highFidelity;
    this.surrogate = surrogate;
    this.config = {
      mode: config.mode ?? "adaptive",
      confidenceThreshold: config.confidenceThreshold ?? 0.85,
      enrichmentInterval: config.enrichmentInterval ?? 50,
      ...config,
    };
    this.patchNames = highFidelity.patchNames;
  }

  public initialize(startTime: number, stopTime: number, dt: number): Promise<void> | void {
    this.currentTime = startTime;
    this.stepCount = 0;
    this.surrogate.initialize(startTime, stopTime, dt);
    return this.highFidelity.initialize(startTime, stopTime, dt);
  }

  public setBoundaryCondition(patchName: string, bc: ContinuumBoundaryCondition): void {
    this.lastBcMap.set(patchName, bc);
    this.highFidelity.setBoundaryCondition(patchName, bc);
    this.surrogate.setBoundaryCondition(patchName, bc);
  }

  public step(macroDt: number, subSteps = 5): Promise<CfdStepOutput> | CfdStepOutput {
    this.stepCount++;
    this.stats.totalSteps++;
    this.currentTime += macroDt;

    const params = this.surrogate.extractParameters();
    const confidence = this.surrogate.computeConfidence(params);
    this.lastConfidence = confidence;

    const targetMode = this.config.mode ?? "adaptive";
    let useSurrogate = false;

    if (targetMode === "surrogate") {
      useSurrogate = true;
    } else if (targetMode === "continuum") {
      useSurrogate = false;
    } else {
      // Adaptive mode
      const isPeriodicEnrichment =
        this.config.enrichmentInterval !== undefined &&
        this.config.enrichmentInterval > 0 &&
        this.stepCount % this.config.enrichmentInterval === 0;

      const isConfident = confidence >= (this.config.confidenceThreshold ?? 0.85);

      useSurrogate = isConfident && !isPeriodicEnrichment;
    }

    const nextFidelity = useSurrogate ? "surrogate" : "continuum";
    if (nextFidelity !== this.currentFidelity) {
      const reason = useSurrogate
        ? `Re-entered surrogate trust region (gamma=${confidence.toFixed(3)})`
        : `Fell back to full continuum (gamma=${confidence.toFixed(3)} < threshold or periodic validation)`;
      this.config.onFidelityTransition?.(this.currentFidelity, nextFidelity, reason);
      this.currentFidelity = nextFidelity;
    }

    if (useSurrogate) {
      this.stats.surrogateSteps++;
      return this.surrogate.step(macroDt, subSteps);
    } else {
      this.stats.continuumSteps++;
      const res = this.highFidelity.step(macroDt, subSteps);

      if (res instanceof Promise) {
        return res.then((output) => {
          this.recordSnapshotIfConfigured(params, output);
          return output;
        });
      }

      this.recordSnapshotIfConfigured(params, res);
      return res;
    }
  }

  private recordSnapshotIfConfigured(params: Record<string, number>, res: CfdStepOutput): void {
    if (this.config.snapshotCollector) {
      const visualField = this.highFidelity.getVisualField?.() ?? res.velocityMagnitude;
      if (visualField) {
        const scalarOutputs: Record<string, number> = {
          dragForce: res.aerodynamicForceN[0],
          liftForce: res.aerodynamicForceN[1],
          maxVelocity: res.maxVelocity,
          pressureDropPa: res.pressureDropPa,
        };
        this.config.snapshotCollector.record(params, visualField, this.currentTime, scalarOutputs);
      }
    }
  }

  public getPatchMetrics(patchName: string): ContinuumPatchMetrics {
    if (this.currentFidelity === "surrogate") {
      return this.surrogate.getPatchMetrics(patchName);
    }
    return this.highFidelity.getPatchMetrics(patchName);
  }

  public getVisualField(): Float32Array | null {
    if (this.currentFidelity === "surrogate") {
      return this.surrogate.getVisualField();
    }
    return this.highFidelity.getVisualField?.() ?? null;
  }

  public getActiveFidelity(): "surrogate" | "continuum" {
    return this.currentFidelity;
  }

  public getLastConfidence(): number {
    return this.lastConfidence;
  }

  public terminate(): Promise<void> | void {
    this.surrogate.terminate();
    return this.highFidelity.terminate();
  }
}
