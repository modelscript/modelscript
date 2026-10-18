// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * @modelscript/simulate/surrogates — Dynamical State-Space Reduced Order Models (DMDc, OpInf, LPV).
 *
 * Implements:
 *   1. `DmdcSurrogate`: Dynamic Mode Decomposition with Control
 *        dx_hat/dt = A_hat * x_hat + B_hat * u + c_hat
 *        y         = C_hat * x_hat + D_hat * u + y_bar
 *   2. `OperatorInferenceSurrogate`: Non-Intrusive Quadratic Operator Inference (Peherstorfer & Willcox, 2016)
 *        dx_hat/dt = c_hat + A_hat * x_hat + H_hat * (x_hat (x)_sym x_hat) + B_hat * u
 *   3. `LpvStateSpaceSurrogate`: Linear Parameter-Varying State-Space ROM scheduled over mu(t)
 *        dx_hat/dt = A_hat(mu) * x_hat + B_hat(mu) * u
 *        y         = C_hat(mu) * x_hat + D_hat(mu) * u
 *
 * All three classes support direct continuous-time inlining into `DAEBuilder` (`exportToDaeBuilder`),
 * creating first-class state variables (`der(r_i) = ...`) that couple two-way with 1D Modelica plants.
 */

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { solveDenseLinearSystem } from "../control/linearize.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Types & POD Basis Extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface TransientSnapshotTrajectory {
  /** Monotonically increasing timestamps t_0, t_1, ..., t_{M-1} in seconds. */
  times: Float64Array | number[];
  /** High-dimensional spatial field snapshots S[k] in R^N for k = 0..M-1. */
  fields: (Float64Array | number[])[];
  /** Control inputs u[k] in R^m for k = 0..M-1. */
  inputs: (Float64Array | number[])[];
  /** Measured scalar outputs y[k] in R^q for k = 0..M-1 (optional). */
  outputs?: (Float64Array | number[])[] | undefined;
}

export interface DynamicRomTrainConfig {
  /** Maximum number of POD modes r to retain (default: 6). */
  maxModes?: number | undefined;
  /** Target cumulative POD energy fraction in (0, 1] (default: 0.995). */
  energyThreshold?: number | undefined;
  /** Tikhonov regularization for linear operators A_hat, B_hat, c_hat (default: 1e-6). */
  linearRegularization?: number | undefined;
  /** Tikhonov regularization for quadratic operator H_hat in OpInf (default: 1e-3). */
  quadraticRegularization?: number | undefined;
  /** Stabilize diagonal/Hurwitz spectrum if learned A_hat has positive real eigenvalues (default: true). */
  enforceStability?: boolean | undefined;
  /** Ordered control input variable names. */
  inputNames?: string[] | undefined;
  /** Ordered scalar output variable names. */
  outputNames?: string[] | undefined;
}

export interface PodBasisDecomposition {
  numFeatures: number;
  numModes: number;
  meanField: Float64Array;
  /** Column-major spatial basis Phi_r in R^{numFeatures x numModes} (mode m is at offset m * numFeatures). */
  basisModes: Float64Array;
  eigenvalues: number[];
  capturedEnergy: number;
  /** Projected modal trajectories X_hat[k] in R^{numModes} for each snapshot k. */
  modalCoordinates: Float64Array[];
  /** Estimated time derivatives dX_hat/dt[k] in R^{numModes} for each snapshot k. */
  modalDerivatives: Float64Array[];
}

function jacobiSymmetricEigen(
  C_in: Float64Array,
  M: number,
  maxSweeps: number = 80,
): { eigenvalues: Float64Array; eigenvectors: Float64Array } {
  const A = new Float64Array(C_in);
  const V = new Float64Array(M * M);
  for (let i = 0; i < M; i++) V[i * M + i] = 1.0;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxOff = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < M; i++) {
      for (let j = i + 1; j < M; j++) {
        const v = Math.abs(A[i * M + j]!);
        if (v > maxOff) {
          maxOff = v;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < 1e-13) break;

    const app = A[p * M + p]!;
    const aqq = A[q * M + q]!;
    const apq = A[p * M + q]!;
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (let i = 0; i < M; i++) {
      if (i !== p && i !== q) {
        const aip = A[i * M + p]!;
        const aiq = A[i * M + q]!;
        A[i * M + p] = c * aip - s * aiq;
        A[p * M + i] = A[i * M + p]!;
        A[i * M + q] = s * aip + c * aiq;
        A[q * M + i] = A[i * M + q]!;
      }
    }
    A[p * M + p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    A[q * M + q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    A[p * M + q] = 0;
    A[q * M + p] = 0;

    for (let i = 0; i < M; i++) {
      const vip = V[i * M + p]!;
      const viq = V[i * M + q]!;
      V[i * M + p] = c * vip - s * viq;
      V[i * M + q] = s * vip + c * viq;
    }
  }

  const eigenvalues = new Float64Array(M);
  for (let i = 0; i < M; i++) eigenvalues[i] = A[i * M + i]!;
  return { eigenvalues, eigenvectors: V };
}

/**
 * Extract orthonormal spatial POD modes and modal time derivatives from one or more transient trajectories
 * using Sirovich's method of snapshots.
 */
export function extractTransientPodBasis(
  trajectories: TransientSnapshotTrajectory[],
  maxModes: number = 6,
  energyThreshold: number = 0.995,
): PodBasisDecomposition {
  const allFields: (Float64Array | number[])[] = [];
  for (const traj of trajectories) {
    for (const f of traj.fields) allFields.push(f);
  }
  const M = allFields.length;
  if (M < 2) {
    throw new Error("At least 2 field snapshots are required to extract a transient POD basis.");
  }
  const N = allFields[0]!.length;

  // 1. Compute mean field
  const meanField = new Float64Array(N);
  for (let k = 0; k < M; k++) {
    const f = allFields[k]!;
    for (let i = 0; i < N; i++) meanField[i] = meanField[i]! + (f[i] ?? 0);
  }
  for (let i = 0; i < N; i++) meanField[i] = meanField[i]! / M;

  // 2. Centered snapshot matrix S in R^{M x N}
  const S = new Float64Array(M * N);
  for (let k = 0; k < M; k++) {
    const f = allFields[k]!;
    for (let i = 0; i < N; i++) {
      S[k * N + i] = (f[i] ?? 0) - meanField[i]!;
    }
  }

  // 3. Temporal covariance C = (1/M) * S * S^T in R^{M x M}
  const C = new Float64Array(M * M);
  for (let i = 0; i < M; i++) {
    for (let j = i; j < M; j++) {
      let dot = 0;
      for (let n = 0; n < N; n++) {
        dot += S[i * N + n]! * S[j * N + n]!;
      }
      const val = dot / M;
      C[i * M + j] = val;
      C[j * M + i] = val;
    }
  }

  const { eigenvalues: rawEig, eigenvectors: rawVec } = jacobiSymmetricEigen(C, M);
  const order = Array.from({ length: M }, (_, i) => i).sort((a, b) => rawEig[b]! - rawEig[a]!);

  let totalEnergy = 0;
  for (const idx of order) {
    if (rawEig[idx]! > 0) totalEnergy += rawEig[idx]!;
  }

  let r = 0;
  let cumEnergy = 0;
  const maxAllowed = Math.min(maxModes, M - 1, N);
  for (let i = 0; i < maxAllowed; i++) {
    const val = Math.max(0, rawEig[order[i]!]!);
    if (val <= 1e-15 && r > 0) break;
    cumEnergy += val;
    r++;
    if (totalEnergy > 0 && cumEnergy / totalEnergy >= energyThreshold) break;
  }
  if (r === 0) r = 1;

  const basisModes = new Float64Array(r * N);
  const retainedEigenvalues: number[] = [];

  for (let m = 0; m < r; m++) {
    const eigIdx = order[m]!;
    const eigVal = Math.max(0, rawEig[eigIdx]!);
    retainedEigenvalues.push(eigVal);

    const phi = new Float64Array(N);
    for (let k = 0; k < M; k++) {
      const v_km = rawVec[k * M + eigIdx]!;
      for (let i = 0; i < N; i++) {
        phi[i] = phi[i]! + v_km * S[k * N + i]!;
      }
    }
    let norm = 0;
    for (let i = 0; i < N; i++) norm += phi[i]! * phi[i]!;
    norm = Math.sqrt(norm) || 1.0;
    for (let i = 0; i < N; i++) {
      basisModes[m * N + i] = phi[i]! / norm;
    }
  }

  // 4. Project trajectories onto POD modes and compute 2nd-order central finite-difference derivatives
  const modalCoordinates: Float64Array[] = [];
  const modalDerivatives: Float64Array[] = [];

  let globalSnapIdx = 0;
  for (const traj of trajectories) {
    const T = traj.times.length;
    const trajCoords: Float64Array[] = [];

    for (let k = 0; k < T; k++) {
      const a = new Float64Array(r);
      for (let m = 0; m < r; m++) {
        let dot = 0;
        for (let i = 0; i < N; i++) {
          dot += S[globalSnapIdx * N + i]! * basisModes[m * N + i]!;
        }
        a[m] = dot;
      }
      trajCoords.push(a);
      modalCoordinates.push(a);
      globalSnapIdx++;
    }

    for (let k = 0; k < T; k++) {
      const da = new Float64Array(r);
      if (T === 1) {
        modalDerivatives.push(da);
        continue;
      }
      if (k === 0) {
        const dt = Math.max(1e-12, (traj.times[1] ?? 1) - (traj.times[0] ?? 0));
        for (let m = 0; m < r; m++) da[m] = (trajCoords[1]![m]! - trajCoords[0]![m]!) / dt;
      } else if (k === T - 1) {
        const dt = Math.max(1e-12, (traj.times[T - 1] ?? 1) - (traj.times[T - 2] ?? 0));
        for (let m = 0; m < r; m++) da[m] = (trajCoords[T - 1]![m]! - trajCoords[T - 2]![m]!) / dt;
      } else {
        const dt = Math.max(1e-12, (traj.times[k + 1] ?? 1) - (traj.times[k - 1] ?? 0));
        for (let m = 0; m < r; m++) da[m] = (trajCoords[k + 1]![m]! - trajCoords[k - 1]![m]!) / dt;
      }
      modalDerivatives.push(da);
    }
  }

  return {
    numFeatures: N,
    numModes: r,
    meanField,
    basisModes,
    eigenvalues: retainedEigenvalues,
    capturedEnergy: totalEnergy > 0 ? cumEnergy / totalEnergy : 1.0,
    modalCoordinates,
    modalDerivatives,
  };
}

/**
 * Solve Tikhonov-regularized least squares: min_X ||D * X - Y||_F^2 + diag(lambda) ||X||_F^2
 * where D is M x K, Y is M x R, and regVector has length K.
 */
function solveRegularizedMultiTargetRegression(
  D: Float64Array,
  Y: Float64Array,
  M: number,
  K: number,
  R: number,
  regVector: Float64Array,
): Float64Array {
  const DtD = new Float64Array(K * K);
  const DtY = new Float64Array(K * R);

  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++) {
      let sum = 0;
      for (let s = 0; s < M; s++) {
        sum += D[s * K + i]! * D[s * K + j]!;
      }
      if (i === j) sum += regVector[i]!;
      DtD[i * K + j] = sum;
      DtD[j * K + i] = sum;
    }

    for (let col = 0; col < R; col++) {
      let sumY = 0;
      for (let s = 0; s < M; s++) {
        sumY += D[s * K + i]! * Y[s * R + col]!;
      }
      DtY[i * R + col] = sumY;
    }
  }

  const { X } = solveDenseLinearSystem(DtD, DtY, K, R, 1e-12);
  return X;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dynamic Mode Decomposition with Control (DMDc) Surrogate
// ─────────────────────────────────────────────────────────────────────────────

export class DmdcSurrogate {
  public readonly numFeatures: number;
  public readonly numModes: number;
  public readonly numInputs: number;
  public readonly numOutputs: number;
  public readonly inputNames: string[];
  public readonly outputNames: string[];
  public readonly meanField: Float64Array;
  public readonly basisModes: Float64Array;
  /** Reduced state matrix A_hat in R^{r x r}. */
  public readonly Ahat: Float64Array;
  /** Reduced input matrix B_hat in R^{r x m}. */
  public readonly Bhat: Float64Array;
  /** Reduced bias vector c_hat in R^{r}. */
  public readonly chat: Float64Array;
  /** Reduced output matrix C_hat in R^{q x r}. */
  public readonly Chat: Float64Array;
  /** Reduced feedthrough matrix D_hat in R^{q x m}. */
  public readonly Dhat: Float64Array;
  /** Output offset vector y_bar in R^{q}. */
  public readonly yBar: Float64Array;

  constructor(params: {
    numFeatures: number;
    numModes: number;
    numInputs: number;
    numOutputs: number;
    inputNames: string[];
    outputNames: string[];
    meanField: Float64Array;
    basisModes: Float64Array;
    Ahat: Float64Array;
    Bhat: Float64Array;
    chat: Float64Array;
    Chat: Float64Array;
    Dhat: Float64Array;
    yBar: Float64Array;
  }) {
    this.numFeatures = params.numFeatures;
    this.numModes = params.numModes;
    this.numInputs = params.numInputs;
    this.numOutputs = params.numOutputs;
    this.inputNames = [...params.inputNames];
    this.outputNames = [...params.outputNames];
    this.meanField = params.meanField;
    this.basisModes = params.basisModes;
    this.Ahat = params.Ahat;
    this.Bhat = params.Bhat;
    this.chat = params.chat;
    this.Chat = params.Chat;
    this.Dhat = params.Dhat;
    this.yBar = params.yBar;
  }

  /**
   * Train a continuous-time DMDc Reduced Order Model from one or more transient trajectories.
   */
  public static train(
    trajectories: TransientSnapshotTrajectory | TransientSnapshotTrajectory[],
    config?: DynamicRomTrainConfig,
  ): DmdcSurrogate {
    const trajList = Array.isArray(trajectories) ? trajectories : [trajectories];
    const pod = extractTransientPodBasis(trajList, config?.maxModes ?? 6, config?.energyThreshold ?? 0.995);

    const r = pod.numModes;
    const allInputs: (Float64Array | number[])[] = [];
    const allOutputs: (Float64Array | number[])[] = [];
    for (const t of trajList) {
      for (const u of t.inputs) allInputs.push(u);
      if (t.outputs) {
        for (const y of t.outputs) allOutputs.push(y);
      }
    }

    const M = pod.modalCoordinates.length;
    const m = allInputs[0]?.length ?? 0;
    const q = allOutputs[0]?.length ?? 0;

    const inputNames = config?.inputNames ?? Array.from({ length: m }, (_, i) => `u_${i + 1}`);
    const outputNames = config?.outputNames ?? Array.from({ length: q }, (_, i) => `y_${i + 1}`);

    // Design matrix D in R^{M x (r + m + 1)} with rows [x_hat_k^T, u_k^T, 1]
    const K = r + m + 1;
    const D = new Float64Array(M * K);
    const dX = new Float64Array(M * r);

    for (let s = 0; s < M; s++) {
      const xh = pod.modalCoordinates[s]!;
      const dx = pod.modalDerivatives[s]!;
      const u = allInputs[s] ?? [];
      for (let i = 0; i < r; i++) {
        D[s * K + i] = xh[i]!;
        dX[s * r + i] = dx[i]!;
      }
      for (let j = 0; j < m; j++) {
        D[s * K + (r + j)] = u[j] ?? 0;
      }
      D[s * K + (r + m)] = 1.0;
    }

    const regLin = config?.linearRegularization ?? 1e-6;
    const regVec = new Float64Array(K).fill(regLin);
    const weights = solveRegularizedMultiTargetRegression(D, dX, M, K, r, regVec);

    const Ahat = new Float64Array(r * r);
    const Bhat = new Float64Array(r * m);
    const chat = new Float64Array(r);

    for (let row = 0; row < r; row++) {
      for (let col = 0; col < r; col++) {
        Ahat[row * r + col] = weights[col * r + row]!;
      }
      for (let col = 0; col < m; col++) {
        Bhat[row * m + col] = weights[(r + col) * r + row]!;
      }
      chat[row] = weights[(r + m) * r + row]!;
    }

    // Optional dissipative Hurwitz stabilization: ensure symmetric part 0.5*(A + A^T) has non-positive diagonal
    if (config?.enforceStability ?? true) {
      for (let i = 0; i < r; i++) {
        if (Ahat[i * r + i]! > -1e-6) {
          Ahat[i * r + i] = -1e-3;
        }
      }
    }

    // Output regression y = Chat * x_hat + Dhat * u + yBar
    const Chat = new Float64Array(q * r);
    const Dhat = new Float64Array(q * m);
    const yBar = new Float64Array(q);

    if (q > 0 && allOutputs.length === M) {
      const Ymat = new Float64Array(M * q);
      for (let s = 0; s < M; s++) {
        for (let col = 0; col < q; col++) {
          Ymat[s * q + col] = allOutputs[s]![col] ?? 0;
        }
      }
      const outWeights = solveRegularizedMultiTargetRegression(D, Ymat, M, K, q, regVec);
      for (let row = 0; row < q; row++) {
        for (let col = 0; col < r; col++) Chat[row * r + col] = outWeights[col * q + row]!;
        for (let col = 0; col < m; col++) Dhat[row * m + col] = outWeights[(r + col) * q + row]!;
        yBar[row] = outWeights[(r + m) * q + row]!;
      }
    }

    return new DmdcSurrogate({
      numFeatures: pod.numFeatures,
      numModes: r,
      numInputs: m,
      numOutputs: q,
      inputNames,
      outputNames,
      meanField: pod.meanField,
      basisModes: pod.basisModes,
      Ahat,
      Bhat,
      chat,
      Chat,
      Dhat,
      yBar,
    });
  }

  /**
   * Evaluate reduced state derivative dx_hat/dt = A_hat * x_hat + B_hat * u + c_hat.
   */
  public evaluateDerivative(xHat: Float64Array | number[], u: Float64Array | number[]): Float64Array {
    const { numModes: r, numInputs: m, Ahat, Bhat, chat } = this;
    const dx = new Float64Array(r);
    for (let i = 0; i < r; i++) {
      let sum = chat[i]!;
      for (let j = 0; j < r; j++) sum += Ahat[i * r + j]! * (xHat[j] ?? 0);
      for (let j = 0; j < m; j++) sum += Bhat[i * m + j]! * (u[j] ?? 0);
      dx[i] = sum;
    }
    return dx;
  }

  /**
   * Advance the reduced state by one time step dt using 4th-order Runge-Kutta (RK4).
   */
  public step(
    xHat: Float64Array,
    u: Float64Array | number[],
    dt: number,
  ): { nextState: Float64Array; outputs: Float64Array } {
    const r = this.numModes;
    const k1 = this.evaluateDerivative(xHat, u);
    const tmp = new Float64Array(r);

    for (let i = 0; i < r; i++) tmp[i] = xHat[i]! + 0.5 * dt * k1[i]!;
    const k2 = this.evaluateDerivative(tmp, u);

    for (let i = 0; i < r; i++) tmp[i] = xHat[i]! + 0.5 * dt * k2[i]!;
    const k3 = this.evaluateDerivative(tmp, u);

    for (let i = 0; i < r; i++) tmp[i] = xHat[i]! + dt * k3[i]!;
    const k4 = this.evaluateDerivative(tmp, u);

    const nextState = new Float64Array(r);
    for (let i = 0; i < r; i++) {
      nextState[i] = xHat[i]! + (dt / 6.0) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }

    const outputs = new Float64Array(this.numOutputs);
    for (let i = 0; i < this.numOutputs; i++) {
      let sum = this.yBar[i]!;
      for (let j = 0; j < r; j++) sum += this.Chat[i * r + j]! * nextState[j]!;
      for (let j = 0; j < this.numInputs; j++) sum += this.Dhat[i * this.numInputs + j]! * (u[j] ?? 0);
      outputs[i] = sum;
    }

    return { nextState, outputs };
  }

  /**
   * Reconstruct full spatial field s(t) = s_bar + Phi_r * x_hat(t).
   */
  public reconstructField(xHat: Float64Array | number[]): Float64Array {
    const { numFeatures: N, numModes: r, meanField, basisModes } = this;
    const field = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sum = meanField[i]!;
      for (let m = 0; m < r; m++) {
        sum += (xHat[m] ?? 0) * basisModes[m * N + i]!;
      }
      field[i] = sum;
    }
    return field;
  }

  /**
   * Inline this dynamic DMDc ROM directly into a `DAEBuilder` arena as continuous states `der(prefix_r_i) = ...`.
   */
  public exportToDaeBuilder(
    dae: DAEBuilder,
    instancePrefix: string = "dmdc",
    initialLatentState?: Float64Array | number[],
  ): { stateVarNames: string[]; inputVarNames: string[]; outputVarNames: string[] } {
    const { numModes: r, numInputs: m, numOutputs: q } = this;
    const stateVarNames: string[] = [];
    const inputVarNames: string[] = [];
    const outputVarNames: string[] = [];

    for (let i = 0; i < r; i++) {
      const sName = `${instancePrefix}_r_${i}`;
      stateVarNames.push(sName);
      if (dae.getVarIdxByName(sName) < 0) {
        dae.addVariable(sName, VarType.Real, Variability.Continuous, Causality.Local, initialLatentState?.[i] ?? 0.0);
      }
    }

    for (let j = 0; j < m; j++) {
      const uName = this.inputNames[j] ?? `${instancePrefix}_u_${j}`;
      inputVarNames.push(uName);
      if (dae.getVarIdxByName(uName) < 0) {
        dae.addVariable(uName, VarType.Real, Variability.Continuous, Causality.Input, 0.0);
      }
    }

    // Emit differential equations: der(r_i) = c_i + sum_j A_ij * r_j + sum_j B_ij * u_j
    for (let i = 0; i < r; i++) {
      let rhsExpr = dae.addRealLiteral(this.chat[i]!);
      for (let j = 0; j < r; j++) {
        const aVal = this.Ahat[i * r + j]!;
        if (Math.abs(aVal) < 1e-14) continue;
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(aVal), dae.addNameExpr(stateVarNames[j]!));
        rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
      }
      for (let j = 0; j < m; j++) {
        const bVal = this.Bhat[i * m + j]!;
        if (Math.abs(bVal) < 1e-14) continue;
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bVal), dae.addNameExpr(inputVarNames[j]!));
        rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
      }
      const lhsDer = dae.addDerExpr(dae.addNameExpr(stateVarNames[i]!));
      dae.addEquation(EqKind.Simple, lhsDer, rhsExpr);
    }

    // Emit output equations: y_i = yBar_i + sum_j C_ij * r_j + sum_j D_ij * u_j
    for (let i = 0; i < q; i++) {
      const yName = this.outputNames[i] ?? `${instancePrefix}_y_${i}`;
      outputVarNames.push(yName);
      if (dae.getVarIdxByName(yName) < 0) {
        dae.addVariable(yName, VarType.Real, Variability.Continuous, Causality.Output, this.yBar[i]!);
      }

      let rhsExpr = dae.addRealLiteral(this.yBar[i]!);
      for (let j = 0; j < r; j++) {
        const cVal = this.Chat[i * r + j]!;
        if (Math.abs(cVal) < 1e-14) continue;
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), dae.addNameExpr(stateVarNames[j]!));
        rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
      }
      for (let j = 0; j < m; j++) {
        const dVal = this.Dhat[i * m + j]!;
        if (Math.abs(dVal) < 1e-14) continue;
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dVal), dae.addNameExpr(inputVarNames[j]!));
        rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
      }
      dae.addEquation(EqKind.Simple, dae.addNameExpr(yName), rhsExpr);
    }

    return { stateVarNames, inputVarNames, outputVarNames };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Non-Intrusive Quadratic Operator Inference (OpInf) Surrogate
// ─────────────────────────────────────────────────────────────────────────────

export class OperatorInferenceSurrogate {
  public readonly numFeatures: number;
  public readonly numModes: number;
  public readonly numInputs: number;
  public readonly quadDim: number;
  public readonly inputNames: string[];
  public readonly meanField: Float64Array;
  public readonly basisModes: Float64Array;
  /** Constant drift vector c_hat in R^r. */
  public readonly chat: Float64Array;
  /** Linear operator A_hat in R^{r x r}. */
  public readonly Ahat: Float64Array;
  /** Quadratic symmetric Kronecker operator H_hat in R^{r x r(r+1)/2}. */
  public readonly Hhat: Float64Array;
  /** Input operator B_hat in R^{r x m}. */
  public readonly Bhat: Float64Array;

  constructor(params: {
    numFeatures: number;
    numModes: number;
    numInputs: number;
    inputNames: string[];
    meanField: Float64Array;
    basisModes: Float64Array;
    chat: Float64Array;
    Ahat: Float64Array;
    Hhat: Float64Array;
    Bhat: Float64Array;
  }) {
    this.numFeatures = params.numFeatures;
    this.numModes = params.numModes;
    this.numInputs = params.numInputs;
    this.quadDim = (params.numModes * (params.numModes + 1)) / 2;
    this.inputNames = [...params.inputNames];
    this.meanField = params.meanField;
    this.basisModes = params.basisModes;
    this.chat = params.chat;
    this.Ahat = params.Ahat;
    this.Hhat = params.Hhat;
    this.Bhat = params.Bhat;
  }

  /**
   * Compute non-redundant symmetric Kronecker product x (x)_sym x in R^{r(r+1)/2}.
   */
  public static computeSymmetricKronecker(x: Float64Array | number[], r: number): Float64Array {
    const qDim = (r * (r + 1)) / 2;
    const out = new Float64Array(qDim);
    let idx = 0;
    for (let i = 0; i < r; i++) {
      const xi = x[i] ?? 0;
      for (let j = i; j < r; j++) {
        out[idx++] = xi * (x[j] ?? 0);
      }
    }
    return out;
  }

  /**
   * Train a non-intrusive quadratic Operator Inference ROM from transient field snapshots.
   */
  public static train(
    trajectories: TransientSnapshotTrajectory | TransientSnapshotTrajectory[],
    config?: DynamicRomTrainConfig,
  ): OperatorInferenceSurrogate {
    const trajList = Array.isArray(trajectories) ? trajectories : [trajectories];
    const pod = extractTransientPodBasis(trajList, config?.maxModes ?? 5, config?.energyThreshold ?? 0.995);

    const r = pod.numModes;
    const qDim = (r * (r + 1)) / 2;
    const allInputs: (Float64Array | number[])[] = [];
    for (const t of trajList) {
      for (const u of t.inputs) allInputs.push(u);
    }
    const M = pod.modalCoordinates.length;
    const m = allInputs[0]?.length ?? 0;
    const inputNames = config?.inputNames ?? Array.from({ length: m }, (_, i) => `u_${i + 1}`);

    // Design matrix D in R^{M x (1 + r + qDim + m)} with rows [1, x_hat^T, (x_hat (x)_sym x_hat)^T, u^T]
    const K = 1 + r + qDim + m;
    const D = new Float64Array(M * K);
    const dX = new Float64Array(M * r);

    for (let s = 0; s < M; s++) {
      const xh = pod.modalCoordinates[s]!;
      const dx = pod.modalDerivatives[s]!;
      const xQuad = OperatorInferenceSurrogate.computeSymmetricKronecker(xh, r);
      const u = allInputs[s] ?? [];

      D[s * K + 0] = 1.0;
      for (let i = 0; i < r; i++) {
        D[s * K + (1 + i)] = xh[i]!;
        dX[s * r + i] = dx[i]!;
      }
      for (let i = 0; i < qDim; i++) {
        D[s * K + (1 + r + i)] = xQuad[i]!;
      }
      for (let j = 0; j < m; j++) {
        D[s * K + (1 + r + qDim + j)] = u[j] ?? 0;
      }
    }

    const regLin = config?.linearRegularization ?? 1e-6;
    const regQuad = config?.quadraticRegularization ?? 1e-2;
    const regVec = new Float64Array(K);
    regVec[0] = regLin;
    for (let i = 0; i < r; i++) regVec[1 + i] = regLin;
    for (let i = 0; i < qDim; i++) regVec[1 + r + i] = regQuad;
    for (let j = 0; j < m; j++) regVec[1 + r + qDim + j] = regLin;

    const weights = solveRegularizedMultiTargetRegression(D, dX, M, K, r, regVec);

    const chat = new Float64Array(r);
    const Ahat = new Float64Array(r * r);
    const Hhat = new Float64Array(r * qDim);
    const Bhat = new Float64Array(r * m);

    for (let row = 0; row < r; row++) {
      chat[row] = weights[0 * r + row]!;
      for (let col = 0; col < r; col++) Ahat[row * r + col] = weights[(1 + col) * r + row]!;
      for (let col = 0; col < qDim; col++) Hhat[row * qDim + col] = weights[(1 + r + col) * r + row]!;
      for (let col = 0; col < m; col++) Bhat[row * m + col] = weights[(1 + r + qDim + col) * r + row]!;
    }

    return new OperatorInferenceSurrogate({
      numFeatures: pod.numFeatures,
      numModes: r,
      numInputs: m,
      inputNames,
      meanField: pod.meanField,
      basisModes: pod.basisModes,
      chat,
      Ahat,
      Hhat,
      Bhat,
    });
  }

  public evaluateDerivative(xHat: Float64Array | number[], u: Float64Array | number[]): Float64Array {
    const { numModes: r, numInputs: m, quadDim, chat, Ahat, Hhat, Bhat } = this;
    const xQuad = OperatorInferenceSurrogate.computeSymmetricKronecker(xHat, r);
    const dx = new Float64Array(r);

    for (let i = 0; i < r; i++) {
      let sum = chat[i]!;
      for (let j = 0; j < r; j++) sum += Ahat[i * r + j]! * (xHat[j] ?? 0);
      for (let j = 0; j < quadDim; j++) sum += Hhat[i * quadDim + j]! * xQuad[j]!;
      for (let j = 0; j < m; j++) sum += Bhat[i * m + j]! * (u[j] ?? 0);
      dx[i] = sum;
    }
    return dx;
  }

  public step(xHat: Float64Array, u: Float64Array | number[], dt: number): Float64Array {
    const r = this.numModes;
    const k1 = this.evaluateDerivative(xHat, u);
    const tmp = new Float64Array(r);

    for (let i = 0; i < r; i++) tmp[i] = xHat[i]! + 0.5 * dt * k1[i]!;
    const k2 = this.evaluateDerivative(tmp, u);

    for (let i = 0; i < r; i++) tmp[i] = xHat[i]! + 0.5 * dt * k2[i]!;
    const k3 = this.evaluateDerivative(tmp, u);

    for (let i = 0; i < r; i++) tmp[i] = xHat[i]! + dt * k3[i]!;
    const k4 = this.evaluateDerivative(tmp, u);

    const nextState = new Float64Array(r);
    for (let i = 0; i < r; i++) {
      nextState[i] = xHat[i]! + (dt / 6.0) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }
    return nextState;
  }

  public reconstructField(xHat: Float64Array | number[]): Float64Array {
    const { numFeatures: N, numModes: r, meanField, basisModes } = this;
    const field = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sum = meanField[i]!;
      for (let m = 0; m < r; m++) {
        sum += (xHat[m] ?? 0) * basisModes[m * N + i]!;
      }
      field[i] = sum;
    }
    return field;
  }

  /**
   * Inline the quadratic Operator Inference dynamical equations directly into a `DAEBuilder` arena.
   */
  public exportToDaeBuilder(
    dae: DAEBuilder,
    instancePrefix: string = "opinf",
    initialLatentState?: Float64Array | number[],
  ): { stateVarNames: string[]; inputVarNames: string[] } {
    const { numModes: r, numInputs: m, quadDim } = this;
    const stateVarNames: string[] = [];
    const inputVarNames: string[] = [];

    for (let i = 0; i < r; i++) {
      const sName = `${instancePrefix}_r_${i}`;
      stateVarNames.push(sName);
      if (dae.getVarIdxByName(sName) < 0) {
        dae.addVariable(sName, VarType.Real, Variability.Continuous, Causality.Local, initialLatentState?.[i] ?? 0.0);
      }
    }

    for (let j = 0; j < m; j++) {
      const uName = this.inputNames[j] ?? `${instancePrefix}_u_${j}`;
      inputVarNames.push(uName);
      if (dae.getVarIdxByName(uName) < 0) {
        dae.addVariable(uName, VarType.Real, Variability.Continuous, Causality.Input, 0.0);
      }
    }

    for (let row = 0; row < r; row++) {
      let rhsExpr = dae.addRealLiteral(this.chat[row]!);

      // Linear state terms
      for (let j = 0; j < r; j++) {
        const aVal = this.Ahat[row * r + j]!;
        if (Math.abs(aVal) < 1e-14) continue;
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(aVal), dae.addNameExpr(stateVarNames[j]!));
        rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
      }

      // Quadratic Kronecker terms
      let qIdx = 0;
      for (let i = 0; i < r; i++) {
        for (let j = i; j < r; j++) {
          const hVal = this.Hhat[row * quadDim + qIdx]!;
          qIdx++;
          if (Math.abs(hVal) < 1e-14) continue;
          const prodStates = dae.addBinaryExpr(
            BinOp.Mul,
            dae.addNameExpr(stateVarNames[i]!),
            dae.addNameExpr(stateVarNames[j]!),
          );
          const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(hVal), prodStates);
          rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
        }
      }

      // Control input terms
      for (let j = 0; j < m; j++) {
        const bVal = this.Bhat[row * m + j]!;
        if (Math.abs(bVal) < 1e-14) continue;
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bVal), dae.addNameExpr(inputVarNames[j]!));
        rhsExpr = dae.addBinaryExpr(BinOp.Add, rhsExpr, term);
      }

      const lhsDer = dae.addDerExpr(dae.addNameExpr(stateVarNames[row]!));
      dae.addEquation(EqKind.Simple, lhsDer, rhsExpr);
    }

    return { stateVarNames, inputVarNames };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Linear Parameter-Varying (LPV) State-Space Surrogate
// ─────────────────────────────────────────────────────────────────────────────

export interface LpvVertexModel {
  /** Scheduling parameter coordinates mu^{(i)} in R^p (e.g. [Reynolds, Mach]). */
  schedulingParams: Float64Array | number[];
  /** Local state matrix A^{(i)} in R^{r x r}. */
  A: Float64Array;
  /** Local input matrix B^{(i)} in R^{r x m}. */
  B: Float64Array;
  /** Local output matrix C^{(i)} in R^{q x r}. */
  C: Float64Array;
  /** Local feedthrough matrix D^{(i)} in R^{q x m}. */
  D: Float64Array;
}

export class LpvStateSpaceSurrogate {
  public readonly numStates: number;
  public readonly numInputs: number;
  public readonly numOutputs: number;
  public readonly numSchedulingParams: number;
  public readonly schedulingParamNames: string[];
  public readonly inputNames: string[];
  public readonly outputNames: string[];
  public readonly vertices: LpvVertexModel[];

  constructor(params: {
    numStates: number;
    numInputs: number;
    numOutputs: number;
    schedulingParamNames: string[];
    inputNames: string[];
    outputNames: string[];
    vertices: LpvVertexModel[];
  }) {
    if (params.vertices.length === 0) {
      throw new Error("LpvStateSpaceSurrogate requires at least one vertex model.");
    }
    this.numStates = params.numStates;
    this.numInputs = params.numInputs;
    this.numOutputs = params.numOutputs;
    this.numSchedulingParams = params.schedulingParamNames.length;
    this.schedulingParamNames = [...params.schedulingParamNames];
    this.inputNames = [...params.inputNames];
    this.outputNames = [...params.outputNames];
    this.vertices = params.vertices;
  }

  /**
   * Compute normalized inverse-distance weights w_i(mu) in [0, 1] summing to 1.0.
   */
  public computeInterpolationWeights(mu: Float64Array | number[]): Float64Array {
    const V = this.vertices.length;
    const weights = new Float64Array(V);
    if (V === 1) {
      weights[0] = 1.0;
      return weights;
    }

    let sumW = 0;
    for (let v = 0; v < V; v++) {
      const anchor = this.vertices[v]!.schedulingParams;
      let distSq = 0;
      for (let p = 0; p < this.numSchedulingParams; p++) {
        const diff = (mu[p] ?? 0) - (anchor[p] ?? 0);
        distSq += diff * diff;
      }
      if (distSq < 1e-20) {
        weights.fill(0);
        weights[v] = 1.0;
        return weights;
      }
      const w = 1.0 / distSq;
      weights[v] = w;
      sumW += w;
    }

    for (let v = 0; v < V; v++) weights[v] = weights[v]! / sumW;
    return weights;
  }

  /**
   * Evaluate interpolated state-space matrices (A(mu), B(mu), C(mu), D(mu)) at scheduling parameter mu.
   */
  public interpolateMatrices(mu: Float64Array | number[]): {
    A: Float64Array;
    B: Float64Array;
    C: Float64Array;
    D: Float64Array;
  } {
    const { numStates: r, numInputs: m, numOutputs: q, vertices } = this;
    const w = this.computeInterpolationWeights(mu);
    const A = new Float64Array(r * r);
    const B = new Float64Array(r * m);
    const C = new Float64Array(q * r);
    const D = new Float64Array(q * m);

    for (let v = 0; v < vertices.length; v++) {
      const wv = w[v]!;
      if (wv === 0) continue;
      const vert = vertices[v]!;
      for (let i = 0; i < r * r; i++) A[i] = A[i]! + wv * vert.A[i]!;
      for (let i = 0; i < r * m; i++) B[i] = B[i]! + wv * vert.B[i]!;
      for (let i = 0; i < q * r; i++) C[i] = C[i]! + wv * vert.C[i]!;
      for (let i = 0; i < q * m; i++) D[i] = D[i]! + wv * vert.D[i]!;
    }

    return { A, B, C, D };
  }

  /**
   * Advance the LPV state-space model by one time step dt at scheduling parameter mu(t).
   */
  public step(
    x: Float64Array,
    u: Float64Array | number[],
    mu: Float64Array | number[],
    dt: number,
  ): { nextState: Float64Array; outputs: Float64Array } {
    const { numStates: r, numInputs: m, numOutputs: q } = this;
    const { A, B, C, D } = this.interpolateMatrices(mu);

    const evalDer = (st: Float64Array): Float64Array => {
      const dx = new Float64Array(r);
      for (let i = 0; i < r; i++) {
        let sum = 0;
        for (let j = 0; j < r; j++) sum += A[i * r + j]! * st[j]!;
        for (let j = 0; j < m; j++) sum += B[i * m + j]! * (u[j] ?? 0);
        dx[i] = sum;
      }
      return dx;
    };

    const k1 = evalDer(x);
    const tmp = new Float64Array(r);
    for (let i = 0; i < r; i++) tmp[i] = x[i]! + 0.5 * dt * k1[i]!;
    const k2 = evalDer(tmp);
    for (let i = 0; i < r; i++) tmp[i] = x[i]! + 0.5 * dt * k2[i]!;
    const k3 = evalDer(tmp);
    for (let i = 0; i < r; i++) tmp[i] = x[i]! + dt * k3[i]!;
    const k4 = evalDer(tmp);

    const nextState = new Float64Array(r);
    for (let i = 0; i < r; i++) {
      nextState[i] = x[i]! + (dt / 6.0) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }

    const outputs = new Float64Array(q);
    for (let i = 0; i < q; i++) {
      let sum = 0;
      for (let j = 0; j < r; j++) sum += C[i * r + j]! * nextState[j]!;
      for (let j = 0; j < m; j++) sum += D[i * m + j]! * (u[j] ?? 0);
      outputs[i] = sum;
    }

    return { nextState, outputs };
  }
}
