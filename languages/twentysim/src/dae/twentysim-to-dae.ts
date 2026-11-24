// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseTwentySim } from "../parser/emx-parser.js";
import type { TwentySimModel } from "../types.js";
import { lowerTwentySimToDae, type TwentySimDaeLoweringResult } from "./lowering.js";

export { lowerTwentySimToDae, type TwentySimDaeLoweringResult };

export interface TwentySimToDaeOptions {
  modelName?: string | undefined;
}

/**
 * Lowers a 20-sim model (parsed or raw `.emx`/`.emxz`/`.sid` source) into a linear-memory `DAEBuilder` arena.
 */
export function twentySimToDae(
  modelOrSource: TwentySimModel | string | Buffer | Uint8Array,
  options?: TwentySimToDaeOptions,
): DAEBuilder {
  const model =
    typeof modelOrSource === "string" || modelOrSource instanceof Uint8Array
      ? parseTwentySim(modelOrSource)
      : modelOrSource;
  const modelName = (options?.modelName || model.name || "TwentySimModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerTwentySimToDae(builder, model);
  return builder;
}
