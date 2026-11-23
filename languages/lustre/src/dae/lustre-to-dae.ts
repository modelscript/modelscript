// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { LustreProgram } from "../types.js";
import { lowerLustreToDae, type LustreDaeLoweringOptions, type LustreDaeLoweringResult } from "./lowering.js";

export { lowerLustreToDae, type LustreDaeLoweringOptions, type LustreDaeLoweringResult };

/**
 * Lowers a Lustre program directly into a new linear-memory `DAEBuilder` arena.
 */
export function lustreToDae(
  program: LustreProgram,
  options: LustreDaeLoweringOptions = {},
): { builder: DAEBuilder; result: LustreDaeLoweringResult } {
  const targetName = (options.nodeName ?? program.nodes[program.nodes.length - 1]?.name ?? "LustreNode").replace(
    /[^A-Za-z0-9_]/g,
    "_",
  );
  const builder = new DAEBuilder(undefined, targetName);
  const result = lowerLustreToDae(builder, program, options);
  return { builder, result };
}
