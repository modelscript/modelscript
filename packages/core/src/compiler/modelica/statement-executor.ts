// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Statement executor for Modelica algorithm sections.
 *
 * Takes an `ExpressionEvaluator` and executes a sequence of statements,
 * modifying the evaluator's environment. This enables:
 * - Algorithm sections in models (imperative blocks alongside equations)
 * - Function body execution (user-defined Modelica functions)
 * - Complex initialization logic
 */

import {
  ExpressionEvaluator,
  ModelicaArray,
  ModelicaAssignmentStatement,
  ModelicaBooleanLiteral,
  ModelicaBreakStatement,
  ModelicaComplexAssignmentStatement,
  type ModelicaDAE,
  ModelicaForStatement,
  ModelicaFunctionCallExpression,
  ModelicaIfStatement,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaProcedureCallStatement,
  ModelicaRangeExpression,
  ModelicaRealLiteral,
  ModelicaReturnStatement,
  type ModelicaStatement,
  ModelicaVariable,
  ModelicaWhenStatement,
  ModelicaWhileStatement,
} from "./dae.js";

/**
 * Sentinel thrown when a `return` statement is executed inside a
 * function body.  The caller (`executeFunction`) catches this to
 * terminate function execution and extract output values.
 */
export const ReturnSignal = Object.freeze({ __brand: "ReturnSignal" as const });
export type ReturnSignal = typeof ReturnSignal;

/**
 * Sentinel thrown when a `break` statement is executed inside a
 * loop body.  The nearest for/while loop catches this.
 */
export const BreakSignal = Object.freeze({ __brand: "BreakSignal" as const });
export type BreakSignal = typeof BreakSignal;

/** Maximum iterations allowed for a while-loop to prevent infinite loops. */
const MAX_WHILE_ITERATIONS = 100_000;

/** Maximum loop iterations for for-loops (guards against huge ranges). */
const MAX_FOR_ITERATIONS = 1_000_000;

/**
 * Execute a list of Modelica algorithm-section statements against an
 * expression evaluator environment.
 *
 * @param statements  The statements to execute.
 * @param evaluator   The expression evaluator whose `env` map will be
 *                    read and written by assignments.
 * @param functionLookup  Optional callback to resolve user-defined function
 *                        calls.  Receives the function name and evaluated
 *                        argument values; returns the function result or
 *                        `null` if the function is not found.
 *
 * @throws {ReturnSignal}  if a `return` statement is reached.
 * @throws {BreakSignal}   if a `break` statement is reached (only valid
 *                         inside a loop — the enclosing loop catches it).
 */
export function executeStatements(
  statements: ModelicaStatement[],
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  for (const stmt of statements) {
    executeStatement(stmt, evaluator, functionLookup);
  }
}

/**
 * Execute a single Modelica statement.
 */
function executeStatement(
  stmt: ModelicaStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  // ── Assignment: target := source ──
  if (stmt instanceof ModelicaAssignmentStatement) {
    const value = evaluator.evaluate(stmt.source);
    if (value !== null) {
      const targetName = extractTargetName(stmt.target);
      if (targetName) {
        evaluator.env.set(targetName, value);
      }
    }
    return;
  }

  // ── For-loop: for i in range loop ... end for ──
  if (stmt instanceof ModelicaForStatement) {
    executeForStatement(stmt, evaluator, functionLookup);
    return;
  }

  // ── While-loop: while cond loop ... end while ──
  if (stmt instanceof ModelicaWhileStatement) {
    executeWhileStatement(stmt, evaluator, functionLookup);
    return;
  }

  // ── If-statement: if cond then ... elseif ... else ... end if ──
  if (stmt instanceof ModelicaIfStatement) {
    executeIfStatement(stmt, evaluator, functionLookup);
    return;
  }

  // ── Return: terminates function execution ──
  if (stmt instanceof ModelicaReturnStatement) {
    throw ReturnSignal;
  }

  // ── Break: terminates enclosing loop ──
  if (stmt instanceof ModelicaBreakStatement) {
    throw BreakSignal;
  }

  // ── Procedure call: functionName(args) ──
  if (stmt instanceof ModelicaProcedureCallStatement) {
    executeProcedureCall(stmt, evaluator, functionLookup);
    return;
  }

  // ── Complex assignment: (x, y, _) := f(args) ──
  if (stmt instanceof ModelicaComplexAssignmentStatement) {
    executeComplexAssignment(stmt, evaluator, functionLookup);
    return;
  }

  // ── When-statement (in algorithm sections) ──
  if (stmt instanceof ModelicaWhenStatement) {
    executeWhenStatement(stmt, evaluator, functionLookup);
    return;
  }

  // Unknown statement type — silently skip
}

// ──────────────────────────────────────────────────────────────────
//  For-loop execution
// ──────────────────────────────────────────────────────────────────

function executeForStatement(
  stmt: ModelicaForStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  const rangeValues = evaluateRange(stmt.range, evaluator);
  if (!rangeValues) return;

  const previousValue = evaluator.env.get(stmt.indexName);
  let iterCount = 0;

  try {
    for (const indexVal of rangeValues) {
      if (++iterCount > MAX_FOR_ITERATIONS) {
        throw new Error(`For-loop exceeded ${MAX_FOR_ITERATIONS} iterations (index '${stmt.indexName}').`);
      }
      evaluator.env.set(stmt.indexName, indexVal);
      try {
        executeStatements(stmt.statements, evaluator, functionLookup);
      } catch (e) {
        if (e === BreakSignal) break;
        throw e; // ReturnSignal propagates up
      }
    }
  } finally {
    // Restore previous value of the loop variable (or delete if it didn't exist)
    if (previousValue !== undefined) {
      evaluator.env.set(stmt.indexName, previousValue);
    } else {
      evaluator.env.delete(stmt.indexName);
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  While-loop execution
// ──────────────────────────────────────────────────────────────────

function executeWhileStatement(
  stmt: ModelicaWhileStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  let iterCount = 0;

  while (true) {
    if (++iterCount > MAX_WHILE_ITERATIONS) {
      throw new Error(`While-loop exceeded ${MAX_WHILE_ITERATIONS} iterations.`);
    }

    const condVal = evaluator.evaluate(stmt.condition);
    if (condVal === null || condVal === 0) break;

    try {
      executeStatements(stmt.statements, evaluator, functionLookup);
    } catch (e) {
      if (e === BreakSignal) break;
      throw e;
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  If-statement execution
// ──────────────────────────────────────────────────────────────────

function executeIfStatement(
  stmt: ModelicaIfStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  const condVal = evaluator.evaluate(stmt.condition);
  if (condVal !== null && condVal !== 0) {
    executeStatements(stmt.statements, evaluator, functionLookup);
    return;
  }

  for (const clause of stmt.elseIfClauses) {
    const elseIfCond = evaluator.evaluate(clause.condition);
    if (elseIfCond !== null && elseIfCond !== 0) {
      executeStatements(clause.statements, evaluator, functionLookup);
      return;
    }
  }

  if (stmt.elseStatements.length > 0) {
    executeStatements(stmt.elseStatements, evaluator, functionLookup);
  }
}

// ──────────────────────────────────────────────────────────────────
//  Procedure call execution
// ──────────────────────────────────────────────────────────────────

function executeProcedureCall(
  stmt: ModelicaProcedureCallStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  const call = stmt.call;

  // Handle built-in procedure-like calls
  if (call.functionName === "assert") {
    // assert(condition, message) — evaluate condition; if false, throw
    const firstArg = call.args[0];
    if (firstArg) {
      const condVal = evaluator.evaluate(firstArg);
      if (condVal !== null && condVal === 0) {
        // TODO: extract message from args[1] when string support is added
        throw new Error("Modelica assertion failed");
      }
    }
    return;
  }

  if (call.functionName === "terminate") {
    throw new Error("Modelica terminate() called");
  }

  if (call.functionName === "print") {
    // Silently consume print() calls
    return;
  }

  // Delegate to the function lookup for user-defined procedures
  if (functionLookup) {
    const argValues: number[] = [];
    for (const arg of call.args) {
      const val = evaluator.evaluate(arg);
      if (val === null) return; // Can't evaluate args — skip
      argValues.push(val);
    }
    functionLookup(call.functionName, argValues);
  }
}

// ──────────────────────────────────────────────────────────────────
//  Complex assignment execution: (x, y, _) := f(args)
// ──────────────────────────────────────────────────────────────────

function executeComplexAssignment(
  stmt: ModelicaComplexAssignmentStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  // For now, only handle the case where the source is a single expression
  // that can be evaluated to a scalar.  Full multi-output function support
  // requires Step 1.2 (user-defined function calls).
  if (stmt.targets.length === 1) {
    const target = stmt.targets[0];
    if (target) {
      const value = evaluator.evaluate(stmt.source);
      if (value !== null) {
        const name = extractTargetName(target);
        if (name) evaluator.env.set(name, value);
      }
    }
    return;
  }

  // Multi-output: delegate to functionLookup if available
  if (functionLookup && stmt.source instanceof ModelicaFunctionCallExpression) {
    const argValues: number[] = [];
    for (const arg of stmt.source.args) {
      const val = evaluator.evaluate(arg);
      if (val === null) return;
      argValues.push(val);
    }

    // Call the function — for now the functionLookup returns a single value.
    // Full multi-output support will be added in Step 1.2.
    const result = functionLookup(stmt.source.functionName, argValues);
    if (result !== null && stmt.targets.length > 0) {
      const firstTarget = stmt.targets[0];
      if (firstTarget) {
        const name = extractTargetName(firstTarget);
        if (name) evaluator.env.set(name, result);
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  When-statement execution (in algorithm sections)
// ──────────────────────────────────────────────────────────────────

function executeWhenStatement(
  stmt: ModelicaWhenStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
): void {
  // In algorithm sections, a when-statement fires on the rising edge
  // of its condition.  For steady-state / initialization contexts,
  // we evaluate the condition and execute the body if it's true.
  const condVal = evaluator.evaluate(stmt.condition);
  if (condVal !== null && condVal !== 0) {
    executeStatements(stmt.statements, evaluator, functionLookup);
    return;
  }

  // Check elseWhen clauses
  for (const clause of stmt.elseWhenClauses) {
    const elseCondVal = evaluator.evaluate(clause.condition);
    if (elseCondVal !== null && elseCondVal !== 0) {
      executeStatements(clause.statements, evaluator, functionLookup);
      return;
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  Utility: extract a variable name from an assignment target
// ──────────────────────────────────────────────────────────────────

import type { ModelicaExpression } from "./dae.js";

/**
 * Extract the variable name from an assignment target expression.
 *
 * Handles:
 * - `ModelicaVariable` → `v.name`
 * - `ModelicaNameExpression` → `expr.name`
 * - Subscripted expressions like `x[i]` → `x[<evaluated-i>]` (for scalar env lookup)
 */
function extractTargetName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaVariable) return expr.name;
  if (expr instanceof ModelicaNameExpression) return expr.name;
  // For subscripted targets, we'd need to build `name[idx]` strings.
  // For now, fall back to anything with a `.name` property.
  if ("name" in expr && typeof (expr as { name: unknown }).name === "string") {
    return (expr as { name: string }).name;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
//  Utility: evaluate a range expression to an array of index values
// ──────────────────────────────────────────────────────────────────

/**
 * Evaluate a range expression (e.g., `1:N`, `1:2:10`) to an array of values.
 *
 * Supports:
 * - `ModelicaRangeExpression` with start, optional step, end
 * - Literal integers/reals as a single-element range
 * - `ModelicaNameExpression` looked up from the evaluator
 */
function evaluateRange(range: ModelicaExpression, evaluator: ExpressionEvaluator): number[] | null {
  if (range instanceof ModelicaRangeExpression) {
    const startVal = evaluator.evaluate(range.start);
    const endVal = evaluator.evaluate(range.end);
    if (startVal === null || endVal === null) return null;

    let stepVal = 1;
    if (range.step) {
      const s = evaluator.evaluate(range.step);
      if (s === null || s === 0) return null;
      stepVal = s;
    }

    const values: number[] = [];
    if (stepVal > 0) {
      for (let v = startVal; v <= endVal + 1e-10; v += stepVal) {
        values.push(Math.round(v * 1e10) / 1e10); // Avoid floating-point drift
      }
    } else {
      for (let v = startVal; v >= endVal - 1e-10; v += stepVal) {
        values.push(Math.round(v * 1e10) / 1e10);
      }
    }
    return values;
  }

  // Single-value "range" (e.g., used in `for i in {1, 3, 5}`)
  if (range instanceof ModelicaArray) {
    const values: number[] = [];
    for (const el of range.elements) {
      const v = evaluator.evaluate(el);
      if (v !== null) values.push(v);
    }
    return values;
  }
  if (range instanceof ModelicaRealLiteral || range instanceof ModelicaIntegerLiteral) {
    return [range.value];
  }
  if (range instanceof ModelicaBooleanLiteral) {
    return [range.value ? 1 : 0];
  }

  // Try evaluating as a general expression (might be a parameter reference)
  const val = evaluator.evaluate(range);
  if (val !== null) return [val];

  return null;
}

// ──────────────────────────────────────────────────────────────────
//  User-defined function execution
// ──────────────────────────────────────────────────────────────────

/** Maximum call stack depth for recursive function calls. */
const MAX_CALL_DEPTH = 256;

/** Tracks the current call depth to detect infinite recursion. */
let currentCallDepth = 0;

/**
 * Execute a user-defined Modelica function DAE.
 *
 * Creates a fresh evaluator scope, binds positional arguments to input
 * variables, initializes protected/output variables from defaults,
 * executes algorithm sections, and returns the first output variable value.
 *
 * @param funcDae     The function's flattened DAE (from `dae.functions[]`).
 * @param argValues   Positional argument values (one per input variable).
 * @param parentLookup  The function lookup callback for nested calls.
 * @returns The value of the first output variable, or `null` on failure.
 */
export function executeFunction(
  funcDae: ModelicaDAE,
  argValues: number[],
  parentLookup?: (name: string, args: number[]) => number | null,
): number | null {
  if (++currentCallDepth > MAX_CALL_DEPTH) {
    currentCallDepth--;
    throw new Error(`Maximum call depth (${MAX_CALL_DEPTH}) exceeded in function '${funcDae.name}'.`);
  }

  try {
    // Partition variables by role
    const inputVars = funcDae.variables.filter((v) => v.causality === "input");
    const outputVars = funcDae.variables.filter((v) => v.causality === "output");
    const otherVars = funcDae.variables.filter((v) => v.causality !== "input" && v.causality !== "output");

    // Create a fresh evaluator scope for the function body
    const funcEnv = new Map<string, number>();
    const funcEvaluator = new ExpressionEvaluator(funcEnv);
    funcEvaluator.functionLookup = parentLookup ?? null;

    // Bind positional arguments to input variables
    for (let i = 0; i < inputVars.length; i++) {
      const inputVar = inputVars[i];
      if (!inputVar) continue;

      if (i < argValues.length) {
        // Positional argument provided
        funcEnv.set(inputVar.name, argValues[i] ?? 0);
      } else if (inputVar.expression) {
        // Use default value from the function signature
        const defaultVal = funcEvaluator.evaluate(inputVar.expression);
        funcEnv.set(inputVar.name, defaultVal ?? 0);
      }
      // If neither argument nor default, variable remains unset (will be null on access)
    }

    // Initialize output variables from their default expressions (if any)
    for (const outVar of outputVars) {
      if (outVar.expression) {
        const val = funcEvaluator.evaluate(outVar.expression);
        if (val !== null) funcEnv.set(outVar.name, val);
      }
    }

    // Initialize protected/local variables from their default expressions
    for (const localVar of otherVars) {
      if (localVar.expression) {
        const val = funcEvaluator.evaluate(localVar.expression);
        if (val !== null) funcEnv.set(localVar.name, val);
      }
    }

    // Execute the function's algorithm sections
    for (const section of funcDae.algorithms) {
      try {
        executeStatements(section, funcEvaluator, parentLookup);
      } catch (e) {
        if (e === ReturnSignal) break; // return; terminates execution
        throw e;
      }
    }

    // Extract the first output variable's value
    if (outputVars.length > 0) {
      const firstOutput = outputVars[0];
      if (firstOutput) {
        return funcEnv.get(firstOutput.name) ?? null;
      }
    }

    return null;
  } finally {
    currentCallDepth--;
  }
}

/**
 * Build a `functionLookup` callback from an array of function DAEs.
 *
 * This is the main integration point: wire this into
 * `ExpressionEvaluator.functionLookup` so that expression evaluation
 * can transparently call user-defined functions.
 *
 * @param functions  The function DAEs (from `dae.functions[]`).
 * @returns A callback suitable for `ExpressionEvaluator.functionLookup`.
 *
 * @example
 * ```ts
 * const evaluator = new ExpressionEvaluator(env);
 * evaluator.functionLookup = buildFunctionLookup(dae.functions);
 * ```
 */
export function buildFunctionLookup(functions: ModelicaDAE[]): (name: string, args: number[]) => number | null {
  // Build a name → DAE index for O(1) lookup
  const funcMap = new Map<string, ModelicaDAE>();
  for (const fn of functions) {
    funcMap.set(fn.name, fn);
    // Also register by short name (last segment after the last dot)
    const dotIdx = fn.name.lastIndexOf(".");
    if (dotIdx >= 0) {
      const shortName = fn.name.substring(dotIdx + 1);
      // Only register short name if it doesn't conflict with an existing entry
      if (!funcMap.has(shortName)) {
        funcMap.set(shortName, fn);
      }
    }
  }

  const lookup = (name: string, args: number[]): number | null => {
    const funcDae = funcMap.get(name);
    if (!funcDae) return null;
    return executeFunction(funcDae, args, lookup);
  };
  (lookup as unknown as { __funcMap: Map<string, ModelicaDAE> }).__funcMap = funcMap;

  return lookup;
}

export async function executeFunctionAsync(
  funcDae: ModelicaDAE,
  argValues: number[],
  parentLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<number | null> {
  if (++currentCallDepth > MAX_CALL_DEPTH) {
    currentCallDepth--;
    throw new Error(`Maximum call depth (${MAX_CALL_DEPTH}) exceeded in function '${funcDae.name}'.`);
  }

  try {
    const inputVars = funcDae.variables.filter((v) => v.causality === "input");
    const outputVars = funcDae.variables.filter((v) => v.causality === "output");
    const otherVars = funcDae.variables.filter((v) => v.causality !== "input" && v.causality !== "output");

    const funcEnv = new Map<string, number>();
    const funcEvaluator = new ExpressionEvaluator(funcEnv);
    funcEvaluator.functionLookup = parentLookup ?? null;

    for (let i = 0; i < inputVars.length; i++) {
      const inputVar = inputVars[i];
      if (!inputVar) continue;

      if (i < argValues.length) {
        funcEnv.set(inputVar.name, argValues[i] ?? 0);
      } else if (inputVar.expression) {
        const defaultVal = funcEvaluator.evaluate(inputVar.expression);
        funcEnv.set(inputVar.name, defaultVal ?? 0);
      }
    }

    for (const outVar of outputVars) {
      if (outVar.expression) {
        const val = funcEvaluator.evaluate(outVar.expression);
        if (val !== null) funcEnv.set(outVar.name, val);
      }
    }

    for (const localVar of otherVars) {
      if (localVar.expression) {
        const val = funcEvaluator.evaluate(localVar.expression);
        if (val !== null) funcEnv.set(localVar.name, val);
      }
    }

    for (const section of funcDae.algorithms) {
      try {
        await executeStatementsAsync(section, funcEvaluator, parentLookup, debuggerHook);
      } catch (e) {
        if (e === ReturnSignal) break;
        throw e;
      }
    }

    if (outputVars.length > 0) {
      const firstOutput = outputVars[0];
      if (firstOutput) {
        return funcEnv.get(firstOutput.name) ?? null;
      }
    }

    return null;
  } finally {
    currentCallDepth--;
  }
}

// --- ASYNC DUALS FOR DEBUGGING ---

export async function executeStatementsAsync(
  statements: ModelicaStatement[],
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  for (const stmt of statements) {
    await executeStatementAsync(stmt, evaluator, functionLookup, debuggerHook);
  }
}

async function executeStatementAsync(
  stmt: ModelicaStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  if (debuggerHook?.onStatement) {
    await debuggerHook.onStatement(stmt, evaluator);
  }
  // ── Assignment: target := source ──
  if (stmt instanceof ModelicaAssignmentStatement) {
    const value = evaluator.evaluate(stmt.source);
    if (value !== null) {
      const targetName = extractTargetName(stmt.target);
      if (targetName) {
        evaluator.env.set(targetName, value);
      }
    }
    return;
  }

  // ── For-loop: for i in range loop ... end for ──
  if (stmt instanceof ModelicaForStatement) {
    await executeForStatementAsync(stmt, evaluator, functionLookup, debuggerHook);
    return;
  }

  // ── While-loop: while cond loop ... end while ──
  if (stmt instanceof ModelicaWhileStatement) {
    await executeWhileStatementAsync(stmt, evaluator, functionLookup, debuggerHook);
    return;
  }

  // ── If-statement: if cond then ... elseif ... else ... end if ──
  if (stmt instanceof ModelicaIfStatement) {
    await executeIfStatementAsync(stmt, evaluator, functionLookup, debuggerHook);
    return;
  }

  // ── Return: terminates function execution ──
  if (stmt instanceof ModelicaReturnStatement) {
    throw ReturnSignal;
  }

  // ── Break: terminates enclosing loop ──
  if (stmt instanceof ModelicaBreakStatement) {
    throw BreakSignal;
  }

  // ── Procedure call: functionName(args) ──
  if (stmt instanceof ModelicaProcedureCallStatement) {
    await executeProcedureCallAsync(stmt, evaluator, functionLookup, debuggerHook);
    return;
  }

  // ── Complex assignment: (x, y, _) := f(args) ──
  if (stmt instanceof ModelicaComplexAssignmentStatement) {
    await executeComplexAssignmentAsync(stmt, evaluator, functionLookup, debuggerHook);
    return;
  }

  // ── When-statement (in algorithm sections) ──
  if (stmt instanceof ModelicaWhenStatement) {
    await executeWhenStatementAsync(stmt, evaluator, functionLookup, debuggerHook);
    return;
  }

  // Unknown statement type — silently skip
}

async function executeForStatementAsync(
  stmt: ModelicaForStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  const rangeValues = evaluateRange(stmt.range, evaluator);
  if (!rangeValues) return;

  const previousValue = evaluator.env.get(stmt.indexName);
  let iterCount = 0;

  try {
    for (const indexVal of rangeValues) {
      if (++iterCount > MAX_FOR_ITERATIONS) {
        throw new Error(`For-loop exceeded ${MAX_FOR_ITERATIONS} iterations (index '${stmt.indexName}').`);
      }
      evaluator.env.set(stmt.indexName, indexVal);
      try {
        await executeStatementsAsync(stmt.statements, evaluator, functionLookup, debuggerHook);
      } catch (e) {
        if (e === BreakSignal) break;
        throw e; // ReturnSignal propagates up
      }
    }
  } finally {
    // Restore previous value of the loop variable (or delete if it didn't exist)
    if (previousValue !== undefined) {
      evaluator.env.set(stmt.indexName, previousValue);
    } else {
      evaluator.env.delete(stmt.indexName);
    }
  }
}

async function executeWhileStatementAsync(
  stmt: ModelicaWhileStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  let iterCount = 0;

  while (true) {
    if (++iterCount > MAX_WHILE_ITERATIONS) {
      throw new Error(`While-loop exceeded ${MAX_WHILE_ITERATIONS} iterations.`);
    }

    const condVal = evaluator.evaluate(stmt.condition);
    if (condVal === null || condVal === 0) break;

    try {
      await executeStatementsAsync(stmt.statements, evaluator, functionLookup, debuggerHook);
    } catch (e) {
      if (e === BreakSignal) break;
      throw e;
    }
  }
}

async function executeIfStatementAsync(
  stmt: ModelicaIfStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  const condVal = evaluator.evaluate(stmt.condition);
  if (condVal !== null && condVal !== 0) {
    await executeStatementsAsync(stmt.statements, evaluator, functionLookup, debuggerHook);
    return;
  }

  for (const clause of stmt.elseIfClauses) {
    const elseIfCond = evaluator.evaluate(clause.condition);
    if (elseIfCond !== null && elseIfCond !== 0) {
      await executeStatementsAsync(clause.statements, evaluator, functionLookup, debuggerHook);
      return;
    }
  }

  if (stmt.elseStatements.length > 0) {
    await executeStatementsAsync(stmt.elseStatements, evaluator, functionLookup, debuggerHook);
  }
}

async function executeProcedureCallAsync(
  stmt: ModelicaProcedureCallStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  const call = stmt.call;

  // Handle built-in procedure-like calls
  if (call.functionName === "assert") {
    // assert(condition, message) — evaluate condition; if false, throw
    const firstArg = call.args[0];
    if (firstArg) {
      const condVal = evaluator.evaluate(firstArg);
      if (condVal !== null && condVal === 0) {
        // TODO: extract message from args[1] when string support is added
        throw new Error("Modelica assertion failed");
      }
    }
    return;
  }

  if (call.functionName === "terminate") {
    throw new Error("Modelica terminate() called");
  }

  if (call.functionName === "print") {
    // Silently consume print() calls
    return;
  }

  // Delegate to the function lookup for user-defined procedures
  if (functionLookup) {
    const argValues: number[] = [];
    for (const arg of call.args) {
      const val = evaluator.evaluate(arg);
      if (val === null) return; // Can't evaluate args — skip
      argValues.push(val);
    }

    const fnMap = (functionLookup as { __funcMap?: Map<string, ModelicaDAE> }).__funcMap;
    if (fnMap) {
      const funcDae = fnMap.get(call.functionName);
      if (funcDae) {
        await executeFunctionAsync(funcDae, argValues, functionLookup, debuggerHook);
        return;
      }
    }

    functionLookup(call.functionName, argValues);
  }
}

async function executeComplexAssignmentAsync(
  stmt: ModelicaComplexAssignmentStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  // For now, only handle the case where the source is a single expression
  // that can be evaluated to a scalar.  Full multi-output function support
  // requires Step 1.2 (user-defined function calls).
  if (stmt.targets.length === 1) {
    const target = stmt.targets[0];
    if (target) {
      const value = evaluator.evaluate(stmt.source);
      if (value !== null) {
        const name = extractTargetName(target);
        if (name) evaluator.env.set(name, value);
      }
    }
    return;
  }

  // Multi-output: delegate to functionLookup if available
  if (functionLookup && stmt.source instanceof ModelicaFunctionCallExpression) {
    const argValues: number[] = [];
    for (const arg of stmt.source.args) {
      const val = evaluator.evaluate(arg);
      if (val === null) return;
      argValues.push(val);
    }

    let result: number | null;
    const fnMap = (functionLookup as { __funcMap?: Map<string, ModelicaDAE> }).__funcMap;
    if (fnMap) {
      const funcDae = fnMap.get(stmt.source.functionName);
      if (funcDae) {
        result = await executeFunctionAsync(funcDae, argValues, functionLookup, debuggerHook);
      } else {
        result = functionLookup(stmt.source.functionName, argValues);
      }
    } else {
      result = functionLookup(stmt.source.functionName, argValues);
    }

    if (result !== null && stmt.targets.length > 0) {
      const firstTarget = stmt.targets[0];
      if (firstTarget) {
        const name = extractTargetName(firstTarget);
        if (name) evaluator.env.set(name, result);
      }
    }
  }
}

async function executeWhenStatementAsync(
  stmt: ModelicaWhenStatement,
  evaluator: ExpressionEvaluator,
  functionLookup?: (name: string, args: number[]) => number | null,
  debuggerHook?: import("./simulator.js").SimulationDebugger,
): Promise<void> {
  // In algorithm sections, a when-statement fires on the rising edge
  // of its condition.  For steady-state / initialization contexts,
  // we evaluate the condition and execute the body if it's true.
  const condVal = evaluator.evaluate(stmt.condition);
  if (condVal !== null && condVal !== 0) {
    await executeStatementsAsync(stmt.statements, evaluator, functionLookup, debuggerHook);
    return;
  }

  // Check elseWhen clauses
  for (const clause of stmt.elseWhenClauses) {
    const elseCondVal = evaluator.evaluate(clause.condition);
    if (elseCondVal !== null && elseCondVal !== 0) {
      await executeStatementsAsync(clause.statements, evaluator, functionLookup, debuggerHook);
      return;
    }
  }
}
