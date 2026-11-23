// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseSindaDeck } from "../parser/deck-parser.js";
import type { SindaModel } from "../types.js";
import { lowerSindaToDae, type SindaDaeLoweringResult } from "./lowering.js";

export interface SindaToDaeOptions {
  modelName?: string;
}

export interface SindaDaeBundle {
  model: SindaModel;
  dae: DAEBuilder;
  lowering: SindaDaeLoweringResult;
}

/**
 * Lowers a SINDA thermal network (source string or parsed `SindaModel`) into a linear-memory `DAEBuilder`.
 */
export function sindaToDae(input: string | SindaModel, options?: SindaToDaeOptions): SindaDaeBundle {
  const model = typeof input === "string" ? parseSindaDeck(input) : input;
  const modelName = (options?.modelName || model.title || "SindaThermalModel").replace(/[^A-Za-z0-9_]/g, "_");
  const dae = new DAEBuilder(undefined, modelName);
  const lowering = lowerSindaToDae(dae, model);
  return { model, dae, lowering };
}
