// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference lib="dom" />

/**
 * FMU-WASM co-simulation participant.
 *
 * Loads the modelDescription.xml metadata from an uploaded FMU archive
 * (via FmuStorage) and compiles the embedded AssemblyScript `model.ts`
 * into a WebAssembly module using `@assemblyscript/compiler`.
 *
 * This provides high-performance simulation directly in the browser or
 * Node.js without relying on an external C compiler.
 */

import asc from "assemblyscript/dist/asc.js";
import type { FmiModelDescription, FmiScalarVariable } from "../../fmu/model-description.js";
import type { FmuStorage, StoredFmu } from "../../fmu/storage.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/** Options for creating an FMU-WASM participant. */
export interface FmuWasmParticipantOptions {
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
 * Co-simulation participant backed by an AssemblyScript-generated WebAssembly module.
 */
export class FmuWasmParticipant implements CoSimParticipant {
  /** Unique co-simulation participant identifier. */
  readonly id: string;
  /** FMI model name extracted from `modelDescription.xml`. */
  readonly modelName: string;
  /** Participant variable and port metadata advertised to the orchestrator. */
  readonly metadata: ParticipantMetadata;

  /** Stored FMU archive entry in `FmuStorage`. */
  private readonly storedFmu: StoredFmu;
  /** Parsed FMI `modelDescription.xml` descriptor. */
  private readonly modelDesc: FmiModelDescription;

  /** Current variable values (keyed by variable name). */
  private values = new Map<string, number>();
  /** Pending input overrides. */
  private inputOverrides = new Map<string, number>();
  /** Current simulation time. */
  public currentTime = 0;
  /** Whether the participant has been initialized. */
  private initialized = false;

  /** Reference to the backing `FmuStorage` store. */
  private readonly storage: FmuStorage;

  /** Optional direct view into the WASM module's variable array buffer. */
  public wasmVarsArray?: Float64Array | undefined;

  /** Bound WebAssembly exports (`initModel`, `doStep`, `getVar`, `setVar`). */
  private wasmExports?:
    | {
        initModel: () => void;
        doStep: (time: number, dt: number) => void;
        getVar: (vr: number) => number;
        setVar: (vr: number, value: number) => void;
      }
    | undefined;

  /** Lookup table mapping FMI variable names to their numeric value references (`vr`). */
  private varRefs = new Map<string, number>();

  /** Creates an in-process WebAssembly FMU co-simulation participant from `FmuStorage`. */
  constructor(options: FmuWasmParticipantOptions) {
    this.id = options.id;
    this.storage = options.storage;

    const stored = options.storage.get(options.fmuId);
    if (!stored) {
      throw new Error(`FMU '${options.fmuId}' not found in storage`);
    }
    this.storedFmu = stored;
    this.modelDesc = stored.modelDescription;
    this.modelName = this.modelDesc.modelName;

    if (!this.modelDesc.supportsCoSimulation) {
      throw new Error(`FMU '${this.modelName}' does not support co-simulation`);
    }

    const variables: ParticipantVariable[] = this.modelDesc.variables
      .filter((v) => v.causality !== "local")
      .map((v: FmiScalarVariable) => {
        this.varRefs.set(v.name, v.valueReference);
        return {
          name: v.name,
          causality: mapFmiCausality(v.causality),
          type: (v.type === "Enumeration" ? "Integer" : v.type) as ParticipantVariable["type"],
          unit: v.unit,
          start: typeof v.start === "number" ? v.start : undefined,
          description: v.description,
        };
      });

    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "fmu-wasm",
      classKind: "model",
      description: this.modelDesc.description,
      variables,
      iconSvg: options.iconSvg,
      timestamp: new Date().toISOString(),
    };
  }

  /** Compiles `resources/model.ts` or loads `binaries/wasm32/<id>.wasm`, instantiates the module, and runs `initModel()`. */
  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    this.currentTime = startTime;
    void stopTime;
    void stepSize;

    const modelId =
      this.modelDesc.coSimulationModelIdentifier ?? this.modelDesc.modelExchangeModelIdentifier ?? this.modelName;
    let binary: Uint8Array | null =
      this.storage.getExtractedFileBytes(this.storedFmu.id, `binaries/wasm32/${modelId}.wasm`) ??
      this.storage.getExtractedFileBytes(this.storedFmu.id, `binaries/wasm32-unknown-unknown/${modelId}.wasm`);

    if (!binary) {
      // Read AssemblyScript source from FMU archive
      const asSource = this.storage.getExtractedFile(this.storedFmu.id, "resources/model.ts");
      if (!asSource) {
        throw new Error(
          `FMU '${this.storedFmu.id}' does not contain binaries/wasm32/${modelId}.wasm or resources/model.ts. Was it exported with WASM support?`,
        );
      }

      // Compile to WebAssembly
      const compiled = await asc.compileString(asSource, {
        optimizeLevel: 3,
        shrinkLevel: 0,
        runtime: "stub",
      });

      if (compiled.error || !compiled.binary) {
        throw new Error(`Failed to compile FMU AssemblyScript to WASM:\n${compiled.error?.message}`);
      }
      binary = compiled.binary;
    }

    // Instantiate WebAssembly module
    const env = {
      abort: (_msg: number, _file: number, line: number, column: number) => {
        console.error(`WASM abort at ${line}:${column}`);
      },
    };

    const wasmModule = await WebAssembly.instantiate(binary, { env });
    const instance = ("instance" in wasmModule ? wasmModule.instance : wasmModule) as WebAssembly.Instance;
    const rawExports = instance.exports as Record<string, unknown>;

    if (typeof rawExports["initModel"] === "function" && typeof rawExports["doStep"] === "function") {
      this.wasmExports = rawExports as unknown as {
        initModel: () => void;
        doStep: (time: number, dt: number) => void;
        getVar: (vr: number) => number;
        setVar: (vr: number, value: number) => void;
      };
    } else {
      const cInit = (rawExports["wasm_init"] ?? rawExports["_wasm_init"]) as ((t0: number) => void) | undefined;
      const cStep = (rawExports["wasm_do_step"] ?? rawExports["_wasm_do_step"]) as
        | ((t: number, dt: number) => number)
        | undefined;
      const cGet = (rawExports["wasm_get_real"] ?? rawExports["_wasm_get_real"]) as
        | ((vr: number) => number)
        | undefined;
      const cSet = (rawExports["wasm_set_real"] ?? rawExports["_wasm_set_real"]) as
        | ((vr: number, val: number) => void)
        | undefined;
      if (cInit && cStep && cGet && cSet) {
        this.wasmExports = {
          initModel: () => cInit(startTime),
          doStep: (time: number, dt: number) => {
            cStep(time, dt);
          },
          getVar: (vr: number) => cGet(vr),
          setVar: (vr: number, value: number) => cSet(vr, value),
        };
      }
    }

    if (!this.wasmExports || !this.wasmExports.initModel || !this.wasmExports.doStep || !this.wasmExports.getVar) {
      throw new Error(
        "WASM module did not export expected functions (initModel/wasm_init, doStep/wasm_do_step, getVar/wasm_get_real)",
      );
    }

    this.wasmExports.initModel();

    // Initialize values map from starting attributes
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

    this.initialized = true;
  }

  /** Pushes pending input overrides to WASM, executes `doStep(currentTime, stepSize)`, and syncs outputs. */
  async doStep(currentTime: number, stepSize: number): Promise<void> {
    if (!this.initialized || !this.wasmExports) throw new Error("FMU-WASM participant not initialized");

    // Apply inputs to WASM
    for (const [name, value] of this.inputOverrides) {
      const vr = this.varRefs.get(name);
      if (vr !== undefined) this.wasmExports.setVar(vr, value);
    }

    // Run WASM step
    this.wasmExports.doStep(currentTime, stepSize);

    // Sync all tracked values back to JS
    for (const [name, vr] of this.varRefs) {
      this.values.set(name, this.wasmExports.getVar(vr));
    }

    this.currentTime = currentTime + stepSize;
    this.inputOverrides.clear();
  }

  /** Returns a map of all `causality="output"` variable values after the current step. */
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

  /** Stages input variable overrides to be written into WASM memory at the start of the next `doStep`. */
  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, value] of values) {
      this.inputOverrides.set(name, value);
      this.values.set(name, value);
    }
  }

  /** Releases the WebAssembly instance and clears variable state maps. */
  async terminate(): Promise<void> {
    this.values.clear();
    this.inputOverrides.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.wasmExports = undefined as any;
    this.initialized = false;
  }

  // ── FMU State save/restore ──

  /** Indicates support for saving and restoring FMU state snapshots (`getState` / `setState`). */
  readonly canGetAndSetState = true;

  /** Returns a cloned snapshot of all current variable values for step rollback. */
  async getState(): Promise<unknown> {
    // Clone the current values map
    return new Map(this.values);
  }

  /** Restores variable values from a snapshot and writes them back to the WASM module via `setVar`. */
  async setState(state: unknown): Promise<void> {
    if (!(state instanceof Map)) throw new Error("Invalid state object");
    this.values = new Map(state as Map<string, number>);

    // Push restored state to WASM memory
    for (const [name, value] of this.values) {
      const vr = this.varRefs.get(name);
      if (vr !== undefined && this.wasmExports) {
        this.wasmExports.setVar(vr, value);
      }
    }
  }

  /** Releases a previously captured state snapshot (no-op for `Map`-backed snapshots). */
  async freeState(state: unknown): Promise<void> {
    // No-op for Map-based state
    void state;
  }

  /** Returns the parsed FMI `modelDescription.xml` metadata for this participant. */
  getModelDescription(): FmiModelDescription {
    return this.modelDesc;
  }

  /** Returns a read-only map of all tracked variable values (inputs, outputs, parameters, locals). */
  getAllValues(): ReadonlyMap<string, number> {
    return this.values;
  }
}

/** Normalizes an FMI causality string into the canonical co-simulation participant causality union. */
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
