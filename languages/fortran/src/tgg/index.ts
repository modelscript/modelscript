// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { fortranPolyglotConfig } from "./fortran-rules.js";

export * from "./fortran-rules.js";

export const fortranTggPlan: CompiledTGGPlan = planTGGRules(fortranPolyglotConfig);

export function createFortranTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: fortranTggPlan });
}
