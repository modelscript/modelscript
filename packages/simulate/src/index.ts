// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate
 * Continuous & discrete ODE/DAE simulation, SUNDIALS/CVODE integrators,
 * WebGPU acceleration, and numerical optimization engines for ModelScript.
 */

export * from "./calibration/index.js";
export * from "./cfd/index.js";
export * from "./core/index.js";
export * from "./fea/index.js";
export * from "./meshing/index.js";
export * from "./optimizer/index.js";
export * from "./solvers/index.js";
export * from "./surrogates/index.js";
export * from "./sysml2/index.js";
export * from "./twin/index.js";
export * from "./uq/index.js";
export * from "./utils/index.js";

import { simulateArena, simulateArenaAsync } from "./core/simulate-arena.js";
import { registerArenaSimulator } from "./uq/monte-carlo.js";

registerArenaSimulator(simulateArena, simulateArenaAsync);
