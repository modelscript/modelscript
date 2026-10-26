// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for SINTEF Ocean SIMO / RIFLEX / SIMA.
 * Exposes standardized lowerSimaToDae and simaToDae helpers.
 */

import type { DAEBuilder } from "@modelscript/runtime";
import { lowerSimaToDae } from "../solver/dae-lowering.js";
import type { SimaModel } from "../types.js";

export { lowerSimaToDae };

export interface SimaToDaeOptions {
  modelName?: string;
}

/**
 * Lowers a SIMA marine model to a WebAssembly linear-memory DAE arena.
 */
export function simaToDae(model: SimaModel, options?: SimaToDaeOptions): DAEBuilder {
  if (options?.modelName) {
    const cloned = { ...model, title: options.modelName };
    return lowerSimaToDae(cloned);
  }
  return lowerSimaToDae(model);
}
