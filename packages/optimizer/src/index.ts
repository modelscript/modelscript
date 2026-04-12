// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./coinor-codegen.js";
export * from "./coinor-wasm.js";
export * from "./evaluate-optimize.js";
export * from "./gpu-codegen.js";
export * from "./ipopt-solver.js";
export * from "./optimizer.js";
export * from "./stochastic-optimizer.js";
import { ModelicaInterpreter, type BuiltinScriptingFunction } from "@modelscript/core";
import { evaluateOptimize } from "./evaluate-optimize.js";
ModelicaInterpreter.scriptingHandlers.set("optimize", evaluateOptimize as unknown as BuiltinScriptingFunction);
