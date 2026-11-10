// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Pre-flight Mathematical Programming Diagnostic Linter.
 */

import { AmplErrorCode, type DiagnosticItem } from "../errors.js";
import type { AmplData, AmplExpr, AmplModel } from "../types.js";

export function lintAmpl(model: AmplModel, data?: AmplData | undefined): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  const knownSets = new Set<string>();
  const knownParams = new Set<string>();
  const knownVars = new Set<string>();

  // 1. Check duplicate set declarations and register known sets
  for (const [name, decl] of model.sets.entries()) {
    if (knownSets.has(name)) {
      diagnostics.push({
        code: AmplErrorCode.DUPLICATE_DECLARATION.code,
        rule: AmplErrorCode.DUPLICATE_DECLARATION.rule,
        severity: AmplErrorCode.DUPLICATE_DECLARATION.severity,
        message: AmplErrorCode.DUPLICATE_DECLARATION.message("set", name),
        range: decl.range,
      });
    }
    knownSets.add(name);

    if (decl.indexing) {
      for (const it of decl.indexing.iterators) {
        checkSetRef(it.setExpr, knownSets, diagnostics);
      }
    }
    if (decl.within) {
      checkSetRef(decl.within, knownSets, diagnostics);
    }
  }

  // Also include sets declared in .dat
  if (data) {
    for (const name of data.sets.keys()) {
      knownSets.add(name);
    }

    // Check set arity (dimen k) and within subset relations against data
    for (const [name, decl] of model.sets.entries()) {
      const members = data.sets.get(name);
      if (members && members.length > 0) {
        const expectedDimen = decl.dimen ?? 1;
        for (const m of members) {
          const actualArity = Array.isArray(m) ? m.length : 1;
          if (actualArity !== expectedDimen) {
            diagnostics.push({
              code: AmplErrorCode.SET_ARITY_MISMATCH.code,
              rule: AmplErrorCode.SET_ARITY_MISMATCH.rule,
              severity: AmplErrorCode.SET_ARITY_MISMATCH.severity,
              message: AmplErrorCode.SET_ARITY_MISMATCH.message(name, expectedDimen, actualArity),
              range: decl.range,
            });
            break;
          }
        }

        if (decl.within && decl.within.kind === "identifier") {
          const parentName = decl.within.name;
          const parentMembers = data.sets.get(parentName);
          if (parentMembers) {
            const parentKeySet = new Set(
              parentMembers.map((pm) => (Array.isArray(pm) ? pm.join(",") : String(pm))),
            );
            for (const m of members) {
              const mKey = Array.isArray(m) ? m.join(",") : String(m);
              if (!parentKeySet.has(mKey)) {
                diagnostics.push({
                  code: AmplErrorCode.SUBSET_RELATION_VIOLATION.code,
                  rule: AmplErrorCode.SUBSET_RELATION_VIOLATION.rule,
                  severity: AmplErrorCode.SUBSET_RELATION_VIOLATION.severity,
                  message: AmplErrorCode.SUBSET_RELATION_VIOLATION.message(name, parentName, mKey),
                  range: decl.range,
                });
                break;
              }
            }
          }
        }
      }
    }
  }

  // 2. Check parameters
  for (const [name, decl] of model.params.entries()) {
    if (knownParams.has(name)) {
      diagnostics.push({
        code: AmplErrorCode.DUPLICATE_DECLARATION.code,
        rule: AmplErrorCode.DUPLICATE_DECLARATION.rule,
        severity: AmplErrorCode.DUPLICATE_DECLARATION.severity,
        message: AmplErrorCode.DUPLICATE_DECLARATION.message("param", name),
        range: decl.range,
      });
    }
    knownParams.add(name);

    // Check indexing sets
    if (decl.indexing) {
      for (const it of decl.indexing.iterators) {
        checkSetRef(it.setExpr, knownSets, diagnostics);
      }
    }
  }

  if (data) {
    for (const name of data.params.keys()) {
      knownParams.add(name);
    }
  }

  // 3. Check variables
  for (const [name, decl] of model.vars.entries()) {
    if (knownVars.has(name)) {
      diagnostics.push({
        code: AmplErrorCode.DUPLICATE_DECLARATION.code,
        rule: AmplErrorCode.DUPLICATE_DECLARATION.rule,
        severity: AmplErrorCode.DUPLICATE_DECLARATION.severity,
        message: AmplErrorCode.DUPLICATE_DECLARATION.message("var", name),
        range: decl.range,
      });
    }
    knownVars.add(name);

    // Check bounds conflict: lb > ub
    if (decl.lowerBound?.kind === "number" && decl.upperBound?.kind === "number") {
      if (decl.lowerBound.value > decl.upperBound.value) {
        diagnostics.push({
          code: AmplErrorCode.BOUNDS_CONFLICT.code,
          rule: AmplErrorCode.BOUNDS_CONFLICT.rule,
          severity: AmplErrorCode.BOUNDS_CONFLICT.severity,
          message: AmplErrorCode.BOUNDS_CONFLICT.message(name, decl.lowerBound.value, decl.upperBound.value),
          range: decl.range,
        });
      }
    }

    if (decl.indexing) {
      for (const it of decl.indexing.iterators) {
        checkSetRef(it.setExpr, knownSets, diagnostics);
      }
    }
  }

  // 4. Check objectives
  for (const [_name, decl] of model.objectives.entries()) {
    const scope = new Set<string>();
    if (decl.indexing) {
      for (const it of decl.indexing.iterators) {
        for (const v of it.variables) scope.add(v);
        checkSetRef(it.setExpr, knownSets, diagnostics);
      }
    }
    checkExpressionScope(decl.expr, knownSets, knownParams, knownVars, scope, diagnostics);
  }

  // 5. Check constraints
  for (const [name, decl] of model.constraints.entries()) {
    const scope = new Set<string>();
    if (decl.indexing) {
      for (const it of decl.indexing.iterators) {
        for (const v of it.variables) scope.add(v);
        checkSetRef(it.setExpr, knownSets, diagnostics);
      }
    }

    checkExpressionScope(decl.lhs, knownSets, knownParams, knownVars, scope, diagnostics);
    checkExpressionScope(decl.rhs, knownSets, knownParams, knownVars, scope, diagnostics);
    if (decl.rhsUpper) {
      checkExpressionScope(decl.rhsUpper, knownSets, knownParams, knownVars, scope, diagnostics);
    }

    // Check nonlinear integer constraint warning
    checkNonlinearIntegerWarning(name, decl.lhs, model, diagnostics);
    checkNonlinearIntegerWarning(name, decl.rhs, model, diagnostics);
  }

  return diagnostics;
}

function checkSetRef(expr: AmplExpr, knownSets: Set<string>, diagnostics: DiagnosticItem[]): void {
  if (expr.kind === "identifier") {
    if (!knownSets.has(expr.name)) {
      diagnostics.push({
        code: AmplErrorCode.UNDECLARED_SET.code,
        rule: AmplErrorCode.UNDECLARED_SET.rule,
        severity: AmplErrorCode.UNDECLARED_SET.severity,
        message: AmplErrorCode.UNDECLARED_SET.message(expr.name),
        range: expr.range,
      });
    }
  }
}

function checkExpressionScope(
  expr: AmplExpr,
  knownSets: Set<string>,
  knownParams: Set<string>,
  knownVars: Set<string>,
  scope: Set<string>,
  diagnostics: DiagnosticItem[],
): void {
  switch (expr.kind) {
    case "identifier":
      if (!scope.has(expr.name) && !knownVars.has(expr.name) && !knownParams.has(expr.name) && !knownSets.has(expr.name)) {
        diagnostics.push({
          code: AmplErrorCode.UNDECLARED_VAR.code,
          rule: AmplErrorCode.UNDECLARED_VAR.rule,
          severity: AmplErrorCode.UNDECLARED_VAR.severity,
          message: AmplErrorCode.UNDECLARED_VAR.message(expr.name),
          range: expr.range,
        });
      }
      break;

    case "subscript":
      if (!knownVars.has(expr.name) && !knownParams.has(expr.name)) {
        diagnostics.push({
          code: AmplErrorCode.UNDECLARED_VAR.code,
          rule: AmplErrorCode.UNDECLARED_VAR.rule,
          severity: AmplErrorCode.UNDECLARED_VAR.severity,
          message: AmplErrorCode.UNDECLARED_VAR.message(expr.name),
          range: expr.range,
        });
      }
      for (const idx of expr.indices) {
        checkExpressionScope(idx, knownSets, knownParams, knownVars, scope, diagnostics);
      }
      break;

    case "unary":
      checkExpressionScope(expr.expr, knownSets, knownParams, knownVars, scope, diagnostics);
      break;

    case "binary":
      checkExpressionScope(expr.left, knownSets, knownParams, knownVars, scope, diagnostics);
      checkExpressionScope(expr.right, knownSets, knownParams, knownVars, scope, diagnostics);
      break;

    case "reduction": {
      const nestedScope = new Set(scope);
      for (const it of expr.iterators) {
        for (const v of it.variables) nestedScope.add(v);
        checkSetRef(it.setExpr, knownSets, diagnostics);
      }
      checkExpressionScope(expr.expr, knownSets, knownParams, knownVars, nestedScope, diagnostics);
      break;
    }

    case "call":
      for (const arg of expr.args) {
        checkExpressionScope(arg, knownSets, knownParams, knownVars, scope, diagnostics);
      }
      break;
  }
}

function checkNonlinearIntegerWarning(
  conName: string,
  rootExpr: AmplExpr,
  model: AmplModel,
  diagnostics: DiagnosticItem[],
): void {
  function walk(expr: AmplExpr): void {
    if (expr.kind === "binary") {
      if (expr.op === "^" || expr.op === "**" || expr.op === "*") {
        const varsUsed = getVarsInExpr(expr);
        for (const vName of varsUsed) {
          const decl = model.vars.get(vName);
          if (decl && (decl.type === "integer" || decl.type === "binary")) {
            diagnostics.push({
              code: AmplErrorCode.NONLINEAR_INTEGER_CONSTRAINT.code,
              rule: AmplErrorCode.NONLINEAR_INTEGER_CONSTRAINT.rule,
              severity: AmplErrorCode.NONLINEAR_INTEGER_CONSTRAINT.severity,
              message: AmplErrorCode.NONLINEAR_INTEGER_CONSTRAINT.message(conName, vName),
              range: expr.range,
            });
            return;
          }
        }
      }
      walk(expr.left);
      walk(expr.right);
    } else if (expr.kind === "unary") {
      walk(expr.expr);
    } else if (expr.kind === "reduction") {
      walk(expr.expr);
    }
  }
  walk(rootExpr);
}

function getVarsInExpr(expr: AmplExpr): string[] {
  const vars: string[] = [];
  function walk(e: AmplExpr): void {
    if (e.kind === "identifier" || e.kind === "subscript") vars.push(e.name);
    else if (e.kind === "unary") walk(e.expr);
    else if (e.kind === "binary") {
      walk(e.left);
      walk(e.right);
    } else if (e.kind === "reduction") walk(e.expr);
    else if (e.kind === "call") for (const a of e.args) walk(a);
  }
  walk(expr);
  return vars;
}
