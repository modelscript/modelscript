/* eslint-disable */
/**
 * examples/modelica/expression-evaluator.ts
 *
 * Expression evaluator for the metascript query engine.
 *
 * Implements `ExpressionEvaluator` (used via `db.evaluate()`) to
 * evaluate Modelica expressions in the context of the query engine.
 *
 * The evaluator handles:
 * - Literal values (integer, real, boolean, string)
 * - Component reference resolution (via scope queries)
 * - Binary/unary arithmetic and logical operations
 * - Built-in function calls (abs, sqrt, sin, cos, etc.)
 * - Array constructors (braces notation)
 * - Range expressions (start:stop, start:step:stop)
 *
 * For complex expressions that require CST access, the evaluator
 * uses `db.cstText()` to extract source text and a lightweight
 * recursive-descent evaluator.
 */

import type { ExpressionEvaluator, QueryDB, SymbolEntry } from "@modelscript/polyglot";
import type { ModificationValue } from "./modification-args.js";

// ---------------------------------------------------------------------------
// Modelica Expression Evaluator
// ---------------------------------------------------------------------------

/**
 * Create the Modelica expression evaluator for the query engine.
 *
 * Usage:
 * ```typescript
 * const engine = new QueryEngine(index, hooks, {
 *   evaluator: modelicaEvaluator,
 * });
 * ```
 */
export const modelicaEvaluator: ExpressionEvaluator = (
  expression: unknown,
  scope: SymbolEntry | null,
  db: QueryDB,
): unknown => {
  // Handle ModificationValue objects from modification-args.ts
  if (isModificationValue(expression)) {
    return evaluateModValue(expression, scope, db);
  }

  // Handle raw literal values
  if (typeof expression === "number") return expression;
  if (typeof expression === "string") return expression;
  if (typeof expression === "boolean") return expression;

  // Handle CST byte range tuples [startByte, endByte]
  if (
    Array.isArray(expression) &&
    expression.length === 2 &&
    typeof expression[0] === "number" &&
    typeof expression[1] === "number"
  ) {
    const text = db.cstText(expression[0], expression[1]);
    if (text !== null) {
      return evaluateExprText(text, scope, db);
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// ModificationValue Evaluation
// ---------------------------------------------------------------------------

function isModificationValue(expr: unknown): expr is ModificationValue {
  return (
    typeof expr === "object" &&
    expr !== null &&
    "kind" in expr &&
    (expr.kind === "literal" || expr.kind === "expression" || expr.kind === "break")
  );
}

function evaluateModValue(value: ModificationValue, scope: SymbolEntry | null, db: QueryDB): unknown {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "break":
      return undefined;
    case "expression": {
      const text = db.cstText(value.cstBytes[0], value.cstBytes[1]);
      if (text !== null) {
        return evaluateExprText(text, scope, db);
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Text-Based Expression Evaluation (Lightweight)
// ---------------------------------------------------------------------------

/**
 * Evaluate a Modelica expression from its source text.
 *
 * This is a lightweight evaluator for common expression patterns
 * that appear in modifications. For full expression evaluation
 * (needed by the flattener), the CST-based ModelicaInterpreter
 * in the compatibility layer handles complex cases.
 */
function evaluateExprText(text: string, scope: SymbolEntry | null, db: QueryDB): unknown {
  const trimmed = text.trim();

  // Boolean literals
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // String literals
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  // Numeric literals
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") {
    return num;
  }

  // Simple name reference — resolve in scope
  if (/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(trimmed) && scope) {
    const isQualified = trimmed.includes(".");
    const resolveHook = isQualified ? "resolveName" : "resolveSimpleName";
    const resolver = db.query<(name: string) => SymbolEntry | null>(resolveHook, scope.id);
    if (resolver) {
      const resolved = resolver(trimmed);
      if (resolved) {
        if (resolved.ruleName === "EnumerationLiteral" && resolved.name) {
          return resolved.name;
        }
        return resolved;
      }
    }

    // Fallback if the hook fails (e.g. built-in constants)
    const resolvedFallback = db.byName(trimmed);
    if (resolvedFallback && resolvedFallback.length > 0) {
      const resolved = resolvedFallback[0];
      if (resolved) {
        if (resolved.ruleName === "EnumerationLiteral" && resolved.name) {
          return resolved.name;
        }
        return resolved;
      }
    }
  }

  // Negation: -expr
  if (trimmed.startsWith("-")) {
    const inner = evaluateExprText(trimmed.slice(1), scope, db);
    if (typeof inner === "number") return -inner;
  }

  // Array constructor: {a, b, c}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1);
    const elements = splitTopLevel(inner, ",");
    return elements.map((e) => evaluateExprText(e.trim(), scope, db));
  }

  // Parenthesized: (expr)
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return evaluateExprText(trimmed.slice(1, -1), scope, db);
  }

  // Binary operations (lowest precedence first: +, -, *, /)
  const addIdx = findTopLevelOperator(trimmed, ["+", "-"]);
  if (addIdx > 0) {
    const lhs = evaluateExprText(trimmed.slice(0, addIdx), scope, db);
    const op = trimmed[addIdx];
    const rhs = evaluateExprText(trimmed.slice(addIdx + 1), scope, db);
    if (typeof lhs === "number" && typeof rhs === "number") {
      return op === "+" ? lhs + rhs : lhs - rhs;
    }
  }

  const mulIdx = findTopLevelOperator(trimmed, ["*", "/"]);
  if (mulIdx > 0) {
    const lhs = evaluateExprText(trimmed.slice(0, mulIdx), scope, db);
    const op = trimmed[mulIdx];
    const rhs = evaluateExprText(trimmed.slice(mulIdx + 1), scope, db);
    if (typeof lhs === "number" && typeof rhs === "number") {
      return op === "*" ? lhs * rhs : rhs !== 0 ? lhs / rhs : null;
    }
  }

  // Power: base ^ exp
  const powIdx = findTopLevelOperator(trimmed, ["^"]);
  if (powIdx > 0) {
    const base = evaluateExprText(trimmed.slice(0, powIdx), scope, db);
    const exp = evaluateExprText(trimmed.slice(powIdx + 1), scope, db);
    if (typeof base === "number" && typeof exp === "number") {
      return Math.pow(base, exp);
    }
  }

  // Built-in function calls: funcName(args)
  const funcMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*\((.+)\)$/s);
  if (funcMatch) {
    const funcName = funcMatch[1]!;
    const argsText = funcMatch[2]!;
    return evaluateBuiltinCall(funcName, argsText, scope, db);
  }

  // Cannot evaluate — return null (will be handled as symbolic)
  return null;
}

// ---------------------------------------------------------------------------
// Built-in Function Evaluation
// ---------------------------------------------------------------------------

function evaluateBuiltinCall(name: string, argsText: string, scope: SymbolEntry | null, db: QueryDB): unknown {
  const args = splitTopLevel(argsText, ",").map((a) => evaluateExprText(a.trim(), scope, db));

  // Math functions (single numeric argument)
  if (args.length === 1 && typeof args[0] === "number") {
    const v = args[0];
    switch (name) {
      case "abs":
        return Math.abs(v);
      case "sqrt":
        return Math.sqrt(v);
      case "sin":
        return Math.sin(v);
      case "cos":
        return Math.cos(v);
      case "tan":
        return Math.tan(v);
      case "asin":
        return Math.asin(v);
      case "acos":
        return Math.acos(v);
      case "atan":
        return Math.atan(v);
      case "exp":
        return Math.exp(v);
      case "log":
        return Math.log(v);
      case "log10":
        return Math.log10(v);
      case "ceil":
        return Math.ceil(v);
      case "floor":
        return Math.floor(v);
      case "integer":
        return Math.floor(v);
      case "sign":
        return Math.sign(v);
      case "not":
        return !v;
    }
  }

  // Two-argument functions
  if (args.length === 2 && typeof args[0] === "number" && typeof args[1] === "number") {
    switch (name) {
      case "max":
        return Math.max(args[0], args[1]);
      case "min":
        return Math.min(args[0], args[1]);
      case "mod":
        return args[0] % args[1];
      case "div":
        return Math.trunc(args[0] / args[1]);
      case "atan2":
        return Math.atan2(args[0], args[1]);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// String Utilities
// ---------------------------------------------------------------------------

/** Split a string at top-level occurrences of a delimiter (respects parens/braces). */
function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (depth === 0 && ch === delimiter) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Find the rightmost top-level occurrence of any operator (for left-associativity). */
function findTopLevelOperator(text: string, ops: string[]): number {
  let depth = 0;
  let lastIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (depth === 0 && ops.includes(ch)) {
      // Don't match unary minus at position 0
      if (ch === "-" && i === 0) continue;
      // Don't match minus after another operator
      if (ch === "-" && i > 0 && "+-*/^".includes(text[i - 1]!)) continue;
      lastIdx = i;
    }
  }
  return lastIdx;
}
