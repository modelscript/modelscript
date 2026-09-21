// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Online Signal Temporal Logic (STL) Robustness Monitor.
 *
 * Implements quantitative semantics for real-time requirement monitoring
 * during numerical DAE / ODE integration.
 *
 * Robustness Degree ρ(φ, w, t):
 *   ρ > 0: Formula satisfied with safety margin ρ.
 *   ρ = 0: Boundary condition.
 *   ρ < 0: Formula violated by margin |ρ|.
 */

export type STLOp = "predicate" | "not" | "and" | "or" | "globally" | "eventually";

export interface STLPredicateOptions {
  /** Index in state vector y, or variable name */
  stateIndex?: number;
  /** Variable evaluation function: (t, y) => value */
  evalFn?: (t: number, y: number[]) => number;
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
    stateIndexOrFn: number | ((t: number, y: number[]) => number),
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
};

/**
 * Evaluates the instantaneous point robustness of an atomic predicate.
 * Positive = safe, Negative = violation.
 */
function evaluatePredicatePoint(pred: STLPredicateOptions, t: number, y: number[]): { rho: number; val: number } {
  let val: number;
  if (pred.evalFn) {
    val = pred.evalFn(t, y);
  } else if (pred.stateIndex !== undefined) {
    val = y[pred.stateIndex];
  } else {
    val = 0;
  }

  let rho: number;
  switch (pred.operator) {
    case "<=":
    case "<":
      // Safe when val <= threshold -> margin is (threshold - val)
      rho = pred.threshold - val;
      break;
    case ">=":
    case ">":
      // Safe when val >= threshold -> margin is (val - threshold)
      rho = val - pred.threshold;
      break;
  }
  return { rho, val };
}

/**
 * Streaming Online STL Monitor for ODE/DAE solvers.
 */
export type STLOnlineMonitor = OnlineSTLMonitor;

export class OnlineSTLMonitor {
  private samples: { t: number; y: number[] }[] = [];
  private minRobustness: number = Infinity;
  private maxRobustness: number = -Infinity;
  private violationTime?: number;
  private peakValue?: number;
  private hasViolated: boolean = false;

  constructor(
    public readonly formula: STLFormula,
    public readonly options: {
      requirementName?: string;
      terminateOnViolation?: boolean;
    } = {},
  ) {}

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
  }

  /**
   * Step the monitor with a new time and state vector from the solver.
   */
  public step(t: number, y: number[]): STLStepResult {
    // Record sample
    this.samples.push({ t, y: [...y] });

    // Compute point robustness for this timestamp
    const rho = this.evaluateFormulaAt(this.formula, t, y);

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
   * Evaluates robustness recursively at a specific time point.
   */
  private evaluateFormulaAt(f: STLFormula, t: number, y: number[]): number {
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
        // Globally: inside the interval [t_start, t_end], must satisfy child
        const [t0, t1] = f.tInterval ?? [-Infinity, Infinity];
        if (t < t0 || t > t1) {
          // Outside interval, globally condition is vacuous
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
      default:
        return 0;
    }
  }

  /**
   * Finalize the evaluation and return the complete verification result.
   */
  public finalize(): STLVerificationResult {
    // For formulas with temporal operators over history (e.g. globally or eventually)
    let globalRobustness = this.minRobustness;

    if (this.formula.op === "eventually") {
      // Eventually over interval requires at least one positive sample within interval
      const [t0, t1] = this.formula.tInterval ?? [-Infinity, Infinity];
      let maxEventual = -Infinity;
      for (const s of this.samples) {
        if (s.t >= t0 && s.t <= t1) {
          const r = this.evaluateFormulaAt(this.formula.child!, s.t, s.y);
          if (r > maxEventual) maxEventual = r;
        }
      }
      globalRobustness = maxEventual;
    } else if (this.formula.op === "globally") {
      const [t0, t1] = this.formula.tInterval ?? [-Infinity, Infinity];
      let minGlobal = Infinity;
      let hasSampleInInterval = false;
      for (const s of this.samples) {
        if (s.t >= t0 && s.t <= t1) {
          hasSampleInInterval = true;
          const r = this.evaluateFormulaAt(this.formula.child!, s.t, s.y);
          if (r < minGlobal) minGlobal = r;
        }
      }
      globalRobustness = hasSampleInInterval ? minGlobal : 0;
    }

    const isSatisfied = globalRobustness >= 0;

    return {
      requirementName: this.options.requirementName,
      isSatisfied,
      minRobustness: globalRobustness === Infinity ? 0 : globalRobustness,
      maxRobustness: this.maxRobustness === -Infinity ? 0 : this.maxRobustness,
      violationTime: this.violationTime,
      peakValue: this.peakValue,
      sampleCount: this.samples.length,
    };
  }

  public finish(): STLVerificationResult {
    return this.finalize();
  }
}
