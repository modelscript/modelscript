/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Evaluate the scripting-level `montecarlo(ClassName, ...)` built-in function.
 *
 * Runs a Monte Carlo uncertainty analysis on a Modelica model:
 * 1. Resolves the class type from the first positional argument.
 * 2. Flattens the class into a DAE.
 * 3. Parses random variable distributions from the `parameters` argument.
 * 4. Runs `runMonteCarloSimulation()` with parameter overrides.
 * 5. Returns a ModelicaObject record with per-variable statistics (mean,
 *    stddev, confidence intervals, percentiles) for fan-chart visualization.
 *
 * Uses the same registration pattern as evaluate-simulate.ts.
 */

import { ModelicaClassInstance, type Scope } from "@modelscript/core";
import { ModelicaComponentReferenceSyntaxNode, type ModelicaFunctionCallSyntaxNode } from "@modelscript/modelica/ast";
import {
  ModelicaArray,
  ModelicaDAE,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaObject,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
} from "@modelscript/symbolics";
import type { ScriptExpressionEvaluator } from "./evaluate-simulate.js";
import type { Distribution, MonteCarloOptions, RandomVariable } from "./monte-carlo-arena.js";
import { runMonteCarloArena } from "./monte-carlo-arena.js";
import type { SolverOptions } from "./solver-options.js";

/** Dependencies injected from outside to avoid circular imports. */
export interface MonteCarloDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Flattener: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Simulator: any;
}

let deps: MonteCarloDeps | null = null;

/**
 * Register the Flattener and Simulator constructors. Must be called once
 * before `evaluateMonteCarlo()` is used (typically at application startup).
 */
export function registerMonteCarloDeps(d: MonteCarloDeps): void {
  deps = d;
}

/**
 * Evaluate `montecarlo(ClassName, ...)`:
 * 1. Resolves the first positional argument as a class type reference.
 * 2. Flattens the class into a DAE.
 * 3. Parses `parameters` argument into RandomVariable[] definitions.
 * 4. Runs Monte Carlo simulation with the specified options.
 * 5. Returns a ModelicaObject record with statistics and percentiles.
 */
export function evaluateMonteCarlo(
  node: ModelicaFunctionCallSyntaxNode,
  scope: Scope,
  evaluateExpression: ScriptExpressionEvaluator,
): ModelicaExpression | null {
  if (!deps) {
    throw new Error("montecarlo() is not available: call registerMonteCarloDeps() first.");
  }

  // ── Step 1: Resolve the class type ──
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

  // ── Step 3: Parse simulation and MC parameters ──
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

  const getNamedArgStr = (name: string): string | null => {
    for (const na of namedArgs) {
      if (na.identifier?.text === name && na.argument?.expression) {
        const val = evaluateExpression(na.argument.expression, scope);
        if (val instanceof ModelicaStringLiteral) return val.value;
      }
    }
    return null;
  };

  // Parse random variable definitions from the `parameters` named argument.
  // Expected format: parameters = {
  //   {name = "Cd", distribution = "gaussian", mean = 0.47, stddev = 0.05},
  //   {name = "m", distribution = "uniform", lo = 0.9, hi = 1.1}
  // }
  const randomVars: RandomVariable[] = [];
  for (const na of namedArgs) {
    if (na.identifier?.text === "parameters" && na.argument?.expression) {
      const paramExpr = evaluateExpression(na.argument.expression, scope);
      if (paramExpr instanceof ModelicaArray) {
        for (const elem of paramExpr.elements) {
          if (elem instanceof ModelicaObject) {
            const rv = parseRandomVariable(elem);
            if (rv) randomVars.push(rv);
          }
        }
      }
    }
  }

  const exp = dae.experiment;
  const startTime = getNamedArg("startTime") ?? exp.startTime ?? 0;
  const stopTime = getNamedArg("stopTime") ?? exp.stopTime ?? 10;
  const numberOfIntervals = getNamedArg("numberOfIntervals") ?? 500;
  const step = exp.interval ?? (stopTime - startTime) / numberOfIntervals;

  const numSamples = getNamedArg("numSamples") ?? 200;
  const seed = getNamedArg("seed") ?? undefined;
  const methodStr = getNamedArgStr("method");

  // Parse solver options
  const solverOptions: SolverOptions = {};

  // Build MC options
  const mcOptions: MonteCarloOptions = {
    numSamples,
    ...(seed != null ? { seed } : {}),
    confidenceLevel: getNamedArg("confidenceLevel") ?? 0.95,
    latinHypercube: methodStr === "lhs",
    sobol: methodStr === "sobol",
    antithetic: methodStr === "antithetic",
    storeTrajectories: false, // Raw trajectories are too large for the scripting layer
  };

  // ── Step 4: Run Monte Carlo ──
  let messages = "";
  try {
    const mcResult = runMonteCarloArena(dae.arena, randomVars, {
      ...mcOptions,
      simulateOptions: {
        startTime,
        stopTime,
        step,
      },
    });

    // ── Step 5: Build result record ──
    return buildMonteCarloResultRecord(mcResult, startTime, stopTime, numSamples, messages);
  } catch (e) {
    messages = e instanceof Error ? e.message : String(e);
    return buildErrorRecord(startTime, stopTime, numSamples, messages);
  }
}

/** Parse a ModelicaObject (record literal) into a RandomVariable. */
function parseRandomVariable(obj: ModelicaObject): RandomVariable | null {
  const name = getObjStr(obj, "name");
  const dist = getObjStr(obj, "distribution");
  if (!name || !dist) return null;

  let distribution: Distribution;
  switch (dist) {
    case "gaussian":
    case "normal":
      distribution = {
        type: "gaussian",
        mean: getObjNum(obj, "mean") ?? 0,
        stddev: getObjNum(obj, "stddev") ?? 1,
      };
      break;
    case "uniform":
      distribution = {
        type: "uniform",
        lo: getObjNum(obj, "lo") ?? 0,
        hi: getObjNum(obj, "hi") ?? 1,
      };
      break;
    case "lognormal":
      distribution = {
        type: "lognormal",
        mu: getObjNum(obj, "mu") ?? 0,
        sigma: getObjNum(obj, "sigma") ?? 1,
      };
      break;
    case "beta":
      distribution = {
        type: "beta",
        alpha: getObjNum(obj, "alpha") ?? 2,
        beta: getObjNum(obj, "beta") ?? 5,
      };
      break;
    case "triangular":
      distribution = {
        type: "triangular",
        lo: getObjNum(obj, "lo") ?? 0,
        mode: getObjNum(obj, "mode") ?? 0.5,
        hi: getObjNum(obj, "hi") ?? 1,
      };
      break;
    default:
      return null;
  }

  return { name, distribution };
}

function getObjStr(obj: ModelicaObject, key: string): string | null {
  const val = obj.elements.get(key);
  if (val instanceof ModelicaStringLiteral) return val.value;
  return null;
}

function getObjNum(obj: ModelicaObject, key: string): number | null {
  const val = obj.elements.get(key);
  if (val instanceof ModelicaRealLiteral) return val.value;
  if (val instanceof ModelicaIntegerLiteral) return val.value;
  return null;
}

/** Build a ModelicaObject result record from MonteCarloResult. */
function buildMonteCarloResultRecord(
  mcResult: import("./monte-carlo.js").MonteCarloResult,
  startTime: number,
  stopTime: number,
  numSamples: number,
  messages: string,
): ModelicaObject {
  const elements = new Map<string, ModelicaExpression>();
  elements.set("messages", new ModelicaStringLiteral(messages));
  elements.set("numSamples", new ModelicaIntegerLiteral(numSamples));
  elements.set("startTime", new ModelicaRealLiteral(startTime));
  elements.set("stopTime", new ModelicaRealLiteral(stopTime));

  // Convergence diagnostics
  const convElements = new Map<string, ModelicaExpression>();
  convElements.set("coeffOfVariation", new ModelicaRealLiteral(mcResult.convergence.coeffOfVariation));
  convElements.set("effectiveSampleSize", new ModelicaIntegerLiteral(mcResult.convergence.effectiveSampleSize));
  elements.set("convergence", new ModelicaObject(convElements));

  // Per-variable statistics
  const statsElements = new Map<string, ModelicaExpression>();
  for (const [varName, stats] of mcResult.statistics) {
    const varElements = new Map<string, ModelicaExpression>();
    const nT = stats.mean.length;

    varElements.set(
      "mean",
      new ModelicaArray(
        [nT],
        stats.mean.map((v) => new ModelicaRealLiteral(v)),
      ),
    );
    varElements.set(
      "stddev",
      new ModelicaArray(
        [nT],
        stats.stddev.map((v) => new ModelicaRealLiteral(v)),
      ),
    );
    varElements.set(
      "ciLo",
      new ModelicaArray(
        [nT],
        stats.ciLo.map((v) => new ModelicaRealLiteral(v)),
      ),
    );
    varElements.set(
      "ciHi",
      new ModelicaArray(
        [nT],
        stats.ciHi.map((v) => new ModelicaRealLiteral(v)),
      ),
    );

    // Percentiles
    const pctElements = new Map<string, ModelicaExpression>();
    for (const [pKey, pVals] of stats.percentiles) {
      pctElements.set(
        `p${Math.round(pKey * 100)}`,
        new ModelicaArray(
          [nT],
          pVals.map((v) => new ModelicaRealLiteral(v)),
        ),
      );
    }
    varElements.set("percentiles", new ModelicaObject(pctElements));

    statsElements.set(varName, new ModelicaObject(varElements));
  }
  elements.set("statistics", new ModelicaObject(statsElements));

  return new ModelicaObject(elements);
}

/** Build a result record for error cases. */
function buildErrorRecord(startTime: number, stopTime: number, numSamples: number, messages: string): ModelicaObject {
  const elements = new Map<string, ModelicaExpression>();
  elements.set("messages", new ModelicaStringLiteral(messages));
  elements.set("numSamples", new ModelicaIntegerLiteral(numSamples));
  elements.set("startTime", new ModelicaRealLiteral(startTime));
  elements.set("stopTime", new ModelicaRealLiteral(stopTime));
  elements.set("statistics", new ModelicaObject(new Map()));
  const convElements = new Map<string, ModelicaExpression>();
  convElements.set("coeffOfVariation", new ModelicaRealLiteral(Infinity));
  convElements.set("effectiveSampleSize", new ModelicaIntegerLiteral(0));
  elements.set("convergence", new ModelicaObject(convElements));
  return new ModelicaObject(elements);
}
