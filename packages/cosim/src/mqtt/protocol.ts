// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MQTT message schemas for the co-simulation protocol.
 *
 * All messages are JSON-encoded. This module defines TypeScript interfaces
 * for every message type and provides serialization/deserialization helpers.
 */

// ── Participant metadata (birth certificate) ──

/** Variable descriptor in participant metadata, Modelica-compatible. */
export interface ParticipantVariable {
  /** Variable name (Modelica dot-qualified). */
  name: string;
  /** FMI-style causality. */
  causality: "input" | "output" | "parameter" | "local";
  /** Data type. */
  type: "Real" | "Integer" | "Boolean" | "String";
  /** SI unit string (optional). */
  unit?: string | undefined;
  /** Start/default value. */
  start?: number | undefined;
  /** Human-readable description. */
  description?: string | undefined;
}

/** Participant metadata — published as a retained MQTT message (birth certificate). */
export interface ParticipantMetadata {
  /** Unique participant identifier. */
  participantId: string;
  /** Modelica model name. */
  modelName: string;
  /** Participant type. */
  type: "js-simulator" | "fmu-js" | "fmu-native" | "external";
  /** Modelica class kind (model, block, connector, etc.). */
  classKind: string;
  /** Human-readable description. */
  description?: string | undefined;
  /** Variable descriptors (inputs, outputs, parameters). */
  variables: ParticipantVariable[];
  /** Default experiment parameters. */
  experiment?:
    | {
        startTime: number;
        stopTime: number;
        stepSize: number;
      }
    | undefined;
  /** SVG icon string for UI rendering. */
  iconSvg?: string | undefined;
  /** ISO 8601 timestamp of publication. */
  timestamp: string;
}

// ── Control messages (orchestrator → participants) ──

/** Initialize command. */
export interface InitCommand {
  cmd: "init";
  startTime: number;
  stopTime: number;
  stepSize: number;
}

/** Step command. */
export interface DoStepCommand {
  cmd: "doStep";
  /** Current communication time. */
  time: number;
  /** Step size. */
  stepSize: number;
}

/** Set input values before a step. */
export interface SetInputsCommand {
  cmd: "setInputs";
  /** Participant ID. */
  participantId: string;
  /** Variable name → value map. */
  values: Record<string, number | string | boolean>;
}

/** Terminate command. */
export interface TerminateCommand {
  cmd: "terminate";
}

/** Pause command. */
export interface PauseCommand {
  cmd: "pause";
}

/** Resume command. */
export interface ResumeCommand {
  cmd: "resume";
}

/** Union of all control messages. */
export type ControlMessage =
  | InitCommand
  | DoStepCommand
  | SetInputsCommand
  | TerminateCommand
  | PauseCommand
  | ResumeCommand;

// ── Status messages (participants → orchestrator) ──

/** Participant status report. */
export interface StatusMessage {
  /** Participant ID. */
  participantId: string;
  /** Current state. */
  state: "ready" | "stepped" | "error" | "terminated";
  /** Current simulation time (after step). */
  time?: number | undefined;
  /** Error message (when state is 'error'). */
  error?: string | undefined;
  /** Output variable values (after step). */
  outputs?: Record<string, number | string | boolean> | undefined;
}

// ── Result messages ──

/** Aggregated step result for dashboards/WebSocket. */
export interface StepResult {
  /** Simulation time. */
  time: number;
  /** Participant ID → variable values map. */
  participants: Record<string, Record<string, number | string | boolean>>;
}

// ── Batched variable data ──

/** Batched variable update (published to _batch topic). */
export interface VariableBatch {
  /** Simulation time. */
  time: number;
  /** Variable name → value map. */
  values: Record<string, number | string | boolean>;
}

// ── Serialization helpers ──

/** Encode a message to a Buffer for MQTT publishing. */
export function encodeMessage(msg: unknown): Buffer {
  return Buffer.from(JSON.stringify(msg));
}

/** Decode a Buffer from MQTT into a typed message. */
export function decodeMessage<T>(payload: Buffer): T {
  return JSON.parse(payload.toString("utf-8")) as T;
}
