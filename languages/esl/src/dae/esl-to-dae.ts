// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseEsl } from "../parser/esl-parser.js";
import type { EslProgram } from "../types.js";
import { lowerEslToDae, type EslDaeLoweringResult } from "./lowering.js";

export { lowerEslToDae, type EslDaeLoweringResult };

export interface EslToDaeOptions {
  modelName?: string;
}

/**
 * Lowers an ESA ESL program (or source string) into a linear-memory `DAEBuilder` arena.
 */
export function eslToDae(programOrSource: EslProgram | string, options?: EslToDaeOptions): DAEBuilder {
  const program = typeof programOrSource === "string" ? parseEsl(programOrSource) : programOrSource;
  const modelName = (options?.modelName || program.name || "EslModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerEslToDae(builder, program, options?.modelName);
  return builder;
}
