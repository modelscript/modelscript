// SPDX-License-Identifier: AGPL-3.0-or-later

import * as math from "mathjs";
import { StringWriter } from "../../util/io.js";
import {
  type ModelicaDAE,
  ModelicaDAEPrinter,
  ModelicaDAEVisitor,
  type ModelicaExpression,
  ModelicaFunctionCallExpression,
  ModelicaLiteral,
  ModelicaNameExpression,
  ModelicaSimpleEquation,
} from "./dae.js";

function extractDerName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "der") {
    const arg0 = expr.args[0];
    const operand = arg0 as unknown as { name?: string };
    if (expr.args.length === 1 && arg0 && "name" in arg0 && typeof operand.name === "string") {
      return operand.name ?? "";
    }
  }
  if (expr instanceof ModelicaNameExpression && expr.name.startsWith("der(") && expr.name.endsWith(")")) {
    return expr.name.substring(4, expr.name.length - 1);
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

export class ModelicaSimulator {
  dae: ModelicaDAE;
  stateVars = new Set<string>();
  algebraicVars = new Set<string>();
  constants = new Map<string, number>();
  sortedEquations: { target: string; expr: ModelicaExpression; isDerivative: boolean }[] = [];

  constructor(dae: ModelicaDAE) {
    this.dae = dae;
  }

  public prepare(): void {
    const assignments: { target: string; expr: ModelicaExpression; isDerivative: boolean }[] = [];
    const definedVars = new Set<string>();

    for (const eq of this.dae.equations) {
      if (eq instanceof ModelicaSimpleEquation) {
        const lhsDer = extractDerName(eq.expression1);
        const rhsDer = extractDerName(eq.expression2);

        if (lhsDer) {
          assignments.push({ target: lhsDer, expr: eq.expression2, isDerivative: true });
          this.stateVars.add(lhsDer);
          definedVars.add(`der(${lhsDer})`);
        } else if (rhsDer) {
          assignments.push({ target: rhsDer, expr: eq.expression1, isDerivative: true });
          this.stateVars.add(rhsDer);
          definedVars.add(`der(${rhsDer})`);
        } else if (eq.expression1 instanceof ModelicaNameExpression) {
          const target = eq.expression1.name;
          assignments.push({ target, expr: eq.expression2, isDerivative: false });
          this.algebraicVars.add(target);
          definedVars.add(target);
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
  }

  public simulate(
    startTime: number,
    stopTime: number,
    step: number,
  ): { t: number[]; y: number[][]; states?: string[] } {
    this.prepare();

    const stateList = Array.from(this.stateVars);
    const env = new Map<string, number>();

    // 2. Initial state
    const initialValues = Array.from(this.stateVars).map((v) => {
      const variable = this.dae.variables.find((vari) => vari.name === v);
      if (variable && variable.attributes.has("start")) {
        const startExpr = variable.attributes.get("start");
        if (startExpr instanceof ModelicaLiteral) {
          const literalVal = (startExpr as unknown as { value?: string | number }).value;
          return Number(literalVal || 0.0);
        }
      }
      return 0.0; // Default fallback
    });
    for (const state of stateList) {
      env.set(state, 0.0);
    }

    for (const eq of this.dae.initialEquations) {
      if (eq instanceof ModelicaSimpleEquation) {
        if (eq.expression1 instanceof ModelicaNameExpression) {
          if (eq.expression2 instanceof ModelicaLiteral) {
            // Approximate fallback for literal values
            const literalVal = (eq.expression2 as unknown as { value?: string | number }).value;
            const valStr = literalVal?.toString() || "0";
            env.set(eq.expression1.name, Number(valStr));
          }
        }
      }
    }

    const toMathjs = (expr: ModelicaExpression): string => {
      const writer = new StringWriter();
      expr.accept(new ModelicaDAEPrinter(writer));
      return writer.toString();
    };

    const compiledEquations = this.sortedEquations.map((seq) => {
      const exprStr = toMathjs(seq.expr).replace(/\./g, "_");
      return {
        target: seq.isDerivative ? `der_${seq.target.replace(/\./g, "_")}` : seq.target.replace(/\./g, "_"),
        isDerivative: seq.isDerivative,
        stateName: seq.target,
        node: math.parse(exprStr),
      };
    });

    const f = (t: number, y: number[]) => {
      const scope: Record<string, number> = { time: t };
      for (let i = 0; i < stateList.length; i++) {
        const stateStr = stateList[i];
        if (stateStr) scope[stateStr.replace(/\./g, "_")] = y[i] ?? 0.0;
      }

      for (const eq of compiledEquations) {
        scope[eq.target] = eq.node.evaluate(scope);
      }

      return stateList.map((state) => scope[`der_${state.replace(/\./g, "_")}`] ?? 0.0);
    };

    const y0 = initialValues;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (math as any).solveODE === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (math as any).solveODE(f, [startTime, stopTime], y0, { step });
    } else {
      return this.rk4(f, startTime, stopTime, y0, step, stateList);
    }
  }

  private rk4(
    f: (t: number, y: number[]) => number[],
    t0: number,
    t1: number,
    y0: number[],
    h: number,
    states: string[],
  ) {
    const t = [];
    const y = [];

    let current_t = t0;
    const current_y = [...y0];

    t.push(current_t);
    y.push([...current_y]);

    const n = states.length;

    while (current_t < t1) {
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

      t.push(current_t);
      y.push([...current_y]);
    }

    return { t, y, states };
  }
}
