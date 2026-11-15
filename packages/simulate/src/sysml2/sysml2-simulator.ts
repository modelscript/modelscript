// SPDX-License-Identifier: AGPL-3.0-or-later

import { type DAEBuilder } from "@modelscript/runtime";
import {
  simulateArena,
  simulateArenaAsync,
  type ArenaSimulateOptions,
  type ArenaSimulationResult,
} from "../core/simulate-arena.js";

/**
 * Simulates a pre-lowered SysML v2 DAEBuilder arena.
 *
 * @param arena Pre-lowered DAEBuilder arena
 * @param options Simulation options
 * @returns Simulation results
 */
export function simulateSysml2Arena(arena: DAEBuilder, options: ArenaSimulateOptions = {}): ArenaSimulationResult {
  return simulateArena(arena, options);
}

/**
 * Asynchronously simulates a pre-lowered SysML v2 DAEBuilder arena.
 *
 * @param arena Pre-lowered DAEBuilder arena
 * @param options Simulation options
 * @returns Simulation results
 */
export async function simulateSysml2ArenaAsync(
  arena: DAEBuilder,
  options: ArenaSimulateOptions = {},
): Promise<ArenaSimulationResult> {
  return simulateArenaAsync(arena, options);
}
