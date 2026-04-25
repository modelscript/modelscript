// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaBinaryOperator } from "@modelscript/modelica/ast";

/** Sanitize a Modelica name into a valid C/JS identifier. */
export function sanitizeIdentifier(name: string): string {
  return name
    .replace(/\./g, "_")
    .replace(/\[/g, "_")
    .replace(/\]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Map binary operator to C operator. */
export function binaryOpToC(op: ModelicaBinaryOperator): string {
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
      return "==";
    case ModelicaBinaryOperator.INEQUALITY:
      return "!=";
    case ModelicaBinaryOperator.LOGICAL_AND:
      return "&&";
    case ModelicaBinaryOperator.LOGICAL_OR:
      return "||";
    default:
      return "+";
  }
}

/** Map binary operator to JS operator. */
export function binaryOpToJs(op: ModelicaBinaryOperator): string {
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

/** Map Modelica built-in function names to C math library equivalents. */
export function mapFunctionName(name: string): string {
  const builtins: Record<string, string> = {
    sin: "sin",
    cos: "cos",
    tan: "tan",
    asin: "asin",
    acos: "acos",
    atan: "atan",
    atan2: "atan2",
    sinh: "sinh",
    cosh: "cosh",
    tanh: "tanh",
    exp: "exp",
    log: "log",
    log10: "log10",
    sqrt: "sqrt",
    abs: "fabs",
    sign: "copysign",
    floor: "floor",
    ceil: "ceil",
    min: "fmin",
    max: "fmax",
    mod: "fmod",
    "Modelica.Math.sin": "sin",
    "Modelica.Math.cos": "cos",
    "Modelica.Math.log": "log",
    "Modelica.Math.exp": "exp",
    "Modelica.Math.sqrt": "sqrt",
    "Modelica.Math.atan2": "atan2",
  };
  return builtins[name] ?? sanitizeIdentifier(name);
}

/** Map Modelica built-in function names to JS math library equivalents. */
export function mapFunctionNameJs(name: string): string {
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

/** Format a double for C source. */
export function formatCDouble(value: number): string {
  if (!isFinite(value)) {
    if (value === Infinity) return "INFINITY";
    if (value === -Infinity) return "(-INFINITY)";
    return "NAN";
  }
  const s = value.toString();
  // Ensure it has a decimal point or exponent to be a C double literal
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
    return s + ".0";
  }
  return s;
}

/** Escape special characters for C string literals. */
export function escapeCString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Escape special characters for JS string literals. */
export function escapeJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Extract the derivative name from an expression. */
export function extractDerName(expr: unknown): string | null {
  if (expr && typeof expr === "object" && "functionName" in expr && "args" in expr) {
    const fe = expr as { functionName: string; args: unknown[] };
    if (fe.functionName === "der" && fe.args.length === 1) {
      const a = fe.args[0];
      if (a && typeof a === "object" && "name" in a) {
        const n = (a as { name: unknown }).name;
        if (typeof n === "string") return n;
      }
    }
  }
  if (expr && typeof expr === "object" && "name" in expr) {
    const n = (expr as { name: unknown }).name;
    if (typeof n === "string" && n.startsWith("der(") && n.endsWith(")")) return n.substring(4, n.length - 1);
  }
  return null;
}
