// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { GCodeProgram, ToolpathSummary } from "../types.js";
import { lowerGCodeToDae, type GCodeDaeLoweringResult, type GCodeMachiningPhysicsOptions } from "./lowering.js";

export { lowerGCodeToDae, type GCodeDaeLoweringResult, type GCodeMachiningPhysicsOptions };

export interface GCodeToDaeOptions extends GCodeMachiningPhysicsOptions {
  modelName?: string | undefined;
}

/**
 * Lowers an RS-274 / ISO 6983 G-code program into a linear-memory `DAEBuilder` arena.
 */
export function gcodeToDae(
  input: GCodeProgram | ToolpathSummary | string,
  options: GCodeToDaeOptions = {},
): DAEBuilder {
  const rawName =
    options.modelName ||
    (typeof input === "object" && "programName" in input
      ? input.programName
      : typeof input === "object" && "name" in input
        ? input.name
        : "GCodeProgram");
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerGCodeToDae(builder, input, options);
  return builder;
}
