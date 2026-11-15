// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { oscalPolyglotConfig } from "./oscal-rules.js";

export * from "./oscal-rules.js";

export const oscalTggPlan: CompiledTGGPlan = planTGGRules(oscalPolyglotConfig);

export function createOscalTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: oscalTggPlan });
}
