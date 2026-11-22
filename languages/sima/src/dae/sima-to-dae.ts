// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for SINTEF Ocean SIMO / RIFLEX / SIMA.
 * Exposes standardized lowerSimaToDae and simaToDae helpers.
 */

import type { DAEBuilder } from "@modelscript/runtime";
import { ensureBuiltInSimaLibraryRegistered, lookupSimaModelSchema } from "../catalog/library-package-adapter.js";
import { lowerSimaToDae } from "../solver/dae-lowering.js";
import type { SimaModel } from "../types.js";

export { lowerSimaToDae };

export interface SimaToDaeOptions {
  modelName?: string;
}

/**
 * Resolves parameter defaults for a SIMA model from `@modelscript/sima-std-lib`,
 * merging any user-specified named overrides over the cleanroom schema defaults.
 */
export function resolveSimaSchemaParamDefaults(
  modelName: string,
  overrides: Record<string, number> = {},
): Record<string, number> {
  ensureBuiltInSimaLibraryRegistered();
  const resolved: Record<string, number> = {};
  const schema = lookupSimaModelSchema(modelName);
  if (schema) {
    for (const p of schema.parameters) {
      if (typeof p.defaultValue === "number" && Number.isFinite(p.defaultValue)) {
        resolved[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (Number.isFinite(v)) {
      resolved[k] = v;
    }
  }
  return resolved;
}

/**
 * Lowers a SIMA marine model to a WebAssembly linear-memory DAE arena.
 */
export function simaToDae(model: SimaModel, options?: SimaToDaeOptions): DAEBuilder {
  ensureBuiltInSimaLibraryRegistered();
  if (options?.modelName) {
    const cloned = { ...model, title: options.modelName };
    return lowerSimaToDae(cloned);
  }
  return lowerSimaToDae(model);
}
