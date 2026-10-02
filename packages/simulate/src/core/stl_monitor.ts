// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDefaultWasmExports } from "@modelscript/runtime";

/**
 * @modelscript/simulate — Online Signal Temporal Logic (STL) Robustness Monitor.
 *
 * Implements SOTA continuous quantitative semantics for real-time requirement monitoring
 * during numerical DAE / ODE integration.
 *
 * Characteristics:
 *   - Continuous Piecewise-Linear Signal Interpolation: Eliminates discretization errors
 *     between variable solver time steps.
 *   - Lemire's Monotonic Min/Max Streaming Deque: O(1) amortized sliding window filtering
 *     for forward-looking temporal operators (Globally, Eventually).
 *   - Bounded Until Operator φ_1 U_[a,b] φ_2 support with running prefix-min acceleration.
 *   - Arbitrary formula nesting: e.g. □_[0,10] ♢_[0,2] φ.
 *   - In-WASM zero-copy SIMD/sliding-window acceleration for large trajectory datasets.
 *
 * Robustness Degree ρ(φ, w, t):
 *   ρ > 0: Formula satisfied with safety margin ρ.
 *   ρ = 0: Boundary condition.
 *   ρ < 0: Formula violated by margin |ρ|.
 */

export type STLOp = "predicate" | "not" | "and" | "or" | "globally" | "eventually" | "until";

export interface STLPredicateOptions {
  /** Index in state vector y, or variable name */
  stateIndex?: number;
  /** Variable evaluation function: (t, y) => value */
  evalFn?: (t: number, y: number[] | Float64Array) => number;
  /** Comparison operator */
  operator: "<=" | ">=" | "<" | ">";
  /** Scalar limit threshold */
  threshold: number;
  /** Optional human-readable expression, e.g. "v <= 120.0" */
  expression?: string;
}

export interface STLFormula {
  op: STLOp;
  predicate?: STLPredicateOptions;
  tInterval?: [number, number]; // [t_start, t_end]
  child?: STLFormula;
  left?: STLFormula;
  right?: STLFormula;
}

export interface STLStepResult {
  t: number;
  robustness: number;
  isViolated: boolean;
  shouldTerminate: boolean;
}

export interface STLVerificationResult {
  requirementName?: string;
  isSatisfied: boolean;
  minRobustness: number;
  maxRobustness: number;
  violationTime?: number;
  peakValue?: number;
  sampleCount: number;
}

/**
 * Factory helpers to construct STL formulas.
 */
export const STL = {
  predicate(
    stateIndexOrFn: number | ((t: number, y: number[] | Float64Array) => number),
    op: "<=" | ">=" | "<" | ">",
    threshold: number,
    expr?: string,
  ): STLFormula {
    if (typeof stateIndexOrFn === "number") {
      return {
        op: "predicate",
        predicate: { stateIndex: stateIndexOrFn, operator: op, threshold, expression: expr },
      };
    }
    return {
      op: "predicate",
      predicate: { evalFn: stateIndexOrFn, operator: op, threshold, expression: expr },
    };
  },

  globally(child: STLFormula, tInterval?: [number, number]): STLFormula {
    return { op: "globally", child, tInterval };
  },

  eventually(child: STLFormula, tInterval?: [number, number]): STLFormula {
    return { op: "eventually", child, tInterval };
  },

  and(left: STLFormula, right: STLFormula): STLFormula {
    return { op: "and", left, right };
  },

  or(left: STLFormula, right: STLFormula): STLFormula {
    return { op: "or", left, right };
  },

  not(child: STLFormula): STLFormula {
    return { op: "not", child };
  },

  until(left: STLFormula, right: STLFormula, tInterval?: [number, number]): STLFormula {
    return { op: "until", left, right, tInterval };
  },
};

/**
 * Evaluates the instantaneous point robustness of an atomic predicate.
 * Positive = safe, Negative = violation.
 */
export function evaluatePredicatePoint(
  pred: STLPredicateOptions,
  t: number,
  y: number[] | Float64Array,
): { rho: number; val: number } {
  let val: number;
  if (pred.evalFn) {
    val = pred.evalFn(t, y);
  } else if (pred.stateIndex !== undefined) {
    val = y[pred.stateIndex] ?? 0;
  } else {
    val = 0;
  }

  let rho: number;
  switch (pred.operator) {
    case "<=":
    case "<":
      rho = pred.threshold - val;
      break;
    case ">=":
    case ">":
      rho = val - pred.threshold;
      break;
  }
  return { rho, val };
}

/**
 * Continuous Piecewise Linear Signal Sample: (t, v).
 */
export interface SignalPoint {
  t: number;
  v: number;
}

/**
 * Evaluates a piecewise-linear continuous signal at time t via linear interpolation.
 */
export function sampleSignalPiecewise(signal: SignalPoint[], t: number): number {
  if (signal.length === 0) return 0;
  if (t <= signal[0]!.t) return signal[0]!.v;
  if (t >= signal[signal.length - 1]!.t) return signal[signal.length - 1]!.v;

  let lo = 0;
  let hi = signal.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (signal[mid]!.t <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const p0 = signal[lo]!;
  const p1 = signal[hi]!;
  const dt = p1.t - p0.t;
  if (Math.abs(dt) < 1e-15) return p0.v;
  const alpha = (t - p0.t) / dt;
  return p0.v + alpha * (p1.v - p0.v);
}

/**
 * Lemire's Monotonic Sliding Window Min/Max Filter.
 * Computes min/max over sliding continuous interval [t + a, t + b] in O(1) amortized time.
 */
export class LemireMinMaxQueue {
  private deque: { t: number; v: number }[] = [];

  constructor(private isMin: boolean) {}

  public clear(): void {
    this.deque = [];
  }

  public push(t: number, v: number): void {
    if (this.isMin) {
      while (this.deque.length > 0 && this.deque[this.deque.length - 1]!.v >= v) {
        this.deque.pop();
      }
    } else {
      while (this.deque.length > 0 && this.deque[this.deque.length - 1]!.v <= v) {
        this.deque.pop();
      }
    }
    this.deque.push({ t, v });
  }

  public dropBefore(tWindowStart: number): void {
    while (this.deque.length > 0 && this.deque[0]!.t < tWindowStart) {
      this.deque.shift();
    }
  }

  public peek(): number {
    return this.deque.length > 0 ? this.deque[0]!.v : this.isMin ? Infinity : -Infinity;
  }

  public isEmpty(): boolean {
    return this.deque.length === 0;
  }
}

/**
 * Zero-copy in-WASM evaluation of temporal operators for STL formulas using compiled kernels.
 * Returns null if WASM is unavailable or formula is not accelerated by WASM.
 */
export function evaluateFormulaSignalWasm(
  formula: STLFormula,
  samples: { t: number; y: number[] | Float64Array }[],
  customWasm?: any,
): SignalPoint[] | null {
  const wasm = customWasm ?? getDefaultWasmExports();
  if (!wasm || typeof wasm.stl_eval_always !== "function" || !wasm.memory) {
    return null;
  }
  const N = samples.length;
  if (N === 0) return [];

  const allocate = (size: number): number => {
    if (typeof wasm.__new === "function") return wasm.__new(size, 0);
    if (typeof wasm.alloc === "function") return wasm.alloc(size);
    return 0;
  };

  if (formula.op === "globally" || formula.op === "eventually") {
    const childSig = evaluateFormulaSignal(formula.child!, samples);
    const [a, b] = formula.tInterval ?? [0, Infinity];
    const bFinite = isFinite(b) ? b : childSig[N - 1]!.t - childSig[0]!.t;
    const bytes = N * 8;
    const timePtr = allocate(bytes);
    const valPtr = allocate(bytes);
    const outPtr = allocate(bytes);
    if (!timePtr || !valPtr || !outPtr) return null;

    const memory = wasm.memory as WebAssembly.Memory;
    const timeView = new Float64Array(memory.buffer, timePtr, N);
    const valView = new Float64Array(memory.buffer, valPtr, N);
    const outView = new Float64Array(memory.buffer, outPtr, N);

    for (let i = 0; i < N; i++) {
      timeView[i] = childSig[i]!.t;
      valView[i] = childSig[i]!.v;
    }

    if (formula.op === "globally") {
      wasm.stl_eval_always(timePtr, valPtr, N, a, bFinite, outPtr);
    } else {
      wasm.stl_eval_eventually(timePtr, valPtr, N, a, bFinite, outPtr);
    }

    const res: SignalPoint[] = new Array(N);
    for (let i = 0; i < N; i++) {
      res[i] = { t: timeView[i]!, v: outView[i]! };
    }
    return res;
  }

  if (formula.op === "until") {
    const leftSig = evaluateFormulaSignal(formula.left!, samples);
    const rightSig = evaluateFormulaSignal(formula.right!, samples);
    const [a, b] = formula.tInterval ?? [0, Infinity];
    const bFinite = isFinite(b) ? b : leftSig[N - 1]!.t - leftSig[0]!.t;
    const bytes = N * 8;
    const timePtr = allocate(bytes);
    const lPtr = allocate(bytes);
    const rPtr = allocate(bytes);
    const outPtr = allocate(bytes);
    if (!timePtr || !lPtr || !rPtr || !outPtr) return null;

    const memory = wasm.memory as WebAssembly.Memory;
    const timeView = new Float64Array(memory.buffer, timePtr, N);
    const lView = new Float64Array(memory.buffer, lPtr, N);
    const rView = new Float64Array(memory.buffer, rPtr, N);
    const outView = new Float64Array(memory.buffer, outPtr, N);

    for (let i = 0; i < N; i++) {
      timeView[i] = leftSig[i]!.t;
      lView[i] = leftSig[i]!.v;
      rView[i] = rightSig[i]!.v;
    }

    wasm.stl_eval_until(timePtr, lPtr, rPtr, N, a, bFinite, outPtr);

    const res: SignalPoint[] = new Array(N);
    for (let i = 0; i < N; i++) {
      res[i] = { t: timeView[i]!, v: outView[i]! };
    }
    return res;
  }

  return null;
}

/**
 * Evaluates the full continuous temporal robustness signal for any STL formula over a trajectory.
 * Employs Lemire's O(1) amortized sliding-window monotonic deque for temporal operators
 * and delegates to in-WASM kernels when preferWasm is set.
 */
export function evaluateFormulaSignal(
  formula: STLFormula,
  samples: { t: number; y: number[] | Float64Array }[],
  options?: { preferWasm?: boolean; wasmExports?: any },
): SignalPoint[] {
  if (samples.length === 0) return [];

  if (options?.preferWasm) {
    const wasmRes = evaluateFormulaSignalWasm(formula, samples, options.wasmExports);
    if (wasmRes) return wasmRes;
  }

  switch (formula.op) {
    case "predicate": {
      if (!formula.predicate) return samples.map((s) => ({ t: s.t, v: 0 }));
      return samples.map((s) => ({
        t: s.t,
        v: evaluatePredicatePoint(formula.predicate!, s.t, s.y).rho,
      }));
    }

    case "not": {
      const childSignal = evaluateFormulaSignal(formula.child!, samples, options);
      return childSignal.map((p) => ({ t: p.t, v: -p.v }));
    }

    case "and": {
      const leftSig = evaluateFormulaSignal(formula.left!, samples, options);
      const rightSig = evaluateFormulaSignal(formula.right!, samples, options);
      return leftSig.map((p, idx) => ({
        t: p.t,
        v: Math.min(p.v, rightSig[idx]?.v ?? p.v),
      }));
    }

    case "or": {
      const leftSig = evaluateFormulaSignal(formula.left!, samples, options);
      const rightSig = evaluateFormulaSignal(formula.right!, samples, options);
      return leftSig.map((p, idx) => ({
        t: p.t,
        v: Math.max(p.v, rightSig[idx]?.v ?? p.v),
      }));
    }

    case "globally": {
      const childSig = evaluateFormulaSignal(formula.child!, samples, options);
      const [a, b] = formula.tInterval ?? [0, Infinity];
      const result: SignalPoint[] = [];
      const N = childSig.length;
      if (N === 0) return result;

      const deque: number[] = [];
      let head = 0;
      let right = 0;
      const tMax = childSig[N - 1]!.t;

      for (let i = 0; i < N; i++) {
        const ti = childSig[i]!.t;
        const tStart = ti + a;
        const tEnd = isFinite(b) ? ti + b : tMax;

        // Push internal points with t <= tEnd
        while (right < N && childSig[right]!.t <= tEnd) {
          const v = childSig[right]!.v;
          while (deque.length > head && childSig[deque[deque.length - 1]!]!.v >= v) {
            deque.pop();
          }
          deque.push(right);
          right++;
        }

        // Drop internal points with t < tStart
        while (head < deque.length && childSig[deque[head]!]!.t < tStart) {
          head++;
        }

        let minVal = head < deque.length ? childSig[deque[head]!]!.v : Infinity;

        if (tStart <= tMax) {
          const vStart = sampleSignalPiecewise(childSig, tStart);
          if (vStart < minVal) minVal = vStart;
        }
        if (tEnd <= tMax) {
          const vEnd = sampleSignalPiecewise(childSig, tEnd);
          if (vEnd < minVal) minVal = vEnd;
        }

        if (minVal === Infinity) {
          minVal = childSig[N - 1]!.v;
        }

        result.push({ t: ti, v: minVal });
      }
      return result;
    }

    case "eventually": {
      const childSig = evaluateFormulaSignal(formula.child!, samples, options);
      const [a, b] = formula.tInterval ?? [0, Infinity];
      const result: SignalPoint[] = [];
      const N = childSig.length;
      if (N === 0) return result;

      const deque: number[] = [];
      let head = 0;
      let right = 0;
      const tMax = childSig[N - 1]!.t;

      for (let i = 0; i < N; i++) {
        const ti = childSig[i]!.t;
        const tStart = ti + a;
        const tEnd = isFinite(b) ? ti + b : tMax;

        // Push internal points with t <= tEnd
        while (right < N && childSig[right]!.t <= tEnd) {
          const v = childSig[right]!.v;
          while (deque.length > head && childSig[deque[deque.length - 1]!]!.v <= v) {
            deque.pop();
          }
          deque.push(right);
          right++;
        }

        // Drop internal points with t < tStart
        while (head < deque.length && childSig[deque[head]!]!.t < tStart) {
          head++;
        }

        let maxVal = head < deque.length ? childSig[deque[head]!]!.v : -Infinity;

        if (tStart <= tMax) {
          const vStart = sampleSignalPiecewise(childSig, tStart);
          if (vStart > maxVal) maxVal = vStart;
        }
        if (tEnd <= tMax) {
          const vEnd = sampleSignalPiecewise(childSig, tEnd);
          if (vEnd > maxVal) maxVal = vEnd;
        }

        if (maxVal === -Infinity) {
          maxVal = childSig[N - 1]!.v;
        }

        result.push({ t: ti, v: maxVal });
      }
      return result;
    }

    case "until": {
      const leftSig = evaluateFormulaSignal(formula.left!, samples, options);
      const rightSig = evaluateFormulaSignal(formula.right!, samples, options);
      const [a, b] = formula.tInterval ?? [0, Infinity];
      const result: SignalPoint[] = [];
      const N = leftSig.length;
      if (N === 0) return result;
      const tMax = leftSig[N - 1]!.t;

      for (let i = 0; i < N; i++) {
        const ti = leftSig[i]!.t;
        const tStart = ti + a;
        const tEnd = isFinite(b) ? ti + b : tMax;

        let bestUntil = -Infinity;
        let minRho1 = Infinity;

        for (let j = i; j < N; j++) {
          const tj = rightSig[j]!.t;
          if (leftSig[j]!.v < minRho1) minRho1 = leftSig[j]!.v;

          if (tj >= tStart) {
            if (tj > tEnd) break;
            const cand = Math.min(rightSig[j]!.v, minRho1);
            if (cand > bestUntil) bestUntil = cand;
          }
        }

        result.push({ t: ti, v: bestUntil });
      }
      return result;
    }

    default:
      return samples.map((s) => ({ t: s.t, v: 0 }));
  }
}

/**
 * Streaming Online STL Monitor for ODE/DAE solvers.
 */
export type STLOnlineMonitor = OnlineSTLMonitor;

export class OnlineSTLMonitor {
  private samples: { t: number; y: number[] | Float64Array }[] = [];
  private minRobustness: number = Infinity;
  private maxRobustness: number = -Infinity;
  private violationTime?: number;
  private peakValue?: number;
  private hasViolated: boolean = false;

  private lemireQueue: LemireMinMaxQueue;

  constructor(
    public readonly formula: STLFormula,
    public readonly options: {
      requirementName?: string;
      terminateOnViolation?: boolean;
    } = {},
  ) {
    this.lemireQueue = new LemireMinMaxQueue(formula.op === "globally");
  }

  /**
   * Reset monitor state for a new simulation run.
   */
  public reset(): void {
    this.samples = [];
    this.minRobustness = Infinity;
    this.maxRobustness = -Infinity;
    this.violationTime = undefined;
    this.peakValue = undefined;
    this.hasViolated = false;
    this.lemireQueue.clear();
  }

  /**
   * Step the monitor with a new time and state vector from the solver.
   */
  public step(t: number, y: number[] | Float64Array): STLStepResult {
    // Record sample
    this.samples.push({ t, y: Array.isArray(y) ? [...y] : new Float64Array(y) });

    // Compute point robustness for this timestamp
    const rho = this.evaluateFormulaAt(this.formula, t, y);

    // Update Lemire monotonic queue for streaming sliding window
    this.lemireQueue.push(t, rho);

    if (this.formula.tInterval) {
      const [t0] = this.formula.tInterval;
      if (t >= t0) {
        this.lemireQueue.dropBefore(t0);
      }
    }

    if (rho < this.minRobustness) this.minRobustness = rho;
    if (rho > this.maxRobustness) this.maxRobustness = rho;

    const isViolated = rho < 0;
    if (isViolated && !this.hasViolated) {
      this.hasViolated = true;
      this.violationTime = t;
    }

    return {
      t,
      robustness: rho,
      isViolated,
      shouldTerminate: isViolated && (this.options.terminateOnViolation ?? false),
    };
  }

  /**
   * Evaluates instantaneous point robustness recursively at a specific time point.
   */
  private evaluateFormulaAt(f: STLFormula, t: number, y: number[] | Float64Array): number {
    switch (f.op) {
      case "predicate": {
        if (!f.predicate) return 0;
        const { rho, val } = evaluatePredicatePoint(f.predicate, t, y);
        if (this.peakValue === undefined || Math.abs(val) > Math.abs(this.peakValue)) {
          this.peakValue = val;
        }
        return rho;
      }
      case "not":
        return -this.evaluateFormulaAt(f.child!, t, y);
      case "and":
        return Math.min(this.evaluateFormulaAt(f.left!, t, y), this.evaluateFormulaAt(f.right!, t, y));
      case "or":
        return Math.max(this.evaluateFormulaAt(f.left!, t, y), this.evaluateFormulaAt(f.right!, t, y));
      case "globally": {
        const [t0, t1] = f.tInterval ?? [-Infinity, Infinity];
        if (t < t0 || t > t1) {
          return Infinity;
        }
        return this.evaluateFormulaAt(f.child!, t, y);
      }
      case "eventually": {
        const [t0, t1] = f.tInterval ?? [-Infinity, Infinity];
        if (t < t0 || t > t1) {
          return -Infinity;
        }
        return this.evaluateFormulaAt(f.child!, t, y);
      }
      case "until": {
        return Math.min(this.evaluateFormulaAt(f.left!, t, y), this.evaluateFormulaAt(f.right!, t, y));
      }
      default:
        return 0;
    }
  }

  /**
   * Finalize evaluation and compute exact temporal semantics over the recorded trajectory.
   */
  public finalize(): STLVerificationResult {
    if (this.samples.length === 0) {
      return {
        requirementName: this.options.requirementName,
        isSatisfied: true,
        minRobustness: 0,
        maxRobustness: 0,
        sampleCount: 0,
      };
    }

    const signal = evaluateFormulaSignal(this.formula, this.samples);

    let globalRobustness = Infinity;
    let maxSignalRobustness = -Infinity;
    let earliestViolationTime: number | undefined = undefined;

    if (this.formula.op === "eventually") {
      const [t0, t1] = this.formula.tInterval ?? [-Infinity, Infinity];
      let maxEventual = -Infinity;
      for (const p of signal) {
        if (p.t >= t0 && p.t <= t1) {
          if (p.v > maxEventual) maxEventual = p.v;
        }
      }
      globalRobustness = maxEventual;
    } else if (this.formula.op === "globally") {
      const [t0, t1] = this.formula.tInterval ?? [-Infinity, Infinity];
      let minGlobal = Infinity;
      let hasSampleInInterval = false;
      for (const p of signal) {
        if (p.t >= t0 && p.t <= t1) {
          hasSampleInInterval = true;
          if (p.v < minGlobal) minGlobal = p.v;
          if (p.v < 0 && earliestViolationTime === undefined) {
            earliestViolationTime = p.t;
          }
        }
      }
      globalRobustness = hasSampleInInterval ? minGlobal : 0;
    } else {
      globalRobustness = signal[0]?.v ?? this.minRobustness;
      for (const p of signal) {
        if (p.v < 0 && earliestViolationTime === undefined) {
          earliestViolationTime = p.t;
        }
        if (p.v > maxSignalRobustness) maxSignalRobustness = p.v;
      }
    }

    for (const p of signal) {
      if (p.v > maxSignalRobustness) maxSignalRobustness = p.v;
    }

    const isSatisfied = globalRobustness >= 0;

    return {
      requirementName: this.options.requirementName,
      isSatisfied,
      minRobustness: globalRobustness === Infinity ? 0 : globalRobustness,
      maxRobustness: maxSignalRobustness === -Infinity ? this.maxRobustness : maxSignalRobustness,
      violationTime: isSatisfied ? undefined : (this.violationTime ?? earliestViolationTime),
      peakValue: this.peakValue,
      sampleCount: this.samples.length,
    };
  }

  public finish(): STLVerificationResult {
    return this.finalize();
  }
}
