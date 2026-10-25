// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Rotating Machinery Solver Engine.
 *
 * Implements:
 * 1. Multiphase booster pumps & Electric Submersible Pumps (ESP) with free-gas head degradation
 * 2. Centrifugal & reciprocating gas compressors with polytropic thermal rise and anti-surge limits
 */

import type { OlgaCompressor, OlgaPump } from "../types.js";

export interface EvaluatedPumpPerformance {
  pressureBoostPa: number; // Delta P [Pa]
  actualHeadMeters: number; // Head [m]
  powerConsumedKw: number; // Motor power [kW]
  gasVoidFraction: number; // alpha_G at pump suction
  isGasLocked: boolean; // whether GVF exceeds gassing limit
  headDegradationFactor: number; // fraction [0.0 - 1.0]
}

export interface EvaluatedCompressorPerformance {
  dischargePressurePa: number; // P_discharge [Pa]
  dischargeTemperatureK: number; // T_discharge [K]
  pressureBoostPa: number; // Delta P [Pa]
  powerConsumedKw: number; // Motor power [kW]
  isSurging: boolean; // whether operating below surge line
  surgeMarginFraction: number; // margin above surge line
}

/**
 * Evaluates multiphase pump head and pressure boost accounting for free gas degradation.
 *
 * @param pump          Pump specification
 * @param rhoMixture    Local mixture density [kg/m^3]
 * @param alphaG        Gas void fraction at suction [0.0 - 1.0]
 * @param volumeFlow    Total mixture volumetric flow rate [m^3/s]
 */
export function evaluatePumpBoost(
  pump: OlgaPump,
  rhoMixture: number,
  alphaG: number,
  volumeFlow: number,
): EvaluatedPumpPerformance {
  const g = 9.80665;
  const gvf = Math.max(0.0, Math.min(0.99, alphaG));
  const isGasLocked = gvf > pump.gasVoidFractionLimit;

  // Head degradation factor due to free gas bubbles (Turpin / Sachdeva model)
  const beta = pump.type === "MULTIPHASE_TWIN_SCREW" ? 0.75 : pump.type === "ESP" ? 2.5 : 3.8;
  const degradation = Math.max(0.02, Math.exp(-beta * (gvf / Math.max(0.01, 1.0 - gvf))));

  const speedRatio = Math.max(0.1, pump.speedRpm / 3500.0);
  const headM = pump.ratedHead * speedRatio * speedRatio * degradation;
  const pressureBoost = rhoMixture * g * headM;

  // Power = Q * DeltaP / efficiency (typical hydraulic efficiency ~ 0.68)
  const efficiency = 0.68;
  const flow = Math.max(1e-4, Math.abs(volumeFlow));
  const powerKw = (flow * pressureBoost) / (1000.0 * efficiency);

  return {
    pressureBoostPa: pressureBoost,
    actualHeadMeters: headM,
    powerConsumedKw: Math.min(pump.ratedPowerKw * 1.5, powerKw),
    gasVoidFraction: gvf,
    isGasLocked,
    headDegradationFactor: degradation,
  };
}

/**
 * Evaluates centrifugal or reciprocating compressor discharge pressure, temperature, and power.
 *
 * @param compressor    Compressor specification
 * @param suctionP      Suction pressure [Pa]
 * @param suctionT      Suction temperature [K]
 * @param gasMassRate   Gas mass flow rate [kg/s]
 * @param kAdiabatic    Isentropic exponent k = Cp/Cv (typically ~1.28 for natural gas)
 */
export function evaluateCompressorBoost(
  compressor: OlgaCompressor,
  suctionP: number,
  suctionT: number,
  gasMassRate: number,
  kAdiabatic = 1.28,
): EvaluatedCompressorPerformance {
  const pSuction = Math.max(1.0e5, suctionP);
  const tSuction = Math.max(200.0, suctionT);
  const pi = Math.max(1.01, compressor.pressureRatio);
  const eta = Math.max(0.5, Math.min(0.95, compressor.polytropicEfficiency));

  const pDischarge = pSuction * pi;
  const deltaP = pDischarge - pSuction;

  // Polytropic thermal rise: T_d = T_s * (P_d / P_s)^((k - 1) / (k * eta))
  const exponent = (kAdiabatic - 1.0) / (kAdiabatic * eta);
  const tDischarge = tSuction * Math.pow(pi, exponent);

  // Shaft power: W = (m_dot / eta) * (k / (k - 1)) * R * T_s * (pi^((k - 1)/k) - 1)
  const R_gas = 8314.46 / 19.5; // J / (kg * K) for natural gas (~19.5 g/mol)
  const isentropicWorkPerKg =
    (kAdiabatic / (kAdiabatic - 1.0)) * R_gas * tSuction * (Math.pow(pi, (kAdiabatic - 1.0) / kAdiabatic) - 1.0);
  const mDot = Math.max(0.01, gasMassRate);
  const powerKw = (mDot * isentropicWorkPerKg) / (1000.0 * eta);

  // Surge screening
  const minFlowForSurge = 1.2; // kg/s minimum flow limit
  const isSurging = mDot < minFlowForSurge;
  const surgeMargin = (mDot - minFlowForSurge) / minFlowForSurge;

  return {
    dischargePressurePa: pDischarge,
    dischargeTemperatureK: tDischarge,
    pressureBoostPa: deltaP,
    powerConsumedKw: Math.min(compressor.ratedPowerKw * 2.0, powerKw),
    isSurging,
    surgeMarginFraction: surgeMargin,
  };
}
