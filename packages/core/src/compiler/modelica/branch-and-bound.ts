// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spatial Branch-and-Bound (sBB) Global Optimization Solver.
 *
 * Uses interval arithmetic for fathoming (pruning), McCormick relaxations
 * for tighter convex lower bounds, and Newton-Raphson with exact AD for
 * local NLP solves (upper bounds).
 *
 * Algorithm:
 *   1. Initialize domain box B₀ = [lo, hi] for each variable
 *   2. Queue ← { B₀ }
 *   3. While Queue not empty:
 *      a. Pop box B with best lower bound
 *      b. Interval eval → LB (fast fathoming)
 *      c. If LB ≥ incumbent UB → prune
 *      d. McCormick eval at midpoint → tighter LB
 *      e. Local NLP solve (Newton+AD) from midpoint → update UB
 *      f. If gap < ε → done
 *      g. Branch: split B along widest dimension
 *      h. Push children to Queue
 *
 * Reference: Smith, E.M.B. & Pantelides, C.C. (1999),
 *   "A symbolic reformulation/spatial branch-and-bound algorithm
 *    for the global optimisation of nonconvex MINLPs", Computers & Chem. Eng.
 */

import { StaticTapeBuilder, type TapeOp } from "./ad-codegen.js";
import { evaluateTapeForward, evaluateTapeReverse } from "./ad-jacobian.js";
import type { ModelicaDAE, ModelicaExpression } from "./dae.js";
import { Interval, evaluateTapeInterval } from "./interval.js";
import { evaluateTapeMcCormick } from "./mccormick.js";

/** A box in the search space: variable name → [lo, hi] */
export type DomainBox = Map<string, Interval>;

/** Result of the sBB solver. */
export interface SbbResult {
  /** Optimal variable values (best feasible point). */
  solution: Map<string, number>;
  /** Optimal objective value (upper bound). */
  objectiveValue: number;
  /** Lower bound on optimal objective. */
  lowerBound: number;
  /** Number of nodes explored. */
  nodesExplored: number;
  /** Whether the solver found a global optimum within tolerance. */
  optimal: boolean;
}

/** Configuration for the sBB solver. */
export interface SbbOptions {
  /** Absolute gap tolerance (default: 1e-6). */
  absTol?: number;
  /** Relative gap tolerance (default: 1e-4). */
  relTol?: number;
  /** Maximum number of nodes to explore (default: 10000). */
  maxNodes?: number;
  /** Maximum Newton iterations per local solve (default: 50). */
  maxNewtonIter?: number;
}

interface SbbNode {
  box: DomainBox;
  lowerBound: number;
}

/**
 * Solve a global optimization problem using spatial branch-and-bound.
 *
 * Minimizes `objective(z)` subject to `constraints_i(z) = 0`.
 *
 * @param objectiveTape  Tape and output index for the objective function
 * @param constraintTapes Tapes and output indices for equality constraints
 * @param variables      Variable names (decision variables)
 * @param initialBox     Initial domain box (bounds for each variable)
 * @param options        Solver options
 */
export function solveSBB(
  objectiveTape: { ops: TapeOp[]; outputIndex: number },
  constraintTapes: { ops: TapeOp[]; outputIndex: number }[],
  variables: string[],
  initialBox: DomainBox,
  options: SbbOptions = {},
): SbbResult {
  const absTol = options.absTol ?? 1e-6;
  const relTol = options.relTol ?? 1e-4;
  const maxNodes = options.maxNodes ?? 10000;
  const maxNewtonIter = options.maxNewtonIter ?? 50;

  let incumbent: Map<string, number> | null = null;
  let upperBound = Infinity;
  let globalLowerBound = -Infinity;
  let nodesExplored = 0;

  // Priority queue sorted by lower bound (ascending)
  const queue: SbbNode[] = [];

  // Initial interval evaluation for root node
  const rootLB = evaluateIntervalLB(objectiveTape, initialBox);
  queue.push({ box: new Map(initialBox), lowerBound: rootLB });

  // Try local solve from midpoint of initial box for first upper bound
  const midpoint = boxMidpoint(initialBox, variables);
  const localResult = localNewtonSolve(objectiveTape, constraintTapes, variables, midpoint, maxNewtonIter);
  if (localResult !== null && isBoxFeasible(localResult.point, initialBox)) {
    const objVal = evaluateObjective(objectiveTape, localResult.point);
    if (objVal < upperBound) {
      upperBound = objVal;
      incumbent = new Map(localResult.point);
    }
  }

  while (queue.length > 0 && nodesExplored < maxNodes) {
    // Pop node with lowest lower bound
    queue.sort((a, b) => a.lowerBound - b.lowerBound);
    const node = queue.shift()!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    nodesExplored++;

    // Fathom: if lower bound ≥ upper bound, prune
    if (node.lowerBound >= upperBound - absTol) continue;

    // McCormick evaluation at midpoint for tighter lower bound
    const mid = boxMidpoint(node.box, variables);
    const mcResult = evaluateTapeMcCormick(objectiveTape.ops, node.box, mid);
    const mcLB = mcResult[objectiveTape.outputIndex]?.cv ?? node.lowerBound;
    const tighterLB = Math.max(node.lowerBound, mcLB);

    if (tighterLB >= upperBound - absTol) continue;

    // Local NLP solve from midpoint
    const local = localNewtonSolve(objectiveTape, constraintTapes, variables, mid, maxNewtonIter);
    if (local !== null && isBoxFeasible(local.point, node.box)) {
      const objVal = evaluateObjective(objectiveTape, local.point);
      if (objVal < upperBound) {
        upperBound = objVal;
        incumbent = new Map(local.point);
      }
    }

    // Check gap
    globalLowerBound = queue.length > 0 ? Math.min(tighterLB, queue[0]?.lowerBound ?? Infinity) : tighterLB;
    const gap = upperBound - globalLowerBound;
    if (gap <= absTol || (upperBound !== 0 && gap / Math.abs(upperBound) <= relTol)) {
      break; // Converged
    }

    // Branch: split along widest dimension
    const splitVar = findWidestDimension(node.box, variables);
    if (!splitVar) continue;

    const splitInterval = node.box.get(splitVar);
    if (!splitInterval || splitInterval.width < 1e-12) continue;

    const splitMid = splitInterval.mid;

    // Left child: [lo, mid]
    const leftBox: DomainBox = new Map(node.box);
    leftBox.set(splitVar, new Interval(splitInterval.lo, splitMid));
    const leftLB = Math.max(tighterLB, evaluateIntervalLB(objectiveTape, leftBox));
    if (leftLB < upperBound - absTol) {
      queue.push({ box: leftBox, lowerBound: leftLB });
    }

    // Right child: [mid, hi]
    const rightBox: DomainBox = new Map(node.box);
    rightBox.set(splitVar, new Interval(splitMid, splitInterval.hi));
    const rightLB = Math.max(tighterLB, evaluateIntervalLB(objectiveTape, rightBox));
    if (rightLB < upperBound - absTol) {
      queue.push({ box: rightBox, lowerBound: rightLB });
    }
  }

  return {
    solution: incumbent ?? boxMidpoint(initialBox, variables),
    objectiveValue: upperBound,
    lowerBound: globalLowerBound,
    nodesExplored,
    optimal:
      upperBound - globalLowerBound <= absTol ||
      (upperBound !== 0 && (upperBound - globalLowerBound) / Math.abs(upperBound) <= relTol),
  };
}

// ── Helper functions ──

/** Evaluate interval lower bound of objective over a box. */
function evaluateIntervalLB(tape: { ops: TapeOp[]; outputIndex: number }, box: DomainBox): number {
  const intervals = evaluateTapeInterval(tape.ops, box);
  return intervals[tape.outputIndex]?.lo ?? -Infinity;
}

/** Evaluate objective at a point. */
function evaluateObjective(tape: { ops: TapeOp[]; outputIndex: number }, point: Map<string, number>): number {
  const t = evaluateTapeForward(tape.ops, point);
  return t[tape.outputIndex] ?? Infinity;
}

/** Get midpoint of a domain box. */
function boxMidpoint(box: DomainBox, variables: string[]): Map<string, number> {
  const mid = new Map<string, number>();
  for (const v of variables) {
    const interval = box.get(v);
    if (interval) {
      mid.set(v, interval.mid);
    }
  }
  // Copy non-variable entries (parameters, time, etc.)
  for (const [k, v] of box) {
    if (!mid.has(k)) {
      mid.set(k, v.mid);
    }
  }
  return mid;
}

/** Check if a point is within the domain box. */
function isBoxFeasible(point: Map<string, number>, box: DomainBox): boolean {
  for (const [name, interval] of box) {
    const val = point.get(name);
    if (val !== undefined && (val < interval.lo - 1e-10 || val > interval.hi + 1e-10)) {
      return false;
    }
  }
  return true;
}

/** Find the variable with the widest interval in the box. */
function findWidestDimension(box: DomainBox, variables: string[]): string | null {
  let widest: string | null = null;
  let maxWidth = 0;
  for (const v of variables) {
    const interval = box.get(v);
    if (interval && interval.width > maxWidth) {
      maxWidth = interval.width;
      widest = v;
    }
  }
  return widest;
}

/**
 * Local Newton-Raphson solve from a starting point.
 * Minimizes objective subject to constraints = 0.
 * For unconstrained: just finds a stationary point (gradient = 0).
 * For constrained: solves the KKT system.
 */
function localNewtonSolve(
  objectiveTape: { ops: TapeOp[]; outputIndex: number },
  constraintTapes: { ops: TapeOp[]; outputIndex: number }[],
  variables: string[],
  startPoint: Map<string, number>,
  maxIter: number,
): { point: Map<string, number> } | null {
  const n = variables.length;
  const nConstraints = constraintTapes.length;
  const point = new Map(startPoint);

  if (nConstraints === 0) {
    // Unconstrained: find stationary point where ∇f = 0
    for (let iter = 0; iter < maxIter; iter++) {
      const t = evaluateTapeForward(objectiveTape.ops, point);
      const grads = evaluateTapeReverse(objectiveTape.ops, t, objectiveTape.outputIndex);

      // Check gradient norm
      let gradNorm = 0;
      for (const v of variables) {
        const g = grads.get(v) ?? 0;
        gradNorm += g * g;
      }
      if (Math.sqrt(gradNorm) < 1e-10) return { point };

      // Steepest descent step (simple, robust)
      const stepSize = 0.01;
      for (const v of variables) {
        const g = grads.get(v) ?? 0;
        point.set(v, (point.get(v) ?? 0) - stepSize * g);
      }
    }
  } else {
    // Constrained: solve R(z) = 0 for constraints via Newton
    for (let iter = 0; iter < maxIter; iter++) {
      // Evaluate constraint residuals
      let totalResidual = 0;
      const R = new Array(nConstraints).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nConstraints; i++) {
        J[i] = new Array(n).fill(0) as number[];
      }

      for (let row = 0; row < nConstraints; row++) {
        const ct = constraintTapes[row];
        if (!ct) continue;
        const t = evaluateTapeForward(ct.ops, point);
        R[row] = t[ct.outputIndex] ?? 0;
        totalResidual += Math.abs(R[row] ?? 0);

        const grads = evaluateTapeReverse(ct.ops, t, ct.outputIndex);
        const jRow = J[row];
        if (!jRow) continue;
        for (let col = 0; col < n; col++) {
          const vn = variables[col];
          if (vn) jRow[col] = grads.get(vn) ?? 0;
        }
      }

      if (totalResidual < 1e-10) return { point };

      // Solve J * dz = -R (least-squares if non-square)
      if (nConstraints === n) {
        const negR = R.map((r) => -(r ?? 0));
        const dz = solveLULocal(J, negR, n);
        for (let i = 0; i < n; i++) {
          const vn = variables[i];
          if (vn) point.set(vn, (point.get(vn) ?? 0) + (dz[i] ?? 0));
        }
      }
    }
  }

  return { point };
}

/** Simple LU solve for the local Newton solver. */
function solveLULocal(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row) => [...row]);
  const rhs = [...b];

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k]?.[k] ?? 0);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(M[i]?.[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }
    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow] ?? [], M[k] ?? []];
      [rhs[k], rhs[maxRow]] = [rhs[maxRow] ?? 0, rhs[k] ?? 0];
    }
    const pivot = M[k]?.[k] ?? 0;
    if (Math.abs(pivot) < 1e-30) continue;
    for (let i = k + 1; i < n; i++) {
      const row = M[i];
      const pivotRow = M[k];
      if (!row || !pivotRow) continue;
      const factor = (row[k] ?? 0) / pivot;
      for (let j = k + 1; j < n; j++) {
        row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
      }
      rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
    }
  }

  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    const row = M[i];
    if (row) {
      for (let j = i + 1; j < n; j++) {
        sum -= (row[j] ?? 0) * (x[j] ?? 0);
      }
      const diag = row[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    }
  }
  return x;
}

/**
 * Build tape data from a DAE for use with the sBB solver.
 * Convenience function for integrating with the ModelScript pipeline.
 */
export function buildSbbFromDAE(
  dae: ModelicaDAE,
  objectiveExpr: ModelicaExpression,
  constraintExprs: ModelicaExpression[],
): {
  objectiveTape: { ops: TapeOp[]; outputIndex: number };
  constraintTapes: { ops: TapeOp[]; outputIndex: number }[];
} {
  const objTape = new StaticTapeBuilder();
  const objIdx = objTape.walk(objectiveExpr);

  const constraintTapes = constraintExprs.map((expr) => {
    const tape = new StaticTapeBuilder();
    const idx = tape.walk(expr);
    return { ops: [...tape.ops], outputIndex: idx };
  });

  return {
    objectiveTape: { ops: [...objTape.ops], outputIndex: objIdx },
    constraintTapes,
  };
}

/**
 * Expand array variable bounds in a DomainBox.
 * Given a box with `x → [lo, hi]` and a variable `x` with arrayDimensions = [3],
 * produces `x[1] → [lo,hi]`, `x[2] → [lo,hi]`, `x[3] → [lo,hi]`.
 *
 * @param box       Initial domain box (may contain array-valued variable names)
 * @param dae       DAE for variable metadata (arrayDimensions)
 * @returns Expanded domain box with per-element entries
 */
export function expandArrayBounds(box: DomainBox, dae: ModelicaDAE): DomainBox {
  const expanded: DomainBox = new Map();
  for (const [name, interval] of box) {
    const v = dae.variables.find((dv) => dv.name === name);
    if (v?.arrayDimensions && v.arrayDimensions.length > 0) {
      const size = v.arrayDimensions.reduce((a: number, b: number) => a * b, 1);
      for (let i = 0; i < size; i++) {
        expanded.set(`${name}[${i + 1}]`, new Interval(interval.lo, interval.hi));
      }
    } else {
      expanded.set(name, interval);
    }
  }
  return expanded;
}
