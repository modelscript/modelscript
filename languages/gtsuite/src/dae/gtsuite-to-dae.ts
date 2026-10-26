// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { GtModel } from "../types.js";
import { lowerGtSuiteToDae, type GtDaeLoweringResult } from "./mvem-dae.js";

export { lowerGtSuiteToDae, type GtDaeLoweringResult };

export interface GtSuiteToDaeOptions {
  modelName?: string;
}

/**
 * Lowers a GT-SUITE engine model directly into a linear-memory DAE arena.
 */
export function gtsuiteToDae(model: GtModel, options?: GtSuiteToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "GtEngineModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerGtSuiteToDae(builder, model);
  return builder;
}
