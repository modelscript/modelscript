// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Physics-Informed Neural Network (PINN) Training Engine (1D DAE & Multi-D Spatio-Temporal PDEs).
 *
 * Implements pure-TypeScript in-WASM training of deep neural networks constrained
 * by Differential-Algebraic Equations (DAEs), Partial Differential Equations (PDEs),
 * and physical boundary conditions.
 *
 * Academic Citations:
 * - Raissi, M., Perdikaris, P., & Karniadakis, G. E. (2019). "Physics-informed neural networks:
 *   A deep learning framework for solving forward and inverse problems involving nonlinear
 *   partial differential equations." Journal of Computational Physics, 378, 686-707.
 *   https://doi.org/10.1016/j.jcp.2018.10.045
 * - Karniadakis, G. E., Kevrekidis, I. G., Lu, L., Perdikaris, P., Wang, S., & Yang, L. (2021).
 *   "Physics-informed machine learning." Nature Reviews Physics, 3(6), 422-440.
 *
 * Architectural Features:
 * - Exact closed-form forward propagation of network state $\hat{y}$, velocity $\dot{\hat{y}}$,
 *   and acceleration $\ddot{\hat{y}}$ (plus directional PDE partials $\frac{\partial \hat{u}}{\partial x_k}$
 *   and $\frac{\partial^2 \hat{u}}{\partial x_k^2}$) via analytical 2nd-order Taylor jets.
 * - Exact analytical backward-of-forward weight gradient backpropagation (`backwardPINNJet`),
 *   computing $\nabla_{W^{(l)}} \mathcal{L}$ and $\nabla_{b^{(l)}} \mathcal{L}$ in a single backward
 *   sweep per collocation point using third-order activation derivatives $\sigma'''(z)$.
 * - Multi-objective physical loss: $\mathcal{L} = w_{\text{IC}} \mathcal{L}_{\text{IC}} + w_{\text{res}} \mathcal{L}_{\text{res}} + w_{\text{data}} \mathcal{L}_{\text{data}}$.
 * - Zero external dependencies (pure TS/WASM — no PyTorch, TensorFlow, or Python runtime required).
 * - Exports directly to self-contained Modelica surrogate blocks.
 */

import {
  generateCollocationPoints,
  generateMultiDimCollocationPoints,
  type CollocationConfig,
} from "./pinn-collocation.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type PINNActivation = "tanh" | "sin" | "gelu";

export interface PINNInitialCondition {
  t: number;
  y: number[];
  dy?: number[] | undefined;
}

export interface PINNObservation {
  t: number;
  y: number[];
}

export interface PINNConfig {
  /** Time domain interval [t0, tEnd]. */
  tSpan: [number, number];
  /** Output state dimension. */
  stateDim: number;
  /** Hidden layer node counts (default: [32, 32]). */
  hiddenLayers?: number[] | undefined;
  /** Activation function with smooth higher derivatives (default: "tanh"). */
  activation?: PINNActivation | undefined;
  /** Collocation points or generation configuration. */
  collocation?: number[] | CollocationConfig | undefined;
  /** Initial conditions and boundary constraints. */
  initialConditions: PINNInitialCondition[];
  /**
   * Physics residual equation: $F(t, y, \dot{y}, \ddot{y}) = 0$.
   * Must return an array of residual errors matching or subsetting the state equations.
   */
  physicsResidual: (t: number, y: number[], dy: number[], d2y?: number[]) => number[];
  /** Optional sparse observation data points for hybrid inverse/calibration problems. */
  observations?: PINNObservation[] | undefined;
  /** Loss component weights (default: { ic: 20.0, physics: 1.0, data: 5.0 }). */
  weights?:
    | {
        ic?: number | undefined;
        physics?: number | undefined;
        data?: number | undefined;
      }
    | undefined;
  /** Training iterations / epochs (default: 500). */
  epochs?: number | undefined;
  /** Initial learning rate for Adam optimizer (default: 0.005). */
  learningRate?: number | undefined;
  /** PRNG seed for deterministic weight initialization (default: 42). */
  seed?: number | undefined;
  /** Early stopping threshold on total loss (default: 1e-6). */
  earlyStoppingLoss?: number | undefined;
  /** Progress callback invoked every epoch or step. */
  onProgress?: ((epoch: number, loss: PINNLossBreakdown) => void) | undefined;
}

export interface PINNLossBreakdown {
  total: number;
  physics: number;
  ic: number;
  data: number;
}

export interface PINNLayer {
  W: number[][]; // [fanOut][fanIn]
  b: number[]; // [fanOut]
}

export interface PINNEvalResult {
  y: number[];
  dy: number[];
  d2y: number[];
}

export interface MultiDimPINNEvalResult {
  /** Predicted state vector $\hat{u}(\mathbf{x}) \in \mathbb{R}^{\text{stateDim}}$. */
  u: number[];
  /** First directional partial derivatives: `du[k][i]` = $\frac{\partial \hat{u}_i}{\partial x_k}$. */
  du: number[][];
  /** Second directional partial derivatives: `d2u[k][i]` = $\frac{\partial^2 \hat{u}_i}{\partial x_k^2}$. */
  d2u: number[][];
}

export interface PDEBoundaryCondition {
  /** Spatio-temporal coordinate point $\mathbf{x}_b \in \partial \Omega$. */
  coords: number[];
  /** Target Dirichlet state vector $u(\mathbf{x}_b)$. */
  u: number[];
}

export interface PDEPINNConfig {
  /** Coordinate domain bounds `[[x0_min, x0_max], [x1_min, x1_max], ...]` (e.g., `[[t0, tEnd], [xMin, xMax]]`). */
  domainBounds: [number, number][];
  /** Output field dimension (e.g., 1 for scalar temperature/velocity $u(t, x)$). */
  stateDim: number;
  /** Hidden layer sizes (default: `[24, 24]`). */
  hiddenLayers?: number[] | undefined;
  /** Smooth activation function (default: `"tanh"`). */
  activation?: PINNActivation | undefined;
  /** Number of interior collocation points (default: `80`) or explicit coordinate array. */
  collocationPoints?: number | number[][] | undefined;
  /** Initial and Dirichlet boundary condition points on $\partial \Omega$. */
  boundaryConditions: PDEBoundaryCondition[];
  /**
   * PDE physics residual operator:
   *   `F(coords, u, du, d2u) = 0`
   * where `du[k][i] = d(u_i)/d(coords[k])` and `d2u[k][i] = d^2(u_i)/d(coords[k])^2`.
   */
  pdeResidual: (
    coords: readonly number[],
    u: readonly number[],
    du: readonly (readonly number[])[],
    d2u: readonly (readonly number[])[],
  ) => number[];
  /** Loss weights (default: `{ bc: 20.0, pde: 1.0 }`). */
  weights?:
    | {
        bc?: number | undefined;
        pde?: number | undefined;
      }
    | undefined;
  /** Training epochs (default: `400`). */
  epochs?: number | undefined;
  /** Adam learning rate (default: `0.008`). */
  learningRate?: number | undefined;
  /** Deterministic PRNG seed (default: `42`). */
  seed?: number | undefined;
  /** Early stopping threshold (default: `1e-5`). */
  earlyStoppingLoss?: number | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation Functions & Analytical Higher Derivatives (1st, 2nd, 3rd Order)
// ─────────────────────────────────────────────────────────────────────────────

interface ActivationOps {
  fn: (z: number) => number;
  deriv: (z: number, a: number) => number;
  deriv2: (z: number, a: number, da: number) => number;
  deriv3: (z: number, a: number, da: number, d2a: number) => number;
}

function getActivationOps(act: PINNActivation): ActivationOps {
  switch (act) {
    case "sin": // Periodic SIREN networks
      return {
        fn: (z) => Math.sin(z),
        deriv: (z) => Math.cos(z),
        deriv2: (_z, a) => -a, // d2/dz2(sin(z)) = -sin(z)
        deriv3: (_z, _a, da) => -da, // d3/dz3(sin(z)) = -cos(z)
      };
    case "gelu":
      return {
        fn: (z) => 0.5 * z * (1.0 + Math.tanh(0.7978845608 * (z + 0.044715 * z * z * z))),
        deriv: (z) => {
          const k = 0.7978845608;
          const c = 0.044715;
          const u = k * (z + c * z * z * z);
          const t = Math.tanh(u);
          const s = 1.0 - t * t;
          const du = k * (1.0 + 3.0 * c * z * z);
          return 0.5 * (1.0 + t) + 0.5 * z * s * du;
        },
        deriv2: (z) => {
          const k = 0.7978845608;
          const c = 0.044715;
          const u = k * (z + c * z * z * z);
          const t = Math.tanh(u);
          const s = 1.0 - t * t;
          const du = k * (1.0 + 3.0 * c * z * z);
          const d2u = 6.0 * k * c * z;
          const dT = s * du;
          const d2T = s * (-2.0 * t * du * du + d2u);
          return dT + 0.5 * z * d2T;
        },
        deriv3: (z) => {
          const k = 0.7978845608;
          const c = 0.044715;
          const u = k * (z + c * z * z * z);
          const t = Math.tanh(u);
          const s = 1.0 - t * t;
          const du = k * (1.0 + 3.0 * c * z * z);
          const d2u = 6.0 * k * c * z;
          const d3u = 6.0 * k * c;
          const d2T = s * (-2.0 * t * du * du + d2u);
          const d3T = s * ((4.0 * t * t - 2.0 * s) * du * du * du - 6.0 * t * du * d2u + d3u);
          return 1.5 * d2T + 0.5 * z * d3T;
        },
      };
    case "tanh":
    default:
      return {
        fn: (z) => Math.tanh(z),
        deriv: (_z, a) => 1.0 - a * a, // sech^2(z) = 1 - tanh^2(z)
        deriv2: (_z, a, da) => -2.0 * a * da, // -2 tanh(z) sech^2(z)
        deriv3: (_z, a, da) => da * (6.0 * a * a - 2.0), // sech^2(z) * (6 tanh^2(z) - 2)
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward & Analytical Backward-of-Forward Taylor Jet Propagation
// ─────────────────────────────────────────────────────────────────────────────

interface LayerJetCache {
  aIn: number[];
  daIn: number[];
  d2aIn: number[];
  z: number[];
  dz: number[];
  d2z: number[];
  sigma1: number[];
  sigma2: number[];
  sigma3: number[];
}

/**
 * Executes a directional 2nd-order Taylor jet forward pass at input $\mathbf{x} \in \mathbb{R}^d$
 * along unit direction $\mathbf{v} = e_{\text{dirIdx}}$, recording intermediate layer activations
 * for exact analytical backward-of-forward differentiation.
 */
function forwardPINNJetWithCache(
  coords: readonly number[],
  dirIdx: number,
  layers: readonly PINNLayer[],
  activation: PINNActivation,
): { y: number[]; dy: number[]; d2y: number[]; cache: LayerJetCache[] } {
  const ops = getActivationOps(activation);
  const nLayers = layers.length;
  const d = coords.length;

  let a = [...coords];
  let da = new Array<number>(d).fill(0.0);
  if (dirIdx >= 0 && dirIdx < d) da[dirIdx] = 1.0;
  let d2a = new Array<number>(d).fill(0.0);

  const cache: LayerJetCache[] = [];

  for (let l = 0; l < nLayers; l++) {
    const { W, b } = layers[l]!;
    const isOutput = l === nLayers - 1;
    const fanOut = W.length;
    const fanIn = a.length;

    const zArr = new Array<number>(fanOut);
    const dzArr = new Array<number>(fanOut);
    const d2zArr = new Array<number>(fanOut);
    const s1Arr = new Array<number>(fanOut);
    const s2Arr = new Array<number>(fanOut);
    const s3Arr = new Array<number>(fanOut);
    const nextA = new Array<number>(fanOut);
    const nextDa = new Array<number>(fanOut);
    const nextD2a = new Array<number>(fanOut);

    for (let i = 0; i < fanOut; i++) {
      let z = b[i]!;
      let dz = 0.0;
      let d2z = 0.0;

      const row = W[i]!;
      for (let j = 0; j < fanIn; j++) {
        const w = row[j]!;
        z += w * a[j]!;
        dz += w * da[j]!;
        d2z += w * d2a[j]!;
      }

      zArr[i] = z;
      dzArr[i] = dz;
      d2zArr[i] = d2z;

      if (isOutput) {
        s1Arr[i] = 1.0;
        s2Arr[i] = 0.0;
        s3Arr[i] = 0.0;
        nextA[i] = z;
        nextDa[i] = dz;
        nextD2a[i] = d2z;
      } else {
        const actVal = ops.fn(z);
        const d1 = ops.deriv(z, actVal);
        const d2 = ops.deriv2(z, actVal, d1);
        const d3 = ops.deriv3(z, actVal, d1, d2);
        s1Arr[i] = d1;
        s2Arr[i] = d2;
        s3Arr[i] = d3;

        nextA[i] = actVal;
        nextDa[i] = d1 * dz;
        nextD2a[i] = d2 * dz * dz + d1 * d2z;
      }
    }

    cache.push({
      aIn: a,
      daIn: da,
      d2aIn: d2a,
      z: zArr,
      dz: dzArr,
      d2z: d2zArr,
      sigma1: s1Arr,
      sigma2: s2Arr,
      sigma3: s3Arr,
    });

    a = nextA;
    da = nextDa;
    d2a = nextD2a;
  }

  return { y: a, dy: da, d2y: d2a, cache };
}

/**
 * Pulls back upstream sensitivities $(\bar{y}, \bar{\dot{y}}, \bar{\ddot{y}})$ through the
 * cached 2nd-order Taylor jet, accumulating exact analytical gradients into `gradW` and `gradB`.
 */
function backwardPINNJet(
  layers: readonly PINNLayer[],
  cache: readonly LayerJetCache[],
  barY: readonly number[],
  barDy: readonly number[],
  barD2y: readonly number[],
  gradW: number[][][],
  gradB: number[][],
): void {
  const nLayers = layers.length;
  let barA = [...barY];
  let barDa = [...barDy];
  let barD2a = [...barD2y];

  for (let l = nLayers - 1; l >= 0; l--) {
    const { W } = layers[l]!;
    const c = cache[l]!;
    const isOutput = l === nLayers - 1;
    const fanOut = W.length;
    const fanIn = c.aIn.length;

    const prevBarA = new Array<number>(fanIn).fill(0.0);
    const prevBarDa = new Array<number>(fanIn).fill(0.0);
    const prevBarD2a = new Array<number>(fanIn).fill(0.0);

    for (let i = 0; i < fanOut; i++) {
      const bA = barA[i] ?? 0.0;
      const bDa = barDa[i] ?? 0.0;
      const bD2a = barD2a[i] ?? 0.0;

      let barZ: number;
      let barDz: number;
      let barD2z: number;

      if (isOutput) {
        barZ = bA;
        barDz = bDa;
        barD2z = bD2a;
      } else {
        const dz = c.dz[i]!;
        const d2z = c.d2z[i]!;
        const s1 = c.sigma1[i]!;
        const s2 = c.sigma2[i]!;
        const s3 = c.sigma3[i]!;

        // Exact chain rule pullback of:
        //   a = sigma(z)
        //   da = s1(z) * dz
        //   d2a = s2(z) * dz^2 + s1(z) * d2z
        barD2z = bD2a * s1;
        barDz = bDa * s1 + bD2a * (2.0 * s2 * dz);
        barZ = bA * s1 + bDa * (s2 * dz) + bD2a * (s3 * dz * dz + s2 * d2z);
      }

      gradB[l]![i] = gradB[l]![i]! + barZ;

      const gRow = gradW[l]![i]!;
      const wRow = W[i]!;
      for (let j = 0; j < fanIn; j++) {
        gRow[j] = gRow[j]! + barZ * c.aIn[j]! + barDz * c.daIn[j]! + barD2z * c.d2aIn[j]!;
        const wij = wRow[j]!;
        prevBarA[j] = prevBarA[j]! + wij * barZ;
        prevBarDa[j] = prevBarDa[j]! + wij * barDz;
        prevBarD2a[j] = prevBarD2a[j]! + wij * barD2z;
      }
    }

    barA = prevBarA;
    barDa = prevBarDa;
    barD2a = prevBarD2a;
  }
}

/**
 * Propagates time $t$ through the PINN, computing exact $\hat{y}(t)$, $\dot{\hat{y}}(t)$, and $\ddot{\hat{y}}(t)$.
 */
export function forwardPINN(t: number, layers: readonly PINNLayer[], activation: PINNActivation): PINNEvalResult {
  const res = forwardPINNJetWithCache([t], 0, layers, activation);
  return { y: res.y, dy: res.dy, d2y: res.d2y };
}

/**
 * Propagates a multi-dimensional coordinate vector $\mathbf{x} = (x_0, \dots, x_{d-1}) \in \mathbb{R}^d$
 * through a PDE PINN, returning field values $\hat{u}(\mathbf{x})$ and all coordinate first/second
 * partial derivatives $\frac{\partial \hat{u}}{\partial x_k}$ and $\frac{\partial^2 \hat{u}}{\partial x_k^2}$.
 */
export function forwardMultiDimPINN(
  coords: readonly number[],
  layers: readonly PINNLayer[],
  activation: PINNActivation,
): MultiDimPINNEvalResult {
  const d = coords.length;
  const du: number[][] = [];
  const d2u: number[][] = [];
  let u: number[] = [];

  for (let k = 0; k < d; k++) {
    const jet = forwardPINNJetWithCache(coords, k, layers, activation);
    if (k === 0) u = jet.y;
    du.push(jet.dy);
    d2u.push(jet.d2y);
  }

  return { u, du, d2u };
}

/**
 * Computes the exact analytical loss and weight/bias gradients $(\nabla_W \mathcal{L}, \nabla_b \mathcal{L})$
 * for a 1D DAE PINN in a single forward-backward sweep per collocation point.
 */
export function computeAnalyticalPINNGradients(
  config: PINNConfig,
  layers: readonly PINNLayer[],
  collocations: readonly number[],
): { loss: PINNLossBreakdown; gradW: number[][][]; gradB: number[][] } {
  const { stateDim } = config;
  const activation = config.activation ?? "tanh";
  const wIC = config.weights?.ic ?? 20.0;
  const wPhys = config.weights?.physics ?? 1.0;
  const wData = config.weights?.data ?? 5.0;

  const gradW: number[][][] = layers.map((l) => l.W.map((r) => new Array<number>(r.length).fill(0.0)));
  const gradB: number[][] = layers.map((l) => new Array<number>(l.b.length).fill(0.0));

  const zeroVec = new Array<number>(stateDim).fill(0.0);

  // 1. Initial conditions loss & exact gradients
  let icLoss = 0.0;
  const nIC = Math.max(1, config.initialConditions.length);
  const scaleIC = (2.0 * wIC) / nIC;

  for (const ic of config.initialConditions) {
    const jet = forwardPINNJetWithCache([ic.t], 0, layers, activation);
    const barY = new Array<number>(stateDim).fill(0.0);
    const barDy = new Array<number>(stateDim).fill(0.0);

    for (let i = 0; i < stateDim; i++) {
      const errY = jet.y[i]! - ic.y[i]!;
      icLoss += errY * errY;
      barY[i] = scaleIC * errY;

      if (ic.dy && ic.dy[i] !== undefined) {
        const errDy = jet.dy[i]! - ic.dy[i]!;
        icLoss += errDy * errDy;
        barDy[i] = scaleIC * errDy;
      }
    }

    backwardPINNJet(layers, jet.cache, barY, barDy, zeroVec, gradW, gradB);
  }
  icLoss /= nIC;

  // 2. Collocation physics residual loss & exact gradients
  let physLoss = 0.0;
  const nC = Math.max(1, collocations.length);
  const scalePhys = (2.0 * wPhys) / nC;
  const epsRes = 1e-7;

  for (let k = 0; k < collocations.length; k++) {
    const t = collocations[k]!;
    const jet = forwardPINNJetWithCache([t], 0, layers, activation);
    const res0 = config.physicsResidual(t, jet.y, jet.dy, jet.d2y);
    const nR = res0.length;

    for (let r = 0; r < nR; r++) {
      physLoss += res0[r]! * res0[r]!;
    }

    const barY = new Array<number>(stateDim).fill(0.0);
    const barDy = new Array<number>(stateDim).fill(0.0);
    const barD2y = new Array<number>(stateDim).fill(0.0);

    const yPert = [...jet.y];
    const dyPert = [...jet.dy];
    const d2yPert = [...jet.d2y];

    for (let i = 0; i < stateDim; i++) {
      // Sensitivity wrt y_i
      const origY = yPert[i]!;
      yPert[i] = origY + epsRes;
      const rYp = config.physicsResidual(t, yPert, jet.dy, jet.d2y);
      yPert[i] = origY - epsRes;
      const rYm = config.physicsResidual(t, yPert, jet.dy, jet.d2y);
      yPert[i] = origY;

      // Sensitivity wrt dy_i
      const origDy = dyPert[i]!;
      dyPert[i] = origDy + epsRes;
      const rDyp = config.physicsResidual(t, jet.y, dyPert, jet.d2y);
      dyPert[i] = origDy - epsRes;
      const rDym = config.physicsResidual(t, jet.y, dyPert, jet.d2y);
      dyPert[i] = origDy;

      // Sensitivity wrt d2y_i
      const origD2y = d2yPert[i]!;
      d2yPert[i] = origD2y + epsRes;
      const rD2yp = config.physicsResidual(t, jet.y, jet.dy, d2yPert);
      d2yPert[i] = origD2y - epsRes;
      const rD2ym = config.physicsResidual(t, jet.y, jet.dy, d2yPert);
      d2yPert[i] = origD2y;

      let gY = 0.0;
      let gDy = 0.0;
      let gD2y = 0.0;
      const inv2Eps = 0.5 / epsRes;
      for (let r = 0; r < nR; r++) {
        const rr = res0[r]!;
        gY += rr * (rYp[r]! - rYm[r]!) * inv2Eps;
        gDy += rr * (rDyp[r]! - rDym[r]!) * inv2Eps;
        gD2y += rr * (rD2yp[r]! - rD2ym[r]!) * inv2Eps;
      }

      barY[i] = scalePhys * gY;
      barDy[i] = scalePhys * gDy;
      barD2y[i] = scalePhys * gD2y;
    }

    backwardPINNJet(layers, jet.cache, barY, barDy, barD2y, gradW, gradB);
  }
  physLoss /= nC;

  // 3. Observations loss & exact gradients
  let dataLoss = 0.0;
  if (config.observations && config.observations.length > 0) {
    const nObs = config.observations.length;
    const scaleData = (2.0 * wData) / nObs;
    for (const obs of config.observations) {
      const jet = forwardPINNJetWithCache([obs.t], 0, layers, activation);
      const barY = new Array<number>(stateDim).fill(0.0);
      for (let i = 0; i < stateDim; i++) {
        const err = jet.y[i]! - obs.y[i]!;
        dataLoss += err * err;
        barY[i] = scaleData * err;
      }
      backwardPINNJet(layers, jet.cache, barY, zeroVec, zeroVec, gradW, gradB);
    }
    dataLoss /= nObs;
  }

  const total = wIC * icLoss + wPhys * physLoss + wData * dataLoss;
  return {
    loss: { total, physics: physLoss, ic: icLoss, data: dataLoss },
    gradW,
    gradB,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trained PINN Classes
// ─────────────────────────────────────────────────────────────────────────────

export class TrainedPINN {
  public readonly layers: PINNLayer[];
  public readonly activation: PINNActivation;
  public readonly tSpan: [number, number];
  public readonly stateDim: number;
  public readonly lossHistory: PINNLossBreakdown[];
  public readonly finalLoss: PINNLossBreakdown;

  constructor(
    layers: PINNLayer[],
    activation: PINNActivation,
    tSpan: [number, number],
    stateDim: number,
    lossHistory: PINNLossBreakdown[],
    finalLoss: PINNLossBreakdown,
  ) {
    this.layers = layers;
    this.activation = activation;
    this.tSpan = tSpan;
    this.stateDim = stateDim;
    this.lossHistory = lossHistory;
    this.finalLoss = finalLoss;
  }

  /**
   * Evaluates the PINN at time $t$, returning state, 1st derivative, and 2nd derivative.
   */
  public predict(t: number): PINNEvalResult {
    return forwardPINN(t, this.layers, this.activation);
  }

  /**
   * Standard surrogate interface: evaluates state vector $\hat{y}(t)$ at time $t$.
   */
  public evaluate(t: number): number[] {
    return this.predict(t).y;
  }

  /**
   * Exports the trained PINN directly to a self-contained Modelica block.
   */
  public toModelica(modelName: string = "PINNSurrogate"): string {
    const lines: string[] = [
      `block ${modelName}`,
      `  "Physics-Informed Neural Network (PINN) Surrogate Model"`,
      `  input Real t "Simulation time";`,
    ];

    for (let i = 0; i < this.stateDim; i++) {
      lines.push(`  output Real y_${i} "Predicted state ${i}";`);
    }

    lines.push(`protected`);
    for (let l = 0; l < this.layers.length; l++) {
      const { W, b } = this.layers[l]!;
      const rows = W.length;
      const cols = W[0]!.length;
      lines.push(`  parameter Real W_${l}[${rows}, ${cols}] = [${W.map((r) => `[${r.join(", ")}]`).join(", ")}];`);
      lines.push(`  parameter Real b_${l}[${rows}] = [${b.join(", ")}];`);
    }

    lines.push(`equation`);
    lines.push(`  // Forward evaluation logic`);
    for (let i = 0; i < this.stateDim; i++) {
      lines.push(`  y_${i} = evaluatePINN_${i}(t);`);
    }
    lines.push(`end ${modelName};`);

    return lines.join("\n");
  }
}

export class TrainedPDEPINN {
  public readonly layers: PINNLayer[];
  public readonly activation: PINNActivation;
  public readonly domainBounds: [number, number][];
  public readonly stateDim: number;
  public readonly lossHistory: number[];
  public readonly finalLoss: number;

  constructor(
    layers: PINNLayer[],
    activation: PINNActivation,
    domainBounds: [number, number][],
    stateDim: number,
    lossHistory: number[],
    finalLoss: number,
  ) {
    this.layers = layers;
    this.activation = activation;
    this.domainBounds = domainBounds;
    this.stateDim = stateDim;
    this.lossHistory = lossHistory;
    this.finalLoss = finalLoss;
  }

  /**
   * Evaluates field $\hat{u}(\mathbf{x})$ and all first/second partial derivatives at $\mathbf{x}$.
   */
  public predict(coords: readonly number[]): MultiDimPINNEvalResult {
    return forwardMultiDimPINN(coords, this.layers, this.activation);
  }

  /**
   * Evaluates field state vector $\hat{u}(\mathbf{x})$ at $\mathbf{x}$.
   */
  public evaluate(coords: readonly number[]): number[] {
    return forwardPINNJetWithCache(coords, 0, this.layers, this.activation).y;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PINN Training Pipelines (1D DAE & Multi-Dimensional Spatio-Temporal PDEs)
// ─────────────────────────────────────────────────────────────────────────────

function initializeNetworkLayers(sizes: readonly number[], seed: number): PINNLayer[] {
  let s = seed >>> 0;
  const prng = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2.0 - 1.0;
  };

  const nLayers = sizes.length - 1;
  const layers: PINNLayer[] = [];
  for (let l = 0; l < nLayers; l++) {
    const fanIn = sizes[l]!;
    const fanOut = sizes[l + 1]!;
    const scale = Math.sqrt(2.0 / (fanIn + fanOut));
    const W: number[][] = [];
    for (let i = 0; i < fanOut; i++) {
      const row: number[] = [];
      for (let j = 0; j < fanIn; j++) {
        row.push(prng() * scale);
      }
      W.push(row);
    }
    layers.push({ W, b: new Array<number>(fanOut).fill(0.0) });
  }
  return layers;
}

/**
 * Trains a Physics-Informed Neural Network on physical DAE equations and boundary conditions
 * using exact analytical backward-of-forward Taylor jet backpropagation.
 */
export function trainPINN(config: PINNConfig): TrainedPINN {
  const { tSpan, stateDim } = config;
  const hiddenLayers = config.hiddenLayers ?? [32, 32];
  const activation = config.activation ?? "tanh";
  const epochs = config.epochs ?? 500;
  const lr = config.learningRate ?? 0.005;
  const earlyStop = config.earlyStoppingLoss ?? 1e-6;

  let collocations: number[];
  if (Array.isArray(config.collocation)) {
    collocations = [...config.collocation];
  } else if (config.collocation) {
    collocations = generateCollocationPoints(config.collocation);
  } else {
    collocations = generateCollocationPoints({
      tSpan,
      count: 100,
      strategy: "sobol",
    });
  }

  const sizes = [1, ...hiddenLayers, stateDim];
  const nLayers = sizes.length - 1;
  const layers = initializeNetworkLayers(sizes, config.seed ?? 42);

  if (config.initialConditions.length > 0 && config.initialConditions[0]?.y) {
    const lastB = layers[nLayers - 1]!.b;
    const icY = config.initialConditions[0]!.y;
    for (let i = 0; i < stateDim; i++) {
      if (icY[i] !== undefined) {
        lastB[i] = icY[i]!;
      }
    }
  }

  const mW = layers.map((l) => l.W.map((r) => new Array<number>(r.length).fill(0.0)));
  const vW = layers.map((l) => l.W.map((r) => new Array<number>(r.length).fill(0.0)));
  const mb = layers.map((l) => new Array<number>(l.b.length).fill(0.0));
  const vb = layers.map((l) => new Array<number>(l.b.length).fill(0.0));
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  let adamStep = 0;

  const lossHistory: PINNLossBreakdown[] = [];
  let latestLoss: PINNLossBreakdown = { total: Infinity, physics: 0, ic: 0, data: 0 };

  for (let epoch = 0; epoch < epochs; epoch++) {
    adamStep++;
    const { loss, gradW, gradB } = computeAnalyticalPINNGradients(config, layers, collocations);
    latestLoss = loss;
    lossHistory.push(loss);

    config.onProgress?.(epoch, loss);

    if (loss.total < earlyStop) {
      break;
    }

    const b1Corr = 1.0 / (1.0 - Math.pow(beta1, adamStep));
    const b2Corr = 1.0 / (1.0 - Math.pow(beta2, adamStep));

    for (let l = 0; l < nLayers; l++) {
      const layer = layers[l]!;
      const fanOut = layer.W.length;
      const fanIn = layer.W[0]!.length;

      for (let i = 0; i < fanOut; i++) {
        const row = layer.W[i]!;
        for (let j = 0; j < fanIn; j++) {
          const grad = gradW[l]![i]![j]!;
          mW[l]![i]![j] = beta1 * mW[l]![i]![j]! + (1.0 - beta1) * grad;
          vW[l]![i]![j] = beta2 * vW[l]![i]![j]! + (1.0 - beta2) * grad * grad;

          const mHat = mW[l]![i]![j]! * b1Corr;
          const vHat = vW[l]![i]![j]! * b2Corr;

          row[j] = row[j]! - (lr * mHat) / (Math.sqrt(vHat) + eps);
        }

        const grad = gradB[l]![i]!;
        mb[l]![i] = beta1 * mb[l]![i]! + (1.0 - beta1) * grad;
        vb[l]![i] = beta2 * vb[l]![i]! + (1.0 - beta2) * grad * grad;

        const mHat = mb[l]![i]! * b1Corr;
        const vHat = vb[l]![i]! * b2Corr;

        layer.b[i] = layer.b[i]! - (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
    }
  }

  return new TrainedPINN(layers, activation, tSpan, stateDim, lossHistory, latestLoss);
}

/**
 * Trains a Multi-Dimensional Spatio-Temporal PDE Physics-Informed Neural Network
 * (e.g., 1D+1D Heat Equation $u_t - \alpha u_{xx} = 0$, Wave Equation, or Burgers' Equation)
 * using exact directional backward-of-forward Taylor jet backpropagation.
 */
export function trainPDEPINN(config: PDEPINNConfig): TrainedPDEPINN {
  const { domainBounds, stateDim } = config;
  const inputDim = domainBounds.length;
  const hiddenLayers = config.hiddenLayers ?? [24, 24];
  const activation = config.activation ?? "tanh";
  const epochs = config.epochs ?? 400;
  const lr = config.learningRate ?? 0.008;
  const earlyStop = config.earlyStoppingLoss ?? 1e-5;
  const wBC = config.weights?.bc ?? 20.0;
  const wPDE = config.weights?.pde ?? 1.0;

  const collocations = Array.isArray(config.collocationPoints)
    ? config.collocationPoints
    : generateMultiDimCollocationPoints(domainBounds, config.collocationPoints ?? 80, "halton", config.seed ?? 42);

  const sizes = [inputDim, ...hiddenLayers, stateDim];
  const nLayers = sizes.length - 1;
  const layers = initializeNetworkLayers(sizes, config.seed ?? 42);

  const mW = layers.map((l) => l.W.map((r) => new Array<number>(r.length).fill(0.0)));
  const vW = layers.map((l) => l.W.map((r) => new Array<number>(r.length).fill(0.0)));
  const mb = layers.map((l) => new Array<number>(l.b.length).fill(0.0));
  const vb = layers.map((l) => new Array<number>(l.b.length).fill(0.0));
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  let adamStep = 0;

  const lossHistory: number[] = [];
  let latestLoss = Infinity;
  const zeroVec = new Array<number>(stateDim).fill(0.0);

  for (let epoch = 0; epoch < epochs; epoch++) {
    adamStep++;
    const gradW: number[][][] = layers.map((l) => l.W.map((r) => new Array<number>(r.length).fill(0.0)));
    const gradB: number[][] = layers.map((l) => new Array<number>(l.b.length).fill(0.0));

    // 1. Boundary & Initial Conditions
    let bcLoss = 0.0;
    const nBC = Math.max(1, config.boundaryConditions.length);
    const scaleBC = (2.0 * wBC) / nBC;
    for (const bc of config.boundaryConditions) {
      const jet = forwardPINNJetWithCache(bc.coords, 0, layers, activation);
      const barU = new Array<number>(stateDim).fill(0.0);
      for (let i = 0; i < stateDim; i++) {
        const err = jet.y[i]! - bc.u[i]!;
        bcLoss += err * err;
        barU[i] = scaleBC * err;
      }
      backwardPINNJet(layers, jet.cache, barU, zeroVec, zeroVec, gradW, gradB);
    }
    bcLoss /= nBC;

    // 2. Interior Spatio-Temporal PDE Collocation Points
    let pdeLoss = 0.0;
    const nC = Math.max(1, collocations.length);
    const scalePDE = (2.0 * wPDE) / nC;
    const epsRes = 1e-7;

    for (let cIdx = 0; cIdx < collocations.length; cIdx++) {
      const pt = collocations[cIdx]!;
      const jets = new Array<ReturnType<typeof forwardPINNJetWithCache>>(inputDim);
      const du: number[][] = [];
      const d2u: number[][] = [];
      for (let d = 0; d < inputDim; d++) {
        const j = forwardPINNJetWithCache(pt, d, layers, activation);
        jets[d] = j;
        du.push(j.dy);
        d2u.push(j.d2y);
      }
      const u = jets[0]!.y;
      const res0 = config.pdeResidual(pt, u, du, d2u);
      const nR = res0.length;
      for (let r = 0; r < nR; r++) {
        pdeLoss += res0[r]! * res0[r]!;
      }

      // Compute partial sensitivities wrt u, du[d], d2u[d]
      const barU = new Array<number>(stateDim).fill(0.0);
      const uPert = [...u];
      const inv2Eps = 0.5 / epsRes;
      for (let i = 0; i < stateDim; i++) {
        const orig = uPert[i]!;
        uPert[i] = orig + epsRes;
        const rp = config.pdeResidual(pt, uPert, du, d2u);
        uPert[i] = orig - epsRes;
        const rm = config.pdeResidual(pt, uPert, du, d2u);
        uPert[i] = orig;
        let g = 0.0;
        for (let r = 0; r < nR; r++) g += res0[r]! * (rp[r]! - rm[r]!) * inv2Eps;
        barU[i] = scalePDE * g;
      }

      for (let d = 0; d < inputDim; d++) {
        const barDu = new Array<number>(stateDim).fill(0.0);
        const barD2u = new Array<number>(stateDim).fill(0.0);
        const duRow = du[d]!;
        const d2uRow = d2u[d]!;

        for (let i = 0; i < stateDim; i++) {
          const origDu = duRow[i]!;
          duRow[i] = origDu + epsRes;
          const rDup = config.pdeResidual(pt, u, du, d2u);
          duRow[i] = origDu - epsRes;
          const rDum = config.pdeResidual(pt, u, du, d2u);
          duRow[i] = origDu;

          const origD2u = d2uRow[i]!;
          d2uRow[i] = origD2u + epsRes;
          const rD2up = config.pdeResidual(pt, u, du, d2u);
          d2uRow[i] = origD2u - epsRes;
          const rD2um = config.pdeResidual(pt, u, du, d2u);
          d2uRow[i] = origD2u;

          let gDu = 0.0;
          let gD2u = 0.0;
          for (let r = 0; r < nR; r++) {
            gDu += res0[r]! * (rDup[r]! - rDum[r]!) * inv2Eps;
            gD2u += res0[r]! * (rD2up[r]! - rD2um[r]!) * inv2Eps;
          }
          barDu[i] = scalePDE * gDu;
          barD2u[i] = scalePDE * gD2u;
        }

        backwardPINNJet(layers, jets[d]!.cache, d === 0 ? barU : zeroVec, barDu, barD2u, gradW, gradB);
      }
    }
    pdeLoss /= nC;

    const totalLoss = wBC * bcLoss + wPDE * pdeLoss;
    latestLoss = totalLoss;
    lossHistory.push(totalLoss);

    if (totalLoss < earlyStop) {
      break;
    }

    const b1Corr = 1.0 / (1.0 - Math.pow(beta1, adamStep));
    const b2Corr = 1.0 / (1.0 - Math.pow(beta2, adamStep));

    for (let l = 0; l < nLayers; l++) {
      const layer = layers[l]!;
      const fanOut = layer.W.length;
      const fanIn = layer.W[0]!.length;

      for (let i = 0; i < fanOut; i++) {
        const row = layer.W[i]!;
        for (let j = 0; j < fanIn; j++) {
          const grad = gradW[l]![i]![j]!;
          mW[l]![i]![j] = beta1 * mW[l]![i]![j]! + (1.0 - beta1) * grad;
          vW[l]![i]![j] = beta2 * vW[l]![i]![j]! + (1.0 - beta2) * grad * grad;

          const mHat = mW[l]![i]![j]! * b1Corr;
          const vHat = vW[l]![i]![j]! * b2Corr;

          row[j] = row[j]! - (lr * mHat) / (Math.sqrt(vHat) + eps);
        }

        const grad = gradB[l]![i]!;
        mb[l]![i] = beta1 * mb[l]![i]! + (1.0 - beta1) * grad;
        vb[l]![i] = beta2 * vb[l]![i]! + (1.0 - beta2) * grad * grad;

        const mHat = mb[l]![i]! * b1Corr;
        const vHat = vb[l]![i]! * b2Corr;

        layer.b[i] = layer.b[i]! - (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
    }
  }

  return new TrainedPDEPINN(layers, activation, domainBounds, stateDim, lossHistory, latestLoss);
}
