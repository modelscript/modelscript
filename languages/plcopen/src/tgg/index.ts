// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { plcopenPolyglotConfig } from "./plcopen-rules.js";

export * from "./plcopen-rules.js";

export const plcopenTggPlan: CompiledTGGPlan = planTGGRules(plcopenPolyglotConfig);

export function createPlcopenTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: plcopenTggPlan });
}
