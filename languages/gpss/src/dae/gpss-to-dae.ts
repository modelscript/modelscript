// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { GpssModel } from "../types.js";
import { lowerGpssToDae, type GpssDaeLoweringResult } from "./lowering.js";

export { lowerGpssToDae, type GpssDaeLoweringResult };

export interface GpssToDaeOptions {
  modelName?: string;
}

/**
 * Lowers a GPSS discrete-event queuing model into a linear-memory `DAEBuilder` arena.
 */
export function gpssToDae(model: GpssModel, options?: GpssToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "GpssModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerGpssToDae(builder, model);
  return builder;
}
