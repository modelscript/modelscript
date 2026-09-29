// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Craig Interpolation Engine for Linear Real Arithmetic (T_LRA)
 * and Equality with Uninterpreted Functions (T_EUF).
 *
 * Given mutually inconsistent formulas A and B (A & B |= false), a Craig Interpolant I satisfies:
 *   1. A |= I
 *   2. I & B |= false (I |= ~B)
 *   3. vars(I) subseteq vars(A) cap vars(B)
 *
 * Implements:
 *   - T_LRA Interpolation via Two-Phase Simplex Dual Farkas Multipliers:
 *     Extracts nonnegative lambda_A, lambda_B such that:
 *       lambda_A^T C_A + lambda_B^T C_B = 0
 *       lambda_A^T d_A + lambda_B^T d_B < 0
 *     Yielding the sound separating hyperplane:
 *       I(x) := (lambda_A^T C_A) x <= lambda_A^T d_A
 *     with coefficients vanishing on all variables local to A or B.
 *   - T_EUF Interpolation via Congruence Graph Coloring:
 *     Traces equality paths across the A-B boundary to synthesize conjunctions
 *     of shared equalities proven by A and refuted by B.
 *   - Automated Inductive Invariant Strengthening:
 *     Synthesizes CTI-blocking inductive lemmas directly from refutations.
 *
 * Academic Citations:
 *   - Craig, W. (1957). "Three uses of the Herbrand-Gentzen theorem in realizing Peano arithmetic."
 *     The Journal of Symbolic Logic, 22(3), pp. 269–285. DOI: 10.2307/2963594.
 *   - McMillan, K. L. (2003). "Interpolation and SAT-based model checking."
 *     In Computer Aided Verification (CAV 2003), LNCS 2725, pp. 1–13. Springer.
 *     DOI: 10.1007/978-3-540-45069-6_1.
 *   - Rybalchenko, A., & Sofronie-Stokkermans, V. (2007). "Constraint solving for interpolation."
 *     In Verification, Model Checking, and Abstract Interpretation (VMCAI 2007), LNCS 4349,
 *     pp. 346–362. Springer. DOI: 10.1007/978-3-540-70590-1_25. (Farkas Interpolation for T_LRA)
 *   - Fuchs, A., Goel, A., Grundy, J., Krstić, S., & Tinelli, C. (2009). "Ground interpolation
 *     for the theory of equality." In Tools and Algorithms for the Construction and Analysis
 *     of Systems (TACAS 2009), LNCS 5505, pp. 413–427. Springer. DOI: 10.1007/978-3-642-00768-2_35.
 *
 * ModelScript Architectural Rationale:
 *   Proving unbounded safety properties requires synthesizing inductive invariants that separate
 *   reachable system states from unsafe states. When a bounded safety conjecture is proven UNSAT,
 *   Craig interpolation extracts an explanation expressed exclusively in terms of shared boundary
 *   variables. In ModelScript, interpolants are pushed into IC3/PDR frames and Spacer CHC systems
 *   to block counterexamples to induction (CTIs) across cyber-physical state spaces.
 *
 * Modifications:
 *   - In-engine Two-Phase Simplex solver computes dual Farkas multipliers without external LP libraries.
 *   - Congruence graph coloring traces path cuts across the A-B boundary for T_EUF uninterpreted functions.
 *   - Automatic simplification and variable normalization for downstream inductive verification passes.
 */

import { type ExprNode, type NonlinearConstraint } from "./hc4_contractor.js";
import { toPrimedVar, toUnprimedVar, type InductiveSpec } from "./inductive_prover.js";

export interface LinearConstraint {
  coeffs: Map<string, number>;
  rhs: number; // sum_{v} coeffs[v] * v <= rhs
  origin?: "A" | "B";
}

export interface CraigInterpolantResult {
  status: "INTERPOLANT_FOUND" | "CONSISTENT" | "ERROR";
  interpolant?: NonlinearConstraint;
  linearInterpolant?: {
    coeffs: Map<string, number>;
    rhs: number;
  };
  sharedVars: string[];
  farkasMultipliers?: {
    lambdaA: number[];
    lambdaB: number[];
  };
  summary: string;
}

export interface EufEquality {
  left: string;
  right: string;
}

export interface EufFuncApp {
  func: string;
  args: string[];
  result: string;
}

export interface EufCraigProblem {
  equalitiesA: EufEquality[];
  funcAppsA?: EufFuncApp[];
  equalitiesB: EufEquality[];
  funcAppsB?: EufFuncApp[];
  disequalityB?: { left: string; right: string };
  disequalityA?: { left: string; right: string };
}

export interface EufCraigResult {
  status: "INTERPOLANT_FOUND" | "CONSISTENT";
  interpolantEqualities: EufEquality[];
  sharedVars: string[];
  summary: string;
}

/**
 * Congruence closure engine with function application indexing for EUF interpolation.
 */
export class CongruenceClosure {
  private parent = new Map<string, string>();
  private funcMap = new Map<string, EufFuncApp[]>();

  public find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const nxt = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = nxt;
    }
    return root;
  }

  public union(x: string, y: string): boolean {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;
    this.parent.set(rx, ry);
    this.propagateCongruence();
    return true;
  }

  public addFuncApp(app: EufFuncApp): void {
    const list = this.funcMap.get(app.func) ?? [];
    list.push(app);
    this.funcMap.set(app.func, list);
    this.find(app.result);
    for (const a of app.args) this.find(a);
    this.propagateCongruence();
  }

  public propagateCongruence(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [, apps] of this.funcMap.entries()) {
        for (let i = 0; i < apps.length; i++) {
          for (let j = i + 1; j < apps.length; j++) {
            const app1 = apps[i]!;
            const app2 = apps[j]!;
            if (app1.args.length === app2.args.length) {
              let allArgsCongruent = true;
              for (let k = 0; k < app1.args.length; k++) {
                if (this.find(app1.args[k]!) !== this.find(app2.args[k]!)) {
                  allArgsCongruent = false;
                  break;
                }
              }
              if (allArgsCongruent) {
                const r1 = this.find(app1.result);
                const r2 = this.find(app2.result);
                if (r1 !== r2) {
                  this.parent.set(r1, r2);
                  changed = true;
                }
              }
            }
          }
        }
      }
    }
  }

  public areEqual(x: string, y: string): boolean {
    return this.find(x) === this.find(y);
  }
}

export class CraigInterpolator {
  /**
   * Extracts linear constraints from an arbitrary NonlinearConstraint AST if affine.
   * Returns null if non-linear (e.g. sin, cos, sqr, div).
   */
  public static toLinearConstraints(c: NonlinearConstraint): LinearConstraint[] | null {
    const affine = CraigInterpolator.extractAffineTerms(c.expr);
    if (!affine) return null;

    const results: LinearConstraint[] = [];
    const rhsVal = c.rhs - affine.constant;

    if (c.rel === "<=") {
      results.push({ coeffs: affine.coeffs, rhs: rhsVal });
    } else if (c.rel === ">=") {
      const inverted = new Map<string, number>();
      for (const [k, v] of affine.coeffs.entries()) {
        inverted.set(k, -v);
      }
      results.push({ coeffs: inverted, rhs: -rhsVal });
    } else if (c.rel === "==") {
      // Split == into <= and >=
      results.push({ coeffs: new Map(affine.coeffs), rhs: rhsVal });
      const inverted = new Map<string, number>();
      for (const [k, v] of affine.coeffs.entries()) {
        inverted.set(k, -v);
      }
      results.push({ coeffs: inverted, rhs: -rhsVal });
    }

    return results;
  }

  private static extractAffineTerms(node: ExprNode): { coeffs: Map<string, number>; constant: number } | null {
    switch (node.kind) {
      case "var": {
        const m = new Map<string, number>();
        m.set(node.name, 1);
        return { coeffs: m, constant: 0 };
      }
      case "const": {
        return { coeffs: new Map(), constant: node.value };
      }
      case "neg": {
        const child = CraigInterpolator.extractAffineTerms(node.child);
        if (!child) return null;
        const m = new Map<string, number>();
        for (const [k, v] of child.coeffs.entries()) m.set(k, -v);
        return { coeffs: m, constant: -child.constant };
      }
      case "add": {
        const l = CraigInterpolator.extractAffineTerms(node.left);
        const r = CraigInterpolator.extractAffineTerms(node.right);
        if (!l || !r) return null;
        const m = new Map(l.coeffs);
        for (const [k, v] of r.coeffs.entries()) {
          m.set(k, (m.get(k) ?? 0) + v);
        }
        return { coeffs: m, constant: l.constant + r.constant };
      }
      case "sub": {
        const l = CraigInterpolator.extractAffineTerms(node.left);
        const r = CraigInterpolator.extractAffineTerms(node.right);
        if (!l || !r) return null;
        const m = new Map(l.coeffs);
        for (const [k, v] of r.coeffs.entries()) {
          m.set(k, (m.get(k) ?? 0) - v);
        }
        return { coeffs: m, constant: l.constant - r.constant };
      }
      case "mul": {
        // One side must be constant
        const l = CraigInterpolator.extractAffineTerms(node.left);
        const r = CraigInterpolator.extractAffineTerms(node.right);
        if (!l || !r) return null;
        if (l.coeffs.size === 0) {
          // left is constant
          const m = new Map<string, number>();
          for (const [k, v] of r.coeffs.entries()) m.set(k, v * l.constant);
          return { coeffs: m, constant: r.constant * l.constant };
        } else if (r.coeffs.size === 0) {
          // right is constant
          const m = new Map<string, number>();
          for (const [k, v] of l.coeffs.entries()) m.set(k, v * r.constant);
          return { coeffs: m, constant: l.constant * r.constant };
        }
        return null; // nonlinear multiplication of two variable expressions
      }
      default:
        return null;
    }
  }

  /**
   * Computes a Craig Interpolant for Linear Real Arithmetic (T_LRA) between constraint sets A and B.
   * If A & B is unsatisfiable, returns interpolant I such that:
   *   A |= I, I & B |= false, vars(I) subseteq vars(A) cap vars(B).
   */
  public static interpolateLRA(
    constraintsA: LinearConstraint[],
    constraintsB: LinearConstraint[],
  ): CraigInterpolantResult {
    const mA = constraintsA.length;
    const mB = constraintsB.length;
    const m = mA + mB;

    if (mA === 0 || mB === 0) {
      return {
        status: "CONSISTENT",
        sharedVars: [],
        summary: "Consistent: empty constraint set provided.",
      };
    }

    const varsA = new Set<string>();
    for (const c of constraintsA) {
      for (const v of c.coeffs.keys()) varsA.add(v);
    }
    const varsB = new Set<string>();
    for (const c of constraintsB) {
      for (const v of c.coeffs.keys()) varsB.add(v);
    }

    const allVars = Array.from(new Set([...varsA, ...varsB]));
    const sharedVars = allVars.filter((v) => varsA.has(v) && varsB.has(v));
    const n = allVars.length;

    const allConstraints = [...constraintsA, ...constraintsB];
    const d = allConstraints.map((c) => c.rhs);

    // Formulation of Farkas Dual LP:
    // Variables: lambda_0, ..., lambda_{m-1} >= 0
    // Rows 0..n-1: sum_{i=0}^{m-1} C_{i, j} * lambda_i = 0  (for each variable j)
    // Row n: sum_{i=0}^{m-1} lambda_i = 1                   (normalization to unit simplex)
    // Objective: Minimize sum_{i=0}^{m-1} d_i * lambda_i
    const numRows = n + 1;
    const numCols = m + numRows;

    const T: number[][] = Array.from({ length: numRows + 1 }, () => new Array<number>(numCols + 1).fill(0));
    const basic = new Array<number>(numRows);

    for (let j = 0; j < n; j++) {
      const v = allVars[j]!;
      for (let i = 0; i < m; i++) {
        T[j]![i] = allConstraints[i]!.coeffs.get(v) ?? 0;
      }
      const aCol = m + j;
      T[j]![aCol] = 1;
      T[j]![numCols] = 0;
      basic[j] = aCol;
    }

    // Row n: sum lambda_i = 1
    for (let i = 0; i < m; i++) {
      T[n]![i] = 1;
    }
    const aColN = m + n;
    T[n]![aColN] = 1;
    T[n]![numCols] = 1;
    basic[n] = aColN;

    const pivot = (leaveRow: number, enterCol: number) => {
      const pivotVal = T[leaveRow]![enterCol]!;
      for (let c = 0; c <= numCols; c++) {
        T[leaveRow]![c] /= pivotVal;
      }
      for (let r = 0; r <= numRows; r++) {
        if (r !== leaveRow) {
          const factor = T[r]![enterCol]!;
          if (Math.abs(factor) > 1e-15) {
            for (let c = 0; c <= numCols; c++) {
              T[r]![c] -= factor * T[leaveRow]![c]!;
            }
          }
        }
      }
      basic[leaveRow] = enterCol;
    };

    // Phase I: Maximize - sum(artificial)
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < m; c++) {
        T[numRows]![c] -= T[r]![c]!;
      }
      T[numRows]![numCols] -= T[r]![numCols]!;
    }

    let iter = 0;
    while (iter++ < 300) {
      let enterCol = -1;
      let minCost = -1e-9;
      for (let c = 0; c < m; c++) {
        if (T[numRows]![c]! < minCost) {
          minCost = T[numRows]![c]!;
          enterCol = c;
        }
      }
      if (enterCol === -1) break;

      let leaveRow = -1;
      let minRatio = Infinity;
      for (let r = 0; r < numRows; r++) {
        const coeff = T[r]![enterCol]!;
        if (coeff > 1e-9) {
          const ratio = Math.max(0, T[r]![numCols]!) / coeff;
          if (ratio < minRatio - 1e-12) {
            minRatio = ratio;
            leaveRow = r;
          }
        }
      }
      if (leaveRow === -1) break;
      pivot(leaveRow, enterCol);
    }

    if (T[numRows]![numCols]! < -1e-5) {
      // Infeasible equality constraints on simplex: no Farkas certificate
      return {
        status: "CONSISTENT",
        sharedVars,
        summary: "Consistent: no Farkas dual multipliers satisfy variable balance.",
      };
    }

    // Phase II: Maximize - sum(d_i * lambda_i) => Minimize sum(d_i * lambda_i)
    for (let c = 0; c <= numCols; c++) T[numRows]![c] = 0;

    for (let i = 0; i < m; i++) {
      T[numRows]![i] = d[i]!;
    }

    for (let r = 0; r < numRows; r++) {
      const bVar = basic[r]!;
      if (bVar < m) {
        const coeff = T[numRows]![bVar]!;
        for (let c = 0; c <= numCols; c++) {
          T[numRows]![c] -= coeff * T[r]![c]!;
        }
      }
    }

    iter = 0;
    while (iter++ < 300) {
      let enterCol = -1;
      let minCost = -1e-9;
      for (let c = 0; c < m; c++) {
        if (T[numRows]![c]! < minCost) {
          minCost = T[numRows]![c]!;
          enterCol = c;
        }
      }
      if (enterCol === -1) break;

      let leaveRow = -1;
      let minRatio = Infinity;
      for (let r = 0; r < numRows; r++) {
        const coeff = T[r]![enterCol]!;
        if (coeff > 1e-9) {
          const ratio = Math.max(0, T[r]![numCols]!) / coeff;
          if (ratio < minRatio - 1e-12) {
            minRatio = ratio;
            leaveRow = r;
          }
        }
      }
      if (leaveRow === -1) break;
      pivot(leaveRow, enterCol);
    }

    const lambda = new Array<number>(m).fill(0);
    for (let r = 0; r < numRows; r++) {
      if (basic[r]! < m) {
        lambda[basic[r]!] = Math.max(0, T[r]![numCols]!);
      }
    }

    let actualZ = 0;
    for (let i = 0; i < m; i++) {
      actualZ += d[i]! * lambda[i]!;
    }

    const lambdaA = lambda.slice(0, mA);
    const lambdaB = lambda.slice(mA);

    if (actualZ >= -1e-6) {
      return {
        status: "CONSISTENT",
        sharedVars,
        farkasMultipliers: { lambdaA, lambdaB },
        summary: `Consistent: optimal dual Farkas value Z* = ${actualZ.toFixed(6)} >= 0.`,
      };
    }

    // Inconsistent! Extract Craig interpolant:
    // w = sum_{i=0}^{mA-1} lambdaA[i] * C_A[i]
    // a_eff = sum_{i=0}^{mA-1} lambdaA[i] * rhs_A[i]
    const rawCoeffs = new Map<string, number>();
    for (let i = 0; i < mA; i++) {
      const lam = lambdaA[i]!;
      if (Math.abs(lam) < 1e-9) continue;
      for (const [v, cVal] of constraintsA[i]!.coeffs.entries()) {
        rawCoeffs.set(v, (rawCoeffs.get(v) ?? 0) + lam * cVal);
      }
    }

    let aEff = 0;
    for (let i = 0; i < mA; i++) {
      aEff += lambdaA[i]! * constraintsA[i]!.rhs;
    }

    // Strictly retain only shared variables and remove numerical residuals
    const cleanedCoeffs = new Map<string, number>();
    for (const [v, cVal] of rawCoeffs.entries()) {
      if (sharedVars.includes(v) && Math.abs(cVal) > 1e-7) {
        cleanedCoeffs.set(v, cVal);
      }
    }

    // Normalize coefficients for readability (scale so max coefficient magnitude is 1 or integer)
    let maxCoeff = 0;
    for (const val of cleanedCoeffs.values()) {
      if (Math.abs(val) > maxCoeff) maxCoeff = Math.abs(val);
    }

    const normalizedCoeffs = new Map<string, number>();
    let normalizedRhs = aEff;
    if (maxCoeff > 1e-8) {
      for (const [k, v] of cleanedCoeffs.entries()) {
        normalizedCoeffs.set(k, v / maxCoeff);
      }
      normalizedRhs = aEff / maxCoeff;
    } else {
      for (const [k, v] of cleanedCoeffs.entries()) {
        normalizedCoeffs.set(k, v);
      }
    }

    // Build AST representation of the linear constraint: sum c_i * x_i <= normalizedRhs
    const expr = CraigInterpolator.buildLinearAst(normalizedCoeffs);
    const interpolantConstraint: NonlinearConstraint = {
      expr,
      rel: "<=",
      rhs: normalizedRhs,
    };

    return {
      status: "INTERPOLANT_FOUND",
      interpolant: interpolantConstraint,
      linearInterpolant: {
        coeffs: normalizedCoeffs,
        rhs: normalizedRhs,
      },
      sharedVars,
      farkasMultipliers: { lambdaA, lambdaB },
      summary: `Craig interpolant synthesized via Farkas certificate (dual value ${actualZ.toFixed(4)}).`,
    };
  }

  /**
   * Craig Interpolation for Equality with Uninterpreted Functions (T_EUF).
   * Finds minimal conjunction of shared equalities proven by A and refuted by B.
   */
  public static interpolateEUF(problem: EufCraigProblem): EufCraigResult {
    const varsA = new Set<string>();
    for (const eq of problem.equalitiesA) {
      varsA.add(eq.left);
      varsA.add(eq.right);
    }
    if (problem.funcAppsA) {
      for (const f of problem.funcAppsA) {
        varsA.add(f.result);
        for (const a of f.args) varsA.add(a);
      }
    }

    const varsB = new Set<string>();
    for (const eq of problem.equalitiesB) {
      varsB.add(eq.left);
      varsB.add(eq.right);
    }
    if (problem.funcAppsB) {
      for (const f of problem.funcAppsB) {
        varsB.add(f.result);
        for (const a of f.args) varsB.add(a);
      }
    }
    if (problem.disequalityB) {
      varsB.add(problem.disequalityB.left);
      varsB.add(problem.disequalityB.right);
    }

    const sharedVars = Array.from(varsA).filter((v) => varsB.has(v));

    // 1. Congruence Closure on A
    const ccA = new CongruenceClosure();
    if (problem.funcAppsA) {
      for (const f of problem.funcAppsA) ccA.addFuncApp(f);
    }
    for (const eq of problem.equalitiesA) {
      ccA.union(eq.left, eq.right);
    }

    // 2. Discover all shared equalities implied by A
    const sharedImplied: EufEquality[] = [];
    for (let i = 0; i < sharedVars.length; i++) {
      for (let j = i + 1; j < sharedVars.length; j++) {
        const v1 = sharedVars[i]!;
        const v2 = sharedVars[j]!;
        if (ccA.areEqual(v1, v2)) {
          sharedImplied.push({ left: v1, right: v2 });
        }
      }
    }

    // 3. Test if B + sharedImplied refutes disequality in B
    if (problem.disequalityB) {
      const ccB = new CongruenceClosure();
      if (problem.funcAppsB) {
        for (const f of problem.funcAppsB) ccB.addFuncApp(f);
      }
      for (const eq of problem.equalitiesB) {
        ccB.union(eq.left, eq.right);
      }

      if (ccB.areEqual(problem.disequalityB.left, problem.disequalityB.right)) {
        return {
          status: "INTERPOLANT_FOUND",
          interpolantEqualities: [],
          sharedVars,
          summary: "True (B is already refuted without additional shared equalities).",
        };
      }

      const minimalEqualities: EufEquality[] = [];
      for (const eq of sharedImplied) {
        ccB.union(eq.left, eq.right);
        minimalEqualities.push(eq);
        if (ccB.areEqual(problem.disequalityB.left, problem.disequalityB.right)) {
          return {
            status: "INTERPOLANT_FOUND",
            interpolantEqualities: minimalEqualities,
            sharedVars,
            summary: `Interpolant: ${minimalEqualities.map((e) => `${e.left} == ${e.right}`).join(" && ")}`,
          };
        }
      }
    }

    return {
      status: "CONSISTENT",
      interpolantEqualities: [],
      sharedVars,
      summary: "Consistent: no refutation between A and B in EUF.",
    };
  }

  /**
   * Synthesizes an inductive strengthening lemma targeting a Counterexample to Induction (CTI)
   * using Craig Interpolation over the 1-step reachability unrolling.
   *
   * Formula A: Init(x) & Transition(x, x')
   * Formula B: CTI(x') & (failedConstraint(x') or state match)
   *
   * An interpolant I(x') over shared variables x' proves that:
   *   1. All states reachable from Init in 1 step satisfy I(x')
   *   2. I(x') contradicts the CTI state
   *   3. When unprimed, I(x) acts as a candidate inductive lemma.
   */
  public static synthesizeInductiveLemmas(
    spec: InductiveSpec,
    ctiPreState: Map<string, number | { lo: number; hi: number }>,
    failedConstraint?: NonlinearConstraint,
  ): NonlinearConstraint[] {
    const lemmas: NonlinearConstraint[] = [];

    // Linearize Init and Transition for formula A
    const linA: LinearConstraint[] = [];
    for (const initC of spec.init) {
      const parsed = CraigInterpolator.toLinearConstraints(initC);
      if (parsed) linA.push(...parsed);
    }
    for (const transC of spec.transition) {
      const parsed = CraigInterpolator.toLinearConstraints(transC);
      if (parsed) linA.push(...parsed);
    }

    if (linA.length === 0) return lemmas;

    // Strategy 1: Interpolate Init & Transition (A) vs. CTI as next state (B)
    const linB: LinearConstraint[] = [];
    for (const [varName, val] of ctiPreState.entries()) {
      const primedName = toPrimedVar(varName);
      if (typeof val === "number") {
        linB.push({ coeffs: new Map([[primedName, 1]]), rhs: val });
        linB.push({ coeffs: new Map([[primedName, -1]]), rhs: -val });
      } else {
        if (Number.isFinite(val.hi)) {
          linB.push({ coeffs: new Map([[primedName, 1]]), rhs: val.hi });
        }
        if (Number.isFinite(val.lo)) {
          linB.push({ coeffs: new Map([[primedName, -1]]), rhs: -val.lo });
        }
      }
    }

    if (linB.length > 0) {
      const res = CraigInterpolator.interpolateLRA(linA, linB);
      if (res.status === "INTERPOLANT_FOUND" && res.linearInterpolant) {
        // Unprime variables in interpolant to produce lemma on x
        const unprimedCoeffs = new Map<string, number>();
        for (const [k, v] of res.linearInterpolant.coeffs.entries()) {
          unprimedCoeffs.set(toUnprimedVar(k), v);
        }
        const lemmaExpr = CraigInterpolator.buildLinearAst(unprimedCoeffs);
        lemmas.push({
          expr: lemmaExpr,
          rel: "<=",
          rhs: res.linearInterpolant.rhs,
        });
      }
    }

    // Strategy 2: If failedConstraint exists and is linear, interpolate directly against negation of failedConstraint
    if (failedConstraint) {
      const linFailed = CraigInterpolator.toLinearConstraints(failedConstraint);
      if (linFailed) {
        // Negation of failedConstraint as primed constraint in B
        const negB: LinearConstraint[] = [];
        for (const lf of linFailed) {
          // lf is sum c_i * x_i <= rhs
          // Negation: sum (-c_i) * x_i' <= -rhs - 1e-4
          const primedNegCoeffs = new Map<string, number>();
          for (const [k, v] of lf.coeffs.entries()) {
            primedNegCoeffs.set(toPrimedVar(k), -v);
          }
          negB.push({
            coeffs: primedNegCoeffs,
            rhs: -lf.rhs - 1e-3,
          });
        }

        if (negB.length > 0) {
          const resFailed = CraigInterpolator.interpolateLRA(linA, negB);
          if (resFailed.status === "INTERPOLANT_FOUND" && resFailed.linearInterpolant) {
            const unprimedCoeffs = new Map<string, number>();
            for (const [k, v] of resFailed.linearInterpolant.coeffs.entries()) {
              unprimedCoeffs.set(toUnprimedVar(k), v);
            }
            const lemmaExpr = CraigInterpolator.buildLinearAst(unprimedCoeffs);
            lemmas.push({
              expr: lemmaExpr,
              rel: "<=",
              rhs: resFailed.linearInterpolant.rhs,
            });
          }
        }
      }
    }

    return lemmas;
  }

  /**
   * Helper to construct a clean ExprNode from a linear combination sum_{v} coeffs[v] * v.
   */
  private static buildLinearAst(coeffs: Map<string, number>): ExprNode {
    const terms: ExprNode[] = [];

    for (const [varName, coeff] of coeffs.entries()) {
      const rounded = Math.round(coeff * 1e5) / 1e5;
      if (Math.abs(rounded) < 1e-8) continue;

      if (rounded === 1) {
        terms.push({ kind: "var", name: varName });
      } else if (rounded === -1) {
        terms.push({ kind: "neg", child: { kind: "var", name: varName } });
      } else {
        terms.push({
          kind: "mul",
          left: { kind: "const", value: rounded },
          right: { kind: "var", name: varName },
        });
      }
    }

    if (terms.length === 0) {
      return { kind: "const", value: 0 };
    }

    let root = terms[0]!;
    for (let i = 1; i < terms.length; i++) {
      const nextTerm = terms[i]!;
      if (nextTerm.kind === "neg") {
        root = { kind: "sub", left: root, right: nextTerm.child };
      } else {
        root = { kind: "add", left: root, right: nextTerm };
      }
    }

    return root;
  }
}
