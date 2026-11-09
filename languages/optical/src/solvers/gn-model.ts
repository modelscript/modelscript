// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Enhanced Gaussian Noise (EGN) / GN-Model solver for non-linear interference (NLI)
 * calculations in uncompensated coherent optical DWDM transmission systems.
 * Ref: Carena et al., "EGN model of non-linear fiber propagation," Optics Express (2014).
 */

const SPEED_OF_LIGHT = 299792458; // m/s
const PLANCK_CONSTANT = 6.62607015e-34; // J*s

export interface SpanNliParameters {
  lengthKm: number;
  attenuationDbPerKm: number; // e.g. 0.20 dB/km
  dispersionPsPerNmKm: number; // D, e.g. 16.7 ps/(nm*km)
  nonLinearCoeffPerWKm: number; // gamma, e.g. 1.3 1/(W*km)
  wavelengthNm: number; // e.g. 1550 nm
  baudRateGbaud: number; // e.g. 64 GBaud
  totalChannels: number;
  channelSpacingGhz: number; // e.g. 75 or 100 GHz
}

export interface SpanNliResult {
  effectiveLengthKm: number;
  asymptoticLengthKm: number;
  beta2S2PerM: number;
  nliEfficiencyPerW2: number; // eta in W^-2
  nliPowerWatts: (pChannelWatts: number) => number;
}

export function computeSpanNli(params: SpanNliParameters): SpanNliResult {
  const lambdaM = params.wavelengthNm * 1e-9;
  // Convert alpha from dB/km to 1/m: alpha_linear = (alpha_db / 4.3429448) / 1000
  const alphaPerM = params.attenuationDbPerKm / 4.342944819 / 1000;
  const lengthM = params.lengthKm * 1000;

  // Effective length: L_eff = (1 - exp(-alpha * L)) / alpha
  const effectiveLengthM = (1 - Math.exp(-alphaPerM * lengthM)) / alphaPerM;
  const asymptoticLengthM = 1 / alphaPerM;

  // Group velocity dispersion: beta_2 = -(lambda^2 / (2 * pi * c)) * D
  // D in ps/(nm*km) = (1e-12 s) / (1e-9 m * 1e3 m) = 1e-6 s/m^2
  const dSi = params.dispersionPsPerNmKm * 1e-6;
  const beta2 = -((lambdaM * lambdaM) / (2 * Math.PI * SPEED_OF_LIGHT)) * dSi; // s^2/m
  const absBeta2 = Math.abs(beta2);

  const gammaPerWM = params.nonLinearCoeffPerWKm * 1e-3;
  const baudRateHz = params.baudRateGbaud * 1e9;
  const totalBwHz = params.totalChannels * params.channelSpacingGhz * 1e9;

  // Log-sinh GN model efficiency approximation:
  // eta \approx (8/27) * (gamma^2 * L_eff) / (pi * |beta_2| * B_ch^2) * asinh((pi^2 / 2) * |beta_2| * B_tot^2 / alpha)
  let eta = 0.0;
  if (absBeta2 > 1e-30 && baudRateHz > 0) {
    const factor1 =
      (8.0 / 27.0) * ((gammaPerWM * gammaPerWM * effectiveLengthM) / (Math.PI * absBeta2 * baudRateHz * baudRateHz));
    const arg = ((Math.PI * Math.PI) / 2.0) * ((absBeta2 * totalBwHz * totalBwHz) / alphaPerM);
    const asinhTerm = Math.asinh(Math.max(1.0, arg));
    eta = factor1 * asinhTerm;
  }

  return {
    effectiveLengthKm: effectiveLengthM / 1000,
    asymptoticLengthKm: asymptoticLengthM / 1000,
    beta2S2PerM: beta2,
    nliEfficiencyPerW2: eta,
    nliPowerWatts: (pChannelWatts: number) => eta * Math.pow(pChannelWatts, 3),
  };
}

export function computeAseNoisePowerWatts(
  gainDb: number,
  noiseFigureDb: number,
  frequencyThz: number,
  bandwidthGhz = 12.5, // 0.1 nm resolution bandwidth = 12.5 GHz at 1550 nm
): number {
  const gLinear = Math.pow(10, gainDb / 10);
  const nfLinear = Math.pow(10, noiseFigureDb / 10);
  const nu = frequencyThz * 1e12;
  const bwHz = bandwidthGhz * 1e9;

  // P_ASE = 2 * n_sp * (G - 1) * h * nu * B_ref
  // NF \approx 2 * n_sp, so P_ASE = NF * (G - 1) * h * nu * B_ref
  return nfLinear * Math.max(0, gLinear - 1) * PLANCK_CONSTANT * nu * bwHz;
}
