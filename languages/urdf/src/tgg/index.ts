// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { urdfPolyglotConfig } from "./urdf-rules.js";

export * from "./urdf-rules.js";
export * from "./urdf-sync.js";

export const urdfTggPlan: CompiledTGGPlan = planTGGRules(urdfPolyglotConfig);

export function createUrdfTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: urdfTggPlan });
}
