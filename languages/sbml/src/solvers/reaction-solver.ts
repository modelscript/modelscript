// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Chemical Reaction Kinetics ODE & Stochastic Solver.
 *
 * Implements:
 * - Deterministic mass-action, Michaelis-Menten, Hill cooperativity, and custom
 *   functionDefinition kinetic ODE simulation with 4th-order Runge-Kutta (RK4)
 *   and L-stable 2-stage Rosenbrock-Wanner (ROS2) stiff integration.
 * - SBML assignmentRule, rateRule, and state-triggered event evaluation.
 * - Exact Gillespie Stochastic Simulation Algorithm (SSA / Direct Method) for
 *   discrete biochemical reaction networks.
 */

import type { SbmlDocument } from "../types.js";

export interface ReactionSolverOptions {
  duration?: number | undefined; // total time in seconds (default: 10.0)
  timeStep?: number | undefined; // dt in seconds (default: 0.01)
  method?: "rk4" | "rosenbrock" | undefined; // ODE integration scheme (default: "rk4")
}

export interface ReactionStepRecord {
  time: number;
  concentrations: Record<string, number>;
  reactionRates: Record<string, number>;
}

export interface ReactionSimulationResult {
  modelId: string;
  speciesNames: string[];
  initialConcentrations: Record<string, number>;
  finalConcentrations: Record<string, number>;
  trajectory: ReactionStepRecord[];
  stepsCount: number;
}

export interface GillespieSolverOptions {
  duration?: number | undefined; // total simulation time in seconds (default: 10.0)
  maxSteps?: number | undefined; // maximum SSA leap events (default: 50000)
  seed?: number | undefined; // PRNG seed for reproducible trajectories (default: 42)
}

export interface GillespieSimulationResult {
  modelId: string;
  speciesNames: string[];
  initialCounts: Record<string, number>;
  finalCounts: Record<string, number>;
  finalConcentrations: Record<string, number>;
  trajectory: ReactionStepRecord[];
  reactionCounts: Record<string, number>;
  stepsCount: number;
}

type ExprEvaluator = (env: Record<string, number>) => number;

interface CompiledUserFunction {
  args: string[];
  evaluator: ExprEvaluator;
}

/**
 * Safe, zero-eval recursive-descent expression compiler for SBML kinetic laws, rules, and triggers.
 * Compiles mathematical and logical strings into fast, closure-based evaluators once at initialization.
 */
function compileMathExpr(formula: string, userFuncs?: Map<string, CompiledUserFunction>): ExprEvaluator {
  const clean = formula.replace(/\s+/g, "");
  if (!clean) return () => 0.0;

  type TokenType = "NUM" | "ID" | "OP" | "LPAREN" | "RPAREN" | "COMMA";
  interface Token {
    type: TokenType;
    value: string;
  }

  const tokens: Token[] = [];
  let pos = 0;

  while (pos < clean.length) {
    const ch = clean[pos] ?? "";
    const next = clean[pos + 1] ?? "";

    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (pos < clean.length && /[0-9.eE+-]/.test(clean[pos] ?? "")) {
        if ((clean[pos] === "+" || clean[pos] === "-") && !/[eE]/.test(clean[pos - 1] ?? "")) {
          break;
        }
        numStr += clean[pos] ?? "";
        pos++;
      }
      tokens.push({ type: "NUM", value: numStr });
    } else if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (pos < clean.length && /[a-zA-Z0-9_]/.test(clean[pos] ?? "")) {
        idStr += clean[pos] ?? "";
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
    } else if (
      ch === "^" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "/" ||
      ch === ">" ||
      ch === "<" ||
      ch === "!"
    ) {
      tokens.push({ type: "OP", value: ch });
      pos++;
    } else {
      pos++;
    }
  }

  let tokenIdx = 0;
  const peek = (): Token | undefined => tokens[tokenIdx];
  const consume = (): Token => tokens[tokenIdx++] ?? { type: "NUM", value: "0" };

  function parseLogicalOr(): ExprEvaluator {
    let left = parseLogicalAnd();
    while (peek()?.type === "OP" && peek()?.value === "||") {
      consume();
      const right = parseLogicalAnd();
      const prevLeft = left;
      left = (env) => (prevLeft(env) !== 0.0 || right(env) !== 0.0 ? 1.0 : 0.0);
    }
    return left;
  }

  function parseLogicalAnd(): ExprEvaluator {
    let left = parseRelational();
    while (peek()?.type === "OP" && peek()?.value === "&&") {
      consume();
      const right = parseRelational();
      const prevLeft = left;
      left = (env) => (prevLeft(env) !== 0.0 && right(env) !== 0.0 ? 1.0 : 0.0);
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
      const prevLeft = left;
      if (op === ">") {
        left = (env) => (prevLeft(env) > right(env) ? 1.0 : 0.0);
      } else if (op === "<") {
        left = (env) => (prevLeft(env) < right(env) ? 1.0 : 0.0);
      } else if (op === ">=") {
        left = (env) => (prevLeft(env) >= right(env) ? 1.0 : 0.0);
      } else if (op === "<=") {
        left = (env) => (prevLeft(env) <= right(env) ? 1.0 : 0.0);
      } else if (op === "==") {
        left = (env) => (Math.abs(prevLeft(env) - right(env)) <= 1e-12 ? 1.0 : 0.0);
      } else {
        left = (env) => (Math.abs(prevLeft(env) - right(env)) > 1e-12 ? 1.0 : 0.0);
      }
    }
    return left;
  }

  function parseAdditive(): ExprEvaluator {
    let left = parseTerm();
    while (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      const prevLeft = left;
      if (op === "+") {
        left = (env) => prevLeft(env) + right(env);
      } else {
        left = (env) => prevLeft(env) - right(env);
      }
    }
    return left;
  }

  function parseTerm(): ExprEvaluator {
    let left = parseFactor();
    while (peek()?.type === "OP" && (peek()?.value === "*" || peek()?.value === "/")) {
      const op = consume().value;
      const right = parseFactor();
      const prevLeft = left;
      if (op === "*") {
        left = (env) => prevLeft(env) * right(env);
      } else {
        left = (env) => {
          const denom = right(env);
          return denom !== 0.0 ? prevLeft(env) / denom : 0.0;
        };
      }
    }
    return left;
  }

  function parseFactor(): ExprEvaluator {
    const base = parseUnary();
    if (peek()?.type === "OP" && peek()?.value === "^") {
      consume(); // '^'
      const exp = parseFactor(); // right-associative
      return (env) => Math.pow(base(env), exp(env));
    }
    return base;
  }

  function parseUnary(): ExprEvaluator {
    if (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-" || peek()?.value === "!")) {
      const op = consume().value;
      const operand = parseUnary();
      if (op === "-") {
        return (env) => -operand(env);
      }
      if (op === "!") {
        return (env) => (operand(env) === 0.0 ? 1.0 : 0.0);
      }
      return operand;
    }
    return parsePrimary();
  }

  function parsePrimary(): ExprEvaluator {
    const tok = peek();
    if (!tok) return () => 0.0;

    if (tok.type === "NUM") {
      consume();
      const val = parseFloat(tok.value);
      return () => (isNaN(val) ? 0.0 : val);
    }

    if (tok.type === "LPAREN") {
      consume(); // '('
      const sub = parseLogicalOr();
      if (peek()?.type === "RPAREN") {
        consume(); // ')'
      }
      return sub;
    }

    if (tok.type === "ID") {
      consume();
      const id = tok.value;

      if (id === "true") return () => 1.0;
      if (id === "false") return () => 0.0;

      // Function call: func(arg1, arg2, ...)
      if (peek()?.type === "LPAREN") {
        consume(); // '('
        const args: ExprEvaluator[] = [];
        if (peek() && peek()?.type !== "RPAREN") {
          args.push(parseLogicalOr());
          while (peek()?.type === "COMMA") {
            consume(); // ','
            args.push(parseLogicalOr());
          }
        }
        if (peek()?.type === "RPAREN") {
          consume(); // ')'
        }

        // Check user-defined SBML <functionDefinition>
        const userFn = userFuncs?.get(id);
        if (userFn) {
          return (env) => {
            const localEnv: Record<string, number> = { ...env };
            for (let i = 0; i < userFn.args.length; i++) {
              const argName = userFn.args[i];
              if (!argName) continue;
              localEnv[argName] = args[i]?.(env) ?? 0.0;
            }
            return userFn.evaluator(localEnv);
          };
        }

        const lowerId = id.toLowerCase();
        if (lowerId === "sqrt") return (env) => Math.sqrt(Math.max(0, args[0]?.(env) ?? 0));
        if (lowerId === "exp") return (env) => Math.exp(args[0]?.(env) ?? 0);
        if (lowerId === "log" || lowerId === "ln") {
          return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1));
        }
        if (lowerId === "pow") {
          return (env) => Math.pow(args[0]?.(env) ?? 0, args[1]?.(env) ?? 1);
        }
        if (lowerId === "abs") return (env) => Math.abs(args[0]?.(env) ?? 0);
        if (lowerId === "sin") return (env) => Math.sin(args[0]?.(env) ?? 0);
        if (lowerId === "cos") return (env) => Math.cos(args[0]?.(env) ?? 0);
        if (lowerId === "min") {
          return (env) => Math.min(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        }
        if (lowerId === "max") {
          return (env) => Math.max(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        }
      }

      // Variable or parameter lookup
      return (env) => env[id] ?? 0.0;
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

/**
 * Dense Gaussian elimination with partial pivoting for solving (I - gamma*dt*J) * k = rhs.
 */
function solveDenseLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i] ?? 0.0]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col]?.[col] ?? 0.0);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row]?.[col] ?? 0.0);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = row;
      }
    }
    if (pivotRow !== col) {
      const tmp = M[col];
      const pRow = M[pivotRow];
      if (tmp && pRow) {
        M[col] = pRow;
        M[pivotRow] = tmp;
      }
    }

    const pivot = M[col]?.[col] ?? 0.0;
    if (Math.abs(pivot) < 1e-14) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = (M[row]?.[col] ?? 0.0) / pivot;
      if (factor === 0.0) continue;
      const rRow = M[row];
      const cRow = M[col];
      if (rRow && cRow) {
        for (let j = col; j <= n; j++) {
          rRow[j] = (rRow[j] ?? 0.0) - factor * (cRow[j] ?? 0.0);
        }
      }
    }
  }

  const x = new Array<number>(n).fill(0.0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row]?.[n] ?? 0.0;
    for (let j = row + 1; j < n; j++) {
      sum -= (M[row]?.[j] ?? 0.0) * (x[j] ?? 0.0);
    }
    const diag = M[row]?.[row] ?? 1.0;
    x[row] = Math.abs(diag) > 1e-14 ? sum / diag : 0.0;
  }
  return x;
}

export function solveReactions(doc: SbmlDocument, options?: ReactionSolverOptions): ReactionSimulationResult {
  const model = doc.model;
  const duration = options?.duration ?? 10.0;
  const dt = options?.timeStep ?? 0.01;
  const method = options?.method ?? "rk4";
  const steps = Math.max(1, Math.round(duration / dt));

  // Compile user-defined <functionDefinition> entries
  const userFuncs = new Map<string, CompiledUserFunction>();
  if (model.functionDefinitions) {
    for (const [fnId, fnDef] of model.functionDefinitions) {
      userFuncs.set(fnId, {
        args: fnDef.arguments,
        evaluator: compileMathExpr(fnDef.body, userFuncs),
      });
    }
  }

  // Collect global parameters
  const globalParams: Record<string, number> = {};
  for (const [id, p] of model.parameters) {
    globalParams[id] = p.value;
  }

  // Collect compartments
  const compSizes: Record<string, number> = {};
  for (const [id, c] of model.compartments) {
    compSizes[id] = c.size > 0 ? c.size : 1.0;
  }

  // Initialize species concentrations
  const speciesList = Array.from(model.species.values());
  const initialConcentrations: Record<string, number> = {};
  const currentConc: Record<string, number> = {};

  for (const s of speciesList) {
    let conc = s.initialConcentration;
    if (conc === undefined && s.initialAmount !== undefined) {
      const vol = compSizes[s.compartment] ?? 1.0;
      conc = s.initialAmount / vol;
    }
    const val = conc ?? 0.0;
    initialConcentrations[s.id] = val;
    currentConc[s.id] = val;
  }

  // Compile SBML rules (assignmentRule, rateRule, algebraicRule)
  const assignmentRules: Array<{ variable: string; evaluator: ExprEvaluator }> = [];
  const rateRules: Array<{ variable: string; evaluator: ExprEvaluator }> = [];
  if (model.rules) {
    for (const rule of model.rules) {
      const ev = compileMathExpr(rule.formula, userFuncs);
      if (rule.type === "assignment" && rule.variable) {
        assignmentRules.push({ variable: rule.variable, evaluator: ev });
      } else if (rule.type === "rate" && rule.variable) {
        rateRules.push({ variable: rule.variable, evaluator: ev });
      }
    }
  }

  function applyAssignmentRules(conc: Record<string, number>, params: Record<string, number>, time: number): void {
    if (assignmentRules.length === 0) return;
    for (const ar of assignmentRules) {
      const env: Record<string, number> = { ...compSizes, ...params, ...conc, time, t: time };
      const val = ar.evaluator(env);
      if (ar.variable in conc) {
        conc[ar.variable] = val;
      }
      if (ar.variable in params) {
        params[ar.variable] = val;
      }
    }
  }

  // Compile SBML state-triggered events
  const compiledEvents: Array<{
    id: string;
    triggerEval: ExprEvaluator;
    assignments: Array<{ variable: string; evaluator: ExprEvaluator }>;
    prevTriggered: boolean;
  }> = [];
  if (model.events) {
    for (const ev of model.events) {
      const trigEval = compileMathExpr(ev.trigger, userFuncs);
      const asgns = ev.assignments.map((a) => ({
        variable: a.variable,
        evaluator: compileMathExpr(a.formula, userFuncs),
      }));
      compiledEvents.push({
        id: ev.id ?? "event",
        triggerEval: trigEval,
        assignments: asgns,
        prevTriggered: false,
      });
    }
  }

  function evaluateEvents(
    conc: Record<string, number>,
    params: Record<string, number>,
    time: number,
    isInitial: boolean,
  ): void {
    if (compiledEvents.length === 0) return;
    for (const ev of compiledEvents) {
      const env: Record<string, number> = { ...compSizes, ...params, ...conc, time, t: time };
      const isTrue = ev.triggerEval(env) > 0.5;
      if (isInitial) {
        ev.prevTriggered = isTrue;
      } else {
        if (isTrue && !ev.prevTriggered) {
          const updates: Array<{ variable: string; val: number }> = [];
          for (const a of ev.assignments) {
            updates.push({ variable: a.variable, val: a.evaluator(env) });
          }
          for (const u of updates) {
            if (u.variable in conc) {
              conc[u.variable] = u.val;
            }
            if (u.variable in params) {
              params[u.variable] = u.val;
            }
          }
          applyAssignmentRules(conc, params, time);
        }
        ev.prevTriggered = isTrue;
      }
    }
  }

  // Apply initial assignment rules and initialize event trigger states at t = 0
  applyAssignmentRules(currentConc, globalParams, 0.0);
  for (const s of speciesList) {
    initialConcentrations[s.id] = currentConc[s.id] ?? 0.0;
  }
  evaluateEvents(currentConc, globalParams, 0.0, true);

  // Pre-compile kinetic rate laws once during solver initialization
  const compiledRateLaws = new Map<string, { evaluator: ExprEvaluator; localParams: Record<string, number> }>();
  for (const [rId, r] of model.reactions) {
    if (r.kineticLaw && r.kineticLaw.formula.trim().length > 0) {
      const localParams: Record<string, number> = {};
      for (const [lpId, lp] of r.kineticLaw.parameters) {
        localParams[lpId] = lp.value;
      }
      compiledRateLaws.set(rId, {
        evaluator: compileMathExpr(r.kineticLaw.formula, userFuncs),
        localParams,
      });
    }
  }

  // Compute reaction rates v_r
  function computeRates(conc: Record<string, number>, time = 0.0): Record<string, number> {
    const rates: Record<string, number> = {};

    for (const [rId, r] of model.reactions) {
      const compiled = compiledRateLaws.get(rId);
      if (compiled) {
        const env: Record<string, number> = {
          ...compSizes,
          ...globalParams,
          ...compiled.localParams,
          ...conc,
          time,
          t: time,
        };
        rates[rId] = compiled.evaluator(env);
      } else {
        const kFwd = globalParams[`k_${rId}`] ?? 1.0;
        const kRev = globalParams[`kr_${rId}`] ?? 0.1;

        let fwdRate = kFwd;
        for (const ref of r.reactants) {
          const c = Math.max(0, conc[ref.species] ?? 0.0);
          fwdRate *= Math.pow(c, ref.stoichiometry);
        }

        let revRate = 0.0;
        if (r.reversible) {
          revRate = kRev;
          for (const ref of r.products) {
            const c = Math.max(0, conc[ref.species] ?? 0.0);
            revRate *= Math.pow(c, ref.stoichiometry);
          }
        }
        rates[rId] = fwdRate - revRate;
      }
    }
    return rates;
  }

  // Track which variables are controlled by assignment rules so ODE step doesn't overwrite them
  const assignedVars = new Set(assignmentRules.map((r) => r.variable));

  // Compute derivatives d[S]/dt (and parameter rate rules)
  function computeDerivatives(
    conc: Record<string, number>,
    time = 0.0,
  ): { dS: Record<string, number>; dParam: Record<string, number> } {
    const workConc: Record<string, number> = { ...conc };
    const workParams: Record<string, number> = { ...globalParams };
    applyAssignmentRules(workConc, workParams, time);

    const rates = computeRates(workConc, time);
    const dS: Record<string, number> = {};
    const dParam: Record<string, number> = {};

    for (const s of speciesList) {
      dS[s.id] = 0.0;
      if (s.constant || assignedVars.has(s.id)) {
        continue;
      }
      if (!s.boundaryCondition) {
        const vol = compSizes[s.compartment] ?? 1.0;
        let netRate = 0.0;

        for (const [rId, r] of model.reactions) {
          const v = rates[rId] ?? 0.0;

          for (const ref of r.reactants) {
            if (ref.species === s.id) {
              netRate -= ref.stoichiometry * v;
            }
          }
          for (const ref of r.products) {
            if (ref.species === s.id) {
              netRate += ref.stoichiometry * v;
            }
          }
        }

        dS[s.id] = netRate / vol;
      }
    }

    // Apply explicit SBML <rateRule> definitions
    if (rateRules.length > 0) {
      const env: Record<string, number> = {
        ...compSizes,
        ...workParams,
        ...workConc,
        time,
        t: time,
      };
      for (const rr of rateRules) {
        const rateVal = rr.evaluator(env);
        if (rr.variable in dS) {
          dS[rr.variable] = rateVal;
        } else if (rr.variable in globalParams) {
          dParam[rr.variable] = rateVal;
        }
      }
    }

    return { dS, dParam };
  }

  const trajectory: ReactionStepRecord[] = [];
  let t = 0.0;

  // Record initial step
  trajectory.push({
    time: 0.0,
    concentrations: { ...currentConc },
    reactionRates: computeRates(currentConc, 0.0),
  });

  // Identify dynamic species for stiff Rosenbrock integration
  const dynamicSpeciesIds = speciesList
    .filter(
      (s) =>
        !s.constant &&
        !assignedVars.has(s.id) &&
        (!s.boundaryCondition || rateRules.some((rr) => rr.variable === s.id)),
    )
    .map((s) => s.id);

  const gamma = 1.0 - Math.SQRT1_2; // L-stable ROS2 parameter ~ 0.2928932188134525

  for (let step = 0; step < steps; step++) {
    if (method === "rosenbrock" && dynamicSpeciesIds.length > 0) {
      // 2-stage L-stable Rosenbrock-Wanner (ROS2) step:
      // (I - gamma*dt*J) k1 = f(y_n, t_n)
      // (I - gamma*dt*J) k2 = f(y_n + dt*k1, t_n + dt) - 2*k1
      // y_{n+1} = y_n + dt * (1.5*k1 + 0.5*k2)
      const n = dynamicSpeciesIds.length;
      const baseDeriv = computeDerivatives(currentConc, t);
      const f0 = dynamicSpeciesIds.map((id) => baseDeriv.dS[id] ?? 0.0);

      // Finite-difference Jacobian J = df/dy
      const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0.0));
      for (let j = 0; j < n; j++) {
        const varId = dynamicSpeciesIds[j];
        if (!varId) continue;
        const yVal = currentConc[varId] ?? 0.0;
        const delta = Math.max(1e-7, 1e-6 * Math.abs(yVal));
        const pertConc: Record<string, number> = { ...currentConc, [varId]: yVal + delta };
        const pertDeriv = computeDerivatives(pertConc, t).dS;
        for (let i = 0; i < n; i++) {
          const rowId = dynamicSpeciesIds[i];
          const jRow = J[i];
          if (rowId && jRow) {
            jRow[j] = ((pertDeriv[rowId] ?? 0.0) - (f0[i] ?? 0.0)) / delta;
          }
        }
      }

      // Form A = I - gamma * dt * J
      const A: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (__, j) => (i === j ? 1.0 : 0.0) - gamma * dt * (J[i]?.[j] ?? 0.0)),
      );

      const k1 = solveDenseLinearSystem(A, f0);

      const midConc: Record<string, number> = { ...currentConc };
      for (let i = 0; i < n; i++) {
        const id = dynamicSpeciesIds[i];
        if (id) {
          midConc[id] = Math.max(0, (currentConc[id] ?? 0.0) + dt * (k1[i] ?? 0.0));
        }
      }
      const f1Deriv = computeDerivatives(midConc, t + dt);
      const rhs2 = dynamicSpeciesIds.map((id, i) => (f1Deriv.dS[id] ?? 0.0) - 2.0 * (k1[i] ?? 0.0));
      const k2 = solveDenseLinearSystem(A, rhs2);

      for (let i = 0; i < n; i++) {
        const id = dynamicSpeciesIds[i];
        if (id) {
          const nextVal = (currentConc[id] ?? 0.0) + dt * (1.5 * (k1[i] ?? 0.0) + 0.5 * (k2[i] ?? 0.0));
          currentConc[id] = Math.max(0, nextVal);
        }
      }
      for (const [pId, dp] of Object.entries(baseDeriv.dParam)) {
        globalParams[pId] = (globalParams[pId] ?? 0.0) + dt * dp;
      }
    } else {
      // Explicit 4th-order Runge-Kutta (RK4) step
      const { dS: k1, dParam: kp1 } = computeDerivatives(currentConc, t);

      const conc2: Record<string, number> = {};
      for (const s of speciesList) {
        conc2[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + 0.5 * dt * (k1[s.id] ?? 0));
      }
      const { dS: k2 } = computeDerivatives(conc2, t + 0.5 * dt);

      const conc3: Record<string, number> = {};
      for (const s of speciesList) {
        conc3[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + 0.5 * dt * (k2[s.id] ?? 0));
      }
      const { dS: k3 } = computeDerivatives(conc3, t + 0.5 * dt);

      const conc4: Record<string, number> = {};
      for (const s of speciesList) {
        conc4[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + dt * (k3[s.id] ?? 0));
      }
      const { dS: k4 } = computeDerivatives(conc4, t + dt);

      for (const s of speciesList) {
        if (
          !s.constant &&
          !assignedVars.has(s.id) &&
          (!s.boundaryCondition || rateRules.some((rr) => rr.variable === s.id))
        ) {
          const delta = (dt / 6.0) * ((k1[s.id] ?? 0) + 2 * (k2[s.id] ?? 0) + 2 * (k3[s.id] ?? 0) + (k4[s.id] ?? 0));
          currentConc[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + delta);
        }
      }
      for (const [pId, dp] of Object.entries(kp1)) {
        globalParams[pId] = (globalParams[pId] ?? 0.0) + dt * dp;
      }
    }

    t += dt;
    applyAssignmentRules(currentConc, globalParams, t);
    evaluateEvents(currentConc, globalParams, t, false);

    // Sample trajectory (keep maximum 100 points for memory efficiency)
    if (steps <= 100 || step % Math.ceil(steps / 100) === 0 || step === steps - 1) {
      trajectory.push({
        time: t,
        concentrations: { ...currentConc },
        reactionRates: computeRates(currentConc, t),
      });
    }
  }

  return {
    modelId: model.id,
    speciesNames: speciesList.map((s) => s.id),
    initialConcentrations,
    finalConcentrations: { ...currentConc },
    trajectory,
    stepsCount: steps,
  };
}

export const simulateSbmlReactions = solveReactions;

/**
 * Exact Gillespie Stochastic Simulation Algorithm (Direct Method) for discrete SBML reaction networks.
 */
export function simulateSbmlGillespie(doc: SbmlDocument, options?: GillespieSolverOptions): GillespieSimulationResult {
  const model = doc.model;
  const duration = options?.duration ?? 10.0;
  const maxSteps = options?.maxSteps ?? 50000;
  let rngState = (options?.seed ?? 42) >>> 0;

  // Deterministic Mulberry32 PRNG in (0, 1)
  function nextRandom(): number {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let z = rngState;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    const u = ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    return u <= 1e-15 ? 1e-15 : u;
  }

  // Compile user-defined <functionDefinition>
  const userFuncs = new Map<string, CompiledUserFunction>();
  if (model.functionDefinitions) {
    for (const [fnId, fnDef] of model.functionDefinitions) {
      userFuncs.set(fnId, {
        args: fnDef.arguments,
        evaluator: compileMathExpr(fnDef.body, userFuncs),
      });
    }
  }

  const globalParams: Record<string, number> = {};
  for (const [id, p] of model.parameters) {
    globalParams[id] = p.value;
  }

  const compSizes: Record<string, number> = {};
  for (const [id, c] of model.compartments) {
    compSizes[id] = c.size > 0 ? c.size : 1.0;
  }

  const speciesList = Array.from(model.species.values());
  const initialCounts: Record<string, number> = {};
  const currentCounts: Record<string, number> = {};

  for (const s of speciesList) {
    const vol = compSizes[s.compartment] ?? 1.0;
    const rawCount = s.initialAmount !== undefined ? s.initialAmount : (s.initialConcentration ?? 0.0) * vol;
    const count = Math.max(0, Math.round(rawCount));
    initialCounts[s.id] = count;
    currentCounts[s.id] = count;
  }

  function countsToConcentrations(counts: Record<string, number>): Record<string, number> {
    const conc: Record<string, number> = {};
    for (const s of speciesList) {
      const vol = compSizes[s.compartment] ?? 1.0;
      conc[s.id] = (counts[s.id] ?? 0) / vol;
    }
    return conc;
  }

  const reactionsList = Array.from(model.reactions.values());
  const reactionCounts: Record<string, number> = {};
  const compiledRateLaws = new Map<string, { evaluator: ExprEvaluator; localParams: Record<string, number> }>();

  for (const r of reactionsList) {
    reactionCounts[r.id] = 0;
    if (r.kineticLaw && r.kineticLaw.formula.trim().length > 0) {
      const localParams: Record<string, number> = {};
      for (const [lpId, lp] of r.kineticLaw.parameters) {
        localParams[lpId] = lp.value;
      }
      compiledRateLaws.set(r.id, {
        evaluator: compileMathExpr(r.kineticLaw.formula, userFuncs),
        localParams,
      });
    }
  }

  function computePropensities(counts: Record<string, number>, time: number): Record<string, number> {
    const conc = countsToConcentrations(counts);
    const propensities: Record<string, number> = {};

    for (const r of reactionsList) {
      // Check discrete reactant availability first
      let reactantsAvailable = true;
      for (const ref of r.reactants) {
        if ((counts[ref.species] ?? 0) < ref.stoichiometry) {
          reactantsAvailable = false;
          break;
        }
      }
      if (!reactantsAvailable) {
        propensities[r.id] = 0.0;
        continue;
      }

      const compiled = compiledRateLaws.get(r.id);
      if (compiled) {
        const env: Record<string, number> = {
          ...compSizes,
          ...globalParams,
          ...compiled.localParams,
          ...conc,
          time,
          t: time,
        };
        propensities[r.id] = Math.max(0.0, compiled.evaluator(env));
      } else {
        let a = globalParams[`k_${r.id}`] ?? 1.0;
        for (const ref of r.reactants) {
          a *= Math.pow(Math.max(0, conc[ref.species] ?? 0), ref.stoichiometry);
        }
        propensities[r.id] = Math.max(0.0, a);
      }
    }
    return propensities;
  }

  const trajectory: ReactionStepRecord[] = [];
  let t = 0.0;
  let step = 0;

  trajectory.push({
    time: 0.0,
    concentrations: countsToConcentrations(currentCounts),
    reactionRates: computePropensities(currentCounts, 0.0),
  });

  const sampleInterval = Math.max(1e-4, duration / 100.0);
  let nextSampleTime = sampleInterval;

  while (t < duration && step < maxSteps) {
    const propensities = computePropensities(currentCounts, t);
    let a0 = 0.0;
    for (const r of reactionsList) {
      a0 += propensities[r.id] ?? 0.0;
    }

    if (a0 <= 1e-15) {
      t = duration;
      break;
    }

    const u1 = nextRandom();
    const u2 = nextRandom();
    const tau = -Math.log(u1) / a0;

    if (t + tau > duration) {
      t = duration;
      break;
    }

    t += tau;
    step++;

    // Select reaction channel r*
    const threshold = u2 * a0;
    let cum = 0.0;
    let chosenReaction = reactionsList[reactionsList.length - 1];
    if (!chosenReaction) break;
    for (const r of reactionsList) {
      cum += propensities[r.id] ?? 0.0;
      if (cum >= threshold) {
        chosenReaction = r;
        break;
      }
    }

    reactionCounts[chosenReaction.id] = (reactionCounts[chosenReaction.id] ?? 0) + 1;

    // Update discrete molecule counts by stoichiometry
    for (const ref of chosenReaction.reactants) {
      const s = model.species.get(ref.species);
      if (s && !s.constant && !s.boundaryCondition) {
        currentCounts[ref.species] = Math.max(0, (currentCounts[ref.species] ?? 0) - ref.stoichiometry);
      }
    }
    for (const ref of chosenReaction.products) {
      const s = model.species.get(ref.species);
      if (s && !s.constant && !s.boundaryCondition) {
        currentCounts[ref.species] = (currentCounts[ref.species] ?? 0) + ref.stoichiometry;
      }
    }

    if (t >= nextSampleTime) {
      trajectory.push({
        time: t,
        concentrations: countsToConcentrations(currentCounts),
        reactionRates: computePropensities(currentCounts, t),
      });
      nextSampleTime = t + sampleInterval;
    }
  }

  const finalConcentrations = countsToConcentrations(currentCounts);
  trajectory.push({
    time: t,
    concentrations: finalConcentrations,
    reactionRates: computePropensities(currentCounts, t),
  });

  return {
    modelId: model.id,
    speciesNames: speciesList.map((s) => s.id),
    initialCounts,
    finalCounts: { ...currentCounts },
    finalConcentrations,
    trajectory,
    reactionCounts,
    stepsCount: step,
  };
}
