// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BodePlotData, LinearSystemModel, SystemEigenvalue } from "../types.js";

/**
 * Computes open-loop eigenvalues, damping ratios, and natural frequencies of matrix A.
 */
export function computeEigenvalues(A: number[][]): SystemEigenvalue[] {
  const n = A.length;
  if (n === 0) return [];

  if (n === 1) {
    const val = A[0]![0]!;
    return [
      {
        real: val,
        imag: 0.0,
        magnitude: Math.abs(val),
        frequencyRadS: Math.abs(val),
        frequencyHz: Math.abs(val) / (2.0 * Math.PI),
        dampingRatio: val !== 0 ? (val < 0 ? 1.0 : -1.0) : 0.0,
        isStable: val <= 0,
      },
    ];
  }

  if (n === 2) {
    const tr = A[0]![0]! + A[1]![1]!;
    const det = A[0]![0]! * A[1]![1]! - A[0]![1]! * A[1]![0]!;
    const disc = tr * tr - 4.0 * det;

    let eigs: { real: number; imag: number }[];
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      eigs = [
        { real: (tr + sqrtDisc) / 2.0, imag: 0.0 },
        { real: (tr - sqrtDisc) / 2.0, imag: 0.0 },
      ];
    } else {
      const sqrtDisc = Math.sqrt(-disc);
      eigs = [
        { real: tr / 2.0, imag: sqrtDisc / 2.0 },
        { real: tr / 2.0, imag: -sqrtDisc / 2.0 },
      ];
    }

    return eigs.map((e) => {
      const mag = Math.sqrt(e.real * e.real + e.imag * e.imag);
      const damping = mag > 1e-12 ? -e.real / mag : 0.0;
      return {
        real: e.real,
        imag: e.imag,
        magnitude: mag,
        frequencyRadS: mag,
        frequencyHz: mag / (2.0 * Math.PI),
        dampingRatio: damping,
        isStable: e.real <= 1e-9,
      };
    });
  }

  // QR algorithm with shifts for general matrices (up to n = 20)
  const H = A.map((row) => [...row]);
  const maxIter = 100 * n;
  let iter = 0;
  let m = n - 1;

  const results: { real: number; imag: number }[] = [];

  while (m >= 1 && iter < maxIter) {
    iter++;
    // Check if subdiagonal element is negligible
    if (Math.abs(H[m]![m - 1]!) < 1e-10 * (Math.abs(H[m - 1]![m - 1]!) + Math.abs(H[m]![m]!))) {
      results.push({ real: H[m]![m]!, imag: 0.0 });
      m--;
      continue;
    }

    // Wilkinson shift from bottom 2x2 submatrix
    const d = (H[m - 1]![m - 1]! - H[m]![m]!) / 2.0;
    const signD = d >= 0 ? 1 : -1;
    const subDiagSq = H[m]![m - 1]! * H[m - 1]![m]!;
    const mu = H[m]![m]! - (signD * subDiagSq) / (Math.abs(d) + Math.sqrt(d * d + subDiagSq + 1e-15));

    // Shift: H - mu I
    for (let i = 0; i <= m; i++) {
      const row = H[i];
      if (row) {
        const cur = row[i];
        if (cur !== undefined) {
          row[i] = cur - mu;
        }
      }
    }

    // QR factorization using Givens rotations
    const cList: number[] = [];
    const sList: number[] = [];
    for (let i = 0; i < m; i++) {
      const aVal = H[i]![i]!;
      const bVal = H[i + 1]![i]!;
      const r = Math.sqrt(aVal * aVal + bVal * bVal);
      const c = r > 1e-15 ? aVal / r : 1.0;
      const s = r > 1e-15 ? -bVal / r : 0.0;
      cList.push(c);
      sList.push(s);

      // Premultiply rows i and i+1 by Givens matrix G
      for (let j = i; j <= m; j++) {
        const u = H[i]![j]!;
        const v = H[i + 1]![j]!;
        H[i]![j] = c * u - s * v;
        H[i + 1]![j] = s * u + c * v;
      }
    }

    // Postmultiply columns by G^T: R * Q
    for (let i = 0; i < m; i++) {
      const c = cList[i]!;
      const s = sList[i]!;
      for (let row = 0; row <= Math.min(i + 2, m); row++) {
        const u = H[row]![i]!;
        const v = H[row]![i + 1]!;
        H[row]![i] = c * u - s * v;
        H[row]![i + 1] = s * u + c * v;
      }
    }

    // Add back shift
    for (let i = 0; i <= m; i++) {
      const row = H[i];
      if (row) {
        const cur = row[i];
        if (cur !== undefined) {
          row[i] = cur + mu;
        }
      }
    }
  }

  if (m === 0) {
    results.push({ real: H[0]![0]!, imag: 0.0 });
  }

  return results.map((e) => {
    const mag = Math.sqrt(e.real * e.real + e.imag * e.imag);
    const damping = mag > 1e-12 ? -e.real / mag : 0.0;
    return {
      real: e.real,
      imag: e.imag,
      magnitude: mag,
      frequencyRadS: mag,
      frequencyHz: mag / (2.0 * Math.PI),
      dampingRatio: damping,
      isStable: e.real <= 1e-9,
    };
  });
}

/**
 * Computes frequency response G(jw) = C (jw I - A)^(-1) B + D across logarithmic frequency grid.
 */
export function computeBodePlot(
  sys: LinearSystemModel,
  options?: {
    minFreqRadS?: number | undefined;
    maxFreqRadS?: number | undefined;
    points?: number | undefined;
  },
): BodePlotData {
  const minFreq = options?.minFreqRadS ?? 0.01;
  const maxFreq = options?.maxFreqRadS ?? 1000.0;
  const numPoints = options?.points ?? 100;

  const frequencies: number[] = [];
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const dLog = (logMax - logMin) / Math.max(1, numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    frequencies.push(Math.pow(10, logMin + i * dLog));
  }

  const channels: {
    inputName: string;
    outputName: string;
    magnitudeDb: number[];
    phaseDeg: number[];
  }[] = [];

  const n = sys.A.length;
  const m = sys.inputNames.length;
  const p = sys.outputNames.length;

  for (let inIdx = 0; inIdx < m; inIdx++) {
    for (let outIdx = 0; outIdx < p; outIdx++) {
      const magList: number[] = [];
      const phaseList: number[] = [];

      for (const w of frequencies) {
        let gReal = sys.D[outIdx]![inIdx]!;
        let gImag = 0.0;

        if (n > 0) {
          // Solve complex system (j*w*I - A) * X = B[:, inIdx]
          // Re(M) = -A, Im(M) = w*I
          const X = solveComplexSystem(
            sys.A,
            w,
            sys.B.map((row) => row[inIdx]!),
          );
          if (X) {
            // y = C * X + D
            for (let k = 0; k < n; k++) {
              const cVal = sys.C[outIdx]![k]!;
              gReal += cVal * X[k]!.real;
              gImag += cVal * X[k]!.imag;
            }
          }
        }

        const mag = Math.sqrt(gReal * gReal + gImag * gImag);
        const magDb = 20.0 * Math.log10(Math.max(1e-15, mag));
        let phase = (Math.atan2(gImag, gReal) * 180.0) / Math.PI;

        magList.push(magDb);
        phaseList.push(phase);
      }

      // Continuous phase unwrapping
      for (let k = 1; k < phaseList.length; k++) {
        let diff = phaseList[k]! - phaseList[k - 1]!;
        while (diff > 180) {
          phaseList[k]! -= 360;
          diff -= 360;
        }
        while (diff < -180) {
          phaseList[k]! += 360;
          diff += 360;
        }
      }

      channels.push({
        inputName: sys.inputNames[inIdx]!,
        outputName: sys.outputNames[outIdx]!,
        magnitudeDb: magList,
        phaseDeg: phaseList,
      });
    }
  }

  return {
    frequenciesRadS: frequencies,
    channels,
  };
}

/**
 * Solves (j*w*I - A) * X = b for complex vector X.
 * Uses 2n x 2n equivalent real system:
 * [ -A   -w*I ] [ X_re ] = [ b ]
 * [  w*I  -A  ] [ X_im ]   [ 0 ]
 */
function solveComplexSystem(A: number[][], w: number, b: number[]): { real: number; imag: number }[] | null {
  const n = A.length;
  const dim = 2 * n;
  const M: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0.0));
  const rhs: number[] = new Array(dim).fill(0.0);

  for (let i = 0; i < n; i++) {
    rhs[i] = b[i]!;
    rhs[i + n] = 0.0;

    for (let j = 0; j < n; j++) {
      M[i]![j] = -A[i]![j]!;
      M[i + n]![j + n] = -A[i]![j]!;
    }
    const rowA = M[i];
    const rowB = M[i + n];
    if (rowA) {
      const curA = rowA[i + n];
      if (curA !== undefined) {
        rowA[i + n] = curA - w;
      }
    }
    if (rowB) {
      const curB = rowB[i];
      if (curB !== undefined) {
        rowB[i] = curB + w;
      }
    }
  }

  // Gaussian elimination
  for (let col = 0; col < dim; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let row = col + 1; row < dim; row++) {
      const val = Math.abs(M[row]![col]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return null;

    const tmpR = M[col]!;
    M[col] = M[maxRow]!;
    M[maxRow] = tmpR;

    const tmpB = rhs[col]!;
    rhs[col] = rhs[maxRow]!;
    rhs[maxRow] = tmpB;

    for (let row = col + 1; row < dim; row++) {
      const rowM = M[row];
      const colM = M[col];
      const diagVal = colM ? colM[col] : undefined;
      const curRowVal = rowM ? rowM[col] : undefined;
      if (!rowM || !colM || diagVal === undefined || curRowVal === undefined) continue;
      const factor = curRowVal / diagVal;
      for (let k = col; k < dim; k++) {
        const rVal = rowM[k];
        const cVal = colM[k];
        if (rVal !== undefined && cVal !== undefined) {
          rowM[k] = rVal - factor * cVal;
        }
      }
      const rhsRowVal = rhs[row];
      const rhsColVal = rhs[col];
      if (rhsRowVal !== undefined && rhsColVal !== undefined) {
        rhs[row] = rhsRowVal - factor * rhsColVal;
      }
    }
  }

  const sol = new Array(dim).fill(0.0);
  for (let row = dim - 1; row >= 0; row--) {
    let sum = rhs[row]!;
    for (let col = row + 1; col < dim; col++) sum -= M[row]![col]! * sol[col]!;
    sol[row] = sum / M[row]![row]!;
  }

  const result: { real: number; imag: number }[] = [];
  for (let i = 0; i < n; i++) {
    result.push({ real: sol[i]!, imag: sol[i + n]! });
  }
  return result;
}
