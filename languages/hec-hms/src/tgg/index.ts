// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { hecHmsPolyglotConfig } from "./hec-hms-rules.js";

export * from "./hec-hms-rules.js";

export const hecHmsTggPlan: CompiledTGGPlan = planTGGRules(hecHmsPolyglotConfig);

export function createHecHmsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: hecHmsTggPlan });
}
