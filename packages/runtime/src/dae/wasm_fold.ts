// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Constant Folding & Algebraic Reduction Framework.
 * Operates directly on DAEBuilder and WebAssembly memory buffers.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "../runtime.js";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, StmtKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";
import { evaluateArrayBuiltin } from "./wasm_evaluator.js";
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
    case "ceil":
      return Math.ceil(arg1);
    case "pow":
      return Math.pow(arg1, arg2);
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
        const csvValue = (resolved.metadata as any).csvValue;
        if (csvValue !== undefined) {
          return csvValue;
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
        const bindMemo: Map<number, ArenaConstantValue> | undefined = !onlyConstants
          ? (paramMap as any)?._bindMemo
          : undefined;
        if (bindMemo && bindMemo.has(bindExpr)) {
          return bindMemo.get(bindExpr)!;
        }
        const val = evaluateConstantArenaExpression(
          arena,
          bindExpr,
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
          onlyConstants,
        );
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
        return null;
      };
      const res = evalElemBinOp(op, lVal, rVal);
      if (res !== null) return res;
    }

    if (typeof lVal === "string" && typeof rVal === "string" && (op === BinOp.Add || op === BinOp.ElemAdd)) {
      return lVal + rVal;
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

    // 5c. Special-case `String(EnumLiteral)`, `linspace`, type casts (`Real`/`Integer`), and `cardinality(connector)`.
    if (funcName === "String" && argCount === 1) {
      const a0 = getCallArg(0);
      if (arena.getExprKind(a0) === ExprKind.EnumLiteral) {
        const enumPath = arena.interner.resolve(arena.getExprLeft(a0));
        return enumPath.includes(".") ? enumPath.split(".").pop()! : enumPath;
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

    if (argCount >= 1 && getCallArg(0) >= 0) {
      const arg1 = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
        onlyConstants,
      );
      if (Array.isArray(arg1) && argCount === 1) {
        const flat = (arg1 as any[]).flat(Infinity) as number[];
        if (flat.length === 0) return null;
        if (funcName === "max") return Math.max(...flat);
        if (funcName === "min") return Math.min(...flat);
        if (funcName === "sum") return flat.reduce((a, b) => a + b, 0);
        if (funcName === "product") return flat.reduce((a, b) => a * b, 1);
      }
      if (typeof arg1 === "number") {
        let arg2 = 0.0;
        if (argCount >= 2) {
          const arg2Val = evaluateConstantArenaExpression(
            arena,
            getCallArg(1),
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
            onlyConstants,
          );
          if (typeof arg2Val !== "number") return null;
          arg2 = arg2Val;
        }
        if (argCount <= 2) {
          const mathRes = evalMathBuiltin(funcName, arg1, arg2);
          if (mathRes !== null) return mathRes;
        }
      }

      const fnBridge = arena.getFunction(funcName) ?? lookupRecordFunctionInDae(arena, funcName);
      if (fnBridge) {
        const args: any[] = [];
        let allOk = true;
        for (let i = 0; i < argCount; i++) {
          const val = evaluateConstantArenaExpression(
            arena,
            getCallArg(i),
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
            onlyConstants,
          );
          if (val === null) {
            allOk = false;
            break;
          }
          args.push(val);
        }
        if (allOk) {
          const fnInternId = arena.interner.intern(fnBridge.name || funcName);
          let res: any = null;
          try {
            res = evaluateArenaFunctionCall(arena, fnInternId, args, db, scopeId);
            if (res === null && fnBridge.name !== funcName) {
              res = evaluateArenaFunctionCall(arena, arena.interner.intern(funcName), args, db, scopeId);
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
  }

  return null;
}

/**
 * Simplifies an expression by resolving IfElse branches whose condition evaluates to constant.
 */
export function simplifyArenaIfElse(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: Map<string, number>,
  nameToIdx?: Map<string, number>,
): number {
  if (exprId < 0 || exprId >= arena.exprCount) return exprId;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.IfElse: {
      const condId = arena.getExprData1(exprId);
      const condVal = evaluateConstantArenaExpression(arena, condId, paramMap, nameToIdx);
      if (condVal !== null) {
        const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
        const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
        return simplifyArenaIfElse(arena, branchId, paramMap, nameToIdx);
      }
      const newCond = simplifyArenaIfElse(arena, condId, paramMap, nameToIdx);
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx);
      const newRight = simplifyArenaIfElse(arena, rightId, paramMap, nameToIdx);
      if (newCond !== condId || newLeft !== leftId || newRight !== rightId) {
        return arena.addIfElseExpr(newCond, newLeft, newRight);
      }
      return exprId;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const leftId = arena.getExprLeft(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx);
      return newLeft !== leftId ? arena.addUnaryExpr(op, newLeft) : exprId;
    }
    case ExprKind.Negate: {
      const leftId = arena.getExprLeft(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx);
      return newLeft !== leftId ? arena.addExpression(ExprKind.Negate, 0, newLeft) : exprId;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx);
      const newRight = simplifyArenaIfElse(arena, rightId, paramMap, nameToIdx);
      return newLeft !== leftId || newRight !== rightId ? arena.addBinaryExpr(op, newLeft, newRight) : exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const argCount = arena.getExprRight(exprId);
      let changed = false;
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newArg = simplifyArenaIfElse(arena, argId, paramMap, nameToIdx);
        if (newArg !== argId) changed = true;
        args.push(newArg);
      }
      if (changed) {
        const fnName = arena.interner.resolve(funcNameId) || "";
        return arena.addCallExpr(fnName, args);
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseId = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const newBase = simplifyArenaIfElse(arena, baseId, paramMap, nameToIdx);
      let changed = newBase !== baseId;
      const subs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newSub = simplifyArenaIfElse(arena, subId, paramMap, nameToIdx);
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
        const newElem = simplifyArenaIfElse(arena, elemId, paramMap, nameToIdx);
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
        if (varType === VarType.Integer) {
          return arena.addIntLiteral(Math.trunc(val));
        } else if (varType === VarType.Boolean) {
          return arena.addBoolLiteral(Boolean(val));
        } else if (varType === VarType.Real) {
          return arena.addRealLiteral(val);
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
          if (isLiteralZero(arena, left)) return left;
          if (isLiteralOne(arena, right)) return left;
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
      const argCount = arena.getExprRight(exprId);
      let anyChanged = false;
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newArg = substituteArenaConstants(arena, argExprId, constMap, nameToIdx);
        args.push(newArg);
        if (newArg !== argExprId) anyChanged = true;
      }
      const fnName = arena.interner.resolve(funcNameId) || "";
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
      const folded = evaluateConstantArenaExpression(arena, callId, constMap, nameToIdx, 0, undefined, undefined, true);
      if (typeof folded === "number") {
        if (fnName === "/*Real*/" || fnName === "Real" || isRealTypedArenaExpr(arena, callId, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
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
    case ExprKind.Subscript: {
      const baseExprId = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const newBase = substituteArenaConstants(arena, baseExprId, constMap, nameToIdx);
      let anyChanged = newBase !== baseExprId;
      const newSubs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newSub = substituteArenaConstants(arena, subId, constMap, nameToIdx);
        newSubs.push(newSub);
        if (newSub !== subId) anyChanged = true;
      }
      const subExprId = anyChanged ? arena.addSubscriptExpr(newBase, newSubs) : exprId;
      const folded = evaluateConstantArenaExpression(arena, subExprId, constMap, nameToIdx);
      if (typeof folded === "number" && Number.isFinite(folded)) {
        return arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
      }
      return subExprId;
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
  // Use TypeScript implementation to properly handle fixed=false parameters and dependencies

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

  const paramMap = new Map<string, any>();
  const constMap = new Map<string, any>();
  const finalParamOrConstMap = new Map<string, any>();

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
      if (v === Variability.Discrete || (arena.getVarCausality(i) === Causality.Input && !name.includes("."))) {
        continue;
      }
      if (v === Variability.Parameter && !arena.isVarFixed(i)) {
        continue;
      }
      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
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
              evaluateConstantArenaExpression(arena, exprId, finalParamOrConstMap, nameToIdx, 0, db, scopeId) !== null);
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
    for (const i of bindingIndices) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v !== Variability.Constant && v !== Variability.Parameter && !omcCompatibility) continue;
      if (v === Variability.Parameter && !arena.isVarFixed(i)) continue;

      const exprId = (arena as any).getExplicitVarExpression
        ? (arena as any).getExplicitVarExpression(i)
        : arena.getVarExpression(i);
      if (exprId >= 0) {
        const evalVal = evaluateConstantArenaExpression(
          arena,
          exprId,
          omcCompatibility ? constMap : paramMap,
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
            if (arena.getVarType(i) !== VarType.Enumeration) {
              const litId =
                arena.getVarType(i) === VarType.Integer
                  ? arena.addIntLiteral(foldedValue)
                  : arena.addRealLiteral(foldedValue);
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
  const eqFoldMap = omcCompatibility ? constMap : paramMap;
  const ifElseFoldMap = omcCompatibility ? constMap : paramMap;
  for (let eq = 0; eq < arena.eqCount; eq++) {
    const eqKind = arena.getEqKind(eq);
    if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
      let lhsExpr = arena.getEqLhs(eq);
      let rhsExpr = arena.getEqRhs(eq);
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
              continue;
            }
          } else if (lhsKind !== ExprKind.Subscript) {
            continue;
          }

          if (varType !== VarType.Enumeration && !isExprAlreadyLiteral(arena, rhsExpr, foldedRhs)) {
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
        const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx);
        if (simplifiedRhs !== rhsExpr) {
          arena.setEqRhs(eq, simplifiedRhs);
          rhsExpr = simplifiedRhs;
        }
        const constSubRhs = substituteArenaConstants(arena, rhsExpr, constMap, nameToIdx);
        if (constSubRhs !== rhsExpr) {
          arena.setEqRhs(eq, constSubRhs);
        }
        if (lhsKind !== ExprKind.Name && lhsKind !== ExprKind.Der) {
          const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, ifElseFoldMap, nameToIdx);
          if (simplifiedLhs !== lhsExpr) {
            arena.setEqLhs(eq, simplifiedLhs);
            lhsExpr = simplifiedLhs;
          }
          const constSubLhs = substituteArenaConstants(arena, lhsExpr, constMap, nameToIdx);
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
          const simplified = simplifyArenaIfElse(arena, cur, ifElseFoldMap, nameToIdx);
          if (simplified !== cur) cur = simplified;
          const subbed = substituteArenaConstants(arena, cur, constMap, nameToIdx);
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

              const simplifiedRhs = simplifyArenaIfElse(arena, bodyEq.rhsExprId, ifElseFoldMap, nameToIdx);
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, constMap, nameToIdx);
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
        const foldEqList = (list: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]) => {
          for (const bodyEq of list) {
            if (bodyEq.kind === EqKind.If) {
              const anyEq = bodyEq as any;
              if (Array.isArray(anyEq.thenEquations)) foldEqList(anyEq.thenEquations);
              for (const c of anyEq.elseIfClauses || []) {
                if (Array.isArray(c.bodyEquations)) foldEqList(c.bodyEquations);
              }
              if (Array.isArray(anyEq.elseEquations)) foldEqList(anyEq.elseEquations);
              continue;
            }
            if (bodyEq.kind !== EqKind.Simple) continue;
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

              const simplifiedRhs = simplifyArenaIfElse(arena, bodyEq.rhsExprId, ifElseFoldMap, nameToIdx);
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, constMap, nameToIdx);
              if (constSub !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = constSub;
              }
            }
          }
        };
        foldEqList(meta.thenEquations);
        for (const clause of meta.elseIfClauses) {
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
          const constSubRange = substituteArenaConstants(arena, meta.rangeExprId, constMap, nameToIdx);
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
                bodyEq.rhsExprId = substituteArenaConstants(arena, bodyEq.rhsExprId, constMap, nameToIdx);
              }
              foldForEqList(anyEq.bodyEquations);
              continue;
            }
            if (bodyEq.lhsExprId >= 0) {
              bodyEq.lhsExprId = substituteArenaConstants(arena, bodyEq.lhsExprId, constMap, nameToIdx);
            }
            if (bodyEq.rhsExprId >= 0) {
              bodyEq.rhsExprId = substituteArenaConstants(arena, bodyEq.rhsExprId, constMap, nameToIdx);
            }
          }
        };
        foldForEqList(meta.bodyEquations);
      }
    }
  }

  return iterations;
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

        if (pfx.endsWith("]")) {
          const stripped = pfx.replace(/(?:\[[^\][]*\])+$/, "");
          if (stripped && stripped !== pfx) {
            let arrList = arrayElemFields.get(stripped);
            if (!arrList) {
              arrList = [];
              arrayElemFields.set(stripped, arrList);
            }
            arrList.push(rest);
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
  const out = new DAEBuilder(dae.interner);
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
  for (const [k, v] of dae.diffusionExprIds) out.diffusionExprIds.set(k, v);
  out.extensionMetadata = {
    ...dae.extensionMetadata,
    ...(dae.extensionMetadata.webgpu && { webgpu: { ...dae.extensionMetadata.webgpu } }),
    ...(dae.extensionMetadata.audioClock && { audioClock: { ...dae.extensionMetadata.audioClock } }),
    ...(dae.extensionMetadata.sde && { sde: { ...dae.extensionMetadata.sde } }),
    ...(dae.extensionMetadata.bvp && {
      bvp: {
        ...dae.extensionMetadata.bvp,
        boundaryConditions: dae.extensionMetadata.bvp.boundaryConditions
          ? [...dae.extensionMetadata.bvp.boundaryConditions]
          : undefined,
      },
    }),
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
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
          const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          args.push(cloneExpr(argExprId, indexSuffix, currentShape, true));
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
            if (arrayShapes.has(rawBase) || out.getVarIdxByName(combinedName) >= 0) {
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
      const newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }

    const lhsElements = getArrayElements(dae, lhsId);
    const rhsElements = getArrayElements(dae, rhsId);
    if ((lhsElements && lhsElements.length === 0) || (rhsElements && rhsElements.length === 0)) {
      return;
    }
    if (
      Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
      kind === EqKind.InitialSimple &&
      lhsElements &&
      lhsElements.length > 0 &&
      !rhsElements &&
      dae.getExprKind(rhsId) === ExprKind.Call
    ) {
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
      ((isRhsCall && !isRhsRecordCtor) || isRhsComprehension || isRhsBinary || isRhsUnary)
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
      const isOmcCompat = Boolean(
        dae.extensionMetadata?.["omcCompatibility"] ||
        dae.extensionMetadata?.["isOldFrontend"] ||
        out.extensionMetadata?.["omcCompatibility"],
      );
      const isRecordVarEq =
        lhsRec &&
        rhsRec &&
        kind !== EqKind.Connect &&
        (dae.getExprKind(rhsId) === ExprKind.Name || dae.getExprKind(rhsId) === ExprKind.Der);
      if (isOmcCompat && isRecordVarEq) {
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
        const cloneInlineEqList = (
          srcList: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
          dstList: { kind: EqKind; lhsExprId: number; rhsExprId: number; [k: string]: any }[],
        ) => {
          for (const eq of srcList) {
            if (eq.kind === EqKind.If && Array.isArray((eq as any).thenEquations)) {
              const subCond = cloneExpr(eq.lhsExprId, "", null);
              const subThen: any[] = [];
              cloneInlineEqList((eq as any).thenEquations, subThen);
              const subElseIf: any[] = [];
              if (Array.isArray((eq as any).elseIfClauses)) {
                for (const c of (eq as any).elseIfClauses) {
                  const cCond = cloneExpr(c.conditionExprId, "", null);
                  const cBody: any[] = [];
                  cloneInlineEqList(c.bodyEquations ?? c.equations ?? [], cBody);
                  subElseIf.push({ conditionExprId: cCond, bodyEquations: cBody, equations: [] });
                }
              }
              const subElse: any[] = [];
              if (Array.isArray((eq as any).elseEquations)) {
                cloneInlineEqList((eq as any).elseEquations, subElse);
              }
              if (tryEmitBalancedIfAsSimple(subCond, subThen, subElseIf, subElse, eqFlags, dstList, i)) {
                continue;
              }
              dstList.push({
                kind: EqKind.If,
                lhsExprId: subCond,
                rhsExprId: -1,
                thenEquations: subThen,
                elseIfClauses: subElseIf,
                elseEquations: subElse,
              });
            } else {
              emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, dstList);
            }
          }
        };
        const condId = cloneExpr(meta.conditionExprId, "", null);
        const thenList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
        cloneInlineEqList(meta.thenEquations, thenList);
        const elseIfList: {
          conditionExprId: number;
          bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
          equations: any[];
        }[] = [];
        for (const clause of meta.elseIfClauses) {
          const clauseCond = cloneExpr(clause.conditionExprId, "", null);
          const clauseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
          cloneInlineEqList(clause.bodyEquations, clauseEqs);
          elseIfList.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
        }
        const elseList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
        if (meta.elseEquations) {
          cloneInlineEqList(meta.elseEquations, elseList);
        }
        if (tryEmitBalancedIfAsSimple(condId, thenList, elseIfList, elseList, eqFlags, undefined, i)) {
          continue;
        }
        const ifIdx = out.addIfEquation(condId);
        const ifRange = dae.getEqSourceRange?.(i);
        if (ifRange) out.setEqSourceRange(ifIdx, ifRange.startOffset, ifRange.endOffset);
        const outMeta = out.getIfEquationMeta(ifIdx);
        if (outMeta) {
          outMeta.thenEquations.push(...thenList);
          outMeta.elseIfClauses.push(...elseIfList);
          if (meta.elseEquations) {
            outMeta.elseEquations ??= [];
            outMeta.elseEquations.push(...elseList);
          }
        }
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
