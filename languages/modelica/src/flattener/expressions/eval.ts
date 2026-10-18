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
import { getExprArrayShape, getFlatteningState, getNamedArrayShape } from "../support/state.js";
import { exprReferencesRuntimeParameter } from "./binary-ops.js";
import { evaluateCSTNumber, getSymbolEnumLiterals } from "./cst-utils.js";
import { SCALAR_VECTORIZABLE_FUNCTIONS } from "./functions.js";

/**
 * Determines whether a raw expression string represents a balanced top-level
 * Modelica array constructor literal `{...}` rather than multiple separate
 * brace-enclosed expressions (such as `{1, 2} + {3, 4}`).
 *
 * Scans character-by-character while tracking string literal state, escape
 * sequences, and nesting depth across `{}`, `[]`, and `()`.
 *
 * @param text - Raw expression text to inspect.
 * @returns `true` if `text` is a single outer `{...}` array literal.
 */
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

/**
 * Splits a top-level `{...}` Modelica array literal string into its direct
 * comma-separated element substrings without splitting nested sub-arrays,
 * function call arguments, or subscripts.
 *
 * If the input is not a balanced `{...}` array literal, returns a single-element
 * array containing the trimmed input string.
 *
 * @param text - Array literal string to split.
 * @returns Array of trimmed top-level element expression strings.
 */
export function parseArrayLiteralElements(text: string): string[] {
  const trimmed = text.trim();
  if (!isArrayLiteral(trimmed)) return [trimmed];
  const inner = trimmed.slice(1, -1).trim();
  const elements: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let current = "";
  for (const ch of inner) {
    if (escape) {
      escape = false;
      current += ch;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        elements.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    elements.push(current.trim());
  }
  return elements;
}

/**
 * Checks whether an interned variable or component reference symbol resolves
 * to a `Real`-typed scalar or array element in the DAE arena or Salsa symbol table.
 *
 * Resolution proceeds in four stages:
 * 1. Active loop variable checks (`realLoopVars` vs integer `activeLoopVars`) and built-in `time`.
 * 2. Direct DAE variable lookup by exact name or scalarized element probe (`name[1]`, `name[1,1]`).
 * 3. Subscripted array reference stripping (`v[i]` -> `v`) and DAE base lookup.
 * 4. Record field traversal and fallback Salsa `typeSpecifier` / `resolvedBaseClass` queries.
 *
 * @param symId - Interned string ID of the variable/reference name in `dae.interner`.
 * @param dae - Target `DAEBuilder` arena containing declared variables and flattening state.
 * @returns `true` if the named symbol has base type `Real` (and is not an operator record).
 */
export function isRealNameExpr(symId: number, dae: DAEBuilder): boolean {
  const name = dae.interner.resolve(symId);
  const state = getFlatteningState(dae);
  if ((state as any).realLoopVars?.has(name)) return true;
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

  // 3. Field access on a record variable: e.g. "r[i].x" or "r.x" or "r.x[i]"
  let baseName = "";
  let fieldRest = "";
  if (name.includes(".")) {
    const firstDot = name.indexOf(".");
    const rawBase = name.slice(0, firstDot);
    baseName = rawBase.includes("[") ? rawBase.slice(0, rawBase.indexOf("[")) : rawBase;
    fieldRest = name.slice(firstDot + 1);
  }

  const activeDb: QueryDB | undefined = state.db;
  if (baseName && fieldRest) {
    let rIdx = dae.getVarIdxByName(baseName);
    if (rIdx < 0) rIdx = dae.getVarIdxByName(`${baseName}[1]`);
    if (rIdx >= 0) {
      const cType = dae.getVarCustomType(rIdx);
      if (cType) {
        if (activeDb) {
          const segs = fieldRest.split(".");
          const currentClassId: SymbolId | undefined = state.flattener?.currentClassId ?? state.currentClassId;
          let currentScopeId: SymbolId | undefined = currentClassId;
          let syms = currentScopeId
            ? (
                (activeDb.query("resolveName", currentScopeId) ??
                  activeDb.query("resolveSimpleName", currentScopeId)) as any
              )?.(cType)
            : null;
          let targetSym = syms ? (Array.isArray(syms) ? syms[0] : syms) : null;
          if (!targetSym) {
            const leafType = cType.includes(".") ? cType.split(".").pop()! : cType;
            const matches = activeDb.byName(leafType);
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
                      if (meta?.["baseType"] === "Real" || meta?.["primitiveType"] === "Real") return true;
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
  if (activeDb) {
    const currentClassId: SymbolId | undefined = state.flattener?.currentClassId ?? state.currentClassId;
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
              if (meta?.["baseType"] === "Real" || meta?.["primitiveType"] === "Real") return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Recursively determines whether a lowered DAE arena expression evaluates to a
 * `Real` scalar or `Real` array according to Modelica type promotion rules.
 *
 * Used during expression lowering to decide when integer sub-expressions must
 * be wrapped in `/*Real* /` coercion casts (e.g., mixed `Real`/`Integer` binary
 * arithmetic, `if`-expressions, array constructors, and built-in calls).
 *
 * @param exprId - Arena expression ID in `dae`.
 * @param dae - Target `DAEBuilder` arena.
 * @returns `true` if `exprId` has a `Real` scalar or array type.
 */
export function isRealExpr(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.IntLiteral || kind === ExprKind.BoolLiteral || kind === ExprKind.StringLiteral) return false;
  if (kind === ExprKind.Der) return true;
  if (kind === ExprKind.Pre) return isRealExpr(dae.getExprData1(exprId), dae);
  if (kind === ExprKind.Name) {
    const symId = dae.getExprData1(exprId);
    const state = getFlatteningState(dae);
    const cache = state.isRealNameCache;
    const hasLoopVars = Boolean(state.activeLoopVars && state.activeLoopVars.size > 0);
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
  if (kind === ExprKind.Range) {
    return isRealExpr(dae.getExprData1(exprId), dae) || isRealExpr(dae.getExprRight(exprId), dae);
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Div || op === BinOp.ElemDiv || op === BinOp.Pow || op === BinOp.ElemPow) return true;
    if (
      op === BinOp.Add ||
      op === BinOp.Sub ||
      op === BinOp.Mul ||
      op === BinOp.Colon ||
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
      fnName === "semiLinear" ||
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
    if (
      fnName === "abs" ||
      fnName === "min" ||
      fnName === "max" ||
      fnName === "div" ||
      fnName === "mod" ||
      fnName === "rem"
    ) {
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
      return true;
    }
    if (fnName === "floor" || fnName === "ceil") return true;
    if (fnName === "integer") return false;
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
    const state = getFlatteningState(dae);
    const iterCount = dae.getExprRight(exprId);
    const addedVars: string[] = [];
    const addedRealVars: string[] = [];
    for (let i = 0; i < iterCount; i++) {
      const iterNodeId = exprId + 1 + i;
      const iterVarName = dae.interner.resolve(dae.getExprData1(iterNodeId));
      const rangeId = dae.getExprLeft(iterNodeId);
      if (iterVarName && !state.activeLoopVars?.has(iterVarName)) {
        if (!state.activeLoopVars) state.activeLoopVars = new Set<string>();
        state.activeLoopVars.add(iterVarName);
        addedVars.push(iterVarName);
        if (isRealExpr(rangeId, dae)) {
          if (!(state as any).realLoopVars) (state as any).realLoopVars = new Set<string>();
          (state as any).realLoopVars.add(iterVarName);
          addedRealVars.push(iterVarName);
        }
      }
    }
    try {
      return isRealExpr(dae.getExprLeft(exprId), dae);
    } finally {
      for (const v of addedVars) state.activeLoopVars?.delete(v);
      for (const v of addedRealVars) (state as any).realLoopVars?.delete(v);
    }
  }
  return false;
}

/**
 * Infers both the multi-dimensional array shape and the primitive Modelica base
 * type name (`"Real"`, `"Integer"`, `"Boolean"`, `"String"`, `"Enumeration"`, `"Clock"`)
 * of an expression in the DAE arena.
 *
 * Handles array constructors (`fill`, `zeros`, `ones`, `{...}`), binary/unary
 * operations, conditional `if`-expressions, and variable/subscript references.
 *
 * @param dae - Target `DAEBuilder` arena.
 * @param exprId - Arena expression ID to inspect.
 * @returns Object containing `shape` (array of dimension sizes, empty for scalars) and `typeName`.
 */
export function inferArenaExprShapeAndType(dae: DAEBuilder, exprId: number): { shape: number[]; typeName: string } {
  if (exprId < 0) return { shape: [], typeName: "Real" };
  const exprKind = dae.getExprKind(exprId);
  if (exprKind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "fill") {
      const argCount = dae.getExprRight(exprId);
      const valArg = dae.getExprLeft(exprId);
      const valInfo = inferArenaExprShapeAndType(dae, valArg);
      const callShape: number[] = [];
      for (let i = 1; i < argCount; i++) {
        const dimArg = dae.getExprLeft(exprId + i);
        const dimVal = evalDaeExpr(dimArg, dae);
        if (typeof dimVal === "number" && dimVal > 0) {
          callShape.push(dimVal);
        } else {
          callShape.push(1);
        }
      }
      return { shape: [...callShape, ...valInfo.shape], typeName: valInfo.typeName };
    }
    if (fnName === "zeros" || fnName === "ones") {
      const argCount = dae.getExprRight(exprId);
      const callShape: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const dimArg = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        const dimVal = evalDaeExpr(dimArg, dae);
        if (typeof dimVal === "number" && dimVal > 0) {
          callShape.push(dimVal);
        } else {
          callShape.push(1);
        }
      }
      return { shape: callShape, typeName: "Real" };
    }
    const dims = getExprDims(exprId, dae);
    if (dims && dims.length > 0) {
      let vType = VarType.Real;
      if (isRealExpr(exprId, dae)) {
        vType = VarType.Real;
      } else {
        vType = inferArenaExprVarType(dae, exprId) ?? VarType.Real;
      }
      const typeNames: Record<number, string> = {
        [VarType.Real]: "Real",
        [VarType.Integer]: "Integer",
        [VarType.Boolean]: "Boolean",
        [VarType.String]: "String",
      };
      return { shape: dims, typeName: typeNames[vType] ?? "Real" };
    }
  }
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
    const subInfo = inferArenaExprShapeAndType(dae, dae.getExprLeft(curr));
    return { shape: [...shape, ...subInfo.shape], typeName: subInfo.typeName };
  }
  if (curr >= 0 && shape.length > 0) {
    const subDims = getExprDims(curr, dae);
    if (subDims && subDims.length > 0) {
      shape.push(...subDims);
    }
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
        vIdx = dae.getVarIdxByName(name.split("[")[0]!);
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
      vType = inferArenaExprVarType(dae, curr) ?? VarType.Real;
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

/**
 * Searches an expression subtree (traversing through unary and binary operators)
 * for the first nested `ExprKind.IfElse` conditional expression node.
 *
 * @param dae - Target `DAEBuilder` arena.
 * @param exprId - Root expression ID to search.
 * @returns Arena expression ID of the first `IfElse` node found, or `-1` if none exists.
 */
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

/**
 * Coerces an integer-typed DAE arena expression to a `Real`-typed arena expression,
 * matching OpenModelica's canonical type-promotion output.
 *
 * - `IntLiteral` nodes are converted directly to `RealLiteral` nodes (e.g. `100` -> `100.0`).
 * - Negated `IntLiteral` nodes become negated `RealLiteral` nodes.
 * - `ArrayCtor` and `IfElse` expressions recursively coerce their elements/branches.
 * - `fill(val, ...dims)` coerces its fill value argument in-place.
 * - Array expressions with known dimensions `[d1, d2, ...]` are wrapped in `/*Real[d1, d2, ...]* /(expr)`.
 * - Scalar non-literal expressions are wrapped in `/*Real* /(expr)`.
 *
 * @param exprId - Arena expression ID to coerce.
 * @param dae - Target `DAEBuilder` arena.
 * @returns Coerced `Real`-typed arena expression ID (or `exprId` unchanged if already `Real`).
 */
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
  if (kind === ExprKind.Comprehension) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "array") {
      const iterCount = dae.getExprRight(exprId);
      const colons = Array(Math.max(1, iterCount)).fill(":").join(", ");
      return dae.addCallExpr(`/*Real[${colons}]*/`, [exprId]);
    }
  }
  if (kind === ExprKind.Binary && dae.getExprData1(exprId) === BinOp.Colon) {
    const l = castToRealExpr(dae.getExprLeft(exprId), dae);
    const r = castToRealExpr(dae.getExprRight(exprId), dae);
    return dae.addBinaryExpr(BinOp.Colon, l, r);
  }
  if (kind === ExprKind.Range) {
    const startId = castToRealExpr(dae.getExprData1(exprId), dae);
    const stepId = dae.getExprLeft(exprId);
    const castStepId = stepId >= 0 && stepId !== 0xffffffff ? castToRealExpr(stepId, dae) : stepId;
    const stopId = castToRealExpr(dae.getExprRight(exprId), dae);
    return dae.addRangeExpr(startId, castStepId, stopId);
  }
  const dims = getExprDims(exprId, dae);
  if (dims && dims.length > 0) {
    return dae.addCallExpr(`/*Real[${dims.join(", ")}]*/`, [exprId]);
  }
  return dae.addCallExpr("/*Real*/", [exprId]);
}

/**
 * Normalizes raw dimension query results from Salsa (`arrayDimensions`) into a
 * concrete array of positive integer dimension lengths, or returns `null` if any
 * dimension is symbolic, unknown, or non-positive.
 *
 * @param rawDims - Raw dimension descriptors returned by `db.query("arrayDimensions", ...)`.
 * @returns Array of positive integer dimension sizes, or `null` if not statically resolved.
 */
function normalizeDims(rawDims: any[] | null | undefined): number[] | null {
  if (!rawDims || rawDims.length === 0) return null;
  const res: number[] = [];
  for (const d of rawDims) {
    if (typeof d === "number" && d > 0) res.push(d);
    else if (d?.kind === "literal" && typeof d.value === "number" && d.value > 0) res.push(d.value);
    else if (typeof d?.value === "number" && d.value > 0) res.push(d.value);
    else return null;
  }
  return res.length > 0 ? res : null;
}

/**
 * Infers the multi-dimensional tensor shape (`[d1, d2, ...]`) of a lowered DAE
 * arena expression, or returns `null` if the expression is scalar or its shape
 * cannot be statically determined.
 *
 * Shape inference handles:
 * - Cached per-expression shapes (`getExprArrayShape`) recorded during lowering.
 * - Variable references (`ExprKind.Name`): checks named array shape registry,
 *   unexpanded DAE variable shape metadata, scalarized array elements (`v[1,2]`),
 *   and Salsa symbol table `arrayDimensions` / enumeration literal counts.
 * - Nested array constructors (`ExprKind.ArrayCtor`): prepends outer element count
 *   to the first element's recursive dimensions.
 * - Array comprehensions (`ExprKind.Comprehension`): evaluates each iterator's range
 *   length (`start:step:stop` or array literal) and concatenates body dimensions.
 * - Conditional expressions (`ExprKind.IfElse`): evaluates static condition or
 *   unifies matching branch dimensions.
 * - Binary operations (`ExprKind.Binary`): applies linear algebra contraction rules
 *   for `*` (matrix-matrix `[m,k]*[k,n] -> [m,n]`, matrix-vector `[m,k]*[k] -> [m]`,
 *   vector-matrix `[k]*[k,n] -> [n]`, inner product `[k]*[k] -> scalar`) and broadcasts
 *   element-wise operators.
 * - Built-in and user function calls (`ExprKind.Call`): resolves shapes for `zeros`,
 *   `ones`, `fill`, `identity`, `diagonal`, `linspace`, `outerProduct`, vectorized
 *   scalar builtins, compiled `fnObj` output shapes, and symbolic output dimension
 *   expressions depending on call-site input arguments (`size(u, 1)`, etc.).
 * - Array subscripting (`ExprKind.Subscript`): drops scalar-indexed axes while
 *   retaining slice dimensions (`:`, `a:b`, vector subscripts) and trailing unindexed axes.
 *
 * @param exprId - Arena expression ID in `dae`.
 * @param dae - Target `DAEBuilder` arena.
 * @param db - Optional Salsa `QueryDB` for symbol-table dimension lookups.
 * @param flattener - Optional flattener instance for scope context.
 * @returns Array of dimension sizes `[d1, d2, ...]`, or `null` if scalar/unknown.
 */
export function getExprDims(exprId: number, dae: DAEBuilder, db?: any, flattener?: any): number[] | null {
  if (exprId < 0) return null;
  const state = getFlatteningState(dae);
  db = db ?? state.db;
  flattener = flattener ?? state.flattener;
  // Fast path: check if an explicit array shape was already recorded for this arena node
  const storedShape = getExprArrayShape(dae, exprId);
  if (storedShape && storedShape.length > 0) return storedShape;
  const kind = dae.getExprKind(exprId);

  // ── Case 1: Variable or type reference (ExprKind.Name) ──
  if (kind === ExprKind.Name) {
    const vName = dae.interner.resolve(dae.getExprData1(exprId));
    if (vName) {
      const flat = flattener ?? state.flattener;
      const leafVarName = vName.includes(".") ? vName.split(".").pop()! : vName;
      // Active for-loop iterator variables are always scalar
      if (state.activeLoopVars?.has(vName) || state.activeLoopVars?.has(leafVarName)) {
        return null;
      }
      // Avoid self-referential shape recursion when lowering a function variable's own binding
      if (dae.classKind === "function" && flat?.currentBindingCompName === vName) {
        return null;
      }
      // 1a. Check named array shape table populated during component instantiation
      const namedShape = getNamedArrayShape(dae, vName);
      if (namedShape && namedShape.length > 0) return namedShape;
      // 1b. Check unexpanded variable entry in DAEBuilder
      const varIdx = dae.getVarIdxByName(vName);
      if (varIdx >= 0) {
        const shape = dae.getVarShape(varIdx);
        if (shape && shape.length > 0) return shape;
        const shapeExprs = dae.getVarShapeExprs ? dae.getVarShapeExprs(varIdx) : null;
        if (shapeExprs && shapeExprs.length > 0) return shapeExprs;
        if (!dae.hasArrayElements(vName)) return null;
      }

      // 1c. Reconstruct multi-dimensional bounds by scanning scalarized DAE variables `vName[i,j,...]`
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
      // 1d. Fallback to Salsa symbol table queries (cached per scope + variable name)
      if (db) {
        const currentScopeId =
          state.currentClassId ?? state.flattener?.currentClassId ?? state.flattener?.currentRootClassId;
        let dimsCache = (state as any)._exprDimsByNameCache as Map<string, number[] | null> | undefined;
        if (!dimsCache) {
          dimsCache = new Map();
          (state as any)._exprDimsByNameCache = dimsCache;
        }
        const cacheKey = `${currentScopeId ?? 0}:${vName}`;
        if (dimsCache.has(cacheKey)) {
          return dimsCache.get(cacheKey)!;
        }
        const computeDbDims = (): number[] | null => {
          const simpleName = vName.includes(".") ? vName.split(".").pop()! : vName;
          let sym: any = null;
          if (currentScopeId) {
            const resolver = ((db as any).query("resolveName", currentScopeId) ??
              (db as any).query("resolveSimpleName", currentScopeId)) as any;
            const res = resolver?.(vName) ?? resolver?.(simpleName);
            if (res) sym = res;
          }
          const syms = sym ? [sym] : db.byName(simpleName);
          const hasDot = vName.includes(".");
          const parentSeg = hasDot ? vName.slice(0, vName.lastIndexOf(".")).split(".").pop()! : null;
          for (const s of syms) {
            if (s.kind === "Component") {
              if (s !== sym) {
                if (!hasDot) {
                  if (currentScopeId && s.parentId !== currentScopeId && s.parentId !== null) continue;
                } else {
                  const pSym = s.parentId ? db.symbol(s.parentId) : null;
                  if (!pSym || pSym.name !== parentSeg) continue;
                }
              }
              const fullName = db.query("symbolFullName", s.id) ?? s.name;
              const matchesScope = !currentScopeId || s === sym || s.parentId === currentScopeId;
              if (fullName === vName || (s.name === vName && matchesScope)) {
                const rawDims = db.query("arrayDimensions", s.id);
                const dims = normalizeDims(rawDims);
                if (dims) return dims;
                // Also check if the component's type alias itself carries array dimensions
                const typeSpec = db.query("typeSpecifier", s.id);
                if (typeSpec) {
                  const typeMatches = db.byName(typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec);
                  for (const tm of typeMatches) {
                    if (tm.kind === "Class") {
                      const rawTDims = db.query("arrayDimensions", tm.id);
                      const tDims = normalizeDims(rawTDims);
                      if (tDims) {
                        return tDims;
                      }
                    }
                  }
                }
              }
            } else if (s.kind === "Class" || (s.metadata as any)?.classKind === "type") {
              // Enumeration type names used as range bounds (e.g. `size(EnumType)`) have 1D length = literal count
              if (hasDot && s !== sym) {
                const pSym = s.parentId ? db.symbol(s.parentId) : null;
                if (!pSym || pSym.name !== parentSeg) continue;
              }
              const literals = getSymbolEnumLiterals(db, s);
              if (literals && literals.length > 0) {
                return [literals.length];
              }
            }
          }
          return null;
        };
        const resDims = computeDbDims();
        dimsCache.set(cacheKey, resDims);
        if (resDims) return resDims;
      }
    }
    return null;
  }

  // ── Case 2: Array constructor `{e1, e2, ...}` (ExprKind.ArrayCtor) ──
  // Outer dimension is the element count; inner dimensions are inferred from the first element.
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    if (count === 0) return [0];
    const firstElem = dae.getExprLeft(exprId);
    const subDims = getExprDims(firstElem, dae, db, flattener);
    return subDims ? [count, ...subDims] : [count];
  }

  // ── Case 3: Array comprehension `{body for i in r1, j in r2}` (ExprKind.Comprehension) ──
  // Each iterator range contributes one leading axis, followed by any dimensions of `body`.
  if (kind === ExprKind.Comprehension) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "array") {
      const bodyId = dae.getExprLeft(exprId);
      const iterCount = dae.getExprRight(exprId);
      const dims: number[] = [];
      for (let i = 1; i <= iterCount; i++) {
        const rangeId = dae.getExprLeft(exprId + i);
        const rKind = dae.getExprKind(rangeId);
        if (rKind === ExprKind.Range) {
          const rStart = evalDaeExpr(dae.getExprData1(rangeId), dae);
          const stepId = dae.getExprLeft(rangeId);
          const rEnd = evalDaeExpr(dae.getExprRight(rangeId), dae);
          const rStep = stepId !== -1 && stepId !== 0xffffffff ? (evalDaeExpr(stepId, dae) ?? 1) : 1;
          if (typeof rStart === "number" && typeof rEnd === "number" && typeof rStep === "number" && rStep !== 0) {
            dims.push(Math.max(0, Math.floor((rEnd - rStart) / rStep + 1e-9) + 1));
          } else {
            return null;
          }
        } else if (rKind === ExprKind.ArrayCtor) {
          dims.push(dae.getExprData1(rangeId));
        } else {
          return null;
        }
      }
      const subDims = getExprDims(bodyId, dae, db, flattener);
      return subDims ? [...dims, ...subDims] : dims;
    }
  }

  // ── Case 4: Conditional expression `if cond then a else b` (ExprKind.IfElse) ──
  // If `cond` evaluates statically, take the active branch's shape; otherwise verify both branches agree.
  if (kind === ExprKind.IfElse) {
    const condVal = evalDaeExpr(dae.getExprData1(exprId), dae);
    if (condVal === true) {
      return getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
    }
    if (condVal === false) {
      return getExprDims(dae.getExprRight(exprId), dae, db, flattener);
    }
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

  // ── Case 5: Binary operators (ExprKind.Binary) ──
  // Standard multiplication (`BinOp.Mul`) performs tensor contraction on 1D/2D operands:
  //   - [m, k] * [k, n] -> [m, n] (matrix-matrix product)
  //   - [m, k] * [k]    -> [m]    (matrix-vector product)
  //   - [k]    * [k, n] -> [n]    (vector-matrix product)
  //   - [k]    * [k]    -> null   (dot product -> scalar)
  // All other binary operators preserve the non-scalar operand shape.
  if (kind === ExprKind.Range) {
    const rStart = evalDaeExpr(dae.getExprData1(exprId), dae);
    const stepId = dae.getExprLeft(exprId);
    const rEnd = evalDaeExpr(dae.getExprRight(exprId), dae);
    const rStep = stepId !== -1 && stepId !== 0xffffffff ? (evalDaeExpr(stepId, dae) ?? 1) : 1;
    if (typeof rStart === "number" && typeof rEnd === "number" && typeof rStep === "number" && rStep !== 0) {
      return [Math.max(0, Math.floor((rEnd - rStart) / rStep + 1e-9) + 1)];
    }
    return [-1];
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Colon) {
      const rStart = evalDaeExpr(dae.getExprLeft(exprId), dae);
      const rEnd = evalDaeExpr(dae.getExprRight(exprId), dae);
      if (typeof rStart === "number" && typeof rEnd === "number") {
        return [Math.max(0, Math.floor(rEnd - rStart + 1e-9) + 1)];
      }
      return [-1];
    }
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

  // ── Case 6: Unary / Negation operators (ExprKind.Unary / ExprKind.Negate) ──
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
  }

  // ── Case 7: Function calls and built-in array constructors (ExprKind.Call) ──
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    // `zeros(d1, d2, ...)`, `ones(d1, d2, ...)`, and `fill(val, d1, d2, ...)`
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
    // `identity(n)` -> [n, n]
    if (fnName === "identity") {
      const aId = dae.getExprLeft(exprId);
      const val = evalDaeExpr(aId, dae);
      if (typeof val === "number") return [val, val];
      return null;
    }
    // `diagonal(v)` where `v` has shape [n] -> [n, n]
    if (fnName === "diagonal") {
      const aId = dae.getExprLeft(exprId);
      const subDims = getExprDims(aId, dae, db, flattener);
      if (subDims && subDims.length === 1) return [subDims[0]!, subDims[0]!];
      return null;
    }
    // `linspace(x1, x2, n)` -> [n]
    if (fnName === "linspace") {
      const argCount = dae.getExprRight(exprId);
      if (argCount >= 3) {
        const nId = dae.getExprLeft(exprId + 2);
        const nVal = evalDaeExpr(nId, dae);
        if (typeof nVal === "number") return [nVal];
      }
      return [100];
    }
    // Synthetic Real array cast wrapper `/*Real[d1, d2]*/(expr)`
    if (fnName.startsWith("/*Real[") && fnName.endsWith("]*/")) {
      const inner = fnName.slice(7, -3);
      const dims = inner.split(",").map((s) => Number(s.trim()));
      if (dims.every((d) => !isNaN(d) && d >= 0)) return dims;
    }
    // `outerProduct(v1, v2)` where v1 is [m] and v2 is [n] -> [m, n]
    if (fnName === "outerProduct" && dae.getExprRight(exprId) >= 2) {
      const d1 = getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
      const d2 = getExprDims(dae.getExprLeft(exprId + 1), dae, db, flattener);
      if (d1 && d1.length === 1 && d2 && d2.length === 1) {
        return [d1[0]!, d2[0]!];
      }
      return null;
    }
    if (
      (fnName === "Connections.uniqueRootIndices" || fnName === "uniqueRootIndices") &&
      dae.getExprRight(exprId) >= 2
    ) {
      return getExprDims(dae.getExprLeft(exprId + 1), dae, db, flattener);
    }
    if (fnName === "smooth" && dae.getExprRight(exprId) >= 2) {
      return getExprDims(dae.getExprLeft(exprId + 1), dae, db, flattener);
    }
    if (fnName === "homotopy") {
      const d0 = getExprDims(dae.getExprLeft(exprId), dae, db, flattener);
      if (d0) return d0;
      if (dae.getExprRight(exprId) >= 2) {
        return getExprDims(dae.getExprLeft(exprId + 1), dae, db, flattener);
      }
      return null;
    }
    // Clocked sampling operators and vectorizable mathematical builtins preserve first argument's shape
    if (
      fnName === "superSample" ||
      fnName === "subSample" ||
      fnName === "shiftSample" ||
      fnName === "backSample" ||
      fnName === "previous" ||
      fnName === "sample" ||
      fnName === "hold" ||
      fnName === "semiLinear" ||
      fnName === "noEvent" ||
      SCALAR_VECTORIZABLE_FUNCTIONS.has(fnName)
    ) {
      const aId = dae.getExprLeft(exprId);
      return getExprDims(aId, dae, db, flattener);
    }
    // User-defined function already compiled into `dae.functions`: inspect its output variable shape
    const fnObj =
      dae.getFunction?.(fnName) ??
      (flattener?.currentPrefix ? dae.getFunction?.(`${flattener.currentPrefix}.${fnName}`) : undefined);
    if (fnObj) {
      const fnState = getFlatteningState(fnObj);
      const inputNames: string[] = [];
      for (let vi = 0; vi < fnObj.varCount; vi++) {
        if (!fnObj.isVarRemoved(vi) && fnObj.getVarCausality(vi) === Causality.Input) {
          inputNames.push(fnObj.getVarName(vi));
        }
      }
      const callArgCount = dae.getExprRight(exprId);
      const scalarOutputCounts = new Map<string, number[]>();
      for (let vi = 0; vi < fnObj.varCount; vi++) {
        if (fnObj.getVarCausality(vi) === Causality.Output) {
          const vName = fnObj.getVarName(vi);
          const explicitShape = fnObj.getVarShape(vi);
          const shapeExprs = fnObj.getVarShapeExprs?.(vi);
          if (shapeExprs && shapeExprs.length > 0) {
            let hasInputDep = false;
            const callSiteShape: number[] = [];
            for (let dIdx = 0; dIdx < shapeExprs.length; dIdx++) {
              const seId = shapeExprs[dIdx]!;
              if (seId >= 0 && fnObj.getExprKind(seId) === ExprKind.Name) {
                const seName = fnObj.interner.resolve(fnObj.getExprData1(seId)) ?? "";
                const inpIdx = inputNames.indexOf(seName);
                if (inpIdx >= 0 && inpIdx < callArgCount) {
                  hasInputDep = true;
                  const argExprId = inpIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + inpIdx);
                  const evalVal = evalDaeExpr(argExprId, dae);
                  callSiteShape.push(typeof evalVal === "number" && evalVal > 0 ? Math.round(evalVal) : -1);
                  continue;
                }
              }
              callSiteShape.push(explicitShape?.[dIdx] ?? -1);
            }
            if (hasInputDep) {
              return callSiteShape;
            }
          }
          const outShape =
            explicitShape && explicitShape.length > 0 && explicitShape.every((d) => d > 0)
              ? explicitShape
              : (fnState.deducedOutputShapes?.get(vName) ?? explicitShape);
          if (outShape && outShape.length > 0 && outShape.every((d) => d > 0)) return outShape;
          const m = /^([^[\]]+)\[([0-9,\s]+)\]$/.exec(vName);
          if (m) {
            const base = m[1]!;
            const indices = m[2]!.split(",").map((s) => Number.parseInt(s.trim(), 10));
            const prev = scalarOutputCounts.get(base) ?? indices.map(() => 0);
            for (let k = 0; k < indices.length; k++) {
              if (indices[k]! > (prev[k] ?? 0)) prev[k] = indices[k]!;
            }
            scalarOutputCounts.set(base, prev);
          }
        }
      }
      for (const dims of scalarOutputCounts.values()) {
        if (dims.length > 0 && dims.every((d) => d > 0)) return dims;
      }
    }
    // Fallback to Salsa symbol table for user-defined functions with symbolic output dimensions
    // (e.g. `output Real y[size(u, 1), n]` evaluated by substituting actual call-site argument shapes/values)
    if (db) {
      const cleanFnName = fnName.includes(".") ? fnName.split(".").pop()! : fnName;
      const fnSyms = db.byName(cleanFnName).filter((s: any) => s.kind === "Function" || s.kind === "Class");
      for (const fnSym of fnSyms) {
        const children = db.childrenOf(fnSym.id) || [];
        for (const c of children) {
          if (c.kind === "Component" && (db as QueryDB).query("causality", c.id) === "output") {
            const rawDims = (db as QueryDB).query<any>("arrayDimensions", c.id);
            const dims = normalizeDims(rawDims);
            if (dims) {
              return dims;
            }
            if (rawDims && Array.isArray(rawDims)) {
              const inputs = children.filter(
                (ch: any) => ch.kind === "Component" && (db as QueryDB).query("causality", ch.id) === "input",
              );
              const resolved: number[] = [];
              let allResolved = true;
              for (const rd of rawDims) {
                const norm = normalizeDims([rd]);
                if (norm && norm[0]! > 0) {
                  resolved.push(norm[0]!);
                  continue;
                }
                const dimText = rd?.text?.trim();
                if (dimText) {
                  const inputIdx = inputs.findIndex((inp: any) => inp.name === dimText);
                  if (inputIdx >= 0) {
                    const argExprId = inputIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + inputIdx);
                    const evalVal = evalDaeExpr(argExprId, dae);
                    if (typeof evalVal === "number" && evalVal > 0) {
                      resolved.push(Math.round(evalVal));
                      continue;
                    }
                  }
                  let subDimText = dimText;
                  for (let iIdx = 0; iIdx < inputs.length; iIdx++) {
                    const inpName = inputs[iIdx]!.name as string;
                    const argExprId = iIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + iIdx);
                    if (subDimText.includes(`size(${inpName}`)) {
                      const argDims = getExprDims(argExprId, dae, db, flattener);
                      if (argDims && argDims.length > 0) {
                        subDimText = subDimText.replace(
                          new RegExp(`size\\(\\s*${inpName}\\s*(?:,\\s*(\\d+))?\\s*\\)`, "g"),
                          (_m: string, dStr?: string) => {
                            const k = dStr ? parseInt(dStr, 10) : 1;
                            return k >= 1 && k <= argDims.length && argDims[k - 1]! > 0 ? String(argDims[k - 1]) : _m;
                          },
                        );
                      }
                    }
                    if (new RegExp(`\\b${inpName}\\b`).test(subDimText)) {
                      const evalVal = evalDaeExpr(argExprId, dae);
                      if (typeof evalVal === "number") {
                        subDimText = subDimText.replace(new RegExp(`\\b${inpName}\\b`, "g"), String(evalVal));
                      }
                    }
                  }
                  subDimText = subDimText.replace(
                    /\(\s*if\s+([+-]?\d+(?:\.\d+)?)\s*(>=|<=|<>|==|>|<)\s*([+-]?\d+(?:\.\d+)?)\s+then\s+([^)]+?)\s+else\s+([^)]+?)\s*\)/g,
                    (_m: string, lhsS: string, opS: string, rhsS: string, thenS: string, elseS: string) => {
                      const l = Number(lhsS);
                      const r = Number(rhsS);
                      const cond =
                        opS === ">"
                          ? l > r
                          : opS === ">="
                            ? l >= r
                            : opS === "<"
                              ? l < r
                              : opS === "<="
                                ? l <= r
                                : opS === "=="
                                  ? l === r
                                  : l !== r;
                      return cond ? thenS.trim() : elseS.trim();
                    },
                  );
                  const evalDim = evaluateCSTNumber(subDimText, undefined, undefined, db, dae);
                  if (typeof evalDim === "number" && evalDim > 0) {
                    resolved.push(Math.round(evalDim));
                    continue;
                  }
                }
                allResolved = false;
                break;
              }
              if (allResolved && resolved.length === rawDims.length) {
                return resolved;
              }
            }
          }
        }
      }
    }
  }

  // ── Case 8: Subscripted expression `base[s1, s2, ...]` (ExprKind.Subscript) ──
  // Scalar subscripts collapse their corresponding axis, whereas full-slice `:`,
  // array index vectors `{i1, i2}`, and ranges `start:step:stop` preserve an axis
  // with the slice's length, followed by any trailing unindexed dimensions of `base`.
  if (kind === ExprKind.Subscript) {
    const baseId = dae.getExprData1(exprId);
    const subCount = dae.getExprRight(exprId);
    if (subCount === 1 && dae.getExprKind(baseId) === ExprKind.Call) {
      const fnName = dae.interner.resolve(dae.getExprData1(baseId));
      const fnObj =
        dae.getFunction?.(fnName) ??
        (flattener?.currentPrefix ? dae.getFunction?.(`${flattener.currentPrefix}.${fnName}`) : undefined);
      let outCount = 0;
      if (fnObj) {
        for (let vi = 0; vi < fnObj.varCount; vi++) {
          if (fnObj.getVarCausality(vi) === Causality.Output) outCount++;
        }
      } else if (db && fnName) {
        const cleanFnName = fnName.includes(".") ? fnName.split(".").pop()! : fnName;
        const fnSym = db.byName(cleanFnName).find((s: any) => s.kind === "Function" || s.kind === "Class");
        if (fnSym) {
          outCount = (db.childrenOf(fnSym.id) || []).filter(
            (c: any) => c.kind === "Component" && (db as QueryDB).query("causality", c.id) === "output",
          ).length;
        }
      }
      if (outCount > 1) {
        return getExprDims(baseId, dae, db, flattener);
      }
    }
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

/**
 * Evaluates a DAE arena expression tree (`exprId`) at compile/flattening time
 * into a concrete JavaScript primitive (`number`, `boolean`, `string`) or
 * nested multi-dimensional array, or returns `null` if the expression depends
 * on runtime variables or cannot be folded statically.
 *
 * Cycle-safe via `visitedExprs` and `visitedVars` sets to guard against
 * mutually recursive parameter/constant bindings.
 *
 * @param exprId - Arena expression ID to evaluate.
 * @param dae - Target `DAEBuilder` arena containing expressions and declared variables.
 * @param visitedExprs - Optional recursion guard set for arena expression IDs.
 * @param visitedVars - Optional recursion guard set for DAE variable indices.
 * @returns Evaluated scalar (`number | boolean | string`), nested array, or `null`.
 */
export function evalDaeExpr(
  exprId: number,
  dae: DAEBuilder,
  visitedExprs?: Set<number>,
  visitedVars?: Set<number>,
): any {
  if (exprId < 0) return null;
  // Guard against cyclic expression graphs in the arena
  if (!visitedExprs) visitedExprs = new Set<number>();
  if (visitedExprs.has(exprId)) return null;
  visitedExprs.add(exprId);
  try {
    const kind = dae.getExprKind(exprId);
    switch (kind) {
      // ── Primitive scalar literals ──
      case ExprKind.IntLiteral:
        return dae.getExprData1(exprId);
      case ExprKind.RealLiteral:
        return dae.getExprRealValue(exprId);
      case ExprKind.BoolLiteral:
        return dae.getExprData1(exprId) !== 0;
      case ExprKind.EnumLiteral:
        return dae.getExprData1(exprId);

      // ── Variable / constant / parameter reference resolution ──
      case ExprKind.Name: {
        const name = dae.interner.resolve(dae.getExprData1(exprId));
        if (!name) return null;
        if (name === "true") return true;
        if (name === "false") return false;
        // 1. Direct scalar variable lookup in DAEBuilder
        const varIdx = dae.lookupVariable(name);
        if (varIdx >= 0) {
          if (!visitedVars) visitedVars = new Set<number>();
          if (visitedVars.has(varIdx)) return null;
          visitedVars.add(varIdx);
          try {
            const v = dae.getVarVariability(varIdx);
            const isRecConst = Boolean((dae as any)._recordConstVarIndices?.has(varIdx));
            // Only constants and parameters can be folded at compile time
            if (v === Variability.Constant || v === Variability.Parameter || isRecConst) {
              const bindingId = dae.getVarExpression(varIdx);
              if (bindingId !== undefined && bindingId >= 0 && bindingId !== exprId) {
                return evalDaeExpr(bindingId, dae, visitedExprs, visitedVars);
              }
              // Fallback to explicit `start` attribute if no direct binding expression exists
              const startAttr = dae.getVarAttr(varIdx, "start");
              if (startAttr === undefined || startAttr < 0) {
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
        // 1b. Subscripted reference `arr[i]` where `arr` is an unexpanded array variable in DAEBuilder
        if (name.includes("[") && name.endsWith("]")) {
          const baseName = name.slice(0, name.indexOf("["));
          const baseIdx = dae.lookupVariable(baseName);
          if (baseIdx >= 0) {
            const v = dae.getVarVariability(baseIdx);
            const isRecConst = Boolean((dae as any)._recordConstVarIndices?.has(baseIdx));
            if (v === Variability.Constant || v === Variability.Parameter || isRecConst) {
              const bindingId = dae.getVarExpression(baseIdx);
              if (bindingId !== undefined && bindingId >= 0 && bindingId !== exprId) {
                const baseVal = evalDaeExpr(bindingId, dae, visitedExprs, visitedVars);
                if (Array.isArray(baseVal)) {
                  const subIndices = name
                    .slice(name.indexOf("[") + 1, -1)
                    .split(",")
                    .map((s) => parseInt(s.trim(), 10));
                  let cur: any = baseVal;
                  for (const idx of subIndices) {
                    if (Array.isArray(cur) && idx >= 1 && idx <= cur.length) {
                      cur = cur[idx - 1];
                    } else {
                      cur = null;
                      break;
                    }
                  }
                  if (cur !== null && cur !== undefined) return cur;
                }
              }
            }
          }
        }
        // 2. Expanded array variable in DAE: gather scalarized elements `name[1]..name[N]`
        // and reshape flat row-major values back into nested N-dimensional arrays
        const state = getFlatteningState(dae);
        const arrShape = getNamedArrayShape(dae, name);
        if (arrShape && arrShape.some((d) => d === 0)) {
          return [];
        }
        if (dae.hasArrayElements(name)) {
          const elemIndices = dae.getArrayElementIndices(name);
          if (elemIndices.length > 0) {
            const elemVals: any[] = [];
            for (const idx of elemIndices) {
              if (!visitedVars) visitedVars = new Set<number>();
              if (visitedVars.has(idx)) return null;
              visitedVars.add(idx);
              try {
                const v = dae.getVarVariability(idx);
                if (v !== Variability.Constant && v !== Variability.Parameter) return null;
                const bId = dae.getVarExpression(idx);
                let val: any = null;
                if (bId !== undefined && bId >= 0) {
                  val = evalDaeExpr(bId, dae, visitedExprs, visitedVars);
                } else {
                  const startAttr = dae.getVarAttr(idx, "start");
                  if (startAttr !== undefined && startAttr >= 0) {
                    const startVal = dae.getVarStartValue(idx);
                    val = dae.getVarType(idx) === VarType.Boolean ? startVal !== 0 : startVal;
                  }
                }
                if (val === null) return null;
                elemVals.push(val);
              } finally {
                visitedVars.delete(idx);
              }
            }
            // Reshape flat element vector into nested tensor matching `arrShape` from innermost to outermost axis
            if (arrShape && arrShape.length > 1) {
              let reshaped: any[] = elemVals;
              for (let d = arrShape.length - 1; d >= 1; d--) {
                const dimLen = arrShape[d]!;
                if (dimLen <= 0) break;
                const next: any[] = [];
                for (let i = 0; i < reshaped.length; i += dimLen) {
                  next.push(reshaped.slice(i, i + dimLen));
                }
                reshaped = next;
              }
              return reshaped;
            }
            return elemVals;
          }
        }
        // 3. Fallback to Salsa symbol table (`componentInstance` / `effectiveModification`)
        // for package constants or parameters not yet materialized in the local DAE arena
        {
          const flat = state.flattener;
          const db = state.db ?? flat?.db;
          const scopeIds = [
            (dae as any).enclosingScopeId,
            flat?.currentClassId,
            state.currentClassId,
            (dae as any).symId ? db?.symbol((dae as any).symId)?.parentId : null,
          ];
          const scopeId = scopeIds.find((id) => id != null) ?? null;
          if (db) {
            const simpleName = name.includes(".") ? name.split(".").pop()! : name;
            const prefixPart = name.includes(".") ? name.split(".").slice(0, -1).join(".") : "";
            const candidates: any[] = [];
            for (const sId of scopeIds) {
              if (!sId) continue;
              const parentChild =
                db.childrenOf(sId)?.find((c: any) => c.name === simpleName && c.kind === "Component") ??
                db.query("resolveSimpleName", sId)?.(simpleName);
              if (parentChild && parentChild.kind === "Component" && !candidates.includes(parentChild)) {
                candidates.push(parentChild);
              }
            }
            if (candidates.length === 0) {
              const byNameCands = db.byName(simpleName);
              if (byNameCands && byNameCands.length <= 32) {
                for (const c of byNameCands) {
                  if (c.kind === "Component") candidates.push(c);
                }
              }
            }
            for (const cand of candidates) {
              const v = (cand.metadata as any)?.variability ?? db.query("variability", cand.id);
              if (v === "constant" || v === "parameter") {
                const compInst: any = db.query("componentInstance", cand.id);
                const compMod: any = db.query("effectiveModification", cand.id);
                const bExpr =
                  compInst?.bindingExpression ?? compInst?.modification?.value ?? compMod?.bindingExpression;
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
                  if (bText !== simpleName && bText !== name) {
                    const evalVal = evaluateCSTNumber(bText, undefined, cand.parentId ?? scopeId, db, dae, prefixPart);
                    if (evalVal !== null) return evalVal;
                  }
                }
              }
            }
          }
        }
        return null;
      }

      // ── Unary and derivative operators ──
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
        // The time derivative of any constant/parameter expression is identically 0.0
        const inner = evalDaeExpr(dae.getExprData1(exprId), dae, visitedExprs, visitedVars);
        if (typeof inner === "number") return 0.0;
        return null;
      }

      // ── Binary arithmetic, relational, logical, and string operators ──
      case ExprKind.Binary: {
        const op = dae.getExprData1(exprId);
        const left = evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars);
        const right = evalDaeExpr(dae.getExprRight(exprId), dae, visitedExprs, visitedVars);
        if (left === null || right === null) {
          // Special case: equality/inequality comparison between two qualified enumeration literals
          // (e.g. `State.Off == State.On`) which do not evaluate to numeric values via `evalDaeExpr`
          if (op === BinOp.Eq || op === BinOp.Neq) {
            const resolveEnumName = (id: number, depth = 0): string | null => {
              if (id < 0 || depth > 8 || dae.getExprKind(id) !== ExprKind.Name) return null;
              const n = dae.interner.resolve(dae.getExprData1(id));
              if (!n) return null;
              const vIdx = dae.lookupVariable(n);
              if (vIdx >= 0) {
                const v = dae.getVarVariability(vIdx);
                if (
                  (v === Variability.Constant || v === Variability.Parameter) &&
                  dae.getVarType(vIdx) === VarType.Enumeration
                ) {
                  const bId = dae.getVarExpression(vIdx);
                  if (bId !== undefined && bId >= 0 && bId !== id) {
                    return resolveEnumName(bId, depth + 1);
                  }
                }
                return null;
              }
              return n.includes(".") ? n : null;
            };
            const lEnum = resolveEnumName(dae.getExprLeft(exprId));
            const rEnum = resolveEnumName(dae.getExprRight(exprId));
            if (lEnum && rEnum) {
              const lPre = lEnum.slice(0, lEnum.lastIndexOf("."));
              const rPre = rEnum.slice(0, rEnum.lastIndexOf("."));
              if (lPre && lPre === rPre) {
                return op === BinOp.Eq ? lEnum === rEnum : lEnum !== rEnum;
              }
            }
          }
          return null;
        }
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
        } else if (Array.isArray(left) && typeof right === "number" && op === BinOp.Div && right !== 0) {
          if (left.every((x) => typeof x === "number")) {
            return left.map((x: number) => x / right);
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

      // ── Array constructor `{e1, e2, ...}` ──
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

      // ── Built-in and mathematical function calls ──
      case ExprKind.Call: {
        const fnNameId = dae.getExprData1(exprId);
        const fnName = dae.interner.resolve(fnNameId);
        if (!fnName) return null;
        const cleanFn = fnName.split(".").pop() ?? fnName;
        const argCount = dae.getExprRight(exprId);
        const firstArg = dae.getExprLeft(exprId);

        // `size(A)` -> shape vector; `size(A, dim)` -> 1-based dimension length
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
              return dims.every((d) => d >= 0) ? dims : null;
            }
            const dimArgId = dae.getExprLeft(exprId + 1);
            const dimVal = evalDaeExpr(dimArgId, dae, visitedExprs, visitedVars);
            if (typeof dimVal === "number" && dimVal >= 1 && dimVal <= dims.length) {
              const d = dims[dimVal - 1]!;
              return d >= 0 ? d : null;
            }
          }
          return null;
        }

        // Single-argument array reductions `max(A)` / `min(A)`
        if ((cleanFn === "max" || cleanFn === "min") && argCount === 1) {
          const arrVal = evalDaeExpr(firstArg, dae, visitedExprs, visitedVars);
          if (Array.isArray(arrVal)) {
            const flat = arrVal.flat(Infinity);
            if (flat.length > 0) {
              if (flat.every((x) => typeof x === "number")) {
                return cleanFn === "max" ? Math.max(...flat) : Math.min(...flat);
              }
              if (flat.every((x) => typeof x === "boolean")) {
                return cleanFn === "max" ? flat.some(Boolean) : flat.every(Boolean);
              }
            } else {
              // Empty Boolean array reduction: min(empty) = true, max(empty) = false
              if (dae.getExprKind(firstArg) === ExprKind.Name) {
                const arrName = dae.interner.resolve(dae.getExprData1(firstArg));
                const arrTypes: Map<string, number> | undefined = (dae as any).namedArrayTypes;
                if (arrName && arrTypes?.get(arrName) === VarType.Boolean) {
                  return cleanFn === "min";
                }
              }
            }
          }
          return null;
        }

        // Single-argument array reductions `sum(A)` / `product(A)`
        if ((cleanFn === "sum" || cleanFn === "product") && argCount === 1) {
          const arrVal = evalDaeExpr(firstArg, dae, visitedExprs, visitedVars);
          if (Array.isArray(arrVal)) {
            const flat = arrVal.flat(Infinity);
            if (flat.length === 0) {
              return cleanFn === "sum" ? 0 : 1;
            }
            if (flat.every((x) => typeof x === "number")) {
              return cleanFn === "sum" ? flat.reduce((a, b) => a + b, 0) : flat.reduce((a, b) => a * b, 1);
            }
          }
          return null;
        }

        if (cleanFn === "noEvent" && argCount === 1) {
          if (exprReferencesRuntimeParameter(firstArg, dae)) return null;
          return evalDaeExpr(firstArg, dae, visitedExprs, visitedVars);
        }

        // Overconstrained connection graph queries: `Connections.isRoot(c)` and `Connections.rooted(c)`
        if ((fnName === "Connections.isRoot" || cleanFn === "isRoot") && argCount === 1) {
          if (dae.getExprKind(firstArg) === ExprKind.Name) {
            const connName = dae.interner.resolve(dae.getExprData1(firstArg));
            const graph = (dae as any).extensionMetadata?.overconstrainedGraph;
            if (connName && graph) {
              if (graph.selectedRoots instanceof Set) {
                return graph.selectedRoots.has(connName);
              }
              if (graph.roots instanceof Set && graph.roots.has(connName)) {
                return true;
              }
            }
          }
          return null;
        }

        if ((fnName === "Connections.rooted" || fnName === "rooted" || cleanFn === "rooted") && argCount === 1) {
          if (dae.getExprKind(firstArg) === ExprKind.Name) {
            const connName = dae.interner.resolve(dae.getExprData1(firstArg));
            const graph = (dae as any).extensionMetadata?.overconstrainedGraph;
            if (connName && graph?.rootedMap instanceof Map && graph.rootedMap.has(connName)) {
              return graph.rootedMap.get(connName)!;
            }
          }
          return null;
        }

        // Evaluate all call arguments before dispatching scalar/array built-in functions
        const args: any[] = [];
        for (let i = 0; i < argCount; i++) {
          const aId = i === 0 ? firstArg : dae.getExprLeft(exprId + i);
          const aVal = evalDaeExpr(aId, dae, visitedExprs, visitedVars);
          if (aVal === null) return null;
          args.push(aVal);
        }
        if (cleanFn.startsWith("/*Real[") || cleanFn === "/*Real*/" || cleanFn === "Real") {
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
        if (cleanFn === "max" && args.length >= 2) {
          if (args.every((a) => typeof a === "number")) return Math.max(...args);
          if (args.every((a) => typeof a === "boolean")) return args.some(Boolean);
        }
        if (cleanFn === "min" && args.length >= 2) {
          if (args.every((a) => typeof a === "number")) return Math.min(...args);
          if (args.every((a) => typeof a === "boolean")) return args.every(Boolean);
        }
        if (cleanFn === "homotopy" && args.length >= 1) {
          return args[0];
        }
        if (cleanFn === "smooth" && args.length >= 2) {
          return args[1];
        }
        if (cleanFn === "semiLinear" && args.length === 3) {
          const evalSemi = (x: any, kPos: any, kNeg: any): any => {
            if (typeof x === "number" && typeof kPos === "number" && typeof kNeg === "number") {
              return x >= 0 ? kPos * x : kNeg * x;
            }
            if (Array.isArray(x)) {
              return x.map((xi, idx) =>
                evalSemi(xi, Array.isArray(kPos) ? kPos[idx] : kPos, Array.isArray(kNeg) ? kNeg[idx] : kNeg),
              );
            }
            return null;
          };
          return evalSemi(args[0], args[1], args[2]);
        }
        if (cleanFn === "outerProduct" && args.length === 2 && Array.isArray(args[0]) && Array.isArray(args[1])) {
          if (args[0].every((x: any) => typeof x === "number") && args[1].every((y: any) => typeof y === "number")) {
            return args[0].map((x: number) => args[1].map((y: number) => x * y));
          }
        }
        if (cleanFn === "to_unit1" && args.length === 1 && args[0] !== null) {
          return args[0];
        }
        if (cleanFn === "fill" && args.length >= 2) {
          const dims = args.slice(1);
          if (dims.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 1000)) {
            const buildFill = (dimIdx: number): any => {
              if (dimIdx >= dims.length) return args[0];
              const len = dims[dimIdx] as number;
              const arr: any[] = [];
              for (let i = 0; i < len; i++) {
                arr.push(buildFill(dimIdx + 1));
              }
              return arr;
            };
            return buildFill(0);
          }
        }
        if (
          cleanFn === "length" &&
          args.length === 1 &&
          Array.isArray(args[0]) &&
          args[0].every((x: any) => typeof x === "number")
        ) {
          return Math.sqrt(args[0].reduce((s: number, x: number) => s + x * x, 0));
        }
        if (
          (cleanFn === "normalizeWithAssert" || cleanFn === "normalize") &&
          args.length >= 1 &&
          Array.isArray(args[0]) &&
          args[0].every((x: any) => typeof x === "number")
        ) {
          const norm = Math.sqrt(args[0].reduce((s: number, x: number) => s + x * x, 0));
          return norm > 0 ? args[0].map((x: number) => x / norm) : args[0];
        }
        const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(cleanFn);
        if (scalarBuiltin?.fold && args.every((a) => typeof a === "number")) {
          return scalarBuiltin.fold(...args);
        }
        return null;
      }

      // ── Conditional expression `if cond then thenBranch else elseBranch` ──
      case ExprKind.IfElse: {
        const condVal = evalDaeExpr(dae.getExprData1(exprId), dae, visitedExprs, visitedVars);
        if (typeof condVal === "boolean") {
          return condVal
            ? evalDaeExpr(dae.getExprLeft(exprId), dae, visitedExprs, visitedVars)
            : evalDaeExpr(dae.getExprRight(exprId), dae, visitedExprs, visitedVars);
        }
        return null;
      }

      // ── 1-based multi-dimensional array subscripting `base[i, j, ...]` ──
      case ExprKind.Subscript: {
        const baseVal = evalDaeExpr(dae.getExprData1(exprId), dae, visitedExprs, visitedVars);
        if (!Array.isArray(baseVal)) return null;
        const subCount = dae.getExprRight(exprId);
        let curr: any = baseVal;
        for (let i = 0; i < subCount; i++) {
          if (!Array.isArray(curr)) return null;
          const subExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          const subVal = evalDaeExpr(subExprId, dae, visitedExprs, visitedVars);
          if (typeof subVal === "number" && Number.isInteger(subVal)) {
            const idx = subVal - 1;
            if (idx >= 0 && idx < curr.length) {
              curr = curr[idx];
            } else {
              return null;
            }
          } else {
            return null;
          }
        }
        return curr;
      }
      default:
        return null;
    }
  } finally {
    visitedExprs.delete(exprId);
  }
}

/**
 * Convenience wrapper around {@link evalDaeExpr} that returns a finite numeric
 * constant value for `id`, or `null` if the expression is non-numeric or not
 * statically evaluable.
 *
 * @param id - Arena expression ID to evaluate.
 * @param dae - Target `DAEBuilder` arena.
 * @param visited - Optional recursion guard set of visited expression IDs.
 * @returns Finite `number` value, or `null`.
 */
export function getConstVal(id: number, dae: DAEBuilder, visited?: Set<number>): number | null {
  const val = evalDaeExpr(id, dae, visited);
  return typeof val === "number" && !isNaN(val) ? val : null;
}

/**
 * Materializes a constant-evaluated JavaScript value (`number`, `boolean`,
 * `string`, or nested array) back into `DAEBuilder` linear memory as an arena
 * expression node (`IntLiteral`, `RealLiteral`, `BoolLiteral`, `StringLiteral`,
 * or nested `ArrayCtor`).
 *
 * @param dae - Target `DAEBuilder` arena.
 * @param value - Evaluated constant scalar or nested array value.
 * @param expectedType - Optional expected `VarType` to disambiguate `Real` vs `Integer` numbers.
 * @returns Newly allocated arena expression ID, or `-1` if `value` cannot be represented.
 */
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

/**
 * Recursively checks whether a DAE arena expression subtree contains any
 * `ExprKind.Name` symbolic reference node.
 *
 * @param exprId - Root arena expression ID to inspect.
 * @param dae - Target `DAEBuilder` arena.
 * @param visited - Cycle-detection set of already-visited expression IDs.
 * @returns `true` if any sub-expression is an `ExprKind.Name` node.
 */
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

/**
 * Recursively checks whether a DAE arena expression subtree references any
 * non-constant symbol (such as runtime variables, parameters, `time`, `der()`,
 * or `pre()`).
 *
 * Used to determine whether an expression is strictly a compile-time constant
 * (`Variability.Constant`) that can be eagerly folded into a literal.
 * Note that `size()` and `ndims()` calls are treated as constant since array
 * dimensions are structural in Modelica.
 *
 * @param exprId - Root arena expression ID to inspect.
 * @param dae - Target `DAEBuilder` arena.
 * @param visited - Cycle-detection set of already-visited expression IDs.
 * @returns `true` if `exprId` depends on any non-constant reference.
 */
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
    if (dae.classKind === "function") {
      const state = getFlatteningState(dae);
      const flat = state.flattener;
      const db = state.db ?? flat?.db;
      const scopeId =
        (dae as any).enclosingScopeId ??
        ((dae as any).symId ? db?.symbol((dae as any).symId)?.parentId : null) ??
        flat?.currentClassId;
      if (scopeId && db) {
        const parentChild = db.childrenOf(scopeId)?.find((c: any) => c.name === name && c.kind === "Component");
        if (parentChild) {
          const v = (parentChild.metadata as any)?.variability ?? db.query("variability", parentChild.id);
          if (v === "constant" || v === "parameter") {
            return false;
          }
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
