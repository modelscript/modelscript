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
import { type NlsatConstraint, NlsatSolver } from "./nlsat_solver.js";
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
    case "pow":
      extractVariablesFromNode(node.left, out);
      extractVariablesFromNode(node.right, out);
      break;
    case "call":
      for (const arg of node.args) {
        extractVariablesFromNode(arg, out);
      }
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
    case "pow": {
      if (node.right.kind === "const" && Number.isInteger(node.right.value) && node.right.value >= 0) {
        const base = exprNodeToPolynomial(node.left, allVars);
        if (!base) return null;
        let acc = new Polynomial([new Term(1, new Map())], allVars);
        for (let i = 0; i < node.right.value; i++) {
          acc = acc.mul(base);
        }
        return acc;
      }
      return null;
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
  theoryLiterals?: Map<LitId, NonlinearConstraint> | undefined;
  initialBox?: Map<string, Interval> | undefined;
  delta?: number | undefined;
  maxSubdivisions?: number | undefined;
  coordinator?: SemanticTheoryCoordinator | undefined;
  multiTheoryLiterals?: Map<LitId, TheoryLiteral> | undefined;
  useNlsat?: boolean | undefined;
}

export type SmtStatus = "DELTA_SAT" | "UNSAT" | "UNKNOWN";

export interface SmtResult {
  status: SmtStatus;
  solutionBox?: Map<string, Interval> | undefined;
  conflictsEncountered: number;
  subdivisions: number;
  summary: string;
}

export class DpllTSolver {
  private sat: CdclSatSolver;
  private theoryLits: Map<LitId, NonlinearConstraint>;
  private multiTheoryLiterals: Map<LitId, TheoryLiteral>;
  private coordinator?: SemanticTheoryCoordinator | undefined;
  private delta: number;
  private maxSubdivisions: number;
  private useNlsat: boolean;
  private initialBox?: Map<string, Interval> | undefined;
  private conflicts = 0;
  private subdivisions = 0;
  /** Allocated SAT literal IDs for interface equalities `(varA == varB)` used in non-convex splitting. */
  private interfaceEqLits = new Map<string, LitId>();
  private nextFreshLitId = 1;

  constructor(problem: SmtProblem) {
    this.sat = new CdclSatSolver();
    this.theoryLits = new Map(problem.theoryLiterals ?? []);
    this.multiTheoryLiterals = new Map(problem.multiTheoryLiterals ?? []);
    this.coordinator = problem.coordinator;
    this.delta = problem.delta ?? 1e-3;
    this.maxSubdivisions = problem.maxSubdivisions ?? 1000;
    this.useNlsat = problem.useNlsat ?? true;
    this.initialBox = problem.initialBox;

    let maxVar = 0;
    for (const c of problem.clauses) {
      this.sat.addClause(c);
      for (const l of c) {
        if (Math.abs(l) > maxVar) maxVar = Math.abs(l);
      }
    }
    for (const l of this.theoryLits.keys()) {
      if (Math.abs(l) > maxVar) maxVar = Math.abs(l);
    }
    for (const l of this.multiTheoryLiterals.keys()) {
      if (Math.abs(l) > maxVar) maxVar = Math.abs(l);
    }
    this.nextFreshLitId = maxVar + 1;
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
  ): { isSat: boolean; budgetExceeded?: boolean | undefined; resultBox?: Map<string, Interval> | undefined } {
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
      return { isSat: false, budgetExceeded: true, resultBox: box };
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
    const rightRes = this.solveTheoryBox(rightBox, constraints);
    if (rightRes.isSat) return rightRes;

    if (leftRes.budgetExceeded || rightRes.budgetExceeded) {
      return {
        isSat: false,
        budgetExceeded: true,
        resultBox: leftRes.resultBox ?? rightRes.resultBox,
      };
    }

    return { isSat: false };
  }

  /**
   * Runs the full DPLL(T) solving loop.
   */
  public solve(initialBox?: Map<string, Interval>): SmtResult {
    const effectiveBox = initialBox ?? this.initialBox;
    const box = effectiveBox ? this.cloneBox(effectiveBox) : new Map<string, Interval>();

    if (this.theoryLits.size > 0) {
      const discoveredVars = new Set<string>();
      for (const c of this.theoryLits.values()) {
        extractVariablesFromNode(c.expr, discoveredVars);
      }
      for (const v of discoveredVars) {
        if (!box.has(v)) {
          box.set(v, new Interval(-1e5, 1e5));
        }
      }
    }

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
      let coordActiveLitIds: LitId[] = [];
      const coordTightenedBounds = new Map<string, [number, number]>();
      let coordPushed = false;

      try {
        if (this.coordinator && (this.multiTheoryLiterals.size > 0 || this.theoryLits.size > 0)) {
          this.coordinator.pushLevel();
          coordPushed = true;
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
                // Invert relational bound or constant equality predicate if applicable
                if (tLit.predicate === "bound" && tLit.args.length >= 3) {
                  const op = tLit.args[1];
                  const invOp =
                    op === "<="
                      ? ">"
                      : op === ">="
                        ? "<"
                        : op === "<"
                          ? ">="
                          : op === ">"
                            ? "<="
                            : op === "!="
                              ? "=="
                              : "!=";
                  const cId = this.coordinator.assertLiteral({
                    ...tLitData,
                    args: [tLit.args[0], invOp, tLit.args[2]],
                    isNegated: true,
                  });
                  coordIdToSatLit.set(cId, -litId);
                } else if (tLit.predicate === "equal" && tLit.args.length >= 2) {
                  const [a, b] = tLit.args;
                  if (typeof a === "string" && typeof b === "string") {
                    const bIsNum = b.trim() !== "" && !isNaN(Number(b));
                    const aIsNum = a.trim() !== "" && !isNaN(Number(a));
                    if (bIsNum && !aIsNum) {
                      const cId = this.coordinator.assertLiteral({
                        ...tLitData,
                        predicate: "bound",
                        args: [a, "!=", Number(b)],
                        isNegated: true,
                      });
                      coordIdToSatLit.set(cId, -litId);
                    } else if (aIsNum && !bIsNum) {
                      const cId = this.coordinator.assertLiteral({
                        ...tLitData,
                        predicate: "bound",
                        args: [b, "!=", Number(a)],
                        isNegated: true,
                      });
                      coordIdToSatLit.set(cId, -litId);
                    }
                  }
                }
              }
            }
          }

          coordActiveLitIds = activeLitIds;
          const coordRes = this.coordinator.checkSat();

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

          // Handle non-convex equality disjunctions via Delayed Theory Combination (CDCL case splitting)
          const disjunctions = this.coordinator.collectEqualityDisjunctions();
          let addedSplitClause = false;
          for (const disj of disjunctions) {
            const alreadySatisfied = disj.disjuncts.some(
              ([vA, vB]) => this.coordinator!.getCanonicalVar(vA) === this.coordinator!.getCanonicalVar(vB),
            );
            if (alreadySatisfied) continue;

            const splitClause: LitId[] = [];
            for (const [vA, vB] of disj.disjuncts) {
              const pairKey = vA < vB ? `${vA}\0${vB}` : `${vB}\0${vA}`;
              let eqLit = this.interfaceEqLits.get(pairKey);
              if (eqLit === undefined) {
                eqLit = this.nextFreshLitId++;
                this.interfaceEqLits.set(pairKey, eqLit);
                this.multiTheoryLiterals.set(eqLit, {
                  id: eqLit,
                  predicate: "equal",
                  args: [vA, vB],
                });
              }
              splitClause.push(eqLit);
            }
            if (disj.justifications && disj.justifications.length > 0) {
              for (const jId of disj.justifications) {
                const satLit = coordIdToSatLit.get(jId);
                if (satLit !== undefined) splitClause.push(-satLit);
              }
            } else {
              for (const l of activeLitIds) splitClause.push(-l);
            }
            if (splitClause.length > 0) {
              if (!this.sat.addClause(splitClause)) {
                return {
                  status: "UNSAT",
                  conflictsEncountered: this.conflicts,
                  subdivisions: this.subdivisions,
                  summary: "Problem certified UNSAT after non-convex equality disjunction splitting.",
                };
              }
              addedSplitClause = true;
            }
          }
          if (addedSplitClause) {
            continue;
          }

          const allBounds = this.coordinator.getAllCanonicalBounds();
          for (const [canonVar, b] of allBounds.entries()) {
            coordTightenedBounds.set(canonVar, [b[0], b[1]]);
          }
          for (const [root, members] of this.coordinator.getEquivalenceClasses().entries()) {
            const b = allBounds.get(root);
            if (b) {
              for (const m of members) {
                coordTightenedBounds.set(m, [b[0], b[1]]);
              }
            }
          }
          for (const v of box.keys()) {
            const b = allBounds.get(this.coordinator.getCanonicalVar(v));
            if (b) {
              coordTightenedBounds.set(v, [b[0], b[1]]);
            }
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
                let negatedRel: "<=" | ">=" | "==" | "<" | ">" | "!=";
                switch (constraint.rel) {
                  case "<=":
                    negatedRel = ">";
                    break;
                  case ">=":
                    negatedRel = "<";
                    break;
                  case "<":
                    negatedRel = ">=";
                    break;
                  case ">":
                    negatedRel = "<=";
                    break;
                  case "==":
                    negatedRel = "!=";
                    break;
                  case "!=":
                    negatedRel = "==";
                    break;
                }
                activeConstraints.push({
                  expr: constraint.expr,
                  rel: negatedRel,
                  rhs: constraint.rhs,
                });
              }
            }
          }

          const boxCopy = this.cloneBox(box);
          let boxTighteningConflict = false;
          for (const [v, b] of coordTightenedBounds.entries()) {
            const eps =
              Number.isFinite(b[0]) && Number.isFinite(b[1]) ? 1e-12 * Math.max(Math.abs(b[0]), Math.abs(b[1])) : 0;
            const existing = boxCopy.get(v);
            if (existing) {
              const newLo = Math.max(existing.lo, b[0]);
              const newHi = Math.min(existing.hi, b[1]);
              const mEps =
                Number.isFinite(newLo) && Number.isFinite(newHi)
                  ? 1e-12 * Math.max(Math.abs(newLo), Math.abs(newHi))
                  : 0;
              if (newLo > newHi + mEps) {
                boxTighteningConflict = true;
                break;
              }
              boxCopy.set(v, new Interval(newLo, newHi));
            } else {
              if (b[0] > b[1] + eps) {
                boxTighteningConflict = true;
                break;
              }
              boxCopy.set(v, new Interval(b[0], b[1]));
            }
          }

          // Transfer coordinator variable equalities (v == canonicalRoot) into nonlinear constraints
          if (this.coordinator) {
            const seenPairs = new Set<string>();
            for (const v of Array.from(boxCopy.keys())) {
              const root = this.coordinator.getCanonicalVar(v);
              if (root !== v && boxCopy.has(root)) {
                const pairKey = v < root ? `${v}\0${root}` : `${root}\0${v}`;
                if (!seenPairs.has(pairKey)) {
                  seenPairs.add(pairKey);
                  activeConstraints.push({
                    expr: {
                      kind: "sub",
                      left: { kind: "var", name: v },
                      right: { kind: "var", name: root },
                    },
                    rel: "==",
                    rhs: 0,
                  });
                }
              }
            }
          }

          const combinedConflictLits = () => {
            const set = new Set<LitId>();
            for (const l of activeLits) set.add(-l);
            for (const l of coordActiveLitIds) set.add(-l);
            return Array.from(set);
          };

          const verifyModelAgainstCoordinator = (candidateBox: Map<string, Interval>): boolean => {
            if (!this.coordinator || !coordPushed) return true;
            for (const [v, int] of candidateBox.entries()) {
              if (Number.isFinite(int.lo) && Number.isFinite(int.hi)) {
                this.coordinator.enqueueEvent({
                  kind: "bound",
                  varName: v,
                  bounds: [int.lo, int.hi],
                  sourceOracle: "DpllTSolver",
                });
              }
            }
            const feedbackRes = this.coordinator.checkSat();
            return feedbackRes.isSat;
          };

          if (boxTighteningConflict) {
            this.conflicts++;
            const conflictClause = combinedConflictLits();
            if (!this.sat.addClause(conflictClause)) {
              return {
                status: "UNSAT",
                conflictsEncountered: this.conflicts,
                subdivisions: this.subdivisions,
                summary: "Problem certified UNSAT after coordinator bound intersection with initial domain box.",
              };
            }
            continue;
          }

          // 3a. Exact NLSAT CAD engine for polynomial systems
          if (this.useNlsat) {
            const nlsatConstraints: NlsatConstraint[] = [];
            const cidToLit = new Map<number, LitId>();
            let allPolynomial = true;

            for (let i = 0; i < activeConstraints.length; i++) {
              const cid = i + 1;
              const parsed = NlsatSolver.fromNonlinearConstraint(cid, activeConstraints[i]!);
              if (parsed) {
                nlsatConstraints.push(parsed);
                if (i < activeLits.length) {
                  cidToLit.set(cid, activeLits[i]!);
                }
              } else {
                allPolynomial = false;
                break;
              }
            }

            if (allPolynomial && nlsatConstraints.length > 0) {
              const nlsat = new NlsatSolver(nlsatConstraints, undefined, boxCopy);
              const nlsatRes = nlsat.solve();

              if (nlsatRes.status === "UNSAT") {
                this.conflicts++;
                let conflictClause =
                  nlsatRes.conflictingConstraintIds && nlsatRes.conflictingConstraintIds.length > 0
                    ? nlsatRes.conflictingConstraintIds
                        .filter((cid) => cidToLit.has(cid))
                        .map((cid) => -cidToLit.get(cid)!)
                    : activeLits.map((l) => -l);
                if (coordActiveLitIds.length > 0) {
                  const merged = new Set<LitId>(conflictClause.length > 0 ? conflictClause : activeLits.map((l) => -l));
                  for (const l of coordActiveLitIds) merged.add(-l);
                  conflictClause = Array.from(merged);
                }

                if (!this.sat.addClause(conflictClause.length > 0 ? conflictClause : combinedConflictLits())) {
                  return {
                    status: "UNSAT",
                    conflictsEncountered: this.conflicts,
                    subdivisions: this.subdivisions,
                    summary: `Problem certified UNSAT via NLSAT CAD engine: ${nlsatRes.summary}`,
                  };
                }
                continue;
              } else if (nlsatRes.status === "SAT" && nlsatRes.model) {
                const exactBox = new Map<string, Interval>();
                for (const [v, val] of nlsatRes.model.entries()) {
                  exactBox.set(v, new Interval(val, val));
                }
                if (!verifyModelAgainstCoordinator(exactBox)) {
                  this.conflicts++;
                  const conflictClause = combinedConflictLits();
                  if (!this.sat.addClause(conflictClause)) {
                    return {
                      status: "UNSAT",
                      conflictsEncountered: this.conflicts,
                      subdivisions: this.subdivisions,
                      summary: "Problem certified UNSAT after bidirectional Nelson-Oppen model verification.",
                    };
                  }
                  continue;
                }
                const paddedBox = new Map<string, Interval>();
                for (const [v, val] of nlsatRes.model.entries()) {
                  paddedBox.set(v, new Interval(val - 1e-6, val + 1e-6));
                }
                return {
                  status: "DELTA_SAT",
                  solutionBox: paddedBox,
                  conflictsEncountered: this.conflicts,
                  subdivisions: this.subdivisions,
                  summary: `SAT certified with exact real model via NLSAT CAD: ${nlsatRes.summary}`,
                };
              }
            }
          }

          // 3b. Fall back to Gröbner preprocessing + HC4 interval contraction
          this.subdivisions = 0;
          const theoryRes = this.solveTheoryBox(boxCopy, activeConstraints);

          if (!theoryRes.isSat) {
            if (theoryRes.budgetExceeded) {
              return {
                status: "UNKNOWN",
                solutionBox: theoryRes.resultBox,
                conflictsEncountered: this.conflicts,
                subdivisions: this.subdivisions,
                summary: `Subdivision limit (${this.maxSubdivisions}) reached before achieving delta=${this.delta}.`,
              };
            }

            this.conflicts++;
            const conflictClause = combinedConflictLits();
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

          if (theoryRes.resultBox && !verifyModelAgainstCoordinator(theoryRes.resultBox)) {
            this.conflicts++;
            const conflictClause = combinedConflictLits();
            if (!this.sat.addClause(conflictClause)) {
              return {
                status: "UNSAT",
                conflictsEncountered: this.conflicts,
                subdivisions: this.subdivisions,
                summary: "Problem certified UNSAT after bidirectional Nelson-Oppen box verification.",
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

        // If no nonlinear theoryLits, intersect box with coordinator tightened bounds if any
        const outBox = this.cloneBox(box);
        for (const [v, b] of coordTightenedBounds.entries()) {
          const existing = outBox.get(v);
          if (existing) {
            outBox.set(v, new Interval(Math.max(existing.lo, b[0]), Math.min(existing.hi, b[1])));
          } else {
            outBox.set(v, new Interval(b[0], b[1]));
          }
        }

        // If no box constraints, the coordinator model or Boolean SAT model is certified SAT
        return {
          status: "DELTA_SAT",
          solutionBox: outBox.size > 0 ? outBox : undefined,
          conflictsEncountered: this.conflicts,
          subdivisions: this.subdivisions,
          summary: "Multi-theory satisfiability certified by DPLL(T) solver.",
        };
      } finally {
        if (coordPushed && this.coordinator) {
          this.coordinator.popLevel();
        }
      }
    }
  }
}
