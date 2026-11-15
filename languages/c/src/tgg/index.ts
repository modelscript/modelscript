// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { cPolyglotConfig } from "./c-rules.js";

export * from "./c-rules.js";

export const cTggPlan: CompiledTGGPlan = planTGGRules(cPolyglotConfig);

export function createCTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: cTggPlan });
}
