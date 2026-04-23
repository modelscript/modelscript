// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "@modelscript/modelica-polyglot/ast";
import type { ModelicaDAE, ModelicaExpression } from "@modelscript/symbolics";
import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaSimpleEquation,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
} from "@modelscript/symbolics";
import type { FmuOptions, FmuResult } from "./fmi.js";

/**
 * Generate FMI 2.0 compatible Javascript source file from a DAE and FMU result.
 */
export function generateFmuJsSources(dae: ModelicaDAE, fmuResult: FmuResult, options: FmuOptions): string {
  const id = options.modelIdentifier;
  const vars = fmuResult.scalarVariables;
  const nStates = fmuResult.modelStructure.derivatives.length;
  const nVars = vars.length;

  return generateModelJs(id, nVars, nStates, dae, fmuResult);
}

function exprToJs(expr: ModelicaExpression): string {
  if (expr instanceof ModelicaRealLiteral) return `${expr.value}`;
  if (expr instanceof ModelicaIntegerLiteral) return `${expr.value}`;
  if (expr instanceof ModelicaBooleanLiteral) return expr.value ? "1" : "0";
  if (expr instanceof ModelicaStringLiteral) return `"${escapeJsString(expr.value)}"`;
  if (expr instanceof ModelicaNameExpression) return varToJs(expr.name);
  if (expr instanceof ModelicaUnaryExpression) {
    const op = expr.operator === ModelicaUnaryOperator.UNARY_MINUS ? "-" : "!";
    return `(${op}${exprToJs(expr.operand)})`;
  }
  if (expr instanceof ModelicaBinaryExpression) {
    const lhs = exprToJs(expr.operand1);
    const rhs = exprToJs(expr.operand2);
    const op = binaryOpToJs(expr.operator);
    if (op === "pow") return `Math.pow(${lhs}, ${rhs})`;
    return `(${lhs} ${op} ${rhs})`;
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    if (expr.functionName === "initial") return "this.isInitPhase";
    if (expr.functionName === "terminal") return "0";
    if (expr.functionName === "assert" && expr.args.length >= 2) {
      const cond = exprToJs(expr.args[0] as ModelicaExpression);
      const msgExpr = expr.args[1];
      const msg = msgExpr instanceof ModelicaStringLiteral ? msgExpr.value.replace(/"/g, '\\"') : "Assertion failed";
      return `((${cond}) ? 0.0 : (console.error("${msg}"), this.terminate = true, 0.0))`;
    }
    const args = expr.args.map((a: ModelicaExpression) => exprToJs(a)).join(", ");
    const fname = mapFunctionName(expr.functionName);
    return `${fname}(${args})`;
  }
  if (expr instanceof ModelicaIfElseExpression) {
    const cond = exprToJs(expr.condition);
    const then = exprToJs(expr.thenExpression);
    const els = exprToJs(expr.elseExpression);
    if (expr.elseIfClauses.length > 0) {
      let result = `(${cond} ? ${then} : `;
      for (const clause of expr.elseIfClauses) {
        result += `${exprToJs(clause.condition)} ? ${exprToJs(clause.expression)} : `;
      }
      result += `${els})`;
      return result;
    }
    return `(${cond} ? ${then} : ${els})`;
  }
  if (expr && typeof expr === "object" && "name" in expr) {
    return varToJs((expr as { name: string }).name);
  }
  return "0.0";
}

function varToJs(name: string): string {
  if (name === "time") return "this.time";
  return `this.vars[VR_${sanitizeIdentifier(name).toUpperCase()}]`;
}

function sanitizeIdentifier(name: string): string {
  return name
    .replace(/\./g, "_")
    .replace(/\[/g, "_")
    .replace(/\]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

function binaryOpToJs(op: ModelicaBinaryOperator): string {
  switch (op) {
    case ModelicaBinaryOperator.ADDITION:
    case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
      return "+";
    case ModelicaBinaryOperator.SUBTRACTION:
    case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
      return "-";
    case ModelicaBinaryOperator.MULTIPLICATION:
    case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
      return "*";
    case ModelicaBinaryOperator.DIVISION:
    case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
      return "/";
    case ModelicaBinaryOperator.EXPONENTIATION:
    case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
      return "pow";
    case ModelicaBinaryOperator.LESS_THAN:
      return "<";
    case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
      return "<=";
    case ModelicaBinaryOperator.GREATER_THAN:
      return ">";
    case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
      return ">=";
    case ModelicaBinaryOperator.EQUALITY:
      return "===";
    case ModelicaBinaryOperator.INEQUALITY:
      return "!==";
    case ModelicaBinaryOperator.LOGICAL_AND:
      return "&&";
    case ModelicaBinaryOperator.LOGICAL_OR:
      return "||";
    default:
      return "+";
  }
}

function mapFunctionName(name: string): string {
  const builtins: Record<string, string> = {
    sin: "Math.sin",
    cos: "Math.cos",
    tan: "Math.tan",
    asin: "Math.asin",
    acos: "Math.acos",
    atan: "Math.atan",
    atan2: "Math.atan2",
    exp: "Math.exp",
    log: "Math.log",
    log10: "Math.log10",
    sqrt: "Math.sqrt",
    abs: "Math.abs",
    floor: "Math.floor",
    ceil: "Math.ceil",
    min: "Math.min",
    max: "Math.max",
    "Modelica.Math.sin": "Math.sin",
    "Modelica.Math.cos": "Math.cos",
    "Modelica.Math.log": "Math.log",
    "Modelica.Math.exp": "Math.exp",
    "Modelica.Math.sqrt": "Math.sqrt",
    "Modelica.Math.atan2": "Math.atan2",
  };
  return builtins[name] ?? `Math.${sanitizeIdentifier(name)}`;
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function generateModelJs(id: string, nVars: number, nStates: number, dae: ModelicaDAE, result: FmuResult): string {
  const lines: string[] = [];
  lines.push("/* Auto-generated by ModelScript — Javascript FMI */");

  // Variable Constants
  for (const sv of result.scalarVariables) {
    const cName = sanitizeIdentifier(sv.name).toUpperCase();
    lines.push(`const VR_${cName} = ${sv.valueReference};`);
  }

  lines.push("");
  lines.push("class FmuModel {");
  lines.push("  constructor() {");
  lines.push(`    this.vars = new Float64Array(${nVars + 1});`);
  lines.push(`    this.states = new Float64Array(${nStates + 1});`);
  lines.push(`    this.derivatives = new Float64Array(${nStates + 1});`);
  lines.push(`    this.time = 0.0;`);
  lines.push(`    this.isInitPhase = 1;`);
  lines.push(`    this.terminate = false;`);

  // Initial parameters
  for (const sv of result.scalarVariables) {
    if (sv.start !== undefined) {
      lines.push(`    this.vars[${sv.valueReference}] = ${sv.start};`);
    }
  }

  lines.push("  }");
  lines.push("");

  lines.push("  getDerivatives() {");

  // Extract state variables and mapping
  const derVRs = result.modelStructure.derivatives;
  const stateVRs: number[] = [];
  const derVars = result.scalarVariables.filter((sv) => sv.name.startsWith("der("));

  for (const dv of derVars) {
    if (dv.derivative !== undefined) {
      stateVRs.push(dv.derivative);
    }
  }

  for (let i = 0; i < stateVRs.length; i++) {
    lines.push(`    this.states[${i}] = this.vars[${stateVRs[i]}];`);
  }

  for (const eq of dae.equations) {
    if (eq instanceof ModelicaSimpleEquation && eq.expression1 instanceof ModelicaNameExpression) {
      lines.push(`    ${varToJs(eq.expression1.name)} = ${exprToJs(eq.expression2)};`);
    }
  }

  for (let i = 0; i < derVRs.length; i++) {
    lines.push(`    this.derivatives[${i}] = this.vars[${derVRs[i]}];`);
  }

  lines.push("  }");
  lines.push("");
  lines.push("  doStep(currentCommunicationPoint, communicationStepSize) {");
  lines.push("    this.isInitPhase = 0;");
  lines.push("    this.time = currentCommunicationPoint;");
  lines.push("    const dt = communicationStepSize;");
  lines.push("    ");
  lines.push("    // Basic explicit forward Euler step for demo purposes in Javascript");
  lines.push("    this.getDerivatives();");
  for (let i = 0; i < stateVRs.length; i++) {
    lines.push(`    this.vars[${stateVRs[i]}] = this.vars[${stateVRs[i]}] + this.derivatives[${i}] * dt;`);
  }
  lines.push("    this.time += dt;");
  lines.push("    this.getDerivatives();");
  lines.push("  }");
  lines.push("}");

  return lines.join("\n");
}
