// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { swmmTggRules } from "./swmm-rules.js";

export * from "./swmm-rules.js";

export const swmmPolyglotConfig: PolyglotConfig = {
  languages: ["swmm", "modelica", "sysml2"],
  rules: swmmTggRules,
};
export const swmmTggPlan: CompiledTGGPlan = planTGGRules(swmmPolyglotConfig);

export function createSwmmTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: swmmTggPlan });
}
