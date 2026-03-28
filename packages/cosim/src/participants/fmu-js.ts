// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU-JS co-simulation participant.
 *
 * Loads the `model.json` serialized DAE from inside an FMU archive
 * and runs it via the JS simulator. No native code required.
 *
 * This is a placeholder for Phase 4 implementation.
 */

import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * Placeholder for FMU-JS participant.
 * Will be fully implemented in Phase 4.
 */
export class FmuJsParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;

  constructor(id: string, modelName: string) {
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      participantId: id,
      modelName,
      type: "fmu-js",
      classKind: "model",
      variables: [],
      timestamp: new Date().toISOString(),
    };
  }

  async initialize(): Promise<void> {
    throw new Error("FMU-JS participant not yet implemented (Phase 4)");
  }

  async doStep(): Promise<void> {
    throw new Error("FMU-JS participant not yet implemented (Phase 4)");
  }

  async getOutputs(): Promise<Map<string, number>> {
    return new Map();
  }

  async setInputs(): Promise<void> {
    // no-op placeholder
  }

  async terminate(): Promise<void> {
    // no-op placeholder
  }
}
