// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { RocetsEngineModel } from "../types.js";
import { lowerRocetsToDae, type RocetsDaeLoweringResult } from "./lowering.js";

export { lowerRocetsToDae, type RocetsDaeLoweringResult };

export interface RocetsToDaeOptions {
  modelName?: string;
}

/**
 * Lowers a NASA ROCETS liquid rocket engine deck into a linear-memory DAE arena.
 */
export function rocetsToDae(model: RocetsEngineModel, options?: RocetsToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "RocetsEngineDeck").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerRocetsToDae(builder, model);
  return builder;
}
