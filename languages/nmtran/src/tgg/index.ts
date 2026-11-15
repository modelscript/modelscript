// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { nmtranPolyglotConfig } from "./nmtran-rules.js";

export * from "./nmtran-rules.js";

export const nmtranTggPlan: CompiledTGGPlan = planTGGRules(nmtranPolyglotConfig);

export function createNmtranTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: nmtranTggPlan });
}
