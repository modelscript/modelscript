// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

import { createHash } from "../../util/hash.js";
import type { Writer } from "../../util/io.js";
import type { JSONValue, Triple } from "../../util/types.js";
import type { ModelicaDiagnostic } from "./errors.js";
import {
  ModelicaArrayClassInstance,
  ModelicaClassInstance,
  ModelicaEnumerationClassInstance,
  ModelicaPredefinedClassInstance,
} from "./model.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";

export interface SourceLocation {
  filePath?: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * O(1) variable lookup table that wraps a flat ModelicaVariable[] array with
 * Map-based indices.  Three access patterns are supported:
 *
 * 1. **Exact name**: `get(name)`, `has(name)`
 * 2. **Array root prefix**: `getArrayElements("x")` returns all `x[1]`, `x[2,3]`, …
 * 3. **Encoded suffix**: `getEncoded("y")` returns the variable whose name is `\0…\0y`
 *
 * The backing array preserves insertion order for serialization and test output.
 */
export class SymbolTable {
  /** Ordered backing array — preserved for serialization / iteration. */
  private _items: ModelicaVariable[] = [];

  /** Exact name → variable. */
  private _byName = new Map<string, ModelicaVariable>();

  /** Array root name → indexed element variables (e.g. "x" → [x[1], x[2], …]). */
  private _byArrayRoot = new Map<string, ModelicaVariable[]>();

  /** Decoded suffix → encoded variable (for `\0prefix\0suffix` naming). */
  private _byEncodedSuffix = new Map<string, ModelicaVariable>();

  // ── Exact-match lookups ──

  get(name: string): ModelicaVariable | undefined {
    return this._byName.get(name);
  }

  has(name: string): boolean {
    return this._byName.has(name);
  }

  // ── Array-prefix lookups ──

  getArrayElements(baseName: string): ModelicaVariable[] {
    return this._byArrayRoot.get(baseName) ?? [];
  }

  hasArrayElements(baseName: string): boolean {
    return this._byArrayRoot.has(baseName);
  }

  // ── Encoded (\0) variable lookups ──

  getEncoded(decodedName: string): ModelicaVariable | undefined {
    return this._byEncodedSuffix.get(decodedName);
  }

  // ── Mutation ──

  push(variable: ModelicaVariable): void {
    this._items.push(variable);
    this._indexVariable(variable);
  }

  remove(variable: ModelicaVariable): void {
    const idx = this._items.indexOf(variable);
    if (idx >= 0) {
      this._items.splice(idx, 1);
      this._deindexVariable(variable);
    }
  }

  bulkRemove(varSet: Set<ModelicaVariable>): void {
    this._items = this._items.filter((v) => !varSet.has(v));
    // Rebuild indices fully — cheaper than N individual deindex calls
    this._rebuildIndices();
  }

  // ── Array-compatible interface ──

  get length(): number {
    return this._items.length;
  }

  /** Direct indexed access. */
  at(index: number): ModelicaVariable | undefined {
    return this._items[index];
  }

  /** Return the backing array (read-only view for iteration/serialization). */
  toArray(): readonly ModelicaVariable[] {
    return this._items;
  }

  /** Replace the entire contents (used when bulk-assigning `dae.variables = filtered`). */
  replaceAll(items: ModelicaVariable[]): void {
    this._items = items;
    this._rebuildIndices();
  }

  // Delegate array-like methods to the backing array
  filter(predicate: (v: ModelicaVariable, i: number, arr: ModelicaVariable[]) => boolean): ModelicaVariable[] {
    return this._items.filter(predicate);
  }

  some(predicate: (v: ModelicaVariable, i: number, arr: ModelicaVariable[]) => boolean): boolean {
    return this._items.some(predicate);
  }

  find(predicate: (v: ModelicaVariable, i: number, arr: ModelicaVariable[]) => boolean): ModelicaVariable | undefined {
    return this._items.find(predicate);
  }

  findIndex(predicate: (v: ModelicaVariable, i: number, arr: ModelicaVariable[]) => boolean): number {
    return this._items.findIndex(predicate);
  }

  forEach(callbackfn: (value: ModelicaVariable, index: number, array: ModelicaVariable[]) => void): void {
    this._items.forEach(callbackfn);
  }

  map<T>(callbackfn: (value: ModelicaVariable, index: number, array: ModelicaVariable[]) => T): T[] {
    return this._items.map(callbackfn);
  }

  every(predicate: (v: ModelicaVariable, i: number, arr: ModelicaVariable[]) => boolean): boolean {
    return this._items.every(predicate);
  }

  slice(start?: number, end?: number): ModelicaVariable[] {
    return this._items.slice(start, end);
  }

  sort(compareFn: (a: ModelicaVariable, b: ModelicaVariable) => number): this {
    this._items.sort(compareFn);
    return this;
  }

  splice(start: number, deleteCount: number): ModelicaVariable[] {
    const removed = this._items.splice(start, deleteCount);
    for (const v of removed) this._deindexVariable(v);
    return removed;
  }

  indexOf(variable: ModelicaVariable): number {
    return this._items.indexOf(variable);
  }

  [Symbol.iterator](): IterableIterator<ModelicaVariable> {
    return this._items[Symbol.iterator]();
  }

  // ── Private index management ──

  private _indexVariable(v: ModelicaVariable): void {
    this._byName.set(v.name, v);

    // Array root index: "foo[1,2]" → root "foo"
    const bracketIdx = v.name.indexOf("[");
    if (bracketIdx > 0) {
      const root = v.name.substring(0, bracketIdx);
      let arr = this._byArrayRoot.get(root);
      if (!arr) {
        arr = [];
        this._byArrayRoot.set(root, arr);
      }
      arr.push(v);
    }

    // Encoded variable index: "\0prefix\0suffix" → suffix
    if (v.name.startsWith("\0")) {
      const lastNull = v.name.lastIndexOf("\0");
      if (lastNull > 0) {
        const suffix = v.name.substring(lastNull + 1);
        this._byEncodedSuffix.set(suffix, v);
      }
    }
  }

  private _deindexVariable(v: ModelicaVariable): void {
    this._byName.delete(v.name);

    const bracketIdx = v.name.indexOf("[");
    if (bracketIdx > 0) {
      const root = v.name.substring(0, bracketIdx);
      const arr = this._byArrayRoot.get(root);
      if (arr) {
        const idx = arr.indexOf(v);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) this._byArrayRoot.delete(root);
      }
    }

    if (v.name.startsWith("\0")) {
      const lastNull = v.name.lastIndexOf("\0");
      if (lastNull > 0) {
        const suffix = v.name.substring(lastNull + 1);
        this._byEncodedSuffix.delete(suffix);
      }
    }
  }

  private _rebuildIndices(): void {
    this._byName.clear();
    this._byArrayRoot.clear();
    this._byEncodedSuffix.clear();
    for (const v of this._items) {
      this._indexVariable(v);
    }
  }
}

export class ModelicaDAE {
  name: string;
  description: string | null;
  classKind = "class";
  equations: ModelicaEquation[] = [];
  /** Equations sorted by BLT transformation for simulation. */
  sortedEquations: ModelicaEquation[] = [];
  algorithms: ModelicaStatement[][] = [];
  /** Equations from `initial equation` sections. */
  initialEquations: ModelicaEquation[] = [];
  /** Algorithm sections from `initial algorithm` sections. */
  initialAlgorithms: ModelicaStatement[][] = [];
  /** Algebraic loops (SCCs) detected during flattening. */
  algebraicLoops: { variables: string[]; equations: ModelicaEquation[] }[] = [];
  variables: SymbolTable = new SymbolTable();
  stateMachines: ModelicaStateMachine[] = [];
  /** Clock partitions identified by the synchronous clock inference pass. */
  clockPartitions: ModelicaClockPartition[] = [];
  /** Flattened function definitions referenced by equations/algorithms. */
  functions: ModelicaDAE[] = [];
  /** External function declaration text (e.g. `external "C" ...`). */
  externalDecl: string | null = null;
  /** JavaScript source code if this function was parsed from JS/TS */
  jsSource?: string;
  jsPath?: string;
  /** Extracted annotation(Library="...") references. */
  externalLibraries: string[] = [];
  /** Extracted annotation(Include="...") references. */
  externalIncludes: string[] = [];
  /**
   * Descriptors for variables whose type extends `ExternalObject`.
   * Track constructor/destructor names for lifecycle management.
   */
  externalObjects: ModelicaExternalObjectDescriptor[] = [];
  /** Diagnostics emitted during flattening (e.g. type errors, invalid iterators). */
  diagnostics: ModelicaDiagnostic[] = [];
  /** Experiment annotation data (StartTime, StopTime, Tolerance, etc.). */
  experiment: { startTime?: number; stopTime?: number; tolerance?: number; interval?: number } = {};
  /** Event indicators (zero-crossing functions) for state events. */
  eventIndicators: ModelicaExpression[] = [];
  /** Discrete state updates extracted from `when` clauses. */
  whenClauses: ModelicaWhenEquation[] = [];
  /** Optimization objective expression (Cost function). */
  objective: ModelicaExpression | null = null;
  /** Structural connect(a, b) pairs preserved for ECAD netlist extraction. */
  connectPairs: { a: string; b: string; aComponent: string; bComponent: string }[] = [];

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
    for (const sm of this.stateMachines) {
      hash.update(sm.hash);
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
      stateMachines: this.stateMachines.map((m) => m.toJSON),
      functions: this.functions.map((f) => f.toJSON),
      variables: this.variables.map((v) => v.toJSON),
      equations: this.equations.map((e) => e.toJSON),
      algorithms: this.algorithms.map((section) => section.map((s) => s.toJSON)),
      objective: this.objective ? this.objective.toJSON : null,
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
    for (const sm of this.stateMachines) {
      triples.push({ s: id, p: "modelica:stateMachine", o: `_:sm_${sm.name}` });
      triples.push(...sm.toRDF);
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
      (v) => v instanceof ModelicaRealVariable && v.variability === null,
    ) as ModelicaRealVariable[];
  }

  /**
   * Identify derivative variables — those whose names match `der(...)`.
   */
  get derivativeVariables(): ModelicaRealVariable[] {
    return this.variables.filter(
      (v) => v instanceof ModelicaRealVariable && v.name.startsWith("der("),
    ) as ModelicaRealVariable[];
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
  location?: SourceLocation;
  /** Clock domain index (undefined = continuous time). */
  clockDomain?: number | undefined;

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

export class ModelicaArrayEquation extends ModelicaEquation {
  expression1: ModelicaExpression;
  expression2: ModelicaExpression;

  constructor(expression1: ModelicaExpression, expression2: ModelicaExpression, description?: string | null) {
    super(description);
    this.expression1 = expression1;
    this.expression2 = expression2;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayEquation(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.expression1.hash);
    hash.update("=array=");
    hash.update(this.expression2.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "ArrayEquation",
      expression1: this.expression1.toJSON,
      expression2: this.expression2.toJSON,
      description: this.description,
    };
  }

  override get toRDF(): Triple[] {
    const id = `_:eq_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:ArrayEquation" },
      { s: id, p: "modelica:expression1", o: `_:expr_${this.expression1.hash.substring(0, 8)}` },
      { s: id, p: "modelica:expression2", o: `_:expr_${this.expression2.hash.substring(0, 8)}` },
      ...this.expression1.toRDF,
      ...this.expression2.toRDF,
    ];
  }
}

/** Represents a standalone function call as an equation (e.g., `assert(...)`, `Func(2)`). */
export class ModelicaFunctionCallEquation extends ModelicaEquation {
  call: ModelicaFunctionCallExpression;

  constructor(call: ModelicaFunctionCallExpression, description?: string | null) {
    super(description);
    this.call = call;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCallEquation(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("function_call_equation");
    hash.update(this.call.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "FunctionCallEquation",
      call: this.call.toJSON,
      description: this.description,
    };
  }

  override get toRDF(): Triple[] {
    return [];
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
  location?: SourceLocation;
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
  isReturn = false;
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

  static fromClassInstance(
    classInstance: ModelicaClassInstance | null | undefined,
    evaluator?: (expr: ModelicaExpression) => ModelicaExpression | null,
  ): ModelicaExpression | null {
    if (!classInstance) {
      return null;
    }
    if (!classInstance.instantiated && !classInstance.instantiating) classInstance.instantiate();

    if (classInstance instanceof ModelicaArrayClassInstance) {
      let elements: ModelicaExpression[] = [];
      for (const element of classInstance.elements ?? []) {
        if (element instanceof ModelicaClassInstance) {
          const expression = ModelicaExpression.fromClassInstance(element, evaluator);
          if (expression) elements.push(expression);
        }
      }
      // If we couldn't evaluate elements (e.g. disabled function algorithms),
      // returning an empty array here masks the original AST from the flattener.
      // Return null to signal evaluation failure unless the array is genuinely sized 0.
      if (elements.length === 0 && classInstance.shape.some((d) => d > 0)) {
        return null;
      }

      // Reconstruct nested ModelicaArray structure for multi-dimensional arrays
      for (let i = classInstance.shape.length - 1; i >= 1; i--) {
        const length = classInstance.shape[i] ?? 0;
        const chunks: ModelicaExpression[] = [];
        for (let j = 0; j < elements.length; j += length) {
          chunks.push(new ModelicaArray(classInstance.shape.slice(i), elements.slice(j, j + length)));
        }
        elements = chunks;
      }

      return new ModelicaArray([classInstance.shape[0] ?? 0], elements);
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

        let value = ModelicaExpression.fromClassInstance(component.classInstance, evaluator);
        if (!value && evaluator && component.modification?.expression) {
          // Fall back to evaluating the component's default binding expression
          value = evaluator(component.modification.expression);
        }
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
        if (operator === ModelicaBinaryOperator.ADDITION)
          return new ModelicaStringLiteral((operand1.value ? "true" : "false") + operand2.value);
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
            if (operand2.value === 0) return null;
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
            if (operand2.value === 0) return null;
            return new ModelicaRealLiteral(operand1.value / operand2.value);
          case ModelicaBinaryOperator.EXPONENTIATION:
            return new ModelicaRealLiteral(operand1.value ** operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaStringLiteral) {
        if (operator === ModelicaBinaryOperator.ADDITION)
          return new ModelicaStringLiteral(String(operand1.value) + operand2.value);
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
            if (operand2.value === 0) return null;
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
            if (operand2.value === 0) return null;
            return new ModelicaRealLiteral(operand1.value / operand2.value);
          case ModelicaBinaryOperator.EXPONENTIATION:
            return new ModelicaRealLiteral(operand1.value ** operand2.value);
          default:
            return null;
        }
      } else if (operand2 instanceof ModelicaStringLiteral) {
        if (operator === ModelicaBinaryOperator.ADDITION)
          return new ModelicaStringLiteral(String(operand1.value) + operand2.value);
        return null;
      } else {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
    } else if (operand1 instanceof ModelicaStringLiteral) {
      if (operand2 instanceof ModelicaBooleanLiteral) {
        if (operator === ModelicaBinaryOperator.ADDITION)
          return new ModelicaStringLiteral(operand1.value + (operand2.value ? "true" : "false"));
        return null;
      } else if (operand2 instanceof ModelicaIntegerLiteral) {
        if (operator === ModelicaBinaryOperator.ADDITION)
          return new ModelicaStringLiteral(operand1.value + String(operand2.value));
        return null;
      } else if (operand2 instanceof ModelicaRealLiteral) {
        if (operator === ModelicaBinaryOperator.ADDITION)
          return new ModelicaStringLiteral(operand1.value + String(operand2.value));
        return null;
      } else if (operand2 instanceof ModelicaStringLiteral) {
        switch (operator) {
          case ModelicaBinaryOperator.ADDITION:
            return new ModelicaStringLiteral(operand1.value + operand2.value);
          case ModelicaBinaryOperator.EQUALITY:
            return new ModelicaBooleanLiteral(operand1.value === operand2.value);
          case ModelicaBinaryOperator.INEQUALITY:
            return new ModelicaBooleanLiteral(operand1.value !== operand2.value);
          default:
            return null;
        }
      } else {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
    } else if (operand1 instanceof ModelicaArray && operand2 instanceof ModelicaArray) {
      // Non-elementwise * between arrays: vector dot product or matrix multiplication
      if (operator === ModelicaBinaryOperator.MULTIPLICATION) {
        const s1 = operand1.shape;
        const s2 = operand2.shape;
        const numVal = (e: ModelicaExpression | null | undefined): number | null => {
          if (e instanceof ModelicaIntegerLiteral) return e.value;
          if (e instanceof ModelicaRealLiteral) return e.value;
          return null;
        };
        // 1D × 1D: vector dot product → scalar
        if (s1.length === 1 && s2.length === 1 && s1[0] === s2[0]) {
          let sum = 0;
          let isReal = false;
          for (let i = 0; i < (s1[0] ?? 0); i++) {
            const a = numVal(operand1.elements[i]);
            const b = numVal(operand2.elements[i]);
            if (a == null || b == null) return new ModelicaBinaryExpression(operator, operand1, operand2);
            sum += a * b;
            if (
              operand1.elements[i] instanceof ModelicaRealLiteral ||
              operand2.elements[i] instanceof ModelicaRealLiteral
            )
              isReal = true;
          }
          return isReal ? new ModelicaRealLiteral(sum) : new ModelicaIntegerLiteral(sum);
        }
        // 2D × 2D: matrix multiplication (stored as array of row-arrays)
        if (s1.length === 1 && s2.length === 1) {
          const rows1 = operand1.elements;
          const rows2 = operand2.elements;
          if (rows1[0] instanceof ModelicaArray && rows2[0] instanceof ModelicaArray) {
            const m = s1[0] ?? 0;
            const n = (rows2[0] as ModelicaArray).elements.length;
            const k = (rows1[0] as ModelicaArray).elements.length;
            const resultRows: ModelicaExpression[] = [];
            for (let i = 0; i < m; i++) {
              const row1 = rows1[i] as ModelicaArray | undefined;
              if (!row1) return new ModelicaBinaryExpression(operator, operand1, operand2);
              const rowElements: ModelicaExpression[] = [];
              for (let j = 0; j < n; j++) {
                let sum = 0;
                for (let p = 0; p < k; p++) {
                  const a = numVal(row1.elements[p]);
                  const row2 = rows2[p] as ModelicaArray | undefined;
                  const b = numVal(row2?.elements[j]);
                  if (a == null || b == null) return new ModelicaBinaryExpression(operator, operand1, operand2);
                  sum += a * b;
                }
                rowElements.push(new ModelicaRealLiteral(sum));
              }
              resultRows.push(new ModelicaArray([n], rowElements));
            }
            return new ModelicaArray([m], resultRows);
          }
        }
      }
      // Element-wise array binary operations
      const scalarOp = (operator.startsWith(".") ? operator.substring(1) : operator) as ModelicaBinaryOperator;
      if (operand1.elements.length === operand2.elements.length) {
        const newElements: ModelicaExpression[] = [];
        for (let i = 0; i < operand1.elements.length; i++) {
          const a = operand1.elements[i];
          const b = operand2.elements[i];
          if (!a || !b) return new ModelicaBinaryExpression(operator, operand1, operand2);
          const el = ModelicaBinaryExpression.new(scalarOp, a, b);
          if (!el) return new ModelicaBinaryExpression(operator, operand1, operand2);
          newElements.push(el);
        }
        return new ModelicaArray(operand1.shape, newElements);
      }
      return new ModelicaBinaryExpression(operator, operand1, operand2);
    } else if (operand1 instanceof ModelicaArray && !(operand2 instanceof ModelicaArray)) {
      // For non-element-wise + and -, array op scalar is not allowed (shape mismatch).
      // Only element-wise operators (.+, .-) and */ can broadcast scalars.
      if (
        !operator.startsWith(".") &&
        (operator === ModelicaBinaryOperator.ADDITION || operator === ModelicaBinaryOperator.SUBTRACTION)
      ) {
        return null;
      }
      // Broadcast scalar to array (e.g., 1 .+ {1, 2, 3})
      const scalarOp = (operator.startsWith(".") ? operator.substring(1) : operator) as ModelicaBinaryOperator;
      const newElements: ModelicaExpression[] = [];
      for (const el of operand1.elements) {
        if (!el) return new ModelicaBinaryExpression(operator, operand1, operand2);
        const result = ModelicaBinaryExpression.new(scalarOp, el, operand2);
        if (!result) return new ModelicaBinaryExpression(operator, operand1, operand2);
        newElements.push(result);
      }
      return new ModelicaArray(operand1.shape, newElements);
    } else if (!(operand1 instanceof ModelicaArray) && operand2 instanceof ModelicaArray) {
      // For non-element-wise + and -, scalar op array is not allowed (shape mismatch).
      if (
        !operator.startsWith(".") &&
        (operator === ModelicaBinaryOperator.ADDITION || operator === ModelicaBinaryOperator.SUBTRACTION)
      ) {
        return null;
      }
      // Broadcast scalar to array (e.g., {1, 2, 3} .+ 1)
      const scalarOp = (operator.startsWith(".") ? operator.substring(1) : operator) as ModelicaBinaryOperator;
      const newElements: ModelicaExpression[] = [];
      for (const el of operand2.elements) {
        if (!el) return new ModelicaBinaryExpression(operator, operand1, operand2);
        const result = ModelicaBinaryExpression.new(scalarOp, operand1, el);
        if (!result) return new ModelicaBinaryExpression(operator, operand1, operand2);
        newElements.push(result);
      }
      return new ModelicaArray(operand2.shape, newElements);
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
    const fullShape = this.flatShape;
    let elements: JSONValue = [...this.flatElements].map((e) => e.toJSON);
    for (let i = fullShape.length - 1; i >= 1; i--) {
      const length = fullShape[i] ?? 0;
      const chunks: JSONValue[] = [];
      for (let j = 0; j < (elements as JSONValue[]).length; j += length)
        chunks.push((elements as JSONValue[]).slice(j, j + length));
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

/**
 * Represents a tuple expression like `(a, b)` from output expression lists.
 * Unlike `ModelicaArray`, tuples are NOT split into per-element scalar equations.
 */
export class ModelicaTupleExpression extends ModelicaExpression {
  elements: (ModelicaExpression | null)[];

  constructor(elements: (ModelicaExpression | null)[]) {
    super();
    this.elements = elements;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitTupleExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    for (const element of this.elements) {
      if (element) hash.update(element.hash);
      else hash.update("null");
    }
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return this.elements.map((e) => e?.toJSON ?? null);
  }

  override get toRDF(): Triple[] {
    return [];
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
    hash.update(this.value ? "true" : "false");
    return hash.digest("hex");
  }

  override get toJSON(): boolean {
    return this.value;
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    return [
      { s: id, p: "rdf:type", o: "modelica:BooleanLiteral" },
      { s: id, p: "modelica:value", o: `"${this.value}"^^xsd:boolean` },
    ];
  }
}

export class ModelicaExpressionValue extends ModelicaLiteral {
  value: ModelicaExpression;

  constructor(value: ModelicaExpression) {
    super();
    this.value = value;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitExpressionValue(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("expr_val:");
    hash.update(this.value.hash);
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return { type: "ExpressionValue", value: this.value.toJSON };
  }

  override get toRDF(): Triple[] {
    const id = `_:expr_${this.hash.substring(0, 8)}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:ExpressionValue" },
      { s: id, p: "modelica:value", o: `_:expr_${this.value.hash.substring(0, 8)}` },
    ];
    triples.push(...this.value.toRDF);
    return triples;
  }
}

export class ModelicaIntegerLiteral extends ModelicaLiteral {
  value: number;
  rawText: string | null;

  constructor(value: number, rawText?: string | null) {
    super();
    this.value = value;
    this.rawText = rawText ?? null;
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
  originalText: string | undefined;

  constructor(value: number, originalText?: string) {
    super();
    this.value = value;
    this.originalText = originalText;
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

/**
 * Represents a partial function application expression, e.g.
 * `function dhydCalc(qNom = expr)` in a function call argument position.
 * Flattened output format: `function FullyQualifiedName(#(arg1), #(arg2))`.
 */
export class ModelicaPartialFunctionExpression extends ModelicaExpression {
  functionName: string;
  namedArgs: { name: string; value: ModelicaExpression }[];

  constructor(functionName: string, namedArgs: { name: string; value: ModelicaExpression }[]) {
    super();
    this.functionName = functionName;
    this.namedArgs = namedArgs;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitPartialFunctionExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("partialfunc");
    hash.update(this.functionName);
    for (const arg of this.namedArgs) {
      hash.update(arg.name);
      hash.update(arg.value.hash);
    }
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return null;
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

/**
 * Represents a comprehension/reduction expression, e.g. `sum(expr for i in range)`.
 * Used in function body flattening where reduction expressions must be preserved symbolically.
 */
export class ModelicaComprehensionExpression extends ModelicaExpression {
  functionName: string;
  bodyExpression: ModelicaExpression;
  iterators: { name: string; range: ModelicaExpression }[];

  constructor(
    functionName: string,
    bodyExpression: ModelicaExpression,
    iterators: { name: string; range: ModelicaExpression }[],
  ) {
    super();
    this.functionName = functionName;
    this.bodyExpression = bodyExpression;
    this.iterators = iterators;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitComprehensionExpression(this, argument);
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update("comprehension");
    hash.update(this.functionName);
    hash.update(this.bodyExpression.hash);
    for (const it of this.iterators) {
      hash.update(it.name);
      hash.update(it.range.hash);
    }
    return hash.digest("hex");
  }

  override get toJSON(): JSONValue {
    return null;
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

/**
 * Describes a function-typed parameter's signature.
 * Used when a function parameter has type = another function (e.g., partialScalarFunction).
 */
export interface ModelicaFunctionTypeSignature {
  inputs: { name: string; typeName: string }[];
  outputs: { name: string; typeName: string }[];
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
  functionType: ModelicaFunctionTypeSignature | null;
  /** Flow prefix ("flow" or "stream") from the component clause. */
  flowPrefix: string | null;
  /** Override type name for record-typed function parameters (e.g., "Complex" instead of "Real"). */
  customTypeName: string | null;
  /** Array dimensions for FMI 3.0 native array support (e.g., [3] for a 1D vector, [2,3] for a 2D matrix). */
  arrayDimensions: number[] | null;
  /** Clock domain index (undefined = continuous time). */
  clockDomain?: number | undefined;
  /** Extracted CAD / 3D annotations (as raw string or JSON), e.g. "CAD(uri=\"...\")" */
  cadAnnotationString: string | null;

  constructor(
    name: string,
    expression: ModelicaExpression | null,
    attributes: Map<string, ModelicaExpression>,
    variability: ModelicaVariability | null,
    description?: string | null,
    causality?: string | null,
    isFinal?: boolean,
    isProtected?: boolean,
    functionType?: ModelicaFunctionTypeSignature | null,
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
    this.functionType = functionType ?? null;
    this.flowPrefix = null;
    this.customTypeName = null;
    this.arrayDimensions = null;
    /** Clock domain index (undefined = continuous time). */
    this.clockDomain = undefined;
    this.cadAnnotationString = null;
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

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
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

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
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

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
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

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
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

export class ModelicaExpressionVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitExpressionVariable(this, argument);
  }

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:ExpressionVariable" },
      { s: id, p: "modelica:name", o: this.name },
    ];
    if (this.expression) {
      triples.push({ s: id, p: "modelica:expression", o: `_:expr_${this.expression.hash.substring(0, 8)}` });
      triples.push(...this.expression.toRDF);
    }
    return triples;
  }
}

export class ModelicaClockVariable extends ModelicaVariable {
  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitClockVariable(this, argument);
  }

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
    return this.name;
  }

  override get toRDF(): Triple[] {
    const id = `_:var_${this.name}`;
    const triples: Triple[] = [
      { s: id, p: "rdf:type", o: "modelica:ClockVariable" },
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

  override get toJSON(): JSONValue {
    if (this.cadAnnotationString) return { name: this.name, cad: this.cadAnnotationString };
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
  return ExpressionEvaluator.eval(expression, env);
}

/**
 * Full-featured expression evaluator used by the simulator.
 * Supports arithmetic, boolean comparisons, logical operators, built-in math
 * functions, event operators (pre, sample, initial, terminal), if-else
 * expressions, and variable lookups.
 *
 * Numeric encoding for booleans: `true` = 1, `false` = 0.
 */
export class ExpressionEvaluator {
  /** Variable environment: name → numeric value. */
  env: Map<string, number>;
  /** Previous-step values for `pre()`. */
  preValues: Map<string, number>;
  /** Current integration time step (for `sample()` tolerance). */
  stepSize: number;
  /** Whether we are at the very first time step. */
  isInitial: boolean;
  /** Whether we are at the very last time step. */
  isTerminal: boolean;
  /**
   * Optional callback for user-defined function dispatch.
   * Called when a function name doesn't match any built-in.
   * Receives the function name and evaluated argument values;
   * returns the function result or `null` if not found.
   */
  functionLookup: ((name: string, args: number[]) => number | null) | null;
  /** Current simulation time (for `delay()` buffer recording). */
  currentTime: number;
  /**
   * History buffers for `delay()` operator.
   * Key is the expression hash; value stores sorted (time, value) pairs.
   */
  delayBuffers: Map<string, { times: number[]; values: number[] }>;
  /**
   * Clocked variable values: latched at each clock tick by `sample()`.
   * Key is variable/expression hash.
   */
  clockedValues: Map<string, number>;
  /**
   * Previous-tick values for `previous()` operator.
   * Key is variable/expression hash.
   */
  previousValues: Map<string, number>;
  /** Set of clock domain IDs that ticked at the current step. */
  tickedClocks: Set<number>;
  /**
   * State for `spatialDistribution()` operator: piecewise-linear profile on [0,1].
   * Key is expression hash.
   */
  spatialDistributionStates: Map<string, { positions: number[]; values: number[] }>;

  constructor(env?: Map<string, number>) {
    this.env = env ?? new Map();
    this.preValues = new Map();
    this.stepSize = 0.01;
    this.isInitial = false;
    this.isTerminal = false;
    this.functionLookup = null;
    this.currentTime = 0;
    this.delayBuffers = new Map();
    this.clockedValues = new Map();
    this.previousValues = new Map();
    this.tickedClocks = new Set();
    this.spatialDistributionStates = new Map();
  }

  /** Convenience wrapper matching the old function signature. */
  static eval(expression: ModelicaExpression, env: Map<string, number>): number | null {
    const evaluator = new ExpressionEvaluator(env);
    return evaluator.evaluate(expression);
  }

  /** Evaluate a DAE expression to a number (booleans encoded as 0/1). Returns `null` on failure. */
  evaluate(expression: ModelicaExpression): number | null {
    if (expression instanceof ModelicaRealLiteral) {
      return expression.value;
    }
    if (expression instanceof ModelicaIntegerLiteral) {
      return expression.value;
    }
    if (expression instanceof ModelicaBooleanLiteral) {
      return expression.value ? 1 : 0;
    }
    // Variable lookups
    if (expression instanceof ModelicaRealVariable || expression instanceof ModelicaIntegerVariable) {
      const value = this.env.get(expression.name);
      return value !== undefined ? value : null;
    }
    if (expression instanceof ModelicaBooleanVariable) {
      const value = this.env.get(expression.name);
      return value !== undefined ? value : null;
    }
    if (expression instanceof ModelicaStringVariable) {
      // Strings can't be represented as numbers; return env value if set, else 0
      const value = this.env.get(expression.name);
      return value !== undefined ? value : 0;
    }
    if (expression instanceof ModelicaEnumerationVariable) {
      // Enumerations are ordinal values (1-based)
      const value = this.env.get(expression.name);
      return value !== undefined ? value : 0;
    }
    if (expression instanceof ModelicaStringLiteral) {
      // String literals can't be represented as numbers; return 0 to prevent null cascades
      return 0;
    }
    if (expression instanceof ModelicaNameExpression) {
      const value = this.env.get(expression.name);
      return value !== undefined ? value : null;
    }
    // Unary expressions
    if (expression instanceof ModelicaUnaryExpression) {
      const operand = this.evaluate(expression.operand);
      if (operand === null) return null;
      switch (expression.operator) {
        case ModelicaUnaryOperator.UNARY_MINUS:
        case ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS:
          return -operand;
        case ModelicaUnaryOperator.UNARY_PLUS:
        case ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS:
          return operand;
        case ModelicaUnaryOperator.LOGICAL_NEGATION:
          return operand === 0 ? 1 : 0;
        default:
          return null;
      }
    }
    // Binary expressions (arithmetic + comparison + logical)
    if (expression instanceof ModelicaBinaryExpression) {
      const left = this.evaluate(expression.operand1);
      const right = this.evaluate(expression.operand2);
      // Shortcut: 0 * anything = 0, anything * 0 = 0 (even if other side is null)
      if (
        (expression.operator === ModelicaBinaryOperator.MULTIPLICATION ||
          expression.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION) &&
        ((left === 0 && right !== null) ||
          (right === 0 && left !== null) ||
          (left === 0 && right === null) ||
          (left === null && right === 0))
      ) {
        return 0;
      }
      if (left === null || right === null) return null;
      switch (expression.operator) {
        // Arithmetic
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
        // Comparisons → 0 or 1
        case ModelicaBinaryOperator.LESS_THAN:
          return left < right ? 1 : 0;
        case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
          return left <= right ? 1 : 0;
        case ModelicaBinaryOperator.GREATER_THAN:
          return left > right ? 1 : 0;
        case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
          return left >= right ? 1 : 0;
        case ModelicaBinaryOperator.EQUALITY:
          return left === right ? 1 : 0;
        case ModelicaBinaryOperator.INEQUALITY:
          return left !== right ? 1 : 0;
        // Logical
        case ModelicaBinaryOperator.LOGICAL_AND:
          return left !== 0 && right !== 0 ? 1 : 0;
        case ModelicaBinaryOperator.LOGICAL_OR:
          return left !== 0 || right !== 0 ? 1 : 0;
        default:
          return null;
      }
    }
    // Function calls
    if (expression instanceof ModelicaFunctionCallExpression) {
      return this.evaluateFunctionCall(expression);
    }
    // If-else expressions
    if (expression instanceof ModelicaIfElseExpression) {
      const cond = this.evaluate(expression.condition);
      if (cond === null) return null;
      if (cond !== 0) return this.evaluate(expression.thenExpression);
      for (const clause of expression.elseIfClauses) {
        const c = this.evaluate(clause.condition);
        if (c === null) return null;
        if (c !== 0) return this.evaluate(clause.expression);
      }
      return this.evaluate(expression.elseExpression);
    }
    // Subscripted expressions: x[i] → look up "x[computed_index]" in env
    if (expression instanceof ModelicaSubscriptedExpression) {
      const base = expression.base;
      // Evaluate all subscript indices
      const indices: number[] = [];
      for (const sub of expression.subscripts) {
        const idx = this.evaluate(sub);
        if (idx === null) return null;
        indices.push(Math.round(idx));
      }
      // If base is a name, resolve to flat variable name like "name[1,2]"
      if (base instanceof ModelicaNameExpression || base instanceof ModelicaVariable) {
        const baseName = base instanceof ModelicaVariable ? base.name : base.name;
        const flatName = `${baseName}[${indices.join(",")}]`;
        const value = this.env.get(flatName);
        if (value !== undefined) return value;
        // Try without the property prefix for short names
        return null;
      }
      // If base is a function call (e.g., func(x)[1] for tuple indexing),
      // evaluate the function and handle tuple subscript
      if (base instanceof ModelicaFunctionCallExpression) {
        // For now, evaluate the function normally — tuple indexing is
        // handled at the flattener level
        return this.evaluateFunctionCall(base);
      }
      // If base is an array literal, index into it
      if (base instanceof ModelicaArray && indices.length === 1) {
        const idx = indices[0];
        if (idx !== undefined && idx >= 1 && idx <= base.elements.length) {
          const element = base.elements[idx - 1];
          if (element) return this.evaluate(element);
        }
        return null;
      }
      return null;
    }
    // Array expressions: unwrap single-element arrays to scalar
    if (expression instanceof ModelicaArray) {
      if (expression.elements.length === 1) {
        const el = expression.elements[0];
        if (el) return this.evaluate(el);
      }
      // Multi-element arrays can't be represented as a single number
      return null;
    }
    return null;
  }

  /** Evaluate a built-in function call. */
  private evaluateFunctionCall(expr: ModelicaFunctionCallExpression): number | null {
    const name = expr.functionName;
    const args = expr.args;
    const arg0 = args[0] as ModelicaExpression | undefined;
    const arg1 = args[1] as ModelicaExpression | undefined;

    // Event operators
    switch (name) {
      case "pre": {
        if (!arg0) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          const pre = this.preValues.get(varName);
          if (pre !== undefined) return pre;
        }
        return this.evaluate(arg0);
      }
      case "edge": {
        if (!arg0) return null;
        const current = this.evaluate(arg0);
        if (current === null) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          const pre = this.preValues.get(varName) ?? 0;
          return current !== 0 && pre === 0 ? 1 : 0;
        }
        return current !== 0 ? 1 : 0;
      }
      case "change": {
        if (!arg0) return null;
        const current = this.evaluate(arg0);
        if (current === null) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          const pre = this.preValues.get(varName) ?? current;
          return current !== pre ? 1 : 0;
        }
        return 0;
      }
      case "sample": {
        if (!arg0 || !arg1) return null;
        const start = this.evaluate(arg0);
        const interval = this.evaluate(arg1);
        if (start === null || interval === null || interval <= 0) return null;
        const t = this.env.get("time") ?? 0;
        if (t < start) return 0;
        const elapsed = t - start;
        const remainder = elapsed % interval;
        const tol = this.stepSize * 0.5;
        return remainder < tol || interval - remainder < tol ? 1 : 0;
      }
      case "initial":
        return this.isInitial ? 1 : 0;
      case "terminal":
        return this.isTerminal ? 1 : 0;
      case "noEvent":
      case "smooth": {
        if (name === "smooth" && arg1) return this.evaluate(arg1);
        if (arg0) return this.evaluate(arg0);
        return null;
      }
      // Type cast annotations generated by the flattener (e.g. /*Real*/(x))
      case "/*Real*/":
      case "/*Integer*/":
      case "/*Boolean*/": {
        if (arg0) return this.evaluate(arg0);
        return null;
      }
      // ── Synchronous / Clocked operators (Modelica §16) ──
      case "hold": {
        // hold(u): return last sampled value (stored in evaluator state)
        if (!arg0) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          // Use the current value — in a clocked partition, this is the last sampled value
          return this.env.get(`$hold(${varName})`) ?? this.evaluate(arg0);
        }
        return this.evaluate(arg0);
      }
      case "previous": {
        // previous(u): return value from previous clock tick
        if (!arg0) return null;
        const varName = this.extractVarName(arg0);
        if (varName) {
          const prev = this.preValues.get(varName);
          if (prev !== undefined) return prev;
        }
        return this.evaluate(arg0);
      }
      case "subSample": {
        // subSample(u, factor): sample every factor-th tick
        if (!arg0) return null;
        return this.evaluate(arg0);
      }
      case "superSample": {
        // superSample(u, factor): upsample by factor
        if (!arg0) return null;
        return this.evaluate(arg0);
      }
      case "shiftSample": {
        // shiftSample(u, shiftCounter, resolution): shift clock phase forward
        if (!arg0) return null;
        return this.evaluate(arg0);
      }
      case "backSample": {
        // backSample(u, backCounter, resolution): shift clock phase backward
        if (!arg0) return null;
        return this.evaluate(arg0);
      }
      case "noClock": {
        // noClock(u): convert clocked to continuous (strip clock annotation)
        if (!arg0) return null;
        return this.evaluate(arg0);
      }
      case "interval": {
        // interval(u): return clock interval
        return this.stepSize > 0 ? this.stepSize : 0.001;
      }
      case "firstTick": {
        // firstTick(u): true at the first clock tick
        return this.isInitial ? 1 : 0;
      }
    }

    // Math functions (single argument)
    if (args.length === 1 && arg0) {
      const a = this.evaluate(arg0);
      if (a === null) return null;
      switch (name) {
        case "sin":
          return Math.sin(a);
        case "cos":
          return Math.cos(a);
        case "tan":
          return Math.tan(a);
        case "asin":
          return Math.asin(a);
        case "acos":
          return Math.acos(a);
        case "atan":
          return Math.atan(a);
        case "sinh":
          return Math.sinh(a);
        case "cosh":
          return Math.cosh(a);
        case "tanh":
          return Math.tanh(a);
        case "exp":
          return Math.exp(a);
        case "log":
          return a > 0 ? Math.log(a) : null;
        case "log10":
          return a > 0 ? Math.log10(a) : null;
        case "sqrt":
          return a >= 0 ? Math.sqrt(a) : null;
        case "abs":
          return Math.abs(a);
        case "sign":
          return Math.sign(a);
        case "ceil":
          return Math.ceil(a);
        case "floor":
          return Math.floor(a);
        case "integer":
          return Math.floor(a);
        case "der":
          return this.env.get(`der(${this.extractVarName(arg0) ?? ""})`) ?? 0;
      }
    }

    // Math functions (two arguments)
    if (args.length === 2 && arg0 && arg1) {
      const a = this.evaluate(arg0);
      const b = this.evaluate(arg1);
      if (a === null || b === null) return null;
      switch (name) {
        case "atan2":
          return Math.atan2(a, b);
        case "max":
          return Math.max(a, b);
        case "min":
          return Math.min(a, b);
        case "mod":
          return b !== 0 ? a - Math.floor(a / b) * b : null;
        case "rem":
          return b !== 0 ? a - Math.trunc(a / b) * b : null;
        case "div":
          return b !== 0 ? Math.trunc(a / b) : null;
      }
    }

    // delay(expr, delayTime[, delayMax]) — returns expr evaluated at t - delayTime
    if (name === "delay" && arg0 && arg1) {
      const currentVal = this.evaluate(arg0);
      const delayTime = this.evaluate(arg1);
      if (currentVal === null || delayTime === null) return currentVal;

      // Use expression hash as buffer key
      const key = arg0.hash;
      let buffer = this.delayBuffers.get(key);
      if (!buffer) {
        buffer = { times: [], values: [] };
        this.delayBuffers.set(key, buffer);
      }

      // Record current value at current time
      const t = this.currentTime;
      const times = buffer.times;
      const values = buffer.values;
      if (times.length === 0 || t > (times[times.length - 1] ?? -Infinity)) {
        times.push(t);
        values.push(currentVal);
      }

      // Prune old entries beyond max delay window (keep 2x for safety)
      const delayMax = args[2] ? (this.evaluate(args[2] as ModelicaExpression) ?? delayTime) : delayTime;
      const cutoff = t - 2 * Math.abs(delayMax);
      while (times.length > 2 && (times[0] ?? 0) < cutoff) {
        times.shift();
        values.shift();
      }

      // Look up value at t - delayTime via linear interpolation
      const tLookup = t - Math.abs(delayTime);
      if (tLookup <= (times[0] ?? 0)) {
        // Before buffer start — return earliest recorded value
        return values[0] ?? currentVal;
      }
      // Binary search for interpolation bracket
      let lo = 0;
      let hi = times.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if ((times[mid] ?? 0) <= tLookup) lo = mid;
        else hi = mid;
      }
      const t0 = times[lo] ?? 0;
      const t1 = times[hi] ?? t0;
      const v0 = values[lo] ?? 0;
      const v1 = values[hi] ?? v0;
      if (Math.abs(t1 - t0) < 1e-15) return v0;
      // Linear interpolation
      const alpha = (tLookup - t0) / (t1 - t0);
      return v0 + alpha * (v1 - v0);
    }

    // ── Synchronous clock operators (Modelica 3.3) ──

    // sample(u) — latch a continuous value into the clocked partition
    if (name === "sample" && arg0) {
      const val = this.evaluate(arg0);
      if (val === null) return null;
      const key = arg0.hash;
      // On clock tick, latch the value; otherwise return last latched value
      if (this.tickedClocks.size > 0) {
        // Move current to previous, latch new
        const old = this.clockedValues.get(key);
        if (old !== undefined) this.previousValues.set(key, old);
        this.clockedValues.set(key, val);
        return val;
      }
      return this.clockedValues.get(key) ?? val;
    }

    // hold(u) — zero-order hold: return last clocked value in continuous time
    if (name === "hold" && arg0) {
      const key = arg0.hash;
      // If clock is ticking, evaluate and latch
      if (this.tickedClocks.size > 0) {
        const val = this.evaluate(arg0);
        if (val !== null) this.clockedValues.set(key, val);
        return val;
      }
      // In continuous time, return the last latched value
      return this.clockedValues.get(key) ?? this.evaluate(arg0);
    }

    // previous(x) — return value of x at the previous clock tick
    if (name === "previous" && arg0) {
      const key = arg0.hash;
      return this.previousValues.get(key) ?? this.evaluate(arg0) ?? 0;
    }

    // subSample(u, factor) — derive a slower clock (factor divides base rate)
    if (name === "subSample" && arg0) {
      return this.evaluate(arg0);
    }
    // superSample(u, factor) — derive a faster clock (factor multiplies base rate)
    if (name === "superSample" && arg0) {
      return this.evaluate(arg0);
    }
    // shiftSample(u, shiftCounter, resolution) — phase-shift
    if (name === "shiftSample" && arg0) {
      return this.evaluate(arg0);
    }
    // backSample(u, backCounter, resolution) — negative phase-shift
    if (name === "backSample" && arg0) {
      return this.evaluate(arg0);
    }
    // noClock(u) — remove clock annotation
    if (name === "noClock" && arg0) {
      return this.evaluate(arg0);
    }

    // ── spatialDistribution(in0, in1, x, positiveVelocity) ──
    // 1-D transport operator: maintains a piecewise-linear profile z(x)
    // on [0, 1], shifted by velocity * dt each step, filling inflow boundary.
    // Returns interpolated value at x=0 (out0) or x=1 (out1) depending on velocity direction.
    if (name === "spatialDistribution" && args.length >= 4) {
      const in0 = this.evaluate(args[0] as ModelicaExpression);
      const in1 = this.evaluate(args[1] as ModelicaExpression);
      const x = this.evaluate(args[2] as ModelicaExpression);
      const positiveVelocity = this.evaluate(args[3] as ModelicaExpression);
      if (in0 === null || in1 === null || x === null || positiveVelocity === null) return null;

      const key = (args[0] as ModelicaExpression).hash + "_sd";
      let state = this.spatialDistributionStates.get(key);
      if (!state) {
        // Initialize with linear profile from in0 to in1
        state = { positions: [0, 1], values: [in0, in1] };
        this.spatialDistributionStates.set(key, state);
      }

      // For the scalar evaluator, return the output at x=0 or x=1
      // depending on the velocity direction (simplified)
      if (positiveVelocity > 0) {
        // Positive velocity → output at x=1 is the transported value
        return state.values[state.values.length - 1] ?? in1;
      } else {
        // Negative velocity → output at x=0 is the transported value
        return state.values[0] ?? in0;
      }
    }

    // ── Array constructor functions ──
    // These return constant values or reduce arrays to scalars.
    // In a scalarized environment, array constructors are typically resolved
    // by the flattener, but they may appear in algorithm sections or
    // function bodies where runtime evaluation is needed.

    // zeros(n1, n2, ...) — every element is 0
    if (name === "zeros") {
      return 0;
    }
    // ones(n1, n2, ...) — every element is 1
    if (name === "ones") {
      return 1;
    }
    // fill(s, n1, n2, ...) — every element is s
    if (name === "fill" && arg0) {
      return this.evaluate(arg0);
    }
    // linspace(x1, x2, n) — linear interpolation; when subscripted we get here
    // via subscripted-expression eval, but standalone returns the first value
    if (name === "linspace" && arg0) {
      return this.evaluate(arg0);
    }
    // identity(n) — identity matrix; standalone scalar context returns 1 (diagonal)
    if (name === "identity") {
      return 1;
    }

    // ── Array reduction functions ──
    // These scan the evaluator environment for matching array entries.

    // sum(array_expr) / product(array_expr)
    if ((name === "sum" || name === "product") && arg0) {
      const elements = this.collectArrayElements(arg0);
      if (elements !== null && elements.length > 0) {
        if (name === "sum") {
          let total = 0;
          for (const v of elements) total += v;
          return total;
        } else {
          let total = 1;
          for (const v of elements) total *= v;
          return total;
        }
      }
      // If elements couldn't be collected, try evaluating as scalar
      return this.evaluate(arg0);
    }

    // min(array) / max(array) — single-argument form for arrays
    if ((name === "min" || name === "max") && args.length === 1 && arg0) {
      const elements = this.collectArrayElements(arg0);
      if (elements !== null && elements.length > 0) {
        return name === "min" ? Math.min(...elements) : Math.max(...elements);
      }
      // Fall through to scalar min/max handling below
    }

    // ── Array utility functions ──

    // size(A) or size(A, dim) — return array size
    if (name === "size" && arg0) {
      const varName = this.extractVarName(arg0);
      if (varName) {
        const sizes = this.getArrayDimensions(varName);
        if (arg1) {
          const dim = this.evaluate(arg1);
          if (dim !== null && dim >= 1 && dim <= sizes.length) {
            return sizes[Math.round(dim) - 1] ?? 0;
          }
        }
        // size(A) returns the first dimension if no dim specified
        return sizes[0] ?? 0;
      }
      return null;
    }

    // ndims(A) — number of dimensions
    if (name === "ndims" && arg0) {
      const varName = this.extractVarName(arg0);
      if (varName) {
        const sizes = this.getArrayDimensions(varName);
        return sizes.length > 0 ? sizes.length : 0;
      }
      return 0;
    }

    // scalar(A) — extract the single element from a 1-element array
    if (name === "scalar" && arg0) {
      return this.evaluate(arg0);
    }

    // String(val) — type conversion; returns the numeric value unchanged
    if (name === "String" && arg0) {
      return this.evaluate(arg0);
    }

    // integer(x) — convert to integer
    if (name === "integer" && arg0) {
      const val = this.evaluate(arg0);
      return val !== null ? Math.floor(val) : null;
    }

    // ── Special purpose operators ──

    // inStream(c.s) — look up the generated $inStream(c.s) variable
    if (name === "inStream" && arg0) {
      const varName = this.extractVarName(arg0);
      if (varName) {
        const inStreamKey = `$inStream(${varName})`;
        const val = this.env.get(inStreamKey);
        if (val !== undefined) return val;
      }
      // Fallback: evaluate the argument directly (no stream connection)
      return this.evaluate(arg0);
    }

    // actualStream(c.s) — if flow > 0 return inStream(c.s), else return c.s
    if (name === "actualStream" && arg0) {
      const varName = this.extractVarName(arg0);
      if (varName) {
        // Find the associated flow variable (same connector, flow-prefixed component)
        // Convention: stream var is "port.h_outflow", flow var is "port.m_flow"
        const dotIdx = varName.lastIndexOf(".");
        const connectorPrefix = dotIdx >= 0 ? varName.substring(0, dotIdx) : "";
        // Search for a flow variable in this connector
        let flowVal = 0;
        for (const [key, val] of this.env) {
          if (key.startsWith(connectorPrefix + ".") && key !== varName) {
            // Heuristic: use first variable that looks like a flow
            if (key.includes("flow") || key.includes("m_flow")) {
              flowVal = val;
              break;
            }
          }
        }
        if (flowVal > 0) {
          const inStreamKey = `$inStream(${varName})`;
          return this.env.get(inStreamKey) ?? this.evaluate(arg0);
        }
        return this.evaluate(arg0);
      }
      return this.evaluate(arg0);
    }

    // semiLinear(x, k₊, k₋) → x >= 0 ? x*k₊ : x*k₋
    if (name === "semiLinear" && arg0 && arg1) {
      const x = this.evaluate(arg0);
      const kPos = this.evaluate(arg1);
      const arg2 = args[2] as ModelicaExpression | undefined;
      const kNeg = arg2 ? this.evaluate(arg2) : null;
      if (x === null || kPos === null || kNeg === null) return null;
      return x >= 0 ? x * kPos : x * kNeg;
    }

    // cardinality(c) — count env entries matching connector prefix
    if (name === "cardinality" && arg0) {
      const varName = this.extractVarName(arg0);
      if (varName) {
        let count = 0;
        const prefix = varName + ".";
        for (const key of this.env.keys()) {
          if (key.startsWith(prefix)) count++;
        }
        return count > 0 ? count : 0;
      }
      return 0;
    }

    // print(s) — console output, return 0
    if (name === "print") {
      return 0;
    }

    // ── Vector/matrix operations ──

    // cross(x, y) → 3-element cross product
    // Returns component at current subscript context; standalone returns x[2]*y[3]-x[3]*y[2]
    if (name === "cross" && arg0 && arg1) {
      const xElems = this.collectArrayElements(arg0);
      const yElems = this.collectArrayElements(arg1);
      if (xElems && yElems && xElems.length === 3 && yElems.length === 3) {
        // Return first component in scalar context
        const x1 = xElems[0] ?? 0,
          x2 = xElems[1] ?? 0,
          x3 = xElems[2] ?? 0;
        const y1 = yElems[0] ?? 0,
          y2 = yElems[1] ?? 0,
          y3 = yElems[2] ?? 0;
        // In scalar context, this is ambiguous — return magnitude
        return Math.sqrt((x2 * y3 - x3 * y2) ** 2 + (x3 * y1 - x1 * y3) ** 2 + (x1 * y2 - x2 * y1) ** 2);
      }
      return null;
    }

    // skew(x) — 3×3 skew-symmetric matrix; in scalar context return 0 (trace is 0)
    if (name === "skew") {
      return 0;
    }

    // diagonal(v) — create diagonal matrix; in scalar context returns first element
    if (name === "diagonal" && arg0) {
      const elems = this.collectArrayElements(arg0);
      if (elems && elems.length > 0) return elems[0] ?? 0;
      return this.evaluate(arg0);
    }

    // outerProduct(x, y) — x * transpose(y); in scalar context return x[1]*y[1]
    if (name === "outerProduct" && arg0 && arg1) {
      const x0 = this.evaluate(arg0);
      const y0 = this.evaluate(arg1);
      if (x0 !== null && y0 !== null) return x0 * y0;
      return null;
    }

    // vector(A) — reshape to 1D; in scalar evaluator, pass through
    if (name === "vector" && arg0) {
      return this.evaluate(arg0);
    }

    // matrix(A) — reshape to 2D; in scalar evaluator, pass through
    if (name === "matrix" && arg0) {
      return this.evaluate(arg0);
    }

    // symmetric(A) — (A + transpose(A))/2; in scalar evaluator, pass through
    if (name === "symmetric" && arg0) {
      return this.evaluate(arg0);
    }

    // cat(k, A, B, ...) — concatenate along dimension k; evaluate first array arg
    if (name === "cat" && arg1) {
      return this.evaluate(arg1);
    }

    // promote(A, n) — add trailing dimensions; pass through in scalar context
    if (name === "promote" && arg0) {
      return this.evaluate(arg0);
    }

    // homotopy(actual, simplified) — blend with lambda parameter
    if (name === "homotopy" && arg0) {
      const actual = this.evaluate(arg0);
      const simplified = arg1 ? this.evaluate(arg1) : actual;
      if (actual === null) return null;
      const lambda = this.env.get("$homotopy.lambda") ?? 1.0;
      return lambda * actual + (1 - lambda) * (simplified ?? actual);
    }

    // Connections.* — overconstrained connection graph operators (§9.4)
    if (name === "Connections.branch" || name === "Connections.root" || name === "Connections.potentialRoot") {
      // Side-effect registration — handled during flattening, no-op at runtime
      return 0;
    }
    if (name === "Connections.rooted" || name === "Connections.isRoot") {
      // Returns true if the argument is closer to the root in the spanning tree
      // Default: assume rooted (conservative for single-body models)
      return 1;
    }

    // assert(condition, message[, level]) — evaluate condition, no-op if true
    if (name === "assert") {
      const condVal = arg0 ? this.evaluate(arg0) : null;
      if (condVal !== null && condVal === 0) {
        // Assertion failed — throw to stop simulation
        const msgArg = args[1];
        throw new Error(`Modelica assertion failed: ${msgArg ?? "unknown"}`);
      }
      return 0; // assert() doesn't return a value; 0 is a no-op sentinel
    }

    // terminate(message) — stop the simulation
    if (name === "terminate") {
      throw new Error("Simulation terminated by terminate()");
    }

    // Delegate to user-defined function lookup
    if (this.functionLookup) {
      const argValues: number[] = [];
      for (const arg of args) {
        const val = this.evaluate(arg as ModelicaExpression);
        if (val === null) return null;
        argValues.push(val);
      }
      return this.functionLookup(name, argValues);
    }

    // External function stub: return 0 for unresolved functions to prevent
    // null cascades. This allows simulation to proceed even when external "C"
    // functions or unresolved user-defined functions are encountered.
    return 0;
  }

  /** Extract a variable name from a DAE expression. */
  private extractVarName(expr: ModelicaExpression): string | null {
    if (expr instanceof ModelicaVariable) return expr.name;
    if (expr instanceof ModelicaNameExpression) return expr.name;
    return null;
  }

  /**
   * Collect numeric values from an array expression.
   * Handles ModelicaArray literals and scalarized array variables (name[1], name[2], ...).
   */
  private collectArrayElements(expr: ModelicaExpression): number[] | null {
    // Direct array literal
    if (expr instanceof ModelicaArray) {
      const values: number[] = [];
      for (const el of expr.elements) {
        if (el instanceof ModelicaArray) {
          // Nested array — flatten recursively
          const inner = this.collectArrayElements(el);
          if (inner === null) return null;
          values.push(...inner);
        } else {
          const val = this.evaluate(el);
          if (val === null) return null;
          values.push(val);
        }
      }
      return values;
    }
    // Scalarized array variable: look up name[1], name[2], ... in env
    const varName = this.extractVarName(expr);
    if (varName) {
      const prefix = varName + "[";
      const entries: { index: number; value: number }[] = [];
      for (const [key, value] of this.env) {
        if (key.startsWith(prefix) && key.endsWith("]")) {
          const idxStr = key.substring(prefix.length, key.length - 1);
          const idx = parseInt(idxStr, 10);
          if (!isNaN(idx)) {
            entries.push({ index: idx, value });
          }
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => a.index - b.index);
        return entries.map((e) => e.value);
      }
    }
    return null;
  }

  /**
   * Get the dimensions of an array from environment entries.
   * Infers shape from entries like name[1], name[2,3], etc.
   */
  private getArrayDimensions(varName: string): number[] {
    const prefix = varName + "[";
    let maxIndices: number[] = [];
    for (const key of this.env.keys()) {
      if (key.startsWith(prefix) && key.endsWith("]")) {
        const idxStr = key.substring(prefix.length, key.length - 1);
        const parts = idxStr.split(",").map((s) => parseInt(s.trim(), 10));
        if (parts.every((p) => !isNaN(p))) {
          if (maxIndices.length === 0) {
            maxIndices = parts.map(() => 0);
          }
          for (let i = 0; i < parts.length && i < maxIndices.length; i++) {
            const p = parts[i];
            const m = maxIndices[i];
            if (p !== undefined && m !== undefined && p > m) {
              maxIndices[i] = p;
            }
          }
        }
      }
    }
    return maxIndices;
  }
}

export class ModelicaStateMachine {
  name: string;
  states: ModelicaState[] = [];
  equations: ModelicaEquation[] = [];

  constructor(name: string) {
    this.name = name;
  }

  accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitStateMachine(this, argument);
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("statemachine_" + this.name);
    for (const s of this.states) hash.update(s.hash);
    for (const e of this.equations) hash.update(e.hash);
    return hash.digest("hex");
  }

  get toJSON(): JSONValue {
    return {
      "@type": "StateMachine",
      name: this.name,
      states: this.states.map((s) => s.toJSON),
      equations: this.equations.map((e) => e.toJSON),
    };
  }

  get toRDF(): Triple[] {
    return [];
  }
}

/**
 * A clock partition groups equations and variables that operate on the same discrete clock.
 * Produced by the synchronous clock inference pass in the flattener.
 */
export class ModelicaClockPartition {
  /** Unique clock domain ID. */
  clockId: number;
  /** Base clock expression (e.g., `Clock(0.01)` or `Clock(condition)`). */
  baseClock: ModelicaExpression | null;
  /** Equations belonging to this clock partition. */
  equations: ModelicaEquation[] = [];
  /** Variables belonging to this clock partition. */
  variables: ModelicaVariable[] = [];

  constructor(clockId: number, baseClock: ModelicaExpression | null = null) {
    this.clockId = clockId;
    this.baseClock = baseClock;
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("clockPartition_" + this.clockId);
    for (const e of this.equations) hash.update(e.hash);
    for (const v of this.variables) hash.update(v.hash);
    return hash.digest("hex");
  }

  get toJSON(): JSONValue {
    return {
      "@type": "ClockPartition",
      clockId: this.clockId,
      equations: this.equations.map((e) => e.toJSON),
      variables: this.variables.map((v) => v.toJSON),
    };
  }
}

/**
 * Describes a variable whose type extends `ExternalObject`.
 * Tracks the constructor and destructor function names for lifecycle management
 * during FMU initialization and termination.
 */
export class ModelicaExternalObjectDescriptor {
  /** The variable name in the flattened DAE. */
  variableName: string;
  /** The fully-qualified type name (e.g., `MyLib.MyExternalObj`). */
  typeName: string;
  /** Constructor function name (e.g., `MyExternalObj.constructor`). */
  constructorName: string;
  /** Destructor function name (e.g., `MyExternalObj.destructor`). */
  destructorName: string;

  constructor(variableName: string, typeName: string, constructorName?: string, destructorName?: string) {
    this.variableName = variableName;
    this.typeName = typeName;
    this.constructorName = constructorName ?? `${typeName}.constructor`;
    this.destructorName = destructorName ?? `${typeName}.destructor`;
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("externalObject_" + this.variableName + "_" + this.typeName);
    return hash.digest("hex");
  }

  get toJSON(): JSONValue {
    return {
      "@type": "ExternalObjectDescriptor",
      variableName: this.variableName,
      typeName: this.typeName,
      constructorName: this.constructorName,
      destructorName: this.destructorName,
    };
  }
}

export class ModelicaState {
  name: string;
  variables: ModelicaVariable[] = [];
  equations: ModelicaEquation[] = [];
  stateMachines: ModelicaStateMachine[] = [];

  constructor(name: string) {
    this.name = name;
  }

  accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitState(this, argument);
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("state_" + this.name);
    for (const v of this.variables) hash.update(v.hash);
    for (const e of this.equations) hash.update(e.hash);
    for (const sm of this.stateMachines) hash.update(sm.hash);
    return hash.digest("hex");
  }

  get toJSON(): JSONValue {
    return {
      "@type": "State",
      name: this.name,
      variables: this.variables.map((v) => v.toJSON),
      equations: this.equations.map((e) => e.toJSON),
      stateMachines: this.stateMachines.map((sm) => sm.toJSON),
    };
  }

  get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaInitialStateEquation extends ModelicaEquation {
  stateName: string;

  constructor(stateName: string) {
    super();
    this.stateName = stateName;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitInitialStateEquation(this, argument);
  }

  override get hash(): string {
    return createHash("sha256")
      .update("initial_state_" + this.stateName)
      .digest("hex");
  }

  override get toJSON(): JSONValue {
    return { "@type": "InitialStateEquation", stateName: this.stateName };
  }

  override get toRDF(): Triple[] {
    return [];
  }
}

export class ModelicaTransitionEquation extends ModelicaEquation {
  fromState: string;
  toState: string;
  condition: ModelicaExpression;
  immediate: boolean;
  reset: boolean;
  synchronize: boolean;
  priority: number;

  constructor(
    fromState: string,
    toState: string,
    condition: ModelicaExpression,
    immediate: boolean,
    reset: boolean,
    synchronize: boolean,
    priority: number,
  ) {
    super();
    this.fromState = fromState;
    this.toState = toState;
    this.condition = condition;
    this.immediate = immediate;
    this.reset = reset;
    this.synchronize = synchronize;
    this.priority = priority;
  }

  override accept<R, A>(visitor: IModelicaDAEVisitor<R, A>, argument?: A): R {
    return visitor.visitTransitionEquation(this, argument);
  }

  override get hash(): string {
    const h = createHash("sha256").update("transition_" + this.fromState + "_" + this.toState);
    h.update(this.condition.hash);
    h.update((this.immediate ? 1 : 0).toString());
    h.update((this.reset ? 1 : 0).toString());
    h.update((this.synchronize ? 1 : 0).toString());
    h.update(this.priority.toString());
    return h.digest("hex");
  }

  override get toJSON(): JSONValue {
    return {
      "@type": "TransitionEquation",
      from: this.fromState,
      to: this.toState,
      condition: this.condition.toJSON,
      immediate: this.immediate,
      reset: this.reset,
      synchronize: this.synchronize,
      priority: this.priority,
    };
  }

  override get toRDF(): Triple[] {
    return [];
  }
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

  visitExpressionValue(node: ModelicaExpressionValue, argument?: A): R;
  visitExpressionVariable(node: ModelicaExpressionVariable, argument?: A): R;

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): R;

  visitColonExpression(node: ModelicaColonExpression, argument?: A): R;

  visitDAE(node: ModelicaDAE, argument?: A): R;

  visitClockVariable(node: ModelicaClockVariable, argument?: A): R;

  visitEnumerationLiteral(node: ModelicaEnumerationLiteral, argument?: A): R;

  visitEnumerationVariable(node: ModelicaEnumerationVariable, argument?: A): R;

  visitForEquation(node: ModelicaForEquation, argument?: A): R;

  visitFunctionCallEquation(node: ModelicaFunctionCallEquation, argument?: A): R;

  visitFunctionCallExpression(node: ModelicaFunctionCallExpression, argument?: A): R;

  visitPartialFunctionExpression(node: ModelicaPartialFunctionExpression, argument?: A): R;

  visitComprehensionExpression(node: ModelicaComprehensionExpression, argument?: A): R;

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

  visitArrayEquation(node: ModelicaArrayEquation, argument?: A): R;

  visitSubscriptedExpression(node: ModelicaSubscriptedExpression, argument?: A): R;

  visitTupleExpression(node: ModelicaTupleExpression, argument?: A): R;

  visitStringLiteral(node: ModelicaStringLiteral, argument?: A): R;

  visitStringVariable(node: ModelicaStringVariable, argument?: A): R;

  visitUnaryExpression(node: ModelicaUnaryExpression, argument?: A): R;

  visitWhenEquation(node: ModelicaWhenEquation, argument?: A): R;

  visitStateMachine(node: ModelicaStateMachine, argument?: A): R;

  visitState(node: ModelicaState, argument?: A): R;

  visitInitialStateEquation(node: ModelicaInitialStateEquation, argument?: A): R;

  visitTransitionEquation(node: ModelicaTransitionEquation, argument?: A): R;
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

  visitExpressionValue(node: ModelicaExpressionValue, argument?: A): void {
    node.value.accept(this, argument);
  }

  visitExpressionVariable(node: ModelicaExpressionVariable, argument?: A): void {
    /* no-op */
  }

  visitBooleanVariable(node: ModelicaBooleanVariable, argument?: A): void {
    /* no-op */
  }

  visitClockVariable(node: ModelicaClockVariable, argument?: A): void {
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

  visitFunctionCallEquation(node: ModelicaFunctionCallEquation, argument?: A): void {
    node.call.accept(this, argument);
  }

  visitFunctionCallExpression(node: ModelicaFunctionCallExpression, argument?: A): void {
    for (const arg of node.args) arg.accept(this, argument);
  }

  visitPartialFunctionExpression(node: ModelicaPartialFunctionExpression, argument?: A): void {
    for (const arg of node.namedArgs) arg.value.accept(this, argument);
  }

  visitComprehensionExpression(node: ModelicaComprehensionExpression, argument?: A): void {
    node.bodyExpression.accept(this, argument);
    for (const it of node.iterators) it.range.accept(this, argument);
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

  visitArrayEquation(node: ModelicaArrayEquation, argument?: A): void {
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

  visitTupleExpression(node: ModelicaTupleExpression, argument?: A): void {
    for (const element of node.elements) {
      if (element) element.accept(this, argument);
    }
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

  visitStateMachine(node: ModelicaStateMachine, argument?: A): void {
    for (const s of node.states) s.accept(this, argument);
    for (const eq of node.equations) eq.accept(this, argument);
  }

  visitState(node: ModelicaState, argument?: A): void {
    for (const v of node.variables) v.accept(this, argument);
    for (const eq of node.equations) eq.accept(this, argument);
    for (const sm of node.stateMachines) sm.accept(this, argument);
  }

  visitInitialStateEquation(node: ModelicaInitialStateEquation, argument?: A): void {
    /* no-op */
  }

  visitTransitionEquation(node: ModelicaTransitionEquation, argument?: A): void {
    node.condition.accept(this, argument);
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

  visitArrayEquation(node: ModelicaArrayEquation): void {
    this.out.write(this.indent());
    node.expression1.accept(this);
    this.out.write(" = ");
    node.expression2.accept(this);
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
      else this.out.write("_");
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
    if (node.isReturn) this.out.write("return ");
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
    // Determine if the current operator is multiplicative/power (higher precedence)
    const isHighPrec =
      node.operator === ModelicaBinaryOperator.MULTIPLICATION ||
      node.operator === ModelicaBinaryOperator.DIVISION ||
      node.operator === ModelicaBinaryOperator.EXPONENTIATION ||
      node.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION ||
      node.operator === ModelicaBinaryOperator.ELEMENTWISE_DIVISION ||
      node.operator === ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION;

    // Check if an operand needs parentheses: lower-precedence binary expr or unary minus
    const needsParens = (operand: ModelicaExpression): boolean => {
      if (
        isHighPrec &&
        operand instanceof ModelicaUnaryExpression &&
        operand.operator === ModelicaUnaryOperator.UNARY_MINUS
      ) {
        return true;
      }
      // Parenthesize additive/relational operands inside multiplicative/power operations
      if (isHighPrec && operand instanceof ModelicaBinaryExpression) {
        const op = operand.operator;
        if (
          op === ModelicaBinaryOperator.ADDITION ||
          op === ModelicaBinaryOperator.SUBTRACTION ||
          op === ModelicaBinaryOperator.LESS_THAN ||
          op === ModelicaBinaryOperator.LESS_THAN_OR_EQUAL ||
          op === ModelicaBinaryOperator.GREATER_THAN ||
          op === ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL ||
          op === ModelicaBinaryOperator.EQUALITY ||
          op === ModelicaBinaryOperator.INEQUALITY
        ) {
          return true;
        }
      }
      // Always parenthesize if-then-else expressions inside binary operators
      if (operand instanceof ModelicaIfElseExpression) return true;
      return false;
    };

    if (needsParens(node.operand1)) {
      this.out.write("(");
      node.operand1.accept(this);
      this.out.write(")");
    } else {
      node.operand1.accept(this);
    }
    this.out.write(" " + node.operator + " ");
    if (needsParens(node.operand2)) {
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
    this.out.write(this.indent());
    if (variable.isProtected) this.out.write("protected ");
    if (variable.isFinal) this.out.write("final ");
    if (variable.variability) this.out.write(variable.variability + " ");
    if (variable.causality) this.out.write(variable.causality + " ");
    if (variable.functionType) {
      // Function-typed parameter: emit f<function>(#Real u) => #Real format
      const ft = variable.functionType;
      const inputParts = ft.inputs.map((inp) => `#${inp.typeName} ${inp.name}`).join(", ");
      const outputType = ft.outputs.length > 0 ? `#${ft.outputs[0]?.typeName ?? "Real"}` : "#Real";
      this.out.write(`${variable.name}<function>(${inputParts}) => ${outputType}`);
    } else if (variable instanceof ModelicaBooleanVariable) {
      this.out.write("Boolean");
    } else if (variable instanceof ModelicaClockVariable) {
      this.out.write("Clock");
    } else if (variable instanceof ModelicaIntegerVariable) {
      this.out.write("Integer");
    } else if (variable instanceof ModelicaRealVariable) {
      this.out.write(variable.customTypeName ?? "Real");
    } else if (variable instanceof ModelicaStringVariable) {
      this.out.write("String");
    } else if (variable instanceof ModelicaExpressionVariable) {
      this.out.write("Expression");
    } else if (variable instanceof ModelicaEnumerationVariable) {
      this.out.write("enumeration(" + variable.enumerationLiterals.map((e) => e.stringValue).join(", ") + ")");
    } else {
      throw new Error("invalid variable");
    }
    // Handle array dimension prefix (encoded as \0[dims]\0name in the variable name)
    let varName = variable.name;
    if (varName.startsWith("\0")) {
      const parts = varName.split("\0");
      // parts = ["", "[dims]", "name"]
      if (parts.length >= 3) {
        this.out.write(parts[1] ?? ""); // [dims] — no space before
        varName = parts[2] ?? "";
      }
    }
    this.out.write(" " + varName);
    if (variable.attributes.size > 0) {
      this.out.write("(");
      const attrPriority: Record<string, number> = {
        value: 1,
        quantity: 2,
        unit: 3,
        displayUnit: 4,
        min: 5,
        max: 6,
        start: 7,
        fixed: 8,
        nominal: 9,
        stateSelect: 10,
      };
      const sortedEntries = Array.from(variable.attributes.entries()).sort((a, b) => {
        const pA = attrPriority[a[0]] ?? 99;
        const pB = attrPriority[b[0]] ?? 99;
        if (pA !== pB) return pA - pB;
        return a[0].localeCompare(b[0]);
      });
      let i = 0;
      for (const [key, expr] of sortedEntries) {
        this.out.write(key + " = ");
        expr.accept(this);
        if (++i < sortedEntries.length) this.out.write(", ");
      }
      this.out.write(")");
    }
    if (variable.expression) {
      this.out.write(" = ");
      variable.expression.accept(this);
    }
    if (variable.description) this.out.write(' "' + variable.description + '"');
    if (variable.cadAnnotationString) this.out.write(" annotation(" + variable.cadAnnotationString + ")");
    this.out.write(";\n");
  }

  visitDAE(node: ModelicaDAE): void {
    // Emit function definitions before the class, sorted alphabetically by name (matching OMC)
    const sortedFunctions = [...node.functions].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const fn of sortedFunctions) {
      this.#emitFunction(fn);
      this.out.write("\n\n");
    }
    this.out.write(node.classKind + " " + node.name);
    if (node.description) this.out.write(' "' + node.description + '"');
    this.out.write("\n");

    for (const variable of node.variables) {
      this.#emitVariable(variable);
    }
    for (const sm of node.stateMachines || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sm as any).accept(this as any);
    }
    if (node.initialEquations.length > 0) {
      this.out.write("initial equation\n");
      for (const equation of node.initialEquations) equation.accept(this);
    }
    for (const section of node.initialAlgorithms) {
      this.out.write("initial algorithm\n");
      for (const stmt of section) stmt.accept(this);
    }
    if (node.equations.length > 0) {
      this.out.write("equation\n");
      for (const equation of node.equations) equation.accept(this);
    }
    for (const section of node.algorithms) {
      this.out.write("algorithm\n");
      for (const stmt of section) stmt.accept(this);
    }
    this.out.write("end " + node.name + ";\n");
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
      this.out.write("\n  " + fn.externalDecl + "\n");
    }
    this.out.write("end " + fn.name + ";");

    // Recursively emit nested function definitions (e.g., inner functions
    // collected during body flattening of component-scoped functions)
    for (const nestedFn of fn.functions) {
      this.out.write("\n\n");
      this.#emitFunction(nestedFn);
    }
  }

  visitColonExpression(): void {
    this.out.write(":");
  }

  visitExpressionValue(node: ModelicaExpressionValue): void {
    node.value.accept(this);
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

  visitExpressionVariable(node: ModelicaExpressionVariable): void {
    this.out.write(node.name);
  }

  visitForEquation(node: ModelicaForEquation): void {
    this.out.write(this.indent() + "for " + node.indexName + " in ");
    node.range.accept(this);
    this.out.write(" loop\n");
    this.#depth++;
    for (const eq of node.equations) {
      eq.accept(this);
    }
    this.#depth--;
    this.out.write(this.indent() + "end for;\n");
  }

  visitFunctionCallEquation(node: ModelicaFunctionCallEquation): void {
    this.out.write(this.indent());
    node.call.accept(this);
    this.out.write(";\n");
  }

  visitFunctionCallExpression(node: ModelicaFunctionCallExpression): void {
    this.out.write(node.functionName + "(");
    for (let i = 0; i < node.args.length; i++) {
      if (i > 0) this.out.write(", ");
      node.args[i]?.accept(this);
    }
    this.out.write(")");
  }

  visitPartialFunctionExpression(node: ModelicaPartialFunctionExpression): void {
    this.out.write("function " + node.functionName + "(");
    for (let i = 0; i < node.namedArgs.length; i++) {
      if (i > 0) this.out.write(", ");
      this.out.write("#(");
      node.namedArgs[i]?.value.accept(this);
      this.out.write(")");
    }
    this.out.write(")");
  }

  visitComprehensionExpression(node: ModelicaComprehensionExpression): void {
    this.out.write(node.functionName + "(");
    node.bodyExpression.accept(this);
    for (const it of node.iterators) {
      this.out.write(" for " + it.name + " in ");
      it.range.accept(this);
    }
    this.out.write(")");
  }

  visitIfEquation(node: ModelicaIfEquation): void {
    this.out.write(this.indent() + "if ");
    node.condition.accept(this);
    this.out.write(" then\n");
    this.#depth++;
    for (const eq of node.equations) {
      eq.accept(this);
    }
    this.#depth--;
    for (const clause of node.elseIfClauses) {
      this.out.write(this.indent() + "elseif ");
      clause.condition.accept(this);
      this.out.write(" then\n");
      this.#depth++;
      for (const eq of clause.equations) {
        eq.accept(this);
      }
      this.#depth--;
    }
    if (node.elseEquations.length > 0) {
      this.out.write(this.indent() + "else\n");
      this.#depth++;
      for (const eq of node.elseEquations) {
        eq.accept(this);
      }
      this.#depth--;
    }
    this.out.write(this.indent() + "end if;\n");
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
    this.out.write(node.rawText ?? String(node.value));
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
    // Modelica real literal formatting matching OMC conventions:
    // - 0 → "0.0"
    // - Integer-valued → "N.0" (toFixed(1))
    // - |value| >= 0.001 → decimal notation (e.g., 0.1, 0.001)
    // - |value| < 0.001 → scientific notation (e.g., 1e-4, 1e-13)
    // - Very large integers → scientific notation
    if (node.value === 0) {
      this.out.write("0.0");
    } else if (Number.isInteger(node.value) && Math.abs(node.value) < 1e15) {
      this.out.write(node.value.toFixed(1));
    } else {
      let str: string;
      if (Number.isInteger(node.value) && Math.abs(node.value) >= 1e15) {
        str = node.value.toExponential();
      } else if (Math.abs(node.value) < 0.0001 && Math.abs(node.value) > 0) {
        // Very small fractional values: use scientific notation
        str = node.value.toExponential();
      } else {
        // Normal fractional values: use decimal notation
        str = node.value.toString();
      }
      // Modelica uses 'e-4' not 'e+4' — strip the '+' from positive exponents
      str = str.replace("e+", "e");
      // Pad single-digit exponents to two digits: e-6 → e-06, e6 → e06
      str = str.replace(/e(-?)(\d)$/, "e$10$2");
      this.out.write(str);
    }
  }

  visitRealVariable(node: ModelicaRealVariable): void {
    this.out.write(node.name);
  }

  visitSimpleEquation(node: ModelicaSimpleEquation): void {
    this.out.write(this.indent());
    node.expression1.accept(this);
    this.out.write(" = ");
    node.expression2.accept(this);
    if (node.description) this.out.write(' "' + node.description + '"');
    this.out.write(";\n");
  }

  visitStringLiteral(node: ModelicaStringLiteral): void {
    // Handle two parser behaviors:
    // 1. \\n is stored as 2-char escape sequence → unescape to actual newline + indentation
    // 2. \\\" is stored as bare " (parser already unescaped) → re-escape to \\"
    const indent = "  ".repeat(this.#depth + 1);
    const result = node.value
      .replace(/\\n/g, "\n" + indent) // unescape \\n → actual newline + indent
      .replace(/\\t/g, "\t") // unescape \\t → tab
      .replace(/\\r/g, "\r") // unescape \\r → carriage return
      .replace(/\\\\/g, "\\") // unescape \\\\ → backslash
      .replace(/"/g, '\\"'); // re-escape bare quotes: " → \\"
    this.out.write('"' + result + '"');
  }

  visitStringVariable(node: ModelicaStringVariable): void {
    this.out.write(node.name);
  }

  visitClockVariable(node: ModelicaClockVariable): void {
    this.out.write(node.name);
  }

  visitSubscriptedExpression(node: ModelicaSubscriptedExpression): void {
    node.base.accept(this);
    this.out.write("[");
    for (let i = 0; i < node.subscripts.length; i++) {
      if (i > 0) this.out.write(",");
      node.subscripts[i]?.accept(this);
    }
    this.out.write("]");
  }

  visitTupleExpression(node: ModelicaTupleExpression): void {
    this.out.write("(");
    for (let i = 0; i < node.elements.length; i++) {
      if (i > 0) this.out.write(", ");
      const el = node.elements[i];
      if (el) el.accept(this);
      else this.out.write("_");
    }
    this.out.write(")");
  }

  visitUnaryExpression(node: ModelicaUnaryExpression): void {
    const sep = /[a-z]/i.test(node.operator) ? " " : "";
    this.out.write(node.operator + sep);
    // Add parentheses when the operand is a binary expression to preserve precedence
    const needsParens = node.operand instanceof ModelicaBinaryExpression;
    if (needsParens) this.out.write("(");
    node.operand.accept(this);
    if (needsParens) this.out.write(")");
  }

  visitWhenEquation(node: ModelicaWhenEquation): void {
    this.out.write(this.indent() + "when ");
    node.condition.accept(this);
    this.out.write(" then\n");
    this.#depth++;
    for (const eq of node.equations) {
      eq.accept(this);
    }
    this.#depth--;
    for (const clause of node.elseWhenClauses) {
      this.out.write(this.indent() + "elsewhen ");
      clause.condition.accept(this);
      this.out.write(" then\n");
      this.#depth++;
      for (const eq of clause.equations) {
        eq.accept(this);
      }
      this.#depth--;
    }
    this.out.write(this.indent() + "end when;\n");
  }

  visitStateMachine(node: ModelicaStateMachine): void {
    this.out.write(this.indent() + "stateMachine " + node.name + "\n");
    this.#depth++;
    for (const state of node.states) {
      state.accept(this);
    }
    if (node.equations.length > 0) {
      this.out.write(this.indent() + "equation\n");
      this.#depth++;
      for (const eq of node.equations) {
        eq.accept(this);
      }
      this.#depth--;
    }
    this.#depth--;
    this.out.write(this.indent() + "end " + node.name + ";\n");
  }

  visitState(node: ModelicaState): void {
    this.out.write(this.indent() + "state " + node.name + "\n");
    this.#depth++;
    for (const variable of node.variables) {
      this.#emitVariable(variable);
    }
    for (const sm of node.stateMachines) {
      sm.accept(this);
    }
    if (node.equations.length > 0) {
      this.out.write(this.indent() + "equation\n");
      this.#depth++;
      for (const eq of node.equations) {
        eq.accept(this);
      }
      this.#depth--;
    }
    this.#depth--;
    this.out.write(this.indent() + "end " + node.name + ";\n");
  }

  visitInitialStateEquation(node: ModelicaInitialStateEquation): void {
    this.out.write(this.indent() + "initialState(" + node.stateName + ");\n");
  }

  visitTransitionEquation(node: ModelicaTransitionEquation): void {
    this.out.write(this.indent() + "transition(" + node.fromState + ", " + node.toState + ", ");
    node.condition.accept(this);
    this.out.write(", " + node.immediate + ", " + node.reset + ", " + node.synchronize + ", " + node.priority + ");\n");
  }
}

// ---------------------------------------------------------------------------
// Pantelides algorithm for structural index reduction of DAE systems
// ---------------------------------------------------------------------------

function pantelidesExtractVarName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaVariable) return expr.name;
  if (expr instanceof ModelicaNameExpression) return expr.name;
  return null;
}

function pantelidesIsZeroLiteral(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 0;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 0;
  return false;
}

class PantelidesDepVisitor extends ModelicaDAEVisitor<Set<string>> {
  override visitNameExpression(expr: ModelicaNameExpression, deps?: Set<string>): void {
    if (deps) deps.add(expr.name);
  }
  override visitRealVariable(node: ModelicaRealVariable, deps?: Set<string>): void {
    if (deps) deps.add(node.name);
  }
  override visitIntegerVariable(node: ModelicaIntegerVariable, deps?: Set<string>): void {
    if (deps) deps.add(node.name);
  }
  override visitExpressionVariable(node: ModelicaExpressionVariable, deps?: Set<string>): void {
    if (deps) deps.add(node.name);
  }
}

function differentiateExpression(expr: ModelicaExpression, stateVars: Set<string>): ModelicaExpression {
  const ZERO = new ModelicaRealLiteral(0);

  const diff = (e: ModelicaExpression): ModelicaExpression => {
    if (e instanceof ModelicaRealLiteral || e instanceof ModelicaIntegerLiteral) return ZERO;

    if (e instanceof ModelicaNameExpression || e instanceof ModelicaVariable) {
      const name = e instanceof ModelicaNameExpression ? e.name : (e as ModelicaVariable).name;
      if (stateVars.has(name)) return new ModelicaNameExpression(`der(${name})`);
      return ZERO;
    }

    if (e instanceof ModelicaUnaryExpression && e.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      const da = diff(e.operand);
      if (da instanceof ModelicaRealLiteral && da.value === 0) return ZERO;
      return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, da);
    }

    if (e instanceof ModelicaBinaryExpression) {
      const op = e.operator;

      // Sum / difference rule
      if (
        op === ModelicaBinaryOperator.ADDITION ||
        op === ModelicaBinaryOperator.ELEMENTWISE_ADDITION ||
        op === ModelicaBinaryOperator.SUBTRACTION ||
        op === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION
      ) {
        const da = diff(e.operand1);
        const db = diff(e.operand2);
        const daZ = da instanceof ModelicaRealLiteral && da.value === 0;
        const dbZ = db instanceof ModelicaRealLiteral && db.value === 0;
        if (daZ && dbZ) return ZERO;
        if (daZ) {
          if (op === ModelicaBinaryOperator.SUBTRACTION || op === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION)
            return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, db);
          return db;
        }
        if (dbZ) return da;
        return new ModelicaBinaryExpression(op, da, db);
      }

      // Product rule
      if (op === ModelicaBinaryOperator.MULTIPLICATION || op === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION) {
        const da = diff(e.operand1);
        const db = diff(e.operand2);
        const daZ = da instanceof ModelicaRealLiteral && da.value === 0;
        const dbZ = db instanceof ModelicaRealLiteral && db.value === 0;
        if (daZ && dbZ) return ZERO;
        if (daZ) return new ModelicaBinaryExpression(op, e.operand1, db);
        if (dbZ) return new ModelicaBinaryExpression(op, da, e.operand2);
        return new ModelicaBinaryExpression(
          ModelicaBinaryOperator.ADDITION,
          new ModelicaBinaryExpression(op, e.operand1, db),
          new ModelicaBinaryExpression(op, da, e.operand2),
        );
      }

      // Quotient rule
      if (op === ModelicaBinaryOperator.DIVISION || op === ModelicaBinaryOperator.ELEMENTWISE_DIVISION) {
        const da = diff(e.operand1);
        const db = diff(e.operand2);
        const daZ = da instanceof ModelicaRealLiteral && da.value === 0;
        const dbZ = db instanceof ModelicaRealLiteral && db.value === 0;
        if (daZ && dbZ) return ZERO;
        if (dbZ) return new ModelicaBinaryExpression(op, da, e.operand2);
        const num = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.SUBTRACTION,
          new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, da, e.operand2),
          new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, e.operand1, db),
        );
        const den = new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, e.operand2, e.operand2);
        return new ModelicaBinaryExpression(op, num, den);
      }
    }

    return ZERO; // conservative fallback
  };

  return diff(expr);
}

function trySolveForState(
  lhs: ModelicaBinaryExpression,
  rhs: ModelicaExpression,
  involvedStates: Set<string>,
): { state: string; expr: ModelicaExpression } | null {
  if (
    lhs.operator === ModelicaBinaryOperator.SUBTRACTION ||
    lhs.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION
  ) {
    const op1 = pantelidesExtractVarName(lhs.operand1);
    const op2 = pantelidesExtractVarName(lhs.operand2);
    if (op1 && involvedStates.has(op1) && pantelidesIsZeroLiteral(rhs)) return { state: op1, expr: lhs.operand2 };
    if (op2 && involvedStates.has(op2) && pantelidesIsZeroLiteral(rhs)) return { state: op2, expr: lhs.operand1 };
  }

  if (
    lhs.operator === ModelicaBinaryOperator.ADDITION ||
    lhs.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION
  ) {
    const op1 = pantelidesExtractVarName(lhs.operand1);
    const op2 = pantelidesExtractVarName(lhs.operand2);
    if (op1 && involvedStates.has(op1) && pantelidesIsZeroLiteral(rhs))
      return {
        state: op1,
        expr: new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, lhs.operand2),
      };
    if (op2 && involvedStates.has(op2) && pantelidesIsZeroLiteral(rhs))
      return {
        state: op2,
        expr: new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, lhs.operand1),
      };
  }

  return null;
}

/**
 * Walk an expression tree and find a state variable that appears in a subtraction
 * position. Returns the state name and the rearranged expression solving for that state.
 *
 * For `C3.v = C1.v + 0.0 - C2.v - 0.0`:
 *   - Flattens to terms: [+C1.v, +0.0, -C2.v, -0.0]
 *   - C2.v is subtracted and is a state → returns {state: "C2.v", expr: C1.v + 0.0 - C3.v - 0.0}
 *     (i.e., positive terms minus LHS minus other negative terms)
 */
function findSubtractedState(
  expr: ModelicaExpression,
  involvedStates: Set<string>,
  lhsState: string,
  alreadyDemoted: Set<string>,
): { state: string; expr: ModelicaExpression } | null {
  // Flatten addition/subtraction tree into signed terms
  const terms: { expr: ModelicaExpression; sign: number }[] = [];
  const flatten = (e: ModelicaExpression, sign: number) => {
    if (
      e instanceof ModelicaBinaryExpression &&
      (e.operator === ModelicaBinaryOperator.ADDITION || e.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
    ) {
      flatten(e.operand1, sign);
      flatten(e.operand2, sign);
    } else if (
      e instanceof ModelicaBinaryExpression &&
      (e.operator === ModelicaBinaryOperator.SUBTRACTION ||
        e.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION)
    ) {
      flatten(e.operand1, sign);
      flatten(e.operand2, -sign);
    } else if (e instanceof ModelicaUnaryExpression && e.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      flatten(e.operand, -sign);
    } else {
      terms.push({ expr: e, sign });
    }
  };
  flatten(expr, 1);

  // Find a subtracted state (sign === -1) that is not the LHS and not already demoted
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (!term || term.sign !== -1) continue;
    const name = pantelidesExtractVarName(term.expr);
    if (!name || name === lhsState || !involvedStates.has(name) || alreadyDemoted.has(name)) continue;

    // Found a subtracted state — rearrange to solve for it.
    // Original: lhsState = sum_of_terms (where term[i] is -name)
    // Rearranged: name = sum_of_other_terms - lhsState
    // Build: (positive terms) - (negative terms except term[i]) - lhsState
    const otherTerms = terms.filter((_, idx) => idx !== i);
    // Add -lhsState to the terms
    otherTerms.push({ expr: new ModelicaNameExpression(lhsState), sign: -1 });

    // Build expression from terms
    let result: ModelicaExpression | null = null;
    for (const t of otherTerms) {
      const termExpr = t.sign < 0 ? new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, t.expr) : t.expr;
      if (result === null) {
        result = termExpr;
      } else {
        result = new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, result, termExpr);
      }
    }
    if (!result) result = new ModelicaRealLiteral(0);

    return { state: name, expr: result };
  }
  return null;
}

export interface PantelidesResult {
  dummyDerivatives: Set<string>;
  constraintAssignments: { target: string; expr: ModelicaExpression; isDerivative: boolean }[];
}

export function pantelidesIndexReduction(
  algebraicEquations: { lhs: ModelicaExpression; rhs: ModelicaExpression }[],
  stateVars: Set<string>,
  parameters: Map<string, number>,
  definedVars: Set<string>,
): PantelidesResult {
  const dummyDerivatives = new Set<string>();
  const constraintAssignments: PantelidesResult["constraintAssignments"] = [];

  const visitor = new PantelidesDepVisitor();

  for (const eq of algebraicEquations) {
    const allVars = new Set<string>();
    eq.lhs.accept(visitor, allVars);
    eq.rhs.accept(visitor, allVars);

    const involvedStates = new Set<string>();
    let hasUndefinedNonState = false;
    for (const v of allVars) {
      if (stateVars.has(v)) {
        involvedStates.add(v);
      } else if (!definedVars.has(v) && !parameters.has(v) && v !== "time") {
        hasUndefinedNonState = true;
      }
    }

    if (involvedStates.size < 2 || hasUndefinedNonState) continue;

    const lhsName = pantelidesExtractVarName(eq.lhs);
    const rhsName = pantelidesExtractVarName(eq.rhs);

    let constrainedState: string | null = null;
    let constraintExpr: ModelicaExpression | null = null;

    if (lhsName && involvedStates.has(lhsName)) {
      // LHS is a state. Before defaulting to demoting the LHS, check if a
      // RHS state in a subtraction position is a better candidate.
      // In KVL-derived constraints like `C3.v = C1.v - C2.v`, the subtracted
      // state (C2.v) is typically the one in parallel with an inductor and
      // should be demoted, not the LHS state (C3.v) which just happened to
      // have its equation left unmatched due to processing order.
      const rhsSubtractedState = findSubtractedState(eq.rhs, involvedStates, lhsName, dummyDerivatives);
      if (rhsSubtractedState) {
        // Solve for the subtracted state: X = A - B → B = A - X
        // Rearrange: constrainedState = B, expr = (everything else)
        constrainedState = rhsSubtractedState.state;
        constraintExpr = rhsSubtractedState.expr;
      } else {
        constrainedState = lhsName;
        constraintExpr = eq.rhs;
      }
    } else if (rhsName && involvedStates.has(rhsName)) {
      constrainedState = rhsName;
      constraintExpr = eq.lhs;
    } else {
      if (eq.lhs instanceof ModelicaBinaryExpression) {
        const solved = trySolveForState(eq.lhs, eq.rhs, involvedStates);
        if (solved) {
          constrainedState = solved.state;
          constraintExpr = solved.expr;
        }
      }
      if (!constrainedState && eq.rhs instanceof ModelicaBinaryExpression) {
        const solved = trySolveForState(eq.rhs, eq.lhs, involvedStates);
        if (solved) {
          constrainedState = solved.state;
          constraintExpr = solved.expr;
        }
      }
    }

    if (!constrainedState || !constraintExpr) continue;
    if (dummyDerivatives.has(constrainedState)) continue;

    dummyDerivatives.add(constrainedState);

    constraintAssignments.push({
      target: constrainedState,
      expr: constraintExpr,
      isDerivative: false,
    });

    const derExpr = differentiateExpression(constraintExpr, stateVars);
    constraintAssignments.push({
      target: constrainedState,
      expr: derExpr,
      isDerivative: true,
    });

    const dotIdx = constrainedState.lastIndexOf(".");
    if (dotIdx >= 0) {
      const prefix = constrainedState.substring(0, dotIdx);
      const currentVar = `${prefix}.i`;
      const capacitanceParam = `${prefix}.C`;
      if (parameters.has(capacitanceParam)) {
        const currentExpr = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.MULTIPLICATION,
          new ModelicaNameExpression(capacitanceParam),
          new ModelicaNameExpression(`der(${constrainedState})`),
        );
        constraintAssignments.push({ target: currentVar, expr: currentExpr, isDerivative: false });
      }
    }
  }

  return { dummyDerivatives, constraintAssignments };
}
