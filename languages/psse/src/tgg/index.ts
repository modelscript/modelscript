// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { pssePolyglotConfig } from "../tgg.js";

export * from "../tgg.js";

export const psseTggPlan: CompiledTGGPlan = planTGGRules(pssePolyglotConfig);

export function createPsseTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: psseTggPlan });
}
