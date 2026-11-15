// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { verilogAPolyglotConfig } from "./verilog-a-rules.js";

export * from "./verilog-a-rules.js";

export const verilogATggPlan: CompiledTGGPlan = planTGGRules(verilogAPolyglotConfig);

export function createVerilogATggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: verilogATggPlan });
}
