// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { canteraTggRules } from "./cantera-rules.js";

export * from "./cantera-rules.js";

export const canteraPolyglotConfig: PolyglotConfig = {
  languages: ["cantera", "modelica", "sysml2"],
  rules: canteraTggRules,
};
export const canteraTggPlan: CompiledTGGPlan = planTGGRules(canteraPolyglotConfig);

export function createCanteraTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: canteraTggPlan });
}
