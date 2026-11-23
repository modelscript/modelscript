// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Powder X-Ray Diffraction (XRD) Simulator (default Cu-Kα λ = 1.5406 Å):
 * - Interplanar spacing d_hkl = 1 / sqrt(h^T G* h)
 * - Bragg angle 2θ = 2 arcsin(λ / (2 d_hkl))
 * - Complex structure factor F_hkl with Cromer-Mann atomic scattering factors f_j(s) & Debye-Waller factor
 * - Lorentz-polarization factor LP(θ) = (1 + cos²(2θ)) / (sin²θ cosθ)
 * - Broadened pseudo-Voigt diffraction profile generation
 */

import type {
  CrystalStructure,
  ExpandedAtom,
  MetricTensorResult,
  XrdPeak,
  XrdProfilePoint,
  XrdSimulationResult,
} from "../types.js";
import { computeMetricTensor, expandSymmetrySites } from "./crystallography.js";
import { atomicScatteringFactor } from "./elements.js";

/** Standard Cu-Kα1 X-ray wavelength in Ångströms. */
export const CU_K_ALPHA_WAVELENGTH = 1.5406;

export interface XrdSimulationOptions {
  /** Incident X-ray wavelength in Å (default: Cu-Kα 1.5406 Å). */
  wavelength?: number;
  /** Minimum 2θ in degrees (default: 5). */
  twoThetaMin?: number;
  /** Maximum 2θ in degrees (default: 90). */
  twoThetaMax?: number;
  /** Step size in degrees for broadened profile (default: 0.2). */
  profileStep?: number;
  /** FWHM broadening in degrees for pseudo-Voigt profile (default: 0.35). */
  fwhm?: number;
  /** Minimum relative intensity threshold (0..100) to keep a peak (default: 0.1). */
  minRelativeIntensity?: number;
}

/**
 * Computes interplanar spacing d_hkl (Å) from reciprocal metric tensor G*.
 */
export function computeDSpacing(metric: MetricTensorResult, h: number, k: number, l: number): number {
  const gs = metric.GStar;
  const invD2 =
    gs[0][0] * h * h +
    gs[1][1] * k * k +
    gs[2][2] * l * l +
    2 * (gs[0][1] * h * k + gs[0][2] * h * l + gs[1][2] * k * l);
  if (invD2 <= 1e-12) return Number.POSITIVE_INFINITY;
  return 1 / Math.sqrt(invD2);
}

/**
 * Computes Bragg angle 2θ (degrees) from interplanar spacing d (Å) and wavelength λ (Å).
 * Returns `null` if λ / (2d) > 1 (outside Ewald sphere).
 */
export function computeBraggTwoTheta(dSpacing: number, wavelength = CU_K_ALPHA_WAVELENGTH): number | null {
  const sinTheta = wavelength / (2 * dSpacing);
  if (sinTheta <= 0 || sinTheta >= 1) return null;
  return (2 * Math.asin(sinTheta) * 180) / Math.PI;
}

/**
 * Scores an (h,k,l) triple to prefer positive, descending Miller indices as canonical display representative.
 */
function hklCanonicalScore(h: number, k: number, l: number): number {
  const nonNeg = (h >= 0 ? 1 : 0) + (k >= 0 ? 1 : 0) + (l >= 0 ? 1 : 0);
  const descending = (h >= k ? 1 : 0) + (k >= l ? 1 : 0);
  return nonNeg * 1000 + descending * 100 + h * 10 + k * 3 + l;
}

/**
 * Simulates a powder XRD pattern (peaks + broadened 2θ profile) for a crystal structure.
 */
export function simulatePowderXrd(
  structure: CrystalStructure,
  options: XrdSimulationOptions = {},
  precomputedMetric?: MetricTensorResult,
  precomputedAtoms?: ExpandedAtom[],
): XrdSimulationResult {
  const wavelength = options.wavelength ?? structure.wavelength ?? CU_K_ALPHA_WAVELENGTH;
  const twoThetaMin = options.twoThetaMin ?? 5;
  const twoThetaMax = options.twoThetaMax ?? 90;
  const profileStep = options.profileStep ?? 0.25;
  const fwhm = options.fwhm ?? 0.35;
  const minRel = options.minRelativeIntensity ?? 0.1;

  const metric = precomputedMetric ?? computeMetricTensor(structure.cell);
  const atoms = precomputedAtoms ?? expandSymmetrySites(structure, metric);

  if (metric.volume <= 0 || atoms.length === 0) {
    return {
      wavelength,
      twoThetaMin,
      twoThetaMax,
      peaks: [],
      profile: [],
    };
  }

  const maxSinTheta = Math.sin(((Math.min(twoThetaMax, 179) / 2) * Math.PI) / 180);
  const dMin = wavelength / (2 * maxSinTheta);

  // Upper bounds for Miller indices based on direct lattice lengths
  const hMax = Math.min(12, Math.max(1, Math.ceil(structure.cell.a / dMin)));
  const kMax = Math.min(12, Math.max(1, Math.ceil(structure.cell.b / dMin)));
  const lMax = Math.min(12, Math.max(1, Math.ceil(structure.cell.c / dMin)));

  interface PeakBucket {
    twoThetaSum: number;
    dSpacingSum: number;
    fSquaredSum: number;
    lpFactor: number;
    rawIntensity: number;
    multiplicity: number;
    bestHkl: [number, number, number];
    bestScore: number;
  }

  const buckets = new Map<number, PeakBucket>();
  const twoPi = 2 * Math.PI;

  for (let h = -hMax; h <= hMax; h++) {
    for (let k = -kMax; k <= kMax; k++) {
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;

        const d = computeDSpacing(metric, h, k, l);
        if (d < dMin) continue;

        const sinTheta = wavelength / (2 * d);
        if (sinTheta <= 0 || sinTheta >= 1) continue;

        const thetaRad = Math.asin(sinTheta);
        const twoTheta = (2 * thetaRad * 180) / Math.PI;
        if (twoTheta < twoThetaMin || twoTheta > twoThetaMax) continue;

        const s = sinTheta / wavelength; // = 1 / (2d)
        const s2 = s * s;

        let re = 0;
        let im = 0;
        for (let a = 0; a < atoms.length; a++) {
          const atom = atoms[a]!;
          const f = atomicScatteringFactor(atom.symbol, s);
          const dw = Math.exp(-atom.bIso * s2);
          const amp = atom.occupancy * f * dw;
          const phase = twoPi * (h * atom.fract[0] + k * atom.fract[1] + l * atom.fract[2]);
          re += amp * Math.cos(phase);
          im += amp * Math.sin(phase);
        }

        const fSquared = re * re + im * im;
        if (fSquared < 1e-4) continue; // Systematic absence

        const cosTheta = Math.cos(thetaRad);
        const cos2Theta = Math.cos(2 * thetaRad);
        const lp = (1 + cos2Theta * cos2Theta) / (sinTheta * sinTheta * cosTheta);
        const intensity = fSquared * lp;

        // Group reflections within 0.01° in 2θ
        const binKey = Math.round(twoTheta * 100);
        const score = hklCanonicalScore(h, k, l);
        const existing = buckets.get(binKey);
        if (existing) {
          existing.twoThetaSum += twoTheta;
          existing.dSpacingSum += d;
          existing.fSquaredSum += fSquared;
          existing.rawIntensity += intensity;
          existing.multiplicity += 1;
          if (score > existing.bestScore) {
            existing.bestScore = score;
            existing.bestHkl = [h, k, l];
          }
        } else {
          buckets.set(binKey, {
            twoThetaSum: twoTheta,
            dSpacingSum: d,
            fSquaredSum: fSquared,
            lpFactor: lp,
            rawIntensity: intensity,
            multiplicity: 1,
            bestHkl: [h, k, l],
            bestScore: score,
          });
        }
      }
    }
  }

  let maxRaw = 0;
  for (const b of buckets.values()) {
    if (b.rawIntensity > maxRaw) maxRaw = b.rawIntensity;
  }

  const peaks: XrdPeak[] = [];
  if (maxRaw > 0) {
    for (const b of buckets.values()) {
      const rel = (b.rawIntensity / maxRaw) * 100;
      if (rel < minRel) continue;
      peaks.push({
        hkl: b.bestHkl,
        multiplicity: b.multiplicity,
        dSpacing: b.dSpacingSum / b.multiplicity,
        twoTheta: b.twoThetaSum / b.multiplicity,
        fSquared: b.fSquaredSum / b.multiplicity,
        lpFactor: b.lpFactor,
        rawIntensity: b.rawIntensity,
        relativeIntensity: rel,
      });
    }
  }

  peaks.sort((a, b) => a.twoTheta - b.twoTheta);

  // Generate broadened pseudo-Voigt (50% Gaussian + 50% Lorentzian) profile
  const profile: XrdProfilePoint[] = [];
  const halfFwhm = fwhm / 2;
  const sigma = fwhm / (2 * Math.sqrt(2 * Math.LN2));
  const twoSigma2 = 2 * sigma * sigma;
  const gamma2 = halfFwhm * halfFwhm;

  for (let tt = twoThetaMin; tt <= twoThetaMax + 1e-9; tt += profileStep) {
    let val = 0;
    for (const p of peaks) {
      const dt = tt - p.twoTheta;
      if (Math.abs(dt) > fwhm * 8) continue;
      const gauss = Math.exp(-(dt * dt) / twoSigma2);
      const lorentz = gamma2 / (dt * dt + gamma2);
      val += p.relativeIntensity * (0.5 * gauss + 0.5 * lorentz);
    }
    profile.push({ twoTheta: Number(tt.toFixed(4)), intensity: val });
  }

  return {
    wavelength,
    twoThetaMin,
    twoThetaMax,
    peaks,
    profile,
  };
}
