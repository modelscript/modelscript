// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { extractSysML2Constraints, type ExtractedConstraint } from "./constraint-extractor.js";
import { RealSimplexSolver, parseLinearExpression } from "./real-simplex.js";
export { RealSimplexSolver, parseLinearExpression, type LinearConstraint } from "./real-simplex.js";
export { OCTAGON_INF };

import { OCTAGON_INF, OctagonDBM } from "@modelscript/runtime";

/** Backward-compatible alias for the shared OctagonDBM class. */
export { OctagonDBM as SmtOctagonDBM };

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
