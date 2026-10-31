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

  // Upper Hessenberg reduction via Householder reflections for general n >= 3
  const H = A.map((row) => [...row]);
  for (let k = 0; k < n - 2; k++) {
    let normSq = 0.0;
    for (let i = k + 1; i < n; i++) {
      const val = H[i]![k]!;
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq);
    if (norm < 1e-15) continue;

    const x0 = H[k + 1]![k]!;
    const sign = x0 >= 0 ? 1.0 : -1.0;
    const u0 = x0 + sign * norm;
    const v = new Array(n - (k + 1)).fill(0.0);
    v[0] = 1.0;
    let vNormSq = 1.0;
    for (let i = k + 2; i < n; i++) {
      const vi = H[i]![k]! / u0;
      v[i - (k + 1)] = vi;
      vNormSq += vi * vi;
    }
    const beta = 2.0 / vNormSq;

    // Premultiply H[k+1..n-1, k..n-1] by (I - beta * v * v^T)
    for (let j = k; j < n; j++) {
      let dot = 0.0;
      for (let i = k + 1; i < n; i++) {
        dot += v[i - (k + 1)]! * H[i]![j]!;
      }
      dot *= beta;
      for (let i = k + 1; i < n; i++) {
        H[i]![j] = H[i]![j]! - dot * v[i - (k + 1)]!;
      }
    }

    // Postmultiply H[0..n-1, k+1..n-1] by (I - beta * v * v^T)
    for (let i = 0; i < n; i++) {
      let dot = 0.0;
      for (let j = k + 1; j < n; j++) {
        dot += H[i]![j]! * v[j - (k + 1)]!;
      }
      dot *= beta;
      for (let j = k + 1; j < n; j++) {
        H[i]![j] = H[i]![j]! - dot * v[j - (k + 1)]!;
      }
    }
  }

  const maxIter = 200 * n;
  let iter = 0;
  let m = n - 1;

  const results: { real: number; imag: number }[] = [];

  function push2x2Block(a: number, b: number, c: number, d: number): void {
    const tr = a + d;
    const det = a * d - b * c;
    const disc = tr * tr - 4.0 * det;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      results.push({ real: (tr + sqrtDisc) / 2.0, imag: 0.0 });
      results.push({ real: (tr - sqrtDisc) / 2.0, imag: 0.0 });
    } else {
      const sqrtDisc = Math.sqrt(-disc);
      results.push({ real: tr / 2.0, imag: sqrtDisc / 2.0 });
      results.push({ real: tr / 2.0, imag: -sqrtDisc / 2.0 });
    }
  }

  while (m >= 1 && iter < maxIter) {
    iter++;
    // 1. Check if 1x1 subdiagonal element H[m][m-1] is negligible
    const scale1 = Math.abs(H[m - 1]![m - 1]!) + Math.abs(H[m]![m]!) + 1e-15;
    if (Math.abs(H[m]![m - 1]!) < 1e-10 * scale1) {
      results.push({ real: H[m]![m]!, imag: 0.0 });
      m--;
      continue;
    }

    // 2. Check if 2x2 block at [m-1..m, m-1..m] is decoupled
    const is2x2Decoupled =
      m === 1 ||
      Math.abs(H[m - 1]![m - 2]!) < 1e-10 * (Math.abs(H[m - 2]![m - 2]!) + Math.abs(H[m - 1]![m - 1]!) + 1e-15);

    if (is2x2Decoupled) {
      const a = H[m - 1]![m - 1]!;
      const b = H[m - 1]![m]!;
      const c = H[m]![m - 1]!;
      const d = H[m]![m]!;
      const tr = a + d;
      const det = a * d - b * c;
      const disc = tr * tr - 4.0 * det;
      // Deflate 2x2 block immediately if complex conjugate or m === 1
      if (disc < 0 || m === 1) {
        push2x2Block(a, b, c, d);
        m -= 2;
        continue;
      }
    }

    // Wilkinson shift from bottom 2x2 submatrix
    const a2 = H[m - 1]![m - 1]!;
    const b2 = H[m - 1]![m]!;
    const c2 = H[m]![m - 1]!;
    const d2 = H[m]![m]!;
    const tr2 = a2 + d2;
    const det2 = a2 * d2 - b2 * c2;
    const disc2 = tr2 * tr2 - 4.0 * det2;

    // Exceptional shift every 30 iterations to break symmetry / stagnation on pure imaginary or companion matrices
    let mu: number;
    if (iter % 30 === 0) {
      mu = d2 + 0.75 * Math.abs(c2);
    } else if (disc2 >= 0) {
      const s = Math.sqrt(disc2);
      const l1 = (tr2 + s) / 2.0;
      const l2 = (tr2 - s) / 2.0;
      mu = Math.abs(l1 - d2) < Math.abs(l2 - d2) ? l1 : l2;
    } else {
      mu = tr2 / 2.0;
    }

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

  // Extract any remaining blocks if iteration limit was reached
  while (m >= 0) {
    if (m === 0) {
      results.push({ real: H[0]![0]!, imag: 0.0 });
      m--;
    } else {
      push2x2Block(H[m - 1]![m - 1]!, H[m - 1]![m]!, H[m]![m - 1]!, H[m]![m]!);
      m -= 2;
    }
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

  const dim = 2 * n;
  const scratchM = new Float64Array(dim * dim);
  const scratchRhs = new Float64Array(dim);
  const scratchSol = new Float64Array(dim);
  const outX: { real: number; imag: number }[] = Array.from({ length: n }, () => ({ real: 0, imag: 0 }));
  const bCol = new Float64Array(n);

  for (let inIdx = 0; inIdx < m; inIdx++) {
    for (let i = 0; i < n; i++) {
      bCol[i] = sys.B[i]![inIdx]!;
    }

    for (let outIdx = 0; outIdx < p; outIdx++) {
      const magList: number[] = [];
      const phaseList: number[] = [];

      for (const w of frequencies) {
        let gReal = sys.D[outIdx]![inIdx]!;
        let gImag = 0.0;

        if (n > 0) {
          // Solve complex system (j*w*I - A) * X = B[:, inIdx]
          const ok = solveComplexSystem(sys.A, w, bCol, scratchM, scratchRhs, scratchSol, outX);
          if (ok) {
            // y = C * X + D
            for (let k = 0; k < n; k++) {
              const cVal = sys.C[outIdx]![k]!;
              gReal += cVal * outX[k]!.real;
              gImag += cVal * outX[k]!.imag;
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
 * Uses 2n x 2n equivalent real system on flat Float64Array scratch buffers:
 * [ -A   -w*I ] [ X_re ] = [ b ]
 * [  w*I  -A  ] [ X_im ]   [ 0 ]
 */
function solveComplexSystem(
  A: number[][],
  w: number,
  b: Float64Array,
  scratchM: Float64Array,
  scratchRhs: Float64Array,
  scratchSol: Float64Array,
  outResult: { real: number; imag: number }[],
): boolean {
  const n = b.length;
  const dim = 2 * n;

  scratchM.fill(0);
  for (let i = 0; i < n; i++) {
    scratchRhs[i] = b[i]!;
    scratchRhs[i + n] = 0.0;

    const rowOffset1 = i * dim;
    const rowOffset2 = (i + n) * dim;
    const aRow = A[i]!;

    for (let j = 0; j < n; j++) {
      const aVal = -aRow[j]!;
      scratchM[rowOffset1 + j] = aVal;
      scratchM[rowOffset2 + j + n] = aVal;
    }
    scratchM[rowOffset1 + i + n] = scratchM[rowOffset1 + i + n]! - w;
    scratchM[rowOffset2 + i] = scratchM[rowOffset2 + i]! + w;
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < dim; col++) {
    let maxRow = col;
    let maxVal = Math.abs(scratchM[col * dim + col]!);
    for (let row = col + 1; row < dim; row++) {
      const val = Math.abs(scratchM[row * dim + col]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return false;

    // Swap rows in scratchM
    if (maxRow !== col) {
      const r1 = col * dim;
      const r2 = maxRow * dim;
      for (let k = 0; k < dim; k++) {
        const tmp = scratchM[r1 + k]!;
        scratchM[r1 + k] = scratchM[r2 + k]!;
        scratchM[r2 + k] = tmp;
      }
      const tmpB = scratchRhs[col]!;
      scratchRhs[col] = scratchRhs[maxRow]!;
      scratchRhs[maxRow] = tmpB;
    }

    const diagVal = scratchM[col * dim + col]!;
    for (let row = col + 1; row < dim; row++) {
      const rOffset = row * dim;
      const curRowVal = scratchM[rOffset + col]!;
      if (curRowVal === 0.0) continue;
      const factor = curRowVal / diagVal;
      for (let k = col; k < dim; k++) {
        scratchM[rOffset + k] = scratchM[rOffset + k]! - factor * scratchM[col * dim + k]!;
      }
      scratchRhs[row] = scratchRhs[row]! - factor * scratchRhs[col]!;
    }
  }

  // Back-substitution
  for (let row = dim - 1; row >= 0; row--) {
    let sum = scratchRhs[row]!;
    const rOffset = row * dim;
    for (let col = row + 1; col < dim; col++) {
      sum -= scratchM[rOffset + col]! * scratchSol[col]!;
    }
    scratchSol[row] = sum / scratchM[rOffset + row]!;
  }

  for (let i = 0; i < n; i++) {
    outResult[i]!.real = scratchSol[i]!;
    outResult[i]!.imag = scratchSol[i + n]!;
  }
  return true;
}
