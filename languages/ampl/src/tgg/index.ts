// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { amplPolyglotConfig } from "./ampl-rules.js";

export * from "./ampl-rules.js";

export const amplTggPlan: CompiledTGGPlan = planTGGRules(amplPolyglotConfig);

export function createAmplTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: amplTggPlan });
}
