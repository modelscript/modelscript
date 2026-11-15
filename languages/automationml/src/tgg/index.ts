// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { automationmlPolyglotConfig } from "./automationml-rules.js";

export * from "./automationml-rules.js";

export const automationmlTggPlan: CompiledTGGPlan = planTGGRules(automationmlPolyglotConfig);

export function createAutomationmlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: automationmlTggPlan });
}
