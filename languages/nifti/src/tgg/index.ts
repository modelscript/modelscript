// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { niftiPolyglotConfig } from "./nifti-rules.js";

export * from "./nifti-rules.js";

export const niftiTggPlan: CompiledTGGPlan = planTGGRules(niftiPolyglotConfig);

export function createNiftiTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: niftiTggPlan });
}
