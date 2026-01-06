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
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaModification,
  ModelicaParameterModification,
  type ModelicaNode,
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

export class ModelicaInterpreter extends ModelicaSyntaxVisitor<ModelicaExpression, ModelicaNode> {
  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
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

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, scope);
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

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaBooleanLiteral {
    return new ModelicaBooleanLiteral(node.value);
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
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

  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
    const functionInstance = scope.resolveComponentReference(node.functionReference);
    if (functionInstance == null || !(functionInstance instanceof ModelicaClassInstance)) return null;
    const parameters: ModelicaParameterModification[] = [];
    for (const namedArgument of node.functionCallArguments?.namedArguments ?? []) {
      const name = namedArgument.identifier?.text;
      const expression = namedArgument.argument?.expression;
      if (name != null && expression != null)
        parameters.push(new ModelicaParameterModification(scope, name, expression));
    }
    if (functionInstance.classKind == ModelicaClassKind.RECORD) {
      return ModelicaExpression.fromClassInstance(functionInstance.clone(new ModelicaModification(scope, parameters)));
    } else {
      return null;
    }
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    return new ModelicaStringLiteral(node.text ?? "");
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, scope: ModelicaNode): ModelicaExpression | null {
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
