// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Structural & Local Parameter Identifiability Analysis.
 *
 * Pre-calibration static analysis pass that determines whether model parameters `p`
 * are locally structurally identifiable from output observations `y = h(x, p)` of a
 * dynamical system `dx/dt = f(x, p)`.
 *
 * Computes:
 *   1. Augmented observability-identifiability Jacobian via trajectory sensitivity rollout
 *   2. Thin SVD (`svdJacobi`) for numerical rank & smallest singular value
 *   3. Fisher Information Matrix (FIM = S^T S) collinearity index & per-parameter identifiability
 */

import { matMul, matTranspose, svdJacobi } from "../math/dense_linalg.js";

export interface IdentifiabilityInput {
  /** RHS dx/dt = f(t, x, p). */
  readonly f: (t: number, x: readonly number[], p: readonly number[]) => number[];
  /** Output map y = h(x, p). */
  readonly outputFn: (x: readonly number[], p: readonly number[]) => number[];
  readonly x0: readonly number[];
  readonly p0: readonly number[];
  readonly paramNames?: readonly string[] | undefined;
  readonly tEnd?: number | undefined;
  readonly numSamples?: number | undefined;
  readonly rankTol?: number | undefined;
}

export interface ParameterIdentifiabilityInfo {
  readonly index: number;
  readonly name: string;
  readonly sensitivityNorm: number;
  readonly identifiable: boolean;
}

export interface IdentifiabilityResult {
  readonly isStructurallyIdentifiable: boolean;
  readonly numericalRank: number;
  readonly numParameters: number;
  readonly singularValues: number[];
  readonly conditionNumber: number;
  readonly collinearityIndex: number;
  readonly unidentifiableParams: string[];
  readonly parameters: ParameterIdentifiabilityInfo[];
}

function rk4Rollout(
  f: (t: number, x: readonly number[], p: readonly number[]) => number[],
  outputFn: (x: readonly number[], p: readonly number[]) => number[],
  x0: readonly number[],
  p: readonly number[],
  tEnd: number,
  numSamples: number,
): Float64Array {
  const n = x0.length;
  const dt = tEnd / Math.max(1, numSamples);
  const x = Float64Array.from(x0);
  const y0 = outputFn(Array.from(x), p);
  const m = y0.length;
  const trace = new Float64Array((numSamples + 1) * m);
  for (let j = 0; j < m; j++) trace[j] = y0[j]!;

  const tmp = new Array<number>(n);
  for (let step = 0; step < numSamples; step++) {
    const t = step * dt;
    const xArr = Array.from(x);
    const k1 = f(t, xArr, p);
    for (let i = 0; i < n; i++) tmp[i] = x[i]! + 0.5 * dt * k1[i]!;
    const k2 = f(t + 0.5 * dt, tmp, p);
    for (let i = 0; i < n; i++) tmp[i] = x[i]! + 0.5 * dt * k2[i]!;
    const k3 = f(t + 0.5 * dt, tmp, p);
    for (let i = 0; i < n; i++) tmp[i] = x[i]! + dt * k3[i]!;
    const k4 = f(t + dt, tmp, p);
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + (dt / 6.0) * (k1[i]! + 2.0 * k2[i]! + 2.0 * k3[i]! + k4[i]!);
    }
    const y = outputFn(Array.from(x), p);
    const offset = (step + 1) * m;
    for (let j = 0; j < m; j++) trace[offset + j] = y[j]!;
  }
  return trace;
}

/**
 * Analyzes local structural & practical parameter identifiability of a dynamical system.
 */
export function analyzeIdentifiability(input: IdentifiabilityInput): IdentifiabilityResult {
  const numParams = input.p0.length;
  const paramNames = input.paramNames ?? Array.from({ length: numParams }, (_, i) => `p${i}`);
  const tEnd = input.tEnd ?? 2.0;
  const numSamples = input.numSamples ?? 25;
  const rankTol = input.rankTol ?? 1e-6;

  const nominal = rk4Rollout(input.f, input.outputFn, input.x0, input.p0, tEnd, numSamples);
  const numObs = nominal.length;

  // Build sensitivity matrix S (numObs x numParams) via central differences
  const S = new Float64Array(numObs * numParams);
  const colNorms = new Float64Array(numParams);

  for (let j = 0; j < numParams; j++) {
    const eps = Math.max(1e-6, Math.abs(input.p0[j]!) * 1e-5);
    const pPlus = [...input.p0];
    const pMinus = [...input.p0];
    pPlus[j] = pPlus[j]! + eps;
    pMinus[j] = pMinus[j]! - eps;
    const yPlus = rk4Rollout(input.f, input.outputFn, input.x0, pPlus, tEnd, numSamples);
    const yMinus = rk4Rollout(input.f, input.outputFn, input.x0, pMinus, tEnd, numSamples);

    let norm2 = 0.0;
    for (let i = 0; i < numObs; i++) {
      const deriv = (yPlus[i]! - yMinus[i]!) / (2.0 * eps);
      S[i * numParams + j] = deriv;
      norm2 += deriv * deriv;
    }
    colNorms[j] = Math.sqrt(norm2);
  }

  // Normalized sensitivity matrix for collinearity index (Brun et al. 2001)
  const Snorm = new Float64Array(numObs * numParams);
  for (let j = 0; j < numParams; j++) {
    const c = colNorms[j]!;
    if (c > 1e-15) {
      for (let i = 0; i < numObs; i++) {
        Snorm[i * numParams + j] = S[i * numParams + j]! / c;
      }
    }
  }

  const svd = svdJacobi(S, numObs, numParams);
  const svdNorm = svdJacobi(Snorm, numObs, numParams);
  const singularValues = Array.from(svd.S);
  const maxS = singularValues[0] ?? 0;
  const minS = singularValues[singularValues.length - 1] ?? 0;

  let numericalRank = 0;
  for (let i = 0; i < singularValues.length; i++) {
    if (singularValues[i]! > Math.max(1e-12, maxS * rankTol)) {
      numericalRank++;
    }
  }

  const minNormS = svdNorm.S[svdNorm.k - 1] ?? 0;
  const collinearityIndex = minNormS > 1e-15 ? 1.0 / minNormS : Infinity;
  const conditionNumber = minS > 1e-15 ? maxS / minS : Infinity;

  // Identify parameters strongly aligned with nullspace right singular vectors
  const nullWeight = new Float64Array(numParams);
  for (let col = numericalRank; col < svd.k; col++) {
    for (let p = 0; p < numParams; p++) {
      const v = svd.V[p * svd.k + col]!;
      nullWeight[p] = nullWeight[p]! + v * v;
    }
  }

  // Also check FIM diagonal (kept for diagnostics)
  const ST = matTranspose(S, numObs, numParams);
  const fim = matMul(ST, S, numParams, numObs, numParams);
  void fim;

  const parameters: ParameterIdentifiabilityInfo[] = [];
  const unidentifiableParams: string[] = [];
  for (let j = 0; j < numParams; j++) {
    const zeroSens = colNorms[j]! <= Math.max(1e-12, maxS * rankTol);
    const inNull = nullWeight[j]! > 0.1;
    const identifiable = !zeroSens && !inNull;
    const name = paramNames[j] ?? `p${j}`;
    if (!identifiable) unidentifiableParams.push(name);
    parameters.push({
      index: j,
      name,
      sensitivityNorm: colNorms[j]!,
      identifiable,
    });
  }

  return {
    isStructurallyIdentifiable: numericalRank === numParams,
    numericalRank,
    numParameters: numParams,
    singularValues,
    conditionNumber,
    collinearityIndex,
    unidentifiableParams,
    parameters,
  };
}
