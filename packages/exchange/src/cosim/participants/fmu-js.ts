// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU-JS co-simulation participant.
 *
 * Loads the modelDescription.xml metadata from an uploaded FMU archive
 * (via FmuStorage) and simulates using the same JS simulation engine
 * that backs the JsSimulatorParticipant — but with variables/metadata
 * sourced from the FMU descriptor rather than from a live DAE.
 *
 * Use case: import a third-party FMU that was exported from ModelScript
 * (and thus contains a `model.json` DAE inside the archive) and run it
 * without recompilation.
 */

import vm from "node:vm";
import type { FmiModelDescription, FmiScalarVariable } from "../../fmu/model-description.js";
import type { FmuStorage, StoredFmu } from "../../fmu/storage.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * Options for creating an FMU-JS participant.
 */
export interface FmuJsParticipantOptions {
  /** Unique participant ID. */
  id: string;
  /** FMU ID in the FmuStorage. */
  fmuId: string;
  /** FmuStorage instance. */
  storage: FmuStorage;
  /** Optional SVG icon override. */
  iconSvg?: string | undefined;
}

/**
 * Co-simulation participant backed by an uploaded FMU archive.
 *
 * Uses the parsed modelDescription.xml for variable metadata and
 * implements the FMI-2 co-simulation stepping interface. Currently
 * supports "passthrough" mode where input→output couplings are
 * forwarded directly, with optional algebraic mapping functions
 * to be added in a future release.
 */
export class FmuJsParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;

  private readonly storedFmu: StoredFmu;
  private readonly modelDesc: FmiModelDescription;

  /** Current variable values (keyed by variable name). */
  private values = new Map<string, number>();
  /** Pending input overrides. */
  private inputOverrides = new Map<string, number>();
  /** Current simulation time. */
  private currentTime = 0;
  /** Whether the participant has been initialized. */
  private initialized = false;

  /** Optional instantiated JS model from resources/model.js. */
  private jsModel: {
    vars: Float64Array;
    time: number;
    getDerivatives: () => void;
    doStep: (t: number, dt: number) => void;
  } | null = null;

  /** Optional parsed equation/state evaluator from resources/model.json. */
  private jsonModel: {
    equations: { lhs: string; rhs: string }[];
    states: { stateName: string; derName: string }[];
  } | null = null;

  private readonly storage: FmuStorage;

  constructor(options: FmuJsParticipantOptions) {
    this.id = options.id;
    this.storage = options.storage;

    // Load metadata from storage
    const stored = options.storage.get(options.fmuId);
    if (!stored) {
      throw new Error(`FMU '${options.fmuId}' not found in storage`);
    }
    this.storedFmu = stored;
    this.modelDesc = stored.modelDescription;
    this.modelName = this.modelDesc.modelName;

    // Check co-simulation support
    if (!this.modelDesc.supportsCoSimulation) {
      throw new Error(`FMU '${this.modelName}' does not support co-simulation`);
    }

    // Build participant metadata from FMI variables
    const variables: ParticipantVariable[] = this.modelDesc.variables
      .filter((v) => v.causality !== "local")
      .map((v: FmiScalarVariable) => ({
        name: v.name,
        causality: mapFmiCausality(v.causality),
        type: (v.type === "Enumeration" ? "Integer" : v.type) as ParticipantVariable["type"],
        unit: v.unit,
        start: typeof v.start === "number" ? v.start : undefined,
        description: v.description,
      }));

    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "fmu-js",
      classKind: "model",
      description: this.modelDesc.description,
      variables,
      iconSvg: options.iconSvg,
      timestamp: new Date().toISOString(),
    };
  }

  async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.currentTime = startTime;

    // Initialize variable values from FMU start attributes
    for (const v of this.modelDesc.variables) {
      if (v.start !== undefined && typeof v.start === "number") {
        this.values.set(v.name, v.start);
      } else if (v.type === "Boolean") {
        this.values.set(v.name, v.start === true ? 1 : 0);
      } else if (v.type === "Integer" || v.type === "Enumeration") {
        this.values.set(v.name, typeof v.start === "number" ? v.start : 0);
      } else {
        this.values.set(v.name, 0); // Default Real to 0
      }
    }

    // Apply default experiment annotations
    if (this.modelDesc.defaultExperiment?.startTime !== undefined) {
      this.currentTime = this.modelDesc.defaultExperiment.startTime;
    }

    // 1. Try loading compiled JS model (resources/model.js) from FmuStorage
    const modelJsBuf =
      this.storage.getExtractedFile(this.storedFmu.id, "resources/model.js") ??
      this.storage.getExtractedFile(this.id, "resources/model.js");
    if (modelJsBuf) {
      try {
        const jsSource = typeof modelJsBuf === "string" ? modelJsBuf : new TextDecoder().decode(modelJsBuf);
        const sandbox = Object.create(null) as Record<string, unknown>;
        Object.assign(sandbox, {
          Math,
          Number,
          Boolean,
          String,
          Array,
          Object,
          Float64Array,
          Int32Array,
          Uint8Array,
          JSON,
          NaN,
          Infinity,
          isFinite,
          isNaN,
        });
        const vmContext = vm.createContext(sandbox, {
          codeGeneration: { strings: false, wasm: false },
        });
        const instantiated = vm.runInContext(`${jsSource}\nnew FmuModel();`, vmContext, {
          timeout: 1000,
        }) as {
          vars: Float64Array;
          time: number;
          getDerivatives: () => void;
          doStep: (t: number, dt: number) => void;
        };
        if (
          instantiated &&
          typeof instantiated === "object" &&
          typeof instantiated.getDerivatives === "function" &&
          typeof instantiated.doStep === "function" &&
          instantiated.vars instanceof Float64Array
        ) {
          this.jsModel = {
            vars: instantiated.vars,
            get time() {
              return instantiated.time;
            },
            set time(v: number) {
              instantiated.time = v;
            },
            getDerivatives: () => {
              vm.runInContext("this.__inst.getDerivatives()", Object.assign(vmContext, { __inst: instantiated }), {
                timeout: 250,
              });
            },
            doStep: (t: number, dt: number) => {
              vm.runInContext(
                "this.__inst.doStep(this.__t, this.__dt)",
                Object.assign(vmContext, { __inst: instantiated, __t: t, __dt: dt }),
                { timeout: 250 },
              );
            },
          };
          this.syncToJsModel();
          this.jsModel.time = this.currentTime;
          this.jsModel.getDerivatives();
          this.syncFromJsModel();
        }
      } catch {
        this.jsModel = null;
      }
    }

    // 2. Otherwise try loading serialized model.json from FmuStorage
    if (!this.jsModel) {
      const modelJsonString = this.storage.getModelJson(this.storedFmu.id) ?? this.storage.getModelJson(this.id);
      if (modelJsonString) {
        try {
          const parsed = JSON.parse(modelJsonString) as Record<string, unknown>;
          const equations: { lhs: string; rhs: string }[] = [];
          const states: { stateName: string; derName: string }[] = [];

          if (Array.isArray(parsed["equations"])) {
            for (const eq of parsed["equations"]) {
              if (
                eq &&
                typeof eq === "object" &&
                typeof (eq as Record<string, unknown>)["lhs"] === "string" &&
                typeof (eq as Record<string, unknown>)["rhs"] === "string"
              ) {
                equations.push({
                  lhs: (eq as Record<string, string>)["lhs"]!,
                  rhs: (eq as Record<string, string>)["rhs"]!,
                });
              }
            }
          }
          for (const v of this.modelDesc.variables) {
            const m = /^der\((.+)\)$/.exec(v.name);
            if (m?.[1]) {
              states.push({ stateName: m[1], derName: v.name });
            }
          }
          this.jsonModel = { equations, states };
          this.evaluateJsonEquations(this.currentTime);
        } catch {
          this.jsonModel = null;
        }
      }
    }

    this.initialized = true;
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    if (!this.initialized) throw new Error("FMU-JS participant not initialized");

    // Apply input overrides before stepping
    for (const [name, value] of this.inputOverrides) {
      this.values.set(name, value);
    }

    if (this.jsModel) {
      this.syncToJsModel();
      this.jsModel.doStep(currentTime, stepSize);
      this.syncFromJsModel();
    } else if (this.jsonModel && (this.jsonModel.equations.length > 0 || this.jsonModel.states.length > 0)) {
      this.stepJsonModelRk4(currentTime, stepSize);
    } else {
      // Integrate any der(x) variables present in modelDescription using RK4
      const statePairs: { stateName: string; derName: string }[] = [];
      for (const v of this.modelDesc.variables) {
        const m = /^der\((.+)\)$/.exec(v.name);
        if (m?.[1] && this.values.has(m[1])) {
          statePairs.push({ stateName: m[1], derName: v.name });
        }
      }
      for (const { stateName, derName } of statePairs) {
        const x0 = this.values.get(stateName) ?? 0;
        const dx = this.values.get(derName) ?? 0;
        this.values.set(stateName, x0 + dx * stepSize);
      }
    }

    this.currentTime = currentTime + stepSize;
    this.inputOverrides.clear();
  }

  private syncToJsModel(): void {
    if (!this.jsModel) return;
    for (const v of this.modelDesc.variables) {
      const val = this.values.get(v.name);
      if (val !== undefined && v.valueReference < this.jsModel.vars.length) {
        this.jsModel.vars[v.valueReference] = val;
      }
    }
  }

  private syncFromJsModel(): void {
    if (!this.jsModel) return;
    for (const v of this.modelDesc.variables) {
      if (v.valueReference < this.jsModel.vars.length) {
        const val = this.jsModel.vars[v.valueReference];
        if (val !== undefined && Number.isFinite(val)) {
          this.values.set(v.name, val);
        }
      }
    }
  }

  private evaluateJsonEquations(time: number): void {
    if (!this.jsonModel) return;
    for (const eq of this.jsonModel.equations) {
      const val = this.evalSimpleExpr(eq.rhs, time);
      if (Number.isFinite(val)) {
        this.values.set(eq.lhs, val);
      }
    }
  }

  private stepJsonModelRk4(t0: number, dt: number): void {
    if (!this.jsonModel) return;
    const states = this.jsonModel.states;
    if (states.length === 0) {
      this.evaluateJsonEquations(t0 + dt);
      return;
    }
    const y0 = states.map((s) => this.values.get(s.stateName) ?? 0);

    this.evaluateJsonEquations(t0);
    const k1 = states.map((s) => this.values.get(s.derName) ?? 0);

    for (let i = 0; i < states.length; i++) {
      this.values.set(states[i]!.stateName, y0[i]! + 0.5 * dt * k1[i]!);
    }
    this.evaluateJsonEquations(t0 + 0.5 * dt);
    const k2 = states.map((s) => this.values.get(s.derName) ?? 0);

    for (let i = 0; i < states.length; i++) {
      this.values.set(states[i]!.stateName, y0[i]! + 0.5 * dt * k2[i]!);
    }
    this.evaluateJsonEquations(t0 + 0.5 * dt);
    const k3 = states.map((s) => this.values.get(s.derName) ?? 0);

    for (let i = 0; i < states.length; i++) {
      this.values.set(states[i]!.stateName, y0[i]! + dt * k3[i]!);
    }
    this.evaluateJsonEquations(t0 + dt);
    const k4 = states.map((s) => this.values.get(s.derName) ?? 0);

    for (let i = 0; i < states.length; i++) {
      const nextVal = y0[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
      this.values.set(states[i]!.stateName, nextVal);
    }
    this.evaluateJsonEquations(t0 + dt);
  }

  private evalSimpleExpr(expr: string, time: number): number {
    const trimmed = expr.trim();
    if (!trimmed || trimmed.length > 4096) return 0;
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
    if (trimmed === "time") return time;
    if (this.values.has(trimmed)) return this.values.get(trimmed)!;
    try {
      const res = evaluateSafeMathExpr(trimmed, time, this.values);
      return Number.isFinite(res) ? res : 0;
    } catch {
      return 0;
    }
  }

  async getOutputs(): Promise<Map<string, number>> {
    const outputs = new Map<string, number>();
    for (const v of this.modelDesc.variables) {
      if (v.causality === "output") {
        const value = this.values.get(v.name);
        if (value !== undefined) {
          outputs.set(v.name, value);
        }
      }
    }
    return outputs;
  }

  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, value] of values) {
      this.inputOverrides.set(name, value);
      this.values.set(name, value);
    }
  }

  async terminate(): Promise<void> {
    this.values.clear();
    this.inputOverrides.clear();
    this.jsModel = null;
    this.jsonModel = null;
    this.initialized = false;
  }

  /** Get the underlying FMI model description. */
  getModelDescription(): FmiModelDescription {
    return this.modelDesc;
  }

  /** Get all current variable values. */
  getAllValues(): ReadonlyMap<string, number> {
    return this.values;
  }
}

// ── Helpers ──

const SAFE_MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

/**
 * Safe recursive-descent arithmetic evaluator supporting numbers, variables,
 * `time`, `Math.*` functions, unary `+/-`, `+`, `-`, `*`, `/`, `%`, and `**`/`^`.
 * Never invokes `eval` or `new Function`.
 */
function evaluateSafeMathExpr(expr: string, time: number, vars: ReadonlyMap<string, number>): number {
  let pos = 0;
  const len = expr.length;

  function skipWs(): void {
    while (pos < len && (expr[pos] === " " || expr[pos] === "\t" || expr[pos] === "\n" || expr[pos] === "\r")) {
      pos++;
    }
  }

  function parseExpression(): number {
    let val = parseTerm();
    while (true) {
      skipWs();
      const ch = expr[pos];
      if (ch === "+") {
        pos++;
        val += parseTerm();
      } else if (ch === "-") {
        pos++;
        val -= parseTerm();
      } else {
        break;
      }
    }
    return val;
  }

  function parseTerm(): number {
    let val = parsePower();
    while (true) {
      skipWs();
      const ch = expr[pos];
      if (ch === "*" && expr[pos + 1] !== "*") {
        pos++;
        val *= parsePower();
      } else if (ch === "/") {
        pos++;
        const rhs = parsePower();
        val = rhs === 0 ? 0 : val / rhs;
      } else if (ch === "%") {
        pos++;
        const rhs = parsePower();
        val = rhs === 0 ? 0 : val % rhs;
      } else {
        break;
      }
    }
    return val;
  }

  function parsePower(): number {
    const base = parseUnary();
    skipWs();
    if (expr[pos] === "^") {
      pos++;
      return Math.pow(base, parsePower());
    }
    if (expr[pos] === "*" && expr[pos + 1] === "*") {
      pos += 2;
      return Math.pow(base, parsePower());
    }
    return base;
  }

  function parseUnary(): number {
    skipWs();
    if (expr[pos] === "+") {
      pos++;
      return parseUnary();
    }
    if (expr[pos] === "-") {
      pos++;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    skipWs();
    if (pos >= len) throw new Error("Unexpected end of expression");

    if (expr[pos] === "(") {
      pos++;
      const inner = parseExpression();
      skipWs();
      if (expr[pos] !== ")") throw new Error("Missing closing parenthesis");
      pos++;
      return inner;
    }

    // Numeric literal
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(expr.slice(pos));
    if (numMatch) {
      pos += numMatch[0].length;
      return Number(numMatch[0]);
    }

    // Check `der(...)` variable lookup first if present in vars
    if (expr.startsWith("der(", pos)) {
      const closeIdx = expr.indexOf(")", pos + 4);
      if (closeIdx !== -1) {
        const candidate = expr.slice(pos, closeIdx + 1);
        if (vars.has(candidate)) {
          pos = closeIdx + 1;
          return vars.get(candidate)!;
        }
      }
    }

    // Identifier (including dotted names like `Math.sin` or `comp.var`)
    const idMatch = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(expr.slice(pos));
    if (idMatch) {
      const ident = idMatch[0];
      pos += ident.length;
      skipWs();

      // Function call
      if (expr[pos] === "(") {
        pos++;
        const args: number[] = [];
        skipWs();
        if (expr[pos] !== ")") {
          args.push(parseExpression());
          skipWs();
          while (expr[pos] === ",") {
            pos++;
            args.push(parseExpression());
            skipWs();
          }
        }
        if (expr[pos] !== ")") throw new Error("Missing closing parenthesis in call");
        pos++;
        const fnKey = ident.startsWith("Math.") ? ident.slice(5) : ident;
        const fn = SAFE_MATH_FUNCS[fnKey];
        if (!fn) throw new Error(`Unsupported function: ${ident}`);
        return fn(...args);
      }

      if (ident === "time") return time;
      if (ident === "Math.PI" || ident === "pi") return Math.PI;
      if (ident === "Math.E") return Math.E;
      if (vars.has(ident)) return vars.get(ident)!;
      throw new Error(`Unknown identifier: ${ident}`);
    }

    throw new Error(`Unexpected token at position ${pos}`);
  }

  const result = parseExpression();
  skipWs();
  if (pos < len) {
    throw new Error(`Unexpected trailing characters at position ${pos}`);
  }
  return result;
}

/** Map FMI causality to participant variable causality. */
function mapFmiCausality(causality: string): "input" | "output" | "parameter" | "local" {
  switch (causality) {
    case "input":
      return "input";
    case "output":
      return "output";
    case "parameter":
    case "calculatedParameter":
      return "parameter";
    default:
      return "local";
  }
}
