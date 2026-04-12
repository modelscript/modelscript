// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Evaluate the scripting-level `simulate(ClassName, ...)` built-in function.
 *
 * Extracted from interpreter.ts to avoid circular ESM dependency:
 *   interpreter → flattener → model → interpreter
 *
 * Uses a registration pattern: the host (e.g. browserServerMain.ts) calls
 * `registerSimulateDeps()` with the actual Flattener/Simulator constructors
 * after importing them.  This completely avoids any import (static or dynamic)
 * of flattener.ts / simulator.ts from this module.
 */

import {
  ModelicaComponentReferenceSyntaxNode,
  type ModelicaFunctionCallSyntaxNode,
  type ModelicaSyntaxNode,
} from "@modelscript/modelica-ast";
import type { SolverOptions } from "@modelscript/simulator";
import {
  ModelicaArray,
  ModelicaDAE,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaObject,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
} from "@modelscript/symbolics";
import type { Scope } from "../scope.js";
import { ModelicaClassInstance } from "./model.js";

/**
 * Callback type for evaluating an expression node within a scope.
 * Used to decouple from ModelicaInterpreter (avoids circular import).
 */
export type ScriptExpressionEvaluator = (node: ModelicaSyntaxNode, scope: Scope) => ModelicaExpression | null;

/** Dependencies injected from outside to avoid circular imports. */
export interface SimulateDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Flattener: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Simulator: any;
}

let deps: SimulateDeps | null = null;

/**
 * Register the Flattener and Simulator constructors. Must be called once
 * before `evaluateSimulate()` is used (typically at application startup).
 */
export function registerSimulateDeps(d: SimulateDeps): void {
  deps = d;
}

/**
 * Evaluate `simulate(ClassName, ...)`:
 * 1. Resolves the first positional argument as a class type reference.
 * 2. Flattens the class into a DAE.
 * 3. Extracts experiment parameters with function-argument overrides.
 * 4. Runs ModelicaSimulator.simulate().
 * 5. Returns a ModelicaObject record with time-series results.
 */
export function evaluateSimulate(
  node: ModelicaFunctionCallSyntaxNode,
  scope: Scope,
  evaluateExpression: ScriptExpressionEvaluator,
): ModelicaExpression | null {
  if (!deps) {
    throw new Error("simulate() is not available: call registerSimulateDeps() first.");
  }

  // ── Step 1: Resolve the class type from the first positional argument ──
  const args = node.functionCallArguments?.arguments ?? [];
  const namedArgs = node.functionCallArguments?.namedArguments ?? [];
  const firstArg = args[0];
  if (!firstArg?.expression) return null;

  // The first argument is a class reference — resolve it in scope
  let classInstance: ModelicaClassInstance | null = null;
  const firstExpr = firstArg.expression;
  if (firstExpr instanceof ModelicaComponentReferenceSyntaxNode) {
    const resolved = scope.resolveComponentReference(firstExpr);
    if (resolved instanceof ModelicaClassInstance) classInstance = resolved;
  }
  if (!classInstance) return null;

  // ── Step 2: Flatten the class into a DAE ──
  const dae = new ModelicaDAE(classInstance.name ?? "DAE", classInstance.description);
  classInstance.accept(new deps.Flattener(), ["", dae]);

  // ── Step 3: Resolve simulation parameters ──
  const getNamedArg = (name: string): number | null => {
    for (const na of namedArgs) {
      if (na.identifier?.text === name && na.argument?.expression) {
        const val = evaluateExpression(na.argument.expression, scope);
        if (val instanceof ModelicaRealLiteral) return val.value;
        if (val instanceof ModelicaIntegerLiteral) return val.value;
      }
    }
    return null;
  };

  const getPositionalArg = (index: number): number | null => {
    const arg = args[index];
    if (!arg?.expression) return null;
    const val = evaluateExpression(arg.expression, scope);
    if (val instanceof ModelicaRealLiteral) return val.value;
    if (val instanceof ModelicaIntegerLiteral) return val.value;
    return null;
  };

  const getNamedArgStr = (name: string): string | null => {
    for (const na of namedArgs) {
      if (na.identifier?.text === name && na.argument?.expression) {
        const val = evaluateExpression(na.argument.expression, scope);
        if (val instanceof ModelicaStringLiteral) return val.value;
      }
    }
    return null;
  };

  const exp = dae.experiment;
  const startTime = getNamedArg("startTime") ?? getPositionalArg(1) ?? exp.startTime ?? 0;
  const stopTime = getNamedArg("stopTime") ?? getPositionalArg(2) ?? exp.stopTime ?? 10;
  const numberOfIntervals = getNamedArg("numberOfIntervals") ?? getPositionalArg(3) ?? 500;
  const tolerance = getNamedArg("tolerance") ?? getPositionalArg(4) ?? exp.tolerance ?? 1e-6;
  const outputIntervalArg = getNamedArg("outputInterval") ?? getPositionalArg(5);
  const step =
    outputIntervalArg != null && outputIntervalArg > 0
      ? outputIntervalArg
      : (exp.interval ?? (stopTime - startTime) / numberOfIntervals);

  // Parse solver options
  const solverOptions: SolverOptions = {};
  const _int = getNamedArgStr("integrator") as SolverOptions["integrator"];
  if (_int !== undefined) solverOptions.integrator = _int;
  const _nonlin = getNamedArgStr("nonlinear") as SolverOptions["nonlinear"];
  if (_nonlin !== undefined) solverOptions.nonlinear = _nonlin;
  const _lin = getNamedArgStr("linear") as SolverOptions["linear"];
  if (_lin !== undefined) solverOptions.linear = _lin;
  const _jac = getNamedArgStr("jacobian") as SolverOptions["jacobian"];
  if (_jac !== undefined) solverOptions.jacobian = _jac;
  const _opt = getNamedArgStr("optimizer") as SolverOptions["optimizer"];
  if (_opt !== undefined) solverOptions.optimizer = _opt;
  const _lp = getNamedArgStr("lpSolver") as SolverOptions["lpSolver"];
  if (_lp !== undefined) solverOptions.lpSolver = _lp;

  // ── Step 4: Run the simulation ──
  let result: { t: number[]; y: number[][]; states: string[] };
  let messages = "";
  try {
    const simulator = new deps.Simulator(dae);
    simulator.prepare();
    result = simulator.simulate(startTime, stopTime, step, {
      atol: tolerance,
      rtol: tolerance,
      solverOptions,
    });
  } catch (e) {
    messages = e instanceof Error ? e.message : String(e);
    return buildResultRecord(startTime, stopTime, numberOfIntervals, tolerance, messages);
  }

  // ── Step 5: Build the result record ──
  const timeValues = new ModelicaArray(
    [result.t.length],
    result.t.map((t) => new ModelicaRealLiteral(t)),
  );

  const timeSeriesElements = new Map<string, ModelicaExpression>();
  for (let vi = 0; vi < result.states.length; vi++) {
    const varName = result.states[vi];
    if (!varName) continue;
    const values = new ModelicaArray(
      [result.t.length],
      result.t.map((_, ti) => new ModelicaRealLiteral(result.y[ti]?.[vi] ?? 0)),
    );
    timeSeriesElements.set(varName, values);
  }

  const optElements = new Map<string, ModelicaExpression>();
  optElements.set("startTime", new ModelicaRealLiteral(startTime));
  optElements.set("stopTime", new ModelicaRealLiteral(stopTime));
  optElements.set("numberOfIntervals", new ModelicaIntegerLiteral(numberOfIntervals));
  optElements.set("tolerance", new ModelicaRealLiteral(tolerance));

  const elements = new Map<string, ModelicaExpression>();
  elements.set("resultFile", new ModelicaStringLiteral(""));
  elements.set("messages", new ModelicaStringLiteral(messages));
  elements.set("timeValues", timeValues);
  elements.set("timeSeries", new ModelicaObject(timeSeriesElements));
  elements.set("simulationOptions", new ModelicaObject(optElements));

  return new ModelicaObject(elements);
}

/** Build a result record for error cases. */
function buildResultRecord(
  startTime: number,
  stopTime: number,
  numberOfIntervals: number,
  tolerance: number,
  messages: string,
): ModelicaObject {
  const elements = new Map<string, ModelicaExpression>();
  elements.set("resultFile", new ModelicaStringLiteral(""));
  elements.set("messages", new ModelicaStringLiteral(messages));
  elements.set("timeValues", new ModelicaArray([0], []));
  elements.set("timeSeries", new ModelicaObject(new Map()));
  const optElements = new Map<string, ModelicaExpression>();
  optElements.set("startTime", new ModelicaRealLiteral(startTime));
  optElements.set("stopTime", new ModelicaRealLiteral(stopTime));
  optElements.set("numberOfIntervals", new ModelicaIntegerLiteral(numberOfIntervals));
  optElements.set("tolerance", new ModelicaRealLiteral(tolerance));
  elements.set("simulationOptions", new ModelicaObject(optElements));
  return new ModelicaObject(elements);
}
