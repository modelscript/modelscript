// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { pscadPolyglotConfig } from "./pscad-polyglot.js";

export * from "./pscad-ieee-rules.js";
export * from "./pscad-ieee-sync.js";
export * from "./pscad-polyglot.js";

export const pscadTggPlan: CompiledTGGPlan = planTGGRules(pscadPolyglotConfig);

export function createPscadTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: pscadTggPlan });
}
