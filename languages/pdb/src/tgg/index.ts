// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { pdbPolyglotConfig } from "./pdb-rules.js";

export * from "./pdb-rules.js";

export const pdbTggPlan: CompiledTGGPlan = planTGGRules(pdbPolyglotConfig);

export function createPdbTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: pdbTggPlan });
}
