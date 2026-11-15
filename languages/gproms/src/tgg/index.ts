// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { gpromsPolyglotConfig } from "./gproms-rules.js";

export * from "./gproms-rules.js";

export const gpromsTggPlan: CompiledTGGPlan = planTGGRules(gpromsPolyglotConfig);

export function createGpromsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: gpromsTggPlan });
}
