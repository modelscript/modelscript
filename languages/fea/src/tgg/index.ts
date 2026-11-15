// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { feaPolyglotConfig } from "./fea-rules.js";

export * from "./fea-rules.js";

export const feaTggPlan: CompiledTGGPlan = planTGGRules(feaPolyglotConfig);

export function createFeaTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: feaTggPlan });
}
