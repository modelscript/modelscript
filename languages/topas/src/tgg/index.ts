// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { topasPolyglotConfig } from "./topas-rules.js";

export * from "./topas-rules.js";

export const topasTggPlan: CompiledTGGPlan = planTGGRules(topasPolyglotConfig);

export function createTopasTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: topasTggPlan });
}
