// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { sclPolyglotConfig } from "./scl-rules.js";

export * from "./scl-rules.js";

export const sclTggPlan: CompiledTGGPlan = planTGGRules(sclPolyglotConfig);

export function createSclTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: sclTggPlan });
}
