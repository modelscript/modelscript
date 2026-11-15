// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { genbankPolyglotConfig } from "./genbank-rules.js";

export * from "./genbank-rules.js";

export const genbankTggPlan: CompiledTGGPlan = planTGGRules(genbankPolyglotConfig);

export function createGenbankTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: genbankTggPlan });
}
