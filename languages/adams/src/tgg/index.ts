// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { adamsTggRules } from "./adams-rules.js";

export * from "./adams-rules.js";

export const adamsPolyglotConfig: PolyglotConfig = {
  languages: ["adams", "modelica", "sysml2"],
  rules: adamsTggRules,
};
export const adamsTggPlan: CompiledTGGPlan = planTGGRules(adamsPolyglotConfig);

export function createAdamsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: adamsTggPlan });
}
