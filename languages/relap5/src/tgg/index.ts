// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { relap5PolyglotConfig } from "./relap5-rules.js";

export * from "./relap5-rules.js";

export const relap5TggPlan: CompiledTGGPlan = planTGGRules(relap5PolyglotConfig);

export function createRelap5TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: relap5TggPlan });
}
