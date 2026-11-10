// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Method of Characteristics (MOC) Water Hammer Surge Solver.
 *
 * Simulates high-frequency acoustic pressure waves, Joukowsky surge spikes,
 * check valve slam, pump power failure spin-down, and column separation / cavitation.
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

export interface WaterHammerEvent {
  type: TransientEventType;
  durationSeconds: number; // e.g. valve closure time or pump inertia spin-down time
  exponent?: number | undefined; // Closure curve shape exponent (1.0 = linear), default: 1.0
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

export type SurgeProtectionDevice =
  | AirVesselConfig
  | AirReleaseValveConfig
  | SurgeReliefValveConfig;

export interface WaterHammerOptions {
  simulationDurationSeconds?: number | undefined; // Total duration to simulate, default: 5.0s
  spatialReaches?: number | undefined; // Number of spatial divisions N, default: 10
  vaporPressureHeadM?: number | undefined; // Water vapor pressure head, default: -10.0m (cavitation limit)
  surgeProtection?: SurgeProtectionDevice | undefined; // Protective surge suppression device
  protectionLocation?: "UPSTREAM" | "MIDPOINT" | "DOWNSTREAM" | undefined; // Default: "DOWNSTREAM"
}

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
  waveTravelTimeSeconds: number; // 2L / a
  fundamentalPeriodSeconds: number; // 4L / a
  surgeProtectionActive?: boolean | undefined;
  surgeSuppressionRatioPct?: number | undefined; // Percentage reduction in surge spike vs unprotected
}

const G_ACCEL = 9.80665;
const M_TO_PSI = 1.4219702; // meters of water to psi

/**
 * Simulates transient water hammer along a pressurized pipeline using the standard Method of Characteristics (MOC).
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
  const exitHead = pipe.elevationDownstreamM ?? 0.0;
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

  const midIdx = Math.floor(N / 2);
  const closureTime = Math.max(deltaT, event.durationSeconds);
  const expVal = event.exponent ?? 1.0;

  // Surge Protection State
  const protection = options?.surgeProtection;
  let vesselAirVol = protection?.type === "AIR_VESSEL" ? Math.max(0.001, protection.initialAirVolumeM3) : 0.0;
  const gamma = protection?.type === "AIR_VESSEL" ? (protection.polytropicExponent ?? 1.2) : 1.2;
  const initialGasHead = Math.max(1.0, H_dn0 - exitHead);
  const gasConst = initialGasHead * Math.pow(Math.max(1e-3, vesselAirVol), gamma);

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

    if (hDn - exitHead < vaporHead || hMid - exitHead < vaporHead) {
      cavitationOccurred = true;
    }

    // Save every 2nd or 4th step if step count is very high to conserve memory
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

    // 2. Interior nodes (i = 1 to N-1)
    for (let i = 1; i < N; i++) {
      H_next[i] = (CP[i]! + CM[i]!) / 2.0;
      Q_next[i] = (CP[i]! - CM[i]!) / (2.0 * B);
    }

    // 3. Upstream Boundary (Constant Head Reservoir: H[0] = H_up0)
    H_next[0] = H_up0;
    Q_next[0] = (H_up0 - CM[0]!) / B;

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
    } else {
      const spinDown = t >= closureTime ? 0.0 : Math.pow(1.0 - t / closureTime, expVal);
      qValve = Q0 * spinDown;
    }

    if (!protection) {
      Q_next[N] = qValve;
      H_next[N] = CP[N]! - B * qValve;
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
        H_next[N] = CP[N]! - B * Q_next[N]!;
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
    waveTravelTimeSeconds,
    fundamentalPeriodSeconds,
    surgeProtectionActive: Boolean(protection),
    surgeSuppressionRatioPct,
  };
}
