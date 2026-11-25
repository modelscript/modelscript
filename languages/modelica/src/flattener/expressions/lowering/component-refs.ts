// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import {
  ArenaDAEPrinter,
  DAEBuilder,
  inferArenaExprVarType,
  matchVarPath,
  Variability,
  VarType,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { getFlatteningState, getNamedArrayShape, type FlatteningState } from "../../support/state.js";
import type { ComponentInstanceData, FlattenerCstNode, LoweringContext } from "../../types.js";
import {
  evalArithmeticText,
  evaluateCSTNumber,
  expandVarToArrayCtor,
  extractBindingExprFromDeclCst,
  flattenColonNodes,
  getBaseEnumSymbol,
  getCompDeclSubEnumInfo,
  getDaeArrayDimCount,
  getDaeDimSize,
  getEnumLiteralIndex,
  getSymbolEnumLiterals,
  getVarPrefixSet,
  isAsciiIdentifier,
  lookupDbConstant,
  parseEnumLiteralsText,
  resolveEnumType,
  resolveScopedName,
  stripArraySubscripts,
  stripLeadingDots,
  stripOuterDoubleQuotes,
  stripOuterSingleQuotes,
} from "../cst-utils.js";
import { evalDaeExpr } from "../eval.js";
import { getSymbolQualifiedName } from "../functions.js";

import {
  asDaeExt,
  asFlattenerExt,
  collectCstIdentifiers,
  cstHasTokenText,
  findLastItem,
  getDaeExtMeta,
  getModArgs,
  toDiagnosticRange,
} from "./helpers.js";
import { tryLowerSlicedCref } from "./subscripts-and-slices.js";
import type { EffectiveModLike, LowererDaeExt, LowerExprFn, ModArgLike, ScopeDataLike } from "./types.js";

export function lowerComponentRefCSTExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  state: FlatteningState,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener, noArrayExpand, isAssignmentLhs } = ctx;
  const type = node.type;
  // ============================================================================
  // Identifier, Name & Multi-Dimensional Component Reference Lowering
  // ============================================================================
  // Identifier / Name / Component Reference
  if (
    type === "identifier" ||
    type === "name" ||
    type === "component_reference" ||
    (node.childCount === 0 && isAsciiIdentifier(node.text?.trim() ?? ""))
  ) {
    let rawName = node.text.trim();
    // 1. Check active loop/comprehension/function-inlining substitution bindings first
    if (substitutions && substitutions.has(rawName)) {
      const sVal = substitutions.get(rawName)!;
      if (typeof sVal === "number") {
        return dae.addIntLiteral(sVal);
      }
      if (typeof sVal === "string" && sVal.startsWith("expr:")) {
        return Number(sVal.slice(5));
      }
      if (sVal === "true" || sVal === "false") {
        return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
      }
      if (typeof sVal === "string" && sVal.includes(".")) {
        const lastDot = sVal.lastIndexOf(".");
        const pfx = sVal.slice(0, lastDot);
        const lit = sVal.slice(lastDot + 1);
        const scopeId =
          flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
        const enumInfo = resolveEnumType(pfx, scopeId, db);
        if (enumInfo) {
          const idx = enumInfo.literals.indexOf(lit);
          if (idx >= 0) {
            let qual = enumInfo.qual;
            const rootName =
              (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
              asDaeExt(dae).className;
            if (!dae.extensionMetadata?.["isOldFrontend"] && rootName && qual.startsWith(`${rootName}.`)) {
              qual = qual.slice(rootName.length + 1);
            }
            return dae.addEnumLiteral(idx + 1, `${qual}.${lit}`);
          }
        }
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
    }
    if (flattener?.activeLoopVars?.has(rawName)) {
      return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
    }

    // 2. Decompose structured `component_reference` CST into dot-separated segments (`rawParts`),
    //    evaluating each subscript as a scalar index, `:` slice, `1:N` range, vector index, or boolean mask.
    if (type === "component_reference") {
      interface RawPartSubscript {
        node: SyntaxNode | null;
        text: string;
        isSlice: boolean;
        values: number[];
        scalarText?: string | undefined;
        isRealSub?: boolean | undefined;
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
              const expr = sub.children?.find((k) => k.type === "expression") ?? sub;
              const subText = expr.text?.trim() ?? "";

              let isConnRef = false;
              let currP = node.parent;
              while (currP) {
                const pType = currP.type;
                if (pType === "connect_equation" || pType === "connect_clause" || pType === "ConnectEquation") {
                  isConnRef = true;
                  break;
                }
                if (
                  (pType === "primary" || pType === "function_call" || pType === "FunctionCall") &&
                  (currP.child(0)?.text?.trim() === "inStream" || currP.child(0)?.text?.trim() === "actualStream")
                ) {
                  isConnRef = true;
                  break;
                }
                if (pType === "function_call_args" || pType === "FunctionCallArgs") {
                  const c0 = currP.parent?.child(0)?.text?.trim();
                  if (c0 === "inStream" || c0 === "actualStream") {
                    isConnRef = true;
                    break;
                  }
                }
                if (pType === "simple_equation" || pType?.endsWith("_equation") || pType === "component_clause") {
                  break;
                }
                currP = currP.parent;
              }

              if (isConnRef) {
                const idMatches = collectCstIdentifiers(expr ?? sub);
                if (idMatches.length > 0) {
                  for (const idm of idMatches) {
                    if (
                      idm === "true" ||
                      idm === "false" ||
                      idm === "end" ||
                      idm === "if" ||
                      idm === "then" ||
                      idm === "else" ||
                      idm === "elseif" ||
                      substitutions?.has(idm) ||
                      flattener?.activeLoopVars?.has(idm)
                    )
                      continue;
                    let isLoop = false;
                    let p = node?.parent;
                    while (p) {
                      if (p.type === "for_equation" || p.type === "for_statement") {
                        const indicesNode = (p.children || []).find((c) => c.type === "for_indices");
                        const forIndices = (indicesNode?.children || []).filter((c) => c.type === "for_index");
                        for (const fi of forIndices) {
                          const vName = Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim();
                          if (vName === idm) {
                            isLoop = true;
                            break;
                          }
                        }
                        if (isLoop) break;
                      }
                      p = p.parent;
                    }
                    if (isLoop) continue;
                    const candidates = [
                      prefix ? `${prefix}.${idm}` : idm,
                      prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                      idm,
                    ];
                    let foundVarIdx = -1;
                    for (const c of candidates) {
                      const vi = dae.lookupVariable(c);
                      if (vi >= 0) {
                        foundVarIdx = vi;
                        break;
                      }
                    }
                    let isParam = false;
                    if (foundVarIdx >= 0) {
                      const vari = dae.getVarVariability(foundVarIdx);
                      if (vari === Variability.Parameter || vari === Variability.Constant) {
                        isParam = true;
                        if (
                          !dae.extensionMetadata?.["isOldFrontend"] &&
                          vari === Variability.Parameter &&
                          dae.getVarType(foundVarIdx) === VarType.Integer
                        ) {
                          dae.setVarFinal(foundVarIdx, true);
                        }
                      }
                    } else if (db) {
                      const classId = flattener?.currentRootClassId;
                      if (classId) {
                        const resolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId);
                        const sym = resolver ? resolver(idm) : null;
                        if (sym) {
                          const symVari = db.query<string | null>("variability", sym.id);
                          if (symVari === "parameter" || symVari === "constant") {
                            isParam = true;
                          }
                        }
                      }
                    }
                    if (!isParam) {
                      const r = {
                        startOffset: node.startIndex ?? node.startOffset ?? 0,
                        endOffset: node.endIndex ?? node.endOffset ?? 0,
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                      };
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
                        message: `Connector '${node.text?.trim() ?? ""}' has non-parameter subscript '${subText}'.`,
                        range: r,
                      });
                      return -1;
                    }
                  }
                }
              }
              const dimIdx = lastPart.subscripts.length;
              const needsDimSize = subText === ":" || cstHasTokenText(expr ?? sub, "end");
              const fullIdent = needsDimSize ? rawParts.map((p) => p.ident).join(".") : "";
              const fullIdentWithSubs = needsDimSize
                ? rawParts
                    .map((p, pIdx) => {
                      if (pIdx < rawParts.length - 1 && p.subscripts.length > 0) {
                        const subIdx = p.subscripts
                          .map((s) => (s.values && s.values.length > 0 ? s.values[0] : 1))
                          .join(",");
                        return `${p.ident}[${subIdx}]`;
                      }
                      return p.ident;
                    })
                    .join(".")
                : "";
              const dimSize = needsDimSize
                ? (fullIdentWithSubs !== fullIdent ? getDaeDimSize(prefix, fullIdentWithSubs, dimIdx, dae, db) : 0) ||
                  getDaeDimSize(prefix, fullIdent, dimIdx, dae, db) ||
                  getDaeDimSize(prefix, lastPart.ident, dimIdx, dae, db)
                : 0;
              let subsWithEnd: Map<string, number | string> | undefined = substitutions;
              if (dimSize > 0) {
                subsWithEnd = new Map<string, number | string>(substitutions ? substitutions : []);
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
                  if (isNaN(iv)) {
                    const ev =
                      evaluateCSTNumber(it, subsWithEnd, undefined, db, dae, prefix) ??
                      evalArithmeticText(it, subsWithEnd);
                    if (ev !== null) iv = ev;
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
                let startNode: SyntaxNode | null = null;
                let stepNode: SyntaxNode | null = null;
                let stopNode: SyntaxNode | null = null;
                const colonNodes = expr ? flattenColonNodes(expr) : [];
                if (colonNodes.length === 2) {
                  startNode = colonNodes[0] ?? null;
                  stopNode = colonNodes[1] ?? null;
                } else if (colonNodes.length === 3) {
                  startNode = colonNodes[0] ?? null;
                  stepNode = colonNodes[1] ?? null;
                  stopNode = colonNodes[2] ?? null;
                } else if (expr.childCount === 3 && (expr.child(1)?.text?.trim() ?? "") === ":") {
                  const c0 = expr.child(0);
                  if (c0 && c0.childCount === 3 && (c0.child(1)?.text?.trim() ?? "") === ":") {
                    startNode = c0.child(0);
                    stepNode = c0.child(2);
                    stopNode = expr.child(2);
                  } else {
                    startNode = c0;
                    stopNode = expr.child(2);
                  }
                }
                const evalBound = (bNode: SyntaxNode | string | null | undefined): number | null => {
                  if (!bNode) return null;
                  const t = (typeof bNode === "string" ? bNode : bNode.text)?.trim() ?? "";
                  if (t === "end") return dimSize > 0 ? dimSize : null;
                  if (t === "false") return 1;
                  if (t === "true") return 2;
                  if (subsWithEnd && subsWithEnd.has(t)) {
                    const s = subsWithEnd.get(t);
                    if (typeof s === "number") return s;
                  }
                  const numVal = evaluateCSTNumber(bNode, subsWithEnd, undefined, db, dae, prefix);
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
                    startVal = evalBound(colonParts[0]);
                    stopVal = evalBound(colonParts[1]);
                  } else if (colonParts.length === 3) {
                    startVal = evalBound(colonParts[0]);
                    stepVal = evalBound(colonParts[1]) ?? 1;
                    stopVal = evalBound(colonParts[2]);
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
              let isLoopVar = false;
              let isRealSub = false;
              const checkSubNode = expr ?? sub;
              const subWalkStack: SyntaxNode[] = checkSubNode ? [checkSubNode] : [];
              while (subWalkStack.length > 0) {
                const curNode = subWalkStack.pop();
                if (!curNode) continue;
                if (
                  flattener?.activeLoopVars &&
                  flattener.activeLoopVars.size > 0 &&
                  curNode.type === "identifier" &&
                  flattener.activeLoopVars.has(curNode.text?.trim() ?? "")
                ) {
                  isLoopVar = true;
                }
                if (curNode.type === "unsigned_real") {
                  isRealSub = true;
                } else if (
                  curNode.type === "expression" &&
                  curNode.childCount === 3 &&
                  stripOuterDoubleQuotes(curNode.child(1)?.text?.trim() ?? curNode.child(1)?.type ?? "") === "/"
                ) {
                  isRealSub = true;
                }
                for (let ci = (curNode.childCount ?? 0) - 1; ci >= 0; ci--) {
                  const ch = curNode.child(ci);
                  if (ch) subWalkStack.push(ch);
                }
              }
              if (flattener?.activeLoopVars?.has(subText)) {
                isLoopVar = true;
              }
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

              if (isLoopVar) isRealSub = false;
              const isBoolLiteralSub = subText === "false" || subText === "true";
              const evaluatedNum =
                isLoopVar || isRealSub || isBoolLiteralSub
                  ? null
                  : (evaluateCSTNumber(expr, subsWithEnd, undefined, undefined, dae, prefix) ??
                    evalArithmeticText(subText, subsWithEnd));
              if (evaluatedNum !== null) {
                if (db && !isLoopVar) {
                  const classId = flattener?.currentClassId ?? flattener?.currentRootClassId;
                  const resolver = classId
                    ? db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)
                    : null;
                  const compSym = resolver ? resolver(lastPart.ident) : null;
                  if (compSym && classId) {
                    const enumInfo = getCompDeclSubEnumInfo(compSym, dimIdx, classId, db);
                    if (enumInfo) {
                      let cur: SyntaxNode | null | undefined = node;
                      while (
                        cur &&
                        cur.type !== "component_clause" &&
                        cur.type !== "simple_equation" &&
                        cur.type !== "statement" &&
                        cur.type !== "assignment_statement"
                      ) {
                        cur = cur.parent;
                      }
                      const diagRange = getElementDiagRange(cur ?? node);
                      const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
                      const enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                        message: `Subscript '${subText}' has type Integer, expected type ${enumTypeStr}.`,
                        range: diagRange,
                      });
                      return -1;
                    }
                  }
                }
                lastPart.subscripts.push({
                  node: sub,
                  text: subText,
                  isSlice: false,
                  values: [evaluatedNum],
                  scalarText: String(evaluatedNum),
                });
              } else {
                const subId = lowerExpr(expr, dae, prefix, subsWithEnd, imports, db, flattener);
                if (subId >= 0) {
                  const subType = inferArenaExprVarType(dae, subId);
                  const subKind = dae.getExprKind(subId);
                  if (subKind === ExprKind.StringLiteral || subType === VarType.String) {
                    let cur: SyntaxNode | null | undefined = node;
                    while (
                      cur &&
                      cur.type !== "component_clause" &&
                      cur.type !== "simple_equation" &&
                      cur.type !== "statement" &&
                      cur.type !== "assignment_statement"
                    ) {
                      cur = cur.parent;
                    }
                    const diagRange = getElementDiagRange(cur ?? node);
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                      message: `Subscript '${subText}' has type String, expected type Integer.`,
                      range: diagRange,
                    });
                    return -1;
                  }
                  if (db && !isLoopVar && (subKind === ExprKind.IntLiteral || subType === VarType.Integer)) {
                    const classId = flattener?.currentClassId ?? flattener?.currentRootClassId;
                    const resolver = classId
                      ? db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)
                      : null;
                    const compSym = resolver ? resolver(lastPart.ident) : null;
                    if (compSym && classId) {
                      const enumInfo = getCompDeclSubEnumInfo(compSym, dimIdx, classId, db);
                      if (enumInfo) {
                        let cur: SyntaxNode | null | undefined = node;
                        while (
                          cur &&
                          cur.type !== "component_clause" &&
                          cur.type !== "simple_equation" &&
                          cur.type !== "statement" &&
                          cur.type !== "assignment_statement"
                        ) {
                          cur = cur.parent;
                        }
                        const diagRange = getElementDiagRange(cur ?? node);
                        const simpleName = enumInfo.qual.includes(".")
                          ? enumInfo.qual.split(".").pop()!
                          : enumInfo.qual;
                        const enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                          message: `Subscript '${subText}' has type Integer, expected type ${enumTypeStr}.`,
                          range: diagRange,
                        });
                        return -1;
                      }
                    }
                  }
                  if (subType === VarType.Real && !isLoopVar) {
                    isRealSub = true;
                  }
                  let numVal: number | null = null;
                  let enumLiteralText: string | null = null;
                  if (dae.getExprKind(subId) === ExprKind.EnumLiteral && !isLoopVar) {
                    numVal = dae.getExprData1(subId);
                    enumLiteralText = dae.interner.resolve(dae.getExprLeft(subId));
                  } else if (dae.getExprKind(subId) === ExprKind.BoolLiteral && !isLoopVar) {
                    numVal = dae.getExprData1(subId) ? 2 : 1;
                    enumLiteralText = dae.getExprData1(subId) ? "true" : "false";
                  } else if (dae.getExprKind(subId) === ExprKind.IntLiteral && !isRealSub && !isLoopVar) {
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
                      scalarText: enumLiteralText ?? String(numVal),
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
                  state.modelName ??
                  "";
                let stmtNode: SyntaxNode | null | undefined = node;
                let curr = node.parent;
                while (curr) {
                  if (
                    curr.type === "component_clause" ||
                    curr.type === "simple_equation" ||
                    curr.type?.endsWith("_equation")
                  ) {
                    stmtNode = curr;
                    break;
                  }
                  curr = curr.parent;
                }
                const r = {
                  startOffset: stmtNode.startIndex ?? stmtNode.startOffset,
                  endOffset: stmtNode.endIndex ?? stmtNode.endOffset,
                  startPosition: stmtNode.startPosition,
                  endPosition: stmtNode.endPosition,
                };
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.code,
                  message: `Subscript ${subText} of type Real is not a subtype of Integer, Boolean or enumeration.`,
                  range: r,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
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
          let expectedDimCount =
            getDaeArrayDimCount(prefix, fullIdent, dae, db) ??
            (pi === 0 ? getDaeArrayDimCount(prefix, p.ident, dae, db) : null);

          let isKnownTypeOrClass =
            p.ident === "Boolean" ||
            p.ident === "Real" ||
            p.ident === "Integer" ||
            p.ident === "String" ||
            p.ident === "StateSelect" ||
            p.ident === "AssertionLevel" ||
            p.ident === "ExternalObject" ||
            Boolean(db && db.byName(p.ident).some((s) => s.kind === "Class" || s.kind === "Type"));
          if (expectedDimCount === null) {
            if (isKnownTypeOrClass) {
              expectedDimCount = 0;
            } else if (fullIdent === "time" || p.ident === "time") {
              expectedDimCount = 0;
            } else if (flattener?.activeLoopVars?.has(p.ident) || (substitutions && substitutions.has(p.ident))) {
              expectedDimCount = 0;
            } else if (db && fullIdent.includes(".")) {
              const dotIdx = fullIdent.lastIndexOf(".");
              const enumTypeName = fullIdent.slice(0, dotIdx);
              const litName = fullIdent.slice(dotIdx + 1);
              const leafTypeName = enumTypeName.includes(".") ? enumTypeName.split(".").pop()! : enumTypeName;
              const typeTargets = db.byName(leafTypeName);
              for (const candidate of typeTargets) {
                const literals = getSymbolEnumLiterals(db, candidate);
                if (literals && literals.includes(litName)) {
                  expectedDimCount = 0;
                  break;
                }
              }
            }
          }
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
                  let stmtNode: SyntaxNode | null | undefined = node;
                  let curr = node.parent;
                  let inIfBranch = false;
                  while (curr) {
                    if (curr.type === "if_equation" || curr.type === "if_statement") {
                      inIfBranch = true;
                    }
                    if (
                      curr.type === "connect_equation" ||
                      curr.type === "simple_equation" ||
                      curr.type === "component_clause" ||
                      curr.type === "for_equation" ||
                      curr.type === "for_statement" ||
                      curr.type === "element_modification" ||
                      curr.type === "element_modification_or_replaceable" ||
                      curr.type?.endsWith("_equation")
                    ) {
                      stmtNode = curr;
                      break;
                    }
                    curr = curr.parent;
                  }
                  if (inIfBranch) {
                    continue;
                  }
                  const r = {
                    startOffset: stmtNode.startIndex ?? stmtNode.startOffset,
                    endOffset: stmtNode.endIndex ?? stmtNode.endOffset,
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
                  const isConnect = stmtNode.type === "connect_equation";
                  const targetRefStr = isConnect ? refStr : rawParts[pi]!.ident;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ARRAY_INDEX_OUT_OF_BOUNDS.code,
                    message: `Subscript '${v}' for dimension ${d + 1} (size = ${dimSize}) of ${targetRefStr} is out of bounds.`,
                    range: r,
                  });
                  return -1;
                }
              }
            }
          }

          if (expectedDimCount !== null && p.subscripts.length > expectedDimCount) {
            let stmtNode: SyntaxNode | null | undefined = node;
            let curr = node.parent;
            while (curr) {
              if (
                curr.type === "component_clause" ||
                curr.type === "simple_equation" ||
                curr.type === "for_equation" ||
                curr.type === "for_statement" ||
                curr.type === "element_modification" ||
                curr.type === "element_modification_or_replaceable" ||
                curr.type?.endsWith("_equation")
              ) {
                stmtNode = curr;
                break;
              }
              curr = curr.parent;
            }
            const r = {
              startOffset: stmtNode.startIndex ?? stmtNode.startOffset,
              endOffset: stmtNode.endIndex ?? stmtNode.endOffset,
              startPosition: stmtNode.startPosition,
              endPosition: stmtNode.endPosition,
            };
            const subStrs = p.subscripts.map(
              (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text),
            );
            const delim = getDaeExtMeta(dae)?.isOldFrontend ? "," : ", ";
            const rawRefText = node?.text?.trim();
            const refStr = getDaeExtMeta(dae)?.isOldFrontend
              ? rawParts
                  .map((x, idx) =>
                    idx === pi
                      ? `${x.ident}[${subStrs.join(delim)}]`
                      : x.hasSubscripts
                        ? `${x.ident}[${x.subscripts.map((s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text)).join(delim)}]`
                        : x.ident,
                  )
                  .join(".")
              : rawRefText && rawRefText.startsWith(rawParts[0]?.ident ?? "")
                ? rawRefText
                : rawParts
                    .map((x, idx) =>
                      idx === pi
                        ? `${x.ident}[${subStrs.join(delim)}]`
                        : x.hasSubscripts
                          ? `${x.ident}[${x.subscripts.map((s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : s.text)).join(delim)}]`
                          : x.ident,
                    )
                    .join(".");
            const actualCount =
              pi < rawParts.length - 1 ? rawParts[rawParts.length - 1]!.subscripts.length : p.subscripts.length;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.code,
              message: ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.message(refStr, actualCount, expectedDimCount),
              range: r,
            });
            if (flattener?.options?.omcCompatibility && getDaeExtMeta(dae)?.isOldFrontend) {
              const scopeName = flattener?.currentRootClassId
                ? (flattener.db?.symbol(flattener.currentRootClassId)?.name ?? "")
                : "";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refStr, scopeName),
                range: r,
              });
            }
            return -1;
          }
        }
      }

      if (!isAssignmentLhs && rawParts.length > 0 && rawParts[0]!.hasSubscripts) {
        const baseName = resolveScopedName(rawParts[0]!.ident, prefix, dae, state.innerOuterComponents);
        const baseShape = getNamedArrayShape(dae, baseName);
        if (baseShape && baseShape.length > 0 && baseShape.every((d: number) => d >= 0) && baseShape.includes(0)) {
          const baseId = dae.addArrayCtorExpr([]);
          const subExprs = rawParts[0]!.subscripts.map((s) => {
            if (s.node) {
              const exprNode = s.node.children?.find((k) => k.type === "expression") ?? s.node;
              if (exprNode && exprNode.text?.trim() !== ":") {
                const eId = lowerExpr(exprNode, dae, prefix, substitutions, imports, db, flattener);
                if (eId >= 0) return eId;
              }
            }
            return dae.addExpression(ExprKind.Name, dae.interner.intern(s.text));
          });
          return dae.addSubscriptExpr(baseId, subExprs);
        }
      }

      if (!isAssignmentLhs && rawParts.length >= 2 && (state.inAlgorithmSection || dae.classKind === "function")) {
        const slicedRes = tryLowerSlicedCref(rawParts, dae, prefix, db, flattener);
        if (slicedRes) {
          state.lastLoweredShape = slicedRes.shape;
          return slicedRes.exprId;
        }
      }

      const hasSlice = rawParts.some((p) => p.subscripts.some((s) => s.isSlice));
      if (hasSlice) {
        if (isAssignmentLhs && rawParts.length === 1) {
          const p = rawParts[0]!;
          const baseName = resolveScopedName(p.ident, prefix, dae, state.innerOuterComponents);
          const baseId = dae.addExpression(ExprKind.Name, dae.interner.intern(baseName));
          const subExprs = p.subscripts.map((s) => {
            if (s.text === ":") {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(":"));
            }
            if (s.isSlice && s.values.length > 0) {
              return dae.addArrayCtorExpr(s.values.map((v) => dae.addIntLiteral(v)));
            }
            if (s.node) {
              const exprNode = s.node.children?.find((k) => k.type === "expression") ?? s.node;
              if (exprNode && exprNode.text?.trim() !== ":") {
                const eId = lowerExpr(exprNode, dae, prefix, substitutions, imports, db, flattener);
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
            let pIdent = p.ident;
            if (substitutions && substitutions.has(p.ident)) {
              const s = substitutions.get(p.ident);
              if (typeof s === "string") pIdent = s;
            }
            if (!p.hasSubscripts) {
              concreteParts.push(pIdent);
            } else {
              const subStrs: (string | number)[] = [];
              for (const s of p.subscripts) {
                if (s.isSlice) {
                  subStrs.push(chosenSliceIndices[sIdx++]!);
                } else {
                  subStrs.push(s.scalarText ?? (s.values[0] !== undefined ? s.values[0] : ""));
                }
              }
              concreteParts.push(`${pIdent}[${subStrs.join(",")}]`);
            }
          }
          let concreteName = concreteParts.join(".");
          const localConcreteCand = resolveScopedName(concreteName, prefix, dae, state.innerOuterComponents);
          if (
            imports &&
            imports.has(rawParts[0]!.ident) &&
            dae.getVarIdxByName(localConcreteCand) < 0 &&
            !dae.hasArrayElements(localConcreteCand)
          ) {
            concreteName = [imports.get(rawParts[0]!.ident)!, ...concreteParts.slice(1)].join(".");
          }
          const candidate = resolveScopedName(concreteName, prefix, dae, state.innerOuterComponents);
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
            if (exprId !== undefined && exprId >= 0) {
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
            const pkgScopeId = flattener?.currentParentMods?.packageScopeId;
            const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
            const constRes =
              (pkgScopeId ? lookupDbConstant(baseName, db, pkgScopeId) : null) ??
              lookupDbConstant(baseName, db, scopeId);
            if (constRes && Array.isArray(constRes.value)) {
              let val: unknown = constRes.value;
              for (const idx of subIndices) {
                if (Array.isArray(val) && idx >= 1 && idx <= val.length) {
                  val = val[idx - 1];
                } else {
                  val = null;
                  break;
                }
              }
              if (typeof val === "string") {
                return dae.addStringLiteral(val);
              }
              if (typeof val === "number") {
                if (constRes.isBoolean) return dae.addBoolLiteral(val !== 0);
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

      if (
        rawParts.length === 1 &&
        !rawParts[0]!.hasSubscripts &&
        substitutions &&
        substitutions.has(rawParts[0]!.ident)
      ) {
        const sVal = substitutions.get(rawParts[0]!.ident)!;
        if (typeof sVal === "number") return dae.addIntLiteral(sVal);
        if (typeof sVal === "string" && sVal.startsWith("expr:")) return Number(sVal.slice(5));
        if (sVal === "true" || sVal === "false") {
          return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
        }
      }
      const parts: string[] = [];
      for (const p of rawParts) {
        let pIdent = p.ident;
        if (substitutions && substitutions.has(p.ident)) {
          const s = substitutions.get(p.ident);
          if (typeof s === "string") pIdent = s;
        }
        if (!p.hasSubscripts) {
          parts.push(pIdent);
        } else {
          const subStrs = p.subscripts.map(
            (s) => s.scalarText ?? (s.values[0] !== undefined ? String(s.values[0]) : ""),
          );
          parts.push(`${pIdent}[${subStrs.join(",")}]`);
        }
      }
      if (parts.length > 0) {
        let joined = parts.join(".");
        const localJoinedCand = resolveScopedName(joined, prefix, dae, state.innerOuterComponents, true);
        if (
          imports &&
          imports.has(parts[0]!) &&
          dae.getVarIdxByName(localJoinedCand) < 0 &&
          !dae.hasArrayElements(localJoinedCand)
        ) {
          joined = [imports.get(parts[0]!)!, ...parts.slice(1)].join(".");
        }
        let candidate = resolveScopedName(joined, prefix, dae, state.innerOuterComponents, true);
        if (
          (rawParts.length >= 2 || (flattener?.activeLoopVars && flattener.activeLoopVars.size > 0)) &&
          rawParts.some((p) => p.hasSubscripts) &&
          dae.getVarIdxByName(candidate) < 0
        ) {
          const soaIdents = rawParts.map((p) => {
            let pIdent = p.ident;
            if (substitutions && substitutions.has(p.ident)) {
              const s = substitutions.get(p.ident);
              if (typeof s === "string") pIdent = s;
            }
            return pIdent;
          });
          let soaJoined = soaIdents.join(".");
          if (imports && imports.has(soaIdents[0]!)) {
            soaJoined = [imports.get(soaIdents[0]!)!, ...soaIdents.slice(1)].join(".");
          }
          const soaCandidate = resolveScopedName(soaJoined, prefix, dae, state.innerOuterComponents, true);
          const soaVarIdx = dae.getVarIdxByName(soaCandidate);
          if (soaVarIdx >= 0 && (dae.getVarShape(soaVarIdx)?.length ?? 0) > 0) {
            const combinedSubExprs: number[] = [];
            for (const p of rawParts) {
              if (p.hasSubscripts) {
                for (const s of p.subscripts) {
                  if (s.text === ":") {
                    combinedSubExprs.push(dae.addColonExpr());
                  } else if (s.node) {
                    const exprNode = s.node.children?.find((k) => k.type === "expression") ?? s.node;
                    const eId = lowerExpr(exprNode, dae, prefix, substitutions, imports, db, flattener);
                    if (eId >= 0) {
                      combinedSubExprs.push(eId);
                    } else if (s.values.length === 1) {
                      combinedSubExprs.push(dae.addIntLiteral(s.values[0]!));
                    } else {
                      combinedSubExprs.push(
                        dae.addExpression(ExprKind.Name, dae.interner.intern(s.scalarText ?? s.text)),
                      );
                    }
                  } else if (s.values.length === 1) {
                    combinedSubExprs.push(dae.addIntLiteral(s.values[0]!));
                  } else {
                    combinedSubExprs.push(
                      dae.addExpression(ExprKind.Name, dae.interner.intern(s.scalarText ?? s.text)),
                    );
                  }
                }
              }
            }
            if (combinedSubExprs.length > 0) {
              const baseExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(soaCandidate));
              return dae.addSubscriptExpr(baseExprId, combinedSubExprs);
            }
          }
        }
        let vIdx = -1;
        if (!flattener?.activeLoopVars?.has(joined) && (!parts[0] || !flattener?.activeLoopVars?.has(parts[0]))) {
          vIdx = dae.getVarIdxByName(candidate);
          if (vIdx < 0 && dae.classKind === "function" && asDaeExt(dae).componentPrefix) {
            let rootDae: LowererDaeExt = asDaeExt(dae);
            while (rootDae.parentDae) rootDae = rootDae.parentDae;
            const compCand = `${asDaeExt(dae).componentPrefix}.${candidate}`;
            const compVIdx = rootDae.getVarIdxByName(compCand);
            if (compVIdx >= 0 && rootDae.getVarVariability(compVIdx) === Variability.Constant) {
              const exprId = rootDae.getVarExpression(compVIdx);
              if (exprId !== undefined && exprId >= 0) {
                const k = rootDae.getExprKind(exprId);
                if (k === ExprKind.RealLiteral) return dae.addRealLiteral(rootDae.getExprRealValue(exprId));
                if (k === ExprKind.IntLiteral) return dae.addIntLiteral(rootDae.getExprData1(exprId));
                if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(rootDae.getExprData1(exprId) !== 0);
              }
            }
          }
          if (vIdx >= 0) {
            const isConstVar = dae.getVarVariability(vIdx) === Variability.Constant;
            const isEvalParam =
              !isConstVar &&
              !isAssignmentLhs &&
              !state.isInsideClock &&
              dae.classKind !== "function" &&
              !dae.extensionMetadata?.["isOldFrontend"] &&
              !flattener?.isOldFrontend &&
              Boolean(state.evaluatedParams?.has(candidate));
            if (isConstVar || isEvalParam) {
              const exprId = dae.getVarExpression(vIdx);
              if (exprId !== undefined && exprId >= 0) {
                const k = dae.getExprKind(exprId);
                if (k === ExprKind.RealLiteral) return dae.addRealLiteral(dae.getExprRealValue(exprId));
                if (k === ExprKind.IntLiteral) return dae.addIntLiteral(dae.getExprData1(exprId));
                if (isConstVar && k === ExprKind.BoolLiteral) return dae.addBoolLiteral(dae.getExprData1(exprId) !== 0);
              }
            }
            if (
              !isAssignmentLhs &&
              !noArrayExpand &&
              flattener?.options?.arrayMode !== "preserve" &&
              !candidate.includes("[") &&
              (dae.hasArrayElements(candidate) || (dae.getVarShape(vIdx)?.length ?? 0) > 0) &&
              !(dae.classKind === "function" && flattener?.currentBindingCompName === candidate)
            ) {
              const ctor = expandVarToArrayCtor(candidate, dae);
              if (ctor !== null) return ctor;
            }
            return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
          }
          if (candidate.includes("[")) {
            const baseIdx = dae.getVarIdxByName(stripArraySubscripts(candidate));
            if (baseIdx >= 0 && dae.getVarVariability(baseIdx) !== Variability.Constant) {
              return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
            }
          } else if (
            !isAssignmentLhs &&
            !noArrayExpand &&
            flattener?.options?.arrayMode !== "preserve" &&
            !(dae.classKind === "function" && flattener?.currentBindingCompName === candidate)
          ) {
            const ctor = expandVarToArrayCtor(candidate, dae);
            if (ctor !== null) return ctor;
          }
        } else {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
        }
        if (db) {
          const pkgScopeId = flattener?.currentParentMods?.packageScopeId;
          const scopeId =
            asDaeExt(dae).enclosingScopeId ??
            flattener?.currentClassId ??
            flattener?.currentFlatteningFunctionId ??
            flattener?.currentRootClassId;
          const rootScopeId = flattener?.currentRootClassId;
          const pkgRedeclForConst =
            parts.length >= 2
              ? findLastItem(
                  getModArgs(flattener?.currentParentMods),
                  (a) =>
                    !a.isBreak &&
                    a.name === parts[0] &&
                    Boolean(
                      (a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier,
                    ),
                )
              : null;
          const redeclJoined = pkgRedeclForConst?.redeclaredTypeSpecifier
            ? [stripLeadingDots(String(pkgRedeclForConst.redeclaredTypeSpecifier)), ...parts.slice(1)].join(".")
            : null;
          const redeclScopeId = pkgRedeclForConst?.evaluationScopeId ?? pkgRedeclForConst?.ownerClassId ?? scopeId;
          const constRes =
            (redeclJoined
              ? (lookupDbConstant(redeclJoined, db, redeclScopeId) ??
                (rootScopeId && rootScopeId !== redeclScopeId ? lookupDbConstant(redeclJoined, db, rootScopeId) : null))
              : null) ??
            (pkgScopeId && pkgScopeId !== scopeId
              ? (lookupDbConstant(candidate, db, pkgScopeId) ?? lookupDbConstant(joined, db, pkgScopeId))
              : null) ??
            lookupDbConstant(candidate, db, scopeId) ??
            lookupDbConstant(joined, db, scopeId) ??
            (rootScopeId && rootScopeId !== scopeId
              ? (lookupDbConstant(candidate, db, rootScopeId) ?? lookupDbConstant(joined, db, rootScopeId))
              : null);
          if (constRes !== null && !(Array.isArray(constRes.value) && constRes.value.length === 0)) {
            if (
              dae.extensionMetadata?.["isOldFrontend"] &&
              flattener &&
              (candidate.endsWith("Constants.pi") || joined.endsWith("Constants.pi")) &&
              !dae.functions.has("Modelica.Math.asin")
            ) {
              const asinSyms = db.byName("asin").filter((s) => s.kind === "Function" || flattener.isFunctionSym?.(s));
              for (const asinSym of asinSyms) {
                const cstText = (db.cstNode(asinSym.id) as SyntaxNode | null | undefined)?.text ?? "";
                if (cstText.includes('external "C"')) {
                  const fnDae = flattener.flattenFunction?.(asinSym.id, "Modelica.Math.asin", undefined, dae);
                  if (fnDae) {
                    asDaeExt(fnDae).wasCalled = true;
                    dae.addFunction("Modelica.Math.asin", fnDae);
                  }
                  break;
                }
              }
            }
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v) =>
                typeof v === "string"
                  ? dae.addStringLiteral(v)
                  : constRes.isBoolean
                    ? dae.addBoolLiteral(v !== 0)
                    : constRes.isInteger
                      ? dae.addIntLiteral(v)
                      : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            if (typeof constRes.value === "string") {
              return dae.addStringLiteral(constRes.value);
            }
            if (constRes.isBoolean) {
              return dae.addBoolLiteral(constRes.value !== 0);
            }
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        if (vIdx < 0 && parts.length >= 2 && db) {
          const curClsId =
            flattener?.currentClassId ?? flattener?.currentFlatteningFunctionId ?? flattener?.currentRootClassId;
          const isLocalComp = (() => {
            const pfx0Base = prefix ? `${prefix}.${parts[0]}` : parts[0]!;
            const prefixSet = getVarPrefixSet(dae);
            if (prefixSet.has(candidate) || prefixSet.has(pfx0Base)) return true;
            if (curClsId && db.childrenOf(curClsId).some((c) => c.kind === "Component" && c.name === parts[0])) {
              return true;
            }
            return false;
          })();
          const pkgRedeclForClass = !isLocalComp
            ? findLastItem(
                getModArgs(flattener?.currentParentMods),
                (a) =>
                  !a.isBreak &&
                  a.name === parts[0] &&
                  Boolean(
                    (a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier,
                  ),
              )
            : null;
          const firstPart = pkgRedeclForClass?.redeclaredTypeSpecifier
            ? stripLeadingDots(String(pkgRedeclForClass.redeclaredTypeSpecifier))
            : imports && imports.has(parts[0]!)
              ? imports.get(parts[0]!)!
              : parts[0]!;
          const pkgLookupScopeId = pkgRedeclForClass?.evaluationScopeId ?? pkgRedeclForClass?.ownerClassId ?? curClsId;
          const pkgOrClass = isLocalComp
            ? undefined
            : ((pkgLookupScopeId
                ? (() => {
                    const res =
                      db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgLookupScopeId)?.(firstPart) ??
                      db.query<(n: string) => SymbolEntry | null>("resolveName", pkgLookupScopeId)?.(firstPart);
                    return res && (res.kind === "Class" || res.kind === "Package") ? res : undefined;
                  })()
                : undefined) ??
              (flattener?.currentRootClassId
                ? (() => {
                    const res = db.query<(n: string) => SymbolEntry | null>(
                      "resolveName",
                      flattener.currentRootClassId,
                    )?.(firstPart);
                    return res && (res.kind === "Class" || res.kind === "Package") ? res : undefined;
                  })()
                : undefined) ??
              db.byName(firstPart.split(".").pop()!).find((e) => e.kind === "Class" || e.kind === "Package"));
          if (pkgOrClass) {
            const pkgEntry = db.symbol(pkgOrClass.id);
            const hasPkgRestrictionError = dae.diagnostics.some(
              (d) =>
                d.code === 4017 &&
                ((pkgEntry?.startOffset != null &&
                  pkgEntry?.endOffset != null &&
                  d.range?.startOffset != null &&
                  d.range.startOffset >= pkgEntry.startOffset &&
                  d.range.startOffset <= pkgEntry.endOffset) ||
                  d.message.includes(`in ${pkgOrClass.name}`)),
            );
            if (hasPkgRestrictionError) {
              const scopeName =
                (flattener?.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
              const rangeObj =
                node.startIndex != null && node.endIndex != null
                  ? { startOffset: node.startIndex, endOffset: node.endIndex }
                  : undefined;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: `Variable ${joined} not found in scope ${scopeName}.`,
                range: rangeObj,
              });
              return -1;
            }
            let currSym: SymbolEntry | null = pkgOrClass;
            for (let pi = 1; pi < parts.length; pi++) {
              if (!currSym) break;
              let child: SymbolEntry | undefined = db.childrenOf(currSym.id).find((c) => c.name === parts[pi]);
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
                    if (
                      parts.length > pi + 1 &&
                      dae.diagnostics.some((d) => d.code === ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code)
                    ) {
                      return -1;
                    }
                    const basePkgName = parts.slice(0, pi).join(".");
                    let pkgName = basePkgName;
                    if (flattener?.currentRootClassId) {
                      const rootSym = db.symbol(flattener.currentRootClassId);
                      if (
                        rootSym &&
                        pkgOrClass.parentId != null &&
                        db.symbol(pkgOrClass.parentId)?.kind !== "Package"
                      ) {
                        pkgName = `${rootSym.name}.${basePkgName}`;
                      }
                    }
                    const hasPkgDiag = dae.diagnostics.some(
                      (d) =>
                        (d.code === 4036 || d.code === 4073 || d.message.includes("is not constant")) &&
                        d.message.includes(`in package ${pkgName}`),
                    );
                    if (!hasPkgDiag) {
                      const repeatCount = parts.length > pi + 1 ? 2 : 1;
                      for (let rep = 0; rep < repeatCount; rep++) {
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                          message: `Variable ${parts.slice(0, pi + 1).join(".")} in package ${pkgName} is not constant.`,
                        });
                        for (let rem = pi + 1; rem < parts.length; rem++) {
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                            message: `Variable ${parts.slice(0, rem + 1).join(".")} in package ${pkgName} is not constant.`,
                          });
                        }
                      }
                    }
                    const scopeName =
                      (flattener?.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
                    const rangeObj =
                      node.startIndex != null && node.endIndex != null
                        ? { startOffset: node.startIndex, endOffset: node.endIndex }
                        : undefined;
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
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
                          const childCst = db.cstNode(child.id) as SyntaxNode | null | undefined;
                          const bindingNode = extractBindingExprFromDeclCst(childCst, child.name);
                          const bindingText = bindingNode?.text?.trim();
                          if (bindingText && bindingText !== "break") bText = bindingText;
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
                    const childCst = db.cstNode(child.id) as SyntaxNode | null | undefined;
                    const findBindingExpr = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
                      if (!n) return null;
                      if (n.type === "array_subscripts" || n.type === "class_modification") return null;
                      if (n.type === "expression") return n;
                      for (const c of n.children || []) {
                        const res = findBindingExpr(c);
                        if (res) return res;
                      }
                      return null;
                    };
                    let modArg: ModArgLike | null = null;
                    let modOwnerId: SymbolId | undefined = pkgOrClass.id;
                    let modFileSym: SymbolEntry | undefined;
                    const modQueue: SymbolId[] = [pkgOrClass.id];
                    const seenModClasses = new Set<SymbolId>();
                    while (modQueue.length > 0 && !modArg) {
                      const cid = modQueue.shift()!;
                      if (seenModClasses.has(cid)) continue;
                      seenModClasses.add(cid);
                      const cMod = db.query<EffectiveModLike | null>("effectiveModification", cid);
                      const foundDirect = cMod?.args?.find(
                        (a) => a.name === child.name && a.value && a.value.text?.trim() !== child.name,
                      );
                      if (foundDirect) {
                        modArg = foundDirect;
                        modOwnerId = cid;
                        modFileSym = db.symbol(foundDirect.sourceSymbolId ?? cid);
                        break;
                      }
                      for (const ch of db.childrenOf(cid)) {
                        if (ch.kind === "Extends") {
                          const extMod = db.query<EffectiveModLike | null>("extendsModificationParsed", ch.id);
                          const foundExt = extMod?.args?.find(
                            (a) => a.name === child.name && a.value && a.value.text?.trim() !== child.name,
                          );
                          if (foundExt) {
                            modArg = foundExt;
                            modOwnerId = cid;
                            modFileSym = ch;
                            break;
                          }
                          const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
                          if (extBase && !seenModClasses.has(extBase.id)) {
                            modQueue.push(extBase.id);
                          }
                        }
                      }
                      if (modArg) break;
                      const shortBase = db.query<SymbolEntry | null>("resolvedBaseClass", cid);
                      if (shortBase && !seenModClasses.has(shortBase.id)) {
                        modQueue.push(shortBase.id);
                      }
                    }
                    let modExprNode: SyntaxNode | null = null;
                    if (modArg?.value) {
                      modExprNode = findBindingExpr(modArg.value as unknown as SyntaxNode | null | undefined);
                      if (!modExprNode && Array.isArray(modArg.value.cstBytes)) {
                        const scopeSym =
                          modFileSym ?? db.symbol(modArg.evaluationScopeId ?? modOwnerId ?? pkgOrClass.id);
                        const rangeNode = db.cstNodeRange(
                          modArg.value.cstBytes[0],
                          modArg.value.cstBytes[1],
                          scopeSym,
                        ) as SyntaxNode | null;
                        modExprNode = findBindingExpr(rangeNode) ?? rangeNode;
                      }
                    }
                    const exprNode = modExprNode ?? findBindingExpr(childCst);
                    if (exprNode && flattener) {
                      const activeSet: Set<string> = (asFlattenerExt(flattener)!._activeConstLowering ??=
                        new Set<string>());
                      const constKey = `${pkgOrClass.id}:${child.id}`;
                      if (!activeSet.has(constKey)) {
                        activeSet.add(constKey);
                        const prevClassId = flattener.currentClassId;
                        flattener.currentClassId =
                          modArg?.evaluationScopeId ??
                          modOwnerId ??
                          pkgOrClass.id ??
                          child.parentId ??
                          flattener.currentClassId;
                        try {
                          const lowered = flattener.lowerExpr?.(exprNode, dae, "", substitutions) ?? -1;
                          if (lowered >= 0) return lowered;
                        } finally {
                          flattener.currentClassId = prevClassId;
                          activeSet.delete(constKey);
                        }
                      }
                    }
                  }
                }
                currSym = child;
              } else {
                const curScope = db.query<ScopeDataLike | null>("scopeData", db.baseOf(currSym.id) ?? currSym.id);
                const part = parts[pi]!;
                const isImportedInCur =
                  Boolean(curScope?.qualifiedImports?.[part]) ||
                  Boolean(curScope?.compoundImports?.some((ci) => ci.names.includes(part))) ||
                  Boolean(
                    curScope?.unqualifiedImportPkgs?.some((pkg: string) => {
                      const pkgSym = db
                        .byName(pkg.split(".").pop()!)
                        ?.find((s) => s.kind === "Package" || s.kind === "Class");
                      return pkgSym ? db.childrenOf(pkgSym.id).some((c) => c.name === part) : false;
                    }),
                  );
                if (isImportedInCur && !flattener?.isOldFrontend && !dae.extensionMetadata?.["isOldFrontend"]) {
                  let stmtOrEqNode: SyntaxNode | null | undefined = node;
                  while (
                    stmtOrEqNode?.parent &&
                    stmtOrEqNode.type !== "component_clause" &&
                    stmtOrEqNode.type !== "some_equation" &&
                    stmtOrEqNode.type !== "simple_equation" &&
                    stmtOrEqNode.type !== "statement"
                  ) {
                    stmtOrEqNode = stmtOrEqNode.parent;
                  }
                  const errNode = stmtOrEqNode ?? node;
                  const rangeObj =
                    errNode.startIndex != null && errNode.endIndex != null
                      ? {
                          startOffset: errNode.startIndex,
                          endOffset: errNode.endIndex,
                          startPosition: errNode.startPosition,
                          endPosition: errNode.endPosition,
                        }
                      : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                    message: `Found imported name '${part}' while looking up composite name '${joined}'.`,
                    range: rangeObj,
                  });
                  return -1;
                }
                break;
              }
            }
          }
        }
        rawName = candidate;
      }
    }

    const ensureOldFrontendPiAsin = (constName: string) => {
      if (
        dae.extensionMetadata?.["isOldFrontend"] &&
        flattener &&
        db &&
        constName.endsWith("Constants.pi") &&
        !dae.functions.has("Modelica.Math.asin")
      ) {
        const asinSyms = db.byName("asin").filter((s) => s.kind === "Function" || flattener.isFunctionSym?.(s));
        for (const asinSym of asinSyms) {
          const cstText = (db.cstNode(asinSym.id) as SyntaxNode | null | undefined)?.text ?? "";
          if (cstText.includes('external "C"')) {
            const fnDae = flattener.flattenFunction?.(asinSym.id, "Modelica.Math.asin", undefined, dae);
            if (fnDae) {
              asDaeExt(fnDae).wasCalled = true;
              dae.addFunction("Modelica.Math.asin", fnDae);
            }
            break;
          }
        }
      }
    };

    if (imports && rawName.includes(".")) {
      const p = rawName.split(".");
      if (imports.has(p[0]!)) {
        const mapped = [imports.get(p[0]!)!, ...p.slice(1)].join(".");
        if (db) {
          const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
          const constRes = lookupDbConstant(mapped, db, scopeId);
          if (constRes !== null) {
            ensureOldFrontendPiAsin(mapped);
            if (Array.isArray(constRes.value)) {
              const elemIds = constRes.value.map((v) =>
                typeof v === "string"
                  ? dae.addStringLiteral(v)
                  : constRes.isBoolean
                    ? dae.addBoolLiteral(v !== 0)
                    : constRes.isInteger
                      ? dae.addIntLiteral(v)
                      : dae.addRealLiteral(v),
              );
              return dae.addArrayCtorExpr(elemIds);
            }
            if (typeof constRes.value === "string") {
              return dae.addStringLiteral(constRes.value);
            }
            if (constRes.isBoolean) {
              return dae.addBoolLiteral(constRes.value !== 0);
            }
            return constRes.isInteger
              ? dae.addIntLiteral(Math.round(constRes.value))
              : dae.addRealLiteral(constRes.value);
          }
        }
        rawName = mapped;
      }
    }
    if (db && rawName.includes(".")) {
      const pkgScopeId = flattener?.currentParentMods?.packageScopeId;
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId;
      const constRes =
        (pkgScopeId && pkgScopeId !== scopeId ? lookupDbConstant(rawName, db, pkgScopeId) : null) ??
        lookupDbConstant(rawName, db, scopeId);
      if (constRes !== null) {
        ensureOldFrontendPiAsin(rawName);
        if (Array.isArray(constRes.value)) {
          const elemIds = constRes.value.map((v) =>
            typeof v === "string"
              ? dae.addStringLiteral(v)
              : constRes.isBoolean
                ? dae.addBoolLiteral(v !== 0)
                : constRes.isInteger
                  ? dae.addIntLiteral(v)
                  : dae.addRealLiteral(v),
          );
          return dae.addArrayCtorExpr(elemIds);
        }
        if (typeof constRes.value === "string") {
          return dae.addStringLiteral(constRes.value);
        }
        if (constRes.isBoolean) {
          return dae.addBoolLiteral(constRes.value !== 0);
        }
        return constRes.isInteger ? dae.addIntLiteral(Math.round(constRes.value)) : dae.addRealLiteral(constRes.value);
      }
    }

    if (db && rawName.includes(".")) {
      const dotIdx = rawName.lastIndexOf(".");
      const enumTypeName = rawName.slice(0, dotIdx);
      const litName = rawName.slice(dotIdx + 1);
      if (dae.extensionMetadata?.["isOldFrontend"] && flattener?.currentParentMods?.args) {
        const redeclArg = getModArgs(flattener.currentParentMods)?.find(
          (a) =>
            a.redeclare &&
            a.name === enumTypeName &&
            typeof a.redeclaredTypeSpecifier === "string" &&
            a.redeclaredTypeSpecifier.startsWith("enumeration("),
        );
        if (redeclArg?.redeclaredTypeSpecifier) {
          const redeclLits = parseEnumLiteralsText(redeclArg.redeclaredTypeSpecifier)?.map(stripOuterSingleQuotes);
          if (redeclLits && redeclLits.length > 0) {
            if (!redeclLits.includes(litName)) {
              const classFqn = flattener.currentClassId
                ? (getSymbolQualifiedName(db, flattener.currentClassId) ?? "")
                : "";
              const cleanPrefix = prefix.endsWith(".") ? prefix.slice(0, -1) : prefix;
              const scopeName = cleanPrefix ? `${classFqn}$${cleanPrefix}` : classFqn;
              let eqNode: SyntaxNode | null | undefined = node;
              while (
                eqNode?.parent &&
                eqNode.type !== "simple_equation" &&
                eqNode.type !== "equation" &&
                eqNode.type !== "statement"
              ) {
                eqNode = eqNode.parent;
              }
              const errRange = {
                startOffset: eqNode?.startIndex ?? eqNode?.startOffset ?? node.startIndex,
                endOffset: eqNode?.endIndex ?? eqNode?.endOffset ?? node.endIndex,
                startPosition: eqNode?.startPosition ?? node.startPosition,
                endPosition: eqNode?.endPosition ?? node.endPosition,
              };
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(rawName, scopeName),
                range: errRange,
              });
              let outerCompRef: SyntaxNode | null | undefined = node.parent;
              while (
                outerCompRef &&
                outerCompRef.type !== "component_reference" &&
                outerCompRef.type !== "primary" &&
                outerCompRef.type !== "simple_equation"
              ) {
                outerCompRef = outerCompRef.parent;
              }
              if (outerCompRef && (outerCompRef.type === "component_reference" || outerCompRef.type === "primary")) {
                const outerText = outerCompRef.text?.trim();
                if (outerText && outerText !== rawName) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                    message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(outerText, scopeName),
                    range: errRange,
                  });
                }
              }
              return -1;
            }
          }
        }
      }
      const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? undefined;
      const resolvedEnum = resolveEnumType(enumTypeName, scopeId, db);
      if (resolvedEnum) {
        const idx = resolvedEnum.literals.indexOf(litName);
        if (idx >= 0) {
          return dae.addEnumLiteral(idx + 1, `${resolvedEnum.qual}.${litName}`);
        }
      }
      const leafTypeName = enumTypeName.includes(".") ? enumTypeName.split(".").pop()! : enumTypeName;
      const typeTargets = db.byName(leafTypeName);
      for (const candidate of typeTargets) {
        const baseCandidate = getBaseEnumSymbol(db, candidate) ?? candidate;
        const literals = getSymbolEnumLiterals(db, baseCandidate);
        if (literals) {
          const idx = literals.indexOf(litName);
          if (idx >= 0) {
            const pathParts: string[] = [baseCandidate.name, litName];
            let curr: SymbolEntry | null | undefined = baseCandidate.parentId
              ? db.symbol(baseCandidate.parentId)
              : null;
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

    rawName = resolveScopedName(rawName, prefix, dae, state.innerOuterComponents);

    // Check if rawName is an array variable like e, which has elements e[1] .. e[N] or multi-dim e[1,1] ..
    // Only expand if rawName is NOT already subscripted (does not contain '['), noArrayExpand is false, and not assignment LHS
    if (
      !isAssignmentLhs &&
      !noArrayExpand &&
      flattener?.options?.arrayMode !== "preserve" &&
      !rawName.includes("[") &&
      (dae.hasArrayElements(rawName) ||
        (dae.getVarIdxByName(rawName) >= 0 && (dae.getVarShape(dae.getVarIdxByName(rawName))?.length ?? 0) > 0)) &&
      !(dae.classKind === "function" && flattener?.currentBindingCompName === rawName)
    ) {
      const ctor = expandVarToArrayCtor(rawName, dae);
      if (ctor !== null) return ctor;
    }

    const outerErr = state.outerNonConstantAccess?.find(
      (e) =>
        e.compName === prefix &&
        (e.varName === rawName || `${prefix}.${e.varName}` === rawName || e.target === rawName),
    );
    if (outerErr) {
      let clauseNode: SyntaxNode | null | undefined = node;
      while (clauseNode && clauseNode.type !== "component_clause") {
        clauseNode = clauseNode.parent;
      }
      const rangeObj = clauseNode
        ? {
            startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
            endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          }
        : node.startIndex != null && node.endIndex != null
          ? {
              startOffset: node.startIndex,
              endOffset: node.endIndex,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            }
          : undefined;

      let clsNode: SyntaxNode | null | undefined = clauseNode;
      while (clsNode && clsNode.type !== "class_definition") {
        clsNode = clsNode.parent;
      }

      const getQualifiedClassName = (cNode: SyntaxNode | null | undefined): string => {
        if (!cNode) return "";
        const names: string[] = [];
        let curr: SyntaxNode | null | undefined = cNode;
        while (curr) {
          if (curr.type === "class_definition") {
            let idName = "";
            for (const ch of curr.children || []) {
              if (ch.type === "class_specifier" || ch.type === "long_class_specifier") {
                const id = ch.children?.find((c) => c.type === "identifier");
                if (id) {
                  idName = id.text?.trim();
                  break;
                }
              }
            }
            if (!idName) {
              const id = curr.children?.find((c) => c.type === "identifier");
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

      const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
      if (!isOldFrontend) {
        const targetSym = db?.byName(outerErr.varName).find((s) => s.kind === "Component");
        const notifRange =
          targetSym && db
            ? getElementDiagRange(db.cstNode(targetSym.id) as FlattenerCstNode | null | undefined)
            : undefined;
        if (notifRange) {
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
          message: `Component '${outerErr.varName}' was found in an enclosing scope but is not a constant.`,
          range: getElementDiagRange(clauseNode ?? node),
        });
        return -1;
      }

      if (currClassSym && currClassSym.parentId != null) {
        const compRange = toDiagnosticRange(state.currentCompClauseRange);
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
          message: `Variable ${outerErr.compName}: Variable ${outerErr.varName} in package ${rootClassName} is not constant.`,
          range: compRange,
        });
      }

      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        message: `Variable ${outerErr.varName} not found in scope ${scopeName}.`,
        range: rangeObj,
      });
      return -1;
    }
    return dae.addExpression(ExprKind.Name, dae.interner.intern(rawName));
  }

  return null;
}
