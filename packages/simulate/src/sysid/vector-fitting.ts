// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Gustavsen-Semlyen Vector Fitting & Passivity Enforcement.
 *
 * Fits a rational transfer function:
 *   H(s) = d + sum_{k=1}^N r_k / (s - p_k)
 * to tabulated complex frequency-domain data (Touchstone S-parameters, IBIS, EMT wideband lines),
 * enforces pole stability (Re(p_k) < 0), converts to real state-space (A, B, C, D), and
 * optionally enforces scattering passivity (|H(j*omega)| <= 1).
 */

import { solveDenseLinear } from "@modelscript/runtime";

export interface VectorFitOptions {
  readonly order?: number | undefined;
  readonly maxIterations?: number | undefined;
  readonly enforcePassivity?: boolean | undefined;
}

export interface VectorFitResult {
  readonly poles: Float64Array;
  readonly residues: Float64Array;
  readonly d: number;
  readonly A: number[][];
  readonly B: number[][];
  readonly C: number[][];
  readonly D: number[][];
  readonly rmsError: number;
  readonly isPassive: boolean;
  readonly maxMagnitude: number;
}

/**
 * Evaluates scalar rational model H(j*omega) = d + sum_k r_k / (j*omega - p_k) for real poles.
 */
export function evalRationalResponse(
  poles: Readonly<Float64Array>,
  residues: Readonly<Float64Array>,
  d: number,
  omega: number,
): { re: number; im: number } {
  let re = d;
  let im = 0.0;
  for (let k = 0; k < poles.length; k++) {
    const p = poles[k]!;
    const r = residues[k]!;
    // 1 / (j*w - p) = (-p - j*w) / (p^2 + w^2)
    const denom = p * p + omega * omega + 1e-30;
    re += (r * -p) / denom;
    im += (r * -omega) / denom;
  }
  return { re, im };
}

/**
 * Fits a stable real-pole rational model to frequency-domain response H(j*2*pi*f)
 * via iterative Sanathanan-Koerner / Vector Fitting pole relocation.
 */
export function vectorFit(
  frequenciesHz: readonly number[],
  responseReal: readonly number[],
  responseImag: readonly number[],
  opts?: VectorFitOptions,
): VectorFitResult {
  const nFreq = frequenciesHz.length;
  const order = Math.max(1, Math.min(opts?.order ?? 4, Math.floor(nFreq / 2)));
  const maxIter = opts?.maxIterations ?? 8;

  const omegas = new Float64Array(nFreq);
  let fMin = Infinity;
  let fMax = 0;
  for (let i = 0; i < nFreq; i++) {
    const f = Math.max(1e-3, frequenciesHz[i]!);
    omegas[i] = 2 * Math.PI * f;
    if (f < fMin) fMin = f;
    if (f > fMax) fMax = f;
  }

  // Logarithmically spaced initial stable real poles in left half-plane
  const poles = new Float64Array(order);
  const logMin = Math.log10(Math.max(1e-3, fMin));
  const logMax = Math.log10(Math.max(fMin * 10, fMax));
  for (let k = 0; k < order; k++) {
    const frac = order === 1 ? 0.5 : k / (order - 1);
    const fk = Math.pow(10, logMin + frac * (logMax - logMin));
    poles[k] = -2 * Math.PI * fk;
  }

  // Helper: fit residues r_k and d for fixed poles via real normal equations
  const fitResidues = (curPoles: Float64Array): { residues: Float64Array; d: number } => {
    const m = order + 1; // [r_0..r_{N-1}, d]
    const ATA = new Float64Array(m * m);
    const ATb = new Float64Array(m);
    const rowRe = new Float64Array(m);
    const rowIm = new Float64Array(m);

    for (let i = 0; i < nFreq; i++) {
      const w = omegas[i]!;
      for (let k = 0; k < order; k++) {
        const p = curPoles[k]!;
        const denom = p * p + w * w + 1e-30;
        rowRe[k] = -p / denom;
        rowIm[k] = -w / denom;
      }
      rowRe[order] = 1.0;
      rowIm[order] = 0.0;
      const yr = responseReal[i]!;
      const yi = responseImag[i]!;

      for (let r = 0; r < m; r++) {
        ATb[r] = ATb[r]! + rowRe[r]! * yr + rowIm[r]! * yi;
        for (let c = 0; c < m; c++) {
          ATA[r * m + c] = ATA[r * m + c]! + rowRe[r]! * rowRe[c]! + rowIm[r]! * rowIm[c]!;
        }
      }
    }
    for (let r = 0; r < m; r++) ATA[r * m + r] = ATA[r * m + r]! + 1e-12;
    const sol = solveDenseLinear(ATA, ATb, m);
    return { residues: sol.subarray(0, order), d: sol[order]! };
  };

  // Iterative pole relocation (Vector Fitting stage 1)
  for (let iter = 0; iter < maxIter; iter++) {
    // Solve weighted LS: sum_k c_k/(s - p_k) + d - H(s)*(sum_k c~_k/(s - p_k)) = H(s)
    const m = 2 * order + 1;
    const ATA = new Float64Array(m * m);
    const ATb = new Float64Array(m);
    const rowRe = new Float64Array(m);
    const rowIm = new Float64Array(m);

    for (let i = 0; i < nFreq; i++) {
      const w = omegas[i]!;
      const hr = responseReal[i]!;
      const hi = responseImag[i]!;
      for (let k = 0; k < order; k++) {
        const p = poles[k]!;
        const denom = p * p + w * w + 1e-30;
        const br = -p / denom;
        const bi = -w / denom;
        rowRe[k] = br;
        rowIm[k] = bi;
        // -H(jw) * (br + j*bi)
        rowRe[order + 1 + k] = -(hr * br - hi * bi);
        rowIm[order + 1 + k] = -(hr * bi + hi * br);
      }
      rowRe[order] = 1.0;
      rowIm[order] = 0.0;

      for (let r = 0; r < m; r++) {
        ATb[r] = ATb[r]! + rowRe[r]! * hr + rowIm[r]! * hi;
        for (let c = 0; c < m; c++) {
          ATA[r * m + c] = ATA[r * m + c]! + rowRe[r]! * rowRe[c]! + rowIm[r]! * rowIm[c]!;
        }
      }
    }
    for (let r = 0; r < m; r++) ATA[r * m + r] = ATA[r * m + r]! + 1e-10;
    const sol = solveDenseLinear(ATA, ATb, m);

    // Update poles via diagonal shift approximation of zeros of sigma(s) = 1 + sum c~_k / (s - p_k)
    let maxShift = 0;
    for (let k = 0; k < order; k++) {
      const cTilde = sol[order + 1 + k]!;
      let nextP = poles[k]! - 0.5 * cTilde;
      // Flip unstable poles into left half-plane
      if (nextP >= -1e-6) nextP = -Math.abs(nextP) - 1e-3;
      maxShift = Math.max(maxShift, Math.abs(nextP - poles[k]!) / (Math.abs(poles[k]!) + 1));
      poles[k] = nextP;
    }
    if (maxShift < 1e-4) break;
  }

  let { residues, d } = fitResidues(poles);

  const computeMetrics = (res: Float64Array, dVal: number): { rms: number; maxMag: number } => {
    let err2 = 0;
    let maxMag = 0;
    for (let i = 0; i < nFreq; i++) {
      const h = evalRationalResponse(poles, res, dVal, omegas[i]!);
      const mag = Math.hypot(h.re, h.im);
      if (mag > maxMag) maxMag = mag;
      const dr = h.re - responseReal[i]!;
      const di = h.im - responseImag[i]!;
      err2 += dr * dr + di * di;
    }
    return { rms: Math.sqrt(err2 / Math.max(1, nFreq)), maxMag };
  };

  let metrics = computeMetrics(residues, d);

  // Optional scattering passivity enforcement (|H(jw)| <= 1) via minimal scaling
  if (opts?.enforcePassivity && metrics.maxMag > 1.0) {
    const scale = 0.9999 / metrics.maxMag;
    const scaledRes = new Float64Array(order);
    for (let k = 0; k < order; k++) scaledRes[k] = residues[k]! * scale;
    residues = scaledRes;
    d *= scale;
    metrics = computeMetrics(residues, d);
  }

  // Realize diagonal state-space (A, B, C, D)
  const A: number[][] = Array.from({ length: order }, (_, i) =>
    Array.from({ length: order }, (_, j) => (i === j ? poles[i]! : 0)),
  );
  const B: number[][] = Array.from({ length: order }, () => [1.0]);
  const C: number[][] = [Array.from(residues)];
  const D: number[][] = [[d]];

  return {
    poles,
    residues,
    d,
    A,
    B,
    C,
    D,
    rmsError: metrics.rms,
    isPassive: metrics.maxMag <= 1.0 + 1e-6,
    maxMagnitude: metrics.maxMag,
  };
}
