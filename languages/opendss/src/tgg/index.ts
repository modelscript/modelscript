// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { opendssPolyglotConfig } from "./opendss-rules.js";

export * from "./opendss-rules.js";

export const opendssTggPlan: CompiledTGGPlan = planTGGRules(opendssPolyglotConfig);

export function createOpendssTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: opendssTggPlan });
}
