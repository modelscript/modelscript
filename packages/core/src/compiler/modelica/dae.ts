// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

import { createHash } from "../../util/hash.js";
import type { Writer } from "../../util/io.js";
import type { JSONValue, Triple } from "../../util/types.js";
import {
  ModelicaArrayClassInstance,
  ModelicaClassInstance,
  ModelicaEnumerationClassInstance,
  ModelicaPredefinedClassInstance,
} from "./model.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";

export class ModelicaDAE {
  name: string;
  description: string | null;
  classKind = "class";
  equations: ModelicaEquation[] = [];
  algorithms: ModelicaStatement[][] = [];
  /** Equations from `initial equation` sections. */
  initialEquations: ModelicaEquation[] = [];
  /** Algorithm sections from `initial algorithm` sections. */
  initialAlgorithms: ModelicaStatement[][] = [];
  variables: ModelicaVariable[] = [];
  /** Flattened function definitions referenced by equations/algorithms. */
  functions: ModelicaDAE[] = [];
  /** External function declaration text (e.g. `external "C" ...`). */
  externalDecl: string | null = null;

  constructor(name: string, description?: string | null) {
    this.name = name;
    this.description = description ?? null;
  }

  accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitDAE(this, argument);
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name);
    for (const fn of this.functions) hash.update(fn.hash);
    for (const variable of this.variables) {
      hash.update(variable.hash);
    }
    for (const equation of this.equations) {
      hash.update(equation.hash);
    }
    for (const section of this.algorithms) {
      for (const stmt of section) hash.update(stmt.hash);
    }
    return hash.digest("hex");
  }

  get toJSON(): JSONValue {
    return {
      "@type": "DAE",
      name: this.name,
      description: this.description,
      functions: this.functions.map((f) => f.toJSON),
      variables: this.variables.map((v) => v.toJSON),
      equations: this.equations.map((e) => e.toJSON),
      algorithms: this.algorithms.map((section) => section.map((s) => s.toJSON)),
    };
  }

  get toRDF(): Triple[] {
    const triples: Triple[] = [];
    const id = `_:dae_${this.name}`;
    triples.push({ s: id, p: "rdf:type", o: "modelica:DAE" });
    triples.push({ s: id, p: "modelica:name", o: this.name });
    if (this.description) triples.push({ s: id, p: "modelica:description", o: this.description });
    for (const variable of this.variables) {
      triples.push({ s: id, p: "modelica:variable", o: `_:var_${variable.name}` });
      triples.push(...variable.toRDF);
    }
    for (let i = 0; i < this.equations.length; i++) {
      const eq = this.equations[i];
      if (!eq) continue;
      const eqId = `_:eq_${i}`;
      triples.push({ s: id, p: "modelica:equation", o: eqId });
      triples.push(...eq.toRDF);
    }
    return triples;
  }

  /**
   * Identify the continuous state variables (Real variables without a variability
   * qualifier such as constant/parameter/discrete).
   */
  get stateVariables(): ModelicaRealVariable[] {
    return this.variables.filter(
      (v): v is ModelicaRealVariable => v instanceof ModelicaRealVariable && v.variability === null,
    );
  }

  /**
   * Identify derivative variables — those whose names match `der(...)`.
   */
  get derivativeVariables(): ModelicaRealVariable[] {
    return this.variables.filter(
      (v): v is ModelicaRealVariable => v instanceof ModelicaRealVariable && v.name.startsWith("der("),
    );
  }

  /**
   * Compute the derivatives of the DAE system at a given time for the given
   * state variable values.
   *
   * @param time        The current simulation time.
   * @param stateValues A `Map` from state variable name to its current numeric value.
   * @returns           A `Map` from state variable name to its time derivative (`der(name)`).
   *
   * The method works by building a value environment from the supplied states
   * and any parameter/constant bindings, then evaluating every equation in the
   * DAE.  For equations of the form `der(x) = expr`, the right-hand side is
   * evaluated to produce the derivative.  More complex implicit equations
   * (F(x, der(x)) = 0) are not yet supported and will be skipped.
   */
  computeDerivatives(time: number, stateValues: Map<string, number>): Map<string, number> {
    // Build the value environment
    const env = new Map<string, number>();
    env.set("time", time);

    // Populate state values
    for (const [name, value] of stateValues) {
      env.set(name, value);
    }

    // Populate parameters and constants from their binding expressions
    for (const variable of this.variables) {
      if (
        variable.variability === ModelicaVariability.PARAMETER ||
        variable.variability === ModelicaVariability.CONSTANT
      ) {
        if (variable.expression) {
          const value = evaluateExpression(variable.expression, env);
          if (value !== null) env.set(variable.name, value);
        }
      }
    }

    // Evaluate equations to extract derivative values.
    // For each equation of the form:  lhs = rhs
    //   - If lhs is der(x), compute rhs
    //   - If rhs is der(x), compute lhs
    const derivatives = new Map<string, number>();

    for (const equation of this.equations) {
      if (!(equation instanceof ModelicaSimpleEquation)) continue;
      const lhsDer = extractDerName(equation.expression1);
      const rhsDer = extractDerName(equation.expression2);

      if (lhsDer) {
        const value = evaluateExpression(equation.expression2, env);
        if (value !== null) {
          derivatives.set(lhsDer, value);
          env.set(`der(${lhsDer})`, value);
        }
      } else if (rhsDer) {
        const value = evaluateExpression(equation.expression1, env);
        if (value !== null) {
          derivatives.set(rhsDer, value);
          env.set(`der(${rhsDer})`, value);
        }
      }
    }

    return derivatives;
  }
}

export abstract class ModelicaEquation {
  description: string | null;

  constructor(description?: string | null) {
    this.description = description ?? null;
  }

  abstract accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R;

  abstract get hash(): string;

  abstract get toJSON(): JSONValue;

  abstract get toRDF(): Triple[];
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.expression1.hash);
    hash.update("=");
    hash.update(this.expression2.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "SimpleEquation",
      expression1: this.expression1.toJSON,
      expression2: this.expression2.toJSON,
      description: this.description,
    };
  }

  override get toRDF(): Triple[] {
    const id = `_:eq_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:SimpleEquation" },
      { s: id, p: "modelica:expression1", o: `_:expr_${this.expression1.hash.substring(0, 8)}` },
      { s: id, p: "modelica:expression2", o: `_:expr_${this.expression2.hash.substring(0, 8)}` },
      ...this.expression1.toRDF,
      ...this.expression2.toRDF,
    ];
  }
}

export class ModelicaForEquation extends ModelicaEquation {
  indexName: string;
  range: ModelicaExpression;
  equations: ModelicaEquation[];

  constructor(indexName: string, range: ModelicaExpression, equations: ModelicaEquation[]) {
    super();
    this.indexName = indexName;
    this.range = range;
    this.equations = equations;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitForEquation(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("for");
    hash.update(this.indexName);
    hash.update(this.range.hash);
    for (const eq of this.equations) hash.update(eq.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "ForEquation",
      indexName: this.indexName,
      range: this.range.toJSON,
      equations: this.equations.map((e) => e.toJSON),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export interface ModelicaElseIfClause {
  condition: ModelicaExpression;
  equations: ModelicaEquation[];
}

export class ModelicaIfEquation extends ModelicaEquation {
  condition: ModelicaExpression;
  equations: ModelicaEquation[];
  elseIfClauses: ModelicaElseIfClause[];
  elseEquations: ModelicaEquation[];

  constructor(
    condition: ModelicaExpression,
    equations: ModelicaEquation[],
    elseIfClauses: ModelicaElseIfClause[],
    elseEquations: ModelicaEquation[],
  ) {
    super();
    this.condition = condition;
    this.equations = equations;
    this.elseIfClauses = elseIfClauses;
    this.elseEquations = elseEquations;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitIfEquation(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("if");
    hash.update(this.condition.hash);
    for (const eq of this.equations) hash.update(eq.hash);
    for (const clause of this.elseIfClauses) {
      hash.update(clause.condition.hash);
      for (const eq of clause.equations) hash.update(eq.hash);
    }
    for (const eq of this.elseEquations) hash.update(eq.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "IfEquation",
      condition: this.condition.toJSON,
      equations: this.equations.map((e) => e.toJSON),
      elseIfClauses: this.elseIfClauses.map((c) => ({
        condition: c.condition.toJSON,
        equations: c.equations.map((e) => e.toJSON),
      })),
      elseEquations: this.elseEquations.map((e) => e.toJSON),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export interface ModelicaElseWhenClause {
  condition: ModelicaExpression;
  equations: ModelicaEquation[];
}

export class ModelicaWhenEquation extends ModelicaEquation {
  condition: ModelicaExpression;
  equations: ModelicaEquation[];
  elseWhenClauses: ModelicaElseWhenClause[];

  constructor(condition: ModelicaExpression, equations: ModelicaEquation[], elseWhenClauses: ModelicaElseWhenClause[]) {
    super();
    this.condition = condition;
    this.equations = equations;
    this.elseWhenClauses = elseWhenClauses;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenEquation(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("when");
    hash.update(this.condition.hash);
    for (const eq of this.equations) hash.update(eq.hash);
    for (const clause of this.elseWhenClauses) {
      hash.update(clause.condition.hash);
      for (const eq of clause.equations) hash.update(eq.hash);
    }
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "WhenEquation",
      condition: this.condition.toJSON,
      equations: this.equations.map((e) => e.toJSON),
      elseWhenClauses: this.elseWhenClauses.map((c) => ({
        condition: c.condition.toJSON,
        equations: c.equations.map((e) => e.toJSON),
      })),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export abstract class ModelicaStatement {
  abstract accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R;
  abstract get hash(): string;
  abstract get toJSON(): JSONValue;
  abstract get toRDF(): Triple[];
}

export class ModelicaAssignmentStatement extends ModelicaStatement {
  target: ModelicaExpression;
  source: ModelicaExpression;

  constructor(target: ModelicaExpression, source: ModelicaExpression) {
    super();
    this.target = target;
    this.source = source;
  }

  accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitAssignmentStatement(this, argument);
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("assign");
    hash.update(this.target.hash);
    hash.update(this.source.hash);
    return hash.digest("hex");
  }

  get toJSON(): JSONValue {
    return {
      "@type": "AssignmentStatement",
      target: this.target.toJSON,
      source: this.source.toJSON,
    };
  }

  get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaForStatement extends ModelicaStatement {
  indexName: string;
  range: ModelicaExpression;
  statements: ModelicaStatement[];

  constructor(indexName: string, range: ModelicaExpression, statements: ModelicaStatement[]) {
    super();
    this.indexName = indexName;
    this.range = range;
    this.statements = statements;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitForStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("for_stmt");
    hash.update(this.indexName);
    hash.update(this.range.hash);
    for (const s of this.statements) hash.update(s.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "ForStatement",
      indexName: this.indexName,
      range: this.range.toJSON,
      statements: this.statements.map((s) => s.toJSON),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaWhileStatement extends ModelicaStatement {
  condition: ModelicaExpression;
  statements: ModelicaStatement[];

  constructor(condition: ModelicaExpression, statements: ModelicaStatement[]) {
    super();
    this.condition = condition;
    this.statements = statements;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitWhileStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("while_stmt");
    hash.update(this.condition.hash);
    for (const s of this.statements) hash.update(s.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "WhileStatement",
      condition: this.condition.toJSON,
      statements: this.statements.map((s) => s.toJSON),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaReturnStatement extends ModelicaStatement {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitReturnStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("return_stmt");
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "ReturnStatement",
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaBreakStatement extends ModelicaStatement {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitBreakStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("break_stmt");
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "BreakStatement",
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaProcedureCallStatement extends ModelicaStatement {
  constructor(public call: ModelicaFunctionCallExpression) {
    super();
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitProcedureCallStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("procedure_call");
    hash.update(this.call.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "ProcedureCallStatement",
      call: this.call.toJSON,
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaComplexAssignmentStatement extends ModelicaStatement {
  constructor(
    public targets: (ModelicaExpression | null)[],
    public source: ModelicaExpression,
  ) {
    super();
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitComplexAssignmentStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("complex_assign");
    for (const target of this.targets) {
      if (target) hash.update(target.hash);
      else hash.update("null");
    }
    hash.update(this.source.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "ComplexAssignmentStatement",
      targets: this.targets.map((t) => t?.toJSON ?? null),
      source: this.source.toJSON,
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export interface ModelicaElseIfStatementClause {
  condition: ModelicaExpression;
  statements: ModelicaStatement[];
}

export class ModelicaIfStatement extends ModelicaStatement {
  condition: ModelicaExpression;
  statements: ModelicaStatement[];
  elseIfClauses: ModelicaElseIfStatementClause[];
  elseStatements: ModelicaStatement[];

  constructor(
    condition: ModelicaExpression,
    statements: ModelicaStatement[],
    elseIfClauses: ModelicaElseIfStatementClause[],
    elseStatements: ModelicaStatement[],
  ) {
    super();
    this.condition = condition;
    this.statements = statements;
    this.elseIfClauses = elseIfClauses;
    this.elseStatements = elseStatements;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitIfStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("if_stmt");
    hash.update(this.condition.hash);
    for (const s of this.statements) hash.update(s.hash);
    for (const clause of this.elseIfClauses) {
      hash.update(clause.condition.hash);
      for (const s of clause.statements) hash.update(s.hash);
    }
    for (const s of this.elseStatements) hash.update(s.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "IfStatement",
      condition: this.condition.toJSON,
      statements: this.statements.map((s) => s.toJSON),
      elseIfClauses: this.elseIfClauses.map((c) => ({
        condition: c.condition.toJSON,
        statements: c.statements.map((s) => s.toJSON),
      })),
      elseStatements: this.elseStatements.map((s) => s.toJSON),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export interface ModelicaElseWhenStatementClause {
  condition: ModelicaExpression;
  statements: ModelicaStatement[];
}

export class ModelicaWhenStatement extends ModelicaStatement {
  condition: ModelicaExpression;
  statements: ModelicaStatement[];
  elseWhenClauses: ModelicaElseWhenStatementClause[];

  constructor(
    condition: ModelicaExpression,
    statements: ModelicaStatement[],
    elseWhenClauses: ModelicaElseWhenStatementClause[],
  ) {
    super();
    this.condition = condition;
    this.statements = statements;
    this.elseWhenClauses = elseWhenClauses;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenStatement(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("when_stmt");
    hash.update(this.condition.hash);
    for (const s of this.statements) hash.update(s.hash);
    for (const clause of this.elseWhenClauses) {
      hash.update(clause.condition.hash);
      for (const s of clause.statements) hash.update(s.hash);
    }
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "WhenStatement",
      condition: this.condition.toJSON,
      statements: this.statements.map((s) => s.toJSON),
      elseWhenClauses: this.elseWhenClauses.map((c) => ({
        condition: c.condition.toJSON,
        statements: c.statements.map((s) => s.toJSON),
      })),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export abstract class ModelicaExpression {
  abstract accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R;

  abstract get hash(): string;

  abstract get toJSON(): JSONValue;

  abstract get toRDF(): Triple[];

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
    } else if (!classInstance.abstractSyntaxNode && classInstance.modification?.expression) {
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.operator);
    hash.update(this.operand.hash);
    return hash.digest("hex");
  }

  override get toJSON(): string {
    return `${this.operator}${this.operand.toJSON}`;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:UnaryExpression" },
      { s: id, p: "modelica:operator", o: this.operator },
      { s: id, p: "modelica:operand", o: `_:expr_${this.operand.hash.substring(0, 8)}` },
      ...this.operand.toRDF,
    ];
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.operator);
    hash.update(this.operand1.hash);
    hash.update(this.operand2.hash);
    return hash.digest("hex");
  }

  override get toJSON(): string {
    return `${this.operand1.toJSON}${this.operator}${this.operand2.toJSON}`;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:BinaryExpression" },
      { s: id, p: "modelica:operator", o: this.operator },
      { s: id, p: "modelica:operand1", o: `_:expr_${this.operand1.hash.substring(0, 8)}` },
      { s: id, p: "modelica:operand2", o: `_:expr_${this.operand2.hash.substring(0, 8)}` },
      ...this.operand1.toRDF,
      ...this.operand2.toRDF,
    ];
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

/** A symbolic name expression (e.g. loop variable i, j) */
export class ModelicaNameExpression extends ModelicaPrimaryExpression {
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitNameExpression(this, argument);
  }

  override get hash(): string {
    return createHash("sha256").update("name").update(this.name).digest("hex");
  }

  override get toJSON(): JSONValue {
    return { "@type": "NameExpression", name: this.name };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

/** A range expression like 1:4 or 1:2:10 */
export class ModelicaRangeExpression extends ModelicaSimpleExpression {
  start: ModelicaExpression;
  step: ModelicaExpression | null;
  end: ModelicaExpression;

  constructor(start: ModelicaExpression, end: ModelicaExpression, step?: ModelicaExpression | null) {
    super();
    this.start = start;
    this.end = end;
    this.step = step ?? null;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitRangeExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("range");
    hash.update(this.start.hash);
    if (this.step) hash.update(this.step.hash);
    hash.update(this.end.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "RangeExpression",
      start: this.start.toJSON,
      step: this.step?.toJSON ?? null,
      end: this.end.toJSON,
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

/** The colon `:` expression representing a whole-dimension slice */
export class ModelicaColonExpression extends ModelicaPrimaryExpression {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitColonExpression(this, argument);
  }

  override get hash(): string {
    return createHash("sha256").update("colon").digest("hex");
  }

  override get toJSON(): JSONValue {
    return { "@type": "ColonExpression" };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

/** A subscripted expression like z[j, i, :] */
export class ModelicaSubscriptedExpression extends ModelicaPrimaryExpression {
  base: ModelicaExpression;
  subscripts: ModelicaExpression[];

  constructor(base: ModelicaExpression, subscripts: ModelicaExpression[]) {
    super();
    this.base = base;
    this.subscripts = subscripts;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitSubscriptedExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("subscripted");
    hash.update(this.base.hash);
    for (const s of this.subscripts) hash.update(s.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "SubscriptedExpression",
      base: this.base.toJSON,
      subscripts: this.subscripts.map((s) => s.toJSON),
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

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

  override get hash(): string {
    const hash = createHash("sha256");
    for (const dim of this.shape) {
      hash.update(dim.toString());
    }
    for (const element of this.elements) {
      hash.update(element.hash);
    }
    return hash.digest("hex");
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

  override get toJSON(): JSONValue {
    let elements: JSONValue = [...this.flatElements].map((e) => e.toJSON);
    for (let i = this.shape.length - 1; i >= 1; i--) {
      const length = this.shape[i] ?? 0;
      const chunks: JSONValue[] = [];
      for (let j = 0; j < elements.length; j += length) chunks.push(elements.slice(j, j + length));
      elements = chunks;
    }
    return elements;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:Array" },
      { s: id, p: "modelica:shape", o: JSON.stringify(this.shape) },
    ];
    for (const element of this.elements) {
      const elemId = `_:expr_${element.hash.substring(0, 8)}`;
      triples.push({ s: id, p: "modelica:element", o: elemId });
      triples.push(...element.toRDF);
    }
    return triples;
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

  override get hash(): string {
    const hash = createHash("sha256");
    const sortedKeys = Array.from(this.elements.keys()).sort();
    for (const key of sortedKeys) {
      hash.update(key);
      hash.update(this.elements.get(key)?.hash ?? "");
    }
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return Object.assign(Object.fromEntries(Array.from(this.elements.entries()).map(([k, v]) => [k, v.toJSON])), {
      "@type": this.classInstance?.name ?? undefined,
    });
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    const triples: Triple[] = [{ s: id, p: "rdf:type", o: "modelica:Object" }];
    if (this.classInstance?.name) {
      triples.push({ s: id, p: "modelica:type", o: this.classInstance.name });
    }
    for (const [key, value] of this.elements.entries()) {
      const valId = `_:expr_${value.hash.substring(0, 8)}`;
      triples.push({ s: id, p: `modelica:${key}`, o: valId });
      triples.push(...value.toRDF);
    }
    return triples;
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(String(this.value));
    return hash.digest("hex");
  }

  override get toJSON(): boolean {
    return this.value;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:BooleanLiteral" },
      { s: id, p: "modelica:value", o: this.value },
    ];
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(String(this.value));
    return hash.digest("hex");
  }

  override get toJSON(): number {
    return this.value;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:IntegerLiteral" },
      { s: id, p: "modelica:value", o: this.value },
    ];
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(String(this.value));
    return hash.digest("hex");
  }

  override get toJSON(): number {
    return this.value;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:RealLiteral" },
      { s: id, p: "modelica:value", o: this.value },
    ];
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(String(this.value));
    return hash.digest("hex");
  }

  override get toJSON(): string {
    return this.value;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:StringLiteral" },
      { s: id, p: "modelica:value", o: this.value },
    ];
  }
}

export class ModelicaEnumerationLiteral extends ModelicaLiteral {
  ordinalValue: number;
  stringValue: string;
  description: string | null;
  typeName: string | null;

  constructor(ordinalValue: number, stringValue: string, description?: string | null, typeName?: string | null) {
    super();
    this.ordinalValue = ordinalValue;
    this.stringValue = stringValue;
    this.description = description ?? null;
    this.typeName = typeName ?? null;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationLiteral(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(String(this.ordinalValue));
    hash.update(this.stringValue);
    return hash.digest("hex");
  }

  override get toJSON(): string {
    return this.stringValue;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:EnumerationLiteral" },
      { s: id, p: "modelica:value", o: this.stringValue },
      { s: id, p: "modelica:ordinal", o: this.ordinalValue },
    ];
  }
}

export class ModelicaIfElseExpression extends ModelicaExpression {
  condition: ModelicaExpression;
  thenExpression: ModelicaExpression;
  elseIfClauses: { condition: ModelicaExpression; expression: ModelicaExpression }[];
  elseExpression: ModelicaExpression;

  constructor(
    condition: ModelicaExpression,
    thenExpression: ModelicaExpression,
    elseIfClauses: { condition: ModelicaExpression; expression: ModelicaExpression }[],
    elseExpression: ModelicaExpression,
  ) {
    super();
    this.condition = condition;
    this.thenExpression = thenExpression;
    this.elseIfClauses = elseIfClauses;
    this.elseExpression = elseExpression;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitIfElseExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("ifelse");
    hash.update(this.condition.hash);
    hash.update(this.thenExpression.hash);
    for (const clause of this.elseIfClauses) {
      hash.update(clause.condition.hash);
      hash.update(clause.expression.hash);
    }
    hash.update(this.elseExpression.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return null;
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaFunctionCallExpression extends ModelicaExpression {
  functionName: string;
  args: ModelicaExpression[];

  constructor(functionName: string, args: ModelicaExpression[]) {
    super();
    this.functionName = functionName;
    this.args = args;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCallExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("funccall");
    hash.update(this.functionName);
    for (const arg of this.args) hash.update(arg.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return null;
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export abstract class ModelicaVariable extends ModelicaPrimaryExpression {
  attributes: Map<string, ModelicaExpression>;
  name: string;
  description: string | null;
  expression: ModelicaExpression | null;
  variability: ModelicaVariability | null;
  causality: string | null;
  isFinal: boolean;
  isProtected: boolean;

  constructor(
    name: string,
    expression: ModelicaExpression | null,
    attributes: Map<string, ModelicaExpression>,
    variability: ModelicaVariability | null,
    description?: string | null,
    causality?: string | null,
    isFinal?: boolean,
    isProtected?: boolean,
  ) {
    super();
    this.name = name;
    this.expression = expression;
    this.attributes = attributes;
    this.variability = variability;
    this.description = description ?? null;
    this.causality = causality ?? null;
    this.isFinal = isFinal ?? false;
    this.isProtected = isProtected ?? false;
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name);
    hash.update(this.variability?.toString() ?? "");
    hash.update(this.expression?.hash ?? "");
    const sortedKeys = Array.from(this.attributes.keys()).sort();
    for (const key of sortedKeys) {
      hash.update(key);
      hash.update(this.attributes.get(key)?.hash ?? "");
    }
    return hash.digest("hex");
  }

  abstract override get toJSON(): JSONValue;

  abstract override get toRDF(): Triple[];
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

  override get toJSON(): string {
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:BooleanVariable" },
      { s: id, p: "modelica:name", o: this.name },
    ];
    if (this.expression) {
      triples.push({ s: id, p: "modelica:expression", o: `_:expr_${this.expression.hash.substring(0, 8)}` });
      triples.push(...this.expression.toRDF);
    }
    return triples;
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

  override get toJSON(): string {
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:IntegerVariable" },
      { s: id, p: "modelica:name", o: this.name },
    ];
    if (this.expression) {
      triples.push({ s: id, p: "modelica:expression", o: `_:expr_${this.expression.hash.substring(0, 8)}` });
      triples.push(...this.expression.toRDF);
    }
    return triples;
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

  override get toJSON(): string {
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:RealVariable" },
      { s: id, p: "modelica:name", o: this.name },
    ];
    if (this.expression) {
      triples.push({ s: id, p: "modelica:expression", o: `_:expr_${this.expression.hash.substring(0, 8)}` });
      triples.push(...this.expression.toRDF);
    }
    return triples;
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

  override get toJSON(): string {
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:StringVariable" },
      { s: id, p: "modelica:name", o: this.name },
    ];
    if (this.expression) {
      triples.push({ s: id, p: "modelica:expression", o: `_:expr_${this.expression.hash.substring(0, 8)}` });
      triples.push(...this.expression.toRDF);
    }
    return triples;
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
    causality?: string | null,
    isFinal?: boolean,
    isProtected?: boolean,
  ) {
    super(name, expression, attributes, variability, description, causality, isFinal, isProtected);
    this.enumerationLiterals = enumerationLiterals ?? [];
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationVariable(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(super.hash);
    for (const literal of this.enumerationLiterals) {
      hash.update(literal.hash);
    }
    return hash.digest("hex");
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

  override get toJSON(): string {
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:EnumerationVariable" },
      { s: id, p: "modelica:name", o: this.name },
    ];
    if (this.expression) {
      triples.push({ s: id, p: "modelica:expression", o: `_:expr_${this.expression.hash.substring(0, 8)}` });
      triples.push(...this.expression.toRDF);
    }
    return triples;
  }
}

// ── Helper functions for computeDerivatives ───────────────────────────

/**
 * If the expression is a variable reference whose name matches `der(...)`,
 * return the inner variable name.  Otherwise return `null`.
 */
function extractDerName(expression: ModelicaExpression): string | null {
  if (
    expression instanceof ModelicaRealVariable &&
    expression.name.startsWith("der(") &&
    expression.name.endsWith(")")
  ) {
    return expression.name.slice(4, -1);
  }
  return null;
}

/**
 * Recursively evaluate a `ModelicaExpression` to a numeric value using
 * the supplied variable environment.  Returns `null` when the expression
 * cannot be evaluated (e.g. unknown variable, unsupported node type).
 */
function evaluateExpression(expression: ModelicaExpression, env: Map<string, number>): number | null {
  if (expression instanceof ModelicaRealLiteral) {
    return expression.value;
  }
  if (expression instanceof ModelicaIntegerLiteral) {
    return expression.value;
  }
  if (expression instanceof ModelicaBooleanLiteral) {
    return expression.value ? 1 : 0;
  }
  if (expression instanceof ModelicaRealVariable || expression instanceof ModelicaIntegerVariable) {
    const value = env.get(expression.name);
    return value !== undefined ? value : null;
  }
  if (expression instanceof ModelicaUnaryExpression) {
    const operand = evaluateExpression(expression.operand, env);
    if (operand === null) return null;
    switch (expression.operator) {
      case ModelicaUnaryOperator.UNARY_MINUS:
      case ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS:
        return -operand;
      case ModelicaUnaryOperator.UNARY_PLUS:
      case ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS:
        return operand;
      default:
        return null;
    }
  }
  if (expression instanceof ModelicaBinaryExpression) {
    const left = evaluateExpression(expression.operand1, env);
    const right = evaluateExpression(expression.operand2, env);
    if (left === null || right === null) return null;
    switch (expression.operator) {
      case ModelicaBinaryOperator.ADDITION:
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        return left + right;
      case ModelicaBinaryOperator.SUBTRACTION:
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        return left - right;
      case ModelicaBinaryOperator.MULTIPLICATION:
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        return left * right;
      case ModelicaBinaryOperator.DIVISION:
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        return right !== 0 ? left / right : null;
      case ModelicaBinaryOperator.EXPONENTIATION:
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
        return left ** right;
      default:
        return null;
    }
  }
  return null;
}

export interface IModelicaDAEVisitor<R, A> {
  visitArray(node: ModelicaArray, argument?: A): R;

  visitBinaryExpression(node: ModelicaBinaryExpression, argument?: A): R;

  visitAssignmentStatement(node: ModelicaAssignmentStatement, argument?: A): R;

  visitBreakStatement(node: ModelicaBreakStatement, argument?: A): R;

  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatement, argument?: A): R;

  visitForStatement(node: ModelicaForStatement, argument?: A): R;

  visitIfStatement(node: ModelicaIfStatement, argument?: A): R;

  visitProcedureCallStatement(node: ModelicaProcedureCallStatement, argument?: A): R;

  visitReturnStatement(node: ModelicaReturnStatement, argument?: A): R;

  visitWhenStatement(node: ModelicaWhenStatement, argument?: A): R;

  visitWhileStatement(node: ModelicaWhileStatement, argument?: A): R;

  visitBooleanLiteral(node: ModelicaBooleanLiteral, argument?: A): R;

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): R;

  visitColonExpression(node: ModelicaColonExpression, argument?: A): R;

  visitDAE(node: ModelicaDAE, argument?: A): R;

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral, argument?: A): R;

  visitEnumerationVariable(node: ModelicaEnumerationVariable, argument?: A): R;

  visitForEquation(node: ModelicaForEquation, argument?: A): R;

  visitFunctionCallExpression(node: ModelicaFunctionCallExpression, argument?: A): R;

  visitIfElseExpression(node: ModelicaIfElseExpression, argument?: A): R;

  visitIfEquation(node: ModelicaIfEquation, argument?: A): R;

  visitIntegerLiteral(node: ModelicaIntegerLiteral, argument?: A): R;

  visitIntegerVariable(node: ModelicaIntegerVariable, argument?: A): R;

  visitNameExpression(node: ModelicaNameExpression, argument?: A): R;

  visitObject(node: ModelicaObject, argument?: A): R;

  visitRangeExpression(node: ModelicaRangeExpression, argument?: A): R;

  visitRealLiteral(node: ModelicaRealLiteral, argument?: A): R;

  visitRealVariable(node: ModelicaRealVariable, argument?: A): R;

  visitSimpleEquation(node: ModelicaSimpleEquation, argument?: A): R;

  visitSubscriptedExpression(node: ModelicaSubscriptedExpression, argument?: A): R;

  visitStringLiteral(node: ModelicaStringLiteral, argument?: A): R;

  visitStringVariable(node: ModelicaStringVariable, argument?: A): R;

  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): R;

  visitWhenEquation(node: ModelicaWhenEquation, argument?: A): R;
}

export abstract class ModelicaDAEVisitor<A> implements IModelicaDAEVisitor<void, A> {
  visitAssignmentStatement(node: ModelicaAssignmentStatement, argument?: A): void {
    node.target.accept(this, argument);
    node.source.accept(this, argument);
  }

  visitBreakStatement(node: ModelicaBreakStatement, argument?: A): void {
    /* no-op */
  }

  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatement, argument?: A): void {
    for (const target of node.targets) {
      if (target) target.accept(this, argument);
    }
    node.source.accept(this, argument);
  }

  visitForStatement(node: ModelicaForStatement, argument?: A): void {
    node.range.accept(this, argument);
    for (const stmt of node.statements) stmt.accept(this, argument);
  }

  visitIfStatement(node: ModelicaIfStatement, argument?: A): void {
    node.condition.accept(this, argument);
    for (const stmt of node.statements) stmt.accept(this, argument);
    for (const clause of node.elseIfClauses) {
      clause.condition.accept(this, argument);
      for (const stmt of clause.statements) stmt.accept(this, argument);
    }
    for (const stmt of node.elseStatements) stmt.accept(this, argument);
  }

  visitProcedureCallStatement(node: ModelicaProcedureCallStatement, argument?: A): void {
    node.call.accept(this, argument);
  }

  visitReturnStatement(node: ModelicaReturnStatement, argument?: A): void {
    /* no-op */
  }

  visitWhenStatement(node: ModelicaWhenStatement, argument?: A): void {
    node.condition.accept(this, argument);
    for (const stmt of node.statements) stmt.accept(this, argument);
    for (const clause of node.elseWhenClauses) {
      clause.condition.accept(this, argument);
      for (const stmt of clause.statements) stmt.accept(this, argument);
    }
  }

  visitWhileStatement(node: ModelicaWhileStatement, argument?: A): void {
    node.condition.accept(this, argument);
    for (const stmt of node.statements) stmt.accept(this, argument);
  }

  visitArray(node: ModelicaArray, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitBinaryExpression(node: ModelicaBinaryExpression, argument?: A): void {
    node.operand1.accept(this, argument);
    node.operand2.accept(this, argument);
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteral, argument?: A): void {
    /* no-op */
  }

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): void {
    /* no-op */
  }

  visitColonExpression(node: ModelicaColonExpression, argument?: A): void {
    /* no-op */
  }

  visitDAE(node: ModelicaDAE, argument?: A): void {
    for (const variable of node.variables) variable.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
  }

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral, argument?: A): void {
    /* no-op */
  }

  visitEnumerationVariable(node: ModelicaEnumerationVariable, argument?: A): void {
    /* no-op */
  }

  visitForEquation(node: ModelicaForEquation, argument?: A): void {
    node.range.accept(this, argument);
    for (const eq of node.equations) eq.accept(this, argument);
  }

  visitFunctionCallExpression(node: ModelicaFunctionCallExpression, argument?: A): void {
    for (const arg of node.args) arg.accept(this, argument);
  }

  visitIfEquation(node: ModelicaIfEquation, argument?: A): void {
    node.condition.accept(this, argument);
    for (const eq of node.equations) eq.accept(this, argument);
    for (const clause of node.elseIfClauses) {
      clause.condition.accept(this, argument);
      for (const eq of clause.equations) eq.accept(this, argument);
    }
    for (const eq of node.elseEquations) eq.accept(this, argument);
  }

  visitIfElseExpression(node: ModelicaIfElseExpression, argument?: A): void {
    node.condition.accept(this, argument);
    node.thenExpression.accept(this, argument);
    for (const clause of node.elseIfClauses) {
      clause.condition.accept(this, argument);
      clause.expression.accept(this, argument);
    }
    node.elseExpression.accept(this, argument);
  }

  visitIntegerLiteral(node: ModelicaIntegerLiteral, argument?: A): void {
    /* no-op */
  }

  visitIntegerVariable(node: ModelicaIntegerVariable, argument?: A): void {
    /* no-op */
  }

  visitNameExpression(node: ModelicaNameExpression, argument?: A): void {
    /* no-op */
  }

  visitObject(node: ModelicaObject, argument?: A): void {
    for (const element of node.elements.values()) element.accept(this, argument);
  }

  visitRangeExpression(node: ModelicaRangeExpression, argument?: A): void {
    node.start.accept(this, argument);
    if (node.step) node.step.accept(this, argument);
    node.end.accept(this, argument);
  }

  visitRealLiteral(node: ModelicaRealLiteral, argument?: A): void {
    /* no-op */
  }

  visitRealVariable(node: ModelicaRealVariable, argument?: A): void {
    /* no-op */
  }

  visitSimpleEquation(node: ModelicaSimpleEquation, argument?: A): void {
    node.expression1.accept(this, argument);
    node.expression2.accept(this, argument);
  }

  visitStringLiteral(node: ModelicaStringLiteral, argument?: A): void {
    /* no-op */
  }

  visitStringVariable(node: ModelicaStringVariable, argument?: A): void {
    /* no-op */
  }

  visitSubscriptedExpression(node: ModelicaSubscriptedExpression, argument?: A): void {
    node.base.accept(this, argument);
    for (const s of node.subscripts) s.accept(this, argument);
  }

  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): void {
    node.operand.accept(this, argument);
  }

  visitWhenEquation(node: ModelicaWhenEquation, argument?: A): void {
    node.condition.accept(this, argument);
    for (const eq of node.equations) eq.accept(this, argument);
    for (const clause of node.elseWhenClauses) {
      clause.condition.accept(this, argument);
      for (const eq of clause.equations) eq.accept(this, argument);
    }
  }
}

export class ModelicaDAEPrinter extends ModelicaDAEVisitor<never> {
  out: Writer;
  #depth = 0;

  constructor(out: Writer) {
    super();
    this.out = out;
  }

  private indent(): string {
    return "  ".repeat(this.#depth + 1);
  }

  visitArray(node: ModelicaArray): void {
    // If elements are already nested (sub-arrays), or shape is 1D, print directly
    if (node.shape.length <= 1 || node.elements.some((e) => e instanceof ModelicaArray)) {
      this.out.write("{");
      for (let i = 0; i < node.elements.length; i++) {
        node.elements[i]?.accept(this);
        if (i < node.elements.length - 1) this.out.write(", ");
      }
      this.out.write("}");
      return;
    }

    // Reconstruct nested structure from flat elements + multi-dimensional shape
    const innerSize = node.shape.slice(1).reduce((a, b) => a * b, 1);
    this.out.write("{");
    for (let r = 0; r < (node.shape[0] ?? 0); r++) {
      if (r > 0) this.out.write(", ");
      const row = new ModelicaArray(node.shape.slice(1), node.elements.slice(r * innerSize, (r + 1) * innerSize));
      this.visitArray(row);
    }
    this.out.write("}");
  }

  visitAssignmentStatement(node: ModelicaAssignmentStatement): void {
    this.out.write(this.indent());
    node.target.accept(this);
    this.out.write(" := ");
    node.source.accept(this);
    this.out.write(";\n");
  }

  visitBreakStatement(node: ModelicaBreakStatement): void {
    this.out.write(this.indent() + "break;\n");
  }

  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatement): void {
    this.out.write(this.indent() + "(");
    for (let i = 0; i < node.targets.length; i++) {
      if (i > 0) this.out.write(", ");
      const target = node.targets[i];
      if (target) target.accept(this);
    }
    this.out.write(") := ");
    node.source.accept(this);
    this.out.write(";\n");
  }

  visitForStatement(node: ModelicaForStatement): void {
    this.out.write(this.indent() + "for " + node.indexName + " in ");
    node.range.accept(this);
    this.out.write(" loop\n");
    this.#depth++;
    for (const stmt of node.statements) {
      stmt.accept(this);
    }
    this.#depth--;
    this.out.write(this.indent() + "end for;\n");
  }

  visitWhileStatement(node: ModelicaWhileStatement): void {
    this.out.write(this.indent() + "while ");
    node.condition.accept(this);
    this.out.write(" loop\n");
    this.#depth++;
    for (const stmt of node.statements) {
      stmt.accept(this);
    }
    this.#depth--;
    this.out.write(this.indent() + "end while;\n");
  }

  visitIfStatement(node: ModelicaIfStatement): void {
    this.out.write(this.indent() + "if ");
    node.condition.accept(this);
    this.out.write(" then\n");
    this.#depth++;
    for (const stmt of node.statements) {
      stmt.accept(this);
    }
    this.#depth--;
    for (const clause of node.elseIfClauses) {
      this.out.write(this.indent() + "elseif ");
      clause.condition.accept(this);
      this.out.write(" then\n");
      this.#depth++;
      for (const stmt of clause.statements) {
        stmt.accept(this);
      }
      this.#depth--;
    }
    if (node.elseStatements.length > 0) {
      this.out.write(this.indent() + "else\n");
      this.#depth++;
      for (const stmt of node.elseStatements) {
        stmt.accept(this);
      }
      this.#depth--;
    }
    this.out.write(this.indent() + "end if;\n");
  }

  visitProcedureCallStatement(node: ModelicaProcedureCallStatement): void {
    this.out.write(this.indent());
    node.call.accept(this);
    this.out.write(";\n");
  }

  visitReturnStatement(node: ModelicaReturnStatement): void {
    this.out.write(this.indent() + "return;\n");
  }

  visitWhenStatement(node: ModelicaWhenStatement): void {
    this.out.write(this.indent() + "when ");
    node.condition.accept(this);
    this.out.write(" then\n");
    this.#depth++;
    for (const stmt of node.statements) {
      stmt.accept(this);
    }
    this.#depth--;
    for (const clause of node.elseWhenClauses) {
      this.out.write(this.indent() + "elsewhen ");
      clause.condition.accept(this);
      this.out.write(" then\n");
      this.#depth++;
      for (const stmt of clause.statements) {
        stmt.accept(this);
      }
      this.#depth--;
    }
    this.out.write(this.indent() + "end when;\n");
  }

  visitBinaryExpression(node: ModelicaBinaryExpression): void {
    // Parenthesize unary negation operands in multiplicative/power contexts
    // In Modelica, -a * b means -(a*b), so (-a) * b needs explicit parentheses
    const needsNegParens =
      node.operator === ModelicaBinaryOperator.MULTIPLICATION ||
      node.operator === ModelicaBinaryOperator.DIVISION ||
      node.operator === ModelicaBinaryOperator.EXPONENTIATION ||
      node.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION ||
      node.operator === ModelicaBinaryOperator.ELEMENTWISE_DIVISION ||
      node.operator === ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION;
    if (
      needsNegParens &&
      node.operand1 instanceof ModelicaUnaryExpression &&
      node.operand1.operator === ModelicaUnaryOperator.UNARY_MINUS
    ) {
      this.out.write("(");
      node.operand1.accept(this);
      this.out.write(")");
    } else {
      node.operand1.accept(this);
    }
    this.out.write(" " + node.operator + " ");
    if (
      needsNegParens &&
      node.operand2 instanceof ModelicaUnaryExpression &&
      node.operand2.operator === ModelicaUnaryOperator.UNARY_MINUS
    ) {
      this.out.write("(");
      node.operand2.accept(this);
      this.out.write(")");
    } else {
      node.operand2.accept(this);
    }
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteral): void {
    this.out.write(String(node.value));
  }

  visitBooleanVariable(node: ModelicaBooleanVariable): void {
    this.out.write(node.name);
  }

  #emitVariable(variable: ModelicaVariable): void {
    this.out.write("  ");
    if (variable.isProtected) this.out.write("protected ");
    if (variable.isFinal) this.out.write("final ");
    if (variable.variability) this.out.write(variable.variability + " ");
    if (variable.causality) this.out.write(variable.causality + " ");
    if (variable instanceof ModelicaBooleanVariable) {
      this.out.write("Boolean ");
    } else if (variable instanceof ModelicaIntegerVariable) {
      this.out.write("Integer ");
    } else if (variable instanceof ModelicaRealVariable) {
      this.out.write("Real ");
    } else if (variable instanceof ModelicaStringVariable) {
      this.out.write("String ");
    } else if (variable instanceof ModelicaEnumerationVariable) {
      this.out.write("enumeration(" + variable.enumerationLiterals.map((e) => e.stringValue).join(", ") + ") ");
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

  visitDAE(node: ModelicaDAE): void {
    // Emit function definitions before the class
    for (const fn of node.functions) {
      this.#emitFunction(fn);
      this.out.write("\n\n");
    }
    this.out.write(node.classKind + " " + node.name);
    if (node.description) this.out.write(' "' + node.description + '"');
    this.out.write("\n");
    for (const variable of node.variables) {
      this.#emitVariable(variable);
    }
    if (node.equations.length > 0) {
      this.out.write("equation\n");
      for (const equation of node.equations) equation.accept(this);
    }
    for (const section of node.algorithms) {
      this.out.write("algorithm\n");
      for (const stmt of section) stmt.accept(this);
    }
    if (node.initialEquations.length > 0) {
      this.out.write("initial equation\n");
      for (const equation of node.initialEquations) equation.accept(this);
    }
    for (const section of node.initialAlgorithms) {
      this.out.write("initial algorithm\n");
      for (const stmt of section) stmt.accept(this);
    }
    this.out.write("end " + node.name + ";");
  }

  #emitFunction(fn: ModelicaDAE): void {
    this.out.write(fn.classKind + " " + fn.name);
    if (fn.description) this.out.write(' "' + fn.description + '"');
    this.out.write("\n");
    for (const variable of fn.variables) {
      this.#emitVariable(variable);
    }
    if (fn.equations.length > 0) {
      this.out.write("equation\n");
      for (const equation of fn.equations) equation.accept(this);
    }
    for (const section of fn.algorithms) {
      this.out.write("algorithm\n");
      for (const stmt of section) stmt.accept(this);
    }
    if (fn.externalDecl) {
      this.out.write("  " + fn.externalDecl + "\n");
    }
    this.out.write("end " + fn.name + ";");
  }

  visitColonExpression(): void {
    this.out.write(":");
  }

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral): void {
    if (node.typeName) {
      this.out.write(node.typeName + "." + node.stringValue);
    } else {
      this.out.write(String('"' + node.stringValue + '"'));
    }
  }

  visitEnumerationVariable(node: ModelicaEnumerationVariable): void {
    this.out.write(String(node.name));
  }

  visitForEquation(node: ModelicaForEquation): void {
    this.out.write("  for " + node.indexName + " in ");
    node.range.accept(this);
    this.out.write(" loop\n");
    for (const eq of node.equations) {
      this.out.write("  ");
      eq.accept(this);
    }
    this.out.write("  end for;\n");
  }

  visitFunctionCallExpression(node: ModelicaFunctionCallExpression): void {
    this.out.write(node.functionName + "(");
    for (let i = 0; i < node.args.length; i++) {
      if (i > 0) this.out.write(", ");
      node.args[i]?.accept(this);
    }
    this.out.write(")");
  }

  visitIfEquation(node: ModelicaIfEquation): void {
    this.out.write("  if ");
    node.condition.accept(this);
    this.out.write(" then\n");
    for (const eq of node.equations) {
      this.out.write("  ");
      eq.accept(this);
    }
    for (const clause of node.elseIfClauses) {
      this.out.write("  elseif ");
      clause.condition.accept(this);
      this.out.write(" then\n");
      for (const eq of clause.equations) {
        this.out.write("  ");
        eq.accept(this);
      }
    }
    if (node.elseEquations.length > 0) {
      this.out.write("  else\n");
      for (const eq of node.elseEquations) {
        this.out.write("  ");
        eq.accept(this);
      }
    }
    this.out.write("  end if;\n");
  }

  visitIfElseExpression(node: ModelicaIfElseExpression): void {
    this.out.write("if ");
    node.condition.accept(this);
    this.out.write(" then ");
    node.thenExpression.accept(this);
    for (const clause of node.elseIfClauses) {
      this.out.write(" elseif ");
      clause.condition.accept(this);
      this.out.write(" then ");
      clause.expression.accept(this);
    }
    this.out.write(" else ");
    node.elseExpression.accept(this);
  }

  visitIntegerLiteral(node: ModelicaIntegerLiteral): void {
    this.out.write(String(node.value));
  }

  visitIntegerVariable(node: ModelicaIntegerVariable): void {
    this.out.write(node.name);
  }

  visitNameExpression(node: ModelicaNameExpression): void {
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

  visitRangeExpression(node: ModelicaRangeExpression): void {
    node.start.accept(this);
    this.out.write(":");
    if (node.step) {
      node.step.accept(this);
      this.out.write(":");
    }
    node.end.accept(this);
  }

  visitRealLiteral(node: ModelicaRealLiteral): void {
    // Modelica uses e308 not e+308; strip the + from positive exponents
    if (node.value === 0) {
      this.out.write("0.0");
    } else if (Number.isInteger(node.value) && Math.abs(node.value) < 1e15) {
      // Small integers: use toFixed(1) to ensure decimal point (e.g. 3 -> 3.0)
      this.out.write(node.value.toFixed(1));
    } else {
      // Large numbers or fractional: format with full precision
      // For very large integers, toString() doesn't use sci notation, so use toExponential
      let str: string;
      if (Number.isInteger(node.value) && Math.abs(node.value) >= 1e15) {
        str = node.value.toExponential();
      } else {
        str = node.value.toString();
      }
      this.out.write(str.replace("e+", "e"));
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
    this.out.write('"' + node.value + '"');
  }

  visitStringVariable(node: ModelicaStringVariable): void {
    this.out.write(node.name);
  }

  visitSubscriptedExpression(node: ModelicaSubscriptedExpression): void {
    node.base.accept(this);
    this.out.write("[");
    for (let i = 0; i < node.subscripts.length; i++) {
      if (i > 0) this.out.write(", ");
      node.subscripts[i]?.accept(this);
    }
    this.out.write("]");
  }

  visitUnaryExpression(node: ModelicaUnaryExpression): void {
    const sep = /[a-z]/i.test(node.operator) ? " " : "";
    this.out.write(node.operator + sep);
    node.operand.accept(this);
  }

  visitWhenEquation(node: ModelicaWhenEquation): void {
    this.out.write("  when ");
    node.condition.accept(this);
    this.out.write(" then\n");
    for (const eq of node.equations) {
      this.out.write("  ");
      eq.accept(this);
    }
    for (const clause of node.elseWhenClauses) {
      this.out.write("  elsewhen ");
      clause.condition.accept(this);
      this.out.write(" then\n");
      for (const eq of clause.equations) {
        this.out.write("  ");
        eq.accept(this);
      }
    }
    this.out.write("  end when;\n");
  }
}
