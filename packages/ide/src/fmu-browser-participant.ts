// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-safe FMU 2.0 co-simulation participant.
 *
 * Supports three execution modes (tried in order):
 *
 * 1. **WASM mode**: If the FMU archive contains `binaries/wasm32/*.wasm`,
 *    loads the WebAssembly module and calls FMI 2.0 C API functions
 *    directly through WASM exports.
 *
 * 2. **DAE mode**: If the archive contains `resources/model.json`
 *    (serialized DAE from ModelScript), uses Euler integration to
 *    evaluate der(x) = f(x, t) equations.
 *
 * 3. **Passthrough mode**: XML-only fallback where input values
 *    propagate to outputs unchanged.
 */

import { unzipSync } from "fflate";

// ── modelDescription.xml Parser (browser-safe, zero-dependency) ──

/** FMI scalar variable descriptor. */
interface FmiScalarVariable {
  name: string;
  valueReference: number;
  causality: "input" | "output" | "parameter" | "calculatedParameter" | "local" | "independent";
  variability: string;
  type: "Real" | "Integer" | "Boolean" | "String" | "Enumeration";
  start: number | string | boolean | undefined;
  unit: string | undefined;
  description: string | undefined;
}

/** Parsed FMI model description. */
interface FmiModelDescription {
  fmiVersion: string;
  modelName: string;
  guid: string;
  description: string | undefined;
  supportsCoSimulation: boolean;
  defaultExperiment?: {
    startTime?: number;
    stopTime?: number;
    stepSize?: number;
  };
  variables: FmiScalarVariable[];
}

/** Extract an attribute value from an XML attribute string. */
function extractAttrFromStr(attrs: string, attr: string): string | undefined {
  const match = attrs.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "s"));
  return match ? (match[1] ?? undefined) : undefined;
}

/** Extract an attribute from the first occurrence of an XML element. */
function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const elemMatch = xml.match(new RegExp(`<${element}\\s+([^>]*)>`, "s"));
  if (!elemMatch) return undefined;
  return extractAttrFromStr(elemMatch[1] ?? "", attr);
}

/** Parse modelDescription.xml into structured metadata. */
function parseModelDescription(xml: string): FmiModelDescription {
  const fmiVersion = extractAttr(xml, "fmiModelDescription", "fmiVersion") ?? "2.0";
  const modelName = extractAttr(xml, "fmiModelDescription", "modelName") ?? "Unknown";
  const guid = extractAttr(xml, "fmiModelDescription", "guid") ?? "";
  const description = extractAttr(xml, "fmiModelDescription", "description");

  const supportsCoSimulation = /<CoSimulation\s+/.test(xml);

  let defaultExperiment: FmiModelDescription["defaultExperiment"];
  const expMatch = xml.match(/<DefaultExperiment\s+([^>]*)\/?\\s*>/);
  if (expMatch) {
    const attrs = expMatch[1] ?? "";
    const startStr = extractAttrFromStr(attrs, "startTime");
    const stopStr = extractAttrFromStr(attrs, "stopTime");
    const stepStr = extractAttrFromStr(attrs, "stepSize");
    defaultExperiment = {
      startTime: startStr !== undefined ? parseFloat(startStr) : undefined,
      stopTime: stopStr !== undefined ? parseFloat(stopStr) : undefined,
      stepSize: stepStr !== undefined ? parseFloat(stepStr) : undefined,
    };
  }

  // Parse scalar variables
  const variables: FmiScalarVariable[] = [];
  const svRegex = /<ScalarVariable\s+([^>]*)>([\s\S]*?)<\/ScalarVariable>/g;
  let svMatch: RegExpExecArray | null;

  while ((svMatch = svRegex.exec(xml)) !== null) {
    const attrs = svMatch[1] ?? "";
    const body = svMatch[2] ?? "";

    const name = extractAttrFromStr(attrs, "name") ?? "";
    const valueReference = parseInt(extractAttrFromStr(attrs, "valueReference") ?? "0", 10);
    const svDescription = extractAttrFromStr(attrs, "description");
    const causality = (extractAttrFromStr(attrs, "causality") ?? "local") as FmiScalarVariable["causality"];
    const variability = extractAttrFromStr(attrs, "variability") ?? "continuous";

    let type: FmiScalarVariable["type"] = "Real";
    let start: number | string | boolean | undefined;
    let unit: string | undefined;

    const typeMatch = body.match(/<(Real|Integer|Boolean|String|Enumeration)\s*([^>]*)\/?\\s*>/);
    if (typeMatch) {
      type = (typeMatch[1] ?? "Real") as FmiScalarVariable["type"];
      const typeAttrs = typeMatch[2] ?? "";
      const startStr = extractAttrFromStr(typeAttrs, "start");
      if (startStr !== undefined) {
        if (type === "Real") start = parseFloat(startStr);
        else if (type === "Integer" || type === "Enumeration") start = parseInt(startStr, 10);
        else if (type === "Boolean") start = startStr === "true" || startStr === "1";
        else start = startStr;
      }
      unit = extractAttrFromStr(typeAttrs, "unit");
    }

    variables.push({ name, valueReference, causality, variability, type, start, unit, description: svDescription });
  }

  return { fmiVersion, modelName, guid, description, supportsCoSimulation, defaultExperiment, variables };
}

// ── JSON DAE Evaluator ──────────────────────────────────────────

/**
 * Lightweight evaluator for serialized DAE JSON.
 * Evaluates expressions and equations from the model.json format
 * to compute derivative values for Euler integration.
 */

type JSONExpr = Record<string, unknown>;
type JSONEquation = Record<string, unknown>;

/** Evaluate a serialized DAE expression given a value environment. */
function evalExpr(expr: JSONExpr, env: Map<string, number>): number | null {
  if (!expr || typeof expr !== "object") return null;
  const type = expr["@type"] as string;

  switch (type) {
    case "RealLiteral":
    case "IntegerLiteral":
      return typeof expr["value"] === "number" ? expr["value"] : null;

    case "BooleanLiteral":
      return expr["value"] === true ? 1 : 0;

    case "VariableReference": {
      const name = expr["name"] as string;
      return env.get(name) ?? null;
    }

    case "UnaryExpression": {
      const operand = evalExpr(expr["operand"] as JSONExpr, env);
      if (operand === null) return null;
      const op = expr["operator"] as string;
      if (op === "negate" || op === "-") return -operand;
      if (op === "not" || op === "!") return operand === 0 ? 1 : 0;
      return operand;
    }

    case "BinaryExpression": {
      const left = evalExpr(expr["expression1"] as JSONExpr, env);
      const right = evalExpr(expr["expression2"] as JSONExpr, env);
      if (left === null || right === null) return null;
      const op = expr["operator"] as string;
      switch (op) {
        case "+":
        case "add":
          return left + right;
        case "-":
        case "sub":
          return left - right;
        case "*":
        case "mul":
          return left * right;
        case "/":
        case "div":
          return right !== 0 ? left / right : null;
        case "^":
        case "pow":
          return Math.pow(left, right);
        case ">":
          return left > right ? 1 : 0;
        case "<":
          return left < right ? 1 : 0;
        case ">=":
          return left >= right ? 1 : 0;
        case "<=":
          return left <= right ? 1 : 0;
        case "==":
          return left === right ? 1 : 0;
        case "<>":
          return left !== right ? 1 : 0;
        default:
          return null;
      }
    }

    case "FunctionCallExpression": {
      const fnName = expr["name"] as string;
      const args = (expr["arguments"] as JSONExpr[]) ?? [];
      const argVals = args.map((a) => evalExpr(a, env));
      if (argVals.some((v) => v === null)) return null;
      const vals = argVals as number[];
      switch (fnName) {
        case "sin":
          return Math.sin(vals[0] ?? 0);
        case "cos":
          return Math.cos(vals[0] ?? 0);
        case "tan":
          return Math.tan(vals[0] ?? 0);
        case "exp":
          return Math.exp(vals[0] ?? 0);
        case "log":
          return Math.log(vals[0] ?? 0);
        case "sqrt":
          return Math.sqrt(vals[0] ?? 0);
        case "abs":
          return Math.abs(vals[0] ?? 0);
        case "max":
          return Math.max(vals[0] ?? 0, vals[1] ?? 0);
        case "min":
          return Math.min(vals[0] ?? 0, vals[1] ?? 0);
        default:
          return null;
      }
    }

    case "IfExpression": {
      const cond = evalExpr(expr["condition"] as JSONExpr, env);
      if (cond === null) return null;
      return cond !== 0
        ? evalExpr(expr["trueExpression"] as JSONExpr, env)
        : evalExpr(expr["falseExpression"] as JSONExpr, env);
    }

    default:
      return null;
  }
}

/** Extract der(x) target name from a serialized expression. */
function extractDerName(expr: JSONExpr): string | null {
  if (!expr) return null;
  const type = expr["@type"] as string;
  if (type === "FunctionCallExpression" && expr["name"] === "der") {
    const args = expr["arguments"] as JSONExpr[];
    if (args?.length === 1 && args[0]?.["@type"] === "VariableReference") {
      return args[0]["name"] as string;
    }
  }
  return null;
}

/**
 * Compute derivative values from a serialized DAE JSON.
 * Reads equations of the form `der(x) = f(x, t)` and evaluates them.
 */
function computeDerivativesFromJson(
  daeJson: Record<string, unknown>,
  time: number,
  stateValues: Map<string, number>,
): Map<string, number> {
  const env = new Map<string, number>();
  env.set("time", time);
  for (const [name, value] of stateValues) {
    env.set(name, value);
  }

  // Populate parameters and constants
  const variables = (daeJson["variables"] as JSONExpr[]) ?? [];
  for (const v of variables) {
    const variability = v["variability"] as string | undefined;
    if (variability === "parameter" || variability === "constant") {
      const binding = v["expression"] as JSONExpr | undefined;
      if (binding) {
        const value = evalExpr(binding, env);
        if (value !== null) env.set(v["name"] as string, value);
      }
    }
    // Also set start values for variables not yet in env
    const name = v["name"] as string;
    if (!env.has(name)) {
      const startAttr = v["start"];
      if (typeof startAttr === "number") {
        env.set(name, startAttr);
      }
    }
  }

  const derivatives = new Map<string, number>();
  const equations = (daeJson["equations"] as JSONEquation[]) ?? [];

  for (const eq of equations) {
    if (eq["@type"] !== "SimpleEquation") continue;
    const expr1 = eq["expression1"] as JSONExpr;
    const expr2 = eq["expression2"] as JSONExpr;

    const lhsDer = extractDerName(expr1);
    const rhsDer = extractDerName(expr2);

    if (lhsDer) {
      const value = evalExpr(expr2, env);
      if (value !== null) {
        derivatives.set(lhsDer, value);
        env.set(`der(${lhsDer})`, value);
      }
    } else if (rhsDer) {
      const value = evalExpr(expr1, env);
      if (value !== null) {
        derivatives.set(rhsDer, value);
        env.set(`der(${rhsDer})`, value);
      }
    }
  }

  return derivatives;
}

// ── ZIP extraction ──────────────────────────────────────────────

/**
 * Extract a file from an FMU (ZIP) archive by path.
 * Returns the file content as a UTF-8 string, or null if not found.
 */
function extractFileFromFmu(fmuBytes: Uint8Array, targetPath: string): string | null {
  try {
    const unzipped = unzipSync(fmuBytes);
    const fileData = unzipped[targetPath];
    if (!fileData) return null;
    return new TextDecoder().decode(fileData);
  } catch {
    return null;
  }
}

/** Find a .wasm file in the FMU archive under binaries/. */
function findWasmInFmu(fmuBytes: Uint8Array): Uint8Array | null {
  try {
    const unzipped = unzipSync(fmuBytes);
    // Search common WASM binary paths in priority order
    const wasmPaths = Object.keys(unzipped).filter(
      (p) => p.endsWith(".wasm") && (p.startsWith("binaries/") || p.includes("/wasm")),
    );
    if (wasmPaths.length === 0) {
      // Also check for .wasm at root level
      const rootWasm = Object.keys(unzipped).find((p) => p.endsWith(".wasm"));
      if (rootWasm) return unzipped[rootWasm] ?? null;
      return null;
    }
    const firstPath = wasmPaths[0];
    return (firstPath ? unzipped[firstPath] : null) ?? null;
  } catch {
    return null;
  }
}

// ── WASM FMI 2.0 Binding ────────────────────────────────────────

/** FMI 2.0 status codes. */
const FMI2_OK = 0;
// const FMI2_WARNING = 1;
// const FMI2_DISCARD = 2;
// const FMI2_ERROR = 3;
// const FMI2_FATAL = 4;

/** FMI 2.0 type enum. */
const FMI2_CO_SIMULATION = 1;

/**
 * Thin wrapper around a WASM FMI 2.0 module.
 * Handles memory management for passing strings and arrays
 * between JS and WASM linear memory.
 */
class WasmFmi2Instance {
  private instance: WebAssembly.Instance;
  private memory: WebAssembly.Memory;
  private component = 0; // fmi2Component pointer
  private allocations: number[] = []; // track allocations for cleanup

  constructor(instance: WebAssembly.Instance) {
    this.instance = instance;
    this.memory = instance.exports["memory"] as WebAssembly.Memory;
  }

  private get exports(): Record<string, CallableFunction> {
    return this.instance.exports as Record<string, CallableFunction>;
  }

  /** Allocate bytes in WASM linear memory. */
  private malloc(size: number): number {
    const alloc = this.exports["malloc"] ?? this.exports["fmi2_malloc"];
    if (!alloc) {
      // Fallback: grow memory and use a bump allocator at the end
      const pages = this.memory.buffer.byteLength;
      // Simple bump allocation from the end of current memory
      const ptr = pages; // Use current size as allocation point
      const needed = Math.ceil((ptr + size) / 65536);
      const current = this.memory.buffer.byteLength / 65536;
      if (needed > current) {
        this.memory.grow(needed - current);
      }
      this.allocations.push(ptr);
      return ptr;
    }
    const ptr = alloc(size) as number;
    this.allocations.push(ptr);
    return ptr;
  }

  /** Free allocated memory. */
  private free(ptr: number): void {
    const freeFn = this.exports["free"] ?? this.exports["fmi2_free"];
    if (freeFn) {
      freeFn(ptr);
    }
  }

  /** Write a string to WASM memory and return its pointer. */
  private writeString(str: string): number {
    const encoded = new TextEncoder().encode(str + "\0");
    const ptr = this.malloc(encoded.length);
    new Uint8Array(this.memory.buffer, ptr, encoded.length).set(encoded);
    return ptr;
  }

  /** Write an array of uint32 (value references) to WASM memory. */
  private writeUint32Array(values: number[]): number {
    const ptr = this.malloc(values.length * 4);
    const view = new Uint32Array(this.memory.buffer, ptr, values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v !== undefined) view[i] = v;
    }
    return ptr;
  }

  /** Write an array of float64 (Real values) to WASM memory. */
  private writeFloat64Array(values: number[]): number {
    // Ensure 8-byte alignment
    const ptr = this.malloc(values.length * 8 + 8);
    const aligned = (ptr + 7) & ~7;
    const view = new Float64Array(this.memory.buffer, aligned, values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v !== undefined) view[i] = v;
    }
    return aligned;
  }

  /** Read float64 values from WASM memory. */
  private readFloat64Array(ptr: number, count: number): number[] {
    const view = new Float64Array(this.memory.buffer, ptr, count);
    return Array.from(view);
  }

  /** Call fmi2Instantiate. */
  instantiate(instanceName: string, guid: string): boolean {
    const fn = this.exports["fmi2Instantiate"];
    if (!fn) return false;
    const namePtr = this.writeString(instanceName);
    const guidPtr = this.writeString(guid);
    const resourcePtr = this.writeString("");
    // fmi2Instantiate(instanceName, fmi2CoSimulation, guid, resourceLocation, callbacks, visible, loggingOn)
    // callbacks = NULL (0), visible = 0, loggingOn = 0
    this.component = fn(namePtr, FMI2_CO_SIMULATION, guidPtr, resourcePtr, 0, 0, 0) as number;
    return this.component !== 0;
  }

  /** Call fmi2SetupExperiment. */
  setupExperiment(startTime: number, stopTime: number, stepSize: number): boolean {
    const fn = this.exports["fmi2SetupExperiment"];
    if (!fn || !this.component) return false;
    // fmi2SetupExperiment(c, toleranceDefined, tolerance, startTime, stopTimeDefined, stopTime)
    const status = fn(this.component, 0, stepSize, startTime, 1, stopTime) as number;
    return status === FMI2_OK;
  }

  /** Call fmi2EnterInitializationMode. */
  enterInitializationMode(): boolean {
    const fn = this.exports["fmi2EnterInitializationMode"];
    if (!fn || !this.component) return false;
    return (fn(this.component) as number) === FMI2_OK;
  }

  /** Call fmi2ExitInitializationMode. */
  exitInitializationMode(): boolean {
    const fn = this.exports["fmi2ExitInitializationMode"];
    if (!fn || !this.component) return false;
    return (fn(this.component) as number) === FMI2_OK;
  }

  /** Call fmi2DoStep. */
  doStep(currentTime: number, stepSize: number): boolean {
    const fn = this.exports["fmi2DoStep"];
    if (!fn || !this.component) return false;
    // fmi2DoStep(c, currentCommunicationPoint, communicationStepSize, noSetFMUStatePriorToCurrentPoint)
    const status = fn(this.component, currentTime, stepSize, 1) as number;
    return status === FMI2_OK;
  }

  /** Call fmi2GetReal. */
  getReal(valueReferences: number[]): number[] | null {
    const fn = this.exports["fmi2GetReal"];
    if (!fn || !this.component) return null;
    const vrPtr = this.writeUint32Array(valueReferences);
    const valPtr = this.writeFloat64Array(new Array(valueReferences.length).fill(0));
    const status = fn(this.component, vrPtr, valueReferences.length, valPtr) as number;
    if (status !== FMI2_OK) return null;
    return this.readFloat64Array(valPtr, valueReferences.length);
  }

  /** Call fmi2SetReal. */
  setReal(valueReferences: number[], values: number[]): boolean {
    const fn = this.exports["fmi2SetReal"];
    if (!fn || !this.component) return false;
    const vrPtr = this.writeUint32Array(valueReferences);
    const valPtr = this.writeFloat64Array(values);
    const status = fn(this.component, vrPtr, valueReferences.length, valPtr) as number;
    return status === FMI2_OK;
  }

  /** Call fmi2Terminate. */
  terminate(): void {
    const fn = this.exports["fmi2Terminate"];
    if (fn && this.component) {
      fn(this.component);
    }
    const freeFn = this.exports["fmi2FreeInstance"];
    if (freeFn && this.component) {
      freeFn(this.component);
    }
    // Clean up tracked allocations
    for (const ptr of this.allocations) {
      this.free(ptr);
    }
    this.allocations = [];
    this.component = 0;
  }

  /** Check if the WASM module exports FMI 2.0 functions. */
  static hasRequiredExports(instance: WebAssembly.Instance): boolean {
    const exports = instance.exports;
    return (
      typeof exports["fmi2Instantiate"] === "function" &&
      typeof exports["fmi2DoStep"] === "function" &&
      typeof exports["fmi2GetReal"] === "function"
    );
  }
}

// ── FMU Browser Participant ──

/** Variable info exposed after initialization. */
export interface FmuVariable {
  name: string;
  causality: string;
  type: string;
  unit?: string;
  start?: number | string | boolean;
}

/**
 * Browser-safe FMU co-simulation participant.
 *
 * Supports XML-only mode (passthrough) and FMU archive mode
 * (real simulation using embedded model.json DAE).
 */
export class FmuBrowserParticipant {
  readonly id: string;
  readonly modelName: string;

  private modelDesc: FmiModelDescription | null = null;
  private readonly xmlContent: string;
  private readonly fmuBytes: Uint8Array | null;
  private variables_: FmuVariable[] = [];
  private currentValues = new Map<string, number>();
  private pendingInputs = new Map<string, number>();
  private _allValues: Record<string, number> = {};

  // DAE simulation state (only when model.json is available)
  private daeJson: Record<string, unknown> | null = null;
  private stateNames: string[] = [];
  private hasSimulator = false;

  // WASM simulation state
  private wasmInstance: WasmFmi2Instance | null = null;
  private hasWasm = false;

  constructor(id: string, xmlContentOrFmuBytes: string | Uint8Array) {
    this.id = id;

    if (typeof xmlContentOrFmuBytes === "string") {
      // XML-only mode
      this.xmlContent = xmlContentOrFmuBytes;
      this.fmuBytes = null;
    } else {
      // FMU archive mode — extract XML from ZIP
      this.fmuBytes = xmlContentOrFmuBytes;
      const xml = extractFileFromFmu(xmlContentOrFmuBytes, "modelDescription.xml");
      this.xmlContent = xml ?? "";
    }

    // Pre-parse to get the model name
    const nameMatch = this.xmlContent.match(/modelName\s*=\s*"([^"]*)"/);
    this.modelName = nameMatch?.[1] ?? "FMU";
  }

  /** Get variable metadata (available after initialize). */
  getVariables(): FmuVariable[] {
    return this.variables_;
  }

  /** Get all variable values from the last step. */
  get allValues(): Record<string, number> {
    return this._allValues;
  }

  /** Whether this participant has a real simulator (model.json loaded). */
  get isSimulating(): boolean {
    return this.hasSimulator;
  }

  async initialize(_startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.modelDesc = parseModelDescription(this.xmlContent);

    if (!this.modelDesc.supportsCoSimulation) {
      throw new Error(`FMU '${this.modelDesc.modelName}' does not support co-simulation`);
    }

    // Build variable list
    this.variables_ = this.modelDesc.variables
      .filter((v) => v.causality !== "local" && v.causality !== "independent")
      .map((v) => ({
        name: v.name,
        causality: v.causality,
        type: v.type,
        unit: v.unit,
        start: v.start,
      }));

    // Initialize values from start attributes
    for (const v of this.modelDesc.variables) {
      if (v.start !== undefined && typeof v.start === "number") {
        this.currentValues.set(v.name, v.start);
      } else if (v.type === "Boolean") {
        this.currentValues.set(v.name, v.start === true ? 1 : 0);
      } else {
        this.currentValues.set(v.name, 0);
      }
    }

    // Try execution modes in priority order: WASM → model.json → passthrough
    if (this.fmuBytes) {
      // 1. Try WASM execution
      const wasmBytes = findWasmInFmu(this.fmuBytes);
      if (wasmBytes) {
        try {
          const wasmModule = await WebAssembly.compile(wasmBytes as BufferSource);
          // Provide minimal imports for the WASM module
          const importObject: WebAssembly.Imports = {
            env: {
              memory: new WebAssembly.Memory({ initial: 256, maximum: 2048 }),
            },
            wasi_snapshot_preview1: {
              // Minimal WASI stubs for WASM modules compiled with WASI support
              // eslint-disable-next-line @typescript-eslint/no-empty-function
              proc_exit: () => {},
              fd_write: () => 0,
              fd_read: () => 0,
              fd_seek: () => 0,
              fd_close: () => 0,
              environ_get: () => 0,
              environ_sizes_get: () => 0,
              clock_time_get: () => 0,
            },
          };
          const wasmInst = await WebAssembly.instantiate(wasmModule, importObject);
          if (WasmFmi2Instance.hasRequiredExports(wasmInst)) {
            this.wasmInstance = new WasmFmi2Instance(wasmInst);
            const guid = this.modelDesc.guid;
            if (this.wasmInstance.instantiate(this.modelName, guid)) {
              this.wasmInstance.setupExperiment(_startTime, _stopTime, _stepSize);
              this.wasmInstance.enterInitializationMode();

              // Set initial input values
              const inputVrs: number[] = [];
              const inputVals: number[] = [];
              for (const v of this.modelDesc.variables) {
                if (v.causality === "input" && v.start !== undefined && typeof v.start === "number") {
                  inputVrs.push(v.valueReference);
                  inputVals.push(v.start);
                }
              }
              if (inputVrs.length > 0) {
                this.wasmInstance.setReal(inputVrs, inputVals);
              }

              this.wasmInstance.exitInitializationMode();
              this.hasWasm = true;
              console.log(`[fmu] WASM FMU loaded for '${this.modelName}'`);
            } else {
              console.warn("[fmu] fmi2Instantiate failed for WASM module");
              this.wasmInstance = null;
            }
          }
        } catch (e) {
          console.warn("[fmu] Failed to load WASM FMU:", e);
        }
      }

      // 2. Try model.json DAE execution
      if (!this.hasWasm) {
        const modelJsonStr = extractFileFromFmu(this.fmuBytes, "resources/model.json");
        if (modelJsonStr) {
          try {
            this.daeJson = JSON.parse(modelJsonStr) as Record<string, unknown>;
            const variables = (this.daeJson["variables"] as JSONExpr[]) ?? [];
            this.stateNames = variables
              .filter((v) => {
                const vty = v["variability"] as string | undefined;
                const vtype = v["@type"] as string;
                return vtype === "RealVariable" && !vty && !(v["name"] as string).startsWith("der(");
              })
              .map((v) => v["name"] as string);
            this.hasSimulator = true;
            console.log(
              `[fmu] Loaded model.json with ${this.stateNames.length} state variables for '${this.modelName}'`,
            );
          } catch (e) {
            console.warn("[fmu] Failed to parse model.json:", e);
          }
        }
      }
    }
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    if (!this.modelDesc) throw new Error("FMU participant not initialized");

    // Apply input overrides
    for (const [name, value] of this.pendingInputs) {
      this.currentValues.set(name, value);
    }

    if (this.hasWasm && this.wasmInstance) {
      // ── WASM execution mode ──
      // Set inputs via fmi2SetReal
      if (this.modelDesc) {
        const inputVrs: number[] = [];
        const inputVals: number[] = [];
        for (const v of this.modelDesc.variables) {
          if (v.causality === "input") {
            const val = this.currentValues.get(v.name);
            if (val !== undefined) {
              inputVrs.push(v.valueReference);
              inputVals.push(val);
            }
          }
        }
        if (inputVrs.length > 0) {
          this.wasmInstance.setReal(inputVrs, inputVals);
        }
      }

      // Advance the WASM FMU
      this.wasmInstance.doStep(currentTime, stepSize);

      // Read all outputs and parameters via fmi2GetReal
      if (this.modelDesc) {
        for (const v of this.modelDesc.variables) {
          if (v.causality === "output" || v.causality === "local") {
            const values = this.wasmInstance.getReal([v.valueReference]);
            if (values && values.length > 0) {
              this.currentValues.set(v.name, values[0] ?? 0);
            }
          }
        }
      }
    } else if (this.hasSimulator && this.daeJson) {
      // ── Real simulation mode: Euler integration ──
      const stateValues = new Map<string, number>();
      for (const name of this.stateNames) {
        stateValues.set(name, this.currentValues.get(name) ?? 0);
      }
      // Also include all current values for non-state variables
      for (const [name, value] of this.currentValues) {
        if (!stateValues.has(name)) {
          stateValues.set(name, value);
        }
      }

      const derivatives = computeDerivativesFromJson(this.daeJson, currentTime, stateValues);

      // Euler step: x(t+h) = x(t) + h * dx/dt
      for (const [name, derValue] of derivatives) {
        const currentValue = this.currentValues.get(name) ?? 0;
        this.currentValues.set(name, currentValue + stepSize * derValue);
      }

      // Update output variables that might depend on state
      // (re-evaluate any algebraic outputs from the DAE)
      const env = new Map<string, number>();
      env.set("time", currentTime + stepSize);
      for (const [name, value] of this.currentValues) {
        env.set(name, value);
      }
      for (const [name, value] of derivatives) {
        env.set(`der(${name})`, value);
      }

      // Evaluate algebraic equations for output variables
      const equations = (this.daeJson["equations"] as JSONEquation[]) ?? [];
      for (const eq of equations) {
        if (eq["@type"] !== "SimpleEquation") continue;
        const expr1 = eq["expression1"] as JSONExpr;
        const expr2 = eq["expression2"] as JSONExpr;

        // For equations like `output_var = expr`, evaluate the RHS
        if (expr1["@type"] === "VariableReference" && !extractDerName(expr1)) {
          const varName = expr1["name"] as string;
          // Only update output/local variables (not states being integrated)
          if (!this.stateNames.includes(varName) && !extractDerName(expr2)) {
            const value = evalExpr(expr2, env);
            if (value !== null) {
              this.currentValues.set(varName, value);
              env.set(varName, value);
            }
          }
        }
      }
    }

    // Update allValues snapshot
    this._allValues = {};
    for (const v of this.modelDesc.variables) {
      if (v.causality !== "local" && v.causality !== "independent") {
        const val = this.currentValues.get(v.name);
        if (val !== undefined) {
          this._allValues[v.name] = val;
        }
      }
    }

    this.pendingInputs.clear();
  }

  async getOutputs(): Promise<Map<string, number>> {
    const outputs = new Map<string, number>();
    if (!this.modelDesc) return outputs;
    for (const v of this.modelDesc.variables) {
      if (v.causality === "output") {
        const value = this.currentValues.get(v.name);
        if (value !== undefined) {
          outputs.set(v.name, value);
        }
      }
    }
    return outputs;
  }

  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, value] of values) {
      this.pendingInputs.set(name, value);
      this.currentValues.set(name, value);
    }
  }

  async terminate(): Promise<void> {
    this.currentValues.clear();
    this.pendingInputs.clear();
    this._allValues = {};
    this.modelDesc = null;
    this.daeJson = null;
    this.stateNames = [];
    this.hasSimulator = false;
    if (this.wasmInstance) {
      this.wasmInstance.terminate();
      this.wasmInstance = null;
    }
    this.hasWasm = false;
  }
}
