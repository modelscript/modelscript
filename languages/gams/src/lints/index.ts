// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Static Semantic Linter (GAMS1001–GAMS5006).
 */

import { GamsErrorCode, VALID_GAMS_SOLVER_TYPES, type GamsDiagnostic } from "../errors.js";
import { parseGams } from "../parser/gams-parser.js";
import type { GamsExpr, GamsModel, SourceSpan } from "../types.js";

function spanCoords(span?: SourceSpan): {
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
} {
  if (!span) return { line: 1, column: 1 };
  return {
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn,
  };
}

function makeDiag(
  entry: { id: string; code: number; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span?: SourceSpan,
  symbol?: string,
): GamsDiagnostic {
  const c = spanCoords(span);
  return {
    id: entry.id,
    code: entry.code,
    rule: entry.rule,
    severity: entry.severity,
    message,
    line: c.line,
    column: c.column,
    endLine: c.endLine,
    endColumn: c.endColumn,
    symbol,
    span,
  };
}

/**
 * Runs all GAMS semantic and structural lint checks (GAMS1001–GAMS5006) on a parsed `GamsModel`.
 */
export function lintGams(model: GamsModel): GamsDiagnostic[] {
  const diags: GamsDiagnostic[] = [];

  // 1. GAMS1001: Syntax errors
  for (const err of model.syntaxErrors) {
    diags.push({
      id: GamsErrorCode.SYNTAX_ERROR.id,
      code: GamsErrorCode.SYNTAX_ERROR.code,
      rule: GamsErrorCode.SYNTAX_ERROR.rule,
      severity: GamsErrorCode.SYNTAX_ERROR.severity,
      message: GamsErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // Build symbol tables and check GAMS2001 (Duplicate symbols)
  const setMap = new Map<
    string,
    { name: string; domain: string[]; elements: string[]; span?: SourceSpan | undefined }
  >();
  const paramMap = new Map<string, { name: string; domain: string[]; span?: SourceSpan | undefined }>();
  const varMap = new Map<string, { name: string; domain: string[]; varKind: string; span?: SourceSpan | undefined }>();
  const eqDeclMap = new Map<string, { name: string; domain: string[]; span?: SourceSpan | undefined }>();
  const modelMap = new Map<string, { name: string; span?: SourceSpan | undefined }>();

  for (const s of model.sets) {
    const key = s.name.toLowerCase();
    if (setMap.has(key)) {
      diags.push(
        makeDiag(GamsErrorCode.DUPLICATE_SYMBOL, GamsErrorCode.DUPLICATE_SYMBOL.message("set", s.name), s.span, s.name),
      );
    } else {
      setMap.set(key, s);
    }
    if (s.elements.length === 0 && s.domain.length === 0) {
      diags.push(makeDiag(GamsErrorCode.EMPTY_SET, GamsErrorCode.EMPTY_SET.message(s.name), s.span, s.name));
    }
  }

  // Register aliases (first name must be an existing set or alias)
  const aliasSet = new Set<string>();
  for (const a of model.aliases) {
    if (a.names.length > 0) {
      const base = a.names[0]!.toLowerCase();
      if (!setMap.has(base) && !aliasSet.has(base)) {
        diags.push(
          makeDiag(GamsErrorCode.UNDEFINED_SET, GamsErrorCode.UNDEFINED_SET.message(a.names[0]!), a.span, a.names[0]),
        );
      }
      for (const n of a.names) {
        aliasSet.add(n.toLowerCase());
      }
    }
  }

  const isKnownSet = (name: string): boolean => {
    const k = name.toLowerCase();
    return k === "*" || setMap.has(k) || aliasSet.has(k);
  };

  for (const p of model.parameters) {
    const key = p.name.toLowerCase();
    if (paramMap.has(key)) {
      diags.push(
        makeDiag(
          GamsErrorCode.DUPLICATE_SYMBOL,
          GamsErrorCode.DUPLICATE_SYMBOL.message(p.kind, p.name),
          p.span,
          p.name,
        ),
      );
    } else {
      paramMap.set(key, p);
    }
    for (const d of p.domain) {
      if (!isKnownSet(d)) {
        diags.push(makeDiag(GamsErrorCode.UNDEFINED_SET, GamsErrorCode.UNDEFINED_SET.message(d), p.span, d));
      }
    }
  }

  for (const v of model.variables) {
    const key = v.name.toLowerCase();
    if (varMap.has(key)) {
      diags.push(
        makeDiag(
          GamsErrorCode.DUPLICATE_SYMBOL,
          GamsErrorCode.DUPLICATE_SYMBOL.message("variable", v.name),
          v.span,
          v.name,
        ),
      );
    } else {
      varMap.set(key, v);
    }
    for (const d of v.domain) {
      if (!isKnownSet(d)) {
        diags.push(makeDiag(GamsErrorCode.UNDEFINED_SET, GamsErrorCode.UNDEFINED_SET.message(d), v.span, d));
      }
    }
  }

  for (const eq of model.equationDecls) {
    const key = eq.name.toLowerCase();
    if (eqDeclMap.has(key)) {
      diags.push(
        makeDiag(
          GamsErrorCode.DUPLICATE_SYMBOL,
          GamsErrorCode.DUPLICATE_SYMBOL.message("equation", eq.name),
          eq.span,
          eq.name,
        ),
      );
    } else {
      eqDeclMap.set(key, eq);
    }
    for (const d of eq.domain) {
      if (!isKnownSet(d)) {
        diags.push(makeDiag(GamsErrorCode.UNDEFINED_SET, GamsErrorCode.UNDEFINED_SET.message(d), eq.span, d));
      }
    }
  }

  // Check equation definitions & expression references
  const definedEqNames = new Set<string>();
  const nonlinearEqs = new Set<string>();

  const checkExpr = (expr: GamsExpr, boundIndices: Set<string>, eqName?: string): boolean => {
    // Returns true if expression contains a variable
    switch (expr.kind) {
      case "number":
      case "string":
        return false;
      case "unary":
        return checkExpr(expr.operand, boundIndices, eqName);
      case "dollar": {
        const hasVar = checkExpr(expr.expr, boundIndices, eqName);
        checkExpr(expr.condition, boundIndices, eqName);
        return hasVar;
      }
      case "binary": {
        const lVar = checkExpr(expr.left, boundIndices, eqName);
        const rVar = checkExpr(expr.right, boundIndices, eqName);
        if (
          eqName &&
          ((expr.op === "*" && lVar && rVar) ||
            (expr.op === "/" && rVar) ||
            ((expr.op === "**" || expr.op === "^") && (lVar || rVar)))
        ) {
          nonlinearEqs.add(eqName.toLowerCase());
        }
        return lVar || rVar;
      }
      case "indexedOp": {
        const nextBound = new Set(boundIndices);
        for (const dom of expr.domains) {
          const dk = dom.index.toLowerCase();
          if (!isKnownSet(dk) && !boundIndices.has(dk)) {
            diags.push(
              makeDiag(
                GamsErrorCode.UNDEFINED_SET,
                GamsErrorCode.UNDEFINED_SET.message(dom.index),
                expr.span,
                dom.index,
              ),
            );
          }
          nextBound.add(dk);
        }
        if (expr.condition) checkExpr(expr.condition, nextBound, eqName);
        const bodyHasVar = checkExpr(expr.body, nextBound, eqName);
        if (eqName && expr.op === "prod" && bodyHasVar) {
          nonlinearEqs.add(eqName.toLowerCase());
        }
        return bodyHasVar;
      }
      case "call": {
        let argHasVar = false;
        for (const a of expr.args) {
          if (checkExpr(a, boundIndices, eqName)) argHasVar = true;
        }
        if (eqName && argHasVar && !["ord", "card", "sameas"].includes(expr.name.toLowerCase())) {
          nonlinearEqs.add(eqName.toLowerCase());
        }
        return argHasVar;
      }
      case "ref": {
        const k = expr.name.toLowerCase();
        // Check indices
        for (const idx of expr.indices) {
          checkExpr(idx, boundIndices, eqName);
        }
        // Bound index or set name
        if (boundIndices.has(k) || isKnownSet(k)) {
          return false;
        }
        const vDecl = varMap.get(k);
        if (vDecl) {
          if (vDecl.domain.length !== expr.indices.length) {
            diags.push(
              makeDiag(
                GamsErrorCode.DOMAIN_INDEX_MISMATCH,
                GamsErrorCode.DOMAIN_INDEX_MISMATCH.message(expr.name, vDecl.domain.length, expr.indices.length),
                expr.span,
                expr.name,
              ),
            );
          }
          return true;
        }
        const pDecl = paramMap.get(k);
        if (pDecl) {
          if (pDecl.domain.length !== expr.indices.length) {
            diags.push(
              makeDiag(
                GamsErrorCode.DOMAIN_INDEX_MISMATCH,
                GamsErrorCode.DOMAIN_INDEX_MISMATCH.message(expr.name, pDecl.domain.length, expr.indices.length),
                expr.span,
                expr.name,
              ),
            );
          }
          return false;
        }
        // Unknown identifier
        if (expr.suffix && ["lo", "up", "fx", "l", "m"].includes(expr.suffix)) {
          diags.push(
            makeDiag(
              GamsErrorCode.UNDEFINED_VARIABLE,
              GamsErrorCode.UNDEFINED_VARIABLE.message(expr.name),
              expr.span,
              expr.name,
            ),
          );
        } else {
          diags.push(
            makeDiag(
              GamsErrorCode.UNDEFINED_PARAMETER,
              GamsErrorCode.UNDEFINED_PARAMETER.message(expr.name),
              expr.span,
              expr.name,
            ),
          );
        }
        return false;
      }
    }
  };

  for (const def of model.equationDefs) {
    const key = def.name.toLowerCase();
    definedEqNames.add(key);
    const decl = eqDeclMap.get(key);
    if (decl && decl.domain.length !== def.domain.length) {
      diags.push(
        makeDiag(
          GamsErrorCode.DOMAIN_INDEX_MISMATCH,
          GamsErrorCode.DOMAIN_INDEX_MISMATCH.message(def.name, decl.domain.length, def.domain.length),
          def.span,
          def.name,
        ),
      );
    }
    const bound = new Set<string>(def.domain.map((d) => d.toLowerCase()));
    for (const d of def.domain) {
      if (!isKnownSet(d)) {
        diags.push(makeDiag(GamsErrorCode.UNDEFINED_SET, GamsErrorCode.UNDEFINED_SET.message(d), def.span, d));
      }
    }
    if (def.condition) checkExpr(def.condition, bound, def.name);
    checkExpr(def.lhs, bound, def.name);
    checkExpr(def.rhs, bound, def.name);
  }

  // GAMS5003: Declared equation never defined
  for (const eq of model.equationDecls) {
    if (!definedEqNames.has(eq.name.toLowerCase())) {
      diags.push(
        makeDiag(
          GamsErrorCode.EQUATION_NOT_DEFINED,
          GamsErrorCode.EQUATION_NOT_DEFINED.message(eq.name),
          eq.span,
          eq.name,
        ),
      );
    }
  }

  // Check assignments & scalar bound conflicts (GAMS5001)
  const varBounds = new Map<string, { lo?: number; up?: number; span?: SourceSpan | undefined; name: string }>();
  for (const stmt of model.assignments) {
    const k = stmt.target.toLowerCase();
    const isVarSuffix = stmt.suffix && ["lo", "up", "fx", "l", "m"].includes(stmt.suffix);
    if (isVarSuffix) {
      const vDecl = varMap.get(k);
      if (!vDecl) {
        diags.push(
          makeDiag(
            GamsErrorCode.UNDEFINED_VARIABLE,
            GamsErrorCode.UNDEFINED_VARIABLE.message(stmt.target),
            stmt.span,
            stmt.target,
          ),
        );
      } else {
        if (vDecl.domain.length !== stmt.indices.length) {
          diags.push(
            makeDiag(
              GamsErrorCode.DOMAIN_INDEX_MISMATCH,
              GamsErrorCode.DOMAIN_INDEX_MISMATCH.message(stmt.target, vDecl.domain.length, stmt.indices.length),
              stmt.span,
              stmt.target,
            ),
          );
        }
        if (stmt.indices.length === 0 && stmt.value.kind === "number") {
          const b = varBounds.get(k) ?? { name: stmt.target, span: stmt.span };
          if (stmt.suffix === "lo") b.lo = stmt.value.value;
          if (stmt.suffix === "up") b.up = stmt.value.value;
          b.span = stmt.span;
          varBounds.set(k, b);
        }
      }
    } else if (!paramMap.has(k) && !varMap.has(k) && !setMap.has(k)) {
      diags.push(
        makeDiag(
          GamsErrorCode.UNDEFINED_PARAMETER,
          GamsErrorCode.UNDEFINED_PARAMETER.message(stmt.target),
          stmt.span,
          stmt.target,
        ),
      );
    }

    const bound = new Set<string>();
    for (const idx of stmt.indices) {
      if (idx.kind === "ref" && idx.indices.length === 0) {
        bound.add(idx.name.toLowerCase());
      }
    }
    if (stmt.condition) checkExpr(stmt.condition, bound);
    checkExpr(stmt.value, bound);
  }

  for (const b of varBounds.values()) {
    if (b.lo !== undefined && b.up !== undefined && b.lo > b.up) {
      diags.push(
        makeDiag(
          GamsErrorCode.CONFLICTING_BOUNDS,
          GamsErrorCode.CONFLICTING_BOUNDS.message(b.name, b.lo, b.up),
          b.span,
          b.name,
        ),
      );
    }
  }

  // Check Model declarations (GAMS2001, GAMS4001)
  for (const m of model.models) {
    const mk = m.name.toLowerCase();
    if (modelMap.has(mk)) {
      diags.push(
        makeDiag(
          GamsErrorCode.DUPLICATE_SYMBOL,
          GamsErrorCode.DUPLICATE_SYMBOL.message("model", m.name),
          m.span,
          m.name,
        ),
      );
    } else {
      modelMap.set(mk, m);
    }
    if (!m.allEquations) {
      for (const eqName of m.equations) {
        if (!eqDeclMap.has(eqName.toLowerCase())) {
          diags.push(
            makeDiag(
              GamsErrorCode.UNDECLARED_EQUATION_IN_MODEL,
              GamsErrorCode.UNDECLARED_EQUATION_IN_MODEL.message(eqName, m.name),
              m.span,
              eqName,
            ),
          );
        }
      }
    }
  }

  // Check Solve statements (GAMS4002, GAMS4003, GAMS5004, GAMS5005, GAMS5006)
  for (const s of model.solves) {
    if (!modelMap.has(s.modelName.toLowerCase())) {
      diags.push(
        makeDiag(
          GamsErrorCode.UNDECLARED_MODEL_IN_SOLVE,
          GamsErrorCode.UNDECLARED_MODEL_IN_SOLVE.message(s.modelName),
          s.span,
          s.modelName,
        ),
      );
    }
    if (!s.solverType || !VALID_GAMS_SOLVER_TYPES.has(s.solverType.toLowerCase())) {
      diags.push(
        makeDiag(
          GamsErrorCode.INVALID_SOLVER_TYPE,
          GamsErrorCode.INVALID_SOLVER_TYPE.message(s.solverType || "<missing>"),
          s.span,
          s.solverType,
        ),
      );
    }
    if (!s.objectiveVar) {
      diags.push(
        makeDiag(
          GamsErrorCode.MISSING_OBJECTIVE_VARIABLE,
          GamsErrorCode.MISSING_OBJECTIVE_VARIABLE.message("<missing>", s.modelName),
          s.span,
        ),
      );
    } else {
      const objVar = varMap.get(s.objectiveVar.toLowerCase());
      if (!objVar) {
        diags.push(
          makeDiag(
            GamsErrorCode.MISSING_OBJECTIVE_VARIABLE,
            GamsErrorCode.MISSING_OBJECTIVE_VARIABLE.message(s.objectiveVar, s.modelName),
            s.span,
            s.objectiveVar,
          ),
        );
      } else if (objVar.varKind !== "free") {
        diags.push(
          makeDiag(
            GamsErrorCode.OBJECTIVE_VAR_NON_FREE,
            GamsErrorCode.OBJECTIVE_VAR_NON_FREE.message(s.objectiveVar, objVar.varKind),
            s.span,
            s.objectiveVar,
          ),
        );
      }
    }

    if (s.solverType === "lp" || s.solverType === "mip" || s.solverType === "rmip") {
      for (const nlEq of nonlinearEqs) {
        diags.push(
          makeDiag(
            GamsErrorCode.NONLINEAR_IN_LINEAR_SOLVE,
            GamsErrorCode.NONLINEAR_IN_LINEAR_SOLVE.message(nlEq, s.solverType),
            s.span,
            nlEq,
          ),
        );
      }
    }
  }

  return diags;
}

/**
 * Convenience helper that parses GAMS source text and returns all lint diagnostics.
 */
export function lintGamsSource(source: string): GamsDiagnostic[] {
  return lintGams(parseGams(source));
}

export { GamsErrorCode, VALID_GAMS_SOLVER_TYPES, type GamsDiagnostic, type GamsDiagnosticSeverity } from "../errors.js";
