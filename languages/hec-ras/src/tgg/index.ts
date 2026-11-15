// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { hecRasPolyglotConfig } from "./hec-ras-rules.js";

export * from "./hec-ras-rules.js";

export const hecRasTggPlan: CompiledTGGPlan = planTGGRules(hecRasPolyglotConfig);

export function createHecRasTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: hecRasTggPlan });
}
