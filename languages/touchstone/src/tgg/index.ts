// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { touchstonePolyglotConfig } from "./touchstone-rules.js";

export * from "./touchstone-rules.js";

export const touchstoneTggPlan: CompiledTGGPlan = planTGGRules(touchstonePolyglotConfig);

export function createTouchstoneTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: touchstoneTggPlan });
}
