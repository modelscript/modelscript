// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multivariate Ellipsoid Extrapolation Guardrails (Mahalanobis Distance).
 *
 * Quantifies whether query points reside on the correlated training data manifold
 * or fall into off-manifold extrapolation regions, overcoming the "empty corners"
 * limitation of independent 1D bounding boxes.
 *
 *   D_M^2(u) = (u - \bar{u})^T \Sigma^{-1} (u - \bar{u}) <= \chi^2_{d, 1-\alpha}
 */

export interface MultivariateBounds {
  /** Mean vector \bar{u} for each input parameter. */
  mean: number[];
  /** Inverse regularized covariance matrix (precision matrix M = \Sigma^{-1}) of dimension d x d. */
  precisionMatrix: number[][];
  /** Critical Mahalanobis distance squared threshold (\chi^2_{d, 1-\alpha}). */
  chi2Threshold: number;
  /** Number of dimensions d. */
  dimensions: number;
}

/**
 * Computes multivariate bounds (mean, precision matrix, and chi-squared critical threshold)
 * from an array of sample points.
 *
 * @param samples Array of N sample vectors, each of length d.
 * @param confidence Confidence level for the ellipsoid (default: 0.99 for 99% coverage).
 */
export function computeMultivariateBounds(samples: number[][], confidence = 0.99): MultivariateBounds {
  const N = samples.length;
  if (N === 0) {
    throw new Error("Cannot compute multivariate bounds from empty sample set.");
  }

  const d = samples[0]!.length;
  if (d === 0) {
    throw new Error("Sample dimensionality must be at least 1.");
  }

  // 1. Compute sample mean
  const mean = new Array<number>(d).fill(0);
  for (let i = 0; i < N; i++) {
    const row = samples[i]!;
    for (let j = 0; j < d; j++) {
      mean[j]! += row[j]!;
    }
  }
  for (let j = 0; j < d; j++) {
    mean[j]! /= N;
  }

  // 2. Compute sample covariance matrix Sigma (d x d)
  const cov: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const denom = N > 1 ? N - 1 : 1;

  for (let i = 0; i < N; i++) {
    const row = samples[i]!;
    for (let j = 0; j < d; j++) {
      const diffJ = row[j]! - mean[j]!;
      for (let k = 0; k < d; k++) {
        const diffK = row[k]! - mean[k]!;
        cov[j]![k]! += diffJ * diffK;
      }
    }
  }

  let trace = 0.0;
  for (let j = 0; j < d; j++) {
    for (let k = 0; k < d; k++) {
      cov[j]![k]! /= denom;
    }
    trace += cov[j]![j]!;
  }

  // 3. Tikhonov regularization: Sigma_reg = Sigma + epsilon * trace(Sigma) * I
  const avgVar = trace / d || 1.0;
  const epsilon = 1e-6 * avgVar;
  for (let j = 0; j < d; j++) {
    cov[j]![j]! += epsilon;
  }

  // 4. Invert Sigma_reg via Gauss-Jordan elimination with partial pivoting
  const precisionMatrix = invertSquareMatrix(cov, d);

  // 5. Compute critical chi^2 threshold
  const chi2Threshold = computeChi2CriticalValue(d, confidence);

  return {
    mean,
    precisionMatrix,
    chi2Threshold,
    dimensions: d,
  };
}

/**
 * Evaluates the squared Mahalanobis distance D_M^2 for a query point.
 */
export function evaluateMahalanobisDistanceSq(bounds: MultivariateBounds, point: number[]): number {
  const d = bounds.dimensions;
  const delta = new Array<number>(d);
  for (let j = 0; j < d; j++) {
    delta[j] = (point[j] ?? bounds.mean[j]!) - bounds.mean[j]!;
  }

  let distSq = 0.0;
  for (let j = 0; j < d; j++) {
    let rowDot = 0.0;
    const row = bounds.precisionMatrix[j]!;
    for (let k = 0; k < d; k++) {
      rowDot += row[k]! * delta[k]!;
    }
    distSq += delta[j]! * rowDot;
  }

  return distSq;
}

/**
 * Checks whether a query point falls outside the multivariate training ellipsoid.
 */
export function isMultivariateExtrapolating(bounds: MultivariateBounds, point: number[]): boolean {
  const distSq = evaluateMahalanobisDistanceSq(bounds, point);
  return distSq > bounds.chi2Threshold;
}

/**
 * Standard Gauss-Jordan matrix inversion with partial pivoting.
 */
function invertSquareMatrix(A: number[][], n: number): number[][] {
  // Augmented matrix [A | I]
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = A[i]![j]!;
    }
    row[n + i] = 1.0;
    return row;
  });

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(aug[col]![col]!);
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(aug[r]![col]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }

    if (maxRow !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[maxRow]!;
      aug[maxRow] = tmp;
    }

    const pivot = aug[col]![col]!;
    const invPivot = Math.abs(pivot) > 1e-15 ? 1.0 / pivot : 1.0;
    for (let c = 0; c < 2 * n; c++) {
      aug[col]![c]! *= invPivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r]![col]!;
      if (Math.abs(factor) > 1e-15) {
        for (let c = 0; c < 2 * n; c++) {
          aug[r]![c]! -= factor * aug[col]![c]!;
        }
      }
    }
  }

  // Extract inverse
  const inv: number[][] = Array.from({ length: n }, (_, i) => {
    return aug[i]!.slice(n);
  });

  return inv;
}

/**
 * Wilson-Hilferty transformation approximation for Chi-Squared quantile \chi^2_{d, 1-\alpha}.
 * Accurately computes critical values across arbitrary degrees of freedom d >= 1.
 */
export function computeChi2CriticalValue(d: number, confidence: number): number {
  // Map confidence level to standard normal quantile z_p
  let z: number;
  if (confidence >= 0.999) {
    z = 3.090232;
  } else if (confidence >= 0.99) {
    z = 2.326348;
  } else if (confidence >= 0.95) {
    z = 1.644854;
  } else if (confidence >= 0.9) {
    z = 1.281552;
  } else {
    z = 1.0;
  }

  if (d === 1) {
    // Exact for 1 degree of freedom: z^2
    return z * z;
  }

  // Wilson-Hilferty formula: chi^2_d \approx d * (1 - 2/(9d) + z * sqrt(2/(9d)))^3
  const factor = 2.0 / (9.0 * d);
  const base = 1.0 - factor + z * Math.sqrt(factor);
  return d * Math.pow(Math.max(0.0, base), 3);
}
