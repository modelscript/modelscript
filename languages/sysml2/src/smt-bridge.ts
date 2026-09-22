// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { extractSysML2Constraints, type ExtractedConstraint } from "./constraint-extractor.js";
import { RealSimplexSolver, parseLinearExpression } from "./real-simplex.js";
export { RealSimplexSolver, parseLinearExpression, type LinearConstraint } from "./real-simplex.js";

export const OCTAGON_INF = 0x3fffffff;

/**
 * Difference Bound Matrix (DBM) engine for SMT numeric theory solving.
 */
export class SmtOctagonDBM {
  private dim: number;
  private matrix: Int32Array;

  constructor(public readonly numVars: number) {
    this.dim = numVars * 2;
    this.matrix = new Int32Array(this.dim * this.dim);
    this.reset();
  }

  reset(): void {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        this.matrix[i * dim + j] = i === j ? 0 : OCTAGON_INF;
      }
    }
  }

  setBound(i: number, j: number, bound: number): void {
    const dim = this.dim;
    if (i >= dim || j >= dim) return;
    const current = this.matrix[i * dim + j];
    if (bound < current) {
      this.matrix[i * dim + j] = bound;
    }
  }

  close(): void {
    const dim = this.dim;
    for (let k = 0; k < dim; k++) {
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          const ik = this.matrix[i * dim + k];
          const kj = this.matrix[k * dim + j];
          if (ik !== OCTAGON_INF && kj !== OCTAGON_INF) {
            const newBound = ik + kj;
            if (newBound < this.matrix[i * dim + j]) {
              this.matrix[i * dim + j] = newBound;
            }
          }
        }
      }
    }
  }

  assumeDiff(var1: number, var2: number, maxDiff: number): void {
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    this.setBound(p1, p2, maxDiff);
    this.setBound(p2 + 1, p1 + 1, maxDiff);
    this.close();
  }

  checkDiff(var1: number, var2: number, limit: number): boolean {
    const dim = this.dim;
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    if (p1 >= dim || p2 >= dim) return true;
    return this.matrix[p1 * dim + p2] <= limit;
  }

  assumeInterval(varIdx: number, lower: number, upper: number): void {
    const p = varIdx * 2;
    if (upper < OCTAGON_INF / 2) {
      this.setBound(p, p + 1, upper * 2);
    }
    if (lower > -OCTAGON_INF / 2) {
      this.setBound(p + 1, p, -lower * 2);
    }
    this.close();
  }

  getUpperBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return OCTAGON_INF;
    const raw = this.matrix[p * dim + (p + 1)];
    return raw >= OCTAGON_INF ? OCTAGON_INF : Math.floor(raw / 2);
  }

  getLowerBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return -OCTAGON_INF;
    const raw = this.matrix[(p + 1) * dim + p];
    return raw >= OCTAGON_INF ? -OCTAGON_INF : Math.ceil(-raw / 2);
  }

  hasNegativeCycle(): boolean {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      if (this.matrix[i * dim + i] < 0) return true;
    }
    return false;
  }
}

/**
 * Result of SMT requirement consistency verification.
 */
export interface SMTRequirementCheckResult {
  isConsistent: boolean;
  conflictingRequirements: string[];
  violatedConstraints: {
    expression: string;
    requirementName?: string;
    reason: string;
  }[];
}

/**
 * Verifies consistency of a set of SysML v2 extracted constraints.
 * Encodes numeric bounds and difference constraints into an Octagon DBM
 * to detect contradictory intervals, impossible budgets, or cycle violations.
 */
export function verifyConstraintSet(constraints: ExtractedConstraint[]): SMTRequirementCheckResult {
  const solver = new RealSimplexSolver();
  const conflictingReqs = new Set<string>();
  const violatedConstraints: { expression: string; requirementName?: string; reason: string }[] = [];
  const bounds = new Map<string, { lower: number; upper: number }>();

  for (const c of constraints) {
    if (typeof c.rhs !== "number") continue;

    const rhs = c.rhs;
    const { terms, constant } = parseLinearExpression(c.lhs);
    const effectiveRhs = rhs - constant;

    // Check single-variable bound consistency
    if (terms.length === 1 && Math.abs((terms[0]?.coeff ?? 0) - 1.0) < 1e-12) {
      const varName = terms[0]!.varName;
      const b = bounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      let violated = false;
      if (c.operator === "<=" || c.operator === "<") {
        if (effectiveRhs < b.lower - 1e-9) violated = true;
        b.upper = Math.min(b.upper, effectiveRhs);
      } else if (c.operator === ">=" || c.operator === ">") {
        if (effectiveRhs > b.upper + 1e-9) violated = true;
        b.lower = Math.max(b.lower, effectiveRhs);
      } else if (c.operator === "==") {
        if (effectiveRhs < b.lower - 1e-9 || effectiveRhs > b.upper + 1e-9) violated = true;
        b.lower = Math.max(b.lower, effectiveRhs);
        b.upper = Math.min(b.upper, effectiveRhs);
      }
      bounds.set(varName, b);

      if (violated) {
        if (c.requirementName) conflictingReqs.add(c.requirementName);
        violatedConstraints.push({
          expression: c.expression,
          requirementName: c.requirementName,
          reason: `Contradiction with prior bound for variable '${c.lhs}' (evaluated bound: ${rhs})`,
        });
        break;
      }
    }

    // Add to RealSimplexSolver
    solver.addConstraint({
      requirementName: c.requirementName,
      terms: terms.length > 0 ? terms : [{ varName: c.lhs, coeff: 1 }],
      operator: c.operator,
      rhs: effectiveRhs,
      expression: c.expression,
    });

    const res = solver.solve();
    if (!res.isFeasible) {
      if (c.requirementName) conflictingReqs.add(c.requirementName);
      if (res.unsatCore) {
        for (const req of res.unsatCore) conflictingReqs.add(req);
      }
      violatedConstraints.push({
        expression: c.expression,
        requirementName: c.requirementName,
        reason:
          res.conflictExplanation ?? `Contradiction with prior bound for variable '${c.lhs}' (evaluated bound: ${rhs})`,
      });
      break;
    }
  }

  // If a contradiction was detected, find all participating requirements
  if (violatedConstraints.length > 0) {
    for (const c of constraints) {
      if (c.requirementName) conflictingReqs.add(c.requirementName);
    }
  }

  return {
    isConsistent: violatedConstraints.length === 0,
    conflictingRequirements: Array.from(conflictingReqs),
    violatedConstraints,
  };
}

/**
 * Validates the requirement consistency for a package or analysis scope via QueryDB.
 */
export function checkRequirementConsistency(db: QueryDB, scopeFilter?: string): SMTRequirementCheckResult {
  const constraints = extractSysML2Constraints(db, scopeFilter);
  if (!constraints || constraints.length === 0) {
    return {
      isConsistent: true,
      conflictingRequirements: [],
      violatedConstraints: [],
    };
  }
  return verifyConstraintSet(constraints);
}
