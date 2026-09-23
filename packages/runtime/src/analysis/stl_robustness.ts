// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Dense-Time Signal Temporal Logic (STL) Quantitative Robustness.
 *
 * Implements Donzé & Maler continuous space-time robustness semantics for STL formulas:
 *   - Atomic Predicates: \mu \equiv x ~ c
 *   - Boolean: \neg \phi, \phi_1 \land \phi_2, \phi_1 \lor \phi_2
 *   - Metric Temporal: \Box_{[a, b]} \phi (Always), \Diamond_{[a, b]} \phi (Eventually), \phi_1 \mathcal{U}_{[a, b]} \phi_2 (Until)
 *
 * Provides:
 *  - Exact space-time linear interpolation between discrete simulation samples
 *  - Signed robustness value \rho(\phi, x, t) \in \mathbb{R} where \rho > 0 indicates satisfaction margin
 *    and \rho < 0 indicates violation depth
 *  - Identification of first violation timestamp and critical counterexample witness
 */

export type STLPredicateOperator = "<=" | "<" | ">=" | ">" | "==";

export type STLFormula =
  | {
      type: "predicate";
      name?: string;
      variable: string;
      operator: STLPredicateOperator;
      threshold: number;
    }
  | {
      type: "not";
      formula: STLFormula;
    }
  | {
      type: "and";
      formulas: STLFormula[];
    }
  | {
      type: "or";
      formulas: STLFormula[];
    }
  | {
      type: "always";
      interval: [number, number];
      formula: STLFormula;
    }
  | {
      type: "eventually";
      interval: [number, number];
      formula: STLFormula;
    }
  | {
      type: "until";
      interval: [number, number];
      left: STLFormula;
      right: STLFormula;
    };

export interface STLEvaluationResult {
  isSatisfied: boolean;
  robustness: number;
  violationTime?: number;
  counterexample?: {
    time: number;
    variable: string;
    value: number;
    threshold: number;
  };
  robustnessTrajectory: {
    time: number;
    robustness: number;
  }[];
  explanation: string;
}

/** Interpolates signal value at continuous timestamp t */
export function interpolateSignal(times: number[], values: number[], t: number): number {
  const len = times.length;
  if (len === 0) return 0;
  if (t <= times[0]!) return values[0]!;
  if (t >= times[len - 1]!) return values[len - 1]!;

  // Binary search for interval [times[i], times[i+1]]
  let low = 0;
  let high = len - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid]! <= t) {
      if (mid === len - 1 || times[mid + 1]! > t) {
        const t0 = times[mid]!;
        const t1 = times[mid + 1]!;
        const v0 = values[mid]!;
        const v1 = values[mid + 1]!;
        if (Math.abs(t1 - t0) < 1e-12) return v0;
        const frac = (t - t0) / (t1 - t0);
        return v0 + frac * (v1 - v0);
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return values[0]!;
}

export class STLEvaluator {
  /**
   * Computes the continuous quantitative robustness degree of an STL formula over trajectory data.
   */
  public static evaluate(formula: STLFormula, times: number[], signals: Record<string, number[]>): STLEvaluationResult {
    if (times.length === 0) {
      return {
        isSatisfied: false,
        robustness: -Infinity,
        robustnessTrajectory: [],
        explanation: "Empty trajectory data.",
      };
    }

    const tEnd = times[times.length - 1]!;
    const evalTimes = [...times];

    // Compute pointwise robustness signal across all time points
    const robValues = evalTimes.map((t) => this.evalAtTime(formula, t, times, signals, tEnd));

    const robustnessAtStart = robValues[0]!;
    const isSatisfied = robustnessAtStart >= 0;

    let violationTime: number | undefined = undefined;
    let counterexample: STLEvaluationResult["counterexample"] = undefined;

    // If formula is violated, search for the specific counterexample timestamp
    if (!isSatisfied) {
      const pred = this.findViolatedPredicate(formula, 0, times, signals);
      if (pred) {
        violationTime = pred.time;
        const val = interpolateSignal(times, signals[pred.variable] || [], pred.time);
        counterexample = {
          time: pred.time,
          variable: pred.variable,
          value: val,
          threshold: pred.threshold,
        };
      } else {
        // Fallback to first negative point
        for (let i = 0; i < evalTimes.length; i++) {
          if (robValues[i]! < 0) {
            violationTime = evalTimes[i];
            break;
          }
        }
      }
    }

    const trajectory = evalTimes.map((time, idx) => ({
      time,
      robustness: robValues[idx]!,
    }));

    const explanation = isSatisfied
      ? `STL specification satisfied with minimum margin of +${robustnessAtStart.toFixed(4)}.`
      : `STL specification violated with negative margin ${robustnessAtStart.toFixed(4)}${
          violationTime !== undefined ? ` at t = ${violationTime.toFixed(4)}s` : ""
        }.`;

    return {
      isSatisfied,
      robustness: robustnessAtStart,
      violationTime,
      counterexample,
      robustnessTrajectory: trajectory,
      explanation,
    };
  }

  /**
   * Evaluates \rho(\phi, x, t) recursively.
   */
  private static evalAtTime(
    formula: STLFormula,
    t: number,
    times: number[],
    signals: Record<string, number[]>,
    tEnd: number,
  ): number {
    switch (formula.type) {
      case "predicate": {
        const sig = signals[formula.variable];
        if (!sig || sig.length === 0) return -Infinity;
        const val = interpolateSignal(times, sig, t);
        if (formula.operator === "<=" || formula.operator === "<") {
          return formula.threshold - val;
        } else if (formula.operator === ">=" || formula.operator === ">") {
          return val - formula.threshold;
        } else if (formula.operator === "==") {
          return -Math.abs(val - formula.threshold);
        }
        return -Infinity;
      }

      case "not":
        return -this.evalAtTime(formula.formula, t, times, signals, tEnd);

      case "and": {
        let minR = Infinity;
        for (const sub of formula.formulas) {
          const r = this.evalAtTime(sub, t, times, signals, tEnd);
          if (r < minR) minR = r;
        }
        return minR;
      }

      case "or": {
        let maxR = -Infinity;
        for (const sub of formula.formulas) {
          const r = this.evalAtTime(sub, t, times, signals, tEnd);
          if (r > maxR) maxR = r;
        }
        return maxR;
      }

      case "always": {
        const [a, b] = formula.interval;
        const tStart = Math.min(tEnd, t + a);
        const tStop = Math.min(tEnd, t + b);
        if (tStart > tStop) return Infinity;

        // Sample along [tStart, tStop]
        let infR = Infinity;
        const subTimes = times.filter((tau) => tau >= tStart && tau <= tStop);
        if (!subTimes.includes(tStart)) subTimes.unshift(tStart);
        if (!subTimes.includes(tStop)) subTimes.push(tStop);

        for (const tau of subTimes) {
          const r = this.evalAtTime(formula.formula, tau, times, signals, tEnd);
          if (r < infR) infR = r;
        }
        return infR;
      }

      case "eventually": {
        const [a, b] = formula.interval;
        const tStart = Math.min(tEnd, t + a);
        const tStop = Math.min(tEnd, t + b);
        if (tStart > tStop) return -Infinity;

        let supR = -Infinity;
        const subTimes = times.filter((tau) => tau >= tStart && tau <= tStop);
        if (!subTimes.includes(tStart)) subTimes.unshift(tStart);
        if (!subTimes.includes(tStop)) subTimes.push(tStop);

        for (const tau of subTimes) {
          const r = this.evalAtTime(formula.formula, tau, times, signals, tEnd);
          if (r > supR) supR = r;
        }
        return supR;
      }

      case "until": {
        const [a, b] = formula.interval;
        const tStart = Math.min(tEnd, t + a);
        const tStop = Math.min(tEnd, t + b);
        if (tStart > tStop) return -Infinity;

        let supUntil = -Infinity;
        const subTimes = times.filter((tau) => tau >= tStart && tau <= tStop);
        if (!subTimes.includes(tStart)) subTimes.unshift(tStart);
        if (!subTimes.includes(tStop)) subTimes.push(tStop);

        for (const tau of subTimes) {
          const rRight = this.evalAtTime(formula.right, tau, times, signals, tEnd);

          // left must hold continuously on [t, tau]
          const leftTimes = times.filter((s) => s >= t && s <= tau);
          if (!leftTimes.includes(t)) leftTimes.unshift(t);
          if (!leftTimes.includes(tau)) leftTimes.push(tau);

          let infLeft = Infinity;
          for (const s of leftTimes) {
            const rLeft = this.evalAtTime(formula.left, s, times, signals, tEnd);
            if (rLeft < infLeft) infLeft = rLeft;
          }

          const combined = Math.min(rRight, infLeft);
          if (combined > supUntil) supUntil = combined;
        }
        return supUntil;
      }
    }
  }

  private static findViolatedPredicate(
    formula: STLFormula,
    t: number,
    times: number[],
    signals: Record<string, number[]>,
  ): { variable: string; threshold: number; time: number } | null {
    if (formula.type === "predicate") {
      const sig = signals[formula.variable];
      if (!sig) return null;
      const val = interpolateSignal(times, sig, t);
      if (formula.operator === "<=" || formula.operator === "<") {
        if (val > formula.threshold) return { variable: formula.variable, threshold: formula.threshold, time: t };
      } else if (formula.operator === ">=" || formula.operator === ">") {
        if (val < formula.threshold) return { variable: formula.variable, threshold: formula.threshold, time: t };
      }
      return null;
    }
    if (formula.type === "always") {
      const [a, b] = formula.interval;
      const subTimes = times.filter((tau) => tau >= t + a && tau <= t + b);
      if (!subTimes.includes(t + a)) subTimes.unshift(t + a);
      if (!subTimes.includes(t + b)) subTimes.push(t + b);
      for (const tau of subTimes) {
        const found = this.findViolatedPredicate(formula.formula, tau, times, signals);
        if (found) return found;
      }
      return null;
    }
    if (formula.type === "eventually") {
      return this.findViolatedPredicate(formula.formula, t, times, signals);
    }
    if (formula.type === "and") {
      for (const f of formula.formulas) {
        const found = this.findViolatedPredicate(f, t, times, signals);
        if (found) return found;
      }
    }
    return null;
  }
}
