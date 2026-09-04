// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerArenaSimulator } from "@modelscript/runtime/wasm_monte_carlo.js";
import { simulateArena, simulateArenaAsync } from "../compiler/simulator/core/simulate-arena.js";

registerArenaSimulator(simulateArena, simulateArenaAsync);
export * from "@modelscript/runtime/wasm_monte_carlo.js";
