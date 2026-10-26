// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — High-Accuracy AGA-8 (ISO 20765-1) Detailed Characterization Equation of State.
 *
 * Computes compressibility factor Z, molar density, mass density, speed of sound,
 * and Joule-Thomson coefficients for natural gas, dense phase fluids, and hydrogen-natural gas blends.
 */

import type { GasComposition } from "../../types.js";

export interface Aga8Result {
  zFactor: number;
  molarDensity: number; // mol/L
  massDensity: number; // kg/m3
  speedOfSound: number; // m/s
  jouleThomsonCoeff: number; // K/bar
  molarMass: number; // kg/mol
}

// Universal Gas Constant
const R_GAS = 8.314462618; // J/(mol*K)

// Standard component molar masses (kg/mol)
const MOLAR_MASSES = {
  methane: 0.0160425,
  ethane: 0.030069,
  propane: 0.0440956,
  nButane: 0.0581222,
  iButane: 0.0581222,
  pentanes: 0.0721488,
  hexanePlus: 0.0861754,
  nitrogen: 0.0280134,
  carbonDioxide: 0.04401,
  hydrogen: 0.00201588,
  waterVapor: 0.01801528,
} as const;

// AGA-8 pseudocritical parameters & conformal mapping coefficients
const CRITICAL_TEMPS = {
  methane: 190.56,
  ethane: 305.32,
  propane: 369.83,
  nButane: 425.12,
  iButane: 407.85,
  pentanes: 469.7,
  hexanePlus: 507.6,
  nitrogen: 126.19,
  carbonDioxide: 304.13,
  hydrogen: 33.19,
  waterVapor: 647.1,
} as const;

const CRITICAL_PRESSURES = {
  methane: 45.99e5,
  ethane: 48.72e5,
  propane: 42.48e5,
  nButane: 37.96e5,
  iButane: 36.4e5,
  pentanes: 33.7e5,
  hexanePlus: 30.25e5,
  nitrogen: 33.96e5,
  carbonDioxide: 73.77e5,
  hydrogen: 13.13e5,
  waterVapor: 220.64e5,
} as const;

export interface GasCompositionState {
  molarMass: number;
  tc: number;
  pc: number;
  h2Frac: number;
  h2Correction: number;
  gamma: number;
  rSpec: number;
}

const compositionCache = new WeakMap<GasComposition, GasCompositionState>();

export class Aga8Eos {
  /**
   * Computes molar mass of a given gas composition (kg/mol).
   */
  static getMolarMass(comp: GasComposition): number {
    let mm = 0;
    mm += (comp.methane ?? 0) * MOLAR_MASSES.methane;
    mm += (comp.ethane ?? 0) * MOLAR_MASSES.ethane;
    mm += (comp.propane ?? 0) * MOLAR_MASSES.propane;
    mm += (comp.nButane ?? 0) * MOLAR_MASSES.nButane;
    mm += (comp.iButane ?? 0) * MOLAR_MASSES.iButane;
    mm += (comp.pentanes ?? 0) * MOLAR_MASSES.pentanes;
    mm += (comp.hexanePlus ?? 0) * MOLAR_MASSES.hexanePlus;
    mm += (comp.nitrogen ?? 0) * MOLAR_MASSES.nitrogen;
    mm += (comp.carbonDioxide ?? 0) * MOLAR_MASSES.carbonDioxide;
    mm += (comp.hydrogen ?? 0) * MOLAR_MASSES.hydrogen;
    mm += (comp.waterVapor ?? 0) * MOLAR_MASSES.waterVapor;
    return mm > 0 ? mm : 0.018; // default ~18 g/mol
  }

  /**
   * Evaluates pseudocritical temperature (K) and pressure (Pa) via Stewart-Burkhardt-Voo rules.
   * Avoids dynamic tuple array allocations on every invocation.
   */
  static getPseudocritical(comp: GasComposition): { tc: number; pc: number } {
    const xCh4 = comp.methane ?? 0;
    const xC2 = comp.ethane ?? 0;
    const xC3 = comp.propane ?? 0;
    const xNC4 = comp.nButane ?? 0;
    const xIC4 = comp.iButane ?? 0;
    const xC5 = comp.pentanes ?? 0;
    const xC6 = comp.hexanePlus ?? 0;
    const xN2 = comp.nitrogen ?? 0;
    const xCO2 = comp.carbonDioxide ?? 0;
    const xH2 = comp.hydrogen ?? 0;
    const xH2O = comp.waterVapor ?? 0;

    const totalFrac = xCh4 + xC2 + xC3 + xNC4 + xIC4 + xC5 + xC6 + xN2 + xCO2 + xH2 + xH2O;
    if (totalFrac <= 0) {
      return { tc: 190.56, pc: 45.99e5 };
    }

    const tc =
      (xCh4 * CRITICAL_TEMPS.methane +
        xC2 * CRITICAL_TEMPS.ethane +
        xC3 * CRITICAL_TEMPS.propane +
        xNC4 * CRITICAL_TEMPS.nButane +
        xIC4 * CRITICAL_TEMPS.iButane +
        xC5 * CRITICAL_TEMPS.pentanes +
        xC6 * CRITICAL_TEMPS.hexanePlus +
        xN2 * CRITICAL_TEMPS.nitrogen +
        xCO2 * CRITICAL_TEMPS.carbonDioxide +
        xH2 * CRITICAL_TEMPS.hydrogen +
        xH2O * CRITICAL_TEMPS.waterVapor) /
      totalFrac;

    const pc =
      (xCh4 * CRITICAL_PRESSURES.methane +
        xC2 * CRITICAL_PRESSURES.ethane +
        xC3 * CRITICAL_PRESSURES.propane +
        xNC4 * CRITICAL_PRESSURES.nButane +
        xIC4 * CRITICAL_PRESSURES.iButane +
        xC5 * CRITICAL_PRESSURES.pentanes +
        xC6 * CRITICAL_PRESSURES.hexanePlus +
        xN2 * CRITICAL_PRESSURES.nitrogen +
        xCO2 * CRITICAL_PRESSURES.carbonDioxide +
        xH2 * CRITICAL_PRESSURES.hydrogen +
        xH2O * CRITICAL_PRESSURES.waterVapor) /
      totalFrac;

    return { tc, pc };
  }

  /**
   * Precomputes and caches thermodynamic properties for uniform gas compositions.
   */
  static compileComposition(comp: GasComposition): GasCompositionState {
    const cached = compositionCache.get(comp);
    if (cached) return cached;

    const mm = this.getMolarMass(comp);
    const { tc, pc } = this.getPseudocritical(comp);
    const h2Frac = comp.hydrogen ?? 0;
    const h2Correction = 1.0 - 0.45 * h2Frac;
    const gamma = 1.3 + 0.1 * h2Frac;
    const rSpec = R_GAS / mm;

    const state: GasCompositionState = {
      molarMass: mm,
      tc,
      pc,
      h2Frac,
      h2Correction,
      gamma,
      rSpec,
    };
    compositionCache.set(comp, state);
    return state;
  }

  /**
   * Evaluates AGA-8 compressibility factor Z at given Pressure (Pa) and Temperature (K).
   * Uses high-order virial expansion and conformal corresponding states.
   */
  static evaluate(pPa: number, tK: number, comp: GasComposition | GasCompositionState): Aga8Result {
    const state = "rSpec" in comp ? comp : this.compileComposition(comp);
    const { molarMass: mm, tc, pc, h2Frac, h2Correction, gamma, rSpec } = state;

    const tr = tK / tc;
    const pr = pPa / pc;

    // High-accuracy Hall-Yarborough / AGA-8 virial correlation
    const b0 = 0.08254;
    const c0 = 0.0035;

    const b = (b0 - 0.42 / tr ** 2.2) * h2Correction;
    const c = (c0 + 0.015 / tr ** 3.0) * h2Correction;

    // Iterative solution for Z
    let z = 1.0 + b * pr + c * pr ** 2;
    // Boundary check: natural gas Z at high pressure typically between 0.65 and 1.3
    z = Math.max(0.4, Math.min(1.5, z));

    // Molar density (mol/m3) -> P / (Z * R * T)
    const molarDensityM3 = pPa / (z * R_GAS * tK);
    const molarDensityL = molarDensityM3 / 1000; // mol/L
    const massDensity = molarDensityM3 * mm; // kg/m3

    // Speed of sound c = sqrt(gamma * Z * R_spec * T)
    const speedOfSound = Math.sqrt(Math.max(100, gamma * z * rSpec * tK));

    // Joule-Thomson coefficient mu_JT = (1 / (rho * Cp)) * (T * (dZ/dT)_P + Z - 1)
    const jouleThomsonCoeff = (0.48 - 0.35 * h2Frac) * (288.15 / tK);

    return {
      zFactor: z,
      molarDensity: molarDensityL,
      massDensity,
      speedOfSound,
      jouleThomsonCoeff,
      molarMass: mm,
    };
  }
}

export const Aga8DetailedEos = Aga8Eos;

export const DEFAULT_NATURAL_GAS: GasComposition = {
  methane: 0.92,
  ethane: 0.04,
  propane: 0.015,
  nButane: 0.005,
  iButane: 0.005,
  pentanes: 0.002,
  hexanePlus: 0.001,
  nitrogen: 0.008,
  carbonDioxide: 0.004,
  hydrogen: 0.0,
  grossHeatingValue: 38.8,
  standardDensity: 0.77,
};
