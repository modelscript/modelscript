// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Extends Clause Salsa Queries (`extends_clause` / `ExtendsClause`).
 */

import { error } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import type { SyntaxNode } from "../../src-gen/bindings.js";
import type { ModelicaModArgs } from "../modifications.js";
import { getShortClassSpecifierNode } from "./cst-helpers.js";
import { parseModArgsFromCst } from "./modifications.js";
import { getQualifiedTypeFailRange, isScopeEncapsulated, resolveQualified } from "./name-resolution.js";
import { getSymbolMeta, type ModelicaQueryHooks, type QueryCstNode, type ResolveNameFn } from "./types.js";

/**
 * Salsa semantic queries and lint hooks attached to `extends_clause` (`Extends`) symbols.
 * Resolves base class targets, parses inheritance modifications (`break` and element modifiers),
 * and validates base class existence (`M2003`).
 */
export const extendsClauseQueries: ModelicaQueryHooks = {
  /**
   * Raw source text of the `class_or_inheritance_modification` attached to this `extends` clause, or `null`.
   */
  modificationText: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const modNode =
      cst?.type === "class_modification" ||
      cst?.type === "ClassModification" ||
      cst?.type === "classOrInheritanceModification" ||
      cst?.type === "class_or_inheritance_modification"
        ? cst
        : (cst?.children || []).find(
            (c: SyntaxNode) =>
              c.type === "classOrInheritanceModification" ||
              c.type === "class_or_inheritance_modification" ||
              c.type === "ClassOrInheritanceModification" ||
              c.type === "class_modification" ||
              c.type === "ClassModification",
          );
    return modNode?.text ?? null;
  },

  /**
   * Resolve the base class referenced by this extends clause.
   * Returns the SymbolEntry of the resolved class, or null.
   */
  resolvedBaseClass: (db: QueryDB, self: SymbolEntry) => {
    const baseName = self.name;
    if (!baseName) return null;
    if (db.ensureFQNIndexed && baseName.includes(".")) {
      db.ensureFQNIndexed(baseName.startsWith(".") ? baseName.slice(1) : baseName);
    }
    if (self.parentId !== null) {
      const parentSym = db.symbol(self.parentId);
      const isRedeclareExtends = parentSym?.kind === "Class" && parentSym.name === baseName;
      if (isRedeclareExtends) {
        let resolved: SymbolEntry | null = null;
        const grandParentId = parentSym?.parentId;
        if (grandParentId !== null && grandParentId !== undefined) {
          const gpQueue: SymbolId[] = [grandParentId];
          const gpVisited = new Set<SymbolId>();
          while (gpQueue.length > 0 && !resolved) {
            const curGp = gpQueue.shift()!;
            if (gpVisited.has(curGp)) continue;
            gpVisited.add(curGp);
            const candidateBases: SymbolEntry[] = [];
            for (const pChild of db.childrenOf(curGp)) {
              if (pChild.kind === "Extends") {
                const pBase = db.query<SymbolEntry | null>("resolvedBaseClass", pChild.id);
                if (pBase) candidateBases.push(pBase);
              }
            }
            const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", curGp);
            if (directBase && directBase.id !== curGp) {
              candidateBases.push(directBase);
            }
            for (const pBase of candidateBases) {
              if (!gpVisited.has(pBase.id)) {
                const directMatch = db
                  .childrenOf(pBase.id)
                  .find(
                    (c) =>
                      (c.kind === "Class" || c.kind === "Package") && c.name === baseName && c.id !== self.parentId,
                  );
                if (directMatch) {
                  resolved = directMatch;
                  break;
                }
                gpQueue.push(pBase.id);
              }
            }
          }
        }
        return resolved;
      }

      const resolveName = db.query<ResolveNameFn | null>("resolveName", self.parentId);
      if (resolveName) {
        // Pass true for skipInherited to prevent cyclic lookup in extends clauses
        const resolved = resolveName(baseName, true, true);
        if (resolved && resolved.id !== self.parentId && resolved.kind !== "Reference") return resolved;
      }
    }
    if (self.parentId !== null && isScopeEncapsulated(db, self.parentId)) {
      return null;
    }
    if (baseName.includes(".")) {
      const qRes = resolveQualified(db, baseName.startsWith(".") ? baseName.slice(1) : baseName);
      if (qRes && (qRes.kind === "Class" || qRes.kind === "Package")) return qRes;
    }
    const entries = db.byName(baseName);
    return (
      entries?.find((e) => e.kind === "Class" || e.kind === "Package") ??
      (entries?.[0] && entries[0].kind !== "Extends" && entries[0].kind !== "Reference" ? entries[0] : null)
    );
  },

  /**
   * Get the merged modification for this extends clause.
   */
  effectiveModification: (_db: QueryDB, self: SymbolEntry) => {
    return getSymbolMeta(self)?.["classOrInheritanceModification"] ?? null;
  },

  /**
   * Parse the extends clause's class-or-inheritance modification from the CST
   * into a structured ModelicaModArgs object.
   */
  extendsModificationParsed: (db: QueryDB, self: SymbolEntry): ModelicaModArgs | null => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const modNode =
      cst?.type === "class_modification" ||
      cst?.type === "ClassModification" ||
      cst?.type === "classOrInheritanceModification" ||
      cst?.type === "class_or_inheritance_modification"
        ? cst
        : (cst?.children || []).find(
            (c: SyntaxNode) =>
              c.type === "classOrInheritanceModification" ||
              c.type === "class_or_inheritance_modification" ||
              c.type === "ClassOrInheritanceModification" ||
              c.type === "class_modification" ||
              c.type === "ClassModification",
          );
    if (!modNode) return null;
    return parseModArgsFromCst(modNode, self.parentId) as unknown as ModelicaModArgs;
  },

  /**
   * M2003: Emits a diagnostic when the base class referenced by an `extends` clause cannot be resolved in scope.
   */
  lint__baseClassNotFound: (db: QueryDB, self: SymbolEntry) => {
    const baseName = self.name;
    if (!baseName) return null;
    const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (baseClass) return null;

    if (self.parentId !== null) {
      const resolveName = db.query<(n: string) => SymbolEntry | null>("resolveName", self.parentId);
      if (resolveName && resolveName(baseName)) return null;
    }

    if (baseName.includes(".")) {
      if (resolveQualified(db, baseName)) return null;
      if (self.parentId !== null) {
        const parts = baseName.split(".");
        let currentScope: SymbolEntry | null = db.symbol(self.parentId) ?? null;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]!;
          let resolved: SymbolEntry | null = null;
          if (i === 0) {
            const resolver =
              db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentScope?.id ?? self.parentId) ??
              db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? self.parentId);
            resolved = resolver ? resolver(part) : null;
            if (!resolved) {
              resolved = db.byName(part).find((e) => e.kind === "Class" || e.kind === "Component") ?? null;
            }
          } else if (currentScope) {
            resolved = db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
          }
          if (resolved) {
            if (resolved.kind === "Component") return null;
            if (resolved.kind === "Class") {
              const cst = db.cstNode(resolved.id) as QueryCstNode | null;
              if (getShortClassSpecifierNode(cst)) {
                return null;
              }
            }
          }
          currentScope = resolved;
        }
      }
    } else {
      const entries = db.byName(baseName);
      if (entries?.some((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Component")) return null;
    }

    const cstNode = db.cstNode(self.id) as SyntaxNode | null;
    const failRange = getQualifiedTypeFailRange(db, self.parentId, baseName, cstNode, self.startOffset, self.endOffset);

    const msg = `Class or type '${baseName}' not found in scope.`;
    return error(msg, {
      ...failRange,
      code: 2003,
    });
  },
};
