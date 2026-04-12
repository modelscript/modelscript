// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dormand-Prince 5(4) adaptive step-size ODE solver (DOPRI5).
 *
 * An embedded Runge-Kutta pair that provides 5th-order propagation and
 * 4th-order error estimation, with FSAL (First Same As Last) optimization.
 * Includes dense output via Hermite interpolation and optional event
 * detection with bisection root-finding.
 *
 * Reference: Dormand, J.R. & Prince, P.J. (1980),
 *   "A family of embedded Runge-Kutta formulae",
 *   J. Comp. Appl. Math., 6, 19-26.
 */

// ── Butcher tableaux for Dormand-Prince 5(4) ──

/** Time coefficients c_i */
const C: readonly number[] = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];

/** Coupling coefficients a_ij (lower triangular) */
const A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];

/** 5th-order weights (propagation) — same as A[6] due to FSAL */
const B5: readonly number[] = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];

/** 4th-order weights (error estimation) */
const B4: readonly number[] = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

/** Error coefficients: e_i = b5_i - b4_i */
const E: readonly number[] = B5.map((b5, i) => b5 - (B4[i] ?? 0));

// ── Public interface ──

/** Configuration options for the DOPRI5 solver. */
export interface Dopri5Options {
  /** Absolute tolerance (default: 1e-6). */
  atol?: number;
  /** Relative tolerance (default: 1e-6). */
  rtol?: number;
  /** Maximum step size (default: tEnd - t0). */
  maxStep?: number;
  /** Initial step size (default: auto-estimated). */
  initialStep?: number;
  /** Maximum number of steps (default: 100000). */
  maxSteps?: number;
  /** If true, output values only at `outputTimes`. If false, outputs every internal solver step (default: true). */
  equidistantOutput?: boolean;
}

/** Result of a DOPRI5 integration. */
export interface Dopri5Result {
  /** Output time points. */
  times: number[];
  /** State vectors at each output time. */
  states: number[][];
  /** Total number of function evaluations. */
  fEvals: number;
  /** Total number of accepted steps. */
  acceptedSteps: number;
  /** Total number of rejected steps. */
  rejectedSteps: number;
}

/**
 * Type for the right-hand side function: dy/dt = f(t, y).
 * Takes the current time and state vector, returns derivatives.
 */
export type RhsFunction = (t: number, y: number[]) => number[];

/**
 * Event callback: called when an event is detected.
 * Receives the event time, state at that time, and the event index.
 * Should return the (possibly modified) state vector after the event.
 */
export type EventCallback = (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[];

/**
 * Integrate an ODE system using the Dormand-Prince 5(4) method.
 *
 * @param f       Right-hand side function: dy/dt = f(t, y)
 * @param t0      Initial time
 * @param y0      Initial state vector
 * @param tEnd    Final time
 * @param outputTimes  Sorted array of desired output times (must include t0 and tEnd)
 * @param options Solver options (tolerances, max step, etc.)
 * @param eventFunctions  Optional array of event functions g_i(t, y); events trigger on sign change
 * @param eventCallback   Optional callback when an event is detected
 * @returns Solver result with output states and statistics
 */
export function dopri5(
  f: RhsFunction,
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes: number[],
  options: Dopri5Options = {},
  eventFunctions?: ((t: number, y: number[]) => number)[],
  eventCallback?: EventCallback,
): Dopri5Result {
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const maxSteps = options.maxSteps ?? 100000;
  const equidistant = options.equidistantOutput !== false;
  const n = y0.length;

  // ── Output setup ──
  const result: Dopri5Result = {
    times: [],
    states: [],
    fEvals: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
  };

  // Sorted output queue
  let outputIdx = 0;
  if (equidistant) {
    while (outputIdx < outputTimes.length && (outputTimes[outputIdx] ?? t0) <= t0) {
      result.times.push(t0);
      result.states.push([...y0]);
      outputIdx++;
    }
  } else {
    result.times.push(t0);
    result.states.push([...y0]);
  }

  // ── Initial step size estimation ──
  let h = options.initialStep ?? estimateInitialStep(f, t0, y0, atol, rtol, maxStep);
  h = Math.min(h, maxStep);

  // ── Integration loop ──
  let t = t0;
  let y = [...y0];

  // FSAL: reuse the last stage k7 as k1 of the next step
  let k1 = f(t, y);
  result.fEvals++;

  // Scratch arrays for stages
  const k: number[][] = Array.from({ length: 7 }, () => new Array(n).fill(0) as number[]);
  k[0] = k1;

  // Previous event function values (for sign-change detection)
  let prevEventValues: number[] | null = null;
  if (eventFunctions && eventFunctions.length > 0) {
    prevEventValues = eventFunctions.map((g) => g(t, y));
  }

  let totalSteps = 0;

  while (t < tEnd && totalSteps < maxSteps) {
    totalSteps++;

    // Don't overshoot tEnd
    if (t + h > tEnd) h = tEnd - t;
    if (h < 1e-15) break;

    // ── Compute RK stages ──
    // k[0] = k1 (already computed, FSAL)
    for (let s = 1; s < 7; s++) {
      const cs = C[s] ?? 0;
      const as = A[s];
      if (!as) continue;

      const yStage = new Array(n) as number[];
      for (let i = 0; i < n; i++) {
        let sum = y[i] ?? 0;
        for (let j = 0; j < as.length; j++) {
          sum += h * (as[j] ?? 0) * ((k[j] ?? [])[i] ?? 0);
        }
        yStage[i] = sum;
      }
      k[s] = f(t + cs * h, yStage);
      result.fEvals++;
    }

    // ── Compute 5th-order solution and error estimate ──
    const yNew = new Array(n) as number[];
    let err = 0;
    for (let i = 0; i < n; i++) {
      let y5 = y[i] ?? 0;
      let errI = 0;
      for (let s = 0; s < 7; s++) {
        const ks = (k[s] ?? [])[i] ?? 0;
        y5 += h * (B5[s] ?? 0) * ks;
        errI += h * (E[s] ?? 0) * ks;
      }
      yNew[i] = y5;

      // Scaled error (component-wise)
      const sc = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(y5));
      err = Math.max(err, Math.abs(errI) / sc);
    }

    // ── Step acceptance / rejection ──
    if (err <= 1.0) {
      // Accept step
      result.acceptedSteps++;

      const tNew = t + h;

      // ── Event Detection & Dense Output ──
      let eventOccurred = false;
      if (eventFunctions && prevEventValues && eventCallback) {
        const newEventValues = eventFunctions.map((g) => g(tNew, yNew));
        for (let ei = 0; ei < eventFunctions.length; ei++) {
          const prev = prevEventValues[ei] ?? 0;
          const curr = newEventValues[ei] ?? 0;
          if (prev * curr < 0) {
            eventOccurred = true;
            const eventFn = eventFunctions[ei];
            if (!eventFn) continue;

            // ── Bisection to find exact event time ──
            const tEvent = bisectEvent(eventFn, t, tNew, y, yNew, k, h, n);
            const thetaEvent = (tEvent - t) / h;
            const yEvent = hermiteInterpolation(y, yNew, k[0] ?? [], k[6] ?? [], h, thetaEvent, n);

            // ── Output interpolation BEFORE the event! ──
            if (equidistant) {
              while (outputIdx < outputTimes.length && (outputTimes[outputIdx] ?? tEnd) < tEvent - 1e-14) {
                const tOut = outputTimes[outputIdx] ?? tEvent;
                if (Math.abs(tOut - t) < 1e-14) {
                  result.times.push(t);
                  result.states.push([...y]);
                } else {
                  const theta = (tOut - t) / h;
                  const yInterp = hermiteInterpolation(y, yNew, k[0] ?? [], k[6] ?? [], h, theta, n);
                  result.times.push(tOut);
                  result.states.push(yInterp);
                }
                outputIdx++;
              }
              // Advance outputIdx if an outputTime lands exactly on the event
              if (outputIdx < outputTimes.length && Math.abs((outputTimes[outputIdx] ?? tEnd) - tEvent) < 1e-14) {
                outputIdx++;
              }
            }

            // ALWAYS force output of the event point for exact precision
            result.times.push(tEvent);
            result.states.push([...yEvent]);

            // ── Fire event callback ──
            const dir = curr < 0 ? -1 : 1;
            const yAfter = eventCallback(tEvent, yEvent, ei, dir);

            // Output explicit post-event state so the plot shows instantaneous jump
            result.times.push(tEvent);
            result.states.push([...yAfter]);

            // ── Restart solver at event time ──
            t = tEvent;
            y = yAfter;
            k1 = f(t, y);
            result.fEvals++;
            k[0] = k1;
            prevEventValues = eventFunctions.map((g) => g(t, y));
            break; // process one event per step
          }
        }
        if (!eventOccurred) {
          prevEventValues = newEventValues;
        }
      }

      // ── Dense output for intermediate output times if NO event interrupted this step ──
      if (!eventOccurred) {
        if (equidistant) {
          while (outputIdx < outputTimes.length && (outputTimes[outputIdx] ?? tEnd) <= tNew + 1e-14) {
            const tOut = outputTimes[outputIdx] ?? tNew;
            if (tOut <= t + 1e-14) {
              result.times.push(t);
              result.states.push([...y]);
            } else if (Math.abs(tOut - tNew) < 1e-14) {
              result.times.push(tNew);
              result.states.push([...yNew]);
            } else {
              const theta = (tOut - t) / h;
              const yInterp = hermiteInterpolation(y, yNew, k[0] ?? [], k[6] ?? [], h, theta, n);
              result.times.push(tOut);
              result.states.push(yInterp);
            }
            outputIdx++;
          }
        } else {
          result.times.push(tNew);
          result.states.push([...yNew]);
        }

        t = tNew;
        y = yNew;
        // FSAL: k7 of this step = k1 of next step
        k1 = k[6] ?? k1;
        k[0] = k1;
      }

      // ── New step size ──
      const factor = err > 0 ? Math.min(5.0, Math.max(0.2, 0.9 * Math.pow(err, -0.2))) : 5.0;
      h = Math.min(h * factor, maxStep);
    } else {
      // Reject step — reduce step size and retry
      result.rejectedSteps++;
      const factor = Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      h *= factor;
    }
  }

  // Ensure we output the final state if not already done
  const shouldPushFinal = equidistant
    ? result.times.length === 0 || (result.times[result.times.length - 1] ?? -1) < tEnd - 1e-14
    : result.times.length === 0 || Math.abs((result.times[result.times.length - 1] ?? -1) - tEnd) > 1e-14;

  if (shouldPushFinal) {
    result.times.push(t);
    result.states.push([...y]);
  }

  return result;
}

// ── Helper functions ──

/**
 * Estimate initial step size using the approach from Hairer & Wanner.
 */
function estimateInitialStep(
  f: RhsFunction,
  t0: number,
  y0: number[],
  atol: number,
  rtol: number,
  maxStep: number,
): number {
  const n = y0.length;
  const f0 = f(t0, y0);

  // d0 = || y0 || (scaled)
  // d1 = || f0 || (scaled)
  let d0 = 0;
  let d1 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y0[i] ?? 0);
    d0 = Math.max(d0, Math.abs(y0[i] ?? 0) / sc);
    d1 = Math.max(d1, Math.abs(f0[i] ?? 0) / sc);
  }

  let h0: number;
  if (d0 < 1e-5 || d1 < 1e-5) {
    h0 = 1e-6;
  } else {
    h0 = 0.01 * (d0 / d1);
  }
  h0 = Math.min(h0, maxStep);

  // Explicit Euler step to estimate ||f''||
  const y1 = new Array(n) as number[];
  for (let i = 0; i < n; i++) {
    y1[i] = (y0[i] ?? 0) + h0 * (f0[i] ?? 0);
  }
  const f1 = f(t0 + h0, y1);

  let d2 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y0[i] ?? 0);
    d2 = Math.max(d2, Math.abs(((f1[i] ?? 0) - (f0[i] ?? 0)) / h0) / sc);
  }

  let h1: number;
  if (Math.max(d1, d2) <= 1e-15) {
    h1 = Math.max(1e-6, h0 * 1e-3);
  } else {
    h1 = Math.pow(0.01 / Math.max(d1, d2), 0.2);
  }

  return Math.min(100 * h0, Math.min(h1, maxStep));
}

/**
 * Hermite cubic interpolation for dense output.
 * Uses the FSAL property: k1 = f(t, y), k7 = f(t+h, yNew).
 */
function hermiteInterpolation(
  y: number[],
  yNew: number[],
  k1: number[],
  k7: number[],
  h: number,
  theta: number,
  n: number,
): number[] {
  const result = new Array(n) as number[];
  const theta1 = 1 - theta;
  for (let i = 0; i < n; i++) {
    const y0 = y[i] ?? 0;
    const y1 = yNew[i] ?? 0;
    const f0 = (k1[i] ?? 0) * h;
    const f1 = (k7[i] ?? 0) * h;
    // Cubic Hermite: P(θ) = (1-θ)·y0 + θ·y1 + θ·(θ-1)·[(1-2θ)·(y1-y0) + (θ-1)·f0 + θ·f1]
    result[i] = y0 + theta * (y1 - y0) + theta * theta1 * ((1 - 2 * theta) * (y1 - y0) + theta1 * f0 + theta * f1);
  }
  return result;
}

/**
 * Bisection root-finding for event location within [tLo, tHi].
 */
function bisectEvent(
  eventFn: (t: number, y: number[]) => number,
  tLo: number,
  tHi: number,
  yLo: number[],
  yHi: number[],
  k: number[][],
  h: number,
  n: number,
): number {
  const maxIter = 50;
  const tol = 1e-12;

  let lo = tLo;
  let hi = tHi;
  let gLo = eventFn(lo, yLo);

  for (let iter = 0; iter < maxIter; iter++) {
    const tMid = (lo + hi) / 2;
    if (hi - lo < tol) break;

    // Interpolate state at tMid
    const theta = (tMid - tLo) / h;
    const yMid = hermiteInterpolation(yLo, yHi, k[0] ?? [], k[6] ?? [], h, theta, n);
    const gMid = eventFn(tMid, yMid);

    if (gLo * gMid <= 0) {
      hi = tMid;
    } else {
      lo = tMid;
      gLo = gMid;
    }
  }

  return (lo + hi) / 2;
}
