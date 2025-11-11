// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  ModelicaDAE,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaIntegerVariable,
  ModelicaRealLiteral,
  ModelicaRealVariable,
  ModelicaSimpleEquation,
  ModelicaStringLiteral,
  ModelicaStringVariable,
  ModelicaUnaryExpression,
} from "./dae.js";
import {
  ModelicaBooleanClassInstance,
  ModelicaComponentInstance,
  ModelicaEntity,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaModelVisitor,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
  type ModelicaClassInstance,
} from "./model.js";
import {
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaParenthesizedExpressionSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
} from "./syntax.js";

export class ModelicaFlattener extends ModelicaModelVisitor<[string, ModelicaDAE]> {
  visitEntity(node: ModelicaEntity, args: [string, ModelicaDAE]): void {
    this.visitClassInstance(node, args);
  }

  visitClassInstance(node: ModelicaClassInstance, args: [string, ModelicaDAE]): void {
    for (const element of node.elements) {
      if (element instanceof ModelicaComponentInstance) element.accept(this, args);
    }
    for (const declaredElement of node.declaredElements) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) declaredElement.accept(this, args);
    }
    for (const equationSyntaxNode of node.abstractSyntaxNode?.equations ?? []) {
      equationSyntaxNode.accept(new ModelicaSyntaxFlattener(), [args[0], node, args[1]]);
    }
  }

  visitComponentInstance(node: ModelicaComponentInstance, args: [string, ModelicaDAE]): void {
    const name = args[0] === "" ? (node.name ?? "?") : args[0] + "." + node.name;
    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      const value =
        node.modification?.modificationExpression?.expression?.accept(new ModelicaSyntaxFlattener(), [
          args[0],
          node.classInstance,
          args[1],
        ]) ?? null;
      if (node.classInstance instanceof ModelicaBooleanClassInstance) {
        args[1].variables.push(new ModelicaBooleanVariable(name, value));
      } else if (node.classInstance instanceof ModelicaIntegerClassInstance) {
        args[1].variables.push(new ModelicaIntegerVariable(name, value));
      } else if (node.classInstance instanceof ModelicaRealClassInstance) {
        args[1].variables.push(new ModelicaRealVariable(name, value));
      } else if (node.classInstance instanceof ModelicaStringClassInstance) {
        args[1].variables.push(new ModelicaStringVariable(name, value));
      }
    } else {
      node.classInstance?.accept(this, [name, args[1]]);
    }
  }

  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, args: [string, ModelicaDAE]): void {
    for (const declaredElement of node.classInstance?.declaredElements ?? []) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) declaredElement.accept(this, args);
    }
    for (const equationSyntaxNode of node.classInstance?.abstractSyntaxNode?.equations ?? []) {
      equationSyntaxNode.accept(new ModelicaSyntaxFlattener(), [args[0], node.classInstance, args[1]]);
    }
  }
}

class ModelicaSyntaxFlattener extends ModelicaSyntaxVisitor<
  ModelicaExpression,
  [string, ModelicaClassInstance, ModelicaDAE]
> {
  visitBinaryExpression(
    node: ModelicaBinaryExpressionSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const operand1 = node.operand1?.accept(this, args);
    const operand2 = node.operand2?.accept(this, args);
    const operator = node.operator;
    if (operator && operand1 && operand2) return new ModelicaBinaryExpression(operator, operand1, operand2);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaExpression | null {
    if (node.value != null) return new ModelicaBooleanLiteral(node.value === "true");
    return null;
  }

  visitComponentReference(
    node: ModelicaComponentReferenceSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const name =
      (args[0] === "" ? "" : args[0] + ".") + node.components.map((c) => c.identifier?.value ?? "<ERROR>").join(".");
    for (const variable of args[2].variables) {
      if (variable.name === name) return variable;
    }
    return null;
  }

  visitParenthesizedExpression(
    node: ModelicaParenthesizedExpressionSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    return node.expression?.accept(this, args) ?? null;
  }

  visitSimpleEquation(
    node: ModelicaSimpleEquationSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): null {
    const expression1 = node.expression1?.accept(this, args);
    const expression2 = node.expression2?.accept(this, args);
    if (expression1 && expression2) args[2].equations.push(new ModelicaSimpleEquation(expression1, expression2));
    return null;
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    if (node.value != null) return new ModelicaStringLiteral(node.value);
    return null;
  }

  visitUnaryExpression(
    node: ModelicaUnaryExpressionSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const operand = node.operand?.accept(this, args);
    const operator = node.operator;
    if (operator && operand) return new ModelicaUnaryExpression(operator, operand);
    return null;
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaExpression | null {
    if (node.value != null) return new ModelicaIntegerLiteral(parseInt(node.value));
    return null;
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaExpression | null {
    if (node.value != null) return new ModelicaRealLiteral(parseFloat(node.value));
    return null;
  }
}
