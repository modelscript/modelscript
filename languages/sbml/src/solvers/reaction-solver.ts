// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Chemical Reaction Kinetics ODE Solver.
 *
 * Implements deterministic mass-action, Michaelis-Menten, and Hill cooperativity
 * kinetic ODE simulation with 4th-order Runge-Kutta (RK4) integration.
 */

import type { SbmlDocument } from "../types.js";

export interface ReactionSolverOptions {
  duration?: number | undefined; // total time in seconds (default: 10.0)
  timeStep?: number | undefined; // dt in seconds (default: 0.01)
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

type ExprEvaluator = (env: Record<string, number>) => number;

/**
 * Safe, zero-eval recursive-descent expression compiler for SBML kinetic laws.
 * Compiles mathematical strings into fast, closure-based evaluators once at initialization,
 * eliminating runtime `new Function(...)` calls, CSP issues, and V8 JIT recompilation churn.
 */
function compileMathExpr(formula: string): ExprEvaluator {
  const clean = formula.replace(/\s+/g, "");
  if (!clean) return () => 0.0;

  // Tokenize
  type TokenType = "NUM" | "ID" | "OP" | "LPAREN" | "RPAREN" | "COMMA";
  interface Token {
    type: TokenType;
    value: string;
  }

  const tokens: Token[] = [];
  let pos = 0;

  while (pos < clean.length) {
    const ch = clean[pos] ?? "";

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
    } else if (ch === "*" && clean[pos + 1] === "*") {
      tokens.push({ type: "OP", value: "^" });
      pos += 2;
    } else if (ch === "^" || ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "OP", value: ch });
      pos++;
    } else {
      pos++;
    }
  }

  // Recursive-descent parser
  let tokenIdx = 0;
  const peek = (): Token | undefined => tokens[tokenIdx];
  const consume = (): Token => tokens[tokenIdx++] ?? { type: "NUM", value: "0" };

  function parseExpression(): ExprEvaluator {
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
    if (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const operand = parseUnary();
      if (op === "-") {
        return (env) => -operand(env);
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
      const sub = parseExpression();
      if (peek()?.type === "RPAREN") {
        consume(); // ')'
      }
      return sub;
    }

    if (tok.type === "ID") {
      consume();
      const id = tok.value;

      // Function call: func(arg1, arg2, ...)
      if (peek()?.type === "LPAREN") {
        consume(); // '('
        const args: ExprEvaluator[] = [];
        if (peek() && peek()?.type !== "RPAREN") {
          args.push(parseExpression());
          while (peek()?.type === "COMMA") {
            consume(); // ','
            args.push(parseExpression());
          }
        }
        if (peek()?.type === "RPAREN") {
          consume(); // ')'
        }

        const lowerId = id.toLowerCase();
        if (lowerId === "sqrt") return (env) => Math.sqrt(Math.max(0, args[0]?.(env) ?? 0));
        if (lowerId === "exp") return (env) => Math.exp(args[0]?.(env) ?? 0);
        if (lowerId === "log" || lowerId === "ln") return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1));
        if (lowerId === "pow") return (env) => Math.pow(args[0]?.(env) ?? 0, args[1]?.(env) ?? 1);
        if (lowerId === "abs") return (env) => Math.abs(args[0]?.(env) ?? 0);
        if (lowerId === "sin") return (env) => Math.sin(args[0]?.(env) ?? 0);
        if (lowerId === "cos") return (env) => Math.cos(args[0]?.(env) ?? 0);
      }

      // Variable or parameter lookup
      return (env) => env[id] ?? 0.0;
    }

    consume();
    return () => 0.0;
  }

  try {
    return parseExpression();
  } catch {
    return () => 0.0;
  }
}

export function solveReactions(doc: SbmlDocument, options?: ReactionSolverOptions): ReactionSimulationResult {
  const model = doc.model;
  const duration = options?.duration ?? 10.0;
  const dt = options?.timeStep ?? 0.01;
  const steps = Math.max(1, Math.round(duration / dt));

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

  // Pre-compile kinetic rate laws once during solver initialization
  const compiledRateLaws = new Map<string, { evaluator: ExprEvaluator; localParams: Record<string, number> }>();
  for (const [rId, r] of model.reactions) {
    if (r.kineticLaw && r.kineticLaw.formula.trim().length > 0) {
      const localParams: Record<string, number> = {};
      for (const [lpId, lp] of r.kineticLaw.parameters) {
        localParams[lpId] = lp.value;
      }
      compiledRateLaws.set(rId, {
        evaluator: compileMathExpr(r.kineticLaw.formula),
        localParams,
      });
    }
  }

  // Compute reaction rates v_r
  function computeRates(conc: Record<string, number>): Record<string, number> {
    const rates: Record<string, number> = {};

    for (const [rId, r] of model.reactions) {
      const compiled = compiledRateLaws.get(rId);
      if (compiled) {
        // Evaluate pre-compiled kinetic law with zero runtime parsing
        const env: Record<string, number> = { ...globalParams, ...compiled.localParams, ...conc };
        rates[rId] = compiled.evaluator(env);
      } else {
        // Fallback: mass action kinetics with default k = 1.0
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

  // Compute derivatives d[S]/dt
  function computeDerivatives(conc: Record<string, number>): Record<string, number> {
    const rates = computeRates(conc);
    const dS: Record<string, number> = {};

    for (const s of speciesList) {
      dS[s.id] = 0.0;
      if (s.constant || s.boundaryCondition) {
        continue; // concentration does not change
      }

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

    return dS;
  }

  const trajectory: ReactionStepRecord[] = [];
  let t = 0.0;

  // Record initial step
  trajectory.push({
    time: 0.0,
    concentrations: { ...currentConc },
    reactionRates: computeRates(currentConc),
  });

  // RK4 Integration Loop
  for (let step = 0; step < steps; step++) {
    const k1 = computeDerivatives(currentConc);

    const conc2: Record<string, number> = {};
    for (const s of speciesList) {
      conc2[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + 0.5 * dt * (k1[s.id] ?? 0));
    }
    const k2 = computeDerivatives(conc2);

    const conc3: Record<string, number> = {};
    for (const s of speciesList) {
      conc3[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + 0.5 * dt * (k2[s.id] ?? 0));
    }
    const k3 = computeDerivatives(conc3);

    const conc4: Record<string, number> = {};
    for (const s of speciesList) {
      conc4[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + dt * (k3[s.id] ?? 0));
    }
    const k4 = computeDerivatives(conc4);

    // Update state
    for (const s of speciesList) {
      if (!s.constant && !s.boundaryCondition) {
        const delta = (dt / 6.0) * ((k1[s.id] ?? 0) + 2 * (k2[s.id] ?? 0) + 2 * (k3[s.id] ?? 0) + (k4[s.id] ?? 0));
        currentConc[s.id] = Math.max(0, (currentConc[s.id] ?? 0) + delta);
      }
    }

    t += dt;

    // Sample trajectory (keep maximum 100 points for memory efficiency)
    if (steps <= 100 || step % Math.ceil(steps / 100) === 0 || step === steps - 1) {
      trajectory.push({
        time: t,
        concentrations: { ...currentConc },
        reactionRates: computeRates(currentConc),
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
