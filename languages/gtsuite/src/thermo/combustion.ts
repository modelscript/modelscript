// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtCombustionModelConfig } from "../types.js";

export interface CrankSliderKinematics {
  crankAngleDeg: number;
  crankAngleRad: number;
  volumeM3: number;
  dVolumeDThetaM3PerRad: number;
  pistonPositionM: number;
  pistonVelocityMS: number;
  meanPistonSpeedMS: number;
  cylinderWallAreaM2: number;
}

/**
 * Calculates crank-slider kinematics (volume, derivative, piston speed, and surface area).
 */
export function calculateCrankSliderKinematics(
  crankAngleDeg: number,
  boreM: number,
  strokeM: number,
  connectingRodLengthM: number,
  compressionRatio: number,
  engineSpeedRpm: number,
): CrankSliderKinematics {
  const thetaRad = (crankAngleDeg * Math.PI) / 180.0;
  const omega = (2.0 * Math.PI * engineSpeedRpm) / 60.0; // rad/s
  const meanVp = (2.0 * strokeM * engineSpeedRpm) / 60.0; // m/s

  const crankRadiusM = strokeM / 2.0;
  const lambdaRod = crankRadiusM / connectingRodLengthM; // R_crank / L_rod

  const displacementM3 = (Math.PI / 4.0) * boreM * boreM * strokeM;
  const clearanceM3 = displacementM3 / (compressionRatio - 1.0);

  // Piston distance from TDC: x = r * (1 - cos(theta) + (1/lambdaRod) * (1 - sqrt(1 - lambda^2 * sin^2(theta))))
  const sinT = Math.sin(thetaRad);
  const cosT = Math.cos(thetaRad);
  const sqrtTerm = Math.sqrt(Math.max(1e-6, 1.0 - lambdaRod * lambdaRod * sinT * sinT));

  const xFromTdc = crankRadiusM * (1.0 - cosT + (1.0 / lambdaRod) * (1.0 - sqrtTerm));
  const dxDTheta = crankRadiusM * (sinT + (lambdaRod * sinT * cosT) / sqrtTerm);

  const volumeM3 = clearanceM3 + (Math.PI / 4.0) * boreM * boreM * xFromTdc;
  const dVolumeDTheta = (Math.PI / 4.0) * boreM * boreM * dxDTheta;
  const pistonVelocityMS = dxDTheta * omega;

  // Surface area: head + piston crown + liner exposed
  const pistonArea = (Math.PI / 4.0) * boreM * boreM;
  const headArea = pistonArea * 1.1; // valve pockets
  const linerArea = Math.PI * boreM * xFromTdc;
  const totalAreaM2 = headArea + pistonArea + linerArea;

  return {
    crankAngleDeg,
    crankAngleRad: thetaRad,
    volumeM3,
    dVolumeDThetaM3PerRad: dVolumeDTheta,
    pistonPositionM: xFromTdc,
    pistonVelocityMS,
    meanPistonSpeedMS: meanVp,
    cylinderWallAreaM2: totalAreaM2,
  };
}

/**
 * Evaluates mass fraction burned (MFB) and burn rate dx_b/dtheta using Wiebe or double Wiebe.
 */
export function evaluateBurnRate(
  crankAngleDeg: number,
  config: GtCombustionModelConfig,
  imposedMfbTable?: number[][],
): { mfb: number; burnRatePerDeg: number } {
  // If imposed MFB table is provided, interpolate
  if (config.type === "imposed_mfb" && imposedMfbTable && imposedMfbTable.length > 1) {
    let mfb = 0;
    let rate = 0;
    for (let i = 0; i < imposedMfbTable.length - 1; i++) {
      const ca0 = imposedMfbTable[i]![0]!;
      const ca1 = imposedMfbTable[i + 1]![0]!;
      if (crankAngleDeg >= ca0 && crankAngleDeg <= ca1) {
        const y0 = imposedMfbTable[i]![1]!;
        const y1 = imposedMfbTable[i + 1]![1]!;
        const dCa = ca1 - ca0;
        const frac = dCa > 0 ? (crankAngleDeg - ca0) / dCa : 0;
        mfb = y0 + frac * (y1 - y0);
        rate = dCa > 0 ? (y1 - y0) / dCa : 0;
        break;
      }
    }
    return {
      mfb: Math.max(0.0, Math.min(1.0, mfb)),
      burnRatePerDeg: Math.max(0.0, rate),
    };
  }

  // Handle double Wiebe
  if (config.type === "double_wiebe") {
    const fPilot = config.pilotFraction ?? 0.15;
    const pilotAnchor = config.pilotAnchorDeg ?? config.anchorAngleDeg - 15.0;
    const pilotDur = config.pilotDurationDeg ?? config.durationDeg * 0.4;

    const pilotRes = singleWiebe(crankAngleDeg, pilotAnchor, pilotDur, 2.0, 5.0);
    const mainRes = singleWiebe(
      crankAngleDeg,
      config.anchorAngleDeg,
      config.durationDeg,
      config.wiebeExponentM ?? 2.0,
      config.wiebeEfficiencyA ?? 5.0,
    );

    return {
      mfb: fPilot * pilotRes.mfb + (1.0 - fPilot) * mainRes.mfb,
      burnRatePerDeg: fPilot * pilotRes.rate + (1.0 - fPilot) * mainRes.rate,
    };
  }

  // Single Wiebe
  const anchor = config.anchorAngleDeg;
  const dur = config.durationDeg;
  const m = config.wiebeExponentM ?? 2.0;
  const a = config.wiebeEfficiencyA ?? 5.0;

  const res = singleWiebe(crankAngleDeg, anchor, dur, m, a);
  return { mfb: res.mfb, burnRatePerDeg: res.rate };
}

function singleWiebe(
  theta: number,
  theta0: number,
  deltaTheta: number,
  m: number,
  a: number,
): { mfb: number; rate: number } {
  if (theta < theta0) {
    return { mfb: 0.0, rate: 0.0 };
  }
  if (theta >= theta0 + deltaTheta) {
    return { mfb: 1.0, rate: 0.0 };
  }

  const tau = (theta - theta0) / deltaTheta;
  const term = a * Math.pow(tau, m + 1.0);
  const expTerm = Math.exp(-term);
  const mfb = 1.0 - expTerm;
  const rate = ((a * (m + 1.0)) / deltaTheta) * Math.pow(tau, m) * expTerm;

  return { mfb, rate };
}
