// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { watermlPolyglotConfig } from "./waterml-rules.js";

export * from "./waterml-rules.js";

export const watermlTggPlan: CompiledTGGPlan = planTGGRules(watermlPolyglotConfig);

export function createWatermlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: watermlTggPlan });
}
