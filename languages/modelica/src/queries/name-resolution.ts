// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Salsa Query Name & Scope Resolution (MLS §5.3 & §13.2).
 */

import {
  isMemberLikeSymbol,
  isNamespaceLikeSymbol,
  isRelationshipOrImportSymbol,
  isTypeLikeSymbol,
  splitQualifiedPath,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import type { CstNodeLike } from "../flattener/expressions/cst-utils.js";
import type { ModelicaModArgs } from "../modifications.js";
import { collapseSpaceTokens } from "../workspace-hooks.js";
import {
  getShortClassSpecifierNode,
  getSymbolQualifiedName,
  hasLeadingEncapsulatedPrefix,
  parseEnumLiteralsFromText,
  stripModelicaComments,
  stripOuterChar,
  stripTrailingBrackets,
} from "./cst-helpers.js";
import {
  asSyntaxNode,
  getSymbolMeta,
  type CachedQueryDB,
  type CachedSymbolEntry,
  type QueryCstNode,
  type QueryDBWithCstText,
  type ScopeData,
} from "./types.js";

/**
 * Builds the `ScopeData` lookup table for a class or package symbol by scanning its direct
 * `Class`, `Component`, `EnumerationLiteral`, and `Import` children.
 *
 * @param db - Active Salsa query database.
 * @param self - Class or package symbol entry.
 * @returns Populated `ScopeData` structure for fast name resolution.
 */
export function getScopeData(db: QueryDB, self: SymbolEntry): ScopeData {
  const baseId = db.baseOf(self.id);
  const sourceId = baseId ?? self.id;
  const children = db.childrenOf(sourceId);

  const directByName: Record<string, SymbolId> = {};
  const qualifiedImports: Record<string, string> = {};
  const unqualifiedImportPkgs: string[] = [];
  const compoundImports: Array<{ pkg: string; names: string[] }> = [];

  for (const child of children) {
    if (
      child.kind === "Class" ||
      child.kind === "Component" ||
      child.kind === "EnumerationLiteral" ||
      (child.language && child.language !== "modelica" && (isTypeLikeSymbol(child) || isMemberLikeSymbol(child)))
    ) {
      directByName[child.name] = child.id;
    } else if (child.kind === "Extends") {
      for (const extChild of db.childrenOf(child.id)) {
        if (extChild.kind === "Class" || isTypeLikeSymbol(extChild)) {
          directByName[extChild.name] = extChild.id;
        }
      }
    }

    if (child.kind === "Import") {
      const meta = getSymbolMeta(child);
      let importKind =
        (meta?.["importKind"] as string | undefined) ??
        (child.ruleName === "UnqualifiedImportClause"
          ? "unqualified"
          : child.ruleName === "CompoundImportClause"
            ? "compound"
            : undefined);
      let pkgName = (meta?.["packageName"] ?? child.name) as string;
      let aliasName = meta?.["shortName"] as string | undefined;

      // For WASM GLR parser import_clause nodes, inspect the CST to determine the import kind
      if (importKind === undefined && (child.ruleName === "import_clause" || child.ruleName === "ImportClause")) {
        const importCst = db.cstNode(child.id) as SyntaxNode | null;
        if (importCst) {
          const aliasNode = Cst.ImportClause.alias(importCst);
          const importListNode = Cst.ImportClause.importList(importCst);
          const cstText: string = importCst.text ?? "";

          if (aliasNode) {
            // Renamed import: import MyC = A.B2.C;
            aliasName = aliasNode.text;
            importKind = "simple";
          } else if (importListNode) {
            // Compound import: import A.B.{C, D};
            importKind = "compound";
          } else if (
            (importCst.children || []).some(
              (c: CstNodeLike) => c.type === "*" || c.type === '"*"' || c.text?.trim() === "*",
            ) ||
            cstText.trimEnd().endsWith("*")
          ) {
            // Unqualified import: import A.B.*;
            importKind = "unqualified";
          } else {
            // Simple import: import A.B.C;
            importKind = "simple";
          }
        } else {
          importKind = "simple";
        }
      }
      if (!importKind) importKind = "simple";

      if (db.ensureFQNIndexed && pkgName) {
        db.ensureFQNIndexed(pkgName);
      }

      if (importKind === "simple") {
        const shortName = aliasName ?? splitQualifiedPath(pkgName).pop() ?? pkgName;
        if (shortName in qualifiedImports) {
          qualifiedImports[shortName] = "__CONFLICT__";
        } else {
          qualifiedImports[shortName] = pkgName;
        }
      } else if (importKind === "unqualified") {
        unqualifiedImportPkgs.push(pkgName);
      } else if (importKind === "compound") {
        const importNames = db
          .childrenOfField(child.id, "importName")
          .map((c) => c.name)
          .filter(Boolean);
        // Also try extracting import names from CST if childrenOfField returned nothing
        if (importNames.length === 0) {
          const importCst = db.cstNode(child.id) as SyntaxNode | null;
          if (importCst) {
            const importListNode = Cst.ImportClause.importList(importCst);
            if (importListNode) {
              const listText: string = importListNode.text ?? "";
              const names = listText
                .split(",")
                .map((n: string) => n.trim())
                .filter(Boolean);
              if (names.length > 0) {
                // Strip trailing ".{...}" from pkgName if present
                if (pkgName.endsWith("}")) {
                  const braceIdx = pkgName.lastIndexOf(".{");
                  if (braceIdx >= 0) pkgName = pkgName.slice(0, braceIdx);
                }
                compoundImports.push({ pkg: pkgName, names });
                continue;
              }
            }
          }
        }
        compoundImports.push({ pkg: pkgName, names: importNames });
      }
    }
  }

  const isEncapsulated = isSymbolEncapsulated(db, self);

  return {
    directByName,
    qualifiedImports,
    unqualifiedImportPkgs,
    compoundImports,
    isEncapsulated,
    parentId: self.parentId,
    id: self.id,
  };
}

/**
 * Checks whether a single symbol declaration carries the `encapsulated` prefix (`MLS §5.3.1`).
 *
 * @param db - Active Salsa query database.
 * @param sym - Symbol entry to inspect.
 * @returns `true` if `sym` is declared `encapsulated`.
 */
export function isSymbolEncapsulated(db: QueryDB, sym: SymbolEntry): boolean {
  const cachedSym = sym as CachedSymbolEntry;
  if (cachedSym._isEncapsulated !== undefined) return cachedSym._isEncapsulated;
  const meta = getSymbolMeta(sym);
  if (meta?.["encapsulated"]) {
    cachedSym._isEncapsulated = true;
    return true;
  }
  const rawKind = String(meta?.["classKind"] ?? meta?.["classPrefixes"] ?? "");
  if (collapseSpaceTokens(stripModelicaComments(rawKind)).includes("encapsulated")) {
    cachedSym._isEncapsulated = true;
    return true;
  }
  const cst = db.cstNode(sym.id) as (CstNodeLike & { text?: string }) | null;
  if (cst && cst.children) {
    for (const ch of cst.children) {
      if (ch.type === "encapsulated" || ch.type === '"encapsulated"' || ch.text === "encapsulated") {
        cachedSym._isEncapsulated = true;
        return true;
      }
      if (ch.type === "class_prefixes" && ch.children) {
        for (const pch of ch.children) {
          if (pch.type === "encapsulated" || pch.type === '"encapsulated"' || pch.text === "encapsulated") {
            cachedSym._isEncapsulated = true;
            return true;
          }
        }
      }
      if (ch.type === "class_specifier") break;
    }
  }
  const queryDbWithCst = db as QueryDBWithCstText;
  if (sym.startOffset != null && sym.endOffset != null && typeof queryDbWithCst.cstText === "function") {
    const header = queryDbWithCst.cstText(sym.startOffset, Math.min(sym.endOffset, sym.startOffset + 120), sym);
    if (typeof header === "string" && header.length > 0) {
      const res = hasLeadingEncapsulatedPrefix(header);
      cachedSym._isEncapsulated = res;
      return res;
    }
  }
  const text = cst ? (cst.text ?? "").slice(0, 120) : "";
  const res = hasLeadingEncapsulatedPrefix(text);
  cachedSym._isEncapsulated = res;
  return res;
}

/**
 * Checks whether `symbolId` or any of its enclosing lexical ancestors is declared `encapsulated`.
 *
 * @param db - Active Salsa query database.
 * @param symbolId - Starting scope symbol ID.
 * @returns `true` if the scope chain contains an `encapsulated` boundary.
 */
export function isScopeEncapsulated(db: QueryDB, symbolId: SymbolId | null | undefined): boolean {
  if (symbolId === null || symbolId === undefined) return false;
  const rootSym = db.symbol(symbolId) as CachedSymbolEntry | undefined;
  if (!rootSym) return false;
  if (rootSym._isScopeEncapsulated !== undefined) return rootSym._isScopeEncapsulated;
  const seen = new Set<SymbolId>();
  let curr: SymbolEntry | null | undefined = rootSym;
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    if (isSymbolEncapsulated(db, curr)) {
      rootSym._isScopeEncapsulated = true;
      return true;
    }
    curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
  }
  rootSym._isScopeEncapsulated = false;
  return false;
}

/**
 * Copies entries from `source` into `target` without overwriting existing keys in `target`.
 *
 * @param target - Destination symbol map.
 * @param source - Inherited symbol map to merge in.
 */
export function mergeInto(target: Record<string, SymbolId>, source: Record<string, SymbolId>): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

/**
 * Resolves a simple (unqualified) identifier within `classId`'s scope according to Modelica §5.3:
 * 1. Direct elements (and enumeration literals)
 * 2. Inherited elements via `extends` or short-class base types
 * 3. Qualified/renamed imports (`import A = B.C` or `import B.C`)
 * 4. Compound imports (`import B.{C, D}`)
 * 5. Unqualified imports (`import B.*`, rejecting ambiguous multi-package matches)
 * 6. Enclosing lexical parent scopes (unless blocked by `encapsulated`)
 * 7. Global predefined/top-level package fallback
 *
 * @param db - Active Salsa query database.
 * @param classId - Scope class symbol ID.
 * @param name - Unqualified identifier to resolve.
 * @param encapsulated - Whether lookup is restricted by an `encapsulated` boundary.
 * @param skipInherited - Whether to skip `extends` inheritance lookup.
 * @param visited - Cycle-detection set of visited class IDs.
 * @param memberOnly - When `true`, restricts lookup to direct/inherited members of `classId` (no parent scope walk).
 * @returns Resolved `SymbolEntry`, or `null` if not found.
 */
export function resolveSimpleNameHelper(
  db: QueryDB,
  classId: SymbolId,
  name: string,
  encapsulated = false,
  skipInherited = false,
  visited: Set<SymbolId> = new Set(),
  memberOnly = false,
): SymbolEntry | null {
  if (visited.has(classId)) return null;
  visited.add(classId);

  const unspecializedId = db.baseOf(classId) ?? classId;
  let scope = db.query<ScopeData | null>("scopeData", unspecializedId);
  if (!scope) return null;

  // 1. Direct elements
  let directId: SymbolId | undefined = scope.directByName[name];
  if (directId === undefined && db.ensureFQNIndexed) {
    const classEntry = db.symbol(unspecializedId);
    if (classEntry) {
      const fqn = getSymbolQualifiedName(db, classEntry.id);
      if (fqn) {
        db.ensureFQNIndexed(fqn + "." + name);
        const refreshed = db.query<ScopeData | null>("scopeData", unspecializedId);
        if (refreshed) scope = refreshed;
        directId = scope.directByName[name];
      }
    }
  }
  if (directId !== undefined) return db.symbol(directId) ?? null;

  const unspecializedSym = db.symbol(unspecializedId);
  if (unspecializedSym) {
    const unspecMeta = getSymbolMeta(unspecializedSym);
    const uKind = String(unspecMeta?.["classKind"] ?? unspecMeta?.["classPrefixes"] ?? "");
    if (!uKind || uKind.includes("type") || uKind.includes("enumeration") || uKind === "class") {
      let cstText: string | undefined;
      const queryDbWithCst = db as QueryDBWithCstText;
      if (
        unspecializedSym.startOffset != null &&
        unspecializedSym.endOffset != null &&
        typeof queryDbWithCst.cstText === "function"
      ) {
        if (unspecializedSym.endOffset - unspecializedSym.startOffset < 8192) {
          cstText =
            queryDbWithCst.cstText(unspecializedSym.startOffset, unspecializedSym.endOffset, unspecializedSym) ??
            undefined;
        }
      } else {
        cstText = (db.cstNode(unspecializedId) as { text?: string } | null)?.text;
      }
      const cstNode = db.cstNode(unspecializedId) as CstNodeLike | null;
      const shortSpec = getShortClassSpecifierNode(cstNode);
      const enumListNode =
        shortSpec?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList") ??
        cstNode?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList");
      if (enumListNode && enumListNode.children) {
        for (const c of enumListNode.children) {
          if (c.type === "enumeration_literal" || c.type === "EnumerationLiteral") {
            const idNode = c.children?.find((ch) => ch.type === "identifier" || ch.type === "Identifier") ?? c;
            const litName = idNode?.text ? stripOuterChar(idNode.text.trim(), "'") : undefined;
            if (litName === name) {
              return {
                ...unspecializedSym,
                id: -1 as SymbolId,
                parentId: unspecializedId,
                kind: "EnumerationLiteral" as SymbolEntry["kind"],
                name,
              };
            }
          }
        }
      }

      if (typeof cstText === "string" && cstText.includes("enumeration")) {
        const hasLit = parseEnumLiteralsFromText(cstText, 0, true).some((l) => l.name === name);
        if (hasLit) {
          return {
            ...unspecializedSym,
            id: -1 as SymbolId,
            parentId: unspecializedId,
            kind: "EnumerationLiteral" as SymbolEntry["kind"],
            name,
          };
        }
      }
    }
  }

  // 2. Inherited elements
  if (!skipInherited) {
    const inheritedMap = db.query<Record<string, SymbolId> | null>("inheritedSymbolsMap", unspecializedId);
    const inheritedId = inheritedMap?.[name];
    if (inheritedId !== undefined) return db.symbol(inheritedId) ?? null;
  }

  // 2.5. Short class target
  if (!skipInherited) {
    const self = db.symbol(classId);
    const meta = getSymbolMeta(self);
    if (self && !meta?.["isPredefined"]) {
      let mayBeShortClass = true;
      const queryDbWithCst = db as QueryDBWithCstText;
      if (self.startOffset != null && self.endOffset != null && typeof queryDbWithCst.cstText === "function") {
        const hdr = queryDbWithCst.cstText(self.startOffset, Math.min(self.endOffset, self.startOffset + 256), self);
        if (typeof hdr === "string" && hdr.length > 0) {
          mayBeShortClass = hdr.includes("=");
        }
      }
      const cst = mayBeShortClass ? (db.cstNode(classId) as QueryCstNode | null) : null;
      const classSpecifier = cst ? getShortClassSpecifierNode(cst) : null;
      if (classSpecifier) {
        const effMod = db.query<ModelicaModArgs | null>("effectiveModification", classId);
        const redeclClassArg = effMod?.args?.find(
          (a) => a.name === name && a.isRedeclaration && a.redeclaredKind === "class" && a.redeclaredTypeSpecifier,
        );
        if (redeclClassArg && redeclClassArg.redeclaredTypeSpecifier) {
          const evalScopeId = redeclClassArg.evaluationScopeId ?? self.parentId;
          const redeclTargetName: string = redeclClassArg.redeclaredTypeSpecifier;
          let redeclTarget: SymbolEntry | null = null;
          if (evalScopeId !== null && evalScopeId !== undefined && !visited.has(evalScopeId)) {
            redeclTarget =
              db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(redeclTargetName) ?? null;
          }
          if (!redeclTarget) {
            redeclTarget =
              resolveQualified(db, redeclTargetName) ??
              db
                .byName(redeclTargetName)
                ?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
              null;
          }
          if (redeclTarget && redeclTarget.id !== classId) {
            return redeclTarget;
          }
        }
        const typeSpec =
          Cst.ShortClassSpecifier.typeSpecifier(classSpecifier) ??
          classSpecifier.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
        const typeName = typeSpec?.text?.trim();
        if (typeName) {
          let resolved: { id: SymbolId } | null = null;
          if (self.parentId !== null) {
            const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
            if (parentResolver) {
              resolved = parentResolver(typeName);
            }
          }
          if (!resolved) {
            resolved = db.byName(typeName)?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
          }
          if (resolved?.id && resolved.id !== classId && !visited.has(resolved.id)) {
            const found = resolveSimpleNameHelper(
              db,
              resolved.id,
              name,
              encapsulated,
              skipInherited,
              visited,
              memberOnly,
            );
            if (found) return found;
          }
        }
      }
    }
  }

  if (memberOnly) {
    const qualPkg = scope.qualifiedImports[name];
    if (qualPkg && qualPkg !== "__CONFLICT__") {
      const target = resolveQualified(db, qualPkg, true);
      if (target?.kind === "Component") return target;
    }
    return null;
  }

  // 3. Qualified imports
  const qualPkg = scope.qualifiedImports[name];
  if (qualPkg) {
    if (qualPkg === "__CONFLICT__") return null;
    return resolveQualified(db, qualPkg, true);
  }

  // Helper to resolve an import path, respecting local aliases for the first segment
  const resolveImportPath = (pathStr: string): SymbolEntry | null => {
    const parts = splitQualifiedPath(pathStr);
    const first = parts[0];
    const aliasTarget = first ? scope.qualifiedImports[first] : undefined;
    if (aliasTarget && aliasTarget !== "__CONFLICT__") {
      const fullPath = [aliasTarget, ...parts.slice(1)].join(".");
      return resolveQualified(db, fullPath, true);
    } else {
      return resolveQualified(db, parts.join("."), true);
    }
  };

  // 4. Compound imports
  for (const ci of scope.compoundImports) {
    if (ci.names.includes(name)) {
      const pkgEntry = resolveImportPath(ci.pkg);
      if (pkgEntry) {
        const foundEntry = db.childrenOf(pkgEntry.id).find((c) => c.name === name && !isRelationshipOrImportSymbol(c));
        if (foundEntry) return foundEntry;
      }
    }
  }

  // 5. Unqualified imports
  let unqualMatch: SymbolEntry | null = null;
  let unqualMatchCount = 0;
  for (const pkg of scope.unqualifiedImportPkgs) {
    const pkgEntry = resolveImportPath(pkg);
    if (pkgEntry) {
      for (const pkgChild of db.childrenOf(pkgEntry.id)) {
        if (pkgChild.name === name && !isRelationshipOrImportSymbol(pkgChild)) {
          unqualMatch = pkgChild;
          unqualMatchCount++;
          break;
        }
      }
    }
  }
  if (unqualMatchCount === 1 && unqualMatch) return unqualMatch;
  if (unqualMatchCount > 1) return null;

  // 6. Parent scope walk (unless encapsulated)
  if (
    !encapsulated &&
    !scope.isEncapsulated &&
    scope.parentId !== null &&
    scope.parentId !== unspecializedId &&
    !visited.has(scope.parentId)
  ) {
    const parentEntry = db.symbol(scope.parentId);
    if (
      parentEntry &&
      (parentEntry.kind === "Class" ||
        parentEntry.kind === "Package" ||
        isNamespaceLikeSymbol(parentEntry) ||
        isTypeLikeSymbol(parentEntry))
    ) {
      const found =
        visited.size <= 1 && !skipInherited
          ? (db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", parentEntry.id)?.(name) ?? null)
          : resolveSimpleNameHelper(db, parentEntry.id, name, false, skipInherited, visited, false);
      if (found) return found;
    }
  }

  // 7. Predefined types fallback
  if (db.ensureFQNIndexed) {
    db.ensureFQNIndexed(name);
  }
  const predefined = db.byName(name);
  if (encapsulated || scope.isEncapsulated) {
    return predefined?.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"])) ?? null;
  }
  return (
    predefined?.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"])) ??
    predefined?.find((e) => isTypeLikeSymbol(e) && e.parentId === null && (!e.language || e.language === "modelica")) ??
    predefined?.find((e) => {
      if (!isTypeLikeSymbol(e) && e.kind !== "Module") return false;
      if (e.parentId === null) return true;
      if (!e.language || e.language === "modelica") return false;
      const p = db.symbol(e.parentId);
      return Boolean(
        p &&
        p.parentId === null &&
        (p.ruleName === "scad_file" ||
          p.ruleName === "step_product" ||
          p.ruleName === "pscad_library" ||
          p.ruleName === "pscad_project"),
      );
    }) ??
    null
  );
}

/**
 * Resolves a dot- or double-colon-separated path from the global scope.
 * Used for resolving import targets and cross-language global fallbacks.
 */
export function resolveQualified(db: QueryDB, path: string, topOnly = false): SymbolEntry | null {
  if (path.startsWith(".")) {
    path = path.slice(1);
  }
  const cacheKey = topOnly ? `${path}|top` : path;
  const cachedDb = db as CachedQueryDB;
  let qualCache = cachedDb._resolveQualifiedCache;
  if (!qualCache) {
    qualCache = new Map<string, SymbolEntry>();
    cachedDb._resolveQualifiedCache = qualCache;
  }
  const cached = qualCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (db.ensureFQNIndexed) {
    db.ensureFQNIndexed(path);
  }
  const parts = splitQualifiedPath(path);
  if (parts.length === 0 || !parts[0]) return null;

  // Try to find the root part (entry with no parent)
  const rootEntries = db.byName(parts[0]!);
  const candidates = topOnly
    ? rootEntries.filter((e) => Boolean(getSymbolMeta(e)?.["isPredefined"]) || e.parentId === null)
    : [
        ...rootEntries.filter((e) => Boolean(getSymbolMeta(e)?.["isPredefined"]) || e.parentId === null),
        ...rootEntries.filter((e) => !getSymbolMeta(e)?.["isPredefined"] && e.parentId !== null),
      ];

  for (const rootCandidate of candidates) {
    let current: SymbolEntry | null = rootCandidate;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      const children = db.childrenOf(current.id);
      // Prefer non-relationship entries (Class, Component, Definition, Usage) over Reference/Import entries
      current =
        children.find((c) => c.name === part && !isRelationshipOrImportSymbol(c)) ||
        children.find((c) => c.name === part) ||
        null;
      if (!current) break;
    }
    if (current) {
      qualCache.set(cacheKey, current);
      return current;
    }
  }

  return null;
}

/**
 * Pinpoints the exact identifier segment in a qualified type specifier (`A.B.C`) where lookup failed,
 * returning its byte and character offsets for accurate `M2003` (`CLASS_NOT_FOUND`) diagnostic highlighting.
 *
 * @param db - Active Salsa query database.
 * @param scopeId - Enclosing lexical scope ID.
 * @param typeName - Raw type specifier text.
 * @param node - CST node of the type specifier or clause.
 * @param fallbackStart - Fallback start byte offset.
 * @param fallbackEnd - Fallback end byte offset.
 * @returns Byte and character range of the first unresolved identifier segment.
 */
export function getQualifiedTypeFailRange(
  db: QueryDB,
  scopeId: SymbolId | null,
  typeName: string,
  node: QueryCstNode | null | undefined,
  fallbackStart: number,
  fallbackEnd: number,
): { startOffset: number; endOffset: number } {
  let targetNode: QueryCstNode | null | undefined = node;
  if (targetNode && (targetNode.type === "extends_clause" || targetNode.type === "ExtendsClause")) {
    const typeSpecChild =
      Cst.ExtendsClause.typeSpecifier(asSyntaxNode(targetNode)) ??
      targetNode.children?.find(
        (c) => c.type === "type_specifier" || c.type === "TypeSpecifier" || c.type === "name" || c.type === "Name",
      );
    if (typeSpecChild) targetNode = typeSpecChild;
  }

  let startOffset = targetNode?.startOffset ?? targetNode?.startIndex ?? fallbackStart;
  let endOffset = targetNode?.endOffset ?? targetNode?.endIndex ?? fallbackEnd;

  const cleanType = stripTrailingBrackets(typeName);
  const hasLeadingDot = cleanType.startsWith(".");
  const stripped = hasLeadingDot ? cleanType.slice(1) : cleanType;
  const parts = stripped.split(".");

  const idents: QueryCstNode[] = [];
  const collectIdents = (n: QueryCstNode | null | undefined) => {
    if (!n) return;
    if (
      n.type === "array_subscripts" ||
      n.type === "ArraySubscripts" ||
      n.type === "class_modification" ||
      n.type === "ClassModification" ||
      n.type === "class_or_inheritance_modification" ||
      n.type === "ClassOrInheritanceModification" ||
      n.type === "annotation" ||
      n.type === "Annotation"
    ) {
      return;
    }
    if (n.type === "identifier" || n.type === "Identifier") {
      idents.push(n);
      return;
    }
    if (n.children) {
      for (const c of n.children) collectIdents(c);
    }
  };
  collectIdents(targetNode);

  if (parts.length <= 1) {
    if (idents.length === 1) {
      const idNode = idents[0]!;
      startOffset = idNode.startOffset ?? idNode.startIndex ?? startOffset;
      endOffset = idNode.endOffset ?? idNode.endIndex ?? endOffset;
    }
    return { startOffset, endOffset };
  }

  let failIdx = 0;
  let current: SymbolEntry | null = null;
  if (!hasLeadingDot && scopeId !== null) {
    const resolver =
      db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", scopeId) ??
      db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId);
    if (resolver) current = resolver(parts[0]!);
  }
  if (!current && (hasLeadingDot || scopeId === null || !isScopeEncapsulated(db, scopeId))) {
    const rootEntries = db.byName(parts[0]!);
    current =
      rootEntries.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"])) ??
      rootEntries.find((e) => e.parentId === null) ??
      rootEntries.find((e) => ["Class", "Package", "Function", "Definition", "Enumeration"].includes(e.kind)) ??
      rootEntries[0] ??
      null;
  }

  if (current) {
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      let next: SymbolEntry | null = null;
      const simpleRes: ((n: string) => SymbolEntry | null) | null = db.query<
        ((n: string) => SymbolEntry | null) | null
      >("resolveSimpleName", current.id);
      if (simpleRes) next = simpleRes(part);
      if (!next) {
        const children = db.childrenOf(current.id);
        next =
          children.find((c) => c.name === part && c.kind !== "Reference") ||
          children.find((c) => c.name === part) ||
          null;
      }
      if (!next) {
        failIdx = i;
        break;
      }
      current = next;
    }
  }

  if (failIdx < idents.length) {
    const idNode = idents[failIdx]!;
    const so = idNode.startOffset ?? idNode.startIndex ?? startOffset;
    const eo = idNode.endOffset ?? idNode.endIndex ?? endOffset;
    return { startOffset: so, endOffset: eo };
  }

  const nodeText: string = targetNode?.text ?? cleanType;
  let searchPos = 0;
  for (let i = 0; i <= failIdx; i++) {
    const seg = parts[i]!;
    const idx = nodeText.indexOf(seg, searchPos);
    if (idx === -1) break;
    if (i === failIdx) {
      return {
        startOffset: startOffset + idx,
        endOffset: startOffset + idx + seg.length,
      };
    }
    searchPos = idx + seg.length + 1;
  }

  return { startOffset, endOffset };
}
