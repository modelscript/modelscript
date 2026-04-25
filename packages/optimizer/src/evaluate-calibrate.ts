// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Evaluate the scripting-level `calibrate(ClassName, ...)` built-in function.
 *
 * Follows the same registration pattern as evaluate-simulate.ts and
 * evaluate-optimize.ts to avoid circular ESM dependencies.
 *
 * Usage from a Modelica script:
 *   result = calibrate(MyModel,
 *     csvData     = "time,x\n0,1.0\n1,0.37\n2,0.14",
 *     parameters  = "a,b",
 *     tolerance   = 1e-6,
 *     maxIterations = 100);
 */

import { ModelicaClassInstance, type Scope } from "@modelscript/core";
import {
  ModelicaComponentReferenceSyntaxNode,
  type ModelicaFunctionCallSyntaxNode,
  type ModelicaSyntaxNode,
} from "@modelscript/modelica/ast";
import {
  ModelicaArray,
  ModelicaBooleanLiteral,
  ModelicaDAE,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaObject,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
} from "@modelscript/symbolics";
import { parseCsvMeasurements } from "./csv-parser.js";

type ScriptExpressionEvaluator = (node: ModelicaSyntaxNode, scope: Scope) => ModelicaExpression | null;

/** Dependencies injected from outside to avoid circular imports. */
export interface CalibrateDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Flattener: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Simulator: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Calibrator: any;
}

let deps: CalibrateDeps | null = null;

/**
 * Register the Flattener, Simulator, and Calibrator constructors. Must be
 * called once before `evaluateCalibrate()` is used.
 */
export function registerCalibrateDeps(d: CalibrateDeps): void {
  deps = d;
}

/**
 * Evaluate `calibrate(ClassName, ...)`:
 * 1. Resolves the first positional argument as a class type reference.
 * 2. Flattens the class into a DAE.
 * 3. Parses CSV measurement data from the named argument.
 * 4. Extracts calibration parameters from named arguments.
 * 5. Runs ModelicaCalibrator.calibrate().
 * 6. Returns a ModelicaObject record with calibration results.
 */
export function evaluateCalibrate(
  node: ModelicaFunctionCallSyntaxNode,
  scope: Scope,
  evaluateExpression: ScriptExpressionEvaluator,
): ModelicaExpression | null {
  if (!deps) {
    throw new Error("calibrate() is not available: call registerCalibrateDeps() first.");
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

  // ── Step 3: Helpers ──
  const getNamedArgStr = (name: string): string | null => {
    for (const na of namedArgs) {
      if (na.identifier?.text === name && na.argument?.expression) {
        const val = evaluateExpression(na.argument.expression, scope);
        if (val instanceof ModelicaStringLiteral) return val.value;
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

  // ── Step 4: Parse CSV ──
  const csvData = getNamedArgStr("csvData");
  if (!csvData) {
    return buildErrorResult('No CSV data specified. Use csvData="time,x\\n0,1.0\\n1,0.37".');
  }

  const timeColumn = getNamedArgStr("timeColumn") ?? undefined;

  // Parse column mapping: "csvCol1:moVar1,csvCol2:moVar2"
  const mappingStr = getNamedArgStr("columnMapping");
  let columnMapping: Map<string, string> | undefined;
  if (mappingStr) {
    columnMapping = new Map();
    for (const part of mappingStr.split(",")) {
      const pieces = part.trim().split(":");
      if (pieces.length === 2 && pieces[0] && pieces[1]) {
        columnMapping.set(pieces[0].trim(), pieces[1].trim());
      }
    }
  }

  let csv;
  try {
    const csvOptions: Parameters<typeof parseCsvMeasurements>[1] = { skipNaN: true };
    if (timeColumn) csvOptions.timeColumn = timeColumn;
    if (columnMapping) csvOptions.columnMapping = columnMapping;
    csv = parseCsvMeasurements(csvData, csvOptions);
  } catch (e) {
    return buildErrorResult(`CSV parse error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Step 5: Extract calibration parameters ──
  const paramsStr = getNamedArgStr("parameters") ?? "";
  const paramNames = paramsStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (paramNames.length === 0) {
    return buildErrorResult('No calibration parameters specified. Use parameters="a,b".');
  }

  // Parse parameter bounds: "a:0:10,b:-1:1"
  const boundsStr = getNamedArgStr("parameterBounds") ?? "";
  const parameterBounds = new Map<string, { min: number; max: number }>();
  if (boundsStr) {
    for (const part of boundsStr.split(",")) {
      const pieces = part.trim().split(":");
      if (pieces.length === 3 && pieces[0] && pieces[1] && pieces[2]) {
        parameterBounds.set(pieces[0].trim(), {
          min: parseFloat(pieces[1]),
          max: parseFloat(pieces[2]),
        });
      }
    }
  }
  for (const name of paramNames) {
    if (!parameterBounds.has(name)) {
      parameterBounds.set(name, { min: -1e6, max: 1e6 });
    }
  }

  // Build measurements map from CSV
  const measurements = new Map<string, { t: number[]; y: number[] }>();
  for (const col of csv.columns) {
    const values = csv.data.get(col);
    if (values) {
      measurements.set(col, { t: csv.time, y: values });
    }
  }

  const tolerance = getNamedArgNum("tolerance") ?? 1e-8;
  const maxIterations = getNamedArgNum("maxIterations") ?? 100;
  const method = (getNamedArgStr("method") as "lm" | "sqp") ?? "lm";

  // ── Step 6: Run calibration ──
  let result: {
    success: boolean;
    parameters: Map<string, number>;
    residual: number;
    variableResiduals: Map<string, number>;
    iterations: number;
    simulated: { t: number[]; y: Map<string, number[]> };
    costHistory: number[];
    message: string;
  };

  try {
    const simulator = new deps.Simulator(dae);
    simulator.prepare();

    const calibrator = new deps.Calibrator(dae, simulator, {
      parameters: paramNames,
      parameterBounds,
      measurements,
      tolerance,
      maxIterations,
      method,
    });
    result = calibrator.calibrate();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return buildErrorResult(msg);
  }

  // ── Step 7: Build result record ──
  const elements = new Map<string, ModelicaExpression>();
  elements.set("success", new ModelicaBooleanLiteral(result.success));
  elements.set("residual", new ModelicaRealLiteral(result.residual));
  elements.set("iterations", new ModelicaIntegerLiteral(result.iterations));
  elements.set("message", new ModelicaStringLiteral(result.message));

  // Parameter values
  const paramElements = new Map<string, ModelicaExpression>();
  for (const [name, value] of result.parameters) {
    paramElements.set(name, new ModelicaRealLiteral(value));
  }
  elements.set("parameters", new ModelicaObject(paramElements));

  // Cost history
  elements.set(
    "costHistory",
    new ModelicaArray(
      [result.costHistory.length],
      result.costHistory.map((c) => new ModelicaRealLiteral(c)),
    ),
  );

  // Simulated trajectories
  const simElements = new Map<string, ModelicaExpression>();
  simElements.set(
    "time",
    new ModelicaArray(
      [result.simulated.t.length],
      result.simulated.t.map((t) => new ModelicaRealLiteral(t)),
    ),
  );
  for (const [name, vals] of result.simulated.y) {
    simElements.set(
      name,
      new ModelicaArray(
        [vals.length],
        vals.map((v) => new ModelicaRealLiteral(v)),
      ),
    );
  }
  elements.set("simulated", new ModelicaObject(simElements));

  // Variable residuals
  const varResElements = new Map<string, ModelicaExpression>();
  for (const [name, value] of result.variableResiduals) {
    varResElements.set(name, new ModelicaRealLiteral(value));
  }
  elements.set("variableResiduals", new ModelicaObject(varResElements));

  return new ModelicaObject(elements);
}

function buildErrorResult(messages: string): ModelicaObject {
  const elements = new Map<string, ModelicaExpression>();
  elements.set("success", new ModelicaBooleanLiteral(false));
  elements.set("residual", new ModelicaRealLiteral(0));
  elements.set("iterations", new ModelicaIntegerLiteral(0));
  elements.set("parameters", new ModelicaObject(new Map()));
  elements.set("costHistory", new ModelicaArray([0], []));
  elements.set("simulated", new ModelicaObject(new Map()));
  elements.set("variableResiduals", new ModelicaObject(new Map()));
  elements.set("message", new ModelicaStringLiteral(messages));
  return new ModelicaObject(elements);
}
