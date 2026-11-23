// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projections from MIT DYNAMO System Dynamics models to Modelica.
 */

import { extractLevelRateExpr } from "../dae/index.js";
import type { DynamoExpr, DynamoModel } from "../types.js";

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return `${n}.0`;
  return String(n);
}

function exprToModelica(expr: DynamoExpr | undefined): string {
  if (!expr) return "0.0";
  switch (expr.kind) {
    case "number":
      return formatNumber(expr.value);
    case "var":
      if (expr.name === "TIME") return "time";
      return expr.name;
    case "unary":
      return `${expr.op}(${exprToModelica(expr.operand)})`;
    case "binary":
      return `(${exprToModelica(expr.left)} ${expr.op} ${exprToModelica(expr.right)})`;
    case "call": {
      const fn = expr.name.toUpperCase();
      const args = expr.args.map((a) => exprToModelica(a));
      if ((fn === "CLIP" || fn === "FIFGE") && args.length >= 4) {
        return `(if ${args[2]} >= ${args[3]} then ${args[0]} else ${args[1]})`;
      }
      if ((fn === "SWITCH" || fn === "FIFZE") && args.length >= 3) {
        return `(if ${args[2]} == 0.0 then ${args[0]} else ${args[1]})`;
      }
      if (fn === "STEP" && args.length >= 2) {
        return `(if time >= ${args[1]} then ${args[0]} else 0.0)`;
      }
      if (fn === "RAMP" && args.length >= 2) {
        return `(if time >= ${args[1]} then (${args[0]}) * (time - ${args[1]}) else 0.0)`;
      }
      if (fn === "EXP") return `exp(${args[0] ?? "0.0"})`;
      if (fn === "LOGN" || fn === "LN" || fn === "LOG") return `log(${args[0] ?? "1.0"})`;
      if (fn === "SQRT") return `sqrt(${args[0] ?? "0.0"})`;
      if (fn === "ABS") return `abs(${args[0] ?? "0.0"})`;
      if (fn === "SIN") return `sin(${args[0] ?? "0.0"})`;
      if (fn === "COS") return `cos(${args[0] ?? "0.0"})`;
      if (fn === "MAX") return `max(${args.join(", ")})`;
      if (fn === "MIN") return `min(${args.join(", ")})`;
      return `${fn}(${args.join(", ")})`;
    }
  }
}

/**
 * Projects a parsed `DynamoModel` into a continuous-time Modelica model.
 */
export function dynamoToModelica(model: DynamoModel, overrideName?: string): string {
  const modelName = (overrideName || model.name || "DynamoModel").replace(/[^A-Za-z0-9_]/g, "_");
  const dt = model.spec.dt ?? 1.0;
  const length = model.spec.length ?? 100.0;

  const lines: string[] = [];
  lines.push(`model ${modelName}`);
  lines.push(`  // Generated from MIT DYNAMO System Dynamics model`);
  lines.push(`  parameter Real DT = ${formatNumber(dt)};`);

  // Constants (C)
  for (const eq of model.equations) {
    if (eq.kind === "C") {
      lines.push(`  parameter Real ${eq.name} = ${exprToModelica(eq.expr)};`);
    }
  }

  // Tables (T)
  for (const eq of model.equations) {
    if (eq.kind === "T" && eq.tableValues) {
      const vals = eq.tableValues.map((v) => formatNumber(v)).join(", ");
      lines.push(`  parameter Real ${eq.name}[${eq.tableValues.length}] = {${vals}};`);
    }
  }

  // Levels (L), Rates (R), Auxiliaries (A), Supplementaries (S)
  for (const eq of model.equations) {
    if (eq.kind === "L") {
      lines.push(`  Real ${eq.name}; // Level (stock)`);
    } else if (eq.kind === "R") {
      lines.push(`  Real ${eq.name}; // Rate (flow)`);
    } else if (eq.kind === "A") {
      lines.push(`  Real ${eq.name}; // Auxiliary`);
    } else if (eq.kind === "S") {
      lines.push(`  Real ${eq.name}; // Supplementary`);
    }
  }

  // Initial equations (N)
  const initialEqs = model.equations.filter((e) => e.kind === "N");
  if (initialEqs.length > 0) {
    lines.push("initial equation");
    for (const eq of initialEqs) {
      lines.push(`  ${eq.name} = ${exprToModelica(eq.expr)};`);
    }
  }

  // Differential and algebraic equations
  lines.push("equation");
  for (const eq of model.equations) {
    if (eq.kind === "L" && eq.expr) {
      const rateExpr = extractLevelRateExpr(eq.name, eq.expr, dt);
      lines.push(`  der(${eq.name}) = ${exprToModelica(rateExpr)};`);
    } else if ((eq.kind === "R" || eq.kind === "A" || eq.kind === "S") && eq.expr) {
      lines.push(`  ${eq.name} = ${exprToModelica(eq.expr)};`);
    }
  }

  lines.push(
    `  annotation(experiment(StartTime=0.0, StopTime=${formatNumber(length)}, Interval=${formatNumber(dt)}));`,
  );
  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}
