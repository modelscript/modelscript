// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { eclipsePolyglotConfig } from "./eclipse-rules.js";

export * from "./eclipse-rules.js";

export const eclipseTggPlan: CompiledTGGPlan = planTGGRules(eclipsePolyglotConfig);

export function createEclipseTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: eclipseTggPlan });
}
