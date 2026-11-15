// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { modelicaPolyglotConfig } from "./modelica-rules.js";

export * from "./modelica-rules.js";

export const modelicaTggPlan: CompiledTGGPlan = planTGGRules(modelicaPolyglotConfig);

export function createModelicaTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: modelicaTggPlan });
}
