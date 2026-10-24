// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Three-Phase Oil-Water Emulsion Inversion Rheology.
 *
 * Implements the Pal & Rhodes (1989) and Brinkman emulsion viscosity models,
 * capturing the sharp effective viscosity peak and continuous-phase transition
 * at the critical phase inversion water cut (WC_inv ~ 35% - 50%).
 */

export interface EmulsionOptions {
  /** Critical water cut where phase inversion occurs (default: 0.42 = 42% water cut). */
  inversionWaterCut?: number | undefined;
  /** Maximum relative viscosity peak multiplier at inversion point (default: 8.5). */
  peakMultiplier?: number | undefined;
  /** Maximum droplet packing fraction phi_max (default: 0.68). */
  maxPackingFraction?: number | undefined;
}

export interface EmulsionProperties {
  /** Effective mixture dynamic viscosity [Pa * s]. */
  effectiveViscosity: number;
  /** Continuous fluid phase: 'OIL' before inversion, 'WATER' after inversion. */
  continuousPhase: "OIL" | "WATER";
  /** Whether the emulsion has transitioned past the phase inversion boundary. */
  isInverted: boolean;
  /** Dispersed droplet volume fraction phi_d [0..1]. */
  dispersedFraction: number;
  /** Relative viscosity ratio mu_eff / mu_cont. */
  relativeViscosity: number;
}

/**
 * Evaluates the effective emulsion viscosity accounting for phase inversion.
 *
 * @param waterCut          Water volume fraction WC = Q_w / (Q_o + Q_w) [0.0 to 1.0]
 * @param oilViscosity      Pure oil dynamic viscosity [Pa * s] (typically 0.002 to 0.050)
 * @param waterViscosity    Pure water dynamic viscosity [Pa * s] (typically ~0.001)
 * @param options           Inversion threshold and packing parameters
 */
export function evaluateEmulsionViscosity(
  waterCut: number,
  oilViscosity: number,
  waterViscosity = 0.001,
  options: EmulsionOptions = {},
): EmulsionProperties {
  const wc = Math.max(0.0, Math.min(1.0, waterCut));
  if (wc <= 0.0) {
    return {
      effectiveViscosity: oilViscosity,
      continuousPhase: "OIL",
      isInverted: false,
      dispersedFraction: 0.0,
      relativeViscosity: 1.0,
    };
  }
  if (wc >= 1.0) {
    return {
      effectiveViscosity: waterViscosity,
      continuousPhase: "WATER",
      isInverted: true,
      dispersedFraction: 0.0,
      relativeViscosity: 1.0,
    };
  }

  const wcInv = options.inversionWaterCut ?? 0.42;
  const phiMax = options.maxPackingFraction ?? 0.68;
  const peakMultiplier = options.peakMultiplier ?? 8.5;

  let continuousPhase: "OIL" | "WATER";
  let isInverted: boolean;
  let muCont: number;
  let phiD: number;

  if (wc < wcInv) {
    // Water-in-oil (W/O) emulsion: Oil is continuous, water droplets dispersed
    continuousPhase = "OIL";
    isInverted = false;
    muCont = oilViscosity;
    // Dispersed fraction scales from 0 up to phiMax at inversion point
    phiD = (wc / wcInv) * phiMax * 0.95;
  } else {
    // Oil-in-water (O/W) emulsion: Water is continuous, oil droplets dispersed
    continuousPhase = "WATER";
    isInverted = true;
    muCont = waterViscosity;
    // Dispersed oil fraction scales from phiMax down to 0 at 100% water cut
    const oilCut = 1.0 - wc;
    const invOilCut = 1.0 - wcInv;
    phiD = (oilCut / Math.max(1e-4, invOilCut)) * phiMax * 0.95;
  }

  // Pal & Rhodes (1989) relative viscosity equation
  // mu_rel = [1 - (K0 * phi_d) / (1 - phi_d / phi_max)]^(-2.5)
  const normalizedPhi = Math.min(0.92, phiD / phiMax);
  const k0 = 0.85;
  const denominator = Math.max(0.05, 1.0 - normalizedPhi);
  const factor = Math.max(0.05, 1.0 - (k0 * phiD) / denominator);
  let muRel = Math.pow(factor, -2.5);

  // Smooth Gaussian peak centered around the phase inversion boundary
  const sigma = 0.05; // Width of transition zone
  const distFromInversion = (wc - wcInv) / sigma;
  const inversionPeak = peakMultiplier * Math.exp(-0.5 * distFromInversion * distFromInversion);
  muRel = Math.max(muRel, 1.0 + inversionPeak);

  const effectiveViscosity = muCont * muRel;

  return {
    effectiveViscosity,
    continuousPhase,
    isInverted,
    dispersedFraction: phiD,
    relativeViscosity: muRel,
  };
}
