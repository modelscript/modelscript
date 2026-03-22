// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ExpressionEvaluator,
  ModelicaBinaryExpression,
  ModelicaBooleanVariable,
  type ModelicaDAE,
  ModelicaDAEVisitor,
  ModelicaEnumerationVariable,
  type ModelicaEquation,
  type ModelicaExpression,
  ModelicaFunctionCallEquation,
  ModelicaIntegerLiteral,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaRealVariable,
  ModelicaSimpleEquation,
  ModelicaVariable,
  ModelicaWhenEquation,
} from "./dae.js";
import { ModelicaBinaryOperator, ModelicaVariability } from "./syntax.js";

/** Describes a single action inside a when-clause body. */
interface WhenAction {
  type: "reinit" | "assign";
  /** Variable name to reinitialize or assign. */
  target: string;
  /** Right-hand side expression to evaluate when the clause fires. */
  expr: ModelicaExpression;
}

/**
 * Zero-crossing direction: the sign change that triggers the event.
 * - `negative`: fires when g goes from positive → negative (e.g. `h < 0`)
 * - `positive`: fires when g goes from negative → positive (e.g. `x > 0`)
 * - `either`: fires on any sign change
 */
type ZeroCrossingDirection = "negative" | "positive" | "either";

/** A when-clause ready for evaluation during simulation. */
interface WhenClause {
  /** Condition expression (evaluated as boolean: nonzero = true). */
  condition: ModelicaExpression;
  /** Actions to execute when the condition fires (rising edge). */
  actions: WhenAction[];
  /** Tracks whether the condition was active at the previous time step. */
  wasActive: boolean;
  /**
   * If the condition is a relational comparison (e.g. `h < 0`), this evaluates
   * the continuous zero-crossing function `g(t,y)` whose sign change triggers
   * the event.  For `h < 0`, g = LHS - RHS = h - 0 = h.
   * Returns null when the condition cannot be decomposed into a zero-crossing.
   */
  zeroCrossingFn: ((evaluator: ExpressionEvaluator) => number | null) | null;
  /** Which direction of sign change triggers this event. */
  zeroCrossingDirection: ZeroCrossingDirection;
  /** Previous value of the zero-crossing function. */
  gPrev: number;
}

/** Maximum events processed per integration step to prevent chattering loops. */
const MAX_EVENTS_PER_STEP = 10;
/** Bisection tolerance for locating zero-crossing time. */
const BISECT_TOL = 1e-10;
/** Maximum bisection iterations. */
const BISECT_MAX_ITER = 50;

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

/**
 * Build a zero-crossing function from a relational condition expression.
 *
 * For `LHS < RHS`  or `LHS <= RHS`:  g = LHS - RHS, direction = negative
 * For `LHS > RHS`  or `LHS >= RHS`:  g = LHS - RHS, direction = positive
 *
 * Returns null if the condition is not a simple relational expression.
 */
function buildZeroCrossing(condition: ModelicaExpression): {
  fn: (evaluator: ExpressionEvaluator) => number | null;
  direction: ZeroCrossingDirection;
} | null {
  if (!(condition instanceof ModelicaBinaryExpression)) return null;

  const op = condition.operator;
  let direction: ZeroCrossingDirection;

  switch (op) {
    case ModelicaBinaryOperator.LESS_THAN:
    case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
      direction = "negative";
      break;
    case ModelicaBinaryOperator.GREATER_THAN:
    case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
      direction = "positive";
      break;
    default:
      return null; // Not a relational operator we can bisect on
  }

  const lhs = condition.operand1;
  const rhs = condition.operand2;

  const fn = (evaluator: ExpressionEvaluator): number | null => {
    const lVal = evaluator.evaluate(lhs);
    const rVal = evaluator.evaluate(rhs);
    if (lVal === null || rVal === null) return null;
    return lVal - rVal; // g = LHS - RHS
  };

  return { fn, direction };
}

/** Rich metadata about a single parameter variable for the UI. */
export interface ParameterInfo {
  name: string;
  type: "real" | "integer" | "boolean" | "enumeration";
  defaultValue: number;
  min?: number;
  max?: number;
  step: number;
  unit?: string;
  enumLiterals?: { ordinal: number; label: string }[];
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

    // Try to extract a zero-crossing function from the condition
    const zc = buildZeroCrossing(condition);

    return {
      condition,
      actions,
      wasActive: false,
      zeroCrossingFn: zc?.fn ?? null,
      zeroCrossingDirection: zc?.direction ?? "either",
      gPrev: 0,
    };
  }

  /** Metadata about a single parameter variable for the UI. */
  public getParameterInfo(): ParameterInfo[] {
    const evaluator = new ExpressionEvaluator(new Map(this.parameters));
    const infos: ParameterInfo[] = [];
    for (const v of this.dae.variables) {
      if (v.variability !== ModelicaVariability.PARAMETER) continue;
      const defaultValue = this.parameters.get(v.name);
      if (defaultValue === undefined) continue;

      let type: ParameterInfo["type"] = "real";
      let step = 0.1;
      let min: number | undefined;
      let max: number | undefined;
      let enumLiterals: { ordinal: number; label: string }[] | undefined;

      if (v instanceof ModelicaBooleanVariable) {
        type = "boolean";
        step = 1;
      } else if (v instanceof ModelicaIntegerVariable) {
        type = "integer";
        step = 1;
        const minExpr = v.min;
        const maxExpr = v.max;
        if (minExpr) {
          const val = evaluator.evaluate(minExpr);
          if (val !== null) min = val;
        }
        if (maxExpr) {
          const val = evaluator.evaluate(maxExpr);
          if (val !== null) max = val;
        }
      } else if (v instanceof ModelicaEnumerationVariable) {
        type = "enumeration";
        step = 1;
        enumLiterals = v.enumerationLiterals.map((lit) => ({
          ordinal: lit.ordinalValue,
          label: lit.stringValue,
        }));
      } else if (v instanceof ModelicaRealVariable) {
        type = "real";
        step = 0.1;
        const minExpr = v.min;
        const maxExpr = v.max;
        if (minExpr) {
          const val = evaluator.evaluate(minExpr);
          if (val !== null) min = val;
        }
        if (maxExpr) {
          const val = evaluator.evaluate(maxExpr);
          if (val !== null) max = val;
        }
      }

      const info: ParameterInfo = { name: v.name, type, defaultValue, step };
      if (min !== undefined) info.min = min;
      if (max !== undefined) info.max = max;
      if (enumLiterals !== undefined) info.enumLiterals = enumLiterals;

      // Extract unit string from Real variables
      if (v instanceof ModelicaRealVariable && v.unit) {
        const raw = v.unit.toJSON?.toString?.()?.replace(/^"|"$/g, "");
        if (raw) info.unit = raw;
      }

      infos.push(info);
    }
    return infos;
  }

  public simulate(
    startTime: number,
    stopTime: number,
    step: number,
    options?: { signal?: AbortSignal; parameterOverrides?: Map<string, number> },
  ): { t: number[]; y: number[][]; states: string[] } {
    this.prepare();

    // Apply user-supplied parameter overrides (without re-flattening)
    if (options?.parameterOverrides) {
      for (const [name, value] of options.parameterOverrides) {
        if (this.parameters.has(name)) {
          this.parameters.set(name, value);
        }
      }
    }

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

  // ──────────────────────────────────────────────────────────────────
  //  RK4 step helper — integrates a single step from (t, y) to (t+h, y_new)
  // ──────────────────────────────────────────────────────────────────
  private rk4Step(f: (t: number, y: number[]) => number[], t: number, y: number[], h: number, n: number): number[] {
    const k1 = f(t, y);
    const y_k2 = new Array(n);
    for (let i = 0; i < n; i++) y_k2[i] = (y[i] ?? 0) + 0.5 * h * (k1[i] ?? 0);

    const k2 = f(t + 0.5 * h, y_k2);
    const y_k3 = new Array(n);
    for (let i = 0; i < n; i++) y_k3[i] = (y[i] ?? 0) + 0.5 * h * (k2[i] ?? 0);

    const k3 = f(t + 0.5 * h, y_k3);
    const y_k4 = new Array(n);
    for (let i = 0; i < n; i++) y_k4[i] = (y[i] ?? 0) + h * (k3[i] ?? 0);

    const k4 = f(t + h, y_k4);

    const y_new = new Array(n);
    for (let i = 0; i < n; i++) {
      y_new[i] = (y[i] ?? 0) + (h / 6.0) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0));
    }
    return y_new;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Evaluate zero-crossing functions for all when-clauses
  // ──────────────────────────────────────────────────────────────────
  private evaluateZeroCrossings(evaluator: ExpressionEvaluator, t: number, y: number[], states: string[]): number[] {
    evaluator.env.set("time", t);
    for (let i = 0; i < states.length; i++) {
      const name = states[i];
      if (name) evaluator.env.set(name, y[i] ?? 0);
    }
    return this.whenClauses.map((clause) => {
      if (clause.zeroCrossingFn) {
        return clause.zeroCrossingFn(evaluator) ?? 0;
      }
      // For non-decomposable conditions, fall back to boolean
      const condVal = evaluator.evaluate(clause.condition);
      // Map boolean to a continuous-ish value: true → -1, false → +1
      return condVal !== null && condVal !== 0 ? -1 : 1;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  Detect which when-clause had a triggering sign change
  // ──────────────────────────────────────────────────────────────────
  private detectTriggeredClause(gPre: number[], gPost: number[]): number {
    for (let i = 0; i < this.whenClauses.length; i++) {
      const clause = this.whenClauses[i];
      if (!clause) continue;
      const pre = gPre[i] ?? 0;
      const post = gPost[i] ?? 0;

      if (clause.zeroCrossingDirection === "negative") {
        // Fires when g goes from > 0 to <= 0
        if (pre > 0 && post <= 0) return i;
      } else if (clause.zeroCrossingDirection === "positive") {
        // Fires when g goes from < 0 to >= 0
        if (pre < 0 && post >= 0) return i;
      } else {
        // "either" — any sign change
        if ((pre > 0 && post <= 0) || (pre < 0 && post >= 0)) return i;
      }
    }
    return -1;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Bisect to find the exact zero-crossing time using Illinois method
  // ──────────────────────────────────────────────────────────────────
  private bisectEvent(
    f: (t: number, y: number[]) => number[],
    tA: number,
    yA: number[],
    gA: number,
    tB: number,
    gB: number,
    n: number,
    clauseIdx: number,
    evaluator: ExpressionEvaluator,
    states: string[],
  ): { t: number; y: number[] } {
    let tLo = tA;
    let tHi = tB;
    let yLo = yA;
    let gLo = gA;
    let gHi = gB;

    for (let iter = 0; iter < BISECT_MAX_ITER; iter++) {
      if (Math.abs(tHi - tLo) < BISECT_TOL) break;

      // Illinois method: use regula falsi with Illinois modification
      let tMid: number;
      const denom = gHi - gLo;
      if (Math.abs(denom) < 1e-15) {
        tMid = (tLo + tHi) / 2;
      } else {
        tMid = tLo - (gLo * (tHi - tLo)) / denom;
        // Clamp to stay within bounds
        tMid = Math.max(tLo + BISECT_TOL, Math.min(tHi - BISECT_TOL, tMid));
      }

      const dt = tMid - tLo;
      const yMid = this.rk4Step(f, tLo, yLo, dt, n);

      // Evaluate zero-crossing at midpoint
      const gAll = this.evaluateZeroCrossings(evaluator, tMid, yMid, states);
      const gMid = gAll[clauseIdx] ?? 0;

      if (gMid * gLo <= 0) {
        // Root is in [tLo, tMid]
        tHi = tMid;
        gHi = gMid;
      } else {
        // Root is in [tMid, tHi]
        tLo = tMid;
        yLo = yMid;
        gLo = gMid;
        // Illinois modification: halve gHi to ensure convergence
        gHi = gHi / 2;
      }
    }

    // Final integration to the located time
    if (Math.abs(tLo - tA) > BISECT_TOL) {
      return { t: tLo, y: yLo };
    }
    const dtFinal = tLo - tA;
    const yFinal = dtFinal > BISECT_TOL ? this.rk4Step(f, tA, yA, dtFinal, n) : [...yA];
    return { t: tLo, y: yFinal };
  }

  /** RK4 integrator with zero-crossing event detection, bisection, and restart. */
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
    let current_y = [...y0];

    const n = states.length;

    // Evaluate when-conditions at initial time to set wasActive flags and gPrev
    evaluator.isInitial = true;
    evaluator.isTerminal = false;

    const gInit = this.evaluateZeroCrossings(evaluator, current_t, current_y, states);
    for (let i = 0; i < this.whenClauses.length; i++) {
      const clause = this.whenClauses[i];
      if (!clause) continue;
      clause.gPrev = gInit[i] ?? 0;
      const condVal = evaluator.evaluate(clause.condition);
      const isActive = condVal !== null && condVal !== 0;
      if (isActive) {
        this.fireWhenActions(clause, evaluator, current_y, stateIndexMap);
      }
      clause.wasActive = isActive;
    }
    evaluator.isInitial = false;

    t.push(current_t);
    y.push([...current_y]);

    let eventsThisStep = 0;
    let t_last_event = current_t;

    while (current_t < t1) {
      if (signal?.aborted) {
        throw new Error("Simulation aborted");
      }

      // Reset event counter if we've moved forward appreciably
      if (current_t > t_last_event + h * 0.1) {
        eventsThisStep = 0;
      }

      let stepH = h;
      if (current_t + stepH > t1) stepH = t1 - current_t;

      // 1. Evaluate zero-crossings at the start of the step
      const gPre = this.evaluateZeroCrossings(evaluator, current_t, current_y, states);

      // 2. Take a tentative RK4 step
      const y_tentative = this.rk4Step(f, current_t, current_y, stepH, n);
      const t_tentative = current_t + stepH;

      // 3. Evaluate zero-crossings at the end of the step
      const gPost = this.evaluateZeroCrossings(evaluator, t_tentative, y_tentative, states);

      // 4. Check for a triggering sign change
      const triggeredIdx = this.detectTriggeredClause(gPre, gPost);

      const clause = triggeredIdx >= 0 ? this.whenClauses[triggeredIdx] : undefined;

      if (clause && eventsThisStep < MAX_EVENTS_PER_STEP) {
        eventsThisStep++;
        t_last_event = current_t;

        // Event detected! Bisect to find the exact event time.
        const gA = gPre[triggeredIdx] ?? 0;
        const gB = gPost[triggeredIdx] ?? 0;

        const event = this.bisectEvent(
          f,
          current_t,
          current_y,
          gA,
          t_tentative,
          gB,
          n,
          triggeredIdx,
          evaluator,
          states,
        );

        // Record the pre-event state at event time
        t.push(event.t);
        y.push([...event.y]);

        // Update pre-values to the state just before the event
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.preValues.set(name, event.y[i] ?? 0);
        }

        // Fire the when-clause actions (reinit, assign)
        evaluator.env.set("time", event.t);
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.env.set(name, event.y[i] ?? 0);
        }
        this.fireWhenActions(clause, evaluator, event.y, stateIndexMap);
        clause.wasActive = true;

        // Record the post-event state at the same time (discontinuity)
        t.push(event.t);
        y.push([...event.y]);

        // Restart integration from the event time with the new state
        current_t = event.t;
        current_y = [...event.y];

        // Re-evaluate zero-crossings after the event to update gPrev
        const gAfter = this.evaluateZeroCrossings(evaluator, current_t, current_y, states);
        for (let i = 0; i < this.whenClauses.length; i++) {
          const c = this.whenClauses[i];
          if (c) c.gPrev = gAfter[i] ?? 0;
        }
      } else {
        // No event — accept the step normally
        current_t = t_tentative;
        current_y = y_tentative;

        // Update when-clause state
        evaluator.isTerminal = current_t >= t1 - h * 0.01;
        evaluator.env.set("time", current_t);
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.env.set(name, current_y[i] ?? 0);
        }
        for (let i = 0; i < this.whenClauses.length; i++) {
          const clause = this.whenClauses[i];
          if (!clause) continue;
          const condVal = evaluator.evaluate(clause.condition);
          const isActive = condVal !== null && condVal !== 0;
          clause.wasActive = isActive;
          clause.gPrev = gPost[i] ?? 0;
        }

        // Update pre-values for the next step
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.preValues.set(name, current_y[i] ?? 0);
        }

        t.push(current_t);
        y.push([...current_y]);
      }
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
