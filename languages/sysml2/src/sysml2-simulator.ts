// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import { simulateArenaAsync, type ArenaSimulateOptions, type ArenaSimulationResult } from "@modelscript/simulate";
import { SysML2DaeLowerer } from "./sysml2-dae-lowerer.js";

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
  const arena = await SysML2DaeLowerer.lowerSystem(sysmlSource);
  return simulateArenaAsync(arena, options);
}
