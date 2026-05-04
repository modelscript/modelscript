// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FmiModelDescription, FmiScalarVariable } from "../fmu/model-description.js";
import type { FmuStorage, StoredFmu } from "../fmu/storage.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

export interface FmuWasmWorkerProxyOptions {
  id: string;
  fmuId: string;
  storage: FmuStorage;
  /** A Web Worker instance running `fmu-wasm.worker.ts` */
  worker: Worker;
  iconSvg?: string | undefined;
}

/**
 * Proxy CoSimParticipant that delegates FMU WASM compilation and simulation
 * to a dedicated Web Worker to prevent UI thread freezing.
 */
export class FmuWasmWorkerProxy implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;

  private readonly storedFmu: StoredFmu;
  private readonly modelDesc: FmiModelDescription;
  private readonly storage: FmuStorage;
  private readonly worker: Worker;

  private values = new Map<string, number>();
  private inputOverrides = new Map<string, number>();
  private messageIdCounter = 0;

  constructor(options: FmuWasmWorkerProxyOptions) {
    this.id = options.id;
    this.storage = options.storage;
    this.worker = options.worker;

    const stored = this.storage.get(options.fmuId);
    if (!stored) throw new Error(`FMU '${options.fmuId}' not found`);
    this.storedFmu = stored;
    this.modelDesc = stored.modelDescription;
    this.modelName = this.modelDesc.modelName;

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
      type: "fmu-wasm",
      classKind: "model",
      description: this.modelDesc.description,
      variables,
      iconSvg: options.iconSvg,
      timestamp: new Date().toISOString(),
    };
  }

  private rpc<T = unknown>(type: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageIdCounter;
      const handler = (event: MessageEvent) => {
        if (event.data.id === id) {
          this.worker.removeEventListener("message", handler);
          if (event.data.type === "ERROR") reject(new Error(event.data.error));
          else resolve(event.data.payload);
        }
      };
      this.worker.addEventListener("message", handler);
      this.worker.postMessage({ id, type, payload });
    });
  }

  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    void stopTime;
    void stepSize;
    const asSource = this.storage.getExtractedFile(this.storedFmu.id, "resources/model.ts");
    if (!asSource) throw new Error("resources/model.ts missing in FMU");

    // Initialize values based on defaults
    for (const v of this.modelDesc.variables) {
      if (v.start !== undefined && typeof v.start === "number") {
        this.values.set(v.name, v.start);
      } else {
        this.values.set(v.name, 0);
      }
    }

    const variables = this.modelDesc.variables.map((v) => ({
      name: v.name,
      valueReference: v.valueReference,
      start: typeof v.start === "number" ? v.start : 0,
    }));

    await this.rpc("INIT", { asSourceStr: asSource, variables });
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    if (this.inputOverrides.size > 0) {
      await this.rpc("SET_INPUTS", Array.from(this.inputOverrides.entries()));
      this.inputOverrides.clear();
    }

    const outputs = await this.rpc<[string, number][]>("DO_STEP", { time: currentTime, stepSize });
    for (const [name, val] of outputs) {
      this.values.set(name, val);
    }
  }

  async getOutputs(): Promise<Map<string, number>> {
    const outputs = new Map<string, number>();
    for (const v of this.modelDesc.variables) {
      if (v.causality === "output") {
        const val = this.values.get(v.name);
        if (val !== undefined) outputs.set(v.name, val);
      }
    }
    return outputs;
  }

  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, val] of values) {
      this.inputOverrides.set(name, val);
      this.values.set(name, val);
    }
  }

  async terminate(): Promise<void> {
    await this.rpc("TERMINATE");
    this.values.clear();
    this.inputOverrides.clear();
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

    // Push restored state to worker
    await this.rpc("SET_INPUTS", Array.from(this.values.entries()));
  }

  async freeState(state: unknown): Promise<void> {
    // No-op for Map-based state
    void state;
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
