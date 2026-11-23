// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dense Gaussian elimination with partial pivoting for small/medium thermal network Jacobians.
 * Solves A * x = b in-place (returns solution vector x, or null if singular).
 */
export function solveLinearSystem(matrix: Float64Array[], rhs: Float64Array): Float64Array | null {
  const n = rhs.length;
  if (n === 0) return new Float64Array(0);

  // Copy A and b to avoid mutating caller arrays
  const a: Float64Array[] = new Array(n);
  const b = new Float64Array(rhs);
  for (let i = 0; i < n; i++) {
    a[i] = new Float64Array(matrix[i]!);
  }

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let pivotRow = col;
    let maxAbs = Math.abs(a[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(a[row]![col]!);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = row;
      }
    }

    if (maxAbs < 1e-18 || !Number.isFinite(maxAbs)) {
      return null;
    }

    if (pivotRow !== col) {
      const tmpRow = a[col]!;
      a[col] = a[pivotRow]!;
      a[pivotRow] = tmpRow;
      const tmpB = b[col]!;
      b[col] = b[pivotRow]!;
      b[pivotRow] = tmpB;
    }

    const pivot = a[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = a[row]![col]! / pivot;
      if (factor === 0) continue;
      a[row]![col] = 0;
      for (let k = col + 1; k < n; k++) {
        a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      }
      b[row] = b[row]! - factor * b[col]!;
    }
  }

  // Back substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= a[i]![j]! * x[j]!;
    }
    x[i] = sum / a[i]![i]!;
  }

  return x;
}
