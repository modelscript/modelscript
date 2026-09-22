// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Real-Algebraic Simplex Solver (QF_LRA Engine).
 *
 * Implements the Dutertre-de Moura tableau simplex algorithm for Linear Real Arithmetic.
 * Used by SMT solvers (Z3, Yices) for exact satisfiability checking, budget consistency,
 * and minimal unsatisfiable core (conflict set) extraction.
 */

export interface LinearTerm {
  varName: string;
  coeff: number;
}

export interface LinearConstraint {
  id?: string;
  requirementName?: string;
  terms: LinearTerm[];
  operator: "<=" | "<" | ">=" | ">" | "==";
  rhs: number;
  expression?: string;
}

export interface SimplexVariableBound {
  varName: string;
  lower: number;
  upper: number;
}

export interface SimplexResult {
  isFeasible: boolean;
  assignment?: Record<string, number>;
  unsatCore?: string[];
  conflictExplanation?: string;
  violatedConstraint?: LinearConstraint;
}

/**
 * Parses a linear expression string (e.g. "2*x + 3.5*y - z" or "x - y") into terms and constant offset.
 */
export function parseLinearExpression(expr: string): { terms: LinearTerm[]; constant: number } {
  let cleaned = expr.trim().replace(/\s+/g, "");
  if (!cleaned) return { terms: [], constant: 0 };

  // Normalize leading plus
  if (!cleaned.startsWith("+") && !cleaned.startsWith("-")) {
    cleaned = "+" + cleaned;
  }

  // Tokenize signed terms: ([+-])([0-9.]*\*?)?([a-zA-Z0-9_.]+)
  const regex = /([+-])(?:([0-9.]+)\*?)?([a-zA-Z0-9_.]+)?/g;
  let match: RegExpExecArray | null;

  const terms: LinearTerm[] = [];
  let constant = 0;

  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index === regex.lastIndex) regex.lastIndex++;
    const sign = match[1] === "-" ? -1 : 1;
    const numStr = match[2];
    const ident = match[3];

    if (!numStr && !ident) continue;

    if (ident) {
      const coeff = (numStr !== undefined ? parseFloat(numStr) : 1.0) * sign;
      terms.push({ varName: ident, coeff });
    } else if (numStr !== undefined) {
      constant += parseFloat(numStr) * sign;
    }
  }

  return { terms, constant };
}

/**
 * Real-Algebraic Simplex Solver.
 */
export class RealSimplexSolver {
  private constraints: LinearConstraint[] = [];
  private explicitBounds = new Map<string, { lower: number; upper: number }>();

  public addConstraint(constraint: LinearConstraint): void {
    this.constraints.push(constraint);
  }

  public setBound(varName: string, lower = -Infinity, upper = Infinity): void {
    const existing = this.explicitBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
    this.explicitBounds.set(varName, {
      lower: Math.max(existing.lower, lower),
      upper: Math.min(existing.upper, upper),
    });
  }

  /**
   * Solves the linear system using the Dutertre-de Moura SMT Simplex algorithm.
   */
  public solve(maxIterations = 5000): SimplexResult {
    // 1. Collect all non-basic variable names
    const nonBasicVars: string[] = [];
    const nonBasicSet = new Set<string>();

    for (const c of this.constraints) {
      for (const t of c.terms) {
        if (!nonBasicSet.has(t.varName)) {
          nonBasicSet.add(t.varName);
          nonBasicVars.push(t.varName);
        }
      }
    }
    for (const v of this.explicitBounds.keys()) {
      if (!nonBasicSet.has(v)) {
        nonBasicSet.add(v);
        nonBasicVars.push(v);
      }
    }

    const n = nonBasicVars.length;
    const m = this.constraints.length;

    // Index non-basic variables
    const nbMap = new Map<string, number>();
    for (let j = 0; j < n; j++) nbMap.set(nonBasicVars[j]!, j);

    // Basic variables s_0 ... s_{m-1} correspond to each constraint
    // Tableau: s_i = \sum_{j=0}^{n-1} A_{i, j} x_j
    // Matrix A of size m x n
    const A: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    const lowerBounds: number[] = new Array(m + n).fill(-Infinity);
    const upperBounds: number[] = new Array(m + n).fill(Infinity);

    // Set bounds for non-basic variables (indices 0 .. n-1)
    for (let j = 0; j < n; j++) {
      const v = nonBasicVars[j]!;
      const b = this.explicitBounds.get(v);
      if (b) {
        lowerBounds[j] = b.lower;
        upperBounds[j] = b.upper;
      }
    }

    // Set coefficients and bounds for basic variables (indices n .. n+m-1)
    for (let i = 0; i < m; i++) {
      const c = this.constraints[i]!;
      const sIdx = n + i;
      for (const t of c.terms) {
        const col = nbMap.get(t.varName)!;
        A[i]![col] = (A[i]![col] ?? 0) + t.coeff;
      }

      const rhs = c.rhs;
      const eps = 1e-9;
      switch (c.operator) {
        case "<=":
          upperBounds[sIdx] = rhs;
          break;
        case "<":
          upperBounds[sIdx] = rhs - eps;
          break;
        case ">=":
          lowerBounds[sIdx] = rhs;
          break;
        case ">":
          lowerBounds[sIdx] = rhs + eps;
          break;
        case "==":
          lowerBounds[sIdx] = rhs;
          upperBounds[sIdx] = rhs;
          break;
      }
    }

    // Check trivial bound conflicts
    for (let k = 0; k < m + n; k++) {
      if (lowerBounds[k]! > upperBounds[k]!) {
        const reqName = k >= n ? this.constraints[k - n]?.requirementName : undefined;
        return {
          isFeasible: false,
          unsatCore: reqName ? [reqName] : [],
          conflictExplanation: `Contradictory bounds for variable ${k < n ? nonBasicVars[k] : `constraint_${k - n}`}: [${lowerBounds[k]}, ${upperBounds[k]}]`,
          violatedConstraint: k >= n ? this.constraints[k - n] : undefined,
        };
      }
    }

    // Assignment vector: beta of size n + m
    // Initialize non-basic variables to 0 (or bound nearest 0)
    const beta = new Array<number>(m + n).fill(0);
    for (let j = 0; j < n; j++) {
      const l = lowerBounds[j]!;
      const u = upperBounds[j]!;
      if (0 < l) beta[j] = l;
      else if (0 > u) beta[j] = u;
      else beta[j] = 0;
    }

    // Initialize basic variables: s_i = \sum A_{ij} x_j
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += (A[i]![j] ?? 0) * beta[j]!;
      }
      beta[n + i] = sum;
    }

    // Tracking basic variable indices for rows (initially n .. n+m-1)
    const basicVarOfRow: number[] = Array.from({ length: m }, (_, i) => n + i);
    // Non-basic variable indices for cols (initially 0 .. n-1)
    const nonBasicVarOfCol: number[] = Array.from({ length: n }, (_, j) => j);

    // Helper: update assignment after pivoting
    const updateBasicValues = () => {
      for (let i = 0; i < m; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += (A[i]![j] ?? 0) * beta[nonBasicVarOfCol[j]!]!;
        }
        beta[basicVarOfRow[i]!] = sum;
      }
    };

    // 2. Dutertre-de Moura Pivot Loop
    for (let iter = 0; iter < maxIterations; iter++) {
      // Find a basic variable that violates its bounds
      let violatingRow = -1;
      let isTooSmall = false;

      for (let i = 0; i < m; i++) {
        const v = basicVarOfRow[i]!;
        const val = beta[v]!;
        const l = lowerBounds[v]!;
        const u = upperBounds[v]!;

        if (val < l - 1e-9) {
          violatingRow = i;
          isTooSmall = true;
          break;
        } else if (val > u + 1e-9) {
          violatingRow = i;
          isTooSmall = false;
          break;
        }
      }

      if (violatingRow === -1) {
        // All variables satisfy their bounds -> FEASIBLE!
        const assignment: Record<string, number> = {};
        for (let j = 0; j < n; j++) {
          const varName = nonBasicVars[j]!;
          assignment[varName] = beta[j]!;
        }
        return {
          isFeasible: true,
          assignment,
        };
      }

      const xi = basicVarOfRow[violatingRow]!;
      const row = A[violatingRow]!;

      // Find entering non-basic variable using Bland's rule
      let enteringCol = -1;

      for (let j = 0; j < n; j++) {
        const aij = row[j]!;
        if (Math.abs(aij) < 1e-12) continue;

        const xj = nonBasicVarOfCol[j]!;
        const valXj = beta[xj]!;
        const lj = lowerBounds[xj]!;
        const uj = upperBounds[xj]!;

        if (isTooSmall) {
          // xi < li -> need to increase xi
          // If aij > 0, we can increase xj (if valXj < uj)
          // If aij < 0, we can decrease xj (if valXj > lj)
          if ((aij > 0 && valXj < uj - 1e-9) || (aij < 0 && valXj > lj + 1e-9)) {
            enteringCol = j;
            break;
          }
        } else {
          // xi > ui -> need to decrease xi
          // If aij > 0, we can decrease xj (if valXj > lj)
          // If aij < 0, we can increase xj (if valXj < uj)
          if ((aij > 0 && valXj > lj + 1e-9) || (aij < 0 && valXj < uj - 1e-9)) {
            enteringCol = j;
            break;
          }
        }
      }

      if (enteringCol === -1) {
        // No non-basic variable can help -> UNSAT CERTIFICATE
        const unsatCoreReqs = new Set<string>();
        if (xi >= n) {
          const c = this.constraints[xi - n];
          if (c?.requirementName) unsatCoreReqs.add(c.requirementName);
        }
        for (let j = 0; j < n; j++) {
          const aij = row[j]!;
          if (Math.abs(aij) > 1e-12) {
            const v = nonBasicVarOfCol[j]!;
            if (v >= n) {
              const c = this.constraints[v - n];
              if (c?.requirementName) unsatCoreReqs.add(c.requirementName);
            }
          }
        }

        const violatedConstraint = xi >= n ? this.constraints[xi - n] : undefined;
        return {
          isFeasible: false,
          unsatCore: Array.from(unsatCoreReqs),
          conflictExplanation: `Unsatisfiable linear real constraints at row ${violatingRow}: variable cannot reach bound [${lowerBounds[xi]}, ${upperBounds[xi]}] (current value: ${beta[xi]?.toFixed(4)})`,
          violatedConstraint,
        };
      }

      // Pivot (violatingRow, enteringCol)
      const pivotCoeff = row[enteringCol]!;
      const xj = nonBasicVarOfCol[enteringCol]!;

      // Change assignment of xi to the violated bound
      const targetVal = isTooSmall ? lowerBounds[xi]! : upperBounds[xi]!;
      const delta = (targetVal - beta[xi]!) / pivotCoeff;
      beta[xi] = targetVal;
      beta[xj] = beta[xj]! + delta;

      // Swap variable roles: xi becomes non-basic, xj becomes basic
      basicVarOfRow[violatingRow] = xj;
      nonBasicVarOfCol[enteringCol] = xi;

      // Update tableau matrix A via Gaussian row elimination
      const invPivot = 1.0 / pivotCoeff;
      for (let j = 0; j < n; j++) {
        if (j === enteringCol) row[j] = invPivot;
        else row[j] = -(row[j] ?? 0) * invPivot;
      }

      for (let i = 0; i < m; i++) {
        if (i === violatingRow) continue;
        const otherRow = A[i]!;
        const factor = otherRow[enteringCol]!;
        if (Math.abs(factor) < 1e-12) continue;

        otherRow[enteringCol] = 0;
        for (let j = 0; j < n; j++) {
          otherRow[j] = (otherRow[j] ?? 0) + factor * row[j]!;
        }
      }

      updateBasicValues();
    }

    return {
      isFeasible: false,
      conflictExplanation: `Simplex iterations exceeded maximum limit (${maxIterations})`,
    };
  }
}
