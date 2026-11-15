// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { igtlPolyglotConfig } from "./igtl-rules.js";

export * from "./igtl-rules.js";

export const igtlTggPlan: CompiledTGGPlan = planTGGRules(igtlPolyglotConfig);

export function createIgtlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: igtlTggPlan });
}
