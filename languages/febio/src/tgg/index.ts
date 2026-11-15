// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { febioPolyglotConfig } from "./febio-rules.js";

export * from "./febio-rules.js";

export const febioTggPlan: CompiledTGGPlan = planTGGRules(febioPolyglotConfig);

export function createFebioTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: febioTggPlan });
}
