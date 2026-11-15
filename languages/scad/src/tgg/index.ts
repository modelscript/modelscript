// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { scadPolyglotConfig } from "./scad-rules.js";

export * from "./scad-rules.js";

export const scadTggPlan: CompiledTGGPlan = planTGGRules(scadPolyglotConfig);

export function createScadTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: scadTggPlan });
}
