// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "./syntax.js";

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
}

export abstract class ModelicaSimpleExpression extends ModelicaExpression {}

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
}

export abstract class ModelicaVariable extends ModelicaPrimaryExpression {
  name: string;
  description: string | null;
  value: ModelicaExpression | null;

  constructor(name: string, value: ModelicaExpression | null, description?: string | null) {
    super();
    this.name = name;
    this.description = description ?? null;
    this.value = value;
  }
}

export class ModelicaBooleanVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanVariable(this, argument);
  }
}

export class ModelicaIntegerVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerVariable(this, argument);
  }
}

export class ModelicaRealVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitRealVariable(this, argument);
  }
}

export class ModelicaStringVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitStringVariable(this, argument);
  }
}

export class ModelicaEnumerationVariable extends ModelicaVariable {
  enumerationLiterals: ModelicaEnumerationLiteral[];

  constructor(
    name: string,
    enumerationLiterals: ModelicaEnumerationLiteral[] | null,
    value: ModelicaExpression | null,
    description?: string | null,
  ) {
    super(name, value, description);
    this.enumerationLiterals = enumerationLiterals ?? [];
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationVariable(this, argument);
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

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): void {
    node.value?.accept(this, argument);
  }

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

  visitIntegerVariable(node: ModelicaIntegerVariable, argument?: A): void {
    node.value?.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitRealLiteral(node: ModelicaRealLiteral, argument?: A): void {}

  visitRealVariable(node: ModelicaRealVariable, argument?: A): void {
    node.value?.accept(this, argument);
  }

  visitSimpleEquation(node: ModelicaSimpleEquation, argument?: A): void {
    node.expression1.accept(this, argument);
    node.expression2.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitStringLiteral(node: ModelicaStringLiteral, argument?: A): void {}

  visitStringVariable(node: ModelicaStringVariable, argument?: A): void {
    node.value?.accept(this, argument);
  }

  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): void {
    node.operand.accept(this, argument);
  }
}

export class ModelicaDAEPrinter extends ModelicaDAEVisitor<never> {
  visitArray(node: ModelicaArray): void {
    process.stdout.write("{");
    for (let i = 0; i < node.elements.length; i++) {
      node.elements[i]?.accept(this);
      if (i < node.elements.length - 1) process.stdout.write(", ");
    }
    process.stdout.write("}");
  }

  visitBinaryExpression(node: ModelicaBinaryExpression): void {
    process.stdout.write("(");
    node.operand1.accept(this);
    process.stdout.write(" " + node.operator + " ");
    node.operand2.accept(this);
    process.stdout.write(")");
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteral): void {
    process.stdout.write(String(node.value));
  }

  visitBooleanVariable(node: ModelicaBooleanVariable): void {
    process.stdout.write(node.name);
  }

  visitDAE(node: ModelicaDAE): void {
    process.stdout.write("class " + node.name);
    if (node.description) process.stdout.write(' "' + node.description + '"');
    console.log("");
    for (const variable of node.variables) {
      if (variable instanceof ModelicaBooleanVariable) {
        process.stdout.write("  Boolean ");
      } else if (variable instanceof ModelicaIntegerVariable) {
        process.stdout.write("  Integer ");
      } else if (variable instanceof ModelicaRealVariable) {
        process.stdout.write("  Real ");
      } else if (variable instanceof ModelicaStringVariable) {
        process.stdout.write("  String ");
      } else if (variable instanceof ModelicaEnumerationVariable) {
        process.stdout.write(
          "  enumeration(" + variable.enumerationLiterals.map((e) => '"' + e.stringValue + '"').join(", ") + ") ",
        );
      } else {
        throw new Error("invalid variable");
      }
      process.stdout.write(variable.name);
      if (variable.value) {
        process.stdout.write(" = ");
        variable.value.accept(this);
      }
      if (variable.description) process.stdout.write(' "' + variable.description + '"');
      console.log(";");
    }
    console.log("equation");
    for (const equation of node.equations) equation.accept(this);
    console.log("end " + node.name + ";");
  }

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral): void {
    process.stdout.write(String('"' + node.stringValue + '"'));
  }

  visitEnumerationVariable(node: ModelicaEnumerationVariable): void {
    process.stdout.write(String(node.name));
  }

  visitIntegerLiteral(node: ModelicaIntegerLiteral): void {
    process.stdout.write(String(node.value));
  }

  visitIntegerVariable(node: ModelicaIntegerVariable): void {
    process.stdout.write(node.name);
  }

  visitRealLiteral(node: ModelicaRealLiteral): void {
    process.stdout.write(String(node.value));
  }

  visitRealVariable(node: ModelicaRealVariable): void {
    process.stdout.write(node.name);
  }

  visitSimpleEquation(node: ModelicaSimpleEquation): void {
    process.stdout.write("  ");
    node.expression1.accept(this);
    process.stdout.write(" = ");
    node.expression2.accept(this);
    if (node.description) process.stdout.write(' "' + node.description + '"');
    console.log(";");
  }

  visitStringLiteral(node: ModelicaStringLiteral): void {
    process.stdout.write(node.value);
  }

  visitStringVariable(node: ModelicaStringVariable): void {
    process.stdout.write(node.name);
  }

  visitUnaryExpression(node: ModelicaUnaryExpression): void {
    process.stdout.write("(" + node.operator);
    node.operand.accept(this);
    process.stdout.write(")");
  }
}
