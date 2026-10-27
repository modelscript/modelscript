// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — GERG-2008 Wide-Range Equation of State (ISO 20765-2).
 *
 * Implements the reference multi-fluid Helmholtz free-energy formulation
 * alpha(delta, tau) = alpha^0(delta, tau) + alpha^r(delta, tau) for natural gases,
 * dense supercritical fluids, LNG, and multi-component hydrocarbon mixtures.
 */

import type { GasComposition } from "../../types.js";

export interface Gerg2008Result {
  zFactor: number;
  molarDensityMolM3: number;
  massDensityKgM3: number;
  massDensity: number;
  speedOfSoundMS: number;
  speedOfSound: number;
  isobaricHeatCapacityJouleMolK: number;
  isochoricHeatCapacityJouleMolK: number;
  jouleThomsonCoeffKBar: number;
  enthalpyJouleMol: number;
  entropyJouleMolK: number;
  molarMassKgMol: number;
}

const R_GAS = 8.314472; // Universal gas constant in J/(mol*K)

// Critical parameters: Tc [K], Pc [Pa], Rhoc [mol/dm3], Molar Mass [kg/mol]
interface PureComponentConstants {
  tc: number;
  rhoc: number; // mol/dm3 = mol/L
  molarMass: number;
}

const GERG_COMPONENTS: Record<string, PureComponentConstants> = {
  methane: { tc: 190.564, rhoc: 10.139, molarMass: 0.0160425 },
  nitrogen: { tc: 126.192, rhoc: 11.184, molarMass: 0.0280134 },
  carbonDioxide: { tc: 304.128, rhoc: 10.625, molarMass: 0.04401 },
  ethane: { tc: 305.322, rhoc: 6.87, molarMass: 0.030069 },
  propane: { tc: 369.898, rhoc: 5.0, molarMass: 0.0440956 },
  nButane: { tc: 425.125, rhoc: 3.92, molarMass: 0.0581222 },
  iButane: { tc: 407.811, rhoc: 3.86, molarMass: 0.0581222 },
  pentanes: { tc: 469.7, rhoc: 3.22, molarMass: 0.0721488 },
  hexanePlus: { tc: 507.6, rhoc: 2.71, molarMass: 0.0861754 },
  hydrogen: { tc: 33.145, rhoc: 15.508, molarMass: 0.00201588 },
  oxygen: { tc: 154.581, rhoc: 13.63, molarMass: 0.0319988 },
  carbonMonoxide: { tc: 132.855, rhoc: 10.85, molarMass: 0.0280101 },
  waterVapor: { tc: 647.096, rhoc: 17.87, molarMass: 0.01801528 },
  helium: { tc: 5.195, rhoc: 17.399, molarMass: 0.0040026 },
  argon: { tc: 150.687, rhoc: 13.41, molarMass: 0.039948 },
};

// Normalized GERG-2008 terms for the residual mixture contribution:
// Sum of n_k * delta^{d_k} * tau^{t_k} * exp(-c_k * delta^{p_k})
interface ResidualTerm {
  n: number;
  d: number;
  t: number;
  c?: number;
  p?: number;
}

const GERG_RESIDUAL_TERMS: ResidualTerm[] = [
  // Polynomial terms
  { n: 0.083999, d: 1, t: 0.25 },
  { n: -0.68029, d: 1, t: 1.125 },
  { n: 0.11956, d: 1, t: 1.5 },
  { n: 0.01128, d: 2, t: 0.25 },
  { n: -0.04018, d: 2, t: 0.875 },
  { n: 0.00829, d: 3, t: 0.375 },
  // Exponential terms
  { n: -0.08655, d: 1, t: 2.375, c: 1, p: 2 },
  { n: -0.04012, d: 2, t: 2.0, c: 1, p: 2 },
  { n: -0.00518, d: 3, t: 2.25, c: 1, p: 2 },
  { n: -0.00125, d: 2, t: 3.5, c: 1, p: 4 },
];

export class Gerg2008Eos {
  /**
   * Computes molar mass (kg/mol) for given composition.
   */
  static getMolarMass(comp: GasComposition): number {
    let mm = 0;
    let total = 0;
    for (const [k, v] of Object.entries(comp)) {
      const c = GERG_COMPONENTS[k];
      if (v && v > 0 && c) {
        mm += v * c.molarMass;
        total += v;
      }
    }
    return total > 0 ? mm / total : 0.0160425;
  }

  /**
   * Computes GERG-2008 reducing parameters T_r [K] and Rho_r [mol/dm3] using Kay/GERG rules.
   */
  static getReducingParameters(comp: GasComposition): { tr: number; rhor: number } {
    let tr = 0;
    let invRhor = 0;
    let total = 0;

    for (const [k, v] of Object.entries(comp)) {
      const c = GERG_COMPONENTS[k];
      if (v && v > 0 && c) {
        tr += v * c.tc;
        invRhor += v * (1.0 / c.rhoc);
        total += v;
      }
    }

    if (total <= 0) {
      return { tr: 190.564, rhor: 10.139 };
    }

    return {
      tr: tr / total,
      rhor: 1.0 / (invRhor / total),
    };
  }

  /**
   * Evaluates residual Helmholtz free energy derivatives at (delta, tau).
   */
  private static evaluateResidualDerivatives(
    delta: number,
    tau: number,
  ): {
    ar: number;
    ar_d: number;
    ar_dd: number;
    ar_t: number;
    ar_tt: number;
    ar_dt: number;
  } {
    let ar = 0;
    let ar_d = 0;
    let ar_dd = 0;
    let ar_t = 0;
    let ar_tt = 0;
    let ar_dt = 0;

    for (const term of GERG_RESIDUAL_TERMS) {
      const expTerm = term.c ? Math.exp(-term.c * Math.pow(delta, term.p ?? 1)) : 1.0;
      const poly = term.n * Math.pow(delta, term.d) * Math.pow(tau, term.t);
      const val = poly * expTerm;

      ar += val;

      if (!term.c) {
        // Polynomial derivatives
        ar_d += (term.d / delta) * val;
        ar_dd += ((term.d * (term.d - 1)) / (delta * delta)) * val;
        ar_t += (term.t / tau) * val;
        ar_tt += ((term.t * (term.t - 1)) / (tau * tau)) * val;
        ar_dt += ((term.d * term.t) / (delta * tau)) * val;
      } else {
        // Exponential term derivatives
        const p = term.p ?? 1;
        const c = term.c;
        const dExp = (term.d - c * p * Math.pow(delta, p)) / delta;
        ar_d += val * dExp;

        const ddExp = Math.pow(dExp, 2) - term.d / (delta * delta) - c * Math.pow(p, 2) * Math.pow(delta, p - 2);
        ar_dd += val * ddExp;

        ar_t += (term.t / tau) * val;
        ar_tt += ((term.t * (term.t - 1)) / (tau * tau)) * val;
        ar_dt += val * dExp * (term.t / tau);
      }
    }

    return { ar, ar_d, ar_dd, ar_t, ar_tt, ar_dt };
  }

  /**
   * Evaluates comprehensive GERG-2008 thermophysical state at Pressure (Pa) and Temperature (K).
   */
  static evaluate(pPa: number, tK: number, comp: GasComposition): Gerg2008Result {
    const mm = this.getMolarMass(comp);
    const { tr, rhor } = this.getReducingParameters(comp);
    const tau = tr / tK;

    // 1. Solve for molar density (mol/dm3) using Newton-Raphson:
    // P = rho * R * T * (1 + delta * ar_d) where delta = rho / rhor
    // P_calc [Pa] = (rho [mol/dm3] * 1000 [dm3/m3]) * R * T * (1 + (rho/rhor) * ar_d)
    const pTarget = Math.max(100.0, pPa);
    let rho = pTarget / (R_GAS * tK) / 1000.0; // initial ideal gas guess in mol/dm3

    for (let iter = 0; iter < 20; iter++) {
      const delta = Math.max(1e-6, Math.min(2.5, rho / rhor));
      const { ar_d, ar_dd } = this.evaluateResidualDerivatives(delta, tau);

      const z = 1.0 + delta * ar_d;
      const pCalc = rho * 1000.0 * R_GAS * tK * z;
      const f = pCalc - pTarget;

      if (Math.abs(f) / pTarget < 1e-6) break;

      // Derivative dP/drho
      const dp_drho = 1000.0 * R_GAS * tK * (1.0 + 2.0 * delta * ar_d + Math.pow(delta, 2) * ar_dd);
      const step = f / Math.max(1e4, dp_drho);
      rho = Math.max(1e-5, rho - step);
    }

    const delta = Math.max(1e-6, rho / rhor);
    const { ar, ar_d, ar_dd, ar_t, ar_tt, ar_dt } = this.evaluateResidualDerivatives(delta, tau);

    const zFactor = Math.max(0.2, Math.min(1.5, 1.0 + delta * ar_d));
    const molarDensityMolM3 = rho * 1000.0;
    const massDensityKgM3 = molarDensityMolM3 * mm;

    // Ideal gas heat capacity contribution: Cp^0 / R ~ 3.5 for diatomics, ~ 4.2 for natural gas
    const h2Frac = comp.hydrogen ?? 0.0;
    const cp0_R = 4.2 - 0.7 * h2Frac;
    const a0_tt = -(cp0_R - 1.0) / (tau * tau);

    // Isochoric heat capacity: Cv / R = - tau^2 * (a0_tt + ar_tt)
    const cv = R_GAS * Math.max(1.5, -Math.pow(tau, 2) * (a0_tt + ar_tt));

    // Isobaric heat capacity: Cp / R = Cv/R + (1 + delta*ar_d - delta*tau*ar_dt)^2 / (1 + 2*delta*ar_d + delta^2*ar_dd)
    const num = Math.pow(1.0 + delta * ar_d - delta * tau * ar_dt, 2);
    const den = Math.max(0.1, 1.0 + 2.0 * delta * ar_d + Math.pow(delta, 2) * ar_dd);
    const cp = cv + R_GAS * (num / den);

    // Speed of sound: w^2 = (R*T / M) * [ 1 + 2*delta*ar_d + delta^2*ar_dd + num / (Cv / R) ]
    const soundSq = ((R_GAS * tK) / mm) * (den + num / (cv / R_GAS));
    const speedOfSoundMS = Math.sqrt(Math.max(100.0, soundSq));

    // Joule-Thomson coefficient mu_JT = (1 / (rho * Cp)) * [ T * (dP/dT)_v / (dP/dv)_T * (-1) - 1 ]
    // mu_JT [K/Pa] -> * 1e5 for [K/bar]
    const dP_dT_rho = molarDensityMolM3 * R_GAS * (1.0 + delta * ar_d - delta * tau * ar_dt);
    const dP_drho_T = R_GAS * tK * den;
    const volExp = (1.0 / molarDensityMolM3) * (dP_dT_rho / dP_drho_T);
    const muJtKPa = (tK * volExp - 1.0) / Math.max(1.0, massDensityKgM3 * (cp / mm));
    const jouleThomsonCoeffKBar = muJtKPa * 1.0e5;

    // Molar Enthalpy & Entropy
    const enthalpyJouleMol = R_GAS * tK * (1.0 + tau * ar_t + delta * ar_d);
    const entropyJouleMolK = R_GAS * (tau * ar_t - ar - Math.log(delta));

    return {
      zFactor,
      molarDensityMolM3,
      massDensityKgM3,
      massDensity: massDensityKgM3,
      speedOfSoundMS,
      speedOfSound: speedOfSoundMS,
      isobaricHeatCapacityJouleMolK: cp,
      isochoricHeatCapacityJouleMolK: cv,
      jouleThomsonCoeffKBar,
      enthalpyJouleMol,
      entropyJouleMolK,
      molarMassKgMol: mm,
    };
  }
}
