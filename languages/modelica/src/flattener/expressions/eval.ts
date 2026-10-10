// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  ExprKind,
  inferArenaExprVarType,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
  UnaryOp,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { getFlatteningState } from "../support/state.js";
import { SCALAR_VECTORIZABLE_FUNCTIONS } from "./functions.js";

export function isArrayLiteral(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0 && i < trimmed.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

export function parseArrayLiteralElements(text: string): string[] {
  const trimmed = text.trim();
  if (!isArrayLiteral(trimmed)) return [trimmed];
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

export function isRealNameExpr(symId: number, dae: DAEBuilder): boolean {
  const name = dae.interner.resolve(symId);
  const state = getFlatteningState(dae);
  if (state.activeLoopVars?.has(name)) return false;
  if (name === "time") return true;
  // 1. Direct variable lookup (scalar or array)
  let vIdx = dae.getVarIdxByName(name);
  if (vIdx < 0) vIdx = dae.getVarIdxByName(`${name}[1]`);
  if (vIdx < 0) vIdx = dae.getVarIdxByName(`${name}[1,1]`);
  if (vIdx >= 0) {
    if (dae.getVarCustomType(vIdx)) return false;
    return dae.getVarType(vIdx) === VarType.Real;
  }

  // 2. Variable with subscripts: e.g. "v[1]", "v[i]", "myTable.v[integer(...)]"
  if (name.endsWith("]")) {
    const firstOpen = name.indexOf("[");
    const arrayBaseName = name.slice(0, firstOpen);
    let aIdx = dae.getVarIdxByName(arrayBaseName);
    if (aIdx < 0) aIdx = dae.getVarIdxByName(`${arrayBaseName}[1]`);
    if (aIdx < 0) aIdx = dae.getVarIdxByName(`${arrayBaseName}[1,1]`);
    if (aIdx >= 0) {
      if (dae.getVarCustomType(aIdx)) return false;
      return dae.getVarType(aIdx) === VarType.Real;
    }
  }

  // 3. Field access on a record variable: e.g. "r[i].x" or "r.x"
  let baseName = "";
  let fieldRest = "";
  if (name.includes("]")) {
    const lastClose = name.lastIndexOf("]");
    if (lastClose < name.length - 1 && name[lastClose + 1] === ".") {
      const firstOpen = name.indexOf("[");
      baseName = name.slice(0, firstOpen);
      fieldRest = name.slice(lastClose + 2);
    }
  } else if (name.includes(".")) {
    const firstDot = name.indexOf(".");
    baseName = name.slice(0, firstDot);
    fieldRest = name.slice(firstDot + 1);
  }

  if (baseName && fieldRest) {
    let rIdx = dae.getVarIdxByName(baseName);
    if (rIdx < 0) rIdx = dae.getVarIdxByName(`${baseName}[1]`);
    if (rIdx >= 0) {
      const cType = dae.getVarCustomType(rIdx);
      if (cType) {
        const activeDb: QueryDB | undefined = (dae as any).db ?? (dae as any).parentDae?.db;
        if (activeDb) {
          const segs = fieldRest.split(".");
          const currentClassId: SymbolId | undefined =
            (dae as any).flattener?.currentClassId ?? (dae as any).currentClassId;
          let currentScopeId: SymbolId | undefined = currentClassId;
          let syms = currentScopeId
            ? (
                (activeDb.query("resolveName", currentScopeId) ??
                  activeDb.query("resolveSimpleName", currentScopeId)) as any
              )?.(cType)
            : null;
          let targetSym = syms ? (Array.isArray(syms) ? syms[0] : syms) : null;
          if (!targetSym) {
            const matches = activeDb.byName(cType);
            targetSym = matches.find((s) => s.kind === "Class" || s.kind === "Record") ?? matches[0];
          }

          if (targetSym) {
            let currClass: SymbolEntry | null = targetSym;
            for (let i = 0; i < segs.length; i++) {
              if (!currClass) break;
              const seg = segs[i]!;
              const cleanSeg = seg.includes("[") ? seg.split("[")[0]! : seg;
              const children = activeDb.childrenOf(currClass.id);
              const comp = children.find((c) => c.name === cleanSeg && c.kind === "Component");
              if (!comp) {
                currClass = null;
                break;
              }
              if (i === segs.length - 1) {
                const typeSpec = activeDb.query<string | null>("typeSpecifier", comp.id);
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
                currClass = null;
                break;
              } else {
                const typeSpec = activeDb.query<string | null>("typeSpecifier", comp.id);
                if (typeSpec) {
                  const typeMatches = activeDb.byName(typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec);
                  currClass = typeMatches.find((s) => s.kind === "Class" || s.kind === "Record") ?? null;
                } else {
                  currClass = null;
                }
              }
            }
          }
        }
      }
    }
  }
  const activeDb: QueryDB | undefined = (dae as any).db ?? (dae as any).parentDae?.db;
  if (activeDb) {
    const currentClassId: SymbolId | undefined = (dae as any).flattener?.currentClassId ?? (dae as any).currentClassId;
    const lastPart = name.includes(".") ? name.split(".").pop()! : name;
    const cleanLastPart = lastPart.includes("[") ? lastPart.split("[")[0]! : lastPart;
    let syms: SymbolEntry[] = [];
    if (currentClassId) {
      const resolver =
        activeDb.query<any>("resolveSimpleName", currentClassId) ?? activeDb.query<any>("resolveName", currentClassId);
      const res = resolver?.(cleanLastPart);
      if (res) {
        syms = [res];
      } else {
        const scopeSyms = activeDb.childrenOf(currentClassId);
        syms = scopeSyms.filter((s) => s.name === cleanLastPart);
      }
    }
    if (syms.length === 0) {
      syms = activeDb.byName(cleanLastPart);
    }
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

export function isRealExpr(exprId: number, dae: DAEBuilder): boolean {
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
    const hasLoopVars = Boolean((dae as any).activeLoopVars && (dae as any).activeLoopVars.size > 0);
    if (!hasLoopVars) {
      const cached = cache.get(symId);
      if (cached === true) return true;
    }

    const res = isRealNameExpr(symId, dae);
    if (!hasLoopVars && res) {
      cache.set(symId, true);
    }
    return res;
  }
  if (kind === ExprKind.Subscript) {
    const baseId = dae.getExprData1(exprId);
    return isRealExpr(baseId, dae);
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
      fnName === "homotopy" ||
      fnName === "smooth" ||
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
      fnName === "noEvent" ||
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

export function inferArenaExprShapeAndType(dae: DAEBuilder, exprId: number): { shape: number[]; typeName: string } {
  if (exprId < 0) return { shape: [], typeName: "Real" };
  const exprKind = dae.getExprKind(exprId);
  if (exprKind === ExprKind.Binary) {
    const lInfo = inferArenaExprShapeAndType(dae, dae.getExprLeft(exprId));
    const rInfo = inferArenaExprShapeAndType(dae, dae.getExprRight(exprId));
    const shape = lInfo.shape.length > 0 ? lInfo.shape : rInfo.shape;
    const typeName = lInfo.typeName === "Real" || rInfo.typeName === "Real" ? "Real" : lInfo.typeName;
    return { shape, typeName };
  }
  if (exprKind === ExprKind.Unary || exprKind === ExprKind.Negate) {
    return inferArenaExprShapeAndType(dae, dae.getExprLeft(exprId));
  }
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

export function findIfElseExpr(dae: DAEBuilder, exprId: number): number {
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

export function castToRealExpr(exprId: number, dae: DAEBuilder): number {
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

export function getExprDims(exprId: number, dae: DAEBuilder, db?: any, flattener?: any): number[] | null {
  if (exprId < 0) return null;
  const storedShape = (dae as any).exprArrayShapes?.get(exprId);
  if (storedShape && storedShape.length > 0) return storedShape;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const vName = dae.interner.resolve(dae.getExprData1(exprId));
    if (vName) {
      const flat = flattener ?? (dae as any).flattener;
      if (dae.classKind === "function" && flat?.currentBindingCompName === vName) {
        return null;
      }
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
        if (dae.classKind === "function" && flat?.currentBindingCompName === vName) {
          return null;
        }
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
        const currentScopeId =
          (dae as any).currentClassId ??
          (dae as any).flattener?.currentClassId ??
          (dae as any).flattener?.currentRootClassId;
        let sym: any = null;
        if (currentScopeId) {
          const resolver = ((db as any).query("resolveName", currentScopeId) ??
            (db as any).query("resolveSimpleName", currentScopeId)) as any;
          const res = resolver?.(vName) ?? resolver?.(simpleName);
          if (res) sym = res;
        }
        const syms = sym ? [sym] : db.byName(simpleName);
        for (const s of syms) {
          if (s.kind === "Component") {
            const fullName = db.query("symbolFullName", s.id) ?? s.name;
            if (fullName === vName || s.name === vName) {
              const dims = db.query("arrayDimensions", s.id);
              if (dims && dims.length > 0 && dims.every((d: any) => typeof d === "number" && d > 0)) return dims;
              const typeSpec = db.query("typeSpecifier", s.id);
              if (typeSpec) {
                const typeMatches = db.byName(typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec);
                for (const tm of typeMatches) {
                  if (tm.kind === "Class") {
                    const tDims = db.query("arrayDimensions", tm.id);
                    if (tDims && tDims.length > 0 && tDims.every((d: any) => typeof d === "number" && d > 0)) {
                      return tDims;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return null;
  }
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    if (count === 0) return [0];
    const firstElem = dae.getExprLeft(exprId);
    const subDims = getExprDims(firstElem, dae, db, flattener);
    return subDims ? [count, ...subDims] : [count];
  }
  if (kind === ExprKind.IfElse) {
    const thenDims = getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
    const elseDims = getExprDims(dae.getExprRight(exprId), dae, db, flattener);
    if (thenDims && elseDims) {
      if (thenDims.length !== elseDims.length) return null;
      for (let i = 0; i < thenDims.length; i++) {
        if (thenDims[i] !== elseDims[i]) return null;
      }
      return thenDims;
    }
    return thenDims ?? elseDims;
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    const lDims = getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
    const rDims = getExprDims(dae.getExprRight(exprId), dae, db, flattener);
    if (op === BinOp.Mul) {
      if (lDims && rDims) {
        if (lDims.length === 2 && rDims.length === 2) return [lDims[0]!, rDims[1]!];
        if (lDims.length === 2 && rDims.length === 1) return [lDims[0]!];
        if (lDims.length === 1 && rDims.length === 2) return [rDims[1]!];
        if (lDims.length === 1 && rDims.length === 1) return null; // scalar product
      }
    }
    return lDims ?? rDims;
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "zeros" || fnName === "ones" || fnName === "fill") {
      const argCount = dae.getExprRight(exprId);
      const startIdx = fnName === "fill" ? 1 : 0;
      const dims: number[] = [];
      for (let i = startIdx; i < argCount; i++) {
        const aId = dae.getExprLeft(exprId + i);
        const val = evalDaeExpr(aId, dae);
        if (typeof val === "number") dims.push(val);
        else return null;
      }
      return dims.length > 0 ? dims : null;
    }
    if (fnName === "identity") {
      const aId = dae.getExprLeft(exprId);
      const val = evalDaeExpr(aId, dae);
      if (typeof val === "number") return [val, val];
      return null;
    }
    if (fnName === "diagonal") {
      const aId = dae.getExprLeft(exprId);
      const subDims = getExprDims(aId, dae, db, flattener);
      if (subDims && subDims.length === 1) return [subDims[0]!, subDims[0]!];
      return null;
    }
    if (fnName === "linspace") {
      const argCount = dae.getExprRight(exprId);
      if (argCount >= 3) {
        const nId = dae.getExprLeft(exprId + 2);
        const nVal = evalDaeExpr(nId, dae);
        if (typeof nVal === "number") return [nVal];
      }
      return [100];
    }
    if (fnName.startsWith("/*Real[") && fnName.endsWith("]*/")) {
      const inner = fnName.slice(7, -3);
      const dims = inner.split(",").map((s) => Number(s.trim()));
      if (dims.every((d) => !isNaN(d) && d >= 0)) return dims;
    }
    const fnObj =
      dae.getFunction?.(fnName) ??
      (flattener?.currentPrefix ? dae.getFunction?.(`${flattener.currentPrefix}.${fnName}`) : undefined);
    if (fnObj) {
      for (let vi = 0; vi < fnObj.varCount; vi++) {
        if (fnObj.getVarCausality(vi) === Causality.Output) {
          const outShape = (fnObj as any).deducedOutputShapes?.get(fnObj.getVarName(vi)) ?? fnObj.getVarShape(vi);
          if (outShape && outShape.length > 0) return outShape;
        }
      }
    } else if (db) {
      const cleanFnName = fnName.includes(".") ? fnName.split(".").pop()! : fnName;
      const fnSyms = db.byName(cleanFnName);
      const fnSym = fnSyms.find((s: any) => s.kind === "Function" || s.kind === "Class");
      if (fnSym) {
        const children = db.childrenOf(fnSym.id) || [];
        for (const c of children) {
          if (c.kind === "Component" && (db as QueryDB).query("causality", c.id) === "output") {
            const dims = (db as QueryDB).query<number[] | null>("arrayDimensions", c.id);
            if (dims && dims.length > 0 && dims.every((d: any) => typeof d === "number" && d > 0)) {
              return dims;
            }
          }
        }
      }
    }
  }
  if (kind === ExprKind.Subscript) {
    const baseId = dae.getExprData1(exprId);
    const subCount = dae.getExprRight(exprId);
    const baseDims = getExprDims(baseId, dae, db, flattener);
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
          const startId = dae.getExprData1(subExpr);
          const stepId = dae.getExprLeft(subExpr);
          const stopId = dae.getExprRight(subExpr);
          const rStart = evalDaeExpr(startId, dae);
          const rEnd = evalDaeExpr(stopId, dae);
          const rStep = stepId !== -1 && stepId !== 0xffffffff ? (evalDaeExpr(stepId, dae) ?? 1) : 1;
          if (typeof rStart === "number" && typeof rEnd === "number" && typeof rStep === "number" && rStep !== 0) {
            remainingDims.push(Math.max(0, Math.floor((rEnd - rStart) / rStep + 1e-9) + 1));
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

export function evalDaeExpr(
  exprId: number,
  dae: DAEBuilder,
  visitedExprs?: Set<number>,
  visitedVars?: Set<number>,
): any {
  if (exprId < 0) return null;
  if (!visitedExprs) visitedExprs = new Set<number>();
  if (visitedExprs.has(exprId)) return null;
  visitedExprs.add(exprId);
  try {
    const kind = dae.getExprKind(exprId);
    switch (kind) {
      case ExprKind.IntLiteral:
        return dae.getExprData1(exprId);
      case ExprKind.RealLiteral:
        return dae.getExprRealValue(exprId);
      case ExprKind.BoolLiteral:
        return dae.getExprData1(exprId) !== 0;
      case ExprKind.EnumLiteral:
        return dae.getExprData1(exprId);
      case ExprKind.Name: {
        const name = dae.interner.resolve(dae.getExprData1(exprId));
        if (!name) return null;
        if (name === "true") return true;
        if (name === "false") return false;
        const varIdx = dae.lookupVariable(name);
        if (varIdx >= 0) {
          if (!visitedVars) visitedVars = new Set<number>();
          if (visitedVars.has(varIdx)) return null;
          visitedVars.add(varIdx);
          try {
            const v = dae.getVarVariability(varIdx);
            if (v === Variability.Constant || v === Variability.Parameter) {
              const bindingId = dae.getVarExpression(varIdx);
              if (bindingId !== undefined && bindingId >= 0 && bindingId !== exprId) {
                return evalDaeExpr(bindingId, dae, visitedExprs, visitedVars);
              }
              if (!dae.isVarFixed(varIdx)) {
                return null;
              }
              const startVal = dae.getVarStartValue(varIdx);
              if (dae.getVarType(varIdx) === VarType.Boolean) {
                return startVal !== 0;
              }
              return startVal;
            }
            return null;
          } finally {
            visitedVars.delete(varIdx);
          }
        }
        if (dae.classKind === "function" && (dae as any).flattener?.currentClassId) {
          const flat = (dae as any).flattener;
          const db = flat.db;
          const parentChild = db
            ?.childrenOf(flat.currentClassId)
            ?.find((c: any) => c.name === name && c.kind === "Component");
          if (parentChild) {
            const v = (parentChild.metadata as any)?.variability ?? db.query("variability", parentChild.id);
            if (v === "constant" || v === "parameter") {
              const compMod: any = db.query("effectiveModification", parentChild.id);
              const bExpr = compMod?.bindingExpression;
              if (bExpr?.text) {
                const bText = bExpr.text.trim();
                if (isArrayLiteral(bText) && !/\bfor\b/.test(bText)) {
                  const elems = parseArrayLiteralElements(bText);
                  const parsedElems: any[] = [];
                  let allOk = true;
                  for (const e of elems) {
                    const num = Number(e.trim());
                    if (!isNaN(num)) {
                      parsedElems.push(num);
                    } else {
                      allOk = false;
                      break;
                    }
                  }
                  if (allOk) return parsedElems;
                }
                const num = Number(bText);
                if (!isNaN(num)) return num;
                if (bText === "true") return true;
                if (bText === "false") return false;
              }
            }
          }
        }
        return null;
      }
      case ExprKind.Negate: {
        const operand = evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars);
        if (typeof operand === "number") return -operand;
        return null;
      }
      case ExprKind.Unary: {
        const op = dae.getExprData1(exprId);
        const operand = evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars);
        if (operand === null) return null;
        if (op === UnaryOp.Negate && typeof operand === "number") return -operand;
        if (op === UnaryOp.Not) {
          if (typeof operand === "boolean") return !operand;
          if (typeof operand === "number") return operand === 0;
        }
        return null;
      }
      case ExprKind.Der: {
        const inner = evalDaeExpr(dae.getExprData1(exprId), dae, visitedExprs, visitedVars);
        if (typeof inner === "number") return 0.0;
        return null;
      }
      case ExprKind.Binary: {
        const op = dae.getExprData1(exprId);
        const left = evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars);
        const right = evalDaeExpr(dae.getExprRight(exprId), dae, visitedExprs, visitedVars);
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
        } else if (typeof left === "string" && typeof right === "string") {
          switch (op) {
            case BinOp.Add:
              return left + right;
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
          const val = evalDaeExpr(elemId, dae, visitedExprs, visitedVars);
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

        if (cleanFn === "size") {
          let dims: number[] | null = null;
          dims = getExprDims(firstArg, dae);
          if (!dims) {
            const arrVal = evalDaeExpr(firstArg, dae, visitedExprs, visitedVars);
            if (Array.isArray(arrVal)) {
              dims = [];
              let curr: any = arrVal;
              while (Array.isArray(curr)) {
                dims.push(curr.length);
                curr = curr[0];
              }
            }
          }
          if (dims && dims.length > 0) {
            if (argCount === 1) {
              return dims;
            }
            const dimArgId = dae.getExprLeft(exprId + 1);
            const dimVal = evalDaeExpr(dimArgId, dae, visitedExprs, visitedVars);
            if (typeof dimVal === "number" && dimVal >= 1 && dimVal <= dims.length) {
              return dims[dimVal - 1]!;
            }
          }
          return null;
        }

        if ((cleanFn === "max" || cleanFn === "min") && argCount === 1) {
          const arrVal = evalDaeExpr(firstArg, dae, visitedExprs, visitedVars);
          if (Array.isArray(arrVal) && arrVal.length > 0) {
            const flat = arrVal.flat(Infinity);
            if (flat.every((x) => typeof x === "number")) {
              return cleanFn === "max" ? Math.max(...flat) : Math.min(...flat);
            }
          }
          return null;
        }

        if ((cleanFn === "sum" || cleanFn === "product") && argCount === 1) {
          const arrVal = evalDaeExpr(firstArg, dae, visitedExprs, visitedVars);
          if (Array.isArray(arrVal) && arrVal.length > 0) {
            const flat = arrVal.flat(Infinity);
            if (flat.every((x) => typeof x === "number")) {
              return cleanFn === "sum" ? flat.reduce((a, b) => a + b, 0) : flat.reduce((a, b) => a * b, 1);
            }
          }
          return null;
        }

        const args: any[] = [];
        for (let i = 0; i < argCount; i++) {
          const aId = i === 0 ? firstArg : dae.getExprLeft(exprId + i);
          const aVal = evalDaeExpr(aId, dae, visitedExprs, visitedVars);
          if (aVal === null) return null;
          args.push(aVal);
        }
        if (cleanFn === "/*Real*/" || cleanFn === "Real") {
          if (typeof args[0] === "number") return args[0];
          if (Array.isArray(args[0])) return args[0].map((x: any) => (typeof x === "number" ? Number(x) : x));
          return null;
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
        if (cleanFn === "max" && args.length >= 2 && args.every((a) => typeof a === "number")) {
          return Math.max(...args);
        }
        if (cleanFn === "min" && args.length >= 2 && args.every((a) => typeof a === "number")) {
          return Math.min(...args);
        }
        const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(cleanFn);
        if (scalarBuiltin?.fold && args.every((a) => typeof a === "number")) {
          return scalarBuiltin.fold(...args);
        }
        return null;
      }
      case ExprKind.IfElse: {
        const condVal = evalDaeExpr(dae.getExprData1(exprId), dae, visitedExprs, visitedVars);
        if (typeof condVal === "boolean") {
          return condVal
            ? evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars)
            : evalDaeExpr(dae.getExprRight(exprId), dae, visitedExprs, visitedVars);
        }
        return null;
      }
      case ExprKind.Subscript: {
        const baseVal = evalDaeExpr(dae.getExprData1(exprId), dae, visitedExprs, visitedVars);
        if (!Array.isArray(baseVal)) return null;
        const subCount = dae.getExprRight(exprId);
        if (subCount === 1) {
          const subVal = evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars);
          if (typeof subVal === "number" && Number.isInteger(subVal)) {
            const idx = subVal - 1;
            if (idx >= 0 && idx < baseVal.length) {
              return baseVal[idx];
            }
          }
        }
        return null;
      }
      default:
        return null;
    }
  } finally {
    visitedExprs.delete(exprId);
  }
}

export function getConstVal(id: number, dae: DAEBuilder, visited?: Set<number>): number | null {
  const val = evalDaeExpr(id, dae, visited);
  return typeof val === "number" && !isNaN(val) ? val : null;
}

export function addArenaValueAsExpr(dae: DAEBuilder, value: any, expectedType?: VarType): number {
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

export function exprContainsNameRef(exprId: number, dae: DAEBuilder, visited = new Set<number>()): boolean {
  if (exprId < 0 || visited.has(exprId)) return false;
  visited.add(exprId);
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) return true;
  const left = dae.getExprLeft(exprId);
  const right = dae.getExprRight(exprId);
  const data1 = dae.getExprData1(exprId);
  if (kind === ExprKind.Der || kind === ExprKind.Pre) {
    return exprContainsNameRef(data1, dae, visited);
  }
  if (kind === ExprKind.Subscript) {
    const baseId = data1;
    if (exprContainsNameRef(baseId, dae, visited)) return true;
    const subCount = right;
    for (let i = 0; i < subCount; i++) {
      const subId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNameRef(subId, dae, visited)) return true;
    }
    return false;
  }
  if (kind === ExprKind.Range) {
    if (exprContainsNameRef(data1, dae, visited)) return true;
    if (right >= 0 && exprContainsNameRef(right, dae, visited)) return true;
    if (left >= 0 && left !== 0xffffffff && exprContainsNameRef(left, dae, visited)) return true;
    return false;
  }
  if (kind === ExprKind.Binary || kind === ExprKind.IfElse) {
    if (kind === ExprKind.IfElse) {
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
    const argCount = right;
    for (let i = 0; i < argCount; i++) {
      const argId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNameRef(argId, dae, visited)) return true;
    }
    return false;
  }
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    const count = data1;
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNameRef(elemId, dae, visited)) return true;
    }
    return false;
  }
  return false;
}

export function exprContainsNonConstantRef(exprId: number, dae: DAEBuilder, visited = new Set<number>()): boolean {
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
    if (dae.classKind === "function" && (dae as any).flattener?.currentClassId) {
      const flat = (dae as any).flattener;
      const db = flat.db;
      const parentChild = db
        ?.childrenOf(flat.currentClassId)
        ?.find((c: any) => c.name === name && c.kind === "Component");
      if (parentChild) {
        const v = (parentChild.metadata as any)?.variability ?? db.query("variability", parentChild.id);
        if (v === "constant" || v === "parameter") {
          return false;
        }
      }
    }
    return true;
  }
  const left = dae.getExprLeft(exprId);
  const right = dae.getExprRight(exprId);
  const data1 = dae.getExprData1(exprId);
  if (kind === ExprKind.Der || kind === ExprKind.Pre) {
    return true;
  }
  if (kind === ExprKind.Subscript) {
    const baseId = data1;
    if (exprContainsNonConstantRef(baseId, dae, visited)) return true;
    const subCount = right;
    for (let i = 0; i < subCount; i++) {
      const subId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNonConstantRef(subId, dae, visited)) return true;
    }
    return false;
  }
  if (kind === ExprKind.Range) {
    if (exprContainsNonConstantRef(data1, dae, visited)) return true;
    if (right >= 0 && exprContainsNonConstantRef(right, dae, visited)) return true;
    if (left >= 0 && left !== 0xffffffff && exprContainsNonConstantRef(left, dae, visited)) return true;
    return false;
  }
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
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    const count = data1;
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? left : dae.getExprLeft(exprId + i);
      if (exprContainsNonConstantRef(elemId, dae, visited)) return true;
    }
    return false;
  }
  return false;
}
