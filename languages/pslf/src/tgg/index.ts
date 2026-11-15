// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { pslfPolyglotConfig } from "./pslf-rules.js";

export * from "./pslf-rules.js";

export const pslfTggPlan: CompiledTGGPlan = planTGGRules(pslfPolyglotConfig);

export function createPslfTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: pslfTggPlan });
}
