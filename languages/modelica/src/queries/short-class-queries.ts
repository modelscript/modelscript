// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Short Class Specifier Salsa Queries (`short_class_specifier` / `ShortClassSpecifier`).
 */

import { splitQualifiedPath, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import type { ModelicaModArgs } from "../modifications.js";
import { getShortClassSpecifierNode } from "./cst-helpers.js";
import { parseModArgsFromCst } from "./modifications.js";
import { resolveQualified } from "./name-resolution.js";
import type { ModelicaQueryHooks, ResolveNameFn, ResolveSimpleNameFn, ScopeData } from "./types.js";

/**
 * Salsa semantic queries attached to `short_class_specifier` (`type T = Base(...)`) symbols.
 * Delegates instantiation, element enumeration, and scope lookup to the aliased `resolvedBaseClass`.
 */
export const shortClassSpecifierQueries: ModelicaQueryHooks = {
  /** Parses the `class_modification` on this short class specifier into a `ModelicaModArgs` structure. */
  effectiveModification: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const cst = db.cstNode(self.id) as SyntaxNode | null;
      if (!cst) return null;
      const classSpec = getShortClassSpecifierNode(cst);
      if (!classSpec) return null;
      const modNode =
        Cst.ShortClassSpecifier.classModification(classSpec) ??
        classSpec.children?.find((c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification");
      if (!modNode) return null;
      return parseModArgsFromCst(modNode, self.parentId);
    },
    recovery: () => null,
  },

  /** Resolves the target class referenced by the `type_specifier` of this short class definition. */
  resolvedBaseClass: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const selfCstShort = db.cstNode(self.id) as SyntaxNode | null;
      const specShort = getShortClassSpecifierNode(selfCstShort);
      if (specShort) {
        const typeSpec =
          Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
          specShort.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
        const typeName = typeSpec?.text?.trim();
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: number } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved && resolved.id !== self.id) {
              return resolved;
            }
          }
        }
      }
      return null;
    },
    recovery: () => null,
  },

  /** Instantiates the aliased base class and returns its flattened element `SymbolId`s. */
  instantiate: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
      if (base && base.id !== self.id) {
        return db.query<SymbolId[]>("instantiate", base.id) || [];
      }
      return [];
    },
    recovery: () => [],
  },

  /** Forwards simple name resolution to the aliased base class, respecting class redeclarations. */
  resolveSimpleName: (db: QueryDB, self: SymbolEntry): ResolveSimpleNameFn => {
    const cache = new Map<string, SymbolEntry | null>();
    let lastRev = db.getRevision?.() ?? 0;
    return (name: string, encapsulated?: boolean, skipInherited?: boolean, memberOnly?: boolean) => {
      const curRev = db.getRevision?.() ?? 0;
      if (curRev !== lastRev) {
        cache.clear();
        lastRev = curRev;
      }
      const key =
        !encapsulated && !skipInherited && !memberOnly
          ? name
          : `${name}|${encapsulated ? 1 : 0}${skipInherited ? 1 : 0}${memberOnly ? 1 : 0}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const compute = (): SymbolEntry | null => {
        const effMod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
        const redeclClassArg = effMod?.args?.find(
          (a) => a.name === name && a.isRedeclaration && a.redeclaredKind === "class" && a.redeclaredTypeSpecifier,
        );
        if (redeclClassArg && redeclClassArg.redeclaredTypeSpecifier) {
          const evalScopeId = redeclClassArg.evaluationScopeId ?? self.parentId;
          const redeclTargetName: string = redeclClassArg.redeclaredTypeSpecifier;
          let redeclTarget: SymbolEntry | null = null;
          if (evalScopeId !== null && evalScopeId !== undefined && evalScopeId !== self.id) {
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
          if (redeclTarget && redeclTarget.id !== self.id) {
            return redeclTarget;
          }
        }
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
        if (base && base.id !== self.id) {
          const baseResolver = db.query<ResolveSimpleNameFn | null>("resolveSimpleName", base.id);
          if (baseResolver) return baseResolver(name, encapsulated, skipInherited, memberOnly);
        }
        return null;
      };
      const res = compute();
      if (res !== null) {
        cache.set(key, res);
      }
      return res;
    };
  },

  /** Resolves a simple or qualified name via the aliased base class, falling back to the parent scope. */
  resolveName: (db: QueryDB, self: SymbolEntry) => {
    const cache = new Map<string, SymbolEntry | null>();
    let lastRev = db.getRevision?.() ?? 0;
    return (name: string, encapsulated?: boolean) => {
      const curRev = db.getRevision?.() ?? 0;
      if (curRev !== lastRev) {
        cache.clear();
        lastRev = curRev;
      }
      const key = !encapsulated ? name : `${name}|1`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const compute = (): SymbolEntry | null => {
        const parts = splitQualifiedPath(name);
        if (parts.length > 1 && parts[0]) {
          const simpleNameResolver = db.query<ResolveSimpleNameFn | null>("resolveSimpleName", self.id);
          let current: SymbolEntry | null = simpleNameResolver ? simpleNameResolver(parts[0], encapsulated) : null;
          if (current) {
            for (let i = 1; i < parts.length && current; i++) {
              const part = parts[i]!;
              const nextResolver: ResolveSimpleNameFn | null = db.query<ResolveSimpleNameFn | null>(
                "resolveSimpleName",
                current.id,
              );
              const nextPart: SymbolEntry | null = nextResolver ? nextResolver(part, false, false, true) : null;
              if (!nextPart) {
                current = null;
                break;
              }
              current = nextPart;
            }
            if (current) return current;
          }
        } else {
          const simpleNameResolver = db.query<ResolveSimpleNameFn | null>("resolveSimpleName", self.id);
          if (simpleNameResolver) {
            const resolved = simpleNameResolver(name, encapsulated);
            if (resolved) return resolved;
          }
        }
        if (self.parentId !== null) {
          const parentResolver = db.query<ResolveNameFn | null>("resolveName", self.parentId);
          if (parentResolver) return parentResolver(name, encapsulated);
        }
        return null;
      };
      const res = compute();
      if (res !== null) {
        cache.set(key, res);
      }
      return res;
    };
  },

  /** Returns all elements (direct and inherited) of the aliased base class. */
  allElements: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<SymbolEntry[]>("allElements", base.id);
    }
    return [];
  },

  /** Returns the `ScopeData` of the aliased base class. */
  scopeData: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<ScopeData | null>("scopeData", base.id);
    }
    return { directByName: {}, extendsClasses: [], imports: [], hasExtends: false };
  },
};
