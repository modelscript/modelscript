// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static analyzer and linter for `@modelscript/esl` (ESL1001–ESL5006).
 */

import { EslErrorCode, type EslDiagnostic } from "../errors.js";
import { parseEsl } from "../parser/esl-parser.js";
import type { EslBlock, EslDeclaration, EslExpr, EslProgram, EslStatement } from "../types.js";

const BUILTIN_VARS = new Set<string>([
  "T",
  "TIME",
  "DT",
  "TSTART",
  "TFIN",
  "TSTOP",
  "CINT",
  "NSTEP",
  "PI",
  "E",
  "TRUE",
  "FALSE",
]);

const BUILTIN_FUNCS = new Set<string>([
  "SIN",
  "COS",
  "TAN",
  "ASIN",
  "ACOS",
  "ATAN",
  "ATAN2",
  "SINH",
  "COSH",
  "TANH",
  "SQRT",
  "ABS",
  "EXP",
  "LOG",
  "LN",
  "LOG10",
  "SIGN",
  "MIN",
  "MAX",
  "MOD",
  "INT",
  "FLOOR",
  "CEIL",
  "ROUND",
  "STEP",
  "RAMP",
  "PULSE",
  "SWITCH",
  "TRANSFER",
  "DELAY",
  "LIMIT",
  "DEADZONE",
  "QUATERNION",
  "ORBIT_J2",
  "TAB1",
  "TAB2",
  "INTEG",
  "DERIV",
]);

const RELATIONAL_OPS = new Set<string>(["=", "==", "/=", "<>", "!=", "<", "<=", ">", ">="]);

interface SymbolInfo {
  name: string;
  dataType: string;
  isConstant: boolean;
}

function exprHasDynamicRef(expr: EslExpr, constants: Set<string>): boolean {
  switch (expr.kind) {
    case "number":
    case "boolean":
    case "string":
      return false;
    case "identifier":
      return !constants.has(expr.name.toUpperCase());
    case "derivative":
      return true;
    case "unary":
      return exprHasDynamicRef(expr.operand, constants);
    case "binary":
      return exprHasDynamicRef(expr.left, constants) || exprHasDynamicRef(expr.right, constants);
    case "call":
      return expr.args.some((a) => exprHasDynamicRef(a, constants));
    case "conditional":
      return (
        exprHasDynamicRef(expr.condition, constants) ||
        exprHasDynamicRef(expr.thenExpr, constants) ||
        exprHasDynamicRef(expr.elseExpr, constants)
      );
  }
}

function isBooleanOrRelationalExpr(expr: EslExpr, scope: Map<string, SymbolInfo>): boolean {
  switch (expr.kind) {
    case "boolean":
      return true;
    case "binary":
      return RELATIONAL_OPS.has(expr.op) || expr.op === "AND" || expr.op === "OR";
    case "unary":
      return expr.op === "NOT";
    case "identifier": {
      const info = scope.get(expr.name.toUpperCase());
      return info?.dataType === "LOGICAL";
    }
    default:
      return false;
  }
}

/**
 * Runs all static semantic lints (ESL1001–ESL5006) on a parsed `EslProgram`.
 */
export function lintEsl(program: EslProgram): EslDiagnostic[] {
  const diagnostics: EslDiagnostic[] = [];

  // 1. ESL1001: Syntax errors
  for (const err of program.syntaxErrors) {
    diagnostics.push({
      code: EslErrorCode.SYNTAX_ERROR.code,
      id: EslErrorCode.SYNTAX_ERROR.id,
      rule: EslErrorCode.SYNTAX_ERROR.rule,
      severity: EslErrorCode.SYNTAX_ERROR.severity,
      message: EslErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  // Build global lookup of submodels (case-insensitive)
  const submodelMap = new Map<string, EslBlock>();
  for (const [name, sm] of program.submodels) {
    submodelMap.set(name.toUpperCase(), sm);
  }

  // Collect package-level declarations for global visibility
  const globalSymbols = new Map<string, SymbolInfo>();
  for (const pkg of program.packages.values()) {
    for (const d of pkg.declarations) {
      globalSymbols.set(d.name.toUpperCase(), {
        name: d.name,
        dataType: d.dataType,
        isConstant: d.isConstant,
      });
    }
  }

  const lintBlock = (block: EslBlock, parentScope: Map<string, SymbolInfo>): void => {
    // ESL4001: Mismatched MODEL/SUBMODEL/SEGMENT/PACKAGE/STUDY and END
    if (!block.hasEnd) {
      diagnostics.push({
        code: EslErrorCode.MISMATCHED_BLOCK_END.code,
        id: EslErrorCode.MISMATCHED_BLOCK_END.id,
        rule: EslErrorCode.MISMATCHED_BLOCK_END.rule,
        severity: EslErrorCode.MISMATCHED_BLOCK_END.severity,
        message: EslErrorCode.MISMATCHED_BLOCK_END.message(block.kind, block.name, "<EOF>"),
        line: block.span.endLine,
        column: block.span.endColumn,
        startOffset: block.span.startOffset,
        endOffset: block.span.endOffset,
        symbolName: block.name,
      });
    } else {
      if (block.endKeyword && block.endKeyword !== "END") {
        const expected1 = `END ${block.kind}`;
        const expected2 = `END_${block.kind}`;
        if (block.endKeyword !== expected1 && block.endKeyword !== expected2) {
          diagnostics.push({
            code: EslErrorCode.MISMATCHED_BLOCK_END.code,
            id: EslErrorCode.MISMATCHED_BLOCK_END.id,
            rule: EslErrorCode.MISMATCHED_BLOCK_END.rule,
            severity: EslErrorCode.MISMATCHED_BLOCK_END.severity,
            message: EslErrorCode.MISMATCHED_BLOCK_END.message(
              block.kind,
              block.name,
              block.endName ? `${block.endKeyword} ${block.endName}` : block.endKeyword,
            ),
            line: block.span.endLine,
            column: block.span.endColumn,
            startOffset: block.span.startOffset,
            endOffset: block.span.endOffset,
            symbolName: block.name,
          });
        }
      }
      if (block.endName && block.endName.toUpperCase() !== block.name.toUpperCase()) {
        diagnostics.push({
          code: EslErrorCode.MISMATCHED_BLOCK_END.code,
          id: EslErrorCode.MISMATCHED_BLOCK_END.id,
          rule: EslErrorCode.MISMATCHED_BLOCK_END.rule,
          severity: EslErrorCode.MISMATCHED_BLOCK_END.severity,
          message: EslErrorCode.MISMATCHED_BLOCK_END.message(block.kind, block.name, `END ${block.endName}`),
          line: block.span.endLine,
          column: block.span.endColumn,
          startOffset: block.span.startOffset,
          endOffset: block.span.endOffset,
          symbolName: block.name,
        });
      }
    }

    // Build local scope and check ESL2001 (duplicate declaration)
    const localSeen = new Map<string, EslDeclaration | { name: string }>();
    const scope = new Map<string, SymbolInfo>(parentScope);
    const constantNames = new Set<string>();
    for (const [k, v] of scope) {
      if (v.isConstant) constantNames.add(k);
    }

    for (const param of block.parameters) {
      const key = param.name.toUpperCase();
      if (localSeen.has(key)) {
        diagnostics.push({
          code: EslErrorCode.DUPLICATE_DECLARATION.code,
          id: EslErrorCode.DUPLICATE_DECLARATION.id,
          rule: EslErrorCode.DUPLICATE_DECLARATION.rule,
          severity: EslErrorCode.DUPLICATE_DECLARATION.severity,
          message: EslErrorCode.DUPLICATE_DECLARATION.message(param.name, block.name),
          line: param.span.line,
          column: param.span.column,
          endLine: param.span.endLine,
          endColumn: param.span.endColumn,
          startOffset: param.span.startOffset,
          endOffset: param.span.endOffset,
          symbolName: param.name,
        });
      } else {
        localSeen.set(key, param);
        scope.set(key, {
          name: param.name,
          dataType: param.dataType ?? "REAL",
          isConstant: param.dataType === "CONSTANT",
        });
      }
    }

    for (const decl of block.declarations) {
      const key = decl.name.toUpperCase();
      if (localSeen.has(key)) {
        diagnostics.push({
          code: EslErrorCode.DUPLICATE_DECLARATION.code,
          id: EslErrorCode.DUPLICATE_DECLARATION.id,
          rule: EslErrorCode.DUPLICATE_DECLARATION.rule,
          severity: EslErrorCode.DUPLICATE_DECLARATION.severity,
          message: EslErrorCode.DUPLICATE_DECLARATION.message(decl.name, block.name),
          line: decl.span.line,
          column: decl.span.column,
          endLine: decl.span.endLine,
          endColumn: decl.span.endColumn,
          startOffset: decl.span.startOffset,
          endOffset: decl.span.endOffset,
          symbolName: decl.name,
        });
      } else {
        localSeen.set(key, decl);
        scope.set(key, {
          name: decl.name,
          dataType: decl.dataType,
          isConstant: decl.isConstant,
        });
        if (decl.isConstant) constantNames.add(key);
      }
    }

    // Check declaration initial value expressions
    for (const decl of block.declarations) {
      if (decl.initialValue) {
        checkExpr(decl.initialValue, scope, block.name);
      }
    }

    // Check all sections
    const allSections: EslStatement[][] = [
      block.initialStatements,
      block.dynamicStatements,
      block.stepStatements,
      block.terminalStatements,
    ];
    for (const stmts of allSections) {
      for (const stmt of stmts) {
        checkStatement(stmt, scope, constantNames, block.name);
      }
    }

    // Recurse into child blocks
    for (const child of block.children) {
      lintBlock(child, scope);
    }
  };

  const checkDerivativeTarget = (
    target: string,
    scope: Map<string, SymbolInfo>,
    span: { line: number; column: number; endLine: number; endColumn: number; startOffset: number; endOffset: number },
  ): void => {
    const key = target.toUpperCase();
    const sym = scope.get(key);
    if (!sym) {
      diagnostics.push({
        code: EslErrorCode.INVALID_DERIVATIVE_TARGET.code,
        id: EslErrorCode.INVALID_DERIVATIVE_TARGET.id,
        rule: EslErrorCode.INVALID_DERIVATIVE_TARGET.rule,
        severity: EslErrorCode.INVALID_DERIVATIVE_TARGET.severity,
        message: EslErrorCode.INVALID_DERIVATIVE_TARGET.message(target, "variable is not declared as a REAL state"),
        line: span.line,
        column: span.column,
        endLine: span.endLine,
        endColumn: span.endColumn,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        symbolName: target,
      });
      return;
    }
    if (sym.isConstant || sym.dataType === "CONSTANT") {
      diagnostics.push({
        code: EslErrorCode.INVALID_DERIVATIVE_TARGET.code,
        id: EslErrorCode.INVALID_DERIVATIVE_TARGET.id,
        rule: EslErrorCode.INVALID_DERIVATIVE_TARGET.rule,
        severity: EslErrorCode.INVALID_DERIVATIVE_TARGET.severity,
        message: EslErrorCode.INVALID_DERIVATIVE_TARGET.message(target, "cannot differentiate a CONSTANT"),
        line: span.line,
        column: span.column,
        endLine: span.endLine,
        endColumn: span.endColumn,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        symbolName: target,
      });
    } else if (sym.dataType === "INTEGER" || sym.dataType === "LOGICAL") {
      diagnostics.push({
        code: EslErrorCode.INVALID_DERIVATIVE_TARGET.code,
        id: EslErrorCode.INVALID_DERIVATIVE_TARGET.id,
        rule: EslErrorCode.INVALID_DERIVATIVE_TARGET.rule,
        severity: EslErrorCode.INVALID_DERIVATIVE_TARGET.severity,
        message: EslErrorCode.INVALID_DERIVATIVE_TARGET.message(
          target,
          `cannot differentiate ${sym.dataType} variable (must be REAL)`,
        ),
        line: span.line,
        column: span.column,
        endLine: span.endLine,
        endColumn: span.endColumn,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        symbolName: target,
      });
    }
  };

  const checkSubmodelArity = (
    callee: string,
    argCount: number,
    span: { line: number; column: number; endLine: number; endColumn: number; startOffset: number; endOffset: number },
  ): void => {
    const sm = submodelMap.get(callee.toUpperCase());
    if (sm && sm.parameters.length !== argCount) {
      diagnostics.push({
        code: EslErrorCode.SUBMODEL_ARITY_MISMATCH.code,
        id: EslErrorCode.SUBMODEL_ARITY_MISMATCH.id,
        rule: EslErrorCode.SUBMODEL_ARITY_MISMATCH.rule,
        severity: EslErrorCode.SUBMODEL_ARITY_MISMATCH.severity,
        message: EslErrorCode.SUBMODEL_ARITY_MISMATCH.message(callee, sm.parameters.length, argCount),
        line: span.line,
        column: span.column,
        endLine: span.endLine,
        endColumn: span.endColumn,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        symbolName: callee,
      });
    }
  };

  const checkExpr = (expr: EslExpr, scope: Map<string, SymbolInfo>, scopeName: string): void => {
    switch (expr.kind) {
      case "number":
      case "boolean":
      case "string":
        return;
      case "identifier": {
        const key = expr.name.toUpperCase();
        if (!scope.has(key) && !BUILTIN_VARS.has(key) && !submodelMap.has(key)) {
          diagnostics.push({
            code: EslErrorCode.UNDEFINED_IDENTIFIER.code,
            id: EslErrorCode.UNDEFINED_IDENTIFIER.id,
            rule: EslErrorCode.UNDEFINED_IDENTIFIER.rule,
            severity: EslErrorCode.UNDEFINED_IDENTIFIER.severity,
            message: EslErrorCode.UNDEFINED_IDENTIFIER.message(expr.name, scopeName),
            line: expr.span.line,
            column: expr.span.column,
            endLine: expr.span.endLine,
            endColumn: expr.span.endColumn,
            startOffset: expr.span.startOffset,
            endOffset: expr.span.endOffset,
            symbolName: expr.name,
          });
        }
        return;
      }
      case "derivative":
        checkDerivativeTarget(expr.target, scope, expr.span);
        return;
      case "unary":
        checkExpr(expr.operand, scope, scopeName);
        return;
      case "binary":
        checkExpr(expr.left, scope, scopeName);
        checkExpr(expr.right, scope, scopeName);
        return;
      case "call": {
        const key = expr.callee.toUpperCase();
        if (submodelMap.has(key)) {
          checkSubmodelArity(expr.callee, expr.args.length, expr.span);
        } else if (!BUILTIN_FUNCS.has(key) && !scope.has(key)) {
          diagnostics.push({
            code: EslErrorCode.UNDEFINED_IDENTIFIER.code,
            id: EslErrorCode.UNDEFINED_IDENTIFIER.id,
            rule: EslErrorCode.UNDEFINED_IDENTIFIER.rule,
            severity: EslErrorCode.UNDEFINED_IDENTIFIER.severity,
            message: EslErrorCode.UNDEFINED_IDENTIFIER.message(expr.callee, scopeName),
            line: expr.span.line,
            column: expr.span.column,
            endLine: expr.span.endLine,
            endColumn: expr.span.endColumn,
            startOffset: expr.span.startOffset,
            endOffset: expr.span.endOffset,
            symbolName: expr.callee,
          });
        }
        for (const arg of expr.args) checkExpr(arg, scope, scopeName);
        return;
      }
      case "conditional":
        checkExpr(expr.condition, scope, scopeName);
        checkExpr(expr.thenExpr, scope, scopeName);
        checkExpr(expr.elseExpr, scope, scopeName);
        return;
    }
  };

  const checkStatement = (
    stmt: EslStatement,
    scope: Map<string, SymbolInfo>,
    constantNames: Set<string>,
    scopeName: string,
  ): void => {
    switch (stmt.kind) {
      case "assign": {
        if (stmt.isDerivative) {
          checkDerivativeTarget(stmt.target, scope, stmt.span);
        } else {
          const key = stmt.target.toUpperCase();
          if (!scope.has(key) && !BUILTIN_VARS.has(key)) {
            diagnostics.push({
              code: EslErrorCode.UNDEFINED_IDENTIFIER.code,
              id: EslErrorCode.UNDEFINED_IDENTIFIER.id,
              rule: EslErrorCode.UNDEFINED_IDENTIFIER.rule,
              severity: EslErrorCode.UNDEFINED_IDENTIFIER.severity,
              message: EslErrorCode.UNDEFINED_IDENTIFIER.message(stmt.target, scopeName),
              line: stmt.span.line,
              column: stmt.span.column,
              endLine: stmt.span.endLine,
              endColumn: stmt.span.endColumn,
              startOffset: stmt.span.startOffset,
              endOffset: stmt.span.endOffset,
              symbolName: stmt.target,
            });
          }
        }
        checkExpr(stmt.value, scope, scopeName);
        return;
      }
      case "when": {
        checkExpr(stmt.condition, scope, scopeName);
        if (!isBooleanOrRelationalExpr(stmt.condition, scope)) {
          diagnostics.push({
            code: EslErrorCode.INVALID_WHEN_DISCONTINUITY.code,
            id: EslErrorCode.INVALID_WHEN_DISCONTINUITY.id,
            rule: EslErrorCode.INVALID_WHEN_DISCONTINUITY.rule,
            severity: EslErrorCode.INVALID_WHEN_DISCONTINUITY.severity,
            message: EslErrorCode.INVALID_WHEN_DISCONTINUITY.message(
              "condition must be a relational or logical crossing expression",
            ),
            line: stmt.condition.span.line,
            column: stmt.condition.span.column,
            endLine: stmt.condition.span.endLine,
            endColumn: stmt.condition.span.endColumn,
            startOffset: stmt.condition.span.startOffset,
            endOffset: stmt.condition.span.endOffset,
          });
        } else if (!exprHasDynamicRef(stmt.condition, constantNames)) {
          diagnostics.push({
            code: EslErrorCode.INVALID_WHEN_DISCONTINUITY.code,
            id: EslErrorCode.INVALID_WHEN_DISCONTINUITY.id,
            rule: EslErrorCode.INVALID_WHEN_DISCONTINUITY.rule,
            severity: EslErrorCode.INVALID_WHEN_DISCONTINUITY.severity,
            message: EslErrorCode.INVALID_WHEN_DISCONTINUITY.message(
              "discontinuity trigger must depend on at least one dynamic state or simulation time",
            ),
            line: stmt.condition.span.line,
            column: stmt.condition.span.column,
            endLine: stmt.condition.span.endLine,
            endColumn: stmt.condition.span.endColumn,
            startOffset: stmt.condition.span.startOffset,
            endOffset: stmt.condition.span.endOffset,
          });
        }
        for (const s of stmt.body) checkStatement(s, scope, constantNames, scopeName);
        for (const s of stmt.elseBody) checkStatement(s, scope, constantNames, scopeName);
        return;
      }
      case "if": {
        checkExpr(stmt.condition, scope, scopeName);
        for (const s of stmt.thenBody) checkStatement(s, scope, constantNames, scopeName);
        for (const s of stmt.elseBody) checkStatement(s, scope, constantNames, scopeName);
        return;
      }
      case "submodel_call": {
        const key = stmt.callee.toUpperCase();
        if (submodelMap.has(key)) {
          checkSubmodelArity(stmt.callee, stmt.args.length, stmt.span);
        } else if (!BUILTIN_FUNCS.has(key)) {
          diagnostics.push({
            code: EslErrorCode.UNDEFINED_IDENTIFIER.code,
            id: EslErrorCode.UNDEFINED_IDENTIFIER.id,
            rule: EslErrorCode.UNDEFINED_IDENTIFIER.rule,
            severity: EslErrorCode.UNDEFINED_IDENTIFIER.severity,
            message: EslErrorCode.UNDEFINED_IDENTIFIER.message(stmt.callee, scopeName),
            line: stmt.span.line,
            column: stmt.span.column,
            endLine: stmt.span.endLine,
            endColumn: stmt.span.endColumn,
            startOffset: stmt.span.startOffset,
            endOffset: stmt.span.endOffset,
            symbolName: stmt.callee,
          });
        }
        for (const arg of stmt.args) checkExpr(arg, scope, scopeName);
        return;
      }
      case "terminate":
        checkExpr(stmt.condition, scope, scopeName);
        return;
      case "prepare":
      case "plot":
      case "print":
        for (const v of stmt.variables) {
          const key = v.toUpperCase();
          if (!scope.has(key) && !BUILTIN_VARS.has(key)) {
            diagnostics.push({
              code: EslErrorCode.UNDEFINED_IDENTIFIER.code,
              id: EslErrorCode.UNDEFINED_IDENTIFIER.id,
              rule: EslErrorCode.UNDEFINED_IDENTIFIER.rule,
              severity: EslErrorCode.UNDEFINED_IDENTIFIER.severity,
              message: EslErrorCode.UNDEFINED_IDENTIFIER.message(v, scopeName),
              line: stmt.span.line,
              column: stmt.span.column,
              startOffset: stmt.span.startOffset,
              endOffset: stmt.span.endOffset,
              symbolName: v,
            });
          }
        }
        return;
    }
  };

  for (const block of program.blocks) {
    lintBlock(block, globalSymbols);
  }

  return diagnostics;
}

/**
 * Convenience helper to parse and lint ESL source text in one call.
 */
export function lintEslSource(source: string): EslDiagnostic[] {
  return lintEsl(parseEsl(source));
}

export { EslErrorCode, type EslDiagnostic };
