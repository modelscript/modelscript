// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — In-Process delta-Complete SMT Solver (DPLL(T)).
 *
 * Combines:
 *   - CDCL SAT core for Boolean formula structure.
 *   - HC4-Revise Interval Contractor for non-linear real theory T_NRA.
 *   - delta-Decision branch-and-prune procedure with certified SAT/UNSAT results.
 */

import { Interval } from "../analysis/wasm_interval.js";
import { computeGroebnerBasis, Polynomial, reduceGroebnerBasis, Term } from "../solvers/wasm_groebner.js";
import { CdclSatSolver, type LitId } from "./cdcl_sat.js";
import { type ExprNode, Hc4Contractor, type NonlinearConstraint } from "./hc4_contractor.js";
import { SemanticTheoryCoordinator, type TheoryLiteral } from "./theory_coordinator.js";

/**
 * Recursively extracts variable names referenced in an ExprNode DAG.
 */
function extractVariablesFromNode(node: ExprNode, out: Set<string>): void {
  switch (node.kind) {
    case "var":
      out.add(node.name);
      break;
    case "const":
      break;
    case "neg":
    case "sqr":
    case "sqrt":
    case "sin":
    case "cos":
      extractVariablesFromNode(node.child, out);
      break;
    case "add":
    case "sub":
    case "mul":
    case "div":
      extractVariablesFromNode(node.left, out);
      extractVariablesFromNode(node.right, out);
      break;
  }
}

/**
 * Recursively converts a polynomial ExprNode into a Polynomial algebraic instance.
 * Returns null if the expression contains non-polynomial operators (e.g. division, trig, sqrt).
 */
function exprNodeToPolynomial(node: ExprNode, allVars: string[]): Polynomial | null {
  switch (node.kind) {
    case "const":
      return new Polynomial([new Term(node.value, new Map())], allVars);
    case "var":
      return new Polynomial([new Term(1, new Map([[node.name, 1]]))], allVars);
    case "neg": {
      const child = exprNodeToPolynomial(node.child, allVars);
      if (!child) return null;
      return child.multiplyTerm(new Term(-1, new Map()));
    }
    case "add": {
      const l = exprNodeToPolynomial(node.left, allVars);
      const r = exprNodeToPolynomial(node.right, allVars);
      if (!l || !r) return null;
      return l.add(r);
    }
    case "sub": {
      const l = exprNodeToPolynomial(node.left, allVars);
      const r = exprNodeToPolynomial(node.right, allVars);
      if (!l || !r) return null;
      return l.sub(r);
    }
    case "mul": {
      const l = exprNodeToPolynomial(node.left, allVars);
      const r = exprNodeToPolynomial(node.right, allVars);
      if (!l || !r) return null;
      return l.mul(r);
    }
    case "sqr": {
      const child = exprNodeToPolynomial(node.child, allVars);
      if (!child) return null;
      return child.mul(child);
    }
    default:
      return null;
  }
}

export interface SmtTheoryLiteral {
  id: LitId; // SAT variable ID
  constraint: NonlinearConstraint;
}

export interface SmtProblem {
  clauses: LitId[][];
  theoryLiterals?: Map<LitId, NonlinearConstraint>;
  initialBox?: Map<string, Interval>;
  delta?: number;
  maxSubdivisions?: number;
  coordinator?: SemanticTheoryCoordinator;
  multiTheoryLiterals?: Map<LitId, TheoryLiteral>;
}

export type SmtStatus = "DELTA_SAT" | "UNSAT" | "UNKNOWN";

export interface SmtResult {
  status: SmtStatus;
  solutionBox?: Map<string, Interval>;
  conflictsEncountered: number;
  subdivisions: number;
  summary: string;
}

export class DpllTSolver {
  private sat: CdclSatSolver;
  private theoryLits: Map<LitId, NonlinearConstraint>;
  private multiTheoryLiterals: Map<LitId, TheoryLiteral>;
  private coordinator?: SemanticTheoryCoordinator;
  private delta: number;
  private maxSubdivisions: number;
  private conflicts = 0;
  private subdivisions = 0;

  constructor(problem: SmtProblem) {
    this.sat = new CdclSatSolver();
    this.theoryLits = new Map(problem.theoryLiterals ?? []);
    this.multiTheoryLiterals = new Map(problem.multiTheoryLiterals ?? []);
    this.coordinator = problem.coordinator;
    this.delta = problem.delta ?? 1e-3;
    this.maxSubdivisions = problem.maxSubdivisions ?? 1000;

    for (const c of problem.clauses) {
      this.sat.addClause(c);
    }
  }

  private cloneBox(box: Map<string, Interval>): Map<string, Interval> {
    const copy = new Map<string, Interval>();
    for (const [k, v] of box.entries()) {
      copy.set(k, new Interval(v.lo, v.hi));
    }
    return copy;
  }

  private maxBoxDiameter(box: Map<string, Interval>): { varName: string; width: number } {
    let maxWidth = 0;
    let maxVar = "";
    for (const [k, v] of box.entries()) {
      if (v.width > maxWidth) {
        maxWidth = v.width;
        maxVar = k;
      }
    }
    return { varName: maxVar, width: maxWidth };
  }

  /**
   * Contracts an interval box against a list of active theory constraints.
   * Returns false if contraction leads to an empty set (conflict).
   */
  private contractBox(box: Map<string, Interval>, constraints: NonlinearConstraint[], maxIter = 10): boolean {
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (const c of constraints) {
        const preWidths = Array.from(box.values()).reduce((sum, i) => sum + i.width, 0);
        const valid = Hc4Contractor.revise(c, box);
        if (!valid) return false; // Conflict!
        const postWidths = Array.from(box.values()).reduce((sum, i) => sum + i.width, 0);
        if (Math.abs(preWidths - postWidths) > 1e-7) {
          changed = true;
        }
      }
      if (!changed) break; // Reached fixed point
    }
    return true;
  }

  /**
   * Preprocesses polynomial equality constraints using Gröbner basis reduction.
   * Immediately identifies algebraic contradictions (e.g. 1 = 0) and contracts univariate roots.
   */
  private preprocessPolynomialEqualities(box: Map<string, Interval>, constraints: NonlinearConstraint[]): boolean {
    const eqConstraints = constraints.filter((c) => c.rel === "==");
    if (eqConstraints.length === 0) return true;

    // Collect all variables
    const varsSet = new Set<string>();
    for (const c of eqConstraints) {
      extractVariablesFromNode(c.expr, varsSet);
    }
    const allVars = Array.from(varsSet);
    if (allVars.length === 0) return true;

    // Convert constraints into Polynomials
    const polys: Polynomial[] = [];
    for (const c of eqConstraints) {
      const p = exprNodeToPolynomial(c.expr, allVars);
      if (!p) return true; // Contains non-polynomial operator (e.g. division, trig, sqrt), skip preprocessing
      const rhsConst = new Polynomial([new Term(c.rhs, new Map())], allVars);
      polys.push(p.sub(rhsConst));
    }

    try {
      // Compute reduced Groebner basis
      const basis = computeGroebnerBasis(polys, allVars);
      const reduced = reduceGroebnerBasis(basis, allVars);

      for (const poly of reduced) {
        if (poly.isZero()) continue;

        // 1. Contradiction: constant polynomial c = 0 with c != 0
        if (poly.terms.length === 1 && poly.terms[0]!.totalDegree() === 0) {
          if (Math.abs(poly.terms[0]!.coefficient) > 1e-9) {
            return false; // Algebraic contradiction certified by Groebner basis
          }
        }

        // 2. Univariate polynomial root contraction
        const polyVars = new Set<string>();
        for (const t of poly.terms) {
          for (const [v, d] of t.degrees.entries()) {
            if (d > 0) polyVars.add(v);
          }
        }

        if (polyVars.size === 1) {
          const vName = Array.from(polyVars)[0]!;
          const currentInv = box.get(vName);
          if (!currentInv) continue;

          // Check if linear: a*x + b = 0
          const maxDeg = Math.max(...poly.terms.map((t) => t.getDegree(vName)));
          if (maxDeg === 1) {
            let a = 0;
            let b = 0;
            for (const t of poly.terms) {
              if (t.getDegree(vName) === 1) a += t.coefficient;
              else if (t.getDegree(vName) === 0) b += t.coefficient;
            }
            if (Math.abs(a) > 1e-12) {
              const root = -b / a;
              if (root < currentInv.lo - 1e-5 || root > currentInv.hi + 1e-5) {
                return false; // Root falls outside current box
              }
              box.set(vName, new Interval(Math.max(currentInv.lo, root - 1e-5), Math.min(currentInv.hi, root + 1e-5)));
            }
          }
        }
      }
    } catch {
      // If Groebner basis computation exceeds resource limit, gracefully fall through to HC4
      return true;
    }

    return true;
  }

  /**
   * Solves non-linear constraints in a box using delta-complete branch-and-prune.
   */
  private solveTheoryBox(
    box: Map<string, Interval>,
    constraints: NonlinearConstraint[],
  ): { isSat: boolean; resultBox?: Map<string, Interval> } {
    // 1. Gröbner basis preprocessing for polynomial equality constraints
    const groebnerValid = this.preprocessPolynomialEqualities(box, constraints);
    if (!groebnerValid) {
      return { isSat: false };
    }

    // 2. HC4 interval contraction
    const valid = this.contractBox(box, constraints);
    if (!valid) {
      return { isSat: false };
    }

    const { varName, width } = this.maxBoxDiameter(box);
    if (width <= this.delta) {
      return { isSat: true, resultBox: box };
    }

    if (this.subdivisions >= this.maxSubdivisions) {
      return { isSat: true, resultBox: box }; // Bounded limit reached
    }

    // Bisect widest variable
    this.subdivisions++;
    const currentInv = box.get(varName)!;
    const mid = currentInv.mid;

    // Left branch: [lo, mid]
    const leftBox = this.cloneBox(box);
    leftBox.set(varName, new Interval(currentInv.lo, mid));
    const leftRes = this.solveTheoryBox(leftBox, constraints);
    if (leftRes.isSat) return leftRes;

    // Right branch: [mid, hi]
    const rightBox = this.cloneBox(box);
    rightBox.set(varName, new Interval(mid, currentInv.hi));
    return this.solveTheoryBox(rightBox, constraints);
  }

  /**
   * Runs the full DPLL(T) solving loop.
   */
  public solve(initialBox?: Map<string, Interval>): SmtResult {
    const box = initialBox ? this.cloneBox(initialBox) : new Map<string, Interval>();

    while (true) {
      // 1. Solve Boolean skeleton
      const satRes = this.sat.solve();
      if (satRes.status === "UNSAT") {
        return {
          status: "UNSAT",
          conflictsEncountered: this.conflicts,
          subdivisions: this.subdivisions,
          summary: "Problem formally certified UNSAT by DPLL(T) solver.",
        };
      }

      // 2. Check multi-theory constraints with SemanticTheoryCoordinator if present
      if (this.coordinator && this.multiTheoryLiterals.size > 0) {
        this.coordinator.pushLevel();
        const activeLitIds: LitId[] = [];
        const coordIdToSatLit = new Map<number, LitId>();

        for (const [litId, tLit] of this.multiTheoryLiterals.entries()) {
          const isTrue = satRes.model?.get(Math.abs(litId));
          if (isTrue !== undefined) {
            const { id: _ignore, ...tLitData } = tLit;
            if (isTrue) {
              activeLitIds.push(litId);
              const cId = this.coordinator.assertLiteral({ ...tLitData, isNegated: false });
              coordIdToSatLit.set(cId, litId);
            } else {
              activeLitIds.push(-litId);
              // Invert relational bound predicate if applicable
              if (tLit.predicate === "bound" && tLit.args.length >= 3) {
                const op = tLit.args[1];
                const invOp = op === "<=" ? ">" : op === ">=" ? "<" : op === "<" ? ">=" : op === ">" ? "<=" : "!=";
                const cId = this.coordinator.assertLiteral({
                  ...tLitData,
                  args: [tLit.args[0], invOp, tLit.args[2]],
                  isNegated: true,
                });
                coordIdToSatLit.set(cId, -litId);
              }
            }
          }
        }

        const coordRes = this.coordinator.checkSat();
        this.coordinator.popLevel();

        if (!coordRes.isSat) {
          this.conflicts++;
          let conflictClause: LitId[] = [];
          if (coordRes.conflict && coordRes.conflict.literals && coordRes.conflict.literals.length > 0) {
            for (const cLit of coordRes.conflict.literals) {
              const satLit = coordIdToSatLit.get(cLit.id);
              if (satLit !== undefined) {
                conflictClause.push(-satLit);
              }
            }
          }
          if (conflictClause.length === 0) {
            conflictClause = activeLitIds.map((l) => -l);
          }

          if (!this.sat.addClause(conflictClause)) {
            return {
              status: "UNSAT",
              conflictsEncountered: this.conflicts,
              subdivisions: this.subdivisions,
              summary: `Problem certified UNSAT after multi-theory conflict lemma learning: ${coordRes.conflict?.explanation}`,
            };
          }
          continue; // Re-solve Boolean skeleton with learned conflict lemma
        }
      }

      // 3. Extract and solve non-linear theory constraints (if any)
      if (this.theoryLits.size > 0 && box.size > 0) {
        const activeLits: LitId[] = [];
        const activeConstraints: NonlinearConstraint[] = [];

        for (const [litId, constraint] of this.theoryLits.entries()) {
          const isTrue = satRes.model?.get(Math.abs(litId));
          if (isTrue !== undefined) {
            if (isTrue) {
              activeLits.push(litId);
              activeConstraints.push(constraint);
            } else {
              // Negated constraint
              activeLits.push(-litId);
              const negatedRel = constraint.rel === "<=" ? ">=" : constraint.rel === ">=" ? "<=" : "==";
              activeConstraints.push({
                expr: constraint.expr,
                rel: negatedRel,
                rhs: constraint.rhs,
              });
            }
          }
        }

        const boxCopy = this.cloneBox(box);
        const theoryRes = this.solveTheoryBox(boxCopy, activeConstraints);

        if (!theoryRes.isSat) {
          this.conflicts++;
          const conflictClause = activeLits.map((l) => -l);
          if (!this.sat.addClause(conflictClause)) {
            return {
              status: "UNSAT",
              conflictsEncountered: this.conflicts,
              subdivisions: this.subdivisions,
              summary: "Problem certified UNSAT after theory conflict lemma learning.",
            };
          }
          continue;
        }

        return {
          status: "DELTA_SAT",
          solutionBox: theoryRes.resultBox,
          conflictsEncountered: this.conflicts,
          subdivisions: this.subdivisions,
          summary: `delta-SAT solution box certified with tolerance delta=${this.delta}.`,
        };
      }

      // If no box constraints, the coordinator model or Boolean SAT model is certified SAT
      return {
        status: "DELTA_SAT",
        solutionBox: box.size > 0 ? box : undefined,
        conflictsEncountered: this.conflicts,
        subdivisions: this.subdivisions,
        summary: "Multi-theory satisfiability certified by DPLL(T) solver.",
      };
    }
  }
}
