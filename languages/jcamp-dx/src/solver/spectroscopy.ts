// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Analytical Spectroscopy Numerical Solver for `@modelscript/jcamp-dx`.
 *
 * Implements:
 * - Beer-Lambert Absorbance <-> Transmittance conversion (`A = -log10(T)`, `T = 10^(-A)`)
 * - Local-extrema peak detection with topographic prominence thresholding
 * - Trapezoidal spectral band integration
 * - Savitzky-Golay polynomial least-squares smoothing
 * - Gaussian and Lorentzian absorption line-shape models
 */

import type { JcampDataPoint, SpectralPeak } from "../types.js";

/**
 * Converts Transmittance `T` (in `(0, 1]` or `(0, 100]` when `isPercent = true`) to Absorbance `A = -log10(T)`.
 */
export function transmittanceToAbsorbance(t: number, isPercent: boolean = false): number {
  const tFrac = isPercent ? t / 100 : t;
  const clamped = Math.max(tFrac, 1e-12);
  return -Math.log10(clamped);
}

/**
 * Converts Absorbance `A` to Transmittance `T = 10^(-A)` (or `%T = 100 * 10^(-A)` when `asPercent = true`).
 */
export function absorbanceToTransmittance(a: number, asPercent: boolean = false): number {
  const t = Math.pow(10, -a);
  return asPercent ? t * 100 : t;
}

/**
 * Converts a spectrum's Y axis between Absorbance and Transmittance.
 */
export function convertSpectrumY(
  points: readonly JcampDataPoint[],
  fromMode: "absorbance" | "transmittance" | "percent-transmittance",
  toMode: "absorbance" | "transmittance" | "percent-transmittance",
): JcampDataPoint[] {
  if (fromMode === toMode) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  return points.map((p) => {
    let a: number;
    if (fromMode === "absorbance") {
      a = p.y;
    } else if (fromMode === "percent-transmittance") {
      a = transmittanceToAbsorbance(p.y, true);
    } else {
      a = transmittanceToAbsorbance(p.y, false);
    }

    let yOut: number;
    if (toMode === "absorbance") {
      yOut = a;
    } else if (toMode === "percent-transmittance") {
      yOut = absorbanceToTransmittance(a, true);
    } else {
      yOut = absorbanceToTransmittance(a, false);
    }
    return { x: p.x, y: yOut };
  });
}

/**
 * Evaluates a Gaussian absorption line shape: `A * exp(-(x - center)^2 / (2 * sigma^2))`.
 */
export function gaussianLineShape(x: number, center: number, amplitude: number, sigma: number): number {
  const d = (x - center) / sigma;
  return amplitude * Math.exp(-0.5 * d * d);
}

/**
 * Evaluates a Lorentzian (Cauchy) absorption line shape: `A * gamma^2 / ((x - center)^2 + gamma^2)`.
 */
export function lorentzianLineShape(x: number, center: number, amplitude: number, gamma: number): number {
  const dx = x - center;
  const g2 = gamma * gamma;
  return (amplitude * g2) / (dx * dx + g2);
}

export interface PeakFinderOptions {
  /** Detect local maxima (Absorbance, NMR, MS, Raman) or local minima (Transmittance IR). Default `"maxima"`. */
  mode?: "maxima" | "minima";
  /** Minimum topographic prominence required to accept a peak (default `0.02`). */
  minProminence?: number;
  /** Optional minimum absolute peak height (for maxima) or maximum ceiling (for minima). */
  threshold?: number;
  /** Minimum index separation between adjacent accepted peaks (default `1`). */
  minDistance?: number;
}

/**
 * Finds spectral peaks (local maxima or minima) with exact topographic prominence filtering.
 */
export function findSpectralPeaks(points: readonly JcampDataPoint[], options: PeakFinderOptions = {}): SpectralPeak[] {
  const n = points.length;
  if (n < 3) return [];

  const mode = options.mode ?? "maxima";
  const minProminence = options.minProminence ?? 0.02;
  const minDistance = Math.max(1, options.minDistance ?? 1);
  const sign = mode === "maxima" ? 1 : -1;

  // Transform signal so we always search for maxima
  const ys = points.map((p) => sign * p.y);
  const candidates: Array<{ index: number; prominence: number; height: number }> = [];

  for (let i = 1; i < n - 1; i++) {
    const curr = ys[i]!;
    if (curr > ys[i - 1]! && curr >= ys[i + 1]!) {
      if (options.threshold !== undefined) {
        if (mode === "maxima" && points[i]!.y < options.threshold) continue;
        if (mode === "minima" && points[i]!.y > options.threshold) continue;
      }

      // Compute left reference trough until a strictly higher peak is encountered
      let leftMin = curr;
      for (let l = i - 1; l >= 0; l--) {
        const v = ys[l]!;
        if (v < leftMin) leftMin = v;
        if (v > curr) break;
      }

      // Compute right reference trough until a strictly higher peak is encountered
      let rightMin = curr;
      for (let r = i + 1; r < n; r++) {
        const v = ys[r]!;
        if (v < rightMin) rightMin = v;
        if (v > curr) break;
      }

      const refBase = Math.max(leftMin, rightMin);
      const prominence = curr - refBase;
      if (prominence >= minProminence) {
        candidates.push({ index: i, prominence, height: curr });
      }
    }
  }

  // Enforce minDistance greedily by highest prominence first
  candidates.sort((a, b) => b.prominence - a.prominence);
  const selected: typeof candidates = [];
  for (const c of candidates) {
    if (selected.every((s) => Math.abs(s.index - c.index) >= minDistance)) {
      selected.push(c);
    }
  }
  selected.sort((a, b) => a.index - b.index);

  return selected.map((c) => ({
    index: c.index,
    x: points[c.index]!.x,
    y: points[c.index]!.y,
    prominence: c.prominence,
    kind: mode === "maxima" ? "maximum" : "minimum",
  }));
}

/**
 * Integrates a spectral band over `[xMin, xMax]` using the composite trapezoidal rule.
 * Automatically handles both ascending (UV/MS) and descending (IR/NMR) X axes.
 */
export function integrateBand(points: readonly JcampDataPoint[], xMin?: number, xMax?: number): number {
  if (points.length < 2) return 0;

  // Sort copy ascending by X so integration over [lo, hi] is always positive for positive Y
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const lo = xMin ?? sorted[0]!.x;
  const hi = xMax ?? sorted[sorted.length - 1]!.x;
  const lowBound = Math.min(lo, hi);
  const highBound = Math.max(lo, hi);

  let area = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i]!;
    const p1 = sorted[i + 1]!;
    if (p1.x <= lowBound || p0.x >= highBound) continue;

    // Clip segment [p0.x, p1.x] to [lowBound, highBound] with linear interpolation
    const dxTotal = p1.x - p0.x;
    if (dxTotal <= 0) continue;

    const xa = Math.max(p0.x, lowBound);
    const xb = Math.min(p1.x, highBound);
    const ya = p0.y + ((xa - p0.x) / dxTotal) * (p1.y - p0.y);
    const yb = p0.y + ((xb - p0.x) / dxTotal) * (p1.y - p0.y);
    area += 0.5 * (ya + yb) * (xb - xa);
  }
  return area;
}

/**
 * Solves a small dense linear system `A x = b` via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }
    const pivot = M[col]![col]!;
    if (Math.abs(pivot) < 1e-15) continue;

    for (let r = col + 1; r < n; r++) {
      const factor = M[r]![col]! / pivot;
      for (let c = col; c <= n; c++) {
        M[r]![c] = M[r]![c]! - factor * M[col]![c]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) {
      sum -= M[r]![c]! * x[c]!;
    }
    const diag = M[r]![r]!;
    x[r] = Math.abs(diag) > 1e-15 ? sum / diag : 0;
  }
  return x;
}

/**
 * Computes Savitzky-Golay smoothing convolution weights for an odd `windowSize` and polynomial degree `polyOrder`.
 */
export function computeSavitzkyGolayWeights(windowSize: number = 7, polyOrder: number = 2): number[] {
  const w = windowSize % 2 === 1 ? Math.max(3, windowSize) : Math.max(3, windowSize + 1);
  const p = Math.min(Math.max(1, polyOrder), w - 1);
  const half = (w - 1) >> 1;
  const cols = p + 1;

  // Build normal matrix J^T J of size (p+1) x (p+1)
  const JTJ: number[][] = Array.from({ length: cols }, () => new Array<number>(cols).fill(0));
  for (let m = -half; m <= half; m++) {
    for (let r = 0; r < cols; r++) {
      const mr = Math.pow(m, r);
      for (let c = 0; c < cols; c++) {
        JTJ[r]![c] = JTJ[r]![c]! + mr * Math.pow(m, c);
      }
    }
  }

  // Row 0 of (J^T J)^(-1) gives the 0th-derivative smoothing weights: c_m = sum_k ((JTJ)^-1)_{0,k} * m^k
  const e0 = new Array<number>(cols).fill(0);
  e0[0] = 1;
  const invRow0 = solveLinearSystem(JTJ, e0);

  const weights: number[] = [];
  for (let m = -half; m <= half; m++) {
    let val = 0;
    for (let k = 0; k < cols; k++) {
      val += invRow0[k]! * Math.pow(m, k);
    }
    weights.push(val);
  }
  return weights;
}

/**
 * Applies Savitzky-Golay least-squares polynomial smoothing to a spectrum.
 */
export function savitzkyGolaySmooth(
  points: readonly JcampDataPoint[],
  windowSize: number = 7,
  polyOrder: number = 2,
): JcampDataPoint[] {
  const n = points.length;
  const w = windowSize % 2 === 1 ? Math.max(3, windowSize) : Math.max(3, windowSize + 1);
  if (n < w) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  const weights = computeSavitzkyGolayWeights(w, polyOrder);
  const half = (w - 1) >> 1;
  const out: JcampDataPoint[] = new Array(n);

  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) {
      const idx = Math.min(n - 1, Math.max(0, i + k));
      acc += weights[k + half]! * points[idx]!.y;
    }
    out[i] = { x: points[i]!.x, y: acc };
  }

  return out;
}
