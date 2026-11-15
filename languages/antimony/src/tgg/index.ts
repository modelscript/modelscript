// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { antimonyPolyglotConfig } from "./antimony-rules.js";

export * from "./antimony-rules.js";

export const antimonyTggPlan: CompiledTGGPlan = planTGGRules(antimonyPolyglotConfig);

export function createAntimonyTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: antimonyTggPlan });
}
