// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { dnp3PolyglotConfig } from "./dnp3-rules.js";

export * from "./dnp3-rules.js";

export const dnp3TggPlan: CompiledTGGPlan = planTGGRules(dnp3PolyglotConfig);

export function createDnp3TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: dnp3TggPlan });
}
