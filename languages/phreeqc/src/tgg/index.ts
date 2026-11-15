// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { phreeqcPolyglotConfig } from "./phreeqc-rules.js";

export * from "./phreeqc-rules.js";

export const phreeqcTggPlan: CompiledTGGPlan = planTGGRules(phreeqcPolyglotConfig);

export function createPhreeqcTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: phreeqcTggPlan });
}
