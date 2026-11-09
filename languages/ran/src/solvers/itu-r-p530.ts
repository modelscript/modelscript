// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ITU-R P.530-18 and ITU-R P.838 microwave propagation, rain fade, and link availability solver.
 */

import type { MicrowaveLink } from "../types.js";

export interface RainFadeResult {
  frequencyGhz: number;
  pathLengthKm: number;
  freeSpaceLossDb: number;
  atmosphericGasLossDb: number;
  rainAttenuationRateDbPerKm: number;
  effectivePathLengthKm: number;
  rainFade001PercentDb: number;
  totalPathLossDb: number;
  receivedPowerDbm: number;
  fadeMarginDb: number;
  availabilityPercent: number; // e.g. 99.999%
  unavailabilityMinutesPerYear: number;
}

export function computeFsplDb(frequencyGhz: number, distanceKm: number): number {
  if (distanceKm <= 0 || frequencyGhz <= 0) return 0;
  return 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyGhz) + 92.45;
}

export function computeAtmosphericGasLossDb(frequencyGhz: number, distanceKm: number): number {
  // Approximate ITU-R P.676 absorption for 1-40 GHz at sea level:
  // Oxygen: ~0.007 dB/km at 10 GHz, Water vapor: ~0.01 dB/km
  const gammaGas = 0.005 + 0.0003 * Math.pow(frequencyGhz, 1.3);
  return gammaGas * distanceKm;
}

export function computeRainAttenuationCoeffs(
  frequencyGhz: number,
  polarization: "V" | "H",
): { k: number; alpha: number } {
  // Approximate ITU-R P.838 coefficients for 10-30 GHz
  const f = frequencyGhz;
  let k = 0.0;
  let alpha = 1.0;

  if (polarization === "H") {
    k = 0.0000387 * Math.pow(f, 2.4);
    alpha = 1.25 - 0.01 * f;
  } else {
    k = 0.0000352 * Math.pow(f, 2.35);
    alpha = 1.2 - 0.009 * f;
  }

  return { k: Math.max(0.001, k), alpha: Math.max(0.7, Math.min(1.4, alpha)) };
}

export function solveMicrowaveLinkBudget(
  link: MicrowaveLink,
  options?: {
    rainRate001MmPerHour?: number | undefined; // Default: 42 mm/hr (ITU Rain Zone K)
    receiverSensitivityDbm?: number | undefined; // Default: -70 dBm
  },
): RainFadeResult {
  const rainRate = options?.rainRate001MmPerHour ?? 42.0; // mm/hr
  const rxSens = options?.receiverSensitivityDbm ?? -70.0;

  const fspl = computeFsplDb(link.frequencyGhz, link.pathLengthKm);
  const gasLoss = computeAtmosphericGasLossDb(link.frequencyGhz, link.pathLengthKm);

  // Rain attenuation: gamma_R = k * R^alpha
  const { k, alpha } = computeRainAttenuationCoeffs(link.frequencyGhz, link.polarization);
  const gammaRain = k * Math.pow(rainRate, alpha);

  // Path reduction factor: r = 1 / (1 + 0.77 * (d / d_0)) where d_0 = 35 * exp(-0.015 * R_0.01)
  const d0 = 35 * Math.exp(-0.015 * rainRate);
  const pathFactor = 1.0 / (1.0 + 0.77 * (link.pathLengthKm / d0));
  const effectiveLengthKm = link.pathLengthKm * pathFactor;

  // Rain attenuation exceeded for 0.01% of the time: A_0.01 = gamma_R * d_eff
  const rainLoss001 = gammaRain * effectiveLengthKm;

  // Total clear-air attenuation
  const clearAirLoss = fspl + gasLoss + link.txFeederLossDb + link.rxFeederLossDb;
  const totalPathLoss = clearAirLoss + rainLoss001;

  // EIRP = P_tx + G_tx - L_feeder
  const eirpDbm = link.txPowerDbm + link.txAntennaGainDbi - link.txFeederLossDb;
  const receivedPowerDbm = eirpDbm - clearAirLoss + link.rxAntennaGainDbi - link.rxFeederLossDb;
  const fadeMarginDb = receivedPowerDbm - rxSens;

  // Availability calculation (ITU-R P.530 scaling from 0.01%):
  // P(A) / 0.01 = (A / A_0.01)^(-beta)
  // When Margin >= rainLoss001, unavailability <= 0.01% (Availability >= 99.99%)
  let unavailabilityPercent = 0.01 * Math.pow(Math.max(0.1, fadeMarginDb / rainLoss001), -2.5);
  unavailabilityPercent = Math.min(1.0, Math.max(0.0001, unavailabilityPercent));
  const availabilityPercent = 100.0 - unavailabilityPercent;

  const minutesPerYear = 365.25 * 24 * 60;
  const unavailMinPerYear = (unavailabilityPercent / 100.0) * minutesPerYear;

  return {
    frequencyGhz: link.frequencyGhz,
    pathLengthKm: link.pathLengthKm,
    freeSpaceLossDb: fspl,
    atmosphericGasLossDb: gasLoss,
    rainAttenuationRateDbPerKm: gammaRain,
    effectivePathLengthKm: effectiveLengthKm,
    rainFade001PercentDb: rainLoss001,
    totalPathLossDb: totalPathLoss,
    receivedPowerDbm,
    fadeMarginDb,
    availabilityPercent,
    unavailabilityMinutesPerYear: unavailMinPerYear,
  };
}
