// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ModelicaIdentifierSyntaxNode,
  ModelicaNameSyntaxNode,
  ModelicaTypeSpecifierSyntaxNode,
  type ModelicaComponentReferenceSyntaxNode,
} from "@modelscript/modelica-polyglot/ast";
import { makeWeakRef } from "@modelscript/utils";
import type {
  QueryBackedClassInstance as ModelicaClassInstance,
  QueryBackedComponentInstance as ModelicaComponentInstance,
  QueryBackedElement as ModelicaElement,
  QueryBackedElement as ModelicaNamedElement,
} from "./modelica/metascript-bridge.js";

// ── Dependency-injected callbacks ───────────────────────────────────────────
let _resolveBuiltIn: ((name: string) => ModelicaNamedElement | null) | null = null;
export function setBuiltInResolver(fn: (name: string) => ModelicaNamedElement | null) {
  _resolveBuiltIn = fn;
}

let _getAnnotationScope: (() => ModelicaNamedElement | null) | null = null;
export function setAnnotationScopeGetter(fn: () => ModelicaNamedElement | null) {
  _getAnnotationScope = fn;
}

let _getScriptingScope: (() => ModelicaNamedElement | null) | null = null;
export function setScriptingScopeGetter(fn: () => ModelicaNamedElement | null) {
  _getScriptingScope = fn;
}

export abstract class Scope {
  #parent: WeakRef<Scope> | null;

  constructor(parent: Scope | null) {
    this.#parent = makeWeakRef(parent);
  }

  abstract get elements(): IterableIterator<ModelicaElement>;

  abstract get hash(): string;

  get parent(): Scope | null {
    return this.#parent?.deref() ?? null;
  }

  getNamedElement(name: string): ModelicaNamedElement | null {
    for (const element of this.elements) {
      if ("name" in element && (element as { name?: string }).name === name) {
        return element as unknown as ModelicaNamedElement;
      }
    }
    return null;
  }

  query(name: string): ModelicaNamedElement | null {
    return this.resolveName(name.split("."));
  }

  resolveComponentReference(
    componentReference: ModelicaComponentReferenceSyntaxNode | null | undefined,
  ): ModelicaNamedElement | null {
    if (!componentReference) return null;
    const parts = componentReference.parts;
    if (parts.length === 0) return null;
    let element = this.resolveSimpleName(parts[0]?.identifier, componentReference.global);
    if (element && "instantiated" in element && "classInstance" in element) {
      const comp = element as unknown as ModelicaComponentInstance;
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

  resolveName(name: ModelicaNameSyntaxNode | string[] | null | undefined, global = false): ModelicaNamedElement | null {
    const parts = name instanceof ModelicaNameSyntaxNode ? name.parts : name;
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

  resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier?.text : identifier;
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
        const namedElement = scope.getNamedElement(simpleName);
        if (namedElement) return namedElement;

        if ("qualifiedImports" in scope && "unqualifiedImports" in scope) {
          const classScope = scope as unknown as ModelicaClassInstance;
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

  resolveTypeSpecifier(typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null | undefined): ModelicaNamedElement | null {
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

/**
 * A lightweight scope for loop variables in comprehension clauses like
 * `sum(expr for i in 1:n)`. Bindings map loop variable names to their
 * current class instance values. Name resolution checks bindings first,
 * then delegates to the parent scope.
 */
export class ModelicaLoopScope extends Scope {
  bindings: Map<string, ModelicaClassInstance>;

  constructor(parent: Scope, bindings: Map<string, ModelicaClassInstance>) {
    super(parent);
    this.bindings = bindings;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    // Loop scopes have no declared elements; bindings are resolved via resolveSimpleName
    return [][Symbol.iterator]() as IterableIterator<ModelicaElement>;
  }

  override get hash(): string {
    return "";
  }

  override getNamedElement(name: string): ModelicaNamedElement | null {
    return this.bindings.get(name) ?? null;
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier?.text : identifier;
    if (simpleName && !global) {
      const binding = this.bindings.get(simpleName);
      if (binding) return binding;
    }
    return super.resolveSimpleName(identifier, global, encapsulated);
  }
}

/**
 * A scope used by the interpreter to store dynamically created variables during script execution.
 */
export class ModelicaScriptScope extends Scope {
  variables = new Map<string, ModelicaComponentInstance>();
  classDefinitions = new Map<string, ModelicaClassInstance>();

  override get elements(): IterableIterator<ModelicaElement> {
    const vars = this.variables.values();
    const classes = this.classDefinitions.values();
    return (function* () {
      yield* vars;
      yield* classes;
    })();
  }

  override get hash(): string {
    return "";
  }

  override getNamedElement(name: string): ModelicaNamedElement | null {
    return this.variables.get(name) ?? this.classDefinitions.get(name) ?? null;
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const name = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier.text : identifier;
    if (name) {
      if (this.variables.has(name)) return this.variables.get(name) ?? null;
      if (this.classDefinitions.has(name)) return this.classDefinitions.get(name) ?? null;
    }
    // Check scripting built-in types (SimulationResult, SimulationOptions, etc.)
    if (_getScriptingScope) {
      const scriptingScope = _getScriptingScope();
      if (scriptingScope && typeof (scriptingScope as unknown as Scope).resolveSimpleName === "function") {
        const scriptingResult = (scriptingScope as unknown as Scope).resolveSimpleName(identifier, false, true);
        if (scriptingResult) return scriptingResult;
      }
    }

    // Safely delegate to duck-typed parent scopes (like QueryBackedClassInstance from LSP)
    // which implement resolveSimpleName directly backed by the global database but lack getNamedElement.
    if (
      this.parent &&
      typeof (this.parent as any).getNamedElement !== "function" &&
      typeof (this.parent as any).resolveSimpleName === "function"
    ) {
      return (this.parent as any).resolveSimpleName(name);
    }

    return super.resolveSimpleName(identifier, global, encapsulated);
  }
}
