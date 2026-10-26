// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { lowerFlowpathToDae } from "../solver/drift-flux-dae.js";
import type { OlgaModel } from "../types.js";

export interface OlgaDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Direct lowering of OLGA multiphase flow networks into ModelScript's linear-memory DAE arena.
 */
export function lowerOlgaToDae(model: OlgaModel, options?: OlgaDaeOptions): DAEBuilder {
  const modelName = options?.modelName ?? model.flowpaths[0]?.name ?? "OlgaPipeline";
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  for (const flowpath of model.flowpaths) {
    lowerFlowpathToDae(dae, model, flowpath);
  }

  return dae;
}
