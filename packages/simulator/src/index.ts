// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./ad-jacobian.js";
export * from "./arena-simulator.js";
export * from "./bdf.js";
export * from "./branch-and-bound.js";
export * from "./doe-arena.js";
export * from "./doe.js";
export { dopri5, type Dopri5Options, type Dopri5Result, type EventCallback, type RhsFunction } from "./dopri5.js";
export * from "./dual-evaluator.js";
export * from "./dual.js";
export * from "./evaluate-montecarlo.js";
export * from "./evaluate-simulate.js";
export * from "./fmu-subsystem.js";
export * from "./gaussian.js";
export * from "./homotopy-strategies.js";
export * from "./init-solver.js";
export * from "./memory-profiler.js";
export * from "./minlp-heuristics.js";
export * from "./monte-carlo-arena.js";
export * from "./monte-carlo.js";
export * from "./nn-fmu-subsystem.js";
export * from "./reverse-evaluator.js";
export * from "./rom-trainer.js";
export * from "./simulate-arena.js";
export * from "./simulator.js";
export * from "./solver-options.js";
export * from "./sparse-jacobian.js";
export * from "./statement-executor.js";
export {
  getCachedSundialsWasm,
  loadSundialsWasm,
  SundialsWasmSolver,
  type KinsolWasmResult,
  type EventCallback as SundialsEventCallback,
  type EventFunction as SundialsEventFunction,
  type RhsFunction as SundialsRhsFunction,
  type SundialsWasmOptions,
  type SundialsWasmResult,
} from "./sundials-wasm.js";
export * from "./surrogate-pipeline-arena.js";
export * from "./surrogate-pipeline.js";
export * from "./system-initializer.js";
export * from "./tape.js";
export * from "./wasm-simulation-runner.js";

import { ModelicaInterpreter, type BuiltinScriptingFunction } from "@modelscript/core";
import { evaluateMonteCarlo } from "./evaluate-montecarlo.js";
import { evaluateSimulate } from "./evaluate-simulate.js";
ModelicaInterpreter.scriptingHandlers.set("simulate", evaluateSimulate as unknown as BuiltinScriptingFunction);
ModelicaInterpreter.scriptingHandlers.set("montecarlo", evaluateMonteCarlo as unknown as BuiltinScriptingFunction);
