// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { stepPolyglotConfig } from "./step-rules.js";

export * from "./step-rules.js";

export const stepTggPlan: CompiledTGGPlan = planTGGRules(stepPolyglotConfig);

export function createStepTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: stepTggPlan });
}
