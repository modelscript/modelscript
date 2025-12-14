// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  ModelicaDAE,
  ModelicaEnumerationVariable,
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
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaComponentInstance,
  ModelicaEntity,
  ModelicaEnumerationClassInstance,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaModelVisitor,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
  type ModelicaClassInstance,
} from "./model.js";
import {
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
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
  visitArrayClassInstance(node: ModelicaArrayClassInstance, args: [string, ModelicaDAE]): void {
    this.visitClassInstance(node, args);
  }

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
    const value =
      node.modification?.expression ??
      node.modification?.modificationExpression?.expression?.accept(new ModelicaSyntaxFlattener(), [
        args[0],
        node.classInstance,
        args[1],
      ]) ??
      null;
    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      if (node.classInstance instanceof ModelicaBooleanClassInstance) {
        args[1].variables.push(
          new ModelicaBooleanVariable(
            name,
            value,
            node.variability,
            node.modification?.description ?? node.description,
          ),
        );
      } else if (node.classInstance instanceof ModelicaIntegerClassInstance) {
        args[1].variables.push(
          new ModelicaIntegerVariable(
            name,
            value,
            node.variability,
            node.modification?.description ?? node.description,
          ),
        );
      } else if (node.classInstance instanceof ModelicaRealClassInstance) {
        args[1].variables.push(
          new ModelicaRealVariable(name, value, node.variability, node.modification?.description ?? node.description),
        );
      } else if (node.classInstance instanceof ModelicaStringClassInstance) {
        args[1].variables.push(
          new ModelicaStringVariable(name, value, node.variability, node.modification?.description ?? node.description),
        );
      }
    } else if (node.classInstance instanceof ModelicaEnumerationClassInstance) {
      args[1].variables.push(
        new ModelicaEnumerationVariable(
          name,
          node.classInstance.enumerationLiterals,
          value,
          node.variability,
          node.modification?.description ?? node.description,
        ),
      );
    } else if (node.classInstance instanceof ModelicaArrayClassInstance) {
      const shape = node.classInstance.shape;
      const index = new Array(shape.length).fill(1);
      let c = 0;
      for (const declaredElement of node.classInstance.declaredElements) {
        const elementName = name + "[" + index.join(", ") + "]";
        if (
          declaredElement instanceof ModelicaPredefinedClassInstance ||
          declaredElement instanceof ModelicaEnumerationClassInstance
        ) {
          const declaredElementValue =
            (value instanceof ModelicaArray
              ? value.getFlatElement(c)
              : (value ??
                declaredElement.modification?.expression ??
                declaredElement.modification?.modificationExpression?.expression?.accept(
                  new ModelicaSyntaxFlattener(),
                  [args[0], node.classInstance, args[1]],
                ))) ?? null;
          if (declaredElement instanceof ModelicaBooleanClassInstance) {
            args[1].variables.push(
              new ModelicaBooleanVariable(
                elementName,
                declaredElementValue,
                node.variability,
                declaredElement.modification?.description ?? declaredElement.description,
              ),
            );
          } else if (declaredElement instanceof ModelicaIntegerClassInstance) {
            args[1].variables.push(
              new ModelicaIntegerVariable(
                elementName,
                declaredElementValue,
                node.variability,
                declaredElement.modification?.description ?? declaredElement.description,
              ),
            );
          } else if (declaredElement instanceof ModelicaRealClassInstance) {
            args[1].variables.push(
              new ModelicaRealVariable(
                elementName,
                declaredElementValue,
                node.variability,
                declaredElement.modification?.description ?? declaredElement.description,
              ),
            );
          } else if (declaredElement instanceof ModelicaStringClassInstance) {
            args[1].variables.push(
              new ModelicaStringVariable(
                elementName,
                declaredElementValue,
                node.variability,
                declaredElement.modification?.description ?? declaredElement.description,
              ),
            );
          } else if (declaredElement instanceof ModelicaEnumerationClassInstance) {
            args[1].variables.push(
              new ModelicaEnumerationVariable(
                elementName,
                declaredElement.enumerationLiterals,
                declaredElementValue,
                node.variability,
                declaredElement.modification?.description ?? declaredElement.description,
              ),
            );
          }
        } else {
          declaredElement?.accept(this, [elementName, args[1]]);
        }
        if (!this.incrementIndex(index, shape)) break;
        c++;
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

  incrementIndex(index: number[], shape: number[]): boolean {
    for (let i = shape.length - 1; i >= 0; i--) {
      const length = shape[i] ?? -1;
      if ((index[i] ?? 1) < length) {
        index[i] = (index[i] ?? 1) + 1;
        for (let j = i + 1; j < shape.length; j++) index[j] = 1;
        return true;
      }
    }
    return false;
  }
}

class ModelicaSyntaxFlattener extends ModelicaSyntaxVisitor<
  ModelicaExpression,
  [string, ModelicaClassInstance, ModelicaDAE]
> {
  visitArrayConcatenation(
    node: ModelicaArrayConcatenationSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    const shape = [node.expressionLists.length, node.expressionLists[0]?.expressions?.length ?? 0];
    for (const expressionList of node.expressionLists ?? []) {
      for (const expression of expressionList.expressions ?? []) {
        const element = expression.accept(this, args);
        if (element != null) elements.push(element);
      }
    }
    return new ModelicaArray(shape, elements);
  }

  visitArrayConstructor(
    node: ModelicaArrayConstructorSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, args);
      if (element != null) elements.push(element);
    }
    return new ModelicaArray([elements.length], elements);
  }

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
    if (args[1] instanceof ModelicaEnumerationClassInstance) {
      for (const enumerationLiteral of args[1].enumerationLiterals ?? []) {
        if (enumerationLiteral.stringValue === node.components?.[(node.components?.length ?? 1) - 1]?.identifier?.value)
          return enumerationLiteral;
      }
    } else {
      for (const variable of args[2].variables) {
        if (variable.name === name) return variable;
      }
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
    if (expression1 && expression2)
      args[2].equations.push(
        new ModelicaSimpleEquation(
          expression1,
          expression2,
          node.description?.descriptionStrings?.map((d) => d.value)?.join(" "),
        ),
      );
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
