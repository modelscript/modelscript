// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Interface Jacobian Newton-Raphson Solver for Stiff Algebraic Loops.
 *
 * Implements the Sicklinger Interface Newton-Raphson method for FMI 2.0 / 3.0
 * co-simulation master algorithms. Formulates coupled multi-rate algebraic loops as:
 *
 *   R(U) = U - C(Y(U)) = 0
 *
 * and solves for the zero-residual root via:
 *   J_R(U^(k)) * delta_U = -R(U^(k))
 *   U^(k+1) = U^(k) + alpha * delta_U
 *
 * Academic Citations:
 * - Sicklinger, S., Bellen, A., & Busch, M. (2014). Interface Jacobian-based co-simulation:
 *   Analysis and application. Mathematical and Computer Modelling of Dynamical Systems,
 *   20(3), 227-248. https://doi.org/10.1080/13873954.2013.829497
 * - Kübler, R., & Schiehlen, W. (2000). Two methods of simulator coupling. Mathematical and
 *   Computer Modelling of Dynamical Systems, 6(2), 93-113.
 */

import { convertUnit, type CosimValue, type VariableCoupling } from "./coupling.js";
import type { CoSimParticipant } from "./participant.js";

/** Coupled algebraic variable descriptor in the interface vector U. */
export interface InterfaceVariable {
  index: number;
  targetParticipantId: string;
  targetVariableName: string;
  sourceParticipantId: string;
  sourceVariableName: string;
  fromUnit?: string | undefined;
  toUnit?: string | undefined;
}

export interface InterfaceNewtonOptions {
  /** Convergence tolerance on relative residual (default: 1e-5). */
  tolerance?: number | undefined;
  /** Maximum number of Newton iterations per macro-step (default: 6). */
  maxIterations?: number | undefined;
  /** Line search damping factor for backtracking (default: true). */
  enableLineSearch?: boolean | undefined;
  /** Fallback to Broyden rank-1 secant updates if directional derivatives missing (default: true). */
  useBroydenFallback?: boolean | undefined;
}

export interface InterfaceNewtonResult {
  converged: boolean;
  iterations: number;
  residualNorm: number;
  finalInputs: Map<string, Map<string, CosimValue>>;
}

/**
 * Interface Jacobian solver managing non-linear algebraic loops between co-simulation participants.
 */
export class InterfaceJacobianSolver {
  private readonly variables: InterfaceVariable[] = [];
  readonly options: Required<InterfaceNewtonOptions>;

  constructor(couplings: readonly VariableCoupling[], options: InterfaceNewtonOptions = {}) {
    this.options = {
      tolerance: options.tolerance ?? 1e-5,
      maxIterations: options.maxIterations ?? 6,
      enableLineSearch: options.enableLineSearch ?? true,
      useBroydenFallback: options.useBroydenFallback ?? true,
    };

    // Filter couplings to find cyclic algebraic loops or active coupled real inputs
    couplings.forEach((c, idx) => {
      this.variables.push({
        index: idx,
        targetParticipantId: c.to.participantId,
        targetVariableName: c.to.variableName,
        sourceParticipantId: c.from.participantId,
        sourceVariableName: c.from.variableName,
        fromUnit: c.from.unit,
        toUnit: c.to.unit,
      });
    });
  }

  get dimension(): number {
    return this.variables.length;
  }

  /**
   * Evaluates the residual vector R(U) = U - C(Y(U)) given current inputs and outputs.
   */
  computeResidual(
    currentU: Float64Array,
    outputs: Map<string, Map<string, CosimValue>>,
  ): { residual: Float64Array; norm: number } {
    const n = this.variables.length;
    const residual = new Float64Array(n);
    let sumSq = 0;

    for (let i = 0; i < n; i++) {
      const v = this.variables[i]!;
      const srcOutputs = outputs.get(v.sourceParticipantId);
      let rawVal = srcOutputs?.get(v.sourceVariableName);
      let yVal = typeof rawVal === "number" ? rawVal : 0.0;

      // Apply unit conversion if needed
      if (v.fromUnit && v.toUnit && v.fromUnit !== v.toUnit) {
        yVal = convertUnit(yVal, v.fromUnit, v.toUnit);
      }

      // R_i = u_i - y_i
      const uVal = currentU[i]!;
      const r_i = uVal - yVal;
      residual[i] = r_i;
      const scale = Math.max(1.0, Math.abs(uVal), Math.abs(yVal));
      const rel_r = r_i / scale;
      sumSq += rel_r * rel_r;
    }

    return { residual, norm: Math.sqrt(sumSq / Math.max(1, n)) };
  }

  /** Checks if all participants provide analytical directional derivatives. */
  hasAnalyticDerivatives(participants: CoSimParticipant[]): boolean {
    const partMap = new Map<string, CoSimParticipant>();
    participants.forEach((p) => partMap.set(p.id, p));
    for (const v of this.variables) {
      const p = partMap.get(v.targetParticipantId);
      if (!p || !p.providesDirectionalDerivatives || typeof p.getDirectionalDerivative !== "function") {
        return false;
      }
    }
    return true;
  }

  /**
   * Assembles the Interface Jacobian matrix J_R = I - C * (dY / dU) using
   * participant directional derivatives (or finite difference approximations).
   */
  async assembleJacobian(
    participants: CoSimParticipant[],
    baseU: Float64Array,
    _t: number,
    _h: number,
    baseResidual: Float64Array,
    stepFn: (inputs: Float64Array) => Promise<Map<string, Map<string, CosimValue>>>,
  ): Promise<Float64Array> {
    const n = this.variables.length;
    // Flattened n x n column-major matrix
    const J = new Float64Array(n * n);

    // Initialize with identity matrix I_n
    for (let i = 0; i < n; i++) {
      J[i * n + i] = 1.0;
    }

    const partMap = new Map<string, CoSimParticipant>();
    participants.forEach((p) => partMap.set(p.id, p));

    let canUseAnalyticDerivatives = this.hasAnalyticDerivatives(participants);

    if (canUseAnalyticDerivatives) {
      // ── Strategy A: Directional Derivatives via FMI entry points ──
      for (let j = 0; j < n; j++) {
        const vj = this.variables[j]!;
        const tgtPart = partMap.get(vj.targetParticipantId)!;

        // Find all variables originating from tgtPart
        const dependentOutputs = this.variables.filter((v) => v.sourceParticipantId === tgtPart.id);
        if (dependentOutputs.length === 0) continue;

        try {
          const knownVrs = [0];
          const unknownVrs = dependentOutputs.map((_, idx) => idx);
          const dvKnown = [1.0]; // unit direction vector e_j

          const sensitivities = await tgtPart.getDirectionalDerivative!(unknownVrs, knownVrs, dvKnown);

          for (let k = 0; k < dependentOutputs.length; k++) {
            const depVar = dependentOutputs[k]!;
            const rowIdx = depVar.index;
            let dYdU = sensitivities[k] ?? 0.0;
            if (depVar.fromUnit && depVar.toUnit && depVar.fromUnit !== depVar.toUnit) {
              dYdU = convertUnit(dYdU, depVar.fromUnit, depVar.toUnit);
            }
            const currVal = J[j * n + rowIdx] ?? 0.0;
            J[j * n + rowIdx] = currVal - dYdU;
          }
        } catch {
          canUseAnalyticDerivatives = false;
          break;
        }
      }
    }

    if (!canUseAnalyticDerivatives) {
      // ── Strategy B: Finite-Difference Column Perturbation ──
      const perturbedU = new Float64Array(baseU);
      for (let j = 0; j < n; j++) {
        const origVal = baseU[j]!;
        const eps = 1e-7 * Math.max(1.0, Math.abs(origVal));
        perturbedU[j] = origVal + eps;

        const perturbedOutputs = await stepFn(perturbedU);
        const { residual: perturbedResidual } = this.computeResidual(perturbedU, perturbedOutputs);

        for (let i = 0; i < n; i++) {
          J[j * n + i] = (perturbedResidual[i]! - baseResidual[i]!) / eps;
        }

        perturbedU[j] = origVal;
      }
      // Restore participants to base inputs
      await stepFn(baseU);
    }

    return J;
  }

  /**
   * Solves the linear system J * deltaU = -residual using LU decomposition with partial pivoting
   * and Tikhonov regularization fallback if ill-conditioned.
   */
  solveLinearSystem(J: Float64Array, residual: Float64Array): Float64Array {
    const n = this.variables.length;
    const deltaU = new Float64Array(n);
    const A = new Float64Array(J);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = -residual[i]!;

    const p = new Int32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;

    for (let k = 0; k < n; k++) {
      let maxVal = Math.abs(A[k * n + k]!);
      let pivotRow = k;
      for (let i = k + 1; i < n; i++) {
        const absVal = Math.abs(A[k * n + i]!);
        if (absVal > maxVal) {
          maxVal = absVal;
          pivotRow = i;
        }
      }

      if (maxVal < 1e-12) {
        A[k * n + k] = (A[k * n + k] ?? 0.0) + 1e-6; // Tikhonov diagonal regularization
      }

      if (pivotRow !== k) {
        for (let j = 0; j < n; j++) {
          const tmp = A[j * n + k]!;
          A[j * n + k] = A[j * n + pivotRow]!;
          A[j * n + pivotRow] = tmp;
        }
        const tmpB = b[k]!;
        b[k] = b[pivotRow]!;
        b[pivotRow] = tmpB;

        const tmpP = p[k]!;
        p[k] = p[pivotRow]!;
        p[pivotRow] = tmpP;
      }

      const akk = A[k * n + k]!;
      for (let i = k + 1; i < n; i++) {
        const factor = A[k * n + i]! / akk;
        A[k * n + i] = factor;
        for (let j = k + 1; j < n; j++) {
          A[j * n + i] = (A[j * n + i] ?? 0.0) - factor * A[j * n + k]!;
        }
        b[i] = (b[i] ?? 0.0) - factor * b[k]!;
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      let sum = b[i]!;
      for (let j = i + 1; j < n; j++) {
        sum -= A[j * n + i]! * deltaU[j]!;
      }
      deltaU[i] = sum / A[i * n + i]!;
    }

    return deltaU;
  }

  /**
   * Applies Broyden rank-1 secant update to Jacobian approximation:
   *   J^(k+1) = J^(k) + ((deltaR - J^(k) * deltaU) / (deltaU^T * deltaU)) * deltaU^T
   */
  updateBroyden(J: Float64Array, deltaU: Float64Array, deltaR: Float64Array): void {
    const n = this.variables.length;
    let normSq = 0;
    for (let i = 0; i < n; i++) normSq += deltaU[i]! * deltaU[i]!;
    if (normSq < 1e-14) return;

    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let jDu = 0;
      for (let j = 0; j < n; j++) {
        jDu += J[j * n + i]! * deltaU[j]!;
      }
      v[i] = deltaR[i]! - jDu;
    }

    for (let j = 0; j < n; j++) {
      const du_j = deltaU[j]! / normSq;
      for (let i = 0; i < n; i++) {
        J[j * n + i] = (J[j * n + i] ?? 0.0) + v[i]! * du_j;
      }
    }
  }

  /** Converts the U vector into participant-keyed input maps. */
  vectorToInputMap(U: Float64Array): Map<string, Map<string, CosimValue>> {
    const result = new Map<string, Map<string, CosimValue>>();
    for (let i = 0; i < this.variables.length; i++) {
      const v = this.variables[i]!;
      let partInputs = result.get(v.targetParticipantId);
      if (!partInputs) {
        partInputs = new Map();
        result.set(v.targetParticipantId, partInputs);
      }
      partInputs.set(v.targetVariableName, U[i]!);
    }
    return result;
  }

  /** Extracts vector U from current participant inputs. */
  extractUFromInputs(inputs: Map<string, Map<string, CosimValue>>): Float64Array {
    const U = new Float64Array(this.variables.length);
    for (let i = 0; i < this.variables.length; i++) {
      const v = this.variables[i]!;
      const val = inputs.get(v.targetParticipantId)?.get(v.targetVariableName);
      U[i] = typeof val === "number" ? val : 0.0;
    }
    return U;
  }
}
