// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp } from "@modelscript/compiler";

/** Sanitize a Modelica name into a valid C/JS identifier. */
export function sanitizeIdentifier(name: string): string {
  return name
    .replace(/\./g, "_")
    .replace(/\[/g, "_")
    .replace(/\]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Map binary operator to C operator. */
export function binaryOpToC(op: BinOp): string {
  switch (op) {
    case BinOp.Add:
    case BinOp.ElemAdd:
      return "+";
    case BinOp.Sub:
    case BinOp.ElemSub:
      return "-";
    case BinOp.Mul:
    case BinOp.ElemMul:
      return "*";
    case BinOp.Div:
    case BinOp.ElemDiv:
      return "/";
    case BinOp.Pow:
    case BinOp.ElemPow:
      return "pow";
    case BinOp.Lt:
      return "<";
    case BinOp.Lte:
      return "<=";
    case BinOp.Gt:
      return ">";
    case BinOp.Gte:
      return ">=";
    case BinOp.Eq:
      return "==";
    case BinOp.Neq:
      return "!=";
    case BinOp.And:
      return "&&";
    case BinOp.Or:
      return "||";
    default:
      return "+";
  }
}

/** Map binary operator to JS operator. */
export function binaryOpToJs(op: BinOp): string {
  switch (op) {
    case BinOp.Add:
    case BinOp.ElemAdd:
      return "+";
    case BinOp.Sub:
    case BinOp.ElemSub:
      return "-";
    case BinOp.Mul:
    case BinOp.ElemMul:
      return "*";
    case BinOp.Div:
    case BinOp.ElemDiv:
      return "/";
    case BinOp.Pow:
    case BinOp.ElemPow:
      return "pow";
    case BinOp.Lt:
      return "<";
    case BinOp.Lte:
      return "<=";
    case BinOp.Gt:
      return ">";
    case BinOp.Gte:
      return ">=";
    case BinOp.Eq:
      return "===";
    case BinOp.Neq:
      return "!==";
    case BinOp.And:
      return "&&";
    case BinOp.Or:
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
