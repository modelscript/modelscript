// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst } from "../../../../src-gen/bindings.js";
import { isInnerQuery, isOuterQuery } from "../../../queries.js";
import {
  castToRealExpr,
  evalDaeExpr,
  evaluateCSTNumber,
  tokenizeCommentStrippedWords,
} from "../../expressions/index.js";
import { type DiagnosticRange } from "../../support/range-utils.js";
import { extractShortTypeAliasTarget } from "./cst-helpers.js";
import { isClassType } from "./modifications.js";
import {
  getCstNode,
  getCstNodeRange,
  getSymMeta,
  type ComponentFlattener,
  type ModArgData,
  type ParentModData,
} from "./types.js";

export function tryLowerForeignComponent(
  flattener: ComponentFlattener,
  classTarget: SymbolEntry | null | undefined,
  instanceName: string,
  dae: DAEBuilder,
  subMod: ParentModData | null | undefined,
  bindingScope: string,
): boolean {
  const lowerFn = (classTarget?.metadata as Record<string, unknown> | undefined)?.["lowerComponentToDae"];
  if (typeof lowerFn !== "function") return false;

  const paramOverrides: Record<string, { value?: number | undefined; exprId?: number | undefined }> = {};
  const args: readonly ModArgData[] = subMod?.args ?? [];
  for (const arg of args) {
    if (!arg?.name || arg.isBreak || arg.isRedeclaration) continue;
    let exprId: number | undefined;
    let numVal: number | undefined;

    const valObj = arg.value;
    const modScopeId =
      valObj?.evaluationScopeId ??
      arg.evaluationScopeId ??
      arg.ownerClassId ??
      flattener.currentClassId ??
      flattener.currentRootClassId;
    const modScopeSym = modScopeId != null ? flattener.db.symbol(modScopeId) : null;

    if (valObj?.cstBytes && modScopeSym) {
      const argCst = getCstNodeRange(flattener.db, valObj.cstBytes[0], valObj.cstBytes[1], modScopeSym);
      if (argCst) {
        const prevClassId = flattener.currentClassId;
        if (modScopeId) flattener.currentClassId = modScopeId;
        try {
          const lowered = flattener.lowerExpr(argCst, dae, bindingScope);
          if (lowered >= 0) {
            exprId = castToRealExpr(lowered, dae);
          }
        } finally {
          flattener.currentClassId = prevClassId;
        }
      }
    }

    const rawText = typeof valObj?.text === "string" ? valObj.text.trim() : "";
    if (exprId === undefined && rawText) {
      const directNum = Number(rawText);
      if (Number.isFinite(directNum)) {
        numVal = directNum;
        exprId = dae.addRealLiteral(directNum);
      } else {
        const scopedVar = bindingScope ? `${bindingScope}.${rawText}` : rawText;
        const vIdx = dae.lookupVariable(scopedVar) >= 0 ? dae.lookupVariable(scopedVar) : dae.lookupVariable(rawText);
        if (vIdx >= 0) {
          exprId = dae.addNameExpr(dae.getVarName(vIdx));
          const sv = dae.getVarExpression(vIdx);
          const ev = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
          if (typeof ev === "number" && Number.isFinite(ev)) numVal = ev;
        } else {
          const cstNum = evaluateCSTNumber(
            rawText,
            undefined,
            modScopeId ?? undefined,
            flattener.db,
            dae,
            bindingScope,
          );
          if (typeof cstNum === "number" && Number.isFinite(cstNum)) {
            numVal = cstNum;
            exprId = dae.addRealLiteral(cstNum);
          }
        }
      }
    }

    if (numVal === undefined && exprId !== undefined && exprId >= 0) {
      const ev = evalDaeExpr(exprId, dae);
      if (typeof ev === "number" && Number.isFinite(ev)) {
        numVal = ev;
      }
    }
    if (numVal === undefined && typeof valObj?.value === "number" && Number.isFinite(valObj.value)) {
      numVal = valObj.value;
      if (exprId === undefined) exprId = dae.addRealLiteral(numVal!);
    }

    if (numVal !== undefined || exprId !== undefined) {
      paramOverrides[arg.name] = { value: numVal, exprId };
    }
  }

  const deferred = lowerFn(dae, instanceName, {
    paramOverrides,
    deferInputDefaults: true,
  });
  if (Array.isArray(deferred) && deferred.length > 0) {
    const extMeta = dae.extensionMetadata as Record<string, unknown>;
    const list = (extMeta["__pendingForeignInputDefaults"] as Array<{ varName: string; rhsExprId: number }>) ?? [];
    list.push(...deferred);
    extMeta["__pendingForeignInputDefaults"] = list;
  }
  return true;
}

/**
 * Validates that a short `type` alias definition (`type T = Target`) does not illegally
 * alias a composite `model`, `block`, `record`, or `connector` class (Modelica §4.5.2).
 *
 * @param flattener - Active component flattener context.
 * @param typeSymId - Symbol ID of the short `type` definition.
 * @returns Diagnostic metadata (`targetName`, `kindDesc`, `range`) if invalid, or `null` if valid.
 */
export function checkTypeAliasSpecialization(
  flattener: ComponentFlattener,
  typeSymId: SymbolId,
): { targetName: string; kindDesc: string; range: DiagnosticRange } | null {
  const sym = flattener.db.symbol(typeSymId);
  if (!sym) return null;
  const cst = getCstNode(flattener.db, typeSymId);
  if (!cst) return null;
  const targetName = extractShortTypeAliasTarget(cst);
  if (!targetName) return null;
  if (targetName === "Real" || targetName === "Integer" || targetName === "Boolean" || targetName === "String") {
    return null;
  }
  const simpleTargetName = targetName.split(".").pop()!;
  const candidateClasses = flattener.db.byName(simpleTargetName).filter((e) => e.kind === "Class");
  if (candidateClasses.length === 0) return null;
  if (candidateClasses.some((c) => isClassType(flattener, c.id))) return null;
  const targetClass = candidateClasses[0]!;

  const targetCst = getCstNode(flattener.db, targetClass.id);
  const prefixes = targetCst ? Cst.ClassDefinition.classPrefixes(targetCst) : null;
  const prefixWords = tokenizeCommentStrippedWords(prefixes?.text ?? "");
  let kindDesc = "a new def";
  if (prefixWords.includes("model")) kindDesc = "a model";
  else if (prefixWords.includes("block")) kindDesc = "a block";
  else if (prefixWords.includes("record")) kindDesc = "a record";
  else if (prefixWords.includes("connector")) kindDesc = "a connector";

  const range: DiagnosticRange = {
    startOffset: cst.startIndex ?? cst.startOffset ?? 0,
    endOffset: cst.endIndex ?? cst.endOffset ?? 0,
    startPosition: cst.startPosition,
    endPosition: cst.endPosition,
  };
  return { targetName, kindDesc, range };
}

/**
 * Resolves the replacement type specifier (`redeclSpecifier`) of a `redeclare` clause
 * to its target class or `type` alias `SymbolId`.
 *
 * Searches `scopeId` first, then `flattener.currentRootClassId`, and finally falls back
 * to global `byName` lookup.
 *
 * @param flattener - Active component flattener context.
 * @param scopeId - Lexical scope ID where the `redeclare` modifier was written.
 * @param redeclSpecifier - Simple or dot-qualified type name in the `redeclare` clause.
 * @returns Resolved class `SymbolId`, or `null` if not found.
 */
export function resolveRedeclarationType(
  flattener: ComponentFlattener,
  scopeId: SymbolId | null,
  redeclSpecifier: string,
): SymbolId | null {
  if (!redeclSpecifier) return null;
  const isDotted = redeclSpecifier.includes(".");

  if (scopeId !== null) {
    const resolver = isDotted
      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)
      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", scopeId);
    const resolved = resolver?.(redeclSpecifier);
    if (resolved && (resolved.kind === "Class" || getSymMeta(resolved).classKind === "type")) {
      return resolved.id;
    }
  }

  if (flattener.currentRootClassId && flattener.currentRootClassId !== scopeId) {
    const rootResolver = isDotted
      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)
      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", flattener.currentRootClassId);
    const resolved = rootResolver?.(redeclSpecifier);
    if (resolved && (resolved.kind === "Class" || getSymMeta(resolved).classKind === "type")) {
      return resolved.id;
    }
  }

  const simple = isDotted ? redeclSpecifier.split(".").pop()! : redeclSpecifier;
  const targets = flattener.db.byName(simple);
  const found = targets.find((t) => t.kind === "Class" || getSymMeta(t).classKind === "type");
  return found ? found.id : null;
}

/**
 * Resolves an `outer` class reference (`classId`) to its corresponding `inner` class
 * definition in the enclosing root model (`flattener.currentRootClassId`).
 *
 * If `classId` does not carry the `outer` prefix or no matching `inner` class exists in
 * the root model, returns `classId` unchanged.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Candidate class `SymbolId` to check for `outer` redirection.
 * @returns The matching `inner` class `SymbolId`, or `classId` if not redirected.
 */
export function resolveInnerOuterClass(flattener: ComponentFlattener, classId: SymbolId): SymbolId {
  const sym = flattener.db.symbol(classId);
  if (!sym) return classId;

  const hasPrefix = (s: SymbolEntry, prefix: "inner" | "outer"): boolean => {
    return prefix === "inner"
      ? (flattener.db.query("isInner", s.id) ?? isInnerQuery(flattener.db, s))
      : (flattener.db.query("isOuter", s.id) ?? isOuterQuery(flattener.db, s));
  };

  if (!hasPrefix(sym, "outer")) return classId;

  const targetName = sym.name;

  if (flattener.currentRootClassId) {
    const rootChildren = flattener.db.childrenOf(flattener.currentRootClassId);
    for (const child of rootChildren) {
      if (child.kind === "Class" && child.name === targetName) {
        if (hasPrefix(child, "inner")) {
          return child.id;
        }
      }
    }
  }
  return classId;
}
