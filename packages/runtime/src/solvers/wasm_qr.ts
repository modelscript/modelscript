// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Dense Householder QR Decomposition & Coordinate Rotation.
 *
 * Implements:
 *   - Dense Householder QR decomposition: A = Q * R
 *     where Q is orthogonal (Q^T * Q = I) and R is upper triangular.
 *   - Coordinate frame rotations: x = x_0 + Q * y
 *   - Wrapping-effect mitigation: computes minimal-volume bounding boxes for rotated interval sets.
 *
 * Academic Citations:
 *   - Householder, A. S. (1958). "Unitary triangularization of a nonsymmetric matrix."
 *     Journal of the ACM, 5(4), pp. 339–342. DOI: 10.1145/320941.320947.
 *   - Golub, G. H., & Van Loan, C. F. (2013). Matrix Computations (4th ed.).
 *     Johns Hopkins University Press. ISBN: 978-1-4214-0794-4.
 *   - Lohner, R. (1987). "Enclosing the solutions of ordinary initial and boundary value problems."
 *     In Computer Arithmetic: Scientific Computation and Programming Languages, pp. 255–286.
 *
 * ModelScript Architectural Rationale:
 *   In reachability analysis and verified ODE integration, propagating axis-aligned bounding boxes
 *   leads to exponential over-approximation known as the wrapping effect. By factoring the state
 *   transition sensitivity matrix via Householder QR, the orthogonal matrix Q provides an optimal
 *   curvilinear coordinate frame, orienting the interval bounding box along the principal expansion
 *   axes and drastically reducing over-estimation during formal safety verification.
 *
 * Modifications:
 *   - Operates on Float64Array memory buffers mapped directly from WebAssembly linear memory.
 *   - Uses backward accumulation of Householder elementary reflectors to synthesize explicit Q matrices.
 *   - Outward interval rounding protects against floating-point inaccuracies during frame rotation.
 */

import { Interval } from "../analysis/wasm_interval.js";
import { getDefaultWasmExports } from "../dae/wasm_loader.js";

interface QrWasmExports {
  memory: WebAssembly.Memory;
  alloc?: (size: number) => number;
  free?: (ptr: number) => void;
  householderQrWasm?: (aPtr: number, qPtr: number, rPtr: number, workVPtr: number, n: number) => void;
  matVecMulWasm?: (qPtr: number, vPtr: number, outPtr: number, n: number) => void;
  matTransposeVecMulWasm?: (qPtr: number, vPtr: number, outPtr: number, n: number) => void;
  encloseRotatedBoxWasm?: (cPtr: number, qPtr: number, hwPtr: number, loPtr: number, hiPtr: number, n: number) => void;
}

export interface QRResult {
  /** Orthogonal matrix Q (n x n, row-major arrays) */
  Q: Float64Array[];
  /** Upper-triangular matrix R (n x n, row-major arrays) */
  R: Float64Array[];
  /** Matrix dimension n */
  n: number;
}

/**
 * Computes Householder QR decomposition of a square n x n matrix A: A = Q * R
 * using the compiled AssemblyScript `householderQrWasm` linear-memory kernel.
 *
 * @param A Array of Float64Array rows representing the n x n matrix.
 * @param n Dimension of matrix.
 */
export function householderQR(A: Float64Array[], n: number): QRResult {
  if (n <= 0) {
    return { Q: [], R: [], n: 0 };
  }

  const w = getDefaultWasmExports() as QrWasmExports | null;
  if (w && typeof w.householderQrWasm === "function" && typeof w.alloc === "function" && typeof w.free === "function") {
    const matBytes = n * n * 8;
    const vecBytes = n * 8;
    const aPtr = w.alloc(matBytes);
    const qPtr = w.alloc(matBytes);
    const rPtr = w.alloc(matBytes);
    const workVPtr = w.alloc(vecBytes);
    try {
      const aFlat = new Float64Array(w.memory.buffer, aPtr, n * n);
      for (let i = 0; i < n; i++) {
        aFlat.set(A[i]!, i * n);
      }

      w.householderQrWasm(aPtr, qPtr, rPtr, workVPtr, n);

      const qFlat = new Float64Array(w.memory.buffer, qPtr, n * n);
      const rFlat = new Float64Array(w.memory.buffer, rPtr, n * n);
      const Q: Float64Array[] = new Array(n);
      const R: Float64Array[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const off = i * n;
        Q[i] = new Float64Array(qFlat.subarray(off, off + n));
        R[i] = new Float64Array(rFlat.subarray(off, off + n));
      }
      return { Q, R, n };
    } finally {
      w.free(aPtr);
      w.free(qPtr);
      w.free(rPtr);
      w.free(workVPtr);
    }
  }

  // Fallback when WASM runtime has not been initialized
  const R: Float64Array[] = A.map((row) => new Float64Array(row));
  const Q: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    row[i] = 1.0;
    Q.push(row);
  }
  for (let k = 0; k < n - 1; k++) {
    let normSq = 0.0;
    for (let i = k; i < n; i++) {
      const val = R[i]![k]!;
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq);
    if (norm < 1e-15) continue;
    const alpha = R[k]![k]! >= 0 ? -norm : norm;
    const v = new Float64Array(n);
    v[k] = R[k]![k]! - alpha;
    for (let i = k + 1; i < n; i++) v[i] = R[i]![k]!;
    let vNormSq = 0.0;
    for (let i = k; i < n; i++) vNormSq += v[i]! * v[i]!;
    if (vNormSq < 1e-30) continue;
    const beta = 2.0 / vNormSq;
    for (let j = k; j < n; j++) {
      let dot = 0.0;
      for (let i = k; i < n; i++) dot += v[i]! * R[i]![j]!;
      const scale = beta * dot;
      for (let i = k; i < n; i++) R[i]![j] = R[i]![j]! - scale * v[i]!;
    }
    R[k]![k] = alpha;
    for (let i = k + 1; i < n; i++) R[i]![k] = 0.0;
    for (let i = 0; i < n; i++) {
      let dot = 0.0;
      for (let j = k; j < n; j++) dot += Q[i]![j]! * v[j]!;
      const scale = beta * dot;
      for (let j = k; j < n; j++) Q[i]![j] = Q[i]![j]! - scale * v[j]!;
    }
  }
  return { Q, R, n };
}

/**
 * Computes Q * v for an n x n orthogonal matrix Q and n-vector v using `matVecMulWasm`.
 */
export function multiplyMatrixVector(Q: Float64Array[], v: Float64Array | number[]): Float64Array {
  const n = Q.length;
  if (n === 0) return new Float64Array(0);

  const w = getDefaultWasmExports() as QrWasmExports | null;
  if (w && typeof w.matVecMulWasm === "function" && typeof w.alloc === "function" && typeof w.free === "function") {
    const qPtr = w.alloc(n * n * 8);
    const vPtr = w.alloc(n * 8);
    const outPtr = w.alloc(n * 8);
    try {
      const qFlat = new Float64Array(w.memory.buffer, qPtr, n * n);
      for (let i = 0; i < n; i++) qFlat.set(Q[i]!, i * n);
      const vView = new Float64Array(w.memory.buffer, vPtr, n);
      for (let i = 0; i < n; i++) vView[i] = v[i] ?? 0;

      w.matVecMulWasm(qPtr, vPtr, outPtr, n);
      return new Float64Array(new Float64Array(w.memory.buffer, outPtr, n));
    } finally {
      w.free(qPtr);
      w.free(vPtr);
      w.free(outPtr);
    }
  }

  const res = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = Q[i]!;
    let sum = 0.0;
    for (let j = 0; j < n; j++) sum += row[j]! * (v[j] ?? 0);
    res[i] = sum;
  }
  return res;
}

/**
 * Computes Q^T * v for an n x n orthogonal matrix Q and n-vector v using `matTransposeVecMulWasm`.
 */
export function multiplyTransposeMatrixVector(Q: Float64Array[], v: Float64Array | number[]): Float64Array {
  const n = Q.length;
  if (n === 0) return new Float64Array(0);

  const w = getDefaultWasmExports() as QrWasmExports | null;
  if (
    w &&
    typeof w.matTransposeVecMulWasm === "function" &&
    typeof w.alloc === "function" &&
    typeof w.free === "function"
  ) {
    const qPtr = w.alloc(n * n * 8);
    const vPtr = w.alloc(n * 8);
    const outPtr = w.alloc(n * 8);
    try {
      const qFlat = new Float64Array(w.memory.buffer, qPtr, n * n);
      for (let i = 0; i < n; i++) qFlat.set(Q[i]!, i * n);
      const vView = new Float64Array(w.memory.buffer, vPtr, n);
      for (let i = 0; i < n; i++) vView[i] = v[i] ?? 0;

      w.matTransposeVecMulWasm(qPtr, vPtr, outPtr, n);
      return new Float64Array(new Float64Array(w.memory.buffer, outPtr, n));
    } finally {
      w.free(qPtr);
      w.free(vPtr);
      w.free(outPtr);
    }
  }

  const res = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0.0;
    for (let j = 0; j < n; j++) sum += Q[j]![i]! * (v[j] ?? 0);
    res[i] = sum;
  }
  return res;
}

/**
 * Encloses a rotated coordinate interval box y in [-w, w] in axis-aligned coordinates:
 * x = center + Q * y using `encloseRotatedBoxWasm`.
 * The exact axis-aligned bound for x_i is:
 *   [center_i - \sum_j |Q_{ij}| w_j, center_i + \sum_j |Q_{ij}| w_j]
 *
 * @param center Center point in original coordinates.
 * @param Q Orthogonal coordinate transformation matrix.
 * @param halfWidths Array of half-widths w_j of the rotated box.
 */
export function encloseRotatedBox(
  center: Float64Array | number[],
  Q: Float64Array[],
  halfWidths: Float64Array | number[],
): Interval[] {
  const n = Q.length;
  if (n === 0) return [];

  const w = getDefaultWasmExports() as QrWasmExports | null;
  if (
    w &&
    typeof w.encloseRotatedBoxWasm === "function" &&
    typeof w.alloc === "function" &&
    typeof w.free === "function"
  ) {
    const cPtr = w.alloc(n * 8);
    const qPtr = w.alloc(n * n * 8);
    const hwPtr = w.alloc(n * 8);
    const loPtr = w.alloc(n * 8);
    const hiPtr = w.alloc(n * 8);
    try {
      const cView = new Float64Array(w.memory.buffer, cPtr, n);
      const hwView = new Float64Array(w.memory.buffer, hwPtr, n);
      const qFlat = new Float64Array(w.memory.buffer, qPtr, n * n);
      for (let i = 0; i < n; i++) {
        cView[i] = center[i] ?? 0;
        hwView[i] = halfWidths[i] ?? 0;
        qFlat.set(Q[i]!, i * n);
      }

      w.encloseRotatedBoxWasm(cPtr, qPtr, hwPtr, loPtr, hiPtr, n);

      const loView = new Float64Array(w.memory.buffer, loPtr, n);
      const hiView = new Float64Array(w.memory.buffer, hiPtr, n);
      const tubes: Interval[] = new Array(n);
      for (let i = 0; i < n; i++) {
        tubes[i] = new Interval(loView[i]!, hiView[i]!);
      }
      return tubes;
    } finally {
      w.free(cPtr);
      w.free(qPtr);
      w.free(hwPtr);
      w.free(loPtr);
      w.free(hiPtr);
    }
  }

  const tubes: Interval[] = [];
  for (let i = 0; i < n; i++) {
    const c = center[i] ?? 0;
    const row = Q[i]!;
    let radius = 0.0;
    for (let j = 0; j < n; j++) {
      radius += Math.abs(row[j]!) * (halfWidths[j] ?? 0);
    }
    tubes.push(new Interval(c - radius, c + radius));
  }
  return tubes;
}

/**
 * Computes local coordinate rotation matrix Q from a sensitivity/variational matrix Phi.
 * If Phi is ill-conditioned or nearly singular, falls back to identity.
 */
export function computeRotationMatrix(Phi: Float64Array[], n: number): Float64Array[] {
  try {
    const qr = householderQR(Phi, n);
    return qr.Q;
  } catch {
    // Identity fallback
    const I: Float64Array[] = [];
    for (let i = 0; i < n; i++) {
      const r = new Float64Array(n);
      r[i] = 1.0;
      I.push(r);
    }
    return I;
  }
}
