// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Scope } from "@modelscript/compiler";
import { ModelicaIdentifierSyntaxNode } from "@modelscript/modelica/ast";
import type {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaElement as ModelicaNamedElement,
} from "@modelscript/modelica/semantic-model";

// Import the private registry setter from core scope to keep callback registers linked
import { _getScriptingScope } from "../scope.js";

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
    const getScriptingScope = _getScriptingScope;
    if (getScriptingScope) {
      const scriptingScope = getScriptingScope();
      if (scriptingScope && typeof (scriptingScope as unknown as Scope).resolveSimpleName === "function") {
        const scriptingResult = (scriptingScope as unknown as Scope).resolveSimpleName(identifier, false, true);
        if (scriptingResult) return scriptingResult;
      }
    }

    // Safely delegate to duck-typed parent scopes (like ModelicaClassInstance from LSP)
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
