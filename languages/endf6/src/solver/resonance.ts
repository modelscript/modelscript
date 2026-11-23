// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Single-Level Breit-Wigner (SLBW) Resonance Evaluator.
 *
 * Implements ENDF-102 Appendix D.1.1 s-wave (l=0) Single-Level Breit-Wigner formulas:
 *   - Wave number:      k(E) = 2.196771e-3 * (A / (A + 1)) * sqrt(E_eV)   [in 10^12 cm^-1]
 *   - Spin factor:      g_J  = (2*J + 1) / (2 * (2*I + 1))
 *   - Neutron width:    Gamma_n(E) = Gamma_n(Er) * sqrt(E / Er)
 *   - Capture (MT=102): sigma_gamma(E) = (pi / k^2) * g_J * Gamma_n(E) * Gamma_g / ((E - Er)^2 + (Gamma/2)^2)
 *   - Fission (MT=18):  sigma_f(E)     = (pi / k^2) * g_J * Gamma_n(E) * Gamma_f / ((E - Er)^2 + (Gamma/2)^2)
 *   - Elastic (MT=2):   sigma_s(E)     = 4*pi*a^2 + (pi / k^2) * g_J * (Gamma_n(E)^2 + 2*k*a*Gamma_n(E)*(E - Er)) / ((E - Er)^2 + (Gamma/2)^2)
 *   - Total (MT=1):     sigma_t(E)     = sigma_s(E) + sigma_gamma(E) + sigma_f(E)
 *
 * Note: 1 barn = 1e-24 cm^2 = 1 * (10^-12 cm)^2, so when k is in 10^12 cm^-1 and
 * scattering radius a (AP) is in 10^-12 cm (10 fm), `pi / k^2` and `4 * pi * a^2`
 * are directly in **barns**!
 */

import type { Endf6Resonance, Endf6ResonanceRange } from "../types.js";

/** ENDF-102 neutron wave number constant k0 in 10^12 cm^-1 / sqrt(eV). */
export const ENDF_K0_CONSTANT = 2.196771e-3;

export interface SlbwCrossSections {
  /** Incident neutron energy (eV). */
  energy: number;
  /** Elastic scattering cross-section sigma_s (barns). */
  elastic: number;
  /** Radiative capture cross-section sigma_gamma (barns). */
  capture: number;
  /** Fission cross-section sigma_f (barns). */
  fission: number;
  /** Total cross-section sigma_t = sigma_s + sigma_gamma + sigma_f (barns). */
  total: number;
}

/**
 * Computes the center-of-mass neutron wave number `k(E)` in `10^12 cm^-1` (barn^-1/2).
 */
export function slbwWaveNumber(energyEv: number, awr: number): number {
  if (energyEv <= 0 || awr <= 0) return 0;
  return ENDF_K0_CONSTANT * (awr / (awr + 1.0)) * Math.sqrt(energyEv);
}

/**
 * Computes the statistical spin factor `g_J = (2*J + 1) / (2 * (2*I + 1))`.
 */
export function slbwSpinFactor(aj: number, spi: number): number {
  return (2 * Math.abs(aj) + 1) / (2 * (2 * Math.abs(spi) + 1));
}

/**
 * Evaluates a single s-wave Single-Level Breit-Wigner resonance contribution (without potential scattering)
 * at energy `energyEv` (eV).
 */
export function evaluateSlbwResonance(
  res: Endf6Resonance,
  energyEv: number,
  awr: number,
  spi: number,
  ap: number,
): Omit<SlbwCrossSections, "energy"> {
  if (energyEv <= 0 || awr <= 0) {
    return { elastic: 0, capture: 0, fission: 0, total: 0 };
  }

  const k = slbwWaveNumber(energyEv, awr);
  const piOverK2 = Math.PI / (k * k); // directly in barns
  const gJ = slbwSpinFactor(res.aj, spi);

  // Energy-dependent s-wave neutron width: Gamma_n(E) = Gamma_n(Er) * sqrt(E / |Er|)
  const erRef = Math.abs(res.er) > 1e-12 ? Math.abs(res.er) : 1.0;
  const gnE = res.gn * Math.sqrt(energyEv / erRef);
  const gg = Math.max(0, res.gg);
  const gf = Math.max(0, res.gf);
  // Total width Gamma(E) = Gamma_n(E) + Gamma_gamma + Gamma_f (or res.gt at peak)
  const gammaE = gnE + gg + gf > 0 ? gnE + gg + gf : Math.max(res.gt, 1e-12);

  const dE = energyEv - res.er;
  const denom = dE * dE + 0.25 * gammaE * gammaE;

  const capture = piOverK2 * gJ * ((gnE * gg) / denom);
  const fission = piOverK2 * gJ * ((gnE * gf) / denom);

  // Resonance scattering + potential-resonance interference term (small-ka limit sin(2ka) ~ 2ka)
  const phi = k * ap;
  const cos2Phi = Math.cos(2 * phi);
  const sin2Phi = Math.sin(2 * phi);
  const elasticRes =
    piOverK2 *
    gJ *
    ((gnE * gnE * cos2Phi - 2 * gnE * (gg + gf) * Math.sin(phi) * Math.sin(phi) + 2 * gnE * dE * sin2Phi) / denom);

  const total = elasticRes + capture + fission;
  return { elastic: elasticRes, capture, fission, total };
}

/**
 * Evaluates a complete SLBW resonance range (potential scattering `4*pi*AP^2` + sum over all resonances)
 * at incident neutron energy `energyEv` (eV).
 */
export function evaluateSlbwRange(range: Endf6ResonanceRange, energyEv: number): SlbwCrossSections {
  const sigmaPotential = 4 * Math.PI * range.ap * range.ap; // directly in barns
  let elastic = sigmaPotential;
  let capture = 0;
  let fission = 0;

  for (const res of range.resonances) {
    const contrib = evaluateSlbwResonance(res, energyEv, range.awr, range.spi, range.ap);
    elastic += contrib.elastic;
    capture += contrib.capture;
    fission += contrib.fission;
  }

  elastic = Math.max(0, elastic);
  const total = elastic + capture + fission;
  return {
    energy: energyEv,
    elastic,
    capture,
    fission,
    total,
  };
}
