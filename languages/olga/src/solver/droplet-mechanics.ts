// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Mechanistic Droplet Entrainment & Deposition Closures (Kataoka & Ishii).
 *
 * Implements:
 * 1. Kataoka & Ishii (1982) equilibrium droplet entrainment fraction and rate:
 *    E_inf = tanh(7.25e-7 * We^1.25 * Re_film^0.25)
 *    dE/dt = k_E * (E_inf - E)
 * 2. McCoy & Hanratty / Pan & Hanratty turbulent diffusion droplet deposition rate:
 *    D = k_D * C_droplet
 * 3. Hinze droplet Weber stability and Sauter mean diameter (d32)
 */

export interface DropletMechanicsInput {
  gasDensityKgM3: number; // rho_g
  liquidDensityKgM3: number; // rho_l (oil or water)
  gasViscosityPaS: number; // mu_g
  liquidViscosityPaS: number; // mu_l
  surfaceTensionNPerM: number; // sigma (e.g. 0.025 N/m for oil, 0.072 N/m for water)
  pipeDiameterM: number; // D
  gasVelocityMS: number; // v_g
  filmVelocityMS: number; // v_f
  dropletVelocityMS: number; // v_d
  filmThicknessM: number; // delta_film
  dropletVolumeFraction: number; // alpha_d
  liquidHoldup: number; // alpha_l = alpha_f + alpha_d
}

export interface DropletMechanicsResult {
  /** Inception critical gas velocity for droplet atomization [m/s]. */
  criticalGasVelocityMS: number;
  /** Whether droplet shearing/entrainment is actively occurring. */
  isEntraining: boolean;
  /** Equilibrium entrainment mass fraction E_inf [0.0 - 0.95]. */
  equilibriumEntrainmentFraction: number;
  /** Current entrainment flux E [kg / (m^2 * s)]. */
  entrainmentRateKgM2S: number;
  /** Deposition mass transfer coefficient k_D [m/s]. */
  depositionVelocityMS: number;
  /** Current droplet deposition flux D [kg / (m^2 * s)]. */
  depositionRateKgM2S: number;
  /** Net interfacial droplet mass transfer rate (E - D) [kg / (m^3 * s)]. */
  netDropletGenerationRateKgM3S: number;
  /** Droplet Sauter mean diameter d32 [meters]. */
  sauterMeanDiameterM: number;
}

/**
 * Computes Kataoka & Ishii droplet entrainment and deposition mechanics.
 */
export function evaluateDropletMechanics(input: DropletMechanicsInput): DropletMechanicsResult {
  const d = Math.max(0.01, input.pipeDiameterM);
  const rhoG = Math.max(0.5, input.gasDensityKgM3);
  const rhoL = Math.max(500.0, input.liquidDensityKgM3);
  const sigma = Math.max(0.005, input.surfaceTensionNPerM);
  const muL = Math.max(1e-4, input.liquidViscosityPaS);
  const vg = Math.max(0.01, Math.abs(input.gasVelocityMS));
  const vf = Math.max(0.001, Math.abs(input.filmVelocityMS));
  const relVel = Math.max(0.1, Math.abs(input.gasVelocityMS - input.dropletVelocityMS));

  // 1. Film Reynolds number: Re_f = 4 * rho_L * v_f * delta_f / mu_L
  const deltaF = Math.max(1e-5, Math.min(d * 0.25, input.filmThicknessM));
  const reFilm = (4.0 * rhoL * vf * deltaF) / muL;

  // 2. Inception velocity (Ishii & Grolmes):
  // v_g,crit = (sigma / mu_L) * (rho_L / rho_G)^0.5 * Re_f^(-0.25)
  const critGasVel = (sigma / muL) * Math.sqrt(rhoL / rhoG) * Math.pow(Math.max(10.0, reFilm), -0.25);
  const isEntraining = vg >= critGasVel && reFilm > 50.0;

  // 3. Equilibrium Entrainment Fraction E_inf:
  // Core Weber number We = rho_G * v_G^2 * D / sigma
  const weCore = (rhoG * vg * vg * d) / sigma;
  let eInf = 0.0;
  if (isEntraining) {
    const weEff = Math.max(1.0, weCore * Math.sqrt(rhoG / rhoL));
    const arg = 7.25e-7 * Math.pow(weEff, 1.25) * Math.pow(reFilm, 0.25);
    eInf = Math.max(0.0, Math.min(0.92, Math.tanh(arg)));
  }

  // Current entrainment fraction: E = alpha_d / (alpha_f + alpha_d)
  const currentE =
    input.liquidHoldup > 1e-4 ? Math.max(0.0, Math.min(1.0, input.dropletVolumeFraction / input.liquidHoldup)) : 0.0;

  // Entrainment rate: E_rate = k_E * rho_L * j_L / D * (E_inf - E)
  const jl = vf * Math.max(1e-4, input.liquidHoldup);
  const kE = 0.025; // Empirical rate coefficient
  const entrainmentRate = Math.max(0.0, kE * ((rhoL * jl) / d) * Math.max(0.0, eInf - currentE));

  // 4. Deposition Velocity (McCoy & Hanratty):
  // k_D = 0.18 * u* for dilute; k_D = 0.083 * (C / rho_G)^(-0.65) * u* for dense
  const fFriction = 0.005 * (1.0 + 300.0 * (deltaF / d));
  const uStar = vg * Math.sqrt(fFriction * 0.5); // Friction velocity
  const dropletConc = (rhoL * Math.max(0.0, input.dropletVolumeFraction)) / Math.max(0.1, 1.0 - input.liquidHoldup);
  const cNorm = dropletConc / rhoG;

  let kD = 0.18 * uStar;
  if (cNorm > 0.1) {
    kD = 0.083 * Math.pow(cNorm, -0.65) * uStar;
  }
  kD = Math.max(1e-4, Math.min(1.5, kD));

  const depositionRate = kD * dropletConc;

  // 5. Net generation per unit pipe volume: A_interfacial / Volume = 4 / D
  const netGenVolumetric = (4.0 / d) * (entrainmentRate - depositionRate);

  // 6. Hinze Droplet Sauter Mean Diameter:
  // We_crit ~ 12 for stable droplets in turbulent gas flow
  const weCrit = 12.0;
  const dMax = Math.max(10e-6, Math.min(0.003, (weCrit * sigma) / (rhoG * relVel * relVel)));
  const d32 = 0.6 * dMax;

  return {
    criticalGasVelocityMS: critGasVel,
    isEntraining,
    equilibriumEntrainmentFraction: eInf,
    entrainmentRateKgM2S: entrainmentRate,
    depositionVelocityMS: kD,
    depositionRateKgM2S: depositionRate,
    netDropletGenerationRateKgM3S: netGenVolumetric,
    sauterMeanDiameterM: d32,
  };
}
