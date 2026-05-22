// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Simulation Runner.
 *
 * Loads a compiled WASM model module (produced by fmu-wasm-codegen +
 * fmu-wasm-compile) and drives a simulation loop entirely within WASM,
 * reading results back into JavaScript arrays.
 *
 * Works in both browser and Node.js environments.
 */

/** Minimal scalar variable descriptor (matches FmiScalarVariable). */
export interface WasmScalarVariable {
  name: string;
  valueReference: number;
  causality?: string;
}

// ── Emscripten module interface ──

interface WasmModelModule {
  _wasm_init(): void;
  _wasm_get_derivatives(): void;
  _wasm_get_event_indicators(): void;
  _wasm_do_step(t: number, dt: number): void;
  _wasm_get_n_states(): number;
  _wasm_get_n_vars(): number;
  _wasm_get_n_event_indicators(): number;
  _wasm_get_vars_ptr(): number;
  _wasm_get_states_ptr(): number;
  _wasm_get_derivatives_ptr(): number;
  _wasm_get_time(): number;
  _wasm_set_var(vr: number, value: number): void;
  _wasm_get_var(vr: number): number;
  HEAPF64: Float64Array;
}

// ── Public interface ──

/** Options for WASM simulation. */
export interface WasmSimulationOptions {
  /** Simulation start time (default: 0). */
  startTime?: number;
  /** Simulation stop time (default: 1). */
  stopTime?: number;
  /** Integration step size (default: 0.001). */
  stepSize?: number;
  /** Output interval — record every N steps (default: 1). */
  outputInterval?: number;
  /** Parameter overrides: valueReference → value */
  parameters?: Map<number, number>;
}

/** Result of a WASM simulation run. */
export interface WasmSimulationResult {
  /** Time points at which results were recorded. */
  times: number[];
  /** Variable names (from FmiScalarVariable descriptors). */
  variableNames: string[];
  /** Result matrix: variableNames.length arrays, each of times.length values. */
  trajectories: number[][];
  /** Wall-clock time for the simulation in milliseconds. */
  wallClockMs: number;
  /** Total number of RK4 steps taken. */
  totalSteps: number;
  /** Error message (empty on success). */
  error: string;
}

/**
 * Run a simulation using a compiled WASM model module.
 *
 * @param wasmBytes          The .wasm binary bytes
 * @param jsGlueCode         The Emscripten JS glue code string
 * @param scalarVariables    FMI scalar variable descriptors (for naming)
 * @param options            Simulation options
 * @returns Simulation result with time series data
 */
export async function runWasmSimulation(
  wasmBytes: ArrayBuffer,
  jsGlueCode: string,
  scalarVariables: WasmScalarVariable[],
  options?: WasmSimulationOptions,
): Promise<WasmSimulationResult> {
  const startTime = options?.startTime ?? 0;
  const stopTime = options?.stopTime ?? 1;
  const stepSize = options?.stepSize ?? 0.001;
  const outputInterval = options?.outputInterval ?? 1;

  try {
    // Load the Emscripten module
    const module = await loadWasmModule(wasmBytes, jsGlueCode);

    // Initialize the model
    module._wasm_init();

    // Set parameter overrides
    if (options?.parameters) {
      for (const [vr, value] of options.parameters) {
        module._wasm_set_var(vr, value);
      }
    }

    // Determine which variables to track (skip time/independent)
    const trackedVars = scalarVariables.filter((sv) => sv.causality !== "independent");
    const variableNames = trackedVars.map((sv) => sv.name);

    // Pre-allocate result arrays
    const times: number[] = [];
    const trajectories: number[][] = trackedVars.map(() => []);

    times.length = 0;
    for (const t of trajectories) t.length = 0;

    // Run simulation loop
    const wallStart = performance.now();
    let t = startTime;
    let stepCount = 0;

    // Record initial state
    times.push(t);
    for (let j = 0; j < trackedVars.length; j++) {
      const vr = trackedVars[j]?.valueReference;
      if (vr !== undefined) trajectories[j]?.push(module._wasm_get_var(vr));
    }

    while (t < stopTime - 1e-15) {
      const dt = Math.min(stepSize, stopTime - t);
      module._wasm_do_step(t, dt);
      t += dt;
      stepCount++;

      // Record output at intervals
      if (stepCount % outputInterval === 0 || t >= stopTime - 1e-15) {
        times.push(t);
        for (let j = 0; j < trackedVars.length; j++) {
          const vr = trackedVars[j]?.valueReference;
          if (vr !== undefined) trajectories[j]?.push(module._wasm_get_var(vr));
        }
      }
    }

    const wallClockMs = performance.now() - wallStart;

    return {
      times,
      variableNames,
      trajectories,
      wallClockMs,
      totalSteps: stepCount,
      error: "",
    };
  } catch (e) {
    return {
      times: [],
      variableNames: [],
      trajectories: [],
      wallClockMs: 0,
      totalSteps: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Module loader ──

async function loadWasmModule(wasmBytes: ArrayBuffer, jsGlueCode: string): Promise<WasmModelModule> {
  // Create the factory function from the JS glue code
  // The Emscripten-generated JS glue defines a module factory function
  const factoryFn = new Function(
    "Module",
    jsGlueCode + "\nreturn typeof createWasmModel !== 'undefined' ? createWasmModel : Module;",
  );

  const wasmBinary = new Uint8Array(wasmBytes);

  return new Promise<WasmModelModule>((resolve, reject) => {
    try {
      const moduleConfig = {
        wasmBinary,
        onRuntimeInitialized: function (this: WasmModelModule) {
          resolve(this);
        },
      };

      const factory = factoryFn(moduleConfig);

      // Handle both callback and promise patterns
      if (factory && typeof factory.then === "function") {
        factory.then((mod: WasmModelModule) => resolve(mod)).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}
