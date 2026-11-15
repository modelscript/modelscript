// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { toughPolyglotConfig } from "./tough-rules.js";

export * from "./tough-rules.js";

export const toughTggPlan: CompiledTGGPlan = planTGGRules(toughPolyglotConfig);

export function createToughTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: toughTggPlan });
}
