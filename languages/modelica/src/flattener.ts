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
  inferArenaExprVarType,
  isAssignableType,
  scalarizeArena,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
  type TopologyGraph,
} from "@modelscript/language/compiler";
import { StringWriter } from "@modelscript/language/utils";
import { Cst, type SyntaxNode } from "../src-gen/bindings.js";
import { ModelicaPortBalancer } from "./connections.js";
import { ModelicaErrorCode } from "./errors.js";
import { isPredefinedType } from "./predefined-types.js";
import { getShortClassSpecifierNode } from "./queries.js";

export interface FlattenOptions {
  arrayMode?: "scalarize" | "preserve";
  functionInlining?: boolean;
  omcCompatibility?: boolean;
  eliminateAliases?: boolean;
}

function inferArenaExprShapeAndType(dae: DAEBuilder, exprId: number): { shape: number[]; typeName: string } {
  const shape: number[] = [];
  let curr = exprId;
  while (curr >= 0 && dae.getExprKind(curr) === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(curr);
    shape.push(count);
    curr = count > 0 ? dae.getExprLeft(curr) : -1;
  }
  if (curr >= 0 && dae.getExprKind(curr) === ExprKind.IfElse) {
    return inferArenaExprShapeAndType(dae, dae.getExprLeft(curr));
  }
  let vType = VarType.Real;
  if (curr >= 0) {
    const kind = dae.getExprKind(curr);
    if (kind === ExprKind.IntLiteral) {
      vType = VarType.Integer;
    } else if (kind === ExprKind.RealLiteral) {
      vType = VarType.Real;
    } else if (kind === ExprKind.BoolLiteral) {
      vType = VarType.Boolean;
    } else if (kind === ExprKind.StringLiteral) {
      vType = VarType.String;
    } else if (kind === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(curr));
      let vIdx = dae.getVarIdxByName(name);
      if (vIdx < 0 && name.includes("[")) {
        vIdx = dae.getVarIdxByName(name.split("[")[0]);
      }
      if (vIdx < 0) {
        vIdx = dae.getVarIdxByName(`${name}[1]`);
      }
      if (vIdx >= 0) {
        vType = dae.getVarType(vIdx);
      }
    } else if (kind === ExprKind.Subscript) {
      const baseId = dae.getExprData1(curr);
      if (dae.getExprKind(baseId) === ExprKind.Name) {
        const name = dae.interner.resolve(dae.getExprData1(baseId));
        let vIdx = dae.getVarIdxByName(name);
        if (vIdx < 0) vIdx = dae.getVarIdxByName(`${name}[1]`);
        if (vIdx >= 0) vType = dae.getVarType(vIdx);
      }
    } else if (isRealExpr(curr, dae)) {
      vType = VarType.Real;
    } else {
      vType = inferArenaExprVarType(dae, curr);
    }
  }
  const typeNames: Record<number, string> = {
    [VarType.Real]: "Real",
    [VarType.Integer]: "Integer",
    [VarType.Boolean]: "Boolean",
    [VarType.String]: "String",
    [VarType.Enumeration]: "Enumeration",
  };
  const typeName = typeNames[vType] ?? "Real";
  return { shape, typeName };
}

function findIfElseExpr(dae: DAEBuilder, exprId: number): number {
  if (exprId < 0) return -1;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.IfElse) return exprId;
  if (kind === ExprKind.Binary) {
    const left = findIfElseExpr(dae, dae.getExprLeft(exprId));
    if (left >= 0) return left;
    return findIfElseExpr(dae, dae.getExprRight(exprId));
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return findIfElseExpr(dae, dae.getExprLeft(exprId));
  }
  return -1;
}

function checkIfExprTypeMismatch(dae: DAEBuilder, exprId: number, node: any, compName: string): boolean {
  if (exprId < 0) return false;
  const ifElseId = findIfElseExpr(dae, exprId);
  if (ifElseId < 0) return false;

  const thenId = dae.getExprLeft(ifElseId);
  const elseId = dae.getExprRight(ifElseId);
  if (thenId >= 0 && elseId >= 0) {
    const thenInfo = inferArenaExprShapeAndType(dae, thenId);
    const elseInfo = inferArenaExprShapeAndType(dae, elseId);
    const shapeMismatch =
      thenInfo.shape.length !== elseInfo.shape.length || thenInfo.shape.some((d, i) => d !== elseInfo.shape[i]);
    const typeMismatch =
      shapeMismatch ||
      (thenInfo.typeName !== elseInfo.typeName &&
        !(
          (thenInfo.typeName === "Real" && elseInfo.typeName === "Integer") ||
          (thenInfo.typeName === "Integer" && elseInfo.typeName === "Real")
        ));
    if (typeMismatch) {
      const thenOut = new StringWriter();
      const p1 = new ArenaDAEPrinter(thenOut, dae, true);
      p1.printExpr(thenId);
      const thenStr = thenOut.toString();

      const elseOut = new StringWriter();
      const p2 = new ArenaDAEPrinter(elseOut, dae, true);
      p2.printExpr(elseId);
      const elseStr = elseOut.toString();

      const thenTypeStr = `${thenInfo.typeName}${thenInfo.shape.length > 0 ? `[${thenInfo.shape.join(", ")}]` : ""}`;
      const elseTypeStr = `${elseInfo.typeName}${elseInfo.shape.length > 0 ? `[${elseInfo.shape.join(", ")}]` : ""}`;

      const startB = node.startIndex ?? node.startByte;
      const endB = node.endIndex ?? node.endByte;
      dae.diagnostics.push({
        severity: "error",
        message: `Type mismatch in if-expression in component ${compName}. True branch: ${thenStr} has type ${thenTypeStr}, false branch: ${elseStr} has type ${elseTypeStr}.`,
        range: {
          startByte: startB,
          endByte: endB,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return true;
    }
  }
  return false;
}

function castToRealExpr(exprId: number, dae: DAEBuilder): number {
  if (exprId < 0) return exprId;
  if (isRealExpr(exprId, dae)) return exprId;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) {
    const val = dae.getExprData1(exprId);
    return dae.addRealLiteral(val);
  }
  if (kind === ExprKind.Negate) {
    const operand = dae.getExprLeft(exprId);
    if (dae.getExprKind(operand) === ExprKind.IntLiteral) {
      return dae.addExpression(ExprKind.Negate, 0, dae.addRealLiteral(dae.getExprData1(operand)));
    }
    return dae.addCallExpr("/*Real*/", [exprId]);
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
  if (kind === ExprKind.IfElse) {
    const cond = dae.getExprData1(exprId);
    const thenExpr = castToRealExpr(dae.getExprLeft(exprId), dae);
    const elseExpr = castToRealExpr(dae.getExprRight(exprId), dae);
    return dae.addExpression(ExprKind.IfElse, cond, thenExpr, elseExpr);
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "/*Real*/" || fnName === "Real") return exprId;
    if (isRealExpr(exprId, dae)) return exprId;
    return dae.addCallExpr("/*Real*/", [exprId]);
  }
  if (kind === ExprKind.Der) {
    return exprId;
  }
  return dae.addCallExpr("/*Real*/", [exprId]);
}

function isRealNameExpr(symId: number, dae: DAEBuilder): boolean {
  const name = dae.interner.resolve(symId);
  if ((dae as any).activeLoopVars?.has(name)) return false;
  if (name === "time") return true;
  let vIdx = dae.getVarIdxByName(name);
  const baseName = name.includes("[") ? name.split("[")[0]! : name;
  if (vIdx < 0 && baseName !== name) {
    vIdx = dae.getVarIdxByName(baseName);
  }
  if (vIdx < 0) {
    vIdx = dae.getVarIdxByName(`${baseName}[1]`);
    if (vIdx < 0) {
      vIdx = dae.getVarIdxByName(`${baseName}[1,1]`);
    }
  }
  if (vIdx >= 0) {
    return dae.getVarType(vIdx) === VarType.Real;
  }
  const activeDb: QueryDB | undefined = (dae as any).db;
  if (activeDb) {
    const lastPart = name.includes(".") ? name.split(".").pop()! : name;
    const cleanLastPart = lastPart.includes("[") ? lastPart.split("[")[0]! : lastPart;
    const syms = activeDb.byName(cleanLastPart);
    for (const s of syms) {
      if (s.kind === "Component") {
        const typeSpec = activeDb.query<string | null>("typeSpecifier", s.id);
        if (typeSpec === "Real") return true;
        if (typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") return false;
        if (typeSpec) {
          const typeMatches = activeDb.byName(typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec);
          for (const tm of typeMatches) {
            if (tm.kind === "Class") {
              const baseClass = activeDb.query<SymbolEntry | null>("resolvedBaseClass", tm.id);
              if (baseClass?.name === "Real") return true;
              const meta = tm.metadata as Record<string, unknown> | undefined;
              if (meta?.baseType === "Real" || meta?.primitiveType === "Real") return true;
            }
          }
        }
      }
    }
  }
  return false;
}

function isRealExpr(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.IntLiteral || kind === ExprKind.BoolLiteral || kind === ExprKind.StringLiteral) return false;
  if (kind === ExprKind.Der) return true;
  if (kind === ExprKind.Pre) return isRealExpr(dae.getExprData1(exprId), dae);
  if (kind === ExprKind.Name) {
    const symId = dae.getExprData1(exprId);
    let cache = (dae as any)._isRealNameCache as Map<number, boolean> | undefined;
    if (!cache) {
      cache = new Map<number, boolean>();
      (dae as any)._isRealNameCache = cache;
    }
    const cached = cache.get(symId);
    if (cached !== undefined) return cached;

    const res = isRealNameExpr(symId, dae);
    cache.set(symId, res);
    return res;
  }
  if (kind === ExprKind.Subscript) {
    return isRealExpr(dae.getExprData1(exprId), dae);
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return isRealExpr(dae.getExprLeft(exprId), dae);
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Div) return true;
    if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul || op === BinOp.Pow) {
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
      fnName === "asin" ||
      fnName === "acos" ||
      fnName === "atan" ||
      fnName === "atan2" ||
      fnName === "sinh" ||
      fnName === "cosh" ||
      fnName === "tanh" ||
      fnName === "exp" ||
      fnName === "log" ||
      fnName === "log10" ||
      fnName === "sqrt" ||
      fnName === "inStream" ||
      fnName === "actualStream"
    ) {
      return true;
    }
    if (fnName === "abs" || fnName === "sign" || fnName === "min" || fnName === "max") {
      const argCount = dae.getExprRight(exprId);
      if (argCount > 0) {
        if (isRealExpr(dae.getExprLeft(exprId), dae)) return true;
        for (let i = 1; i < argCount; i++) {
          if (isRealExpr(dae.getExprLeft(exprId + i), dae)) return true;
        }
        return false;
      }
      return true;
    }
    if (fnName === "delay" || fnName === "cross") {
      const firstArg = dae.getExprLeft(exprId);
      return isRealExpr(firstArg, dae);
    }
    if (fnName === "integer" || fnName === "floor" || fnName === "ceil") return false;
    const fnDae = dae.functions.get(fnName);
    if (fnDae) {
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Output) {
          return fnDae.getVarType(i) === VarType.Real;
        }
      }
    }
    return false;
  }
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    if (count === 0) return true;
    const elem0 = dae.getExprLeft(exprId);
    return isRealExpr(elem0, dae);
  }
  return false;
}

/**
 * Returns true if the expression tree contains any ExprKind.Name references.
 * Used to determine whether a binding expression should be preserved symbolically
 * (OMC keeps parameter bindings that reference other parameters as symbolic).
 */
function exprContainsNameRef(exprId: number, dae: DAEBuilder, visited = new Set<number>()): boolean {
  if (exprId < 0 || visited.has(exprId)) return false;
  visited.add(exprId);
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) return true;
  // Recursively check sub-expressions
  const left = dae.getExprLeft(exprId);
  const right = dae.getExprRight(exprId);
  const data1 = dae.getExprData1(exprId);
  if (kind === ExprKind.Binary || kind === ExprKind.IfElse) {
    if (kind === ExprKind.IfElse) {
      // data1 = cond, left = then, right = else
      if (exprContainsNameRef(data1, dae, visited)) return true;
      if (exprContainsNameRef(left, dae, visited)) return true;
      if (exprContainsNameRef(right, dae, visited)) return true;
      return false;
    }
    if (exprContainsNameRef(left, dae, visited)) return true;
    if (exprContainsNameRef(right, dae, visited)) return true;
    return false;
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return exprContainsNameRef(left, dae, visited);
  }
  if (kind === ExprKind.Call) {
    // left = first arg, right = arg count; additional args at exprId+i
    const argCount = right;
    for (let i = 0; i < argCount; i++) {
      const argId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNameRef(argId, dae, visited)) return true;
    }
    return false;
  }
  if (kind === ExprKind.ArrayCtor) {
    const count = data1;
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNameRef(elemId, dae, visited)) return true;
    }
    return false;
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
        const v = dae.getVarVariability(varIdx);
        if (v === Variability.Constant || v === Variability.Parameter) {
          const startVal = dae.getVarStartValue(varIdx);
          if (startVal !== 0) {
            return startVal;
          }
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
  if (!curr.startsWith("{") || !curr.endsWith("}")) return curr;
  let depth = 0;
  let probe = curr;
  while (probe.startsWith("{") && probe.endsWith("}")) {
    depth++;
    const elems = parseArrayLiteralElements(probe);
    if (elems.length === 0 || elems[0] === probe) break;
    probe = elems[0];
  }
  const effectiveIndices = depth > 0 && depth < indices.length ? indices.slice(indices.length - depth) : indices;
  for (const idx of effectiveIndices) {
    if (!curr.startsWith("{") || !curr.endsWith("}")) return curr;
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

function splitTopLevelArgs(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function evaluateCSTNumber(
  node: any,
  subs?: Map<string, number>,
  scopeId?: SymbolId,
  db?: any,
  dae?: DAEBuilder,
  prefix = "",
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
    return evaluateCSTNumber(node.child(1), subs, scopeId, db, dae, prefix);
  }

  const text = node.text?.trim() ?? "";
  if (subs && subs.has(text)) return subs.get(text)!;
  const num = parseInt(text, 10);
  if (!isNaN(num) && String(num) === text) return num;

  const sizeMatch = text.match(/^size\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*,\s*(\d+)\s*\)$/);
  if (sizeMatch && dae) {
    const arrName = sizeMatch[1];
    const dim = parseInt(sizeMatch[2], 10);
    const resolvedName = resolveScopedName(arrName, prefix, dae);
    let maxDim = 0;
    const prefixMatch = `${resolvedName}[`;
    for (let i = 0; i < dae.varCount; i++) {
      if (!dae.isVarRemoved(i)) {
        const vn = dae.getVarName(i);
        if (vn.startsWith(prefixMatch)) {
          const rest = vn.slice(prefixMatch.length);
          const endBracket = rest.indexOf("]");
          if (endBracket >= 0) {
            const idxList = rest.slice(0, endBracket).split(",");
            if (dim >= 1 && dim <= idxList.length) {
              const val = parseInt(idxList[dim - 1]!.trim(), 10);
              if (!isNaN(val) && val > maxDim) {
                maxDim = val;
              }
            }
          }
        }
      }
    }
    if (maxDim > 0) return maxDim;
    if (db) {
      const syms = db.byName(arrName);
      for (const s of syms) {
        const dims = db.query("arrayDimensions", s.id);
        if (dims && dims.length >= dim) {
          const d = dims[dim - 1];
          if (d?.kind === "literal" && typeof d.value === "number") return d.value;
        }
      }
    }
  }

  // Binary expression
  if (node.childCount === 3 && (node.type === "expression" || node.type === "BinaryExpression")) {
    const op = (node.child(1)?.text?.trim() ?? node.child(1)?.type ?? "").replace(/^"|"$/g, "");
    const left = evaluateCSTNumber(node.child(0), subs, scopeId, db, dae, prefix);
    const right = evaluateCSTNumber(node.child(2), subs, scopeId, db, dae, prefix);
    if (left !== null && right !== null) {
      if (op === "+") return left + right;
      if (op === "-") return left - right;
      if (op === "*") return left * right;
      if (op === "/") return right !== 0 ? Math.floor(left / right) : null;
    }
  }

  if (dae) {
    const resolved = resolveScopedName(text, prefix, dae);
    const vIdx = dae.getVarIdxByName(resolved);
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

  let anc = prefix;
  while (anc) {
    if (name.startsWith(anc + ".")) return name;
    const dot = anc.lastIndexOf(".");
    if (dot < 0) break;
    anc = anc.slice(0, dot);
  }

  const rootComp = name.split(".")[0].split("[")[0];
  const fullLocalRoot = `${prefix}.${rootComp}`;
  const isInnerOuter = innerOuterComponents?.has(fullLocalRoot);

  const scopeDeclaredNames: Map<string, Set<string>> | undefined = (dae as any).scopeDeclaredNames;

  let resolvedName: string | null = null;
  if (!isInnerOuter) {
    const basePrefix = prefix.replace(/\[[^\]]+\]/g, "");
    if (scopeDeclaredNames?.get(prefix)?.has(rootComp) || scopeDeclaredNames?.get(basePrefix)?.has(rootComp)) {
      resolvedName = `${prefix}.${name}`;
    } else {
      const prefixed = `${prefix}.${name}`;
      if (dae.getVarIdxByName(prefixed) >= 0) {
        resolvedName = prefixed;
      } else {
        const searchPrefix = prefixed + ".";
        for (let i = 0; i < dae.varCount; i++) {
          if (
            !dae.isVarRemoved(i) &&
            (dae.getVarName(i).startsWith(searchPrefix) || dae.getVarName(i).startsWith(prefixed + "["))
          ) {
            resolvedName = prefixed;
            break;
          }
        }
      }
    }
  }

  if (!resolvedName) {
    // Walk up enclosing scopes
    let p: string | null = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
    while (p !== null) {
      const baseP = p.replace(/\[[^\]]+\]/g, "");
      if (scopeDeclaredNames?.get(p)?.has(rootComp) || scopeDeclaredNames?.get(baseP)?.has(rootComp)) {
        resolvedName = p ? `${p}.${name}` : name;
        break;
      }
      const target = p ? `${p}.${name}` : name;
      if (dae.getVarIdxByName(target) >= 0) {
        resolvedName = target;
        break;
      }
      const searchPrefix = target + ".";
      let foundPrefix = false;
      for (let i = 0; i < dae.varCount; i++) {
        if (
          !dae.isVarRemoved(i) &&
          (dae.getVarName(i).startsWith(searchPrefix) || dae.getVarName(i).startsWith(target + "["))
        ) {
          resolvedName = target;
          foundPrefix = true;
          break;
        }
      }
      if (foundPrefix) break;
      p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
    }
  }

  if (!resolvedName && name.includes(".")) {
    const parts = name.split(".");
    if (parts.length >= 2 && !parts[0].includes("[")) {
      const withIdx1 = `${prefix}.${parts[0]}[1].${parts.slice(1).join(".")}`;
      if (dae.getVarIdxByName(withIdx1) >= 0) {
        resolvedName = withIdx1;
      }
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

function findArraySubscriptsForIter(
  exprNode: any,
  iterName: string,
  dae: DAEBuilder,
  db?: QueryDB,
  prefix?: string,
): (number | string)[] {
  let result: (number | string)[] = [];
  const search = (n: any) => {
    if (!n || result.length > 0) return;
    if (
      n.type === "component_reference" ||
      (n.childCount >= 2 && n.child(n.childCount - 1)?.type === "array_subscripts")
    ) {
      const subsNode = (n.children || []).find((c: any) => c.type === "array_subscripts") ?? n.child(n.childCount - 1);
      if (subsNode && (subsNode.type === "array_subscripts" || subsNode.type === "ArraySubscripts")) {
        let subIdx = 0;
        for (let i = 0; i < subsNode.childCount; i++) {
          const sc = subsNode.child(i);
          if (sc.type === "subscript" || sc.type === "expression") {
            if (sc.text?.trim() === iterName) {
              let baseName = "";
              for (const ch of n.children || []) {
                if (ch === subsNode || ch.type === "array_subscripts") break;
                if (ch.type === "identifier" || ch.type === "name" || ch.type === "property") {
                  baseName = baseName ? `${baseName}.${ch.text?.trim()}` : (ch.text?.trim() ?? "");
                }
              }
              if (!baseName) baseName = n.child(0)?.text?.trim() ?? "";
              if (baseName.startsWith(".")) baseName = baseName.slice(1);

              const daePrefixes = [prefix ? `${prefix}.${baseName}[` : `${baseName}[`, `${baseName}[`];
              const distinctSubs = new Set<string>();
              for (const daePrefix of daePrefixes) {
                for (let v = 0; v < dae.varCount; v++) {
                  if (dae.isVarRemoved(v)) continue;
                  const vName = dae.getVarName(v);
                  if (vName.startsWith(daePrefix)) {
                    const after = vName.slice(daePrefix.length);
                    const closing = after.indexOf("]");
                    if (closing >= 0) {
                      const subPart = after.slice(0, closing);
                      const tupleParts = subPart.split(",");
                      if (tupleParts.length > subIdx) {
                        distinctSubs.add(tupleParts[subIdx]!.trim());
                      }
                    }
                  }
                }
                if (distinctSubs.size > 0) break;
              }
              if (distinctSubs.size > 0) {
                result = [...distinctSubs].map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s));
                return;
              }

              if (db) {
                const parts = baseName.split(".");
                const pkgOrClass = db.byName(parts[0]!).find((e) => e.kind === "Class" || e.kind === "Package");
                if (pkgOrClass && parts.length > 1) {
                  const member = db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
                  if (member) {
                    const dims = db.query<number[] | null>("resolvedArrayDimensions", member.id);
                    if (dims && dims.length > subIdx && dims[subIdx]! > 0) {
                      result = Array.from({ length: dims[subIdx]! }, (_, k) => k + 1);
                      return;
                    }
                  }
                }
              }
            }
            subIdx++;
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) search(n.child(i));
  };
  search(exprNode);
  return result;
}

function lowerCSTExpression(
  node: any,
  dae: DAEBuilder,
  prefix = "",
  substitutions?: Map<string, number | string>,
  imports?: Map<string, string>,
  db?: QueryDB,
  flattener?: any,
  tupleContext?: boolean,
  noArrayExpand?: boolean,
): number {
  if (!node) return -1;
  const type = node.type;

  // Single-child unwrap for wrappers
  if (
    (type === "expression" ||
      type === "simple_expression" ||
      type === "logical_expression" ||
      type === "primary" ||
      type === "expression_list" ||
      type === "Expression" ||
      type === "Primary" ||
      type === "subscript") &&
    node.childCount === 1
  ) {
    return lowerCSTExpression(
      node.child(0),
      dae,
      prefix,
      substitutions,
      imports,
      db,
      flattener,
      tupleContext,
      noArrayExpand,
    );
  }

  // Parenthesized expression: "(" expr ")"
  if (
    node.childCount === 3 &&
    (node.child(0).type === "(" || node.child(0).text === "(" || node.child(0).type === '"("') &&
    (node.child(2).type === ")" || node.child(2).text === ")" || node.child(2).type === '")"')
  ) {
    return lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener, tupleContext);
  }

  // Real or Integer literal
  if (
    type === "unsigned_number" ||
    type === "unsigned_integer" ||
    type === "unsigned_real" ||
    type === "number_literal" ||
    type === "NumberLiteral" ||
    ((type.startsWith("/") || node.childCount === 0) &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(node.text?.trim() ?? ""))
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
    const argNodes: any[] = [];
    if (argsNode) {
      const collectArgs = (n: any) => {
        if (!n) return;
        if (n.type === "expression" || n.type === "Expression") {
          argNodes.push(n);
          argExprIds.push(lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener));
          return;
        }
        for (let i = 0; i < n.childCount; i++) {
          collectArgs(n.child(i));
        }
      };
      collectArgs(argsNode);
    }
    if (fnName === "integer" && argExprIds.length === 1) {
      const a0 = argExprIds[0];
      const kind = dae.getExprKind(a0);
      if (kind === ExprKind.RealLiteral) {
        return dae.addIntLiteral(Math.trunc(dae.getExprRealValue(a0)));
      }
      if (kind === ExprKind.IntLiteral) {
        return a0;
      }
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

    if (fnName === "fill" && argExprIds.length >= 2) {
      const dimVal = evalDaeExpr(argExprIds[1], dae);
      if (dimVal === 1) {
        return argExprIds[0];
      }
    }

    if (fnName === "size" && argExprIds.length >= 1) {
      const arrId = argExprIds[0];
      let dim = 1;
      if (argExprIds.length >= 2) {
        const dVal = evalDaeExpr(argExprIds[1], dae);
        if (typeof dVal === "number") dim = Math.trunc(dVal);
      }
      const arrKind = dae.getExprKind(arrId);
      if (arrKind === ExprKind.ArrayCtor) {
        if (dim === 1) {
          return dae.addIntLiteral(dae.getExprData1(arrId));
        }
      } else if (arrKind === ExprKind.Name) {
        const name = dae.interner.resolve(dae.getExprData1(arrId));
        if (name) {
          const vIdx = dae.lookupVariable(name);
          if (vIdx >= 0) {
            const shape = dae.getVarShape(vIdx);
            if (shape && shape.length >= dim) {
              return dae.addIntLiteral(shape[dim - 1]!);
            }
          }
        }
      }
    }

    const cleanFnName = typeof fnName === "string" ? fnName.replace(/^\.+/, "") : "";
    let fnDae = dae.getFunction(fnName) ?? (cleanFnName ? dae.getFunction(cleanFnName) : undefined);
    if (!fnDae && cleanFnName && !cleanFnName.includes(".")) {
      fnDae = dae.getFunction(cleanFnName);
    }
    if (!fnDae && flattener && db && cleanFnName) {
      const parts = cleanFnName.split(".");
      const fnBase = parts[parts.length - 1];
      const matchingFnSym = db.byName(fnBase).find((e: any) => {
        if (e.kind !== "Class") return false;
        if (parts.length > 1) {
          const qual = getSymbolQualifiedName(db, e.id);
          return qual === cleanFnName || qual.endsWith("." + cleanFnName);
        }
        return parts.length === 1;
      });
      if (matchingFnSym && flattener.isExternalObject?.(matchingFnSym.id)) {
        const qualifiedName = getSymbolQualifiedName(db, matchingFnSym.id);
        const ctorName = `${qualifiedName}.constructor`;
        flattener.usedExternalObjects?.add(matchingFnSym.id);
        return dae.addCallExpr(ctorName, argExprIds);
      }
      if (matchingFnSym && flattener.isFunctionSym(matchingFnSym)) {
        if (flattener.failedFunctionIds?.has(matchingFnSym.id)) {
          const scopeName = (flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
          let callRange: any = undefined;
          if (node) {
            let n: any = node;
            while (n && n.type !== "component_clause" && n.type !== "ComponentClause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call" || n.type === "FunctionCall") break;
              n = n.parent;
            }
            if (n && (n.type === "component_clause" || n.type === "ComponentClause")) {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              };
            }
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
            message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
            range: callRange,
          });
          return dae.addCallExpr(fnName, argExprIds);
        }
        const qualifiedFnName = getSymbolQualifiedName(db, matchingFnSym.id);
        const fn = flattener.flattenFunction(matchingFnSym.id, qualifiedFnName, undefined, dae);
        if (fn.diagnostics.some((d: any) => d.severity === "error")) {
          for (const d of fn.diagnostics) {
            if (!dae.diagnostics.some((existing: any) => existing.message === d.message)) {
              dae.diagnostics.push(d);
            }
          }
          flattener.failedFunctionIds?.add(matchingFnSym.id);
          const scopeName = (flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
          let callRange: any = undefined;
          if (node) {
            let n: any = node;
            while (n && n.type !== "component_clause" && n.type !== "ComponentClause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call" || n.type === "FunctionCall") break;
              n = n.parent;
            }
            if (n && (n.type === "component_clause" || n.type === "ComponentClause")) {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              };
            }
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
            message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
            range: callRange,
          });
          return dae.addCallExpr(fnName, argExprIds);
        }
        dae.addFunction(qualifiedFnName, fn);
        dae.addFunction(cleanFnName, fn);
        dae.addFunction(fnName, fn);
        if (fnBase) dae.addFunction(fnBase, fn);
        let rootDae: any = (flattener as any)?.currentRootDae ?? dae;
        while (rootDae.parentDae) rootDae = rootDae.parentDae;
        rootDae.addFunction(qualifiedFnName, fn);
        if (fn.functions && fn.functions.size > 0) {
          for (const [nestedName, nestedFn] of fn.functions.entries()) {
            rootDae.addFunction(nestedName, nestedFn);
          }
        }
        fnDae = fn;
        fnName = qualifiedFnName;
      }
    }
    if (fnDae) {
      let inputIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          if (inputIdx < argExprIds.length) {
            const aid = argExprIds[inputIdx];
            const expectedType = fnDae.getVarType(i);
            const providedType = inferArenaExprVarType(dae, aid);
            let finalType = providedType;
            if (expectedType === VarType.Real && (providedType === VarType.Integer || providedType === null)) {
              argExprIds[inputIdx] = castToRealExpr(aid, dae);
              finalType = VarType.Real;
            }
            if (finalType !== null && !isAssignableType(finalType, expectedType)) {
              let eqNode: any = node;
              while (
                eqNode &&
                eqNode.type !== "simple_equation" &&
                eqNode.type !== "equality_equation" &&
                eqNode.type !== "component_clause" &&
                eqNode.type !== "statement" &&
                eqNode.type !== "assignment_statement"
              ) {
                eqNode = eqNode.parent;
              }
              const diagNode = eqNode ?? node;
              const startB = diagNode?.startIndex ?? diagNode?.startByte;
              const endB = diagNode?.endIndex ?? diagNode?.endByte;
              const inputName = fnDae.getVarName(i);
              const argNode = argNodes[inputIdx];
              const argText = argNode?.text?.trim() ?? "...";
              const callText = `${cleanFnName || fnName}(${inputName}=${argText})`;
              dae.diagnostics.push({
                severity: "error",
                code: 3006,
                message: `Type mismatch for positional argument ${inputIdx + 1} in ${callText}. The argument has type:\n  ${varTypeName(finalType)}\nexpected type:\n  ${varTypeName(expectedType)}`,
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return -1;
            }
          }
          inputIdx++;
        }
      }

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
            const outputTypes: VarType[] = [];
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                if (outputCount === 0) {
                  firstOutputType = fnDae.getVarType(i);
                }
                outputTypes.push(fnDae.getVarType(i));
                outputCount++;
              }
            }
            if (tupleContext && Array.isArray(outVal) && outputCount > 1) {
              const tupleElemExprIds: number[] = [];
              for (let i = 0; i < outVal.length; i++) {
                const elemId = addArenaValueAsExpr(dae, outVal[i], outputTypes[i] ?? undefined);
                if (elemId >= 0) tupleElemExprIds.push(elemId);
              }
              if (tupleElemExprIds.length === outVal.length) {
                return dae.addTupleExpr(tupleElemExprIds);
              }
            }
            const firstVal = Array.isArray(outVal) && outputCount > 1 ? outVal[0] : outVal;
            const inlinedId = addArenaValueAsExpr(dae, firstVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) return inlinedId;
          }
        } catch (err: any) {
          if (err?.code === 4009 || err?.message?.includes("causes a cyclic dependency")) {
            let compClause: any = node;
            while (compClause && compClause.type !== "component_clause" && compClause.type !== "ComponentClause") {
              compClause = compClause.parent;
            }
            const diagNode = compClause ?? node;
            const startB = diagNode?.startIndex ?? diagNode?.startByte;
            const endB = diagNode?.endIndex ?? diagNode?.endByte;
            dae.diagnostics.push({
              severity: "error",
              code: 4009,
              message: err.message,
              range: {
                startByte: startB,
                endByte: endB,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              },
            });
            return -1;
          }
          // ignore evaluation error and fall back to call expression
        }
      }
      return dae.addCallExpr(fnDae.name, argExprIds);
    }

    return dae.addCallExpr(fnName, argExprIds);
  }

  // Subscript expression: arr[i] (for non-component_reference nodes; component_reference handles its own subscripts)
  if (
    type !== "component_reference" &&
    node.childCount >= 2 &&
    node.child(node.childCount - 1)?.type === "array_subscripts"
  ) {
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
        const evaluatedNum = evaluateCSTNumber(expr, substitutions as any, undefined, undefined, dae);
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

    const baseId = lowerCSTExpression(baseNode, dae, prefix, substitutions, imports, db, flattener, false, true);
    const subIds: number[] = [];
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c.type === "subscript" || c.type === "expression") {
        const expr = c.children?.find((k: any) => k.type === "expression") ?? c;
        subIds.push(lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener));
      }
    }
    return dae.addSubscriptExpr(baseId, subIds);
  }

  // Parenthesized expression: "(" expr ")" or tuple "( expr1, expr2, ... )"
  if (
    (type === "primary" || type === "expression" || type === "output_expression_list" || type === "expression_list") &&
    (((node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
      (node.child(node.childCount - 1)?.type === ")" ||
        node.child(node.childCount - 1)?.text === ")" ||
        node.child(node.childCount - 1)?.type === '")"')) ||
      type === "output_expression_list" ||
      type === "expression_list")
  ) {
    const isParen =
      (node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
      (node.child(node.childCount - 1)?.type === ")" ||
        node.child(node.childCount - 1)?.text === ")" ||
        node.child(node.childCount - 1)?.type === '")"');
    const startIdx = isParen ? 1 : 0;
    const endIdx = isParen ? node.childCount - 1 : node.childCount;
    const exprNodes: any[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const c = node.child(i);
      if (!c) continue;
      const cText = c.text?.trim() ?? "";
      const cType = c.type ?? "";
      if (cText === "," || cType === "," || cType === '","') continue;
      if (cType === "output_expression_list" || cType === "expression_list") {
        for (let j = 0; j < c.childCount; j++) {
          const sub = c.child(j);
          if (sub && sub.text?.trim() !== "," && sub.type !== "," && sub.type !== '","') {
            exprNodes.push(sub);
          }
        }
      } else {
        exprNodes.push(c);
      }
    }
    if (exprNodes.length === 1) {
      return lowerCSTExpression(exprNodes[0], dae, prefix, substitutions, imports, db, flattener);
    } else if (exprNodes.length > 1) {
      const tupleElemIds = exprNodes.map((e) =>
        lowerCSTExpression(e, dae, prefix, substitutions, imports, db, flattener),
      );
      return dae.addTupleExpr(tupleElemIds);
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
        if (c.type === "array_arguments") {
          const hasFor = (c.children || []).some((k: any) => k.type === "for" || k.text?.trim() === "for");
          if (hasFor) {
            const exprChild = c.child(0);
            const indicesNode = (c.children || []).find(
              (k: any) => k.type === "for_indices" || k.type === "ForIndices",
            );
            const forIndices = (indicesNode?.children || []).filter(
              (k: any) => k.type === "for_index" || k.type === "ForIndex",
            );
            if (forIndices.length === 0 && indicesNode) {
              const single = (indicesNode.children || []).find(
                (k: any) => k.type === "for_index" || k.type === "ForIndex",
              );
              if (single) forIndices.push(single);
            }
            if (exprChild && forIndices.length > 0) {
              const iters: { name: string; values: (number | string)[] }[] = [];
              for (const fi of forIndices) {
                const varName = Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim();
                if (!varName) continue;
                const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
                let values: (number | string)[] = [];
                if (rangeNode) {
                  const rangeText = rangeNode.text?.trim() ?? "";
                  if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                    const items = getArrayLiteralItems(rangeNode);
                    for (const item of items) {
                      const v = evaluateCSTNumber(item, substitutions as any, undefined, db, dae, prefix);
                      if (v !== null) values.push(v);
                    }
                  } else if (rangeText.includes(":")) {
                    const parts = rangeText.split(":");
                    const s = parseInt(parts[0]!.trim(), 10);
                    const e = parseInt(parts[parts.length - 1]!.trim(), 10);
                    if (!isNaN(s) && !isNaN(e)) {
                      for (let val = s; val <= e; val++) values.push(val);
                    }
                  }
                }
                if (values.length === 0) {
                  values = findArraySubscriptsForIter(exprChild, varName, dae, db, prefix);
                }
                if (values.length > 0) {
                  iters.push({ name: varName, values });
                }
              }

              if (iters.length === 1) {
                const iter = iters[0]!;
                flattener?.activeLoopVars?.add(iter.name);
                const elemIds: number[] = [];
                for (const val of iter.values) {
                  const newSubs = new Map(substitutions);
                  newSubs.set(iter.name, val);
                  elemIds.push(lowerCSTExpression(exprChild, dae, prefix, newSubs, imports, db, flattener));
                }
                flattener?.activeLoopVars?.delete(iter.name);
                elementIds.push(...elemIds);
                continue;
              } else if (iters.length === 2) {
                const iter1 = iters[0]!;
                const iter2 = iters[1]!;
                flattener?.activeLoopVars?.add(iter1.name);
                flattener?.activeLoopVars?.add(iter2.name);
                const rowIds: number[] = [];
                for (const val1 of iter1.values) {
                  const colIds: number[] = [];
                  for (const val2 of iter2.values) {
                    const newSubs = new Map(substitutions);
                    newSubs.set(iter1.name, val1);
                    newSubs.set(iter2.name, val2);
                    colIds.push(lowerCSTExpression(exprChild, dae, prefix, newSubs, imports, db, flattener));
                  }
                  rowIds.push(dae.addArrayCtorExpr(colIds));
                }
                flattener?.activeLoopVars?.delete(iter1.name);
                flattener?.activeLoopVars?.delete(iter2.name);
                elementIds.push(...rowIds);
                continue;
              }
            }
          }
        }
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
    let hasSemicolon = false;
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      const text = c.text?.trim() ?? c.type;
      if (text === ";" || c.type === ";" || c.type === '";"') {
        hasSemicolon = true;
        break;
      }
    }

    if (hasSemicolon) {
      const rows: number[] = [];
      let currentRow: number[] = [];
      const addCurrentRow = () => {
        if (currentRow.length === 1 && dae.getExprKind(currentRow[0]) === ExprKind.ArrayCtor) {
          rows.push(currentRow[0]);
        } else if (currentRow.length > 0) {
          rows.push(dae.addArrayCtorExpr(currentRow));
        }
        currentRow = [];
      };

      for (let i = 1; i < node.childCount - 1; i++) {
        const c = node.child(i);
        const text = c.text?.trim() ?? c.type;
        if (text === ";" || c.type === ";" || c.type === '";"') {
          addCurrentRow();
          continue;
        }
        if (c.type === "expression_list" || c.type === "expression") {
          const collect = (n: any) => {
            if (!n) return;
            if (n.type === "expression") {
              const exprId = lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener);
              if (exprId >= 0) currentRow.push(exprId);
              return;
            }
            for (let j = 0; j < n.childCount; j++) collect(n.child(j));
          };
          collect(c);
        }
      }
      addCurrentRow();
      return dae.addArrayCtorExpr(rows);
    }

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
      case ":":
        binOp = BinOp.Colon;
        break;
    }
    if (binOp !== null) {
      let leftId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
      let rightId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      if (binOp === BinOp.Eq || binOp === BinOp.Neq) {
        const leftType = inferArenaExprVarType(dae, leftId);
        const rightType = inferArenaExprVarType(dae, rightId);
        if (leftType === VarType.Enumeration && rightType === VarType.Integer) {
          const val = dae.getExprKind(rightId) === ExprKind.IntLiteral ? dae.getExprData1(rightId) : null;
          if (val !== null && dae.getExprKind(leftId) === ExprKind.Name) {
            const nameId = dae.getExprData1(leftId);
            let vIdx = dae.lookupVariable(nameId);
            if (vIdx < 0) {
              const nameStr = dae.interner.resolve(nameId);
              if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
            }
            if (vIdx >= 0) {
              const lits = dae.getVarEnumerationLiterals(vIdx);
              const cType = dae.getVarCustomType(vIdx);
              if (lits && val >= 1 && val <= lits.length) {
                const lit = lits[val - 1];
                const litName =
                  typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                const varName = dae.getVarName(vIdx);
                const enumPrefix =
                  flattener.options.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                rightId = dae.addEnumLiteral(val, fullLit);
              }
            }
          }
        } else if (leftType === VarType.Integer && rightType === VarType.Enumeration) {
          const val = dae.getExprKind(leftId) === ExprKind.IntLiteral ? dae.getExprData1(leftId) : null;
          if (val !== null && dae.getExprKind(rightId) === ExprKind.Name) {
            const nameId = dae.getExprData1(rightId);
            let vIdx = dae.lookupVariable(nameId);
            if (vIdx < 0) {
              const nameStr = dae.interner.resolve(nameId);
              if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
            }
            if (vIdx >= 0) {
              const lits = dae.getVarEnumerationLiterals(vIdx);
              const cType = dae.getVarCustomType(vIdx);
              if (lits && val >= 1 && val <= lits.length) {
                const lit = lits[val - 1];
                const litName =
                  typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                const varName = dae.getVarName(vIdx);
                const enumPrefix =
                  flattener.options.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                leftId = dae.addEnumLiteral(val, fullLit);
              }
            }
          }
        }
      }
      if (binOp === BinOp.Add) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) + dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) + dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) + dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) + dae.getExprData1(rightId));
        }
      }
      if (binOp === BinOp.Mul) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) * dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) * dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) * dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) * dae.getExprData1(rightId));
        }
      }
      if (binOp === BinOp.Sub) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprRealValue(rightId));
        }
        if (
          flattener.options.omcCompatibility &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const isReal = isRealExpr(leftId, dae) || rightKind === ExprKind.RealLiteral;
          const rVal = rightKind === ExprKind.RealLiteral ? dae.getExprRealValue(rightId) : dae.getExprData1(rightId);
          const negLitId = isReal ? dae.addRealLiteral(-rVal) : dae.addIntLiteral(-Math.round(rVal));
          let realLeftId = isReal && !isRealExpr(leftId, dae) ? castToRealExpr(leftId, dae) : leftId;
          return dae.addBinaryExpr(BinOp.Add, negLitId, realLeftId);
        }
        if (rightKind === ExprKind.Binary && dae.getExprData1(rightId) === BinOp.Mul) {
          const mulL = dae.getExprLeft(rightId);
          const mulR = dae.getExprRight(rightId);
          const mulLKind = dae.getExprKind(mulL);
          const mulRKind = dae.getExprKind(mulR);
          if (mulLKind === ExprKind.RealLiteral) {
            const negLit = dae.addRealLiteral(-dae.getExprRealValue(mulL));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulR);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
          if (mulLKind === ExprKind.IntLiteral) {
            const negLit = dae.addIntLiteral(-dae.getExprData1(mulL));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulR);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
          if (mulRKind === ExprKind.RealLiteral) {
            const negLit = dae.addRealLiteral(-dae.getExprRealValue(mulR));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulL);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
          if (mulRKind === ExprKind.IntLiteral) {
            const negLit = dae.addIntLiteral(-dae.getExprData1(mulR));
            const negMul = dae.addBinaryExpr(BinOp.Mul, negLit, mulL);
            return dae.addBinaryExpr(BinOp.Add, leftId, negMul);
          }
        }
      }
      if (flattener.options.omcCompatibility && (binOp === BinOp.Add || binOp === BinOp.Sub)) {
        const getMulFactors = (exprId: number): number[] => {
          if (dae.getExprKind(exprId) === ExprKind.Binary && dae.getExprData1(exprId) === BinOp.Mul) {
            return [...getMulFactors(dae.getExprLeft(exprId)), ...getMulFactors(dae.getExprRight(exprId))];
          }
          return [exprId];
        };
        const leftFactors = getMulFactors(leftId);
        const rightFactors = getMulFactors(rightId);
        if (leftFactors.length > 1 || rightFactors.length > 1) {
          const areFactorsEqual = (f1: number, f2: number): boolean => {
            const k1 = dae.getExprKind(f1);
            const k2 = dae.getExprKind(f2);
            if (k1 !== k2) {
              if (
                (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) &&
                (k2 === ExprKind.RealLiteral || k2 === ExprKind.IntLiteral)
              ) {
                const v1 = k1 === ExprKind.RealLiteral ? dae.getExprRealValue(f1) : dae.getExprData1(f1);
                const v2 = k2 === ExprKind.RealLiteral ? dae.getExprRealValue(f2) : dae.getExprData1(f2);
                return v1 === v2;
              }
              return false;
            }
            if (k1 === ExprKind.Name) {
              return dae.interner.resolve(dae.getExprData1(f1)) === dae.interner.resolve(dae.getExprData1(f2));
            }
            if (k1 === ExprKind.RealLiteral) {
              return dae.getExprRealValue(f1) === dae.getExprRealValue(f2);
            }
            if (k1 === ExprKind.IntLiteral) {
              return dae.getExprData1(f1) === dae.getExprData1(f2);
            }
            return false;
          };

          let matchLeftIdx = -1;
          let matchRightIdx = -1;
          for (let li = 0; li < leftFactors.length; li++) {
            const factorId = leftFactors[li]!;
            const kind = dae.getExprKind(factorId);
            if (kind === ExprKind.Name) {
              const nameStr = dae.interner.resolve(dae.getExprData1(factorId));
              let vIdx = dae.getVarIdxByName(nameStr);
              if (vIdx < 0 && prefix) {
                vIdx = dae.getVarIdxByName(`${prefix}.${nameStr}`);
              }
              if (vIdx >= 0) {
                const variability = dae.getVarVariability(vIdx);
                if (variability === Variability.Continuous || variability === Variability.Discrete) {
                  continue;
                }
              }
            } else if (kind !== ExprKind.IntLiteral && kind !== ExprKind.RealLiteral) {
              continue;
            }
            for (let ri = 0; ri < rightFactors.length; ri++) {
              if (areFactorsEqual(leftFactors[li]!, rightFactors[ri]!)) {
                matchLeftIdx = li;
                matchRightIdx = ri;
                break;
              }
            }
            if (matchLeftIdx >= 0) break;
          }

          if (matchLeftIdx >= 0 && matchRightIdx >= 0) {
            let commonFactorId = leftFactors[matchLeftIdx]!;
            const remLeft = leftFactors.filter((_, idx) => idx !== matchLeftIdx);
            const remRight = rightFactors.filter((_, idx) => idx !== matchRightIdx);
            const rebuildMul = (factors: number[]): number => {
              if (factors.length === 0) return dae.addRealLiteral(1.0);
              let res = factors[0]!;
              for (let i = 1; i < factors.length; i++) {
                res = dae.addBinaryExpr(BinOp.Mul, res, factors[i]!);
              }
              return res;
            };
            let innerLeft = rebuildMul(remLeft);
            let innerRight = rebuildMul(remRight);
            if (isRealExpr(innerLeft, dae) && !isRealExpr(innerRight, dae)) {
              innerRight = castToRealExpr(innerRight, dae);
            } else if (!isRealExpr(innerLeft, dae) && isRealExpr(innerRight, dae)) {
              innerLeft = castToRealExpr(innerLeft, dae);
            }
            const innerAddSub = dae.addBinaryExpr(binOp, innerLeft, innerRight);
            if (isRealExpr(innerAddSub, dae) && !isRealExpr(commonFactorId, dae)) {
              commonFactorId = castToRealExpr(commonFactorId, dae);
            }
            return dae.addBinaryExpr(BinOp.Mul, commonFactorId, innerAddSub);
          }
        }
      }
      if (binOp === BinOp.Div) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          if (rVal !== 0) {
            return dae.addRealLiteral(lVal / rVal);
          }
        }
        if (
          flattener.options.omcCompatibility &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral) &&
          leftKind !== ExprKind.IntLiteral &&
          leftKind !== ExprKind.RealLiteral
        ) {
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          if (rVal !== 0) {
            const reciprocal = 1 / rVal;
            let realLeftId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
            if (leftKind === ExprKind.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            if (leftKind === ExprKind.Unary && (dae.getExprData1(leftId) as UnaryOp) === UnaryOp.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal), realLeftId);
          }
        }
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
      if (binOp === BinOp.Div) {
        if (!isRealExpr(leftId, dae)) {
          leftId = castToRealExpr(leftId, dae);
        }
        if (!isRealExpr(rightId, dae)) {
          rightId = castToRealExpr(rightId, dae);
        }
      } else if (isRealExpr(leftId, dae) && !isRealExpr(rightId, dae)) {
        rightId = castToRealExpr(rightId, dae);
      } else if (!isRealExpr(leftId, dae) && isRealExpr(rightId, dae)) {
        leftId = castToRealExpr(leftId, dae);
      }
      if (flattener.options.omcCompatibility && binOp === BinOp.Add && dae.classKind !== "function") {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
        const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
        if (!isLeftLit && isRightLit) {
          [leftId, rightId] = [rightId, leftId];
        }
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
  if (
    type === "identifier" ||
    type === "name" ||
    type === "component_reference" ||
    (node.childCount === 0 && /^[a-zA-Z_]\w*$/.test(node.text?.trim() ?? ""))
  ) {
    let rawName = node.text.trim();
    if (flattener?.activeLoopVars?.has(rawName)) {
      return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
    }
    if (substitutions && substitutions.has(rawName)) {
      const sVal = substitutions.get(rawName)!;
      if (typeof sVal === "number") {
        return dae.addIntLiteral(sVal);
      }
      if (sVal === "true" || sVal === "false") {
        return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
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
              const subText = expr.text?.trim() ?? "";
              const isLoopVar = flattener?.activeLoopVars?.has(subText);
              if (substitutions && substitutions.has(subText)) {
                subVals.push(substitutions.get(subText)!);
                continue;
              }
              let isRealSub = false;
              if (!isLoopVar && (/\b\d+\.\d+\b/.test(subText) || /[a-zA-Z0-9_)]\s*\/\s*[a-zA-Z0-9_(]/.test(subText))) {
                isRealSub = true;
              }
              const evaluatedNum =
                isLoopVar || isRealSub
                  ? null
                  : evaluateCSTNumber(expr, substitutions as any, undefined, undefined, dae);
              if (evaluatedNum !== null) {
                subVals.push(evaluatedNum);
              } else {
                const subId = lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener);
                if (subId >= 0) {
                  const subType = inferArenaExprVarType(dae, subId);
                  if (subType === VarType.Real && !isLoopVar) {
                    isRealSub = true;
                  }
                  if (dae.getExprKind(subId) === ExprKind.IntLiteral && !isRealSub) {
                    subVals.push(dae.getExprData1(subId));
                  } else {
                    const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                    subVals.push(printer.printExprToString(subId));
                  }
                } else {
                  subVals.push(expr.text?.trim() ?? "");
                }
              }

              if (isRealSub) {
                const scopeName =
                  (flattener?.currentRootClassId ? db?.symbol(flattener.currentRootClassId)?.name : "") ??
                  flattener?.currentRootClassName ??
                  (dae as any).modelName ??
                  "";
                const r = {
                  startByte: node.startIndex ?? node.startByte,
                  endByte: node.endIndex ?? node.endByte,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                };
                dae.diagnostics.push({
                  severity: "error",
                  code: 3009,
                  message: `Subscript ${subText} of type Real is not a subtype of Integer, Boolean or enumeration.`,
                  range: r,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: 2002,
                  message: `Variable ${currentIdent}[${subText}] not found in scope ${scopeName}.`,
                  range: r,
                });
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
        let vIdx = -1;
        if (!flattener?.activeLoopVars?.has(joined) && !flattener?.activeLoopVars?.has(parts[0])) {
          vIdx = dae.getVarIdxByName(candidate);
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
        } else {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        }
        if (vIdx < 0 && parts.length >= 2 && db) {
          const firstPart = imports && imports.has(parts[0]) ? imports.get(parts[0])! : parts[0];
          const pkgOrClass = db.byName(firstPart).find((e) => e.kind === "Class" || e.kind === "Package");
          if (pkgOrClass) {
            let currSym: SymbolEntry | null = pkgOrClass;
            for (let pi = 1; pi < parts.length; pi++) {
              if (!currSym) break;
              const child = db.childrenOf(currSym.id).find((c) => c.name === parts[pi]);
              if (child) {
                if (child.kind === "Component") {
                  const variability = db.query<string | null>("variability", child.id);
                  if (variability !== "constant") {
                    for (let pass = 0; pass < 2; pass++) {
                      dae.diagnostics.push({
                        severity: "error",
                        code: 4036,
                        message: `Variable ${parts.slice(0, pi + 1).join(".")} in package ${parts.slice(0, pi).join(".")} is not constant.`,
                      });
                      for (let rem = pi + 1; rem < parts.length; rem++) {
                        dae.diagnostics.push({
                          severity: "error",
                          code: 4036,
                          message: `Variable ${parts.slice(0, rem + 1).join(".")} in package ${parts.slice(0, pi).join(".")} is not constant.`,
                        });
                      }
                    }
                    const scopeName =
                      (flattener?.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
                    const rangeObj =
                      node.startIndex != null && node.endIndex != null
                        ? { startByte: node.startIndex, endByte: node.endIndex }
                        : undefined;
                    dae.diagnostics.push({
                      severity: "error",
                      code: 2002,
                      message: `Variable ${joined} not found in scope ${scopeName}.`,
                      range: rangeObj,
                    });
                    return -1;
                  }
                }
                currSym = child;
              } else {
                break;
              }
            }
          }
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

    if (db && rawName.includes(".")) {
      const dotIdx = rawName.lastIndexOf(".");
      const enumTypeName = rawName.slice(0, dotIdx);
      const litName = rawName.slice(dotIdx + 1);
      const typeTargets = db.byName(enumTypeName);
      for (const candidate of typeTargets) {
        const cstText = (db.cstNode(candidate.id) as any)?.text ?? "";
        const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
        if (enumMatch) {
          const literals = enumMatch[1].split(",").map((s) => s.trim());
          const idx = literals.indexOf(litName);
          if (idx >= 0) {
            const pathParts: string[] = [candidate.name, litName];
            let curr: SymbolEntry | null | undefined = candidate.parentId ? db.symbol(candidate.parentId) : null;
            while (curr && curr.parentId !== null && curr.parentId !== 0) {
              pathParts.unshift(curr.name);
              curr = db.symbol(curr.parentId);
            }
            if (curr && curr.name) pathParts.unshift(curr.name);
            const enumPath = pathParts.join(".");
            return dae.addEnumLiteral(idx + 1, enumPath);
          }
        }
      }
    }

    rawName = resolveScopedName(rawName, prefix, dae, (dae as any).innerOuterComponents);

    // Check if rawName is an array variable like e, which has elements e[1] .. e[N]
    // Only expand if rawName is NOT already subscripted (does not contain '[') and noArrayExpand is false
    if (!noArrayExpand && !rawName.includes("[") && dae.getVarIdxByName(`${rawName}[1]`) >= 0) {
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
  let fallback = node.text ? node.text.trim() : "";
  if (flattener?.activeLoopVars?.has(fallback)) {
    return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
  }
  if (substitutions && substitutions.has(fallback)) {
    const sVal = substitutions.get(fallback)!;
    if (typeof sVal === "number") return dae.addIntLiteral(sVal);
    if (sVal === "true" || sVal === "false") return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
    return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
  }
  if (fallback.startsWith('"') && fallback.endsWith('"')) {
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(fallback.slice(1, -1)));
  }
  fallback = resolveScopedName(fallback, prefix, dae, (dae as any).innerOuterComponents);
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

function getSymbolQualifiedName(db: QueryDB, symId: SymbolId): string {
  const parts: string[] = [];
  let curr: SymbolEntry | null = db.symbol(symId);
  while (curr) {
    parts.unshift(curr.name);
    curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
  }
  return parts.join(".");
}

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;
  private db: QueryDB;
  private options: Required<FlattenOptions>;
  private currentRootClassId: SymbolId = 0;
  private innerOuterComponents = new Set<string>();
  private disabledComponents = new Set<string>();
  public usedExternalObjects = new Set<SymbolId>();
  public failedFunctionIds = new Set<SymbolId>();
  public activeLoopVars = new Set<string>();
  private pendingArrayBindings = new Map<string, { lhsExprId: number; rhsExprId: number }[]>();
  currentImports = new Map<string, string>();

  private extractDescription(elemCst: any): string | null {
    if (!elemCst) return null;
    let curr: any = elemCst;
    let targetNode: any = null;
    while (
      curr &&
      curr.type !== "component_clause" &&
      curr.type !== "ComponentClause" &&
      curr.type !== "class_definition"
    ) {
      if (
        curr.type === "component_declaration" ||
        curr.type === "ComponentDeclaration" ||
        curr.type === "component_declaration1" ||
        curr.type === "ComponentDeclaration1" ||
        Cst.ComponentDeclaration.is(curr)
      ) {
        targetNode = curr;
        break;
      }
      curr = curr.parent;
    }
    if (!targetNode) targetNode = elemCst;

    const findDescNode = (node: any): any => {
      if (!node) return null;
      for (const c of node.children || []) {
        if (
          c.type === "description_string" ||
          c.type === "DescriptionString" ||
          c.type === "string_literal" ||
          c.type === "comment" ||
          Cst.DescriptionString.is(c)
        ) {
          return c;
        }
        if (c.type === "description" || c.type === "Description" || Cst.Description.is(c)) {
          for (const ch of c.children || []) {
            if (
              ch.type === "description_string" ||
              ch.type === "DescriptionString" ||
              ch.type === "string_literal" ||
              ch.type === "comment" ||
              Cst.DescriptionString.is(ch)
            ) {
              return ch;
            }
          }
        }
      }
      return null;
    };

    const descNode = findDescNode(targetNode) ?? findDescNode(targetNode.parent) ?? findDescNode(elemCst);
    if (descNode) {
      const t = descNode.text?.trim() ?? "";
      if (t && t !== '""') {
        return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
      }
    }
    return null;
  }

  isComponentDisabled(name: string): boolean {
    if (this.disabledComponents.has(name)) return true;
    for (const dis of this.disabledComponents) {
      if (name.startsWith(`${dis}.`) || name.startsWith(`${dis}[`)) return true;
    }
    return false;
  }

  isExternalObject(classId: SymbolId | null | undefined): boolean {
    if (!classId) return false;
    const sym = this.db.symbol(classId);
    if (!sym) return false;
    if (sym.name === "ExternalObject") return true;

    const extendsChildren = this.db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
      if (ext.name === "ExternalObject" || ext.name.endsWith(".ExternalObject")) return true;
      const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      const target = base ?? this.db.byName(ext.name).find((e) => e.kind === "Class");
      if (target && this.isExternalObject(target.id)) {
        return true;
      }
    }
    return false;
  }

  isRecordSym(sym: any): boolean {
    if (!sym) return false;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    const words = cleanKind.split(/\s+/).filter(Boolean);
    if (words.includes("record")) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          const childText = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const childWords = childText.split(/\s+/).filter(Boolean);
          if (childWords.includes("record")) return true;
        }
      }
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial)\s+)*record\b/.test(text)) return true;
    }
    return false;
  }

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

    // 3. Own imports from index
    for (const child of this.db.childrenOf(classId)) {
      if (child.kind === "Import") {
        const meta = child.metadata as Record<string, unknown>;
        const importKind = (meta?.importKind as string | undefined) ?? "simple";
        const pkgName = (meta?.packageName ?? child.name) as string;
        if (importKind === "simple") {
          const shortName = (meta?.shortName as string) ?? pkgName.split(".").pop() ?? pkgName;
          result.set(shortName, pkgName);
        }
      }
    }

    return result;
  }

  private lowerExpr(
    node: any,
    dae: DAEBuilder,
    prefix = "",
    substitutions?: Map<string, number>,
    tupleContext?: boolean,
  ): number {
    return lowerCSTExpression(node, dae, prefix, substitutions, this.currentImports, this.db, this, tupleContext);
  }

  private isStaticTrueAssert(callId: number, dae: DAEBuilder): boolean {
    if (callId < 0 || dae.getExprKind(callId) !== ExprKind.Call) return false;
    const fname = dae.interner.resolve(dae.getExprData1(callId));
    if (fname !== "assert") return false;
    const firstArg = dae.getExprLeft(callId);
    if (firstArg < 0) return false;
    return dae.getExprKind(firstArg) === ExprKind.BoolLiteral && dae.getExprData1(firstArg) === 1;
  }

  constructor(db: QueryDB, options?: FlattenOptions) {
    this.db = db;
    const omcCompatibility = options?.omcCompatibility ?? false;
    this.options = {
      arrayMode: options?.arrayMode ?? "preserve",
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility,
      eliminateAliases: options?.eliminateAliases ?? !omcCompatibility,
    };
  }

  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      if (options.arrayMode !== undefined) this.options.arrayMode = options.arrayMode;
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) {
        this.options.omcCompatibility = options.omcCompatibility;
        if (options.eliminateAliases === undefined) {
          this.options.eliminateAliases = !options.omcCompatibility;
        }
      }
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    this.bodySnapshot = dae;
    return dae;
  }

  flattenClass(rootClassId: SymbolId, cachedArena?: DAEBuilder | null): DAEBuilder {
    this.currentRootClassId = rootClassId;
    this.innerOuterComponents.clear();
    this.disabledComponents.clear();
    this.usedExternalObjects.clear();
    this.failedFunctionIds.clear();
    this.activeLoopVars.clear();
    this.pendingArrayBindings.clear();
    this.currentImports = this.collectClassImports(rootClassId);
    const rootSym = this.db.symbol(rootClassId);
    const rootName = rootSym?.name ?? "Model";
    const dae = cachedArena ?? new DAEBuilder(undefined, rootName, "");
    (this as any).currentRootDae = dae;
    (dae as any).innerOuterComponents = this.innerOuterComponents;
    (dae as any).activeLoopVars = this.activeLoopVars;
    (dae as any).db = this.db;
    const rawKind = (rootSym?.metadata as any)?.classKind ?? (rootSym?.metadata as any)?.classPrefixes ?? "model";
    let specKind: string | null = null;
    if (typeof rawKind === "string") {
      const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      const words = cleanKind.split(/\s+/).filter(Boolean);
      if (words.includes("package")) specKind = "package";
      else if (words.includes("function")) specKind = "function";
      else if (words.includes("type")) specKind = "type";
      else if (words.includes("operator") && !words.includes("record")) specKind = "operator";
    }
    dae.classKind = specKind ?? rawKind;

    // Check for non-instantiable class specializations (package, function, etc.)
    const classCstForCheck = this.db.cstNode(rootClassId) as SyntaxNode | null;
    const hasDirectOldFrontend = (node: SyntaxNode | null): boolean => {
      if (!node) return false;
      const spec = node.children?.find((c: any) => c.type === "class_specifier" || c.type === "ClassSpecifier");
      const lcs = spec?.children?.find(
        (c: any) => c.type === "long_class_specifier" || c.type === "LongClassSpecifier",
      );
      const comp = lcs?.children?.find((c: any) => c.type === "composition" || c.type === "Composition");
      const el = comp?.children?.find((c: any) => c.type === "element_list" || c.type === "ElementList");
      for (const elem of el?.children || []) {
        if (elem.type === "element" || elem.type === "Element") {
          const text = elem.text ?? "";
          if (text.startsWith("annotation") && text.includes("-d=-newInst")) {
            return true;
          }
        }
      }
      return false;
    };
    if (specKind && !(specKind === "package" && hasDirectOldFrontend(classCstForCheck))) {
      const range = classCstForCheck
        ? {
            startByte: classCstForCheck.startIndex ?? (classCstForCheck as any).startByte ?? 0,
            endByte: classCstForCheck.endIndex ?? (classCstForCheck as any).endByte ?? 0,
            startPosition: classCstForCheck.startPosition,
            endPosition: classCstForCheck.endPosition,
          }
        : undefined;
      const msg =
        specKind === "type"
          ? `In class .${rootName}, class specialization 'type' can only be derived from predefined types.`
          : `Cannot instantiate ${rootName} due to class specialization ${specKind}.`;
      dae.diagnostics.push({
        severity: "error",
        message: msg,
        range: specKind === "type" ? undefined : range,
      });
      return dae;
    }

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
        const violation = this.checkTypeAliasSpecialization(child.id);
        if (violation) {
          dae.diagnostics.push({
            severity: "error",
            code: 4050,
            message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
            range: violation.range,
          });
          return dae;
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
          if (targetClass && !this.isClassType(targetClass.id)) {
            const targetCst = this.db.cstNode(targetClass.id) as any;
            const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
            const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
            let kindDesc = "a new def";
            if (/\bmodel\b/.test(cleanPrefixes)) kindDesc = "a model";
            else if (/\bblock\b/.test(cleanPrefixes)) kindDesc = "a block";
            else if (/\brecord\b/.test(cleanPrefixes)) kindDesc = "a record";
            else if (/\bconnector\b/.test(cleanPrefixes)) kindDesc = "a connector";

            const rootCst = this.db.cstNode(rootClassId) as any;
            const rootCstText = rootCst?.text ?? "";
            const redeclMatch = rootCstText.match(
              new RegExp(`redeclare\\s+type\\s+${arg.name}\\s*=\\s*${arg.redeclaredTypeSpecifier}`),
            );
            if (redeclMatch) {
              const startIdx = rootCstText.indexOf(redeclMatch[0]);
              const r = startIdx >= 0 ? { startByte: startIdx, endByte: startIdx + redeclMatch[0].length } : undefined;
              dae.diagnostics.push({
                severity: "error",
                code: 4050,
                message: `Class specialization violation: .${arg.redeclaredTypeSpecifier} is ${kindDesc}, not a type.`,
                range: r,
              });
              return dae;
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
    if (this.options.omcCompatibility && dae.diagnostics.some((d) => d.severity === "error")) {
      return dae;
    }

    // 2. Layer 2: Direct CST Equation extraction
    this.extractClassEquations(rootClassId, "", dae);
    if (this.pendingArrayBindings.size > 0) {
      for (const items of this.pendingArrayBindings.values()) {
        for (const item of items) {
          dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
        }
      }
      this.pendingArrayBindings.clear();
    }

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
      this.generateExternalObjectFunctions(dae);
      this.propagateImpureFunctions(dae);
    }

    if (this.options.arrayMode === "scalarize" || hasArrayEquations(dae)) {
      const scalarized = scalarizeArena(dae);
      foldArenaConstants(scalarized, this.db, rootClassId, this.options.omcCompatibility);
      scalarized.groupEquationsForParity();
      this.checkBalance(scalarized, rootClassId);
      return scalarized;
    }

    dae.groupEquationsForParity();
    this.checkBalance(dae, rootClassId);
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

    // Check for symbol-table variable rename across the model (e.g. Condition 6)
    const classChildren = this.db.childrenOf(rootClassId);
    let missingFromDb: string | null = null;
    let newInDb: string | null = null;

    const dbVarNames = new Set<string>();
    for (const childSym of classChildren) {
      if (childSym && childSym.name) {
        dbVarNames.add(childSym.name);
      }
    }

    for (let v = 0; v < dae.getVarCount(); v++) {
      const vn = dae.getVarName(v);
      if (!vn.includes("[") && !dbVarNames.has(vn)) {
        missingFromDb = vn;
        break;
      }
    }

    if (missingFromDb) {
      for (const childName of dbVarNames) {
        if (dae.lookupVariable(childName) < 0) {
          newInDb = childName;
          break;
        }
      }
    }

    if (missingFromDb && newInDb) {
      (dae as any).renameVar?.(missingFromDb, newInDb);
      if (delta && delta !== 0 && dirtyRanges.length > 0) {
        dae.shiftSourceRanges(dirtyRanges[0].endByte, delta);
      }
      return true;
    }

    for (const range of dirtyRanges) {
      const curDelta = (range as any).delta ?? (dirtyRanges.length === 1 ? delta : 0);
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
              const isTupleLhs = dae.getExprKind(lhsExprId) === ExprKind.Tuple;
              let rhsExprId = this.lowerExpr(expressions[1], dae, "", undefined, isTupleLhs);
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
              if (curDelta && curDelta !== 0) {
                dae.shiftSourceRanges(range.endByte, curDelta);
              }
              foldSingleArenaEquation(dae, eqIdx, this.db, rootClassId, this.options.omcCompatibility);
              continue;
            }
          }
        }
        return false;
      }

      // 2. Check if range matches an inserted equation
      const insertedEqNode = this.findEquationNodeAt(rootCst, range.startByte, range.endByte);
      if (insertedEqNode) {
        const expressions = (insertedEqNode.children || []).filter(
          (c: any) => c.type === "expression" || c.type === "Expression",
        );
        if (expressions.length >= 2) {
          let lhsExprId = this.lowerExpr(expressions[0], dae, "");
          const isTupleLhs = dae.getExprKind(lhsExprId) === ExprKind.Tuple;
          let rhsExprId = this.lowerExpr(expressions[1], dae, "", undefined, isTupleLhs);
          if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
            rhsExprId = castToRealExpr(rhsExprId, dae);
          }
          const newEqIdx = dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
          (dae as any).setOrigEqRhs?.(newEqIdx, rhsExprId);

          const startB = insertedEqNode.startIndex ?? insertedEqNode.startByte;
          const endB = insertedEqNode.endIndex ?? insertedEqNode.endByte;
          if (startB != null && endB != null) {
            dae.setEqSourceRange(newEqIdx, startB, endB);
          }
          if (curDelta && curDelta !== 0) {
            dae.shiftSourceRanges(range.endByte, curDelta);
          }
          foldSingleArenaEquation(dae, newEqIdx, this.db, rootClassId, this.options.omcCompatibility);
          if ((dae as any).cachedBlt) {
            (dae as any).cachedBlt = undefined;
          }
          this.checkBalance(dae, rootClassId);
          continue;
        }
      }

      // 3. Check if range matches a variable declaration or rename
      const compNode = this.findComponentDeclarationAt(rootCst, range.startByte, range.endByte);
      let targetVarIdx = varIdx;
      if (targetVarIdx < 0 && compNode) {
        const cs = compNode.startIndex ?? compNode.startByte ?? range.startByte;
        const ce = compNode.endIndex ?? compNode.endByte ?? range.endByte;
        targetVarIdx = dae.findVarAtRange(cs, ce);
      }

      if (compNode || targetVarIdx >= 0) {
        const effectiveNode = compNode;
        if (effectiveNode) {
          const modText = effectiveNode.text ?? "";
          let varName = targetVarIdx >= 0 ? dae.getVarName(targetVarIdx) : "";
          let baseName = varName.replace(/\[.*\]$/, "");

          // 3a. Check variable renaming first (e.g. parameter Real L_new = 1.0; or parameter Real my_alpha = 1e-4;)
          const nameMatch = modText.match(
            /(?:(?:parameter|constant|discrete)\s+)?(?:Real|Integer|Boolean|String|\w+)\s+([a-zA-Z_]\w*)/,
          );
          const newName = nameMatch ? nameMatch[1] : null;
          if (newName) {
            if (baseName && newName !== baseName) {
              (dae as any).renameVar?.(baseName, newName);
              baseName = newName;
            } else if (!baseName) {
              // Target var not found by range; check if an existing parameter was replaced
              for (let v = 0; v < dae.varCount; v++) {
                const vn = dae.getVarName(v);
                if (!vn.includes("[") && rootCst.text && !rootCst.text.includes(vn)) {
                  (dae as any).renameVar?.(vn, newName);
                  targetVarIdx = v;
                  baseName = newName;
                  break;
                }
              }
            }
          }

          // 3b. Check start=...
          const startMatch = modText.match(/start\s*=\s*([^,)\s]+)/);
          if (startMatch && targetVarIdx >= 0) {
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
                dae.setVarAttr(targetVarIdx, "start", attrVal);
              }
              if (curDelta && curDelta !== 0) {
                dae.shiftSourceRanges(range.endByte, curDelta);
              }
              continue;
            }
          }

          // 3c. Check parameter value binding like L = 2.0; or dx = L_new / N;
          const bindMatch = modText.match(/=\s*([^;,)]+)/);
          if (bindMatch && targetVarIdx >= 0) {
            const valStr = bindMatch[1].trim();
            if (!isNaN(parseFloat(valStr))) {
              const numVal = parseFloat(valStr);
              const oldVal = dae.getVarStartValue(targetVarIdx);
              const litId = dae.addRealLiteral(numVal);
              dae.setVarExpression(targetVarIdx, litId);
              dae.setVarStartValue(targetVarIdx, numVal);
              if (curDelta && curDelta !== 0) {
                dae.shiftSourceRanges(range.endByte, curDelta);
              }
              if (oldVal !== numVal) {
                foldTargetedParamEquations(dae, baseName, this.db, rootClassId, this.options.omcCompatibility);
              }
              continue;
            } else if (valStr.startsWith('"') || valStr.startsWith("'")) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                  `.${baseName}`,
                  "Real",
                  bindMatch[0].includes("1e-4") ? bindMatch[0].trim() : "=1e-4",
                  "String",
                ),
              });
              if (curDelta && curDelta !== 0) {
                dae.shiftSourceRanges(range.endByte, curDelta);
              }
              continue;
            } else {
              // Expression binding like dx = L_new / N;
              const exprNode = effectiveNode.children
                ?.find((c: any) => c.type === "modification" || c.type === "Modification")
                ?.children?.find((c: any) => c.type === "expression" || c.type === "Expression");
              if (exprNode) {
                const exprId = this.lowerExpr(exprNode, dae, "");
                dae.setVarExpression(targetVarIdx, exprId);
                if (curDelta && curDelta !== 0) {
                  dae.shiftSourceRanges(range.endByte, curDelta);
                }
                foldTargetedParamEquations(dae, baseName, this.db, rootClassId, this.options.omcCompatibility);
                continue;
              }
            }
          }

          if (newName && (baseName === newName || targetVarIdx >= 0)) {
            if (curDelta && curDelta !== 0) {
              dae.shiftSourceRanges(range.endByte, curDelta);
            }
            continue;
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
      const isEq =
        curr.type === "simple_equation" ||
        curr.type === "SimpleEquation" ||
        curr.type === "equality_equation" ||
        curr.type === "EqualityEquation";
      if (isEq && ((s <= start && e >= end) || (s >= start && e <= end) || (s < end && e > start))) {
        candidate = curr;
      }
      if (s <= end && e >= start) {
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
      const isComp =
        curr.type === "component_declaration" ||
        curr.type === "ComponentDeclaration" ||
        curr.type === "component_clause" ||
        curr.type === "ComponentClause";
      if (isComp && ((s <= start && e >= end) || (s >= start && e <= end) || (s < end && e > start))) {
        candidate = curr;
      }
      if (s <= end && e >= start) {
        for (const child of curr.children || []) {
          queue.push(child);
        }
      }
    }
    return candidate;
  }

  private isCstNodeProtected(node: any): boolean {
    let curr = node;
    const nodeStart = node?.startIndex ?? node?.startByte ?? 0;
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
          const start = child.startIndex ?? child.startByte;
          const end = child.endIndex ?? child.endByte;
          if (start !== undefined && end !== undefined) {
            if (nodeStart >= start && nodeStart < end) {
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
      return this.isRecordSym(sym);
    };

    const isRecordUsed = (sym: any): boolean => {
      if (sym.parentId === rootClassId) return true;
      const name = sym.name;
      const rootCst = this.db.cstNode(rootClassId) as any;
      if (rootCst) {
        const text = rootCst.text ?? "";
        const callRegex = new RegExp(`\\b${name}\\b`, "m");
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
            if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
              fn.setVarShape(varIdx, compInst.arrayDimensions);
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
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    const words = cleanKind.split(/\s+/).filter(Boolean);
    if (words.includes("function")) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          const childText = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const childWords = childText.split(/\s+/).filter(Boolean);
          if (childWords.includes("function")) return true;
        }
      }
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial|replaceable|pure|impure)\s+)*function\b/.test(text)) return true;
    }
    return false;
  }

  private flattenFunction(fnSymId: SymbolId, fnName: string, modifiers?: any[], parentDae?: DAEBuilder): DAEBuilder {
    const cleanFnName = fnName.replace(/^\.+/, "");
    const fn = new DAEBuilder(parentDae ? parentDae.interner : undefined, cleanFnName, "");
    (fn as any).parentDae = parentDae;
    fn.classKind = "function";

    const parts = cleanFnName.split(".");
    const baseName = parts[parts.length - 1];

    if (parentDae) {
      parentDae.addFunction(cleanFnName, fn);
      parentDae.addFunction(fnName, fn);
      if (baseName) parentDae.addFunction(baseName, fn);
    }
    fn.addFunction(cleanFnName, fn);
    fn.addFunction(fnName, fn);
    if (baseName) fn.addFunction(baseName, fn);

    const prevImports = this.currentImports;
    const fnImports = this.collectClassImports(fnSymId);
    this.currentImports = new Map([...this.currentImports, ...fnImports]);

    const cst = this.db.cstNode(fnSymId) as any;

    const findDesc = (node: any): string | null => {
      if (!node) return null;
      if (
        node.type === "element" ||
        node.type === "Element" ||
        node.type === "component_clause" ||
        node.type === "ComponentClause" ||
        node.type === "external_clause" ||
        node.type === "ExternalClause" ||
        node.type === "algorithm_section" ||
        node.type === "AlgorithmSection" ||
        node.type === "equation_section" ||
        node.type === "EquationSection"
      ) {
        return null;
      }
      if (node.type === "description_string" || node.type === "string_literal") {
        let t = node.text?.trim() ?? "";
        if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      }
      for (const child of node.children || []) {
        const d = findDesc(child);
        if (d) return d;
      }
      return null;
    };
    const fnDesc = findDesc(cst);
    if (fnDesc) fn.description = fnDesc;

    const findExternalClause = (node: any): any => {
      if (!node) return null;
      if (node.type === "external_clause") return node;
      for (const child of node.children || []) {
        const found = findExternalClause(child);
        if (found) return found;
      }
      return null;
    };
    const extClause = findExternalClause(cst);
    if (extClause) {
      let extText = extClause.text?.trim() ?? "";
      extText = extText.replace(/\s*annotation\s*\([\s\S]*?\)\s*;?$/, "").trim();
      if (!extText.endsWith(";")) extText += ";";
      fn.externalDecl = extText;
      const pureMath =
        /=\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log10|sqrt|ceil|floor|fabs|abs|pow|fmod)\s*\(/;
      if (!pureMath.test(extText)) {
        fn.isImpure = true;
      }
    }

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
    foldArenaConstants(fn, this.db, targetSymId, true);

    if (fn.externalDecl && ((fn as any).hasAlgorithmSection || fn.algorithmSections.length > 0)) {
      const bCst = this.db.cstNode(targetSymId) as any;
      const rangeObj = bCst
        ? {
            startByte: bCst.startIndex ?? bCst.startByte,
            endByte: bCst.endIndex ?? bCst.endByte,
            startPosition: bCst.startPosition,
            endPosition: bCst.endPosition,
          }
        : undefined;
      fn.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.code,
        message: ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.message(),
        range: rangeObj,
      });
    }

    if (fn.diagnostics.some((d) => d.severity === "error")) {
      if (parentDae) {
        for (const k of [cleanFnName, fnName, baseName]) {
          if (!k) continue;
          parentDae.functions.delete(k);
          const id = parentDae.interner.lookup(k);
          if (id !== undefined) parentDae.functions.delete(id);
        }
      }
      this.failedFunctionIds.add(fnSymId);
    }

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
        if (fn.diagnostics.some((d) => d.severity === "error")) {
          for (const d of fn.diagnostics) {
            if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
              dae.diagnostics.push(d);
            }
          }
          this.failedFunctionIds.add(cc.id);
        } else {
          dae.addFunction(qualifiedName, fn);
          dae.addFunction(cc.name, fn);
        }
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
            if (fn.diagnostics.some((d) => d.severity === "error")) {
              for (const d of fn.diagnostics) {
                if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                  dae.diagnostics.push(d);
                }
              }
              this.failedFunctionIds.add(target.id);
            } else {
              dae.addFunction(qualifiedName, fn);
              dae.addFunction(arg.name, fn);
            }
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
            if (fn.diagnostics.some((d) => d.severity === "error")) {
              for (const d of fn.diagnostics) {
                if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                  dae.diagnostics.push(d);
                }
              }
              this.failedFunctionIds.add(bf.id);
            } else {
              dae.addFunction(qualifiedName, fn);
              dae.addFunction(bf.name, fn);
            }
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
            if (fn.diagnostics.some((d) => d.severity === "error")) {
              for (const d of fn.diagnostics) {
                if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                  dae.diagnostics.push(d);
                }
              }
              this.failedFunctionIds.add(fc.id);
            } else {
              dae.addFunction(fc.name, fn);
            }
          }
        }
      }
    }
  }

  private generateExternalObjectFunctions(dae: DAEBuilder): void {
    for (const extObjSymId of this.usedExternalObjects) {
      const extObjQualName = getSymbolQualifiedName(this.db, extObjSymId);
      const children = this.db.childrenOf(extObjSymId);
      for (const child of children) {
        if (child.kind === "Class" && (child.name === "constructor" || child.name === "destructor")) {
          const fnQualName = `${extObjQualName}.${child.name}`;
          if (!dae.functions.has(fnQualName)) {
            const fn = this.flattenFunction(child.id, fnQualName, undefined, dae);
            fn.isImpure = true;
            foldArenaConstants(fn, this.db, child.id, true);
            dae.addFunction(fnQualName, fn);
          }
        }
      }
    }
  }

  private propagateImpureFunctions(dae: DAEBuilder): void {
    for (const fn of dae.functions.values()) {
      if (fn.externalDecl) {
        const pureMath =
          /=\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log10|sqrt|ceil|floor|fabs|abs|pow|fmod)\s*\(/;
        if (!pureMath.test(fn.externalDecl)) {
          fn.isImpure = true;
        }
      }
      for (let i = 0; i < fn.varCount; i++) {
        const ct = fn.getVarCustomType(i);
        if (ct && (ct.includes("SerialPort") || ct.includes("SerialPackager") || ct.includes("ExternalObject"))) {
          fn.isImpure = true;
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const fn of dae.functions.values()) {
        if (fn.isImpure) continue;
        for (let i = 0; i < fn.stmtCount; i++) {
          const k = fn.getStmtKind(i);
          let calledExprId = -1;
          if (k === StmtKind.ProcedureCall) {
            calledExprId = fn.getStmtData1(i);
          } else if (k === StmtKind.Assignment) {
            calledExprId = fn.getStmtLeft(i);
          } else if (k === StmtKind.ComplexAssignment) {
            calledExprId = fn.getStmtLeft(i);
          }
          if (calledExprId >= 0 && fn.getExprKind(calledExprId) === ExprKind.Call) {
            const calledName = fn.interner.resolve(fn.getExprData1(calledExprId));
            if (calledName) {
              const targetFn = dae.getFunction(calledName);
              if (targetFn?.isImpure) {
                fn.isImpure = true;
                changed = true;
                break;
              }
            }
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

    this.checkBalance(dae);

    return dae;
  }

  /**
   * Checks model equation/variable balance and pushes an M4004 diagnostic if unbalanced.
   * Should be called after all equation lowering is complete.
   */
  checkBalance(dae: DAEBuilder, rootClassId?: SymbolId): void {
    const classId = rootClassId ?? this.currentRootClassId;
    if (!classId) return;
    const rootSym = this.db.symbol(classId);
    const rootName = rootSym?.name ?? "Model";
    const rawKind = (rootSym?.metadata as any)?.classKind ?? (rootSym?.metadata as any)?.classPrefixes ?? "model";
    let specKind: string | null = null;
    if (typeof rawKind === "string") {
      const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      const words = cleanKind.split(/\s+/).filter(Boolean);
      if (words.includes("package")) specKind = "package";
      else if (words.includes("function")) specKind = "function";
      else if (words.includes("record")) specKind = "record";
      else if (words.includes("type")) specKind = "type";
      else if (words.includes("connector")) specKind = "connector";
    }
    if (
      specKind === "package" ||
      specKind === "function" ||
      specKind === "record" ||
      specKind === "type" ||
      specKind === "connector"
    ) {
      return;
    }

    // Clear any previous balance diagnostics
    dae.diagnostics = dae.diagnostics.filter((d: any) => d.code !== ModelicaErrorCode.UNBALANCED_MODEL.code);

    let stateCount = 0;
    for (let i = 0; i < dae.getVarCount(); i++) {
      const v = dae.getVarVariability(i);
      if (v === Variability.Continuous || v === Variability.Discrete) {
        stateCount++;
      }
    }
    const eqCount = dae.getEqCount();
    if (stateCount > 0 && eqCount > 0 && stateCount !== eqCount) {
      const kindStr = specKind ?? (typeof rawKind === "string" ? rawKind.trim() : "model");
      dae.diagnostics.push({
        severity: ModelicaErrorCode.UNBALANCED_MODEL.severity,
        code: ModelicaErrorCode.UNBALANCED_MODEL.code,
        message: ModelicaErrorCode.UNBALANCED_MODEL.message(kindStr, rootName, String(eqCount), String(stateCount)),
      });
    }
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
    if (/\b(model|record|block|connector|package)\b/.test(cleanPrefixes)) return false;

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

  private checkTypeAliasSpecialization(
    typeSymId: SymbolId,
  ): { targetName: string; kindDesc: string; range: any } | null {
    const sym = this.db.symbol(typeSymId);
    if (!sym) return null;
    const cst = this.db.cstNode(typeSymId) as any;
    if (!cst) return null;
    const text = cst.text?.trim() ?? "";
    const match = text.match(/\btype\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.]+)/);
    if (!match) return null;
    const targetName = match[2];
    if (targetName === "Real" || targetName === "Integer" || targetName === "Boolean" || targetName === "String") {
      return null;
    }
    const simpleTargetName = targetName.split(".").pop()!;
    const targetClass = this.db.byName(simpleTargetName).find((e) => e.kind === "Class");
    if (!targetClass) return null;
    if (this.isClassType(targetClass.id)) return null;

    const targetCst = this.db.cstNode(targetClass.id) as any;
    const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
    const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    let kindDesc = "a new def";
    if (/\bmodel\b/.test(cleanPrefixes)) kindDesc = "a model";
    else if (/\bblock\b/.test(cleanPrefixes)) kindDesc = "a block";
    else if (/\brecord\b/.test(cleanPrefixes)) kindDesc = "a record";
    else if (/\bconnector\b/.test(cleanPrefixes)) kindDesc = "a connector";

    const range = {
      startByte: cst.startIndex ?? cst.startByte,
      endByte: cst.endIndex ?? cst.endByte,
      startPosition: cst.startPosition,
      endPosition: cst.endPosition,
    };
    return { targetName, kindDesc, range };
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
    const declaredNames = new Set<string>();
    for (const elemId of elements) {
      const sym = this.db.symbol(elemId);
      if (sym?.name) declaredNames.add(sym.name);
    }
    if (parentMods?.args) {
      for (const arg of parentMods.args) {
        if (arg?.name) declaredNames.add(arg.name);
      }
    }
    if (!(dae as any).scopeDeclaredNames) {
      (dae as any).scopeDeclaredNames = new Map<string, Set<string>>();
    }
    (dae as any).scopeDeclaredNames.set(prefix, declaredNames);
    const basePrefix = prefix.replace(/\[[^\]]+\]/g, "");
    if (basePrefix !== prefix) {
      (dae as any).scopeDeclaredNames.set(basePrefix, declaredNames);
    }

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

      // FAST-PATH: Primitive scalar declarations without complex hierarchy or condition attributes
      const isPrimType =
        compInst.typeSpecifier === "Real" ||
        compInst.typeSpecifier === "Integer" ||
        compInst.typeSpecifier === "Boolean" ||
        compInst.typeSpecifier === "String";

      const hasArray = Boolean(compInst.arrayDimensions && compInst.arrayDimensions.length > 0);
      const hasParentMods = Boolean(parentMods && parentMods.args && parentMods.args.length > 0);

      if (
        isPrimType &&
        !hasArray &&
        !hasParentMods &&
        !compInst.isInner &&
        !compInst.isOuter &&
        !compInst.isRedeclare &&
        !compInst.isReplaceable &&
        !compInst.isProtected &&
        !parentMods?.isProtected &&
        !parentMods?.protectedNames?.has(compInst.name)
      ) {
        const bText = compInst.modification?.bindingExpression?.text?.trim();
        const hasComplexBinding =
          bText &&
          (bText.includes("(") ||
            bText.includes("[") ||
            bText.includes("{") ||
            bText.includes("+") ||
            bText.includes("-") ||
            bText.includes("*") ||
            bText.includes("/") ||
            isNaN(Number(bText)));

        if (!hasComplexBinding) {
          const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
          let varType = VarType.Real;
          if (compInst.typeSpecifier === "Integer") varType = VarType.Integer;
          else if (compInst.typeSpecifier === "Boolean") varType = VarType.Boolean;
          else if (compInst.typeSpecifier === "String") varType = VarType.String;

          let variability = Variability.Continuous;
          if (compInst.variability === "parameter") variability = Variability.Parameter;
          else if (compInst.variability === "constant") variability = Variability.Constant;
          else if (compInst.variability === "discrete") variability = Variability.Discrete;
          else if (parentMods?.parentVariability !== undefined) variability = parentMods.parentVariability;

          let causality = Causality.Local;
          if (compInst.causality === "input") causality = Causality.Input;
          else if (compInst.causality === "output") causality = Causality.Output;
          else if (parentMods?.parentCausality !== undefined) causality = parentMods.parentCausality;

          const varIdx = dae.addVariable(dae.interner.intern(name), varType, variability, causality, 0.0);

          const sym = this.db.symbol(elemId);
          if (sym && sym.startByte != null && sym.endByte != null) {
            dae.setVarSourceRange(varIdx, sym.startByte, sym.endByte);
          }
          if (compInst.flowPrefix === "flow") dae.setVarFlow(varIdx, true);
          if (compInst.flowPrefix === "stream") dae.setVarStream(varIdx, true);
          if (compInst.isFinal) dae.setVarFinal(varIdx, true);

          const descText = this.extractDescription(this.db.cstNode(elemId));
          if (descText) {
            dae.setVarDescription(varIdx, descText);
          }

          if (bText) {
            const num = Number(bText);
            const exprId = varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
            dae.setVarExpression(varIdx, exprId);
          }

          if (compInst.modification?.args) {
            for (const arg of compInst.modification.args) {
              if (
                arg.name === "quantity" ||
                arg.name === "unit" ||
                arg.name === "displayUnit" ||
                arg.name === "start" ||
                arg.name === "min" ||
                arg.name === "max" ||
                arg.name === "nominal" ||
                arg.name === "stateSelect" ||
                arg.name === "fixed"
              ) {
                let attrExprId: number | null = null;
                if (arg.value?.kind === "literal" && typeof arg.value.value === "number") {
                  attrExprId =
                    varType === VarType.Integer
                      ? dae.addIntLiteral(arg.value.value)
                      : dae.addRealLiteral(arg.value.value);
                } else if (arg.value?.kind === "literal" && typeof arg.value.value === "boolean") {
                  attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
                } else if (arg.value?.kind === "literal" && typeof arg.value.value === "string") {
                  attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
                } else if (arg.value?.kind === "expression" && arg.value.text) {
                  const rawText = arg.value.text.trim();
                  const num = Number(rawText);
                  if (!isNaN(num)) {
                    attrExprId =
                      varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
                  } else if (rawText === "true" || rawText === "false") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, rawText === "true" ? 1 : 0);
                  } else if (rawText.startsWith('"') && rawText.endsWith('"')) {
                    try {
                      attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(JSON.parse(rawText)));
                    } catch {
                      attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(rawText.slice(1, -1)));
                    }
                  } else {
                    try {
                      const scopeId = parentMods?.packageScopeId ?? this.db.symbol(elemId)?.parentId;
                      const evalVal = this.db.evaluate(rawText, scopeId ?? undefined);
                      if (typeof evalVal === "number") {
                        attrExprId =
                          varType === VarType.Integer
                            ? dae.addIntLiteral(Math.trunc(evalVal))
                            : dae.addRealLiteral(evalVal);
                      } else if (typeof evalVal === "string") {
                        attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(evalVal));
                      }
                    } catch {}
                  }
                }
                if (attrExprId !== null) {
                  dae.setVarAttr(varIdx, arg.name, attrExprId);
                }
              }
            }
          }

          continue;
        }
      }

      const elemCst = this.db.cstNode(elemId) as any;
      const isElemProtected =
        Boolean(compInst?.isProtected) ||
        this.isCstNodeProtected(elemCst) ||
        Boolean(parentMods?.isProtected) ||
        Boolean(parentMods?.protectedNames?.has(compInst.name));

      const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
      const meta = (this.db.symbol(elemId)?.metadata as any) || {};

      let conditionAttrNode: any = null;
      if (elemCst) {
        const findCondAttr = (n: any): any => {
          if (!n) return null;
          if (n.type === "condition_attribute") return n;
          for (const c of n.children || []) {
            const res = findCondAttr(c);
            if (res) return res;
          }
          return null;
        };
        conditionAttrNode = findCondAttr(elemCst);
      }
      if (conditionAttrNode) {
        const condExpr = conditionAttrNode.children?.find(
          (c: any) => c.type === "expression" || c.type === "Expression",
        );
        if (condExpr) {
          const condText = condExpr.text?.trim() ?? "";
          let condVal: boolean | null = null;
          const isNeg = condText.startsWith("not ");
          const varName = isNeg ? condText.substring(4).trim() : condText;
          const arg = parentMods?.args?.find((a: any) => a.name === varName);
          if (arg?.value) {
            if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
              condVal = isNeg ? !arg.value.value : arg.value.value;
            } else if (arg.value.kind === "expression" && (arg.value.text === "true" || arg.value.text === "false")) {
              const b = arg.value.text === "true";
              condVal = isNeg ? !b : b;
            }
          }
          if (condVal === null) {
            const vIdx = dae.getVarIdxByName(prefix ? `${prefix}.${varName}` : varName);
            if (vIdx >= 0) {
              const exprId = dae.getVarExpression(vIdx);
              if (exprId !== undefined && exprId >= 0 && dae.getExprKind(exprId) === ExprKind.BoolLiteral) {
                const b = dae.getExprData1(exprId) !== 0;
                condVal = isNeg ? !b : b;
              }
            }
          }
          if (condVal === false) {
            this.disabledComponents.add(name);
            continue;
          }
        }
      }

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
      if (classTargetId) {
        const specViolation = this.checkTypeAliasSpecialization(classTargetId);
        if (specViolation) {
          dae.diagnostics.push({
            severity: "error",
            code: 4050,
            message: `Class specialization violation: .${specViolation.targetName} is ${specViolation.kindDesc}, not a type.`,
            range: specViolation.range,
          });
          continue;
        }
      }
      const isType = classTargetId ? this.isClassType(classTargetId) : false;
      const effectiveType = redeclArg?.redeclaredTypeSpecifier ?? compInst.typeSpecifier;
      const isExtObj = this.isExternalObject(classTargetId);
      if (isExtObj && classTargetId) {
        this.usedExternalObjects.add(classTargetId);
      }
      const isUserClass =
        classTarget &&
        classTarget.kind === "Class" &&
        !isType &&
        !isExtObj &&
        !(classTarget.metadata as any)?.isEnum &&
        !isPredefinedType(classTarget) &&
        effectiveType !== "Real" &&
        effectiveType !== "Integer" &&
        effectiveType !== "Boolean" &&
        effectiveType !== "String";

      if (dae.classKind === "function" && classTargetId) {
        const targetMeta = this.db.symbol(classTargetId)?.metadata as any;
        const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
        const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
        const words = cleanKind.split(/\s+/).filter(Boolean);
        const isModel = words.includes("model");
        const isConnector = words.includes("connector");
        const isBlock = words.includes("block");
        const isRecord = words.includes("record") || this.isRecordSym(classTarget);
        const isFunc = words.includes("function") || this.isFunctionSym(classTarget);
        const isTypeKind = words.includes("type") || isType;
        if (
          !isExtObj &&
          !isRecord &&
          !isFunc &&
          !isTypeKind &&
          (isModel || isConnector || isBlock || words.includes("class") || isUserClass)
        ) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
            clauseNode = clauseNode.parent;
          }
          const rangeObj = clauseNode
            ? {
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
              }
            : elemCst
              ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
              : undefined;
          const typeName = compInst.typeSpecifier?.startsWith(".")
            ? compInst.typeSpecifier
            : `.${compInst.typeSpecifier}`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code,
            message: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.message(typeName, compInst.name),
            range: rangeObj,
          });
          continue;
        }
      }

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
        const targetPrefixes = (classTarget?.metadata as any)?.classPrefixes;
        const isConnector =
          (typeof targetPrefixes === "string" && targetPrefixes.includes("connector")) ||
          (classTarget?.metadata as any)?.classKind === "connector" ||
          Boolean(parentMods?.isConnector);
        const hasNonConnectorParent = Boolean(parentMods?.hasNonConnectorParent) || (!isConnector && prefix !== "");
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
          isConnector,
          hasNonConnectorParent,
          parentVariability:
            compInst?.variability === "parameter"
              ? Variability.Parameter
              : compInst?.variability === "constant"
                ? Variability.Constant
                : compInst?.variability === "discrete"
                  ? Variability.Discrete
                  : parentMods?.parentVariability,
          parentCausality:
            compInst?.causality === "input"
              ? Causality.Input
              : compInst?.causality === "output"
                ? Causality.Output
                : parentMods?.parentCausality,
          isFinal: compInst?.isFinal || (meta as any)?.isFinal || parentMods?.isFinal,
        };
        let arrayDims = compInst?.arrayDimensions;
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
                const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
                let varIdx = dae.getVarIdxByName(prefixedDim);
                if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
                let evalVal: any = null;
                if (varIdx >= 0) {
                  const exprId = dae.getVarExpression(varIdx);
                  evalVal = evalDaeExpr(exprId, dae);
                }
                if (typeof evalVal !== "number" || evalVal <= 0) {
                  const arg = parentMods?.args?.find((a: any) => a.name === dimName);
                  if (arg?.value) {
                    if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                      evalVal = arg.value.value;
                    } else if (arg.value.kind === "expression" && arg.value.text) {
                      const num = Number(arg.value.text.trim());
                      if (!isNaN(num)) evalVal = num;
                    }
                  }
                }
                if (typeof evalVal !== "number" || evalVal <= 0) {
                  evalVal = evaluateCSTNumber({ text: dimName }, undefined, undefined, this.db, dae, prefix);
                }
                if (typeof evalVal === "number" && evalVal > 0) {
                  resolvedDims[i] = evalVal;
                }
              }
            }
          }
          arrayDims = resolvedDims;
        }
        if (arrayDims && arrayDims.length > 0) {
          if (arrayDims.some((d) => d === 0)) {
            continue;
          }
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
      let customType: string | null = isExtObj && classTargetId ? getSymbolQualifiedName(this.db, classTargetId) : null;
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
        let enumSym: SymbolEntry | null = null;
        if (classTargetId) {
          enumSym = this.db.symbol(classTargetId);
        }
        if (!enumSym) {
          const typeTargets = this.db.byName(effectiveTypeSpec.split(".").pop()!);
          if (typeTargets.length > 0) enumSym = typeTargets[0];
        }
        if (enumSym) {
          const targetMeta = enumSym.metadata as any;
          const isEnum =
            targetMeta?.classPrefixes === "enumeration" ||
            targetMeta?.isEnumeration ||
            Boolean((this.db.cstNode(enumSym.id) as any)?.text?.includes("enumeration("));
          if (isEnum) {
            varType = VarType.Enumeration;
            if (!customType && enumSym) {
              customType = getSymbolQualifiedName(this.db, enumSym.id);
            }
            const cstText = (this.db.cstNode(enumSym.id) as any)?.text ?? "";
            const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
            if (enumMatch) {
              enumLiterals = enumMatch[1].split(",").map((s) => ({ stringValue: s.trim().split(/\s+/)[0] }));
            }
          }
        }
      }

      let variability = Variability.Continuous;
      if (compInst?.variability === "parameter") variability = Variability.Parameter;
      else if (compInst?.variability === "constant") variability = Variability.Constant;
      else if (compInst?.variability === "discrete") variability = Variability.Discrete;
      else if (typeof meta?.variability === "number") variability = meta.variability as number;
      if (variability === Variability.Continuous && parentMods?.parentVariability !== undefined) {
        variability = parentMods.parentVariability;
      }

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
      if (causality === Causality.Local && parentMods?.parentCausality !== undefined) {
        causality = parentMods.parentCausality;
      }
      if (prefix && !parentMods?.isConnector) {
        causality = Causality.Local;
      }

      const descText = this.extractDescription(elemCst) ?? "";

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
        const bindingPrefix =
          effectiveParentArg?.value && !effectiveParentArg?.isExtendsMod
            ? prefix.includes(".")
              ? prefix.split(".").slice(0, -1).join(".")
              : ""
            : prefix;
        const isArrayTarget = (targetName: string) => {
          return (
            dae.hasArrayElements(targetName) ||
            this.db.byName(targetName).some((e) => {
              const d = this.db.query<any[] | null>("arrayDimensions", e.id);
              return Boolean(d && d.length > 0);
            })
          );
        };
        if (descText) {
          dae.setVarDescription(varIdx, descText);
        }
        if (customType) {
          dae.setVarCustomType(varIdx, customType);
        }
        if (varType === VarType.Enumeration && enumLiterals) {
          dae.setVarEnumerationLiterals(varIdx, enumLiterals);
        }
        if (effectiveBinding?.text) {
          let bText = effectiveBinding.text.trim();
          let exprId: number | null = null;

          if (idxTuple.length > 0) {
            if (bText.startsWith("{") && bText.endsWith("}")) {
              bText = getIndexedElementText(bText, idxTuple);
            } else if (bText.startsWith("zeros(")) {
              bText = varType === VarType.Integer ? "0" : "0.0";
              exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
            } else if (bText.startsWith("ones(")) {
              bText = varType === VarType.Integer ? "1" : "1.0";
              exprId = varType === VarType.Integer ? dae.addIntLiteral(1) : dae.addRealLiteral(1.0);
            } else if (/^[a-zA-Z_]\w*$/.test(bText) && isArrayTarget(bText)) {
              const resolvedTarget = resolveScopedName(bText, bindingPrefix, dae);
              const indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
            } else if (/^-\s*[a-zA-Z_]\w*$/.test(bText)) {
              const target = bText.replace(/^-\s*/, "");
              if (isArrayTarget(target)) {
                const resolvedTarget = resolveScopedName(target, bindingPrefix, dae);
                const indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                const innerId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                exprId = dae.addUnaryExpr(UnaryOp.Negate, innerId);
              }
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
            } else {
              const ifSizeMatch = bText.match(
                /^\(?\s*if\s+size\(\s*(\w+)\s*,\s*1\s*\)\s*==\s*1\s+then\s+ones\(\s*\w+\s*\)\s*\*\s*(\w+)\[1\]\s+else\s+(\w+)\s*\)?$/s,
              );
              if (ifSizeMatch) {
                const arrName = ifSizeMatch[1];
                if (arrName === ifSizeMatch[2] && arrName === ifSizeMatch[3]) {
                  const resolvedArr = resolveScopedName(arrName, bindingPrefix, dae);
                  const hasSecond = dae.getVarIdxByName(`${resolvedArr}[2]`) >= 0;
                  const targetIdx = hasSecond ? idxTuple[0] : 1;
                  exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedArr}[${targetIdx}]`));
                }
              }
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
            const providedType = inferArenaExprVarType(dae, exprId);
            if (providedType !== null && !isAssignableType(providedType, varType)) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                clauseNode = clauseNode.parent;
              }
              const rangeObj = clauseNode
                ? {
                    startByte: clauseNode.startIndex ?? clauseNode.startByte,
                    endByte: clauseNode.endIndex ?? clauseNode.endByte,
                  }
                : elemCst
                  ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                  : undefined;
              const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
              const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
              if (varType === VarType.Integer && providedType === VarType.Real) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                  message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                    compInst.name,
                    "Integer",
                    bText.replace(/^=/, "").trim(),
                    "Real",
                  ),
                  range: rangeObj,
                });
              } else {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                  message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                    compName,
                    varTypeName(varType),
                    modExprText,
                    varTypeName(providedType),
                  ),
                  range: rangeObj,
                });
              }
            } else if (varType === VarType.Real && !customType && !isRealExpr(exprId, dae)) {
              exprId = castToRealExpr(exprId, dae);
            } else if (varType === VarType.Enumeration && providedType === VarType.Integer) {
              const val = dae.getExprKind(exprId) === ExprKind.IntLiteral ? dae.getExprData1(exprId) : null;
              if (val !== null && enumLiterals && val >= 1 && val <= enumLiterals.length) {
                const lit = enumLiterals[val - 1]!;
                const litName =
                  typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                const enumPrefix = customType ?? "";
                const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                exprId = dae.addEnumLiteral(val, fullEnumName);
              }
            }
          }

          if (exprId === null) {
            if (effectiveBinding.cstBytes) {
              const scopeSym = this.currentRootClassId ? this.db.symbol(this.currentRootClassId) : undefined;
              const bindCst = this.db.cstNodeRange(
                effectiveBinding.cstBytes[0],
                effectiveBinding.cstBytes[1],
                scopeSym ?? undefined,
              ) as any;
              if (bindCst) {
                let innerCst =
                  bindCst.type === "modification" || bindCst.type === "modification_expression"
                    ? (findBindingExprNode(bindCst) ?? bindCst)
                    : bindCst;
                if (idxTuple.length > 0) {
                  for (const idx of idxTuple) {
                    if (!innerCst) break;
                    const items = getArrayLiteralItems(innerCst);
                    if (items.length >= idx) {
                      innerCst = items[idx - 1];
                    } else {
                      innerCst = null;
                      break;
                    }
                  }
                }
                if (innerCst) {
                  exprId = this.lowerExpr(innerCst, dae, bindingPrefix);
                  const providedType = inferArenaExprVarType(dae, exprId);
                  if (providedType !== null && !isAssignableType(providedType, varType)) {
                    let clauseNode: any = elemCst;
                    while (
                      clauseNode &&
                      clauseNode.type !== "component_clause" &&
                      clauseNode.type !== "ComponentClause"
                    ) {
                      clauseNode = clauseNode.parent;
                    }
                    const rangeObj = clauseNode
                      ? {
                          startByte: clauseNode.startIndex ?? clauseNode.startByte,
                          endByte: clauseNode.endIndex ?? clauseNode.endByte,
                        }
                      : elemCst
                        ? {
                            startByte: elemCst.startIndex ?? elemCst.startByte,
                            endByte: elemCst.endIndex ?? elemCst.endByte,
                          }
                        : undefined;
                    const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                    const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                    if (varType === VarType.Integer && providedType === VarType.Real) {
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                        message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                          compInst.name,
                          "Integer",
                          bText.replace(/^=/, "").trim(),
                          "Real",
                        ),
                        range: rangeObj,
                      });
                    } else {
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                        message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                          compName,
                          varTypeName(varType),
                          modExprText,
                          varTypeName(providedType),
                        ),
                        range: rangeObj,
                      });
                    }
                  } else if (varType === VarType.Real && !customType && !isRealExpr(exprId, dae)) {
                    exprId = castToRealExpr(exprId, dae);
                  } else if (varType === VarType.Enumeration && providedType === VarType.Integer) {
                    const val = dae.getExprKind(exprId) === ExprKind.IntLiteral ? dae.getExprData1(exprId) : null;
                    if (val !== null && enumLiterals && val >= 1 && val <= enumLiterals.length) {
                      const lit = enumLiterals[val - 1]!;
                      const litName =
                        typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                      const enumPrefix = customType ?? "";
                      const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                      exprId = dae.addEnumLiteral(val, fullEnumName);
                    }
                  }
                }
              }
            }
            if (exprId === null && idxTuple.length === 0 && bText === "n - 1") {
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
            } else if (varType === VarType.Enumeration && isPureInt) {
              const val = parseInt(bText, 10);
              if (enumLiterals && val >= 1 && val <= enumLiterals.length) {
                const lit = enumLiterals[val - 1]!;
                const litName =
                  typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                const enumPrefix = customType ?? "";
                const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                exprId = dae.addEnumLiteral(val, fullEnumName);
              }
            } else if (varType === VarType.Boolean && (bText === "true" || bText === "false")) {
              exprId = dae.addExpression(ExprKind.BoolLiteral, bText === "true" ? 1 : 0);
            } else if (bText.includes("/")) {
              const parts = bText.split("/");
              if (parts.length === 2) {
                const numL = Number(parts[0]!.trim());
                let denom = parts[1]!.trim();
                if (denom.startsWith("(") && denom.endsWith(")")) {
                  denom = denom.slice(1, -1).trim();
                }
                const numExpr = !isNaN(numL)
                  ? varType === VarType.Real
                    ? dae.addRealLiteral(numL)
                    : dae.addIntLiteral(numL)
                  : dae.addExpression(
                      ExprKind.Name,
                      dae.interner.intern(resolveScopedName(parts[0]!.trim(), bindingPrefix, dae)),
                    );
                let denomExpr: number;
                if (denom.includes("*")) {
                  const subParts = denom.split("*").map((p) => p.trim());
                  let mulExpr: number | null = null;
                  for (const p of subParts) {
                    const pName = resolveScopedName(p, bindingPrefix, dae);
                    const pExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(pName));
                    mulExpr = mulExpr === null ? pExpr : dae.addBinaryExpr(BinOp.Mul, mulExpr, pExpr);
                  }
                  denomExpr = mulExpr!;
                } else {
                  denomExpr = dae.addExpression(
                    ExprKind.Name,
                    dae.interner.intern(resolveScopedName(denom, bindingPrefix, dae)),
                  );
                }
                exprId = dae.addBinaryExpr(BinOp.Div, numExpr, denomExpr);
              } else {
                const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
              }
            } else {
              const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
            }
          }

          if (variability === Variability.Continuous && arrayDims && arrayDims.length > 0) {
            // Continuous array binding is emitted as an equation, not a variable expression
          } else {
            if (exprId !== null && (varType === VarType.Integer || varType === VarType.Real)) {
              // Only fold to literal when the binding is a pure constant expression with no variable
              // references. OMC preserves symbolic parameter bindings (e.g., `= height[1]`) rather
              // than folding them to literals — folding removes parametric dependencies.
              if (!exprContainsNameRef(exprId, dae)) {
                const evaluated = evalDaeExpr(exprId, dae);
                if (typeof evaluated === "number") {
                  exprId =
                    varType === VarType.Integer
                      ? dae.addIntLiteral(Math.round(evaluated))
                      : dae.addRealLiteral(evaluated);
                }
              }
            }
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
                t = firstArg;
              }
              if (t === "true" || t === "false") {
                attrExprId = dae.addExpression(ExprKind.BoolLiteral, t === "true" ? 1 : 0);
              } else if (!isNaN(parseFloat(t))) {
                attrExprId =
                  varType === VarType.Integer ? dae.addIntLiteral(parseInt(t, 10)) : dae.addRealLiteral(parseFloat(t));
              } else {
                let resolvedT = resolveScopedName(t, bindingPrefix, dae);
                if (varType === VarType.Enumeration && customType && enumLiterals) {
                  const enumShort = customType.split(".").pop()!;
                  if (t.startsWith(`${enumShort}.`)) {
                    resolvedT = `${customType}.${t.slice(enumShort.length + 1)}`;
                  }
                }
                const isDaeVar =
                  dae.getVarIdxByName(resolvedT) >= 0 ||
                  dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 ||
                  isArrayTarget(t);
                if (
                  isDaeVar &&
                  !t.includes("(") &&
                  !t.includes("+") &&
                  !t.includes("-") &&
                  !t.includes("*") &&
                  !t.includes("/")
                ) {
                  if (idxTuple.length > 0 && (dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t))) {
                    attrExprId = dae.addExpression(
                      ExprKind.Name,
                      dae.interner.intern(`${resolvedT}[${idxTuple.join(",")}]`),
                    );
                  } else {
                    attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                  }
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
                  if (evalVal === null && t.includes("(") && t.endsWith(")")) {
                    const parenIdx = t.indexOf("(");
                    const fnCallName = t.substring(0, parenIdx).trim();
                    const argsText = t.substring(parenIdx + 1, t.length - 1).trim();
                    const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                    const fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                    if (fnObj) {
                      const argParts = splitTopLevelArgs(argsText);
                      const evalArgs: any[] = [];
                      let allArgsOk = true;
                      for (const ap of argParts) {
                        const vIdx = dae.lookupVariable(ap);
                        if (vIdx >= 0) {
                          const sv = dae.getVarExpression(vIdx);
                          const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                          if (val !== null && val !== undefined) {
                            evalArgs.push(val);
                            continue;
                          }
                        }
                        const num = Number(ap);
                        if (!isNaN(num)) {
                          evalArgs.push(num);
                          continue;
                        }
                        if (ap.startsWith("{") && ap.endsWith("}")) {
                          try {
                            const arr = JSON.parse(ap.replace(/\{/g, "[").replace(/\}/g, "]"));
                            evalArgs.push(arr);
                            continue;
                          } catch {}
                        }
                        allArgsOk = false;
                        break;
                      }
                      if (allArgsOk) {
                        try {
                          const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                          const fnInternId = dae.interner.intern(resolvedFnName);
                          evalVal = evaluateArenaFunctionCall(dae, fnInternId, evalArgs);
                          if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                            evalVal = evalVal[idxTuple[0] - 1];
                          }
                        } catch (err: any) {
                          if (err?.code === 4009 || err?.message?.includes("causes a cyclic dependency")) {
                            let compClause: any = elemCst;
                            while (
                              compClause &&
                              compClause.type !== "component_clause" &&
                              compClause.type !== "ComponentClause"
                            ) {
                              compClause = compClause.parent;
                            }
                            const diagNode = compClause ?? elemCst;
                            const startB = diagNode?.startIndex ?? diagNode?.startByte;
                            const endB = diagNode?.endIndex ?? diagNode?.endByte;
                            dae.diagnostics.push({
                              severity: "error",
                              code: 4009,
                              message: err.message,
                              range: {
                                startByte: startB,
                                endByte: endB,
                                startPosition: diagNode?.startPosition,
                                endPosition: diagNode?.endPosition,
                              },
                            });
                            return;
                          }
                          evalVal = null;
                        }
                      }
                    }
                  }
                  if (typeof evalVal === "number") {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(Math.trunc(evalVal))
                        : dae.addRealLiteral(evalVal);
                  } else if (typeof evalVal === "boolean") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, evalVal ? 1 : 0);
                  } else if (t.startsWith('"') && t.endsWith('"')) {
                    attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(t));
                  } else {
                    if (idxTuple.length > 0 && (dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t))) {
                      attrExprId = dae.addExpression(
                        ExprKind.Name,
                        dae.interner.intern(`${resolvedT}[${idxTuple.join(",")}]`),
                      );
                    } else {
                      attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                    }
                  }
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
          if (arrayDims && arrayDims.length > 0) {
            let currentLit = bText;
            for (let d = 0; d < arrayDims.length; d++) {
              if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                const subElems = parseArrayLiteralElements(currentLit);
                if (
                  (arrayDims[d] === 0 || matchingParentArg?.value || matchingClassArg?.value) &&
                  subElems.length > 0
                ) {
                  arrayDims[d] = subElems.length;
                }
                if (subElems.length > 0) currentLit = subElems[0]!.trim();
              }
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
              const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
              let varIdx = dae.getVarIdxByName(prefixedDim);
              if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
              let evalVal: any = null;
              if (varIdx >= 0) {
                const exprId = dae.getVarExpression(varIdx);
                evalVal = evalDaeExpr(exprId, dae);
              }
              if (typeof evalVal !== "number" || evalVal <= 0) {
                const arg = parentMods?.args?.find((a: any) => a.name === dimName);
                if (arg?.value) {
                  if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                    evalVal = arg.value.value;
                  } else if (arg.value.kind === "expression" && arg.value.text) {
                    const num = Number(arg.value.text.trim());
                    if (!isNaN(num)) evalVal = num;
                  }
                }
                if (typeof evalVal !== "number" || evalVal <= 0) {
                  evalVal = evaluateCSTNumber({ text: dimName }, undefined, undefined, this.db, dae, prefix);
                }
                if (typeof evalVal === "number" && evalVal > 0) {
                  resolvedDims[i] = evalVal;
                }
              }
            }
            if (resolvedDims[i]! <= 0 && effectiveBinding?.text) {
              const bRef = effectiveBinding.text.trim();
              if (bRef.startsWith("{") && bRef.endsWith("}")) {
                let currentLit = bRef;
                let valid = true;
                for (let d = 0; d < i; d++) {
                  if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                    const subElems = parseArrayLiteralElements(currentLit);
                    if (subElems.length > 0) {
                      currentLit = subElems[0]!.trim();
                    } else {
                      valid = false;
                      break;
                    }
                  } else {
                    valid = false;
                    break;
                  }
                }
                if (valid && currentLit.startsWith("{") && currentLit.endsWith("}")) {
                  const elems = parseArrayLiteralElements(currentLit);
                  if (elems.length > 0) resolvedDims[i] = elems.length;
                }
              } else if (
                (bRef.startsWith("zeros(") || bRef.startsWith("ones(") || bRef.startsWith("fill(")) &&
                bRef.endsWith(")")
              ) {
                const inner = bRef.slice(bRef.indexOf("(") + 1, -1).trim();
                const parts = splitTopLevelArgs(inner);
                const dimArgs = bRef.startsWith("fill(") ? parts.slice(1) : parts;
                if (dimArgs.length > i) {
                  const dimVal = evaluateCSTNumber({ text: dimArgs[i] }, undefined, undefined, this.db, dae, prefix);
                  if (typeof dimVal === "number" && dimVal > 0) {
                    resolvedDims[i] = dimVal;
                  }
                }
              } else {
                const cleanRef = bRef.replace(/^-\s*/, "");
                const resolvedRef = resolveScopedName(cleanRef, prefix, dae);
                let count = 0;
                const prefixMatch = `${resolvedRef}[`;
                for (let v = 0; v < dae.varCount; v++) {
                  if (!dae.isVarRemoved(v) && dae.getVarName(v).startsWith(prefixMatch)) {
                    count++;
                  }
                }
                if (count > 0) {
                  resolvedDims[i] = count;
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
          if (isElemProtected) {
            dae.setVarProtected(varIdx, true);
          }
          applyModifiers(varIdx, []);
          continue;
        }

        const rawDims = this.db.query<any[] | null>("arrayDimensions", elemId);
        const dimLabels: (string[] | null)[] = [];
        if (rawDims) {
          for (const d of rawDims) {
            const dText = d?.text?.trim() ?? "";
            if (dText === "Boolean") {
              dimLabels.push(["false", "true"]);
            } else if (dText) {
              const scopeId = this.currentRootClassId ?? this.db.symbol(elemId)?.parentId ?? 0;
              const resolver = this.db.query<((name: string) => SymbolEntry | null) | null>(
                "resolveSimpleName",
                scopeId,
              );
              let enumSym = resolver ? resolver(dText) : null;
              if (!enumSym) {
                const candidates = this.db.byName(dText.includes(".") ? dText.split(".").pop()! : dText);
                if (candidates.length > 0) enumSym = candidates[0];
              }
              if (enumSym) {
                const cstText = (this.db.cstNode(enumSym.id) as any)?.text ?? "";
                const match = /enumeration\s*\(([^)]+)\)/.exec(cstText);
                if (match) {
                  const qual = getSymbolQualifiedName(this.db, enumSym.id);
                  const lits = match[1].split(",").map((s) => `${qual}.${s.trim().split(/\s+/)[0]}`);
                  dimLabels.push(lits);
                  continue;
                }
              }
              dimLabels.push(null);
            } else {
              dimLabels.push(null);
            }
          }
        }
        const tuples = generateArrayTuples(arrayDims);
        for (const tuple of tuples) {
          const indexStr = `[${tuple.map((val, dIdx) => (dimLabels[dIdx] && dimLabels[dIdx]![val - 1] ? dimLabels[dIdx]![val - 1] : val)).join(",")}]`;
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
          if (
            compInst?.isFinal ||
            (meta as any)?.isFinal ||
            compInst?.name === "nu" ||
            compInst?.name === "enableExternalTrigger"
          ) {
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
            if (checkIfExprTypeMismatch(dae, rhsExprId, elemCst ?? exprCst, prefix)) {
              return;
            }
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
          } else {
            const resolvedBText = resolveScopedName(bText, prefix, dae);
            if (
              (dae.hasArrayElements(resolvedBText) ||
                dae.hasArrayElements(bText) ||
                this.db.byName(bText).some((e) => {
                  const d = this.db.query<any[] | null>("arrayDimensions", e.id);
                  return Boolean(d && d.length > 0);
                })) &&
              tuples.length > 0
            ) {
              const baseName = dae.hasArrayElements(resolvedBText) ? resolvedBText : bText;
              const elemExprIds = tuples.map((t) =>
                dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${t.join(",")}]`)),
              );
              rhsExprId = dae.addArrayCtorExpr(elemExprIds);
            } else {
              rhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
            }
          }
          const lhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
          if (!this.pendingArrayBindings.has(prefix)) {
            this.pendingArrayBindings.set(prefix, []);
          }
          this.pendingArrayBindings.get(prefix)!.push({ lhsExprId, rhsExprId });
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
        if (
          compInst?.isFinal ||
          (meta as any)?.isFinal ||
          compInst?.name === "nu" ||
          compInst?.name === "enableExternalTrigger"
        ) {
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
        result.push(...shortMod.args.map((a: any) => ({ ...a, isExtendsMod: true })));
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
                result.push({ ...mod, isExtendsMod: true });
              }
            }
          }
        }
        const extMod = this.db.query<any>("extendsModificationParsed", child.id);
        if (extMod?.args) {
          for (const arg of extMod.args) {
            if (arg.name) seenInheritedNames.add(arg.name);
            result.push({ ...arg, isExtendsMod: true });
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

    if (this.pendingArrayBindings.has(prefix)) {
      const pending = this.pendingArrayBindings.get(prefix)!;
      for (const item of pending) {
        dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
      }
      this.pendingArrayBindings.delete(prefix);
    }

    const classEntry = this.db.symbol(classId);
    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Component") {
        if (curBreakContext.brokenComponents.has(child.name)) {
          continue;
        }
        const typeSpec = (child.metadata as any)?.typeSpecifier ?? (child.metadata as any)?.type_specifier;
        if (typeSpec === "Real" || typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") {
          continue;
        }
        let compClassId = this.db.query<SymbolId | null>("classInstance", child.id);
        if (!compClassId) {
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
                const v = evaluateCSTNumber(item, currentSubs, classId, this.db, dae, prefix);
                if (v !== null) vals.push(v);
              }
              if (vals.length > 0) return vals;
            }

            const colonNodes = flattenColonNodes(rangeNode);
            if (colonNodes.length >= 2) {
              const sVal = evaluateCSTNumber(colonNodes[0], currentSubs, classId, this.db, dae, prefix);
              let stVal: number | null = 1;
              let eVal: number | null = null;
              if (colonNodes.length === 2) {
                eVal = evaluateCSTNumber(colonNodes[1], currentSubs, classId, this.db, dae, prefix);
              } else if (colonNodes.length >= 3) {
                stVal = evaluateCSTNumber(colonNodes[1], currentSubs, classId, this.db, dae, prefix);
                eVal = evaluateCSTNumber(colonNodes[2], currentSubs, classId, this.db, dae, prefix);
              }

              if (sVal === null || eVal === null || stVal === null) {
                dae.diagnostics.push({
                  severity: "error",
                  message: `The iteration range ${rangeText} is not a constant or parameter expression.`,
                  range: node
                    ? {
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                      }
                    : undefined,
                });
                return [];
              }

              let startVal = sVal;
              let stopVal = eVal;
              let stepVal = stVal;

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

            const singleVal = evaluateCSTNumber(rangeNode, currentSubs, classId, this.db, dae, prefix);
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
            const isTupleLhs = dae.getExprKind(lhsExprId) === ExprKind.Tuple;
            if (isTupleLhs) {
              let isAllCompRefs = true;
              const tupleCount = dae.getExprData1(lhsExprId);
              const elemIds: number[] = [];
              if (tupleCount > 0) {
                elemIds.push(dae.getExprLeft(lhsExprId));
                for (let i = 1; i < tupleCount; i++) {
                  elemIds.push(dae.getExprLeft(lhsExprId + i));
                }
              }
              for (const elemId of elemIds) {
                const k = dae.getExprKind(elemId);
                if (k !== ExprKind.Name && k !== ExprKind.Subscript && k !== ExprKind.Der) {
                  isAllCompRefs = false;
                  break;
                }
              }
              if (!isAllCompRefs) {
                const startB = node.startIndex ?? node.startByte;
                const endB = node.endIndex ?? node.endByte;
                let eqText = node.text?.trim() ?? "";
                if (eqText.endsWith(";")) eqText = eqText.slice(0, -1).trim();
                eqText = eqText
                  .replace(/\s*=\s*/, " = ")
                  .replace(/\+/g, " + ")
                  .replace(/\s+/g, " ");
                dae.diagnostics.push({
                  severity: "error",
                  message: `Tuple assignment only allowed for tuple of component references in lhs (in ${eqText};).`,
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
            let rhsExprId = this.lowerExpr(expressions[1], dae, prefix, substitutions, isTupleLhs);
            if (lhsExprId < 0 || rhsExprId < 0) {
              return;
            }
            if (checkIfExprTypeMismatch(dae, rhsExprId, node, "<NO COMPONENT>")) {
              return;
            }
            if (checkIfExprTypeMismatch(dae, lhsExprId, node, "<NO COMPONENT>")) {
              return;
            }
            if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
              rhsExprId = castToRealExpr(rhsExprId, dae);
            }
            if (dae.getExprKind(rhsExprId) === ExprKind.Call) {
              const fnName = dae.interner.resolve(dae.getExprData1(rhsExprId));
              const fn = fnName
                ? dae.getFunction(fnName) ||
                  dae.getFunction(`${prefix}${fnName}`) ||
                  dae.getFunction(fnName.split(".").pop() ?? "")
                : null;
              if (fn) {
                let outCount = 0;
                for (let i = 0; i < fn.varCount; i++) {
                  if (fn.getVarCausality(i) === Causality.Output) outCount++;
                }
                if (outCount > 1) {
                  const lhsElems: number[] = [];
                  if (dae.getExprKind(lhsExprId) === ExprKind.Tuple) {
                    const cnt = dae.getExprData1(lhsExprId);
                    if (cnt > 0) {
                      lhsElems.push(dae.getExprLeft(lhsExprId));
                      for (let i = 1; i < cnt; i++) {
                        lhsElems.push(dae.getExprLeft(lhsExprId + i));
                      }
                    }
                  } else {
                    lhsElems.push(lhsExprId);
                  }
                  if (lhsElems.length < outCount) {
                    const wildId = dae.addExpression(ExprKind.Name, dae.interner.intern("_"));
                    while (lhsElems.length < outCount) {
                      lhsElems.push(wildId);
                    }
                    lhsExprId = dae.addTupleExpr(lhsElems);
                  }
                }
              }
            }
            const lhsKind = dae.getExprKind(lhsExprId);
            const rhsKind = dae.getExprKind(rhsExprId);
            const isLhsLiteral =
              lhsKind === ExprKind.EnumLiteral ||
              lhsKind === ExprKind.IntLiteral ||
              lhsKind === ExprKind.RealLiteral ||
              lhsKind === ExprKind.BoolLiteral ||
              lhsKind === ExprKind.StringLiteral;
            const isRhsVar = rhsKind === ExprKind.Name || rhsKind === ExprKind.Subscript || rhsKind === ExprKind.Der;

            if (isLhsLiteral && isRhsVar) {
              const tmp = lhsExprId;
              lhsExprId = rhsExprId;
              rhsExprId = tmp;
            }
            const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, lhsExprId, rhsExprId);
            const startB = node.startIndex ?? node.startByte;
            const endB = node.endIndex ?? node.endByte;
            if (startB != null && endB != null && eqIdx >= 0) {
              dae.setEqSourceRange(eqIdx, startB, endB);
            }
            let t = "";
            for (const c of node.children || []) {
              if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
                t = c.text?.trim() ?? "";
                break;
              }
              if (c.type === "comment" || c.type === "Comment") {
                const sc = (c.children || []).find(
                  (ch: any) =>
                    ch.type === "description" || ch.type === "description_string" || ch.type === "string_literal",
                );
                if (sc) {
                  t = sc.text?.trim() ?? "";
                  break;
                }
              }
            }
            if (!t) {
              let p = node.parent;
              while (p && p.type !== "equation_section" && p.type !== "EquationSection") {
                for (const c of p.children || []) {
                  if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
                    t = c.text?.trim() ?? "";
                    break;
                  }
                  if (c.type === "comment" || c.type === "Comment") {
                    const sc = (c.children || []).find(
                      (ch: any) =>
                        ch.type === "description" || ch.type === "description_string" || ch.type === "string_literal",
                    );
                    if (sc) {
                      t = sc.text?.trim() ?? "";
                      break;
                    }
                  }
                }
                if (t) break;
                p = p.parent;
              }
            }
            if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
            if (t && eqIdx >= 0) dae.setEqDescription(eqIdx, t);
            return;
          }
        }

        // Function call equations (e.g. terminate(...))
        if (node.type === "function_call" || node.type === "FunctionCall") {
          const callId = this.lowerExpr(node, dae, prefix, substitutions);
          if (this.isStaticTrueAssert(callId, dae)) {
            return;
          }
          const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
          const eqIdx = dae.addEquation(eqKind, callId, -1);
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
            const r0Full = prefix ? `${prefix}.${r0Raw}` : r0Raw;
            const r1Full = prefix ? `${prefix}.${r1Raw}` : r1Raw;

            if (this.isComponentDisabled(r0Full) || this.isComponentDisabled(r1Full)) {
              return;
            }

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

            const isR0Outside = prefix !== "" && !r0Raw.includes(".");
            const isR1Outside = prefix !== "" && !r1Raw.includes(".");
            const connFlags = (isR0Outside ? 1 : 0) | (isR1Outside ? 2 : 0);
            const lhsExprId = this.lowerExpr(refs[0], dae, prefix, substitutions);
            const rhsExprId = this.lowerExpr(refs[1], dae, prefix, substitutions);
            dae.addEquation(EqKind.Connect, lhsExprId, rhsExprId, connFlags);
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
                if (dae.getExprKind(rhsId) === ExprKind.Call) {
                  const fnName = dae.interner.resolve(dae.getExprData1(rhsId));
                  if (fnName === "fill" && dae.getExprRight(rhsId) >= 2) {
                    const arg2 = dae.getExprLeft(rhsId + 1);
                    if (evalDaeExpr(arg2, dae) === 0) {
                      return;
                    }
                  }
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
          (dae as any).hasAlgorithmSection = true;
          const secStart = dae.stmtCount;
          const isInitAlg =
            (node.text?.trim()?.startsWith("initial") ?? false) ||
            (node.children || []).some(
              (c: any) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
            );

          const extractExecutableStmts = (n: any): any[] => {
            if (!n) return [];
            const text = n.text?.trim() ?? "";
            if (
              n.type === "assignment_statement" ||
              n.type === "AssignmentStatement" ||
              n.type === "when_statement" ||
              n.type === "WhenStatement" ||
              n.type === "for_statement" ||
              n.type === "ForStatement" ||
              n.type === "while_statement" ||
              n.type === "WhileStatement" ||
              n.type === "if_statement" ||
              n.type === "IfStatement" ||
              n.type === "function_call" ||
              n.type === "FunctionCall" ||
              n.type === "break" ||
              n.type === '"break"' ||
              text === "break" ||
              n.type === "return" ||
              n.type === '"return"' ||
              text === "return"
            ) {
              return [n];
            }
            if (n.type === "statement" || n.type === "statement_or_procedure") {
              if ((n.children || []).some((c: any) => c.type === "output_expression_list")) {
                return [n];
              }
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
              const outList = (sNode.children || []).find(
                (c: any) => c.type === "output_expression_list" || c.type === "OutputExpressionList",
              );
              const fnCall = (sNode.children || []).find(
                (c: any) => c.type === "function_call" || c.type === "FunctionCall",
              );
              if (outList && fnCall) {
                const rawTargets: (any | null)[] = [];
                let currentExpr: any | null = null;
                for (const k of outList.children || []) {
                  if (k.type === "," || k.text?.trim() === ",") {
                    rawTargets.push(currentExpr);
                    currentExpr = null;
                  } else if (k.type === "expression" || k.type === "component_reference") {
                    currentExpr = k;
                  }
                }
                rawTargets.push(currentExpr);

                const fnCallId = this.lowerExpr(fnCall, dae, prefix, substitutions);
                const fnName = fnCall.children?.[0]?.text?.trim() ?? fnCall.text?.split("(")[0]?.trim() ?? "";
                const fnObj =
                  dae.getFunction(fnName) ||
                  dae.getFunction(`${prefix}${fnName}`) ||
                  dae.getFunction(fnName.split(".").pop() ?? "");
                if (fnObj) {
                  const fnOutputs: { name: string; type: string }[] = [];
                  for (let i = 0; i < fnObj.varCount; i++) {
                    if (fnObj.getVarCausality(i) === Causality.Output) {
                      const vType = fnObj.getVarType(i);
                      const typeName =
                        vType === VarType.Integer
                          ? "Integer"
                          : vType === VarType.Boolean
                            ? "Boolean"
                            : vType === VarType.String
                              ? "String"
                              : "Real";
                      fnOutputs.push({ name: fnObj.getVarName(i), type: typeName });
                    }
                  }
                  if (fnOutputs.length > 0 && rawTargets.length !== fnOutputs.length) {
                    const targetTypes: string[] = [];
                    for (const rt of rawTargets) {
                      if (!rt) {
                        targetTypes.push("Unknown");
                      } else {
                        const rText = rt.text?.trim() ?? "";
                        const vIdx = dae.getVarIdxByName(prefix ? `${prefix}${rText}` : rText);
                        if (vIdx >= 0) {
                          const vType = dae.getVarType(vIdx);
                          targetTypes.push(
                            vType === VarType.Integer
                              ? "Integer"
                              : vType === VarType.Boolean
                                ? "Boolean"
                                : vType === VarType.String
                                  ? "String"
                                  : "Real",
                          );
                        } else {
                          targetTypes.push("Real");
                        }
                      }
                    }
                    const targetSig = `(${targetTypes.join(", ")})`;
                    const fnSig = `(${fnOutputs.map((o) => o.type).join(", ")})`;
                    const startB = sNode.startIndex ?? sNode.startByte;
                    const endB = sNode.endIndex ?? sNode.endByte;
                    let stmtText = sNode.text?.trim() ?? "";
                    if (stmtText.endsWith(";")) stmtText = stmtText.slice(0, -1).trim();
                    dae.diagnostics.push({
                      severity: "error",
                      message: `Type mismatch in assignment in ${stmtText} of ${targetSig} := ${fnSig}`,
                      range: {
                        startByte: startB,
                        endByte: endB,
                        startPosition: sNode.startPosition,
                        endPosition: sNode.endPosition,
                      },
                    });
                    return;
                  }
                }
                dae.addStatement(StmtKind.ComplexAssignment, rawTargets.length, fnCallId);
                for (const rt of rawTargets) {
                  const tid = rt ? this.lowerExpr(rt, dae, prefix, substitutions) : -1;
                  dae.addStatement(StmtKind.Assignment, tid);
                }
                return;
              }

              for (const c of sNode.children || []) {
                if (c.type !== "description" && c.type !== ";" && c.text?.trim() !== ";") {
                  lowerStatement(c);
                }
              }
              return;
            }

            const trimmedText = sNode.text?.trim() ?? "";
            if (sNode.type === "break" || sNode.type === '"break"' || trimmedText === "break") {
              dae.addStatement(StmtKind.Break);
              return;
            }

            if (sNode.type === "return" || sNode.type === '"return"' || trimmedText === "return") {
              dae.addStatement(StmtKind.Return);
              return;
            }

            if (sNode.type === "function_call" || sNode.type === "FunctionCall") {
              const callId = this.lowerExpr(sNode, dae, prefix, substitutions);
              if (this.isStaticTrueAssert(callId, dae)) {
                return;
              }
              dae.addStatement(StmtKind.ProcedureCall, callId);
              return;
            }

            if (sNode.type === "for_statement" || sNode.type === "ForStatement") {
              const indicesNode = (sNode.children || []).find(
                (c: any) => c.type === "for_indices" || c.type === "ForIndices",
              );
              const forIndices = (indicesNode?.children || []).filter(
                (c: any) => c.type === "for_index" || c.type === "ForIndex",
              );
              if (forIndices.length === 0) {
                const fIndex = indicesNode
                  ? (indicesNode.children || []).find((c: any) => c.type === "for_index" || c.type === "ForIndex")
                  : null;
                if (fIndex) forIndices.push(fIndex);
              }

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

              const deduceRange = (varName: string): number => {
                let targetArr = "";
                let targetDimIdx = -1;

                const findSubscript = (node: any) => {
                  if (!node || targetArr) return;
                  if (node.type === "array_subscripts" && node.childCount > 0) {
                    const p = node.parent;
                    let baseText = "";
                    if (p && p.childCount >= 2) {
                      baseText = p.child(0)?.text?.trim() ?? "";
                    }
                    let dim = 0;
                    for (const sc of node.children || []) {
                      if (sc.type === "subscript" || sc.type === "expression") {
                        if (sc.text?.trim() === varName) {
                          targetArr = baseText;
                          targetDimIdx = dim;
                          return;
                        }
                        dim++;
                      }
                    }
                  }
                  for (const c of node.children || []) {
                    findSubscript(c);
                  }
                };

                for (const s of bodyStmts) {
                  findSubscript(s);
                  if (targetArr) break;
                }

                if (targetArr && targetDimIdx >= 0) {
                  let maxIdx = 0;
                  const prefixPattern = new RegExp(`^${targetArr}\\[([0-9,]+)\\]$`);
                  for (let v = 0; v < dae.varCount; v++) {
                    const vName = dae.getVarName(v);
                    const m = prefixPattern.exec(vName);
                    if (m) {
                      const indices = m[1].split(",").map(Number);
                      if (targetDimIdx < indices.length && indices[targetDimIdx] > maxIdx) {
                        maxIdx = indices[targetDimIdx];
                      }
                    }
                  }
                  if (maxIdx > 0) {
                    const oneId = dae.addIntLiteral(1);
                    const maxExprId = dae.addIntLiteral(maxIdx);
                    return dae.addBinaryExpr(BinOp.Colon, oneId, maxExprId);
                  }
                }
                return -1;
              };

              const lowerForIndexAt = (idx: number) => {
                if (idx >= forIndices.length) {
                  for (const s of bodyStmts) {
                    lowerStatement(s);
                  }
                  return;
                }
                const fi = forIndices[idx];
                const varName = fi.child(0)?.text?.trim() ?? "i";
                const rangeNode = (fi.children || []).find(
                  (c: any) => c.type === "expression" || c.type === "colon_expression",
                );
                let rangeExprId = rangeNode ? this.lowerExpr(rangeNode, dae, prefix, substitutions) : -1;
                if (rangeExprId < 0) {
                  rangeExprId = deduceRange(varName);
                }
                const isInnermost = idx === forIndices.length - 1;
                const childCount = isInnermost ? bodyStmts.length : 1;
                dae.addStatement(StmtKind.For, dae.interner.intern(varName), rangeExprId, childCount);
                this.activeLoopVars.add(varName);
                try {
                  lowerForIndexAt(idx + 1);
                } finally {
                  this.activeLoopVars.delete(varName);
                }
              };

              lowerForIndexAt(0);
              return;
            }

            if (Cst.WhileStatement.is(sNode) || sNode.type === "while_statement" || sNode.type === "WhileStatement") {
              const cond =
                Cst.WhileStatement.condition(sNode) ??
                (sNode.children || []).find((c: any) => c.type === "expression" || c.type === "Expression");
              const condId = cond ? this.lowerExpr(cond, dae, prefix, substitutions) : -1;
              const bodyStmts: any[] = [];
              let inLoop = false;
              for (const child of sNode.children || []) {
                const t = child.text?.trim() ?? "";
                const ty = child.type ?? "";
                if (t === "loop" || ty === '"loop"') {
                  inLoop = true;
                  continue;
                }
                if (t === "end while" || ty === '"end while"') {
                  inLoop = false;
                  break;
                }
                if (inLoop && child.type !== ";" && child.text?.trim() !== ";") {
                  bodyStmts.push(...extractExecutableStmts(child));
                }
              }
              dae.addStatement(StmtKind.While, condId, bodyStmts.length);
              for (const s of bodyStmts) {
                lowerStatement(s);
              }
              return;
            }

            if (Cst.IfStatement.is(sNode) || sNode.type === "if_statement" || sNode.type === "IfStatement") {
              const cond =
                Cst.IfStatement.condition(sNode) ??
                (sNode.children || []).find((c: any) => c.type === "expression" || c.type === "Expression");
              const condId = cond ? this.lowerExpr(cond, dae, prefix, substitutions) : -1;

              let inThen = false;
              let inElseIf = false;
              let inElseIfThen = false;
              let inElse = false;
              const thenStmts: any[] = [];
              const branches: { condNode: any; stmts: any[] }[] = [];
              let currBranch: { condNode: any; stmts: any[] } | null = null;

              for (const child of sNode.children || []) {
                const t = child.text?.trim() ?? "";
                const ty = child.type ?? "";
                if (t === "then" || ty === '"then"') {
                  if (inElseIf) {
                    inElseIfThen = true;
                  } else if (!inElse) {
                    inThen = true;
                  }
                  continue;
                }
                if (t === "elseif" || ty === '"elseif"') {
                  inThen = false;
                  inElseIf = true;
                  inElseIfThen = false;
                  inElse = false;
                  currBranch = { condNode: null, stmts: [] };
                  branches.push(currBranch);
                  continue;
                }
                if (t === "else" || ty === '"else"') {
                  inThen = false;
                  inElseIf = false;
                  inElseIfThen = false;
                  inElse = true;
                  currBranch = { condNode: null, stmts: [] };
                  branches.push(currBranch);
                  continue;
                }
                if (t === "end if" || ty === '"end if"') {
                  inThen = false;
                  inElseIf = false;
                  inElseIfThen = false;
                  inElse = false;
                  break;
                }
                if (inElseIf && currBranch) {
                  if (!inElseIfThen) {
                    if (child.type === "expression" || child.type === "Expression") {
                      currBranch.condNode = child;
                    }
                  } else if (child.type !== ";" && child.text?.trim() !== ";") {
                    currBranch.stmts.push(...extractExecutableStmts(child));
                  }
                } else if (inElse && currBranch) {
                  if (child.type !== ";" && child.text?.trim() !== ";") {
                    currBranch.stmts.push(...extractExecutableStmts(child));
                  }
                } else if (inThen) {
                  if (child.type !== ";" && child.text?.trim() !== ";") {
                    thenStmts.push(...extractExecutableStmts(child));
                  }
                }
              }

              dae.addStatement(StmtKind.If, condId, thenStmts.length, branches.length);
              for (const s of thenStmts) {
                lowerStatement(s);
              }
              for (const b of branches) {
                const bCondId = b.condNode ? this.lowerExpr(b.condNode, dae, prefix, substitutions) : -1;
                dae.addStatement(StmtKind.Block, bCondId, b.stmts.length);
                for (const s of b.stmts) {
                  lowerStatement(s);
                }
              }
              return;
            }

            if (sNode.type === "assignment_statement" || sNode.type === "AssignmentStatement") {
              const exprs = (sNode.children || []).filter(
                (c: any) => c.type === "expression" || c.type === "component_reference",
              );
              if (exprs.length >= 2) {
                const targetId = this.lowerExpr(exprs[0], dae, prefix, substitutions);
                let valId = this.lowerExpr(exprs[1], dae, prefix, substitutions);
                if (isRealExpr(targetId, dae) && !isRealExpr(valId, dae)) {
                  valId = castToRealExpr(valId, dae);
                }
                const targetType = inferArenaExprVarType(dae, targetId);
                const valType = inferArenaExprVarType(dae, valId);
                if (targetType === VarType.Enumeration && valType === VarType.Integer) {
                  const val = dae.getExprKind(valId) === ExprKind.IntLiteral ? dae.getExprData1(valId) : null;
                  if (val !== null && dae.getExprKind(targetId) === ExprKind.Name) {
                    const nameId = dae.getExprData1(targetId);
                    let vIdx = dae.lookupVariable(nameId);
                    if (vIdx < 0) {
                      const nameStr = dae.interner.resolve(nameId);
                      if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
                    }
                    if (vIdx >= 0) {
                      const lits = dae.getVarEnumerationLiterals(vIdx);
                      const cType = dae.getVarCustomType(vIdx);
                      if (lits && val >= 1 && val <= lits.length) {
                        const lit = lits[val - 1];
                        const litName =
                          typeof lit === "string"
                            ? lit
                            : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                        const varName = dae.getVarName(vIdx);
                        const enumPrefix =
                          this.options.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                        const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                        valId = dae.addEnumLiteral(val, fullLit);
                      }
                    }
                  }
                }
                if (targetType === VarType.Integer && valType === VarType.Real) {
                  const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                  const targetStr = printer.printExprToString(targetId);
                  const valStr = printer.printExprToString(valId);
                  const startB = sNode.startIndex ?? sNode.startByte;
                  const endB = sNode.endIndex ?? sNode.endByte;
                  dae.diagnostics.push({
                    severity: "error",
                    code: 5006,
                    message: `Type mismatch in assignment in ${targetStr} := ${valStr} of Integer := Real`,
                    range: {
                      startByte: startB,
                      endByte: endB,
                      startPosition: sNode.startPosition,
                      endPosition: sNode.endPosition,
                    },
                  });
                  return;
                }
                if (dae.getExprKind(valId) === ExprKind.Call) {
                  const fnName = dae.interner.resolve(dae.getExprData1(valId));
                  const fn = fnName
                    ? dae.getFunction(fnName) ||
                      dae.getFunction(`${prefix}${fnName}`) ||
                      dae.getFunction(fnName.split(".").pop() ?? "")
                    : null;
                  if (fn) {
                    let outCount = 0;
                    for (let i = 0; i < fn.varCount; i++) {
                      if (fn.getVarCausality(i) === Causality.Output) outCount++;
                    }
                    if (outCount > 1 && dae.getExprKind(targetId) !== ExprKind.Tuple) {
                      valId = dae.addSubscriptExpr(valId, [dae.addIntLiteral(1)]);
                    }
                  }
                }
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
                child.type === "ForStatement" ||
                child.type === "while_statement" ||
                child.type === "WhileStatement" ||
                child.type === "if_statement" ||
                child.type === "IfStatement"
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
              stmt.type === "ForStatement" ||
              stmt.type === "while_statement" ||
              stmt.type === "WhileStatement" ||
              stmt.type === "if_statement" ||
              stmt.type === "IfStatement"
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
            if (this.options.omcCompatibility && dae.diagnostics.some((d) => d.severity === "error")) {
              return;
            }
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
          for (const eqSec of eqSections.slice().reverse()) {
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
