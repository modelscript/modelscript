// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm, type DAEBuilder } from "@modelscript/runtime";
import { simulateArena, type ArenaSimulateOptions, type ArenaSimulationResult } from "../core/simulate-arena.js";

/**
 * Directly simulates a SysML v2 specification (constraint def, part def, or action script)
 * by lowering it directly into the linear-memory DAEBuilder arena and running the
 * continuous/discrete numerical solver.
 *
 * @param sysmlSource SysML v2 textual source code
 * @param options Simulation and numerical solver options (startTime, stopTime, step, solver, etc.)
 * @returns Simulation results including time series, state names, and state trajectories
 */
export async function simulateSysml2(
  sysmlSource: string,
  options: ArenaSimulateOptions = {},
): Promise<ArenaSimulationResult> {
  await initBltWasm();

  // Dynamically import SysML2DaeLowerer from @modelscript/sysml2 to preserve clean package boundaries
  const sysml2Module = "@modelscript/sysml2";
  const { SysML2DaeLowerer } = (await import(sysml2Module)) as any;
  const arena = await SysML2DaeLowerer.lowerSystem(sysmlSource);

  return simulateArena(arena, options);
}

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
