// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Scope } from "../scope.js";
import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
} from "./dae.js";
import {
  ModelicaArrayClassInstance,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaModification,
  ModelicaParameterModification,
} from "./model.js";
import {
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaClassKind,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
} from "./syntax.js";

/** Set of Modelica built-in array function names handled directly by the interpreter. */
const BUILTIN_ARRAY_FUNCTIONS = new Set(["fill", "size", "zeros", "ones", "linspace"]);

/**
 * Helper: build a (possibly nested) ModelicaArray filled with `value`.
 * `shape` is e.g. [2, 3] for a 2×3 matrix.
 */
function buildFilledArray(shape: number[], value: ModelicaExpression): ModelicaArray {
  if (shape.length === 1) {
    const n = shape[0] ?? 0;
    return new ModelicaArray([n], Array(n).fill(value));
  }
  const [first, ...rest] = shape;
  const n = first ?? 0;
  const elements: ModelicaExpression[] = [];
  for (let i = 0; i < n; i++) {
    elements.push(buildFilledArray(rest, value));
  }
  return new ModelicaArray([n], elements);
}

export class ModelicaInterpreter extends ModelicaSyntaxVisitor<ModelicaExpression, Scope> {
  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, scope: Scope): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    const shape = [node.expressionLists.length, node.expressionLists[0]?.expressions?.length ?? 0];
    for (const expressionList of node.expressionLists ?? []) {
      for (const expression of expressionList.expressions ?? []) {
        const element = expression.accept(this, scope);
        if (element != null) elements.push(element);
      }
    }
    return new ModelicaArray(shape, elements);
  }

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, scope: Scope): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, scope);
      if (element != null) elements.push(element);
    }
    return new ModelicaArray([elements.length], elements);
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const operand1 = node.operand1?.accept(this, scope);
    const operand2 = node.operand2?.accept(this, scope);
    if (node.operator && operand1 && operand2) return ModelicaBinaryExpression.new(node.operator, operand1, operand2);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaBooleanLiteral {
    return new ModelicaBooleanLiteral(node.value);
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, scope: Scope): ModelicaExpression | null {
    const namedElement = scope.resolveComponentReference(node);
    if (!namedElement) return null;
    if (namedElement instanceof ModelicaClassInstance) return ModelicaExpression.fromClassInstance(namedElement);
    else if (namedElement instanceof ModelicaComponentInstance) {
      if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
      return ModelicaExpression.fromClassInstance(namedElement.classInstance);
    } else {
      throw new Error();
    }
  }

  /**
   * Evaluate positional arguments of a function call node, returning evaluated
   * `ModelicaExpression` values (or `null` for arguments that cannot be evaluated).
   */
  private evaluateArgs(node: ModelicaFunctionCallSyntaxNode, scope: Scope): (ModelicaExpression | null)[] {
    return (node.functionCallArguments?.arguments ?? []).map((arg) => arg.expression?.accept(this, scope) ?? null);
  }

  /**
   * Handle Modelica built-in array functions.
   * Returns the result expression, or `null` if the function name is not a
   * recognised built-in (so the caller can fall through to user-defined function handling).
   */
  private evaluateBuiltinFunction(
    name: string,
    node: ModelicaFunctionCallSyntaxNode,
    scope: Scope,
  ): ModelicaExpression | null | undefined {
    switch (name) {
      // fill(s, n1, n2, ...) → array of shape [n1, n2, ...] filled with s
      case "fill": {
        const args = this.evaluateArgs(node, scope);
        const value = args[0];
        if (!value) return null;
        const shape: number[] = [];
        for (let i = 1; i < args.length; i++) {
          const dim = args[i];
          if (dim instanceof ModelicaIntegerLiteral) shape.push(dim.value);
          else return null;
        }
        if (shape.length === 0) return null;
        return buildFilledArray(shape, value);
      }

      // size(A, i) → integer size of dimension i of array A
      case "size": {
        const argNodes = node.functionCallArguments?.arguments ?? [];
        // First argument: component reference to an array variable
        const arrayRefExpr = argNodes[0]?.expression;
        // Second argument: dimension index
        const dimArg = argNodes[1]?.expression?.accept(this, scope);
        if (!arrayRefExpr || !(dimArg instanceof ModelicaIntegerLiteral)) return null;

        // Resolve the component reference to find its ModelicaArrayClassInstance
        const componentRef = arrayRefExpr;
        const namedElement = scope.resolveComponentReference(
          componentRef as unknown as ModelicaComponentReferenceSyntaxNode,
        );
        let arrayClassInstance: ModelicaArrayClassInstance | null = null;
        if (namedElement instanceof ModelicaComponentInstance) {
          if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
          if (namedElement.classInstance instanceof ModelicaArrayClassInstance) {
            arrayClassInstance = namedElement.classInstance;
          }
        } else if (namedElement instanceof ModelicaArrayClassInstance) {
          arrayClassInstance = namedElement;
        }
        if (!arrayClassInstance) return null;

        const dimIndex = dimArg.value; // 1-based
        const dimSize = arrayClassInstance.shape[dimIndex - 1];
        if (dimSize == null) return null;
        return new ModelicaIntegerLiteral(dimSize);
      }

      // zeros(n1, n2, ...) → fill(0, n1, n2, ...)
      case "zeros": {
        const args = this.evaluateArgs(node, scope);
        const shape: number[] = [];
        for (const arg of args) {
          if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
          else return null;
        }
        if (shape.length === 0) return null;
        return buildFilledArray(shape, new ModelicaIntegerLiteral(0));
      }

      // ones(n1, n2, ...) → fill(1, n1, n2, ...)
      case "ones": {
        const args = this.evaluateArgs(node, scope);
        const shape: number[] = [];
        for (const arg of args) {
          if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
          else return null;
        }
        if (shape.length === 0) return null;
        return buildFilledArray(shape, new ModelicaIntegerLiteral(1));
      }

      // linspace(x1, x2, n) → {x1, x1 + (x2-x1)/(n-1), ..., x2}
      case "linspace": {
        const args = this.evaluateArgs(node, scope);
        const x1Expr = args[0];
        const x2Expr = args[1];
        const nExpr = args[2];
        if (!x1Expr || !x2Expr || !(nExpr instanceof ModelicaIntegerLiteral)) return null;
        const n = nExpr.value;
        if (n < 2) return null;

        // Extract numeric values for x1, x2
        let x1: number | null = null;
        let x2: number | null = null;
        if (x1Expr instanceof ModelicaRealLiteral || x1Expr instanceof ModelicaIntegerLiteral) x1 = x1Expr.value;
        if (x2Expr instanceof ModelicaRealLiteral || x2Expr instanceof ModelicaIntegerLiteral) x2 = x2Expr.value;
        if (x1 == null || x2 == null) return null;

        const elements: ModelicaExpression[] = [];
        for (let i = 0; i < n; i++) {
          elements.push(new ModelicaRealLiteral(x1 + ((x2 - x1) * i) / (n - 1)));
        }
        return new ModelicaArray([n], elements);
      }

      default:
        return undefined; // Not a built-in function
    }
  }

  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    // Check for built-in array functions first
    const funcName =
      node.functionReference?.parts?.length === 1 ? (node.functionReference.parts[0]?.identifier?.text ?? null) : null;
    if (funcName && BUILTIN_ARRAY_FUNCTIONS.has(funcName)) {
      const result = this.evaluateBuiltinFunction(funcName, node, scope);
      if (result !== undefined) return result;
    }

    const functionInstance = scope.resolveComponentReference(node.functionReference);
    if (!(functionInstance instanceof ModelicaClassInstance)) return null;
    const parameters: ModelicaParameterModification[] = [];
    const inputParameters = Array.from(functionInstance.inputParameters);
    if (node.functionCallArguments?.arguments) {
      for (let i = 0; i < node.functionCallArguments.arguments.length; i++) {
        const name = inputParameters[i]?.name;
        const expression = node.functionCallArguments.arguments[i]?.expression;
        if (name && expression) parameters.push(new ModelicaParameterModification(scope, name, expression));
      }
    }
    for (const namedArgument of node.functionCallArguments?.namedArguments ?? []) {
      const name = namedArgument.identifier?.text;
      const expression = namedArgument.argument?.expression;
      if (name && expression) parameters.push(new ModelicaParameterModification(scope, name, expression));
    }
    if (functionInstance.classKind === ModelicaClassKind.RECORD) {
      return ModelicaExpression.fromClassInstance(functionInstance.clone(new ModelicaModification(scope, parameters)));
    } else if (functionInstance.classKind === ModelicaClassKind.FUNCTION) {
      const outputParameters = functionInstance.clone(new ModelicaModification(scope, parameters)).outputParameters;
      const outputExpressions: ModelicaExpression[] = [];
      for (const outputParameter of outputParameters) {
        const outputExpression = ModelicaExpression.fromClassInstance(outputParameter.classInstance);
        if (outputExpression) outputExpressions.push(outputExpression);
      }
      if (outputExpressions.length <= 1) {
        return outputExpressions[0] ?? null;
      } else {
        return new ModelicaArray([outputExpressions.length], outputExpressions);
      }
    } else {
      return null;
    }
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    return new ModelicaStringLiteral(node.text ?? "");
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const operand = node.operand?.accept(this, scope);
    if (node.operator && operand) return ModelicaUnaryExpression.new(node.operator, operand);
    return null;
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaIntegerLiteral {
    return new ModelicaIntegerLiteral(node.value);
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaRealLiteral {
    return new ModelicaRealLiteral(node.value);
  }
}

export function evaluateCondition(component: ModelicaComponentInstance): boolean | undefined {
  const node = component.abstractSyntaxNode;
  if (!node || !("conditionAttribute" in node) || !node.conditionAttribute?.condition) return true;

  const condition = node.conditionAttribute.condition;
  const interpreter = new ModelicaInterpreter();
  try {
    const result = condition.accept(interpreter, component.parent ?? component);
    if (result instanceof ModelicaBooleanLiteral) {
      return result.value;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // Ignore evaluation failures
  }
  return undefined;
}
