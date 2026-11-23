// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two-Phase Simplex LP Solver for CPLEX LP / LINDO models.
 *
 * Handles:
 * - Minimize and Maximize objectives
 * - `<=`, `>=`, and `=` constraints
 * - Arbitrary lower/upper variable bounds, fixed variables, and free variables
 * - Two-phase simplex with Dantzig pricing + Bland's anti-cycling fallback
 */

import type { ConstraintSense, CplexLpModel } from "../types.js";

export type SolverStatus = "optimal" | "infeasible" | "unbounded" | "iteration_limit";

export interface LpSolveOptions {
  maxIterations?: number | undefined;
  tolerance?: number | undefined;
  /** Optional bound overrides (used by Branch-and-Bound MIP solver). */
  boundOverrides?: Map<string, { lower: number; upper: number }> | undefined;
}

export interface LpSolution {
  status: SolverStatus;
  objectiveValue: number;
  values: Record<string, number>;
  iterations: number;
}

interface VarTransform {
  origName: string;
  kind: "fixed" | "shifted_pos" | "shifted_neg" | "split";
  offset: number;
  posCol: number; // >= 0 for shifted_pos / split
  negCol: number; // >= 0 for shifted_neg / split
}

interface StandardConstraint {
  coeffs: Map<number, number>;
  sense: ConstraintSense;
  rhs: number;
}

const EPS = 1e-9;

function runSimplexPhase(
  tableau: Float64Array[],
  basis: Int32Array,
  numRows: number,
  numCols: number,
  maxIterations: number,
): { status: "optimal" | "unbounded" | "iteration_limit"; iterations: number } {
  const rhsCol = numCols;
  const objRow = tableau[numRows]!;
  let iterations = 0;
  let stallCount = 0;
  let lastObj = objRow[rhsCol]!;

  while (iterations < maxIterations) {
    // Choose entering column: Dantzig normally, Bland's rule if stalled
    const useBland = stallCount >= 20;
    let enterCol = -1;
    let bestReduced = -1e-9;

    for (let j = 0; j < numCols; j++) {
      const rc = objRow[j]!;
      if (rc < -1e-9) {
        if (useBland) {
          enterCol = j;
          break;
        }
        if (rc < bestReduced) {
          bestReduced = rc;
          enterCol = j;
        }
      }
    }

    if (enterCol < 0) {
      return { status: "optimal", iterations };
    }

    // Ratio test for leaving row
    let leaveRow = -1;
    let minRatio = Infinity;
    for (let i = 0; i < numRows; i++) {
      const row = tableau[i]!;
      const aij = row[enterCol]!;
      if (aij > 1e-9) {
        const rhs = Math.max(0, row[rhsCol]!);
        const ratio = rhs / aij;
        if (
          ratio < minRatio - 1e-12 ||
          (Math.abs(ratio - minRatio) <= 1e-12 && (leaveRow < 0 || basis[i]! < basis[leaveRow]!))
        ) {
          minRatio = ratio;
          leaveRow = i;
        }
      }
    }

    if (leaveRow < 0) {
      return { status: "unbounded", iterations };
    }

    // Pivot on (leaveRow, enterCol)
    const pivotRow = tableau[leaveRow]!;
    const pivotVal = pivotRow[enterCol]!;
    const invPivot = 1.0 / pivotVal;
    for (let j = 0; j <= numCols; j++) {
      pivotRow[j] = pivotRow[j]! * invPivot;
    }
    pivotRow[enterCol] = 1.0;

    for (let i = 0; i <= numRows; i++) {
      if (i === leaveRow) continue;
      const row = tableau[i]!;
      const factor = row[enterCol]!;
      if (Math.abs(factor) > 1e-15) {
        for (let j = 0; j <= numCols; j++) {
          row[j] = row[j]! - factor * pivotRow[j]!;
        }
        row[enterCol] = 0.0;
      }
    }

    basis[leaveRow] = enterCol;
    iterations++;

    const newObj = objRow[rhsCol]!;
    if (Math.abs(newObj - lastObj) <= 1e-12) {
      stallCount++;
    } else {
      stallCount = 0;
      lastObj = newObj;
    }
  }

  return { status: "iteration_limit", iterations };
}

/**
 * Solves the linear relaxation of a `CplexLpModel` via Two-Phase Simplex.
 */
export function solveLpSimplex(model: CplexLpModel, options?: LpSolveOptions): LpSolution {
  const maxIterations = options?.maxIterations ?? 10000;
  const tol = options?.tolerance ?? 1e-7;
  const overrides = options?.boundOverrides;

  if (!model.objective) {
    return { status: "infeasible", objectiveValue: NaN, values: {}, iterations: 0 };
  }

  const varNames = model.variableOrder;
  const isMax = model.objective.sense === "maximize";
  const signObj = isMax ? -1 : 1; // Convert maximize to minimize

  // Accumulate original objective linear coefficients
  const origCost = new Map<string, number>();
  for (const t of model.objective.linearTerms) {
    origCost.set(t.variable, (origCost.get(t.variable) ?? 0) + t.coeff);
  }

  // Step 1: Variable transformations to y >= 0
  const transforms = new Map<string, VarTransform>();
  let numYCols = 0;
  const stdConstraints: StandardConstraint[] = [];

  for (const name of varNames) {
    const info = model.variables.get(name);
    const ov = overrides?.get(name);
    const lower = ov ? ov.lower : (info?.lower ?? 0);
    const upper = ov ? ov.upper : (info?.upper ?? Infinity);

    if (lower > upper + tol) {
      return { status: "infeasible", objectiveValue: NaN, values: {}, iterations: 0 };
    }

    if (Number.isFinite(lower) && Number.isFinite(upper) && Math.abs(upper - lower) <= 1e-12) {
      transforms.set(name, { origName: name, kind: "fixed", offset: lower, posCol: -1, negCol: -1 });
    } else if (Number.isFinite(lower)) {
      const col = numYCols++;
      transforms.set(name, { origName: name, kind: "shifted_pos", offset: lower, posCol: col, negCol: -1 });
      if (Number.isFinite(upper)) {
        const coeffs = new Map<number, number>([[col, 1]]);
        stdConstraints.push({ coeffs, sense: "<=", rhs: upper - lower });
      }
    } else if (Number.isFinite(upper)) {
      const col = numYCols++;
      transforms.set(name, { origName: name, kind: "shifted_neg", offset: upper, posCol: -1, negCol: col });
    } else {
      // Free variable: x = y+ - y-
      const posCol = numYCols++;
      const negCol = numYCols++;
      transforms.set(name, { origName: name, kind: "split", offset: 0, posCol, negCol });
    }
  }

  // Step 2: Transform objective cost vector into y-space (for minimization)
  const yCost = new Float64Array(numYCols);
  for (const [name, c] of origCost) {
    const tr = transforms.get(name);
    if (!tr) continue;
    const minC = signObj * c;
    if (tr.kind === "shifted_pos") {
      yCost[tr.posCol] = yCost[tr.posCol]! + minC;
    } else if (tr.kind === "shifted_neg") {
      yCost[tr.negCol] = yCost[tr.negCol]! - minC;
    } else if (tr.kind === "split") {
      yCost[tr.posCol] = yCost[tr.posCol]! + minC;
      yCost[tr.negCol] = yCost[tr.negCol]! - minC;
    }
  }

  // Step 3: Transform model constraints into y-space
  for (const con of model.constraints) {
    const coeffs = new Map<number, number>();
    let rhs = con.rhs;

    for (const term of con.linearTerms) {
      const tr = transforms.get(term.variable);
      if (!tr) continue;
      if (tr.kind === "fixed") {
        rhs -= term.coeff * tr.offset;
      } else if (tr.kind === "shifted_pos") {
        rhs -= term.coeff * tr.offset;
        coeffs.set(tr.posCol, (coeffs.get(tr.posCol) ?? 0) + term.coeff);
      } else if (tr.kind === "shifted_neg") {
        rhs -= term.coeff * tr.offset;
        coeffs.set(tr.negCol, (coeffs.get(tr.negCol) ?? 0) - term.coeff);
      } else {
        coeffs.set(tr.posCol, (coeffs.get(tr.posCol) ?? 0) + term.coeff);
        coeffs.set(tr.negCol, (coeffs.get(tr.negCol) ?? 0) - term.coeff);
      }
    }

    // Remove near-zero coefficients
    for (const [k, v] of coeffs) {
      if (Math.abs(v) <= 1e-14) coeffs.delete(k);
    }

    // Check trivial empty constraint
    if (coeffs.size === 0) {
      const ok = con.sense === "<=" ? 0 <= rhs + tol : con.sense === ">=" ? 0 >= rhs - tol : Math.abs(rhs) <= tol;
      if (!ok) {
        return { status: "infeasible", objectiveValue: NaN, values: {}, iterations: 0 };
      }
      continue;
    }

    let sense = con.sense;
    if (rhs < 0) {
      rhs = -rhs;
      for (const [k, v] of coeffs) coeffs.set(k, -v);
      if (sense === "<=") sense = ">=";
      else if (sense === ">=") sense = "<=";
    }

    stdConstraints.push({ coeffs, sense, rhs });
  }

  // Handle unconstrained LP (0 constraints)
  if (stdConstraints.length === 0) {
    for (let j = 0; j < numYCols; j++) {
      if (yCost[j]! < -EPS) {
        return { status: "unbounded", objectiveValue: isMax ? Infinity : -Infinity, values: {}, iterations: 0 };
      }
    }
    const values: Record<string, number> = {};
    for (const name of varNames) {
      const tr = transforms.get(name)!;
      values[name] = tr.offset;
    }
    let objVal = model.objective.constant;
    for (const [name, c] of origCost) {
      objVal += c * (values[name] ?? 0);
    }
    return { status: "optimal", objectiveValue: objVal, values, iterations: 0 };
  }

  // Step 4: Count slack/surplus and artificial variables
  let numSlacks = 0;
  let numArtificials = 0;
  for (const c of stdConstraints) {
    if (c.sense === "<=" || c.sense === ">=") numSlacks++;
    if (c.sense === ">=" || c.sense === "=") numArtificials++;
  }

  const numRows = stdConstraints.length;
  const numNonArtCols = numYCols + numSlacks;
  const totalCols = numNonArtCols + numArtificials;

  // Allocate tableau: (numRows + 1) x (totalCols + 1)
  const tableau: Float64Array[] = [];
  for (let i = 0; i <= numRows; i++) {
    tableau.push(new Float64Array(totalCols + 1));
  }
  const basis = new Int32Array(numRows);

  let slackIdx = numYCols;
  let artIdx = numNonArtCols;

  for (let i = 0; i < numRows; i++) {
    const con = stdConstraints[i]!;
    const row = tableau[i]!;
    for (const [col, val] of con.coeffs) {
      row[col] = val;
    }
    row[totalCols] = con.rhs;

    if (con.sense === "<=") {
      row[slackIdx] = 1.0;
      basis[i] = slackIdx;
      slackIdx++;
    } else if (con.sense === ">=") {
      row[slackIdx] = -1.0;
      slackIdx++;
      row[artIdx] = 1.0;
      basis[i] = artIdx;
      artIdx++;
    } else {
      row[artIdx] = 1.0;
      basis[i] = artIdx;
      artIdx++;
    }
  }

  let totalIterations = 0;

  // Step 5: Phase I (if artificial variables exist)
  if (numArtificials > 0) {
    const objRow = tableau[numRows]!;
    for (let j = numNonArtCols; j < totalCols; j++) {
      objRow[j] = 1.0;
    }
    // Eliminate basic artificial variables from Phase I objective row
    for (let i = 0; i < numRows; i++) {
      if (basis[i]! >= numNonArtCols) {
        const row = tableau[i]!;
        for (let j = 0; j <= totalCols; j++) {
          objRow[j] = objRow[j]! - row[j]!;
        }
      }
    }

    const p1 = runSimplexPhase(tableau, basis, numRows, totalCols, maxIterations);
    totalIterations += p1.iterations;
    if (p1.status === "iteration_limit") {
      return { status: "iteration_limit", objectiveValue: NaN, values: {}, iterations: totalIterations };
    }

    // Phase I objective value is -objRow[totalCols]
    const phase1Obj = -objRow[totalCols]!;
    if (phase1Obj > tol) {
      return { status: "infeasible", objectiveValue: NaN, values: {}, iterations: totalIterations };
    }

    // Pivot any degenerate artificial variables out of the basis
    for (let i = 0; i < numRows; i++) {
      if (basis[i]! >= numNonArtCols) {
        const row = tableau[i]!;
        let pivotCol = -1;
        for (let j = 0; j < numNonArtCols; j++) {
          if (Math.abs(row[j]!) > 1e-9) {
            pivotCol = j;
            break;
          }
        }
        if (pivotCol >= 0) {
          const invP = 1.0 / row[pivotCol]!;
          for (let j = 0; j <= totalCols; j++) {
            row[j] = row[j]! * invP;
          }
          row[pivotCol] = 1.0;
          for (let r = 0; r < numRows; r++) {
            if (r === i) continue;
            const other = tableau[r]!;
            const factor = other[pivotCol]!;
            if (Math.abs(factor) > 1e-15) {
              for (let j = 0; j <= totalCols; j++) {
                other[j] = other[j]! - factor * row[j]!;
              }
              other[pivotCol] = 0.0;
            }
          }
          basis[i] = pivotCol;
        }
      }
    }
  }

  // Step 6: Build Phase II tableau (dropping artificial columns and redundant artificial rows)
  const activeRows: number[] = [];
  for (let i = 0; i < numRows; i++) {
    if (basis[i]! < numNonArtCols) {
      activeRows.push(i);
    }
  }

  const p2Rows = activeRows.length;
  const p2Tableau: Float64Array[] = [];
  const p2Basis = new Int32Array(p2Rows);

  for (let idx = 0; idx < p2Rows; idx++) {
    const srcRow = tableau[activeRows[idx]!]!;
    const dstRow = new Float64Array(numNonArtCols + 1);
    for (let j = 0; j < numNonArtCols; j++) {
      dstRow[j] = srcRow[j]!;
    }
    dstRow[numNonArtCols] = srcRow[totalCols]!;
    p2Tableau.push(dstRow);
    p2Basis[idx] = basis[activeRows[idx]!]!;
  }

  // Phase II objective row
  const p2Obj = new Float64Array(numNonArtCols + 1);
  for (let j = 0; j < numYCols; j++) {
    p2Obj[j] = yCost[j]!;
  }
  for (let i = 0; i < p2Rows; i++) {
    const bCol = p2Basis[i]!;
    const cb = bCol < numYCols ? yCost[bCol]! : 0;
    if (Math.abs(cb) > 1e-15) {
      const row = p2Tableau[i]!;
      for (let j = 0; j <= numNonArtCols; j++) {
        p2Obj[j] = p2Obj[j]! - cb * row[j]!;
      }
    }
  }
  p2Tableau.push(p2Obj);

  const p2 = runSimplexPhase(p2Tableau, p2Basis, p2Rows, numNonArtCols, Math.max(1, maxIterations - totalIterations));
  totalIterations += p2.iterations;

  if (p2.status === "unbounded") {
    return {
      status: "unbounded",
      objectiveValue: isMax ? Infinity : -Infinity,
      values: {},
      iterations: totalIterations,
    };
  }
  if (p2.status === "iteration_limit") {
    return {
      status: "iteration_limit",
      objectiveValue: NaN,
      values: {},
      iterations: totalIterations,
    };
  }

  // Step 7: Extract y values and reconstruct original x values
  const yVals = new Float64Array(numYCols);
  for (let i = 0; i < p2Rows; i++) {
    const col = p2Basis[i]!;
    if (col >= 0 && col < numYCols) {
      const val = p2Tableau[i]![numNonArtCols]!;
      yVals[col] = Math.abs(val) < 1e-12 ? 0 : val;
    }
  }

  const values: Record<string, number> = {};
  for (const name of varNames) {
    const tr = transforms.get(name)!;
    let x = tr.offset;
    if (tr.kind === "shifted_pos") {
      x = tr.offset + yVals[tr.posCol]!;
    } else if (tr.kind === "shifted_neg") {
      x = tr.offset - yVals[tr.negCol]!;
    } else if (tr.kind === "split") {
      x = yVals[tr.posCol]! - yVals[tr.negCol]!;
    }
    values[name] = Math.abs(x) < 1e-12 ? 0 : x;
  }

  let objectiveValue = model.objective.constant;
  for (const [name, c] of origCost) {
    objectiveValue += c * (values[name] ?? 0);
  }

  return {
    status: "optimal",
    objectiveValue,
    values,
    iterations: totalIterations,
  };
}
