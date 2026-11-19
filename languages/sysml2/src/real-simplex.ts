// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Real-Algebraic Simplex Solver (QF_LRA Engine).
 *
 * Implements the Dutertre-de Moura tableau simplex algorithm for Linear Real Arithmetic.
 * Used by SMT solvers (Z3, Yices) for exact satisfiability checking, budget consistency,
 * and minimal unsatisfiable core (conflict set) extraction.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";

export interface LinearTerm {
  varName: string;
  coeff: number;
}

export interface LinearConstraint {
  id?: string | undefined;
  requirementName?: string | undefined;
  terms: LinearTerm[];
  operator: "<=" | "<" | ">=" | ">" | "==";
  rhs: number;
  expression?: string | undefined;
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
  assignment?: Record<string, number> | undefined;
  unsatCore?: string[] | undefined;
  conflictExplanation?: string | undefined;
  violatedConstraint?: LinearConstraint | undefined;
}

interface LinearAccumulator {
  terms: Map<string, number>;
  constant: number;
}

function addLinearAcc(a: LinearAccumulator, b: LinearAccumulator, sign: 1 | -1): LinearAccumulator {
  const terms = new Map<string, number>(a.terms);
  for (const [k, v] of b.terms) {
    const next = (terms.get(k) ?? 0) + sign * v;
    if (Math.abs(next) < 1e-15) terms.delete(k);
    else terms.set(k, next);
  }
  return { terms, constant: a.constant + sign * b.constant };
}

function scaleLinearAcc(a: LinearAccumulator, factor: number): LinearAccumulator {
  if (Math.abs(factor) < 1e-15) {
    return { terms: new Map(), constant: 0 };
  }
  const terms = new Map<string, number>();
  for (const [k, v] of a.terms) {
    const prod = v * factor;
    if (Math.abs(prod) >= 1e-15) terms.set(k, prod);
  }
  return { terms, constant: a.constant * factor };
}

/**
 * Parses a linear expression string (e.g. "2*x + 3.5*y - z", "-(x + y)", "2 * (x + y)", "x * 2", "x / 2")
 * into variable terms and a constant offset.
 */
export function parseLinearExpression(expr: string): { terms: LinearTerm[]; constant: number } {
  const src = expr.trim();
  if (!src) return { terms: [], constant: 0 };

  let pos = 0;
  const len = src.length;

  const skipWs = (): void => {
    while (pos < len) {
      const c = src[pos]!;
      if (c === " " || c === "\t" || c === "\r" || c === "\n") pos++;
      else break;
    }
  };

  const isIdentStart = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  const isIdentPart = (c: string): boolean => {
    const code = c.charCodeAt(0);
    return (
      (c >= "a" && c <= "z") ||
      (c >= "A" && c <= "Z") ||
      (c >= "0" && c <= "9") ||
      c === "_" ||
      c === "." ||
      code === 0x00b2 ||
      code === 0x00b3 ||
      code === 0x00b9 ||
      (code >= 0x2070 && code <= 0x2079)
    );
  };

  const tryScanNumber = (): number | null => {
    skipWs();
    const start = pos;
    let hasDigits = false;
    let hasDot = false;
    let hasExp = false;

    while (pos < len) {
      const c = src[pos]!;
      if (c >= "0" && c <= "9") {
        hasDigits = true;
        pos++;
      } else if (c === "." && !hasDot && !hasExp) {
        // Avoid consuming `..` range operator
        if (src[pos + 1] === ".") break;
        hasDot = true;
        pos++;
      } else if ((c === "e" || c === "E") && hasDigits && !hasExp) {
        const save = pos;
        pos++;
        if (pos < len && (src[pos] === "+" || src[pos] === "-")) pos++;
        if (pos < len && src[pos]! >= "0" && src[pos]! <= "9") {
          hasExp = true;
          while (pos < len && src[pos]! >= "0" && src[pos]! <= "9") pos++;
        } else {
          pos = save;
          break;
        }
      } else {
        break;
      }
    }

    if (!hasDigits) {
      pos = start;
      return null;
    }
    const val = parseFloat(src.slice(start, pos));
    return Number.isFinite(val) ? val : null;
  };

  const tryScanIdent = (): string | null => {
    skipWs();
    if (pos >= len) return null;

    const readSegment = (): string | null => {
      if (pos >= len) return null;
      if (src[pos] === "'") {
        const close = src.indexOf("'", pos + 1);
        if (close > pos + 1) {
          const inner = src.slice(pos + 1, close);
          pos = close + 1;
          return inner;
        }
        return null;
      }
      if (!isIdentStart(src[pos]!)) return null;
      const start = pos;
      pos++;
      while (pos < len && isIdentPart(src[pos]!)) {
        // Stop before `.` if followed by `'...'` so outer loop handles `'...'` segment
        if (src[pos] === "." && src[pos + 1] === "'") break;
        pos++;
      }
      return src.slice(start, pos);
    };

    const first = readSegment();
    if (!first) return null;
    let full = first;
    while (pos < len) {
      if (src[pos] === ":" && src[pos + 1] === ":") {
        const save = pos;
        pos += 2;
        const seg = readSegment();
        if (seg) full += `::${seg}`;
        else {
          pos = save;
          break;
        }
      } else if (src[pos] === ".") {
        const save = pos;
        pos += 1;
        const seg = readSegment();
        if (seg) full += `.${seg}`;
        else {
          pos = save;
          break;
        }
      } else {
        break;
      }
    }
    return full;
  };

  function parseAddSub(): LinearAccumulator {
    let left = parseMulDiv();
    while (true) {
      skipWs();
      if (pos >= len) break;
      const ch = src[pos]!;
      if (ch === "+" || ch === "-") {
        pos++;
        const right = parseMulDiv();
        left = addLinearAcc(left, right, ch === "+" ? 1 : -1);
      } else {
        break;
      }
    }
    return left;
  }

  function parseMulDiv(): LinearAccumulator {
    let left = parseUnary();
    while (true) {
      skipWs();
      if (pos >= len) break;
      const ch = src[pos]!;
      if (ch === "*" || ch === "/") {
        pos++;
        const right = parseUnary();
        if (ch === "*") {
          if (left.terms.size === 0) {
            left = scaleLinearAcc(right, left.constant);
          } else if (right.terms.size === 0) {
            left = scaleLinearAcc(left, right.constant);
          } else {
            // Non-linear product fallback: preserve synthetic product variable name
            const lEntries = Array.from(left.terms.entries());
            const rEntries = Array.from(right.terms.entries());
            const combined = new Map<string, number>();
            for (const [lk, lv] of lEntries) {
              for (const [rk, rv] of rEntries) {
                const key = lk <= rk ? `${lk}*${rk}` : `${rk}*${lk}`;
                combined.set(key, (combined.get(key) ?? 0) + lv * rv);
              }
            }
            left = { terms: combined, constant: left.constant * right.constant };
          }
        } else {
          // Division by constant scalar
          if (right.terms.size === 0 && Math.abs(right.constant) > 1e-15) {
            left = scaleLinearAcc(left, 1.0 / right.constant);
          }
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary(): LinearAccumulator {
    skipWs();
    if (pos < len) {
      if (src[pos] === "+") {
        pos++;
        return parseUnary();
      }
      if (src[pos] === "-") {
        pos++;
        return scaleLinearAcc(parseUnary(), -1);
      }
    }
    return parsePrimary();
  }

  function parsePrimary(): LinearAccumulator {
    skipWs();
    if (pos >= len) return { terms: new Map(), constant: 0 };

    if (src[pos] === "(") {
      pos++;
      const inner = parseAddSub();
      skipWs();
      if (pos < len && src[pos] === ")") pos++;
      return inner;
    }

    const num = tryScanNumber();
    if (num !== null) {
      // Support implicit multiplication `2x` when immediately followed by an identifier without operator
      if (pos < len && (isIdentStart(src[pos]!) || src[pos] === "'")) {
        const id = tryScanIdent();
        if (id) {
          const m = new Map<string, number>();
          if (Math.abs(num) >= 1e-15) m.set(id, num);
          return { terms: m, constant: 0 };
        }
      }
      return { terms: new Map(), constant: num };
    }

    const id = tryScanIdent();
    if (id !== null) {
      // Skip unit brackets `[kg]` if attached to identifier
      skipWs();
      if (pos < len && src[pos] === "[") {
        let depth = 1;
        pos++;
        while (pos < len && depth > 0) {
          if (src[pos] === "[") depth++;
          else if (src[pos] === "]") depth--;
          pos++;
        }
      }
      const m = new Map<string, number>();
      m.set(id, 1);
      return { terms: m, constant: 0 };
    }

    // Skip unexpected character (e.g. `[unit]` after number)
    if (src[pos] === "[") {
      let depth = 1;
      pos++;
      while (pos < len && depth > 0) {
        if (src[pos] === "[") depth++;
        else if (src[pos] === "]") depth--;
        pos++;
      }
      return { terms: new Map(), constant: 0 };
    }

    pos++;
    return { terms: new Map(), constant: 0 };
  }

  const acc = parseAddSub();
  const terms: LinearTerm[] = [];
  for (const [varName, coeff] of acc.terms) {
    if (Math.abs(coeff) >= 1e-15) {
      terms.push({ varName, coeff });
    }
  }
  return { terms, constant: acc.constant };
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

    // Try solving via WebAssembly Dutertre-de Moura Simplex solver first
    try {
      const wasm = getDefaultWasmExports();
      if (wasm && typeof wasm.simplex_initDutertreDeMoura === "function") {
        const sPtr = wasm.simplex_create(m + 2, n + 2);
        wasm.simplex_initDutertreDeMoura(sPtr, m, n);

        for (let i = 0; i < m; i++) {
          for (let j = 0; j < n; j++) {
            const val = A[i]![j];
            if (val && Math.abs(val) > 1e-15) {
              wasm.simplex_setEntry(sPtr, i, j, val);
            }
          }
        }

        for (let j = 0; j < n; j++) {
          const lb = lowerBounds[j]!;
          if (lb.r > -1e29) wasm.simplex_setBound(sPtr, j, true, lb.r, lb.k);
          const ub = upperBounds[j]!;
          if (ub.r < 1e29) wasm.simplex_setBound(sPtr, j, false, ub.r, ub.k);
        }

        for (let i = 0; i < m; i++) {
          const sIdx = n + i;
          const lb = lowerBounds[sIdx]!;
          if (lb.r > -1e29) wasm.simplex_setBound(sPtr, sIdx, true, lb.r, lb.k);
          const ub = upperBounds[sIdx]!;
          if (ub.r < 1e29) wasm.simplex_setBound(sPtr, sIdx, false, ub.r, ub.k);
        }

        const wasmRes = wasm.simplex_solveDutertreDeMoura(sPtr, maxIterations);
        if (wasmRes === 1 /* OPTIMAL */) {
          const assignment: Record<string, number> = {};
          for (let j = 0; j < n; j++) {
            assignment[nonBasicVars[j]!] = wasm.simplex_getAssignment(sPtr, j);
          }
          wasm.simplex_destroy(sPtr);
          return {
            isFeasible: true,
            assignment,
          };
        }
        wasm.simplex_destroy(sPtr);
      }
    } catch {
      // Fall through to JS implementation for conflict isolation
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
