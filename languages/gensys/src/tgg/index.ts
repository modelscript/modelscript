// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { gensysPolyglotConfig } from "./gensys-rules.js";

export * from "./gensys-rules.js";

export const gensysTggPlan: CompiledTGGPlan = planTGGRules(gensysPolyglotConfig);

export function createGensysTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: gensysTggPlan });
}
