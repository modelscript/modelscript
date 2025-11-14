// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { ModelicaEnumerationClassInstance, ModelicaPredefinedClassInstance, type ModelicaNode } from "./model.js";
import {
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaParenthesizedExpressionSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
} from "./syntax.js";

export class ModelicaInterpreter extends ModelicaSyntaxVisitor<ModelicaExpression, ModelicaNode> {
  visitArrayConcatenation(
    node: ModelicaArrayConcatenationSyntaxNode,
    argument: ModelicaNode,
  ): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    const shape = [node.expressionLists.length, node.expressionLists[0]?.expressions?.length ?? 0];
    for (const expressionList of node.expressionLists ?? []) {
      for (const expression of expressionList.expressions ?? []) {
        const element = expression.accept(this, argument);
        if (element != null) elements.push(element);
      }
    }
    return new ModelicaArray(shape, elements);
  }

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, argument: ModelicaNode): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, argument);
      if (element != null) elements.push(element);
    }
    return new ModelicaArray([elements.length], elements);
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
    const operand1 = node.operand1?.accept(this, scope);
    const operand2 = node.operand2?.accept(this, scope);
    if (node.operator && operand1 && operand2) return ModelicaBinaryExpression.new(node.operator, operand1, operand2);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaExpression | null {
    const value = node.value === "true" ? true : node.value === "false" ? false : null;
    if (value) return new ModelicaBooleanLiteral(value);
    return null;
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
    const namedElement = scope.resolveComponentReference(node);
    if (!namedElement) return null;
    if (namedElement instanceof ModelicaPredefinedClassInstance) {
      if (namedElement.value instanceof ModelicaExpression) return namedElement.value;
      if (namedElement.value instanceof ModelicaExpressionSyntaxNode) return namedElement.value.accept(this, scope);
      return null;
    } else if (namedElement instanceof ModelicaEnumerationClassInstance) {
      return namedElement.value;
    }
    return null;
  }

  visitParenthesizedExpression(
    node: ModelicaParenthesizedExpressionSyntaxNode,
    scope: ModelicaNode,
  ): ModelicaExpression | null {
    return node.expression?.accept(this, scope) ?? null;
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    if (node.value) return new ModelicaStringLiteral(node.value);
    return null;
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
    const operand = node.operand?.accept(this, scope);
    if (node.operator && operand) return ModelicaUnaryExpression.new(node.operator, operand);
    return null;
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaExpression | null {
    const value = node.value ? parseInt(node.value) : null;
    if (value) return new ModelicaIntegerLiteral(value);
    return null;
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaExpression | null {
    const value = node.value ? parseFloat(node.value) : null;
    if (value) return new ModelicaRealLiteral(value);
    return null;
  }
}
