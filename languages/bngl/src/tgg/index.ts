// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { bnglPolyglotConfig } from "./bngl-rules.js";

export * from "./bngl-rules.js";

export const bnglTggPlan: CompiledTGGPlan = planTGGRules(bnglPolyglotConfig);

export function createBnglTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: bnglTggPlan });
}
