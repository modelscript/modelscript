// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { threeMfPolyglotConfig } from "./three-mf-rules.js";

export * from "./three-mf-rules.js";

export const threeMfTggPlan: CompiledTGGPlan = planTGGRules(threeMfPolyglotConfig);

export function createThreeMfTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: threeMfTggPlan });
}
