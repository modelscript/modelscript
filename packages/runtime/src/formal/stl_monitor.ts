// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Signal Temporal Logic (STL) Quantitative Safety Barrier Monitor.
 *
 * Implements Fainekos-Pappas / Donzé-Maler quantitative robustness semantics for Signal
 * Temporal Logic formulas over continuous and discrete cyber-physical trajectories.
 *
 * Robustness Semantics:
 *   rho(g(x) >= c, w, t) = g(w(t)) - c
 *   rho(not phi, w, t) = -rho(phi, w, t)
 *   rho(phi1 and phi2, w, t) = min(rho(phi1, w, t), rho(phi2, w, t))
 *   rho(phi1 or phi2, w, t) = max(rho(phi1, w, t), rho(phi2, w, t))
 *   rho(Always[a, b] phi, w, t) = min_{tau in [t+a, t+b]} rho(phi, w, tau)
 *   rho(Eventually[a, b] phi, w, t) = max_{tau in [t+a, t+b]} rho(phi, w, tau)
 *
 * Property holds iff rho(phi, w, 0) >= 0.
 * If rho < 0, |rho| represents the critical margin of safety violation.
 */

export type StlFormula =
  | { kind: "predicate"; signal: string; op: ">=" | "<=" | ">" | "<"; threshold: number }
  | { kind: "not"; child: StlFormula }
  | { kind: "and"; left: StlFormula; right: StlFormula }
  | { kind: "or"; left: StlFormula; right: StlFormula }
  | { kind: "implies"; antecedent: StlFormula; consequent: StlFormula }
  | { kind: "always"; interval: [number, number]; child: StlFormula }
  | { kind: "eventually"; interval: [number, number]; child: StlFormula }
  | { kind: "until"; interval: [number, number]; left: StlFormula; right: StlFormula };

export interface TrajectoryTrace {
  time: Float64Array;
  signals: Record<string, Float64Array>;
}

export interface StlEvaluationResult {
  robustness: number; // rho at t = 0
  isSatisfied: boolean;
  worstRobustness: number;
  timeOfWorstViolation?: number;
  violationIntervals: [number, number][];
  robustnessTrajectory: Float64Array; // rho(t) for each time point
  diagnosticExplanation?: string;
}

export class StlMonitor {
  /**
   * Helper constructors for fluent STL formula construction.
   */
  public static predicate(signal: string, op: ">=" | "<=" | ">" | "<", threshold: number): StlFormula {
    return { kind: "predicate", signal, op, threshold };
  }

  public static not(child: StlFormula): StlFormula {
    return { kind: "not", child };
  }

  public static and(left: StlFormula, right: StlFormula): StlFormula {
    return { kind: "and", left, right };
  }

  public static or(left: StlFormula, right: StlFormula): StlFormula {
    return { kind: "or", left, right };
  }

  public static implies(antecedent: StlFormula, consequent: StlFormula): StlFormula {
    return { kind: "implies", antecedent, consequent };
  }

  public static always(interval: [number, number], child: StlFormula): StlFormula {
    return { kind: "always", interval, child };
  }

  public static eventually(interval: [number, number], child: StlFormula): StlFormula {
    return { kind: "eventually", interval, child };
  }

  /**
   * Evaluates the quantitative robustness degree rho(phi, trace, t) across all time points.
   */
  public static evaluate(formula: StlFormula, trace: TrajectoryTrace): StlEvaluationResult {
    const N = trace.time.length;
    if (N === 0) {
      throw new Error("Cannot evaluate STL formula on empty trace");
    }

    const rhoProfile = this.evalRobustnessProfile(formula, trace);
    const initialRho = rhoProfile[0]!;
    const isSatisfied = initialRho >= 0;

    // Scan for minimum robustness and violation intervals
    let minRho = Infinity;
    let worstTime = trace.time[0]!;
    const violationIntervals: [number, number][] = [];
    let inViolation = false;
    let vStart = 0;

    for (let i = 0; i < N; i++) {
      const val = rhoProfile[i]!;
      const t = trace.time[i]!;

      if (val < minRho) {
        minRho = val;
        worstTime = t;
      }

      if (val < 0) {
        if (!inViolation) {
          inViolation = true;
          vStart = t;
        }
      } else {
        if (inViolation) {
          inViolation = false;
          violationIntervals.push([vStart, t]);
        }
      }
    }

    if (inViolation) {
      violationIntervals.push([vStart, trace.time[N - 1]!]);
    }

    let explanation: string | undefined;
    if (!isSatisfied) {
      explanation =
        `STL Safety Constraint Violated: margin of safety is negative (${initialRho.toFixed(4)}), ` +
        `worst violation at t = ${worstTime.toFixed(3)}s (robustness = ${minRho.toFixed(4)})`;
    }

    return {
      robustness: initialRho,
      isSatisfied,
      worstRobustness: minRho,
      timeOfWorstViolation: worstTime,
      violationIntervals,
      robustnessTrajectory: rhoProfile,
      diagnosticExplanation: explanation,
    };
  }

  private static evalRobustnessProfile(formula: StlFormula, trace: TrajectoryTrace): Float64Array {
    const N = trace.time.length;
    const time = trace.time;

    switch (formula.kind) {
      case "predicate": {
        const sig = trace.signals[formula.signal];
        if (!sig) {
          throw new Error(`Signal '${formula.signal}' not found in simulation trace`);
        }
        const rho = new Float64Array(N);
        const th = formula.threshold;
        const op = formula.op;

        for (let i = 0; i < N; i++) {
          const val = sig[i]!;
          if (op === ">=" || op === ">") {
            rho[i] = val - th;
          } else {
            rho[i] = th - val;
          }
        }
        return rho;
      }

      case "not": {
        const childRho = this.evalRobustnessProfile(formula.child, trace);
        const rho = new Float64Array(N);
        for (let i = 0; i < N; i++) rho[i] = -childRho[i]!;
        return rho;
      }

      case "and": {
        const lRho = this.evalRobustnessProfile(formula.left, trace);
        const rRho = this.evalRobustnessProfile(formula.right, trace);
        const rho = new Float64Array(N);
        for (let i = 0; i < N; i++) rho[i] = Math.min(lRho[i]!, rRho[i]!);
        return rho;
      }

      case "or": {
        const lRho = this.evalRobustnessProfile(formula.left, trace);
        const rRho = this.evalRobustnessProfile(formula.right, trace);
        const rho = new Float64Array(N);
        for (let i = 0; i < N; i++) rho[i] = Math.max(lRho[i]!, rRho[i]!);
        return rho;
      }

      case "implies": {
        // A => B  <=>  (not A) or B
        const aRho = this.evalRobustnessProfile(formula.antecedent, trace);
        const bRho = this.evalRobustnessProfile(formula.consequent, trace);
        const rho = new Float64Array(N);
        for (let i = 0; i < N; i++) rho[i] = Math.max(-aRho[i]!, bRho[i]!);
        return rho;
      }

      case "always": {
        const childRho = this.evalRobustnessProfile(formula.child, trace);
        const [a, b] = formula.interval;
        const rho = new Float64Array(N);

        for (let i = 0; i < N; i++) {
          const t = time[i]!;
          const tMin = t + a;
          const tMax = t + b;
          let minVal = Infinity;

          // Find range of indices within [tMin, tMax]
          for (let j = i; j < N; j++) {
            const tj = time[j]!;
            if (tj < tMin) continue;
            if (tj > tMax) break;
            if (childRho[j]! < minVal) {
              minVal = childRho[j]!;
            }
          }

          rho[i] = minVal === Infinity ? childRho[N - 1]! : minVal;
        }
        return rho;
      }

      case "eventually": {
        const childRho = this.evalRobustnessProfile(formula.child, trace);
        const [a, b] = formula.interval;
        const rho = new Float64Array(N);

        for (let i = 0; i < N; i++) {
          const t = time[i]!;
          const tMin = t + a;
          const tMax = t + b;
          let maxVal = -Infinity;

          for (let j = i; j < N; j++) {
            const tj = time[j]!;
            if (tj < tMin) continue;
            if (tj > tMax) break;
            if (childRho[j]! > maxVal) {
              maxVal = childRho[j]!;
            }
          }

          rho[i] = maxVal === -Infinity ? childRho[N - 1]! : maxVal;
        }
        return rho;
      }

      case "until": {
        const lRho = this.evalRobustnessProfile(formula.left, trace);
        const rRho = this.evalRobustnessProfile(formula.right, trace);
        const [a, b] = formula.interval;
        const rho = new Float64Array(N);

        for (let i = 0; i < N; i++) {
          const t = time[i]!;
          const tMin = t + a;
          const tMax = t + b;
          let maxUntil = -Infinity;

          for (let j = i; j < N; j++) {
            const tj = time[j]!;
            if (tj < tMin) continue;
            if (tj > tMax) break;

            const rVal = rRho[j]!;
            let minL = Infinity;
            for (let k = i; k <= j; k++) {
              if (lRho[k]! < minL) minL = lRho[k]!;
            }

            const candidate = Math.min(rVal, minL);
            if (candidate > maxUntil) maxUntil = candidate;
          }

          rho[i] = maxUntil === -Infinity ? -Infinity : maxUntil;
        }
        return rho;
      }
    }
  }
}
