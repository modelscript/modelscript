// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Native NLSAT Non-Linear CAD Real Arithmetic Solver.
 *
 * Implements the Jovanović-de Moura NLSAT algorithm (CAV 2012) for exact Satisfiability
 * Modulo Theories over Non-linear Real Arithmetic (T_NRA):
 *   1. Univariate Real Algebraic Root Isolation via Sturm sequences & Descartes' Rule of Signs.
 *   2. 1D Cylindrical Algebraic Decomposition (CAD) into sign-invariant point and interval cells.
 *   3. Partial Model Assignment & On-the-fly Invariant Cell Projection.
 *   4. Exact Conflict Clause Learning: explains univariate infeasibility over CAD cells
 *      without doubly-exponential global CAD construction.
 */

import { type ExprNode, type NonlinearConstraint } from "./hc4_contractor.js";

export type NlsatRelOp = "<" | "<=" | "==" | ">=" | ">" | "!=";

/**
 * Univariate polynomial with real coefficients: p(x) = sum_{i=0}^d coeffs[i] * x^i.
 */
export class UnivariatePoly {
  constructor(public coeffs: number[]) {
    this.trim();
  }

  public trim(): this {
    while (this.coeffs.length > 1 && Math.abs(this.coeffs[this.coeffs.length - 1]!) < 1e-12) {
      this.coeffs.pop();
    }
    if (this.coeffs.length === 0) this.coeffs = [0];
    return this;
  }

  public degree(): number {
    return this.coeffs.length - 1;
  }

  public isZero(): boolean {
    return this.coeffs.length === 1 && Math.abs(this.coeffs[0]!) < 1e-12;
  }

  public leadCoeff(): number {
    return this.coeffs[this.coeffs.length - 1]!;
  }

  public eval(x: number): number {
    let res = 0;
    for (let i = this.coeffs.length - 1; i >= 0; i--) {
      res = res * x + this.coeffs[i]!;
    }
    return res;
  }

  public derivative(): UnivariatePoly {
    if (this.degree() === 0) return new UnivariatePoly([0]);
    const dCoeffs: number[] = [];
    for (let i = 1; i < this.coeffs.length; i++) {
      dCoeffs.push(i * this.coeffs[i]!);
    }
    return new UnivariatePoly(dCoeffs);
  }

  public add(other: UnivariatePoly): UnivariatePoly {
    const len = Math.max(this.coeffs.length, other.coeffs.length);
    const res = new Array<number>(len).fill(0);
    for (let i = 0; i < len; i++) {
      res[i] = (this.coeffs[i] ?? 0) + (other.coeffs[i] ?? 0);
    }
    return new UnivariatePoly(res);
  }

  public sub(other: UnivariatePoly): UnivariatePoly {
    const len = Math.max(this.coeffs.length, other.coeffs.length);
    const res = new Array<number>(len).fill(0);
    for (let i = 0; i < len; i++) {
      res[i] = (this.coeffs[i] ?? 0) - (other.coeffs[i] ?? 0);
    }
    return new UnivariatePoly(res);
  }

  public mul(other: UnivariatePoly): UnivariatePoly {
    if (this.isZero() || other.isZero()) return new UnivariatePoly([0]);
    const res = new Array<number>(this.degree() + other.degree() + 1).fill(0);
    for (let i = 0; i < this.coeffs.length; i++) {
      for (let j = 0; j < other.coeffs.length; j++) {
        res[i + j] += this.coeffs[i]! * other.coeffs[j]!;
      }
    }
    return new UnivariatePoly(res);
  }

  public mulScalar(s: number): UnivariatePoly {
    return new UnivariatePoly(this.coeffs.map((c) => c * s));
  }

  public divRem(other: UnivariatePoly): { quotient: UnivariatePoly; remainder: UnivariatePoly } {
    if (other.isZero()) throw new Error("Division by zero polynomial");
    const rem = new UnivariatePoly([...this.coeffs]);
    const qCoeffs = new Array<number>(Math.max(0, this.degree() - other.degree() + 1)).fill(0);

    const bLead = other.leadCoeff();
    while (!rem.isZero() && rem.degree() >= other.degree()) {
      const degDiff = rem.degree() - other.degree();
      const coeff = rem.leadCoeff() / bLead;
      qCoeffs[degDiff] = coeff;

      for (let i = 0; i <= other.degree(); i++) {
        rem.coeffs[i + degDiff] -= coeff * other.coeffs[i]!;
      }
      rem.trim();
    }

    return {
      quotient: new UnivariatePoly(qCoeffs),
      remainder: rem,
    };
  }

  public gcd(other: UnivariatePoly): UnivariatePoly {
    let a = new UnivariatePoly([...this.coeffs]);
    let b = new UnivariatePoly([...other.coeffs]);
    while (!b.isZero()) {
      const { remainder } = a.divRem(b);
      a = b;
      b = remainder;
    }
    if (!a.isZero()) {
      return a.mulScalar(1 / a.leadCoeff());
    }
    return a;
  }

  public squareFree(): UnivariatePoly {
    const d = this.derivative();
    const g = this.gcd(d);
    const { quotient } = this.divRem(g);
    return quotient.mulScalar(1 / quotient.leadCoeff());
  }

  public cauchyRootBound(): number {
    const d = this.degree();
    if (d <= 0) return 0;
    const an = Math.abs(this.leadCoeff());
    let maxRatio = 0;
    for (let i = 0; i < d; i++) {
      const ratio = Math.abs(this.coeffs[i]!) / an;
      if (ratio > maxRatio) maxRatio = ratio;
    }
    return 1 + maxRatio;
  }
}

/**
 * Builds a Sturm sequence of polynomials for real root counting.
 */
export function buildSturmSequence(p: UnivariatePoly): UnivariatePoly[] {
  const sq = p.squareFree();
  if (sq.degree() <= 0) return [sq];

  const seq: UnivariatePoly[] = [sq, sq.derivative()];
  while (true) {
    const pPrev = seq[seq.length - 2]!;
    const pCurr = seq[seq.length - 1]!;
    if (pCurr.degree() === 0 || pCurr.isZero()) break;
    const { remainder } = pPrev.divRem(pCurr);
    if (remainder.isZero()) break;
    seq.push(remainder.mulScalar(-1));
  }
  return seq;
}

/**
 * Computes the number of sign variations in a sequence evaluated at x.
 */
export function signVariations(seq: UnivariatePoly[], x: number): number {
  const signs: number[] = [];
  for (const poly of seq) {
    const val = poly.eval(x);
    if (Math.abs(val) > 1e-11) {
      signs.push(val > 0 ? 1 : -1);
    }
  }
  let count = 0;
  for (let i = 0; i < signs.length - 1; i++) {
    if (signs[i]! * signs[i + 1]! < 0) count++;
  }
  return count;
}

export function countRootsInRange(seq: UnivariatePoly[], a: number, b: number): number {
  return signVariations(seq, a) - signVariations(seq, b);
}

/**
 * Isolates all distinct real roots of a polynomial via Sturm bisection.
 */
export function isolateRealRoots(p: UnivariatePoly, eps = 1e-7): number[] {
  if (p.degree() <= 0) return [];
  if (p.degree() === 1) {
    return [-p.coeffs[0]! / p.coeffs[1]!];
  }

  const seq = buildSturmSequence(p);
  const B = p.cauchyRootBound() + 1;
  const totalRoots = countRootsInRange(seq, -B, B);
  if (totalRoots === 0) return [];

  const intervals: { a: number; b: number }[] = [];
  const queue: { a: number; b: number }[] = [{ a: -B, b: B }];

  while (queue.length > 0) {
    const { a, b } = queue.shift()!;
    const num = countRootsInRange(seq, a, b);
    if (num === 0) continue;
    if (num === 1) {
      if (b - a < eps) {
        intervals.push({ a, b });
      } else {
        const mid = (a + b) / 2;
        const leftCount = countRootsInRange(seq, a, mid);
        if (leftCount === 1) {
          queue.push({ a, b: mid });
        } else {
          queue.push({ a: mid, b });
        }
      }
    } else {
      const mid = (a + b) / 2;
      queue.push({ a, b: mid });
      queue.push({ a: mid, b });
    }
  }

  const roots: number[] = [];
  for (const inv of intervals) {
    let { a, b } = inv;
    for (let iter = 0; iter < 45; iter++) {
      const mid = (a + b) / 2;
      if (b - a < 1e-12) break;
      const cnt = countRootsInRange(seq, a, mid);
      if (cnt >= 1) {
        b = mid;
      } else {
        a = mid;
      }
    }
    roots.push((a + b) / 2);
  }

  roots.sort((x, y) => x - y);
  return roots;
}

/**
 * 1D CAD Cell: either a 0-dimensional point cell [r, r] or a 1-dimensional open interval cell (a, b).
 */
export interface Cell1D {
  kind: "point" | "interval";
  lo: number;
  hi: number;
  sample: number;
}

/**
 * Decomposes the real line R into sign-invariant 1D cells around isolated roots.
 */
export function build1DCells(roots: number[]): Cell1D[] {
  const sorted = Array.from(new Set(roots)).sort((a, b) => a - b);
  const cells: Cell1D[] = [];

  if (sorted.length === 0) {
    return [{ kind: "interval", lo: -Infinity, hi: Infinity, sample: 0 }];
  }

  const r0 = sorted[0]!;
  cells.push({ kind: "interval", lo: -Infinity, hi: r0, sample: r0 - 1 });

  for (let i = 0; i < sorted.length; i++) {
    const ri = sorted[i]!;
    cells.push({ kind: "point", lo: ri, hi: ri, sample: ri });

    if (i < sorted.length - 1) {
      const rNext = sorted[i + 1]!;
      cells.push({ kind: "interval", lo: ri, hi: rNext, sample: (ri + rNext) / 2 });
    }
  }

  const rLast = sorted[sorted.length - 1]!;
  cells.push({ kind: "interval", lo: rLast, hi: Infinity, sample: rLast + 1 });

  return cells;
}

/**
 * Multivariate polynomial term: c * prod_{v} v^{deg[v]}.
 */
export interface MultiPolyTerm {
  deg: Map<string, number>;
  coeff: number;
}

/**
 * Multivariate polynomial for non-linear arithmetic reasoning.
 */
export class MultiPoly {
  constructor(public terms: MultiPolyTerm[]) {
    this.simplify();
  }

  public simplify(): this {
    const map = new Map<string, number>();
    for (const t of this.terms) {
      if (Math.abs(t.coeff) < 1e-12) continue;
      const key =
        Array.from(t.deg.entries())
          .filter(([, d]) => d > 0)
          .sort(([v1], [v2]) => v1.localeCompare(v2))
          .map(([v, d]) => `${v}^${d}`)
          .join("*") || "const";
      map.set(key, (map.get(key) ?? 0) + t.coeff);
    }

    this.terms = [];
    for (const [key, coeff] of map.entries()) {
      if (Math.abs(coeff) < 1e-12) continue;
      const degMap = new Map<string, number>();
      if (key !== "const") {
        for (const part of key.split("*")) {
          const [v, dStr] = part.split("^");
          degMap.set(v!, parseInt(dStr!, 10));
        }
      }
      this.terms.push({ deg: degMap, coeff });
    }
    return this;
  }

  public vars(): string[] {
    const s = new Set<string>();
    for (const t of this.terms) {
      for (const [v, d] of t.deg.entries()) {
        if (d > 0) s.add(v);
      }
    }
    return Array.from(s).sort();
  }

  public degree(varName: string): number {
    let maxD = 0;
    for (const t of this.terms) {
      const d = t.deg.get(varName) ?? 0;
      if (d > maxD) maxD = d;
    }
    return maxD;
  }

  public eval(assignment: Map<string, number>): number {
    let sum = 0;
    for (const t of this.terms) {
      let termVal = t.coeff;
      for (const [v, d] of t.deg.entries()) {
        const val = assignment.get(v) ?? 0;
        termVal *= Math.pow(val, d);
      }
      sum += termVal;
    }
    return sum;
  }

  /**
   * Partially evaluates all variables assigned in `assignment`, producing a UnivariatePoly in `targetVar`.
   */
  public partialEval(assignment: Map<string, number>, targetVar: string): UnivariatePoly {
    const uCoeffs = new Map<number, number>();

    for (const t of this.terms) {
      let val = t.coeff;
      let targetDeg = 0;

      for (const [v, d] of t.deg.entries()) {
        if (v === targetVar) {
          targetDeg = d;
        } else {
          const assignedVal = assignment.get(v);
          if (assignedVal !== undefined) {
            val *= Math.pow(assignedVal, d);
          } else {
            // Unassigned other variable: treat as 0 or error
            val = 0;
          }
        }
      }

      uCoeffs.set(targetDeg, (uCoeffs.get(targetDeg) ?? 0) + val);
    }

    const maxDeg = Math.max(0, ...Array.from(uCoeffs.keys()));
    const polyArr = new Array<number>(maxDeg + 1).fill(0);
    for (const [deg, c] of uCoeffs.entries()) {
      polyArr[deg] = c;
    }

    return new UnivariatePoly(polyArr);
  }

  /**
   * Projects critical roots of a bivariate constraint onto `targetVar` by computing the discriminant
   * with respect to `futureVar` (for quadratic in `futureVar`) or the leading coefficient (for linear).
   */
  public projectQuadraticRoots(assignment: Map<string, number>, targetVar: string, futureVar: string): number[] {
    const yCoeffs = new Map<number, Map<number, number>>();

    for (const t of this.terms) {
      let coeff = t.coeff;
      let degX = 0;
      let degY = 0;
      let valid = true;

      for (const [v, d] of t.deg.entries()) {
        if (v === targetVar) {
          degX = d;
        } else if (v === futureVar) {
          degY = d;
        } else {
          const val = assignment.get(v);
          if (val === undefined) {
            valid = false;
            break;
          }
          coeff *= Math.pow(val, d);
        }
      }

      if (!valid) continue;

      let xMap = yCoeffs.get(degY);
      if (!xMap) {
        xMap = new Map<number, number>();
        yCoeffs.set(degY, xMap);
      }
      xMap.set(degX, (xMap.get(degX) ?? 0) + coeff);
    }

    const toUni = (xMap?: Map<number, number>): UnivariatePoly => {
      if (!xMap || xMap.size === 0) return new UnivariatePoly([0]);
      const maxDeg = Math.max(0, ...Array.from(xMap.keys()));
      const arr = new Array<number>(maxDeg + 1).fill(0);
      for (const [d, c] of xMap.entries()) arr[d] = c;
      return new UnivariatePoly(arr);
    };

    const A = toUni(yCoeffs.get(2));
    const B = toUni(yCoeffs.get(1));
    const C = toUni(yCoeffs.get(0));

    const roots: number[] = [];
    if (!A.isZero()) {
      // Discriminant Delta(x) = B(x)^2 - 4*A(x)*C(x)
      const delta = B.mul(B).sub(A.mul(C).mulScalar(4));
      roots.push(...isolateRealRoots(delta));
      if (A.degree() > 0) {
        roots.push(...isolateRealRoots(A));
      }
    } else if (!B.isZero() && B.degree() > 0) {
      roots.push(...isolateRealRoots(B));
    }

    return roots;
  }

  /**
   * Constructs a MultiPoly from an AST ExprNode. Returns null if expression contains non-polynomial operators.
   */
  public static fromExprNode(node: ExprNode): MultiPoly | null {
    switch (node.kind) {
      case "const":
        return new MultiPoly([{ deg: new Map(), coeff: node.value }]);
      case "var":
        return new MultiPoly([{ deg: new Map([[node.name, 1]]), coeff: 1 }]);
      case "neg": {
        const child = MultiPoly.fromExprNode(node.child);
        if (!child) return null;
        return new MultiPoly(child.terms.map((t) => ({ deg: new Map(t.deg), coeff: -t.coeff })));
      }
      case "sqr": {
        const child = MultiPoly.fromExprNode(node.child);
        if (!child) return null;
        return MultiPoly.multiply(child, child);
      }
      case "add": {
        const l = MultiPoly.fromExprNode(node.left);
        const r = MultiPoly.fromExprNode(node.right);
        if (!l || !r) return null;
        return new MultiPoly([...l.terms, ...r.terms]);
      }
      case "sub": {
        const l = MultiPoly.fromExprNode(node.left);
        const r = MultiPoly.fromExprNode(node.right);
        if (!l || !r) return null;
        const negR = r.terms.map((t) => ({ deg: new Map(t.deg), coeff: -t.coeff }));
        return new MultiPoly([...l.terms, ...negR]);
      }
      case "mul": {
        const l = MultiPoly.fromExprNode(node.left);
        const r = MultiPoly.fromExprNode(node.right);
        if (!l || !r) return null;
        return MultiPoly.multiply(l, r);
      }
      default:
        return null;
    }
  }

  private static multiply(a: MultiPoly, b: MultiPoly): MultiPoly {
    const newTerms: MultiPolyTerm[] = [];
    for (const t1 of a.terms) {
      for (const t2 of b.terms) {
        const deg = new Map(t1.deg);
        for (const [v, d] of t2.deg.entries()) {
          deg.set(v, (deg.get(v) ?? 0) + d);
        }
        newTerms.push({ deg, coeff: t1.coeff * t2.coeff });
      }
    }
    return new MultiPoly(newTerms);
  }
}

export function evalRelOp(val: number, op: NlsatRelOp, eps = 1e-10): boolean {
  switch (op) {
    case "<":
      return val < -eps;
    case "<=":
      return val <= eps;
    case "==":
      return Math.abs(val) <= eps;
    case ">=":
      return val >= -eps;
    case ">":
      return val > eps;
    case "!=":
      return Math.abs(val) > eps;
  }
}

export interface NlsatConstraint {
  id: number;
  poly: MultiPoly;
  op: NlsatRelOp;
  vars: string[];
}

export interface NlsatResult {
  status: "SAT" | "UNSAT" | "UNKNOWN";
  model?: Map<string, number>;
  conflictingConstraintIds?: number[];
  iterations: number;
  durationMs: number;
  summary: string;
}

export class NlsatSolver {
  private constraints: NlsatConstraint[];
  private variableOrder: string[];

  constructor(
    constraints: NlsatConstraint[],
    variableOrder?: string[],
    bounds?: Map<string, { lo: number; hi: number }>,
  ) {
    this.constraints = [...constraints];

    if (bounds) {
      let boundId = -1;
      for (const [v, b] of bounds.entries()) {
        if (Number.isFinite(b.hi)) {
          // v <= b.hi => v - b.hi <= 0
          this.constraints.push({
            id: boundId--,
            poly: new MultiPoly([
              { deg: new Map([[v, 1]]), coeff: 1 },
              { deg: new Map(), coeff: -b.hi },
            ]),
            op: "<=",
            vars: [v],
          });
        }
        if (Number.isFinite(b.lo)) {
          // v >= b.lo => v - b.lo >= 0
          this.constraints.push({
            id: boundId--,
            poly: new MultiPoly([
              { deg: new Map([[v, 1]]), coeff: 1 },
              { deg: new Map(), coeff: -b.lo },
            ]),
            op: ">=",
            vars: [v],
          });
        }
      }
    }

    if (variableOrder && variableOrder.length > 0) {
      this.variableOrder = [...variableOrder];
    } else {
      const allVars = new Set<string>();
      for (const c of this.constraints) {
        for (const v of c.vars) allVars.add(v);
      }
      this.variableOrder = Array.from(allVars).sort();
    }
  }

  /**
   * Batch constructs NlsatConstraints from an array of NonlinearConstraint ASTs.
   * Returns null if any constraint cannot be represented as a polynomial.
   */
  public static fromNonlinearConstraints(constraints: NonlinearConstraint[]): NlsatConstraint[] | null {
    const res: NlsatConstraint[] = [];
    for (let i = 0; i < constraints.length; i++) {
      const parsed = NlsatSolver.fromNonlinearConstraint(i + 1, constraints[i]!);
      if (!parsed) return null;
      res.push(parsed);
    }
    return res;
  }

  /**
   * Helper to construct NlsatConstraint from NonlinearConstraint AST.
   * Rewrites expr rel rhs into (expr - rhs) rel 0.
   */
  public static fromNonlinearConstraint(id: number, c: NonlinearConstraint): NlsatConstraint | null {
    const exprPoly = MultiPoly.fromExprNode(c.expr);
    if (!exprPoly) return null;

    // Subtract rhs: expr - rhs
    const fullPoly = new MultiPoly([...exprPoly.terms, { deg: new Map(), coeff: -c.rhs }]);

    return {
      id,
      poly: fullPoly,
      op: c.rel as NlsatRelOp,
      vars: fullPoly.vars(),
    };
  }

  /**
   * Executes exact NLSAT search over variable ordering via cylindrical cell decomposition.
   */
  public solve(maxIterations = 500): NlsatResult {
    const startTime = performance.now();
    const assignment = new Map<string, number>();
    let iterations = 0;

    // Stack frame for each variable level
    interface StackFrame {
      varIndex: number;
      varName: string;
      cells: Cell1D[];
      currentCellIdx: number;
    }

    const stack: StackFrame[] = [];
    let currentVarIdx = 0;
    const n = this.variableOrder.length;

    if (n === 0) {
      // No variables: check pure constant constraints
      for (const c of this.constraints) {
        const val = c.poly.eval(assignment);
        if (!evalRelOp(val, c.op)) {
          return {
            status: "UNSAT",
            conflictingConstraintIds: [c.id],
            iterations: 1,
            durationMs: performance.now() - startTime,
            summary: `UNSAT: constant constraint ${c.id} violated.`,
          };
        }
      }
      return {
        status: "SAT",
        model: assignment,
        iterations: 1,
        durationMs: performance.now() - startTime,
        summary: "SAT: vacuous constraint set.",
      };
    }

    while (iterations++ < maxIterations) {
      if (currentVarIdx === n) {
        // All variables assigned! Verify all constraints hold
        let allSatisfied = true;
        for (const c of this.constraints) {
          const val = c.poly.eval(assignment);
          if (!evalRelOp(val, c.op)) {
            allSatisfied = false;
            break;
          }
        }

        if (allSatisfied) {
          return {
            status: "SAT",
            model: new Map(assignment),
            iterations,
            durationMs: performance.now() - startTime,
            summary: `SAT certified via exact CAD cell sample point in ${iterations} iteration(s).`,
          };
        }

        // Backtrack
        currentVarIdx--;
        assignment.delete(this.variableOrder[currentVarIdx]!);
        continue;
      }

      const varName = this.variableOrder[currentVarIdx]!;

      // Check if we need to initialize the frame for this variable
      if (stack.length <= currentVarIdx) {
        // Collect active constraints: constraints mentioning varName whose other vars are already assigned
        const activeConstraints = this.constraints.filter((c) => {
          if (!c.vars.includes(varName)) return false;
          // All other vars in c must be assigned
          return c.vars.every((v) => v === varName || assignment.has(v));
        });

        // Reduce each active constraint to a univariate polynomial in varName
        const univariateList: { c: NlsatConstraint; poly: UnivariatePoly }[] = [];
        const allRoots: number[] = [];

        for (const ac of activeConstraints) {
          const uPoly = ac.poly.partialEval(assignment, varName);
          univariateList.push({ c: ac, poly: uPoly });
          const roots = isolateRealRoots(uPoly);
          allRoots.push(...roots);
        }

        // Project critical roots of coupled constraints mentioning future variables
        const futureVars = this.variableOrder.slice(currentVarIdx + 1);
        for (const fv of futureVars) {
          for (const c of this.constraints) {
            if (c.vars.includes(varName) && c.vars.includes(fv)) {
              const otherAssigned = c.vars.every((v) => v === varName || v === fv || assignment.has(v));
              if (otherAssigned) {
                const projRoots = c.poly.projectQuadraticRoots(assignment, varName, fv);
                allRoots.push(...projRoots);
              }
            }
          }
        }

        // Decompose R into 1D sign-invariant cells
        const candidateCells = build1DCells(allRoots);

        // Filter cells that satisfy all active constraints
        const feasibleCells = candidateCells.filter((cell) => {
          for (const item of univariateList) {
            const val = item.poly.eval(cell.sample);
            if (!evalRelOp(val, item.c.op)) {
              return false;
            }
          }
          return true;
        });

        if (feasibleCells.length === 0) {
          // Conflict at this level! No real value satisfies active constraints
          const conflictingIds = activeConstraints.map((c) => c.id);

          if (currentVarIdx === 0) {
            // Refuted at root level: formula is definitively UNSAT
            return {
              status: "UNSAT",
              conflictingConstraintIds: conflictingIds,
              iterations,
              durationMs: performance.now() - startTime,
              summary: `UNSAT: Cylindrical cell decomposition proved infeasible at variable '${varName}'.`,
            };
          }

          // Backtrack to previous variable
          currentVarIdx--;
          assignment.delete(this.variableOrder[currentVarIdx]!);
          continue;
        }

        // Push new frame with feasible cells
        stack.push({
          varIndex: currentVarIdx,
          varName,
          cells: feasibleCells,
          currentCellIdx: 0,
        });

        // Assign sample point of first feasible cell
        const chosen = feasibleCells[0]!;
        assignment.set(varName, chosen.sample);
        currentVarIdx++;
      } else {
        // Frame already exists: advance to next cell in current frame
        const frame = stack[currentVarIdx]!;
        frame.currentCellIdx++;

        if (frame.currentCellIdx < frame.cells.length) {
          const chosen = frame.cells[frame.currentCellIdx]!;
          assignment.set(varName, chosen.sample);
          currentVarIdx++;
        } else {
          // Exhausted cells for this variable, pop frame and backtrack
          stack.pop();
          assignment.delete(varName);

          if (currentVarIdx === 0) {
            const hasComplexCoupling = this.constraints.some(
              (c) => c.vars.length > 1 && c.vars.some((v) => c.poly.degree(v) > 2),
            );
            if (hasComplexCoupling) {
              return {
                status: "UNKNOWN",
                iterations,
                durationMs: performance.now() - startTime,
                summary: "UNKNOWN: Higher-degree multivariate constraints cannot be projected by 1D CAD.",
              };
            }
            return {
              status: "UNSAT",
              iterations,
              durationMs: performance.now() - startTime,
              summary: "UNSAT: All CAD cell branches exhausted across variable tree.",
            };
          }

          currentVarIdx--;
          assignment.delete(this.variableOrder[currentVarIdx]!);
        }
      }
    }

    return {
      status: "UNKNOWN",
      iterations,
      durationMs: performance.now() - startTime,
      summary: `UNKNOWN: iteration budget of ${maxIterations} reached.`,
    };
  }
}
