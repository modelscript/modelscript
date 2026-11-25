// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Post-instantiation DAE passes: array connect expansion, pending foreign defaults,
 * structural parameter finalization, operator-record equation bridge, constant folding,
 * post-fold simplifications, and array scalarization / preservation.
 */

import { ExprKind } from "@modelscript/dsl";
import {
  BinOp,
  Causality,
  type DAEBuilder,
  EqKind,
  evaluateConstantArenaExpression,
  foldArenaConstants,
  scalarizeArena,
  StmtKind,
  type SymbolEntry,
  type SymbolId,
  UnaryOp,
  VarAttrKind,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { expandConnectorRef } from "../elaboration/index.js";
import { simplifyTrigonometricBinary } from "../expressions/binary-ops.js";
import { getFlatteningState } from "../support/state.js";
import { extractNamedOrModArgValueCst } from "./cst-token-helpers.js";
import type { ClassFlattenerContext, ComponentInstanceQueryData, CstNodeLike, DaeWithExtras } from "./types.js";

export interface PostInstantiationParams {
  ctx: ClassFlattenerContext;
  rootClassId: SymbolId;
  dae: DAEBuilder;
  rootSym: SymbolEntry | null | undefined;
  flattenedInWasm: boolean;
  layer2EqStartIdx: number;
  isOldFrontend: boolean;
}

export interface PostInstantiationResult {
  evalAllParams: boolean;
  preFoldNonArrayRhs: Set<number>;
}

export function runPostInstantiationPasses(params: PostInstantiationParams): PostInstantiationResult {
  const { ctx, rootClassId, dae, rootSym, flattenedInWasm, layer2EqStartIdx, isOldFrontend } = params;
  const expandArrayConnectEquations = (builder: DAEBuilder) => {
    const origEqCount = builder.eqCount;
    for (let i = 0; i < origEqCount; i++) {
      if (builder.getEqKind(i) === EqKind.Connect) {
        const l = builder.getEqLhs(i);
        const r = builder.getEqRhs(i);
        const flags = builder.getEqAux(i);
        if (builder.getExprKind(l) === ExprKind.Name && builder.getExprKind(r) === ExprKind.Name) {
          const lName = builder.interner.resolve(builder.getExprData1(l));
          const rName = builder.interner.resolve(builder.getExprData1(r));
          if (lName && rName) {
            const lExp = expandConnectorRef(lName, builder);
            const rExp = expandConnectorRef(rName, builder);
            if (
              lExp.length >= 1 &&
              lExp.length === rExp.length &&
              (lExp.length > 1 || lExp[0] !== lName || rExp[0] !== rName)
            ) {
              const l0 = builder.addName(builder.interner.intern(lExp[0]!));
              const r0 = builder.addName(builder.interner.intern(rExp[0]!));
              builder.setEqLhs(i, l0);
              builder.setEqRhs(i, r0);
              for (let k = 1; k < lExp.length; k++) {
                const lk = builder.addName(builder.interner.intern(lExp[k]!));
                const rk = builder.addName(builder.interner.intern(rExp[k]!));
                builder.addEquation(EqKind.Connect, lk, rk, flags);
              }
            }
          }
        }
      }
    }
  };

  expandArrayConnectEquations(dae);

  const pendingForeignDefaults = (dae.extensionMetadata as Record<string, unknown>)["__pendingForeignInputDefaults"] as
    Array<{ varName: string; rhsExprId: number }> | undefined;
  if (pendingForeignDefaults && pendingForeignDefaults.length > 0) {
    delete (dae.extensionMetadata as Record<string, unknown>)["__pendingForeignInputDefaults"];
    const externallyDrivenVars = new Set<string>();
    for (let eqIdx = layer2EqStartIdx; eqIdx < dae.eqCount; eqIdx++) {
      const kind = dae.getEqKind(eqIdx);
      const l = dae.getEqLhs(eqIdx);
      const r = dae.getEqRhs(eqIdx);
      if (kind === EqKind.Connect) {
        if (l >= 0 && dae.getExprKind(l) === ExprKind.Name) {
          const ln = dae.interner.resolve(dae.getExprData1(l));
          if (ln) externallyDrivenVars.add(ln);
        }
        if (r >= 0 && dae.getExprKind(r) === ExprKind.Name) {
          const rn = dae.interner.resolve(dae.getExprData1(r));
          if (rn) externallyDrivenVars.add(rn);
        }
      } else if (kind === EqKind.Simple) {
        if (l >= 0 && dae.getExprKind(l) === ExprKind.Name) {
          const ln = dae.interner.resolve(dae.getExprData1(l));
          if (ln) externallyDrivenVars.add(ln);
        }
      }
    }
    for (const def of pendingForeignDefaults) {
      if (!externallyDrivenVars.has(def.varName)) {
        dae.addEquation(EqKind.Simple, dae.addNameExpr(def.varName), def.rhsExprId);
      }
    }
  }

  const resolvedRecordValCache = new Map<string, number | null>();
  const rootComponentsMap = new Map<string, SymbolEntry>();
  for (const s of ctx.db.childrenOf(rootClassId)) {
    if (s.kind === "Component") rootComponentsMap.set(s.name, s);
  }
  if (rootSym?.resourceId) {
    for (const s of ctx.getFileSymbols(rootSym.resourceId)) {
      if (s.kind === "Component" && !rootComponentsMap.has(s.name)) {
        rootComponentsMap.set(s.name, s);
      }
    }
  }

  for (let vIdx = 0; vIdx < dae.varCount; vIdx++) {
    let exprId = dae.getVarExpression(vIdx);
    if (exprId === undefined || exprId < 0 || exprId === 0xffffffff) continue;
    let innerId = exprId;
    if (dae.getExprKind(innerId) === ExprKind.Call && dae.interner.resolve(dae.getExprData1(innerId)) === "/*Real*/") {
      innerId = dae.getExprLeft(innerId);
    }
    if (innerId >= 0) {
      let refName = "";
      if (dae.getExprKind(innerId) === ExprKind.Name) {
        refName = dae.interner.resolve(dae.getExprData1(innerId)) || "";
      } else {
        const vName = dae.getVarName(vIdx);
        if (!vName.includes(".") && !vName.includes("[")) {
          const vEntry = rootComponentsMap.get(vName);
          if (vEntry) {
            const compInst = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", vEntry.id);
            const rawVal = compInst?.modification?.value?.text?.trim();
            if (rawVal && rawVal.includes(".")) refName = rawVal;
          }
        }
      }
      if (refName && refName.includes(".")) {
        let num = resolvedRecordValCache.get(refName);
        if (num === undefined) {
          num = null;
          const parts = refName.split(".");
          if (parts.length >= 3) {
            const pkgName = parts[0]!;
            const bIdx1 = parts[1]!.indexOf("[");
            const compName = bIdx1 >= 0 ? parts[1]!.slice(0, bIdx1) : parts[1]!;
            const pkgSym = ctx.db.byName(pkgName).find((e) => e.kind === "Package" || e.kind === "Class");
            const compSym = pkgSym
              ? ctx.db.childrenOf(pkgSym.id).find((c) => c.kind === "Component" && c.name === compName)
              : null;
            if (compSym) {
              const compInst = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", compSym.id);
              const bIdx2 = parts[2]!.indexOf("[");
              const firstField = bIdx2 >= 0 ? parts[2]!.slice(0, bIdx2) : parts[2]!;
              const arg = compInst?.modification?.args?.find((a) => a.name === firstField);
              let valText: string | undefined = arg?.value?.text?.trim();
              for (let pIdx = 3; pIdx < parts.length && valText; pIdx++) {
                const bIdxSub = parts[pIdx]!.indexOf("[");
                const subField = bIdxSub >= 0 ? parts[pIdx]!.slice(0, bIdxSub) : parts[pIdx]!;
                valText = extractNamedOrModArgValueCst(valText, subField);
              }
              if (valText !== undefined) {
                const parsed = Number(valText);
                if (!Number.isNaN(parsed)) {
                  num = parsed;
                }
              }
            }
          }
          resolvedRecordValCache.set(refName, num);
        }
        if (num !== null) {
          const vType = dae.getVarType(vIdx);
          const newExprId = vType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
          dae.setVarExpression(vIdx, newExprId);
        }
      }
    }
  }

  // 2.4b Propagate `final` across structural parameter dependencies & array siblings (newInst)
  // and honor `-d=evaluateAllParameters` when present on the root class annotation.
  let evalAllParams = false;
  if (flattenedInWasm && !isOldFrontend) {
    const rootCstForOpts = ctx.db.cstNode(rootClassId) as CstNodeLike | null;
    evalAllParams = Boolean(rootCstForOpts?.text?.includes("evaluateAllParameters"));
    if (evalAllParams) {
      dae.extensionMetadata = { ...dae.extensionMetadata, evaluateAllParameters: true };
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        if (dae.getVarVariability(v) === Variability.Parameter && (dae.getVarExpression(v) ?? -1) >= 0) {
          dae.setVarFinal(v, true);
        }
      }
    } else {
      const paramByName = new Map<string, number>();
      const arrayParamsByBase = new Map<string, number[]>();
      const worklist: number[] = [];
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v) || dae.getVarVariability(v) !== Variability.Parameter) continue;
        const vName = dae.getVarName(v);
        paramByName.set(vName, v);
        const lb = vName.indexOf("[");
        if (lb > 0) {
          const base = vName.slice(0, lb);
          let list = arrayParamsByBase.get(base);
          if (!list) {
            list = [];
            arrayParamsByBase.set(base, list);
          }
          list.push(v);
        }
        if (dae.isVarEvaluate(v)) worklist.push(v);
      }
      const collectExprParamRefs = (exprId: number, depth: number) => {
        if (exprId < 0 || exprId >= dae.exprCount || depth > 24) return;
        const k = dae.getExprKind(exprId);
        if (k === ExprKind.Name) {
          const refName = dae.interner.resolve(dae.getExprData1(exprId));
          if (refName) {
            const targetIdx = paramByName.get(refName);
            if (targetIdx !== undefined && !dae.isVarFinal(targetIdx)) {
              dae.setVarFinal(targetIdx, true);
              worklist.push(targetIdx);
            }
          }
          return;
        }
        if (k === ExprKind.Binary) {
          collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
          collectExprParamRefs(dae.getExprRight(exprId), depth + 1);
        } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
          collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
        } else if (k === ExprKind.IfElse) {
          collectExprParamRefs(dae.getExprData1(exprId), depth + 1);
          collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
          collectExprParamRefs(dae.getExprRight(exprId), depth + 1);
        } else if (k === ExprKind.ArrayCtor || k === ExprKind.Tuple) {
          const cnt = dae.getExprData1(exprId);
          for (let i = 0; i < cnt; i++) {
            collectExprParamRefs(dae.getExprLeft(exprId + i), depth + 1);
          }
        } else if (k === ExprKind.Call) {
          const cnt = dae.getExprRight(exprId);
          if (cnt > 0) {
            collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
            for (let i = 1; i < cnt; i++) {
              collectExprParamRefs(dae.getExprLeft(exprId + i), depth + 1);
            }
          }
        }
      };
      while (worklist.length > 0) {
        const v = worklist.pop()!;
        const bExpr = dae.getVarExpression(v) ?? -1;
        if (bExpr >= 0) collectExprParamRefs(bExpr, 0);
        const vName = dae.getVarName(v);
        const lb = vName.indexOf("[");
        if (lb > 0) {
          const siblings = arrayParamsByBase.get(vName.slice(0, lb));
          if (siblings) {
            for (const s of siblings) {
              if (!dae.isVarFinal(s)) {
                dae.setVarFinal(s, true);
                worklist.push(s);
              }
            }
          }
        }
      }
      const rootText: string = rootCstForOpts?.text ?? "";
      if (rootText.includes("Connections.potentialRoot")) {
        const prRe = /Connections\.potentialRoot\s*\([^,]+,\s*([A-Za-z_]\w*)\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = prRe.exec(rootText)) !== null) {
          const pIdx = paramByName.get(m[1]!);
          if (pIdx !== undefined && !dae.isVarFinal(pIdx)) {
            dae.setVarFinal(pIdx, true);
          }
        }
      }
      if (/\b(?:ones|zeros|identity|fill)\s*\(/.test(rootText)) {
        const acRe = /\b(ones|zeros|identity|fill)\s*\(([^)]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = acRe.exec(rootText)) !== null) {
          const fn = m[1]!;
          const args = m[2]!.split(",").map((s) => s.trim());
          const startArg = fn === "fill" ? 1 : 0;
          for (let ai = startArg; ai < args.length; ai++) {
            const pIdx = paramByName.get(args[ai]!);
            if (pIdx !== undefined && !dae.isVarFinal(pIdx)) {
              dae.setVarFinal(pIdx, true);
            }
          }
        }
      }
    }
  }

  // 2.4c Operator-record equation bridge: WASM does not dispatch overloaded operator record
  // binary/unary/constructor calls yet; re-extract equations via TS when rootClassId has
  // components of an `operator record` type so overloaded calls and functions are emitted.
  if (flattenedInWasm) {
    let hasOperatorRecordComp = false;
    for (const ch of ctx.db.childrenOf(rootClassId)) {
      if (ch.kind !== "Component") continue;
      const tName = (ch.metadata?.["typeSpecifier"] as string) ?? (ch.metadata?.["typeName"] as string) ?? "";
      if (!tName || tName === "Real" || tName === "Integer" || tName === "Boolean" || tName === "String") continue;
      const resolveSimple = ctx.db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", rootClassId);
      const tSym =
        resolveSimple?.(tName.split(".")[0]!) ??
        ctx.db.byName(tName).find((e) => e.kind === "Class" || e.kind === "Package") ??
        null;
      if (tSym) {
        const pfx = `${tSym.metadata?.["classPrefixes"] ?? ""} ${tSym.metadata?.["classKind"] ?? ""}`;
        const tCst = ctx.db.cstNode(tSym.id) as { text?: string } | null;
        if (
          /\boperator\s+record\b/.test(pfx) ||
          (tCst?.text && /^\s*(?:encapsulated\s+)?operator\s+record\b/.test(tCst.text.trim()))
        ) {
          hasOperatorRecordComp = true;
          break;
        }
      }
    }
    if (hasOperatorRecordComp) {
      const rootCstOp = ctx.db.cstNode(rootClassId) as { text?: string } | null;
      if (rootCstOp?.text && /\bequation\b/.test(rootCstOp.text)) {
        for (let i = 0; i < dae.eqCount; i++) {
          dae.markEqRemoved(i);
        }
        dae.functions.clear();
        ctx.currentRootClassId = rootClassId;
        ctx.extractClassEquations(rootClassId, "", dae);
      }
    }
  }

  // 2.5 Fold constants on initial DAE so parameters, dimensions, and expressions are resolved
  // Pad partial tuple LHS in equations calling multi-output user functions before folding
  // (e.g. `Z2 = f(...)` -> `(Z2, _) = f(...)` so constant folding extracts Z2 = {1.0, 2.0})
  const paddedSingleLhsMultiOutEqs = new Set<number>();
  if (flattenedInWasm && dae.functions.size > 0) {
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.isEqRemoved(i)) continue;
      const ek = dae.getEqKind(i);
      if (ek !== EqKind.Simple && ek !== EqKind.Array && ek !== EqKind.InitialSimple) continue;
      const r = dae.getEqRhs(i);
      if (dae.getExprKind(r) !== ExprKind.Call) continue;
      const fnName = dae.interner.resolve(dae.getExprData1(r));
      const fnDae = fnName ? dae.functions.get(fnName) : undefined;
      if (!fnDae) continue;
      let outCount = 0;
      for (let v = 0; v < fnDae.varCount; v++) {
        if (fnDae.getVarCausality(v) === Causality.Output) outCount++;
      }
      if (outCount <= 1) continue;
      const l = dae.getEqLhs(i);
      const lk = dae.getExprKind(l);
      if (lk === ExprKind.Name) {
        const elems: number[] = [l];
        const wcId = dae.interner.intern("_");
        while (elems.length < outCount) elems.push(dae.addName(wcId));
        dae.setEqLhs(i, dae.addTupleExpr(elems));
        paddedSingleLhsMultiOutEqs.add(i);
      } else if (lk === ExprKind.Tuple) {
        const curCount = dae.getExprData1(l);
        if (curCount > 0 && curCount < outCount) {
          const elems: number[] = [];
          for (let j = 0; j < curCount; j++) elems.push(dae.getExprLeft(l + j));
          const wcId = dae.interner.intern("_");
          while (elems.length < outCount) elems.push(dae.addName(wcId));
          dae.setEqLhs(i, dae.addTupleExpr(elems));
        }
      }
    }
  }
  // Pad missing trailing default arguments on calls to user-defined DAE functions BEFORE folding
  // (e.g. `g(1.0)` -> `g(1.0, p)` so foldArenaConstants sees non-constant `p` and does not fold `g(1.0)` to 1.0)
  if (flattenedInWasm && dae.functions.size > 0) {
    const exprRefsFormalParam = (src: DAEBuilder, exprId: number, formalNames: Set<string>, depth = 0): boolean => {
      if (exprId < 0 || depth > 16) return false;
      const k = src.getExprKind(exprId);
      if (k === ExprKind.Name) {
        const n = src.interner.resolve(src.getExprData1(exprId));
        if (!n) return false;
        const root = n.split(/[.[]/)[0]!;
        return formalNames.has(n) || formalNames.has(root);
      }
      if (k === ExprKind.Unary) return exprRefsFormalParam(src, src.getExprLeft(exprId), formalNames, depth + 1);
      if (k === ExprKind.Binary) {
        return (
          exprRefsFormalParam(src, src.getExprLeft(exprId), formalNames, depth + 1) ||
          exprRefsFormalParam(src, src.getExprRight(exprId), formalNames, depth + 1)
        );
      }
      if (k === ExprKind.Subscript) {
        if (exprRefsFormalParam(src, src.getExprData1(exprId), formalNames, depth + 1)) return true;
        const cnt = src.getExprRight(exprId);
        for (let s = 0; s < cnt; s++) {
          if (exprRefsFormalParam(src, src.getExprLeft(exprId + s), formalNames, depth + 1)) return true;
        }
      }
      return false;
    };
    const copyExprFromFn = (src: DAEBuilder, exprId: number, depth = 0): number => {
      if (exprId < 0 || depth > 16) return -1;
      const k = src.getExprKind(exprId);
      if (k === ExprKind.RealLiteral) return dae.addRealLiteral(src.getExprRealValue(exprId));
      if (k === ExprKind.IntLiteral) return dae.addIntLiteral(src.getExprData1(exprId));
      if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(src.getExprData1(exprId) !== 0);
      if (k === ExprKind.StringLiteral) {
        const s = src.interner.resolve(src.getExprData1(exprId));
        return dae.addStringLiteral(s ?? "");
      }
      if (k === ExprKind.Name) {
        const n = src.interner.resolve(src.getExprData1(exprId));
        return n ? dae.addName(dae.interner.intern(n)) : -1;
      }
      if (k === ExprKind.Unary) {
        const sub = copyExprFromFn(src, src.getExprLeft(exprId), depth + 1);
        return sub >= 0 ? dae.addUnaryExpr(src.getExprData1(exprId), sub) : -1;
      }
      if (k === ExprKind.Binary) {
        const l = copyExprFromFn(src, src.getExprLeft(exprId), depth + 1);
        const r = copyExprFromFn(src, src.getExprRight(exprId), depth + 1);
        return l >= 0 && r >= 0 ? dae.addBinaryExpr(src.getExprData1(exprId), l, r) : -1;
      }
      return -1;
    };
    const padCallDefaultArgs = (exprId: number): number => {
      if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return exprId;
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      const fnDae = fnName ? dae.functions.get(fnName) : undefined;
      if (!fnDae) return exprId;
      const inputVars: number[] = [];
      const formalNames = new Set<string>();
      for (let vi = 0; vi < fnDae.varCount; vi++) {
        if (!fnDae.isVarRemoved(vi) && fnDae.getVarCausality(vi) === Causality.Input) {
          inputVars.push(vi);
          formalNames.add(fnDae.getVarName(vi));
        }
      }
      const argCount = dae.getExprRight(exprId);
      if (argCount >= inputVars.length) return exprId;
      const args: number[] = [];
      for (let ai = 0; ai < argCount; ai++) {
        args.push(ai === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + ai));
      }
      for (let ai = argCount; ai < inputVars.length; ai++) {
        const defExpr = fnDae.getVarExpression(inputVars[ai]!) ?? -1;
        if (defExpr < 0) return exprId;
        if (exprRefsFormalParam(fnDae, defExpr, formalNames)) return exprId;
        const copied = copyExprFromFn(fnDae, defExpr);
        if (copied < 0) return exprId;
        args.push(copied);
      }
      return dae.addCallExpr(dae.getExprData1(exprId), args);
    };
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      const b = dae.getVarExpression(v) ?? -1;
      if (b >= 0 && dae.getExprKind(b) === ExprKind.Call) {
        const padded = padCallDefaultArgs(b);
        if (padded !== b) dae.setVarExpression(v, padded);
        // Subscript scalarized array-element bindings calling an array-returning function (e.g. `x[1] = f(n)` -> `x[1] = f(n)[1]`)
        const curB = padded;
        const vName = dae.getVarName(v);
        const lb = vName.lastIndexOf("[");
        if (lb > 0 && vName.endsWith("]")) {
          const fnName = dae.interner.resolve(dae.getExprData1(curB));
          const fnDae = fnName ? dae.functions.get(fnName) : undefined;
          if (fnDae) {
            let outVar = -1;
            for (let fi = 0; fi < fnDae.varCount; fi++) {
              if (!fnDae.isVarRemoved(fi) && fnDae.getVarCausality(fi) === Causality.Output) {
                outVar = fi;
                break;
              }
            }
            if (outVar >= 0 && (fnDae.getVarShape(outVar).length > 0 || fnDae.getVarShapeExprs(outVar).length > 0)) {
              const idxParts = vName
                .slice(lb + 1, -1)
                .split(",")
                .map((s) => parseInt(s.trim(), 10));
              if (idxParts.length > 0 && idxParts.every((n) => Number.isFinite(n) && n >= 1)) {
                const subIds = idxParts.map((n) => dae.addIntLiteral(n));
                dae.setVarExpression(v, dae.addSubscriptExpr(curB, subIds));
              }
            }
          }
        }
      }
    }
    for (let e = 0; e < dae.eqCount; e++) {
      if (dae.isEqRemoved(e)) continue;
      const r = dae.getEqRhs(e);
      if (r >= 0 && dae.getExprKind(r) === ExprKind.Call) {
        const padded = padCallDefaultArgs(r);
        if (padded !== r) dae.setEqRhs(e, padded);
      }
    }
  }
  const preFoldNonArrayRhs = new Set<number>();
  if (flattenedInWasm && isOldFrontend) {
    for (let i = 0; i < dae.eqCount; i++) {
      const ek = dae.getEqKind(i);
      if (ek !== EqKind.Simple && ek !== EqKind.InitialSimple) continue;
      const l = dae.getEqLhs(i);
      const r = dae.getEqRhs(i);
      if (l >= 0 && r >= 0 && dae.getExprKind(l) === ExprKind.Name) {
        const rk = dae.getExprKind(r);
        if (rk === ExprKind.Call || rk === ExprKind.Subscript) {
          preFoldNonArrayRhs.add(i);
        }
      }
    }
  }
  const preFoldCallBindings = new Set<number>();
  if (flattenedInWasm) {
    for (let vi = 0; vi < dae.varCount; vi++) {
      const b = dae.getVarAttrExpr(vi, VarAttrKind.Binding);
      if (b >= 0 && dae.getExprKind(b) === ExprKind.Call) {
        preFoldCallBindings.add(vi);
      }
    }
  }
  foldArenaConstants(dae, ctx.db, rootClassId, evalAllParams ? false : ctx.options.omcCompatibility);
  if (flattenedInWasm) {
    for (let vi = 0; vi < dae.varCount; vi++) {
      const b = dae.getVarAttrExpr(vi, VarAttrKind.Binding);
      if (b < 0) continue;
      const bk = dae.getExprKind(b);
      // Multi-output function call in scalar binding context (FunctionMultiOutput3, FunctionMultiReturn)
      if (bk === ExprKind.ArrayCtor && preFoldCallBindings.has(vi)) {
        const vName = dae.getVarName(vi);
        if (!vName.includes("[") && dae.getExprData1(b) > 0) {
          const elem0 = dae.getExprLeft(b);
          if (elem0 >= 0) {
            dae.setVarAttrExpr(vi, VarAttrKind.Binding, elem0);
          }
        }
      } else if (bk === ExprKind.Binary) {
        const l = dae.getExprLeft(b);
        const r = dae.getExprRight(b);
        if (
          l >= 0 &&
          r >= 0 &&
          dae.getExprKind(l) === ExprKind.StringLiteral &&
          dae.getExprKind(r) === ExprKind.StringLiteral
        ) {
          const ls = dae.interner.resolve(dae.getExprData1(l)) ?? "";
          const rs = dae.interner.resolve(dae.getExprData1(r)) ?? "";
          const op = dae.getExprData1(b);
          let res: boolean | null = null;
          if (op === BinOp.Lt) res = ls < rs;
          else if (op === BinOp.Lte) res = ls <= rs;
          else if (op === BinOp.Gt) res = ls > rs;
          else if (op === BinOp.Gte) res = ls >= rs;
          else if (op === BinOp.Eq) res = ls === rs;
          else if (op === BinOp.Neq) res = ls !== rs;
          if (res !== null) {
            dae.setVarAttrExpr(vi, VarAttrKind.Binding, dae.addBoolLiteral(res));
          }
        }
      } else if (bk === ExprKind.Call && dae.getExprRight(b) === 1) {
        const fnName = dae.interner.resolve(dae.getExprData1(b)) ?? "";
        if (fnName === "min" || fnName === ".min" || fnName === "max" || fnName === ".max") {
          const a0 = dae.getExprLeft(b);
          let isEmptyArg = false;
          if (a0 >= 0) {
            const a0k = dae.getExprKind(a0);
            if (a0k === ExprKind.ArrayCtor && dae.getExprData1(a0) === 0) {
              isEmptyArg = true;
            } else if (a0k === ExprKind.Name) {
              const argName = dae.interner.resolve(dae.getExprData1(a0)) ?? "";
              if (argName && dae.getVarIdxByName(argName) < 0) {
                let hasElem = false;
                const pfx = `${argName}[`;
                for (let k = 0; k < dae.varCount; k++) {
                  if (!dae.isVarRemoved(k) && dae.getVarName(k).startsWith(pfx)) {
                    hasElem = true;
                    break;
                  }
                }
                if (!hasElem) isEmptyArg = true;
              }
            }
          }
          if (isEmptyArg) {
            const isMin = fnName === "min" || fnName === ".min";
            const vt = dae.getVarType(vi);
            let folded = -1;
            if (vt === VarType.Real) {
              folded = dae.addRealLiteral(isMin ? 8.777798510069901e304 : -8.777798510069901e304);
            } else if (vt === VarType.Integer) {
              folded = dae.addName(dae.interner.intern(isMin ? "4611686018427387903" : "-4611686018427387903"));
            } else if (vt === VarType.Boolean) {
              folded = dae.addBoolLiteral(isMin);
            } else if (vt === VarType.Enumeration) {
              const rawLits = dae.getVarEnumerationLiterals(vi);
              const lits = rawLits?.map((l: string | { stringValue?: string }) =>
                typeof l === "string" ? l : String(l?.stringValue ?? l),
              );
              if (lits && lits.length > 0) {
                const chosenLit = isMin ? lits[lits.length - 1]! : lits[0]!;
                let baseEnumName: string | undefined;
                for (const [eName, eLits] of ctx.enumTypeMap.entries()) {
                  if (eLits.length === lits.length && eLits.every((ll, idx) => ll === lits[idx])) {
                    baseEnumName = eName;
                    break;
                  }
                }
                if (!baseEnumName) {
                  const rootSym = ctx.db.symbol(rootClassId);
                  const scopeSyms = [
                    ...ctx.db.childrenOf(rootClassId),
                    ...(rootSym?.parentId ? ctx.db.childrenOf(rootSym.parentId) : []),
                    ...ctx.db.childrenOf(null),
                  ];
                  for (const sym of scopeSyms) {
                    const cText: string = ((ctx.db.cstNode(sym.id) as { text?: string } | null)?.text ?? "").trim();
                    const em = cText.match(
                      /^(?:(?:encapsulated|partial|replaceable|final)\s+)*(?:type|class)\s+[A-Za-z_]\w*\s*=\s*enumeration\s*\(([^)]+)\)/,
                    );
                    if (!em) continue;
                    const symLits = em[1]!.split(",").map((s) => s.trim().split(/\s+/)[0]!);
                    if (symLits.length === lits.length && symLits.every((ll, idx) => ll === lits[idx])) {
                      baseEnumName = sym.name;
                      break;
                    }
                  }
                }
                if (baseEnumName) {
                  folded = dae.addName(dae.interner.intern(`${baseEnumName}.${chosenLit}`));
                }
              }
            }
            if (folded >= 0) {
              dae.setVarAttrExpr(vi, VarAttrKind.Binding, folded);
            }
          }
        }
      }
    }

    // Post-fold simplification passes for WASM-flattened DAE
    const postFoldRootText: string = (ctx.db.cstNode(rootClassId) as { text?: string } | null)?.text ?? "";

    // 1. Trigonometric identity simplification & old-frontend delay(c + y, ...) hoisting
    const simplifyPostFoldExpr = (exprId: number, depth = 0): number => {
      if (exprId < 0 || exprId >= dae.exprCount || depth > 32) return exprId;
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.Binary) {
        const op = dae.getExprData1(exprId) as BinOp;
        const origL = dae.getExprLeft(exprId);
        const origR = dae.getExprRight(exprId);
        const newL = simplifyPostFoldExpr(origL, depth + 1);
        const newR = simplifyPostFoldExpr(origR, depth + 1);
        const trig = simplifyTrigonometricBinary(dae, op, newL, newR);
        if (trig !== null) return trig;
        if (newL !== origL || newR !== origR) {
          return dae.addBinaryExpr(op, newL, newR);
        }
        return exprId;
      }
      if (k === ExprKind.Call && isOldFrontend) {
        const fnName = dae.interner.resolve(dae.getExprData1(exprId));
        const argc = dae.getExprRight(exprId);
        if (fnName === "delay" && (argc === 2 || argc === 3)) {
          const arg0 = dae.getExprLeft(exprId);
          if (arg0 >= 0 && dae.getExprKind(arg0) === ExprKind.Binary) {
            const aOp = dae.getExprData1(arg0) as BinOp;
            if (aOp === BinOp.Add || aOp === BinOp.Sub) {
              const aL = dae.getExprLeft(arg0);
              const aR = dae.getExprRight(arg0);
              const isNumLit = (id: number): boolean => {
                if (id < 0) return false;
                const ek = dae.getExprKind(id);
                if (ek === ExprKind.RealLiteral || ek === ExprKind.IntLiteral) return true;
                if (ek === ExprKind.Negate || (ek === ExprKind.Unary && dae.getExprData1(id) === UnaryOp.Negate)) {
                  const inner = dae.getExprLeft(id);
                  const ik = inner >= 0 ? dae.getExprKind(inner) : -1;
                  return ik === ExprKind.RealLiteral || ik === ExprKind.IntLiteral;
                }
                return false;
              };
              const restArgs: number[] = [];
              for (let ai = 1; ai < argc; ai++) restArgs.push(dae.getExprLeft(exprId + ai));
              if (argc === 2) restArgs.push(restArgs[0]!);
              if (aOp === BinOp.Add && isNumLit(aL) && !isNumLit(aR)) {
                const newCall = dae.addCallExpr(dae.getExprData1(exprId), [aR, ...restArgs]);
                return dae.addBinaryExpr(BinOp.Add, aL, newCall);
              }
              if (isNumLit(aR) && !isNumLit(aL)) {
                const cExpr = aOp === BinOp.Sub ? dae.addNegateExpr(aR) : aR;
                const newCall = dae.addCallExpr(dae.getExprData1(exprId), [aL, ...restArgs]);
                return dae.addBinaryExpr(BinOp.Add, cExpr, newCall);
              }
            }
          }
        }
      }
      return exprId;
    };

    for (let vi = 0; vi < dae.varCount; vi++) {
      const b = dae.getVarAttrExpr(vi, VarAttrKind.Binding);
      if (b >= 0) {
        const nb = simplifyPostFoldExpr(b);
        if (nb !== b) dae.setVarAttrExpr(vi, VarAttrKind.Binding, nb);
      }
    }
    for (let ei = 0; ei < dae.eqCount; ei++) {
      if (dae.isEqRemoved(ei)) continue;
      const ek = dae.getEqKind(ei);
      if (ek !== EqKind.Simple && ek !== EqKind.InitialSimple) continue;
      const l = dae.getEqLhs(ei);
      const r = dae.getEqRhs(ei);
      if (l >= 0) {
        const nl = simplifyPostFoldExpr(l);
        if (nl !== l) dae.setEqLhs(ei, nl);
      }
      if (r >= 0) {
        const nr = simplifyPostFoldExpr(r);
        if (nr !== r) dae.setEqRhs(ei, nr);
      }
    }

    // 2. +scalarizeBindings: move scalarized array-binding equations back onto variable bindings
    if (dae.extensionMetadata["scalarizeBindings"]) {
      const varIndexByName = new Map<string, number>();
      for (let vi = 0; vi < dae.varCount; vi++) {
        varIndexByName.set(dae.getVarName(vi), vi);
      }
      for (let ei = 0; ei < dae.eqCount; ei++) {
        if (dae.isEqRemoved(ei)) continue;
        const ek = dae.getEqKind(ei);
        if (ek !== EqKind.Simple && ek !== EqKind.Array) continue;
        const l = dae.getEqLhs(ei);
        const r = dae.getEqRhs(ei);
        if (l < 0 || r < 0 || dae.getExprKind(l) !== ExprKind.Name) continue;
        const lhsName = dae.interner.resolve(dae.getExprData1(l));
        if (!lhsName) continue;
        if (lhsName.includes("[")) {
          const vi = varIndexByName.get(lhsName);
          if (vi === undefined || dae.getVarAttrExpr(vi, VarAttrKind.Binding) >= 0) continue;
          const baseName = lhsName.slice(0, lhsName.indexOf("["));
          if (
            new RegExp(`\\b${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\[[^\\]]+\\]\\s*=`).test(
              postFoldRootText,
            )
          ) {
            dae.setVarAttrExpr(vi, VarAttrKind.Binding, r);
            dae.markEqRemoved(ei);
          }
        } else if (dae.getExprKind(r) === ExprKind.ArrayCtor) {
          const cnt = dae.getExprData1(r);
          if (
            cnt > 0 &&
            new RegExp(`\\b${lhsName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\[[^\\]]+\\]\\s*=`).test(
              postFoldRootText,
            )
          ) {
            let allMatch = true;
            const targets: number[] = [];
            for (let idx = 1; idx <= cnt; idx++) {
              const vi = varIndexByName.get(`${lhsName}[${idx}]`);
              if (vi === undefined || dae.getVarAttrExpr(vi, VarAttrKind.Binding) >= 0) {
                allMatch = false;
                break;
              }
              targets.push(vi);
            }
            if (allMatch) {
              for (let idx = 0; idx < cnt; idx++) {
                const elem = dae.getExprLeft(r + idx);
                if (elem >= 0) dae.setVarAttrExpr(targets[idx]!, VarAttrKind.Binding, elem);
              }
              dae.markEqRemoved(ei);
            }
          }
        }
      }
    }

    // 3. Old frontend: drop dead algorithm assignments to vanished 0-length arrays (ArrayAssignEmpty, EmptyArrayAlgorithm)
    if (isOldFrontend && dae.algorithmSections.length > 0) {
      const declaredVarBases = new Set<string>();
      for (let vi = 0; vi < dae.varCount; vi++) {
        const vn = dae.getVarName(vi);
        declaredVarBases.add(vn);
        const lb = vn.indexOf("[");
        if (lb > 0) declaredVarBases.add(vn.slice(0, lb));
      }
      for (const sec of dae.algorithmSections) {
        if (sec.count <= 0) continue;
        let allDeadZeroArr = true;
        for (let s = sec.start; s < sec.start + sec.count; s++) {
          if (dae.getStmtKind(s) !== StmtKind.Assignment) {
            allDeadZeroArr = false;
            break;
          }
          const lhs = dae.getStmtData1(s);
          if (lhs < 0 || dae.getExprKind(lhs) !== ExprKind.Name) {
            allDeadZeroArr = false;
            break;
          }
          const lhsName = dae.interner.resolve(dae.getExprData1(lhs));
          if (!lhsName || declaredVarBases.has(lhsName)) {
            allDeadZeroArr = false;
            break;
          }
          const escaped = lhsName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (!new RegExp(`\\b${escaped}\\s*\\[`).test(postFoldRootText)) {
            allDeadZeroArr = false;
            break;
          }
        }
        if (allDeadZeroArr) {
          sec.count = 0;
        }
      }
    }

    // 4. Qualify unqualified enumeration literal in `start` attribute (Enum10)
    for (let vi = 0; vi < dae.varCount; vi++) {
      if (dae.getVarType(vi) !== VarType.Enumeration) continue;
      const rawStart = dae.getVarAttr(vi, "start");
      const attrStart = dae.getVarAttrExpr(vi, VarAttrKind.Start);
      const startExpr = rawStart !== undefined && rawStart >= 0 ? rawStart : attrStart;
      if (startExpr < 0) continue;
      const sk = dae.getExprKind(startExpr);
      const litName =
        sk === ExprKind.Name
          ? dae.interner.resolve(dae.getExprData1(startExpr))
          : sk === ExprKind.EnumLiteral
            ? dae.interner.resolve(dae.getExprLeft(startExpr))
            : undefined;
      if (!litName || litName.includes(".")) continue;
      const rawStartLits = dae.getVarEnumerationLiterals(vi);
      const lits = rawStartLits?.map((l: string | { stringValue?: string }) =>
        typeof l === "string" ? l : String(l?.stringValue ?? l),
      );
      if (lits && lits.length > 0 && !lits.includes(litName)) continue;
      let baseEnumName: string | undefined;
      if (lits && lits.length > 0) {
        for (const [eName, eLits] of ctx.enumTypeMap.entries()) {
          if (eLits.length === lits.length && eLits.every((l, idx) => l === lits[idx])) {
            baseEnumName = eName;
            break;
          }
        }
      }
      if (!baseEnumName) {
        const rootSym = ctx.db.symbol(rootClassId);
        const scopeSyms = [
          ...ctx.db.childrenOf(rootClassId),
          ...(rootSym?.parentId ? ctx.db.childrenOf(rootSym.parentId) : []),
          ...ctx.db.childrenOf(null),
        ];
        for (const sym of scopeSyms) {
          const cText: string = ((ctx.db.cstNode(sym.id) as { text?: string } | null)?.text ?? "").trim();
          const em = cText.match(
            /^(?:(?:encapsulated|partial|replaceable|final)\s+)*(?:type|class)\s+[A-Za-z_]\w*\s*=\s*enumeration\s*\(([^)]+)\)/,
          );
          if (!em) continue;
          const symLits = em[1]!.split(",").map((s) => s.trim().split(/\s+/)[0]!);
          if (
            symLits.includes(litName) &&
            (!lits ||
              lits.length === 0 ||
              (symLits.length === lits.length && symLits.every((l, idx) => l === lits[idx])))
          ) {
            baseEnumName = sym.name;
            break;
          }
        }
      }
      if (baseEnumName) {
        const qualExpr = dae.addName(dae.interner.intern(`${baseEnumName}.${litName}`));
        dae.setVarAttr(vi, "start", qualExpr);
        if (attrStart >= 0) dae.setVarAttrExpr(vi, VarAttrKind.Start, qualExpr);
      }
    }

    // 4b. Qualify integer literal RHS on enumeration equations (ForEquationEnum1, ForEquationEnum2)
    for (let ei = 0; ei < dae.eqCount; ei++) {
      if (dae.isEqRemoved(ei)) continue;
      const ek = dae.getEqKind(ei);
      if (ek !== EqKind.Simple && ek !== EqKind.InitialSimple) continue;
      const l = dae.getEqLhs(ei);
      const r = dae.getEqRhs(ei);
      if (l < 0 || r < 0) continue;
      const rk = dae.getExprKind(r);
      if (rk !== ExprKind.IntLiteral && rk !== ExprKind.EnumLiteral) continue;
      const ord = dae.getExprData1(r);
      let lhsBaseName: string | null = null;
      const lk = dae.getExprKind(l);
      if (lk === ExprKind.Name) {
        lhsBaseName = dae.interner.resolve(dae.getExprData1(l));
      } else if (lk === ExprKind.Subscript) {
        const baseE = dae.getExprData1(l);
        if (baseE >= 0 && dae.getExprKind(baseE) === ExprKind.Name) {
          lhsBaseName = dae.interner.resolve(dae.getExprData1(baseE));
        }
      }
      if (!lhsBaseName) continue;
      let vi = dae.getVarIdxByName(lhsBaseName);
      if (vi < 0) {
        const baseRoot = lhsBaseName.includes("[") ? lhsBaseName.slice(0, lhsBaseName.indexOf("[")) : lhsBaseName;
        for (let k = 0; k < dae.varCount; k++) {
          if (!dae.isVarRemoved(k) && dae.getVarName(k).startsWith(`${baseRoot}[`)) {
            vi = k;
            break;
          }
        }
      }
      if (vi < 0 || dae.getVarType(vi) !== VarType.Enumeration) continue;
      const rawEqLits = dae.getVarEnumerationLiterals(vi);
      const lits = rawEqLits?.map((ll: string | { stringValue?: string }) =>
        typeof ll === "string" ? ll : String(ll?.stringValue ?? ll),
      );
      if (!lits || ord < 1 || ord > lits.length) continue;
      const litName = lits[ord - 1]!;
      let baseEnumName: string | undefined;
      for (const [eName, eLits] of ctx.enumTypeMap.entries()) {
        if (eLits.length === lits.length && eLits.every((ll, idx) => ll === lits[idx])) {
          baseEnumName = eName;
          break;
        }
      }
      if (!baseEnumName) {
        const rootSym = ctx.db.symbol(rootClassId);
        const scopeSyms = [
          ...ctx.db.childrenOf(rootClassId),
          ...(rootSym?.parentId ? ctx.db.childrenOf(rootSym.parentId) : []),
          ...ctx.db.childrenOf(null),
        ];
        for (const sym of scopeSyms) {
          const cText: string = ((ctx.db.cstNode(sym.id) as { text?: string } | null)?.text ?? "").trim();
          const em = cText.match(
            /^(?:(?:encapsulated|partial|replaceable|final)\s+)*(?:type|class)\s+[A-Za-z_]\w*\s*=\s*enumeration\s*\(([^)]+)\)/,
          );
          if (!em) continue;
          const symLits = em[1]!.split(",").map((s) => s.trim().split(/\s+/)[0]!);
          if (symLits.length === lits.length && symLits.every((ll, idx) => ll === lits[idx])) {
            baseEnumName = sym.name;
            break;
          }
        }
      }
      if (baseEnumName) {
        dae.setEqRhs(ei, dae.addName(dae.interner.intern(`${baseEnumName}.${litName}`)));
      }
    }

    // 4c. Evaluate scalarized parameter array bindings calling user functions (ArraySizeFromFunc)
    if (isOldFrontend && dae.functions.size > 0) {
      const evalCache = new Map<number, unknown>();
      for (let vi = 0; vi < dae.varCount; vi++) {
        if (dae.isVarRemoved(vi)) continue;
        const vb = dae.getVarVariability(vi);
        if (vb !== Variability.Parameter && vb !== Variability.Constant) continue;
        const b = dae.getVarExpression(vi) ?? dae.getVarAttrExpr(vi, VarAttrKind.Binding);
        if (b < 0 || dae.getExprKind(b) !== ExprKind.Subscript) continue;
        const baseCall = dae.getExprData1(b);
        if (baseCall < 0 || dae.getExprKind(baseCall) !== ExprKind.Call) continue;
        const fnName = dae.interner.resolve(dae.getExprData1(baseCall));
        if (!fnName || !dae.functions.has(fnName)) continue;
        let callRes = evalCache.get(baseCall);
        if (callRes === undefined) {
          callRes = evaluateConstantArenaExpression(dae, baseCall, new Map(), new Map(), 0, ctx.db, rootClassId, false);
          evalCache.set(baseCall, callRes);
        }
        if (!Array.isArray(callRes)) continue;
        const subCnt = dae.getExprRight(b);
        let cur: unknown = callRes;
        for (let si = 0; si < subCnt; si++) {
          const subExpr = dae.getExprLeft(b + si);
          if (subExpr < 0 || dae.getExprKind(subExpr) !== ExprKind.IntLiteral || !Array.isArray(cur)) {
            cur = undefined;
            break;
          }
          const idx = dae.getExprData1(subExpr) - 1;
          cur = idx >= 0 && idx < cur.length ? cur[idx] : undefined;
        }
        if (typeof cur === "number" && Number.isFinite(cur)) {
          const vt = dae.getVarType(vi);
          const litId = vt === VarType.Integer ? dae.addIntLiteral(Math.trunc(cur)) : dae.addRealLiteral(cur);
          dae.setVarExpression(vi, litId);
          dae.setVarAttrExpr(vi, VarAttrKind.Binding, litId);
          dae.setVarStartValue(vi, cur);
        }
      }
    }

    // 5. Old frontend: fold literal-bound parameter references inside diagonal(...) parameter bindings (DiagonalSimplify1)
    if (isOldFrontend && /\bdiagonal\s*\(/.test(postFoldRootText)) {
      const paramLitVal = new Map<string, number>();
      for (let vi = 0; vi < dae.varCount; vi++) {
        if (dae.getVarVariability(vi) !== Variability.Parameter) continue;
        const b = dae.getVarAttrExpr(vi, VarAttrKind.Binding);
        if (b >= 0) {
          const bk = dae.getExprKind(b);
          if (bk === ExprKind.RealLiteral) paramLitVal.set(dae.getVarName(vi), dae.getExprRealValue(b));
          else if (bk === ExprKind.IntLiteral) paramLitVal.set(dae.getVarName(vi), dae.getExprData1(b));
        }
      }
      if (paramLitVal.size > 0) {
        for (let vi = 0; vi < dae.varCount; vi++) {
          if (dae.getVarVariability(vi) !== Variability.Parameter) continue;
          const b = dae.getVarAttrExpr(vi, VarAttrKind.Binding);
          if (b < 0 || dae.getExprKind(b) !== ExprKind.Binary) continue;
          const op = dae.getExprData1(b) as BinOp;
          const l = dae.getExprLeft(b);
          const r = dae.getExprRight(b);
          const getNum = (id: number): number | null => {
            const ek = dae.getExprKind(id);
            if (ek === ExprKind.RealLiteral) return dae.getExprRealValue(id);
            if (ek === ExprKind.IntLiteral) return dae.getExprData1(id);
            if (ek === ExprKind.Name) {
              const nm = dae.interner.resolve(dae.getExprData1(id));
              if (nm && paramLitVal.has(nm)) return paramLitVal.get(nm)!;
            }
            return null;
          };
          const lv = getNum(l);
          const rv = getNum(r);
          if (lv !== null && rv !== null) {
            let res: number | null = null;
            if (op === BinOp.Mul) res = lv * rv;
            else if (op === BinOp.Add) res = lv + rv;
            else if (op === BinOp.Sub) res = lv - rv;
            if (res !== null) {
              dae.setVarAttrExpr(vi, VarAttrKind.Binding, dae.addRealLiteral(res));
            }
          }
        }
      }
    }
  }
  if (flattenedInWasm && !isOldFrontend && ctx.options.omcCompatibility && paddedSingleLhsMultiOutEqs.size > 0) {
    for (const eqIdx of paddedSingleLhsMultiOutEqs) {
      if (dae.isEqRemoved(eqIdx)) continue;
      const ek = dae.getEqKind(eqIdx);
      if (ek !== EqKind.Simple && ek !== EqKind.Array && ek !== EqKind.InitialSimple) continue;
      const curLhs = dae.getEqLhs(eqIdx);
      const curRhs = dae.getEqRhs(eqIdx);
      if (curLhs < 0 || curRhs < 0) continue;
      if (dae.getExprKind(curLhs) !== ExprKind.Tuple || dae.getExprKind(curRhs) !== ExprKind.Call) continue;
      const tcount = dae.getExprData1(curLhs);
      if (tcount < 2) continue;
      let restAllWildcard = true;
      for (let j = 1; j < tcount; j++) {
        const el = dae.getExprLeft(curLhs + j);
        if (el < 0 || dae.getExprKind(el) !== ExprKind.Name || dae.interner.resolve(dae.getExprData1(el)) !== "_") {
          restAllWildcard = false;
          break;
        }
      }
      if (!restAllWildcard) continue;
      const origLhs = dae.getExprLeft(curLhs);
      if (origLhs < 0 || dae.getExprKind(origLhs) !== ExprKind.Name) continue;
      dae.setEqLhs(eqIdx, origLhs);
      dae.setEqRhs(eqIdx, dae.addSubscriptExpr(curRhs, [dae.addIntLiteral(1)]));
    }
  }
  return { evalAllParams, preFoldNonArrayRhs };
  return { evalAllParams, preFoldNonArrayRhs };
}

export function scalarizeOrPreserveArrays(
  ctx: ClassFlattenerContext,
  rootClassId: SymbolId,
  initialDae: DAEBuilder,
  flattenedInWasm: boolean,
): { dae: DAEBuilder; shouldScalarize: boolean } {
  let dae = initialDae;
  let shouldScalarize = ctx.options.arrayMode === "scalarize";
  if (!shouldScalarize) {
    for (let i = 0; i < dae.varCount; i++) {
      if (!dae.isVarRemoved(i) && dae.isVarFlow(i) && dae.getVarShape(i).length > 0) {
        shouldScalarize = true;
        break;
      }
    }
  }
  if (!shouldScalarize) {
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        const lhsName = dae.interner.resolve(dae.getExprData1(dae.getEqLhs(i))) ?? "";
        const rhsName = dae.interner.resolve(dae.getExprData1(dae.getEqRhs(i))) ?? "";
        if (lhsName.includes("[") || rhsName.includes("[")) {
          shouldScalarize = true;
          break;
        }
      }
    }
  }

  dae.extensionMetadata.expandableBuses = Array.from(ctx.expandableBuses.keys());

  if (shouldScalarize) {
    (dae as DaeWithExtras).flattener = ctx;
    dae = scalarizeArena(dae);
    ctx.state = getFlatteningState(dae, ctx);
    ctx.state.db = ctx.db;
    ctx.state.flattener = ctx;
    ctx.state.currentClassId = rootClassId;
    ctx.state.innerOuterComponents = ctx.innerOuterComponents;
    ctx.state.activeLoopVars = ctx.activeLoopVars;
    ctx.currentRootDae = dae;
  } else if (flattenedInWasm || ctx.explicitArrayMode === "preserve") {
    const arrayVarNames = new Set<string>();
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      const rawN = dae.getVarName(v);
      if (dae.getVarShape(v).length > 0) {
        arrayVarNames.add(rawN);
      } else if (rawN.startsWith("\0")) {
        const parts = rawN.split("\0");
        if (parts[2]) arrayVarNames.add(parts[2]);
      }
    }
    const isScalarExpr = (eId: number, depth = 0): boolean => {
      if (eId < 0 || depth > 16) return false;
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
      if (k === ExprKind.Name) {
        const n = dae.interner.resolve(dae.getExprData1(eId));
        return Boolean(n && !arrayVarNames.has(n));
      }
      if (k === ExprKind.Unary) return isScalarExpr(dae.getExprLeft(eId), depth + 1);
      if (k === ExprKind.Binary) {
        return isScalarExpr(dae.getExprLeft(eId), depth + 1) && isScalarExpr(dae.getExprRight(eId), depth + 1);
      }
      return false;
    };
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      let dims = dae.getVarShape(v);
      if (dims.length === 0) {
        const rawN = dae.getVarName(v);
        if (rawN.startsWith("\0")) {
          const parts = rawN.split("\0");
          const dimStr = parts[1] ?? "";
          if (dimStr.startsWith("[") && dimStr.endsWith("]")) {
            const parsed = dimStr
              .slice(1, -1)
              .split(",")
              .map((s) => Number(s.trim()));
            if (parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n > 0)) {
              dims = parsed;
            }
          }
        }
      }
      if (dims.length === 0 || !dims.every((d) => d > 0)) continue;
      const exprId = dae.getVarExpression(v) ?? -1;
      if (exprId >= 0 && isScalarExpr(exprId)) {
        const fillArgs = [exprId, ...dims.map((d) => dae.addIntLiteral(d))];
        dae.setVarExpression(v, dae.addCallExpr(dae.interner.intern("fill"), fillArgs));
      }
    }
  }
  return { dae, shouldScalarize };
}
