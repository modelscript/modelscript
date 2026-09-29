// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * LSP-based co-simulation participant for browser-local mode.
 *
 * Implements the CoSimParticipant interface by delegating simulation
 * to the LSP server via `modelscript/simulateInit`, `modelscript/simulateStep`,
 * and `modelscript/simulateTerminate` requests.
 */

import type { LanguageClient } from "vscode-languageclient/browser";

/** Variable metadata returned by simulateInit. */
export interface LspVariable {
  name: string;
  causality: string;
}

/**
 * CoSimParticipant implementation that delegates to the LSP for simulation.
 * Does not import from @modelscript/cosim to avoid pulling Node.js dependencies
 * into the browser bundle — instead it implements the same interface shape.
 */
export class LspSimulatorParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly uri: string;
  readonly className?: string;

  private readonly client: LanguageClient;
  private variables: LspVariable[] = [];
  private currentOutputs = new Map<string, number>();
  private pendingInputs = new Map<string, number>();
  private _allValues: Record<string, number> = {};

  constructor(client: LanguageClient, id: string, modelName: string, uri: string, className?: string) {
    this.client = client;
    this.id = id;
    this.modelName = modelName;
    this.uri = uri;
    this.className = className;
  }

  /** Get variable metadata (available after initialize). */
  getVariables(): LspVariable[] {
    return this.variables;
  }

  /** Get all variable values from the last step (including local/state variables). */
  get allValues(): Record<string, number> {
    return this._allValues;
  }

  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    const result = await this.client.sendRequest<{
      ok: boolean;
      variables?: LspVariable[];
      error?: string;
    }>("modelscript/simulateInit", {
      uri: this.uri,
      participantId: this.id,
      className: this.className,
      startTime,
      stopTime,
      stepSize,
    });

    if (!result.ok) {
      throw new Error(result.error ?? "simulateInit failed");
    }

    this.variables = result.variables ?? [];
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Convert pending inputs to a plain object for JSON serialization
    const inputs: Record<string, number> = {};
    for (const [name, value] of this.pendingInputs) {
      inputs[name] = value;
    }

    const result = await this.client.sendRequest<{
      ok: boolean;
      outputs?: Record<string, number>;
      allValues?: Record<string, number>;
      error?: string;
    }>("modelscript/simulateStep", {
      participantId: this.id,
      currentTime,
      stepSize,
      inputs: this.pendingInputs.size > 0 ? inputs : undefined,
    });

    if (!result.ok) {
      throw new Error(result.error ?? "simulateStep failed");
    }

    // Update cached outputs
    this.currentOutputs.clear();
    if (result.outputs) {
      for (const [name, value] of Object.entries(result.outputs)) {
        this.currentOutputs.set(name, value);
      }
    }

    // Store all values for live plotting
    this._allValues = result.allValues ?? {};

    // Clear pending inputs after step
    this.pendingInputs.clear();
  }

  async getOutputs(): Promise<Map<string, number>> {
    return new Map(this.currentOutputs);
  }

  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, value] of values) {
      this.pendingInputs.set(name, value);
    }
  }

  async terminate(): Promise<void> {
    try {
      await this.client.sendRequest("modelscript/simulateTerminate", {
        participantId: this.id,
      });
    } catch {
      // Best-effort cleanup
    }
    this.currentOutputs.clear();
    this.pendingInputs.clear();
    this.variables = [];
  }
}
