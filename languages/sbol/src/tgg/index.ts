// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { sbolPolyglotConfig } from "./sbol-rules.js";

export * from "./sbol-rules.js";

export const sbolTggPlan: CompiledTGGPlan = planTGGRules(sbolPolyglotConfig);

export function createSbolTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: sbolTggPlan });
}
