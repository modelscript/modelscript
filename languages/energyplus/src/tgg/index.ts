// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { energyplusPolyglotConfig } from "./energyplus-rules.js";

export * from "./energyplus-rules.js";

export const energyplusTggPlan: CompiledTGGPlan = planTGGRules(energyplusPolyglotConfig);

export function createEnergyplusTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: energyplusTggPlan });
}
