// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { cfdPolyglotConfig } from "./cfd-rules.js";

export * from "./cfd-rules.js";

export const cfdTggPlan: CompiledTGGPlan = planTGGRules(cfdPolyglotConfig);

export function createCfdTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: cfdTggPlan });
}
