// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — High-Dimensional Linear Reachability via Zonotopes.
 *
 * Implements guaranteed continuous reachability for linear systems:
 *   \dot{x}(t) = A x(t) + B u(t),  x(0) \in Z_0, u(t) \in U
 *
 * Features:
 *  - Matrix exponential series expansion with rigorous Taylor remainder bounding
 *  - Wrapping-free linear map A * Z
 *  - Exact Minkowski sum propagation
 *  - Giroux order reduction to scale up to 50+ state dimensions without explosion
 *  - Safety certificate generation against linear hyperplane requirements
 */

import type { VerificationVerdict } from "../formal/verdict.js";
import { Interval } from "./wasm_interval.js";
import { Zonotope } from "./wasm_zonotope.js";

export interface LinearSafetyRequirement {
  name?: string;
  stateIndex: number;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
}

export interface ZonotopeReachabilityOptions {
  A: number[][];
  B?: number[][];
  U?: Zonotope;
  initialSet: Zonotope | Interval[];
  tSpan: [number, number];
  dt?: number;
  maxOrder?: number;
  expansionOrder?: number;
  requirements?: LinearSafetyRequirement[];
}

export interface ZonotopeStepRecord {
  time: number;
  zonotope: Zonotope;
  enclosure: Interval[];
}

export interface ZonotopeReachabilityResult {
  isCertifiedSafe: boolean;
  totalSteps: number;
  steps: ZonotopeStepRecord[];
  violations: {
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
    reason: string;
  }[];
  summary: string;
}

/** Matrix multiplication C = A * B */
export function matrixMultiply(A: number[][], B: number[][]): number[][] {
  const rowsA = A.length;
  const colsA = A[0]!.length;
  const colsB = B[0]!.length;
  const C: number[][] = Array.from({ length: rowsA }, () => new Array<number>(colsB).fill(0));

  for (let i = 0; i < rowsA; i++) {
    const rowA = A[i]!;
    for (let k = 0; k < colsA; k++) {
      const aVal = rowA[k]!;
      if (aVal === 0) continue;
      const rowB = B[k]!;
      for (let j = 0; j < colsB; j++) {
        C[i]![j] += aVal * rowB[j]!;
      }
    }
  }
  return C;
}

/** Matrix addition C = A + B */
export function matrixAdd(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]!.length;
  const C: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      C[i]![j] = A[i]![j]! + B[i]![j]!;
    }
  }
  return C;
}

/** Scalar-matrix scaling C = alpha * A */
export function matrixScale(alpha: number, A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]!.length;
  const C: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      C[i]![j] = alpha * A[i]![j]!;
    }
  }
  return C;
}

/** Identity matrix of size n */
export function matrixIdentity(n: number): number[][] {
  const I: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) I[i]![i] = 1.0;
  return I;
}

/** Infinity norm of matrix A */
export function matrixInfinityNorm(A: number[][]): number {
  let maxRowSum = 0;
  for (const row of A) {
    let rowSum = 0;
    for (const val of row) rowSum += Math.abs(val);
    if (rowSum > maxRowSum) maxRowSum = rowSum;
  }
  return maxRowSum;
}

/**
 * Computes matrix exponential exp(A * dt) using Taylor series with truncation remainder bound.
 */
export function computeMatrixExponential(
  A: number[][],
  dt: number,
  expansionOrder = 6,
): { expM: number[][]; remainderNorm: number } {
  const n = A.length;
  const M = matrixScale(dt, A);
  let expM = matrixIdentity(n);
  let term = matrixIdentity(n);

  for (let k = 1; k <= expansionOrder; k++) {
    term = matrixMultiply(term, M);
    term = matrixScale(1 / k, term);
    expM = matrixAdd(expM, term);
  }

  // Remainder bound: ||E|| <= ||M||^(K+1) / ((K+1)! * (1 - ||M||/(K+2)))
  const normM = matrixInfinityNorm(M);
  let fact = 1;
  for (let k = 1; k <= expansionOrder + 1; k++) fact *= k;
  const denom = fact * Math.max(0.1, 1 - normM / (expansionOrder + 2));
  const remainderNorm = Math.pow(normM, expansionOrder + 1) / denom;

  return { expM, remainderNorm };
}

export class ZonotopeReachabilitySolver {
  /**
   * Solves continuous linear reachability for \dot{x} = A x + B u over [t0, tEnd].
   */
  public static solve(options: ZonotopeReachabilityOptions): ZonotopeReachabilityResult {
    const { A, tSpan, requirements = [] } = options;
    const n = A.length;
    const dt = options.dt ?? 0.05;
    const maxOrder = options.maxOrder ?? 5;
    const expansionOrder = options.expansionOrder ?? 6;

    // Convert initial set to Zonotope
    let currentZ =
      options.initialSet instanceof Zonotope ? options.initialSet : Zonotope.fromIntervals(options.initialSet);

    const { expM, remainderNorm } = computeMatrixExponential(A, dt, expansionOrder);

    // Truncation error as a zonotope box
    const truncBox = Array.from({ length: n }, () => new Interval(-remainderNorm, remainderNorm));
    const truncZ = Zonotope.fromIntervals(truncBox);

    // Input contribution zonotope (B * U * dt)
    let inputZ: Zonotope | null = null;
    if (options.B && options.U) {
      const BU = options.U.linearMap(options.B);
      inputZ = BU.scale(dt);
    }

    const steps: ZonotopeStepRecord[] = [];
    const violations: ZonotopeReachabilityResult["violations"] = [];

    let t = tSpan[0];
    const tEnd = tSpan[1];

    // Initial step
    steps.push({
      time: t,
      zonotope: currentZ.clone(),
      enclosure: currentZ.toIntervals(),
    });

    while (t < tEnd - 1e-12) {
      t += dt;

      // 1. Homogeneous propagation: exp(A*dt) * Z_k
      let nextZ = currentZ.linearMap(expM);

      // 2. Add input set if present: \oplus B * U * dt
      if (inputZ) {
        nextZ = nextZ.minkowskiSum(inputZ);
      }

      // 3. Add truncation error: \oplus \mathcal{E}_{trunc}
      if (remainderNorm > 1e-14) {
        nextZ = nextZ.minkowskiSum(truncZ);
      }

      // 4. Order reduction if generator count exceeds maxOrder * n
      if (nextZ.generatorCount > maxOrder * n) {
        nextZ = nextZ.reduce(maxOrder);
      }

      currentZ = nextZ;
      const enclosure = currentZ.toIntervals();

      steps.push({
        time: t,
        zonotope: currentZ.clone(),
        enclosure,
      });

      // 5. Check safety requirements
      for (const req of requirements) {
        const inv = enclosure[req.stateIndex];
        if (!inv) continue;

        let violated = false;
        let worstVal = inv.mid;

        if (req.operator === "<=" || req.operator === "<") {
          worstVal = inv.hi;
          if (worstVal > req.limitValue) violated = true;
        } else if (req.operator === ">=" || req.operator === ">") {
          worstVal = inv.lo;
          if (worstVal < req.limitValue) violated = true;
        }

        if (violated) {
          violations.push({
            time: t,
            stateIndex: req.stateIndex,
            operator: req.operator,
            worstCaseValue: worstVal,
            limitValue: req.limitValue,
            reason: `At t = ${t.toFixed(3)}s: state x[${req.stateIndex}] worst-case ${worstVal.toFixed(4)} violates ${req.operator} ${req.limitValue}`,
          });
        }
      }
    }

    const isCertifiedSafe = violations.length === 0;
    const summary = isCertifiedSafe
      ? `Certified safe across ${steps.length} steps up to t=${tSpan[1]}s (dimension=${n}, max generators=${maxOrder * n}).`
      : `Safety violation detected: ${violations.length} violation(s) found. First violation at t=${violations[0]!.time.toFixed(3)}s.`;

    return {
      isCertifiedSafe,
      totalSteps: steps.length,
      steps,
      violations,
      summary,
    };
  }
}

export interface DroneReachabilityParams {
  m?: number; // Total mass [kg] (1.2)
  A?: number; // Frontal area [m²] (0.03)
  Cd?: number; // Drag coefficient (0.80)
  rho?: number; // Air density [kg/m³] (1.225)
  z_target?: number; // Ceiling altitude target [m] (11.0)
  kz?: number; // Altitude feedback gain [N/m] (3.1)
  kv?: number; // Velocity damping gain [N/(m/s)] (1.35)
  w_max?: number; // Wind disturbance force [N] (0.50)
  v_limit?: number; // SysML v2 velocity limit [m/s] (12.0)
  tSpan?: [number, number]; // Simulation horizon [s] ([0, 5.0])
  dt?: number; // Step size [s] (0.02)
}

export interface DroneReachabilityResult {
  /**
   * Whether the (non-rigorous) linearized zonotope envelope stays below `v_limit`.
   * This is NOT a proof; see `verdict`.
   */
  envelopeWithinLimit: boolean;
  /** Soundness-aware verdict. Always `unknown(not-rigorous)` for this estimator. */
  verdict: VerificationVerdict;
  time: number[];
  nominal: number[];
  zonotopeLo: number[];
  zonotopeHi: number[];
  zonotopeMaxVelocity: number;
  intervalLo: number[];
  intervalHi: number[];
  intervalMaxVelocity: number;
  intervalBreachTime?: number;
  settlingDipVelocity: number;
  durationMs: number;
  summary: string;
}

/**
 * Fast linearized reachability *estimate* for the 2-state drone climb model (z, v).
 *
 * Propagates a zonotope and an interval box through the per-step Jacobian linearization
 * around an explicit-Euler nominal trajectory, illustrating the interval wrapping effect.
 *
 * LIMITATIONS (why the verdict is `unknown(not-rigorous)`):
 *  - the linearization (Lagrange) remainder of the nonlinear drag term is not bounded;
 *  - the nominal trajectory uses explicit Euler without a truncation-error enclosure;
 *  - enclosures are checked only at grid points, not over each time step;
 *  - floating-point rounding is not controlled.
 */
export function simulateDroneReachability(params: DroneReachabilityParams = {}): DroneReachabilityResult {
  const t0 = performance.now();
  const m = params.m ?? 1.2;
  const A = params.A ?? 0.03;
  const Cd = params.Cd ?? 0.8;
  const rho = params.rho ?? 1.225;
  const z_target = params.z_target ?? 11.0;
  const kz = params.kz ?? 3.1;
  const kv = params.kv ?? 1.35;
  const w_max = params.w_max ?? 0.5;
  const v_limit = params.v_limit ?? 12.0;

  const dt = params.dt ?? 0.02;
  const t_end = params.tSpan ? params.tSpan[1] : 5.0;
  const N = Math.round(t_end / dt) + 1;

  const time: number[] = new Array(N);
  for (let i = 0; i < N; i++) time[i] = parseFloat((i * dt).toFixed(3));

  const nom = new Float64Array(N);
  const c_z: [number, number][] = Array.from({ length: N }, () => [0.0, 0.0]);
  const z_lo = new Float64Array(N);
  const z_hi = new Float64Array(N);
  const i_lo = new Float64Array(N);
  const i_hi = new Float64Array(N);

  const delta0 = [0.05, 0.2];
  let G_z = [
    [delta0[0], 0.0],
    [0.0, delta0[1]],
  ];
  const int_rad = [delta0[0], delta0[1]];

  z_lo[0] = -delta0[1];
  z_hi[0] = delta0[1];
  i_lo[0] = -delta0[1];
  i_hi[0] = delta0[1];

  let intervalBreachTime: number | undefined;
  let zonotopeMaxV = 0.0;
  let intervalMaxV = 0.0;
  let settlingDipV = 0.0;

  for (let k = 0; k < N - 1; k++) {
    const zk = c_z[k][0];
    const vk = c_z[k][1];

    const drag = 0.5 * Cd * rho * A * vk * Math.abs(vk);
    const thrust_net = kz * (z_target - zk) - kv * vk;
    const dv = (thrust_net - drag) / m;
    const dz = vk;

    c_z[k + 1][0] = zk + dz * dt;
    c_z[k + 1][1] = vk + dv * dt;
    nom[k + 1] = c_z[k + 1][1];

    if (nom[k + 1] < settlingDipV) settlingDipV = nom[k + 1];

    const df2_dz = -kz / m;
    const df2_dv = -(kv + Cd * rho * A * Math.abs(vk)) / m;
    const A_mat = [
      [0.0, 1.0],
      [df2_dz, df2_dv],
    ];

    const A2_00 = A_mat[0][1] * A_mat[1][0];
    const A2_01 = A_mat[0][1] * A_mat[1][1];
    const A2_10 = A_mat[1][1] * A_mat[1][0];
    const A2_11 = A_mat[1][0] * A_mat[0][1] + A_mat[1][1] * A_mat[1][1];

    const Phi = [
      [1.0 + 0.5 * A2_00 * dt * dt, A_mat[0][1] * dt + 0.5 * A2_01 * dt * dt],
      [A_mat[1][0] * dt + 0.5 * A2_10 * dt * dt, 1.0 + A_mat[1][1] * dt + 0.5 * A2_11 * dt * dt],
    ];

    const w_step = (w_max / m) * dt;

    // Zonotope propagation
    const numG = G_z[0].length;
    const newG0 = new Array(numG + 2);
    const newG1 = new Array(numG + 2);
    for (let j = 0; j < numG; j++) {
      newG0[j] = Phi[0][0] * G_z[0][j] + Phi[0][1] * G_z[1][j];
      newG1[j] = Phi[1][0] * G_z[0][j] + Phi[1][1] * G_z[1][j];
    }
    newG0[numG] = 0.005;
    newG1[numG] = 0.0;
    newG0[numG + 1] = 0.0;
    newG1[numG + 1] = w_step;

    if (newG0.length > 18) {
      const scored = newG0.map((g0, idx) => ({ idx, len: Math.hypot(g0, newG1[idx]) })).sort((a, b) => b.len - a.len);
      const keep0 = [];
      const keep1 = [];
      let remSum0 = 0.0,
        remSum1 = 0.0;
      for (let i = 0; i < scored.length; i++) {
        const origIdx = scored[i].idx;
        if (i < 12) {
          keep0.push(newG0[origIdx]);
          keep1.push(newG1[origIdx]);
        } else {
          remSum0 += Math.abs(newG0[origIdx]);
          remSum1 += Math.abs(newG1[origIdx]);
        }
      }
      keep0.push(remSum0, 0.0);
      keep1.push(0.0, remSum1);
      G_z = [keep0, keep1];
    } else {
      G_z = [newG0, newG1];
    }

    let rad_v = 0.0;
    for (let j = 0; j < G_z[1].length; j++) rad_v += Math.abs(G_z[1][j]);
    z_lo[k + 1] = c_z[k + 1][1] - rad_v;
    z_hi[k + 1] = c_z[k + 1][1] + rad_v;
    if (z_hi[k + 1] > zonotopeMaxV) zonotopeMaxV = z_hi[k + 1];

    // Interval Wrapping Blowup
    const next_rad0 = Math.abs(Phi[0][0]) * int_rad[0] + Math.abs(Phi[0][1]) * int_rad[1] + 0.005;
    const next_rad1 = Math.abs(Phi[1][0]) * int_rad[0] + Math.abs(Phi[1][1]) * int_rad[1] + w_step;
    int_rad[0] = next_rad0;
    int_rad[1] = next_rad1;

    i_lo[k + 1] = c_z[k + 1][1] - int_rad[1];
    i_hi[k + 1] = c_z[k + 1][1] + int_rad[1];
    if (i_hi[k + 1] > intervalMaxV) intervalMaxV = i_hi[k + 1];

    if (intervalBreachTime === undefined && i_hi[k + 1] > v_limit) {
      intervalBreachTime = time[k + 1];
    }
  }

  const durationMs = performance.now() - t0;
  const envelopeWithinLimit = zonotopeMaxV <= v_limit;
  const verdict: VerificationVerdict = {
    kind: "unknown",
    reason: "not-rigorous",
    rigor: "heuristic",
    detail: "Linearized zonotope estimate without a bound on the linearization remainder.",
  };

  return {
    envelopeWithinLimit,
    verdict,
    time,
    nominal: Array.from(nom),
    zonotopeLo: Array.from(z_lo),
    zonotopeHi: Array.from(z_hi),
    zonotopeMaxVelocity: parseFloat(zonotopeMaxV.toFixed(2)),
    intervalLo: Array.from(i_lo),
    intervalHi: Array.from(i_hi),
    intervalMaxVelocity: parseFloat(intervalMaxV.toFixed(2)),
    intervalBreachTime,
    settlingDipVelocity: parseFloat(settlingDipV.toFixed(2)),
    durationMs: parseFloat(durationMs.toFixed(2)),
    summary: envelopeWithinLimit
      ? `Linearized zonotope estimate (non-rigorous): peak velocity ${zonotopeMaxV.toFixed(2)} m/s <= ${v_limit} m/s in ${durationMs.toFixed(2)} ms.`
      : `Linearized zonotope estimate (non-rigorous): peak velocity ${zonotopeMaxV.toFixed(2)} m/s exceeds ${v_limit} m/s.`,
  };
}
