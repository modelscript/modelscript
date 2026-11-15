// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { ocppPolyglotConfig } from "./ocpp-rules.js";

export * from "./ocpp-rules.js";

export const ocppTggPlan: CompiledTGGPlan = planTGGRules(ocppPolyglotConfig);

export function createOcppTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: ocppTggPlan });
}
