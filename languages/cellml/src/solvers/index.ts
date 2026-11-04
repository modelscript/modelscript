// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Multi-Compartment ODE, Algebraic & Rush-Larsen Electrophysiology Solver.
 *
 * Resolves connected variables across CellML components, topologically sorts algebraic equations,
 * and integrates state ODEs using 4th-order Runge-Kutta (RK4) and Rush-Larsen exponential gating integration.
 */

import type { CellmlComponent, CellmlDocument } from "../types.js";

export interface CellmlSolverOptions {
  duration?: number | undefined;
  dt?: number | undefined;
  method?: "rk4" | "rush-larsen" | undefined;
}

export interface CellmlTrajectoryStep {
  time: number;
  values: Record<string, number>;
}

export interface CellmlSimulationResult {
  modelName: string;
  time: number[];
  states: Record<string, number[]>;
  variables: Record<string, number[]>;
  initialValues: Record<string, number>;
  finalValues: Record<string, number>;
  trajectory: CellmlTrajectoryStep[];
  stepsCount: number;
  rushLarsenVariables: string[];
}

type ExprEvaluator = (env: ReadonlyMap<string, number>) => number;

/**
 * Compiles a mathematical infix expression string into a zero-eval closure evaluator.
 */
export function compileCellmlExpr(formula: string): ExprEvaluator {
  const trimmed = formula.trim();
  if (!trimmed) return () => 0.0;

  type TokenType = "NUM" | "ID" | "OP" | "LPAREN" | "RPAREN" | "COMMA";
  interface Token {
    type: TokenType;
    value: string;
  }

  const tokens: Token[] = [];
  let pos = 0;
  const n = trimmed.length;

  while (pos < n) {
    const ch = trimmed[pos] ?? "";
    const next = trimmed[pos + 1] ?? "";

    if (/\s/.test(ch)) {
      pos++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (pos < n && /[0-9.eE+-]/.test(trimmed[pos] ?? "")) {
        if ((trimmed[pos] === "+" || trimmed[pos] === "-") && !/[eE]/.test(trimmed[pos - 1] ?? "")) {
          break;
        }
        numStr += trimmed[pos] ?? "";
        pos++;
      }
      tokens.push({ type: "NUM", value: numStr });
    } else if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (pos < n && /[a-zA-Z0-9_]/.test(trimmed[pos] ?? "")) {
        idStr += trimmed[pos] ?? "";
        pos++;
      }
      tokens.push({ type: "ID", value: idStr });
    } else if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      pos++;
    } else if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      pos++;
    } else if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      pos++;
    } else if (ch === "*" && next === "*") {
      tokens.push({ type: "OP", value: "^" });
      pos += 2;
    } else if (
      (ch === ">" && next === "=") ||
      (ch === "<" && next === "=") ||
      (ch === "=" && next === "=") ||
      (ch === "!" && next === "=") ||
      (ch === "&" && next === "&") ||
      (ch === "|" && next === "|")
    ) {
      tokens.push({ type: "OP", value: ch + next });
      pos += 2;
    } else if ("+-*/^%><=!".includes(ch)) {
      tokens.push({ type: "OP", value: ch === "=" ? "==" : ch });
      pos++;
    } else {
      pos++;
    }
  }

  let idx = 0;
  const peek = (): Token | undefined => tokens[idx];
  const consume = (): Token => tokens[idx++] ?? { type: "NUM", value: "0" };

  function parseLogicalOr(): ExprEvaluator {
    let left = parseLogicalAnd();
    while (peek()?.type === "OP" && peek()?.value === "||") {
      consume();
      const right = parseLogicalAnd();
      const prev = left;
      left = (env) => (prev(env) !== 0.0 || right(env) !== 0.0 ? 1.0 : 0.0);
    }
    return left;
  }

  function parseLogicalAnd(): ExprEvaluator {
    let left = parseRelational();
    while (peek()?.type === "OP" && peek()?.value === "&&") {
      consume();
      const right = parseRelational();
      const prev = left;
      left = (env) => (prev(env) !== 0.0 && right(env) !== 0.0 ? 1.0 : 0.0);
    }
    return left;
  }

  function parseRelational(): ExprEvaluator {
    let left = parseAdditive();
    while (
      peek()?.type === "OP" &&
      (peek()?.value === ">" ||
        peek()?.value === "<" ||
        peek()?.value === ">=" ||
        peek()?.value === "<=" ||
        peek()?.value === "==" ||
        peek()?.value === "!=")
    ) {
      const op = consume().value;
      const right = parseAdditive();
      const prev = left;
      if (op === ">") left = (env) => (prev(env) > right(env) ? 1.0 : 0.0);
      else if (op === "<") left = (env) => (prev(env) < right(env) ? 1.0 : 0.0);
      else if (op === ">=") left = (env) => (prev(env) >= right(env) ? 1.0 : 0.0);
      else if (op === "<=") left = (env) => (prev(env) <= right(env) ? 1.0 : 0.0);
      else if (op === "==") left = (env) => (Math.abs(prev(env) - right(env)) <= 1e-12 ? 1.0 : 0.0);
      else left = (env) => (Math.abs(prev(env) - right(env)) > 1e-12 ? 1.0 : 0.0);
    }
    return left;
  }

  function parseAdditive(): ExprEvaluator {
    let left = parseMultiplicative();
    while (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const right = parseMultiplicative();
      const prev = left;
      left = op === "+" ? (env) => prev(env) + right(env) : (env) => prev(env) - right(env);
    }
    return left;
  }

  function parseMultiplicative(): ExprEvaluator {
    let left = parsePower();
    while (peek()?.type === "OP" && (peek()?.value === "*" || peek()?.value === "/" || peek()?.value === "%")) {
      const op = consume().value;
      const right = parsePower();
      const prev = left;
      if (op === "*") {
        left = (env) => prev(env) * right(env);
      } else if (op === "/") {
        left = (env) => {
          const d = right(env);
          return d !== 0.0 ? prev(env) / d : 0.0;
        };
      } else {
        left = (env) => {
          const d = right(env);
          return d !== 0.0 ? prev(env) % d : 0.0;
        };
      }
    }
    return left;
  }

  function parsePower(): ExprEvaluator {
    const base = parseUnary();
    if (peek()?.type === "OP" && peek()?.value === "^") {
      consume();
      const exp = parsePower();
      return (env) => Math.pow(base(env), exp(env));
    }
    return base;
  }

  function parseUnary(): ExprEvaluator {
    if (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-" || peek()?.value === "!")) {
      const op = consume().value;
      const inner = parseUnary();
      if (op === "-") return (env) => -inner(env);
      if (op === "!") return (env) => (inner(env) === 0.0 ? 1.0 : 0.0);
      return inner;
    }
    return parsePrimary();
  }

  function parsePrimary(): ExprEvaluator {
    const tok = peek();
    if (!tok) return () => 0.0;

    if (tok.type === "NUM") {
      consume();
      const num = Number(tok.value);
      return () => (Number.isNaN(num) ? 0.0 : num);
    }

    if (tok.type === "LPAREN") {
      consume();
      const inner = parseLogicalOr();
      if (peek()?.type === "RPAREN") consume();
      return inner;
    }

    if (tok.type === "ID") {
      consume();
      const id = tok.value;

      if (id === "true") return () => 1.0;
      if (id === "false") return () => 0.0;
      if (id === "pi") return () => Math.PI;
      if (id === "e") return () => Math.E;

      if (peek()?.type === "LPAREN") {
        consume();
        const args: ExprEvaluator[] = [];
        if (peek() && peek()?.type !== "RPAREN") {
          args.push(parseLogicalOr());
          while (peek()?.type === "COMMA") {
            consume();
            args.push(parseLogicalOr());
          }
        }
        if (peek()?.type === "RPAREN") consume();

        const fn = id.toLowerCase();
        if (fn === "exp") return (env) => Math.exp(args[0]?.(env) ?? 0.0);
        if (fn === "ln" || fn === "log") return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1.0));
        if (fn === "log10") return (env) => Math.log10(Math.max(1e-15, args[0]?.(env) ?? 1.0));
        if (fn === "sqrt") return (env) => Math.sqrt(Math.max(0.0, args[0]?.(env) ?? 0.0));
        if (fn === "pow") return (env) => Math.pow(args[0]?.(env) ?? 0.0, args[1]?.(env) ?? 1.0);
        if (fn === "abs") return (env) => Math.abs(args[0]?.(env) ?? 0.0);
        if (fn === "floor") return (env) => Math.floor(args[0]?.(env) ?? 0.0);
        if (fn === "ceil" || fn === "ceiling") return (env) => Math.ceil(args[0]?.(env) ?? 0.0);
        if (fn === "sin") return (env) => Math.sin(args[0]?.(env) ?? 0.0);
        if (fn === "cos") return (env) => Math.cos(args[0]?.(env) ?? 0.0);
        if (fn === "tan") return (env) => Math.tan(args[0]?.(env) ?? 0.0);
        if (fn === "asin") return (env) => Math.asin(args[0]?.(env) ?? 0.0);
        if (fn === "acos") return (env) => Math.acos(args[0]?.(env) ?? 0.0);
        if (fn === "atan") return (env) => Math.atan(args[0]?.(env) ?? 0.0);
        if (fn === "sinh") return (env) => Math.sinh(args[0]?.(env) ?? 0.0);
        if (fn === "cosh") return (env) => Math.cosh(args[0]?.(env) ?? 0.0);
        if (fn === "tanh") return (env) => Math.tanh(args[0]?.(env) ?? 0.0);
        if (fn === "min") return (env) => Math.min(args[0]?.(env) ?? 0.0, args[1]?.(env) ?? 0.0);
        if (fn === "max") return (env) => Math.max(args[0]?.(env) ?? 0.0, args[1]?.(env) ?? 0.0);
        if (fn === "piecewise") {
          return (env) => {
            for (let i = 0; i + 1 < args.length; i += 2) {
              const cond = args[i]?.(env) ?? 0.0;
              if (cond !== 0.0) {
                return args[i + 1]?.(env) ?? 0.0;
              }
            }
            return args.length % 2 === 1 ? (args[args.length - 1]?.(env) ?? 0.0) : 0.0;
          };
        }
        return () => 0.0;
      }

      return (env) => env.get(id) ?? 0.0;
    }

    consume();
    return () => 0.0;
  }

  try {
    return parseLogicalOr();
  } catch {
    return () => 0.0;
  }
}

export interface ResolvedCellmlConnectionMap {
  /** Maps any qualified variable `comp.var` to its canonical source `sourceComp.sourceVar`. */
  canonicalSource: Map<string, string>;
  /** Directed edges `targetComp.targetVar -> sourceComp.sourceVar` for connections. */
  targetToSource: Map<string, string>;
}

/**
 * Resolves all `<connection>` variable mappings into directed `target (in) -> source (out)` links
 * and transitive canonical source variables.
 */
export function resolveCellmlConnections(doc: CellmlDocument): ResolvedCellmlConnectionMap {
  const targetToSource = new Map<string, string>();

  // Build encapsulation parent lookup
  const parentOf = new Map<string, string>();
  const walkEncap = (parent: string, children: typeof doc.encapsulation): void => {
    for (const c of children) {
      if (parent && c.componentRef) {
        parentOf.set(c.componentRef, parent);
      }
      walkEncap(c.componentRef, c.children);
    }
  };
  for (const root of doc.encapsulation) {
    walkEncap(root.componentRef, root.children);
  }

  // Track which variables are assigned by equations in their own component
  const assignedVars = new Set<string>();
  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (eq.targetVariable) {
        assignedVars.add(`${comp.name}.${eq.targetVariable}`);
      }
    }
  }

  for (const conn of doc.connections) {
    const comp1 = doc.components.get(conn.component1);
    const comp2 = doc.components.get(conn.component2);
    if (!comp1 || !comp2) continue;

    const c1IsParent = parentOf.get(comp2.name) === comp1.name;
    const c2IsParent = parentOf.get(comp1.name) === comp2.name;

    for (const m of conn.mappings) {
      const v1 = comp1.variables.get(m.variable1);
      const v2 = comp2.variables.get(m.variable2);
      if (!v1 || !v2) continue;

      const q1 = `${comp1.name}.${v1.name}`;
      const q2 = `${comp2.name}.${v2.name}`;

      let iface1 = v1.publicInterface;
      let iface2 = v2.publicInterface;
      if (c1IsParent) {
        iface1 = v1.privateInterface !== "none" ? v1.privateInterface : v1.publicInterface;
        iface2 = v2.publicInterface;
      } else if (c2IsParent) {
        iface1 = v1.publicInterface;
        iface2 = v2.privateInterface !== "none" ? v2.privateInterface : v2.publicInterface;
      }

      if (iface1 === "in" && iface2 === "out") {
        targetToSource.set(q1, q2);
      } else if (iface2 === "in" && iface1 === "out") {
        targetToSource.set(q2, q1);
      } else if (v1.initialValue !== undefined || assignedVars.has(q1)) {
        targetToSource.set(q2, q1);
      } else if (v2.initialValue !== undefined || assignedVars.has(q2)) {
        targetToSource.set(q1, q2);
      } else {
        targetToSource.set(q2, q1);
      }
    }
  }

  const canonicalSource = new Map<string, string>();
  for (const comp of doc.components.values()) {
    for (const v of comp.variables.values()) {
      const q = `${comp.name}.${v.name}`;
      let curr = q;
      const visited = new Set<string>([curr]);
      while (targetToSource.has(curr)) {
        const next = targetToSource.get(curr)!;
        if (visited.has(next)) break;
        visited.add(next);
        curr = next;
      }
      canonicalSource.set(q, curr);
    }
  }

  return { canonicalSource, targetToSource };
}

interface CompiledAlgebraicEq {
  compName: string;
  targetVar: string;
  qualTarget: string;
  canonicalTarget: string;
  evaluator: ExprEvaluator;
  dependencies: string[];
}

interface CompiledOdeEq {
  compName: string;
  targetVar: string;
  qualTarget: string;
  canonicalTarget: string;
  independentVar: string;
  evaluator: ExprEvaluator;
}

function sortAlgebraicEquationsTopologically(eqs: CompiledAlgebraicEq[]): CompiledAlgebraicEq[] {
  const byTarget = new Map<string, CompiledAlgebraicEq>();
  for (const eq of eqs) {
    byTarget.set(eq.canonicalTarget, eq);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: CompiledAlgebraicEq[] = [];

  const visit = (eq: CompiledAlgebraicEq): void => {
    if (visited.has(eq.canonicalTarget)) return;
    if (visiting.has(eq.canonicalTarget)) return;
    visiting.add(eq.canonicalTarget);

    for (const dep of eq.dependencies) {
      const depEq = byTarget.get(dep);
      if (depEq && !visited.has(depEq.canonicalTarget)) {
        visit(depEq);
      }
    }

    visiting.delete(eq.canonicalTarget);
    visited.add(eq.canonicalTarget);
    ordered.push(eq);
  };

  for (const eq of eqs) {
    visit(eq);
  }

  return ordered;
}

/**
 * Simulates a CellML document by resolving cross-component connections,
 * topologically evaluating algebraic equations, and integrating ODE state variables
 * via RK4 and Rush-Larsen gating integration.
 */
export function solveCellml(doc: CellmlDocument, options?: CellmlSolverOptions): CellmlSimulationResult {
  const duration = options?.duration ?? 10.0;
  const dt = options?.dt ?? 0.01;
  const method = options?.method ?? "rk4";
  const steps = Math.max(1, Math.round(duration / dt));

  const { canonicalSource } = resolveCellmlConnections(doc);
  const getCanonical = (qualId: string): string => canonicalSource.get(qualId) ?? qualId;

  const rawAlgEqs: CompiledAlgebraicEq[] = [];
  const odeEqs: CompiledOdeEq[] = [];
  const independentCanonicalVars = new Set<string>();

  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const qualTarget = `${comp.name}.${eq.targetVariable}`;
      const canonicalTarget = getCanonical(qualTarget);
      const evaluator = compileCellmlExpr(eq.rhsExpression);

      if (eq.isOde) {
        const indep = eq.independentVariable ?? "time";
        independentCanonicalVars.add(getCanonical(`${comp.name}.${indep}`));
        odeEqs.push({
          compName: comp.name,
          targetVar: eq.targetVariable,
          qualTarget,
          canonicalTarget,
          independentVar: indep,
          evaluator,
        });
      } else {
        const deps = eq.referencedIdentifiers.map((id) => getCanonical(`${comp.name}.${id}`));
        rawAlgEqs.push({
          compName: comp.name,
          targetVar: eq.targetVariable,
          qualTarget,
          canonicalTarget,
          evaluator,
          dependencies: deps,
        });
      }
    }
  }

  const sortedAlgEqs = sortAlgebraicEquationsTopologically(rawAlgEqs);

  // Initialize canonical variable store
  const canonicalValues = new Map<string, number>();
  for (const comp of doc.components.values()) {
    for (const v of comp.variables.values()) {
      const qual = `${comp.name}.${v.name}`;
      const can = getCanonical(qual);
      if (v.initialValue !== undefined) {
        canonicalValues.set(can, v.initialValue);
      } else if (!canonicalValues.has(can)) {
        canonicalValues.set(can, 0.0);
      }
      if ((v.name === "time" || v.name === "t") && v.initialValue === undefined && !canonicalSource.has(qual)) {
        independentCanonicalVars.add(can);
      }
    }
  }

  // Helper to evaluate a component equation using local variable lookup backed by canonical store
  const evalInComponent = (
    comp: CellmlComponent,
    evaluator: ExprEvaluator,
    store: Map<string, number>,
    time: number,
  ): number => {
    const localEnv = new Map<string, number>();
    for (const v of comp.variables.values()) {
      const can = getCanonical(`${comp.name}.${v.name}`);
      if (independentCanonicalVars.has(can)) {
        localEnv.set(v.name, time);
      } else {
        localEnv.set(v.name, store.get(can) ?? 0.0);
      }
    }
    if (!localEnv.has("time")) localEnv.set("time", time);
    if (!localEnv.has("t")) localEnv.set("t", time);
    return evaluator(localEnv);
  };

  // Propagate independent variables and evaluate topological algebraic equations
  const updateAlgebraicAndConnections = (store: Map<string, number>, time: number): void => {
    for (const indepCan of independentCanonicalVars) {
      store.set(indepCan, time);
    }
    for (const alg of sortedAlgEqs) {
      const comp = doc.components.get(alg.compName);
      if (!comp) continue;
      const val = evalInComponent(comp, alg.evaluator, store, time);
      store.set(alg.canonicalTarget, val);
    }
  };

  updateAlgebraicAndConnections(canonicalValues, 0.0);

  // Build snapshot of all qualified and short variable names
  const snapshotAllVariables = (store: Map<string, number>, time: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const comp of doc.components.values()) {
      for (const v of comp.variables.values()) {
        const qual = `${comp.name}.${v.name}`;
        const can = getCanonical(qual);
        const val = independentCanonicalVars.has(can) ? time : (store.get(can) ?? 0.0);
        out[qual] = val;
        if (out[v.name] === undefined || can === qual) {
          out[v.name] = val;
        }
      }
    }
    return out;
  };

  // Detect Rush-Larsen linear gating variables (quasi-linear in state y: d^2f/dy^2 ~ 0 and df/dy < 0)
  const rushLarsenSet = new Set<string>();
  for (const ode of odeEqs) {
    const comp = doc.components.get(ode.compName);
    if (!comp) continue;
    const y0 = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
    const h = 1e-4;

    const store0 = new Map(canonicalValues);
    updateAlgebraicAndConnections(store0, 0.0);
    const f0 = evalInComponent(comp, ode.evaluator, store0, 0.0);

    const storePlus = new Map(canonicalValues);
    storePlus.set(ode.canonicalTarget, y0 + h);
    updateAlgebraicAndConnections(storePlus, 0.0);
    const fPlus = evalInComponent(comp, ode.evaluator, storePlus, 0.0);

    const storeMinus = new Map(canonicalValues);
    storeMinus.set(ode.canonicalTarget, y0 - h);
    updateAlgebraicAndConnections(storeMinus, 0.0);
    const fMinus = evalInComponent(comp, ode.evaluator, storeMinus, 0.0);

    const dfdy = (fPlus - fMinus) / (2 * h);
    const d2fdy2 = (fPlus - 2 * f0 + fMinus) / (h * h);

    if (dfdy < -1e-6 && Math.abs(d2fdy2) < 1e-3 && y0 >= -0.05 && y0 <= 1.05) {
      rushLarsenSet.add(ode.qualTarget);
    }
  }

  // Compute ODE derivatives for a given state vector
  const computeOdeRates = (store: Map<string, number>, time: number): Map<string, number> => {
    const workStore = new Map(store);
    updateAlgebraicAndConnections(workStore, time);
    const rates = new Map<string, number>();
    for (const ode of odeEqs) {
      const comp = doc.components.get(ode.compName);
      if (!comp) continue;
      rates.set(ode.canonicalTarget, evalInComponent(comp, ode.evaluator, workStore, time));
    }
    return rates;
  };

  const timeSeries: number[] = [0.0];
  const statesHistory: Record<string, number[]> = {};
  const variablesHistory: Record<string, number[]> = {};

  const initialSnap = snapshotAllVariables(canonicalValues, 0.0);
  for (const [k, v] of Object.entries(initialSnap)) {
    variablesHistory[k] = [v];
  }
  for (const ode of odeEqs) {
    const v0 = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
    statesHistory[ode.qualTarget] = [v0];
    statesHistory[ode.targetVar] = [v0];
  }

  const trajectory: CellmlTrajectoryStep[] = [{ time: 0.0, values: initialSnap }];

  let t = 0.0;
  for (let step = 0; step < steps; step++) {
    if (method === "rush-larsen" && rushLarsenSet.size > 0) {
      // Rush-Larsen exponential update for gating variables + RK4 for remaining state variables
      updateAlgebraicAndConnections(canonicalValues, t);
      const nextGating = new Map<string, number>();
      const nonGatingOdes: CompiledOdeEq[] = [];

      for (const ode of odeEqs) {
        if (rushLarsenSet.has(ode.qualTarget)) {
          const comp = doc.components.get(ode.compName)!;
          const yCurr = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
          const eps = 1e-6;
          const fCurr = evalInComponent(comp, ode.evaluator, canonicalValues, t);

          const pertStore = new Map(canonicalValues);
          pertStore.set(ode.canonicalTarget, yCurr + eps);
          updateAlgebraicAndConnections(pertStore, t);
          const fPert = evalInComponent(comp, ode.evaluator, pertStore, t);
          const lambda = (fPert - fCurr) / eps;

          if (lambda < -1e-9) {
            const yInf = yCurr - fCurr / lambda;
            const yNext = yInf + (yCurr - yInf) * Math.exp(lambda * dt);
            nextGating.set(ode.canonicalTarget, yNext);
          } else {
            nextGating.set(ode.canonicalTarget, yCurr + dt * fCurr);
          }
        } else {
          nonGatingOdes.push(ode);
        }
      }

      // RK4 for non-gating ODEs (e.g. membrane potential V)
      const k1 = computeOdeRates(canonicalValues, t);

      const store2 = new Map(canonicalValues);
      for (const ode of nonGatingOdes) {
        const y0 = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
        store2.set(ode.canonicalTarget, y0 + 0.5 * dt * (k1.get(ode.canonicalTarget) ?? 0.0));
      }
      const k2 = computeOdeRates(store2, t + 0.5 * dt);

      const store3 = new Map(canonicalValues);
      for (const ode of nonGatingOdes) {
        const y0 = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
        store3.set(ode.canonicalTarget, y0 + 0.5 * dt * (k2.get(ode.canonicalTarget) ?? 0.0));
      }
      const k3 = computeOdeRates(store3, t + 0.5 * dt);

      const store4 = new Map(canonicalValues);
      for (const ode of nonGatingOdes) {
        const y0 = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
        store4.set(ode.canonicalTarget, y0 + dt * (k3.get(ode.canonicalTarget) ?? 0.0));
      }
      const k4 = computeOdeRates(store4, t + dt);

      for (const ode of nonGatingOdes) {
        const can = ode.canonicalTarget;
        const y0 = canonicalValues.get(can) ?? 0.0;
        const dy =
          (dt / 6.0) *
          ((k1.get(can) ?? 0.0) + 2.0 * (k2.get(can) ?? 0.0) + 2.0 * (k3.get(can) ?? 0.0) + (k4.get(can) ?? 0.0));
        canonicalValues.set(can, y0 + dy);
      }
      for (const [can, val] of nextGating) {
        canonicalValues.set(can, val);
      }
    } else {
      // Standard 4th-order Runge-Kutta (RK4) across all ODE state variables
      const k1 = computeOdeRates(canonicalValues, t);

      const store2 = new Map(canonicalValues);
      for (const ode of odeEqs) {
        const can = ode.canonicalTarget;
        store2.set(can, (canonicalValues.get(can) ?? 0.0) + 0.5 * dt * (k1.get(can) ?? 0.0));
      }
      const k2 = computeOdeRates(store2, t + 0.5 * dt);

      const store3 = new Map(canonicalValues);
      for (const ode of odeEqs) {
        const can = ode.canonicalTarget;
        store3.set(can, (canonicalValues.get(can) ?? 0.0) + 0.5 * dt * (k2.get(can) ?? 0.0));
      }
      const k3 = computeOdeRates(store3, t + 0.5 * dt);

      const store4 = new Map(canonicalValues);
      for (const ode of odeEqs) {
        const can = ode.canonicalTarget;
        store4.set(can, (canonicalValues.get(can) ?? 0.0) + dt * (k3.get(can) ?? 0.0));
      }
      const k4 = computeOdeRates(store4, t + dt);

      for (const ode of odeEqs) {
        const can = ode.canonicalTarget;
        const y0 = canonicalValues.get(can) ?? 0.0;
        const dy =
          (dt / 6.0) *
          ((k1.get(can) ?? 0.0) + 2.0 * (k2.get(can) ?? 0.0) + 2.0 * (k3.get(can) ?? 0.0) + (k4.get(can) ?? 0.0));
        canonicalValues.set(can, y0 + dy);
      }
    }

    t = Number(((step + 1) * dt).toFixed(10));
    updateAlgebraicAndConnections(canonicalValues, t);

    const snap = snapshotAllVariables(canonicalValues, t);
    timeSeries.push(t);
    for (const [k, v] of Object.entries(snap)) {
      variablesHistory[k]?.push(v);
    }
    for (const ode of odeEqs) {
      const val = canonicalValues.get(ode.canonicalTarget) ?? 0.0;
      statesHistory[ode.qualTarget]?.push(val);
      if (ode.targetVar !== ode.qualTarget) {
        statesHistory[ode.targetVar]?.push(val);
      }
    }
    trajectory.push({ time: t, values: snap });
  }

  const finalSnap = snapshotAllVariables(canonicalValues, t);

  return {
    modelName: doc.name || "CellmlModel",
    time: timeSeries,
    states: statesHistory,
    variables: variablesHistory,
    initialValues: initialSnap,
    finalValues: finalSnap,
    trajectory,
    stepsCount: steps,
    rushLarsenVariables: Array.from(rushLarsenSet),
  };
}
