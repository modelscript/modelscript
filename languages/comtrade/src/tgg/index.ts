// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { comtradePolyglotConfig } from "./comtrade-rules.js";

export * from "./comtrade-rules.js";

export const comtradeTggPlan: CompiledTGGPlan = planTGGRules(comtradePolyglotConfig);

export function createComtradeTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: comtradeTggPlan });
}
