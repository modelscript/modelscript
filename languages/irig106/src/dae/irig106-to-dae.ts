// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseIrig106 } from "../parser/tmats-parser.js";
import type { TmatsModel } from "../types.js";
import { lowerIrig106ToDae, type Irig106DaeLoweringResult } from "./lowering.js";

export { lowerIrig106ToDae, type Irig106DaeLoweringResult };

export interface Irig106ToDaeOptions {
  modelName?: string;
}

/**
 * Lowers an IRIG 106 Chapter 9 TMATS document or `TmatsModel` into a linear-memory `DAEBuilder`.
 */
export function irig106ToDae(modelOrSource: TmatsModel | string, options?: Irig106ToDaeOptions): DAEBuilder {
  const model = typeof modelOrSource === "string" ? parseIrig106(modelOrSource) : modelOrSource;
  const modelName = (options?.modelName || model.name || "Irig106Telemetry").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerIrig106ToDae(builder, model);
  return builder;
}
