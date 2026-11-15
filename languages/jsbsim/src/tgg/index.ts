// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { jsbsimPolyglotConfig } from "./jsbsim-rules.js";

export * from "./jsbsim-rules.js";

export const jsbsimTggPlan: CompiledTGGPlan = planTGGRules(jsbsimPolyglotConfig);

export function createJsbsimTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: jsbsimTggPlan });
}
