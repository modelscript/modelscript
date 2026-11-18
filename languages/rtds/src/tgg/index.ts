// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";

export const rtdsTggRules = [
  tggRule({
    name: "RtdsBranchToAtpBranch",
    sourceLang: "rtds",
    targetLang: "atp",
    priority: 10,
    source: ($, v) => $["RtdsComponent"]?.({ name: v("compName") }),
    target: ($, v) => $["AtpBranch"]?.({ name: v("compName") }),
    where: (v) => [tggEq(v("compName"), v("compName")), tggComplement(["subsystem", "nodes"])],
  }),
];

export const rtdsPolyglotConfig: PolyglotConfig = {
  languages: ["atp", "pscad"],
  rules: rtdsTggRules,
};

export const rtdsTggPlan: CompiledTGGPlan = planTGGRules(rtdsPolyglotConfig);

export function createRtdsTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: rtdsTggPlan });
}
