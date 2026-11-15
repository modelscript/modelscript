// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { spiceTggRules } from "./spice-rules.js";

export * from "./spice-rules.js";
export * from "./spice-sync.js";
export * from "./types.js";

export const spicePolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: spiceTggRules,
};

export const spiceTggPlan: CompiledTGGPlan = planTGGRules(spicePolyglotConfig);

export function createSpiceTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: spiceTggPlan });
}
