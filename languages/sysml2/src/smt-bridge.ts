// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { OCTAGON_INF, OctagonDBM } from "@modelscript/runtime";
import { extractSysML2Constraints, type ExtractedConstraint } from "./constraint-extractor.js";
import { RealSimplexSolver, parseLinearExpression } from "./real-simplex.js";
export { RealSimplexSolver, parseLinearExpression, type LinearConstraint } from "./real-simplex.js";
export { OCTAGON_INF };

/** Backward-compatible alias for the shared OctagonDBM class. */
export { OctagonDBM as SmtOctagonDBM };

/**
 * Result of SMT requirement consistency verification.
 */
export interface SMTRequirementCheckResult {
  /** True if all requirement constraints are mutually satisfiable. */
  isConsistent: boolean;
  /** Names of requirements participating in an unsatisfiable conflict core. */
  conflictingRequirements: string[];
  /** Detailed list of violated or contradictory constraint expressions. */
  violatedConstraints: {
    /** Original constraint expression text. */
    expression: string;
    /** Enclosing requirement name, if known. */
    requirementName?: string | undefined;
    /** Human-readable explanation of why the constraint is unsatisfiable. */
    reason: string;
  }[];
}

/**
 * Verifies consistency of a set of SysML v2 extracted constraints.
 * Encodes numeric bounds and difference constraints into an Octagon DBM
 * and a Linear Real Arithmetic (LRA) Simplex solver to detect contradictory
 * intervals, impossible budgets, or cycle violations.
 *
 * @param constraints - Extracted linear and bound constraints from SysML v2 requirements.
 * @returns Consistency check result with conflicting requirement names and explanations.
 */
export function verifyConstraintSet(constraints: ExtractedConstraint[]): SMTRequirementCheckResult {
  const solver = new RealSimplexSolver();
  const conflictingReqs = new Set<string>();
  const violatedConstraints: { expression: string; requirementName?: string | undefined; reason: string }[] = [];
  const bounds = new Map<
    string,
    { lower: number; upper: number; lowerSourceReq?: string | undefined; upperSourceReq?: string | undefined }
  >();

  for (const c of constraints) {
    if (typeof c.rhs !== "number") continue;

    // Normalize linear expression c.lhs into sum(coeff_i * var_i) + constant <=/>=/== rhs
    const rhs = c.rhs;
    const { terms, constant } = parseLinearExpression(c.lhs);
    const effectiveRhs = rhs - constant;

    // Fast-path: check single-variable interval bound consistency [lower, upper]
    if (terms.length === 1 && Math.abs((terms[0]?.coeff ?? 0) - 1.0) < 1e-12) {
      const varName = terms[0]!.varName;
      const b = bounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      let violated = false;
      let priorReq: string | undefined = undefined;

      if (c.operator === "<=" || c.operator === "<") {
        if (effectiveRhs < b.lower - 1e-9) {
          violated = true;
          priorReq = b.lowerSourceReq;
        }
        if (effectiveRhs < b.upper) {
          b.upper = effectiveRhs;
          b.upperSourceReq = c.requirementName;
        }
      } else if (c.operator === ">=" || c.operator === ">") {
        if (effectiveRhs > b.upper + 1e-9) {
          violated = true;
          priorReq = b.upperSourceReq;
        }
        if (effectiveRhs > b.lower) {
          b.lower = effectiveRhs;
          b.lowerSourceReq = c.requirementName;
        }
      } else if (c.operator === "==") {
        if (effectiveRhs < b.lower - 1e-9) {
          violated = true;
          priorReq = b.lowerSourceReq;
        } else if (effectiveRhs > b.upper + 1e-9) {
          violated = true;
          priorReq = b.upperSourceReq;
        }
        b.lower = Math.max(b.lower, effectiveRhs);
        b.upper = Math.min(b.upper, effectiveRhs);
        b.lowerSourceReq = c.requirementName;
        b.upperSourceReq = c.requirementName;
      }
      bounds.set(varName, b);

      if (violated) {
        if (c.requirementName) conflictingReqs.add(c.requirementName);
        if (priorReq) conflictingReqs.add(priorReq);
        violatedConstraints.push({
          expression: c.expression,
          requirementName: c.requirementName,
          reason: `Contradiction with prior bound for variable '${c.lhs}' (evaluated bound: ${rhs})`,
        });
        break;
      }
    }

    // Encode multi-variable linear constraint into the Dual Simplex tableau and check feasibility
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

  return {
    isConsistent: violatedConstraints.length === 0,
    conflictingRequirements: Array.from(conflictingReqs),
    violatedConstraints,
  };
}

/**
 * Validates the requirement consistency for a package or analysis scope via QueryDB.
 *
 * @param db - Active Salsa `QueryDB` containing indexed SysML v2 symbols.
 * @param scopeFilter - Optional package or requirement name prefix to restrict extraction.
 * @returns Consistency verification result across all extracted requirement constraints.
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
