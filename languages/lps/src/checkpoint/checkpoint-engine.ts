// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Hot-Start State Checkpointing Engine (.sav / .rst).
 *
 * Implements state snapshot serialization, integrity checksums, and instantaneous
 * hot-start resumption for long-running pipeline transient simulations.
 */

import crypto from "node:crypto";
import type { BatchPosition, LpsModel, NodeState, PipeState } from "../types.js";

export interface LpsCheckpoint {
  format: "MODELSCRIPT_LPS_SAV";
  version: "1.0.0";
  timestamp: string;
  simulationTime: number; // Simulation clock time in seconds
  modelId: string;
  modelType: "TGNET" | "TLNET" | "HYBRID";
  nodeStates: Record<string, { pressure: number; temperature: number; netFlow: number }>;
  pipeStates: Record<
    string,
    {
      massFlow: number;
      inletPressure: number;
      outletPressure: number;
      inventoryKg: number;
      velocity: number;
      soilTempsK?: number[] | undefined;
      voidFraction?: number | undefined;
    }
  >;
  controllerStates?: Record<string, unknown> | undefined;
  batchStates?: BatchPosition[] | undefined;
  checksumSha256: string;
}

export class CheckpointEngine {
  private static computeHash(data: Omit<LpsCheckpoint, "checksumSha256">): string {
    const json = JSON.stringify(data);
    return crypto.createHash("sha256").update(json).digest("hex");
  }

  /**
   * Captures a complete simulation state snapshot.
   */
  static createSnapshot(
    model: LpsModel,
    simulationTime: number,
    nodeStates: Record<string, NodeState>,
    pipeStates: Record<string, PipeState>,
    options?:
      | {
          controllerStates?: Record<string, unknown> | undefined;
          batchStates?: BatchPosition[] | undefined;
          soilProfiles?: Record<string, number[]> | undefined;
          voidFractions?: Record<string, number> | undefined;
        }
      | undefined,
  ): LpsCheckpoint {
    const rawPipeStates: LpsCheckpoint["pipeStates"] = {};
    for (const [name, state] of Object.entries(pipeStates)) {
      rawPipeStates[name] = {
        massFlow: state.massFlow,
        inletPressure: state.inletPressure,
        outletPressure: state.outletPressure,
        inventoryKg: state.linePackKg,
        velocity: state.velocity,
        soilTempsK: options?.soilProfiles?.[name],
        voidFraction: options?.voidFractions?.[name],
      };
    }

    const rawNodeStates: LpsCheckpoint["nodeStates"] = {};
    for (const [name, state] of Object.entries(nodeStates)) {
      rawNodeStates[name] = {
        pressure: state.pressure,
        temperature: state.temperature,
        netFlow: state.netFlow,
      };
    }

    const baseData: Omit<LpsCheckpoint, "checksumSha256"> = {
      format: "MODELSCRIPT_LPS_SAV",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      simulationTime,
      modelId: model.id,
      modelType: model.type,
      nodeStates: rawNodeStates,
      pipeStates: rawPipeStates,
      controllerStates: options?.controllerStates,
      batchStates: options?.batchStates,
    };

    const checksumSha256 = this.computeHash(baseData);

    return {
      ...baseData,
      checksumSha256,
    };
  }

  /**
   * Serializes checkpoint to JSON string (.sav format).
   */
  static serialize(checkpoint: LpsCheckpoint, pretty = true): string {
    return pretty ? JSON.stringify(checkpoint, null, 2) : JSON.stringify(checkpoint);
  }

  /**
   * Parses and validates a checkpoint string.
   */
  static deserialize(content: string): LpsCheckpoint {
    const parsed = JSON.parse(content) as LpsCheckpoint;
    if (parsed.format !== "MODELSCRIPT_LPS_SAV") {
      throw new Error(`Invalid LPS checkpoint format: ${parsed.format}`);
    }
    if (!this.verifyChecksum(parsed)) {
      throw new Error("LPS checkpoint integrity verification failed: SHA-256 checksum mismatch.");
    }
    return parsed;
  }

  /**
   * Verifies SHA-256 integrity hash of checkpoint.
   */
  static verifyChecksum(checkpoint: LpsCheckpoint): boolean {
    const { checksumSha256, ...baseData } = checkpoint;
    const computed = this.computeHash(baseData);
    return computed === checksumSha256;
  }

  /**
   * Restores initial conditions from snapshot for continuing transient simulation.
   */
  static applySnapshot(
    model: LpsModel,
    checkpoint: LpsCheckpoint,
  ): {
    initialP: Map<string, number>;
    initialW: Map<string, number>;
    simulationStartTime: number;
  } {
    if (checkpoint.modelId !== model.id) {
      console.warn(
        `[CheckpointEngine] Warning: Checkpoint modelId '${checkpoint.modelId}' differs from model '${model.id}'.`,
      );
    }

    const initialP = new Map<string, number>();
    const initialW = new Map<string, number>();

    for (const node of model.nodes) {
      const snap = checkpoint.nodeStates[node.name];
      if (snap) {
        initialP.set(node.name, snap.pressure);
      }
    }

    for (const pipe of model.pipes) {
      const snap = checkpoint.pipeStates[pipe.name];
      if (snap) {
        initialW.set(pipe.name, snap.massFlow);
      }
    }

    return {
      initialP,
      initialW,
      simulationStartTime: checkpoint.simulationTime,
    };
  }
}
