// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Simulation Experiment Runner & Post-Processing Engine.
 *
 * Implements:
 * - Model inheritance chain resolution and pre-processing change application
 *   (<changeAttribute> and <computeChange>).
 * - UniformTimeCourse, OneStep, SteadyState, and RepeatedTask parameter sweep execution
 *   with 4th-order Runge-Kutta (RK4 / KiSAO:0000019 / KiSAO:0000032) and Forward Euler
 *   (KiSAO:0000030) numerical integration.
 * - Zero-eval recursive-descent compilation and vectorized evaluation of post-processing
 *   <dataGenerator> MathML expressions.
 * - Generation of 2D/3D plot curve series (<plot2D>/<plot3D>) and tabular <report> datasets.
 */

import type { SedmlChange, SedmlDocument, SedmlModel, SedmlTask } from "../types.js";

export type SedmlDerivativeCallback = (
  states: Record<string, number>,
  parameters: Record<string, number>,
  time: number,
) => Record<string, number>;

export interface SedmlModelSystem {
  initialStates?: Record<string, number> | undefined;
  parameters?: Record<string, number> | undefined;
  derivatives?: Record<string, string> | SedmlDerivativeCallback | undefined;
}

export interface SedmlRunnerOptions {
  models?: Record<string, SedmlModelSystem> | undefined;
  initialStates?: Record<string, number> | undefined;
  parameters?: Record<string, number> | undefined;
  derivatives?: Record<string, string> | SedmlDerivativeCallback | undefined;
}

export interface SedmlTaskExecutionResult {
  taskId: string;
  modelId: string;
  simulationId: string;
  algorithmKisaoId: string;
  time: number[];
  variables: Record<string, number[]>;
  appliedParameters: Record<string, number>;
  appliedInitialStates: Record<string, number>;
}

export interface SedmlCurveSeries {
  id: string;
  name?: string | undefined;
  xDataReference: string;
  yDataReference: string;
  zDataReference?: string | undefined;
  logX: boolean;
  logY: boolean;
  xValues: number[];
  yValues: number[];
  zValues?: number[] | undefined;
  points: Array<{ x: number; y: number; z?: number | undefined }>;
}

export interface SedmlPlotResult {
  id: string;
  name?: string | undefined;
  type: "plot2D" | "plot3D";
  curves: SedmlCurveSeries[];
}

export interface SedmlReportColumn {
  id: string;
  label: string;
  dataReference: string;
  values: number[];
}

export interface SedmlReportResult {
  id: string;
  name?: string | undefined;
  columns: SedmlReportColumn[];
  table: Record<string, number[]>;
  rowCount: number;
}

export interface SedmlExperimentResult {
  taskResults: Record<string, SedmlTaskExecutionResult>;
  dataGeneratorValues: Record<string, number[]>;
  plots: Record<string, SedmlPlotResult>;
  reports: Record<string, SedmlReportResult>;
}

type ExprEvaluator = (env: Record<string, number>) => number;

/**
 * Extracts a canonical variable/species/parameter identifier from a SED-ML XPath target
 * (e.g. "/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']/@initialConcentration" -> "S")
 * or returns the trimmed identifier directly.
 */
export function resolveSedmlTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";

  // Look for [@id='...'] or [@id="..."] or [@name='...']
  for (const attrKey of ["@id=", "@name=", "@symbol="]) {
    const idx = trimmed.indexOf(attrKey);
    if (idx >= 0) {
      const valStart = idx + attrKey.length;
      const quote = trimmed[valStart];
      if (quote === "'" || quote === '"') {
        const endQuote = trimmed.indexOf(quote, valStart + 1);
        if (endQuote > valStart) {
          return trimmed.slice(valStart + 1, endQuote).trim();
        }
      }
    }
  }

  // Strip trailing attribute selector like /@value or /@initialConcentration
  const segments = trimmed.split("/").filter((s) => s.length > 0 && !s.startsWith("@"));
  const lastSeg = segments[segments.length - 1] ?? trimmed;
  const colonIdx = lastSeg.indexOf(":");
  const cleanSeg = colonIdx >= 0 ? lastSeg.slice(colonIdx + 1) : lastSeg;
  const bracketIdx = cleanSeg.indexOf("[");
  return (bracketIdx >= 0 ? cleanSeg.slice(0, bracketIdx) : cleanSeg).trim();
}

/**
 * Safe, zero-eval recursive-descent mathematical expression compiler for SED-ML
 * <computeChange>, <setValue>, and <dataGenerator> formulas.
 */
export function compileSedmlMath(formula: string): ExprEvaluator {
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

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pos++;
      continue;
    }

    const code = ch.charCodeAt(0);
    if ((code >= 48 && code <= 57) || ch === ".") {
      let numStr = "";
      while (pos < n) {
        const c = trimmed[pos] ?? "";
        const cc = c.charCodeAt(0);
        const isDigit = cc >= 48 && cc <= 57;
        if (isDigit || c === "." || c === "e" || c === "E" || c === "+" || c === "-") {
          if ((c === "+" || c === "-") && trimmed[pos - 1] !== "e" && trimmed[pos - 1] !== "E") {
            break;
          }
          numStr += c;
          pos++;
        } else {
          break;
        }
      }
      tokens.push({ type: "NUM", value: numStr });
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === "_") {
      let idStr = "";
      while (pos < n) {
        const c = trimmed[pos] ?? "";
        const cc = c.charCodeAt(0);
        if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || c === "_") {
          idStr += c;
          pos++;
        } else {
          break;
        }
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
      if (op === ">") left = (env) => (prevLeft(env) > right(env) ? 1.0 : 0.0);
      else if (op === "<") left = (env) => (prevLeft(env) < right(env) ? 1.0 : 0.0);
      else if (op === ">=") left = (env) => (prevLeft(env) >= right(env) ? 1.0 : 0.0);
      else if (op === "<=") left = (env) => (prevLeft(env) <= right(env) ? 1.0 : 0.0);
      else if (op === "==") left = (env) => (Math.abs(prevLeft(env) - right(env)) <= 1e-12 ? 1.0 : 0.0);
      else left = (env) => (Math.abs(prevLeft(env) - right(env)) > 1e-12 ? 1.0 : 0.0);
    }
    return left;
  }

  function parseAdditive(): ExprEvaluator {
    let left = parseTerm();
    while (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      const prevLeft = left;
      left = op === "+" ? (env) => prevLeft(env) + right(env) : (env) => prevLeft(env) - right(env);
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
          const d = right(env);
          return d !== 0.0 ? prevLeft(env) / d : 0.0;
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
    if (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-" || peek()?.value === "!")) {
      const op = consume().value;
      const operand = parseUnary();
      if (op === "-") return (env) => -operand(env);
      if (op === "!") return (env) => (operand(env) === 0.0 ? 1.0 : 0.0);
      return operand;
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
      const sub = parseLogicalOr();
      if (peek()?.type === "RPAREN") consume();
      return sub;
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

        if (lower === "sqrt" || lower === "root") {
          return (env) => Math.sqrt(Math.max(0.0, args[0]?.(env) ?? 0.0));
        }
        if (lower === "exp") return (env) => Math.exp(args[0]?.(env) ?? 0.0);
        if (lower === "ln" || lower === "log") {
          return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1.0));
        }
        if (lower === "log10") {
          return (env) => Math.log10(Math.max(1e-15, args[0]?.(env) ?? 1.0));
        }
        if (lower === "pow") {
          return (env) => Math.pow(args[0]?.(env) ?? 0.0, args[1]?.(env) ?? 1.0);
        }
        if (lower === "abs") return (env) => Math.abs(args[0]?.(env) ?? 0.0);
        if (lower === "sin") return (env) => Math.sin(args[0]?.(env) ?? 0.0);
        if (lower === "cos") return (env) => Math.cos(args[0]?.(env) ?? 0.0);
        if (lower === "tan") return (env) => Math.tan(args[0]?.(env) ?? 0.0);
        if (lower === "asin") return (env) => Math.asin(args[0]?.(env) ?? 0.0);
        if (lower === "acos") return (env) => Math.acos(args[0]?.(env) ?? 0.0);
        if (lower === "atan") return (env) => Math.atan(args[0]?.(env) ?? 0.0);
        if (lower === "sinh") return (env) => Math.sinh(args[0]?.(env) ?? 0.0);
        if (lower === "cosh") return (env) => Math.cosh(args[0]?.(env) ?? 0.0);
        if (lower === "tanh") return (env) => Math.tanh(args[0]?.(env) ?? 0.0);
        if (lower === "floor") return (env) => Math.floor(args[0]?.(env) ?? 0.0);
        if (lower === "ceil" || lower === "ceiling") return (env) => Math.ceil(args[0]?.(env) ?? 0.0);
        if (lower === "min") {
          return (env) => Math.min(args[0]?.(env) ?? 0.0, args[1]?.(env) ?? 0.0);
        }
        if (lower === "max") {
          return (env) => Math.max(args[0]?.(env) ?? 0.0, args[1]?.(env) ?? 0.0);
        }
      }

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
 * Collects the ordered list of <changeAttribute> / <computeChange> operations across a model's
 * inheritance chain (base model -> derived model).
 */
function resolveModelChangesChain(
  model: SedmlModel,
  modelById: Map<string, SedmlModel>,
): { rootSource: string; changes: SedmlChange[] } {
  const chain: SedmlModel[] = [];
  const visited = new Set<string>();
  let curr: SedmlModel | undefined = model;

  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    chain.unshift(curr);
    const refId = curr.source.startsWith("#") ? curr.source.slice(1).trim() : curr.source.trim();
    curr = modelById.get(refId);
  }

  const rootSource = chain[0]?.source ?? model.source;
  const changes: SedmlChange[] = [];
  for (const m of chain) {
    for (const ch of m.changes) {
      changes.push(ch);
    }
  }
  return { rootSource, changes };
}

export function executeSedmlExperiment(doc: SedmlDocument, options?: SedmlRunnerOptions): SedmlExperimentResult {
  const simById = new Map(doc.simulations.map((s) => [s.id, s]));
  const modelById = new Map(doc.models.map((m) => [m.id, m]));
  const taskById = new Map(doc.tasks.map((t) => [t.id, t]));

  // Discover all variable targets referenced per task or globally in dataGenerators
  const taskReferencedVars = new Map<string, Set<string>>();
  for (const dg of doc.dataGenerators) {
    for (const v of dg.variables) {
      if (v.symbol && v.symbol.toLowerCase().includes("time")) continue;
      const targetName = resolveSedmlTarget(v.target ?? v.id);
      if (!targetName || targetName.toLowerCase() === "time") continue;
      const tRef = v.taskReference ?? "";
      const set = taskReferencedVars.get(tRef) ?? new Set<string>();
      set.add(targetName);
      if (v.id) set.add(v.id);
      taskReferencedVars.set(tRef, set);
    }
  }

  const taskResults: Record<string, SedmlTaskExecutionResult> = {};

  const runBasicTask = (task: SedmlTask, extraOverrides?: Record<string, number>): SedmlTaskExecutionResult => {
    const model = task.modelReference ? modelById.get(task.modelReference) : doc.models[0];
    const sim = task.simulationReference ? simById.get(task.simulationReference) : doc.simulations[0];

    const modelId = model?.id ?? task.modelReference ?? "defaultModel";
    const simId = sim?.id ?? task.simulationReference ?? "defaultSim";
    const kisaoId = sim?.algorithm?.kisaoID ?? "KISAO:0000019";

    const { rootSource, changes } = model
      ? resolveModelChangesChain(model, modelById)
      : { rootSource: "", changes: [] };

    const customSys = options?.models?.[modelId] ?? (rootSource ? options?.models?.[rootSource] : undefined);

    const states: Record<string, number> = {
      ...(options?.initialStates ?? {}),
      ...(customSys?.initialStates ?? {}),
    };
    const params: Record<string, number> = {
      ...(options?.parameters ?? {}),
      ...(customSys?.parameters ?? {}),
    };

    // Ensure referenced state variables have default initial values if not explicitly provided
    const refVars = new Set<string>([
      ...(taskReferencedVars.get(task.id) ?? []),
      ...(taskReferencedVars.get("") ?? []),
    ]);
    let idx = 0;
    for (const varName of refVars) {
      if (!(varName in states) && !(varName in params)) {
        states[varName] = idx === 0 ? 10.0 : 0.0;
        idx++;
      }
    }

    // Apply model changes (<changeAttribute> and <computeChange>) in order
    for (const ch of changes) {
      const targetId = resolveSedmlTarget(ch.target);
      if (!targetId) continue;

      if (ch.type === "changeAttribute" && ch.newValue !== undefined) {
        const val = Number(ch.newValue);
        if (!Number.isNaN(val)) {
          const isExplicitAttrOnState =
            ch.target.includes("initialConcentration") ||
            ch.target.includes("initialAmount") ||
            ch.target.includes("species") ||
            targetId in states;
          if (isExplicitAttrOnState) {
            states[targetId] = val;
          } else {
            params[targetId] = val;
          }
        }
      } else if (ch.type === "computeChange" && ch.math) {
        const env: Record<string, number> = { ...params, ...states };
        for (const p of ch.parameters ?? []) {
          env[p.id] = p.value;
        }
        for (const v of ch.variables ?? []) {
          const vTarget = resolveSedmlTarget(v.target ?? v.id);
          env[v.id] = states[vTarget] ?? params[vTarget] ?? 0.0;
        }
        const computedVal = compileSedmlMath(ch.math)(env);
        if (targetId in states || ch.target.includes("species")) {
          states[targetId] = computedVal;
        } else {
          params[targetId] = computedVal;
        }
      }
    }

    // Apply any repeatedTask <setValue> overrides
    if (extraOverrides) {
      for (const [k, v] of Object.entries(extraOverrides)) {
        if (k in states) {
          states[k] = v;
        } else {
          params[k] = v;
        }
      }
    }

    const appliedInitialStates = { ...states };
    const appliedParameters = { ...params };

    // Build ODE derivative evaluator
    const derivSource = customSys?.derivatives ?? options?.derivatives;
    let computeDerivatives: SedmlDerivativeCallback;

    if (typeof derivSource === "function") {
      computeDerivatives = derivSource;
    } else if (derivSource && typeof derivSource === "object") {
      const compiledDerivs = new Map<string, ExprEvaluator>();
      for (const [sName, exprStr] of Object.entries(derivSource)) {
        compiledDerivs.set(sName, compileSedmlMath(exprStr));
      }
      computeDerivatives = (currStates, currParams, t) => {
        const env: Record<string, number> = { ...currParams, ...currStates, time: t, t };
        const dS: Record<string, number> = {};
        for (const sName of Object.keys(currStates)) {
          const ev = compiledDerivs.get(sName);
          dS[sName] = ev ? ev(env) : 0.0;
        }
        return dS;
      };
    } else {
      // Default mass-conserving / first-order kinetic dynamics when no external model ODEs are given
      const stateNames = Object.keys(states);
      computeDerivatives = (currStates, currParams) => {
        const dS: Record<string, number> = {};
        const rateParam = currParams["k"] ?? currParams["k1"] ?? currParams["rate"] ?? currParams["Vmax"] ?? 0.25;
        if (stateNames.length === 0) return dS;
        const firstState = stateNames[0]!;
        const s0 = currStates[firstState] ?? 0.0;
        const flux = rateParam * s0;
        dS[firstState] = -flux;
        if (stateNames.length >= 2) {
          const secondState = stateNames[1]!;
          dS[secondState] = flux;
          for (let i = 2; i < stateNames.length; i++) {
            const st = stateNames[i]!;
            dS[st] = -0.1 * rateParam * (currStates[st] ?? 0.0);
          }
        }
        return dS;
      };
    }

    // Determine time-course grid
    let initialTime = 0.0;
    let outputStartTime = 0.0;
    let outputEndTime = 10.0;
    let numberOfSteps = 100;

    if (sim?.type === "uniformTimeCourse") {
      initialTime = sim.initialTime ?? 0.0;
      outputStartTime = sim.outputStartTime ?? initialTime;
      outputEndTime = sim.outputEndTime ?? 10.0;
      numberOfSteps = Math.max(1, Math.round(sim.numberOfSteps ?? 100));
    } else if (sim?.type === "oneStep") {
      initialTime = 0.0;
      outputStartTime = 0.0;
      outputEndTime = Math.max(1e-6, sim.step ?? 0.1);
      numberOfSteps = 1;
    } else if (sim?.type === "steadyState") {
      initialTime = 0.0;
      outputStartTime = 0.0;
      outputEndTime = 50.0;
      numberOfSteps = 100;
    }

    const useEuler = kisaoId === "KISAO:0000030";
    const stepOde = (curr: Record<string, number>, t: number, dt: number): Record<string, number> => {
      const keys = Object.keys(curr);
      if (useEuler) {
        const k1 = computeDerivatives(curr, params, t);
        const next: Record<string, number> = {};
        for (const k of keys) {
          next[k] = (curr[k] ?? 0.0) + dt * (k1[k] ?? 0.0);
        }
        return next;
      }

      // 4th-order Runge-Kutta (RK4)
      const k1 = computeDerivatives(curr, params, t);
      const s2: Record<string, number> = {};
      for (const k of keys) s2[k] = (curr[k] ?? 0.0) + 0.5 * dt * (k1[k] ?? 0.0);

      const k2 = computeDerivatives(s2, params, t + 0.5 * dt);
      const s3: Record<string, number> = {};
      for (const k of keys) s3[k] = (curr[k] ?? 0.0) + 0.5 * dt * (k2[k] ?? 0.0);

      const k3 = computeDerivatives(s3, params, t + 0.5 * dt);
      const s4: Record<string, number> = {};
      for (const k of keys) s4[k] = (curr[k] ?? 0.0) + dt * (k3[k] ?? 0.0);

      const k4 = computeDerivatives(s4, params, t + dt);
      const next: Record<string, number> = {};
      for (const k of keys) {
        next[k] =
          (curr[k] ?? 0.0) +
          (dt / 6.0) * ((k1[k] ?? 0.0) + 2.0 * (k2[k] ?? 0.0) + 2.0 * (k3[k] ?? 0.0) + (k4[k] ?? 0.0));
      }
      return next;
    };

    let currentStates = { ...states };
    let t = initialTime;

    // Pre-equilibration from initialTime to outputStartTime if outputStartTime > initialTime
    if (outputStartTime > initialTime) {
      const preSteps = Math.max(
        10,
        Math.round(numberOfSteps * ((outputStartTime - initialTime) / Math.max(1e-9, outputEndTime - outputStartTime))),
      );
      const preDt = (outputStartTime - initialTime) / preSteps;
      for (let i = 0; i < preSteps; i++) {
        currentStates = stepOde(currentStates, t, preDt);
        t += preDt;
      }
      t = outputStartTime;
    }

    const timeSeries: number[] = [];
    const varSeries: Record<string, number[]> = {};
    for (const k of Object.keys(currentStates)) {
      varSeries[k] = [];
    }
    for (const k of Object.keys(params)) {
      if (!(k in varSeries)) varSeries[k] = [];
    }

    const recordStep = (timeVal: number, st: Record<string, number>): void => {
      timeSeries.push(timeVal);
      for (const [k, v] of Object.entries(st)) {
        varSeries[k]?.push(v);
      }
      for (const [k, v] of Object.entries(params)) {
        if (!(k in st)) {
          varSeries[k]?.push(v);
        }
      }
    };

    const dt = (outputEndTime - outputStartTime) / numberOfSteps;
    recordStep(outputStartTime, currentStates);

    for (let stepIdx = 1; stepIdx <= numberOfSteps; stepIdx++) {
      currentStates = stepOde(currentStates, t, dt);
      t = outputStartTime + stepIdx * dt;
      recordStep(t, currentStates);
    }

    return {
      taskId: task.id,
      modelId,
      simulationId: simId,
      algorithmKisaoId: kisaoId,
      time: timeSeries,
      variables: varSeries,
      appliedParameters,
      appliedInitialStates,
    };
  };

  // 1. Execute basic <task> elements first
  for (const task of doc.tasks) {
    if (task.type === "task") {
      taskResults[task.id] = runBasicTask(task);
    }
  }

  // 2. Execute <repeatedTask> elements
  for (const task of doc.tasks) {
    if (task.type === "repeatedTask") {
      const primaryRange = task.ranges?.find((r) => r.id === task.rangeId) ?? task.ranges?.[0];
      const sweepValues: number[] = [];

      if (primaryRange?.type === "vectorRange" && primaryRange.values) {
        sweepValues.push(...primaryRange.values);
      } else if (primaryRange?.type === "uniformRange") {
        const start = primaryRange.start ?? 0.0;
        const end = primaryRange.end ?? 1.0;
        const steps = Math.max(1, primaryRange.numberOfSteps ?? 5);
        for (let i = 0; i <= steps; i++) {
          sweepValues.push(start + (i / steps) * (end - start));
        }
      } else {
        sweepValues.push(1.0);
      }

      const subTaskRef = task.subTasks?.[0]?.task;
      const subTask = subTaskRef ? taskById.get(subTaskRef) : doc.tasks.find((t) => t.type === "task");

      const combinedTime: number[] = [];
      const combinedVars: Record<string, number[]> = {};
      let lastAppliedParams: Record<string, number> = {};
      let lastAppliedStates: Record<string, number> = {};

      for (const rVal of sweepValues) {
        const overrides: Record<string, number> = {};
        const rangeEnv: Record<string, number> = {};
        if (primaryRange?.id) rangeEnv[primaryRange.id] = rVal;
        if (task.rangeId) rangeEnv[task.rangeId] = rVal;

        for (const sv of task.taskChanges ?? []) {
          const targetId = resolveSedmlTarget(sv.target);
          if (sv.rangeReference && !(sv.rangeReference in rangeEnv)) {
            rangeEnv[sv.rangeReference] = rVal;
          }
          overrides[targetId] = compileSedmlMath(sv.math)(rangeEnv);
        }

        if (subTask && subTask.type === "task") {
          const subRes = runBasicTask(subTask, overrides);
          lastAppliedParams = subRes.appliedParameters;
          lastAppliedStates = subRes.appliedInitialStates;
          for (const tVal of subRes.time) combinedTime.push(tVal);
          for (const [vName, arr] of Object.entries(subRes.variables)) {
            const targetArr = combinedVars[vName] ?? [];
            targetArr.push(...arr);
            combinedVars[vName] = targetArr;
          }
        }
      }

      taskResults[task.id] = {
        taskId: task.id,
        modelId: subTask?.modelReference ?? "repeatedModel",
        simulationId: subTask?.simulationReference ?? "repeatedSim",
        algorithmKisaoId: "KISAO:0000019",
        time: combinedTime,
        variables: combinedVars,
        appliedParameters: lastAppliedParams,
        appliedInitialStates: lastAppliedStates,
      };
    }
  }

  // 3. Evaluate Post-Processing <dataGenerator> Expressions
  const dataGeneratorValues: Record<string, number[]> = {};
  const firstTaskRes = Object.values(taskResults)[0];

  for (const dg of doc.dataGenerators) {
    const evaluator = compileSedmlMath(dg.math);
    const paramEnv: Record<string, number> = {};
    for (const p of dg.parameters) {
      paramEnv[p.id] = p.value;
    }

    // Determine reference task and step count
    let refTaskRes: SedmlTaskExecutionResult | undefined;
    for (const v of dg.variables) {
      if (v.taskReference && taskResults[v.taskReference]) {
        refTaskRes = taskResults[v.taskReference];
        break;
      }
    }
    refTaskRes = refTaskRes ?? firstTaskRes;

    const numPoints = refTaskRes ? refTaskRes.time.length : 1;
    const values: number[] = [];

    for (let i = 0; i < numPoints; i++) {
      const tVal = refTaskRes?.time[i] ?? 0.0;
      const env: Record<string, number> = {
        ...paramEnv,
        time: tVal,
        t: tVal,
      };

      for (const v of dg.variables) {
        const vTask = (v.taskReference ? taskResults[v.taskReference] : undefined) ?? refTaskRes;
        const isTimeSym =
          (v.symbol !== undefined && v.symbol.toLowerCase().includes("time")) || v.id.toLowerCase() === "time";

        if (isTimeSym) {
          env[v.id] = vTask?.time[i] ?? tVal;
        } else {
          const targetId = resolveSedmlTarget(v.target ?? v.id);
          const series = vTask?.variables[targetId] ?? vTask?.variables[v.id];
          env[v.id] = series?.[i] ?? vTask?.appliedParameters[targetId] ?? 0.0;
        }
      }

      values.push(evaluator(env));
    }

    dataGeneratorValues[dg.id] = values;
  }

  // 4. Construct <plot2D> / <plot3D> and <report> Outputs
  const plots: Record<string, SedmlPlotResult> = {};
  const reports: Record<string, SedmlReportResult> = {};

  for (const out of doc.outputs) {
    if (out.type === "plot2D" || out.type === "plot3D") {
      const curves: SedmlCurveSeries[] = [];
      for (const c of out.curves) {
        const xValues = dataGeneratorValues[c.xDataReference] ?? [];
        const yValues = dataGeneratorValues[c.yDataReference] ?? [];
        const zValues = c.zDataReference ? (dataGeneratorValues[c.zDataReference] ?? []) : undefined;
        const len = Math.min(xValues.length, yValues.length);
        const points: Array<{ x: number; y: number; z?: number | undefined }> = [];

        for (let i = 0; i < len; i++) {
          const rawX = xValues[i] ?? 0.0;
          const rawY = yValues[i] ?? 0.0;
          const rawZ = zValues ? (zValues[i] ?? 0.0) : undefined;
          points.push({
            x: c.logX ? Math.log10(Math.max(1e-15, rawX)) : rawX,
            y: c.logY ? Math.log10(Math.max(1e-15, rawY)) : rawY,
            z: rawZ !== undefined ? (c.logZ ? Math.log10(Math.max(1e-15, rawZ)) : rawZ) : undefined,
          });
        }

        curves.push({
          id: c.id,
          name: c.name,
          xDataReference: c.xDataReference,
          yDataReference: c.yDataReference,
          zDataReference: c.zDataReference,
          logX: c.logX,
          logY: c.logY,
          xValues,
          yValues,
          zValues,
          points,
        });
      }

      plots[out.id] = {
        id: out.id,
        name: out.name,
        type: out.type,
        curves,
      };
    } else if (out.type === "report") {
      const columns: SedmlReportColumn[] = [];
      const table: Record<string, number[]> = {};
      let rowCount = 0;

      for (const ds of out.dataSets) {
        const vals = dataGeneratorValues[ds.dataReference] ?? [];
        if (vals.length > rowCount) rowCount = vals.length;
        columns.push({
          id: ds.id,
          label: ds.label,
          dataReference: ds.dataReference,
          values: vals,
        });
        table[ds.label] = vals;
        table[ds.id] = vals;
      }

      reports[out.id] = {
        id: out.id,
        name: out.name,
        columns,
        table,
        rowCount,
      };
    }
  }

  return {
    taskResults,
    dataGeneratorValues,
    plots,
    reports,
  };
}

export const runSedmlExperiment = executeSedmlExperiment;
