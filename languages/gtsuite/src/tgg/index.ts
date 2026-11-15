// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { gtsuitePolyglotConfig } from "./gtsuite-rules.js";

export * from "./gtsuite-rules.js";

export const gtsuiteTggPlan: CompiledTGGPlan = planTGGRules(gtsuitePolyglotConfig);

export function createGtsuiteTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: gtsuiteTggPlan });
}
