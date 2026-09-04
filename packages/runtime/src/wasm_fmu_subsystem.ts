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
  inputScaling?: { mean: number; std: number }[];
  outputScaling?: { mean: number; std: number }[];
  weights?: any;
  evaluate?: (input: number[]) => number[];
  [key: string]: any;
}

export function evaluateROM(rom: TrainedROM, rawInput: number[]): number[] {
  if (typeof rom.evaluate === "function") {
    return rom.evaluate(rawInput);
  }
  const inputScaling = rom.inputScaling ?? [];
  const outputScaling = rom.outputScaling ?? [];
  const normInput = rawInput.map((v, i) => {
    const s = inputScaling[i];
    return s && s.std !== 0 ? (v - s.mean) / s.std : v;
  });
  let normOutput: number[] = [];
  const w = rom.weights;
  if (w && w.type === "neural_net" && Array.isArray(w.layers)) {
    let act = normInput;
    for (const layer of w.layers) {
      const next: number[] = [];
      for (let j = 0; j < layer.biases.length; j++) {
        let sum = layer.biases[j];
        for (let k = 0; k < act.length; k++) {
          sum += layer.weights[j][k] * act[k];
        }
        next.push(layer.activation === "relu" ? Math.max(0, sum) : Math.tanh(sum));
      }
      act = next;
    }
    normOutput = act;
  } else if (w && Array.isArray(w.coefficients)) {
    normOutput = w.coefficients.map((row: number[]) => {
      let sum = 0;
      for (let j = 0; j < normInput.length && j < row.length; j++) {
        sum += row[j] * normInput[j];
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
 * Registry of FMU subsystems available to the simulator.
 */
export class FmuSubsystemRegistry {
  private subsystems = new Map<string, FmuSubsystem>();

  register(instanceName: string, subsystem: FmuSubsystem): void {
    this.subsystems.set(instanceName, subsystem);
  }

  get(instanceName: string): FmuSubsystem | undefined {
    return this.subsystems.get(instanceName);
  }

  has(instanceName: string): boolean {
    return this.subsystems.has(instanceName);
  }

  entries(): IterableIterator<[string, FmuSubsystem]> {
    return this.subsystems.entries();
  }

  initializeAll(startTime: number, stopTime: number, stepSize: number): void {
    for (const sub of this.subsystems.values()) {
      sub.initialize(startTime, stopTime, stepSize);
    }
  }

  terminateAll(): void {
    for (const sub of this.subsystems.values()) {
      sub.terminate();
    }
  }
}
