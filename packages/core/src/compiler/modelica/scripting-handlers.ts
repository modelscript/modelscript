// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registers all built-in scripting handlers (simulate, montecarlo, optimize, calibrate)
 * in both the arena-native script executor and the legacy ModelicaInterpreter.
 *
 * This module is imported by the core package's index.ts to ensure handlers
 * are available as soon as @modelscript/core is loaded.
 */

import { ModelicaInterpreter, type BuiltinScriptingFunction } from "./interpreter.js";
import { registerScriptingHandler, type ScriptingHandler } from "./script-executor.js";
import { evaluateCalibrate } from "./scripting/evaluate-calibrate.js";
import { evaluateMonteCarlo } from "./scripting/evaluate-montecarlo.js";
import { evaluateOptimize } from "./scripting/evaluate-optimize.js";
import { evaluateSimulate } from "./scripting/evaluate-simulate.js";

// Register in the arena-native script executor
registerScriptingHandler("simulate", evaluateSimulate as ScriptingHandler);
registerScriptingHandler("montecarlo", evaluateMonteCarlo as ScriptingHandler);
registerScriptingHandler("optimize", evaluateOptimize as ScriptingHandler);
registerScriptingHandler("calibrate", evaluateCalibrate as ScriptingHandler);

// Register in the legacy ModelicaInterpreter (for backward compatibility)
ModelicaInterpreter.scriptingHandlers.set("simulate", evaluateSimulate as unknown as BuiltinScriptingFunction);
ModelicaInterpreter.scriptingHandlers.set("montecarlo", evaluateMonteCarlo as unknown as BuiltinScriptingFunction);
ModelicaInterpreter.scriptingHandlers.set("optimize", evaluateOptimize as unknown as BuiltinScriptingFunction);
ModelicaInterpreter.scriptingHandlers.set("calibrate", evaluateCalibrate as unknown as BuiltinScriptingFunction);
