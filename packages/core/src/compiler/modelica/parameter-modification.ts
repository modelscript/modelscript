// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standalone parameter modification class for function call argument passing.
 *
 * Extracted from model.ts so that the polyglot flattener can construct
 * parameter modifications without depending on the full legacy model
 * class hierarchy.
 *
 * This is a lightweight version that only provides the properties
 * needed by the flattener's function inlining logic.
 */

import { type ModelicaExpressionSyntaxNode } from "@modelscript/modelica-polyglot/ast";
import type { ModelicaExpression } from "@modelscript/symbolics";
import { createHash, makeWeakRef } from "@modelscript/utils";
import type { Scope } from "../scope.js";
import { ModelicaInterpreter } from "./interpreter.js";

/**
 * Represents a positional parameter argument in a function call modification.
 *
 * Each instance binds a named parameter to a (possibly lazy-evaluated) expression.
 * Used by the flattener when inlining function calls.
 */
export class ModelicaParameterModification {
  #expression: ModelicaExpression | null = null;
  #expressionSyntaxNode: WeakRef<ModelicaExpressionSyntaxNode> | null;
  #name: string;
  #scope: Scope | null;
  #evaluating = false;

  constructor(
    scope: Scope | null,
    name: string,
    expressionSyntaxNode?: ModelicaExpressionSyntaxNode | null,
    expression?: ModelicaExpression | null,
  ) {
    this.#scope = scope;
    this.#name = name;
    this.#expressionSyntaxNode = makeWeakRef(expressionSyntaxNode);
    this.#expression = expression ?? null;
  }

  get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    if (this.#evaluating) {
      return null;
    }
    this.#evaluating = true;
    try {
      this.#expression = this.#expressionSyntaxNode?.deref()?.accept(new ModelicaInterpreter(), this.#scope) ?? null;
    } finally {
      this.#evaluating = false;
    }
    return this.#expression;
  }

  get expressionSyntaxNode(): ModelicaExpressionSyntaxNode | null {
    return this.#expressionSyntaxNode?.deref() ?? null;
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name);
    if (this.expression) {
      hash.update(this.expression.hash);
    }
    return hash.digest("hex");
  }

  get name(): string {
    return this.#name;
  }

  get scope(): Scope | null {
    return this.#scope;
  }

  split(count: number): ModelicaParameterModification[];
  split(count: number, index: number): ModelicaParameterModification;
  split(count: number, index?: number): ModelicaParameterModification | ModelicaParameterModification[] {
    if (!this.expression) throw new Error();
    if (index) {
      return new ModelicaParameterModification(
        this.#scope,
        this.name,
        this.expressionSyntaxNode,
        this.expression.split(count, index),
      );
    } else {
      const expressions = this.expression.split(count);
      const modifications = [];
      for (const expression of expressions) {
        modifications.push(
          new ModelicaParameterModification(this.#scope, this.name, this.expressionSyntaxNode, expression),
        );
      }
      return modifications;
    }
  }
}
