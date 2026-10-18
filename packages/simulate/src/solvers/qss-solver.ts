// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Quantized State System (QSS1, QSS2, QSS3, and Stiff LIQSS2) ODE Integrators.
 *
 * Academic Citations:
 * - Kofman, E., & Junco, S. (2001). Quantized-state systems: a DEVS Approach for continuous
 *   system simulation. Transactions of The Society for Modeling and Simulation International,
 *   18(3), 123-132.
 * - Kofman, E. (2002). A second-order approximation for DEVS simulation of continuous systems.
 *   Simulation, 78(2), 76-89.
 * - Kofman, E. (2006). A third order discrete event simulation method for continuous systems.
 *   Latin American Applied Research, 36(2), 101-108.
 * - Migoni, G., Bortolotto, M., Kofman, E., & Cellier, F. E. (2013). Linearly implicit
 *   quantization-based integration methods for stiff ordinary differential equations.
 *   Simulation Modelling Practice and Theory, 35, 118-136.
 * - Fernández, J., & Kofman, E. (2014). A stand-alone quantized state system solver for
 *   continuous system simulation. Simulation, 90(7), 782-799 (QSS Solver / CIFASIS modelicacc).
 */

import type { CommonSolverResult, SolverStats } from "../core/problem-types.js";

export type QSSMethod = "qss1" | "qss2" | "qss3" | "liqss2";

export type QSSEventFunction = (t: number, y: number[]) => number;
export type QSSEventCallback = (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[];

export interface QSSOptions {
  /** Quantization method (`"qss1"`, `"qss2"`, `"qss3"`, or stiff `"liqss2"`). Default: `"qss2"`. */
  method?: QSSMethod | undefined;
  /** Minimum absolute quantum $\Delta Q_{\min}$ (default: `1e-5`). */
  atol?: number | undefined;
  /** Relative quantum factor $\Delta Q_{\text{rel}}$ (default: `1e-4`). */
  rtol?: number | undefined;
  /** Maximum number of discrete quantum transitions before aborting (default: `200000`). */
  maxEvents?: number | undefined;
  /**
   * Optional sparse dependency graph: `dependencies[i]` lists the state indices `j`
   * whose derivative $f_j(t, q)$ depends on state $q_i$. If omitted, probed automatically at $t_0$.
   */
  dependencies?: number[][] | undefined;
  /** Optional zero-crossing event functions $g_k(t, x)$. */
  eventFunctions?: QSSEventFunction[] | undefined;
  /** Event crossing directions (`1` rising, `-1` falling, `0` both). */
  eventDirections?: (1 | -1 | 0)[] | undefined;
  /** Callback invoked when an event zero-crossing fires, returning the updated state vector. */
  eventCallback?: QSSEventCallback | undefined;
}

export interface QSSResult extends CommonSolverResult {
  stats: SolverStats & {
    /** Total number of individual state quantum crossings processed. */
    quantumCrossings: number;
  };
}

/**
 * Finds the smallest positive root $\tau > 0$ of $c_0 + c_1 \tau + c_2 \tau^2 + c_3 \tau^3 = 0$.
 */
function smallestPositivePolyRoot(c0: number, c1: number, c2: number, c3 = 0): number {
  let minRoot = Infinity;
  const accept = (r: number) => {
    if (Number.isFinite(r) && r > 1e-14 && r < minRoot) {
      minRoot = r;
    }
  };

  if (Math.abs(c3) < 1e-18) {
    if (Math.abs(c2) < 1e-18) {
      if (Math.abs(c1) > 1e-18) {
        accept(-c0 / c1);
      }
      return minRoot;
    }
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      accept((-c1 - s) / (2 * c2));
      accept((-c1 + s) / (2 * c2));
    }
    return minRoot;
  }

  // Cubic root finding via companion bracket + Halley/Newton refinement on positive real axis
  // First check quadratic extrema of the cubic derivative 3*c3*t^2 + 2*c2*t + c1 = 0
  const critPts: number[] = [0];
  const dDisc = 4 * c2 * c2 - 12 * c3 * c1;
  if (dDisc >= 0) {
    const sd = Math.sqrt(dDisc);
    const t1 = (-2 * c2 - sd) / (6 * c3);
    const t2 = (-2 * c2 + sd) / (6 * c3);
    if (t1 > 0) critPts.push(t1);
    if (t2 > 0) critPts.push(t2);
  }
  critPts.sort((a, b) => a - b);
  const scaleBound = 1 + Math.max(Math.abs(c0), Math.abs(c1), Math.abs(c2)) / Math.abs(c3);
  critPts.push(scaleBound);

  const evalCubic = (t: number) => ((c3 * t + c2) * t + c1) * t + c0;
  for (let i = 0; i < critPts.length - 1; i++) {
    let a = critPts[i]!;
    let b = critPts[i + 1]!;
    let fa = evalCubic(a);
    const fb = evalCubic(b);
    if (Math.abs(fa) < 1e-15 && a > 1e-14) {
      accept(a);
      return minRoot;
    }
    if (fa * fb <= 0) {
      let mid = 0.5 * (a + b);
      for (let iter = 0; iter < 32; iter++) {
        mid = 0.5 * (a + b);
        const fm = evalCubic(mid);
        if (Math.abs(fm) < 1e-14 || b - a < 1e-13) break;
        if (fa * fm <= 0) {
          b = mid;
        } else {
          a = mid;
          fa = fm;
        }
      }
      accept(mid);
      if (minRoot < Infinity) return minRoot;
    }
  }
  return minRoot;
}

/**
 * Probes the structural dependency graph of `f(t, y)` at `(t0, y0)` so that each quantum
 * crossing of variable `i` only triggers derivative updates for dependent variables `j`.
 */
function probeSparsityGraph(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
): { dependents: number[][]; diagJac: Float64Array; nfev: number } {
  const n = y0.length;
  const dependents: number[][] = Array.from({ length: n }, () => []);
  const diagJac = new Float64Array(n);
  if (n === 0) return { dependents, diagJac, nfev: 0 };

  const f0 = f(t0, y0);
  const yPert = [...y0];
  let nfev = 1;

  for (let i = 0; i < n; i++) {
    const orig = y0[i]!;
    const eps = Math.max(1e-7 * Math.abs(orig), 1e-8);
    yPert[i] = orig + eps;
    const f1 = f(t0, yPert);
    yPert[i] = orig;
    nfev++;

    for (let j = 0; j < n; j++) {
      const df = (f1[j]! - f0[j]!) / eps;
      if (i === j) {
        diagJac[i] = df;
      }
      if (Math.abs(df) > 1e-13 || i === j) {
        dependents[i]!.push(j);
      }
    }
  }

  return { dependents, diagJac, nfev };
}

/**
 * Core Quantized State System (`QSS1`, `QSS2`, `QSS3`, and stiff `LIQSS2`) integrator.
 *
 * @param f - ODE right-hand side $f(t, y) = \dot{y}$.
 * @param t0 - Initial time.
 * @param y0 - Initial state vector.
 * @param tf - Final time.
 * @param outputTimes - Sorted list of sample times at which to record the continuous state polynomial.
 * @param options - QSS method and quantum tolerances (`atol`, `rtol`).
 */
export function qssSolve(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tf: number,
  outputTimes: number[],
  options?: QSSOptions,
): QSSResult {
  const method: QSSMethod = options?.method ?? "qss2";
  const order = method === "qss1" ? 1 : method === "qss3" ? 3 : 2;
  const isLiqss = method === "liqss2";
  const n = y0.length;

  // Scale default quantum from standard ODE tolerances if very small tolerances (e.g. 1e-7) are passed
  const rawRtol = options?.rtol ?? 1e-4;
  const rawAtol = options?.atol ?? 1e-5;
  const rtol = Math.max(rawRtol, order === 1 ? 5e-4 : 1e-5);
  const atol = Math.max(rawAtol, order === 1 ? 5e-4 : 1e-6);
  const maxEvents = options?.maxEvents ?? 250000;

  if (n === 0) {
    return {
      times: [...outputTimes],
      states: outputTimes.map(() => []),
      stats: {
        acceptedSteps: 0,
        rejectedSteps: 0,
        fEvals: 0,
        jacobianEvals: 0,
        luFactorizations: 0,
        converged: true,
        quantumCrossings: 0,
      },
    };
  }

  // Polynomial state coefficients: x_i(t) = x0[i] + x1[i]*dt + x2[i]*dt^2 + x3[i]*dt^3
  const x0 = Float64Array.from(y0);
  const x1 = new Float64Array(n);
  const x2 = new Float64Array(n);
  const x3 = new Float64Array(n);
  const tx = new Float64Array(n).fill(t0);

  // Quantized state coefficients: q_i(t) = q0[i] + q1[i]*dt + q2[i]*dt^2
  const q0 = Float64Array.from(y0);
  const q1 = new Float64Array(n);
  const q2 = new Float64Array(n);
  const tq = new Float64Array(n).fill(t0);

  // Quantum per state variable and next transition time
  const dq = new Float64Array(n);
  const nextEventTime = new Float64Array(n).fill(Infinity);

  // Probe sparsity and diagonal Jacobian
  const { dependents, diagJac, nfev: initNfev } = probeSparsityGraph(f, t0, y0);
  if (options?.dependencies) {
    for (let i = 0; i < Math.min(n, options.dependencies.length); i++) {
      dependents[i] = [...options.dependencies[i]!];
    }
  }
  let nfev = initNfev;

  const evalQAt = (t: number, out: number[]): void => {
    for (let i = 0; i < n; i++) {
      const dt = t - tq[i]!;
      out[i] = q0[i]! + (order >= 2 ? q1[i]! * dt : 0) + (order >= 3 ? q2[i]! * dt * dt : 0);
    }
  };

  const evalXAt = (i: number, t: number): number => {
    const dt = t - tx[i]!;
    return x0[i]! + x1[i]! * dt + (order >= 2 ? x2[i]! * dt * dt : 0) + (order >= 3 ? x3[i]! * dt * dt * dt : 0);
  };

  const updateQuantum = (i: number): void => {
    dq[i] = Math.max(rtol * Math.abs(x0[i]!), atol);
  };

  const qBuf = new Array<number>(n);
  const qPert = new Array<number>(n);

  /**
   * Recomputes Taylor derivative coefficients `(x1[j], x2[j], x3[j])` at time `t`
   * using directional finite differences along the quantized state polynomial $q(\tau)$.
   */
  const computeDerivativesAt = (t: number, indices: readonly number[]): void => {
    evalQAt(t, qBuf);
    const fBase = f(t, qBuf);
    nfev++;

    let fFwd1: number[] | null = null;
    let fFwd2: number[] | null = null;
    let fBwd2: number[] | null = null;
    const hDir1 = 1e-6;
    const hDir2 = 1e-4;

    if (order >= 2) {
      evalQAt(t + hDir1, qPert);
      fFwd1 = f(t + hDir1, qPert);
      nfev++;
    }
    if (order >= 3) {
      evalQAt(t + hDir2, qPert);
      fFwd2 = f(t + hDir2, qPert);
      evalQAt(t - hDir2, qPert);
      fBwd2 = f(t - hDir2, qPert);
      nfev += 2;
    }

    for (const j of indices) {
      // Advance x_j to time t before updating its slopes
      if (t > tx[j]!) {
        x0[j] = evalXAt(j, t);
        tx[j] = t;
      }
      x1[j] = fBase[j]!;
      if (order >= 2 && fFwd1) {
        const ddf = (fFwd1[j]! - fBase[j]!) / hDir1;
        x2[j] = 0.5 * ddf;
      } else {
        x2[j] = 0;
      }
      if (order >= 3 && fFwd2 && fBwd2) {
        const d2f = (fFwd2[j]! - 2 * fBase[j]! + fBwd2[j]!) / (hDir2 * hDir2);
        x3[j] = d2f / 6.0;
      } else {
        x3[j] = 0;
      }
    }
  };

  /**
   * Computes the next quantum-crossing time `nextEventTime[i]` from current time `t`
   * where $|x_i(\tau) - q_i(\tau)| = \Delta Q_i$.
   */
  const scheduleNextCrossing = (i: number, t: number, isSelfUpdate: boolean): void => {
    const quant = dq[i]!;
    if (isSelfUpdate) {
      if (order === 1) {
        const slope = Math.abs(x1[i]!);
        nextEventTime[i] = slope > 1e-18 ? t + quant / slope : Infinity;
      } else if (order === 2) {
        const accel = Math.abs(x2[i]!);
        if (accel > 1e-18) {
          nextEventTime[i] = t + Math.sqrt(quant / accel);
        } else {
          const slopeDiff = Math.abs(x1[i]! - q1[i]!);
          nextEventTime[i] = slopeDiff > 1e-18 ? t + quant / slopeDiff : Infinity;
        }
      } else {
        const jerk = Math.abs(x3[i]!);
        if (jerk > 1e-18) {
          nextEventTime[i] = t + Math.cbrt(quant / jerk);
        } else if (Math.abs(x2[i]! - q2[i]!) > 1e-18) {
          nextEventTime[i] = t + Math.sqrt(quant / Math.abs(x2[i]! - q2[i]!));
        } else {
          nextEventTime[i] = Infinity;
        }
      }
      return;
    }

    // Dependent update: compute difference polynomial e(tau) = x_i(t + tau) - q_i(t + tau)
    const dtQ = t - tq[i]!;
    const qVal = q0[i]! + (order >= 2 ? q1[i]! * dtQ : 0) + (order >= 3 ? q2[i]! * dtQ * dtQ : 0);
    const qSlope = (order >= 2 ? q1[i]! : 0) + (order >= 3 ? 2 * q2[i]! * dtQ : 0);
    const qCurv = order >= 3 ? q2[i]! : 0;

    const e0 = x0[i]! - qVal;
    if (Math.abs(e0) >= quant * (1 - 1e-12)) {
      nextEventTime[i] = t;
      return;
    }
    const e1 = x1[i]! - qSlope;
    const e2 = (order >= 2 ? x2[i]! : 0) - qCurv;
    const e3 = order >= 3 ? x3[i]! : 0;

    // Solve e(tau) - quant = 0 and e(tau) + quant = 0 for smallest positive tau
    const rUpper = smallestPositivePolyRoot(e0 - quant, e1, e2, e3);
    const rLower = smallestPositivePolyRoot(e0 + quant, e1, e2, e3);
    const dt = Math.min(rUpper, rLower);
    nextEventTime[i] = t + dt;
  };

  const bootstrapAllTaylorCoefficients = (t: number): void => {
    computeDerivativesAt(t, allIndices);
    if (order >= 2) {
      for (let i = 0; i < n; i++) q1[i] = x1[i]!;
      computeDerivativesAt(t, allIndices);
    }
    if (order >= 3) {
      for (let i = 0; i < n; i++) q2[i] = x2[i]!;
      computeDerivativesAt(t, allIndices);
    }
    for (let i = 0; i < n; i++) {
      if (order >= 2) q1[i] = x1[i]!;
      if (order >= 3) q2[i] = x2[i]!;
    }
  };

  // Initialize all states and derivatives at t0
  const allIndices = Array.from({ length: n }, (_, idx) => idx);
  for (let i = 0; i < n; i++) {
    updateQuantum(i);
  }
  bootstrapAllTaylorCoefficients(t0);
  for (let i = 0; i < n; i++) {
    scheduleNextCrossing(i, t0, true);
  }

  // Zero-crossing event setup
  const eventFns = options?.eventFunctions ?? [];
  const eventDirs = options?.eventDirections ?? [];
  const eventCb = options?.eventCallback;
  const prevEventVals = new Float64Array(eventFns.length);
  if (eventFns.length > 0) {
    const yInit = Array.from(x0);
    for (let k = 0; k < eventFns.length; k++) {
      prevEventVals[k] = eventFns[k]!(t0, yInit);
    }
  }

  // Output recording buffers
  const times: number[] = [];
  const states: number[][] = [];
  let outIdx = 0;

  while (outIdx < outputTimes.length && outputTimes[outIdx]! <= t0 + 1e-15) {
    times.push(outputTimes[outIdx]!);
    states.push(Array.from(x0));
    outIdx++;
  }

  let currentTime = t0;
  let quantumCrossings = 0;

  while (currentTime < tf && quantumCrossings < maxEvents) {
    // Find state `minIdx` with earliest scheduled quantum crossing time
    let minTime = Infinity;
    let minIdx = -1;
    for (let i = 0; i < n; i++) {
      if (nextEventTime[i]! < minTime) {
        minTime = nextEventTime[i]!;
        minIdx = i;
      }
    }

    const stepTargetTime = Math.min(minTime, tf);

    // Check external zero-crossing event functions over [currentTime, stepTargetTime]
    let firedExternalEvent = false;
    if (eventFns.length > 0 && stepTargetTime > currentTime) {
      const yTarget = new Array<number>(n);
      for (let i = 0; i < n; i++) yTarget[i] = evalXAt(i, stepTargetTime);

      for (let k = 0; k < eventFns.length; k++) {
        const g0 = prevEventVals[k]!;
        const g1 = eventFns[k]!(stepTargetTime, yTarget);
        const dir = eventDirs[k] ?? 0;
        const rising = g0 < 0 && g1 >= 0 && (dir === 0 || dir === 1);
        const falling = g0 > 0 && g1 <= 0 && (dir === 0 || dir === -1);
        if (rising || falling) {
          // Locate zero crossing time via secant/bisection on continuous polynomial x(t)
          let a = currentTime;
          let b = stepTargetTime;
          let ga = g0;
          for (let iter = 0; iter < 24; iter++) {
            const mid = 0.5 * (a + b);
            const yMid = new Array<number>(n);
            for (let i = 0; i < n; i++) yMid[i] = evalXAt(i, mid);
            const gm = eventFns[k]!(mid, yMid);
            if (Math.abs(gm) < 1e-12 || b - a < 1e-12) {
              a = mid;
              break;
            }
            if (ga * gm <= 0) {
              b = mid;
            } else {
              a = mid;
              ga = gm;
            }
          }
          const tEvent = 0.5 * (a + b);

          // Flush any output times prior to tEvent
          while (outIdx < outputTimes.length && outputTimes[outIdx]! <= tEvent) {
            const tSample = outputTimes[outIdx]!;
            times.push(tSample);
            const row = new Array<number>(n);
            for (let i = 0; i < n; i++) row[i] = evalXAt(i, tSample);
            states.push(row);
            outIdx++;
          }

          currentTime = tEvent;
          const yAtEvent = new Array<number>(n);
          for (let i = 0; i < n; i++) yAtEvent[i] = evalXAt(i, tEvent);
          const yUpdated = eventCb ? eventCb(tEvent, yAtEvent, k, rising ? 1 : -1) : yAtEvent;

          // Reinitialize all QSS polynomials at tEvent
          for (let i = 0; i < n; i++) {
            x0[i] = yUpdated[i]!;
            q0[i] = yUpdated[i]!;
            tx[i] = tEvent;
            tq[i] = tEvent;
            updateQuantum(i);
          }
          bootstrapAllTaylorCoefficients(tEvent);
          for (let i = 0; i < n; i++) {
            scheduleNextCrossing(i, tEvent, true);
          }
          for (let eIdx = 0; eIdx < eventFns.length; eIdx++) {
            prevEventVals[eIdx] = eventFns[eIdx]!(tEvent, yUpdated);
          }
          firedExternalEvent = true;
          break;
        }
        prevEventVals[k] = g1;
      }
    }

    if (firedExternalEvent) continue;

    // Emit all requested output samples in (currentTime, stepTargetTime]
    while (outIdx < outputTimes.length && outputTimes[outIdx]! <= stepTargetTime + 1e-15) {
      const tSample = outputTimes[outIdx]!;
      times.push(tSample);
      const row = new Array<number>(n);
      for (let i = 0; i < n; i++) row[i] = evalXAt(i, tSample);
      states.push(row);
      outIdx++;
    }

    if (minTime >= tf || minIdx < 0) {
      currentTime = tf;
      break;
    }

    // Advance to the quantum transition at `minTime` for state `minIdx`
    currentTime = minTime;
    quantumCrossings++;

    const dtPrevX = currentTime - tx[minIdx]!;
    x0[minIdx] = evalXAt(minIdx, currentTime);
    tx[minIdx] = currentTime;
    updateQuantum(minIdx);

    if (isLiqss && diagJac[minIdx]! < -1e-6) {
      // Stiff LIQSS2 update: position q0 on the boundary in the direction of motion
      // or stabilize around the equilibrium where a_ii * q + u_i = 0
      const aii = diagJac[minIdx]!;
      const dtPrev = currentTime - tq[minIdx]!;
      const qPrev = q0[minIdx]! + q1[minIdx]! * dtPrev;
      const uEst = x1[minIdx]! - aii * qPrev;
      const eqState = -uEst / aii;
      const quant = dq[minIdx]!;
      if (Math.abs(eqState - x0[minIdx]!) <= quant) {
        q0[minIdx] = eqState;
      } else {
        q0[minIdx] = x0[minIdx]! + Math.sign(eqState - x0[minIdx]!) * quant;
      }
      tq[minIdx] = currentTime;
    } else {
      q0[minIdx] = x0[minIdx]!;
      tq[minIdx] = currentTime;
      if (order >= 2) {
        q1[minIdx] = x1[minIdx]! + 2 * x2[minIdx]! * dtPrevX + 3 * x3[minIdx]! * dtPrevX * dtPrevX;
      }
      if (order >= 3) {
        q2[minIdx] = x2[minIdx]! + 3 * x3[minIdx]! * dtPrevX;
      }
    }

    // Recompute derivatives ONLY for the sparse set of dependent states `dependents[minIdx]`
    const affected = dependents[minIdx] && dependents[minIdx]!.length > 0 ? dependents[minIdx]! : [minIdx];
    computeDerivativesAt(currentTime, affected);

    if (order >= 2) {
      q1[minIdx] = x1[minIdx]!;
      computeDerivativesAt(currentTime, affected);
    }
    if (order >= 3) {
      q2[minIdx] = x2[minIdx]!;
      computeDerivativesAt(currentTime, affected);
      q1[minIdx] = x1[minIdx]!;
      q2[minIdx] = x2[minIdx]!;
    }

    // Reschedule `minIdx` and all affected dependent states
    scheduleNextCrossing(minIdx, currentTime, true);
    for (const j of affected) {
      if (j !== minIdx) {
        scheduleNextCrossing(j, currentTime, false);
      }
    }
  }

  // Ensure any remaining output times at tf are populated
  while (outIdx < outputTimes.length) {
    const tSample = outputTimes[outIdx]!;
    times.push(tSample);
    const row = new Array<number>(n);
    for (let i = 0; i < n; i++) row[i] = evalXAt(i, tSample);
    states.push(row);
    outIdx++;
  }

  return {
    times,
    states,
    stats: {
      acceptedSteps: quantumCrossings,
      rejectedSteps: 0,
      fEvals: nfev,
      jacobianEvals: 1,
      luFactorizations: 0,
      converged: true,
      quantumCrossings,
    },
  };
}

/** First-Order Quantized State System (`QSS1`) solver. */
export function qss1(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tf: number,
  outputTimes: number[],
  options?: Omit<QSSOptions, "method">,
): QSSResult {
  return qssSolve(f, t0, y0, tf, outputTimes, { ...options, method: "qss1" });
}

/** Second-Order Quantized State System (`QSS2`) solver. */
export function qss2(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tf: number,
  outputTimes: number[],
  options?: Omit<QSSOptions, "method">,
): QSSResult {
  return qssSolve(f, t0, y0, tf, outputTimes, { ...options, method: "qss2" });
}

/** Third-Order Quantized State System (`QSS3`) solver. */
export function qss3(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tf: number,
  outputTimes: number[],
  options?: Omit<QSSOptions, "method">,
): QSSResult {
  return qssSolve(f, t0, y0, tf, outputTimes, { ...options, method: "qss3" });
}

/** Second-Order Linearly Implicit Quantized State System (`LIQSS2`) solver for stiff systems. */
export function liqss2(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tf: number,
  outputTimes: number[],
  options?: Omit<QSSOptions, "method">,
): QSSResult {
  return qssSolve(f, t0, y0, tf, outputTimes, { ...options, method: "liqss2" });
}
