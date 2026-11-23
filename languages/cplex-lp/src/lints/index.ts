// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static analysis & linter engine for CPLEX LP and LINDO models (LP1001–LP5006).
 */

import { CplexLpErrorCode, type CplexLpDiagnostic } from "../errors.js";
import { parseCplexLp } from "../parser/lp-parser.js";
import type { CplexLpModel } from "../types.js";

export { CplexLpErrorCode, type CplexLpDiagnostic } from "../errors.js";

/**
 * Runs all LP1001–LP5006 diagnostic checks against a parsed `CplexLpModel`.
 */
export function lintCplexLp(model: CplexLpModel): CplexLpDiagnostic[] {
  const diags: CplexLpDiagnostic[] = [];

  // LP1001: Syntax errors from parser
  for (const err of model.parseErrors) {
    diags.push({
      code: CplexLpErrorCode.SYNTAX_ERROR.code,
      id: CplexLpErrorCode.SYNTAX_ERROR.id,
      rule: CplexLpErrorCode.SYNTAX_ERROR.rule,
      severity: CplexLpErrorCode.SYNTAX_ERROR.severity,
      message: CplexLpErrorCode.SYNTAX_ERROR.message(err.message),
      location: err.location,
    });
  }

  // LP2001: Missing objective
  if (!model.objective) {
    diags.push({
      code: CplexLpErrorCode.MISSING_OBJECTIVE.code,
      id: CplexLpErrorCode.MISSING_OBJECTIVE.id,
      rule: CplexLpErrorCode.MISSING_OBJECTIVE.rule,
      severity: CplexLpErrorCode.MISSING_OBJECTIVE.severity,
      message: CplexLpErrorCode.MISSING_OBJECTIVE.message(),
    });
  }

  // LP2002: Missing End
  if (!model.hasEnd) {
    diags.push({
      code: CplexLpErrorCode.MISSING_END.code,
      id: CplexLpErrorCode.MISSING_END.id,
      rule: CplexLpErrorCode.MISSING_END.rule,
      severity: CplexLpErrorCode.MISSING_END.severity,
      message: CplexLpErrorCode.MISSING_END.message(),
    });
  }

  // LP3001: Duplicate constraint name & LP5001: Empty constraint
  const seenConstraints = new Set<string>();
  for (const con of model.constraints) {
    if (con.hasExplicitName) {
      if (seenConstraints.has(con.name)) {
        diags.push({
          code: CplexLpErrorCode.DUPLICATE_CONSTRAINT_NAME.code,
          id: CplexLpErrorCode.DUPLICATE_CONSTRAINT_NAME.id,
          rule: CplexLpErrorCode.DUPLICATE_CONSTRAINT_NAME.rule,
          severity: CplexLpErrorCode.DUPLICATE_CONSTRAINT_NAME.severity,
          message: CplexLpErrorCode.DUPLICATE_CONSTRAINT_NAME.message(con.name),
          location: con.location,
          symbol: con.name,
        });
      }
      seenConstraints.add(con.name);
    }

    const hasLinear = con.linearTerms.length > 0;
    const hasQuad = (con.quadratic?.terms.length ?? 0) > 0;
    if (!hasLinear && !hasQuad) {
      diags.push({
        code: CplexLpErrorCode.EMPTY_CONSTRAINT.code,
        id: CplexLpErrorCode.EMPTY_CONSTRAINT.id,
        rule: CplexLpErrorCode.EMPTY_CONSTRAINT.rule,
        severity: CplexLpErrorCode.EMPTY_CONSTRAINT.severity,
        message: CplexLpErrorCode.EMPTY_CONSTRAINT.message(con.name),
        location: con.location,
        symbol: con.name,
      });
    }
  }

  // LP4001, LP4002, LP5004, LP5005: Bounds & domain consistency checks
  for (const [varName, bound] of model.bounds) {
    const isBinary = model.binaries.has(varName);
    const isSemi = model.semiContinuous.has(varName);

    // LP4002: Binary and free conflict
    if (isBinary && (bound.isFree || bound.explicitFree)) {
      diags.push({
        code: CplexLpErrorCode.BINARY_AND_FREE_CONFLICT.code,
        id: CplexLpErrorCode.BINARY_AND_FREE_CONFLICT.id,
        rule: CplexLpErrorCode.BINARY_AND_FREE_CONFLICT.rule,
        severity: CplexLpErrorCode.BINARY_AND_FREE_CONFLICT.severity,
        message: CplexLpErrorCode.BINARY_AND_FREE_CONFLICT.message(varName),
        location: bound.location,
        symbol: varName,
      });
    }

    // LP4001: Contradictory variable bounds (lower > upper)
    if (bound.lower > bound.upper) {
      diags.push({
        code: CplexLpErrorCode.CONTRADICTORY_BOUNDS.code,
        id: CplexLpErrorCode.CONTRADICTORY_BOUNDS.id,
        rule: CplexLpErrorCode.CONTRADICTORY_BOUNDS.rule,
        severity: CplexLpErrorCode.CONTRADICTORY_BOUNDS.severity,
        message: CplexLpErrorCode.CONTRADICTORY_BOUNDS.message(varName, bound.lower, bound.upper),
        location: bound.location,
        symbol: varName,
      });
    }

    // LP5004: Binary variable explicit bounds outside [0, 1]
    if (isBinary && !bound.isFree && !bound.explicitFree) {
      const lbOut = bound.explicitLower !== undefined && (bound.explicitLower < 0 || bound.explicitLower > 1);
      const ubOut = bound.explicitUpper !== undefined && (bound.explicitUpper < 0 || bound.explicitUpper > 1);
      if (lbOut || ubOut) {
        diags.push({
          code: CplexLpErrorCode.BINARY_BOUND_CONFLICT.code,
          id: CplexLpErrorCode.BINARY_BOUND_CONFLICT.id,
          rule: CplexLpErrorCode.BINARY_BOUND_CONFLICT.rule,
          severity: CplexLpErrorCode.BINARY_BOUND_CONFLICT.severity,
          message: CplexLpErrorCode.BINARY_BOUND_CONFLICT.message(
            varName,
            bound.explicitLower ?? 0,
            bound.explicitUpper ?? 1,
          ),
          location: bound.location,
          symbol: varName,
        });
      }
    }

    // LP5005: Semi-continuous variable with negative lower bound
    if (isSemi && bound.lower < 0) {
      diags.push({
        code: CplexLpErrorCode.SEMI_CONTINUOUS_BOUND_CONFLICT.code,
        id: CplexLpErrorCode.SEMI_CONTINUOUS_BOUND_CONFLICT.id,
        rule: CplexLpErrorCode.SEMI_CONTINUOUS_BOUND_CONFLICT.rule,
        severity: CplexLpErrorCode.SEMI_CONTINUOUS_BOUND_CONFLICT.severity,
        message: CplexLpErrorCode.SEMI_CONTINUOUS_BOUND_CONFLICT.message(varName, bound.lower),
        location: bound.location,
        symbol: varName,
      });
    }
  }

  // LP5002 & LP5003: SOS checks
  for (const sosCon of model.sos) {
    if (sosCon.type !== "S1" && sosCon.type !== "S2") {
      diags.push({
        code: CplexLpErrorCode.INVALID_SOS_TYPE.code,
        id: CplexLpErrorCode.INVALID_SOS_TYPE.id,
        rule: CplexLpErrorCode.INVALID_SOS_TYPE.rule,
        severity: CplexLpErrorCode.INVALID_SOS_TYPE.severity,
        message: CplexLpErrorCode.INVALID_SOS_TYPE.message(sosCon.name, sosCon.type),
        location: sosCon.location,
        symbol: sosCon.name,
      });
    }

    if (sosCon.entries.length === 0) {
      diags.push({
        code: CplexLpErrorCode.INVALID_SOS_WEIGHTS.code,
        id: CplexLpErrorCode.INVALID_SOS_WEIGHTS.id,
        rule: CplexLpErrorCode.INVALID_SOS_WEIGHTS.rule,
        severity: CplexLpErrorCode.INVALID_SOS_WEIGHTS.severity,
        message: CplexLpErrorCode.INVALID_SOS_WEIGHTS.message(sosCon.name, "SOS set contains no variable entries"),
        location: sosCon.location,
        symbol: sosCon.name,
      });
      continue;
    }

    const seenWeights = new Set<number>();
    for (const entry of sosCon.entries) {
      if (!Number.isFinite(entry.weight)) {
        diags.push({
          code: CplexLpErrorCode.INVALID_SOS_WEIGHTS.code,
          id: CplexLpErrorCode.INVALID_SOS_WEIGHTS.id,
          rule: CplexLpErrorCode.INVALID_SOS_WEIGHTS.rule,
          severity: CplexLpErrorCode.INVALID_SOS_WEIGHTS.severity,
          message: CplexLpErrorCode.INVALID_SOS_WEIGHTS.message(
            sosCon.name,
            `weight for '${entry.variable}' must be a finite number`,
          ),
          location: entry.location ?? sosCon.location,
          symbol: entry.variable,
        });
      } else if (seenWeights.has(entry.weight)) {
        diags.push({
          code: CplexLpErrorCode.INVALID_SOS_WEIGHTS.code,
          id: CplexLpErrorCode.INVALID_SOS_WEIGHTS.id,
          rule: CplexLpErrorCode.INVALID_SOS_WEIGHTS.rule,
          severity: CplexLpErrorCode.INVALID_SOS_WEIGHTS.severity,
          message: CplexLpErrorCode.INVALID_SOS_WEIGHTS.message(
            sosCon.name,
            `duplicate weight ${entry.weight} on variable '${entry.variable}' (SOS weights must be unique)`,
          ),
          location: entry.location ?? sosCon.location,
          symbol: entry.variable,
        });
      } else {
        seenWeights.add(entry.weight);
      }
    }
  }

  // LP5006: Variable declared in Bounds/Generals/Binaries/Semi-Continuous but never referenced in objective/constraints
  for (const [varName, info] of model.variables) {
    if (!info.referencedInModel) {
      const sectionName = model.binaries.has(varName)
        ? "Binaries"
        : model.generals.has(varName)
          ? "Generals"
          : model.semiContinuous.has(varName)
            ? "Semi-Continuous"
            : model.bounds.has(varName)
              ? "Bounds"
              : "SOS";
      diags.push({
        code: CplexLpErrorCode.UNREFERENCED_VARIABLE_DECLARATION.code,
        id: CplexLpErrorCode.UNREFERENCED_VARIABLE_DECLARATION.id,
        rule: CplexLpErrorCode.UNREFERENCED_VARIABLE_DECLARATION.rule,
        severity: CplexLpErrorCode.UNREFERENCED_VARIABLE_DECLARATION.severity,
        message: CplexLpErrorCode.UNREFERENCED_VARIABLE_DECLARATION.message(varName, sectionName),
        location: info.firstLocation,
        symbol: varName,
      });
    }
  }

  return diags;
}

/**
 * Convenience helper to parse and lint CPLEX LP / LINDO source text directly.
 */
export function lintCplexLpSource(source: string): CplexLpDiagnostic[] {
  return lintCplexLp(parseCplexLp(source));
}
