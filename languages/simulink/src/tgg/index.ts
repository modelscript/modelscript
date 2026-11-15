// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { simulinkPolyglotConfig } from "./simulink-rules.js";

export * from "./modelica-parser.js";
export * from "./simulink-rules.js";
export * from "./simulink-sync.js";
export * from "./types.js";

export const simulinkTggPlan: CompiledTGGPlan = planTGGRules(simulinkPolyglotConfig);

export function createSimulinkTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: simulinkTggPlan });
}
