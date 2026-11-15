// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { epanetTggRules } from "./epanet-rules.js";

export * from "./epanet-rules.js";

export const epanetPolyglotConfig: PolyglotConfig = {
  languages: ["epanet", "modelica", "sysml2"],
  rules: epanetTggRules,
};
export const epanetTggPlan: CompiledTGGPlan = planTGGRules(epanetPolyglotConfig);

export function createEpanetTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: epanetTggPlan });
}
