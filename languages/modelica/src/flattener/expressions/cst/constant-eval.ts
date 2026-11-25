// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - CST numeric evaluation and database constant lookup/extraction.
 */

import { DAEBuilder, Variability, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { MAX_ARRAY_EXPANSION_LENGTH, MODELICA_EPS, MODELICA_SMALL } from "../../../constants.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import { getFlatteningState } from "../../support/state.js";
import type { ComponentInstanceData, FlattenerCstNode } from "../../types.js";
import { evalDaeExpr, parseArrayLiteralElements } from "../eval.js";
import { getSymbolQualifiedName } from "../functions.js";
import { evalArithmeticText, evalBinaryNumericOp, evalScalarBuiltinCall } from "./arithmetic-eval.js";
import {
  extractBindingExprFromDeclCst,
  extractFunctionCallArgExprNodesCst,
  extractModArgBindingExprCst,
  parseStandaloneExpressionCst,
  unwrapParenExprCst,
} from "./cst-traversal.js";
import { getSymbolEnumLiterals } from "./enum-resolution.js";
import { evalKnownConstantExprText } from "./known-constants.js";
import { getDaeArrayDimSize, isIntegerTypeSpec, resolveScopedName } from "./name-resolution.js";
import {
  isDottedIdentifierChain,
  isSignedAsciiNumberText,
  parseTrailingSingleIntSubscript,
  stripAnnotation,
  stripLeadingDot,
  stripOuterDoubleQuotes,
} from "./text-scanning.js";
import type {
  CstDaeExt,
  DbConstantResult,
  EffectiveModLike,
  ExtendsModResult,
  ModArgLike,
  QueryDBWithConstCache,
  RawDimEntry,
  SimpleNameResolver,
} from "./types.js";

const _evaluatingCSTNumbers = new Set<string>();

const _cstNumberMemo = new Map<string, number | null>();

let _cstCycleDetected = false;

let _externalEvalDepth = 0;

export function beginExternalCstEval(): void {
  _externalEvalDepth++;
}

export function endExternalCstEval(): void {
  if (--_externalEvalDepth <= 0) {
    _externalEvalDepth = 0;
    if (_evaluatingCSTNumbers.size === 0) {
      _cstNumberMemo.clear();
      _cstCycleDetected = false;
    }
  }
}

export function evaluateCSTNumber(
  node: SyntaxNode | FlattenerCstNode | string | null | undefined,
  subs?: ReadonlyMap<string, number | string>,
  scopeId?: SymbolId,
  db?: QueryDB | null,
  dae?: DAEBuilder,
  prefix = "",
): number | null {
  if (!node) return null;
  let currNode: SyntaxNode | string | null | undefined = typeof node === "string" ? node : (node as SyntaxNode);
  if (typeof currNode !== "string") {
    while (currNode && currNode.childCount === 1) {
      currNode = currNode.child(0);
    }
    if (!currNode) return null;
    if (currNode.childCount === 3 && Cst.kind(currNode.child(0)) === "(" && Cst.kind(currNode.child(2)) === ")") {
      return evaluateCSTNumber(currNode.child(1), subs, scopeId, db, dae, prefix);
    }
  }

  const rawNodeText = typeof currNode === "string" ? currNode : currNode.text;
  const text = (rawNodeText ? stripAnnotation(rawNodeText) : "").trim();
  if (text === "true") return 1;
  if (text === "false") return 0;
  if (subs && subs.has(text)) {
    const sv = subs.get(text);
    if (typeof sv === "number") return sv;
    if (typeof sv === "string" && sv.startsWith("expr:") && dae) {
      const ev = evalDaeExpr(Number(sv.slice(5)), dae);
      if (typeof ev === "number") return ev;
    }
    return null;
  }
  const num = parseInt(text, 10);
  if (!isNaN(num) && String(num) === text) return num;
  const floatNum = parseFloat(text);
  if (!isNaN(floatNum) && isSignedAsciiNumberText(text)) return floatNum;

  const evalCycleKey = `${subs?.size ? 1 : 0}:${scopeId ?? 0}:${prefix}:${text}`;
  const cached = _cstNumberMemo.get(evalCycleKey);
  if (cached !== undefined) return cached;
  if (_evaluatingCSTNumbers.has(evalCycleKey)) {
    _cstCycleDetected = true;
    return null;
  }
  _evaluatingCSTNumbers.add(evalCycleKey);
  try {
    const res = evaluateCSTNumberInner(currNode, text, subs, scopeId, db ?? undefined, dae, prefix);
    if (!_cstCycleDetected) {
      _cstNumberMemo.set(evalCycleKey, res);
    }
    return res;
  } finally {
    _evaluatingCSTNumbers.delete(evalCycleKey);
    if (_evaluatingCSTNumbers.size === 0 && _externalEvalDepth === 0) {
      _cstNumberMemo.clear();
      _cstCycleDetected = false;
    }
  }
}

function evaluateCSTNumberInner(
  node: SyntaxNode | string,
  text: string,
  subs?: ReadonlyMap<string, number | string>,
  scopeId?: SymbolId,
  db?: QueryDB,
  dae?: DAEBuilder,
  prefix = "",
): number | null {
  const ifCstCandidate = unwrapParenExprCst(
    typeof node === "string" ? (text.startsWith("if ") ? parseStandaloneExpressionCst(text) : null) : node,
  );
  if (ifCstCandidate && ifCstCandidate.type === "expression" && ifCstCandidate.child(0)?.text === "if") {
    let i = 0;
    while (i < ifCstCandidate.childCount) {
      const tok = ifCstCandidate.child(i)?.text;
      if (
        (tok === "if" || tok === "elseif") &&
        i + 3 < ifCstCandidate.childCount &&
        ifCstCandidate.child(i + 2)?.text === "then"
      ) {
        const condVal = evaluateCSTNumber(ifCstCandidate.child(i + 1)!, subs, scopeId, db, dae, prefix);
        if (condVal === null) break;
        if (condVal !== 0) {
          return evaluateCSTNumber(ifCstCandidate.child(i + 3)!, subs, scopeId, db, dae, prefix);
        }
        i += 4;
        continue;
      }
      if (tok === "else" && i + 1 < ifCstCandidate.childCount) {
        return evaluateCSTNumber(ifCstCandidate.child(i + 1)!, subs, scopeId, db, dae, prefix);
      }
      i++;
    }
  }

  const extractModArgText = (arg: ModArgLike): string => {
    const be = arg.bindingExpression;
    const beText = typeof be === "string" ? be : be?.text;
    return (arg.value?.text ?? beText ?? (typeof arg.value?.value === "number" ? String(arg.value.value) : "")).trim();
  };

  const findInheritedModExpr = (
    startScopeId: SymbolId,
    targetName: string,
  ): { exprText: string; modScopeId: SymbolId } | null => {
    if (!db) return null;
    const visited = new Set<SymbolId>();
    const queue: SymbolId[] = [startScopeId];
    while (queue.length > 0) {
      const sid = queue.shift()!;
      if (visited.has(sid)) continue;
      visited.add(sid);
      const selfMod = db.query<EffectiveModLike | null>("effectiveModification", sid);
      const selfArg = selfMod?.args?.find(
        (a) => a && !a.isBreak && a.name === targetName && (a.value || a.bindingExpression),
      );
      if (selfArg) {
        const txt = extractModArgText(selfArg);
        if (txt) return { exprText: txt, modScopeId: sid };
      }
      const extChildren = db.childrenOf?.(sid)?.filter((c) => c.kind === "Extends") ?? [];
      for (const ext of extChildren) {
        const extMod = db.query<ExtendsModResult>("extendsModificationParsed", ext.id);
        const extArgs = Array.isArray(extMod) ? extMod : (extMod?.args ?? []);
        const matchingArg = extArgs.find(
          (a) => a && !a.isBreak && a.name === targetName && (a.value || a.bindingExpression),
        );
        if (matchingArg) {
          const txt = extractModArgText(matchingArg);
          if (txt) return { exprText: txt, modScopeId: sid };
        }
        const baseCls = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (baseCls && !visited.has(baseCls.id)) {
          queue.push(baseCls.id);
        }
      }
      const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", sid);
      if (directBase && !visited.has(directBase.id)) {
        queue.push(directBase.id);
      }
    }
    return null;
  };

  const evalArrayBindingDim = (rawBText: string, dim: number, evalSid: SymbolId | undefined): number | null => {
    const strippedB = stripAnnotation(rawBText).trim();
    const cleanB = (strippedB.startsWith("=") ? strippedB.slice(1) : strippedB).trim();
    if (dim === 1 && cleanB.startsWith("{") && cleanB.endsWith("}")) {
      const inner = cleanB.slice(1, -1).trim();
      return inner === "" ? 0 : parseArrayLiteralElements(cleanB).length;
    }
    const fillNode = unwrapParenExprCst(parseStandaloneExpressionCst(cleanB));
    if (fillNode?.type === "primary" && fillNode.childForFieldName("callee")?.text?.trim() === "fill") {
      const fillArgs = extractFunctionCallArgExprNodesCst(fillNode);
      if (fillArgs.length >= 1 + dim) {
        return evaluateCSTNumber(fillArgs[dim]!, subs, evalSid, db, dae, prefix);
      }
    }
    return null;
  };

  const resolveSizeCall = (arrName: string, dim: number): number | null => {
    if (dae) {
      const resolvedName = resolveScopedName(arrName, prefix, dae);
      const dimSize = getDaeArrayDimSize(dae, arrName, resolvedName, dim);
      if (dimSize !== null && dimSize > 0) return dimSize;
    }
    if (db) {
      if (scopeId !== undefined) {
        const modHit = findInheritedModExpr(scopeId, arrName);
        if (modHit) {
          const modDim = evalArrayBindingDim(modHit.exprText, dim, modHit.modScopeId);
          if (modDim !== null) return modDim;
        }
      }
      let sym: SymbolEntry | null = null;
      if (scopeId) {
        const res =
          db.query<SimpleNameResolver | null>("resolveName", scopeId)?.(arrName) ??
          db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId)?.(arrName);
        if (res) sym = res;
      }
      const syms = sym ? [sym] : db.byName(arrName);
      for (const s of syms) {
        if (dim === 1) {
          const lits = getSymbolEnumLiterals(db, s);
          if (lits) return lits.length;
        }
        const dims = db.query<RawDimEntry[] | null>("arrayDimensions", s.id);
        if (dims && dims.length >= dim) {
          const d = dims[dim - 1];
          if (d && typeof d === "object" && d.kind === "literal" && typeof d.value === "number") return d.value;
        }
        const sMod = db.query<EffectiveModLike | null>("effectiveModification", s.id);
        const sBText = sMod?.bindingExpression?.text?.trim();
        if (sBText) {
          const bDim = evalArrayBindingDim(sBText, dim, scopeId ?? s.parentId ?? undefined);
          if (bDim !== null) return bDim;
        }
      }
    }
    return null;
  };

  const resolveIdentConstant = (ident: string, requireConstOrParamVariability: boolean): number | null => {
    if (ident === "true") return 1;
    if (ident === "false") return 0;
    if (subs && subs.has(ident)) {
      const sv = subs.get(ident);
      if (typeof sv === "number") return sv;
      if (typeof sv === "string" && sv.startsWith("expr:") && dae) {
        const ev = evalDaeExpr(Number(sv.slice(5)), dae);
        if (typeof ev === "number") return ev;
      }
      return null;
    }
    if (dae) {
      const daeExt = dae as CstDaeExt;
      const resolved = resolveScopedName(ident, prefix, dae);
      let vIdx = dae.getVarIdxByName(resolved);
      if (vIdx < 0 && !requireConstOrParamVariability) vIdx = dae.getVarIdxByName(ident);
      if (vIdx >= 0) {
        const v = dae.getVarVariability(vIdx);
        if (!requireConstOrParamVariability || v === Variability.Constant || v === Variability.Parameter) {
          const bExpr = dae.getVarExpression(vIdx);
          if (bExpr !== undefined && bExpr >= 0) {
            const val = evalDaeExpr(bExpr, dae);
            if (typeof val === "number" && !isNaN(val)) return val;
            if (typeof val === "boolean") return val ? 1 : 0;
          }
          const startAttrExpr = dae.getVarAttrExprId?.(vIdx, "start");
          if (startAttrExpr !== undefined && startAttrExpr >= 0) {
            const val = evalDaeExpr(startAttrExpr, dae);
            if (typeof val === "number" && !isNaN(val)) return val;
            if (typeof val === "boolean") return val ? 1 : 0;
          }
          const startVal = dae.getVarStartValue(vIdx);
          if (
            startVal !== undefined &&
            !isNaN(startVal) &&
            (startVal !== 0 || (requireConstOrParamVariability && startAttrExpr !== undefined && startAttrExpr >= 0))
          ) {
            return startVal;
          }
        }
      }
      const pendingVals = daeExt.pendingModValues;
      const fullKey = prefix ? `${prefix}.${ident}` : ident;
      if (pendingVals) {
        const pv = pendingVals.get(resolved) ?? pendingVals.get(fullKey);
        if (typeof pv === "number" && !isNaN(pv)) return pv;
        if (typeof pv === "boolean") return pv ? 1 : 0;
      }
      const pendingExprs = daeExt.pendingModExprs;
      if (pendingExprs) {
        const pe = pendingExprs.get(resolved) ?? pendingExprs.get(fullKey);
        if (pe && pe !== ident && pe !== text) {
          const evalVal = evaluateCSTNumber(pe, subs, scopeId, db, dae, prefix);
          if (evalVal !== null) return evalVal;
        }
      }
    }
    if (db) {
      const state = dae ? getFlatteningState(dae) : null;
      const flat = state?.flattener ?? (dae as CstDaeExt | undefined)?.flattener;
      const rawEffScopeId = scopeId ?? flat?.currentClassId ?? flat?.currentRootClassId;
      const effScopeSym = rawEffScopeId !== undefined && db?.symbol ? db.symbol(rawEffScopeId) : undefined;
      const effScopeId =
        effScopeSym?.kind === "Component" && effScopeSym.parentId != null ? effScopeSym.parentId : rawEffScopeId;
      if (effScopeId !== undefined) {
        let resolvedIdent = ident;
        let redeclScopeId: SymbolId | undefined = undefined;
        if (ident.includes(".") && flat?.currentParentMods?.args) {
          const parts = ident.split(".");
          const firstSeg = parts[0]!;
          const parentRedecl = [...flat.currentParentMods.args]
            .reverse()
            .find((a) => a && !a.isBreak && a.name === firstSeg && a.redeclaredTypeSpecifier);
          if (parentRedecl?.redeclaredTypeSpecifier) {
            resolvedIdent = [parentRedecl.redeclaredTypeSpecifier, ...parts.slice(1)].join(".");
            const rawRedeclScope = parentRedecl.ownerClassId ?? parentRedecl.evaluationScopeId;
            const redeclSym = rawRedeclScope !== undefined && db?.symbol ? db.symbol(rawRedeclScope) : undefined;
            redeclScopeId =
              redeclSym?.kind === "Component" && redeclSym.parentId != null ? redeclSym.parentId : rawRedeclScope;
          }
        }
        if (resolvedIdent === ident && !ident.includes(".")) {
          let curScopeId: SymbolId | null | undefined = effScopeId;
          while (curScopeId !== undefined && curScopeId !== null) {
            const modHit = findInheritedModExpr(curScopeId, ident);
            if (modHit) {
              const bStr = modHit.exprText;
              if (bStr === "true") return 1;
              if (bStr === "false") return 0;
              const bVal = parseInt(bStr, 10);
              if (!isNaN(bVal) && String(bVal) === bStr) return bVal;
              if (bStr && bStr !== ident && bStr !== text) {
                const evalVal = evaluateCSTNumber(bStr, subs, curScopeId, db, dae, prefix);
                if (evalVal !== null) return evalVal;
              }
            }
            curScopeId = db.symbol?.(curScopeId)?.parentId;
          }
          const resolved =
            db.query<SimpleNameResolver | null>("resolveName", effScopeId)?.(ident) ??
            db.query<SimpleNameResolver | null>("resolveSimpleName", effScopeId)?.(ident);
          if (resolved) {
            const mod = db.query<EffectiveModLike | null>("effectiveModification", resolved.id);
            if (mod?.bindingExpression?.text) {
              const bStr = stripAnnotation(mod.bindingExpression.text).trim();
              if (bStr === "true") return 1;
              if (bStr === "false") return 0;
              const bVal = parseInt(bStr, 10);
              if (!isNaN(bVal) && String(bVal) === bStr) return bVal;
              if (bStr && bStr !== ident && bStr !== text) {
                const evalVal = evaluateCSTNumber(bStr, subs, effScopeId, db, dae, prefix);
                if (evalVal !== null) return evalVal;
              }
            }
          }
        }
        const candidateScopes = [redeclScopeId, effScopeId, flat?.currentClassId, flat?.currentRootClassId].filter(
          (id, idx, arr): id is SymbolId => id != null && arr.indexOf(id) === idx,
        );
        for (const sId of candidateScopes) {
          const dbConst = lookupDbConstant(resolvedIdent, db, sId);
          if (dbConst && typeof dbConst.value === "number") {
            return dbConst.value;
          }
        }
        if (ident.includes(".")) {
          const idParts = resolvedIdent.split(".");
          const memberIdent = idParts.pop()!;
          const pkgPath = idParts.join(".");
          let pkgSym: SymbolEntry | null = null;
          for (const sId of candidateScopes) {
            const res =
              db.query<SimpleNameResolver | null>("resolveName", sId)?.(pkgPath) ??
              db.query<SimpleNameResolver | null>("resolveSimpleName", sId)?.(pkgPath);
            if (res && (res.kind === "Class" || res.kind === "Package")) {
              pkgSym = res;
              break;
            }
          }
          if (!pkgSym) {
            pkgSym =
              db.byName(pkgPath.split(".").pop()!).find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
          }
          if (pkgSym) {
            const visitedAliases = new Set<SymbolId>();
            while (pkgSym && !visitedAliases.has(pkgSym.id)) {
              visitedAliases.add(pkgSym.id);
              if (!getShortClassSpecifierNode(db.cstNode(pkgSym.id) as SyntaxNode | null | undefined)) break;
              const nextBase: SymbolEntry | null = db.query<SymbolEntry | null>("resolvedBaseClass", pkgSym.id);
              if (nextBase) pkgSym = nextBase;
              else break;
            }
            if (pkgSym && memberIdent !== text) {
              const evalVal = evaluateCSTNumber(memberIdent, subs, pkgSym.id, db, dae, prefix);
              if (evalVal !== null) return evalVal;
            }
          }
        }
      }
    }
    return null;
  };

  const collectArrayCtorElements = (arrNode: SyntaxNode): SyntaxNode[] => {
    const out: SyntaxNode[] = [];
    const collect = (n: SyntaxNode): void => {
      if (n.type === "expression") {
        out.push(n);
        return;
      }
      if (n.type === "expression_list" || n.type === "array_arguments" || n.type === "array_arguments_non_first") {
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i);
          if (ch) collect(ch);
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i);
        if (ch) collect(ch);
      }
    };
    collect(arrNode);
    return out;
  };

  const evalCstExprNode = (rawExprNode: SyntaxNode, requireConstOrParam: boolean): number | null => {
    let cur = unwrapParenExprCst(rawExprNode);
    while (
      cur &&
      cur.childCount === 1 &&
      cur.type !== "component_reference" &&
      cur.type !== "identifier" &&
      cur.type !== "unsigned_number" &&
      cur.type !== "unsigned_integer" &&
      cur.type !== "unsigned_real"
    ) {
      const next = cur.child(0);
      if (!next) break;
      cur = unwrapParenExprCst(next);
    }
    if (!cur) return null;
    const rawCurText = cur.text?.trim() ?? "";
    if (rawCurText === "true") return 1;
    if (rawCurText === "false") return 0;
    if (subs && subs.has(rawCurText)) {
      const sv: unknown = subs.get(rawCurText);
      if (typeof sv === "number") return sv;
      if (typeof sv === "string" && sv.startsWith("expr:") && dae) {
        const ev = evalDaeExpr(Number(sv.slice(5)), dae);
        if (typeof ev === "number") return ev;
      }
      return null;
    }
    if (cur.type === "unsigned_number" || cur.type === "unsigned_integer" || cur.type === "unsigned_real") {
      const parsed = Number(rawCurText);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (cur.type === "expression" && cur.child(0)?.text === "if") {
      let i = 0;
      while (i < cur.childCount) {
        const tok = cur.child(i)?.text;
        if ((tok === "if" || tok === "elseif") && i + 3 < cur.childCount && cur.child(i + 2)?.text === "then") {
          const condVal = evalCstExprNode(cur.child(i + 1)!, requireConstOrParam);
          if (condVal === null) return null;
          if (condVal !== 0) {
            return evalCstExprNode(cur.child(i + 3)!, requireConstOrParam);
          }
          i += 4;
          continue;
        }
        if (tok === "else" && i + 1 < cur.childCount) {
          return evalCstExprNode(cur.child(i + 1)!, requireConstOrParam);
        }
        i++;
      }
      return null;
    }
    if (cur.type === "expression" && cur.childCount === 3) {
      const op = stripOuterDoubleQuotes(cur.child(1)?.text?.trim() ?? cur.child(1)?.type ?? "");
      const left = evalCstExprNode(cur.child(0)!, requireConstOrParam);
      const right = evalCstExprNode(cur.child(2)!, requireConstOrParam);
      if (left !== null && right !== null) {
        return evalBinaryNumericOp(op, left, right, true);
      }
      return null;
    }
    if (cur.type === "expression" && cur.childCount === 2) {
      const op = stripOuterDoubleQuotes(cur.child(0)?.text?.trim() ?? cur.child(0)?.type ?? "");
      const val = evalCstExprNode(cur.child(1)!, requireConstOrParam);
      if (val !== null) {
        if (op === "-") return -val;
        if (op === "+") return val;
        if (op === "not") return val === 0 ? 1 : 0;
      }
      return null;
    }
    if (cur.type === "primary") {
      const calleeText = stripLeadingDot(cur.childForFieldName("callee")?.text?.trim() ?? "");
      if (calleeText) {
        const argNodes = extractFunctionCallArgExprNodesCst(cur);
        if (calleeText === "size" && (argNodes.length === 1 || argNodes.length === 2)) {
          const arrName = stripLeadingDot(argNodes[0]!.text?.trim() ?? "");
          if (isDottedIdentifierChain(arrName)) {
            const dimVal = argNodes.length === 2 ? evalCstExprNode(argNodes[1]!, requireConstOrParam) : 1;
            if (dimVal !== null && Number.isInteger(dimVal)) {
              const sizeVal = resolveSizeCall(arrName, dimVal);
              if (sizeVal !== null) return sizeVal;
            }
          }
          return null;
        }
        if ((calleeText === "min" || calleeText === "max") && argNodes.length >= 1) {
          let elemNodes = argNodes;
          if (argNodes.length === 1) {
            const unwrappedArg = unwrapParenExprCst(argNodes[0]!);
            const firstTok = unwrappedArg?.child(0)?.text;
            if (unwrappedArg && (firstTok === "{" || firstTok === "[")) {
              elemNodes = collectArrayCtorElements(unwrappedArg);
            }
          }
          if (elemNodes.length > 0) {
            const vals: number[] = [];
            for (const elem of elemNodes) {
              const v = evalCstExprNode(elem, requireConstOrParam);
              if (v === null) {
                vals.length = 0;
                break;
              }
              vals.push(v);
            }
            if (vals.length > 0) {
              return calleeText === "min" ? Math.min(...vals) : Math.max(...vals);
            }
          }
          return null;
        }
        const evaledArgs: number[] = [];
        for (const arg of argNodes) {
          const av = evalCstExprNode(arg, requireConstOrParam);
          if (av === null) return null;
          evaledArgs.push(av);
        }
        return evalScalarBuiltinCall(calleeText, evaledArgs);
      }
    }
    if (cur.type === "component_reference" || cur.type === "identifier") {
      return resolveIdentConstant(rawCurText, requireConstOrParam);
    }
    if (cur.childCount === 0) {
      if (isSignedAsciiNumberText(rawCurText)) {
        const parsed = Number(rawCurText);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (
        isDottedIdentifierChain(stripLeadingDot(rawCurText)) ||
        (rawCurText.startsWith("'") && rawCurText.endsWith("'"))
      ) {
        return resolveIdentConstant(rawCurText, requireConstOrParam);
      }
    }
    return null;
  };

  const exprCst = typeof node === "string" ? parseStandaloneExpressionCst(text) : node;
  if (exprCst) {
    const strictVal = evalCstExprNode(exprCst, true);
    if (strictVal !== null) return strictVal;
    const unwrappedExpr = unwrapParenExprCst(exprCst);
    const isCompoundOp =
      unwrappedExpr !== null &&
      unwrappedExpr.type === "expression" &&
      (unwrappedExpr.childCount === 2 || unwrappedExpr.childCount === 3);
    if (isCompoundOp) {
      const relaxedVal = evalCstExprNode(exprCst, false);
      if (relaxedVal !== null) return relaxedVal;
    }
  } else {
    const directIdentVal = resolveIdentConstant(text, true);
    if (directIdentVal !== null) return directIdentVal;
    const arithVal = evalArithmeticText(text, subs, false);
    if (arithVal !== null) return arithVal;
  }

  return null;
}

/**
 * Domain-specific evaluator for Modelica media property functions (e.g. `specificEnthalpy_pTX`)
 * when resolving compile-time constant attributes during symbol table indexing.
 */
function evaluateMediumPropertyConstant(
  str: string,
  db: QueryDB,
  evalScope: SymbolId | undefined,
  isInteger: boolean,
  evalExprStr: (s: string) => DbConstantResult | null,
): { value: number; isInteger: boolean } | null {
  if (!evalScope) return null;
  const callNode = unwrapParenExprCst(parseStandaloneExpressionCst(str));
  if (!callNode || callNode.type !== "primary") return null;
  const rawCallee = callNode.childForFieldName("callee")?.text?.trim() ?? "";
  let callPkgPrefix: string | undefined;
  if (rawCallee === "specificEnthalpy_pTX") {
    callPkgPrefix = undefined;
  } else if (rawCallee.endsWith(".specificEnthalpy_pTX")) {
    const pfx = rawCallee.slice(0, -".specificEnthalpy_pTX".length);
    if (!isDottedIdentifierChain(pfx)) return null;
    callPkgPrefix = pfx;
  } else {
    return null;
  }
  const argNodes = extractFunctionCallArgExprNodesCst(callNode);
  if (argNodes.length !== 3) return null;
  const tArg = argNodes[1]!.text.trim();
  let mediumScopeId: SymbolId | undefined = evalScope;
  if (callPkgPrefix) {
    const resolvedPkg =
      db.query<SimpleNameResolver | null>("resolveName", evalScope)?.(callPkgPrefix) ??
      db.query<SimpleNameResolver | null>("resolveSimpleName", evalScope)?.(callPkgPrefix) ??
      db
        .byName(callPkgPrefix.split(".").pop()!)
        .find(
          (s) =>
            (s.kind === "Class" || s.kind === "Package") &&
            (s.name === callPkgPrefix || getSymbolQualifiedName(db, s.id).endsWith(callPkgPrefix)),
        );
    if (resolvedPkg) {
      let pkgSym: SymbolEntry = resolvedPkg;
      const seenAliases = new Set<SymbolId>();
      while (pkgSym && !seenAliases.has(pkgSym.id)) {
        seenAliases.add(pkgSym.id);
        if (!getShortClassSpecifierNode(db.cstNode(pkgSym.id) as SyntaxNode | null | undefined)) break;
        const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", pkgSym.id);
        if (nextBase) pkgSym = nextBase;
        else break;
      }
      mediumScopeId = pkgSym.id;
    }
  } else {
    const fnSym =
      db.query<SimpleNameResolver | null>("resolveSimpleName", evalScope)?.("specificEnthalpy_pTX") ??
      db.query<SimpleNameResolver | null>("resolveName", evalScope)?.("specificEnthalpy_pTX");
    if (fnSym?.parentId != null) {
      mediumScopeId = fnSym.parentId;
    }
  }
  const lookupScopedMediumConst = (constName: string) => {
    if (callPkgPrefix) {
      const qualRes = lookupDbConstant(`${callPkgPrefix}.${constName}`, db, evalScope);
      if (qualRes && typeof qualRes.value === "number") return qualRes;
    }
    const rawScopes = callPkgPrefix ? [mediumScopeId, evalScope] : [evalScope, mediumScopeId];
    const startScopes = rawScopes.filter((id, idx, arr): id is SymbolId => id !== undefined && arr.indexOf(id) === idx);
    for (const sId of startScopes) {
      const queue: SymbolId[] = [sId];
      const visited = new Set<SymbolId>();
      while (queue.length > 0) {
        const curId = queue.shift()!;
        if (visited.has(curId)) continue;
        visited.add(curId);
        const direct = db.childrenOf(curId).find((ch) => ch.kind === "Component" && ch.name === constName);
        if (direct) {
          const val = extractDbConstantValue(direct, db, sId);
          if (val && typeof val.value === "number") return val;
        }
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", curId);
        if (base && !visited.has(base.id)) queue.push(base.id);
        for (const ch of db.childrenOf(curId)) {
          if (ch.kind === "Extends") {
            const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
            if (extBase && !visited.has(extBase.id)) queue.push(extBase.id);
          }
        }
      }
    }
    return null;
  };
  const cpRes = lookupScopedMediumConst("cp_const");
  const t0Res = lookupScopedMediumConst("T0");
  const tRes =
    evalExprStr(tArg) ??
    (callPkgPrefix && tArg.startsWith(`${callPkgPrefix}.`) && mediumScopeId
      ? lookupDbConstant(tArg.slice(callPkgPrefix.length + 1), db, mediumScopeId)
      : null) ??
    lookupDbConstant(tArg, db, (callPkgPrefix ? mediumScopeId : evalScope) ?? mediumScopeId ?? evalScope);
  if (
    cpRes &&
    typeof cpRes.value === "number" &&
    t0Res &&
    typeof t0Res.value === "number" &&
    tRes &&
    typeof tRes.value === "number"
  ) {
    const val = cpRes.value * (tRes.value - t0Res.value);
    return { value: val, isInteger: isInteger && Number.isInteger(val) };
  }
  return null;
}

export function extractDbConstantValue(c: SymbolEntry, db: QueryDB, ownerScopeId?: SymbolId): DbConstantResult | null {
  const variability = db.query<string | null>("variability", c.id);
  if (variability !== "constant") {
    return null;
  }
  const dbExt = db as QueryDBWithConstCache;
  const evalScope = ownerScopeId ?? c.parentId ?? undefined;
  const typeSpec = db.query<string | null>("typeSpecifier", c.id);
  const isBoolean = typeSpec === "Boolean";
  const isInteger = isIntegerTypeSpec(typeSpec, db, undefined, evalScope);
  const evalExprStr = (rawStr: string): DbConstantResult | null => {
    const str = stripAnnotation(rawStr).trim();
    if (!str) return null;
    if (str === "true") return { value: 1, isInteger: true, isBoolean: true };
    if (str === "false") return { value: 0, isInteger: true, isBoolean: true };
    if (str.startsWith('"') && str.endsWith('"') && !str.slice(1, -1).includes('"')) {
      return { value: str.slice(1, -1), isInteger: false };
    }
    const exprCst = unwrapParenExprCst(parseStandaloneExpressionCst(str));
    if (exprCst && exprCst.type === "expression" && exprCst.child(0)?.text === "if") {
      let idx = 0;
      let matchedBranch: SyntaxNode | null = null;
      while (idx < exprCst.childCount) {
        const tok = exprCst.child(idx)?.text;
        if (
          (tok === "if" || tok === "elseif") &&
          idx + 3 < exprCst.childCount &&
          exprCst.child(idx + 2)?.text === "then"
        ) {
          const condStr = exprCst.child(idx + 1)!.text.trim();
          const condVal =
            condStr === "true"
              ? 1
              : condStr === "false"
                ? 0
                : (lookupDbConstant(condStr, db, evalScope)?.value ?? evalExprStr(condStr)?.value ?? null);
          if (typeof condVal !== "number") break;
          if (condVal !== 0) {
            matchedBranch = exprCst.child(idx + 3)!;
            break;
          }
          idx += 4;
          continue;
        }
        if (tok === "else" && idx + 1 < exprCst.childCount) {
          matchedBranch = exprCst.child(idx + 1)!;
          break;
        }
        idx++;
      }
      if (matchedBranch) {
        return evalExprStr(matchedBranch.text.trim());
      }
    }
    if (exprCst && exprCst.type === "primary") {
      const calleeText = exprCst.childForFieldName("callee")?.text?.trim();
      const argNodes = calleeText ? extractFunctionCallArgExprNodesCst(exprCst) : [];
      if (calleeText === "size" && (argNodes.length === 1 || argNodes.length === 2)) {
        const targetText = argNodes[0]!.text.trim();
        const arrRes = lookupDbConstant(targetText, db, evalScope) ?? evalExprStr(targetText);
        if (arrRes && Array.isArray(arrRes.value)) {
          const dimRes = argNodes[1] ? evalExprStr(argNodes[1].text.trim()) : { value: 1 };
          const dimIdx = dimRes && typeof dimRes.value === "number" ? Math.round(dimRes.value) : 1;
          if (dimIdx === 1) {
            return { value: arrRes.value.length, isInteger: true };
          }
        }
      }
      if (calleeText === "fill" && argNodes.length === 2) {
        const elemRes = evalExprStr(argNodes[0]!.text.trim());
        const countRes = evalExprStr(argNodes[1]!.text.trim());
        if (
          elemRes &&
          (typeof elemRes.value === "number" || typeof elemRes.value === "string") &&
          countRes &&
          typeof countRes.value === "number"
        ) {
          const cnt = Math.round(countRes.value);
          if (cnt >= 0 && cnt <= MAX_ARRAY_EXPANSION_LENGTH) {
            return {
              value: Array<number | string>(cnt).fill(elemRes.value),
              isInteger,
              ...(elemRes.isBoolean ? { isBoolean: true } : {}),
            };
          }
        }
      }
    }
    if (str.startsWith("{") && str.endsWith("}")) {
      const inner = str.slice(1, -1).trim();
      if (!inner) return { value: [], isInteger };
      const elemStrs = inner.split(",").map((s: string) => s.trim());
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
      const evaledElems: (number | string)[] = [];
      let allEvaled = true;
      for (const es of elemStrs) {
        const ev = evalExprStr(es);
        if (!ev || (typeof ev.value !== "number" && typeof ev.value !== "string")) {
          allEvaled = false;
          break;
        }
        evaledElems.push(ev.value);
      }
      if (allEvaled && evaledElems.length > 0) {
        return { value: evaledElems, isInteger };
      }
    }
    const num = parseFloat(str);
    if (!isNaN(num) && isSignedAsciiNumberText(str)) {
      return { value: num, isInteger: isInteger && Number.isInteger(num) };
    }
    if (isDottedIdentifierChain(stripLeadingDot(str))) {
      const chained = lookupDbConstant(str, db, evalScope);
      if (chained) {
        return {
          value: chained.value,
          isInteger: isInteger && chained.isInteger,
          ...(isBoolean || chained.isBoolean ? { isBoolean: true } : {}),
        };
      }
    }
    const knownVal = evalKnownConstantExprText(str, db, evalScope);
    if (knownVal !== null) {
      return { value: knownVal, isInteger: isInteger && Number.isInteger(knownVal) };
    }
    const mediumConst = evaluateMediumPropertyConstant(str, db, evalScope, isInteger, evalExprStr);
    if (mediumConst !== null) {
      return mediumConst;
    }
    let guardSet = dbExt._inExtractDbConst;
    if (!guardSet) {
      guardSet = new Set();
      dbExt._inExtractDbConst = guardSet;
    }
    if (!guardSet.has(c.id) && str !== c.name) {
      guardSet.add(c.id);
      try {
        const cstNum = evaluateCSTNumber(str, undefined, evalScope, db);
        if (cstNum !== null && !isNaN(cstNum)) {
          return { value: cstNum, isInteger: isInteger && Number.isInteger(cstNum) };
        }
      } finally {
        guardSet.delete(c.id);
      }
    }
    return null;
  };
  const getModArgBindingText = (arg: ModArgLike | undefined): string | undefined => {
    if (!arg) return undefined;
    const be = arg.bindingExpression;
    const beText = typeof be === "string" ? be : be?.text;
    return (arg.value?.text ?? beText)?.trim();
  };
  if (ownerScopeId && ownerScopeId !== c.parentId) {
    const ownerQueue: SymbolId[] = [ownerScopeId];
    const seenOwners = new Set<SymbolId>();
    while (ownerQueue.length > 0) {
      const curOwnerId = ownerQueue.shift()!;
      if (curOwnerId === c.parentId || seenOwners.has(curOwnerId)) continue;
      seenOwners.add(curOwnerId);
      const ownerMod = db.query<EffectiveModLike | null>("effectiveModification", curOwnerId);
      const matchingOwnerArg = ownerMod?.args
        ? [...ownerMod.args].reverse().find((a) => a && !a.isBreak && a.name === c.name)
        : undefined;
      const ownerBText = getModArgBindingText(matchingOwnerArg);
      if (ownerBText) {
        const res = evalExprStr(ownerBText);
        if (res) return res;
      } else if (matchingOwnerArg?.value?.kind === "literal" && typeof matchingOwnerArg.value.value === "number") {
        return {
          value: matchingOwnerArg.value.value,
          isInteger: isInteger && Number.isInteger(matchingOwnerArg.value.value),
        };
      } else if (matchingOwnerArg?.value?.kind === "literal" && typeof matchingOwnerArg.value.value === "boolean") {
        return {
          value: matchingOwnerArg.value.value ? 1 : 0,
          isInteger: true,
          isBoolean: true,
        };
      } else if (matchingOwnerArg?.value?.kind === "literal" && typeof matchingOwnerArg.value.value === "string") {
        return {
          value: matchingOwnerArg.value.value,
          isInteger: false,
        };
      }
      for (const extChild of db.childrenOf(curOwnerId) || []) {
        if (extChild.kind !== "Extends") continue;
        const extModRaw = db.query<ExtendsModResult>("extendsModificationParsed", extChild.id);
        const extArgs: readonly ModArgLike[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
        const matchingExtArg = [...extArgs].reverse().find((a) => a && !a.isBreak && a.name === c.name);
        const extBText = getModArgBindingText(matchingExtArg);
        if (extBText) {
          const res = evalExprStr(extBText) ?? lookupDbConstant(extBText, db, curOwnerId);
          if (res) return res;
        } else if (matchingExtArg?.value?.kind === "literal" && typeof matchingExtArg.value.value === "number") {
          return {
            value: matchingExtArg.value.value,
            isInteger: isInteger && Number.isInteger(matchingExtArg.value.value),
          };
        } else if (matchingExtArg?.value?.kind === "literal" && typeof matchingExtArg.value.value === "boolean") {
          return {
            value: matchingExtArg.value.value ? 1 : 0,
            isInteger: true,
            isBoolean: true,
          };
        } else if (matchingExtArg?.value?.kind === "literal" && typeof matchingExtArg.value.value === "string") {
          return {
            value: matchingExtArg.value.value,
            isInteger: false,
          };
        }
        const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", extChild.id);
        if (extBase && extBase.id !== c.parentId && !seenOwners.has(extBase.id)) {
          ownerQueue.push(extBase.id);
        }
      }
      const ownerCst = db.cstNode(curOwnerId) as SyntaxNode | null | undefined;
      const shortSpec = getShortClassSpecifierNode(ownerCst);
      const argExprNode = extractModArgBindingExprCst(shortSpec, c.name);
      const argExprText = argExprNode ? stripAnnotation(argExprNode.text ?? "").trim() : "";
      if (argExprText && argExprText !== "break") {
        const res = evalExprStr(argExprText);
        if (res) return res;
      }
      const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", curOwnerId);
      if (nextBase && nextBase.id === c.parentId) {
        break;
      }
      if (nextBase && nextBase.id !== curOwnerId && !seenOwners.has(nextBase.id)) {
        ownerQueue.push(nextBase.id);
      }
      if (ownerQueue.length === 0) {
        const encParentId = db.symbol(curOwnerId)?.parentId;
        if (encParentId && encParentId !== c.parentId && !seenOwners.has(encParentId)) {
          ownerQueue.push(encParentId);
        }
      }
    }
  }
  const mod = db.query<EffectiveModLike | null>("effectiveModification", c.id);
  const bText = mod?.bindingExpression?.text?.trim();
  if (bText) {
    const res = evalExprStr(bText);
    if (res) return res;
  }
  const cst = db.cstNode(c.id) as SyntaxNode | null | undefined;
  const bindingNode = extractBindingExprFromDeclCst(cst, c.name);
  const bindingText = bindingNode ? stripAnnotation(bindingNode.text ?? "").trim() : "";
  if (bindingText && bindingText !== "break") {
    const res = evalExprStr(bindingText);
    if (res) return res;
  }
  return null;
}

export function lookupDbConstant(fullName: string, db: QueryDB, rawScopeId?: SymbolId): DbConstantResult | null {
  const dbExt = db as QueryDBWithConstCache;
  const scopeSym = rawScopeId !== undefined ? db.symbol(rawScopeId) : undefined;
  const scopeId =
    scopeSym?.kind === "Component" && scopeSym.parentId !== null && scopeSym.parentId !== undefined
      ? scopeSym.parentId
      : rawScopeId;
  const rawFullName = fullName.trim();
  let cache = dbExt._dbConstantCache;
  if (!cache) {
    cache = new Map();
    dbExt._dbConstantCache = cache;
  }
  const cacheKey = `${scopeId ?? 0}:${rawFullName}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }
  cache.set(cacheKey, null);

  const compute = (): DbConstantResult | null => {
    const subMatch = parseTrailingSingleIntSubscript(rawFullName);
    if (subMatch) {
      const arrRes = lookupDbConstant(subMatch.base, db, scopeId);
      if (arrRes && Array.isArray(arrRes.value)) {
        const idx = subMatch.index;
        if (idx >= 1 && idx <= arrRes.value.length) {
          return {
            value: arrRes.value[idx - 1]!,
            isInteger: arrRes.isInteger,
            ...(arrRes.isBoolean ? { isBoolean: true } : {}),
          };
        }
      }
    }
    const hasLeadingDot = rawFullName.startsWith(".");
    const cleanFullName = hasLeadingDot ? rawFullName.slice(1) : rawFullName;
    if (cleanFullName === "ModelicaServices.Machine.eps") {
      return { value: MODELICA_EPS, isInteger: false };
    }
    if (cleanFullName === "ModelicaServices.Machine.small") {
      return { value: MODELICA_SMALL, isInteger: false };
    }
    const parseModValText = (valTextRaw: string, forceIsInt?: boolean): DbConstantResult | null => {
      const valText = valTextRaw.trim();
      if (valText === "true") return { value: 1, isInteger: true, isBoolean: true };
      if (valText === "false") return { value: 0, isInteger: true, isBoolean: true };
      if (valText.startsWith('"') && valText.endsWith('"') && !valText.slice(1, -1).includes('"')) {
        return { value: valText.slice(1, -1), isInteger: false };
      }
      const num = parseFloat(valText);
      if (!isNaN(num) && isSignedAsciiNumberText(valText)) {
        return {
          value: num,
          isInteger: forceIsInt !== undefined ? forceIsInt : Number.isInteger(num) && !valText.includes("."),
        };
      }
      return null;
    };
    if (scopeId && !hasLeadingDot) {
      const parts = cleanFullName.split(".");
      const checkArgsList = (currArgsInit: readonly ModArgLike[]): DbConstantResult | null => {
        let currArgs: readonly ModArgLike[] = currArgsInit;
        let matchedArg: ModArgLike | undefined = undefined;
        for (let i = 0; i < parts.length; i++) {
          const bIdx = parts[i]!.indexOf("[");
          const seg = bIdx >= 0 ? parts[i]!.slice(0, bIdx) : parts[i]!;
          matchedArg = [...currArgs].reverse().find((a) => a && !a.isBreak && a.name === seg);
          if (!matchedArg) break;
          if (i < parts.length - 1) {
            if (matchedArg.redeclaredTypeSpecifier) {
              const nextName = [matchedArg.redeclaredTypeSpecifier, ...parts.slice(i + 1)].join(".");
              if (nextName !== cleanFullName) {
                const res =
                  lookupDbConstant(nextName, db, scopeId) ??
                  (matchedArg.evaluationScopeId && matchedArg.evaluationScopeId !== scopeId
                    ? lookupDbConstant(nextName, db, matchedArg.evaluationScopeId)
                    : null);
                if (res) return res;
              }
            }
            currArgs = (matchedArg.nestedArgs ?? matchedArg.args ?? []) as readonly ModArgLike[];
          }
        }
        if (matchedArg) {
          const valObj = matchedArg.value ?? matchedArg.bindingExpression;
          const valText = typeof valObj === "string" ? valObj : (valObj?.text ?? String(valObj?.value ?? ""));
          const parsed = parseModValText(valText);
          if (parsed) return parsed;
        }
        return null;
      };
      const selfMod = db.query<EffectiveModLike | null>("effectiveModification", scopeId);
      if (selfMod?.args) {
        const res = checkArgsList(selfMod.args);
        if (res) return res;
      }
      const children = db.childrenOf(scopeId) || [];
      for (const child of children) {
        if (child.kind !== "Extends") continue;
        const extModRaw = db.query<ExtendsModResult>("extendsModificationParsed", child.id);
        const currArgs: readonly ModArgLike[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
        const res = checkArgsList(currArgs);
        if (res) return res;
      }
    }
    const parts = cleanFullName.split(".");
    if (parts.length === 0) return null;
    if (scopeId && parts.length === 1) {
      const targetName = hasLeadingDot ? rawFullName : cleanFullName;
      const resolver =
        db.query<SimpleNameResolver | null>("resolveName", scopeId) ??
        db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId);
      if (resolver) {
        const resolved = resolver(targetName);
        if (resolved && resolved.kind === "Component") {
          return extractDbConstantValue(resolved, db, scopeId);
        }
      }
      const extQueue: SymbolId[] = [scopeId];
      const seenExtBases = new Set<SymbolId>();
      while (extQueue.length > 0) {
        const curClsId = extQueue.shift()!;
        if (seenExtBases.has(curClsId)) continue;
        seenExtBases.add(curClsId);
        const directComp = db.childrenOf(curClsId).find((c) => c.kind === "Component" && c.name === targetName);
        if (directComp) {
          const res = extractDbConstantValue(directComp, db, scopeId);
          if (res) return res;
        }
        const baseRes = db.query<SimpleNameResolver | null>("resolveName", curClsId)?.(targetName);
        if (baseRes && baseRes.kind === "Component") {
          const res = extractDbConstantValue(baseRes, db, scopeId);
          if (res) return res;
        }
        const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", curClsId);
        if (nextBase && !seenExtBases.has(nextBase.id)) {
          extQueue.push(nextBase.id);
        }
        for (const ch of db.childrenOf(curClsId) || []) {
          if (ch.kind === "Extends") {
            const b = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
            if (b && !seenExtBases.has(b.id)) {
              extQueue.push(b.id);
            }
          }
        }
      }
      const scopeResId = db.symbol(scopeId)?.resourceId;
      const candidates = db.byName(parts[0]!);
      for (const c of candidates) {
        if (c.kind === "Component" && c.resourceId === scopeResId) {
          const res = extractDbConstantValue(c, db);
          if (res) return res;
        }
      }
      return null;
    }
    if (parts.length >= 2) {
      const resolveThroughComponent = (compSym: SymbolEntry, startIdx = 1): DbConstantResult | null => {
        const compMod =
          db.query<EffectiveModLike | null>("effectiveModification", compSym.id) ??
          (db.query<ComponentInstanceData | null>("componentInstance", compSym.id)?.modification as
            EffectiveModLike | undefined);
        const bindText = compMod?.bindingExpression?.text?.trim();
        if (bindText && isDottedIdentifierChain(stripLeadingDot(bindText)) && startIdx < parts.length) {
          const restPath = parts.slice(startIdx).join(".");
          const chainedRes = lookupDbConstant(`${bindText}.${restPath}`, db, compSym.parentId ?? scopeId);
          if (chainedRes) return chainedRes;
        }
        let currArgs: readonly ModArgLike[] = compMod?.args ? [...compMod.args] : [];
        let currComp: SymbolEntry | null = compSym;
        let currClassId: SymbolId | null = null;
        const resolveCompClassId = (cSym: SymbolEntry): SymbolId | null => {
          const ci = db.query<SymbolId | null>("classInstance", cSym.id);
          if (ci) return ci;
          const tSpec = db.query<string | null>("typeSpecifier", cSym.id);
          if (tSpec && cSym.parentId !== null) {
            const r =
              db.query<SimpleNameResolver | null>("resolveName", cSym.parentId)?.(tSpec) ??
              db.query<SimpleNameResolver | null>("resolveSimpleName", cSym.parentId)?.(tSpec);
            if (r && (r.kind === "Class" || r.kind === "Package")) return r.id;
          }
          return null;
        };
        currClassId = resolveCompClassId(compSym);
        for (let i = startIdx; i < parts.length; i++) {
          const bIdx = parts[i]!.indexOf("[");
          const seg = bIdx >= 0 ? parts[i]!.slice(0, bIdx) : parts[i]!;
          const matchedArg = currArgs.find((a) => a && !a.isBreak && a.name === seg);
          let memberSym: SymbolEntry | null = null;
          if (currClassId) {
            memberSym =
              db.query<SimpleNameResolver | null>("resolveSimpleName", currClassId)?.(seg) ??
              db.childrenOf(currClassId).find((c) => c.name === seg) ??
              null;
          }
          if (i === parts.length - 1) {
            if (matchedArg) {
              const valObj = matchedArg.value ?? matchedArg.bindingExpression;
              const valText = typeof valObj === "string" ? valObj : (valObj?.text ?? String(valObj?.value ?? ""));
              const memberTypeSpec = memberSym ? db.query<string | null>("typeSpecifier", memberSym.id) : null;
              const forceInt = memberTypeSpec
                ? isIntegerTypeSpec(memberTypeSpec, db, undefined, memberSym?.parentId ?? undefined)
                : undefined;
              const parsed = parseModValText(valText, forceInt);
              if (parsed) return parsed;
            }
            if (memberSym && memberSym.kind === "Component") {
              const res = extractDbConstantValue(memberSym, db, currClassId ?? undefined);
              if (res) return res;
            }
            return null;
          }
          if (matchedArg?.isRedeclaration && matchedArg.redeclaredTypeSpecifier) {
            const evalScope = matchedArg.evaluationScopeId ?? compSym.parentId ?? scopeId;
            const redeclTarget: SymbolEntry | null =
              (evalScope
                ? db.query<SimpleNameResolver | null>("resolveName", evalScope)?.(matchedArg.redeclaredTypeSpecifier)
                : null) ??
              db
                .byName(matchedArg.redeclaredTypeSpecifier.split(".").pop()!)
                .find((e) => e.kind === "Class" || e.kind === "Package") ??
              null;
            if (redeclTarget) {
              return lookupDbConstant(parts.slice(i + 1).join("."), db, redeclTarget.id);
            }
          }
          currArgs = matchedArg ? ((matchedArg.nestedArgs ?? matchedArg.args ?? []) as readonly ModArgLike[]) : [];
          if (memberSym && memberSym.kind === "Component") {
            currComp = memberSym;
            currClassId = resolveCompClassId(currComp);
          } else if (memberSym && (memberSym.kind === "Class" || memberSym.kind === "Package")) {
            currClassId = memberSym.id;
          } else {
            return null;
          }
        }
        return null;
      };
      const roots: SymbolEntry[] = [];
      if (scopeId) {
        const resolver =
          db.query<SimpleNameResolver | null>("resolveName", scopeId) ??
          db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId);
        const firstResolved = resolver?.(hasLeadingDot ? `.${parts[0]!}` : parts[0]!);
        if (firstResolved) {
          if (firstResolved.kind === "Component") {
            const compRes = resolveThroughComponent(firstResolved);
            if (compRes) return compRes;
          } else {
            roots.push(firstResolved);
          }
        }
      }
      for (const r of db.byName(parts[0]!)) {
        if (!roots.some((x) => x.id === r.id)) {
          roots.push(r);
        }
      }
      for (const root of roots) {
        if (root.kind === "Component") continue;
        if (hasLeadingDot && root.parentId !== null) continue;
        let currList: SymbolEntry[] = [root];
        let lastClassId: SymbolId | undefined = root.id;
        for (let i = 1; i < parts.length; i++) {
          const seg = parts[i]!;
          const nextList: SymbolEntry[] = [];
          for (const p of currList) {
            if (p.kind === "Component") {
              const compRes = resolveThroughComponent(p, i);
              if (compRes) return compRes;
              continue;
            }
            if (p.kind === "Class" || p.kind === "Package") {
              lastClassId = p.id;
            }
            for (const ch of db.childrenOf(p.id)) {
              if (ch.name === seg) {
                nextList.push(ch);
              }
            }
            if (nextList.length === 0) {
              const baseQueue: SymbolId[] = [];
              const seenBases = new Set<SymbolId>([p.id]);
              const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", p.id);
              if (directBase && !seenBases.has(directBase.id)) baseQueue.push(directBase.id);
              for (const ch of db.childrenOf(p.id)) {
                if (ch.kind === "Extends") {
                  const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
                  if (extBase && !seenBases.has(extBase.id)) baseQueue.push(extBase.id);
                }
              }
              while (baseQueue.length > 0 && nextList.length === 0) {
                const bid = baseQueue.shift()!;
                if (seenBases.has(bid)) continue;
                seenBases.add(bid);
                for (const ch of db.childrenOf(bid)) {
                  if (ch.name === seg) {
                    nextList.push(ch);
                  }
                }
                if (nextList.length === 0) {
                  const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", bid);
                  if (nextBase && !seenBases.has(nextBase.id)) baseQueue.push(nextBase.id);
                  for (const ch of db.childrenOf(bid)) {
                    if (ch.kind === "Extends") {
                      const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
                      if (extBase && !seenBases.has(extBase.id)) baseQueue.push(extBase.id);
                    }
                  }
                }
              }
            }
          }
          currList = nextList;
          if (currList.length === 0) break;
        }
        for (const c of currList) {
          if (c.kind === "Component") {
            const res = extractDbConstantValue(c, db, lastClassId);
            if (res) return res;
          }
        }
      }
      return null;
    }
    const leafName = parts[parts.length - 1]!;
    const candidates = db.byName(leafName);
    for (const c of candidates) {
      if (c.kind === "Component") {
        if (hasLeadingDot && c.parentId !== null) continue;
        const res = extractDbConstantValue(c, db);
        if (res) return res;
      }
    }
    return null;
  };

  const result = compute();
  cache.set(cacheKey, result);
  return result;
}
