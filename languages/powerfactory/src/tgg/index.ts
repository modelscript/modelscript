// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { powerFactoryTggRules } from "./powerfactory-rules.js";

export * from "./powerfactory-rules.js";

export const powerfactoryPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: powerFactoryTggRules,
};

export const powerfactoryTggPlan: CompiledTGGPlan = planTGGRules(powerfactoryPolyglotConfig);

export function createPowerfactoryTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: powerfactoryTggPlan });
}
