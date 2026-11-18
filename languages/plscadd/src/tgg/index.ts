// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";

export const plscaddTggRules = [
  tggRule({
    name: "PlsCaddSpanToPsseBranch",
    sourceLang: "plscadd",
    targetLang: "psse",
    priority: 10,
    source: ($, v) => $["PlsSpan"]?.({ id: v("spanName") }),
    target: ($, v) => $["BranchRecord"]?.({ circuit: v("spanName") }),
    where: (v) => [tggEq(v("spanName"), v("spanName")), tggComplement(["conductor", "tensionN"])],
  }),
];

export const plscaddPolyglotConfig: PolyglotConfig = {
  languages: ["psse", "las"],
  rules: plscaddTggRules,
};

export const plscaddTggPlan: CompiledTGGPlan = planTGGRules(plscaddPolyglotConfig);

export function createPlsCaddTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: plscaddTggPlan });
}
