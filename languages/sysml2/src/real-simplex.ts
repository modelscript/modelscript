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

export interface InfNumber {
  r: number;
  k: number;
}

export function infNum(r: number, k = 0): InfNumber {
  return { r, k };
}

export function infAdd(a: InfNumber, b: InfNumber): InfNumber {
  return { r: a.r + b.r, k: a.k + b.k };
}

export function infSub(a: InfNumber, b: InfNumber): InfNumber {
  return { r: a.r - b.r, k: a.k - b.k };
}

export function infMulScalar(a: InfNumber, s: number): InfNumber {
  return { r: a.r * s, k: a.k * s };
}

export function infDivScalar(a: InfNumber, s: number): InfNumber {
  return { r: a.r / s, k: a.k / s };
}

export function infLt(a: InfNumber, b: InfNumber, tol = 1e-12): boolean {
  if (a.r < b.r - tol) return true;
  if (a.r > b.r + tol) return false;
  return a.k < b.k;
}

export function infGt(a: InfNumber, b: InfNumber, tol = 1e-12): boolean {
  return infLt(b, a, tol);
}

export function infEq(a: InfNumber, b: InfNumber, tol = 1e-12): boolean {
  return Math.abs(a.r - b.r) <= tol && a.k === b.k;
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
 * Parses a linear expression string (e.g. "2*x + 3.5*y - z" or "1.2e-4*x - 3.5e-2*y") into terms and constant offset.
 */
export function parseLinearExpression(expr: string): { terms: LinearTerm[]; constant: number } {
  let cleaned = expr.trim().replace(/\s+/g, "");
  if (!cleaned) return { terms: [], constant: 0 };

  // Normalize leading plus
  if (!cleaned.startsWith("+") && !cleaned.startsWith("-")) {
    cleaned = "+" + cleaned;
  }

  // Tokenize signed terms supporting scientific notation
  const regex = /([+-])(?:([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\*?)?([a-zA-Z_][a-zA-Z0-9_.]*)?/g;
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
 * Real-Algebraic Simplex Solver with exact Infinitesimal R(δ) arithmetic.
 */
export class RealSimplexSolver {
  private constraints: LinearConstraint[] = [];
  private explicitBounds = new Map<string, { lower: InfNumber; upper: InfNumber }>();

  public addConstraint(constraint: LinearConstraint): void {
    this.constraints.push(constraint);
  }

  public setBound(varName: string, lower: number | InfNumber = -Infinity, upper: number | InfNumber = Infinity): void {
    const l = typeof lower === "number" ? infNum(lower, 0) : lower;
    const u = typeof upper === "number" ? infNum(upper, 0) : upper;
    const existing = this.explicitBounds.get(varName) ?? {
      lower: infNum(-Infinity, 0),
      upper: infNum(Infinity, 0),
    };
    this.explicitBounds.set(varName, {
      lower: infGt(l, existing.lower) ? l : existing.lower,
      upper: infLt(u, existing.upper) ? u : existing.upper,
    });
  }

  /**
   * Solves the linear system using the Dutertre-de Moura SMT Simplex algorithm with exact R(δ).
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

    // Matrix A of size m x n
    const A: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    const lowerBounds: InfNumber[] = Array.from({ length: m + n }, () => infNum(-Infinity, 0));
    const upperBounds: InfNumber[] = Array.from({ length: m + n }, () => infNum(Infinity, 0));

    // Set bounds for non-basic variables (indices 0 .. n-1)
    for (let j = 0; j < n; j++) {
      const v = nonBasicVars[j]!;
      const b = this.explicitBounds.get(v);
      if (b) {
        lowerBounds[j] = b.lower;
        upperBounds[j] = b.upper;
      }
    }

    // Set coefficients and exact InfNumber bounds for basic variables (indices n .. n+m-1)
    for (let i = 0; i < m; i++) {
      const c = this.constraints[i]!;
      const sIdx = n + i;
      for (const t of c.terms) {
        const col = nbMap.get(t.varName)!;
        A[i]![col] = (A[i]![col] ?? 0) + t.coeff;
      }

      const rhs = c.rhs;
      switch (c.operator) {
        case "<=":
          upperBounds[sIdx] = infNum(rhs, 0);
          break;
        case "<":
          upperBounds[sIdx] = infNum(rhs, -1);
          break;
        case ">=":
          lowerBounds[sIdx] = infNum(rhs, 0);
          break;
        case ">":
          lowerBounds[sIdx] = infNum(rhs, 1);
          break;
        case "==":
          lowerBounds[sIdx] = infNum(rhs, 0);
          upperBounds[sIdx] = infNum(rhs, 0);
          break;
      }
    }

    // Check trivial bound conflicts
    for (let k = 0; k < m + n; k++) {
      if (infGt(lowerBounds[k]!, upperBounds[k]!)) {
        const reqName = k >= n ? this.constraints[k - n]?.requirementName : undefined;
        return {
          isFeasible: false,
          unsatCore: reqName ? [reqName] : [],
          conflictExplanation: `Contradictory bounds for variable ${k < n ? nonBasicVars[k] : `constraint_${k - n}`}: [(${lowerBounds[k]!.r}, ${lowerBounds[k]!.k}δ), (${upperBounds[k]!.r}, ${upperBounds[k]!.k}δ)]`,
          violatedConstraint: k >= n ? this.constraints[k - n] : undefined,
        };
      }
    }

    // Assignment vector: beta of size n + m with InfNumber
    const beta: InfNumber[] = new Array(m + n);
    for (let j = 0; j < n; j++) {
      const l = lowerBounds[j]!;
      const u = upperBounds[j]!;
      const zero = infNum(0, 0);
      if (infLt(zero, l)) beta[j] = l;
      else if (infGt(zero, u)) beta[j] = u;
      else beta[j] = zero;
    }

    // Initialize basic variables: s_i = \sum A_{ij} x_j
    for (let i = 0; i < m; i++) {
      let sum = infNum(0, 0);
      for (let j = 0; j < n; j++) {
        sum = infAdd(sum, infMulScalar(beta[j]!, A[i]![j] ?? 0));
      }
      beta[n + i] = sum;
    }

    // Tracking basic variable indices for rows (initially n .. n+m-1)
    const basicVarOfRow: number[] = Array.from({ length: m }, (_, i) => n + i);
    // Non-basic variable indices for cols (initially 0 .. n-1)
    const nonBasicVarOfCol: number[] = Array.from({ length: n }, (_, j) => j);

    const updateBasicValues = () => {
      for (let i = 0; i < m; i++) {
        let sum = infNum(0, 0);
        for (let j = 0; j < n; j++) {
          sum = infAdd(sum, infMulScalar(beta[nonBasicVarOfCol[j]!]!, A[i]![j] ?? 0));
        }
        beta[basicVarOfRow[i]!] = sum;
      }
    };

    // 2. Dutertre-de Moura Pivot Loop with Bland's Anti-Cycling Rule
    for (let iter = 0; iter < maxIterations; iter++) {
      // Find a basic variable violating bounds with minimal variable index
      let violatingRow = -1;
      let minViolatingVar = Infinity;
      let isTooSmall = false;

      for (let i = 0; i < m; i++) {
        const v = basicVarOfRow[i]!;
        const val = beta[v]!;
        const l = lowerBounds[v]!;
        const u = upperBounds[v]!;

        if (infLt(val, l)) {
          if (v < minViolatingVar) {
            minViolatingVar = v;
            violatingRow = i;
            isTooSmall = true;
          }
        } else if (infGt(val, u)) {
          if (v < minViolatingVar) {
            minViolatingVar = v;
            violatingRow = i;
            isTooSmall = false;
          }
        }
      }

      if (violatingRow === -1) {
        // All variables satisfy their bounds -> FEASIBLE!
        const assignment: Record<string, number> = {};
        for (let j = 0; j < n; j++) {
          const varName = nonBasicVars[j]!;
          assignment[varName] = beta[j]!.r;
        }
        return {
          isFeasible: true,
          assignment,
        };
      }

      const xi = basicVarOfRow[violatingRow]!;
      const row = A[violatingRow]!;

      // Find entering non-basic variable with minimal variable index (Bland's rule)
      let enteringCol = -1;
      let minEnteringVar = Infinity;

      for (let j = 0; j < n; j++) {
        const aij = row[j]!;
        if (Math.abs(aij) < 1e-12) continue;

        const xj = nonBasicVarOfCol[j]!;
        const valXj = beta[xj]!;
        const lj = lowerBounds[xj]!;
        const uj = upperBounds[xj]!;

        let canEnter = false;
        if (isTooSmall) {
          if ((aij > 0 && infLt(valXj, uj)) || (aij < 0 && infGt(valXj, lj))) {
            canEnter = true;
          }
        } else {
          if ((aij > 0 && infGt(valXj, lj)) || (aij < 0 && infLt(valXj, uj))) {
            canEnter = true;
          }
        }

        if (canEnter && xj < minEnteringVar) {
          minEnteringVar = xj;
          enteringCol = j;
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
          conflictExplanation: `Unsatisfiable linear real constraints at row ${violatingRow}: variable cannot reach bound [(${lowerBounds[xi]!.r}, ${lowerBounds[xi]!.k}δ), (${upperBounds[xi]!.r}, ${upperBounds[xi]!.k}δ)] (current: ${beta[xi]!.r.toFixed(4)})`,
          violatedConstraint,
        };
      }

      // Pivot (violatingRow, enteringCol)
      const pivotCoeff = row[enteringCol]!;
      const xj = nonBasicVarOfCol[enteringCol]!;

      // Change assignment of xi to the violated bound
      const targetVal = isTooSmall ? lowerBounds[xi]! : upperBounds[xi]!;
      const delta = infDivScalar(infSub(targetVal, beta[xi]!), pivotCoeff);
      beta[xi] = targetVal;
      beta[xj] = infAdd(beta[xj]!, delta);

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
