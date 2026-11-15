// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { lpsPolyglotConfig } from "./lps-rules.js";

export * from "./lps-rules.js";

export const lpsTggPlan: CompiledTGGPlan = planTGGRules(lpsPolyglotConfig);

export function createLpsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: lpsTggPlan });
}
