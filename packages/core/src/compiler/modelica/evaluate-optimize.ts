// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Evaluate the scripting-level `optimize(ClassName, ...)` built-in function.
 *
 * Follows the same registration pattern as evaluate-simulate.ts to avoid
 * circular ESM dependencies.
 */

import type { Scope } from "../scope.js";
import {
  ModelicaArray,
  ModelicaBooleanLiteral,
  ModelicaDAE,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaObject,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
} from "./dae.js";
import { ModelicaClassInstance } from "./model.js";
import type { SolverOptions } from "./solver-options.js";
import {
  ModelicaComponentReferenceSyntaxNode,
  type ModelicaFunctionCallSyntaxNode,
  type ModelicaSyntaxNode,
} from "./syntax.js";

type ScriptExpressionEvaluator = (node: ModelicaSyntaxNode, scope: Scope) => ModelicaExpression | null;

/** Dependencies injected from outside to avoid circular imports. */
export interface OptimizeDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Flattener: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Optimizer: any;
}

let deps: OptimizeDeps | null = null;

/**
 * Register the Flattener and Optimizer constructors. Must be called once
 * before `evaluateOptimize()` is used (typically at application startup).
 */
export function registerOptimizeDeps(d: OptimizeDeps): void {
  deps = d;
}

/**
 * Evaluate `optimize(ClassName, ...)`:
 * 1. Resolves the first positional argument as a class type reference.
 * 2. Flattens the class into a DAE.
 * 3. Extracts optimization parameters from named arguments.
 * 4. Runs ModelicaOptimizer.solve().
 * 5. Returns a ModelicaObject record with optimization results.
 */
export function evaluateOptimize(
  node: ModelicaFunctionCallSyntaxNode,
  scope: Scope,
  evaluateExpression: ScriptExpressionEvaluator,
): ModelicaExpression | null {
  if (!deps) {
    throw new Error("optimize() is not available: call registerOptimizeDeps() first.");
  }

  // ── Step 1: Resolve class type ──
  const args = node.functionCallArguments?.arguments ?? [];
  const namedArgs = node.functionCallArguments?.namedArguments ?? [];
  const firstArg = args[0];
  if (!firstArg?.expression) return null;

  let classInstance: ModelicaClassInstance | null = null;
  const firstExpr = firstArg.expression;
  if (firstExpr instanceof ModelicaComponentReferenceSyntaxNode) {
    const resolved = scope.resolveComponentReference(firstExpr);
    if (resolved instanceof ModelicaClassInstance) classInstance = resolved;
  }
  if (!classInstance) return null;

  // ── Step 2: Flatten ──
  const dae = new ModelicaDAE(classInstance.name ?? "DAE", classInstance.description);
  classInstance.accept(new deps.Flattener(), ["", dae]);

  // ── Step 3: Extract optimization parameters ──
  const getNamedArgStr = (name: string): string | null => {
    for (const na of namedArgs) {
      if (na.identifier?.text === name && na.argument?.expression) {
        const val = evaluateExpression(na.argument.expression, scope);
        if (val instanceof ModelicaStringLiteral) return val.value;
        // Also accept bare identifiers as string values
        if (val instanceof ModelicaRealLiteral) return String(val.value);
        if (val instanceof ModelicaIntegerLiteral) return String(val.value);
      }
    }
    return null;
  };

  const getNamedArgNum = (name: string): number | null => {
    for (const na of namedArgs) {
      if (na.identifier?.text === name && na.argument?.expression) {
        const val = evaluateExpression(na.argument.expression, scope);
        if (val instanceof ModelicaRealLiteral) return val.value;
        if (val instanceof ModelicaIntegerLiteral) return val.value;
      }
    }
    return null;
  };

  // Parse controls list: "u" or "u,v"
  const controlsStr = getNamedArgStr("controls") ?? "";
  const controlNames = controlsStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (controlNames.length === 0) {
    return buildErrorResult('No control variables specified. Use controls="u" or controls="u,v".');
  }

  // Parse control bounds: "u:-1:1" or "u:-1:1,v:0:5"
  const boundsStr = getNamedArgStr("controlBounds") ?? "";
  const controlBounds = new Map<string, { min: number; max: number }>();
  if (boundsStr) {
    for (const part of boundsStr.split(",")) {
      const pieces = part.trim().split(":");
      if (pieces.length === 3 && pieces[0] && pieces[1] && pieces[2]) {
        controlBounds.set(pieces[0].trim(), {
          min: parseFloat(pieces[1]),
          max: parseFloat(pieces[2]),
        });
      }
    }
  }
  // Default bounds for controls without explicit bounds
  for (const name of controlNames) {
    if (!controlBounds.has(name)) {
      controlBounds.set(name, { min: -1e6, max: 1e6 });
    }
  }

  const objective = getNamedArgStr("objective") ?? "u^2";
  const exp = dae.experiment;
  const startTime = getNamedArgNum("startTime") ?? exp.startTime ?? 0;
  const stopTime = getNamedArgNum("stopTime") ?? exp.stopTime ?? 10;
  const numIntervals = getNamedArgNum("numIntervals") ?? 50;
  const tolerance = getNamedArgNum("tolerance") ?? 1e-6;
  const maxIterations = getNamedArgNum("maxIterations") ?? 200;

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

  // ── Step 4: Run optimization ──
  let result: {
    success: boolean;
    cost: number;
    iterations: number;
    t: number[];
    states: Map<string, number[]>;
    controls: Map<string, number[]>;
    costHistory: number[];
    messages: string;
  };
  try {
    const optimizer = new deps.Optimizer(dae, {
      objective,
      controls: controlNames,
      controlBounds,
      startTime,
      stopTime,
      numIntervals,
      tolerance,
      maxIterations,
      solverOptions,
    });
    result = optimizer.solve();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return buildErrorResult(msg);
  }

  // ── Step 5: Build result record ──
  const timeValues = new ModelicaArray(
    [result.t.length],
    result.t.map((t) => new ModelicaRealLiteral(t)),
  );

  const stateElements = new Map<string, ModelicaExpression>();
  for (const [name, vals] of result.states) {
    stateElements.set(
      name,
      new ModelicaArray(
        [vals.length],
        vals.map((v) => new ModelicaRealLiteral(v)),
      ),
    );
  }

  const controlElements = new Map<string, ModelicaExpression>();
  for (const [name, vals] of result.controls) {
    controlElements.set(
      name,
      new ModelicaArray(
        [vals.length],
        vals.map((v) => new ModelicaRealLiteral(v)),
      ),
    );
  }

  const costHistoryArr = new ModelicaArray(
    [result.costHistory.length],
    result.costHistory.map((c) => new ModelicaRealLiteral(c)),
  );

  const elements = new Map<string, ModelicaExpression>();
  elements.set("success", new ModelicaBooleanLiteral(result.success));
  elements.set("cost", new ModelicaRealLiteral(result.cost));
  elements.set("iterations", new ModelicaIntegerLiteral(result.iterations));
  elements.set("timeValues", timeValues);
  elements.set("states", new ModelicaObject(stateElements));
  elements.set("controls", new ModelicaObject(controlElements));
  elements.set("costHistory", costHistoryArr);
  elements.set("messages", new ModelicaStringLiteral(result.messages));

  return new ModelicaObject(elements);
}

function buildErrorResult(messages: string): ModelicaObject {
  const elements = new Map<string, ModelicaExpression>();
  elements.set("success", new ModelicaBooleanLiteral(false));
  elements.set("cost", new ModelicaRealLiteral(0));
  elements.set("iterations", new ModelicaIntegerLiteral(0));
  elements.set("timeValues", new ModelicaArray([0], []));
  elements.set("states", new ModelicaObject(new Map()));
  elements.set("controls", new ModelicaObject(new Map()));
  elements.set("costHistory", new ModelicaArray([0], []));
  elements.set("messages", new ModelicaStringLiteral(messages));
  return new ModelicaObject(elements);
}
