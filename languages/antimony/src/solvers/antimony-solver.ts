// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Deterministic RK4 Reaction Network, Rate Rule, Assignment Rule,
 * Submodel Flattening, and Discrete Event Solver.
 *
 * Uses a safe, zero-eval, zero-regex recursive-descent mathematical expression compiler.
 */

import type { AntimonyDocument, AntimonyModule, AntimonySpeciesReference } from "../types.js";

export interface AntimonySolverOptions {
  duration?: number | undefined; // total simulation time in seconds (default: 10.0)
  timeStep?: number | undefined; // integration step dt in seconds (default: 0.01)
}

export interface AntimonyStepRecord {
  time: number;
  concentrations: Record<string, number>;
  reactionRates: Record<string, number>;
}

export interface AntimonyTriggeredEventRecord {
  time: number;
  eventId: string;
}

export interface AntimonySimulationResult {
  moduleId: string;
  speciesNames: string[];
  initialConcentrations: Record<string, number>;
  finalConcentrations: Record<string, number>;
  trajectory: AntimonyStepRecord[];
  triggeredEvents: AntimonyTriggeredEventRecord[];
  stepsCount: number;
}

type ExprEvaluator = (env: Record<string, number>) => number;

interface CompiledUserFunction {
  args: string[];
  evaluator: ExprEvaluator;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/**
 * Replaces identifiers in a formula according to a substitution map (zero-regex).
 */
function substituteFormulaIdentifiers(formula: string, subst: Map<string, string>): string {
  if (subst.size === 0) return formula;
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i] ?? "";
    if (isAlpha(ch)) {
      const prev = i > 0 ? (formula[i - 1] ?? "") : "";
      let ident = "";
      while (i < n && isAlphaNum(formula[i] ?? "")) {
        ident += formula[i] ?? "";
        i++;
      }
      if ((ident[0] === "e" || ident[0] === "E") && (isDigit(prev) || prev === ".")) {
        out += ident;
        continue;
      }
      out += subst.get(ident) ?? ident;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Flattens submodel instantiations into a single composite AntimonyModule.
 */
export function flattenAntimonyModule(
  doc: AntimonyDocument,
  rootMod: AntimonyModule = doc.mainModule,
  visited = new Set<string>(),
): AntimonyModule {
  if (rootMod.submodels.length === 0 || visited.has(rootMod.id)) {
    return rootMod;
  }

  visited.add(rootMod.id);

  const flat: AntimonyModule = {
    id: rootMod.id,
    name: rootMod.name,
    arguments: [...rootMod.arguments],
    compartments: new Map(rootMod.compartments),
    species: new Map(rootMod.species),
    parameters: new Map(rootMod.parameters),
    reactions: new Map(rootMod.reactions),
    reactionList: [...(rootMod.reactionList ?? Array.from(rootMod.reactions.values()))],
    rules: [...rootMod.rules],
    events: [...rootMod.events],
    submodels: [],
    deletions: [...(rootMod.deletions ?? [])],
    displayNames: new Map(rootMod.displayNames ?? []),
    range: rootMod.range,
  };

  for (const sub of rootMod.submodels) {
    const targetMod = doc.modules.get(sub.moduleName);
    if (!targetMod || visited.has(targetMod.id)) continue;

    const childFlat = flattenAntimonyModule(doc, targetMod, new Set(visited));
    const argMap = new Map<string, string>();
    for (let i = 0; i < childFlat.arguments.length; i++) {
      const formal = childFlat.arguments[i];
      const actual = sub.arguments[i];
      if (formal && actual) {
        argMap.set(formal, actual);
      }
    }

    const resolveSym = (sym: string): string => {
      const mapped = argMap.get(sym);
      if (mapped) return mapped;
      return sym;
    };

    for (const [cId, comp] of childFlat.compartments) {
      const targetId = resolveSym(cId);
      if (!flat.compartments.has(targetId)) {
        flat.compartments.set(targetId, { ...comp, id: targetId });
      }
    }

    for (const [sId, sp] of childFlat.species) {
      const targetId = resolveSym(sId);
      if (!flat.species.has(targetId)) {
        flat.species.set(targetId, {
          ...sp,
          id: targetId,
          compartment: resolveSym(sp.compartment),
        });
      }
    }

    for (const [pId, param] of childFlat.parameters) {
      const targetId = resolveSym(pId);
      if (!flat.parameters.has(targetId) && !flat.species.has(targetId)) {
        flat.parameters.set(targetId, {
          ...param,
          id: targetId,
          formula: param.formula ? substituteFormulaIdentifiers(param.formula, argMap) : undefined,
        });
      }
    }

    for (const [rId, rxn] of childFlat.reactions) {
      const newRxnId = flat.reactions.has(rId) ? `${sub.id}_${rId}` : rId;
      const mapRef = (ref: AntimonySpeciesReference): AntimonySpeciesReference => ({
        ...ref,
        species: resolveSym(ref.species),
      });
      const newRxn = {
        ...rxn,
        id: newRxnId,
        reactants: rxn.reactants.map(mapRef),
        products: rxn.products.map(mapRef),
        modifiers: rxn.modifiers.map(mapRef),
        rateLaw: substituteFormulaIdentifiers(rxn.rateLaw, argMap),
      };
      flat.reactions.set(newRxnId, newRxn);
      flat.reactionList?.push(newRxn);
    }

    for (const rule of childFlat.rules) {
      flat.rules.push({
        ...rule,
        variable: resolveSym(rule.variable),
        formula: substituteFormulaIdentifiers(rule.formula, argMap),
      });
    }

    for (const ev of childFlat.events) {
      flat.events.push({
        ...ev,
        id: `${sub.id}_${ev.id}`,
        trigger: substituteFormulaIdentifiers(ev.trigger, argMap),
        assignments: ev.assignments.map((a) => ({
          ...a,
          variable: resolveSym(a.variable),
          formula: substituteFormulaIdentifiers(a.formula, argMap),
        })),
      });
    }
  }

  return flat;
}

/**
 * Safe, zero-eval, zero-regex recursive-descent mathematical expression compiler.
 */
export function compileAntimonyExpr(formula: string, userFuncs?: Map<string, CompiledUserFunction>): ExprEvaluator {
  type ExprTokenType = "NUM" | "ID" | "OP" | "LPAREN" | "RPAREN" | "COMMA";
  interface ExprToken {
    type: ExprTokenType;
    value: string;
  }

  const tokens: ExprToken[] = [];
  let pos = 0;
  const n = formula.length;

  while (pos < n) {
    const ch = formula[pos] ?? "";
    const next = formula[pos + 1] ?? "";

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      pos++;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(next))) {
      let numStr = "";
      while (pos < n && isDigit(formula[pos] ?? "")) {
        numStr += formula[pos] ?? "";
        pos++;
      }
      if (pos < n && formula[pos] === ".") {
        numStr += ".";
        pos++;
        while (pos < n && isDigit(formula[pos] ?? "")) {
          numStr += formula[pos] ?? "";
          pos++;
        }
      }
      if (pos < n && (formula[pos] === "e" || formula[pos] === "E")) {
        const eNext = formula[pos + 1] ?? "";
        const eNext2 = formula[pos + 2] ?? "";
        if (isDigit(eNext) || ((eNext === "+" || eNext === "-") && isDigit(eNext2))) {
          numStr += formula[pos] ?? "";
          pos++;
          if (formula[pos] === "+" || formula[pos] === "-") {
            numStr += formula[pos] ?? "";
            pos++;
          }
          while (pos < n && isDigit(formula[pos] ?? "")) {
            numStr += formula[pos] ?? "";
            pos++;
          }
        }
      }
      tokens.push({ type: "NUM", value: numStr });
      continue;
    }

    if (isAlpha(ch)) {
      let idStr = "";
      while (pos < n && isAlphaNum(formula[pos] ?? "")) {
        idStr += formula[pos] ?? "";
        pos++;
      }
      const lower = idStr.toLowerCase();
      if (lower === "and") {
        tokens.push({ type: "OP", value: "&&" });
      } else if (lower === "or") {
        tokens.push({ type: "OP", value: "||" });
      } else if (lower === "not") {
        tokens.push({ type: "OP", value: "!" });
      } else {
        tokens.push({ type: "ID", value: idStr });
      }
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      pos++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      pos++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      pos++;
      continue;
    }
    if (ch === "*" && next === "*") {
      tokens.push({ type: "OP", value: "^" });
      pos += 2;
      continue;
    }
    if (
      (ch === ">" && next === "=") ||
      (ch === "<" && next === "=") ||
      (ch === "=" && next === "=") ||
      (ch === "!" && next === "=") ||
      (ch === "&" && next === "&") ||
      (ch === "|" && next === "|")
    ) {
      tokens.push({ type: "OP", value: ch + next });
      pos += 2;
      continue;
    }
    if (ch === "^" || ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === ">" || ch === "<" || ch === "!") {
      tokens.push({ type: "OP", value: ch });
      pos++;
      continue;
    }
    pos++;
  }

  if (tokens.length === 0) {
    return () => 0.0;
  }

  let tIdx = 0;
  const peek = (): ExprToken | undefined => tokens[tIdx];
  const consume = (): ExprToken => tokens[tIdx++] ?? { type: "NUM", value: "0" };

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
      else if (op === "==") {
        left = (env) => (Math.abs(prev(env) - right(env)) <= 1e-12 ? 1.0 : 0.0);
      } else {
        left = (env) => (Math.abs(prev(env) - right(env)) > 1e-12 ? 1.0 : 0.0);
      }
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
    while (peek()?.type === "OP" && (peek()?.value === "*" || peek()?.value === "/")) {
      const op = consume().value;
      const right = parsePower();
      const prev = left;
      if (op === "*") {
        left = (env) => prev(env) * right(env);
      } else {
        left = (env) => {
          const d = right(env);
          return d !== 0.0 ? prev(env) / d : 0.0;
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
      const val = Number(tok.value);
      return () => (Number.isNaN(val) ? 0.0 : val);
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
      const lower = id.toLowerCase();

      if (lower === "true") return () => 1.0;
      if (lower === "false") return () => 0.0;
      if (lower === "pi") return () => Math.PI;
      if (lower === "e") return () => Math.E;

      if (peek()?.type === "LPAREN") {
        consume(); // '('
        const args: ExprEvaluator[] = [];
        if (peek() && peek()?.type !== "RPAREN") {
          args.push(parseLogicalOr());
          while (peek()?.type === "COMMA") {
            consume();
            args.push(parseLogicalOr());
          }
        }
        if (peek()?.type === "RPAREN") consume();

        const userFn = userFuncs?.get(id);
        if (userFn) {
          return (env) => {
            const localEnv: Record<string, number> = { ...env };
            for (let i = 0; i < userFn.args.length; i++) {
              const argName = userFn.args[i];
              if (argName) {
                localEnv[argName] = args[i]?.(env) ?? 0.0;
              }
            }
            return userFn.evaluator(localEnv);
          };
        }

        if (lower === "sqrt") return (env) => Math.sqrt(Math.max(0, args[0]?.(env) ?? 0));
        if (lower === "exp") return (env) => Math.exp(args[0]?.(env) ?? 0);
        if (lower === "log" || lower === "ln") {
          return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1));
        }
        if (lower === "log10") {
          return (env) => Math.log10(Math.max(1e-15, args[0]?.(env) ?? 1));
        }
        if (lower === "pow") {
          return (env) => Math.pow(args[0]?.(env) ?? 0, args[1]?.(env) ?? 1);
        }
        if (lower === "abs") return (env) => Math.abs(args[0]?.(env) ?? 0);
        if (lower === "sin") return (env) => Math.sin(args[0]?.(env) ?? 0);
        if (lower === "cos") return (env) => Math.cos(args[0]?.(env) ?? 0);
        if (lower === "tan") return (env) => Math.tan(args[0]?.(env) ?? 0);
        if (lower === "floor") return (env) => Math.floor(args[0]?.(env) ?? 0);
        if (lower === "ceil") return (env) => Math.ceil(args[0]?.(env) ?? 0);
        if (lower === "min") {
          return (env) => Math.min(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        }
        if (lower === "max") {
          return (env) => Math.max(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        }
        if (lower === "piecewise") {
          return (env) => {
            for (let i = 0; i + 1 < args.length; i += 2) {
              if ((args[i + 1]?.(env) ?? 0) !== 0.0) {
                return args[i]?.(env) ?? 0.0;
              }
            }
            return args.length % 2 === 1 ? (args[args.length - 1]?.(env) ?? 0.0) : 0.0;
          };
        }
      }

      return (env) => env[id] ?? 0.0;
    }

    consume();
    return () => 0.0;
  }

  return parseLogicalOr();
}

/**
 * Integrates an Antimony reaction network, rate rules, assignment rules, and discrete events using RK4.
 */
export function solveAntimony(doc: AntimonyDocument, options?: AntimonySolverOptions): AntimonySimulationResult {
  const mod = flattenAntimonyModule(doc, doc.mainModule);
  const duration = options?.duration ?? 10.0;
  const dt = options?.timeStep ?? 0.01;
  const steps = Math.max(1, Math.round(duration / dt));

  // 1. Compile user functions
  const userFuncs = new Map<string, CompiledUserFunction>();
  for (const [fnId, fnDef] of doc.functions) {
    userFuncs.set(fnId, {
      args: fnDef.arguments,
      evaluator: compileAntimonyExpr(fnDef.body, userFuncs),
    });
  }

  // 2. Collect compartments
  const compSizes: Record<string, number> = { default_compartment: 1.0 };
  for (const [cId, comp] of mod.compartments) {
    compSizes[cId] = comp.size > 0 ? comp.size : 1.0;
  }

  // 3. Collect parameters
  const params: Record<string, number> = {};
  for (const [pId, param] of mod.parameters) {
    params[pId] = param.value;
  }

  // 4. Collect species and ensure any variable with a rate rule is tracked in state
  const speciesMap = new Map(mod.species);
  for (const rule of mod.rules) {
    if (rule.type === "rate" && !speciesMap.has(rule.variable)) {
      const existingParam = mod.parameters.get(rule.variable);
      speciesMap.set(rule.variable, {
        id: rule.variable,
        compartment: "default_compartment",
        initialConcentration: existingParam?.value ?? 0.0,
        hasOnlySubstanceUnits: false,
        boundaryCondition: false,
        constant: false,
      });
    }
  }

  const speciesList = Array.from(speciesMap.values());
  const currentConc: Record<string, number> = {};
  const initialConcentrations: Record<string, number> = {};

  for (const s of speciesList) {
    let val = s.initialConcentration;
    if (val === undefined && s.initialAmount !== undefined) {
      const vol = compSizes[s.compartment] ?? 1.0;
      val = s.initialAmount / vol;
    }
    const initVal = val ?? 0.0;
    currentConc[s.id] = initVal;
    initialConcentrations[s.id] = initVal;
  }

  // 5. Compile rules (initial, assignment, rate)
  const initialRules: Array<{ variable: string; evaluator: ExprEvaluator }> = [];
  const assignmentRules: Array<{ variable: string; evaluator: ExprEvaluator }> = [];
  const rateRules: Array<{ variable: string; evaluator: ExprEvaluator }> = [];

  for (const rule of mod.rules) {
    const ev = compileAntimonyExpr(rule.formula, userFuncs);
    if (rule.type === "initial") {
      initialRules.push({ variable: rule.variable, evaluator: ev });
    } else if (rule.type === "assignment") {
      assignmentRules.push({ variable: rule.variable, evaluator: ev });
    } else if (rule.type === "rate") {
      rateRules.push({ variable: rule.variable, evaluator: ev });
    }
  }

  const assignedVars = new Set(assignmentRules.map((r) => r.variable));

  const applyAssignmentRules = (conc: Record<string, number>, paramEnv: Record<string, number>, time: number): void => {
    for (const ar of assignmentRules) {
      const env: Record<string, number> = {
        ...compSizes,
        ...paramEnv,
        ...conc,
        time,
        t: time,
      };
      const val = ar.evaluator(env);
      if (ar.variable in conc || speciesMap.has(ar.variable)) {
        conc[ar.variable] = val;
      }
      if (ar.variable in paramEnv) {
        paramEnv[ar.variable] = val;
      }
    }
  };

  // Apply initial rules and initial assignment rules at t = 0
  for (const ir of initialRules) {
    const env: Record<string, number> = { ...compSizes, ...params, ...currentConc, time: 0, t: 0 };
    const val = ir.evaluator(env);
    if (ir.variable in currentConc) currentConc[ir.variable] = val;
    if (ir.variable in params) params[ir.variable] = val;
  }
  applyAssignmentRules(currentConc, params, 0.0);
  for (const s of speciesList) {
    initialConcentrations[s.id] = currentConc[s.id] ?? 0.0;
  }
  for (const ar of assignmentRules) {
    if (!(ar.variable in initialConcentrations)) {
      initialConcentrations[ar.variable] = currentConc[ar.variable] ?? params[ar.variable] ?? 0.0;
      currentConc[ar.variable] = initialConcentrations[ar.variable] ?? 0.0;
    }
  }

  // 6. Compile reaction rate laws
  const compiledReactions = new Map<string, ExprEvaluator>();
  for (const [rId, rxn] of mod.reactions) {
    if (rxn.rateLaw && rxn.rateLaw.trim().length > 0) {
      compiledReactions.set(rId, compileAntimonyExpr(rxn.rateLaw, userFuncs));
    }
  }

  const computeReactionRates = (
    conc: Record<string, number>,
    paramEnv: Record<string, number>,
    time: number,
  ): Record<string, number> => {
    const rates: Record<string, number> = {};
    const env: Record<string, number> = {
      ...compSizes,
      ...paramEnv,
      ...conc,
      time,
      t: time,
    };
    for (const rId of mod.reactions.keys()) {
      const ev = compiledReactions.get(rId);
      if (ev) {
        const v = ev(env);
        rates[rId] = v;
        env[rId] = v;
      } else {
        rates[rId] = 0.0;
      }
    }
    return rates;
  };

  // 7. Compile state-triggered events
  const compiledEvents = mod.events.map((ev) => ({
    id: ev.id,
    triggerEval: compileAntimonyExpr(ev.trigger, userFuncs),
    assignments: ev.assignments.map((a) => ({
      variable: a.variable,
      evaluator: compileAntimonyExpr(a.formula, userFuncs),
    })),
    prevTriggered: false,
  }));

  const triggeredEvents: AntimonyTriggeredEventRecord[] = [];

  const evaluateEvents = (
    conc: Record<string, number>,
    paramEnv: Record<string, number>,
    time: number,
    isInitial: boolean,
  ): void => {
    if (compiledEvents.length === 0) return;
    for (const ev of compiledEvents) {
      const env: Record<string, number> = {
        ...compSizes,
        ...paramEnv,
        ...conc,
        time,
        t: time,
      };
      const isTrue = ev.triggerEval(env) > 0.5;
      if (isInitial) {
        ev.prevTriggered = isTrue;
      } else {
        if (isTrue && !ev.prevTriggered) {
          const updates = ev.assignments.map((a) => ({
            variable: a.variable,
            val: a.evaluator(env),
          }));
          for (const u of updates) {
            if (u.variable in conc) {
              conc[u.variable] = u.val;
            }
            if (u.variable in paramEnv) {
              paramEnv[u.variable] = u.val;
            }
          }
          triggeredEvents.push({ time, eventId: ev.id });
          applyAssignmentRules(conc, paramEnv, time);
        }
        ev.prevTriggered = isTrue;
      }
    }
  };

  evaluateEvents(currentConc, params, 0.0, true);

  // 8. Compute derivatives d[S]/dt
  const computeDerivatives = (conc: Record<string, number>, time: number): Record<string, number> => {
    const workConc: Record<string, number> = { ...conc };
    const workParams: Record<string, number> = { ...params };
    applyAssignmentRules(workConc, workParams, time);

    const rates = computeReactionRates(workConc, workParams, time);
    const dS: Record<string, number> = {};

    for (const s of speciesList) {
      dS[s.id] = 0.0;
      if (s.constant || assignedVars.has(s.id)) {
        continue;
      }
      if (!s.boundaryCondition) {
        const vol = compSizes[s.compartment] ?? 1.0;
        let netFlux = 0.0;
        for (const [rId, rxn] of mod.reactions) {
          const v = rates[rId] ?? 0.0;
          for (const ref of rxn.reactants) {
            if (ref.species === s.id && !ref.boundaryCondition) {
              netFlux -= ref.stoichiometry * v;
            }
          }
          for (const ref of rxn.products) {
            if (ref.species === s.id && !ref.boundaryCondition) {
              netFlux += ref.stoichiometry * v;
            }
          }
        }
        dS[s.id] = netFlux / vol;
      }
    }

    if (rateRules.length > 0) {
      const env: Record<string, number> = {
        ...compSizes,
        ...workParams,
        ...workConc,
        ...rates,
        time,
        t: time,
      };
      for (const rr of rateRules) {
        dS[rr.variable] = rr.evaluator(env);
      }
    }

    return dS;
  };

  const trajectory: AntimonyStepRecord[] = [];
  let t = 0.0;

  trajectory.push({
    time: 0.0,
    concentrations: { ...currentConc },
    reactionRates: computeReactionRates(currentConc, params, 0.0),
  });

  // 9. Explicit 4th-order Runge-Kutta (RK4) integration loop
  for (let step = 0; step < steps; step++) {
    const k1 = computeDerivatives(currentConc, t);

    const conc2: Record<string, number> = { ...currentConc };
    for (const s of speciesList) {
      conc2[s.id] = (currentConc[s.id] ?? 0.0) + 0.5 * dt * (k1[s.id] ?? 0.0);
    }
    const k2 = computeDerivatives(conc2, t + 0.5 * dt);

    const conc3: Record<string, number> = { ...currentConc };
    for (const s of speciesList) {
      conc3[s.id] = (currentConc[s.id] ?? 0.0) + 0.5 * dt * (k2[s.id] ?? 0.0);
    }
    const k3 = computeDerivatives(conc3, t + 0.5 * dt);

    const conc4: Record<string, number> = { ...currentConc };
    for (const s of speciesList) {
      conc4[s.id] = (currentConc[s.id] ?? 0.0) + dt * (k3[s.id] ?? 0.0);
    }
    const k4 = computeDerivatives(conc4, t + dt);

    for (const s of speciesList) {
      const hasRateRule = rateRules.some((rr) => rr.variable === s.id);
      if (!s.constant && !assignedVars.has(s.id) && (!s.boundaryCondition || hasRateRule)) {
        const delta =
          (dt / 6.0) * ((k1[s.id] ?? 0.0) + 2.0 * (k2[s.id] ?? 0.0) + 2.0 * (k3[s.id] ?? 0.0) + (k4[s.id] ?? 0.0));
        const nextVal = (currentConc[s.id] ?? 0.0) + delta;
        currentConc[s.id] = mod.species.has(s.id) && !hasRateRule ? Math.max(0.0, nextVal) : nextVal;
      }
    }

    t += dt;
    applyAssignmentRules(currentConc, params, t);
    evaluateEvents(currentConc, params, t, false);

    if (steps <= 100 || step % Math.ceil(steps / 100) === 0 || step === steps - 1) {
      trajectory.push({
        time: t,
        concentrations: { ...currentConc },
        reactionRates: computeReactionRates(currentConc, params, t),
      });
    }
  }

  return {
    moduleId: mod.id,
    speciesNames: speciesList.map((s) => s.id),
    initialConcentrations,
    finalConcentrations: { ...currentConc },
    trajectory,
    triggeredEvents,
    stepsCount: steps,
  };
}

export const simulateAntimony = solveAntimony;
