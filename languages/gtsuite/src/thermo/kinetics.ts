// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * First-principles chemical kinetics: Extended Zeldovich thermal NOx and Livengood-Wu knock prediction.
 */

export interface NoxKineticsResult {
  noxRateMolPerM3S: number;
  noxPpm: number;
}

/**
 * Calculates thermal NO production rate via the Extended Zeldovich mechanism:
 * 1. O + N2 <-> NO + N   (k1f = 7.6e13 exp(-38000/T))
 * 2. N + O2 <-> NO + O   (k2f = 6.4e9 * T * exp(-3150/T))
 * 3. N + OH <-> NO + H   (k3f = 4.1e13)
 */
export function calculateZeldovichNoxRate(
  temperatureK: number,
  pressurePa: number,
  burnedFraction: number,
  equivalenceRatioPhi = 1.0,
): NoxKineticsResult {
  const T = Math.max(800.0, temperatureK);
  if (T < 1600.0 || burnedFraction < 0.05) {
    return { noxRateMolPerM3S: 0.0, noxPpm: 0.0 };
  }

  // Heywood formula (eq 11.11): d[NO]/dt = (6.0e16 / sqrt(T)) * exp(-69090/T) * [O2]e^0.5 * [N2]e in mol/(cm^3 s)
  const totalMolarDensity = pressurePa / (8.314 * T); // mol/m^3
  const totalMolarDensityCm3 = totalMolarDensity * 1e-6; // mol/cm^3

  const n2ConcMolPerCm3 = 0.72 * totalMolarDensityCm3;
  const o2ConcMolPerCm3 = Math.max(1e-8, 0.04 * totalMolarDensityCm3 * (equivalenceRatioPhi <= 1.0 ? 1.0 : 0.2));

  const kHeywood = (6.0e16 / Math.sqrt(T)) * Math.exp(-69090.0 / T);
  const noRateCm3 = kHeywood * Math.sqrt(o2ConcMolPerCm3) * n2ConcMolPerCm3; // mol/(cm^3 s)
  const noRateM3 = noRateCm3 * 1e6; // mol/(m^3 s)

  // Accumulated NOx over ~15 ms combustion window scaled by mass burned fraction
  const accumulatedNoMolPerM3 = noRateM3 * 0.015 * burnedFraction;
  const noxMoleFraction = Math.min(0.005, accumulatedNoMolPerM3 / Math.max(1.0, totalMolarDensity));
  const noxPpm = noxMoleFraction * 1e6;

  return {
    noxRateMolPerM3S: noRateM3,
    noxPpm: Math.max(0.0, noxPpm),
  };
}

/**
 * Livengood-Wu autoignition integral for knock detection:
 * I = \int_0^t (1 / \tau(P, T)) dt
 * where \tau = A * P^(-n) * exp(B / T)
 * If I >= 1.0 before flame arrival, knock occurs.
 */
export function evaluateLivengoodWuKnock(
  unburnedGasTempK: number,
  pressurePa: number,
  dtS: number,
  accumulatedIntegral: number,
  octaneNumber = 95.0,
): { currentIntegral: number; knockDetected: boolean; ignitionDelayMs: number } {
  const pBar = pressurePa / 1e5;
  const T = Math.max(300.0, unburnedGasTempK);

  // Douaud & Eyzat correlation calibrated with Research Octane Number (RON)
  // tau = 0.0186 * (RON / 100)^3.402 * P^(-1.7) * exp(3800 / T)  in seconds
  const ronFactor = Math.pow(octaneNumber / 100.0, 3.402);
  const tauS = 0.0186 * ronFactor * Math.pow(Math.max(1.0, pBar), -1.7) * Math.exp(3800.0 / T);
  const tauClamped = Math.max(0.0001, tauS);

  const deltaI = dtS / tauClamped;
  const newIntegral = accumulatedIntegral + deltaI;

  return {
    currentIntegral: newIntegral,
    knockDetected: newIntegral >= 1.0,
    ignitionDelayMs: tauClamped * 1000.0,
  };
}
