// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { aspenPolyglotConfig } from "./aspen-rules.js";

export * from "./aspen-rules.js";

export const aspenTggPlan: CompiledTGGPlan = planTGGRules(aspenPolyglotConfig);

export function createAspenTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: aspenTggPlan });
}
