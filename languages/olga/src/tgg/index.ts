// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { olgaPolyglotConfig } from "./olga-rules.js";

export * from "./olga-rules.js";

export const olgaTggPlan: CompiledTGGPlan = planTGGRules(olgaPolyglotConfig);

export function createOlgaTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: olgaTggPlan });
}
