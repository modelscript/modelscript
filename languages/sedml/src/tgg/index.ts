// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { sedmlPolyglotConfig } from "./sedml-rules.js";

export * from "./sedml-rules.js";

export const sedmlTggPlan: CompiledTGGPlan = planTGGRules(sedmlPolyglotConfig);

export function createSedmlTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: sedmlTggPlan });
}
