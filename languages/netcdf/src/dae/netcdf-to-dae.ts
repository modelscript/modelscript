// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { NetcdfDataset } from "../types.js";
import { lowerNetcdfToDae, type NetcdfDaeLoweringResult } from "./lowering.js";

export interface NetcdfDaeBuildOutput {
  builder: DAEBuilder;
  result: NetcdfDaeLoweringResult;
}

/**
 * High-level helper that creates a fresh `DAEBuilder` and lowers a `NetcdfDataset` into it.
 */
export function netcdfToDae(dataset: NetcdfDataset): NetcdfDaeBuildOutput {
  const builder = new DAEBuilder();
  const result = lowerNetcdfToDae(builder, dataset);
  return { builder, result };
}
