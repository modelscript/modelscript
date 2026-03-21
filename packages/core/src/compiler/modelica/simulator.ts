// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ExpressionEvaluator,
  type ModelicaDAE,
  ModelicaDAEVisitor,
  type ModelicaEquation,
  type ModelicaExpression,
  ModelicaFunctionCallEquation,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaSimpleEquation,
  ModelicaVariable,
  ModelicaWhenEquation,
} from "./dae.js";
import { ModelicaVariability } from "./syntax.js";

/** Describes a single action inside a when-clause body. */
interface WhenAction {
  type: "reinit" | "assign";
  /** Variable name to reinitialize or assign. */
  target: string;
  /** Right-hand side expression to evaluate when the clause fires. */
  expr: ModelicaExpression;
}

/** A when-clause ready for evaluation during simulation. */
interface WhenClause {
  /** Condition expression. */
  condition: ModelicaExpression;
  /** Actions to execute when the condition fires (rising edge). */
  actions: WhenAction[];
  /** Tracks whether the condition was active at the previous time step. */
  wasActive: boolean;
}

function extractDerName(expr: unknown): string | null {
  if (expr && typeof expr === "object" && "functionName" in expr && "args" in expr) {
    const funcExpr = expr as { functionName: string; args: unknown[] };
    if (funcExpr.functionName === "der" && funcExpr.args.length === 1) {
      const arg0 = funcExpr.args[0];
      if (arg0 && typeof arg0 === "object" && "name" in arg0) {
        const nameVal = (arg0 as { name: unknown }).name;
        if (typeof nameVal === "string") return nameVal;
      }
    }
  }

  if (expr && typeof expr === "object" && "name" in expr) {
    const nameVal = (expr as { name: unknown }).name;
    if (typeof nameVal === "string" && nameVal.startsWith("der(") && nameVal.endsWith(")")) {
      return nameVal.substring(4, nameVal.length - 1);
    }
  }

  return null;
}

// Extract variables used in an expression
class DependencyVisitor extends ModelicaDAEVisitor<Set<string>> {
  override visitNameExpression(expr: ModelicaNameExpression, deps?: Set<string>): void {
    if (deps && !expr.name.startsWith("der(")) {
      deps.add(expr.name);
    }
  }
}

/** Extract a variable name from a DAE expression. */
function extractVarName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaVariable) return expr.name;
  if (expr instanceof ModelicaNameExpression) return expr.name;
  return null;
}

export class ModelicaSimulator {
  dae: ModelicaDAE;
  stateVars = new Set<string>();
  algebraicVars = new Set<string>();
  /** Parameter/constant values extracted from dae.variables. */
  parameters = new Map<string, number>();
  sortedEquations: { target: string; expr: ModelicaExpression; isDerivative: boolean }[] = [];
  /** When-clauses extracted from the DAE. */
  whenClauses: WhenClause[] = [];

  constructor(dae: ModelicaDAE) {
    this.dae = dae;
  }

  public prepare(): void {
    const assignments: { target: string; expr: ModelicaExpression; isDerivative: boolean }[] = [];
    const definedVars = new Set<string>();

    // Extract parameter and constant values from DAE variable declarations
    this.parameters.clear();
    const paramEvaluator = new ExpressionEvaluator();
    for (const v of this.dae.variables) {
      if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
        if (v.expression) {
          const val = paramEvaluator.evaluate(v.expression);
          if (val !== null) {
            this.parameters.set(v.name, val);
            // Make params available for evaluating other param expressions
            paramEvaluator.env.set(v.name, val);
          }
        }
      }
    }

    for (const eq of this.dae.equations) {
      if (eq instanceof ModelicaWhenEquation) {
        // When-clauses handled separately below
        continue;
      }
      if (eq && typeof eq === "object" && "expression1" in eq && "expression2" in eq) {
        const simpleEq = eq as unknown as { expression1: unknown; expression2: unknown };
        const lhsDer = extractDerName(simpleEq.expression1);
        const rhsDer = extractDerName(simpleEq.expression2);

        if (lhsDer) {
          assignments.push({ target: lhsDer, expr: simpleEq.expression2 as ModelicaExpression, isDerivative: true });
          this.stateVars.add(lhsDer);
          definedVars.add(`der(${lhsDer})`);
        } else if (rhsDer) {
          assignments.push({ target: rhsDer, expr: simpleEq.expression1 as ModelicaExpression, isDerivative: true });
          this.stateVars.add(rhsDer);
          definedVars.add(`der(${rhsDer})`);
        } else {
          const isNameExpr1 =
            simpleEq.expression1 && typeof simpleEq.expression1 === "object" && "name" in simpleEq.expression1;
          if (isNameExpr1) {
            const nameVal = (simpleEq.expression1 as { name: unknown }).name;
            if (typeof nameVal === "string") {
              const target = nameVal;
              assignments.push({ target, expr: simpleEq.expression2 as ModelicaExpression, isDerivative: false });
              this.algebraicVars.add(target);
              definedVars.add(target);
            }
          }
        }
      }
    }

    for (const s of this.stateVars) {
      this.algebraicVars.delete(s);
    }

    const dependencyMap = new Map<string, Set<string>>();
    const visitor = new DependencyVisitor();

    for (const assign of assignments) {
      const deps = new Set<string>();
      assign.expr.accept(visitor, deps);
      dependencyMap.set(assign.isDerivative ? `der(${assign.target})` : assign.target, deps);
    }

    const sorted: typeof assignments = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (key: string) => {
      if (visited.has(key)) return;
      if (visiting.has(key)) return;
      visiting.add(key);

      const deps = dependencyMap.get(key) || new Set();
      for (const dep of deps) {
        if (definedVars.has(dep)) {
          visit(dep);
        }
      }

      visiting.delete(key);
      visited.add(key);
      const assign = assignments.find((a) => (a.isDerivative ? `der(${a.target})` : a.target) === key);
      if (assign) sorted.push(assign);
    };

    for (const assign of assignments) {
      visit(assign.isDerivative ? `der(${assign.target})` : assign.target);
    }

    this.sortedEquations = sorted;

    // Extract when-clauses
    this.whenClauses = [];
    for (const eq of this.dae.equations) {
      if (eq instanceof ModelicaWhenEquation) {
        const mainClause = this.buildWhenClause(eq.condition, eq.equations);
        if (mainClause) this.whenClauses.push(mainClause);
        for (const elseWhen of eq.elseWhenClauses) {
          const clause = this.buildWhenClause(elseWhen.condition, elseWhen.equations);
          if (clause) this.whenClauses.push(clause);
        }
      }
    }
  }

  /** Build a WhenClause from a condition and body equations. */
  private buildWhenClause(condition: ModelicaExpression, equations: ModelicaEquation[]): WhenClause | null {
    const actions: WhenAction[] = [];
    for (const bodyEq of equations) {
      if (bodyEq instanceof ModelicaFunctionCallEquation) {
        const call = bodyEq.call;
        if (call.functionName === "reinit" && call.args.length >= 2) {
          const reinitTarget = call.args[0];
          const reinitExpr = call.args[1];
          if (reinitTarget && reinitExpr) {
            const targetName = extractVarName(reinitTarget);
            if (targetName) {
              actions.push({ type: "reinit", target: targetName, expr: reinitExpr });
            }
          }
        }
      } else if (bodyEq instanceof ModelicaSimpleEquation) {
        const targetName = extractVarName(bodyEq.expression1);
        if (targetName) {
          actions.push({ type: "assign", target: targetName, expr: bodyEq.expression2 });
        }
      }
    }
    if (actions.length === 0) return null;
    return { condition, actions, wasActive: false };
  }

  public simulate(
    startTime: number,
    stopTime: number,
    step: number,
    options?: { signal?: AbortSignal },
  ): { t: number[]; y: number[][]; states: string[] } {
    this.prepare();

    const stateVarsArr = Array.from(this.stateVars);
    const algebraicVarsArr = Array.from(this.algebraicVars);
    const stateList = [...stateVarsArr, ...algebraicVarsArr];

    // Resolve initial values: check initial equations first, then variable start attributes
    const paramEnv = new Map(this.parameters);
    const initialValues = stateList.map((state) => {
      // 1. Check initial equations (evaluate RHS with parameter env)
      for (const eq of this.dae.initialEquations) {
        if (eq instanceof ModelicaSimpleEquation) {
          const lhsName = extractVarName(eq.expression1);
          if (lhsName === state) {
            const initEval = new ExpressionEvaluator(new Map(paramEnv));
            const val = initEval.evaluate(eq.expression2);
            if (val !== null) return val;
          }
        }
      }
      // 2. Check variable start attributes
      for (const v of this.dae.variables) {
        if (v.name === state) {
          // Try binding expression first (for non-parameter vars with bindings)
          if (v.expression) {
            if (v.expression instanceof ModelicaRealLiteral) return v.expression.value;
            if (v.expression instanceof ModelicaIntegerLiteral) return v.expression.value;
          }
          // Try start attribute
          const startAttr = v.attributes.get("start");
          if (startAttr) {
            if (startAttr instanceof ModelicaRealLiteral) return startAttr.value;
            if (startAttr instanceof ModelicaIntegerLiteral) return startAttr.value;
            // Try evaluating the start expression
            const evalResult = new ExpressionEvaluator(new Map(this.parameters)).evaluate(startAttr);
            if (evalResult !== null) return evalResult;
          }
          break;
        }
      }
      return 0.0;
    });

    // Map from state name → index for fast reinit lookups
    const stateIndexMap = new Map<string, number>();
    for (let i = 0; i < stateList.length; i++) {
      const name = stateList[i];
      if (name) stateIndexMap.set(name, i);
    }

    // Create the evaluator
    const evaluator = new ExpressionEvaluator();
    evaluator.stepSize = step;

    // Initialize pre-values with initial values
    for (let i = 0; i < stateList.length; i++) {
      const name = stateList[i];
      if (name) evaluator.preValues.set(name, initialValues[i] ?? 0);
    }

    // Load parameter/constant values into the evaluator environment
    for (const [name, value] of this.parameters) {
      evaluator.env.set(name, value);
    }

    // Build the environment from current state
    const populateEnv = (t: number, y: number[]) => {
      evaluator.env.set("time", t);
      for (let i = 0; i < stateList.length; i++) {
        const name = stateList[i];
        if (name) evaluator.env.set(name, y[i] ?? 0.0);
      }
    };

    // Evaluate the derivative function f(t, y) → dy/dt
    const f = (t: number, y: number[]): number[] => {
      if (options?.signal?.aborted) {
        throw new Error("Simulation aborted");
      }

      populateEnv(t, y);

      // Evaluate sorted equations (algebraic + derivatives)
      for (const eq of this.sortedEquations) {
        const value = evaluator.evaluate(eq.expr);
        if (value !== null) {
          if (eq.isDerivative) {
            evaluator.env.set(`der(${eq.target})`, value);
          } else {
            evaluator.env.set(eq.target, value);
          }
        }
      }

      return stateList.map((state) => evaluator.env.get(`der(${state})`) ?? 0.0);
    };

    const res = this.rk4WithEvents(
      f,
      startTime,
      stopTime,
      initialValues,
      step,
      stateList,
      stateIndexMap,
      evaluator,
      options?.signal,
    );

    // Append derivative columns so both x and der(x) appear in results
    const derNames = stateVarsArr.map((s) => `der(${s})`);
    const allStates = [...stateList, ...derNames];
    const allY = res.y.map((row, idx) => {
      const derivs = f(res.t[idx] ?? 0, row);
      return [...row, ...derivs.slice(0, stateVarsArr.length)];
    });

    return { t: res.t, y: allY, states: allStates };
  }

  /** RK4 integrator with event detection and reinit support. */
  private rk4WithEvents(
    f: (t: number, y: number[]) => number[],
    t0: number,
    t1: number,
    y0: number[],
    h: number,
    states: string[],
    stateIndexMap: Map<string, number>,
    evaluator: ExpressionEvaluator,
    signal?: AbortSignal,
  ) {
    const t: number[] = [];
    const y: number[][] = [];

    let current_t = t0;
    const current_y = [...y0];

    const n = states.length;

    // Evaluate when-conditions at initial time to set wasActive flags
    if (this.whenClauses.length > 0) {
      evaluator.isInitial = true;
      evaluator.isTerminal = false;
      evaluator.env.set("time", current_t);
      for (let i = 0; i < states.length; i++) {
        const name = states[i];
        if (name) evaluator.env.set(name, current_y[i] ?? 0);
      }

      for (const clause of this.whenClauses) {
        const condVal = evaluator.evaluate(clause.condition);
        const isActive = condVal !== null && condVal !== 0;
        if (isActive) {
          this.fireWhenActions(clause, evaluator, current_y, stateIndexMap);
        }
        clause.wasActive = isActive;
      }
      evaluator.isInitial = false;
    }

    t.push(current_t);
    y.push([...current_y]);

    while (current_t < t1) {
      if (signal?.aborted) {
        throw new Error("Simulation aborted");
      }
      if (current_t + h > t1) h = t1 - current_t;

      const k1 = f(current_t, current_y);
      const y_k2 = new Array(n);
      for (let i = 0; i < n; i++) y_k2[i] = (current_y[i] ?? 0) + 0.5 * h * (k1[i] ?? 0);

      const k2 = f(current_t + 0.5 * h, y_k2);
      const y_k3 = new Array(n);
      for (let i = 0; i < n; i++) y_k3[i] = (current_y[i] ?? 0) + 0.5 * h * (k2[i] ?? 0);

      const k3 = f(current_t + 0.5 * h, y_k3);
      const y_k4 = new Array(n);
      for (let i = 0; i < n; i++) y_k4[i] = (current_y[i] ?? 0) + h * (k3[i] ?? 0);

      const k4 = f(current_t + h, y_k4);

      for (let i = 0; i < n; i++) {
        current_y[i] =
          (current_y[i] ?? 0) + (h / 6.0) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0));
      }
      current_t += h;

      // --- Event detection and processing ---
      if (this.whenClauses.length > 0) {
        evaluator.isTerminal = current_t >= t1 - h * 0.01;
        evaluator.env.set("time", current_t);
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.env.set(name, current_y[i] ?? 0);
        }

        for (const clause of this.whenClauses) {
          const condVal = evaluator.evaluate(clause.condition);
          const isActive = condVal !== null && condVal !== 0;

          if (isActive && !clause.wasActive) {
            // Rising edge detected — fire actions
            this.fireWhenActions(clause, evaluator, current_y, stateIndexMap);
          }
          clause.wasActive = isActive;
        }

        // Update pre-values for the next step
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.preValues.set(name, current_y[i] ?? 0);
        }
      }

      t.push(current_t);
      y.push([...current_y]);
    }

    return { t, y, states };
  }

  /** Execute the actions of a triggered when-clause (reinit, assign). */
  private fireWhenActions(
    clause: WhenClause,
    evaluator: ExpressionEvaluator,
    current_y: number[],
    stateIndexMap: Map<string, number>,
  ): void {
    for (const action of clause.actions) {
      const value = evaluator.evaluate(action.expr);
      if (value === null || isNaN(value)) continue;

      const idx = stateIndexMap.get(action.target);
      if (idx !== undefined) {
        current_y[idx] = value;
        // Also update the environment so subsequent actions see the new value
        evaluator.env.set(action.target, value);
      }
    }
  }
}
