// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { sysml2PolyglotConfig } from "../tgg.js";

export * from "../tgg.js";

export const sysml2TggPlan: CompiledTGGPlan = planTGGRules(sysml2PolyglotConfig);

export function createSysml2TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: sysml2TggPlan });
}
