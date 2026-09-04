// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`src/flattener-wasm.ts`).
 */

import { createChunkedUint32Array, EqKind, ExprKind, type ChunkedUint32Array } from "@modelscript/language";
import {
  ArenaDAEPrinter,
  BinOp,
  Causality,
  DAEBuilder,
  eliminateArenaAliases,
  foldArenaConstants,
  scalarizeArena,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  type QueryDB,
  type SymbolId,
  type TopologyGraph,
} from "@modelscript/language/compiler";
import { StringWriter } from "@modelscript/language/utils";
import { Cst, type SyntaxNode } from "../src-gen/bindings.js";
import { ModelicaPortBalancer } from "./connections.js";
import { isPredefinedType } from "./predefined-types.js";

export interface FlattenOptions {
  arrayMode?: "scalarize" | "preserve";
  functionInlining?: boolean;
  omcCompatibility?: boolean;
  eliminateAliases?: boolean;
}

function castToRealExpr(exprId: number, dae: DAEBuilder): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) {
    const val = dae.getExprData1(exprId);
    return dae.addRealLiteral(val);
  }
  if (kind === ExprKind.Unary) {
    const op = dae.getExprData1(exprId);
    const operand = castToRealExpr(dae.getExprLeft(exprId), dae);
    return dae.addExpression(ExprKind.Unary, op, operand);
  }
  if (kind === ExprKind.Negate) {
    const operand = castToRealExpr(dae.getExprLeft(exprId), dae);
    return dae.addExpression(ExprKind.Negate, 0, operand);
  }

  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    const left = castToRealExpr(dae.getExprLeft(exprId), dae);
    const right = castToRealExpr(dae.getExprRight(exprId), dae);
    return dae.addBinaryExpr(op, left, right);
  }
  return exprId;
}

function isRealExpr(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name === "time") return true;
    const vIdx = dae.getVarIdxByName(name);
    if (vIdx >= 0 && dae.getVarType(vIdx) === VarType.Real) return true;
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return isRealExpr(dae.getExprLeft(exprId), dae);
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul || op === BinOp.Div || op === BinOp.Pow) {
      return isRealExpr(dae.getExprLeft(exprId), dae) || isRealExpr(dae.getExprRight(exprId), dae);
    }
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (
      fnName === "sin" ||
      fnName === "cos" ||
      fnName === "tan" ||
      fnName === "exp" ||
      fnName === "log" ||
      fnName === "sqrt"
    ) {
      return true;
    }
  }
  return false;
}

function evalDaeExpr(exprId: number, dae: DAEBuilder): number | boolean | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.IntLiteral:
      return dae.getExprData1(exprId);
    case ExprKind.RealLiteral:
      return dae.getExprRealValue(exprId);
    case ExprKind.BoolLiteral:
      return dae.getExprData1(exprId) !== 0;
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (name === "true") return true;
      if (name === "false") return false;
      const varIdx = dae.lookupVariable(name);
      if (varIdx >= 0) {
        const bindingId = dae.getVarExpression(varIdx);
        if (bindingId !== undefined && bindingId >= 0 && bindingId !== exprId) {
          return evalDaeExpr(bindingId, dae);
        }
        const startVal = dae.getVarStartValue(varIdx);
        if (startVal !== 0) {
          return startVal;
        }
      }
      return null;
    }
    case ExprKind.Negate: {
      const operand = evalDaeExpr(dae.getExprLeft(exprId), dae);
      if (typeof operand === "number") return -operand;
      return null;
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const operand = evalDaeExpr(dae.getExprLeft(exprId), dae);
      if (operand === null) return null;
      if (op === UnaryOp.Negate && typeof operand === "number") return -operand;
      if (op === UnaryOp.Not) {
        if (typeof operand === "boolean") return !operand;
        if (typeof operand === "number") return operand === 0;
      }
      return null;
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId);
      const left = evalDaeExpr(dae.getExprLeft(exprId), dae);
      const right = evalDaeExpr(dae.getExprRight(exprId), dae);
      if (left === null || right === null) return null;
      if (typeof left === "number" && typeof right === "number") {
        switch (op) {
          case BinOp.Add:
            return left + right;
          case BinOp.Sub:
            return left - right;
          case BinOp.Mul:
            return left * right;
          case BinOp.Div:
            return right !== 0 ? left / right : null;
          case BinOp.Pow:
            return Math.pow(left, right);
          case BinOp.Eq:
            return left === right;
          case BinOp.Neq:
            return left !== right;
          case BinOp.Lt:
            return left < right;
          case BinOp.Lte:
            return left <= right;
          case BinOp.Gt:
            return left > right;
          case BinOp.Gte:
            return left >= right;
        }
      } else if (typeof left === "boolean" && typeof right === "boolean") {
        switch (op) {
          case BinOp.And:
            return left && right;
          case BinOp.Or:
            return left || right;
          case BinOp.Eq:
            return left === right;
          case BinOp.Neq:
            return left !== right;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function generateArrayIndices(dims: number[]): string[] {
  if (dims.length === 0) return [""];
  if (dims.length === 1) return Array.from({ length: dims[0]! }, (_, i) => `[${i + 1}]`);
  const results: string[] = [];
  const gen = (dim: number, cur: number[]) => {
    if (dim >= dims.length) {
      results.push(`[${cur.join(",")}]`);
      return;
    }
    for (let i = 1; i <= dims[dim]!; i++) {
      gen(dim + 1, [...cur, i]);
    }
  };
  gen(0, []);
  return results;
}

function generateArrayTuples(dims: number[]): number[][] {
  if (dims.length === 0) return [[]];
  if (dims.length === 1) return Array.from({ length: dims[0]! }, (_, i) => [i + 1]);
  const results: number[][] = [];
  const gen = (dim: number, cur: number[]) => {
    if (dim >= dims.length) {
      results.push([...cur]);
      return;
    }
    for (let i = 1; i <= dims[dim]!; i++) {
      gen(dim + 1, [...cur, i]);
    }
  };
  gen(0, []);
  return results;
}

function parseArrayLiteralElements(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [trimmed];
  const inner = trimmed.slice(1, -1).trim();
  const elements: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      elements.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    elements.push(current.trim());
  }
  return elements;
}

function getIndexedElementText(text: string, indices: number[]): string {
  let curr = text.trim();
  for (const idx of indices) {
    const elems = parseArrayLiteralElements(curr);
    const k = idx - 1;
    if (k >= 0 && k < elems.length) {
      curr = elems[k]!;
    } else {
      return curr;
    }
  }
  return curr;
}

function flattenColonNodes(n: any): any[] {
  if (!n) return [];
  while (n.childCount === 1) n = n.child(0);
  if (
    n.childCount === 3 &&
    (n.child(0).text === "(" || n.child(0).type === '"("') &&
    (n.child(2).text === ")" || n.child(2).type === '")"')
  ) {
    return flattenColonNodes(n.child(1));
  }
  if (n.childCount === 3) {
    const op = (n.child(1)?.text?.trim() ?? n.child(1)?.type ?? "").replace(/^"|"$/g, "");
    if (op === ":") {
      return [...flattenColonNodes(n.child(0)), ...flattenColonNodes(n.child(2))];
    }
  }
  return [n];
}

function getArrayLiteralItems(node: any): any[] {
  const items: any[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "array_arguments" || n.type === "array_arguments_non_first") {
      if (n.child(0)) items.push(n.child(0));
      if (n.childCount >= 3) walk(n.child(2));
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      walk(n.child(i));
    }
  };
  walk(node);
  if (items.length === 0) {
    const collectFallback = (n: any) => {
      if (!n) return;
      const t = n.text?.trim() ?? "";
      if (t === "{" || t === "}" || t === ",") return;
      if (
        n.type === "expression" ||
        n.type === "primary" ||
        n.type === "unsigned_number" ||
        n.type === "unsigned_integer"
      ) {
        if (n.childCount === 1 && (n.child(0).type === "expression" || n.child(0).type === "primary")) {
          collectFallback(n.child(0));
          return;
        }
        items.push(n);
        return;
      }
      for (let i = 0; i < n.childCount; i++) collectFallback(n.child(i));
    };
    collectFallback(node);
  }
  return items;
}

function findImplicitArrayDim(bodyNodes: any[], iterName: string, dae: DAEBuilder): number | null {
  let foundDim: number | null = null;
  const search = (n: any) => {
    if (!n || foundDim !== null) return;
    if (
      n.type === "component_reference" ||
      (n.childCount >= 2 && n.child(n.childCount - 1)?.type === "array_subscripts")
    ) {
      const subsNode = (n.children || []).find((c: any) => c.type === "array_subscripts") ?? n.child(n.childCount - 1);
      if (subsNode && (subsNode.type === "array_subscripts" || subsNode.type === "ArraySubscripts")) {
        for (let i = 0; i < subsNode.childCount; i++) {
          const sc = subsNode.child(i);
          if (sc.type === "subscript" || sc.type === "expression") {
            if (sc.text?.trim() === iterName) {
              const baseName = n.child(0)?.text?.trim();
              if (baseName) {
                let count = 0;
                for (let k = 1; ; k++) {
                  if (dae.getVarIdxByName(`${baseName}[${k}]`) >= 0) {
                    count++;
                  } else {
                    break;
                  }
                }
                if (count > 0) {
                  foundDim = count;
                  return;
                }
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      search(n.child(i));
    }
  };
  for (const b of bodyNodes) {
    search(b);
    if (foundDim !== null) break;
  }
  return foundDim;
}

function evaluateCSTNumber(
  node: any,
  subs?: Map<string, number>,
  scopeId?: SymbolId,
  db?: any,
  dae?: DAEBuilder,
): number | null {
  if (!node) return null;
  while (node.childCount === 1) {
    node = node.child(0);
  }
  if (
    node.childCount === 3 &&
    (node.child(0).text === "(" || node.child(0).type === '"("') &&
    (node.child(2).text === ")" || node.child(2).type === '")"')
  ) {
    return evaluateCSTNumber(node.child(1), subs, scopeId, db, dae);
  }

  const text = node.text?.trim() ?? "";
  if (subs && subs.has(text)) return subs.get(text)!;
  const num = parseInt(text, 10);
  if (!isNaN(num) && String(num) === text) return num;

  // Binary expression
  if (node.childCount === 3 && (node.type === "expression" || node.type === "BinaryExpression")) {
    const op = (node.child(1)?.text?.trim() ?? node.child(1)?.type ?? "").replace(/^"|"$/g, "");
    const left = evaluateCSTNumber(node.child(0), subs, scopeId, db, dae);
    const right = evaluateCSTNumber(node.child(2), subs, scopeId, db, dae);
    if (left !== null && right !== null) {
      if (op === "+") return left + right;
      if (op === "-") return left - right;
      if (op === "*") return left * right;
      if (op === "/") return right !== 0 ? Math.floor(left / right) : null;
    }
  }

  if (dae) {
    const vIdx = dae.getVarIdxByName(text);
    if (vIdx >= 0) {
      const bExpr = dae.getVarExpression(vIdx);
      if (bExpr !== undefined && bExpr >= 0) {
        const val = evalDaeExpr(bExpr, dae);
        if (typeof val === "number") return val;
      }
      const startVal = dae.getVarStartValue(vIdx);
      if (startVal !== 0) return startVal;
    }
  }

  if (scopeId !== undefined && db) {
    const resolver = db.query("resolveSimpleName", scopeId);
    if (resolver) {
      const resolved = resolver(text);
      if (resolved) {
        const mod = db.query("effectiveModification", resolved.id);
        if (mod?.bindingExpression?.text) {
          const bVal = parseInt(mod.bindingExpression.text.trim(), 10);
          if (!isNaN(bVal)) return bVal;
        }
      }
    }
  }
  return null;
}

function lowerCSTExpression(node: any, dae: DAEBuilder, prefix = "", substitutions?: Map<string, number>): number {
  if (!node) return -1;
  const type = node.type;

  // Single-child unwrap for wrappers
  if (
    (type === "expression" ||
      type === "primary" ||
      type === "expression_list" ||
      type === "Expression" ||
      type === "Primary") &&
    node.childCount === 1
  ) {
    return lowerCSTExpression(node.child(0), dae, prefix, substitutions);
  }

  // Parenthesized expression: "(" expr ")"
  if (
    node.childCount === 3 &&
    (node.child(0).type === "(" || node.child(0).text === "(" || node.child(0).type === '"("') &&
    (node.child(2).type === ")" || node.child(2).text === ")" || node.child(2).type === '")"')
  ) {
    return lowerCSTExpression(node.child(1), dae, prefix, substitutions);
  }

  // Real or Integer literal
  if (
    type === "unsigned_number" ||
    type === "unsigned_integer" ||
    type === "unsigned_real" ||
    type === "number_literal" ||
    type === "NumberLiteral"
  ) {
    const text = node.text.trim();
    if (text.includes(".") || text.toLowerCase().includes("e")) {
      return dae.addRealLiteral(parseFloat(text));
    }
    const intVal = parseInt(text, 10);
    return isNaN(intVal) ? dae.addRealLiteral(parseFloat(text)) : dae.addIntLiteral(intVal);
  }

  // Boolean literal
  const rawType = type.replace(/^"|"$/g, "");
  const trimmedText = node.text?.trim() ?? "";
  if (
    rawType === "true" ||
    rawType === "false" ||
    rawType === "boolean_literal" ||
    trimmedText === "true" ||
    trimmedText === "false"
  ) {
    return dae.addExpression(ExprKind.BoolLiteral, rawType === "true" || trimmedText === "true" ? 1 : 0);
  }

  // String literal
  if (type === "string_literal" || type === "StringLiteral") {
    const raw = node.text.trim();
    const str = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(str));
  }

  // "time" keyword
  if (type === "time" || node.text.trim() === "time") {
    return dae.addExpression(ExprKind.Name, dae.interner.intern("time"));
  }

  const firstChildToken = (node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "").replace(/^"|"$/g, "");

  // Der expression: der ( ... )
  if (type === "der" || (type === "primary" && (firstChildToken === "der" || node.child(0)?.type === "der"))) {
    let argNode = node.child(2);
    if (!argNode || argNode.type === ")") argNode = node.child(1);
    while (
      argNode &&
      (argNode.type === "expression_list" || argNode.type === "expression" || argNode.type === "primary") &&
      argNode.childCount === 1
    ) {
      argNode = argNode.child(0);
    }
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions);
    return dae.addDerExpr(argId);
  }

  // Pre expression: pre ( ... )
  if (
    type === "pre" ||
    (type === "primary" && (firstChildToken === "pre" || node.child(0)?.text?.startsWith("pre(")))
  ) {
    let argNode = node.child(2) ?? node.child(1);
    while (
      argNode &&
      (argNode.type === "expression_list" || argNode.type === "expression" || argNode.type === "primary") &&
      argNode.childCount === 1
    ) {
      argNode = argNode.child(0);
    }
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions);
    return dae.addPreExpr(argId);
  }

  // Function call: component_reference "(" ... ")"
  if (
    type === "function_call" ||
    (type === "primary" &&
      node.childCount >= 2 &&
      (node.child(1)?.type === "function_call_args" || node.child(1)?.type === "("))
  ) {
    const fnName = node.child(0)?.text?.trim() ?? "";
    const argsNode = node.child(1);
    const argExprIds: number[] = [];
    if (argsNode) {
      const collectArgs = (n: any) => {
        if (!n) return;
        if (n.type === "expression" || n.type === "Expression") {
          argExprIds.push(lowerCSTExpression(n, dae, prefix, substitutions));
          return;
        }
        for (let i = 0; i < n.childCount; i++) {
          collectArgs(n.child(i));
        }
      };
      collectArgs(argsNode);
    }
    if (
      fnName === "sample" ||
      fnName === "sin" ||
      fnName === "cos" ||
      fnName === "tan" ||
      fnName === "exp" ||
      fnName === "log"
    ) {
      for (let i = 0; i < argExprIds.length; i++) {
        argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
      }
    }
    return dae.addCallExpr(fnName, argExprIds);
  }

  // Subscript expression: arr[i]
  if (node.childCount >= 2 && node.child(node.childCount - 1)?.type === "array_subscripts") {
    const baseNode = node.child(0);
    const subsNode = node.child(node.childCount - 1);
    const baseName = baseNode.text?.trim() ?? "";

    // Evaluate subscripts
    const subVals: (number | string)[] = [];
    let allNumeric = true;
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c.type === "subscript" || c.type === "expression") {
        const expr = c.children?.find((k: any) => k.type === "expression") ?? c;
        const exprText = expr.text?.trim() ?? "";
        const evaluatedNum = evaluateCSTNumber(expr, substitutions, undefined, undefined, dae);
        if (evaluatedNum !== null) {
          subVals.push(evaluatedNum);
        } else {
          const subId = lowerCSTExpression(expr, dae, prefix, substitutions);
          if (subId >= 0 && dae.getExprKind(subId) === ExprKind.IntLiteral) {
            subVals.push(dae.getExprData1(subId));
          } else {
            allNumeric = false;
            subVals.push(exprText);
          }
        }
      }
    }

    if (allNumeric && subVals.length > 0) {
      let candidate = `${baseName}[${subVals.join(",")}]`;
      if (prefix && !candidate.startsWith(prefix) && !candidate.includes(".")) {
        candidate = `${prefix}.${candidate}`;
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
    }

    const baseId = lowerCSTExpression(baseNode, dae, prefix, substitutions);
    const subIds: number[] = [];
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c.type === "subscript" || c.type === "expression") {
        subIds.push(lowerCSTExpression(c, dae, prefix, substitutions));
      }
    }
    return dae.addSubscriptExpr(baseId, subIds);
  }

  // Parenthesized expression: "(" expr ")"
  if (
    (type === "primary" || type === "expression") &&
    (node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
    (node.child(node.childCount - 1)?.type === ")" ||
      node.child(node.childCount - 1)?.text === ")" ||
      node.child(node.childCount - 1)?.type === '")"')
  ) {
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (c.type === "expression" || c.type === "Expression") {
        return lowerCSTExpression(c, dae, prefix, substitutions);
      }
    }
  }

  // Array constructor: { e1, e2, ... }
  if (
    type === "primary" &&
    (node.child(0)?.type === "{" || node.child(0)?.text === "{" || node.child(0)?.type === '"{"') &&
    (node.child(node.childCount - 1)?.type === "}" ||
      node.child(node.childCount - 1)?.text === "}" ||
      node.child(node.childCount - 1)?.type === '"}"')
  ) {
    const elementIds: number[] = [];
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (c.type === "expression" || c.type === "array_arguments") {
        const collect = (n: any) => {
          if (!n) return;
          if (n.type === "expression") {
            elementIds.push(lowerCSTExpression(n, dae, prefix, substitutions));
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    return dae.addArrayCtorExpr(elementIds);
  }

  // Range expression: start : stop or start : step : stop
  if (
    node.childCount === 3 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"')
  ) {
    const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions);
    const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions);
    return dae.addExpression(ExprKind.Range, startId, -1, stopId);
  }
  if (
    node.childCount === 5 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"') &&
    (node.child(3)?.type === ":" || node.child(3)?.text === ":" || node.child(3)?.type === '":"')
  ) {
    const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions);
    const stepId = lowerCSTExpression(node.child(2), dae, prefix, substitutions);
    const stopId = lowerCSTExpression(node.child(4), dae, prefix, substitutions);
    return dae.addExpression(ExprKind.Range, startId, stepId, stopId);
  }

  // If-Else expression: if cond then e1 else e2
  if (firstChildToken === "if" && node.childCount >= 6) {
    const condId = lowerCSTExpression(node.child(1), dae, prefix, substitutions);
    const thenId = lowerCSTExpression(node.child(3), dae, prefix, substitutions);
    const elseId = lowerCSTExpression(node.child(node.childCount - 1), dae, prefix, substitutions);
    return dae.addExpression(ExprKind.IfElse, condId, thenId, elseId);
  }

  // Binary expression: left op right
  if (node.childCount === 3) {
    const rawOp = node.child(1)?.text?.trim() ?? node.child(1)?.type ?? "";
    const opToken = rawOp.replace(/^"|"$/g, "");
    let binOp: BinOp | null = null;
    switch (opToken) {
      case "+":
        binOp = BinOp.Add;
        break;
      case "-":
        binOp = BinOp.Sub;
        break;
      case "*":
        binOp = BinOp.Mul;
        break;
      case "/":
        binOp = BinOp.Div;
        break;
      case "^":
        binOp = BinOp.Pow;
        break;
      case ".+":
        binOp = BinOp.ElemAdd;
        break;
      case ".-":
        binOp = BinOp.ElemSub;
        break;
      case ".*":
        binOp = BinOp.ElemMul;
        break;
      case "./":
        binOp = BinOp.ElemDiv;
        break;
      case ".^":
        binOp = BinOp.ElemPow;
        break;
      case "<":
        binOp = BinOp.Lt;
        break;
      case "<=":
        binOp = BinOp.Lte;
        break;
      case ">":
        binOp = BinOp.Gt;
        break;
      case ">=":
        binOp = BinOp.Gte;
        break;
      case "==":
        binOp = BinOp.Eq;
        break;
      case "<>":
        binOp = BinOp.Neq;
        break;
      case "and":
        binOp = BinOp.And;
        break;
      case "or":
        binOp = BinOp.Or;
        break;
    }
    if (binOp !== null) {
      let leftId = lowerCSTExpression(node.child(0), dae, prefix, substitutions);
      let rightId = lowerCSTExpression(node.child(2), dae, prefix, substitutions);
      if (isRealExpr(leftId, dae) && !isRealExpr(rightId, dae)) {
        rightId = castToRealExpr(rightId, dae);
      } else if (!isRealExpr(leftId, dae) && isRealExpr(rightId, dae)) {
        leftId = castToRealExpr(leftId, dae);
      }
      return dae.addBinaryExpr(binOp, leftId, rightId);
    }
  }

  // Unary expression: -expr or +expr or not expr
  if (node.childCount === 2) {
    const rawOp = node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "";
    const op = rawOp.replace(/^"|"$/g, "");
    if (op === "-") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions);
      return dae.addExpression(ExprKind.Negate, 0, operandId);
    }

    if (op === "+") {
      return lowerCSTExpression(node.child(1), dae, prefix, substitutions);
    }
    if (op === "not") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions);
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, operandId);
    }
  }

  // Identifier / Name / Component Reference
  if (type === "identifier" || type === "name" || type === "component_reference") {
    let rawName = node.text.trim();
    if (substitutions && substitutions.has(rawName)) {
      return dae.addIntLiteral(substitutions.get(rawName)!);
    }

    if (type === "component_reference") {
      const parts: string[] = [];
      let currentIdent = "";
      for (const child of node.children || []) {
        const cType = child.type;
        const cText = child.text?.trim() ?? "";
        if (cType === "identifier" || cType === "property" || cType === "name") {
          currentIdent = cText;
          parts.push(currentIdent);
        } else if (cType === "array_subscripts") {
          const subVals: (number | string)[] = [];
          for (const sub of child.children || []) {
            if (sub.type === "subscript") {
              const expr = sub.children?.find((k: any) => k.type === "expression") ?? sub;
              const evaluatedNum = evaluateCSTNumber(expr, substitutions, undefined, undefined, dae);
              if (evaluatedNum !== null) {
                subVals.push(evaluatedNum);
              } else {
                const subId = lowerCSTExpression(expr, dae, prefix, substitutions);
                if (subId >= 0 && dae.getExprKind(subId) === ExprKind.IntLiteral) {
                  subVals.push(dae.getExprData1(subId));
                } else {
                  subVals.push(expr.text?.trim() ?? "");
                }
              }
            }
          }
          if (parts.length > 0) {
            parts[parts.length - 1] += `[${subVals.join(",")}]`;
          }
        }
      }
      if (parts.length > 0) {
        let candidate = parts.join(".");
        if (prefix && !candidate.startsWith(prefix + ".")) {
          const prefixed = `${prefix}.${candidate}`;
          if (dae.getVarIdxByName(prefixed) >= 0) {
            candidate = prefixed;
          } else if (!candidate.includes(".")) {
            candidate = prefixed;
          } else {
            const searchPrefix = prefixed + ".";
            for (let i = 0; i < dae.varCount; i++) {
              if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(searchPrefix)) {
                candidate = prefixed;
                break;
              }
            }
          }
        }
        if (dae.getVarIdxByName(candidate) >= 0) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        }
        rawName = candidate;
      }
    }

    if (prefix && !rawName.startsWith(prefix + ".")) {
      const prefixed = `${prefix}.${rawName}`;
      if (dae.getVarIdxByName(prefixed) >= 0) {
        rawName = prefixed;
      } else if (!rawName.includes(".")) {
        rawName = prefixed;
      } else {
        const searchPrefix = prefixed + ".";
        for (let i = 0; i < dae.varCount; i++) {
          if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(searchPrefix)) {
            rawName = prefixed;
            break;
          }
        }
      }
    }

    // Check if rawName is an array variable like e, which has elements e[1] .. e[N]
    // Only expand if rawName is NOT already subscripted (does not contain '[')
    if (!rawName.includes("[") && dae.getVarIdxByName(`${rawName}[1]`) >= 0) {
      const elemIds: number[] = [];
      for (let k = 1; ; k++) {
        const vk = dae.getVarIdxByName(`${rawName}[${k}]`);
        if (vk < 0) break;
        elemIds.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${rawName}[${k}]`)));
      }
      if (elemIds.length > 0) {
        return dae.addArrayCtorExpr(elemIds);
      }
    }

    return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
  }

  // Fallback: treat raw text as Name
  const fallback = node.text ? node.text.trim() : "";
  if (substitutions && substitutions.has(fallback)) {
    return dae.addIntLiteral(substitutions.get(fallback)!);
  }
  return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
}

export class ModelicaModificationEnv {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  flags: ChunkedUint32Array;
  count: number;

  constructor(capacity = 256) {
    this.keyHashes = createChunkedUint32Array(capacity);
    this.valExprIds = createChunkedUint32Array(capacity);
    this.flags = createChunkedUint32Array(capacity);
    this.count = 0;
  }

  set(keyHash: number, exprId: number, flag = 0): void {
    const idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, exprId);
    this.flags.set(idx, flag);
  }
}

export interface ComponentInstanceData {
  name: string;
  typeSpecifier: string;
  classInstance?: SymbolId | null;
  variability?: string;
  causality?: string;
  arrayDimensions?: number[];
  modification?: {
    bindingExpression?: { text: string };
    args?: {
      name: string;
      value?: { kind: string; value?: any; text?: string };
    }[];
  };
}

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;
  private db: QueryDB;
  private options: Required<FlattenOptions>;

  constructor(db: QueryDB, options?: FlattenOptions) {
    this.db = db;
    this.options = {
      arrayMode: options?.arrayMode ?? "preserve",
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility: options?.omcCompatibility ?? false,
      eliminateAliases: options?.eliminateAliases ?? true,
    };
  }

  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      if (options.arrayMode !== undefined) this.options.arrayMode = options.arrayMode;
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) this.options.omcCompatibility = options.omcCompatibility;
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    this.bodySnapshot = dae.clone();
    return dae;
  }

  flattenClass(rootClassId: SymbolId, cachedArena?: DAEBuilder | null): DAEBuilder {
    const rootSym = this.db.symbol(rootClassId);
    const rootName = rootSym?.name ?? "Model";
    const dae = cachedArena ?? new DAEBuilder(undefined, rootName, "");
    dae.classKind = (rootSym?.metadata as any)?.classKind ?? "model";
    const classCst = this.db.cstNode(rootClassId) as SyntaxNode | null;
    if (classCst) {
      const findDesc = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
        if (!n) return null;
        if (Cst.LongClassSpecifier.is(n)) return Cst.LongClassSpecifier.description(n);
        if (Cst.ShortClassSpecifier.is(n)) return n.childForFieldName("description");
        if (Cst.ClassDefinition.is(n)) {
          const spec = Cst.ClassDefinition.classSpecifier(n);
          const d = findDesc(spec);
          if (d) return d;
        }
        for (const child of n.children) {
          if (Cst.LongClassSpecifier.is(child)) return Cst.LongClassSpecifier.description(child);
          if (Cst.ShortClassSpecifier.is(child)) return child.childForFieldName("description");
        }
        return null;
      };
      const descNode = findDesc(classCst);
      if (descNode) {
        let descText = descNode.text?.trim() ?? "";
        if (descText.startsWith('"') && descText.endsWith('"')) {
          descText = descText.slice(1, -1);
        }
        if (descText) dae.description = descText;
      }
    }

    // 1. Layer 1: Component instantiation
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);
    if (elements) {
      this.instantiateElements(elements, "", dae);
    }

    // 2. Layer 2: Direct CST Equation extraction
    this.extractClassEquations(rootClassId, "", dae);

    // 3. Layer 3: Physical connector expansion & flow balance
    ModelicaPortBalancer.expandConnections(dae, { omcCompatibility: this.options.omcCompatibility });

    // 4. Constant folding and alias elimination
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    if (this.options.arrayMode === "scalarize") {
      return scalarizeArena(dae);
    }

    dae.groupEquationsForParity();
    return dae;
  }

  flattenFromTopology(graph: TopologyGraph): DAEBuilder {
    const dae = new DAEBuilder(undefined, "HybridSystem", "");

    for (const rootId of graph.rootIds) {
      const node = graph.nodes.get(rootId);
      if (node?.targetClassId) {
        const elements = this.db.query<SymbolId[]>("instantiate", node.targetClassId);
        if (elements) {
          this.instantiateElements(elements, node.path, dae);
        }
      }
    }

    for (const edge of graph.edges) {
      const srcNode = graph.nodes.get(edge.sourceId);
      const tgtNode = graph.nodes.get(edge.targetId);
      if (srcNode && tgtNode) {
        const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(srcNode.path));
        const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(tgtNode.path));
        dae.addEquation(EqKind.Connect, lhsId, rhsId);
      }
    }

    ModelicaPortBalancer.expandConnections(dae, { omcCompatibility: this.options.omcCompatibility });

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    return dae;
  }

  private instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder, parentMods?: any): void {
    for (const elemId of elements) {
      const compInst = this.db.query<ComponentInstanceData>("componentInstance", elemId);
      if (!compInst) continue;

      const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
      const meta = (this.db.symbol(elemId)?.metadata as any) || {};

      let classTargetId = compInst.classInstance;
      if (!classTargetId && compInst.typeSpecifier) {
        const targets = this.db.byName(compInst.typeSpecifier);
        if (targets.length > 0 && targets[0].kind === "Class") {
          classTargetId = targets[0].id;
        }
      }
      const classTarget = classTargetId ? this.db.symbol(classTargetId) : null;
      const isUserClass =
        classTarget &&
        classTarget.kind === "Class" &&
        (classTarget.metadata as any)?.classKind !== "type" &&
        !(classTarget.metadata as any)?.isEnum &&
        !isPredefinedType(classTarget) &&
        compInst.typeSpecifier !== "Real" &&
        compInst.typeSpecifier !== "Integer" &&
        compInst.typeSpecifier !== "Boolean" &&
        compInst.typeSpecifier !== "String";

      const matchingParentArg = parentMods?.args?.find((a: any) => a.name === compInst.name);

      if (isUserClass) {
        const subElements = this.db.query<SymbolId[]>("instantiate", classTargetId!);
        const effectiveSubMod = {
          args: [
            ...(compInst.modification?.args || []),
            ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
          ],
          bindingExpression: matchingParentArg?.value ?? compInst.modification?.bindingExpression ?? null,
        };
        const arrayDims = compInst?.arrayDimensions;
        if (arrayDims && arrayDims.length > 0) {
          const indices = generateArrayIndices(arrayDims);
          for (const indexStr of indices) {
            const arrVarName = `${name}${indexStr}`;
            if (subElements && subElements.length > 0) {
              this.instantiateElements(subElements, arrVarName, dae, effectiveSubMod);
            }
          }
        } else {
          if (subElements && subElements.length > 0) {
            this.instantiateElements(subElements, name, dae, effectiveSubMod);
          }
        }
        continue;
      }

      let varType = VarType.Real;
      if (compInst?.typeSpecifier === "Integer") varType = VarType.Integer;
      else if (compInst?.typeSpecifier === "Boolean") varType = VarType.Boolean;
      else if (compInst?.typeSpecifier === "String") varType = VarType.String;
      else if (typeof meta?.varType === "number") varType = meta.varType as number;
      else if (compInst?.typeSpecifier) {
        const typeTargets = this.db.byName(compInst.typeSpecifier);
        if (
          typeTargets.length > 0 &&
          ((typeTargets[0]?.metadata as any)?.isEnum || (typeTargets[0]?.metadata as any)?.classKind === "type")
        ) {
          varType = VarType.Enumeration;
        }
      }

      let variability = Variability.Continuous;
      if (compInst?.variability === "parameter") variability = Variability.Parameter;
      else if (compInst?.variability === "constant") variability = Variability.Constant;
      else if (compInst?.variability === "discrete") variability = Variability.Discrete;
      else if (typeof meta?.variability === "number") variability = meta.variability as number;

      let causality = Causality.Local;
      if (compInst?.causality === "input") causality = Causality.Input;
      else if (compInst?.causality === "output") causality = Causality.Output;
      else if (typeof meta?.causality === "number") causality = meta.causality as number;

      let descText = "";
      const elemCst = this.db.cstNode(elemId) as any;
      if (elemCst) {
        let curr: any = elemCst;
        while (curr && !Cst.ComponentDeclaration.is(curr) && curr.type !== "element") {
          curr = curr.parent;
        }

        const targetNode = curr ?? elemCst;
        const descNode =
          targetNode && Cst.ComponentDeclaration.is(targetNode)
            ? Cst.ComponentDeclaration.description(targetNode)
            : (targetNode?.children || []).find((c: any) => Cst.Description.is(c) || Cst.DescriptionString.is(c));
        if (descNode) {
          const t = descNode.text?.trim() ?? "";
          if (t && t !== '""') {
            descText = t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
          }
        }
      }

      const effectiveBinding = matchingParentArg?.value ?? compInst?.modification?.bindingExpression;

      const applyModifiers = (varIdx: number, idxTuple: number[] = []) => {
        if (descText) {
          dae.setVarDescription(varIdx, descText);
        }
        if (effectiveBinding?.text) {
          let bText = effectiveBinding.text.trim();
          if (idxTuple.length > 0 && bText.startsWith("{")) {
            bText = getIndexedElementText(bText, idxTuple);
          }
          let exprId: number | null = null;

          // Try lowering from CST node if available
          const findBindingExprNode = (n: any): any => {
            if (!n) return null;
            if (n.type === "expression" || n.type === "Expression") return n;
            for (const c of n.children || []) {
              const res = findBindingExprNode(c);
              if (res) return res;
            }
            return null;
          };

          const exprCst = findBindingExprNode(elemCst);
          if (idxTuple.length === 0 && exprCst && exprCst.text?.trim() === bText) {
            exprId = lowerCSTExpression(exprCst, dae, prefix);
            if (varType === VarType.Real && !isRealExpr(exprId, dae)) {
              exprId = castToRealExpr(exprId, dae);
            }
          }

          if (exprId === null) {
            const isPureInt = /^[+-]?\d+$/.test(bText);
            const isPureReal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(bText);
            if (varType === VarType.Real && (isPureReal || isPureInt)) {
              exprId = dae.addRealLiteral(parseFloat(bText));
            } else if (varType === VarType.Integer && isPureInt) {
              exprId = dae.addIntLiteral(parseInt(bText, 10));
            } else if (varType === VarType.Boolean && (bText === "true" || bText === "false")) {
              exprId = dae.addExpression(ExprKind.BoolLiteral, bText === "true" ? 1 : 0);
            } else {
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(bText));
            }
          }

          dae.setVarExpression(varIdx, exprId);
        }
        const combinedArgs = [
          ...(compInst?.modification?.args || []),
          ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
        ];
        for (const arg of combinedArgs) {
          if (
            arg.name === "start" ||
            arg.name === "fixed" ||
            arg.name === "min" ||
            arg.name === "max" ||
            arg.name === "unit" ||
            arg.name === "nominal"
          ) {
            let attrExprId: number | null = null;
            if (arg.value?.kind === "literal") {
              if (typeof arg.value.value === "number") {
                attrExprId =
                  varType === VarType.Integer
                    ? dae.addIntLiteral(arg.value.value)
                    : dae.addRealLiteral(arg.value.value);
              } else if (typeof arg.value.value === "boolean") {
                attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
              } else if (typeof arg.value.value === "string") {
                attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
              }
            } else if (arg.value?.kind === "expression" && arg.value.text) {
              let t = arg.value.text.trim();
              if (idxTuple.length > 0 && t.startsWith("{")) {
                t = getIndexedElementText(t, idxTuple);
              }
              if (t === "true" || t === "false") {
                attrExprId = dae.addExpression(ExprKind.BoolLiteral, t === "true" ? 1 : 0);
              } else if (!isNaN(parseFloat(t))) {
                attrExprId =
                  varType === VarType.Integer ? dae.addIntLiteral(parseInt(t, 10)) : dae.addRealLiteral(parseFloat(t));
              } else {
                attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(t));
              }
            }
            if (attrExprId !== null) {
              dae.setVarAttr(varIdx, arg.name, attrExprId);
            }
          }
        }
      };

      const arrayDims = compInst?.arrayDimensions;
      if (arrayDims && arrayDims.length > 0) {
        const tuples = generateArrayTuples(arrayDims);
        for (const tuple of tuples) {
          const indexStr = `[${tuple.join(",")}]`;
          const arrVarName = `${name}${indexStr}`;
          const varIdx = dae.addVariable(
            dae.interner.intern(arrVarName),
            varType as number,
            variability as number,
            causality as number,
            0.0,
          );
          applyModifiers(varIdx, tuple);
        }
      } else {
        const varIdx = dae.addVariable(
          dae.interner.intern(name),
          varType as number,
          variability as number,
          causality as number,
          0.0,
        );
        applyModifiers(varIdx, []);
      }
    }
  }

  private evaluateCSTToNumber(
    node: any,
    scopeId: SymbolId,
    subs?: Map<string, number>,
    dae?: DAEBuilder,
  ): number | null {
    return evaluateCSTNumber(node, subs, scopeId, this.db, dae);
  }

  private extractClassEquations(classId: SymbolId, prefix: string, dae: DAEBuilder): void {
    const cst = this.db.cstNode(classId);
    if (cst) {
      const walk = (node: any, substitutions?: Map<string, number>): void => {
        if (!node) return;

        // For equations: for i in 1:N loop ... end for;
        if (Cst.ForEquation.is(node)) {
          const indicesNode = Cst.ForEquation.indices(node);
          const forIndexNodes: any[] = [];
          if (indicesNode) {
            if (Cst.ForIndex.is(indicesNode)) {
              forIndexNodes.push(indicesNode);
            } else {
              for (const c of indicesNode.children || []) {
                if (Cst.ForIndex.is(c)) {
                  forIndexNodes.push(c);
                }
              }
            }
          }

          const bodyNodes: any[] = [];
          let inLoop = false;
          for (const child of node.children || []) {
            const t = child.text?.trim() ?? "";
            const ty = child.type ?? "";
            if (t === "loop" || ty === '"loop"') {
              inLoop = true;
              continue;
            }
            if (t === "end for" || ty === '"end for"') {
              inLoop = false;
              break;
            }
            if (inLoop) {
              if (t !== ";" && ty !== '";"') {
                bodyNodes.push(child);
              }
            }
          }
          if (bodyNodes.length === 0) {
            for (const child of node.children || []) {
              if (
                child.type !== "for" &&
                child.type !== "loop" &&
                child.type !== "end for" &&
                child.type !== "for_indices" &&
                child.type !== "for_index" &&
                child !== indicesNode &&
                child.text?.trim() !== ";"
              ) {
                bodyNodes.push(child);
              }
            }
          }

          const getForIndexValues = (fIndex: any, currentSubs: Map<string, number>): number[] => {
            const rangeNode =
              Cst.ForIndex.range(fIndex) || fIndex.children?.find?.((c: any) => c.type === "expression");
            if (!rangeNode) {
              const varName = Cst.ForIndex.variable(fIndex)?.text?.trim() || fIndex.child(0)?.text?.trim();
              if (varName) {
                const implicitDim = findImplicitArrayDim(bodyNodes, varName, dae);
                if (implicitDim && implicitDim > 0) {
                  return Array.from({ length: implicitDim }, (_, i) => i + 1);
                }
              }
              return [1];
            }

            const rangeText = rangeNode.text?.trim() ?? "";
            if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
              const items = getArrayLiteralItems(rangeNode);
              const vals: number[] = [];
              for (const item of items) {
                const v = evaluateCSTNumber(item, currentSubs, classId, this.db, dae);
                if (v !== null) vals.push(v);
              }
              if (vals.length > 0) return vals;
            }

            const colonNodes = flattenColonNodes(rangeNode);
            if (colonNodes.length >= 2) {
              let startVal = 1;
              let stopVal = 1;
              let stepVal = 1;

              const sVal = evaluateCSTNumber(colonNodes[0], currentSubs, classId, this.db, dae);
              if (sVal !== null) startVal = sVal;

              if (colonNodes.length === 2) {
                const eVal = evaluateCSTNumber(colonNodes[1], currentSubs, classId, this.db, dae);
                if (eVal !== null) stopVal = eVal;
              } else if (colonNodes.length >= 3) {
                const stVal = evaluateCSTNumber(colonNodes[1], currentSubs, classId, this.db, dae);
                const eVal = evaluateCSTNumber(colonNodes[2], currentSubs, classId, this.db, dae);
                if (stVal !== null) stepVal = stVal;
                if (eVal !== null) stopVal = eVal;
              }

              const result: number[] = [];
              if (stepVal > 0) {
                for (let v = startVal; v <= stopVal; v += stepVal) {
                  result.push(v);
                }
              } else if (stepVal < 0) {
                for (let v = startVal; v >= stopVal; v += stepVal) {
                  result.push(v);
                }
              }
              return result;
            }

            const singleVal = evaluateCSTNumber(rangeNode, currentSubs, classId, this.db, dae);
            return singleVal !== null ? [singleVal] : [1];
          };

          const unroll = (indexIdx: number, currentSubs: Map<string, number>) => {
            if (indexIdx >= forIndexNodes.length) {
              for (const bodyChild of bodyNodes) {
                walk(bodyChild, currentSubs);
              }
              return;
            }
            const fIndex = forIndexNodes[indexIdx];
            const varName = Cst.ForIndex.variable(fIndex)?.text?.trim() || fIndex.child(0)?.text?.trim();
            const iterVals = getForIndexValues(fIndex, currentSubs);
            for (const v of iterVals) {
              const nextSubs = new Map<string, number>(currentSubs);
              if (varName) nextSubs.set(varName, v);
              unroll(indexIdx + 1, nextSubs);
            }
          };
          unroll(0, new Map<string, number>(substitutions || []));
          return;
        }

        // If equations: if cond then ... elseif cond then ... else ... end if;
        if (Cst.IfEquation.is(node)) {
          interface IfBranch {
            conditionNode?: any;
            equationNodes: any[];
          }
          const branches: IfBranch[] = [];
          let currentBranch: IfBranch | null = null;
          let inCondition = false;
          let inBody = false;

          for (const child of node.children || []) {
            const text = child.text?.trim() ?? "";
            const type = child.type ?? "";

            if (text === "if" || type === '"if"' || text === "elseif" || type === '"elseif"') {
              inCondition = true;
              inBody = false;
              currentBranch = { equationNodes: [] };
              branches.push(currentBranch);
            } else if (text === "else" || type === '"else"') {
              inCondition = false;
              inBody = true;
              currentBranch = { equationNodes: [] };
              branches.push(currentBranch);
            } else if (text === "then" || type === '"then"') {
              inCondition = false;
              inBody = true;
            } else if (text === "end if" || type === '"end if"') {
              inCondition = false;
              inBody = false;
              currentBranch = null;
            } else {
              if (inCondition && currentBranch && !currentBranch.conditionNode) {
                currentBranch.conditionNode = child;
              } else if (inBody && currentBranch) {
                if (text !== ";" && type !== '";"') {
                  currentBranch.equationNodes.push(child);
                }
              }
            }
          }

          // Check if condition can be statically evaluated
          let staticBranchIndex: number | null = null;
          let isDynamic = false;

          for (let i = 0; i < branches.length; i++) {
            const b = branches[i];
            if (b.conditionNode) {
              const condExprId = lowerCSTExpression(b.conditionNode, dae, prefix, substitutions);
              const evaluated = evalDaeExpr(condExprId, dae);
              if (evaluated === null) {
                isDynamic = true;
                break;
              } else if (evaluated === true) {
                staticBranchIndex = i;
                break;
              }
            } else {
              // else branch
              staticBranchIndex = i;
              break;
            }
          }

          if (!isDynamic) {
            if (staticBranchIndex !== null) {
              // Statically chosen branch: emit only its equations!
              const chosen = branches[staticBranchIndex];
              for (const eqNode of chosen.equationNodes) {
                walk(eqNode, substitutions);
              }
            }
            return;
          }

          // Otherwise dynamic If equation in DAE
          if (branches.length > 0 && branches[0].conditionNode) {
            const firstCondId = lowerCSTExpression(branches[0].conditionNode, dae, prefix, substitutions);
            const ifIdx = dae.addIfEquation(firstCondId);
            const meta = dae.getIfEquationMeta(ifIdx);

            const lowerInlineEq = (n: any): { kind: EqKind; lhsExprId: number; rhsExprId: number } | null => {
              if (!n) return null;
              if (n.type === "some_equation" && n.childCount === 1) n = n.child(0);
              if (
                n.type === "simple_equation" ||
                n.type === "SimpleEquation" ||
                n.type === "equality_equation" ||
                n.type === "EqualityEquation"
              ) {
                const exprs = (n.children || []).filter((c: any) => c.type === "expression" || c.type === "Expression");
                if (exprs.length >= 2) {
                  let lId = lowerCSTExpression(exprs[0], dae, prefix, substitutions);
                  let rId = lowerCSTExpression(exprs[1], dae, prefix, substitutions);
                  if (isRealExpr(lId, dae) && !isRealExpr(rId, dae)) {
                    rId = castToRealExpr(rId, dae);
                  }
                  return { kind: EqKind.Simple, lhsExprId: lId, rhsExprId: rId };
                }
              }
              if (n.type === "function_call" || n.type === "FunctionCall") {
                const callId = lowerCSTExpression(n, dae, prefix, substitutions);
                return { kind: EqKind.FunctionCall, lhsExprId: callId, rhsExprId: -1 };
              }
              for (const kid of n.children || []) {
                const res = lowerInlineEq(kid);
                if (res) return res;
              }
              return null;
            };

            for (const eqNode of branches[0].equationNodes) {
              const eq = lowerInlineEq(eqNode);
              if (eq && meta) {
                meta.thenEquations.push(eq);
              }
            }

            for (let i = 1; i < branches.length; i++) {
              const b = branches[i];
              if (b.conditionNode) {
                const elseCondId = lowerCSTExpression(b.conditionNode, dae, prefix, substitutions);
                const bodyEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                for (const eqNode of b.equationNodes) {
                  const eq = lowerInlineEq(eqNode);
                  if (eq) bodyEqs.push(eq);
                }
                if (meta) {
                  meta.elseIfClauses.push({
                    conditionExprId: elseCondId,
                    bodyEquations: bodyEqs,
                    equations: [],
                  });
                }
              } else {
                // Else branch
                if (meta) {
                  if (!meta.elseEquations) meta.elseEquations = [];
                  for (const eqNode of b.equationNodes) {
                    const eq = lowerInlineEq(eqNode);
                    if (eq) meta.elseEquations.push(eq);
                  }
                }
              }
            }
            return;
          }
        }

        // Simple and Equality equations: lhs = rhs;
        if (
          node.type === "simple_equation" ||
          node.type === "SimpleEquation" ||
          node.type === "equality_equation" ||
          node.type === "EqualityEquation"
        ) {
          const expressions = (node.children || []).filter(
            (c: any) => c.type === "expression" || c.type === "Expression",
          );
          if (expressions.length >= 2) {
            let lhsExprId = lowerCSTExpression(expressions[0], dae, prefix, substitutions);
            let rhsExprId = lowerCSTExpression(expressions[1], dae, prefix, substitutions);
            if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
              rhsExprId = castToRealExpr(rhsExprId, dae);
            }
            dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
            return;
          }
        }

        // Function call equations (e.g. terminate(...))
        if (node.type === "function_call" || node.type === "FunctionCall") {
          const callId = lowerCSTExpression(node, dae, prefix, substitutions);
          dae.addEquation(EqKind.FunctionCall, callId, -1);
          return;
        }

        // Connect equations: connect(c1, c2);
        if (node.type === "connect_equation" || node.type === "ConnectEquation") {
          const refs = (node.children || []).filter(
            (c: any) =>
              c.type === "component_reference" ||
              c.type === "expression" ||
              c.type === "identifier" ||
              c.type === "name",
          );
          if (refs.length >= 2) {
            const lhsExprId = lowerCSTExpression(refs[0], dae, prefix, substitutions);
            const rhsExprId = lowerCSTExpression(refs[1], dae, prefix, substitutions);
            dae.addEquation(EqKind.Connect, lhsExprId, rhsExprId);
            return;
          }
        }

        // When equations: when cond then ... end when;
        if (node.type === "when_equation" || node.type === "WhenEquation") {
          const condNode = node.childForFieldName ? node.childForFieldName("condition") : null;
          const cond =
            condNode ?? (node.children || []).find((c: any) => c.type === "expression" || c.type === "Expression");
          const condId = cond ? lowerCSTExpression(cond, dae, prefix, substitutions) : -1;
          const whenIdx = dae.addWhenEquation(condId);

          const collectWhenBody = (n: any) => {
            if (!n) return;
            if (
              n.type === "simple_equation" ||
              n.type === "equality_equation" ||
              n.type === "SimpleEquation" ||
              n.type === "EqualityEquation"
            ) {
              const expressions = (n.children || []).filter(
                (c: any) => c.type === "expression" || c.type === "Expression",
              );
              if (expressions.length >= 2) {
                let lhsId = lowerCSTExpression(expressions[0], dae, prefix, substitutions);
                let rhsId = lowerCSTExpression(expressions[1], dae, prefix, substitutions);
                if (isRealExpr(lhsId, dae) && !isRealExpr(rhsId, dae)) {
                  rhsId = castToRealExpr(rhsId, dae);
                }
                const lhsKind = dae.getExprKind(lhsId);
                if (
                  lhsKind === ExprKind.Binary ||
                  lhsKind === ExprKind.RealLiteral ||
                  lhsKind === ExprKind.IntLiteral ||
                  lhsKind === ExprKind.Unary
                ) {
                  const out = new StringWriter();
                  const printer = new ArenaDAEPrinter(out, dae, true);
                  printer.printExpr(lhsId);
                  const lhsStr = out.toString();
                  dae.diagnostics.push({
                    severity: "error",
                    code: 0,
                    message: `Invalid left-hand side of when-equation: ${lhsStr}.`,
                    range: {
                      startPosition: n.startPosition,
                      endPosition: n.endPosition,
                    },
                  });
                  return;
                }
                dae.addWhenBodyEquation(whenIdx, EqKind.Simple, lhsId, rhsId);
              }
              return;
            }

            if (n.type === "function_call" || n.type === "FunctionCall") {
              const callId = lowerCSTExpression(n, dae, prefix, substitutions);
              dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, callId, -1);
              return;
            }

            for (const child of n.children || []) {
              if (child !== cond && child.type !== "when" && child.type !== "then" && child.type !== "end when") {
                collectWhenBody(child);
              }
            }
          };

          for (const kid of node.children || []) {
            if (kid !== cond && kid.type !== "when" && kid.type !== "then" && kid.type !== "end when") {
              collectWhenBody(kid);
            }
          }
          return;
        }

        // Algorithm sections:
        if (node.type === "algorithm_section" || node.type === "AlgorithmSection") {
          const secStart = dae.stmtCount;

          const extractExecutableStmts = (n: any): any[] => {
            if (!n) return [];
            if (
              n.type === "assignment_statement" ||
              n.type === "AssignmentStatement" ||
              n.type === "when_statement" ||
              n.type === "WhenStatement"
            ) {
              return [n];
            }
            if (n.type === "statement" || n.type === "statement_or_procedure") {
              const res: any[] = [];
              for (const c of n.children || []) {
                if (c.type !== "description" && c.type !== ";" && c.text?.trim() !== ";") {
                  res.push(...extractExecutableStmts(c));
                }
              }
              return res;
            }
            return [];
          };

          const lowerStatement = (sNode: any): void => {
            if (!sNode) return;

            if (sNode.type === "statement" || sNode.type === "statement_or_procedure") {
              for (const c of sNode.children || []) {
                if (c.type !== "description" && c.type !== ";" && c.text?.trim() !== ";") {
                  lowerStatement(c);
                }
              }
              return;
            }

            if (sNode.type === "assignment_statement" || sNode.type === "AssignmentStatement") {
              const exprs = (sNode.children || []).filter(
                (c: any) => c.type === "expression" || c.type === "component_reference",
              );
              if (exprs.length >= 2) {
                const targetId = lowerCSTExpression(exprs[0], dae, prefix, substitutions);
                const valId = lowerCSTExpression(exprs[1], dae, prefix, substitutions);
                dae.addStatement(StmtKind.Assignment, targetId, valId);
              }
              return;
            }

            if (sNode.type === "when_statement" || sNode.type === "WhenStatement") {
              const condNode = sNode.childForFieldName ? sNode.childForFieldName("condition") : null;
              const cond =
                condNode ?? (sNode.children || []).find((c: any) => c.type === "expression" || c.type === "Expression");
              const condId = cond ? lowerCSTExpression(cond, dae, prefix, substitutions) : -1;

              let inThen = false;
              let inElseWhen = false;
              const thenStmts: any[] = [];
              const elseWhenList: { condNode: any; stmts: any[] }[] = [];
              let currEw: { condNode: any; stmts: any[] } | null = null;

              for (const child of sNode.children || []) {
                const t = child.text?.trim() ?? "";
                const ty = child.type ?? "";
                if (t === "then" || ty === '"then"') {
                  if (!inElseWhen) inThen = true;
                  continue;
                }
                if (t === "elsewhen" || ty === '"elsewhen"') {
                  inThen = false;
                  inElseWhen = true;
                  currEw = { condNode: null, stmts: [] };
                  elseWhenList.push(currEw);
                  continue;
                }
                if (t === "end when" || ty === '"end when"') {
                  inThen = false;
                  inElseWhen = false;
                  break;
                }
                if (inElseWhen && currEw) {
                  if (!currEw.condNode && (child.type === "expression" || child.type === "Expression")) {
                    currEw.condNode = child;
                  } else if (child.type !== ";" && child.text?.trim() !== ";") {
                    currEw.stmts.push(...extractExecutableStmts(child));
                  }
                } else if (inThen) {
                  if (child.type !== ";" && child.text?.trim() !== ";") {
                    thenStmts.push(...extractExecutableStmts(child));
                  }
                }
              }

              dae.addStatement(StmtKind.When, condId, thenStmts.length, elseWhenList.length);
              for (const s of thenStmts) {
                lowerStatement(s);
              }
              for (const ew of elseWhenList) {
                const ewCondId = ew.condNode ? lowerCSTExpression(ew.condNode, dae, prefix, substitutions) : -1;
                dae.addStatement(StmtKind.Block, ewCondId, ew.stmts.length);
                for (const s of ew.stmts) {
                  lowerStatement(s);
                }
              }
              return;
            }

            for (const child of sNode.children || []) {
              if (
                child.type === "statement" ||
                child.type === "assignment_statement" ||
                child.type === "when_statement"
              ) {
                lowerStatement(child);
              }
            }
          };

          for (const stmt of node.children || []) {
            if (stmt.type === "statement" || stmt.type === "assignment_statement" || stmt.type === "when_statement") {
              lowerStatement(stmt);
            }
          }
          if (dae.stmtCount > secStart) {
            dae.algorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
          }
          return;
        }

        if (node.type === "composition" || node.type === "Composition") {
          const eqSections: any[] = [];
          const otherChildren: any[] = [];
          for (const kid of node.children || []) {
            if (kid.type === "equation_section" || kid.type === "EquationSection") {
              eqSections.push(kid);
            } else {
              otherChildren.push(kid);
            }
          }
          if (eqSections.length > 1) {
            eqSections.reverse();
          }
          for (const eqSec of eqSections) {
            walk(eqSec, substitutions);
          }
          for (const other of otherChildren) {
            walk(other, substitutions);
          }
          return;
        }

        for (const kid of node.children || []) {
          if (kid.type !== "class_definition" && kid.type !== "ClassDefinition") {
            walk(kid, substitutions);
          }
        }
      };
      walk(cst);
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseTargets = this.db.byName(child.name);
        for (const target of baseTargets) {
          if (target.kind === "Class") {
            this.extractClassEquations(target.id, prefix, dae);
          }
        }
      } else if (child.kind === "Component") {
        let compClassId = this.db.query<SymbolId | null>("classInstance", child.id);
        if (!compClassId) {
          const typeSpec = (child.metadata as any)?.typeSpecifier ?? (child.metadata as any)?.type_specifier;
          if (typeSpec) {
            const targets = this.db.byName(typeSpec);
            if (targets.length > 0 && targets[0].kind === "Class") {
              compClassId = targets[0].id;
            }
          }
        }
        if (compClassId !== null) {
          const compClassSym = this.db.symbol(compClassId);
          if (
            compClassSym &&
            compClassSym.kind === "Class" &&
            (compClassSym.metadata as any)?.classKind !== "type" &&
            !(compClassSym.metadata as any)?.isEnum &&
            !isPredefinedType(compClassSym)
          ) {
            const childPrefix = prefix ? `${prefix}.${child.name}` : child.name;
            const arrayDims = this.db.query<number[] | null>("resolvedArrayDimensions", child.id);
            if (arrayDims && arrayDims.length > 0) {
              const indices = generateArrayIndices(arrayDims);
              for (const indexStr of indices) {
                this.extractClassEquations(compClassId, `${childPrefix}${indexStr}`, dae);
              }
            } else {
              this.extractClassEquations(compClassId, childPrefix, dae);
            }
          }
        }
      }
    }
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };
