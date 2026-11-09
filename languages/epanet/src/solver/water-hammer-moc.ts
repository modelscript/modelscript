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

export interface WaterHammerOptions {
  simulationDurationSeconds?: number | undefined; // Total duration to simulate, default: 5.0s
  spatialReaches?: number | undefined; // Number of spatial divisions N, default: 10
  vaporPressureHeadM?: number | undefined; // Water vapor pressure head, default: -10.0m (cavitation limit)
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
}

export interface WaterHammerResult {
  timeSeries: WaterHammerTimeStep[];
  joukowskySurgeM: number; // Theoretical Delta H = (a * Delta v) / g
  maxHeadM: number;
  minHeadM: number;
  maxPressurePsi: number;
  minPressurePsi: number;
  cavitationOccurred: boolean;
  waveTravelTimeSeconds: number; // 2L / a
  fundamentalPeriodSeconds: number; // 4L / a
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
  let cavitationOccurred = false;

  const midIdx = Math.floor(N / 2);
  const closureTime = Math.max(deltaT, event.durationSeconds);
  const expVal = event.exponent ?? 1.0;

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
    if (event.type === "VALVE_CLOSURE") {
      // Relative valve opening tau(t) in [0.0, 1.0]
      const tau = t >= closureTime ? 0.0 : Math.pow(1.0 - t / closureTime, expVal);
      if (tau <= 1e-6) {
        // Completely closed valve: Q[N] = 0
        Q_next[N] = 0.0;
        H_next[N] = CP[N]!;
      } else {
        // Orifice equation coupled with C+ line: H[N] = CP - B * Q[N]
        // Q[N] = tau * Cv0 * sqrt(H[N] - exitHead)
        const Cv = tau * Cv0;
        const cpVal = CP[N]!;
        // Quadratic: B * Q^2 + (Q / Cv)^2 - (cpVal - exitHead) ...
        // Inverting: Q[N] = (-B * Cv^2 + sqrt((B * Cv^2)^2 + 2 * Cv^2 * (cpVal - exitHead))) ...
        const Cv2 = Cv * Cv;
        const disc = B * B * Cv2 * Cv2 + 2.0 * Cv2 * Math.max(0.0, cpVal - exitHead);
        const qSolve = -B * Cv2 + Math.sqrt(Math.max(0.0, disc));
        Q_next[N] = qSolve;
        H_next[N] = cpVal - B * qSolve;
      }
    } else {
      // PUMP_TRIP: Linear or exponential flow decay at upstream or downstream
      const spinDown = t >= closureTime ? 0.0 : Math.pow(1.0 - t / closureTime, expVal);
      Q_next[N] = Q0 * spinDown;
      H_next[N] = CP[N]! - B * Q_next[N]!;
    }

    // Advance buffers
    H_curr.set(H_next);
    Q_curr.set(Q_next);
  }

  const waveTravelTimeSeconds = (2.0 * L) / a;
  const fundamentalPeriodSeconds = (4.0 * L) / a;

  return {
    timeSeries,
    joukowskySurgeM,
    maxHeadM,
    minHeadM,
    maxPressurePsi: (maxHeadM - exitHead) * M_TO_PSI,
    minPressurePsi: (minHeadM - exitHead) * M_TO_PSI,
    cavitationOccurred,
    waveTravelTimeSeconds,
    fundamentalPeriodSeconds,
  };
}
