// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { reqifPolyglotConfig } from "./reqif-rules.js";

export * from "./reqif-rules.js";
export * from "./reqif-sync.js";

export const reqifTggPlan: CompiledTGGPlan = planTGGRules(reqifPolyglotConfig);

export function createReqifTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: reqifTggPlan });
}
