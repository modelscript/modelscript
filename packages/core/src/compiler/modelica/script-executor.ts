// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-native script executor for .mos files and notebook cells.
 *
 * Replaces the `ModelicaInterpreter.visitStoredDefinition()` flow with a
 * lightweight CST walker that does not depend on ModelicaInterpreter. Uses
 * `evaluateCSTExpression()` from `annotation-evaluator.ts` for expressions,
 * and `ModelicaScriptScope` from `scope.ts` for variable storage.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ModelicaComponentClauseSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaSyntaxNode,
  ModelicaWhileStatementSyntaxNode,
} from "@modelscript/modelica/ast";

import { ModelicaScriptScope, Scope } from "../scope.js";
import { evaluateCSTExpression } from "./annotation-evaluator.js";

// ── Scripting Handler Registry ──────────────────────────────────────────────
// Maintains the same pattern as the legacy `ModelicaInterpreter.scriptingHandlers`
// but as a standalone module-level map. Existing packages (simulator, optimizer)
// register their handlers here instead of on the `ModelicaInterpreter` class.

/**
 * Callback signature for evaluating a CST expression node in a given scope.
 * Scripting handlers receive this to evaluate arguments.
 */
export type ScriptEvalCallback = (expr: ModelicaSyntaxNode, scope: Scope) => any;

/**
 * Function signature for registered scripting commands (simulate, optimize, etc.).
 * Compatible with the legacy `BuiltinScriptingFunction` type.
 */
export type ScriptingHandler = (node: ModelicaFunctionCallSyntaxNode, scope: Scope, evalCb: ScriptEvalCallback) => any;

/**
 * Module-level scripting handler registry.
 * Packages register handlers via `registerScriptingHandler()`.
 */
const scriptingHandlers = new Map<string, ScriptingHandler>();

/**
 * Register a scripting handler for a given function name.
 * Called by simulator/optimizer packages at import time.
 */
export function registerScriptingHandler(name: string, handler: ScriptingHandler): void {
  scriptingHandlers.set(name, handler);
}

/**
 * Check if a scripting handler is registered for a given name.
 */
export function hasScriptingHandler(name: string): boolean {
  return scriptingHandlers.has(name);
}

// ── CST Expression Evaluator Adapter ────────────────────────────────────────
// Wraps `evaluateCSTExpression` to satisfy the `ScriptEvalCallback` signature.

function makeEvalCallback(): ScriptEvalCallback {
  return (expr: ModelicaSyntaxNode, s: Scope) => {
    if (expr instanceof ModelicaExpressionSyntaxNode) {
      return evaluateCSTExpression(expr, s);
    }
    return null;
  };
}

// ── Print Handler ───────────────────────────────────────────────────────────

function handlePrint(
  node: ModelicaFunctionCallSyntaxNode,
  scope: Scope,
  printCallback: ((msg: string) => void) | undefined,
): void {
  const args = node.functionCallArguments?.arguments ?? [];
  if (args.length > 0 && args[0]?.expression) {
    const val = evaluateCSTExpression(args[0].expression, scope);
    if (printCallback && val != null) {
      printCallback(typeof val === "string" ? val : JSON.stringify(val));
    }
  }
}

// ── Script Executor ─────────────────────────────────────────────────────────

/**
 * Execute a parsed `.mos` script (or notebook cell) without using ModelicaInterpreter.
 *
 * @param storedDef - The parsed CST root node.
 * @param scope - A `ModelicaScriptScope` (or parent scope to wrap).
 * @param printCallback - Optional callback for `print()` output.
 */
export function executeScript(
  storedDef: ModelicaStoredDefinitionSyntaxNode,
  scope: Scope,
  printCallback?: (msg: string) => void,
): void {
  const scriptScope = scope instanceof ModelicaScriptScope ? scope : new ModelicaScriptScope(scope);

  // 1. Register class definitions in the scope
  for (const classDef of storedDef.classDefinitions) {
    const name = classDef.identifier?.text;
    if (name) {
      // Store as a lightweight shim — just needs .name and resolveSimpleName
      scriptScope.classDefinitions.set(name, classDef as any);
    }
  }

  // 2. Evaluate top-level variable declarations (e.g., Real x = 10;)
  for (const componentClause of storedDef.componentClauses) {
    evaluateComponentClause(componentClause, scriptScope);
  }

  // 3. Execute top-level statements
  for (const stmt of storedDef.statements) {
    executeStatement(stmt, scriptScope, printCallback);
  }
}

/**
 * Evaluate a component clause (variable declaration) in the script scope.
 */
function evaluateComponentClause(clause: ModelicaComponentClauseSyntaxNode, scope: ModelicaScriptScope): void {
  for (const decl of clause.componentDeclarations) {
    const name = decl.declaration?.identifier?.text;
    if (!name) continue;

    let initialValue: any = null;
    if (decl.declaration?.modification?.modificationExpression?.expression) {
      initialValue = evaluateCSTExpression(decl.declaration.modification.modificationExpression.expression, scope);
    }

    // Store as a lightweight variable shim with the evaluated value
    const variable = {
      name,
      isComponentInstance: true,
      isClassInstance: false,
      classInstance: null,
      modification: { evaluatedExpression: initialValue },
      value: initialValue,
      resolveSimpleName: () => null,
    };
    scope.variables.set(name, variable as any);
  }
}

/**
 * Execute a single statement node in the script scope.
 */
function executeStatement(
  stmt: ModelicaSyntaxNode,
  scope: ModelicaScriptScope,
  printCallback?: (msg: string) => void,
): void {
  // Simple assignment: x := expr;
  if (stmt instanceof ModelicaSimpleAssignmentStatementSyntaxNode) {
    const targetName = stmt.target?.parts?.[0]?.identifier?.text;
    if (!targetName) return;

    const value = stmt.source ? evaluateCSTExpression(stmt.source, scope) : null;
    const existing = scope.variables.get(targetName);
    if (existing) {
      // Update existing variable
      (existing as any).modification = { evaluatedExpression: value };
      (existing as any).value = value;
    } else {
      // Dynamic variable creation
      const variable = {
        name: targetName,
        isComponentInstance: true,
        isClassInstance: false,
        classInstance: null,
        modification: { evaluatedExpression: value },
        value,
        resolveSimpleName: () => null,
      };
      scope.variables.set(targetName, variable as any);
    }
    return;
  }

  // Procedure call: foo(args);
  if (stmt instanceof ModelicaProcedureCallStatementSyntaxNode) {
    const funcName = stmt.functionReference?.parts?.[0]?.identifier?.text;
    if (!funcName) return;

    // Check print() built-in
    if (funcName === "print") {
      const callNode = stmt as any;
      if (callNode.functionCallArguments || callNode.arguments) {
        handlePrint(callNode as any, scope, printCallback);
      }
      return;
    }

    // Check registered scripting handlers (simulate, optimize, etc.)
    const handler = scriptingHandlers.get(funcName);
    if (handler) {
      // Build a synthetic function call node from the procedure call
      handler(stmt as any, scope, makeEvalCallback());
      return;
    }
    return;
  }

  // Function call as expression (used via ModelicaFunctionCallSyntaxNode)
  if (stmt instanceof ModelicaFunctionCallSyntaxNode) {
    const funcNameParts = stmt.functionReference?.parts?.map((p: any) => p.identifier?.text);
    const funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : null;
    if (!funcName) return;

    if (funcName === "print") {
      handlePrint(stmt, scope, printCallback);
      return;
    }

    const handler = scriptingHandlers.get(funcName);
    if (handler) {
      handler(stmt, scope, makeEvalCallback());
      return;
    }
    return;
  }

  // If statement
  if (stmt instanceof ModelicaIfStatementSyntaxNode) {
    const cond = stmt.condition ? evaluateCSTExpression(stmt.condition, scope) : null;
    if (cond === true) {
      for (const s of stmt.statements) executeStatement(s, scope, printCallback);
      return;
    }
    for (const clause of stmt.elseIfStatementClauses) {
      const elseIfCond = clause.condition ? evaluateCSTExpression(clause.condition, scope) : null;
      if (elseIfCond === true) {
        for (const s of clause.statements) executeStatement(s, scope, printCallback);
        return;
      }
    }
    for (const s of stmt.elseStatements) executeStatement(s, scope, printCallback);
    return;
  }

  // For statement
  if (stmt instanceof ModelicaForStatementSyntaxNode) {
    for (const forIndex of stmt.forIndexes) {
      const iterName = forIndex.identifier?.text;
      const iterExpr = forIndex.expression ? evaluateCSTExpression(forIndex.expression, scope) : null;
      if (!iterName || !Array.isArray(iterExpr)) continue;
      for (const val of iterExpr) {
        // Bind iteration variable
        const iterVar = {
          name: iterName,
          isComponentInstance: true,
          isClassInstance: false,
          classInstance: null,
          modification: { evaluatedExpression: val },
          value: val,
          resolveSimpleName: () => null,
        };
        scope.variables.set(iterName, iterVar as any);
        for (const s of stmt.statements) executeStatement(s, scope, printCallback);
      }
      // Clean up iteration variable
      scope.variables.delete(iterName);
    }
    return;
  }

  // While statement
  if (stmt instanceof ModelicaWhileStatementSyntaxNode) {
    let maxIter = 10000;
    while (maxIter-- > 0) {
      const cond = stmt.condition ? evaluateCSTExpression(stmt.condition, scope) : null;
      if (cond !== true) break;
      for (const s of stmt.statements) executeStatement(s, scope, printCallback);
    }
    return;
  }
}
