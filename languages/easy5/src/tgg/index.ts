// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { easy5PolyglotConfig } from "./easy5-rules.js";

export * from "./easy5-rules.js";
export * from "./easy5-sync.js";
export * from "./modelica-parser.js";
export * from "./types.js";

export const easy5TggPlan: CompiledTGGPlan = planTGGRules(easy5PolyglotConfig);

export function createEasy5TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: easy5TggPlan });
}
