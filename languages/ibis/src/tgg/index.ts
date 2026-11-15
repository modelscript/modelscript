// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { ibisPolyglotConfig } from "./ibis-rules.js";

export * from "./ibis-rules.js";

export const ibisTggPlan: CompiledTGGPlan = planTGGRules(ibisPolyglotConfig);

export function createIbisTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: ibisTggPlan });
}
