// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { sspPolyglotConfig } from "./ssp-rules.js";

export * from "./ssp-rules.js";

export const sspTggPlan: CompiledTGGPlan = planTGGRules(sspPolyglotConfig);

export function createSspTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: sspTggPlan });
}
