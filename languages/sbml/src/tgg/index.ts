// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { sbmlPolyglotConfig } from "./sbml-rules.js";

export * from "./sbml-rules.js";

export const sbmlTggPlan: CompiledTGGPlan = planTGGRules(sbmlPolyglotConfig);

export function createSbmlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: sbmlTggPlan });
}
