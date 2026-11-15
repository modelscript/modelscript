// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { cellmlPolyglotConfig } from "./cellml-rules.js";

export * from "./cellml-rules.js";

export const cellmlTggPlan: CompiledTGGPlan = planTGGRules(cellmlPolyglotConfig);

export function createCellmlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: cellmlTggPlan });
}
