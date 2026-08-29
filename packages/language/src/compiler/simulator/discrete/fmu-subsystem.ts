// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU subsystem adapter for the ModelicaSimulator.
 *
 * When a DAE contains variables marked as originating from an FMU
 * (via the `__fmu__` naming convention), the simulator can delegate
 * their evaluation to an FMU co-simulation participant instead of
 * solving them algebraically.
 *
 * This bridges the gap between the `ModelicaSimulator` (which
 * operates on a flat DAE) and the `CoSimParticipant` interface
 * (which provides `initialize`, `setInputs`, `doStep`, `getOutputs`).
 */

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
 *
 * This avoids needing a full WASM FMU runtime for demonstration
 * and lightweight scenarios.
 */
export class LookupTableFmuSubsystem implements FmuSubsystem {
  readonly modelName: string;
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[];

  /** Lookup data: time → input values → output values */
  private data = new Map<number, Map<string, number>>();
  /** Current output values */
  private currentOutputs = new Map<string, number>();
  /** Transfer function coefficients: outputName → { inputName → gain } */
  private gains: Map<string, Map<string, number>>;
  /** Steady-state offsets for outputs */
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
    // Compute outputs as linear combination: y_j = offset_j + Σ gain_{j,i} * u_i
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
    // For a static lookup table / linear ROM, doStep is a no-op
    // (outputs were already computed in setInputs)
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
 * Registry of FMU subsystems available to the simulator.
 *
 * Models reference FMU blocks via a naming convention
 * (e.g., `cfdRom.heatFlux` where `cfdRom` is the FMU instance name).
 * The registry maps instance names to FmuSubsystem implementations.
 */
export class FmuSubsystemRegistry {
  private subsystems = new Map<string, FmuSubsystem>();

  /** Register an FMU subsystem under a given instance name. */
  register(instanceName: string, subsystem: FmuSubsystem): void {
    this.subsystems.set(instanceName, subsystem);
  }

  /** Get a registered FMU subsystem by instance name. */
  get(instanceName: string): FmuSubsystem | undefined {
    return this.subsystems.get(instanceName);
  }

  /** Check if an FMU subsystem is registered. */
  has(instanceName: string): boolean {
    return this.subsystems.has(instanceName);
  }

  /** Get all registered subsystems. */
  entries(): IterableIterator<[string, FmuSubsystem]> {
    return this.subsystems.entries();
  }

  /** Initialize all registered FMU subsystems. */
  initializeAll(startTime: number, stopTime: number, stepSize: number): void {
    for (const sub of this.subsystems.values()) {
      sub.initialize(startTime, stopTime, stepSize);
    }
  }

  /** Terminate all registered FMU subsystems. */
  terminateAll(): void {
    for (const sub of this.subsystems.values()) {
      sub.terminate();
    }
  }
}
