// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cosim — MQTT-linked co-simulation engine.
 *
 * Public API exports for the co-simulation package.
 */

// ── MQTT layer ──
export * from "./mqtt/client.js";
export * from "./mqtt/protocol.js";
export * from "./mqtt/topics.js";

// ── Core ──
export * from "./coupling.js";
export * from "./orchestrator.js";
export * from "./participant.js";
export * from "./realtime.js";
export * from "./session.js";

// ── Participants ──
export * from "./participants/fmu-js.js";
export * from "./participants/fmu-native.js";
export * from "./participants/fmu-wasm-worker-proxy.js";
export * from "./participants/fmu-wasm.js";
export * from "./participants/js-simulator.js";

// ── Historian ──
export * from "./historian/recorder.js";
export * from "./historian/replayer.js";

// ── FMU ──
export * from "./fmu/model-description.js";
export * from "./fmu/storage.js";

// ── WebSocket ──
export * from "./ws/stream.js";

// ── SSP ──
export * from "./ssp/export.js";
export * from "./ssp/import.js";
export * from "./ssp/ssd-parser.js";
export * from "./ssp/types.js";
