// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { fiberPolyglotConfig } from "./fiber-rules.js";

export * from "./fiber-rules.js";

export const fiberTggPlan: CompiledTGGPlan = planTGGRules(fiberPolyglotConfig);

export function createFiberTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: fiberTggPlan });
}
