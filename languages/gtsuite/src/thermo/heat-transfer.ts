// SPDX-License-Identifier: AGPL-3.0-or-later

export interface HeatTransferResult {
  heatTransferCoeffWPerM2K: number;
  heatFluxWPerM2: number;
  totalHeatLossW: number;
}

/**
 * Evaluates in-cylinder convective heat transfer coefficient using the Woschni (1967/1979) correlation.
 */
export function calculateWoschniHeatTransfer(
  boreM: number,
  pressurePa: number,
  tempK: number,
  meanPistonSpeedMS: number,
  _displacementM3: number,
  isCombustionPhase: boolean,
  firingPressureRisePa = 0.0,
  wallTemperatureK = 450.0,
  cylinderAreaM2 = 0.03,
  multiplier = 1.0,
): HeatTransferResult {
  const pBar = pressurePa / 1e5;
  const B = Math.max(0.01, boreM);
  const T = Math.max(250.0, tempK);

  // Characteristic gas velocity w
  let c1 = 2.28;
  let c2 = 0.0;
  if (isCombustionPhase) {
    c1 = 2.28;
    c2 = 3.24e-3; // m/(s K)
  }

  const pRiseBar = Math.max(0.0, firingPressureRisePa / 1e5);
  // w = c1 * v_p + c2 * (Vd * Tr / (Pr * Vr)) * (P - Pmot)
  const characteristicVelocity = c1 * meanPistonSpeedMS + c2 * pRiseBar * 10.0;
  const w = Math.max(0.1, characteristicVelocity);

  // Woschni formula: h = 130 * B^(-0.2) * P^(0.8) * T^(-0.53) * w^(0.8) in W/(m^2 K)
  const hWoschni = 130.0 * Math.pow(B, -0.2) * Math.pow(pBar, 0.8) * Math.pow(T, -0.53) * Math.pow(w, 0.8) * multiplier;

  const hClamped = Math.max(20.0, Math.min(6000.0, hWoschni));
  const heatFlux = hClamped * Math.max(0.0, T - wallTemperatureK);
  const totalLoss = heatFlux * cylinderAreaM2;

  return {
    heatTransferCoeffWPerM2K: hClamped,
    heatFluxWPerM2: heatFlux,
    totalHeatLossW: totalLoss,
  };
}
