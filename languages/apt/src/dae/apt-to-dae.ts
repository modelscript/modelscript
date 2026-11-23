// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { AptProgram, ClDataProgram } from "../types.js";
import { lowerAptToDae, type AptDaeLoweringResult, type AptMachiningPhysicsOptions } from "./lowering.js";

export { lowerAptToDae, type AptDaeLoweringResult, type AptMachiningPhysicsOptions };

export interface AptToDaeOptions extends AptMachiningPhysicsOptions {
  modelName?: string | undefined;
}

/**
 * Lowers an APT CNC part program into a linear-memory `DAEBuilder` arena.
 */
export function aptToDae(input: AptProgram | ClDataProgram | string, options: AptToDaeOptions = {}): DAEBuilder {
  const rawName =
    options.modelName || (typeof input === "object" && "partno" in input && input.partno ? input.partno : "AptProgram");
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerAptToDae(builder, input, options);
  return builder;
}
