// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { csvPolyglotConfig } from "./csv-rules.js";

export * from "./csv-rules.js";

export const csvTggPlan: CompiledTGGPlan = planTGGRules(csvPolyglotConfig);

export function createCsvTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: csvTggPlan });
}
