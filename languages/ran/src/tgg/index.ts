// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { ranPolyglotConfig } from "./ran-rules.js";

export * from "./ran-rules.js";

export const ranTggPlan: CompiledTGGPlan = planTGGRules(ranPolyglotConfig);

export function createRanTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: ranTggPlan });
}
