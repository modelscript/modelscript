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
  simplifyArenaExpr,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
  type ArenaStateMachine,
  type ArenaStateMachineState,
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

export type FlattenerBackend = "ts" | "wasm" | "hybrid" | "diff";

export interface FlattenOptions {
  backend?: FlattenerBackend | undefined;
  arrayMode?: ("scalarize" | "preserve") | undefined;
  functionInlining?: boolean | undefined;
  omcCompatibility?: boolean | undefined;
  eliminateAliases?: boolean | undefined;
  useWasmKernel?: boolean | undefined;
  scalarizeBindings?: boolean | undefined;
  flowThreshold?: number | undefined;
  intEnumConversion?: boolean | undefined;
}

function stripArraySubscripts(s: string): string {
  let result = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[") {
      depth++;
    } else if (s[i] === "]") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += s[i];
    }
  }
  return result;
}

function stripComments(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i + 2);
      i = nl === -1 ? s.length : nl + 1;
    } else if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
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
    [VarType.Clock]: "Clock",
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

  let thenId = dae.getExprLeft(ifElseId);
  let elseId = dae.getExprRight(ifElseId);
  if (thenId >= 0 && elseId >= 0) {
    if (dae.getExprKind(thenId) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(thenId));
      const exp = expandVarToArrayCtor(name, dae);
      if (exp !== null) thenId = exp;
    }
    if (dae.getExprKind(elseId) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(elseId));
      const exp = expandVarToArrayCtor(name, dae);
      if (exp !== null) elseId = exp;
    }
    const thenInfo = inferArenaExprShapeAndType(dae, thenId);
    const elseInfo = inferArenaExprShapeAndType(dae, elseId);
    if (thenInfo.typeName === "Integer" && elseInfo.typeName === "Real") {
      thenId = castToRealExpr(thenId, dae);
      thenInfo.typeName = "Real";
    } else if (thenInfo.typeName === "Real" && elseInfo.typeName === "Integer") {
      elseId = castToRealExpr(elseId, dae);
      elseInfo.typeName = "Real";
    }
    const shapeMismatch =
      thenInfo.shape.length !== elseInfo.shape.length || thenInfo.shape.some((d, i) => d !== elseInfo.shape[i]);
    const typeMismatch = shapeMismatch || thenInfo.typeName !== elseInfo.typeName;
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

      const startB = node?.startIndex ?? node?.startByte ?? 0;
      const endB = node?.endIndex ?? node?.endByte ?? 0;
      dae.diagnostics.push({
        severity: "error",
        message: `Type mismatch in if-expression in component ${compName}. True branch: ${thenStr} has type ${thenTypeStr}, false branch: ${elseStr} has type ${elseTypeStr}.`,
        range: {
          startByte: startB,
          endByte: endB,
          startPosition: node?.startPosition,
          endPosition: node?.endPosition,
        },
      });
      return true;
    }
    if (dae.getExprKind(elseId) === ExprKind.IfElse) {
      return checkIfExprTypeMismatch(dae, elseId, node, compName);
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
    if (
      fnName === "/*Real*/" ||
      fnName === "Real" ||
      fnName.startsWith("/*Real[") ||
      fnName === "cat" ||
      fnName === "promote"
    )
      return exprId;
    if (isRealExpr(exprId, dae)) return exprId;
    if (fnName === "fill") {
      const argCount = dae.getExprRight(exprId);
      if (argCount >= 2) {
        const firstArg = dae.getExprLeft(exprId);
        const castFirstArg = castToRealExpr(firstArg, dae);
        const otherArgs: number[] = [];
        for (let i = 1; i < argCount; i++) {
          otherArgs.push(dae.getExprLeft(exprId + i));
        }
        return dae.addCallExpr("fill", [castFirstArg, ...otherArgs]);
      }
    }
    const dims = getExprDims(exprId, dae);
    if (dims && dims.length > 0) {
      return dae.addCallExpr(`/*Real[${dims.join(", ")}]*/`, [exprId]);
    }
    return dae.addCallExpr("/*Real*/", [exprId]);
  }
  if (kind === ExprKind.Der) {
    return exprId;
  }
  const dims = getExprDims(exprId, dae);
  if (dims && dims.length > 0) {
    return dae.addCallExpr(`/*Real[${dims.join(", ")}]*/`, [exprId]);
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
        if (typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String" || typeSpec === "Clock")
          return false;
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
    if (op === BinOp.Div || op === BinOp.ElemDiv || op === BinOp.Pow || op === BinOp.ElemPow) return true;
    if (
      op === BinOp.Add ||
      op === BinOp.Sub ||
      op === BinOp.Mul ||
      op === BinOp.ElemAdd ||
      op === BinOp.ElemSub ||
      op === BinOp.ElemMul
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
      fnName.startsWith("/*Real") ||
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
      fnName === "actualStream" ||
      fnName === "timeInState" ||
      fnName === "interval"
    ) {
      return true;
    }
    if (
      fnName === "abs" ||
      fnName === "fill" ||
      fnName === "sum" ||
      fnName === "product" ||
      fnName === "hold" ||
      fnName === "previous" ||
      fnName === "shiftSample" ||
      fnName === "subSample" ||
      fnName === "superSample" ||
      fnName === "backSample" ||
      fnName === "noClock"
    ) {
      const firstArg = dae.getExprLeft(exprId);
      return isRealExpr(firstArg, dae);
    }
    if (fnName === "sample") {
      const argCount = dae.getExprRight(exprId);
      if (argCount === 1) {
        return isRealExpr(dae.getExprLeft(exprId), dae);
      }
      if (argCount === 2) {
        const arg1 = dae.getExprLeft(exprId + 1);
        const t1 = inferArenaExprVarType(dae, arg1);
        if (t1 === VarType.Real || t1 === VarType.Integer) {
          return false;
        }
        const k1 = dae.getExprKind(arg1);
        if (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) {
          return false;
        }
        return isRealExpr(dae.getExprLeft(exprId), dae);
      }
      return false;
    }
    if (fnName === "Clock" || fnName.startsWith("Clock")) return false;
    if (fnName === "sign") return false;
    if (fnName === "abs" || fnName === "min" || fnName === "max") {
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
          if (fnDae.getVarCustomType(i)) return false;
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
  if (kind === ExprKind.Comprehension) {
    return isRealExpr(dae.getExprLeft(exprId), dae);
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

function exprContainsNonConstantRef(exprId: number, dae: DAEBuilder, visited = new Set<number>()): boolean {
  if (exprId < 0 || visited.has(exprId)) return false;
  visited.add(exprId);
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (!name) return true;
    if (name === "true" || name === "false") return false;
    if (name === "time") return true;
    const varIdx = dae.lookupVariable(name);
    if (varIdx >= 0) {
      const variability = dae.getVarVariability(varIdx);
      return variability !== Variability.Constant;
    }
    if (dae.hasArrayElements(name)) {
      const elems = dae.getArrayElementIndices(name);
      for (const e of elems) {
        if (dae.getVarVariability(e) !== Variability.Constant) {
          return true;
        }
      }
      return false;
    }
    return true;
  }
  const left = dae.getExprLeft(exprId);
  const right = dae.getExprRight(exprId);
  const data1 = dae.getExprData1(exprId);
  if (kind === ExprKind.Binary || kind === ExprKind.IfElse) {
    if (kind === ExprKind.IfElse) {
      if (exprContainsNonConstantRef(data1, dae, visited)) return true;
      if (exprContainsNonConstantRef(left, dae, visited)) return true;
      if (exprContainsNonConstantRef(right, dae, visited)) return true;
      return false;
    }
    if (exprContainsNonConstantRef(left, dae, visited)) return true;
    if (exprContainsNonConstantRef(right, dae, visited)) return true;
    return false;
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return exprContainsNonConstantRef(left, dae, visited);
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(data1);
    if (fnName === "size" || fnName === "ndims") {
      return false;
    }
    const argCount = right;
    for (let i = 0; i < argCount; i++) {
      const argId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNonConstantRef(argId, dae, visited)) return true;
    }
    return false;
  }
  if (kind === ExprKind.ArrayCtor) {
    const count = data1;
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNonConstantRef(elemId, dae, visited)) return true;
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
        const v = dae.getVarVariability(varIdx);
        if (v === Variability.Constant || v === Variability.Parameter) {
          const bindingId = dae.getVarExpression(varIdx);
          if (bindingId !== undefined && bindingId >= 0 && bindingId !== exprId) {
            return evalDaeExpr(bindingId, dae);
          }
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
    case ExprKind.Call: {
      const fnNameId = dae.getExprData1(exprId);
      const fnName = dae.interner.resolve(fnNameId);
      if (!fnName) return null;
      const cleanFn = fnName.split(".").pop() ?? fnName;
      const argCount = dae.getExprRight(exprId);
      const firstArg = dae.getExprLeft(exprId);
      const args: any[] = [];
      for (let i = 0; i < argCount; i++) {
        const aId = i === 0 ? firstArg : dae.getExprLeft(exprId + i);
        const aVal = evalDaeExpr(aId, dae);
        if (aVal === null) return null;
        args.push(aVal);
      }
      if (cleanFn === "/*Real*/" || cleanFn === "Real") {
        return typeof args[0] === "number" ? args[0] : null;
      }
      if (cleanFn === "/*Integer*/" || cleanFn === "Integer") {
        return typeof args[0] === "number" ? Math.floor(args[0]) : null;
      }
      if (cleanFn === "div" && typeof args[0] === "number" && typeof args[1] === "number") {
        return args[1] !== 0 ? Math.trunc(args[0] / args[1]) : null;
      }
      if (cleanFn === "rem" && typeof args[0] === "number" && typeof args[1] === "number") {
        return args[1] !== 0 ? args[0] - Math.trunc(args[0] / args[1]) * args[1] : null;
      }
      if (cleanFn === "mod" && typeof args[0] === "number" && typeof args[1] === "number") {
        return args[1] !== 0 ? args[0] - Math.floor(args[0] / args[1]) * args[1] : null;
      }
      const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(cleanFn);
      if (scalarBuiltin?.fold && args.every((a) => typeof a === "number")) {
        return scalarBuiltin.fold(...args);
      }
      return null;
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

function copyExprBetweenDaes(
  src: DAEBuilder,
  srcId: number,
  dst: DAEBuilder,
  substitutions?: Map<string, number>,
): number {
  if (srcId < 0) return -1;
  const kind = src.getExprKind(srcId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return dst.addRealLiteral(src.getExprRealValue(srcId));
    case ExprKind.IntLiteral:
      return dst.addIntLiteral(src.getExprData1(srcId));
    case ExprKind.BoolLiteral:
      return dst.addBoolLiteral(src.getExprData1(srcId) !== 0);
    case ExprKind.StringLiteral:
      return dst.addStringLiteral(src.interner.resolve(src.getExprData1(srcId)) ?? "");
    case ExprKind.EnumLiteral:
      return dst.addEnumLiteral(src.getExprData1(srcId), src.interner.resolve(src.getExprRight(srcId)) ?? "");
    case ExprKind.Name: {
      const name = src.interner.resolve(src.getExprData1(srcId)) ?? "";
      if (substitutions && substitutions.has(name)) {
        return substitutions.get(name)!;
      }
      return dst.addNameExpr(name);
    }
    case ExprKind.Binary: {
      const op = src.getExprData1(srcId);
      const l = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions);
      const r = copyExprBetweenDaes(src, src.getExprRight(srcId), dst, substitutions);
      if (op === BinOp.Mul) {
        const lK = dst.getExprKind(l);
        const rK = dst.getExprKind(r);
        if (rK === ExprKind.RealLiteral && dst.getExprRealValue(r) === 1.0) return l;
        if (lK === ExprKind.RealLiteral && dst.getExprRealValue(l) === 1.0) return r;
        if (rK === ExprKind.IntLiteral && dst.getExprData1(r) === 1) return l;
        if (lK === ExprKind.IntLiteral && dst.getExprData1(l) === 1) return r;
        if (
          (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) &&
          lK !== ExprKind.RealLiteral &&
          lK !== ExprKind.IntLiteral
        ) {
          return dst.addBinaryExpr(op, r, l);
        }
      }
      return dst.addBinaryExpr(op, l, r);
    }
    case ExprKind.Unary: {
      const op = src.getExprData1(srcId);
      const operand = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions);
      return dst.addUnaryExpr(op, operand);
    }
    case ExprKind.Negate: {
      const operand = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions);
      return dst.addNegateExpr(operand);
    }
    case ExprKind.ArrayCtor: {
      const count = src.getExprData1(srcId);
      const elems: number[] = [];
      for (let i = 0; i < count; i++) {
        const eid = i === 0 ? src.getExprLeft(srcId) : src.getExprLeft(srcId + i);
        elems.push(copyExprBetweenDaes(src, eid, dst, substitutions));
      }
      return dst.addArrayCtorExpr(elems);
    }
    case ExprKind.Range: {
      const start = copyExprBetweenDaes(src, src.getExprData1(srcId), dst, substitutions);
      const stepId = src.getExprLeft(srcId);
      const step = stepId >= 0 ? copyExprBetweenDaes(src, stepId, dst, substitutions) : -1;
      const stop = copyExprBetweenDaes(src, src.getExprRight(srcId), dst, substitutions);
      return dst.addRangeExpr(start, step, stop);
    }
    case ExprKind.IfElse: {
      const cond = copyExprBetweenDaes(src, src.getExprData1(srcId), dst, substitutions);
      const thenE = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions);
      const elseE = copyExprBetweenDaes(src, src.getExprRight(srcId), dst, substitutions);
      return dst.addIfElseExpr(cond, thenE, elseE);
    }
    case ExprKind.Call: {
      const fnName = src.interner.resolve(src.getExprData1(srcId)) ?? "";
      const argCount = src.getExprRight(srcId);
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const aid = i === 0 ? src.getExprLeft(srcId) : src.getExprLeft(srcId + i);
        args.push(copyExprBetweenDaes(src, aid, dst, substitutions));
      }
      return dst.addCallExpr(fnName, args);
    }
    default:
      return -1;
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

function evalArithmeticText(str: string, subs?: Map<string, number>): number | null {
  if (!str) return null;
  let s = str.trim();
  if (subs) {
    for (const [k, v] of subs.entries()) {
      s = s.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
    }
  }
  try {
    if (/^[0-9+\-*/().\s]+$/.test(s)) {
      const val = Function(`"use strict"; return (${s})`)();
      if (typeof val === "number" && !isNaN(val)) return Math.round(val);
    }
  } catch {}
  return null;
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
    const namedShape =
      (dae as any).getNamedArrayShape?.(resolvedName) ??
      (dae as any).namedArrayShapes?.get(resolvedName) ??
      (dae as any).getNamedArrayShape?.(arrName) ??
      (dae as any).namedArrayShapes?.get(arrName);
    if (namedShape && namedShape.length >= dim && namedShape[dim - 1]! >= 0) {
      return namedShape[dim - 1]!;
    }
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

  // Unary expression
  if (
    node.childCount === 2 &&
    (node.type === "expression" || node.type === "UnaryExpression" || node.type === "unary_expression")
  ) {
    const op = (node.child(0)?.text?.trim() ?? "").replace(/^"|"$/g, "");
    const val = evaluateCSTNumber(node.child(1), subs, scopeId, db, dae, prefix);
    if (val !== null) {
      if (op === "-") return -val;
      if (op === "+") return val;
    }
  }

  if (dae) {
    const resolved = resolveScopedName(text, prefix, dae);
    const vIdx = dae.getVarIdxByName(resolved);
    if (vIdx >= 0) {
      const v = dae.getVarVariability(vIdx);
      if (v === Variability.Constant || v === Variability.Parameter) {
        const bExpr = dae.getVarExpression(vIdx);
        if (bExpr !== undefined && bExpr >= 0) {
          const val = evalDaeExpr(bExpr, dae);
          if (typeof val === "number") return val;
        }
        const startVal = dae.getVarStartValue(vIdx);
        if (startVal !== 0) return startVal;
      }
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

  if (/[+\-*/]/.test(text)) {
    let exprStr = text;
    exprStr = exprStr.replace(/size\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*,\s*(\d+)\s*\)/g, (_, arrName, dimStr) => {
      const dim = parseInt(dimStr, 10);
      if (dae) {
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
                  if (!isNaN(val) && val > maxDim) maxDim = val;
                }
              }
            }
          }
        }
        if (maxDim > 0) return String(maxDim);
      }
      if (db) {
        const syms = db.byName(arrName);
        for (const s of syms) {
          const dims = db.query("arrayDimensions", s.id);
          if (dims && dims.length >= dim) {
            const d = dims[dim - 1];
            if (d?.kind === "literal" && typeof d.value === "number") return String(d.value);
          }
        }
      }
      return _;
    });

    exprStr = exprStr.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      if (subs && subs.has(match)) return String(subs.get(match)!);
      if (dae) {
        const resolved = resolveScopedName(match, prefix, dae);
        let vIdx = dae.getVarIdxByName(resolved);
        if (vIdx < 0) vIdx = dae.getVarIdxByName(match);
        if (vIdx >= 0) {
          const bExpr = dae.getVarExpression(vIdx);
          if (bExpr !== undefined && bExpr >= 0) {
            const val = evalDaeExpr(bExpr, dae);
            if (typeof val === "number") return String(val);
          }
          const startVal = dae.getVarStartValue(vIdx);
          if (startVal !== 0) return String(startVal);
        }
      }
      if (scopeId !== undefined && db) {
        const resolver = db.query("resolveSimpleName", scopeId);
        if (resolver) {
          const resolved = resolver(match);
          if (resolved) {
            const mod = db.query("effectiveModification", resolved.id);
            if (mod?.bindingExpression?.text) {
              const bVal = parseInt(mod.bindingExpression.text.trim(), 10);
              if (!isNaN(bVal)) return String(bVal);
            }
          }
        }
      }
      return match;
    });

    const arithVal = evalArithmeticText(exprStr);
    if (arithVal !== null) return arithVal;
  }

  return null;
}

function resolveScopedName(name: string, prefix: string, dae: DAEBuilder, innerOuterComponents?: Set<string>): string {
  if ((dae as any).outerToInner) {
    if ((dae as any).outerToInner.has(name)) {
      return (dae as any).outerToInner.get(name)!;
    }
    const full = prefix ? `${prefix}.${name}` : name;
    if ((dae as any).outerToInner.has(full)) {
      return (dae as any).outerToInner.get(full)!;
    }
  }
  if ((dae as any).constantAliases?.has(name)) {
    return (dae as any).constantAliases.get(name)!;
  }
  const prefixedCandidate = prefix ? `${prefix}.${name}` : name;
  if ((dae as any).constantAliases?.has(prefixedCandidate)) {
    return (dae as any).constantAliases.get(prefixedCandidate)!;
  }
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
  const isStateOutput = Boolean((dae as any).stateOutputVars?.has(fullLocalRoot));
  const isInnerOuter =
    innerOuterComponents?.has(fullLocalRoot) || (Boolean((dae as any).isInsidePrevious) && isStateOutput);

  const scopeDeclaredNames: Map<string, Set<string>> | undefined = (dae as any).scopeDeclaredNames;

  let resolvedName: string | null = null;
  if (!isInnerOuter) {
    const basePrefix = stripArraySubscripts(prefix);
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
      const target = p ? `${p}.${name}` : name;
      const isStateOut = Boolean((dae as any).isInsidePrevious && (dae as any).stateOutputVars?.has(target));
      if (!isStateOut) {
        if (!isInnerOuter) {
          const vIdx = dae.getVarIdxByName(target);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Constant) {
            resolvedName = target;
            break;
          }
          if (vIdx < 0 && dae.hasArrayElements(target)) {
            resolvedName = target;
            break;
          }
          if (vIdx >= 0 && dae.getVarVariability(vIdx) !== Variability.Constant) {
            if (!(dae as any).outerNonConstantAccess) {
              (dae as any).outerNonConstantAccess = [];
            }
            (dae as any).outerNonConstantAccess.push({
              compName: prefix,
              varName: name,
              target,
              p,
            });
            break;
          }
        } else {
          const baseP = p.replace(/\[[^\]]+\]/g, "");
          if (scopeDeclaredNames?.get(p)?.has(rootComp) || scopeDeclaredNames?.get(baseP)?.has(rootComp)) {
            resolvedName = target;
            break;
          }
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
        }
      }
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

function isIntegerTypeSpec(typeSpec: string | null | undefined, db?: QueryDB): boolean {
  if (!typeSpec) return false;
  if (typeSpec === "Integer") return true;
  if (typeSpec === "Real" || typeSpec === "Boolean" || typeSpec === "String") return false;
  if (db) {
    const leaf = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
    const matches = db.byName(leaf);
    for (const tm of matches) {
      if (tm.kind === "Class") {
        const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", tm.id);
        if (baseClass && baseClass.name !== typeSpec) {
          if (isIntegerTypeSpec(baseClass.name, db)) return true;
        }
        const meta = tm.metadata as Record<string, unknown> | undefined;
        if (meta?.baseType === "Integer" || meta?.primitiveType === "Integer") return true;
        const cst = db.cstNode(tm.id) as any;
        const txt = cst?.text ?? "";
        if (/\b(?:extends\s+)?(?:Modelica\.Icons\.)?TypeInteger\b/.test(txt) || /\bextends\s+Integer\b/.test(txt))
          return true;
      }
    }
  }
  return false;
}

function lookupDbConstant(fullName: string, db: QueryDB): { value: number | number[]; isInteger: boolean } | null {
  if (fullName.startsWith(".")) fullName = fullName.slice(1);
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
        const isInteger = isIntegerTypeSpec(typeSpec, db);
        const mod = db.query<any>("effectiveModification", c.id);
        const bText = mod?.bindingExpression?.text?.trim();
        if (bText) {
          if (bText.startsWith("{") && bText.endsWith("}")) {
            const inner = bText.slice(1, -1).trim();
            const elemStrs = inner.split(",").map((s) => s.trim());
            const nums: number[] = [];
            let allNums = true;
            for (const es of elemStrs) {
              const n = parseFloat(es);
              if (isNaN(n)) {
                allNums = false;
                break;
              }
              nums.push(n);
            }
            if (allNums && nums.length > 0) {
              return { value: nums, isInteger };
            }
          }
          const num = parseFloat(bText);
          if (!isNaN(num) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(bText)) {
            return { value: num, isInteger: isInteger && Number.isInteger(num) };
          }
        }
        const cst = db.cstNode(c.id) as any;
        const cstText = cst?.text ?? "";
        const eqMatch = cstText.match(/=\s*([^;,()]+)/);
        if (eqMatch) {
          const mText = eqMatch[1].trim();
          if (mText.startsWith("{") && mText.endsWith("}")) {
            const inner = mText.slice(1, -1).trim();
            const elemStrs = inner.split(",").map((s) => s.trim());
            const nums: number[] = [];
            let allNums = true;
            for (const es of elemStrs) {
              const n = parseFloat(es);
              if (isNaN(n)) {
                allNums = false;
                break;
              }
              nums.push(n);
            }
            if (allNums && nums.length > 0) {
              return { value: nums, isInteger };
            }
          }
          const num = parseFloat(mText);
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
  let matchingCount = 0;
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      if (vn.startsWith(fullTarget) || vn.startsWith(target)) matchingCount++;
    }
  }
  if (matchingCount > 0) return matchingCount;
  if (db) {
    if (partIdent.startsWith(".")) partIdent = partIdent.slice(1);
    const cleanIdent = partIdent;
    const leafIdent = cleanIdent.includes(".") ? cleanIdent.split(".").pop()! : cleanIdent;
    const syms = db.byName(leafIdent);
    for (const s of syms) {
      const qName = getSymbolQualifiedName(db, s.id);
      if (qName === cleanIdent || s.name === cleanIdent || qName.endsWith(`.${cleanIdent}`)) {
        const dims = db.query("arrayDimensions", s.id);
        if (dims && dims.length > dimIdx) {
          const d = dims[dimIdx];
          if (typeof d === "number") return d;
          if (d?.kind === "literal" && typeof d.value === "number") return d.value;
        }
      }
    }
  }
  return 0;
}

function getEnumLiteralIndex(text: string, db: any): number | null {
  const parts = text.split(".");
  const litName = parts.pop()!;
  const typeName = parts.length > 0 ? parts.pop()! : null;
  const candidateSyms = typeName
    ? db.byName(typeName)
    : db.index?.symbols
      ? Array.from(db.index.symbols.values()).filter((s: any) => (s as any).kind === "Class")
      : [];
  for (const s of candidateSyms as any[]) {
    const cstText = (db.cstNode(s.id) as any)?.text ?? "";
    const match = /enumeration\s*\(([^)]+)\)/.exec(cstText);
    const lits =
      match && match[1]
        ? match[1].split(",").map((x: string) => x.trim().split(/\s+/)[0])
        : Array.isArray(s.metadata?.literals)
          ? s.metadata.literals
          : null;
    if (lits) {
      const idx = lits.indexOf(litName);
      if (idx >= 0) return idx + 1;
    }
  }
  return null;
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
      const namedShape = (dae as any).getNamedArrayShape?.(vName) ?? (dae as any).namedArrayShapes?.get(vName);
      if (namedShape && namedShape.length > 0) return namedShape;
      const varIdx = dae.getVarIdxByName(vName);
      if (varIdx >= 0) {
        const shape = dae.getVarShape(varIdx);
        if (shape && shape.length > 0) return shape;
        const shapeExprs = (dae as any).getVarShapeExprs ? (dae as any).getVarShapeExprs(varIdx) : null;
        if (shapeExprs && shapeExprs.length > 0) return shapeExprs;
        if (!dae.hasArrayElements(vName)) return null;
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
      if (db) {
        const simpleName = vName.includes(".") ? vName.split(".").pop()! : vName;
        const syms = db.byName(simpleName);
        for (const s of syms) {
          if (s.kind === "Component") {
            const fullName = db.query("symbolFullName", s.id) ?? s.name;
            if (fullName === vName || s.name === vName) {
              const dims = db.query("resolvedArrayDimensions", s.id);
              if (dims && Array.isArray(dims)) return dims;
            }
          } else {
            const targetMeta = s.metadata as any;
            const cstNode = db.cstNode?.(s.id) as any;
            const cstText = cstNode?.text ?? "";
            const isEnum =
              targetMeta?.classPrefixes === "enumeration" ||
              targetMeta?.isEnumeration ||
              Boolean(cstText.includes("enumeration("));
            if (isEnum) {
              const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
              const literals = enumMatch
                ? enumMatch[1].split(",").map((x: string) => x.trim().split(/\s+/)[0])
                : Array.isArray(targetMeta?.literals)
                  ? targetMeta.literals
                  : null;
              if (literals) {
                return [literals.length];
              }
            }
          }
        }
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
  } else if (kind === ExprKind.Unary || kind === ExprKind.Negate || kind === ExprKind.Der || kind === ExprKind.Pre) {
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
        if (leftDims.length === 1 && rightDims.length === 2 && leftDims[0] === rightDims[0]) {
          return [rightDims[1]!];
        }
        if (leftDims.length === 1 && rightDims.length === 1 && leftDims[0] === rightDims[0]) {
          return null;
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
        fillDims.push(dae.getExprKind(dimExpr) === ExprKind.IntLiteral ? dae.getExprData1(dimExpr) : -1);
      }
      return [...fillDims, ...innerDims];
    }
    if (fnName === "transpose" && argCount === 1) {
      const innerDims = getExprDims(dae.getExprLeft(exprId), dae, db);
      if (innerDims && innerDims.length >= 2) {
        return [innerDims[1]!, innerDims[0]!, ...innerDims.slice(2)];
      }
    }
    if (
      fnName === "subSample" ||
      fnName === "superSample" ||
      fnName === "shiftSample" ||
      fnName === "backSample" ||
      fnName === "noClock" ||
      fnName === "hold" ||
      fnName === "previous" ||
      fnName === "pre" ||
      fnName.startsWith("/*Real")
    ) {
      if (argCount > 0) {
        return getExprDims(dae.getExprLeft(exprId), dae, db);
      }
    }

    const fn = dae.getFunction(fnName) ?? dae.getFunction(fnName.split(".").pop() ?? "");
    if (fn) {
      for (let vi = 0; vi < fn.varCount; vi++) {
        if (fn.getVarCausality(vi) === Causality.Output) {
          const shape = fn.getVarShape(vi);
          if (shape && shape.length > 0) {
            const evaluatedDims: number[] = [];
            for (let d = 0; d < shape.length; d++) {
              let dimVal = shape[d]!;
              if (dimVal <= 0 && argCount > 0) {
                const inDims = getExprDims(dae.getExprLeft(exprId), dae, db);
                if (inDims && inDims[d] !== undefined && inDims[d]! > 0) {
                  dimVal = inDims[d]!;
                }
              }
              evaluatedDims.push(dimVal);
            }
            if (evaluatedDims.length > 0) return evaluatedDims;
          }
        }
      }
    }
  } else if (kind === ExprKind.Subscript) {
    const baseId = dae.getExprData1(exprId);
    const subCount = dae.getExprRight(exprId);
    const baseDims = getExprDims(baseId, dae, db);
    if (baseDims) {
      const remainingDims: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subExpr = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        const subKind = dae.getExprKind(subExpr);
        if (
          subKind === ExprKind.Colon ||
          (subKind === ExprKind.Name && dae.interner.resolve(dae.getExprData1(subExpr)) === ":")
        ) {
          if (i < baseDims.length) remainingDims.push(baseDims[i]!);
        } else if (subKind === ExprKind.ArrayCtor) {
          remainingDims.push(dae.getExprData1(subExpr));
        } else if (subKind === ExprKind.Range) {
          const rStart = evalDaeExpr(dae.getExprLeft(subExpr), dae);
          const rEnd = evalDaeExpr(dae.getExprRight(subExpr), dae);
          if (typeof rStart === "number" && typeof rEnd === "number") {
            remainingDims.push(Math.max(0, Math.trunc(rEnd - rStart + 1)));
          }
        }
      }
      for (let i = subCount; i < baseDims.length; i++) {
        remainingDims.push(baseDims[i]!);
      }
      return remainingDims.length > 0 ? remainingDims : null;
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
  const labelMaps: Map<string, number>[] = [];
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      const idxs = matchVarPath(vn, baseName, labelMaps);
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

function exprsEqual(id1: number, id2: number, dae: DAEBuilder): boolean {
  if (id1 === id2) return true;
  if (id1 < 0 || id2 < 0) return false;
  const k1 = dae.getExprKind(id1);
  const k2 = dae.getExprKind(id2);
  if (k1 !== k2) return false;
  if (k1 === ExprKind.Name) {
    return dae.getExprData1(id1) === dae.getExprData1(id2);
  }
  if (k1 === ExprKind.IntLiteral) {
    return dae.getExprData1(id1) === dae.getExprData1(id2);
  }
  if (k1 === ExprKind.RealLiteral) {
    return dae.getExprRealValue(id1) === dae.getExprRealValue(id2);
  }
  return false;
}

function isMinusOne(id: number, dae: DAEBuilder): boolean {
  if (id < 0) return false;
  const k = dae.getExprKind(id);
  if (k === ExprKind.IntLiteral && dae.getExprData1(id) === -1) return true;
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === -1.0) return true;
  if (k === ExprKind.Negate) {
    const inner = dae.getExprLeft(id);
    const ik = dae.getExprKind(inner);
    return (
      (ik === ExprKind.IntLiteral && dae.getExprData1(inner) === 1) ||
      (ik === ExprKind.RealLiteral && dae.getExprRealValue(inner) === 1.0)
    );
  }
  if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
    const inner = dae.getExprLeft(id);
    const ik = dae.getExprKind(inner);
    return (
      (ik === ExprKind.IntLiteral && dae.getExprData1(inner) === 1) ||
      (ik === ExprKind.RealLiteral && dae.getExprRealValue(inner) === 1.0)
    );
  }
  return false;
}

function mulWithSimplification(leftId: number, rightId: number, dae: DAEBuilder): number {
  const lK = dae.getExprKind(leftId);
  const rK = dae.getExprKind(rightId);
  if (
    (lK === ExprKind.IntLiteral || lK === ExprKind.RealLiteral) &&
    (rK === ExprKind.IntLiteral || rK === ExprKind.RealLiteral)
  ) {
    const lVal = lK === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
    const rVal = rK === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
    const res = lVal * rVal;
    return lK === ExprKind.RealLiteral || rK === ExprKind.RealLiteral || !Number.isInteger(res)
      ? dae.addRealLiteral(res)
      : dae.addIntLiteral(res);
  }
  if (lK === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 0.0) return dae.addRealLiteral(0.0);
  if (rK === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0.0) return dae.addRealLiteral(0.0);
  if (lK === ExprKind.IntLiteral && dae.getExprData1(leftId) === 0) return dae.addRealLiteral(0.0);
  if (rK === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) return dae.addRealLiteral(0.0);
  if (lK === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 1.0) return rightId;
  if (rK === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 1.0) return leftId;
  if (lK === ExprKind.IntLiteral && dae.getExprData1(leftId) === 1) return rightId;
  if (rK === ExprKind.IntLiteral && dae.getExprData1(rightId) === 1) return leftId;
  if (isMinusOne(leftId, dae)) return dae.addUnaryExpr(UnaryOp.Negate, rightId);
  if (isMinusOne(rightId, dae)) return dae.addUnaryExpr(UnaryOp.Negate, leftId);

  const lReal = isRealExpr(leftId, dae);
  const rReal = isRealExpr(rightId, dae);
  if (lReal && !rReal) {
    rightId = castToRealExpr(rightId, dae);
  } else if (!lReal && rReal) {
    leftId = castToRealExpr(leftId, dae);
  }

  if (exprsEqual(leftId, rightId, dae)) {
    return dae.addBinaryExpr(BinOp.Pow, leftId, dae.addRealLiteral(2.0));
  }
  return dae.addBinaryExpr(BinOp.Mul, leftId, rightId);
}

function addWithFactoring(term1: number, term2: number, dae: DAEBuilder): number {
  const t1K = dae.getExprKind(term1);
  const t2K = dae.getExprKind(term2);
  if (
    (t1K === ExprKind.IntLiteral || t1K === ExprKind.RealLiteral) &&
    (t2K === ExprKind.IntLiteral || t2K === ExprKind.RealLiteral)
  ) {
    const v1 = t1K === ExprKind.IntLiteral ? dae.getExprData1(term1) : dae.getExprRealValue(term1);
    const v2 = t2K === ExprKind.IntLiteral ? dae.getExprData1(term2) : dae.getExprRealValue(term2);
    const res = v1 + v2;
    return t1K === ExprKind.RealLiteral || t2K === ExprKind.RealLiteral || !Number.isInteger(res)
      ? dae.addRealLiteral(res)
      : dae.addIntLiteral(res);
  }
  if (t1K === ExprKind.RealLiteral && dae.getExprRealValue(term1) === 0.0) return term2;
  if (t2K === ExprKind.RealLiteral && dae.getExprRealValue(term2) === 0.0) return term1;
  if (t1K === ExprKind.IntLiteral && dae.getExprData1(term1) === 0) return term2;
  if (t2K === ExprKind.IntLiteral && dae.getExprData1(term2) === 0) return term1;

  const getCoeffAndTarget = (id: number): { coeff: number; target: number } | null => {
    const k = dae.getExprKind(id);
    if (k === ExprKind.Binary && dae.getExprData1(id) === BinOp.Mul) {
      const l = dae.getExprLeft(id);
      const r = dae.getExprRight(id);
      const lK = dae.getExprKind(l);
      const rK = dae.getExprKind(r);
      if (lK === ExprKind.RealLiteral || lK === ExprKind.IntLiteral) {
        const val = lK === ExprKind.IntLiteral ? dae.getExprData1(l) : dae.getExprRealValue(l);
        return { coeff: val, target: r };
      }
      if (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) {
        const val = rK === ExprKind.IntLiteral ? dae.getExprData1(r) : dae.getExprRealValue(r);
        return { coeff: val, target: l };
      }
    }
    if (k === ExprKind.Unary && dae.getExprData1(id) === UnaryOp.Negate) {
      return { coeff: -1.0, target: dae.getExprLeft(id) };
    }
    if (k === ExprKind.Negate) {
      return { coeff: -1.0, target: dae.getExprLeft(id) };
    }
    return null;
  };

  const c1 = getCoeffAndTarget(term1);
  const c2 = getCoeffAndTarget(term2);
  if (c1 || c2) {
    const t1 = c1 ?? { coeff: 1.0, target: term1 };
    const t2 = c2 ?? { coeff: 1.0, target: term2 };
    if (exprsEqual(t1.target, t2.target, dae)) {
      const sumCoeff = t1.coeff + t2.coeff;
      if (sumCoeff === 0) return dae.addRealLiteral(0.0);
      if (sumCoeff === 1) return t1.target;
      if (sumCoeff === -1) return dae.addExpression(ExprKind.Negate, 0, t1.target);
      return mulWithSimplification(dae.addRealLiteral(sumCoeff), t1.target, dae);
    }
  }

  if (
    t1K === ExprKind.Binary &&
    dae.getExprData1(term1) === BinOp.Mul &&
    t2K === ExprKind.Binary &&
    dae.getExprData1(term2) === BinOp.Mul
  ) {
    const a = dae.getExprLeft(term1);
    const b = dae.getExprRight(term1);
    const c = dae.getExprLeft(term2);
    const d = dae.getExprRight(term2);
    if (exprsEqual(a, c, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, b, d);
      return dae.addBinaryExpr(BinOp.Mul, a, sumInner);
    }
    if (exprsEqual(a, d, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, b, c);
      return dae.addBinaryExpr(BinOp.Mul, a, sumInner);
    }
    if (exprsEqual(b, c, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, a, d);
      return dae.addBinaryExpr(BinOp.Mul, b, sumInner);
    }
    if (exprsEqual(b, d, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, a, c);
      return dae.addBinaryExpr(BinOp.Mul, b, sumInner);
    }
  }

  return dae.addBinaryExpr(BinOp.Add, term1, term2);
}

function getArrayCtorRank(id: number, dae: DAEBuilder): number {
  if (id < 0) return 0;
  const k = dae.getExprKind(id);
  if (k === ExprKind.Negate) {
    return getArrayCtorRank(dae.getExprLeft(id), dae);
  }
  if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
    return getArrayCtorRank(dae.getExprLeft(id), dae);
  }
  if (k !== ExprKind.ArrayCtor) return 0;
  const elems = getArrayCtorElements(id, dae);
  if (elems.length === 0) return 1;
  return 1 + getArrayCtorRank(elems[0]!, dae);
}

function matrixOrVectorMul(leftId: number, rightId: number, dae: DAEBuilder): number {
  const lRank = getArrayCtorRank(leftId, dae);
  const rRank = getArrayCtorRank(rightId, dae);

  if (lRank === 1 && rRank === 2) {
    // Vector (1xK) * Matrix (KxM) -> Vector (1xM)
    const lElems = getArrayCtorElements(leftId, dae);
    const rRows = getArrayCtorElements(rightId, dae);
    if (rRows.length > 0) {
      const rCols0 = getArrayCtorElements(rRows[0]!, dae);
      const M = rCols0.length;
      const resCols: number[] = [];
      for (let j = 0; j < M; j++) {
        let sumExpr: number | null = null;
        for (let k = 0; k < lElems.length; k++) {
          const rColsK = getArrayCtorElements(rRows[k]!, dae);
          const term = mulWithSimplification(lElems[k]!, rColsK[j]!, dae);
          sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
        }
        resCols.push(sumExpr ?? dae.addRealLiteral(0.0));
      }
      return dae.addArrayCtorExpr(resCols);
    }
  }

  if (lRank === 2 && rRank === 2) {
    // Matrix (NxK) * Matrix (KxM) -> Matrix (NxM)
    const lRows = getArrayCtorElements(leftId, dae);
    const rRows = getArrayCtorElements(rightId, dae);
    if (lRows.length > 0 && rRows.length > 0) {
      const rCols0 = getArrayCtorElements(rRows[0]!, dae);
      const M = rCols0.length;
      const resRows: number[] = [];
      for (let i = 0; i < lRows.length; i++) {
        const lColsI = getArrayCtorElements(lRows[i]!, dae);
        const rowCols: number[] = [];
        for (let j = 0; j < M; j++) {
          let sumExpr: number | null = null;
          for (let k = 0; k < lColsI.length; k++) {
            const rColsK = getArrayCtorElements(rRows[k]!, dae);
            const term = mulWithSimplification(lColsI[k]!, rColsK[j]!, dae);
            sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
          }
          rowCols.push(sumExpr ?? dae.addRealLiteral(0.0));
        }
        resRows.push(dae.addArrayCtorExpr(rowCols));
      }
      return dae.addArrayCtorExpr(resRows);
    }
  }

  if (lRank === 2 && rRank === 1) {
    // Matrix (NxK) * Vector (Kx1) -> Vector (Nx1)
    const lRows = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    const resElems: number[] = [];
    for (let i = 0; i < lRows.length; i++) {
      const lColsI = getArrayCtorElements(lRows[i]!, dae);
      let sumExpr: number | null = null;
      for (let k = 0; k < lColsI.length; k++) {
        const term = mulWithSimplification(lColsI[k]!, rElems[k]!, dae);
        sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
      }
      resElems.push(sumExpr ?? dae.addRealLiteral(0.0));
    }
    return dae.addArrayCtorExpr(resElems);
  }

  if (lRank === 1 && rRank === 1) {
    // Vector (1xK) * Vector (Kx1) -> Scalar
    const lElems = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    let sumExpr: number | null = null;
    for (let k = 0; k < lElems.length; k++) {
      const term = mulWithSimplification(lElems[k]!, rElems[k]!, dae);
      sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
    }
    return sumExpr ?? dae.addRealLiteral(0.0);
  }

  return addArrayBinaryExpr(BinOp.Mul, leftId, rightId, dae);
}

function matrixPower(leftId: number, power: number, dae: DAEBuilder): number {
  const lRank = getArrayCtorRank(leftId, dae);
  if (lRank === 2) {
    const lRows = getArrayCtorElements(leftId, dae);
    const N = lRows.length;
    if (power === 0) {
      const rows: number[] = [];
      for (let i = 0; i < N; i++) {
        const cols: number[] = [];
        for (let j = 0; j < N; j++) {
          cols.push(dae.addRealLiteral(i === j ? 1.0 : 0.0));
        }
        rows.push(dae.addArrayCtorExpr(cols));
      }
      return dae.addArrayCtorExpr(rows);
    }
    if (power === 1) {
      return leftId;
    }
    if (power === 2) {
      return matrixOrVectorMul(leftId, leftId, dae);
    }
    let cur = leftId;
    for (let p = 2; p <= power; p++) {
      cur = matrixOrVectorMul(cur, leftId, dae);
    }
    return cur;
  }
  return dae.addBinaryExpr(BinOp.Pow, leftId, dae.addRealLiteral(power));
}

function addArrayBinaryExpr(op: BinOp, leftId: number, rightId: number, dae: DAEBuilder): number {
  const leftKind = dae.getExprKind(leftId);
  const rightKind = dae.getExprKind(rightId);
  if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
    const leftElems = getArrayCtorElements(leftId, dae);
    const rightElems = getArrayCtorElements(rightId, dae);
    if (leftElems.length === rightElems.length) {
      if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
      const newElems = leftElems.map((e, i) => addArrayBinaryExpr(op, e, rightElems[i]!, dae));
      return dae.addArrayCtorExpr(newElems);
    }
  }
  if (op === BinOp.Add) {
    if (leftKind === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 0) return rightId;
    if (leftKind === ExprKind.IntLiteral && dae.getExprData1(leftId) === 0) return rightId;
    if (rightKind === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0) return leftId;
    if (rightKind === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) return leftId;
  }
  if (op === BinOp.Sub) {
    if (rightKind === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0) return leftId;
    if (rightKind === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) return leftId;
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

function broadcastElemBinOp(
  elemOp: BinOp,
  baseOp: BinOp,
  leftId: number,
  rightId: number,
  dae: DAEBuilder,
  flattener?: any,
  isTopLevel = false,
): number {
  const lK = dae.getExprKind(leftId);
  const rK = dae.getExprKind(rightId);
  if (lK === ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const lElems = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    if (lElems.length === rElems.length && lElems.length > 0) {
      const newElems = lElems.map((e, i) => broadcastElemBinOp(elemOp, baseOp, e, rElems[i]!, dae, flattener, false));
      return dae.addArrayCtorExpr(newElems);
    }
  } else if (lK === ExprKind.ArrayCtor && rK !== ExprKind.ArrayCtor) {
    const lElems = getArrayCtorElements(leftId, dae);
    const newElems = lElems.map((e) => broadcastElemBinOp(elemOp, baseOp, e, rightId, dae, flattener, false));
    return dae.addArrayCtorExpr(newElems);
  } else if (lK !== ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const rElems = getArrayCtorElements(rightId, dae);
    if (flattener?.options?.omcCompatibility && (baseOp === BinOp.Add || baseOp === BinOp.Mul)) {
      const newElems = rElems.map((e) => broadcastElemBinOp(elemOp, baseOp, e, leftId, dae, flattener, false));
      return dae.addArrayCtorExpr(newElems);
    } else {
      const newElems = rElems.map((e) => broadcastElemBinOp(elemOp, baseOp, leftId, e, dae, flattener, false));
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
      case BinOp.Pow:
        res = Math.pow(lVal, rVal);
        break;
    }
    if (res !== null) {
      if (
        baseOp === BinOp.Div ||
        baseOp === BinOp.Pow ||
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
  if (baseOp === BinOp.Div || baseOp === BinOp.Pow) {
    if (!isRealExpr(l, dae)) l = castToRealExpr(l, dae);
    if (!isRealExpr(r, dae)) r = castToRealExpr(r, dae);
  } else if (isRealExpr(l, dae) && !isRealExpr(r, dae)) {
    r = castToRealExpr(r, dae);
  } else if (!isRealExpr(l, dae) && isRealExpr(r, dae)) {
    l = castToRealExpr(l, dae);
  }
  const lDims = getExprDims(l, dae, flattener?.db);
  const rDims = getExprDims(r, dae, flattener?.db);
  const lIsArr = lDims !== null && lDims.length > 0;
  const rIsArr = rDims !== null && rDims.length > 0;
  if (flattener?.options?.omcCompatibility && (baseOp === BinOp.Add || baseOp === BinOp.Mul)) {
    if (!lIsArr && rIsArr) {
      [l, r] = [r, l];
    }
  }
  const useElemOp = isTopLevel && (lIsArr || rIsArr);
  return dae.addBinaryExpr(useElemOp ? elemOp : baseOp, l, r);
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>((acc, curr) => acc.flatMap((c) => curr.map((n) => [...c, n])), [[]]);
}

function reduceNestedValues(values: number[], shape: number[], op: "sum" | "product"): number {
  if (shape.length <= 1) {
    if (op === "sum") return values.reduce((a, b) => a + b, 0);
    return values.reduce((a, b) => a * b, 1);
  }
  const innerDim = shape[shape.length - 1]!;
  const outerShape = shape.slice(0, -1);
  const outerCount = Math.floor(values.length / innerDim);
  const innerReduced: number[] = [];
  for (let i = 0; i < outerCount; i++) {
    const chunk = values.slice(i * innerDim, (i + 1) * innerDim);
    if (op === "sum") {
      innerReduced.push(chunk.reduce((a, b) => a + b, 0));
    } else {
      innerReduced.push(chunk.reduce((a, b) => a * b, 1));
    }
  }
  return reduceNestedValues(innerReduced, outerShape, op);
}

function getEnclosingClauseRange(
  node: any,
  dae: DAEBuilder,
): { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | undefined {
  if ((dae as any).currentCompClauseRange) {
    return (dae as any).currentCompClauseRange;
  }
  let curr = node;
  while (
    curr &&
    curr.type !== "component_clause" &&
    curr.type !== "ComponentClause" &&
    curr.type !== "simple_equation" &&
    curr.type !== "equality_equation" &&
    curr.type !== "statement" &&
    curr.type !== "assignment_statement"
  ) {
    curr = curr.parent;
  }
  if (curr) {
    const startByte = curr.startIndex ?? curr.startByte;
    const endByte = curr.endIndex ?? curr.endByte;
    return {
      startByte,
      endByte,
      startPosition: curr.startPosition,
      endPosition: curr.endPosition,
    };
  }
  return undefined;
}

function findArraySubscriptsForIter(
  exprNode: any,
  iterName: string,
  dae: DAEBuilder,
  db?: QueryDB,
  prefix?: string,
  isImplicit: boolean = false,
  clauseNode?: any,
): (number | string)[] {
  interface SubscriptOccurrence {
    baseName: string;
    dimension: number;
    count: number;
    subs: (number | string)[];
    found: boolean;
  }
  const occurrences: SubscriptOccurrence[] = [];

  const search = (n: any) => {
    if (!n) return;
    if (!isImplicit && occurrences.length > 0) return;
    if (
      n.type === "component_reference" ||
      (n.childCount >= 2 && n.child(n.childCount - 1)?.type === "array_subscripts")
    ) {
      const subsNode =
        (n.children || []).find((c: any) => c.type === "array_subscripts" || c.type === "ArraySubscripts") ??
        n.child(n.childCount - 1);
      if (subsNode && (subsNode.type === "array_subscripts" || subsNode.type === "ArraySubscripts")) {
        let subIdx = 0;
        for (let i = 0; i < subsNode.childCount; i++) {
          const sc = subsNode.child(i);
          if (sc.type === "subscript" || sc.type === "expression") {
            if (sc.text?.trim() === iterName) {
              let baseName = "";
              for (const ch of n.children || []) {
                if (ch === subsNode || ch.type === "array_subscripts" || ch.type === "ArraySubscripts") break;
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
              let subs: (number | string)[] = [];
              let found = distinctSubs.size > 0;
              if (distinctSubs.size > 0) {
                subs = [...distinctSubs].map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s));
              } else if (db) {
                const parts = baseName.split(".");
                const matches = db.byName(parts[0]!);
                if (matches.length > 0) {
                  found = true;
                  const pkgOrClass = matches.find((e) => e.kind === "Class" || e.kind === "Package");
                  if (pkgOrClass && parts.length > 1) {
                    const member = db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
                    if (member) {
                      const dims = db.query<number[] | null>("resolvedArrayDimensions", member.id);
                      if (dims && dims.length > subIdx && dims[subIdx]! > 0) {
                        subs = Array.from({ length: dims[subIdx]! }, (_, k) => k + 1);
                      }
                    }
                  }
                }
              }
              if (!found) {
                for (const p of [prefix ? `${prefix}.${baseName}` : baseName, baseName]) {
                  if (dae.getVarIdxByName(p) >= 0 || dae.hasArrayElements(p)) {
                    found = true;
                    break;
                  }
                }
              }
              occurrences.push({
                baseName,
                dimension: subIdx + 1,
                count: subs.length,
                subs,
                found,
              });
              if (!isImplicit) return;
            }
            subIdx++;
          }
        }
        return;
      }
    }
    for (let i = 0; i < n.childCount; i++) search(n.child(i));
  };
  search(exprNode);

  if (isImplicit) {
    const notFound = occurrences.find((o) => !o.found);
    if (notFound) {
      const compRange = (dae as any).currentCompClauseRange ?? getEnclosingClauseRange(clauseNode ?? exprNode, dae);
      dae.diagnostics.push({
        severity: "error",
        code: 0,
        message: `Variable ${notFound.baseName} not found in scope .`,
        range: compRange,
      });
      return [];
    }
    if (occurrences.length === 0) {
      const compRange = (dae as any).currentCompClauseRange ?? getEnclosingClauseRange(clauseNode ?? exprNode, dae);
      dae.diagnostics.push({
        severity: "error",
        code: 0,
        message: `Identifier ${iterName} of implicit for iterator must be present as array subscript in the loop body.`,
        range: compRange,
      });
      return [];
    }
    const first = occurrences[0]!;
    for (let i = 1; i < occurrences.length; i++) {
      const curr = occurrences[i]!;
      if (curr.count !== first.count) {
        const compRange = (dae as any).currentCompClauseRange ?? getEnclosingClauseRange(clauseNode ?? exprNode, dae);
        dae.diagnostics.push({
          severity: "error",
          code: 0,
          message: `Dimension ${curr.dimension} of ${curr.baseName} and ${first.dimension} of ${first.baseName} differs when trying to deduce implicit iteration range.`,
          range: compRange,
        });
        return [];
      }
    }
    return first.subs;
  }

  return occurrences.length > 0 ? occurrences[0]!.subs : [];
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

function areExpressionsEqual(dae: DAEBuilder, id1: number, id2: number): boolean {
  if (id1 === id2) return true;
  if (id1 < 0 || id2 < 0) return false;
  const k1 = dae.getExprKind(id1);
  const k2 = dae.getExprKind(id2);
  if (k1 !== k2) {
    if (
      (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) &&
      (k2 === ExprKind.RealLiteral || k2 === ExprKind.IntLiteral)
    ) {
      const v1 = k1 === ExprKind.RealLiteral ? dae.getExprRealValue(id1) : dae.getExprData1(id1);
      const v2 = k2 === ExprKind.RealLiteral ? dae.getExprRealValue(id2) : dae.getExprData1(id2);
      return v1 === v2;
    }
    return false;
  }
  switch (k1) {
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
      return dae.getExprData1(id1) === dae.getExprData1(id2);
    case ExprKind.RealLiteral:
      return dae.getExprRealValue(id1) === dae.getExprRealValue(id2);
    case ExprKind.StringLiteral:
    case ExprKind.Name:
      return dae.interner.resolve(dae.getExprData1(id1)) === dae.interner.resolve(dae.getExprData1(id2));
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return (
        dae.getExprData1(id1) === dae.getExprData1(id2) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2))
      );
    case ExprKind.Binary:
      return (
        dae.getExprData1(id1) === dae.getExprData1(id2) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2)) &&
        areExpressionsEqual(dae, dae.getExprRight(id1), dae.getExprRight(id2))
      );
    case ExprKind.Subscript: {
      if (dae.getExprRight(id1) !== dae.getExprRight(id2)) return false;
      if (!areExpressionsEqual(dae, dae.getExprData1(id1), dae.getExprData1(id2))) return false;
      const cnt = dae.getExprRight(id1);
      for (let i = 0; i < cnt; i++) {
        const s1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const s2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, s1, s2)) return false;
      }
      return true;
    }
    case ExprKind.Call: {
      if (dae.interner.resolve(dae.getExprData1(id1)) !== dae.interner.resolve(dae.getExprData1(id2))) return false;
      if (dae.getExprRight(id1) !== dae.getExprRight(id2)) return false;
      const cnt = dae.getExprRight(id1);
      for (let i = 0; i < cnt; i++) {
        const a1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const a2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, a1, a2)) return false;
      }
      return true;
    }
    case ExprKind.ArrayCtor: {
      if (dae.getExprData1(id1) !== dae.getExprData1(id2)) return false;
      const cnt = dae.getExprData1(id1);
      for (let i = 0; i < cnt; i++) {
        const a1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const a2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, a1, a2)) return false;
      }
      return true;
    }
    default:
      return false;
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
    compSym = comps.find((c: any) => (c.name ? c.name.split("[")[0] : "") === baseName);
    if (!compSym) {
      const instComps = db.query<any[]>("instantiate", flattener.currentRootClassId);
      if (instComps) {
        compSym = instComps.find((c: any) => (c.name ? c.name.split("[")[0] : "") === baseName);
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
      .map((p) => p.split("[")[0].trim())
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
  const kind = dae.getExprKind(id);
  if (kind === ExprKind.Negate) {
    const innerElems = getArrayCtorElements(dae.getExprLeft(id), dae);
    return innerElems.map((e) => dae.addExpression(ExprKind.Negate, 0, e));
  }
  if (kind === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
    const innerElems = getArrayCtorElements(dae.getExprLeft(id), dae);
    return innerElems.map((e) => dae.addExpression(ExprKind.Negate, 0, e));
  }
  if (kind === ExprKind.IfElse) {
    const condId = dae.getExprData1(id);
    const condVal = evalDaeExpr(condId, dae);
    if (condVal === true) {
      return getArrayCtorElements(dae.getExprLeft(id), dae);
    }
    if (condVal === false) {
      return getArrayCtorElements(dae.getExprRight(id), dae);
    }
    const thenElems = getArrayCtorElements(dae.getExprLeft(id), dae);
    const elseElems = getArrayCtorElements(dae.getExprRight(id), dae);
    const len = Math.max(thenElems.length, elseElems.length);
    const elems: number[] = [];
    for (let i = 0; i < len; i++) {
      const t = i < thenElems.length ? thenElems[i]! : thenElems[0]!;
      const e = i < elseElems.length ? elseElems[i]! : elseElems[0]!;
      elems.push(dae.addExpression(ExprKind.IfElse, condId, t, e));
    }
    return elems;
  }
  if (kind !== ExprKind.ArrayCtor) {
    return [id];
  }
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
  ["div", { arity: 2, fold: (a, b) => (b !== 0 ? Math.trunc(a / b) : 0) }],
  ["rem", { arity: 2, fold: (a, b) => (b !== 0 ? a - Math.trunc(a / b) * b : 0) }],
  ["mod", { arity: 2, fold: (a, b) => (b !== 0 ? a - Math.floor(a / b) * b : 0) }],
]);

function vectorizeFunctionCall(
  fnName: string,
  argExprIds: number[],
  dae: DAEBuilder,
  flattener?: any,
  db?: any,
): number | null {
  if (
    fnName === "subSample" ||
    fnName === "superSample" ||
    fnName === "shiftSample" ||
    fnName === "backSample" ||
    fnName === "hold" ||
    fnName === "sample" ||
    fnName === "noClock" ||
    fnName === "interval" ||
    fnName === "Integer" ||
    fnName === "Real" ||
    fnName === "Boolean" ||
    fnName === "String"
  ) {
    return null;
  }
  const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(fnName);
  let isScalarFn = Boolean(scalarBuiltin);
  let fnDae: DAEBuilder | undefined;
  if (!isScalarFn) {
    const hasArrayArg = argExprIds.some((aid) => (getExprDims(aid, dae, db)?.length ?? 0) > 0);
    if (!hasArrayArg) return null;
    fnDae = dae.getFunction(fnName);
    if (!fnDae && flattener && db) {
      const parts = fnName.split(".");
      const fnBase = parts[parts.length - 1]!;
      const sym = db
        .byName(fnBase)
        .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
      if (sym && flattener.failedFunctionIds?.has(sym.id)) {
        return null;
      }
      if (sym && flattener.flattenFunction) {
        const qualifiedFnName = getSymbolQualifiedName(db, sym.id);
        flattener.calledFunctionSymIds?.add(sym.id);
        fnDae = flattener.flattenFunction(sym.id, qualifiedFnName, undefined, dae);
        if (fnDae && !fnDae.diagnostics.some((d: any) => d.severity === "error")) {
          dae.addFunction(qualifiedFnName, fnDae);
          dae.addFunction(fnName, fnDae);
          if (fnBase) dae.addFunction(fnBase, fnDae);
          if (fnDae.functions && fnDae.functions.size > 0) {
            for (const [nestedName, nestedFn] of fnDae.functions.entries()) {
              dae.addFunction(nestedName, nestedFn);
            }
          }
        } else {
          fnDae = undefined;
        }
      }
    }
  }

  let inputShapes: number[][] = [];
  let allScalarInputs = true;
  if (scalarBuiltin) {
    isScalarFn = true;
    inputShapes = argExprIds.map(() => []);
  } else if (fnDae) {
    for (let i = 0; i < fnDae.varCount; i++) {
      if (fnDae.getVarCausality(i) === Causality.Input) {
        const shape = fnDae.getVarShape(i) ?? [];
        inputShapes.push(shape);
        if (shape.length > 0 || fnDae.getVarName(i).includes("[")) {
          allScalarInputs = false;
        }
      }
    }
  } else {
    return null;
  }

  const extraDimsPerArg: number[] = [];
  for (let i = 0; i < argExprIds.length; i++) {
    const expShape = inputShapes[i] ?? [];
    const actDims = getExprDims(argExprIds[i]!, dae, db) ?? [];
    const extra = actDims.length - expShape.length;
    if (extra < 0) return null;
    if (extra > 0) {
      const innerDims = actDims.slice(extra);
      const match = innerDims.every((d, idx) => expShape[idx] === -1 || expShape[idx] === d);
      if (!match) return null;
    }
    extraDimsPerArg.push(extra);
  }

  const argsWithExtraIndices: number[] = [];
  for (let i = 0; i < extraDimsPerArg.length; i++) {
    if (extraDimsPerArg[i]! > 0) {
      argsWithExtraIndices.push(i);
    }
  }

  if (argsWithExtraIndices.length === 0) return null;
  if (!allScalarInputs && argsWithExtraIndices.length > 1) return null;

  let arrLen = -1;
  let targetIdx = -1;
  if (allScalarInputs) {
    for (const idx of argsWithExtraIndices) {
      const id = argExprIds[idx]!;
      let len = -1;
      if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
        len = dae.getExprData1(id);
      } else {
        const dims = getExprDims(id, dae, db);
        if (dims && dims.length > 0 && dims[0] > 0) {
          len = dims[0];
        }
      }
      if (len > 0) {
        if (arrLen === -1) arrLen = len;
        else if (arrLen !== len) return null;
      }
    }
  } else {
    targetIdx = argsWithExtraIndices[0]!;
    const id = argExprIds[targetIdx]!;
    if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
      arrLen = dae.getExprData1(id);
    } else {
      const dims = getExprDims(id, dae, db);
      if (dims && dims.length > 0 && dims[0] > 0) {
        arrLen = dims[0];
      } else {
        return null;
      }
    }
  }
  if (arrLen < 0) {
    if (argsWithExtraIndices.length === 1 && isScalarFn) {
      const targetArgId = argExprIds[argsWithExtraIndices[0]!]!;
      const targetName =
        dae.getExprKind(targetArgId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(targetArgId)) : "";
      if (!(dae as any)._tmpVarMap) (dae as any)._tmpVarMap = new Map<string, string>();
      let tmpVarName = (dae as any)._tmpVarMap.get(targetName);
      if (!tmpVarName) {
        const tmpVarNum = ((dae as any)._tmpVarCounter = ((dae as any)._tmpVarCounter ?? 4) + 1);
        tmpVarName = `$tmpVar${tmpVarNum}`;
        (dae as any)._tmpVarMap.set(targetName, tmpVarName);
      }
      const callArgs = argExprIds.map((aid, idx) =>
        idx === argsWithExtraIndices[0] ? dae.addNameExpr(tmpVarName) : aid,
      );
      const scalarCall = dae.addCallExpr(fnName, callArgs);
      return dae.addComprehensionExpr("array", scalarCall, [{ name: tmpVarName, rangeId: targetArgId }]);
    }
    return null;
  }

  const elemResults: number[] = [];
  for (let i = 0; i < arrLen; i++) {
    const subArgs: number[] = [];
    for (let j = 0; j < argExprIds.length; j++) {
      const argId = argExprIds[j]!;
      if (allScalarInputs) {
        if (extraDimsPerArg[j]! > 0) {
          if (dae.getExprKind(argId) === ExprKind.ArrayCtor) {
            const elems = getArrayCtorElements(argId, dae);
            subArgs.push(elems[i] ?? argId);
          } else {
            subArgs.push(dae.addSubscriptExpr(argId, [dae.addIntLiteral(i + 1)]));
          }
        } else {
          subArgs.push(argId);
        }
      } else {
        if (j === targetIdx) {
          if (dae.getExprKind(argId) === ExprKind.ArrayCtor) {
            const elems = getArrayCtorElements(argId, dae);
            subArgs.push(elems[i] ?? argId);
          } else {
            subArgs.push(dae.addSubscriptExpr(argId, [dae.addIntLiteral(i + 1)]));
          }
        } else {
          subArgs.push(argId);
        }
      }
    }

    let subHasExtra = false;
    for (let p = 0; p < subArgs.length; p++) {
      const expLen = inputShapes[p]?.length ?? 0;
      const actLen = (getExprDims(subArgs[p]!, dae, db) ?? []).length;
      if (actLen > expLen) {
        subHasExtra = true;
        break;
      }
    }

    if (subHasExtra) {
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
    } else if (fnDae) {
      const constVals: any[] = [];
      let allConst = true;
      for (const sa of subArgs) {
        if (exprContainsNameRef(sa, dae)) {
          allConst = false;
          break;
        }
        const v = evalDaeExpr(sa, dae);
        if (v !== null && v !== undefined) {
          constVals.push(v);
        } else {
          allConst = false;
          break;
        }
      }
      if (allConst && constVals.length === subArgs.length) {
        try {
          const fnInternId = typeof fnName === "string" ? dae.interner.intern(fnName) : fnName;
          const outVal = evaluateArenaFunctionCall(
            dae,
            fnInternId,
            constVals,
            db,
            flattener?.currentRootClassId ?? undefined,
          );
          if (outVal !== null && outVal !== undefined) {
            (fnDae as any).wasCalled = true;
            for (const f of dae.functions.values()) {
              if (f.name === fnDae.name) {
                (f as any).wasCalled = true;
              }
            }
            let firstOutputType: VarType | null = null;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                firstOutputType = fnDae.getVarType(i);
                break;
              }
            }
            const inlinedId = addArenaValueAsExpr(dae, outVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) {
              elemResults.push(inlinedId);
              continue;
            }
          }
        } catch {
          // ignore evaluation error and fall through
        }
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
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(exprId, dae);
        return dae.addArrayCtorExpr(elems.map((e) => distributeDer(e)));
      }
      if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(exprId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) return distributeDer(ctor);
        }
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
    const distributePre = (exprId: number): number => {
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(exprId, dae);
        return dae.addArrayCtorExpr(elems.map((e) => distributePre(e)));
      }
      if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(exprId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) return distributePre(ctor);
        }
      }
      return dae.addPreExpr(exprId);
    };
    return distributePre(argId);
  }

  // Builtin initial() and terminal()
  if (
    (type === "primary" || type === "lhs_primary") &&
    node.childCount >= 1 &&
    (firstChildToken === "initial" ||
      firstChildToken === "terminal" ||
      node.child(0)?.text === "initial" ||
      node.child(0)?.text === "terminal") &&
    (node.text?.replace(/\s+/g, "") === "initial()" || node.text?.replace(/\s+/g, "") === "terminal()")
  ) {
    const fnName = node.child(0)?.text?.trim() ?? "initial";
    return dae.addCallExpr(fnName, []);
  }

  // Function call: component_reference "(" ... ")"
  if (
    type === "function_call" ||
    ((type === "primary" || type === "lhs_primary" || type === "statement" || type === "statement_or_procedure") &&
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
    let argExprIds: number[] = [];
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
      const cleanFn = fnName.startsWith(".") ? fnName.slice(1) : fnName;
      if (
        hasComprehensionFor &&
        (cleanFn === "sum" || cleanFn === "product" || cleanFn === "min" || cleanFn === "max" || cleanFn === "array")
      ) {
        const fChildren = fArgsNode.children || [];
        const forIdx = fChildren.findIndex((c: any) => c.text === "for" || c.type === "for");
        const bodyNode = forIdx > 0 ? fChildren[forIdx - 1] : fChildren[0];
        const forIndicesNode = fChildren.find((c: any) => c.type === "for_indices");

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
            if (cleanFn === "sum") {
              const plusOps = ops?.get("'+'") ?? ops?.get("+");
              if (plusOps && plusOps.length > 0) {
                const plusOp = plusOps[0];
                flattener?.usedOperatorFunctions?.set(plusOp.qualifiedName, plusOp.funcSymId);
              }
            } else if (cleanFn === "product") {
              const mulOps = ops?.get("'*'") ?? ops?.get("*");
              if (mulOps && mulOps.length > 0) {
                const mulOp = mulOps[0];
                flattener?.usedOperatorFunctions?.set(mulOp.qualifiedName, mulOp.funcSymId);
              }
            }
          }
        }

        const forIndices = (forIndicesNode?.children || []).filter(
          (k: any) => k.type === "for_index" || k.type === "ForIndex",
        );
        const iters: { name: string; values: (number | string)[] }[] = [];
        for (const fi of forIndices) {
          const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
          if (!varName) continue;
          const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
          let values: (number | string)[] = [];
          const isImplicit = !rangeNode;
          if (rangeNode) {
            const colonNodes = flattenColonNodes(rangeNode);
            if (colonNodes.length >= 2) {
              const s = evaluateCSTNumber(colonNodes[0], substitutions as any, undefined, db, dae, prefix);
              let e: number | null = null;
              let step = 1;
              if (colonNodes.length === 2) {
                e = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix);
              } else if (colonNodes.length >= 3) {
                step = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix) ?? 1;
                e = evaluateCSTNumber(colonNodes[2], substitutions as any, undefined, db, dae, prefix);
              }
              if (s !== null && e !== null) {
                for (let val = s; step > 0 ? val <= e : val >= e; val += step) values.push(val);
              }
            } else {
              const rangeText = rangeNode.text?.trim() ?? "";
              if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                const items = getArrayLiteralItems(rangeNode);
                for (const item of items) {
                  const v = evaluateCSTNumber(item, substitutions as any, undefined, db, dae, prefix);
                  if (v !== null) values.push(v);
                }
              }
            }
          }
          if (values.length === 0) {
            values = findArraySubscriptsForIter(bodyNode, varName, dae, db, prefix, isImplicit, fi);
          }
          if (values.length > 0) {
            iters.push({ name: varName, values });
          }
        }

        if (cleanFn === "array") {
          if (iters.length === 1) {
            const iter = iters[0]!;
            flattener?.activeLoopVars?.add(iter.name);
            const elemIds: number[] = [];
            for (const val of iter.values) {
              const newSubs = new Map(substitutions);
              newSubs.set(iter.name, val);
              elemIds.push(lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener));
            }
            flattener?.activeLoopVars?.delete(iter.name);
            return dae.addArrayCtorExpr(elemIds);
          } else if (iters.length === 2) {
            const iter1 = iters[0]!;
            const iter2 = iters[1]!;
            flattener?.activeLoopVars?.add(iter1.name);
            flattener?.activeLoopVars?.add(iter2.name);
            const rowIds: number[] = [];
            for (const val2 of iter2.values) {
              const colIds: number[] = [];
              for (const val1 of iter1.values) {
                const newSubs = new Map(substitutions);
                newSubs.set(iter1.name, val1);
                newSubs.set(iter2.name, val2);
                colIds.push(lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener));
              }
              rowIds.push(dae.addArrayCtorExpr(colIds));
            }
            flattener?.activeLoopVars?.delete(iter1.name);
            flattener?.activeLoopVars?.delete(iter2.name);
            return dae.addArrayCtorExpr(rowIds);
          }
        } else if (cleanFn === "sum" || cleanFn === "product") {
          if (iters.length > 0) {
            const tuples = cartesianProduct(iters.map((it) => it.values));
            for (const it of iters) flattener?.activeLoopVars?.add(it.name);
            const terms: number[] = [];
            for (const tuple of tuples) {
              const newSubs = new Map(substitutions);
              for (let idx = 0; idx < iters.length; idx++) {
                newSubs.set(iters[idx]!.name, tuple[idx]!);
              }
              terms.push(lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener));
            }
            for (const it of iters) flattener?.activeLoopVars?.delete(it.name);

            const numValues: number[] = [];
            let allConstant = true;
            for (const termId of terms) {
              const ev = evalDaeExpr(termId, dae);
              if (typeof ev === "number") {
                numValues.push(ev);
              } else {
                allConstant = false;
                break;
              }
            }
            if (allConstant && numValues.length > 0) {
              const shape = iters.map((it) => it.values.length);
              const resVal = reduceNestedValues(numValues, shape, cleanFn === "sum" ? "sum" : "product");
              return dae.addRealLiteral(resVal);
            } else if (terms.length > 0) {
              const op = cleanFn === "sum" ? BinOp.Add : BinOp.Mul;
              let accId = terms[0]!;
              for (let idx = 1; idx < terms.length; idx++) {
                accId = dae.addBinaryExpr(op, accId, terms[idx]!);
              }
              return accId;
            }
          }
        } else if (cleanFn === "min" || cleanFn === "max") {
          if (forIndices.length === 1) {
            const fi = forIndices[0]!;
            const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k: any) => k.type === "expression");
            if (rangeNode) {
              const rangeText = rangeNode.text?.trim() ?? "";
              if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                const items = getArrayLiteralItems(rangeNode);
                const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
                if (bodyNode.text?.trim() === varName) {
                  let bestNum: number | null = null;
                  const nonConsts: number[] = [];
                  let hasFloat = false;
                  for (const it of items) {
                    const lId = lowerCSTExpression(it, dae, prefix, substitutions, imports, db, flattener);
                    const ev = evalDaeExpr(lId, dae);
                    if (typeof ev === "number") {
                      if (!Number.isInteger(ev)) hasFloat = true;
                      if (bestNum === null) {
                        bestNum = ev;
                      } else {
                        bestNum = cleanFn === "max" ? Math.max(bestNum, ev) : Math.min(bestNum, ev);
                      }
                    } else {
                      nonConsts.push(lId);
                    }
                  }
                  if (bestNum !== null) {
                    const bestId = hasFloat ? dae.addRealLiteral(bestNum) : dae.addIntLiteral(bestNum);
                    if (nonConsts.length === 0) {
                      return bestId;
                    }
                    return dae.addCallExpr(cleanFn, [bestId, ...nonConsts]);
                  } else if (nonConsts.length > 0) {
                    if (nonConsts.length === 1) return nonConsts[0]!;
                    return dae.addCallExpr(cleanFn, nonConsts);
                  }
                }
              }
            }
          }
          if (iters.length === 1 && iters[0]!.values.length === 1) {
            const val = iters[0]!.values[0]!;
            const newSubs = new Map(substitutions);
            newSubs.set(iters[0]!.name, val);
            return lowerCSTExpression(bodyNode, dae, prefix, newSubs, imports, db, flattener);
          }

          const iterators: { name: string; rangeId: number }[] = [];
          if (iters.length > 0) {
            for (const it of iters) {
              const rangeItems = it.values.map((v) =>
                typeof v === "number"
                  ? dae.addIntLiteral(v)
                  : dae.addExpression(ExprKind.Name, dae.interner.intern(String(v))),
              );
              const evalRangeId = dae.addArrayCtorExpr(rangeItems);
              iterators.push({ name: it.name, rangeId: evalRangeId });
            }
          } else if (forIndicesNode) {
            for (const idxNode of forIndicesNode.children || []) {
              if (idxNode.type === "for_index") {
                const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
                const rangeNode = idxNode.childForFieldName?.("range") ?? idxNode.child(2) ?? idxNode.child(1);
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
          for (const it of iters) flattener?.activeLoopVars?.add(it.name);
          const bodyId = lowerCSTExpression(bodyNode, dae, prefix, substitutions, imports, db, flattener);
          for (const it of iters) flattener?.activeLoopVars?.delete(it.name);
          return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
        }

        const iterators: { name: string; rangeId: number }[] = [];
        if (forIndicesNode) {
          for (const idxNode of forIndicesNode.children || []) {
            if (idxNode.type === "for_index") {
              const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
              const rangeNode = idxNode.childForFieldName?.("range") ?? idxNode.child(2) ?? idxNode.child(1);
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

        return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
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
      const prevInsidePrevious = (dae as any).isInsidePrevious;
      if (fnName === "previous") {
        (dae as any).isInsidePrevious = true;
      }
      try {
        collectArgs(argsNode);
      } finally {
        (dae as any).isInsidePrevious = prevInsidePrevious;
      }
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

    if (fnName === "sin" || fnName === "cos" || fnName === "tan" || fnName === "exp" || fnName === "log") {
      for (let i = 0; i < argExprIds.length; i++) {
        argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
      }
    }

    if (fnName === "transition") {
      const fromExpr = namedArgs.get("from") ?? (argExprIds.length >= 1 ? argExprIds[0]! : -1);
      const toExpr = namedArgs.get("to") ?? (argExprIds.length >= 2 ? argExprIds[1]! : -1);
      if (fromExpr >= 0 && toExpr >= 0) {
        const condExpr =
          namedArgs.get("condition") ??
          (argExprIds.length >= 3 ? argExprIds[2]! : dae.addExpression(ExprKind.BoolLiteral, 1));
        const immediateExpr =
          namedArgs.get("immediate") ??
          (argExprIds.length > 3 ? argExprIds[3]! : dae.addExpression(ExprKind.BoolLiteral, 0));
        const resetExpr =
          namedArgs.get("reset") ??
          (argExprIds.length > 4 ? argExprIds[4]! : dae.addExpression(ExprKind.BoolLiteral, 1));
        const syncExpr =
          namedArgs.get("synchronize") ??
          (argExprIds.length > 5 ? argExprIds[5]! : dae.addExpression(ExprKind.BoolLiteral, 0));
        const priorityExpr =
          namedArgs.get("priority") ?? (argExprIds.length > 6 ? argExprIds[6]! : dae.addIntLiteral(1));

        return dae.addCallExpr("transition", [
          fromExpr,
          toExpr,
          condExpr,
          immediateExpr,
          resetExpr,
          syncExpr,
          priorityExpr,
        ]);
      }
    }

    if (fnName === "subSample" && argExprIds.length === 1) {
      argExprIds.push(dae.addIntLiteral(0));
    } else if (fnName === "superSample" && argExprIds.length === 1) {
      argExprIds.push(dae.addIntLiteral(0));
    } else if (fnName === "shiftSample" && argExprIds.length === 2) {
      argExprIds.push(dae.addIntLiteral(1));
    } else if (fnName === "backSample" && argExprIds.length === 2) {
      argExprIds.push(dae.addIntLiteral(1));
    } else if (fnName === "sample") {
      if (argExprIds.length === 1) {
        argExprIds.push(dae.addCallExpr("Clock", []));
      } else if (argExprIds.length === 2) {
        for (let i = 0; i < 2; i++) {
          if (!isRealExpr(argExprIds[i]!, dae)) {
            argExprIds[i] = castToRealExpr(argExprIds[i]!, dae);
          }
        }
      }
    } else if (
      fnName === "Clock" &&
      argExprIds.length === 1 &&
      dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral
    ) {
      argExprIds.push(dae.addIntLiteral(1));
    }

    if ((fnName === "vector" || fnName === "matrix") && argExprIds.length === 1) {
      let argId = argExprIds[0]!;
      if (dae.getExprKind(argId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(argId));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) argId = ctor;
        }
      }
      const flattenArrayElems = (exprId: number): number[] => {
        if (exprId < 0) return [];
        if (dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
          const count = dae.getExprData1(exprId);
          const res: number[] = [];
          for (let i = 0; i < count; i++) {
            res.push(...flattenArrayElems(i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i)));
          }
          return res;
        }
        return [exprId];
      };

      if (fnName === "vector") {
        const flat = flattenArrayElems(argId);
        return dae.addArrayCtorExpr(flat);
      } else {
        const rank = getArrayCtorRank(argId, dae);
        if (rank === 0) {
          return dae.addArrayCtorExpr([dae.addArrayCtorExpr([argId])]);
        } else if (rank === 1) {
          const elems = getArrayCtorElements(argId, dae);
          const rows = elems.map((e) => dae.addArrayCtorExpr([e]));
          return dae.addArrayCtorExpr(rows);
        } else if (rank === 2) {
          return argId;
        } else {
          const outerRows = getArrayCtorElements(argId, dae);
          const rows = outerRows.map((r) => dae.addArrayCtorExpr(flattenArrayElems(r)));
          return dae.addArrayCtorExpr(rows);
        }
      }
    }

    if (fnName === "noClock" && argExprIds.length === 1 && dae.getExprKind(argExprIds[0]!) === ExprKind.ArrayCtor) {
      const elems = getArrayCtorElements(argExprIds[0]!, dae);
      return dae.addArrayCtorExpr(elems.map((el) => dae.addCallExpr("noClock", [el])));
    }

    const vectorizedCall = vectorizeFunctionCall(cleanFnName || fnName, argExprIds, dae, flattener, db);
    if (vectorizedCall !== null) {
      return vectorizedCall;
    }
    if (fnName === "array" || cleanFnName === "array") {
      if (argExprIds.length > 1) {
        const firstDims = getExprDims(argExprIds[0]!, dae, flattener.db);
        for (let i = 1; i < argExprIds.length; i++) {
          const dims = getExprDims(argExprIds[i]!, dae, flattener.db);
          if (firstDims && dims && (firstDims.length !== dims.length || firstDims.some((d, idx) => d !== dims[idx]))) {
            const startB = node.startIndex ?? node.startByte;
            const endB = node.endIndex ?? node.endByte;
            dae.diagnostics.push({
              severity: "error",
              message: `Different dimension sizes in arguments to array in component <NO COMPONENT>.`,
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
      }
      return dae.addArrayCtorExpr(argExprIds);
    }
    if (fnName === "transpose" || cleanFnName === "transpose") {
      if (argExprIds.length === 1) {
        let matId = argExprIds[0]!;
        if (dae.getExprKind(matId) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(matId));
          if (vName && dae.hasArrayElements(vName)) {
            const ctor = expandVarToArrayCtor(vName, dae);
            if (ctor !== null) matId = ctor;
          }
        }
        if (dae.getExprKind(matId) === ExprKind.ArrayCtor) {
          const rows = getArrayCtorElements(matId, dae);
          if (rows.length === 0) return matId;
          const firstRowKind = dae.getExprKind(rows[0]!);
          if (firstRowKind === ExprKind.ArrayCtor) {
            const numRows = rows.length;
            const cols0 = getArrayCtorElements(rows[0]!, dae);
            const numCols = cols0.length;
            const transposedRows: number[] = [];
            for (let c = 0; c < numCols; c++) {
              const newRowCols: number[] = [];
              for (let r = 0; r < numRows; r++) {
                const rCols = getArrayCtorElements(rows[r]!, dae);
                newRowCols.push(rCols[c]!);
              }
              transposedRows.push(dae.addArrayCtorExpr(newRowCols));
            }
            return dae.addArrayCtorExpr(transposedRows);
          }
        }
      }
    }
    if (fnName === "zeros" || cleanFnName === "zeros" || fnName === "ones" || cleanFnName === "ones") {
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
        const valLit = fnName === "ones" || cleanFnName === "ones" ? dae.addIntLiteral(1) : dae.addRealLiteral(0.0);
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
      if (!allStatic && argExprIds.length > 0) {
        const valLit = fnName === "ones" || cleanFnName === "ones" ? dae.addIntLiteral(1) : dae.addRealLiteral(0.0);
        return dae.addCallExpr("fill", [valLit, ...argExprIds]);
      }
    }

    if ((fnName === "linspace" || cleanFnName === "linspace") && argExprIds.length === 3) {
      const [startId, stopId, numId] = argExprIds;
      const numVal = evalDaeExpr(numId!, dae);
      if (typeof numVal !== "number") {
        const iMinus1 = dae.addBinaryExpr(BinOp.Add, dae.addIntLiteral(-1), dae.addNameExpr("i"));
        const iCast = dae.addCallExpr("/*Real*/", [iMinus1]);
        const nMinus1 = dae.addBinaryExpr(BinOp.Add, dae.addIntLiteral(-1), numId!);
        const nCast = dae.addCallExpr("/*Real*/", [nMinus1]);
        const frac = dae.addBinaryExpr(BinOp.Div, iCast, nCast);

        const startVal = evalDaeExpr(startId!, dae);
        const stopVal = evalDaeExpr(stopId!, dae);
        let bodyId = frac;
        if (startVal === 0 && stopVal === 1) {
          bodyId = frac;
        } else {
          const diff = dae.addBinaryExpr(BinOp.Sub, stopId!, startId!);
          const scaled = dae.addBinaryExpr(BinOp.Mul, diff, frac);
          bodyId = dae.addBinaryExpr(BinOp.Add, startId!, scaled);
        }
        const rangeId = dae.addRangeExpr(dae.addIntLiteral(1), numId!);
        return dae.addComprehensionExpr("array", bodyId, [{ name: "i", rangeId }]);
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

    if (fnName === "sum" || cleanFnName === "sum" || fnName === "product" || cleanFnName === "product") {
      if (argExprIds.length === 1) {
        const arrArg = argExprIds[0]!;
        if (dae.getExprKind(arrArg) === ExprKind.ArrayCtor) {
          const rawElems = getArrayCtorElements(arrArg, dae);
          const flattenElements = (elemId: number): number[] => {
            if (dae.getExprKind(elemId) === ExprKind.ArrayCtor) {
              const sub = getArrayCtorElements(elemId, dae);
              return sub.flatMap(flattenElements);
            }
            return [elemId];
          };
          const elems = rawElems.flatMap(flattenElements);
          const isSum = fnName === "sum" || cleanFnName === "sum";
          const op = isSum ? BinOp.Add : BinOp.Mul;
          if (elems.length === 0) {
            return isSum ? dae.addRealLiteral(0.0) : dae.addRealLiteral(1.0);
          }
          let res = elems[0]!;
          for (let i = 1; i < elems.length; i++) {
            res = dae.addBinaryExpr(op, res, elems[i]!);
          }
          return res;
        }
      }
    }

    if (fnName === "scalar" || cleanFnName === "scalar") {
      if (argExprIds.length === 1) {
        let curr = argExprIds[0]!;
        if (dae.getExprKind(curr) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(curr));
          if (vName && dae.hasArrayElements(vName)) {
            const ctor = expandVarToArrayCtor(vName, dae);
            if (ctor !== null) curr = ctor;
          }
        }
        while (dae.getExprKind(curr) === ExprKind.ArrayCtor) {
          const elems = getArrayCtorElements(curr, dae);
          if (elems.length === 1) {
            curr = elems[0]!;
          } else {
            break;
          }
        }
        return curr;
      }
    }

    if (fnName === "ndims" || cleanFnName === "ndims") {
      if (argExprIds.length >= 1) {
        const arrId = argExprIds[0]!;
        const dims = getExprDims(arrId, dae, db);
        if (dims && dims.length > 0) {
          return dae.addIntLiteral(dims.length);
        }
      }
    }

    if ((fnName === "size" || cleanFnName === "size") && argExprIds.length >= 1) {
      const arrId = argExprIds[0]!;
      const dims = getExprDims(arrId, dae, db);
      if (dims && dims.length > 0) {
        if (argExprIds.length === 1 && dims.every((d) => d >= 0)) {
          return dae.addArrayCtorExpr(dims.map((d) => dae.addIntLiteral(d)));
        }
        if (argExprIds.length >= 2) {
          const dVal = evalDaeExpr(argExprIds[1]!, dae);
          if (typeof dVal === "number") {
            const dimIdx = Math.trunc(dVal);
            if (dimIdx >= 1 && dimIdx <= dims.length) {
              const d = dims[dimIdx - 1]!;
              if (d >= 0) {
                return dae.addIntLiteral(d);
              }
            }
          }
        }
      }

      let dim = 1;
      if (argExprIds.length >= 2) {
        const dVal = evalDaeExpr(argExprIds[1]!, dae);
        if (typeof dVal === "number") dim = Math.trunc(dVal);
      }

      const arrKind = dae.getExprKind(arrId);
      if (arrKind === ExprKind.ArrayCtor) {
        if (dim === 1 && argExprIds.length >= 2) {
          return dae.addIntLiteral(dae.getExprData1(arrId));
        }
      } else if (arrKind === ExprKind.Name) {
        const name = dae.interner.resolve(dae.getExprData1(arrId));
        if (name) {
          const namedShape =
            (dae as any).getNamedArrayShape?.(name) ??
            (dae as any).namedArrayShapes?.get(name) ??
            (dae as any).getNamedArrayShape?.(resolveScopedName(name, prefix, dae)) ??
            (dae as any).namedArrayShapes?.get(resolveScopedName(name, prefix, dae));
          if (namedShape && namedShape.length > 0) {
            if (argExprIds.length === 1 && namedShape.every((d: number) => d > 0)) {
              return dae.addArrayCtorExpr(namedShape.map((d: number) => dae.addIntLiteral(d)));
            }
            if (namedShape.length >= dim && namedShape[dim - 1]! > 0) {
              return dae.addIntLiteral(namedShape[dim - 1]!);
            }
          }
          const vIdx = dae.lookupVariable(name);
          if (vIdx >= 0) {
            const shape = dae.getVarShape(vIdx);
            if (shape && shape.length > 0) {
              if (argExprIds.length === 1 && shape.every((d: number) => d > 0)) {
                return dae.addArrayCtorExpr(shape.map((d: number) => dae.addIntLiteral(d)));
              }
              if (shape.length >= dim && shape[dim - 1]! > 0) {
                return dae.addIntLiteral(shape[dim - 1]!);
              }
            }
          }

          if (argExprIds.length >= 2) {
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
    }

    if (fnName === "cat" || cleanFnName === "cat") {
      if (argExprIds.length >= 2) {
        const catDim = evalDaeExpr(argExprIds[0]!, dae);
        const arrs = argExprIds.slice(1).map((a) => {
          if (dae.getExprKind(a) === ExprKind.Name) {
            const vName = dae.interner.resolve(dae.getExprData1(a));
            if (vName && dae.hasArrayElements(vName)) {
              const ctor = expandVarToArrayCtor(vName, dae);
              if (ctor !== null) return ctor;
            }
          }
          return a;
        });
        if (typeof catDim === "number" && catDim >= 1 && Number.isInteger(catDim)) {
          const catRecursive = (dim: number, arrIds: number[]): number => {
            if (arrIds.length === 0) return dae.addArrayCtorExpr([]);
            if (dim === 1) {
              const flatElems: number[] = [];
              for (const a of arrIds) {
                if (dae.getExprKind(a) === ExprKind.ArrayCtor) {
                  flatElems.push(...getArrayCtorElements(a, dae));
                } else {
                  flatElems.push(a);
                }
              }
              return dae.addArrayCtorExpr(flatElems);
            }
            const elemLists = arrIds.map((a) =>
              dae.getExprKind(a) === ExprKind.ArrayCtor ? getArrayCtorElements(a, dae) : [a],
            );
            const maxLen = Math.max(...elemLists.map((l) => l.length));
            const res: number[] = [];
            for (let i = 0; i < maxLen; i++) {
              const slice: number[] = [];
              for (const l of elemLists) {
                if (i < l.length) {
                  slice.push(l[i]!);
                } else if (l.length === 1) {
                  slice.push(l[0]!);
                }
              }
              res.push(catRecursive(dim - 1, slice));
            }
            return dae.addArrayCtorExpr(res);
          };
          return catRecursive(catDim, arrs);
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
      if (argExprIds.length === 1 && isRealExpr(argExprIds[0]!, dae)) {
        argExprIds.push(dae.addIntLiteral(6));
        argExprIds.push(dae.addIntLiteral(0));
        argExprIds.push(dae.addBoolLiteral(true));
      }
      return dae.addCallExpr("String", argExprIds);
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

    const hasParentRedecl = Boolean(
      flattener?.currentParentMods?.args?.some(
        (a: any) =>
          !a.isBreak &&
          (a.name === cleanFnName || (!cleanFnName.includes(".") && a.name === cleanFnName)) &&
          (a.isRedeclaration || a.redeclaredTypeSpecifier),
      ),
    );

    let fnDae =
      hasParentRedecl || (fnName.startsWith(".") && !cleanFnName.includes("."))
        ? undefined
        : (dae.getFunction(fnName) ?? (cleanFnName ? dae.getFunction(cleanFnName) : undefined));
    if (!fnDae && !hasParentRedecl && cleanFnName && !cleanFnName.includes(".") && !fnName.startsWith(".")) {
      fnDae = dae.getFunction(cleanFnName);
    }
    if (fnName.startsWith(".")) {
      fnName = cleanFnName;
    }
    if (fnDae && (fnDae as any).aliasTo) {
      fnName = (fnDae as any).aliasTo;
      fnDae = undefined;
    }
    if (
      !fnDae &&
      flattener &&
      db &&
      cleanFnName &&
      cleanFnName !== "String" &&
      cleanFnName !== "Real" &&
      cleanFnName !== "Integer" &&
      cleanFnName !== "Boolean" &&
      cleanFnName !== "print"
    ) {
      const parts = cleanFnName.split(".");
      const fnBase = parts[parts.length - 1];
      let matchingFnSym: any = null;
      let specializedQualifiedName: string | null = null;
      let enclosingScopeId: SymbolId | undefined = undefined;

      // 1. Check if parentMods redeclared this function (e.g. RedeclareFunction1.mo)
      const currentParentMods = flattener?.currentParentMods;
      const redeclArg = currentParentMods?.args?.find(
        (a: any) =>
          !a.isBreak &&
          (a.name === cleanFnName || (parts.length === 1 && a.name === parts[0])) &&
          (a.isRedeclaration || a.redeclaredTypeSpecifier),
      );
      if (redeclArg?.redeclaredTypeSpecifier) {
        const ownerScopeId = currentParentMods?.ownerClassId ?? flattener?.currentClassId;
        const redeclTarget =
          (ownerScopeId
            ? db.query<(n: string) => SymbolEntry | null>(
                "resolveName",
                ownerScopeId,
              )?.(redeclArg.redeclaredTypeSpecifier)
            : null) ??
          (flattener?.currentClassId
            ? db.query<(n: string) => SymbolEntry | null>(
                "resolveName",
                flattener.currentClassId,
              )?.(redeclArg.redeclaredTypeSpecifier)
            : null) ??
          db
            .byName(redeclArg.redeclaredTypeSpecifier)
            .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
        if (redeclTarget) {
          matchingFnSym = redeclTarget;
          const ownerClassSym = ownerScopeId ? db.symbol(ownerScopeId) : null;
          const ownerName = ownerClassSym?.name ?? "";
          if (ownerName) {
            specializedQualifiedName = `${ownerName}.${redeclArg.name}`;
            enclosingScopeId = ownerScopeId;
          }
        }
      }

      // 2. Check if cleanFnName is a qualified call on a package/class (e.g. B.usePart, ClassExtends4.mo / ClassExtends6.mo)
      if (!matchingFnSym && parts.length > 1) {
        const prefixStr = parts.slice(0, -1).join(".");
        const fnBaseName = parts[parts.length - 1]!;
        const currentScope = flattener?.currentClassId ?? flattener?.currentRootClassId;
        let prefixSym = currentScope
          ? db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(prefixStr)
          : null;
        if (!prefixSym) {
          prefixSym = db.byName(parts[0]!).find((e: any) => e.kind === "Class" || e.kind === "Package") ?? null;
          for (let pIdx = 1; pIdx < parts.length - 1 && prefixSym; pIdx++) {
            prefixSym =
              db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(parts[pIdx]!) ?? null;
          }
        }
        if (prefixSym) {
          const memberFn = db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(fnBaseName);
          if (
            memberFn &&
            (memberFn.kind === "Class" || memberFn.kind === "Function") &&
            flattener.isFunctionSym?.(memberFn)
          ) {
            matchingFnSym = memberFn;
            const prefixQual = getSymbolQualifiedName(db, prefixSym.id);
            specializedQualifiedName = `${prefixQual}.${fnBaseName}`;
            enclosingScopeId = prefixSym.id;
          }
        }
      }

      // 3. Check if cleanFnName is an unqualified call in the current enclosing scope (e.g. part(a) inside B.usePart)
      if (!matchingFnSym && parts.length === 1) {
        // 3a. First check the enclosing scope for inherited functions (redeclare function extends).
        // When flattening an inherited function (e.g., usePart from A in B's scope),
        // the enclosing scope (B) may have redeclared sibling functions that should
        // take priority over the ones inherited from the original parent (A).
        const fnEncScope = (flattener as any)?.currentFunctionEnclosingScope as SymbolId | null;
        if (fnEncScope) {
          const encScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", fnEncScope)?.(cleanFnName);
          if (
            encScopeFn &&
            (encScopeFn.kind === "Class" || encScopeFn.kind === "Function") &&
            flattener.isFunctionSym?.(encScopeFn)
          ) {
            matchingFnSym = encScopeFn;
            const encScopeSym = db.symbol(fnEncScope);
            if (encScopeSym && (encScopeSym.kind === "Class" || encScopeSym.kind === "Package")) {
              const encScopeQual = getSymbolQualifiedName(db, fnEncScope);
              specializedQualifiedName = `${encScopeQual}.${cleanFnName}`;
              enclosingScopeId = fnEncScope;
            }
          }
        }

        // 3b. Fallback: check the current scope (function or class being flattened)
        if (!matchingFnSym) {
          const currentScope = flattener?.currentClassId ?? flattener?.currentFlatteningFunctionId;
          if (currentScope) {
            const inScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(cleanFnName);
            if (
              inScopeFn &&
              (inScopeFn.kind === "Class" || inScopeFn.kind === "Function") &&
              flattener.isFunctionSym?.(inScopeFn)
            ) {
              matchingFnSym = inScopeFn;
              let qualScopeId = flattener?.currentClassId;
              if (qualScopeId) {
                const scopeSym = db.symbol(qualScopeId);
                if (scopeSym && flattener.isFunctionSym?.(scopeSym)) {
                  qualScopeId = scopeSym.parentId ?? qualScopeId;
                }
              }
              if (qualScopeId) {
                const scopeSym = db.symbol(qualScopeId);
                if (scopeSym && (scopeSym.kind === "Class" || scopeSym.kind === "Package")) {
                  const isClassAncestor = (
                    ancestorId: SymbolId,
                    descendantId: SymbolId,
                    visited = new Set<SymbolId>(),
                  ): boolean => {
                    if (ancestorId === descendantId) return true;
                    if (visited.has(descendantId)) return false;
                    visited.add(descendantId);
                    const extendsChildren = db.childrenOf(descendantId).filter((c) => c.kind === "Extends");
                    for (const ext of extendsChildren) {
                      const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
                      const baseTargets = baseClass ? [baseClass] : db.byName(ext.name);
                      for (const target of baseTargets) {
                        if (target.id === ancestorId || isClassAncestor(ancestorId, target.id, visited)) {
                          return true;
                        }
                      }
                    }
                    return false;
                  };

                  const isDirectChild = inScopeFn.parentId === qualScopeId;
                  const isInherited = inScopeFn.parentId != null && isClassAncestor(inScopeFn.parentId, qualScopeId);
                  if (isDirectChild || isInherited) {
                    const scopeQual = getSymbolQualifiedName(db, qualScopeId);
                    specializedQualifiedName = `${scopeQual}.${cleanFnName}`;
                    enclosingScopeId = qualScopeId;
                  }
                }
              }
            }
          }
        }
      }

      // 4. Fallback to existing search
      if (!matchingFnSym) {
        matchingFnSym = db.byName(fnBase).find((e: any) => {
          if (e.kind !== "Class") return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
      }

      if (matchingFnSym && flattener.isExternalObject?.(matchingFnSym.id)) {
        const qualifiedName = getSymbolQualifiedName(db, matchingFnSym.id);
        const ctorName = `${qualifiedName}.constructor`;
        flattener.usedExternalObjects?.add(matchingFnSym.id);
        return dae.addCallExpr(ctorName, argExprIds);
      }
      if (matchingFnSym && (flattener.isRecordSym(matchingFnSym) || flattener.isOperatorRecordSym(matchingFnSym))) {
        let ctorFn = dae.getFunction(cleanFnName) ?? dae.getFunction(fnName);
        if (!ctorFn && flattener.generateRecordConstructorFor) {
          ctorFn = flattener.generateRecordConstructorFor(matchingFnSym, dae, flattener.currentRootClassId);
        }
        if (ctorFn) {
          fnDae = ctorFn;
          fnName = cleanFnName;
        }
      } else if (matchingFnSym && flattener.isFunctionSym(matchingFnSym)) {
        if (flattener.invalidInterfaceFunctionIds?.has(matchingFnSym.id)) {
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
        const qualifiedFnName = specializedQualifiedName ?? getSymbolQualifiedName(db, matchingFnSym.id);
        flattener.calledFunctionSymIds?.add(matchingFnSym.id);
        const fn = flattener.flattenFunction(matchingFnSym.id, qualifiedFnName, undefined, dae, enclosingScopeId);
        if (fn.diagnostics.some((d: any) => d.severity === "error")) {
          for (const d of fn.diagnostics) {
            if (!dae.diagnostics.some((existing: any) => existing.message === d.message)) {
              dae.diagnostics.push(d);
            }
          }
          flattener.failedFunctionIds?.add(matchingFnSym.id);
          const hasInterfaceError = fn.diagnostics.some(
            (d: any) => d.severity === "error" && !d.message.includes("looking for a function or record"),
          );
          if (hasInterfaceError) {
            flattener.invalidInterfaceFunctionIds?.add(matchingFnSym.id);
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
          }
          return dae.addCallExpr(fnName, argExprIds);
        }
        if ((fn as any).aliasTo) {
          fnName = (fn as any).aliasTo;
          fnDae = undefined;
        } else {
          dae.addFunction(qualifiedFnName, fn);
          if (!specializedQualifiedName) {
            dae.addFunction(cleanFnName, fn);
            dae.addFunction(fnName, fn);
            if (parts.length === 1 && fnBase) dae.addFunction(fnBase, fn);
          }

          let rootDae: any = (flattener as any)?.currentRootDae ?? dae;
          while (rootDae.parentDae) rootDae = rootDae.parentDae;
          rootDae.addFunction(qualifiedFnName, fn);
          if (fn.functions && fn.functions.size > 0) {
            for (const [nestedName, nestedFn] of fn.functions.entries()) {
              rootDae.addFunction(nestedName, nestedFn);
            }
          }
          fnDae = fn;
          if (fn.externalDecl && fn.externalDecl.includes('"builtin"')) {
            fnName = cleanFnName || fnBase;
          } else {
            fnName = qualifiedFnName;
          }
        }
        if (qualifiedFnName.startsWith("Modelica.Math.")) {
          const mathBase = qualifiedFnName.slice("Modelica.Math.".length);
          if (
            mathBase === "sin" ||
            mathBase === "cos" ||
            mathBase === "tan" ||
            mathBase === "asin" ||
            mathBase === "acos" ||
            mathBase === "atan" ||
            mathBase === "atan2" ||
            mathBase === "sinh" ||
            mathBase === "cosh" ||
            mathBase === "tanh" ||
            mathBase === "exp" ||
            mathBase === "log" ||
            mathBase === "log10" ||
            mathBase === "sqrt"
          ) {
            fnName = mathBase;
            fnDae = undefined;
          }
        }
      } else if (!matchingFnSym) {
        const isBuiltin =
          SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) ||
          (!cleanFnName.includes(".") && SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase)) ||
          BUILTIN_FUNCTIONS.has(cleanFnName) ||
          (!cleanFnName.includes(".") && BUILTIN_FUNCTIONS.has(fnBase)) ||
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
          cleanFnName === "transpose" ||
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
          const scopeId = (flattener as any).currentFlatteningFunctionId ?? flattener.currentRootClassId;
          const scopeName = (scopeId ? db.symbol(scopeId)?.name : "") ?? "";
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
      if (flattener.options.omcCompatibility) {
        // Check for cyclic dependencies in default arguments
        const unfilledDefaults = new Map<string, Set<string>>();
        const positionalCount = argExprIds.length;
        let inCount = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Input) {
            const inputName = fnDae.getVarName(i);
            const isProvided = namedArgs.has(inputName) || inCount < positionalCount;
            inCount++;
            if (!isProvided) {
              const defExprId = fnDae.getVarExpression(i);
              if (typeof defExprId === "number" && defExprId >= 0) {
                const collectNames = (eId: number, names: Set<string>): void => {
                  if (eId < 0) return;
                  if (fnDae.getExprKind(eId) === ExprKind.Name) {
                    names.add(fnDae.interner.resolve(fnDae.getExprData1(eId)));
                    return;
                  }
                  const l = fnDae.getExprLeft(eId);
                  const r = fnDae.getExprRight(eId);
                  if (l >= 0) collectNames(l, names);
                  if (r >= 0) collectNames(r, names);
                };
                const names = new Set<string>();
                collectNames(defExprId, names);
                unfilledDefaults.set(inputName, names);
              }
            }
          }
        }
        if (unfilledDefaults.size > 1) {
          const visited = new Set<string>();
          const inStack = new Set<string>();
          let cycleArg: string | null = null;
          const hasCycle = (curr: string): boolean => {
            visited.add(curr);
            inStack.add(curr);
            const neighbors = unfilledDefaults.get(curr);
            if (neighbors) {
              for (const next of neighbors) {
                if (unfilledDefaults.has(next)) {
                  if (inStack.has(next)) {
                    cycleArg = next;
                    return true;
                  }
                  if (!visited.has(next) && hasCycle(next)) {
                    return true;
                  }
                }
              }
            }
            inStack.delete(curr);
            return false;
          };
          for (const name of unfilledDefaults.keys()) {
            if (!visited.has(name) && hasCycle(name)) break;
          }
          if (cycleArg) {
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
              code: ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.code,
              message: ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.message(cycleArg),
              range: callRange,
            });
            return -1;
          }
        }
      }

      const positionalArgs = [...argExprIds];
      const newArgExprIds: number[] = [];
      let posIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const inputName = fnDae.getVarName(i);
          let aid: number | undefined = undefined;
          let argNode: any = undefined;
          if (namedArgs.has(inputName)) {
            aid = namedArgs.get(inputName)!;
          } else if (posIdx < positionalArgs.length) {
            aid = positionalArgs[posIdx];
            argNode = argNodes[posIdx];
            posIdx++;
          } else if (flattener.options.omcCompatibility) {
            const defExprId = fnDae.getVarExpression(i);
            if (typeof defExprId === "number" && defExprId >= 0) {
              const defId = copyExprBetweenDaes(fnDae, defExprId, dae);
              if (defId >= 0) {
                aid = defId;
              }
            }
          }
          if (aid !== undefined && aid >= 0) {
            const expectedShape = fnDae.getVarShape(i) ?? [];
            const actualDims = getExprDims(aid, dae, flattener.db) ?? [];
            const isColonDim = (d: number) => d === -1;
            const shapeMatches =
              expectedShape.length === actualDims.length &&
              expectedShape.every(
                (ed, idx) => isColonDim(ed) || isColonDim(actualDims[idx]!) || ed === actualDims[idx]!,
              );
            if (!shapeMatches) {
              const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
              const callArgsStr = positionalArgs.map((paId) => printer.printExprToString(paId)).join(", ");
              const callExpr = `${cleanFnName || fnName}(${callArgsStr})`;

              let retTypeStr = "Real";
              for (let vi = 0; vi < fnDae.varCount; vi++) {
                if (fnDae.getVarCausality(vi) === Causality.Output) {
                  const vt = fnDae.getVarType(vi);
                  retTypeStr =
                    vt === VarType.Integer
                      ? "Integer"
                      : vt === VarType.Boolean
                        ? "Boolean"
                        : vt === VarType.String
                          ? "String"
                          : "Real";
                  break;
                }
              }

              const callArgSigParts: string[] = [];
              const candArgSigParts: string[] = [];
              let inP = 0;
              for (let vi = 0; vi < fnDae.varCount; vi++) {
                if (fnDae.getVarCausality(vi) === Causality.Input) {
                  const pName = fnDae.getVarName(vi);
                  const expType = fnDae.getVarType(vi);
                  const expShape = fnDae.getVarShape(vi) ?? [];
                  const expTypeName =
                    expType === VarType.Integer
                      ? "Integer"
                      : expType === VarType.Boolean
                        ? "Boolean"
                        : expType === VarType.String
                          ? "String"
                          : "Real";
                  const expShapeStr = expShape.length > 0 ? `[${expShape.join(", ")}]` : "";
                  candArgSigParts.push(`${expTypeName}${expShapeStr} ${pName}`);

                  const provId = positionalArgs[inP];
                  if (provId !== undefined) {
                    const provType = inferArenaExprVarType(dae, provId);
                    const provDims = getExprDims(provId, dae, flattener.db) ?? [];
                    const provTypeName =
                      provType === VarType.Integer
                        ? "Integer"
                        : provType === VarType.Boolean
                          ? "Boolean"
                          : provType === VarType.String
                            ? "String"
                            : "Real";
                    const provDimsStr = provDims.length > 0 ? `[${provDims.join(", ")}]` : "";
                    callArgSigParts.push(`${provTypeName}${provDimsStr} ${pName}`);
                  }
                  inP++;
                }
              }

              const callSig = `.${cleanFnName || fnName}<function>(${callArgSigParts.join(", ")}) => ${retTypeStr} in component <NO COMPONENT>`;
              const candidateSig = `.${cleanFnName || fnName}<function>(${candArgSigParts.join(", ")}) => ${retTypeStr}`;

              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.NO_MATCHING_FUNCTION.code,
                message: ModelicaErrorCode.NO_MATCHING_FUNCTION.message(callExpr, callSig, candidateSig),
                range:
                  startB != null && endB != null
                    ? {
                        startByte: startB,
                        endByte: endB,
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                      }
                    : undefined,
              });
              return -1;
            }

            const expectedType = fnDae.getVarType(i);
            const expectedCustomType = fnDae.getVarCustomType(i);
            const providedType = inferArenaExprVarType(dae, aid);
            let finalType = providedType;
            if (
              expectedType === VarType.Real &&
              !expectedCustomType &&
              (providedType === VarType.Integer || providedType === null)
            ) {
              aid = castToRealExpr(aid, dae);
              finalType = VarType.Real;
            }
            if (
              finalType !== null &&
              !isAssignableType(finalType, expectedType, { intEnumConversion: flattener?.options?.intEnumConversion })
            ) {
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
              const argText = argNode?.text?.trim() ?? "...";
              const callText = `${cleanFnName || fnName}(${inputName}=${argText})`;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
                  callText,
                  String(newArgExprIds.length + 1),
                  varTypeName(finalType),
                  varTypeName(expectedType),
                ),
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return -1;
            }
            newArgExprIds.push(aid);
          }
        }
      }
      argExprIds = newArgExprIds;
    }

    if (fnDae && !(fnDae as any).isOperatorRecord && !fnDae.description?.includes("record constructor")) {
      let inputParamIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const reqVariability = fnDae.getVarVariability(i);
          if (reqVariability === Variability.Constant) {
            const actualArgId = argExprIds[inputParamIdx];
            if (actualArgId !== undefined && exprContainsNonConstantRef(actualArgId, dae)) {
              const paramName = fnDae.getVarName(i);
              const argNode = argNodes[inputParamIdx];
              const argText = argNode?.text?.trim() ?? dae.interner.resolve(dae.getExprData1(actualArgId)) ?? "";
              const funcName = cleanFnName || fnDae.name;

              let compClause: any = node;
              while (
                compClause &&
                compClause.type !== "component_clause" &&
                compClause.type !== "ComponentClause" &&
                compClause.type !== "equation" &&
                compClause.type !== "statement"
              ) {
                compClause = compClause.parent;
              }
              const diagNode = compClause ?? node;
              const startB = diagNode?.startIndex ?? diagNode?.startByte;
              const endB = diagNode?.endIndex ?? diagNode?.endByte;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.code,
                message: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.message(paramName, argText, funcName, "constant"),
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
          inputParamIdx++;
        }
      }
    }

    if (
      flattener.options.omcCompatibility &&
      fnDae &&
      fnDae.name.endsWith("Vectors.interpolate") &&
      argExprIds.length > 0
    ) {
      const firstArg = argExprIds[0];
      if (firstArg !== undefined && firstArg >= 0 && dae.getExprKind(firstArg) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(firstArg, dae);
        const literalElems: number[] = [];
        let allLiterals = true;
        for (const e of elems) {
          const val = evalDaeExpr(e, dae);
          if (typeof val === "number") {
            literalElems.push(dae.addRealLiteral(val));
          } else {
            allLiterals = false;
            break;
          }
        }
        if (allLiterals && literalElems.length === elems.length) {
          argExprIds[0] = dae.addArrayCtorExpr(literalElems);
        }
      }
    }

    if (fnDae && !(fnDae as any).isOperatorRecord && !fnDae.description?.includes("record constructor")) {
      let allConstant = true;
      const constArgs: any[] = [];
      for (const aid of argExprIds) {
        if (exprContainsNonConstantRef(aid, dae)) {
          allConstant = false;
          break;
        }
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
          const outVal = evaluateArenaFunctionCall(
            dae,
            fnInternId,
            constArgs,
            db,
            flattener?.currentRootClassId ?? undefined,
          );
          if (outVal !== null && outVal !== undefined) {
            (fnDae as any).wasCalled = true;
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

      if ((fnDae as any).isEarlyInline && fnDae.stmtCount === 1 && fnDae.getStmtKind(0) === StmtKind.Assignment) {
        const subs = new Map<string, number>();
        let inputIdx = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Input) {
            const inName = fnDae.getVarName(i);
            if (inputIdx < argExprIds.length) {
              subs.set(inName, argExprIds[inputIdx]);
            }
            inputIdx++;
          }
        }
        const rhsExprId = fnDae.getStmtLeft(0);
        if (rhsExprId >= 0) {
          const inlinedId = copyExprBetweenDaes(fnDae, rhsExprId, dae, subs);
          if (inlinedId >= 0) {
            (fnDae as any).wasInlined = true;
            return inlinedId;
          }
        }
      }
      let outCount = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Output) outCount++;
      }
      const targetFnCallName =
        fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"')
          ? typeof fnName === "string"
            ? fnName
            : fnDae.name.split(".").pop()!
          : fnDae.name;
      let callExprId = dae.addCallExpr(targetFnCallName, argExprIds);
      if (outCount > 1 && !tupleContext) {
        callExprId = dae.addSubscriptExpr(callExprId, [dae.addIntLiteral(1)]);
      }
      return callExprId;
    }

    const cleanFn = cleanFnName || (typeof fnName === "string" ? fnName.split(".").pop() : fnName);
    if (cleanFn === "div" || cleanFn === "rem" || cleanFn === "mod" || SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFn)) {
      let allConstant = true;
      const constArgs: number[] = [];
      for (const aid of argExprIds) {
        if (exprContainsNonConstantRef(aid, dae)) {
          allConstant = false;
          break;
        }
        const cVal = evalDaeExpr(aid, dae);
        if (typeof cVal !== "number") {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }
      if (allConstant && constArgs.length === argExprIds.length) {
        if (cleanFn === "div" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? Math.trunc(constArgs[0] / constArgs[1]) : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "rem" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? constArgs[0] - Math.trunc(constArgs[0] / constArgs[1]) * constArgs[1] : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "mod" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? constArgs[0] - Math.floor(constArgs[0] / constArgs[1]) * constArgs[1] : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(cleanFn);
        if (scalarBuiltin?.fold && constArgs.length === scalarBuiltin.arity) {
          return dae.addRealLiteral(scalarBuiltin.fold(...constArgs));
        }
      }
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
                const isImplicit = !rangeNode;
                if (rangeNode) {
                  const rangeText = rangeNode.text?.trim() ?? "";
                  if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                    const items = getArrayLiteralItems(rangeNode);
                    for (const item of items) {
                      const v = evaluateCSTNumber(item, substitutions as any, undefined, db, dae, prefix);
                      if (v !== null) values.push(v);
                    }
                  } else if (rangeText.includes(":")) {
                    const colonNodes = flattenColonNodes(rangeNode);
                    if (colonNodes.length >= 2) {
                      const s = evaluateCSTNumber(colonNodes[0], substitutions as any, undefined, db, dae, prefix);
                      let e: number | null = null;
                      let step = 1;
                      if (colonNodes.length === 2) {
                        e = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix);
                      } else if (colonNodes.length >= 3) {
                        step = evaluateCSTNumber(colonNodes[1], substitutions as any, undefined, db, dae, prefix) ?? 1;
                        e = evaluateCSTNumber(colonNodes[2], substitutions as any, undefined, db, dae, prefix);
                      }
                      if (s !== null && e !== null) {
                        for (let val = s; step > 0 ? val <= e : val >= e; val += step) values.push(val);
                      }
                    } else {
                      const parts = rangeText.split(":");
                      const s = parseInt(parts[0]!.trim(), 10);
                      const e = parseInt(parts[parts.length - 1]!.trim(), 10);
                      if (!isNaN(s) && !isNaN(e)) {
                        for (let val = s; val <= e; val++) values.push(val);
                      }
                    }
                  }
                }
                if (values.length === 0) {
                  values = findArraySubscriptsForIter(exprChild, varName, dae, db, prefix, isImplicit, fi);
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
                for (const val2 of iter2.values) {
                  const colIds: number[] = [];
                  for (const val1 of iter1.values) {
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
              continue;
            }
            continue;
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
    const blocks: number[][] = [];
    let currentBlock: number[] = [];

    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      const text = c.text?.trim() ?? c.type;
      if (text === ";" || c.type === ";" || c.type === '";"') {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
        continue;
      }
      if (c.type === "expression_list" || c.type === "expression") {
        const collect = (n: any) => {
          if (!n) return;
          if (n.type === "expression") {
            const exprId = lowerCSTExpression(n, dae, prefix, substitutions, imports, db, flattener);
            if (exprId >= 0) currentBlock.push(exprId);
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    if (blocks.length === 1 && blocks[0]!.length > 1) {
      const block = blocks[0]!;
      const rowCounts = block.map((item) => {
        const dims = getExprDims(item, dae, db);
        if (dims && dims.length >= 2) return dims[0]!;
        if (dims && dims.length === 1) return dims[0]!;
        const rank = getArrayCtorRank(item, dae);
        if (rank === 2) return getArrayCtorElements(item, dae).length;
        if (rank === 1) return getArrayCtorElements(item, dae).length;
        return 1;
      });
      const firstRowCount = rowCounts[0]!;
      const mismatchIdx = rowCounts.findIndex((r) => r !== firstRowCount);
      if (mismatchIdx !== -1) {
        let parentEq = node;
        while (parentEq && parentEq.type !== "equation" && parentEq.type !== "Equation") {
          parentEq = parentEq.parent;
        }
        const diagNode = parentEq ?? node;
        const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
        const item1Str = printer.printExprToString(block[0]!);
        const twoLit = dae.addIntLiteral(2);
        const promoted2 = dae.addCallExpr("promote", [block[mismatchIdx]!, twoLit]);
        const item2Str = printer.printExprToString(promoted2);
        dae.diagnostics.push({
          severity: "error",
          code: 4003,
          message: `Arguments of concatenation comma operator have different sizes for the first dimension: ${item1Str} has dimension ${firstRowCount} and ${item2Str} has dimension ${rowCounts[mismatchIdx]}.`,
          range: {
            startByte: diagNode?.startIndex ?? diagNode?.startByte,
            endByte: diagNode?.endIndex ?? diagNode?.endByte,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          },
        });
        return -1;
      }
      const hasVectorOrDynamic = block.some((item) => {
        const dims = getExprDims(item, dae, db);
        if (dims && dims.length === 1) return true;
        const rank = getArrayCtorRank(item, dae);
        return (
          rank === 1 ||
          (rank === 0 && (dae.getExprKind(item) === ExprKind.Call || dae.getExprKind(item) === ExprKind.Name))
        );
      });
      if (hasVectorOrDynamic) {
        const twoLit = dae.addIntLiteral(2);
        const promoted = block.map((item) => {
          const dims = getExprDims(item, dae, db);
          if (dims && dims.length >= 2) return item;
          return dae.addCallExpr("promote", [item, twoLit]);
        });
        return dae.addCallExpr("cat", [twoLit, ...promoted]);
      }
    }

    const to2DRows = (item: number): number[][] => {
      if (item < 0) return [];
      if (dae.getExprKind(item) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(item));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) item = ctor;
        }
      }
      const rank = getArrayCtorRank(item, dae);
      if (rank === 2) {
        const rows = getArrayCtorElements(item, dae);
        return rows.map((r) => getArrayCtorElements(r, dae));
      }
      if (rank === 1) {
        const elems = getArrayCtorElements(item, dae);
        if (blocks.length === 1 && blocks[0]?.length === 1) {
          return elems.map((e) => [e]);
        }
        return [elems];
      }
      return [[item]];
    };

    const allMatrixRows: number[] = [];
    for (const block of blocks) {
      if (block.length === 0) continue;
      const itemMatrices = block.map(to2DRows);
      const maxRows = Math.max(...itemMatrices.map((m) => m.length));
      for (let r = 0; r < maxRows; r++) {
        const rowCols: number[] = [];
        for (const mat of itemMatrices) {
          if (r < mat.length) {
            rowCols.push(...mat[r]!);
          } else if (mat.length === 1) {
            rowCols.push(...mat[0]!);
          }
        }
        allMatrixRows.push(dae.addArrayCtorExpr(rowCols));
      }
    }

    return dae.addArrayCtorExpr(allMatrixRows);
  }

  // Range expression: start : stop or start : step : stop
  if (
    node.childCount === 3 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"')
  ) {
    let leftChild = node.child(0);
    while (leftChild && leftChild.childCount === 1) leftChild = leftChild.child(0);
    const isLeftColon =
      leftChild &&
      leftChild.childCount === 3 &&
      (leftChild.child(1)?.type === ":" || leftChild.child(1)?.text === ":" || leftChild.child(1)?.type === '":"');

    const isForIndex = (() => {
      let curr = node.parent;
      while (curr) {
        if (curr.type === "for_index" || curr.type === "ForIndex") return true;
        if (
          curr.type === "for_statement" ||
          curr.type === "ForStatement" ||
          curr.type === "for_equation" ||
          curr.type === "ForEquation" ||
          curr.type === "class_definition" ||
          curr.type === "ClassDefinition" ||
          curr.type === "statement" ||
          curr.type === "equation"
        ) {
          break;
        }
        curr = curr.parent;
      }
      return false;
    })();

    if (isLeftColon) {
      const startId = lowerCSTExpression(leftChild.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stepId = lowerCSTExpression(leftChild.child(2), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      const rangeId = dae.addExpression(ExprKind.Range, startId, stepId, stopId);
      const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    } else {
      const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      const rangeId = dae.addExpression(ExprKind.Range, startId, -1, stopId);
      const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    }
  }
  if (
    node.childCount === 5 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"') &&
    (node.child(3)?.type === ":" || node.child(3)?.text === ":" || node.child(3)?.type === '":"')
  ) {
    const isForIndex = (() => {
      let curr = node.parent;
      while (curr) {
        if (curr.type === "for_index" || curr.type === "ForIndex") return true;
        if (
          curr.type === "for_statement" ||
          curr.type === "ForStatement" ||
          curr.type === "for_equation" ||
          curr.type === "ForEquation" ||
          curr.type === "class_definition" ||
          curr.type === "ClassDefinition" ||
          curr.type === "statement" ||
          curr.type === "equation"
        ) {
          break;
        }
        curr = curr.parent;
      }
      return false;
    })();
    const startId = lowerCSTExpression(node.child(0), dae, prefix, substitutions, imports, db, flattener);
    const stepId = lowerCSTExpression(node.child(2), dae, prefix, substitutions, imports, db, flattener);
    const stopId = lowerCSTExpression(node.child(4), dae, prefix, substitutions, imports, db, flattener);
    const rangeId = dae.addExpression(ExprKind.Range, startId, stepId, stopId);
    const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
    return expanded !== null ? expanded : rangeId;
  }

  // If-Else expression: if cond then e1 [elseif cond2 then e2 ...] else e_last
  if (firstChildToken === "if" && node.childCount >= 6) {
    const branches: { condNode: any; thenNode: any }[] = [{ condNode: node.child(1), thenNode: node.child(3) }];
    let i = 4;
    while (i < node.childCount) {
      const tok = node.child(i)?.text?.trim() ?? node.child(i)?.type ?? "";
      const tokClean = tok.replace(/^"|"$/g, "");
      if (tokClean === "elseif" && i + 3 < node.childCount) {
        branches.push({ condNode: node.child(i + 1), thenNode: node.child(i + 3) });
        i += 4;
      } else if (tokClean === "else" && i + 1 < node.childCount) {
        break;
      } else {
        i++;
      }
    }
    const elseNode = node.child(node.childCount - 1);
    let currElseId = lowerCSTExpression(elseNode, dae, prefix, substitutions, imports, db, flattener);

    for (let b = branches.length - 1; b >= 0; b--) {
      const branch = branches[b]!;
      const condId = lowerCSTExpression(branch.condNode, dae, prefix, substitutions, imports, db, flattener);
      let thenId = lowerCSTExpression(branch.thenNode, dae, prefix, substitutions, imports, db, flattener);
      if (isRealExpr(thenId, dae) && !isRealExpr(currElseId, dae)) {
        currElseId = castToRealExpr(currElseId, dae);
      } else if (!isRealExpr(thenId, dae) && isRealExpr(currElseId, dae)) {
        thenId = castToRealExpr(thenId, dae);
      }
      currElseId = dae.addExpression(ExprKind.IfElse, condId, thenId, currElseId);
    }
    return currElseId;
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
      const leftNode = node.childForFieldName?.("left") ?? node.child(0);
      const rightNode = node.childForFieldName?.("right") ?? node.child(2);
      let leftId = lowerCSTExpression(leftNode, dae, prefix, substitutions, imports, db, flattener);
      let rightId = lowerCSTExpression(rightNode, dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const opName = getOperatorNameForBinOp(binOp);
        if (opName) {
          const dispatched = dispatchBinaryOperator(opName, leftId, rightId, leftNode, rightNode, dae, db, flattener);
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
        return broadcastElemBinOp(binOp, baseOp, leftId, rightId, dae, flattener, true);
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
      const isArithmeticOp =
        binOp === BinOp.Add || binOp === BinOp.Sub || binOp === BinOp.Mul || binOp === BinOp.Div || binOp === BinOp.Pow;

      if (isArithmeticOp) {
        const lType = inferArenaExprVarType(dae, leftId);
        const rType = inferArenaExprVarType(dae, rightId);
        const isLNonNumeric =
          lType === VarType.Boolean ||
          lType === VarType.String ||
          dae.getExprKind(leftId) === ExprKind.BoolLiteral ||
          dae.getExprKind(leftId) === ExprKind.StringLiteral;
        const isRNonNumeric =
          rType === VarType.Boolean ||
          rType === VarType.String ||
          dae.getExprKind(rightId) === ExprKind.BoolLiteral ||
          dae.getExprKind(rightId) === ExprKind.StringLiteral;
        if (
          binOp === BinOp.Add &&
          (lType === VarType.String || dae.getExprKind(leftId) === ExprKind.StringLiteral) &&
          (rType === VarType.String || dae.getExprKind(rightId) === ExprKind.StringLiteral)
        ) {
          if (
            dae.getExprKind(leftId) === ExprKind.StringLiteral &&
            dae.getExprKind(rightId) === ExprKind.StringLiteral
          ) {
            const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
            const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
            return dae.addStringLiteral(s1 + s2);
          }
          return dae.addBinaryExpr(BinOp.Add, leftId, rightId);
        }

        if (isLNonNumeric || isRNonNumeric) {
          const getOperandFullTypeStr = (id: number): string => {
            const t = inferArenaExprVarType(dae, id);
            if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) return "Integer";
            if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) return "Boolean";
            if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) return "String";
            return "Real";
          };
          const leftTypeStr = getOperandFullTypeStr(leftId);
          const rightTypeStr = getOperandFullTypeStr(rightId);
          const rawExpr = `${node.child(0)?.text?.trim() ?? ""}${opToken}${node.child(2)?.text?.trim() ?? ""}`;
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          dae.diagnostics.push({
            severity: "error",
            message: `Cannot resolve type of expression ${rawExpr}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
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
          if (leftElems.length === rightElems.length) {
            if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
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
          if (leftElems.length === rightElems.length) {
            if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
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
        if (leftDims && rightDims) {
          // Matrix * Matrix: [M, K1] * [K2, N]
          if (leftDims.length === 2 && rightDims.length === 2 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            const [, N] = rightDims;
            if (K === 0 || M === 0 || N === 0) {
              if (M === 0) return dae.addArrayCtorExpr([]);
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
          // Matrix * Vector: [M, K1] * [K2]
          if (leftDims.length === 2 && rightDims.length === 1 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            if (M === 0) return dae.addArrayCtorExpr([]);
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < M!; i++) resElems.push(zeroLit);
              return dae.addArrayCtorExpr(resElems);
            }
          }
          // Vector * Matrix: [K1] * [K2, N]
          if (leftDims.length === 1 && rightDims.length === 2 && leftDims[0] === rightDims[0]) {
            const [, N] = rightDims;
            const K = leftDims[0]!;
            if (N === 0) return dae.addArrayCtorExpr([]);
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let j = 0; j < N!; j++) resElems.push(zeroLit);
              return dae.addArrayCtorExpr(resElems);
            }
          }
          // Vector * Vector: [K1] * [K2]
          if (leftDims.length === 1 && rightDims.length === 1 && leftDims[0] === rightDims[0]) {
            if (leftDims[0] === 0) return dae.addRealLiteral(0.0);
          }
        }
        const makeMul = (l: number, r: number) => {
          return mulWithSimplification(l, r, dae);
        };
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          return matrixOrVectorMul(leftId, rightId, dae);
        } else if (leftKind === ExprKind.ArrayCtor && (!rightDims || rightDims.length === 0)) {
          // Vector/Matrix * Scalar
          const leftElems = getArrayCtorElements(leftId, dae);
          const isMatrix = leftElems.length > 0 && dae.getExprKind(leftElems[0]!) === ExprKind.ArrayCtor;
          if (isMatrix) {
            const rows = leftElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(rElems.map((e) => makeMul(e, rightId)));
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(leftElems.map((e) => makeMul(e, rightId)));
          }
        } else if (rightKind === ExprKind.ArrayCtor && (!leftDims || leftDims.length === 0)) {
          // Scalar * Vector/Matrix
          const rightElems = getArrayCtorElements(rightId, dae);
          const isMatrix = rightElems.length > 0 && dae.getExprKind(rightElems[0]!) === ExprKind.ArrayCtor;
          if (isMatrix) {
            const rows = rightElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(rElems.map((e) => makeMul(leftId, e)));
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(rightElems.map((e) => makeMul(leftId, e)));
          }
        }
      }
      if (binOp === BinOp.Pow) {
        const getConstVal = (id: number): number | null => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (k === ExprKind.Negate) {
            const inner = getConstVal(dae.getExprLeft(id));
            return inner !== null ? -inner : null;
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            const inner = getConstVal(dae.getExprLeft(id));
            return inner !== null ? -inner : null;
          }
          return null;
        };
        const lVal = getConstVal(leftId);
        const rVal = getConstVal(rightId);
        if (lVal !== null && rVal !== null && lVal < 0 && !Number.isInteger(rVal)) {
          const startB = node.startIndex ?? node.startByte;
          const endB = node.endIndex ?? node.endByte;
          const lStr = Number.isInteger(lVal) ? lVal.toFixed(1) : String(lVal);
          const rStr = Number.isInteger(rVal) ? rVal.toFixed(1) : String(rVal);
          dae.diagnostics.push({
            severity: "error",
            message: `Invalid operation ${lStr} ^ ${rStr}, exponent must be an Integer when the base is negative.`,
            range:
              startB != null && endB != null
                ? {
                    startByte: startB,
                    endByte: endB,
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                  }
                : undefined,
          });
          return -1;
        }
      }
      if (binOp === BinOp.Pow) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(leftId) === ExprKind.ArrayCtor) {
          let powVal: number | null = null;
          if (dae.getExprKind(rightId) === ExprKind.IntLiteral) {
            powVal = dae.getExprData1(rightId);
          } else if (dae.getExprKind(rightId) === ExprKind.RealLiteral) {
            powVal = dae.getExprRealValue(rightId);
          }
          if (powVal !== null && Number.isInteger(powVal) && powVal >= 0) {
            return matrixPower(leftId, powVal, dae);
          }
        }
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          return dae.addRealLiteral(Math.pow(lVal, rVal));
        }

        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(rightId)) return leftId;

        // Power of power simplification: (x ^ a) ^ b
        if (leftKind === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Pow) {
          const innerBase = dae.getExprLeft(leftId);
          const innerExp = dae.getExprRight(leftId);
          const outerExp = rightId;

          const getNum = (id: number): number | null => {
            const k = dae.getExprKind(id);
            if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
            if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
            return null;
          };

          const isHalf = dae.getExprKind(outerExp) === ExprKind.RealLiteral && dae.getExprRealValue(outerExp) === 0.5;
          const inNum = getNum(innerExp);
          if (isHalf && inNum !== null && inNum % 2 === 0) {
            const absBase = dae.addCallExpr("abs", [innerBase]);
            const newExp = dae.addRealLiteral(inNum * 0.5);
            return dae.addBinaryExpr(BinOp.Pow, absBase, newExp);
          }

          const isDiv = dae.getExprKind(outerExp) === ExprKind.Binary && dae.getExprData1(outerExp) === BinOp.Div;
          if (isDiv) {
            const dL = dae.getExprLeft(outerExp);
            const dR = dae.getExprRight(outerExp);
            if (isOne(dL)) {
              const innerExpName = dae.getExprKind(innerExp) === ExprKind.Name ? dae.getExprData1(innerExp) : null;
              const dRName = dae.getExprKind(dR) === ExprKind.Name ? dae.getExprData1(dR) : null;
              if (innerExpName !== null && innerExpName === dRName) {
                return innerBase;
              }
            }
          }

          const outNum = getNum(outerExp);
          if (inNum !== null && outNum !== null) {
            const newExp = dae.addRealLiteral(inNum * outNum);
            return dae.addBinaryExpr(BinOp.Pow, innerBase, newExp);
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
        const decomposeLinearTerm = (id: number): { coeff: number; isReal: boolean; baseId: number } => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.Negate) {
            const inner = decomposeLinearTerm(dae.getExprLeft(id));
            return { coeff: -inner.coeff, isReal: inner.isReal, baseId: inner.baseId };
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            const inner = decomposeLinearTerm(dae.getExprLeft(id));
            return { coeff: -inner.coeff, isReal: inner.isReal, baseId: inner.baseId };
          }
          if (k === ExprKind.Binary && (dae.getExprData1(id) === BinOp.Mul || dae.getExprData1(id) === BinOp.ElemMul)) {
            const l = dae.getExprLeft(id);
            const r = dae.getExprRight(id);
            const lKind = dae.getExprKind(l);
            const rKind = dae.getExprKind(r);
            if (lKind === ExprKind.RealLiteral || lKind === ExprKind.IntLiteral) {
              const isReal = lKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(l) : dae.getExprData1(l);
              const inner = decomposeLinearTerm(r);
              return { coeff: v * inner.coeff, isReal: isReal || inner.isReal, baseId: inner.baseId };
            }
            if (rKind === ExprKind.RealLiteral || rKind === ExprKind.IntLiteral) {
              const isReal = rKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(r) : dae.getExprData1(r);
              const inner = decomposeLinearTerm(l);
              return { coeff: v * inner.coeff, isReal: isReal || inner.isReal, baseId: inner.baseId };
            }
          }
          if (k === ExprKind.Binary && (dae.getExprData1(id) === BinOp.Div || dae.getExprData1(id) === BinOp.ElemDiv)) {
            const l = dae.getExprLeft(id);
            const r = dae.getExprRight(id);
            const rKind = dae.getExprKind(r);
            if (rKind === ExprKind.RealLiteral || rKind === ExprKind.IntLiteral) {
              const isReal = rKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(r) : dae.getExprData1(r);
              if (v !== 0) {
                const inner = decomposeLinearTerm(l);
                return { coeff: inner.coeff / v, isReal: isReal || inner.isReal, baseId: inner.baseId };
              }
            }
          }
          return { coeff: 1, isReal: false, baseId: id };
        };

        const isLiteralKind = (id: number): boolean => {
          const k = dae.getExprKind(id);
          return (
            k === ExprKind.RealLiteral ||
            k === ExprKind.IntLiteral ||
            k === ExprKind.BoolLiteral ||
            k === ExprKind.StringLiteral
          );
        };

        const term1 = decomposeLinearTerm(leftId);
        const term2 = decomposeLinearTerm(rightId);
        if (!isLiteralKind(term1.baseId) && areExpressionsEqual(dae, term1.baseId, term2.baseId)) {
          const totalCoeff = binOp === BinOp.Add ? term1.coeff + term2.coeff : term1.coeff - term2.coeff;
          const isReal = term1.isReal || term2.isReal || isRealExpr(term1.baseId, dae) || !Number.isInteger(totalCoeff);
          if (Math.abs(totalCoeff) < 1e-12) {
            return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
          }
          if (totalCoeff === 1) {
            return term1.baseId;
          }
          if (totalCoeff === -1) {
            return dae.addUnaryExpr(UnaryOp.Negate, term1.baseId);
          }
          const coeffLit = isReal ? dae.addRealLiteral(totalCoeff) : dae.addIntLiteral(totalCoeff);
          return dae.addBinaryExpr(BinOp.Mul, coeffLit, term1.baseId);
        }
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
        if (leftText && leftText === rightText && dae.classKind !== "function" && !dae.hasArrayElements(leftText)) {
          const twoExpr = dae.addRealLiteral(2.0);
          return dae.addBinaryExpr(BinOp.Pow, leftId, twoExpr);
        }
      }
      if (binOp === BinOp.Div || binOp === BinOp.Pow) {
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
      if (flattener.options.omcCompatibility && binOp === BinOp.Mul) {
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
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      if (dae.getExprKind(operandId) === ExprKind.ArrayCtor) {
        const distributeNeg = (id: number): number => {
          if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
            const elems = getArrayCtorElements(id, dae);
            return dae.addArrayCtorExpr(elems.map(distributeNeg));
          }
          return dae.addExpression(ExprKind.Negate, 0, id);
        };
        return distributeNeg(operandId);
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
    if (flattener?.activeLoopVars?.has(rawName)) {
      return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
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
              const fullIdent = rawParts.map((p) => p.ident).join(".");
              const dimSize =
                getDaeDimSize(prefix, fullIdent, dimIdx, dae, db) ||
                getDaeDimSize(prefix, lastPart.ident, dimIdx, dae, db);
              const subsWithEnd = new Map<string, number>(substitutions ? (substitutions as any) : []);
              if (dimSize > 0) {
                subsWithEnd.set("end", dimSize);
              }

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
                  if (isNaN(iv) && subsWithEnd && subsWithEnd.has(it)) {
                    const s = subsWithEnd.get(it);
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
                  if (t === "end") return dimSize > 0 ? dimSize : null;
                  if (t === "false") return 1;
                  if (t === "true") return 2;
                  if (subsWithEnd && subsWithEnd.has(t)) {
                    const s = subsWithEnd.get(t);
                    if (typeof s === "number") return s;
                  }
                  const numVal = evaluateCSTNumber(bNode, subsWithEnd as any, undefined, db, dae, prefix);
                  if (numVal !== null) return numVal;
                  const arithVal = evalArithmeticText(t, subsWithEnd);
                  if (arithVal !== null) return arithVal;
                  if (db) {
                    const enumIdx = getEnumLiteralIndex(t, db);
                    if (enumIdx !== null) return enumIdx;
                  }
                  return null;
                };
                let startVal = startNode ? evalBound(startNode) : null;
                let stopVal = stopNode ? evalBound(stopNode) : null;
                let stepVal = stepNode ? (evalBound(stepNode) ?? 1) : 1;
                if (startVal === null || stopVal === null) {
                  const colonParts = subText.split(":");
                  if (colonParts.length === 2) {
                    startVal = evalBound({ text: colonParts[0] });
                    stopVal = evalBound({ text: colonParts[1] });
                  } else if (colonParts.length === 3) {
                    startVal = evalBound({ text: colonParts[0] });
                    stepVal = evalBound({ text: colonParts[1] }) ?? 1;
                    stopVal = evalBound({ text: colonParts[2] });
                  }
                }
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
              const isLoopVar =
                Boolean(flattener?.activeLoopVars && flattener.activeLoopVars.size > 0) &&
                [...flattener!.activeLoopVars].some((lv) => new RegExp(`\\b${lv}\\b`).test(subText));
              if (subsWithEnd && subsWithEnd.has(subText)) {
                const sVal = subsWithEnd.get(subText)!;
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
                  : (evaluateCSTNumber(expr, subsWithEnd as any, undefined, undefined, dae, prefix) ??
                    evalArithmeticText(subText, subsWithEnd));
              if (evaluatedNum !== null) {
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: false,
                  values: [evaluatedNum],
                  scalarText: String(evaluatedNum),
                });
              } else {
                const subId = lowerCSTExpression(expr, dae, prefix, subsWithEnd as any, imports, db, flattener);
                if (subId >= 0) {
                  const subType = inferArenaExprVarType(dae, subId);
                  if (subType === VarType.Real && !isLoopVar) {
                    isRealSub = true;
                  }
                  let numVal: number | null = null;
                  if (dae.getExprKind(subId) === ExprKind.IntLiteral && !isRealSub && !isLoopVar) {
                    numVal = dae.getExprData1(subId);
                  } else if (!isRealSub && !isLoopVar) {
                    const ev = evalDaeExpr(subId, dae);
                    if (typeof ev === "number" && Number.isInteger(ev)) {
                      numVal = ev;
                    }
                  }
                  if (numVal !== null) {
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
          if (expectedDimCount !== null && p.subscripts.length < expectedDimCount) {
            for (let d = p.subscripts.length; d < expectedDimCount; d++) {
              const dimSize =
                getDaeDimSize(prefix, fullIdent, d, dae, db) ?? getDaeDimSize(prefix, p.ident, d, dae, db);
              const vals = dimSize > 0 ? Array.from({ length: dimSize }, (_, i) => i + 1) : [];
              p.subscripts.push({
                node: null,
                text: ":",
                isSlice: true,
                values: vals,
              });
            }
          }

          for (let d = 0; d < p.subscripts.length; d++) {
            const s = p.subscripts[d]!;
            const dimSize = getDaeDimSize(prefix, fullIdent, d, dae, db) ?? getDaeDimSize(prefix, p.ident, d, dae, db);
            if (dimSize !== null && dimSize > 0 && s.values.length > 0) {
              for (const v of s.values) {
                if (v < 1 || v > dimSize) {
                  let stmtNode: any = node;
                  let curr = node.parent;
                  while (curr) {
                    if (
                      curr.type === "connect_equation" ||
                      curr.type === "ConnectEquation" ||
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
                  const subDisplay =
                    s.isSlice && s.values.length > 1
                      ? `{${s.values.join(", ")}}`
                      : (s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text));
                  const subStrs = p.subscripts.map((subItem, sIdx) =>
                    sIdx === d
                      ? subDisplay
                      : subItem.isSlice && subItem.values.length > 1
                        ? `{${subItem.values.join(", ")}}`
                        : (subItem.scalarText ??
                          (subItem.values[0] !== undefined ? String(subItem.values[0]) : subItem.text)),
                  );
                  const refStr = rawParts
                    .map((x, idx) =>
                      idx === pi
                        ? `${x.ident}[${subStrs.join(",")}]`
                        : x.hasSubscripts
                          ? `${x.ident}[${x.subscripts.map((subItem) => (subItem.isSlice && subItem.values.length > 1 ? `{${subItem.values.join(", ")}}` : (subItem.scalarText ?? (subItem.values[0] !== undefined ? String(subItem.values[0]) : subItem.text)))).join(",")}]`
                          : x.ident,
                    )
                    .join(".");
                  dae.diagnostics.push({
                    severity: "error",
                    message: `Subscript '${v}' for dimension ${d + 1} (size = ${dimSize}) of ${refStr} is out of bounds.`,
                    range: r,
                  });
                  return -1;
                }
              }
            }
          }

          if (expectedDimCount !== null && p.subscripts.length > expectedDimCount) {
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

      if (!isAssignmentLhs && rawParts.length > 0 && rawParts[0]!.hasSubscripts) {
        const baseName = resolveScopedName(rawParts[0]!.ident, prefix, dae, (dae as any).innerOuterComponents);
        const baseShape = (dae as any).getNamedArrayShape?.(baseName) ?? (dae as any).namedArrayShapes?.get(baseName);
        if (baseShape && baseShape.length > 0 && baseShape.every((d: number) => d >= 0) && baseShape.includes(0)) {
          const baseId = dae.addArrayCtorExpr([]);
          const subExprs = rawParts[0]!.subscripts.map((s) => {
            if (s.node) {
              const exprNode = s.node.children?.find((k: any) => k.type === "expression") ?? s.node;
              if (exprNode && exprNode.text?.trim() !== ":") {
                const eId = lowerCSTExpression(exprNode, dae, prefix, substitutions, imports, db, flattener);
                if (eId >= 0) return eId;
              }
            }
            return dae.addExpression(ExprKind.Name, dae.interner.intern(s.text));
          });
          return dae.addSubscriptExpr(baseId, subExprs);
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
          let vIdx = dae.getVarIdxByName(candidate);
          if (vIdx < 0 && rawParts.length === 1 && rawParts[0]!.subscripts.length === 1) {
            const pIdent = rawParts[0]!.ident;
            const fullTarget = prefix ? `${prefix}.${pIdent}[` : `${pIdent}[`;
            const matchingVars: string[] = [];
            for (let i = 0; i < dae.varCount; i++) {
              if (!dae.isVarRemoved(i)) {
                const vn = dae.getVarName(i);
                if (vn.startsWith(fullTarget) && vn.endsWith("]")) {
                  matchingVars.push(vn);
                }
              }
            }
            const chosen = chosenSliceIndices[0]!;
            if (matchingVars.length > 0 && chosen >= 1 && chosen <= matchingVars.length) {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(matchingVars[chosen - 1]!));
            }
          }
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Constant) {
            const exprId = dae.getVarExpression(vIdx);
            if (exprId >= 0) {
              const k = dae.getExprKind(exprId);
              if (k === ExprKind.RealLiteral) return dae.addRealLiteral(dae.getExprRealValue(exprId));
              if (k === ExprKind.IntLiteral) return dae.addIntLiteral(dae.getExprData1(exprId));
              if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(dae.getExprData1(exprId) !== 0);
            }
          }
          if (vIdx < 0 && db && candidate.includes("[")) {
            let baseName = candidate.slice(0, candidate.indexOf("["));
            if (baseName.startsWith(".")) baseName = baseName.slice(1);
            const subStr = candidate.slice(candidate.indexOf("[") + 1, candidate.indexOf("]"));
            const subIndices = subStr.split(",").map((s) => parseInt(s.trim(), 10));
            const constRes = lookupDbConstant(baseName, db);
            if (constRes && Array.isArray(constRes.value)) {
              let val: any = constRes.value;
              for (const idx of subIndices) {
                if (Array.isArray(val) && idx >= 1 && idx <= val.length) {
                  val = val[idx - 1];
                } else {
                  val = null;
                  break;
                }
              }
              if (typeof val === "number") {
                return constRes.isInteger ? dae.addIntLiteral(val) : dae.addRealLiteral(val);
              }
            }
          }
          if (vIdx < 0) {
            const elemIndices = dae.getArrayElementIndices(candidate);
            if (elemIndices.length > 0) {
              const entries: { idxs: number[]; name: string }[] = [];
              for (const eIdx of elemIndices) {
                const eName = dae.getVarName(eIdx);
                const idxs = matchVarPath(eName, candidate);
                if (idxs && idxs.length > 0) {
                  entries.push({ idxs, name: eName });
                }
              }
              if (entries.length > 0) {
                const subDimCount = entries[0]!.idxs.length;
                const shape: number[] = [];
                for (let d = 0; d < subDimCount; d++) {
                  let maxVal = 0;
                  for (const ent of entries) {
                    if (ent.idxs[d]! > maxVal) maxVal = ent.idxs[d]!;
                  }
                  shape.push(maxVal);
                }
                const buildSubArray = (dim: number, prefixIdxs: number[]): number => {
                  if (dim === shape.length) {
                    const entry = entries.find((e) => e.idxs.every((v, k) => v === prefixIdxs[k]));
                    return dae.addExpression(ExprKind.Name, dae.interner.intern(entry ? entry.name : ""));
                  }
                  const childExprs: number[] = [];
                  for (let i = 1; i <= shape[dim]!; i++) {
                    childExprs.push(buildSubArray(dim + 1, [...prefixIdxs, i]));
                  }
                  return dae.addArrayCtorExpr(childExprs);
                };
                return buildSubArray(0, []);
              }
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
        if (db) {
          const constRes = lookupDbConstant(candidate, db) ?? lookupDbConstant(joined, db);
          if (constRes !== null) {
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v) =>
                constRes.isInteger ? dae.addIntLiteral(v) : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
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
                    const pkgName = parts.slice(0, pi).join(".");
                    const hasPkgDiag = dae.diagnostics.some(
                      (d) => d.code === 4036 && d.message.includes(`in package ${pkgName}`),
                    );
                    if (!hasPkgDiag) {
                      for (let pass = 0; pass < 2; pass++) {
                        dae.diagnostics.push({
                          severity: "error",
                          code: 4036,
                          message: `Variable ${parts.slice(0, pi + 1).join(".")} in package ${pkgName} is not constant.`,
                        });
                        for (let rem = pi + 1; rem < parts.length; rem++) {
                          dae.diagnostics.push({
                            severity: "error",
                            code: 4036,
                            message: `Variable ${parts.slice(0, rem + 1).join(".")} in package ${pkgName} is not constant.`,
                          });
                        }
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
                    const childCst = db.cstNode(child.id) as any;
                    const findBindingExpr = (n: any): any => {
                      if (!n) return null;
                      if (n.type === "expression" || n.type === "Expression") return n;
                      for (const c of n.children || []) {
                        const res = findBindingExpr(c);
                        if (res) return res;
                      }
                      return null;
                    };
                    const exprNode = findBindingExpr(childCst);
                    if (exprNode && flattener) {
                      const prevClassId = flattener.currentClassId;
                      flattener.currentClassId = child.parentId ?? flattener.currentClassId;
                      const lowered = flattener.lowerExpr(exprNode, dae, prefix, substitutions);
                      flattener.currentClassId = prevClassId;
                      if (lowered >= 0) return lowered;
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
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v) =>
                constRes.isInteger ? dae.addIntLiteral(v) : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
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
        if (Array.isArray(constRes.value)) {
          const elemIds = constRes.value.map((v) =>
            constRes.isInteger ? dae.addIntLiteral(v) : dae.addRealLiteral(v),
          );
          return dae.addArrayCtorExpr(elemIds);
        }
        return constRes.isInteger ? dae.addIntLiteral(Math.round(constRes.value)) : dae.addRealLiteral(constRes.value);
      }
    }

    if (db && rawName.includes(".")) {
      const dotIdx = rawName.lastIndexOf(".");
      const enumTypeName = rawName.slice(0, dotIdx);
      const litName = rawName.slice(dotIdx + 1);
      const leafTypeName = enumTypeName.includes(".") ? enumTypeName.split(".").pop()! : enumTypeName;
      const typeTargets = db.byName(leafTypeName);
      for (const candidate of typeTargets) {
        const cstText = (db.cstNode(candidate.id) as any)?.text ?? "";
        const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
        const literals: string[] | null = enumMatch
          ? enumMatch[1].split(",").map((s) => s.trim().split(/\s+/)[0])
          : Array.isArray(candidate.metadata?.literals)
            ? candidate.metadata.literals
            : null;
        if (literals) {
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
    // Only expand if rawName is NOT already subscripted (does not contain '['), noArrayExpand is false, and not assignment LHS
    if (!isAssignmentLhs && !noArrayExpand && !rawName.includes("[") && dae.hasArrayElements(rawName)) {
      const ctor = expandVarToArrayCtor(rawName, dae);
      if (ctor !== null) return ctor;
    }

    const outerErr = (dae as any).outerNonConstantAccess?.find(
      (e: any) =>
        e.compName === prefix &&
        (e.varName === rawName || `${prefix}.${e.varName}` === rawName || e.target === rawName),
    );
    if (outerErr) {
      let clauseNode: any = node;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
        clauseNode = clauseNode.parent;
      }
      const rangeObj = clauseNode
        ? {
            startByte: clauseNode.startIndex ?? clauseNode.startByte,
            endByte: clauseNode.endIndex ?? clauseNode.endByte,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          }
        : node.startIndex != null && node.endIndex != null
          ? {
              startByte: node.startIndex,
              endByte: node.endIndex,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            }
          : undefined;

      let clsNode: any = clauseNode;
      while (clsNode && clsNode.type !== "class_definition" && clsNode.type !== "ClassDefinition") {
        clsNode = clsNode.parent;
      }

      const getQualifiedClassName = (cNode: any): string => {
        if (!cNode) return "";
        const names: string[] = [];
        let curr = cNode;
        while (curr) {
          if (curr.type === "class_definition" || curr.type === "ClassDefinition") {
            let idName = "";
            for (const ch of curr.children || []) {
              if (
                ch.type === "class_specifier" ||
                ch.type === "long_class_specifier" ||
                ch.type === "ClassSpecifier" ||
                ch.type === "LongClassSpecifier"
              ) {
                const id = ch.children?.find((c: any) => c.type === "identifier" || c.type === "Identifier");
                if (id) {
                  idName = id.text?.trim();
                  break;
                }
              }
            }
            if (!idName) {
              const id = curr.children?.find((c: any) => c.type === "identifier" || c.type === "Identifier");
              if (id) idName = id.text?.trim();
            }
            if (idName) names.unshift(idName);
          }
          curr = curr.parent;
        }
        return names.join(".");
      };

      const currClassSym = flattener?.currentClassId && db ? db.symbol(flattener.currentClassId) : null;
      const rootClassSym = flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId) : null;
      const rootClassName = rootClassSym?.name ?? "";
      const scopeName =
        currClassSym && db ? getSymbolQualifiedName(db, currClassSym.id) : getQualifiedClassName(clsNode) || "A";

      if (currClassSym && currClassSym.parentId != null) {
        const compRange = (dae as any).currentCompClauseRange;
        dae.diagnostics.push({
          severity: "error",
          code: 4036,
          message: `Variable ${outerErr.compName}: Variable ${outerErr.varName} in package ${rootClassName} is not constant.`,
          range: compRange,
        });
      }

      dae.diagnostics.push({
        severity: "error",
        code: 2002,
        message: `Variable ${outerErr.varName} not found in scope ${scopeName}.`,
        range: rangeObj,
      });
      return -1;
    }

    return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
  }

  // Fallback: treat raw text as Name
  let fallback = node.text ? node.text.trim() : "";
  if (substitutions && substitutions.has(fallback)) {
    const sVal = substitutions.get(fallback)!;
    if (typeof sVal === "number") return dae.addIntLiteral(sVal);
    if (sVal === "true" || sVal === "false") return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
    return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
  }
  if (flattener?.activeLoopVars?.has(fallback)) {
    return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
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
    isEach?: boolean;
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
        const v = dae.getVarVariability(vIdx);
        if (v === Variability.Constant || v === Variability.Parameter) {
          const vExp = dae.getVarExpression(vIdx);
          if (vExp >= 0) return getConstVal(vExp, dae);
        }
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
    const count = Math.max(0, Math.floor((stopVal - startVal) / stepVal + 1e-9) + 1);
    for (let i = 0; i < count; i++) {
      const v = startVal + i * stepVal;
      elemIds.push(isReal ? dae.addRealLiteral(v) : dae.addIntLiteral(Math.round(v)));
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
  public currentClassId: SymbolId = 0;
  private innerOuterComponents = new Set<string>();
  private innerDeclarations = new Map<string, Map<string, string>>();
  private disabledComponents = new Set<string>();
  public usedExternalObjects = new Set<SymbolId>();
  public failedFunctionIds = new Set<SymbolId>();
  public invalidInterfaceFunctionIds = new Set<SymbolId>();
  public calledFunctionSymIds = new Set<SymbolId>();
  public activeLoopVars = new Set<string>();
  public usedOperatorFunctions = new Map<string, SymbolId>();
  public currentFlatteningFunctionId: SymbolId | null = null;
  public currentFunctionEnclosingScope: SymbolId | null = null;
  private pendingArrayBindings = new Map<string, { lhsExprId: number; rhsExprId: number }[]>();
  currentImports = new Map<string, string>();
  public expandableBuses = new Map<string, SymbolId>();
  public evaluatedConstantArrays = new Map<string, any>();
  public currentParentMods?: any;

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
    if (!sym || sym.id < 0 || (sym.metadata as any)?.isPredefined) return false;
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
    if (!sym || sym.id < 0 || (sym.metadata as any)?.isPredefined) return false;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = stripComments(rawKind).trim();
    const words = cleanKind.split(/\s+/).filter(Boolean);
    if (words.includes("record")) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          const childText = stripComments(child.text ?? "").trim();
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

  private emitFunctionCallEquation(
    node: any,
    dae: DAEBuilder,
    prefix: string,
    substitutions?: Map<string, number>,
    isInitial = false,
    whenIdx = -1,
  ): void {
    const isReinit =
      node.child?.(0)?.text?.trim() === "reinit" ||
      node.children?.[0]?.text?.trim() === "reinit" ||
      /^\s*reinit\s*\(/.test(node.text ?? "");
    if (isReinit) {
      const match = (node.text ?? "").match(/reinit\s*\(\s*([^,\s()]+)/);
      if (match) {
        const rawTarget = match[1].trim();
        const targetName = prefix ? `${prefix}.${rawTarget}` : rawTarget;
        let vIdx = dae.getVarIdxByName(targetName);
        if (vIdx < 0) {
          vIdx = dae.getVarIdxByName(rawTarget);
        }
        if (vIdx >= 0) {
          const vType = dae.getVarType(vIdx);
          const vVariability = dae.getVarVariability(vIdx);
          let startB = node.startIndex ?? node.startByte;
          let endB = node.endIndex ?? node.endByte;
          if (endB != null && (node.text ?? "").endsWith(";")) {
            endB -= 1;
          }
          const range =
            startB != null && endB != null
              ? {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                }
              : undefined;

          if (vType !== VarType.Real) {
            const typeName = vType === VarType.Boolean ? "Boolean" : vType === VarType.Integer ? "Integer" : "String";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REINIT_TYPE_MISMATCH.code,
              message: ModelicaErrorCode.REINIT_TYPE_MISMATCH.message(rawTarget, typeName),
              range,
            });
            return;
          }
          if (vVariability === Variability.Parameter) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
              message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "parameter"),
              range,
            });
            return;
          }
          if (vVariability === Variability.Constant) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
              message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "constant"),
              range,
            });
            return;
          }
        }
      }
    }

    const callId = this.lowerExpr(node, dae, prefix, substitutions);
    if (this.isStaticTrueAssert(callId, dae)) {
      return;
    }

    if (dae.getExprKind(callId) === ExprKind.Call) {
      const callName = dae.interner.resolve(dae.getExprData1(callId));
      if (callName === "reinit" && dae.getExprRight(callId) >= 2) {
        const arg0 = dae.getExprLeft(callId);
        const arg1 = dae.getExprLeft(callId + 1);
        if (dae.getExprKind(arg0) === ExprKind.ArrayCtor && dae.getExprKind(arg1) === ExprKind.ArrayCtor) {
          const len0 = dae.getExprData1(arg0);
          const len1 = dae.getExprData1(arg1);
          if (len0 === len1) {
            for (let i = 0; i < len0; i++) {
              const el0 = i === 0 ? dae.getExprLeft(arg0) : dae.getExprLeft(arg0 + i);
              const el1 = i === 0 ? dae.getExprLeft(arg1) : dae.getExprLeft(arg1 + i);
              const scalarCall = dae.addCallExpr("reinit", [el0, el1]);
              if (whenIdx >= 0) {
                dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, scalarCall, -1);
              } else {
                const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
                dae.addEquation(eqKind, scalarCall, -1);
              }
            }
            return;
          }
        }
      }
    }

    if (whenIdx >= 0) {
      dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, callId, -1);
    } else {
      const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
      const eqIdx = dae.addEquation(eqKind, callId, -1);
      const startB = node.startIndex ?? node.startByte;
      const endB = node.endIndex ?? node.endByte;
      if (startB != null && endB != null && eqIdx >= 0) {
        dae.setEqSourceRange(eqIdx, startB, endB);
      }
    }
  }

  private extractStateMachines(dae: DAEBuilder): void {
    // 1. Scan for initialState and transition calls
    interface InitialStateInfo {
      eqIdx: number;
      stateName: string;
    }
    interface TransitionInfo {
      eqIdx: number;
      from: string;
      to: string;
    }

    const initialStates: InitialStateInfo[] = [];
    const transitions: TransitionInfo[] = [];

    const getCallArgName = (callId: number, argIndex: number): string | null => {
      const argId = argIndex === 0 ? dae.getExprLeft(callId) : dae.getExprLeft(callId + argIndex);
      if (argId < 0) return null;
      const k = dae.getExprKind(argId);
      if (k === ExprKind.Name) {
        return dae.interner.resolve(dae.getExprData1(argId));
      }
      return null;
    };

    for (let eqIdx = 0; eqIdx < dae.eqCount; eqIdx++) {
      const ek = dae.getEqKind(eqIdx);
      if (ek === EqKind.FunctionCall || ek === EqKind.InitialFunctionCall) {
        const callId = dae.getEqLhs(eqIdx);
        if (callId >= 0 && dae.getExprKind(callId) === ExprKind.Call) {
          const fname = dae.interner.resolve(dae.getExprData1(callId));
          const argCount = dae.getExprRight(callId);
          if (fname === "initialState" && argCount >= 1) {
            const sName = getCallArgName(callId, 0);
            if (sName) initialStates.push({ eqIdx, stateName: sName });
          } else if (fname === "transition" && argCount >= 2) {
            const from = getCallArgName(callId, 0);
            const to = getCallArgName(callId, 1);
            if (from && to) transitions.push({ eqIdx, from, to });
          }
        }
      }
    }

    // If transitions exist but no initialState, in OMC compatibility mode, discard orphan transitions and state variables (TransitionTest.mo)
    if (transitions.length > 0 && initialStates.length === 0) {
      if (this.options.omcCompatibility) {
        const orphanStates = new Set<string>();
        const ignored = new Set<number>();
        for (const t of transitions) {
          orphanStates.add(t.from);
          orphanStates.add(t.to);
          ignored.add(t.eqIdx);
        }
        (dae as any).ignoredEqIndices = ignored;
        for (let v = 0; v < dae.varCount; v++) {
          const vName = dae.getVarName(v);
          for (const st of orphanStates) {
            if (vName.startsWith(st + ".")) {
              dae.removeVariable(v);
              break;
            }
          }
        }
      }
      return;
    }

    if (initialStates.length === 0) return;

    // Build transition adjacency and reachability
    const adj = new Map<string, Set<string>>();
    const addEdge = (u: string, v: string) => {
      if (!adj.has(u)) adj.set(u, new Set());
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(u)!.add(v);
      adj.get(v)!.add(u);
    };
    for (const t of transitions) {
      addEdge(t.from, t.to);
    }

    // Group state machines
    // Each initialState defines one state machine
    const smList: ArenaStateMachine[] = [];
    const stateToSm = new Map<string, ArenaStateMachine>();
    const allKnownStates = new Set<string>();

    for (const init of initialStates) {
      // Find connected component from init.stateName
      const visited = new Set<string>();
      const queue = [init.stateName];
      visited.add(init.stateName);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = adj.get(curr);
        if (neighbors) {
          for (const nbr of neighbors) {
            if (!visited.has(nbr)) {
              visited.add(nbr);
              queue.push(nbr);
            }
          }
        }
      }

      // Order states: initial state first, then others in order of discovery
      const orderedStates: string[] = [init.stateName];
      for (const st of visited) {
        if (st !== init.stateName) orderedStates.push(st);
      }

      // Collect transitions belonging to this state machine
      const smTransitions: number[] = [];
      for (const t of transitions) {
        if (visited.has(t.from) && visited.has(t.to)) {
          smTransitions.push(t.eqIdx);
        }
      }

      const smStates: ArenaStateMachineState[] = orderedStates.map((sName) => ({
        name: sName,
        equations: [],
        variables: [],
        stateMachines: [],
        varIndices: [],
        eqIndices: [],
        multiplexerEqIndices: [],
      }));

      const sm: ArenaStateMachine = {
        name: init.stateName,
        states: smStates,
        transitions: [],
        initialState: init.stateName,
        initialStateEqIdx: init.eqIdx,
        transitionEqIndices: smTransitions,
      };

      smList.push(sm);
      for (const st of smStates) {
        stateToSm.set(st.name, sm);
        allKnownStates.add(st.name);
      }
    }

    // Sort known states by length descending so prefix matching prefers the most specific state
    const sortedStateNames = Array.from(allKnownStates).sort((a, b) => b.length - a.length);

    const findOwnerState = (vName: string): ArenaStateMachineState | null => {
      for (const sName of sortedStateNames) {
        if (vName.startsWith(sName + ".")) {
          const sm = stateToSm.get(sName);
          if (sm) {
            const st = sm.states.find((s) => s.name === sName);
            if (st) return st;
          }
        }
      }
      return null;
    };

    // Partition variables into states
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      const vName = dae.getVarName(v);
      const owner = findOwnerState(vName);
      if (owner) {
        owner.varIndices!.push(v);
      }
    }

    // Partition equations into states
    const getExprVarName = (exprId: number): string | null => {
      if (exprId < 0) return null;
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.Name) return dae.interner.resolve(dae.getExprData1(exprId));
      if (k === ExprKind.Binary || k === ExprKind.Unary) {
        return getExprVarName(dae.getExprLeft(exprId));
      }
      return null;
    };

    const smEqSet = new Set<number>();
    for (const sm of smList) {
      if (sm.initialStateEqIdx !== undefined) smEqSet.add(sm.initialStateEqIdx);
      if (sm.transitionEqIndices) {
        for (const idx of sm.transitionEqIndices) smEqSet.add(idx);
      }
    }

    for (let eqIdx = 0; eqIdx < dae.eqCount; eqIdx++) {
      if (smEqSet.has(eqIdx)) continue;
      const ek = dae.getEqKind(eqIdx);
      if (ek === EqKind.Simple || ek === EqKind.InitialSimple || ek === EqKind.Array) {
        const lhs = dae.getEqLhs(eqIdx);
        const lhsName = getExprVarName(lhs);
        if (lhsName) {
          const owner = findOwnerState(lhsName);
          if (owner) {
            owner.eqIndices!.push(eqIdx);
          }
        }
      }
    }

    // Synthesize multiplexer equations for each state machine
    for (const sm of smList) {
      const dotIdx = sm.name.lastIndexOf(".");
      const enclosingStateName = dotIdx >= 0 ? sm.name.slice(0, dotIdx) : null;
      const parentState = enclosingStateName
        ? smList.flatMap((s) => s.states).find((s) => s.name === enclosingStateName)
        : null;

      const localOutputs = new Set<string>();
      for (const st of sm.states) {
        for (const vIdx of st.varIndices!) {
          if (dae.getVarCausality(vIdx) === 2 || Boolean((dae as any).stateOutputVars?.has(dae.getVarName(vIdx)))) {
            const fullName = dae.getVarName(vIdx);
            const shortName = fullName.slice(st.name.length + 1);
            localOutputs.add(shortName);
          }
        }
      }

      for (const shortName of localOutputs) {
        const targetVarName = enclosingStateName ? `${enclosingStateName}.${shortName}` : shortName;
        const targetVarIdx = dae.getVarIdxByName(targetVarName);
        if (targetVarIdx < 0) continue;

        const branches: { stateName: string; stateVarName: string }[] = [];
        for (const st of sm.states) {
          const stVarName = `${st.name}.${shortName}`;
          if (dae.getVarIdxByName(stVarName) >= 0) {
            branches.push({ stateName: st.name, stateVarName: stVarName });
          }
        }
        if (branches.length === 0) continue;

        let prevVarName = targetVarName;
        if ((dae as any).stateOutputVars?.has(targetVarName)) {
          const outerDot = targetVarName.lastIndexOf(".");
          prevVarName = outerDot >= 0 ? targetVarName.slice(outerDot + 1) : targetVarName;
        }

        const prevCall = dae.addCallExpr("previous", [
          dae.addExpression(ExprKind.Name, dae.interner.intern(prevVarName)),
        ]);

        let currElse = prevCall;
        for (let b = branches.length - 1; b >= 0; b--) {
          const br = branches[b]!;
          const cond = dae.addCallExpr("activeState", [
            dae.addExpression(ExprKind.Name, dae.interner.intern(br.stateName)),
          ]);
          const thenExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(br.stateVarName));
          currElse = dae.addIfElse(cond, thenExpr, currElse);
        }

        const lhsExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(targetVarName));
        const muxEqIdx = dae.addEquation(EqKind.Simple, lhsExpr, currElse);

        if (parentState) {
          parentState.multiplexerEqIndices!.push(muxEqIdx);
        }
      }
    }

    // Build hierarchy: attach child state machines to parent states
    const topLevelSms: ArenaStateMachine[] = [];
    for (const sm of smList) {
      const dotIdx = sm.name.lastIndexOf(".");
      if (dotIdx >= 0) {
        const parentStateName = sm.name.slice(0, dotIdx);
        const parentState = smList.flatMap((s) => s.states).find((st) => st.name === parentStateName);
        if (parentState) {
          parentState.stateMachines.push(sm);
          continue;
        }
      }
      topLevelSms.push(sm);
    }

    dae.stateMachines = topLevelSms;
  }

  constructor(db: QueryDB, options?: FlattenOptions) {
    this.db = db;
    const omcCompatibility = options?.omcCompatibility ?? false;
    let backend: FlattenerBackend =
      options?.backend ?? (options as any)?.flattenerBackend ?? (options?.useWasmKernel ? "wasm" : "hybrid");
    this.options = {
      backend,
      arrayMode: options?.arrayMode ?? (omcCompatibility ? "scalarize" : "preserve"),
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility,
      eliminateAliases: options?.eliminateAliases ?? !omcCompatibility,
      useWasmKernel:
        backend === "wasm" || backend === "hybrid" || backend === "diff" || Boolean(options?.useWasmKernel),
      scalarizeBindings: options?.scalarizeBindings ?? false,
      flowThreshold: options?.flowThreshold,
      intEnumConversion: Boolean(options?.intEnumConversion),
    };
  }

  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      const optBackend = options.backend ?? (options as any).flattenerBackend;
      if (optBackend !== undefined) {
        this.options.backend = optBackend;
        this.options.useWasmKernel = optBackend === "wasm" || optBackend === "hybrid" || optBackend === "diff";
      } else if (options.useWasmKernel !== undefined) {
        this.options.useWasmKernel = options.useWasmKernel;
        this.options.backend = options.useWasmKernel ? "wasm" : "ts";
      }
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
      if (options.scalarizeBindings !== undefined) this.options.scalarizeBindings = options.scalarizeBindings;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    this.bodySnapshot = dae;
    return dae;
  }

  private classHasRedeclare(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (this.db.query<boolean>("isRedeclare", child.id)) {
        return true;
      }
      if (this.db.query<boolean>("isReplaceable", child.id)) {
        return true;
      }
      if (child.kind === "Extends") {
        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", child.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        for (const arg of extendsModParsed) {
          if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return true;
        }
        const baseClass = this.db.query<any>("resolvedBaseClass", child.id) ?? this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasRedeclare(baseClass.id, visited)) return true;
      }
      if (child.kind === "Component") {
        const compInst = this.db.query<any>("componentInstance", child.id);
        if (compInst?.isReplaceable) return true;
        if (compInst?.modification?.args) {
          for (const arg of compInst.modification.args) {
            if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return true;
          }
        }
      }
    }
    return false;
  }

  private classHasConnect(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);

    const cst = this.db.cstNode(classId) as any;
    if (cst?.text?.includes("connect(")) return true;

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass = this.db.query<any>("resolvedBaseClass", child.id) ?? this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasConnect(baseClass.id, visited)) return true;
      }
    }
    return false;
  }

  flattenClass(rootClassId: SymbolId, cachedArena?: DAEBuilder | null): DAEBuilder {
    this.currentRootClassId = rootClassId;
    this.currentClassId = rootClassId;
    this.innerOuterComponents.clear();
    this.innerDeclarations.clear();
    this.disabledComponents.clear();
    this.usedExternalObjects.clear();
    this.failedFunctionIds.clear();
    this.invalidInterfaceFunctionIds.clear();
    this.calledFunctionSymIds.clear();
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
    const hasScalarizeBindings = Boolean(
      classCst?.text?.includes("+scalarizeBindings") || this.options.scalarizeBindings,
    );
    dae.extensionMetadata.scalarizeBindings = hasScalarizeBindings;
    this.validateOperatorRecords(dae, rootClassId);

    // Check for non-instantiable class specializations (package, function, etc.)
    const classCstForCheck = classCst as SyntaxNode | null;
    const hasDirectOldFrontend = (node: SyntaxNode | null): boolean => {
      if (!node) return false;
      const spec =
        node.childForFieldName?.("class_specifier") ??
        node.children?.find((c: any) => c.type === "class_specifier" || c.type === "ClassSpecifier");
      const lcs =
        spec?.childForFieldName?.("long_class_specifier") ??
        spec?.children?.find((c: any) => c.type === "long_class_specifier" || c.type === "LongClassSpecifier");
      const comp =
        lcs?.childForFieldName?.("composition") ??
        lcs?.children?.find((c: any) => c.type === "composition" || c.type === "Composition");
      const el =
        comp?.childForFieldName?.("element_list") ??
        comp?.children?.find((c: any) => c.type === "element_list" || c.type === "ElementList");
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
    const isStrictWasm = this.options.backend === "wasm";
    const isDiffMode = this.options.backend === "diff";
    const allowWasm =
      this.options.backend === "wasm" ||
      ((this.options.backend === "hybrid" || !this.options.backend) &&
        Boolean(this.options.useWasmKernel) &&
        !this.classHasRedeclare(rootClassId) &&
        !(this.options.omcCompatibility && this.classHasConnect(rootClassId)));

    let wasmDiffStats: { varCount: number; eqCount: number; error?: string } | null = null;
    if (isDiffMode && hasWasmFlattener && classNodePtr) {
      try {
        const testDae = new DAEBuilder(wasmExports, rootName, "");
        const wf = testDae.exports.flattener_create(testDae.ptr);
        if (wf) {
          const vc = testDae.exports.flattener_flatten(wf, classNodePtr, rootProgramPtr);
          wasmDiffStats = { varCount: vc, eqCount: testDae.eqCount };
        }
      } catch (err: any) {
        wasmDiffStats = { varCount: 0, eqCount: 0, error: err?.message ?? String(err) };
      }
      (this as any)._wasmDiffStats = wasmDiffStats;
    }

    if (!cachedArena && hasWasmFlattener && classNodePtr && allowWasm) {
      try {
        const wasmFlattener = dae.exports.flattener_create(dae.ptr);
        if (wasmFlattener) {
          const varCount = dae.exports.flattener_flatten(wasmFlattener, classNodePtr, rootProgramPtr);
          if (typeof dae.exports.flattener_getErrorCode === "function") {
            (dae as any).wasmErrorCode = dae.exports.flattener_getErrorCode(wasmFlattener);
          }
          // In hybrid mode, if WASM flattener set a non-zero error code, fall back to TS
          const wasmErrorCode = (dae as any).wasmErrorCode ?? 0;
          if (varCount > 0 && (wasmErrorCode === 0 || isStrictWasm)) {
            flattenedInWasm = true;
            this.recordWasmSourceRanges(dae, rootClassId);
            for (let i = 0; i < dae.eqCount; i++) {
              const rhsId = dae.getEqRhs(i);
              dae.setOrigEqRhs(i, rhsId);
              if (rhsId >= 0) {
                const names = dae.collectExprVarNames(rhsId);
                for (const name of names) {
                  dae.registerParamEquationDep(name, i);
                }
              }
              const lhsId = dae.getEqLhs(i);
              if (lhsId >= 0) {
                const names = dae.collectExprVarNames(lhsId);
                for (const name of names) {
                  dae.registerParamEquationDep(name, i);
                }
              }
            }
          }
        }
      } catch {
        flattenedInWasm = false;
      }
      if (!flattenedInWasm) {
        if (isStrictWasm) {
          dae.diagnostics.push({
            code: 1099,
            rule: "wasm-flattener-unsupported",
            severity: "error",
            message: `[ModelicaFlattener] Model '${rootName}' could not be flattened using strict WASM backend.`,
            range: null,
          });
          return dae;
        }
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
        const rootInstantiating = new Set<SymbolId>();
        if (rootClassId) rootInstantiating.add(rootClassId);

        this.instantiateElements(elements, "", dae, {
          args: rootExtendsMods,
          protectedNames: rootProtectedNames,
          instantiatingClassIds: rootInstantiating,
        });
      }
      const hasFatalInstantiationError = dae.diagnostics.some((d) => {
        if (d.severity !== "error") return false;
        if ((d as any).fromFunction) return false;
        if (
          d.code === ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code ||
          d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code ||
          (this.failedFunctionIds.size > 0 && d.message.includes("for function component")) ||
          (this.failedFunctionIds.size > 0 && d.message.includes("Invalid protected variable")) ||
          (this.failedFunctionIds.size > 0 && d.message.includes("in modifier of component"))
        ) {
          return false;
        }
        return true;
      });
      if (this.options.omcCompatibility && hasFatalInstantiationError) {
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
      for (const fn of dae.functions.values()) {
        const fnSym = (fn as any).symId;
        if (fnSym && this.calledFunctionSymIds.has(fnSym)) {
          (fn as any).wasCalled = true;
        }
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
      let flowThreshold = this.options.flowThreshold;
      if (flowThreshold === undefined && rootCst?.text) {
        const flowThreshMatch = rootCst.text.match(/--flowThreshold=([0-9.eE+-]+)/);
        if (flowThreshMatch) {
          flowThreshold = parseFloat(flowThreshMatch[1]);
        }
      }
      ModelicaPortBalancer.expandConnections(dae, {
        omcCompatibility: this.options.omcCompatibility,
        isOldFrontend,
        flowThreshold,
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

    const attachDiffReport = (targetDae: DAEBuilder) => {
      const wasmDiff = (this as any)._wasmDiffStats as
        | { varCount: number; eqCount: number; error?: string }
        | undefined;
      if (wasmDiff) {
        delete (this as any)._wasmDiffStats;
        (targetDae as any).diffReport = wasmDiff;
        if (process.env.DEBUG_DIFF === "1") {
          if (wasmDiff.error) {
            console.warn(`[DiffFlattener] WASM flattener failed: ${wasmDiff.error}`);
          } else {
            const varMatch = wasmDiff.varCount === targetDae.varCount;
            const eqMatch = wasmDiff.eqCount === targetDae.eqCount;
            console.log(
              `[DiffFlattener] ${varMatch && eqMatch ? "PARITY MATCH" : "PARITY MISMATCH"}: vars (WASM=${wasmDiff.varCount}, TS=${targetDae.varCount}), eqs (WASM=${wasmDiff.eqCount}, TS=${targetDae.eqCount})`,
            );
          }
        }
      }
    };

    const shouldScalarize =
      this.options.arrayMode === "scalarize" ||
      (this.options.arrayMode !== "preserve" && (this.options.omcCompatibility || hasArrayEquations(dae)));
    if (shouldScalarize) {
      const scalarized = scalarizeArena(dae);
      foldArenaConstants(scalarized, this.db, rootClassId, this.options.omcCompatibility);
      this.extractStateMachines(scalarized);
      scalarized.groupEquationsForParity();
      this.checkBalance(scalarized, rootClassId);
      attachDiffReport(scalarized);
      return scalarized;
    }

    this.extractStateMachines(dae);
    dae.groupEquationsForParity();
    const t6 = performance.now();
    this.checkBalance(dae, rootClassId);
    const t7 = performance.now();

    attachDiffReport(dae);
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
          let baseName = varName.split("[")[0];

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

  public generateRecordConstructorFor(sym: any, dae: DAEBuilder, rootClassId?: SymbolId): DAEBuilder | null {
    if (!sym) return null;
    const fnName = rootClassId && sym.parentId === rootClassId ? `${dae.name}.${sym.name}` : sym.name;
    const qualName = getSymbolQualifiedName(this.db, sym.id);
    const existing =
      dae.getFunction(fnName) ?? dae.getFunction(sym.name) ?? (qualName ? dae.getFunction(qualName) : undefined);
    if (existing) return existing;

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
    const symMod = this.db.query<any>("effectiveModification", sym.id);
    const redeclArgs = symMod?.args?.filter((a: any) => a.isRedeclaration) ?? [];
    const redeclaredCompNames = new Set(redeclArgs.map((a: any) => a.name));

    if (
      comps.some((c) => {
        const ci = this.db.query<ComponentInstanceData>("componentInstance", c.id);
        return ci?.isReplaceable && !redeclaredCompNames.has(c.name);
      })
    ) {
      return null;
    }

    for (const comp of comps) {
      if (comp && comp.kind === "Component") {
        const compInst = this.db.query<ComponentInstanceData>("componentInstance", comp.id);
        const cMeta = (comp.metadata as any) || {};
        const redeclForComp = redeclArgs.find((a: any) => a.name === comp.name);
        let typeSpec = redeclForComp?.redeclaredTypeSpecifier ?? compInst?.typeSpecifier ?? cMeta.typeSpecifier;
        let compTargetId: SymbolId | null = null;
        if (typeSpec) {
          const simple = typeSpec.split(".").pop()!;
          const targets = this.db.byName(simple);
          const found = targets.find((t) => t.kind === "Class" || (t.metadata as any)?.classKind === "type");
          if (found) compTargetId = found.id;
        }

        const compTypeMods: any[] = [];
        if (compTargetId && this.isClassType(compTargetId)) {
          let currTypeId: SymbolId | null = compTargetId;
          while (currTypeId) {
            const mod = this.db.query<any>("effectiveModification", currTypeId);
            if (mod?.args) compTypeMods.unshift(...mod.args);
            let base: any = this.db.query("resolvedBaseClass", currTypeId);
            const extChild = this.db.childrenOf(currTypeId).find((c) => c.kind === "Extends");
            if (extChild && !base) {
              base = this.db.query("resolvedBaseClass", extChild.id) ?? this.db.byName(extChild.name)[0];
            }
            if (!base || base.id === currTypeId) break;
            typeSpec = base.name;
            currTypeId = this.isClassType(base.id) ? base.id : null;
          }
        }

        let vType = VarType.Real;
        if (typeSpec === "Integer" || cMeta.varType === VarType.Integer) vType = VarType.Integer;
        else if (typeSpec === "Boolean" || cMeta.varType === VarType.Boolean) vType = VarType.Boolean;
        else if (typeSpec === "String" || cMeta.varType === VarType.String) vType = VarType.String;
        else if (typeSpec === "Clock" || cMeta.varType === VarType.Clock) vType = VarType.Clock;

        const compCst = this.db.cstNode(comp.id) as any;
        const cstText = compCst?.text ?? "";
        const isInput = /\binput\b/.test(cstText);
        const isOutput = /\boutput\b/.test(cstText);
        const isConstant =
          compInst?.variability === "constant" ||
          cMeta.variability === "constant" ||
          cMeta.isConstant === true ||
          /\bconstant\b/.test(cstText);
        const isCompProt = this.isCstNodeProtected(compCst) && !isInput && !isOutput;
        const causality = isOutput ? Causality.Output : isCompProt ? Causality.Local : Causality.Input;
        const variability = isConstant ? Variability.Constant : Variability.Continuous;
        const varIdx = fn.addVariable(comp.name, vType, variability, causality);
        if (isCompProt) {
          fn.setVarProtected(varIdx, true);
        }
        if (typeSpec && !["Real", "Integer", "Boolean", "String"].includes(typeSpec)) {
          fn.setVarCustomType(varIdx, typeSpec);
        }
        if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
          fn.setVarShape(varIdx, compInst.arrayDimensions);
        }
        for (const attr of compTypeMods) {
          if (attr.value) {
            const val = attr.value;
            let exprId: number | null = null;
            if (val.kind === "literal") {
              if (typeof val.value === "number") exprId = fn.addRealLiteral(val.value);
              else if (typeof val.value === "string") exprId = fn.addStringLiteral(val.value);
            } else if (val.text) {
              const t = val.text.trim();
              if (t.startsWith('"') && t.endsWith('"')) {
                exprId = fn.addStringLiteral(t.slice(1, -1));
              } else {
                const num = Number(t);
                if (!isNaN(num)) exprId = fn.addRealLiteral(num);
              }
            }
            if (exprId !== null) {
              fn.setVarAttr(varIdx, attr.name, exprId);
            }
          }
        }
        const bText = compInst?.modification?.bindingExpression?.text?.trim();
        if (bText) {
          const num = Number(bText);
          if (!isNaN(num)) {
            const exprId = vType === VarType.Integer ? fn.addIntLiteral(Math.round(num)) : fn.addRealLiteral(num);
            fn.setVarExpression(varIdx, exprId);
          } else if (bText === "true" || bText === "false") {
            fn.setVarExpression(varIdx, fn.addBoolLiteral(bText === "true"));
          } else if (bText.startsWith('"') && bText.endsWith('"')) {
            fn.setVarExpression(varIdx, fn.addStringLiteral(bText.slice(1, -1)));
          } else {
            const findBindingExprNode = (n: any): any => {
              if (!n) return null;
              if (n.type === "expression" || n.type === "Expression") return n;
              for (const c of n.children || []) {
                const res = findBindingExprNode(c);
                if (res) return res;
              }
              return null;
            };
            const modChild = (compCst as any)?.children?.find(
              (c: any) => c.type === "modification" || c.type === "Modification",
            );
            const exprCst = findBindingExprNode(modChild ?? compCst);
            if (exprCst) {
              const exprId = this.lowerExpr(exprCst, fn, "");
              if (exprId >= 0) fn.setVarExpression(varIdx, exprId);
            }
          }
        }
      }
    }
    const resIdx = fn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
    fn.setVarCustomType(resIdx, sym.name);
    dae.addFunction(fnName, fn);
    if (sym.name && sym.name !== fnName) dae.addFunction(sym.name, fn);
    if (qualName && qualName !== fnName && qualName !== sym.name) dae.addFunction(qualName, fn);

    let rootDae: any = (this as any)?.currentRootDae ?? dae;
    while (rootDae.parentDae) rootDae = rootDae.parentDae;
    rootDae.addFunction(fnName, fn);
    if (sym.name && sym.name !== fnName) rootDae.addFunction(sym.name, fn);
    if (qualName && qualName !== fnName && qualName !== sym.name) rootDae.addFunction(qualName, fn);

    return fn;
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
        const fn = this.generateRecordConstructorFor(sym, dae, rootClassId);
        if (!fn) continue;

        // In OMC compatibility mode, synthesize specialized constructors for modified record components in the file
        if (this.options.omcCompatibility && rootSym?.resourceId) {
          const fileComps = this.db
            .allEntries()
            .filter((s: any) => s.resourceId === rootSym.resourceId && s.kind === "Component");
          for (const c of fileComps) {
            const typeSpec = this.db.query<string | null>("typeSpecifier", c.id);
            if (typeSpec === sym.name || typeSpec === `.${sym.name}`) {
              const cInst = this.db.query<ComponentInstanceData>("componentInstance", c.id);
              if (cInst?.modification && cInst.modification.args && cInst.modification.args.length > 0) {
                const specFnName = `${sym.name}$${c.name}`;
                if (!dae.functions.has(specFnName)) {
                  const specFn = new DAEBuilder(dae.interner, specFnName, "");
                  specFn.classKind = "function";
                  specFn.description = `Automatically generated record constructor for ${specFnName}`;
                  for (let i = 0; i < fn.varCount; i++) {
                    const vName = fn.getVarName(i);
                    if (vName === "res") continue;
                    const vType = fn.getVarType(i);
                    const vCausality = fn.getVarCausality(i);
                    const vProt = fn.isVarProtected(i);
                    const vShape = fn.getVarShape(i);
                    const vCustom = fn.getVarCustomType(i);
                    const vExpr = fn.getVarExpression(i);
                    const specVarIdx = specFn.addVariable(vName, vType, Variability.Continuous, vCausality);
                    if (vProt) specFn.setVarProtected(specVarIdx, true);
                    if (vCustom) specFn.setVarCustomType(specVarIdx, vCustom);
                    if (vShape.length > 0) specFn.setVarShape(specVarIdx, vShape);
                    if (vExpr >= 0) {
                      const ek = fn.getExprKind(vExpr);
                      if (ek === ExprKind.RealLiteral) {
                        specFn.setVarExpression(specVarIdx, specFn.addRealLiteral(fn.getExprRealValue(vExpr)));
                      } else if (ek === ExprKind.IntLiteral) {
                        specFn.setVarExpression(specVarIdx, specFn.addIntLiteral(fn.getExprData1(vExpr)));
                      } else if (ek === ExprKind.BoolLiteral) {
                        specFn.setVarExpression(specVarIdx, specFn.addBoolLiteral(fn.getExprData1(vExpr) !== 0));
                      }
                    }
                  }
                  const specResIdx = specFn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
                  specFn.setVarCustomType(specResIdx, specFnName);
                  dae.addFunction(specFnName, specFn);
                }
              }
            }
          }
        }
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

  private flattenFunction(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: any[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder {
    const prevFnId = this.currentFlatteningFunctionId;
    const prevClassId = this.currentClassId;
    const prevEnclosingScope = this.currentFunctionEnclosingScope;
    this.currentFlatteningFunctionId = fnSymId;
    if (enclosingScopeId !== undefined) {
      this.currentClassId = enclosingScopeId;
      // Only track the enclosing scope for inherited functions (where the function's
      // parent class differs from the enclosing scope). This enables step 3b in call
      // resolution to find redeclared sibling functions in the extending package.
      const fnParentId = this.db.symbol(fnSymId)?.parentId;
      if (fnParentId !== undefined && fnParentId !== enclosingScopeId) {
        this.currentFunctionEnclosingScope = enclosingScopeId;
      }
    } else {
      this.currentFunctionEnclosingScope = null;
    }

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
    if (cst?.text && /\b__OpenModelica_EarlyInline\s*=\s*true\b/.test(cst.text)) {
      (fn as any).isEarlyInline = true;
    }
    if (cst?.text && /\bimpure\s+function\b/.test(cst.text)) {
      fn.isImpure = true;
    }

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
      } else {
        const mathMatch = baseName.match(
          /^(?:Modelica\.Math\.)?(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log10|sqrt)$/,
        );
        if (mathMatch) {
          (fn as any).aliasTo = mathMatch[1];
        }
      }
    }

    const elements = this.db.query<SymbolId[]>("instantiate", targetSymId);
    if (elements && elements.length > 0) {
      this.instantiateElements(elements, "", fn, { args: combinedMods });
    }

    if (extClause) {
      const hasCall =
        extClause.children?.some(
          (c: any) => c.type === "external_function_call" || c.type === "ExternalFunctionCall",
        ) || /\(/.test(extClause.text ?? "");
      let extText = extClause.text?.trim() ?? "";
      extText = extText.replace(/\s*annotation\s*\([\s\S]*?\)\s*;?$/, "").trim();
      if (extText.endsWith(";")) extText = extText.slice(0, -1).trim();

      if (!hasCall) {
        // Synthesize default external call: [output =] name(inputs) per MLS §12.9.1
        const inputs: string[] = [];
        let outputName: string | null = null;
        for (let i = 0; i < fn.varCount; i++) {
          if (fn.isVarRemoved(i)) continue;
          const causality = fn.getVarCausality(i);
          const varName = fn.getVarName(i);
          if (causality === Causality.Input) {
            inputs.push(varName);
          } else if (causality === Causality.Output && !outputName) {
            outputName = varName;
          }
        }
        const callSig = `${baseName}(${inputs.join(", ")})`;
        const defaultCall = outputName ? `${outputName} = ${callSig}` : callSig;
        extText = `${extText} ${defaultCall}`.trim();
      }

      if (!extText.endsWith(";")) extText += ";";
      fn.externalDecl = extText;
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
      const cleanupFrom = (targetDae: any) => {
        if (!targetDae) return;
        for (const k of [cleanFnName, fnName, baseName]) {
          if (!k) continue;
          targetDae.functions.delete(k);
          const id = targetDae.interner?.lookup(k);
          if (id !== undefined) targetDae.functions.delete(id);
        }
      };
      cleanupFrom(parentDae);
      let rootDae: any = (this as any)?.currentRootDae ?? parentDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      cleanupFrom(rootDae);
      this.failedFunctionIds.add(fnSymId);
      const hasInterfaceError = fn.diagnostics.some(
        (d) => d.severity === "error" && !d.message.includes("looking for a function or record"),
      );
      if (hasInterfaceError) {
        this.invalidInterfaceFunctionIds.add(fnSymId);
      }
    } else if (fn.functions && fn.functions.size > 0) {
      let rootDae: any = (this as any)?.currentRootDae ?? parentDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      if (rootDae) {
        for (const [nestedName, nestedFn] of fn.functions.entries()) {
          rootDae.addFunction(nestedName, nestedFn);
        }
      }
      if (parentDae) {
        for (const [nestedName, nestedFn] of fn.functions.entries()) {
          parentDae.addFunction(nestedName, nestedFn);
        }
      }
    }

    this.currentImports = prevImports;
    this.currentFlatteningFunctionId = prevFnId;
    this.currentClassId = prevClassId;
    this.currentFunctionEnclosingScope = prevEnclosingScope;
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
              (d as any).fromFunction = true;
              dae.diagnostics.push(d);
            }
          }
          this.failedFunctionIds.add(cc.id);
        } else {
          (fn as any).isNestedMember = true;
          (fn as any).symId = cc.id;
          if (this.calledFunctionSymIds.has(cc.id)) {
            (fn as any).wasCalled = true;
          }
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
                  (d as any).fromFunction = true;
                  dae.diagnostics.push(d);
                }
              }
              this.failedFunctionIds.add(target.id);
            } else {
              (fn as any).symId = target.id;
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
                  (d as any).fromFunction = true;
                  dae.diagnostics.push(d);
                }
              }
              this.failedFunctionIds.add(bf.id);
            } else {
              (fn as any).symId = bf.id;
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
                  (d as any).fromFunction = true;
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
    for (const elemId of elements) {
      const compInst = this.db.query<ComponentInstanceData>("componentInstance", elemId);
      if (compInst?.name && compInst?.typeSpecifier) {
        const leafType = compInst.typeSpecifier.split(".").pop();
        if (compInst.name === leafType) {
          const elemCst = this.db.cstNode(elemId) as any;
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
          dae.diagnostics.push({
            severity: "error",
            code: 0,
            message: `Found a component with same name when looking for type ${compInst.typeSpecifier}.`,
            range: rangeObj,
          });
          return;
        }
      }
    }

    const declaredNames = new Set<string>();
    for (const elemId of elements) {
      const sym = this.db.symbol(elemId);
      if (sym?.name) {
        const compInst = this.db.query<ComponentInstanceData>("componentInstance", elemId);
        if (compInst?.isOuter && !compInst.isInner) {
          continue;
        }
        declaredNames.add(sym.name);
      }
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
    const basePrefix = stripArraySubscripts(prefix);
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

    const prevCompClauseRange = (dae as any).currentCompClauseRange;
    const prevClassId = this.currentClassId;
    if (parentMods?.componentClauseRange) {
      (dae as any).currentCompClauseRange = parentMods.componentClauseRange;
    }
    if (parentMods?.currentClassId) {
      this.currentClassId = parentMods.currentClassId;
    }

    try {
      for (const elemId of elements) {
        const compInst = this.db.query<ComponentInstanceData>("componentInstance", elemId);
        if (compInst?.isInner && compInst?.name) {
          const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
          if (!this.innerDeclarations.has(prefix)) {
            this.innerDeclarations.set(prefix, new Map<string, string>());
          }
          this.innerDeclarations.get(prefix)!.set(compInst.name, fullCompName);
        }
      }

      for (const elemId of elements) {
        const compInst = this.db.query<ComponentInstanceData>("componentInstance", elemId);
        if (!compInst) continue;

        const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        if (compInst.isInner) {
          if (!this.innerDeclarations.has(prefix)) {
            this.innerDeclarations.set(prefix, new Map<string, string>());
          }
          this.innerDeclarations.get(prefix)!.set(compInst.name, fullCompName);
        }

        const isStateOutput = Boolean(compInst.isOuter && compInst.causality === "output");
        if (compInst.isOuter && !compInst.isInner) {
          let p: string | null = prefix;
          while (p !== null) {
            const innerMap = this.innerDeclarations.get(p);
            if (innerMap && innerMap.has(compInst.name)) {
              const targetInner = innerMap.get(compInst.name)!;
              if (!(dae as any).outerToInner) (dae as any).outerToInner = new Map<string, string>();
              (dae as any).outerToInner.set(fullCompName, targetInner);
              break;
            }
            p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
          }
          if (!isStateOutput) {
            continue;
          }
        }
        if (isStateOutput) {
          if (!(dae as any).stateOutputVars) (dae as any).stateOutputVars = new Set<string>();
          (dae as any).stateOutputVars.add(fullCompName);
        }
        if (compInst.isOuter && compInst.isInner) {
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
          (!compInst.isOuter || isStateOutput) &&
          !compInst.isRedeclare &&
          !compInst.isReplaceable &&
          !compInst.isProtected &&
          !this.isCstNodeProtected(this.db.cstNode(elemId)) &&
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
            else if (compInst.typeSpecifier === "Clock") varType = VarType.Clock;

            let variability = Variability.Continuous;
            if (parentMods?.parentVariability === Variability.Constant) {
              variability = Variability.Constant;
            } else if (compInst.variability === "parameter") variability = Variability.Parameter;
            else if (compInst.variability === "constant") variability = Variability.Constant;
            else if (compInst.variability === "discrete") variability = Variability.Discrete;
            else if (parentMods?.parentVariability !== undefined) variability = parentMods.parentVariability;

            if (variability === Variability.Constant && prefix && !parentMods?.isRecord) {
              continue;
            }
            if (variability === Variability.Constant && bText && /^[a-zA-Z_]\w*$/.test(bText)) {
              const targetConst = resolveScopedName(bText, prefix, dae);
              const targetIdx = dae.getVarIdxByName(targetConst);
              if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
                if (!(dae as any).constantAliases) (dae as any).constantAliases = new Map<string, string>();
                (dae as any).constantAliases.set(name, targetConst);
                continue;
              }
            }

            const isEvaluated = this.db.query<boolean>("isEvaluate", elemId);
            if (!this.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
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
            if (prefix && !this.isInsideExpandableBus(prefix) && !isStateOutput) causality = Causality.Local;

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
        if (this.currentClassId && compInst.typeSpecifier) {
          const origClassSym = classTargetId ? this.db.symbol(classTargetId) : null;
          if (origClassSym && origClassSym.parentId !== null) {
            const scopeTarget = compInst.typeSpecifier.includes(".")
              ? this.db.query<(n: string) => SymbolEntry | null>(
                  "resolveName",
                  this.currentClassId,
                )?.(compInst.typeSpecifier)
              : this.db.query<(n: string) => SymbolEntry | null>(
                  "resolveSimpleName",
                  this.currentClassId,
                )?.(compInst.typeSpecifier);
            if (
              scopeTarget &&
              scopeTarget.id !== classTargetId &&
              !(scopeTarget.metadata as any)?.isPredefined &&
              (scopeTarget.kind === "Class" || (scopeTarget.metadata as any)?.classKind === "type")
            ) {
              classTargetId = scopeTarget.id;
            }
          }
        }
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
        if (classTargetId) {
          classTargetId = this.resolveInnerOuterClass(classTargetId);
        }

        const typeLeaf = compInst.typeSpecifier ? compInst.typeSpecifier.split(".").pop() : "";
        let matchingClassArg = parentMods?.args
          ?.slice()
          .reverse()
          .find((a: any) => !a.isBreak && (a.name === compInst.typeSpecifier || (typeLeaf && a.name === typeLeaf)));
        if (!matchingClassArg && compInst.typeSpecifier?.includes(".")) {
          const typeParts = compInst.typeSpecifier.split(".");
          let curArgs = parentMods?.args;
          let matchedNested: any = null;
          for (let pIdx = 0; pIdx < typeParts.length; pIdx++) {
            const part = typeParts[pIdx]!;
            const found = curArgs
              ?.slice()
              .reverse()
              .find((a: any) => !a.isBreak && a.name === part);
            if (!found) {
              matchedNested = null;
              break;
            }
            if (pIdx === typeParts.length - 1) {
              matchedNested = found;
            } else {
              curArgs = found.nestedArgs || found.args;
            }
          }
          if (matchedNested) {
            matchingClassArg = matchedNested;
          }
        }
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
              : (parentMods?.args?.find(
                  (a: any) => a.name === compInst.name && a.isRedeclaration && a.redeclaredTypeSpecifier,
                ) ?? null);
        const origClassTargetId = classTargetId;
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
            if (origClassTargetId && origClassTargetId !== redeclTargetId) {
              const origMod = this.db.query<any>("effectiveModification", origClassTargetId);
              if (origMod?.args && origMod.args.length > 0) {
                const targetElements = this.db.query<SymbolId[]>("instantiate", redeclTargetId) ?? [];
                const validTargetFieldNames = new Set(
                  targetElements.map((eid) => this.db.symbol(eid)?.name).filter(Boolean),
                );
                const existingNames = new Set((redeclArg.nestedArgs || []).map((a: any) => a.name));
                const inheritedArgsToPreserve: any[] = [];
                for (const oArg of origMod.args) {
                  if (
                    oArg?.name &&
                    !existingNames.has(oArg.name) &&
                    (validTargetFieldNames.size === 0 || validTargetFieldNames.has(oArg.name))
                  ) {
                    inheritedArgsToPreserve.push(oArg);
                    existingNames.add(oArg.name);
                  }
                }
                if (inheritedArgsToPreserve.length > 0) {
                  redeclArg.nestedArgs = [...inheritedArgsToPreserve, ...(redeclArg.nestedArgs || [])];
                }
              }
            }
            classTargetId = redeclTargetId;
          } else if (["Real", "Integer", "Boolean", "String"].includes(redeclArg.redeclaredTypeSpecifier)) {
            classTargetId = null;
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
          const instantiatingClassIds: Set<SymbolId> =
            parentMods?.instantiatingClassIds ?? new Set(this.currentRootClassId ? [this.currentRootClassId] : []);
          if (classTargetId && instantiatingClassIds.has(classTargetId)) {
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
            const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
            dae.diagnostics.push({
              severity: "error",
              code: 0,
              message: `Declaration of element ${compInst.name} causes recursive definition of class ${targetClassName}.`,
              range: rangeObj,
            });
            continue;
          }

          if (classTargetId) {
            const nestedClasses = this.db
              .childrenOf(classTargetId)
              .filter((c) => c.kind === "Class" || c.kind === "Package");
            let hasPartialErr = false;
            for (const nc of nestedClasses) {
              const ncCst = this.db.cstNode(nc.id) as any;
              const ncText: string = ncCst?.text ?? "";
              const isPartialClass = /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test(ncText.trim());
              if (isPartialClass) {
                const isRedeclared = parentMods?.args?.some(
                  (a: any) => a.name === nc.name && (a.kind === "redeclare" || a.isRedeclare),
                );
                if (!isRedeclared) {
                  const ncRange = ncCst
                    ? { startByte: ncCst.startIndex ?? ncCst.startByte, endByte: ncCst.endIndex ?? ncCst.endByte }
                    : undefined;
                  let clauseNode: any = elemCst;
                  while (
                    clauseNode &&
                    clauseNode.type !== "component_clause" &&
                    clauseNode.type !== "ComponentClause"
                  ) {
                    clauseNode = clauseNode.parent;
                  }
                  const compRange = clauseNode
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
                  dae.diagnostics.push({
                    severity: "notification",
                    code: 2090,
                    message: "From here:",
                    range: ncRange,
                  });
                  const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
                  dae.diagnostics.push({
                    severity: "error",
                    code: 4028,
                    message: `component ${compInst.name} contains the definition of a partial class ${nc.name}.\nPlease redeclare it to any package compatible with ${targetClassName}.${nc.name}.`,
                    range: compRange,
                  });
                  hasPartialErr = true;
                  break;
                }
              }
            }
            if (hasPartialErr) continue;
          }

          const nextInstantiatingClassIds = new Set(instantiatingClassIds);
          if (classTargetId) nextInstantiatingClassIds.add(classTargetId);

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
          const recordCtorArgs: any[] = [];
          if (isRecordTarget) {
            const bText = (
              matchingParentArg?.value?.text ??
              matchingClassArg?.value?.text ??
              compInst.modification?.bindingExpression?.text
            )?.trim();
            const ctorCallMatch = bText ? bText.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/) : null;
            if (ctorCallMatch) {
              const ctorName = ctorCallMatch[1]!;
              const targetBaseName = classTarget?.name ?? compInst.typeSpecifier.split(".").pop();
              if (ctorName === targetBaseName || ctorName.endsWith(`.${targetBaseName}`)) {
                const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                const subSyms = subElements
                  .map((id) => this.db.symbol(id))
                  .filter(
                    (s) =>
                      s &&
                      s.kind === "Component" &&
                      !this.isCstNodeProtected(this.db.cstNode(s.id)) &&
                      (s.metadata as any)?.variability !== "constant",
                  );
                for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                  const argStr = rawArgs[aIdx]!;
                  const eqIdx = argStr.indexOf("=");
                  if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                    const fName = argStr.slice(0, eqIdx).trim();
                    const fVal = argStr.slice(eqIdx + 1).trim();
                    recordCtorArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                  } else if (subSyms[aIdx]) {
                    const fName = subSyms[aIdx]!.name;
                    recordCtorArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                  }
                }
              }
            }
          }

          const isRecordVarRef =
            parentMods?.bindingExpression?.text &&
            /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(parentMods.bindingExpression.text.trim());
          const parentBoundRecordField = isRecordVarRef
            ? { kind: "expression", text: `${parentMods.bindingExpression.text.trim()}.${compInst.name}` }
            : null;

          const bindingScope = matchingParentArg?.value
            ? prefix.includes(".")
              ? prefix.split(".").slice(0, -1).join(".")
              : ""
            : (parentMods?.bindingScope ?? prefix);

          let compClauseNode: any = elemCst;
          while (
            compClauseNode &&
            compClauseNode.type !== "component_clause" &&
            compClauseNode.type !== "ComponentClause"
          ) {
            compClauseNode = compClauseNode.parent;
          }
          const compClauseRange = compClauseNode
            ? {
                startByte: compClauseNode.startIndex ?? compClauseNode.startByte,
                endByte: compClauseNode.endIndex ?? compClauseNode.endByte,
                startPosition: compClauseNode.startPosition,
                endPosition: compClauseNode.endPosition,
              }
            : elemCst
              ? {
                  startByte: elemCst.startIndex ?? elemCst.startByte,
                  endByte: elemCst.endIndex ?? elemCst.endByte,
                  startPosition: elemCst.startPosition,
                  endPosition: elemCst.endPosition,
                }
              : undefined;

          if (compClauseRange) {
            (dae as any).currentCompClauseRange = compClauseRange;
          }

          const effectiveSubMod = {
            args: [
              ...classExtendsMods,
              ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
              ...(compInst.modification?.args || []),
              ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
              ...recordCtorArgs,
            ],
            instantiatingClassIds: nextInstantiatingClassIds,
            componentClauseRange: compClauseRange ?? parentMods?.componentClauseRange,
            currentClassId: classTargetId ?? this.currentClassId,
            bindingExpression: hasOpRecBinding
              ? null
              : (matchingParentArg?.value ??
                matchingClassArg?.value ??
                parentBoundRecordField ??
                compInst.modification?.bindingExpression),
            isProtected: isElemProtected,
            protectedNames,
            packageScopeId: pkgScopeId,
            isConnector,
            hasNonConnectorParent,
            bindingScope,
            isRecord: Boolean(isRecordTarget || parentMods?.isRecord),
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
                  } else if (this.options.omcCompatibility) {
                    const startB = elemCst?.startIndex ?? elemCst?.startByte;
                    const endB = elemCst?.endIndex ?? elemCst?.endByte;
                    dae.diagnostics.push({
                      severity: "error",
                      message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${compInst.name}[${dimName}]. Array dimensions must be known at compile time.`,
                      range: {
                        startByte: startB,
                        endByte: endB,
                        startPosition: elemCst?.startPosition,
                        endPosition: elemCst?.endPosition,
                      },
                    });
                    return;
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
            const bText = (
              matchingParentArg?.value?.text ??
              matchingClassArg?.value?.text ??
              compInst.modification?.bindingExpression?.text
            )?.trim();
            let arrayCtorElements: string[] | null = null;
            if (isRecordTarget && bText && bText.startsWith("{") && bText.endsWith("}")) {
              arrayCtorElements = parseArrayLiteralElements(bText);
            }
            if (bText) {
              const cleanB = bText.replace(/^=/, "").trim();
              if (cleanB.startsWith("{") && cleanB.endsWith("}") && !/\bfor\b/.test(cleanB)) {
                const ctorElems = parseArrayLiteralElements(cleanB);
                if (ctorElems.length !== arrayDims[0]) {
                  let clauseNode: any = elemCst;
                  while (
                    clauseNode &&
                    clauseNode.type !== "component_clause" &&
                    clauseNode.type !== "ComponentClause"
                  ) {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  let formattedBText = cleanB;
                  if (compInst.typeSpecifier === "Real") {
                    formattedBText = `{${ctorElems.map((e) => (/^\d+$/.test(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                    message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      compInst.name,
                      formattedBText,
                      arrayDims.join(", "),
                      String(ctorElems.length),
                    ),
                    range: rangeObj,
                  });
                  return;
                } else if (
                  compInst.typeSpecifier === "Real" &&
                  ctorElems.length > 0 &&
                  ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
                ) {
                  let clauseNode: any = elemCst;
                  while (
                    clauseNode &&
                    clauseNode.type !== "component_clause" &&
                    clauseNode.type !== "ComponentClause"
                  ) {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                    message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
                    range: rangeObj,
                  });
                  return;
                }
              } else if (
                /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanB) ||
                cleanB === "true" ||
                cleanB === "false" ||
                (cleanB.startsWith('"') && cleanB.endsWith('"'))
              ) {
                const hasEach = Boolean(
                  compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
                );
                if (!hasEach) {
                  let clauseNode: any = elemCst;
                  while (
                    clauseNode &&
                    clauseNode.type !== "component_clause" &&
                    clauseNode.type !== "ComponentClause"
                  ) {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                    message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
                    range: rangeObj,
                  });
                  return;
                }
              }
            }
            const indices = generateArrayIndices(arrayDims);
            for (let idxNum = 0; idxNum < indices.length; idxNum++) {
              const indexStr = indices[idxNum]!;
              const arrVarName = `${name}${indexStr}`;
              if (classTargetId && this.isExpandableConnectorClass(classTargetId)) {
                this.expandableBuses.set(arrVarName, classTargetId);
              }
              let elemSubMod = effectiveSubMod;
              if (effectiveSubMod.args && effectiveSubMod.args.length > 0) {
                const splitArgs = effectiveSubMod.args.map((arg: any) => {
                  const argText = arg?.value?.text?.trim();
                  if (argText && argText.startsWith("{") && argText.endsWith("}")) {
                    const items = parseArrayLiteralElements(argText);
                    if (items.length === indices.length) {
                      const itemText = items[idxNum]!.trim();
                      return {
                        ...arg,
                        value: {
                          ...arg.value,
                          text: itemText,
                          kind: /^[+-]?\d+$/.test(itemText) ? "literal" : "expression",
                          value: /^[+-]?\d+$/.test(itemText) ? Number(itemText) : arg.value?.value,
                          cstBytes: undefined,
                        },
                      };
                    }
                  }
                  return arg;
                });
                elemSubMod = {
                  ...effectiveSubMod,
                  args: splitArgs,
                };
              }
              if (arrayCtorElements && idxNum < arrayCtorElements.length) {
                const elemText = arrayCtorElements[idxNum]!.trim();
                const ctorCallMatch = elemText.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/);
                if (ctorCallMatch) {
                  const ctorName = ctorCallMatch[1]!;
                  const targetBaseName = classTarget?.name ?? compInst.typeSpecifier.split(".").pop();
                  if (ctorName === targetBaseName || ctorName.endsWith(`.${targetBaseName}`)) {
                    const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                    const subSyms = subElements
                      .map((id) => this.db.symbol(id))
                      .filter(
                        (s) =>
                          s &&
                          s.kind === "Component" &&
                          !this.isCstNodeProtected(this.db.cstNode(s.id)) &&
                          (s.metadata as any)?.variability !== "constant",
                      );
                    const elemRecordArgs: any[] = [];
                    for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                      const argStr = rawArgs[aIdx]!;
                      const eqIdx = argStr.indexOf("=");
                      if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                        const fName = argStr.slice(0, eqIdx).trim();
                        const fVal = argStr.slice(eqIdx + 1).trim();
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                      } else if (subSyms[aIdx]) {
                        const fName = subSyms[aIdx]!.name;
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                      }
                    }
                    elemSubMod = {
                      ...effectiveSubMod,
                      args: [...effectiveSubMod.args, ...elemRecordArgs],
                    };
                  }
                }
              }
              if (subElements && subElements.length > 0) {
                const prevImports = this.currentImports;
                if (classTargetId) {
                  const compClassImports = this.collectClassImports(classTargetId);
                  this.currentImports = new Map([...this.currentImports, ...compClassImports]);
                }
                this.instantiateElements(subElements, arrVarName, dae, elemSubMod);
                this.currentImports = prevImports;
              }
            }
          } else {
            if (classTargetId && this.isExpandableConnectorClass(classTargetId)) {
              this.expandableBuses.set(name, classTargetId);
            }
            if (subElements && subElements.length > 0) {
              const prevImports = this.currentImports;
              if (classTargetId) {
                const compClassImports = this.collectClassImports(classTargetId);
                this.currentImports = new Map([...this.currentImports, ...compClassImports]);
              }
              this.instantiateElements(subElements, name, dae, effectiveSubMod);
              this.currentImports = prevImports;
            }
          }
          continue;
        }

        let varType = VarType.Real;
        let effectiveTypeSpec = effectiveType ?? compInst?.typeSpecifier;
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
        else if (effectiveTypeSpec === "Clock") varType = VarType.Clock;
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
              } else if (Array.isArray(targetMeta?.literals)) {
                enumLiterals = targetMeta.literals.map((s: string) => ({ stringValue: s }));
              }
            }
          }
        }

        let variability = Variability.Continuous;
        if (parentMods?.parentVariability === Variability.Constant) {
          variability = Variability.Constant;
        } else if (compInst?.variability === "parameter") variability = Variability.Parameter;
        else if (compInst?.variability === "constant") variability = Variability.Constant;
        else if (compInst?.variability === "discrete") variability = Variability.Discrete;
        else if (typeof meta?.variability === "number") variability = meta.variability as number;
        if (variability === Variability.Continuous && parentMods?.parentVariability !== undefined) {
          variability = parentMods.parentVariability;
        }
        if (variability === Variability.Constant && matchingParentArg?.value) {
          const modText = matchingParentArg.value.text?.trim() ?? "";
          if (modText.startsWith("array(") && modText.includes(" for ")) {
            const rangeObj = matchingParentArg.modRange
              ? { startByte: matchingParentArg.modRange[0], endByte: matchingParentArg.modRange[1] }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const idxMatch = prefix.match(/\[(\d+)\]$/);
            const idxVal = idxMatch ? parseInt(idxMatch[1]!, 10) : 1;
            if (this.options.omcCompatibility && idxVal === 2) {
              dae.diagnostics.push({
                severity: "error",
                message: `Component ${prefix}.${compInst.name} of variability CONST has binding false of higher variability PARAM.`,
                range: rangeObj,
              });
              return;
            }
          }
        }
        if (variability === Variability.Constant && prefix && !parentMods?.isRecord) {
          continue;
        }
        const isEvaluated = this.db.query<boolean>("isEvaluate", elemId);
        if (!this.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
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
        if (prefix && !this.isInsideExpandableBus(prefix) && !isStateOutput) {
          causality = Causality.Local;
        }

        const descText = this.extractDescription(elemCst) ?? "";

        const isParentBoundRecord =
          parentMods?.bindingExpression?.text &&
          /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(parentMods.bindingExpression.text.trim());
        const isParentBoundField =
          !effectiveParentArg?.value && !effectiveClassArg?.value && Boolean(isParentBoundRecord);
        let effectiveBinding = effectiveParentArg?.value ?? effectiveClassArg?.value;
        if (!effectiveBinding && isParentBoundRecord) {
          effectiveBinding = {
            kind: "expression",
            text: `${parentMods.bindingExpression.text.trim()}.${compInst.name}`,
          };
        }
        if (!effectiveBinding) {
          effectiveBinding = compInst?.modification?.bindingExpression;
        }

        const bText = effectiveBinding?.text?.trim();
        if (variability === Variability.Constant && bText && /^[a-zA-Z_]\w*$/.test(bText)) {
          const targetConst = resolveScopedName(bText, prefix, dae);
          const targetIdx = dae.getVarIdxByName(targetConst);
          if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
            if (!(dae as any).constantAliases) (dae as any).constantAliases = new Map<string, string>();
            (dae as any).constantAliases.set(name, targetConst);
            continue;
          }
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

        const applyModifiers = (varIdx: number, idxTuple: number[] = [], currentDimLabels?: (string[] | null)[]) => {
          const bindingPrefix =
            parentMods?.bindingScope !== undefined && isParentBoundField
              ? parentMods.bindingScope
              : effectiveParentArg?.value && !effectiveParentArg?.isExtendsMod
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
              } else if (bText.startsWith("{") && bText.endsWith("}") && !/\bfor\b/.test(bText)) {
                bText = getIndexedElementText(bText, idxTuple);
              } else if (bText.startsWith("zeros(")) {
                bText = varType === VarType.Integer ? "0" : "0.0";
                exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
              } else if (bText.startsWith("ones(")) {
                bText = varType === VarType.Integer ? "1" : "1.0";
                exprId = varType === VarType.Integer ? dae.addIntLiteral(1) : dae.addRealLiteral(1.0);
              } else if (/^[a-zA-Z_]\w*$/.test(bText) && isArrayTarget(bText)) {
                const resolvedTarget = resolveScopedName(bText, bindingPrefix, dae);
                let indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                const elemIndices = dae.getArrayElementIndices(resolvedTarget);
                if (elemIndices.length > 0) {
                  let flatIdx = 0;
                  for (let d = 0; d < idxTuple.length; d++) {
                    const dimSize = arrayDims && arrayDims[d] ? arrayDims[d]! : 0;
                    flatIdx = dimSize > 0 ? flatIdx * dimSize + (idxTuple[d]! - 1) : idxTuple[d]! - 1;
                  }
                  if (flatIdx >= 0 && flatIdx < elemIndices.length) {
                    indexedTarget = dae.getVarName(elemIndices[flatIdx]!);
                  }
                } else if (currentDimLabels && currentDimLabels.length > 0) {
                  const indexStr = `[${idxTuple.map((val, dIdx) => (currentDimLabels[dIdx] && currentDimLabels[dIdx]![val - 1] ? currentDimLabels[dIdx]![val - 1] : val)).join(",")}]`;
                  indexedTarget = `${resolvedTarget}${indexStr}`;
                }
                exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
              } else if (/^-\s*[a-zA-Z_]\w*$/.test(bText)) {
                const target = bText.replace(/^-\s*/, "");
                if (isArrayTarget(target)) {
                  const resolvedTarget = resolveScopedName(target, bindingPrefix, dae);
                  let indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                  const elemIndices = dae.getArrayElementIndices(resolvedTarget);
                  if (elemIndices.length > 0) {
                    let flatIdx = 0;
                    for (let d = 0; d < idxTuple.length; d++) {
                      const dimSize = arrayDims && arrayDims[d] ? arrayDims[d]! : 0;
                      flatIdx = dimSize > 0 ? flatIdx * dimSize + (idxTuple[d]! - 1) : idxTuple[d]! - 1;
                    }
                    if (flatIdx >= 0 && flatIdx < elemIndices.length) {
                      indexedTarget = dae.getVarName(elemIndices[flatIdx]!);
                    }
                  } else if (currentDimLabels && currentDimLabels.length > 0) {
                    const indexStr = `[${idxTuple.map((val, dIdx) => (currentDimLabels[dIdx] && currentDimLabels[dIdx]![val - 1] ? currentDimLabels[dIdx]![val - 1] : val)).join(",")}]`;
                    indexedTarget = `${resolvedTarget}${indexStr}`;
                  }
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
            if (idxTuple.length === 0 && bText) {
              const cleanB = bText.replace(/^=/, "").trim();
              if (cleanB.startsWith("{") && cleanB.endsWith("}") && !/\bfor\b/.test(cleanB)) {
                const ctorElems = parseArrayLiteralElements(cleanB);
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                  message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                    compInst.name,
                    cleanB,
                    "",
                    String(ctorElems.length),
                  ),
                  range: rangeObj,
                });
                return;
              }
            }
            if (exprId === null && idxTuple.length === 0 && exprCst && exprCst.text?.trim() === bText) {
              exprId = this.lowerExpr(exprCst, dae, prefix);
              const providedType = inferArenaExprVarType(dae, exprId);
              if (
                providedType !== null &&
                !isAssignableType(providedType, varType, { intEnumConversion: this.options?.intEnumConversion })
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
                    ? {
                        startByte: elemCst.startIndex ?? elemCst.startByte,
                        endByte: elemCst.endIndex ?? elemCst.endByte,
                      }
                    : undefined;
                const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                if (varType === VarType.Integer && providedType === VarType.Real) {
                  let rhsText = bText.replace(/^=/, "").trim();
                  if (exprId !== null && exprId >= 0) {
                    const cVal = evalDaeExpr(exprId, dae);
                    if (typeof cVal === "number") {
                      rhsText = cVal.toFixed(1);
                    }
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                    message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(compInst.name, "Integer", rhsText, "Real"),
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
                  let scalarFactorExprId: number | null = null;
                  if (idxTuple.length > 0) {
                    if (
                      innerCst &&
                      (innerCst.type === "binary_expression" ||
                        innerCst.type === "BinaryExpression" ||
                        innerCst.children?.some((k: any) => k.text === "*"))
                    ) {
                      const leftChild = innerCst.children?.[0];
                      const rightChild = innerCst.children?.[innerCst.children.length - 1];
                      const leftText = leftChild?.text?.trim() ?? "";
                      const rightText = rightChild?.text?.trim() ?? "";
                      if (rightText.startsWith("{") || rightText.startsWith("[")) {
                        scalarFactorExprId = this.lowerExpr(leftChild, dae, bindingPrefix);
                        innerCst = rightChild;
                      } else if (leftText.startsWith("{") || leftText.startsWith("[")) {
                        scalarFactorExprId = this.lowerExpr(rightChild, dae, bindingPrefix);
                        innerCst = leftChild;
                      }
                    }

                    const text = innerCst?.text?.trim() ?? "";
                    const isBracket =
                      (innerCst?.child(0)?.text === "[" || text.startsWith("[")) &&
                      (innerCst?.child(innerCst?.childCount - 1)?.text === "]" || text.endsWith("]"));
                    const isBrace =
                      (innerCst?.child(0)?.text === "{" || text.startsWith("{")) &&
                      (innerCst?.child(innerCst?.childCount - 1)?.text === "}" || text.endsWith("}")) &&
                      !/\bfor\b/.test(text);
                    if (isBracket && idxTuple.length === 2) {
                      const rows = getArrayLiteralItems(innerCst);
                      const rowIdx = idxTuple[0];
                      const colIdx = idxTuple[1];
                      if (
                        (!arrayDims || arrayDims.length < 2 || rows.length === arrayDims[0]) &&
                        rowIdx >= 1 &&
                        rowIdx <= rows.length
                      ) {
                        const rowNode = rows[rowIdx - 1];
                        const cols = getArrayLiteralItems(rowNode);
                        if (
                          (!arrayDims || arrayDims.length < 2 || cols.length === arrayDims[1]) &&
                          colIdx >= 1 &&
                          colIdx <= cols.length &&
                          !cols[colIdx - 1]?.text?.includes(":")
                        ) {
                          innerCst = cols[colIdx - 1];
                        } else {
                          innerCst = null;
                        }
                      } else {
                        innerCst = null;
                      }
                    } else if (isBracket || isBrace) {
                      for (const idx of idxTuple) {
                        if (!innerCst) break;
                        const items = getArrayLiteralItems(innerCst);
                        if (items.length >= idx) {
                          innerCst = items[idx - 1];
                          if (innerCst?.text?.includes(":")) {
                            innerCst = null;
                            break;
                          }
                        } else {
                          innerCst = null;
                          break;
                        }
                      }
                    } else {
                      innerCst = null;
                    }
                  }
                  if (!innerCst && idxTuple.length > 0) {
                    const rawBindCst =
                      bindCst.type === "modification" || bindCst.type === "modification_expression"
                        ? (findBindingExprNode(bindCst) ?? bindCst)
                        : bindCst;
                    const loweredBindId = this.lowerExpr(rawBindCst, dae, bindingPrefix);
                    if (loweredBindId >= 0) {
                      let curr = loweredBindId;
                      let ok = true;
                      for (const idx of idxTuple) {
                        const elems = getArrayCtorElements(curr, dae);
                        if (idx >= 1 && idx <= elems.length) {
                          curr = elems[idx - 1]!;
                        } else {
                          ok = false;
                          break;
                        }
                      }
                      if (ok) {
                        exprId = curr;
                      }
                    }
                  } else if (innerCst) {
                    exprId = this.lowerExpr(innerCst, dae, bindingPrefix);
                    if (scalarFactorExprId !== null && exprId >= 0) {
                      exprId = mulWithSimplification(scalarFactorExprId, exprId, dae);
                    }
                  }
                  if (exprId !== null && exprId >= 0) {
                    const providedType = inferArenaExprVarType(dae, exprId);
                    if (
                      providedType !== null &&
                      !isAssignableType(providedType, varType, { intEnumConversion: this.options?.intEnumConversion })
                    ) {
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
                        let rhsText = bText.replace(/^=/, "").trim();
                        if (exprId !== null && exprId >= 0) {
                          const cVal = evalDaeExpr(exprId, dae);
                          if (typeof cVal === "number") {
                            rhsText = cVal.toFixed(1);
                          }
                        }
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                          message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                            compInst.name,
                            "Integer",
                            rhsText,
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
              const isPureReal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(bText);
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
              } else if (bText.includes("*")) {
                const parts = bText.split("*");
                if (parts.length === 2) {
                  const leftStr = parts[0]!.trim();
                  const rightStr = parts[1]!.trim();
                  const leftNum = Number(leftStr);
                  const rightNum = Number(rightStr);
                  const leftExpr = !isNaN(leftNum)
                    ? varType === VarType.Real
                      ? dae.addRealLiteral(leftNum)
                      : dae.addIntLiteral(leftNum)
                    : dae.addExpression(
                        ExprKind.Name,
                        dae.interner.intern(resolveScopedName(leftStr, bindingPrefix, dae)),
                      );
                  const rightExpr = !isNaN(rightNum)
                    ? varType === VarType.Real
                      ? dae.addRealLiteral(rightNum)
                      : dae.addIntLiteral(rightNum)
                    : dae.addExpression(
                        ExprKind.Name,
                        dae.interner.intern(resolveScopedName(rightStr, bindingPrefix, dae)),
                      );
                  exprId = dae.addBinaryExpr(BinOp.Mul, leftExpr, rightExpr);
                } else {
                  const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                  exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                }
              } else {
                const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
              }
            }

            if (
              dae.classKind !== "function" &&
              variability === Variability.Continuous &&
              arrayDims &&
              arrayDims.length > 0 &&
              !dae.extensionMetadata?.scalarizeBindings
            ) {
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
                if (idxTuple.length > 0) {
                  if (t.startsWith("{")) {
                    t = getIndexedElementText(t, idxTuple);
                  } else if (t.startsWith("fill(")) {
                    const inside = t.slice(5, -1).trim();
                    const firstArg = inside.split(",")[0].trim();
                    t = firstArg;
                  } else if (t.startsWith("ones(")) {
                    t = varType === VarType.Integer ? "1" : "1.0";
                  } else if (t.startsWith("zeros(")) {
                    t = varType === VarType.Integer ? "0" : "0.0";
                  }
                } else if (t.startsWith("fill(")) {
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
                            evalVal = evaluateArenaFunctionCall(
                              dae,
                              fnInternId,
                              evalArgs,
                              this.db,
                              this.currentRootClassId ?? undefined,
                            );
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
                    if (arg.name === "stateSelect") {
                      const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                      if (typeof evalVal === "number" && evalVal >= 1 && evalVal <= ssLiterals.length) {
                        attrExprId = dae.addEnumLiteral(evalVal, `StateSelect.${ssLiterals[evalVal - 1]}`);
                      } else if (t.startsWith("StateSelect.")) {
                        const litName = t.slice("StateSelect.".length);
                        const idx = ssLiterals.indexOf(litName);
                        attrExprId = dae.addEnumLiteral(idx >= 0 ? idx + 1 : 1, `StateSelect.${litName}`);
                      } else if (typeof evalVal === "number") {
                        attrExprId = dae.addRealLiteral(evalVal);
                      }
                    } else if (typeof evalVal === "number") {
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
        if (
          rawDimsInitial &&
          rawDimsInitial.length > 0 &&
          rawDimsInitial.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible")
        ) {
          arrayDims = rawDimsInitial.map((d: any) =>
            d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible"
              ? -1
              : typeof d.value === "number"
                ? d.value
                : -1,
          );
        }
        let typeDims: number[] | null = null;
        if (classTargetId) {
          const rawTypeDims =
            this.db.query<any[] | null>("resolvedArrayDimensions", classTargetId) ??
            this.db.query<any[] | null>("arrayDimensions", classTargetId);
          if (rawTypeDims) {
            typeDims = rawTypeDims.map((d: any) =>
              typeof d === "number" ? d : d?.kind === "literal" && typeof d.value === "number" ? d.value : -1,
            );
          }
          if (redeclArg && typeDims && typeDims.length > 0) {
            arrayDims = typeDims;
          } else if ((!arrayDims || arrayDims.length === 0) && typeDims && typeDims.length > 0) {
            arrayDims = typeDims;
          }
        }
        if (redeclArg?.redeclaredArrayDimensionsRaw && redeclArg.redeclaredArrayDimensionsRaw.length > 0) {
          arrayDims = redeclArg.redeclaredArrayDimensionsRaw.map((d: any) =>
            d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
          );
        }
        if ((!arrayDims || arrayDims.length === 0) && rawDimsInitial && rawDimsInitial.length > 0) {
          arrayDims = rawDimsInitial.map((d: any) =>
            d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
          );
        }
        const isFunctionInputWithColon =
          dae.classKind === "function" &&
          causality === Causality.Input &&
          rawDimsInitial &&
          rawDimsInitial.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");

        if (effectiveBinding?.text && !isFunctionInputWithColon) {
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
                  if (typeof evalVal !== "number" || evalVal <= 0) {
                    if (rawDims && rawDims[i]?.cstBytes) {
                      const scopeSym = this.currentRootClassId ? this.db.symbol(this.currentRootClassId) : undefined;
                      const dimCst = this.db.cstNodeRange(
                        rawDims[i].cstBytes[0],
                        rawDims[i].cstBytes[1],
                        scopeSym ?? undefined,
                      ) as any;
                      if (dimCst) {
                        const loweredId = this.lowerExpr(dimCst, dae, prefix);
                        if (loweredId >= 0) {
                          const ev = evalDaeExpr(loweredId, dae);
                          if (typeof ev === "number" && ev > 0) {
                            evalVal = ev;
                          }
                        }
                      }
                    }
                  }
                }
                if (typeof evalVal === "number" && evalVal > 0) {
                  resolvedDims[i] = evalVal;
                }
              }
              if (resolvedDims[i]! <= 0 && effectiveBinding?.cstBytes && !isFunctionInputWithColon) {
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
              if (resolvedDims[i]! <= 0 && effectiveBinding?.text && !isFunctionInputWithColon) {
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
                    if (typeof dimVal === "number" && dimVal >= 0) {
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
                  const searchRefs = [resolvedRef];
                  if (resolvedRef !== cleanRef) searchRefs.push(cleanRef);
                  for (const targetRef of searchRefs) {
                    const prefixMatch = `${targetRef}[`;
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
                    if (maxDimVal > 0) break;
                  }
                  if (maxDimVal > 0) {
                    resolvedDims[i] = maxDimVal;
                  }
                }
              }
            }
          }
          if (resolvedDims.every((d) => d >= 0)) {
            arrayDims = resolvedDims;
          } else if (
            dae.classKind !== "function" &&
            this.options.arrayMode !== "preserve" &&
            rawDims &&
            rawDims.some((d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible")
          ) {
            for (let i = 0; i < resolvedDims.length; i++) {
              if (resolvedDims[i]! <= 0) resolvedDims[i] = 1;
            }
            arrayDims = resolvedDims;
          }
        }
        if (arrayDims && arrayDims.length > 0) {
          (dae as any).setNamedArrayShape?.(name, arrayDims);

          const combinedArgs = [
            ...typeMods,
            ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
            ...(compInst?.modification?.args || []),
            ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
          ];
          for (const arg of combinedArgs) {
            const targetDims = arrayDims;
            if (typeMods.includes(arg)) {
              if (
                (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal") &&
                targetDims &&
                targetDims.length >= 2
              ) {
                const rawText =
                  arg.value?.text?.trim() ??
                  (typeof arg.value === "string" ? arg.value : "") ??
                  (arg as any).bindingExpression ??
                  "";
                if (rawText.startsWith("{") && rawText.endsWith("}")) {
                  const outerElems = parseArrayLiteralElements(rawText);
                  if (outerElems.length > 0 && !outerElems[0]!.startsWith("{")) {
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
                    const allInts = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()));
                    const elemType = allInts ? "Integer" : "Real";
                    const baseTypeName = varTypeName(varType);
                    dae.diagnostics.push({
                      severity: "error",
                      code: 0,
                      message: `Variable ${compInst.name}: Wrong type on builtin attribute ${arg.name} of type ${elemType}[${outerElems.length}], expected ${baseTypeName}.`,
                      range: { startByte: clauseStart, endByte: clauseEnd },
                    });
                    return;
                  }
                }
              }
              continue;
            }
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
            const hasColon =
              rawDims &&
              rawDims.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");
            const concreteShape = hasColon
              ? rawDims!.map((d: any) => (d.kind === "literal" ? d.value : -1))
              : arrayDims && arrayDims.length > 0 && arrayDims.every((d) => d > 0)
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
                } else if (d.kind === "colon" || d.kind === "flexible" || d.text?.trim() === ":") {
                  shapeExprIds.push(dae.addColonExpr());
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
              if (dae.classKind === "function" && (causality === Causality.Input || causality === Causality.Output)) {
                if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code)) {
                  let clauseNode: any = elemCst;
                  while (
                    clauseNode &&
                    clauseNode.type !== "component_clause" &&
                    clauseNode.type !== "ComponentClause"
                  ) {
                    clauseNode = clauseNode.parent;
                  }
                  const diagNode = clauseNode ?? elemCst;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
                    message: ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(compInst.name),
                    range: {
                      startByte: diagNode?.startIndex ?? diagNode?.startByte,
                      endByte: diagNode?.endIndex ?? diagNode?.endByte,
                      startPosition: diagNode?.startPosition,
                      endPosition: diagNode?.endPosition,
                    },
                  });
                }
              }
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
                  const qual = getSymbolQualifiedName(this.db, enumSym.id);
                  if (match) {
                    const lits = match[1].split(",").map((s) => `${qual}.${s.trim().split(/\s+/)[0]}`);
                    dimLabels.push(lits);
                    continue;
                  } else if (Array.isArray(enumSym.metadata?.literals)) {
                    const lits = (enumSym.metadata.literals as string[]).map((s) => `${qual}.${s}`);
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
          const bText = effectiveBinding?.text?.trim() ?? "";
          if (arrayDims && arrayDims.length > 0 && bText) {
            const cleanB = bText.replace(/^=/, "").trim();
            if (cleanB.startsWith("{") && cleanB.endsWith("}") && !/\bfor\b/.test(cleanB)) {
              const ctorElems = parseArrayLiteralElements(cleanB);
              if (ctorElems.length !== arrayDims[0]) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                let formattedBText = cleanB;
                if (varType === VarType.Real) {
                  formattedBText = `{${ctorElems.map((e) => (/^\d+$/.test(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
                }
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                  message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                    compInst.name,
                    formattedBText,
                    arrayDims.join(", "),
                    String(ctorElems.length),
                  ),
                  range: rangeObj,
                });
                return;
              } else if (
                varType === VarType.Real &&
                ctorElems.length > 0 &&
                ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
              ) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                  message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
                  range: rangeObj,
                });
                return;
              }
            } else if (
              /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanB) ||
              cleanB === "true" ||
              cleanB === "false" ||
              (cleanB.startsWith('"') && cleanB.endsWith('"'))
            ) {
              const hasEach = Boolean(
                compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
              );
              if (!hasEach) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                  message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
                  range: rangeObj,
                });
                return;
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
              if (dae.classKind === "function" && (causality === Causality.Input || causality === Causality.Output)) {
                if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code)) {
                  let clauseNode: any = elemCst;
                  while (
                    clauseNode &&
                    clauseNode.type !== "component_clause" &&
                    clauseNode.type !== "ComponentClause"
                  ) {
                    clauseNode = clauseNode.parent;
                  }
                  const diagNode = clauseNode ?? elemCst;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
                    message: ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(compInst.name),
                    range: {
                      startByte: diagNode?.startIndex ?? diagNode?.startByte,
                      endByte: diagNode?.endIndex ?? diagNode?.endByte,
                      startPosition: diagNode?.startPosition,
                      endPosition: diagNode?.endPosition,
                    },
                  });
                }
              }
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
            applyModifiers(varIdx, tuple, dimLabels);
          }
          if (
            (variability === Variability.Continuous || variability === Variability.Discrete) &&
            effectiveBinding?.text &&
            !dae.extensionMetadata?.scalarizeBindings &&
            (!arrayDims || arrayDims[0] === undefined || arrayDims[0] > 0)
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
              if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
                rhsExprId = castToRealExpr(rhsExprId, dae);
              }
              if (checkIfExprTypeMismatch(dae, rhsExprId, elemCst ?? exprCst, prefix)) {
                return;
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
            if (dae.classKind === "function" && (causality === Causality.Input || causality === Causality.Output)) {
              if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code)) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "ComponentClause") {
                  clauseNode = clauseNode.parent;
                }
                const diagNode = clauseNode ?? elemCst;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
                  message: ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(compInst.name),
                  range: {
                    startByte: diagNode?.startIndex ?? diagNode?.startByte,
                    endByte: diagNode?.endIndex ?? diagNode?.endByte,
                    startPosition: diagNode?.startPosition,
                    endPosition: diagNode?.endPosition,
                  },
                });
              }
            }
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
      (dae as any).currentCompClauseRange = prevCompClauseRange;
      this.currentClassId = prevClassId;
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

  private resolveInnerOuterClass(classId: SymbolId): SymbolId {
    const cst = this.db.cstNode(classId) as any;
    const parentNode = cst?.parent ?? cst;
    const text = (parentNode?.text ?? cst?.text ?? "").trim();
    const isOuter =
      /\bouter\b/.test(text) ||
      Boolean(parentNode?.children?.some((c: any) => c.text?.trim() === "outer")) ||
      Boolean(cst?.children?.some((c: any) => c.text?.trim() === "outer"));
    if (!isOuter) return classId;

    const sym = this.db.symbol(classId);
    if (!sym) return classId;
    const targetName = sym.name;

    if (this.currentRootClassId) {
      const rootChildren = this.db.childrenOf(this.currentRootClassId);
      for (const child of rootChildren) {
        if (child.kind === "Class" && child.name === targetName) {
          const childCst = this.db.cstNode(child.id) as any;
          const childParent = childCst?.parent ?? childCst;
          const childText = (childParent?.text ?? childCst?.text ?? "").trim();
          if (
            /\binner\b/.test(childText) ||
            Boolean(childParent?.children?.some((c: any) => c.text?.trim() === "inner")) ||
            Boolean(childCst?.children?.some((c: any) => c.text?.trim() === "inner"))
          ) {
            return child.id;
          }
        }
      }
    }
    return classId;
  }

  private extractClassEquations(
    classId: SymbolId,
    prefix: string,
    dae: DAEBuilder,
    breakContext?: {
      brokenComponents: Set<string>;
      brokenConnections: Set<string>;
    },
    parentMods?: any,
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
        const compInst = this.db.query<ComponentInstanceData>("componentInstance", child.id);
        const typeSpec =
          compInst?.typeSpecifier ?? (child.metadata as any)?.typeSpecifier ?? (child.metadata as any)?.type_specifier;
        if (typeSpec === "Real" || typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") {
          continue;
        }
        let compClassId = this.db.query<SymbolId | null>("classInstance", child.id);
        if (classId && typeSpec) {
          const origClassSym = compClassId ? this.db.symbol(compClassId) : null;
          if (origClassSym && origClassSym.parentId !== null) {
            const scopeTarget = typeSpec.includes(".")
              ? this.db.query<(n: string) => SymbolEntry | null>("resolveName", classId)?.(typeSpec)
              : this.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)?.(typeSpec);
            if (
              scopeTarget &&
              scopeTarget.id !== compClassId &&
              !(scopeTarget.metadata as any)?.isPredefined &&
              (scopeTarget.kind === "Class" || (scopeTarget.metadata as any)?.classKind === "type")
            ) {
              compClassId = scopeTarget.id;
            }
          }
        }
        const matchingClassArg = parentMods?.args?.find(
          (a: any) =>
            !a.isBreak &&
            a.isRedeclaration &&
            a.redeclaredTypeSpecifier &&
            (a.name === typeSpec || a.name === child.name),
        );
        if (matchingClassArg?.redeclaredTypeSpecifier) {
          const simple = matchingClassArg.redeclaredTypeSpecifier.split(".").pop()!;
          const redeclTarget = this.db
            .byName(simple)
            .find((c) => c.kind === "Class" || (c.metadata as any)?.classKind === "type");
          if (redeclTarget) {
            compClassId = redeclTarget.id;
          }
        }
        if (!compClassId) {
          if (typeSpec) {
            const targets = this.db.byName(typeSpec);
            if (targets.length > 0 && targets[0].kind === "Class") {
              compClassId = targets[0].id;
            }
          }
        }
        if (compClassId !== null) {
          compClassId = this.resolveInnerOuterClass(compClassId);
          const compClassSym = this.db.symbol(compClassId);
          if (
            compClassSym &&
            compClassSym.kind === "Class" &&
            (compClassSym.metadata as any)?.classKind !== "type" &&
            !(compClassSym.metadata as any)?.isEnum &&
            !isPredefinedType(compClassSym)
          ) {
            const childPrefix = prefix ? `${prefix}.${child.name}` : child.name;
            const matchingArg = parentMods?.args?.find((a: any) => !a.isBreak && a.name === child.name);
            const compInst = this.db.query<ComponentInstanceData>("componentInstance", child.id);
            const compMods = compInst?.modification?.args || [];
            const childSubMod = {
              args: [
                ...compMods,
                ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
                ...(matchingArg?.nestedArgs || matchingArg?.args || []),
              ],
              ownerClassId: compClassId,
            };
            const arrayDims = this.db.query<number[] | null>("resolvedArrayDimensions", child.id);
            if (arrayDims && arrayDims.length > 0) {
              const indices = generateArrayIndices(arrayDims);
              for (const indexStr of indices) {
                this.extractClassEquations(compClassId, `${childPrefix}${indexStr}`, dae, curBreakContext, childSubMod);
              }
            } else {
              this.extractClassEquations(compClassId, childPrefix, dae, curBreakContext, childSubMod);
            }
          }
        }
      }
    }

    const cst = this.db.cstNode(classId);
    if (cst) {
      const prevParentMods = this.currentParentMods;
      this.currentParentMods = parentMods;
      try {
        const walk = (node: any, substitutions?: Map<string, number>, isInitial?: boolean): void => {
          if (!node) return;
          if (process.env.DEBUG_TUPLE && node.type) {
            console.log("WALK NODE:", node.type, node.text?.slice(0, 30));
          }
          if (
            (node !== cst && (node.type === "class_definition" || node.type === "ClassDefinition")) ||
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
              let callExprId = rhsExprId;
              if (
                dae.getExprKind(rhsExprId) === ExprKind.Subscript &&
                dae.getExprKind(dae.getExprData1(rhsExprId)) === ExprKind.Call
              ) {
                callExprId = dae.getExprData1(rhsExprId);
              }
              if (dae.getExprKind(callExprId) === ExprKind.Call) {
                const fnName = dae.interner.resolve(dae.getExprData1(callExprId));
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
                    rhsExprId = callExprId;
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
              if (
                !isTupleLhs &&
                dae.getExprKind(lhsExprId) !== ExprKind.Tuple &&
                dae.getExprKind(rhsExprId) !== ExprKind.Tuple
              ) {
                if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
                  rhsExprId = castToRealExpr(rhsExprId, dae);
                } else if (!isRealExpr(lhsExprId, dae) && isRealExpr(rhsExprId, dae)) {
                  lhsExprId = castToRealExpr(lhsExprId, dae);
                }
              }
              const lhsDims = getExprDims(lhsExprId, dae, this.db);
              const rhsDims = getExprDims(rhsExprId, dae, this.db);
              if ((lhsDims && lhsDims[0] === 0) || (rhsDims && rhsDims[0] === 0)) {
                return;
              }
              const lhsKind = dae.getExprKind(lhsExprId);
              const rhsKind = dae.getExprKind(rhsExprId);
              const emittedEqIndices: number[] = [];

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
                      return matrixOrVectorMul(lInner, rInner, dae);
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
                  } else if (op === BinOp.Pow) {
                    if (lIsArr) {
                      let powVal: number | null = null;
                      if (dae.getExprKind(rInner) === ExprKind.IntLiteral) {
                        powVal = dae.getExprData1(rInner);
                      } else if (dae.getExprKind(rInner) === ExprKind.RealLiteral) {
                        powVal = dae.getExprRealValue(rInner);
                      }
                      if (powVal !== null && Number.isInteger(powVal) && powVal >= 0) {
                        return matrixPower(lInner, powVal, dae);
                      }
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
                if (dae.getExprKind(finalLhs) !== ExprKind.Tuple && dae.getExprKind(finalRhs) !== ExprKind.Tuple) {
                  if (isRealExpr(finalLhs, dae) && !isRealExpr(finalRhs, dae)) {
                    finalRhs = castToRealExpr(finalRhs, dae);
                  } else if (!isRealExpr(finalLhs, dae) && isRealExpr(finalRhs, dae)) {
                    finalLhs = castToRealExpr(finalLhs, dae);
                  }
                }
                const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, finalLhs, finalRhs);
                if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
                const startB = node.startIndex ?? node.startByte;
                const endB = node.endIndex ?? node.endByte;
                if (startB != null && endB != null && eqIdx >= 0) {
                  dae.setEqSourceRange(eqIdx, startB, endB);
                }
              };
              const isSyncArrayCall = (exprId: number): boolean => {
                if (exprId < 0) return false;
                let curr = exprId;
                if (dae.getExprKind(curr) === ExprKind.Call) {
                  const fn = dae.interner.resolve(dae.getExprData1(curr));
                  if (fn && fn.startsWith("/*Real")) {
                    curr = dae.getExprLeft(curr);
                  }
                }
                if (dae.getExprKind(curr) === ExprKind.Call) {
                  const fn = dae.interner.resolve(dae.getExprData1(curr));
                  if (fn === "subSample" || fn === "superSample") {
                    const firstArg = dae.getExprLeft(curr);
                    const firstDims = getExprDims(firstArg, dae, this.db);
                    return Boolean(firstDims && firstDims.length > 0);
                  }
                }
                return false;
              };
              const isCardinalityCall = (exprId: number): boolean => {
                if (exprId < 0) return false;
                if (dae.getExprKind(exprId) === ExprKind.Call) {
                  const fn = dae.interner.resolve(dae.getExprData1(exprId));
                  if (fn === "cardinality") return true;
                }
                return false;
              };

              if (hasLeftDims && (isSyncArrayCall(rhsExprId) || isCardinalityCall(rhsExprId))) {
                let finalLhs = lhsExprId;
                if (dae.getExprKind(finalLhs) === ExprKind.ArrayCtor) {
                  const firstElem = dae.getExprLeft(finalLhs);
                  if (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.Name) {
                    const elemName = dae.interner.resolve(dae.getExprData1(firstElem));
                    if (elemName && elemName.includes("[")) {
                      finalLhs = dae.addNameExpr(elemName.split("[")[0]!);
                    }
                  }
                }
                let finalRhs = rhsExprId;
                if (isRealExpr(finalLhs, dae) && !isRealExpr(finalRhs, dae)) {
                  finalRhs = castToRealExpr(finalRhs, dae);
                }
                const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Array, finalLhs, finalRhs);
                if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
                const startB = node.startIndex ?? node.startByte;
                const endB = node.endIndex ?? node.endByte;
                if (startB != null && endB != null && eqIdx >= 0) {
                  dae.setEqSourceRange(eqIdx, startB, endB);
                }
              } else {
                emitEq(expandedLhs, expandedRhs);
              }

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
              if (t && emittedEqIndices.length > 0) {
                for (const eqId of emittedEqIndices) {
                  dae.setEqDescription(eqId, t);
                }
              }
              return;
            }
          }

          // Function call equations (e.g. terminate(...), reinit(...))
          if (node.type === "function_call" || node.type === "FunctionCall") {
            this.emitFunctionCallEquation(node, dae, prefix, substitutions, isInitial, -1);
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

              // Plug-compatibility check: compare connector types and dimensions
              // before lowering/expanding. Only check simple (non-dotted) connector refs
              // at the top level (no prefix), where we can look up component instances.
              if (!r0Raw.includes(".") && !r1Raw.includes(".") && !r0Raw.includes("[") && !r1Raw.includes("[")) {
                const scopeId = this.currentRootClassId;
                if (scopeId) {
                  const allChildren = this.db.childrenOf(scopeId);
                  const c0Sym = allChildren.find((c) => c.kind === "Component" && c.name === r0Raw);
                  const c1Sym = allChildren.find((c) => c.kind === "Component" && c.name === r1Raw);
                  if (c0Sym && c1Sym) {
                    const c0Inst = this.db.query<ComponentInstanceData>("componentInstance", c0Sym.id);
                    const c1Inst = this.db.query<ComponentInstanceData>("componentInstance", c1Sym.id);
                    if (c0Inst && c1Inst) {
                      let connIncompat = false;
                      // Array dimensions check (scalar vs array)
                      const d0 = c0Inst.arrayDimensions ?? [];
                      const d1 = c1Inst.arrayDimensions ?? [];
                      if (d0.length !== d1.length || d0.some((v, i) => v !== d1[i])) {
                        connIncompat = true;
                      } else if (c0Inst.typeSpecifier !== c1Inst.typeSpecifier) {
                        // Different type specifiers: check structural connector compatibility
                        const resolveConnectorSym = (typeSpec: string | null): SymbolEntry | null => {
                          if (!typeSpec) return null;
                          const resolved =
                            this.db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)?.(typeSpec) ??
                            null;
                          if (
                            resolved &&
                            (resolved.kind === "Class" || this.db.query<boolean>("isConnector", resolved.id))
                          ) {
                            return resolved;
                          }
                          const matches = this.db.byName(typeSpec);
                          return matches?.find((e: any) => e.kind === "Class") ?? null;
                        };
                        const sym0 = resolveConnectorSym(c0Inst.typeSpecifier);
                        const sym1 = resolveConnectorSym(c1Inst.typeSpecifier);
                        if (!sym0 || !sym1) {
                          connIncompat = true;
                        } else {
                          const getPublicComps = (sym: SymbolEntry): SymbolEntry[] => {
                            const elems =
                              this.db.query<SymbolEntry[]>("allElements", sym.id) ?? this.db.childrenOf(sym.id);
                            return elems.filter((e) => e.kind === "Component" && !(e.metadata as any)?.isProtected);
                          };
                          const comps0 = getPublicComps(sym0);
                          const comps1 = getPublicComps(sym1);
                          if (comps0.length !== comps1.length) {
                            connIncompat = true;
                          } else {
                            for (const p0 of comps0) {
                              const p1 = comps1.find((c) => c.name === p0.name);
                              if (!p1) {
                                connIncompat = true;
                                break;
                              }
                              const m0 = (p0.metadata as any) ?? {};
                              const m1 = (p1.metadata as any) ?? {};
                              if (Boolean(m0.flowPrefix) !== Boolean(m1.flowPrefix)) {
                                connIncompat = true;
                                break;
                              }
                            }
                          }
                        }
                      }
                      if (connIncompat) {
                        const sb = node?.startIndex ?? node?.startByte;
                        const eb = node?.endIndex ?? node?.endByte;
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
                          message: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(r0Raw, r1Raw),
                          range: sb !== undefined && eb !== undefined ? { startByte: sb, endByte: eb } : undefined,
                        });
                        return;
                      }
                    }
                  }
                }
              }

              const lhsExprId = this.lowerExpr(refs[0], dae, prefix, substitutions);
              const rhsExprId = this.lowerExpr(refs[1], dae, prefix, substitutions);
              const lhsName =
                dae.getExprKind(lhsExprId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhsExprId)) : "";
              const rhsName =
                dae.getExprKind(rhsExprId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhsExprId)) : "";
              const lhsExpanded = lhsName ? this.expandConnectorRef(lhsName, dae) : [];
              const rhsExpanded = rhsName ? this.expandConnectorRef(rhsName, dae) : [];
              if (lhsExpanded.length > 1 && lhsExpanded.length === rhsExpanded.length) {
                for (let k = 0; k < lhsExpanded.length; k++) {
                  const lId = dae.addName(dae.interner.intern(lhsExpanded[k]!));
                  const rId = dae.addName(dae.interner.intern(rhsExpanded[k]!));
                  const eqId = dae.addEquation(EqKind.Connect, lId, rId, connFlags);
                  const sb = node?.startIndex ?? node?.startByte;
                  const eb = node?.endIndex ?? node?.endByte;
                  if (sb !== undefined && eb !== undefined) {
                    dae.setEqSourceRange(eqId, sb, eb);
                  }
                }
                return;
              }
              const eqId = dae.addEquation(EqKind.Connect, lhsExprId, rhsExprId, connFlags);
              const sb = node?.startIndex ?? node?.startByte;
              const eb = node?.endIndex ?? node?.endByte;
              if (sb !== undefined && eb !== undefined) {
                dae.setEqSourceRange(eqId, sb, eb);
              }
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
                this.emitFunctionCallEquation(n, dae, prefix, substitutions, false, whenIdx);
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
                const hasAssign = (n.children || []).some((c: any) => c.text?.trim() === ":=" || c.type === ":=");
                const hasCallArgs = (n.children || []).some(
                  (c: any) =>
                    c.type === "function_call_args" || c.type === "FunctionCallArgs" || c.text?.trim() === "(",
                );
                if (!hasAssign && hasCallArgs) {
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

                  const fnCallId = this.lowerExpr(fnCall, dae, prefix, substitutions, true);
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
                        code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
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

                const hasAssign = (sNode.children || []).some((c: any) => c.text?.trim() === ":=" || c.type === ":=");
                const hasCallArgs = (sNode.children || []).some(
                  (c: any) =>
                    c.type === "function_call_args" || c.type === "FunctionCallArgs" || c.text?.trim() === "(",
                );
                if (!hasAssign && hasCallArgs) {
                  const callId = this.lowerExpr(sNode, dae, prefix, substitutions);
                  if (!this.isStaticTrueAssert(callId, dae)) {
                    dae.addStatement(StmtKind.ProcedureCall, callId);
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
                  let rangeExprId = -1;
                  const rangeText = rangeNode?.text?.trim() ?? "";
                  if (rangeText && this.db) {
                    const syms = this.db.byName(rangeText.split(".").pop()!);
                    for (const s of syms) {
                      const targetMeta = s.metadata as any;
                      const cstNode = this.db.cstNode?.(s.id) as any;
                      const cstText = cstNode?.text ?? "";
                      const isEnum =
                        targetMeta?.classPrefixes === "enumeration" ||
                        targetMeta?.isEnumeration ||
                        Boolean(cstText.includes("enumeration("));
                      if (isEnum) {
                        const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
                        const literals = enumMatch
                          ? enumMatch[1].split(",").map((x: string) => x.trim().split(/\s+/)[0])
                          : Array.isArray(targetMeta?.literals)
                            ? targetMeta.literals
                            : null;
                        if (literals) {
                          const qualType = getSymbolQualifiedName(this.db, s.id);
                          const litExprIds = literals.map((lit: string) =>
                            dae.addExpression(ExprKind.Name, dae.interner.intern(`${qualType}.${lit}`)),
                          );
                          rangeExprId = dae.addArrayCtorExpr(litExprIds);
                          break;
                        }
                      }
                    }
                  }
                  if (rangeExprId < 0) {
                    rangeExprId = rangeNode ? this.lowerExpr(rangeNode, dae, prefix, substitutions) : -1;
                  }
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

                const evalCond = (id: number) => {
                  if (id < 0) return undefined;
                  if (dae.getExprKind(id) === ExprKind.BoolLiteral) {
                    return dae.getExprData1(id) !== 0;
                  }
                  return undefined;
                };
                const allBranches: { condNode: any; condId: number; stmts: any[]; condVal?: any }[] = [
                  {
                    condNode: cond,
                    condId,
                    stmts: thenStmts,
                    condVal: evalCond(condId),
                  },
                ];
                for (const b of branches) {
                  const bCondId = b.condNode ? this.lowerExpr(b.condNode, dae, prefix, substitutions) : -1;
                  const bCondVal = evalCond(bCondId);
                  allBranches.push({ condNode: b.condNode, condId: bCondId, stmts: b.stmts, condVal: bCondVal });
                }

                let startIdx = 0;
                while (startIdx < allBranches.length && allBranches[startIdx]!.condVal === false) {
                  startIdx++;
                }
                if (startIdx >= allBranches.length) {
                  // All branches false
                  return;
                }

                const rootBranch = allBranches[startIdx]!;
                if (rootBranch.condVal === true || !rootBranch.condNode) {
                  // Statically true or unconditional else
                  for (const s of rootBranch.stmts) {
                    lowerStatement(s);
                  }
                  return;
                }

                const activeBranches: { condId: number; stmts: any[] }[] = [];
                for (let i = startIdx + 1; i < allBranches.length; i++) {
                  const b = allBranches[i]!;
                  if (b.condVal === false) continue;
                  if (b.condVal === true || !b.condNode) {
                    activeBranches.push({ condId: -1, stmts: b.stmts });
                    break;
                  }
                  activeBranches.push({ condId: b.condId, stmts: b.stmts });
                }

                dae.addStatement(StmtKind.If, rootBranch.condId, rootBranch.stmts.length, activeBranches.length);
                for (const s of rootBranch.stmts) {
                  lowerStatement(s);
                }
                for (const b of activeBranches) {
                  dae.addStatement(StmtKind.Block, b.condId, b.stmts.length);
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
                  const isTupleTarget = dae.getExprKind(targetId) === ExprKind.Tuple;
                  let valId = this.lowerExpr(exprs[1], dae, prefix, substitutions, isTupleTarget);
                  const targetDims = getExprDims(targetId, dae, this.db);
                  if (targetDims && targetDims.length > 0 && targetDims[0] === 0 && !exprs[1]?.text?.includes("[")) {
                    return;
                  }
                  const valDims = getExprDims(valId, dae, this.db);
                  if (
                    targetDims &&
                    valDims &&
                    (targetDims.length !== valDims.length ||
                      targetDims.some((d, idx) => d > 0 && valDims[idx]! > 0 && d !== valDims[idx]))
                  ) {
                    const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                    const targetStr = printer.printExprToString(targetId);
                    const valStr = printer.printExprToString(valId);
                    const tType = inferArenaExprVarType(dae, targetId);
                    const vType = inferArenaExprVarType(dae, valId);
                    const tTypeName = varTypeName(tType ?? VarType.Real);
                    const vTypeName = varTypeName(vType ?? VarType.Real);
                    const startB = sNode.startIndex ?? sNode.startByte;
                    const endB = sNode.endIndex ?? sNode.endByte;
                    dae.diagnostics.push({
                      severity: "error",
                      code: 5006,
                      message: `Type mismatch in assignment in ${targetStr} := ${valStr} of ${tTypeName}[${targetDims.join(", ")}] := ${vTypeName}[${valDims.join(", ")}]`,
                      range: {
                        startByte: startB,
                        endByte: endB,
                        startPosition: sNode.startPosition,
                        endPosition: sNode.endPosition,
                      },
                    });
                    return;
                  }

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
                  if (valId >= 0) {
                    valId = simplifyArenaExpr(dae, valId);
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
      } finally {
        this.currentParentMods = prevParentMods;
      }
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
          const shortMod = this.db.query<any>("effectiveModification", classId);
          const shortArgs = shortMod?.args ?? [];
          const combinedMods = {
            args: [...(parentMods?.args ?? []), ...shortArgs],
            ownerClassId: parentMods?.ownerClassId ?? classId,
          };
          this.extractClassEquations(matches[0].id, prefix, dae, curBreakContext, combinedMods);
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

        const extSubMod = {
          args: [...(extendsModParsed || []), ...(parentMods?.args || [])],
        };
        const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        const baseTargets = baseClass ? [baseClass] : this.db.byName(child.name);
        for (const target of baseTargets) {
          if (target.kind === "Class") {
            this.extractClassEquations(
              target.id,
              prefix,
              dae,
              {
                brokenComponents: childBrokenComponents,
                brokenConnections: childBrokenConnections,
              },
              extSubMod,
            );
          }
        }
      }
    }
  }

  private expandConnectorRef(refStr: string, dae: DAEBuilder): string[] {
    const parts = refStr.split(".");
    const pattern = new RegExp(
      "^(" +
        parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\[[\\d,\\s]+\\])?").join("\\.") +
        ")(?:\\..*)?$",
    );
    const found = new Set<string>();
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const vn = dae.getVarName(i);
      const m = vn.match(pattern);
      if (m && m[1].includes("[")) {
        found.add(m[1]);
      }
    }
    if (found.size === 0) return [refStr];
    return Array.from(found).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };
