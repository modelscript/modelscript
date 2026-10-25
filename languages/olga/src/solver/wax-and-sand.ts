// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Flow Assurance Physics: Wax Deposition & Sand Transport.
 *
 * Implements:
 * 1. Molecular diffusion wax deposition kinetics (Burger & Perkins model)
 * 2. Wicks & Salama critical sand deposition velocity
 * 3. API RP 14E multiphase erosional velocity screening
 */

import type { OlgaSandConfig, OlgaWaxConfig } from "../types.js";

export interface EvaluatedWaxCell {
  isDepositing: boolean;
  wallTempK: number;
  cloudPointTempK: number;
  depositionRateMetersPerSec: number; // dr_wax / dt [m/s]
  waxThicknessMeters: number; // accumulated wax layer [m]
  effectiveDiameter: number; // D_0 - 2 * waxThickness [m]
}

export interface EvaluatedSandCell {
  isDroppingOut: boolean; // mixture velocity below critical deposition velocity
  isEroding: boolean; // mixture velocity above API RP 14E limit
  criticalDepositionVelocity: number; // v_dep [m/s]
  erosionalVelocityLimit: number; // v_e [m/s]
  mixtureVelocity: number; // v_m [m/s]
}

/**
 * Computes wax layer growth along a pipe wall section over a time step dt.
 */
export function evaluateWaxDeposition(
  waxConfig: OlgaWaxConfig | undefined,
  bulkTempK: number,
  wallTempK: number,
  pipeDiameter: number,
  mixtureVelocity: number,
  mixtureViscosity: number,
  mixtureDensity: number,
  currentWaxThickness: number,
  dtSeconds: number,
): EvaluatedWaxCell {
  if (!waxConfig || wallTempK >= waxConfig.cloudPointTemp) {
    return {
      isDepositing: false,
      wallTempK,
      cloudPointTempK: waxConfig?.cloudPointTemp ?? 288.15,
      depositionRateMetersPerSec: 0.0,
      waxThicknessMeters: currentWaxThickness,
      effectiveDiameter: Math.max(0.01, pipeDiameter - 2.0 * currentWaxThickness),
    };
  }

  const dWax = waxConfig.molecularDiffusionCoeff ?? 1.5e-9; // m^2 / s
  const rhoWax = waxConfig.waxDensity ?? 880.0; // kg / m^3
  // Solubility gradient dC/dT ~ 0.0015 kg / (m^3 * K)
  const dCdT = 0.0015;

  // Laminar sublayer thickness delta_lam = 50 * D / Re^(7/8)
  const re = (mixtureDensity * Math.abs(mixtureVelocity) * pipeDiameter) / Math.max(1e-6, mixtureViscosity);
  const deltaLam = Math.max(1e-4, (50.0 * pipeDiameter) / Math.pow(Math.max(100.0, re), 0.875));

  // Radial temperature gradient dT/dr ~ (T_bulk - T_wall) / delta_lam
  const tempDiff = Math.max(0.1, bulkTempK - wallTempK);
  const dtdr = tempDiff / deltaLam;

  // dr_wax / dt = (D_wax / rho_wax) * (dC/dT) * (dT/dr)
  const rate = (dWax / rhoWax) * dCdT * dtdr;
  const newThickness = Math.min(pipeDiameter * 0.4, currentWaxThickness + rate * dtSeconds);

  return {
    isDepositing: true,
    wallTempK,
    cloudPointTempK: waxConfig.cloudPointTemp,
    depositionRateMetersPerSec: rate,
    waxThicknessMeters: newThickness,
    effectiveDiameter: Math.max(0.01, pipeDiameter - 2.0 * newThickness),
  };
}

/**
 * Evaluates sand transport deposition and API RP 14E erosional limits for a pipe cell.
 */
export function evaluateSandTransport(
  sandConfig: OlgaSandConfig | undefined,
  mixtureVelocity: number,
  liquidDensity: number,
  liquidViscosity: number,
  mixtureDensity: number,
  pipeDiameter: number,
): EvaluatedSandCell {
  const dp = sandConfig?.particleDiameter ?? 1.5e-4; // 150 microns
  const rhoSand = sandConfig?.sandDensity ?? 2650.0; // kg / m^3
  const g = 9.80665;

  // Wicks & Salama (1975) critical sand deposition velocity
  const densityRatio = Math.max(0.1, (rhoSand - liquidDensity) / liquidDensity);
  const nuLiquid = Math.max(1e-7, liquidViscosity / liquidDensity);
  const vDep =
    1.9 *
    Math.pow(dp, 1.0 / 6.0) *
    Math.pow(densityRatio, 1.0 / 3.0) *
    Math.pow(g, 1.0 / 3.0) *
    Math.pow(nuLiquid / pipeDiameter, 1.0 / 9.0);

  // API RP 14E Erosional Velocity: v_e = C / sqrt(rho_m), C ~ 100 for solids
  const cFactor = sandConfig && sandConfig.sandMassRate > 0 ? 100.0 : 122.0;
  const vErosion = cFactor / Math.sqrt(Math.max(1.0, mixtureDensity));

  const vm = Math.abs(mixtureVelocity);
  const isDroppingOut = vm < vDep && (sandConfig?.sandMassRate ?? 0) > 0;
  const isEroding = vm > vErosion;

  return {
    isDroppingOut,
    isEroding,
    criticalDepositionVelocity: vDep,
    erosionalVelocityLimit: vErosion,
    mixtureVelocity: vm,
  };
}
