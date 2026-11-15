// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { simaPolyglotConfig } from "./sima-rules.js";

export * from "./sima-rules.js";

export const simaTggPlan: CompiledTGGPlan = planTGGRules(simaPolyglotConfig);

export function createSimaTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: simaTggPlan });
}
