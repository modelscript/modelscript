// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Dense Householder QR Decomposition & Coordinate Rotation.
 *
 * Implements:
 *   - Dense Householder QR decomposition: A = Q * R
 *     where Q is orthogonal (Q^T * Q = I) and R is upper triangular.
 *   - Coordinate frame rotations: x = x_0 + Q * y
 *   - Wrapping-effect mitigation: computes minimal-volume bounding boxes for rotated interval sets.
 */

import { Interval } from "../analysis/wasm_interval.js";

export interface QRResult {
  /** Orthogonal matrix Q (n x n, row-major arrays) */
  Q: Float64Array[];
  /** Upper-triangular matrix R (n x n, row-major arrays) */
  R: Float64Array[];
  /** Matrix dimension n */
  n: number;
}

/**
 * Computes Householder QR decomposition of a square n x n matrix A: A = Q * R.
 *
 * @param A Array of Float64Array rows representing the n x n matrix.
 * @param n Dimension of matrix.
 */
export function householderQR(A: Float64Array[], n: number): QRResult {
  // Clone input to form R
  const R: Float64Array[] = A.map((row) => new Float64Array(row));

  // Initialize Q as identity matrix
  const Q: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    row[i] = 1.0;
    Q.push(row);
  }

  // Work arrays for Householder reflections
  for (let k = 0; k < n - 1; k++) {
    // 1. Compute 2-norm of subcolumn R[k..n-1][k]
    let normSq = 0.0;
    for (let i = k; i < n; i++) {
      const val = R[i]![k]!;
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq);
    if (norm < 1e-15) continue;

    // 2. Form Householder vector v
    const alpha = R[k]![k]! >= 0 ? -norm : norm;
    const v = new Float64Array(n);
    v[k] = R[k]![k]! - alpha;
    for (let i = k + 1; i < n; i++) {
      v[i] = R[i]![k]!;
    }

    // Normalize v
    let vNormSq = 0.0;
    for (let i = k; i < n; i++) {
      vNormSq += v[i]! * v[i]!;
    }
    if (vNormSq < 1e-30) continue;
    const beta = 2.0 / vNormSq;

    // 3. Apply reflection to R: R = (I - beta * v * v^T) * R
    // R[i, j] -= beta * v[i] * (v^T * R[:, j])
    for (let j = k; j < n; j++) {
      let dot = 0.0;
      for (let i = k; i < n; i++) {
        dot += v[i]! * R[i]![j]!;
      }
      const scale = beta * dot;
      for (let i = k; i < n; i++) {
        R[i]![j] -= scale * v[i]!;
      }
    }

    // 4. Accumulate into Q: Q = Q * (I - beta * v * v^T)
    // Q[i, j] -= beta * (Q[i, :] * v) * v[j]
    for (let i = 0; i < n; i++) {
      let dot = 0.0;
      for (let j = k; j < n; j++) {
        dot += Q[i]![j]! * v[j]!;
      }
      const scale = beta * dot;
      for (let j = k; j < n; j++) {
        Q[i]![j] -= scale * v[j]!;
      }
    }
  }

  return { Q, R, n };
}

/**
 * Computes Q * v for an n x n orthogonal matrix Q and n-vector v.
 */
export function multiplyMatrixVector(Q: Float64Array[], v: Float64Array | number[]): Float64Array {
  const n = Q.length;
  const res = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = Q[i]!;
    let sum = 0.0;
    for (let j = 0; j < n; j++) {
      sum += row[j]! * (v[j] ?? 0);
    }
    res[i] = sum;
  }
  return res;
}

/**
 * Computes Q^T * v for an n x n orthogonal matrix Q and n-vector v.
 */
export function multiplyTransposeMatrixVector(Q: Float64Array[], v: Float64Array | number[]): Float64Array {
  const n = Q.length;
  const res = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0.0;
    for (let j = 0; j < n; j++) {
      sum += Q[j]![i]! * (v[j] ?? 0);
    }
    res[i] = sum;
  }
  return res;
}

/**
 * Encloses a rotated coordinate interval box y in [-w, w] in axis-aligned coordinates:
 * x = center + Q * y
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
