// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { asmPolyglotConfig } from "./asm-rules.js";

export * from "./asm-rules.js";

export const asmTggPlan: CompiledTGGPlan = planTGGRules(asmPolyglotConfig);

export function createAsmTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: asmTggPlan });
}
