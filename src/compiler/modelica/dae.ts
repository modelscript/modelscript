// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ModelicaBinaryOperator, ModelicaUnaryOperator } from "./syntax.js";

export class ModelicaDAE {
  name: string;
  equations: ModelicaEquation[] = [];
  variables: ModelicaVariable[] = [];

  constructor(name: string) {
    this.name = name;
  }

  accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitDAE(this, argument);
  }
}

export abstract class ModelicaEquation {
  abstract accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R;
}

export class ModelicaSimpleEquation extends ModelicaEquation {
  expression1: ModelicaSimpleExpression;
  expression2: ModelicaExpression;

  constructor(expression1: ModelicaSimpleExpression, expression2: ModelicaExpression) {
    super();
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
  operand: ModelicaSimpleExpression;
  operator: ModelicaUnaryOperator;

  constructor(operator: ModelicaUnaryOperator, operand: ModelicaSimpleExpression) {
    super();
    this.operator = operator;
    this.operand = operand;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitUnaryExpression(this, argument);
  }
}

export class ModelicaBinaryExpression extends ModelicaSimpleExpression {
  operand1: ModelicaSimpleExpression;
  operand2: ModelicaSimpleExpression;
  operator: ModelicaBinaryOperator;

  constructor(
    operator: ModelicaBinaryOperator,
    operand1: ModelicaSimpleExpression,
    operand2: ModelicaSimpleExpression,
  ) {
    super();
    this.operator = operator;
    this.operand1 = operand1;
    this.operand2 = operand2;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitBinaryExpression(this, argument);
  }
}

export abstract class ModelicaPrimaryExpression extends ModelicaSimpleExpression {}

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

export abstract class ModelicaVariable extends ModelicaPrimaryExpression {
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
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

export interface IModelicaDAEVisitor<R, A> {
  visitBinaryExpression(node: ModelicaBinaryExpression, argument?: A): R;

  visitBooleanLiteral(node: ModelicaBooleanLiteral, argument?: A): R;

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): R;

  visitDAE(node: ModelicaDAE, argument?: A): R;

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
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBinaryExpression(node: ModelicaBinaryExpression, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBooleanLiteral(node: ModelicaBooleanLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): void {}

  visitDAE(node: ModelicaDAE, argument?: A): void {
    for (const variable of node.variables) variable.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIntegerLiteral(node: ModelicaIntegerLiteral, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIntegerVariable(node: ModelicaIntegerVariable, argument?: A): void {}

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

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): void {}
}

export class ModelicaDAEPrinter extends ModelicaDAEVisitor<never> {
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
    console.log("class " + node.name);
    for (const variable of node.variables) {
      if (variable instanceof ModelicaBooleanVariable) {
        console.log("  Boolean " + variable.name + ";");
      } else if (variable instanceof ModelicaIntegerVariable) {
        console.log("  Integer " + variable.name + ";");
      } else if (variable instanceof ModelicaRealVariable) {
        console.log("  Real " + variable.name + ";");
      } else if (variable instanceof ModelicaStringVariable) {
        console.log("  String " + variable.name + ";");
      }
    }
    console.log("equation");
    for (const equation of node.equations) equation.accept(this);
    console.log("end " + node.name + ";");
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
