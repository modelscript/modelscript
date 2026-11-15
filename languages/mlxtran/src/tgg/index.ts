// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { mlxtranPolyglotConfig } from "./mlxtran-rules.js";

export * from "./mlxtran-rules.js";

export const mlxtranTggPlan: CompiledTGGPlan = planTGGRules(mlxtranPolyglotConfig);

export function createMlxtranTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: mlxtranTggPlan });
}
