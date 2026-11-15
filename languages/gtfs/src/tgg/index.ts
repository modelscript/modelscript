// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { gtfsPolyglotConfig } from "./gtfs-rules.js";

export * from "./gtfs-rules.js";

export const gtfsTggPlan: CompiledTGGPlan = planTGGRules(gtfsPolyglotConfig);

export function createGtfsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: gtfsTggPlan });
}
