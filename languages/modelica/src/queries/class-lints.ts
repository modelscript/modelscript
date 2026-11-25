// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Class Definition Semantic Lint Salsa Queries (`lint__*` hooks on `class_definition`).
 */

import { error, info, warning } from "@modelscript/dsl";
import { isTypeLikeSymbol, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import { runModelicaCfaAnalysis } from "../lints/cfa.js";
import { findNonlinearTermsInCst } from "../lints/homotopy-synthesis.js";
import type { ModelicaModArgs } from "../modifications.js";
import { collapseSpaceTokens, extractWithinFromCstNode, extractWithinFromSource } from "../workspace-hooks.js";
import {
  extractClassImportPairs,
  getShortClassSpecifierNode,
  getSymbolQualifiedName,
  hasNodePrefixKeyword,
  isIdentCharCode,
  isIdentStartCode,
  validateEnumeration,
} from "./cst-helpers.js";
import { checkModifierNotFound, parseModArgsFromCst } from "./modifications.js";
import { getQualifiedTypeFailRange, isScopeEncapsulated, resolveQualified } from "./name-resolution.js";
import {
  getSymbolMeta,
  type ComponentInstanceSummary,
  type ModelicaQueryHooks,
  type NodeProcessLike,
  type QueryCstNode,
  type QueryDiagnostic,
  type ResolveNameFn,
  type ResolveSimpleNameFn,
} from "./types.js";

/**
 * Semantic lint Salsa hooks attached to `class_definition` (`ClassDefinition`) symbols.
 */
export const classLintQueries: ModelicaQueryHooks = {
  /** Recommends homotopy operator for steep nonlinear equations. */
  lint__homotopyRecommended: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const nonlinear = findNonlinearTermsInCst(cst);
    if (!nonlinear || nonlinear.length === 0) return null;
    return nonlinear.map((item) =>
      info(ModelicaErrorCode.HOMOTOPY_RECOMMENDED.message(item.termText), {
        startOffset: item.startOffset,
        endOffset: item.endOffset,
        code: ModelicaErrorCode.HOMOTOPY_RECOMMENDED.code,
      }),
    );
  },

  /** Control Flow Analysis (CFA): Definite assignment (M5020), uninitialized reads (M5021), unreachable statements (M5022). */
  lint__cfaAnalysis: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const diags = runModelicaCfaAnalysis(db, self, cst);
    return diags && diags.length > 0 ? diags : null;
  },

  /** M4083, M4084: Validate enumeration literals for duplicates and reserved attribute names. */
  lint__validateEnumeration: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const res = validateEnumeration(cst, self);
    if (!res) return null;
    return [
      error(res.message, {
        startOffset: res.startOffset,
        endOffset: res.endOffset,
        code: res.code,
      }),
    ];
  },

  /** M4062: Invalid external object containing invalid elements or missing structors. */
  lint__invalidExternalObject: (db: QueryDB, self: SymbolEntry) => {
    const children = db.childrenOf(self.id);
    if (!children || children.length === 0) return null;
    const extendsEntries = children.filter((c) => c.kind === "Extends");
    const hasExternalObject = extendsEntries.some((e) => e.name === "ExternalObject");
    if (!hasExternalObject) return null;

    const invalidElements: { name: string; entry: SymbolEntry }[] = [];
    let hasConstructor = false;
    let hasDestructor = false;
    const replaceableElements: SymbolEntry[] = [];

    for (const child of children) {
      const cst = db.cstNode(child.id) as SyntaxNode | null;
      const text = cst?.text?.trim() ?? "";
      const childMeta = getSymbolMeta(child);
      const isReplaceable = Boolean(
        childMeta?.["isReplaceable"] ||
        db.query<boolean>("isReplaceable", child.id) ||
        cst?.parent?.type === "element_replaceable" ||
        cst?.parent?.type === "ElementReplaceable" ||
        hasNodePrefixKeyword(cst?.parent, "replaceable"),
      );

      if (child.kind === "Extends") {
        if (child.name !== "ExternalObject" && child.name !== "Icon" && !child.name.toLowerCase().endsWith("icon")) {
          invalidElements.push({ name: `extends ${child.name}`, entry: child });
        }
      } else if (child.kind === "Class") {
        const classPrefixes = String(childMeta?.["classPrefixes"] ?? "");
        const isFunction =
          text.startsWith("function ") ||
          text.startsWith("pure function ") ||
          text.startsWith("impure function ") ||
          text.startsWith("encapsulated function ") ||
          text.startsWith("encapsulated pure function ") ||
          text.startsWith("encapsulated impure function ") ||
          childMeta?.["classKind"] === "function" ||
          collapseSpaceTokens(classPrefixes).includes("function") ||
          child.ruleName === "function_definition";

        if (child.name === "constructor" && isFunction) {
          hasConstructor = true;
          if (isReplaceable) replaceableElements.push(child);
        } else if (child.name === "destructor" && isFunction) {
          hasDestructor = true;
          if (isReplaceable) replaceableElements.push(child);
        } else {
          invalidElements.push({ name: child.name, entry: child });
        }
      } else if (child.kind === "Component") {
        invalidElements.push({ name: child.name, entry: child });
      }
    }

    if (replaceableElements.length > 0) {
      const rep = replaceableElements[0]!;
      const repRange = rep.fieldRanges?.["name"] ?? rep.fieldRanges?.["declaredName"];
      return [
        error(ModelicaErrorCode.EXTERNAL_OBJECT_NOT_REPLACEABLE.message(rep.name), {
          startOffset: repRange?.startOffset ?? rep.startOffset,
          endOffset: repRange?.endOffset ?? rep.endOffset,
          code: ModelicaErrorCode.EXTERNAL_OBJECT_NOT_REPLACEABLE.code,
        }),
      ];
    }
    const selfCst = db.cstNode(self.id) as SyntaxNode | null;
    const isOldInst = Boolean(
      selfCst?.tree?.rootNode?.text?.includes("-d=-newInst") || selfCst?.text?.includes("-d=-newInst"),
    );
    if (isOldInst && invalidElements.length > 0) {
      const invNames = invalidElements.map((e) => e.name).join(", ");
      return [
        error(`Invalid external object ${self.name}, contains invalid elements: ${invNames}.`, {
          startOffset: self.startOffset,
          endOffset: self.endOffset,
          code: ModelicaErrorCode.INVALID_EXTERNAL_OBJECT.code,
        }),
      ];
    }
    const diags: QueryDiagnostic[] = [];
    for (const inv of invalidElements) {
      const invRange = inv.entry.fieldRanges?.["name"] ?? inv.entry.fieldRanges?.["declaredName"];
      diags.push(
        error(ModelicaErrorCode.INVALID_EXTERNAL_OBJECT.message(self.name, inv.name), {
          startOffset: invRange?.startOffset ?? inv.entry.startOffset,
          endOffset: invRange?.endOffset ?? inv.entry.endOffset,
          code: ModelicaErrorCode.INVALID_EXTERNAL_OBJECT.code,
        }),
      );
    }
    if (diags.length > 0) return diags;

    if (!hasDestructor) {
      return [
        error(ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_DESTRUCTOR.message(self.name), {
          startOffset: self.startOffset,
          endOffset: self.endOffset,
          code: ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_DESTRUCTOR.code,
        }),
      ];
    }
    if (!hasConstructor) {
      return [
        error(ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_CONSTRUCTOR.message(self.name), {
          startOffset: self.startOffset,
          endOffset: self.endOffset,
          code: ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_CONSTRUCTOR.code,
        }),
      ];
    }
    return null;
  },

  /** M4069: Non-constructors may not return an external object (Modelica §12.9.7). */
  lint__functionReturnsExternalObject: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const text = cst?.text?.trim() ?? "";
    const isFunction =
      text.startsWith("function ") ||
      text.startsWith("pure function ") ||
      text.startsWith("impure function ") ||
      getSymbolMeta(self)?.["classKind"] === "function" ||
      self.ruleName === "function_definition";
    if (!isFunction) return null;

    const children = db.childrenOf(self.id);
    for (const child of children) {
      if (child.kind === "Component") {
        const compInst = db.query<ComponentInstanceSummary | null>("componentInstance", child.id);
        if (compInst?.causality === "output") {
          const typeName = compInst.typeSpecifier;
          if (typeName) {
            const resolver =
              db.query<(name: string) => SymbolEntry | null>("resolveName", self.id) ??
              db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            const targetClass =
              resolver?.(typeName) ?? db.byName(typeName.split(".").pop()!).find((e) => e.kind === "Class");
            if (targetClass) {
              const targetChildren = db.childrenOf(targetClass.id);
              const extendsExtObj = targetChildren?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
              if (extendsExtObj) {
                const isConstructor = self.name === "constructor" && self.parentId === targetClass.id;
                if (!isConstructor) {
                  const fnQName = getSymbolQualifiedName(db, self.id);
                  const extObjQName = getSymbolQualifiedName(db, targetClass.id);
                  return [
                    error(
                      `Function ${fnQName} returns an external object, but the only function allowed to return this object is ${extObjQName}.constructor.`,
                      {
                        startOffset: child.startOffset,
                        endOffset: child.endOffset,
                        code: ModelicaErrorCode.EXTERNAL_OBJECT_RETURN_RESTRICTION.code,
                      },
                    ),
                  ];
                }
              }
            }
          }
        }
      }
    }
    return null;
  },

  /** M2003: Type / class not found in scope for short class specifiers. */
  lint__typeNotFound: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const spec = getShortClassSpecifierNode(cst);
    if (!spec) return null;

    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(spec) ??
      spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    let typeName = typeSpec?.text?.trim();
    if (!typeName) return null;
    typeName = typeName.split("[")[0]!.trim();
    if (!typeName) return null;

    if (
      typeName === "Real" ||
      typeName === "Integer" ||
      typeName === "Boolean" ||
      typeName === "String" ||
      typeName === "Clock" ||
      typeName === "StateSelect" ||
      typeName === "AssertionLevel" ||
      typeName === "ExternalObject"
    ) {
      return null;
    }

    let baseEntry: SymbolEntry | null = null;
    if (self.parentId !== null) {
      const resolve = db.query<ResolveNameFn | null>("resolveName", self.parentId);
      if (resolve) baseEntry = resolve(typeName, true);
      if (!baseEntry && !typeName.includes(".") && !typeName.includes("::")) {
        const resSimple = db.query<ResolveSimpleNameFn | null>("resolveSimpleName", self.parentId);
        if (resSimple) baseEntry = resSimple(typeName);
      }
    }

    if (!baseEntry && (typeName.startsWith(".") || self.parentId === null || !isScopeEncapsulated(db, self.parentId))) {
      if (typeName.includes(".") || typeName.includes("::")) {
        baseEntry = resolveQualified(db, typeName);
      } else {
        const entries = db.byName(typeName);
        baseEntry =
          entries?.find((e: SymbolEntry) => Boolean(getSymbolMeta(e)?.["isPredefined"]) || isTypeLikeSymbol(e)) ?? null;
      }
    }

    if (baseEntry) return null;

    const failRange = getQualifiedTypeFailRange(
      db,
      self.parentId,
      typeName,
      typeSpec,
      self.startOffset,
      self.startOffset + typeName.length,
    );

    const msg = `Class or type '${typeName}' not found in scope.`;
    return [
      error(msg, {
        ...failRange,
        code: 2003,
      }),
    ];
  },

  /**
   * M2004 / M4045: Validates that all modification arguments on a short class specifier
   * target existing elements or predefined attributes of the base class.
   */
  lint__modifierNotFound: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const spec = getShortClassSpecifierNode(cst);
    if (!spec) return null;
    const modNode =
      Cst.ShortClassSpecifier.classModification(spec) ??
      spec.children?.find((c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification");
    const mod = parseModArgsFromCst(modNode, self.parentId);
    if (!mod || !mod.args || mod.args.length === 0) return null;
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(spec) ??
      spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    const typeName = typeSpec?.text?.trim();
    if (typeName) {
      let baseEntry: SymbolEntry | null = null;
      if (self.parentId !== null) {
        const resolve = db.query<ResolveNameFn | null>("resolveName", self.parentId);
        if (resolve) baseEntry = resolve(typeName, true);
        if (!baseEntry && !typeName.includes(".")) {
          const resSimple = db.query<ResolveSimpleNameFn | null>("resolveSimpleName", self.parentId);
          if (resSimple) baseEntry = resSimple(typeName);
        }
      }
      if (!baseEntry) {
        if (typeName.includes(".")) {
          baseEntry = resolveQualified(db, typeName);
        } else {
          const entries = db.byName(typeName);
          baseEntry = entries?.find((e) => e.kind === "Class") ?? null;
        }
      }
      if (baseEntry) {
        return checkModifierNotFound(db, self, mod, baseEntry.id, baseEntry, self.name);
      }
    }
    return null;
  },

  /** M2021: Conflicting import short names within the same class definition (MLS §13.2.1.1). */
  lint__importConflict: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;

    const seenShortToTarget = new Map<string, string>();
    const diags: ReturnType<typeof warning>[] = [];

    for (const child of db.childrenOf(self.id)) {
      if (child.kind !== "Import") continue;
      const parsed = extractClassImportPairs(db, child);
      if (!parsed || parsed.importKind === "unqualified") continue;

      for (const [shortName, target] of parsed.pairs) {
        const existing = seenShortToTarget.get(shortName);
        if (existing !== undefined && existing !== target) {
          diags.push(
            warning(ModelicaErrorCode.IMPORT_CONFLICT.message(shortName, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.IMPORT_CONFLICT.code,
            }),
          );
        } else if (existing === undefined) {
          seenShortToTarget.set(shortName, target);
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /** M2024: Unused qualified, renamed, or compound import in non-package classes (MLS §13.2). */
  lint__unusedImport: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;
    const prefix = ((meta?.["classPrefixes"] as string) ?? "").toLowerCase();
    if (prefix.includes("package")) return null;

    const classCst = db.cstNode(self.id) as SyntaxNode | null;
    const fullText: string = classCst?.text ?? "";
    if (!fullText) return null;

    const classStart = classCst?.startIndex ?? classCst?.startOffset ?? self.startOffset;
    const chars = fullText.split("");
    let hasImports = false;
    const importEntries: Array<{ pairs: Array<[string, string]>; startOffset: number; endOffset: number }> = [];
    for (const child of db.childrenOf(self.id)) {
      if (child.kind !== "Import") continue;
      hasImports = true;
      const parsed = extractClassImportPairs(db, child);
      if (parsed && parsed.importKind !== "unqualified") {
        importEntries.push(parsed);
      }
      const relS = Math.max(0, (parsed?.startOffset ?? child.startOffset) - classStart);
      const relE = Math.min(chars.length, (parsed?.endOffset ?? child.endOffset) - classStart);
      for (let i = relS; i < relE; i++) chars[i] = " ";
    }
    if (!hasImports || importEntries.length === 0) return null;

    const usedIdents = new Set<string>();
    const scanText = chars.join("");
    let cur = "";
    for (let i = 0; i < scanText.length; i++) {
      const ch = scanText.charCodeAt(i);
      if (cur.length === 0 ? isIdentStartCode(ch) : isIdentCharCode(ch)) {
        cur += scanText[i];
      } else if (cur.length > 0) {
        usedIdents.add(cur);
        cur = "";
      }
    }
    if (cur.length > 0) usedIdents.add(cur);

    const diags: ReturnType<typeof info>[] = [];
    for (const parsed of importEntries) {
      for (const [shortName] of parsed.pairs) {
        if (!usedIdents.has(shortName)) {
          diags.push(
            info(ModelicaErrorCode.UNUSED_IMPORT.message(shortName, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.UNUSED_IMPORT.code,
            }),
          );
        }
      }
    }
    return diags.length > 0 ? diags : null;
  },

  /** M4148: Checks physical connector balance (#potential == #flow for connectors with flow variables, MLS §9.3.1). */
  lint__connectorUnbalanced: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;
    const prefix = ((meta?.["classPrefixes"] as string) ?? "").toLowerCase();
    if (!prefix.includes("connector") || prefix.includes("partial") || prefix.includes("expandable")) {
      return null;
    }

    const countBalance = (classId: SymbolId, visited: Set<SymbolId>): { potential: number; flow: number } | null => {
      if (visited.has(classId)) return { potential: 0, flow: 0 };
      visited.add(classId);
      let potential = 0;
      let flow = 0;

      const elems = db.query<SymbolEntry[]>("allElements", classId) ?? [];
      for (const elem of elems) {
        if (elem.kind !== "Component") continue;
        const variab = db.query<string | null>("variability", elem.id);
        if (variab === "parameter" || variab === "constant") continue;

        const fp = db.query<string | null>("flowPrefix", elem.id);
        if (fp === "stream") continue;

        const dims = db.query<number[] | null>("resolvedArrayDimensions", elem.id);
        let scalarCount = 1;
        if (Array.isArray(dims) && dims.length > 0) {
          for (const d of dims) {
            if (typeof d !== "number" || d < 0) return null;
            scalarCount *= d;
          }
        }

        const typeSpec = (db.query<string | null>("typeSpecifier", elem.id) ?? "").trim();
        const typeClassId = db.query<SymbolId | null>("classInstance", elem.id);
        const typeEntry = typeClassId ? db.symbol(typeClassId) : null;
        const typeMeta = getSymbolMeta(typeEntry);
        const typePrefixes = ((typeMeta?.["classPrefixes"] as string) ?? "").toLowerCase();

        if (typePrefixes.includes("connector") && typeClassId && !typePrefixes.includes("expandable")) {
          const sub = countBalance(typeClassId, visited);
          if (!sub) return null;
          potential += sub.potential * scalarCount;
          flow += sub.flow * scalarCount;
          continue;
        }

        const baseType = typeEntry ? db.query<string | null>("typeSpecifier", typeEntry.id) : null;
        const isRealLike =
          typeSpec === "Real" ||
          baseType === "Real" ||
          (!typeEntry && (typeSpec === "" || typeSpec === "Real")) ||
          typePrefixes.includes("type");
        if (!isRealLike) {
          if (typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") continue;
          return null;
        }

        if (fp === "flow") {
          flow += scalarCount;
        } else {
          potential += scalarCount;
        }
      }
      return { potential, flow };
    };

    const bal = countBalance(self.id, new Set());
    if (!bal || bal.flow === 0 || bal.potential === bal.flow) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    return warning(ModelicaErrorCode.CONNECTOR_UNBALANCED.message(self.name, String(bal.potential), String(bal.flow)), {
      startOffset: cst?.startIndex ?? cst?.startOffset ?? self.startOffset,
      endOffset: cst?.endIndex ?? cst?.endOffset ?? self.endOffset,
      code: ModelicaErrorCode.CONNECTOR_UNBALANCED.code,
    });
  },

  /** M4150: Function derivative annotation target cannot be resolved or is not a function. */
  lint__derivativeAnnotationMismatch: (db: QueryDB, self: SymbolEntry) => {
    const getMetaKind = (sym: SymbolEntry): string =>
      String(getSymbolMeta(sym)?.["classKind"] ?? getSymbolMeta(sym)?.["classPrefixes"] ?? "").toLowerCase();
    const isFunctionLike = (sym: SymbolEntry): boolean =>
      sym.kind === "Function" || /\bfunction\b/.test(getMetaKind(sym));
    if (!isFunctionLike(self)) return null;
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;

    const spec =
      Cst.ClassDefinition?.classSpecifier?.(cst) ??
      cst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );
    const annContainers: SyntaxNode[] = [];
    const collectOwnAnnotations = (n: SyntaxNode) => {
      if (!n) return;
      if (n.type === "class_definition" && n !== cst) return;
      if (n.type === "annotation_clause") {
        annContainers.push(n);
        return;
      }
      for (const ch of n.children || []) collectOwnAnnotations(ch);
    };
    collectOwnAnnotations(spec ?? cst);
    if (annContainers.length === 0) return null;

    const derivTargets: Array<{ name: string; node: SyntaxNode }> = [];
    const extractDerivatives = (n: SyntaxNode) => {
      if (!n) return;
      if (n.type === "element_modification") {
        const nameNode = n.childForFieldName?.("name") ?? n.children?.find((c: SyntaxNode) => c.type === "name");
        if (nameNode?.text?.trim() === "derivative") {
          const modNode =
            n.childForFieldName?.("modification") ?? n.children?.find((c: SyntaxNode) => c.type === "modification");
          const modExpr = modNode?.children?.find((c: SyntaxNode) => c.type === "modification_expression");
          const raw = modExpr?.text?.trim() ?? "";
          if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(raw)) {
            derivTargets.push({ name: raw, node: modExpr ?? n });
          }
          return;
        }
      }
      for (const ch of n.children || []) extractDerivatives(ch);
    };
    for (const ann of annContainers) extractDerivatives(ann);
    if (derivTargets.length === 0) return null;

    const diags: ReturnType<typeof warning>[] = [];
    const scopeId = self.parentId ?? self.id;
    const resolver = db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId);

    for (const target of derivTargets) {
      let resolved: SymbolEntry | null = null;
      if (self.parentId !== null) {
        resolved =
          db
            .childrenOf(self.parentId)
            ?.find((c) => (c.kind === "Class" || c.kind === "Function") && c.name === target.name) ?? null;
      }
      if (!resolved && resolver) resolved = resolver(target.name);
      if (!resolved && target.name.includes(".")) resolved = resolveQualified(db, target.name);
      if (!resolved && !target.name.includes(".")) {
        const matches = db.byName(target.name);
        resolved = matches.find((m) => m.kind === "Class" || m.kind === "Function") ?? matches[0] ?? null;
      }

      if (!resolved) {
        if (target.name.includes(".")) {
          const rootPkg = target.name.split(".")[0]!;
          const rootExists = Boolean(resolver?.(rootPkg)) || db.byName(rootPkg).length > 0;
          if (!rootExists) continue;
        }
        diags.push(
          warning(ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.message(self.name, target.name), {
            startOffset: target.node.startIndex ?? target.node.startOffset ?? self.startOffset,
            endOffset: target.node.endIndex ?? target.node.endOffset ?? self.endOffset,
            code: ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.code,
          }),
        );
        continue;
      }

      const targetKind = getMetaKind(resolved);
      const isValidTarget = isFunctionLike(resolved) || (resolved.kind === "Class" && /\bclass\b/.test(targetKind));
      if (!isValidTarget) {
        diags.push(
          warning(ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.message(self.name, target.name), {
            startOffset: target.node.startIndex ?? target.node.startOffset ?? self.startOffset,
            endOffset: target.node.endIndex ?? target.node.endOffset ?? self.endOffset,
            code: ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.code,
          }),
        );
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /**
   * M2020: Unresolved import target in Modelica class (MLS §13.2.1).
   * Scoped to workspace-rooted packages or unqualified targets to avoid false positives on unmounted external libraries.
   */
  lint__importNotFound: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;

    const diags: ReturnType<typeof warning>[] = [];
    const scopeId = self.parentId ?? self.id;
    const resolver = db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId);

    const resolveNonImportTarget = (pathStr: string): SymbolEntry | null => {
      if (pathStr.includes(".")) {
        const q = resolveQualified(db, pathStr);
        return q && q.kind !== "Import" ? q : null;
      }
      const fromScope = resolver?.(pathStr);
      if (fromScope && fromScope.kind !== "Import") return fromScope;
      return db.byName(pathStr).find((e) => e.kind !== "Import") ?? null;
    };
    const isRootKnown = (pathStr: string): boolean => {
      if (!pathStr.includes(".")) return true;
      const rootPkg = pathStr.split(".")[0]!;
      const fromScope = resolver?.(rootPkg);
      if (fromScope && fromScope.kind !== "Import") return true;
      return db.byName(rootPkg).some((e) => e.kind !== "Import");
    };

    for (const child of db.childrenOf(self.id)) {
      if (child.kind !== "Import") continue;
      const parsed = extractClassImportPairs(db, child);
      if (!parsed) continue;

      if (parsed.importKind === "unqualified") {
        const metaPkg = getSymbolMeta(child)?.["packageName"] as string | undefined;
        const cstText = (db.cstNode(child.id) as SyntaxNode | null)?.text as string | undefined;
        let pkgPath = metaPkg && metaPkg.trim().length > 0 ? metaPkg : "";
        if (!pkgPath && cstText) {
          pkgPath = cstText
            .replace(/^\s*import\s+/, "")
            .replace(/;$/, "")
            .trim();
        }
        if (!pkgPath) pkgPath = child.name;
        const cleanPkg = pkgPath.replace(/\.\*$/, "").trim();
        if (!cleanPkg || cleanPkg === "*") continue;
        if (!resolveNonImportTarget(cleanPkg) && isRootKnown(cleanPkg)) {
          diags.push(
            warning(ModelicaErrorCode.IMPORT_NOT_FOUND.message(cleanPkg, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.IMPORT_NOT_FOUND.code,
            }),
          );
        }
        continue;
      }

      for (const [, target] of parsed.pairs) {
        if (!target) continue;
        if (!resolveNonImportTarget(target) && isRootKnown(target)) {
          diags.push(
            warning(ModelicaErrorCode.IMPORT_NOT_FOUND.message(target, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.IMPORT_NOT_FOUND.code,
            }),
          );
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /** M4151: Unconnected required input on block/model component instances. */
  lint__unconnectedInput: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (prefix.includes("partial")) return null;
    const isModelOrBlock = /\b(model|block)\b/.test(prefix);
    if (!isModelOrBlock) return null;

    const referencedPaths = new Set<string>();
    const collectEqRefs = (clsId: SymbolId, visited: Set<SymbolId>) => {
      if (visited.has(clsId)) return;
      visited.add(clsId);
      const clsCst = db.cstNode(clsId) as SyntaxNode | null;
      if (clsCst) {
        const walkEqSections = (node: SyntaxNode) => {
          if (!node) return;
          if (node !== clsCst && node.type === "class_definition") return;
          if (node.type === "equation_section" || node.type === "algorithm_section") {
            const txt = String(node.text ?? "");
            for (const m of txt.matchAll(
              /\b([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?)+)\b/g,
            )) {
              const normalized = m[1]!.replace(/\[[^\]]*\]/g, "");
              referencedPaths.add(normalized);
            }
            return;
          }
          for (const ch of node.children ?? []) walkEqSections(ch);
        };
        walkEqSections(clsCst);
      }
      for (const ch of db.childrenOf(clsId)) {
        if (ch.kind === "Connect") {
          const cmeta = getSymbolMeta(ch);
          for (const side of [cmeta?.["lhs"], cmeta?.["rhs"]]) {
            if (typeof side === "string") referencedPaths.add(side.replace(/\[[^\]]*\]/g, "").trim());
          }
        } else if (ch.kind === "Extends") {
          const base = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
          if (base) collectEqRefs(base.id, visited);
        }
      }
    };
    collectEqRefs(self.id, new Set());

    const hasDefaultBindingOrProtected = (elem: SymbolEntry): boolean => {
      const em = getSymbolMeta(elem);
      if (em?.["visibility"] === "protected") return true;
      const ecst = db.cstNode(elem.id) as SyntaxNode | null;
      if (!ecst) return false;
      let cur: SyntaxNode | null = ecst;
      while (cur && cur.type !== "element" && cur.type !== "component_clause") cur = cur.parent;
      if (
        cur?.parent?.type === "protected" ||
        String(ecst.text ?? "")
          .trimStart()
          .startsWith("protected")
      )
        return true;
      const declText = String(ecst.text ?? "");
      let depth = 0;
      let inStr = false;
      for (let i = 0; i < declText.length; i++) {
        const c = declText[i]!;
        if (inStr) {
          if (c === "\\" && i + 1 < declText.length) i++;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === "=") return true;
      }
      return false;
    };

    const diags: ReturnType<typeof warning>[] = [];
    for (const comp of db.childrenOf(self.id)) {
      if (comp.kind !== "Component") continue;
      const cCst = db.cstNode(comp.id) as SyntaxNode | null;
      if (cCst) {
        let clauseNode: SyntaxNode | null = cCst;
        while (clauseNode && clauseNode.type !== "component_clause") clauseNode = clauseNode.parent;
        const clauseTxt = String(clauseNode?.text ?? "");
        if (/\bouter\b/.test(clauseTxt.split(/\s+/)[0] ?? "")) continue;
        if (cCst.children?.some((ch: SyntaxNode) => ch.type === "condition_attribute")) continue;
      }

      const compTypeId = db.query<SymbolId | null>("classInstance", comp.id);
      if (!compTypeId) continue;
      const compType = db.symbol(compTypeId);
      if (!compType || compType.kind !== "Class") continue;
      const typePrefix = String(getSymbolMeta(compType)?.["classPrefixes"] ?? "").toLowerCase();
      if (!/\b(block|model)\b/.test(typePrefix) || /\bconnector\b/.test(typePrefix)) continue;

      const compMod = db.query<ModelicaModArgs | null>("effectiveModification", comp.id);
      const modifiedNames = new Set((compMod?.args ?? []).map((a) => a.name));

      const subElems = (db.query<SymbolEntry[]>("allElements", compTypeId) ?? []).filter((e) => e.kind === "Component");
      for (const elem of subElems) {
        if (modifiedNames.has(elem.name)) continue;
        let isInput = db.query<string | null>("causality", elem.id) === "input";
        if (!isInput) {
          const elemTypeId = db.query<SymbolId | null>("classInstance", elem.id);
          if (elemTypeId) {
            const elemTypeCst = db.cstNode(elemTypeId) as SyntaxNode | null;
            const scs = getShortClassSpecifierNode(elemTypeCst);
            const pfx = scs?.children?.find((c: SyntaxNode) => c.type === "base_prefix" || c.type === "type_prefix");
            if (/\binput\b/.test(String(pfx?.text ?? scs?.text ?? ""))) isInput = true;
          }
        }
        if (!isInput) continue;
        const elemCst = db.cstNode(elem.id) as SyntaxNode | null;
        if (elemCst?.children?.some((ch: SyntaxNode) => ch.type === "condition_attribute")) continue;
        if (hasDefaultBindingOrProtected(elem)) continue;

        const targetPath = `${comp.name}.${elem.name}`;
        let connected = referencedPaths.has(targetPath);
        if (!connected) {
          for (const ref of referencedPaths) {
            if (ref.startsWith(`${targetPath}.`)) {
              connected = true;
              break;
            }
          }
        }
        if (!connected) {
          diags.push(
            warning(ModelicaErrorCode.UNCONNECTED_INPUT.message(targetPath, comp.name), {
              startOffset: cCst?.startIndex ?? cCst?.startOffset ?? comp.startOffset,
              endOffset: cCst?.endIndex ?? cCst?.endOffset ?? comp.endOffset,
              code: ModelicaErrorCode.UNCONNECTED_INPUT.code,
            }),
          );
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /** M4152: Concrete example model/block inside an 'Examples' package missing an experiment(...) annotation. */
  lint__experimentAnnotationMissing: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (prefix.includes("partial") || !/\b(model|block)\b/.test(prefix)) return null;

    let inExamplesPkg = false;
    let pId = self.parentId;
    while (pId !== null) {
      const parent = db.symbol(pId);
      if (!parent) break;
      if (parent.name === "Examples") {
        inExamplesPkg = true;
        break;
      }
      pId = parent.parentId;
    }
    if (!inExamplesPkg) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const spec =
      Cst.ClassDefinition?.classSpecifier?.(cst) ??
      cst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );
    let hasExperiment = false;
    const visitAnn = (n: SyntaxNode) => {
      if (!n || hasExperiment) return;
      if (n !== cst && n.type === "class_definition") return;
      if (n.type === "annotation_clause") {
        const checkMod = (an: SyntaxNode) => {
          if (!an || hasExperiment) return;
          if (an.type === "element_modification") {
            const nameNode = an.childForFieldName?.("name") ?? an.children?.find((c: SyntaxNode) => c.type === "name");
            if (nameNode?.text?.trim() === "experiment") {
              hasExperiment = true;
              return;
            }
          }
          for (const ch of an.children ?? []) checkMod(ch);
        };
        checkMod(n);
        return;
      }
      for (const ch of n.children ?? []) visitAnn(ch);
    };
    visitAnn(spec ?? cst);
    if (hasExperiment) return null;

    return info(ModelicaErrorCode.EXPERIMENT_ANNOTATION_MISSING.message(self.name), {
      startOffset: cst.startIndex ?? cst.startOffset ?? self.startOffset,
      endOffset: cst.endIndex ?? cst.endOffset ?? self.endOffset,
      code: ModelicaErrorCode.EXPERIMENT_ANNOTATION_MISSING.code,
    });
  },

  /** M2022: Encapsulated lookup violation — referencing an outer non-imported, non-global symbol inside an encapsulated scope (MLS §5.3.1). */
  lint__encapsulatedLookupViolation: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;
    if (!isScopeEncapsulated(db, self.id)) return null;

    let encapBoundary: SymbolEntry = self;
    {
      let cur: SymbolEntry | null = self;
      while (cur) {
        const pfx = String(getSymbolMeta(cur)?.["classPrefixes"] ?? "").toLowerCase();
        const curCst = db.cstNode(cur.id) as SyntaxNode | null;
        const rawPfx = (curCst?.text?.slice(0, 64) ?? "").toLowerCase();
        if (pfx.includes("encapsulated") || /^\s*encapsulated\b/.test(rawPfx)) {
          encapBoundary = cur;
          break;
        }
        cur = cur.parentId !== null ? (db.symbol(cur.parentId) ?? null) : null;
      }
    }

    const PREDEFINED_TYPES = new Set([
      "Real",
      "Integer",
      "Boolean",
      "String",
      "Clock",
      "StateSelect",
      "AssertionLevel",
      "ExternalObject",
      "ModelicaServices",
      "Connections",
    ]);

    const allowedNames = new Set<string>(PREDEFINED_TYPES);
    const encapSubtreeIds = new Set<SymbolId>();
    const collectSubtreeClasses = (clsId: SymbolId) => {
      if (encapSubtreeIds.has(clsId)) return;
      encapSubtreeIds.add(clsId);
      const sym = db.symbol(clsId);
      if (sym && (sym.kind === "Class" || sym.kind === "Package" || sym.kind === "Function")) {
        allowedNames.add(sym.name);
      }
      for (const ch of db.childrenOf(clsId)) {
        if (ch.kind === "Class" || ch.kind === "Package" || ch.kind === "Function") {
          collectSubtreeClasses(ch.id);
        }
      }
    };
    collectSubtreeClasses(encapBoundary.id);

    {
      let anc: SymbolEntry | null = self;
      while (anc) {
        for (const ch of db.childrenOf(anc.id)) {
          if (ch.kind !== "Import") continue;
          const parsed = extractClassImportPairs(db, ch);
          if (!parsed) continue;
          if (parsed.importKind === "unqualified") {
            const pkgStr = (getSymbolMeta(ch)?.["packageName"] as string | undefined) ?? ch.name;
            const targetPkg = resolveQualified(db, pkgStr.replace(/\.\*$/, "").trim());
            if (targetPkg) {
              for (const exported of db.childrenOf(targetPkg.id)) {
                if (exported.kind === "Class" || exported.kind === "Package" || exported.kind === "Function") {
                  allowedNames.add(exported.name);
                }
              }
            }
          } else {
            for (const [shortName] of parsed.pairs) allowedNames.add(shortName);
          }
        }
        if (anc.id === encapBoundary.id) break;
        anc = anc.parentId !== null ? (db.symbol(anc.parentId) ?? null) : null;
      }
    }

    const isInsideEncap = (sym: SymbolEntry): boolean => {
      let cur: SymbolEntry | null = sym;
      while (cur) {
        if (encapSubtreeIds.has(cur.id)) return true;
        cur = cur.parentId !== null ? (db.symbol(cur.parentId) ?? null) : null;
      }
      return false;
    };

    const diags: ReturnType<typeof warning>[] = [];
    const seen = new Set<string>();
    const checkTypeRef = (typeRef: string | null | undefined, startOffset: number, endOffset: number) => {
      if (!typeRef) return;
      const trimmed = typeRef.trim();
      if (!trimmed || trimmed.startsWith(".")) return;
      const rootName = trimmed.split(".")[0]!;
      if (allowedNames.has(rootName)) return;
      const externalMatches = db
        .byName(rootName)
        .filter((e) => (e.kind === "Class" || e.kind === "Package" || e.kind === "Function") && !isInsideEncap(e));
      if (externalMatches.length > 0 && !seen.has(rootName)) {
        seen.add(rootName);
        diags.push(
          warning(ModelicaErrorCode.ENCAPSULATED_LOOKUP_VIOLATION.message(trimmed, encapBoundary.name), {
            startOffset,
            endOffset,
            code: ModelicaErrorCode.ENCAPSULATED_LOOKUP_VIOLATION.code,
          }),
        );
      }
    };

    for (const ch of db.childrenOf(self.id)) {
      if (ch.kind === "Component") {
        const ts = db.query<string | null>("typeSpecifier", ch.id);
        const cstNode = db.cstNode(ch.id) as SyntaxNode | null;
        checkTypeRef(
          ts,
          cstNode?.startIndex ?? cstNode?.startOffset ?? ch.startOffset,
          cstNode?.endIndex ?? cstNode?.endOffset ?? ch.endOffset,
        );
      } else if (ch.kind === "Extends") {
        const cstNode = db.cstNode(ch.id) as SyntaxNode | null;
        const typeNode = cstNode ? Cst.ExtendsClause.typeSpecifier(cstNode) : null;
        checkTypeRef(
          typeNode?.text?.trim() ?? ch.name,
          cstNode?.startIndex ?? cstNode?.startOffset ?? ch.startOffset,
          cstNode?.endIndex ?? cstNode?.endOffset ?? ch.endOffset,
        );
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /** M4153: Library package references external libraries via imports/types without declaring annotation(uses(...)). */
  lint__missingUsesAnnotation: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"] || self.parentId !== null) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (!/\bpackage\b/.test(prefix)) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const spec =
      Cst.ClassDefinition?.classSpecifier?.(cst) ??
      cst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );

    let isLibraryPkg = false;
    const declaredUses = new Set<string>();
    const scanTopAnn = (n: SyntaxNode) => {
      if (!n) return;
      if (n !== cst && n.type === "class_definition") return;
      if (n.type === "annotation_clause") {
        const inspectMods = (an: SyntaxNode) => {
          if (!an) return;
          if (an.type === "element_modification") {
            const nm = (
              an.childForFieldName?.("name") ?? an.children?.find((c: SyntaxNode) => c.type === "name")
            )?.text?.trim();
            if (nm === "version" || nm === "uses") isLibraryPkg = true;
            if (nm === "uses") {
              const modText = String(an.text ?? "");
              for (const um of modText.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
                if (um[1] && um[1] !== "uses") declaredUses.add(um[1]);
              }
              return;
            }
          }
          for (const ch of an.children ?? []) inspectMods(ch);
        };
        inspectMods(n);
        return;
      }
      for (const ch of n.children ?? []) scanTopAnn(ch);
    };
    scanTopAnn(spec ?? cst);
    if (!isLibraryPkg) return null;

    const IGNORED_ROOTS = new Set([
      self.name,
      "Real",
      "Integer",
      "Boolean",
      "String",
      "Complex",
      "StateSelect",
      "AssertionLevel",
      "Clock",
      "ExternalObject",
      "ModelicaServices",
      "Connections",
    ]);
    const referencedLibs = new Map<string, { startOffset: number; endOffset: number }>();
    const collectSubtreeImports = (clsId: SymbolId, visited: Set<SymbolId>) => {
      if (visited.has(clsId)) return;
      visited.add(clsId);
      for (const ch of db.childrenOf(clsId)) {
        if (ch.kind === "Import") {
          const parsed = extractClassImportPairs(db, ch);
          if (!parsed) continue;
          const targets: string[] = [];
          if (parsed.importKind === "unqualified") {
            const mp = getSymbolMeta(ch)?.["packageName"] as string | undefined;
            const ct = (db.cstNode(ch.id) as SyntaxNode | null)?.text as string | undefined;
            const raw =
              mp?.trim() ||
              ct
                ?.replace(/^\s*import\s+/, "")
                .replace(/;$/, "")
                .trim() ||
              ch.name;
            targets.push(raw.replace(/\.\*$/, "").trim());
          } else {
            for (const [, t] of parsed.pairs) targets.push(t);
          }
          for (const t of targets) {
            const rootLib = t.split(".")[0]!;
            if (!rootLib || IGNORED_ROOTS.has(rootLib) || rootLib.startsWith(".")) continue;
            const isLoadedExternalPkg = db.byName(rootLib).some((s) => s.kind === "Package" && s.id !== self.id);
            if ((t.includes(".") || isLoadedExternalPkg) && !referencedLibs.has(rootLib)) {
              referencedLibs.set(rootLib, { startOffset: parsed.startOffset, endOffset: parsed.endOffset });
            }
          }
        } else if (ch.kind === "Class" || ch.kind === "Package" || ch.kind === "Function") {
          collectSubtreeImports(ch.id, visited);
        }
      }
    };
    collectSubtreeImports(self.id, new Set());

    const diags: ReturnType<typeof warning>[] = [];
    for (const [lib, span] of referencedLibs.entries()) {
      if (!declaredUses.has(lib)) {
        diags.push(
          warning(ModelicaErrorCode.MISSING_USES_ANNOTATION.message(self.name, lib), {
            startOffset: span.startOffset,
            endOffset: span.endOffset,
            code: ModelicaErrorCode.MISSING_USES_ANNOTATION.code,
          }),
        );
      }
    }
    return diags.length > 0 ? diags : null;
  },

  /**
   * M2023: Validates top-level `within <pkg>;` header against enclosing `package.mo` directory
   * hierarchy and optional `package.order` file (MLS §13.4).
   */
  lint__withinMismatch: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;

    const normalizeRes = (u: string): string => {
      let s = u.replace(/\\/g, "/");
      if (s.startsWith("file:///")) s = s.slice(7);
      else if (s.startsWith("file://")) s = s.slice(7);
      return s;
    };
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const rawRes = self.documentUri ?? self.resourceId ?? (cst?.tree as { uri?: string } | undefined)?.uri;
    if (!rawRes) return null;
    const normPath = normalizeRes(rawRes);
    const lastSlash = normPath.lastIndexOf("/");
    if (lastSlash < 0) return null;

    if (self.parentId !== null) {
      const parentSym = db.parentOf(self.id);
      const parentRawRes = parentSym?.documentUri ?? parentSym?.resourceId;
      if (parentSym && parentRawRes && normalizeRes(parentRawRes) === normPath) return null;
    }

    const dirPath = normPath.slice(0, lastSlash);
    const fileBase = normPath.slice(lastSlash + 1);
    const isPackageMo = fileBase === "package.mo";
    const parentDirOfScope = (() => {
      if (!isPackageMo) return dirPath;
      const s = dirPath.lastIndexOf("/");
      return s >= 0 ? dirPath.slice(0, s) : "";
    })();

    const packageByDir = new Map<string, SymbolEntry>();
    for (const entry of db.allEntries()) {
      const er = entry.documentUri ?? entry.resourceId;
      if (!er) continue;
      const en = normalizeRes(er);
      if (!en.endsWith("/package.mo")) continue;
      const ek = entry.kind;
      const ePrefix = String(getSymbolMeta(entry)?.["classPrefixes"] ?? "").toLowerCase();
      if (ek !== "Package" && !(ek === "Class" && /\bpackage\b/.test(ePrefix))) continue;
      const ep = entry.parentId !== null ? db.parentOf(entry.id) : null;
      const epRes = ep?.documentUri ?? ep?.resourceId;
      if (ep && epRes && normalizeRes(epRes) === en) continue;
      const eSlash = en.lastIndexOf("/");
      if (eSlash >= 0) {
        const eDir = en.slice(0, eSlash);
        if (!packageByDir.has(eDir)) packageByDir.set(eDir, entry);
      }
    }

    const expectedSegments: string[] = [];
    let curDir = parentDirOfScope;
    const seenDirs = new Set<string>();
    while (curDir.length > 0 && !seenDirs.has(curDir)) {
      seenDirs.add(curDir);
      const dirPkg = packageByDir.get(curDir);
      if (!dirPkg) break;
      expectedSegments.unshift(dirPkg.name);
      const s = curDir.lastIndexOf("/");
      curDir = s >= 0 ? curDir.slice(0, s) : "";
    }

    const src = cst?.tree?.sourceCode as string | undefined;
    const withinPkg = extractWithinFromCstNode(cst?.tree?.rootNode) ?? (src ? extractWithinFromSource(src) : null);
    const diags: ReturnType<typeof warning>[] = [];
    const span = {
      startOffset: self.startOffset,
      endOffset: Math.max(self.startOffset + 1, self.endOffset),
      code: ModelicaErrorCode.WITHIN_MISMATCH.code,
    };

    if (expectedSegments.length > 0) {
      const expectedWithin = expectedSegments.join(".");
      const actualWithin = withinPkg ?? "";
      if (actualWithin !== expectedWithin) {
        diags.push(
          warning(
            ModelicaErrorCode.WITHIN_MISMATCH.message(
              actualWithin || "<empty>",
              fileBase,
              `expected 'within ${expectedWithin};'`,
            ),
            span,
          ),
        );
      }
    }

    if (parentDirOfScope.length > 0 && !rawRes.startsWith("http")) {
      try {
        const proc = (globalThis as unknown as { process?: NodeProcessLike }).process;
        const nodeFs = proc?.getBuiltinModule?.("node:fs");
        if (nodeFs) {
          const orderFile = `${parentDirOfScope}/package.order`;
          if (nodeFs.existsSync(orderFile)) {
            const rawOrder = String(nodeFs.readFileSync(orderFile, "utf8"));
            const orderSet = new Set<string>();
            for (const line of rawOrder.split(/\r?\n/)) {
              const trimmed = line.replace(/\/\/.*$/, "").trim();
              if (trimmed.length > 0) orderSet.add(trimmed);
            }
            if (orderSet.size > 0 && !orderSet.has(self.name)) {
              diags.push(
                warning(
                  ModelicaErrorCode.WITHIN_MISMATCH.message(
                    withinPkg ?? "<empty>",
                    fileBase,
                    `class '${self.name}' is omitted from 'package.order'`,
                  ),
                  span,
                ),
              );
            }
          }
        }
      } catch {
        // Ignore filesystem access errors in virtual or sandboxed workspaces
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /** M4154: Locally unbalanced non-partial model/block check via `instantiate` (MLS §4.8). */
  lint__locallyUnbalancedClass: (db: QueryDB, self: SymbolEntry) => {
    const meta = getSymbolMeta(self);
    if (meta?.["isPredefined"]) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (
      /\bpartial\b/.test(prefix) ||
      /\bfunction\b/.test(prefix) ||
      /\brecord\b/.test(prefix) ||
      /\btype\b/.test(prefix) ||
      /\bconnector\b/.test(prefix) ||
      /\bpackage\b/.test(prefix) ||
      /\boperator\b/.test(prefix)
    ) {
      return null;
    }
    if (!/\b(model|block|class)\b/.test(prefix) && prefix !== "") return null;

    const classChain: SymbolEntry[] = [];
    const visitedCls = new Set<SymbolId>();
    const collectHierarchy = (clsSym: SymbolEntry): boolean => {
      if (visitedCls.has(clsSym.id)) return true;
      visitedCls.add(clsSym.id);
      classChain.push(clsSym);
      for (const ch of db.childrenOf(clsSym.id)) {
        if (ch.kind === "Extends") {
          const baseName = String(getSymbolMeta(ch)?.["typeSpecifier"] ?? ch.name ?? "").trim();
          if (!baseName) return false;
          const resolver = db.query<(n: string) => SymbolEntry | null>("resolveName", clsSym.parentId ?? clsSym.id);
          const resolved = baseName.includes(".") ? resolveQualified(db, baseName) : resolver?.(baseName);
          if (!resolved) return false;
          if (!collectHierarchy(resolved)) return false;
        }
      }
      return true;
    };
    if (!collectHierarchy(self)) return null;

    let localEqs = 0;
    const bailTypes = new Set([
      "algorithm_section",
      "for_equation",
      "if_equation",
      "when_equation",
      "connect_equation",
    ]);
    for (const clsSym of classChain) {
      const cst = db.cstNode(clsSym.id) as SyntaxNode | null;
      if (!cst) return null;
      let unsafeStructure = false;
      let sawSimpleEq = false;
      const eqSizeByLhsText = new Map<string, number>();

      const inspectTree = (n: SyntaxNode) => {
        if (!n || unsafeStructure) return;
        if (n !== cst && n.type === "class_definition") return;
        if (bailTypes.has(n.type) || n.type === "external_function_call") {
          unsafeStructure = true;
          return;
        }
        if (
          n.type === "equation_section" &&
          String(n.text ?? "")
            .trimStart()
            .startsWith("initial")
        ) {
          return;
        }
        if (n.type === "simple_equation") {
          sawSimpleEq = true;
          const children = n.children ?? [];
          const eqIdx = children.findIndex((c: SyntaxNode) => c.type === "=");
          const lhs = eqIdx > 0 ? children[0] : null;
          const lhsTxt = String(lhs?.text ?? "").trim();
          if (lhsTxt.startsWith("(") || lhsTxt.startsWith("{") || lhsTxt.startsWith("[")) {
            unsafeStructure = true;
            return;
          }
          eqSizeByLhsText.set(lhsTxt, (eqSizeByLhsText.get(lhsTxt) ?? 0) + 1);
          localEqs += 1;
          return;
        }
        if (n.type === "some_equation" || n.type === "equation_or_procedure") {
          const t = String(n.text ?? "").trim();
          if (
            t &&
            !t.startsWith("assert(") &&
            !t.startsWith("terminate(") &&
            !n.children?.some((c: SyntaxNode) => c.type === "simple_equation")
          ) {
            const hasSimple = (node: QueryCstNode | null | undefined): boolean =>
              Boolean(node && (node.type === "simple_equation" || (node.children ?? []).some(hasSimple)));
            if (!hasSimple(n)) {
              unsafeStructure = true;
              return;
            }
          }
        }
        for (const ch of n.children ?? []) inspectTree(ch);
      };
      inspectTree(cst);
      if (unsafeStructure) return null;
      void sawSimpleEq;
    }

    if (localEqs === 0) return null;

    const elementIds = db.query<SymbolId[]>("instantiate", self.id) ?? [];
    let localVars = 0;
    let arrayUnknowns = false;
    for (const eid of elementIds) {
      const el = typeof eid === "number" ? db.symbol(eid) : (eid as unknown as SymbolEntry);
      if (!el || el.kind !== "Component") continue;
      const elCst = db.cstNode(el.id) as QueryCstNode | null;
      const elTxt = String(elCst?.text ?? "");
      if (/\bif\b/.test(elTxt) && /\bif\s+[^;]/.test(elTxt)) return null;
      const elMeta = getSymbolMeta(el);
      const varb = String(db.query<string>("variability", el.id) ?? elMeta?.["variability"] ?? "").toLowerCase();
      const caus = String(db.query<string>("causality", el.id) ?? elMeta?.["causality"] ?? "").toLowerCase();
      if (varb === "parameter" || varb === "constant") continue;
      if (caus === "input") continue;

      if (elTxt.includes("[") || String(elCst?.parent?.text ?? "").includes("[")) {
        arrayUnknowns = true;
        break;
      }

      const tSpec = String(elMeta?.["typeSpecifier"] ?? "").trim();
      if (tSpec === "Real" || tSpec === "Integer" || tSpec === "Boolean" || tSpec === "String") {
        localVars += 1;
        continue;
      }

      const resolvedType = db.query<SymbolEntry | null>("classInstance", el.id);
      if (!resolvedType) return null;
      const tPrefix = String(getSymbolMeta(resolvedType)?.["classPrefixes"] ?? "").toLowerCase();
      if (/\bconnector\b/.test(tPrefix)) {
        const connEids = db.query<SymbolId[]>("instantiate", resolvedType.id) ?? [];
        for (const ceid of connEids) {
          const ce = typeof ceid === "number" ? db.symbol(ceid) : (ceid as unknown as SymbolEntry);
          if (!ce || ce.kind !== "Component") continue;
          const ceCst = db.cstNode(ce.id) as QueryCstNode | null;
          const ceParentTxt = String(ceCst?.parent?.text ?? ceCst?.text ?? "");
          if (/\bflow\b/.test(ceParentTxt)) localVars += 1;
        }
        continue;
      }
      if (/\btype\b/.test(tPrefix)) {
        localVars += 1;
        continue;
      }
      return null;
    }

    if (arrayUnknowns || localVars === 0) return null;
    if (localVars !== localEqs) {
      const classKind = /\bblock\b/.test(prefix) ? "block" : "model";
      return warning(
        ModelicaErrorCode.LOCALLY_UNBALANCED_CLASS.message(classKind, self.name, String(localEqs), String(localVars)),
        {
          startOffset: self.startOffset,
          endOffset: Math.max(self.startOffset + 1, self.endOffset),
          code: ModelicaErrorCode.LOCALLY_UNBALANCED_CLASS.code,
        },
      );
    }
    return null;
  },
};
