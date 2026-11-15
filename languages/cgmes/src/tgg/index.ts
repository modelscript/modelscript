// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { cgmesPolyglotConfig } from "./cgmes-rules.js";

export * from "./cgmes-rules.js";

export const cgmesTggPlan: CompiledTGGPlan = planTGGRules(cgmesPolyglotConfig);

export function createCgmesTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: cgmesTggPlan });
}
