// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU & ROM Subsystem adapters for the ModelicaSimulator & Co-Simulation.
 *
 * When a DAE contains variables marked as originating from an FMU
 * (via the `__fmu__` naming convention) or reduced-order surrogate model,
 * the simulator delegates their evaluation to an FMU co-simulation participant
 * or trained ROM instead of solving them algebraically.
 *
 * Provides:
 *  - FmuSubsystem interface for co-simulation stepping
 *  - LookupTableFmuSubsystem for table-based linear ROMs
 *  - NeuralNetFmuSubsystem for trained neural network surrogate models
 *  - FmuSubsystemRegistry for managing registered FMU/ROM subsystems
 */

export interface TrainedROM {
  inputNames: string[];
  outputNames: string[];
  inputScaling?: { mean: number; std: number }[] | undefined;
  outputScaling?: { mean: number; std: number }[] | undefined;
  weights?: any;
  evaluate?: ((input: number[]) => number[]) | undefined;
  [key: string]: any;
}

export function evaluateROM(rom: TrainedROM, rawInput: number[]): number[] {
  if (typeof rom.evaluate === "function") {
    return rom.evaluate(rawInput);
  }
  const inputScaling = rom.inputScaling ?? [];
  const outputScaling = rom.outputScaling ?? [];
  const normInput = rawInput.map((v, i) => {
    const s = inputScaling[i]!;
    return s && s.std !== 0 ? (v - s.mean) / s.std : v;
  });
  let normOutput: number[] = [];
  const applyActivation = (z: number, actName: string | undefined): number => {
    switch (actName) {
      case "relu":
        return Math.max(0, z);
      case "tanh":
        return Math.tanh(z);
      case "sigmoid":
        return 1.0 / (1.0 + Math.exp(-z));
      case "swish":
      case "silu":
        return z / (1.0 + Math.exp(-z));
      case "linear":
      case "identity":
      case "none":
        return z;
      default:
        return Math.tanh(z);
    }
  };
  const w = rom.weights;
  if (w && w.type === "neural_net" && Array.isArray(w.layers)) {
    let act = normInput;
    for (let l = 0; l < w.layers.length; l++) {
      const layer = w.layers[l];
      const isLast = l === w.layers.length - 1;
      const actType = layer.activation ?? (isLast ? (w.outputActivation ?? "tanh") : (w.activation ?? "tanh"));
      const next: number[] = [];
      for (let j = 0; j < layer.biases.length; j++) {
        let sum = layer.biases[j];
        for (let k = 0; k < act.length; k++) {
          sum += layer.weights[j][k] * act[k]!;
        }
        next.push(applyActivation(sum, actType));
      }
      act = next;
    }
    normOutput = act;
  } else if (w && w.type === "mlp" && Array.isArray(w.layers)) {
    let a = normInput;
    for (let l = 0; l < w.layers.length; l++) {
      const layer = w.layers[l]!;
      const { W, b } = layer;
      const isHidden = l < w.layers.length - 1;
      const actType: string =
        layer.activation ?? (isHidden ? (w.activation ?? "tanh") : (w.outputActivation ?? "linear"));
      const next: number[] = [];
      for (let i = 0; i < W.length; i++) {
        let z = b[i]!;
        for (let j = 0; j < a.length; j++) z += W[i]![j]! * a[j]!;
        next.push(applyActivation(z, actType));
      }
      a = next;
    }
    normOutput = a;
  } else if (w && Array.isArray(w.coefficients)) {
    normOutput = w.coefficients.map((row: number[]) => {
      let sum = 0;
      for (let j = 0; j < normInput.length && j < row.length; j++) {
        sum += row[j]! * normInput[j]!;
      }
      return sum;
    });
  } else {
    normOutput = normInput.slice(0, rom.outputNames?.length ?? normInput.length);
  }
  return normOutput.map((v, i) => {
    const s = outputScaling[i];
    return s ? v * s.std + s.mean : v;
  });
}

/**
 * Interface for an FMU subsystem that the simulator can call
 * during its integration loop.
 */
export interface FmuSubsystem {
  /** FMU model name. */
  readonly modelName: string;

  /** Names of input variables this FMU accepts. */
  readonly inputNames: string[];

  /** Names of output variables this FMU produces. */
  readonly outputNames: string[];

  /** Names of all parameters (tunable at initialization). */
  readonly parameterNames: string[];

  /**
   * Initialize the FMU for simulation.
   * @param startTime  Simulation start time
   * @param stopTime   Simulation stop time
   * @param stepSize   Communication step size
   */
  initialize(startTime: number, stopTime: number, stepSize: number): void;

  /**
   * Set input variable values before stepping.
   * @param inputs  Map of input variable name → value
   */
  setInputs(inputs: Map<string, number>): void;

  /**
   * Advance the FMU by one communication step.
   * @param currentTime  Current simulation time
   * @param stepSize     Step size to advance
   */
  doStep(currentTime: number, stepSize: number): void;

  /**
   * Get output values after stepping.
   * @returns Map of output variable name → value
   */
  getOutputs(): Map<string, number>;

  /** Terminate the FMU and release resources. */
  terminate(): void;
}

/**
 * A synchronous in-memory FMU subsystem backed by a lookup table.
 *
 * Used for reduced-order models (ROMs) that have been pre-computed:
 * given input values and a time step, the ROM interpolates from
 * a pre-computed dataset (e.g., a CFD reduced-order model).
 */
export class LookupTableFmuSubsystem implements FmuSubsystem {
  readonly modelName: string;
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[];

  private data = new Map<number, Map<string, number>>();
  private currentOutputs = new Map<string, number>();
  private gains: Map<string, Map<string, number>>;
  private offsets: Map<string, number>;

  constructor(
    modelName: string,
    inputNames: string[],
    outputNames: string[],
    parameterNames: string[] = [],
    gains?: Map<string, Map<string, number>>,
    offsets?: Map<string, number>,
  ) {
    this.modelName = modelName;
    this.inputNames = inputNames;
    this.outputNames = outputNames;
    this.parameterNames = parameterNames;
    this.gains = gains ?? new Map();
    this.offsets = offsets ?? new Map();
  }

  initialize(_startTime: number, _stopTime: number, _stepSize: number): void {
    this.currentOutputs.clear();
    for (const name of this.outputNames) {
      this.currentOutputs.set(name, this.offsets.get(name) ?? 0);
    }
  }

  setInputs(inputs: Map<string, number>): void {
    for (const outName of this.outputNames) {
      const outputGains = this.gains.get(outName);
      let value = this.offsets.get(outName) ?? 0;
      if (outputGains) {
        for (const [inName, gain] of outputGains) {
          const u = inputs.get(inName) ?? 0;
          value += gain * u;
        }
      }
      this.currentOutputs.set(outName, value);
    }
  }

  doStep(_currentTime: number, _stepSize: number): void {
    // Outputs were already computed in setInputs
  }

  getOutputs(): Map<string, number> {
    return new Map(this.currentOutputs);
  }

  terminate(): void {
    this.currentOutputs.clear();
    this.data.clear();
  }
}

/**
 * An FmuSubsystem backed by a trained ROM (MLP, RBF, or polynomial).
 *
 * On each `doStep()`, evaluates the ROM's forward pass with current
 * input values and populates outputs.
 */
export class NeuralNetFmuSubsystem implements FmuSubsystem {
  readonly modelName: string;
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[] = [];

  private rom: TrainedROM;
  private currentInputs = new Map<string, number>();
  private currentOutputs = new Map<string, number>();

  constructor(modelName: string, rom: TrainedROM) {
    this.modelName = modelName;
    this.rom = rom;
    this.inputNames = rom.inputNames;
    this.outputNames = rom.outputNames;
  }

  initialize(_startTime: number, _stopTime: number, _stepSize: number): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
    for (const name of this.inputNames) this.currentInputs.set(name, 0);
    for (const name of this.outputNames) this.currentOutputs.set(name, 0);
  }

  setInputs(inputs: Map<string, number>): void {
    for (const [name, value] of inputs) {
      if (this.currentInputs.has(name)) {
        this.currentInputs.set(name, value);
      }
    }
    this.evaluate();
  }

  doStep(_currentTime: number, _stepSize: number): void {
    this.evaluate();
  }

  getOutputs(): Map<string, number> {
    return new Map(this.currentOutputs);
  }

  terminate(): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
  }

  updateROM(rom: TrainedROM): void {
    this.rom = rom;
  }

  getTrainedROM(): TrainedROM {
    return this.rom;
  }

  private evaluate(): void {
    const inputVec = this.inputNames.map((name) => this.currentInputs.get(name) ?? 0);
    const outputVec = evaluateROM(this.rom, inputVec);
    for (let i = 0; i < this.outputNames.length; i++) {
      this.currentOutputs.set(this.outputNames[i] as string, outputVec[i] ?? 0);
    }
  }
}

/**
 * Generic inference function for external neural networks / ONNX models:
 * Maps an input vector [in_0, ..., in_{m-1}] to output vector [out_0, ..., out_{n-1}].
 */
export type NeuralInferenceFn = (inputs: Float64Array) => Float64Array | number[];

/**
 * An FmuSubsystem backed by an external ONNX inference session or neural network function.
 * Enables zero-overhead evaluation of external PyTorch/JAX/ONNX models directly inside ModelScript simulations.
 */
export class OnnxFmuSubsystem implements FmuSubsystem {
  readonly modelName: string;
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[] = [];

  private inferenceFn: NeuralInferenceFn;
  private currentInputs = new Map<string, number>();
  private currentOutputs = new Map<string, number>();
  private inputBuffer: Float64Array;

  constructor(modelName: string, inputNames: string[], outputNames: string[], inferenceFn: NeuralInferenceFn) {
    this.modelName = modelName;
    this.inputNames = inputNames;
    this.outputNames = outputNames;
    this.inferenceFn = inferenceFn;
    this.inputBuffer = new Float64Array(inputNames.length);
  }

  initialize(_startTime: number, _stopTime: number, _stepSize: number): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
    for (const name of this.inputNames) this.currentInputs.set(name, 0);
    for (const name of this.outputNames) this.currentOutputs.set(name, 0);
  }

  setInputs(inputs: Map<string, number>): void {
    for (const [name, value] of inputs) {
      if (this.currentInputs.has(name)) {
        this.currentInputs.set(name, value);
      }
    }
    this.evaluate();
  }

  doStep(_currentTime: number, _stepSize: number): void {
    this.evaluate();
  }

  getOutputs(): Map<string, number> {
    return new Map(this.currentOutputs);
  }

  terminate(): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
  }

  setInferenceFn(fn: NeuralInferenceFn): void {
    this.inferenceFn = fn;
  }

  private evaluate(): void {
    for (let i = 0; i < this.inputNames.length; i++) {
      this.inputBuffer[i] = this.currentInputs.get(this.inputNames[i]!) ?? 0;
    }
    const out = this.inferenceFn(this.inputBuffer);
    for (let i = 0; i < this.outputNames.length; i++) {
      this.currentOutputs.set(this.outputNames[i] as string, out[i] ?? 0);
    }
  }
}

/**
 * Interface for an FMU Model Exchange participant.
 *
 * Unlike Co-Simulation (which advances via discrete doStep(h) intervals),
 * Model Exchange integrates directly into the continuous DAE solver:
 * - States x and continuous derivatives dx/dt are evaluated continuously
 * - Inputs u are pushed directly at any time point
 * - Algebraic outputs y and event indicators z are queried on demand
 */
export interface ModelExchangeSubsystem {
  /** Model name */
  readonly modelName: string;
  /** Number of continuous states */
  readonly numberOfContinuousStates: number;
  /** Number of event indicators */
  readonly numberOfEventIndicators: number;
  /** Continuous state variable names */
  readonly stateNames: string[];
  /** Continuous state derivative variable names */
  readonly derivativeNames: string[];
  /** Input variable names */
  readonly inputNames: string[];
  /** Output variable names */
  readonly outputNames: string[];
  /** Parameter names */
  readonly parameterNames: string[];

  /** Initialize the Model Exchange instance */
  initialize(startTime: number, stopTime: number): void;
  /** Set continuous time */
  setTime(time: number): void;
  /** Set continuous states */
  setContinuousStates(states: Float64Array | number[]): void;
  /** Get continuous states */
  getContinuousStates(): Float64Array;
  /** Get continuous state derivatives */
  getContinuousStateDerivatives(): Float64Array;
  /** Get event indicators */
  getEventIndicators(): Float64Array;
  /** Set inputs */
  setInputs(inputs: Map<string, number>): void;
  /** Get algebraic/continuous outputs */
  getOutputs(): Map<string, number>;
  /** Complete an integrator step */
  completedIntegratorStep(): { enterEventMode: boolean; terminateSimulation: boolean };
  /** Terminate the instance */
  terminate(): void;
}

/**
 * In-memory FMU Model Exchange subsystem implementation.
 */
export class ModelExchangeFmuSubsystem implements ModelExchangeSubsystem {
  readonly modelName: string;
  readonly numberOfContinuousStates: number;
  readonly numberOfEventIndicators: number;
  readonly stateNames: string[];
  readonly derivativeNames: string[];
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[];

  private currentTime = 0;
  private states: Float64Array;
  private derivatives: Float64Array;
  private eventIndicators: Float64Array;
  private currentInputs = new Map<string, number>();
  private currentOutputs = new Map<string, number>();
  private derivativeFn?: ((t: number, x: Float64Array, u: Map<string, number>) => Float64Array | number[]) | undefined;
  private outputFn?: ((t: number, x: Float64Array, u: Map<string, number>) => Map<string, number>) | undefined;

  constructor(options: {
    modelName: string;
    stateNames: string[];
    derivativeNames?: string[] | undefined;
    inputNames?: string[] | undefined;
    outputNames?: string[] | undefined;
    parameterNames?: string[] | undefined;
    numberOfEventIndicators?: number | undefined;
    initialStates?: Float64Array | number[] | undefined;
    derivativeFn?: ((t: number, x: Float64Array, u: Map<string, number>) => Float64Array | number[]) | undefined;
    outputFn?: ((t: number, x: Float64Array, u: Map<string, number>) => Map<string, number>) | undefined;
  }) {
    this.modelName = options.modelName;
    this.stateNames = options.stateNames;
    this.numberOfContinuousStates = options.stateNames.length;
    this.derivativeNames = options.derivativeNames ?? options.stateNames.map((s) => `der(${s})`);
    this.inputNames = options.inputNames ?? [];
    this.outputNames = options.outputNames ?? [];
    this.parameterNames = options.parameterNames ?? [];
    this.numberOfEventIndicators = options.numberOfEventIndicators ?? 0;
    this.derivativeFn = options.derivativeFn;
    this.outputFn = options.outputFn;

    this.states = new Float64Array(this.numberOfContinuousStates);
    if (options.initialStates) {
      for (let i = 0; i < options.initialStates.length && i < this.states.length; i++) {
        this.states[i] = options.initialStates[i]!;
      }
    }
    this.derivatives = new Float64Array(this.numberOfContinuousStates);
    this.eventIndicators = new Float64Array(this.numberOfEventIndicators);
  }

  initialize(startTime: number, _stopTime: number): void {
    this.currentTime = startTime;
    this.evaluateDerivatives();
    this.evaluateOutputs();
  }

  setTime(time: number): void {
    this.currentTime = time;
  }

  setContinuousStates(states: Float64Array | number[]): void {
    for (let i = 0; i < this.states.length && i < states.length; i++) {
      this.states[i] = states[i]!;
    }
    this.evaluateDerivatives();
    this.evaluateOutputs();
  }

  getContinuousStates(): Float64Array {
    return new Float64Array(this.states);
  }

  getContinuousStateDerivatives(): Float64Array {
    this.evaluateDerivatives();
    return new Float64Array(this.derivatives);
  }

  getEventIndicators(): Float64Array {
    return new Float64Array(this.eventIndicators);
  }

  setInputs(inputs: Map<string, number>): void {
    for (const [k, v] of inputs) {
      this.currentInputs.set(k, v);
    }
    this.evaluateDerivatives();
    this.evaluateOutputs();
  }

  getOutputs(): Map<string, number> {
    this.evaluateOutputs();
    return new Map(this.currentOutputs);
  }

  completedIntegratorStep(): { enterEventMode: boolean; terminateSimulation: boolean } {
    return { enterEventMode: false, terminateSimulation: false };
  }

  terminate(): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
  }

  private evaluateDerivatives(): void {
    if (this.derivativeFn) {
      const res = this.derivativeFn(this.currentTime, this.states, this.currentInputs);
      for (let i = 0; i < this.derivatives.length && i < res.length; i++) {
        this.derivatives[i] = res[i]!;
      }
    }
  }

  private evaluateOutputs(): void {
    if (this.outputFn) {
      const out = this.outputFn(this.currentTime, this.states, this.currentInputs);
      for (const [k, v] of out) {
        this.currentOutputs.set(k, v);
      }
    }
  }
}

/**
 * Wrap a Model Exchange subsystem into an FmuSubsystem (Co-Simulation) using a micro-integrator.
 */
export function createCoSimFromModelExchange(
  me: ModelExchangeSubsystem,
  stepSolver: "rk4" | "euler" = "rk4",
): FmuSubsystem {
  return {
    modelName: me.modelName,
    inputNames: me.inputNames,
    outputNames: me.outputNames,
    parameterNames: me.parameterNames,

    initialize(startTime: number, stopTime: number, _stepSize: number): void {
      me.initialize(startTime, stopTime);
    },

    setInputs(inputs: Map<string, number>): void {
      me.setInputs(inputs);
    },

    doStep(currentTime: number, stepSize: number): void {
      const n = me.numberOfContinuousStates;
      if (n === 0) {
        me.setTime(currentTime + stepSize);
        return;
      }

      const x0 = me.getContinuousStates();

      if (stepSolver === "euler") {
        me.setTime(currentTime);
        const f0 = me.getContinuousStateDerivatives();
        const xNext = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xNext[i] = x0[i]! + stepSize * f0[i]!;
        }
        me.setTime(currentTime + stepSize);
        me.setContinuousStates(xNext);
        me.completedIntegratorStep();
      } else {
        // RK4 micro-integrator
        me.setTime(currentTime);
        const k1 = me.getContinuousStateDerivatives();

        const xStage1 = new Float64Array(n);
        for (let i = 0; i < n; i++) xStage1[i] = x0[i]! + 0.5 * stepSize * k1[i]!;
        me.setTime(currentTime + 0.5 * stepSize);
        me.setContinuousStates(xStage1);
        const k2 = me.getContinuousStateDerivatives();

        const xStage2 = new Float64Array(n);
        for (let i = 0; i < n; i++) xStage2[i] = x0[i]! + 0.5 * stepSize * k2[i]!;
        me.setContinuousStates(xStage2);
        const k3 = me.getContinuousStateDerivatives();

        const xStage3 = new Float64Array(n);
        for (let i = 0; i < n; i++) xStage3[i] = x0[i]! + stepSize * k3[i]!;
        me.setTime(currentTime + stepSize);
        me.setContinuousStates(xStage3);
        const k4 = me.getContinuousStateDerivatives();

        const xNext = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xNext[i] = x0[i]! + (stepSize / 6.0) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
        }
        me.setContinuousStates(xNext);
        me.completedIntegratorStep();
      }
    },

    getOutputs(): Map<string, number> {
      return me.getOutputs();
    },

    terminate(): void {
      me.terminate();
    },
  };
}

/**
 * Registry of FMU subsystems available to the simulator.
 */
export class FmuSubsystemRegistry {
  private subsystems = new Map<string, FmuSubsystem>();
  private meSubsystems = new Map<string, ModelExchangeSubsystem>();

  register(instanceName: string, subsystem: FmuSubsystem): void {
    this.subsystems.set(instanceName, subsystem);
  }

  registerME(instanceName: string, subsystem: ModelExchangeSubsystem): void {
    this.meSubsystems.set(instanceName, subsystem);
    // Also auto-register CoSim adapter so it can be stepped in co-simulation if requested
    this.subsystems.set(instanceName, createCoSimFromModelExchange(subsystem));
  }

  get(instanceName: string): FmuSubsystem | undefined {
    return this.subsystems.get(instanceName);
  }

  getME(instanceName: string): ModelExchangeSubsystem | undefined {
    return this.meSubsystems.get(instanceName);
  }

  has(instanceName: string): boolean {
    return this.subsystems.has(instanceName);
  }

  hasME(instanceName: string): boolean {
    return this.meSubsystems.has(instanceName);
  }

  entries(): IterableIterator<[string, FmuSubsystem]> {
    return this.subsystems.entries();
  }

  entriesME(): IterableIterator<[string, ModelExchangeSubsystem]> {
    return this.meSubsystems.entries();
  }

  initializeAll(startTime: number, stopTime: number, stepSize: number): void {
    for (const sub of this.subsystems.values()) {
      sub.initialize(startTime, stopTime, stepSize);
    }
    for (const me of this.meSubsystems.values()) {
      me.initialize(startTime, stopTime);
    }
  }

  terminateAll(): void {
    for (const sub of this.subsystems.values()) {
      sub.terminate();
    }
    for (const me of this.meSubsystems.values()) {
      me.terminate();
    }
  }
}

/**
 * Metadata describing an instantiated FMU black-box component inside a flattened DAE.
 */
export interface FmuInstanceMetadata {
  /** Instance name/prefix in the model, e.g. "fmu1" or "" for root wrapper. */
  instanceName: string;
  /** Path to the FMU archive or black-box binary (.fmu, .dll, .so). */
  fmuPath: string;
  /** FMI specification version (e.g. "2.0", "3.0"). */
  fmiVersion?: string | undefined;
  /** GUID / Model UID. */
  guid?: string | undefined;
  /** Preferred kind: "cs" (Co-Simulation) or "me" (Model Exchange). */
  preferredKind?: "cs" | "me" | "auto" | undefined;
  /** Co-Simulation model identifier. */
  csModelIdentifier?: string | undefined;
  /** Model Exchange model identifier. */
  meModelIdentifier?: string | undefined;
  /** Terminal port to FMU variable mappings. */
  terminalMapping?: { portMember: string; fmuVar: string; terminalName?: string }[] | undefined;
  /** Local names of inputs (e.g. ["u"]). */
  inputs: string[];
  /** Local names of outputs (e.g. ["y"]). */
  outputs: string[];
  /** Local names of parameters (e.g. ["gain"]). */
  parameters: string[];
}

/**
 * Default in-memory FMU subsystem that provides zero-order hold / state retention.
 * Used as a fallback when an external FMU native binary or participant is not supplied.
 */
export class DefaultFmuSubsystem implements FmuSubsystem {
  readonly modelName: string;
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[];

  private currentInputs = new Map<string, number>();
  private currentOutputs = new Map<string, number>();
  private parameters = new Map<string, number>();

  constructor(modelName: string, inputNames: string[], outputNames: string[], parameterNames: string[] = []) {
    this.modelName = modelName;
    this.inputNames = inputNames;
    this.outputNames = outputNames;
    this.parameterNames = parameterNames;
  }

  initialize(_startTime: number, _stopTime: number, _stepSize: number): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
    for (const name of this.inputNames) this.currentInputs.set(name, 0);
    for (const name of this.outputNames) this.currentOutputs.set(name, 0);
  }

  setInputs(inputs: Map<string, number>): void {
    for (const [k, v] of inputs) {
      this.currentInputs.set(k, v);
    }
  }

  doStep(_currentTime: number, _stepSize: number): void {
    // Default passthrough / holding behavior
  }

  getOutputs(): Map<string, number> {
    return new Map(this.currentOutputs);
  }

  setOutput(name: string, value: number): void {
    this.currentOutputs.set(name, value);
  }

  setParameter(name: string, value: number): void {
    this.parameters.set(name, value);
  }

  getParameter(name: string): number | undefined {
    return this.parameters.get(name);
  }

  terminate(): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
  }
}
