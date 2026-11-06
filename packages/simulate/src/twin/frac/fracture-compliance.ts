// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Dynamic Fracture Compliance Engine.
 *
 * Implements:
 * 1. Net fracture pressure calculation:
 *    P_net(t) = BHTP(t) - sigma_min - dP_perf(t) - dP_tortuosity(t)
 * 2. Carter one-dimensional fluid leak-off volume conservation.
 * 3. Dynamic compliance state evolution:
 *    C_f(t) = dV_frac / dP_net = (Q_in - Q_leakoff) / (dP_net / dt)
 * 4. PKN and KGD theoretical compliance baselines for validation.
 */

import type { FractureComplianceState, StageCompletionConfig } from "./types.js";

export interface FractureComplianceOptions {
  /** Carter leak-off coefficient C_L (m / s^0.5, default: 2.5e-4 m/s^0.5). */
  carterLeakoffCoeff?: number | undefined;
  /** Estimated two-wing fracture height h_f (meters, default: 35.0 m). */
  fractureHeightMeters?: number | undefined;
  /** Near-wellbore tortuosity coefficient K_tort (Pa / (m³/s)^2, default: 2.0e7). */
  tortuosityCoefficient?: number | undefined;
  /** Minimum horizontal closure stress sigma_min override (Pascals). */
  closureStressPascals?: number | undefined;
  /** Initial fracture volume (m³, default: 0.1). */
  initialFractureVolumeM3?: number | undefined;
}

/**
 * Computes net pressure P_net inside the fracture.
 *
 * P_net = BHTP - sigma_min - dP_perf - dP_tortuosity
 */
export function calculateNetPressure(
  bhtp: number,
  closureStress: number,
  perfFriction: number,
  tortuosityPressure: number,
): number {
  return Math.max(0.0, bhtp - closureStress - perfFriction - tortuosityPressure);
}

/**
 * Computes theoretical PKN (Perkins-Kern-Nordgren) compliance for a planar vertical fracture.
 *
 * Formula:
 *   C_f_PKN = (pi * (1 - nu) * h_f * L) / (2 * E)
 *
 * @param halfLengthMeters   Fracture half-length L (m).
 * @param heightMeters       Fracture height h_f (m).
 * @param youngsModulusPa    Formation Young's modulus E (Pa, default: 30 GPa).
 * @param poissonsRatio      Poisson's ratio nu (default: 0.25).
 */
export function theoreticalPknCompliance(
  halfLengthMeters: number,
  heightMeters = 35.0,
  youngsModulusPa = 3.0e10,
  poissonsRatio = 0.25,
): number {
  const l = Math.max(1.0, halfLengthMeters);
  const h = Math.max(5.0, heightMeters);
  const e = Math.max(1e8, youngsModulusPa);
  const nu = Math.max(0.1, Math.min(0.45, poissonsRatio));

  // C_f = pi * (1 - nu) * h^2 * L / (2 * E) for fracture volume compliance [m³ / Pa]
  return (Math.PI * (1.0 - nu) * h * h * l) / (2.0 * e);
}

/**
 * Evaluates Carter 1D fluid leak-off rate across permeable fracture faces.
 *
 * Q_leakoff(t) = 2 * C_L * A_frac / sqrt(t)
 */
export function calculateCarterLeakoffRate(
  carterCoeff: number,
  fractureAreaM2: number,
  elapsedTimeSeconds: number,
): number {
  const t = Math.max(1.0, elapsedTimeSeconds);
  const area = Math.max(1.0, fractureAreaM2);
  const cl = Math.max(1e-6, carterCoeff);

  return (2.0 * cl * area) / Math.sqrt(t);
}

/**
 * Advances the dynamic fracture compliance state by time step dt.
 */
export function stepFractureCompliance(
  prevState: FractureComplianceState,
  stage: StageCompletionConfig,
  bhtp: number,
  totalSlurryRate: number,
  avgPerfFriction: number,
  dtSeconds: number,
  options?: FractureComplianceOptions | undefined,
): FractureComplianceState {
  const dt = Math.max(1e-4, dtSeconds);
  const sigmaMin = options?.closureStressPascals ?? stage.closurePressurePascals;
  const kTort = options?.tortuosityCoefficient ?? 2.0e7;
  const cl = options?.carterLeakoffCoeff ?? 2.5e-4;
  const hf = options?.fractureHeightMeters ?? 35.0;

  // 1. Near-wellbore tortuosity pressure drop (decays with proppant throughput)
  // dP_tort = K_tort * Q^2
  const dPTortuosity = kTort * Math.pow(totalSlurryRate, 2.0);

  // 2. Net pressure: P_net = BHTP - sigma_min - dP_perf - dP_tortuosity
  const currentNetPressure = calculateNetPressure(bhtp, sigmaMin, avgPerfFriction, dPTortuosity);

  // 3. Approximate fracture surface area from current volume and height
  // For 2-wing vertical planar fracture: V = 2 * L * h_f * w_avg
  const approxWidth = 0.003;
  const halfLength = prevState.fractureVolumeM3 / Math.max(1.0, 2.0 * hf * approxWidth);
  const fractureArea = Math.max(10.0, 4.0 * halfLength * hf);

  // 4. Fluid leak-off rate
  const qLeakoff = calculateCarterLeakoffRate(cl, fractureArea, prevState.timeSeconds + dt);
  const netFlowRate = Math.max(0.0, totalSlurryRate - qLeakoff);

  // 5. Volume integration
  const newVolume = Math.max(0.01, prevState.fractureVolumeM3 + netFlowRate * dt);

  // 6. Instantaneous and regularized compliance C_f = dV / dP_net
  const deltaPnet = currentNetPressure - prevState.netPressurePascals;
  const dPnetDt = deltaPnet / dt;

  let instantaneousCompliance: number;
  if (Math.abs(dPnetDt) > 10.0) {
    // Meaningful pressure derivative observed
    const rawCompliance = netFlowRate / dPnetDt;
    // Bound compliance to physical range: 1e-8 to 1e-2 m³/Pa
    instantaneousCompliance = Math.max(1e-8, Math.min(1e-2, rawCompliance));
  } else {
    // Steady state / derivative near zero: estimate from total volume / net pressure ratio
    instantaneousCompliance =
      currentNetPressure > 1e4 ? newVolume / currentNetPressure : prevState.complianceM3PerPascal;
  }

  // Exponential moving average filter for smooth real-time compliance tracking (alpha ~ 0.15)
  const alpha = 0.15;
  const smoothedCompliance = (1.0 - alpha) * prevState.complianceM3PerPascal + alpha * instantaneousCompliance;

  return {
    timeSeconds: prevState.timeSeconds + dt,
    netPressurePascals: currentNetPressure,
    complianceM3PerPascal: Math.max(1e-8, smoothedCompliance),
    fractureVolumeM3: newVolume,
    leakoffRateM3PerSec: qLeakoff,
    nearWellboreTortuosityPascals: dPTortuosity,
  };
}

/**
 * Initializes fracture compliance state.
 */
export function initializeFractureCompliance(
  stage: StageCompletionConfig,
  initialBhtp: number,
  initialRate: number,
  options?: FractureComplianceOptions | undefined,
): FractureComplianceState {
  const sigmaMin = options?.closureStressPascals ?? stage.closurePressurePascals;
  const kTort = options?.tortuosityCoefficient ?? 2.0e7;
  const dPTort = kTort * Math.pow(initialRate, 2.0);
  const pNet = Math.max(1e4, initialBhtp - sigmaMin - dPTort);
  const initVol = options?.initialFractureVolumeM3 ?? 0.1;

  // Initial compliance baseline from PKN
  const initCompliance = theoreticalPknCompliance(10.0, options?.fractureHeightMeters ?? 35.0);

  return {
    timeSeconds: 0.0,
    netPressurePascals: pNet,
    complianceM3PerPascal: initCompliance,
    fractureVolumeM3: initVol,
    leakoffRateM3PerSec: 0.0,
    nearWellboreTortuosityPascals: dPTort,
  };
}
