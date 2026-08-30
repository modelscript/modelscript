// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * WebAssembly-backed Dormand-Prince 5(4) adaptive step-size ODE solver (DOPRI5).
 *
 * Provides:
 *  - Native AssemblyScript WASM integration for linear memory DAE systems
 *  - 5th-order propagation with 4th-order error estimation & FSAL optimization
 *  - Dense output via cubic Hermite interpolation
 *  - Event detection with bisection root-finding & Zeno chattering prevention
 *  - Synchronous and asynchronous simulation execution
 *
 * Reference: Dormand, J.R. & Prince, P.J. (1980),
 *   "A family of embedded Runge-Kutta formulae",
 *   J. Comp. Appl. Math., 6, 19-26.
 */

// ── Butcher tableaux for Dormand-Prince 5(4) ──

/** Time coefficients c_i */
export const DOPRI5_C: readonly number[] = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];

/** Coupling coefficients a_ij (lower triangular) */
export const DOPRI5_A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];

/** 5th-order weights (propagation) — same as A[6] due to FSAL */
export const DOPRI5_B5: readonly number[] = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];

/** 4th-order weights (error estimation) */
export const DOPRI5_B4: readonly number[] = [
  5179 / 57600,
  0,
  7571 / 16695,
  393 / 640,
  -92097 / 339200,
  187 / 2100,
  1 / 40,
];

/** Error coefficients: e_i = b5_i - b4_i */
export const DOPRI5_E: readonly number[] = DOPRI5_B5.map((b5, i) => b5 - (DOPRI5_B4[i] ?? 0));

// ── Public interfaces ──

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

/** Right-hand side function: dy/dt = f(t, y). */
export type RhsFunction = (t: number, y: number[]) => number[];
export type RhsFunctionAsync = (t: number, y: number[]) => Promise<number[]>;
export type EventFunctionAsync = (t: number, y: number[]) => Promise<number>;

/** Event callback when a zero-crossing event is detected. */
export type EventCallback = (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[];

/**
 * WebAssembly-backed Dormand-Prince 5(4) Bridge.
 * Interfaces with linear memory AssemblyScript DOPRI5 routines.
 */
export class WasmDopri5 {
  constructor(private wasmInstance: any) {}

  /**
   * Executes a single adaptive DOPRI5 step in WASM linear memory.
   */
  step(
    daePtr: number,
    varValuesPtr: number,
    kStagesPtr: number,
    tempValuesPtr: number,
    yNewPtr: number,
    dt: number,
    atol: number = 1e-6,
    rtol: number = 1e-6,
  ): boolean {
    if (typeof this.wasmInstance?.exports?.stepDopri5 === "function") {
      return Boolean(
        this.wasmInstance.exports.stepDopri5(daePtr, varValuesPtr, kStagesPtr, tempValuesPtr, yNewPtr, dt, atol, rtol),
      );
    }
    return true;
  }

  /**
   * Evaluates cubic Hermite interpolation in WASM linear memory.
   */
  hermiteInterpolate(
    y0Ptr: number,
    y1Ptr: number,
    k1Ptr: number,
    k7Ptr: number,
    dt: number,
    theta: number,
    numVars: number,
    outPtr: number,
  ): void {
    if (typeof this.wasmInstance?.exports?.hermiteInterpolate === "function") {
      this.wasmInstance.exports.hermiteInterpolate(y0Ptr, y1Ptr, k1Ptr, k7Ptr, dt, theta, numVars, outPtr);
    }
  }
}

/**
 * Integrate an ODE system using the Dormand-Prince 5(4) method.
 *
 * @param f               Right-hand side function: dy/dt = f(t, y)
 * @param t0              Initial time
 * @param y0              Initial state vector
 * @param tEnd            Final time
 * @param outputTimes     Sorted array of desired output times
 * @param options         Solver options
 * @param eventFunctions  Optional array of event functions g_i(t, y)
 * @param eventCallback   Optional callback when an event is detected
 * @param eventDirections Optional crossing directions per event (-1, +1, 0)
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
  eventDirections?: number[],
): Dopri5Result {
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const maxSteps = options.maxSteps ?? 100000;
  const equidistant = options.equidistantOutput !== false;
  const n = y0.length;

  const result: Dopri5Result = {
    times: [],
    states: [],
    fEvals: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
  };

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

  let h = options.initialStep ?? estimateInitialStep(f, t0, y0, atol, rtol, maxStep);
  h = Math.min(h, maxStep);

  let t = t0;
  let y = [...y0];

  let k1 = f(t, y);
  result.fEvals++;

  const k: number[][] = Array.from({ length: 7 }, () => new Array(n).fill(0) as number[]);
  k[0] = k1;

  const computeEventValuesWithProbe = (currentTime: number, currentState: number[]) => {
    if (!eventFunctions) return [];
    return eventFunctions.map((g, gIdx) => {
      const gVal = g(currentTime, currentState);
      if (Math.abs(gVal) < 1e-10) {
        const dydt = f(currentTime, currentState);
        const probe = currentState.map((yi, si) => yi + 1e-8 * (dydt[si] ?? 0));
        const gProbe = g(currentTime + 1e-8, probe);
        if (Math.abs(gProbe) > 1e-14) {
          return gProbe > 0 ? 1e-10 : -1e-10;
        }
        const reqDir = eventDirections?.[gIdx] ?? 0;
        if (reqDir < 0) return 1e-10;
        if (reqDir > 0) return -1e-10;
        return 1e-10;
      }
      return gVal;
    });
  };

  let prevEventValues: number[] | null = null;
  if (eventFunctions && eventFunctions.length > 0) {
    prevEventValues = computeEventValuesWithProbe(t, y);
  }

  let totalSteps = 0;
  let lastEventTime = -Infinity;
  let consecutiveEvents = 0;

  while (t < tEnd && totalSteps < maxSteps) {
    totalSteps++;

    if (t + h > tEnd) h = tEnd - t;
    if (h < 1e-15) break;

    // Stages 1-6
    for (let s = 1; s < 7; s++) {
      const cs = DOPRI5_C[s] ?? 0;
      const as = DOPRI5_A[s];
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

    // 5th-order solution and error estimate
    const yNew = new Array(n) as number[];
    let err = 0;
    for (let i = 0; i < n; i++) {
      let y5 = y[i] ?? 0;
      let errI = 0;
      for (let s = 0; s < 7; s++) {
        const ks = (k[s] ?? [])[i] ?? 0;
        y5 += h * (DOPRI5_B5[s] ?? 0) * ks;
        errI += h * (DOPRI5_E[s] ?? 0) * ks;
      }
      yNew[i] = y5;

      const sc = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(y5));
      err = Math.max(err, Math.abs(errI) / sc);
    }

    if (err <= 1.0) {
      result.acceptedSteps++;
      const tNew = t + h;
      let eventOccurred = false;

      if (eventFunctions && prevEventValues && eventCallback) {
        const newEventValues = eventFunctions.map((g) => g(tNew, yNew));
        for (let ei = 0; ei < eventFunctions.length; ei++) {
          const prev = prevEventValues[ei] ?? 0;
          const curr = newEventValues[ei] ?? 0;

          const reqDir = eventDirections?.[ei] ?? 0;
          let signChange = false;
          if (prev * curr < 0) {
            if (reqDir === 0) {
              signChange = true;
            } else if (reqDir < 0 && prev > 0 && curr < 0) {
              signChange = true;
            } else if (reqDir > 0 && prev < 0 && curr > 0) {
              signChange = true;
            }
          }

          if (signChange) {
            eventOccurred = true;
            const eventFn = eventFunctions[ei];
            if (!eventFn) continue;

            const tEvent = bisectEvent(eventFn, t, tNew, y, yNew, k, h, n, prev);
            const thetaEvent = (tEvent - t) / h;
            const yEvent = hermiteInterpolation(y, yNew, k[0] ?? [], k[6] ?? [], h, thetaEvent, n);

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
              if (outputIdx < outputTimes.length && Math.abs((outputTimes[outputIdx] ?? tEnd) - tEvent) < 1e-14) {
                outputIdx++;
              }
            }

            result.times.push(tEvent);
            result.states.push([...yEvent]);

            const dir = curr < 0 ? -1 : 1;
            const yAfter = eventCallback(tEvent, yEvent, ei, dir);

            if (Math.abs(tEvent - lastEventTime) < 1e-6) {
              consecutiveEvents++;
            } else {
              consecutiveEvents = 1;
              lastEventTime = tEvent;
            }

            if (consecutiveEvents >= 10) {
              result.times.push(tEvent);
              result.states.push([...yAfter]);

              if (equidistant) {
                while (outputIdx < outputTimes.length) {
                  const tOut = outputTimes[outputIdx] ?? tEnd;
                  if (tOut > tEvent + 1e-14) {
                    result.times.push(tOut);
                    result.states.push([...yAfter]);
                  }
                  outputIdx++;
                }
              } else {
                if (tEnd > tEvent + 1e-14) {
                  result.times.push(tEnd);
                  result.states.push([...yAfter]);
                }
              }
              return result;
            }

            result.times.push(tEvent);
            result.states.push([...yAfter]);

            t = tEvent;
            y = yAfter;
            k1 = f(t, y);
            result.fEvals++;
            k[0] = k1;

            prevEventValues = computeEventValuesWithProbe(t, y);

            const t0Out = outputTimes[0] ?? 0;
            const t1Out = outputTimes[1] ?? 0;
            h = Math.min(h, outputTimes.length > 1 ? t1Out - t0Out : h * 0.1);
            break;
          }
        }
      }

      if (!eventOccurred && eventFunctions && prevEventValues) {
        prevEventValues = eventFunctions.map((g) => g(tNew, yNew));
      }

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
        k1 = k[6] ?? k1;
        k[0] = k1;
      }

      const factor = err > 0 ? Math.min(5.0, Math.max(0.2, 0.9 * Math.pow(err, -0.2))) : 5.0;
      h = Math.min(h * factor, maxStep);
    } else {
      result.rejectedSteps++;
      const factor = Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      h *= factor;
    }
  }

  const shouldPushFinal = equidistant
    ? result.times.length === 0 || (result.times[result.times.length - 1] ?? -1) < tEnd - 1e-14
    : result.times.length === 0 || Math.abs((result.times[result.times.length - 1] ?? -1) - tEnd) > 1e-14;

  if (shouldPushFinal) {
    result.times.push(t);
    result.states.push([...y]);
  }

  return result;
}

/**
 * Asynchronous DOPRI5 solver for async right-hand side evaluations (WebGPU, worker pools).
 */
export async function dopri5Async(
  f: RhsFunctionAsync,
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes: number[],
  options: Dopri5Options = {},
  eventFunctions?: EventFunctionAsync[],
  eventCallback?: EventCallback,
  eventDirections?: number[],
): Promise<Dopri5Result> {
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const maxSteps = options.maxSteps ?? 100000;
  const equidistant = options.equidistantOutput !== false;
  const n = y0.length;

  const result: Dopri5Result = { times: [], states: [], fEvals: 0, acceptedSteps: 0, rejectedSteps: 0 };
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

  let h = options.initialStep ?? (await estimateInitialStepAsync(f, t0, y0, atol, rtol, maxStep));
  h = Math.min(h, maxStep);

  let t = t0;
  let y = [...y0];
  let k1 = await f(t, y);
  result.fEvals++;

  const k: number[][] = Array.from({ length: 7 }, () => new Array(n).fill(0));
  k[0] = k1;

  const computeEventValuesWithProbeAsync = async (currentTime: number, currentState: number[]) => {
    if (!eventFunctions) return [];
    const vals = [];
    for (let gIdx = 0; gIdx < eventFunctions.length; gIdx++) {
      const g = eventFunctions[gIdx]!;
      const gVal = await g(currentTime, currentState);
      if (Math.abs(gVal) < 1e-10) {
        const dydt = await f(currentTime, currentState);
        const probe = currentState.map((yi, si) => yi + 1e-8 * (dydt[si] ?? 0));
        const gProbe = await g(currentTime + 1e-8, probe);
        if (Math.abs(gProbe) > 1e-14) {
          vals.push(gProbe > 0 ? 1e-10 : -1e-10);
        } else {
          const reqDir = eventDirections?.[gIdx] ?? 0;
          if (reqDir < 0) vals.push(1e-10);
          else if (reqDir > 0) vals.push(-1e-10);
          else vals.push(1e-10);
        }
      } else {
        vals.push(gVal);
      }
    }
    return vals;
  };

  let prevEventValues: number[] | null = null;
  if (eventFunctions && eventFunctions.length > 0) {
    prevEventValues = await computeEventValuesWithProbeAsync(t, y);
  }

  let totalSteps = 0;
  let lastEventTime = -Infinity;
  let consecutiveEvents = 0;

  while (t < tEnd && totalSteps < maxSteps) {
    totalSteps++;
    if (t + h > tEnd) h = tEnd - t;
    if (h < 1e-15) break;

    for (let s = 1; s < 7; s++) {
      const cs = DOPRI5_C[s] ?? 0;
      const as = DOPRI5_A[s];
      if (!as) continue;

      const yStage = new Array(n);
      for (let i = 0; i < n; i++) {
        let sum = y[i] ?? 0;
        for (let j = 0; j < as.length; j++) {
          sum += h * (as[j] ?? 0) * ((k[j] ?? [])[i] ?? 0);
        }
        yStage[i] = sum;
      }
      k[s] = await f(t + cs * h, yStage);
      result.fEvals++;
    }

    const yNew = new Array(n);
    let err = 0;
    for (let i = 0; i < n; i++) {
      let y5 = y[i] ?? 0;
      let errI = 0;
      for (let s = 0; s < 7; s++) {
        const ks = (k[s] ?? [])[i] ?? 0;
        y5 += h * (DOPRI5_B5[s] ?? 0) * ks;
        errI += h * (DOPRI5_E[s] ?? 0) * ks;
      }
      yNew[i] = y5;
      const sc = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(y5));
      err = Math.max(err, Math.abs(errI) / sc);
    }

    if (err <= 1.0) {
      result.acceptedSteps++;
      const tNew = t + h;
      let eventOccurred = false;

      if (eventFunctions && prevEventValues && eventCallback) {
        const newEventValues = [];
        for (const g of eventFunctions) newEventValues.push(await g(tNew, yNew));

        for (let ei = 0; ei < eventFunctions.length; ei++) {
          const prev = prevEventValues[ei] ?? 0;
          const curr = newEventValues[ei] ?? 0;
          const reqDir = eventDirections?.[ei] ?? 0;
          let signChange = false;
          if (prev * curr < 0) {
            if (reqDir === 0) signChange = true;
            else if (reqDir < 0 && prev > 0 && curr < 0) signChange = true;
            else if (reqDir > 0 && prev < 0 && curr > 0) signChange = true;
          }

          if (signChange) {
            eventOccurred = true;
            const eventFn = eventFunctions[ei];
            if (!eventFn) continue;

            const tEvent = await bisectEventAsync(eventFn, t, tNew, y, yNew, k, h, n, prev);
            const thetaEvent = (tEvent - t) / h;
            const yEvent = hermiteInterpolation(y, yNew, k[0] ?? [], k[6] ?? [], h, thetaEvent, n);

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
              if (outputIdx < outputTimes.length && Math.abs((outputTimes[outputIdx] ?? tEnd) - tEvent) < 1e-14) {
                outputIdx++;
              }
            }

            result.times.push(tEvent);
            result.states.push([...yEvent]);

            const dir = curr < 0 ? -1 : 1;
            const yAfter = eventCallback(tEvent, yEvent, ei, dir);

            if (Math.abs(tEvent - lastEventTime) < 1e-6) consecutiveEvents++;
            else {
              consecutiveEvents = 1;
              lastEventTime = tEvent;
            }

            if (consecutiveEvents >= 10) {
              result.times.push(tEvent);
              result.states.push([...yAfter]);
              if (equidistant) {
                while (outputIdx < outputTimes.length) {
                  const tOut = outputTimes[outputIdx] ?? tEnd;
                  if (tOut > tEvent + 1e-14) {
                    result.times.push(tOut);
                    result.states.push([...yAfter]);
                  }
                  outputIdx++;
                }
              } else {
                if (tEnd > tEvent + 1e-14) {
                  result.times.push(tEnd);
                  result.states.push([...yAfter]);
                }
              }
              return result;
            }

            result.times.push(tEvent);
            result.states.push([...yAfter]);

            t = tEvent;
            y = yAfter;
            k1 = await f(t, y);
            result.fEvals++;
            k[0] = k1;

            prevEventValues = await computeEventValuesWithProbeAsync(t, y);
            const t0Out = outputTimes[0] ?? 0;
            const t1Out = outputTimes[1] ?? 0;
            h = Math.min(h, outputTimes.length > 1 ? t1Out - t0Out : h * 0.1);
            break;
          }
        }
      }

      if (!eventOccurred && eventFunctions && prevEventValues) {
        prevEventValues = [];
        for (const g of eventFunctions) prevEventValues.push(await g(tNew, yNew));
      }

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
        k1 = k[6] ?? k1;
        k[0] = k1;
      }

      const factor = err > 0 ? Math.min(5.0, Math.max(0.2, 0.9 * Math.pow(err, -0.2))) : 5.0;
      h = Math.min(h * factor, maxStep);
    } else {
      result.rejectedSteps++;
      const factor = Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      h *= factor;
    }
  }

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

function hermiteInterpolation(
  y: number[],
  yNew: number[],
  k1: number[],
  k7: number[],
  h: number,
  theta: number,
  n: number,
): number[] {
  const theta2 = theta * theta;
  const theta3 = theta2 * theta;

  const h00 = 2 * theta3 - 3 * theta2 + 1;
  const h10 = theta3 - 2 * theta2 + theta;
  const h01 = -2 * theta3 + 3 * theta2;
  const h11 = theta3 - theta2;

  const result = new Array(n) as number[];
  for (let i = 0; i < n; i++) {
    const y0 = y[i] ?? 0;
    const y1 = yNew[i] ?? 0;
    const f0 = (k1[i] ?? 0) * h;
    const f1 = (k7[i] ?? 0) * h;
    result[i] = h00 * y0 + h10 * f0 + h01 * y1 + h11 * f1;
  }
  return result;
}

function bisectEvent(
  eventFn: (t: number, y: number[]) => number,
  tLo: number,
  tHi: number,
  yLo: number[],
  yHi: number[],
  k: number[][],
  h: number,
  n: number,
  gLo: number,
): number {
  const maxIter = 50;
  const tol = 1e-12;

  let lo = tLo;
  let hi = tHi;

  for (let iter = 0; iter < maxIter; iter++) {
    const tMid = (lo + hi) / 2;
    if (hi - lo < tol) break;

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

async function estimateInitialStepAsync(
  f: RhsFunctionAsync,
  t0: number,
  y0: number[],
  atol: number,
  rtol: number,
  maxStep: number,
): Promise<number> {
  const n = y0.length;
  const f0 = await f(t0, y0);
  let d0 = 0,
    d1 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y0[i] ?? 0);
    d0 = Math.max(d0, Math.abs(y0[i] ?? 0) / sc);
    d1 = Math.max(d1, Math.abs(f0[i] ?? 0) / sc);
  }
  let h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * (d0 / d1);
  h0 = Math.min(h0, maxStep);

  const y1 = new Array(n);
  for (let i = 0; i < n; i++) y1[i] = (y0[i] ?? 0) + h0 * (f0[i] ?? 0);
  const f1 = await f(t0 + h0, y1);

  let d2 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y0[i] ?? 0);
    d2 = Math.max(d2, Math.abs(((f1[i] ?? 0) - (f0[i] ?? 0)) / h0) / sc);
  }
  const h1 = Math.max(d1, d2) <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : Math.pow(0.01 / Math.max(d1, d2), 0.2);
  return Math.min(100 * h0, Math.min(h1, maxStep));
}

async function bisectEventAsync(
  eventFn: EventFunctionAsync,
  tLo: number,
  tHi: number,
  yLo: number[],
  yHi: number[],
  k: number[][],
  h: number,
  n: number,
  gLo: number,
): Promise<number> {
  let lo = tLo,
    hi = tHi;
  for (let iter = 0; iter < 50; iter++) {
    const tMid = (lo + hi) / 2;
    if (hi - lo < 1e-12) break;
    const theta = (tMid - tLo) / h;
    const yMid = hermiteInterpolation(yLo, yHi, k[0] ?? [], k[6] ?? [], h, theta, n);
    const gMid = await eventFn(tMid, yMid);
    if (gLo * gMid <= 0) hi = tMid;
    else {
      lo = tMid;
      gLo = gMid;
    }
  }
  return (lo + hi) / 2;
}
