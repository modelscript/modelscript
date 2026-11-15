// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { modflowPolyglotConfig } from "./modflow-rules.js";

export * from "./modflow-rules.js";

export const modflowTggPlan: CompiledTGGPlan = planTGGRules(modflowPolyglotConfig);

export function createModflowTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: modflowTggPlan });
}
