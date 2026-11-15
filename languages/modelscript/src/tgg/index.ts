// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { modelscriptPolyglotConfig } from "./modelscript-rules.js";

export * from "./modelscript-rules.js";

export const modelscriptTggPlan: CompiledTGGPlan = planTGGRules(modelscriptPolyglotConfig);

export function createModelscriptTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: modelscriptTggPlan });
}
