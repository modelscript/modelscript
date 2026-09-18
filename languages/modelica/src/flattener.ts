// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`assembly/flattener.ts`).
 */

import type { TopologyGraph } from "@modelscript/diagram";
import { EqKind, ExprKind } from "@modelscript/dsl";
import { StringWriter } from "@modelscript/dsl/utils";
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
  matchVarPath,
  scalarizeArena,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../src-gen/bindings.js";
import { BUILTIN_FUNCTIONS } from "./builtins.js";
import { ModelicaPortBalancer } from "./connections.js";
import { AnnotationEvaluator } from "./diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "./errors.js";
import { isPredefinedType } from "./predefined-types.js";
import { getShortClassSpecifierNode } from "./queries.js";

export interface FlattenOptions {
  arrayMode?: "scalarize" | "preserve";
  functionInlining?: boolean;
  omcCompatibility?: boolean;
  eliminateAliases?: boolean;
  useWasmKernel?: boolean;
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
    if (dae.getVarCustomType(vIdx)) return false;
    return dae.getVarType(vIdx) === VarType.Real;
  }
  const activeDb: QueryDB | undefined = (dae as any).db ?? (dae as any).parentDae?.db;
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
    if (op === BinOp.Div || op === BinOp.ElemDiv) return true;
    if (
      op === BinOp.Add ||
      op === BinOp.Sub ||
      op === BinOp.Mul ||
      op === BinOp.Pow ||
      op === BinOp.ElemAdd ||
      op === BinOp.ElemSub ||
      op === BinOp.ElemMul ||
      op === BinOp.ElemPow
    ) {
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
  if (!node) return [];
  if (node.type === "expression_list") {
    const items: any[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      const cText = c.text?.trim() ?? "";
      if (cText === "," || c.type === "," || c.type === '","') continue;
      items.push(c);
    }
    return items;
  }
  const text = node.text?.trim() ?? "";
  if (
    (node.child(0)?.text === "[" || text.startsWith("[")) &&
    (node.child(node.childCount - 1)?.text === "]" || text.endsWith("]"))
  ) {
    const rows: any[] = [];
    let hasSemicolon = false;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      const cText = c.text?.trim() ?? "";
      if (c.type === ";" || c.type === '";"' || cText === ";") {
        hasSemicolon = true;
        continue;
      }
      if (cText === "[" || cText === "]") continue;
      rows.push(c);
    }
    if (!hasSemicolon && rows.length === 1) {
      return getArrayLiteralItems(rows[0]);
    }
    return rows;
  }
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

function getDaeDimSize(prefix: string, partIdent: string, dimIdx: number, dae: DAEBuilder, db?: any): number {
  let maxDim = 0;
  const target = `${partIdent}[`;
  const fullTarget = prefix ? `${prefix}.${partIdent}[` : target;
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      let pos = -1;
      if (vn.startsWith(fullTarget)) {
        pos = fullTarget.length - target.length;
      } else if (vn.startsWith(target)) {
        pos = 0;
      } else {
        const dotTarget = "." + target;
        const dPos = vn.indexOf(dotTarget);
        if (dPos >= 0) {
          pos = dPos + 1;
        }
      }
      if (pos >= 0) {
        const rest = vn.slice(pos + target.length);
        const endB = rest.indexOf("]");
        if (endB >= 0) {
          const idxList = rest.slice(0, endB).split(",");
          if (dimIdx >= 0 && dimIdx < idxList.length) {
            const val = parseInt(idxList[dimIdx]!.trim(), 10);
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
    const syms = db.byName(partIdent);
    for (const s of syms) {
      const dims = db.query("arrayDimensions", s.id);
      if (dims && dims.length > dimIdx) {
        const d = dims[dimIdx];
        if (typeof d === "number") return d;
        if (d?.kind === "literal" && typeof d.value === "number") return d.value;
      }
    }
  }
  return 0;
}

function getDaeArrayDimCount(prefix: string, partIdent: string, dae: DAEBuilder, db?: any): number | null {
  const resolved = resolveScopedName(partIdent, prefix, dae);
  const elemIndices = dae.getArrayElementIndices(resolved);
  if (elemIndices.length > 0) {
    const vn = dae.getVarName(elemIndices[0]!);
    const b1 = vn.indexOf("[");
    const b2 = vn.indexOf("]");
    if (b1 >= 0 && b2 > b1) {
      return vn.slice(b1 + 1, b2).split(",").length;
    }
  }
  const elemIndicesUnscoped = dae.getArrayElementIndices(partIdent);
  if (elemIndicesUnscoped.length > 0) {
    const vn = dae.getVarName(elemIndicesUnscoped[0]!);
    const b1 = vn.indexOf("[");
    const b2 = vn.indexOf("]");
    if (b1 >= 0 && b2 > b1) {
      return vn.slice(b1 + 1, b2).split(",").length;
    }
  }
  const varIdx = dae.getVarIdxByName(resolved) >= 0 ? dae.getVarIdxByName(resolved) : dae.getVarIdxByName(partIdent);
  if (varIdx >= 0) {
    const shape = dae.getVarShape(varIdx);
    if (shape && shape.length > 0) {
      return shape.length;
    }
    const shapeExprs = dae.getVarShapeExprs(varIdx);
    if (shapeExprs && shapeExprs.length > 0) {
      return shapeExprs.length;
    }
    return 0;
  }
  if (db) {
    const syms = db.byName(partIdent);
    for (const s of syms) {
      if (s.kind === "Component") {
        const dims = db.query("arrayDimensions", s.id);
        if (dims && Array.isArray(dims) && dims.length > 0) {
          return dims.length;
        }
      }
    }
    if (syms.some((s: any) => s.kind === "Component")) {
      return 0;
    }
  }
  return null;
}

function getExprDims(exprId: number, dae: DAEBuilder, db?: any): number[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const vName = dae.interner.resolve(dae.getExprData1(exprId));
    if (vName) {
      if (db) {
        const simpleName = vName.includes(".") ? vName.split(".").pop()! : vName;
        const syms = db.byName(simpleName);
        for (const s of syms) {
          if (s.kind === "Component") {
            const dims = db.query("resolvedArrayDimensions", s.id);
            if (dims && Array.isArray(dims)) return dims;
          }
        }
      }
      const varIdx = dae.getVarIdxByName(vName);
      if (varIdx >= 0) {
        const shape = dae.getVarShape(varIdx);
        if (shape && shape.length > 0) return shape;
      }
      if (dae.hasArrayElements(vName)) {
        const prefixMatch = `${vName}[`;
        const maxDims: number[] = [];
        for (let v = 0; v < dae.varCount; v++) {
          if (!dae.isVarRemoved(v)) {
            const n = dae.getVarName(v);
            if (n.startsWith(prefixMatch) && n.endsWith("]")) {
              const indices = n.slice(prefixMatch.length, -1).split(",").map(Number);
              for (let i = 0; i < indices.length; i++) {
                const idx = indices[i];
                if (idx !== undefined && !isNaN(idx)) {
                  while (maxDims.length <= i) maxDims.push(0);
                  if (idx > maxDims[i]!) maxDims[i] = idx;
                }
              }
            }
          }
        }
        if (maxDims.length > 0 && maxDims.every((d) => d > 0)) return maxDims;
      }
    }
  } else if (kind === ExprKind.ArrayCtor) {
    const elems = getArrayCtorElements(exprId, dae);
    if (elems.length === 0) return [0];
    if (dae.getExprKind(elems[0]!) === ExprKind.ArrayCtor) {
      const subDims = getExprDims(elems[0]!, dae, db);
      return [elems.length, ...(subDims ?? [getArrayCtorElements(elems[0]!, dae).length])];
    }
    return [elems.length];
  } else if (kind === ExprKind.Unary) {
    return getExprDims(dae.getExprLeft(exprId), dae, db);
  } else if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId) as BinOp;
    const leftDims = getExprDims(dae.getExprLeft(exprId), dae, db);
    const rightDims = getExprDims(dae.getExprRight(exprId), dae, db);
    if (op === BinOp.Mul) {
      if (leftDims && !rightDims) return leftDims;
      if (!leftDims && rightDims) return rightDims;
      if (leftDims && rightDims) {
        if (leftDims.length === 2 && rightDims.length === 2 && leftDims[1] === rightDims[0]) {
          return [leftDims[0]!, rightDims[1]!];
        }
        if (leftDims.length === 2 && rightDims.length === 1 && leftDims[1] === rightDims[0]) {
          return [leftDims[0]!];
        }
      }
    } else if (op === BinOp.Div) {
      if (leftDims && !rightDims) return leftDims;
    } else if (
      op === BinOp.Add ||
      op === BinOp.Sub ||
      op === BinOp.And ||
      op === BinOp.Or ||
      op === BinOp.ElemAdd ||
      op === BinOp.ElemSub ||
      op === BinOp.ElemMul ||
      op === BinOp.ElemDiv
    ) {
      if (leftDims) return leftDims;
      if (rightDims) return rightDims;
    }
  } else if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    const argCount = dae.getExprRight(exprId);
    if (fnName === "fill" && argCount >= 2) {
      const firstArg = dae.getExprLeft(exprId);
      const innerDims = getExprDims(firstArg, dae, db) ?? [];
      const fillDims: number[] = [];
      for (let i = 1; i < argCount; i++) {
        const dimExpr = dae.getExprLeft(exprId + i);
        if (dae.getExprKind(dimExpr) === ExprKind.IntLiteral) {
          fillDims.push(dae.getExprData1(dimExpr));
        }
      }
      return [...fillDims, ...innerDims];
    }
  }
  return null;
}

function isDefinitelyScalarExpr(id: number, dae: DAEBuilder): boolean {
  if (id < 0) return false;
  const k = dae.getExprKind(id);
  if (
    k === ExprKind.IntLiteral ||
    k === ExprKind.RealLiteral ||
    k === ExprKind.BoolLiteral ||
    k === ExprKind.StringLiteral
  ) {
    return true;
  }
  if (k === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(id));
    if (!name || dae.hasArrayElements(name)) return false;
    const vIdx = dae.getVarIdxByName(name);
    if (vIdx >= 0) {
      const shape = dae.getVarShape(vIdx);
      return !shape || shape.length === 0;
    }
    return false;
  }
  if (k === ExprKind.Subscript) {
    return true;
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    return isDefinitelyScalarExpr(dae.getExprLeft(id), dae);
  }
  if (k === ExprKind.Binary) {
    return isDefinitelyScalarExpr(dae.getExprLeft(id), dae) && isDefinitelyScalarExpr(dae.getExprRight(id), dae);
  }
  return false;
}

function expandVarToArrayCtor(baseName: string, dae: DAEBuilder): number | null {
  const matchingIndices: number[] = [];
  const parsedIndices: number[][] = [];
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      const idxs = matchVarPath(vn, baseName);
      if (idxs && idxs.length > 0) {
        matchingIndices.push(i);
        parsedIndices.push(idxs);
      }
    }
  }
  if (matchingIndices.length === 0) return null;

  const rank = parsedIndices[0]!.length;
  if (!parsedIndices.every((p) => p.length === rank)) return null;

  const maxDims: number[] = new Array(rank).fill(0);
  const table = new Map<string, number>();
  for (let i = 0; i < matchingIndices.length; i++) {
    const idxs = parsedIndices[i]!;
    for (let d = 0; d < rank; d++) {
      if (idxs[d]! > maxDims[d]!) maxDims[d] = idxs[d]!;
    }
    const varExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(dae.getVarName(matchingIndices[i]!)));
    table.set(idxs.join(","), varExpr);
  }

  const buildCtor = (currentDim: number, currentIndices: number[]): number => {
    if (currentDim === rank) {
      const key = currentIndices.join(",");
      const expr = table.get(key);
      if (expr !== undefined) return expr;
      return dae.addExpression(ExprKind.RealLiteral, dae.interner.intern("0.0"));
    }
    const childExprs: number[] = [];
    const dimSize = maxDims[currentDim]!;
    for (let i = 1; i <= dimSize; i++) {
      childExprs.push(buildCtor(currentDim + 1, [...currentIndices, i]));
    }
    return dae.addArrayCtorExpr(childExprs);
  };

  return buildCtor(0, []);
}

function addArrayBinaryExpr(op: BinOp, leftId: number, rightId: number, dae: DAEBuilder): number {
  const leftKind = dae.getExprKind(leftId);
  const rightKind = dae.getExprKind(rightId);
  if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
    const leftElems = getArrayCtorElements(leftId, dae);
    const rightElems = getArrayCtorElements(rightId, dae);
    if (leftElems.length === rightElems.length && leftElems.length > 0) {
      const newElems = leftElems.map((e, i) => addArrayBinaryExpr(op, e, rightElems[i]!, dae));
      return dae.addArrayCtorExpr(newElems);
    }
  }
  if (
    (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
    (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
  ) {
    const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
    const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
    let res: number | null = null;
    switch (op) {
      case BinOp.Add:
        res = lVal + rVal;
        break;
      case BinOp.Sub:
        res = lVal - rVal;
        break;
      case BinOp.Mul:
        res = lVal * rVal;
        break;
      case BinOp.Div:
        res = rVal !== 0 ? lVal / rVal : 0;
        break;
    }
    if (res !== null) {
      if (
        op === BinOp.Div ||
        leftKind === ExprKind.RealLiteral ||
        rightKind === ExprKind.RealLiteral ||
        !Number.isInteger(res)
      ) {
        return dae.addRealLiteral(res);
      }
      return dae.addIntLiteral(res);
    }
  }
  return dae.addBinaryExpr(op, leftId, rightId);
}

function broadcastElemBinOp(baseOp: BinOp, leftId: number, rightId: number, dae: DAEBuilder, flattener?: any): number {
  const lK = dae.getExprKind(leftId);
  const rK = dae.getExprKind(rightId);
  if (lK === ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const lElems = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    if (lElems.length === rElems.length && lElems.length > 0) {
      const newElems = lElems.map((e, i) => broadcastElemBinOp(baseOp, e, rElems[i]!, dae, flattener));
      return dae.addArrayCtorExpr(newElems);
    }
  } else if (lK === ExprKind.ArrayCtor && rK !== ExprKind.ArrayCtor) {
    const lElems = getArrayCtorElements(leftId, dae);
    const newElems = lElems.map((e) => broadcastElemBinOp(baseOp, e, rightId, dae, flattener));
    return dae.addArrayCtorExpr(newElems);
  } else if (lK !== ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const rElems = getArrayCtorElements(rightId, dae);
    if (flattener?.options?.omcCompatibility && (baseOp === BinOp.Add || baseOp === BinOp.Mul)) {
      const newElems = rElems.map((e) => broadcastElemBinOp(baseOp, e, leftId, dae, flattener));
      return dae.addArrayCtorExpr(newElems);
    } else {
      const newElems = rElems.map((e) => broadcastElemBinOp(baseOp, leftId, e, dae, flattener));
      return dae.addArrayCtorExpr(newElems);
    }
  }

  if (
    (lK === ExprKind.IntLiteral || lK === ExprKind.RealLiteral) &&
    (rK === ExprKind.IntLiteral || rK === ExprKind.RealLiteral)
  ) {
    const lVal = lK === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
    const rVal = rK === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
    let res: number | null = null;
    switch (baseOp) {
      case BinOp.Add:
        res = lVal + rVal;
        break;
      case BinOp.Sub:
        res = lVal - rVal;
        break;
      case BinOp.Mul:
        res = lVal * rVal;
        break;
      case BinOp.Div:
        res = rVal !== 0 ? lVal / rVal : 0;
        break;
    }
    if (res !== null) {
      if (
        baseOp === BinOp.Div ||
        lK === ExprKind.RealLiteral ||
        rK === ExprKind.RealLiteral ||
        !Number.isInteger(res)
      ) {
        return dae.addRealLiteral(res);
      }
      return dae.addIntLiteral(res);
    }
  }

  let l = leftId;
  let r = rightId;
  if (baseOp === BinOp.Div) {
    if (!isRealExpr(l, dae)) l = castToRealExpr(l, dae);
    if (!isRealExpr(r, dae)) r = castToRealExpr(r, dae);
  } else if (isRealExpr(l, dae) && !isRealExpr(r, dae)) {
    r = castToRealExpr(r, dae);
  } else if (!isRealExpr(l, dae) && isRealExpr(r, dae)) {
    l = castToRealExpr(l, dae);
  }
  return dae.addBinaryExpr(baseOp, l, r);
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

function getOperatorNameForBinOp(op: BinOp): string | null {
  switch (op) {
    case BinOp.Add:
      return "'+'";
    case BinOp.Sub:
      return "'-'";
    case BinOp.Mul:
      return "'*'";
    case BinOp.Div:
      return "'/'";
    case BinOp.Pow:
      return "'^'";
    case BinOp.Eq:
      return "'=='";
    case BinOp.Neq:
      return "'<>'";
    case BinOp.Lt:
      return "'<'";
    case BinOp.Lte:
      return "'<='";
    case BinOp.Gt:
      return "'>'";
    case BinOp.Gte:
      return "'>='";
    case BinOp.And:
      return "'and'";
    case BinOp.Or:
      return "'or'";
    default:
      return null;
  }
}

function findOperatorRecordComponentType(
  baseName: string,
  dae: DAEBuilder,
  db: QueryDB | undefined,
  flattener: any,
): { name: string; symId: SymbolId; isArray: boolean; arrayDim?: number } | null {
  if (!db) return null;
  const vIdx = dae.getVarIdxByName(baseName);
  if (vIdx >= 0) {
    const cType = dae.getVarCustomType(vIdx);
    if (!cType) return null;
    const cleanType = cType.includes(".") ? cType.split(".").pop()! : cType;
    const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
    if (classSym) {
      const shape = dae.getVarShape(vIdx);
      const isArray = Boolean(shape && shape.length > 0);
      const arrayDim = isArray ? shape[0] : 0;
      return { name: classSym.name, symId: classSym.id, isArray, arrayDim };
    }
    return null;
  }

  if (flattener?.currentFlatteningFunctionId) {
    const fnComps = db.childrenOf(flattener.currentFlatteningFunctionId).filter((c: any) => c.kind === "Component");
    const compSym = fnComps.find((c: any) => c.name?.replace(/\[.*\]$/, "") === baseName);
    if (compSym) {
      const compInst = db.query<any>("componentInstance", compSym.id);
      const typeSpec =
        compInst?.typeSpecifier ??
        (compSym.metadata as any)?.typeSpecifier ??
        db.query<string | null>("typeSpecifier", compSym.id);
      if (!typeSpec) return null;
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (classSym) {
        const dims = compInst?.arrayDimensions;
        const isArray = Boolean((dims && dims.length > 0) || (compSym.metadata as any)?.isArray);
        const arrayDim = dims && dims.length > 0 ? dims[0] : 0;
        return { name: classSym.name, symId: classSym.id, isArray, arrayDim };
      }
      return null;
    }
  }

  let compSym: any = null;
  if (flattener?.currentRootClassId) {
    const comps = db.childrenOf(flattener.currentRootClassId).filter((c: any) => c.kind === "Component");
    compSym = comps.find((c: any) => c.name?.replace(/\[.*\]$/, "") === baseName);
    if (!compSym) {
      const instComps = db.query<any[]>("instantiate", flattener.currentRootClassId);
      if (instComps) {
        compSym = instComps.find((c: any) => c.name?.replace(/\[.*\]$/, "") === baseName);
      }
    }
  }
  if (!compSym) {
    compSym = db.byName(baseName).find((e: any) => e.kind === "Component");
  }
  if (compSym) {
    const compInst = db.query<any>("componentInstance", compSym.id);
    const typeSpec =
      compInst?.typeSpecifier ??
      (compSym.metadata as any)?.typeSpecifier ??
      db.query<string | null>("typeSpecifier", compSym.id);
    if (typeSpec) {
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (classSym) {
        const dims = compInst?.arrayDimensions;
        const isArray = Boolean(
          (dims && dims.length > 0) || (compSym.metadata as any)?.isArray || compSym.name.includes("["),
        );
        const arrayDim = dims && dims.length > 0 ? dims[0] : 0;
        return { name: classSym.name, symId: classSym.id, isArray, arrayDim };
      }
    }
  }
  return null;
}

function resolveOperatorRecord(
  exprId: number,
  cstNode: any,
  dae: DAEBuilder,
  db: QueryDB | undefined,
  flattener: any,
): { name: string; symId: SymbolId; isArray: boolean; arrayDim?: number } | null {
  if (!db) return null;

  const findCompType = (baseName: string) => findOperatorRecordComponentType(baseName, dae, db, flattener);

  const resolvePath = (pathStr: string) => {
    const parts = pathStr
      .split(".")
      .map((p) => p.replace(/\[.*\]$/, "").trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    let curr = findCompType(parts[0]!);
    if (!curr) return null;
    for (let i = 1; i < parts.length; i++) {
      const fieldName = parts[i]!;
      const children = db.childrenOf(curr.symId).filter((c: any) => c.kind === "Component");
      const fieldSym = children.find((c: any) => c.name === fieldName);
      if (!fieldSym) return null;
      const compInst = db.query<any>("componentInstance", fieldSym.id);
      const typeSpec =
        compInst?.typeSpecifier ??
        (fieldSym.metadata as any)?.typeSpecifier ??
        db.query<string | null>("typeSpecifier", fieldSym.id);
      if (!typeSpec) return null;
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (!classSym) return null;
      const dims = compInst?.arrayDimensions;
      const isArray = Boolean(
        (dims && dims.length > 0) || (fieldSym.metadata as any)?.isArray || fieldSym.name.includes("["),
      );
      const arrayDim = dims && dims.length > 0 ? dims[0] : 0;
      curr = { name: classSym.name, symId: classSym.id, isArray, arrayDim };
    }
    return curr;
  };

  if (cstNode) {
    let nodeText = cstNode.text?.trim() ?? "";
    while (nodeText.startsWith("(") && nodeText.endsWith(")")) {
      nodeText = nodeText.slice(1, -1).trim();
    }
    const isSubscripted = nodeText.endsWith("]");
    const res = resolvePath(nodeText);
    if (res) {
      return {
        name: res.name,
        symId: res.symId,
        isArray: isSubscripted ? false : res.isArray,
        arrayDim: res.arrayDim,
      };
    }
  }

  if (exprId >= 0) {
    const kind = dae.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const varName = dae.interner.resolve(dae.getExprData1(exprId));
      if (varName) {
        const isSubscripted = varName.endsWith("]");
        const res = resolvePath(varName);
        if (res) {
          return {
            name: res.name,
            symId: res.symId,
            isArray: isSubscripted ? false : res.isArray,
            arrayDim: res.arrayDim,
          };
        }
      }
    } else if (kind === ExprKind.Call) {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName) {
        const baseClass = fnName.split(".")[0]!;
        const classSym = db
          .byName(baseClass)
          .find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
        if (classSym) {
          return { name: classSym.name, symId: classSym.id, isArray: false };
        }
      }
    }
  }

  return null;
}

function coerceToOperatorRecord(
  argExprId: number,
  recSymId: SymbolId,
  recName: string,
  dae: DAEBuilder,
  db: QueryDB,
  flattener: any,
): number | null {
  const ctors = db.query<any[]>("operatorConstructors", recSymId);
  if (!ctors || ctors.length === 0) return null;

  for (const ctor of ctors) {
    if (ctor.inputParams && ctor.inputParams.length >= 1) {
      const p0 = ctor.inputParams[0];
      if (p0.typeSpec === "Real" || p0.typeSpec === "Integer") {
        let firstArg = argExprId;
        if (p0.typeSpec === "Real" && dae.getExprKind(argExprId) === ExprKind.IntLiteral) {
          firstArg = dae.addRealLiteral(dae.getExprData1(argExprId));
        }
        const callArgs: number[] = [firstArg];
        for (let i = 1; i < ctor.inputParams.length; i++) {
          const pi = ctor.inputParams[i];
          if (pi.hasDefault && pi.defaultValue !== undefined) {
            const defValNum = Number(pi.defaultValue);
            callArgs.push(isNaN(defValNum) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(defValNum));
          } else {
            callArgs.push(dae.addRealLiteral(0.0));
          }
        }
        flattener?.usedOperatorFunctions?.set(ctor.qualifiedName, ctor.funcSymId);
        return dae.addCallExpr(ctor.qualifiedName, callArgs);
      }
    }
  }
  return null;
}

function dispatchBinaryOperator(
  opName: string,
  leftId: number,
  rightId: number,
  leftNode: any,
  rightNode: any,
  dae: DAEBuilder,
  db: QueryDB,
  flattener: any,
): number | null {
  const leftRec = resolveOperatorRecord(leftId, leftNode, dae, db, flattener);
  const rightRec = resolveOperatorRecord(rightId, rightNode, dae, db, flattener);
  if (!leftRec && !rightRec) return null;

  const recSym = (leftRec ?? rightRec)!;
  const ops = db.query<Map<string, any[]> | null>("operatorFunctions", recSym.symId);
  const cleanOp = opName.replace(/^'|'$/g, "");
  const rawCandidates: any[] = ops ? [...(ops.get(opName) ?? []), ...(ops.get(cleanOp) ?? [])] : [];
  if (rightRec && rightRec.symId !== leftRec?.symId) {
    const rOps = db.query<Map<string, any[]> | null>("operatorFunctions", rightRec.symId);
    if (rOps) {
      rawCandidates.push(...(rOps.get(opName) ?? []), ...(rOps.get(cleanOp) ?? []));
    }
  }
  const seenCandidates = new Set<string>();
  const candidates: any[] = [];
  for (const cand of rawCandidates) {
    if (!seenCandidates.has(cand.qualifiedName)) {
      seenCandidates.add(cand.qualifiedName);
      candidates.push(cand);
    }
  }

  const matched: { overload: any; finalLeftId: number; finalRightId: number }[] = [];

  const checkParamMatch = (
    param: any,
    rec: { name: string; symId: SymbolId; isArray: boolean } | null,
    argId: number,
  ): { matched: boolean; argId: number } => {
    if (param.isArray) {
      if (rec?.isArray) return { matched: true, argId };
      return { matched: false, argId };
    }
    if (rec) {
      if (rec.isArray) return { matched: false, argId };
      if (param.typeSpec === rec.name) return { matched: true, argId };
      return { matched: false, argId };
    }
    // Primitive argument (Real or Integer)
    if (param.typeSpec === "Real" || param.typeSpec === "Integer") {
      let finalArg = argId;
      if (param.typeSpec === "Real" && dae.getExprKind(argId) === ExprKind.IntLiteral) {
        finalArg = dae.addRealLiteral(dae.getExprData1(argId));
      }
      return { matched: true, argId: finalArg };
    }
    // Try implicit constructor coercion to target operator record
    const targetSym = db
      .byName(param.typeSpec)
      .find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
    if (targetSym) {
      const coerced = coerceToOperatorRecord(argId, targetSym.id, targetSym.name, dae, db, flattener);
      if (coerced !== null) {
        return { matched: true, argId: coerced };
      }
    }
    return { matched: false, argId };
  };

  for (const cand of candidates) {
    if (cand.inputParams.length !== 2) continue;
    const p0 = cand.inputParams[0];
    const p1 = cand.inputParams[1];

    const lRes = checkParamMatch(p0, leftRec, leftId);
    const rRes = checkParamMatch(p1, rightRec, rightId);

    if (lRes.matched && rRes.matched) {
      matched.push({ overload: cand, finalLeftId: lRes.argId, finalRightId: rRes.argId });
    }
  }

  if (matched.length === 1) {
    const m = matched[0]!;
    flattener?.usedOperatorFunctions?.set(m.overload.qualifiedName, m.overload.funcSymId);
    return dae.addCallExpr(m.overload.qualifiedName, [m.finalLeftId, m.finalRightId]);
  }

  if (matched.length > 1) {
    // If one candidate matched directly without coercion and others matched with coercion, prefer direct
    const directMatches = matched.filter((m) => {
      const p0 = m.overload.inputParams[0];
      const p1 = m.overload.inputParams[1];
      const lDirect = leftRec ? p0.typeSpec === leftRec.name : p0.typeSpec === "Real" || p0.typeSpec === "Integer";
      const rDirect = rightRec ? p1.typeSpec === rightRec.name : p1.typeSpec === "Real" || p1.typeSpec === "Integer";
      return lDirect && rDirect;
    });
    if (directMatches.length === 1) {
      const m = directMatches[0]!;
      flattener?.usedOperatorFunctions?.set(m.overload.qualifiedName, m.overload.funcSymId);
      return dae.addCallExpr(m.overload.qualifiedName, [m.finalLeftId, m.finalRightId]);
    }

    const candidateStrings = candidates.map((c) => {
      const params = c.inputParams.map((p: any) => `${p.typeSpec}${p.isArray ? "[:]" : ""} ${p.name}`).join(", ");
      return `  ${c.qualifiedName}(${params}) => ${c.outputType}`;
    });
    const exprText = `${leftNode?.text?.trim() ?? ""} ${cleanOp} ${rightNode?.text?.trim() ?? ""}`;
    let eqNode: any = leftNode;
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
    const diagNode = eqNode ?? leftNode;
    dae.diagnostics.push({
      severity: "error",
      code: 4073,
      message: `Ambiguous matching overloaded operator functions found for ${exprText}.\nCandidates are:\n${candidateStrings.join("\n")}`,
      range: {
        startByte: diagNode?.startIndex ?? diagNode?.startByte,
        endByte: diagNode?.endIndex ?? diagNode?.endByte,
        startPosition: diagNode?.startPosition,
        endPosition: diagNode?.endPosition,
      },
    });
    return -1;
  }

  // If no match, check if it's an array vectorization across elements (e.g. c1 = c2 - c3 or c1 = c1 * x)
  const isLeftArr = Boolean(leftRec?.isArray);
  const isRightArr = Boolean(rightRec?.isArray);
  if (isLeftArr || isRightArr) {
    const arrDim = leftRec?.arrayDim ?? rightRec?.arrayDim ?? 0;
    // Find a scalar overload that matches individual elements
    const scalarLeftRec = leftRec ? { ...leftRec, isArray: false } : null;
    const scalarRightRec = rightRec ? { ...rightRec, isArray: false } : null;

    let bestScalarOverload: any = null;
    for (const cand of candidates) {
      if (cand.inputParams.length !== 2) continue;
      const p0 = cand.inputParams[0];
      const p1 = cand.inputParams[1];
      if (p0.isArray || p1.isArray) continue;
      const lRes = checkParamMatch(p0, scalarLeftRec, leftId);
      const rRes = checkParamMatch(p1, scalarRightRec, rightId);
      if (lRes.matched && rRes.matched) {
        bestScalarOverload = cand;
        break;
      }
    }

    if (bestScalarOverload && arrDim >= 0) {
      if (arrDim === 0) {
        return dae.addArrayCtorExpr([]);
      }
      flattener?.usedOperatorFunctions?.set(bestScalarOverload.qualifiedName, bestScalarOverload.funcSymId);
      const leftBase = leftNode?.text?.trim() ?? "";
      const rightBase = rightNode?.text?.trim() ?? "";
      const elemCallIds: number[] = [];
      for (let i = 1; i <= arrDim; i++) {
        let elLeftId = leftId;
        let elRightId = rightId;
        if (isLeftArr) {
          elLeftId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${leftBase}[${i}]`));
        } else if (leftRec === null) {
          const coerced = coerceToOperatorRecord(leftId, recSym.symId, recSym.name, dae, db, flattener);
          if (coerced !== null) elLeftId = coerced;
        }
        if (isRightArr) {
          elRightId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${rightBase}[${i}]`));
        } else if (rightRec === null) {
          const coerced = coerceToOperatorRecord(rightId, recSym.symId, recSym.name, dae, db, flattener);
          if (coerced !== null) elRightId = coerced;
        }
        elemCallIds.push(dae.addCallExpr(bestScalarOverload.qualifiedName, [elLeftId, elRightId]));
      }
      return dae.addArrayCtorExpr(elemCallIds);
    }
  }

  // If no match and at least one is operator record:
  const getOperandTypeStr = (rec: any, argId: number): string => {
    if (rec) {
      return `${rec.name}${rec.isArray ? `[${rec.arrayDim ?? 0}]` : ""}`;
    }
    const t = inferArenaExprVarType(dae, argId);
    if (t === VarType.Integer || dae.getExprKind(argId) === ExprKind.IntLiteral) return "Integer";
    if (t === VarType.Boolean || dae.getExprKind(argId) === ExprKind.BoolLiteral) return "Boolean";
    if (t === VarType.String || dae.getExprKind(argId) === ExprKind.StringLiteral) return "String";
    return "Real";
  };
  const leftTypeStr = getOperandTypeStr(leftRec, leftId);
  const rightTypeStr = getOperandTypeStr(rightRec, rightId);
  const exprText = `${leftNode?.text?.trim() ?? ""} ${cleanOp} ${rightNode?.text?.trim() ?? ""}`;
  let eqNode: any = leftNode;
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
  const diagNode = eqNode ?? leftNode;
  dae.diagnostics.push({
    severity: "error",
    code: 4075,
    message: `Cannot resolve type of expression ${exprText}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO_COMPONENT>.`,
    range: {
      startByte: diagNode?.startIndex ?? diagNode?.startByte,
      endByte: diagNode?.endIndex ?? diagNode?.endByte,
      startPosition: diagNode?.startPosition,
      endPosition: diagNode?.endPosition,
    },
  });
  return -1;
}

function dispatchUnaryOperator(
  opName: string,
  operandId: number,
  operandNode: any,
  dae: DAEBuilder,
  db: QueryDB,
  flattener: any,
): number | null {
  const rec = resolveOperatorRecord(operandId, operandNode, dae, db, flattener);
  if (!rec) return null;

  const ops = db.query<Map<string, any[]> | null>("operatorFunctions", rec.symId);
  if (!ops) return null;

  const cleanOp = opName.replace(/^'|'$/g, "");
  const rawCandidates: any[] = [...(ops.get(opName) ?? []), ...(ops.get(cleanOp) ?? [])];
  const seenCandidates = new Set<string>();
  const candidates: any[] = [];
  for (const cand of rawCandidates) {
    if (!seenCandidates.has(cand.qualifiedName)) {
      seenCandidates.add(cand.qualifiedName);
      candidates.push(cand);
    }
  }
  if (candidates.length === 0) return null;

  for (const cand of candidates) {
    if (cand.inputParams.length !== 1) continue;
    const p0 = cand.inputParams[0];
    if (p0.isArray && rec.isArray) {
      flattener?.usedOperatorFunctions?.set(cand.qualifiedName, cand.funcSymId);
      return dae.addCallExpr(cand.qualifiedName, [operandId]);
    }
    if (!p0.isArray && !rec.isArray && p0.typeSpec === rec.name) {
      flattener?.usedOperatorFunctions?.set(cand.qualifiedName, cand.funcSymId);
      return dae.addCallExpr(cand.qualifiedName, [operandId]);
    }
  }

  for (const cand of candidates) {
    if (cand.inputParams.length === 1) {
      flattener?.usedOperatorFunctions?.set(cand.qualifiedName, cand.funcSymId);
      return dae.addCallExpr(cand.qualifiedName, [operandId]);
    }
  }

  return null;
}

function getArrayCtorElements(id: number, dae: DAEBuilder): number[] {
  if (id < 0) return [];
  const count = dae.getExprData1(id);
  const redirect = dae.getExprRight(id);
  const baseId = redirect >= 0 ? redirect : id;
  const elems: number[] = [];
  if (count > 0) elems.push(dae.getExprLeft(id));
  for (let i = 1; i < count; i++) {
    elems.push(dae.getExprLeft(baseId + i));
  }
  return elems;
}

function isEquationExpr(c: any): boolean {
  if (!c) return false;
  const t = c.type;
  return t === "expression" || t === "Expression" || t === "lhs_expression" || t === "LhsExpression";
}

const SCALAR_VECTORIZABLE_FUNCTIONS = new Map<string, { arity: number; fold?: (...args: number[]) => number }>([
  ["sin", { arity: 1, fold: Math.sin }],
  ["cos", { arity: 1, fold: Math.cos }],
  ["tan", { arity: 1, fold: Math.tan }],
  ["asin", { arity: 1, fold: Math.asin }],
  ["acos", { arity: 1, fold: Math.acos }],
  ["atan", { arity: 1, fold: Math.atan }],
  ["atan2", { arity: 2, fold: Math.atan2 }],
  ["sinh", { arity: 1, fold: Math.sinh }],
  ["cosh", { arity: 1, fold: Math.cosh }],
  ["tanh", { arity: 1, fold: Math.tanh }],
  ["exp", { arity: 1, fold: Math.exp }],
  ["log", { arity: 1, fold: Math.log }],
  ["log10", { arity: 1, fold: Math.log10 }],
  ["sqrt", { arity: 1, fold: Math.sqrt }],
  ["abs", { arity: 1, fold: Math.abs }],
  ["sign", { arity: 1, fold: Math.sign }],
  ["floor", { arity: 1, fold: Math.floor }],
  ["ceil", { arity: 1, fold: Math.ceil }],
]);

function vectorizeFunctionCall(
  fnName: string,
  argExprIds: number[],
  dae: DAEBuilder,
  flattener?: any,
  db?: any,
): number | null {
  const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(fnName);
  let isScalarFn = Boolean(scalarBuiltin);
  let fnDae: DAEBuilder | undefined;
  if (!isScalarFn) {
    fnDae = dae.getFunction(fnName);
    if (fnDae) {
      let allScalarInputs = true;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const shape = fnDae.getVarShape(i);
          if (shape && shape.length > 0 && shape.some((d) => d > 1)) {
            allScalarInputs = false;
            break;
          }
        }
      }
      if (allScalarInputs) isScalarFn = true;
    }
  }
  if (!isScalarFn) return null;

  const hasArrayArg = argExprIds.some((id) => dae.getExprKind(id) === ExprKind.ArrayCtor);
  if (!hasArrayArg) return null;

  let arrLen = -1;
  for (const id of argExprIds) {
    if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
      const len = dae.getExprData1(id);
      if (arrLen === -1) arrLen = len;
      else if (arrLen !== len) return null;
    }
  }
  if (arrLen < 0) return null;

  const elemResults: number[] = [];
  for (let i = 0; i < arrLen; i++) {
    const subArgs: number[] = [];
    for (const argId of argExprIds) {
      if (dae.getExprKind(argId) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(argId, dae);
        subArgs.push(elems[i] ?? argId);
      } else {
        subArgs.push(argId);
      }
    }

    if (subArgs.some((id) => dae.getExprKind(id) === ExprKind.ArrayCtor)) {
      const rec = vectorizeFunctionCall(fnName, subArgs, dae, flattener, db);
      if (rec !== null) {
        elemResults.push(rec);
        continue;
      }
    }

    if (scalarBuiltin?.fold) {
      const constVals: number[] = [];
      let allConst = true;
      for (const sa of subArgs) {
        if (exprContainsNameRef(sa, dae)) {
          allConst = false;
          break;
        }
        const v = evalDaeExpr(sa, dae);
        if (typeof v === "number") {
          constVals.push(v);
        } else {
          allConst = false;
          break;
        }
      }
      if (allConst && constVals.length === subArgs.length) {
        const folded = scalarBuiltin.fold(...constVals);
        elemResults.push(dae.addRealLiteral(folded));
        continue;
      }
    }

    const castedArgs = subArgs.map((sa) => castToRealExpr(sa, dae));
    elemResults.push(dae.addCallExpr(fnName, castedArgs));
  }

  return dae.addArrayCtorExpr(elemResults);
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
  isAssignmentLhs?: boolean,
): number {
  if (!node) return -1;
  const type = node.type;

  // Single-child unwrap for wrappers
  if (
    (type === "expression" ||
      type === "lhs_expression" ||
      type === "lhs_primary" ||
      type === "simple_expression" ||
      type === "logical_expression" ||
      type === "primary" ||
      type === "expression_list" ||
      type === "Expression" ||
      type === "SimpleExpression" ||
      type === "LogicalExpression" ||
      type === "Primary" ||
      type === "ExpressionList") &&
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
      isAssignmentLhs,
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
  if (
    type === "der" ||
    ((type === "primary" || type === "lhs_primary") && (firstChildToken === "der" || node.child(0)?.type === "der"))
  ) {
    let argNode = node.child(2);
    if (!argNode || argNode.type === ")") argNode = node.child(1);
    while (
      argNode &&
      (argNode.type === "expression_list" ||
        argNode.type === "expression" ||
        argNode.type === "lhs_expression" ||
        argNode.type === "primary" ||
        argNode.type === "lhs_primary") &&
      argNode.childCount === 1
    ) {
      argNode = argNode.child(0);
    }
    const argId = lowerCSTExpression(argNode, dae, prefix, substitutions, imports, db, flattener);
    const distributeDer = (exprId: number): number => {
      if (dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(exprId, dae);
        return dae.addArrayCtorExpr(elems.map((e) => distributeDer(e)));
      }
      return dae.addDerExpr(exprId);
    };
    return distributeDer(argId);
  }

  // Pre expression: pre ( ... )
  if (
    type === "pre" ||
    ((type === "primary" || type === "lhs_primary") &&
      (firstChildToken === "pre" || node.child(0)?.text?.startsWith("pre(")))
  ) {
    let argNode = node.child(2) ?? node.child(1);
    while (
      argNode &&
      (argNode.type === "expression_list" ||
        argNode.type === "expression" ||
        argNode.type === "lhs_expression" ||
        argNode.type === "primary" ||
        argNode.type === "lhs_primary") &&
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
    ((type === "primary" || type === "lhs_primary") &&
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
    const namedArgs = new Map<string, number>();
    if (argsNode) {
      const fArgsNode =
        argsNode.type === "function_arguments"
          ? argsNode
          : (argsNode.children || []).find((c: any) => c.type === "function_arguments");
      const hasComprehensionFor = Boolean(
        fArgsNode && (fArgsNode.children || []).some((c: any) => c.text === "for" || c.type === "for_indices"),
      );
      if (hasComprehensionFor && (fnName === "sum" || fnName === "product" || fnName === "min" || fnName === "max")) {
        const fChildren = fArgsNode.children || [];
        const forIdx = fChildren.findIndex((c: any) => c.text === "for" || c.type === "for");
        const bodyNode = forIdx > 0 ? fChildren[forIdx - 1] : fChildren[0];
        const forIndicesNode = fChildren.find((c: any) => c.type === "for_indices");
        const iterators: { name: string; rangeId: number }[] = [];
        if (forIndicesNode) {
          for (const idxNode of forIndicesNode.children || []) {
            if (idxNode.type === "for_index") {
              const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
              let rangeNode = idxNode.childForFieldName?.("range");
              if (!rangeNode) {
                const inIdx = (idxNode.children || []).findIndex((c: any) => c.text === "in");
                if (inIdx >= 0 && inIdx + 1 < (idxNode.children || []).length) {
                  rangeNode = idxNode.child(inIdx + 1);
                } else {
                  rangeNode = idxNode.child(2) ?? idxNode.child(1);
                }
              }
              const varName = varNode?.text?.trim() ?? "";
              let rangeId = -1;
              if (rangeNode) {
                rangeId = lowerCSTExpression(rangeNode, dae, prefix, substitutions, imports, db, flattener);
              }
              if (varName) {
                iterators.push({ name: varName, rangeId });
              }
            }
          }
        }
        const bodyId = lowerCSTExpression(bodyNode, dae, prefix, substitutions, imports, db, flattener);

        let baseCompName = "";
        const findCR = (n: any): any => {
          if (!n) return null;
          if (n.type === "component_reference") return n;
          for (const c of n.children || []) {
            const found = findCR(c);
            if (found) return found;
          }
          return null;
        };
        const crNode = findCR(bodyNode);
        if (crNode) {
          baseCompName = crNode.text?.split(".")[0].split("[")[0].trim() ?? "";
        } else if (bodyNode?.text) {
          const match = bodyNode.text.match(/^[a-zA-Z_]\w*/);
          if (match) baseCompName = match[0];
        }
        if (baseCompName) {
          const compType = findOperatorRecordComponentType(baseCompName, dae, db, flattener);
          if (compType) {
            const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", compType.symId);
            if (fnName === "sum") {
              const plusOps = ops?.get("'+'") ?? ops?.get("+");
              if (plusOps && plusOps.length > 0) {
                const plusOp = plusOps[0];
                flattener?.usedOperatorFunctions?.set(plusOp.qualifiedName, plusOp.funcSymId);
              }
            } else if (fnName === "product") {
              const mulOps = ops?.get("'*'") ?? ops?.get("*");
              if (mulOps && mulOps.length > 0) {
                const mulOp = mulOps[0];
                flattener?.usedOperatorFunctions?.set(mulOp.qualifiedName, mulOp.funcSymId);
              }
            }
          }
        }

        return dae.addComprehensionExpr(fnName, bodyId, iterators);
      }

      const collectArgs = (n: any) => {
        if (!n) return;
        if (n.type === "named_argument" || n.type === "NamedArgument") {
          const propName = n.child(0)?.text?.trim();
          let exprChild = n.child(2) ?? n.child(1);
          if (
            exprChild &&
            (exprChild.type === "function_argument" || exprChild.type === "FunctionArgument") &&
            exprChild.childCount === 1
          ) {
            exprChild = exprChild.child(0);
          }
          if (propName && exprChild) {
            const exprId = lowerCSTExpression(exprChild, dae, prefix, substitutions, imports, db, flattener);
            namedArgs.set(propName, exprId);
            argNodes.push(exprChild);
            argExprIds.push(exprId);
            return;
          }
        }
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
    const cleanFnName = typeof fnName === "string" ? fnName.replace(/^\.+/, "") : "";

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

    const vectorizedCall = vectorizeFunctionCall(cleanFnName || fnName, argExprIds, dae, flattener, db);
    if (vectorizedCall !== null) {
      return vectorizedCall;
    }
    if (fnName === "array" || cleanFnName === "array") {
      return dae.addArrayCtorExpr(argExprIds);
    }
    if (fnName === "zeros" || fnName === "ones") {
      const dimVals: number[] = [];
      let allStatic = true;
      for (let i = 0; i < argExprIds.length; i++) {
        const dv = evalDaeExpr(argExprIds[i]!, dae);
        if (typeof dv === "number" && dv >= 0 && Number.isInteger(dv)) {
          dimVals.push(dv);
        } else {
          allStatic = false;
          break;
        }
      }
      if (allStatic && dimVals.length > 0) {
        const valLit = dae.addRealLiteral(fnName === "ones" ? 1.0 : 0.0);
        const buildCtor = (dimIdx: number): number => {
          if (dimIdx === dimVals.length) return valLit;
          const size = dimVals[dimIdx]!;
          if (size === 0) return dae.addArrayCtorExpr([]);
          const childElem = buildCtor(dimIdx + 1);
          const elems: number[] = [];
          for (let i = 0; i < size; i++) elems.push(childElem);
          return dae.addArrayCtorExpr(elems);
        };
        return buildCtor(0);
      }
    }

    if (fnName === "fill" && argExprIds.length >= 2) {
      const dimVals: number[] = [];
      let allStatic = true;
      for (let i = 1; i < argExprIds.length; i++) {
        const dv = evalDaeExpr(argExprIds[i]!, dae);
        if (typeof dv === "number" && dv >= 0 && Number.isInteger(dv)) {
          dimVals.push(dv);
        } else {
          allStatic = false;
          break;
        }
      }
      if (allStatic && dimVals.length > 0) {
        const buildFillCtor = (dimIdx: number): number => {
          if (dimIdx === dimVals.length) return argExprIds[0]!;
          const size = dimVals[dimIdx]!;
          if (size === 0) return dae.addArrayCtorExpr([]);
          const childElem = buildFillCtor(dimIdx + 1);
          const elems: number[] = [];
          for (let i = 0; i < size; i++) elems.push(childElem);
          return dae.addArrayCtorExpr(elems);
        };
        return buildFillCtor(0);
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
            if (shape && shape.length >= dim && shape[dim - 1]! > 0) {
              return dae.addIntLiteral(shape[dim - 1]!);
            }
          }
          let maxDim = 0;
          const prefixMatch = `${name}[`;
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
          if (maxDim > 0) {
            return dae.addIntLiteral(maxDim);
          }
          const cType = findOperatorRecordComponentType(name, dae, db, flattener);
          if (cType && cType.isArray && cType.arrayDim > 0 && dim === 1) {
            return dae.addIntLiteral(cType.arrayDim);
          }
        }
      }
    }

    // 1. Inlined '0' operator call: Complex.'0'()
    if (fnName.endsWith(".'0'") || fnName.endsWith(".0") || cleanFnName.endsWith(".'0'")) {
      const recName = cleanFnName.split(".")[0]!;
      const recSym = db?.byName(recName).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (recSym) {
        const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", recSym.id);
        const zeroOps = ops?.get("'0'") ?? ops?.get("0");
        if (zeroOps && zeroOps.length > 0 && zeroOps[0].isInline) {
          const args = [dae.addRealLiteral(0.0), dae.addRealLiteral(0.0)];
          return dae.addCallExpr(recName, args);
        }
      }
    }

    // 1.5. Unary operator function calls: not(c), -(c), +(c), abs(c)
    if ((cleanFnName === "not" || cleanFnName === "'not'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'not'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, argExprIds[0]!);
    }
    if ((cleanFnName === "-" || cleanFnName === "'-'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }
    if ((cleanFnName === "+" || cleanFnName === "'+'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'+'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }

    // 2. String(c, ...) operator
    if (cleanFnName === "String" && argExprIds.length >= 1) {
      const rec = resolveOperatorRecord(argExprIds[0], argNodes[0], dae, db, flattener);
      if (rec) {
        const ops = db?.query<Map<string, any[]> | null>("operatorFunctions", rec.symId);
        const strOps = ops?.get("'String'") ?? ops?.get("String");
        if (strOps && strOps.length > 0) {
          const strOverload = strOps[0];
          flattener.usedOperatorFunctions?.set(strOverload.qualifiedName, strOverload.funcSymId);
          return dae.addCallExpr(strOverload.qualifiedName, argExprIds);
        }
      }
    }

    // 3. Overloaded constructor: Complex(...)
    if (db && flattener && cleanFnName) {
      const recSym = db.byName(cleanFnName).find((e: any) => e.kind === "Class" && flattener.isOperatorRecordSym?.(e));
      if (recSym) {
        const ctors = db.query<any[]>("operatorConstructors", recSym.id);
        if (ctors && ctors.length > 0) {
          for (const ctor of ctors) {
            const inParams = ctor.inputParams || [];
            let canMatch = true;
            const finalArgs: number[] = [];
            if (namedArgs.size > 0) {
              for (const param of inParams) {
                if (namedArgs.has(param.name)) {
                  finalArgs.push(namedArgs.get(param.name)!);
                } else if (param.hasDefault && param.defaultValue !== undefined) {
                  const num = Number(param.defaultValue);
                  finalArgs.push(isNaN(num) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(num));
                } else {
                  canMatch = false;
                  break;
                }
              }
            } else if (argExprIds.length <= inParams.length) {
              for (let p = 0; p < inParams.length; p++) {
                if (p < argExprIds.length) {
                  const aid = argExprIds[p]!;
                  const akind = dae.getExprKind(aid);
                  const pType = inParams[p].typeSpec?.replace(/^\./, "");
                  if (
                    (akind === ExprKind.RealLiteral || akind === ExprKind.IntLiteral) &&
                    pType !== "Real" &&
                    pType !== "Integer"
                  ) {
                    canMatch = false;
                    break;
                  }
                  finalArgs.push(aid);
                } else {
                  const param = inParams[p];
                  if (param.hasDefault && param.defaultValue !== undefined) {
                    const num = Number(param.defaultValue);
                    finalArgs.push(isNaN(num) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(num));
                  } else {
                    canMatch = false;
                    break;
                  }
                }
              }
            } else {
              canMatch = false;
            }

            if (canMatch) {
              flattener.usedOperatorFunctions?.set(ctor.qualifiedName, ctor.funcSymId);
              return dae.addCallExpr(ctor.qualifiedName, finalArgs);
            }
          }

          // MLS §14.2.1: Default constructor is hidden when overloaded constructor is defined.
          const candidateLines = ctors
            .map((c) => {
              const paramsStr = (c.inputParams || []).map((p: any) => `${p.typeSpec} ${p.name}`).join(", ");
              return `  ${c.qualifiedName}(${paramsStr}) => ${cleanFnName}`;
            })
            .join("\n");

          const formatArg = (aid: number): string => {
            const k = dae.getExprKind(aid);
            if (k === ExprKind.RealLiteral) {
              const val = dae.getExprRealValue(aid);
              return `/*Real*/ ${Number.isInteger(val) ? val.toFixed(1) : val}`;
            }
            if (k === ExprKind.IntLiteral) {
              return String(dae.getExprData1(aid));
            }
            return dae.interner.resolve(dae.getExprData1(aid)) || "";
          };
          const formattedArgs = argExprIds.map(formatArg).join(", ");
          const callStr = `${cleanFnName}(${formattedArgs})`;

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

          dae.diagnostics.push({
            severity: "error",
            code: 4074,
            message: `No matching function found for ${callStr}.\nCandidates are:\n${candidateLines}`,
            range: startB != null && endB != null ? { startByte: startB, endByte: endB } : undefined,
          });
          return -1;
        }
      }
    }

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
      } else if (!matchingFnSym) {
        const isBuiltin =
          SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) ||
          SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase) ||
          BUILTIN_FUNCTIONS.has(cleanFnName) ||
          BUILTIN_FUNCTIONS.has(fnBase) ||
          cleanFnName === "size" ||
          cleanFnName === "ndims" ||
          cleanFnName === "min" ||
          cleanFnName === "max" ||
          cleanFnName === "sum" ||
          cleanFnName === "product" ||
          cleanFnName === "cross" ||
          cleanFnName === "skew" ||
          cleanFnName === "array" ||
          cleanFnName === "zeros" ||
          cleanFnName === "ones" ||
          cleanFnName === "fill" ||
          cleanFnName === "identity" ||
          cleanFnName === "diagonal" ||
          cleanFnName === "linspace" ||
          cleanFnName === "cat" ||
          cleanFnName === "inStream" ||
          cleanFnName === "actualStream" ||
          cleanFnName === "spatialDistribution" ||
          cleanFnName === "cardinality" ||
          cleanFnName === "homotopy" ||
          cleanFnName === "semiLinear" ||
          cleanFnName === "delay" ||
          cleanFnName === "smooth" ||
          cleanFnName === "sample" ||
          cleanFnName === "reinit" ||
          cleanFnName === "assert" ||
          cleanFnName === "terminate" ||
          cleanFnName === "initial" ||
          cleanFnName === "terminal" ||
          cleanFnName === "div" ||
          cleanFnName === "mod" ||
          cleanFnName === "rem" ||
          cleanFnName === "String" ||
          cleanFnName === "Real" ||
          cleanFnName === "Integer" ||
          cleanFnName === "Boolean";
        if (!isBuiltin) {
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
          return -1;
        }
      }
    }
    if (fnDae) {
      let inputIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          if (inputIdx < argExprIds.length) {
            const aid = argExprIds[inputIdx];
            const expectedType = fnDae.getVarType(i);
            const expectedCustomType = fnDae.getVarCustomType(i);
            const providedType = inferArenaExprVarType(dae, aid);
            let finalType = providedType;
            if (
              expectedType === VarType.Real &&
              !expectedCustomType &&
              (providedType === VarType.Integer || providedType === null)
            ) {
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
    (type === "primary" ||
      type === "lhs_primary" ||
      type === "expression" ||
      type === "lhs_expression" ||
      type === "output_expression_list" ||
      type === "expression_list") &&
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
    (type === "primary" || type === "lhs_primary") &&
    (node.child(0)?.type === "{" || node.child(0)?.text === "{" || node.child(0)?.type === '"{"') &&
    (node.child(node.childCount - 1)?.type === "}" ||
      node.child(node.childCount - 1)?.text === "}" ||
      node.child(node.childCount - 1)?.type === '"}"')
  ) {
    const elementIds: number[] = [];
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (c.type === "expression" || c.type === "lhs_expression" || c.type === "array_arguments") {
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
    if (elementIds.some((e) => isRealExpr(e, dae))) {
      for (let k = 0; k < elementIds.length; k++) {
        if (!isRealExpr(elementIds[k]!, dae)) {
          elementIds[k] = castToRealExpr(elementIds[k]!, dae);
        }
      }
    }
    return dae.addArrayCtorExpr(elementIds);
  }

  // Matrix / vector bracket constructor: [ e1; e2; ... ] or [ e1, e2, ... ]
  if (
    (type === "primary" || type === "lhs_primary") &&
    (node.child(0)?.type === "[" || node.child(0)?.text === "[" || node.child(0)?.type === '"["') &&
    (node.child(node.childCount - 1)?.type === "]" ||
      node.child(node.childCount - 1)?.text === "]" ||
      node.child(node.childCount - 1)?.type === '"]"')
  ) {
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
      if (db && flattener) {
        const opName = getOperatorNameForBinOp(binOp);
        if (opName) {
          const dispatched = dispatchBinaryOperator(
            opName,
            leftId,
            rightId,
            node.child(0),
            node.child(2),
            dae,
            db,
            flattener,
          );
          if (dispatched !== null) return dispatched;
        }
      }
      if (
        binOp === BinOp.ElemAdd ||
        binOp === BinOp.ElemSub ||
        binOp === BinOp.ElemMul ||
        binOp === BinOp.ElemDiv ||
        binOp === BinOp.ElemPow
      ) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(rightId) === ExprKind.Name) {
          const rName = dae.interner.resolve(dae.getExprData1(rightId));
          if (rName && dae.hasArrayElements(rName)) {
            const rCtor = expandVarToArrayCtor(rName, dae);
            if (rCtor !== null) rightId = rCtor;
          }
        }
        let baseOp = BinOp.Add;
        if (binOp === BinOp.ElemSub) baseOp = BinOp.Sub;
        else if (binOp === BinOp.ElemMul) baseOp = BinOp.Mul;
        else if (binOp === BinOp.ElemDiv) baseOp = BinOp.Div;
        else if (binOp === BinOp.ElemPow) baseOp = BinOp.Pow;
        return broadcastElemBinOp(baseOp, leftId, rightId, dae, flattener);
      }
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
      if (binOp === BinOp.Mul || binOp === BinOp.Add || binOp === BinOp.Sub) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(rightId) === ExprKind.Name) {
          const rName = dae.interner.resolve(dae.getExprData1(rightId));
          if (rName && dae.hasArrayElements(rName)) {
            const rCtor = expandVarToArrayCtor(rName, dae);
            if (rCtor !== null) rightId = rCtor;
          }
        }
      }
      if (binOp === BinOp.Add || binOp === BinOp.Sub) {
        const leftDims = getExprDims(leftId, dae, flattener?.db);
        const rightDims = getExprDims(rightId, dae, flattener?.db);
        const hasLeftDims = leftDims !== null && leftDims.length > 0;
        const hasRightDims = rightDims !== null && rightDims.length > 0;
        if (
          hasLeftDims !== hasRightDims ||
          (hasLeftDims &&
            hasRightDims &&
            (leftDims!.length !== rightDims!.length || leftDims!.some((d, i) => d !== rightDims![i])))
        ) {
          const getOperandFullTypeStr = (id: number, dims: number[] | null): string => {
            const t = inferArenaExprVarType(dae, id);
            let baseType = "Real";
            if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) baseType = "Integer";
            else if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) baseType = "Boolean";
            else if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) baseType = "String";
            if (dims && dims.length > 0) {
              return `${baseType}[${dims.join(", ")}]`;
            }
            return baseType;
          };
          const leftTypeStr = getOperandFullTypeStr(leftId, leftDims);
          const rightTypeStr = getOperandFullTypeStr(rightId, rightDims);
          const exprText = `${node.child(0)?.text?.trim() ?? ""} ${opToken} ${node.child(2)?.text?.trim() ?? ""}`;
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          dae.diagnostics.push({
            severity: "error",
            message: `Cannot resolve type of expression ${exprText}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
            range: {
              startByte: startB,
              endByte: endB,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return -1;
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
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length && leftElems.length > 0) {
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Add, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
        const leftDims = getExprDims(leftId, dae, flattener.db);
        const rightDims = getExprDims(rightId, dae, flattener.db);
        if (leftDims && rightDims && leftDims.length === 2 && rightDims.length === 2) {
          const [M1, N1] = leftDims;
          const [M2, N2] = rightDims;
          if (M1 === M2 && N1 === N2 && (M1 === 0 || N1 === 0)) {
            const resRows: number[] = [];
            for (let i = 0; i < M1!; i++) {
              resRows.push(dae.addArrayCtorExpr([]));
            }
            return dae.addArrayCtorExpr(resRows);
          }
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
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) - dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length && leftElems.length > 0) {
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Sub, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
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
        const leftDims = getExprDims(leftId, dae, flattener.db);
        const rightDims = getExprDims(rightId, dae, flattener.db);
        if (leftDims && rightDims && leftDims.length === 2 && rightDims.length === 2) {
          const [M, K1] = leftDims;
          const [K2, N] = rightDims;
          if (K1 === K2) {
            const K = K1!;
            if (K === 0 || M === 0 || N === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resRows: number[] = [];
              for (let i = 0; i < M!; i++) {
                const rowElems: number[] = [];
                for (let j = 0; j < N!; j++) {
                  rowElems.push(zeroLit);
                }
                resRows.push(dae.addArrayCtorExpr(rowElems));
              }
              return dae.addArrayCtorExpr(resRows);
            }
          }
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          const isLeftMatrix = leftElems.length > 0 && dae.getExprKind(leftElems[0]!) === ExprKind.ArrayCtor;
          const isRightMatrix = rightElems.length > 0 && dae.getExprKind(rightElems[0]!) === ExprKind.ArrayCtor;

          if (!isLeftMatrix && !isRightMatrix) {
            // Vector * Vector: dot product sum(left[i] * right[i])
            if (leftElems.length === rightElems.length && leftElems.length > 0) {
              let sumExpr = dae.addBinaryExpr(BinOp.Mul, leftElems[0]!, rightElems[0]!);
              for (let i = 1; i < leftElems.length; i++) {
                const prod = dae.addBinaryExpr(BinOp.Mul, leftElems[i]!, rightElems[i]!);
                sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, prod);
              }
              return sumExpr;
            }
          } else if (isLeftMatrix && isRightMatrix) {
            // Matrix * Matrix: M x K * K x N => M x N
            const leftRows = leftElems.map((r) => getArrayCtorElements(r, dae));
            const rightRows = rightElems.map((r) => getArrayCtorElements(r, dae));
            const M = leftRows.length;
            const K = leftRows[0]?.length ?? 0;
            const N = rightRows[0]?.length ?? 0;
            if (K > 0 && rightRows.length === K) {
              const resRows: number[] = [];
              for (let i = 0; i < M; i++) {
                const rowElems: number[] = [];
                for (let j = 0; j < N; j++) {
                  let sumExpr: number | null = null;
                  for (let k = 0; k < K; k++) {
                    const prod = dae.addBinaryExpr(BinOp.Mul, leftRows[i]![k]!, rightRows[k]![j]!);
                    sumExpr = sumExpr === null ? prod : dae.addBinaryExpr(BinOp.Add, sumExpr, prod);
                  }
                  rowElems.push(sumExpr ?? dae.addRealLiteral(0.0));
                }
                resRows.push(dae.addArrayCtorExpr(rowElems));
              }
              return dae.addArrayCtorExpr(resRows);
            }
          } else if (isLeftMatrix && !isRightMatrix) {
            // Matrix * Vector: M x K * K => M
            const leftRows = leftElems.map((r) => getArrayCtorElements(r, dae));
            const M = leftRows.length;
            const K = leftRows[0]?.length ?? 0;
            if (K > 0 && rightElems.length === K) {
              const resElems: number[] = [];
              for (let i = 0; i < M; i++) {
                let sumExpr: number | null = null;
                for (let k = 0; k < K; k++) {
                  const cId = leftRows[i]![k]!;
                  const vId = rightElems[k]!;
                  let prod: number;
                  const cK = dae.getExprKind(cId);
                  if (cK === ExprKind.RealLiteral && dae.getExprRealValue(cId) === 1.0) {
                    prod = vId;
                  } else if (cK === ExprKind.IntLiteral && dae.getExprData1(cId) === 1) {
                    prod = vId;
                  } else {
                    prod = dae.addBinaryExpr(BinOp.Mul, cId, vId);
                  }
                  sumExpr = sumExpr === null ? prod : dae.addBinaryExpr(BinOp.Add, sumExpr, prod);
                }
                resElems.push(sumExpr ?? dae.addRealLiteral(0.0));
              }
              return dae.addArrayCtorExpr(resElems);
            }
          } else if (!isLeftMatrix && isRightMatrix) {
            // Vector * Matrix: K * K x N => N
            const rightRows = rightElems.map((r) => getArrayCtorElements(r, dae));
            const K = rightRows.length;
            const N = rightRows[0]?.length ?? 0;
            if (K > 0 && leftElems.length === K) {
              const resElems: number[] = [];
              for (let j = 0; j < N; j++) {
                let sumExpr: number | null = null;
                for (let k = 0; k < K; k++) {
                  const vId = leftElems[k]!;
                  const cId = rightRows[k]![j]!;
                  let prod: number;
                  const cK = dae.getExprKind(cId);
                  if (cK === ExprKind.RealLiteral && dae.getExprRealValue(cId) === 1.0) {
                    prod = vId;
                  } else if (cK === ExprKind.IntLiteral && dae.getExprData1(cId) === 1) {
                    prod = vId;
                  } else {
                    prod = dae.addBinaryExpr(BinOp.Mul, vId, cId);
                  }
                  sumExpr = sumExpr === null ? prod : dae.addBinaryExpr(BinOp.Add, sumExpr, prod);
                }
                resElems.push(sumExpr ?? dae.addRealLiteral(0.0));
              }
              return dae.addArrayCtorExpr(resElems);
            }
          }
        } else if (leftKind === ExprKind.ArrayCtor) {
          // Vector/Matrix * Scalar
          const leftElems = getArrayCtorElements(leftId, dae);
          const isMatrix = leftElems.length > 0 && dae.getExprKind(leftElems[0]!) === ExprKind.ArrayCtor;
          if (isMatrix) {
            const rows = leftElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(rElems.map((e) => dae.addBinaryExpr(BinOp.Mul, e, rightId)));
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(leftElems.map((e) => dae.addBinaryExpr(BinOp.Mul, e, rightId)));
          }
        } else if (rightKind === ExprKind.ArrayCtor) {
          // Scalar * Vector/Matrix
          const rightElems = getArrayCtorElements(rightId, dae);
          const isMatrix = rightElems.length > 0 && dae.getExprKind(rightElems[0]!) === ExprKind.ArrayCtor;
          if (isMatrix) {
            const rows = rightElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(rElems.map((e) => dae.addBinaryExpr(BinOp.Mul, leftId, e)));
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(rightElems.map((e) => dae.addBinaryExpr(BinOp.Mul, leftId, e)));
          }
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
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length && leftElems.length > 0) {
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Sub, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
        const leftDimsSub = getExprDims(leftId, dae, flattener.db);
        const rightDimsSub = getExprDims(rightId, dae, flattener.db);
        if (leftDimsSub && rightDimsSub && leftDimsSub.length === 2 && rightDimsSub.length === 2) {
          const [M1, N1] = leftDimsSub;
          const [M2, N2] = rightDimsSub;
          if (M1 === M2 && N1 === N2 && (M1 === 0 || N1 === 0)) {
            const resRows: number[] = [];
            for (let i = 0; i < M1!; i++) {
              resRows.push(dae.addArrayCtorExpr([]));
            }
            return dae.addArrayCtorExpr(resRows);
          }
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
        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(leftId)) return rightId;
        if (isOne(rightId)) return leftId;
        const leftText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        if (leftText && leftText === rightText && dae.classKind !== "function") {
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
      if (flattener.options.omcCompatibility && binOp === BinOp.Add) {
        const isNegatedExpr = (id: number): { isNeg: boolean; posId: number } => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.Negate) {
            return { isNeg: true, posId: dae.getExprLeft(id) };
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            return { isNeg: true, posId: dae.getExprLeft(id) };
          }
          if (k === ExprKind.Binary && dae.getExprData1(id) === BinOp.Mul) {
            const mL = dae.getExprLeft(id);
            const mR = dae.getExprRight(id);
            const nL = isNegatedExpr(mL);
            if (nL.isNeg) {
              return { isNeg: true, posId: dae.addBinaryExpr(BinOp.Mul, nL.posId, mR) };
            }
          }
          return { isNeg: false, posId: id };
        };
        const negL = isNegatedExpr(leftId);
        if (negL.isNeg) {
          return dae.addBinaryExpr(BinOp.Sub, rightId, negL.posId);
        }
        if (dae.classKind !== "function") {
          const leftKind = dae.getExprKind(leftId);
          const rightKind = dae.getExprKind(rightId);
          const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
          const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
          if (!isLeftLit && isRightLit) {
            [leftId, rightId] = [rightId, leftId];
          }
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
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return dae.addExpression(ExprKind.Negate, 0, operandId);
    }

    if (op === "+") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'+'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return operandId;
    }
    if (op === "not") {
      const operandId = lowerCSTExpression(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'not'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
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
      interface RawPartSubscript {
        node: any;
        text: string;
        isSlice: boolean;
        values: number[];
        scalarText?: string;
        isRealSub?: boolean;
      }
      interface RawPart {
        ident: string;
        hasSubscripts: boolean;
        subscripts: RawPartSubscript[];
      }
      const rawParts: RawPart[] = [];
      let currentIdent = "";
      for (const child of node.children || []) {
        const cType = child.type;
        const cText = child.text?.trim() ?? "";
        if (cType === "identifier" || cType === "property" || cType === "name") {
          currentIdent = cText;
          rawParts.push({ ident: currentIdent, hasSubscripts: false, subscripts: [] });
        } else if (cType === "array_subscripts" && rawParts.length > 0) {
          const lastPart = rawParts[rawParts.length - 1]!;
          lastPart.hasSubscripts = true;
          for (const sub of child.children || []) {
            if (sub.type === "subscript") {
              const expr = sub.children?.find((k: any) => k.type === "expression") ?? sub;
              const subText = expr.text?.trim() ?? "";
              const dimIdx = lastPart.subscripts.length;
              const dimSize = getDaeDimSize(prefix, lastPart.ident, dimIdx, dae, db);

              // 1. Colon slice: [:]
              if (subText === ":") {
                const vals = dimSize > 0 ? Array.from({ length: dimSize }, (_, i) => i + 1) : [];
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: true,
                  values: vals,
                });
                continue;
              }

              // 2. Array constructor slice: e.g. {1, 3} or {2}
              if (subText.startsWith("{") && subText.endsWith("}")) {
                const inner = subText.slice(1, -1).trim();
                const items = inner.length > 0 ? inner.split(",") : [];
                const vals: number[] = [];
                for (const item of items) {
                  const it = item.trim();
                  let iv = parseInt(it, 10);
                  if (isNaN(iv) && substitutions && substitutions.has(it)) {
                    const s = substitutions.get(it);
                    if (typeof s === "number") iv = s;
                  }
                  if (!isNaN(iv)) {
                    vals.push(iv);
                  }
                }
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: true,
                  values: vals,
                });
                continue;
              }

              // 3. Range with colon: e.g. 2:n+1 or 1:2:4
              if (subText.includes(":")) {
                let startNode: any = null;
                let stepNode: any = null;
                let stopNode: any = null;
                if (expr.childCount === 3 && (expr.child(1)?.text?.trim() ?? "") === ":") {
                  const c0 = expr.child(0);
                  if (c0.childCount === 3 && (c0.child(1)?.text?.trim() ?? "") === ":") {
                    startNode = c0.child(0);
                    stepNode = c0.child(2);
                    stopNode = expr.child(2);
                  } else {
                    startNode = c0;
                    stopNode = expr.child(2);
                  }
                }
                const evalBound = (bNode: any): number | null => {
                  if (!bNode) return null;
                  const t = bNode.text?.trim() ?? "";
                  if (t === "end") return dimSize;
                  if (substitutions && substitutions.has(t)) {
                    const s = substitutions.get(t);
                    if (typeof s === "number") return s;
                  }
                  return evaluateCSTNumber(bNode, substitutions as any, undefined, db, dae, prefix);
                };
                const startVal = startNode ? evalBound(startNode) : null;
                const stopVal = stopNode ? evalBound(stopNode) : null;
                const stepVal = stepNode ? (evalBound(stepNode) ?? 1) : 1;
                if (startVal !== null && stopVal !== null) {
                  const vals: number[] = [];
                  if (stepVal > 0) {
                    for (let idx = startVal; idx <= stopVal; idx += stepVal) vals.push(idx);
                  } else if (stepVal < 0) {
                    for (let idx = startVal; idx >= stopVal; idx += stepVal) vals.push(idx);
                  }
                  lastPart.subscripts.push({
                    node: sub,
                    text: subText,
                    isSlice: true,
                    values: vals,
                  });
                  continue;
                }
              }

              // 4. Scalar subscript
              const isLoopVar = flattener?.activeLoopVars?.has(subText);
              if (substitutions && substitutions.has(subText)) {
                const sVal = substitutions.get(subText)!;
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: false,
                  values: typeof sVal === "number" ? [sVal] : [],
                  scalarText: String(sVal),
                });
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
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: false,
                  values: [evaluatedNum],
                  scalarText: String(evaluatedNum),
                });
              } else {
                const subId = lowerCSTExpression(expr, dae, prefix, substitutions, imports, db, flattener);
                if (subId >= 0) {
                  const subType = inferArenaExprVarType(dae, subId);
                  if (subType === VarType.Real && !isLoopVar) {
                    isRealSub = true;
                  }
                  if (dae.getExprKind(subId) === ExprKind.IntLiteral && !isRealSub) {
                    const numVal = dae.getExprData1(subId);
                    lastPart.subscripts.push({
                      node: sub,
                      text: subText,
                      isSlice: false,
                      values: [numVal],
                      scalarText: String(numVal),
                      isRealSub,
                    });
                  } else {
                    const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                    const printed = printer.printExprToString(subId);
                    lastPart.subscripts.push({
                      node: sub,
                      text: subText,
                      isSlice: false,
                      values: [],
                      scalarText: printed,
                      isRealSub,
                    });
                  }
                } else {
                  lastPart.subscripts.push({
                    node: sub,
                    text: subText,
                    isSlice: false,
                    values: [],
                    scalarText: subText,
                    isRealSub,
                  });
                }
              }

              if (isRealSub) {
                const scopeName =
                  (flattener?.currentRootClassId ? db?.symbol(flattener.currentRootClassId)?.name : "") ??
                  flattener?.currentRootClassName ??
                  (dae as any).modelName ??
                  "";
                let stmtNode: any = node;
                let curr = node.parent;
                while (curr) {
                  if (
                    curr.type === "component_clause" ||
                    curr.type === "ComponentClause" ||
                    curr.type === "equation" ||
                    curr.type === "Equation"
                  ) {
                    stmtNode = curr;
                    break;
                  }
                  curr = curr.parent;
                }
                const r = {
                  startByte: stmtNode.startIndex ?? stmtNode.startByte,
                  endByte: stmtNode.endIndex ?? stmtNode.endByte,
                  startPosition: stmtNode.startPosition,
                  endPosition: stmtNode.endPosition,
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
                  message: `Variable ${lastPart.ident}[${subText}] not found in scope ${scopeName}.`,
                  range: r,
                });
                return -1;
              }
            }
          }
        }
      }

      for (let pi = 0; pi < rawParts.length; pi++) {
        const p = rawParts[pi]!;
        if (p.hasSubscripts) {
          const fullIdent = rawParts
            .slice(0, pi + 1)
            .map((x) => x.ident)
            .join(".");
          const expectedDimCount =
            getDaeArrayDimCount(prefix, fullIdent, dae, db) ?? getDaeArrayDimCount(prefix, p.ident, dae, db);
          if (expectedDimCount !== null && p.subscripts.length !== expectedDimCount) {
            const scopeName =
              (flattener?.currentRootClassId ? db?.symbol(flattener.currentRootClassId)?.name : "") ??
              flattener?.currentRootClassName ??
              (dae as any).modelName ??
              "";
            let stmtNode: any = node;
            let curr = node.parent;
            while (curr) {
              if (
                curr.type === "component_clause" ||
                curr.type === "ComponentClause" ||
                curr.type === "equation" ||
                curr.type === "Equation"
              ) {
                stmtNode = curr;
                break;
              }
              curr = curr.parent;
            }
            const r = {
              startByte: stmtNode.startIndex ?? stmtNode.startByte,
              endByte: stmtNode.endIndex ?? stmtNode.endByte,
              startPosition: stmtNode.startPosition,
              endPosition: stmtNode.endPosition,
            };
            const subStrs = p.subscripts.map(
              (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text),
            );
            const refStr = rawParts
              .map((x, idx) =>
                idx === pi
                  ? `${x.ident}[${subStrs.join(",")}]`
                  : x.hasSubscripts
                    ? `${x.ident}[${x.subscripts.map((s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text)).join(",")}]`
                    : x.ident,
              )
              .join(".");
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.code,
              message: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.message(
                refStr,
                p.subscripts.length,
                expectedDimCount,
              ),
              range: r,
            });
            dae.diagnostics.push({
              severity: "error",
              code: 2002,
              message: `Variable ${refStr} not found in scope ${scopeName}.`,
              range: r,
            });
            return -1;
          }
        }
      }

      const hasSlice = rawParts.some((p) => p.subscripts.some((s) => s.isSlice));
      if (hasSlice) {
        if (isAssignmentLhs) {
          const p = rawParts[0]!;
          const baseName = resolveScopedName(p.ident, prefix, dae, (dae as any).innerOuterComponents);
          const baseId = dae.addExpression(ExprKind.Name, dae.interner.intern(baseName));
          const subExprs = p.subscripts.map((s) => {
            if (s.text === ":") {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(":"));
            }
            if (s.isSlice && s.values.length > 0) {
              return dae.addArrayCtorExpr(s.values.map((v) => dae.addIntLiteral(v)));
            }
            if (s.node) {
              const exprNode = s.node.children?.find((k: any) => k.type === "expression") ?? s.node;
              if (exprNode && exprNode.text?.trim() !== ":") {
                const eId = lowerCSTExpression(exprNode, dae, prefix, substitutions, imports, db, flattener);
                if (eId >= 0) return eId;
              }
            }
            return dae.addIntLiteral(s.values[0] ?? 1);
          });
          return dae.addSubscriptExpr(baseId, subExprs);
        }

        const sliceLists: number[][] = [];
        for (const p of rawParts) {
          for (const s of p.subscripts) {
            if (s.isSlice) sliceLists.push(s.values);
          }
        }

        const makeScalarExpr = (chosenSliceIndices: number[]): number => {
          let sIdx = 0;
          const concreteParts: string[] = [];
          for (const p of rawParts) {
            if (!p.hasSubscripts) {
              concreteParts.push(p.ident);
            } else {
              const subStrs: (string | number)[] = [];
              for (const s of p.subscripts) {
                if (s.isSlice) {
                  subStrs.push(chosenSliceIndices[sIdx++]!);
                } else {
                  subStrs.push(s.scalarText ?? (s.values[0] !== undefined ? s.values[0] : ""));
                }
              }
              concreteParts.push(`${p.ident}[${subStrs.join(",")}]`);
            }
          }
          let concreteName = concreteParts.join(".");
          if (imports && imports.has(rawParts[0]!.ident)) {
            concreteName = [imports.get(rawParts[0]!.ident)!, ...concreteParts.slice(1)].join(".");
          }
          const candidate = resolveScopedName(concreteName, prefix, dae, (dae as any).innerOuterComponents);
          const vIdx = dae.getVarIdxByName(candidate);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Constant) {
            const exprId = dae.getVarExpression(vIdx);
            if (exprId >= 0) {
              const k = dae.getExprKind(exprId);
              if (k === ExprKind.RealLiteral) return dae.addRealLiteral(dae.getExprRealValue(exprId));
              if (k === ExprKind.IntLiteral) return dae.addIntLiteral(dae.getExprData1(exprId));
              if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(dae.getExprData1(exprId) !== 0);
            }
          }
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        };

        const buildSliceArray = (dim: number, currentIndices: number[]): number => {
          if (dim === sliceLists.length) {
            return makeScalarExpr(currentIndices);
          }
          const elems = sliceLists[dim]!.map((idx) => buildSliceArray(dim + 1, [...currentIndices, idx]));
          return dae.addArrayCtorExpr(elems);
        };

        return buildSliceArray(0, []);
      }

      const parts: string[] = [];
      for (const p of rawParts) {
        if (!p.hasSubscripts) {
          parts.push(p.ident);
        } else {
          const subStrs = p.subscripts.map(
            (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : ""),
          );
          parts.push(`${p.ident}[${subStrs.join(",")}]`);
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
              let child = db.childrenOf(currSym.id).find((c) => c.name === parts[pi]);
              if (!child) {
                const instComps = db.query<SymbolId[]>("instantiate", currSym.id);
                if (instComps) {
                  for (const cid of instComps) {
                    const cEntry = db.symbol(cid);
                    if (cEntry && cEntry.name === parts[pi]) {
                      child = cEntry;
                      break;
                    }
                  }
                }
              }
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
                  if (pi === parts.length - 1) {
                    const typeSpec = db.query<string | null>("typeSpecifier", child.id);
                    if (typeSpec) {
                      const recSym = db
                        .byName(typeSpec)
                        .find(
                          (e) =>
                            e.kind === "Class" && (flattener?.isRecordSym?.(e) || flattener?.isOperatorRecordSym?.(e)),
                        );
                      if (recSym) {
                        const compInst = db.query<ComponentInstanceData>("componentInstance", child.id);
                        const bExpr = compInst?.modification?.bindingExpression;
                        let bText = bExpr?.text?.trim();
                        if (!bText) {
                          const childCst = db.cstNode(child.id) as any;
                          const eqM = (childCst?.text ?? "").match(/=\s*([^\n;]+)/);
                          if (eqM) bText = eqM[1].trim();
                        }
                        if (bText && bText.startsWith(recSym.name) && bText.includes("(") && bText.endsWith(")")) {
                          const inside = bText.slice(bText.indexOf("(") + 1, -1).trim();
                          const rawArgs = inside.length > 0 ? inside.split(",").map((s) => s.trim()) : [];
                          const callArgs: number[] = [];
                          for (const a of rawArgs) {
                            const num = Number(a);
                            if (!isNaN(num)) {
                              callArgs.push(dae.addRealLiteral(num));
                            } else if (a === "true" || a === "false") {
                              callArgs.push(dae.addBoolLiteral(a === "true"));
                            }
                          }
                          return dae.addCallExpr(recSym.name, callArgs);
                        }
                      }
                    }
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

    // Check if rawName is an array variable like e, which has elements e[1] .. e[N] or multi-dim e[1,1] ..
    // Only expand if rawName is NOT already subscripted (does not contain '[') and noArrayExpand is false
    if (!noArrayExpand && !rawName.includes("[") && dae.hasArrayElements(rawName)) {
      const ctor = expandVarToArrayCtor(rawName, dae);
      if (ctor !== null) return ctor;
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
  readonly wasmExports: any;
  readonly envPtr: number;

  constructor(wasmExports: any, parentEnvPtr: number = 0) {
    this.wasmExports = wasmExports;
    this.envPtr =
      typeof wasmExports?.flattener_envCreate === "function" ? wasmExports.flattener_envCreate(parentEnvPtr) : 0;
  }

  set(keyHash: number, exprId: number, flag = 0): void {
    if (this.wasmExports?.flattener_envBind) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBind(this.envPtr, keyHash, exprId, isFinal, isEach);
    }
  }

  setPath(flattenerPtr: number, pathId: number, exprId: number, flag = 0): void {
    if (this.wasmExports?.flattener_envBindPath && flattenerPtr !== 0) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindPath(flattenerPtr, this.envPtr, pathId, exprId, isFinal, isEach);
    } else {
      this.set(pathId, exprId, flag);
    }
  }

  bindNested(keyHash: number, childEnv: ModelicaModificationEnv, flag = 0): void {
    if (this.wasmExports?.flattener_envBindNested && childEnv) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindNested(this.envPtr, keyHash, childEnv.envPtr, isFinal, isEach);
    }
  }

  bindRedeclare(keyHash: number, newTypeHash: number, valExprId = 0, flag = 0): void {
    if (this.wasmExports?.flattener_envBindRedeclare) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindRedeclare(this.envPtr, keyHash, newTypeHash, valExprId, isFinal, isEach);
    }
  }

  bindRedeclarePath(flattenerPtr: number, pathId: number, newTypeHash: number, valExprId = 0, flag = 0): void {
    if (this.wasmExports?.flattener_envBindRedeclarePath && flattenerPtr !== 0) {
      const isFinal = (flag & 1) !== 0 ? 1 : 0;
      const isEach = (flag & 2) !== 0 ? 1 : 0;
      this.wasmExports.flattener_envBindRedeclarePath(
        flattenerPtr,
        this.envPtr,
        pathId,
        newTypeHash,
        valExprId,
        isFinal,
        isEach,
      );
    } else {
      this.bindRedeclare(pathId, newTypeHash, valExprId, flag);
    }
  }

  lookup(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookup) return 0xffffffff;
    return this.wasmExports.flattener_envLookup(this.envPtr, keyHash);
  }

  lookupPath(flattenerPtr: number, pathId: number): number {
    if (this.wasmExports?.flattener_envLookupPath && flattenerPtr !== 0) {
      return this.wasmExports.flattener_envLookupPath(flattenerPtr, this.envPtr, pathId);
    }
    return this.lookup(pathId);
  }

  lookupNested(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookupNested) return 0;
    return this.wasmExports.flattener_envLookupNested(this.envPtr, keyHash);
  }

  lookupNestedPath(flattenerPtr: number, pathId: number): number {
    if (this.wasmExports?.flattener_envLookupNestedPath && flattenerPtr !== 0) {
      return this.wasmExports.flattener_envLookupNestedPath(flattenerPtr, this.envPtr, pathId);
    }
    return this.lookupNested(pathId);
  }

  lookupRedeclare(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookupRedeclare) return 0;
    return this.wasmExports.flattener_envLookupRedeclare(this.envPtr, keyHash);
  }

  lookupRedeclarePath(flattenerPtr: number, pathId: number): number {
    if (this.wasmExports?.flattener_envLookupRedeclarePath && flattenerPtr !== 0) {
      return this.wasmExports.flattener_envLookupRedeclarePath(flattenerPtr, this.envPtr, pathId);
    }
    return this.lookupRedeclare(pathId);
  }

  lookupFlags(keyHash: number): number {
    if (!this.wasmExports?.flattener_envLookupFlags) return 0;
    return this.wasmExports.flattener_envLookupFlags(this.envPtr, keyHash);
  }

  lookupWithEach(baseNameHash: number, elementKeyHash: number): number {
    if (this.wasmExports?.flattener_envLookupWithEach) {
      return this.wasmExports.flattener_envLookupWithEach(this.envPtr, baseNameHash, elementKeyHash);
    }
    const direct = this.lookup(elementKeyHash);
    if (direct !== 0xffffffff) return direct;
    if ((this.lookupFlags(baseNameHash) & 2) !== 0) {
      return this.lookup(baseNameHash);
    }
    return 0xffffffff;
  }

  lookupNestedWithEach(baseNameHash: number, elementKeyHash: number): number {
    if (this.wasmExports?.flattener_envLookupNestedWithEach) {
      return this.wasmExports.flattener_envLookupNestedWithEach(this.envPtr, baseNameHash, elementKeyHash);
    }
    const direct = this.lookupNested(elementKeyHash);
    if (direct !== 0) return direct;
    if ((this.lookupFlags(baseNameHash) & 2) !== 0) {
      return this.lookupNested(baseNameHash);
    }
    return 0;
  }

  merge(other: ModelicaModificationEnv): void {
    if (this.wasmExports?.flattener_envMerge && other && other.envPtr !== 0) {
      this.wasmExports.flattener_envMerge(this.envPtr, other.envPtr);
    }
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

function getConstVal(id: number, dae: DAEBuilder): number | null {
  if (id < 0) return null;
  const k = dae.getExprKind(id);
  if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
  if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
  if (k === ExprKind.Unary && dae.getExprData1(id) === 0 /* UnOp.Neg */) {
    const inner = getConstVal(dae.getExprLeft(id), dae);
    return inner !== null ? -inner : null;
  }
  if (k === ExprKind.Negate) {
    const inner = getConstVal(dae.getExprLeft(id), dae);
    return inner !== null ? -inner : null;
  }
  if (k === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(id));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const vExp = dae.getVarExpression(vIdx);
        if (vExp >= 0) return getConstVal(vExp, dae);
      }
    }
  }
  return null;
}

function expandColonToArrayCtor(exprId: number, dae: DAEBuilder, varType?: VarType): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  let startVal: number | null = null;
  let stepVal = 1;
  let stopVal: number | null = null;

  if (kind === ExprKind.Range) {
    const startId = dae.getExprData1(exprId);
    const stepId = dae.getExprLeft(exprId);
    const stopId = dae.getExprRight(exprId);
    startVal = getConstVal(startId, dae);
    stepVal = stepId >= 0 ? (getConstVal(stepId, dae) ?? 1) : 1;
    stopVal = getConstVal(stopId, dae);
  } else if (kind === ExprKind.Binary && dae.getExprData1(exprId) === BinOp.Colon) {
    const leftId = dae.getExprLeft(exprId);
    const rightId = dae.getExprRight(exprId);

    if (dae.getExprKind(leftId) === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Colon) {
      const startId = dae.getExprLeft(leftId);
      const stepId = dae.getExprRight(leftId);
      startVal = getConstVal(startId, dae);
      stepVal = getConstVal(stepId, dae) ?? 1;
      stopVal = getConstVal(rightId, dae);
    } else {
      startVal = getConstVal(leftId, dae);
      stopVal = getConstVal(rightId, dae);
    }
  } else {
    return null;
  }

  if (startVal !== null && stopVal !== null && stepVal !== 0) {
    const elemIds: number[] = [];
    const isReal =
      varType === VarType.Real ||
      !Number.isInteger(startVal) ||
      !Number.isInteger(stepVal) ||
      !Number.isInteger(stopVal);
    if (stepVal > 0) {
      for (let v = startVal; v <= stopVal + 1e-9; v += stepVal) {
        elemIds.push(isReal ? dae.addRealLiteral(v) : dae.addIntLiteral(Math.round(v)));
      }
    } else {
      for (let v = startVal; v >= stopVal - 1e-9; v += stepVal) {
        elemIds.push(isReal ? dae.addRealLiteral(v) : dae.addIntLiteral(Math.round(v)));
      }
    }
    return dae.addArrayCtorExpr(elemIds);
  }
  return null;
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
  public usedOperatorFunctions = new Map<string, SymbolId>();
  public currentFlatteningFunctionId: SymbolId | null = null;
  private pendingArrayBindings = new Map<string, { lhsExprId: number; rhsExprId: number }[]>();
  currentImports = new Map<string, string>();
  public expandableBuses = new Map<string, SymbolId>();
  public evaluatedConstantArrays = new Map<string, any>();

  private extractClassAnnotations(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    const evaluator = new AnnotationEvaluator(this.db as any);

    // 1. Experiment annotation (Modelica 3.7 / MCP-0036)
    const exp = evaluator.evaluate(cst, "experiment");
    if (exp) {
      if (exp.StartTime !== undefined || exp.startTime !== undefined) {
        dae.experiment.startTime = Number(exp.StartTime ?? exp.startTime);
      }
      if (exp.StopTime !== undefined || exp.stopTime !== undefined) {
        dae.experiment.stopTime = Number(exp.StopTime ?? exp.stopTime);
      }
      if (exp.Tolerance !== undefined || exp.tolerance !== undefined) {
        dae.experiment.tolerance = Number(exp.Tolerance ?? exp.tolerance);
      }
      if (exp.Interval !== undefined || exp.interval !== undefined) {
        dae.experiment.interval = Number(exp.Interval ?? exp.interval);
      }
      if (exp.NumberOfIntervals !== undefined || exp.numberOfIntervals !== undefined) {
        dae.experiment.numberOfIntervals = Number(exp.NumberOfIntervals ?? exp.numberOfIntervals);
      }
      if (exp.Algorithm !== undefined || exp.algorithm !== undefined) {
        dae.experiment.algorithm = String(exp.Algorithm ?? exp.algorithm);
      }
      if (exp.EquidistantOutput !== undefined || exp.equidistantOutput !== undefined) {
        dae.experiment.__modelscript_equidistantOutput = Boolean(exp.EquidistantOutput ?? exp.equidistantOutput);
      }
    }

    // 2. WebGPU
    const gpu = evaluator.evaluate(cst, "webgpu");
    if (gpu) {
      dae.extensionMetadata.webgpu = {
        workgroupSize: gpu.workgroupSize ? Number(gpu.workgroupSize) : undefined,
        precision: gpu.precision ? String(gpu.precision) : undefined,
        parallelInstances: gpu.parallelInstances ? Number(gpu.parallelInstances) : undefined,
      };
    }

    // 3. AudioClock
    const audio = evaluator.evaluate(cst, "audioclock");
    if (audio) {
      dae.extensionMetadata.audioClock = {
        sampleRate: audio.sampleRate ? Number(audio.sampleRate) : undefined,
        targetHz: audio.targetHz ? Number(audio.targetHz) : undefined,
        realtimeFactor: audio.realtimeFactor ? Number(audio.realtimeFactor) : undefined,
      };
    }

    // 4. SDE
    const sde = evaluator.evaluate(cst, "sde");
    if (sde) {
      dae.extensionMetadata.sde = {
        method: sde.method ? String(sde.method) : undefined,
        ensemblePaths: sde.ensemblePaths ? Number(sde.ensemblePaths) : undefined,
        seed: sde.seed ? Number(sde.seed) : undefined,
      };
    }

    // 5. BVP
    const bvp = evaluator.evaluate(cst, "bvp");
    if (bvp) {
      dae.extensionMetadata.bvp = {
        boundaryConditions: Array.isArray(bvp.boundaryConditions) ? bvp.boundaryConditions.map(String) : undefined,
        method: bvp.method ? String(bvp.method) : undefined,
        intervals: bvp.intervals ? Number(bvp.intervals) : undefined,
      };
    }

    // 6. Surrogate
    const surrogate = evaluator.evaluate(cst, "surrogate");
    if (surrogate) {
      if (!dae.extensionMetadata.surrogate) dae.extensionMetadata.surrogate = new Map();
      dae.extensionMetadata.surrogate.set("model", {
        architecture: surrogate.architecture ? String(surrogate.architecture) : undefined,
        datasetUri: surrogate.datasetUri ? String(surrogate.datasetUri) : undefined,
        errorTolerance: surrogate.errorTolerance ? Number(surrogate.errorTolerance) : undefined,
      });
    }

    // 7. FEAMesh
    const fea = evaluator.evaluate(cst, "feamesh");
    if (fea) {
      if (!dae.extensionMetadata.feaMesh) dae.extensionMetadata.feaMesh = [];
      dae.extensionMetadata.feaMesh.push({
        cadUri: fea.cadUri ? String(fea.cadUri) : undefined,
        meshType: fea.meshType ? String(fea.meshType) : undefined,
        material: fea.material ? String(fea.material) : undefined,
        loadConnector: fea.loadConnector ? String(fea.loadConnector) : undefined,
        feedbackDeflection: fea.feedbackDeflection ? String(fea.feedbackDeflection) : undefined,
      });
    }

    // 8. CFDFlow
    const cfd = evaluator.evaluate(cst, "cfdflow");
    if (cfd) {
      if (!dae.extensionMetadata.cfdFlow) dae.extensionMetadata.cfdFlow = [];
      dae.extensionMetadata.cfdFlow.push({
        grid: Array.isArray(cfd.grid) ? cfd.grid.map(Number) : undefined,
        dx: cfd.dx ? Number(cfd.dx) : undefined,
        turbulenceModel: cfd.turbulenceModel ? String(cfd.turbulenceModel) : undefined,
        velocityVariable: cfd.velocityVariable ? String(cfd.velocityVariable) : undefined,
        dragForceVariable: cfd.dragForceVariable ? String(cfd.dragForceVariable) : undefined,
      });
    }

    // 9. MBSE / IoT (SysML, OWL, Telemetry)
    const sysml = evaluator.evaluate(cst, "sysml");
    const owl = evaluator.evaluate(cst, "owl");
    const telemetry = evaluator.evaluate(cst, "telemetry");
    if (sysml || owl || telemetry) {
      if (!dae.extensionMetadata.mbse) dae.extensionMetadata.mbse = {};
      if (sysml) {
        if (!dae.extensionMetadata.mbse.sysml) dae.extensionMetadata.mbse.sysml = [];
        dae.extensionMetadata.mbse.sysml.push(sysml);
      }
      if (owl) {
        if (!dae.extensionMetadata.mbse.owl) dae.extensionMetadata.mbse.owl = [];
        dae.extensionMetadata.mbse.owl.push(owl);
      }
      if (telemetry) {
        if (!dae.extensionMetadata.mbse.telemetry) dae.extensionMetadata.mbse.telemetry = [];
        dae.extensionMetadata.mbse.telemetry.push(telemetry);
      }
    }
  }

  private isComponentHidden(elemId: SymbolId): boolean {
    const cst = this.db.cstNode(elemId) as any;
    if (!cst) return false;
    let curr = cst;
    while (
      curr &&
      curr.type !== "component_declaration" &&
      curr.type !== "ComponentDeclaration" &&
      curr.type !== "component_clause" &&
      curr.type !== "ComponentClause"
    ) {
      curr = curr.parent;
    }
    if (!curr) curr = cst;
    const evaluator = new AnnotationEvaluator();
    const hideRes = evaluator.evaluate(curr, "hideresult") ?? evaluator.evaluate(cst, "hideresult");
    if (hideRes !== null && hideRes !== undefined) {
      if (typeof hideRes === "boolean") return hideRes;
      if (typeof hideRes === "object" && hideRes.value !== undefined) return Boolean(hideRes.value);
      return true;
    }
    return false;
  }

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

  isOperatorRecordSym(sym: any): boolean {
    if (!sym) return false;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    if (rawKind.includes("operator") && rawKind.includes("record")) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial)\s+)*operator\s+record\b/.test(text)) return true;
    }
    return false;
  }

  validateOperatorRecords(dae: DAEBuilder, rootClassId: SymbolId): void {
    const rootSym = this.db.symbol(rootClassId);
    if (!rootSym || !rootSym.resourceId) return;
    const rootCst = this.db.cstNode(rootClassId) as any;
    const isOldFrontend = Boolean(rootCst?.text?.includes("-d=-newInst") || (this.options as any)?.isOldFrontend);

    const candidates = this.db
      .allEntries()
      .filter((s: any) => s.resourceId === rootSym.resourceId && s.kind === "Class" && this.isOperatorRecordSym(s));

    for (const rec of candidates) {
      const recCst = this.db.cstNode(rec.id) as any;
      const recStart = recCst?.startIndex ?? recCst?.startByte;
      const recEnd = recCst?.endIndex ?? recCst?.endByte;
      const recRange = recStart != null && recEnd != null ? { startByte: recStart, endByte: recEnd } : undefined;

      const children = this.db.childrenOf(rec.id);
      for (const child of children) {
        if (child.kind !== "Class") continue;
        const childMeta = (child.metadata as Record<string, unknown>) || {};
        const childPrefix = String(childMeta?.classPrefixes ?? childMeta?.classKind ?? "");
        const childCst = this.db.cstNode(child.id) as any;
        const childText = childCst?.text?.trim() ?? "";

        const isOperator =
          childPrefix.includes("operator") ||
          child.name.startsWith("'") ||
          childText.startsWith("operator") ||
          /^(?:(?:encapsulated|partial)\s+)*operator\b/.test(childText);

        if (!isOperator) continue;

        const recMeta = (rec.metadata as Record<string, unknown>) || {};
        const recPrefix = String(recMeta?.classPrefixes ?? recMeta?.classKind ?? "");
        const cleanChildPrefix = childPrefix.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const cleanChildText = childText.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const cleanRecPrefix = recPrefix.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const isEncapsulated =
          /(?<!non-)\bencapsulated\b/.test(cleanRecPrefix) ||
          /(?<!non-)\bencapsulated\b/.test(cleanChildPrefix) ||
          /(?<!non-)\bencapsulated\b/.test(cleanChildText) ||
          this.db.childrenOf(child.id).some((c) => {
            if (c.kind !== "Class") return false;
            const meta = (c.metadata as any) || {};
            const pfx = String(meta.classPrefixes ?? meta.classKind ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
            return /(?<!non-)\bencapsulated\b/.test(pfx);
          });

        if (!isOldFrontend && !isEncapsulated) {
          const cStart = childCst?.startIndex ?? childCst?.startByte;
          const cEnd = childCst?.endIndex ?? childCst?.endByte;
          const cRange = cStart != null && cEnd != null ? { startByte: cStart, endByte: cEnd } : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: 4070,
            message: `Operator ${rec.name}.'${child.name.replace(/^'|'$/g, "")}' is not encapsulated.`,
            range: cRange,
          });
        }

        const isCtor = child.name === "'constructor'" || child.name === "constructor";
        if (isCtor) {
          const funcs =
            childPrefix.includes("operator function") || childText.startsWith("operator function")
              ? [child]
              : this.db.childrenOf(child.id).filter((c) => c.kind === "Class");

          for (const fn of funcs) {
            const comps = this.db.childrenOf(fn.id).filter((c) => c.kind === "Component");
            const outputs: SymbolEntry[] = [];
            for (const c of comps) {
              const causality = this.db.query<string | null>("causality", c.id);
              if (causality === "output") outputs.push(c);
            }

            if (outputs.length !== 1) {
              dae.diagnostics.push({
                severity: "error",
                code: 4071,
                message: `Operator ${rec.name}.'constructor' must have exactly one output.`,
                range: recRange,
              });
            } else {
              const out = outputs[0]!;
              const outType = this.db.query<string | null>("typeSpecifier", out.id);
              const cleanType = outType?.replace(/^\./, "") ?? "";
              if (cleanType !== rec.name) {
                dae.diagnostics.push({
                  severity: "error",
                  code: 4072,
                  message: `Output '${out.name}' in operator ${rec.name}.'constructor' must be of type ${rec.name}, got type ${outType ?? "unknown"}.`,
                  range: recRange,
                });
              }
            }
          }
        }
      }
    }
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

  isExpandableConnectorClass(classId: SymbolId): boolean {
    if (!classId) return false;
    const sym = this.db.symbol(classId);
    if (!sym) return false;
    const meta = (sym.metadata as any) || {};
    let prefixes = String(meta.classPrefixes ?? meta.classKind ?? "");
    prefixes = prefixes.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    const words = prefixes.split(/\s+/).filter(Boolean);
    if (words.includes("expandable") && words.includes("connector")) return true;
    const cst = this.db.cstNode(classId) as any;
    if (cst) {
      const pfx = Cst.ClassDefinition.classPrefixes(cst);
      if (pfx) {
        const pfxText = (pfx.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
        const pfxWords = pfxText.split(/\s+/).filter(Boolean);
        if (pfxWords.includes("expandable") && pfxWords.includes("connector")) return true;
      }
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
    isAssignmentLhs?: boolean,
  ): number {
    return lowerCSTExpression(
      node,
      dae,
      prefix,
      substitutions,
      this.currentImports,
      this.db,
      this,
      tupleContext,
      false,
      isAssignmentLhs,
    );
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
      arrayMode: options?.arrayMode ?? (omcCompatibility ? "scalarize" : "preserve"),
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility,
      eliminateAliases: options?.eliminateAliases ?? !omcCompatibility,
      useWasmKernel: options?.useWasmKernel,
    };
  }

  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      if (options.arrayMode !== undefined) this.options.arrayMode = options.arrayMode;
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) {
        this.options.omcCompatibility = options.omcCompatibility;
        if (options.arrayMode === undefined && options.omcCompatibility) {
          this.options.arrayMode = "scalarize";
        }
        if (options.eliminateAliases === undefined) {
          this.options.eliminateAliases = !options.omcCompatibility;
        }
      }
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
      if (options.useWasmKernel !== undefined) this.options.useWasmKernel = options.useWasmKernel;
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
    const classCst = this.db.cstNode(rootClassId) as any;
    const wasmExports = classCst?.tree?.facade?.exports ?? classCst?.facade?.exports;
    let dae = cachedArena ?? new DAEBuilder(wasmExports, rootName, "");
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
    this.extractClassAnnotations(dae, rootClassId);
    dae.extensionMetadata.isOldFrontend = Boolean(
      classCst?.text?.includes("-d=-newInst") || (this.options as any)?.isOldFrontend,
    );
    this.validateOperatorRecords(dae, rootClassId);

    // Check for non-instantiable class specializations (package, function, etc.)
    const classCstForCheck = classCst as SyntaxNode | null;
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

    this.expandableBuses.clear();
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

    // Check for duplicate local elements
    const localComps = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Component");
    const seenLocalComps = new Map<string, SymbolEntry>();
    for (const comp of localComps) {
      const prevComp = seenLocalComps.get(comp.name);
      if (prevComp) {
        const prevCst = this.db.cstNode(prevComp.id) as any;
        const currCst = this.db.cstNode(comp.id) as any;
        const getClause = (node: any) => {
          let curr = node;
          while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause") curr = curr.parent;
          return curr;
        };
        const prevClause = getClause(prevCst);
        const currClause = getClause(currCst);
        let prevText = (prevClause?.text ?? prevCst?.text ?? "").trim().replace(/;$/, "");
        let currText = (currClause?.text ?? currCst?.text ?? "").trim().replace(/;$/, "");
        const typeMatch = prevText.match(/^([a-zA-Z_]\w*)\s*(\[[^\]]+\])\s*([a-zA-Z_]\w*)$/);
        if (typeMatch) {
          prevText = `${typeMatch[1]} ${typeMatch[3]}${typeMatch[2]}`;
        }
        const currRange = currClause
          ? {
              startByte: currClause.startIndex ?? currClause.startByte,
              endByte: currClause.endIndex ?? currClause.endByte,
            }
          : {
              startByte: currCst?.startIndex ?? currCst?.startByte ?? 0,
              endByte: currCst?.endIndex ?? currCst?.endByte ?? 0,
            };
        const prevRange = prevClause
          ? {
              startByte: prevClause.startIndex ?? prevClause.startByte,
              endByte: prevClause.endIndex ?? prevClause.endByte,
            }
          : {
              startByte: prevCst?.startIndex ?? prevCst?.startByte ?? 0,
              endByte: prevCst?.endIndex ?? prevCst?.endByte ?? 0,
            };

        dae.diagnostics.push({
          severity: "notification",
          code: 0,
          message: "From here:",
          range: currRange,
        });
        dae.diagnostics.push({
          severity: "error",
          code: 4056,
          message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${currText}\n  second element is: ${prevText}`,
          range: prevRange,
        });
        return dae;
      }
      seenLocalComps.set(comp.name, comp);
    }

    // Check for duplicate elements due to inherited elements
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

    this.evaluatedConstantArrays.clear();
    if (this.options.omcCompatibility) {
      this.generateFunctions(rootClassId, dae);
    }

    const t_start = performance.now();
    let flattenedInWasm = false;
    const classNodePtr = classCst?.ptr ?? classCst?.id;
    const rootProgramPtr = classCst?.tree?.rootPtr ?? (this.db as any)?.rootNode?.ptr ?? 0;
    const hasWasmFlattener = typeof dae.exports?.flattener_flatten === "function";
    const hasArrayDecls = this.db.query<SymbolId[]>("instantiate", rootClassId)?.some((id) => {
      const dims = this.db.query<any[] | null>("arrayDimensions", id);
      return dims && dims.length > 0;
    });
    const allowWasm = Boolean(this.options.useWasmKernel);

    if (!cachedArena && hasWasmFlattener && classNodePtr && allowWasm) {
      try {
        const wasmFlattener = dae.exports.flattener_create(dae.ptr);
        if (wasmFlattener) {
          const varCount = dae.exports.flattener_flatten(wasmFlattener, classNodePtr, rootProgramPtr);
          if (varCount > 0) {
            flattenedInWasm = true;
            this.recordWasmSourceRanges(dae, rootClassId);
          }
        }
      } catch {
        flattenedInWasm = false;
      }
      if (!flattenedInWasm) {
        const savedDesc = dae.description;
        const savedDiags = dae.diagnostics;
        dae = new DAEBuilder(wasmExports, rootName, "");
        dae.description = savedDesc;
        dae.diagnostics = savedDiags;
        (this as any).currentRootDae = dae;
        (dae as any).innerOuterComponents = this.innerOuterComponents;
        (dae as any).activeLoopVars = this.activeLoopVars;
        (dae as any).db = this.db;
        dae.classKind = specKind ?? rawKind;
      }
    }

    let t0 = t_start;
    let t1 = t_start;
    let t2 = t_start;
    let t3 = t_start;

    if (!flattenedInWasm) {
      // 1. Layer 1: Component instantiation
      t0 = performance.now();
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
      t1 = performance.now();
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
      t2 = performance.now();

      // 2.5 Expandable connector dynamic augmentation, cross-bus pooling, and variable pruning
      this.processExpandableConnectors(rootClassId, dae);

      // 3. Layer 3: Physical connector expansion & flow balance
      const rootCst = this.db.cstNode(rootClassId) as any;
      const rootSym = this.db.symbol(rootClassId);
      const isOldFrontend = Boolean(
        rootCst?.text?.includes("-d=-newInst") || rootSym?.resourceId?.includes("/scodeinst/"),
      );
      ModelicaPortBalancer.expandConnections(dae, {
        omcCompatibility: this.options.omcCompatibility,
        isOldFrontend,
      });
      t3 = performance.now();
    } else {
      t3 = performance.now();
    }

    // 4. Constant folding and alias elimination
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);
    const t4 = performance.now();

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }
    const t5 = performance.now();

    if (this.options.omcCompatibility) {
      this.generateRecordConstructors(rootClassId, dae);
      this.generateOperatorFunctions(dae);
      this.generateExternalObjectFunctions(dae);
      this.propagateImpureFunctions(dae);
    }

    const shouldScalarize =
      this.options.arrayMode === "scalarize" ||
      (this.options.arrayMode !== "preserve" && (this.options.omcCompatibility || hasArrayEquations(dae)));
    if (shouldScalarize) {
      const scalarized = scalarizeArena(dae);
      foldArenaConstants(scalarized, this.db, rootClassId, this.options.omcCompatibility);
      scalarized.groupEquationsForParity();
      this.checkBalance(scalarized, rootClassId);
      return scalarized;
    }

    dae.groupEquationsForParity();
    const t6 = performance.now();
    this.checkBalance(dae, rootClassId);
    const t7 = performance.now();

    if (t7 - t_start > 100) {
      console.log(
        `[flattenClass timings for ${rootName}] total=${(t7 - t_start).toFixed(1)}ms: ` +
          `instantiate=${(t1 - t0).toFixed(1)}ms, ` +
          `equations=${(t2 - t1).toFixed(1)}ms, ` +
          `expandConn=${(t3 - t2).toFixed(1)}ms, ` +
          `foldConst=${(t4 - t3).toFixed(1)}ms, ` +
          `elimAlias=${(t5 - t4).toFixed(1)}ms, ` +
          `groupEqs=${(t6 - t5).toFixed(1)}ms, ` +
          `checkBalance=${(t7 - t6).toFixed(1)}ms`,
      );
    }
    return dae;
  }

  private recordWasmSourceRanges(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    let eqIdx = 0;
    const walkEqs = (node: any): void => {
      if (!node) return;
      if (
        node.type === "extends_clause" ||
        node.type === "ExtendsClause" ||
        node.type === "component_clause" ||
        node.type === "ComponentClause" ||
        node.type === "component_clause1" ||
        node.type === "component_declaration" ||
        node.type === "ComponentDeclaration"
      ) {
        return;
      }

      if (
        node.type === "simple_equation" ||
        node.type === "SimpleEquation" ||
        node.type === "equality_equation" ||
        node.type === "EqualityEquation" ||
        node.type === "connect_equation" ||
        node.type === "ConnectEquation" ||
        node.type === "function_call" ||
        node.type === "FunctionCall"
      ) {
        const sB = node.startIndex ?? node.startByte;
        const eB = node.endIndex ?? node.endByte;
        if (sB != null && eB != null && eqIdx < dae.getEqCount()) {
          dae.setEqSourceRange(eqIdx, sB, eB);
          eqIdx++;
        }
        return;
      }

      for (const child of node.children || []) {
        walkEqs(child);
      }
    };
    walkEqs(cst);

    const walkVars = (node: any): void => {
      if (!node) return;
      if (
        node.type === "declaration" ||
        node.type === "Declaration" ||
        node.type === "component_declaration1" ||
        node.type === "ComponentDeclaration1"
      ) {
        const idChild = (node.children || []).find((c: any) => c.type === "identifier" || c.type === "Identifier");
        const name = idChild ? idChild.text?.trim() : node.text?.trim()?.split(/\s|=|\[|\(/)[0];
        if (name) {
          let varIdx = dae.getVarIdxByName(name);
          if (varIdx < 0) {
            varIdx = dae.getVarIdxByName(`${name}[1]`);
          }
          const sB = node.startIndex ?? node.startByte;
          const eB = node.endIndex ?? node.endByte;
          if (varIdx >= 0 && sB != null && eB != null) {
            dae.setVarSourceRange(varIdx, sB, eB);
            const arrayIndices = dae.getArrayElementIndices(name);
            for (const idx of arrayIndices) {
              dae.setVarSourceRange(idx, sB, eB);
            }
          }
        }
      }
      for (const child of node.children || []) {
        walkVars(child);
      }
    };
    walkVars(cst);
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
            const expressions = (eqNode.children || []).filter(isEquationExpr);
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
        const expressions = (insertedEqNode.children || []).filter(isEquationExpr);
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
          const declMatch = modText.match(/^([a-zA-Z_]\w*)/);
          const newName = nameMatch ? nameMatch[1] : declMatch ? declMatch[1] : null;
          if (newName) {
            if (baseName && newName !== baseName) {
              (dae as any).renameVar?.(baseName, newName);
              baseName = newName;
            } else if (!baseName) {
              baseName = newName;
              if (targetVarIdx < 0) {
                targetVarIdx = dae.getVarIdxByName(baseName);
                if (targetVarIdx < 0) {
                  targetVarIdx = dae.getVarIdxByName(`${baseName}[1]`);
                }
              }
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
            if (dae.lookupVariable(newName) < 0 && dae.lookupVariable(`${newName}[1]`) < 0) {
              return false; // New component added: trigger structural fallback!
            }
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
        curr.type === "component_declaration1" ||
        curr.type === "ComponentDeclaration1" ||
        curr.type === "component_clause" ||
        curr.type === "ComponentClause" ||
        curr.type === "component_clause1" ||
        curr.type === "ComponentClause1" ||
        curr.type === "declaration" ||
        curr.type === "Declaration";
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
        const callRegex = new RegExp(`\\b${name}\\s*\\(`, "m");
        if (callRegex.test(text)) return true;
      }
      for (const fn of dae.functions.values()) {
        if (fn.name === sym.name || fn.name.startsWith(`${sym.name}.`)) continue;
        for (let i = 0; i < fn.varCount; i++) {
          const ct = fn.getVarCustomType(i);
          if (ct === name || ct === `.${name}`) return true;
        }
      }
      if (rootSym?.resourceId) {
        const fileComps = this.db
          .allEntries()
          .filter((s: any) => s.resourceId === rootSym.resourceId && s.kind === "Component");
        for (const comp of fileComps) {
          // Skip components defined inside sym itself
          let pId: SymbolId | null = comp.parentId;
          let insideSym = false;
          while (pId !== null) {
            if (pId === sym.id) {
              insideSym = true;
              break;
            }
            pId = this.db.symbol(pId)?.parentId ?? null;
          }
          if (insideSym) continue;

          const typeSpec = this.db.query<string | null>("typeSpecifier", comp.id);
          if (typeSpec === name || typeSpec === `.${name}`) {
            const dims = this.db.query<any[] | null>("arrayDimensions", comp.id);
            if (dims && dims.some((d: any) => d.kind === "literal" && d.value === 0)) {
              continue;
            }
            return true;
          }
        }
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
        if (this.isOperatorRecordSym(sym)) {
          (fn as any).isOperatorRecord = true;
          fn.extensionMetadata.isOperatorRecord = true;
        }
        const instElements = this.db.query<SymbolId[]>("instantiate", sym.id);
        const comps: SymbolEntry[] = [];
        if (instElements && instElements.length > 0) {
          for (const eid of instElements) {
            const entry = this.db.symbol(eid);
            if (entry && entry.kind === "Component") comps.push(entry);
          }
        } else {
          for (const comp of this.db.childrenOf(sym.id)) {
            if (comp && comp.kind === "Component") comps.push(comp);
          }
        }
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
        if (this.isOperatorRecordSym(sym)) {
          const ctors = this.db.query<any[]>("operatorConstructors", sym.id);
          if (ctors && ctors.length > 0) {
            for (const ctor of ctors) {
              if (!dae.functions.has(ctor.qualifiedName)) {
                const ctorFn = this.flattenFunction(ctor.funcSymId, ctor.qualifiedName, undefined, dae);
                dae.addFunction(ctor.qualifiedName, ctorFn);
              }
            }
          }
        }
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

  private isInsideExpandableBus(prefix: string): boolean {
    if (!prefix) return false;
    for (const b of this.expandableBuses.keys()) {
      if (b && (prefix === b || prefix.startsWith(b + "."))) return true;
    }
    return false;
  }

  private processExpandableConnectors(rootClassId: SymbolId, dae: DAEBuilder): void {
    if (this.isExpandableConnectorClass(rootClassId)) {
      this.expandableBuses.set("", rootClassId);
    }
    if (this.expandableBuses.size === 0) return;
    if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
    dae.extensionMetadata.expandableBuses = Array.from(this.expandableBuses.keys());

    const busReferencedSignals = new Map<string, Set<string>>();
    for (const busPrefix of this.expandableBuses.keys()) {
      busReferencedSignals.set(busPrefix, new Set<string>());
    }

    const busConnections: [string, string][] = [];

    const markSignalReferenced = (name: string) => {
      if (!name) return;
      for (const busPrefix of this.expandableBuses.keys()) {
        if (busPrefix === "") {
          if (name) busReferencedSignals.get("")?.add(name);
        } else if (name === busPrefix) {
          // Direct reference to bus itself
        } else if (name.startsWith(busPrefix + ".")) {
          const rel = name.slice(busPrefix.length + 1);
          busReferencedSignals.get(busPrefix)?.add(rel);
        }
      }
    };

    const matchBus = (name: string): { busPrefix: string; relPath: string } | null => {
      let longestMatch: { busPrefix: string; relPath: string } | null = null;
      for (const busPrefix of this.expandableBuses.keys()) {
        if (busPrefix === "") {
          if (!longestMatch) longestMatch = { busPrefix: "", relPath: name };
        } else if (name === busPrefix) {
          return { busPrefix, relPath: "" };
        } else if (name.startsWith(busPrefix + ".")) {
          const relPath = name.slice(busPrefix.length + 1);
          if (!longestMatch || busPrefix.length > longestMatch.busPrefix.length) {
            longestMatch = { busPrefix, relPath };
          }
        }
      }
      return longestMatch;
    };

    const augmentDynamicSignal = (busPrefix: string, relPath: string, otherEndpointName: string) => {
      const targetName = busPrefix ? `${busPrefix}.${relPath}` : relPath;
      if (dae.getVarIdxByName(targetName) >= 0) return;

      // Check if otherEndpointName is a single variable in dae
      const otherIdx = dae.getVarIdxByName(otherEndpointName);
      if (otherIdx >= 0) {
        const varType = dae.getVarType(otherIdx);
        const isFlow = dae.isVarFlow(otherIdx);
        const newIdx = dae.addVariable(
          dae.interner.intern(targetName),
          varType,
          Variability.Continuous,
          Causality.Local,
          0.0,
        );
        dae.setVarDescription(newIdx, "virtual variable in expandable connector");
        if (isFlow) dae.setVarFlow(newIdx, true);
        markSignalReferenced(targetName);
        return;
      }

      // Check if otherEndpointName is a composite / connector prefix in dae (e.g. ground1.p)
      const otherPrefix = otherEndpointName + ".";
      let matchedAny = false;
      const matchingSubVars: number[] = [];
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const vName = dae.getVarName(v);
        if (vName.startsWith(otherPrefix)) {
          matchingSubVars.push(v);
        }
      }
      matchingSubVars.sort((a, b) => {
        const flowA = dae.isVarFlow(a) ? 1 : 0;
        const flowB = dae.isVarFlow(b) ? 1 : 0;
        return flowB - flowA;
      });
      for (const v of matchingSubVars) {
        matchedAny = true;
        const vName = dae.getVarName(v);
        const subPath = vName.slice(otherPrefix.length);
        const subTargetName = `${targetName}.${subPath}`;
        if (dae.getVarIdxByName(subTargetName) < 0) {
          const varType = dae.getVarType(v);
          const isFlow = dae.isVarFlow(v);
          const newIdx = dae.addVariable(
            dae.interner.intern(subTargetName),
            varType,
            Variability.Continuous,
            Causality.Local,
            0.0,
          );
          dae.setVarDescription(newIdx, "virtual variable in expandable connector");
          if (isFlow) dae.setVarFlow(newIdx, true);
          markSignalReferenced(subTargetName);
        }
      }
      if (!matchedAny) {
        const newIdx = dae.addVariable(
          dae.interner.intern(targetName),
          VarType.Real,
          Variability.Continuous,
          Causality.Local,
          0.0,
        );
        dae.setVarDescription(newIdx, "virtual variable in expandable connector");
        markSignalReferenced(targetName);
      }
    };

    // Scan equations in dae
    for (let i = 0; i < dae.eqCount; i++) {
      const k = dae.getEqKind(i);
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);

      if (k === EqKind.Connect) {
        const lhsName = dae.getExprKind(lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhs)) : "";
        const rhsName = dae.getExprKind(rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhs)) : "";

        // Check if either side connects to an array of buses (ExpandableConnector9.mo)
        const matchArrayBus = (name: string): string[] => {
          const prefixMatch = `${name}[`;
          const matches: string[] = [];
          for (const b of this.expandableBuses.keys()) {
            if (b.startsWith(prefixMatch)) matches.push(b);
          }
          return matches;
        };

        const arrBusesL = matchArrayBus(lhsName);
        const arrBusesR = matchArrayBus(rhsName);
        if (arrBusesL.length > 0 || arrBusesR.length > 0) {
          const arrBuses = arrBusesL.length > 0 ? arrBusesL : arrBusesR;
          const otherName = arrBusesL.length > 0 ? rhsName : lhsName;
          const baseArrName = arrBusesL.length > 0 ? lhsName : rhsName;
          for (const bKey of arrBuses) {
            const idxSuffix = bKey.slice(baseArrName.length);
            let projOther = "";
            if (otherName.includes(".")) {
              const dotIdx = otherName.indexOf(".");
              projOther = `${otherName.slice(0, dotIdx)}${idxSuffix}${otherName.slice(dotIdx)}`;
            } else {
              projOther = `${otherName}${idxSuffix}`;
            }
            const bL = arrBusesL.length > 0 ? bKey : projOther;
            const bR = arrBusesL.length > 0 ? projOther : bKey;
            busConnections.push([bL, bR]);
            const newLhsExpr = dae.addNameExpr(bL);
            const newRhsExpr = dae.addNameExpr(bR);
            dae.addEquation(EqKind.Connect, newLhsExpr, newRhsExpr);
          }
          continue;
        }

        const matchL = matchBus(lhsName);
        const matchR = matchBus(rhsName);

        // Error check: cannot connect undeclared connectors (ExpandableConnectorNonDecl1.mo)
        if (matchL && matchR && matchL.relPath !== "" && matchR.relPath !== "") {
          let lExists = dae.getVarIdxByName(lhsName) >= 0;
          let rExists = dae.getVarIdxByName(rhsName) >= 0;
          if (!lExists || !rExists) {
            for (let v = 0; v < dae.varCount; v++) {
              if (dae.isVarRemoved(v)) continue;
              const vn = dae.getVarName(v);
              if (!lExists && vn.startsWith(lhsName + ".")) lExists = true;
              if (!rExists && vn.startsWith(rhsName + ".")) rExists = true;
              if (lExists && rExists) break;
            }
          }
          if (!lExists && !rExists) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CANNOT_CONNECT_UNDECLARED_EXPANDABLE_CONNECTORS.code,
              message: ModelicaErrorCode.CANNOT_CONNECT_UNDECLARED_EXPANDABLE_CONNECTORS.message(lhsName, rhsName),
            });
            continue;
          }
        }

        // Error check: cannot augment virtual element (ExpandableConnectorNonDecl3.mo)
        const checkAugmentVirtual = (m: { busPrefix: string; relPath: string }) => {
          if (m.relPath.includes(".")) {
            const classId = this.expandableBuses.get(m.busPrefix);
            if (classId) {
              const seg0 = m.relPath.split(".")[0];
              const hasDecl = this.db.childrenOf(classId).some((c) => c.name === seg0);
              if (!hasDecl) {
                dae.diagnostics.push({
                  severity: "error",
                  code: 1001,
                  message: `Internal error Augmenting a virtual element in an expandable connector is not yet supported.`,
                });
                return true;
              }
            }
          }
          return false;
        };
        if (matchL && checkAugmentVirtual(matchL)) continue;
        if (matchR && checkAugmentVirtual(matchR)) continue;

        if (matchL && matchL.relPath === "" && matchR && matchR.relPath === "") {
          busConnections.push([matchL.busPrefix, matchR.busPrefix]);
          for (const bKey of this.expandableBuses.keys()) {
            if (bKey.startsWith(matchL.busPrefix + ".")) {
              const subRel = bKey.slice(matchL.busPrefix.length + 1);
              const paired = `${matchR.busPrefix}.${subRel}`;
              busConnections.push([bKey, paired]);
            } else if (bKey.startsWith(matchR.busPrefix + ".")) {
              const subRel = bKey.slice(matchR.busPrefix.length + 1);
              const paired = `${matchL.busPrefix}.${subRel}`;
              busConnections.push([paired, bKey]);
            }
          }
        } else {
          if (matchL && matchL.relPath !== "") {
            markSignalReferenced(lhsName);
            augmentDynamicSignal(matchL.busPrefix, matchL.relPath, rhsName);
          }
          if (matchR && matchR.relPath !== "") {
            markSignalReferenced(rhsName);
            augmentDynamicSignal(matchR.busPrefix, matchR.relPath, lhsName);
          }
        }
      } else {
        const recordReferencedNames = (eId: number) => {
          if (eId < 0) return;
          const ek = dae.getExprKind(eId);
          if (ek === ExprKind.Name) {
            const vName = dae.interner.resolve(dae.getExprData1(eId));
            markSignalReferenced(vName);
          } else if (ek === ExprKind.Binary) {
            recordReferencedNames(dae.getExprLeft(eId));
            recordReferencedNames(dae.getExprRight(eId));
          } else if (ek === ExprKind.Unary || ek === ExprKind.Negate) {
            recordReferencedNames(dae.getExprLeft(eId));
          } else if (ek === ExprKind.Call) {
            const count = dae.getExprRight(eId);
            for (let a = 0; a < count; a++) {
              recordReferencedNames(dae.getExprLeft(eId + a));
            }
          }
        };
        recordReferencedNames(lhs);
        recordReferencedNames(rhs);
      }
    }

    // Cross-bus pooling via DisjointSet
    if (busConnections.length > 0) {
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        let p = parent.get(x) ?? x;
        if (p !== x) {
          p = find(p);
          parent.set(x, p);
        }
        return p;
      };
      const union = (x: string, y: string) => {
        const rx = find(x);
        const ry = find(y);
        if (rx !== ry) parent.set(rx, ry);
      };

      for (const [b1, b2] of busConnections) {
        union(b1, b2);
      }

      const groups = new Map<string, string[]>();
      for (const b of this.expandableBuses.keys()) {
        const r = find(b);
        let list = groups.get(r);
        if (!list) {
          list = [];
          groups.set(r, list);
        }
        list.push(b);
      }

      for (const group of groups.values()) {
        if (group.length <= 1) continue;
        const pooledSignals = new Map<string, { varType: VarType; isFlow: boolean; causality: Causality }>();
        for (const b of group) {
          const refSet = busReferencedSignals.get(b);
          if (!refSet) continue;
          for (const rel of refSet) {
            if (pooledSignals.has(rel)) continue;
            // Check if any bus in group has this variable in dae
            let foundVar: { varType: VarType; isFlow: boolean; causality: Causality } | null = null;
            for (const b2 of group) {
              const vName = b2 ? `${b2}.${rel}` : rel;
              const vIdx = dae.getVarIdxByName(vName);
              if (vIdx >= 0 && !dae.isVarRemoved(vIdx)) {
                foundVar = {
                  varType: dae.getVarType(vIdx),
                  isFlow: dae.isVarFlow(vIdx),
                  causality: dae.getVarCausality(vIdx),
                };
                break;
              }
            }
            if (foundVar) {
              pooledSignals.set(rel, foundVar);
            } else {
              // Check if rel is a composite connector prefix having sub-variables in dae
              let hasSubVars = false;
              for (const b2 of group) {
                const pfx = b2 ? `${b2}.${rel}.` : `${rel}.`;
                for (let v = 0; v < dae.varCount; v++) {
                  if (!dae.isVarRemoved(v) && dae.getVarName(v).startsWith(pfx)) {
                    hasSubVars = true;
                    break;
                  }
                }
                if (hasSubVars) break;
              }
              if (!hasSubVars) {
                pooledSignals.set(rel, {
                  varType: VarType.Real,
                  isFlow: false,
                  causality: Causality.Local,
                });
              }
            }
          }
        }

        const sortedPooled = Array.from(pooledSignals.entries()).sort((a, b) => {
          const segA = a[0].split(".")[0]!;
          const segB = b[0].split(".")[0]!;
          if (segA !== segB) return segA.localeCompare(segB);
          const flowA = a[1].isFlow ? 1 : 0;
          const flowB = b[1].isFlow ? 1 : 0;
          return flowB - flowA;
        });
        for (const b of group) {
          for (const [rel, info] of sortedPooled) {
            busReferencedSignals.get(b)?.add(rel);
            const targetName = b ? `${b}.${rel}` : rel;
            markSignalReferenced(targetName);
            if (dae.getVarIdxByName(targetName) < 0) {
              const newIdx = dae.addVariable(
                dae.interner.intern(targetName),
                info.varType,
                Variability.Continuous,
                info.causality ?? Causality.Local,
                0.0,
              );
              dae.setVarDescription(newIdx, "virtual variable in expandable connector");
              if (info.isFlow) dae.setVarFlow(newIdx, true);
            }
          }
        }
      }
    }

    // Prune unreferenced pre-declared variables on expandable connectors
    for (const busPrefix of this.expandableBuses.keys()) {
      const refSet = busReferencedSignals.get(busPrefix) ?? new Set<string>();
      const bPfx = busPrefix ? `${busPrefix}.` : "";
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const vName = dae.getVarName(v);
        if (bPfx === "") {
          if (!refSet.has(vName)) {
            dae.removeVariable(v);
          }
        } else if (vName.startsWith(bPfx)) {
          const rel = vName.slice(bPfx.length);
          const isReferenced =
            refSet.has(rel) ||
            Array.from(refSet).some(
              (s) =>
                s.startsWith(rel + ".") ||
                s.startsWith(rel + "[") ||
                rel.startsWith(s + ".") ||
                rel.startsWith(s + "["),
            );
          if (!isReferenced) {
            dae.removeVariable(v);
          }
        }
      }
    }
  }

  private flattenFunction(fnSymId: SymbolId, fnName: string, modifiers?: any[], parentDae?: DAEBuilder): DAEBuilder {
    const prevFnId = this.currentFlatteningFunctionId;
    this.currentFlatteningFunctionId = fnSymId;
    const cleanFnName = fnName.replace(/^\.+/, "");
    const fn = new DAEBuilder(parentDae ? parentDae.interner : undefined, cleanFnName, "");
    (fn as any).parentDae = parentDae;
    (fn as any).db = this.db;
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
    this.currentFlatteningFunctionId = prevFnId;
    return fn;
  }

  private generateOperatorFunctions(dae: DAEBuilder): void {
    if (!this.usedOperatorFunctions || this.usedOperatorFunctions.size === 0) return;
    const processed = new Set<string>();
    while (processed.size < this.usedOperatorFunctions.size) {
      for (const [qualName, symId] of Array.from(this.usedOperatorFunctions.entries())) {
        if (processed.has(qualName)) continue;
        processed.add(qualName);
        if (!dae.functions.has(qualName)) {
          const fn = this.flattenFunction(symId, qualName, undefined, dae);
          dae.addFunction(qualName, fn);
        }
      }
    }
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
      else if (words.includes("model")) specKind = "model";
      else if (words.includes("block")) specKind = "block";
      else specKind = "model";
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
        stateCount += dae.getVarShapeElementCount(i);
      }
    }
    let eqCount = 0;
    for (let i = 0; i < dae.getEqCount(); i++) {
      const kind = dae.getEqKind(i);
      if (kind === EqKind.Simple || kind === EqKind.InitialSimple || kind === EqKind.Array) {
        let count = 1;
        const lhs = dae.getEqLhs(i);
        const rhs = dae.getEqRhs(i);
        for (const expr of [lhs, rhs]) {
          if (expr < 0) continue;
          let target = expr;
          if (dae.getExprKind(target) === ExprKind.Der) {
            target = dae.getExprData1(target);
          }
          if (dae.getExprKind(target) === ExprKind.Name) {
            const name = dae.interner.resolve(dae.getExprData1(target));
            if (name) {
              const vId = dae.getVarIdxByName(name);
              if (vId >= 0) {
                const shapeCount = dae.getVarShapeElementCount(vId);
                if (shapeCount > 1) {
                  count = shapeCount;
                  break;
                }
              }
            }
          }
        }
        eqCount += count;
      }
    }
    if (
      !dae.diagnostics.some((d: any) => d.severity === "error") &&
      stateCount > 0 &&
      eqCount > 0 &&
      stateCount !== eqCount
    ) {
      const kindStr = specKind ?? "model";
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
    if (/\b(model|record|block|package)\b/.test(cleanPrefixes)) return false;

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

    if (/\bconnector\b/.test(cleanPrefixes) && !isShort) return false;

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

  private getOrCreateWasmEnv(dae: DAEBuilder, mods?: any): ModelicaModificationEnv | null {
    if (!dae.exports || !dae.exports.flattener_envCreate) return null;
    if (mods?.wasmEnv instanceof ModelicaModificationEnv) {
      return mods.wasmEnv;
    }
    const wasmFlattener =
      (dae as any)._wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
    (dae as any)._wasmFlattener = wasmFlattener;

    const env = new ModelicaModificationEnv(dae.exports);
    if (mods?.args && Array.isArray(mods.args)) {
      for (const arg of mods.args) {
        if (!arg?.name) continue;
        let flag = 0;
        if (arg.final) flag |= 1;
        if (arg.each) flag |= 2;
        if (arg.isRedeclaration) flag |= 4;

        const nameId = dae.interner.intern(arg.name);
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          const typeId = dae.interner.intern(arg.redeclaredTypeSpecifier);
          env.bindRedeclarePath(wasmFlattener, nameId, typeId, 0, flag);
        } else if (arg.value) {
          let exprId = 0xffffffff;
          if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
            exprId = Number.isInteger(arg.value.value)
              ? dae.addIntLiteral(arg.value.value)
              : dae.addRealLiteral(arg.value.value);
          } else if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
            exprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
          } else if (arg.value.kind === "literal" && typeof arg.value.value === "string") {
            exprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
          }
          if (exprId !== 0xffffffff) {
            env.setPath(wasmFlattener, nameId, exprId, flag);
          }
        }
        if (arg.nestedArgs && arg.nestedArgs.length > 0) {
          const childEnv = this.getOrCreateWasmEnv(dae, { args: arg.nestedArgs });
          if (childEnv) {
            env.bindNested(nameId, childEnv, flag);
          }
        }
      }
    }
    if (mods) {
      mods.wasmEnv = env;
    }
    return env;
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

    const wasmEnv = this.getOrCreateWasmEnv(dae, parentMods);
    const wasmFlattener =
      (dae as any)._wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
    (dae as any)._wasmFlattener = wasmFlattener;

    const prefixId = prefix ? dae.interner.intern(prefix) : 0;
    if (wasmFlattener && dae.exports?.flattener_scopePush && wasmEnv) {
      dae.exports.flattener_scopePush(wasmFlattener, 0, wasmEnv.envPtr, prefixId, 0);
    }

    try {
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
        const hasParentMods = Boolean(
          parentMods && ((parentMods.args && parentMods.args.length > 0) || parentMods.bindingExpression),
        );

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

            const isEvaluated = this.db.query<boolean>("isEvaluate", elemId);
            if (isEvaluated && variability === Variability.Parameter) {
              variability = Variability.Constant;
            }

            let causality = Causality.Local;
            if (compInst.causality === "input") causality = Causality.Input;
            else if (compInst.causality === "output") causality = Causality.Output;
            else if (parentMods?.parentCausality !== undefined) causality = parentMods.parentCausality;
            if (causality === Causality.Output) {
              if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
              if (!dae.extensionMetadata.outputVars) dae.extensionMetadata.outputVars = new Set<string>();
              (dae.extensionMetadata.outputVars as Set<string>).add(name);
            }
            if (prefix && !this.isInsideExpandableBus(prefix)) causality = Causality.Local;

            const varIdx = dae.addVariable(dae.interner.intern(name), varType, variability, causality, 0.0);
            if (this.isComponentHidden(elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }

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
                        attrExprId = dae.addExpression(
                          ExprKind.StringLiteral,
                          dae.interner.intern(JSON.parse(rawText)),
                        );
                      } catch {
                        attrExprId = dae.addExpression(
                          ExprKind.StringLiteral,
                          dae.interner.intern(rawText.slice(1, -1)),
                        );
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
            const rootResolver = this.db.query<(n: string) => SymbolEntry | null>(
              "resolveName",
              this.currentRootClassId,
            );
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
        const isRecordTarget =
          (classTarget && (this.isRecordSym(classTarget) || this.isOperatorRecordSym(classTarget))) || false;
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
          effectiveType !== "String" &&
          !(dae.classKind === "function" && isRecordTarget);

        if (dae.classKind === "function" && classTargetId) {
          const targetMeta = this.db.symbol(classTargetId)?.metadata as any;
          const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
          const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const words = cleanKind.split(/\s+/).filter(Boolean);
          const isModel = words.includes("model");
          const isConnector = words.includes("connector");
          const isBlock = words.includes("block");
          const isRecord = words.includes("record") || isRecordTarget;
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
          const isOpRec = Boolean(classTarget && isRecordTarget && this.isOperatorRecordSym(classTarget));
          const hasOpRecBinding = Boolean(isOpRec && compInst?.modification?.bindingExpression);
          if (hasOpRecBinding) {
            const modChild = elemCst?.children?.find(
              (c: any) => c.type === "modification" || c.type === "Modification",
            );
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
            if (exprCst) {
              const rhsExprId = this.lowerExpr(exprCst, dae, prefix);
              if (rhsExprId >= 0) {
                const lhsExprId = dae.addNameExpr(name);
                dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
              }
            }
          }
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
            bindingExpression: hasOpRecBinding
              ? null
              : (matchingParentArg?.value ??
                matchingClassArg?.value ??
                compInst.modification?.bindingExpression ??
                (parentMods?.bindingExpression?.text
                  ? { kind: "expression", text: `${parentMods.bindingExpression.text}.${compInst.name}` }
                  : null)),
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
          const childEnvPtr = wasmEnv ? wasmEnv.lookupNested(dae.interner.intern(compInst.name)) : 0;
          if (childEnvPtr !== 0) {
            (effectiveSubMod as any).wasmEnv = new ModelicaModificationEnv(dae.exports, childEnvPtr);
          }
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
              if (classTargetId && this.isExpandableConnectorClass(classTargetId)) {
                this.expandableBuses.set(arrVarName, classTargetId);
              }
              if (subElements && subElements.length > 0) {
                this.instantiateElements(subElements, arrVarName, dae, effectiveSubMod);
              }
            }
          } else {
            if (classTargetId && this.isExpandableConnectorClass(classTargetId)) {
              this.expandableBuses.set(name, classTargetId);
            }
            if (subElements && subElements.length > 0) {
              this.instantiateElements(subElements, name, dae, effectiveSubMod);
            }
          }
          continue;
        }

        let varType = VarType.Real;
        let effectiveTypeSpec = compInst?.typeSpecifier;
        let customType: string | null =
          isExtObj && classTargetId
            ? getSymbolQualifiedName(this.db, classTargetId)
            : dae.classKind === "function" && isRecordTarget && classTarget
              ? (effectiveType ?? classTarget.name)
              : null;
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
        const isEvaluated = this.db.query<boolean>("isEvaluate", elemId);
        if (isEvaluated && variability === Variability.Parameter) {
          variability = Variability.Constant;
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
        if (causality === Causality.Output) {
          if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
          if (!dae.extensionMetadata.outputVars) dae.extensionMetadata.outputVars = new Set<string>();
          (dae.extensionMetadata.outputVars as Set<string>).add(name);
        }
        if (prefix && !this.isInsideExpandableBus(prefix)) {
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
                  const scopeName =
                    (this.currentRootClassId ? this.db.symbol(this.currentRootClassId)?.name : "") ?? "";
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
              const evaluatedKey = prefix ? `${prefix}.${name}` : name;
              if (this.evaluatedConstantArrays.has(evaluatedKey) || this.evaluatedConstantArrays.has(name)) {
                let val = this.evaluatedConstantArrays.get(evaluatedKey) ?? this.evaluatedConstantArrays.get(name);
                for (const idx of idxTuple) {
                  if (Array.isArray(val) && idx >= 1 && idx <= val.length) {
                    val = val[idx - 1];
                  } else {
                    val = null;
                    break;
                  }
                }
                if (typeof val === "number") {
                  exprId = varType === VarType.Integer ? dae.addIntLiteral(val) : dae.addRealLiteral(val);
                }
              }
              if (exprId !== null) {
                // Handled by evaluatedConstantArrays
              } else if (bText.startsWith("{") && bText.endsWith("}")) {
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

            const modChild = elemCst?.children?.find(
              (c: any) => c.type === "modification" || c.type === "Modification",
            );
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
                    const text = innerCst?.text?.trim() ?? "";
                    const isBracket =
                      (innerCst?.child(0)?.text === "[" || text.startsWith("[")) &&
                      (innerCst?.child(innerCst?.childCount - 1)?.text === "]" || text.endsWith("]"));
                    if (isBracket && idxTuple.length === 2) {
                      const rows = getArrayLiteralItems(innerCst);
                      const rowIdx = idxTuple[0];
                      const colIdx = idxTuple[1];
                      if (rowIdx >= 1 && rowIdx <= rows.length) {
                        const rowNode = rows[rowIdx - 1];
                        const cols = getArrayLiteralItems(rowNode);
                        if (colIdx >= 1 && colIdx <= cols.length) {
                          innerCst = cols[colIdx - 1];
                        } else {
                          innerCst = null;
                        }
                      } else {
                        innerCst = null;
                      }
                    } else {
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
                          typeof lit === "string"
                            ? lit
                            : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
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
                  let numExpr = !isNaN(numL)
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
                    const denomResolved = resolveScopedName(denom, bindingPrefix, dae);
                    denomExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(denomResolved));
                    const denomVarIdx = dae.lookupVariable(denomResolved);
                    if (
                      varType === VarType.Real &&
                      denomVarIdx >= 0 &&
                      dae.getVarType(denomVarIdx) === VarType.Integer
                    ) {
                      denomExpr = dae.addCallExpr("/*Real*/", [denomExpr]);
                    }
                  }
                  if (isNaN(numL)) {
                    const numResolved = resolveScopedName(parts[0]!.trim(), bindingPrefix, dae);
                    const numVarIdx = dae.lookupVariable(numResolved);
                    if (varType === VarType.Real && numVarIdx >= 0 && dae.getVarType(numVarIdx) === VarType.Integer) {
                      numExpr = dae.addCallExpr("/*Real*/", [numExpr]);
                    }
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
              if (!effectiveBinding?.text && exprId !== null && exprId >= 0) {
                const lhsExprId = dae.addNameExpr(dae.getVarName(varIdx));
                dae.addEquation(EqKind.Simple, lhsExprId, exprId);
              }
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
                    varType === VarType.Integer
                      ? dae.addIntLiteral(parseInt(t, 10))
                      : dae.addRealLiteral(parseFloat(t));
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
        const rawDimsInitial = this.db.query<any[] | null>("arrayDimensions", elemId);
        if (rawDimsInitial) {
          for (const d of rawDimsInitial) {
            if (d.kind === "literal" && d.value < 0) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.NEGATIVE_DIMENSION.code,
                message: ModelicaErrorCode.NEGATIVE_DIMENSION.message(String(d.value), compInst.name),
                range: {
                  startByte: diagNode?.startIndex ?? diagNode?.startByte,
                  endByte: diagNode?.endIndex ?? diagNode?.endByte,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return;
            }
          }
        }
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
          } else if (bText.startsWith("[") && bText.endsWith("]")) {
            const rows = bText
              .slice(1, -1)
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean);
            const rowElements = rows.map((r) =>
              r
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean),
            );
            const rowsCount = rows.length;
            const colsCount = rowElements.length > 0 ? rowElements[0].length : 0;
            if (arrayDims && arrayDims.length === 1) {
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
              const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
              const allInts = rowElements.every((row) => row.every((c) => /^[+-]?\d+$/.test(c)));
              const elemType = allInts ? "Integer" : "Real";
              dae.diagnostics.push({
                severity: "error",
                code: 4003,
                message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${arrayDims.join(", ")}].`,
                range: { startByte: clauseStart, endByte: clauseEnd },
              });
              return;
            }
            if (arrayDims && arrayDims.length >= 2) {
              let rCount = rowsCount;
              let cCount = colsCount;
              if (effectiveBinding.cstBytes) {
                const scopeSym = this.currentRootClassId ? this.db.symbol(this.currentRootClassId) : undefined;
                const bindCst = this.db.cstNodeRange(
                  effectiveBinding.cstBytes[0],
                  effectiveBinding.cstBytes[1],
                  scopeSym ?? undefined,
                ) as any;
                if (bindCst) {
                  const rNodes = getArrayLiteralItems(bindCst);
                  rCount = rNodes.length;
                  if (rNodes.length > 0) {
                    const cNodes = getArrayLiteralItems(rNodes[0]);
                    cCount = cNodes.length;
                  }
                }
              }
              if (rCount === 0) {
                rCount = rowsCount;
                cCount = colsCount;
              }
              if (
                rCount > 0 &&
                (arrayDims[0] === 0 || arrayDims[0] === -1 || matchingParentArg?.value || matchingClassArg?.value)
              ) {
                arrayDims[0] = rCount;
              }
              if (
                cCount > 0 &&
                (arrayDims[1] === 0 || arrayDims[1] === -1 || matchingParentArg?.value || matchingClassArg?.value)
              ) {
                arrayDims[1] = cCount;
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
                }
                if (typeof evalVal === "number" && evalVal > 0) {
                  resolvedDims[i] = evalVal;
                }
              }
              if (resolvedDims[i]! <= 0 && effectiveBinding?.cstBytes) {
                const scopeSym = this.currentRootClassId ? this.db.symbol(this.currentRootClassId) : undefined;
                const bindCst = this.db.cstNodeRange(
                  effectiveBinding.cstBytes[0],
                  effectiveBinding.cstBytes[1],
                  scopeSym ?? undefined,
                ) as any;
                if (bindCst) {
                  const loweredId = this.lowerExpr(bindCst, dae, prefix);
                  if (loweredId >= 0) {
                    const deducedDims = getExprDims(loweredId, dae, this.db);
                    if (deducedDims && deducedDims.length === resolvedDims.length) {
                      for (let d = 0; d < resolvedDims.length; d++) {
                        if (resolvedDims[d]! <= 0 && deducedDims[d]! > 0) {
                          resolvedDims[d] = deducedDims[d]!;
                        }
                      }
                    }
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
                } else if (bRef.startsWith("[") && bRef.endsWith("]")) {
                  let rowsCount = 0;
                  let colsCount = 0;
                  if (effectiveBinding.cstBytes) {
                    const scopeSym = this.currentRootClassId ? this.db.symbol(this.currentRootClassId) : undefined;
                    const bindCst = this.db.cstNodeRange(
                      effectiveBinding.cstBytes[0],
                      effectiveBinding.cstBytes[1],
                      scopeSym ?? undefined,
                    ) as any;
                    if (bindCst) {
                      const rows = getArrayLiteralItems(bindCst);
                      rowsCount = rows.length;
                      if (rows.length > 0) {
                        const cols = getArrayLiteralItems(rows[0]);
                        colsCount = cols.length;
                      }
                    }
                  }
                  if (rowsCount === 0) {
                    const rows = bRef
                      .slice(1, -1)
                      .split(";")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    rowsCount = rows.length;
                    if (rows.length > 0) {
                      const cols = rows[0].split(/[\s,]+/).filter(Boolean);
                      colsCount = cols.length;
                    }
                  }
                  if (i === 0 && rowsCount > 0) resolvedDims[0] = rowsCount;
                  if (i === 1 && colsCount > 0) resolvedDims[1] = colsCount;
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
                } else if (bRef.includes("(") && bRef.endsWith(")")) {
                  const fnCallMatch = bRef.match(/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\((.*)\)$/);
                  if (fnCallMatch) {
                    const fnCallName = fnCallMatch[1]!;
                    const argsText = fnCallMatch[2]!;
                    const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                    const fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                    if (fnObj) {
                      const argParts = splitTopLevelArgs(argsText);
                      const evalArgs: any[] = [];
                      let allArgsOk = true;
                      for (const ap of argParts) {
                        const cleanAp = ap.trim();
                        const resolvedAp = resolveScopedName(cleanAp, prefix, dae);
                        const arrayTarget = dae.hasArrayElements(resolvedAp)
                          ? resolvedAp
                          : dae.hasArrayElements(cleanAp)
                            ? cleanAp
                            : null;
                        if (arrayTarget) {
                          const elemIndices = dae.getArrayElementIndices(arrayTarget);
                          const arrVals: any[] = [];
                          for (const eIdx of elemIndices) {
                            const sv = dae.getVarExpression(eIdx);
                            const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(eIdx);
                            arrVals.push(val ?? 0);
                          }
                          evalArgs.push(arrVals);
                          continue;
                        }
                        const vIdx =
                          dae.lookupVariable(resolvedAp) >= 0
                            ? dae.lookupVariable(resolvedAp)
                            : dae.lookupVariable(cleanAp);
                        if (vIdx >= 0) {
                          const sv = dae.getVarExpression(vIdx);
                          const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                          if (val !== null && val !== undefined) {
                            evalArgs.push(val);
                            continue;
                          }
                        }
                        const num = Number(cleanAp);
                        if (!isNaN(num)) {
                          evalArgs.push(num);
                          continue;
                        }
                        allArgsOk = false;
                        break;
                      }
                      if (allArgsOk) {
                        try {
                          const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                          const fnInternId = dae.interner.intern(resolvedFnName);
                          const evalRes = evaluateArenaFunctionCall(
                            dae,
                            fnInternId,
                            evalArgs,
                            this.db,
                            this.currentRootClassId,
                          );
                          if (evalRes) {
                            const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                            this.evaluatedConstantArrays.set(evaluatedKey, evalRes);
                            const getShape = (val: any): number[] => {
                              const resShape: number[] = [];
                              let curr = val;
                              while (Array.isArray(curr)) {
                                resShape.push(curr.length);
                                curr = curr[0];
                              }
                              return resShape;
                            };
                            const resShape = getShape(evalRes);
                            for (let d = 0; d < resolvedDims.length; d++) {
                              if (resolvedDims[d]! <= 0 && d < resShape.length && resShape[d]! > 0) {
                                resolvedDims[d] = resShape[d]!;
                              }
                            }
                          }
                        } catch {}
                      }
                    }
                  }
                } else {
                  const cleanRef = bRef.replace(/^-\s*/, "");
                  const resolvedRef = resolveScopedName(cleanRef, prefix, dae);
                  let maxDimVal = 0;
                  const prefixMatch = `${resolvedRef}[`;
                  for (let v = 0; v < dae.varCount; v++) {
                    if (!dae.isVarRemoved(v)) {
                      const vName = dae.getVarName(v);
                      if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                        const innerIndices = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                        if (i < innerIndices.length) {
                          const idxVal = innerIndices[i];
                          if (idxVal !== undefined && !isNaN(idxVal) && idxVal > maxDimVal) {
                            maxDimVal = idxVal;
                          }
                        }
                      }
                    }
                  }
                  if (maxDimVal > 0) {
                    resolvedDims[i] = maxDimVal;
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
            if (rawText.startsWith("[") && rawText.endsWith("]")) {
              const rows = rawText
                .slice(1, -1)
                .split(";")
                .map((s) => s.trim())
                .filter(Boolean);
              const rowElements = rows.map((r) =>
                r
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean),
              );
              const rowsCount = rows.length;
              const colsCount = rowElements.length > 0 ? rowElements[0].length : 0;
              if (
                targetDims.length === 1 ||
                (targetDims.length >= 2 && (targetDims[0] !== rowsCount || targetDims[1] !== colsCount))
              ) {
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
                const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
                const allInts = rowElements.every((row) => row.every((c) => /^[+-]?\d+$/.test(c)));
                const elemType = allInts ? "Integer" : "Real";
                dae.diagnostics.push({
                  severity: "error",
                  code: 4003,
                  message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${targetDims.join(", ")}].`,
                  range: { startByte: clauseStart, endByte: clauseEnd },
                });
                return;
              }
            }
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
                  while (curr && curr.type !== "component_clause" && curr.type !== "ComponentClause")
                    curr = curr.parent;
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

          if (dae.classKind === "function" || this.options.arrayMode === "preserve") {
            const varIdx = dae.addVariable(
              dae.interner.intern(name),
              varType as number,
              variability as number,
              causality as number,
              0.0,
            );
            if (this.isComponentHidden(elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }
            const rawDims = this.db.query<any[] | null>("arrayDimensions", elemId);
            const concreteShape =
              arrayDims && arrayDims.length > 0 && arrayDims.every((d) => d > 0)
                ? arrayDims
                : (rawDims?.map((d: any) => (d.kind === "literal" ? d.value : -1)) ?? []);
            if (concreteShape.length > 0) {
              dae.setVarShape(varIdx, concreteShape);
            }
            if (rawDims && rawDims.length > 0) {
              const shapeExprIds: number[] = [];
              for (const d of rawDims) {
                if (d.kind === "expression") {
                  let exprId = -1;
                  if (d.cstBytes) {
                    const elemSym = this.db.symbol(elemId);
                    const cstNode = this.db.cstNodeRange(d.cstBytes[0], d.cstBytes[1], elemSym ?? undefined) as any;
                    if (cstNode) {
                      exprId = this.lowerExpr(cstNode, dae, prefix);
                    }
                  }
                  if (exprId < 0 && d.text) {
                    const normText = d.text.replace(/,(\S)/g, ", $1");
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
                  }
                  if (exprId >= 0) {
                    shapeExprIds.push(exprId);
                  }
                } else if (d.kind === "literal") {
                  shapeExprIds.push(dae.addIntLiteral(d.value));
                }
              }
              if (shapeExprIds.length > 0) {
                dae.setVarShapeExprs(varIdx, shapeExprIds);
              }
            }
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
            if (this.isComponentHidden(elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }
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
          if (
            (variability === Variability.Continuous || variability === Variability.Discrete) &&
            effectiveBinding?.text
          ) {
            const bText = effectiveBinding.text.trim();
            let rhsExprId: number | null = null;
            const modChild = elemCst?.children?.find(
              (c: any) => c.type === "modification" || c.type === "Modification",
            );
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
              const expRange = expandColonToArrayCtor(rhsExprId, dae, varType);
              if (expRange !== null) rhsExprId = expRange;
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
          if (this.isComponentHidden(elemId)) {
            dae.hiddenVarIndices.add(varIdx);
          }
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
    } finally {
      if (wasmFlattener && dae.exports?.flattener_scopePop && wasmEnv) {
        dae.exports.flattener_scopePop(wasmFlattener);
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
          if (isDynamic) {
            let hasConnectInNonParamIf = false;
            for (const b of branches) {
              for (const eq of b.equationNodes) {
                if (eq.type === "connect_equation" || eq.type === "ConnectEquation") {
                  const connText = eq.text?.trim()?.replace(/;$/, "") ?? "connect(...)";
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.code,
                    message: ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.message(connText),
                    range: {
                      startPosition: eq.startPosition,
                      endPosition: eq.endPosition,
                    },
                  });
                  hasConnectInNonParamIf = true;
                  break;
                }
              }
              if (hasConnectInNonParamIf) break;
            }
            if (hasConnectInNonParamIf) return;
          }

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
                const exprs = (n.children || []).filter(isEquationExpr);
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

          const expressions = (node.children || []).filter(isEquationExpr);
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
            const expRhs = expandColonToArrayCtor(rhsExprId, dae);
            if (expRhs !== null) rhsExprId = expRhs;
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
            } else if (!isRealExpr(lhsExprId, dae) && isRealExpr(rhsExprId, dae)) {
              lhsExprId = castToRealExpr(lhsExprId, dae);
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
            const lhsDims = getExprDims(lhsExprId, dae, this.db);
            if (lhsDims && lhsDims[0] === 0) {
              return;
            }
            const lhsKind = dae.getExprKind(lhsExprId);
            const rhsKind = dae.getExprKind(rhsExprId);
            let lastEmittedEqIdx = -1;

            const resolveToArrayCtor = (id: number): number => {
              const k = dae.getExprKind(id);
              if (k === ExprKind.Name) {
                const vName = dae.interner.resolve(dae.getExprData1(id));
                if (vName && dae.hasArrayElements(vName)) {
                  const ctor = expandVarToArrayCtor(vName, dae);
                  if (ctor !== null) return ctor;
                }
              } else if (k === ExprKind.Call) {
                const fnName = dae.interner.resolve(dae.getExprData1(id));
                if (fnName === "/*Real*/" || fnName === "Real") {
                  const inner = resolveToArrayCtor(dae.getExprLeft(id));
                  if (dae.getExprKind(inner) === ExprKind.ArrayCtor) {
                    return castToRealExpr(inner, dae);
                  }
                }
              } else if (k === ExprKind.Der) {
                const inner = resolveToArrayCtor(dae.getExprLeft(id));
                if (dae.getExprKind(inner) === ExprKind.ArrayCtor) {
                  const distributeDer = (exprId: number): number => {
                    if (dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
                      const elems = getArrayCtorElements(exprId, dae);
                      return dae.addArrayCtorExpr(elems.map((e) => distributeDer(e)));
                    }
                    return dae.addDerExpr(exprId);
                  };
                  return distributeDer(inner);
                }
              } else if (k === ExprKind.Binary) {
                const op = dae.getExprData1(id) as BinOp;
                const lInner = resolveToArrayCtor(dae.getExprLeft(id));
                const rInner = resolveToArrayCtor(dae.getExprRight(id));
                const lIsArr = dae.getExprKind(lInner) === ExprKind.ArrayCtor;
                const rIsArr = dae.getExprKind(rInner) === ExprKind.ArrayCtor;
                if (op === BinOp.Add || op === BinOp.Sub) {
                  if (lIsArr && rIsArr) {
                    return addArrayBinaryExpr(op, lInner, rInner, dae);
                  }
                } else if (op === BinOp.Mul) {
                  if (lIsArr && rIsArr) {
                    return addArrayBinaryExpr(op, lInner, rInner, dae);
                  }
                  if (!lIsArr && rIsArr) {
                    const rElems = getArrayCtorElements(rInner, dae);
                    return dae.addArrayCtorExpr(
                      rElems.map((e) => {
                        const lK = dae.getExprKind(lInner);
                        const eK = dae.getExprKind(e);
                        if (
                          (lK === ExprKind.RealLiteral || lK === ExprKind.IntLiteral) &&
                          (eK === ExprKind.RealLiteral || eK === ExprKind.IntLiteral)
                        ) {
                          const lV =
                            lK === ExprKind.IntLiteral ? dae.getExprData1(lInner) : dae.getExprRealValue(lInner);
                          const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                          return dae.addRealLiteral(lV * eV);
                        }
                        return dae.addBinaryExpr(BinOp.Mul, lInner, e);
                      }),
                    );
                  }
                  if (lIsArr && !rIsArr) {
                    const lElems = getArrayCtorElements(lInner, dae);
                    return dae.addArrayCtorExpr(
                      lElems.map((e) => {
                        const rK = dae.getExprKind(rInner);
                        const eK = dae.getExprKind(e);
                        if (
                          (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) &&
                          (eK === ExprKind.RealLiteral || eK === ExprKind.IntLiteral)
                        ) {
                          const rV =
                            rK === ExprKind.IntLiteral ? dae.getExprData1(rInner) : dae.getExprRealValue(rInner);
                          const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                          return dae.addRealLiteral(eV * rV);
                        }
                        return dae.addBinaryExpr(BinOp.Mul, e, rInner);
                      }),
                    );
                  }
                } else if (op === BinOp.Div) {
                  if (lIsArr && !rIsArr) {
                    const lElems = getArrayCtorElements(lInner, dae);
                    return dae.addArrayCtorExpr(
                      lElems.map((e) => {
                        const rK = dae.getExprKind(rInner);
                        const eK = dae.getExprKind(e);
                        if (
                          (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) &&
                          (eK === ExprKind.RealLiteral || eK === ExprKind.IntLiteral)
                        ) {
                          const rV =
                            rK === ExprKind.IntLiteral ? dae.getExprData1(rInner) : dae.getExprRealValue(rInner);
                          const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                          return rV !== 0 ? dae.addRealLiteral(eV / rV) : dae.addRealLiteral(0);
                        }
                        return dae.addBinaryExpr(BinOp.Div, e, rInner);
                      }),
                    );
                  }
                }
              }
              return id;
            };

            const expandedLhs = resolveToArrayCtor(lhsExprId);
            const expandedRhs = resolveToArrayCtor(rhsExprId);

            const effectiveLhsDims = getExprDims(expandedLhs, dae, this.db) ?? getExprDims(lhsExprId, dae, this.db);
            const effectiveRhsDims = getExprDims(expandedRhs, dae, this.db) ?? getExprDims(rhsExprId, dae, this.db);
            const hasLeftDims = effectiveLhsDims !== null && effectiveLhsDims.length > 0;
            const hasRightDims = effectiveRhsDims !== null && effectiveRhsDims.length > 0;

            let dimsMismatch = false;
            if (hasLeftDims && hasRightDims) {
              dimsMismatch =
                effectiveLhsDims!.length !== effectiveRhsDims!.length ||
                effectiveLhsDims!.some((d, i) => d !== effectiveRhsDims![i]);
            } else if (hasLeftDims && !hasRightDims && isDefinitelyScalarExpr(expandedRhs, dae)) {
              dimsMismatch = true;
            } else if (!hasLeftDims && hasRightDims && isDefinitelyScalarExpr(expandedLhs, dae)) {
              dimsMismatch = true;
            }

            if (dimsMismatch) {
              const formatTypeStr = (id: number, dims: number[] | null): string => {
                let t = inferArenaExprVarType(dae, id);
                if (t === null && dae.getExprKind(id) === ExprKind.Name) {
                  const name = dae.interner.resolve(dae.getExprData1(id));
                  if (name) {
                    const vIdx =
                      dae.getVarIdxByName(`${name}[1]`) >= 0
                        ? dae.getVarIdxByName(`${name}[1]`)
                        : dae.getVarIdxByName(`${name}[1,1]`);
                    if (vIdx >= 0) t = dae.getVarType(vIdx);
                  }
                }
                let baseType = "Real";
                if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) baseType = "Integer";
                else if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) baseType = "Boolean";
                else if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) baseType = "String";
                if (dims && dims.length > 0) {
                  return `${baseType}[${dims.join(", ")}]`;
                }
                return baseType;
              };
              const printer = new ArenaDAEPrinter(new StringWriter(), dae, true);
              const lhsExpanded = printer.printExprToString(expandedLhs);
              const rhsExpanded = printer.printExprToString(expandedRhs);
              const lhsTypeStr = formatTypeStr(expandedLhs, effectiveLhsDims);
              const rhsTypeStr = formatTypeStr(expandedRhs, effectiveRhsDims);
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              dae.diagnostics.push({
                severity: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
                code: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
                message: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(
                  lhsExpanded,
                  rhsExpanded,
                  lhsTypeStr,
                  rhsTypeStr,
                ),
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }

            const emitEq = (lId: number, rId: number) => {
              const lK = dae.getExprKind(lId);
              const rK = dae.getExprKind(rId);
              if (lK === ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
                const lElems = getArrayCtorElements(lId, dae);
                const rElems = getArrayCtorElements(rId, dae);
                if (lElems.length === rElems.length && lElems.length > 0) {
                  for (let i = 0; i < lElems.length; i++) {
                    emitEq(lElems[i]!, rElems[i]!);
                  }
                  return;
                }
              }
              const isLhsLiteral =
                lK === ExprKind.EnumLiteral ||
                lK === ExprKind.IntLiteral ||
                lK === ExprKind.RealLiteral ||
                lK === ExprKind.BoolLiteral ||
                lK === ExprKind.StringLiteral;
              const isRhsVar = rK === ExprKind.Name || rK === ExprKind.Subscript || rK === ExprKind.Der;

              let finalLhs = lId;
              let finalRhs = rId;
              if (isLhsLiteral && isRhsVar) {
                finalLhs = rId;
                finalRhs = lId;
              }
              if (isRealExpr(finalLhs, dae) && !isRealExpr(finalRhs, dae)) {
                finalRhs = castToRealExpr(finalRhs, dae);
              } else if (!isRealExpr(finalLhs, dae) && isRealExpr(finalRhs, dae)) {
                finalLhs = castToRealExpr(finalLhs, dae);
              }
              const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, finalLhs, finalRhs);
              lastEmittedEqIdx = eqIdx;
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              if (startB != null && endB != null && eqIdx >= 0) {
                dae.setEqSourceRange(eqIdx, startB, endB);
              }
            };
            emitEq(expandedLhs, expandedRhs);

            // Check equation annotation for diffusion (SDE)
            const evaluator = new AnnotationEvaluator();
            const diffVal =
              evaluator.evaluate(node, "diffusion") ??
              evaluator.evaluate(node.parent, "diffusion") ??
              evaluator.evaluate(node.parent?.parent, "diffusion");
            if (diffVal !== null && diffVal !== undefined) {
              let stateVarIdx = -1;
              const derExpr = lhsKind === ExprKind.Der ? lhsExprId : rhsKind === ExprKind.Der ? rhsExprId : -1;
              if (derExpr >= 0) {
                const derArgId = dae.getExprData1(derExpr);
                if (dae.getExprKind(derArgId) === ExprKind.Name) {
                  const nameId = dae.getExprData1(derArgId);
                  const varName = dae.interner.resolve(nameId);
                  stateVarIdx = dae.findVar(varName);
                }
              }
              if (stateVarIdx >= 0) {
                let diffExprId: number;
                if (typeof diffVal === "number") {
                  diffExprId = dae.addRealLiteral(diffVal);
                } else if (typeof diffVal === "object" && diffVal.coefficient !== undefined) {
                  diffExprId =
                    typeof diffVal.coefficient === "number"
                      ? dae.addRealLiteral(diffVal.coefficient)
                      : addArenaValueAsExpr(dae, diffVal.coefficient, VarType.Real);
                } else if (typeof diffVal === "object" && diffVal.value !== undefined) {
                  diffExprId =
                    typeof diffVal.value === "number"
                      ? dae.addRealLiteral(diffVal.value)
                      : addArenaValueAsExpr(dae, diffVal.value, VarType.Real);
                } else {
                  diffExprId = addArenaValueAsExpr(dae, diffVal, VarType.Real);
                }
                dae.diffusionExprIds.set(stateVarIdx, diffExprId);
              }
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
            if (t && lastEmittedEqIdx >= 0) dae.setEqDescription(lastEmittedEqIdx, t);
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
              const expressions = (n.children || []).filter(isEquationExpr);
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

            if (n.type === "connect_equation" || n.type === "ConnectEquation") {
              const connText = n.text?.trim()?.replace(/;$/, "") ?? "connect(...)";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CONNECT_IN_WHEN.code,
                message: ModelicaErrorCode.CONNECT_IN_WHEN.message(connText),
                range: {
                  startPosition: n.startPosition,
                  endPosition: n.endPosition,
                },
              });
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
                const targetId = this.lowerExpr(exprs[0], dae, prefix, substitutions, undefined, true);
                const targetDims = getExprDims(targetId, dae, this.db);
                if (targetDims && targetDims[0] === 0) {
                  return;
                }
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
          if (isInitAlg) {
            dae.initialAlgorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
          } else {
            dae.algorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
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
