// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/control — Explicit / Surrogatized MPC Fitting & Embedded C99/TS Codegen.
 *
 * Mirrors `JuliaSimControl`'s Explicit/Surrogatized MPC workflow:
 *   1. Samples an online `RtiNonlinearMpcController` across an operating box `[xMin, xMax]`.
 *   2. Fits a fast radial-basis / affine explicit control law:
 *        u_hat(x) = clamp(W_lin * x + W_rbf * φ(x) + b, u_min, u_max)
 *      via closed-form ridge regression.
 *   3. Emits zero-dependency standalone **C99** (`emitExplicitMpcC99`) and **TypeScript**
 *      (`emitExplicitMpcTs`) embedded controller code for real-time edge/MCU deployment.
 */

import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";
import type { RtiNonlinearMpcController } from "./nmpc.js";

export interface ExplicitMpcFitOptions {
  /** Operating state box lower bounds (length `nStates`). */
  xMin: number[];
  /** Operating state box upper bounds (length `nStates`). */
  xMax: number[];
  /** Target reference state `xRef`. */
  xRef: number[];
  /** Control box bounds (for output clamping). */
  uMin: number[];
  uMax: number[];
  /** Number of training samples across the operating box (default: 80). */
  numSamples?: number | undefined;
  /** Number of Gaussian RBF centers (default: 16). */
  numRbfCenters?: number | undefined;
  /** Ridge regularization parameter `λ` (default: 1e-5). */
  ridgeLambda?: number | undefined;
  /** Deterministic PRNG seed (default: 42). */
  seed?: number | undefined;
}

export interface ExplicitMpcSurrogate {
  nStates: number;
  nControls: number;
  uMin: number[];
  uMax: number[];
  /** RBF centers `[numCenters][nStates]`. */
  centers: number[][];
  /** RBF inverse squared lengthscale `gamma = 1 / (2 * sigma^2)`. */
  gamma: number;
  /** Weights `[nControls][1 + nStates + numCenters]` (`[bias, linear..., rbf...]`). */
  weights: number[][];
  /** Training RMSE against the online RTI-NMPC controller. */
  fitRmse: number;
  /** Evaluates the explicit surrogatized control law in O(nStates * numCenters) flops. */
  evaluate(x: number[]): number[];
}

/**
 * Fits an explicit surrogatized MPC control law to an online `RtiNonlinearMpcController`.
 */
export function fitExplicitMpcSurrogate(
  controller: RtiNonlinearMpcController,
  options: ExplicitMpcFitOptions,
): ExplicitMpcSurrogate {
  const nStates = options.xMin.length;
  const nControls = options.uMin.length;
  const numSamples = Math.max(20, options.numSamples ?? 80);
  const numCenters = Math.min(numSamples, Math.max(4, options.numRbfCenters ?? 16));
  const ridge = options.ridgeLambda ?? 1e-5;

  let seed = (options.seed ?? 42) >>> 0 || 1;
  const rand = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  // Stratified random sampling across [xMin, xMax], sorted along x[0] for smooth homotopy warm-starting
  const X: number[][] = [];
  for (let s = 0; s < numSamples; s++) {
    X.push(
      Array.from({ length: nStates }, (_, i) => options.xMin[i]! + rand() * (options.xMax[i]! - options.xMin[i]!)),
    );
  }
  X.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const U: number[][] = [];
  for (const x of X) {
    controller.computeControl(x, options.xRef);
    const res = controller.computeControl(x, options.xRef);
    U.push(res.u0);
  }

  // Pick evenly spaced RBF centers from X
  const centers: number[][] = [];
  for (let c = 0; c < numCenters; c++) {
    const idx = Math.floor((c * numSamples) / numCenters);
    centers.push([...X[idx]!]);
  }

  // Heuristic lengthscale from box diagonal
  let diagSq = 0;
  for (let i = 0; i < nStates; i++) {
    const span = options.xMax[i]! - options.xMin[i]!;
    diagSq += span * span;
  }
  const sigma = Math.max(1e-3, 0.35 * Math.sqrt(diagSq));
  const gamma = 0.5 / (sigma * sigma);

  const nFeat = 1 + nStates + numCenters;
  const evalFeatures = (x: number[]): Float64Array => {
    const phi = new Float64Array(nFeat);
    phi[0] = 1.0;
    for (let i = 0; i < nStates; i++) phi[1 + i] = x[i]!;
    for (let c = 0; c < numCenters; c++) {
      let d2 = 0;
      const ctr = centers[c]!;
      for (let i = 0; i < nStates; i++) {
        const diff = x[i]! - ctr[i]!;
        d2 += diff * diff;
      }
      phi[1 + nStates + c] = Math.exp(-gamma * d2);
    }
    return phi;
  };

  // Build normal matrix Φ^T Φ + λ I
  const PhiList = X.map(evalFeatures);
  const G = new Float64Array(nFeat * nFeat);
  for (let i = 0; i < nFeat; i++) G[i * nFeat + i] = ridge;
  for (const phi of PhiList) {
    for (let i = 0; i < nFeat; i++) {
      const pi = phi[i]!;
      const rowOff = i * nFeat;
      for (let j = 0; j < nFeat; j++) G[rowOff + j] = G[rowOff + j]! + pi * phi[j]!;
    }
  }
  const fact = luFactorFlat(G, nFeat);

  const weights: number[][] = [];
  for (let k = 0; k < nControls; k++) {
    const rhs = new Float64Array(nFeat);
    for (let s = 0; s < numSamples; s++) {
      const phi = PhiList[s]!;
      const uk = U[s]![k]!;
      for (let i = 0; i < nFeat; i++) rhs[i] = rhs[i]! + phi[i]! * uk;
    }
    luSolveFlat(fact, rhs);
    weights.push(Array.from(rhs));
  }

  const evaluate = (x: number[]): number[] => {
    const phi = evalFeatures(x);
    return weights.map((wk, k) => {
      let acc = 0;
      for (let i = 0; i < nFeat; i++) acc += wk[i]! * phi[i]!;
      return Math.max(options.uMin[k]!, Math.min(options.uMax[k]!, acc));
    });
  };

  let sqErr = 0;
  for (let s = 0; s < numSamples; s++) {
    const pred = evaluate(X[s]!);
    for (let k = 0; k < nControls; k++) {
      const d = pred[k]! - U[s]![k]!;
      sqErr += d * d;
    }
  }

  return {
    nStates,
    nControls,
    uMin: [...options.uMin],
    uMax: [...options.uMax],
    centers,
    gamma,
    weights,
    fitRmse: Math.sqrt(sqErr / Math.max(1, numSamples * nControls)),
    evaluate,
  };
}

/**
 * Emits a standalone, zero-dependency C99 embedded controller function for an `ExplicitMpcSurrogate`.
 */
export function emitExplicitMpcC99(surrogate: ExplicitMpcSurrogate, fnName = "explicit_mpc_step"): string {
  const { nStates, nControls, centers, gamma, weights, uMin, uMax } = surrogate;
  const nC = centers.length;
  const nFeat = 1 + nStates + nC;

  const flatCenters = centers
    .flat()
    .map((v) => v.toPrecision(12))
    .join(", ");
  const flatWeights = weights
    .flat()
    .map((v) => v.toPrecision(12))
    .join(", ");
  const uMinStr = uMin.map((v) => v.toPrecision(12)).join(", ");
  const uMaxStr = uMax.map((v) => v.toPrecision(12)).join(", ");

  return `/* Auto-generated Explicit/Surrogatized MPC Controller (C99, zero heap allocation) */
#include <math.h>

void ${fnName}(const double x[${nStates}], double u_out[${nControls}]) {
  static const double CENTERS[${nC * nStates}] = { ${flatCenters} };
  static const double WEIGHTS[${nControls * nFeat}] = { ${flatWeights} };
  static const double U_MIN[${nControls}] = { ${uMinStr} };
  static const double U_MAX[${nControls}] = { ${uMaxStr} };
  const double gamma = ${gamma.toPrecision(12)};

  double phi[${nFeat}];
  phi[0] = 1.0;
  for (int i = 0; i < ${nStates}; ++i) phi[1 + i] = x[i];
  for (int c = 0; c < ${nC}; ++c) {
    double d2 = 0.0;
    for (int i = 0; i < ${nStates}; ++i) {
      double d = x[i] - CENTERS[c * ${nStates} + i];
      d2 += d * d;
    }
    phi[1 + ${nStates} + c] = exp(-gamma * d2);
  }
  for (int k = 0; k < ${nControls}; ++k) {
    double acc = 0.0;
    for (int f = 0; f < ${nFeat}; ++f) acc += WEIGHTS[k * ${nFeat} + f] * phi[f];
    if (acc < U_MIN[k]) acc = U_MIN[k];
    if (acc > U_MAX[k]) acc = U_MAX[k];
    u_out[k] = acc;
  }
}
`;
}
