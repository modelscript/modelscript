// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { owl2PolyglotConfig } from "./owl2-rules.js";

export * from "./owl2-rules.js";

export const owl2TggPlan: CompiledTGGPlan = planTGGRules(owl2PolyglotConfig);

export function createOwl2TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: owl2TggPlan });
}
