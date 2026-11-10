// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Method of Characteristics (MOC) Water Hammer Surge Solver.
 *
 * Simulates high-frequency acoustic pressure waves, Joukowsky surge spikes,
 * check valve slam, pump power failure spin-down, 4-quadrant Suter pump dynamics,
 * Discrete Vapor Cavity Model (DVCM) column separation, and surge protection devices.
 */

export interface WaterHammerPipeParams {
  id: string;
  lengthM: number;
  diameterM: number;
  waveSpeedMps?: number | undefined; // Acoustic wave speed a [m/s], default: 1200 m/s
  darcyRoughness?: number | undefined; // Darcy-Weisbach f friction factor, default: 0.02
  elevationUpstreamM?: number | undefined;
  elevationDownstreamM?: number | undefined;
}

export type TransientEventType = "VALVE_CLOSURE" | "PUMP_TRIP";

export type PumpSpecificSpeedType = "RADIAL" | "MIXED_FLOW" | "AXIAL";

/**
 * Configuration for dynamic 4-quadrant pump coastdown (Suter transformation)
 * under electrical power failure (trip) and check valve slam.
 */
export interface FourQuadrantPumpConfig {
  specificSpeedType?: PumpSpecificSpeedType | undefined; // Default: "RADIAL"
  momentOfInertiaKgM2: number; // Combined pump, motor, entrained fluid polar inertia I [kg*m^2]
  ratedSpeedRpm: number; // Rated rotational speed N_R [rpm]
  ratedFlowM3s: number; // Rated discharge Q_R [m^3/s]
  ratedHeadM: number; // Rated dynamic head H_R [m]
  ratedEfficiency?: number | undefined; // Hydraulic efficiency at BEP (default: 0.85)
  hasCheckValve?: boolean | undefined; // Whether non-return check valve is installed on discharge
  checkValveClosureDelaySeconds?: number | undefined; // Optional valve closure delay once flow reverses
}

export interface WaterHammerEvent {
  type: TransientEventType;
  durationSeconds: number; // e.g. valve closure time or pump inertia spin-down time
  exponent?: number | undefined; // Closure curve shape exponent (1.0 = linear), default: 1.0
  pumpCoastdown?: FourQuadrantPumpConfig | undefined; // 4-quadrant Suter dynamics on pump power failure
}

export type SurgeProtectionType = "AIR_VESSEL" | "AIR_VALVE" | "RELIEF_VALVE";

export interface AirVesselConfig {
  type: "AIR_VESSEL";
  initialAirVolumeM3: number; // Initial gas pocket volume V0 [m^3]
  polytropicExponent?: number | undefined; // Gas expansion/compression exponent gamma (default: 1.2)
  orificeLossCoeffInflow?: number | undefined; // Resistance coeff into vessel Rin (default: 0.5)
  orificeLossCoeffOutflow?: number | undefined; // Throttled resistance coeff out of vessel Rout (default: 2.0)
}

export interface AirReleaseValveConfig {
  type: "AIR_VALVE";
  inletOrificeDiameterMm: number; // Large vacuum relief intake orifice (e.g. 100mm)
  outletOrificeDiameterMm: number; // Small air discharge / anti-slam orifice (e.g. 25mm)
  dischargeCoeff?: number | undefined; // Orifice discharge coefficient Cd (default: 0.65)
}

export interface SurgeReliefValveConfig {
  type: "RELIEF_VALVE";
  setPressureHeadM: number; // Cracking pressure head to open Hset [m]
  dischargeCoeff: number; // Relief flow capacity coefficient Cv
}

export type SurgeProtectionDevice = AirVesselConfig | AirReleaseValveConfig | SurgeReliefValveConfig;

export interface WaterHammerOptions {
  simulationDurationSeconds?: number | undefined; // Total duration to simulate, default: 5.0s
  spatialReaches?: number | undefined; // Number of spatial divisions N, default: 10
  suctionHeadM?: number | undefined; // Pump suction head for pump trip simulations (default: elevationUpstreamM)
  vaporPressureHeadM?: number | undefined; // Water vapor pressure head, default: -10.0m (cavitation limit)
  enableDvcmCavitation?: boolean | undefined; // Enable Discrete Vapor Cavity Model (DVCM) column separation (default: true)
  dvcmWeightingFactor?: number | undefined; // DVCM weighting factor psi (default: 0.5 for Crank-Nicolson)
  surgeProtection?: SurgeProtectionDevice | undefined; // Protective surge suppression device
  protectionLocation?: "UPSTREAM" | "MIDPOINT" | "DOWNSTREAM" | undefined; // Default: "DOWNSTREAM"
}

export type PumpQuadrant = "NORMAL" | "ENERGY_DISSIPATION" | "TURBINE_RUNAWAY" | "REVERSE_PUMPING";

export interface WaterHammerTimeStep {
  timeSeconds: number;
  headUpstreamM: number;
  headMidpointM: number;
  headDownstreamM: number;
  flowUpstreamM3s: number;
  flowMidpointM3s: number;
  flowDownstreamM3s: number;
  pressureDownstreamPsi: number;
  protectionFlowM3s?: number | undefined;
  airVesselVolumeM3?: number | undefined;
  maxCavityVolumeM3?: number | undefined;
  pumpSpeedRpm?: number | undefined;
  pumpHeadM?: number | undefined;
  pumpTorqueNm?: number | undefined;
  pumpQuadrant?: PumpQuadrant | undefined;
  checkValveOpen?: boolean | undefined;
}

export interface WaterHammerResult {
  timeSeries: WaterHammerTimeStep[];
  joukowskySurgeM: number; // Theoretical Delta H = (a * Delta v) / g
  maxHeadM: number;
  minHeadM: number;
  maxHeadDownstreamM?: number | undefined;
  minHeadDownstreamM?: number | undefined;
  maxPressurePsi: number;
  minPressurePsi: number;
  cavitationOccurred: boolean;
  cavitationCollapseOccurred?: boolean | undefined;
  maxCavityVolumeM3?: number | undefined;
  maxCollapseSurgeM?: number | undefined;
  maxReverseFlowM3s?: number | undefined;
  maxRunawaySpeedRpm?: number | undefined;
  checkValveSlamHeadM?: number | undefined;
  waveTravelTimeSeconds: number; // 2L / a
  fundamentalPeriodSeconds: number; // 4L / a
  surgeProtectionActive?: boolean | undefined;
  surgeSuppressionRatioPct?: number | undefined; // Percentage reduction in surge spike vs unprotected
}

const G_ACCEL = 9.80665;
const M_TO_PSI = 1.4219702; // meters of water to psi
const WATER_DENSITY = 1000.0; // kg/m^3

interface SuterKnot {
  theta: number;
  wH: number;
  wB: number;
}

// Benchmark empirical Suter characteristic curve knot points (Marchal, Flesch & Suter 1965, Chaudhry 2014)
const SUTER_TABLES: Record<PumpSpecificSpeedType, SuterKnot[]> = {
  RADIAL: [
    { theta: 0.0, wH: -0.42, wB: 0.35 },
    { theta: Math.PI / 4, wH: 0.5, wB: 0.5 },
    { theta: Math.PI / 2, wH: 1.25, wB: 0.38 },
    { theta: (3 * Math.PI) / 4, wH: 0.85, wB: 0.65 },
    { theta: Math.PI, wH: -0.6, wB: -0.45 },
    { theta: 4.05, wH: -0.05, wB: 0.0 }, // Zero torque runaway point
    { theta: (5 * Math.PI) / 4, wH: -0.15, wB: -0.1 },
    { theta: (3 * Math.PI) / 2, wH: -0.72, wB: -0.32 },
    { theta: (7 * Math.PI) / 4, wH: -0.48, wB: 0.22 },
    { theta: 2 * Math.PI, wH: -0.42, wB: 0.35 },
  ],
  MIXED_FLOW: [
    { theta: 0.0, wH: -0.35, wB: 0.4 },
    { theta: Math.PI / 4, wH: 0.5, wB: 0.5 },
    { theta: Math.PI / 2, wH: 1.6, wB: 0.55 },
    { theta: (3 * Math.PI) / 4, wH: 1.1, wB: 0.78 },
    { theta: Math.PI, wH: -0.7, wB: -0.5 },
    { theta: 4.12, wH: -0.02, wB: 0.0 },
    { theta: (5 * Math.PI) / 4, wH: -0.1, wB: -0.12 },
    { theta: (3 * Math.PI) / 2, wH: -0.85, wB: -0.4 },
    { theta: (7 * Math.PI) / 4, wH: -0.55, wB: 0.28 },
    { theta: 2 * Math.PI, wH: -0.35, wB: 0.4 },
  ],
  AXIAL: [
    { theta: 0.0, wH: -0.25, wB: 0.48 },
    { theta: Math.PI / 4, wH: 0.5, wB: 0.5 },
    { theta: Math.PI / 2, wH: 2.1, wB: 0.85 },
    { theta: (3 * Math.PI) / 4, wH: 1.45, wB: 1.05 },
    { theta: Math.PI, wH: -0.85, wB: -0.62 },
    { theta: 4.18, wH: 0.0, wB: 0.0 },
    { theta: (5 * Math.PI) / 4, wH: -0.05, wB: -0.15 },
    { theta: (3 * Math.PI) / 2, wH: -1.05, wB: -0.55 },
    { theta: (7 * Math.PI) / 4, wH: -0.65, wB: 0.35 },
    { theta: 2 * Math.PI, wH: -0.25, wB: 0.48 },
  ],
};

/**
 * Evaluates dimensionless head W_H and torque W_B via smooth piecewise interpolation
 * across the full 4-quadrant circle theta in [0, 2*pi).
 */
export function evaluateSuterCurves(
  thetaRad: number,
  specificSpeed: PumpSpecificSpeedType = "RADIAL",
): { wH: number; wB: number } {
  const twoPi = 2 * Math.PI;
  let th = thetaRad % twoPi;
  if (th < 0) th += twoPi;

  const table = SUTER_TABLES[specificSpeed] ?? SUTER_TABLES.RADIAL;
  for (let i = 0; i < table.length - 1; i++) {
    const k0 = table[i]!;
    const k1 = table[i + 1]!;
    if (th >= k0.theta && th <= k1.theta) {
      const span = k1.theta - k0.theta;
      const frac = span > 1e-9 ? (th - k0.theta) / span : 0.0;
      // Smooth cubic Hermite interpolation
      const h00 = 2 * frac * frac * frac - 3 * frac * frac + 1;
      const h01 = -2 * frac * frac * frac + 3 * frac * frac;
      const wH = h00 * k0.wH + h01 * k1.wH;
      const wB = h00 * k0.wB + h01 * k1.wB;
      return { wH, wB };
    }
  }

  const last = table[table.length - 1]!;
  return { wH: last.wH, wB: last.wB };
}

/**
 * Classifies operating quadrant from dimensionless speed alpha and discharge nu.
 */
export function classifyPumpQuadrant(alpha: number, nu: number): PumpQuadrant {
  if (alpha >= 0 && nu >= 0) return "NORMAL";
  if (alpha >= 0 && nu < 0) return "ENERGY_DISSIPATION";
  if (alpha < 0 && nu <= 0) return "TURBINE_RUNAWAY";
  return "REVERSE_PUMPING";
}

/**
 * Simulates transient water hammer along a pressurized pipeline using the standard Method of Characteristics (MOC).
 * Enhanced with Discrete Vapor Cavity Model (DVCM) and Suter 4-Quadrant Pump Coastdown Dynamics.
 */
export function solveWaterHammerMoc(
  pipe: WaterHammerPipeParams,
  steadyInitial: {
    flowM3s: number;
    headUpstreamM: number;
    headDownstreamM: number;
  },
  event: WaterHammerEvent,
  options?: WaterHammerOptions,
): WaterHammerResult {
  const L = Math.max(10.0, pipe.lengthM);
  const D = Math.max(0.01, pipe.diameterM);
  const a = Math.max(100.0, pipe.waveSpeedMps ?? 1200.0);
  const f = Math.max(0.005, pipe.darcyRoughness ?? 0.02);
  const N = Math.max(4, options?.spatialReaches ?? 10);
  const totalDuration = Math.max(1.0, options?.simulationDurationSeconds ?? 5.0);
  const vaporHead = options?.vaporPressureHeadM ?? -10.0;
  const enableDvcm = options?.enableDvcmCavitation ?? true;
  const psiDvcm = Math.max(0.0, Math.min(1.0, options?.dvcmWeightingFactor ?? 0.5));

  const elevUp = pipe.elevationUpstreamM ?? 0.0;
  const elevDn = pipe.elevationDownstreamM ?? 0.0;
  const exitHead = elevDn;

  const area = (Math.PI * D * D) / 4.0;
  const deltaX = L / N;
  const deltaT = deltaX / a; // Exact Courant condition: Cr = a * dt / dx = 1.0
  const numSteps = Math.max(2, Math.ceil(totalDuration / deltaT));

  // MOC Impedance B and Friction resistance R
  const B = a / (G_ACCEL * area);
  const R = (f * deltaX) / (2.0 * G_ACCEL * D * area * area);

  // Initial steady-state condition across spatial grid (i = 0 to N)
  const H_curr = new Float64Array(N + 1);
  const Q_curr = new Float64Array(N + 1);
  const H_next = new Float64Array(N + 1);
  const Q_next = new Float64Array(N + 1);

  // Discrete Vapor Cavity Model (DVCM) state arrays
  const V_cav = new Float64Array(N + 1); // Cavity volume at each node [m^3]
  const dQ_cav_old = new Float64Array(N + 1); // Previous step cavity volume growth rate

  const Q0 = steadyInitial.flowM3s;
  const H_up0 = steadyInitial.headUpstreamM;
  const H_dn0 = steadyInitial.headDownstreamM;
  const v0 = Q0 / area;
  const joukowskySurgeM = (a * Math.abs(v0)) / G_ACCEL;

  // Linear distribution of initial steady head
  for (let i = 0; i <= N; i++) {
    const frac = i / N;
    H_curr[i] = H_up0 + frac * (H_dn0 - H_up0);
    Q_curr[i] = Q0;
  }

  // Pre-calculate initial valve resistance constant Cv0: Q0 = Cv0 * sqrt(H_dn0 - H_exit)
  const initValveHeadDrop = Math.max(0.1, H_dn0 - exitHead);
  const Cv0 = Math.abs(Q0) / Math.sqrt(initValveHeadDrop);

  const CP = new Float64Array(N + 1);
  const CM = new Float64Array(N + 1);

  const timeSeries: WaterHammerTimeStep[] = [];
  let maxHeadM = Number.NEGATIVE_INFINITY;
  let minHeadM = Number.POSITIVE_INFINITY;
  let maxHeadDownstreamM = Number.NEGATIVE_INFINITY;
  let minHeadDownstreamM = Number.POSITIVE_INFINITY;
  let cavitationOccurred = false;
  let cavitationCollapseOccurred = false;
  let maxCavityVolumeM3 = 0.0;
  let maxCollapseSurgeM = 0.0;
  let maxReverseFlowM3s = 0.0;
  let maxRunawaySpeedRpm = 0.0;
  let checkValveSlamHeadM: number | undefined;

  const midIdx = Math.floor(N / 2);
  const closureTime = Math.max(deltaT, event.durationSeconds);
  const expVal = event.exponent ?? 1.0;

  // Surge Protection State
  const protection = options?.surgeProtection;
  let vesselAirVol = protection?.type === "AIR_VESSEL" ? Math.max(0.001, protection.initialAirVolumeM3) : 0.0;
  const gamma = protection?.type === "AIR_VESSEL" ? (protection.polytropicExponent ?? 1.2) : 1.2;
  const initialGasHead = Math.max(1.0, H_dn0 - exitHead);
  const gasConst = initialGasHead * Math.pow(Math.max(1e-3, vesselAirVol), gamma);

  // Four-Quadrant Suter Pump State
  const pumpCfg = event.pumpCoastdown;
  const isSuterPump = event.type === "PUMP_TRIP" && Boolean(pumpCfg);
  const N_R = pumpCfg?.ratedSpeedRpm ?? 1780.0;
  const omega_R = (2 * Math.PI * N_R) / 60.0;
  const Q_R = pumpCfg?.ratedFlowM3s ?? Math.max(1e-4, Math.abs(Q0));
  const H_R = pumpCfg?.ratedHeadM ?? Math.max(1.0, H_dn0 - H_up0);
  const eta_R = pumpCfg?.ratedEfficiency ?? 0.85;
  const inertia_I = Math.max(0.01, pumpCfg?.momentOfInertiaKgM2 ?? 50.0);
  const specSpeed = pumpCfg?.specificSpeedType ?? "RADIAL";
  const ratedTorque_TR = (WATER_DENSITY * G_ACCEL * Q_R * H_R) / (eta_R * omega_R);

  let pumpAlpha = 1.0; // Current speed ratio N / N_R
  let pumpNu = Q0 / Q_R; // Current discharge ratio Q / Q_R
  let checkValveOpen = true;

  for (let step = 0; step <= numSteps; step++) {
    const t = step * deltaT;

    // Record snapshot
    const hUp = H_curr[0]!;
    const hMid = H_curr[midIdx]!;
    const hDn = H_curr[N]!;
    const qUp = Q_curr[0]!;
    const qMid = Q_curr[midIdx]!;
    const qDn = Q_curr[N]!;
    const pDnPsi = (hDn - exitHead) * M_TO_PSI;

    if (hDn > maxHeadM) maxHeadM = hDn;
    if (hDn < minHeadM) minHeadM = hDn;
    if (hMid > maxHeadM) maxHeadM = hMid;
    if (hMid < minHeadM) minHeadM = hMid;
    if (hDn > maxHeadDownstreamM) maxHeadDownstreamM = hDn;
    if (hDn < minHeadDownstreamM) minHeadDownstreamM = hDn;

    if (hDn - exitHead < vaporHead || hMid - (elevUp + 0.5 * (elevDn - elevUp)) < vaporHead) {
      cavitationOccurred = true;
    }

    let currentMaxCav = 0.0;
    for (let i = 0; i <= N; i++) {
      if (V_cav[i]! > currentMaxCav) currentMaxCav = V_cav[i]!;
    }
    if (currentMaxCav > maxCavityVolumeM3) maxCavityVolumeM3 = currentMaxCav;

    // Pump state telemetry
    let pRpm: number | undefined;
    let pHeadM: number | undefined;
    let pTorqueNm: number | undefined;
    let pQuad: PumpQuadrant | undefined;

    if (isSuterPump) {
      pRpm = pumpAlpha * N_R;
      pQuad = classifyPumpQuadrant(pumpAlpha, pumpNu);
      const theta = Math.atan2(pumpAlpha, pumpNu);
      const { wH, wB } = evaluateSuterCurves(theta, specSpeed);
      const vSquare = pumpAlpha * pumpAlpha + pumpNu * pumpNu;
      pHeadM = H_R * vSquare * wH;
      pTorqueNm = ratedTorque_TR * vSquare * wB;
    }

    // Save history steps
    if (step % Math.max(1, Math.floor(numSteps / 200)) === 0 || step === numSteps) {
      timeSeries.push({
        timeSeconds: t,
        headUpstreamM: hUp,
        headMidpointM: hMid,
        headDownstreamM: hDn,
        flowUpstreamM3s: qUp,
        flowMidpointM3s: qMid,
        flowDownstreamM3s: qDn,
        pressureDownstreamPsi: pDnPsi,
        airVesselVolumeM3: protection?.type === "AIR_VESSEL" ? vesselAirVol : undefined,
        maxCavityVolumeM3: enableDvcm && currentMaxCav > 0 ? currentMaxCav : undefined,
        pumpSpeedRpm: pRpm,
        pumpHeadM: pHeadM,
        pumpTorqueNm: pTorqueNm,
        pumpQuadrant: pQuad,
        checkValveOpen: isSuterPump ? checkValveOpen : undefined,
      });
    }

    if (step === numSteps) break;

    // 1. Compute characteristic variables along C+ and C- for all interior points
    for (let i = 1; i <= N; i++) {
      // C+ line from (i-1) to i
      const qA = Q_curr[i - 1]!;
      const hA = H_curr[i - 1]!;
      CP[i] = hA + B * qA - R * qA * Math.abs(qA);
    }
    for (let i = 0; i < N; i++) {
      // C- line from (i+1) to i
      const qB = Q_curr[i + 1]!;
      const hB = H_curr[i + 1]!;
      CM[i] = hB - B * qB + R * qB * Math.abs(qB);
    }

    // 2. Interior nodes (i = 1 to N-1) with Discrete Vapor Cavity Model (DVCM)
    for (let i = 1; i < N; i++) {
      const cpVal = CP[i]!;
      const cmVal = CM[i]!;
      const hLiq = (cpVal + cmVal) / 2.0;
      const qLiq = (cpVal - cmVal) / (2.0 * B);

      const z_i = elevUp + (i / N) * (elevDn - elevUp);
      const hVapNode = z_i + vaporHead;

      if (enableDvcm && (hLiq < hVapNode || V_cav[i]! > 1e-7)) {
        cavitationOccurred = true;
        // Cavity is active: head is clamped to vapor pressure
        const qIn = (cpVal - hVapNode) / B;
        const qOut = (cmVal - hVapNode) / B;
        const dQ_new = qOut - qIn; // Net rate of cavity volume growth

        const dVol = deltaT * (psiDvcm * dQ_new + (1.0 - psiDvcm) * dQ_cav_old[i]!);
        const vNew = V_cav[i]! + dVol;
        dQ_cav_old[i] = dQ_new;

        if (vNew <= 0.0 && V_cav[i]! > 0.0) {
          // Vapor cavity collapses! Liquid columns collide
          cavitationCollapseOccurred = true;
          // Reconnection shock spike
          const collapseHead = hLiq - (B * vNew) / (2.0 * deltaT);
          H_next[i] = collapseHead;
          Q_next[i] = qLiq;
          V_cav[i] = 0.0;
          if (collapseHead > maxCollapseSurgeM) {
            maxCollapseSurgeM = collapseHead;
          }
        } else if (vNew > 0.0) {
          // Cavity remains open
          V_cav[i] = vNew;
          H_next[i] = hVapNode;
          Q_next[i] = 0.5 * (qIn + qOut);
        } else {
          V_cav[i] = 0.0;
          H_next[i] = hLiq;
          Q_next[i] = qLiq;
        }
      } else {
        V_cav[i] = 0.0;
        H_next[i] = hLiq;
        Q_next[i] = qLiq;
      }
    }

    // 3. Upstream Boundary
    if (isSuterPump) {
      // 4-Quadrant Suter Pump Power Failure Dynamics
      const cm0 = CM[0]!;
      const suctionHead = options?.suctionHeadM ?? elevUp;

      if (!checkValveOpen) {
        // Check valve already seated shut
        Q_next[0] = 0.0;
        H_next[0] = cm0;
        pumpNu = 0.0;
      } else {
        // Solve scalar nonlinear pump discharge equation via Newton-Raphson:
        // f(nu) = cm0 + B * Q_R * nu - (suctionHead + H_R * (alpha^2 + nu^2) * W_H(atan2(alpha, nu))) = 0
        let nuSol = pumpNu;
        for (let iter = 0; iter < 8; iter++) {
          const theta = Math.atan2(pumpAlpha, nuSol);
          const { wH } = evaluateSuterCurves(theta, specSpeed);
          const vSq = pumpAlpha * pumpAlpha + nuSol * nuSol;
          const fVal = cm0 + B * Q_R * nuSol - (suctionHead + H_R * vSq * wH);
          if (Math.abs(fVal) < 1e-4) break;

          // Numerical derivative df/dnu
          const eps = 1e-4;
          const thEps = Math.atan2(pumpAlpha, nuSol + eps);
          const { wH: wHEps } = evaluateSuterCurves(thEps, specSpeed);
          const vSqEps = pumpAlpha * pumpAlpha + (nuSol + eps) * (nuSol + eps);
          const fEps = cm0 + B * Q_R * (nuSol + eps) - (suctionHead + H_R * vSqEps * wHEps);
          const dfDnu = (fEps - fVal) / eps;

          const dNu = fVal / (Math.abs(dfDnu) > 1e-3 ? dfDnu : B * Q_R);
          nuSol = Math.max(-5.0, Math.min(5.0, nuSol - dNu));
        }

        if (pumpCfg?.hasCheckValve && nuSol <= 0.0) {
          // Flow attempts to reverse -> check valve slams shut
          checkValveOpen = false;
          checkValveSlamHeadM = cm0;
          Q_next[0] = 0.0;
          H_next[0] = cm0;
          pumpNu = 0.0;
        } else {
          pumpNu = nuSol;
          const qVal = pumpNu * Q_R;
          Q_next[0] = qVal;
          H_next[0] = cm0 + B * qVal;
          if (qVal < 0 && Math.abs(qVal) > maxReverseFlowM3s) {
            maxReverseFlowM3s = Math.abs(qVal);
          }
        }
      }

      // Update rotational speed alpha for next step via angular momentum:
      // I * domega/dt = -T_hyd (motor tripped, electrical torque = 0)
      const curTheta = Math.atan2(pumpAlpha, pumpNu);
      const { wB } = evaluateSuterCurves(curTheta, specSpeed);
      const vSq = pumpAlpha * pumpAlpha + pumpNu * pumpNu;
      const torqueBeta = vSq * wB;
      const tHyd = ratedTorque_TR * torqueBeta;

      const dAlpha = -((deltaT * tHyd) / (inertia_I * omega_R));
      let nextAlpha = pumpAlpha + dAlpha;
      if (!checkValveOpen && nextAlpha < 0) {
        nextAlpha = 0.0; // Anti-reverse ratchet prevents reverse rotation when isolated
      }
      if (nextAlpha < 0) {
        const runawayRpm = Math.abs(nextAlpha * N_R);
        if (runawayRpm > maxRunawaySpeedRpm) maxRunawaySpeedRpm = runawayRpm;
      }
      pumpAlpha = nextAlpha;
    } else {
      // Standard Constant Head Reservoir upstream: H[0] = H_up0
      H_next[0] = H_up0;
      Q_next[0] = (H_up0 - CM[0]!) / B;
    }

    // 4. Downstream Boundary
    let qValve = 0.0;
    if (event.type === "VALVE_CLOSURE") {
      const tau = t >= closureTime ? 0.0 : Math.pow(1.0 - t / closureTime, expVal);
      if (tau > 1e-6) {
        const Cv = tau * Cv0;
        const cpVal = CP[N]!;
        const Cv2 = Cv * Cv;
        const disc = B * B * Cv2 * Cv2 + 2.0 * Cv2 * Math.max(0.0, cpVal - exitHead);
        qValve = -B * Cv2 + Math.sqrt(Math.max(0.0, disc));
      } else {
        qValve = 0.0;
      }
    } else if (!isSuterPump) {
      const spinDown = t >= closureTime ? 0.0 : Math.pow(1.0 - t / closureTime, expVal);
      qValve = Q0 * spinDown;
    } else {
      qValve = Q_next[0]!; // Downstream follows upstream pump line
    }

    if (!protection) {
      if (isSuterPump) {
        // Downstream is the discharge reservoir at constant head H_dn0
        H_next[N] = H_dn0;
        Q_next[N] = (CP[N]! - H_dn0) / B;
      } else {
        Q_next[N] = qValve;
        H_next[N] = CP[N]! - B * qValve;
      }
    } else if (protection.type === "AIR_VESSEL") {
      // Coupled Hydropneumatic Air Vessel
      const H_gas = gasConst / Math.pow(Math.max(0.001, vesselAirVol), gamma);
      const H_vessel = exitHead + H_gas;
      const Rin = protection.orificeLossCoeffInflow ?? 0.5;
      const Rout = protection.orificeLossCoeffOutflow ?? 2.0;
      const cpVal = CP[N]!;
      const K = cpVal - B * qValve - H_vessel;

      let qVessel = 0.0;
      if (K >= 0) {
        // Flow into vessel (compression)
        if (Rin > 1e-4) {
          qVessel = (-B + Math.sqrt(B * B + 4.0 * Rin * K)) / (2.0 * Rin);
        } else {
          qVessel = K / B;
        }
      } else {
        // Flow out of vessel (expansion)
        const posK = -K;
        if (Rout > 1e-4) {
          const x = (-B + Math.sqrt(B * B + 4.0 * Rout * posK)) / (2.0 * Rout);
          qVessel = -x;
        } else {
          qVessel = -posK / B;
        }
      }

      vesselAirVol = Math.max(0.001, vesselAirVol - qVessel * deltaT);
      Q_next[N] = qValve + qVessel;
      H_next[N] = cpVal - B * Q_next[N]!;
    } else if (protection.type === "AIR_VALVE") {
      // Dual-chamber vacuum relief / air release valve
      const unprotH = CP[N]! - B * qValve;
      if (unprotH < exitHead) {
        // Vacuum breaker opens, admitting atmospheric air to prevent cavitation
        H_next[N] = exitHead;
        Q_next[N] = (CP[N]! - exitHead) / B;
      } else {
        // Positive pressure: small exhaust orifice throttles expelled air
        const dOutM = (protection.outletOrificeDiameterMm ?? 25.0) / 1000.0;
        const aOut = (Math.PI * dOutM * dOutM) / 4.0;
        const cd = protection.dischargeCoeff ?? 0.65;
        const qExhaust = cd * aOut * Math.sqrt(2.0 * G_ACCEL * Math.max(0.0, unprotH - exitHead));
        Q_next[N] = qValve + qExhaust;
        H_next[N] = Math.max(exitHead, CP[N]! - B * Q_next[N]!);
      }
    } else if (protection.type === "RELIEF_VALVE") {
      // Fast-acting spring-loaded Pressure Relief Valve (PRV)
      const unprotH = CP[N]! - B * qValve;
      const Hset = protection.setPressureHeadM;
      if (unprotH > Hset) {
        const cv = protection.dischargeCoeff;
        const M_val = B * cv * Math.sqrt(2.0 * G_ACCEL);
        const rhs = Math.max(0.0, CP[N]! - B * qValve - exitHead);
        const y = (-M_val + Math.sqrt(M_val * M_val + 4.0 * rhs)) / 2.0;
        const qRelief = cv * Math.sqrt(2.0 * G_ACCEL) * y;
        Q_next[N] = qValve + qRelief;
        H_next[N] = exitHead + y * y;
      } else {
        Q_next[N] = qValve;
        H_next[N] = unprotH;
      }
    }

    // Advance buffers
    H_curr.set(H_next);
    Q_curr.set(Q_next);
  }

  const waveTravelTimeSeconds = (2.0 * L) / a;
  const fundamentalPeriodSeconds = (4.0 * L) / a;

  const actualSurgeHead = Math.max(0.0, maxHeadM - H_dn0);
  const surgeSuppressionRatioPct = protection
    ? Math.max(0.0, Math.min(100.0, (1.0 - actualSurgeHead / Math.max(0.1, joukowskySurgeM)) * 100.0))
    : undefined;

  return {
    timeSeries,
    joukowskySurgeM,
    maxHeadM,
    minHeadM,
    maxHeadDownstreamM,
    minHeadDownstreamM,
    maxPressurePsi: (maxHeadM - exitHead) * M_TO_PSI,
    minPressurePsi: (minHeadM - exitHead) * M_TO_PSI,
    cavitationOccurred,
    cavitationCollapseOccurred: cavitationCollapseOccurred || undefined,
    maxCavityVolumeM3: maxCavityVolumeM3 > 0 ? maxCavityVolumeM3 : undefined,
    maxCollapseSurgeM: maxCollapseSurgeM > 0 ? maxCollapseSurgeM : undefined,
    maxReverseFlowM3s: maxReverseFlowM3s > 0 ? maxReverseFlowM3s : undefined,
    maxRunawaySpeedRpm: maxRunawaySpeedRpm > 0 ? maxRunawaySpeedRpm : undefined,
    checkValveSlamHeadM,
    waveTravelTimeSeconds,
    fundamentalPeriodSeconds,
    surgeProtectionActive: Boolean(protection),
    surgeSuppressionRatioPct,
  };
}
