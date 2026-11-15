// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { openadrPolyglotConfig } from "./openadr-rules.js";

export * from "./openadr-rules.js";

export const openadrTggPlan: CompiledTGGPlan = planTGGRules(openadrPolyglotConfig);

export function createOpenadrTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: openadrTggPlan });
}
