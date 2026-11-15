// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { matpowerTggRules } from "./matpower-rules.js";

export * from "./matpower-rules.js";

export const matpowerPolyglotConfig: PolyglotConfig = {
  languages: ["matpower", "modelica", "sysml2"],
  rules: matpowerTggRules,
};
export const matpowerTggPlan: CompiledTGGPlan = planTGGRules(matpowerPolyglotConfig);

export function createMatpowerTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: matpowerTggPlan });
}
