// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { landgemPolyglotConfig } from "./landgem-rules.js";

export * from "./landgem-rules.js";

export const landgemTggPlan: CompiledTGGPlan = planTGGRules(landgemPolyglotConfig);

export function createLandgemTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: landgemTggPlan });
}
