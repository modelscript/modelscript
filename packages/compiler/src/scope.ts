// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { makeWeakRef } from "@modelscript/utils";

/**
 * Minimal subset of the QueryDB interface used for arena-backed name resolution.
 * This avoids a direct import of `@modelscript/compiler` which would create a
 * circular dependency. The full QueryDB is injected at runtime via `setQueryDB()`.
 */
interface ScopeQueryDB {
  byName(name: string): { id: number; name: string; kind: string }[];
  symbol(id: number): { id: number; name: string; kind: string; parentId: number | null } | undefined;
  childrenOf(id: number): { id: number; name: string; kind: string }[];
}

// ── Dependency-injected callbacks ───────────────────────────────────────────
export let _resolveBuiltIn: ((name: string) => any | null) | null = null;
export function setBuiltInResolver(fn: (name: string) => any | null) {
  _resolveBuiltIn = fn;
}

export let _getAnnotationScope: (() => any | null) | null = null;
export function setAnnotationScopeGetter(fn: () => any | null) {
  _getAnnotationScope = fn;
}

export let _getScriptingScope: (() => any | null) | null = null;
export function setScriptingScopeGetter(fn: () => any | null) {
  _getScriptingScope = fn;
}

/**
 * Optional QueryDB for arena-backed name resolution.
 * When set, Scope.resolveSimpleName() can fall back to the query engine
 * for global name lookups (e.g., resolving type names, built-in types).
 *
 * This is injected at startup (e.g., by the LSP or CLI) and shared across
 * all Scope instances. It does NOT replace the scope chain — it augments it.
 */
let _queryDB: ScopeQueryDB | null = null;
export function setQueryDB(db: ScopeQueryDB | null) {
  _queryDB = db;
}
export function getQueryDB(): ScopeQueryDB | null {
  return _queryDB;
}

export abstract class Scope {
  #parent: WeakRef<Scope> | null;

  constructor(parent: Scope | null) {
    this.#parent = makeWeakRef(parent);
  }

  abstract get elements(): IterableIterator<any>;

  abstract get hash(): string;

  get parent(): Scope | null {
    return this.#parent?.deref() ?? null;
  }

  getNamedElement(name: string): any | null {
    for (const element of this.elements) {
      if ("name" in element && (element as { name?: string }).name === name) {
        return element;
      }
    }
    return null;
  }

  query(name: string): any | null {
    return this.resolveName(name.split("."));
  }

  resolveComponentReference(componentReference: any | null | undefined): any | null {
    if (!componentReference) return null;
    const parts = componentReference.parts ?? [];
    if (parts.length === 0) return null;
    let element = this.resolveSimpleName(parts[0]?.identifier, componentReference.global);
    if (element && "instantiated" in element && "classInstance" in element) {
      const comp = element as any;
      if (!comp.instantiated && !comp.instantiating && typeof comp.instantiate === "function") {
        comp.instantiate();
      }
      element = comp.classInstance;
    }
    if (!element) return null;
    for (let i = 1; i < parts.length; i++) {
      const partIdentifier = parts[i]?.identifier;
      const nameStr = typeof partIdentifier === "string" ? partIdentifier : (partIdentifier?.text ?? "");
      if (typeof element.resolveSimpleName !== "function") return null;
      element = element.resolveSimpleName(nameStr, false, true) as any;
      if (element == null) return null;
    }
    return element;
  }

  resolveName(name: any | string[] | null | undefined, global = false): any | null {
    const parts = Array.isArray(name) ? name : (name?.parts ?? []);
    if (!parts || parts.length === 0) return null;
    let namedElement = this.resolveSimpleName(parts[0], global);
    if (!namedElement) return null;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const nameStr = typeof part === "string" ? part : (part?.text ?? "");
      if (typeof namedElement.resolveSimpleName !== "function") return null;
      namedElement = namedElement.resolveSimpleName(nameStr, false, true) as any;
      if (!namedElement) return null;
    }
    return namedElement;
  }

  // Guard against re-entrant name resolution (self-referencing imports like `import A.Units.*` inside `A`)
  static #resolving = new Map<Scope, Set<string>>();

  resolveSimpleName(identifier: any | string | null | undefined, global = false, encapsulated = false): any | null {
    const simpleName = typeof identifier === "string" ? identifier : (identifier?.text ?? "");
    if (!simpleName) return null;

    // Re-entrant guard: prevent infinite recursion from self-referencing imports
    let scopeSet = Scope.#resolving.get(this);
    if (scopeSet?.has(simpleName)) return null;
    if (!scopeSet) {
      scopeSet = new Set<string>();
      Scope.#resolving.set(this, scopeSet);
    }
    scopeSet.add(simpleName);
    try {
      let scope: Scope | null = global ? this.root : this;
      while (scope) {
        let namedElement: any | null = null;
        if (typeof (scope as any).getNamedElement === "function") {
          namedElement = scope.getNamedElement(simpleName);
        }
        if (namedElement) return namedElement;

        if ("qualifiedImports" in scope && "unqualifiedImports" in scope) {
          const classScope = scope as any;
          const element = classScope.qualifiedImports.get(simpleName);
          if (element != null) return element;
          for (const unqualifiedImport of classScope.unqualifiedImports) {
            const element = unqualifiedImport.resolveSimpleName(identifier);
            if (element != null) return element;
          }
        }
        if (!encapsulated) scope = scope.parent;
        else break;
      }
    } finally {
      scopeSet.delete(simpleName);
      if (scopeSet.size === 0) Scope.#resolving.delete(this);
    }
    if (_resolveBuiltIn) {
      const builtIn = _resolveBuiltIn(simpleName);
      if (builtIn) return builtIn;
    }

    if (_getAnnotationScope) {
      const annotationScope = _getAnnotationScope();
      if (
        (annotationScope as unknown) !== (this as unknown) &&
        annotationScope &&
        typeof (annotationScope as any).resolveSimpleName === "function"
      ) {
        return (annotationScope as unknown as Scope).resolveSimpleName(simpleName, false, encapsulated) ?? null;
      }
    }
    return null;
  }

  resolveTypeSpecifier(typeSpecifier: any | null | undefined): any | null {
    if (!typeSpecifier || !typeSpecifier.name) return null;
    return this.resolveName(typeSpecifier.name, typeSpecifier.global);
  }

  get root(): Scope {
    let root = this.parent;
    if (!root) return this;
    while (root.parent) root = root.parent;
    return root;
  }
}
