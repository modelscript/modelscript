// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Constant/parameter record and record-array call equation folding pass
 * (`r = f(...)`, `sTM = f(m)`) and old-frontend 1D array tuple-LHS expansion.
 */

import { ExprKind } from "@modelscript/dsl";
import {
  Causality,
  type DAEBuilder,
  EqKind,
  evaluateConstantArenaExpression,
  foldArenaConstants,
  StmtKind,
  type SymbolId,
  Variability,
  VarType,
} from "@modelscript/runtime";
import type { ClassFlattenerContext, DaeWithExtras, EvalFieldContainer } from "./types.js";

export function runRecordCallFoldingPass(
  ctx: ClassFlattenerContext,
  rootClassId: SymbolId,
  dae: DAEBuilder,
  flattenedInWasm: boolean,
  isOldFrontend: boolean,
  evalAllParams: boolean,
  preFoldNonArrayRhs: Set<number>,
): void {
  // Fold constant/parameter record & record-array call equations (`r = f(...)`, `sTM = f(m)`)
  // into scalarized field bindings across a fixpoint loop (handles chained Spice3 records).
  if (flattenedInWasm && ctx.options.omcCompatibility) {
    ctx.generateRecordConstructors(rootClassId, dae);
  }
  if (flattenedInWasm && dae.functions.size > 0) {
    const valueToArenaLit = (val: unknown, varType?: VarType): number => {
      if (typeof val === "number") {
        if (varType === VarType.Integer || varType === VarType.Enumeration) return dae.addIntLiteral(Math.trunc(val));
        if (varType === VarType.Boolean) return dae.addBoolLiteral(val !== 0);
        return dae.addRealLiteral(val);
      }
      if (typeof val === "boolean") return dae.addBoolLiteral(val);
      if (typeof val === "string") return dae.addStringLiteral(val);
      if (Array.isArray(val)) {
        const elems: number[] = [];
        for (const el of val) {
          const id = valueToArenaLit(el, varType);
          if (id < 0) return -1;
          elems.push(id);
        }
        return dae.addArrayCtorExpr(elems);
      }
      return -1;
    };
    const extractFieldFromEvalRes = (
      rootVal: unknown,
      relSuffix: string,
      posIdx: number,
      totalFieldCount: number,
    ): unknown => {
      if (
        Array.isArray(rootVal) &&
        !relSuffix.startsWith("[") &&
        !relSuffix.includes(".") &&
        !relSuffix.includes("[") &&
        totalFieldCount > 0 &&
        rootVal.length === totalFieldCount
      ) {
        return rootVal[posIdx];
      }
      let cur: unknown = rootVal;
      let path = relSuffix;
      while (path.length > 0) {
        if (path.startsWith(".")) {
          path = path.slice(1);
          continue;
        }
        if (path.startsWith("[")) {
          const closeIdx = path.indexOf("]");
          if (closeIdx < 0) return undefined;
          const idxParts = path
            .slice(1, closeIdx)
            .split(",")
            .map((s) => parseInt(s.trim(), 10));
          for (const idx1 of idxParts) {
            if (!Array.isArray(cur) || isNaN(idx1) || idx1 < 1 || idx1 > cur.length) return undefined;
            cur = cur[idx1 - 1];
          }
          path = path.slice(closeIdx + 1);
          continue;
        }
        const dotIdx = path.indexOf(".");
        const brkIdx = path.indexOf("[");
        let cutIdx = path.length;
        if (dotIdx >= 0 && dotIdx < cutIdx) cutIdx = dotIdx;
        if (brkIdx >= 0 && brkIdx < cutIdx) cutIdx = brkIdx;
        const seg = path.slice(0, cutIdx);
        path = path.slice(cutIdx);
        if (cur === null || typeof cur !== "object") return undefined;
        const container = cur as EvalFieldContainer;
        if (container.__kind === "object" && container.fields instanceof Map) {
          if (!container.fields.has(seg)) return undefined;
          cur = container.fields.get(seg);
        } else if (container.__fields instanceof Map) {
          const rem = seg + path;
          if (container.__fields.has(rem)) return container.__fields.get(rem);
          if (!container.__fields.has(seg)) return undefined;
          cur = container.__fields.get(seg);
        } else if (!Array.isArray(cur)) {
          if (!(seg in container)) return undefined;
          cur = container[seg];
        } else {
          return undefined;
        }
      }
      return cur;
    };
    const recNameToIdx = new Map<string, number>();
    for (let v = 0; v < dae.varCount; v++) {
      if (!dae.isVarRemoved(v)) recNameToIdx.set(dae.getVarName(v), v);
    }
    const markExprParamArgsEvaluated = (exprId: number, depth = 0): void => {
      if (exprId < 0 || depth > 24) return;
      const ek = dae.getExprKind(exprId);
      if (ek === ExprKind.Name) {
        const nm = dae.interner.resolve(dae.getExprData1(exprId));
        if (!nm) return;
        const vIdx = recNameToIdx.get(nm);
        if (
          vIdx !== undefined &&
          !dae.isVarRemoved(vIdx) &&
          dae.getVarVariability(vIdx) === Variability.Parameter &&
          dae.isVarFixed(vIdx)
        ) {
          if (!dae.isVarEvaluate(vIdx)) dae.setVarEvaluate(vIdx, true);
          if (!dae.isVarFinal(vIdx)) dae.setVarFinal(vIdx, true);
        } else if (vIdx === undefined) {
          const pfx = `${nm}.`;
          for (const [k, cIdx] of recNameToIdx) {
            if (
              k.startsWith(pfx) &&
              !dae.isVarRemoved(cIdx) &&
              dae.getVarVariability(cIdx) === Variability.Parameter &&
              dae.isVarFixed(cIdx)
            ) {
              if (!dae.isVarEvaluate(cIdx)) dae.setVarEvaluate(cIdx, true);
              if (!dae.isVarFinal(cIdx)) dae.setVarFinal(cIdx, true);
            }
          }
        }
        return;
      }
      if (ek === ExprKind.Call) {
        const argc = dae.getExprRight(exprId);
        for (let ai = 0; ai < argc; ai++) markExprParamArgsEvaluated(dae.getExprLeft(exprId + ai), depth + 1);
      } else if (ek === ExprKind.Binary) {
        markExprParamArgsEvaluated(dae.getExprLeft(exprId), depth + 1);
        markExprParamArgsEvaluated(dae.getExprRight(exprId), depth + 1);
      } else if (ek === ExprKind.Unary || ek === ExprKind.Negate) {
        markExprParamArgsEvaluated(dae.getExprLeft(exprId), depth + 1);
      } else if (ek === ExprKind.IfElse) {
        markExprParamArgsEvaluated(dae.getExprData1(exprId), depth + 1);
        markExprParamArgsEvaluated(dae.getExprLeft(exprId), depth + 1);
        markExprParamArgsEvaluated(dae.getExprRight(exprId), depth + 1);
      } else if (ek === ExprKind.ArrayCtor) {
        const cnt = dae.getExprData1(exprId);
        for (let i = 0; i < cnt; i++) markExprParamArgsEvaluated(dae.getExprLeft(exprId + i), depth + 1);
      }
    };
    let anyRecordFolded = false;
    for (let pass = 0; pass < 6; pass++) {
      let foldedAny = false;
      for (let e = 0; e < dae.eqCount; e++) {
        if (dae.isEqRemoved(e)) continue;
        if (dae.getEqKind(e) !== EqKind.Simple) continue;
        const l = dae.getEqLhs(e);
        const r = dae.getEqRhs(e);
        if (l < 0 || r < 0) continue;
        const rKind = dae.getExprKind(r);
        if (dae.getExprKind(l) !== ExprKind.Name || (rKind !== ExprKind.Call && rKind !== ExprKind.ArrayCtor)) continue;
        const recName = dae.interner.resolve(dae.getExprData1(l));
        if (!recName) continue;
        const dotPrefix = `${recName}.`;
        const arrPrefix = `${recName}[`;
        const fieldVars: { vIdx: number; relSuffix: string }[] = [];
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v)) continue;
          const vn = dae.getVarName(v);
          if (!vn.startsWith(dotPrefix) && !vn.startsWith(arrPrefix)) continue;
          const vb = dae.getVarVariability(v);
          if (vb !== Variability.Constant && vb !== Variability.Parameter) continue;
          fieldVars.push({
            vIdx: v,
            relSuffix: vn.startsWith(dotPrefix) ? vn.slice(dotPrefix.length) : vn.slice(recName.length),
          });
        }
        if (fieldVars.length === 0) continue;
        if (rKind === ExprKind.ArrayCtor && !fieldVars.some((fv) => fv.relSuffix.includes("."))) continue;
        const evalRes = evaluateConstantArenaExpression(dae, r, new Map(), recNameToIdx, 0, ctx.db, rootClassId, false);
        if (evalRes === null || evalRes === undefined) continue;
        let allOk = true;
        const litIds: number[] = [];
        const resolvedVals: unknown[] = [];
        for (let k = 0; k < fieldVars.length; k++) {
          const { vIdx, relSuffix } = fieldVars[k]!;
          const val = extractFieldFromEvalRes(evalRes, relSuffix, k, fieldVars.length);
          if (val === undefined && (dae.getVarExpression(vIdx) ?? -1) >= 0) {
            litIds.push(-1);
            resolvedVals.push(undefined);
            continue;
          }
          const litId = valueToArenaLit(val, dae.getVarType(vIdx));
          if (litId < 0) {
            allOk = false;
            break;
          }
          litIds.push(litId);
          resolvedVals.push(val);
        }
        if (allOk) {
          let hasEvaluatedField = false;
          for (let k = 0; k < fieldVars.length; k++) {
            const vIdx = fieldVars[k]!.vIdx;
            if (dae.isVarEvaluate(vIdx)) hasEvaluatedField = true;
            const lid = litIds[k]!;
            if (lid >= 0) {
              dae.setVarExpression(vIdx, lid);
              const ev = resolvedVals[k];
              if (typeof ev === "number") dae.setVarStartValue(vIdx, ev);
              else if (typeof ev === "boolean") dae.setVarStartValue(vIdx, ev ? 1.0 : 0.0);
            }
          }
          const rhsFnName =
            dae.getExprKind(r) === ExprKind.Call ? dae.interner.resolve(dae.getExprData1(r)) : undefined;
          const rhsFnDae = rhsFnName ? dae.functions.get(rhsFnName) : undefined;
          if (rhsFnDae) {
            for (let vi = 0; vi < rhsFnDae.varCount; vi++) {
              if (!rhsFnDae.isVarRemoved(vi) && rhsFnDae.getVarCausality(vi) === Causality.Output) {
                const outCt = rhsFnDae.getVarCustomType(vi);
                if (outCt) {
                  ((dae as DaeWithExtras).foldedRecordTypes ??= new Map<string, string>()).set(recName, outCt);
                }
                break;
              }
            }
          }
          if (hasEvaluatedField && !isOldFrontend) {
            markExprParamArgsEvaluated(r);
          }
          dae.removeEquation(e);
          foldedAny = true;
          anyRecordFolded = true;
        }
      }
      if (!foldedAny) break;
    }
    if (anyRecordFolded) {
      foldArenaConstants(dae, ctx.db, rootClassId, evalAllParams ? false : ctx.options.omcCompatibility);
    }
    for (const sec of dae.algorithmSections) {
      const end = sec.start + sec.count;
      let hasFoldableTuple = false;
      for (let s = sec.start; s < end; s++) {
        const sk = dae.getStmtKind(s);
        if (sk === StmtKind.ComplexAssignment) {
          const tcount = dae.getStmtData1(s);
          const rhs = dae.getStmtLeft(s);
          if (rhs >= 0 && dae.getExprKind(rhs) === ExprKind.Call) {
            const evalRes = evaluateConstantArenaExpression(
              dae,
              rhs,
              new Map(),
              new Map(),
              0,
              ctx.db,
              rootClassId,
              false,
            );
            if (Array.isArray(evalRes) && evalRes.length === tcount) {
              hasFoldableTuple = true;
              break;
            }
          }
          s += tcount;
          continue;
        }
        if (sk !== StmtKind.Assignment) continue;
        const lhs = dae.getStmtData1(s);
        const rhs = dae.getStmtLeft(s);
        if (lhs >= 0 && rhs >= 0 && dae.getExprKind(lhs) === ExprKind.Tuple && dae.getExprKind(rhs) === ExprKind.Call) {
          const evalRes = evaluateConstantArenaExpression(
            dae,
            rhs,
            new Map(),
            new Map(),
            0,
            ctx.db,
            rootClassId,
            false,
          );
          if (Array.isArray(evalRes) && evalRes.length === dae.getExprData1(lhs)) {
            hasFoldableTuple = true;
            break;
          }
        }
      }
      if (!hasFoldableTuple) continue;
      const newStart = dae.stmtCount;
      let newCount = 0;
      for (let s = sec.start; s < end; s++) {
        const sk = dae.getStmtKind(s);
        const d1 = dae.getStmtData1(s);
        const sl = dae.getStmtLeft(s);
        const sr = dae.getStmtRight(s);
        if (sk === StmtKind.ComplexAssignment && sl >= 0 && dae.getExprKind(sl) === ExprKind.Call) {
          const tcount = d1;
          const evalRes = evaluateConstantArenaExpression(dae, sl, new Map(), new Map(), 0, ctx.db, rootClassId, false);
          if (Array.isArray(evalRes) && evalRes.length === tcount) {
            let expandedAny = false;
            for (let k = 0; k < tcount; k++) {
              const targetExpr = dae.getStmtData1(s + 1 + k);
              if (targetExpr < 0) continue;
              if (dae.getExprKind(targetExpr) === ExprKind.Name) {
                const tName = dae.interner.resolve(dae.getExprData1(targetExpr));
                if (!tName || tName === "_") continue;
                const tVarIdx = dae.getVarIdxByName(tName);
                const litId = valueToArenaLit(evalRes[k], tVarIdx >= 0 ? dae.getVarType(tVarIdx) : undefined);
                if (litId >= 0) {
                  dae.addStatement(StmtKind.Assignment, targetExpr, litId);
                  newCount++;
                  expandedAny = true;
                }
              }
            }
            if (expandedAny) {
              s += tcount;
              continue;
            }
          }
          dae.addStatement(sk, d1, sl, sr);
          newCount++;
          for (let k = 0; k < tcount; k++) {
            const ts = s + 1 + k;
            dae.addStatement(dae.getStmtKind(ts), dae.getStmtData1(ts), dae.getStmtLeft(ts), dae.getStmtRight(ts));
            newCount++;
          }
          s += tcount;
          continue;
        }
        if (
          sk === StmtKind.Assignment &&
          d1 >= 0 &&
          sl >= 0 &&
          dae.getExprKind(d1) === ExprKind.Tuple &&
          dae.getExprKind(sl) === ExprKind.Call
        ) {
          const evalRes = evaluateConstantArenaExpression(dae, sl, new Map(), new Map(), 0, ctx.db, rootClassId, false);
          const tCount = dae.getExprData1(d1);
          if (Array.isArray(evalRes) && evalRes.length === tCount) {
            let expandedAny = false;
            for (let k = 0; k < tCount; k++) {
              const targetExpr = dae.getExprLeft(d1 + k);
              if (targetExpr < 0) continue;
              if (dae.getExprKind(targetExpr) === ExprKind.Name) {
                const tName = dae.interner.resolve(dae.getExprData1(targetExpr));
                if (!tName || tName === "_") continue;
                const tVarIdx = dae.getVarIdxByName(tName);
                const litId = valueToArenaLit(evalRes[k], tVarIdx >= 0 ? dae.getVarType(tVarIdx) : undefined);
                if (litId >= 0) {
                  dae.addStatement(StmtKind.Assignment, targetExpr, litId);
                  newCount++;
                  expandedAny = true;
                }
              }
            }
            if (expandedAny) continue;
          }
        }
        dae.addStatement(sk, d1, sl, sr);
        newCount++;
      }
      sec.start = newStart;
      sec.count = newCount;
    }
  }
  if (flattenedInWasm && isOldFrontend && preFoldNonArrayRhs.size > 0) {
    const isLiteralExpr = (eId: number): boolean => {
      const k = dae.getExprKind(eId);
      if (
        k === ExprKind.RealLiteral ||
        k === ExprKind.IntLiteral ||
        k === ExprKind.BoolLiteral ||
        k === ExprKind.StringLiteral ||
        k === ExprKind.EnumLiteral
      ) {
        return true;
      }
      if (k === ExprKind.Unary || k === ExprKind.Negate) {
        const inner = dae.getExprLeft(eId);
        return inner >= 0 && isLiteralExpr(inner);
      }
      if (k === ExprKind.ArrayCtor) {
        const cnt = dae.getExprData1(eId);
        for (let j = 0; j < cnt; j++) {
          if (!isLiteralExpr(dae.getExprLeft(eId + j))) return false;
        }
        return cnt > 0;
      }
      return false;
    };
    const expandFoldedArrayEq = (
      baseName: string,
      rhsExprId: number,
      targetKind: EqKind,
      flags: number,
      prefixIndices: number[],
    ): boolean => {
      if (dae.getExprKind(rhsExprId) !== ExprKind.ArrayCtor) return false;
      const n = dae.getExprData1(rhsExprId);
      if (n <= 0) return false;
      const firstElem = dae.getExprLeft(rhsExprId);
      if (dae.getExprKind(firstElem) === ExprKind.ArrayCtor) {
        for (let i = 0; i < n; i++) {
          if (
            !expandFoldedArrayEq(baseName, dae.getExprLeft(rhsExprId + i), targetKind, flags, [...prefixIndices, i + 1])
          ) {
            return false;
          }
        }
        return true;
      }
      const firstIdxStr = [...prefixIndices, 1].join(",");
      if (dae.getVarIdxByName(`${baseName}[${firstIdxStr}]`) < 0) return false;
      for (let i = 0; i < n; i++) {
        const idxStr = [...prefixIndices, i + 1].join(",");
        const lhsId = dae.addName(dae.interner.intern(`${baseName}[${idxStr}]`));
        dae.addEquation(targetKind, lhsId, dae.getExprLeft(rhsExprId + i), flags);
      }
      return true;
    };
    for (const eqIdx of preFoldNonArrayRhs) {
      if (dae.isEqRemoved(eqIdx)) continue;
      const l = dae.getEqLhs(eqIdx);
      const r = dae.getEqRhs(eqIdx);
      if (dae.getExprKind(l) !== ExprKind.Name || dae.getExprKind(r) !== ExprKind.ArrayCtor) continue;
      if (!isLiteralExpr(r)) continue;
      const baseName = dae.interner.resolve(dae.getExprData1(l));
      if (!baseName) continue;
      const ek = dae.getEqKind(eqIdx);
      const targetKind = ek === EqKind.InitialSimple ? EqKind.InitialSimple : EqKind.Simple;
      const flags = dae.getEqAux(eqIdx);
      if (expandFoldedArrayEq(baseName, r, targetKind, flags, [])) {
        dae.removeEquation(eqIdx);
      }
    }
  }
  if (flattenedInWasm && dae.functions.size > 0) {
    const multiOutputFns = new Set<string>();
    for (const [fnKey, fnDae] of dae.functions) {
      let outCount = 0;
      for (let v = 0; v < fnDae.varCount; v++) {
        if (fnDae.getVarCausality(v) === Causality.Output) outCount++;
      }
      const fnName = typeof fnKey === "number" ? dae.interner.resolve(fnKey) : fnKey;
      if (outCount > 1 && fnName) multiOutputFns.add(fnName);
    }
    if (multiOutputFns.size > 0) {
      const wrapMultiOutputCalls = (eId: number, depth = 0): number => {
        if (eId < 0 || depth > 24) return eId;
        const k = dae.getExprKind(eId);
        if (k === ExprKind.Call) {
          const fnNameId = dae.getExprData1(eId);
          const fnName = dae.interner.resolve(fnNameId);
          const argCount = dae.getExprRight(eId);
          let argsChanged = false;
          const newArgs: number[] = [];
          for (let ai = 0; ai < argCount; ai++) {
            const a = dae.getExprLeft(eId + ai);
            const na = wrapMultiOutputCalls(a, depth + 1);
            if (na !== a) argsChanged = true;
            newArgs.push(na);
          }
          const callId = argsChanged ? dae.addCallExpr(fnNameId, newArgs) : eId;
          if (fnName && multiOutputFns.has(fnName)) {
            return dae.addSubscript(callId, dae.addIntLiteral(1));
          }
          return callId;
        }
        if (k === ExprKind.Subscript) {
          const base = dae.getExprData1(eId);
          const subCount = dae.getExprRight(eId);
          const newBase =
            dae.getExprKind(base) === ExprKind.Call &&
            multiOutputFns.has(dae.interner.resolve(dae.getExprData1(base)) ?? "")
              ? base
              : wrapMultiOutputCalls(base, depth + 1);
          let subChanged = newBase !== base;
          const newSubs: number[] = [];
          for (let si = 0; si < subCount; si++) {
            const sId = dae.getExprLeft(eId + si);
            const nsId = wrapMultiOutputCalls(sId, depth + 1);
            if (nsId !== sId) subChanged = true;
            newSubs.push(nsId);
          }
          if (subChanged) {
            return dae.addSubscriptExpr(newBase, newSubs);
          }
          return eId;
        }
        if (k === ExprKind.Unary) {
          const l = dae.getExprLeft(eId);
          const nl = wrapMultiOutputCalls(l, depth + 1);
          return nl !== l ? dae.addUnaryExpr(dae.getExprData1(eId), nl) : eId;
        }
        if (k === ExprKind.Binary) {
          const l = dae.getExprLeft(eId);
          const r = dae.getExprRight(eId);
          const nl = wrapMultiOutputCalls(l, depth + 1);
          const nr = wrapMultiOutputCalls(r, depth + 1);
          return nl !== l || nr !== r ? dae.addBinaryExpr(dae.getExprData1(eId), nl, nr) : eId;
        }
        if (k === ExprKind.ArrayCtor) {
          const cnt = dae.getExprData1(eId);
          let changed = false;
          const elems: number[] = [];
          for (let j = 0; j < cnt; j++) {
            const el = dae.getExprLeft(eId + j);
            const nel = wrapMultiOutputCalls(el, depth + 1);
            if (nel !== el) changed = true;
            elems.push(nel);
          }
          return changed ? dae.addArrayCtorExpr(elems) : eId;
        }
        if (k === ExprKind.IfElse) {
          const c = dae.getExprData1(eId);
          const t = dae.getExprLeft(eId);
          const f = dae.getExprRight(eId);
          const nc = wrapMultiOutputCalls(c, depth + 1);
          const nt = wrapMultiOutputCalls(t, depth + 1);
          const nf = wrapMultiOutputCalls(f, depth + 1);
          return nc !== c || nt !== t || nf !== f ? dae.addIfElseExpr(nc, nt, nf) : eId;
        }
        return eId;
      };
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const b = dae.getVarExpression(v) ?? -1;
        if (b >= 0) {
          const nb = wrapMultiOutputCalls(b);
          if (nb !== b) dae.setVarExpression(v, nb);
        }
      }
      for (let i = 0; i < dae.eqCount; i++) {
        if (dae.isEqRemoved(i)) continue;
        const ek = dae.getEqKind(i);
        if (ek === EqKind.Simple || ek === EqKind.InitialSimple || ek === EqKind.Array) {
          const l = dae.getEqLhs(i);
          const r = dae.getEqRhs(i);
          if (l >= 0 && r >= 0 && dae.getExprKind(l) === ExprKind.Tuple && dae.getExprKind(r) === ExprKind.Call) {
            continue;
          }
          if (l >= 0) {
            const nl = wrapMultiOutputCalls(l);
            if (nl !== l) dae.setEqLhs(i, nl);
          }
          if (r >= 0) {
            const nr = wrapMultiOutputCalls(r);
            if (nr !== r) dae.setEqRhs(i, nr);
          }
        }
      }
      const wrapIfEqList = (
        eqs: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[] | undefined,
      ) => {
        if (!eqs) return;
        for (const eq of eqs) {
          if (
            eq.lhsExprId >= 0 &&
            eq.rhsExprId >= 0 &&
            dae.getExprKind(eq.lhsExprId) === ExprKind.Tuple &&
            dae.getExprKind(eq.rhsExprId) === ExprKind.Call
          ) {
            continue;
          }
          if (eq.lhsExprId >= 0) eq.lhsExprId = wrapMultiOutputCalls(eq.lhsExprId);
          if (eq.rhsExprId >= 0) eq.rhsExprId = wrapMultiOutputCalls(eq.rhsExprId);
        }
      };
      for (let i = 0; i < dae.eqCount; i++) {
        if (dae.getEqKind(i) !== EqKind.If) continue;
        const meta = dae.getIfEquationMeta(i);
        if (!meta) continue;
        if (meta.conditionExprId >= 0) meta.conditionExprId = wrapMultiOutputCalls(meta.conditionExprId);
        wrapIfEqList(meta.thenEquations);
        for (const ei of meta.elseIfClauses) {
          if (ei.conditionExprId >= 0) ei.conditionExprId = wrapMultiOutputCalls(ei.conditionExprId);
          wrapIfEqList(ei.bodyEquations);
        }
        wrapIfEqList(meta.elseEquations);
      }
      // Single-variable assignment in algorithm section from multi-output function: `a := f(...)` -> `a := f(...)[1]`
      for (const sec of dae.algorithmSections) {
        const end = sec.start + sec.count;
        for (let s = sec.start; s < end; s++) {
          if (dae.getStmtKind(s) !== StmtKind.Assignment) continue;
          const lhs = dae.getStmtData1(s);
          const rhs = dae.getStmtLeft(s);
          if (lhs < 0 || rhs < 0) continue;
          if (dae.getExprKind(lhs) === ExprKind.Tuple && dae.getExprKind(rhs) === ExprKind.Call) continue;
          const nr = wrapMultiOutputCalls(rhs);
          if (nr !== rhs) dae.setStmtLeft(s, nr);
        }
      }
    }
    // Expand 1D array variable names in folded Tuple-LHS equations in oldInst mode (e.g. `(b, z) = ({...}, 0.0)` -> `({b[1], ...}, z) = ...`)
    if (isOldFrontend) {
      for (let i = 0; i < dae.eqCount; i++) {
        if (dae.isEqRemoved(i)) continue;
        const l = dae.getEqLhs(i);
        const r = dae.getEqRhs(i);
        if (dae.getExprKind(l) !== ExprKind.Tuple || dae.getExprKind(r) !== ExprKind.Tuple) continue;
        const lCnt = dae.getExprData1(l);
        const rCnt = dae.getExprData1(r);
        if (lCnt <= 0 || lCnt !== rCnt) continue;
        let changedTuple = false;
        const newElems: number[] = [];
        for (let j = 0; j < lCnt; j++) {
          const le = dae.getExprLeft(l + j);
          const re = dae.getExprLeft(r + j);
          if (dae.getExprKind(le) === ExprKind.Name && dae.getExprKind(re) === ExprKind.ArrayCtor) {
            const baseName = dae.interner.resolve(dae.getExprData1(le));
            const arrLen = dae.getExprData1(re);
            if (
              baseName &&
              arrLen > 0 &&
              dae.getVarIdxByName(baseName) < 0 &&
              dae.getVarIdxByName(`${baseName}[1]`) >= 0 &&
              dae.getVarIdxByName(`${baseName}[${arrLen}]`) >= 0
            ) {
              const arrElems: number[] = [];
              for (let k = 1; k <= arrLen; k++) {
                arrElems.push(dae.addName(dae.interner.intern(`${baseName}[${k}]`)));
              }
              newElems.push(dae.addArrayCtorExpr(arrElems));
              changedTuple = true;
              continue;
            }
          }
          newElems.push(le);
        }
        if (changedTuple) {
          dae.setEqLhs(i, dae.addTupleExpr(newElems));
        }
      }
    }
  }
}
