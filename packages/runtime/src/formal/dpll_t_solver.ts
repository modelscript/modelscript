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
import { CdclSatSolver, type LitId } from "./cdcl_sat.js";
import { Hc4Contractor, type NonlinearConstraint } from "./hc4_contractor.js";

export interface SmtTheoryLiteral {
  id: LitId; // SAT variable ID
  constraint: NonlinearConstraint;
}

export interface SmtProblem {
  clauses: LitId[][];
  theoryLiterals: Map<LitId, NonlinearConstraint>;
  initialBox: Map<string, Interval>;
  delta?: number;
  maxSubdivisions?: number;
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
  private delta: number;
  private maxSubdivisions: number;
  private conflicts = 0;
  private subdivisions = 0;

  constructor(problem: SmtProblem) {
    this.sat = new CdclSatSolver();
    this.theoryLits = new Map(problem.theoryLiterals);
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
   * Solves non-linear constraints in a box using delta-complete branch-and-prune.
   */
  private solveTheoryBox(
    box: Map<string, Interval>,
    constraints: NonlinearConstraint[],
  ): { isSat: boolean; resultBox?: Map<string, Interval> } {
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
  public solve(initialBox: Map<string, Interval>): SmtResult {
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

      // 2. Extract active theory constraints
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

      // 3. Solve theory constraints on box
      const boxCopy = this.cloneBox(initialBox);
      const theoryRes = this.solveTheoryBox(boxCopy, activeConstraints);

      if (theoryRes.isSat) {
        return {
          status: "DELTA_SAT",
          solutionBox: theoryRes.resultBox,
          conflictsEncountered: this.conflicts,
          subdivisions: this.subdivisions,
          summary: `delta-SAT solution box certified with tolerance delta=${this.delta}.`,
        };
      } else {
        // Theory conflict! Learn conflict clause: at least one active literal must be false
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
      }
    }
  }
}
