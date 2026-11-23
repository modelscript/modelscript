// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { CifDataBlock, CifDocument, CrystalStructure } from "../types.js";
import { lowerCifToDae, type CifDaeLoweringResult } from "./lowering.js";

export { lowerCifToDae, type CifDaeLoweringResult };

export interface CifToDaeOptions {
  modelName?: string;
}

/**
 * Lowers an IUCr CIF crystal structure into a linear-memory `DAEBuilder` arena.
 */
export function cifToDae(
  input: string | CifDocument | CifDataBlock | CrystalStructure,
  options?: CifToDaeOptions,
): { builder: DAEBuilder; result: CifDaeLoweringResult } {
  const rawName =
    options?.modelName ??
    (typeof input === "object" && "name" in input && typeof input.name === "string" ? input.name : "IucrCifCrystal");
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_") || "IucrCifCrystal";
  const builder = new DAEBuilder(undefined, modelName);
  const result = lowerCifToDae(builder, input);
  return { builder, result };
}
