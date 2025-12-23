// SPDX-License-Identifier: AGPL-3.0-or-later

import { makeWeakRef } from "../util/weak.js";
import {
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
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

export abstract class Scope {
  #parent: WeakRef<Scope> | null;

  constructor(parent: Scope | null) {
    this.#parent = makeWeakRef(parent);
  }

  abstract get elements(): IterableIterator<ModelicaElement>;

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
    const components = componentReference.components;
    if (components.length === 0) return null;
    let element = this.resolveSimpleName(components[0]?.identifier, componentReference.global);
    if (element instanceof ModelicaComponentInstance) {
      if (!element.instantiated && !element.instantiating) element.instantiate();
      element = element.classInstance;
    }
    if (!element) return null;
    for (let i = 1; i < components.length; i++) {
      element = element.resolveSimpleName(components[i]?.identifier, false, true);
      if (element == null) return null;
    }
    return element;
  }

  resolveName(name: ModelicaNameSyntaxNode | string[] | null | undefined, global = false): ModelicaNamedElement | null {
    const components = name instanceof ModelicaNameSyntaxNode ? name.components : name;
    if (!components || components.length === 0) return null;
    let namedElement = this.resolveSimpleName(components[0], global);
    if (!namedElement) return null;
    for (let i = 1; i < components.length; i++) {
      namedElement = namedElement.resolveSimpleName(components[i], false, true);
      if (!namedElement) return null;
    }
    return namedElement;
  }

  resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier?.value : identifier;
    if (!simpleName) return null;
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
    switch (simpleName) {
      case "Boolean":
        return new ModelicaBooleanClassInstance(null, null);
      case "Integer":
        return new ModelicaIntegerClassInstance(null, null);
      case "Real":
        return new ModelicaRealClassInstance(null, null);
      case "String":
        return new ModelicaStringClassInstance(null, null);
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
