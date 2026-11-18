// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { gridlabdPolyglotConfig } from "./gridlabd-rules.js";

export * from "./gridlabd-rules.js";

export const gridlabdTggPlan: CompiledTGGPlan = planTGGRules(gridlabdPolyglotConfig);

export function createGridlabdTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: gridlabdTggPlan });
}
