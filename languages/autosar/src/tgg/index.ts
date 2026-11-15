// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { autosarPolyglotConfig } from "./autosar-rules.js";

export * from "./autosar-rules.js";
export * from "./autosar-sync.js";

export const autosarTggPlan: CompiledTGGPlan = planTGGRules(autosarPolyglotConfig);

export function createAutosarTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: autosarTggPlan });
}
