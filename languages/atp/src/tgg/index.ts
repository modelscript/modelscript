// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { atpPolyglotConfig } from "./atp-rules.js";

export * from "./atp-rules.js";

export const atpTggPlan: CompiledTGGPlan = planTGGRules(atpPolyglotConfig);

export function createAtpTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: atpTggPlan });
}
