// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { opensimPolyglotConfig } from "./opensim-rules.js";

export * from "./opensim-rules.js";

export const opensimTggPlan: CompiledTGGPlan = planTGGRules(opensimPolyglotConfig);

export function createOpensimTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: opensimTggPlan });
}
