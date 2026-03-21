// SPDX-License-Identifier: AGPL-3.0-or-later

import { makeWeakRef } from "../util/weak.js";
import {
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaClockClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaIntegerClassInstance,
  ModelicaNamedElement,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
} from "./modelica/model.js";
import {
  ModelicaIdentifierSyntaxNode,
  ModelicaNameSyntaxNode,
  ModelicaTypeSpecifierSyntaxNode,
  type ModelicaComponentReferenceSyntaxNode,
} from "./modelica/syntax.js";

let scopeBoolean: ModelicaBooleanClassInstance | null = null;
let scopeClock: ModelicaClockClassInstance | null = null;
let scopeInteger: ModelicaIntegerClassInstance | null = null;
let scopeReal: ModelicaRealClassInstance | null = null;
let scopeString: ModelicaStringClassInstance | null = null;

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
    if (element instanceof ModelicaComponentInstance) {
      if (!element.instantiated && !element.instantiating) element.instantiate();
      element = element.classInstance;
    }
    if (!element) return null;
    for (let i = 1; i < parts.length; i++) {
      element = element.resolveSimpleName(parts[i]?.identifier, false, true);
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
      namedElement = namedElement.resolveSimpleName(parts[i], false, true);
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
        for (const element of scope.elements) {
          if (element instanceof ModelicaNamedElement && element.name === simpleName) return element;
        }
        if (scope instanceof ModelicaClassInstance) {
          const element = scope.qualifiedImports.get(simpleName);
          if (element != null) return element;
          for (const unqualifiedImport of scope.unqualifiedImports) {
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
    switch (simpleName) {
      case "Boolean":
        if (!scopeBoolean) scopeBoolean = new ModelicaBooleanClassInstance(null, null);
        return scopeBoolean;
      case "Clock":
        if (!scopeClock) scopeClock = new ModelicaClockClassInstance(null, null);
        return scopeClock;
      case "Integer":
        if (!scopeInteger) scopeInteger = new ModelicaIntegerClassInstance(null, null);
        return scopeInteger;
      case "Real":
        if (!scopeReal) scopeReal = new ModelicaRealClassInstance(null, null);
        return scopeReal;
      case "String":
        if (!scopeString) scopeString = new ModelicaStringClassInstance(null, null);
        return scopeString;
    }
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((this as any) !== ModelicaElement.annotationClassInstance
        ? ModelicaElement.annotationClassInstance?.resolveSimpleName(simpleName, false, encapsulated)
        : null) ?? null
    );
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
  #bindings: Map<string, ModelicaClassInstance>;

  constructor(parent: Scope, bindings: Map<string, ModelicaClassInstance>) {
    super(parent);
    this.#bindings = bindings;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    // Loop scopes have no declared elements; bindings are resolved via resolveSimpleName
    return [][Symbol.iterator]() as IterableIterator<ModelicaElement>;
  }

  override get hash(): string {
    return "";
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier?.text : identifier;
    if (simpleName && !global) {
      const binding = this.#bindings.get(simpleName);
      if (binding) return binding;
    }
    return this.parent?.resolveSimpleName(identifier, global, encapsulated) ?? null;
  }
}
