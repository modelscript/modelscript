// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — In-Process Non-linear Real Arithmetic (QF_NRA) SMT Solver.
 *
 * Implements SMT solving for non-linear polynomial systems in SysML v2:
 *   1. Gröbner Basis Pre-Reduction (Buchberger's Algorithm via wasm_groebner)
 *      Detects algebraic inconsistency (1 \in GB) and triangularizes coupled equalities.
 *   2. Interval Constraint Propagation (ICP) & Spatial Branch-and-Bound (sBB)
 *      Prunes infeasible hyper-rectangles using interval arithmetic bounds.
 *   3. Real Witness Synthesis for Satisfiable (SAT) models.
 */

import { computeGroebnerBasis, Polynomial, reduceGroebnerBasis, Term } from "@modelscript/runtime";

export type NRAPredicateOp = "==" | "<=" | "<" | ">=" | ">";

export interface NRAPolynomialConstraint {
  polynomial: Polynomial;
  op: NRAPredicateOp;
}

export interface NRASolverOptions {
  variables: Record<string, [number, number]>; // [min, max] domain bounds
  constraints: NRAPolynomialConstraint[];
  tolerance?: number;
  maxIterations?: number;
}

export interface NRASolverResult {
  status: "sat" | "unsat" | "unknown";
  model?: Record<string, number>;
  groebnerBasis?: Polynomial[];
  explanation: string;
}

/** Evaluates a term at a concrete point */
function evalTerm(t: Term, pt: Record<string, number>): number {
  let val = t.coefficient;
  for (const [v, d] of t.degrees.entries()) {
    const x = pt[v] ?? 0;
    val *= Math.pow(x, d);
  }
  return val;
}

/** Evaluates a polynomial at a concrete point */
export function evalPolynomial(p: Polynomial, pt: Record<string, number>): number {
  let sum = 0;
  for (const t of p.terms) {
    sum += evalTerm(t, pt);
  }
  return sum;
}

/** Interval bounds for a variable */
interface IntervalRange {
  lo: number;
  hi: number;
}

/** Multiplies two intervals safely handling 0 * infinity */
function mulInterval(tLo: number, tHi: number, pLo: number, pHi: number): IntervalRange {
  if (tLo === 0 && tHi === 0) return { lo: 0, hi: 0 };
  if (pLo === 0 && pHi === 0) return { lo: 0, hi: 0 };

  const products: number[] = [];
  for (const t of [tLo, tHi]) {
    for (const p of [pLo, pHi]) {
      if (t === 0 || p === 0) {
        products.push(0);
      } else {
        const prod = t * p;
        if (!isNaN(prod)) products.push(prod);
      }
    }
  }
  if (products.length === 0) return { lo: -Infinity, hi: Infinity };
  return { lo: Math.min(...products), hi: Math.max(...products) };
}

/** Evaluates a polynomial range over a domain box */
function evalPolyInterval(p: Polynomial, box: Map<string, IntervalRange>): IntervalRange {
  let minVal = 0;
  let maxVal = 0;

  for (const t of p.terms) {
    if (Math.abs(t.coefficient) < 1e-15) continue;
    let tMin = t.coefficient;
    let tMax = t.coefficient;

    for (const [v, d] of t.degrees.entries()) {
      const b = box.get(v) ?? { lo: -Infinity, hi: Infinity };
      // Power range for b^d
      let pMin: number;
      let pMax: number;

      if (d % 2 === 0) {
        // Even power: values are non-negative
        if (b.lo <= 0 && b.hi >= 0) {
          pMin = 0;
          pMax = Math.pow(Math.max(Math.abs(b.lo), Math.abs(b.hi)), d);
        } else {
          const val1 = Math.pow(b.lo, d);
          const val2 = Math.pow(b.hi, d);
          pMin = Math.min(val1, val2);
          pMax = Math.max(val1, val2);
        }
      } else {
        // Odd power
        pMin = Math.pow(b.lo, d);
        pMax = Math.pow(b.hi, d);
      }

      const mult = mulInterval(tMin, tMax, pMin, pMax);
      tMin = mult.lo;
      tMax = mult.hi;
    }

    minVal += tMin;
    maxVal += tMax;
  }

  return { lo: minVal, hi: maxVal };
}

/** Evaluates partial derivative of polynomial with respect to variable v at point pt */
function evalPolyPartialDerivative(p: Polynomial, v: string, pt: Record<string, number>): number {
  let sum = 0;
  for (const t of p.terms) {
    const d = t.degrees.get(v) ?? 0;
    if (d <= 0) continue;
    let termVal = t.coefficient * d;
    for (const [varName, deg] of t.degrees.entries()) {
      const currentDeg = varName === v ? deg - 1 : deg;
      if (currentDeg > 0) {
        termVal *= Math.pow(pt[varName] ?? 0, currentDeg);
      }
    }
    sum += termVal;
  }
  return sum;
}

export class SysML2NRASolver {
  /**
   * Solves a QF_NRA polynomial constraint satisfaction problem.
   */
  public static solve(options: NRASolverOptions): NRASolverResult {
    const { variables, constraints } = options;
    const tol = options.tolerance ?? 1e-6;
    const maxIter = options.maxIterations ?? 1000;

    const varNames = Object.keys(variables);

    // 1. Gröbner Basis Pre-Reduction on Equalities
    const equalities = constraints.filter((c) => c.op === "==").map((c) => c.polynomial);
    let reducedBasis: Polynomial[] | undefined = undefined;

    if (equalities.length > 0) {
      try {
        const basis = computeGroebnerBasis(equalities, varNames);
        reducedBasis = reduceGroebnerBasis(basis, varNames);

        // Check if 1 \in GB (constant non-zero polynomial)
        for (const p of reducedBasis) {
          if (p.terms.length === 1 && p.terms[0]!.totalDegree() === 0) {
            if (Math.abs(p.terms[0]!.coefficient) > 1e-10) {
              return {
                status: "unsat",
                groebnerBasis: reducedBasis,
                explanation: `Gröbner basis reduction produced constant contradiction: ${p.terms[0]!.coefficient} == 0. Equality constraints have no common complex/real solution.`,
              };
            }
          }
        }
      } catch {
        // Fallback to pure interval branch and bound if Gröbner exceeds ring capacity
      }
    }

    // 2. Spatial Branch-and-Bound / Interval Constraint Propagation
    const initialBox = new Map<string, IntervalRange>();
    for (const [v, bounds] of Object.entries(variables)) {
      initialBox.set(v, { lo: bounds[0], hi: bounds[1] });
    }

    const queue: Map<string, IntervalRange>[] = [initialBox];
    let iterations = 0;
    let hasSmallFeasibleBox = false;
    let fallbackCandidate: Record<string, number> | undefined = undefined;

    const checkPointSatisfies = (pt: Record<string, number>, pointTol = tol): boolean => {
      for (const [v, [vLo, vHi]] of Object.entries(variables)) {
        const val = pt[v] ?? 0;
        if (val < vLo - pointTol || val > vHi + pointTol) return false;
      }
      for (const c of constraints) {
        const val = evalPolynomial(c.polynomial, pt);
        if (c.op === "==" && Math.abs(val) > pointTol) return false;
        else if ((c.op === "<=" || c.op === "<") && val > pointTol) return false;
        else if ((c.op === ">=" || c.op === ">") && val < -pointTol) return false;
      }
      return true;
    };

    while (queue.length > 0 && iterations < maxIter) {
      iterations++;
      const currentBox = queue.pop()!;

      // Check each constraint on the current box
      let feasible = true;
      for (const c of constraints) {
        const rng = evalPolyInterval(c.polynomial, currentBox);

        if (c.op === "==") {
          if (rng.lo > tol || rng.hi < -tol) {
            feasible = false;
            break;
          }
        } else if (c.op === "<=" || c.op === "<") {
          if (rng.lo > tol) {
            feasible = false;
            break;
          }
        } else if (c.op === ">=" || c.op === ">") {
          if (rng.hi < -tol) {
            feasible = false;
            break;
          }
        }
      }

      if (!feasible) {
        continue; // Pruned box
      }

      // Check center of box as candidate witness
      const candidatePoint: Record<string, number> = {};
      let maxEdge = 0;
      let splitVar = varNames[0]!;

      for (const v of varNames) {
        const b = currentBox.get(v) ?? { lo: 0, hi: 0 };
        candidatePoint[v] = 0.5 * (b.lo + b.hi);
        const width = b.hi - b.lo;
        if (width > maxEdge) {
          maxEdge = width;
          splitVar = v;
        }
      }

      // 1. Direct candidate point satisfaction
      if (checkPointSatisfies(candidatePoint)) {
        return {
          status: "sat",
          model: candidatePoint,
          groebnerBasis: reducedBasis,
          explanation: `Satisfying real witness found in ${iterations} iterations with tolerance ${tol}.`,
        };
      }

      // 2. Local Newton refinement for candidate point
      const refinedPoint = { ...candidatePoint };
      let newtonSteps = 0;
      while (newtonSteps < 5) {
        newtonSteps++;
        let maxCorrection = 0;
        for (const c of constraints) {
          if (c.op !== "==") continue;
          const val = evalPolynomial(c.polynomial, refinedPoint);
          if (Math.abs(val) <= tol) continue;

          for (const v of varNames) {
            const deriv = evalPolyPartialDerivative(c.polynomial, v, refinedPoint);
            if (Math.abs(deriv) > 1e-12) {
              const delta = -val / deriv;
              const b = currentBox.get(v) ?? { lo: -Infinity, hi: Infinity };
              const clamped = Math.max(b.lo, Math.min(b.hi, refinedPoint[v]! + delta));
              const change = Math.abs(clamped - refinedPoint[v]!);
              refinedPoint[v] = clamped;
              if (change > maxCorrection) maxCorrection = change;
            }
          }
        }
        if (maxCorrection < 1e-12) break;
      }

      if (checkPointSatisfies(refinedPoint)) {
        return {
          status: "sat",
          model: refinedPoint,
          groebnerBasis: reducedBasis,
          explanation: `Satisfying real witness found via local refinement in ${iterations} iterations with tolerance ${tol}.`,
        };
      }

      // Subdivide widest dimension
      if (maxEdge > tol) {
        const b = currentBox.get(splitVar)!;
        const mid = 0.5 * (b.lo + b.hi);

        const leftBox = new Map(currentBox);
        leftBox.set(splitVar, { lo: b.lo, hi: mid });

        const rightBox = new Map(currentBox);
        rightBox.set(splitVar, { lo: mid, hi: b.hi });

        queue.push(leftBox);
        queue.push(rightBox);
      } else {
        hasSmallFeasibleBox = true;
        if (!fallbackCandidate) {
          fallbackCandidate = refinedPoint;
        }
      }
    }

    if (queue.length === 0) {
      if (hasSmallFeasibleBox && fallbackCandidate) {
        return {
          status: "unknown",
          model: fallbackCandidate,
          groebnerBasis: reducedBasis,
          explanation: `Candidate solution box reached tolerance limit ${tol}, but exact point witness could not be refined further.`,
        };
      }

      return {
        status: "unsat",
        groebnerBasis: reducedBasis,
        explanation: `Interval branch-and-bound exhausted search space without finding feasible real points. Unsatisfiable under given domain bounds.`,
      };
    }

    return {
      status: "unknown",
      model: fallbackCandidate,
      groebnerBasis: reducedBasis,
      explanation: `Search bound reached (${maxIter} iterations). Inconclusive within tolerance ${tol}.`,
    };
  }
}
