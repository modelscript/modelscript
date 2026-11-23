// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { SolveDatcomOptions } from "../solver/aero-solver.js";
import type { DatcomCase } from "../types.js";
import { lowerDatcomToDae, type DatcomDaeLoweringResult } from "./lowering.js";

export { lowerDatcomToDae, type DatcomDaeLoweringResult };

export interface DatcomToDaeOptions extends SolveDatcomOptions {
  modelName?: string | undefined;
}

/**
 * Lowers a USAF Digital DATCOM case into a linear-memory `DAEBuilder` arena.
 */
export function datcomToDae(
  c: DatcomCase,
  options?: DatcomToDaeOptions,
): {
  builder: DAEBuilder;
  result: DatcomDaeLoweringResult;
} {
  const modelName = (options?.modelName || c.caseId || "DatcomFlightDynamics").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  const result = lowerDatcomToDae(builder, c, options);
  return { builder, result };
}
