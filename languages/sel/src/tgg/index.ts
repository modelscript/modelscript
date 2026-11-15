// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { selPolyglotConfig } from "./sel-rules.js";

export * from "./sel-rules.js";

export const selTggPlan: CompiledTGGPlan = planTGGRules(selPolyglotConfig);

export function createSelTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: selTggPlan });
}
