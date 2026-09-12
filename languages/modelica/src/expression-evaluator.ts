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

import type { ExpressionEvaluator, QueryDB, SymbolEntry } from "@modelscript/runtime";
import type { ModificationValue } from "./modifications.js";

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
  if (typeof expression === "string") {
    if (expression.startsWith('"') && expression.endsWith('"')) return expression.slice(1, -1);
    return evaluateExprText(expression, scope, db);
  }
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
      const text = value.text ?? db.cstText(value.cstBytes[0], value.cstBytes[1], scope ?? undefined);
      if (text !== null && text !== undefined) {
        return evaluateExprText(text, scope, db);
      }
      return null;
    }
  }
}

const evaluatingComponentIds = new Set<number>();

function getComponentEvaluatedValue(resolved: SymbolEntry, db: QueryDB): unknown {
  if (resolved.kind === "Component" && !evaluatingComponentIds.has(resolved.id)) {
    evaluatingComponentIds.add(resolved.id);
    try {
      const compMod = db.query<any>("effectiveModification", resolved.id);
      if (compMod?.bindingExpression) {
        const scopeId = compMod.evaluationScopeId ?? resolved.parentId;
        const scopeEntry = scopeId ? db.symbol(scopeId) : null;
        const val = evaluateModValue(compMod.bindingExpression, scopeEntry, db);
        if (val !== null && val !== undefined) {
          return val;
        }
      }
    } finally {
      evaluatingComponentIds.delete(resolved.id);
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Text-Based Expression Evaluation (Lightweight)
// ---------------------------------------------------------------------------

/**
 * Evaluate a Modelica expression from its source text.
 *
 * This is a lightweight evaluator for common expression patterns
 * that appear in modifications. For full expression evaluation,
 * the WASM-based ArenaExprEvaluator handles complex cases.
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

  // Array subscript indexing: arr[index] or arr[start:stop]
  const subscriptMatch = trimmed.match(/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\[([^\]]+)\]$/);
  if (subscriptMatch) {
    const baseName = subscriptMatch[1];
    const subText = subscriptMatch[2].trim();
    const baseVal = evaluateExprText(baseName, scope, db);
    if (Array.isArray(baseVal)) {
      if (subText.includes(":")) {
        const rangeParts = subText.split(":").map((p) => evaluateExprText(p.trim(), scope, db));
        if (typeof rangeParts[0] === "number" && typeof rangeParts[1] === "number") {
          const start = rangeParts[0] - 1; // 1-based to 0-based
          const stop = rangeParts[1];
          return baseVal.slice(start, stop);
        }
      } else {
        const idx = evaluateExprText(subText, scope, db);
        if (typeof idx === "number") {
          return baseVal[idx - 1]; // 1-based indexing
        }
      }
    } else if (baseVal && typeof baseVal === "object" && "id" in baseVal && (baseVal as any).kind === "Component") {
      return baseVal;
    }
  }

  // Member access on indexed expression: arr[i].field
  if (trimmed.includes("[")) {
    const lastDot = findTopLevelOperator(trimmed, ["."]);
    if (lastDot > 0) {
      const lhs = trimmed.slice(0, lastDot).trim();
      const rhs = trimmed.slice(lastDot + 1).trim();
      if (/^[a-zA-Z_]\w*$/.test(rhs)) {
        const lhsVal = evaluateExprText(lhs, scope, db);
        if (lhsVal && typeof lhsVal === "object") {
          if (rhs in (lhsVal as Record<string, unknown>)) {
            return (lhsVal as Record<string, unknown>)[rhs];
          }
          if ("id" in lhsVal && (lhsVal as any).kind === "Component") {
            const sym = lhsVal as SymbolEntry;
            const typeSpec = db.query<string | null>("typeSpecifier", sym.id);
            if (typeSpec && sym.parentId) {
              const parentResolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", sym.parentId);
              const typeSym = parentResolver ? parentResolver(typeSpec) : null;
              if (typeSym) {
                const typeChildren = db.childrenOf(typeSym.id);
                const fieldSym = typeChildren.find((c) => c.name === rhs && c.kind === "Component");
                if (fieldSym) {
                  return getComponentEvaluatedValue(fieldSym, db);
                }
              }
            }
          }
        }
      }
    }
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
        return getComponentEvaluatedValue(resolved, db);
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
        return getComponentEvaluatedValue(resolved, db);
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

  // Multiplication and division: a * b, a / b
  const mulDivIdx = findTopLevelOperator(trimmed, ["*", "/"]);
  if (mulDivIdx > 0) {
    const lhs = evaluateExprText(trimmed.slice(0, mulDivIdx), scope, db);
    const rhs = evaluateExprText(trimmed.slice(mulDivIdx + 1), scope, db);
    if (typeof lhs === "number" && typeof rhs === "number") {
      const op = trimmed[mulDivIdx];
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

  // Built-in function calls: funcName(args) or Record constructor
  const funcMatch = trimmed.match(/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\((.+)\)$/s);
  if (funcMatch) {
    const funcName = funcMatch[1]!;
    const argsText = funcMatch[2]!;
    const builtinVal = evaluateBuiltinCall(funcName, argsText, scope, db);
    if (builtinVal !== null) return builtinVal;

    // Check if funcName resolves to a record constructor
    if (scope) {
      const isQualified = funcName.includes(".");
      const resolveHook = isQualified ? "resolveName" : "resolveSimpleName";
      const resolver = db.query<(n: string) => SymbolEntry | null>(resolveHook, scope.id);
      let targetClass = resolver ? resolver(funcName) : null;
      if (!targetClass) {
        const simpleName = isQualified ? funcName.split(".").pop()! : funcName;
        const matches = db.byName(simpleName);
        targetClass = matches?.find((e) => e.kind === "Class") ?? null;
      }
      if (targetClass && targetClass.kind === "Class") {
        const meta = targetClass.metadata as Record<string, unknown> | undefined;
        const isRecord =
          meta?.classPrefixes === "record" ||
          (typeof meta?.classPrefixes === "string" && meta.classPrefixes.includes("record")) ||
          targetClass.ruleName === "record_definition";
        if (isRecord) {
          const rawArgs = splitTopLevel(argsText, ",").map((a) => a.trim());
          const fields = db.childrenOf(targetClass.id).filter((c) => c.kind === "Component");
          const recordObj: Record<string, unknown> = {};
          for (let i = 0; i < rawArgs.length; i++) {
            const arg = rawArgs[i]!;
            if (arg.includes("=")) {
              const eqIdx = arg.indexOf("=");
              const fieldName = arg.slice(0, eqIdx).trim();
              const fieldVal = evaluateExprText(arg.slice(eqIdx + 1).trim(), scope, db);
              recordObj[fieldName] = fieldVal;
            } else if (i < fields.length) {
              const fieldName = fields[i]!.name;
              const fieldVal = evaluateExprText(arg, scope, db);
              recordObj[fieldName] = fieldVal;
            }
          }
          return recordObj;
        }
      }
    }
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

  // Array functions
  if (name === "size" && args.length >= 1) {
    const arrayArg = args[0];
    let dims: number[] | null = null;
    if (Array.isArray(arrayArg)) {
      dims = [arrayArg.length];
    } else if (arrayArg && typeof arrayArg === "object" && "id" in arrayArg) {
      const entry = arrayArg as SymbolEntry;
      dims = db.query<number[] | null>("resolvedArrayDimensions", entry.id);
      // console.error(`[DEBUG EVAL SIZE] entry=${entry.name} dims=${dims}`);
    }

    if (dims && dims.length > 0) {
      if (args.length === 1) {
        return dims;
      } else if (args.length === 2 && typeof args[1] === "number") {
        const dimIndex = args[1] - 1; // 1-based index
        if (dimIndex >= 0 && dimIndex < dims.length) {
          // console.error(`[DEBUG EVAL SIZE RETURN] returning ${dims[dimIndex]}`);
          return dims[dimIndex];
        }
      }
    }
    // console.error(`[DEBUG EVAL SIZE FAIL] name=${name} arrayArg=${JSON.stringify(arrayArg)}`);
  }

  if (name === "fill" && args.length >= 2) {
    const val = args[0];
    const dims = args.slice(1);
    if (dims.every((d) => typeof d === "number")) {
      const buildFill = (depth: number): any => {
        const count = dims[depth] as number;
        if (depth === dims.length - 1) {
          return Array(count).fill(val);
        }
        const arr = [];
        for (let i = 0; i < count; i++) {
          arr.push(buildFill(depth + 1));
        }
        return arr;
      };
      return buildFill(0);
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
