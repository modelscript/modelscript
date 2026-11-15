// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { nmodlPolyglotConfig } from "./nmodl-rules.js";

export * from "./nmodl-rules.js";

export const nmodlTggPlan: CompiledTGGPlan = planTGGRules(nmodlPolyglotConfig);

export function createNmodlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: nmodlTggPlan });
}
