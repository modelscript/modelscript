// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — Lumped DAE & Method-of-Lines (MOL) PDE-DAE Process Solver.
 *
 * Implements:
 *   - Safe, zero-eval recursive-descent mathematical expression compiler for gPROMS equations
 *   - Method-of-Lines (MOL) spatial discretization over DISTRIBUTION_DOMAIN grids using
 *     upwind Backward Finite Differences (BFDM) for 1st-order convection PARTIAL(u, z) and
 *     Central Finite Differences (CFDM) with Danckwerts outlet BC for 2nd-order dispersion
 *   - 4th-order Runge-Kutta (RK4) time integration for lumped and spatially distributed models
 */

import type { GpromsDocument, GpromsModel, GpromsProcess } from "../types.js";

export interface GpromsSolverOptions {
  processName?: string | undefined;
  modelName?: string | undefined;
  duration?: number | undefined; // total simulation time in seconds (default: TotalTime or 10.0)
  timeStep?: number | undefined; // RK4 integration step dt (default: TimeStep or 0.01)
}

export interface GpromsStepRecord {
  time: number;
  states: Record<string, number>;
  algebraic: Record<string, number>;
}

export interface GpromsSimulationResult {
  processName: string;
  modelName: string;
  stateNames: string[];
  initialStates: Record<string, number>;
  finalStates: Record<string, number>;
  spatialDomains: Record<string, number[]>;
  finalSpatialProfiles: Record<string, number[]>;
  trajectory: GpromsStepRecord[];
  stepsCount: number;
}

type ExprEvaluator = (env: Record<string, number>) => number;

/**
 * Preprocesses a gPROMS expression string so that:
 *   - PARTIAL(PARTIAL(u(z), dom), dom) or PARTIAL(PARTIAL(u, dom), dom) -> __d2_u_dom
 *   - PARTIAL(u, dom, 2) -> __d2_u_dom
 *   - PARTIAL(u(z), dom) or PARTIAL(u, dom) -> __d1_u_dom
 *   - Distributed variable indexing u(z) -> u
 */
export function normalizeGpromsExprForEval(
  expr: string,
  distributedVars: Set<string>,
  domainNames: Set<string>,
): string {
  let out = expr;

  // Replace nested second-order PARTIAL(PARTIAL(var[(...)], dom), dom)
  out = out.replace(
    /PARTIAL\s*\(\s*PARTIAL\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\([^)]*\))?\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi,
    (_m, v: string, d1: string) => `__d2_${v}_${d1}`,
  );

  // Replace 3-argument PARTIAL(var[(...)], dom, 2)
  out = out.replace(
    /PARTIAL\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\([^)]*\))?\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([0-9]+)\s*\)/gi,
    (_m, v: string, d: string, ord: string) => (Number(ord) >= 2 ? `__d2_${v}_${d}` : `__d1_${v}_${d}`),
  );

  // Replace first-order PARTIAL(var[(...)], dom)
  out = out.replace(
    /PARTIAL\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\([^)]*\))?\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi,
    (_m, v: string, d: string) => `__d1_${v}_${d}`,
  );

  // Strip spatial argument from distributed variables e.g. C(z) -> C
  for (const dv of distributedVars) {
    const re = new RegExp(`\\b${dv}\\s*\\(([^)]*)\\)`, "g");
    out = out.replace(re, (_m, arg: string) => {
      const trimmed = arg.trim();
      if (domainNames.has(trimmed) || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return dv;
      }
      return dv;
    });
  }

  return out;
}

/**
 * Safe, zero-eval recursive-descent mathematical expression compiler.
 */
export function compileGpromsMathExpr(formula: string): ExprEvaluator {
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
    } else if (ch === "^" || ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "OP", value: ch });
      pos++;
    } else {
      pos++;
    }
  }

  let tokenIdx = 0;
  const peek = (): Token | undefined => tokens[tokenIdx];
  const consume = (): Token => tokens[tokenIdx++] ?? { type: "NUM", value: "0" };

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
      consume();
      const exp = parseFactor();
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
      return () => (Number.isNaN(val) ? 0.0 : val);
    }

    if (tok.type === "LPAREN") {
      consume();
      const sub = parseAdditive();
      if (peek()?.type === "RPAREN") consume();
      return sub;
    }

    if (tok.type === "ID") {
      consume();
      const id = tok.value;
      const upper = id.toUpperCase();

      if (upper === "PI") return () => Math.PI;
      if (upper === "TRUE") return () => 1.0;
      if (upper === "FALSE") return () => 0.0;

      if (peek()?.type === "LPAREN") {
        consume();
        const args: ExprEvaluator[] = [];
        if (peek() && peek()?.type !== "RPAREN") {
          args.push(parseAdditive());
          while (peek()?.type === "COMMA") {
            consume();
            args.push(parseAdditive());
          }
        }
        if (peek()?.type === "RPAREN") consume();

        if (upper === "SQRT") return (env) => Math.sqrt(Math.max(0, args[0]?.(env) ?? 0));
        if (upper === "EXP") return (env) => Math.exp(args[0]?.(env) ?? 0);
        if (upper === "LOG" || upper === "LN") {
          return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1));
        }
        if (upper === "LOG10") {
          return (env) => Math.log10(Math.max(1e-15, args[0]?.(env) ?? 1));
        }
        if (upper === "SIN") return (env) => Math.sin(args[0]?.(env) ?? 0);
        if (upper === "COS") return (env) => Math.cos(args[0]?.(env) ?? 0);
        if (upper === "TAN") return (env) => Math.tan(args[0]?.(env) ?? 0);
        if (upper === "ABS") return (env) => Math.abs(args[0]?.(env) ?? 0);
        if (upper === "MIN") return (env) => Math.min(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        if (upper === "MAX") return (env) => Math.max(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
      }

      return (env) => env[id] ?? 0.0;
    }

    consume();
    return () => 0.0;
  }

  try {
    return parseAdditive();
  } catch {
    return () => 0.0;
  }
}

function selectProcessAndModel(
  doc: GpromsDocument,
  options?: GpromsSolverOptions,
): { process: GpromsProcess | undefined; model: GpromsModel } {
  let proc: GpromsProcess | undefined;
  if (options?.processName) {
    proc = doc.processes.get(options.processName);
  } else if (doc.processes.size > 0) {
    proc = doc.processes.values().next().value;
  }

  let model: GpromsModel | undefined;
  if (options?.modelName) {
    model = doc.models.get(options.modelName);
  } else if (proc && proc.units.size > 0) {
    const firstModelName = proc.units.values().next().value;
    if (firstModelName) model = doc.models.get(firstModelName);
  }
  if (!model) {
    model = doc.models.values().next().value;
  }
  if (!model) {
    throw new Error("No gPROMS MODEL found in document.");
  }

  return { process: proc, model };
}

export function solveGpromsProcess(doc: GpromsDocument, options?: GpromsSolverOptions): GpromsSimulationResult {
  const { process: proc, model } = selectProcessAndModel(doc, options);

  const solTotalTime = proc?.solutionParameters.get("TotalTime");
  const solTimeStep = proc?.solutionParameters.get("TimeStep") ?? proc?.solutionParameters.get("ReportingInterval");

  const duration = options?.duration ?? solTotalTime ?? 10.0;
  const dt = options?.timeStep ?? (solTimeStep ? Math.min(0.05, solTimeStep) : 0.01);
  const steps = Math.max(1, Math.round(duration / dt));

  // 1. Collect parameters (model defaults overridden by PROCESS SET)
  const baseEnv: Record<string, number> = {};
  for (const [pName, pDef] of model.parameters) {
    baseEnv[pName] = pDef.defaultValue ?? 0.0;
  }
  if (proc) {
    for (const entry of proc.setEntries) {
      baseEnv[entry.entityName] = entry.value;
    }
    // 2. Collect ASSIGNed input variables
    for (const entry of proc.assignEntries) {
      baseEnv[entry.entityName] = entry.value;
    }
  }

  // 3. Build spatial discretization grids for DISTRIBUTION_DOMAINs
  const spatialDomains: Record<string, number[]> = {};
  const domainDelta: Record<string, number> = {};
  const domainNames = new Set<string>(model.domains.keys());

  for (const [dName, dom] of model.domains) {
    const nPts = Math.max(2, dom.gridPoints);
    const dz = (dom.upperBound - dom.lowerBound) / (nPts - 1);
    domainDelta[dName] = dz;
    const grid: number[] = [];
    for (let i = 0; i < nPts; i++) {
      grid.push(dom.lowerBound + i * dz);
    }
    spatialDomains[dName] = grid;
  }

  // 4. Identify distributed vs lumped variables
  const distributedVars = new Set<string>();
  for (const [vName, vDef] of model.variables) {
    if (vDef.domains.length > 0) {
      distributedVars.add(vName);
    }
  }

  // 5. Partition equations into:
  //    - Boundary equations for distributed variables: u(0) = rhs
  //    - Distributed PDE equations: $u = rhs(u, PARTIAL(u, dom), ...)
  //    - Lumped differential equations: $x = rhs
  //    - Lumped algebraic equations: y = rhs
  const boundaryEvaluators = new Map<string, ExprEvaluator>();
  for (const beq of model.boundaryEquations) {
    const parenIdx = beq.lhs.indexOf("(");
    const varName = (parenIdx > 0 ? beq.lhs.slice(0, parenIdx) : beq.lhs).replace("$", "").trim();
    const normRhs = normalizeGpromsExprForEval(beq.rhs, distributedVars, domainNames);
    boundaryEvaluators.set(varName, compileGpromsMathExpr(normRhs));
  }

  const distributedPdeEvaluators = new Map<
    string,
    { domain: string; gridPoints: number; dz: number; evaluator: ExprEvaluator }
  >();
  const lumpedOdeEvaluators = new Map<string, ExprEvaluator>();
  const lumpedAlgEvaluators: Array<{ varName: string; evaluator: ExprEvaluator }> = [];

  for (const eq of model.equations) {
    const cleanLhs = eq.lhs.trim();
    const isTimeDeriv = cleanLhs.startsWith("$");
    const rawVar = isTimeDeriv ? cleanLhs.slice(1).trim() : cleanLhs;
    const parenIdx = rawVar.indexOf("(");
    const targetVar = (parenIdx > 0 ? rawVar.slice(0, parenIdx) : rawVar).trim();

    const normRhs = normalizeGpromsExprForEval(eq.rhs, distributedVars, domainNames);
    const compiledRhs = compileGpromsMathExpr(normRhs);

    if (isTimeDeriv) {
      const vDef = model.variables.get(targetVar);
      if (vDef && vDef.domains.length > 0) {
        const domName = vDef.domains[0]!;
        const dom = model.domains.get(domName);
        const gridPoints = Math.max(2, dom?.gridPoints ?? 10);
        const dz = domainDelta[domName] ?? 0.1;
        distributedPdeEvaluators.set(targetVar, {
          domain: domName,
          gridPoints,
          dz,
          evaluator: compiledRhs,
        });
      } else {
        lumpedOdeEvaluators.set(targetVar, compiledRhs);
      }
    } else {
      lumpedAlgEvaluators.push({ varName: targetVar, evaluator: compiledRhs });
    }
  }

  // 6. Initialize state vector
  const stateNames: string[] = [];
  const currentStates: Record<string, number> = {};

  const getInitialValueForVar = (varName: string): number => {
    if (proc) {
      const initVal = proc.initials.get(varName);
      if (initVal !== undefined) return initVal;
    }
    const vDef = model.variables.get(varName);
    if (vDef) {
      const vt = doc.variableTypes.get(vDef.typeName);
      if (vt) return vt.defaultValue;
    }
    return 0.0;
  };

  // Lumped ODE states
  for (const varName of lumpedOdeEvaluators.keys()) {
    stateNames.push(varName);
    currentStates[varName] = getInitialValueForVar(varName);
  }

  // Distributed PDE states (discretized along grid nodes 0 .. N-1)
  for (const [varName, pdeInfo] of distributedPdeEvaluators) {
    const initVal = getInitialValueForVar(varName);
    for (let i = 0; i < pdeInfo.gridPoints; i++) {
      const nodeKey = `${varName}_${i}`;
      stateNames.push(nodeKey);
      currentStates[nodeKey] = initVal;
    }
  }

  // Apply inlet boundary conditions at t = 0
  const applyBoundaryAndAlgebraic = (states: Record<string, number>, time: number): Record<string, number> => {
    const algValues: Record<string, number> = {};
    const env: Record<string, number> = { ...baseEnv, ...states, TIME: time, time };

    // Pin node 0 of distributed variables with boundary conditions
    for (const [varName, bEval] of boundaryEvaluators) {
      if (distributedPdeEvaluators.has(varName)) {
        const bVal = bEval(env);
        const node0Key = `${varName}_0`;
        states[node0Key] = bVal;
        env[node0Key] = bVal;
      }
    }

    // Evaluate lumped algebraic equations
    for (const alg of lumpedAlgEvaluators) {
      const val = alg.evaluator(env);
      algValues[alg.varName] = val;
      env[alg.varName] = val;
    }

    // Expose outlet value of each distributed variable under its base name
    for (const [varName, pdeInfo] of distributedPdeEvaluators) {
      const outletVal = states[`${varName}_${pdeInfo.gridPoints - 1}`] ?? 0.0;
      algValues[varName] = outletVal;
    }

    return algValues;
  };

  const initialAlg = applyBoundaryAndAlgebraic(currentStates, 0.0);
  const initialStates: Record<string, number> = { ...currentStates };
  for (const [varName, pdeInfo] of distributedPdeEvaluators) {
    initialStates[varName] = currentStates[`${varName}_${pdeInfo.gridPoints - 1}`] ?? 0.0;
  }

  // 7. Compute time derivatives d(states)/dt
  const computeDerivatives = (states: Record<string, number>, time: number): Record<string, number> => {
    const workStates: Record<string, number> = { ...states };
    const alg = applyBoundaryAndAlgebraic(workStates, time);
    const env: Record<string, number> = { ...baseEnv, ...workStates, ...alg, TIME: time, time };
    const derivs: Record<string, number> = {};

    // Lumped ODEs
    for (const [varName, odeEval] of lumpedOdeEvaluators) {
      derivs[varName] = odeEval(env);
    }

    // Distributed PDEs via Method of Lines (MOL)
    for (const [varName, pdeInfo] of distributedPdeEvaluators) {
      const { domain, gridPoints, dz, evaluator } = pdeInfo;
      const grid = spatialDomains[domain] ?? [];

      // Node 0: pinned if boundary condition exists, else upwind with zero gradient
      if (boundaryEvaluators.has(varName)) {
        derivs[`${varName}_0`] = 0.0;
      } else {
        const u0 = workStates[`${varName}_0`] ?? 0.0;
        const u1 = workStates[`${varName}_1`] ?? u0;
        const nodeEnv: Record<string, number> = {
          ...env,
          [varName]: u0,
          [domain]: grid[0] ?? 0.0,
          [`__d1_${varName}_${domain}`]: 0.0,
          [`__d2_${varName}_${domain}`]: (u1 - u0) / (dz * dz),
        };
        derivs[`${varName}_0`] = evaluator(nodeEnv);
      }

      // Interior and outlet nodes i = 1 .. N - 1
      for (let i = 1; i < gridPoints; i++) {
        const uPrev = workStates[`${varName}_${i - 1}`] ?? 0.0;
        const uCurr = workStates[`${varName}_${i}`] ?? 0.0;
        // Danckwerts zero-gradient outlet BC: ghost node u_{N} = u_{N-1}
        const uNext = i < gridPoints - 1 ? (workStates[`${varName}_${i + 1}`] ?? uCurr) : uCurr;

        const d1 = (uCurr - uPrev) / dz;
        const d2 = (uNext - 2.0 * uCurr + uPrev) / (dz * dz);

        const nodeEnv: Record<string, number> = {
          ...env,
          [varName]: uCurr,
          [domain]: grid[i] ?? i * dz,
          [`__d1_${varName}_${domain}`]: d1,
          [`__d2_${varName}_${domain}`]: d2,
        };

        // Also populate other distributed variables on the same domain at node i
        for (const [otherVar, otherInfo] of distributedPdeEvaluators) {
          if (otherVar !== varName && otherInfo.domain === domain) {
            const oPrev = workStates[`${otherVar}_${i - 1}`] ?? 0.0;
            const oCurr = workStates[`${otherVar}_${i}`] ?? 0.0;
            const oNext = i < gridPoints - 1 ? (workStates[`${otherVar}_${i + 1}`] ?? oCurr) : oCurr;
            nodeEnv[otherVar] = oCurr;
            nodeEnv[`__d1_${otherVar}_${domain}`] = (oCurr - oPrev) / dz;
            nodeEnv[`__d2_${otherVar}_${domain}`] = (oNext - 2.0 * oCurr + oPrev) / (dz * dz);
          }
        }

        derivs[`${varName}_${i}`] = evaluator(nodeEnv);
      }
    }

    return derivs;
  };

  // 8. RK4 time integration loop
  const trajectory: GpromsStepRecord[] = [
    {
      time: 0.0,
      states: { ...currentStates },
      algebraic: initialAlg,
    },
  ];

  let t = 0.0;
  for (let step = 0; step < steps; step++) {
    const k1 = computeDerivatives(currentStates, t);

    const s2: Record<string, number> = {};
    for (const k of stateNames) {
      s2[k] = (currentStates[k] ?? 0.0) + 0.5 * dt * (k1[k] ?? 0.0);
    }
    const k2 = computeDerivatives(s2, t + 0.5 * dt);

    const s3: Record<string, number> = {};
    for (const k of stateNames) {
      s3[k] = (currentStates[k] ?? 0.0) + 0.5 * dt * (k2[k] ?? 0.0);
    }
    const k3 = computeDerivatives(s3, t + 0.5 * dt);

    const s4: Record<string, number> = {};
    for (const k of stateNames) {
      s4[k] = (currentStates[k] ?? 0.0) + dt * (k3[k] ?? 0.0);
    }
    const k4 = computeDerivatives(s4, t + dt);

    for (const k of stateNames) {
      const delta = (dt / 6.0) * ((k1[k] ?? 0.0) + 2.0 * (k2[k] ?? 0.0) + 2.0 * (k3[k] ?? 0.0) + (k4[k] ?? 0.0));
      currentStates[k] = (currentStates[k] ?? 0.0) + delta;
    }

    t += dt;
    const alg = applyBoundaryAndAlgebraic(currentStates, t);

    if (steps <= 100 || step % Math.ceil(steps / 100) === 0 || step === steps - 1) {
      trajectory.push({
        time: t,
        states: { ...currentStates },
        algebraic: alg,
      });
    }
  }

  const finalAlg = applyBoundaryAndAlgebraic(currentStates, t);
  const finalStates: Record<string, number> = { ...currentStates, ...finalAlg };
  const finalSpatialProfiles: Record<string, number[]> = {};

  for (const [varName, pdeInfo] of distributedPdeEvaluators) {
    const profile: number[] = [];
    for (let i = 0; i < pdeInfo.gridPoints; i++) {
      profile.push(currentStates[`${varName}_${i}`] ?? 0.0);
    }
    finalSpatialProfiles[varName] = profile;
    finalStates[varName] = profile[profile.length - 1] ?? 0.0;
  }

  return {
    processName: proc?.name ?? "DefaultProcess",
    modelName: model.name,
    stateNames,
    initialStates,
    finalStates,
    spatialDomains,
    finalSpatialProfiles,
    trajectory,
    stepsCount: steps,
  };
}
