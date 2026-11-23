// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Constant Folding & Algebraic Reduction Framework.
 * Operates directly on DAEBuilder and WebAssembly memory buffers.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "../runtime.js";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, StmtKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";
import { evaluateArrayBuiltin, isArenaObject, type ArenaObjectValue, type ArenaValue } from "./wasm_evaluator.js";
import { countArenaStatementSlots, evaluateArenaFunctionCall } from "./wasm_statement_executor.js";

export type ArenaConstantValue = number | boolean | string | ArenaConstantValue[];

/**
 * Evaluates an elementary math function on constant real inputs.
 */
function evalMathBuiltin(funcName: string, arg1: number, arg2: number): number | null {
  switch (funcName.toLowerCase()) {
    case "sin":
      return Math.sin(arg1);
    case "cos":
      return Math.cos(arg1);
    case "tan":
      return Math.tan(arg1);
    case "asin":
      return Math.asin(arg1);
    case "acos":
      return Math.acos(arg1);
    case "atan":
      return Math.atan(arg1);
    case "atan2":
      return Math.atan2(arg1, arg2);
    case "sinh":
      return Math.sinh(arg1);
    case "cosh":
      return Math.cosh(arg1);
    case "tanh":
      return Math.tanh(arg1);
    case "exp":
      return Math.exp(arg1);
    case "log":
      return arg1 > 0 ? Math.log(arg1) : null;
    case "log10":
      return arg1 > 0 ? Math.log10(arg1) : null;
    case "sqrt":
      return arg1 >= 0 ? Math.sqrt(arg1) : null;
    case "abs":
      return Math.abs(arg1);
    case "sign":
      return arg1 > 0 ? 1.0 : arg1 < 0 ? -1.0 : 0.0;
    case "min":
      return Math.min(arg1, arg2);
    case "max":
      return Math.max(arg1, arg2);
    case "floor":
      return Math.floor(arg1);
    case "integer":
      return Math.floor(arg1);
    case "ceil":
      return Math.ceil(arg1);
    case "pow":
      return Math.pow(arg1, arg2);
    case "div":
      return arg2 !== 0 ? Math.trunc(arg1 / arg2) : null;
    case "mod":
      return arg2 !== 0 ? arg1 - Math.floor(arg1 / arg2) * arg2 : null;
    case "rem":
      return arg2 !== 0 ? arg1 - Math.trunc(arg1 / arg2) * arg2 : null;
    case "noevent":
      return arg1;
    case "smooth":
      return arg2 !== undefined && !isNaN(arg2) ? arg2 : arg1;
    case "homotopy":
      return arg1;
    default:
      return null;
  }
}

function evalMatrixPow(A: any[], p: number): any[][] | null {
  if (!Array.isArray(A) || A.length === 0 || !Array.isArray(A[0])) return null;
  const N = A.length;
  if (!A.every((row) => Array.isArray(row) && row.length === N)) return null;
  if (!Number.isInteger(p) || p < 0) return null;

  if (p === 0) {
    const res: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        row.push(i === j ? 1.0 : 0.0);
      }
      res.push(row);
    }
    return res;
  }

  let current: number[][] = A.map((row) => row.map((v: any) => (typeof v === "number" ? v : Number(v))));
  for (let step = 1; step < p; step++) {
    const next: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < N; k++) {
          sum += current[i]![k]! * Number(A[k]![j]!);
        }
        row.push(sum);
      }
      next.push(row);
    }
    current = next;
  }
  return current;
}

/**
 * Evaluates a compile-time constant or parameter expression tree in a {@link DAEBuilder}
 * to a scalar (`number | boolean | string`) or nested array value during constant folding.
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
  paramMap?: Map<string, any>,
  nameToIdx?: Map<string, number>,
  visitedDepth = 0,
  db?: QueryDB,
  scopeId?: SymbolId,
  onlyConstants = false,
): number | boolean | string | any[] | null {
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
  ): number | boolean | string | any[] | null {
    const varName = rawName.trim();
    if (!varName || visited.size > 32) return null;
    const visitKey = `${scopeId}:${varName}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);

    // Parses literal numbers, booleans, well-known `Modelica.Constants` / `ModelicaServices.Machine`
    // expressions, brace array literals `{...}`, or recursively resolves symbolic references.
    const parseScalarOrArrayText = (text: string, evalScopeId: SymbolId): number | boolean | string | any[] | null => {
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
        const arr: any[] = [];
        for (const p of parts) {
          const v = parseScalarOrArrayText(p, evalScopeId);
          if (v === null) return null;
          arr.push(v);
        }
        return arr;
      }
      return evaluateDbConstantRef(db, t, evalScopeId, onlyConstants, visited);
    };

    const splitDotsOutsideBrackets = (s: string): string[] => {
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
    };

    // 1. Check extends modification overrides on scopeId (e.g. const15: extends A(B(i = 4)))
    const topDots = !varName.startsWith(".") ? splitDotsOutsideBrackets(varName) : [];
    if (topDots.length > 1) {
      const parts = topDots;
      const findInExtendsMods = (currScope: SymbolId, depth: number): number | boolean | string | any[] | null => {
        if (depth > 8) return null;
        const children = db.childrenOf(currScope) || [];
        for (const child of children) {
          if (child.kind !== "Extends") continue;
          const extModRaw = db.query<any>("extendsModificationParsed", child.id);
          let currArgs: any[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
          let matchedArg: any = null;
          for (let i = 0; i < parts.length; i++) {
            const seg = parts[i]!.replace(/\[.*\]$/, "");
            matchedArg = currArgs.find((a: any) => a && !a.isBreak && a.name === seg);
            if (!matchedArg) break;
            if (i < parts.length - 1) {
              currArgs = matchedArg.nestedArgs ?? matchedArg.args ?? [];
            }
          }
          if (matchedArg) {
            const valObj = matchedArg.value ?? matchedArg.bindingExpression;
            if (valObj !== undefined && valObj !== null) {
              if (typeof valObj === "number" || typeof valObj === "boolean") return valObj;
              if (typeof valObj?.value === "number" || typeof valObj?.value === "boolean") return valObj.value;
              const valText = typeof valObj === "string" ? valObj : valObj?.text;
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
              const lits = (es.metadata as any)?.literals;
              if (Array.isArray(lits)) {
                const idx = lits.indexOf(litName);
                if (idx >= 0) {
                  trailingSubscript = idx + 1;
                  break;
                }
              }
              const cstText = (db.cstNode(es.id) as any)?.text ?? "";
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
      if (resolved.metadata) {
        const meta = resolved.metadata as Record<string, unknown>;
        const tabularValue = meta["lasValue"] ?? meta["csvValue"];
        if (tabularValue !== undefined) {
          return tabularValue as number | boolean | string | unknown[] | null;
        }
      }
      const variability =
        (resolved.metadata as any)?.variability ?? db.query<string | null>("variability", resolved.id);
      if (variability === "constant" || (!onlyConstants && variability === "parameter")) {
        const mod = db.query<any | null>("effectiveModification", resolved.id);
        let bText: string | null =
          mod?.bindingExpression?.text ??
          (typeof mod?.bindingExpression === "string" ? mod.bindingExpression : null) ??
          null;
        if (!bText) {
          const compInst = db.query<any>("componentInstance", resolved.id);
          bText = compInst?.bindingExpression?.text ?? null;
        }
        if (!bText) {
          const cst = db.cstNode(resolved.id) as any;
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

  // --- 2. Variable & Component Name Resolution ---
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varName = arena.interner.resolve(nameId);
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
        const bindMemo: Map<number, ArenaConstantValue> | undefined = !onlyConstants
          ? (paramMap as any)?._bindMemo
          : undefined;
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
          const vals: any[] = [];
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
      return { re: 0.0, im: 1.0 } as any;
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
        return { re: reVal, im: imVal } as any;
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
          return built as any;
        }
      }
    }
    const probe2DIdx = nameToIdx ? nameToIdx.get(`${varName}[1,1]`) : arena.getVarIdxByName(`${varName}[1,1]`);
    if (probe2DIdx !== undefined && probe2DIdx >= 0 && !arena.isVarRemoved(probe2DIdx)) {
      const rows: any[][] = [];
      let all2DOk = true;
      let i2 = 1;
      while (all2DOk) {
        const rowProbe = `${varName}[${i2},1]`;
        const rowProbeIdx = nameToIdx ? nameToIdx.get(rowProbe) : arena.getVarIdxByName(rowProbe);
        if (rowProbeIdx === undefined || rowProbeIdx < 0 || arena.isVarRemoved(rowProbeIdx)) break;
        const rowVals: any[] = [];
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
          let elemVal: any = null;
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
      const vals: any[] = [];
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
        let elemVal: any = null;
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
    if (
      childVal !== null &&
      typeof childVal === "object" &&
      typeof (childVal as any).re === "number" &&
      typeof (childVal as any).im === "number"
    ) {
      return { re: -(childVal as any).re, im: -(childVal as any).im } as any;
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
          const makeZeros = (arr: any[]): any[] => arr.map((item) => (Array.isArray(item) ? makeZeros(item) : 0.0));
          return makeZeros(childVal);
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
    const elements: any[] = [];
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
    let curr: any = baseVal;
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
      const evalElemBinOp = (op: BinOp, a: any, b: any): any => {
        if (Array.isArray(a) && Array.isArray(b)) {
          return a.map((elem, i) => evalElemBinOp(op, elem, b[i]));
        }
        if (Array.isArray(a) && typeof b === "number") {
          return a.map((elem) => evalElemBinOp(op, elem, b));
        }
        if (typeof a === "number" && Array.isArray(b)) {
          return b.map((elem) => evalElemBinOp(op, a, elem));
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
      };
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

    const isComplexObj = (v: any): v is { re: number; im: number } =>
      v !== null && typeof v === "object" && typeof v.re === "number" && typeof v.im === "number";
    if (isComplexObj(lVal) || isComplexObj(rVal)) {
      const a = isComplexObj(lVal) ? lVal : typeof lVal === "number" ? { re: lVal, im: 0 } : null;
      const b = isComplexObj(rVal) ? rVal : typeof rVal === "number" ? { re: rVal, im: 0 } : null;
      if (a && b) {
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return { re: a.re + b.re, im: a.im + b.im } as any;
          case BinOp.Sub:
          case BinOp.ElemSub:
            return { re: a.re - b.re, im: a.im - b.im } as any;
          case BinOp.Mul:
          case BinOp.ElemMul:
            return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re } as any;
          case BinOp.Div:
          case BinOp.ElemDiv: {
            const d = b.re * b.re + b.im * b.im;
            return d !== 0
              ? ({ re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d } as any)
              : null;
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
            const makeZeros = (arr: any[]): any[] => arr.map((item) => (Array.isArray(item) ? makeZeros(item) : 0.0));
            return makeZeros(childVal);
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

    // 5c. Special-case `getInstanceName()`, `automaticLocalSeed`, `hashString`, `String(...)`, `linspace`, type casts (`Real`/`Integer`), and `cardinality(connector)`.
    if (funcName === "getInstanceName" && argCount === 0) {
      const instName = (paramMap as any)?._instanceName;
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
          const isEnumType = syms.some((s: any) => {
            if (s.metadata?.isEnumeration) return true;
            const cst = db.cstNode(s.id) as any;
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
        const castElem = (v: any): any => {
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
        const castElem = (v: any): any => {
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
    const callArgs: any[] = [];
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
      const isComplexVal = (v: any): v is { re: number; im: number } =>
        v !== null && typeof v === "object" && typeof v.re === "number" && typeof v.im === "number";
      const toComplexVal = (v: any): { re: number; im: number } | null =>
        isComplexVal(v) ? v : typeof v === "number" ? { re: v, im: 0 } : null;

      if (
        funcName === "Complex" ||
        funcName === "Complex.'constructor'.fromReal" ||
        funcName.endsWith(".Complex.'constructor'.fromReal")
      ) {
        if (typeof callArgs[0] === "number") {
          return { re: callArgs[0], im: typeof callArgs[1] === "number" ? callArgs[1] : 0.0 } as any;
        }
      }
      if (funcName === "Complex.'0'" || funcName.endsWith(".Complex.'0'")) {
        return { re: 0.0, im: 0.0 } as any;
      }
      if (
        (funcName === "Complex.'+'.add" || funcName === "Complex.'+'" || funcName.endsWith(".Complex.'+'.add")) &&
        callArgs.length >= 2
      ) {
        const a = toComplexVal(callArgs[0]);
        const b = toComplexVal(callArgs[1]);
        if (a && b) return { re: a.re + b.re, im: a.im + b.im } as any;
      }
      if (
        (funcName === "Complex.'-'.subtract" ||
          (funcName === "Complex.'-'" && callArgs.length >= 2) ||
          funcName.endsWith(".Complex.'-'.subtract")) &&
        callArgs.length >= 2
      ) {
        const a = toComplexVal(callArgs[0]);
        const b = toComplexVal(callArgs[1]);
        if (a && b) return { re: a.re - b.re, im: a.im - b.im } as any;
      }
      if (
        (funcName === "Complex.'-'.negate" ||
          (funcName === "Complex.'-'" && callArgs.length === 1) ||
          funcName.endsWith(".Complex.'-'.negate")) &&
        callArgs.length >= 1
      ) {
        const a = toComplexVal(callArgs[0]);
        if (a) return { re: -a.re, im: -a.im } as any;
      }
      if (
        (funcName === "Complex.'*'.multiply" ||
          funcName === "Complex.'*'" ||
          funcName.endsWith(".Complex.'*'.multiply")) &&
        callArgs.length >= 2
      ) {
        const a = toComplexVal(callArgs[0]);
        const b = toComplexVal(callArgs[1]);
        if (a && b) return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re } as any;
      }
      if (
        (funcName === "Complex.'/'.divide" || funcName === "Complex.'/'" || funcName.endsWith(".Complex.'/'.divide")) &&
        callArgs.length >= 2
      ) {
        const a = toComplexVal(callArgs[0]);
        const b = toComplexVal(callArgs[1]);
        if (a && b) {
          const d = b.re * b.re + b.im * b.im;
          if (d !== 0) {
            return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d } as any;
          }
        }
      }
      if (
        (funcName === "Modelica.ComplexMath.real" || funcName === "ComplexMath.real" || funcName === "real") &&
        callArgs.length >= 1
      ) {
        const a = toComplexVal(callArgs[0]);
        if (a) return a.re;
      }
      if (
        (funcName === "Modelica.ComplexMath.imag" || funcName === "ComplexMath.imag" || funcName === "imag") &&
        callArgs.length >= 1
      ) {
        const a = toComplexVal(callArgs[0]);
        if (a) return a.im;
      }
      if (
        (funcName === "Modelica.ComplexMath.conj" || funcName === "ComplexMath.conj" || funcName === "conj") &&
        callArgs.length >= 1
      ) {
        const a = toComplexVal(callArgs[0]);
        if (a) return { re: a.re, im: -a.im } as any;
      }
      if ((funcName === "Modelica.ComplexMath.abs" || funcName === "ComplexMath.abs") && callArgs.length >= 1) {
        const a = toComplexVal(callArgs[0]);
        if (a) return Math.hypot(a.re, a.im);
      }
      if (
        (funcName === "Modelica.ComplexMath.arg" || funcName === "ComplexMath.arg" || funcName === "arg") &&
        callArgs.length >= 1
      ) {
        const a = toComplexVal(callArgs[0]);
        if (a) return Math.atan2(a.im, a.re);
      }
      if (
        (funcName === "Modelica.ComplexMath.fromPolar" ||
          funcName === "ComplexMath.fromPolar" ||
          funcName === "fromPolar") &&
        callArgs.length >= 2
      ) {
        if (typeof callArgs[0] === "number" && typeof callArgs[1] === "number") {
          return { re: callArgs[0] * Math.cos(callArgs[1]), im: callArgs[0] * Math.sin(callArgs[1]) } as any;
        }
      }
      if ((funcName === "Modelica.ComplexMath.exp" || funcName === "ComplexMath.exp") && callArgs.length >= 1) {
        const a = toComplexVal(callArgs[0]);
        if (a) {
          const r = Math.exp(a.re);
          return { re: r * Math.cos(a.im), im: r * Math.sin(a.im) } as any;
        }
      }
      if ((funcName === "Modelica.ComplexMath.sqrt" || funcName === "ComplexMath.sqrt") && callArgs.length >= 1) {
        const a = toComplexVal(callArgs[0]);
        if (a) {
          const r = Math.hypot(a.re, a.im);
          const re = Math.sqrt((r + a.re) / 2);
          const im = (a.im >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
          return { re, im } as any;
        }
      }

      const arrayBuiltinRes = evaluateArrayBuiltin(funcName, callArgs);
      if (arrayBuiltinRes !== undefined && arrayBuiltinRes !== null) {
        return arrayBuiltinRes as any;
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
      const buildFill = (dimIdx: number): any => {
        if (dimIdx >= dims.length) return val;
        const n = dims[dimIdx]!;
        const result: any[] = [];
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
            const namedShape = (arena as any).getNamedArrayShape?.(name) ?? (arena as any).namedArrayShapes?.get(name);
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
        let res: any = null;
        try {
          res = evaluateArenaFunctionCall(arena, fnInternId, callArgs, db, scopeId);
          if (res === null && fnBridge.name !== funcName) {
            res = evaluateArenaFunctionCall(arena, arena.interner.intern(funcName), callArgs, db, scopeId);
          }
        } catch {
          return null;
        }
        if (res !== null) {
          (fnBridge as any).wasCalled = true;
          for (const f of arena.functions.values()) {
            if (f.name === fnBridge.name) {
              (f as any).wasCalled = true;
            }
          }
          return res as any;
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
    const iters: { varName: string; values: any[] }[] = [];
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
    const localParams = new Map<string, any>(paramMap);
    const evalIterDepth = (depth: number): any[] | null => {
      const iter = iters[depth]!;
      const prev = localParams.get(iter.varName);
      const outArr: any[] = [];
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
      const res = evaluateArrayBuiltin(cfn, [compArray]);
      if (res !== undefined && res !== null) return res as any;
    }
    return compArray;
  }

  return null;
}

function hasActiveSimpleEqLhs(arena: DAEBuilder, varName: string): boolean {
  let lhsMap = (arena as any)._simpleEqLhsIndices as Map<string, number[]> | undefined;
  let cachedEqCount = (arena as any)._simpleEqLhsEqCount as number | undefined;
  if (!lhsMap || cachedEqCount !== arena.eqCount) {
    lhsMap = new Map<string, number[]>();
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
    (arena as any)._simpleEqLhsIndices = lhsMap;
    (arena as any)._simpleEqLhsEqCount = arena.eqCount;
  }
  const indices = lhsMap.get(varName);
  if (!indices) return false;
  for (const eIdx of indices) {
    if (!arena.isEqRemoved(eIdx)) return true;
  }
  return false;
}

function getArenaConstRecordPrefixMap(arena: DAEBuilder): Map<string, number[]> {
  let map = (arena as any)._constRecPrefixMap as Map<string, number[]> | undefined;
  let cachedCount = (arena as any)._constRecPrefixVarCount as number | undefined;
  if (map && cachedCount === arena.varCount) return map;
  map = new Map<string, number[]>();
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
  (arena as any)._constRecPrefixMap = map;
  (arena as any)._constRecPrefixVarCount = arena.varCount;
  return map;
}

function buildArenaConstRecordObject(
  arena: DAEBuilder,
  varName: string,
  memberVars: number[],
  paramMap: Map<string, any> | undefined,
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
    let fieldVal: any = undefined;
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
    curMap.set(segs[segs.length - 1]!, fieldVal);
    populated++;
  }
  return populated > 0 ? { __kind: "object" as const, fields: rootFields } : null;
}

/**
 * Simplifies an expression by resolving IfElse branches whose condition evaluates to constant.
 */
export function simplifyArenaIfElse(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: Map<string, number>,
  nameToIdx?: Map<string, number>,
  onlyConstants = false,
  allowFinalBoolParams = false,
): number {
  if (exprId < 0 || exprId >= arena.exprCount) return exprId;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.IfElse: {
      const condId = arena.getExprData1(exprId);
      let condVal = evaluateConstantArenaExpression(
        arena,
        condId,
        paramMap,
        nameToIdx,
        0,
        undefined,
        undefined,
        onlyConstants,
      );
      if (
        condVal === null &&
        allowFinalBoolParams &&
        onlyConstants &&
        condId >= 0 &&
        arena.getExprKind(condId) === ExprKind.Name
      ) {
        const cName = arena.interner.resolve(arena.getExprData1(condId));
        if (cName) {
          const allMap = (paramMap as { _allParamMap?: Map<string, any> } | undefined)?._allParamMap;
          const vIdx = nameToIdx ? nameToIdx.get(cName) : arena.getVarIdxByName(cName);
          if (
            vIdx !== undefined &&
            vIdx >= 0 &&
            arena.getVarType(vIdx) === VarType.Boolean &&
            arena.getVarVariability(vIdx) === Variability.Parameter &&
            arena.isVarFinal(vIdx)
          ) {
            if (allMap && allMap.has(cName)) {
              condVal = Boolean(allMap.get(cName));
            } else if (arena.isVarFixed(vIdx)) {
              condVal = arena.getVarStartValue(vIdx) !== 0;
            }
          }
        }
      }
      if (condVal !== null) {
        const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
        const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
        return simplifyArenaIfElse(arena, branchId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      }
      const newCond = simplifyArenaIfElse(arena, condId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      const newRight = simplifyArenaIfElse(arena, rightId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      if (newCond !== condId || newLeft !== leftId || newRight !== rightId) {
        return arena.addIfElseExpr(newCond, newLeft, newRight);
      }
      return exprId;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const leftId = arena.getExprLeft(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      return newLeft !== leftId ? arena.addUnaryExpr(op, newLeft) : exprId;
    }
    case ExprKind.Negate: {
      const leftId = arena.getExprLeft(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      return newLeft !== leftId ? arena.addExpression(ExprKind.Negate, 0, newLeft) : exprId;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      const newRight = simplifyArenaIfElse(arena, rightId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      return newLeft !== leftId || newRight !== rightId ? arena.addBinaryExpr(op, newLeft, newRight) : exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const fnName = arena.interner.resolve(funcNameId) || "";
      const isComplexCall =
        allowFinalBoolParams || fnName === "Complex" || fnName.startsWith("Complex.") || fnName.includes(".Complex");
      const argCount = arena.getExprRight(exprId);
      let changed = false;
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newArg = simplifyArenaIfElse(arena, argId, paramMap, nameToIdx, onlyConstants, isComplexCall);
        if (newArg !== argId) changed = true;
        args.push(newArg);
      }
      if (changed) {
        return arena.addCallExpr(fnName, args);
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseId = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const newBase = simplifyArenaIfElse(arena, baseId, paramMap, nameToIdx, onlyConstants);
      let changed = newBase !== baseId;
      const subs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newSub = simplifyArenaIfElse(arena, subId, paramMap, nameToIdx, onlyConstants);
        if (newSub !== subId) changed = true;
        subs.push(newSub);
      }
      return changed ? arena.addSubscriptExpr(newBase, subs) : exprId;
    }
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 ? redirect : exprId;
      let changed = false;
      const elems: number[] = [];
      for (let i = 0; i < count; i++) {
        const elemId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(baseId + i);
        const newElem = simplifyArenaIfElse(arena, elemId, paramMap, nameToIdx, onlyConstants);
        if (newElem !== elemId) changed = true;
        elems.push(newElem);
      }
      return changed ? arena.addArrayCtorExpr(elems) : exprId;
    }
    default:
      return exprId;
  }
}

function isLiteralOne(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === 1) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === 1) return true;
  return false;
}

function isLiteralMinusOne(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === -1) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === -1) return true;
  if (k === ExprKind.Negate) {
    return isLiteralOne(dae, dae.getExprLeft(exprId));
  }
  if (k === ExprKind.Unary && (dae.getExprData1(exprId) as UnaryOp) === UnaryOp.Negate) {
    return isLiteralOne(dae, dae.getExprLeft(exprId));
  }
  return false;
}

export function _getNegatedInner(dae: DAEBuilder, exprId: number): number | null {
  if (exprId < 0) return null;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.Negate) {
    return dae.getExprLeft(exprId);
  }
  if (k === ExprKind.Unary && (dae.getExprData1(exprId) as UnaryOp) === UnaryOp.Negate) {
    return dae.getExprLeft(exprId);
  }
  if (k === ExprKind.Binary && (dae.getExprData1(exprId) === BinOp.Mul || dae.getExprData1(exprId) === BinOp.ElemMul)) {
    const l = dae.getExprLeft(exprId);
    const r = dae.getExprRight(exprId);
    if (isLiteralMinusOne(dae, l)) return r;
    if (isLiteralMinusOne(dae, r)) return l;
  }
  return null;
}

function isRealTypedArenaExpr(arena: DAEBuilder, id: number, nameToIdx?: Map<string, number>): boolean {
  if (id < 0 || id >= arena.exprCount) return false;
  const k = arena.getExprKind(id);
  if (k === ExprKind.RealLiteral || k === ExprKind.Der) return true;
  if (
    k === ExprKind.IntLiteral ||
    k === ExprKind.BoolLiteral ||
    k === ExprKind.StringLiteral ||
    k === ExprKind.EnumLiteral
  ) {
    return false;
  }
  if (k === ExprKind.Name) {
    const varName = arena.interner.resolve(arena.getExprData1(id));
    const varIdx = nameToIdx ? nameToIdx.get(varName) : arena.getVarIdxByName(varName);
    return varIdx !== undefined && varIdx >= 0 ? arena.getVarType(varIdx) === VarType.Real : false;
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    return isRealTypedArenaExpr(arena, arena.getExprLeft(id), nameToIdx);
  }
  if (k === ExprKind.Binary) {
    const op = arena.getExprData1(id) as BinOp;
    if (op === BinOp.Div || op === BinOp.ElemDiv) return true;
    return (
      isRealTypedArenaExpr(arena, arena.getExprLeft(id), nameToIdx) ||
      isRealTypedArenaExpr(arena, arena.getExprRight(id), nameToIdx)
    );
  }
  if (k === ExprKind.IfElse) {
    return (
      isRealTypedArenaExpr(arena, arena.getExprLeft(id), nameToIdx) ||
      isRealTypedArenaExpr(arena, arena.getExprRight(id), nameToIdx)
    );
  }
  if (k === ExprKind.Call) {
    const fnName = (arena.interner.resolve(arena.getExprData1(id)) || "").toLowerCase();
    if (
      fnName === "integer" ||
      fnName === "div" ||
      fnName === "cardinality" ||
      fnName === "size" ||
      fnName === "ndims"
    ) {
      return false;
    }
    if (
      fnName === "/*real*/" ||
      fnName === "real" ||
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
      fnName === "floor" ||
      fnName === "ceil" ||
      fnName === "der" ||
      fnName === "homotopy" ||
      fnName === "semilinear"
    ) {
      return true;
    }
    const argCount = arena.getExprRight(id);
    for (let i = 0; i < argCount; i++) {
      const argId = i === 0 ? arena.getExprLeft(id) : arena.getExprLeft(id + i);
      if (isRealTypedArenaExpr(arena, argId, nameToIdx)) return true;
    }
  }
  return false;
}

/**
 * Recursively substitute known constant variables in an expression with their literal values.
 */
const subConstRecordPrefixCache = new WeakMap<Map<string, any>, Map<string, number[]>>();

function getSubRecordPrefixMap(nameToIdx: Map<string, number>, constMap: Map<string, any>): Map<string, number[]> {
  let cached = subConstRecordPrefixCache.get(constMap);
  if (cached) return cached;
  cached = new Map<string, number[]>();
  for (const [vName, idx] of nameToIdx) {
    let dot = vName.indexOf(".");
    while (dot > 0) {
      const pfx = vName.slice(0, dot);
      if (!nameToIdx.has(pfx)) {
        let arr = cached.get(pfx);
        if (!arr) {
          arr = [];
          cached.set(pfx, arr);
        }
        arr.push(idx);
      }
      dot = vName.indexOf(".", dot + 1);
    }
  }
  subConstRecordPrefixCache.set(constMap, cached);
  return cached;
}

function tryInlineEvaluatedRecordCallArg(
  arena: DAEBuilder,
  recName: string,
  expectedTypeName: string | undefined,
  constMap: Map<string, any>,
  nameToIdx: Map<string, number>,
): number {
  const childIndices = getSubRecordPrefixMap(nameToIdx, constMap).get(recName);
  if (!childIndices || childIndices.length === 0) return -1;
  const dotPrefix = `${recName}.`;
  const directFieldVals = new Map<string, { vIdx: number; val: any }>();
  for (const cIdx of childIndices) {
    if (arena.isVarRemoved(cIdx)) continue;
    const vn = arena.getVarName(cIdx);
    const vb = arena.getVarVariability(cIdx);
    if (vb !== Variability.Constant && vb !== Variability.Parameter) return -1;
    if (!constMap.has(vn)) return -1;
    const rel = vn.slice(dotPrefix.length);
    if (rel.includes(".") || rel.includes("[")) return -1;
    directFieldVals.set(rel, { vIdx: cIdx, val: constMap.get(vn) });
  }
  if (directFieldVals.size === 0) return -1;

  const isAutoCtor = (fn: DAEBuilder): boolean =>
    Boolean(fn.description?.startsWith("Automatically generated record constructor"));

  let matchedCtor: DAEBuilder | undefined;
  let matchedInputs: string[] | undefined;

  const checkCtorMatches = (fn: DAEBuilder): string[] | null => {
    const constSet = (fn as any)._recordConstVarIndices as Set<number> | undefined;
    const inputs: string[] = [];
    for (let vi = 0; vi < fn.varCount; vi++) {
      if (fn.isVarRemoved(vi)) continue;
      const vName = fn.getVarName(vi);
      if (vName === "res") continue;
      if (fn.getVarCausality(vi) === Causality.Input || Boolean(constSet?.has(vi))) {
        inputs.push(vName);
      }
    }
    if (inputs.length !== directFieldVals.size) return null;
    for (const inp of inputs) {
      if (!directFieldVals.has(inp)) return null;
    }
    return inputs;
  };

  const preferredTypeName = ((arena as any).foldedRecordTypes as Map<string, string> | undefined)?.get(recName);
  for (const candType of [preferredTypeName, expectedTypeName]) {
    if (!candType) continue;
    const directFn = arena.functions.get(candType);
    if (directFn && isAutoCtor(directFn)) {
      const m = checkCtorMatches(directFn);
      if (m) {
        matchedCtor = directFn;
        matchedInputs = m;
        break;
      }
    }
    for (const fn of new Set(arena.functions.values())) {
      if (!isAutoCtor(fn) || fn.name.includes("$")) continue;
      if (fn.name === candType || fn.name.endsWith(`.${candType}`)) {
        const m = checkCtorMatches(fn);
        if (m) {
          matchedCtor = fn;
          matchedInputs = m;
          break;
        }
      }
    }
    if (matchedCtor) break;
  }
  if (!matchedCtor) {
    for (const fn of new Set(arena.functions.values())) {
      if (!isAutoCtor(fn)) continue;
      if (fn.name.includes("$")) continue;
      const m = checkCtorMatches(fn);
      if (m) {
        matchedCtor = fn;
        matchedInputs = m;
        break;
      }
    }
  }
  if (!matchedCtor || !matchedInputs) return -1;

  const argExprIds: number[] = [];
  for (const inp of matchedInputs) {
    const entry = directFieldVals.get(inp)!;
    const vt = arena.getVarType(entry.vIdx);
    const v = entry.val;
    if (typeof v === "boolean") {
      argExprIds.push(arena.addBoolLiteral(v));
    } else if (typeof v === "number" && Number.isFinite(v)) {
      if (vt === VarType.Integer) argExprIds.push(arena.addIntLiteral(Math.trunc(v)));
      else if (vt === VarType.Boolean) argExprIds.push(arena.addBoolLiteral(v !== 0));
      else if (vt === VarType.Enumeration) return -1;
      else argExprIds.push(arena.addRealLiteral(v));
    } else if (typeof v === "string") {
      argExprIds.push(arena.addStringLiteral(v));
    } else {
      return -1;
    }
  }
  return arena.addCallExpr(matchedCtor.name, argExprIds);
}

export function substituteArenaConstants(
  arena: DAEBuilder,
  exprId: number,
  constMap: Map<string, number>,
  nameToIdx?: Map<string, number>,
): number {
  if (exprId < 0 || exprId >= arena.exprCount) return exprId;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varName = arena.interner.resolve(nameId);
      if (constMap.has(varName)) {
        const val = constMap.get(varName)!;
        const varIdx = nameToIdx?.get(varName);
        const varType = varIdx !== undefined ? arena.getVarType(varIdx) : VarType.Real;
        if (varType === VarType.Integer && typeof val === "number") {
          return arena.addIntLiteral(Math.trunc(val));
        } else if (varType === VarType.Boolean) {
          return arena.addBoolLiteral(Boolean(val));
        } else if (varType === VarType.Real && typeof val === "number") {
          return arena.addRealLiteral(val);
        } else if (varType === VarType.String && typeof val === "string") {
          return arena.addStringLiteral(val);
        }
        return exprId;
      }
      return exprId;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const right = substituteArenaConstants(arena, arena.getExprRight(exprId), constMap, nameToIdx);
      const newBinId =
        left !== arena.getExprLeft(exprId) || right !== arena.getExprRight(exprId)
          ? arena.addBinaryExpr(op, left, right)
          : exprId;
      if (op !== BinOp.Colon) {
        const lKind = left >= 0 ? arena.getExprKind(left) : -1;
        const rKind = right >= 0 ? arena.getExprKind(right) : -1;
        const canFoldBin =
          lKind !== ExprKind.Name &&
          lKind !== ExprKind.Der &&
          lKind !== ExprKind.Pre &&
          lKind !== ExprKind.Binary &&
          rKind !== ExprKind.Name &&
          rKind !== ExprKind.Der &&
          rKind !== ExprKind.Pre &&
          rKind !== ExprKind.Binary;
        const folded = canFoldBin
          ? evaluateConstantArenaExpression(arena, newBinId, constMap, nameToIdx, 0, undefined, undefined, true)
          : null;
        if (typeof folded === "number") {
          if (
            op === BinOp.Div ||
            op === BinOp.ElemDiv ||
            isRealTypedArenaExpr(arena, left, nameToIdx) ||
            isRealTypedArenaExpr(arena, right, nameToIdx)
          ) {
            return arena.addRealLiteral(folded);
          }
          return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
        }
        if (typeof folded === "boolean") {
          return arena.addBoolLiteral(folded);
        }

        // Algebraic simplifications when one operand is constant
        if (op === BinOp.Mul) {
          if (isLiteralZero(arena, left)) return left;
          if (isLiteralZero(arena, right)) return right;
          if (isLiteralOne(arena, left)) return right;
          if (isLiteralOne(arena, right)) return left;
          if (isLiteralMinusOne(arena, left)) {
            return arena.addUnaryExpr(UnaryOp.Negate, right);
          }
          if (isLiteralMinusOne(arena, right)) {
            return arena.addUnaryExpr(UnaryOp.Negate, left);
          }
          // Fold associative scalar constants: (c1 * x) * c2 -> (c1 * c2) * x and c1 * (c2 * x) -> (c1 * c2) * x
          const getNumLit = (id: number): { val: number; isReal: boolean } | null => {
            const k = arena.getExprKind(id);
            if (k === ExprKind.RealLiteral) return { val: arena.getExprRealValue(id), isReal: true };
            if (k === ExprKind.IntLiteral) return { val: arena.getExprData1(id), isReal: false };
            return null;
          };
          const lLit = getNumLit(left);
          const rLit = getNumLit(right);
          const mkNum = (val: number, isReal: boolean): number =>
            isReal ? arena.addRealLiteral(val) : arena.addIntLiteral(Math.trunc(val));
          if (rLit && arena.getExprKind(left) === ExprKind.Binary && arena.getExprData1(left) === BinOp.Mul) {
            const la = arena.getExprLeft(left);
            const lb = arena.getExprRight(left);
            const laLit = getNumLit(la);
            const lbLit = getNumLit(lb);
            if (laLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(laLit.val * rLit.val, laLit.isReal || rLit.isReal), lb);
            }
            if (lbLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(lbLit.val * rLit.val, lbLit.isReal || rLit.isReal), la);
            }
          } else if (lLit && arena.getExprKind(right) === ExprKind.Binary && arena.getExprData1(right) === BinOp.Mul) {
            const ra = arena.getExprLeft(right);
            const rb = arena.getExprRight(right);
            const raLit = getNumLit(ra);
            const rbLit = getNumLit(rb);
            if (raLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(lLit.val * raLit.val, lLit.isReal || raLit.isReal), rb);
            }
            if (rbLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(lLit.val * rbLit.val, lLit.isReal || rbLit.isReal), ra);
            }
          }
        } else if (op === BinOp.Add) {
          if (isLiteralZero(arena, left)) return right;
          if (isLiteralZero(arena, right)) return left;
          if (
            left !== arena.getExprLeft(exprId) &&
            arena.getExprKind(left) === ExprKind.Unary &&
            (arena.getExprData1(left) as UnaryOp) === UnaryOp.Negate
          ) {
            return arena.addBinaryExpr(BinOp.Sub, right, arena.getExprLeft(left));
          }
        } else if (op === BinOp.Sub) {
          if (isLiteralZero(arena, right)) return left;
          if (isLiteralZero(arena, left)) {
            return arena.addUnaryExpr(UnaryOp.Negate, right);
          }
        } else if (op === BinOp.Div) {
          if (isLiteralOne(arena, right)) return left;
        } else if ((op === BinOp.Pow || op === BinOp.ElemPow) && isLiteralOne(arena, right)) {
          return left;
        }
      }
      return newBinId;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const newUnId = left !== arena.getExprLeft(exprId) ? arena.addUnaryExpr(op, left) : exprId;
      const lKind = left >= 0 ? arena.getExprKind(left) : -1;
      const folded =
        lKind !== ExprKind.Name && lKind !== ExprKind.Der && lKind !== ExprKind.Pre && lKind !== ExprKind.Binary
          ? evaluateConstantArenaExpression(arena, newUnId, constMap, nameToIdx, 0, undefined, undefined, true)
          : null;
      if (typeof folded === "number") {
        if (isRealTypedArenaExpr(arena, left, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
      }
      return newUnId;
    }
    case ExprKind.Negate: {
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const newNegId = left !== arena.getExprLeft(exprId) ? arena.addExpression(ExprKind.Negate, 0, left) : exprId;
      const lKind = left >= 0 ? arena.getExprKind(left) : -1;
      const folded =
        lKind !== ExprKind.Name && lKind !== ExprKind.Der && lKind !== ExprKind.Pre && lKind !== ExprKind.Binary
          ? evaluateConstantArenaExpression(arena, newNegId, constMap, nameToIdx, 0, undefined, undefined, true)
          : null;
      if (typeof folded === "number") {
        if (isRealTypedArenaExpr(arena, left, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      return newNegId;
    }
    case ExprKind.Der: {
      const data1 = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      const k = arena.getExprKind(data1);
      if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
        return arena.addRealLiteral(0.0);
      }
      if (k === ExprKind.Name) {
        const name = arena.interner.resolve(arena.getExprData1(data1));
        const idx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
        if (idx !== undefined && idx >= 0) {
          const v = arena.getVarVariability(idx);
          if (v === Variability.Constant || v === Variability.Parameter) {
            return arena.addRealLiteral(0.0);
          }
        }
      }
      if (k === ExprKind.Subscript) {
        const baseId = arena.getExprData1(data1);
        if (baseId >= 0 && arena.getExprKind(baseId) === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(baseId));
          const idx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
          if (idx !== undefined && idx >= 0) {
            const v = arena.getVarVariability(idx);
            if (v === Variability.Constant || v === Variability.Parameter) {
              return arena.addRealLiteral(0.0);
            }
          }
        }
      }
      if (data1 !== arena.getExprData1(exprId)) {
        return arena.addDerExpr(data1);
      }
      return exprId;
    }
    case ExprKind.Pre: {
      const data1 = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      if (data1 !== arena.getExprData1(exprId)) {
        return arena.addPreExpr(data1);
      }
      return exprId;
    }
    case ExprKind.IfElse: {
      const cond = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const right = substituteArenaConstants(arena, arena.getExprRight(exprId), constMap, nameToIdx);
      const condKind = arena.getExprKind(cond);
      if (condKind === ExprKind.BoolLiteral) {
        return arena.getExprData1(cond) !== 0 ? left : right;
      }
      if (condKind === ExprKind.IntLiteral) {
        return arena.getExprData1(cond) !== 0 ? left : right;
      }
      if (
        cond !== arena.getExprData1(exprId) ||
        left !== arena.getExprLeft(exprId) ||
        right !== arena.getExprRight(exprId)
      ) {
        return arena.addIfElseExpr(cond, left, right);
      }
      return exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const fnName = arena.interner.resolve(funcNameId) || "";
      const argCount = arena.getExprRight(exprId);
      const calledFnDae = arena.functions.size > 0 ? arena.functions.get(fnName) : undefined;
      let calledFnInputTypes: string[] | undefined;
      if (calledFnDae) {
        calledFnInputTypes = [];
        for (let vi = 0; vi < calledFnDae.varCount; vi++) {
          if (!calledFnDae.isVarRemoved(vi) && calledFnDae.getVarCausality(vi) === Causality.Input) {
            calledFnInputTypes.push(calledFnDae.getVarCustomType(vi) ?? "");
          }
        }
      }
      let anyChanged = false;
      const args: number[] = [];
      const allParamMap = (constMap as { _allParamMap?: Map<string, any> })._allParamMap;
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const curIsStructuralClocked =
          i >= 1 &&
          (fnName === "shiftSample" || fnName === "subSample" || fnName === "superSample" || fnName === "backSample");
        const curIsClockSolver = i === 1 && fnName === "Clock";
        let preserveClockParam = false;
        if (i === 0 && fnName === "Clock" && argExprId >= 0 && arena.getExprKind(argExprId) === ExprKind.Name) {
          const argName = arena.interner.resolve(arena.getExprData1(argExprId));
          const vIdx = argName ? (nameToIdx ? nameToIdx.get(argName) : arena.getVarIdxByName(argName)) : undefined;
          if (vIdx !== undefined && vIdx >= 0 && arena.getVarVariability(vIdx) === Variability.Parameter) {
            preserveClockParam = true;
          }
        }
        let inlinedRec = -1;
        if (
          !preserveClockParam &&
          calledFnDae &&
          constMap.size > 0 &&
          nameToIdx &&
          nameToIdx.size > 0 &&
          arena.functions.size > 0 &&
          argExprId >= 0 &&
          arena.getExprKind(argExprId) === ExprKind.Name
        ) {
          const argName = arena.interner.resolve(arena.getExprData1(argExprId));
          if (argName && !nameToIdx.has(argName)) {
            inlinedRec = tryInlineEvaluatedRecordCallArg(
              arena,
              argName,
              calledFnInputTypes?.[i] || undefined,
              constMap,
              nameToIdx,
            );
          }
        }
        let subMap = constMap;
        if (allParamMap && argExprId >= 0) {
          if (curIsStructuralClocked) {
            subMap = allParamMap;
            if (arena.getExprKind(argExprId) === ExprKind.Name) {
              const argName = arena.interner.resolve(arena.getExprData1(argExprId));
              const vIdx = argName ? (nameToIdx ? nameToIdx.get(argName) : arena.getVarIdxByName(argName)) : undefined;
              if (
                vIdx !== undefined &&
                vIdx >= 0 &&
                arena.getVarVariability(vIdx) === Variability.Parameter &&
                arena.isVarFixed(vIdx) &&
                !arena.isVarFinal(vIdx)
              ) {
                arena.setVarFinal(vIdx, true);
              }
            }
          } else if (curIsClockSolver && arena.getExprKind(argExprId) === ExprKind.Name) {
            const argName = arena.interner.resolve(arena.getExprData1(argExprId));
            const vIdx = argName ? (nameToIdx ? nameToIdx.get(argName) : arena.getVarIdxByName(argName)) : undefined;
            if (
              vIdx !== undefined &&
              vIdx >= 0 &&
              arena.getVarVariability(vIdx) === Variability.Parameter &&
              arena.isVarFixed(vIdx) &&
              arena.getVarType(vIdx) === VarType.String
            ) {
              if (!arena.isVarFinal(vIdx)) arena.setVarFinal(vIdx, true);
              subMap = allParamMap;
            }
          }
        }
        const newArg =
          inlinedRec >= 0
            ? inlinedRec
            : preserveClockParam
              ? argExprId
              : substituteArenaConstants(arena, argExprId, subMap, nameToIdx);
        args.push(newArg);
        if (newArg !== argExprId) anyChanged = true;
      }
      if (fnName === "der" && args.length >= 1) {
        const arg0 = args[0]!;
        const k = arena.getExprKind(arg0);
        if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
          return arena.addRealLiteral(0.0);
        }
        if (k === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(arg0));
          const idx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
          if (idx !== undefined && idx >= 0) {
            const v = arena.getVarVariability(idx);
            if (v === Variability.Constant || v === Variability.Parameter) {
              return arena.addRealLiteral(0.0);
            }
          }
        }
      }
      const callId = anyChanged ? arena.addCallExpr(fnName, args) : exprId;
      if (
        args.length === 0 &&
        (fnName === "Modelica.Mechanics.MultiBody.Frames.nullRotation" || fnName === "Frames.nullRotation") &&
        Boolean((arena.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"])
      ) {
        const mkRow = (a: number, b: number, c: number) =>
          arena.addArrayCtorExpr([arena.addRealLiteral(a), arena.addRealLiteral(b), arena.addRealLiteral(c)]);
        const matT = arena.addArrayCtorExpr([mkRow(1.0, 0.0, 0.0), mkRow(0.0, 1.0, 0.0), mkRow(0.0, 0.0, 1.0)]);
        const vecW = mkRow(0.0, 0.0, 0.0);
        return arena.addCallExpr("Modelica.Mechanics.MultiBody.Frames.Orientation", [matT, vecW]);
      }
      const folded = evaluateConstantArenaExpression(arena, callId, constMap, nameToIdx, 0, undefined, undefined, true);
      if (
        folded !== null &&
        typeof folded === "object" &&
        !Array.isArray(folded) &&
        typeof (folded as any).re === "number" &&
        typeof (folded as any).im === "number" &&
        Number.isFinite((folded as any).re) &&
        Number.isFinite((folded as any).im) &&
        (fnName === "Complex.'constructor'.fromReal" || fnName.endsWith(".Complex.'constructor'.fromReal"))
      ) {
        return arena.addCallExpr("Complex", [
          arena.addRealLiteral((folded as any).re),
          arena.addRealLiteral((folded as any).im),
        ]);
      }
      if (
        Array.isArray(folded) &&
        (fnName === "Modelica.Math.Vectors.normalize" ||
          fnName.endsWith(".Vectors.normalize") ||
          fnName === "Modelica.Math.Vectors.normalizeWithAssert" ||
          fnName.endsWith(".Vectors.normalizeWithAssert"))
      ) {
        return arrayValueToArenaExpr(arena, folded, VarType.Real);
      }
      if (typeof folded === "number") {
        if (fnName === "/*Real*/" || fnName === "Real" || isRealTypedArenaExpr(arena, callId, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
      }
      if (typeof folded === "string") {
        return arena.addStringLiteral(folded);
      }
      return callId;
    }
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      let anyChanged = false;
      const elements: number[] = [];
      for (let i = 0; i < count; i++) {
        const elemId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newElem = substituteArenaConstants(arena, elemId, constMap, nameToIdx);
        elements.push(newElem);
        if (newElem !== elemId) anyChanged = true;
      }
      if (anyChanged) {
        return arena.addArrayCtorExpr(elements);
      }
      return exprId;
    }
    case ExprKind.Range: {
      const origStart = arena.getExprData1(exprId);
      const origStep = arena.getExprLeft(exprId);
      const origStop = arena.getExprRight(exprId);
      const start = substituteArenaConstants(arena, origStart, constMap, nameToIdx);
      const step = origStep >= 0 ? substituteArenaConstants(arena, origStep, constMap, nameToIdx) : -1;
      const stop = substituteArenaConstants(arena, origStop, constMap, nameToIdx);
      if (start !== origStart || (origStep >= 0 && step !== origStep) || stop !== origStop) {
        return arena.addRange(start, stop, step);
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseExprId = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      let newBase = substituteArenaConstants(arena, baseExprId, constMap, nameToIdx);
      let anyChanged = newBase !== baseExprId;
      const newSubs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newSub = substituteArenaConstants(arena, subId, constMap, nameToIdx);
        newSubs.push(newSub);
        if (newSub !== subId) anyChanged = true;
      }
      let elemVarType: VarType | undefined;
      if (
        (subCount === 1 || subCount === 2) &&
        nameToIdx &&
        newBase === baseExprId &&
        arena.getExprKind(baseExprId) === ExprKind.Name
      ) {
        const baseName = arena.interner.resolve(arena.getExprData1(baseExprId));
        if (baseName && !nameToIdx.has(baseName)) {
          const resolveConstElemExpr = (elemVarIdx: number, elemKey: string): number => {
            const vt = arena.getVarType(elemVarIdx);
            const elemBind = arena.getVarExpression(elemVarIdx);
            if (elemBind !== undefined && elemBind >= 0) {
              const ek = arena.getExprKind(elemBind);
              if (
                ek === ExprKind.RealLiteral ||
                ek === ExprKind.IntLiteral ||
                ek === ExprKind.BoolLiteral ||
                ek === ExprKind.StringLiteral ||
                ek === ExprKind.EnumLiteral
              ) {
                return elemBind;
              }
              if (
                ek === ExprKind.Negate ||
                (ek === ExprKind.Unary && arena.getExprData1(elemBind) === UnaryOp.Negate)
              ) {
                const inner = arena.getExprLeft(elemBind);
                const ik = inner >= 0 ? arena.getExprKind(inner) : -1;
                if (ik === ExprKind.RealLiteral || ik === ExprKind.IntLiteral) {
                  return elemBind;
                }
              }
            }
            if (constMap.has(elemKey)) {
              const cv = constMap.get(elemKey)!;
              if (vt === VarType.Integer && typeof cv === "number") return arena.addIntLiteral(Math.trunc(cv));
              if (vt === VarType.Boolean) return arena.addBoolLiteral(Boolean(cv));
              if (vt === VarType.Real && typeof cv === "number") return arena.addRealLiteral(cv);
            }
            return -1;
          };

          const firstIdx = subCount === 1 ? nameToIdx.get(`${baseName}[1]`) : undefined;
          if (firstIdx !== undefined && arena.getVarVariability(firstIdx) === Variability.Constant) {
            elemVarType = arena.getVarType(firstIdx);
            const elemIds: number[] = [];
            let k = 1;
            let allConst = true;
            while (k <= 2048) {
              const elemKey = `${baseName}[${k}]`;
              const elemVarIdx = nameToIdx.get(elemKey);
              if (elemVarIdx === undefined) break;
              if (arena.getVarVariability(elemVarIdx) !== Variability.Constant) {
                allConst = false;
                break;
              }
              const elemExpr = resolveConstElemExpr(elemVarIdx, elemKey);
              if (elemExpr < 0) {
                allConst = false;
                break;
              }
              elemIds.push(elemExpr);
              k++;
            }
            if (allConst && elemIds.length > 0) {
              newBase = arena.addArrayCtorExpr(elemIds);
              anyChanged = true;
            }
          } else if (firstIdx === undefined) {
            const prefix = `${baseName}[`;
            const flatElems: number[] = [];
            const rowMap = new Map<string, number[]>();
            let dims = 0;
            let count = 0;
            let allConst = true;
            const splitIndexParts = (inside: string): string[] => {
              const parts: string[] = [];
              let inQuote = false;
              let start = 0;
              for (let p = 0; p < inside.length; p++) {
                const ch = inside[p];
                if (ch === "'") inQuote = !inQuote;
                else if (ch === "," && !inQuote) {
                  parts.push(inside.slice(start, p).trim());
                  start = p + 1;
                }
              }
              parts.push(inside.slice(start).trim());
              return parts;
            };
            for (const [key, elemVarIdx] of nameToIdx) {
              if (!key.startsWith(prefix)) continue;
              if (arena.isVarRemoved(elemVarIdx)) continue;
              const rest = key.slice(prefix.length);
              const closeIdx = rest.indexOf("]");
              if (closeIdx < 0 || closeIdx !== rest.length - 1) {
                allConst = false;
                break;
              }
              if (arena.getVarVariability(elemVarIdx) !== Variability.Constant) {
                allConst = false;
                break;
              }
              if (elemVarType === undefined) elemVarType = arena.getVarType(elemVarIdx);
              const elemExpr = resolveConstElemExpr(elemVarIdx, key);
              if (elemExpr < 0) {
                allConst = false;
                break;
              }
              const parts = splitIndexParts(rest.slice(0, closeIdx));
              if (dims === 0) dims = parts.length;
              if (parts.length !== dims || (dims !== 1 && dims !== 2)) {
                allConst = false;
                break;
              }
              count++;
              if (count > 2048) {
                allConst = false;
                break;
              }
              if (dims === 1) {
                flatElems.push(elemExpr);
              } else {
                const rowKey = parts[0]!;
                let row = rowMap.get(rowKey);
                if (!row) {
                  row = [];
                  rowMap.set(rowKey, row);
                }
                row.push(elemExpr);
              }
            }
            if (allConst && count > 0) {
              if (dims === 1 && subCount === 1 && flatElems.length > 0) {
                newBase = arena.addArrayCtorExpr(flatElems);
                anyChanged = true;
              } else if (dims === 2 && rowMap.size > 0) {
                const rows = [...rowMap.values()];
                const rowLen = rows[0]!.length;
                if (rowLen > 0 && rows.every((r) => r.length === rowLen)) {
                  const rowExprIds = rows.map((r) => arena.addArrayCtorExpr(r));
                  newBase = arena.addArrayCtorExpr(rowExprIds);
                  anyChanged = true;
                }
              }
            }
          }
        }
      }
      const subExprId = anyChanged ? arena.addSubscriptExpr(newBase, newSubs) : exprId;
      const folded = evaluateConstantArenaExpression(
        arena,
        subExprId,
        constMap,
        nameToIdx,
        0,
        undefined,
        undefined,
        true,
      );
      if (elemVarType !== VarType.Enumeration) {
        if (typeof folded === "number" && Number.isFinite(folded)) {
          if (elemVarType === VarType.Integer && Number.isInteger(folded)) {
            return arena.addIntLiteral(folded);
          }
          return arena.addRealLiteral(folded);
        }
        if (typeof folded === "boolean") {
          return arena.addBoolLiteral(folded);
        }
      }
      return subExprId;
    }
    case ExprKind.Comprehension: {
      const fnId = arena.getExprData1(exprId);
      const bodyId = arena.getExprLeft(exprId);
      const iterCount = arena.getExprRight(exprId);
      const iters: { iterNameId: number; rangeExprId: number }[] = [];
      let shadowed = false;
      let changed = false;
      let innerMap = constMap;
      for (let i = 0; i < iterCount; i++) {
        const iterSlot = exprId + 1 + i;
        const iterNameId = arena.getExprData1(iterSlot);
        const iterVarName = arena.interner.resolve(iterNameId);
        const rangeExprId = arena.getExprLeft(iterSlot);
        const newRangeExprId = shadowed
          ? rangeExprId
          : substituteArenaConstants(arena, rangeExprId, innerMap, nameToIdx);
        if (newRangeExprId !== rangeExprId) changed = true;
        if (iterVarName && innerMap.has(iterVarName)) {
          if (innerMap === constMap) innerMap = new Map(constMap);
          innerMap.delete(iterVarName);
        }
        iters.push({ iterNameId, rangeExprId: newRangeExprId });
      }
      const newBodyId = substituteArenaConstants(arena, bodyId, innerMap, nameToIdx);
      if (newBodyId !== bodyId) changed = true;
      if (!changed) return exprId;
      const compId = arena.addExpression(ExprKind.Comprehension, fnId, newBodyId, iters.length);
      for (const iter of iters) {
        arena.addExpression(ExprKind.Tuple, iter.iterNameId, iter.rangeExprId, 0);
      }
      return compId;
    }
    default:
      return exprId;
  }
}

function arrayValueToArenaExpr(arena: DAEBuilder, val: any, varType: VarType): number {
  if (Array.isArray(val)) {
    const elemIds = val.map((item) => arrayValueToArenaExpr(arena, item, varType));
    return arena.addArrayCtorExpr(elemIds);
  }
  if (typeof val === "number") {
    return varType === VarType.Integer ? arena.addIntLiteral(Math.trunc(val)) : arena.addRealLiteral(val);
  }
  if (typeof val === "boolean") {
    return arena.addBoolLiteral(val);
  }
  if (typeof val === "string") {
    return arena.addStringLiteral(val);
  }
  if (val !== null && typeof val === "object") {
    let reVal: unknown;
    let imVal: unknown;
    if (typeof val.re === "number" && typeof val.im === "number") {
      reVal = val.re;
      imVal = val.im;
    } else if (
      (val as any).__kind === "object" &&
      (val as any).fields instanceof Map &&
      (val as any).fields.size === 2
    ) {
      reVal = (val as any).fields.get("re");
      imVal = (val as any).fields.get("im");
    } else if ((val as any).__fields instanceof Map && (val as any).__fields.size === 2) {
      reVal = (val as any).__fields.get("re");
      imVal = (val as any).__fields.get("im");
    }
    if (typeof reVal === "number" && typeof imVal === "number") {
      return arena.addCallExpr("Complex", [arena.addRealLiteral(reVal), arena.addRealLiteral(imVal)]);
    }
  }
  return arena.addRealLiteral(Number(val));
}

/**
 * In-place constant fold for a single equation in the arena.
 */
export function foldSingleArenaEquation(
  arena: DAEBuilder,
  eq: number,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
  paramMap?: Map<string, number>,
): boolean {
  if (eq < 0 || eq >= arena.eqCount) return false;
  const nameToIdx = new Map<string, number>();
  if (!paramMap) {
    paramMap = new Map<string, number>();
    for (let i = 0; i < arena.varCount; i++) {
      if (!arena.isVarRemoved(i)) {
        const v = arena.getVarVariability(i);
        const name = arena.getVarName(i);
        nameToIdx.set(name, i);
        if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFixed(i))) {
          paramMap.set(name, arena.getVarStartValue(i));
        }
      }
    }
  }

  const eqKind = arena.getEqKind(eq);
  if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
    let lhsExpr = arena.getEqLhs(eq);
    const origRhs = (arena as any).getOrigEqRhs ? (arena as any).getOrigEqRhs(eq) : arena.getEqRhs(eq);
    let rhsExpr = origRhs >= 0 ? origRhs : arena.getEqRhs(eq);
    if (rhsExpr >= 0 && (arena.getExprKind(rhsExpr) !== ExprKind.ArrayCtor || !omcCompatibility)) {
      const foldedRhs = evaluateConstantArenaExpression(arena, rhsExpr, paramMap, nameToIdx, 0, db, scopeId);
      if (foldedRhs !== null) {
        let varType = VarType.Real;
        if (arena.getExprKind(lhsExpr) === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
          let varIdx = nameToIdx.get(varName);
          if (varIdx === undefined) {
            const prefixMatch = `${varName}[`;
            for (const [k, idx] of nameToIdx) {
              if (k.startsWith(prefixMatch)) {
                varIdx = idx;
                break;
              }
            }
          }
          if (varIdx !== undefined) varType = arena.getVarType(varIdx);
        }
        let newRhs: number;
        if (Array.isArray(foldedRhs)) {
          newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
        } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
          newRhs = arena.addBoolLiteral(foldedRhs);
        } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
          newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
        } else if (varType === VarType.String || typeof foldedRhs === "string") {
          newRhs = arena.addStringLiteral(String(foldedRhs));
        } else if (typeof foldedRhs === "number") {
          newRhs = arena.addRealLiteral(foldedRhs);
        } else {
          newRhs = rhsExpr;
        }
        if (newRhs !== rhsExpr) {
          arena.setEqRhs(eq, newRhs);
          rhsExpr = newRhs;
        }
      }

      const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, paramMap, nameToIdx);
      if (simplifiedRhs !== rhsExpr) {
        arena.setEqRhs(eq, simplifiedRhs);
        rhsExpr = simplifiedRhs;
      }
      const constMap = new Map<string, number>();
      for (let i = 0; i < arena.varCount; i++) {
        if (
          !arena.isVarRemoved(i) &&
          arena.getVarVariability(i) === Variability.Constant &&
          arena.getVarType(i) !== VarType.String &&
          arena.hasExplicitVarExpression(i)
        ) {
          constMap.set(arena.getVarName(i), arena.getVarStartValue(i));
        }
      }
      const constSubRhs = substituteArenaConstants(arena, rhsExpr, constMap, nameToIdx);
      if (constSubRhs !== rhsExpr) arena.setEqRhs(eq, constSubRhs);
      const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, paramMap, nameToIdx);
      if (simplifiedLhs !== lhsExpr) arena.setEqLhs(eq, simplifiedLhs);
      const constSubLhs = substituteArenaConstants(arena, lhsExpr, constMap, nameToIdx);
      if (constSubLhs !== lhsExpr) arena.setEqLhs(eq, constSubLhs);
      return true;
    }
  }
  return false;
}

/**
 * In-place constant fold targeting only equations that reference a specific parameter.
 */
export function foldTargetedParamEquations(
  arena: DAEBuilder,
  paramName: string,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
): void {
  const paramMap = new Map<string, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      const v = arena.getVarVariability(i);
      if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFixed(i))) {
        paramMap.set(arena.getVarName(i), arena.getVarStartValue(i));
      }
    }
  }

  // Update dependent parameters that reference paramName
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Constant || v === Variability.Parameter) {
      const name = arena.getVarName(i);
      if (name === paramName) continue;
      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
        if ((arena as any).exprReferencesName?.(exprId, paramName)) {
          const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, undefined, 0, db, scopeId);
          if (evalVal !== null && typeof evalVal === "number") {
            arena.setVarStartValue(i, evalVal);
            paramMap.set(name, evalVal);
          }
        }
      }
    }
  }

  const affectedEqs = (arena as any).getEquationsReferencingParam
    ? (arena as any).getEquationsReferencingParam(paramName)
    : [];
  for (const eqIdx of affectedEqs) {
    foldSingleArenaEquation(arena, eqIdx, db, scopeId, omcCompatibility, paramMap);
  }
}

/**
 * Checks if an arena expression is already a literal holding the exact same value.
 * Prevents allocating redundant monotonic literal IDs that falsely trigger fixed-point loops.
 */
function isExprAlreadyLiteral(arena: DAEBuilder, exprId: number, val: any): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (typeof val === "number") {
    if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) === val;
    if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId) === Math.trunc(val);
  } else if (typeof val === "boolean") {
    if (kind === ExprKind.BoolLiteral) return Boolean(arena.getExprData1(exprId)) === val;
  } else if (typeof val === "string") {
    if (kind === ExprKind.StringLiteral) {
      const strId = arena.getExprData1(exprId);
      return arena.interner.resolve(strId) === val;
    }
  }
  return false;
}

function canPreFoldInWasm(arena: DAEBuilder): boolean {
  if (arena.ptr === 0 || !arena.exports || typeof (arena.exports as any).dae_foldConstantsEx !== "function") {
    return false;
  }
  if (typeof process !== "undefined" && process.env?.["MSX_WASM_FOLD"] === "ts") {
    return false;
  }
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (arena.isVarEvaluate(i)) return false;
    const vt = arena.getVarType(i);
    if (vt !== VarType.Real && vt !== VarType.Integer && vt !== VarType.Boolean) return false;
    if (arena.getVarShapeDim(i, 0) > 0) return false;
    // Skip WASM pre-pass if any variable has explicit attribute expressions (e.g., fixed=false)
    if (arena.getVarAttrExprIds(i) !== undefined) return false;
  }
  for (let e = 0; e < arena.exprCount; e++) {
    const k = arena.getExprKind(e);
    if (
      k === ExprKind.ArrayCtor ||
      k === ExprKind.StringLiteral ||
      k === ExprKind.Call ||
      k === ExprKind.Range ||
      k === ExprKind.Subscript ||
      k === ExprKind.EnumLiteral
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Fold constant and parameter expressions in the arena to literal values
 * where possible. This is done iteratively until fixed point or maxIterations.
 */
export function foldArenaConstants(
  arena: DAEBuilder,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
  maxIterations = 100,
): number {
  let wasmFolded = 0;
  if (!db && canPreFoldInWasm(arena)) {
    wasmFolded = (arena.exports as any).dae_foldConstantsEx(arena.ptr, maxIterations, omcCompatibility) as number;
  }

  // Residual TypeScript pass handles fixed=false parameters, arrays, strings, records, and Salsa db functions

  const nameToIdx = new Map<string, number>();
  const bindingIndices: number[] = [];
  const attrVarIndices: number[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      const name = arena.getVarName(i);
      nameToIdx.set(name, i);
      const v = arena.getVarVariability(i);
      const exprId = arena.getVarExpression(i);
      if (v === Variability.Constant || v === Variability.Parameter || (exprId !== undefined && exprId >= 0)) {
        bindingIndices.push(i);
      }
      if (arena.getVarAttrExprIds(i) !== undefined) {
        attrVarIndices.push(i);
      }
    }
  }

  const pendingRecordPrefixes = new Set<string>();
  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
    const l = arena.getEqLhs(eq);
    const r = arena.getEqRhs(eq);
    if (l < 0 || r < 0) continue;
    if (arena.getExprKind(l) === ExprKind.Name && arena.getExprKind(r) === ExprKind.Call) {
      const recName = arena.interner.resolve(arena.getExprData1(l));
      if (recName && !nameToIdx.has(recName)) {
        pendingRecordPrefixes.add(recName);
      }
    }
  }
  const isPendingRecordField = (varName: string): boolean => {
    if (pendingRecordPrefixes.size === 0) return false;
    for (const rec of pendingRecordPrefixes) {
      if (varName.startsWith(`${rec}.`) || varName.startsWith(`${rec}[`)) return true;
    }
    return false;
  };

  const isOldFrontendFold = Boolean(
    (arena as { extensionMetadata?: Record<string, unknown> }).extensionMetadata?.["isOldFrontend"],
  );
  const evalParamsMeta = (arena as { extensionMetadata?: Record<string, unknown> }).extensionMetadata?.[
    "evaluatedParams"
  ] as Set<string> | undefined;
  const filteredEvalMeta = evalParamsMeta ? [...evalParamsMeta].filter((n) => !isPendingRecordField(n)) : [];
  const forwardEvalNames = new Set<string>(filteredEvalMeta);
  const evaluatedParamNames = new Set<string>(filteredEvalMeta);
  if (!isOldFrontendFold) {
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      if (arena.getVarVariability(i) === Variability.Parameter && arena.isVarEvaluate(i)) {
        const pname = arena.getVarName(i);
        if (isPendingRecordField(pname)) continue;
        forwardEvalNames.add(pname);
        evaluatedParamNames.add(pname);
        if (!arena.isVarFinal(i)) {
          arena.setVarFinal(i, true);
        }
      }
    }
    if (evaluatedParamNames.size > 0) {
      const collectExprVarNames = (exprId: number, out: Set<string>, depth = 0): void => {
        if (exprId < 0 || depth > 64) return;
        const kind = arena.getExprKind(exprId);
        switch (kind) {
          case ExprKind.Name: {
            const n = arena.interner.resolve(arena.getExprData1(exprId));
            if (n) out.add(n);
            break;
          }
          case ExprKind.Binary:
            collectExprVarNames(arena.getExprLeft(exprId), out, depth + 1);
            collectExprVarNames(arena.getExprRight(exprId), out, depth + 1);
            break;
          case ExprKind.Unary:
          case ExprKind.Negate:
            collectExprVarNames(arena.getExprLeft(exprId), out, depth + 1);
            break;
          case ExprKind.Der:
          case ExprKind.Pre:
            collectExprVarNames(arena.getExprData1(exprId), out, depth + 1);
            break;
          case ExprKind.Range: {
            collectExprVarNames(arena.getExprData1(exprId), out, depth + 1);
            const rStep = arena.getExprLeft(exprId);
            if (rStep >= 0) collectExprVarNames(rStep, out, depth + 1);
            collectExprVarNames(arena.getExprRight(exprId), out, depth + 1);
            break;
          }
          case ExprKind.IfElse:
            collectExprVarNames(arena.getExprData1(exprId), out, depth + 1);
            collectExprVarNames(arena.getExprLeft(exprId), out, depth + 1);
            collectExprVarNames(arena.getExprRight(exprId), out, depth + 1);
            break;
          case ExprKind.Call: {
            const argc = arena.getExprRight(exprId);
            for (let a = 0; a < argc; a++) {
              const aId = a === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + a);
              collectExprVarNames(aId, out, depth + 1);
            }
            break;
          }
          case ExprKind.Subscript: {
            const baseId = arena.getExprData1(exprId);
            const subCount = arena.getExprRight(exprId);
            collectExprVarNames(baseId, out, depth + 1);
            for (let s = 0; s < subCount; s++) {
              const sId = s === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + s);
              collectExprVarNames(sId, out, depth + 1);
            }
            break;
          }
          case ExprKind.ArrayCtor: {
            const count = arena.getExprData1(exprId);
            const redirect = arena.getExprRight(exprId);
            const base = redirect >= 0 ? redirect : exprId;
            for (let e = 0; e < count; e++) {
              const elemId = e === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(base + e);
              collectExprVarNames(elemId, out, depth + 1);
            }
            break;
          }
          default:
            break;
        }
      };

      const expandNameRefs = (refs: Set<string>): string[] => {
        const expanded: string[] = [];
        for (const r of refs) {
          if (nameToIdx.has(r)) {
            expanded.push(r);
          } else {
            const pfx = `${r}[`;
            for (const cand of nameToIdx.keys()) {
              if (cand.startsWith(pfx)) expanded.push(cand);
            }
          }
        }
        return expanded;
      };

      let evalPropagated = true;
      let evalPass = 0;
      while (evalPropagated && evalPass < 16) {
        evalPropagated = false;
        evalPass++;
        for (const i of bindingIndices) {
          if (arena.isVarRemoved(i)) continue;
          if (arena.getVarVariability(i) !== Variability.Parameter || !arena.isVarFixed(i)) continue;
          const exprId = arena.getVarExpression(i);
          if (exprId === undefined || exprId < 0) continue;
          const name = arena.getVarName(i);
          const refs = new Set<string>();
          collectExprVarNames(exprId, refs);
          if (refs.size === 0) continue;
          const expandedRefs = expandNameRefs(refs);
          if (evaluatedParamNames.has(name)) {
            for (const r of expandedRefs) {
              const rIdx = nameToIdx.get(r);
              if (
                rIdx !== undefined &&
                arena.getVarVariability(rIdx) === Variability.Parameter &&
                arena.isVarFixed(rIdx) &&
                (arena.getVarExpression(rIdx) ?? -1) >= 0
              ) {
                if (!arena.isVarFinal(rIdx)) arena.setVarFinal(rIdx, true);
                if (!evaluatedParamNames.has(r)) {
                  evaluatedParamNames.add(r);
                  evalPropagated = true;
                }
              }
            }
          } else {
            // Forward Evaluate propagation: fixed Parameter whose binding depends solely on Constants + evaluated params
            let allKnown = true;
            let hasEvalDep = false;
            for (const rawRef of refs) {
              if (rawRef === "time") {
                allKnown = false;
                break;
              }
              const rawIdx = nameToIdx.get(rawRef);
              if (rawIdx !== undefined) {
                const rv = arena.getVarVariability(rawIdx);
                if (rv === Variability.Constant) continue;
                if (rv === Variability.Parameter && forwardEvalNames.has(rawRef)) {
                  hasEvalDep = true;
                  continue;
                }
                allKnown = false;
                break;
              }
              const arrPfx = `${rawRef}[`;
              let matchedElem = false;
              for (const [cand, cIdx] of nameToIdx) {
                if (!cand.startsWith(arrPfx)) continue;
                matchedElem = true;
                const cv = arena.getVarVariability(cIdx);
                if (cv === Variability.Constant) continue;
                if (cv === Variability.Parameter && forwardEvalNames.has(cand)) {
                  hasEvalDep = true;
                  continue;
                }
                allKnown = false;
                break;
              }
              if (!matchedElem || !allKnown) {
                allKnown = false;
                break;
              }
            }
            if (
              allKnown &&
              hasEvalDep &&
              arena.getExprKind(exprId) === ExprKind.Name &&
              (arena.getVarType(i) !== VarType.Real || arena.isVarFinal(i))
            ) {
              if (!arena.isVarFinal(i)) arena.setVarFinal(i, true);
              forwardEvalNames.add(name);
              evaluatedParamNames.add(name);
              evalPropagated = true;
            }
          }
        }
      }
    }
  }

  const paramMap = new Map<string, any>();
  const constMap = new Map<string, any>();
  const finalParamOrConstMap = new Map<string, any>();
  const rootShortClassName = arena.name ? arena.name.split(".").pop()! : "";
  const computeInstanceName = (fullName: string): string => {
    if (!rootShortClassName) return "";
    const lastDot = fullName.lastIndexOf(".");
    return lastDot > 0 ? `${rootShortClassName}.${fullName.slice(0, lastDot)}` : rootShortClassName;
  };

  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // 1. Update parameter map from current constant and parameter variables
    paramMap.clear();
    const bindMemo: Map<number, ArenaConstantValue> = ((paramMap as any)._bindMemo ??= new Map());
    bindMemo.clear();
    constMap.clear();
    finalParamOrConstMap.clear();
    for (const i of bindingIndices) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      const name = arena.getVarName(i);
      if (isPendingRecordField(name)) continue;
      if (v === Variability.Discrete || (arena.getVarCausality(i) === Causality.Input && !name.includes("."))) {
        continue;
      }
      if (v === Variability.Parameter && !arena.isVarFixed(i)) {
        continue;
      }
      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
        (paramMap as any)._instanceName = computeInstanceName(name);
        const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx, 0, db, scopeId);
        if (evalVal !== null) {
          let foldedValue: number | boolean | string | any[] | null = evalVal;
          const match = name.match(/\[([\d,]+)\]$/);
          if (match && Array.isArray(foldedValue)) {
            const indices = match[1]!.split(",").map(Number);
            let current: any = foldedValue;
            for (const idx of indices) {
              if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                current = current[idx - 1];
              } else {
                foldedValue = null;
                break;
              }
            }
            if (foldedValue !== null) {
              foldedValue = current;
            }
          }
          const canFoldFinalParam =
            v === Variability.Constant ||
            (v === Variability.Parameter &&
              arena.isVarFinal(i) &&
              evaluateConstantArenaExpression(arena, exprId, finalParamOrConstMap, nameToIdx, 0, db, scopeId, true) !==
                null);
          if (typeof foldedValue === "number") {
            paramMap.set(name, foldedValue);
            if (v === Variability.Constant) constMap.set(name, foldedValue);
            if (canFoldFinalParam) {
              finalParamOrConstMap.set(name, foldedValue);
            }
            if (arena.getVarStartValue(i) !== foldedValue) {
              arena.setVarStartValue(i, foldedValue);
              changed = true;
            }
            continue;
          } else if (typeof foldedValue === "boolean") {
            const numVal = foldedValue ? 1.0 : 0.0;
            paramMap.set(name, numVal);
            if (v === Variability.Constant) constMap.set(name, numVal);
            if (canFoldFinalParam) {
              finalParamOrConstMap.set(name, numVal);
            }
            if (arena.getVarStartValue(i) !== numVal) {
              arena.setVarStartValue(i, numVal);
              changed = true;
            }
            continue;
          } else if (typeof foldedValue === "string") {
            paramMap.set(name, foldedValue);
            if (v === Variability.Constant) constMap.set(name, foldedValue);
            if (canFoldFinalParam) {
              finalParamOrConstMap.set(name, foldedValue);
            }
            continue;
          }
        }
      }
      if (v === Variability.Constant) {
        if (arena.getVarType(i) !== VarType.String && arena.hasExplicitVarExpression(i)) {
          paramMap.set(name, arena.getVarStartValue(i));
          constMap.set(name, arena.getVarStartValue(i));
          finalParamOrConstMap.set(name, arena.getVarStartValue(i));
        }
      } else if (
        v === Variability.Parameter &&
        arena.isVarFinal(i) &&
        (typeof exprId !== "number" || exprId < 0) &&
        arena.hasExplicitVarExpression(i)
      ) {
        finalParamOrConstMap.set(name, arena.getVarStartValue(i));
      }
    }

    // 2. Fold variable binding expressions
    const loopConstPlusEvalMap =
      !isOldFrontendFold && evaluatedParamNames.size > 0
        ? new Map([...constMap, ...[...paramMap.entries()].filter(([k]) => evaluatedParamNames.has(k))])
        : constMap;
    for (const i of bindingIndices) {
      if (arena.isVarRemoved(i)) continue;
      if (isPendingRecordField(arena.getVarName(i))) continue;
      const v = arena.getVarVariability(i);
      if (v !== Variability.Constant && v !== Variability.Parameter && !omcCompatibility) continue;
      if (v === Variability.Parameter && !arena.isVarFixed(i)) continue;

      const exprId = (arena as any).getExplicitVarExpression
        ? (arena as any).getExplicitVarExpression(i)
        : arena.getVarExpression(i);
      if (exprId >= 0) {
        const isFinalParamNewInst =
          omcCompatibility &&
          v === Variability.Parameter &&
          (arena.isVarFinal(i) || arena.isVarProtected(i)) &&
          !arena.extensionMetadata?.["isOldFrontend"];
        const evalVal = evaluateConstantArenaExpression(
          arena,
          exprId,
          isFinalParamNewInst ? finalParamOrConstMap : omcCompatibility ? loopConstPlusEvalMap : paramMap,
          nameToIdx,
          0,
          db,
          scopeId,
          omcCompatibility,
        );
        if (evalVal !== null) {
          let foldedValue: number | boolean | string | any[] | null = evalVal;
          const match = arena.getVarName(i).match(/\[([\d,]+)\]$/);
          if (match && Array.isArray(foldedValue)) {
            const indices = match[1]!.split(",").map(Number);
            let current: any = foldedValue;
            for (const idx of indices) {
              if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                current = current[idx - 1];
              } else {
                foldedValue = null;
                break;
              }
            }
            if (foldedValue !== null) {
              foldedValue = current;
            }
          }
          if (typeof foldedValue === "number") {
            const vType = arena.getVarType(i);
            if (vType === VarType.Boolean) {
              const litId = arena.addExpression(ExprKind.BoolLiteral, foldedValue !== 0 ? 1 : 0);
              arena.setVarExpression(i, litId);
            } else if (vType !== VarType.Enumeration) {
              const litId =
                vType === VarType.Integer ? arena.addIntLiteral(foldedValue) : arena.addRealLiteral(foldedValue);
              arena.setVarExpression(i, litId);
            }
            if (arena.getVarStartValue(i) !== foldedValue) {
              arena.setVarStartValue(i, foldedValue);
              changed = true;
            }
            paramMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), foldedValue);
            }
          } else if (typeof foldedValue === "boolean") {
            const litId = arena.addExpression(ExprKind.BoolLiteral, foldedValue ? 1 : 0);
            arena.setVarExpression(i, litId);
            const numVal = foldedValue ? 1.0 : 0.0;
            if (arena.getVarStartValue(i) !== numVal) {
              arena.setVarStartValue(i, numVal);
              changed = true;
            }
            paramMap.set(arena.getVarName(i), numVal);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), numVal);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), numVal);
            }
          } else if (typeof foldedValue === "string") {
            const litId = arena.addStringLiteral(foldedValue);
            arena.setVarExpression(i, litId);
            paramMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), foldedValue);
            }
          } else if (!match && Array.isArray(foldedValue) && arena.getExprKind(exprId) !== ExprKind.ArrayCtor) {
            const arrExpr = arrayValueToArenaExpr(arena, foldedValue, arena.getVarType(i));
            if (arrExpr !== exprId) {
              arena.setVarExpression(i, arrExpr);
              changed = true;
            }
          }
        } else if (arena.getExprKind(exprId) === ExprKind.Subscript) {
          const subbed = substituteArenaConstants(arena, exprId, constMap, nameToIdx);
          if (subbed !== exprId) {
            arena.setVarExpression(i, subbed);
            changed = true;
          }
        }
      }
    }

    // Fold variable attributes (e.g. start = x0[1])
    const isOldFrontend = Boolean((arena as any).extensionMetadata?.isOldFrontend);
    for (const i of attrVarIndices) {
      if (arena.isVarRemoved(i)) continue;
      const attrs = arena.getVarAttrExprIds(i);
      if (!attrs) continue;
      const vAttr = arena.getVarVariability(i);
      const hasConstOrParamBinding =
        (vAttr === Variability.Constant || (vAttr === Variability.Parameter && arena.isVarFixed(i))) &&
        (arena.getVarExpression(i) ?? -1) >= 0;
      for (const [attrName, attrExprId] of attrs.entries()) {
        if (attrExprId >= 0) {
          if (attrName === "start" && attrExprId === arena.getVarExpression(i)) {
            continue;
          }
          if (attrName === "start" && !hasConstOrParamBinding) {
            const numStartVal = evaluateConstantArenaExpression(
              arena,
              attrExprId,
              paramMap,
              nameToIdx,
              0,
              db,
              scopeId,
              false,
            );
            if (
              typeof numStartVal === "number" &&
              Number.isFinite(numStartVal) &&
              arena.getVarStartValue(i) !== numStartVal
            ) {
              arena.setVarStartValue(i, numStartVal);
            }
          }
          if (omcCompatibility) {
            if (attrName === "start" && isOldFrontend && arena.getExprKind(attrExprId) === ExprKind.Binary) {
              continue;
            }
            if (
              arena.getExprKind(attrExprId) === ExprKind.Name &&
              (attrName === "start" ||
                (isOldFrontend && (attrName === "nominal" || attrName === "min" || attrName === "max")))
            ) {
              const refName = arena.interner.resolve(arena.getExprData1(attrExprId));
              const refIdx = refName ? nameToIdx.get(refName) : undefined;
              if (
                refIdx !== undefined &&
                arena.getVarVariability(refIdx) === Variability.Parameter &&
                (!arena.isVarFinal(refIdx) || isOldFrontend)
              ) {
                continue;
              }
            }
          }
          const isIfAttr =
            omcCompatibility &&
            arena.getExprKind(attrExprId) === ExprKind.IfElse &&
            attrName !== "fixed" &&
            attrName !== "stateSelect";
          const attrFoldMap = isIfAttr ? (isOldFrontend ? constMap : finalParamOrConstMap) : paramMap;
          const evalVal = evaluateConstantArenaExpression(arena, attrExprId, attrFoldMap, nameToIdx, 0, db, scopeId);
          if (evalVal !== null && !isExprAlreadyLiteral(arena, attrExprId, evalVal)) {
            const varType = arena.getVarType(i);
            const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
            let literalId: number;
            if (
              attrName === "stateSelect" &&
              typeof evalVal === "number" &&
              evalVal >= 1 &&
              evalVal <= ssLiterals.length
            ) {
              literalId = arena.addEnumLiteral(evalVal, `StateSelect.${ssLiterals[evalVal - 1]}`);
            } else if (attrName === "fixed" && (typeof evalVal === "boolean" || typeof evalVal === "number")) {
              literalId = arena.addBoolLiteral(Boolean(evalVal));
            } else if (varType === VarType.Integer && typeof evalVal === "number") {
              literalId = arena.addIntLiteral(Math.trunc(evalVal));
            } else if (varType === VarType.Boolean && typeof evalVal === "boolean") {
              literalId = arena.addBoolLiteral(evalVal);
            } else if (varType === VarType.Enumeration) {
              continue;
            } else if (typeof evalVal === "number") {
              literalId = arena.addRealLiteral(evalVal);
            } else {
              continue;
            }
            if (literalId !== attrExprId) {
              if (
                omcCompatibility &&
                !isOldFrontendFold &&
                (attrName === "min" || attrName === "max") &&
                arena.isVarFlow(i) &&
                arena.getExprKind(attrExprId) === ExprKind.IfElse
              ) {
                const collectCondRefs = (eId: number, visitedSet: Set<number>, depth = 0): void => {
                  if (eId < 0 || eId >= arena.exprCount || depth > 24 || visitedSet.has(eId)) return;
                  visitedSet.add(eId);
                  const k = arena.getExprKind(eId);
                  if (k === ExprKind.Name) {
                    const refName = arena.interner.resolve(arena.getExprData1(eId));
                    const rIdx = refName ? nameToIdx.get(refName) : undefined;
                    if (
                      refName &&
                      rIdx !== undefined &&
                      !arena.isVarRemoved(rIdx) &&
                      arena.getVarVariability(rIdx) === Variability.Parameter &&
                      arena.getVarType(rIdx) !== VarType.Real
                    ) {
                      if (!arena.isVarFinal(rIdx)) arena.setVarFinal(rIdx, true);
                      evaluatedParamNames.add(refName);
                      const rb = arena.getVarExpression(rIdx);
                      if (typeof rb === "number" && rb >= 0) collectCondRefs(rb, visitedSet, depth + 1);
                    }
                    return;
                  }
                  if (k === ExprKind.Binary) {
                    collectCondRefs(arena.getExprLeft(eId), visitedSet, depth + 1);
                    collectCondRefs(arena.getExprRight(eId), visitedSet, depth + 1);
                  } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
                    collectCondRefs(arena.getExprLeft(eId), visitedSet, depth + 1);
                  } else if (k === ExprKind.IfElse) {
                    collectCondRefs(arena.getExprData1(eId), visitedSet, depth + 1);
                    collectCondRefs(arena.getExprLeft(eId), visitedSet, depth + 1);
                    collectCondRefs(arena.getExprRight(eId), visitedSet, depth + 1);
                  } else if (k === ExprKind.Call) {
                    const argc = arena.getExprRight(eId);
                    for (let a = 0; a < argc; a++) {
                      const aId = a === 0 ? arena.getExprLeft(eId) : arena.getExprLeft(eId + a);
                      collectCondRefs(aId, visitedSet, depth + 1);
                    }
                  } else if (k === ExprKind.Subscript) {
                    collectCondRefs(arena.getExprData1(eId), visitedSet, depth + 1);
                    const sc = arena.getExprRight(eId);
                    for (let s = 0; s < sc; s++) {
                      const sId = s === 0 ? arena.getExprLeft(eId) : arena.getExprLeft(eId + s);
                      collectCondRefs(sId, visitedSet, depth + 1);
                    }
                  }
                };
                collectCondRefs(arena.getExprData1(attrExprId), new Set<number>());
              }
              arena.setVarAttr(i, attrName, literalId);
              if (attrName === "fixed") {
                arena.setVarFixed(i, Boolean(evalVal));
              } else if (
                attrName === "start" &&
                !hasConstOrParamBinding &&
                typeof evalVal === "number" &&
                Number.isFinite(evalVal)
              ) {
                arena.setVarStartValue(i, evalVal);
              }
              changed = true;
            }
          } else if (isIfAttr) {
            const subId = substituteArenaConstants(arena, attrExprId, constMap, nameToIdx);
            if (subId !== attrExprId) {
              arena.setVarAttr(i, attrName, subId);
              changed = true;
            }
          }
        }
      }
    }
  }

  // 3. Fold equations once after variable parameters/constants have converged
  const constPlusEvalMap =
    !isOldFrontendFold && evaluatedParamNames.size > 0
      ? new Map<string, any>([...constMap, ...[...paramMap.entries()].filter(([k]) => evaluatedParamNames.has(k))])
      : constMap;
  const eqFoldMap = omcCompatibility ? constPlusEvalMap : paramMap;
  const ifElseFoldMap = omcCompatibility ? constPlusEvalMap : paramMap;
  const eqSubMap = (arena as { extensionMetadata?: { evaluateAllParameters?: boolean } }).extensionMetadata
    ?.evaluateAllParameters
    ? finalParamOrConstMap
    : constPlusEvalMap;
  const assertEvalMap = omcCompatibility && !isOldFrontendFold ? constPlusEvalMap : constMap;
  if (omcCompatibility && !isOldFrontendFold) {
    (eqSubMap as { _allParamMap?: Map<string, any> })._allParamMap = paramMap;
    (ifElseFoldMap as { _allParamMap?: Map<string, any> })._allParamMap = paramMap;
  }
  for (let eq = 0; eq < arena.eqCount; eq++) {
    const eqKind = arena.getEqKind(eq);
    if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
      let lhsExpr = arena.getEqLhs(eq);
      let rhsExpr = arena.getEqRhs(eq);
      const eqLhsName =
        lhsExpr >= 0 && arena.getExprKind(lhsExpr) === ExprKind.Name
          ? arena.interner.resolve(arena.getExprData1(lhsExpr)) || ""
          : "";
      const eqInstName = computeInstanceName(eqLhsName);
      (eqFoldMap as any)._instanceName = eqInstName;
      (eqSubMap as any)._instanceName = eqInstName;
      const rhsKind = rhsExpr >= 0 ? arena.getExprKind(rhsExpr) : -1;
      const isCall =
        rhsKind === ExprKind.Call ||
        (rhsKind === ExprKind.Subscript &&
          arena.getExprKind(
            arena.getExprData1(rhsExpr) !== 0 ? arena.getExprData1(rhsExpr) : arena.getExprLeft(rhsExpr),
          ) === ExprKind.Call);
      const isGen = Boolean((arena as any).extensionMetadata?.isGen);
      const currentEqFoldMap = isCall && (!omcCompatibility || isGen) ? paramMap : eqFoldMap;
      const currentOnlyConstants = isCall && (!omcCompatibility || isGen) ? false : omcCompatibility;
      const lhsKind = lhsExpr >= 0 ? arena.getExprKind(lhsExpr) : -1;
      if (
        rhsExpr >= 0 &&
        rhsKind !== ExprKind.EnumLiteral &&
        lhsKind !== ExprKind.EnumLiteral &&
        (arena.getExprKind(rhsExpr) !== ExprKind.ArrayCtor || !omcCompatibility || isCall)
      ) {
        let foldedRhs = evaluateConstantArenaExpression(
          arena,
          rhsExpr,
          currentEqFoldMap,
          nameToIdx,
          0,
          db,
          scopeId,
          currentOnlyConstants,
        );
        if (foldedRhs !== null) {
          let varType = VarType.Real;
          let skipScalarFold = false;
          if (lhsKind === ExprKind.Name) {
            const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
            let varIdx = nameToIdx
              ? (nameToIdx.get(varName) ?? nameToIdx.get(`${varName}[1]`) ?? nameToIdx.get(`${varName}[1,1]`))
              : arena.getVarIdxByName(varName) >= 0
                ? arena.getVarIdxByName(varName)
                : arena.getVarIdxByName(`${varName}[1]`);
            if (varIdx === undefined || varIdx < 0) {
              const prefixMatch = `${varName}[`;
              if (nameToIdx) {
                for (const [k, idx] of nameToIdx) {
                  if (k.startsWith(prefixMatch)) {
                    varIdx = idx;
                    break;
                  }
                }
              } else {
                for (let vi = 0; vi < arena.varCount; vi++) {
                  if (!arena.isVarRemoved(vi) && arena.getVarName(vi).startsWith(prefixMatch)) {
                    varIdx = vi;
                    break;
                  }
                }
              }
            }
            if (varIdx !== undefined && varIdx >= 0) {
              varType = arena.getVarType(varIdx);
            } else {
              skipScalarFold = true;
            }
          } else if (lhsKind === ExprKind.Tuple && isCall && Array.isArray(foldedRhs)) {
            const tupleCount = arena.getExprData1(lhsExpr);
            if (tupleCount > 0 && foldedRhs.length === tupleCount) {
              const outElems: number[] = [];
              let allValid = true;
              for (let ti = 0; ti < tupleCount; ti++) {
                const lhsElem = arena.getExprLeft(lhsExpr + ti);
                let elemType = VarType.Real;
                if (lhsElem >= 0 && arena.getExprKind(lhsElem) === ExprKind.Name) {
                  const elemName = arena.interner.resolve(arena.getExprData1(lhsElem));
                  if (elemName && elemName !== "_") {
                    const eIdx = nameToIdx
                      ? (nameToIdx.get(elemName) ??
                        nameToIdx.get(`${elemName}[1]`) ??
                        nameToIdx.get(`${elemName}[1,1]`))
                      : arena.getVarIdxByName(elemName) >= 0
                        ? arena.getVarIdxByName(elemName)
                        : arena.getVarIdxByName(`${elemName}[1]`);
                    if (eIdx !== undefined && eIdx >= 0) {
                      elemType = arena.getVarType(eIdx);
                    }
                  }
                }
                const fv = foldedRhs[ti];
                if (Array.isArray(fv)) {
                  outElems.push(arrayValueToArenaExpr(arena, fv, elemType));
                } else if (elemType === VarType.Boolean && typeof fv === "boolean") {
                  outElems.push(arena.addBoolLiteral(fv));
                } else if (elemType === VarType.Integer && typeof fv === "number" && Number.isFinite(fv)) {
                  outElems.push(arena.addIntLiteral(Math.trunc(fv)));
                } else if (elemType === VarType.String || typeof fv === "string") {
                  outElems.push(arena.addStringLiteral(String(fv)));
                } else if (typeof fv === "number" && Number.isFinite(fv)) {
                  outElems.push(arena.addRealLiteral(fv));
                } else if (typeof fv === "boolean") {
                  outElems.push(arena.addBoolLiteral(fv));
                } else {
                  allValid = false;
                  break;
                }
              }
              if (allValid && outElems.length === tupleCount) {
                let nonWildcardIdx = -1;
                let nonWildcardCount = 0;
                for (let ti = 0; ti < tupleCount; ti++) {
                  const lhsElem = arena.getExprLeft(lhsExpr + ti);
                  let isWild = lhsElem < 0;
                  if (!isWild && arena.getExprKind(lhsElem) === ExprKind.Name) {
                    const elemName = arena.interner.resolve(arena.getExprData1(lhsElem));
                    if (!elemName || elemName === "_") isWild = true;
                  }
                  if (!isWild) {
                    nonWildcardIdx = ti;
                    nonWildcardCount++;
                  }
                }
                if (nonWildcardCount === 1 && nonWildcardIdx >= 0) {
                  const singleLhs = arena.getExprLeft(lhsExpr + nonWildcardIdx);
                  const singleRhs = outElems[nonWildcardIdx]!;
                  arena.setEqLhs(eq, singleLhs);
                  arena.setEqRhs(eq, singleRhs);
                  rhsExpr = singleRhs;
                } else {
                  const tupleRhs = arena.addTupleExpr(outElems);
                  arena.setEqRhs(eq, tupleRhs);
                  rhsExpr = tupleRhs;
                }
              }
            }
            continue;
          } else if (lhsKind !== ExprKind.Subscript) {
            skipScalarFold = true;
          }

          if (!skipScalarFold && varType !== VarType.Enumeration && !isExprAlreadyLiteral(arena, rhsExpr, foldedRhs)) {
            let newRhs: number;
            if (Array.isArray(foldedRhs)) {
              newRhs =
                !isCall && !omcCompatibility && rhsKind === ExprKind.Binary
                  ? rhsExpr
                  : arrayValueToArenaExpr(arena, foldedRhs, varType);
            } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
              newRhs = arena.addBoolLiteral(foldedRhs);
            } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
              newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
            } else if (varType === VarType.String || typeof foldedRhs === "string") {
              newRhs = arena.addStringLiteral(String(foldedRhs));
            } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
              newRhs = arena.addRealLiteral(foldedRhs);
            } else if (typeof foldedRhs === "boolean") {
              newRhs = arena.addBoolLiteral(foldedRhs);
            } else {
              newRhs = rhsExpr;
            }

            if (newRhs !== rhsExpr) {
              arena.setEqRhs(eq, newRhs);
              rhsExpr = newRhs;
            }
          }
        }
      }

      if (rhsExpr >= 0 && rhsKind !== ExprKind.EnumLiteral && lhsKind !== ExprKind.EnumLiteral) {
        const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
        if (simplifiedRhs !== rhsExpr) {
          arena.setEqRhs(eq, simplifiedRhs);
          rhsExpr = simplifiedRhs;
        }
        const constSubRhs = substituteArenaConstants(arena, rhsExpr, eqSubMap, nameToIdx);
        if (constSubRhs !== rhsExpr) {
          arena.setEqRhs(eq, constSubRhs);
        }
        if (lhsKind !== ExprKind.Name && lhsKind !== ExprKind.Der) {
          const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
          if (simplifiedLhs !== lhsExpr) {
            arena.setEqLhs(eq, simplifiedLhs);
            lhsExpr = simplifiedLhs;
          }
          const constSubLhs = substituteArenaConstants(arena, lhsExpr, eqSubMap, nameToIdx);
          if (constSubLhs !== lhsExpr) {
            arena.setEqLhs(eq, constSubLhs);
          }
        }
      }
    } else if (eqKind === EqKind.When) {
      const meta = arena.getWhenEquationMeta(eq);
      if (meta) {
        const foldWhenCond = (condExprId: number): number => {
          if (condExprId < 0) return condExprId;
          let cur = condExprId;
          const foldedCond = evaluateConstantArenaExpression(
            arena,
            cur,
            eqFoldMap,
            nameToIdx,
            0,
            db,
            scopeId,
            omcCompatibility,
          );
          if (typeof foldedCond === "boolean" && !isExprAlreadyLiteral(arena, cur, foldedCond)) {
            cur = arena.addBoolLiteral(foldedCond);
          }
          const simplified = simplifyArenaIfElse(arena, cur, ifElseFoldMap, nameToIdx, omcCompatibility);
          if (simplified !== cur) cur = simplified;
          const subbed = substituteArenaConstants(arena, cur, eqSubMap, nameToIdx);
          if (subbed !== cur) cur = subbed;
          return cur;
        };
        const foldWhenBody = (list: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]) => {
          for (const bodyEq of list) {
            if (bodyEq.kind !== EqKind.Simple) continue;
            if (bodyEq.rhsExprId >= 0) {
              const foldedRhs = evaluateConstantArenaExpression(
                arena,
                bodyEq.rhsExprId,
                eqFoldMap,
                nameToIdx,
                0,
                db,
                scopeId,
                omcCompatibility,
              );

              if (foldedRhs !== null && !isExprAlreadyLiteral(arena, bodyEq.rhsExprId, foldedRhs)) {
                let varType = VarType.Real;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Name) {
                  const varName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  const varIdx = nameToIdx.get(varName);
                  if (varIdx !== undefined) {
                    varType = arena.getVarType(varIdx);
                  }
                }

                let newRhs: number;
                if (Array.isArray(foldedRhs)) {
                  newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
                } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
                } else if (varType === VarType.String || typeof foldedRhs === "string") {
                  newRhs = arena.addStringLiteral(String(foldedRhs));
                } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addRealLiteral(foldedRhs);
                } else if (typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else {
                  newRhs = bodyEq.rhsExprId;
                }

                if (newRhs !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = newRhs;
                }
              }

              const simplifiedRhs = simplifyArenaIfElse(
                arena,
                bodyEq.rhsExprId,
                ifElseFoldMap,
                nameToIdx,
                omcCompatibility,
              );
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
              if (constSub !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = constSub;
              }
            }
          }
        };

        const newCond = foldWhenCond(meta.conditionExprId);
        if (newCond !== meta.conditionExprId) {
          meta.conditionExprId = newCond;
          arena.setEqLhs(eq, newCond);
        }
        foldWhenBody(meta.bodyEquations);
        for (const ew of meta.elseWhenClauses) {
          ew.conditionExprId = foldWhenCond(ew.conditionExprId);
          foldWhenBody(ew.bodyEquations);
        }
        if (meta.elseEquations) {
          foldWhenBody(meta.elseEquations);
        }
      }
    } else if (eqKind === EqKind.If) {
      const meta = arena.getIfEquationMeta(eq);
      if (meta) {
        const foldIfCond = (condExprId: number): number => {
          if (condExprId < 0) return condExprId;
          let cur = simplifyArenaIfElse(arena, condExprId, ifElseFoldMap, nameToIdx, omcCompatibility);
          cur = substituteArenaConstants(arena, cur, eqSubMap, nameToIdx);
          const v = evaluateConstantArenaExpression(arena, cur, eqFoldMap, nameToIdx, 0, db, scopeId, omcCompatibility);
          if (typeof v === "boolean") return arena.addBoolLiteral(v);
          return cur;
        };
        const foldEqList = (list: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]) => {
          for (let bi = list.length - 1; bi >= 0; bi--) {
            const bodyEq = list[bi]!;
            if (bodyEq.kind === EqKind.If) {
              const anyEq = bodyEq as any;
              if (bodyEq.lhsExprId >= 0) {
                bodyEq.lhsExprId = foldIfCond(bodyEq.lhsExprId);
              }
              if (Array.isArray(anyEq.thenEquations)) foldEqList(anyEq.thenEquations);
              for (const c of anyEq.elseIfClauses || []) {
                if (c.conditionExprId >= 0) {
                  c.conditionExprId = foldIfCond(c.conditionExprId);
                }
                if (Array.isArray(c.bodyEquations)) foldEqList(c.bodyEquations);
              }
              if (Array.isArray(anyEq.elseEquations)) foldEqList(anyEq.elseEquations);
              continue;
            }
            if (bodyEq.kind === EqKind.FunctionCall || bodyEq.kind === EqKind.InitialFunctionCall) {
              if (bodyEq.lhsExprId >= 0) {
                const subCall = substituteArenaConstants(arena, bodyEq.lhsExprId, eqSubMap, nameToIdx);
                if (subCall !== bodyEq.lhsExprId) bodyEq.lhsExprId = subCall;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Call) {
                  const fnName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  if (fnName === "assert" && arena.getExprRight(bodyEq.lhsExprId) >= 2) {
                    const condVal = evaluateConstantArenaExpression(
                      arena,
                      arena.getExprLeft(bodyEq.lhsExprId),
                      assertEvalMap,
                      nameToIdx,
                      0,
                      db,
                      scopeId,
                      omcCompatibility,
                    );
                    if (condVal === true) {
                      list.splice(bi, 1);
                    }
                  }
                }
              }
              continue;
            }
            if (bodyEq.kind !== EqKind.Simple && bodyEq.kind !== EqKind.InitialSimple) continue;
            if (bodyEq.rhsExprId >= 0) {
              let foldedRhs = evaluateConstantArenaExpression(
                arena,
                bodyEq.rhsExprId,
                eqFoldMap,
                nameToIdx,
                0,
                db,
                scopeId,
                omcCompatibility,
              );

              if (foldedRhs !== null && !isExprAlreadyLiteral(arena, bodyEq.rhsExprId, foldedRhs)) {
                let varType = VarType.Real;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Name) {
                  const varName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  const varIdx = nameToIdx.get(varName);
                  if (varIdx !== undefined) {
                    varType = arena.getVarType(varIdx);
                  }
                }

                let newRhs: number;
                if (Array.isArray(foldedRhs)) {
                  newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
                } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
                } else if (varType === VarType.String || typeof foldedRhs === "string") {
                  newRhs = arena.addStringLiteral(String(foldedRhs));
                } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addRealLiteral(foldedRhs);
                } else if (typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else {
                  newRhs = bodyEq.rhsExprId;
                }

                if (newRhs !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = newRhs;
                }
              }

              const simplifiedRhs = simplifyArenaIfElse(
                arena,
                bodyEq.rhsExprId,
                ifElseFoldMap,
                nameToIdx,
                omcCompatibility,
              );
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
              if (constSub !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = constSub;
              }
            }
          }
        };
        if (meta.conditionExprId >= 0) {
          const fc = foldIfCond(meta.conditionExprId);
          if (fc !== meta.conditionExprId) {
            meta.conditionExprId = fc;
            arena.setEqLhs(eq, fc);
          }
        }
        foldEqList(meta.thenEquations);
        for (const clause of meta.elseIfClauses) {
          if (clause.conditionExprId >= 0) {
            clause.conditionExprId = foldIfCond(clause.conditionExprId);
          }
          foldEqList(clause.bodyEquations);
        }
        if (meta.elseEquations) {
          foldEqList(meta.elseEquations);
        }
      }
    } else if (eqKind === EqKind.For || eqKind === EqKind.InitialFor) {
      const meta = arena.getForEquationMeta(eq);
      if (meta) {
        if (meta.rangeExprId >= 0) {
          const constSubRange = substituteArenaConstants(arena, meta.rangeExprId, eqSubMap, nameToIdx);
          if (constSubRange !== meta.rangeExprId) {
            meta.rangeExprId = constSubRange;
          }
        }
        const foldForEqList = (list: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]) => {
          for (const bodyEq of list) {
            const anyEq = bodyEq as any;
            if (bodyEq.kind === EqKind.If) {
              if (Array.isArray(anyEq.thenEquations)) foldForEqList(anyEq.thenEquations);
              for (const c of anyEq.elseIfClauses || []) {
                if (Array.isArray(c.bodyEquations)) foldForEqList(c.bodyEquations);
              }
              if (Array.isArray(anyEq.elseEquations)) foldForEqList(anyEq.elseEquations);
              continue;
            }
            if (
              (bodyEq.kind === EqKind.For || bodyEq.kind === EqKind.InitialFor) &&
              Array.isArray(anyEq.bodyEquations)
            ) {
              if (bodyEq.rhsExprId >= 0) {
                bodyEq.rhsExprId = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
              }
              foldForEqList(anyEq.bodyEquations);
              continue;
            }
            if (bodyEq.lhsExprId >= 0) {
              bodyEq.lhsExprId = substituteArenaConstants(arena, bodyEq.lhsExprId, eqSubMap, nameToIdx);
            }
            if (bodyEq.rhsExprId >= 0) {
              bodyEq.rhsExprId = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
            }
          }
        };
        foldForEqList(meta.bodyEquations);
      }
    } else if (eqKind === EqKind.FunctionCall || eqKind === EqKind.InitialFunctionCall) {
      let callId = arena.getEqLhs(eq);
      if (callId >= 0) {
        let curCall = simplifyArenaIfElse(arena, callId, ifElseFoldMap, nameToIdx, omcCompatibility);
        curCall = substituteArenaConstants(arena, curCall, eqSubMap, nameToIdx);
        if (curCall !== callId) {
          arena.setEqLhs(eq, curCall);
          callId = curCall;
        }
        if (arena.getExprKind(callId) === ExprKind.Call) {
          const fnName = arena.interner.resolve(arena.getExprData1(callId));
          if (fnName === "assert" && arena.getExprRight(callId) >= 2) {
            if (omcCompatibility && !isOldFrontendFold && arena.getExprRight(callId) >= 3) {
              const levelArg = arena.getExprLeft(callId + 2);
              if (levelArg >= 0 && arena.getExprKind(levelArg) === ExprKind.Name) {
                const levelName = arena.interner.resolve(arena.getExprData1(levelArg));
                let curIdx = levelName ? nameToIdx.get(levelName) : undefined;
                let resolvedEnumExpr = -1;
                for (let hop = 0; hop < 4 && curIdx !== undefined; hop++) {
                  if (
                    arena.getVarVariability(curIdx) !== Variability.Parameter ||
                    !arena.isVarFixed(curIdx) ||
                    arena.getVarType(curIdx) !== VarType.Enumeration
                  ) {
                    break;
                  }
                  if (!arena.isVarFinal(curIdx)) arena.setVarFinal(curIdx, true);
                  const bExpr = arena.getVarExpression(curIdx);
                  if (bExpr === undefined || bExpr < 0) break;
                  const bk = arena.getExprKind(bExpr);
                  if (bk === ExprKind.EnumLiteral) {
                    resolvedEnumExpr = bExpr;
                    break;
                  } else if (bk === ExprKind.Name) {
                    const nextName = arena.interner.resolve(arena.getExprData1(bExpr));
                    curIdx = nextName ? nameToIdx.get(nextName) : undefined;
                  } else {
                    break;
                  }
                }
                if (resolvedEnumExpr >= 0) {
                  const newArgs: number[] = [];
                  const argc = arena.getExprRight(callId);
                  for (let ai = 0; ai < argc; ai++) {
                    newArgs.push(ai === 2 ? resolvedEnumExpr : arena.getExprLeft(callId + ai));
                  }
                  callId = arena.addCallExpr(fnName, newArgs);
                  arena.setEqLhs(eq, callId);
                }
              }
            }
            const condArg = arena.getExprLeft(callId);
            const condVal = evaluateConstantArenaExpression(
              arena,
              condArg,
              assertEvalMap,
              nameToIdx,
              0,
              db,
              scopeId,
              omcCompatibility,
            );
            if (condVal === true) {
              arena.removeEquation(eq);
            }
          }
        }
      }
    }
  }

  // Fold constant expressions, evaluated parameters, and algorithm control expressions across statements,
  // respecting for-loop iterator shadowing of outer constants/parameters.
  const shadowedByStmt = new Map<number, ReadonlySet<string>>();
  const foldStmtAt = (s: number, activeSubMap: Map<string, number>, shadowed: ReadonlySet<string>): number => {
    if (s < 0 || s >= arena.stmtCount) return s + 1;
    if (shadowed.size > 0) shadowedByStmt.set(s, shadowed);
    const sk = arena.getStmtKind(s);
    if (sk === StmtKind.For) {
      const rangeId = arena.getStmtLeft(s);
      if (rangeId >= 0) {
        const subRange = substituteArenaConstants(arena, rangeId, activeSubMap, nameToIdx);
        if (subRange !== rangeId) arena.setStmtLeft(s, subRange);
      }
      const indexNameRaw = arena.interner.resolve(arena.getStmtData1(s));
      const indexName = indexNameRaw?.startsWith("\0loop\0") ? indexNameRaw.substring(6) : indexNameRaw;
      let bodySubMap = activeSubMap;
      let bodyShadowed = shadowed;
      if (indexName) {
        if (activeSubMap.has(indexName)) {
          bodySubMap = new Map(activeSubMap);
          bodySubMap.delete(indexName);
        }
        if (!shadowed.has(indexName)) {
          const nextShadowed = new Set(shadowed);
          nextShadowed.add(indexName);
          bodyShadowed = nextShadowed;
        }
      }
      const bodyCount = arena.getStmtRight(s);
      let next = s + 1;
      for (let i = 0; i < bodyCount && next < arena.stmtCount; i++) {
        next = foldStmtAt(next, bodySubMap, bodyShadowed);
      }
      return next;
    }
    if (sk === StmtKind.ProcedureCall) {
      const callId = arena.getStmtData1(s);
      if (callId >= 0) {
        let curCall = simplifyArenaIfElse(arena, callId, ifElseFoldMap, nameToIdx, omcCompatibility);
        curCall = substituteArenaConstants(arena, curCall, activeSubMap, nameToIdx);
        if (curCall !== callId) arena.setStmtData1(s, curCall);
      }
      return s + 1;
    }
    if (sk === StmtKind.If || sk === StmtKind.While || sk === StmtKind.When || sk === StmtKind.Block) {
      const condId = arena.getStmtData1(s);
      if (condId >= 0) {
        let curCond = simplifyArenaIfElse(arena, condId, ifElseFoldMap, nameToIdx, omcCompatibility);
        curCond = substituteArenaConstants(arena, curCond, activeSubMap, nameToIdx);
        if (curCond !== condId) arena.setStmtData1(s, curCond);
      }
      const childCount =
        sk === StmtKind.While || sk === StmtKind.Block
          ? arena.getStmtLeft(s)
          : arena.getStmtLeft(s) + arena.getStmtRight(s);
      let next = s + 1;
      for (let i = 0; i < childCount && next < arena.stmtCount; i++) {
        next = foldStmtAt(next, activeSubMap, shadowed);
      }
      return next;
    }
    if (sk === StmtKind.Assignment) {
      const rhsExpr = arena.getStmtLeft(s);
      if (rhsExpr >= 0) {
        let curRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
        curRhs = substituteArenaConstants(arena, curRhs, activeSubMap, nameToIdx);
        if (curRhs !== rhsExpr) arena.setStmtLeft(s, curRhs);
      }
      return s + 1;
    }
    return s + 1;
  };

  for (let s = 0; s < arena.stmtCount;) {
    s = foldStmtAt(s, eqSubMap, new Set<string>());
  }

  // Fold constant function calls and constant array constructors in algorithm assignment statements
  for (const sec of arena.algorithmSections) {
    const end = sec.start + sec.count;
    for (let s = sec.start; s < end; s++) {
      if (arena.getStmtKind(s) !== StmtKind.Assignment) continue;
      const lhsExpr = arena.getStmtData1(s);
      const rhsExpr = arena.getStmtLeft(s);
      if (lhsExpr < 0 || rhsExpr < 0) continue;
      const rhsKind = arena.getExprKind(rhsExpr);
      if (rhsKind !== ExprKind.Call && rhsKind !== ExprKind.ArrayCtor) continue;
      const lhsKind = arena.getExprKind(lhsExpr);
      if (lhsKind !== ExprKind.Name && lhsKind !== ExprKind.Subscript) continue;
      const shadowed = shadowedByStmt.get(s);
      if (shadowed && shadowed.size > 0) {
        const exprRefsShadowed = (eId: number, depth = 0): boolean => {
          if (eId < 0 || depth > 32) return false;
          const ek = arena.getExprKind(eId);
          if (ek === ExprKind.Name) {
            const nm = arena.interner.resolve(arena.getExprData1(eId));
            return Boolean(nm && shadowed.has(nm));
          }
          if (ek === ExprKind.Call) {
            const argCount = arena.getExprRight(eId);
            for (let ai = 0; ai < argCount; ai++) {
              if (exprRefsShadowed(arena.getExprLeft(eId + ai), depth + 1)) return true;
            }
            return false;
          }
          if (ek === ExprKind.ArrayCtor) {
            const count = arena.getExprData1(eId);
            for (let ei = 0; ei < count; ei++) {
              if (exprRefsShadowed(arena.getExprLeft(eId + ei), depth + 1)) return true;
            }
            return false;
          }
          return (
            exprRefsShadowed(arena.getExprLeft(eId), depth + 1) || exprRefsShadowed(arena.getExprRight(eId), depth + 1)
          );
        };
        if (exprRefsShadowed(rhsExpr)) continue;
      }
      const foldedRhs = evaluateConstantArenaExpression(
        arena,
        rhsExpr,
        eqFoldMap,
        nameToIdx,
        0,
        db,
        scopeId,
        omcCompatibility,
      );
      if (foldedRhs === null || isExprAlreadyLiteral(arena, rhsExpr, foldedRhs)) continue;
      let varType = VarType.Real;
      if (lhsKind === ExprKind.Name) {
        const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
        const varIdx = nameToIdx.get(varName) ?? nameToIdx.get(`${varName}[1]`) ?? nameToIdx.get(`${varName}[1,1]`);
        if (varIdx !== undefined && varIdx >= 0) {
          varType = arena.getVarType(varIdx);
        }
      }
      if (varType === VarType.Enumeration) continue;
      let newRhs = rhsExpr;
      if (Array.isArray(foldedRhs)) {
        newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
      } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
        newRhs = arena.addBoolLiteral(foldedRhs);
      } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
        newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
      } else if (varType === VarType.String || typeof foldedRhs === "string") {
        newRhs = arena.addStringLiteral(String(foldedRhs));
      } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
        newRhs = arena.addRealLiteral(foldedRhs);
      } else if (typeof foldedRhs === "boolean") {
        newRhs = arena.addBoolLiteral(foldedRhs);
      }
      if (newRhs !== rhsExpr) {
        arena.setStmtLeft(s, newRhs);
      }
    }
  }

  return iterations + (wasmFolded > 0 ? 1 : 0);
}

/**
 * Generates all multi-dimensional 1-based indices for a given shape.
 * Example: shape [2, 3] -> [[1,1], [1,2], [1,3], [2,1], [2,2], [2,3]]
 */
function generateIndices(shape: number[]): number[][] {
  if (shape.length === 0 || shape.some((d) => d <= 0)) return [];
  const result: number[][] = [];
  const current: number[] = new Array(shape.length).fill(1);

  while (true) {
    result.push([...current]);
    let i = shape.length - 1;
    while (i >= 0) {
      current[i] = current[i]! + 1;
      if (current[i]! <= shape[i]!) break;
      current[i] = 1;
      i--;
    }
    if (i < 0) break;
  }
  return result;
}

/**
 * Helper to extract an element from a multi-dimensional or 1D ArrayCtor expression.
 * Returns -1 if index is invalid or expression is not an ArrayCtor.
 */
function getArrayCtorElement(dae: DAEBuilder, ctorId: number, idx: number[]): number {
  let depth = 0;
  let probe = ctorId;
  while (probe >= 0 && dae.getExprKind(probe) === ExprKind.ArrayCtor) {
    depth++;
    probe = dae.getExprLeft(probe);
  }
  const effectiveIdx = depth > 0 && depth < idx.length ? idx.slice(idx.length - depth) : idx;
  let curr = ctorId;
  for (const index of effectiveIdx) {
    const k = index - 1; // 1-based index to 0-based
    if (dae.getExprKind(curr) !== ExprKind.ArrayCtor) {
      return -1;
    }
    const count = dae.getExprData1(curr);
    if (k < 0 || k >= count) return -1;
    curr = k === 0 ? dae.getExprLeft(curr) : dae.getExprLeft(curr + k);
  }
  return curr;
}

/**
 * Checks if the DAE contains any array or record equations that need to be scalarized.
 */
export function hasArrayEquations(dae: DAEBuilder): boolean {
  let compositePrefixes: Set<string> | null = null;
  const getCompositePrefixes = (): Set<string> => {
    if (compositePrefixes) return compositePrefixes;
    compositePrefixes = new Set<string>();
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const vName = dae.getVarName(i);
      let dotPos = vName.indexOf(".");
      while (dotPos > 0) {
        compositePrefixes.add(vName.slice(0, dotPos));
        dotPos = vName.indexOf(".", dotPos + 1);
      }
    }
    return compositePrefixes;
  };

  const isComposite = (exprId: number): boolean => {
    if (exprId < 0) return false;
    const k = dae.getExprKind(exprId);
    if (k === ExprKind.ArrayCtor) return true;
    if (k === ExprKind.Call && isComplexRecordCall(dae, exprId)) return true;
    if (k === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        if (dae.getVarIdxByName(`${name}[1]`) >= 0) return true;
        const vIdx = dae.getVarIdxByName(name);
        if (vIdx >= 0 && dae.getVarShape(vIdx).length > 0) return true;
        if (vIdx < 0 && getCompositePrefixes().has(name)) {
          return true;
        }
      }
    }
    if (k === ExprKind.Der || k === ExprKind.Pre) {
      return isComposite(dae.getExprData1(exprId));
    }
    return false;
  };

  for (let e = 0; e < dae.exprCount; e++) {
    if (dae.getExprKind(e) === ExprKind.Call) {
      const fnName = dae.interner.resolve(dae.getExprData1(e)) || "";
      if (
        fnName === "Complex" ||
        fnName.startsWith("Complex.") ||
        fnName.startsWith("Modelica.ComplexMath.") ||
        fnName.startsWith("ComplexMath.")
      ) {
        return true;
      }
      if (dae.functions.size > 0 && lookupRecordFunctionInDae(dae, fnName)) {
        return true;
      }
    }
  }

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Array || kind === EqKind.For || kind === EqKind.InitialFor) return true;
    if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      if (isComposite(lhs) || isComposite(rhs)) return true;
    } else if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (meta) {
        for (const eq of meta.thenEquations) {
          if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
        }
        for (const clause of meta.elseIfClauses) {
          for (const eq of clause.bodyEquations) {
            if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
          }
        }
        if (meta.elseEquations) {
          for (const eq of meta.elseEquations) {
            if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
          }
        }
      }
    } else if (kind === EqKind.When) {
      const meta = dae.getWhenEquationMeta(i);
      if (meta) {
        for (const eq of meta.bodyEquations) {
          if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
        }
      }
    }
  }
  return false;
}

function getArrayElements(dae: DAEBuilder, exprId: number): number[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    const elements: number[] = [];
    for (let i = 0; i < count; i++) {
      elements.push(i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i));
    }
    let hasNested = false;
    for (const e of elements) {
      if (dae.getExprKind(e) === ExprKind.ArrayCtor || getArrayElements(dae, e) !== null) {
        hasNested = true;
        break;
      }
    }
    if (hasNested) {
      const flattened: number[] = [];
      for (const e of elements) {
        const sub = getArrayElements(dae, e);
        if (sub) flattened.push(...sub);
        else flattened.push(e);
      }
      return flattened;
    }
    return elements;
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length > 0) {
          const indices = generateIndices(shape);
          const elements: number[] = [];
          for (const idx of indices) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${idx.join(",")}]`)));
          }
          return elements;
        }
        return null;
      }
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        const elements: number[] = [];
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${r},${c}]`)));
          }
        }
        return elements;
      }
      if (dae.getVarIdxByName(`${name}[1]`) >= 0) {
        const elements: number[] = [];
        let k = 1;
        while (dae.getVarIdxByName(`${name}[${k}]`) >= 0) {
          elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${k}]`)));
          k++;
        }
        return elements;
      }
      const indexed = (dae as any).baseArrayIndices?.get(name) as number[] | undefined;
      if (indexed && indexed.length > 0) {
        const prefixMatch = `${name}[`;
        const elements: number[] = [];
        for (const v of indexed) {
          if (dae.isVarRemoved(v)) continue;
          const vName = dae.getVarName(v);
          if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(vName)));
          }
        }
        if (elements.length > 0) return elements;
      }
    }
  }
  if (kind === ExprKind.Der) {
    const inner = dae.getExprData1(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addDerExpr(e));
    }
  }
  if (kind === ExprKind.Pre) {
    const inner = dae.getExprData1(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addPreExpr(e));
    }
  }
  if (kind === ExprKind.Negate) {
    const inner = dae.getExprLeft(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addExpression(ExprKind.Negate, 0, e));
    }
  }
  if (kind === ExprKind.Unary) {
    const op = dae.getExprData1(exprId);
    const inner = dae.getExprLeft(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addUnaryExpr(op, e));
    }
  }
  if (kind === ExprKind.Subscript) {
    const baseId = dae.getExprData1(exprId);
    const baseKind = dae.getExprKind(baseId);
    if (baseKind === ExprKind.Name) {
      const baseName = dae.interner.resolve(dae.getExprData1(baseId));
      if (baseName) {
        const scount = Math.max(1, dae.getExprRight(exprId));
        let shape: number[] = [];
        const vIdx = dae.getVarIdxByName(baseName);
        if (vIdx >= 0) {
          shape = dae.getVarShape(vIdx);
        }
        if (shape.length === 0) {
          const prefixMatch = `${baseName}[`;
          const maxDims: number[] = [];
          const candidateIndices =
            typeof dae.getArrayElementIndices === "function" ? dae.getArrayElementIndices(baseName) : null;
          if (candidateIndices && candidateIndices.length > 0) {
            for (const v of candidateIndices) {
              if (dae.isVarRemoved(v)) continue;
              const vName = dae.getVarName(v);
              if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                const idxParts = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                for (let d = 0; d < idxParts.length; d++) {
                  if (idxParts[d]! > (maxDims[d] ?? 0)) {
                    maxDims[d] = idxParts[d]!;
                  }
                }
              }
            }
          } else if (!candidateIndices) {
            for (let v = 0; v < dae.varCount; v++) {
              if (dae.isVarRemoved(v)) continue;
              const vName = dae.getVarName(v);
              if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                const idxParts = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                for (let d = 0; d < idxParts.length; d++) {
                  if (idxParts[d]! > (maxDims[d] ?? 0)) {
                    maxDims[d] = idxParts[d]!;
                  }
                }
              }
            }
          }
          if (maxDims.length > 0) {
            shape = maxDims;
          }
        }

        const dimRanges: number[][] = [];
        let hasSlice = false;
        for (let i = 0; i < scount; i++) {
          const subExpr = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          const subKind = dae.getExprKind(subExpr);
          const isColon =
            subKind === ExprKind.Colon ||
            (subKind === ExprKind.Name && dae.interner.resolve(dae.getExprData1(subExpr)) === ":");
          if (isColon) {
            hasSlice = true;
            const maxVal = i < shape.length ? shape[i]! : 1;
            const vals: number[] = [];
            for (let v = 1; v <= maxVal; v++) vals.push(v);
            dimRanges.push(vals);
          } else {
            const val = evaluateConstantArenaExpression(dae, subExpr);
            if (typeof val === "number") {
              dimRanges.push([Math.trunc(val)]);
            } else if (Array.isArray(val)) {
              hasSlice = true;
              dimRanges.push(val.map((x) => Math.trunc(Number(x))));
            } else {
              return null;
            }
          }
        }

        if (hasSlice) {
          const generateCartesian = (ranges: number[][]): number[][] => {
            if (ranges.length === 0) return [[]];
            const head = ranges[0]!;
            const rest = generateCartesian(ranges.slice(1));
            const res: number[][] = [];
            for (const h of head) {
              for (const r of rest) {
                res.push([h, ...r]);
              }
            }
            return res;
          };
          const tuples = generateCartesian(dimRanges);
          const elements: number[] = [];
          for (const t of tuples) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${t.join(",")}]`)));
          }
          return elements;
        }
      }
    }
  }
  return null;
}

const BUILTIN_UNQUALIFIED_FUNCTIONS = new Set([
  "abs",
  "sign",
  "sqrt",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "log",
  "log10",
  "min",
  "max",
  "sum",
  "product",
  "mod",
  "rem",
  "div",
  "ceil",
  "floor",
  "integer",
  "homotopy",
  "semiLinear",
  "smooth",
  "noEvent",
  "initial",
  "terminal",
  "sample",
  "pre",
  "edge",
  "change",
  "reinit",
  "delay",
  "spatialDistribution",
  "cardinality",
  "size",
  "ndims",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "linspace",
  "transpose",
  "outerProduct",
  "symmetric",
  "cross",
  "skew",
  "scalar",
  "vector",
  "matrix",
  "String",
  "Real",
  "Integer",
  "Boolean",
  "der",
  "actualStream",
  "inStream",
]);

function lookupRecordFunctionInDae(dae: DAEBuilder, rawFnName: string | undefined): DAEBuilder | null {
  if (!rawFnName) return null;
  const fnName = rawFnName.startsWith(".") ? rawFnName.slice(1) : rawFnName;
  const parts = fnName.split(".");
  if (parts.length === 1 && BUILTIN_UNQUALIFIED_FUNCTIONS.has(fnName)) {
    return null;
  }
  const shortName = parts[parts.length - 1]!;
  const isBuiltinShort = BUILTIN_UNQUALIFIED_FUNCTIONS.has(shortName);
  const lastTwo = parts.length >= 2 ? `${parts[parts.length - 2]}.${shortName}` : null;
  const direct =
    dae.functions.get(rawFnName) ||
    dae.functions.get(fnName) ||
    (!isBuiltinShort ? dae.functions.get(shortName) : null) ||
    (dae.name ? dae.functions.get(`${dae.name}.${fnName}`) : null) ||
    (!isBuiltinShort && dae.name ? dae.functions.get(`${dae.name}.${shortName}`) : null);
  if (direct) return direct;
  let twoSegMatch: DAEBuilder | null = null;
  let suffixMatch: DAEBuilder | null = null;
  const shortSuffix = `.${shortName}`;
  const twoSegSuffix = lastTwo ? `.${lastTwo}` : null;
  for (const [k, v] of dae.functions.entries()) {
    if (typeof k === "string") {
      if (k.endsWith(`.${fnName}`)) return v;
      if (twoSegSuffix && k.endsWith(twoSegSuffix) && !twoSegMatch) {
        twoSegMatch = v;
      }
      if (!isBuiltinShort && k.endsWith(shortSuffix) && !suffixMatch) {
        suffixMatch = v;
      }
    }
  }
  return twoSegMatch || suffixMatch;
}

function isComplexRecordCall(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return false;
  const fnName = dae.interner.resolve(dae.getExprData1(exprId)) || "";
  if (fnName.startsWith("Complex.'=='") || fnName.startsWith("Complex.'<>'")) return false;
  return (
    fnName === "Complex" ||
    fnName.startsWith("Complex.") ||
    fnName === "Modelica.ComplexMath.conj" ||
    fnName === "Modelica.ComplexMath.fromPolar" ||
    fnName === "Modelica.ComplexMath.exp" ||
    fnName === "Modelica.ComplexMath.sqrt"
  );
}

interface RecordFieldIndex {
  exactFields: Map<string, string[]>;
  arrayElemFields: Map<string, string[]>;
  streamPrefixes: Set<string>;
}

function buildRecordFieldIndex(dae: DAEBuilder): RecordFieldIndex {
  const exactFields = new Map<string, string[]>();
  const arrayElemFields = new Map<string, string[]>();
  const streamPrefixes = new Set<string>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vName = dae.getVarName(i);
    if (!vName.includes(".")) continue;
    const isStream = dae.isVarStream(i);

    let bracketDepth = 0;
    for (let c = 0; c < vName.length; c++) {
      const ch = vName.charCodeAt(c);
      if (ch === 91 /* '[' */) {
        bracketDepth++;
      } else if (ch === 93 /* ']' */) {
        if (bracketDepth > 0) bracketDepth--;
      } else if (ch === 46 /* '.' */ && bracketDepth === 0) {
        const pfx = vName.slice(0, c);
        const rest = vName.slice(c + 1);
        if (!rest) continue;
        let list = exactFields.get(pfx);
        if (!list) {
          list = [];
          exactFields.set(pfx, list);
        }
        list.push(rest);

        if (pfx.includes("[")) {
          const stripped = pfx.replace(/\[[^\][]*\]/g, "");
          if (stripped && stripped !== pfx) {
            let arrList = arrayElemFields.get(stripped);
            if (!arrList) {
              arrList = [];
              arrayElemFields.set(stripped, arrList);
            }
            if (!arrList.includes(rest)) {
              arrList.push(rest);
            }
          }
        }
        if (isStream) {
          streamPrefixes.add(pfx);
        }
      }
    }
  }

  return { exactFields, arrayElemFields, streamPrefixes };
}

function getRecordFields(
  dae: DAEBuilder,
  exprId: number,
  expandOperatorRecords = false,
  recordIndex?: RecordFieldIndex,
): string[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (expandOperatorRecords && kind === ExprKind.Call && isComplexRecordCall(dae, exprId)) {
    return ["re", "im"];
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name && dae.getVarIdxByName(name) < 0) {
      if (recordIndex) {
        const baseName = name.replace(/\[[^\][]*\]/g, "");
        const exact = recordIndex.exactFields.get(name);
        const baseExact = baseName !== name ? recordIndex.exactFields.get(baseName) : undefined;
        const arrElem = recordIndex.arrayElemFields.get(baseName);
        if (!exact && !baseExact && !arrElem) return null;
        const seen = new Set<string>();
        if (exact) for (const f of exact) seen.add(f);
        if (baseExact) for (const f of baseExact) seen.add(f);
        if (arrElem) for (const f of arrElem) seen.add(f);
        return seen.size > 0 ? Array.from(seen) : null;
      }
      const prefix = `${name}.`;
      const baseName = name.replace(/\[[^\][]*\]/g, "");
      const basePrefix = `${baseName}.`;
      const fields: string[] = [];
      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        const vName = dae.getVarName(i);
        if (vName.startsWith(prefix)) {
          fields.push(vName.slice(prefix.length));
        } else if (basePrefix !== prefix && vName.startsWith(basePrefix)) {
          fields.push(vName.slice(basePrefix.length));
        } else if (vName.startsWith(baseName + "[")) {
          let rest = vName.slice(baseName.length);
          while (rest.startsWith("[")) {
            const closeIdx = rest.indexOf("]");
            if (closeIdx < 0) break;
            rest = rest.slice(closeIdx + 1);
          }
          if (rest.startsWith(".") && rest.length > 1) {
            fields.push(rest.slice(1));
          }
        }
      }
      if (fields.length > 0) return Array.from(new Set(fields));
    }
  }
  if (kind === ExprKind.Subscript) {
    return getRecordFields(dae, dae.getExprData1(exprId), expandOperatorRecords, recordIndex);
  }
  if (kind === ExprKind.IfElse) {
    return (
      getRecordFields(dae, dae.getExprLeft(exprId), expandOperatorRecords, recordIndex) ||
      getRecordFields(dae, dae.getExprRight(exprId), expandOperatorRecords, recordIndex)
    );
  }
  return null;
}

function isRecordConstructorCall(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return false;
  const rawFnName = dae.interner.resolve(dae.getExprData1(exprId));
  const fn = lookupRecordFunctionInDae(dae, rawFnName);
  if (
    !dae.extensionMetadata?.["isOldFrontend"] &&
    fn &&
    ((fn as any).isOperatorRecord || fn.extensionMetadata?.isOperatorRecord)
  ) {
    return false;
  }
  if (fn && fn.description && fn.description.startsWith("Automatically generated record constructor")) {
    return true;
  }
  return false;
}

function getFieldExpr(
  dae: DAEBuilder,
  out: DAEBuilder,
  exprId: number,
  field: string,
  cloneExpr?: (id: number, suffix: string, shape: number[] | null) => number,
  expandOperatorRecords = false,
): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (
        (field === "re" || field === "im") &&
        (name === "Modelica.ComplexMath.j" || name === "ComplexMath.j" || name?.endsWith(".ComplexMath.j"))
      ) {
        return out.addRealLiteral(field === "re" ? 0.0 : 1.0);
      }
      if (
        expandOperatorRecords &&
        (field === "re" || field === "im") &&
        name &&
        dae.getVarIdxByName(`${name}.re`) < 0 &&
        dae.getVarIdxByName(`${name}.im`) < 0 &&
        dae.getVarIdxByName(name) >= 0
      ) {
        return field === "re" ? out.addNameExpr(name) : out.addRealLiteral(0.0);
      }
      const candidate = `${name}.${field}`;
      if (name && out.getVarIdxByName(candidate) < 0 && dae.getVarIdxByName(candidate) < 0 && name.endsWith("]")) {
        const m = /^(.+)(\[[^\][]+])$/.exec(name);
        if (m) {
          const transposed = `${m[1]}.${field}${m[2]}`;
          if (out.getVarIdxByName(transposed) >= 0 || dae.getVarIdxByName(`${m[1]}.${field}`) >= 0) {
            return out.addNameExpr(transposed);
          }
        }
      }
      return out.addNameExpr(candidate);
    }
    case ExprKind.Call: {
      const rawFnName = dae.interner.resolve(dae.getExprData1(exprId)) || "";
      if (expandOperatorRecords && (field === "re" || field === "im")) {
        const argCount = dae.getExprRight(exprId);
        const getArg = (idx: number) => (idx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + idx));
        const cloneScalar = (id: number) => (cloneExpr ? cloneExpr(id, "", null) : id);
        const getRe = (id: number) => getFieldExpr(dae, out, id, "re", cloneExpr, true);
        const getIm = (id: number) => getFieldExpr(dae, out, id, "im", cloneExpr, true);
        if (rawFnName === "Complex" || rawFnName === "Complex.'constructor'.fromReal") {
          if (field === "re") return argCount >= 1 ? cloneScalar(getArg(0)) : out.addRealLiteral(0);
          return argCount >= 2 ? cloneScalar(getArg(1)) : out.addRealLiteral(0);
        }
        if (rawFnName === "Complex.'0'") {
          return out.addRealLiteral(0);
        }
        if ((rawFnName === "Complex.'+'.add" || rawFnName === "Complex.'+'") && argCount >= 2) {
          return out.addBinaryExpr(
            BinOp.Add,
            getFieldExpr(dae, out, getArg(0), field, cloneExpr, true),
            getFieldExpr(dae, out, getArg(1), field, cloneExpr, true),
          );
        }
        if ((rawFnName === "Complex.'-'.subtract" || (rawFnName === "Complex.'-'" && argCount >= 2)) && argCount >= 2) {
          return out.addBinaryExpr(
            BinOp.Sub,
            getFieldExpr(dae, out, getArg(0), field, cloneExpr, true),
            getFieldExpr(dae, out, getArg(1), field, cloneExpr, true),
          );
        }
        if ((rawFnName === "Complex.'-'.negate" || (rawFnName === "Complex.'-'" && argCount === 1)) && argCount >= 1) {
          return out.addExpression(ExprKind.Negate, 0, getFieldExpr(dae, out, getArg(0), field, cloneExpr, true));
        }
        if ((rawFnName === "Complex.'*'.multiply" || rawFnName === "Complex.'*'") && argCount >= 2) {
          const aRe = getRe(getArg(0));
          const aIm = getIm(getArg(0));
          const bRe = getRe(getArg(1));
          const bIm = getIm(getArg(1));
          if (field === "re") {
            return out.addBinaryExpr(
              BinOp.Sub,
              out.addBinaryExpr(BinOp.Mul, aRe, bRe),
              out.addBinaryExpr(BinOp.Mul, aIm, bIm),
            );
          }
          return out.addBinaryExpr(
            BinOp.Add,
            out.addBinaryExpr(BinOp.Mul, aRe, bIm),
            out.addBinaryExpr(BinOp.Mul, aIm, bRe),
          );
        }
        if ((rawFnName === "Complex.'/'.divide" || rawFnName === "Complex.'/'") && argCount >= 2) {
          const aRe = getRe(getArg(0));
          const aIm = getIm(getArg(0));
          const bRe = getRe(getArg(1));
          const bIm = getIm(getArg(1));
          const denom = out.addBinaryExpr(
            BinOp.Add,
            out.addBinaryExpr(BinOp.Mul, bRe, bRe),
            out.addBinaryExpr(BinOp.Mul, bIm, bIm),
          );
          if (field === "re") {
            const numRe = out.addBinaryExpr(
              BinOp.Add,
              out.addBinaryExpr(BinOp.Mul, aRe, bRe),
              out.addBinaryExpr(BinOp.Mul, aIm, bIm),
            );
            return out.addBinaryExpr(BinOp.Div, numRe, denom);
          }
          const numIm = out.addBinaryExpr(
            BinOp.Sub,
            out.addBinaryExpr(BinOp.Mul, aIm, bRe),
            out.addBinaryExpr(BinOp.Mul, aRe, bIm),
          );
          return out.addBinaryExpr(BinOp.Div, numIm, denom);
        }
        if ((rawFnName === "Modelica.ComplexMath.conj" || rawFnName === "ComplexMath.conj") && argCount >= 1) {
          if (field === "re") return getRe(getArg(0));
          return out.addExpression(ExprKind.Negate, 0, getIm(getArg(0)));
        }
        if (
          (rawFnName === "Modelica.ComplexMath.fromPolar" || rawFnName === "ComplexMath.fromPolar") &&
          argCount >= 2
        ) {
          const lenExpr = cloneScalar(getArg(0));
          const phiExpr = cloneScalar(getArg(1));
          return out.addBinaryExpr(BinOp.Mul, lenExpr, out.addCallExpr(field === "re" ? "cos" : "sin", [phiExpr]));
        }
        if ((rawFnName === "Modelica.ComplexMath.exp" || rawFnName === "ComplexMath.exp") && argCount >= 1) {
          const aRe = getRe(getArg(0));
          const aIm = getIm(getArg(0));
          return out.addBinaryExpr(
            BinOp.Mul,
            out.addCallExpr("exp", [aRe]),
            out.addCallExpr(field === "re" ? "cos" : "sin", [aIm]),
          );
        }
      }
      const fn = lookupRecordFunctionInDae(dae, rawFnName);
      if (fn && cloneExpr) {
        const argCount = dae.getExprRight(exprId);
        let paramIdx = 0;
        for (let p = 0; p < fn.varCount; p++) {
          if (fn.getVarCausality(p) === Causality.Input) {
            const pName = fn.getVarName(p);
            if (pName === field) {
              if (paramIdx < argCount) {
                const argExprId = paramIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + paramIdx);
                if (fn.getVarType(p) === VarType.Real && dae.getExprKind(argExprId) === ExprKind.IntLiteral) {
                  return out.addRealLiteral(dae.getExprData1(argExprId));
                }
                return cloneExpr(argExprId, "", null);
              }
            } else if (field.startsWith(`${pName}[`) && field.endsWith("]")) {
              if (paramIdx < argCount) {
                const argExprId = paramIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + paramIdx);
                const idx = field
                  .slice(pName.length + 1, -1)
                  .split(",")
                  .map(Number);
                if (idx.length > 0 && idx.every((n) => !Number.isNaN(n) && n >= 1)) {
                  const elemExprId = getArrayCtorElement(dae, argExprId, idx);
                  if (elemExprId >= 0) {
                    if (fn.getVarType(p) === VarType.Real && dae.getExprKind(elemExprId) === ExprKind.IntLiteral) {
                      return out.addRealLiteral(dae.getExprData1(elemExprId));
                    }
                    return cloneExpr(elemExprId, "", null);
                  }
                  const elems = getArrayElements(dae, argExprId);
                  if (elems) {
                    const shape = fn.getVarShape(p);
                    if (shape.length === idx.length) {
                      const indices = generateIndices(shape);
                      const flatIdx = indices.findIndex((t) => t.every((v, i) => v === idx[i]));
                      if (flatIdx >= 0 && flatIdx < elems.length) {
                        const eId = elems[flatIdx]!;
                        if (fn.getVarType(p) === VarType.Real && dae.getExprKind(eId) === ExprKind.IntLiteral) {
                          return out.addRealLiteral(dae.getExprData1(eId));
                        }
                        return cloneExpr(eId, "", null);
                      }
                    }
                  }
                }
              }
            } else if (field.startsWith(`${pName}.`)) {
              if (paramIdx < argCount) {
                const argExprId = paramIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + paramIdx);
                return getFieldExpr(
                  dae,
                  out,
                  argExprId,
                  field.slice(pName.length + 1),
                  cloneExpr,
                  expandOperatorRecords,
                );
              }
            }
            paramIdx++;
          }
        }
      }
      return cloneExpr ? cloneExpr(exprId, "", null) : exprId;
    }
    case ExprKind.IfElse: {
      const cond = cloneExpr ? cloneExpr(dae.getExprData1(exprId), "", null) : dae.getExprData1(exprId);
      const thenBranch = getFieldExpr(dae, out, dae.getExprLeft(exprId), field, cloneExpr, expandOperatorRecords);
      const elseBranch = getFieldExpr(dae, out, dae.getExprRight(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addIfElseExpr(cond, thenBranch, elseBranch);
    }
    case ExprKind.Der: {
      const inner = getFieldExpr(dae, out, dae.getExprData1(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addDerExpr(inner);
    }
    case ExprKind.Negate: {
      const inner = getFieldExpr(dae, out, dae.getExprLeft(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addExpression(ExprKind.Negate, 0, inner);
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const inner = getFieldExpr(dae, out, dae.getExprLeft(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addUnaryExpr(op, inner);
    }
    case ExprKind.Subscript: {
      const baseId = dae.getExprData1(exprId);
      const subCount = dae.getExprRight(exprId);
      const subs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const rawSub = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        subs.push(cloneExpr ? cloneExpr(rawSub, "", null) : rawSub);
      }
      if (
        dae.getExprKind(baseId) === ExprKind.Name &&
        subs.length > 0 &&
        subs.every((s) => out.getExprKind(s) === ExprKind.IntLiteral)
      ) {
        const baseName = dae.interner.resolve(dae.getExprData1(baseId));
        if (baseName) {
          const idxStr = subs.map((s) => out.getExprData1(s)).join(",");
          const candidate = `${baseName}[${idxStr}].${field}`;
          if (out.getVarIdxByName(candidate) >= 0 || dae.getVarIdxByName(candidate) >= 0) {
            return out.addNameExpr(candidate);
          }
          const transposed = `${baseName}.${field}[${idxStr}]`;
          if (out.getVarIdxByName(transposed) >= 0 || dae.getVarIdxByName(`${baseName}.${field}`) >= 0) {
            return out.addNameExpr(transposed);
          }
        }
      }
      const target = getFieldExpr(dae, out, baseId, field, cloneExpr, expandOperatorRecords);
      return out.addSubscriptExpr(target, subs);
    }
    default:
      if (
        expandOperatorRecords &&
        field === "im" &&
        (kind === ExprKind.RealLiteral || kind === ExprKind.IntLiteral || kind === ExprKind.Binary)
      ) {
        return out.addRealLiteral(0.0);
      }
      return cloneExpr ? cloneExpr(exprId, "", null) : exprId;
  }
}

function evalConstantNum(dae: DAEBuilder, exprId: number): number | null {
  const val = evaluateConstantArenaExpression(dae, exprId);
  if (typeof val === "number") return val;
  return null;
}

export function getMatrixDimensions(
  dae: DAEBuilder,
  exprId: number,
  isInnerRow = false,
): { rows: number; cols: number } | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        if (rows > 0 && cols > 0) return { rows, cols };
      }
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 2) return { rows: shape[0]!, cols: shape[1]! };
        if (shape.length === 1) return { rows: shape[0]!, cols: 1 };
      }
      if (dae.getVarIdxByName(`${name}[1]`) >= 0) {
        let count = 0;
        while (dae.getVarIdxByName(`${name}[${count + 1}]`) >= 0) count++;
        if (count > 0) return { rows: count, cols: 1 };
      }
      return null;
    }
    case ExprKind.Call: {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName === "/*Real*/" || fnName === "Real") {
        return getMatrixDimensions(dae, dae.getExprLeft(exprId), isInnerRow);
      }
      if (fnName === "transpose") {
        const inner = dae.getExprLeft(exprId);
        const innerDims = getMatrixDimensions(dae, inner, false);
        if (innerDims) {
          return { rows: innerDims.cols, cols: innerDims.rows };
        }
        return null;
      }
      if (fnName === "zeros" || fnName === "ones") {
        const argCount = dae.getExprRight(exprId);
        if (argCount >= 2) {
          const r = evalConstantNum(dae, dae.getExprLeft(exprId));
          const c = evalConstantNum(dae, dae.getExprLeft(exprId + 1));
          if (r !== null && c !== null && r > 0 && c > 0) {
            return { rows: Math.trunc(r), cols: Math.trunc(c) };
          }
        } else if (argCount === 1) {
          const n = evalConstantNum(dae, dae.getExprLeft(exprId));
          if (n !== null && n > 0) {
            return { rows: Math.trunc(n), cols: 1 };
          }
        }
      }
      return null;
    }
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      if (count <= 0) return null;
      const elems = getArrayElements(dae, exprId);
      if (!elems || elems.length === 0) return null;

      if (isInnerRow) {
        return { rows: 1, cols: count };
      }

      const hasArrayOrMatrixChild = elems.some((e) => {
        const k = dae.getExprKind(e);
        if (k === ExprKind.ArrayCtor) return true;
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(e));
          if (fn === "zeros" || fn === "ones" || fn === "transpose" || fn === "/*Real*/" || fn === "Real") return true;
        }
        return false;
      });

      if (hasArrayOrMatrixChild) {
        let totalRows = 0;
        let maxCols = 1;
        for (const elem of elems) {
          const d = getMatrixDimensions(dae, elem, true);
          if (d) {
            totalRows += d.rows;
            if (d.cols > maxCols) maxCols = d.cols;
          } else {
            totalRows += 1;
          }
        }
        return { rows: totalRows, cols: maxCols };
      }

      return { rows: count, cols: 1 };
    }
    default:
      return null;
  }
}

export function getMatrixElement(
  dae: DAEBuilder,
  exprId: number,
  row: number,
  col: number,
  isInnerRow = false,
): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row},${col}]`));
      }
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 2) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row},${col}]`));
        }
        if (shape.length === 1 && col === 1) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row}]`));
        }
      }
      if (col === 1 && dae.getVarIdxByName(`${name}[${row}]`) >= 0) {
        return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row}]`));
      }
      return null;
    }
    case ExprKind.Call: {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName === "/*Real*/" || fnName === "Real") {
        return getMatrixElement(dae, dae.getExprLeft(exprId), row, col, isInnerRow);
      }
      if (fnName === "transpose") {
        const inner = dae.getExprLeft(exprId);
        return getMatrixElement(dae, inner, col, row, false);
      }
      if (fnName === "zeros" || fnName === "ones") {
        return dae.addRealLiteral(fnName === "zeros" ? 0.0 : 1.0);
      }
      return null;
    }
    case ExprKind.ArrayCtor: {
      const elems = getArrayElements(dae, exprId);
      if (!elems || elems.length === 0) return null;

      if (isInnerRow) {
        if (row === 1 && col >= 1 && col <= elems.length) {
          return elems[col - 1]!;
        }
        return null;
      }

      const hasArrayOrMatrixChild = elems.some((e) => {
        const k = dae.getExprKind(e);
        if (k === ExprKind.ArrayCtor) return true;
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(e));
          if (fn === "zeros" || fn === "ones" || fn === "transpose" || fn === "/*Real*/" || fn === "Real") return true;
        }
        return false;
      });

      if (hasArrayOrMatrixChild) {
        let currentRow = 1;
        for (const elem of elems) {
          const d = getMatrixDimensions(dae, elem, true);
          const elemRows = d ? d.rows : 1;
          if (row >= currentRow && row < currentRow + elemRows) {
            const subRow = row - currentRow + 1;
            if (d) {
              return getMatrixElement(dae, elem, subRow, col, true);
            } else {
              if (col === 1) return elem;
              return null;
            }
          }
          currentRow += elemRows;
        }
        return null;
      }

      if (col === 1 && row >= 1 && row <= elems.length) {
        return elems[row - 1]!;
      }
      return null;
    }
    default:
      if (row === 1 && col === 1) return exprId;
      return null;
  }
}

function isLiteralZero(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === 0) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === 0) return true;
  return false;
}

export function isArrayOfLength(dae: DAEBuilder, exprId: number, n: number): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    return dae.getExprData1(exprId) === n;
  }
  if (kind === ExprKind.Der || kind === ExprKind.Pre) {
    return isArrayOfLength(dae, dae.getExprData1(exprId), n);
  }
  if (kind === ExprKind.Subscript) {
    const subCount = dae.getExprRight(exprId);
    for (let i = 0; i < subCount; i++) {
      const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (isArrayOfLength(dae, sId, n)) return true;
    }
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return isArrayOfLength(dae, dae.getExprLeft(exprId), n);
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Mul) {
      const l = dae.getExprLeft(exprId);
      const matDim = getMatrixDimensions(dae, l);
      if (matDim && matDim.rows === n) return true;
    }
    return isArrayOfLength(dae, dae.getExprLeft(exprId), n) || isArrayOfLength(dae, dae.getExprRight(exprId), n);
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 1) return shape[0] === n;
        if (shape.length > 1) {
          const total = shape.reduce((a, b) => a * b, 1);
          return total === n;
        }
      }
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        return rows * cols === n;
      }
      return dae.getVarIdxByName(`${name}[${n}]`) >= 0 && dae.getVarIdxByName(`${name}[${n + 1}]`) < 0;
    }
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    const argCount = dae.getExprRight(exprId);
    if (fnName === "fill" && argCount >= 2) {
      let prod = 1;
      for (let i = 1; i < argCount; i++) {
        const countExpr = dae.getExprLeft(exprId + i);
        const countVal = evaluateConstantArenaExpression(dae, countExpr);
        if (typeof countVal === "number") {
          if (i === 1 && Math.trunc(countVal) === n) return true;
          prod *= Math.trunc(countVal);
        } else {
          prod = -1;
          break;
        }
      }
      if (prod === n) return true;
    }
    if ((fnName === "zeros" || fnName === "ones") && argCount >= 1) {
      let prod = 1;
      for (let i = 0; i < argCount; i++) {
        const countExpr = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        const countVal = evaluateConstantArenaExpression(dae, countExpr);
        if (typeof countVal === "number") {
          if (i === 0 && Math.trunc(countVal) === n) return true;
          prod *= Math.trunc(countVal);
        } else {
          prod = -1;
          break;
        }
      }
      if (prod === n) return true;
    }
    for (let i = 0; i < argCount; i++) {
      const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (isArrayOfLength(dae, argExprId, n)) return true;
    }
  }
  return false;
}

export function getNthExpr(dae: DAEBuilder, exprId: number, k: number, n: number): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.ArrayCtor: {
      let res = exprId;
      const count = dae.getExprData1(exprId);
      if (count === n) {
        res = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
      } else {
        const elems = getArrayElements(dae, exprId);
        if (elems && elems.length === n) {
          res = elems[k]!;
        }
      }
      if (res !== exprId && res >= 0) {
        while (
          (dae.getExprKind(res) === ExprKind.ArrayCtor || dae.getExprKind(res) === ExprKind.Tuple) &&
          dae.getExprData1(res) === 1
        ) {
          res = dae.getExprLeft(res);
        }
        return res;
      }
      return exprId;
    }
    case ExprKind.Tuple: {
      const count = dae.getExprData1(exprId);
      if (count === n) {
        let res = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
        while (
          (dae.getExprKind(res) === ExprKind.ArrayCtor || dae.getExprKind(res) === ExprKind.Tuple) &&
          dae.getExprData1(res) === 1
        ) {
          res = dae.getExprLeft(res);
        }
        return res;
      }
      return exprId;
    }
    case ExprKind.Der: {
      const inner = dae.getExprData1(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addDerExpr(innerElem);
    }
    case ExprKind.Pre: {
      const inner = dae.getExprData1(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addPreExpr(innerElem);
    }
    case ExprKind.Negate: {
      const inner = dae.getExprLeft(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addExpression(ExprKind.Negate, 0, innerElem);
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const operand = dae.getExprLeft(exprId);
      const opElem = getNthExpr(dae, operand, k, n);
      return dae.addUnaryExpr(op, opElem);
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId);
      const left = dae.getExprLeft(exprId);
      const right = dae.getExprRight(exprId);

      // Check for matrix-vector multiplication: M * v where M has rows=n
      if (op === BinOp.Mul) {
        const matDim = getMatrixDimensions(dae, left);
        if (matDim && matDim.rows === n && matDim.cols > 0) {
          let rowSum: number | null = null;
          for (let j = 0; j < matDim.cols; j++) {
            const matElem = getMatrixElement(dae, left, k + 1, j + 1);
            if (matElem === null) continue;
            if (isLiteralZero(dae, matElem)) continue;
            const vecElem = getNthExpr(dae, right, j, matDim.cols);
            if (isLiteralZero(dae, vecElem)) continue;
            const prod = dae.addBinaryExpr(BinOp.Mul, matElem, vecElem);
            rowSum = rowSum === null ? prod : dae.addBinaryExpr(BinOp.Add, rowSum, prod);
          }
          if (rowSum !== null) return rowSum;
          return dae.addRealLiteral(0.0);
        }
      }

      const leftIsArr = isArrayOfLength(dae, left, n);
      const rightIsArr = isArrayOfLength(dae, right, n);
      const leftElem = leftIsArr ? getNthExpr(dae, left, k, n) : left;
      const rightElem = rightIsArr ? getNthExpr(dae, right, k, n) : right;
      return dae.addBinaryExpr(op, leftElem, rightElem);
    }
    case ExprKind.Call: {
      const funcNameId = dae.getExprData1(exprId);
      const fnName = dae.interner.resolve(funcNameId) || "";
      const argCount = dae.getExprRight(exprId);
      if (fnName === "/*Real*/" || fnName === "Real" || fnName.startsWith("/*Real[")) {
        const inner = dae.getExprLeft(exprId);
        const innerElem = getNthExpr(dae, inner, k, n);
        if (dae.getExprKind(innerElem) === ExprKind.RealLiteral) {
          return innerElem;
        }
        if (dae.getExprKind(innerElem) === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprData1(innerElem));
        }
        return dae.addCallExpr("/*Real*/", [innerElem]);
      }
      if (fnName === "linspace" && argCount >= 2) {
        const startExpr = dae.getExprLeft(exprId);
        const stopExpr = dae.getExprLeft(exprId + 1);
        const evalNum = (id: number): number | null => {
          const knd = dae.getExprKind(id);
          if (knd === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (knd === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (knd === ExprKind.Negate) {
            const v = evalNum(dae.getExprLeft(id));
            return v !== null ? -v : null;
          }
          if (knd === ExprKind.Name) {
            const nm = dae.interner.resolve(dae.getExprData1(id));
            if (nm) {
              const vi = dae.getVarIdxByName(nm);
              if (vi >= 0) {
                const bx = dae.getVarExpression(vi);
                if (bx !== undefined && bx >= 0) return evalNum(bx);
                const sv = dae.getVarStartValue(vi);
                if (sv !== 0) return sv;
              }
            }
          }
          return null;
        };
        const sVal = evalNum(startExpr);
        const eVal = evalNum(stopExpr);
        let nVal = n;
        if (argCount >= 3) {
          const argN = evalNum(dae.getExprLeft(exprId + 2));
          if (argN !== null && argN >= 2) nVal = Math.trunc(argN);
        }
        if (sVal !== null && eVal !== null && nVal >= 2) {
          const step = (eVal - sVal) / (nVal - 1);
          const val = k === 0 ? sVal : k === nVal - 1 ? eVal : sVal + k * step;
          return dae.addRealLiteral(val);
        }
      }
      if (fnName === "zeros" && argCount >= 1) {
        return dae.addIntLiteral(0);
      }
      if (fnName === "ones" && argCount >= 1) {
        return dae.addIntLiteral(1);
      }
      if (fnName === "fill" && argCount >= 2) {
        const valExprId = dae.getExprLeft(exprId);
        if (argCount === 2) {
          return valExprId;
        } else {
          let prod = 1;
          for (let i = 1; i < argCount; i++) {
            const countVal = evaluateConstantArenaExpression(dae, dae.getExprLeft(exprId + i));
            if (typeof countVal === "number") prod *= Math.trunc(countVal);
            else prod = -1;
          }
          if (prod === n) return valExprId;
          const remainingArgs: number[] = [valExprId];
          for (let i = 2; i < argCount; i++) {
            remainingArgs.push(dae.getExprLeft(exprId + i));
          }
          return dae.addCallExpr("fill", remainingArgs);
        }
      }
      const nthArgs: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        if (isArrayOfLength(dae, argExprId, n)) {
          nthArgs.push(getNthExpr(dae, argExprId, k, n));
        } else {
          nthArgs.push(argExprId);
        }
      }
      return dae.addCallExpr(fnName, nthArgs);
    }
    case ExprKind.IfElse: {
      const cond = dae.getExprData1(exprId);
      const thenBranch = dae.getExprLeft(exprId);
      const elseBranch = dae.getExprRight(exprId);
      const thenElem = getNthExpr(dae, thenBranch, k, n);
      const elseElem = getNthExpr(dae, elseBranch, k, n);
      return dae.addIfElseExpr(cond, thenElem, elseElem);
    }
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        const vIdx = dae.getVarIdxByName(name);
        if (vIdx >= 0) {
          const shape = dae.getVarShape(vIdx);
          if (shape.length >= 1) {
            const indices = generateIndices(shape);
            if (k < indices.length) {
              const multiIdx = indices[k]!.join(",");
              return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${multiIdx}]`));
            }
          }
        }
        const hasPrefix = (p: string) => {
          for (let i = 0; i < dae.varCount; i++) {
            if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(p)) return true;
          }
          return false;
        };
        if (dae.getVarIdxByName(`${name}[1,1]`) >= 0 || hasPrefix(`${name}[1,1]`)) {
          let rows = 0;
          while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0 || hasPrefix(`${name}[${rows + 1},1]`)) rows++;
          let cols = 0;
          while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0 || hasPrefix(`${name}[1,${cols + 1}]`)) cols++;
          if (rows > 0 && cols > 0 && n === rows * cols) {
            const r = Math.floor(k / cols) + 1;
            const c = (k % cols) + 1;
            return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${r},${c}]`));
          }
        }
        const indexedName = `${name}[${k + 1}]`;
        if (
          dae.getVarIdxByName(indexedName) >= 0 ||
          dae.hasArrayElements(name) ||
          hasPrefix(`${indexedName}.`) ||
          hasPrefix(`${indexedName}[`)
        ) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(indexedName));
        }
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseId = dae.getExprData1(exprId);
      const subCount = dae.getExprRight(exprId);
      const subIds: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        if (isArrayOfLength(dae, sId, n)) {
          subIds.push(getNthExpr(dae, sId, k, n));
        } else {
          subIds.push(sId);
        }
      }
      return dae.addSubscriptExpr(baseId, subIds);
    }
    default:
      return exprId;
  }
}

function isRealType(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.Der) {
    return isRealType(dae, dae.getExprData1(exprId));
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      let vIdx = dae.getVarIdxByName(name);
      if (vIdx < 0 && name.includes("[")) {
        vIdx = dae.getVarIdxByName(name.split("[")[0]!);
      }
      if (vIdx >= 0) return dae.getVarType(vIdx) === VarType.Real;
    }
  }
  return false;
}

/**
 * Deferred Batch Scalarization Pass.
 *
 * Transforms a {@link DAEBuilder} containing unexpanded multi-dimensional array variables,
 * array/record equations, and `for` equation loops into a flat scalar {@link DAEBuilder}
 * suitable for BLT sorting and numerical integration:
 * 1. Copies model metadata, functions, diagnostics, annotations, and domain extension metadata.
 * 2. Indexes array variable shapes (`arrayShapes`) and defines `cloneExpr` to deep-copy
 *    expressions into `out` while substituting active loop indices (`loopVarMap`), appending
 *    element subscript suffixes, or reconstructing array constructors for array-taking calls.
 * 3. Expands every array variable of shape $[d_1, \dots, d_k]$ into individual scalar
 *    variables `name[i_1,...,i_k]` and slices array bindings and `start` attributes per element.
 * 4. Scalarizes equations (`emitEquation`) across array elements and record/connector fields,
 *    validating connector plug-compatibility (`M3003`) for `connect(...)` equations and
 *    unrolling `If`, `When`, and `For`/`InitialFor` equation blocks.
 * 5. Clones boundary nodes and imperative algorithm statements into the output arena.
 *
 * @param dae The input DAE arena with preserved array/record structures.
 * @returns A newly allocated `DAEBuilder` containing scalarized variables and equations.
 */
export function scalarizeArena(dae: DAEBuilder, expandArrayEquations = false): DAEBuilder {
  // --- Step 1: Clone Model Metadata & Index Array Variable Shapes ---
  const out = dae.exports
    ? new DAEBuilder(dae.exports, dae.name || "Model", dae.description || "", dae.interner)
    : new DAEBuilder(dae.interner);
  out.name = dae.name;
  out.classKind = dae.classKind;
  out.description = dae.description;
  out.isImpure = dae.isImpure;
  for (const [k, v] of dae.functions) {
    out.functions.set(k, v);
  }
  out.diagnostics.push(...dae.diagnostics);
  out.equationAnnotations = [...dae.equationAnnotations];
  out.algorithmAnnotations = [...dae.algorithmAnnotations];
  out.experiment = { ...dae.experiment };
  out.hiddenVarIndices = new Set(dae.hiddenVarIndices);
  out.extensionMetadata = {
    ...dae.extensionMetadata,
    ...(dae.extensionMetadata.webgpu && { webgpu: { ...dae.extensionMetadata.webgpu } }),
    ...(dae.extensionMetadata.audioClock && { audioClock: { ...dae.extensionMetadata.audioClock } }),
    ...(dae.extensionMetadata.surrogate && { surrogate: new Map(dae.extensionMetadata.surrogate) }),
    ...(dae.extensionMetadata.feaMesh && { feaMesh: dae.extensionMetadata.feaMesh.map((x) => ({ ...x })) }),
    ...(dae.extensionMetadata.cfdFlow && {
      cfdFlow: dae.extensionMetadata.cfdFlow.map((x) => ({ ...x, grid: x.grid ? [...x.grid] : undefined })),
    }),
    ...(dae.extensionMetadata.mbse && { mbse: { ...dae.extensionMetadata.mbse } }),
    ...(dae.extensionMetadata.fmuInstances && {
      fmuInstances: dae.extensionMetadata.fmuInstances.map((x: any) => ({
        ...x,
        inputs: [...x.inputs],
        outputs: [...x.outputs],
        parameters: [...x.parameters],
        terminalMapping: x.terminalMapping ? x.terminalMapping.map((m: any) => ({ ...m })) : undefined,
      })),
    }),
  };
  const arrayShapes = new Map<string, number[]>();
  const loopVarMap = new Map<string, number>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    let shape = dae.getVarShape(i);
    const expr = (dae as any).getExplicitVarExpression
      ? (dae as any).getExplicitVarExpression(i)
      : dae.getVarExpression(i);
    if (shape.length > 0 && shape.some((d) => d <= 0)) {
      if (expr != null && expr >= 0) {
        const k = dae.getExprKind(expr);
        if (k === ExprKind.ArrayCtor) {
          const count = dae.getExprData1(expr);
          if (count === 1) {
            const elem0 = dae.getExprLeft(expr);
            if (dae.getExprKind(elem0) === ExprKind.Name) {
              const refName = dae.interner.resolve(dae.getExprData1(elem0));
              if (refName && arrayShapes.has(refName)) {
                shape = arrayShapes.get(refName)!;
              } else if (count > 0) {
                shape = [count];
              }
            } else if (count > 0) {
              shape = [count];
            }
          } else if (count > 0) {
            shape = [count];
          }
        }
      }
    }
    if (shape.length > 0) {
      arrayShapes.set(dae.getVarName(i), shape);
    }
  }

  // --- Step 2: Expression Cloner with Loop-Index Substitution & Array Element Projection ---
  const cloneExpr = (
    exprId: number,
    indexSuffix: string,
    currentShape: number[] | null,
    reconstructArrays = false,
  ): number => {
    if (exprId < 0) return exprId;
    const kind = dae.getExprKind(exprId);

    switch (kind) {
      case ExprKind.Name: {
        const nameId = dae.getExprData1(exprId);
        const name = dae.interner.resolve(nameId);
        const cleanName = name?.startsWith("\0loop\0") ? name.substring(6) : name;
        if (cleanName && loopVarMap.has(cleanName)) {
          return out.addIntLiteral(loopVarMap.get(cleanName)!);
        }
        if (name && arrayShapes.has(name)) {
          const shape = arrayShapes.get(name)!;
          if (currentShape && shape.join(",") === currentShape.join(",")) {
            return out.addNameExpr(`${name}${indexSuffix}`);
          }
          if (reconstructArrays && !currentShape && indexSuffix === "") {
            const indices = generateIndices(shape);
            const elemExprs = indices.map((idx) => out.addNameExpr(`${name}[${idx.join(",")}]`));
            return out.addArrayCtorExpr(elemExprs);
          }
        }
        if (name && out.getVarIdxByName(name) < 0 && name.includes("[")) {
          const m = /^(.+)(\[[^\][]+])\.([^.[\]]+)$/.exec(name);
          if (m) {
            const transposed = `${m[1]}.${m[3]}${m[2]}`;
            if (out.getVarIdxByName(transposed) >= 0) {
              return out.addNameExpr(transposed);
            }
          }
        }
        return out.addNameExpr(name || "");
      }
      case ExprKind.IntLiteral:
        return out.addIntLiteral(dae.getExprData1(exprId));
      case ExprKind.RealLiteral:
        return out.addRealLiteral(dae.getExprRealValue(exprId));
      case ExprKind.BoolLiteral:
        return out.addBoolLiteral(dae.getExprData1(exprId) !== 0);
      case ExprKind.StringLiteral: {
        const strId = dae.getExprData1(exprId);
        const str = dae.interner.resolve(strId);
        return out.addStringLiteral(str || "");
      }
      case ExprKind.Binary: {
        const op = dae.getExprData1(exprId);
        const origLeft = dae.getExprLeft(exprId);
        const origRight = dae.getExprRight(exprId);
        const left = cloneExpr(origLeft, indexSuffix, currentShape);
        const right = cloneExpr(origRight, indexSuffix, currentShape);
        if (
          loopVarMap.size > 0 &&
          out.getExprKind(left) === ExprKind.IntLiteral &&
          out.getExprKind(right) === ExprKind.IntLiteral
        ) {
          const lv = out.getExprData1(left);
          const rv = out.getExprData1(right);
          if (op === BinOp.Add) return out.addIntLiteral(lv + rv);
          if (op === BinOp.Sub) return out.addIntLiteral(lv - rv);
          if (op === BinOp.Mul) return out.addIntLiteral(lv * rv);
        }
        if (op === BinOp.Mul) {
          const leftName =
            dae.getExprKind(origLeft) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(origLeft)) : null;
          const rightName =
            dae.getExprKind(origRight) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(origRight)) : null;
          const leftIsArray = Boolean(leftName && arrayShapes.has(leftName));
          const rightIsArray = Boolean(rightName && arrayShapes.has(rightName));
          if (!leftIsArray && rightIsArray) {
            return out.addBinaryExpr(op, right, left);
          }
        }
        return out.addBinaryExpr(op, left, right);
      }
      case ExprKind.Unary: {
        const op = dae.getExprData1(exprId);
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addUnaryExpr(op, operand);
      }
      case ExprKind.Negate: {
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Negate, 0, operand);
      }
      case ExprKind.Range: {
        const start = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const stepRaw = dae.getExprLeft(exprId);
        const step = stepRaw >= 0 ? cloneExpr(stepRaw, indexSuffix, currentShape) : -1;
        const stop = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Range, start, step, stop);
      }
      case ExprKind.Colon:
        return out.addColonExpr();
      case ExprKind.Comprehension: {
        const cfn = dae.interner.resolve(dae.getExprData1(exprId));
        const iterCount = dae.getExprRight(exprId);
        const clonedRanges: number[] = [];
        for (let i = 0; i < iterCount; i++) {
          const iterNodeId = exprId + 1 + i;
          clonedRanges.push(cloneExpr(dae.getExprLeft(iterNodeId), indexSuffix, currentShape));
        }
        const inner = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const compId = out.addExpression(ExprKind.Comprehension, out.interner.intern(cfn || ""), inner, iterCount);
        for (let i = 0; i < iterCount; i++) {
          const iterNodeId = exprId + 1 + i;
          const varName = dae.interner.resolve(dae.getExprData1(iterNodeId));
          out.addExpression(ExprKind.Tuple, out.interner.intern(varName || ""), clonedRanges[i]!, 0);
        }
        return compId;
      }
      case ExprKind.PartialFunc: {
        const pfn = dae.interner.resolve(dae.getExprData1(exprId)) || "";
        const pcount = dae.getExprRight(exprId);
        const pArgs: number[] = [];
        for (let i = 0; i < pcount; i++) {
          pArgs.push(cloneExpr(dae.getExprLeft(exprId + i), indexSuffix, currentShape, true));
        }
        return out.addPartialFuncExpr(pfn, pArgs);
      }
      case ExprKind.Der: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addDerExpr(arg);
      }
      case ExprKind.Pre: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addPreExpr(arg);
      }
      case ExprKind.Call: {
        const funcNameId = dae.getExprData1(exprId);
        const argCount = dae.getExprRight(exprId);
        const funcName = dae.interner.resolve(funcNameId) || "";
        if (expandArrayEquations) {
          if (argCount === 1) {
            const rawArg0 = dae.getExprLeft(exprId);
            if (funcName === "Modelica.ComplexMath.real" || funcName === "ComplexMath.real" || funcName === "real") {
              return getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true);
            }
            if (funcName === "Modelica.ComplexMath.imag" || funcName === "ComplexMath.imag" || funcName === "imag") {
              return getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true);
            }
            if (funcName === "Modelica.ComplexMath.abs" || funcName === "ComplexMath.abs") {
              const re = getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true);
              const im = getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true);
              return out.addCallExpr("sqrt", [
                out.addBinaryExpr(
                  BinOp.Add,
                  out.addBinaryExpr(BinOp.Mul, re, re),
                  out.addBinaryExpr(BinOp.Mul, im, im),
                ),
              ]);
            }
            if (funcName === "Modelica.ComplexMath.arg" || funcName === "ComplexMath.arg") {
              const re = getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true);
              const im = getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true);
              return out.addCallExpr("atan2", [im, re]);
            }
          } else if (argCount === 2 && funcName === "Complex.'=='.equal") {
            const rawArg0 = dae.getExprLeft(exprId);
            const rawArg1 = dae.getExprLeft(exprId + 1);
            const reEq = out.addBinaryExpr(
              BinOp.Eq,
              getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true),
              getFieldExpr(dae, out, rawArg1, "re", cloneExpr, true),
            );
            const imEq = out.addBinaryExpr(
              BinOp.Eq,
              getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true),
              getFieldExpr(dae, out, rawArg1, "im", cloneExpr, true),
            );
            return out.addBinaryExpr(BinOp.And, reEq, imEq);
          }
        }
        const expandCallArg = !funcName.includes(".");
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
          const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          args.push(cloneExpr(argExprId, indexSuffix, currentShape, expandCallArg));
        }
        if (
          dae.extensionMetadata?.["scalarizeMinMax"] &&
          (funcName === "min" || funcName === "max") &&
          args.length === 1
        ) {
          let arg0 = args[0]!;
          if (out.getExprKind(arg0) === ExprKind.Name) {
            const vName = out.interner.resolve(out.getExprData1(arg0));
            const shape = vName ? dae.getNamedArrayShape(vName) : null;
            if (vName && shape && shape.length > 0) {
              const indices = generateIndices(shape);
              const elemExprs = indices.map((idx) => out.addNameExpr(`${vName}[${idx.join(",")}]`));
              arg0 = out.addArrayCtorExpr(elemExprs);
            }
          }
          if (out.getExprKind(arg0) === ExprKind.ArrayCtor) {
            const count = out.getExprData1(arg0);
            if (count >= 2) {
              const elems: number[] = [];
              for (let k = 0; k < count; k++) {
                elems.push(k === 0 ? out.getExprLeft(arg0) : out.getExprLeft(arg0 + k));
              }
              let cur = elems[elems.length - 1]!;
              for (let k = elems.length - 2; k >= 0; k--) {
                cur = out.addCallExpr(funcName, [elems[k]!, cur]);
              }
              return cur;
            } else if (count === 1) {
              return out.getExprLeft(arg0);
            }
          }
        }
        if (expandArrayEquations) {
          const inlined = tryInlineSingleAssignCall(funcName, args, 0);
          if (inlined !== null) return inlined;
        }
        return out.addCallExpr(funcName, args);
      }
      case ExprKind.Tuple: {
        const count = dae.getExprData1(exprId);
        const elems: number[] = [];
        for (let i = 0; i < count; i++) {
          const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          elems.push(cloneExpr(elemId, indexSuffix, currentShape));
        }
        return out.addTupleExpr(elems);
      }
      case ExprKind.ArrayCtor: {
        const count = dae.getExprData1(exprId);
        const elements: number[] = [];
        for (let i = 0; i < count; i++) {
          const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          elements.push(cloneExpr(elemId, indexSuffix, currentShape));
        }
        return out.addArrayCtorExpr(elements);
      }
      case ExprKind.IfElse: {
        const cond = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const thenBranch = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const elseBranch = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addIfElseExpr(cond, thenBranch, elseBranch);
      }
      case ExprKind.Subscript: {
        const baseId = dae.getExprData1(exprId);
        const subCount = dae.getExprRight(exprId);
        const subIds: number[] = [];
        for (let i = 0; i < subCount; i++) {
          const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          subIds.push(cloneExpr(sId, indexSuffix, currentShape));
        }
        const clonedBase = cloneExpr(baseId, indexSuffix, currentShape);
        // Flatten constant integer subscripts on known arrays directly into a scalarized `ExprKind.Name` (`x[1,2]`).
        if (
          out.getExprKind(clonedBase) === ExprKind.Name &&
          subIds.length > 0 &&
          subIds.every((s) => out.getExprKind(s) === ExprKind.IntLiteral)
        ) {
          const baseName = out.interner.resolve(out.getExprData1(clonedBase));
          if (baseName) {
            const idxStr = subIds.map((s) => out.getExprData1(s)).join(",");
            const rawBase = baseName.includes("[") ? baseName.slice(0, baseName.indexOf("[")) : baseName;
            const combinedName = baseName.endsWith("]")
              ? `${baseName.slice(0, -1)},${idxStr}]`
              : `${baseName}[${idxStr}]`;
            if (
              out.getVarIdxByName(combinedName) >= 0 ||
              (arrayShapes.has(rawBase) && out.getVarIdxByName(baseName) < 0)
            ) {
              return out.addNameExpr(combinedName);
            }
          }
        }
        return out.addSubscriptExpr(clonedBase, subIds);
      }
      case ExprKind.EnumLiteral: {
        const ordinal = dae.getExprData1(exprId);
        const pathId = dae.getExprLeft(exprId);
        const pathStr = dae.interner.resolve(pathId) || "";
        return out.addEnumLiteral(ordinal, pathStr);
      }
      case ExprKind.TensorSlice: {
        const base = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const slice = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const axis = dae.getExprRight(exprId);
        return out.addTensorSlice(base, slice, axis);
      }
      case ExprKind.TensorBroadcast: {
        const op = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const axis = dae.getExprData1(exprId);
        const shape = dae.getExprTensorShape(exprId) ?? [];
        return out.addTensorBroadcast(op, shape, axis);
      }
      case ExprKind.TensorMatMul: {
        const left = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const right = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        const flags = dae.getExprData1(exprId);
        return out.addTensorMatMul(left, right, flags);
      }
      case ExprKind.TensorReduce: {
        const op = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const redOp = dae.getExprData1(exprId);
        const axis = dae.getExprRight(exprId);
        return out.addTensorReduce(op, redOp, axis);
      }
      case ExprKind.TensorMap: {
        const op = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const opId = dae.getExprData1(exprId);
        const aux = dae.getExprRight(exprId);
        return out.addTensorMap(op, opId, aux);
      }
      default:
        return exprId;
    }
  };

  function tryInlineSingleAssignCall(funcName: string, args: number[], depth: number): number | null {
    if (!expandArrayEquations || depth > 16 || !funcName) return null;
    const fn = lookupRecordFunctionInDae(dae, funcName);
    if (!fn || fn.externalDecl) return null;
    if (fn.description && fn.description.startsWith("Automatically generated record constructor")) return null;
    if ((fn as any).isOperatorRecord || fn.extensionMetadata?.isOperatorRecord) return null;
    if (fn.algorithmSections.length !== 1 || fn.algorithmSections[0]!.count !== 1) return null;
    const stmtIdx = fn.algorithmSections[0]!.start;
    const rootStmtKind = fn.getStmtKind(stmtIdx);
    if (rootStmtKind !== StmtKind.Assignment && rootStmtKind !== StmtKind.If) return null;

    const inputs: { name: string; varIdx: number }[] = [];
    const outputs: string[] = [];
    for (let v = 0; v < fn.varCount; v++) {
      if (fn.isVarRemoved(v)) continue;
      const c = fn.getVarCausality(v);
      const varb = fn.getVarVariability(v);
      const vExpr = fn.getVarExpression(v);
      if (c === Causality.Input) {
        inputs.push({ name: fn.getVarName(v), varIdx: v });
      } else if (c === Causality.Output) {
        outputs.push(fn.getVarName(v));
      } else if (
        varb !== Variability.Constant &&
        varb !== Variability.Parameter &&
        !(typeof vExpr === "number" && vExpr >= 0)
      ) {
        return null;
      }
    }
    if (outputs.length !== 1) return null;
    const outName = outputs[0]!;

    let failed = false;
    const cloneFnExpr = (fnExprId: number, paramMap: Map<string, number>, d: number): number => {
      if (failed || fnExprId < 0 || d > 32) {
        failed = true;
        return -1;
      }
      const k = fn.getExprKind(fnExprId);
      switch (k) {
        case ExprKind.Name: {
          const name = fn.interner.resolve(fn.getExprData1(fnExprId)) || "";
          if (paramMap.has(name)) return paramMap.get(name)!;
          if (name.includes(".")) {
            const dotIdx = name.indexOf(".");
            const rootParam = name.slice(0, dotIdx);
            const restField = name.slice(dotIdx + 1);
            if (paramMap.has(rootParam)) {
              const paramExprInOut = paramMap.get(rootParam)!;
              return getFieldExpr(out, out, paramExprInOut, restField, (id) => id);
            }
          }
          const vIdx = fn.getVarIdxByName(name);
          if (vIdx >= 0) {
            const bindId = fn.getVarExpression(vIdx);
            if (bindId !== undefined && bindId >= 0) {
              const clonedBind = cloneFnExpr(bindId, paramMap, d + 1);
              if (!failed && clonedBind >= 0) {
                paramMap.set(name, clonedBind);
              }
              return clonedBind;
            }
          }
          return out.addNameExpr(name);
        }
        case ExprKind.IntLiteral:
          return out.addIntLiteral(fn.getExprData1(fnExprId));
        case ExprKind.RealLiteral:
          return out.addRealLiteral(fn.getExprRealValue(fnExprId));
        case ExprKind.BoolLiteral:
          return out.addBoolLiteral(fn.getExprData1(fnExprId) !== 0);
        case ExprKind.StringLiteral:
          return out.addStringLiteral(fn.interner.resolve(fn.getExprData1(fnExprId)) || "");
        case ExprKind.EnumLiteral: {
          const ordinal = fn.getExprData1(fnExprId);
          const pathStr = fn.interner.resolve(fn.getExprLeft(fnExprId)) || "";
          return out.addEnumLiteral(ordinal, pathStr);
        }
        case ExprKind.Binary: {
          const op = fn.getExprData1(fnExprId);
          const l = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          const r = cloneFnExpr(fn.getExprRight(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addBinaryExpr(op, l, r);
        }
        case ExprKind.Unary: {
          const op = fn.getExprData1(fnExprId);
          const operand = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addUnaryExpr(op, operand);
        }
        case ExprKind.Negate: {
          const operand = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addExpression(ExprKind.Negate, 0, operand);
        }
        case ExprKind.IfElse: {
          const cond = cloneFnExpr(fn.getExprData1(fnExprId), paramMap, d + 1);
          const tBranch = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          const fBranch = cloneFnExpr(fn.getExprRight(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addIfElseExpr(cond, tBranch, fBranch);
        }
        case ExprKind.ArrayCtor: {
          const count = fn.getExprData1(fnExprId);
          const elems: number[] = [];
          for (let i = 0; i < count; i++) {
            const elemId = i === 0 ? fn.getExprLeft(fnExprId) : fn.getExprLeft(fnExprId + i);
            elems.push(cloneFnExpr(elemId, paramMap, d + 1));
            if (failed) return -1;
          }
          return out.addArrayCtorExpr(elems);
        }
        case ExprKind.Subscript: {
          const baseId = fn.getExprData1(fnExprId);
          const subCount = fn.getExprRight(fnExprId);
          const subIds: number[] = [];
          for (let i = 0; i < subCount; i++) {
            const sId = i === 0 ? fn.getExprLeft(fnExprId) : fn.getExprLeft(fnExprId + i);
            subIds.push(cloneFnExpr(sId, paramMap, d + 1));
            if (failed) return -1;
          }
          const clonedBase = cloneFnExpr(baseId, paramMap, d + 1);
          if (failed) return -1;
          if (subIds.length > 0 && subIds.every((s) => out.getExprKind(s) === ExprKind.IntLiteral)) {
            const idx = subIds.map((s) => out.getExprData1(s));
            if (out.getExprKind(clonedBase) === ExprKind.ArrayCtor) {
              const elem = getArrayCtorElement(out, clonedBase, idx);
              if (elem >= 0) return elem;
            }
            if (out.getExprKind(clonedBase) === ExprKind.Name) {
              const baseName = out.interner.resolve(out.getExprData1(clonedBase));
              if (baseName) {
                const idxStr = idx.join(",");
                const combinedName = baseName.endsWith("]")
                  ? `${baseName.slice(0, -1)},${idxStr}]`
                  : `${baseName}[${idxStr}]`;
                if (out.getVarIdxByName(combinedName) >= 0 || dae.getVarIdxByName(combinedName) >= 0) {
                  return out.addNameExpr(combinedName);
                }
              }
            }
          }
          return out.addSubscriptExpr(clonedBase, subIds);
        }
        case ExprKind.Call: {
          const subFnName = fn.interner.resolve(fn.getExprData1(fnExprId)) || "";
          const subArgCount = fn.getExprRight(fnExprId);
          const subArgs: number[] = [];
          for (let i = 0; i < subArgCount; i++) {
            const aId = i === 0 ? fn.getExprLeft(fnExprId) : fn.getExprLeft(fnExprId + i);
            subArgs.push(cloneFnExpr(aId, paramMap, d + 1));
            if (failed) return -1;
          }
          const inlinedSub = tryInlineSingleAssignCall(subFnName, subArgs, depth + 1);
          if (inlinedSub !== null) return inlinedSub;
          return out.addCallExpr(subFnName, subArgs);
        }
        default:
          failed = true;
          return -1;
      }
    };

    const paramMap = new Map<string, number>();
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i]!;
      if (i < args.length) {
        let argId = args[i]!;
        if (fn.getVarType(inp.varIdx) === VarType.Real && out.getExprKind(argId) === ExprKind.IntLiteral) {
          argId = out.addRealLiteral(out.getExprData1(argId));
        }
        paramMap.set(inp.name, argId);
      } else {
        const defId = fn.getVarExpression(inp.varIdx);
        if (defId !== undefined && defId >= 0) {
          const defCloned = cloneFnExpr(defId, paramMap, 0);
          if (failed) return null;
          paramMap.set(inp.name, defCloned);
        }
      }
    }

    const convertStmtToExpr = (sIdx: number, d: number): number => {
      if (failed || sIdx < 0 || d > 16) {
        failed = true;
        return -1;
      }
      const sKind = fn.getStmtKind(sIdx);
      if (sKind === StmtKind.Assignment) {
        const targetExprId = fn.getStmtData1(sIdx);
        const sourceExprId = fn.getStmtLeft(sIdx);
        if (targetExprId < 0 || sourceExprId < 0 || fn.getExprKind(targetExprId) !== ExprKind.Name) {
          failed = true;
          return -1;
        }
        const targetName = fn.interner.resolve(fn.getExprData1(targetExprId));
        if (targetName !== outName) {
          failed = true;
          return -1;
        }
        return cloneFnExpr(sourceExprId, paramMap, 0);
      }
      if (sKind === StmtKind.If) {
        const condExprId = fn.getStmtData1(sIdx);
        const thenStmtCount = fn.getStmtLeft(sIdx);
        const branchCount = fn.getStmtRight(sIdx);
        if (thenStmtCount !== 1 || branchCount < 1) {
          failed = true;
          return -1;
        }
        const blockStartIdx = sIdx + 1;
        const thenExpr = convertStmtToExpr(blockStartIdx, d + 1);
        if (failed || thenExpr < 0) return -1;
        const thenSlots = countArenaStatementSlots(fn, blockStartIdx, thenStmtCount);
        let nextIdx = blockStartIdx + thenSlots;
        const clauses: { condExpr: number; bodyExpr: number }[] = [
          { condExpr: cloneFnExpr(condExprId, paramMap, 0), bodyExpr: thenExpr },
        ];
        if (failed) return -1;
        let elseExpr = -1;
        for (let b = 0; b < branchCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchKind = fn.getStmtKind(branchStmtIdx);
          const branchCondExprId = fn.getStmtData1(branchStmtIdx);
          const branchStmtCount = fn.getStmtLeft(branchStmtIdx);
          if (branchKind !== StmtKind.Block || branchStmtCount !== 1) {
            failed = true;
            return -1;
          }
          const branchBodyExpr = convertStmtToExpr(branchStmtIdx + 1, d + 1);
          if (failed || branchBodyExpr < 0) return -1;
          const branchSlots = countArenaStatementSlots(fn, branchStmtIdx + 1, branchStmtCount);
          nextIdx = branchStmtIdx + 1 + branchSlots;
          if (branchCondExprId === -1) {
            elseExpr = branchBodyExpr;
          } else {
            const branchCond = cloneFnExpr(branchCondExprId, paramMap, 0);
            if (failed) return -1;
            clauses.push({ condExpr: branchCond, bodyExpr: branchBodyExpr });
          }
        }
        if (elseExpr < 0) {
          failed = true;
          return -1;
        }
        let acc = elseExpr;
        for (let c = clauses.length - 1; c >= 0; c--) {
          acc = out.addIfElseExpr(clauses[c]!.condExpr, clauses[c]!.bodyExpr, acc);
        }
        return acc;
      }
      failed = true;
      return -1;
    };

    const res = convertStmtToExpr(stmtIdx, 0);
    return failed || res < 0 ? null : res;
  }

  // --- Step 3: Emit Scalarized Variables & Element-Sliced Attributes ---
  // Emit variables
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;

    const name = dae.getVarName(i);
    let shape = dae.getVarShape(i);
    const type = dae.getVarType(i);
    const variability = dae.getVarVariability(i);
    const causality = dae.getVarCausality(i);
    const start = dae.getVarStartValue(i);
    const flags = dae.getVarFlags(i);
    const desc = dae.getVarDescription(i);
    const expr = (dae as any).getExplicitVarExpression
      ? (dae as any).getExplicitVarExpression(i)
      : dae.getVarExpression(i);
    const attrs = dae.getVarAttrExprIds(i);
    const customType = dae.getVarCustomType(i);
    const enumLits = dae.getVarEnumerationLiterals(i);
    const cad = dae.getVarCadAnnotation(i);

    const vRange = dae.getVarSourceRange(i);

    if (shape.length > 0) {
      if (shape.some((d) => d <= 0)) {
        if (arrayShapes.has(name) && arrayShapes.get(name)!.every((d) => d > 0)) {
          shape = arrayShapes.get(name)!;
        } else if (expr != null && expr >= 0 && dae.getExprKind(expr) === ExprKind.ArrayCtor) {
          const count = dae.getExprData1(expr);
          if (count > 0) shape = [count];
        }
      }
      if (shape.some((d) => d <= 0)) {
        shape = shape.map((d) => (d <= 0 ? 1 : d));
      }
      const indices = generateIndices(shape);
      for (let elemIdx = 0; elemIdx < indices.length; elemIdx++) {
        const idx = indices[elemIdx]!;
        const scalarName = `${name}[${idx.join(",")}]`;
        const scalarIdx = out.addVariable(scalarName, type, variability, causality, start, flags);
        if (desc) out.setVarDescription(scalarIdx, desc);
        if (customType) out.setVarCustomType(scalarIdx, customType);
        if (enumLits) out.setVarEnumerationLiterals(scalarIdx, enumLits);
        if (cad) out.setVarCadAnnotation(scalarIdx, cad);
        if (vRange) out.setVarSourceRange(scalarIdx, vRange.startOffset, vRange.endOffset);

        if (expr != null && expr >= 0) {
          if (dae.getExprKind(expr) === ExprKind.ArrayCtor) {
            let elemExpr = getArrayCtorElement(dae, expr, idx);
            if (elemExpr < 0 && dae.getExprData1(expr) === 1) {
              const inside = dae.getExprLeft(expr);
              if (dae.getExprKind(inside) === ExprKind.Name) {
                const insideName = dae.interner.resolve(dae.getExprData1(inside));
                if (insideName) {
                  elemExpr = out.addNameExpr(`${insideName}[${idx.join(",")}]`);
                }
              }
            }
            if (elemExpr >= 0) {
              let cloned: number;
              if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
              } else {
                cloned = cloneExpr(elemExpr, "", null);
              }
              out.setVarExpression(scalarIdx, cloned);
            }
          } else if (isArrayOfLength(dae, expr, indices.length)) {
            const elemExpr = getNthExpr(dae, expr, elemIdx, indices.length);
            let cloned: number;
            if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
              cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
            } else {
              cloned = cloneExpr(elemExpr, "", null);
            }
            out.setVarExpression(scalarIdx, cloned);
          } else {
            out.setVarExpression(scalarIdx, cloneExpr(expr, `[${idx.join(",")}]`, shape));
          }
        }

        if (attrs) {
          for (const [attrName, attrExprId] of attrs.entries()) {
            if (attrName === "start" && dae.getExprKind(attrExprId) === ExprKind.ArrayCtor) {
              const elemExpr = getArrayCtorElement(dae, attrExprId, idx);
              if (elemExpr >= 0) {
                let cloned: number;
                if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                  cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
                } else {
                  cloned = cloneExpr(elemExpr, "", null);
                }
                out.setVarAttr(scalarIdx, "start", cloned);
                if (out.getExprKind(cloned) === ExprKind.RealLiteral) {
                  out.setVarStartValue(scalarIdx, out.getExprRealValue(cloned));
                } else if (out.getExprKind(cloned) === ExprKind.IntLiteral) {
                  out.setVarStartValue(scalarIdx, out.getExprData1(cloned));
                }
              }
            } else if (attrName === "start" && isArrayOfLength(dae, attrExprId, indices.length)) {
              const elemExpr = getNthExpr(dae, attrExprId, elemIdx, indices.length);
              let cloned: number;
              if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
              } else {
                cloned = cloneExpr(elemExpr, "", null);
              }
              out.setVarAttr(scalarIdx, "start", cloned);
              if (out.getExprKind(cloned) === ExprKind.RealLiteral) {
                out.setVarStartValue(scalarIdx, out.getExprRealValue(cloned));
              } else if (out.getExprKind(cloned) === ExprKind.IntLiteral) {
                out.setVarStartValue(scalarIdx, out.getExprData1(cloned));
              }
            } else {
              out.setVarAttr(scalarIdx, attrName, cloneExpr(attrExprId, `[${idx.join(",")}]`, shape));
            }
          }
        }
      }
    } else {
      const scalarIdx = out.addVariable(name, type, variability, causality, start, flags);
      if (desc) out.setVarDescription(scalarIdx, desc);
      if (customType) out.setVarCustomType(scalarIdx, customType);
      if (enumLits) out.setVarEnumerationLiterals(scalarIdx, enumLits);
      if (cad) out.setVarCadAnnotation(scalarIdx, cad);
      if (vRange) out.setVarSourceRange(scalarIdx, vRange.startOffset, vRange.endOffset);
      if (expr != null && expr >= 0) {
        out.setVarExpression(scalarIdx, cloneExpr(expr, "", null));
      }
      if (attrs) {
        for (const [attrName, attrExprId] of attrs.entries()) {
          if (attrName === "start" && attrExprId === expr) continue;
          out.setVarAttr(scalarIdx, attrName, cloneExpr(attrExprId, "", null));
        }
      }
    }
  }

  const checkShape = (id: number) => {
    if (id < 0) return null;
    const kind = dae.getExprKind(id);
    if (kind === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(id));
      const idx = dae.lookupVariable(name);
      if (idx >= 0) {
        const s = dae.getVarShape(idx);
        return s.length > 0 ? s : null;
      }
    }
    return null;
  };

  const recordIndex = buildRecordFieldIndex(dae);

  // --- Step 4: Equation Scalarization Helper (`emitEquation`) ---
  // Splits array equations element-by-element (coercing integer literals to Real when paired
  // with Real LHS/RHS elements), decomposes record and `connect(...)` equations field-by-field
  // after verifying plug-compatibility, or iterates over `generateIndices(shape)` for shaped variables.
  const emitEquation = (
    rawKind: EqKind,
    lhsId: number,
    rhsId: number,
    eqFlags: number,
    targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    origEqIdx?: number,
  ) => {
    const kind = rawKind === EqKind.Array && expandArrayEquations ? EqKind.Simple : rawKind;
    const recordEqMeta = (newEqIdx: number) => {
      if (origEqIdx !== undefined) {
        const desc = dae.getEqDescription?.(origEqIdx);
        if (desc) out.setEqDescription(newEqIdx, desc);
        const range = dae.getEqSourceRange?.(origEqIdx);
        if (range) out.setEqSourceRange(newEqIdx, range.startOffset, range.endOffset);
      }
    };

    if (kind === EqKind.Array) {
      const newLhs = cloneExpr(lhsId, "", null);
      let newRhs = -1;
      if (
        Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
        rhsId >= 0 &&
        dae.getExprKind(rhsId) === ExprKind.Binary
      ) {
        const isOutZero = (eid: number): boolean => {
          const ek = out.getExprKind(eid);
          return (
            (ek === ExprKind.RealLiteral && out.getExprRealValue(eid) === 0.0) ||
            (ek === ExprKind.IntLiteral && out.getExprData1(eid) === 0)
          );
        };
        const isOutOne = (eid: number): boolean => {
          const ek = out.getExprKind(eid);
          return (
            (ek === ExprKind.RealLiteral && out.getExprRealValue(eid) === 1.0) ||
            (ek === ExprKind.IntLiteral && out.getExprData1(eid) === 1)
          );
        };
        const isScalarBcastLeaf = (eid: number): boolean => {
          if (eid < 0) return false;
          const ek = dae.getExprKind(eid);
          if (ek === ExprKind.ArrayCtor || ek === ExprKind.Call || ek === ExprKind.Comprehension) return false;
          if (getArrayElements(dae, eid) !== null) return false;
          if (ek === ExprKind.Name) {
            const nm = dae.interner.resolve(dae.getExprData1(eid)) || "";
            if (arrayShapes.has(nm)) return false;
          }
          return true;
        };
        const mkBinSimp = (bop: BinOp, a: number, b: number): number => {
          if (bop === BinOp.Mul || bop === BinOp.ElemMul) {
            if (isOutZero(a) || isOutZero(b)) return out.addRealLiteral(0.0);
            if (isOutOne(a)) return b;
            if (isOutOne(b)) return a;
            return out.addBinaryExpr(BinOp.Mul, a, b);
          }
          if (bop === BinOp.Add || bop === BinOp.ElemAdd) {
            if (isOutZero(a)) return b;
            if (isOutZero(b)) return a;
            return out.addBinaryExpr(BinOp.Add, a, b);
          }
          if (bop === BinOp.Sub || bop === BinOp.ElemSub) {
            if (isOutZero(b)) return a;
            if (isOutZero(a)) return out.addExpression(ExprKind.Negate, 0, b);
            return out.addBinaryExpr(BinOp.Sub, a, b);
          }
          if (bop === BinOp.Div || bop === BinOp.ElemDiv) {
            if (isOutZero(a)) return out.addRealLiteral(0.0);
            if (isOutOne(b)) return a;
            return out.addBinaryExpr(BinOp.Div, a, b);
          }
          return out.addBinaryExpr(bop, a, b);
        };
        const evalOut1D = (eid: number): number[] | null => {
          if (eid < 0) return null;
          const ek = dae.getExprKind(eid);
          if (ek === ExprKind.ArrayCtor) {
            const cnt = dae.getExprData1(eid);
            if (cnt <= 0) return null;
            const res: number[] = [];
            for (let ai = 0; ai < cnt; ai++) {
              const el = ai === 0 ? dae.getExprLeft(eid) : dae.getExprLeft(eid + ai);
              if (dae.getExprKind(el) === ExprKind.ArrayCtor) return null;
              res.push(cloneExpr(el, "", null));
            }
            return res;
          }
          if (ek === ExprKind.Binary) {
            const bop = dae.getExprData1(eid) as BinOp;
            if (
              bop !== BinOp.Add &&
              bop !== BinOp.Sub &&
              bop !== BinOp.Mul &&
              bop !== BinOp.Div &&
              bop !== BinOp.ElemAdd &&
              bop !== BinOp.ElemSub &&
              bop !== BinOp.ElemMul &&
              bop !== BinOp.ElemDiv
            ) {
              return null;
            }
            const lRaw = dae.getExprLeft(eid);
            const rRaw = dae.getExprRight(eid);
            const lVec = evalOut1D(lRaw);
            const rVec = evalOut1D(rRaw);
            if (lVec && rVec && lVec.length === rVec.length) {
              return lVec.map((lv, idx) => mkBinSimp(bop, lv, rVec[idx]!));
            }
            if (
              lVec &&
              !rVec &&
              (bop === BinOp.Mul || bop === BinOp.ElemMul || bop === BinOp.Div || bop === BinOp.ElemDiv) &&
              isScalarBcastLeaf(rRaw)
            ) {
              const sc = cloneExpr(rRaw, "", null);
              return lVec.map((lv) => mkBinSimp(bop, lv, sc));
            }
            if (!lVec && rVec && (bop === BinOp.Mul || bop === BinOp.ElemMul) && isScalarBcastLeaf(lRaw)) {
              const sc = cloneExpr(lRaw, "", null);
              return rVec.map((rv) => mkBinSimp(bop, sc, rv));
            }
          }
          return null;
        };
        const outVec = evalOut1D(rhsId);
        const lShapeCheck = getArrayElements(dae, lhsId);
        if (outVec && (!lShapeCheck || lShapeCheck.length === outVec.length)) {
          newRhs = out.addArrayCtorExpr(outVec);
        }
      }
      if (newRhs < 0) newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }

    if (
      (kind === EqKind.FunctionCall || kind === EqKind.InitialFunctionCall) &&
      Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
      lhsId >= 0 &&
      dae.getExprKind(lhsId) === ExprKind.Call &&
      dae.interner.resolve(dae.getExprData1(lhsId)) === "assert" &&
      dae.getExprRight(lhsId) >= 2
    ) {
      const condVal = evaluateConstantArenaExpression(
        dae,
        dae.getExprLeft(lhsId),
        undefined,
        undefined,
        0,
        undefined,
        undefined,
        true,
      );
      if (condVal === true) return;
    }

    const lhsElements = getArrayElements(dae, lhsId);
    const rhsElements = getArrayElements(dae, rhsId);
    if ((lhsElements && lhsElements.length === 0) || (rhsElements && rhsElements.length === 0)) {
      return;
    }
    const isEqualityConstraintCall = (exprId: number): boolean => {
      if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return false;
      const fn = dae.interner.resolve(dae.getExprData1(exprId));
      return fn === "equalityConstraint" || fn.endsWith(".equalityConstraint");
    };
    const isScalarOrBuiltinCall = (fn: string): boolean => {
      if (!fn.includes(".") && fn !== "equalityConstraint") return true;
      if (fn.startsWith("/*Real")) return true;
      const dot = fn.lastIndexOf(".");
      const leaf = dot >= 0 ? fn.slice(dot + 1) : fn;
      return (
        leaf === "length" ||
        leaf === "abs" ||
        leaf === "sqrt" ||
        leaf === "sign" ||
        leaf === "sin" ||
        leaf === "cos" ||
        leaf === "tan" ||
        leaf === "asin" ||
        leaf === "acos" ||
        leaf === "atan" ||
        leaf === "atan2" ||
        leaf === "exp" ||
        leaf === "log" ||
        leaf === "log10" ||
        leaf === "min" ||
        leaf === "max" ||
        leaf === "sum" ||
        leaf === "product" ||
        leaf === "size" ||
        leaf === "to_unit1" ||
        leaf === "from_deg" ||
        leaf === "to_deg"
      );
    };
    const containsUnsplitVectorCall = (exprId: number): boolean => {
      if (exprId < 0) return false;
      const ek = dae.getExprKind(exprId);
      if (ek === ExprKind.Comprehension) {
        return true;
      }
      if (ek === ExprKind.Call) {
        const fn = dae.interner.resolve(dae.getExprData1(exprId)) || "";
        return !isScalarOrBuiltinCall(fn);
      }
      if (ek === ExprKind.Negate || ek === ExprKind.Unary) {
        return containsUnsplitVectorCall(dae.getExprLeft(exprId));
      }
      if (ek === ExprKind.Binary) {
        const op = dae.getExprData1(exprId) as BinOp;
        if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul || op === BinOp.Div) {
          return (
            containsUnsplitVectorCall(dae.getExprLeft(exprId)) || containsUnsplitVectorCall(dae.getExprRight(exprId))
          );
        }
      }
      return false;
    };
    const collapseArrayArgCtorsInCall = (callExprId: number): number => {
      if (callExprId < 0 || out.getExprKind(callExprId) !== ExprKind.Call) return callExprId;
      const argc = out.getExprRight(callExprId);
      if (argc <= 0) return callExprId;
      let anyRep = false;
      const args: number[] = [];
      for (let ai = 0; ai < argc; ai++) {
        let arg = ai === 0 ? out.getExprLeft(callExprId) : out.getExprLeft(callExprId + ai);
        if (out.getExprKind(arg) === ExprKind.ArrayCtor) {
          const cnt = out.getExprData1(arg);
          if (cnt >= 2) {
            let base: string | null = null;
            let ok = true;
            for (let k = 0; k < cnt; k++) {
              const el = k === 0 ? out.getExprLeft(arg) : out.getExprLeft(arg + k);
              if (out.getExprKind(el) !== ExprKind.Name) {
                ok = false;
                break;
              }
              const nm = out.interner.resolve(out.getExprData1(el));
              const expectedSfx = `[${k + 1}]`;
              if (!nm || !nm.endsWith(expectedSfx)) {
                ok = false;
                break;
              }
              const b = nm.slice(0, -expectedSfx.length);
              if (base === null) base = b;
              else if (base !== b) {
                ok = false;
                break;
              }
            }
            if (
              ok &&
              base &&
              out.getVarIdxByName(`${base}[1]`) >= 0 &&
              out.getVarIdxByName(`${base}[${cnt + 1}]`) < 0
            ) {
              arg = out.addNameExpr(base);
              anyRep = true;
            }
          }
        }
        args.push(arg);
      }
      if (!anyRep) return callExprId;
      const fnName = out.interner.resolve(out.getExprData1(callExprId)) || "";
      return out.addCallExpr(fnName, args);
    };
    if (
      Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
      ((kind === EqKind.InitialSimple &&
        lhsElements &&
        lhsElements.length > 0 &&
        !rhsElements &&
        (dae.getExprKind(rhsId) === ExprKind.Call || containsUnsplitVectorCall(rhsId))) ||
        (kind === EqKind.Simple &&
          ((lhsElements &&
            lhsElements.length > 0 &&
            !rhsElements &&
            (isEqualityConstraintCall(rhsId) || (!expandArrayEquations && containsUnsplitVectorCall(rhsId)))) ||
            (rhsElements &&
              rhsElements.length > 0 &&
              !lhsElements &&
              (isEqualityConstraintCall(lhsId) || (!expandArrayEquations && containsUnsplitVectorCall(lhsId)))))))
    ) {
      let newLhs = cloneExpr(lhsId, "", null);
      let newRhs = cloneExpr(rhsId, "", null);
      if (isEqualityConstraintCall(rhsId)) newRhs = collapseArrayArgCtorsInCall(newRhs);
      if (isEqualityConstraintCall(lhsId)) newLhs = collapseArrayArgCtorsInCall(newLhs);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }
    if (lhsElements && lhsElements.length > 0) {
      const N = lhsElements.length;
      for (let k = 0; k < N; k++) {
        const newLhs = cloneExpr(lhsElements[k]!, "", null);
        const rk_raw = rhsElements && rhsElements.length === N ? rhsElements[k]! : getNthExpr(dae, rhsId, k, N);
        let newRhs = cloneExpr(rk_raw, "", null);
        if (isRealType(dae, lhsElements[k]!)) {
          if (dae.getExprKind(rk_raw) === ExprKind.IntLiteral) {
            newRhs = out.addRealLiteral(dae.getExprData1(rk_raw));
          } else if (dae.getExprKind(rk_raw) === ExprKind.Negate) {
            const inner = dae.getExprLeft(rk_raw);
            if (dae.getExprKind(inner) === ExprKind.IntLiteral) {
              const realLit = out.addRealLiteral(dae.getExprData1(inner));
              newRhs = out.addExpression(ExprKind.Negate, 0, realLit);
            }
          }
        }
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    const lhsRec = getRecordFields(dae, lhsId, expandArrayEquations, recordIndex);
    const rhsRec = getRecordFields(dae, rhsId, expandArrayEquations, recordIndex);

    if (rhsElements && rhsElements.length > 0) {
      const N = rhsElements.length;
      for (let k = 0; k < N; k++) {
        let newRhs = cloneExpr(rhsElements[k]!, "", null);
        let newLhs: number;
        if (lhsRec && lhsRec.length === N) {
          newLhs = getFieldExpr(dae, out, lhsId, lhsRec[k]!, cloneExpr, expandArrayEquations);
          if (isRealType(dae, newLhs) && dae.getExprKind(rhsElements[k]!) === ExprKind.IntLiteral) {
            newRhs = out.addRealLiteral(dae.getExprData1(rhsElements[k]!));
          }
        } else {
          const lk_raw = getNthExpr(dae, lhsId, k, N);
          newLhs = cloneExpr(lk_raw, "", null);
          if (isRealType(dae, rhsElements[k]!)) {
            if (dae.getExprKind(lk_raw) === ExprKind.IntLiteral) {
              newLhs = out.addRealLiteral(dae.getExprData1(lk_raw));
            } else if (dae.getExprKind(lk_raw) === ExprKind.Negate) {
              const inner = dae.getExprLeft(lk_raw);
              if (dae.getExprKind(inner) === ExprKind.IntLiteral) {
                const realLit = out.addRealLiteral(dae.getExprData1(inner));
                newLhs = out.addExpression(ExprKind.Negate, 0, realLit);
              }
            }
          }
        }
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }
    const isRhsCall = dae.getExprKind(rhsId) === ExprKind.Call;
    const isRhsComprehension = dae.getExprKind(rhsId) === ExprKind.Comprehension;
    const isRhsRecordCtor = isRhsCall && isRecordConstructorCall(dae, rhsId);
    const isFramesOrientationCtor =
      isRhsCall &&
      (() => {
        const fn = dae.interner.resolve(dae.getExprData1(rhsId));
        return fn === "Modelica.Mechanics.MultiBody.Frames.Orientation" || fn.endsWith(".Frames.Orientation");
      })();
    const isRhsBinary = dae.getExprKind(rhsId) === ExprKind.Binary;
    const isRhsUnary = dae.getExprKind(rhsId) === ExprKind.Unary || dae.getExprKind(rhsId) === ExprKind.Negate;

    const recFields = lhsRec || rhsRec;
    const isComplexRec =
      expandArrayEquations && recFields?.length === 2 && recFields[0] === "re" && recFields[1] === "im";

    // If LHS is a record, and RHS is a function call, comprehension, or binary/unary operation returning a record (but NOT an auto-generated record constructor):
    // preserve the whole-record equation!
    if (
      lhsRec &&
      lhsRec.length > 0 &&
      !isComplexRec &&
      ((isRhsCall &&
        (!isRhsRecordCtor ||
          (isFramesOrientationCtor &&
            !expandArrayEquations &&
            Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"])))) ||
        isRhsComprehension ||
        isRhsBinary ||
        isRhsUnary)
    ) {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      if (expandArrayEquations && isRecordConstructorCall(out, newRhs)) {
        for (const field of lhsRec) {
          const fieldLhs = getFieldExpr(dae, out, lhsId, field, cloneExpr, expandArrayEquations);
          const fieldRhs = getFieldExpr(out, out, newRhs, field, (id) => id, expandArrayEquations);
          if (targetList) {
            targetList.push({ kind, lhsExprId: fieldLhs, rhsExprId: fieldRhs });
          } else {
            out.addEquation(kind, fieldLhs, fieldRhs, eqFlags);
            recordEqMeta(out.eqCount - 1);
          }
        }
        return;
      }
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }

    // Plug-compatibility check for connect equations:
    // If both sides are connectors (records), they must have the same member names.
    // If only one side is a record and the other isn't (e.g., scalar vs array), that's also incompatible.
    // For expandable connectors, member sets merge dynamically, so skip plug-compatibility check.
    if (kind === EqKind.Connect && recFields && recFields.length > 0) {
      const lhsName = dae.getExprKind(lhsId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhsId)) : "";
      const rhsName = dae.getExprKind(rhsId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhsId)) : "";
      const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
      const isBus = (name: string) => expBuses.some((b) => b && (name === b || name.startsWith(b + ".")));
      const isExpConnect = isBus(lhsName) || isBus(rhsName);

      const hasStreamMember = (name: string): boolean => Boolean(name && recordIndex.streamPrefixes.has(name));
      const isOuterOuterStream = eqFlags === 3 && (hasStreamMember(lhsName) || hasStreamMember(rhsName));

      if (isExpConnect || isOuterOuterStream) {
        const newLhs = cloneExpr(lhsId, "", null);
        const newRhs = cloneExpr(rhsId, "", null);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
        return;
      }

      const flattener = (dae as any).flattener;
      const isDisabledField = (baseName: string, field: string): boolean =>
        Boolean(baseName && flattener?.isComponentDisabled?.(`${baseName}.${field}`));
      const lhsSet = new Set(lhsRec ?? []);
      const rhsSet = new Set(rhsRec ?? []);

      let isPlugCompatible = true;
      if ((lhsRec && lhsRec.length > 0) || (rhsRec && rhsRec.length > 0)) {
        for (const f of lhsSet) {
          if (!rhsSet.has(f) && !isDisabledField(rhsName, f)) {
            isPlugCompatible = false;
            break;
          }
        }
        if (isPlugCompatible) {
          for (const f of rhsSet) {
            if (!lhsSet.has(f) && !isDisabledField(lhsName, f)) {
              isPlugCompatible = false;
              break;
            }
          }
        }
      }
      if (!isPlugCompatible) {
        if (!out.diagnostics.some((d) => d.code === 2002)) {
          const srcRange = origEqIdx !== undefined ? dae.getEqSourceRange?.(origEqIdx) : undefined;
          const rStart = srcRange ? srcRange.startOffset : undefined;
          const rEnd = srcRange ? srcRange.endOffset : undefined;
          out.diagnostics.push({
            severity: "error",
            code: 3003, // NOT_PLUG_COMPATIBLE
            message: `The connectors in connect(${lhsName}, ${rhsName}) are not type compatible.`,
            startOffset: rStart,
            endOffset: rEnd,
            range:
              srcRange && rStart !== undefined && rEnd !== undefined
                ? {
                    startOffset: rStart,
                    endOffset: rEnd,
                  }
                : undefined,
          });
        }
        return;
      }

      const commonFields = (lhsRec ?? []).filter((f) => rhsSet.has(f));
      for (const field of commonFields) {
        const newLhs = getFieldExpr(dae, out, lhsId, field, cloneExpr, expandArrayEquations);
        const newRhs = getFieldExpr(dae, out, rhsId, field, cloneExpr, expandArrayEquations);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    if (recFields && recFields.length > 0) {
      const isWholeComplexRec =
        !expandArrayEquations &&
        kind !== EqKind.Connect &&
        Boolean(dae.extensionMetadata?.["omcCompatibility"]) &&
        !dae.extensionMetadata?.["isOldFrontend"] &&
        recFields.length === 2 &&
        recFields[0] === "re" &&
        recFields[1] === "im";
      if (isWholeComplexRec) {
        const newLhs = cloneExpr(lhsId, "", null);
        const newRhs = cloneExpr(rhsId, "", null);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
        return;
      }
      for (const field of recFields) {
        const newLhs = getFieldExpr(dae, out, lhsId, field, cloneExpr, expandArrayEquations);
        const newRhs = getFieldExpr(dae, out, rhsId, field, cloneExpr, expandArrayEquations);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    const shape = checkShape(lhsId) || checkShape(rhsId);
    if (shape && shape.length > 0) {
      if (isRhsCall && !isRhsRecordCtor) {
        // If RHS is a vector/array function call (e.g. Complex.'-'.negateArr(ca2)), preserve whole equation!
        const newLhs = cloneExpr(lhsId, "", null);
        const newRhs = cloneExpr(rhsId, "", null);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
        return;
      }
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const indexSuffix = `[${idx.join(",")}]`;
        const newLhs = cloneExpr(lhsId, indexSuffix, shape);
        const newRhs = cloneExpr(rhsId, indexSuffix, shape);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
    } else {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
    }
  };

  const sameOutLhs = (a: number, b: number): boolean => {
    if (a < 0 || b < 0) return false;
    const ka = out.getExprKind(a);
    const kb = out.getExprKind(b);
    if (ka !== kb) return false;
    if (ka === ExprKind.Name || ka === ExprKind.IntLiteral || ka === ExprKind.BoolLiteral) {
      return out.getExprData1(a) === out.getExprData1(b);
    }
    if (ka === ExprKind.RealLiteral) {
      return out.getExprRealValue(a) === out.getExprRealValue(b);
    }
    return false;
  };

  const tryEmitBalancedIfAsSimple = (
    condId: number,
    thenEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    elseIfs: { conditionExprId: number; bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] }[],
    elseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    eqFlags: number,
    targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    origEqIdx?: number,
  ): boolean => {
    if (!expandArrayEquations || thenEqs.length === 0 || elseEqs.length !== thenEqs.length) return false;
    if (!elseIfs.every((c) => c.bodyEquations.length === thenEqs.length)) return false;
    const isSimple = (e: { kind: EqKind }) => e.kind === EqKind.Simple || e.kind === EqKind.InitialSimple;
    if (!thenEqs.every(isSimple) || !elseEqs.every(isSimple)) return false;
    if (!elseIfs.every((c) => c.bodyEquations.every(isSimple))) return false;

    const toResidual = (eq: { lhsExprId: number; rhsExprId: number }) =>
      out.addBinaryExpr(BinOp.Sub, eq.lhsExprId, eq.rhsExprId);

    for (let k = 0; k < thenEqs.length; k++) {
      const tEq = thenEqs[k]!;
      const eEq = elseEqs[k]!;
      const allSameLhs =
        sameOutLhs(tEq.lhsExprId, eEq.lhsExprId) &&
        elseIfs.every((c) => sameOutLhs(tEq.lhsExprId, c.bodyEquations[k]!.lhsExprId));
      let combinedLhs: number;
      let combinedRhs: number;
      if (allSameLhs) {
        let rhsChain = eEq.rhsExprId;
        for (let ci = elseIfs.length - 1; ci >= 0; ci--) {
          rhsChain = out.addIfElseExpr(
            elseIfs[ci]!.conditionExprId,
            elseIfs[ci]!.bodyEquations[k]!.rhsExprId,
            rhsChain,
          );
        }
        combinedLhs = tEq.lhsExprId;
        combinedRhs = out.addIfElseExpr(condId, tEq.rhsExprId, rhsChain);
      } else {
        let resChain = toResidual(eEq);
        for (let ci = elseIfs.length - 1; ci >= 0; ci--) {
          resChain = out.addIfElseExpr(
            elseIfs[ci]!.conditionExprId,
            toResidual(elseIfs[ci]!.bodyEquations[k]!),
            resChain,
          );
        }
        combinedLhs = out.addRealLiteral(0.0);
        combinedRhs = out.addIfElseExpr(condId, toResidual(tEq), resChain);
      }
      if (targetList) {
        targetList.push({ kind: tEq.kind, lhsExprId: combinedLhs, rhsExprId: combinedRhs });
      } else {
        out.addEquation(tEq.kind, combinedLhs, combinedRhs, eqFlags);
        if (origEqIdx !== undefined) {
          const desc = dae.getEqDescription?.(origEqIdx);
          if (desc) out.setEqDescription(out.eqCount - 1, desc);
          const range = dae.getEqSourceRange?.(origEqIdx);
          if (range) out.setEqSourceRange(out.eqCount - 1, range.startOffset, range.endOffset);
        }
      }
    }
    return true;
  };

  // --- Step 5: Emit & Unroll Equations (`If`, `When`, `For`/`InitialFor`, and Simple/Connect) ---
  let staticIfNameToIdx: Map<string, number> | undefined;
  let staticIfParamMap: Map<string, any> | undefined;
  const ensureStaticIfMaps = () => {
    if (staticIfParamMap) return;
    staticIfNameToIdx = new Map<string, number>();
    staticIfParamMap = new Map<string, any>();
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      staticIfNameToIdx.set(dae.getVarName(v), v);
    }
    for (let pass = 0; pass < 4; pass++) {
      let progress = false;
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const vName = dae.getVarName(v);
        if (staticIfParamMap.has(vName)) continue;
        const vb = dae.getVarVariability(v);
        if (
          vb !== Variability.Constant &&
          !(vb === Variability.Parameter && (dae.isVarFinal(v) || dae.isVarEvaluate(v)))
        ) {
          continue;
        }
        const explicitExprFn = (dae as { getExplicitVarExpression?: (idx: number) => number }).getExplicitVarExpression;
        const bindExpr = explicitExprFn ? explicitExprFn.call(dae, v) : dae.getVarExpression(v);
        if (bindExpr === undefined || bindExpr < 0) continue;
        const val = evaluateConstantArenaExpression(
          dae,
          bindExpr,
          staticIfParamMap,
          staticIfNameToIdx,
          0,
          undefined,
          undefined,
          true,
        );
        if (val !== null) {
          staticIfParamMap.set(vName, val);
          progress = true;
        }
      }
      if (!progress) break;
    }
  };

  // Emit equations
  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i)) continue;
    const kind = dae.getEqKind(i);
    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);
    const eqFlags = dae.getEqFlags(i);

    if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (meta) {
        const evalStaticIfCond = (condExprId: number): boolean | null => {
          if (condExprId < 0) return null;
          ensureStaticIfMaps();
          const v = evaluateConstantArenaExpression(
            dae,
            condExprId,
            staticIfParamMap,
            staticIfNameToIdx,
            0,
            undefined,
            undefined,
            true,
          );
          return typeof v === "boolean" ? v : null;
        };
        const emitEvaluatedIf = (
          rawCondId: number,
          thenSrc: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
          elseIfSrc: { conditionExprId: number; bodyEquations?: any[]; equations?: any[] }[],
          elseSrc: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
          dstList?: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
        ): void => {
          const topVal = evalStaticIfCond(rawCondId);
          if (topVal === true) {
            cloneInlineEqList(thenSrc, dstList);
            return;
          }
          if (topVal === false) {
            for (let ci = 0; ci < elseIfSrc.length; ci++) {
              const clause = elseIfSrc[ci]!;
              const cBody = clause.bodyEquations ?? clause.equations ?? [];
              const cVal = evalStaticIfCond(clause.conditionExprId);
              if (cVal === true) {
                cloneInlineEqList(cBody, dstList);
                return;
              }
              if (cVal === null) {
                emitEvaluatedIf(clause.conditionExprId, cBody, elseIfSrc.slice(ci + 1), elseSrc, dstList);
                return;
              }
            }
            cloneInlineEqList(elseSrc, dstList);
            return;
          }
          const condId = cloneExpr(rawCondId, "", null);
          const thenList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
          cloneInlineEqList(thenSrc, thenList);
          const elseIfList: {
            conditionExprId: number;
            bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
            equations: any[];
          }[] = [];
          let activeElseSrc = elseSrc;
          for (const clause of elseIfSrc) {
            const cVal = evalStaticIfCond(clause.conditionExprId);
            if (cVal === false) continue;
            const cBody = clause.bodyEquations ?? clause.equations ?? [];
            if (cVal === true) {
              activeElseSrc = cBody;
              break;
            }
            const clauseCond = cloneExpr(clause.conditionExprId, "", null);
            const clauseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
            cloneInlineEqList(cBody, clauseEqs);
            elseIfList.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
          }
          const elseList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
          if (activeElseSrc.length > 0) {
            cloneInlineEqList(activeElseSrc, elseList);
          }
          if (tryEmitBalancedIfAsSimple(condId, thenList, elseIfList, elseList, eqFlags, dstList, i)) {
            return;
          }
          if (dstList) {
            dstList.push({
              kind: EqKind.If,
              lhsExprId: condId,
              rhsExprId: -1,
              thenEquations: thenList,
              elseIfClauses: elseIfList,
              elseEquations: elseList,
            });
          } else {
            const ifIdx = out.addIfEquation(condId);
            const ifRange = dae.getEqSourceRange?.(i);
            if (ifRange) out.setEqSourceRange(ifIdx, ifRange.startOffset, ifRange.endOffset);
            const outMeta = out.getIfEquationMeta(ifIdx);
            if (outMeta) {
              outMeta.thenEquations.push(...thenList);
              outMeta.elseIfClauses.push(...elseIfList);
              if (meta.elseEquations || elseList.length > 0) {
                outMeta.elseEquations ??= [];
                outMeta.elseEquations.push(...elseList);
              }
            }
          }
        };
        const cloneInlineEqList = (
          srcList: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
          dstList?: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
        ) => {
          for (const eq of srcList) {
            if (eq.kind === EqKind.If && Array.isArray((eq as any).thenEquations)) {
              emitEvaluatedIf(
                eq.lhsExprId,
                (eq as any).thenEquations,
                (eq as any).elseIfClauses ?? [],
                (eq as any).elseEquations ?? [],
                dstList,
              );
            } else {
              const subKind = (eqFlags & 1) !== 0 && eq.kind === EqKind.Simple ? EqKind.InitialSimple : eq.kind;
              emitEquation(subKind, eq.lhsExprId, eq.rhsExprId, eqFlags, dstList, i);
            }
          }
        };
        emitEvaluatedIf(
          meta.conditionExprId,
          meta.thenEquations,
          meta.elseIfClauses,
          meta.elseEquations ?? [],
          undefined,
        );
        continue;
      }
    }

    if (kind === EqKind.When) {
      const meta = dae.getWhenEquationMeta(i);
      if (meta) {
        const condId = cloneExpr(meta.conditionExprId, "", null);
        const whenIdx = out.addWhenEquation(condId);
        const whenRange = dae.getEqSourceRange?.(i);
        if (whenRange) out.setEqSourceRange(whenIdx, whenRange.startOffset, whenRange.endOffset);
        const outMeta = out.getWhenEquationMeta(whenIdx);
        if (outMeta) {
          for (const eq of meta.bodyEquations) {
            emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, outMeta.bodyEquations);
          }
          if (meta.elseWhenClauses) {
            for (const clause of meta.elseWhenClauses) {
              const clauseCond = cloneExpr(clause.conditionExprId, "", null);
              const clauseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
              for (const eq of clause.bodyEquations) {
                emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, clauseEqs);
              }
              outMeta.elseWhenClauses.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
            }
          }
        }
        continue;
      }
    }

    // Unroll `For` and `InitialFor` loops by evaluating loop range bounds (`evalRangeVal` / `getRangeValues`),
    // binding the loop variable in `loopVarMap`, and recursively emitting body equations.
    if (kind === EqKind.For || kind === EqKind.InitialFor) {
      const meta = dae.getForEquationMeta(i);
      if (meta) {
        const evalRangeVal = (id: number): number | null => {
          if (id < 0) return null;
          const knd = dae.getExprKind(id);
          if (knd === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (knd === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (knd === ExprKind.Negate) {
            const v = evalRangeVal(dae.getExprLeft(id));
            return v !== null ? -v : null;
          }
          if (knd === ExprKind.Name) {
            const nmRaw = dae.interner.resolve(dae.getExprData1(id));
            const nm = nmRaw?.startsWith("\0loop\0") ? nmRaw.substring(6) : nmRaw;
            if (nm && loopVarMap.has(nm)) return loopVarMap.get(nm)!;
            if (nm) {
              const vIdx = dae.getVarIdxByName(nm);
              if (
                vIdx >= 0 &&
                (dae.getVarVariability(vIdx) === Variability.Parameter ||
                  dae.getVarVariability(vIdx) === Variability.Constant)
              ) {
                const exprId = dae.getVarExpression(vIdx);
                if (typeof exprId === "number" && exprId >= 0) {
                  const ev = evalRangeVal(exprId);
                  if (ev !== null) return ev;
                }
                return dae.getVarStartValue(vIdx);
              }
            }
          }
          if (knd === ExprKind.Binary) {
            const op = dae.getExprData1(id);
            const lv = evalRangeVal(dae.getExprLeft(id));
            const rv = evalRangeVal(dae.getExprRight(id));
            if (lv !== null && rv !== null) {
              if (op === BinOp.Add) return lv + rv;
              if (op === BinOp.Sub) return lv - rv;
              if (op === BinOp.Mul) return lv * rv;
              if (op === BinOp.Div && rv !== 0) return Math.trunc(lv / rv);
            }
          }
          const cVal = evaluateConstantArenaExpression(dae, id);
          return typeof cVal === "number" ? cVal : null;
        };
        const getRangeValues = (rangeExprId: number): number[] => {
          if (rangeExprId < 0) return [];
          const rk = dae.getExprKind(rangeExprId);
          if (rk === ExprKind.Range) {
            const sVal = evalRangeVal(dae.getExprData1(rangeExprId));
            const stepId = dae.getExprLeft(rangeExprId);
            const stVal = stepId >= 0 ? evalRangeVal(stepId) : 1;
            const eVal = evalRangeVal(dae.getExprRight(rangeExprId));
            if (sVal !== null && stVal !== null && eVal !== null && stVal !== 0) {
              const vals: number[] = [];
              if (stVal > 0) {
                for (let v = sVal; v <= eVal; v += stVal) vals.push(v);
              } else {
                for (let v = sVal; v >= eVal; v += stVal) vals.push(v);
              }
              return vals;
            }
          } else if (rk === ExprKind.ArrayCtor) {
            const count = dae.getExprData1(rangeExprId);
            const vals: number[] = [];
            for (let k = 0; k < count; k++) {
              const eId = k === 0 ? dae.getExprLeft(rangeExprId) : dae.getExprLeft(rangeExprId + k);
              const v = evalRangeVal(eId);
              if (v !== null) vals.push(v);
            }
            return vals;
          }
          return [];
        };
        const unrollForEqs = (
          indexNameId: number,
          rangeExprId: number,
          bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
          isInit: boolean,
          targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
        ) => {
          const indexNameRaw = dae.interner.resolve(indexNameId) || "i";
          const indexName = indexNameRaw.startsWith("\0loop\0") ? indexNameRaw.substring(6) : indexNameRaw;
          const vals = getRangeValues(rangeExprId);
          const prevVal = loopVarMap.get(indexName);
          for (const val of vals) {
            loopVarMap.set(indexName, val);
            for (const bodyEq of bodyEquations) {
              const anyEq = bodyEq as any;
              if (
                (bodyEq.kind === EqKind.For || bodyEq.kind === EqKind.InitialFor) &&
                Array.isArray(anyEq.bodyEquations)
              ) {
                unrollForEqs(
                  bodyEq.lhsExprId,
                  bodyEq.rhsExprId,
                  anyEq.bodyEquations,
                  isInit || bodyEq.kind === EqKind.InitialFor,
                  targetList,
                );
              } else if (bodyEq.kind === EqKind.If && Array.isArray(anyEq.thenEquations)) {
                const condVal = evaluateConstantArenaExpression(dae, bodyEq.lhsExprId);
                if (typeof condVal === "boolean") {
                  if (condVal) {
                    for (const sub of anyEq.thenEquations) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, eqFlags, targetList, i);
                    }
                  } else if (Array.isArray(anyEq.elseEquations)) {
                    for (const sub of anyEq.elseEquations) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, eqFlags, targetList, i);
                    }
                  }
                } else {
                  const subCond = cloneExpr(bodyEq.lhsExprId, "", null);
                  const thenList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                  for (const sub of anyEq.thenEquations) {
                    const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                    emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, 0, thenList, i);
                  }
                  const elseIfList: {
                    conditionExprId: number;
                    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
                    equations: any[];
                  }[] = [];
                  for (const c of anyEq.elseIfClauses || []) {
                    const cCond = cloneExpr(c.conditionExprId, "", null);
                    const cBody: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                    for (const sub of c.bodyEquations || []) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, 0, cBody, i);
                    }
                    elseIfList.push({ conditionExprId: cCond, bodyEquations: cBody, equations: [] });
                  }
                  const elseList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                  if (Array.isArray(anyEq.elseEquations)) {
                    for (const sub of anyEq.elseEquations) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, 0, elseList, i);
                    }
                  }
                  if (tryEmitBalancedIfAsSimple(subCond, thenList, elseIfList, elseList, eqFlags, targetList, i)) {
                    continue;
                  }
                  const ifIdx = out.addIfEquation(subCond);
                  const outIfMeta = out.getIfEquationMeta(ifIdx);
                  if (outIfMeta) {
                    outIfMeta.thenEquations.push(...thenList);
                    outIfMeta.elseIfClauses.push(...elseIfList);
                    if (Array.isArray(anyEq.elseEquations)) {
                      outIfMeta.elseEquations ??= [];
                      outIfMeta.elseEquations.push(...elseList);
                    }
                  }
                }
              } else {
                const subKind = isInit && bodyEq.kind === EqKind.Simple ? EqKind.InitialSimple : bodyEq.kind;
                emitEquation(subKind, bodyEq.lhsExprId, bodyEq.rhsExprId, eqFlags, targetList, i);
              }
            }
          }
          if (prevVal !== undefined) {
            loopVarMap.set(indexName, prevVal);
          } else {
            loopVarMap.delete(indexName);
          }
        };
        unrollForEqs(meta.indexNameId, meta.rangeExprId, meta.bodyEquations, kind === EqKind.InitialFor);
        continue;
      }
    }

    emitEquation(kind, lhsId, rhsId, eqFlags, undefined, i);
  }

  // --- Step 6: Clone Boundary Nodes & Imperative Algorithm Statements ---
  for (const node of dae.boundaryNodes) {
    out.boundaryNodes.push({ ...node });
  }

  const stmtOffset = out.stmtCount;
  for (let i = 0; i < dae.stmtCount; i++) {
    const k = dae.getStmtKind(i);
    switch (k) {
      case StmtKind.Assignment: {
        const target = cloneExpr(dae.getStmtData1(i), "", null);
        const val = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.Assignment, target, val);
        break;
      }
      case StmtKind.For: {
        const iterName = dae.interner.resolve(dae.getStmtData1(i)) || "";
        const range = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.For, out.interner.intern(iterName), range, dae.getStmtRight(i));
        break;
      }
      case StmtKind.While: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.While, cond, dae.getStmtLeft(i));
        break;
      }
      case StmtKind.If: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.If, cond, dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
      }
      case StmtKind.When: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.When, cond, dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
      }
      case StmtKind.Block: {
        const rawCond = dae.getStmtData1(i);
        const cond = rawCond >= 0 ? cloneExpr(rawCond, "", null) : -1;
        out.addStatement(StmtKind.Block, cond, dae.getStmtLeft(i));
        break;
      }
      case StmtKind.Return:
        out.addStatement(StmtKind.Return);
        break;
      case StmtKind.Break:
        out.addStatement(StmtKind.Break);
        break;
      case StmtKind.ProcedureCall: {
        const call = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.ProcedureCall, call);
        break;
      }
      case StmtKind.ComplexAssignment: {
        const val = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.ComplexAssignment, dae.getStmtData1(i), val);
        break;
      }
      default:
        out.addStatement(k, dae.getStmtData1(i), dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
    }
  }

  for (const algo of dae.algorithmSections) {
    out.addAlgorithmSection(stmtOffset + algo.start, algo.count);
  }

  for (const algo of dae.initialAlgorithmSections) {
    out.addInitialAlgorithmSection(stmtOffset + algo.start, algo.count);
  }

  out.isImpure = dae.isImpure;
  out.descriptionId = dae.descriptionId;
  out.name = dae.name;
  out.classKind = dae.classKind;
  out.description = dae.description;
  out.equationAnnotations = [...dae.equationAnnotations];
  const cloneStateMachine = (sm: (typeof dae.stateMachines)[number]): (typeof dae.stateMachines)[number] => ({
    ...sm,
    transitions: sm.transitions.map((t) => ({
      ...t,
      conditionExprId: t.conditionExprId >= 0 ? cloneExpr(t.conditionExprId, "", null) : t.conditionExprId,
    })),
    states: sm.states.map((s) => ({
      ...s,
      equations: s.equations.map((eq) => ({
        ...eq,
        targetNameId: out.interner.intern(dae.interner.resolve(eq.targetNameId) ?? ""),
        exprId: eq.exprId >= 0 ? cloneExpr(eq.exprId, "", null) : eq.exprId,
      })),
      variables: s.variables.map((v) => ({
        ...v,
        nameId: out.interner.intern(dae.interner.resolve(v.nameId) ?? ""),
      })),
      stateMachines: s.stateMachines ? s.stateMachines.map(cloneStateMachine) : [],
    })),
  });
  out.stateMachines = dae.stateMachines.map(cloneStateMachine);

  out.syncWasmStringPool();
  return out;
}
