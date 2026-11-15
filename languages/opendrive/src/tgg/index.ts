// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { opendrivePolyglotConfig } from "./opendrive-rules.js";

export * from "./opendrive-rules.js";

export const opendriveTggPlan: CompiledTGGPlan = planTGGRules(opendrivePolyglotConfig);

export function createOpendriveTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: opendriveTggPlan });
}
