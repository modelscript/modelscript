// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { Easy5Model } from "../types.js";
import { lowerEasy5ToDae, type Easy5DaeLoweringResult } from "./lowering.js";

export { lowerEasy5ToDae, type Easy5DaeLoweringResult };

export interface Easy5ToDaeOptions {
  modelName?: string;
}

/**
 * Lowers an MSC/Boeing EASY5 control and fluid model into a linear-memory DAE arena.
 */
export function easy5ToDae(model: Easy5Model, options?: Easy5ToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "Easy5ControlModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerEasy5ToDae(builder, model);
  return builder;
}
