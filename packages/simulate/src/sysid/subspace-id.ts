// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Dynamic Mode Decomposition (DMD / Koopman) & Subspace ID (N4SID).
 *
 * Extracts reduced linear/Koopman state-space models directly from simulation or telemetry
 * snapshot trajectories X = [x_0, x_1, ..., x_m].
 */

import { matMul, matTranspose, svdJacobi, unflattenMatrix } from "@modelscript/runtime";

export interface DmdResult {
  /** Reduced operator A_tilde (r x r) in POD basis. */
  readonly Atilde: number[][];
  /** Full reconstructed linear transition matrix A ≈ X' V S^{-1} U^T (n x n). */
  readonly A: number[][];
  /** POD basis modes U_r (n x r). */
  readonly modes: number[][];
  readonly singularValues: number[];
  readonly rank: number;
  readonly reconstructionError: number;
}

/**
 * Exact Dynamic Mode Decomposition (Tu et al. 2014).
 * Given snapshots `snapshots[k]` of dimension `n` (k = 0..T-1), identifies X_{k+1} ≈ A X_k.
 */
export function computeDmd(snapshots: readonly (readonly number[])[], targetRank?: number): DmdResult {
  const numSteps = snapshots.length;
  if (numSteps < 2) {
    throw new Error("computeDmd requires at least 2 state snapshots.");
  }
  const n = snapshots[0]!.length;
  const m = numSteps - 1;

  // X (n x m) = [x_0 .. x_{m-1}], Xprime (n x m) = [x_1 .. x_m]
  const X = new Float64Array(n * m);
  const Xp = new Float64Array(n * m);
  for (let t = 0; t < m; t++) {
    const xt = snapshots[t]!;
    const xt1 = snapshots[t + 1]!;
    for (let i = 0; i < n; i++) {
      X[i * m + t] = xt[i]!;
      Xp[i * m + t] = xt1[i]!;
    }
  }

  const svd = svdJacobi(X, n, m);
  const maxS = svd.S[0] ?? 0;
  let autoRank = 0;
  for (let i = 0; i < svd.k; i++) {
    if (svd.S[i]! > maxS * 1e-10) autoRank++;
  }
  const r = Math.max(1, Math.min(targetRank ?? autoRank, svd.k));

  // Slice Ur (n x r), Vr (m x r), Sinv (r x r)
  const Ur = new Float64Array(n * r);
  const Vr = new Float64Array(m * r);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < r; j++) Ur[i * r + j] = svd.U[i * svd.k + j]!;
  }
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < r; j++) Vr[i * r + j] = svd.V[i * svd.k + j]!;
  }

  // VrSinv = Vr * diag(1/S_r) (m x r)
  const VrSinv = new Float64Array(m * r);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < r; j++) {
      const s = svd.S[j]!;
      VrSinv[i * r + j] = s > 1e-14 ? Vr[i * r + j]! / s : 0;
    }
  }

  const UrT = matTranspose(Ur, n, r);
  const XpVrSinv = matMul(Xp, VrSinv, n, m, r); // n x r
  const AtildeFlat = matMul(UrT, XpVrSinv, r, n, r); // r x r
  const AFlat = matMul(XpVrSinv, UrT, n, r, n); // n x n

  // Compute one-step prediction RMS error
  const Xpred = matMul(AFlat, X, n, n, m);
  let err2 = 0;
  for (let i = 0; i < n * m; i++) {
    const d = Xpred[i]! - Xp[i]!;
    err2 += d * d;
  }

  return {
    Atilde: unflattenMatrix(AtildeFlat, r, r),
    A: unflattenMatrix(AFlat, n, n),
    modes: unflattenMatrix(Ur, n, r),
    singularValues: Array.from(svd.S),
    rank: r,
    reconstructionError: Math.sqrt(err2 / (n * m)),
  };
}

export interface SubspaceIdResult {
  readonly A: number[][];
  readonly B: number[][];
  readonly C: number[][];
  readonly order: number;
  readonly singularValues: number[];
}

/**
 * Simplified N4SID / Ho-Kalman Subspace State-Space System Identification.
 * Identifies discrete-time (A, B, C) from output-only or input-output Hankel trajectories.
 */
export function identifySubspaceN4SID(
  outputs: readonly (readonly number[])[],
  inputs: readonly (readonly number[])[] | undefined,
  order: number,
  hankelRows?: number,
): SubspaceIdResult {
  const T = outputs.length;
  const p = outputs[0]!.length;
  const iRows = Math.max(order + 1, Math.min(hankelRows ?? Math.max(order + 2, Math.floor(T / 4)), Math.floor(T / 2)));
  const jCols = T - 2 * iRows + 1;
  if (jCols < order) {
    throw new Error(`identifySubspaceN4SID needs more samples (T=${T}, order=${order}).`);
  }

  // Build future output block Hankel matrix Y_f (iRows * p x jCols)
  const rowDim = iRows * p;
  const Yf = new Float64Array(rowDim * jCols);
  for (let block = 0; block < iRows; block++) {
    for (let col = 0; col < jCols; col++) {
      const y = outputs[iRows + block + col]!;
      for (let outIdx = 0; outIdx < p; outIdx++) {
        Yf[(block * p + outIdx) * jCols + col] = y[outIdx]!;
      }
    }
  }

  const svd = svdJacobi(Yf, rowDim, jCols);
  const r = Math.max(1, Math.min(order, svd.k));

  // Extended observability matrix O_i = U_r * sqrt(S_r) (rowDim x r)
  const Oi = new Float64Array(rowDim * r);
  for (let row = 0; row < rowDim; row++) {
    for (let c = 0; c < r; c++) {
      Oi[row * r + c] = svd.U[row * svd.k + c]! * Math.sqrt(Math.max(0, svd.S[c]!));
    }
  }

  // C = first p rows of O_i
  const Cflat = Oi.subarray(0, p * r);

  // Shift invariance: O_up * A ≈ O_down => A = pinv(O_up) * O_down
  const shiftRows = (iRows - 1) * p;
  const Oup = Oi.subarray(0, shiftRows * r);
  const Odown = Oi.subarray(p * r, rowDim * r);
  const svdUp = svdJacobi(Oup, shiftRows, r);
  const OupT = matTranspose(svdUp.U, shiftRows, svdUp.k);
  const UtOdown = matMul(OupT, Odown, svdUp.k, shiftRows, r);
  const VSinv = new Float64Array(r * svdUp.k);
  for (let row = 0; row < r; row++) {
    for (let c = 0; c < svdUp.k; c++) {
      const s = svdUp.S[c]!;
      VSinv[row * svdUp.k + c] = s > 1e-12 ? svdUp.V[row * svdUp.k + c]! / s : 0;
    }
  }
  const Aflat = matMul(VSinv, UtOdown, r, svdUp.k, r);

  // Estimate B if inputs are supplied (least-squares from state sequence X_hat = sqrt(S_r) * V_r^T)
  const m = inputs && inputs.length > 0 ? inputs[0]!.length : 0;
  let Bmat: number[][] = Array.from({ length: r }, () => []);
  if (inputs && m > 0) {
    const Xhat = new Float64Array(r * jCols);
    for (let c = 0; c < r; c++) {
      const sqrtS = Math.sqrt(Math.max(0, svd.S[c]!));
      for (let col = 0; col < jCols; col++) {
        Xhat[c * jCols + col] = sqrtS * svd.V[col * svd.k + c]!;
      }
    }
    // Residual R_k = x_{k+1} - A x_k ≈ B u_k
    const numPairs = jCols - 1;
    const Res = new Float64Array(r * numPairs);
    const Umat = new Float64Array(m * numPairs);
    for (let k = 0; k < numPairs; k++) {
      const uVec = inputs[iRows + k]!;
      for (let j = 0; j < m; j++) Umat[j * numPairs + k] = uVec[j]!;
      for (let row = 0; row < r; row++) {
        let ax = 0;
        for (let c = 0; c < r; c++) ax += Aflat[row * r + c]! * Xhat[c * jCols + k]!;
        Res[row * numPairs + k] = Xhat[row * jCols + (k + 1)]! - ax;
      }
    }
    const svdU = svdJacobi(Umat, m, numPairs);
    const ResV = matMul(Res, svdU.V, r, numPairs, svdU.k);
    for (let row = 0; row < r; row++) {
      for (let c = 0; c < svdU.k; c++) {
        const s = svdU.S[c]!;
        ResV[row * svdU.k + c] = s > 1e-12 ? ResV[row * svdU.k + c]! / s : 0;
      }
    }
    const UT = matTranspose(svdU.U, m, svdU.k);
    const Bflat = matMul(ResV, UT, r, svdU.k, m);
    Bmat = unflattenMatrix(Bflat, r, m);
  }

  return {
    A: unflattenMatrix(Aflat, r, r),
    B: Bmat,
    C: unflattenMatrix(Cflat, p, r),
    order: r,
    singularValues: Array.from(svd.S),
  };
}
