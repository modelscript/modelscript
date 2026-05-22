// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./calibrator.js";
export * from "./coinor-codegen.js";
export * from "./coinor-wasm.js";
export * from "./csv-parser.js";
export * from "./evaluate-calibrate.js";
export * from "./evaluate-optimize.js";
export * from "./gpu-codegen.js";
export * from "./ipopt-solver.js";
export * from "./optimizer.js";
export * from "./stochastic-optimizer.js";
import { ModelicaFlattener, ModelicaInterpreter, type BuiltinScriptingFunction } from "@modelscript/core";
import { ModelicaSimulator } from "@modelscript/simulator";
import { ModelicaCalibrator } from "./calibrator.js";
import { evaluateCalibrate, registerCalibrateDeps } from "./evaluate-calibrate.js";
import { evaluateOptimize, registerOptimizeDeps } from "./evaluate-optimize.js";
import { ModelicaOptimizer } from "./optimizer.js";

registerOptimizeDeps({ Flattener: ModelicaFlattener, Optimizer: ModelicaOptimizer });
registerCalibrateDeps({ Flattener: ModelicaFlattener, Simulator: ModelicaSimulator, Calibrator: ModelicaCalibrator });

ModelicaInterpreter.scriptingHandlers.set("optimize", evaluateOptimize as unknown as BuiltinScriptingFunction);
ModelicaInterpreter.scriptingHandlers.set("calibrate", evaluateCalibrate as unknown as BuiltinScriptingFunction);
