// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Writer } from "../../util/io.js";
import {
  ModelicaArrayClassInstance,
  ModelicaClassInstance,
  ModelicaEnumerationClassInstance,
  ModelicaPredefinedClassInstance,
} from "./model.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";

type array<T> = T | array<T>[];

export class ModelicaDAE {
  name: string;
  description: string | null;
  equations: ModelicaEquation[] = [];
  variables: ModelicaVariable[] = [];

  constructor(name: string, description?: string | null) {
    this.name = name;
    this.description = description ?? null;
  }

  accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitDAE(this, argument);
  }
}

export abstract class ModelicaEquation {
  description: string | null;

  constructor(description?: string | null) {
    this.description = description ?? null;
  }

  abstract accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R;
}

export class ModelicaSimpleEquation extends ModelicaEquation {
  expression1: ModelicaExpression;
  expression2: ModelicaExpression;

  constructor(expression1: ModelicaExpression, expression2: ModelicaExpression, description?: string | null) {
    super(description);
    this.expression1 = expression1;
    this.expression2 = expression2;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleEquation(this, argument);
  }
}

export abstract class ModelicaExpression {
  abstract accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R;

  abstract toJSON(): array<boolean | number | object | string>;

  static fromClassInstance(classInstance: ModelicaClassInstance | null | undefined): ModelicaExpression | null {
    if (!classInstance) return null;
    if (!classInstance.instantiated && !classInstance.instantiating) classInstance.instantiate();
    if (classInstance instanceof ModelicaArrayClassInstance) {
      const elements: ModelicaExpression[] = [];
      for (const element of classInstance.elements ?? []) {
        if (element instanceof ModelicaClassInstance) {
          const expression = ModelicaExpression.fromClassInstance(element);
          if (expression) elements.push(expression);
        }
      }
      return new ModelicaArray(classInstance.shape, elements);
    } else if (classInstance instanceof ModelicaEnumerationClassInstance) {
      return classInstance.value;
    } else if (classInstance instanceof ModelicaPredefinedClassInstance) {
      return classInstance.expression;
    } else if (classInstance.modification?.expression instanceof ModelicaObject) {
      return classInstance.modification.expression;
    } else {
      const elements = new Map<string, ModelicaExpression>();
      for (const component of classInstance.components) {
        if (!component.name) continue;
        if (!component.instantiated && !component.instantiating) component.instantiate();
        const value = ModelicaExpression.fromClassInstance(component.classInstance);
        if (!value) continue;
        elements.set(component.name, value);
      }
      return new ModelicaObject(elements, classInstance);
    }
  }

  split(count: number): ModelicaExpression[];
  split(count: number, index: number): ModelicaExpression;
  split(): ModelicaExpression | ModelicaExpression[] {
    throw new Error("cannot split this expression");
  }
}

export abstract class ModelicaSimpleExpression extends ModelicaExpression {
  override split(count: number): ModelicaSimpleExpression[];
  override split(count: number, index: number): ModelicaSimpleExpression;
  override split(count: number, index?: number): ModelicaSimpleExpression | ModelicaSimpleExpression[] {
    if (index) {
      return this;
    } else {
      return Array(count).fill(this);
    }
  }
}

export class ModelicaUnaryExpression extends ModelicaSimpleExpression {
  operand: ModelicaExpression;
  operator: ModelicaUnaryOperator;

  constructor(operator: ModelicaUnaryOperator, operand: ModelicaSimpleExpression) {
    super();
    this.operator = operator;
    this.operand = operand;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitUnaryExpression(this, argument);
  }

  override toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }

  static new(operator: ModelicaUnaryOperator, operand: ModelicaExpression): ModelicaExpression | null {
    if (!operator || !operand) return null;
    if (operand instanceof ModelicaBooleanLiteral) {
      switch (operator) {
        case ModelicaUnaryOperator.LOGICAL_NEGATION:
          return new ModelicaBooleanLiteral(!operand.value);
        default:
          return null;
      }
    } else if (operand instanceof ModelicaIntegerLiteral) {
      switch (operator) {
        case ModelicaUnaryOperator.UNARY_MINUS:
          return new ModelicaIntegerLiteral(-operand.value);
        case ModelicaUnaryOperator.UNARY_PLUS:
          return new ModelicaIntegerLiteral(+operand.value);
        default:
          return null;
      }
    } else if (operand instanceof ModelicaRealLiteral) {
      switch (operator) {
        case ModelicaUnaryOperator.UNARY_MINUS:
          return new ModelicaRealLiteral(-operand.value);
        case ModelicaUnaryOperator.UNARY_PLUS:
          return new ModelicaRealLiteral(+operand.value);
        default:
          return null;
      }
    } else if (operand instanceof ModelicaStringLiteral) {
      return null;
    } else {
      return new ModelicaUnaryExpression(operator, operand);
    }
  }

  override split(count: number): ModelicaUnaryExpression[];
  override split(count: number, index: number): ModelicaUnaryExpression;
  override split(count: number, index?: number): ModelicaUnaryExpression | ModelicaUnaryExpression[] {
    if (index) {
      return new ModelicaUnaryExpression(this.operator, this.operand.split(count, index));
    } else {
      return this.operand
        .split(count)
        .map((splittedOperand) => new ModelicaUnaryExpression(this.operator, splittedOperand));
    }
  }
}

export class ModelicaBinaryExpression extends ModelicaSimpleExpression {
  operand1: ModelicaExpression;
  operand2: ModelicaExpression;
  operator: ModelicaBinaryOperator;

  constructor(operator: ModelicaBinaryOperator, operand1: ModelicaExpression, operand2: ModelicaExpression) {
    super();
    this.operator = operator;
    this.operand1 = operand1;
    this.operand2 = operand2;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitBinaryExpression(this, argument);
  }

  override toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }

  static new(
    operator: ModelicaBinaryOperator,
    operand1: ModelicaExpression,
    operand2: ModelicaExpression,
  ): ModelicaExpression | null {
    if (!operator || !operand1 || !operand2) return null;
    if (operand1 instanceof ModelicaBooleanLiteral) {
      if (operand2 instanceof ModelicaBooleanLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.LOGICAL_OR:
            return new ModelicaBooleanLiteral(operand1.value || operand2.value);
          case ModelicaBinaryOperator.LOGICAL_AND:
            return new ModelicaBooleanLiteral(operand1.value && operand2.value);
          case ModelicaBinaryOperator.EQUALITY:
            return new ModelicaBooleanLiteral(operand1.value !== operand2.value);
          case ModelicaBinaryOperator.INEQUALITY:
            return new ModelicaBooleanLiteral(operand1.value === operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaIntegerLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaRealLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaStringLiteral) {
        return null;
      } else {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
    } else if (operand1 instanceof ModelicaIntegerLiteral) {
      if (operand2 instanceof ModelicaBooleanLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaIntegerLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.LESS_THAN:
            return new ModelicaBooleanLiteral(operand1.value < operand2.value);
          case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value <= operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN:
            return new ModelicaBooleanLiteral(operand1.value > operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value >= operand2.value);
          case ModelicaBinaryOperator.EQUALITY:
            return new ModelicaBooleanLiteral(operand1.value == operand2.value);
          case ModelicaBinaryOperator.INEQUALITY:
            return new ModelicaBooleanLiteral(operand1.value != operand2.value);
          case ModelicaBinaryOperator.ADDITION:
            return new ModelicaIntegerLiteral(operand1.value + operand2.value);
          case ModelicaBinaryOperator.SUBTRACTION:
            return new ModelicaIntegerLiteral(operand1.value - operand2.value);
          case ModelicaBinaryOperator.MULTIPLICATION:
            return new ModelicaIntegerLiteral(operand1.value * operand2.value);
          case ModelicaBinaryOperator.DIVISION:
            return new ModelicaIntegerLiteral(operand1.value / operand2.value);
          case ModelicaBinaryOperator.EXPONENTIATION:
            return new ModelicaIntegerLiteral(operand1.value ** operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaRealLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.LESS_THAN:
            return new ModelicaBooleanLiteral(operand1.value < operand2.value);
          case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value <= operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN:
            return new ModelicaBooleanLiteral(operand1.value > operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value >= operand2.value);
          case ModelicaBinaryOperator.EQUALITY:
            return new ModelicaBooleanLiteral(operand1.value == operand2.value);
          case ModelicaBinaryOperator.INEQUALITY:
            return new ModelicaBooleanLiteral(operand1.value != operand2.value);
          case ModelicaBinaryOperator.ADDITION:
            return new ModelicaRealLiteral(operand1.value + operand2.value);
          case ModelicaBinaryOperator.SUBTRACTION:
            return new ModelicaRealLiteral(operand1.value - operand2.value);
          case ModelicaBinaryOperator.MULTIPLICATION:
            return new ModelicaRealLiteral(operand1.value * operand2.value);
          case ModelicaBinaryOperator.DIVISION:
            return new ModelicaRealLiteral(operand1.value / operand2.value);
          case ModelicaBinaryOperator.EXPONENTIATION:
            return new ModelicaRealLiteral(operand1.value ** operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaStringLiteral) {
        return null;
      } else {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
    } else if (operand1 instanceof ModelicaRealLiteral) {
      if (operand2 instanceof ModelicaBooleanLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaIntegerLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.LESS_THAN:
            return new ModelicaBooleanLiteral(operand1.value < operand2.value);
          case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value <= operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN:
            return new ModelicaBooleanLiteral(operand1.value > operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value >= operand2.value);
          case ModelicaBinaryOperator.EQUALITY:
            return new ModelicaBooleanLiteral(operand1.value == operand2.value);
          case ModelicaBinaryOperator.INEQUALITY:
            return new ModelicaBooleanLiteral(operand1.value != operand2.value);
          case ModelicaBinaryOperator.ADDITION:
            return new ModelicaRealLiteral(operand1.value + operand2.value);
          case ModelicaBinaryOperator.SUBTRACTION:
            return new ModelicaRealLiteral(operand1.value - operand2.value);
          case ModelicaBinaryOperator.MULTIPLICATION:
            return new ModelicaRealLiteral(operand1.value * operand2.value);
          case ModelicaBinaryOperator.DIVISION:
            return new ModelicaRealLiteral(operand1.value / operand2.value);
          case ModelicaBinaryOperator.EXPONENTIATION:
            return new ModelicaRealLiteral(operand1.value ** operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaRealLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.LESS_THAN:
            return new ModelicaBooleanLiteral(operand1.value < operand2.value);
          case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value <= operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN:
            return new ModelicaBooleanLiteral(operand1.value > operand2.value);
          case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
            return new ModelicaBooleanLiteral(operand1.value >= operand2.value);
          case ModelicaBinaryOperator.EQUALITY:
            return new ModelicaBooleanLiteral(operand1.value == operand2.value);
          case ModelicaBinaryOperator.INEQUALITY:
            return new ModelicaBooleanLiteral(operand1.value != operand2.value);
          case ModelicaBinaryOperator.ADDITION:
            return new ModelicaRealLiteral(operand1.value + operand2.value);
          case ModelicaBinaryOperator.SUBTRACTION:
            return new ModelicaRealLiteral(operand1.value - operand2.value);
          case ModelicaBinaryOperator.MULTIPLICATION:
            return new ModelicaRealLiteral(operand1.value * operand2.value);
          case ModelicaBinaryOperator.DIVISION:
            return new ModelicaRealLiteral(operand1.value / operand2.value);
          case ModelicaBinaryOperator.EXPONENTIATION:
            return new ModelicaRealLiteral(operand1.value ** operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaStringLiteral) {
        return null;
      } else {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
    } else if (operand1 instanceof ModelicaStringLiteral) {
      if (operand2 instanceof ModelicaBooleanLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaIntegerLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaRealLiteral) {
        return null;
      } else if (operand2 instanceof ModelicaStringLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.EQUALITY:
          case ModelicaBinaryOperator.INEQUALITY:
          case ModelicaBinaryOperator.ADDITION:
          default:
            return null;
        }
      } else {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
    } else {
      return new ModelicaBinaryExpression(operator, operand1, operand2);
    }
  }

  override split(count: number): ModelicaBinaryExpression[];
  override split(count: number, index: number): ModelicaBinaryExpression;
  override split(count: number, index?: number): ModelicaBinaryExpression | ModelicaBinaryExpression[] {
    if (index) {
      return new ModelicaBinaryExpression(
        this.operator,
        this.operand1.split(count, index),
        this.operand2.split(count, index),
      );
    } else {
      const operands1 = this.operand1.split(count);
      const operands2 = this.operand2.split(count);
      const expressions = [];
      for (let i = 0; i < count; i++) {
        const operand1 = operands1[i];
        const operand2 = operands2[i];
        if (operand1 && operand2) {
          expressions.push(new ModelicaBinaryExpression(this.operator, operand1, operand2));
        }
      }
      return expressions;
    }
  }
}

export abstract class ModelicaPrimaryExpression extends ModelicaSimpleExpression {}

export class ModelicaArray extends ModelicaPrimaryExpression {
  elements: ModelicaExpression[];
  shape: number[];

  constructor(shape: number[], elements: ModelicaExpression[]) {
    super();
    this.shape = shape;
    this.elements = elements;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitArray(this, argument);
  }

  assignable(shape: number[]): boolean {
    const flatShape = this.flatShape;
    if (flatShape.length !== shape.length) {
      return false;
    }
    for (let i = 0; i < flatShape.length; i++) {
      if (flatShape[i] !== shape[i] && (flatShape[i] ?? -1) >= 0 && (shape[i] ?? -1) >= 0) {
        return false;
      }
    }
    return true;
  }

  get flatElements(): IterableIterator<ModelicaExpression> {
    const elements = this.elements;
    return (function* () {
      for (const element of elements) {
        if (element instanceof ModelicaArray) yield* element.flatElements;
        else yield element;
      }
    })();
  }

  get flatShape(): number[] {
    const flatShape = [...this.shape];
    let element = this.elements[0];
    while (element) {
      if (element instanceof ModelicaArray) {
        flatShape.push(...element.shape);
        element = element.elements[0];
      } else {
        break;
      }
    }
    return flatShape;
  }

  getFlatElement(i: number): ModelicaExpression | null {
    let c = 0;
    for (const element of this.flatElements) {
      if (c++ === i) return element;
    }
    return null;
  }

  override split(count: number): ModelicaPrimaryExpression[];
  override split(count: number, index: number): ModelicaPrimaryExpression;
  override split(count: number, index?: number): ModelicaPrimaryExpression | ModelicaPrimaryExpression[] {
    if (this.elements.length != count) {
      const flatElements = [...this.flatElements];
      if (flatElements.length === count) {
        if (index) {
          return flatElements[index] as ModelicaPrimaryExpression;
        } else {
          return flatElements as ModelicaPrimaryExpression[];
        }
      }
      // Relaxed check: Return flatElements even if length mismatch
      console.warn(
        `Array split mismatch: elements ${flatElements.length} (flat) vs ${this.elements.length} (raw) != count ${count}. Proceeding with partial/mismatched data.`,
      );
      if (index) {
        return flatElements[index] as ModelicaPrimaryExpression;
      } else {
        return flatElements as ModelicaPrimaryExpression[];
      }
    }
    if (index) {
      const expression = this.elements[index];
      if (!expression) throw new Error();
      return expression;
    } else {
      return this.elements;
    }
  }

  override toJSON(): array<boolean | number | object | string> {
    let elements = [...this.flatElements].map((e) => e.toJSON());
    for (let i = this.shape.length - 1; i >= 1; i--) {
      const length = this.shape[i] ?? 0;
      const chunks: array<boolean | number | object | string>[] = [];
      for (let j = 0; j < elements.length; j += length) chunks.push(elements.slice(j, j + length));
      elements = chunks;
    }
    return elements;
  }
}

export class ModelicaObject extends ModelicaPrimaryExpression {
  #classInstance: ModelicaClassInstance | null;
  elements: Map<string, ModelicaExpression>;

  constructor(elements: Map<string, ModelicaExpression>, classInstance?: ModelicaClassInstance | null) {
    super();
    this.elements = elements;
    this.#classInstance = classInstance ?? null;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitObject(this, argument);
  }

  get classInstance(): ModelicaClassInstance | null {
    return this.#classInstance;
  }

  override toJSON(): object {
    return Object.assign(Object.fromEntries(this.elements.entries().map((e) => [e[0], e[1].toJSON()])), {
      "@type": this.classInstance?.name ?? undefined,
    });
  }
}

export abstract class ModelicaLiteral extends ModelicaPrimaryExpression {}

export class ModelicaBooleanLiteral extends ModelicaLiteral {
  value: boolean;

  constructor(value: boolean) {
    super();
    this.value = value;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanLiteral(this, argument);
  }

  override toJSON(): boolean {
    return this.value;
  }
}

export class ModelicaIntegerLiteral extends ModelicaLiteral {
  value: number;

  constructor(value: number) {
    super();
    this.value = value;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerLiteral(this, argument);
  }

  override toJSON(): number {
    return this.value;
  }
}

export class ModelicaRealLiteral extends ModelicaLiteral {
  value: number;

  constructor(value: number) {
    super();
    this.value = value;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitRealLiteral(this, argument);
  }

  override toJSON(): number {
    return this.value;
  }
}

export class ModelicaStringLiteral extends ModelicaLiteral {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitStringLiteral(this, argument);
  }

  override toJSON(): string {
    return this.value;
  }
}

export class ModelicaEnumerationLiteral extends ModelicaLiteral {
  ordinalValue: number;
  stringValue: string;

  constructor(ordinalValue: number, stringValue: string) {
    super();
    this.ordinalValue = ordinalValue;
    this.stringValue = stringValue;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationLiteral(this, argument);
  }

  toJSON(): string {
    return this.stringValue;
  }
}

export abstract class ModelicaVariable extends ModelicaPrimaryExpression {
  attributes: Map<string, ModelicaExpression>;
  name: string;
  description: string | null;
  expression: ModelicaExpression | null;
  variability: ModelicaVariability | null;

  constructor(
    name: string,
    expression: ModelicaExpression | null,
    attributes: Map<string, ModelicaExpression>,
    variability: ModelicaVariability | null,
    description?: string | null,
  ) {
    super();
    this.name = name;
    this.expression = expression;
    this.attributes = attributes;
    this.variability = variability;
    this.description = description ?? null;
  }
}

export class ModelicaBooleanVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanVariable(this, argument);
  }

  get fixed(): ModelicaExpression | null {
    return this.attributes.get("fixed") ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.attributes.get("quantity") ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.attributes.get("start") ?? null;
  }

  toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }
}

export class ModelicaIntegerVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerVariable(this, argument);
  }

  get fixed(): ModelicaExpression | null {
    return this.attributes.get("fixed") ?? null;
  }

  get max(): ModelicaExpression | null {
    return this.attributes.get("max") ?? null;
  }

  get min(): ModelicaExpression | null {
    return this.attributes.get("min") ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.attributes.get("quantity") ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.attributes.get("start") ?? null;
  }

  toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }
}

export class ModelicaRealVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitRealVariable(this, argument);
  }

  get displayUnit(): ModelicaExpression | null {
    return this.attributes.get("displayUnit") ?? null;
  }

  get fixed(): ModelicaExpression | null {
    return this.attributes.get("fixed") ?? null;
  }

  get max(): ModelicaExpression | null {
    return this.attributes.get("max") ?? null;
  }

  get min(): ModelicaExpression | null {
    return this.attributes.get("min") ?? null;
  }

  get nominal(): ModelicaExpression | null {
    return this.attributes.get("nominal") ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.attributes.get("quantity") ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.attributes.get("start") ?? null;
  }

  get stateSelect(): ModelicaExpression | null {
    return this.attributes.get("stateSelect") ?? null;
  }

  toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }

  get unbounded(): ModelicaExpression | null {
    return this.attributes.get("unbounded") ?? null;
  }

  get unit(): ModelicaExpression | null {
    return this.attributes.get("unit") ?? null;
  }
}

export class ModelicaStringVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitStringVariable(this, argument);
  }

  get fixed(): ModelicaExpression | null {
    return this.attributes.get("fixed") ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.attributes.get("quantity") ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.attributes.get("start") ?? null;
  }

  toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }
}

export class ModelicaEnumerationVariable extends ModelicaVariable {
  enumerationLiterals: ModelicaEnumerationLiteral[];

  constructor(
    name: string,
    expression: ModelicaExpression | null,
    attributes: Map<string, ModelicaExpression>,
    variability: ModelicaVariability | null,
    description?: string | null,
    enumerationLiterals?: ModelicaEnumerationLiteral[] | null,
  ) {
    super(name, expression, attributes, variability, description);
    this.enumerationLiterals = enumerationLiterals ?? [];
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationVariable(this, argument);
  }

  get fixed(): ModelicaExpression | null {
    return this.attributes.get("fixed") ?? null;
  }

  get max(): ModelicaExpression | null {
    return this.attributes.get("max") ?? null;
  }

  get min(): ModelicaExpression | null {
    return this.attributes.get("min") ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.attributes.get("quantity") ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.attributes.get("start") ?? null;
  }

  toJSON(): array<boolean | number | object | string> {
    throw new Error();
  }
}

export interface IModelicaDAEVisitor<R, A> {
  visitArray(node: ModelicaArray, argument?: A): R;

  visitBinaryExpression(node: ModelicaBinaryExpression, argument?: A): R;

  visitBooleanLiteral(node: ModelicaBooleanLiteral, argument?: A): R;

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): R;

  visitDAE(node: ModelicaDAE, argument?: A): R;

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral, argument?: A): R;

  visitEnumerationVariable(node: ModelicaEnumerationVariable, argument?: A): R;

  visitIntegerLiteral(node: ModelicaIntegerLiteral, argument?: A): R;

  visitIntegerVariable(node: ModelicaIntegerVariable, argument?: A): R;

  visitObject(node: ModelicaObject, argument?: A): R;

  visitRealLiteral(node: ModelicaRealLiteral, argument?: A): R;

  visitRealVariable(node: ModelicaRealVariable, argument?: A): R;

  visitSimpleEquation(node: ModelicaSimpleEquation, argument?: A): R;

  visitStringLiteral(node: ModelicaStringLiteral, argument?: A): R;

  visitStringVariable(node: ModelicaStringVariable, argument?: A): R;

  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): R;
}

export abstract class ModelicaDAEVisitor<A> implements IModelicaDAEVisitor<void, A> {
  visitArray(node: ModelicaArray, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitBinaryExpression(node: ModelicaBinaryExpression, argument?: A): void {
    node.operand1.accept(this, argument);
    node.operand2.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBooleanLiteral(node: ModelicaBooleanLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): void {}

  visitDAE(node: ModelicaDAE, argument?: A): void {
    for (const variable of node.variables) variable.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitEnumerationLiteral(node: ModelicaEnumerationLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitEnumerationVariable(node: ModelicaEnumerationVariable, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIntegerLiteral(node: ModelicaIntegerLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIntegerVariable(node: ModelicaIntegerVariable, argument?: A): void {}

  visitObject(node: ModelicaObject, argument?: A): void {
    for (const element of node.elements.values()) element.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitRealLiteral(node: ModelicaRealLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitRealVariable(node: ModelicaRealVariable, argument?: A): void {}

  visitSimpleEquation(node: ModelicaSimpleEquation, argument?: A): void {
    node.expression1.accept(this, argument);
    node.expression2.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitStringLiteral(node: ModelicaStringLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitStringVariable(node: ModelicaStringVariable, argument?: A): void {}

  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): void {
    node.operand.accept(this, argument);
  }
}

export class ModelicaDAEPrinter extends ModelicaDAEVisitor<never> {
  out: Writer;

  constructor(out: Writer) {
    super();
    this.out = out;
  }

  visitArray(node: ModelicaArray): void {
    this.out.write("{");
    for (let i = 0; i < node.elements.length; i++) {
      node.elements[i]?.accept(this);
      if (i < node.elements.length - 1) this.out.write(", ");
    }
    this.out.write("}");
  }

  visitBinaryExpression(node: ModelicaBinaryExpression): void {
    this.out.write("(");
    node.operand1.accept(this);
    this.out.write(" " + node.operator + " ");
    node.operand2.accept(this);
    this.out.write(")");
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteral): void {
    this.out.write(String(node.value));
  }

  visitBooleanVariable(node: ModelicaBooleanVariable): void {
    this.out.write(node.name);
  }

  visitDAE(node: ModelicaDAE): void {
    this.out.write("class " + node.name);
    if (node.description) this.out.write(' "' + node.description + '"');
    this.out.write("\n");
    for (const variable of node.variables) {
      this.out.write("  ");
      if (variable.variability) this.out.write(variable.variability + " ");
      if (variable instanceof ModelicaBooleanVariable) {
        this.out.write("Boolean ");
      } else if (variable instanceof ModelicaIntegerVariable) {
        this.out.write("Integer ");
      } else if (variable instanceof ModelicaRealVariable) {
        this.out.write("Real ");
      } else if (variable instanceof ModelicaStringVariable) {
        this.out.write("String ");
      } else if (variable instanceof ModelicaEnumerationVariable) {
        this.out.write(
          "enumeration(" + variable.enumerationLiterals.map((e) => '"' + e.stringValue + '"').join(", ") + ") ",
        );
      } else {
        throw new Error("invalid variable");
      }
      this.out.write(variable.name);
      if (variable.attributes.size > 0) {
        this.out.write("(");
        let i = 0;
        for (const entry of variable.attributes.entries()) {
          this.out.write(entry[0] + " = ");
          entry[1].accept(this);
          if (++i < variable.attributes.size) this.out.write(", ");
        }
        this.out.write(")");
      }
      if (variable.expression) {
        this.out.write(" = ");
        variable.expression.accept(this);
      }
      if (variable.description) this.out.write(' "' + variable.description + '"');
      this.out.write(";\n");
    }
    if (node.equations.length > 0) {
      this.out.write("equation\n");
      for (const equation of node.equations) equation.accept(this);
    }
    this.out.write("end " + node.name + ";");
  }

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral): void {
    this.out.write(String('"' + node.stringValue + '"'));
  }

  visitEnumerationVariable(node: ModelicaEnumerationVariable): void {
    this.out.write(String(node.name));
  }

  visitIntegerLiteral(node: ModelicaIntegerLiteral): void {
    this.out.write(String(node.value));
  }

  visitIntegerVariable(node: ModelicaIntegerVariable): void {
    this.out.write(node.name);
  }

  visitObject(node: ModelicaObject): void {
    this.out.write("{");
    let i = 0;
    for (const entry of node.elements.entries()) {
      this.out.write('"' + entry[0] + '": ');
      entry[1].accept(this);
      if (i++ < Object.keys(node.elements).length - 1) this.out.write(", ");
    }
    this.out.write("}");
  }

  visitRealLiteral(node: ModelicaRealLiteral): void {
    if (Number.isInteger(node.value)) {
      this.out.write(node.value.toFixed(1));
    } else {
      this.out.write(node.value.toString());
    }
  }

  visitRealVariable(node: ModelicaRealVariable): void {
    this.out.write(node.name);
  }

  visitSimpleEquation(node: ModelicaSimpleEquation): void {
    this.out.write("  ");
    node.expression1.accept(this);
    this.out.write(" = ");
    node.expression2.accept(this);
    if (node.description) this.out.write(' "' + node.description + '"');
    this.out.write(";\n");
  }

  visitStringLiteral(node: ModelicaStringLiteral): void {
    this.out.write(node.value);
  }

  visitStringVariable(node: ModelicaStringVariable): void {
    this.out.write(node.name);
  }

  visitUnaryExpression(node: ModelicaUnaryExpression): void {
    this.out.write("(" + node.operator);
    node.operand.accept(this);
    this.out.write(")");
  }
}
