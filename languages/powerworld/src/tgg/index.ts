// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { powerworldPolyglotConfig } from "./powerworld-rules.js";

export * from "./powerworld-rules.js";

export const powerworldTggPlan: CompiledTGGPlan = planTGGRules(powerworldPolyglotConfig);

export function createPowerWorldTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: powerworldTggPlan });
}
