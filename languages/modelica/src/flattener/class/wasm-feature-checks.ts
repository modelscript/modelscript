// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM kernel feature-support and redeclare/connect detection queries.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import { isOperatorRecordSym, isRecordSym } from "./annotations-and-extensions.js";
import {
  collectDottedPrefixRootIdentsCst,
  cstHasComponentMethodCall,
  cstHasEqualsRhsIdent,
  cstHasExternalBuiltinOrDerivative,
  cstHasExternalLanguage,
  cstHasFloatFillArg,
  cstHasKeywordToken,
  cstHasLeadingDotAfterEqOrParen,
  cstHasWholeSliceAssign,
  hasClassPrefixWordCst,
  hasConnectionsOrEqualityConstraintCst,
  hasNonStandardEnumKeywordCst,
  hasUnsupportedTypeOrConnectorAliasCst,
} from "./cst-token-helpers.js";
import type {
  ClassFlattenerContext,
  ComponentInstanceQueryData,
  CstNodeLike,
  EffectiveModLike,
  ModArgLike,
  NameResolverFn,
  QueryDBWithCaches,
  SymbolMetaLike,
} from "./types.js";

export const UNSUPPORTED_WASM_IDENTIFIERS = new Set([
  "homotopy",
  "semiLinear",
  "outerProduct",
  "identity",
  "diagonal",
  "StateSelect",
  "Connections",
  "inStream",
  "actualStream",
]);

export function classHasRedeclare(
  db: QueryDB,
  cache: Map<SymbolId, boolean>,
  classId?: SymbolId | null,
  visited = new Set<SymbolId>(),
): boolean {
  if (!classId || visited.has(classId)) return false;
  const cached = cache.get(classId);
  if (cached !== undefined) return cached;
  visited.add(classId);

  const cacheAndReturn = (val: boolean): boolean => {
    cache.set(classId, val);
    return val;
  };

  const shortMod = db.query<EffectiveModLike | null>("effectiveModification", classId);
  if (shortMod?.args) {
    for (const arg of shortMod.args) {
      if (arg.isRedeclaration || arg.redeclaredTypeSpecifier || arg.isReplaceable) return cacheAndReturn(true);
    }
    if (shortMod.args.length > 0) {
      const sym = db.symbol(classId);
      const clsCst = db.cstNode(classId) as CstNodeLike | null;
      if (
        sym?.kind === "Package" ||
        (sym?.metadata as SymbolMetaLike | undefined)?.classKind === "package" ||
        hasClassPrefixWordCst(clsCst, "package")
      ) {
        return cacheAndReturn(true);
      }
    }
  }

  const children = db.childrenOf(classId);
  for (const child of children) {
    if (db.query<boolean>("isRedeclare", child.id)) {
      return cacheAndReturn(true);
    }
    if (db.query<boolean>("isReplaceable", child.id)) {
      return cacheAndReturn(true);
    }
    if (child.kind === "Extends") {
      const extendsModParsedRaw = db.query<ModArgLike[] | EffectiveModLike | null>(
        "extendsModificationParsed",
        child.id,
      );
      const extendsModParsed: ModArgLike[] = Array.isArray(extendsModParsedRaw)
        ? extendsModParsedRaw
        : (extendsModParsedRaw?.args ?? []);
      for (const arg of extendsModParsed) {
        if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return cacheAndReturn(true);
      }
      const baseClass =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ??
        (classId
          ? (db.query<NameResolverFn | null>("resolveName", classId)?.(child.name) ??
            db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(child.name))
          : null) ??
        db.byName(child.name)?.[0];
      if (baseClass && classHasRedeclare(db, cache, baseClass.id, visited)) return cacheAndReturn(true);
    }
    if (child.kind === "Class" || child.kind === "Package") {
      if (classHasRedeclare(db, cache, child.id, visited)) return cacheAndReturn(true);
    }
    if (child.kind === "Component") {
      const compInst = db.query<ComponentInstanceQueryData | null>("componentInstance", child.id);
      if (compInst?.isReplaceable) return cacheAndReturn(true);
      if (compInst?.modification?.args) {
        for (const arg of compInst.modification.args) {
          if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return cacheAndReturn(true);
        }
      }
      const compClassId = db.query<SymbolId | null>("classInstance", child.id);
      if (compClassId && classHasRedeclare(db, cache, compClassId, visited)) return cacheAndReturn(true);
    }
  }

  const cst = db.cstNode(classId) as CstNodeLike | null;
  if (cst) {
    const prefixNames = collectDottedPrefixRootIdentsCst(cst);
    if (prefixNames.length > 0) {
      const sym = db.symbol(classId);
      const seenPrefixes = new Set<string>();
      for (const prefixName of prefixNames) {
        if (prefixName === "Modelica" || seenPrefixes.has(prefixName)) continue;
        seenPrefixes.add(prefixName);
        const prefixSym = db.byName(prefixName).find((e) => e.kind === "Class" || e.kind === "Package");
        if (
          prefixSym &&
          prefixSym.id !== classId &&
          (!sym?.resourceId || prefixSym.resourceId === sym.resourceId) &&
          classHasRedeclare(db, cache, prefixSym.id, visited)
        ) {
          return cacheAndReturn(true);
        }
      }
    }
  }
  return cacheAndReturn(false);
}

export function classHasConnect(db: QueryDB, classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
  if (!classId || visited.has(classId)) return false;
  visited.add(classId);

  const cst = db.cstNode(classId) as CstNodeLike | null;
  if (cst?.text?.includes("connect(")) return true;

  const children = db.childrenOf(classId);
  for (const child of children) {
    if (child.kind === "Extends") {
      const baseClass =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ??
        (classId
          ? (db.query<NameResolverFn | null>("resolveName", classId)?.(child.name) ??
            db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(child.name))
          : null) ??
        db.byName(child.name)?.[0];
      if (baseClass && classHasConnect(db, baseClass.id, visited)) return true;
    }
  }
  return false;
}

export function cstContainsAnyIdentifier(node: CstNodeLike | null | undefined, names: Set<string>): boolean {
  if (!node) return false;
  const t = node.type;
  if (t === "identifier" || t === "IDENT" || t === "ident") {
    if (names.has(node.text?.trim() ?? "")) return true;
  }
  for (const ch of node.children || []) {
    if (cstContainsAnyIdentifier(ch, names)) return true;
  }
  return false;
}

export function classHasUnsupportedWasmFeatures(
  ctx: ClassFlattenerContext,
  cache: Map<SymbolId, boolean>,
  classId?: SymbolId | null,
  visited = new Set<SymbolId>(),
): boolean {
  if (!classId || visited.has(classId)) return false;
  const cached = cache.get(classId);
  if (cached !== undefined) return cached;
  visited.add(classId);

  const sym = ctx.db.symbol(classId);
  if (ctx.options.intEnumConversion) {
    cache.set(classId, true);
    return true;
  }
  const cstNode = ctx.db.cstNode(classId) as CstNodeLike | null;
  if (cstNode && hasUnsupportedTypeOrConnectorAliasCst(cstNode)) {
    cache.set(classId, true);
    return true;
  }
  if (cstNode && cstContainsAnyIdentifier(cstNode, UNSUPPORTED_WASM_IDENTIFIERS)) {
    cache.set(classId, true);
    return true;
  }
  if (cstNode?.text && /\bder\s*\(\s*(?:if\b|[^)]*[+\-*/^])/.test(cstNode.text)) {
    cache.set(classId, true);
    return true;
  }

  if (
    cstNode &&
    (hasNonStandardEnumKeywordCst(cstNode) ||
      cstHasWholeSliceAssign(cstNode) ||
      cstHasFloatFillArg(cstNode) ||
      cstHasExternalLanguage(cstNode, "FORTRAN 77") ||
      cstHasLeadingDotAfterEqOrParen(cstNode) ||
      (sym?.parentId != null && cstHasKeywordToken(cstNode, "constant")))
  ) {
    cache.set(classId, true);
    return true;
  }

  if (cstNode && cstHasKeywordToken(cstNode, "for")) {
    const cst = cstNode;
    if (cst) {
      const forEqs: CstNodeLike[] = [];
      const findForEqs = (n: CstNodeLike | null | undefined) => {
        if (!n) return;
        if (n.type === "for_equation" || n.type === "ForEquation") {
          forEqs.push(n);
          return;
        }
        for (const c of n.children || []) findForEqs(c);
      };
      findForEqs(cst);
      const collectCstIdentifiers = (n: CstNodeLike | null | undefined, out: string[]) => {
        if (!n) return;
        if (n.type === "identifier" || n.type === "IDENT") {
          const idTxt = n.text?.trim();
          if (idTxt) out.push(idTxt);
          return;
        }
        if (Array.isArray(n.children) && n.children.length > 0) {
          for (const c of n.children) collectCstIdentifiers(c, out);
        } else if (typeof n.text === "string") {
          const t = n.text.trim();
          if (t.length > 0 && t !== ":" && Number.isNaN(Number(t))) {
            out.push(t);
          }
        }
      };
      for (const fe of forEqs) {
        const fi = fe.children?.find(
          (c) => c.type === "for_indices" || c.type === "ForIndices" || c.type === "for_index" || c.type === "ForIndex",
        );
        if (fi) {
          const expr =
            fi.children?.find((c) => c.type === "expression" || c.type === "Expression") ??
            fi.children
              ?.find((c) => c.type === "for_index" || c.type === "ForIndex")
              ?.children?.find((c) => c.type === "expression" || c.type === "Expression");
          if (expr) {
            const idNames: string[] = [];
            collectCstIdentifiers(expr, idNames);
            for (const idName of idNames) {
              const compSym = ctx.db.byName(idName)?.find((s) => s.parentId === classId && s.kind === "Component");
              if (compSym) {
                const ci = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", compSym.id);
                if (ci && ci.variability !== "parameter" && ci.variability !== "constant") {
                  cache.set(classId, true);
                  return true;
                }
              }
            }
          }
        }
      }
    }
  }

  const children = ctx.db.childrenOf(classId);
  const localCompNames = new Set(children.filter((c) => c.kind === "Component").map((c) => c.name));
  if (localCompNames.size > 0 && cstNode && cstHasComponentMethodCall(cstNode, localCompNames)) {
    cache.set(classId, true);
    return true;
  }
  for (const child of children) {
    if (child.kind === "Extends") {
      const baseClass =
        ctx.db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ??
        (classId
          ? (ctx.db.query<NameResolverFn | null>("resolveName", classId)?.(child.name) ??
            ctx.db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(child.name))
          : null) ??
        ctx.db.byName(child.name)?.[0] ??
        (child.name.includes(".") ? ctx.db.byName(child.name.split(".").pop()!)?.[0] : undefined);
      if (baseClass) {
        if (sym?.resourceId && baseClass.resourceId && baseClass.resourceId !== sym.resourceId) {
          cache.set(classId, true);
          return true;
        }
        const extModRaw = ctx.db.query<ModArgLike[] | EffectiveModLike | null>("extendsModificationParsed", child.id);
        const extModArgs: ModArgLike[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
        if (extModArgs.length > 0) {
          const baseChildren = ctx.db.childrenOf(baseClass.id) || [];
          for (const mArg of extModArgs) {
            if (
              mArg?.name &&
              baseChildren.some((bc) => bc.name === mArg.name && (bc.kind === "Class" || bc.kind === "Package"))
            ) {
              cache.set(classId, true);
              return true;
            }
            const valTxt = String(mArg?.value?.text ?? mArg?.bindingExpression ?? "").trim();
            if (valTxt && localCompNames.has(valTxt)) {
              cache.set(classId, true);
              return true;
            }
          }
        }
        if (localCompNames.size > 0) {
          const baseElems = ctx.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
          for (const eid of baseElems) {
            const eSym = ctx.db.symbol(eid);
            if (eSym && eSym.kind === "Component" && localCompNames.has(eSym.name)) {
              cache.set(classId, true);
              return true;
            }
          }
        }
        if (classHasUnsupportedWasmFeatures(ctx, cache, baseClass.id, visited)) {
          cache.set(classId, true);
          return true;
        }
      }
    }
    if (
      child.kind === "Class" ||
      child.kind === "Model" ||
      child.kind === "Block" ||
      child.kind === "Connector" ||
      child.kind === "Record" ||
      isRecordSym(ctx.db, child)
    ) {
      if (classHasUnsupportedWasmFeatures(ctx, cache, child.id, visited)) {
        cache.set(classId, true);
        return true;
      }
    }
    if (child.kind === "Component") {
      const childCst = ctx.db.cstNode(child.id) as CstNodeLike | null | undefined;
      const hasConditionAttr = (n: CstNodeLike | null | undefined): boolean => {
        if (!n) return false;
        if (n.type === "condition_attribute" || n.type === "ConditionAttribute") return true;
        if (n.type === "modification" || n.type === "comment" || n.type === "string_comment") return false;
        for (const c of n.children || []) {
          if (hasConditionAttr(c)) return true;
        }
        return false;
      };
      if (hasConditionAttr(childCst)) {
        cache.set(classId, true);
        return true;
      }
      const compInst = ctx.db.query<{
        typeSpecifier?: string;
        typeName?: string;
        classInstance?: SymbolId | null;
        classTargetId?: SymbolId | null;
      }>("componentInstance", child.id);
      const rawSpec = String(compInst?.typeSpecifier ?? compInst?.typeName ?? "").trim();
      if (rawSpec.includes(".")) {
        const specParts = rawSpec.split(".");
        const leafSpec = specParts[specParts.length - 1]!;
        if (specParts.slice(0, -1).includes(leafSpec)) {
          cache.set(classId, true);
          return true;
        }
      }
      const targetClassId =
        ctx.db.query<SymbolId | null>("classInstance", child.id) ?? compInst?.classInstance ?? compInst?.classTargetId;
      const targetClass = targetClassId
        ? ctx.db.symbol(targetClassId)
        : ((classId && compInst?.typeSpecifier
            ? (ctx.db.query<NameResolverFn | null>("resolveName", classId)?.(compInst.typeSpecifier) ??
              ctx.db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(compInst.typeSpecifier))
            : null) ??
          ctx.db.byName(rawSpec)?.[0] ??
          (rawSpec.includes(".") ? ctx.db.byName(rawSpec.split(".").pop()!)?.[0] : undefined));
      if (
        !targetClassId &&
        rawSpec &&
        rawSpec !== "Real" &&
        rawSpec !== "Integer" &&
        rawSpec !== "Boolean" &&
        rawSpec !== "String" &&
        rawSpec !== "Clock" &&
        rawSpec !== "StateSelect" &&
        rawSpec !== "ExternalObject" &&
        rawSpec !== "AssertionLevel" &&
        !rawSpec.startsWith("enumeration") &&
        !rawSpec.startsWith("SI.") &&
        !rawSpec.startsWith("Modelica.SIunits.") &&
        !rawSpec.startsWith("Modelica.Units.SI.")
      ) {
        cache.set(classId, true);
        return true;
      }
      if (
        targetClass &&
        ((sym?.resourceId && targetClass.resourceId && targetClass.resourceId !== sym.resourceId) ||
          (targetClass.language && targetClass.language !== "modelica") ||
          typeof (targetClass.metadata as Record<string, unknown> | undefined)?.["lowerComponentToDae"] ===
            "function" ||
          isOperatorRecordSym(ctx.db, targetClass) ||
          targetClass.name === "Complex")
      ) {
        cache.set(classId, true);
        return true;
      }
      const isTypeTarget =
        targetClass &&
        (targetClass.kind === "Type" || String(targetClass.metadata?.["classKind"] ?? "").toLowerCase() === "type");
      if (targetClass && !isTypeTarget && localCompNames.size > 0) {
        const targetCst = ctx.db.cstNode(targetClass.id) as CstNodeLike | null;
        if (targetCst && !cstHasKeywordToken(targetCst, "outer") && cstHasEqualsRhsIdent(targetCst, localCompNames)) {
          cache.set(classId, true);
          return true;
        }
      }
      if (
        targetClass &&
        !isTypeTarget &&
        (targetClass.kind === "Record" ||
          isRecordSym(ctx.db, targetClass) ||
          classHasUnsupportedWasmFeatures(ctx, cache, targetClass.id, visited))
      ) {
        cache.set(classId, true);
        return true;
      }
    }
  }

  const seenNames = new Set<string>();
  for (const child of children) {
    if (child.name && (child.kind === "Component" || child.kind === "Class")) {
      if (seenNames.has(child.name)) {
        cache.set(classId, true);
        return true;
      }
      seenNames.add(child.name);
    }
  }
  {
    let fileRootCst: CstNodeLike | null = cstNode;
    while (fileRootCst?.parent) fileRootCst = fileRootCst.parent;
    if (fileRootCst && cstHasExternalBuiltinOrDerivative(fileRootCst)) {
      cache.set(classId, true);
      return true;
    }
    const rootChildren = ctx.db.childrenOf(null) ?? [];
    const topSymbols = rootChildren.filter((s) => !sym?.resourceId || s.resourceId === sym.resourceId);
    const topNames = new Set<string>();
    for (const s of topSymbols) {
      if (s.name === "Clock" || topNames.has(s.name)) {
        cache.set(classId, true);
        return true;
      }
      topNames.add(s.name);
      if (s.kind === "Function" || s.kind === "Class" || s.kind === "Package") {
        const sCst = ctx.db.cstNode(s.id) as CstNodeLike | null;
        if (cstHasExternalBuiltinOrDerivative(sCst)) {
          cache.set(classId, true);
          return true;
        }
      }
    }
  }

  cache.set(classId, false);
  return false;
}

export function getUnsupportedWasmReasons(
  ctx: ClassFlattenerContext,
  classId?: SymbolId | null,
  visited = new Set<SymbolId>(),
): string[] {
  const reasons: string[] = [];
  if (!classId || visited.has(classId)) return reasons;
  visited.add(classId);

  const sym = ctx.db.symbol(classId);
  const cst = ctx.db.cstNode(classId) as CstNodeLike | null;

  if (cst && hasUnsupportedTypeOrConnectorAliasCst(cst)) {
    reasons.push("type-or-connector-alias");
  }
  if (cst && hasNonStandardEnumKeywordCst(cst)) {
    reasons.push("enumeration");
  }
  if (cst && hasConnectionsOrEqualityConstraintCst(cst)) {
    reasons.push("overconstrained-connections");
  }

  const children = ctx.db.childrenOf(classId);
  for (const child of children) {
    if (child.kind === "Extends") {
      const baseClass =
        ctx.db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ??
        (classId
          ? (ctx.db.query<NameResolverFn | null>("resolveName", classId)?.(child.name) ??
            ctx.db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(child.name))
          : null) ??
        ctx.db.byName(child.name)?.[0];
      if (baseClass) {
        const subReasons = getUnsupportedWasmReasons(ctx, baseClass.id, visited);
        if (subReasons.length > 0) {
          reasons.push(`extends:${baseClass.name}(${subReasons[0]})`);
        }
      }
    }
    if (child.kind === "Class" || child.kind === "Model" || child.kind === "Block" || child.kind === "Connector") {
      const subReasons = getUnsupportedWasmReasons(ctx, child.id, visited);
      if (subReasons.length > 0) {
        reasons.push(`nested-class:${child.name}(${subReasons[0]})`);
      }
    }
    if (child.kind === "Component") {
      const compInst = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", child.id);
      const targetClassId = compInst?.classInstance ?? compInst?.classTargetId;
      const targetClass = targetClassId
        ? ctx.db.symbol(targetClassId)
        : ((classId && compInst?.typeSpecifier
            ? (ctx.db.query<NameResolverFn | null>("resolveName", classId)?.(compInst.typeSpecifier) ??
              ctx.db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(compInst.typeSpecifier))
            : null) ?? ctx.db.byName(compInst?.typeSpecifier ?? compInst?.typeName ?? "")?.[0]);
      const isTypeTarget =
        targetClass &&
        (targetClass.kind === "Type" || String(targetClass.metadata?.["classKind"] ?? "").toLowerCase() === "type");
      if (targetClass && !isTypeTarget) {
        const subReasons = getUnsupportedWasmReasons(ctx, targetClass.id, visited);
        if (subReasons.length > 0) {
          reasons.push(`child-component:${child.name}(${subReasons[0]})`);
        }
      }
    }
  }

  const seenNames = new Set<string>();
  for (const child of children) {
    if (child.name && (child.kind === "Component" || child.kind === "Class")) {
      if (seenNames.has(child.name)) {
        reasons.push(`duplicate-name:${child.name}`);
        break;
      }
      seenNames.add(child.name);
    }
  }
  if (sym?.resourceId) {
    const dbExt = ctx.db as QueryDBWithCaches;
    const allSyms = typeof dbExt.allEntries === "function" ? dbExt.allEntries() : [];
    const topSymbols = allSyms.filter(
      (s) => s.resourceId === sym.resourceId && (s.parentId === null || s.parentId === 0),
    );
    const topNames = new Set<string>();
    for (const s of topSymbols) {
      if (s.name === "Clock" || topNames.has(s.name)) {
        reasons.push("top-clock-or-duplicate");
        break;
      }
      topNames.add(s.name);
    }
  }

  return reasons;
}
