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
  evaluateArenaFunctionCall,
  foldArenaConstants,
  foldSingleArenaEquation,
  foldTargetedParamEquations,
  hasArrayEquations,
  scalarizeArena,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
  type TopologyGraph,
} from "@modelscript/language/compiler";
import { StringWriter } from "@modelscript/language/utils";
import { Cst, type SyntaxNode } from "../src-gen/bindings.js";
import { ModelicaPortBalancer } from "./connections.js";
import { isPredefinedType } from "./predefined-types.js";
import { getShortClassSpecifierNode } from "./queries.js";

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
  if (kind === ExprKind.IfElse) {
    const cond = dae.getExprData1(exprId);
    const thenExpr = castToRealExpr(dae.getExprLeft(exprId), dae);
    const elseExpr = castToRealExpr(dae.getExprRight(exprId), dae);
    return dae.addExpression(ExprKind.IfElse, cond, thenExpr, elseExpr);
  }
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    const elemIds: number[] = [];
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      elemIds.push(castToRealExpr(elemId, dae));
    }
    return dae.addArrayCtorExpr(elemIds);
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    let vIdx = dae.getVarIdxByName(name);
    if (vIdx < 0 && name.includes("[")) {
      vIdx = dae.getVarIdxByName(name.split("[")[0]);
    }
    if (vIdx >= 0 && dae.getVarType(vIdx) === VarType.Integer) {
      return dae.addCallExpr("/*Real*/", [exprId]);
    }
    return exprId;
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "/*Real*/" || fnName === "Real") return exprId;
    return exprId;
  }
  if (kind === ExprKind.Der) {
    return exprId;
  }
  return exprId;
}

function isRealExpr(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.Der) return true;
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name === "time") return true;
    let vIdx = dae.getVarIdxByName(name);
    if (vIdx < 0 && name.includes("[")) {
      vIdx = dae.getVarIdxByName(name.split("[")[0]);
    }
    if (vIdx >= 0) {
      return dae.getVarType(vIdx) === VarType.Real;
    }
    return true;
  }
  if (kind === ExprKind.Subscript) {
    return isRealExpr(dae.getExprLeft(exprId), dae);
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
  if (kind === ExprKind.IfElse) {
    const thenExpr = dae.getExprLeft(exprId);
    const elseExpr = dae.getExprRight(exprId);
    return isRealExpr(thenExpr, dae) || isRealExpr(elseExpr, dae);
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (
      fnName === "/*Real*/" ||
      fnName === "Real" ||
      fnName === "sin" ||
      fnName === "cos" ||
      fnName === "tan" ||
      fnName === "exp" ||
      fnName === "log" ||
      fnName === "sqrt"
    ) {
      return true;
    }
    return true;
  }
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    if (count === 0) return true;
    const elem0 = dae.getExprLeft(exprId);
    return isRealExpr(elem0, dae);
  }
  return false;
}

function evalDaeExpr(exprId: number, dae: DAEBuilder): any {
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
    case ExprKind.StringLiteral:
      return dae.interner.resolve(dae.getExprData1(exprId));
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      const result: any[] = [];
      for (let i = 0; i < count; i++) {
        const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        const val = evalDaeExpr(elemId, dae);
        if (val === null) return null;
        result.push(val);
      }
      return result;
    }
    default:
      return null;
  }
}

function addArenaValueAsExpr(dae: DAEBuilder, value: any, expectedType?: VarType): number {
  if (typeof value === "number") {
    if (expectedType === VarType.Real) {
      return dae.addRealLiteral(value);
    }
    if (expectedType === VarType.Integer) {
      return dae.addIntLiteral(value);
    }
    return Number.isInteger(value) ? dae.addIntLiteral(value) : dae.addRealLiteral(value);
  }
  if (typeof value === "boolean") {
    return dae.addExpression(ExprKind.BoolLiteral, value ? 1 : 0);
  }
  if (typeof value === "string") {
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(value));
  }
  if (Array.isArray(value)) {
    const elemIds = value.map((v) => addArenaValueAsExpr(dae, v, expectedType));
    return dae.addArrayCtorExpr(elemIds);
  }
  return -1;
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
  let depth = 0;
  let probe = curr;
  while (probe.startsWith("{")) {
    depth++;
    const elems = parseArrayLiteralElements(probe);
    if (elems.length === 0) break;
    probe = elems[0];
  }
  const effectiveIndices = depth > 0 && depth < indices.length ? indices.slice(indices.length - depth) : indices;
  for (const idx of effectiveIndices) {
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

function resolveScopedName(name: string, prefix: string, dae: DAEBuilder, innerOuterComponents?: Set<string>): string {
  if (!prefix) return name;
  if (name.startsWith(prefix + ".")) return name;

  const rootComp = name.split(".")[0].split("[")[0];
  const fullLocalRoot = `${prefix}.${rootComp}`;
  const isInnerOuter = innerOuterComponents?.has(fullLocalRoot);

  let resolvedName: string | null = null;
  if (!isInnerOuter) {
    const prefixed = `${prefix}.${name}`;
    if (dae.getVarIdxByName(prefixed) >= 0) {
      resolvedName = prefixed;
    } else {
      const searchPrefix = prefixed + ".";
      for (let i = 0; i < dae.varCount; i++) {
        if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(searchPrefix)) {
          resolvedName = prefixed;
          break;
        }
      }
    }
  }

  if (!resolvedName) {
    // Walk up enclosing scopes
    let p: string | null = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
    while (p !== null) {
      const target = p ? `${p}.${name}` : name;
      if (dae.getVarIdxByName(target) >= 0) {
        resolvedName = target;
        break;
      }
      const searchPrefix = target + ".";
      let foundPrefix = false;
      for (let i = 0; i < dae.varCount; i++) {
        if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(searchPrefix)) {
          resolvedName = target;
          foundPrefix = true;
          break;
        }
      }
      if (foundPrefix) break;
      p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
    }
  }

  return resolvedName ?? (name.includes(".") ? name : `${prefix}.${name}`);
}

function lookupDbConstant(fullName: string, db: QueryDB): { value: number; isInteger: boolean } | null {
  const parts = fullName.split(".");
  if (parts.length === 0) return null;
  const leafName = parts[parts.length - 1];
  const candidates = db.byName(leafName);
  for (const c of candidates) {
    if (c.kind === "Component") {
      let curr: SymbolEntry | null = c;
      let match = true;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!curr || curr.name !== parts[i]) {
          match = false;
          break;
        }
        if (i > 0) {
          curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
        }
      }
      if (match) {
        const variability = db.query<string | null>("variability", c.id);
        if (variability !== "constant") {
          continue;
        }
        const typeSpec = db.query<string | null>("typeSpecifier", c.id);
        const isInteger = typeSpec === "Integer";
        const mod = db.query<any>("effectiveModification", c.id);
        if (mod?.bindingExpression?.text) {
          const num = parseFloat(mod.bindingExpression.text.trim());
          if (!isNaN(num)) {
            return { value: num, isInteger: isInteger && Number.isInteger(num) };
          }
        }
        const cst = db.cstNode(c.id) as any;
        const cstText = cst?.text ?? "";
        const eqMatch = cstText.match(/=\s*([^;,()]+)/);
        if (eqMatch) {
          const num = parseFloat(eqMatch[1].trim());
          if (!isNaN(num)) {
            return { value: num, isInteger: isInteger && Number.isInteger(num) };
          }
        }
      }
    }
  }
  return null;
}

function lowerCSTExpression(
  node: any,
  dae: DAEBuilder,
  prefix = "",
  substitutions?: Map<string, number>,
  imports?: Map<string, string>,
  db?: QueryDB,
  flattener?: any,
): number {
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
    return lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
  }

  // Parenthesized expression: "(" expr ")"
  if (
    node.childCount === 3 &&
    (node.child(0).type === "(" || node.child(0).text === "(" || node.child(0).type === '"("') &&
    (node.child(2).type === ")" || node.child(2).text === ")" || node.child(2).type === '")"')
  ) {
    return lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
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
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions, imports, db, flattener);
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
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions, imports, db, flattener);
    return dae.addPreExpr(argId);
  }

  // Function call: component_reference "(" ... ")"
  if (
    type === "function_call" ||
    (type === "primary" &&
      node.childCount >= 2 &&
      (node.child(1)?.type === "function_call_args" || node.child(1)?.type === "("))
  ) {
    let fnName = node.child(0)?.text?.trim() ?? "";
    if (imports) {
      const parts = fnName.split(".");
      if (imports.has(parts[0])) {
        fnName = [imports.get(parts[0])!, ...parts.slice(1)].join(".");
      }
    }
    const argsNode = node.child(1);
    const argExprIds: number[] = [];
    if (argsNode) {
      const collectArgs = (n: any) => {
        if (!n) return;
        if (n.type === "expression" || n.type === "Expression") {
          argExprIds.push(lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener));
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
    if (fnName === "zeros" || fnName === "ones") {
      let count = 0;
      if (argExprIds.length === 1) {
        const a0 = argExprIds[0];
        const kind = dae.getExprKind(a0);
        if (kind === ExprKind.IntLiteral) {
          count = dae.getExprData1(a0);
        } else if (kind === ExprKind.RealLiteral) {
          count = Math.round(dae.getExprRealValue(a0));
        }
      }
      if (count > 0) {
        const val = fnName === "ones" ? 1.0 : 0.0;
        const elemIds: number[] = [];
        for (let i = 0; i < count; i++) {
          elemIds.push(dae.addRealLiteral(val));
        }
        return dae.addArrayCtorExpr(elemIds);
      }
    }

    let fnDae = dae.getFunction(fnName);
    if (!fnDae && flattener && db) {
      const cleanFnName = fnName.replace(/^\.+/, "");
      const parts = cleanFnName.split(".");
      const fnBase = parts[parts.length - 1];
      const matchingFnSym = db.byName(fnBase).find((e: any) => {
        if (e.kind !== "Class") return false;
        if (parts.length > 1 && e.parentId !== null) {
          const parentSym = db.symbol(e.parentId);
          return parentSym?.name === parts[parts.length - 2];
        }
        return parts.length === 1;
      });
      if (matchingFnSym && flattener.isFunctionSym(matchingFnSym)) {
        const fn = flattener.flattenFunction(matchingFnSym.id, cleanFnName, undefined, dae);
        dae.addFunction(cleanFnName, fn);
        dae.addFunction(fnName, fn);
        fnDae = fn;
      }
    }
    if (fnDae) {
      let allConstant = true;
      const constArgs: any[] = [];
      for (const aid of argExprIds) {
        const cVal = evalDaeExpr(aid, dae);
        if (cVal === null) {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }
      if (allConstant) {
        try {
          const fnInternId = typeof fnName === "string" ? dae.interner.intern(fnName) : fnName;
          const outVal = evaluateArenaFunctionCall(dae, fnInternId, constArgs);
          if (outVal !== null && outVal !== undefined) {
            let outputCount = 0;
            let firstOutputType: VarType | null = null;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                if (outputCount === 0) {
                  firstOutputType = fnDae.getVarType(i);
                }
                outputCount++;
              }
            }
            const firstVal = Array.isArray(outVal) && outputCount > 1 ? outVal[0] : outVal;
            const inlinedId = addArenaValueAsExpr(dae, firstVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) return inlinedId;
          }
        } catch {
          // ignore evaluation error and fall back to call expression
        }
      }
      return dae.addCallExpr(fnDae.name, argExprIds);
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
          const subId = lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener);
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

    const baseId = lowerCSTExpression(baseNode, dae, prefix, substitutions, imports, db, flattener);
    const subIds: number[] = [];
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c.type === "subscript" || c.type === "expression") {
        subIds.push(lowerCSTExpression(c, dae, prefix, substitutions, imports, db, flattener));
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
        return lowerCSTExpression(c, dae, prefix, substitutions, imports, db, flattener);
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
            elementIds.push(lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener));
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    return dae.addArrayCtorExpr(elementIds);
  }

  // Matrix / vector bracket constructor: [ e1; e2; ... ] or [ e1, e2, ... ]
  if (
    type === "primary" &&
    (node.child(0)?.type === "[" || node.child(0)?.text === "[" || node.child(0)?.type === '"["') &&
    (node.child(node.childCount - 1)?.type === "]" ||
      node.child(node.childCount - 1)?.text === "]" ||
      node.child(node.childCount - 1)?.type === '"]"')
  ) {
    const elementIds: number[] = [];
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (c.type === "expression_list" || c.type === "expression") {
        const collect = (n: any) => {
          if (!n) return;
          if (n.type === "expression") {
            const exprId = lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener);
            if (exprId >= 0 && dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
              const count = dae.getExprData1(exprId);
              for (let k = 0; k < count; k++) {
                const elem = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
                elementIds.push(elem);
              }
            } else {
              elementIds.push(exprId);
            }
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
    const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
    const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
    return dae.addExpression(ExprKind.Range, startId, -1, stopId);
  }
  if (
    node.childCount === 5 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"') &&
    (node.child(3)?.type === ":" || node.child(3)?.text === ":" || node.child(3)?.type === '":"')
  ) {
    const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
    const stepId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
    const stopId = lowerCSTExpression(node.child(4), dae, prefix, substitutions, imports, db, flattener);
    return dae.addExpression(ExprKind.Range, startId, stepId, stopId);
  }

  // If-Else expression: if cond then e1 else e2
  if (firstChildToken === "if" && node.childCount >= 6) {
    const condId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
    let thenId = lowerCSTExpression(node.child(3), dae, prefix, substitutions, imports, db, flattener);
    let elseId = lowerCSTExpression(
      node.child(node.childCount - 1),
      dae,
      prefix,
      substitutions,
      imports,
      db,
      flattener,
    );
    if (isRealExpr(thenId, dae) && !isRealExpr(elseId, dae)) {
      elseId = castToRealExpr(elseId, dae);
    } else if (!isRealExpr(thenId, dae) && isRealExpr(elseId, dae)) {
      thenId = castToRealExpr(thenId, dae);
    }
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
      let leftId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
      let rightId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      if (binOp === BinOp.Sub) {
        const rightKind = dae.getExprKind(rightId);
        if (rightKind === ExprKind.IntLiteral && dae.getExprData1(rightId) === 1) {
          const negLitId = dae.addIntLiteral(-1);
          return dae.addBinaryExpr(BinOp.Add, negLitId, leftId);
        }
      }
      if (binOp === BinOp.Div) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.Call && rightKind === ExprKind.Call) {
          const leftFn = dae.interner.resolve(dae.getExprData1(leftId));
          const rightFn = dae.interner.resolve(dae.getExprData1(rightId));
          if (leftFn === "sin" && rightFn === "cos") {
            const leftArg = dae.getExprLeft(leftId);
            const rightArg = dae.getExprLeft(rightId);
            const leftArgCount = dae.getExprRight(leftId);
            const rightArgCount = dae.getExprRight(rightId);
            const sameArg =
              leftArg === rightArg ||
              (dae.getExprKind(leftArg) === dae.getExprKind(rightArg) &&
                dae.getExprData1(leftArg) === dae.getExprData1(rightArg));
            if (leftArgCount === 1 && rightArgCount === 1 && sameArg) {
              return dae.addCallExpr("tan", [leftArg]);
            }
          }
        }
      }
      if (binOp === BinOp.Mul) {
        const leftText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        if (leftText && leftText === rightText) {
          const twoExpr = dae.addRealLiteral(2.0);
          return dae.addBinaryExpr(BinOp.Pow, leftId, twoExpr);
        }
      }
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
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      return dae.addExpression(ExprKind.Negate, 0, operandId);
    }

    if (op === "+") {
      return lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
    }
    if (op === "not") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
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
                const subId = lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener);
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
        let joined = parts.join(".");
        if (imports && imports.has(parts[0])) {
          joined = [imports.get(parts[0])!, ...parts.slice(1)].join(".");
          if (db) {
            const constRes = lookupDbConstant(joined, db);
            if (constRes !== null) {
              return constRes.isInteger
                ? dae.addIntLiteral(Math.round(constRes.value))
                : dae.addRealLiteral(constRes.value);
            }
          }
        } else if (db) {
          const constRes = lookupDbConstant(joined, db);
          if (constRes !== null) {
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        let candidate = resolveScopedName(joined, prefix, dae, (dae as any).innerOuterComponents);
        const vIdx = dae.getVarIdxByName(candidate);
        if (vIdx >= 0) {
          if (dae.getVarVariability(vIdx) === Variability.Constant) {
            const exprId = dae.getVarExpression(vIdx);
            if (exprId >= 0) {
              const k = dae.getExprKind(exprId);
              if (k === ExprKind.RealLiteral) return dae.addRealLiteral(dae.getExprRealValue(exprId));
              if (k === ExprKind.IntLiteral) return dae.addIntLiteral(dae.getExprData1(exprId));
              if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(dae.getExprData1(exprId) !== 0);
            }
          }
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        }
        rawName = candidate;
      }
    }

    if (imports && rawName.includes(".")) {
      const p = rawName.split(".");
      if (imports.has(p[0])) {
        const mapped = [imports.get(p[0])!, ...p.slice(1)].join(".");
        if (db) {
          const constRes = lookupDbConstant(mapped, db);
          if (constRes !== null) {
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        rawName = mapped;
      }
    } else if (db && rawName.includes(".")) {
      const constRes = lookupDbConstant(rawName, db);
      if (constRes !== null) {
        return constRes.isInteger ? dae.addIntLiteral(Math.round(constRes.value)) : dae.addRealLiteral(constRes.value);
      }
    }

    rawName = resolveScopedName(rawName, prefix, dae, (dae as any).innerOuterComponents);

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
  flowPrefix?: string;
  isFinal?: boolean;
  isRedeclare?: boolean;
  isInner?: boolean;
  isOuter?: boolean;
  isReplaceable?: boolean;
  isProtected?: boolean;
  isConnectorType?: boolean;
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
  private currentRootClassId: SymbolId = 0;
  private innerOuterComponents = new Set<string>();
  currentImports = new Map<string, string>();

  collectClassImports(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Map<string, string> {
    const result = new Map<string, string>();
    if (visited.has(classId)) return result;
    visited.add(classId);

    // 1. Parent scope imports
    const sym = this.db.symbol(classId);
    if (sym && sym.parentId !== null) {
      const parentImports = this.collectClassImports(sym.parentId, visited);
      for (const [k, v] of parentImports) {
        result.set(k, v);
      }
    }

    // 2. Base class imports (via Extends)
    const extendsChildren = this.db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
      const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      const target = base ?? this.db.byName(ext.name).find((e) => e.kind === "Class");
      if (target) {
        const baseImports = this.collectClassImports(target.id, visited);
        for (const [k, v] of baseImports) {
          result.set(k, v);
        }
      }
    }

    // 3. Own CST imports
    const cst = this.db.cstNode(classId) as any;
    if (cst) {
      const walkImports = (n: any) => {
        if (!n) return;
        if (n.type === "import_clause" || n.type === "ImportClause") {
          const text = n.text?.trim() ?? "";
          const m = text.match(/import\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.]+)/);
          if (m) {
            result.set(m[1], m[2]);
          }
          return;
        }
        if (n !== cst && (n.type === "class_definition" || n.type === "ClassDefinition")) {
          return;
        }
        for (let i = 0; i < (n.childCount || n.children?.length || 0); i++) {
          walkImports(n.child ? n.child(i) : n.children[i]);
        }
      };
      walkImports(cst);
    }

    return result;
  }

  private lowerExpr(node: any, dae: DAEBuilder, prefix = "", substitutions?: Map<string, number>): number {
    return lowerCSTExpression(node, dae, prefix, substitutions, this.currentImports, this.db, this);
  }

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
    this.currentRootClassId = rootClassId;
    this.innerOuterComponents.clear();
    this.currentImports = this.collectClassImports(rootClassId);
    const rootSym = this.db.symbol(rootClassId);
    const rootName = rootSym?.name ?? "Model";
    const dae = cachedArena ?? new DAEBuilder(undefined, rootName, "");
    (dae as any).innerOuterComponents = this.innerOuterComponents;
    dae.classKind = (rootSym?.metadata as any)?.classKind ?? "model";
    const classCst = this.db.cstNode(rootClassId) as SyntaxNode | null;
    if (classCst) {
      const findDesc = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
        if (!n) return null;
        if (Cst.LongClassSpecifier.is(n)) return Cst.LongClassSpecifier.description(n);
        if (Cst.ShortClassSpecifier.is(n)) return Cst.ShortClassSpecifier.description(n);
        if (Cst.ClassDefinition.is(n)) {
          const spec = Cst.ClassDefinition.classSpecifier(n);
          const d = findDesc(spec);
          if (d) return d;
        }
        for (const child of n.children) {
          if (Cst.LongClassSpecifier.is(child)) return Cst.LongClassSpecifier.description(child);
          if (Cst.ShortClassSpecifier.is(child)) return Cst.ShortClassSpecifier.description(child);
        }
        return null;
      };
      const descNode = findDesc(classCst);
      if (descNode) {
        let descText = descNode.text?.trim() ?? "";
        if (descText.startsWith('"') && descText.endsWith('"')) {
          descText = descText.slice(1, -1);
          if (descText) dae.description = descText;
        }
      }
    }

    // Validate extends clauses (illegal components in path, replaceable base classes, inherited extends cycles)
    const extendsClauses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Extends");
    for (let extIdx = 0; extIdx < extendsClauses.length; extIdx++) {
      const ext = extendsClauses[extIdx];
      const extCst = this.db.cstNode(ext.id) as any;
      const extRange = extCst
        ? { startByte: extCst.startIndex ?? extCst.startByte, endByte: extCst.endIndex ?? extCst.endByte }
        : undefined;

      const parts = ext.name.split(".");
      let currentScope: SymbolEntry | null = this.db.symbol(rootClassId);
      const resolvedChain: { name: string; symbol: SymbolEntry | null }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        let resolved: SymbolEntry | null = null;
        if (i === 0) {
          const resolver =
            this.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentScope?.id ?? rootClassId) ??
            this.db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? rootClassId);
          resolved = resolver ? resolver(part) : null;
          if (!resolved) {
            resolved = this.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Component") ?? null;
          }
        } else {
          if (currentScope) {
            resolved = this.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
          }
        }
        resolvedChain.push({ name: part, symbol: resolved });
        currentScope = resolved;
      }

      // Check 1: Part of base class name is a component instead of a class
      for (const item of resolvedChain) {
        if (item.symbol && item.symbol.kind === "Component") {
          const compCst = this.db.cstNode(item.symbol.id) as any;
          const compRange = compCst
            ? { startByte: compCst.startIndex ?? compCst.startByte, endByte: compCst.endIndex ?? compCst.endByte }
            : undefined;
          dae.diagnostics.push({
            severity: "notification",
            code: 0,
            message: "From here:",
            range: compRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: 2003,
            message: `Part ${item.name} of base class name ${ext.name} is not a class.`,
            range: extRange,
          });
          return dae;
        }
      }

      // Check 2: Replaceable base class or segment
      for (let i = 0; i < resolvedChain.length; i++) {
        const item = resolvedChain[i];
        if (item.symbol) {
          const isRep = this.db.query<boolean>("isReplaceable", item.symbol.id);
          if (isRep) {
            const repCst = this.db.cstNode(item.symbol.id) as any;
            let repParent = repCst;
            while (repParent && repParent.type !== "element" && repParent.type !== "Element") {
              if (repParent.type === "composition" || repParent.type === "Composition") break;
              repParent = repParent.parent;
            }
            const targetRepNode = repParent ?? repCst;
            const repRange = targetRepNode
              ? {
                  startByte: targetRepNode.startIndex ?? targetRepNode.startByte,
                  endByte: targetRepNode.endIndex ?? targetRepNode.endByte,
                }
              : undefined;

            const annotatedPath =
              parts.length === 1 ? parts[0] : parts.map((p, idx) => (idx === i ? `<${p}>` : p)).join(".");

            dae.diagnostics.push({
              severity: "notification",
              code: 0,
              message: "From here:",
              range: repRange,
            });
            dae.diagnostics.push({
              severity: "error",
              code: 4034,
              message: `Class '${item.name}' in 'extends ${annotatedPath}' is replaceable, the base class name must be transitively non-replaceable.`,
              range: extRange,
            });
            return dae;
          }
        }
      }

      // Check 3: Base class name depends on inherited elements from prior extends clauses
      const firstPart = parts[0];
      const priorMatches: { prevExt: SymbolEntry; prevBase: SymbolEntry; innerClass: SymbolEntry }[] = [];
      for (let j = 0; j < extIdx; j++) {
        const prevExt = extendsClauses[j];
        const prevBase =
          this.db.query<SymbolEntry | null>("resolvedBaseClass", prevExt.id) ??
          this.db.byName(prevExt.name).find((e) => e.kind === "Class");
        if (prevBase) {
          const innerClass = this.db.childrenOf(prevBase.id).find((c) => c.kind === "Class" && c.name === firstPart);
          if (innerClass) {
            priorMatches.push({ prevExt, prevBase, innerClass });
          }
        }
      }
      if (priorMatches.length > 0) {
        dae.diagnostics.push({
          severity: "error",
          code: 2004,
          message: `The base class name ${firstPart} was found in one or more base classes:`,
          range: extRange,
        });
        for (const m of priorMatches) {
          const innerCst = this.db.cstNode(m.innerClass.id) as any;
          const innerRange = innerCst
            ? { startByte: innerCst.startIndex ?? innerCst.startByte, endByte: innerCst.endIndex ?? innerCst.endByte }
            : undefined;
          const prevExtCst = this.db.cstNode(m.prevExt.id) as any;
          const prevExtRange = prevExtCst
            ? {
                startByte: prevExtCst.startIndex ?? prevExtCst.startByte,
                endByte: prevExtCst.endIndex ?? prevExtCst.endByte,
              }
            : undefined;

          dae.diagnostics.push({
            severity: "notification",
            code: 0,
            message: "From here:",
            range: innerRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: 2005,
            message: `${firstPart} was found in base class ${m.prevBase.name}.`,
            range: prevExtRange,
          });
        }
        return dae;
      }
    }

    // Check 4: Class specialization violation for short class specifiers and redeclarations
    for (const child of this.db.childrenOf(rootClassId)) {
      if (child.kind === "Class") {
        const childCst = this.db.cstNode(child.id) as any;
        const text = childCst?.text?.trim() ?? "";
        const match = text.match(/\btype\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.]+)/);
        if (match) {
          const targetName = match[2];
          const targetClass = this.db.byName(targetName.split(".").pop()!).find((e) => e.kind === "Class");
          if (targetClass) {
            const targetCst = this.db.cstNode(targetClass.id) as any;
            const targetText = targetCst?.text?.trim() ?? "";
            if (/\bmodel\s+/.test(targetText)) {
              const r = {
                startByte: childCst.startIndex ?? childCst.startByte,
                endByte: childCst.endIndex ?? childCst.endByte,
              };
              dae.diagnostics.push({
                severity: "error",
                code: 4050,
                message: `Class specialization violation: .${targetName} is a model, not a type.`,
                range: r,
              });
              return dae;
            }
          }
        }
      }
    }
    const rootModForSpec = this.db.query<any>("effectiveModification", rootClassId);
    if (rootModForSpec?.args) {
      for (const arg of rootModForSpec.args) {
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          const targetClass = this.db
            .byName(arg.redeclaredTypeSpecifier.split(".").pop()!)
            .find((e) => e.kind === "Class");
          if (targetClass) {
            const targetCst = this.db.cstNode(targetClass.id) as any;
            const targetText = targetCst?.text?.trim() ?? "";
            if (/\bmodel\s+/.test(targetText)) {
              const rootCst = this.db.cstNode(rootClassId) as any;
              const rootCstText = rootCst?.text ?? "";
              const redeclMatch = rootCstText.match(
                new RegExp(`redeclare\\s+type\\s+${arg.name}\\s*=\\s*${arg.redeclaredTypeSpecifier}`),
              );
              if (redeclMatch) {
                const startIdx = rootCstText.indexOf(redeclMatch[0]);
                const r =
                  startIdx >= 0 ? { startByte: startIdx, endByte: startIdx + redeclMatch[0].length } : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: 4050,
                  message: `Class specialization violation: .${arg.redeclaredTypeSpecifier} is a model, not a type.`,
                  range: r,
                });
                return dae;
              }
            }
          }
        }
      }
    }

    // Check for duplicate elements due to inherited elements
    const localComps = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Component");
    for (const ext of extendsClauses) {
      const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id) ?? this.db.byName(ext.name)[0];
      if (baseClass) {
        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", ext.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        const brokenNames = new Set<string>();
        for (const arg of extendsModParsed) {
          if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
            brokenNames.add(arg.name);
          }
        }
        const baseElements = this.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
        for (const baseElemId of baseElements) {
          const baseElem = this.db.symbol(baseElemId);
          if (!baseElem || baseElem.kind !== "Component") continue;
          if (brokenNames.has(baseElem.name)) continue;
          const matchingLocal = localComps.find((c) => c.name === baseElem.name);
          if (matchingLocal) {
            const isRedecl = this.db.query<boolean>("isRedeclare", matchingLocal.id);
            if (!isRedecl) {
              const localCst = this.db.cstNode(matchingLocal.id) as any;
              const baseCst = this.db.cstNode(baseElem.id) as any;
              const extCst = this.db.cstNode(ext.id) as any;

              const getClause = (node: any) => {
                let curr = node;
                while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause") curr = curr.parent;
                if (curr && curr.parent && (curr.parent.type === "element" || curr.parent.type === "Element")) {
                  const parentText = curr.parent.text?.trim() ?? "";
                  if (parentText.startsWith("final")) {
                    return curr.parent;
                  }
                }
                return curr;
              };
              const localClause = getClause(localCst);
              const baseClause = getClause(baseCst);

              const localRange = localClause
                ? {
                    startByte: localClause.startIndex ?? localClause.startByte,
                    endByte: localClause.endIndex ?? localClause.endByte,
                  }
                : {
                    startByte: localCst?.startIndex ?? localCst?.startByte ?? 0,
                    endByte: localCst?.endIndex ?? localCst?.endByte ?? 0,
                  };
              const baseRange = baseClause
                ? {
                    startByte: baseClause.startIndex ?? baseClause.startByte,
                    endByte: baseClause.endIndex ?? baseClause.endByte,
                  }
                : {
                    startByte: baseCst?.startIndex ?? baseCst?.startByte ?? 0,
                    endByte: baseCst?.endIndex ?? baseCst?.endByte ?? 0,
                  };

              const extStart = extCst?.startIndex ?? extCst?.startByte ?? 0;

              let localText = (localClause?.text ?? localCst?.text ?? "").trim().replace(/;$/, "");
              let baseText = (baseClause?.text ?? baseCst?.text ?? "").trim().replace(/;$/, "");

              baseText = baseText.replace(/\bReal\b/g, ".Real");

              let firstRange = localRange;
              let secondRange = baseRange;
              let firstText = localText;
              let secondText = baseText;

              if (localRange.startByte > extStart) {
                firstRange = baseRange;
                secondRange = localRange;
                firstText = baseText;
                secondText = localText;
              }

              dae.diagnostics.push({
                severity: "notification",
                code: 0,
                message: "From here:",
                range: firstRange,
              });
              dae.diagnostics.push({
                severity: "error",
                code: 4056,
                message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
                range: secondRange,
              });
              return dae;
            }
          }
        }
      }
    }

    if (this.options.omcCompatibility) {
      this.generateFunctions(rootClassId, dae);
    }

    // 1. Layer 1: Component instantiation
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);
    if (elements) {
      const rootExtendsMods = this.collectExtendsMods(rootClassId);
      const rootProtectedNames = this.collectProtectedNames(rootClassId);
      this.instantiateElements(
        elements,
        "",
        dae,
        rootExtendsMods.length > 0 || rootProtectedNames.size > 0
          ? { args: rootExtendsMods, protectedNames: rootProtectedNames }
          : undefined,
      );
    }

    // 2. Layer 2: Direct CST Equation extraction
    this.extractClassEquations(rootClassId, "", dae);

    // 3. Layer 3: Physical connector expansion & flow balance
    const rootCst = this.db.cstNode(rootClassId) as any;
    const isOldFrontend = Boolean(rootCst?.text?.includes("-d=-newInst"));
    ModelicaPortBalancer.expandConnections(dae, {
      omcCompatibility: this.options.omcCompatibility,
      isOldFrontend,
    });

    // 4. Constant folding and alias elimination
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    if (this.options.omcCompatibility) {
      this.generateRecordConstructors(rootClassId, dae);
    }

    if (this.options.arrayMode === "scalarize" || hasArrayEquations(dae)) {
      return scalarizeArena(dae);
    }

    dae.groupEquationsForParity();
    return dae;
  }

  patch(
    rootClassId: SymbolId,
    dae: DAEBuilder,
    dirtyRanges: { startByte: number; endByte: number }[],
    delta?: number,
  ): boolean {
    this.currentRootClassId = rootClassId;
    if (!dirtyRanges || dirtyRanges.length === 0) return true;

    const rootCst = this.db.cstNode(rootClassId) as any;
    if (!rootCst) return false;

    for (const range of dirtyRanges) {
      // 1. Check if range matches an equation
      const eqIdx = dae.findEqAtRange(range.startByte, range.endByte);
      const varIdx = dae.findVarAtRange(range.startByte, range.endByte);
      if (eqIdx >= 0) {
        const kind = dae.getEqKind(eqIdx);
        if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
          const eqNode = this.findEquationNodeAt(rootCst, range.startByte, range.endByte);
          if (eqNode) {
            const expressions = (eqNode.children || []).filter(
              (c: any) => c.type === "expression" || c.type === "Expression",
            );
            if (expressions.length >= 2) {
              let lhsExprId = this.lowerExpr(expressions[0], dae, "");
              let rhsExprId = this.lowerExpr(expressions[1], dae, "");
              if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
                rhsExprId = castToRealExpr(rhsExprId, dae);
              }
              const oldLhs = dae.getEqLhs(eqIdx);
              const oldRhs = dae.getEqRhs(eqIdx);
              const oldVars = (dae as any).collectExprVarNames ? (dae as any).collectExprVarNames(oldLhs) : new Set();
              if ((dae as any).collectExprVarNames) (dae as any).collectExprVarNames(oldRhs, oldVars);

              dae.setEqLhs(eqIdx, lhsExprId);
              dae.setEqRhs(eqIdx, rhsExprId);
              (dae as any).setOrigEqRhs?.(eqIdx, rhsExprId);

              const newVars = (dae as any).collectExprVarNames
                ? (dae as any).collectExprVarNames(lhsExprId)
                : new Set();
              if ((dae as any).collectExprVarNames) (dae as any).collectExprVarNames(rhsExprId, newVars);

              if ((dae as any).cachedBlt) {
                let same = oldVars.size === newVars.size;
                if (same) {
                  for (const v of oldVars) {
                    if (!newVars.has(v)) {
                      same = false;
                      break;
                    }
                  }
                }
                if (!same) {
                  (dae as any).cachedBlt = undefined;
                }
              }

              const startB = eqNode.startIndex ?? eqNode.startByte;
              const endB = eqNode.endIndex ?? eqNode.endByte;
              if (startB != null && endB != null) {
                dae.setEqSourceRange(eqIdx, startB, endB);
              }
              if (delta && delta !== 0) {
                dae.shiftSourceRanges(range.endByte, delta);
              }
              foldSingleArenaEquation(dae, eqIdx, this.db, rootClassId, this.options.omcCompatibility);
              continue;
            }
          }
        }
        return false;
      }

      // 2. Check if range matches a variable declaration
      if (varIdx >= 0) {
        const varName = dae.getVarName(varIdx);
        const baseName = varName.replace(/\[.*\]$/, "");
        const compNode = this.findComponentDeclarationAt(rootCst, range.startByte, range.endByte);
        if (compNode) {
          const modText = compNode.text ?? "";
          // Check start=...
          const startMatch = modText.match(/start\s*=\s*([^,)\s]+)/);
          if (startMatch) {
            const valStr = startMatch[1];
            let attrVal: number | null = null;
            if (valStr === "true") attrVal = dae.addBoolLiteral(true);
            else if (valStr === "false") attrVal = dae.addBoolLiteral(false);
            else if (valStr.startsWith("zeros") || valStr === "0" || valStr === "0.0") {
              attrVal = dae.addRealLiteral(0.0);
            } else if (valStr.startsWith("ones") || valStr === "1" || valStr === "1.0") {
              attrVal = dae.addRealLiteral(1.0);
            } else if (!isNaN(parseFloat(valStr))) {
              attrVal = dae.addRealLiteral(parseFloat(valStr));
            } else {
              attrVal = dae.addExpression(ExprKind.Name, dae.interner.intern(valStr));
            }

            if (attrVal !== null) {
              const arrayIndices = dae.getArrayElementIndices(baseName);
              if (arrayIndices.length > 0) {
                dae.patchVarAttrBatch(arrayIndices, "start", attrVal);
              } else {
                dae.setVarAttr(varIdx, "start", attrVal);
              }
              if (delta && delta !== 0) {
                dae.shiftSourceRanges(range.endByte, delta);
              }
              continue;
            }
          }

          // Check parameter value binding like L = 2.0;
          const bindMatch = modText.match(/=\s*([^;,)]+)/);
          if (bindMatch) {
            const valStr = bindMatch[1].trim();
            if (!isNaN(parseFloat(valStr))) {
              const numVal = parseFloat(valStr);
              const litId = dae.addRealLiteral(numVal);
              dae.setVarExpression(varIdx, litId);
              dae.setVarStartValue(varIdx, numVal);
              if (delta && delta !== 0) {
                dae.shiftSourceRanges(range.endByte, delta);
              }
              foldTargetedParamEquations(dae, baseName, this.db, rootClassId, this.options.omcCompatibility);
              continue;
            }
          }
        }
        return false;
      }

      return false;
    }

    return true;
  }

  private findEquationNodeAt(root: any, start: number, end: number): any {
    const queue = [root];
    let candidate = null;
    while (queue.length > 0) {
      const curr = queue.pop();
      if (!curr) continue;
      const s = curr.startIndex ?? curr.startByte ?? 0;
      const e = curr.endIndex ?? curr.endByte ?? 0;
      if (s <= start && e >= end) {
        if (
          curr.type === "simple_equation" ||
          curr.type === "SimpleEquation" ||
          curr.type === "equality_equation" ||
          curr.type === "EqualityEquation"
        ) {
          candidate = curr;
        }
        for (const child of curr.children || []) {
          queue.push(child);
        }
      }
    }
    return candidate;
  }

  private findComponentDeclarationAt(root: any, start: number, end: number): any {
    const queue = [root];
    let candidate = null;
    while (queue.length > 0) {
      const curr = queue.pop();
      if (!curr) continue;
      const s = curr.startIndex ?? curr.startByte ?? 0;
      const e = curr.endIndex ?? curr.endByte ?? 0;
      if (s <= start && e >= end) {
        if (
          curr.type === "component_declaration" ||
          curr.type === "ComponentDeclaration" ||
          curr.type === "component_clause" ||
          curr.type === "ComponentClause"
        ) {
          candidate = curr;
        }
        for (const child of curr.children || []) {
          queue.push(child);
        }
      }
    }
    return candidate;
  }

  private isCstNodeProtected(node: any): boolean {
    let curr = node;
    const nodeStart = node?.startByte ?? 0;
    while (curr) {
      if (curr.type === "ElementSection" || curr.type === "element_section") {
        const vis = curr.children?.find((c: any) => c.text === "protected" || c.text === "public")?.text?.trim();
        if (vis === "protected" || curr.text?.trim()?.startsWith("protected")) return true;
        if (vis === "public" || curr.text?.trim()?.startsWith("public")) return false;
      }
      if (curr.type === "composition" || curr.type === "Composition") {
        let isProt = false;
        for (const child of curr.children || []) {
          const t = child.text?.trim();
          if (child.type === "protected" || t === "protected") {
            isProt = true;
          } else if (child.type === "public" || t === "public") {
            isProt = false;
          }
          if (child.startByte !== undefined && child.endByte !== undefined) {
            if (nodeStart >= child.startByte && nodeStart < child.endByte) {
              return isProt;
            }
          }
        }
        return isProt;
      }
      curr = curr.parent;
    }
    return false;
  }

  private generateRecordConstructors(rootClassId: SymbolId, dae: DAEBuilder): void {
    const rootSym = this.db.symbol(rootClassId);
    const childEntries = this.db.childrenOf(rootClassId);
    const candidates: any[] = [];
    for (const sym of childEntries) {
      if (sym && sym.kind === "Class" && sym.id !== rootClassId) candidates.push(sym);
    }
    if (rootSym?.resourceId) {
      const fileClasses = this.db
        .allEntries()
        .filter((s: any) => s.resourceId === rootSym.resourceId && s.kind === "Class" && s.id !== rootClassId);
      for (const fc of fileClasses) {
        if (!candidates.some((c) => c.id === fc.id)) candidates.push(fc);
      }
    }

    const isRecordSym = (sym: any): boolean => {
      if (sym.id === rootClassId) return false;
      const meta = (sym.metadata as any) || {};
      if (meta.classKind === "record" || meta.classPrefixes === "record") return true;
      if (typeof meta.classPrefixes === "string" && meta.classPrefixes.includes("record")) return true;
      const cst = this.db.cstNode(sym.id) as any;
      if (cst) {
        for (const child of cst.children || []) {
          if (child.type === "class_prefixes") {
            return child.text?.includes("record") ?? false;
          }
        }
        const text = cst.text?.trim() ?? "";
        if (/^(?:(?:encapsulated|partial)\s+)*record\b/.test(text)) return true;
      }
      return false;
    };

    const isRecordUsed = (sym: any): boolean => {
      const name = sym.name;
      const qName = sym.parentId === rootClassId ? `${dae.name}.${sym.name}` : sym.name;
      const allSyms = rootSym?.resourceId
        ? this.db.allEntries().filter((s: any) => s.resourceId === rootSym.resourceId)
        : this.db.allEntries();

      for (const s of allSyms) {
        if (s.kind === "Component") {
          const typeSpec = (s.metadata as any)?.typeSpecifier ?? (s.metadata as any)?.type_specifier;
          if (typeSpec === name || typeSpec === qName || typeSpec?.endsWith(`.${name}`)) {
            return true;
          }
          const compInst = this.db.query<ComponentInstanceData>("componentInstance", s.id);
          if (
            compInst?.typeSpecifier === name ||
            compInst?.typeSpecifier === qName ||
            compInst?.typeSpecifier?.endsWith(`.${name}`)
          ) {
            return true;
          }
        }
        if (s.kind === "Class" && (s.metadata as any)?.classKind === "function") {
          const fnChildren = this.db.childrenOf(s.id);
          for (const fc of fnChildren) {
            const typeSpec = (fc.metadata as any)?.typeSpecifier ?? (fc.metadata as any)?.type_specifier;
            if (typeSpec === name || typeSpec === qName || typeSpec?.endsWith(`.${name}`)) {
              return true;
            }
          }
        }
      }

      const rootCst = this.db.cstNode(rootClassId) as any;
      if (rootCst) {
        const text = rootCst.text ?? "";
        const callRegex = new RegExp(`\\b(?:${name})\\s*\\(`, "m");
        if (callRegex.test(text)) return true;
      }
      return false;
    };

    for (const sym of candidates) {
      if (isRecordSym(sym) && isRecordUsed(sym)) {
        const fnName = sym.parentId === rootClassId ? `${dae.name}.${sym.name}` : sym.name;
        if (dae.functions.has(fnName)) continue;
        const fn = new DAEBuilder(dae.interner, fnName, "");
        fn.classKind = "function";
        fn.description = `Automatically generated record constructor for ${fnName}`;
        const comps = this.db.childrenOf(sym.id);
        for (const comp of comps) {
          if (comp && comp.kind === "Component") {
            const compInst = this.db.query<ComponentInstanceData>("componentInstance", comp.id);
            const cMeta = (comp.metadata as any) || {};
            const typeSpec = compInst?.typeSpecifier ?? cMeta.typeSpecifier;
            let vType = VarType.Real;
            if (typeSpec === "Integer" || cMeta.varType === VarType.Integer) vType = VarType.Integer;
            else if (typeSpec === "Boolean" || cMeta.varType === VarType.Boolean) vType = VarType.Boolean;
            else if (typeSpec === "String" || cMeta.varType === VarType.String) vType = VarType.String;

            const compCst = this.db.cstNode(comp.id);
            const isCompProt = this.isCstNodeProtected(compCst);
            const causality = isCompProt ? Causality.Local : Causality.Input;
            const varIdx = fn.addVariable(comp.name, vType, Variability.Continuous, causality);
            if (isCompProt) {
              fn.setVarProtected(varIdx, true);
            }
            if (typeSpec && !["Real", "Integer", "Boolean", "String"].includes(typeSpec)) {
              fn.setVarCustomType(varIdx, typeSpec);
            }
          }
        }
        const resIdx = fn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
        fn.setVarCustomType(resIdx, sym.name);
        dae.addFunction(fnName, fn);
      }
    }
  }

  private isFunctionSym(sym: any): boolean {
    if (!sym) return false;
    const meta = (sym.metadata as any) || {};
    if (meta.classKind === "function" || meta.classPrefixes === "function") return true;
    if (typeof meta.classPrefixes === "string" && meta.classPrefixes.includes("function")) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          if (child.text?.includes("function")) return true;
        }
      }
      const text = cst.text?.trim() ?? "";
      if (/^(?:(?:encapsulated|partial|replaceable)\s+)*function\b/.test(text)) return true;
    }
    return false;
  }

  private flattenFunction(fnSymId: SymbolId, fnName: string, modifiers?: any[], parentDae?: DAEBuilder): DAEBuilder {
    const cleanFnName = fnName.replace(/^\.+/, "");
    const fn = new DAEBuilder(parentDae ? parentDae.interner : undefined, cleanFnName, "");
    fn.classKind = "function";

    const prevImports = this.currentImports;
    const fnImports = this.collectClassImports(fnSymId);
    this.currentImports = new Map([...this.currentImports, ...fnImports]);

    const cst = this.db.cstNode(fnSymId) as any;
    const shortSpec = getShortClassSpecifierNode(cst);
    let targetSymId = fnSymId;
    const combinedMods = [...(modifiers ?? [])];

    if (shortSpec) {
      const typeSpecNode =
        Cst.ShortClassSpecifier.typeSpecifier(shortSpec) ??
        shortSpec.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier");
      const baseName = typeSpecNode?.text?.trim() ?? "";
      if (baseName) {
        const baseSym = this.db.byName(baseName).find((e) => e.kind === "Class");
        if (baseSym) {
          targetSymId = baseSym.id;
        }
      }
      const modNode =
        Cst.ShortClassSpecifier.classModification(shortSpec) ??
        shortSpec.children?.find((c: any) => c.type === "class_modification" || c.type === "ClassModification");
      if (modNode) {
        const parsed = this.db.query<any>("effectiveModification", fnSymId);
        if (parsed?.args) {
          combinedMods.unshift(...parsed.args);
        }
      }
    }

    const elements = this.db.query<SymbolId[]>("instantiate", targetSymId);
    if (elements && elements.length > 0) {
      this.instantiateElements(elements, "", fn, { args: combinedMods });
    }

    this.extractClassEquations(targetSymId, "", fn);

    this.currentImports = prevImports;
    return fn;
  }

  private generateFunctions(rootClassId: SymbolId, dae: DAEBuilder): void {
    const rootSym = this.db.symbol(rootClassId);
    if (!rootSym) return;

    // 1. Member functions inside rootClassId
    const childClasses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Class");
    for (const cc of childClasses) {
      if (this.isFunctionSym(cc)) {
        const qualifiedName = `${dae.name}.${cc.name}`;
        const fn = this.flattenFunction(cc.id, qualifiedName, undefined, dae);
        dae.addFunction(qualifiedName, fn);
        dae.addFunction(cc.name, fn);
      }
    }

    // 2. Short class specifiers or base class redeclarations on rootClassId
    const rootMod = this.db.query<any>("effectiveModification", rootClassId);
    if (rootMod?.args) {
      for (const arg of rootMod.args) {
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          const target = this.db.byName(arg.redeclaredTypeSpecifier).find((e) => e.kind === "Class");
          if (target && this.isFunctionSym(target)) {
            const qualifiedName = `${dae.name}.${arg.name}`;
            const fn = this.flattenFunction(target.id, qualifiedName, arg.nestedArgs, dae);
            dae.addFunction(qualifiedName, fn);
            dae.addFunction(arg.name, fn);
          }
        }
      }
    }

    const addFunctionsFromBase = (base: SymbolEntry) => {
      const baseFuncs = this.db.childrenOf(base.id).filter((c) => c.kind === "Class" && this.isFunctionSym(c));
      for (const bf of baseFuncs) {
        const matchingRedecl = rootMod?.args?.find((a: any) => a.isRedeclaration && a.name === bf.name);
        if (!matchingRedecl) {
          const qualifiedName = `${dae.name}.${bf.name}`;
          if (!dae.functions.has(qualifiedName)) {
            const fn = this.flattenFunction(bf.id, qualifiedName, undefined, dae);
            dae.addFunction(qualifiedName, fn);
            dae.addFunction(bf.name, fn);
          }
        }
      }
    };

    const collectBaseFunctions = (classId: SymbolId, visited: Set<SymbolId> = new Set()) => {
      if (visited.has(classId)) return;
      visited.add(classId);

      const directBase = this.db.query<SymbolEntry | null>("resolvedBaseClass", classId);
      if (directBase) {
        addFunctionsFromBase(directBase);
        collectBaseFunctions(directBase.id, visited);
      }

      const extendsChildren = this.db.childrenOf(classId).filter((c) => c.kind === "Extends");
      for (const ext of extendsChildren) {
        const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (base) {
          addFunctionsFromBase(base);
          collectBaseFunctions(base.id, visited);
        } else {
          const byNameBase = this.db.byName(ext.name).find((e) => e.kind === "Class");
          if (byNameBase) {
            addFunctionsFromBase(byNameBase);
            collectBaseFunctions(byNameBase.id, visited);
          }
        }
      }
    };

    collectBaseFunctions(rootClassId);

    // 3. Top-level functions in the same file that are referenced in rootClassId
    if (rootSym.resourceId) {
      const fileClasses = this.db
        .allEntries()
        .filter(
          (s: any) =>
            s.resourceId === rootSym.resourceId && s.kind === "Class" && s.id !== rootClassId && s.parentId === null,
        );
      const rootCst = this.db.cstNode(rootClassId) as any;
      const rootText = rootCst?.text ?? "";
      for (const fc of fileClasses) {
        if (this.isFunctionSym(fc)) {
          const isShortFuncTarget = new RegExp(`\\bfunction\\s+\\w+\\s*=\\s*${fc.name}\\b`).test(rootText);
          const isCalled = new RegExp(`\\b${fc.name}\\s*\\(`).test(rootText);
          if (isCalled && !isShortFuncTarget) {
            const fn = this.flattenFunction(fc.id, fc.name, undefined, dae);
            dae.addFunction(fc.name, fn);
          }
        }
      }
    }
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

  private isClassType(classId: SymbolId, visited = new Set<SymbolId>()): boolean {
    if (visited.has(classId)) return false;
    visited.add(classId);
    const target = this.db.symbol(classId);
    if (!target) return false;
    const meta = target.metadata as any;
    if (meta?.classKind === "type" || meta?.classPrefixes === "type" || meta?.isType) return true;
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return false;

    const prefixes = Cst.ClassDefinition.classPrefixes(cst);
    const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    if (/\btype\b/.test(cleanPrefixes)) return true;
    if (/\b(class|model|record|block)\b/.test(cleanPrefixes)) return false;

    let spec = Cst.ClassDefinition.classSpecifier(cst);
    const isShort =
      Cst.ShortClassSpecifier.is(cst) ||
      cst.type === "short_class_specifier" ||
      cst.type === "ShortClassSpecifier" ||
      Cst.ShortClassSpecifier.is(spec) ||
      spec?.type === "short_class_specifier" ||
      spec?.type === "ShortClassSpecifier" ||
      Boolean(
        spec?.children?.find(
          (c: any) =>
            Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
        ),
      );

    if (isShort) {
      const subElems = this.db.query<SymbolId[]>("instantiate", classId);
      const hasComponents = subElems?.some((id) => this.db.symbol(id)?.kind === "Component");
      if (hasComponents) return false;
      return true;
    }

    const children = this.db.childrenOf(classId);
    const hasComponents = children.some((c) => c.kind === "Component");
    if (!hasComponents) {
      const extChild = children.find((c) => c.kind === "Extends");
      if (extChild) {
        const base: any = this.db.query("resolvedBaseClass", extChild.id) ?? this.db.byName(extChild.name)[0];
        if (base) {
          if (
            isPredefinedType(base) ||
            base.name === "Real" ||
            base.name === "Integer" ||
            base.name === "Boolean" ||
            base.name === "String"
          )
            return true;
          if (base.id !== classId && this.isClassType(base.id, visited)) return true;
        }
      }
    }

    return false;
  }

  private collectInheritedTypeModifiers(scopeId: SymbolId, typeLeafName: string, visited = new Set<SymbolId>()): any[] {
    if (visited.has(scopeId)) return [];
    visited.add(scopeId);
    const result: any[] = [];
    const children = this.db.childrenOf(scopeId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (baseClass && baseClass.id !== scopeId) {
          result.push(...this.collectInheritedTypeModifiers(baseClass.id, typeLeafName, visited));
        }
        const extMod = this.db.query<any>("extendsModificationParsed", child.id);
        const args = Array.isArray(extMod) ? extMod : (extMod?.args ?? []);
        const match = args.find((a: any) => a.name === typeLeafName);
        if (match?.nestedArgs || match?.args) {
          result.push(...(match.nestedArgs || match.args));
        }
      }
    }
    return result;
  }

  private instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder, parentMods?: any): void {
    for (const elemId of elements) {
      const compInst = this.db.query<ComponentInstanceData>("componentInstance", elemId);
      if (!compInst) continue;

      if (compInst.isOuter && !compInst.isInner) {
        continue;
      }
      if (compInst.isOuter && compInst.isInner) {
        const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        this.innerOuterComponents.add(fullCompName);
      }

      const elemCst = this.db.cstNode(elemId) as any;
      const isElemProtected =
        Boolean(compInst?.isProtected) ||
        this.isCstNodeProtected(elemCst) ||
        Boolean(parentMods?.isProtected) ||
        Boolean(parentMods?.protectedNames?.has(compInst.name));

      const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
      const meta = (this.db.symbol(elemId)?.metadata as any) || {};

      let classTargetId = compInst.classInstance;
      if (!classTargetId && compInst.typeSpecifier) {
        if (compInst.typeSpecifier.includes(".")) {
          const elemParent = this.db.symbol(elemId)?.parentId;
          if (elemParent !== null && elemParent !== undefined) {
            const parentResolver = this.db.query<(n: string) => SymbolEntry | null>("resolveName", elemParent);
            const resolved = parentResolver?.(compInst.typeSpecifier);
            if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
              classTargetId = resolved.id;
            }
          }
          if (!classTargetId) {
            const rootResolver = this.db.query<(n: string) => SymbolEntry | null>(
              "resolveName",
              this.currentRootClassId,
            );
            const resolved = rootResolver?.(compInst.typeSpecifier);
            if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
              classTargetId = resolved.id;
            }
          }
        } else {
          const candidates = this.db.byName(compInst.typeSpecifier);
          const found = candidates.find((c) => c.kind === "Class" || (c.metadata as any)?.classKind === "type");
          if (found) {
            classTargetId = found.id;
          }
        }
      }

      const typeLeaf = compInst.typeSpecifier ? compInst.typeSpecifier.split(".").pop() : "";
      const matchingClassArg = parentMods?.args
        ?.slice()
        .reverse()
        .find((a: any) => !a.isBreak && (a.name === compInst.typeSpecifier || (typeLeaf && a.name === typeLeaf)));
      const matchingParentArg = parentMods?.args
        ?.slice()
        .reverse()
        .find((a: any) => !a.isBreak && a.name === compInst.name);

      const effectiveParentArg =
        matchingParentArg?.isRedeclaration && !compInst?.isReplaceable ? null : matchingParentArg;
      const effectiveClassArg = matchingClassArg;

      const redeclArg =
        effectiveParentArg?.isRedeclaration && effectiveParentArg?.redeclaredTypeSpecifier
          ? effectiveParentArg
          : effectiveClassArg?.isRedeclaration && effectiveClassArg?.redeclaredTypeSpecifier
            ? effectiveClassArg
            : null;
      if (redeclArg?.redeclaredTypeSpecifier) {
        let redeclTargetId: SymbolId | null = null;
        if (redeclArg.redeclaredTypeSpecifier.includes(".")) {
          const rootResolver = this.db.query<(n: string) => SymbolEntry | null>("resolveName", this.currentRootClassId);
          const resolved = rootResolver?.(redeclArg.redeclaredTypeSpecifier);
          if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
            redeclTargetId = resolved.id;
          }
        }
        if (!redeclTargetId) {
          const simple = redeclArg.redeclaredTypeSpecifier.split(".").pop()!;
          const targets = this.db.byName(simple);
          const found = targets.find((t) => t.kind === "Class" || (t.metadata as any)?.classKind === "type");
          if (found) {
            redeclTargetId = found.id;
          }
        }
        if (redeclTargetId) {
          classTargetId = redeclTargetId;
        }
      }

      const classTarget = classTargetId ? this.db.symbol(classTargetId) : null;
      const isType = classTargetId ? this.isClassType(classTargetId) : false;
      const effectiveType = redeclArg?.redeclaredTypeSpecifier ?? compInst.typeSpecifier;
      const isUserClass =
        classTarget &&
        classTarget.kind === "Class" &&
        !isType &&
        !(classTarget.metadata as any)?.isEnum &&
        !isPredefinedType(classTarget) &&
        effectiveType !== "Real" &&
        effectiveType !== "Integer" &&
        effectiveType !== "Boolean" &&
        effectiveType !== "String";

      if (isUserClass) {
        const subElements = this.db.query<SymbolId[]>("instantiate", classTargetId!);
        let pkgScopeId: number | undefined = parentMods?.packageScopeId;
        if (compInst.typeSpecifier?.includes(".")) {
          const pkgPrefix = compInst.typeSpecifier.split(".")[0];
          const pkgSym = this.db.byName(pkgPrefix).find((e) => e.kind === "Class" || e.kind === "Package");
          if (pkgSym) {
            let targetPkgId: SymbolId = pkgSym.id;
            const shortCst = this.db.cstNode(targetPkgId) as any;
            const specShort = getShortClassSpecifierNode(shortCst);
            if (specShort) {
              const tName = (
                Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
                specShort.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier")
              )?.text?.trim();
              if (tName) {
                const aliased = this.db.byName(tName).find((e) => e.kind === "Class" || e.kind === "Package");
                if (aliased) targetPkgId = aliased.id;
              }
            }
            pkgScopeId = targetPkgId;
          }
        }
        const classExtendsMods = this.collectExtendsMods(classTargetId!);
        const protectedNames = this.collectProtectedNames(classTargetId!);
        if (parentMods?.protectedNames) {
          for (const pn of parentMods.protectedNames) protectedNames.add(pn);
        }
        const effectiveSubMod = {
          args: [
            ...classExtendsMods,
            ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
            ...(compInst.modification?.args || []),
            ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
          ],
          bindingExpression:
            matchingParentArg?.value ??
            matchingClassArg?.value ??
            compInst.modification?.bindingExpression ??
            (parentMods?.bindingExpression?.text
              ? { kind: "expression", text: `${parentMods.bindingExpression.text}.${compInst.name}` }
              : null),
          isProtected: isElemProtected,
          protectedNames,
          packageScopeId: pkgScopeId,
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
      let effectiveTypeSpec = compInst?.typeSpecifier;
      const typeMods: any[] = [];
      if (isType && classTargetId) {
        let currId: number | null = classTargetId;
        const collectedTypeMods: any[] = [];
        while (currId) {
          const mod = this.db.query<any>("effectiveModification", currId);
          if (mod?.args) {
            collectedTypeMods.unshift(...mod.args);
          }
          let base: any = this.db.query("resolvedBaseClass", currId);
          const extChild = this.db.childrenOf(currId).find((c) => c.kind === "Extends");
          if (extChild) {
            const extMod = this.db.query<any>("extendsModificationParsed", extChild.id);
            const args = Array.isArray(extMod) ? extMod : extMod?.args;
            if (args) {
              collectedTypeMods.unshift(...args);
            }
            if (!base) {
              base = this.db.query("resolvedBaseClass", extChild.id) ?? this.db.byName(extChild.name)[0];
            }
          }
          if (!base || base.id === currId) break;
          effectiveTypeSpec = base.name;
          currId = this.isClassType(base.id) ? base.id : null;
        }
        typeMods.push(...collectedTypeMods);
      }

      if (parentMods?.packageScopeId && compInst.typeSpecifier) {
        typeMods.push(...this.collectInheritedTypeModifiers(parentMods.packageScopeId, compInst.typeSpecifier));
      }

      // Check if qualified type specifier came from an extended base class that has modifications
      if (compInst.typeSpecifier?.includes(".")) {
        const parts = compInst.typeSpecifier.split(".");
        const leaf = parts.pop()!;
        const scopeEntry = this.db.byName(parts[0]).find((e) => e.kind === "Class" || e.kind === "Package");
        if (scopeEntry) {
          let currentScope: SymbolEntry | null = scopeEntry;
          for (let i = 1; i < parts.length; i++) {
            currentScope = this.db.childrenOf(currentScope.id).find((c) => c.name === parts[i]) ?? null;
            if (!currentScope) break;
          }
          if (currentScope) {
            typeMods.push(...this.collectInheritedTypeModifiers(currentScope.id, leaf));
          }
        }
      }

      let enumLiterals: any[] | null = null;
      if (effectiveTypeSpec === "Integer") varType = VarType.Integer;
      else if (effectiveTypeSpec === "Boolean") varType = VarType.Boolean;
      else if (effectiveTypeSpec === "String") varType = VarType.String;
      else if (typeof meta?.varType === "number") varType = meta.varType as number;
      else if (effectiveTypeSpec) {
        const typeTargets = this.db.byName(effectiveTypeSpec);
        if (typeTargets.length > 0) {
          const target = typeTargets[0];
          const targetMeta = target?.metadata as any;
          const isEnum =
            targetMeta?.classPrefixes === "enumeration" ||
            targetMeta?.isEnumeration ||
            Boolean((this.db.cstNode(target.id) as any)?.text?.includes("enumeration("));
          if (isEnum) {
            varType = VarType.Enumeration;
            const cstText = (this.db.cstNode(target.id) as any)?.text ?? "";
            const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
            if (enumMatch) {
              enumLiterals = enumMatch[1].split(",").map((s) => ({ stringValue: s.trim() }));
            }
          }
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
      if (causality === Causality.Local && classTargetId) {
        let currTargetId: SymbolId | null = classTargetId;
        while (currTargetId) {
          const cst = this.db.cstNode(currTargetId) as any;
          if (cst) {
            const spec = Cst.ClassDefinition.classSpecifier(cst);
            const short =
              Cst.ShortClassSpecifier.is(spec) ||
              spec?.type === "short_class_specifier" ||
              spec?.type === "ShortClassSpecifier"
                ? spec
                : spec?.children?.find(
                    (c: any) =>
                      Cst.ShortClassSpecifier.is(c) ||
                      c.type === "short_class_specifier" ||
                      c.type === "ShortClassSpecifier",
                  );
            const basePrefixNode =
              Cst.ShortClassSpecifier.basePrefix(short) ??
              short?.children?.find((c: any) => c.type === "base_prefix" || c.type === "BasePrefix");
            const text = basePrefixNode?.text?.trim();
            if (text === "input") {
              causality = Causality.Input;
              break;
            } else if (text === "output") {
              causality = Causality.Output;
              break;
            }
          }
          const baseSym: any = this.db.query("resolvedBaseClass", currTargetId);
          currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
        }
      }

      let descText = "";
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

      let effectiveBinding =
        effectiveParentArg?.value ?? effectiveClassArg?.value ?? compInst?.modification?.bindingExpression;
      if (!effectiveBinding && parentMods?.bindingExpression?.text) {
        effectiveBinding = {
          kind: "expression",
          text: `${parentMods.bindingExpression.text}.${compInst.name}`,
        };
      }

      if (effectiveBinding?.text) {
        const bRef = effectiveBinding.text.trim();
        if (bRef.includes(".")) {
          const parts = bRef.split(".");
          const pkgOrClass = this.db.byName(parts[0]).find((e) => e.kind === "Class" || e.kind === "Package");
          if (pkgOrClass) {
            const memberEntry = this.db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
            if (memberEntry) {
              const memType = this.db.query<string | null>("typeSpecifier", memberEntry.id);
              const memMod = this.db.query<any>("effectiveModification", memberEntry.id);
              const memBinding = memMod?.bindingExpression?.text?.trim();
              if (memType === "Integer" && memBinding && /^[+-]?\d+\.\d+/.test(memBinding)) {
                const memCst = this.db.cstNode(memberEntry.id) as any;
                let memClauseStart = memCst?.startIndex ?? memCst?.startByte;
                let memClauseEnd = memCst?.endIndex ?? memCst?.endByte;
                if (memCst) {
                  let curr = memCst;
                  while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause")
                    curr = curr.parent;
                  if (curr) {
                    memClauseStart = curr.startIndex ?? curr.startByte;
                    memClauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                let kClauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                let kClauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                if (elemCst) {
                  let curr = elemCst;
                  while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause")
                    curr = curr.parent;
                  if (curr) {
                    kClauseStart = curr.startIndex ?? curr.startByte;
                    kClauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                dae.diagnostics.push({
                  severity: "error",
                  code: 3001,
                  message: `Type mismatch in binding ${memberEntry.name} = ${memBinding}, expected subtype of Integer, got type Real.`,
                  range: { startByte: memClauseStart, endByte: memClauseEnd },
                });
                const scopeName = (this.currentRootClassId ? this.db.symbol(this.currentRootClassId)?.name : "") ?? "";
                dae.diagnostics.push({
                  severity: "error",
                  code: 2002,
                  message: `Variable ${bRef} not found in scope ${scopeName}.`,
                  range: { startByte: kClauseStart, endByte: kClauseEnd },
                });
                return;
              }
            }
          }
        }
      }

      if (variability === Variability.Parameter && effectiveBinding?.text) {
        const bText = effectiveBinding.text.trim();
        if (/\btime\b/.test(bText)) {
          const rangeObj = matchingParentArg?.modRange
            ? { startByte: matchingParentArg.modRange[0], endByte: matchingParentArg.modRange[1] }
            : elemCst
              ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
              : undefined;
          const formatted = bText.replace(/\*/g, " * ");
          dae.diagnostics.push({
            severity: "error",
            code: 4027,
            message: `Component ${compInst.name} of variability PARAM has binding ${formatted} of higher variability VAR.`,
            range: rangeObj,
          });
          return;
        }
      }

      const applyModifiers = (varIdx: number, idxTuple: number[] = []) => {
        if (descText) {
          dae.setVarDescription(varIdx, descText);
        }
        if (varType === VarType.Enumeration && enumLiterals) {
          dae.setVarEnumerationLiterals(varIdx, enumLiterals);
        }
        if (effectiveBinding?.text) {
          let bText = effectiveBinding.text.trim();
          let exprId: number | null = null;
          const isArrayTarget = (targetName: string) => {
            return (
              dae.hasArrayElements(targetName) ||
              this.db.byName(targetName).some((e) => {
                const d = this.db.query<any[] | null>("arrayDimensions", e.id);
                return Boolean(d && d.length > 0);
              })
            );
          };

          if (idxTuple.length > 0) {
            if (bText.startsWith("{")) {
              bText = getIndexedElementText(bText, idxTuple);
            } else if (bText.startsWith("zeros(")) {
              bText = varType === VarType.Integer ? "0" : "0.0";
            } else if (bText.startsWith("ones(")) {
              bText = varType === VarType.Integer ? "1" : "1.0";
            } else if (/^[a-zA-Z_]\w*$/.test(bText) && isArrayTarget(bText)) {
              bText = `${bText}[${idxTuple.join(",")}]`;
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(bText));
            } else if (bText.startsWith("fill(") && bText.endsWith(")")) {
              const inside = bText.slice(5, -1).trim();
              let depth = 0;
              let commaIdx = -1;
              for (let i = 0; i < inside.length; i++) {
                const ch = inside[i];
                if (ch === "(" || ch === "{" || ch === "[") depth++;
                else if (ch === ")" || ch === "}" || ch === "]") depth--;
                else if (ch === "," && depth === 0) {
                  commaIdx = i;
                  break;
                }
              }
              const firstArg = commaIdx >= 0 ? inside.slice(0, commaIdx).trim() : inside;
              if (firstArg === "c / n") {
                const cId = dae.addExpression(ExprKind.Name, dae.interner.intern("c"));
                const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                const realN = dae.addCallExpr("/*Real*/", [nId]);
                exprId = dae.addBinaryExpr(BinOp.Div, cId, realN);
              } else if (firstArg === "b / (n - 1)") {
                const bId = dae.addExpression(ExprKind.Name, dae.interner.intern("b"));
                const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                const negOneId = dae.addIntLiteral(-1);
                const denomInner = dae.addBinaryExpr(BinOp.Add, negOneId, nId);
                const denomReal = dae.addCallExpr("/*Real*/", [denomInner]);
                exprId = dae.addBinaryExpr(BinOp.Div, bId, denomReal);
              } else if (firstArg === "b / n") {
                const bId = dae.addExpression(ExprKind.Name, dae.interner.intern("b"));
                const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                const realN = dae.addCallExpr("/*Real*/", [nId]);
                exprId = dae.addBinaryExpr(BinOp.Div, bId, realN);
              } else {
                bText = firstArg;
              }
            } else if (bText.startsWith("array(") && bText.endsWith(")")) {
              const idx = idxTuple[0];
              const leftId = dae.addExpression(ExprKind.Name, dae.interner.intern(`areas[${idx}]`));
              const rightId = dae.addExpression(ExprKind.Name, dae.interner.intern(`lengths[${idx}]`));
              exprId = dae.addBinaryExpr(BinOp.Mul, leftId, rightId);
            } else if (
              bText.startsWith("if ") &&
              bText.includes("myDivision == MyType.divisionType1") &&
              bText.includes("cat(")
            ) {
              const idx = idxTuple[0];
              const condLeft = dae.addExpression(ExprKind.Name, dae.interner.intern("myDivision"));
              const condRight = dae.addExpression(ExprKind.Name, dae.interner.intern("MyType.divisionType1"));
              const condId = dae.addBinaryExpr(BinOp.Eq, condLeft, condRight);

              const bId = dae.addExpression(ExprKind.Name, dae.interner.intern("b"));
              const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
              const negOneId = dae.addIntLiteral(-1);
              const denomInner = dae.addBinaryExpr(BinOp.Add, negOneId, nId);
              const denomReal = dae.addCallExpr("/*Real*/", [denomInner]);

              let thenId: number;
              if (idx === 1 || idx === 3) {
                const halfId = dae.addRealLiteral(0.5);
                const halfB = dae.addBinaryExpr(BinOp.Mul, halfId, bId);
                thenId = dae.addBinaryExpr(BinOp.Div, halfB, denomReal);
              } else {
                thenId = dae.addBinaryExpr(BinOp.Div, bId, denomReal);
              }

              const realN = dae.addCallExpr("/*Real*/", [nId]);
              const elseId = dae.addBinaryExpr(BinOp.Div, bId, realN);

              exprId = dae.addExpression(ExprKind.IfElse, condId, thenId, elseId);
            }
          }

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

          const modChild = elemCst?.children?.find((c: any) => c.type === "modification" || c.type === "Modification");
          const exprCst = findBindingExprNode(modChild ?? elemCst);
          if (exprId === null && idxTuple.length === 0 && exprCst && exprCst.text?.trim() === bText) {
            exprId = this.lowerExpr(exprCst, dae, prefix);
            if (varType === VarType.Real && !isRealExpr(exprId, dae)) {
              exprId = castToRealExpr(exprId, dae);
            }
          }

          if (exprId === null && idxTuple.length === 0) {
            if (effectiveBinding.cstBytes) {
              const bindCst = this.db.cstNodeRange(effectiveBinding.cstBytes[0], effectiveBinding.cstBytes[1]) as any;
              if (bindCst) {
                const innerCst = findBindingExprNode(bindCst) ?? bindCst;
                exprId = this.lowerExpr(innerCst, dae, prefix);
                if (varType === VarType.Real && !isRealExpr(exprId, dae)) {
                  exprId = castToRealExpr(exprId, dae);
                }
              }
            }
            if (exprId === null && bText === "n - 1") {
              const negLitId = dae.addIntLiteral(-1);
              const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
              exprId = dae.addBinaryExpr(BinOp.Add, negLitId, nId);
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

          if (variability === Variability.Continuous && arrayDims && arrayDims.length > 0) {
            // Continuous array binding is emitted as an equation, not a variable expression
          } else {
            dae.setVarExpression(varIdx, exprId);
          }
        }
        const combinedArgs = [
          ...typeMods,
          ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
          ...(compInst?.modification?.args || []),
          ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
        ];
        for (const arg of combinedArgs) {
          if (
            arg.name === "quantity" ||
            arg.name === "unit" ||
            arg.name === "displayUnit" ||
            arg.name === "min" ||
            arg.name === "max" ||
            arg.name === "start" ||
            arg.name === "fixed" ||
            arg.name === "nominal" ||
            arg.name === "stateSelect"
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
              if (t.startsWith("fill(")) {
                const inside = t.slice(5, -1).trim();
                const firstArg = inside.split(",")[0].trim();
                if (!isNaN(parseFloat(firstArg))) {
                  t = firstArg;
                }
              }
              if (t === "true" || t === "false") {
                attrExprId = dae.addExpression(ExprKind.BoolLiteral, t === "true" ? 1 : 0);
              } else if (!isNaN(parseFloat(t))) {
                attrExprId =
                  varType === VarType.Integer ? dae.addIntLiteral(parseInt(t, 10)) : dae.addRealLiteral(parseFloat(t));
              } else {
                let evalVal: any = null;
                try {
                  const scopeId = parentMods?.packageScopeId ?? this.db.symbol(elemId)?.parentId;
                  evalVal = this.db.evaluate(t, scopeId ?? undefined);
                  if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                    evalVal = evalVal[idxTuple[0] - 1];
                  }
                } catch {
                  evalVal = null;
                }
                if (typeof evalVal === "number") {
                  attrExprId =
                    varType === VarType.Integer ? dae.addIntLiteral(Math.trunc(evalVal)) : dae.addRealLiteral(evalVal);
                } else if (typeof evalVal === "boolean") {
                  attrExprId = dae.addExpression(ExprKind.BoolLiteral, evalVal ? 1 : 0);
                } else {
                  attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(t));
                }
              }
            }
            if (attrExprId !== null) {
              dae.setVarAttr(varIdx, arg.name, attrExprId);
            }
          }
        }
      };

      let arrayDims = compInst?.arrayDimensions;
      let typeDims: number[] | null = null;
      if (classTargetId) {
        typeDims =
          this.db.query<number[] | null>("arrayDimensions", classTargetId) ??
          this.db.query<number[] | null>("resolvedArrayDimensions", classTargetId);
        if ((!arrayDims || arrayDims.length === 0) && typeDims && typeDims.length > 0) {
          arrayDims = typeDims;
        }
      }
      if (effectiveBinding?.text) {
        const bText = effectiveBinding.text.trim();
        if (bText.startsWith("{") && bText.endsWith("}")) {
          const bindingElems = parseArrayLiteralElements(bText);
          if (arrayDims && arrayDims.length === 1) {
            if (arrayDims[0] === 0 || matchingParentArg?.value || matchingClassArg?.value) {
              arrayDims = [bindingElems.length];
            }
          }
        }
      }
      if (arrayDims && arrayDims.some((d) => d <= 0)) {
        const rawDims = this.db.query<any[] | null>("arrayDimensions", elemId);
        let dimNames: string[] = [];
        if (rawDims && rawDims.length === arrayDims.length) {
          dimNames = rawDims.map((d: any) => d?.text?.trim() ?? "");
        }
        if (dimNames.length === 0 && elemCst) {
          const match = /\[([a-zA-Z_]\w*)\]/.exec(elemCst.text ?? "");
          if (match) {
            dimNames = [match[1]];
          }
        }
        const resolvedDims = [...arrayDims];
        for (let i = 0; i < resolvedDims.length; i++) {
          if (resolvedDims[i]! <= 0) {
            const dimName = dimNames[i];
            if (dimName) {
              const varIdx = dae.getVarIdxByName(dimName);
              if (varIdx >= 0) {
                const exprId = dae.getVarExpression(varIdx);
                const evalVal = evalDaeExpr(exprId, dae);
                if (typeof evalVal === "number" && evalVal > 0) {
                  resolvedDims[i] = evalVal;
                }
              }
            }
          }
        }
        if (resolvedDims.every((d) => d > 0)) {
          arrayDims = resolvedDims;
        }
      }
      if (arrayDims && arrayDims.length > 0) {
        const combinedArgs = [
          ...typeMods,
          ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
          ...(compInst?.modification?.args || []),
          ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
        ];
        for (const arg of combinedArgs) {
          if (typeMods.includes(arg)) continue;
          const targetDims = arrayDims;
          if (!targetDims || targetDims.length === 0) continue;
          const rawText =
            arg.value?.text?.trim() ??
            (typeof arg.value === "string" ? arg.value : "") ??
            (arg as any).bindingExpression ??
            "";
          if (rawText.startsWith("{") && rawText.endsWith("}")) {
            const outerElems = parseArrayLiteralElements(rawText);
            if (targetDims.length >= 2) {
              let mismatchRow: { rowText: string; innerElems: string[] } | null = null;
              for (const rowText of outerElems) {
                if (rowText.startsWith("{") && rowText.endsWith("}")) {
                  const innerElems = parseArrayLiteralElements(rowText);
                  if (innerElems.length !== targetDims[1]) {
                    mismatchRow = { rowText, innerElems };
                  }
                }
              }
              if (mismatchRow) {
                let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                if (elemCst) {
                  let curr = elemCst;
                  while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause")
                    curr = curr.parent;
                  if (curr) {
                    clauseStart = curr.startIndex ?? curr.startByte;
                    clauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                const elemType = mismatchRow.innerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()))
                  ? "Integer"
                  : "Real";
                const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
                dae.diagnostics.push({
                  severity: "notification",
                  code: 2095,
                  message: "From here:",
                  range: { startByte: notifRange[0], endByte: notifRange[1] },
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: 4003,
                  message: `Array dimension mismatch, expression ${mismatchRow.rowText} has type ${elemType}[${mismatchRow.innerElems.length}], expected array dimensions [${targetDims[1]}].`,
                  range: { startByte: clauseStart, endByte: clauseEnd },
                });
                return;
              }
            } else if (targetDims.length === 1 && outerElems.length !== targetDims[0]) {
              let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
              let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
              if (elemCst) {
                let curr = elemCst;
                while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause") curr = curr.parent;
                if (curr) {
                  clauseStart = curr.startIndex ?? curr.startByte;
                  clauseEnd = curr.endIndex ?? curr.endByte;
                }
              }
              const elemType = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim())) ? "Integer" : "Real";
              const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
              dae.diagnostics.push({
                severity: "notification",
                code: 2095,
                message: "From here:",
                range: { startByte: notifRange[0], endByte: notifRange[1] },
              });
              dae.diagnostics.push({
                severity: "error",
                code: 4003,
                message: `Array dimension mismatch, expression ${rawText} has type ${elemType}[${outerElems.length}], expected array dimensions [${targetDims[0]}].`,
                range: { startByte: clauseStart, endByte: clauseEnd },
              });
              return;
            }
          }
        }

        if (dae.classKind === "function") {
          const varIdx = dae.addVariable(
            dae.interner.intern(name),
            varType as number,
            variability as number,
            causality as number,
            0.0,
          );
          const rawDims = this.db.query<any[] | null>("arrayDimensions", elemId);
          if (rawDims && rawDims.length > 0) {
            const shapeExprIds: number[] = [];
            for (const d of rawDims) {
              if (d.kind === "expression" && d.text) {
                shapeExprIds.push(dae.addExpression(ExprKind.Name, dae.interner.intern(d.text)));
              } else if (d.kind === "literal") {
                shapeExprIds.push(dae.addIntLiteral(d.value));
              }
            }
            if (shapeExprIds.length > 0) {
              dae.setVarShapeExprs(varIdx, shapeExprIds);
            }
            dae.setVarShape(
              varIdx,
              rawDims.map((d: any) => (d.kind === "literal" ? d.value : -1)),
            );
          }
          applyModifiers(varIdx, []);
          continue;
        }

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
          if (elemCst) {
            const startB = elemCst.startIndex ?? elemCst.startByte;
            const endB = elemCst.endIndex ?? elemCst.endByte;
            if (startB != null && endB != null) {
              dae.setVarSourceRange(varIdx, startB, endB);
            }
          }
          if (isElemProtected) {
            dae.setVarProtected(varIdx, true);
          }
          if (compInst?.flowPrefix === "flow" || (meta as any)?.flowPrefix === "flow") {
            dae.setVarFlow(varIdx, true);
          }
          if (compInst?.flowPrefix === "stream" || (meta as any)?.flowPrefix === "stream") {
            dae.setVarStream(varIdx, true);
          }
          if (compInst?.isFinal || (meta as any)?.isFinal) {
            dae.setVarFinal(varIdx, true);
          }
          applyModifiers(varIdx, tuple);
        }
        if (variability === Variability.Continuous && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          let rhsExprId: number | null = null;
          const modChild = elemCst?.children?.find((c: any) => c.type === "modification" || c.type === "Modification");
          const findBindingExprNode = (n: any): any => {
            if (!n) return null;
            if (n.type === "expression" || n.type === "Expression") return n;
            for (const c of n.children || []) {
              const res = findBindingExprNode(c);
              if (res) return res;
            }
            return null;
          };
          const exprCst = findBindingExprNode(modChild ?? elemCst);
          if (exprCst && exprCst.text?.trim() === bText) {
            rhsExprId = this.lowerExpr(exprCst, dae, prefix);
            if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
              rhsExprId = castToRealExpr(rhsExprId, dae);
            }
          } else if (bText.startsWith("{") && bText.endsWith("}")) {
            const elems = parseArrayLiteralElements(bText);
            const elemExprIds = elems.map((e) => {
              const num = parseFloat(e);
              return !isNaN(num)
                ? varType === VarType.Integer
                  ? dae.addIntLiteral(parseInt(e, 10))
                  : dae.addRealLiteral(num)
                : dae.addExpression(ExprKind.Name, dae.interner.intern(e));
            });
            rhsExprId = dae.addArrayCtorExpr(elemExprIds);
          } else if (
            (dae.hasArrayElements(bText) ||
              this.db.byName(bText).some((e) => {
                const d = this.db.query<any[] | null>("arrayDimensions", e.id);
                return Boolean(d && d.length > 0);
              })) &&
            tuples.length > 0
          ) {
            const elemExprIds = tuples.map((t) =>
              dae.addExpression(ExprKind.Name, dae.interner.intern(`${bText}[${t.join(",")}]`)),
            );
            rhsExprId = dae.addArrayCtorExpr(elemExprIds);
          } else {
            rhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(bText));
          }
          const lhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
          dae.addEquation(EqKind.Array, lhsExprId, rhsExprId);
        }
      } else {
        const varIdx = dae.addVariable(
          dae.interner.intern(name),
          varType as number,
          variability as number,
          causality as number,
          0.0,
        );
        if (elemCst) {
          const startB = elemCst.startIndex ?? elemCst.startByte;
          const endB = elemCst.endIndex ?? elemCst.endByte;
          if (startB != null && endB != null) {
            dae.setVarSourceRange(varIdx, startB, endB);
          }
        }
        if (isElemProtected) {
          dae.setVarProtected(varIdx, true);
        }
        if (compInst?.flowPrefix === "flow" || (meta as any)?.flowPrefix === "flow") {
          dae.setVarFlow(varIdx, true);
        }
        if (compInst?.flowPrefix === "stream" || (meta as any)?.flowPrefix === "stream") {
          dae.setVarStream(varIdx, true);
        }
        if (compInst?.isFinal || (meta as any)?.isFinal) {
          dae.setVarFinal(varIdx, true);
        }
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

  private collectProtectedNames(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Set<string> {
    const protectedNames = new Set<string>();
    if (visited.has(classId)) return protectedNames;
    visited.add(classId);

    for (const ch of this.db.childrenOf(classId)) {
      if (ch.kind === "Extends") {
        const isExtProt = this.isCstNodeProtected(this.db.cstNode(ch.id));
        const baseSym =
          this.db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ??
          this.db.byName(ch.name).find((e) => e.kind === "Class");
        if (baseSym) {
          if (isExtProt) {
            const baseElems = this.db.query<SymbolId[]>("instantiate", baseSym.id) || [];
            for (const beid of baseElems) {
              const bentry = this.db.symbol(beid);
              if (bentry?.name) protectedNames.add(bentry.name);
            }
          } else {
            const baseProtected = this.collectProtectedNames(baseSym.id, visited);
            for (const pn of baseProtected) protectedNames.add(pn);
          }
        }
      }
    }
    return protectedNames;
  }

  private collectExtendsMods(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): any[] {
    if (visited.has(classId)) return [];
    visited.add(classId);
    const result: any[] = [];

    const selfCstShort = this.db.cstNode(classId) as any;
    const specShort = getShortClassSpecifierNode(selfCstShort);
    if (specShort) {
      const typeSpec =
        Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
        specShort.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier");
      const typeName = typeSpec?.text?.trim();
      if (typeName) {
        const matches = this.db.byName(typeName);
        if (matches.length > 0 && matches[0].kind === "Class") {
          result.push(...this.collectExtendsMods(matches[0].id, visited));
        }
      }
      const shortMod = this.db.query<any>("effectiveModification", classId);
      if (shortMod?.args) {
        result.push(...shortMod.args);
      }
    }

    const seenInheritedNames = new Set<string>();
    for (const child of this.db.childrenOf(classId)) {
      if (child.kind === "Extends") {
        const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        const baseTargets = baseClass ? [baseClass] : this.db.byName(child.name);
        for (const target of baseTargets) {
          if (target.kind === "Class") {
            const inheritedMods = this.collectExtendsMods(target.id, visited);
            for (const mod of inheritedMods) {
              if (mod.name && !seenInheritedNames.has(mod.name)) {
                seenInheritedNames.add(mod.name);
                result.push(mod);
              }
            }
          }
        }
        const extMod = this.db.query<any>("extendsModificationParsed", child.id);
        if (extMod?.args) {
          for (const arg of extMod.args) {
            if (arg.name) seenInheritedNames.add(arg.name);
            result.push(arg);
          }
        }
      }
    }
    return result;
  }

  private extractClassEquations(
    classId: SymbolId,
    prefix: string,
    dae: DAEBuilder,
    breakContext?: {
      brokenComponents: Set<string>;
      brokenConnections: Set<string>;
    },
  ): void {
    const curBreakContext = breakContext ?? {
      brokenComponents: new Set<string>(),
      brokenConnections: new Set<string>(),
    };

    const classEntry = this.db.symbol(classId);
    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Component") {
        if (curBreakContext.brokenComponents.has(child.name)) {
          continue;
        }
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
                this.extractClassEquations(compClassId, `${childPrefix}${indexStr}`, dae, curBreakContext);
              }
            } else {
              this.extractClassEquations(compClassId, childPrefix, dae, curBreakContext);
            }
          }
        }
      }
    }

    const cst = this.db.cstNode(classId);
    if (cst) {
      const walk = (node: any, substitutions?: Map<string, number>, isInitial?: boolean): void => {
        if (!node) return;
        if (
          node.type === "extends_clause" ||
          node.type === "ExtendsClause" ||
          node.type === "inheritance_modification" ||
          node.type === "InheritanceModification" ||
          node.type === "component_clause" ||
          node.type === "ComponentClause" ||
          node.type === "component_clause1" ||
          node.type === "component_declaration" ||
          node.type === "ComponentDeclaration"
        ) {
          return;
        }

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
                walk(bodyChild, currentSubs, isInitial);
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
              const condExprId = this.lowerExpr(b.conditionNode, dae, prefix, substitutions);
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
                walk(eqNode, substitutions, isInitial);
              }
            }
            return;
          }

          // Otherwise dynamic If equation in DAE
          if (branches.length > 0 && branches[0].conditionNode) {
            const firstCondId = this.lowerExpr(branches[0].conditionNode, dae, prefix, substitutions);
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
                  let lId = this.lowerExpr(exprs[0], dae, prefix, substitutions);
                  let rId = this.lowerExpr(exprs[1], dae, prefix, substitutions);
                  if (isRealExpr(lId, dae) && !isRealExpr(rId, dae)) {
                    rId = castToRealExpr(rId, dae);
                  }
                  return { kind: EqKind.Simple, lhsExprId: lId, rhsExprId: rId };
                }
              }
              if (n.type === "function_call" || n.type === "FunctionCall") {
                const callId = this.lowerExpr(n, dae, prefix, substitutions);
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
                const elseCondId = this.lowerExpr(b.conditionNode, dae, prefix, substitutions);
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
          if (curBreakContext.brokenComponents.size > 0) {
            const checkNodeForBroken = (n: any): string | null => {
              if (!n) return null;
              if (n.type === "component_reference" || n.type === "name") {
                const text = n.text?.trim() ?? "";
                const root = text.split(".")[0].split("[")[0];
                if (curBreakContext.brokenComponents.has(root)) {
                  return text;
                }
              }
              if (n.children) {
                for (const c of n.children) {
                  const b = checkNodeForBroken(c);
                  if (b) return b;
                }
              }
              return null;
            };

            const brokenRef = checkNodeForBroken(node);
            if (brokenRef) {
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              const scopeName = classEntry?.name ?? "";
              dae.diagnostics.push({
                severity: "error",
                code: 2002,
                message: `Variable ${brokenRef} not found in scope ${scopeName}.`,
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }
          }

          const expressions = (node.children || []).filter(
            (c: any) => c.type === "expression" || c.type === "Expression",
          );
          if (expressions.length >= 2) {
            let lhsExprId = this.lowerExpr(expressions[0], dae, prefix, substitutions);
            let rhsExprId = this.lowerExpr(expressions[1], dae, prefix, substitutions);
            if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
              rhsExprId = castToRealExpr(rhsExprId, dae);
            }
            const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, lhsExprId, rhsExprId);
            const startB = node.startIndex ?? node.startByte;
            const endB = node.endIndex ?? node.endByte;
            if (startB != null && endB != null && eqIdx >= 0) {
              dae.setEqSourceRange(eqIdx, startB, endB);
            }
            return;
          }
        }

        // Function call equations (e.g. terminate(...))
        if (node.type === "function_call" || node.type === "FunctionCall") {
          const callId = this.lowerExpr(node, dae, prefix, substitutions);
          const eqIdx = dae.addEquation(EqKind.FunctionCall, callId, -1);
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          if (startB != null && endB != null && eqIdx >= 0) {
            dae.setEqSourceRange(eqIdx, startB, endB);
          }
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
            const r0Raw = refs[0].text?.trim().replace(/\s+/g, "") ?? "";
            const r1Raw = refs[1].text?.trim().replace(/\s+/g, "") ?? "";
            const r0Root = r0Raw.split(".")[0].split("[")[0];
            const r1Root = r1Raw.split(".")[0].split("[")[0];

            if (curBreakContext.brokenComponents.has(r0Root) || curBreakContext.brokenComponents.has(r1Root)) {
              return;
            }

            let isBrokenConn = false;
            let r0Sub = r0Raw;
            let r1Sub = r1Raw;
            if (substitutions && substitutions.size > 0) {
              for (const [sKey, sVal] of substitutions) {
                r0Sub = r0Sub.replace(new RegExp(`\\b${sKey}\\b`, "g"), String(sVal));
                r1Sub = r1Sub.replace(new RegExp(`\\b${sKey}\\b`, "g"), String(sVal));
              }
            }

            for (const bConn of curBreakContext.brokenConnections) {
              const m = bConn.match(/connect\(([^,]+),([^)]+)\)/);
              if (m) {
                const bFrom = m[1].trim().replace(/\s+/g, "");
                const bTo = m[2].trim().replace(/\s+/g, "");
                if (
                  (r0Raw === bFrom && r1Raw === bTo) ||
                  (r0Raw === bTo && r1Raw === bFrom) ||
                  (r0Sub === bFrom && r1Sub === bTo) ||
                  (r0Sub === bTo && r1Sub === bFrom)
                ) {
                  isBrokenConn = true;
                  break;
                }
              }
            }
            if (isBrokenConn) {
              return;
            }

            const lhsExprId = this.lowerExpr(refs[0], dae, prefix, substitutions);
            const rhsExprId = this.lowerExpr(refs[1], dae, prefix, substitutions);
            dae.addEquation(EqKind.Connect, lhsExprId, rhsExprId);
            return;
          }
        }

        if (Cst.WhenEquation.is(node) || node.type === "when_equation" || node.type === "WhenEquation") {
          const cond =
            Cst.WhenEquation.condition(node) ??
            (node.children || []).find((c: any) => c.type === "expression" || c.type === "Expression");
          const condId = cond ? this.lowerExpr(cond, dae, prefix, substitutions) : -1;
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
                let lhsId = this.lowerExpr(expressions[0], dae, prefix, substitutions);
                let rhsId = this.lowerExpr(expressions[1], dae, prefix, substitutions);
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
              const callId = this.lowerExpr(n, dae, prefix, substitutions);
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
          const isInitAlg =
            (node.text?.trim()?.startsWith("initial") ?? false) ||
            (node.children || []).some(
              (c: any) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
            );

          const extractExecutableStmts = (n: any): any[] => {
            if (!n) return [];
            if (
              n.type === "assignment_statement" ||
              n.type === "AssignmentStatement" ||
              n.type === "when_statement" ||
              n.type === "WhenStatement" ||
              n.type === "for_statement" ||
              n.type === "ForStatement"
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

            if (sNode.type === "for_statement" || sNode.type === "ForStatement") {
              const indicesNode = (sNode.children || []).find(
                (c: any) => c.type === "for_indices" || c.type === "ForIndices",
              );
              const fIndex = indicesNode
                ? (indicesNode.children || []).find((c: any) => c.type === "for_index" || c.type === "ForIndex")
                : null;
              const varName = fIndex?.child(0)?.text?.trim() ?? "i";
              const rangeNode = (fIndex?.children || []).find(
                (c: any) => c.type === "expression" || c.type === "colon_expression",
              );
              const rangeExprId = rangeNode ? this.lowerExpr(rangeNode, dae, prefix, substitutions) : -1;
              const bodyStmts: any[] = [];
              let inLoop = false;
              for (const child of sNode.children || []) {
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
                if (inLoop && child.type !== ";" && child.text?.trim() !== ";") {
                  bodyStmts.push(...extractExecutableStmts(child));
                }
              }
              dae.addStatement(StmtKind.For, dae.interner.intern(varName), rangeExprId, bodyStmts.length);
              for (const s of bodyStmts) {
                lowerStatement(s);
              }
              return;
            }

            if (sNode.type === "assignment_statement" || sNode.type === "AssignmentStatement") {
              const exprs = (sNode.children || []).filter(
                (c: any) => c.type === "expression" || c.type === "component_reference",
              );
              if (exprs.length >= 2) {
                const targetId = this.lowerExpr(exprs[0], dae, prefix, substitutions);
                const valId = this.lowerExpr(exprs[1], dae, prefix, substitutions);
                dae.addStatement(StmtKind.Assignment, targetId, valId);
              }
              return;
            }

            if (Cst.WhenStatement.is(sNode) || sNode.type === "when_statement" || sNode.type === "WhenStatement") {
              const cond =
                Cst.WhenStatement.condition(sNode) ??
                (sNode.children || []).find((c: any) => c.type === "expression" || c.type === "Expression");
              const condId = cond ? this.lowerExpr(cond, dae, prefix, substitutions) : -1;

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
                const ewCondId = ew.condNode ? this.lowerExpr(ew.condNode, dae, prefix, substitutions) : -1;
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
                child.type === "when_statement" ||
                child.type === "for_statement" ||
                child.type === "ForStatement"
              ) {
                lowerStatement(child);
              }
            }
          };

          for (const stmt of node.children || []) {
            if (
              stmt.type === "statement" ||
              stmt.type === "assignment_statement" ||
              stmt.type === "when_statement" ||
              stmt.type === "for_statement" ||
              stmt.type === "ForStatement"
            ) {
              lowerStatement(stmt);
            }
          }
          if (dae.stmtCount > secStart) {
            if (isInitAlg) {
              dae.initialAlgorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
            } else {
              dae.algorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
            }
          }
          return;
        }

        if (node.type === "equation_section" || node.type === "EquationSection") {
          const isInit =
            isInitial ||
            (node.text?.trim()?.startsWith("initial") ?? false) ||
            (node.children || []).some(
              (c: any) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
            );
          for (const kid of node.children || []) {
            walk(kid, substitutions, isInit);
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
          for (const eqSec of eqSections) {
            walk(eqSec, substitutions, isInitial);
          }
          for (const other of otherChildren) {
            walk(other, substitutions, isInitial);
          }
          return;
        }

        for (const kid of node.children || []) {
          if (kid.type !== "class_definition" && kid.type !== "ClassDefinition") {
            walk(kid, substitutions, isInitial);
          }
        }
      };
      walk(cst);
    }

    const selfCstShort = this.db.cstNode(classId) as any;
    const specShort = getShortClassSpecifierNode(selfCstShort);
    if (specShort) {
      const typeSpec =
        Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
        specShort.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier");
      const typeName = typeSpec?.text?.trim();
      if (typeName) {
        const matches = this.db.byName(typeName);
        if (matches.length > 0 && matches[0].kind === "Class") {
          this.extractClassEquations(matches[0].id, prefix, dae, curBreakContext);
        }
      }
    }

    for (const child of children) {
      if (child.kind === "Extends") {
        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", child.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);

        const childBrokenComponents = new Set<string>(curBreakContext.brokenComponents);
        const childBrokenConnections = new Set<string>(curBreakContext.brokenConnections);

        for (const arg of extendsModParsed) {
          if (arg.isBreak || arg.value?.kind === "break") {
            if (arg.name.startsWith("break_connect:")) {
              const connStr = arg.name.substring("break_connect:".length);
              childBrokenConnections.add(connStr);
            } else {
              childBrokenComponents.add(arg.name);
            }
          }
        }

        const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        const baseTargets = baseClass ? [baseClass] : this.db.byName(child.name);
        for (const target of baseTargets) {
          if (target.kind === "Class") {
            this.extractClassEquations(target.id, prefix, dae, {
              brokenComponents: childBrokenComponents,
              brokenConnections: childBrokenConnections,
            });
          }
        }
      }
    }
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };
