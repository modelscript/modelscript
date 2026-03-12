// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  ModelicaDAE,
  ModelicaEnumerationVariable,
  ModelicaExpression,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
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
  ModelicaFunctionArgumentSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
  ModelicaVariability,
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
    const causality = node.abstractSyntaxNode?.parent?.causality ?? null;
    const isFinal = (node.abstractSyntaxNode?.parent as { final?: boolean })?.final ?? false;

    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      const attributes = new Map(
        node.modification?.modificationArguments.flatMap((m) => {
          if (m.name === "annotation") return [];
          return m.name && m.expression ? [[m.name, m.expression]] : [];
        }),
      );
      const isCompileTimeEvaluable =
        node.variability === ModelicaVariability.PARAMETER || node.variability === ModelicaVariability.CONSTANT;
      const expression = isCompileTimeEvaluable
        ? (node.modification?.evaluatedExpression ?? null)
        : (node.modification?.expression ?? null);
      let variable;
      const varExpression = expression;

      if (node.classInstance instanceof ModelicaBooleanClassInstance) {
        variable = new ModelicaBooleanVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
        );
      } else if (node.classInstance instanceof ModelicaIntegerClassInstance) {
        variable = new ModelicaIntegerVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
        );
      } else if (node.classInstance instanceof ModelicaRealClassInstance) {
        for (const key of ["start", "min", "max", "nominal"]) {
          if (attributes.has(key)) {
            const casted = castToReal(attributes.get(key) ?? null);
            if (casted) attributes.set(key, casted);
          }
        }
        variable = new ModelicaRealVariable(
          name,
          castToReal(varExpression),
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
        );
      } else if (node.classInstance instanceof ModelicaStringClassInstance) {
        variable = new ModelicaStringVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
        );
      }
      if (variable) {
        args[1].variables.push(variable);
      }
    } else if (node.classInstance instanceof ModelicaEnumerationClassInstance) {
      const attributes = new Map(
        node.modification?.modificationArguments.flatMap((m) =>
          m.name && m.expression ? [[m.name, m.expression]] : [],
        ),
      );
      const expression = node.modification?.expression ?? null;
      const varExpression = expression;
      const variable = new ModelicaEnumerationVariable(
        name,
        varExpression,
        attributes,
        node.variability,
        node.modification?.description ?? node.description,
        node.classInstance.enumerationLiterals,
        causality,
        isFinal,
      );
      args[1].variables.push(variable);
    } else if (node.classInstance instanceof ModelicaArrayClassInstance) {
      // Capture the array-level binding expression BEFORE iterating elements.
      const arrayBindingExpression = node.modification?.expression ?? null;

      // For parameter/constant variables, split the binding into per-element values.
      const isCompileTimeEvaluable =
        node.variability === ModelicaVariability.PARAMETER || node.variability === ModelicaVariability.CONSTANT;
      const flatBindingElements =
        isCompileTimeEvaluable && arrayBindingExpression instanceof ModelicaArray
          ? [...arrayBindingExpression.flatElements]
          : null;

      const shape = node.classInstance.shape;
      const index = new Array(shape.length).fill(1);
      let elementIndex = 0;
      for (const declaredElement of node.classInstance.declaredElements) {
        const elementName = name + "[" + index.join(",") + "]";
        if (
          declaredElement instanceof ModelicaPredefinedClassInstance ||
          declaredElement instanceof ModelicaEnumerationClassInstance
        ) {
          const attributes = new Map(
            declaredElement.modification?.modificationArguments.flatMap((m) =>
              m.name && m.expression ? [[m.name, m.expression]] : [],
            ),
          );
          // For parameter arrays with a binding, use the split element value.
          // For non-parameter arrays with a binding, suppress inline (emit equation later).
          // Otherwise use the element's own modification expression.
          let expression: ModelicaExpression | null;
          if (flatBindingElements) {
            expression = flatBindingElements[elementIndex] ?? null;
          } else if (arrayBindingExpression) {
            expression = null;
          } else {
            expression = declaredElement.modification?.expression ?? null;
          }
          const varExpression = expression;
          let variable;
          if (declaredElement instanceof ModelicaBooleanClassInstance) {
            variable = new ModelicaBooleanVariable(
              elementName,
              varExpression,
              attributes,
              node.variability,
              declaredElement.modification?.description ?? declaredElement.description,
              causality,
              isFinal,
            );
          } else if (declaredElement instanceof ModelicaIntegerClassInstance) {
            variable = new ModelicaIntegerVariable(
              elementName,
              varExpression,
              attributes,
              node.variability,
              declaredElement.modification?.description ?? declaredElement.description,
              causality,
              isFinal,
            );
          } else if (declaredElement instanceof ModelicaRealClassInstance) {
            for (const key of ["start", "min", "max", "nominal"]) {
              if (attributes.has(key)) {
                const casted = castToReal(attributes.get(key) ?? null);
                if (casted) attributes.set(key, casted);
              }
            }
            variable = new ModelicaRealVariable(
              elementName,
              castToReal(varExpression),
              attributes,
              node.variability,
              declaredElement.modification?.description ?? declaredElement.description,
              causality,
              isFinal,
            );
          } else if (declaredElement instanceof ModelicaStringClassInstance) {
            variable = new ModelicaStringVariable(
              elementName,
              varExpression,
              attributes,
              node.variability,
              declaredElement.modification?.description ?? declaredElement.description,
              causality,
              isFinal,
            );
          } else if (declaredElement instanceof ModelicaEnumerationClassInstance) {
            variable = new ModelicaEnumerationVariable(
              elementName,
              varExpression,
              attributes,
              node.variability,
              declaredElement.modification?.description ?? declaredElement.description,
              declaredElement.enumerationLiterals,
              causality,
              isFinal,
            );
          }
          if (variable) {
            args[1].variables.push(variable);
          }
        } else {
          declaredElement?.accept(this, [elementName, args[1]]);
        }
        elementIndex++;
        if (!this.incrementIndex(index, shape)) break;
      }

      // For non-parameter arrays, emit the array-level binding as a separate equation
      // Skip if the outermost dimension is 0 (completely empty array)
      if (arrayBindingExpression && !flatBindingElements && (shape[0] ?? 0) > 0) {
        // Cast integer literals to Real when the element type is Real
        const firstElement = node.classInstance.declaredElements[0];
        const isRealArray =
          firstElement instanceof ModelicaRealClassInstance ||
          (firstElement instanceof ModelicaArrayClassInstance &&
            firstElement.elementClassInstance instanceof ModelicaRealClassInstance);
        const rhs = isRealArray
          ? (castToReal(arrayBindingExpression) ?? arrayBindingExpression)
          : arrayBindingExpression;
        // Use a RealVariable as a lightweight name-reference for the LHS.
        const lhs = new ModelicaRealVariable(name, null, new Map(), null);
        args[1].equations.push(new ModelicaSimpleEquation(lhs, rhs));
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

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaBooleanLiteral {
    return new ModelicaBooleanLiteral(node.value);
  }

  visitFunctionArgument(
    node: ModelicaFunctionArgumentSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    return node.expression?.accept(this, args) ?? null;
  }

  visitFunctionCall(
    node: ModelicaFunctionCallSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const functionName = node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
    const flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, args);
      if (flatArg) flatArgs.push(flatArg);
    }
    return new ModelicaFunctionCallExpression(functionName, flatArgs);
  }

  visitIfElseExpression(
    node: ModelicaIfElseExpressionSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const condition = node.condition?.accept(this, args);
    const thenExpr = node.expression?.accept(this, args);
    const elseExpr = node.elseExpression?.accept(this, args);
    if (!condition || !thenExpr || !elseExpr) return null;

    const elseIfClauses: { condition: ModelicaExpression; expression: ModelicaExpression }[] = [];
    for (const clause of node.elseIfExpressionClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, args);
      const clauseExpr = clause.expression?.accept(this, args);
      if (clauseCondition && clauseExpr) {
        elseIfClauses.push({ condition: clauseCondition, expression: clauseExpr });
      }
    }

    return new ModelicaIfElseExpression(condition, thenExpr, elseIfClauses, elseExpr);
  }

  visitComponentReference(
    node: ModelicaComponentReferenceSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): ModelicaExpression | null {
    const name =
      (args[0] === "" ? "" : args[0] + ".") + node.parts.map((c) => c.identifier?.text ?? "<ERROR>").join(".");
    if (args[1] instanceof ModelicaEnumerationClassInstance) {
      for (const enumerationLiteral of args[1].enumerationLiterals ?? []) {
        if (enumerationLiteral.stringValue === node.parts?.[(node.parts?.length ?? 1) - 1]?.identifier?.text)
          return enumerationLiteral;
      }
    } else {
      for (const variable of args[2].variables) {
        if (variable.name === name) return variable;
      }
      // If exact match not found, look for array element variables with this prefix
      // This handles references like x[:] or bare array name y
      const prefix = name + "[";
      const arrayElements = args[2].variables.filter((v) => v.name.startsWith(prefix));
      if (arrayElements.length > 0) {
        return new ModelicaArray([arrayElements.length], arrayElements);
      }
    }
    return null;
  }

  visitSimpleEquation(
    node: ModelicaSimpleEquationSyntaxNode,
    args: [string, ModelicaClassInstance, ModelicaDAE],
  ): null {
    let expression1 = node.expression1?.accept(this, args);
    let expression2 = node.expression2?.accept(this, args);
    if (expression1 && expression2) {
      // Expand array-to-array equations into per-element scalar equations
      if (expression1 instanceof ModelicaArray && expression2 instanceof ModelicaArray) {
        const flat1 = [...expression1.flatElements];
        const flat2 = [...expression2.flatElements];
        const count = Math.min(flat1.length, flat2.length);
        for (let i = 0; i < count; i++) {
          let e1 = flat1[i];
          let e2 = flat2[i];
          if (!e1 || !e2) continue;
          if (e1 instanceof ModelicaRealVariable) e2 = castToReal(e2) ?? e2;
          if (e2 instanceof ModelicaRealVariable) e1 = castToReal(e1) ?? e1;
          args[2].equations.push(new ModelicaSimpleEquation(e1, e2));
        }
        return null;
      }
      // Widen integers to Real when the other side is a Real variable
      if (expression1 instanceof ModelicaRealVariable) expression2 = castToReal(expression2) ?? expression2;
      if (expression2 instanceof ModelicaRealVariable) expression1 = castToReal(expression1) ?? expression1;
      args[2].equations.push(
        new ModelicaSimpleEquation(
          expression1,
          expression2,
          node.description?.strings?.map((d) => d.text ?? "")?.join(" "),
        ),
      );
    }
    return null;
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    return new ModelicaStringLiteral(node.text ?? "");
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

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaIntegerLiteral | null {
    return new ModelicaIntegerLiteral(node.value);
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaRealLiteral | null {
    return new ModelicaRealLiteral(node.value);
  }
}

function castToReal(expression: ModelicaExpression | null): ModelicaExpression | null {
  if (!expression) return null;
  if (expression instanceof ModelicaIntegerLiteral) return new ModelicaRealLiteral(expression.value);
  if (expression instanceof ModelicaArray) {
    return new ModelicaArray(
      expression.shape,
      expression.elements.map((e) => castToReal(e) as ModelicaExpression),
    );
  }
  return expression;
}
