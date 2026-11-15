// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { usdPolyglotConfig } from "./usd-rules.js";

export * from "./usd-rules.js";

export const usdTggPlan: CompiledTGGPlan = planTGGRules(usdPolyglotConfig);

export function createUsdTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: usdTggPlan });
}
