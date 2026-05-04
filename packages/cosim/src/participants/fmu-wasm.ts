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
import type { FmiModelDescription, FmiScalarVariable } from "../fmu/model-description.js";
import type { FmuStorage, StoredFmu } from "../fmu/storage.js";
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

  private readonly storage: FmuStorage;

  // WASM runtime state
  private wasmInstance?: WebAssembly.Instance;
  private wasmVarsArray?: Float64Array;

  private wasmExports?: {
    initModel: () => void;
    doStep: (time: number, dt: number) => void;
    getVar: (vr: number) => number;
    setVar: (vr: number, value: number) => void;
  };

  // Variable references mapping
  private varRefs = new Map<string, number>();

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

  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    this.currentTime = startTime;
    void stopTime;
    void stepSize;

    // Read AssemblyScript source from FMU archive
    const asSource = this.storage.getExtractedFile(this.storedFmu.id, "resources/model.ts");
    if (!asSource) {
      throw new Error(
        `FMU '${this.storedFmu.id}' does not contain resources/model.ts. Was it exported with WASM support?`,
      );
    }

    const asSourceStr = asSource;

    // Compile to WebAssembly
    const { error, binary } = await asc.compileString(asSourceStr, {
      optimizeLevel: 3,
      shrinkLevel: 0,
      runtime: "stub",
    });

    if (error || !binary) {
      throw new Error(`Failed to compile FMU AssemblyScript to WASM:\n${error?.message}`);
    }

    // Instantiate WebAssembly module
    // We provide a basic env with abort for AssemblyScript stubs
    const env = {
      abort: (msg: number, file: number, line: number, column: number) => {
        console.error(`WASM abort at ${line}:${column}`);
      },
    };

    const wasmModule = await WebAssembly.instantiate(binary, { env });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.wasmInstance = wasmModule as any;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.wasmExports = this.wasmInstance!.exports as unknown as {
      initModel: () => void;
      doStep: (time: number, dt: number) => void;
      getVar: (vr: number) => number;
      setVar: (vr: number, value: number) => void;
    };

    if (!this.wasmExports || !this.wasmExports.initModel || !this.wasmExports.doStep || !this.wasmExports.getVar) {
      throw new Error("WASM module did not export expected functions (initModel, doStep, getVar, setVar)");
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.wasmInstance = undefined as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.wasmExports = undefined as any;
    this.initialized = false;
  }

  // ── FMU State save/restore ──

  readonly canGetAndSetState = true;

  async getState(): Promise<unknown> {
    // Clone the current values map
    return new Map(this.values);
  }

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

  async freeState(state: unknown): Promise<void> {
    // No-op for Map-based state
    void state;
  }

  getModelDescription(): FmiModelDescription {
    return this.modelDesc;
  }

  getAllValues(): ReadonlyMap<string, number> {
    return this.values;
  }
}

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
