// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { resolveModelicaConstant } from "./constants.js";
import { evalArithmeticString, splitTopLevel } from "./flattener/expressions/cst-utils.js";
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

  // Handle CST byte range tuples [startOffset, endOffset]
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

function findInheritedExtendsMod(
  db: QueryDB,
  clsId: number,
  targetName: string,
  visited = new Set<number>(),
): { modVal: ModificationValue; evalScopeId: number } | null {
  if (visited.has(clsId)) return null;
  visited.add(clsId);
  const children = db.childrenOf(clsId);
  for (const child of children) {
    if (child.kind === "Extends") {
      const extModRaw = db.query<any>("extendsModificationParsed", child.id);
      const extArgs: any[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
      const found = extArgs.find((a: any) => !a.isBreak && a.name === targetName && a.value);
      if (found?.value) {
        return { modVal: found.value, evalScopeId: clsId };
      }
      const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
      if (baseClass) {
        const sub = findInheritedExtendsMod(db, baseClass.id, targetName, visited);
        if (sub) return sub;
      }
    }
  }
  return null;
}

function getComponentEvaluatedValue(resolved: SymbolEntry, db: QueryDB, scope?: SymbolEntry | null): unknown {
  if (resolved.kind === "Component" && !evaluatingComponentIds.has(resolved.id)) {
    evaluatingComponentIds.add(resolved.id);
    try {
      if (scope && (scope.kind === "Class" || scope.kind === "Package") && scope.id !== resolved.parentId) {
        const inhMod = findInheritedExtendsMod(db, scope.id, resolved.name);
        if (inhMod) {
          const scopeEntry = db.symbol(inhMod.evalScopeId) ?? scope;
          const val = evaluateModValue(inhMod.modVal, scopeEntry, db);
          if (val !== null && val !== undefined) {
            return val;
          }
        }
      }
      const compMod = db.query<any>("effectiveModification", resolved.id);
      if (compMod?.bindingExpression) {
        const scopeId = compMod.evaluationScopeId ?? resolved.parentId;
        const scopeEntry = scopeId ? (db.symbol(scopeId) ?? null) : null;
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

function getEnumLiteralIndex(text: string, db: QueryDB): number | null {
  const parts = text.split(".");
  const litName = parts.pop()!;
  const typeName = parts.length > 0 ? parts.pop()! : null;
  const candidateSyms = typeName
    ? db.byName(typeName)
    : (db as any).index?.symbols
      ? Array.from((db as any).index.symbols.values()).filter((s: any) => (s as any).kind === "Class")
      : [];
  for (const s of candidateSyms as any[]) {
    const cstText = (db.cstNode(s.id) as any)?.text ?? "";
    const match = /enumeration\s*\(([^)]+)\)/.exec(cstText);
    if (match && match[1]) {
      const lits = match[1].split(",").map((x: string) => x.trim().split(/\s+/)[0]);
      const idx = lits.indexOf(litName);
      if (idx >= 0) return idx + 1;
    }
  }
  return null;
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

  // If-then-else expressions: if <cond> then <thenExpr> [elseif <cond> then <thenExpr> ...] else <elseExpr>
  if (/^if(?:\s|\()/.test(trimmed)) {
    const parsedIf = parseTopLevelIfExpression(trimmed);
    if (parsedIf) {
      for (const branch of parsedIf.branches) {
        const condVal = evaluateExprText(branch.cond, scope, db);
        if (typeof condVal !== "boolean" && typeof condVal !== "number") {
          return null;
        }
        const isTrue = condVal === true || condVal === 1 || (typeof condVal === "number" && condVal !== 0);
        if (isTrue) {
          return evaluateExprText(branch.thenExpr, scope, db);
        }
      }
      if (parsedIf.elseExpr !== null) {
        return evaluateExprText(parsedIf.elseExpr, scope, db);
      }
    }
  }

  // Array subscript indexing: arr[index], arr[i, j], arr[b[1]], or arr[start:stop]
  const trailingSub = extractTrailingSubscript(trimmed);
  if (trailingSub) {
    const baseName = trailingSub.baseExpr;
    const subText = trailingSub.subText;
    let baseVal = evaluateExprText(baseName, scope, db);
    if (!Array.isArray(baseVal) && baseVal && typeof baseVal === "object" && "id" in baseVal) {
      const sym = baseVal as SymbolEntry;
      const dims = db.query<number[] | null>("resolvedArrayDimensions", sym.id);
      if (dims && dims.length > 0 && dims[0]! > 0) {
        baseVal = Array.from({ length: dims[0]! }, (_, i) => i + 1);
      }
    }
    if (Array.isArray(baseVal)) {
      const applySingleSub = (arrVal: unknown[], singleSub: string): unknown => {
        const sTrim = singleSub.trim();
        if (sTrim === ":") return arrVal;
        const colonParts = splitTopLevel(sTrim, ":");
        if (colonParts.length >= 2) {
          const parts = colonParts.map((p) => {
            let pt = p.trim();
            pt = pt.replace(/\bend\b/g, String(arrVal.length));
            if (pt === "false") return 1;
            if (pt === "true") return 2;
            const ev = evaluateExprText(pt, scope, db);
            if (typeof ev === "number") return ev;
            const arithVal = evalArithmeticString(pt);
            if (arithVal !== null) return arithVal;
            if (db) {
              const enumIdx = getEnumLiteralIndex(pt, db);
              if (enumIdx !== null) return enumIdx;
            }
            return null;
          });
          let start: number | null = null;
          let step = 1;
          let stop: number | null = null;
          if (parts.length === 2 && typeof parts[0] === "number" && typeof parts[1] === "number") {
            start = parts[0];
            stop = parts[1];
          } else if (
            parts.length === 3 &&
            typeof parts[0] === "number" &&
            typeof parts[1] === "number" &&
            typeof parts[2] === "number"
          ) {
            start = parts[0];
            step = parts[1];
            stop = parts[2];
          }
          if (start !== null && stop !== null && step !== 0) {
            const sliced: unknown[] = [];
            if (step > 0) {
              for (let idx = start; idx <= stop; idx += step) {
                if (idx >= 1 && idx <= arrVal.length) {
                  sliced.push(arrVal[idx - 1]);
                }
              }
            } else {
              for (let idx = start; idx >= stop; idx += step) {
                if (idx >= 1 && idx <= arrVal.length) {
                  sliced.push(arrVal[idx - 1]);
                }
              }
            }
            return sliced;
          }
          return undefined;
        }
        const cleanSub = sTrim.replace(/\bend\b/g, String(arrVal.length));
        let idx: unknown = evaluateExprText(cleanSub, scope, db);
        if (cleanSub === "false") idx = 1;
        if (cleanSub === "true") idx = 2;
        if (typeof idx !== "number") {
          const arithVal = evalArithmeticString(cleanSub);
          if (arithVal !== null) idx = arithVal;
        }
        if (typeof idx !== "number" && db) {
          const enumIdx = getEnumLiteralIndex(cleanSub, db);
          if (enumIdx !== null) idx = enumIdx;
        }
        if (typeof idx === "number") {
          return arrVal[idx - 1]; // 1-based indexing
        }
        return undefined;
      };
      const dimSubs = splitTopLevel(subText, ",");
      let curr: unknown = baseVal;
      for (const dSub of dimSubs) {
        if (!Array.isArray(curr)) {
          curr = undefined;
          break;
        }
        curr = applySingleSub(curr, dSub);
      }
      if (curr !== undefined) {
        return curr;
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
                  return getComponentEvaluatedValue(fieldSym, db, scope);
                }
              }
            }
          }
        }
      }
    }
  }

  // Simple name reference — resolve in scope
  if (/^\.?[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(trimmed) && scope) {
    const cleanName = trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
    const constVal = resolveModelicaConstant(cleanName);
    if (constVal !== undefined) {
      return constVal;
    }
    const isQualified = cleanName.includes(".");
    const resolveHook = isQualified ? "resolveName" : "resolveSimpleName";
    const resolver = db.query<(name: string) => SymbolEntry | null>(resolveHook, scope.id);
    if (resolver) {
      const resolved = resolver(cleanName);
      if (resolved) {
        if (resolved.kind === "EnumerationLiteral" || resolved.ruleName === "EnumerationLiteral") {
          if (resolved.parentId) {
            const siblings = db.childrenOf(resolved.parentId);
            const idx = siblings.findIndex((c: any) => c.id === resolved.id);
            if (idx >= 0) return idx + 1;
          }
          return resolved.name;
        }
        return getComponentEvaluatedValue(resolved, db, scope);
      }
    }

    // Fallback if the hook fails (e.g. built-in constants)
    const resolvedFallback = db.byName(cleanName);
    if (resolvedFallback && resolvedFallback.length > 0) {
      const resolved = resolvedFallback[0];
      if (resolved) {
        if (resolved.kind === "EnumerationLiteral" || resolved.ruleName === "EnumerationLiteral") {
          if (resolved.parentId) {
            const siblings = db.childrenOf(resolved.parentId);
            const idx = siblings.findIndex((c: any) => c.id === resolved.id);
            if (idx >= 0) return idx + 1;
          }
          return resolved.name;
        }
        return getComponentEvaluatedValue(resolved, db, scope);
      }
    }
  }

  // Stand-alone range expression: start:stop or start:step:stop
  if (trimmed.includes(":") && !trimmed.includes("{") && !trimmed.includes("[") && !trimmed.includes("(")) {
    const colonParts = splitTopLevel(trimmed, ":");
    if (colonParts.length === 2 || colonParts.length === 3) {
      const evalParts = colonParts.map((p) => {
        const pt = p.trim();
        if (pt === "false") return 1;
        if (pt === "true") return 2;
        return evaluateExprText(pt, scope, db);
      });
      let start: number | null = null;
      let step = 1;
      let stop: number | null = null;
      if (colonParts.length === 2 && typeof evalParts[0] === "number" && typeof evalParts[1] === "number") {
        start = evalParts[0];
        stop = evalParts[1];
      } else if (
        colonParts.length === 3 &&
        typeof evalParts[0] === "number" &&
        typeof evalParts[1] === "number" &&
        typeof evalParts[2] === "number"
      ) {
        start = evalParts[0];
        step = evalParts[1];
        stop = evalParts[2];
      }
      if (start !== null && stop !== null && step !== 0) {
        const rangeArr: number[] = [];
        if (step > 0) {
          for (let v = start; v <= stop; v += step) rangeArr.push(v);
        } else {
          for (let v = start; v >= stop; v += step) rangeArr.push(v);
        }
        return rangeArr;
      }
    }
  }

  // Array constructor: {a, b, c} or array comprehension: {expr for x in range}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    const compMatch = inner.match(/^(.+?)\s+for\s+([a-zA-Z_]\w*)\s+in\s+(.+)$/);
    if (compMatch) {
      const bodyExpr = compMatch[1]!.trim();
      const iterVar = compMatch[2]!.trim();
      const rangeExpr = compMatch[3]!.trim();
      const rangeVals = evaluateExprText(rangeExpr, scope, db);
      if (Array.isArray(rangeVals)) {
        const substituteIterVar = (exprStr: string, varName: string, replacement: string): string => {
          let out = "";
          let i = 0;
          while (i < exprStr.length) {
            const ch = exprStr[i]!;
            if (ch === '"' || ch === "'") {
              const quote = ch;
              out += ch;
              i++;
              while (i < exprStr.length) {
                const c = exprStr[i]!;
                out += c;
                i++;
                if (c === "\\" && i < exprStr.length) {
                  out += exprStr[i]!;
                  i++;
                } else if (c === quote) {
                  break;
                }
              }
              continue;
            }
            if (/[a-zA-Z_]/.test(ch)) {
              const start = i;
              while (i < exprStr.length && /[a-zA-Z0-9_]/.test(exprStr[i]!)) i++;
              const ident = exprStr.slice(start, i);
              const prevChar = start > 0 ? exprStr[start - 1] : "";
              const rest = exprStr.slice(i);
              const isMemberAccess = prevChar === ".";
              const isNamedArg = /^\s*=[^=]/.test(rest);
              if (ident === varName && !isMemberAccess && !isNamedArg) {
                out += replacement;
              } else {
                out += ident;
              }
              continue;
            }
            out += ch;
            i++;
          }
          return out;
        };
        const result: unknown[] = [];
        for (const v of rangeVals) {
          if (bodyExpr === iterVar) {
            result.push(v);
          } else {
            const replaced = substituteIterVar(bodyExpr, iterVar, String(v));
            result.push(evaluateExprText(replaced, scope, db));
          }
        }
        return result;
      }
    }
    const elements = splitTopLevel(inner, ",");
    return elements.map((e) => evaluateExprText(e.trim(), scope, db));
  }

  // Parenthesized: (expr) — only unwrap when '(' at 0 matches ')' at end
  if (trimmed.startsWith("(") && trimmed.endsWith(")") && isBalancedOuterParens(trimmed)) {
    return evaluateExprText(trimmed.slice(1, -1), scope, db);
  }

  // Logical 'or' / 'and' / 'not' and relational operators (lowest precedence first)
  const orIdx = findTopLevelKeywordOperator(trimmed, "or");
  if (orIdx > 0) {
    const lhs = evaluateExprText(trimmed.slice(0, orIdx), scope, db);
    const rhs = evaluateExprText(trimmed.slice(orIdx + 2), scope, db);
    if (typeof lhs === "boolean" && typeof rhs === "boolean") return lhs || rhs;
  }
  const andIdx = findTopLevelKeywordOperator(trimmed, "and");
  if (andIdx > 0) {
    const lhs = evaluateExprText(trimmed.slice(0, andIdx), scope, db);
    const rhs = evaluateExprText(trimmed.slice(andIdx + 3), scope, db);
    if (typeof lhs === "boolean" && typeof rhs === "boolean") return lhs && rhs;
  }
  if (/^not(?:\s|\()/.test(trimmed)) {
    const inner = evaluateExprText(trimmed.slice(3), scope, db);
    if (typeof inner === "boolean") return !inner;
  }
  const relMatch = findTopLevelRelationalOperator(trimmed);
  if (relMatch) {
    const lhs = evaluateExprText(trimmed.slice(0, relMatch.idx), scope, db);
    const rhs = evaluateExprText(trimmed.slice(relMatch.idx + relMatch.op.length), scope, db);
    if (
      lhs !== null &&
      lhs !== undefined &&
      rhs !== null &&
      rhs !== undefined &&
      (typeof lhs === "number" || typeof lhs === "string" || typeof lhs === "boolean")
    ) {
      switch (relMatch.op) {
        case "==":
          return lhs === rhs;
        case "<>":
          return lhs !== rhs;
        case "<=":
          return (lhs as any) <= (rhs as any);
        case ">=":
          return (lhs as any) >= (rhs as any);
        case "<":
          return (lhs as any) < (rhs as any);
        case ">":
          return (lhs as any) > (rhs as any);
      }
    }
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
    if (op === "+" && typeof lhs === "string" && typeof rhs === "string") {
      return lhs + rhs;
    }
  }

  // Unary negation / plus (checked after binary +/- so '-a + b' parses as '(-a) + b' rather than '-(a + b)')
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    const inner = evaluateExprText(trimmed.slice(1), scope, db);
    if (typeof inner === "number") return trimmed.startsWith("-") ? -inner : inner;
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
          meta?.["classPrefixes"] === "record" ||
          (typeof meta?.["classPrefixes"] === "string" && meta["classPrefixes"].includes("record")) ||
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

  if (name === "noEvent" && args.length >= 1) {
    return args[0];
  }
  if ((name === "smooth" || name === "homotopy") && args.length === 2) {
    return args[name === "smooth" ? 1 : 0];
  }
  if (name === "semiLinear" && args.length === 3 && args.every((a) => typeof a === "number")) {
    const [x, posSlope, negSlope] = args as [number, number, number];
    return x >= 0 ? posSlope * x : negSlope * x;
  }

  // Math & SIunits.Conversions functions (single numeric argument)
  if (args.length === 1 && typeof args[0] === "number") {
    const v = args[0];
    const shortName = name.replace(/^(?:Modelica\.)?(?:Math|SIunits\.Conversions)\./, "");
    switch (shortName) {
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
      case "sinh":
        return Math.sinh(v);
      case "cosh":
        return Math.cosh(v);
      case "tanh":
        return Math.tanh(v);
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
      case "from_degC":
        return v + 273.15;
      case "to_degC":
        return v - 273.15;
      case "from_bar":
        return v * 1e5;
      case "to_bar":
        return v * 1e-5;
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
        return args[1] !== 0 ? args[0] - Math.floor(args[0] / args[1]) * args[1] : null;
      case "rem":
        return args[1] !== 0 ? args[0] % args[1] : null;
      case "div":
        return args[1] !== 0 ? Math.trunc(args[0] / args[1]) : null;
      case "atan2":
        return Math.atan2(args[0], args[1]);
    }
  }

  // 1-arg array reductions: sum, product, min, max, ndims, scalar, vector, diagonal
  if (args.length === 1 && Array.isArray(args[0])) {
    const flattenNumeric = (arr: unknown[]): number[] | null => {
      const out: number[] = [];
      for (const el of arr) {
        if (typeof el === "number") {
          out.push(el);
        } else if (Array.isArray(el)) {
          const sub = flattenNumeric(el);
          if (!sub) return null;
          out.push(...sub);
        } else {
          return null;
        }
      }
      return out;
    };
    switch (name) {
      case "sum": {
        const flat = flattenNumeric(args[0]);
        return flat ? flat.reduce((a, b) => a + b, 0) : null;
      }
      case "product": {
        const flat = flattenNumeric(args[0]);
        return flat ? flat.reduce((a, b) => a * b, 1) : null;
      }
      case "min": {
        const flat = flattenNumeric(args[0]);
        return flat ? (flat.length === 0 ? Infinity : Math.min(...flat)) : null;
      }
      case "max": {
        const flat = flattenNumeric(args[0]);
        return flat ? (flat.length === 0 ? -Infinity : Math.max(...flat)) : null;
      }
      case "scalar": {
        const flat = flattenNumeric(args[0]);
        return flat && flat.length === 1 ? flat[0]! : null;
      }
      case "diagonal": {
        const vec = args[0];
        if (vec.every((x) => typeof x === "number")) {
          return vec.map((v, i) => vec.map((_, j) => (i === j ? v : 0)));
        }
        break;
      }
    }
  }

  // Array functions
  if (name === "size" && args.length >= 1) {
    const arrayArg = args[0];
    let dims: number[] | null = null;
    if (Array.isArray(arrayArg)) {
      const d: number[] = [];
      let curr: unknown = arrayArg;
      while (Array.isArray(curr)) {
        d.push(curr.length);
        curr = curr[0];
      }
      dims = d;
    } else if (arrayArg && typeof arrayArg === "object" && "id" in arrayArg) {
      const entry = arrayArg as SymbolEntry;
      dims = db.query<number[] | null>("resolvedArrayDimensions", entry.id);
    }

    if (dims && dims.length > 0) {
      if (args.length === 1) {
        return dims;
      } else if (args.length === 2 && typeof args[1] === "number") {
        const dimIndex = args[1] - 1; // 1-based index
        if (dimIndex >= 0 && dimIndex < dims.length) {
          return dims[dimIndex];
        }
      }
    }
  }

  if ((name === "zeros" || name === "ones") && args.length >= 1 && args.every((d) => typeof d === "number")) {
    const fillVal = name === "ones" ? 1 : 0;
    const dims = args as number[];
    const buildConstArr = (depth: number): unknown => {
      const count = dims[depth]!;
      if (depth === dims.length - 1) return Array(count).fill(fillVal);
      return Array.from({ length: count }, () => buildConstArr(depth + 1));
    };
    return buildConstArr(0);
  }

  if (name === "identity" && args.length === 1 && typeof args[0] === "number") {
    const n = args[0];
    return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
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

/** Check whether outer '(' at index 0 matches ')' at text.length - 1. */
function isBalancedOuterParens(text: string): boolean {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  let depth = 0;
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && i < text.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Parse a top-level `if <cond> then <thenExpr> [elseif <cond> then <thenExpr> ...] [else <elseExpr>]`
 * expression while respecting parentheses/brackets/braces, string literals, and nested `if` expressions.
 */
function parseTopLevelIfExpression(
  text: string,
): { branches: { cond: string; thenExpr: string }[]; elseExpr: string | null } | null {
  if (!/^if(?:\s|\()/.test(text)) return null;
  const isWordChar = (c: string | undefined) => Boolean(c && /[a-zA-Z0-9_]/.test(c));
  const matchKeywordAt = (pos: number, kw: string): boolean => {
    if (text.slice(pos, pos + kw.length) !== kw) return false;
    const prev = pos > 0 ? text[pos - 1] : undefined;
    const next = pos + kw.length < text.length ? text[pos + kw.length] : undefined;
    return !isWordChar(prev) && !isWordChar(next);
  };

  const branches: { cond: string; thenExpr: string }[] = [];
  let elseExpr: string | null = null;
  let depth = 0;
  let ifDepth = 0;
  let inQuotes = false;
  let quoteChar = "";
  let state: "cond" | "then" | "else" = "cond";
  let segStart = 2; // after leading "if"
  let currentCond = "";

  for (let i = 2; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      continue;
    }
    if (depth !== 0) continue;

    if (matchKeywordAt(i, "if")) {
      ifDepth++;
      i += 1;
      continue;
    }
    if (ifDepth > 0) {
      if (matchKeywordAt(i, "else")) {
        ifDepth--;
        i += 3;
      }
      continue;
    }

    if (state === "cond" && matchKeywordAt(i, "then")) {
      currentCond = text.slice(segStart, i).trim();
      state = "then";
      segStart = i + 4;
      i += 3;
      continue;
    }
    if (state === "then" && matchKeywordAt(i, "elseif")) {
      const thenBranch = text.slice(segStart, i).trim();
      branches.push({ cond: currentCond, thenExpr: thenBranch });
      state = "cond";
      segStart = i + 6;
      i += 5;
      continue;
    }
    if (state === "then" && matchKeywordAt(i, "else")) {
      const thenBranch = text.slice(segStart, i).trim();
      branches.push({ cond: currentCond, thenExpr: thenBranch });
      state = "else";
      segStart = i + 4;
      i += 3;
      continue;
    }
  }

  if (depth !== 0 || ifDepth !== 0) return null;
  if (state === "then") {
    branches.push({ cond: currentCond, thenExpr: text.slice(segStart).trim() });
  } else if (state === "else") {
    elseExpr = text.slice(segStart).trim();
  } else {
    return null;
  }
  return branches.length > 0 ? { branches, elseExpr } : null;
}

/**
 * Extract trailing top-level subscript `baseExpr[subText]` from a postfix expression,
 * supporting nested brackets (`a[b[1]]`), multi-dimensional indices (`a[1, 2]`), and chained subscripts (`a[1][2]`).
 */
function extractTrailingSubscript(text: string): { baseExpr: string; subText: string } | null {
  if (!text.endsWith("]")) return null;
  let depth = 0;
  let inQuotes = false;
  let quoteChar = "";
  let lastOpenBracket = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      if (depth === 0 && ch === "[") {
        lastOpenBracket = i;
      }
      depth++;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) return null;
    } else if (depth === 0) {
      // Disallow top-level binary operators or whitespace outside brackets in the base expression
      if (/\s|[+\-*/^<>=:]/.test(ch)) {
        return null;
      }
    }
  }
  if (depth !== 0 || lastOpenBracket <= 0) return null;
  const baseExpr = text.slice(0, lastOpenBracket).trim();
  const subText = text.slice(lastOpenBracket + 1, -1).trim();
  if (!baseExpr || !subText) return null;
  return { baseExpr, subText };
}

/** Find the rightmost top-level word-bounded keyword operator ('or' or 'and'). */
function findTopLevelKeywordOperator(text: string, keyword: "or" | "and"): number {
  const isWordChar = (c: string | undefined) => Boolean(c && /[a-zA-Z0-9_]/.test(c));
  let depth = 0;
  let inQuotes = false;
  let quoteChar = "";
  let lastIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (depth === 0 && text.slice(i, i + keyword.length) === keyword) {
      const prev = i > 0 ? text[i - 1] : undefined;
      const next = i + keyword.length < text.length ? text[i + keyword.length] : undefined;
      if (!isWordChar(prev) && !isWordChar(next) && prev !== ".") {
        lastIdx = i;
      }
    }
  }
  return lastIdx;
}

/** Find the rightmost top-level relational operator ('==', '<>', '<=', '>=', '<', '>'). */
function findTopLevelRelationalOperator(text: string): { idx: number; op: string } | null {
  let depth = 0;
  let inQuotes = false;
  let quoteChar = "";
  let lastMatch: { idx: number; op: string } | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (depth === 0) {
      const twoChar = text.slice(i, i + 2);
      if (twoChar === "==" || twoChar === "<>" || twoChar === "<=" || twoChar === ">=") {
        lastMatch = { idx: i, op: twoChar };
        i++;
        continue;
      }
      if (ch === "<" || ch === ">") {
        lastMatch = { idx: i, op: ch };
      }
    }
  }
  return lastMatch;
}

/** Find the rightmost top-level occurrence of any operator (for left-associativity). */
function findTopLevelOperator(text: string, ops: string[]): number {
  let depth = 0;
  let inQuotes = false;
  let quoteChar = "";
  let lastIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (depth === 0 && ops.includes(ch)) {
      // Don't match unary minus/plus at position 0
      if ((ch === "-" || ch === "+") && i === 0) continue;
      // Don't match sign in scientific notation (e.g. 1e-5, 1E+3)
      if (
        (ch === "-" || ch === "+") &&
        i >= 2 &&
        (text[i - 1] === "e" || text[i - 1] === "E") &&
        /[\d.]/.test(text[i - 2]!)
      ) {
        continue;
      }
      // Don't match unary minus/plus after another operator
      if ((ch === "-" || ch === "+") && i > 0 && "+-*/^:<>=,".includes(text[i - 1]!.trim() || text[i - 1]!)) continue;
      lastIdx = i;
    }
  }
  return lastIdx;
}
