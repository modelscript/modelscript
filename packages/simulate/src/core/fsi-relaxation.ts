// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Vector3D } from "./continuum-participant.js";

export interface VectorAitkenConfig {
  /** Initial relaxation factor omega_0 in (0, 1] (default: 0.5). */
  initialOmega?: number;
  /** Minimum allowable relaxation factor (default: 0.02). */
  minOmega?: number;
  /** Maximum allowable relaxation factor (default: 1.0). */
  maxOmega?: number;
  /** Convergence tolerance for relative residual norm (default: 1e-4). */
  tolerance?: number;
}

/**
 * Dynamic Vector Aitken Acceleration for Multi-Physics FSI Co-Simulation.
 *
 * Prevents artificial numerical added-mass divergence when coupling lightweight flexible
 * structures (drone spars, thin wings, turbine blades) to dense fluid domains (water, air).
 * Computes optimal dynamic relaxation parameter omega_k via:
 *
 *   Delta r_k = r_k - r_{k-1}
 *   omega_k = -omega_{k-1} * (Delta r_k^T * r_{k-1}) / ||Delta r_k||^2
 *   x_{k+1} = x_k + omega_k * r_k
 */
export class VectorAitkenRelaxation {
  public readonly config: Required<VectorAitkenConfig>;
  private omega: number;
  private prevResidual: Float64Array | null = null;
  private relaxedState: Float64Array | null = null;
  private stepCount: number = 0;

  constructor(config: VectorAitkenConfig = {}) {
    this.config = {
      initialOmega: config.initialOmega ?? 0.5,
      minOmega: config.minOmega ?? 0.02,
      maxOmega: config.maxOmega ?? 1.0,
      tolerance: config.tolerance ?? 1e-4,
    };
    this.omega = this.config.initialOmega;
  }

  public reset(): void {
    this.omega = this.config.initialOmega;
    this.prevResidual = null;
    this.relaxedState = null;
    this.stepCount = 0;
  }

  public get currentOmega(): number {
    return this.omega;
  }

  /**
   * Performs dynamic Aitken relaxation on a 1D scalar value (e.g., tip deflection).
   */
  public relaxScalar(rawPredictedValue: number): {
    relaxedValue: number;
    omega: number;
    residualNorm: number;
    converged: boolean;
  } {
    const rawVec = new Float64Array([rawPredictedValue]);
    const res = this.relaxVector(rawVec);
    return {
      relaxedValue: res.relaxedVector[0]!,
      omega: res.omega,
      residualNorm: res.residualNorm,
      converged: res.converged,
    };
  }

  /**
   * Performs dynamic Aitken relaxation on a multi-degree-of-freedom vector
   * (e.g. distributed boundary nodal displacement or surface traction vector).
   */
  public relaxVector(rawPredictedVector: ArrayLike<number>): {
    relaxedVector: Float64Array;
    omega: number;
    residualNorm: number;
    converged: boolean;
  } {
    const n = rawPredictedVector.length;
    this.stepCount++;

    if (!this.relaxedState || this.relaxedState.length !== n) {
      this.relaxedState = new Float64Array(n);
      for (let i = 0; i < n; i++) this.relaxedState[i] = rawPredictedVector[i]!;
      this.prevResidual = new Float64Array(n); // all zeros initially
      return {
        relaxedVector: new Float64Array(this.relaxedState),
        omega: this.omega,
        residualNorm: 1.0,
        converged: false,
      };
    }

    // Residual r_k = rawPredicted - relaxedState_{k-1}
    const residual = new Float64Array(n);
    let residualNormSq = 0.0;
    let stateNormSq = 0.0;

    for (let i = 0; i < n; i++) {
      residual[i] = rawPredictedVector[i]! - this.relaxedState[i]!;
      residualNormSq += residual[i]! * residual[i]!;
      stateNormSq += this.relaxedState[i]! * this.relaxedState[i]!;
    }
    const residualNorm = Math.sqrt(residualNormSq);
    const relativeNorm = residualNorm / (Math.sqrt(stateNormSq) + 1e-9);

    if (this.stepCount > 1 && this.prevResidual) {
      // Delta r_k = r_k - r_{k-1}
      let deltaR_dot_prevR = 0.0;
      let deltaR_normSq = 0.0;

      for (let i = 0; i < n; i++) {
        const deltaR_i = residual[i]! - this.prevResidual[i]!;
        deltaR_dot_prevR += deltaR_i * this.prevResidual[i]!;
        deltaR_normSq += deltaR_i * deltaR_i;
      }

      if (deltaR_normSq > 1e-18) {
        const newOmega = -this.omega * (deltaR_dot_prevR / deltaR_normSq);
        this.omega = Math.min(this.config.maxOmega, Math.max(this.config.minOmega, Math.abs(newOmega)));
      }
    } else {
      this.omega = this.config.initialOmega;
    }

    // Update relaxed state: x_{k+1} = x_k + omega_k * r_k
    for (let i = 0; i < n; i++) {
      this.relaxedState[i] += this.omega * residual[i]!;
    }
    this.prevResidual = residual;

    return {
      relaxedVector: new Float64Array(this.relaxedState),
      omega: this.omega,
      residualNorm: relativeNorm,
      converged: relativeNorm < this.config.tolerance,
    };
  }

  /**
   * Relaxes boundary load map of named tags to 3D force vectors.
   */
  public relaxBoundaryLoads(rawLoads: Map<string, Vector3D>): Map<string, Vector3D> {
    const tags = Array.from(rawLoads.keys());
    const rawArray = new Float64Array(tags.length * 3);
    for (let i = 0; i < tags.length; i++) {
      const v = rawLoads.get(tags[i]!)!;
      rawArray[i * 3 + 0] = v[0];
      rawArray[i * 3 + 1] = v[1];
      rawArray[i * 3 + 2] = v[2];
    }

    const { relaxedVector } = this.relaxVector(rawArray);
    const result = new Map<string, Vector3D>();
    for (let i = 0; i < tags.length; i++) {
      result.set(tags[i]!, [relaxedVector[i * 3 + 0]!, relaxedVector[i * 3 + 1]!, relaxedVector[i * 3 + 2]!]);
    }
    return result;
  }
}

/**
 * Multi-Rate Sub-Cycling Time Integration Scheduler.
 *
 * Synchronizes distinct physical subsystems operating on disparate timescales:
 *   - Fast CFD: dt_CFD ~ 1e-4 s (acoustic CFL stability in LBM / Navier-Stokes)
 *   - Moderate FEA: dt_FEA ~ 1e-3 s (elastodynamics)
 *   - Macro 1D DAE: dt_macro ~ 1e-2 s (system supervisory control and flight dynamics)
 */
export interface MultiRateScheduleConfig {
  macroDt: number;
  cfdDt?: number;
  feaDt?: number;
  oneDDt?: number;
}

export class MultiRateSubCycleScheduler {
  public readonly macroDt: number;
  public readonly cfdSubSteps: number;
  public readonly feaSubSteps: number;
  public readonly oneDSubSteps: number;
  public readonly cfdDt: number;
  public readonly feaDt: number;
  public readonly oneDDt: number;

  constructor(config: MultiRateScheduleConfig) {
    this.macroDt = config.macroDt;

    const targetCfdDt = config.cfdDt ?? this.macroDt / 5;
    const targetFeaDt = config.feaDt ?? this.macroDt;
    const targetOneDDt = config.oneDDt ?? this.macroDt;

    this.cfdSubSteps = Math.max(1, Math.round(this.macroDt / targetCfdDt));
    this.feaSubSteps = Math.max(1, Math.round(this.macroDt / targetFeaDt));
    this.oneDSubSteps = Math.max(1, Math.round(this.macroDt / targetOneDDt));

    this.cfdDt = this.macroDt / this.cfdSubSteps;
    this.feaDt = this.macroDt / this.feaSubSteps;
    this.oneDDt = this.macroDt / this.oneDSubSteps;
  }

  /**
   * Linearly interpolates a scalar variable between previous and target macro-step values
   * at sub-step index i out of totalSubSteps.
   */
  public interpolateScalar(prevVal: number, targetVal: number, subStepIndex: number, totalSubSteps: number): number {
    if (totalSubSteps <= 1) return targetVal;
    const tau = Math.min(1.0, Math.max(0.0, (subStepIndex + 1) / totalSubSteps));
    return (1.0 - tau) * prevVal + tau * targetVal;
  }

  /**
   * Linearly interpolates a 3D vector between previous and target macro-step values.
   */
  public interpolateVector(
    prevVec: Vector3D,
    targetVec: Vector3D,
    subStepIndex: number,
    totalSubSteps: number,
  ): Vector3D {
    if (totalSubSteps <= 1) return targetVec;
    const tau = Math.min(1.0, Math.max(0.0, (subStepIndex + 1) / totalSubSteps));
    return [
      (1.0 - tau) * prevVec[0] + tau * targetVec[0],
      (1.0 - tau) * prevVec[1] + tau * targetVec[1],
      (1.0 - tau) * prevVec[2] + tau * targetVec[2],
    ];
  }
}
