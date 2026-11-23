// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseAcsl } from "../parser/acsl-parser.js";
import type { AcslProgram } from "../types.js";
import { lowerAcslToDae, type AcslDaeLoweringResult } from "./lowering.js";

export { lowerAcslToDae, type AcslDaeLoweringResult };

export interface AcslToDaeOptions {
  modelName?: string;
}

/**
 * Lowers an ACSL program (parsed or raw source) into a linear-memory `DAEBuilder` arena.
 */
export function acslToDae(programOrSource: AcslProgram | string, options?: AcslToDaeOptions): DAEBuilder {
  const program = typeof programOrSource === "string" ? parseAcsl(programOrSource) : programOrSource;
  const modelName = (options?.modelName || program.name || "AcslModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerAcslToDae(builder, program);
  return builder;
}
