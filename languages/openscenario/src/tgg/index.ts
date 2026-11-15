// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { openscenarioPolyglotConfig } from "./openscenario-rules.js";

export * from "./openscenario-rules.js";

export const openscenarioTggPlan: CompiledTGGPlan = planTGGRules(openscenarioPolyglotConfig);

export function createOpenscenarioTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: openscenarioTggPlan });
}
