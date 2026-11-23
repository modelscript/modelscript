// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Data-Oriented Flat-Memory Dense Linear Algebra & FFT Kernels.
 *
 * All routines operate directly on flat `Float64Array` buffers (row-major) with zero
 * intermediate object-wrapper allocations, serving as the shared numerical foundation for:
 *   - Phase 1: DSP / Spectral / Vector Fitting / N4SID / DMD
 *   - Phase 2: System-Theoretic MOR (Balanced Truncation, IRKA, DEIM) & Identifiability
 *   - Phase 4: iLQR / Direct Collocation / Featherstone
 *   - Phase 5: CBF-CLF-QP / Game Theory
 */

/** Next power of two >= n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place radix-2 Cooley-Tukey complex FFT (`inverse = false`) or IFFT (`inverse = true`).
 * Length `n` MUST be a power of 2.
 */
export function fftRadix2InPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (sign * 2 * Math.PI) / len;
    const wLenRe = Math.cos(angle);
    const wLenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let j = 0; j < half; j++) {
        const uIdx = i + j;
        const vIdx = uIdx + half;
        const vr = re[vIdx]!;
        const vi = im[vIdx]!;
        const tRe = vr * wRe - vi * wIm;
        const tIm = vr * wIm + vi * wRe;
        const ur = re[uIdx]!;
        const ui = im[uIdx]!;
        re[uIdx] = ur + tRe;
        im[uIdx] = ui + tIm;
        re[vIdx] = ur - tRe;
        im[vIdx] = ui - tIm;
        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }

  if (inverse) {
    const invN = 1.0 / n;
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! * invN;
      im[i] = im[i]! * invN;
    }
  }
}

/**
 * Arbitrary-length complex FFT (Cooley-Tukey for power-of-2, Bluestein chirp-z otherwise).
 */
export function fft(
  inputRe: Readonly<Float64Array | number[]>,
  inputIm?: Readonly<Float64Array | number[]>,
  inverse = false,
): { re: Float64Array; im: Float64Array } {
  const n = inputRe.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = inputRe[i]!;
    im[i] = inputIm ? inputIm[i]! : 0;
  }
  if (n <= 1) return { re, im };

  if ((n & (n - 1)) === 0) {
    fftRadix2InPlace(re, im, inverse);
    return { re, im };
  }

  // Bluestein's algorithm for arbitrary N
  const m = nextPow2(2 * n - 1);
  const cosTable = new Float64Array(n);
  const sinTable = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n;
    cosTable[k] = Math.cos(angle);
    sinTable[k] = Math.sin(angle);
  }

  const aRe = new Float64Array(m);
  const aIm = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    const c = cosTable[k]!;
    const s = sinTable[k]!;
    aRe[k] = re[k]! * c - im[k]! * s;
    aIm[k] = re[k]! * s + im[k]! * c;
  }

  const bRe = new Float64Array(m);
  const bIm = new Float64Array(m);
  bRe[0] = cosTable[0]!;
  bIm[0] = -sinTable[0]!;
  for (let k = 1; k < n; k++) {
    bRe[k] = cosTable[k]!;
    bIm[k] = -sinTable[k]!;
    bRe[m - k] = cosTable[k]!;
    bIm[m - k] = -sinTable[k]!;
  }

  fftRadix2InPlace(aRe, aIm, false);
  fftRadix2InPlace(bRe, bIm, false);
  for (let i = 0; i < m; i++) {
    const ar = aRe[i]!;
    const ai = aIm[i]!;
    const br = bRe[i]!;
    const bi = bIm[i]!;
    aRe[i] = ar * br - ai * bi;
    aIm[i] = ar * bi + ai * br;
  }
  fftRadix2InPlace(aRe, aIm, true);

  const scale = inverse ? 1.0 / n : 1.0;
  for (let k = 0; k < n; k++) {
    const c = cosTable[k]!;
    const s = sinTable[k]!;
    re[k] = (aRe[k]! * c - aIm[k]! * s) * scale;
    im[k] = (aRe[k]! * s + aIm[k]! * c) * scale;
  }
  return { re, im };
}

/** Inverse arbitrary-length complex FFT. */
export function ifft(
  inputRe: Readonly<Float64Array | number[]>,
  inputIm: Readonly<Float64Array | number[]>,
): { re: Float64Array; im: Float64Array } {
  return fft(inputRe, inputIm, true);
}

/** Matrix multiplication C = A (m x k) * B (k x n), row-major flat Float64Array. */
export function matMul(A: Float64Array, B: Float64Array, m: number, k: number, n: number): Float64Array {
  const C = new Float64Array(m * n);
  for (let i = 0; i < m; i++) {
    const iRow = i * k;
    const cRow = i * n;
    for (let p = 0; p < k; p++) {
      const aip = A[iRow + p]!;
      if (aip === 0) continue;
      const bRow = p * n;
      for (let j = 0; j < n; j++) {
        C[cRow + j] = C[cRow + j]! + aip * B[bRow + j]!;
      }
    }
  }
  return C;
}

/** Matrix transpose B = A^T for A (m x n). */
export function matTranspose(A: Float64Array, m: number, n: number): Float64Array {
  const AT = new Float64Array(n * m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      AT[j * m + i] = A[i * n + j]!;
    }
  }
  return AT;
}

/** Flatten 2D row-major array into flat Float64Array. */
export function flattenMatrix(M: readonly (readonly number[])[]): { data: Float64Array; rows: number; cols: number } {
  const rows = M.length;
  const cols = rows > 0 ? M[0]!.length : 0;
  const data = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    const row = M[i]!;
    for (let j = 0; j < cols; j++) {
      data[i * cols + j] = row[j]!;
    }
  }
  return { data, rows, cols };
}

/** Unflatten flat row-major Float64Array into number[][]. */
export function unflattenMatrix(data: Float64Array, rows: number, cols: number): number[][] {
  const out: number[][] = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row = new Array<number>(cols);
    for (let j = 0; j < cols; j++) {
      row[j] = data[i * cols + j]!;
    }
    out[i] = row;
  }
  return out;
}

/**
 * Dense linear solve A * x = b via Gaussian elimination with partial pivoting.
 * Does not mutate inputs.
 */
export function solveDenseLinear(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A);
  const rhs = new Float64Array(b);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row * n + col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = row;
      }
    }
    if (maxAbs < 1e-15) {
      // Tiny Tikhonov regularization for near-singular systems
      M[col * n + col] = (M[col * n + col]! >= 0 ? 1 : -1) * 1e-15;
    } else if (pivotRow !== col) {
      for (let j = col; j < n; j++) {
        const tmp = M[col * n + j]!;
        M[col * n + j] = M[pivotRow * n + j]!;
        M[pivotRow * n + j] = tmp;
      }
      const tb = rhs[col]!;
      rhs[col] = rhs[pivotRow]!;
      rhs[pivotRow] = tb;
    }

    const diag = M[col * n + col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row * n + col]! / diag;
      if (factor === 0) continue;
      M[row * n + col] = 0;
      for (let j = col + 1; j < n; j++) {
        M[row * n + j] = M[row * n + j]! - factor * M[col * n + j]!;
      }
      rhs[row] = rhs[row]! - factor * rhs[col]!;
    }
  }

  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i * n + j]! * x[j]!;
    }
    x[i] = sum / M[i * n + i]!;
  }
  return x;
}

/** Dense matrix inversion via Gauss-Jordan with partial pivoting. */
export function matInv(A: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A);
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) inv[i * n + i] = 1.0;

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row * n + col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = row;
      }
    }
    if (pivotRow !== col) {
      for (let j = 0; j < n; j++) {
        const tm = M[col * n + j]!;
        M[col * n + j] = M[pivotRow * n + j]!;
        M[pivotRow * n + j] = tm;
        const ti = inv[col * n + j]!;
        inv[col * n + j] = inv[pivotRow * n + j]!;
        inv[pivotRow * n + j] = ti;
      }
    }
    const diag = Math.abs(M[col * n + col]!) < 1e-15 ? 1e-15 : M[col * n + col]!;
    const invDiag = 1.0 / diag;
    for (let j = 0; j < n; j++) {
      M[col * n + j] = M[col * n + j]! * invDiag;
      inv[col * n + j] = inv[col * n + j]! * invDiag;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row * n + col]!;
      if (factor === 0) continue;
      for (let j = 0; j < n; j++) {
        M[row * n + j] = M[row * n + j]! - factor * M[col * n + j]!;
        inv[row * n + j] = inv[row * n + j]! - factor * inv[col * n + j]!;
      }
    }
  }
  return inv;
}

export interface SvdResult {
  /** U (m x k) row-major where k = min(m, n) */
  U: Float64Array;
  /** Singular values sorted descending (length k) */
  S: Float64Array;
  /** V (n x k) row-major so A ≈ U * diag(S) * V^T */
  V: Float64Array;
  m: number;
  n: number;
  k: number;
}

/**
 * Thin Singular Value Decomposition A = U * diag(S) * V^T via one-sided Jacobi orthogonalization.
 * Handles both tall (m >= n) and wide (m < n) matrices accurately.
 */
export function svdJacobi(A: Float64Array, m: number, n: number, maxSweeps = 60, tol = 1e-12): SvdResult {
  if (m < n) {
    // Compute SVD of A^T = V * S * U^T
    const AT = matTranspose(A, m, n);
    const res = svdJacobi(AT, n, m, maxSweeps, tol);
    return { U: res.V, S: res.S, V: res.U, m, n, k: res.k };
  }

  // Now m >= n, k = n
  const k = n;
  const W = new Float64Array(A); // m x n
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1.0;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxOff = 0.0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let app = 0.0;
        let aqq = 0.0;
        let apq = 0.0;
        for (let i = 0; i < m; i++) {
          const wp = W[i * n + p]!;
          const wq = W[i * n + q]!;
          app += wp * wp;
          aqq += wq * wq;
          apq += wp * wq;
        }
        const denom = Math.sqrt(app * aqq);
        if (denom === 0) continue;
        const rel = Math.abs(apq) / denom;
        if (rel > maxOff) maxOff = rel;
        if (rel <= tol) continue;

        const tau = (aqq - app) / (2.0 * apq);
        const t = (tau >= 0 ? 1.0 : -1.0) / (Math.abs(tau) + Math.sqrt(1.0 + tau * tau));
        const c = 1.0 / Math.sqrt(1.0 + t * t);
        const s = t * c;

        for (let i = 0; i < m; i++) {
          const wp = W[i * n + p]!;
          const wq = W[i * n + q]!;
          W[i * n + p] = c * wp - s * wq;
          W[i * n + q] = s * wp + c * wq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i * n + p]!;
          const vq = V[i * n + q]!;
          V[i * n + p] = c * vp - s * vq;
          V[i * n + q] = s * vp + c * vq;
        }
      }
    }
    if (maxOff <= tol) break;
  }

  const S = new Float64Array(k);
  const U = new Float64Array(m * k);
  const order = new Int32Array(k);
  for (let j = 0; j < k; j++) {
    let norm2 = 0.0;
    for (let i = 0; i < m; i++) {
      const v = W[i * n + j]!;
      norm2 += v * v;
    }
    S[j] = Math.sqrt(norm2);
    order[j] = j;
  }

  // Sort singular values descending
  order.sort((a, b) => S[b]! - S[a]!);

  const sortedS = new Float64Array(k);
  const sortedV = new Float64Array(n * k);
  for (let col = 0; col < k; col++) {
    const src = order[col]!;
    const sigma = S[src]!;
    sortedS[col] = sigma;
    for (let i = 0; i < m; i++) {
      U[i * k + col] = sigma > 1e-15 ? W[i * n + src]! / sigma : 0.0;
    }
    for (let i = 0; i < n; i++) {
      sortedV[i * k + col] = V[i * n + src]!;
    }
  }

  return { U, S: sortedS, V: sortedV, m, n, k };
}

export interface QrPivotedResult {
  Q: Float64Array;
  R: Float64Array;
  perm: Int32Array;
  rank: number;
}

/**
 * Column-pivoted Modified Gram-Schmidt QR decomposition for A (m x n).
 * Returns Q (m x k), R (k x n), column permutation `perm`, and numerical rank.
 */
export function qrPivoted(A: Float64Array, m: number, n: number, rankTol = 1e-10): QrPivotedResult {
  const k = Math.min(m, n);
  const W = new Float64Array(A);
  const perm = new Int32Array(n);
  const colNorm2 = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    perm[j] = j;
    let s = 0.0;
    for (let i = 0; i < m; i++) {
      const v = W[i * n + j]!;
      s += v * v;
    }
    colNorm2[j] = s;
  }

  const Q = new Float64Array(m * k);
  const R = new Float64Array(k * n);
  let maxR = 0.0;
  let rank = 0;

  for (let step = 0; step < k; step++) {
    // Select pivot column with largest residual norm
    let piv = step;
    let best = colNorm2[step]!;
    for (let j = step + 1; j < n; j++) {
      if (colNorm2[j]! > best) {
        best = colNorm2[j]!;
        piv = j;
      }
    }
    if (piv !== step) {
      const tp = perm[step]!;
      perm[step] = perm[piv]!;
      perm[piv] = tp;
      const tn = colNorm2[step]!;
      colNorm2[step] = colNorm2[piv]!;
      colNorm2[piv] = tn;
      for (let i = 0; i < m; i++) {
        const tv = W[i * n + step]!;
        W[i * n + step] = W[i * n + piv]!;
        W[i * n + piv] = tv;
      }
      for (let i = 0; i < step; i++) {
        const tr = R[i * n + step]!;
        R[i * n + step] = R[i * n + piv]!;
        R[i * n + piv] = tr;
      }
    }

    let norm = 0.0;
    for (let i = 0; i < m; i++) {
      const v = W[i * n + step]!;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    R[step * n + step] = norm;
    if (step === 0) maxR = norm;
    if (norm > maxR * rankTol && norm > 1e-14) {
      rank = step + 1;
      const invNorm = 1.0 / norm;
      for (let i = 0; i < m; i++) {
        Q[i * k + step] = W[i * n + step]! * invNorm;
      }
      for (let j = step + 1; j < n; j++) {
        let dot = 0.0;
        for (let i = 0; i < m; i++) {
          dot += Q[i * k + step]! * W[i * n + j]!;
        }
        R[step * n + j] = dot;
        let newNorm2 = 0.0;
        for (let i = 0; i < m; i++) {
          const updated = W[i * n + j]! - dot * Q[i * k + step]!;
          W[i * n + j] = updated;
          newNorm2 += updated * updated;
        }
        colNorm2[j] = newNorm2;
      }
    }
  }

  return { Q, R, perm, rank };
}

/**
 * Solves the continuous-time Lyapunov equation:
 *   A * X + X * A^T + Q = 0
 * where A and Q are n x n row-major Float64Arrays.
 *
 * Uses exact Kronecker vectorization for n <= 20, and Bilinear Cayley + Smith squared iteration
 * for larger stable matrices.
 */
export function solveLyapunov(A: Float64Array, Q: Float64Array, n: number): Float64Array {
  if (n <= 20) {
    const nn = n * n;
    const K = new Float64Array(nn * nn);
    const rhs = new Float64Array(nn);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const row = i * n + j;
        rhs[row] = -Q[row]!;
        for (let k = 0; k < n; k++) {
          // (A * X)_{i,j} = sum_k A_{i,k} X_{k,j}
          K[row * nn + (k * n + j)] = K[row * nn + (k * n + j)]! + A[i * n + k]!;
          // (X * A^T)_{i,j} = sum_k X_{i,k} A_{j,k}
          K[row * nn + (i * n + k)] = K[row * nn + (i * n + k)]! + A[j * n + k]!;
        }
      }
    }
    return solveDenseLinear(K, rhs, nn);
  }

  // Smith squared iteration via Cayley transform: A_d = (A + pI)(A - pI)^-1
  let trace = 0;
  for (let i = 0; i < n; i++) trace += Math.abs(A[i * n + i]!);
  const p = Math.max(1.0, trace / n);

  const AminusP = new Float64Array(n * n);
  const AplusP = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    AminusP[i] = A[i]!;
    AplusP[i] = A[i]!;
  }
  for (let i = 0; i < n; i++) {
    AminusP[i * n + i] = AminusP[i * n + i]! - p;
    AplusP[i * n + i] = AplusP[i * n + i]! + p;
  }

  const invAminusP = matInv(AminusP, n);
  let Ak = matMul(AplusP, invAminusP, n, n, n);
  const invAT = matTranspose(invAminusP, n, n);
  const tmp = matMul(invAminusP, Q, n, n, n);
  let X = matMul(tmp, invAT, n, n, n);
  for (let i = 0; i < n * n; i++) X[i] = X[i]! * (2.0 * p);

  for (let iter = 0; iter < 30; iter++) {
    const AkT = matTranspose(Ak, n, n);
    const AkX = matMul(Ak, X, n, n, n);
    const delta = matMul(AkX, AkT, n, n, n);
    let diffNorm = 0.0;
    for (let i = 0; i < n * n; i++) {
      diffNorm += Math.abs(delta[i]!);
      X[i] = X[i]! + delta[i]!;
    }
    if (diffNorm < 1e-12) break;
    Ak = matMul(Ak, Ak, n, n, n);
  }
  return X;
}

/**
 * Solves the Continuous-Time Algebraic Riccati Equation (CARE):
 *   A^T P + P A - P B R^{-1} B^T P + Q = 0
 * via Kleinman-Newton iteration. Returns P (n x n) and feedback gain K = R^{-1} B^T P (m x n).
 */
export function solveCare(
  A: Float64Array,
  B: Float64Array,
  Q: Float64Array,
  R: Float64Array,
  n: number,
  m: number,
  maxIters = 30,
): { P: Float64Array; K: Float64Array; converged: boolean } {
  const Rinv = matInv(R, m);
  const BT = matTranspose(B, n, m);
  const RinvBT = matMul(Rinv, BT, m, m, n); // m x n
  const BRinvBT = matMul(B, RinvBT, n, m, n); // n x n

  // Initial stabilizing guess via P0 = I (or shifted Lyapunov if A is already stable)
  let P: Float64Array = new Float64Array(n * n);
  for (let i = 0; i < n; i++) P[i * n + i] = 1.0;
  let converged = false;

  for (let iter = 0; iter < maxIters; iter++) {
    // K = R^-1 B^T P
    const K = matMul(RinvBT, P, m, n, n);
    // A_cl = A - B K
    const BK = matMul(B, K, n, m, n);
    const Acl = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) Acl[i] = A[i]! - BK[i]!;

    // Q_eff = Q + K^T R K
    const KT = matTranspose(K, m, n);
    const RK = matMul(R, K, m, m, n);
    const KTRK = matMul(KT, RK, n, m, n);
    const Qeff = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) Qeff[i] = Q[i]! + KTRK[i]!;

    // Solve A_cl^T P_next + P_next A_cl + Q_eff = 0
    const AclT = matTranspose(Acl, n, n);
    const Pnext = solveLyapunov(AclT, Qeff, n);

    let maxDiff = 0.0;
    for (let i = 0; i < n * n; i++) {
      const d = Math.abs(Pnext[i]! - P[i]!);
      if (d > maxDiff) maxDiff = d;
    }
    P = Pnext;
    if (maxDiff < 1e-10) {
      converged = true;
      break;
    }
  }

  // Final check of BRinvBT usage to avoid unused var & compute final gain
  void BRinvBT;
  const K = matMul(RinvBT, P, m, n, n);
  return { P, K, converged };
}
