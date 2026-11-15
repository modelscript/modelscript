// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { opticalPolyglotConfig } from "./optical-rules.js";

export * from "./optical-rules.js";

export const opticalTggPlan: CompiledTGGPlan = planTGGRules(opticalPolyglotConfig);

export function createOpticalTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: opticalTggPlan });
}
