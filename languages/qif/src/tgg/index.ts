// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { qifPolyglotConfig } from "./qif-rules.js";

export * from "./qif-rules.js";

export const qifTggPlan: CompiledTGGPlan = planTGGRules(qifPolyglotConfig);

export function createQifTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: qifTggPlan });
}
