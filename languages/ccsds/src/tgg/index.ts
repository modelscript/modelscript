// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { ccsdsPolyglotConfig } from "./ccsds-rules.js";

export * from "./ccsds-rules.js";

export const ccsdsTggPlan: CompiledTGGPlan = planTGGRules(ccsdsPolyglotConfig);

export function createCcsdsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: ccsdsTggPlan });
}
