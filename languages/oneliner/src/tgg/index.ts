// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { onelinerPolyglotConfig } from "./oneliner-rules.js";

export * from "./oneliner-rules.js";

export const onelinerTggPlan: CompiledTGGPlan = planTGGRules(onelinerPolyglotConfig);

export function createOnelinerTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: onelinerTggPlan });
}
