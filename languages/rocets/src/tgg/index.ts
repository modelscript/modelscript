// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { rocetsPolyglotConfig } from "./rocets-rules.js";

export * from "./rocets-rules.js";

export const rocetsTggPlan: CompiledTGGPlan = planTGGRules(rocetsPolyglotConfig);

export function createRocetsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: rocetsTggPlan });
}
