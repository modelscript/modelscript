// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { simpackPolyglotConfig } from "./simpack-rules.js";

export * from "./simpack-rules.js";

export const simpackTggPlan: CompiledTGGPlan = planTGGRules(simpackPolyglotConfig);

export function createSimpackTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: simpackTggPlan });
}
