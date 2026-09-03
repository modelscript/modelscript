// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange
 * Model Exchange and Co-Simulation Standards Engine:
 * - FMI 2.0 and FMI 3.0 export, code generation, wrapper generation, and archiving
 * - System Structure and Parameterization (SSP 1.0) packaging and SSD graph parsing
 * - Distributed and local MQTT/WebSocket co-simulation orchestrator and participants
 */

export * as cosim from "./cosim/index.js";
export * as fmu from "./fmu/index.js";
export * as ssp from "./ssp/index.js";

export * from "./cosim/index.js";
export * from "./fmu/index.js";
export * from "./ssp/index.js";
