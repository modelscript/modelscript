// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaIntegerLiteral,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
  type ModelicaExpression,
} from "./dae.js";
import type { ModelicaNode } from "./model.js";
import {
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaComponentReferenceComponentSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaParenthesizedExpressionSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
} from "./syntax.js";

export class ModelicaInterpreter extends ModelicaSyntaxVisitor<ModelicaExpression, ModelicaNode> {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
    return null;
  }

  visitComponentReferenceComponent(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    node: ModelicaComponentReferenceComponentSyntaxNode,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    scope: ModelicaNode,
  ): ModelicaExpression | null {
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
