// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Flux-Weighted Multigroup Cross-Section Collapse.
 *
 * Computes group-averaged microscopic cross-sections:
 *   sigma_g = integral_{E_low}^{E_high} sigma(E) * phi(E) dE / integral_{E_low}^{E_high} phi(E) dE
 *
 * Supports Maxwellian thermal + 1/E epithermal slowing-down weighting spectra,
 * pure 1/E, pure Maxwellian, and flat weighting.
 */

import type { Endf6Material, Endf6Tab1Record } from "../types.js";
import { evaluateTab1 } from "./interpolation.js";

export type WeightSpectrumKind = "maxwellian-1/E" | "1/E" | "maxwellian" | "flat";

export interface MultigroupCollapseOptions {
  /** Weighting spectrum shape (default: `"maxwellian-1/E"`). */
  spectrum?: WeightSpectrumKind | undefined;
  /** Thermal temperature k_B * T in eV (default: `0.0253` eV = 293.6 K). */
  thermalKT?: number | undefined;
  /** Thermal-to-epithermal junction energy in eV (default: `0.125` eV). */
  epithermalCutoff?: number | undefined;
  /** Number of quadrature subdivisions per energy group (default: `64`). */
  subdivisions?: number | undefined;
}

export interface MultigroupValue {
  /** 1-based group index (group 1 = lowest energy or ordered by `groupBounds`). */
  group: number;
  /** Lower energy boundary (eV). */
  eLow: number;
  /** Upper energy boundary (eV). */
  eHigh: number;
  /** Flux-weighted group-averaged cross-section (barns). */
  sigma: number;
  /** Integrated group weighting flux (arbitrary units). */
  fluxIntegral: number;
}

export interface MaterialMultigroupConstants {
  mat: number;
  za: number;
  name: string;
  groupBounds: number[];
  groups: Array<{
    group: number;
    eLow: number;
    eHigh: number;
    sigmaTotal: number;
    sigmaElastic: number;
    sigmaFission: number;
    sigmaCapture: number;
    fluxIntegral: number;
  }>;
}

/** Standard 2-group thermal / fast energy boundaries (eV): `[1e-5, 0.625, 2e7]`. */
export const DEFAULT_TWO_GROUP_BOUNDS: readonly number[] = [1e-5, 0.625, 2.0e7];

/** Standard 4-group energy boundaries (eV): thermal, epithermal, resonance, fast. */
export const DEFAULT_FOUR_GROUP_BOUNDS: readonly number[] = [1e-5, 0.625, 5530.0, 8.21e5, 2.0e7];

/**
 * Evaluates the continuous neutron weighting flux spectrum `phi(E)` at energy `E` (eV).
 */
export function evaluateWeightSpectrum(energyEv: number, options?: MultigroupCollapseOptions): number {
  if (energyEv <= 0) return 0;
  const kind = options?.spectrum ?? "maxwellian-1/E";
  const kT = options?.thermalKT ?? 0.0253;
  const eCut = options?.epithermalCutoff ?? 0.125;

  switch (kind) {
    case "flat":
      return 1.0;

    case "1/E":
      return 1.0 / energyEv;

    case "maxwellian":
      return (energyEv / (kT * kT)) * Math.exp(-energyEv / kT);

    case "maxwellian-1/E": {
      // Smoothly match Maxwellian M(E) = (E / kT^2) * exp(-E / kT) to C / E at eCut
      const mAtCut = (eCut / (kT * kT)) * Math.exp(-eCut / kT);
      if (energyEv <= eCut) {
        return (energyEv / (kT * kT)) * Math.exp(-energyEv / kT);
      }
      return (mAtCut * eCut) / energyEv;
    }
  }
}

/**
 * Collapses a pointwise ENDF-6 `TAB1` cross-section into flux-weighted multigroup constants
 * over monotonically increasing energy boundaries `groupBounds` (`[E_0, E_1, ..., E_G]`, in eV).
 *
 * Uses composite Simpson quadrature on a logarithmic energy grid (substituting `u = ln(E)`,
 * so `dE = E du`), which integrates both `1/E` and `1/v` cross-sections to high accuracy.
 */
export function collapseMultigroup(
  tab1: Endf6Tab1Record,
  groupBounds: readonly number[],
  options?: MultigroupCollapseOptions,
): MultigroupValue[] {
  const results: MultigroupValue[] = [];
  const nSub = Math.max(8, (options?.subdivisions ?? 64) & ~1); // ensure even for Simpson's rule

  for (let g = 0; g + 1 < groupBounds.length; g++) {
    const eLow = groupBounds[g]!;
    const eHigh = groupBounds[g + 1]!;
    if (eHigh <= eLow || eLow <= 0) {
      results.push({ group: g + 1, eLow, eHigh, sigma: 0, fluxIntegral: 0 });
      continue;
    }

    const u0 = Math.log(eLow);
    const u1 = Math.log(eHigh);
    const du = (u1 - u0) / nSub;

    let numSum = 0;
    let denSum = 0;

    for (let i = 0; i <= nSub; i++) {
      const u = u0 + i * du;
      const e = Math.exp(u);
      const w = i === 0 || i === nSub ? 1 : i % 2 === 1 ? 4 : 2;
      const phi = evaluateWeightSpectrum(e, options);
      const sig = evaluateTab1(tab1, e, { clampOutOfRange: true });
      // Jacobian dE = E * du
      const dFlux = phi * e;
      numSum += w * sig * dFlux;
      denSum += w * dFlux;
    }

    const fluxIntegral = (du / 3) * denSum;
    const sigma = fluxIntegral > 0 ? ((du / 3) * numSum) / fluxIntegral : 0;

    results.push({
      group: g + 1,
      eLow,
      eHigh,
      sigma,
      fluxIntegral,
    });
  }

  return results;
}

/**
 * Collapses `MT=1` (total), `MT=2` (elastic), `MT=18` (fission), and `MT=102` (capture)
 * for an `Endf6Material` across `groupBounds`.
 */
export function collapseMaterialMultigroup(
  material: Endf6Material,
  groupBounds: readonly number[] = DEFAULT_TWO_GROUP_BOUNDS,
  options?: MultigroupCollapseOptions,
): MaterialMultigroupConstants {
  const mt1 = material.crossSections.get(1);
  const mt2 = material.crossSections.get(2);
  const mt18 = material.crossSections.get(18);
  const mt102 = material.crossSections.get(102);

  const g1 = mt1 ? collapseMultigroup(mt1.tab1, groupBounds, options) : [];
  const g2 = mt2 ? collapseMultigroup(mt2.tab1, groupBounds, options) : [];
  const g18 = mt18 ? collapseMultigroup(mt18.tab1, groupBounds, options) : [];
  const g102 = mt102 ? collapseMultigroup(mt102.tab1, groupBounds, options) : [];

  const groups: MaterialMultigroupConstants["groups"] = [];
  for (let i = 0; i + 1 < groupBounds.length; i++) {
    const sigmaElastic = g2[i]?.sigma ?? 0;
    const sigmaFission = g18[i]?.sigma ?? 0;
    const sigmaCapture = g102[i]?.sigma ?? 0;
    const sigmaTotal = g1[i]?.sigma ?? sigmaElastic + sigmaFission + sigmaCapture;
    const fluxIntegral = g1[i]?.fluxIntegral ?? g2[i]?.fluxIntegral ?? g102[i]?.fluxIntegral ?? 0;

    groups.push({
      group: i + 1,
      eLow: groupBounds[i]!,
      eHigh: groupBounds[i + 1]!,
      sigmaTotal,
      sigmaElastic,
      sigmaFission,
      sigmaCapture,
      fluxIntegral,
    });
  }

  return {
    mat: material.mat,
    za: material.za,
    name: material.name,
    groupBounds: [...groupBounds],
    groups,
  };
}
