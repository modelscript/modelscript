// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Compile-time constant & parameter expression evaluator over {@link DAEBuilder}
 * linear-memory arenas and optional Salsa {@link QueryDB} workspace queries.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "../runtime.js";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";
import { evaluateArrayBuiltin, isArenaObject, type ArenaObjectValue, type ArenaValue } from "./wasm_evaluator.js";
import {
  evalMathBuiltin,
  evalMatrixPow,
  isArenaComplexValue,
  lookupRecordFunctionInDae,
  toArenaComplexValue,
  type ArenaConstantValue,
  type ArenaFoldParamLookup,
  type DAEBuilderFoldExtensions,
} from "./wasm_fold_helpers.js";
import { evaluateArenaFunctionCall } from "./wasm_statement_executor.js";

interface ExtendsModValueLike {
  value?: unknown;
  text?: string;
}

interface ExtendsModArg {
  isBreak?: boolean;
  name?: string;
  nestedArgs?: ExtendsModArg[];
  args?: ExtendsModArg[];
  value?: number | boolean | string | ExtendsModValueLike | null;
  bindingExpression?: number | boolean | string | ExtendsModValueLike | null;
}

type ExtendsModRaw = ExtendsModArg[] | { args?: ExtendsModArg[] } | null | undefined;

interface EffectiveModResult {
  bindingExpression?: string | { text?: string } | null;
}

interface ComponentInstResult {
  bindingExpression?: { text?: string } | null;
}

interface CstNodeTextLike {
  text?: string;
}

interface SymbolMetadataLike {
  literals?: unknown;
  variability?: string;
  isEnumeration?: boolean;
  lasValue?: unknown;
  csvValue?: unknown;
}

function makeZeroArray(arr: ArenaConstantValue[]): ArenaConstantValue[] {
  return arr.map((item) => (Array.isArray(item) ? makeZeroArray(item) : 0.0));
}

function evalElemBinOp(
  op: BinOp,
  a: ArenaConstantValue | undefined,
  b: ArenaConstantValue | undefined,
): ArenaConstantValue | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: ArenaConstantValue[] = [];
    for (let i = 0; i < a.length; i++) {
      const elem = evalElemBinOp(op, a[i], b[i]);
      if (elem === null) return null;
      out.push(elem);
    }
    return out;
  }
  if (Array.isArray(a) && typeof b === "number") {
    const out: ArenaConstantValue[] = [];
    for (let i = 0; i < a.length; i++) {
      const elem = evalElemBinOp(op, a[i], b);
      if (elem === null) return null;
      out.push(elem);
    }
    return out;
  }
  if (typeof a === "number" && Array.isArray(b)) {
    const out: ArenaConstantValue[] = [];
    for (let i = 0; i < b.length; i++) {
      const elem = evalElemBinOp(op, a, b[i]);
      if (elem === null) return null;
      out.push(elem);
    }
    return out;
  }
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case BinOp.Add:
      case BinOp.ElemAdd:
        return a + b;
      case BinOp.Sub:
      case BinOp.ElemSub:
        return a - b;
      case BinOp.Mul:
      case BinOp.ElemMul:
        return a * b;
      case BinOp.Div:
      case BinOp.ElemDiv:
        return b !== 0 ? a / b : null;
      case BinOp.ElemPow:
        return Math.pow(a, b);
    }
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    if (op === BinOp.And) return a && b;
    if (op === BinOp.Or) return a || b;
  }
  return null;
}

function modelicaHashString(str: string): number {
  let h = 0xaaaaaaaa >>> 0;
  for (let i = 0; i < str.length; i++) {
    const b = str.charCodeAt(i) & 0xff;
    if ((i & 1) === 0) {
      h = (h ^ (((h << 7) ^ Math.imul(b, h >>> 3)) >>> 0)) >>> 0;
    } else {
      h = (h ^ ~(((h << 11) + (b ^ (h >>> 5))) >>> 0)) >>> 0;
    }
  }
  return h | 0;
}

function splitDotsOutsideBrackets(s: string): string[] {
  const res: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "." && depth === 0) {
      res.push(s.slice(start, i));
      start = i + 1;
    }
  }
  res.push(s.slice(start));
  return res;
}

/**
 * Resolves a constant or parameter reference through the Salsa `QueryDB` when the symbol
 * is not directly present in the flattened `arena` (e.g., package constants, `extends`
 * modification overrides, or subscripted record/component chains).
 */
function evaluateDbConstantRef(
  db: QueryDB,
  rawName: string,
  scopeId: SymbolId,
  onlyConstants: boolean,
  visited = new Set<string>(),
): ArenaConstantValue | null {
  const varName = rawName.trim();
  if (!varName || visited.size > 32) return null;
  const visitKey = `${scopeId}:${varName}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);

  // Parses literal numbers, booleans, well-known `Modelica.Constants` / `ModelicaServices.Machine`
  // expressions, brace array literals `{...}`, or recursively resolves symbolic references.
  const parseScalarOrArrayText = (text: string, evalScopeId: SymbolId): ArenaConstantValue | null => {
    const t = text.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
      return Number(t);
    }
    const clean = t.replace(/\s+/g, "");
    if (
      clean === "2*Modelica.Math.asin(1.0)" ||
      clean === "2*Modelica.Math.asin(1)" ||
      clean === "2*Math.asin(1.0)" ||
      clean === "2*Math.asin(1)" ||
      clean === "2*asin(1.0)" ||
      clean === "2*asin(1)" ||
      clean === "2.0*Modelica.Math.asin(1.0)"
    ) {
      return Math.PI;
    }
    if (
      clean === "Modelica.Math.exp(1.0)" ||
      clean === "Modelica.Math.exp(1)" ||
      clean === "Math.exp(1.0)" ||
      clean === "Math.exp(1)" ||
      clean === "exp(1.0)" ||
      clean === "exp(1)"
    ) {
      return Math.E;
    }
    if (clean === "pi/180" || clean === "pi/180.0" || clean === "Modelica.Constants.pi/180") {
      return Math.PI / 180;
    }
    if (clean === "180/pi" || clean === "180.0/pi" || clean === "180/Modelica.Constants.pi") {
      return 180 / Math.PI;
    }
    if (clean === "ModelicaServices.Machine.eps") return Number.EPSILON;
    if (clean === "ModelicaServices.Machine.small") return Number.MIN_VALUE;
    if (clean === "ModelicaServices.Machine.inf") return 1e60;
    if (clean === "ModelicaServices.Machine.Integer_inf") return 2147483647;
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1).trim();
      if (!inner) return [];
      const parts = inner.split(",");
      const arr: ArenaConstantValue[] = [];
      for (const p of parts) {
        const v = parseScalarOrArrayText(p, evalScopeId);
        if (v === null) return null;
        arr.push(v);
      }
      return arr;
    }
    return evaluateDbConstantRef(db, t, evalScopeId, onlyConstants, visited);
  };

  // 1. Check extends modification overrides on scopeId (e.g. const15: extends A(B(i = 4)))
  const topDots = !varName.startsWith(".") ? splitDotsOutsideBrackets(varName) : [];
  if (topDots.length > 1) {
    const parts = topDots;
    const findInExtendsMods = (currScope: SymbolId, depth: number): ArenaConstantValue | null => {
      if (depth > 8) return null;
      const children = db.childrenOf(currScope) || [];
      for (const child of children) {
        if (child.kind !== "Extends") continue;
        const extModRaw = db.query<ExtendsModRaw>("extendsModificationParsed", child.id);
        let currArgs: ExtendsModArg[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
        let matchedArg: ExtendsModArg | undefined;
        for (let i = 0; i < parts.length; i++) {
          const seg = parts[i]!.replace(/\[.*\]$/, "");
          matchedArg = currArgs.find((a) => a && !a.isBreak && a.name === seg);
          if (!matchedArg) break;
          if (i < parts.length - 1) {
            currArgs = matchedArg.nestedArgs ?? matchedArg.args ?? [];
          }
        }
        if (matchedArg) {
          const valObj = matchedArg.value ?? matchedArg.bindingExpression;
          if (valObj !== undefined && valObj !== null) {
            if (typeof valObj === "number" || typeof valObj === "boolean") return valObj;
            if (typeof valObj === "object") {
              if (typeof valObj.value === "number" || typeof valObj.value === "boolean") return valObj.value;
            }
            const valText = typeof valObj === "string" ? valObj : valObj.text;
            if (typeof valText === "string") {
              const parsed = parseScalarOrArrayText(valText, currScope);
              if (parsed !== null) return parsed;
            }
          }
        }
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (base && base.id !== currScope) {
          const fromBase = findInExtendsMods(base.id, depth + 1);
          if (fromBase !== null) return fromBase;
        }
      }
      return null;
    };
    const modOverride = findInExtendsMods(scopeId, 0);
    if (modOverride !== null) return modOverride;
  }

  // 2. Resolve name directly or via inherited base class scopes (e.g. const14, const16)
  let trailingSubscript: number | null = null;
  const resolveInScopeOrBase = (currScope: SymbolId, targetName: string, depth: number): SymbolEntry | null => {
    if (depth > 8) return null;
    const rn = db.query<(q: string) => SymbolEntry | null>("resolveName", currScope);
    if (rn) {
      const res = rn(targetName);
      if (res) return res;
    }
    const children = db.childrenOf(currScope) || [];
    for (const child of children) {
      if (child.kind === "Extends") {
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (base && base.id !== currScope) {
          const fromBase = resolveInScopeOrBase(base.id, targetName, depth + 1);
          if (fromBase) return fromBase;
        }
      }
    }
    return null;
  };

  let resolved = resolveInScopeOrBase(scopeId, varName, 0);

  // 3. Segment-by-segment resolution for subscripted/component chains (e.g. const12: A.m[1].i[2])
  if (!resolved && (varName.includes(".") || varName.includes("["))) {
    const cleanLead = varName.startsWith(".") ? varName.slice(1) : varName;
    const segments = splitDotsOutsideBrackets(cleanLead);
    let currScope: SymbolId | null = scopeId;
    let currSym: SymbolEntry | null = null;
    for (let i = 0; i < segments.length; i++) {
      const rawSeg = segments[i]!;
      const subMatch = /^([^[]+)\[([^\]]+)\]$/.exec(rawSeg);
      const segName = subMatch ? subMatch[1]! : rawSeg.replace(/\[.*\]$/, "");
      if (i === segments.length - 1 && subMatch) {
        const subRaw = subMatch[2]!.trim();
        if (/^\d+$/.test(subRaw)) {
          trailingSubscript = parseInt(subRaw, 10);
        } else if (subRaw === "false") {
          trailingSubscript = 1;
        } else if (subRaw === "true") {
          trailingSubscript = 2;
        } else if (subRaw.includes(".")) {
          const enumParts = subRaw.split(".");
          const litName = enumParts.pop()!;
          const enumName = enumParts.pop()!;
          const enumSyms = db.byName(enumName) || [];
          for (const es of enumSyms) {
            const lits = (es.metadata as SymbolMetadataLike | undefined)?.literals;
            if (Array.isArray(lits)) {
              const idx = lits.indexOf(litName);
              if (idx >= 0) {
                trailingSubscript = idx + 1;
                break;
              }
            }
            const cstText = (db.cstNode(es.id) as CstNodeTextLike | null | undefined)?.text ?? "";
            const m = /enumeration\s*\(([^)]+)\)/.exec(cstText);
            if (m) {
              const parsedLits = m[1]!.split(",").map((s) => s.trim().split(/\s+/)[0]);
              const idx = parsedLits.indexOf(litName);
              if (idx >= 0) {
                trailingSubscript = idx + 1;
                break;
              }
            }
          }
        }
      }
      let nextSym: SymbolEntry | null = null;
      if (i === 0) {
        if (currScope !== null) {
          nextSym = resolveInScopeOrBase(currScope, varName.startsWith(".") ? `.${segName}` : segName, 0);
        }
      } else if (currSym) {
        let targetClassId: SymbolId | null = null;
        if (currSym.kind === "Component") {
          targetClassId = db.query<SymbolId | null>("classInstance", currSym.id);
        } else {
          targetClassId = currSym.id;
        }
        if (targetClassId !== null) {
          const children: SymbolEntry[] = db.childrenOf(targetClassId) || [];
          nextSym = children.find((c: SymbolEntry) => c.name === segName) ?? null;
          if (!nextSym) {
            nextSym = resolveInScopeOrBase(targetClassId, segName, 0);
          }
        }
      }
      if (!nextSym) {
        currSym = null;
        break;
      }
      currSym = nextSym;
      currScope = nextSym.parentId;
    }
    if (currSym) {
      resolved = currSym;
    }
  }

  if (resolved && resolved.kind === "Component") {
    const meta = resolved.metadata as SymbolMetadataLike | undefined;
    if (meta) {
      const tabularValue = meta.lasValue ?? meta.csvValue;
      if (tabularValue !== undefined) {
        return tabularValue as ArenaConstantValue | null;
      }
    }
    const variability = meta?.variability ?? db.query<string | null>("variability", resolved.id);
    if (variability === "constant" || (!onlyConstants && variability === "parameter")) {
      const mod = db.query<EffectiveModResult | null>("effectiveModification", resolved.id);
      let bText: string | null =
        (typeof mod?.bindingExpression === "object" ? mod.bindingExpression?.text : undefined) ??
        (typeof mod?.bindingExpression === "string" ? mod.bindingExpression : null) ??
        null;
      if (!bText) {
        const compInst = db.query<ComponentInstResult | null>("componentInstance", resolved.id);
        bText = compInst?.bindingExpression?.text ?? null;
      }
      if (!bText) {
        const cst = db.cstNode(resolved.id) as CstNodeTextLike | null | undefined;
        const text: string = cst?.text ?? "";
        const eqIdx = text.indexOf("=");
        if (eqIdx >= 0 && text[eqIdx + 1] !== "=") {
          bText = text
            .slice(eqIdx + 1)
            .replace(/;$/, "")
            .trim();
        }
      }
      if (bText) {
        const evalScope = resolved.parentId ?? scopeId;
        const val = parseScalarOrArrayText(bText, evalScope);
        if (val !== null) {
          if (trailingSubscript !== null && Array.isArray(val)) {
            return val[trailingSubscript - 1] ?? null;
          }
          return val;
        }
      }
    }
  }

  return null;
}

/**
 * Evaluates a compile-time constant or parameter expression tree in a {@link DAEBuilder}
 * to a scalar (`number | boolean | string`), complex pair, record object, or nested array
 * value during constant folding.
 *
 * Enforces a recursion depth guard (`visitedDepth <= 100`) to prevent infinite loops on
 * cyclic bindings, resolves names against `paramMap`, arena variable declarations, and
 * Salsa `QueryDB` workspace symbols (including inherited `extends` modifications and
 * subscripted component chains via `evaluateDbConstantRef`), folds derivatives of constants
 * to `0.0`, and evaluates array constructors, subscripts, unary/binary operators (including
 * matrix exponentiation), `if`/`else` branches, and built-in/user-defined function calls.
 *
 * @param arena The DAE arena containing the expression node (`exprId`).
 * @param exprId The arena expression ID to fold (`0 <= exprId < arena.exprCount`).
 * @param paramMap Optional map of known constant/parameter values by variable name.
 * @param nameToIdx Optional fast lookup map from variable name to arena variable index.
 * @param visitedDepth Current recursion depth (aborts above `100`).
 * @param db Optional Salsa `QueryDB` for resolving workspace constants and inherited modifications.
 * @param scopeId Optional lexical scope symbol ID for `db` queries.
 * @param onlyConstants If `true`, restricts evaluation strictly to `Variability.Constant` symbols.
 * @returns The folded scalar or array constant, or `null` if the expression is non-constant.
 */
const activeBindVarsMap = new WeakMap<object, Set<number>>();

export function evaluateConstantArenaExpression(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: ArenaFoldParamLookup,
  nameToIdx?: Map<string, number>,
  visitedDepth = 0,
  db?: QueryDB,
  scopeId?: SymbolId,
  onlyConstants = false,
): ArenaConstantValue | null {
  if (exprId < 0 || exprId >= arena.exprCount || visitedDepth > 100) {
    return null;
  }

  const kind = arena.getExprKind(exprId);

  // --- 1. Scalar Literals ---
  if (kind === ExprKind.RealLiteral) {
    return arena.getExprRealValue(exprId);
  }

  if (kind === ExprKind.IntLiteral) {
    return arena.getExprData1(exprId);
  }

  if (kind === ExprKind.BoolLiteral) {
    return arena.getExprData1(exprId) !== 0;
  }

  if (kind === ExprKind.EnumLiteral) {
    return arena.getExprData1(exprId);
  }

  if (kind === ExprKind.StringLiteral) {
    return arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
  }

  // --- 1b. Zero-GC WASM scalar fast-path for pure arithmetic/logic/if-else/math trees ---
  if (
    visitedDepth === 0 &&
    !paramMap &&
    !db &&
    arena.ptr !== 0 &&
    (kind === ExprKind.Binary ||
      kind === ExprKind.Unary ||
      kind === ExprKind.Negate ||
      kind === ExprKind.IfElse ||
      kind === ExprKind.Call) &&
    (typeof process === "undefined" || process.env?.["MSX_WASM_FOLD"] !== "ts")
  ) {
    const exp = arena.exports as
      | {
          dae_evalConstantScalar?: (ptr: number, id: number, onlyConst: boolean) => number;
          dae_getLastEvalType?: () => number;
        }
      | undefined;
    if (typeof exp?.dae_evalConstantScalar === "function" && typeof exp?.dae_getLastEvalType === "function") {
      const val = exp.dae_evalConstantScalar(arena.ptr, exprId, onlyConstants);
      if (!Number.isNaN(val)) {
        const evalType = exp.dae_getLastEvalType();
        if (evalType === 2) return val !== 0;
        if (evalType === 1) return Math.trunc(val);
        if (evalType === 0) return val;
      }
    }
  }

  // --- 2. Variable & Component Name Resolution ---
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varName = arena.interner.resolve(nameId);
    if ((paramMap as { _shadowed?: ReadonlySet<string> } | undefined)?._shadowed?.has(varName)) {
      return null;
    }
    if (paramMap) {
      if (paramMap.has(varName)) {
        return paramMap.get(varName) ?? null;
      }
    }
    const varIdx = nameToIdx ? nameToIdx.get(varName) : arena.getVarIdxByName(varName);
    if (varIdx !== undefined && varIdx >= 0 && !arena.isVarRemoved(varIdx)) {
      const variability = arena.getVarVariability(varIdx);
      if (
        (onlyConstants && variability !== Variability.Constant) ||
        variability === Variability.Discrete ||
        (arena.getVarCausality(varIdx) === Causality.Input && !varName.includes("."))
      ) {
        return null;
      }
      if (
        variability === Variability.Parameter &&
        !arena.isVarFixed(varIdx) &&
        !arena.hasExplicitVarExpression(varIdx)
      ) {
        return null;
      }
      const bindExpr = arena.getVarExpression(varIdx);
      if (bindExpr !== undefined && bindExpr >= 0 && bindExpr !== exprId) {
        const scopeKey: object = paramMap ?? arena;
        let activeVars = activeBindVarsMap.get(scopeKey);
        if (!activeVars) {
          activeVars = new Set<number>();
          activeBindVarsMap.set(scopeKey, activeVars);
        }
        if (activeVars.has(varIdx)) {
          return null;
        }
        const bindMemo: Map<number, ArenaConstantValue> | undefined = !onlyConstants ? paramMap?._bindMemo : undefined;
        if (bindMemo && bindMemo.has(bindExpr)) {
          return bindMemo.get(bindExpr)!;
        }
        let val: ArenaConstantValue | null;
        activeVars.add(varIdx);
        try {
          val = evaluateConstantArenaExpression(
            arena,
            bindExpr,
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
            onlyConstants,
          );
        } finally {
          activeVars.delete(varIdx);
        }
        if (val !== null) {
          if (bindMemo) bindMemo.set(bindExpr, val);
          return val;
        }
      }
      if (
        variability !== Variability.Constant &&
        (onlyConstants || variability !== Variability.Parameter || (paramMap && !paramMap.has(varName)))
      ) {
        return null;
      }
      if (
        variability === Variability.Constant ||
        onlyConstants ||
        (variability === Variability.Parameter && !arena.isVarFixed(varIdx) && !arena.hasExplicitVarExpression(varIdx))
      ) {
        return null;
      }
      return arena.getVarStartValue(varIdx);
    }
    // Reassemble sliced array-of-records field references (`prefix[1].suffix`, `prefix[2].suffix`, ...).
    if (varName.includes(".")) {
      let dotPos = varName.indexOf(".");
      while (dotPos > 0) {
        const prefix = varName.slice(0, dotPos);
        const suffix = varName.slice(dotPos);
        const firstElemName = `${prefix}[1]${suffix}`;
        const firstIdx = nameToIdx ? nameToIdx.get(firstElemName) : arena.getVarIdxByName(firstElemName);
        if (firstIdx !== undefined && firstIdx >= 0 && !arena.isVarRemoved(firstIdx)) {
          const vals: ArenaConstantValue[] = [];
          let k = 1;
          let allValid = true;
          while (true) {
            const elemName = `${prefix}[${k}]${suffix}`;
            const elemIdx = nameToIdx ? nameToIdx.get(elemName) : arena.getVarIdxByName(elemName);
            if (elemIdx === undefined || elemIdx < 0 || arena.isVarRemoved(elemIdx)) break;
            const elemVar = arena.getVarVariability(elemIdx);
            if (
              elemVar !== Variability.Constant &&
              (onlyConstants || elemVar !== Variability.Parameter || (paramMap && !paramMap.has(elemName)))
            ) {
              allValid = false;
              break;
            }
            const elemBind = arena.getVarExpression(elemIdx);
            if (elemBind === undefined || elemBind < 0) {
              allValid = false;
              break;
            }
            const elemVal = evaluateConstantArenaExpression(
              arena,
              elemBind,
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (elemVal === null) {
              allValid = false;
              break;
            }
            vals.push(elemVal);
            k++;
          }
          if (allValid && vals.length > 0) {
            return vals;
          }
        }
        dotPos = varName.indexOf(".", dotPos + 1);
      }
    }
    if (varName === "Modelica.ComplexMath.j" || varName === "ComplexMath.j" || varName.endsWith(".ComplexMath.j")) {
      return { re: 0.0, im: 1.0 };
    }
    const reName = `${varName}.re`;
    const imName = `${varName}.im`;
    const reIdx = nameToIdx ? nameToIdx.get(reName) : arena.getVarIdxByName(reName);
    const imIdx = nameToIdx ? nameToIdx.get(imName) : arena.getVarIdxByName(imName);
    if (reIdx !== undefined && reIdx >= 0 && imIdx !== undefined && imIdx >= 0) {
      const evalField = (fName: string, fIdx: number): number | null => {
        if (paramMap && paramMap.has(fName)) {
          const pv = paramMap.get(fName);
          return typeof pv === "number" ? pv : null;
        }
        const fVar = arena.getVarVariability(fIdx);
        if (
          fVar !== Variability.Constant &&
          (onlyConstants || fVar !== Variability.Parameter || (paramMap && !paramMap.has(fName)))
        ) {
          return null;
        }
        const fBind = arena.getVarExpression(fIdx);
        if (fBind !== undefined && fBind >= 0 && fBind !== exprId) {
          const v = evaluateConstantArenaExpression(
            arena,
            fBind,
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
            onlyConstants,
          );
          if (typeof v === "number") return v;
        }
        if (fVar === Variability.Constant || onlyConstants) return null;
        return arena.getVarStartValue(fIdx);
      };
      const reVal = evalField(reName, reIdx);
      const imVal = evalField(imName, imIdx);
      if (typeof reVal === "number" && typeof imVal === "number") {
        return { re: reVal, im: imVal };
      }
    }
    // Reconstruct constant/parameter record objects (`{ __kind: "object", fields }`) and 2D arrays
    // (skip any prefix currently appearing on the LHS of an active `EqKind.Simple` equation).
    if (!hasActiveSimpleEqLhs(arena, varName)) {
      const recPrefixMap = getArenaConstRecordPrefixMap(arena);
      const memberVars = recPrefixMap.get(varName);
      if (memberVars && memberVars.length > 0) {
        const built = buildArenaConstRecordObject(
          arena,
          varName,
          memberVars,
          paramMap,
          nameToIdx,
          visitedDepth,
          exprId,
          db,
          scopeId,
          onlyConstants,
        );
        if (built !== null) {
          return built;
        }
      }
    }
    const probe2DIdx = nameToIdx ? nameToIdx.get(`${varName}[1,1]`) : arena.getVarIdxByName(`${varName}[1,1]`);
    if (probe2DIdx !== undefined && probe2DIdx >= 0 && !arena.isVarRemoved(probe2DIdx)) {
      const rows: ArenaConstantValue[][] = [];
      let all2DOk = true;
      let i2 = 1;
      while (all2DOk) {
        const rowProbe = `${varName}[${i2},1]`;
        const rowProbeIdx = nameToIdx ? nameToIdx.get(rowProbe) : arena.getVarIdxByName(rowProbe);
        if (rowProbeIdx === undefined || rowProbeIdx < 0 || arena.isVarRemoved(rowProbeIdx)) break;
        const rowVals: ArenaConstantValue[] = [];
        let j2 = 1;
        while (true) {
          const elemName = `${varName}[${i2},${j2}]`;
          const elemIdx = nameToIdx ? nameToIdx.get(elemName) : arena.getVarIdxByName(elemName);
          if (elemIdx === undefined || elemIdx < 0 || arena.isVarRemoved(elemIdx)) break;
          const elemVar = arena.getVarVariability(elemIdx);
          const hasInMap = Boolean(paramMap && paramMap.has(elemName));
          if (!hasInMap && elemVar !== Variability.Constant && (onlyConstants || elemVar !== Variability.Parameter)) {
            all2DOk = false;
            break;
          }
          let elemVal: ArenaConstantValue | null | undefined = null;
          if (hasInMap) {
            elemVal = paramMap!.get(elemName);
          } else {
            const bExpr = arena.getVarExpression(elemIdx);
            if (bExpr !== undefined && bExpr >= 0 && bExpr !== exprId) {
              elemVal = evaluateConstantArenaExpression(
                arena,
                bExpr,
                paramMap,
                nameToIdx,
                visitedDepth + 1,
                db,
                scopeId,
                onlyConstants,
              );
            } else if (!onlyConstants && elemVar === Variability.Parameter) {
              const sv = arena.getVarStartValue(elemIdx);
              elemVal = arena.getVarType(elemIdx) === VarType.Boolean ? sv !== 0 : sv;
            }
          }
          if (elemVal === null || elemVal === undefined) {
            all2DOk = false;
            break;
          }
          rowVals.push(elemVal);
          j2++;
        }
        if (rowVals.length === 0) break;
        rows.push(rowVals);
        i2++;
      }
      if (all2DOk && rows.length > 0) {
        return rows;
      }
    }
    const probe1DIdx = nameToIdx ? nameToIdx.get(`${varName}[1]`) : arena.getVarIdxByName(`${varName}[1]`);
    if (probe1DIdx !== undefined && probe1DIdx >= 0 && !arena.isVarRemoved(probe1DIdx)) {
      const vals: ArenaConstantValue[] = [];
      let all1DOk = true;
      let k1 = 1;
      while (true) {
        const elemName = `${varName}[${k1}]`;
        const elemIdx = nameToIdx ? nameToIdx.get(elemName) : arena.getVarIdxByName(elemName);
        if (elemIdx === undefined || elemIdx < 0 || arena.isVarRemoved(elemIdx)) break;
        const elemVar = arena.getVarVariability(elemIdx);
        const hasInMap = Boolean(paramMap && paramMap.has(elemName));
        if (!hasInMap && elemVar !== Variability.Constant && (onlyConstants || elemVar !== Variability.Parameter)) {
          all1DOk = false;
          break;
        }
        let elemVal: ArenaConstantValue | null | undefined = null;
        if (hasInMap) {
          elemVal = paramMap!.get(elemName);
        } else {
          const bExpr = arena.getVarExpression(elemIdx);
          if (bExpr !== undefined && bExpr >= 0 && bExpr !== exprId) {
            elemVal = evaluateConstantArenaExpression(
              arena,
              bExpr,
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
          } else if (!onlyConstants && elemVar === Variability.Parameter) {
            const sv = arena.getVarStartValue(elemIdx);
            elemVal = arena.getVarType(elemIdx) === VarType.Boolean ? sv !== 0 : sv;
          }
        }
        if (elemVal === null || elemVal === undefined) {
          all1DOk = false;
          break;
        }
        vals.push(elemVal);
        k1++;
      }
      if (all1DOk && vals.length > 0) {
        return vals;
      }
    }
    if (db && scopeId !== undefined) {
      const dbVal = evaluateDbConstantRef(db, varName, scopeId, onlyConstants);
      if (dbVal !== null) return dbVal;
    }
    return null;
  }

  // --- 3. Negation, Time Derivatives of Constants, Array Constructors & Subscripts ---
  if (kind === ExprKind.Negate) {
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(
      arena,
      childId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    if (typeof childVal === "number") return -childVal;
    if (isArenaComplexValue(childVal)) {
      return { re: -childVal.re, im: -childVal.im };
    }
    return null;
  }

  // The time derivative `der(c)` of any constant or parameter expression is identically `0.0` (or a zero array).
  if (kind === ExprKind.Der) {
    const operandId = arena.getExprData1(exprId);
    if (operandId >= 0) {
      const childVal = evaluateConstantArenaExpression(
        arena,
        operandId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (childVal !== null) {
        if (Array.isArray(childVal)) {
          return makeZeroArray(childVal);
        }
        return 0.0;
      }
      if (arena.getExprKind(operandId) === ExprKind.Name) {
        const varName = arena.interner.resolve(arena.getExprData1(operandId));
        const varIdx = nameToIdx ? nameToIdx.get(varName) : arena.getVarIdxByName(varName);
        if (varIdx !== undefined && varIdx >= 0 && !arena.isVarRemoved(varIdx)) {
          const variability = arena.getVarVariability(varIdx);
          if (variability === Variability.Constant || variability === Variability.Parameter) {
            return 0.0;
          }
        }
      }
    }
    return null;
  }

  if (kind === ExprKind.ArrayCtor) {
    const count = arena.getExprData1(exprId);
    if (count === 0) return [];
    const elements: ArenaConstantValue[] = [];
    for (let i = 0; i < count; i++) {
      const elemExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
      const val = evaluateConstantArenaExpression(
        arena,
        elemExprId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (val === null) return null;
      elements.push(val);
    }
    return elements;
  }

  if (kind === ExprKind.Subscript) {
    const baseExprId = arena.getExprData1(exprId);
    const subCount = arena.getExprRight(exprId);
    const baseVal = evaluateConstantArenaExpression(
      arena,
      baseExprId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    if (baseVal === null || !Array.isArray(baseVal)) return null;
    // Apply 1-based subscript indices across each dimension of `baseVal`.
    let curr: ArenaConstantValue | undefined = baseVal;
    for (let i = 0; i < subCount; i++) {
      const subExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
      const subVal = evaluateConstantArenaExpression(
        arena,
        subExprId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (typeof subVal !== "number" || !Array.isArray(curr)) return null;
      const idx = Math.trunc(subVal) - 1;
      if (idx < 0 || idx >= curr.length) return null;
      curr = curr[idx];
    }
    return curr ?? null;
  }

  // --- 4. Unary & Binary Operators ---
  if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId);
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(
      arena,
      childId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    if (childVal === null) return null;

    if (op === UnaryOp.Not) {
      if (typeof childVal === "boolean") return !childVal;
      if (typeof childVal === "number") return childVal === 0;
    } else if (op === UnaryOp.Negate) {
      if (typeof childVal === "number") return -childVal;
    }
    return null;
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);

    const lVal = evaluateConstantArenaExpression(
      arena,
      leftId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    const rVal = evaluateConstantArenaExpression(
      arena,
      rightId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );

    if (op === BinOp.And && (lVal === false || rVal === false)) return false;
    if (op === BinOp.Or && (lVal === true || rVal === true)) return true;

    if (lVal === null || rVal === null) return null;

    // Square matrix exponentiation `A ^ n` for non-negative integer `n`.
    if (op === BinOp.Pow && Array.isArray(lVal) && typeof rVal === "number") {
      const matPow = evalMatrixPow(lVal, rVal);
      if (matPow !== null) return matPow;
    }

    // Element-wise binary arithmetic and scalar-array broadcasting.
    if (Array.isArray(lVal) || Array.isArray(rVal)) {
      const res = evalElemBinOp(op, lVal, rVal);
      if (res !== null) return res;
    }

    if (typeof lVal === "string" && typeof rVal === "string" && (op === BinOp.Add || op === BinOp.ElemAdd)) {
      return lVal + rVal;
    }

    if (typeof lVal === "string" && typeof rVal === "string") {
      if (op === BinOp.Eq) return lVal === rVal;
      if (op === BinOp.Neq) return lVal !== rVal;
      return null;
    }

    if (isArenaComplexValue(lVal) || isArenaComplexValue(rVal)) {
      const a = toArenaComplexValue(lVal);
      const b = toArenaComplexValue(rVal);
      if (a && b) {
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return { re: a.re + b.re, im: a.im + b.im };
          case BinOp.Sub:
          case BinOp.ElemSub:
            return { re: a.re - b.re, im: a.im - b.im };
          case BinOp.Mul:
          case BinOp.ElemMul:
            return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
          case BinOp.Div:
          case BinOp.ElemDiv: {
            const d = b.re * b.re + b.im * b.im;
            return d !== 0 ? { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d } : null;
          }
        }
      }
      return null;
    }

    const lNum = typeof lVal === "boolean" ? (lVal ? 1 : 0) : typeof lVal === "number" ? lVal : null;
    const rNum = typeof rVal === "boolean" ? (rVal ? 1 : 0) : typeof rVal === "number" ? rVal : null;
    if (lNum === null || rNum === null) return null;

    switch (op) {
      case BinOp.Add:
      case BinOp.ElemAdd:
        return lNum + rNum;
      case BinOp.Sub:
      case BinOp.ElemSub:
        return lNum - rNum;
      case BinOp.Mul:
      case BinOp.ElemMul:
        return lNum * rNum;
      case BinOp.Div:
      case BinOp.ElemDiv:
        return rNum !== 0 ? lNum / rNum : null;
      case BinOp.Pow:
      case BinOp.ElemPow:
        return Math.pow(lNum, rNum);
      case BinOp.Eq:
        return lNum === rNum;
      case BinOp.Neq:
        return lNum !== rNum;
      case BinOp.Lt:
        return lNum < rNum;
      case BinOp.Lte:
        return lNum <= rNum;
      case BinOp.Gt:
        return lNum > rNum;
      case BinOp.Gte:
        return lNum >= rNum;
      case BinOp.And:
        return lVal !== false && lVal !== 0 && rVal !== false && rVal !== 0;
      case BinOp.Or:
        return (lVal !== false && lVal !== 0) || (rVal !== false && rVal !== 0);
    }
  }

  // --- 5. Conditional Expressions & Function Calls ---
  if (kind === ExprKind.IfElse) {
    const condId = arena.getExprData1(exprId);
    const condVal = evaluateConstantArenaExpression(
      arena,
      condId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    if (condVal !== null) {
      const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
      const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
      return evaluateConstantArenaExpression(
        arena,
        branchId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
    }
  }

  if (kind === ExprKind.Call) {
    const funcName = arena.interner.resolve(arena.getExprData1(exprId));
    // 5a. Fold `der(expr)` calls on constant/parameter expressions to `0.0`.
    if (funcName === "der") {
      const argCount = arena.getExprRight(exprId);
      if (argCount >= 1) {
        const arg = arena.getExprLeft(exprId);
        const childVal = evaluateConstantArenaExpression(
          arena,
          arg,
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
          onlyConstants,
        );
        if (childVal !== null) {
          if (Array.isArray(childVal)) {
            return makeZeroArray(childVal);
          }
          return 0.0;
        }
        if (arena.getExprKind(arg) === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(arg));
          const varIdx = nameToIdx ? nameToIdx.get(varName) : arena.getVarIdxByName(varName);
          if (varIdx !== undefined && varIdx >= 0 && !arena.isVarRemoved(varIdx)) {
            const variability = arena.getVarVariability(varIdx);
            if (variability === Variability.Constant || variability === Variability.Parameter) {
              return 0.0;
            }
          }
        }
      }
      return null;
    }
    // 5b. Event-generating and discrete-time operators are never compile-time constants.
    if (
      funcName === "sample" ||
      funcName === "edge" ||
      funcName === "change" ||
      funcName === "initial" ||
      funcName === "terminal" ||
      funcName === "pre"
    ) {
      return null;
    }
    const argCount = arena.getExprRight(exprId);
    const getCallArg = (i: number): number => {
      return i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
    };

    // 5c. Special-case `getInstanceName()`, `automaticLocalSeed`, `hashString`, `String(...)`, `linspace`, type casts (`Real`/`Integer`), and `cardinality(connector)`.
    if (funcName === "getInstanceName" && argCount === 0) {
      const instName = paramMap?._instanceName;
      return typeof instName === "string" && instName.length > 0 ? instName : null;
    }
    if (
      (funcName === "Modelica.Math.Random.Utilities.automaticLocalSeed" ||
        funcName === "Modelica.Utilities.Strings.hashString") &&
      argCount === 1
    ) {
      const a0 = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (typeof a0 === "string") {
        return modelicaHashString(a0);
      }
    }
    if (funcName === "String" && argCount >= 1) {
      const a0 = getCallArg(0);
      const a0Kind = arena.getExprKind(a0);
      if (a0Kind === ExprKind.EnumLiteral) {
        const enumPath = arena.interner.resolve(arena.getExprLeft(a0));
        let s = enumPath.includes(".") ? enumPath.split(".").pop()! : enumPath;
        let minLen = 0;
        let leftJust = true;
        for (let ai = 1; ai < argCount; ai++) {
          const av = evaluateConstantArenaExpression(
            arena,
            getCallArg(ai),
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
            onlyConstants,
          );
          if (typeof av === "number") minLen = Math.trunc(av);
          else if (typeof av === "boolean") leftJust = av;
        }
        if (minLen > s.length) {
          s = leftJust ? s.padEnd(minLen, " ") : s.padStart(minLen, " ");
        }
        return s;
      }
      if (a0Kind === ExprKind.Name && db) {
        const rawPath = arena.interner.resolve(arena.getExprData1(a0));
        const dotIdx = rawPath ? rawPath.lastIndexOf(".") : -1;
        if (rawPath && dotIdx > 0) {
          const typeName = rawPath.slice(0, dotIdx);
          const litName = rawPath.slice(dotIdx + 1);
          const leafType = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
          const syms = db.byName(leafType);
          const isEnumType = syms.some((s) => {
            if ((s.metadata as SymbolMetadataLike | undefined)?.isEnumeration) return true;
            const cst = db.cstNode(s.id) as CstNodeTextLike | null | undefined;
            return Boolean(cst?.text?.includes("enumeration("));
          });
          if (isEnumType) {
            let s = litName;
            let minLen = 0;
            let leftJust = true;
            for (let ai = 1; ai < argCount; ai++) {
              const av = evaluateConstantArenaExpression(
                arena,
                getCallArg(ai),
                paramMap,
                nameToIdx,
                visitedDepth + 1,
                db,
                scopeId,
                onlyConstants,
              );
              if (typeof av === "number") minLen = Math.trunc(av);
              else if (typeof av === "boolean") leftJust = av;
            }
            if (minLen > s.length) {
              s = leftJust ? s.padEnd(minLen, " ") : s.padStart(minLen, " ");
            }
            return s;
          }
        }
      }
      const v0 = evaluateConstantArenaExpression(
        arena,
        a0,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (typeof v0 === "boolean" || typeof v0 === "number") {
        let minLen = 0;
        let leftJust = true;
        let sigDigits = 6;
        const isRealArg = a0Kind === ExprKind.RealLiteral || (typeof v0 === "number" && argCount === 4);
        if (isRealArg && typeof v0 === "number") {
          if (argCount === 2) {
            const a1 = evaluateConstantArenaExpression(
              arena,
              getCallArg(1),
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (typeof a1 === "string") {
              const m = a1.match(/^([-+ #0]*)(\d+)?(?:\.(\d+))?([deEfFgGs])$/);
              if (m) {
                const flags = m[1] ?? "";
                const width = m[2] ? parseInt(m[2], 10) : 0;
                const prec = m[3] !== undefined ? parseInt(m[3], 10) : 6;
                const spec = m[4]!;
                let out: string;
                if (spec === "f" || spec === "F") out = v0.toFixed(prec);
                else if (spec === "e") out = v0.toExponential(prec);
                else if (spec === "E") out = v0.toExponential(prec).toUpperCase();
                else if (spec === "d") out = String(Math.trunc(v0));
                else {
                  out = Number(v0.toPrecision(Math.max(1, prec))).toString();
                  if (spec === "G") out = out.toUpperCase();
                }
                if (flags.includes("+") && v0 >= 0 && !out.startsWith("+")) out = "+" + out;
                else if (flags.includes(" ") && v0 >= 0 && !out.startsWith("-")) out = " " + out;
                if (width > out.length) {
                  const padChar = flags.includes("0") && !flags.includes("-") ? "0" : " ";
                  out = flags.includes("-") ? out.padEnd(width, " ") : out.padStart(width, padChar);
                }
                return out;
              }
              return null;
            }
            if (typeof a1 === "number" && a1 >= 1) sigDigits = Math.trunc(a1);
            else return null;
          } else if (argCount >= 3) {
            const sd = evaluateConstantArenaExpression(
              arena,
              getCallArg(1),
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (typeof sd === "number" && sd >= 1) sigDigits = Math.trunc(sd);
            else return null;
            const ml = evaluateConstantArenaExpression(
              arena,
              getCallArg(2),
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (typeof ml === "number") minLen = Math.trunc(ml);
            else return null;
            if (argCount >= 4) {
              const lj = evaluateConstantArenaExpression(
                arena,
                getCallArg(3),
                paramMap,
                nameToIdx,
                visitedDepth + 1,
                db,
                scopeId,
                onlyConstants,
              );
              if (typeof lj === "boolean") leftJust = lj;
              else return null;
            }
          }
        } else {
          if (argCount >= 2) {
            const ml = evaluateConstantArenaExpression(
              arena,
              getCallArg(1),
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (typeof ml === "number") minLen = Math.trunc(ml);
            else return null;
          }
          if (argCount >= 3) {
            const lj = evaluateConstantArenaExpression(
              arena,
              getCallArg(2),
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (typeof lj === "boolean") leftJust = lj;
            else return null;
          }
        }
        let s: string;
        if (typeof v0 === "boolean") {
          s = v0 ? "true" : "false";
        } else if (isRealArg) {
          s = Number(v0.toPrecision(sigDigits)).toString();
        } else {
          s = String(Math.trunc(v0));
        }
        if (minLen > s.length) {
          s = leftJust ? s.padEnd(minLen, " ") : s.padStart(minLen, " ");
        }
        return s;
      }
    }

    if (funcName === "linspace" && argCount >= 3) {
      const a1 = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      const a2 = evaluateConstantArenaExpression(
        arena,
        getCallArg(1),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      const a3 = evaluateConstantArenaExpression(
        arena,
        getCallArg(2),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (typeof a1 === "number" && typeof a2 === "number" && typeof a3 === "number") {
        const n = Math.trunc(a3);
        if (n >= 2) {
          const result: number[] = [];
          const step = (a2 - a1) / (n - 1);
          for (let i = 0; i < n; i++) {
            result.push(i === 0 ? a1 : i === n - 1 ? a2 : a1 + i * step);
          }
          return result;
        }
      }
      return null;
    }

    if (funcName === "/*Real*/" || funcName === "Real" || funcName.startsWith("/*Real[")) {
      const val = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (typeof val === "number") return val;
      if (typeof val === "boolean") return val ? 1.0 : 0.0;
      if (Array.isArray(val)) {
        const castElem = (v: ArenaConstantValue): ArenaConstantValue => {
          if (Array.isArray(v)) return v.map(castElem);
          if (typeof v === "number") return v;
          if (typeof v === "boolean") return v ? 1.0 : 0.0;
          return Number(v);
        };
        return val.map(castElem);
      }
      return null;
    }

    if (funcName === "/*Integer*/" || funcName === "Integer") {
      const arg0 = getCallArg(0);
      if (arg0 >= 0 && arena.getExprKind(arg0) === ExprKind.EnumLiteral) {
        const ord = arena.getExprData1(arg0);
        if (ord > 0) return ord;
      }
      const val = evaluateConstantArenaExpression(
        arena,
        arg0,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (typeof val === "number") return Math.trunc(val);
      if (typeof val === "boolean") return val ? 1 : 0;
      if (Array.isArray(val)) {
        const castElem = (v: ArenaConstantValue): ArenaConstantValue => {
          if (Array.isArray(v)) return v.map(castElem);
          if (typeof v === "number") return Math.trunc(v);
          if (typeof v === "boolean") return v ? 1 : 0;
          return Math.trunc(Number(v));
        };
        return val.map(castElem);
      }
      return null;
    }

    if (funcName === "cardinality") {
      const arg0 = getCallArg(0);
      let connectorName: string | null = null;
      if (arg0 >= 0) {
        const k = arena.getExprKind(arg0);
        if (k === ExprKind.Name) {
          connectorName = arena.interner.resolve(arena.getExprData1(arg0));
        } else if (k === ExprKind.Subscript) {
          const baseId = arena.getExprData1(arg0);
          const baseStr =
            arena.getExprKind(baseId) === ExprKind.Name ? arena.interner.resolve(arena.getExprData1(baseId)) : null;
          if (baseStr) {
            const subCount = arena.getExprRight(arg0);
            const subStrs: (number | string)[] = [];
            for (let i = 0; i < subCount; i++) {
              const sId = i === 0 ? arena.getExprLeft(arg0) : arena.getExprLeft(arg0 + i);
              if (arena.getExprKind(sId) === ExprKind.IntLiteral) subStrs.push(arena.getExprData1(sId));
            }
            if (subStrs.length === subCount) connectorName = `${baseStr}[${subStrs.join(",")}]`;
          }
        }
      }
      if (connectorName && !arena.hasArrayElements(connectorName)) {
        let count = 0;
        let canonicalMemberSuffix: string | null = null;
        const prefixDot = `${connectorName}.`;
        for (let i = 0; i < arena.eqCount; i++) {
          if (arena.getEqKind(i) === EqKind.Connect) {
            const lhs = arena.getEqLhs(i);
            const rhs = arena.getEqRhs(i);
            const lName =
              lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Name
                ? arena.interner.resolve(arena.getExprData1(lhs))
                : "";
            const rName =
              rhs >= 0 && arena.getExprKind(rhs) === ExprKind.Name
                ? arena.interner.resolve(arena.getExprData1(rhs))
                : "";
            if (lName === connectorName || rName === connectorName) {
              count++;
            } else if (lName.startsWith(prefixDot) || rName.startsWith(prefixDot)) {
              const matchedSide = lName.startsWith(prefixDot) ? lName : rName;
              const suffix = matchedSide.slice(connectorName.length);
              if (canonicalMemberSuffix === null) {
                canonicalMemberSuffix = suffix;
              }
              if (suffix === canonicalMemberSuffix) {
                count++;
              }
            }
          }
        }
        return count;
      }
      return null;
    }

    // 5d. Evaluate array built-ins (`evaluateArrayBuiltin`), `fill`, `size`, reductions
    // (`max`/`min`/`sum`/`product`), scalar math built-ins (`evalMathBuiltin`), and user-defined functions.
    const callArgs: ArenaConstantValue[] = [];
    let allArgsConst = true;
    for (let i = 0; i < argCount; i++) {
      const argVal = evaluateConstantArenaExpression(
        arena,
        getCallArg(i),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (argVal === null) {
        allArgsConst = false;
        break;
      }
      callArgs.push(argVal);
    }
    if (allArgsConst) {
      if (
        funcName === "Complex" ||
        funcName === "Complex.'constructor'.fromReal" ||
        funcName.endsWith(".Complex.'constructor'.fromReal")
      ) {
        if (typeof callArgs[0] === "number") {
          return { re: callArgs[0], im: typeof callArgs[1] === "number" ? callArgs[1] : 0.0 };
        }
      }
      if (funcName === "Complex.'0'" || funcName.endsWith(".Complex.'0'")) {
        return { re: 0.0, im: 0.0 };
      }
      if (
        (funcName === "Complex.'+'.add" || funcName === "Complex.'+'" || funcName.endsWith(".Complex.'+'.add")) &&
        callArgs.length >= 2
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        const b = toArenaComplexValue(callArgs[1]);
        if (a && b) return { re: a.re + b.re, im: a.im + b.im };
      }
      if (
        (funcName === "Complex.'-'.subtract" ||
          (funcName === "Complex.'-'" && callArgs.length >= 2) ||
          funcName.endsWith(".Complex.'-'.subtract")) &&
        callArgs.length >= 2
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        const b = toArenaComplexValue(callArgs[1]);
        if (a && b) return { re: a.re - b.re, im: a.im - b.im };
      }
      if (
        (funcName === "Complex.'-'.negate" ||
          (funcName === "Complex.'-'" && callArgs.length === 1) ||
          funcName.endsWith(".Complex.'-'.negate")) &&
        callArgs.length >= 1
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) return { re: -a.re, im: -a.im };
      }
      if (
        (funcName === "Complex.'*'.multiply" ||
          funcName === "Complex.'*'" ||
          funcName.endsWith(".Complex.'*'.multiply")) &&
        callArgs.length >= 2
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        const b = toArenaComplexValue(callArgs[1]);
        if (a && b) return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
      }
      if (
        (funcName === "Complex.'/'.divide" || funcName === "Complex.'/'" || funcName.endsWith(".Complex.'/'.divide")) &&
        callArgs.length >= 2
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        const b = toArenaComplexValue(callArgs[1]);
        if (a && b) {
          const d = b.re * b.re + b.im * b.im;
          if (d !== 0) {
            return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
          }
        }
      }
      if (
        (funcName === "Modelica.ComplexMath.real" || funcName === "ComplexMath.real" || funcName === "real") &&
        callArgs.length >= 1
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) return a.re;
      }
      if (
        (funcName === "Modelica.ComplexMath.imag" || funcName === "ComplexMath.imag" || funcName === "imag") &&
        callArgs.length >= 1
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) return a.im;
      }
      if (
        (funcName === "Modelica.ComplexMath.conj" || funcName === "ComplexMath.conj" || funcName === "conj") &&
        callArgs.length >= 1
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) return { re: a.re, im: -a.im };
      }
      if ((funcName === "Modelica.ComplexMath.abs" || funcName === "ComplexMath.abs") && callArgs.length >= 1) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) return Math.hypot(a.re, a.im);
      }
      if (
        (funcName === "Modelica.ComplexMath.arg" || funcName === "ComplexMath.arg" || funcName === "arg") &&
        callArgs.length >= 1
      ) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) return Math.atan2(a.im, a.re);
      }
      if (
        (funcName === "Modelica.ComplexMath.fromPolar" ||
          funcName === "ComplexMath.fromPolar" ||
          funcName === "fromPolar") &&
        callArgs.length >= 2
      ) {
        if (typeof callArgs[0] === "number" && typeof callArgs[1] === "number") {
          return { re: callArgs[0] * Math.cos(callArgs[1]), im: callArgs[0] * Math.sin(callArgs[1]) };
        }
      }
      if ((funcName === "Modelica.ComplexMath.exp" || funcName === "ComplexMath.exp") && callArgs.length >= 1) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) {
          const r = Math.exp(a.re);
          return { re: r * Math.cos(a.im), im: r * Math.sin(a.im) };
        }
      }
      if ((funcName === "Modelica.ComplexMath.sqrt" || funcName === "ComplexMath.sqrt") && callArgs.length >= 1) {
        const a = toArenaComplexValue(callArgs[0]);
        if (a) {
          const r = Math.hypot(a.re, a.im);
          const re = Math.sqrt((r + a.re) / 2);
          const im = (a.im >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
          return { re, im };
        }
      }

      const arrayBuiltinRes = evaluateArrayBuiltin(funcName, callArgs as unknown as ArenaValue[]);
      if (arrayBuiltinRes !== undefined && arrayBuiltinRes !== null) {
        return arrayBuiltinRes;
      }
    }

    if (funcName === "fill" && argCount >= 2) {
      const val = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (val === null) return null;
      const dims: number[] = [];
      for (let i = 1; i < argCount; i++) {
        const dimVal = evaluateConstantArenaExpression(
          arena,
          getCallArg(i),
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
          onlyConstants,
        );
        if (typeof dimVal !== "number") return null;
        const n = Math.trunc(dimVal);
        if (n < 0) return null;
        dims.push(n);
      }
      const buildFill = (dimIdx: number): ArenaConstantValue => {
        if (dimIdx >= dims.length) return val;
        const n = dims[dimIdx]!;
        const result: ArenaConstantValue[] = [];
        for (let i = 0; i < n; i++) {
          result.push(buildFill(dimIdx + 1));
        }
        return result;
      };
      return buildFill(0);
    }

    if (funcName === "size" && argCount >= 1) {
      const arrArg = getCallArg(0);
      let dim = 1;
      if (argCount >= 2) {
        const dimVal = evaluateConstantArenaExpression(
          arena,
          getCallArg(1),
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
          onlyConstants,
        );
        if (typeof dimVal !== "number") return null;
        dim = Math.trunc(dimVal);
      }
      if (arrArg >= 0) {
        const arrKind = arena.getExprKind(arrArg);
        if (arrKind === ExprKind.ArrayCtor) {
          if (dim === 1) {
            return arena.getExprData1(arrArg);
          }
          let cur = arrArg;
          for (let d = 1; d < dim; d++) {
            if (
              arena.getExprKind(cur) === ExprKind.ArrayCtor &&
              (arena.getExprData1(cur) > 0 || (arena.getExprLeft(cur) !== 0xffffffff && arena.getExprLeft(cur) !== -1))
            ) {
              cur = arena.getExprLeft(cur);
            } else {
              break;
            }
          }
          if (arena.getExprKind(cur) === ExprKind.ArrayCtor) {
            return arena.getExprData1(cur);
          }
        }
        if (arrKind === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(arrArg));
          if (name) {
            const namedShape = arena.getNamedArrayShape(name) ?? arena.namedArrayShapes.get(name);
            if (namedShape && namedShape.length >= dim && namedShape[dim - 1]! >= 0) {
              return namedShape[dim - 1]!;
            }
            const vIdx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
            if (vIdx !== undefined && vIdx >= 0) {
              const shape = arena.getVarShape(vIdx);
              if (shape && shape.length >= dim && shape[dim - 1]! >= 0) {
                return shape[dim - 1]!;
              }
            }

            let maxDim = 0;
            const prefixMatch = `${name}[`;
            for (let i = 0; i < arena.varCount; i++) {
              if (!arena.isVarRemoved(i)) {
                const vn = arena.getVarName(i);
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
            let count = 0;
            while (arena.getVarIdxByName(`${name}[${count + 1}]`) >= 0) count++;
            if (count > 0 && dim === 1) return count;
          }
        }
        if (arrKind === ExprKind.Call) {
          const innerFn = arena.interner.resolve(arena.getExprData1(arrArg));
          const innerArgCount = arena.getExprRight(arrArg);
          if (innerFn === "fill" && dim >= 1 && dim < innerArgCount) {
            const dimArgExprId = dim === 0 ? arena.getExprLeft(arrArg) : arena.getExprLeft(arrArg + dim);
            const fillCount = evaluateConstantArenaExpression(
              arena,
              dimArgExprId,
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (typeof fillCount === "number") return Math.trunc(fillCount);
          }
          if (innerFn && arena.functions.has(innerFn)) {
            const fnDae = arena.functions.get(innerFn)!;
            let outVar = -1;
            const fnInputs: string[] = [];
            for (let vi = 0; vi < fnDae.varCount; vi++) {
              if (fnDae.isVarRemoved(vi)) continue;
              const c = fnDae.getVarCausality(vi);
              if (c === Causality.Input) fnInputs.push(fnDae.getVarName(vi));
              else if (c === Causality.Output && outVar < 0) outVar = vi;
            }
            if (outVar >= 0 && dim >= 1) {
              const outShape = fnDae.getVarShape(outVar);
              if (outShape && outShape.length >= dim && outShape[dim - 1]! > 0) {
                return outShape[dim - 1]!;
              }
              const outShapeExprs = fnDae.getVarShapeExprs(outVar);
              if (outShapeExprs && outShapeExprs.length >= dim) {
                const dimExpr = outShapeExprs[dim - 1]!;
                if (dimExpr >= 0) {
                  const dk = fnDae.getExprKind(dimExpr);
                  if (dk === ExprKind.IntLiteral) return fnDae.getExprData1(dimExpr);
                  if (dk === ExprKind.Name) {
                    const pName = fnDae.interner.resolve(fnDae.getExprData1(dimExpr));
                    const pIdx = pName ? fnInputs.indexOf(pName) : -1;
                    if (pIdx >= 0 && pIdx < innerArgCount) {
                      const argExpr = pIdx === 0 ? arena.getExprLeft(arrArg) : arena.getExprLeft(arrArg + pIdx);
                      const v = evaluateConstantArenaExpression(
                        arena,
                        argExpr,
                        paramMap,
                        nameToIdx,
                        visitedDepth + 1,
                        db,
                        scopeId,
                        false,
                      );
                      if (typeof v === "number") return Math.trunc(v);
                    }
                  } else if (dk === ExprKind.Call) {
                    const dFn = fnDae.interner.resolve(fnDae.getExprData1(dimExpr));
                    const dArgc = fnDae.getExprRight(dimExpr);
                    if (dFn === "size" && dArgc >= 1) {
                      const targetExpr = fnDae.getExprLeft(dimExpr);
                      if (targetExpr >= 0 && fnDae.getExprKind(targetExpr) === ExprKind.Name) {
                        const pName = fnDae.interner.resolve(fnDae.getExprData1(targetExpr));
                        const pIdx = pName ? fnInputs.indexOf(pName) : -1;
                        if (pIdx >= 0 && pIdx < innerArgCount) {
                          const argExpr = pIdx === 0 ? arena.getExprLeft(arrArg) : arena.getExprLeft(arrArg + pIdx);
                          let subDim = 1;
                          if (dArgc >= 2) {
                            const subDimExpr = fnDae.getExprLeft(dimExpr + 1);
                            if (subDimExpr >= 0 && fnDae.getExprKind(subDimExpr) === ExprKind.IntLiteral) {
                              subDim = fnDae.getExprData1(subDimExpr);
                            }
                          }
                          const sizeCall = arena.addCallExpr(arena.interner.intern("size"), [
                            argExpr,
                            arena.addIntLiteral(subDim),
                          ]);
                          return evaluateConstantArenaExpression(
                            arena,
                            sizeCall,
                            paramMap,
                            nameToIdx,
                            visitedDepth + 1,
                            db,
                            scopeId,
                            onlyConstants,
                          );
                        }
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

    if (allArgsConst) {
      if (argCount >= 1 && getCallArg(0) >= 0) {
        const arg1 = callArgs[0];
        if (Array.isArray(arg1) && (argCount === 1 || argCount === 2)) {
          if (
            funcName === "Modelica.Math.Vectors.normalize" ||
            funcName.endsWith(".Vectors.normalize") ||
            funcName === "Modelica.Math.Vectors.normalizeWithAssert" ||
            funcName.endsWith(".Vectors.normalizeWithAssert")
          ) {
            const vec = arg1 as unknown[];
            if (vec.length > 0 && vec.every((x) => typeof x === "number" && Number.isFinite(x))) {
              const nums = vec as number[];
              const len = Math.hypot(...nums);
              if (funcName.endsWith("normalizeWithAssert")) {
                if (len > 0) return nums.map((x) => x / len);
              } else {
                const eps = argCount === 2 && typeof callArgs[1] === "number" ? callArgs[1] : 2.220446049250313e-14;
                const denom = len >= eps ? len : eps;
                if (denom > 0) return nums.map((x) => x / denom);
              }
            }
          }
        }
        if (Array.isArray(arg1) && argCount === 1) {
          const flat = (arg1 as unknown[]).flat(Infinity) as number[];
          if (flat.length > 0) {
            if (funcName === "max") return Math.max(...flat);
            if (funcName === "min") return Math.min(...flat);
            if (funcName === "sum") return flat.reduce((a, b) => a + b, 0);
            if (funcName === "product") return flat.reduce((a, b) => a * b, 1);
          }
        }
        if (
          (funcName === "realFFTsamplePoints" || funcName.endsWith(".realFFTsamplePoints")) &&
          (callArgs.length === 2 || callArgs.length === 3) &&
          typeof callArgs[0] === "number" &&
          typeof callArgs[1] === "number"
        ) {
          const fMax = callArgs[0];
          const fRes = callArgs[1];
          const fFactor = callArgs.length === 3 && typeof callArgs[2] === "number" ? callArgs[2] : 5;
          if (fRes > 0 && fMax > fRes && fFactor >= 1) {
            let ns = 2 * Math.ceil((fMax * fFactor) / fRes);
            if (ns % 2 !== 0) ns += 1;
            while (ns <= 1048576) {
              let rem = ns;
              while (rem % 2 === 0) rem /= 2;
              while (rem % 3 === 0) rem /= 3;
              while (rem % 5 === 0) rem /= 5;
              if (rem <= 1) return ns;
              ns += 2;
            }
          }
        }
        if (typeof arg1 === "number" && argCount <= 2) {
          let arg2 = 0.0;
          let bothNumeric = true;
          if (argCount === 2) {
            const arg2Val = callArgs[1];
            if (typeof arg2Val === "number") {
              arg2 = arg2Val;
            } else {
              bothNumeric = false;
            }
          }
          if (bothNumeric) {
            const mathRes = evalMathBuiltin(funcName, arg1, arg2);
            if (mathRes !== null) return mathRes;
          }
        }
      }

      const fnBridge = arena.getFunction(funcName) ?? lookupRecordFunctionInDae(arena, funcName);
      if (fnBridge) {
        const fnInternId = arena.interner.intern(fnBridge.name || funcName);
        let res: ArenaValue | null = null;
        try {
          res = evaluateArenaFunctionCall(arena, fnInternId, callArgs as unknown as ArenaValue[], db, scopeId);
          if (res === null && fnBridge.name !== funcName) {
            res = evaluateArenaFunctionCall(
              arena,
              arena.interner.intern(funcName),
              callArgs as unknown as ArenaValue[],
              db,
              scopeId,
            );
          }
        } catch {
          return null;
        }
        if (res !== null) {
          (fnBridge as DAEBuilder & DAEBuilderFoldExtensions).wasCalled = true;
          for (const f of arena.functions.values()) {
            if (f.name === fnBridge.name) {
              (f as DAEBuilder & DAEBuilderFoldExtensions).wasCalled = true;
            }
          }
          return res;
        }
      }
    }
  }

  if (kind === ExprKind.Range) {
    const startVal = evaluateConstantArenaExpression(
      arena,
      arena.getExprData1(exprId),
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    const stepId = arena.getExprLeft(exprId);
    const stepVal =
      stepId >= 0
        ? evaluateConstantArenaExpression(
            arena,
            stepId,
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
            onlyConstants,
          )
        : 1;
    const stopVal = evaluateConstantArenaExpression(
      arena,
      arena.getExprRight(exprId),
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
      onlyConstants,
    );
    if (typeof startVal === "number" && typeof stepVal === "number" && typeof stopVal === "number" && stepVal !== 0) {
      const arr: number[] = [];
      if (stepVal > 0) {
        for (let rv = startVal; rv <= stopVal + 1e-12; rv += stepVal) {
          arr.push(rv);
          if (arr.length > 65536) return null;
        }
      } else {
        for (let rv = startVal; rv >= stopVal - 1e-12; rv += stepVal) {
          arr.push(rv);
          if (arr.length > 65536) return null;
        }
      }
      return arr;
    }
    return null;
  }

  if (kind === ExprKind.Comprehension) {
    const cfn = arena.interner.resolve(arena.getExprData1(exprId)) ?? "array";
    const bodyId = arena.getExprLeft(exprId);
    const iterCount = arena.getExprRight(exprId);
    if (iterCount <= 0) return null;
    const iters: { varName: string; values: ArenaConstantValue[] }[] = [];
    for (let i = 0; i < iterCount; i++) {
      const iterNodeId = exprId + 1 + i;
      const iterVarName = arena.interner.resolve(arena.getExprData1(iterNodeId));
      const rangeExprId = arena.getExprLeft(iterNodeId);
      if (!iterVarName || rangeExprId < 0) return null;
      const rangeVal = evaluateConstantArenaExpression(
        arena,
        rangeExprId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (!Array.isArray(rangeVal)) return null;
      iters.push({ varName: iterVarName, values: rangeVal });
    }
    const localParams = new Map<string, ArenaConstantValue>(paramMap);
    const evalIterDepth = (depth: number): ArenaConstantValue[] | null => {
      const iter = iters[depth]!;
      const prev = localParams.get(iter.varName);
      const outArr: ArenaConstantValue[] = [];
      try {
        for (const v of iter.values) {
          localParams.set(iter.varName, v);
          if (depth + 1 < iters.length) {
            const sub = evalIterDepth(depth + 1);
            if (sub === null) return null;
            outArr.push(sub);
          } else {
            const bodyVal = evaluateConstantArenaExpression(
              arena,
              bodyId,
              localParams,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
              onlyConstants,
            );
            if (bodyVal === null) return null;
            outArr.push(bodyVal);
          }
        }
      } finally {
        if (prev !== undefined) localParams.set(iter.varName, prev);
        else localParams.delete(iter.varName);
      }
      return outArr;
    };
    const compArray = evalIterDepth(0);
    if (compArray === null) return null;
    if (cfn === "array" || cfn === "{}" || cfn === "") return compArray;
    if (cfn === "sum" || cfn === "product" || cfn === "min" || cfn === "max") {
      const flat = (compArray as unknown[]).flat(Infinity) as number[];
      if (flat.length > 0 && flat.every((x) => typeof x === "number")) {
        if (cfn === "sum") return flat.reduce((a, b) => a + b, 0);
        if (cfn === "product") return flat.reduce((a, b) => a * b, 1);
        if (cfn === "min") return Math.min(...flat);
        if (cfn === "max") return Math.max(...flat);
      }
    }
    if (cfn === "anyTrue" || cfn === "andTrue" || cfn === "allTrue" || cfn === "oneTrue" || cfn === "countTrue") {
      const res = evaluateArrayBuiltin(cfn, [compArray as unknown as ArenaValue]);
      if (res !== undefined && res !== null) return res;
    }
    return compArray;
  }

  return null;
}

const simpleEqLhsCache = new WeakMap<DAEBuilder, { eqCount: number; map: Map<string, number[]> }>();
const constRecPrefixCache = new WeakMap<DAEBuilder, { varCount: number; map: Map<string, number[]> }>();

function hasActiveSimpleEqLhs(arena: DAEBuilder, varName: string): boolean {
  let entry = simpleEqLhsCache.get(arena);
  if (!entry || entry.eqCount !== arena.eqCount) {
    const lhsMap = new Map<string, number[]>();
    for (let e = 0; e < arena.eqCount; e++) {
      if (arena.isEqRemoved(e) || arena.getEqKind(e) !== EqKind.Simple) continue;
      const l = arena.getEqLhs(e);
      if (l >= 0 && arena.getExprKind(l) === ExprKind.Name) {
        const ln = arena.interner.resolve(arena.getExprData1(l));
        if (ln) {
          let list = lhsMap.get(ln);
          if (!list) {
            list = [];
            lhsMap.set(ln, list);
          }
          list.push(e);
        }
      }
    }
    entry = { eqCount: arena.eqCount, map: lhsMap };
    simpleEqLhsCache.set(arena, entry);
  }
  const indices = entry.map.get(varName);
  if (!indices) return false;
  for (const eIdx of indices) {
    if (!arena.isEqRemoved(eIdx)) return true;
  }
  return false;
}

function getArenaConstRecordPrefixMap(arena: DAEBuilder): Map<string, number[]> {
  const cached = constRecPrefixCache.get(arena);
  if (cached && cached.varCount === arena.varCount) return cached.map;
  const map = new Map<string, number[]>();
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const vb = arena.getVarVariability(i);
    if (vb !== Variability.Constant && vb !== Variability.Parameter) continue;
    const vn = arena.getVarName(i);
    let dot = vn.indexOf(".");
    while (dot !== -1) {
      const prefix = vn.slice(0, dot);
      let arr = map.get(prefix);
      if (!arr) {
        arr = [];
        map.set(prefix, arr);
      }
      arr.push(i);
      dot = vn.indexOf(".", dot + 1);
    }
  }
  constRecPrefixCache.set(arena, { varCount: arena.varCount, map });
  return map;
}

function buildArenaConstRecordObject(
  arena: DAEBuilder,
  varName: string,
  memberVars: number[],
  paramMap: ArenaFoldParamLookup | undefined,
  nameToIdx: Map<string, number> | undefined,
  visitedDepth: number,
  selfExprId: number,
  db: QueryDB | undefined,
  scopeId: SymbolId | undefined,
  onlyConstants: boolean,
): ArenaObjectValue | null {
  const rootFields = new Map<string, ArenaValue>();
  const prefixLen = varName.length + 1;
  let populated = 0;
  for (const vIdx of memberVars) {
    if (arena.isVarRemoved(vIdx)) continue;
    const fVar = arena.getVarVariability(vIdx);
    if (onlyConstants && fVar !== Variability.Constant) continue;
    const vn = arena.getVarName(vIdx);
    if (vn.length <= prefixLen || vn.includes("[")) continue;
    const relPath = vn.slice(prefixLen);
    let fieldVal: ArenaConstantValue | null | undefined = undefined;
    if (paramMap && paramMap.has(vn)) {
      fieldVal = paramMap.get(vn);
    } else {
      const fBind = arena.getVarExpression(vIdx);
      if (fBind !== undefined && fBind >= 0 && fBind !== selfExprId) {
        fieldVal = evaluateConstantArenaExpression(
          arena,
          fBind,
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
          onlyConstants,
        );
        if (fieldVal === null && !onlyConstants && fVar === Variability.Parameter) {
          const sv = arena.getVarStartValue(vIdx);
          fieldVal = arena.getVarType(vIdx) === VarType.Boolean ? sv !== 0 : sv;
        }
      } else if (!onlyConstants && fVar === Variability.Parameter) {
        const sv = arena.getVarStartValue(vIdx);
        fieldVal = arena.getVarType(vIdx) === VarType.Boolean ? sv !== 0 : sv;
      }
    }
    if (fieldVal === null || fieldVal === undefined) return null;
    const segs = relPath.split(".");
    let curMap = rootFields;
    for (let s = 0; s < segs.length - 1; s++) {
      const seg = segs[s]!;
      let next = curMap.get(seg);
      if (!next || !isArenaObject(next)) {
        next = { __kind: "object" as const, fields: new Map<string, ArenaValue>() };
        curMap.set(seg, next);
      }
      curMap = next.fields;
    }
    curMap.set(segs[segs.length - 1]!, fieldVal as ArenaValue);
    populated++;
  }
  return populated > 0 ? { __kind: "object" as const, fields: rootFields } : null;
}
