// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { magicDrawPolyglotConfig } from "./magicdraw-rules.js";

export * from "./magicdraw-rules.js";

export const magicDrawTggPlan: CompiledTGGPlan = planTGGRules(magicDrawPolyglotConfig);

export function createMagicDrawTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: magicDrawTggPlan });
}
